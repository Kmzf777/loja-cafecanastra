"use strict";

const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { subirPostgres } = require("./ajuda/postgres.js");
const { comoPapel } = require("./ajuda/sessao.js");

let bd;

before(async () => {
  bd = await subirPostgres();
}, { timeout: 120_000 });

after(async () => {
  await bd.derrubar();
});

test("auth.uid() devolve o sub do claim", async () => {
  const sub = "11111111-1111-1111-1111-111111111111";
  const linha = await comoPapel(bd.pool, { papel: "authenticated", sub }, (c) =>
    c.query("SELECT auth.uid() AS uid"),
  );
  assert.equal(linha.rows[0].uid, sub);
});

// Este teste vale mais do que parece, e depende de rodar DEPOIS do de cima: a
// conexao devolvida pelo pool e a mesma, e um GUC personalizado volta para
// string vazia (nao NULL) quando a transacao anterior termina. E esse '' que
// faz `''::jsonb` estourar. Nao reordene nem isole este caso.
test("auth.uid() e nulo sem claim", async () => {
  const linha = await comoPapel(bd.pool, { papel: "anon" }, (c) =>
    c.query("SELECT auth.uid() AS uid"),
  );
  assert.equal(linha.rows[0].uid, null);
});
