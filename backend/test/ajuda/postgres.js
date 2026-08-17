"use strict";

/**
 * Postgres de verdade para os testes.
 *
 * RLS nao e simulavel: `pg-mem` e afins nao implementam politica de linha, e uma
 * politica que "passa" num mock e exatamente o tipo de falha que este projeto
 * nao pode ter — o isolamento contra os outros projetos da instancia
 * compartilhada depende dela. Entao os testes sobem um Postgres 16 real, sem
 * Docker.
 *
 * O shim de `auth` existe porque `auth.users` e `auth.uid()` sao do GoTrue e nao
 * existem num Postgres cru. Ele NAO entra em migracao nenhuma: em producao esse
 * schema ja esta la, criado pelo Supabase.
 */

// `embedded-postgres` e um pacote ESM puro e o construtor e o export default.
// Sob require() o Node devolve o namespace do modulo, nao a classe — sem o
// `.default` o `new` abaixo estoura com "is not a constructor".
const EmbeddedPostgres = require("embedded-postgres").default;
const path = require("node:path");
const os = require("node:os");
const fs = require("node:fs/promises");
const { Pool } = require("pg");

const SENHA = "postgres";

/** Papeis que o Supabase cria e dos quais as politicas dependem. */
const PAPEIS = `
  DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
      CREATE ROLE anon NOLOGIN;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
      CREATE ROLE authenticated NOLOGIN;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
      CREATE ROLE service_role NOLOGIN BYPASSRLS;
    END IF;
  END $$;
`;

/**
 * Shim do GoTrue. `auth.uid()` reproduz a definicao real do Supabase: le o
 * claim `sub` de `request.jwt.claims`, que o PostgREST injeta por requisicao.
 *
 * O `nullif` de fora do cast para jsonb nao e enfeite, e a razao de o Supabase
 * escrever a funcao assim. Um GUC personalizado que nunca foi setado devolve
 * NULL, mas depois do primeiro SET LOCAL ele volta para STRING VAZIA no fim da
 * transacao — nao para NULL. Como o pool reaproveita conexoes, a segunda
 * transacao de uma mesma conexao encontra '' e `''::jsonb` estoura
 * "invalid input syntax for type json". Sem esse nullif, toda politica de RLS
 * que chame auth.uid() quebraria na segunda requisicao de cada conexao.
 */
const AUTH = `
  CREATE SCHEMA IF NOT EXISTS auth;
  CREATE TABLE IF NOT EXISTS auth.users (
    id    uuid PRIMARY KEY,
    email text UNIQUE
  );
  CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid
    LANGUAGE sql STABLE
  AS $$
    SELECT nullif(
      nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub',
      ''
    )::uuid
  $$;
  GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role;
`;

async function subirPostgres() {
  const diretorio = await fs.mkdtemp(path.join(os.tmpdir(), "canastra-pg-"));
  // Porta alta e derivada do pid: dois arquivos de teste em paralelo nao brigam.
  const porta = 55000 + (process.pid % 5000);

  const pg = new EmbeddedPostgres({
    databaseDir: diretorio,
    user: "postgres",
    password: SENHA,
    port: porta,
    persistent: false,
    // initdb e postgres escrevem dezenas de linhas no stdout. O padrao do pacote
    // e console.log, o que afogaria a saida do `node --test`; so o erro
    // interessa quando algo quebra.
    onLog: () => {},
  });

  await pg.initialise();
  await pg.start();
  await pg.createDatabase("canastra_teste");

  const connectionString = `postgres://postgres:${SENHA}@127.0.0.1:${porta}/canastra_teste`;
  const pool = new Pool({ connectionString });

  await pool.query(PAPEIS);
  await pool.query(AUTH);

  return {
    connectionString,
    pool,
    async derrubar() {
      await pool.end();
      await pg.stop();
      await fs.rm(diretorio, { recursive: true, force: true });
    },
  };
}

module.exports = { subirPostgres };
