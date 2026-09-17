"use strict";

/**
 * A API DE ORDERS DO MERCADO PAGO — a tradução entre o vocabulário da loja e o
 * que a aplicação `7289536483168143` aceita.
 *
 * POR QUE ESTE MÓDULO EXISTE. A loja inteira foi escrita contra
 * `POST /v1/payments`, e essa chamada responde **401 "Unauthorized use of live
 * credentials"** nesta aplicação — a frase mente sobre a causa: não é
 * credencial de produção, não é cartão de teste em modo live, não é o SDK. O
 * aplicativo foi criado escolhendo Checkout Transparente **via Orders**, e o
 * Mercado Pago não autoriza a API de Payments nele. Está medido em
 * `docs/mercadopago-orders.md` e reconfirmado em 16/09/2026: `/v1/payments`
 * → 401, `/v1/orders` → 201.
 *
 * TUDO AQUI É RESPOSTA REAL DO GATEWAY, não leitura de documentação. Cada
 * regra abaixo foi arrancada de um 400/402 de verdade contra a conta de teste
 * `TESTUSER2898971294415703080`.
 *
 * Sem banco de propósito: são funções puras, e um arquivo que não sobe
 * Postgres roda em milissegundos — é onde as regras de forma cabem.
 */

const { test } = require("node:test");
const assert = require("node:assert/strict");

const {
  montarCorpoDaOrder,
  traduzirStatusDaOrder,
  leituraDaOrder,
  descreverErroDoMp,
  chaveDeIdempotencia,
  LIMITE_EXTERNAL_CODE,
  LIMITE_EXTERNAL_REFERENCE,
} = require("../src/utils/mercadoPagoOrders.js");

const PAGADOR = {
  email: "ana@ex.com",
  primeiroNome: "Ana",
  sobrenome: "Souza",
  identificacao: { type: "CPF", number: "12345678909" },
};

const CAFE = {
  product_id: "11111111-0000-0000-0000-0000000000aa",
  name: "Café Clássico 250g",
  price: 39.7,
  quantity: 2,
  sku: "CLASSICO-250",
};

/** O caso simples: dois cafés, sem frete e sem desconto. */
function corpoBase(extra = {}) {
  return montarCorpoDaOrder({
    chaveIdempotencia: "chave-1",
    itens: [CAFE],
    freteCentavos: 0,
    descontoCentavos: 0,
    totalCentavos: 7940,
    meioDePagamento: "pix",
    descritor: "CAFECANASTRA",
    pagador: PAGADOR,
    ...extra,
  });
}

/* --------------------------------------------------------------------------
 * A forma do corpo
 * -------------------------------------------------------------------------- */

test("valor vai como STRING de duas casas, não como número", () => {
  // Payments aceitava `transaction_amount: 79.4`; Orders exige "79.40". Mandar
  // número aqui é 400 na hora.
  const corpo = corpoBase();
  assert.equal(corpo.total_amount, "79.40");
  assert.equal(corpo.transactions.payments[0].amount, "79.40");
  assert.equal(typeof corpo.items[0].unit_price, "string");
});

test("a soma dos itens TEM de fechar com o total — é regra do gateway", () => {
  // `order_items_total_amount_mismatch`, HTTP 400, medido. A Payments nunca
  // conferiu isso: lá os itens eram enfeite de antifraude e o valor cobrado
  // vinha de `transaction_amount`. Aqui os itens são o valor.
  const corpo = corpoBase();
  const soma = corpo.items.reduce(
    (t, i) => t + Math.round(Number(i.unit_price) * 100) * i.quantity,
    0,
  );
  assert.equal(soma, Math.round(Number(corpo.total_amount) * 100));
});

test("o frete entra como LINHA DE ITEM, senão a soma não fecha", () => {
  const corpo = corpoBase({ freteCentavos: 2500, totalCentavos: 10440 });

  const frete = corpo.items.find((i) => i.title === "Frete");
  assert.ok(frete, "sem uma linha de frete o gateway recusa o pedido inteiro");
  assert.equal(frete.unit_price, "25.00");
  assert.equal(frete.quantity, 1);
  assert.equal(corpo.total_amount, "104.40");
});

test("o desconto entra como linha NEGATIVA — medido, o gateway aceita", () => {
  const corpo = corpoBase({ descontoCentavos: 940, totalCentavos: 7000 });

  const desconto = corpo.items.find((i) => i.title === "Desconto");
  assert.ok(desconto);
  assert.equal(desconto.unit_price, "-9.40");
  assert.equal(corpo.total_amount, "70.00");
});

