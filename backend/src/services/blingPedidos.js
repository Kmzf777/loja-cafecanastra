"use strict";

/**
 * Sincronização de pedidos com o Bling (ERP fiscal e de estoque do gestor).
 *
 * O fluxo que este módulo reproduz é o que a loja tinha na Tray: pedido
 * APROVADO vira pedido de venda no Bling (que baixa o estoque fiscal de lá),
 * a NF-e é gerada e transmitida a partir dele, e o código de rastreio que a
 * expedição preencher no Bling volta para a loja — que então avisa o cliente
 * com o e-mail de "enviado" de sempre.
 *
 * TRÊS REGRAS SUSTENTAM TUDO AQUI:
 *
 * 1. FALHA DO BLING NUNCA DERRUBA O FLUXO DE PAGAMENTO. O gatilho
 *    (`aoAprovarPedido`) roda DEPOIS do commit, fora da resposta, com catch —
 *    o mesmo padrão dos e-mails de status. O pior caso de um Bling fora do ar
 *    é um pedido com `bling_id` nulo e uma linha de log; o painel ressincroniza
 *    com um clique (POST /bling/pedidos/:id/sincronizar).
 *
 * 2. IDEMPOTÊNCIA POR `bling_id` (0012). Pedido já sincronizado é no-op. O
 *    claim (`bling_situacao = 'sincronizando'` + `bling_claim_em`) é um UPDATE
 *    condicional, NÃO um FOR UPDATE segurado durante a ida ao Bling: o webhook
 *    do MP trava a MESMA linha do pedido, e prendê-la por uma chamada de rede
 *    de 15s faria o MP estourar timeout — exatamente o que o checkout gasta
 *    comentários proibindo.
 *
 *    O claim envelhecido (10 min) se auto-cura se o processo morrer no meio, e
 *    é essa auto-cura que abre a única janela de venda dobrada que existe
 *    aqui: um processo lento que ainda esteja no meio da criação quando outro
 *    herda o claim. Contra ela trabalham DUAS defesas, nesta ordem — o PRAZO
 *    AGREGADO (8 min, abaixo dos 10 do claim: quem passar disso aborta em vez
 *    de continuar chamando o Bling com o claim já herdado por outro) e a BUSCA
 *    POR `numeroLoja` no Bling antes do POST, quando o claim foi herdado.
 *
 *    O índice único parcial de 0012 NÃO é rede contra isso: ele impede o mesmo
 *    `bling_id` em dois pedidos da loja (vínculo cruzado), e duas vendas
 *    criadas para o mesmo pedido têm ids DIFERENTES — passariam por ele sem
 *    tropeçar. Quem impede o dobro é o claim, o prazo e a busca.
 *
 * 3. OS PRODUTOS PRECISAM EXISTIR NO BLING COM OS MESMOS SKUs. Item sem
 *    vínculo de produto no Bling não movimenta estoque lá e mentiria em
 *    silêncio — por isso cada SKU é conferido ANTES de criar qualquer coisa,
 *    e o erro nomeia o SKU e aponta o runbook (docs/bling.md, que traz a
 *    tabela dos 29 SKUs para exportar).
 */

const pool = require("../pgPool");
const blingClient = require("./blingClient");
const { GRUPO_CANCELADO } = require("../utils/statusDePedido");
const { sendStatusEmail } = require("../utils/emailSender");

/**
 * A projeção do pedido para as respostas das rotas /bling: o contrato HTTP de
 * sempre (ordersRepository.COLUNAS_DO_CONTRATO) MAIS os campos da 0012. Vive
 * aqui, e não no ordersRepository, porque só as rotas do Bling precisam dela —
 * o contrato do painel legado não muda de forma (decisão 2 do plano mestre).
 *
 * `redigido_em` (da 0013, não da 0012) entra por uma razão de conduta, não de
 * painel: é a única coisa que distingue um endereço de verdade de um endereço
 * já apagado a pedido do titular. Sem ela projetada, a sincronização mandaria
 * ao ERP a rua "[redigido]" e um CEP mutilado achando que era entrega real —
 * ver `recusarPedidoRedigido`.
 */
const COLUNAS_COM_BLING = `
  p.pedido_id            AS order_id,
  p.user_id,
  p.total                AS total_amount,
  p.status,
  p.metodo_pagamento     AS payment_method,
  p.pagamento_id_mp      AS payment_id_mp,
  p.itens                AS items,
  p.endereco_json        AS address_json,
  p.frete                AS shipping_cost,
  p.metodo_envio         AS shipping_method,
  p.codigo_rastreio      AS tracking_code,
  p.cupom_codigo         AS coupon_code,
  p.desconto             AS discount,
  p.bling_id,
  p.bling_situacao,
  p.bling_sincronizado_em,
  p.nfe_id,
  p.nfe_numero,
  p.nfe_chave,
  p.nfe_url,
  p.redigido_em,
  p.criado_em            AS created_at,
  p.atualizado_em        AS updated_at
`;

/** Os status em que a venda está PAGA — só eles vão ao ERP. `pendente`,
 * `em_processamento` e `autorizado` ainda podem morrer sem cobrança, e o
 * grupo cancelado é uma venda que não vale: nenhum deles vira pedido de venda
 * (viraria estoque baixado e imposto provisionado de uma venda inexistente). */
