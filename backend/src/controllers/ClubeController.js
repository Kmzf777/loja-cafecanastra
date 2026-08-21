"use strict";

/**
 * Clube da Canastra — assinatura recorrente sobre a API de preapproval do
 * Mercado Pago (Onda 3J; plano em docs/superpowers/plans/2026-08-20-clube-assinatura.md).
 *
 * O DESENHO EM UMA FRASE: a adesão CONGELA tudo (sku, quantidade, preço com os
 * 10% do Clube, endereço) em `canastra.assinaturas`; o MP cobra esse valor
 * fixo a cada ciclo e notifica o webhook DE ASSINATURAS, que transforma cada
 * cobrança num pedido normal em `canastra.pedidos` — a partir daí o fluxo do
 * gestor (painel, e-mail, envio) é o mesmo de uma venda avulsa.
 *
 * POR QUE UM WEBHOOK SEPARADO (`/webhook/mercadopago/assinaturas`): a
 * `notification_url` vai POR PREAPPROVAL, então tudo que é daquela assinatura
 * (evento do preapproval E o payment de cada cobrança) chega aqui, e o webhook
 * de pagamentos avulsos (`/webhook/mercadopago`, PaymentController) não
 * precisa aprender a distinguir os dois mundos. A validação HMAC é a MESMA —
 * `validarAssinaturaWebhook` é importada de lá, não copiada: duas cópias do
 * mesmo validador divergem na primeira correção.
 *
 * O QUE ESTE MÓDULO EXPORTA ALÉM DOS HANDLERS: `cancelarAssinaturasDoTitular`,
 * o cancelamento por DONO (MP + banco) que a exclusão de conta da LGPD chama
 * antes de apagar o cadastro — a 0015 fala desse fluxo no comentário do
 * `ON DELETE SET NULL`, e o contrato dele está no cabeçalho da própria função.
 *
 * O SDK É INSTANCIADO AQUI, e não em config/mercadopago.js, de propósito:
 * aquele módulo exporta só `payment` (o que o checkout usa) e é território de
 * outras ondas. `PreApproval` e `Payment` saem do mesmo `require("mercadopago")`
 * com o mesmo MP_ACCESS_TOKEN — nada de credencial nova.
 */

const { v4: uuidv4 } = require("uuid");
const { MercadoPagoConfig, PreApproval, Payment } = require("mercadopago");
const pool = require("../pgPool");
const OrderRepository = require("../repositories/ordersRepository");
// Exportada por PaymentController desde a F4 ("Exportados para teste") — o
// import reaproveita o validador sem editar aquele arquivo.
const { validarAssinaturaWebhook } = require("./PaymentController");
const { GRUPO_ATIVO, traduzirStatusMp } = require("../utils/statusDePedido");
// A movimentação de estoque de uma transição de status é a MESMA do webhook de
// pagamentos avulsos — mora em utils/estoque.js para um status novo em GRUPO_*
// não precisar ser corrigido em dois controllers (revisão da 3J).
const { lerItensDoPedido, aplicarTransicaoDeEstoque } = require("../utils/estoque");
const {
  sendStatusEmail,
  sendAdminNewOrderEmail,
  sendAdminClubeSemEstoqueEmail,
} = require("../utils/emailSender");

const clienteMp = new MercadoPagoConfig({
  accessToken: process.env.MP_ACCESS_TOKEN,
  options: { timeout: 5000 },
});
const preapproval = new PreApproval(clienteMp);
const pagamentoDoMp = new Payment(clienteMp);

const FORMATO_UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** As três frequências do Clube (estetica.md §7.4) — o CHECK da 0015 é o juiz. */
const FREQUENCIAS_DIAS = [15, 30, 45];

/** O desconto do Clube. Aplicado SEMPRE no servidor, nunca aceito do navegador. */
const DESCONTO_DO_CLUBE = 0.1;

/** Teto de pacotes por envio — o mesmo teto do stepper da vitrine. */
const QUANTIDADE_MAXIMA = 20;

/**
 * Status do preapproval do MP -> vocabulário da loja (CHECK da 0015).
 * `pending` mapeia para o próprio estado inicial; o resto é transição.
 */
const DE_STATUS_PREAPPROVAL = Object.freeze({
  pending: "pendente",
  authorized: "ativa",
  paused: "pausada",
  cancelled: "cancelada",
});

/** A projeção que as listagens e o assinar devolvem. */
const COLUNAS_DA_ASSINATURA = `
  a.id, a.sku, a.quantidade, a.frequencia_dias, a.preco_centavos,
  a.status, a.criado_em, a.atualizado_em, a.cancelada_em
`;

const CAMPOS_DO_ENDERECO = [
  "zip_code",
  "street",
  "number",
  "complement",
  "neighborhood",
  "city",
  "state",
];
const OBRIGATORIOS_DO_ENDERECO = ["zip_code", "street", "number", "city", "state"];

/**
 * Só os campos conhecidos, como texto aparado e com teto de tamanho — o JSON
 * vai para o banco e reaparece em todo pedido recorrente; deixar o corpo
 * gravar chaves arbitrárias seria armazenamento grátis para quem POSTar lixo.
 * Devolve `null` quando falta campo obrigatório.
 */
