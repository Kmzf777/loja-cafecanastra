"use strict";

/**
 * O CHECKOUT USANDO O MOTOR — a parte que mexe em dinheiro.
 *
 * Padrão de `f6_cupons.test.js`: Mercado Pago e Resend são dublês por hook de
 * require, e o BANCO É REAL — resgate na transação, contador atômico e estorno
 * de webhook são exatamente o que um mock de pool não prova.
 *
 * AS QUATRO PERGUNTAS QUE ESTE ARQUIVO EXISTE PARA RESPONDER:
 *
 *   1. A soma de `pedido_ajustes_desconto` bate, AO CENTAVO, com a diferença
 *      entre o subtotal de catálogo e o que foi cobrado pelos itens? Sem isso
 *      "por que este pedido saiu por R$ 137,40?" não tem resposta, a NF-e não
 *      rateia e o estorno parcial não fecha.
 *   2. Cancelar (ou deixar o Pix expirar) DEVOLVE o uso? Sem isso, carrinho
 *      abandonado queima campanha.
 *   3. Uma campanha migrada pela 0032 — que existe nas DUAS estruturas com o
 *      MESMO id — é aplicada uma vez ou duas?
 *   4. `conferirSubtotal` continua correto? Ele compara o subtotal de VITRINE,
 *      e o campo `subtotalCentavos` significa "o que a tela somou a partir do
 *      catálogo" (spec §5.1). Uma promoção do motor não pode virar 409.
 */

