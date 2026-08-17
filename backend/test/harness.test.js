"use strict";

const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { subirPostgres } = require("./ajuda/postgres.js");
const { comoPapel, ErroDeHarness } = require("./ajuda/sessao.js");

let bd;

before(async () => {
  bd = await subirPostgres();
}, { timeout: 120_000 });

after(async () => {
  // O `?.` importa: se subirPostgres() falhar, `bd` fica undefined e um after()
  // sem guarda estoura "Cannot read properties of undefined" — e e ESSE
  // TypeError que o node --test reporta, escondendo a falha de boot que
  // realmente interessa.
  await bd?.derrubar();
});

test("auth.uid() le o sub do claim e volta a NULL na conexao reaproveitada", async () => {
  const sub = "11111111-1111-1111-1111-111111111111";

  const comClaim = await comoPapel(bd.pool, { papel: "authenticated", sub }, (c) =>
    c.query("SELECT auth.uid() AS uid, pg_backend_pid() AS pid"),
  );
  assert.equal(comClaim.rows[0].uid, sub);

  // A segunda chamada e a regressao de verdade: o GUC nao volta a NULL quando a
  // transacao acima termina, volta a STRING VAZIA, e ''::jsonb estoura. As duas
  // chamadas vivem no mesmo teste de proposito — quando eram dois testes
  // separados, a cobertura dependia da ordem entre eles e sumia em silencio se
  // alguem inserisse um teste no meio ou ligasse concorrencia.
  const semClaim = await comoPapel(bd.pool, { papel: "anon" }, (c) =>
    c.query("SELECT auth.uid() AS uid, pg_backend_pid() AS pid"),
  );
  assert.equal(semClaim.rows[0].uid, null);

  // Sem reuso da conexao o caso acima nem chega a ser exercitado, entao o reuso
  // e verificado em vez de suposto.
  assert.equal(
    semClaim.rows[0].pid,
    comClaim.rows[0].pid,
    "o pool devia ter reaproveitado a mesma conexao",
  );
});

test("papel fora do whitelist e recusado", async () => {
  // "postgres" e superusuario: se passasse, ignoraria toda a RLS e faria um
  // teste de isolamento passar exatamente quando nao ha isolamento.
  await assert.rejects(
    () => comoPapel(bd.pool, { papel: "postgres" }, (c) => c.query("SELECT 1")),
    ErroDeHarness,
  );
});

test("sub vazio e recusado em vez de virar sessao anonima", async () => {
  await assert.rejects(
    () =>
      comoPapel(bd.pool, { papel: "authenticated", sub: "" }, (c) =>
        c.query("SELECT 1"),
      ),
    ErroDeHarness,
  );
});
