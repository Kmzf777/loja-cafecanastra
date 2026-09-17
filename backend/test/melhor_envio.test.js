"use strict";

/**
 * O DIAGNÓSTICO DA FALHA DE COTAÇÃO — por que um 403 não basta.
 *
 * O ShippingController logava `apiError.message`, e o que saía era
 * "Request failed with status code 403". Três causas completamente diferentes
 * produzem exatamente essa linha:
 *
 *   · o IP do servidor bloqueado no firewall do Melhor Envio (E-WAF-0003);
 *   · o token errado, expirado ou de sandbox usado em produção;
 *   · o CEP de origem malformado no `.env`.
 *
 * A primeira se resolve com o suporte, a segunda no painel de aplicações, a
 * terceira editando uma variável. Nenhuma delas se resolve olhando a outra —
 * e foi isso que fez o diagnóstico de 16/09/2026 custar horas: o log dizia 403
 * e o comentário do próprio código já avisava que o modo de falha era "mudo do
 * lado errado".
 *
 * Medido em 17/09/2026: `sandbox.melhorenvio.com.br` responde **HTML** com
 * `E-WAF-0003` para o IP desta VPS — inclusive na home, inclusive sem token.
 */

const { test } = require("node:test");
const assert = require("node:assert/strict");

const { diagnosticarFalhaDeCotacao } = require("../src/utils/melhorEnvio.js");

/** Um erro do axios, na forma que o ShippingController recebe. */
const erroDoAxios = (status, data) => ({
  message: `Request failed with status code ${status}`,
  response: { status, data },
});

test("o bloqueio de WAF é nomeado, e manda para o suporte", () => {
  const html =
    '<!DOCTYPE html><html><body><h1>Acesso bloqueado (E-WAF-0003)</h1>' +
    "<p>Dispositivo bloqueado para acesso.</p></body></html>";

  const diagnostico = diagnosticarFalhaDeCotacao(erroDoAxios(403, html));

  assert.equal(diagnostico.causa, "ip-bloqueado");
  assert.match(diagnostico.mensagem, /E-WAF-0003/);
  assert.match(diagnostico.mensagem, /IP/);
  // A frase tem de dizer o que NÃO adianta fazer: trocar o token.
  assert.match(diagnostico.mensagem, /token/i);
});

test("401 é token, e a frase não manda procurar o firewall", () => {
  const diagnostico = diagnosticarFalhaDeCotacao(
    erroDoAxios(401, { message: "Unauthenticated." }),
  );

  assert.equal(diagnostico.causa, "token");
  assert.match(diagnostico.mensagem, /MELHOR_ENVIO_TOKEN/);
  assert.doesNotMatch(diagnostico.mensagem, /E-WAF/);
});

test("422 é o payload — e o CEP de origem é o suspeito número um", () => {
  const diagnostico = diagnosticarFalhaDeCotacao(
    erroDoAxios(422, { errors: { "from.postal_code": ["inválido"] } }),
  );

  assert.equal(diagnostico.causa, "dados");
  assert.match(diagnostico.mensagem, /ZIPCODE_ORIGIN/);
});

test("HTML em QUALQUER status é o firewall, não a API", () => {
  // A API responde JSON. Se voltou página, quem respondeu não foi ela — e o
  // status pode ser 403, 503 ou o que a borda decidir.
  const diagnostico = diagnosticarFalhaDeCotacao(
    erroDoAxios(503, "<!DOCTYPE html><html><body>Manutenção</body></html>"),
  );
  assert.equal(diagnostico.causa, "borda");
});

test("rede fora é rede fora, e não vira acusação ao token", () => {
  const diagnostico = diagnosticarFalhaDeCotacao({
    message: "connect ECONNREFUSED 127.0.0.1:9",
    code: "ECONNREFUSED",
  });

  assert.equal(diagnostico.causa, "rede");
  assert.doesNotMatch(diagnostico.mensagem, /token/i);
});

test("tempo esgotado tem nome próprio — o sandbox já foi lento antes", () => {
  const diagnostico = diagnosticarFalhaDeCotacao({
    message: "timeout of 12000ms exceeded",
    code: "ECONNABORTED",
  });
  assert.equal(diagnostico.causa, "tempo");
});

test("o que não se reconhece devolve a mensagem crua, sem inventar causa", () => {
  const diagnostico = diagnosticarFalhaDeCotacao(new Error("coisa nova"));
  assert.equal(diagnostico.causa, "desconhecida");
  assert.match(diagnostico.mensagem, /coisa nova/);
});

test("erro nenhum não explode a função que existe para explicar erro", () => {
  assert.equal(typeof diagnosticarFalhaDeCotacao(undefined).mensagem, "string");
});
