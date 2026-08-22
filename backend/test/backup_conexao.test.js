"use strict";

/**
 * As duas funções que tiram a senha do argv do pg_dump (scripts/lib/conexao-pg.sh).
 *
 * POR QUE TEM TESTE: a senha dentro de uma URI é percent-encoded, e libpq a
 * decodifica ao conectar. Mover o valor CRU para PGPASSWORD quebraria em
 * silêncio toda senha com @, / ou % — exatamente os caracteres que obrigam a
 * codificação. E falha silenciosa de backup só aparece no dia do desastre.
 *
 * Roda bash de verdade: Git Bash no Windows, bash do ubuntu-latest no CI.
 */

const { test } = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const LIB = path.resolve(__dirname, "../../scripts/lib/conexao-pg.sh");

/**
 * A URI vai como ARGUMENTO ($2), nunca interpolada no texto do script: assim o
 * próprio teste não depende de aspas do shell para valer.
 */
function rodar(funcao, uri) {
  return execFileSync(
    "bash",
    ["-c", `. "$1"; ${funcao} "$2"`, "bash", LIB, uri],
    { encoding: "utf8" },
  );
}

const senha = (uri) => rodar("senha_da_uri", uri);
const semSenha = (uri) => rodar("uri_sem_senha", uri);

test("senha simples", () => {
  assert.equal(
    senha("postgres://postgres:segredo@localhost:5432/postgres"),
    "segredo",
  );
});

test("senha com @ codificado", () => {
  assert.equal(
    senha("postgres://postgres:s%40gredo@localhost:5432/postgres"),
    "s@gredo",
  );
});

test("senha com / codificado", () => {
  assert.equal(senha("postgres://u:a%2Fb@localhost:5432/postgres"), "a/b");
});

test("senha com % codificado", () => {
  assert.equal(senha("postgres://u:a%25b@localhost:5432/postgres"), "a%b");
});

test("senha com barra invertida codificada", () => {
  assert.equal(senha("postgres://u:a%5Cb@localhost:5432/postgres"), "a\\b");
});

test("URI sem senha devolve vazio", () => {
  assert.equal(senha("postgres://postgres@localhost:5432/postgres"), "");
});

test("uri_sem_senha preserva usuário, host, porta e banco", () => {
  assert.equal(
    semSenha("postgres://postgres:segredo@localhost:5432/postgres"),
    "postgres://postgres@localhost:5432/postgres",
  );
});

test("uri_sem_senha preserva a query string", () => {
  assert.equal(
    semSenha("postgres://u:p@host:5432/db?sslmode=require"),
    "postgres://u@host:5432/db?sslmode=require",
  );
});

test("uri_sem_senha é no-op quando não há senha", () => {
  const uri = "postgres://postgres@localhost:5432/postgres";
  assert.equal(semSenha(uri), uri);
});

test("a senha nunca sobra na URI de saída", () => {
  for (const uri of [
    "postgres://postgres:segredo@localhost:5432/postgres",
    "postgres://u:s%40gredo@localhost:5432/postgres",
    "postgres://u:p@host:5432/db?sslmode=require",
  ]) {
    const saida = semSenha(uri);
    assert.ok(!saida.includes("segredo"), `sobrou senha em ${saida}`);
    assert.ok(!saida.includes("s%40gredo"), `sobrou senha em ${saida}`);
    assert.ok(!/:[^@/]*@/.test(saida.replace("://", "")), `sobrou userinfo com senha em ${saida}`);
  }
});