function higienizarEndereco(bruto) {
  if (typeof bruto !== "object" || bruto === null) return null;
  const endereco = {};
  for (const campo of CAMPOS_DO_ENDERECO) {
    const valor = bruto[campo];
    endereco[campo] = typeof valor === "string" ? valor.trim().slice(0, 200) : "";
  }
  for (const campo of OBRIGATORIOS_DO_ENDERECO) {
    if (!endereco[campo]) return null;
  }
  return endereco;
}

/**
 * A URL do webhook DE ASSINATURAS, derivada da WEBHOOK_URL existente trocando
 * o path — uma variável só para os dois webhooks, e a separação continua
 * sendo de rota, não de configuração. Sem WEBHOOK_URL (desenvolvimento sem
 * túnel), o preapproval nasce sem notification_url e o MP simplesmente não
 * notifica — o mesmo comportamento do checkout avulso.
 */
function urlDoWebhookDeAssinaturas() {
  const base = process.env.WEBHOOK_URL;
  if (!base) return undefined;
  try {
    const url = new URL(base);
    url.pathname = "/webhook/mercadopago/assinaturas";
    url.search = "";
    return url.toString();
  } catch {
    console.warn(`WEBHOOK_URL ilegível ("${base}"); preapproval sem notification_url.`);
    return undefined;
  }
}

/** `LOJA_URL/account?assinatura=confirmada` — para onde o MP devolve o cliente. */
function urlDeRetorno() {
  const base = (process.env.LOJA_URL || "").replace(/\/+$/, "");
  return base ? `${base}/account?assinatura=confirmada` : undefined;
}

/** E-mail do pagador: o claim do token quando veio, senão o GoTrue. */
async function emailDoCliente(req) {
  if (req.user?.email) return req.user.email;
  const { rows } = await pool.query(
    "SELECT email FROM auth.users WHERE id = $1::uuid",
    [req.user.userId],
  );
  return rows.length ? rows[0].email : null;
}

/** O catch padrão dos handlers — mesmo contrato de erro do PaymentController. */
function responderErro(res, error, contexto) {
  console.error(`Erro no Clube (${contexto}):`, error);
  const statusCode = error.status || 500;
  const publico =
    statusCode < 500
      ? error.message
      : "Não foi possível concluir agora. Tente novamente.";
  return res
    .status(statusCode)
    .json({ error: error.codigoPublico || "Falha na assinatura", details: publico });
}

function erroDeEntrada(mensagem) {
  const erro = new Error(mensagem);
  erro.status = 400;
  return erro;
}

/* --------------------------------------------------------------------------
 * POST /clube/assinar
 * -------------------------------------------------------------------------- */