const STATUS_QUE_SINCRONIZAM = Object.freeze(["aprovado", "enviado", "entregue"]);

/** Os status a partir dos quais o rastreio avança o pedido para 'enviado'. */
const STATUS_PRE_ENVIO = Object.freeze([
  "aprovado",
  "em_processamento",
  "autorizado",
]);

/** Quanto tempo um claim de sincronização vale antes de ser considerado órfão
 * (o processo que o tomou morreu). Vive aqui e no SQL do claim, uma vez só. */
const CLAIM_ENVELHECE_EM = "10 minutes";

/**
 * O PRAZO AGREGADO de uma sincronização, deliberadamente ABAIXO dos 10 minutos
 * do claim.
 *
 * O teto de 15s do blingClient é por requisição; uma sincronização faz várias
 * (um GET por SKU, a busca do contato, a criação). Somadas, com o Bling
 * lerdo, elas passam dos 10 minutos — e aí o claim desta chamada já envelheceu
 * e OUTRO processo pode tê-lo herdado enquanto esta ainda está criando a
 * venda. São duas vendas no ERP, e nenhuma trava de banco pega isso (os
 * `bling_id` são diferentes). Abortar aos 8 minutos fecha a janela pelo lado
 * de cá: quem estourou o prazo desiste ANTES de o claim virar de outro.
 */
const PRAZO_DA_SINCRONIZACAO_MS = 8 * 60 * 1000;

function erroComStatus(mensagem, status, codigoPublico) {
  const erro = new Error(mensagem);
  erro.status = status;
  if (codigoPublico) erro.codigoPublico = codigoPublico;
  return erro;
}

/**
 * Devolve a função que confere o prazo agregado. Chamada ANTES de cada ida ao
 * Bling: o corte é entre chamadas, nunca no meio de uma (abortar uma criação
 * em voo é exatamente o que produziria a venda fantasma que não sabemos que
 * existe).
 */
function relogioDaSincronizacao(prazoMs = PRAZO_DA_SINCRONIZACAO_MS) {
  const limite = Date.now() + prazoMs;
  return function conferirPrazo(etapa) {
    if (Date.now() <= limite) return;
    throw erroComStatus(
      `A sincronização com o Bling passou de ${Math.round(prazoMs / 60000)} ` +
        `minutos (parou em "${etapa}") e foi abortada de propósito, antes de ` +
        "a reserva desta sincronização envelhecer e outra chamada assumir o " +
        "mesmo pedido. Nada foi criado pela metade — tente de novo quando o " +
        "Bling estiver respondendo.",
      504,
      "BLING_PRAZO_ESGOTADO",
    );
  };
}

/**
 * A GUARDA DA LGPD, e o motivo dela existir.
 *
 * Redação (0013) não apaga o pedido: ela esvazia o que é dado pessoal —
 * `endereco_json` vira rua "[redigido]", o CEP fica mutilado, o cliente perde
 * nome e CPF. O pedido continua lá porque a obrigação fiscal e contábil não
 * some com o pedido de exclusão. Mandar ISSO ao ERP seria criar no Bling uma
 * venda com endereço de entrega falso e, pior, ressuscitar no sistema de fora
 * um dado que o titular mandou apagar aqui. 422 e não 409: não é um estado
 * transitório que vai melhorar sozinho — é um pedido que nunca mais vai ao
 * ERP, e a frase precisa dizer isso ao gestor que clicou no botão.
 */
function recusarPedidoRedigido(pedido) {
  if (!pedido.redigido_em) return;
  throw erroComStatus(
    `Pedido redigido pela LGPD não vai ao ERP: o pedido ${pedido.order_id} ` +
      "teve os dados pessoais apagados a pedido do titular e não tem mais " +
      "endereço nem CPF de verdade para enviar ao Bling. Se a nota precisa " +
      "ser emitida, faça-a no painel do Bling com os dados que a obrigação " +
      "fiscal guardou lá.",
    422,
    "PEDIDO_REDIGIDO",
  );
}

/**
 * O endereço da entrega no formato do Bling. Existe uma vez só porque o MESMO
 * mapeamento serve ao cadastro do contato (`endereco.geral`) e à etiqueta do
 * transporte no pedido de venda — duplicado, um dia um dos dois ganharia o
 * complemento e o outro não, e a divergência só apareceria na etiqueta impressa.
 */
function enderecoParaBling(endereco = {}) {
  return {
    endereco: endereco.street || "",
    numero: String(endereco.number || "S/N"),
    complemento: endereco.complement || "",
    bairro: endereco.neighborhood || "",
    cep: String(endereco.zip_code || "").replace(/\D/g, ""),
    municipio: endereco.city || "",
    uf: endereco.state || "",
  };
}

/** O pedido no contrato + campos Bling, com nome/CPF/e-mail do cliente. */
async function carregarPedido(pedidoId) {
  const { rows } = await pool.query(
    `SELECT ${COLUNAS_COM_BLING},
            c.nome AS cliente_nome,
            c.cpf  AS cliente_cpf,
            u.email AS cliente_email
       FROM canastra.pedidos p
       LEFT JOIN canastra.clientes c ON c.user_id = p.user_id
       LEFT JOIN auth.users u        ON u.id      = p.user_id
      WHERE p.pedido_id = $1::uuid`,
    [pedidoId],
  );
  return rows[0];
}

