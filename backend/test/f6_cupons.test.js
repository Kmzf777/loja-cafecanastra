"use strict";

/**
 * F6 — cupons: a avaliação pura, a migração 0010, a rota pública de validação,
 * o CRUD do painel e a aplicação REVALIDADA no checkout.
 *
 * O Mercado Pago e o Resend são DUBLÊS via hook de require (mesmo padrão de
 * f4_checkout_e_webhook.test.js). O banco é REAL: o incremento atômico de
 * `usos` e a devolução na compensação são exatamente o que um mock de pool
 * não prova.
 */

const { test, before, after, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const Module = require("node:module");
const { subirPostgres } = require("./ajuda/postgres.js");
const { aplicarMigracoes } = require("../db/migrar.js");
const { avaliarCupom } = require("../src/utils/cupom.js");

let bd;
let PaymentController;
let CuponsController;
let cuponsRepository;
let enviarLembretes;

const ANA = "aaaaaaaa-0000-0000-0000-000000000001";
const P1 = "11111111-0000-0000-0000-0000000000f1"; // 50,00 — checkout
const P2 = "11111111-0000-0000-0000-0000000000f2"; // 100,00 — alvo da promoção
const P3 = "11111111-0000-0000-0000-0000000000f3"; // 80,00 — fronteira do frete grátis

/** O que o dublê do MP responde; cada teste ajusta. */
const mp = { falhaNoCreate: false, statusDoGet: "pending", criacoes: [] };

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

async function usosDoCupom(codigo) {
  const { rows } = await bd.pool.query(
    "SELECT usos FROM canastra.cupons WHERE codigo = $1",
    [codigo],
  );
  return rows[0].usos;
}

async function estoqueDe(produtoId) {
  const { rows } = await bd.pool.query(
    "SELECT quantidade FROM canastra.produtos WHERE produto_id = $1",
    [produtoId],
  );
  return rows[0].quantidade;
}

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
  await bd.pool.query("INSERT INTO canastra.config_loja (id) VALUES (1)");
  await bd.pool.query(
    `INSERT INTO canastra.produtos (produto_id, nome, preco, quantidade, sku) VALUES
       ($1, 'Café Um',    50.00, 50, 'F6-P1'),
       ($2, 'Café Promo', 100.00, 50, 'F6-P2'),
       ($3, 'Café Caro',  80.00, 50, 'F6-P3')`,
    [P1, P2, P3],
  );
  // Promoção de 50% SÓ no P2: o teste do /cupons/validar afirma que o cupom
  // desconta sobre o preço JÁ promocional.
  await bd.pool.query(
    `INSERT INTO canastra.promocoes_legado
       (titulo, tipo, valor, aplica_a, produto_id, inicio_em, fim_em, ativa)
     VALUES ('Metade no Promo', 'percent', 50, 'product', $1,
             now() - interval '1 day', now() + interval '1 day', true)`,
    [P2],
  );

  // Os cupons dos testes.
  await bd.pool.query(`
    INSERT INTO canastra.cupons (codigo, tipo, valor, descricao) VALUES
      ('CAFE10', 'percent', 10, 'Dez por cento');
    INSERT INTO canastra.cupons (codigo, tipo, valor, minimo_centavos) VALUES
      ('MIN150', 'percent', 10, 15000);
    INSERT INTO canastra.cupons (codigo, tipo, valor, limite_usos, usos) VALUES
      ('UMSO', 'fixed', 5, 1, 1);
  `);

  process.env.DATABASE_URL = bd.connectionString;
  process.env.NODE_ENV = "development";
  delete process.env.MP_WEBHOOK_SECRET;
  // Porta fechada: se algum caminho tentar a Melhor Envio, falha na hora e
  // sobra só a entrega local (CEP 350xx) — nenhum teste depende de rede.
  process.env.MELHOR_ENVIO_URL = "http://127.0.0.1:9";

  const requireOriginal = Module.prototype.require;
  Module.prototype.require = function (caminho) {
    if (caminho === "../config/mercadopago") {
      return {
        payment: {
          get: async ({ id }) => ({ id, status: mp.statusDoGet }),
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
        sendStatusEmail: async () => {},
        sendAdminNewOrderEmail: async () => {},
      };
    }
    return requireOriginal.apply(this, arguments);
  };

  try {
    PaymentController = require("../src/controllers/PaymentController.js");
    CuponsController = require("../src/controllers/CuponsController.js");
    cuponsRepository = require("../src/repositories/cuponsRepository.js");
    // Para o teste do ciclo compra↔lembrete (o checkout encerra o episódio).
    ({ enviarLembretes } = require("../src/jobs/carrinhoAbandonado.js"));
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
 * avaliarCupom — a regra pura, sem banco
 * -------------------------------------------------------------------------- */

const cupomBase = {
  id: "c0000000-0000-0000-0000-000000000001",
  codigo: "TESTE",
  tipo: "percent",
  valor: 10,
  minimo_centavos: 0,
  limite_usos: null,
  usos: 0,
  ativo: true,
  inicio_em: null,
  fim_em: null,
};

test("avaliarCupom: cupom inexistente, inativo, fora da janela e esgotado", () => {
  const agora = new Date("2026-08-20T12:00:00Z");

  assert.deepEqual(avaliarCupom(null, 10000, agora), {
    valido: false,
    motivo: "Cupom não encontrado",
  });
  assert.deepEqual(avaliarCupom({ ...cupomBase, ativo: false }, 10000, agora), {
    valido: false,
    motivo: "Cupom inativo",
  });
  // Ainda não começou: para quem valida, ele não está ativo.
  assert.deepEqual(
    avaliarCupom(
      { ...cupomBase, inicio_em: new Date("2026-09-01T00:00:00Z") },
      10000,
      agora,
    ),
    { valido: false, motivo: "Cupom inativo" },
  );
  assert.deepEqual(
    avaliarCupom(
      { ...cupomBase, fim_em: new Date("2026-08-01T00:00:00Z") },
      10000,
      agora,
    ),
    { valido: false, motivo: "Cupom expirado" },
  );
  assert.deepEqual(
    avaliarCupom({ ...cupomBase, limite_usos: 5, usos: 5 }, 10000, agora),
    { valido: false, motivo: "Cupom esgotado" },
  );
});

test("avaliarCupom: pedido mínimo com o valor em reais na frase", () => {
  const resultado = avaliarCupom(
    { ...cupomBase, minimo_centavos: 5000 },
    4999,
    new Date(),
  );
  assert.deepEqual(resultado, {
    valido: false,
    motivo: "Pedido mínimo de R$ 50,00",
  });
  // No limite exato, vale.
  assert.equal(
    avaliarCupom({ ...cupomBase, minimo_centavos: 5000 }, 5000, new Date())
      .valido,
    true,
  );
});

test("avaliarCupom: percent arredonda a centavo; fixed trava no subtotal", () => {
  // 10% de 49,99 = 4,999 → 500 centavos, nunca 499.9 indo para o gateway.
  assert.deepEqual(avaliarCupom(cupomBase, 4999, new Date()), {
    valido: true,
    descontoCentavos: 500,
  });
  // fixed de R$ 30 num pedido de R$ 20: desconta o pedido e PARA — um cupom
  // nunca deixa o total negativo.
  assert.deepEqual(
    avaliarCupom({ ...cupomBase, tipo: "fixed", valor: 30 }, 2000, new Date()),
    { valido: true, descontoCentavos: 2000 },
  );
  assert.deepEqual(
    avaliarCupom({ ...cupomBase, tipo: "fixed", valor: 30 }, 10000, new Date()),
    { valido: true, descontoCentavos: 3000 },
  );
});

/* --------------------------------------------------------------------------
 * Migração 0010: os CHECKs do banco
 * -------------------------------------------------------------------------- */

test("0010: código minúsculo, tipo alienígena e percent > 90 são recusados", async () => {
  await assert.rejects(
    () =>
      bd.pool.query(
        "INSERT INTO canastra.cupons (codigo, tipo, valor) VALUES ('cafe10x', 'percent', 10)",
      ),
    (e) => {
      assert.equal(e.code, "23514");
      assert.match(e.message, /cupons_codigo_formato/);
      return true;
    },
  );
  await assert.rejects(
    () =>
      bd.pool.query(
        "INSERT INTO canastra.cupons (codigo, tipo, valor) VALUES ('TIPOX', 'brinde', 10)",
      ),
    (e) => e.code === "23514",
  );
  await assert.rejects(
    () =>
      bd.pool.query(
        "INSERT INTO canastra.cupons (codigo, tipo, valor) VALUES ('CEM', 'percent', 95)",
      ),
    (e) => {
      assert.equal(e.code, "23514");
      assert.match(e.message, /cupons_valor_valido/);
      return true;
    },
  );
  // Código repetido: 23505 do UNIQUE — quem trata no serviço responde 409.
  await assert.rejects(
    () =>
      bd.pool.query(
        "INSERT INTO canastra.cupons (codigo, tipo, valor) VALUES ('CAFE10', 'percent', 5)",
      ),
    (e) => e.code === "23505",
  );
});

test("0010: pedidos ganhou cupom_codigo e desconto (não negativo)", async () => {
  await assert.rejects(
    () =>
      bd.pool.query(
        `INSERT INTO canastra.pedidos (user_id, total, desconto) VALUES ($1, 10, -1)`,
        [ANA],
      ),
    (e) => {
      assert.equal(e.code, "23514");
      assert.match(e.message, /pedidos_desconto_nao_negativo/);
      return true;
    },
  );
});

/* --------------------------------------------------------------------------
 * A trava atômica de usos (repositório)
 * -------------------------------------------------------------------------- */

test("reservarUso: o segundo uso do limite 1 é recusado; devolverUso repõe", async () => {
  const { rows } = await bd.pool.query(
    `INSERT INTO canastra.cupons (codigo, tipo, valor, limite_usos)
     VALUES ('TRAVA1', 'fixed', 5, 1) RETURNING id`,
  );
  const id = rows[0].id;

  assert.equal(await cuponsRepository.reservarUso(id, bd.pool), true);
  assert.equal(await usosDoCupom("TRAVA1"), 1);
  // Limite alcançado: a MESMA consulta que incrementa é a que recusa.
  assert.equal(await cuponsRepository.reservarUso(id, bd.pool), false);
  assert.equal(await usosDoCupom("TRAVA1"), 1);

  await cuponsRepository.devolverUso(id, bd.pool);
  assert.equal(await usosDoCupom("TRAVA1"), 0);
  // Devolver além do zero não deixa o contador negativo.
  await cuponsRepository.devolverUso(id, bd.pool);
  assert.equal(await usosDoCupom("TRAVA1"), 0);
});

/* --------------------------------------------------------------------------
 * POST /cupons/validar — o subtotal é do SERVIDOR
 * -------------------------------------------------------------------------- */

function reqDeValidacao(codigo, itens) {
  return { body: { codigo, itens }, ip: "127.0.0.1" };
}

test("validar: código desconhecido responde 200 { valido: false }", async () => {
  const res = respostaFalsa();
  await CuponsController.validar(
    reqDeValidacao("NAOEXISTE", [{ productId: P1, quantity: 1 }]),
    res,
  );
  assert.equal(res.codigo, 200);
  assert.deepEqual(res.corpo, { valido: false, motivo: "Cupom não encontrado" });
});

test("validar: o preço vem do banco — o que o navegador diz é ignorado", async () => {
  const res = respostaFalsa();
  await CuponsController.validar(
    // minúsculo de propósito (normaliza) e com um preço mentiroso no corpo.
    reqDeValidacao("cafe10", [{ productId: P1, quantity: 2, price: 0.01 }]),
    res,
  );
  assert.equal(res.codigo, 200);
  // 2 × R$ 50,00 do BANCO = 10000 centavos; 10% = 1000.
  assert.equal(res.corpo.valido, true);
  assert.equal(res.corpo.codigo, "CAFE10");
  assert.equal(res.corpo.tipo, "percent");
  assert.equal(Number(res.corpo.valor), 10);
  assert.equal(res.corpo.descontoCentavos, 1000);
  assert.equal(res.corpo.descricao, "Dez por cento");
});

test("validar: o cupom desconta sobre o preço JÁ promocional", async () => {
  const res = respostaFalsa();
  await CuponsController.validar(
    reqDeValidacao("CAFE10", [{ productId: P2, quantity: 1 }]),
    res,
  );
  // P2 custa 100, a promoção de 50% deixa em 50 → subtotal 5000 → 10% = 500.
  assert.equal(res.corpo.valido, true);
  assert.equal(res.corpo.descontoCentavos, 500);
});

test("validar: pedido mínimo é conferido contra o subtotal do servidor", async () => {
  const res = respostaFalsa();
  await CuponsController.validar(
    reqDeValidacao("MIN150", [{ productId: P1, quantity: 2 }]),
    res,
  );
  assert.deepEqual(res.corpo, {
    valido: false,
    motivo: "Pedido mínimo de R$ 150,00",
  });
});

test("validar: corpo sem itens ou com itens tortos é 400", async () => {
  let res = respostaFalsa();
  await CuponsController.validar({ body: { codigo: "CAFE10" } }, res);
  assert.equal(res.codigo, 400);

  res = respostaFalsa();
  await CuponsController.validar(
    reqDeValidacao("CAFE10", [{ productId: "nao-e-uuid", quantity: 1 }]),
    res,
  );
  assert.equal(res.codigo, 400);

  res = respostaFalsa();
  await CuponsController.validar(
    reqDeValidacao("CAFE10", [{ productId: P1, quantity: 0 }]),
    res,
  );
  assert.equal(res.codigo, 400);

  // Itens válidos na forma mas de produtos que não existem: não há o que
  // descontar — 400, não um "válido" com desconto zero.
  res = respostaFalsa();
  await CuponsController.validar(
    reqDeValidacao("CAFE10", [
      { productId: "99999999-0000-0000-0000-000000000099", quantity: 1 },
    ]),
    res,
  );
  assert.equal(res.codigo, 400);
});

/* --------------------------------------------------------------------------
 * CRUD do painel
 * -------------------------------------------------------------------------- */

test("criar: salva maiúsculo, com defaults, e recusa os inválidos", async () => {
  let res = respostaFalsa();
  await CuponsController.criar(
    { body: { codigo: "novo15", tipo: "fixed", valor: 15, descricao: "Quinze" } },
    res,
  );
  assert.equal(res.codigo, 201);
  assert.equal(res.corpo.codigo, "NOVO15");
  assert.equal(res.corpo.usos, 0);
  assert.equal(res.corpo.ativo, true);
  assert.equal(res.corpo.minimo_centavos, 0);

  // Curto demais, percent acima do teto, tipo desconhecido, fixed sem valor.
  // "CAFE5" tem 5 caracteres: passa no CHECK do banco (3-30), mas a CRIAÇÃO
  // exige 6 — anti-enumeração; ver TAMANHO_MINIMO_DE_CODIGO_NOVO.
  for (const corpo of [
    { codigo: "ab", tipo: "percent", valor: 10 },
    { codigo: "CAFE5", tipo: "percent", valor: 10 },
    { codigo: "CEMPORCENTO", tipo: "percent", valor: 95 },
    { codigo: "BRINDE", tipo: "brinde", valor: 10 },
    { codigo: "ZERADO", tipo: "fixed", valor: 0 },
  ]) {
    res = respostaFalsa();
    await CuponsController.criar({ body: corpo }, res);
    assert.equal(res.codigo, 400, JSON.stringify(corpo));
  }

  // Código repetido: 409, com frase — não um 500 de 23505 cru.
  res = respostaFalsa();
  await CuponsController.criar(
    { body: { codigo: "CAFE10", tipo: "percent", valor: 5 } },
    res,
  );
  assert.equal(res.codigo, 409);
});

test("listar: { data: [...] } com os campos do contrato", async () => {
  const res = respostaFalsa();
  await CuponsController.listar({}, res);
  assert.equal(res.codigo, 200);
  assert.ok(Array.isArray(res.corpo.data));
  const cafe10 = res.corpo.data.find((c) => c.codigo === "CAFE10");
  assert.ok(cafe10);
  for (const campo of [
    "id",
    "codigo",
    "tipo",
    "valor",
    "descricao",
    "minimo_centavos",
    "limite_usos",
    "usos",
    "ativo",
    "inicio_em",
    "fim_em",
  ]) {
    assert.ok(campo in cafe10, `faltou ${campo}`);
  }
});

test("atualizar: parcial de verdade — desativar não exige reenviar tudo", async () => {
  const { rows } = await bd.pool.query(
    `INSERT INTO canastra.cupons (codigo, tipo, valor)
     VALUES ('DESLIGA', 'percent', 10) RETURNING id`,
  );
  const id = rows[0].id;

  let res = respostaFalsa();
  await CuponsController.atualizar({ params: { id }, body: { ativo: false } }, res);
  assert.equal(res.codigo, 200);
  assert.equal(res.corpo.ativo, false);
  assert.equal(res.corpo.codigo, "DESLIGA", "o resto não mudou");

  // E o cupom desativado passa a ser recusado na validação pública.
  res = respostaFalsa();
  await CuponsController.validar(
    reqDeValidacao("DESLIGA", [{ productId: P1, quantity: 1 }]),
    res,
  );
  assert.deepEqual(res.corpo, { valido: false, motivo: "Cupom inativo" });

  // A mesma régua do criar vale na edição.
  res = respostaFalsa();
  await CuponsController.atualizar(
    { params: { id }, body: { tipo: "percent", valor: 95 } },
    res,
  );
  assert.equal(res.codigo, 400);

  // Id que não existe: 404, não 200 vazio.
  res = respostaFalsa();
  await CuponsController.atualizar(
    { params: { id: "99999999-0000-0000-0000-000000000001" }, body: { ativo: true } },
    res,
  );
  assert.equal(res.codigo, 404);
});

/* --------------------------------------------------------------------------
 * process_payment com cupom
 * -------------------------------------------------------------------------- */

function corpoDeCheckout({ produto = P1, quantity = 2, cupom, shippingCost = 0, shippingMethod = "Retirada na loja" } = {}) {
  return {
    formData: {
      paymentMethodId: "pix",
      payer: {
        email: "ana@ex.com",
        identification: { type: "CPF", number: "529.982.247-25" },
      },
    },
    paymentMethodType: "pix",
    items: [{ product_id: produto, quantity, name: "Café" }],
    userEmail: "ana@ex.com",
    address: { zip_code: "35012345", street: "Rua X", number: "1" },
    shippingCost,
    shippingMethod,
    ...(cupom !== undefined ? { cupom } : {}),
  };
}

test("checkout com cupom: desconto no valor cobrado, uso e pedido gravados", async () => {
  const usosAntes = await usosDoCupom("CAFE10");
  const res = respostaFalsa();
  await PaymentController.createPayment(
    { user: { userId: ANA }, headers: {}, body: corpoDeCheckout({ cupom: "cafe10" }) },
    res,
  );

  assert.equal(res.codigo, 201);
  // 2 × 50 = 100; 10% = 10; retirada sem frete → cobra 90.
  const cobranca = mp.criacoes[mp.criacoes.length - 1];
  assert.equal(cobranca.transaction_amount, 90);

  const { rows } = await bd.pool.query(
    `SELECT total, desconto, cupom_codigo FROM canastra.pedidos WHERE pedido_id = $1`,
    [res.corpo.orderId],
  );
  assert.equal(Number(rows[0].total), 90);
  assert.equal(Number(rows[0].desconto), 10);
  assert.equal(rows[0].cupom_codigo, "CAFE10");

  assert.equal(await usosDoCupom("CAFE10"), usosAntes + 1);
});

test("checkout com cupom inexistente: 400 SEM cobrar e SEM reservar", async () => {
  const cobrancasAntes = mp.criacoes.length;
  const estoqueAntes = await estoqueDe(P1);

  const res = respostaFalsa();
  await PaymentController.createPayment(
    { user: { userId: ANA }, headers: {}, body: corpoDeCheckout({ cupom: "FANTASMA" }) },
    res,
  );
  assert.equal(res.codigo, 400);
  assert.match(res.corpo.details, /não encontrado/i);
  assert.equal(mp.criacoes.length, cobrancasAntes);
  assert.equal(await estoqueDe(P1), estoqueAntes);
});

test("checkout com cupom esgotado: 400 antes de cobrar, estoque intacto", async () => {
  const cobrancasAntes = mp.criacoes.length;
  const estoqueAntes = await estoqueDe(P1);

  const res = respostaFalsa();
  await PaymentController.createPayment(
    { user: { userId: ANA }, headers: {}, body: corpoDeCheckout({ cupom: "UMSO" }) },
    res,
  );
  assert.equal(res.codigo, 400);
  assert.match(res.corpo.details, /esgotado/i);
  assert.equal(mp.criacoes.length, cobrancasAntes, "não pode cobrar");
  assert.equal(await estoqueDe(P1), estoqueAntes, "não pode reservar");
  assert.equal(await usosDoCupom("UMSO"), 1, "o contador não anda");
});

test("gateway caiu com cupom: estoque E uso devolvidos", async () => {
  const usosAntes = await usosDoCupom("CAFE10");
  const estoqueAntes = await estoqueDe(P1);
  mp.falhaNoCreate = true;
  try {
    const res = respostaFalsa();
    await PaymentController.createPayment(
      { user: { userId: ANA }, headers: {}, body: corpoDeCheckout({ cupom: "CAFE10" }) },
      res,
    );
    assert.equal(res.codigo, 500);
    assert.equal(await estoqueDe(P1), estoqueAntes, "a reserva voltou");
    assert.equal(await usosDoCupom("CAFE10"), usosAntes, "o uso voltou");
  } finally {
    mp.falhaNoCreate = false;
  }
});

test("frete grátis sem cupom: subtotal no piso, zero aceito", async () => {
  // 2 × 80 = 160 ≥ 149: a recotação zera a entrega local e o 0 casa.
  const res = respostaFalsa();
  await PaymentController.createPayment(
    {
      user: { userId: ANA },
      headers: {},
      body: corpoDeCheckout({ produto: P3, shippingCost: 0, shippingMethod: "Entrega Local" }),
    },
    res,
  );
  assert.equal(res.codigo, 201);
  const cobranca = mp.criacoes[mp.criacoes.length - 1];
  assert.equal(cobranca.transaction_amount, 160);

  // E um pedido sem cupom nasce com desconto zero e sem código.
  const { rows } = await bd.pool.query(
    "SELECT desconto, cupom_codigo FROM canastra.pedidos WHERE pedido_id = $1",
    [res.corpo.orderId],
  );
  assert.equal(Number(rows[0].desconto), 0);
  assert.equal(rows[0].cupom_codigo, null);
});

test("o cupom derruba o subtotal para baixo do piso: o zero vira 409", async () => {
  // 160 − 10% = 144 < 149: o frete grátis é decidido pelo subtotal COM
  // desconto, então o 0 que valia sem cupom deixa de casar com opção real.
  const estoqueAntes = await estoqueDe(P3);
  const res = respostaFalsa();
  await PaymentController.createPayment(
    {
      user: { userId: ANA },
      headers: {},
      body: corpoDeCheckout({
        produto: P3,
        cupom: "CAFE10",
        shippingCost: 0,
        shippingMethod: "Entrega Local",
      }),
    },
    res,
  );
  assert.equal(res.codigo, 409);
  assert.equal(await estoqueDe(P3), estoqueAntes, "nada reservado");
});

test("com o frete real, o mesmo carrinho com cupom fecha a conta certa", async () => {
  const usosAntes = await usosDoCupom("CAFE10");
  const res = respostaFalsa();
  await PaymentController.createPayment(
    {
      user: { userId: ANA },
      headers: {},
      body: corpoDeCheckout({
        produto: P3,
        cupom: "CAFE10",
        shippingCost: 5,
        shippingMethod: "Entrega Local",
      }),
    },
    res,
  );
  assert.equal(res.codigo, 201);
  // 160 − 16 + 5 de frete = 149.
  const cobranca = mp.criacoes[mp.criacoes.length - 1];
  assert.equal(cobranca.transaction_amount, 149);

  const { rows } = await bd.pool.query(
    "SELECT total, desconto, cupom_codigo, frete FROM canastra.pedidos WHERE pedido_id = $1",
    [res.corpo.orderId],
  );
  assert.equal(Number(rows[0].total), 149);
  assert.equal(Number(rows[0].desconto), 16);
  assert.equal(Number(rows[0].frete), 5);
  assert.equal(rows[0].cupom_codigo, "CAFE10");
  assert.equal(await usosDoCupom("CAFE10"), usosAntes + 1);
});

/**
 * A conferência de subtotal (defeito 3 da revisão de dinheiro) contra o caso
 * que mais facilmente a quebraria: PROMOÇÃO ATIVA.
 *
 * A vitrine NÃO renderiza preço promocional — `repositorio.ts` sobrepõe o
 * `preco` cru do banco sobre o JSON editorial, e é esse número que a sacola
 * guarda. Se a conferência comparasse contra o valor COBRADO (que é o
 * promocional), toda venda com promoção ativa viraria 409 e a loja pararia de
 * vender no dia de campanha. Por isso o que se compara é o subtotal de
 * VITRINE — e `precoComPromocao` só ABAIXA o preço, então a promoção aparecendo
 * ou sumindo no meio do caminho só faz o cliente pagar menos do que viu.
 */
test("promoção ativa não vira 409: confere-se o preço de VITRINE, cobra-se o promocional", async () => {
  const res = respostaFalsa();
  await PaymentController.createPayment(
    {
      user: { userId: ANA },
      headers: {},
      body: {
        ...corpoDeCheckout({ produto: P2, quantity: 1 }),
        // P2 custa R$ 100,00 no catálogo — é o que a tela mostrou.
        subtotalCentavos: 10000,
      },
    },
    res,
  );

  assert.equal(res.codigo, 201);
  // ...e a cobrança é a metade, por causa da promoção de 50% no P2.
  assert.equal(mp.criacoes[mp.criacoes.length - 1].transaction_amount, 50);
});

test("subtotal do cupom NÃO entra na declaração: o campo é só dos itens", async () => {
  // 2 × R$ 50,00 = 10000 — o desconto de 10% do CAFE10 não desconta daqui. A
  // declaração é o SUBTOTAL exibido, não o total a pagar: desconto e frete têm
  // conferências próprias (revalidação do cupom e `conferirFrete`).
  const res = respostaFalsa();
  await PaymentController.createPayment(
    {
      user: { userId: ANA },
      headers: {},
      body: { ...corpoDeCheckout({ cupom: "CAFE10" }), subtotalCentavos: 10000 },
    },
    res,
  );
  assert.equal(res.codigo, 201);
  assert.equal(mp.criacoes[mp.criacoes.length - 1].transaction_amount, 90);

  // E declarar o total JÁ descontado (o erro fácil de quem monta o corpo) é
  // recusado, em vez de virar cobrança silenciosa sobre outra base.
  const usosAntes = await usosDoCupom("CAFE10");
  const estoqueAntes = await estoqueDe(P1);
  const errado = respostaFalsa();
  await PaymentController.createPayment(
    {
      user: { userId: ANA },
      headers: {},
      body: { ...corpoDeCheckout({ cupom: "CAFE10" }), subtotalCentavos: 9000 },
    },
    errado,
  );
  assert.equal(errado.codigo, 409);
  assert.equal(errado.corpo.error, "PRECO_MUDOU");
  assert.equal(await usosDoCupom("CAFE10"), usosAntes, "o uso não foi gasto");
  assert.equal(await estoqueDe(P1), estoqueAntes, "nada reservado");
});

test("cupom que cobre o pedido inteiro: 400 com a frase certa, nada consumido", async () => {
  // fixed de R$ 1000 num pedido de R$ 100 com retirada (frete 0): o desconto
  // trava no subtotal e o total fecha em 0,00 — que o MP não cobra.
  await bd.pool.query(
    "INSERT INTO canastra.cupons (codigo, tipo, valor) VALUES ('COBRETUDO1', 'fixed', 1000)",
  );
  const cobrancasAntes = mp.criacoes.length;
  const estoqueAntes = await estoqueDe(P1);

  const res = respostaFalsa();
  await PaymentController.createPayment(
    { user: { userId: ANA }, headers: {}, body: corpoDeCheckout({ cupom: "COBRETUDO1" }) },
    res,
  );
  assert.equal(res.codigo, 400);
  assert.match(res.corpo.details, /cobre o valor inteiro do pedido/i);
  assert.equal(mp.criacoes.length, cobrancasAntes, "não pode cobrar");
  assert.equal(await estoqueDe(P1), estoqueAntes, "o ROLLBACK devolveu a reserva");
  assert.equal(await usosDoCupom("COBRETUDO1"), 0, "o ROLLBACK devolveu o uso");
});

/* --------------------------------------------------------------------------
 * Webhook × cupom (item 1 da revisão): o uso volta com o estoque, uma vez
 * -------------------------------------------------------------------------- */

function requisicaoDeWebhook(paymentId) {
  return {
    headers: { "x-request-id": "req-teste" },
    body: { type: "payment", data: { id: paymentId } },
    ip: "127.0.0.1",
  };
}

test("webhook ativo→cancelado devolve o uso; reenvio e volta não mexem de novo", async () => {
  // Cupom dedicado, para a contagem começar do zero.
  await bd.pool.query(
    "INSERT INTO canastra.cupons (codigo, tipo, valor) VALUES ('DEZWEB1', 'percent', 10)",
  );

  const res = respostaFalsa();
  await PaymentController.createPayment(
    { user: { userId: ANA }, headers: {}, body: corpoDeCheckout({ cupom: "DEZWEB1" }) },
    res,
  );
  assert.equal(res.codigo, 201);
  assert.equal(await usosDoCupom("DEZWEB1"), 1, "o checkout consumiu o uso");
  const estoqueReservado = await estoqueDe(P1);

  const { rows } = await bd.pool.query(
    "SELECT pagamento_id_mp FROM canastra.pedidos WHERE pedido_id = $1",
    [res.corpo.orderId],
  );
  const pagamentoMp = rows[0].pagamento_id_mp;

  try {
    // A venda morre: estoque E uso voltam, na mesma transação.
    mp.statusDoGet = "cancelled";
    let hook = respostaFalsa();
    await PaymentController.receiveWebhook(requisicaoDeWebhook(pagamentoMp), hook);
    assert.equal(hook.codigo, 200);
    assert.equal(await estoqueDe(P1), estoqueReservado + 2, "estoque devolvido");
    assert.equal(await usosDoCupom("DEZWEB1"), 0, "uso devolvido junto");

    // O MP reenvia por desenho: a mesma notificação de novo não devolve dobro.
    hook = respostaFalsa();
    await PaymentController.receiveWebhook(requisicaoDeWebhook(pagamentoMp), hook);
    assert.equal(hook.codigo, 200);
    assert.equal(await usosDoCupom("DEZWEB1"), 0, "reenvio NÃO devolve de novo");

    // O caminho de volta (cancelado→ativo): o estoque sai de novo, mas o uso
    // NÃO é re-reservado às cegas — a vaga pode já ter sido consumida por
    // outro pedido; fica a divergência logada, nunca um limite estourado.
    mp.statusDoGet = "approved";
    hook = respostaFalsa();
    await PaymentController.receiveWebhook(requisicaoDeWebhook(pagamentoMp), hook);
    assert.equal(hook.codigo, 200);
    assert.equal(await estoqueDe(P1), estoqueReservado, "estoque saiu de novo");
    assert.equal(await usosDoCupom("DEZWEB1"), 0, "sem re-reserva às cegas");
  } finally {
    mp.statusDoGet = "pending";
  }
});

/* --------------------------------------------------------------------------
 * A compra encerra o episódio do lembrete (item 2 da revisão)
 * -------------------------------------------------------------------------- */

test("abandona → lembra → compra → abandona de novo → lembra de novo", async () => {
  // Uma sacola abandonada da Ana (25h paradas).
  const { rows: carrinho } = await bd.pool.query(
    "INSERT INTO canastra.carrinhos (user_id) VALUES ($1) RETURNING carrinho_id",
    [ANA],
  );
  const carrinhoId = carrinho[0].carrinho_id;
  const abandonar = async () => {
    await bd.pool.query(
      `INSERT INTO canastra.carrinho_itens (carrinho_id, produto_id, quantidade, preco, nome, moagem)
       VALUES ($1, $2, 1, 50.00, 'Café Um', 'graos')
       ON CONFLICT (carrinho_id, produto_id, moagem) DO NOTHING`,
      [carrinhoId, P1],
    );
    await bd.pool.query(
      "UPDATE canastra.carrinhos SET atualizado_em = now() - interval '25 hours' WHERE carrinho_id = $1",
      [carrinhoId],
    );
  };
  const lembrete = async () => {
    const { rows } = await bd.pool.query(
      "SELECT lembrete_enviado_em FROM canastra.carrinhos WHERE carrinho_id = $1",
      [carrinhoId],
    );
    return rows[0].lembrete_enviado_em;
  };

  await abandonar();
  const enviados = [];
  const enviar = async (d) => enviados.push(d);

  // Primeiro episódio: lembra uma vez.
  let rodada = await enviarLembretes({ conexao: bd.pool, horas: 24, enviar });
  assert.equal(rodada.enviados, 1);
  assert.ok(await lembrete(), "primeiro episódio marcado");

  // A COMPRA encerra o episódio: sacola esvazia e a marca volta a NULL.
  const res = respostaFalsa();
  await PaymentController.createPayment(
    { user: { userId: ANA }, headers: {}, body: corpoDeCheckout({ quantity: 1 }) },
    res,
  );
  assert.equal(res.codigo, 201);
  const { rows: itens } = await bd.pool.query(
    "SELECT count(*)::int AS n FROM canastra.carrinho_itens WHERE carrinho_id = $1",
    [carrinhoId],
  );
  assert.equal(itens[0].n, 0, "a compra esvaziou a sacola");
  assert.equal(await lembrete(), null, "a compra zerou a marca do lembrete");

  // Segundo episódio: sacola nova abandonada — lembra DE NOVO, uma vez.
  await abandonar();
  rodada = await enviarLembretes({ conexao: bd.pool, horas: 24, enviar });
  assert.equal(rodada.enviados, 1, "abandono novo é episódio novo");
  assert.equal(enviados.length, 2);
  assert.ok(await lembrete());
});

/* --------------------------------------------------------------------------
 * Piso de tamanho para código NOVO (item 6 da revisão)
 * -------------------------------------------------------------------------- */

test("cupom legado curto segue aplicável e editável; renomear exige 6", async () => {
  // Um legado de 3 caracteres, direto no banco (o CHECK de 0010 aceita 3-30
  // de propósito — só a CRIAÇÃO pela API exige 6).
  const { rows } = await bd.pool.query(
    "INSERT INTO canastra.cupons (codigo, tipo, valor) VALUES ('LG1', 'percent', 10) RETURNING id",
  );
  const id = rows[0].id;

  // Aplicar continua valendo.
  let res = respostaFalsa();
  await CuponsController.validar(
    reqDeValidacao("LG1", [{ productId: P1, quantity: 1 }]),
    res,
  );
  assert.equal(res.corpo.valido, true);

  // Editar OUTROS campos do legado passa...
  res = respostaFalsa();
  await CuponsController.atualizar(
    { params: { id }, body: { descricao: "legado" } },
    res,
  );
  assert.equal(res.codigo, 200);
  assert.equal(res.corpo.codigo, "LG1");

  // ...mas RENOMEAR é criar código novo: mesmo piso de 6 da criação.
  res = respostaFalsa();
  await CuponsController.atualizar({ params: { id }, body: { codigo: "NOVO" } }, res);
  assert.equal(res.codigo, 400);
  assert.match(res.corpo.error, /pelo menos 6/);
});