async function assinar(req, res) {
  // Preenchido conforme o fluxo avança; o catch decide o que desfazer.
  let assinaturaId = null;
  try {
    const { sku, quantidade, frequenciaDias, endereco } = req.body || {};
    const userId = req.user?.userId;

    if (typeof sku !== "string" || !sku.trim() || sku.length > 64) {
      throw erroDeEntrada("Café inválido.");
    }
    const qtd = Number(quantidade);
    if (!Number.isInteger(qtd) || qtd < 1 || qtd > QUANTIDADE_MAXIMA) {
      throw erroDeEntrada("Quantidade inválida.");
    }
    const frequencia = Number(frequenciaDias);
    if (!FREQUENCIAS_DIAS.includes(frequencia)) {
      throw erroDeEntrada("Frequência inválida: escolha 15, 30 ou 45 dias.");
    }
    const enderecoLimpo = higienizarEndereco(endereco);
    if (!enderecoLimpo) {
      throw erroDeEntrada(
        "Endereço incompleto: a entrega recorrente precisa de CEP, rua, número, cidade e estado.",
      );
    }

    /**
     * O PREÇO É DO BANCO, E O DESCONTO É DO SERVIDOR. O navegador exibe o
     * -10% por cortesia; o que vale é o cálculo daqui sobre o preço atual do
     * catálogo, congelado a partir deste ponto — reajuste futuro não alcança
     * assinatura viva (é a promessa de "preço travado" dos termos).
     *
     * A CONTA É EM CENTAVOS INTEIROS, e isso não é preciosismo: a versão
     * anterior fazia `round(preco_reais * 0.9 * 100)` e o binário do float
     * cobrava UM CENTAVO A MENOS que a etiqueta em 947 de 200.000 preços
     * (R$ 16,15 → 1453 aqui, 1454 na vitrine). Convertendo o preço a centavos
     * ANTES do desconto, os dois lados executam literalmente
     * `round(centavos * 0.9)` — a mesma expressão, o mesmo número, sempre
     * (frontend/lib/clube.ts + clube.test.ts varrem a faixa provando).
     */
    const { rows: produtos } = await pool.query(
      `SELECT produto_id, nome, preco FROM canastra.produtos
        WHERE sku = $1 LIMIT 1`,
      [sku.trim()],
    );
    if (!produtos.length || !(Number(produtos[0].preco) > 0)) {
      throw erroDeEntrada("Este café não está disponível para assinatura.");
    }
    const produto = produtos[0];
    const catalogoCentavos = Math.round(Number(produto.preco) * 100);
    const unidadeCentavos = Math.round(catalogoCentavos * (1 - DESCONTO_DO_CLUBE));
    const precoCentavos = unidadeCentavos * qtd;
    if (!(precoCentavos > 0)) {
      throw erroDeEntrada("Este café não está disponível para assinatura.");
    }

    const payerEmail = await emailDoCliente(req);
    if (!payerEmail) {
      throw erroDeEntrada("Sua conta está sem e-mail; não dá para assinar.");
    }

    /**
     * A linha nasce ANTES da ida ao MP porque o preapproval carrega
     * `external_reference` = id da assinatura — é o fio que liga cada
     * notificação de volta a esta linha. Falha do MP remove a linha logo
     * abaixo: pendente sem preapproval é órfã que nenhum webhook alcança.
     */
    assinaturaId = uuidv4();
    await pool.query(
      `INSERT INTO canastra.assinaturas
         (id, user_id, sku, quantidade, frequencia_dias, preco_centavos, endereco_json)
       VALUES ($1::uuid, $2::uuid, $3, $4, $5, $6, $7::jsonb)`,
      [
        assinaturaId,
        userId,
        sku.trim(),
        qtd,
        frequencia,
        precoCentavos,
        JSON.stringify(enderecoLimpo),
      ],
    );

    const backUrl = urlDeRetorno();
    const notificationUrl = urlDoWebhookDeAssinaturas();

    let respostaMp;
    try {
      respostaMp = await preapproval.create({
        body: {
          reason: `Clube da Canastra — ${produto.nome}`,
          external_reference: assinaturaId,
          payer_email: payerEmail,
          auto_recurring: {
            frequency: frequencia,
            frequency_type: "days",
            transaction_amount: precoCentavos / 100,
            currency_id: "BRL",
          },
          ...(backUrl ? { back_url: backUrl } : {}),
          ...(notificationUrl ? { notification_url: notificationUrl } : {}),
          status: "pending",
        },
      });
    } catch (falhaNoMp) {
      // Sem preapproval não há assinatura: a linha sai e o cliente recebe uma
      // frase de verdade em vez de uma pendente eterna.
      await pool
        .query("DELETE FROM canastra.assinaturas WHERE id = $1::uuid", [assinaturaId])
        .catch((e) =>
          console.error(`Clube: falha ao remover a assinatura órfã ${assinaturaId}:`, e.message),
        );
      assinaturaId = null;
      console.error("Clube: o MP recusou a criação do preapproval:", falhaNoMp.message);
      const erro = new Error(
        "Não foi possível criar a assinatura no Mercado Pago agora. Tente novamente em instantes.",
      );
      erro.status = 502;
      throw erro;
    }

    const { rows: atualizada } = await pool.query(
      `UPDATE canastra.assinaturas
          SET preapproval_id = $1, atualizado_em = now()
        WHERE id = $2::uuid
        RETURNING id, sku, quantidade, frequencia_dias, preco_centavos, status`,
      [String(respostaMp.id), assinaturaId],
    );

    // `init_point` é a URL de aprovação: é LÁ que o cliente autoriza a
    // cobrança recorrente no MP. Sem redirecionar, a assinatura fica pendente.
    return res.status(201).json({
      assinatura: atualizada[0],
      initPoint: respostaMp.init_point,
    });
  } catch (error) {
    return responderErro(res, error, "assinar");
  }
}

/* --------------------------------------------------------------------------
 * Webhook de assinaturas
 * -------------------------------------------------------------------------- */

/**
 * Evento do PREAPPROVAL (autorizou, pausou, cancelou). O status NUNCA vem do
 * corpo da notificação: é relido na API — mesma regra do webhook de
 * pagamentos, mesmo motivo (o corpo é forjável; a API não).
 *
 * DOIS CAMINHOS ATÉ A LINHA, e o segundo existe por uma falha real: se o
 * UPDATE que grava `preapproval_id` não acontecer depois de o MP criar o
 * preapproval (banco piscou entre a criação e a gravação), a busca pelo
 * `preapproval_id` não acha NADA e todo evento daquela assinatura viraria 404
 * para sempre — e o cancelamento pularia o MP, deixando a cobrança viva. Por
 * isso a queda para o `external_reference` (que é o id da assinatura, posto no
 * preapproval na criação) e a regravação do vínculo na MESMA transação: o
 * primeiro evento que chegar CURA a linha.
 */
