const { Router } = require("express");
const pool = require("../pgPool");
const isAuthenticated = require("../middleware/isAuthenticated");
const isAdmin = require("../middleware/isAdmin");
const { ehUuid } = require("../utils/formatoUuid");
const { registrar, ACOES, ENTIDADES } = require("../services/adminLog");

/**
 * Atendimento a titular de dados (LGPD art. 18), pelo administrador.
 *
 * Duas operações, e só elas:
 *
 *   GET  /lgpd/titulares/:userId/dados    — direito de ACESSO/PORTABILIDADE
 *       (art. 18, II e V): tudo que a loja guarda sobre a pessoa, em JSON —
 *       conta, cadastro, endereços, pedidos, assinaturas do Clube, avaliações
 *       e a inscrição na newsletter. "Tudo" é literal: ver a lista comentada
 *       em `exportarDadosDoTitular`, que é onde a próxima tabela com dado
 *       pessoal tem de ser acrescentada.
 *   POST /lgpd/titulares/:userId/redigir  — direito de ELIMINAÇÃO PARCIAL
 *       (art. 18, IV/VI) SEM apagar a conta: redige o dado pessoal congelado
 *       nos pedidos (`canastra.redigir_dados_do_titular`, migração 0013),
 *       preservando a venda (registro fiscal) e a estatística por região.
 *
 * A eliminação TOTAL (conta + redação) já existe e não é daqui: é o
 * `DELETE /auth/users/me` (o próprio titular) e o `DELETE /auth/users/:id`
 * (o admin), em conta.routes.js — que agora redigem ANTES de apagar.
 *
 * AMBAS EXIGEM ADMIN, e isso é deliberado: o titular comum não redige os
 * PRÓPRIOS pedidos por aqui porque a função recebe o alvo por parâmetro — a
 * versão self-service segura seria outra rota, lendo `req.user.userId`, e ela
 * não foi pedida (o titular que quer eliminação total já tem o DELETE /me).
 *
 * 404 UNIFORME para quem não é cliente DESTA loja — a mesma cerca de
 * `excluirClientePeloAdmin`: a instância Supabase é compartilhada, e respostas
 * diferentes para "nunca existiu" e "existe no auth.users mas é de outro
 * projeto" fariam deste painel um oráculo sobre as contas alheias.
 *
 * SEM RATE LIMIT PRÓPRIO, e não por esquecimento: diferente das exclusões de
 * conta (que gastam a Admin API do GoTrue da instância compartilhada), tudo
 * aqui é consulta e UPDATE no banco desta loja, atrás de isAuthenticated +
 * isAdmin. O custo de abuso é o de qualquer rota administrativa.
 */
const lgpdRoutes = Router();

/**
 * A MESMA resposta, byte a byte, para "nunca existiu" e "não é desta loja".
 * Constante única para as duas rotas não divergirem por manutenção.
 */
const MENSAGEM_TITULAR_NAO_ENCONTRADO = "Titular não encontrado nesta loja.";

/**
 * O recorte comum das duas rotas: alvo com forma de UUID e com linha em
 * `canastra.clientes`. Devolve `true` se a resposta já foi escrita (recusa).
 */
async function recusarForaDaLoja(req, res, conexao) {
  const { userId } = req.params;
  if (!ehUuid(userId)) {
    res.status(400).json({ message: "Identificador de titular inválido." });
    return true;
  }

  const { rows } = await conexao.query(
    "SELECT EXISTS (SELECT 1 FROM canastra.clientes WHERE user_id = $1) AS eh_cliente",
    [userId],
  );
  if (!rows[0].eh_cliente) {
    res.status(404).json({ message: MENSAGEM_TITULAR_NAO_ENCONTRADO });
    return true;
  }
  return false;
}

