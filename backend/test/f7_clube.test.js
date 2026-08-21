"use strict";

/**
 * F7/Onda 3J — Clube da Canastra: assinatura recorrente via preapproval do MP.
 *
 * O Mercado Pago e o Resend são DUBLÊS via hook de require (mesmo padrão de
 * f4_checkout_e_webhook.test.js); o banco é REAL — idempotência da cobrança,
 * baixa de estoque e RLS da 0015 são exatamente o que um mock de pool não
 * prova. O ClubeController fala com o SDK (`require("mercadopago")`) direto,
 * então o dublê entrega as três classes que ele constrói.
 *
 * A assinatura HMAC do webhook roda no modo desenvolvimento (sem
 * MP_WEBHOOK_SECRET) na maior parte dos testes — a validação em si é a MESMA
 * `validarAssinaturaWebhook` de PaymentController, já coberta por
 * pagamento.test.js — e UM teste arma o segredo só para provar que o webhook
 * de assinaturas passa por ela de verdade.
 */

const { test, before, after, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const Module = require("node:module");
const { subirPostgres } = require("./ajuda/postgres.js");
const { comoPapel, PERMISSAO_NEGADA } = require("./ajuda/sessao.js");
const { aplicarMigracoes } = require("../db/migrar.js");

let bd;
let ClubeController;

const ANA = "aaaaaaaa-0000-0000-0000-000000000001";
const BRUNO = "bbbbbbbb-0000-0000-0000-000000000002";
const DORA = "dddddddd-0000-0000-0000-000000000004";
const PRODUTO = "11111111-0000-0000-0000-0000000000aa";
const SKU = "CLUBE-250";

/** O que o dublê do MP responde; cada teste ajusta. */
const mp = {
  falhaNoCreatePreapproval: false,
  falhaNoUpdatePreapproval: false,
  preapprovalsCriados: [],
  updatesDePreapproval: [],
  /** id -> objeto devolvido pelo GET /preapproval/:id */
  preapprovals: {},
  /** id -> objeto devolvido pelo GET /payments/:id */
  pagamentos: {},
};

/** E-mails que TERIAM saído. */
const emails = { deStatus: [], deAdmin: [], deAlertaDeEstoque: [] };

function respostaFalsa() {
  const res = { codigo: null, corpo: null };
  res.status = (codigo) => {
    res.codigo = codigo;
    return res;
  };
  res.sendStatus = (codigo) => {
    res.codigo = codigo;
    return res;
  };
  res.json = (corpo) => {
    if (res.codigo === null) res.codigo = 200;
    res.corpo = corpo;
    return res;
  };
  return res;
}

function requisicaoDeWebhook(type, id) {
  return {
    headers: { "x-request-id": "req-teste" },
    body: { type, data: { id } },
    ip: "127.0.0.1",
  };
}

async function estoqueDoProduto() {
  const { rows } = await bd.pool.query(
    "SELECT quantidade FROM canastra.produtos WHERE produto_id = $1",
    [PRODUTO],
  );
  return rows[0].quantidade;
}

async function linhaDaAssinatura(id) {
  const { rows } = await bd.pool.query(
    "SELECT * FROM canastra.assinaturas WHERE id = $1",
    [id],
  );
  return rows[0] ?? null;
}

before(async () => {
  bd = await subirPostgres();
  await aplicarMigracoes(bd.pool);

  for (const [id, email, nome] of [
    [ANA, "ana@ex.com", "Ana"],
    [BRUNO, "bruno@ex.com", "Bruno"],
    [DORA, "dora@ex.com", "Dora"],
  ]) {
    await bd.pool.query(
      "INSERT INTO auth.users (id, email) VALUES ($1, $2)",
      [id, email],
    );
    await bd.pool.query(
      "INSERT INTO canastra.clientes (user_id, nome) VALUES ($1, $2)",
      [id, nome],
    );
  }
  await bd.pool.query("INSERT INTO canastra.admins (user_id) VALUES ($1)", [DORA]);
  await bd.pool.query("INSERT INTO canastra.config_loja (id) VALUES (1)");
  await bd.pool.query(
    `INSERT INTO canastra.produtos (produto_id, nome, preco, quantidade, sku)
     VALUES ($1, 'Canastra Clássico 250 g', 39.70, 10, $2)`,
    [PRODUTO, SKU],
  );

  process.env.DATABASE_URL = bd.connectionString;
  delete process.env.MP_WEBHOOK_SECRET;
  process.env.NODE_ENV = "development";
  process.env.WEBHOOK_URL = "https://loja.exemplo/webhook/mercadopago";
  process.env.LOJA_URL = "https://loja.exemplo";

  const requireOriginal = Module.prototype.require;
  Module.prototype.require = function (caminho) {
    if (caminho === "mercadopago") {
      class MercadoPagoConfig {
        constructor() {}
      }
      class PreApproval {
        constructor() {}
        async create({ body }) {
          if (mp.falhaNoCreatePreapproval) throw new Error("MP fora do ar");
          mp.preapprovalsCriados.push(body);
          const id = `pre-${mp.preapprovalsCriados.length}`;
          mp.preapprovals[id] = {
            id,
            status: "pending",
            external_reference: body.external_reference,
          };
          return {
            id,
            status: "pending",
            init_point: `https://mp.local/preapproval/${id}`,
          };
        }
        async get({ id }) {
          const p = mp.preapprovals[id];
          if (!p) throw new Error("preapproval não existe");
          return p;
        }
        async update({ id, body }) {
          if (mp.falhaNoUpdatePreapproval) throw new Error("MP fora do ar");
          mp.updatesDePreapproval.push({ id, body });
          if (mp.preapprovals[id]) mp.preapprovals[id].status = body.status;
          return { id, status: body.status };
        }
      }
      class Payment {
        constructor() {}
        async get({ id }) {
          const pg = mp.pagamentos[id];
          if (!pg) throw new Error("payment não existe");
          return pg;
        }
      }
      return { MercadoPagoConfig, PreApproval, Payment };
    }
    // PaymentController (de onde o Clube importa validarAssinaturaWebhook)
    // puxa este módulo; sem o dublê, o require alcançaria o SDK real.
    if (caminho === "../config/mercadopago") {
      return {
        payment: {
          get: async ({ id }) => {
            const pg = mp.pagamentos[id];
            if (!pg) throw new Error("payment não existe");
            return pg;
          },
          create: async () => {
            throw new Error("o Clube não cria pagamento avulso");
          },
        },
      };
    }
    if (caminho === "../utils/emailSender") {
      return {
        sendStatusEmail: async (pedido, status) => {
          emails.deStatus.push({ pedido: pedido.order_id, status });
        },
        sendAdminNewOrderEmail: async (pedido) => {
          emails.deAdmin.push(pedido.order_id);
        },
        sendAdminClubeSemEstoqueEmail: async (aviso) => {
          emails.deAlertaDeEstoque.push(aviso);
        },
        sendCartReminderEmail: async () => {},
        conteudoDoLembreteDeCarrinho: () => ({ subject: "", html: "" }),
      };
    }
    return requireOriginal.apply(this, arguments);
  };

  try {
    ClubeController = require("../src/controllers/ClubeController.js");
  } finally {
    Module.prototype.require = requireOriginal;
  }
}, { timeout: 120_000 });

after(async () => {
  await require("../src/pgPool.js").end().catch(() => {});
  await bd?.derrubar();
});

beforeEach(() => {
  if (!bd) {
    throw new Error(
      "O Postgres nao subiu no before(); a causa real esta no erro daquele hook.",
    );
  }
});

/* --------------------------------------------------------------------------
 * POST /clube/assinar
 * -------------------------------------------------------------------------- */

const ENDERECO = {
  zip_code: "37928-000",
  street: "Rua da Serra",
  number: "12",
  complement: "",
  neighborhood: "Centro",
  city: "São Roque de Minas",
  state: "MG",
};

function corpoDeAssinatura(sobrescreve = {}) {
  return {
    sku: SKU,
    quantidade: 2,
    frequenciaDias: 30,
    endereco: { ...ENDERECO },
    ...sobrescreve,
  };
}

async function assinar(corpo, userId = ANA) {
  const res = respostaFalsa();
  await ClubeController.assinar(
    { user: { userId }, headers: {}, body: corpo },
    res,
  );
  return res;
}

test("sku que o catálogo não tem: 400, sem ir ao MP e sem gravar nada", async () => {
  const res = await assinar(corpoDeAssinatura({ sku: "NAO-EXISTE" }));
  assert.equal(res.codigo, 400);
  assert.equal(mp.preapprovalsCriados.length, 0);
  const { rows } = await bd.pool.query(
    "SELECT count(*)::int AS n FROM canastra.assinaturas",
  );
  assert.equal(rows[0].n, 0);
});

test("frequência fora de 15/30/45: 400", async () => {
  const res = await assinar(corpoDeAssinatura({ frequenciaDias: 20 }));
  assert.equal(res.codigo, 400);
  assert.equal(mp.preapprovalsCriados.length, 0);
});

test("quantidade inválida: 400", async () => {
  for (const quantidade of [0, -1, 2.5, 21]) {
    const res = await assinar(corpoDeAssinatura({ quantidade }));
    assert.equal(res.codigo, 400, `quantidade ${quantidade} deveria recusar`);
  }
  assert.equal(mp.preapprovalsCriados.length, 0);
});

test("endereço incompleto: 400 — entrega recorrente sem endereço não existe", async () => {
  const semCep = corpoDeAssinatura();
  semCep.endereco.zip_code = "";
  assert.equal((await assinar(semCep)).codigo, 400);

  const semNada = corpoDeAssinatura({ endereco: null });
  assert.equal((await assinar(semNada)).codigo, 400);
  assert.equal(mp.preapprovalsCriados.length, 0);
});

test("MP caiu: a linha pendente é removida e o erro é claro", async () => {
  mp.falhaNoCreatePreapproval = true;
  try {
    const res = await assinar(corpoDeAssinatura());
    assert.equal(res.codigo, 502);
    assert.ok(res.corpo.details || res.corpo.error);
    const { rows } = await bd.pool.query(
      "SELECT count(*)::int AS n FROM canastra.assinaturas",
    );
    assert.equal(rows[0].n, 0, "a linha órfã não pode ficar");
  } finally {
    mp.falhaNoCreatePreapproval = false;
  }
});

/** A assinatura da Ana — os testes seguintes trabalham sobre ela. */
let assinaturaDaAna;

test("assinar grava pendente com o preço do SERVIDOR e devolve o init_point", async () => {
  const res = await assinar(corpoDeAssinatura());
  assert.equal(res.codigo, 201);
  assert.equal(res.corpo.initPoint, "https://mp.local/preapproval/pre-1");
  assert.ok(res.corpo.assinatura?.id);
  assinaturaDaAna = res.corpo.assinatura.id;

  const linha = await linhaDaAssinatura(assinaturaDaAna);
  assert.equal(linha.status, "pendente");
  assert.equal(linha.user_id, ANA);
  assert.equal(linha.sku, SKU);
  assert.equal(linha.quantidade, 2);
  assert.equal(linha.frequencia_dias, 30);
  // 10% no servidor: round(39.70 * 0.9 * 100) = 3573 por pacote, x2 = 7146.
  // O que o navegador exibiu NUNCA entra na conta.
  assert.equal(linha.preco_centavos, 7146);
  assert.equal(linha.preapproval_id, "pre-1");
  assert.equal(linha.endereco_json.zip_code, ENDERECO.zip_code);
  assert.equal(linha.endereco_json.street, ENDERECO.street);
  assert.equal(linha.cancelada_em, null);

  // O corpo enviado ao MP.
  assert.equal(mp.preapprovalsCriados.length, 1);
  const corpo = mp.preapprovalsCriados[0];
  assert.equal(corpo.payer_email, "ana@ex.com");
  assert.match(corpo.reason, /Clube da Canastra/);
  assert.match(corpo.reason, /Canastra Clássico/);
  assert.equal(corpo.external_reference, assinaturaDaAna);
  assert.deepEqual(corpo.auto_recurring, {
    frequency: 30,
    frequency_type: "days",
    transaction_amount: 71.46,
    currency_id: "BRL",
  });
  assert.equal(
    corpo.back_url,
    "https://loja.exemplo/account?assinatura=confirmada",
  );
  // O webhook de assinaturas é SEPARADO do de pagamentos: o path troca.
  assert.equal(
    corpo.notification_url,
    "https://loja.exemplo/webhook/mercadopago/assinaturas",
  );
});

/* --------------------------------------------------------------------------
 * Webhook de assinaturas
 * -------------------------------------------------------------------------- */

test("com o segredo armado, notificação sem assinatura HMAC leva 401", async () => {
  process.env.MP_WEBHOOK_SECRET = "segredo-de-teste";
  try {
    const res = respostaFalsa();
    await ClubeController.webhook(
      requisicaoDeWebhook("subscription_preapproval", "pre-1"),
      res,
    );
    assert.equal(res.codigo, 401);
  } finally {
    delete process.env.MP_WEBHOOK_SECRET;
  }
});

test("preapproval authorized → ativa, e o reenvio não muda nada", async () => {
  mp.preapprovals["pre-1"].status = "authorized";

  let res = respostaFalsa();
  await ClubeController.webhook(
    requisicaoDeWebhook("subscription_preapproval", "pre-1"),
    res,
  );
  assert.equal(res.codigo, 200);
  assert.equal((await linhaDaAssinatura(assinaturaDaAna)).status, "ativa");

  res = respostaFalsa();
  await ClubeController.webhook(
    requisicaoDeWebhook("subscription_preapproval", "pre-1"),
    res,
  );
  assert.equal(res.codigo, 200);
  assert.equal((await linhaDaAssinatura(assinaturaDaAna)).status, "ativa");
});

test("preapproval desconhecido: 404, para aparecer no painel do MP", async () => {
  mp.preapprovals["pre-alheio"] = { id: "pre-alheio", status: "authorized" };
  const res = respostaFalsa();
  await ClubeController.webhook(
    requisicaoDeWebhook("subscription_preapproval", "pre-alheio"),
    res,
  );
  assert.equal(res.codigo, 404);
});

test("cobrança da assinatura vira pedido com estoque baixado — idempotente", async () => {
  emails.deStatus.length = 0;
  emails.deAdmin.length = 0;
  emails.deAlertaDeEstoque.length = 0;
  mp.pagamentos["pay-1"] = {
    id: "pay-1",
    status: "approved",
    payment_type_id: "credit_card",
    metadata: { preapproval_id: "pre-1" },
  };

  let res = respostaFalsa();
  await ClubeController.webhook(requisicaoDeWebhook("payment", "pay-1"), res);
  assert.equal(res.codigo, 200);

  const { rows } = await bd.pool.query(
    `SELECT pedido_id, user_id, status, total, itens, endereco_json,
            metodo_envio, frete, chave_idempotencia
       FROM canastra.pedidos WHERE pagamento_id_mp = 'pay-1'`,
  );
  assert.equal(rows.length, 1, "a cobrança tem que virar UM pedido");
  const pedido = rows[0];
  assert.equal(pedido.user_id, ANA);
  assert.equal(pedido.status, "aprovado");
  assert.equal(Number(pedido.total), 71.46);
  assert.equal(Number(pedido.frete), 0);
  assert.equal(pedido.metodo_envio, "Clube da Canastra");
  assert.equal(pedido.endereco_json.zip_code, ENDERECO.zip_code);
  assert.equal(pedido.itens.length, 1);
  assert.equal(pedido.itens[0].product_id, PRODUTO);
  assert.equal(pedido.itens[0].quantity, 2);
  // Preço CONGELADO da adesão (35,73 a unidade), não o do catálogo do dia.
  assert.equal(Number(pedido.itens[0].price), 35.73);
  assert.match(pedido.chave_idempotencia, /^assinatura:/);

  assert.equal(await estoqueDoProduto(), 8, "2 unidades saem da prateleira");
  assert.equal(emails.deAdmin.length, 1, "o gestor é avisado do pedido novo");
  assert.equal(
    emails.deAlertaDeEstoque.length,
    0,
    "com café separado, nenhum alerta de decisão",
  );
  assert.equal(emails.deStatus.length, 1, "o cliente recebe a confirmação");

  // O MP reenvia por desenho: mesma notificação, nenhum efeito novo.
  res = respostaFalsa();
  await ClubeController.webhook(requisicaoDeWebhook("payment", "pay-1"), res);
  assert.equal(res.codigo, 200);
  const { rows: depois } = await bd.pool.query(
    "SELECT count(*)::int AS n FROM canastra.pedidos WHERE pagamento_id_mp = 'pay-1'",
  );
  assert.equal(depois[0].n, 1, "reenvio não cria segundo pedido");
  assert.equal(await estoqueDoProduto(), 8, "reenvio não baixa estoque de novo");
  assert.equal(emails.deAdmin.length, 1, "sem segundo e-mail de pedido novo");
});

test("estoque insuficiente NÃO perde a cobrança: pedido nasce, prateleira fica", async () => {
  emails.deAdmin.length = 0;
  emails.deAlertaDeEstoque.length = 0;
  await bd.pool.query(
    "UPDATE canastra.produtos SET quantidade = 1 WHERE produto_id = $1",
    [PRODUTO],
  );
  mp.pagamentos["pay-2"] = {
    id: "pay-2",
    status: "approved",
    payment_type_id: "credit_card",
    metadata: { preapproval_id: "pre-1" },
  };

  const res = respostaFalsa();
  await ClubeController.webhook(requisicaoDeWebhook("payment", "pay-2"), res);
  assert.equal(res.codigo, 200);

  const { rows } = await bd.pool.query(
    "SELECT pedido_id, status FROM canastra.pedidos WHERE pagamento_id_mp = 'pay-2'",
  );
  assert.equal(rows.length, 1, "o dinheiro já saiu do cliente: o pedido existe");
  assert.equal(rows[0].status, "aprovado");
  // Baixa é tudo-ou-nada: 1 < 2, então NADA sai (nunca estoque negativo).
  assert.equal(await estoqueDoProduto(), 1);

  /**
   * O AVISO PRECISA SER DISTINGUÍVEL. Um pedido do Clube nasce 'aprovado' com
   * ou sem café na prateleira; se o gestor recebesse o mesmo "Novo Pedido
   * Recebido" dos dois jeitos, o rombo passaria batido — que era exatamente o
   * caso antes desta revisão.
   */
  assert.equal(
    emails.deAdmin.length,
    0,
    "o e-mail rotineiro de pedido novo NÃO sai quando falta café",
  );
  assert.equal(emails.deAlertaDeEstoque.length, 1, "sai o alerta de decisão");
  const alerta = emails.deAlertaDeEstoque[0];
  assert.equal(alerta.pedido.order_id, rows[0].pedido_id);
  assert.equal(alerta.sku, SKU, "o alerta diz QUAL café falta");
  assert.equal(alerta.quantidade, 2, "e QUANTOS pacotes");
  assert.match(alerta.motivo, /Estoque insuficiente/);

  // Devolve o cenário dos testes seguintes.
  await bd.pool.query(
    "UPDATE canastra.produtos SET quantidade = 8 WHERE produto_id = $1",
    [PRODUTO],
  );
});

test("cobrança reembolsada: transição idempotente devolve o estoque UMA vez", async () => {
  mp.pagamentos["pay-1"].status = "refunded";

  let res = respostaFalsa();
  await ClubeController.webhook(requisicaoDeWebhook("payment", "pay-1"), res);
  assert.equal(res.codigo, 200);
  const { rows } = await bd.pool.query(
    "SELECT status FROM canastra.pedidos WHERE pagamento_id_mp = 'pay-1'",
  );
  assert.equal(rows[0].status, "reembolsado");
  assert.equal(await estoqueDoProduto(), 10, "as 2 unidades voltaram");

  res = respostaFalsa();
  await ClubeController.webhook(requisicaoDeWebhook("payment", "pay-1"), res);
  assert.equal(res.codigo, 200);
  assert.equal(await estoqueDoProduto(), 10, "reenvio NÃO devolve de novo");
});

test("o MP fora do ar na RELEITURA vira 500 — o status nunca vem do corpo", async () => {
  /**
   * O corpo da notificação é forjável, então o status é sempre relido na API.
   * Se essa releitura falha, a única resposta honesta é 500: o MP reenvia e a
   * transição acontece depois. Responder 200 seria dar a notificação por
   * aplicada sem ter aplicado nada.
   */
  const dePreapproval = respostaFalsa();
  await ClubeController.webhook(
    // Id que o dublê não conhece: o `get` lança, como o SDK lançaria.
    requisicaoDeWebhook("subscription_preapproval", "pre-que-nao-existe"),
    dePreapproval,
  );
  assert.equal(dePreapproval.codigo, 500);

  const deCobranca = respostaFalsa();
  await ClubeController.webhook(
    requisicaoDeWebhook("payment", "pay-que-nao-existe"),
    deCobranca,
  );
  assert.equal(deCobranca.codigo, 500);
  const { rows } = await bd.pool.query(
    "SELECT count(*)::int AS n FROM canastra.pedidos WHERE pagamento_id_mp = 'pay-que-nao-existe'",
  );
  assert.equal(rows[0].n, 0, "releitura que falhou não pode criar pedido");
});

test("erro de banco no webhook vira 500 — nunca 200 que faz o MP esquecer", async () => {
  mp.preapprovals["pre-1"].status = "paused";
  await bd.pool.query(
    "ALTER TABLE canastra.assinaturas RENAME TO assinaturas_quebrada",
  );
  try {
    const res = respostaFalsa();
    await ClubeController.webhook(
      requisicaoDeWebhook("subscription_preapproval", "pre-1"),
      res,
    );
    assert.equal(res.codigo, 500);
  } finally {
    await bd.pool.query(
      "ALTER TABLE canastra.assinaturas_quebrada RENAME TO assinaturas",
    );
  }
  // Consertado o banco, o reenvio aplica a transição que faltou.
  const res = respostaFalsa();
  await ClubeController.webhook(
    requisicaoDeWebhook("subscription_preapproval", "pre-1"),
    res,
  );
  assert.equal(res.codigo, 200);
  assert.equal((await linhaDaAssinatura(assinaturaDaAna)).status, "pausada");
});

/* --------------------------------------------------------------------------
 * Listagens e cancelamento
 * -------------------------------------------------------------------------- */

test("GET /clube/assinaturas devolve as do dono, com o nome do café", async () => {
  const res = respostaFalsa();
  await ClubeController.listarDoCliente(
    { user: { userId: ANA }, headers: {} },
    res,
  );
  assert.equal(res.codigo, 200);
  assert.equal(res.corpo.length, 1);
  assert.equal(res.corpo[0].id, assinaturaDaAna);
  assert.equal(res.corpo[0].nome_cafe, "Canastra Clássico 250 g");
  assert.equal(res.corpo[0].preco_centavos, 7146);

  const deBruno = respostaFalsa();
  await ClubeController.listarDoCliente(
    { user: { userId: BRUNO }, headers: {} },
    deBruno,
  );
  assert.equal(deBruno.codigo, 200);
  assert.equal(deBruno.corpo.length, 0);
});

test("GET /admin/assinaturas traz todas, com os dados do cliente", async () => {
  const res = respostaFalsa();
  await ClubeController.listarTodas({ user: { userId: DORA }, headers: {} }, res);
  assert.equal(res.codigo, 200);
  assert.equal(res.corpo.length, 1);
  assert.equal(res.corpo[0].cliente_nome, "Ana");
  assert.equal(res.corpo[0].cliente_email, "ana@ex.com");
  assert.equal(res.corpo[0].frequencia_dias, 30);
});

test("cancelar de quem não é dono: 404, sem tocar o MP", async () => {
  const chamadasAntes = mp.updatesDePreapproval.length;
  const res = respostaFalsa();
  await ClubeController.cancelar(
    { user: { userId: BRUNO }, params: { id: assinaturaDaAna }, headers: {} },
    res,
  );
  assert.equal(res.codigo, 404);
  assert.equal(mp.updatesDePreapproval.length, chamadasAntes);
  assert.notEqual(
    (await linhaDaAssinatura(assinaturaDaAna)).status,
    "cancelada",
  );
});

test("MP recusa o cancelamento: 502 e a assinatura local fica INTACTA", async () => {
  /**
   * O CAMINHO CRÍTICO DO CANCELAMENTO. Marcar "cancelada" aqui com o
   * preapproval vivo lá seria o pior desfecho possível: a pessoa vê
   * "cancelada" na conta e continua sendo cobrada todo ciclo, sem botão
   * nenhum para tentar de novo. Por isso o MP vem primeiro e a recusa dele
   * PARA o fluxo — nada é escrito localmente.
   */
  const antes = await linhaDaAssinatura(assinaturaDaAna);
  const chamadas = mp.updatesDePreapproval.length;

  mp.falhaNoUpdatePreapproval = true;
  let res;
  try {
    res = respostaFalsa();
    await ClubeController.cancelar(
      { user: { userId: ANA }, params: { id: assinaturaDaAna }, headers: {} },
      res,
    );
  } finally {
    mp.falhaNoUpdatePreapproval = false;
  }

  assert.equal(res.codigo, 502);
  // 5xx não vaza a mensagem interna (regra do `responderErro`, a mesma do
  // PaymentController): o cliente recebe a frase genérica de "tente de novo",
  // e o motivo fica no log.
  assert.ok(res.corpo.details, "a resposta tem uma frase para a pessoa ler");
  assert.equal(
    mp.updatesDePreapproval.length,
    chamadas,
    "nenhum update entrou no MP",
  );

  const depois = await linhaDaAssinatura(assinaturaDaAna);
  assert.equal(depois.status, antes.status, "o status local não se mexeu");
  assert.equal(depois.cancelada_em, null, "nem a data de cancelamento");
  assert.deepEqual(
    depois.atualizado_em,
    antes.atualizado_em,
    "nenhuma escrita local aconteceu",
  );
});

test("o dono cancela: MP recebe cancelled e a linha local fecha", async () => {
  const res = respostaFalsa();
  await ClubeController.cancelar(
    { user: { userId: ANA }, params: { id: assinaturaDaAna }, headers: {} },
    res,
  );
  assert.equal(res.codigo, 200);
  assert.deepEqual(mp.updatesDePreapproval.at(-1), {
    id: "pre-1",
    body: { status: "cancelled" },
  });

  const linha = await linhaDaAssinatura(assinaturaDaAna);
  assert.equal(linha.status, "cancelada");
  assert.ok(linha.cancelada_em, "cancelada_em registra quando fechou");

  // Cancelar de novo é no-op idempotente, sem segunda ida ao MP.
  const chamadas = mp.updatesDePreapproval.length;
  const deNovo = respostaFalsa();
  await ClubeController.cancelar(
    { user: { userId: ANA }, params: { id: assinaturaDaAna }, headers: {} },
    deNovo,
  );
  assert.equal(deNovo.codigo, 200);
  assert.equal(mp.updatesDePreapproval.length, chamadas);
});

/* --------------------------------------------------------------------------
 * RLS da 0015
 * -------------------------------------------------------------------------- */

test("RLS: dono lê só as suas, o vizinho nada, o admin todas — e ninguém escreve", async () => {
  // Uma assinatura do Bruno, semeada por baixo da RLS (como o Express faria).
  await bd.pool.query(
    `INSERT INTO canastra.assinaturas
       (user_id, sku, quantidade, frequencia_dias, preco_centavos, endereco_json)
     VALUES ($1, $2, 1, 15, 3573, '{"zip_code":"37928-000"}'::jsonb)`,
    [BRUNO, SKU],
  );

  const anaVe = await comoPapel(bd.pool, { papel: "authenticated", sub: ANA }, async (c) => {
    const { rows } = await c.query(
      "SELECT user_id FROM canastra.assinaturas ORDER BY criado_em",
    );
    return rows.map((r) => r.user_id);
  });
  assert.deepEqual(anaVe, [ANA], "Ana enxerga exatamente as dela");

  const brunoVeDaAna = await comoPapel(
    bd.pool,
    { papel: "authenticated", sub: BRUNO },
    async (c) => {
      const { rows } = await c.query(
        "SELECT count(*)::int AS n FROM canastra.assinaturas WHERE user_id = $1",
        [ANA],
      );
      return rows[0].n;
    },
  );
  assert.equal(brunoVeDaAna, 0, "a assinatura da Ana não existe para o Bruno");

  const doraVe = await comoPapel(bd.pool, { papel: "authenticated", sub: DORA }, async (c) => {
    const { rows } = await c.query(
      "SELECT count(*)::int AS n FROM canastra.assinaturas",
    );
    return rows[0].n;
  });
  assert.equal(doraVe, 2, "o admin lê todas");

  // Escrita é do Express: nem o próprio dono insere/edita pelo PostgREST.
  await assert.rejects(
    () =>
      comoPapel(bd.pool, { papel: "authenticated", sub: ANA }, (c) =>
        c.query(
          `INSERT INTO canastra.assinaturas
             (user_id, sku, quantidade, frequencia_dias, preco_centavos, endereco_json)
           VALUES ($1, $2, 1, 30, 100, '{}'::jsonb)`,
          [ANA, SKU],
        ),
      ),
    (erro) => erro.code === PERMISSAO_NEGADA,
    "INSERT do navegador tem que recusar com 42501",
  );
});

/* --------------------------------------------------------------------------
 * O VÍNCULO PERDIDO (self-healing)
 *
 * O UPDATE que grava `preapproval_id` acontece DEPOIS de o MP criar o
 * preapproval. Se ele não acontecer (banco piscou naquele instante), a
 * assinatura existe dos dois lados e nada mais as liga pelo caminho curto:
 * todo evento viraria 404 eterno e o cancelamento pularia o MP, deixando a
 * cobrança viva. Os dois testes abaixo provam que o primeiro evento CURA.
 * -------------------------------------------------------------------------- */

/** A assinatura do Bruno — nasce aqui e é usada até o fim do arquivo. */
let assinaturaDoBruno;

async function apagarOVinculo(id) {
  await bd.pool.query(
    "UPDATE canastra.assinaturas SET preapproval_id = NULL WHERE id = $1::uuid",
    [id],
  );
}

test("evento de preapproval sem vínculo: acha pela referência e REGRAVA o id", async () => {
  const res = await assinar(corpoDeAssinatura({ quantidade: 1 }), BRUNO);
  assert.equal(res.codigo, 201);
  assinaturaDoBruno = res.corpo.assinatura.id;
  const preapprovalId = (await linhaDaAssinatura(assinaturaDoBruno)).preapproval_id;

  // O acidente: o UPDATE do preapproval_id não chegou a acontecer.
  await apagarOVinculo(assinaturaDoBruno);
  mp.preapprovals[preapprovalId].status = "authorized";

  const webhookRes = respostaFalsa();
  await ClubeController.webhook(
    requisicaoDeWebhook("subscription_preapproval", preapprovalId),
    webhookRes,
  );
  assert.equal(webhookRes.codigo, 200, "não pode ser o 404 eterno");

  const linha = await linhaDaAssinatura(assinaturaDoBruno);
  assert.equal(linha.status, "ativa", "a transição foi aplicada");
  assert.equal(
    linha.preapproval_id,
    preapprovalId,
    "e o vínculo foi regravado na mesma transação",
  );
});

test("cobrança sem vínculo: acha pela external_reference e REGRAVA o id", async () => {
  const preapprovalId = (await linhaDaAssinatura(assinaturaDoBruno)).preapproval_id;
  await apagarOVinculo(assinaturaDoBruno);

  mp.pagamentos["pay-orfa"] = {
    id: "pay-orfa",
    status: "approved",
    payment_type_id: "credit_card",
    metadata: { preapproval_id: preapprovalId },
    external_reference: assinaturaDoBruno,
  };

  const res = respostaFalsa();
  await ClubeController.webhook(requisicaoDeWebhook("payment", "pay-orfa"), res);
  assert.equal(res.codigo, 200);

  const { rows } = await bd.pool.query(
    "SELECT user_id, status FROM canastra.pedidos WHERE pagamento_id_mp = 'pay-orfa'",
  );
  assert.equal(rows.length, 1, "a cobrança virou pedido mesmo sem o vínculo");
  assert.equal(rows[0].user_id, BRUNO);
  assert.equal(
    (await linhaDaAssinatura(assinaturaDoBruno)).preapproval_id,
    preapprovalId,
    "e o vínculo voltou, para o cancelamento não pular o MP",
  );
});

/* --------------------------------------------------------------------------
 * O preço em centavos inteiros
 * -------------------------------------------------------------------------- */

test("o preço é calculado em CENTAVOS: nada de um centavo a menos que a etiqueta", async () => {
  /**
   * R$ 16,15 é um dos 947 preços (em 200.000) que denunciavam a conta antiga:
   * `round(16.15 * 0.9 * 100)` dá 1453 em ponto flutuante, enquanto a vitrine
   * exibe `round(1615 * 0.9)` = 1454. Um centavo de diferença entre o que a
   * etiqueta promete e o que o Mercado Pago debita — pequeno no valor,
   * enorme na confiança. Convertendo a centavos ANTES do desconto, os dois
   * lados rodam a MESMA expressão.
   */
  await bd.pool.query(
    "UPDATE canastra.produtos SET preco = 16.15 WHERE produto_id = $1",
    [PRODUTO],
  );
  try {
    const res = await assinar(corpoDeAssinatura({ quantidade: 1 }), ANA);
    assert.equal(res.codigo, 201);
    const linha = await linhaDaAssinatura(res.corpo.assinatura.id);

    const doNavegador = Math.round(1615 * 0.9); // frontend/lib/clube.ts
    assert.equal(linha.preco_centavos, doNavegador);
    assert.equal(linha.preco_centavos, 1454);
    assert.notEqual(
      linha.preco_centavos,
      Math.round(16.15 * 0.9 * 100),
      "a conta antiga (em reais, float) cobrava 1453",
    );
  } finally {
    await bd.pool.query(
      "UPDATE canastra.produtos SET preco = 39.70 WHERE produto_id = $1",
      [PRODUTO],
    );
  }
});

/* --------------------------------------------------------------------------
 * cancelarAssinaturasDoTitular — o contrato que a onda de LGPD importa
 * -------------------------------------------------------------------------- */

test("cancelarAssinaturasDoTitular: recusa do MP LANÇA 502 e não fecha a assinatura viva", async () => {
  /**
   * A exclusão de conta precisa ABORTAR quando o MP recusa: apagar o cadastro
   * com um preapproval vivo deixaria um cartão sendo debitado sem dono no
   * banco — o desfecho que a 0015 (ON DELETE SET NULL) menciona e que esta
   * função existe para evitar.
   */
  // O Bruno tem duas vivas: a pendente semeada na prova de RLS (sem
  // preapproval, portanto sem ida ao MP) e a ativa deste arquivo.
  const { rows: semPreapproval } = await bd.pool.query(
    `SELECT id FROM canastra.assinaturas
      WHERE user_id = $1::uuid AND preapproval_id IS NULL`,
    [BRUNO],
  );
  assert.equal(semPreapproval.length, 1);

  mp.falhaNoUpdatePreapproval = true;
  try {
    await assert.rejects(
      () => ClubeController.cancelarAssinaturasDoTitular(BRUNO),
      (erro) => {
        assert.equal(erro.status, 502);
        assert.match(erro.message, /Mercado Pago/);
        // O que já fechou antes da recusa vai junto do erro: sem transação
        // possível contra uma API de rede, quem chama precisa saber onde parou.
        assert.deepEqual(erro.canceladas, [semPreapproval[0].id]);
        return true;
      },
    );
  } finally {
    mp.falhaNoUpdatePreapproval = false;
  }

  assert.equal(
    (await linhaDaAssinatura(assinaturaDoBruno)).status,
    "ativa",
    "a assinatura que o MP recusou continua viva no banco",
  );
  assert.equal(
    (await linhaDaAssinatura(semPreapproval[0].id)).status,
    "cancelada",
    "a que já tinha fechado antes da recusa continua fechada (re-execução pula)",
  );
});

test("cancelarAssinaturasDoTitular: fecha todas as vivas do titular e é idempotente", async () => {
  const chamadasAntes = mp.updatesDePreapproval.length;
  const preapprovalId = (await linhaDaAssinatura(assinaturaDoBruno)).preapproval_id;

  const canceladas = await ClubeController.cancelarAssinaturasDoTitular(BRUNO);
  assert.ok(
    canceladas.includes(assinaturaDoBruno),
    "a ativa com preapproval entra na lista devolvida",
  );

  // O MP recebeu o cancelamento da que tinha preapproval.
  assert.deepEqual(mp.updatesDePreapproval.at(-1), {
    id: preapprovalId,
    body: { status: "cancelled" },
  });
  assert.equal(
    mp.updatesDePreapproval.length,
    chamadasAntes + 1,
    "uma ida ao MP, só da que tem preapproval — a re-execução pula o resto",
  );
  assert.deepEqual(
    canceladas,
    [assinaturaDoBruno],
    "a pendente sem preapproval já tinha fechado na tentativa anterior",
  );

  const { rows } = await bd.pool.query(
    `SELECT status, cancelada_em FROM canastra.assinaturas WHERE user_id = $1::uuid`,
    [BRUNO],
  );
  assert.ok(rows.length >= 2);
  for (const linha of rows) {
    assert.equal(linha.status, "cancelada", "nenhuma assinatura viva sobra");
    assert.ok(linha.cancelada_em, "com a data de fechamento");
  }

  // Re-execução: nada vivo, nada a fazer, nenhuma ida ao MP.
  const denovo = await ClubeController.cancelarAssinaturasDoTitular(BRUNO);
  assert.deepEqual(denovo, []);
  assert.equal(mp.updatesDePreapproval.length, chamadasAntes + 1);

  // Titular sem assinatura nenhuma: [] também, não erro.
  assert.deepEqual(await ClubeController.cancelarAssinaturasDoTitular(DORA), []);

  // Id fora de formato para de propósito: `$1::uuid` estouraria 22P02 e a
  // exclusão de conta receberia um 500 sem explicação.
  await assert.rejects(
    () => ClubeController.cancelarAssinaturasDoTitular("nao-e-uuid"),
    (erro) => erro.status === 400,
  );
});
