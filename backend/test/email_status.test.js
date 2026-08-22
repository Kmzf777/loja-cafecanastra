"use strict";

/**
 * O e-mail de status era o UNICO sender deste arquivo que interpolava texto do
 * cliente cru no HTML — `nome` (cadastro) e `trackingCode` (digitado no painel).
 * Os outros ja passavam por escaparHtml. Estes testes fixam a convencao.
 *
 * Nao precisa de banco nem de chave do Resend: `conteudoDoStatus` e
 * `corpoDoEmailDeStatus` sao puras, `config/mailer.js` cai num duble sem
 * EMAIL_PASS2, e `pgPool` so constroi o Pool (nao conecta).
 */

const { test } = require("node:test");
const assert = require("node:assert/strict");

const {
  conteudoDoStatus,
  corpoDoEmailDeStatus,
  sendAdminNewOrderEmail,
} = require("../src/utils/emailSender.js");

const PEDIDO = {
  order_id: "abcdef12-0000-0000-0000-000000000001",
  total_amount: 149.9,
};

test("o nome do cliente sai escapado no corpo do e-mail", () => {
  const conteudo = conteudoDoStatus(
    "aprovado",
    PEDIDO,
    "<img src=x onerror=alert(1)>",
    null,
  );
  const html = corpoDoEmailDeStatus(conteudo, PEDIDO);

  assert.ok(
    !html.includes("<img src=x"),
    "o nome entrou como marcacao viva no HTML",
  );
  assert.ok(
    html.includes("&lt;img src=x onerror=alert(1)&gt;"),
    "o nome deveria aparecer escapado",
  );
});

test("o codigo de rastreio sai escapado", () => {
  const conteudo = conteudoDoStatus("enviado", PEDIDO, "Ana", "AA<BB>CC");
  const html = corpoDoEmailDeStatus(conteudo, PEDIDO);

  assert.ok(html.includes("AA&lt;BB&gt;CC"), "o rastreio deveria vir escapado");
  assert.ok(!html.includes("AA<BB>CC"), "o rastreio entrou cru");
});

test("a quebra de linha do rastreio continua virando <br/>", () => {
  const conteudo = conteudoDoStatus("enviado", PEDIDO, "Ana", "PY123BR");
  const html = corpoDoEmailDeStatus(conteudo, PEDIDO);

  // O \n que separa a linha do rastreio tem de chegar como <br/> DE VERDADE —
  // `includes("<br/>")` sozinho passaria pelo <br/> fixo do template.
  assert.match(html, /<br\/>Seu código de rastreio é: PY123BR/);
  assert.ok(!html.includes("&lt;br/&gt;"), "o <br/> do template foi escapado");
});

test("o assunto tambem sai escapado no <h2>", () => {
  const conteudo = conteudoDoStatus("aprovado", PEDIDO, "Ana", null);
  conteudo.subject = "Pagamento <b>aprovado</b>";
  const html = corpoDoEmailDeStatus(conteudo, PEDIDO);

  assert.ok(html.includes("&lt;b&gt;aprovado&lt;/b&gt;"));
  assert.ok(!html.includes("<b>aprovado</b>"));
});

/**
 * O AVISO DO ADMIN entrou na convencao depois: interpolava `order_id` e
 * `payment_method` crus, no mesmo arquivo cujo comentario diz que "quem le o
 * template nao deveria ter de provar, campo por campo, qual interpolacao e
 * segura".
 *
 * `payment_method` e o `finalPaymentMethodId` do PaymentController, resolvido de
 * `formData.paymentMethodId || formData.payment_method_id || paymentMethodType`
 * — corpo da requisicao. O unico filtro e o Mercado Pago aceitar o valor como
 * payment_method_id, e o `payment.create` roda ANTES do `createOrder`: o que
 * chega ao e-mail passou pela validacao DELES, nunca pela nossa.
 *
 * NAO e falha exploravel entre usuarios — o destinatario e sempre o admin. E
 * consistencia com a convencao do proprio arquivo, que e o motivo deste ramo.
 *
 * POR QUE ESTE TESTE CAPTURA O ENVIO em vez de chamar uma funcao pura, como os
 * quatro acima: este sender monta o HTML inline. Extrair um corpo puro so para
 * o teste alcanca-lo mexeria mais em producao do que a correcao inteira —
 * capturar a mensagem que ele entrega ao Resend prova o caminho que producao
 * usa, inteiro.
 */
test("o e-mail do admin escapa id do pedido e metodo de pagamento", async () => {
  const resend = require("../src/config/mailer.js");
  const enviarOriginal = resend.emails.send;
  let mensagem = null;
  resend.emails.send = async (m) => {
    mensagem = m;
    return { data: { id: "email-de-teste" }, error: null };
  };

  try {
    await sendAdminNewOrderEmail({
      order_id: "abcdef12-<script>alert(1)</script>",
      total_amount: 149.9,
      payment_method: 'pix"><img src=x>',
    });
  } finally {
    resend.emails.send = enviarOriginal;
  }

  // O sender ENGOLE erro (try/catch com console.error): sem esta guarda, um
  // lance antes do envio deixaria as assercoes abaixo passando no vazio.
  assert.ok(mensagem, "nada foi entregue ao Resend");

  assert.ok(
    !mensagem.html.includes("<script>"),
    "o id do pedido entrou como marcacao viva",
  );
  assert.ok(
    mensagem.html.includes("&lt;script&gt;alert(1)&lt;/script&gt;"),
    "o id do pedido deveria aparecer escapado",
  );

  // O metodo passa por toUpperCase ANTES do escape — invertendo a ordem, o
  // `&lt;` viraria `&LT;` e o escape seria desfeito no caminho.
  assert.ok(
    !mensagem.html.includes("<IMG SRC=X>"),
    "o metodo de pagamento entrou como marcacao viva",
  );
  assert.ok(
    mensagem.html.includes("PIX&quot;&gt;&lt;IMG SRC=X&gt;"),
    "o metodo de pagamento deveria aparecer escapado e em maiusculas",
  );
});