/**
 * Exportação dos dados do titular — acesso e portabilidade num JSON só.
 *
 * COMPLETUDE É O REQUISITO, não um detalhe de implementação: esta é a resposta
 * ao direito de acesso (art. 18, II e V), e uma resposta que OMITE tabela é uma
 * resposta errada — a pessoa fica sem saber que a loja guarda aquilo. Então a
 * lista abaixo é a lista de TODA tabela desta loja com dado da pessoa, e quem
 * criar a próxima tem de voltar aqui.
 *
 *   `auth.users` ......... id + e-mail (o shim de teste só tem essas colunas, e
 *                          são as únicas que pertencem à PESSOA e não à
 *                          mecânica de sessão do GoTrue);
 *   `clientes` ........... o cadastro: nome, CPF, telefone;
 *   `enderecos` .......... os endereços salvos;
 *   `pedidos` ............ a venda com a fotografia de entrega;
 *   `assinaturas` ........ o Clube (0015): endereço congelado na adesão, preço,
 *                          frequência e o preapproval do MP;
 *   `avaliacoes` ......... o que a pessoa escreveu na PDP (0014), com o
 *                          `nome_exibicao` congelado — que é PÚBLICO;
 *   `newsletter_inscritos` a inscrição do rodapé (0011). Sem `user_id`: a
 *                          tabela é POR E-MAIL, e o e-mail é justamente o que
 *                          esta exportação acabou de resolver no GoTrue.
 *   `consentimentos` ..... a autorização de contato por canal (0033): quando
 *                          foi dada, de onde veio, com que texto — e quando foi
 *                          revogada. É a resposta a "com base em quê vocês me
 *                          mandaram esta mensagem?", que é exatamente uma
 *                          pergunta de titular. Alcançada por `user_id` OU por
 *                          e-mail: a tabela aceita as duas âncoras (0033), e
 *                          quem consentiu no rodapé sem conta só tem a segunda.
 *   `envios` ............. a mensagem que a loja MANDOU para a pessoa (0033),
 *                          com destinatário, estado e data. É dado dela tanto
 *                          quanto o consentimento — e é o outro lado da mesma
 *                          conta: um envio sem consentimento é o que uma
 *                          fiscalização procura.
 *
 * O QUE FICA DE FORA, e por quê: `carrinhos`/`carrinho_itens` (o carrinho em
 * curso é produto e quantidade — o que a própria pessoa está vendo na tela
 * agora, e some com a conta por ON DELETE CASCADE) e `admins` (é papel de
 * acesso, não dado pessoal). Linha já redigida sai redigida: a exportação
 * mostra o que a loja GUARDA, não o que ela um dia soube.
 *
 * Registros órfãos de ANTIGOS titulares não aparecem (user_id NULL não pertence
 * a ninguém) — e é exatamente por isso que a redação precisa vir antes da
 * exclusão: depois dela, nem a exportação alcança mais a linha.
 */
