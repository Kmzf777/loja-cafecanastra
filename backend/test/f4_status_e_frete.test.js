"use strict";

/**
 * F4 — o vocabulário de status (migração 0009) e o frete grátis de servidor.
 *
 * Duas coisas num arquivo porque nasceram na mesma migração: o CHECK de
 * `pedidos.status` e a coluna `config_loja.frete_gratis_minimo_centavos`.
 *
 * O require dos módulos de `src/` acontece DENTRO do before(), depois de
 * `DATABASE_URL` apontar para o cluster efêmero — `src/pgPool.js` lê a
 * variável no momento em que é carregado (mesmo padrão de autenticacao.test.js).
 */

const { test, before, after, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const { subirPostgres } = require("./ajuda/postgres.js");
const { aplicarMigracoes } = require("../db/migrar.js");
const {
  STATUS_VALIDOS,
  GRUPO_ATIVO,
  GRUPO_CANCELADO,
  traduzirStatusMp,
} = require("../src/utils/statusDePedido.js");

let bd;
let calcularOpcoesDeFrete;
let conferirFrete;

const ANA = "aaaaaaaa-0000-0000-0000-000000000001";

/** CEP coberto pela entrega local (prefixo 350 — ver ShippingController). */
const CEP_LOCAL = "35012345";

before(async () => {
  bd = await subirPostgres();
  await aplicarMigracoes(bd.pool);

  await bd.pool.query(
    "INSERT INTO auth.users (id, email) VALUES ($1, 'ana@ex.com')",
    [ANA],
  );
  await bd.pool.query(
    "INSERT INTO canastra.clientes (user_id, nome) VALUES ($1, 'Ana')",
    [ANA],
  );
  // A linha única de config, com o default de 14900 (R$ 149,00) da 0009.
  await bd.pool.query("INSERT INTO canastra.config_loja (id) VALUES (1)");

  process.env.DATABASE_URL = bd.connectionString;
  process.env.MP_ACCESS_TOKEN = process.env.MP_ACCESS_TOKEN || "teste";
  // Porta fechada: a cotação externa falha RÁPIDO e sobra só a entrega local,
  // que é o que estes testes precisam — nenhum teste pode depender de rede.
  process.env.MELHOR_ENVIO_URL = "http://127.0.0.1:9";

  ({ calcularOpcoesDeFrete } = require("../src/controllers/ShippingController.js"));
  ({ conferirFrete } = require("../src/controllers/PaymentController.js"));
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
 * O módulo de status (puro, sem banco)
 * -------------------------------------------------------------------------- */

test("os nove status fixados no plano mestre, e a partição em dois grupos", () => {
  assert.deepEqual(STATUS_VALIDOS, [
    "pendente",
    "aprovado",
    "em_processamento",
    "autorizado",
    "enviado",
    "entregue",
    "cancelado",
    "rejeitado",
    "reembolsado",
  ]);
  // Grupos derivados: juntos cobrem tudo, e nada está nos dois.
  assert.deepEqual(
    [...GRUPO_ATIVO, ...GRUPO_CANCELADO].sort(),
    [...STATUS_VALIDOS].sort(),
  );
  assert.equal(GRUPO_ATIVO.some((s) => GRUPO_CANCELADO.includes(s)), false);
});

test("a tradução MP → português cobre o vocabulário do gateway", () => {
  assert.equal(traduzirStatusMp("pending"), "pendente");
  assert.equal(traduzirStatusMp("approved"), "aprovado");
  assert.equal(traduzirStatusMp("in_process"), "em_processamento");
  assert.equal(traduzirStatusMp("authorized"), "autorizado");
  assert.equal(traduzirStatusMp("cancelled"), "cancelado");
  assert.equal(traduzirStatusMp("rejected"), "rejeitado");
  assert.equal(traduzirStatusMp("refunded"), "reembolsado");
  // Os dois que o plano mestre não lista mas o MP emite: sem mapa, o webhook
  // gravaria a string crua, o CHECK recusaria com 23514 e o MP reenviaria a
  // notificação para sempre.
  assert.equal(traduzirStatusMp("in_mediation"), "em_processamento");
  assert.equal(traduzirStatusMp("charged_back"), "reembolsado");
  // Desconhecido → null, para quem chama decidir (nunca gravar cru).
  assert.equal(traduzirStatusMp("alien_status"), null);
  assert.equal(traduzirStatusMp(undefined), null);
});

/* --------------------------------------------------------------------------
 * Migração 0009: o CHECK de status
 * -------------------------------------------------------------------------- */

test("status fora da lista é recusado pelo banco com 23514", async () => {
  await assert.rejects(
    () =>
      bd.pool.query(
        `INSERT INTO canastra.pedidos (user_id, total, status)
         VALUES ($1, 10, 'pendnete')`,
        [ANA],
      ),
    (erro) => {
      assert.equal(erro.code, "23514");
      assert.match(erro.message, /pedidos_status_valido/);
      return true;
    },
  );
});

test("o vocabulário ANTIGO (inglês, do MP) também é recusado", async () => {
  // Este é o teste que impede uma regressão silenciosa: se alguém religar um
  // caminho que grave o status cru do Mercado Pago, ele quebra AQUI, com erro,
  // em vez de gravar 'approved' que nenhum filtro em português encontra.
  await assert.rejects(
    () =>
      bd.pool.query(
        `INSERT INTO canastra.pedidos (user_id, total, status)
         VALUES ($1, 10, 'approved')`,
        [ANA],
      ),
    (erro) => {
      assert.equal(erro.code, "23514");
      return true;
    },
  );
});

test("os nove status válidos entram, inclusive pelo default", async () => {
  for (const status of STATUS_VALIDOS) {
    await bd.pool.query(
      `INSERT INTO canastra.pedidos (user_id, total, status, chave_idempotencia)
       VALUES ($1, 10, $2, $3)`,
      [ANA, status, `status-${status}`],
    );
  }
  // O DEFAULT de 0005 ('pendente') continua compatível com o CHECK novo.
  const { rows } = await bd.pool.query(
    `INSERT INTO canastra.pedidos (user_id, total) VALUES ($1, 10)
     RETURNING status`,
    [ANA],
  );
  assert.equal(rows[0].status, "pendente");
});

/* --------------------------------------------------------------------------
 * Migração 0009: o piso do frete grátis
 * -------------------------------------------------------------------------- */

test("config_loja nasce com frete_gratis_minimo_centavos = 14900", async () => {
  const { rows } = await bd.pool.query(
    "SELECT frete_gratis_minimo_centavos FROM canastra.config_loja WHERE id = 1",
  );
  assert.equal(rows[0].frete_gratis_minimo_centavos, 14900);
});

test("piso negativo é recusado; a coluna nasceu legível por anon", async () => {
  await assert.rejects(
    () =>
      bd.pool.query(
        "UPDATE canastra.config_loja SET frete_gratis_minimo_centavos = -1",
      ),
    (erro) => {
      assert.equal(erro.code, "23514");
      assert.match(erro.message, /config_frete_gratis_nao_negativo/);
      return true;
    },
  );

  // O GRANT de 0005 é de TABELA, então a coluna nova já sai na vitrine — é o
  // que a barra do Cabeçalho vai ler via GET /config (e via PostgREST na F6).
  const { rows } = await bd.pool.query(
    `SELECT has_column_privilege('anon', 'canastra.config_loja',
            'frete_gratis_minimo_centavos', 'SELECT') AS anon_le`,
  );
  assert.equal(rows[0].anon_le, true);
});

/* --------------------------------------------------------------------------
 * Frete grátis é regra de SERVIDOR
 * -------------------------------------------------------------------------- */

const itemDe = (precoReais, quantidade = 1) => ({
  product_id: "p1",
  quantity: quantidade,
  price: precoReais,
  weight: 0.3,
  width: 18,
  height: 7,
  length: 24,
});

test("subtotal abaixo do piso: a entrega local continua custando R$ 5", async () => {
  const opcoes = await calcularOpcoesDeFrete({
    zipCode: CEP_LOCAL,
    itens: [itemDe(100)], // R$ 100,00 < R$ 149,00
  });
  const local = opcoes.find((o) => o.name === "Entrega Local");
  assert.ok(local, "a entrega local deveria cobrir o CEP 350xx");
  assert.equal(local.price, 5);
  assert.notEqual(local.gratis, true);
});

test("subtotal no piso: as opções vêm zeradas e marcadas gratis", async () => {
  const opcoes = await calcularOpcoesDeFrete({
    zipCode: CEP_LOCAL,
    itens: [itemDe(149)], // exatamente R$ 149,00
  });
  assert.ok(opcoes.length > 0);
  for (const o of opcoes) {
    assert.equal(o.price, 0);
    assert.equal(o.gratis, true);
  }
});

test("o subtotal soma price × quantity em centavos, sem deriva de float", async () => {
  // 3 × R$ 49,67 = R$ 149,01. Em float, 49.67 * 3 = 149.01000000000002 — e uma
  // comparação ingênua em reais poderia errar exatamente na fronteira.
  const opcoes = await calcularOpcoesDeFrete({
    zipCode: CEP_LOCAL,
    itens: [itemDe(49.67, 3)],
  });
  for (const o of opcoes) assert.equal(o.gratis, true);
});

test("conferirFrete aceita o frete zerado quando a recotação dá zero", async () => {
  // O navegador manda shippingCost: 0 porque a cotação veio zerada; o checkout
  // recota pelo MESMO caminho e o zero casa com a opção real. Sem isto, o
  // frete grátis prometido derrubaria todo pedido com 409.
  const valor = await conferirFrete({
    address: { zip_code: CEP_LOCAL },
    itens: [itemDe(149)],
    shippingCost: 0,
    shippingMethod: "Entrega Local",
  });
  assert.equal(valor, 0);
});

test("conferirFrete recusa o zero quando o subtotal NÃO atinge o piso", async () => {
  // Frete grátis continua sendo do servidor: mandar 0 do navegador com o
  // carrinho abaixo do piso é o ataque antigo de escolher quanto pagar.
  await assert.rejects(
    () =>
      conferirFrete({
        address: { zip_code: CEP_LOCAL },
        itens: [itemDe(100)],
        shippingCost: 0,
        shippingMethod: "Entrega Local",
      }),
    (e) => e.status === 409,
  );
});

test("com o piso desligado (0), nada é zerado", async () => {
  await bd.pool.query(
    "UPDATE canastra.config_loja SET frete_gratis_minimo_centavos = 0, atualizado_em = now()",
  );
  try {
    const opcoes = await calcularOpcoesDeFrete({
      zipCode: CEP_LOCAL,
      itens: [itemDe(500)],
    });
    const local = opcoes.find((o) => o.name === "Entrega Local");
    assert.equal(local.price, 5);
  } finally {
    await bd.pool.query(
      "UPDATE canastra.config_loja SET frete_gratis_minimo_centavos = 14900, atualizado_em = now()",
    );
  }
});
