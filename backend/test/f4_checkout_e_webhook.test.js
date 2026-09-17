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
/**
 * A MESMA funcao que o controlador usa para montar a chave.
 *
 * Os testes escreviam `${ANA}:clique-abc` a mao, e isso deixou de ser possivel:
 * a forma da chave agora e decidida pelo que a API de Orders aceita em
 * `external_reference` (64 caracteres, so `[A-Za-z0-9_-]`), e o valor tem um
 * resumo SHA-256 dentro. Reimplementar isso aqui seria escrever a regra duas
 * vezes — e a copia do teste passaria a concordar consigo mesma em vez de com
 * o codigo.
 */
const { chaveDeIdempotencia } = require("../src/utils/mercadoPagoOrders.js");
const chaveDe = (clique) => chaveDeIdempotencia({ userId: ANA, chaveDoCliente: clique });

let bd;
let PaymentController;

const ANA = "aaaaaaaa-0000-0000-0000-000000000001";
const PRODUTO = "11111111-0000-0000-0000-0000000000aa";

/** O que o dublê do MP responde; cada teste ajusta. */
const mp = {
  /**
   * id NUMERICO -> `external_reference` da order criada com ele.
   *
   * O DUBLE PRECISA DISSO PORQUE O GATEWAY REAL FAZ ISSO: a notificacao chega
   * com o id numerico do pagamento, `GET /v1/payments/{numerico}` responde com
   * `external_reference`, e e por esse campo que o webhook reencontra o pedido
   * (a loja grava o id da ORDER em `pagamento_id_mp`, que e outro id).
   */
  referencias: {},
  statusDoGet: "approved",
  /** O que `order.create` responde. `action_required` = Pix esperando. */
  statusDaOrder: "action_required",
  detalheDaOrder: "waiting_transfer",
  falhaNoGet: false,
  falhaNoCreate: false,
  criacoes: [],
  /**
   * O SEGUNDO argumento de `payment.create`, um por criação e no mesmo índice
   * de `mp.criacoes`. Array separado de propósito: `mp.criacoes` guarda o
   * `body` e é lido por asserções em dois arquivos de teste — mudar a forma
   * dele para `{ body, requestOptions }` quebraria todas elas de uma vez.
   */
  opcoes: [],
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

/**
 * Repõe o estoque do produto de teste para `qtd` unidades.
 *
 * O produto semeia com 10 e cada checkout de sucesso consome 2; os testes que
 * só querem verificar o CORPO mandado ao Mercado Pago (não o estoque em si)
 * ficam sem headroom depois de alguns checkouts de sucesso rodarem antes
 * deles no arquivo. NÃO virou `beforeEach`: alguns testes aqui testam
 * justamente o ESGOTAMENTO do estoque, e um reset cego por teste quebraria
 * exatamente o que eles verificam.
 */
async function reporEstoque(qtd = 10) {
  await bd.pool.query(
    "UPDATE canastra.produtos SET quantidade = $1 WHERE produto_id = $2",
    [qtd, PRODUTO],
  );
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
              external_reference: mp.referencias[id],
              // O MP devolve o QR do Pix também na releitura — é o que o
              // replay de idempotência usa para repor o ticketUrl.
              point_of_interaction: {
                transaction_data: { ticket_url: "https://mp.local/pix" },
              },
            };
          },
        },
        /**
         * A CRIACAO MUDOU DE ENDPOINT, e por isso o duble tem dois objetos.
         *
         * `POST /v1/payments` responde 401 nesta aplicacao (ela e Orders); quem
         * cria cobranca agora e `order.create`. `payment.get` FICA no duble
         * acima porque o webhook continua relendo pelo endpoint antigo, com o
         * id NUMERICO e o vocabulario legado — medido, nao suposto.
         */
        order: {
          create: async ({ body, requestOptions }) => {
            if (mp.falhaNoCreate) throw new Error("gateway caiu");
            mp.criacoes.push(body);
            mp.referencias[900000 + mp.criacoes.length] = body.external_reference;
            mp.opcoes.push(requestOptions || null);
            const ehPix = body.transactions.payments[0].payment_method.id === "pix";
            return {
              id: `ORDTST0${900000 + mp.criacoes.length}`,
              status: mp.statusDaOrder,
              status_detail: mp.detalheDaOrder,
              external_reference: body.external_reference,
              transactions: {
                payments: [
                  {
                    id: `PAY0${900000 + mp.criacoes.length}`,
                    status: mp.statusDaOrder,
                    payment_method: {
                      id: body.transactions.payments[0].payment_method.id,
                      ...(ehPix
                        ? {
                            ticket_url: "https://mp.local/pix",
                            qr_code: "00020126580014br.gov.bcb.pix",
                            qr_code_base64: "iVBORw0KGgo=",
                          }
                        : {}),
                    },
                  },
                ],
              },
            };
          },
          get: async ({ id }) => {
            if (mp.falhaNoGet) throw new Error("MP fora do ar");
            return {
              id,
              status: mp.statusDaOrder,
              status_detail: mp.detalheDaOrder,
              transactions: {
                payments: [
                  {
                    payment_method: {
                      id: "pix",
                      ticket_url: "https://mp.local/pix",
                      qr_code: "00020126580014br.gov.bcb.pix",
                    },
                  },
                ],
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
  assert.equal(mp.criacoes[0].total_amount, "100.00", "Orders fala string de duas casas");

  // O pedido, nas colunas reais.
  const { rows } = await bd.pool.query(
    `SELECT status, total, chave_idempotencia, metodo_pagamento, itens,
            frete, metodo_envio
       FROM canastra.pedidos WHERE pedido_id = $1`,
    [res.corpo.orderId],
  );
  assert.equal(rows[0].status, "pendente");
  assert.equal(Number(rows[0].total), 100);
  assert.equal(rows[0].chave_idempotencia, chaveDe("clique-abc"));
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
    [chaveDe("clique-abc")],
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
    [chaveDe("clique-abc")],
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
  assert.equal(mp.criacoes[mp.criacoes.length - 1].total_amount, "100.00");
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

test("checkout: a cobrança leva a chave de idempotência ao Mercado Pago", async () => {
  /**
   * Sem isto, o duplo clique que vence a corrida cobra DUAS vezes no gateway
   * e a loja só descobre pelo log de "PAGAMENTO DUPLICADO", que pede estorno
   * manual. Com a chave, o MP devolve o MESMO pagamento na segunda chamada.
   */
  const antes = mp.criacoes.length;
  const res = respostaFalsa();
  await PaymentController.createPayment(
    {
      user: { userId: ANA },
      headers: { "idempotency-key": "clique-idem-mp" },
      body: corpoDeCheckout(),
    },
    res,
  );

  assert.equal(res.codigo, 201);
  assert.equal(mp.criacoes.length, antes + 1);
  assert.equal(
    mp.opcoes[mp.opcoes.length - 1]?.idempotencyKey,
    chaveDe("clique-idem-mp"),
    "a chave tem que ser a MESMA que a linha do pedido grava",
  );
});

test("checkout: external_reference liga o pagamento à linha do pedido", async () => {
  const res = respostaFalsa();
  await PaymentController.createPayment(
    {
      user: { userId: ANA },
      headers: { "idempotency-key": "clique-ref" },
      body: corpoDeCheckout(),
    },
    res,
  );

  assert.equal(res.codigo, 201);
  const cobranca = mp.criacoes[mp.criacoes.length - 1];
  assert.equal(cobranca.external_reference, chaveDe("clique-ref"));

  // O que torna a conciliação possível: o campo do painel do MP e a coluna do
  // pedido guardam o MESMO valor.
  const { rows } = await bd.pool.query(
    "SELECT chave_idempotencia FROM canastra.pedidos WHERE pedido_id = $1",
    [res.corpo.orderId],
  );
  assert.equal(rows[0].chave_idempotencia, cobranca.external_reference);
});

test("checkout: a fatura do cliente traz o nome da loja", async () => {
  const res = respostaFalsa();
  await PaymentController.createPayment(
    {
      user: { userId: ANA },
      headers: { "idempotency-key": "clique-descritor" },
      body: corpoDeCheckout(),
    },
    res,
  );

  assert.equal(res.codigo, 201);
  const cobranca = mp.criacoes[mp.criacoes.length - 1];
  // NA ORDERS O DESCRITOR DESCEU: era campo de topo na Payments, agora mora em
  // `transactions.payments[].payment_method`. O limite de 13 nao mudou, e ele
  // continua sendo o unico campo da integracao que falha FECHADO.
  const descritor =
    cobranca.transactions.payments[0].payment_method.statement_descriptor;
  assert.ok(
    descritor.length <= 13,
    "o Mercado Pago corta o descritor em 13 caracteres",
  );
  assert.equal(descritor, "CAFECANASTRA");
});

test("checkout: os itens e o endereço vão ao antifraude na forma da Orders", async () => {
  await reporEstoque();

  const res = respostaFalsa();
  await PaymentController.createPayment(
    {
      user: { userId: ANA },
      headers: { "idempotency-key": "clique-info" },
      body: corpoDeCheckout(),
      ip: "203.0.113.7",
    },
    res,
  );

  assert.equal(res.codigo, 201);
  const cobranca = mp.criacoes[mp.criacoes.length - 1];

  // O nome sai de canastra.clientes; o before() cadastrou Ana sem sobrenome.
  assert.equal(cobranca.payer.first_name, "Ana");
  // AUSENTE de verdade, não `undefined` explícito: campo vazio é pior que
  // campo ausente para o motor de risco, e `=== undefined` passaria também
  // se o código mandasse `last_name: undefined`.
  assert.equal(
    Object.prototype.hasOwnProperty.call(cobranca.payer, "last_name"),
    false,
    "Ana não tem sobrenome cadastrado: last_name não pode nem existir na chave",
  );

  // OS ITENS SUBIRAM PARA O TOPO. Na Payments eles eram enfeite de antifraude
  // dentro de `additional_info` e podiam divergir do valor cobrado a vontade;
  // na Orders eles SAO o valor cobrado — `sum(unit_price x quantity)` tem de
  // fechar com `total_amount`, ou e 400 `order_items_total_amount_mismatch`.
  const itens = cobranca.items;
  assert.equal(itens[0].title, "Café do Teste");
  assert.equal(itens[0].quantity, 2);
  // O IDENTIFICADOR E O SKU, e nao o `product_id`: o UUID tem 36 caracteres e
  // `external_code` aceita 30 ("length must be <= 30, but got 36", 400 real).
  // O produto deste teste tem SKU cadastrado, entao ele viaja.
  assert.equal(itens[0].external_code, "WEBHOOK-1");
  assert.ok(itens[0].external_code.length <= 30);

  // O ENDERECO E O DO PAGADOR, e so. `additional_info.shipments` nao existe na
  // Orders: "additionalProperties '$.shipments' not allowed", 400 medido.
  assert.equal(cobranca.payer.zip_code, undefined);
  assert.equal(cobranca.payer.address.zip_code, "35012345");
});

test("checkout: endereço sem número não quebra a cobrança nem manda lixo ao Mercado Pago", async () => {
  await reporEstoque();

  const corpo = corpoDeCheckout();
  // Endereço sem número existe de verdade (zona rural, "S/N") — e
  // `canastra.enderecos.numero` é opcional (migração 0004), nada no checkout
  // obriga a informar um.
  delete corpo.address.number;

  const res = respostaFalsa();
  await PaymentController.createPayment(
    {
      user: { userId: ANA },
      headers: { "idempotency-key": "clique-sem-numero" },
      body: corpo,
    },
    res,
  );

  assert.equal(res.codigo, 201, "endereço sem número não pode derrubar o checkout");
  const cobranca = mp.criacoes[mp.criacoes.length - 1];

  // `street_number` é Integer no contrato do Mercado Pago e a API valida:
  // mandar "" ou NaN faria uma cobrança legítima levar 400 do gateway. A
  // chave tem que estar AUSENTE, não `undefined` explícito.
  assert.equal(
    Object.prototype.hasOwnProperty.call(cobranca.payer.address, "street_number"),
    false,
    "payer.address.street_number não pode existir sem número",
  );
});

test("checkout: o device id do navegador chega ao Mercado Pago", async () => {
  await reporEstoque();

  const corpo = corpoDeCheckout();
  corpo.deviceId = "dev-sessao-abc";
  const res = respostaFalsa();
  await PaymentController.createPayment(
    {
      user: { userId: ANA },
      headers: { "idempotency-key": "clique-device" },
      body: corpo,
    },
    res,
  );

  assert.equal(res.codigo, 201);
  assert.equal(
    mp.opcoes[mp.opcoes.length - 1]?.meliSessionId,
    "dev-sessao-abc",
  );
});

test("checkout: sem device id a cobrança sai do mesmo jeito", async () => {
  // Bloqueador de script no navegador. Recusar aqui seria trocar uma melhoria
  // de aprovação por uma venda perdida.
  await reporEstoque();

  const res = respostaFalsa();
  await PaymentController.createPayment(
    {
      user: { userId: ANA },
      headers: { "idempotency-key": "clique-sem-device" },
      body: corpoDeCheckout(),
    },
    res,
  );

  assert.equal(res.codigo, 201);
  // AUSENTE de verdade, não `undefined` explícito — mesmo motivo dos dois
  // testes de `street_number` acima: `=== undefined` também passaria se o
  // código mandasse `meliSessionId: undefined`.
  assert.equal(
    Object.prototype.hasOwnProperty.call(
      mp.opcoes[mp.opcoes.length - 1] || {},
      "meliSessionId",
    ),
    false,
    "sem deviceId no corpo, meliSessionId não pode nem existir na chave",
  );
});

test("checkout: deviceId acima de 128 caracteres não vai ao Mercado Pago, mas a cobrança sai do mesmo jeito", async () => {
  // Mesmo limite da `chaveDoCliente` (PaymentController.js): acima de 128
  // caracteres a chave nem entra no payload, em vez de forçar o SDK a
  // tentar e falhar com uma entrada malformada. Falhar aberto continua
  // sendo a regra — o fingerprint é uma melhoria de aprovação, nunca um
  // motivo para travar a cobrança.
  await reporEstoque();

  const corpo = corpoDeCheckout();
  corpo.deviceId = "a".repeat(129);
  const res = respostaFalsa();
  await PaymentController.createPayment(
    {
      user: { userId: ANA },
      headers: { "idempotency-key": "clique-device-longo" },
      body: corpo,
    },
    res,
  );

  assert.equal(res.codigo, 201, "deviceId longo demais não pode derrubar a cobrança");
  assert.equal(
    Object.prototype.hasOwnProperty.call(
      mp.opcoes[mp.opcoes.length - 1] || {},
      "meliSessionId",
    ),
    false,
    "deviceId acima do limite não pode nem existir na chave",
  );
});

test("checkout: o street_number vai como STRING — na Orders é o oposto", async () => {
  // NA PAYMENTS ERA INTEIRO e a API validava: "expected integer". NA ORDERS é
  // string e a API valida o contrário: "'$.payer.address.street_number' -
  // expected string, but got number", 400 medido em 16/09/2026. Um checkout
  // que mandasse o número como número levaria 400 em TODO pedido com endereço.
  await reporEstoque();

  const res = respostaFalsa();
  await PaymentController.createPayment(
    {
      user: { userId: ANA },
      headers: { "idempotency-key": "clique-numero-string" },
      body: corpoDeCheckout(),
      ip: "203.0.113.7",
    },
    res,
  );

  assert.equal(res.codigo, 201);
  const cobranca = mp.criacoes[mp.criacoes.length - 1];
  assert.equal(typeof cobranca.payer.address.street_number, "string");
});

test("checkout: a soma dos itens fecha com o total, frete e desconto inclusos", async () => {
  // A regra que a Payments nunca teve. Frete vira LINHA DE ITEM; sem isso o
  // gateway recusa a order inteira com `order_items_total_amount_mismatch`.
  await reporEstoque();

  const res = respostaFalsa();
  await PaymentController.createPayment(
    {
      user: { userId: ANA },
      headers: { "idempotency-key": "clique-soma" },
      body: corpoDeCheckout(),
    },
    res,
  );

  assert.equal(res.codigo, 201);
  const cobranca = mp.criacoes[mp.criacoes.length - 1];
  const soma = cobranca.items.reduce(
    (t, i) => t + Math.round(Number(i.unit_price) * 100) * i.quantity,
    0,
  );
  assert.equal(soma, Math.round(Number(cobranca.total_amount) * 100));
});

test("checkout: o pedido grava o id da ORDER, que é o único relegível", async () => {
  // `GET /v1/payments/PAY01...` responde 404; `GET /v1/orders/{id}` responde
  // 200. `pagamento_id_mp` já é `text` desde a 0005, então cabe sem migração.
  await reporEstoque();

  const res = respostaFalsa();
  await PaymentController.createPayment(
    {
      user: { userId: ANA },
      headers: { "idempotency-key": "clique-id-order" },
      body: corpoDeCheckout(),
    },
    res,
  );

  assert.equal(res.codigo, 201);
  const { rows } = await bd.pool.query(
    "SELECT pagamento_id_mp FROM canastra.pedidos WHERE pedido_id = $1",
    [res.corpo.orderId],
  );
  assert.match(rows[0].pagamento_id_mp, /^ORDTST0/);
});

test("checkout: o Pix devolve o copia-e-cola, não só a URL do ticket", async () => {
  // O QR mudou de lugar (`point_of_interaction` → `payment_method`) e passou a
  // vir em três formas. A tela ganha o código copiável de graça nesta migração.
  await reporEstoque();

  const res = respostaFalsa();
  await PaymentController.createPayment(
    {
      user: { userId: ANA },
      headers: { "idempotency-key": "clique-qr" },
      body: corpoDeCheckout(),
    },
    res,
  );

  assert.equal(res.codigo, 201);
  assert.equal(res.corpo.ticketUrl, "https://mp.local/pix");
  assert.equal(res.corpo.qrCode, "00020126580014br.gov.bcb.pix");
});

/* --------------------------------------------------------------------------
 * A NOTIFICAÇÃO DA API DE ORDERS
 *
 * MEDIDA em 17/09/2026, contra a aplicação real. Uma aplicação de Orders NÃO
 * notifica `type: "payment"` com id numérico — ela notifica:
 *
 *   type   : "order"
 *   action : "order.processed"
 *   data.id: "ORDTST01M2PSGY..."   ← o MESMO id que a loja grava
 *
 * O webhook saía pela primeira linha (`if (type !== "payment") return 200`):
 * reconhecia a notificação, respondia 200 e não fazia NADA. Pedido pago que
 * nunca sai de "pendente" é o defeito que esta integração inteira existe para
 * não ter — e ele era silencioso dos dois lados, porque o painel do Mercado
 * Pago mostrava a entrega como bem-sucedida.
 * -------------------------------------------------------------------------- */

/** A notificação no formato que a aplicação de Orders realmente envia. */
function notificacaoDeOrder(orderId) {
  return {
    headers: { "x-request-id": "req-order" },
    query: { "data.id": orderId, type: "order" },
    body: {
      action: "order.processed",
      api_version: "v1",
      type: "order",
      data: { id: orderId, status: "processed", status_detail: "accredited" },
    },
    ip: "127.0.0.1",
  };
}

test("webhook de `order` aplica a transição — não é mais ignorado em silêncio", async () => {
  await reporEstoque();

  const criacao = respostaFalsa();
  await PaymentController.createPayment(
    {
      user: { userId: ANA },
      headers: { "idempotency-key": "clique-webhook-order" },
      body: corpoDeCheckout(),
    },
    criacao,
  );
  assert.equal(criacao.codigo, 201);

  const { rows: antes } = await bd.pool.query(
    "SELECT status, pagamento_id_mp FROM canastra.pedidos WHERE pedido_id = $1",
    [criacao.corpo.orderId],
  );
  assert.equal(antes[0].status, "pendente");

  // A order é RELIDA da API — o status nunca sai do corpo da notificação, que
  // é público. O dublê responde `processed/accredited`.
  mp.statusDaOrder = "processed";
  mp.detalheDaOrder = "accredited";
  const res = respostaFalsa();
  await PaymentController.receiveWebhook(notificacaoDeOrder(antes[0].pagamento_id_mp), res);
  mp.statusDaOrder = "action_required";
  mp.detalheDaOrder = "waiting_transfer";

  assert.equal(res.codigo, 200);
  const { rows: depois } = await bd.pool.query(
    "SELECT status FROM canastra.pedidos WHERE pedido_id = $1",
    [criacao.corpo.orderId],
  );
  assert.equal(depois[0].status, "aprovado", "o pedido tem de sair de pendente");
});

test("webhook de `order` repetido não produz efeito duas vezes", async () => {
  await reporEstoque();

  const criacao = respostaFalsa();
  await PaymentController.createPayment(
    {
      user: { userId: ANA },
      headers: { "idempotency-key": "clique-webhook-order-2" },
      body: corpoDeCheckout(),
    },
    criacao,
  );
  const { rows } = await bd.pool.query(
    "SELECT pagamento_id_mp FROM canastra.pedidos WHERE pedido_id = $1",
    [criacao.corpo.orderId],
  );

  mp.statusDaOrder = "canceled";
  mp.detalheDaOrder = null;
  const estoqueAntes = await estoqueDoProduto();

  const um = respostaFalsa();
  await PaymentController.receiveWebhook(notificacaoDeOrder(rows[0].pagamento_id_mp), um);
  const devolvido = await estoqueDoProduto();

  const dois = respostaFalsa();
  await PaymentController.receiveWebhook(notificacaoDeOrder(rows[0].pagamento_id_mp), dois);

  mp.statusDaOrder = "action_required";
  mp.detalheDaOrder = "waiting_transfer";

  assert.equal(um.codigo, 200);
  assert.equal(dois.codigo, 200);
  assert.equal(devolvido, estoqueAntes + 2, "o cancelamento devolveu o estoque");
  assert.equal(await estoqueDoProduto(), devolvido, "o reenvio NÃO devolve de novo");
});

test("notificação de tipo que a loja não trata continua sendo 200 sem efeito", async () => {
  const res = respostaFalsa();
  await PaymentController.receiveWebhook(
    {
      headers: { "x-request-id": "req-x" },
      query: {},
      body: { type: "subscription_preapproval", data: { id: "x" } },
      ip: "127.0.0.1",
    },
    res,
  );
  assert.equal(res.codigo, 200);
});