async function exportarDadosDoTitular(req, res, { conexao = pool } = {}) {
  try {
    if (await recusarForaDaLoja(req, res, conexao)) return;
    const { userId } = req.params;

    const titular = (
      await conexao.query(
        `SELECT c.user_id, u.email, c.nome, c.cpf, c.telefone, c.criado_em
           FROM canastra.clientes c
           LEFT JOIN auth.users u ON u.id = c.user_id
          WHERE c.user_id = $1`,
        [userId],
      )
    ).rows[0];

    const enderecos = (
      await conexao.query(
        `SELECT endereco_id, cep, rua, numero, complemento, bairro, cidade,
                estado, criado_em, atualizado_em
           FROM canastra.enderecos
          WHERE user_id = $1
          ORDER BY criado_em`,
        [userId],
      )
    ).rows;

    /**
     * AS COLUNAS DE ATRIBUIÇÃO (0033) ENTRAM NA PROJEÇÃO, e não são detalhe de
     * marketing: `utm_*`, `canal`, `referrer`, `landing_page`, `gclid` e
     * `fbclid` registram POR ONDE esta pessoa chegou à loja e de que anúncio
     * ela veio. Isso é comportamento de navegação atrelado a uma venda
     * identificada — dado pessoal pelo art. 5º, I, e o `gclid`/`fbclid` é
     * literalmente o identificador que uma plataforma de anúncio usa para
     * reconhecê-la. Omitir da exportação seria a loja guardar sobre a pessoa
     * algo que a resposta ao direito de acesso não conta.
     */
    const pedidos = (
      await conexao.query(
        `SELECT pedido_id, total, status, metodo_pagamento, pagamento_id_mp,
                itens, endereco_json, frete, metodo_envio, codigo_rastreio,
                cupom_codigo, desconto, criado_em, redigido_em,
                utm_source, utm_medium, utm_campaign, utm_content, utm_term,
                canal, referrer, landing_page, gclid, fbclid
           FROM canastra.pedidos
          WHERE user_id = $1
          ORDER BY criado_em`,
        [userId],
      )
    ).rows;

    const assinaturas = (
      await conexao.query(
        `SELECT id, sku, quantidade, frequencia_dias, preco_centavos,
                endereco_json, preapproval_id, status, criado_em, cancelada_em,
                redigido_em
           FROM canastra.assinaturas
          WHERE user_id = $1
          ORDER BY criado_em`,
        [userId],
      )
    ).rows;

    const avaliacoes = (
      await conexao.query(
        `SELECT id, sku, nome_exibicao, nota, titulo, texto, status,
                criado_em, moderado_em
           FROM canastra.avaliacoes
          WHERE user_id = $1
          ORDER BY criado_em`,
        [userId],
      )
    ).rows;

    /**
     * A newsletter é a única sem `user_id`: a inscrição do rodapé não exige
     * conta (0011), então o vínculo com a pessoa é o E-MAIL — o mesmo que a
     * consulta do titular acabou de trazer do GoTrue. `lower()` dos dois lados
     * porque o UNIQUE da tabela é sensível a caixa e o e-mail não é: quem
     * digitou `Ana@ex.com` no rodapé continua sendo a titular de `ana@ex.com`.
     *
     * Titular sem e-mail (LEFT JOIN sem linha em `auth.users` — conta apagada
     * no GoTrue com o cliente ainda aqui) devolve lista vazia em vez de
     * consultar com NULL, que casaria com nada de qualquer jeito.
     */
    const newsletter = titular.email
      ? (
          await conexao.query(
            `SELECT id, email, origem, criado_em
               FROM canastra.newsletter_inscritos
              WHERE lower(email) = lower($1)`,
            [titular.email],
          )
        ).rows
      : [];

    /**
     * Consentimento e envio se ancoram em DOIS lugares, e por isso a consulta
     * pergunta pelos dois: `user_id` (quem consentiu logada) OU o e-mail (quem
     * marcou a caixa no rodapé sem conta, e depois se cadastrou com o mesmo
     * e-mail). Perguntar só pelo `user_id` deixaria de fora justamente o
     * histórico mais antigo da pessoa — e é o histórico antigo que uma
     * contestação de consentimento vai buscar.
     *
     * `lower()` dos dois lados pelo motivo da newsletter logo abaixo: o e-mail
     * não é sensível a caixa e o índice `consentimentos_email_idx` é sobre
     * `lower(email)`.
     */
    const email = titular.email ? String(titular.email).toLowerCase() : null;

    const consentimentos = (
      await conexao.query(
        `SELECT id, canal, estado, origem, email, telefone, texto_aceito,
                criado_em
           FROM canastra.consentimentos
          WHERE user_id = $1
             OR ($2::text IS NOT NULL AND lower(email) = $2)
          ORDER BY criado_em`,
        [userId, email],
      )
    ).rows;

    const envios = (
      await conexao.query(
        `SELECT id, canal, campanha_id, destinatario_final, template, estado,
                erro_texto, criado_em, enviado_em, entregue_em
           FROM canastra.envios
          WHERE user_id = $1
             OR ($2::text IS NOT NULL AND lower(destinatario_final) = $2)
          ORDER BY criado_em`,
        [userId, email],
      )
    ).rows;

    return res.json({
      // Datada: uma exportação é uma fotografia, e a data é parte da resposta
      // ao titular ("estes eram os seus dados em...").
      gerado_em: new Date().toISOString(),
      titular: { user_id: titular.user_id, email: titular.email },
      cliente: {
        nome: titular.nome,
        cpf: titular.cpf,
        telefone: titular.telefone,
        criado_em: titular.criado_em,
      },
      enderecos,
      pedidos,
      assinaturas,
      avaliacoes,
      newsletter,
      consentimentos,
      envios,
    });
  } catch (erro) {
    console.error("Erro ao exportar dados do titular:", erro);
    return res
      .status(500)
      .json({ message: "Erro ao exportar os dados do titular." });
  }
}