test("frete zero e desconto zero não viram linha de R$ 0,00", () => {
  const corpo = corpoBase();
  assert.deepEqual(
    corpo.items.map((i) => i.title),
    ["Café Clássico 250g"],
  );
});

test("o total que não fecha com os itens é barrado AQUI, não no gateway", () => {
  // Falhar na nossa borda dá uma frase que nomeia a causa; falhar na do MP dá
  // 400 genérico no meio de um checkout, com o estoque já reservado.
  assert.throws(
    () => corpoBase({ totalCentavos: 9999 }),
    /soma dos itens/i,
  );
});

test("external_code é o SKU, e some quando não há SKU", () => {
  // O `product_id` é UUID de 36 caracteres e o campo aceita 30:
  // "'$.items[0].external_code' - length must be <= 30, but got 36" — 400 real.
  // O campo é OPCIONAL (medido), então ausência é melhor que truncar um id
  // que deixaria de identificar o produto.
  assert.equal(corpoBase().items[0].external_code, "CLASSICO-250");

  const semSku = montarCorpoDaOrder({
    chaveIdempotencia: "chave-2",
    itens: [{ ...CAFE, sku: null }],
    freteCentavos: 0,
    descontoCentavos: 0,
    totalCentavos: 7940,
    meioDePagamento: "pix",
    descritor: "CAFECANASTRA",
    pagador: PAGADOR,
  });
  assert.equal("external_code" in semSku.items[0], false);
});

test("SKU comprido é truncado no limite do gateway, nunca enviado inteiro", () => {
  const comprido = "SKU-" + "X".repeat(40);
  const corpo = montarCorpoDaOrder({
    chaveIdempotencia: "chave-3",
    itens: [{ ...CAFE, sku: comprido }],
    freteCentavos: 0,
    descontoCentavos: 0,
    totalCentavos: 7940,
    meioDePagamento: "pix",
    descritor: "CAFECANASTRA",
    pagador: PAGADOR,
  });
  assert.equal(corpo.items[0].external_code.length, LIMITE_EXTERNAL_CODE);
});

test("o descritor da fatura mora DENTRO do payment_method", () => {
  // Na Payments era campo de topo. É o único campo que falha FECHADO: conta
  // com restrição de descritor recusa o pagamento, e aí não é uma venda que se
  // perde, são todas.
  const corpo = corpoBase();
  assert.equal(
    corpo.transactions.payments[0].payment_method.statement_descriptor,
    "CAFECANASTRA",
  );
  assert.equal("statement_descriptor" in corpo, false);
});

test("Pix: tipo bank_transfer e expiração de 30 minutos", () => {
  const pagamento = corpoBase().transactions.payments[0];
  assert.equal(pagamento.payment_method.id, "pix");
  assert.equal(pagamento.payment_method.type, "bank_transfer");
  assert.equal(pagamento.expiration_time, "PT30M");
  assert.equal("token" in pagamento.payment_method, false);
});

test("Pix NÃO leva installments — o gateway recusa o pedido inteiro", () => {
  // "'$.transactions.payments[0].payment_method' - additionalProperties
  // 'installments' not allowed", HTTP 400 medido em 16/09/2026. O checkout
  // manda `installments: 1` por padrão (o CardForm sempre preenche), e no Pix
  // esse 1 inofensivo derrubava a venda inteira. Vale para todo meio que não
  // seja cartão.
  const pagamento = corpoBase({ parcelas: 1 }).transactions.payments[0];
  assert.equal("installments" in pagamento.payment_method, false);
});

test("cartão: token e parcelas dentro do payment_method, sem expiração", () => {
  const pagamento = corpoBase({
    meioDePagamento: "master",
    token: "tok-123",
    parcelas: 3,
  }).transactions.payments[0];

  assert.equal(pagamento.payment_method.id, "master");
  assert.equal(pagamento.payment_method.type, "credit_card");
  assert.equal(pagamento.payment_method.token, "tok-123");
  assert.equal(pagamento.payment_method.installments, 3);
  assert.equal("expiration_time" in pagamento, false);
});

test("a chave de idempotência é o external_reference — o fio da conciliação", () => {
  assert.equal(corpoBase().external_reference, "chave-1");
});

test("nome vazio e documento ausente SOMEM, em vez de ir em branco", () => {
  // Campo vazio é pior que campo ausente para o motor de risco — a mesma
  // regra que a integração de Payments já seguia.
  const corpo = corpoBase({
    pagador: { email: "so@email.com", primeiroNome: "", sobrenome: "" },
  });
  assert.deepEqual(corpo.payer, { email: "so@email.com" });
});