async function aplicarEventoDePreapproval(preapprovalId, res) {
  let statusMp;
  let referencia = "";
  try {
    const lido = await preapproval.get({ id: String(preapprovalId) });
    statusMp = lido.status;
    referencia = String(lido.external_reference || "");
  } catch (erro) {
    console.error(
      `Webhook assinaturas: falha ao reler o preapproval ${preapprovalId} no MP:`,
      erro.message,
    );
    return res.sendStatus(500); // o MP reenvia
  }

  const statusLocal = DE_STATUS_PREAPPROVAL[String(statusMp || "").toLowerCase()];
  if (!statusLocal) {
    console.warn(
      `Webhook assinaturas: status de preapproval sem tradução ("${statusMp}") — reconhecido e ignorado.`,
    );
    return res.sendStatus(200);
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    // FOR UPDATE: duas notificações do mesmo preapproval serializam e a
    // segunda enxerga o status que a primeira commitou — transição uma vez só.
    let { rows } = await client.query(
      `SELECT id, status FROM canastra.assinaturas
        WHERE preapproval_id = $1 FOR UPDATE`,
      [String(preapprovalId)],
    );

    /**
     * O vínculo perdido: acha pela referência e REGRAVA o preapproval_id aqui
     * dentro, para o próximo evento (e o cancelamento) já irem pelo caminho
     * curto. `FORMATO_UUID` antes do ::uuid — a referência vem do MP e um
     * texto qualquer estouraria 22P02 e viraria 500 em retry infinito.
     *
     * `preapproval_id IS NULL` no WHERE: só se cura o que está SEM vínculo.
     * Uma linha que já aponta para outro preapproval não é "a mesma
     * assinatura vista de outro ângulo" — é um evento que não bate com o que
     * a loja sabe, e sobrescrever ali trocaria o alvo do cancelamento.
     */
    if (!rows.length && FORMATO_UUID.test(referencia)) {
      ({ rows } = await client.query(
        `SELECT id, status FROM canastra.assinaturas
          WHERE id = $1::uuid AND preapproval_id IS NULL FOR UPDATE`,
        [referencia],
      ));
      if (rows.length) {
        await client.query(
          `UPDATE canastra.assinaturas
              SET preapproval_id = $1, atualizado_em = now()
            WHERE id = $2::uuid`,
          [String(preapprovalId), rows[0].id],
        );
        console.warn(
          `Clube: assinatura ${rows[0].id} estava sem preapproval_id; ` +
            `vínculo com ${preapprovalId} regravado pelo webhook.`,
        );
      }
    }

    if (!rows.length) {
      await client.query("ROLLBACK");
      console.warn(
        `Webhook assinaturas: nenhum registro para o preapproval ${preapprovalId}.`,
      );
      return res.sendStatus(404);
    }

    if (rows[0].status !== statusLocal) {
      await client.query(
        `UPDATE canastra.assinaturas
            SET status = $1,
                atualizado_em = now(),
                cancelada_em = CASE WHEN $1 = 'cancelada' THEN now() ELSE cancelada_em END
          WHERE id = $2::uuid`,
        [statusLocal, rows[0].id],
      );
      console.log(
        `Clube: assinatura ${rows[0].id} passou a "${statusLocal}" (preapproval ${preapprovalId}).`,
      );
    }
    await client.query("COMMIT");
  } catch (erro) {
    await client.query("ROLLBACK").catch(() => {});
    console.error("Erro no webhook de assinaturas (preapproval):", erro);
    return res.sendStatus(500);
  } finally {
    client.release();
  }

  return res.sendStatus(200);
}

/**
 * A assinatura dona de uma cobrança: primeiro pelo preapproval, depois pela
 * referência (o id da assinatura, que o preapproval carrega desde a criação).
 *
 * Quando é a REFERÊNCIA que acha e a linha está sem `preapproval_id`, o
 * vínculo é regravado — mesmo self-healing de `aplicarEventoDePreapproval` e
 * pelo mesmo motivo: uma linha sem preapproval nunca mais receberia evento de
 * ciclo de vida e o cancelamento pularia o MP, deixando a cobrança viva.
 */
async function assinaturaDaCobranca(pagamento) {
  const preapprovalId =
    pagamento?.metadata?.preapproval_id || pagamento?.preapproval_id || null;
  if (preapprovalId) {
    const { rows } = await pool.query(
      "SELECT * FROM canastra.assinaturas WHERE preapproval_id = $1 LIMIT 1",
      [String(preapprovalId)],
    );
    if (rows.length) return rows[0];
  }
  const referencia = String(pagamento?.external_reference || "");
  if (FORMATO_UUID.test(referencia)) {
    const { rows } = await pool.query(
      "SELECT * FROM canastra.assinaturas WHERE id = $1::uuid LIMIT 1",
      [referencia],
    );
    if (rows.length) {
      const achada = rows[0];
      if (preapprovalId && !achada.preapproval_id) {
        const { rows: curadas } = await pool.query(
          `UPDATE canastra.assinaturas
              SET preapproval_id = $1, atualizado_em = now()
            WHERE id = $2::uuid AND preapproval_id IS NULL
            RETURNING preapproval_id`,
          [String(preapprovalId), achada.id],
        );
        if (curadas.length) {
          achada.preapproval_id = curadas[0].preapproval_id;
          console.warn(
            `Clube: assinatura ${achada.id} estava sem preapproval_id; ` +
              `vínculo com ${preapprovalId} regravado pela cobrança.`,
          );
        }
      }
      return achada;
    }
  }
  return null;
}