/**
 * Redação SEM exclusão de conta — o atendimento ao pedido de eliminação
 * parcial: a pessoa quer os dados de entrega fora dos pedidos antigos, mas
 * continua cliente. A conta, o cadastro e os endereços salvos NÃO são tocados
 * (esses a própria pessoa edita/apaga pela conta; e apagá-los aqui contra a
 * vontade dela seria outro atendimento, não este).
 *
 * A contagem devolvida vem da função do banco: é o registro de quantos pedidos
 * este atendimento alcançou — e "0" numa repetição é a idempotência visível.
 * (A função também redige as assinaturas CANCELADAS e o nome público das
 * avaliações — 0016 —, sem número próprio no retorno.)
 *
 * QUEM DISPAROU FICA NO LOG. Esta rota é DESTRUTIVA e irreversível: um UPDATE
 * que apaga o dado pessoal dos pedidos de OUTRA pessoa, sem confirmação e sem
 * desfazer. Sem o autor no log, "quem redigiu o titular X, e quando?" não tem
 * resposta em lugar nenhum do sistema — e essa é exatamente a pergunta que um
 * atendimento de titular contestado faz. O carimbo `redigido_em` guarda o
 * QUANDO; esta linha guarda o QUEM.
 */
async function redigirTitular(req, res, { conexao = pool } = {}) {
  try {
    if (await recusarForaDaLoja(req, res, conexao)) return;
    const { userId } = req.params;

    // `?.` porque os testes chamam o handler direto, sem `isAuthenticated`.
    const admin = req.user?.userId ?? "desconhecido";
    console.log(`Admin ${admin} disparou a redação LGPD do titular ${userId}.`);

    const { rows } = await conexao.query(
      "SELECT canastra.redigir_dados_do_titular($1::uuid) AS n",
      [userId],
    );

    /**
     * O LOG NO BANCO, e não só no processo. A linha do `console.log` acima
     * sobrevive ao rodízio do log do container e a mais nada; esta rota é
     * DESTRUTIVA e IRREVERSÍVEL (um UPDATE que apaga o dado pessoal dos pedidos
     * de outra pessoa, sem confirmação e sem desfazer), e "quem redigiu o
     * titular X, e quando?" é exatamente a pergunta de um atendimento de
     * titular contestado.
     *
     * Fora da transação da função, e sem escolha: `redigir_dados_do_titular` é
     * uma chamada única que commita sozinha pelo `conexao` recebido. Falhar em
     * registrar vira 500 no catch — com a redação já feita, o que é o lado
     * seguro do erro (a redação é idempotente; o log perdido não).
     */
    await registrar(conexao, {
      adminUserId: req.user?.userId ?? null,
      acao: ACOES.TITULAR_REDIGIDO,
      entidade: ENTIDADES.TITULAR,
      entidadeId: userId,
      // Sem `antes`: o que foi redigido É dado pessoal, e copiá-lo para o log
      // desfaria a redação — a linha diria em texto claro o que o UPDATE
      // acabou de apagar. O número de pedidos alcançados é o que se pode
      // registrar sem recriar o problema.
      depois: { pedidos_redigidos: rows[0].n },
    });

    return res.json({
      message: "Dados pessoais redigidos dos pedidos do titular.",
      pedidosRedigidos: rows[0].n,
    });
  } catch (erro) {
    console.error("Erro ao redigir dados do titular:", erro);
    return res
      .status(500)
      .json({ message: "Erro ao redigir os dados do titular." });
  }
}

lgpdRoutes.get("/titulares/:userId/dados", isAuthenticated, isAdmin, (req, res) =>
  exportarDadosDoTitular(req, res),
);

lgpdRoutes.post("/titulares/:userId/redigir", isAuthenticated, isAdmin, (req, res) =>
  redigirTitular(req, res),
);

module.exports = {
  lgpdRoutes,
  exportarDadosDoTitular,
  redigirTitular,
  MENSAGEM_TITULAR_NAO_ENCONTRADO,
};