/* --------------------------------------------------------------------------
 * A tradução de status
 * -------------------------------------------------------------------------- */

test("os status da Orders viram o vocabulário de nove palavras da loja", () => {
  // Medidos contra a conta de teste em 16/09/2026, um cartão por linha.
  assert.equal(traduzirStatusDaOrder("processed", "accredited"), "aprovado");
  assert.equal(traduzirStatusDaOrder("action_required", "waiting_transfer"), "pendente");
  assert.equal(traduzirStatusDaOrder("processing", "in_process"), "em_processamento");
  assert.equal(traduzirStatusDaOrder("failed", "failed"), "rejeitado");
  assert.equal(traduzirStatusDaOrder("canceled", null), "cancelado");
  assert.equal(traduzirStatusDaOrder("expired", null), "cancelado");
  assert.equal(traduzirStatusDaOrder("refunded", null), "reembolsado");
});

test("autorizado sem captura não é aprovado — o dinheiro ainda não entrou", () => {
  assert.equal(traduzirStatusDaOrder("processed", "pending_capture"), "autorizado");
});

test("status desconhecido devolve null, nunca a string crua", () => {
  // Gravar cru esbarraria no CHECK da 0009 com 23514. Quem chama decide.
  assert.equal(traduzirStatusDaOrder("teletransportado", "x"), null);
  assert.equal(traduzirStatusDaOrder(undefined, undefined), null);
});

/* --------------------------------------------------------------------------
 * A leitura da resposta
 * -------------------------------------------------------------------------- */

const ORDER_PIX = {
  id: "ORDTST01M2P0917QX40V9ZJ7AXP69GVA",
  status: "action_required",
  status_detail: "waiting_transfer",
  external_reference: "chave-1",
  transactions: {
    payments: [
      {
        id: "PAY01M2P091850GYHN6W9QM1R43Y4",
        status: "action_required",
        payment_method: {
          id: "pix",
          ticket_url: "https://mp.local/ticket",
          qr_code: "00020126580014br.gov.bcb.pix...",
          qr_code_base64: "iVBORw0KGgo=",
        },
      },
    ],
  },
};

test("o id que a loja grava é o da ORDER, o único relegível", () => {
  // `GET /v1/payments/PAY01...` responde 404 — o endpoint antigo não lê o id
  // novo. `GET /v1/orders/{id}` responde 200. `pedidos.pagamento_id_mp` já é
  // `text` (migração 0005), então a string cabe sem migração de banco.
  assert.equal(leituraDaOrder(ORDER_PIX).pagamentoId, "ORDTST01M2P0917QX40V9ZJ7AXP69GVA");
});

test("o QR do Pix mudou de lugar, e a leitura acha os três formatos", () => {
  const lido = leituraDaOrder(ORDER_PIX);
  assert.equal(lido.ticketUrl, "https://mp.local/ticket");
  assert.equal(lido.qrCode, "00020126580014br.gov.bcb.pix...");
  assert.equal(lido.qrCodeBase64, "iVBORw0KGgo=");
});

test("a leitura devolve o status já traduzido", () => {
  assert.equal(leituraDaOrder(ORDER_PIX).status, "pendente");
});

test("order sem transação não explode — devolve o que dá e nada mais", () => {
  const lido = leituraDaOrder({ id: "ORD1", status: "processed", status_detail: "accredited" });
  assert.equal(lido.pagamentoId, "ORD1");
  assert.equal(lido.status, "aprovado");
  assert.equal(lido.ticketUrl, undefined);
});

/* --------------------------------------------------------------------------
 * A mensagem de erro do gateway
 * -------------------------------------------------------------------------- */