/** Só a projeção pública (sem CPF/e-mail), para as respostas das rotas. */
async function pedidoParaResposta(pedidoId) {
  const { rows } = await pool.query(
    `SELECT ${COLUNAS_COM_BLING} FROM canastra.pedidos p
      WHERE p.pedido_id = $1::uuid`,
    [pedidoId],
  );
  return rows[0];
}

function itensDoPedido(pedido) {
  let itens = pedido.items;
  if (typeof itens === "string") {
    try {
      itens = JSON.parse(itens);
    } catch {
      itens = null;
    }
  }
  if (!Array.isArray(itens) || itens.length === 0) {
    throw erroComStatus(
      `O pedido ${pedido.order_id} está sem itens legíveis — não há o que sincronizar.`,
      422,
    );
  }
  return itens;
}

/**
 * Resolve cada item do pedido para um produto DO BLING, pelo SKU.
 *
 * O `itens` do pedido é a fotografia do checkout (product_id, nome, preço,
 * quantidade) e NÃO carrega SKU — o SKU vem de `canastra.produtos` pela
 * `product_id`. Duas ausências param a sincronização com frase, ANTES de
 * criar qualquer coisa no Bling:
 *   · produto apagado ou sem SKU na loja → o gestor precisa repor o SKU;
 *   · SKU sem produto correspondente no Bling → o gestor precisa cadastrar
 *     (a lista dos 29 está no runbook docs/bling.md).
 *
 * O CASAMENTO É EXATO, E ISSO NÃO É PREGUIÇA DE BUSCAR MELHOR. A busca do
 * Bling por `codigo` é uma busca, não um lookup: ela pode responder por
 * prefixo, por semelhança, ou (num filtro que a API resolva ignorar) a página
 * inteira de produtos. Aceitar "o primeiro que veio" vincularia o item a um
 * produto QUALQUER — e o efeito não é um erro, é uma NF-e com o produto errado
 * e o estoque do produto errado baixado no ERP, em silêncio, descoberto no
 * inventário. Sem `codigo` idêntico ao SKU, a resposta é SKU_AUSENTE_NO_BLING.
 */
async function resolverItensNoBling(pedido, itens, conferirPrazo = () => {}) {
  const ids = itens.map((i) => i.product_id).filter(Boolean);
  const { rows } = await pool.query(
    `SELECT produto_id, sku FROM canastra.produtos
      WHERE produto_id = ANY($1::uuid[])`,
    [ids],
  );
  const skuPorProduto = new Map(rows.map((r) => [r.produto_id, r.sku]));

  /** Um GET por SKU DISTINTO, e não por item: o mesmo SKU pode aparecer em
   * duas linhas do pedido (a sacola soma quantidade, mas nada garante isso
   * para sempre) e a segunda consulta traria a mesma resposta. O cache vive só
   * dentro desta sincronização — cadastro corrigido no Bling vale na próxima. */
  const produtoPorSku = new Map();

  const itensBling = [];
  for (const item of itens) {
    const sku = skuPorProduto.get(item.product_id);
    if (!sku) {
      throw erroComStatus(
        `O item "${item.name || item.product_id}" não tem SKU no catálogo da ` +
          "loja (produto apagado ou sem SKU) — preencha o SKU no painel antes " +
          "de sincronizar com o Bling.",
        400,
        "SKU_AUSENTE_NA_LOJA",
      );
    }

    if (!produtoPorSku.has(sku)) {
      conferirPrazo(`consulta do SKU ${sku}`);
      const resposta = await blingClient.requisitar("GET", "/produtos", {
        query: { codigo: sku },
      });
      const candidatos = Array.isArray(resposta?.data) ? resposta.data : [];
      produtoPorSku.set(
        sku,
        candidatos.find((p) => p?.codigo === sku && p?.id) || null,
      );
    }

    const produtoBling = produtoPorSku.get(sku);
    if (!produtoBling) {
      throw erroComStatus(
        `O SKU "${sku}" não está cadastrado no Bling com este código exato. ` +
          "Cadastre o produto lá com o Código idêntico ao SKU da loja (a " +
          "tabela completa está em docs/bling.md) e sincronize de novo — " +
          "vincular a um produto parecido baixaria o estoque errado.",
        400,
        "SKU_AUSENTE_NO_BLING",
      );
    }

    itensBling.push({
      produto: { id: produtoBling.id },
      codigo: sku,
      descricao: item.name || sku,
      quantidade: Number(item.quantity),
      valor: Number(item.price),
    });
  }
  return itensBling;
}

/**
 * Garante o contato do cliente no Bling e devolve o id. Busca por CPF (o
 * identificador estável — e-mail muda, nome se repete); sem resultado, cria
 * com nome/CPF/e-mail e o endereço do `endereco_json` do PEDIDO — o endereço
 * da entrega desta venda, não o cadastro atual do cliente.
 */