/**
 * COBRANÇA DA ASSINATURA -> PEDIDO. É a peça que faz o café SAIR: o gestor
 * trabalha pela tela de pedidos, então cada débito recorrente precisa
 * aparecer lá como um pedido normal, com os dados CONGELADOS da adesão.
 *
 * Idempotência em duas camadas, as duas de banco: o índice único de
 * `pagamento_id_mp` (0005) barra o segundo INSERT da mesma cobrança, e a
 * `chave_idempotencia` própria (`assinatura:<id>:<paymentId>`) barra qualquer
 * caminho futuro que esqueça o id do MP.
 */
async function aplicarCobranca(paymentId, res) {
  let pagamento;
  try {
    pagamento = await pagamentoDoMp.get({ id: paymentId });
  } catch (erro) {
    console.error(
      `Webhook assinaturas: falha ao reler o pagamento ${paymentId} no MP:`,
      erro.message,
    );
    return res.sendStatus(500);
  }

  const statusPt = traduzirStatusMp(pagamento.status);
  if (!statusPt) {
    console.warn(
      `Webhook assinaturas: pagamento ${paymentId} com status sem tradução ("${pagamento.status}") — ignorado.`,
    );
    return res.sendStatus(200);
  }

  let assinatura;
  try {
    assinatura = await assinaturaDaCobranca(pagamento);
  } catch (erro) {
    console.error("Webhook assinaturas: falha ao buscar a assinatura da cobrança:", erro);
    return res.sendStatus(500);
  }
  if (!assinatura) {
    // Sem assinatura não há o que criar, e o retry do MP não mudaria isso —
    // 200 com o rastro GRITADO no log para conferência manual.
    console.error(
      `CLUBE: cobrança ${paymentId} sem assinatura correspondente ` +
        `(metadata.preapproval_id="${pagamento?.metadata?.preapproval_id ?? ""}", ` +
        `external_reference="${pagamento?.external_reference ?? ""}"). Confira no painel do MP.`,
    );
    return res.sendStatus(200);
  }

  /**
   * JÁ EXISTE PEDIDO PARA ESTA COBRANÇA? Então isto é transição de status
   * (aprovado→reembolsado, por exemplo), com a mesma disciplina do webhook de
   * pagamentos: FOR UPDATE no pedido, estoque movimenta UMA vez na MESMA
   * transação, reenvio idêntico não produz efeito.
   */
  const client = await pool.connect();
  let pedidoExistente;
  let mudou = false;
  try {
    await client.query("BEGIN");
    pedidoExistente = await OrderRepository.lockOrderByPaymentId(
      String(paymentId),
      client,
    );

    if (pedidoExistente) {
      if (pedidoExistente.status !== statusPt) {
        // A MESMA movimentação do webhook de pagamentos avulsos, do MESMO
        // módulo (utils/estoque.js): ativo→cancelado devolve, cancelado→ativo
        // rebaixa com GREATEST(0, ...), em ordem canônica, na MESMA transação
        // que grava o status. Item ilegível fica no log em vez de sumir.
        await aplicarTransicaoDeEstoque(
          client,
          lerItensDoPedido(pedidoExistente.items, "Webhook assinaturas"),
          pedidoExistente.status,
          statusPt,
        );

        await OrderRepository.updateOrderStatus(
          pedidoExistente.order_id,
          statusPt,
          null,
          client,
        );
        mudou = true;
      }
      await client.query("COMMIT");
    } else {
      await client.query("ROLLBACK");
    }
  } catch (erro) {
    await client.query("ROLLBACK").catch(() => {});
    console.error("Erro no webhook de assinaturas (transição de cobrança):", erro);
    return res.sendStatus(500);
  } finally {
    client.release();
  }

  if (pedidoExistente) {
    if (mudou) {
      sendStatusEmail(pedidoExistente, statusPt).catch((e) =>
        console.error("Falha ao enviar e-mail de status do Clube:", e.message),
      );
    }
    return res.sendStatus(200);
  }

  /**
   * PEDIDO NOVO. A baixa de estoque vem ANTES do INSERT (FOR UPDATE +
   * `quantidade >= $1`, como no checkout) e é TUDO-OU-NADA — mas, diferente
   * do checkout, estoque insuficiente NÃO aborta: a cobrança JÁ aconteceu, e
   * um débito sem pedido é dinheiro do cliente sumindo da operação. O pedido
   * nasce mesmo assim e o rombo fica gritado no log.
   *
   * O AVISO AO GESTOR É UM E-MAIL PRÓPRIO (`sendAdminClubeSemEstoqueEmail`),
   * não o "Novo Pedido Recebido" de sempre: o pedido nasce "aprovado" e, na
   * caixa de entrada, seria indistinguível de um pedido com o café já
   * separado — exatamente o e-mail que ninguém abre com pressa. O assunto diz
   * que falta café e o corpo traz SKU e quantidade, porque a decisão (torrar
   * mais ou estornar no painel do MP) é humana, não do webhook.
   */
  let produto = null;
  let estoqueBaixado = false;
  // Só cobrança que vale venda tira café da prateleira; uma cobrança pendente
  // ou recusada não deve baixar nada — e, por isso, também não é rombo.
  const precisavaBaixar = GRUPO_ATIVO.includes(statusPt);
  let motivoSemCafe = null;
  const clienteDaBaixa = await pool.connect();
  try {
    await clienteDaBaixa.query("BEGIN");
    const { rows } = await clienteDaBaixa.query(
      `SELECT produto_id, nome, imagem FROM canastra.produtos
        WHERE sku = $1 LIMIT 1 FOR UPDATE`,
      [assinatura.sku],
    );
    produto = rows[0] ?? null;

    if (produto && precisavaBaixar) {
      const baixa = await clienteDaBaixa.query(
        `UPDATE canastra.produtos
            SET quantidade = quantidade - $1
          WHERE produto_id = $2 AND quantidade >= $1`,
        [assinatura.quantidade, produto.produto_id],
      );
      estoqueBaixado = baixa.rowCount > 0;
      if (!estoqueBaixado) {
        motivoSemCafe =
          `Estoque insuficiente: a prateleira não tinha ${assinatura.quantidade} ` +
          `unidade(s) do SKU ${assinatura.sku} na hora da cobrança.`;
        console.error(
          `CLUBE: ESTOQUE INSUFICIENTE para a cobrança ${paymentId} ` +
            `(${assinatura.quantidade}x ${assinatura.sku}). O pedido será criado ` +
            "mesmo assim — separe o café ou estorne no painel do MP.",
        );
      }
    } else if (!produto) {
      if (precisavaBaixar) {
        motivoSemCafe =
          `O SKU ${assinatura.sku} não está mais no catálogo: não há linha de ` +
          "produto para dar baixa nem preço de reposição.";
      }
      console.error(
        `CLUBE: o sku "${assinatura.sku}" da assinatura ${assinatura.id} não está ` +
          `mais no catálogo; a cobrança ${paymentId} vira pedido sem baixa de estoque.`,
      );
    }
    await clienteDaBaixa.query("COMMIT");
  } catch (erro) {
    await clienteDaBaixa.query("ROLLBACK").catch(() => {});
    console.error("Erro na baixa de estoque da cobrança do Clube:", erro);
    return res.sendStatus(500);
  } finally {
    clienteDaBaixa.release();
  }

  // Preço unitário CONGELADO: preco_centavos é o total do envio.
  const unidadeCentavos = Math.round(
    assinatura.preco_centavos / assinatura.quantidade,
  );
  const itens = [
    {
      product_id: produto ? produto.produto_id : null,
      name: `${produto ? produto.nome : assinatura.sku} — Clube da Canastra`,
      image: produto ? produto.imagem : null,
      price: unidadeCentavos / 100,
      quantity: assinatura.quantidade,
      sku: assinatura.sku,
    },
  ];

  let pedido;
  try {
    pedido = await OrderRepository.createOrder({
      userId: assinatura.user_id,
      totalAmount: assinatura.preco_centavos / 100,
      items: itens,
      paymentMethod:
        pagamento.payment_type_id || pagamento.payment_method_id || "assinatura",
      paymentIdMp: String(paymentId),
      address_json: assinatura.endereco_json,
      // O valor do Clube já inclui a entrega (não há como recotar frete num
      // débito automático) — decisão documentada no plano e nos termos.
      shippingCost: 0,
      shippingMethod: "Clube da Canastra",
      chaveIdempotencia: `assinatura:${assinatura.id}:${paymentId}`,
      status: statusPt,
    });
  } catch (erroDeInsert) {
    // Compensação: a baixa commitou e o pedido não existe.
    if (estoqueBaixado && produto) {
      await pool
        .query(
          "UPDATE canastra.produtos SET quantidade = quantidade + $1 WHERE produto_id = $2",
          [assinatura.quantidade, produto.produto_id],
        )
        .catch((e) =>
          console.error("CLUBE: falha ao devolver a baixa compensada:", e.message),
        );
    }
    if (erroDeInsert.code === "23505") {
      // Corrida de reenvio: outra notificação idêntica criou o pedido entre a
      // checagem e o INSERT. O trabalho já está feito; 200.
      console.log(
        `Clube: cobrança ${paymentId} já tinha pedido (corrida de reenvio) — nada a fazer.`,
      );
      return res.sendStatus(200);
    }
    console.error(
      `CLUBE: cobrança ${paymentId} SEM pedido gravado (assinatura ${assinatura.id}). ` +
        `O MP vai reenviar. Causa: ${erroDeInsert.message}`,
    );
    return res.sendStatus(500);
  }

  console.log(
    `📦 Clube: cobrança ${paymentId} virou o pedido ${pedido.order_id} (${statusPt}).`,
  );

  // E-mails são efeito colateral: provedor fora não pode virar retry do MP de
  // uma cobrança já registrada.
  //
  // O gestor recebe UM dos dois: o "Novo Pedido Recebido" de sempre quando o
  // café saiu da prateleira, ou o alerta de decisão quando não saiu. Mandar os
  // dois enterraria o alerta debaixo do rotineiro.
  Promise.allSettled([
    motivoSemCafe
      ? sendAdminClubeSemEstoqueEmail({
          pedido,
          sku: assinatura.sku,
          quantidade: assinatura.quantidade,
          motivo: motivoSemCafe,
        })
      : sendAdminNewOrderEmail(pedido),
    sendStatusEmail(pedido, statusPt),
  ]).then((r) => {
    r.filter((x) => x.status === "rejected").forEach((x) =>
      console.error("Falha ao enviar e-mail do pedido do Clube:", x.reason?.message),
    );
  });

  return res.sendStatus(200);
}

