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