async function garantirContatoNoBling(pedido) {
  const cpf = String(pedido.cliente_cpf || "").replace(/\D/g, "");
  if (!cpf) {
    throw erroComStatus(
      `O pedido ${pedido.order_id} não tem cliente com CPF (conta apagada?) — ` +
        "o Bling exige um contato identificado para o pedido de venda.",
      422,
    );
  }

  const busca = await blingClient.requisitar("GET", "/contatos", {
    query: { numeroDocumento: cpf },
  });
  const existente = Array.isArray(busca?.data) ? busca.data[0] : null;
  if (existente?.id) return existente.id;

  const criado = await blingClient.requisitar("POST", "/contatos", {
    body: {
      nome: pedido.cliente_nome || "Cliente da loja",
      tipo: "F",
      numeroDocumento: cpf,
      situacao: "A",
      ...(pedido.cliente_email ? { email: pedido.cliente_email } : {}),
      endereco: { geral: enderecoParaBling(pedido.address_json) },
    },
  });
  const id = criado?.data?.id;
  if (!id) {
    throw new Error(
      "Bling criou o contato mas não devolveu o id — resposta inesperada da API.",
    );
  }
  return id;
}

/**
 * Já existe no Bling um pedido de venda para ESTE pedido da loja?
 *
 * Só é chamada quando o claim foi HERDADO de uma sincronização que envelheceu
 * sem terminar — o único caso em que uma venda pode ter sido criada lá sem que
 * o `bling_id` tenha chegado aqui (o processo morreu entre o POST e o UPDATE,
 * ou o POST respondeu depois do prazo). Sem esta pergunta, a retentativa
 * criaria a SEGUNDA venda do mesmo pedido: estoque baixado duas vezes, duas
 * notas possíveis, e o gestor descobrindo no fechamento.
 *
 * O filtro é `numeroLoja` — o elo que a criação grava —, mas a resposta é
 * conferida item a item mesmo assim: um filtro que a API não reconheça é
 * ignorado, e a lista devolvida seria a de TODOS os pedidos. Aceitar o
 * primeiro ali dentro adotaria a venda de outro cliente.
 */
async function procurarVendaNoBling(pedido) {
  const busca = await blingClient.requisitar("GET", "/pedidos/vendas", {
    query: { numeroLoja: pedido.order_id },
  });
  const candidatos = Array.isArray(busca?.data) ? busca.data : [];
  const daLoja = candidatos.find(
    (v) => v?.id && String(v.numeroLoja || "") === String(pedido.order_id),
  );
  return daLoja ? String(daLoja.id) : null;
}

/**
 * Cria o pedido de venda no Bling a partir de um pedido APROVADO da loja.
 * Idempotente por `bling_id`: já sincronizado → no-op com `jaSincronizado`.
 */
