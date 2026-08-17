"use strict";

const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { subirPostgres } = require("./ajuda/postgres.js");
const { aplicarMigracoes } = require("../db/migrar.js");

let bd;

before(async () => {
  bd = await subirPostgres();
  await aplicarMigracoes(bd.pool);
}, { timeout: 120_000 });

after(async () => {
  await bd?.derrubar();
});

test("o schema canastra existe e os tres papeis o enxergam", async () => {
  const { rows } = await bd.pool.query(`
    SELECT r.rolname
    FROM pg_roles r
    WHERE r.rolname IN ('anon', 'authenticated', 'service_role')
      AND has_schema_privilege(r.rolname, 'canastra', 'USAGE')
    ORDER BY r.rolname
  `);
  assert.deepEqual(rows.map((r) => r.rolname), [
    "anon",
    "authenticated",
    "service_role",
  ]);
});

test("nenhuma tabela da loja fica em public", async () => {
  const { rows } = await bd.pool.query(
    "SELECT tablename FROM pg_tables WHERE schemaname = 'public'",
  );
  assert.deepEqual(rows, []);
});

test("o default privilege alcanca tabela criada depois, pelo mesmo papel", async () => {
  // O comportamento de ALTER DEFAULT PRIVILEGES nao e obvio e a fase inteira
  // depende dele: se os GRANTs de 0001 nao alcancassem as tabelas das migracoes
  // seguintes, cada rota da loja responderia 404 no PostgREST com a RLS
  // perfeita — e a busca comecaria pela politica, que e o lugar errado. Entao
  // isto e conferido, nao suposto.
  await bd.pool.query("CREATE TABLE canastra.sonda_mesmo_dono (id int)");
  try {
    const { rows } = await bd.pool.query(`
      SELECT
        has_table_privilege('anon', 'canastra.sonda_mesmo_dono', 'SELECT')          AS anon_le,
        has_table_privilege('anon', 'canastra.sonda_mesmo_dono', 'INSERT')          AS anon_escreve,
        has_table_privilege('authenticated', 'canastra.sonda_mesmo_dono', 'SELECT') AS auth_le,
        has_table_privilege('authenticated', 'canastra.sonda_mesmo_dono', 'DELETE') AS auth_apaga,
        has_table_privilege('service_role', 'canastra.sonda_mesmo_dono', 'TRUNCATE') AS servico_tudo
    `);
    assert.deepEqual(rows[0], {
      anon_le: true,
      // `anon` le e so. GRANT de escrita para anonimo seria a falha grave desta
      // migracao, e ela passaria despercebida sem asserir o lado negativo.
      anon_escreve: false,
      auth_le: true,
      auth_apaga: true,
      servico_tudo: true,
    });
  } finally {
    await bd.pool.query("DROP TABLE canastra.sonda_mesmo_dono");
  }
});

test("o default privilege NAO alcanca tabela criada por outro papel", async () => {
  // A letra miuda do ALTER DEFAULT PRIVILEGES: ele vale para o que o papel que
  // o executou criar, e para mais ninguem. Enquanto migracao e criacao de
  // tabela forem sempre o mesmo papel (o dono do DATABASE_URL), isto nao
  // incomoda. Deixa de valer no dia em que alguem criar uma tabela pelo Supabase
  // Studio ou por um psql com outro usuario: ela nasce invisivel para os tres
  // papeis, e o 404 resultante nao aponta para ca. Este teste existe para que a
  // limitacao esteja escrita e medida, e nao lembrada.
  await bd.pool.query("CREATE ROLE outro_dono NOLOGIN");
  try {
    await bd.pool.query("GRANT CREATE, USAGE ON SCHEMA canastra TO outro_dono");

    // Um cliente dedicado, e nao pool.query(): `SET ROLE` vale por CONEXAO, e o
    // pool nao promete devolver a mesma duas vezes seguidas. Pelo mesmo motivo o
    // par SET/RESET fica dentro de BEGIN/COMMIT com `SET LOCAL` — assim nenhuma
    // conexao volta ao pool ainda vestindo `outro_dono` e contaminando o proximo
    // teste.
    const cliente = await bd.pool.connect();
    try {
      await cliente.query("BEGIN");
      await cliente.query("SET LOCAL ROLE outro_dono");
      await cliente.query("CREATE TABLE canastra.sonda_outro_dono (id int)");
      await cliente.query("COMMIT");
    } catch (erro) {
      await cliente.query("ROLLBACK").catch(() => {});
      throw erro;
    } finally {
      cliente.release();
    }

    const { rows } = await bd.pool.query(`
      SELECT
        has_table_privilege('anon', 'canastra.sonda_outro_dono', 'SELECT')          AS anon_le,
        has_table_privilege('authenticated', 'canastra.sonda_outro_dono', 'SELECT') AS auth_le
    `);
    assert.deepEqual(rows[0], { anon_le: false, auth_le: false });
  } finally {
    await bd.pool.query("DROP TABLE IF EXISTS canastra.sonda_outro_dono");
    await bd.pool.query("REVOKE ALL ON SCHEMA canastra FROM outro_dono");
    await bd.pool.query("DROP ROLE IF EXISTS outro_dono");
  }
});
