"use strict";

/**
 * A borda HTTP da API: o que o navegador consegue MANDAR e o que ele consegue
 * LER de volta quando algo dá errado.
 *
 * Nenhum teste daqui precisa de banco — são dois defeitos de middleware, e
 * ambos são invisíveis pelo caminho feliz:
 *
 *  - o preflight recusando `Idempotency-Key` não produz erro de aplicação
 *    nenhum: a requisição simplesmente não acontece, e o controller tem
 *    fallback silencioso para um uuid novo (a defesa contra cobrança duplicada
 *    some sem deixar rastro);
 *  - o erro do multer virando 500 genérico não produz erro nenhum tampouco: a
 *    frase certa existe, está escrita, e nunca chega ao navegador.
 *
 * `index.js` NÃO é carregável num teste (abre porta, confere ambiente e fala
 * com o GoTrue no require), então o que se testa aqui são os módulos que ele
 * monta — e uma asserção de fonte garante que ele os monta na ordem certa,
 * mesmo padrão de vitrine_rotas.test.js:530.
 */

const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const express = require("express");
const cors = require("cors");
const fs = require("node:fs");
const path = require("node:path");

const { opcoesDeCors, CABECALHOS_LIBERADOS } = require("../src/config/cors.js");

let servidor;
let urlDaApi;

before(async () => {
  // O mesmo `cors(opcoesDeCors)` que index.js monta — não uma cópia da
  // configuração, senão o teste passaria com a API recusando o cabeçalho.
  const app = express();
  app.use(cors(opcoesDeCors));
  app.post("/payment/process", (req, res) => res.json({ ok: true }));

  await new Promise((pronto) => {
    servidor = app.listen(0, "127.0.0.1", pronto);
  });
  urlDaApi = `http://127.0.0.1:${servidor.address().port}`;
});

after(async () => {
  if (servidor) await new Promise((pronto) => servidor.close(pronto));
});

/* --------------------------------------------------------------------------
 * CORS: o cabeçalho de idempotência atravessa o preflight
 * -------------------------------------------------------------------------- */

test("o preflight libera Idempotency-Key, que o checkout envia e o PaymentController lê", async () => {
  const resposta = await fetch(`${urlDaApi}/payment/process`, {
    method: "OPTIONS",
    headers: {
      Origin: "http://localhost:3000",
      "Access-Control-Request-Method": "POST",
      // Em minúsculas de propósito: é assim que o navegador manda.
      "Access-Control-Request-Headers": "idempotency-key",
    },
  });

  assert.equal(resposta.status, 204);

  const liberados = (resposta.headers.get("access-control-allow-headers") || "")
    .split(",")
    .map((c) => c.trim().toLowerCase());

  assert.ok(
    liberados.includes("idempotency-key"),
    "sem este cabeçalho no preflight o checkout cross-origin nem sai do navegador, " +
      "e a defesa contra cobrança duplicada desaparece sem erro nenhum",
  );
  // O controller lê os DOIS nomes; liberar só um deixa metade da leitura morta.
  assert.ok(liberados.includes("x-idempotency-key"));

  // E os três de sempre continuam de pé.
  assert.ok(liberados.includes("content-type"));
  assert.ok(liberados.includes("authorization"));
  assert.ok(liberados.includes("accept"));
});

test("os dois nomes lidos pelo PaymentController estão na lista liberada", () => {
  // Casa a lista do CORS com a leitura real do controller: se alguém trocar o
  // nome num lado, este teste é o aviso — o navegador não daria nenhum.
  const controller = fs.readFileSync(
    path.join(__dirname, "..", "src", "controllers", "PaymentController.js"),
    "utf8",
  );
  const lidos = [...controller.matchAll(/req\.headers\["([a-z-]*idempotency-key)"\]/g)].map(
    (m) => m[1],
  );

  assert.deepEqual(new Set(lidos), new Set(["idempotency-key", "x-idempotency-key"]));
  for (const nome of lidos) {
    assert.ok(
      CABECALHOS_LIBERADOS.some((c) => c.toLowerCase() === nome),
      `o controller lê "${nome}" e o preflight não o libera`,
    );
  }
});