async function webhook(req, res) {
  // MESMO validador HMAC do webhook de pagamentos (MP_WEBHOOK_SECRET, janela
  // de 5 min, timingSafeEqual) — importado, não copiado.
  if (!validarAssinaturaWebhook(req)) {
    console.warn("Webhook de assinaturas recusado: assinatura inválida.", {
      origem: req.ip,
      requestId: req.headers["x-request-id"],
    });
    return res.sendStatus(401);
  }

  const { type, data } = req.body || {};
  const id = data?.id;
  if (!id) return res.sendStatus(200);

  // Cada cobrança chega como `payment`; o ciclo de vida da assinatura chega
  // como `subscription_preapproval` (o MP também usa o topic legado
  // `preapproval`). `subscription_authorized_payment` é o AGENDAMENTO da
  // cobrança — o dinheiro de verdade vem no `payment`, então é reconhecido e
  // ignorado de propósito, senão cada ciclo geraria dois eventos rivais.
  if (type === "payment") return aplicarCobranca(id, res);
  if (type === "subscription_preapproval" || type === "preapproval") {
    return aplicarEventoDePreapproval(id, res);
  }
  return res.sendStatus(200);
}

/* --------------------------------------------------------------------------
 * Conta do cliente e painel
 * -------------------------------------------------------------------------- */