const { test, before, after, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const Module = require("node:module");
const { createHash } = require("node:crypto");

const { subirPostgres } = require("./ajuda/postgres.js");
const { aplicarMigracoes } = require("../db/migrar.js");

let bd;
let PaymentController;
let motorRepo;

const ANA = "aaaaaaaa-0000-0000-0000-000000000001";
const P1 = "11111111-0000-4000-8000-0000000000a1";

const PROMO_ITEM = "10000000-0000-4000-8000-0000000000a1";
const PROMO_CUPOM = "10000000-0000-4000-8000-0000000000a2";
const PROMO_FRETE = "10000000-0000-4000-8000-0000000000a3";
/** O id que existe nas DUAS estruturas — é assim que a 0032 migrou. */
const PROMO_MIGRADA = "10000000-0000-4000-8000-0000000000a4";

const CPF_DA_ANA = "52998224725";
const HASH_DA_ANA = createHash("sha256").update(CPF_DA_ANA).digest("hex");

const mp = {
  statusDoGet: "approved",
  falhaNoCreate: false,
  criacoes: [],
};

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

function corpoDeCheckout(extra = {}) {
  return {
    formData: {
      paymentMethodId: "pix",
      payer: {
        email: "ana@ex.com",
        identification: { type: "CPF", number: CPF_DA_ANA },
      },
    },
    paymentMethodType: "pix",
    items: [{ product_id: P1, quantity: 2, name: "Café" }],
    userEmail: "ana@ex.com",
    address: { zip_code: "35012345", street: "Rua X", number: "1", state: "MG" },
    shippingCost: 0,
    shippingMethod: "Retirada na loja",
    ...extra,
  };
}

async function checkout(extra) {
  const res = respostaFalsa();
  await PaymentController.createPayment(
    { user: { userId: ANA }, headers: {}, body: corpoDeCheckout(extra), ip: "127.0.0.1" },
    res,
  );
  return res;
}

async function ultimaCobranca() {
  return mp.criacoes[mp.criacoes.length - 1];
}

async function ajustesDoPedido(pedidoId) {
  const { rows } = await bd.pool.query(
    `SELECT sequencia, alvo, alvo_ref, valor_centavos, rotulo, codigo, promocao_id
       FROM canastra.pedido_ajustes_desconto
      WHERE pedido_id = $1 ORDER BY sequencia`,
    [pedidoId],
  );
  return rows;
}

async function resgatesDoPedido(pedidoId) {
  const { rows } = await bd.pool.query(
    `SELECT promocao_id, codigo_id, documento_hash, valor_centavos, estornado_em
       FROM canastra.promocao_resgates
      WHERE pedido_id = $1 ORDER BY valor_centavos`,
    [pedidoId],
  );
  return rows;
}

async function usosDoCodigo(codigo) {
  const { rows } = await bd.pool.query(
    "SELECT usos FROM canastra.promocao_codigos WHERE codigo = $1",
    [codigo],
  );
  return rows[0].usos;
}

async function estoque() {
  const { rows } = await bd.pool.query(
    "SELECT quantidade FROM canastra.produtos WHERE produto_id = $1",
    [P1],
  );
  return rows[0].quantidade;
}

async function reporEstoque(qtd = 100) {
  await bd.pool.query(
    "UPDATE canastra.produtos SET quantidade = $1 WHERE produto_id = $2",
    [qtd, P1],
  );
}

/** Liga/desliga uma regra sem apagá-la — é o kill-switch de 0032. */
async function habilitar(id, ligada) {
  await bd.pool.query(
    "UPDATE canastra.promocoes SET habilitada = $2, atualizada_em = now() WHERE id = $1",
    [id, ligada],
  );
}

before(async () => {
  bd = await subirPostgres();
  await aplicarMigracoes(bd.pool);

  await bd.pool.query("INSERT INTO auth.users (id, email) VALUES ($1, 'ana@ex.com')", [ANA]);
  await bd.pool.query("INSERT INTO canastra.clientes (user_id, nome) VALUES ($1, 'Ana')", [ANA]);
  await bd.pool.query("INSERT INTO canastra.config_loja (id) VALUES (1)");
  await bd.pool.query(
    `INSERT INTO canastra.produtos (produto_id, nome, preco, quantidade, sku, categoria)
     VALUES ($1, 'Café do Teste', 50.00, 100, 'CLAS-250', 'Café')`,
    [P1],
  );

  await bd.pool.query(
    `INSERT INTO canastra.promocoes
       (id, nome, metodo, classe, mecanica, valor, prioridade, habilitada)
     VALUES
       ($1, 'Vitrine 10%', 'automatico', 'produto', 'percentual',  10, 50, true),
       ($2, 'MOTOR20',     'codigo',     'pedido',  'percentual',  20,  0, true),
       ($3, 'Frete grátis','automatico', 'frete',   'frete_gratis', NULL, 1, false),
       ($4, 'Migrada 10%', 'automatico', 'produto', 'percentual',  10, 40, false)`,
    [PROMO_ITEM, PROMO_CUPOM, PROMO_FRETE, PROMO_MIGRADA],
  );
  await bd.pool.query(
    `INSERT INTO canastra.promocao_escopo (promocao_id, tipo, alvo, incluir)
     VALUES ($1, 'todos', NULL, true), ($2, 'todos', NULL, true)`,
    [PROMO_ITEM, PROMO_MIGRADA],
  );
  await bd.pool.query(
    `INSERT INTO canastra.promocao_codigos (promocao_id, codigo) VALUES ($1, 'MOTOR20')`,
    [PROMO_CUPOM],
  );
  await bd.pool.query(
    `INSERT INTO canastra.promocao_frete (promocao_id, teto_frete_centavos)
     VALUES ($1, 3000)`,
    [PROMO_FRETE],
  );

  process.env.DATABASE_URL = bd.connectionString;
  delete process.env.MP_WEBHOOK_SECRET;
  process.env.NODE_ENV = "development";
  // Porta fechada: se algum caminho tentar a Melhor Envio, falha na hora — só
  // a Entrega Local (prefixo 350) é cotada aqui, e ela não sai da API.
  process.env.MELHOR_ENVIO_URL = "http://127.0.0.1:9";

  const requireOriginal = Module.prototype.require;
  Module.prototype.require = function (caminho) {
    if (caminho === "../config/mercadopago") {
      return {
        payment: {
          get: async ({ id }) => ({
            id,
            status: mp.statusDoGet,
            point_of_interaction: { transaction_data: { ticket_url: "https://mp.local/pix" } },
          }),
          create: async ({ body }) => {
            if (mp.falhaNoCreate) throw new Error("gateway caiu");
            mp.criacoes.push(body);
            return {
              id: 800000 + mp.criacoes.length,
              status: "pending",
              point_of_interaction: { transaction_data: { ticket_url: "https://mp.local/pix" } },
            };
          },
        },
      };
    }
    if (caminho === "../utils/emailSender") {
      return { sendStatusEmail: async () => {}, sendAdminNewOrderEmail: async () => {} };
    }
    return requireOriginal.apply(this, arguments);
  };

  try {
    PaymentController = require("../src/controllers/PaymentController.js");
    motorRepo = require("../src/repositories/motorRepository.js");
  } finally {
    Module.prototype.require = requireOriginal;
  }
}, { timeout: 120_000 });

after(async () => {
  await require("../src/pgPool.js").end().catch(() => {});
  await bd?.derrubar();
});

beforeEach(async () => {
  if (!bd) {
    throw new Error(
      "O Postgres nao subiu no before(); a causa real esta no erro daquele hook.",
    );
  }
  await reporEstoque();
});

/* --------------------------------------------------------------------------
 * A identidade ao centavo
 * -------------------------------------------------------------------------- */

/** O pedido do teste 1, reusado pelo teste do estorno. */
let pedidoComPromocaoECupom = null;

test("promoção E cupom: a soma dos ajustes bate com a diferença do subtotal, ao centavo", async () => {
  const res = await checkout({
    cupom: "motor20",
    // O subtotal DE VITRINE (spec §5.1): 2 × R$ 50,00 de catálogo. Declarar
    // isto com uma promoção ativa é o caso que derrubaria a loja se
    // `conferirSubtotal` comparasse contra o valor promocional.
    subtotalCentavos: 10000,
  });

  assert.equal(res.codigo, 201, JSON.stringify(res.corpo));
  pedidoComPromocaoECupom = res.corpo.orderId;

  // Etapa 1: 10% sobre 100,00 = 10,00 → subtotal 90,00.
  // Etapa 2: o cupom 20% sobre os 90,00 = 18,00.
  // Cobrado: 100,00 − 28,00 = 72,00, sem frete (retirada).
  assert.equal((await ultimaCobranca()).transaction_amount, 72);

  const { rows } = await bd.pool.query(
    "SELECT total, frete, desconto, cupom_codigo FROM canastra.pedidos WHERE pedido_id = $1",
    [pedidoComPromocaoECupom],
  );
  assert.equal(Number(rows[0].total), 72);
  assert.equal(Number(rows[0].frete), 0);
  // `desconto` é o desconto TOTAL do pedido, não só a parte do cupom legado —
  // senão `total + desconto` deixaria de fechar com o subtotal.
  assert.equal(Number(rows[0].desconto), 28);
  // Nenhum cupom LEGADO foi usado: o código é do motor.
  assert.equal(rows[0].cupom_codigo, null);

  const ajustes = await ajustesDoPedido(pedidoComPromocaoECupom);
  assert.deepEqual(
    ajustes.map((a) => [a.sequencia, a.alvo, a.valor_centavos]),
    [
      [1, "item", 1000],
      [2, "pedido", 1800],
    ],
  );
  assert.equal(ajustes[0].alvo_ref, P1, "desconto de item diz QUAL item — a NF-e rateia");
  assert.equal(ajustes[1].codigo, "MOTOR20", "a fotografia do código fica na linha");

  // A IDENTIDADE, medida e não suposta: subtotal de catálogo menos a soma dos
  // ajustes é exatamente o que foi cobrado pelos itens.
  const somaDosAjustes = ajustes.reduce((a, l) => a + l.valor_centavos, 0);
  const cobradoPelosItens = Math.round(Number(rows[0].total) * 100) -
    Math.round(Number(rows[0].frete) * 100);
  assert.equal(somaDosAjustes, 2800);
  assert.equal(10000 - somaDosAjustes, cobradoPelosItens);

  // Um resgate por promoção aplicada, com o hash do CPF — nunca o número.
  const resgates = await resgatesDoPedido(pedidoComPromocaoECupom);
  assert.equal(resgates.length, 2);
  assert.deepEqual(
    resgates.map((r) => r.valor_centavos),
    [1000, 1800],
  );
  assert.ok(resgates.every((r) => r.documento_hash === HASH_DA_ANA));
  assert.ok(resgates.every((r) => r.estornado_em === null));

  assert.equal(await usosDoCodigo("MOTOR20"), 1);
});

/* --------------------------------------------------------------------------
 * O estorno
 * -------------------------------------------------------------------------- */

test("webhook cancelando o pedido devolve o uso, e a campanha volta a valer", async () => {
  assert.ok(pedidoComPromocaoECupom, "depende do pedido do teste anterior");

  // O limite de 1 uso torna a devolução OBSERVÁVEL: antes do estorno a regra
  // some do motor; depois, volta.
  await bd.pool.query(
    "UPDATE canastra.promocoes SET limite_usos = 1 WHERE id = $1",
    [PROMO_CUPOM],
  );
  const antesDoEstorno = await motorRepo.carregarRegrasVigentes({ codigo: "MOTOR20" });
  assert.ok(
    !antesDoEstorno.some((r) => r.id === PROMO_CUPOM),
    "com o único uso consumido, a campanha não vale mais",
  );

  mp.statusDoGet = "cancelled";
  const res = respostaFalsa();
  await PaymentController.receiveWebhook(
    {
      headers: { "x-request-id": "req-teste" },
      body: { type: "payment", data: { id: 800001 } },
      ip: "127.0.0.1",
    },
    res,
  );
  mp.statusDoGet = "approved";
  assert.equal(res.codigo, 200);

  const resgates = await resgatesDoPedido(pedidoComPromocaoECupom);
  assert.equal(resgates.length, 2);
  assert.ok(
    resgates.every((r) => r.estornado_em !== null),
    "é `estornado_em`, não DELETE: o registro da tentativa continua no relatório",
  );
  assert.equal(await usosDoCodigo("MOTOR20"), 0, "o contador voltou");

  const depoisDoEstorno = await motorRepo.carregarRegrasVigentes({ codigo: "MOTOR20" });
  assert.ok(
    depoisDoEstorno.some((r) => r.id === PROMO_CUPOM),
    "carrinho abandonado não pode queimar campanha",
  );

  // REENVIO: o Mercado Pago reentrega por desenho, e a segunda notificação não
  // pode estornar de novo nem derrubar o contador abaixo de zero.
  const reenvio = respostaFalsa();
  mp.statusDoGet = "cancelled";
  await PaymentController.receiveWebhook(
    {
      headers: { "x-request-id": "req-teste" },
      body: { type: "payment", data: { id: 800001 } },
      ip: "127.0.0.1",
    },
    reenvio,
  );
  mp.statusDoGet = "approved";
  assert.equal(reenvio.codigo, 200);
  assert.equal(await usosDoCodigo("MOTOR20"), 0);

  await bd.pool.query(
    "UPDATE canastra.promocoes SET limite_usos = NULL WHERE id = $1",
    [PROMO_CUPOM],
  );
});

/* --------------------------------------------------------------------------
 * O limite por CPF
 * -------------------------------------------------------------------------- */

test("limite_por_cliente: a segunda compra da mesma pessoa não ganha o desconto", async () => {
  await bd.pool.query(
    "UPDATE canastra.promocoes SET limite_por_cliente = 1 WHERE id = $1",
    [PROMO_ITEM],
  );
  try {
    const primeira = await checkout({});
    assert.equal(primeira.codigo, 201, JSON.stringify(primeira.corpo));
    assert.equal((await ultimaCobranca()).transaction_amount, 90, "10% de 100,00");

    const segunda = await checkout({});
    assert.equal(segunda.codigo, 201, JSON.stringify(segunda.corpo));
    // O limite é por CPF e não por e-mail — e-mail é infinito e gratuito, e
    // cupom de primeira compra controlado por e-mail é cupom permanente.
    assert.equal((await ultimaCobranca()).transaction_amount, 100);
    assert.equal((await ajustesDoPedido(segunda.corpo.orderId)).length, 0);
  } finally {
    await bd.pool.query(
      "UPDATE canastra.promocoes SET limite_por_cliente = NULL WHERE id = $1",
      [PROMO_ITEM],
    );
  }
});

/* --------------------------------------------------------------------------
 * Frete
 * -------------------------------------------------------------------------- */

test("frete grátis do motor: o cobrado desce, e `pedidos.frete` guarda o BRUTO", async () => {
  await habilitar(PROMO_FRETE, true);
  await habilitar(PROMO_ITEM, false);
  try {
    // Entrega Local (prefixo 350): R$ 5,00 com 2 unidades. 2 × R$ 50 = R$ 100,
    // abaixo do piso de frete grátis de 0009 (R$ 149) — então o zero só pode
    // vir da regra do motor.
    const res = await checkout({ shippingCost: 5, shippingMethod: "Entrega Local" });
    assert.equal(res.codigo, 201, JSON.stringify(res.corpo));
    assert.equal((await ultimaCobranca()).transaction_amount, 100, "100 de itens + 0 de frete");

    const { rows } = await bd.pool.query(
      "SELECT total, frete FROM canastra.pedidos WHERE pedido_id = $1",
      [res.corpo.orderId],
    );
    assert.equal(Number(rows[0].total), 100);
    // O BRUTO fica gravado, e o abatimento tem linha própria: é assim que a
    // nota consegue dizer o que foi cobrado e o que a loja bancou.
    assert.equal(Number(rows[0].frete), 5);

    const ajustes = await ajustesDoPedido(res.corpo.orderId);
    assert.deepEqual(
      ajustes.map((a) => [a.alvo, a.alvo_ref, a.valor_centavos]),
      [["frete", null, 500]],
    );
  } finally {
    await habilitar(PROMO_FRETE, false);
    await habilitar(PROMO_ITEM, true);
  }
});

test("carrinho acima do piso do frete grátis com promoção do motor NÃO vira 409", async () => {
  /**
   * O 409 FALSO QUE ESTA DECISÃO EVITA, e ele é fácil de reintroduzir.
   *
   * Quem põe o número na tela é `POST /shipping/calculate`, que conhece o cupom
   * e mais nada — o motor só passa a falar com a cotação pública na Onda 6.
   * Se a recotação do checkout subtraísse o desconto do motor, este carrinho
   * cairia abaixo do piso de R$ 149 (0009), voltaria com frete cobrado, e o
   * "R$ 0,00" que o cliente viu não casaria com nada. Toda venda de campanha na
   * fronteira do piso morreria em "o frete mudou".
   *
   * 2 × R$ 80,00 = R$ 160,00, acima do piso; com os 10% da promoção seriam
   * R$ 144,00, abaixo dele. É exatamente a fronteira.
   */
  await bd.pool.query(
    "UPDATE canastra.produtos SET preco = 80.00 WHERE produto_id = $1",
    [P1],
  );
  try {
    const res = await checkout({ shippingCost: 0, shippingMethod: "Entrega Local" });
    assert.equal(res.codigo, 201, JSON.stringify(res.corpo));
    // R$ 160 − 10% = R$ 144, com frete grátis pelo piso.
    assert.equal((await ultimaCobranca()).transaction_amount, 144);
  } finally {
    await bd.pool.query(
      "UPDATE canastra.produtos SET preco = 50.00 WHERE produto_id = $1",
      [P1],
    );
  }
});

test("frete acima do teto NÃO fica grátis: a regra não vale, e nada é abatido", async () => {
  await bd.pool.query(
    "UPDATE canastra.promocao_frete SET teto_frete_centavos = 100 WHERE promocao_id = $1",
    [PROMO_FRETE],
  );
  await habilitar(PROMO_FRETE, true);
  await habilitar(PROMO_ITEM, false);
  try {
    const res = await checkout({ shippingCost: 5, shippingMethod: "Entrega Local" });
    assert.equal(res.codigo, 201, JSON.stringify(res.corpo));
    // R$ 5,00 de frete contra um teto de R$ 1,00: a regra não vale INTEIRA —
    // não abate R$ 1,00. Bancar meio SEDEX para o Acre é o que o teto impede.
    assert.equal((await ultimaCobranca()).transaction_amount, 105);
    assert.equal((await ajustesDoPedido(res.corpo.orderId)).length, 0);
  } finally {
    await bd.pool.query(
      "UPDATE canastra.promocao_frete SET teto_frete_centavos = 3000 WHERE promocao_id = $1",
      [PROMO_FRETE],
    );
    await habilitar(PROMO_FRETE, false);
    await habilitar(PROMO_ITEM, true);
  }
});

/* --------------------------------------------------------------------------
 * A trava do esgotamento e a compensação
 * -------------------------------------------------------------------------- */

test("código esgotado: 400 antes de cobrar, estoque e contador intactos", async () => {
  await bd.pool.query(
    "UPDATE canastra.promocao_codigos SET limite_usos = 1, usos = 1 WHERE codigo = 'MOTOR20'",
  );
  try {
    const cobrancasAntes = mp.criacoes.length;
    const estoqueAntes = await estoque();

    const res = await checkout({ cupom: "MOTOR20" });
    // Recusa, e não cobrança silenciosa pelo valor cheio: quem digitou um
    // código espera o desconto, e cobrar sem avisar seria pior que o 400.
    assert.equal(res.codigo, 400);
    // A FRASE É A CERTA. "Cupom não encontrado" mandaria a pessoa caçar erro de
    // digitação num código que ela copiou certo do anúncio — e as cinco frases
    // são contrato do plano mestre, compartilhadas com `utils/cupom.js`.
    assert.equal(res.corpo.details, "Cupom esgotado");
    assert.equal(res.corpo.error, "CUPOM_INVALIDO");
    assert.equal(mp.criacoes.length, cobrancasAntes, "não pode cobrar");
    assert.equal(await estoque(), estoqueAntes, "não pode reservar");
    assert.equal(await usosDoCodigo("MOTOR20"), 1, "o contador não andou");
  } finally {
    await bd.pool.query(
      "UPDATE canastra.promocao_codigos SET limite_usos = NULL, usos = 0 WHERE codigo = 'MOTOR20'",
    );
  }
});

test("código que não existe em nenhuma das duas estruturas: \"não encontrado\"", async () => {
  const cobrancasAntes = mp.criacoes.length;
  const res = await checkout({ cupom: "fantasma" });
  assert.equal(res.codigo, 400);
  assert.equal(res.corpo.details, "Cupom não encontrado");
  assert.equal(mp.criacoes.length, cobrancasAntes);
});

test("código de campanha DESABILITADA recusa com \"inativo\", não com \"esgotado\"", async () => {
  await habilitar(PROMO_CUPOM, false);
  try {
    const res = await checkout({ cupom: "MOTOR20" });
    assert.equal(res.codigo, 400);
    assert.equal(res.corpo.details, "Cupom inativo");
  } finally {
    await habilitar(PROMO_CUPOM, true);
  }
});

test("gateway caiu: estoque, contador do motor e resgates voltam", async () => {
  const usosAntes = await usosDoCodigo("MOTOR20");
  const estoqueAntes = await estoque();
  const pedidosAntes = await bd.pool.query(
    "SELECT count(*)::int AS n FROM canastra.promocao_resgates WHERE estornado_em IS NULL",
  );

  mp.falhaNoCreate = true;
  try {
    const res = await checkout({ cupom: "MOTOR20" });
    assert.equal(res.codigo, 500);
    assert.equal(await estoque(), estoqueAntes, "a reserva voltou");
    assert.equal(await usosDoCodigo("MOTOR20"), usosAntes, "o uso do código voltou");
    const depois = await bd.pool.query(
      "SELECT count(*)::int AS n FROM canastra.promocao_resgates WHERE estornado_em IS NULL",
    );
    // Sem pedido não há resgate: `promocao_resgates.pedido_id` é NOT NULL com
    // FK, então a linha nem chega a nascer.
    assert.equal(depois.rows[0].n, pedidosAntes.rows[0].n);
  } finally {
    mp.falhaNoCreate = false;
  }
});

/* --------------------------------------------------------------------------
 * A ponte da transição
 * -------------------------------------------------------------------------- */

test("campanha migrada pela 0032 (mesmo id nas duas estruturas) desconta UMA vez", async () => {
  // É EXATAMENTE o que a migração produziu: a linha de `promocoes_legado` e a
  // de `promocoes` compartilham o `id`. Sem a ponte, o checkout aplicaria o
  // legado por `precoComPromocao` E o novo pelo motor, e o cliente pagaria
  // menos do que a loja aprovou — sem nada no total revelando o dobro.
  await habilitar(PROMO_ITEM, false);
  await habilitar(PROMO_MIGRADA, true);
  await bd.pool.query(
    `INSERT INTO canastra.promocoes_legado
       (id, titulo, tipo, valor, aplica_a, inicio_em, fim_em, ativa)
     VALUES ($1, 'Migrada 10%', 'percent', 10, 'all',
             now() - interval '1 day', now() + interval '1 day', true)`,
    [PROMO_MIGRADA],
  );
  try {
    const res = await checkout({});
    assert.equal(res.codigo, 201, JSON.stringify(res.corpo));
    // 10% UMA vez: 90,00. Dobrado seriam 81,00.
    assert.equal((await ultimaCobranca()).transaction_amount, 90);

    const ajustes = await ajustesDoPedido(res.corpo.orderId);
    assert.equal(ajustes.length, 1);
    assert.equal(ajustes[0].valor_centavos, 1000);
    // A linha veio do caminho LEGADO, que não sabe qual campanha venceu o
    // `Math.min` — por isso `promocao_id` nulo e o rótulo genérico. A 0036
    // aposenta esse ramo e a partir dela toda linha aponta para a campanha.
    assert.equal(ajustes[0].promocao_id, null);
    assert.equal(ajustes[0].rotulo, "Promoção de vitrine");

    assert.equal(
      (await resgatesDoPedido(res.corpo.orderId)).length,
      0,
      "o legado não resgata: quem o aposenta é a 0036",
    );
  } finally {
    await bd.pool.query("DELETE FROM canastra.promocoes_legado WHERE id = $1", [
      PROMO_MIGRADA,
    ]);
    await habilitar(PROMO_MIGRADA, false);
    await habilitar(PROMO_ITEM, true);
  }
});
