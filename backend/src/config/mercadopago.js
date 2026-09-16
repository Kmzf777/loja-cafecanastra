/**
 * O cliente do Mercado Pago — DOIS objetos, e o motivo não é estilo.
 *
 * A aplicação `7289536483168143` desta loja foi criada escolhendo Checkout
 * Transparente **via Orders**, e o Mercado Pago não autoriza a API de Payments
 * nela: `POST /v1/payments` responde 401 "Unauthorized use of live
 * credentials" — a frase mente sobre a causa, e `docs/mercadopago-orders.md`
 * guarda a medição que descarta as três suspeitas óbvias.
 *
 *   `order`   CRIA a cobrança (`POST /v1/orders`). É o caminho autorizado.
 *   `payment` RELÊ pelo endpoint antigo, e continua indispensável: a
 *             notificação de webhook chega como `type: "payment"` com o id
 *             NUMÉRICO, e `GET /v1/payments/{id}` responde 200 com o
 *             vocabulário legado (`approved`/`pending`/`rejected`) e com o
 *             `external_reference` que reencontra o pedido.
 *
 * Só a CRIAÇÃO estava bloqueada. Leitura, assinatura recorrente (o Clube) e o
 * resto da loja seguem de pé pelo cliente de sempre.
 */
const { MercadoPagoConfig, Payment, Order } = require("mercadopago");

const client = new MercadoPagoConfig({
  accessToken: process.env.MP_ACCESS_TOKEN,
  options: { timeout: 5000 },
});

const payment = new Payment(client);
const order = new Order(client);

module.exports = { payment, order };
