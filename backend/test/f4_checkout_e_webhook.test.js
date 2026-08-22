"use strict";

/**
 * F4 — o checkout gravando em `canastra.pedidos` e o webhook transacional.
 *
 * O Mercado Pago e o Resend são DUBLÊS via hook de require (mesmo padrão de
 * pagamento.test.js): teste que faz requisição de verdade não distingue "a
 * lógica está errada" de "o gateway caiu". O banco é REAL — idempotência e
 * movimentação de estoque são exatamente o que um mock de pool não prova.
 *
 * A assinatura do webhook roda no modo desenvolvimento (sem MP_WEBHOOK_SECRET)
 * de propósito: a validação HMAC em si já está coberta por pagamento.test.js,
 * e aqui o assunto é o que acontece DEPOIS dela.
 */

const { test, before, after, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const Module = require("node:module");
const { subirPostgres } = require("./ajuda/postgres.js");
const { aplicarMigracoes } = require("../db/migrar.js");

let bd;
let PaymentController;

const ANA = "aaaaaaaa-0000-0000-0000-000000000001";
const PRODUTO = "11111111-0000-0000-0000-0000000000aa";

/** O que o dublê do MP responde; cada teste ajusta. */
const mp = {
  statusDoGet: "approved",
  falhaNoGet: false,
  falhaNoCreate: false,
  criacoes: [],
};

/** E-mails que TERIAM saído; o webhook não pode enviar duas vezes. */
const emails = { deStatus: [], deAdmin: [] };

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

function requisicaoDeWebhook(paymentId) {
  return {
    headers: { "x-request-id": "req-teste" },
    body: { type: "payment", data: { id: paymentId } },
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

async function statusDoPedido(pagamentoMp) {
  const { rows } = await bd.pool.query(
    "SELECT status FROM canastra.pedidos WHERE pagamento_id_mp = $1",
    [pagamentoMp],
  );
  return rows.length ? rows[0].status : null;
}

before(async () => {
  bd = await subirPostgres();
  await aplicarMigracoes(bd.pool);

  await bd.pool.query("INSERT INTO auth.users (id, email) VALUES ($1, 'ana@ex.com')", [ANA]);
  await bd.pool.query("INSERT INTO canastra.clientes (user_id, nome) VALUES ($1, 'Ana')", [ANA]);
  await bd.pool.query("INSERT INTO canastra.config_loja (id) VALUES (1)");
  await bd.pool.query(
    `INSERT INTO canastra.produtos (produto_id, nome, preco, quantidade, sku)
     VALUES ($1, 'Café do Teste', 50.00, 10, 'WEBHOOK-1')`,
    [PRODUTO],
  );
  // Sacola de Ana, para o checkout esvaziar depois de criar o pedido.
  const { rows: carrinho } = await bd.pool.query(
    `INSERT INTO canastra.carrinhos (user_id) VALUES ($1) RETURNING carrinho_id`,
    [ANA],
  );
  await bd.pool.query(
    `INSERT INTO canastra.carrinho_itens (carrinho_id, produto_id, quantidade, preco, nome, moagem)
     VALUES ($1, $2, 1, 50.00, 'Café do Teste', 'graos')`,
    [carrinho[0].carrinho_id, PRODUTO],
  );

  process.env.DATABASE_URL = bd.connectionString;
  delete process.env.MP_WEBHOOK_SECRET;
  process.env.NODE_ENV = "development";
  // Porta fechada: se algum caminho tentar a Melhor Envio, falha na hora.
  process.env.MELHOR_ENVIO_URL = "http://127.0.0.1:9";

  const requireOriginal = Module.prototype.require;
  Module.prototype.require = function (caminho) {
    if (caminho === "../config/mercadopago") {
      return {
        payment: {
          get: async ({ id }) => {
            if (mp.falhaNoGet) throw new Error("MP fora do ar");
            return {
              id,
              status: mp.statusDoGet,
              // O MP devolve o QR do Pix também na releitura — é o que o
              // replay de idempotência usa para repor o ticketUrl.
              point_of_interaction: {
                transaction_data: { ticket_url: "https://mp.local/pix" },
              },
            };
          },
          create: async ({ body }) => {
            if (mp.falhaNoCreate) throw new Error("gateway caiu");
            mp.criacoes.push(body);
            return {
              id: 900000 + mp.criacoes.length,
              status: "pending",
              point_of_interaction: {
                transaction_data: { ticket_url: "https://mp.local/pix" },
              },
            };
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
      };
    }
    return requireOriginal.apply(this, arguments);
  };

  try {
    PaymentController = require("../src/controllers/PaymentController.js");
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
 * Checkout
 * -------------------------------------------------------------------------- */

function corpoDeCheckout() {
  return {
    formData: {
      paymentMethodId: "pix",
      payer: {
        email: "ana@ex.com",
        identification: { type: "CPF", number: "529.982.247-25" },
      },
    },
    paymentMethodType: "pix",
    items: [{ product_id: PRODUTO, quantity: 2, name: "Café do Teste" }],
    userEmail: "ana@ex.com",
    address: { zip_code: "35012345", street: "Rua X", number: "1" },
    shippingCost: 0,
    shippingMethod: "Retirada na loja",
  };
}

test("sem CPF em lugar nenhum, o checkout recusa com CPF_MISSING", async () => {
  const corpo = corpoDeCheckout();
  delete corpo.formData.payer.identification;

  const res = respostaFalsa();
  await PaymentController.createPayment(
    { user: { userId: ANA }, headers: {}, body: corpo },
    res,
  );
  assert.equal(res.codigo, 400);
  assert.equal(res.corpo.error, "CPF_MISSING");
  assert.equal(mp.criacoes.length, 0, "não pode cobrar sem CPF");
});

test("frete que não casa com nenhuma opção real: 409 SEM reservar nem cobrar", async () => {
  // A conferência de frete roda ANTES da transação agora (nada de segurar
  // FOR UPDATE durante a chamada à transportadora), então o 409 tem que
  // chegar com a prateleira e o gateway intocados.
  const corpo = corpoDeCheckout();
  corpo.shippingMethod = "Entrega Local";
  corpo.shippingCost = 3; // a opção local real custa 5 abaixo do piso

  const res = respostaFalsa();
  await PaymentController.createPayment(
    { user: { userId: ANA }, headers: {}, body: corpo },
    res,
  );

  assert.equal(res.codigo, 409);
  assert.match(res.corpo.details, /frete mudou/i);
  assert.equal(mp.criacoes.length, 0, "não pode cobrar com frete divergente");
  assert.equal(await estoqueDoProduto(), 10, "nada foi reservado");
});

test("gateway caiu depois da reserva: estoque devolvido, resposta 500", async () => {
  mp.falhaNoCreate = true;
  try {
    const res = respostaFalsa();
    await PaymentController.createPayment(
      { user: { userId: ANA }, headers: {}, body: corpoDeCheckout() },
      res,
    );
    assert.equal(res.codigo, 500);
    assert.equal(
      await estoqueDoProduto(),
      10,
      "a reserva tem que voltar quando a cobrança não sai",
    );
    const { rows } = await bd.pool.query(
      "SELECT count(*)::int AS n FROM canastra.pedidos",
    );
    assert.equal(rows[0].n, 0, "sem cobrança não há pedido");
  } finally {
    mp.falhaNoCreate = false;
  }
});

test("checkout grava canastra.pedidos, baixa estoque, persiste CPF e esvazia a sacola", async () => {
  const res = respostaFalsa();
  await PaymentController.createPayment(
    {
      user: { userId: ANA },
      headers: { "idempotency-key": "clique-abc" },
      body: corpoDeCheckout(),
    },
    res,
  );

  assert.equal(res.codigo, 201);
  assert.equal(res.corpo.status, "pendente", "a API fala português");
  assert.ok(res.corpo.orderId);
  assert.equal(res.corpo.ticketUrl, "https://mp.local/pix");
  assert.equal(mp.criacoes.length, 1);
  assert.equal(mp.criacoes[0].transaction_amount, 100);

  // O pedido, nas colunas reais.
  const { rows } = await bd.pool.query(
    `SELECT status, total, chave_idempotencia, metodo_pagamento, itens,
            frete, metodo_envio
       FROM canastra.pedidos WHERE pedido_id = $1`,
    [res.corpo.orderId],
  );
  assert.equal(rows[0].status, "pendente");
  assert.equal(Number(rows[0].total), 100);
  assert.equal(rows[0].chave_idempotencia, `${ANA}:clique-abc`);
  assert.equal(rows[0].itens[0].product_id, PRODUTO);

  // Frete E método são os CONFERIDOS, não o que o corpo mandou. O corpo diz
  // "Retirada na loja"; quem nomeia o método é o atalho de retirada do
  // `conferirFrete`. Antes o método era gravado cru — dava para o pedido nascer
  // com uma etiqueta que ninguém cotou.
  assert.equal(Number(rows[0].frete), 0);
  assert.equal(rows[0].metodo_envio, "Retirada");

  // Estoque reservado: 10 - 2.
  assert.equal(await estoqueDoProduto(), 8);

  // O CPF do corpo foi para `clientes.cpf` (a Onda 2D coleta no front).
  const { rows: cliente } = await bd.pool.query(
    "SELECT cpf FROM canastra.clientes WHERE user_id = $1",
    [ANA],
  );
  assert.equal(cliente[0].cpf, "52998224725");

  // E a sacola esvaziou.
  const { rows: sacola } = await bd.pool.query(
    `SELECT count(*)::int AS n FROM canastra.carrinho_itens ci
      JOIN canastra.carrinhos c ON c.carrinho_id = ci.carrinho_id
     WHERE c.user_id = $1`,
    [ANA],
  );
  assert.equal(sacola[0].n, 0);
});

test("o mesmo Idempotency-Key devolve o pedido existente SEM cobrar de novo", async () => {
  const cobrancasAntes = mp.criacoes.length;
  const estoqueAntes = await estoqueDoProduto();

  const res = respostaFalsa();
  await PaymentController.createPayment(
    {
      user: { userId: ANA },
      headers: { "idempotency-key": "clique-abc" },
      body: corpoDeCheckout(),
    },
    res,
  );

  assert.equal(res.codigo, 200);
  assert.match(res.corpo.message, /já tinha sido processado/i);
  assert.equal(mp.criacoes.length, cobrancasAntes, "não pode haver segunda cobrança");
  assert.equal(await estoqueDoProduto(), estoqueAntes, "nem segunda reserva");
  // O QR do Pix volta no replay (relido do MP): sem ele, a retentativa
  // recebia "já processado" e ficava sem o que pagar.
  assert.equal(res.corpo.ticketUrl, "https://mp.local/pix");

  const { rows } = await bd.pool.query(
    "SELECT count(*)::int AS n FROM canastra.pedidos WHERE chave_idempotencia = $1",
    [`${ANA}:clique-abc`],
  );
  assert.equal(rows[0].n, 1);
});

/* --------------------------------------------------------------------------
 * Webhook
 * -------------------------------------------------------------------------- */

/** O pagamento do checkout acima — o webhook trabalha sobre ele. */
let pagamentoMp;

test("webhook aplica a transição e repete sem efeito (idempotente)", async () => {
  const { rows } = await bd.pool.query(
    "SELECT pagamento_id_mp FROM canastra.pedidos WHERE chave_idempotencia = $1",
    [`${ANA}:clique-abc`],
  );
  pagamentoMp = rows[0].pagamento_id_mp;

  // O checkout acima já disparou o e-mail de "pendente" (comportamento certo);
  // daqui em diante a contagem que interessa é a do webhook.
  emails.deStatus.length = 0;

  mp.statusDoGet = "approved";
  let res = respostaFalsa();
  await PaymentController.receiveWebhook(requisicaoDeWebhook(pagamentoMp), res);
  assert.equal(res.codigo, 200);
  assert.equal(await statusDoPedido(pagamentoMp), "aprovado");
  assert.equal(await estoqueDoProduto(), 8, "aprovado não mexe em estoque");
  assert.equal(emails.deStatus.length, 1);

  // O MP reenvia por desenho: a mesma notificação de novo não muda nada e
  // não manda segundo e-mail.
  res = respostaFalsa();
  await PaymentController.receiveWebhook(requisicaoDeWebhook(pagamentoMp), res);
  assert.equal(res.codigo, 200);
  assert.equal(await statusDoPedido(pagamentoMp), "aprovado");
  assert.equal(emails.deStatus.length, 1, "sem segundo e-mail para o mesmo status");
});

test("ativa→cancelada devolve o estoque UMA vez, nunca duas", async () => {
  mp.statusDoGet = "refunded";

  let res = respostaFalsa();
  await PaymentController.receiveWebhook(requisicaoDeWebhook(pagamentoMp), res);
  assert.equal(res.codigo, 200);
  assert.equal(await statusDoPedido(pagamentoMp), "reembolsado");
  assert.equal(await estoqueDoProduto(), 10, "as 2 unidades voltaram");

  // A REENTREGA da mesma notificação — o furo da auditoria: antes, cada
  // reenvio somava estoque de novo e a prateleira inflava.
  res = respostaFalsa();
  await PaymentController.receiveWebhook(requisicaoDeWebhook(pagamentoMp), res);
  assert.equal(res.codigo, 200);
  assert.equal(await estoqueDoProduto(), 10, "reenvio NÃO devolve de novo");
});

test("cancelada→ativa retira o estoque de volta", async () => {
  mp.statusDoGet = "approved";
  const res = respostaFalsa();
  await PaymentController.receiveWebhook(requisicaoDeWebhook(pagamentoMp), res);
  assert.equal(res.codigo, 200);
  assert.equal(await statusDoPedido(pagamentoMp), "aprovado");
  assert.equal(await estoqueDoProduto(), 8);
});

test("status do MP sem tradução: 200 reconhecido, nada muda", async () => {
  mp.statusDoGet = "alien_status";
  const res = respostaFalsa();
  await PaymentController.receiveWebhook(requisicaoDeWebhook(pagamentoMp), res);
  assert.equal(res.codigo, 200);
  assert.equal(await statusDoPedido(pagamentoMp), "aprovado");
});

test("pagamento sem pedido correspondente: 404, logado", async () => {
  mp.statusDoGet = "approved";
  const res = respostaFalsa();
  await PaymentController.receiveWebhook(requisicaoDeWebhook("MP-NAO-EXISTE"), res);
  assert.equal(res.codigo, 404);
});

test("falha ao reler o pagamento no MP: 500, para o MP reenviar", async () => {
  mp.falhaNoGet = true;
  const res = respostaFalsa();
  await PaymentController.receiveWebhook(requisicaoDeWebhook(pagamentoMp), res);
  assert.equal(res.codigo, 500);
  mp.falhaNoGet = false;
});

test("erro de banco vira 500 — nunca um 200 que faz o MP esquecer", async () => {
  // A versão anterior respondia 200 com o UPDATE falhado por baixo: o MP dava
  // a notificação por entregue e o pedido ficava no status velho para sempre.
  mp.statusDoGet = "cancelled";
  await bd.pool.query("ALTER TABLE canastra.pedidos RENAME TO pedidos_quebrada");
  try {
    const res = respostaFalsa();
    await PaymentController.receiveWebhook(requisicaoDeWebhook(pagamentoMp), res);
    assert.equal(res.codigo, 500);
  } finally {
    await bd.pool.query(
      "ALTER TABLE canastra.pedidos_quebrada RENAME TO pedidos",
    );
  }
  // E, consertado o banco, o reenvio do MP aplica a transição que faltou.
  const res = respostaFalsa();
  await PaymentController.receiveWebhook(requisicaoDeWebhook(pagamentoMp), res);
  assert.equal(res.codigo, 200);
  assert.equal(await statusDoPedido(pagamentoMp), "cancelado");
  assert.equal(await estoqueDoProduto(), 10);
});

/* --------------------------------------------------------------------------
 * Conferência de SUBTOTAL — o preço exibido contra o preço cobrado
 *
 * A sacola guarda `price` no localStorage e nunca o revalida; o servidor cobra
 * o preço do BANCO. O frete já tinha conferência (409 do `conferirFrete`); o
 * preço dos itens não tinha nenhuma — e no cartão o buraco é pior, porque o
 * CardForm é montado com o total da tela e o `transaction_amount` cobrado é o
 * do servidor. Agora o corpo DECLARA o subtotal exibido e o servidor confere.
 *
 * PRODUTO custa R$ 50,00 e o corpo pede 2 → o subtotal do banco é 10000.
 * -------------------------------------------------------------------------- */

test("subtotal divergente do exibido: 409 SEM cobrar e SEM reservar", async () => {
  const cobrancasAntes = mp.criacoes.length;
  const estoqueAntes = await estoqueDoProduto();

  const corpo = corpoDeCheckout();
  // A tela mostrou R$ 90,00 (preço de antes de o gestor mexer); o banco diz 100.
  corpo.subtotalCentavos = 9000;

  const res = respostaFalsa();
  await PaymentController.createPayment(
    { user: { userId: ANA }, headers: {}, body: corpo },
    res,
  );

  assert.equal(res.codigo, 409);
  // Código próprio: é ele que deixa a tela RECARREGAR os preços em vez de só
  // exibir a frase — um 409 de frete pede outra ação.
  assert.equal(res.corpo.error, "PRECO_MUDOU");
  assert.match(res.corpo.details, /preço de um item mudou/i);
  assert.equal(mp.criacoes.length, cobrancasAntes, "não pode cobrar");
  assert.equal(await estoqueDoProduto(), estoqueAntes, "nada reservado");
});

test("um centavo de diferença já é 409: preço não é frete", async () => {
  // O 409 do frete tolera um centavo porque compara com cotação de
  // transportadora, que arredonda. Aqui os dois lados somam
  // `round(preco * 100) * quantidade` sobre a mesma linha do banco.
  const corpo = corpoDeCheckout();
  corpo.subtotalCentavos = 9999;

  const res = respostaFalsa();
  await PaymentController.createPayment(
    { user: { userId: ANA }, headers: {}, body: corpo },
    res,
  );
  assert.equal(res.codigo, 409);
  assert.equal(res.corpo.error, "PRECO_MUDOU");
});

test("subtotal torto é 400 — desarmar a conferência em silêncio seria pior", async () => {
  for (const valor of ["cem reais", -1, 10.5, Number.NaN]) {
    const corpo = corpoDeCheckout();
    corpo.subtotalCentavos = valor;

    const res = respostaFalsa();
    await PaymentController.createPayment(
      { user: { userId: ANA }, headers: {}, body: corpo },
      res,
    );
    assert.equal(res.codigo, 400, `subtotalCentavos=${String(valor)}`);
    assert.match(res.corpo.details, /centavos/i);
  }
});

test("subtotal batendo: 201, e quem cobra continua sendo o servidor", async () => {
  const estoqueAntes = await estoqueDoProduto();
  const corpo = corpoDeCheckout();
  corpo.subtotalCentavos = 10000; // 2 × R$ 50,00 — o que a tela exibiu

  const res = respostaFalsa();
  await PaymentController.createPayment(
    {
      user: { userId: ANA },
      headers: { "idempotency-key": "subtotal-confere" },
      body: corpo,
    },
    res,
  );

  assert.equal(res.codigo, 201);
  // O valor cobrado NÃO sai do campo declarado: ele saiu da releitura travada
  // do banco. O campo só serviu para o servidor saber que a tela estava certa.
  assert.equal(mp.criacoes[mp.criacoes.length - 1].transaction_amount, 100);
  assert.equal(await estoqueDoProduto(), estoqueAntes - 2);
});

test("sem o campo, o pedido passa: o checkout legado ainda não o manda", async () => {
  // Omitir não é buraco de segurança — o valor cobrado nunca sai do campo. É a
  // proteção do CLIENTE que fica sem armar, e recusar o legado seria trocar um
  // defeito de exibição por uma loja que não vende.
  const corpo = corpoDeCheckout();
  assert.equal(corpo.subtotalCentavos, undefined);

  const res = respostaFalsa();
  await PaymentController.createPayment(
    {
      user: { userId: ANA },
      headers: { "idempotency-key": "subtotal-ausente" },
      body: corpo,
    },
    res,
  );
  assert.equal(res.codigo, 201);
});