async function sincronizarPedido(pedidoId) {
  const pedido = await carregarPedido(pedidoId);
  if (!pedido) {
    throw erroComStatus(`Pedido ${pedidoId} não existe.`, 404);
  }
  if (pedido.bling_id) {
    return {
      jaSincronizado: true,
      blingId: pedido.bling_id,
      pedido: await pedidoParaResposta(pedidoId),
    };
  }
  recusarPedidoRedigido(pedido);
  if (!STATUS_QUE_SINCRONIZAM.includes(pedido.status)) {
    throw erroComStatus(
      `O pedido está "${pedido.status}" — só venda com pagamento confirmado ` +
        "(aprovado/enviado/entregue) vira pedido de venda no Bling.",
      409,
    );
  }

  /**
   * O CLAIM: quem conseguir marcar 'sincronizando' é quem chama o Bling.
   *
   * O corte de 10 minutos desfaz o claim de um processo que morreu no meio —
   * sem ele, um crash deixaria o pedido "em sincronização" para sempre e o
   * botão do painel responderia 409 até alguém mexer no banco na mão.
   *
   * O relógio é `bling_claim_em`, coluna que SÓ o claim escreve (0012), e não
   * `atualizado_em`: aquele é carimbado por qualquer escritor da linha — o
   * webhook do MP, o painel mudando status, a redação da LGPD — e uma dessas
   * escritas empurraria o vencimento do claim para frente sem que o claim
   * tivesse recomeçado, adiando a auto-cura indefinidamente.
   */
  const claim = await pool.query(
    `UPDATE canastra.pedidos
        SET bling_situacao = 'sincronizando',
            bling_claim_em = now(),
            atualizado_em  = now()
      WHERE pedido_id = $1::uuid
        AND bling_id IS NULL
        AND (bling_situacao IS DISTINCT FROM 'sincronizando'
             OR bling_claim_em IS NULL
             OR bling_claim_em < now() - $2::interval)`,
    [pedidoId, CLAIM_ENVELHECE_EM],
  );
  if (claim.rowCount === 0) {
    const atual = await pedidoParaResposta(pedidoId);
    if (atual?.bling_id) {
      return { jaSincronizado: true, blingId: atual.bling_id, pedido: atual };
    }
    throw erroComStatus(
      "Este pedido já está sendo sincronizado por outra chamada — aguarde um " +
        "instante e confira de novo.",
      409,
    );
  }

  /**
   * O claim veio de um processo que NÃO terminou (estava 'sincronizando' e
   * envelheceu). É a única situação em que pode existir uma venda no Bling
   * sem `bling_id` gravado aqui — e é por isso que ela, e só ela, paga o
   * custo da busca por `numeroLoja` antes de criar (ver `procurarVendaNoBling`).
   *
   * A leitura é a do pedido carregado ANTES do claim. Se o outro processo
   * tiver soltado o claim entre a leitura e o UPDATE, o pior que acontece é
   * uma consulta a mais que não acha nada — barato demais para valer uma
   * releitura com FOR UPDATE.
   */
  const claimHerdado = pedido.bling_situacao === "sincronizando";
  const conferirPrazo = relogioDaSincronizacao();

  try {
    if (claimHerdado) {
      const jaCriado = await procurarVendaNoBling(pedido);
      if (jaCriado) {
        await pool.query(
          `UPDATE canastra.pedidos
              SET bling_id = $1,
                  bling_situacao = 'sincronizado',
                  bling_claim_em = NULL,
                  bling_sincronizado_em = now(),
                  atualizado_em = now()
            WHERE pedido_id = $2::uuid`,
          [jaCriado, pedidoId],
        );
        console.warn(
          `Bling: o pedido ${pedidoId} JÁ tinha pedido de venda ${jaCriado} ` +
            "(sincronização anterior morreu depois de criar) — adotado, nada " +
            "foi criado de novo.",
        );
        return {
          jaSincronizado: true,
          recuperado: true,
          blingId: jaCriado,
          pedido: await pedidoParaResposta(pedidoId),
        };
      }
    }

    const itens = itensDoPedido(pedido);
    const itensBling = await resolverItensNoBling(pedido, itens, conferirPrazo);
    conferirPrazo("busca do contato");
    const contatoId = await garantirContatoNoBling(pedido);

    const endereco = pedido.address_json || {};
    const desconto = Number(pedido.discount || 0);
    conferirPrazo("criação do pedido de venda");
    const criado = await blingClient.requisitar("POST", "/pedidos/vendas", {
      body: {
        // O elo de volta: `numeroLoja` é o pedido da LOJA dentro do Bling —
        // é por ele que o gestor confere um contra o outro.
        numeroLoja: pedido.order_id,
        data: new Date(pedido.created_at).toISOString().slice(0, 10),
        contato: { id: contatoId },
        itens: itensBling,
        // Frete CIF (a loja contrata o envio e cobra do cliente no total).
        transporte: {
          frete: Number(pedido.shipping_cost || 0),
          fretePorConta: 0,
          ...(endereco.street
            ? {
                etiqueta: {
                  nome: pedido.cliente_nome || "Cliente da loja",
                  ...enderecoParaBling(endereco),
                },
              }
            : {}),
        },
        // O desconto do cupom entra como desconto DO PEDIDO, em reais — o
        // mesmo número recalculado no servidor que foi cobrado (0010).
        ...(desconto > 0 ? { desconto: { valor: desconto, unidade: "REAL" } } : {}),
        observacoes:
          `Pedido ${pedido.order_id} da loja oficial` +
          (pedido.coupon_code ? ` (cupom ${pedido.coupon_code})` : "") +
          (pedido.shipping_method ? ` — envio: ${pedido.shipping_method}` : ""),
      },
    });

    const blingId = criado?.data?.id;
    if (!blingId) {
      throw new Error(
        "Bling criou o pedido de venda mas não devolveu o id — resposta inesperada da API.",
      );
    }

    await pool.query(
      `UPDATE canastra.pedidos
          SET bling_id = $1,
              bling_situacao = 'sincronizado',
              bling_claim_em = NULL,
              bling_sincronizado_em = now(),
              atualizado_em = now()
        WHERE pedido_id = $2::uuid`,
      [String(blingId), pedidoId],
    );

    console.log(`Bling: pedido ${pedidoId} sincronizado (pedido de venda ${blingId}).`);
    return {
      jaSincronizado: false,
      blingId: String(blingId),
      pedido: await pedidoParaResposta(pedidoId),
    };
  } catch (erro) {
    // Desfaz o claim para a retentativa (manual ou do próximo aprovado) não
    // esbarrar num 'sincronizando' fantasma. O `bling_id IS NULL` protege a
    // janela em que o UPDATE final já gravou e o erro veio depois.
    await pool
      .query(
        `UPDATE canastra.pedidos
            SET bling_situacao = NULL, bling_claim_em = NULL, atualizado_em = now()
          WHERE pedido_id = $1::uuid AND bling_id IS NULL`,
        [pedidoId],
      )
      .catch((e) =>
        console.error(`Bling: não desfiz o claim do pedido ${pedidoId}:`, e.message),
      );
    throw erro;
  }
}

/**
 * Gera e transmite a NF-e do pedido sincronizado, nos três passos da API v3:
 * gerar a nota a partir do pedido de venda, enviá-la (transmissão à SEFAZ) e
 * reler para gravar número, chave de acesso e link do DANFE.
 *
 * GERAR E TRANSMITIR SÃO DOIS ATOS, E O SEGUNDO FALHA SOZINHO. O caso comum
 * (conta Bling sem configuração fiscal: natureza de operação, série,
 * certificado) é a nota nascer PENDENTE no Bling e a transmissão ser recusada.
 * A nota existe, tem número — e não vale nada até ir à SEFAZ.
 *
 * Por isso quem responde "já emitida" é `nfe_chave`, gravada SÓ depois de uma
 * transmissão aceita, e nunca `nfe_numero`: era ele que fazia a retentativa
 * responder "a NF-e deste pedido já tinha sido emitida" sobre uma nota que
 * nunca foi transmitida — mentira, e das caras, porque o gestor pararia de
 * procurar. E `nfe_id` (0012) guarda a nota gerada, para a retentativa
 * RETRANSMITIR a mesma em vez de gerar uma segunda nota órfã no Bling.
 */
