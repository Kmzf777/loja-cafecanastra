/**
 * Testes das duas regras do checkout que protegem dinheiro.
 *
 * Rodam com o test runner nativo do Node (node --test), sem dependencia nova.
 *   npm test  (na pasta backend/)
 *
 * Nao sobem servidor nem banco: exercitam as funcoes puras exportadas por
 * PaymentController, que sao exatamente onde a decisao de seguranca acontece.
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const Module = require("node:module");

// ── Dublê da cotação de frete ───────────────────────────────────────────────
// O controller importa ./ShippingController; trocamos a implementacao antes do
// require para o teste nao depender da API da Melhor Envio.
let opcoesFalsas = [];
let cotacaoFalha = false;

const requireOriginal = Module.prototype.require;
Module.prototype.require = function (caminho) {
  if (caminho === "./ShippingController") {
    return {
      calcularOpcoesDeFrete: async () => {
        if (cotacaoFalha) throw new Error("Melhor Envio fora do ar");
        return opcoesFalsas;
      },
    };
  }
  return requireOriginal.apply(this, arguments);
};

process.env.MP_ACCESS_TOKEN = process.env.MP_ACCESS_TOKEN || "teste";
const { conferirFrete, validarAssinaturaWebhook } = require("../src/controllers/PaymentController");
Module.prototype.require = requireOriginal;

const ENDERECO = { zip_code: "35059620" };
const ITENS = [{ product_id: "p1", quantity: 1, price: 39.7, weight: 0.25 }];

// As opcoes falsas carregam NOME desde que `conferirFrete` passou a casar nome
// e preco: sem nome, todo teste daqui viraria 409 por nome divergente e os que
// checam PRECO passariam pelo motivo errado.
test("frete: aceita valor que corresponde a uma opção cotada", async () => {
  opcoesFalsas = [
    { name: "Correios PAC", price: 24.9 },
    { name: "Correios SEDEX", price: 38.5 },
  ];
  const conferido = await conferirFrete({
    address: ENDERECO,
    itens: ITENS,
    shippingCost: 24.9,
    shippingMethod: "Correios PAC",
  });
  assert.deepEqual(conferido, { valor: 24.9, metodo: "Correios PAC" });
});

test("frete: o preço de uma opção com o nome de outra é recusado", async () => {
  // O pedido gravava `metodo_envio` cru do corpo da requisicao: dava para
  // cobrar PAC e nascer com "Correios SEDEX" escrito, que e o que a operacao
  // le na hora de comprar a etiqueta.
  opcoesFalsas = [
    { name: "Correios PAC", price: 24.9 },
    { name: "Correios SEDEX", price: 38.5 },
  ];
  await assert.rejects(
    () =>
      conferirFrete({
        address: ENDERECO,
        itens: ITENS,
        shippingCost: 24.9,
        shippingMethod: "Correios SEDEX",
      }),
    (e) => e.status === 409,
  );
});

test("frete: recusa valor negativo (abateria do total do pedido)", async () => {
  opcoesFalsas = [{ name: "Correios PAC", price: 24.9 }];
  await assert.rejects(
    () =>
      conferirFrete({
        address: ENDERECO,
        itens: ITENS,
        shippingCost: -500,
        shippingMethod: "Correios PAC",
      }),
    (e) => e.status === 400,
  );
});

test("frete: recusa zero quando a entrega não é retirada", async () => {
  opcoesFalsas = [{ name: "Correios PAC", price: 24.9 }];
  await assert.rejects(
    () =>
      conferirFrete({
        address: ENDERECO,
        itens: ITENS,
        shippingCost: 0,
        shippingMethod: "Correios PAC",
      }),
    (e) => e.status === 409,
  );
});

test("frete: recusa valor que não corresponde a nenhuma opção", async () => {
  opcoesFalsas = [
    { name: "Correios PAC", price: 24.9 },
    { name: "Correios SEDEX", price: 38.5 },
  ];
  await assert.rejects(
    () =>
      conferirFrete({
        address: ENDERECO,
        itens: ITENS,
        shippingCost: 1.99,
        shippingMethod: "Correios PAC",
      }),
    (e) => e.status === 409,
  );
});

test("frete: retirada na loja custa zero e não consulta cotação", async () => {
  cotacaoFalha = true; // provaria consulta indevida
  const conferido = await conferirFrete({
    address: null,
    itens: ITENS,
    shippingCost: 0,
    shippingMethod: "Retirada na loja",
  });
  // "Retirada" e o nome CANONICO: a retirada nao sai de cotacao nenhuma, entao
  // e este atalho quem nomeia o metodo — nao a variacao que o cliente digitou.
  assert.deepEqual(conferido, { valor: 0, metodo: "Retirada" });
  cotacaoFalha = false;
});

test("frete: retirada com valor cobrado é recusada", async () => {
  await assert.rejects(
    () =>
      conferirFrete({
        address: null,
        itens: ITENS,
        shippingCost: 30,
        shippingMethod: "Retirada",
      }),
    (e) => e.status === 400,
  );
});

test("frete: recusa o pedido quando a cotação não pode ser refeita", async () => {
  // Aceitar o número do cliente aqui reabriria o buraco inteiro.
  cotacaoFalha = true;
  await assert.rejects(
    () =>
      conferirFrete({
        address: ENDERECO,
        itens: ITENS,
        shippingCost: 24.9,
        shippingMethod: "Correios PAC",
      }),
    (e) => e.status === 503,
  );
  cotacaoFalha = false;
});

test("frete: recusa endereço sem CEP", async () => {
  await assert.rejects(
    () =>
      conferirFrete({
        address: {},
        itens: ITENS,
        shippingCost: 24.9,
        shippingMethod: "Correios PAC",
      }),
    (e) => e.status === 400,
  );
});

// ── Assinatura do webhook ───────────────────────────────────────────────────

const SEGREDO = "segredo-de-teste";

function requisicaoAssinada({ id = "123", requestId = "req-1", ts, segredo = SEGREDO } = {}) {
  const carimbo = ts ?? Math.floor(Date.now() / 1000);
  const manifesto = `id:${id};request-id:${requestId};ts:${carimbo};`;
  const v1 = crypto.createHmac("sha256", segredo).update(manifesto).digest("hex");
  return {
    headers: { "x-signature": `ts=${carimbo},v1=${v1}`, "x-request-id": requestId },
    body: { data: { id } },
  };
}

test("webhook: aceita notificação assinada corretamente", () => {
  process.env.MP_WEBHOOK_SECRET = SEGREDO;
  assert.equal(validarAssinaturaWebhook(requisicaoAssinada()), true);
});

test("webhook: recusa assinatura forjada", () => {
  process.env.MP_WEBHOOK_SECRET = SEGREDO;
  const req = requisicaoAssinada({ segredo: "chute-do-atacante" });
  assert.equal(validarAssinaturaWebhook(req), false);
});

test("webhook: recusa quando o id do corpo é trocado depois de assinado", () => {
  process.env.MP_WEBHOOK_SECRET = SEGREDO;
  const req = requisicaoAssinada({ id: "123" });
  req.body.data.id = "999"; // apontar para o pagamento de outra pessoa
  assert.equal(validarAssinaturaWebhook(req), false);
});

test("webhook: recusa notificação antiga (replay)", () => {
  process.env.MP_WEBHOOK_SECRET = SEGREDO;
  const antiga = Math.floor(Date.now() / 1000) - 3600;
  assert.equal(validarAssinaturaWebhook(requisicaoAssinada({ ts: antiga })), false);
});

test("webhook: recusa requisição sem header de assinatura", () => {
  process.env.MP_WEBHOOK_SECRET = SEGREDO;
  assert.equal(validarAssinaturaWebhook({ headers: {}, body: {} }), false);
});

test("webhook: sem segredo, RECUSA em produção", () => {
  delete process.env.MP_WEBHOOK_SECRET;
  const anterior = process.env.NODE_ENV;
  process.env.NODE_ENV = "production";
  assert.equal(validarAssinaturaWebhook(requisicaoAssinada()), false);
  process.env.NODE_ENV = anterior;
});

test("webhook: sem segredo, aceita em desenvolvimento", () => {
  delete process.env.MP_WEBHOOK_SECRET;
  const anterior = process.env.NODE_ENV;
  process.env.NODE_ENV = "development";
  assert.equal(validarAssinaturaWebhook(requisicaoAssinada()), true);
  process.env.NODE_ENV = anterior;
});
