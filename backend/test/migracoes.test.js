"use strict";

const { test, before, after, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const os = require("node:os");
const fs = require("node:fs/promises");
const { subirPostgres } = require("./ajuda/postgres.js");
const { aplicarMigracoes } = require("../db/migrar.js");

let bd;
let pasta;

// Cada teste ganha uma pasta nova e nenhuma e apagada no caminho — apagar entre
// testes atrapalharia depurar uma falha. O `after()` limpa todas de uma vez: sem
// isso cada `npm test` deixaria uma canastra-mig-* orfa no %TEMP% para sempre,
// e nao ha aqui nenhum motivo (como o do datadir do Postgres, que pode ficar com
// handles abertos) para aceitar o vazamento.
const pastasCriadas = [];

before(async () => {
  bd = await subirPostgres();
}, { timeout: 120_000 });

after(async () => {
  await bd?.derrubar();
  await Promise.all(
    pastasCriadas.map((p) => fs.rm(p, { recursive: true, force: true })),
  );
});

beforeEach(async () => {
  pasta = await fs.mkdtemp(path.join(os.tmpdir(), "canastra-mig-"));
  pastasCriadas.push(pasta);
  await bd.pool.query("DROP SCHEMA IF EXISTS canastra CASCADE");
});

test("aplica arquivos em ordem numerica, nao alfabetica", async () => {
  // 0002 e 0010: alfabeticamente 0010 vem antes de 0002. Se o runner ordenar
  // como texto, a segunda migracao roda antes da primeira e o CREATE TABLE
  // referencia uma tabela que ainda nao existe.
  await fs.writeFile(
    path.join(pasta, "0002_primeira.sql"),
    "CREATE TABLE canastra.a (id int PRIMARY KEY);",
  );
  await fs.writeFile(
    path.join(pasta, "0010_segunda.sql"),
    "CREATE TABLE canastra.b (id int REFERENCES canastra.a(id));",
  );

  const aplicadas = await aplicarMigracoes(bd.pool, pasta);
  assert.deepEqual(aplicadas, ["0002_primeira", "0010_segunda"]);
});

test("rodar de novo nao reaplica nada", async () => {
  await fs.writeFile(
    path.join(pasta, "0001_uma.sql"),
    "CREATE TABLE canastra.c (id int);",
  );

  const primeira = await aplicarMigracoes(bd.pool, pasta);
  const segunda = await aplicarMigracoes(bd.pool, pasta);

  assert.deepEqual(primeira, ["0001_uma"]);
  assert.deepEqual(segunda, []);
});

test("migracao que falha nao deixa rastro nem e registrada", async () => {
  await fs.writeFile(
    path.join(pasta, "0001_boa.sql"),
    "CREATE TABLE canastra.d (id int);",
  );
  await fs.writeFile(
    path.join(pasta, "0002_ruim.sql"),
    "CREATE TABLE canastra.e (id int); SELECT coluna_que_nao_existe;",
  );

  await assert.rejects(() => aplicarMigracoes(bd.pool, pasta));

  const tabelas = await bd.pool.query(
    "SELECT tablename FROM pg_tables WHERE schemaname = 'canastra' ORDER BY tablename",
  );
  // `d` ficou (migracao anterior, ja commitada). `e` nao pode ter ficado.
  assert.deepEqual(
    tabelas.rows.map((r) => r.tablename),
    ["d", "migracoes"],
  );

  const registro = await bd.pool.query(
    "SELECT versao FROM canastra.migracoes ORDER BY versao",
  );
  assert.deepEqual(registro.rows.map((r) => r.versao), ["0001_boa"]);
});

test("o erro de uma migracao preserva o SQLSTATE e nomeia a versao", async () => {
  // Quem chama precisa poder distinguir "tabela ja existe" (42P07) de "sintaxe
  // invalida" (42601) sem casar texto de mensagem — a mesma licao que sessao.js
  // registrou sobre o 42501. Embrulhar so `erro.message` jogaria o `code` fora.
  await fs.writeFile(
    path.join(pasta, "0001_sintaxe.sql"),
    "ISTO NAO E SQL;",
  );

  await assert.rejects(() => aplicarMigracoes(bd.pool, pasta), (erro) => {
    assert.equal(erro.code, "42601");
    assert.equal(erro.versao, "0001_sintaxe");
    assert.match(erro.message, /0001_sintaxe/);
    return true;
  });
});

test("recusa arquivo sem prefixo numerico, mesmo sendo o unico", async () => {
  // "mesmo sendo o unico" e o caso que importa: validar dentro do comparador do
  // sort() nao pega nada quando ha um arquivo so, porque o sort nem chama o
  // comparador — e o arquivo seria executado e registrado com a versao errada.
  await fs.writeFile(
    path.join(pasta, "cria_tudo.sql"),
    "CREATE TABLE canastra.f (id int);",
  );

  await assert.rejects(() => aplicarMigracoes(bd.pool, pasta), /cria_tudo\.sql/);

  const tabelas = await bd.pool.query(
    "SELECT tablename FROM pg_tables WHERE schemaname = 'canastra'",
  );
  assert.deepEqual(
    tabelas.rows.map((r) => r.tablename),
    ["migracoes"],
  );
});

test("recusa duas migracoes com o mesmo numero", async () => {
  // Dois branches que criam 0003 e um acidente de merge comum. Com numeros
  // iguais o comparador devolve 0 e a ordem passa a ser a do readdir(), que
  // varia por sistema de arquivos: rodaria numa ordem no Windows e noutra no
  // Linux do VPS. Falhar alto e melhor que ordem nao-determinista.
  await fs.writeFile(path.join(pasta, "0003_a.sql"), "SELECT 1;");
  await fs.writeFile(path.join(pasta, "0003_b.sql"), "SELECT 1;");

  await assert.rejects(
    () => aplicarMigracoes(bd.pool, pasta),
    /0003_a\.sql.*0003_b\.sql|0003_b\.sql.*0003_a\.sql/s,
  );
});