async function emitirNfe(pedidoId) {
  let pedido = await carregarPedido(pedidoId);
  if (!pedido) {
    throw erroComStatus(`Pedido ${pedidoId} não existe.`, 404);
  }
  if (pedido.nfe_chave) {
    return { jaEmitida: true, pedido: await pedidoParaResposta(pedidoId) };
  }
  if (!pedido.bling_id) {
    // Sincronizar recusa pedido redigido (LGPD), sem status pago e assim por
    // diante — as guardas de lá valem para a nota de graça.
    await sincronizarPedido(pedidoId);
    pedido = await carregarPedido(pedidoId);
  }

  // A nota já existe de uma tentativa anterior que não transmitiu? Então esta
  // chamada é uma RETRANSMISSÃO: nada de gerar outra.
  const retransmissao = Boolean(pedido.nfe_id);
  let notaId = pedido.nfe_id;

  if (!notaId) {
    const gerada = await blingClient.requisitar(
      "POST",
      `/pedidos/vendas/${pedido.bling_id}/gerar-nfe`,
    );
    notaId = gerada?.data?.id;
    if (!notaId) {
      throw new Error(
        "Bling gerou a NF-e mas não devolveu o id da nota — resposta inesperada da API.",
      );
    }
    // Grava o id ANTES de transmitir: se o processo morrer no meio do envio, a
    // nota gerada continua encontrável e a próxima chamada a retransmite.
    await pool.query(
      `UPDATE canastra.pedidos
          SET nfe_id = $1, atualizado_em = now()
        WHERE pedido_id = $2::uuid`,
      [String(notaId), pedidoId],
    );
  }

  try {
    await blingClient.requisitar("POST", `/nfe/${notaId}/enviar`);
  } catch (erro) {
    // A nota EXISTE no Bling (pendente), só não foi transmitida. Grava o
    // PARCIAL — número e link, nunca a chave — para o painel mostrar onde
    // parou, e devolve o erro do Bling (legível) com a instrução do caso.
    await gravarDadosDaNota(pedidoId, notaId, { comChave: false }).catch(() => {});
    throw erroDeTransmissao(erro, notaId, retransmissao);
  }

  await gravarDadosDaNota(pedidoId, notaId, { comChave: true });
  console.log(`Bling: NF-e do pedido ${pedidoId} emitida (nota ${notaId}).`);
  return { jaEmitida: false, pedido: await pedidoParaResposta(pedidoId) };
}

/**
 * A frase de uma transmissão recusada. Preserva o erro do Bling (é ele que diz
 * QUAL regra fiscal falhou) e acrescenta o que fazer — que muda conforme seja a
 * primeira recusa ou a segunda: na primeira, corrigir a configuração e clicar
 * de novo basta (a retentativa retransmite a MESMA nota); na segunda, a nota
 * já foi oferecida duas vezes e o caminho é o painel do Bling.
 */
function erroDeTransmissao(erro, notaId, retransmissao) {
  const instrucao = retransmissao
    ? `A nota ${notaId} foi GERADA no Bling mas NÃO transmitida, e a ` +
      "retransmissão daqui falhou de novo: nota gerada mas não transmitida — " +
      "retransmita pelo painel do Bling (Vendas → Notas fiscais → a nota " +
      "pendente → Enviar) depois de corrigir a configuração fiscal " +
      "(docs/bling.md, §4 e §7)."
    : `A nota ${notaId} foi GERADA no Bling mas NÃO transmitida — corrija o ` +
      "que o Bling apontou (docs/bling.md, §4) e emita de novo: a próxima " +
      "tentativa retransmite ESTA nota, não cria outra.";

  const novo = new Error(`${erro.message} — ${instrucao}`);
  if (erro.status) novo.status = erro.status;
  if (erro.statusBling) novo.statusBling = erro.statusBling;
  if (erro.codigoPublico) novo.codigoPublico = erro.codigoPublico;
  novo.causa = erro;
  return novo;
}

/**
 * Relê a nota no Bling e grava numero/url no pedido (o que houver).
 *
 * `comChave` decide se a CHAVE DE ACESSO entra. Ela é o carimbo de
 * "transmitida e autorizada" que faz `emitirNfe` responder "já emitida" — e o
 * Bling pode expô-la numa nota ainda pendente. Gravá-la fora do caminho de
 * sucesso reabriria exatamente o bug que esta função ajuda a fechar.
 */
async function gravarDadosDaNota(pedidoId, notaId, { comChave = true } = {}) {
  const consulta = await blingClient.requisitar("GET", `/nfe/${notaId}`);
  const nota = consulta?.data || {};
  const numero = nota.numero != null ? String(nota.numero) : null;
  const chave = comChave
    ? nota.chaveAcesso || nota.chave_acesso || nota.chave || null
    : null;
  const url = nota.linkDanfe || nota.linkPDF || nota.link_danfe || null;

  await pool.query(
    `UPDATE canastra.pedidos
        SET nfe_id     = $1,
            nfe_numero = COALESCE($2, nfe_numero),
            nfe_chave  = COALESCE($3, nfe_chave),
            nfe_url    = COALESCE($4, nfe_url),
            atualizado_em = now()
      WHERE pedido_id = $5::uuid`,
    [String(notaId), numero, chave, url, pedidoId],
  );
}