async function listarDoCliente(req, res) {
  try {
    const { rows } = await pool.query(
      `SELECT ${COLUNAS_DA_ASSINATURA},
              COALESCE(p.nome, a.sku) AS nome_cafe
         FROM canastra.assinaturas a
         LEFT JOIN canastra.produtos p ON p.sku = a.sku
        WHERE a.user_id = $1::uuid
        ORDER BY a.criado_em DESC`,
      [req.user.userId],
    );
    return res.status(200).json(rows);
  } catch (error) {
    return responderErro(res, error, "listarDoCliente");
  }
}

async function listarTodas(req, res) {
  try {
    // LEFT JOIN, não INNER: cliente apagado (LGPD) não some com a assinatura
    // da lista do gestor — mesma lição de getAllOrders.
    const { rows } = await pool.query(
      `SELECT ${COLUNAS_DA_ASSINATURA},
              COALESCE(p.nome, a.sku)              AS nome_cafe,
              COALESCE(c.nome, 'Cliente removido') AS cliente_nome,
              COALESCE(u.email, '—')               AS cliente_email
         FROM canastra.assinaturas a
         LEFT JOIN canastra.clientes c ON c.user_id = a.user_id
         LEFT JOIN auth.users u        ON u.id      = a.user_id
         LEFT JOIN canastra.produtos p ON p.sku     = a.sku
        ORDER BY a.criado_em DESC`,
    );
    return res.status(200).json(rows);
  } catch (error) {
    return responderErro(res, error, "listarTodas");
  }
}

/* --------------------------------------------------------------------------
 * Cancelamento
 * -------------------------------------------------------------------------- */

/** Os status de uma assinatura que ainda pode COBRAR — as que um cancelamento precisa alcançar. */
const STATUS_VIVOS = Object.freeze(["pendente", "ativa", "pausada"]);

/**
 * Cancela o preapproval no MP. Lança com `status = 502` quando o MP recusa —
 * e é por isso que ela é uma função e não uma linha solta: TODO caminho de
 * cancelamento (a rota do cliente e o cancelamento por titular da LGPD) tem
 * de falhar do mesmo jeito, porque marcar "cancelada" no banco com o
 * preapproval vivo lá deixaria o cliente sendo cobrado para sempre.
 */
async function cancelarPreapprovalNoMp(preapprovalId) {
  try {
    await preapproval.update({
      id: preapprovalId,
      body: { status: "cancelled" },
    });
  } catch (falhaNoMp) {
    console.error(
      `Clube: o MP recusou o cancelamento do preapproval ${preapprovalId}:`,
      falhaNoMp.message,
    );
    const erro = new Error(
      "Não foi possível cancelar no Mercado Pago agora. Tente novamente em instantes.",
    );
    erro.status = 502;
    throw erro;
  }
}

/** O UPDATE que fecha uma assinatura localmente, com a projeção das listagens. */
async function marcarCanceladaLocalmente(assinaturaId, executor = pool) {
  const { rows } = await executor.query(
    `UPDATE canastra.assinaturas
        SET status = 'cancelada', cancelada_em = now(), atualizado_em = now()
      WHERE id = $1::uuid
      RETURNING id, sku, quantidade, frequencia_dias, preco_centavos,
                status, criado_em, cancelada_em`,
    [assinaturaId],
  );
  return rows[0] ?? null;
}

