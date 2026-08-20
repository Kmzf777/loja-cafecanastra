"use strict";

/**
 * Onda 2E — os dois endpoints novos do painel de pedidos:
 *
 *  - `GET /my-orders/:id`: dono OU admin veem `{ order }`; QUALQUER outra
 *    situação (pedido alheio, id malformado, id inexistente) responde o MESMO
 *    404 — a rota não pode render nem um bit sobre a existência de pedido de
 *    terceiro.
 *  - `GET /admin/orders/export`: CSV para o Excel pt-BR — BOM, `;`, vírgula
 *    decimal, célula escapada e guarda contra injeção de fórmula.
 *
 * Padrão de f4_repositorios.test.js: Postgres embarcado, require de `src/`
 * DENTRO do before() (o pgPool lê DATABASE_URL no momento do require).
 */

const { test, before, after, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const { subirPostgres } = require("./ajuda/postgres.js");
const { aplicarMigracoes } = require("../db/migrar.js");
const {
  gerarCsvDePedidos,
  celula,
  BOM,
} = require("../src/utils/csvDePedidos.js");

let bd;
let OrderRepository;
let OrderController;

const ANA = "aaaaaaaa-0000-0000-0000-000000000001";
const BETO = "bbbbbbbb-0000-0000-0000-000000000002";
const DORA = "dddddddd-0000-0000-0000-000000000004";

let pedidoDaAna; // criado no before, usado pelos testes de detalhe
let pedidoAntigo; // criado_em em 2020, para o filtro de data do export
let pedidoComCupom; // CAFE10 / desconto 6.74 — detalhe, listas e CSV
let pedidoLimite; // 23:59 de 2026-09-10 em São Paulo = 02:59 do dia 11 em UTC

/** Dublê de `res` com o que o controller usa: status/json/send/setHeader. */
function respostaFalsa() {
  const res = { codigo: null, corpo: null, cabecalhos: {} };
  res.status = (codigo) => {
    res.codigo = codigo;
    return res;
  };
  res.json = (corpo) => {
    if (res.codigo === null) res.codigo = 200;
    res.corpo = corpo;
    return res;
  };
  res.send = (corpo) => {
    if (res.codigo === null) res.codigo = 200;
    res.corpo = corpo;
    return res;
  };
  res.setHeader = (nome, valor) => {
    res.cabecalhos[nome.toLowerCase()] = valor;
    return res;
  };
  return res;
}

before(async () => {
  bd = await subirPostgres();
  await aplicarMigracoes(bd.pool);

  await bd.pool.query(
    `INSERT INTO auth.users (id, email) VALUES
       ($1, 'ana@ex.com'), ($2, 'beto@ex.com'), ($3, 'dora@ex.com')`,
    [ANA, BETO, DORA],
  );
  // O nome da Ana começa com "=" e carrega ";" DE PROPÓSITO: nome de cliente
  // é texto de fora, e é exatamente o vetor da injeção de fórmula no Excel.
  await bd.pool.query(
    `INSERT INTO canastra.clientes (user_id, nome, cpf) VALUES
       ($1, '=SOMA(1;2)', '52998224725'),
       ($2, 'Beto', NULL),
       ($3, 'Dora', NULL)`,
    [ANA, BETO, DORA],
  );
  await bd.pool.query("INSERT INTO canastra.admins (user_id) VALUES ($1)", [
    DORA,
  ]);

  process.env.DATABASE_URL = bd.connectionString;

  OrderRepository = require("../src/repositories/ordersRepository.js");
  OrderController = require("../src/controllers/OrderController.js");

  pedidoDaAna = await OrderRepository.createOrder({
    userId: ANA,
    totalAmount: 67.4,
    items: [
      {
        product_id: "11111111-0000-0000-0000-000000000001",
        quantity: 2,
        price: 27.45,
        name: "Clássico",
        size: "250g moído",
      },
    ],
    paymentMethod: "pix",
    paymentIdMp: "MP-2E-1",
    address_json: { zip_code: "35012345", street: "Rua X" },
    shippingCost: 12.5,
    shippingMethod: "Correios PAC",
    chaveIdempotencia: "onda2e-detalhe",
  });

  // Pedido de 2020, inserido direto para controlar `criado_em`: é ele que o
  // filtro `de` do export tem de deixar de fora.
  const { rows } = await bd.pool.query(
    `INSERT INTO canastra.pedidos
       (pedido_id, user_id, total, status, chave_idempotencia, criado_em)
     VALUES (gen_random_uuid(), $1, 999.99, 'entregue', 'onda2e-antigo',
             '2020-06-15T12:00:00Z')
     RETURNING pedido_id`,
    [BETO],
  );
  pedidoAntigo = rows[0].pedido_id;

  const comCupom = await bd.pool.query(
    `INSERT INTO canastra.pedidos
       (pedido_id, user_id, total, status, chave_idempotencia,
        cupom_codigo, desconto)
     VALUES (gen_random_uuid(), $1, 60.66, 'aprovado', 'onda2e-cupom',
             'CAFE10', 6.74)
     RETURNING pedido_id`,
    [ANA],
  );
  pedidoComCupom = comCupom.rows[0].pedido_id;

  // O caso que separa "dia do gestor" de "dia de UTC": 23:59 de 10/09 em
  // São Paulo já é 02:59 de 11/09 em UTC. O filtro do export tem de tratá-lo
  // como pedido DO DIA 10 — que é a data que o próprio CSV imprime.
  const limite = await bd.pool.query(
    `INSERT INTO canastra.pedidos
       (pedido_id, user_id, total, status, chave_idempotencia, criado_em)
     VALUES (gen_random_uuid(), $1, 111.11, 'aprovado', 'onda2e-limite',
             '2026-09-10T23:59:00-03:00')
     RETURNING pedido_id`,
    [BETO],
  );
  pedidoLimite = limite.rows[0].pedido_id;
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
 * O util de CSV (puro, sem banco)
 * -------------------------------------------------------------------------- */

test("celula: escapa separador/aspas e prefixa fórmula com apóstrofo", () => {
  assert.equal(celula("Clássico"), "Clássico");
  // `;` é o separador: a célula inteira vai para aspas.
  assert.equal(celula("a;b"), '"a;b"');
  // Aspas internas dobram.
  assert.equal(celula('moído "fino"'), '"moído ""fino"""');
  // Injeção de fórmula: =, +, -, @ no início viram texto com apóstrofo.
  assert.equal(celula("=1+1"), "'=1+1");
  assert.equal(celula("+55 35 9999"), "'+55 35 9999");
  assert.equal(celula("-1"), "'-1");
  assert.equal(celula("@import"), "'@import");
  // As duas regras compostas: guarda primeiro, aspas depois.
  assert.equal(celula("=SOMA(1;2)"), "\"'=SOMA(1;2)\"");
  assert.equal(celula(null), "");
});

test("gerarCsvDePedidos: BOM, cabeçalho, resumo de itens e vírgula decimal", () => {
  const csv = gerarCsvDePedidos([
    {
      order_id: "abc",
      created_at: "2026-08-20T12:00:00Z",
      user_name: "Ana",
      user_email: "ana@ex.com",
      user_cpf: "52998224725",
      status: "aprovado",
      items: [
        { name: "Clássico", size: "250g moído", quantity: 2, price: 27.45 },
        { name: "Kit Degustação", quantity: 1, price: 89.9 },
      ],
      coupon_code: "CAFE10",
      discount: 5,
      shipping_cost: 12.5,
      total_amount: 152.3,
      payment_method: "pix",
      tracking_code: "BR123",
    },
  ]);

  assert.ok(csv.startsWith(BOM), "o Excel pt-BR exige o BOM UTF-8");
  const linhas = csv.slice(BOM.length).split("\r\n");
  assert.equal(
    linhas[0],
    "pedido;data;cliente;email;cpf;status;itens;subtotal;cupom;desconto;frete;total;metodo_pagamento;rastreio",
  );
  // O resumo junta os itens numa célula; como contém ";", ela sai aspada.
  assert.ok(
    linhas[1].includes('"2x Clássico 250g moído; 1x Kit Degustação"'),
    `resumo de itens ausente em: ${linhas[1]}`,
  );
  // Subtotal = 2×27,45 + 89,90 = 144,80; cupom entre subtotal e desconto.
  assert.ok(linhas[1].includes("144,80;CAFE10;5,00;12,50;152,30"));
});

/* --------------------------------------------------------------------------
 * GET /my-orders/:id
 * -------------------------------------------------------------------------- */

test("dono vê o próprio pedido em { order }, no contrato da listagem", async () => {
  const res = respostaFalsa();
  await OrderController.getOrderDetail(
    { params: { id: pedidoDaAna.order_id }, user: { userId: ANA, ehAdmin: false } },
    res,
  );

  assert.equal(res.codigo, 200);
  const { order } = res.corpo;
  assert.equal(order.order_id, pedidoDaAna.order_id);
  assert.equal(order.status, "pendente");
  assert.equal(Number(order.total_amount), 67.4);
  assert.equal(order.payment_method, "pix");
  assert.equal(order.shipping_method, "Correios PAC");
  assert.equal(order.address_json.zip_code, "35012345");
  // Pedido sem cupom: `cupom_codigo` é NULL e `desconto` tem DEFAULT 0
  // (0010) — é assim que painel e vitrine detectam "não houve cupom"
  // (`if (order.coupon_code)` / `Number(order.discount) > 0`).
  assert.equal(order.coupon_code, null);
  assert.equal(Number(order.discount), 0);
});

test("pedido com cupom expõe coupon_code e discount no detalhe", async () => {
  const res = respostaFalsa();
  await OrderController.getOrderDetail(
    { params: { id: pedidoComCupom }, user: { userId: ANA, ehAdmin: false } },
    res,
  );

  assert.equal(res.codigo, 200);
  assert.equal(res.corpo.order.coupon_code, "CAFE10");
  assert.equal(Number(res.corpo.order.discount), 6.74);

  // A LISTA do cliente (GET /my-orders) carrega os mesmos campos — é dela
  // que a conta e a página de confirmação leem o cupom sem segunda ida.
  const lista = await OrderRepository.getOrdersByUser(ANA);
  const comCupom = lista.find((o) => o.order_id === pedidoComCupom);
  assert.ok(comCupom, "o pedido com cupom aparece na lista do dono");
  assert.equal(comCupom.coupon_code, "CAFE10");
  assert.equal(Number(comCupom.discount), 6.74);

  // E a listagem do ADMIN também (o modal de detalhe do painel exibe).
  const admin = await OrderRepository.getAllOrders(1, 100);
  const linhaAdmin = admin.data.find((o) => o.order_id === pedidoComCupom);
  assert.ok(linhaAdmin, "o pedido com cupom aparece na lista do admin");
  assert.equal(linhaAdmin.coupon_code, "CAFE10");
  assert.equal(Number(linhaAdmin.discount), 6.74);
});

test("pedido de OUTRO usuário responde o MESMO 404 de inexistente", async () => {
  const resAlheio = respostaFalsa();
  await OrderController.getOrderDetail(
    { params: { id: pedidoDaAna.order_id }, user: { userId: BETO, ehAdmin: false } },
    resAlheio,
  );

  const resInexistente = respostaFalsa();
  await OrderController.getOrderDetail(
    {
      params: { id: "99999999-9999-4999-8999-999999999999" },
      user: { userId: BETO, ehAdmin: false },
    },
    resInexistente,
  );

  // 404 nos dois, com o MESMO corpo: um 403 (ou uma mensagem diferente)
  // confirmaria a um curioso que aquele UUID existe.
  assert.equal(resAlheio.codigo, 404);
  assert.equal(resInexistente.codigo, 404);
  assert.deepEqual(resAlheio.corpo, resInexistente.corpo);
});

test("admin vê pedido de qualquer cliente", async () => {
  const res = respostaFalsa();
  await OrderController.getOrderDetail(
    { params: { id: pedidoDaAna.order_id }, user: { userId: DORA, ehAdmin: true } },
    res,
  );
  assert.equal(res.codigo, 200);
  assert.equal(res.corpo.order.order_id, pedidoDaAna.order_id);
});

test("id malformado é 404, não 500 de cast (22P02)", async () => {
  const res = respostaFalsa();
  await OrderController.getOrderDetail(
    { params: { id: "nao-e-uuid" }, user: { userId: ANA, ehAdmin: false } },
    res,
  );
  assert.equal(res.codigo, 404);
});

/* --------------------------------------------------------------------------
 * GET /admin/orders/export
 * -------------------------------------------------------------------------- */

test("export sem filtro traz todos os pedidos, com cabeçalhos de download", async () => {
  const res = respostaFalsa();
  await OrderController.exportOrdersCsv({ query: {} }, res);

  assert.equal(res.codigo, 200);
  assert.equal(res.cabecalhos["content-type"], "text/csv; charset=utf-8");
  assert.match(
    res.cabecalhos["content-disposition"],
    /^attachment; filename="pedidos\.csv"$/,
  );

  assert.ok(res.corpo.startsWith(BOM));
  assert.ok(res.corpo.includes(pedidoDaAna.order_id));
  assert.ok(res.corpo.includes(pedidoAntigo));
  // O nome-fórmula da Ana chega neutralizado: apóstrofo + aspas.
  assert.ok(
    res.corpo.includes("\"'=SOMA(1;2)\""),
    "o nome começando com '=' tem de sair com guarda de fórmula",
  );
  // E-mail vem do GoTrue, CPF de canastra.clientes.
  assert.ok(res.corpo.includes("ana@ex.com"));
  assert.ok(res.corpo.includes("52998224725"));
  // Itens resumidos e dinheiro em vírgula.
  assert.ok(res.corpo.includes("2x Clássico 250g moído"));
  assert.ok(res.corpo.includes("67,40"));

  // Pedido SEM cupom: célula de cupom vazia e desconto "0,00" — a coluna
  // existe em toda linha, não só nas que têm cupom (senão o Excel desalinha).
  const linhaDaAna = res.corpo
    .split("\r\n")
    .find((l) => l.startsWith(pedidoDaAna.order_id));
  assert.ok(linhaDaAna, "a linha do pedido da Ana existe no CSV");
  assert.ok(
    linhaDaAna.includes(";;0,00;12,50;67,40;"),
    `cupom vazio + desconto 0,00 ausentes em: ${linhaDaAna}`,
  );

  // Pedido COM cupom: código e desconto nas colunas novas.
  const linhaComCupom = res.corpo
    .split("\r\n")
    .find((l) => l.startsWith(pedidoComCupom));
  assert.ok(linhaComCupom, "a linha do pedido com cupom existe no CSV");
  assert.ok(
    linhaComCupom.includes(";CAFE10;6,74;"),
    `cupom e desconto ausentes em: ${linhaComCupom}`,
  );
});

test("o dia do filtro é o de São Paulo, não o de UTC", async () => {
  // O pedido-limite nasceu 23:59 de 10/09 em São Paulo (02:59 de 11/09 em
  // UTC) — e o CSV imprime a data em São Paulo. "Até 10/09" TEM de trazê-lo…
  const dia10 = respostaFalsa();
  await OrderController.exportOrdersCsv(
    { query: { de: "2026-09-10", ate: "2026-09-10" } },
    dia10,
  );
  assert.equal(dia10.codigo, 200);
  assert.ok(
    dia10.corpo.includes(pedidoLimite),
    "o pedido de 23:59 (SP) pertence ao dia 10 do gestor",
  );

  // …e "de 11/09" tem de deixá-lo de fora — em UTC ele seria do dia 11.
  const dia11 = respostaFalsa();
  await OrderController.exportOrdersCsv(
    { query: { de: "2026-09-11", ate: "2026-09-11" } },
    dia11,
  );
  assert.equal(dia11.codigo, 200);
  assert.ok(!dia11.corpo.includes(pedidoLimite));
});

test("o filtro de/ate corta o pedido de 2020 e nomeia o arquivo", async () => {
  const res = respostaFalsa();
  await OrderController.exportOrdersCsv(
    { query: { de: "2026-01-01", ate: "2026-12-31" } },
    res,
  );

  assert.equal(res.codigo, 200);
  assert.match(
    res.cabecalhos["content-disposition"],
    /filename="pedidos-de-2026-01-01-ate-2026-12-31\.csv"/,
  );
  assert.ok(res.corpo.includes(pedidoDaAna.order_id));
  assert.ok(!res.corpo.includes(pedidoAntigo));
});

test("data em formato inválido é 400 com frase, nunca filtro ignorado", async () => {
  const res = respostaFalsa();
  await OrderController.exportOrdersCsv(
    { query: { de: "20/08/2026" } },
    res,
  );
  assert.equal(res.codigo, 400);
  assert.match(res.corpo.error, /YYYY-MM-DD/);
});