/**
 * Lê o pedido no Bling e, se a expedição já preencheu o rastreio lá, traz o
 * código para a loja: grava `codigo_rastreio`, avança o pedido para
 * 'enviado' (quando ele ainda estava num status pré-envio) e dispara o
 * e-mail de enviado de sempre (sendStatusEmail, que já inclui o código).
 *
 * Idempotente: mesmo código já gravado → no-op; pedido já 'enviado' ou
 * 'entregue' só atualiza o código, sem e-mail repetido.
 */
async function consultarRastreio(pedidoId) {
  const pedido = await carregarPedido(pedidoId);
  if (!pedido) {
    throw erroComStatus(`Pedido ${pedidoId} não existe.`, 404);
  }
  if (!pedido.bling_id) {
    throw erroComStatus(
      "Este pedido ainda não foi sincronizado com o Bling — sincronize antes " +
        "de consultar o rastreio.",
      409,
    );
  }
  // Venda cancelada/estornada não recebe rastreio. Antes, o código do Bling
  // era gravado num pedido reembolsado e a rota respondia "Rastreio do Bling
  // gravado no pedido" — sucesso sobre um envio que não vai acontecer, e o
  // gestor lendo isso como confirmação de despacho. O grupo vem de
  // `utils/statusDePedido` (a mesma lista que devolve estoque à prateleira):
  // duas cópias divergindo aqui não dariam erro, dariam rastreio gravado em
  // pedido estornado de novo.
  if (GRUPO_CANCELADO.includes(pedido.status)) {
    throw erroComStatus(
      `O pedido está "${pedido.status}" — venda cancelada ou estornada não ` +
        "recebe código de rastreio. Se ela foi mesmo enviada, corrija o " +
        "status do pedido antes.",
      409,
    );
  }

  const consulta = await blingClient.requisitar(
    "GET",
    `/pedidos/vendas/${pedido.bling_id}`,
  );
  const dados = consulta?.data || {};

  // A situação do Bling é cache informativo (ver 0012); grava quando vier.
  const situacao =
    dados.situacao?.valor != null
      ? String(dados.situacao.valor)
      : dados.situacao?.id != null
        ? String(dados.situacao.id)
        : null;
  if (situacao && situacao !== pedido.bling_situacao) {
    await pool.query(
      `UPDATE canastra.pedidos
          SET bling_situacao = $1, atualizado_em = now()
        WHERE pedido_id = $2::uuid`,
      [situacao, pedidoId],
    );
  }

  // Extração defensiva: o rastreio mora em transporte.volumes[].codigoRastreamento.
  const volumes = Array.isArray(dados.transporte?.volumes)
    ? dados.transporte.volumes
    : [];
  const rastreio =
    volumes
      .map((v) => v?.codigoRastreamento || v?.codigo_rastreamento)
      .find((c) => typeof c === "string" && c.trim()) || null;

  if (!rastreio || rastreio === pedido.tracking_code) {
    return { rastreio: pedido.tracking_code || rastreio, pedido: await pedidoParaResposta(pedidoId) };
  }

  if (STATUS_PRE_ENVIO.includes(pedido.status)) {
    /**
     * A TRANSIÇÃO É CONDICIONAL, E É O QUE IMPEDE O E-MAIL DOBRADO.
     *
     * Duas rodadas do cron podem se sobrepor (uma rodada lenta ainda em voo
     * quando a seguinte começa, no minuto 30 da hora seguinte): as duas leem o
     * pedido 'aprovado' sem código, as duas veem o mesmo rastreio no Bling, e
     * com um UPDATE cego as duas mandavam o e-mail de "enviado" — o cliente
     * recebendo o mesmo aviso duas vezes, o que na loja anterior era motivo de
     * ticket. Com `status = ANY(pré-envio)` no WHERE, só UMA das duas move o
     * pedido; a outra recebe `rowCount = 0` e sabe que não tem e-mail a
     * mandar. É a mesma lógica do `avancarStatusInicial` do ordersRepository
     * contra a corrida checkout/webhook.
     *
     * O UPDATE mora aqui, e não em `OrderRepository.updateOrderStatus`, porque
     * aquele é incondicional por contrato (o painel PRECISA poder forçar
     * status) — condicioná-lo mudaria o comportamento de quem já o usa.
     */
    const avanco = await pool.query(
      `UPDATE canastra.pedidos
          SET status = 'enviado',
              codigo_rastreio = $1,
              atualizado_em = now()
        WHERE pedido_id = $2::uuid
          AND status = ANY($3::text[])
      RETURNING pedido_id AS order_id, user_id, total AS total_amount,
                status, codigo_rastreio AS tracking_code`,
      [rastreio, pedidoId, STATUS_PRE_ENVIO],
    );

    if (avanco.rowCount === 1) {
      // O e-mail é o de sempre, com o código dentro; falha dele nunca desfaz a
      // transição (sendStatusEmail já engole e loga por contrato próprio).
      await sendStatusEmail(avanco.rows[0], "enviado", rastreio);
      console.log(
        `Bling: rastreio ${rastreio} trazido para o pedido ${pedidoId} (agora 'enviado').`,
      );
    } else {
      console.log(
        `Bling: o pedido ${pedidoId} saiu do pré-envio entre a leitura e a ` +
          "gravação (outra rodada chegou primeiro) — sem e-mail repetido.",
      );
    }
  } else {
    // Já 'enviado'/'entregue' (ou cancelado): só o código, sem mexer no
    // status e sem e-mail repetido.
    await pool.query(
      `UPDATE canastra.pedidos
          SET codigo_rastreio = $1, atualizado_em = now()
        WHERE pedido_id = $2::uuid`,
      [rastreio, pedidoId],
    );
  }

  return { rastreio, pedido: await pedidoParaResposta(pedidoId) };
}