test("a recusa do gateway vira uma linha que NOMEIA o campo", () => {
  // O `console.error` do Node imprime `details: [Array]` para array aninhado —
  // profundidade 2 é o padrão. Numa recusa da Orders, `details` é EXATAMENTE
  // onde mora a única informação útil: qual propriedade foi recusada e por
  // quê. O log dizia "Invalid value for property" e escondia qual.
  const erro = {
    errors: [
      {
        code: "unsupported_properties",
        message: "Properties not supported",
        details: [
          "'$.transactions.payments[0].payment_method' - additionalProperties 'installments' not allowed",
        ],
      },
      {
        code: "property_value",
        message: "Invalid value for property",
        details: ["'$.items[0].external_code' - length must be <= 30, but got 36"],
      },
    ],
  };

  const linha = descreverErroDoMp(erro);
  assert.match(linha, /installments' not allowed/);
  assert.match(linha, /length must be <= 30/);
  assert.match(linha, /unsupported_properties/);
});

test("erro sem forma de gateway devolve a mensagem que houver", () => {
  assert.match(descreverErroDoMp(new Error("socket hang up")), /socket hang up/);
  assert.equal(typeof descreverErroDoMp(undefined), "string");
});

test("a recusa embrulhada em `cause` também é lida", () => {
  // O SDK do Mercado Pago aninha a resposta em profundidades diferentes
  // conforme o caminho do erro; procurar em um lugar só era o que fazia a
  // linha sair vazia justamente na falha que importava.
  const erro = {
    cause: { errors: [{ code: "failed", message: "The following transactions failed", details: ["PAY01: insufficient_amount"] }] },
  };
  assert.match(descreverErroDoMp(erro), /insufficient_amount/);
});

/* --------------------------------------------------------------------------
 * A chave de idempotência, que é TAMBÉM o `external_reference`
 * -------------------------------------------------------------------------- */

test("a chave cabe no que a Orders aceita: 64 caracteres, sem pontuação", () => {
  // MEDIDO em 16/09/2026, e é uma regra que a Payments não tinha:
  //   "'$.external_reference' - does not match pattern"      (com ":" ou ".")
  //   "'$.external_reference' - length must be <= 64, but got 84"
  // A loja montava `${userId}:${chaveDoCliente}` — dois-pontos E, com um uuid
  // do navegador, 73 caracteres. Os dois erros de uma vez, em TODA venda.
  const chave = chaveDeIdempotencia({
    userId: "f1a35fc3-dc4c-4b34-8054-e2b423743dd3",
    chaveDoCliente: "b7e21f40-1f2a-4c88-9a11-0d3e77c1a555",
  });

  assert.ok(chave.length <= LIMITE_EXTERNAL_REFERENCE, `${chave.length} caracteres`);
  assert.match(chave, /^[A-Za-z0-9_-]+$/);
});

test("a mesma tentativa produz a MESMA chave — é disso que vive o replay", () => {
  // Duas tentativas do mesmo clique têm de colidir de propósito: é o que faz a
  // segunda receber o pedido da primeira em vez de uma segunda cobrança.
  const argumentos = { userId: "u-1", chaveDoCliente: "clique-abc" };
  assert.equal(chaveDeIdempotencia(argumentos), chaveDeIdempotencia(argumentos));
});

test("cliques diferentes do mesmo usuário não colidem", () => {
  const a = chaveDeIdempotencia({ userId: "u-1", chaveDoCliente: "clique-a" });
  const b = chaveDeIdempotencia({ userId: "u-1", chaveDoCliente: "clique-b" });
  assert.notEqual(a, b);
});

test("usuários diferentes com o MESMO clique não colidem", () => {
  // O navegador gera o id do clique; nada impede dois navegadores de gerarem
  // o mesmo valor, e sem o usuário na chave um pediria o pedido do outro.
  const a = chaveDeIdempotencia({ userId: "u-1", chaveDoCliente: "clique-x" });
  const b = chaveDeIdempotencia({ userId: "u-2", chaveDoCliente: "clique-x" });
  assert.notEqual(a, b);
});

test("o usuário continua legível na chave, para conciliar no painel do MP", () => {
  const chave = chaveDeIdempotencia({ userId: "u-1", chaveDoCliente: "clique-x" });
  assert.ok(chave.startsWith("u-1-"), chave);
});

test("sem chave do cliente, a chave ainda nasce — e ainda cabe", () => {
  // O pedido NUNCA grava sem chave: o índice único tem de continuar armado
  // para todo caminho futuro, mesmo o do checkout que não manda o cabeçalho.
  const chave = chaveDeIdempotencia({ userId: "f1a35fc3-dc4c-4b34-8054-e2b423743dd3" });
  assert.ok(chave.length > 0);
  assert.ok(chave.length <= LIMITE_EXTERNAL_REFERENCE);
  assert.match(chave, /^[A-Za-z0-9_-]+$/);
  // E duas chamadas sem clique NÃO podem colidir: são dois pedidos distintos.
  assert.notEqual(
    chaveDeIdempotencia({ userId: "u-1" }),
    chaveDeIdempotencia({ userId: "u-1" }),
  );
});

test("um userId absurdamente longo não estoura o limite", () => {
  const chave = chaveDeIdempotencia({
    userId: "u".repeat(200),
    chaveDoCliente: "clique",
  });
  assert.ok(chave.length <= LIMITE_EXTERNAL_REFERENCE, `${chave.length}`);
  assert.match(chave, /^[A-Za-z0-9_-]+$/);
});