/**
 * CANCELA TODAS AS ASSINATURAS VIVAS DE UM TITULAR. Ponto de entrada de OUTRAS
 * ondas — a exclusão de conta (LGPD) chama isto ANTES de apagar o cadastro,
 * porque `assinaturas.user_id` é ON DELETE SET NULL (0015): apagar a conta sem
 * passar por aqui deixaria um preapproval órfão COBRANDO um cartão de alguém
 * que pediu para sumir do banco.
 *
 * CONTRATO
 *   cancelarAssinaturasDoTitular(userId: string) => Promise<string[]>
 *
 *   userId  o uuid do titular (o mesmo de auth.users / clientes.user_id).
 *           Formato inválido lança Error com `status = 400`.
 *   retorno os ids das assinaturas que ESTA chamada fechou, na ordem em que
 *           foram fechadas. Titular sem assinatura viva devolve `[]` — não é
 *           erro, é o caso comum.
 *
 *   Alcança `pendente`, `ativa` e `pausada` (STATUS_VIVOS). A que tem
 *   `preapproval_id` vai ao MP primeiro e só então é marcada localmente
 *   (mesma ordem da rota do cliente, mesmo motivo); a que não tem — pendente
 *   que nunca chegou ao MP — é apenas marcada.
 *
 *   FALHA DO MP LANÇA (Error com `status = 502`), e lança na PRIMEIRA recusa:
 *   o que já foi cancelado antes dela continua cancelado (está no
 *   `erro.canceladas`), e a assinatura que falhou continua VIVA no banco. Não
 *   há transação possível aqui — o MP é rede, não é o Postgres —, então a
 *   função é feita para ser RE-EXECUTADA: a segunda chamada pula o que já
 *   fechou e tenta de novo só o que ficou. Quem chama deve abortar a exclusão
 *   da conta e devolver erro, nunca seguir apagando com cobrança viva.
 */
async function cancelarAssinaturasDoTitular(userId) {
  if (!FORMATO_UUID.test(String(userId || ""))) {
    const erro = new Error("Titular inválido para cancelamento de assinaturas.");
    erro.status = 400;
    throw erro;
  }

  const { rows } = await pool.query(
    `SELECT id, preapproval_id FROM canastra.assinaturas
      WHERE user_id = $1::uuid AND status = ANY($2::text[])
      ORDER BY criado_em`,
    [userId, STATUS_VIVOS],
  );

  const canceladas = [];
  for (const linha of rows) {
    if (linha.preapproval_id) {
      try {
        await cancelarPreapprovalNoMp(linha.preapproval_id);
      } catch (erro) {
        erro.canceladas = canceladas;
        console.error(
          `Clube: o cancelamento das assinaturas do titular ${userId} parou na ` +
            `assinatura ${linha.id} (${canceladas.length} já fechadas).`,
        );
        throw erro;
      }
    }
    await marcarCanceladaLocalmente(linha.id);
    canceladas.push(linha.id);
  }

  if (canceladas.length) {
    console.log(
      `Clube: ${canceladas.length} assinatura(s) do titular ${userId} canceladas.`,
    );
  }
  return canceladas;
}

/* --------------------------------------------------------------------------
 * POST /clube/assinaturas/:id/cancelar
 * -------------------------------------------------------------------------- */

async function cancelar(req, res) {
  try {
    const { id } = req.params;
    const userId = req.user?.userId;

    // 404 também para formato inválido e para assinatura ALHEIA: responder
    // 403 confirmaria a existência do id para quem não é dono.
    if (!FORMATO_UUID.test(String(id || ""))) {
      return res.status(404).json({ error: "Assinatura não encontrada." });
    }
    const { rows } = await pool.query(
      `SELECT id, preapproval_id, status FROM canastra.assinaturas
        WHERE id = $1::uuid AND user_id = $2::uuid`,
      [id, userId],
    );
    if (!rows.length) {
      return res.status(404).json({ error: "Assinatura não encontrada." });
    }
    const linha = rows[0];

    if (linha.status === "cancelada") {
      // Idempotente: cancelar o já cancelado não volta ao MP nem dá erro.
      return res.status(200).json({ assinatura: linha });
    }

    /**
     * PRIMEIRO O MP, DEPOIS O LOCAL — nesta ordem de propósito: uma linha
     * local "cancelada" com o preapproval vivo no MP continuaria COBRANDO o
     * cliente todo ciclo, que é o pior desfecho possível de um cancelamento.
     * Falha no MP → 502 e nada muda aqui; o cliente tenta de novo.
     */
    if (linha.preapproval_id) {
      await cancelarPreapprovalNoMp(linha.preapproval_id);
    }

    return res.status(200).json({ assinatura: await marcarCanceladaLocalmente(id) });
  } catch (error) {
    return responderErro(res, error, "cancelar");
  }
}

module.exports = {
  assinar,
  webhook,
  listarDoCliente,
  listarTodas,
  cancelar,
  // Para OUTRAS ondas (LGPD/exclusão de conta), não para uma rota: ver o
  // contrato no cabeçalho da função.
  cancelarAssinaturasDoTitular,
};