/**
 * Disparos em voo do gatilho, para os testes conseguirem esperar o efeito de
 * um trabalho deliberadamente fora da resposta HTTP. Costura de teste, e só
 * isso: produção nunca espera por eles.
 */
const disparosEmVoo = new Set();

async function aguardarDisparos() {
  while (disparosEmVoo.size > 0) {
    await Promise.allSettled([...disparosEmVoo]);
  }
}

/**
 * O GATILHO: chamado pelo PaymentController quando um pedido entra em
 * 'aprovado' (resposta síncrona OU webhook), SEMPRE depois do commit.
 *
 * Não bloqueante por contrato — devolve imediatamente e o trabalho corre em
 * Promise.resolve().then(...) com catch logado (o padrão dos e-mails): um
 * Bling fora do ar não pode atrasar nem derrubar a resposta de um pagamento
 * que já aconteceu. Só age com BLING_ATIVO=true literal (decisão 5 do plano
 * mestre: integração desligada por padrão); com BLING_NFE_AUTO=true a NF-e
 * sai emendada na sincronização.
 */
function aoAprovarPedido(pedidoId) {
  if (process.env.BLING_ATIVO !== "true") return null;

  const disparo = Promise.resolve()
    .then(() => sincronizarPedido(pedidoId))
    .then((resultado) => {
      if (process.env.BLING_NFE_AUTO === "true") {
        return emitirNfe(pedidoId);
      }
      return resultado;
    })
    .catch((erro) => {
      // A regra de ouro da onda: log + campo nulo, nunca erro no fluxo de
      // pagamento. O pedido segue 'aprovado' na loja; o painel ressincroniza.
      console.error(
        `BLING: pedido ${pedidoId} não sincronizou (o pedido segue normal na loja): ${erro.message}`,
      );
    });

  disparosEmVoo.add(disparo);
  disparo.finally(() => disparosEmVoo.delete(disparo));
  return disparo;
}

/**
 * Uma rodada do cron de rastreio: todo pedido sincronizado, sem código local
 * e com menos de 60 dias (a mesma lógica da janela de 7 dias do abandono:
 * religar o cron depois de meses não pode sair consultando arqueologia).
 * Falha de UM pedido não derruba a rodada — cada consulta tem catch próprio.
 */
async function rodadaDeRastreio() {
  const { rows } = await pool.query(
    `SELECT pedido_id FROM canastra.pedidos
      WHERE bling_id IS NOT NULL
        AND codigo_rastreio IS NULL
        AND status IN ('aprovado', 'enviado')
        AND criado_em > now() - interval '60 days'
      ORDER BY criado_em`,
  );

  let atualizados = 0;
  for (const { pedido_id } of rows) {
    try {
      const { rastreio } = await consultarRastreio(pedido_id);
      if (rastreio) atualizados += 1;
    } catch (erro) {
      console.error(
        `Bling: consulta de rastreio do pedido ${pedido_id} falhou:`,
        erro.message,
      );
    }
  }
  return { candidatos: rows.length, atualizados };
}

/**
 * Liga o cron de rastreio, de hora em hora. Chamado SÓ pelo index.js, SÓ com
 * BLING_ATIVO=true e BLING_RASTREIO_CRON=true (padrão do job de abandono —
 * ver iniciarCronDeAbandono). Minuto 30 de propósito: o job de abandono roda
 * no minuto 0, e não há motivo para os dois disputarem o pool juntos.
 */
function iniciarCronBling() {
  const cron = require("node-cron");
  cron.schedule("30 * * * *", () => {
    rodadaDeRastreio()
      .then(({ candidatos, atualizados }) => {
        if (candidatos > 0) {
          console.log(
            `Bling: rastreio — ${atualizados}/${candidatos} pedido(s) atualizados.`,
          );
        }
      })
      .catch((erro) => {
        console.error("Bling: rodada de rastreio falhou:", erro.message);
      });
  });
  console.log(
    "Bling: cron de rastreio LIGADO (consulta de hora em hora, pedidos dos últimos 60 dias).",
  );
}

module.exports = {
  sincronizarPedido,
  emitirNfe,
  consultarRastreio,
  aoAprovarPedido,
  aguardarDisparos,
  rodadaDeRastreio,
  iniciarCronBling,
  STATUS_QUE_SINCRONIZAM,
};
