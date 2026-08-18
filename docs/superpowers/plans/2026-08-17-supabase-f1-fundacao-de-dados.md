# Supabase F1 — Fundação de Dados: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Criar o schema `canastra` com migrações versionadas, RLS em toda tabela e uma bateria de testes que prova o isolamento contra a instância Supabase compartilhada.

**Architecture:** Migrações numeradas em `backend/db/migrations/`, aplicadas por um runner idempotente que registra versões em `canastra.migracoes`. Toda tabela nasce com RLS ligada. As políticas de dono exigem vínculo em `canastra.clientes` — nunca `auth.uid()` sozinho — porque a instância é compartilhada com outros projetos e um token de outro projeto tem `sub` válido. Os testes rodam contra um Postgres 16 real embutido, com shim de `auth.uid()` e dos papéis do Supabase.

**Tech Stack:** PostgreSQL 16, `pg` 8, `node:test`, `embedded-postgres` 16, Node 22.

**Spec:** `docs/superpowers/specs/2026-08-17-supabase-selfhosted-design.md` §2.2, §3, §4 (trigger do último admin), §10.

---

## Estrutura de arquivos

| Arquivo | Responsabilidade |
|---|---|
| `backend/test/ajuda/postgres.js` | Sobe/derruba um Postgres embutido, cria papéis e o shim de `auth`. Usado por todo teste que toca banco. |
| `backend/test/ajuda/sessao.js` | Executa uma query como `anon`, `authenticated` (com `sub`) ou `service_role`. |
| `backend/db/migrar.js` | Runner: bootstrap de `canastra.migracoes`, aplica pendentes em transação. |
| `backend/db/migrations/0001_schema_e_papeis.sql` | Schema `canastra`, grants aos papéis do Supabase. |
| `backend/db/migrations/0002_clientes_e_admins.sql` | Vínculo com `auth.users`, trigger do último admin. |
| `backend/db/migrations/0003_catalogo.sql` | `produtos`, `produto_opcoes`, view `produtos_publicos`. |
| `backend/db/migrations/0004_enderecos_e_carrinho.sql` | `enderecos`, `carrinhos`, `carrinho_itens`. |
| `backend/db/migrations/0005_pedidos_promocoes_config.sql` | `pedidos`, `promocoes`, `config_loja`. |
| `backend/db/migrations/0006_rls.sql` | Todas as políticas, num arquivo só, para serem lidas juntas. |
| `backend/db/migrations/0007_fundir_sacola.sql` | RPC `canastra.fundir_sacola`. |
| `backend/test/migracoes.test.js` | Runner: idempotência, ordem, transação. |
| `backend/test/rls.test.js` | Caso positivo e negativo de cada política. |
| `backend/test/fundir_sacola.test.js` | Fusão da sacola anônima com a da conta. |

`backend/db/schema.sql` é removido ao final (Task 11), depois que as migrações cobrem tudo que ele criava.

---

### Task 1: Harness de Postgres real para os testes

**Files:**
- Create: `backend/test/ajuda/postgres.js`
- Create: `backend/test/ajuda/sessao.js`
- Modify: `backend/package.json`

- [ ] **Step 1: Instalar a dependência**

```bash
npm --prefix backend install --save-dev embedded-postgres@16.4.0-beta.17
```

Expected: instala `embedded-postgres` e o binário da plataforma (`@embedded-postgres/windows-x64` nesta máquina).

- [ ] **Step 2: Escrever o harness**

Create `backend/test/ajuda/postgres.js`:

```js
"use strict";

/**
 * Postgres de verdade para os testes.
 *
 * RLS nao e simulavel: `pg-mem` e afins nao implementam politica de linha, e uma
 * politica que "passa" num mock e exatamente o tipo de falha que este projeto
 * nao pode ter — o isolamento contra os outros projetos da instancia
 * compartilhada depende dela (spec §2.2). Entao os testes sobem um Postgres 16
 * real, sem Docker.
 *
 * O shim de `auth` existe porque `auth.users` e `auth.uid()` sao do GoTrue e nao
 * existem num Postgres cru. Ele NAO entra em migracao nenhuma: em producao esse
 * schema ja esta la, criado pelo Supabase.
 */

const EmbeddedPostgres = require("embedded-postgres");
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
      current_setting('request.jwt.claims', true)::jsonb ->> 'sub', ''
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
```

- [ ] **Step 3: Escrever o executor de sessão**

Create `backend/test/ajuda/sessao.js`:

```js
"use strict";

/**
 * Roda uma funcao dentro de uma transacao, assumindo um papel do Supabase.
 *
 * `SET LOCAL` so vale dentro de transacao — e por isso que tudo aqui roda entre
 * BEGIN e ROLLBACK. O ROLLBACK no fim e de proposito: cada teste ve o banco
 * limpo sem precisar de TRUNCATE.
 */

async function comoPapel(pool, { papel, sub = null }, funcao) {
  const cliente = await pool.connect();
  try {
    await cliente.query("BEGIN");
    await cliente.query(`SET LOCAL ROLE ${papel}`);
    if (sub) {
      await cliente.query("SELECT set_config('request.jwt.claims', $1, true)", [
        JSON.stringify({ sub, role: papel }),
      ]);
    }
    return await funcao(cliente);
  } finally {
    await cliente.query("ROLLBACK").catch(() => {});
    cliente.release();
  }
}

module.exports = { comoPapel };
```

- [ ] **Step 4: Escrever um teste que prova que o harness funciona**

Create `backend/test/harness.test.js`:

```js
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

test("auth.uid() e nulo sem claim", async () => {
  const linha = await comoPapel(bd.pool, { papel: "anon" }, (c) =>
    c.query("SELECT auth.uid() AS uid"),
  );
  assert.equal(linha.rows[0].uid, null);
});
```

- [ ] **Step 5: Rodar o teste**

Run: `npm --prefix backend test`
Expected: PASS nos 2 testes novos, além dos 15 de pagamento que já existiam. A primeira execução demora (baixa o binário do Postgres).

- [ ] **Step 6: Commit**

```bash
git add backend/test/ajuda backend/test/harness.test.js backend/package.json backend/package-lock.json
git commit -m "test: harness de Postgres real para testar RLS sem Docker"
```

> **Correção após execução (commits `3b23d75`, `3675113`, `945902d`).** O código
> desta tarefa acima está **superado** — leia os arquivos, não este bloco. Quatro
> coisas mudaram, e três afetam as tarefas seguintes:
>
> 1. **`auth.uid()` estava errado aqui.** O `nullif` precisa envolver o
>    `current_setting` **antes** do cast para `jsonb`, não o `sub` extraído. Um
>    GUC customizado volta a **string vazia** (não NULL) quando a transação
>    termina, e como o pool reusa conexões, a segunda transação de cada conexão
>    estourava com `22P02 invalid input syntax for type json`. Isso quebraria
>    toda política de RLS das tarefas 8 e 9.
> 2. **`comoPapel` passou a exigir identidade coerente com o papel:**
>    `authenticated` **exige** `sub`; `anon` **proíbe** `sub`. Motivo: `sub:
>    undefined` (o caso real de escrever `usuario.userId` quando a coluna é
>    `user_id`) rodava anônimo e produzia um `42501` indistinguível de uma
>    negação de RLS — teste negativo verde sem ter provado nada.
> 3. **Erros de setup do harness não podem mais ser confundidos com negação de
>    política.** `sessao.js` lança `ErroDeHarness` (sem `code`) para falhas de
>    `BEGIN`/`SET ROLE`/`set_config`, e exporta `PERMISSAO_NEGADA = "42501"`.
>    **Nas tarefas 8 e 9, prefira `assert.rejects(..., (e) => e.code ===
>    PERMISSAO_NEGADA)` a casar mensagem** — `/permission denied/i` casa também
>    com `permission denied for schema canastra`, que é um `GRANT` faltando na
>    migração 0001, não uma política funcionando.
> 4. `embedded-postgres@16.4.0-beta.17` não existe; a versão instalada é
>    `16.14.0-beta.17`. O pacote é ESM, então o construtor sai em `.default`, e a
>    porta é sondada livre em vez de derivada do pid — Postgres **não morre** com
>    a porta ocupada, sobe só em IPv6 e `start()` resolve com sucesso.

---

### Task 2: Runner de migrações

**Files:**
- Create: `backend/db/migrar.js`
- Create: `backend/test/migracoes.test.js`
- Create: `backend/db/migrations/.gitkeep`

- [ ] **Step 1: Escrever os testes que falham**

Create `backend/test/migracoes.test.js`:

```js
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

before(async () => {
  bd = await subirPostgres();
}, { timeout: 120_000 });

after(async () => {
  await bd.derrubar();
});

beforeEach(async () => {
  pasta = await fs.mkdtemp(path.join(os.tmpdir(), "canastra-mig-"));
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
```

- [ ] **Step 2: Rodar para ver falhar**

Run: `npm --prefix backend test`
Expected: FAIL — `Cannot find module '../db/migrar.js'`

- [ ] **Step 3: Escrever o runner**

Create `backend/db/migrar.js`:

```js
"use strict";

/**
 * Aplicador de migracoes.
 *
 * POR QUE ISTO SUBSTITUI schema.sql
 * `schema.sql` so criava (tudo IF NOT EXISTS) e nunca alterava. A auditoria
 * registrou o efeito (docs/producao.md): a proxima mudanca de coluna seria
 * manual e sem historico. Aqui cada arquivo roda uma vez, em ordem, dentro de
 * uma transacao, e fica registrado.
 *
 * O bootstrap de `canastra.migracoes` vive no codigo, e nao numa migracao, pelo
 * problema obvio do ovo e da galinha: o runner precisa da tabela para saber o
 * que ja rodou.
 */

const fs = require("node:fs/promises");
const path = require("node:path");

const PASTA_PADRAO = path.join(__dirname, "migrations");

const BOOTSTRAP = `
  CREATE SCHEMA IF NOT EXISTS canastra;
  CREATE TABLE IF NOT EXISTS canastra.migracoes (
    versao      text PRIMARY KEY,
    aplicada_em timestamptz NOT NULL DEFAULT now()
  );
`;

/** "0010_segunda.sql" -> 10. Ordem numerica, nao alfabetica. */
function numeroDaVersao(arquivo) {
  const inicio = arquivo.match(/^(\d+)_/);
  if (!inicio) {
    throw new Error(
      `Migracao "${arquivo}" nao comeca com numero. Use NNNN_descricao.sql`,
    );
  }
  return Number(inicio[1]);
}

async function aplicarMigracoes(pool, pasta = PASTA_PADRAO) {
  await pool.query(BOOTSTRAP);

  const arquivos = (await fs.readdir(pasta))
    .filter((a) => a.endsWith(".sql"))
    .sort((a, b) => numeroDaVersao(a) - numeroDaVersao(b));

  const jaAplicadas = new Set(
    (await pool.query("SELECT versao FROM canastra.migracoes")).rows.map(
      (r) => r.versao,
    ),
  );

  const aplicadas = [];

  for (const arquivo of arquivos) {
    const versao = arquivo.replace(/\.sql$/, "");
    if (jaAplicadas.has(versao)) continue;

    const sql = await fs.readFile(path.join(pasta, arquivo), "utf8");
    const cliente = await pool.connect();

    try {
      await cliente.query("BEGIN");
      await cliente.query(sql);
      await cliente.query("INSERT INTO canastra.migracoes (versao) VALUES ($1)", [
        versao,
      ]);
      await cliente.query("COMMIT");
      aplicadas.push(versao);
      console.log(`  ✓ ${versao}`);
    } catch (erro) {
      await cliente.query("ROLLBACK").catch(() => {});
      throw new Error(`Migracao ${versao} falhou: ${erro.message}`, {
        cause: erro,
      });
    } finally {
      cliente.release();
    }
  }

  return aplicadas;
}

module.exports = { aplicarMigracoes, PASTA_PADRAO };

if (require.main === module) {
  const { Pool } = require("pg");
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });

  aplicarMigracoes(pool)
    .then((aplicadas) => {
      console.log(
        aplicadas.length
          ? `${aplicadas.length} migracao(oes) aplicada(s).`
          : "Nada pendente.",
      );
      return pool.end();
    })
    .catch(async (erro) => {
      console.error(`\n❌ ${erro.message}\n`);
      await pool.end();
      process.exit(1);
    });
}
```

- [ ] **Step 4: Rodar para ver passar**

Run: `npm --prefix backend test`
Expected: PASS nos 3 testes de migração.

- [ ] **Step 5: Commit**

```bash
git add backend/db/migrar.js backend/test/migracoes.test.js
git commit -m "feat: runner de migracoes versionadas com registro em canastra.migracoes"
```

---

### Task 3: Migração 0001 — schema e papéis

**Files:**
- Create: `backend/db/migrations/0001_schema_e_papeis.sql`

- [ ] **Step 1: Escrever a migração**

```sql
-- Schema proprio da loja.
--
-- POR QUE NAO `public`
-- Esta instancia Supabase e compartilhada com outros projetos (spec §2.2). Em
-- `public` a loja disputaria nome de tabela com eles e qualquer GRANT amplo
-- vazaria de um lado para o outro. Com schema proprio, a permissao e concedida
-- uma vez, aqui, e nada fora dele e alcancavel por engano.

CREATE SCHEMA IF NOT EXISTS canastra;

-- Sem estes GRANTs o PostgREST responde 404 em toda rota da loja, mesmo com a
-- politica de RLS correta: o papel nao enxerga o schema para comecar.
GRANT USAGE ON SCHEMA canastra TO anon, authenticated, service_role;

-- Padrao para tabelas criadas nas migracoes seguintes. Note que isto concede
-- acesso de TABELA; quem decide o acesso de LINHA e a RLS de 0006. As duas
-- camadas sao necessarias: sem GRANT nao ha leitura nenhuma, sem RLS ha leitura
-- demais.
ALTER DEFAULT PRIVILEGES IN SCHEMA canastra
  GRANT SELECT ON TABLES TO anon;
ALTER DEFAULT PRIVILEGES IN SCHEMA canastra
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA canastra
  GRANT ALL ON TABLES TO service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA canastra
  GRANT USAGE, SELECT ON SEQUENCES TO authenticated, service_role;
```

- [ ] **Step 2: Escrever o teste**

Create `backend/test/schema.test.js`:

```js
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
  await bd.derrubar();
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
```

- [ ] **Step 3: Rodar**

Run: `npm --prefix backend test`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add backend/db/migrations/0001_schema_e_papeis.sql backend/test/schema.test.js
git commit -m "feat: migracao 0001 — schema canastra e permissao dos papeis do Supabase"
```

---

### Task 4: Migração 0002 — clientes e admins

**Files:**
- Create: `backend/db/migrations/0002_clientes_e_admins.sql`
- Create: `backend/test/admins.test.js`

- [ ] **Step 1: Escrever o teste que falha**

Create `backend/test/admins.test.js`:

```js
"use strict";

const { test, before, after, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const { subirPostgres } = require("./ajuda/postgres.js");
const { aplicarMigracoes } = require("../db/migrar.js");

let bd;

const ANA = "aaaaaaaa-0000-0000-0000-000000000001";
const BRUNO = "bbbbbbbb-0000-0000-0000-000000000002";

before(async () => {
  bd = await subirPostgres();
  await aplicarMigracoes(bd.pool);
}, { timeout: 120_000 });

after(async () => {
  await bd.derrubar();
});

beforeEach(async () => {
  await bd.pool.query("DELETE FROM canastra.admins");
  await bd.pool.query("DELETE FROM canastra.clientes");
  await bd.pool.query("DELETE FROM auth.users");
  await bd.pool.query(
    "INSERT INTO auth.users (id, email) VALUES ($1, 'ana@ex.com'), ($2, 'bruno@ex.com')",
    [ANA, BRUNO],
  );
  await bd.pool.query(
    "INSERT INTO canastra.clientes (user_id, nome) VALUES ($1, 'Ana'), ($2, 'Bruno')",
    [ANA, BRUNO],
  );
});

test("apagar o penultimo admin funciona", async () => {
  await bd.pool.query(
    "INSERT INTO canastra.admins (user_id) VALUES ($1), ($2)",
    [ANA, BRUNO],
  );
  await bd.pool.query("DELETE FROM canastra.admins WHERE user_id = $1", [BRUNO]);

  const { rows } = await bd.pool.query("SELECT count(*)::int AS n FROM canastra.admins");
  assert.equal(rows[0].n, 1);
});

test("apagar o ULTIMO admin e recusado pelo banco", async () => {
  await bd.pool.query("INSERT INTO canastra.admins (user_id) VALUES ($1)", [ANA]);

  await assert.rejects(
    () => bd.pool.query("DELETE FROM canastra.admins WHERE user_id = $1", [ANA]),
    /sem administrador/i,
  );
});

test("apagar todos de uma vez tambem e recusado", async () => {
  // O DELETE sem WHERE e o caminho que uma trigger FOR EACH ROW ingenua deixa
  // passar quando a ultima linha e removida junto com as outras.
  await bd.pool.query(
    "INSERT INTO canastra.admins (user_id) VALUES ($1), ($2)",
    [ANA, BRUNO],
  );

  await assert.rejects(
    () => bd.pool.query("DELETE FROM canastra.admins"),
    /sem administrador/i,
  );
});

test("apagar o cliente apaga o vinculo de admin junto", async () => {
  await bd.pool.query(
    "INSERT INTO canastra.admins (user_id) VALUES ($1), ($2)",
    [ANA, BRUNO],
  );
  await bd.pool.query("DELETE FROM canastra.clientes WHERE user_id = $1", [BRUNO]);

  const { rows } = await bd.pool.query(
    "SELECT user_id FROM canastra.admins ORDER BY user_id",
  );
  assert.deepEqual(rows.map((r) => r.user_id), [ANA]);
});
```

- [ ] **Step 2: Rodar para ver falhar**

Run: `npm --prefix backend test`
Expected: FAIL — `relation "canastra.clientes" does not exist`

- [ ] **Step 3: Escrever a migração**

Create `backend/db/migrations/0002_clientes_e_admins.sql`:

```sql
-- Vinculo entre a loja e o GoTrue.
--
-- POR QUE ESTA TABELA EXISTE, E POR QUE ELA E A PECA DE SEGURANCA
-- A instancia Supabase e compartilhada com outros projetos. `auth.users` e
-- unico por instancia, e o JWT_SECRET tambem: um token emitido para OUTRO
-- projeto chega no PostgREST da loja com assinatura valida e `auth.uid()`
-- preenchido.
--
-- Por isso nenhuma politica de RLS pode usar `auth.uid() IS NOT NULL`. Ser
-- cliente da loja e ter LINHA AQUI — e esta linha so e criada no cadastro feito
-- pela loja. Um usuario de outro projeto autentica, mas nao e cliente, e nao
-- enxerga nada (spec §2.2).

CREATE TABLE canastra.clientes (
  user_id    uuid PRIMARY KEY REFERENCES auth.users (id) ON DELETE CASCADE,
  nome       text NOT NULL,
  cpf        text UNIQUE,
  telefone   text,
  criado_em  timestamptz NOT NULL DEFAULT now()
);

-- Papel de administrador NUNCA vem de claim no JWT: outro projeto da instancia
-- poderia emitir um token com o claim que quisesse. Vem de linha nesta tabela,
-- que so `service_role` escreve.
CREATE TABLE canastra.admins (
  user_id   uuid PRIMARY KEY REFERENCES canastra.clientes (user_id) ON DELETE CASCADE,
  criado_em timestamptz NOT NULL DEFAULT now()
);

/**
 * A loja nao pode ficar sem quem a administre.
 *
 * Isto era regra de aplicacao (docs/producao.md §5) e dependia de o painel
 * lembrar de checar. Como trigger, vale para qualquer caminho — painel, psql,
 * PostgREST ou script.
 *
 * AFTER DELETE ... FOR EACH STATEMENT, e nao FOR EACH ROW: um `DELETE FROM
 * canastra.admins` sem WHERE apaga tudo, e a checagem por linha veria sempre
 * "ainda ha outras" ate a ultima, tarde demais numa trigger BEFORE. Depois do
 * comando inteiro, a conta e exata.
 */
CREATE FUNCTION canastra.exigir_um_admin() RETURNS trigger
  LANGUAGE plpgsql
AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM canastra.admins) THEN
    RAISE EXCEPTION 'A loja nao pode ficar sem administrador.';
  END IF;
  RETURN NULL;
END;
$$;

CREATE TRIGGER admins_nunca_zero
  AFTER DELETE ON canastra.admins
  FOR EACH STATEMENT
  EXECUTE FUNCTION canastra.exigir_um_admin();
```

- [ ] **Step 4: Rodar para ver passar**

Run: `npm --prefix backend test`
Expected: PASS nos 4 testes de admins.

Nota sobre o quarto teste: apagar o cliente remove o admin em cascata e a
trigger dispara. Ela passa porque Ana continua admin. Se o teste falhar com
"sem administrador", a cascata está apagando os dois — investigue a ordem do
`ON DELETE CASCADE`, não afrouxe a trigger.

- [ ] **Step 5: Commit**

```bash
git add backend/db/migrations/0002_clientes_e_admins.sql backend/test/admins.test.js
git commit -m "feat: migracao 0002 — clientes, admins e a trava do ultimo administrador"
```

---

### Task 5: Migração 0003 — catálogo

**Files:**
- Create: `backend/db/migrations/0003_catalogo.sql`
- Create: `backend/test/catalogo.test.js`

- [ ] **Step 1: Escrever o teste que falha**

Create `backend/test/catalogo.test.js`:

```js
"use strict";

const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { subirPostgres } = require("./ajuda/postgres.js");
const { aplicarMigracoes } = require("../db/migrar.js");

let bd;
const CAFE = "cccccccc-0000-0000-0000-000000000001";

before(async () => {
  bd = await subirPostgres();
  await aplicarMigracoes(bd.pool);
  await bd.pool.query(
    `INSERT INTO canastra.produtos
       (produto_id, nome, tamanho, categoria, preco, quantidade, descricao, sku, custo)
     VALUES ($1, 'Canastra Classico', '250 g', 'Cafe', 54.90, 10,
             'Torra media, notas de chocolate', 'CAN-CLA-250', 22.50)`,
    [CAFE],
  );
}, { timeout: 120_000 });

after(async () => {
  await bd.derrubar();
});

test("a busca por texto acha o produto pelo termo da descricao", async () => {
  const { rows } = await bd.pool.query(
    `SELECT nome FROM canastra.produtos
     WHERE tsv @@ plainto_tsquery('portuguese', 'chocolate')`,
  );
  assert.deepEqual(rows.map((r) => r.nome), ["Canastra Classico"]);
});

test("sku e unico, mas varios produtos podem ter sku nulo", async () => {
  await bd.pool.query(
    `INSERT INTO canastra.produtos (produto_id, nome) VALUES
       (gen_random_uuid(), 'Sem sku 1'), (gen_random_uuid(), 'Sem sku 2')`,
  );

  await assert.rejects(
    () =>
      bd.pool.query(
        `INSERT INTO canastra.produtos (produto_id, nome, sku)
         VALUES (gen_random_uuid(), 'Duplicado', 'CAN-CLA-250')`,
      ),
    /produtos_sku_idx|duplicate key/i,
  );
});

test("a view publica nao expoe custo", async () => {
  const { rows } = await bd.pool.query(
    `SELECT column_name FROM information_schema.columns
     WHERE table_schema = 'canastra' AND table_name = 'produtos_publicos'`,
  );
  const colunas = rows.map((r) => r.column_name);
  assert.ok(colunas.includes("preco"), "preco deveria estar na view");
  assert.ok(!colunas.includes("custo"), "custo NAO pode estar na view publica");
});
```

- [ ] **Step 2: Rodar para ver falhar**

Run: `npm --prefix backend test`
Expected: FAIL — `relation "canastra.produtos" does not exist`

- [ ] **Step 3: Escrever a migração**

Create `backend/db/migrations/0003_catalogo.sql`:

```sql
-- Catalogo.
--
-- Colunas renomeadas do ingles para o portugues junto com a migracao: o codigo
-- que lia os nomes antigos (dashboardRepository, productContext do painel
-- legado) esta sendo substituido nesta mesma obra, entao o custo de renomear e
-- zero e o ganho e um schema legivel por quem administra a loja.
--
-- `uuid-ossp` NAO e criada: o schema antigo declarava a extensao, mas nenhuma
-- coluna usava `uuid_generate_v4()` — os UUIDs vem do pacote `uuid` em JS.
-- Onde um default e util aqui, `gen_random_uuid()` do proprio Postgres resolve
-- sem extensao nenhuma.

CREATE TABLE canastra.produtos (
  produto_id   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nome         text NOT NULL,
  -- Na loja de camisetas de origem isto era P/M/G. Aqui carrega o formato do
  -- cafe ("250 g", "Caixa 3x250 g"), que e o eixo de variacao real.
  tamanho      text,
  categoria    text,
  preco        numeric(10,2) NOT NULL DEFAULT 0,
  -- Interno: nunca sai na view publica.
  custo        numeric(10,2) NOT NULL DEFAULT 0,
  imagem       text,
  quantidade   integer NOT NULL DEFAULT 0,
  descricao    text,
  peso         numeric(10,3) NOT NULL DEFAULT 0.3,
  largura      numeric(10,2) NOT NULL DEFAULT 20,
  altura       numeric(10,2) NOT NULL DEFAULT 5,
  comprimento  numeric(10,2) NOT NULL DEFAULT 20,
  -- Ordenacao "novidades"/"antigos" do painel. Coluna propria porque o admin
  -- pode querer destacar um produto sem mexer na data de criacao.
  destacado_em timestamptz NOT NULL DEFAULT now(),
  criado_em    timestamptz NOT NULL DEFAULT now(),
  sku          text
);

-- Chave de negocio que costura a vitrine ao banco: a metade EDITORIAL do
-- catalogo vive em data/catalogo-canastra.json (versionada, revisada em PR) e a
-- metade COMERCIAL vive aqui. Sem uma chave comum, casar os dois so daria por
-- nome — que muda com qualquer correcao de texto e quebra a ligacao em silencio.
-- Nulavel: produto cadastrado a mao no painel nao tem SKU do catalogo.
CREATE UNIQUE INDEX produtos_sku_idx ON canastra.produtos (sku)
  WHERE sku IS NOT NULL;

-- Busca do painel. Coluna gerada: nao ha trigger para manter em dia.
ALTER TABLE canastra.produtos
  ADD COLUMN tsv tsvector
  GENERATED ALWAYS AS (
    to_tsvector(
      'portuguese',
      coalesce(nome, '') || ' ' || coalesce(categoria, '') || ' ' ||
      coalesce(tamanho, '') || ' ' || coalesce(descricao, '')
    )
  ) STORED;

CREATE INDEX produtos_tsv_idx ON canastra.produtos USING gin (tsv);
CREATE INDEX produtos_categoria_idx ON canastra.produtos (categoria);
CREATE INDEX produtos_destaque_idx ON canastra.produtos (destacado_em DESC);

-- Valores de filtro do painel: linhas ('tamanho') e categorias ('categoria').
CREATE TABLE canastra.produto_opcoes (
  id    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tipo  text NOT NULL,
  valor text NOT NULL,
  UNIQUE (tipo, valor)
);

/**
 * O recorte que a `anon key` enxerga.
 *
 * A vitrine le o catalogo com a chave anonima, que e publica por definicao —
 * ela viaja no bundle. Dar SELECT na tabela inteira publicaria `custo` junto
 * com o preco. A view define exatamente o que e publico.
 *
 * security_invoker = FALSE, de proposito e ao contrario do reflexo habitual.
 * A view roda com os poderes de quem a criou, ignorando a RLS da tabela base —
 * e aqui isso e a intencao, nao um descuido: o catalogo E publico, e a view e o
 * proprio controle de acesso, definindo por projecao o que sai. Com
 * security_invoker = true, `anon` precisaria de privilegio na tabela base, que
 * a migracao 0006 revoga justamente para esconder `custo`, e toda a vitrine
 * responderia "permission denied".
 *
 * O preco disso: quem alterar esta view esta alterando uma fronteira de
 * seguranca. Nenhuma coluna nova entra aqui sem ser publica de verdade.
 */
CREATE VIEW canastra.produtos_publicos
  WITH (security_invoker = false)
AS
  SELECT produto_id, nome, tamanho, categoria, preco, imagem, quantidade,
         descricao, peso, largura, altura, comprimento, destacado_em, sku
  FROM canastra.produtos;

GRANT SELECT ON canastra.produtos_publicos TO anon, authenticated;
```

- [ ] **Step 4: Rodar para ver passar**

Run: `npm --prefix backend test`
Expected: PASS nos 3 testes de catálogo.

- [ ] **Step 5: Commit**

```bash
git add backend/db/migrations/0003_catalogo.sql backend/test/catalogo.test.js
git commit -m "feat: migracao 0003 — catalogo com view publica que esconde custo"
```

---

### Task 6: Migração 0004 — endereços e carrinho

**Files:**
- Create: `backend/db/migrations/0004_enderecos_e_carrinho.sql`

- [ ] **Step 1: Escrever a migração**

```sql
-- Enderecos e carrinho.

CREATE TABLE canastra.enderecos (
  endereco_id  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid NOT NULL REFERENCES canastra.clientes (user_id) ON DELETE CASCADE,
  cep          text,
  rua          text,
  numero       text,
  complemento  text,
  bairro       text,
  cidade       text,
  estado       text,
  criado_em    timestamptz NOT NULL DEFAULT now(),
  atualizado_em timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX enderecos_cliente_idx ON canastra.enderecos (user_id);

-- Um carrinho por cliente. O UNIQUE e o que permite `ON CONFLICT (user_id)` na
-- RPC de fusao (migracao 0007) sem precisar ler antes de escrever.
CREATE TABLE canastra.carrinhos (
  carrinho_id   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid NOT NULL UNIQUE REFERENCES canastra.clientes (user_id) ON DELETE CASCADE,
  criado_em     timestamptz NOT NULL DEFAULT now(),
  atualizado_em timestamptz NOT NULL DEFAULT now()
);

-- Sem FK para produtos, de proposito: `nome`, `preco` e `imagem` sao copias do
-- momento em que o item entrou na sacola. Um produto retirado do catalogo nao
-- pode fazer o carrinho de ninguem desaparecer nem quebrar a listagem.
--
-- O preco guardado aqui e para EXIBIR. Quem cobra e o checkout, que rele preco e
-- estoque do banco antes de gerar o pagamento.
CREATE TABLE canastra.carrinho_itens (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  carrinho_id uuid NOT NULL REFERENCES canastra.carrinhos (carrinho_id) ON DELETE CASCADE,
  produto_id  uuid NOT NULL,
  quantidade  integer NOT NULL DEFAULT 1 CHECK (quantidade > 0),
  preco       numeric(10,2) NOT NULL DEFAULT 0,
  nome        text,
  imagem      text,
  tamanho     text,
  moagem      text,
  UNIQUE (carrinho_id, produto_id, moagem)
);
CREATE INDEX carrinho_itens_carrinho_idx ON canastra.carrinho_itens (carrinho_id);
```

- [ ] **Step 2: Rodar a suíte inteira**

Run: `npm --prefix backend test`
Expected: PASS — as migrações aplicam sem erro nos testes que já existem.

- [ ] **Step 3: Commit**

```bash
git add backend/db/migrations/0004_enderecos_e_carrinho.sql
git commit -m "feat: migracao 0004 — enderecos e carrinho"
```

---

### Task 7: Migração 0005 — pedidos, promoções e config

**Files:**
- Create: `backend/db/migrations/0005_pedidos_promocoes_config.sql`
- Create: `backend/test/pedidos.test.js`

- [ ] **Step 1: Escrever o teste que falha**

Create `backend/test/pedidos.test.js`:

```js
"use strict";

const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { subirPostgres } = require("./ajuda/postgres.js");
const { aplicarMigracoes } = require("../db/migrar.js");

let bd;
const ANA = "aaaaaaaa-0000-0000-0000-000000000001";

before(async () => {
  bd = await subirPostgres();
  await aplicarMigracoes(bd.pool);
  await bd.pool.query("INSERT INTO auth.users (id, email) VALUES ($1, 'ana@ex.com')", [ANA]);
  await bd.pool.query("INSERT INTO canastra.clientes (user_id, nome) VALUES ($1, 'Ana')", [ANA]);
}, { timeout: 120_000 });

after(async () => {
  await bd.derrubar();
});

test("o mesmo pagamento do MP nao pode gerar dois pedidos", async () => {
  // O Mercado Paggo reenvia webhook por desenho. A auditoria registrou que
  // reentrega repetida podia inflar o estoque. O indice unico e a defesa: ela
  // vale mesmo se o codigo do webhook esquecer de checar.
  await bd.pool.query(
    `INSERT INTO canastra.pedidos (pedido_id, user_id, total, pagamento_id_mp)
     VALUES (gen_random_uuid(), $1, 54.90, 'MP-123')`,
    [ANA],
  );

  await assert.rejects(
    () =>
      bd.pool.query(
        `INSERT INTO canastra.pedidos (pedido_id, user_id, total, pagamento_id_mp)
         VALUES (gen_random_uuid(), $1, 54.90, 'MP-123')`,
        [ANA],
      ),
    /pedidos_pagamento_mp_idx|duplicate key/i,
  );
});

test("varios pedidos podem estar sem pagamento_id_mp", async () => {
  // Pedido criado ANTES de cobrar (correcao da auditoria): nesse instante ainda
  // nao ha id do MP. Se o indice unico nao fosse parcial, o segundo pedido
  // pendente da loja inteira falharia.
  await bd.pool.query(
    `INSERT INTO canastra.pedidos (pedido_id, user_id, total) VALUES
       (gen_random_uuid(), $1, 10), (gen_random_uuid(), $1, 20)`,
    [ANA],
  );

  const { rows } = await bd.pool.query(
    "SELECT count(*)::int AS n FROM canastra.pedidos WHERE pagamento_id_mp IS NULL",
  );
  assert.equal(rows[0].n, 2);
});

test("a chave de idempotencia do checkout e unica", async () => {
  await bd.pool.query(
    `INSERT INTO canastra.pedidos (pedido_id, user_id, total, chave_idempotencia)
     VALUES (gen_random_uuid(), $1, 10, 'req-abc')`,
    [ANA],
  );

  await assert.rejects(
    () =>
      bd.pool.query(
        `INSERT INTO canastra.pedidos (pedido_id, user_id, total, chave_idempotencia)
         VALUES (gen_random_uuid(), $1, 10, 'req-abc')`,
        [ANA],
      ),
    /pedidos_idempotencia_idx|duplicate key/i,
  );
});

test("config_loja aceita no maximo uma linha", async () => {
  await bd.pool.query("INSERT INTO canastra.config_loja (id) VALUES (1)");
  await assert.rejects(
    () => bd.pool.query("INSERT INTO canastra.config_loja (id) VALUES (2)"),
    /config_loja_linha_unica|violates check/i,
  );
});
```

- [ ] **Step 2: Rodar para ver falhar**

Run: `npm --prefix backend test`
Expected: FAIL — `relation "canastra.pedidos" does not exist`

- [ ] **Step 3: Escrever a migração**

Create `backend/db/migrations/0005_pedidos_promocoes_config.sql`:

```sql
-- Pedidos, promocoes e configuracao da loja.

CREATE TABLE canastra.pedidos (
  pedido_id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id            uuid REFERENCES canastra.clientes (user_id) ON DELETE SET NULL,
  total              numeric(10,2) NOT NULL DEFAULT 0,
  status             text NOT NULL DEFAULT 'pendente',
  metodo_pagamento   text,
  pagamento_id_mp    text,
  -- Enviada pelo navegador no checkout. Duas tentativas do mesmo clique tem a
  -- mesma chave, entao a segunda esbarra no indice em vez de criar outro pedido.
  chave_idempotencia text,
  itens              jsonb,
  endereco_json      jsonb,
  frete              numeric(10,2) NOT NULL DEFAULT 0,
  metodo_envio       text,
  codigo_rastreio    text,
  criado_em          timestamptz NOT NULL DEFAULT now(),
  atualizado_em      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX pedidos_cliente_idx ON canastra.pedidos (user_id);
CREATE INDEX pedidos_criado_idx  ON canastra.pedidos (criado_em DESC);

/**
 * As duas defesas de idempotencia, no banco e nao no codigo.
 *
 * A auditoria registrou dois furos (docs/producao.md §4.2): o webhook do MP nao
 * era idempotente, e o MP reenvia notificacao por desenho — reentrega podia
 * inflar estoque; e a cobranca acontecia antes de o pedido existir, sem chave,
 * entao uma queda no meio deixava pagamento sem pedido.
 *
 * Indices PARCIAIS (WHERE ... IS NOT NULL) porque o pedido nasce sem id do MP e
 * pedido antigo pode nao ter chave. Um indice total recusaria o segundo pedido
 * pendente da loja inteira.
 */
CREATE UNIQUE INDEX pedidos_pagamento_mp_idx
  ON canastra.pedidos (pagamento_id_mp)
  WHERE pagamento_id_mp IS NOT NULL;

CREATE UNIQUE INDEX pedidos_idempotencia_idx
  ON canastra.pedidos (chave_idempotencia)
  WHERE chave_idempotencia IS NOT NULL;

CREATE TABLE canastra.promocoes (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  titulo      text NOT NULL,
  descricao   text,
  tipo        text,
  valor       numeric(10,2),
  aplica_a    text,
  categoria   text,
  produto_id  uuid,
  inicio_em   timestamptz,
  fim_em      timestamptz,
  ativa       boolean NOT NULL DEFAULT true,
  criada_em   timestamptz NOT NULL DEFAULT now()
);

-- Tabela de uma linha so. O codigo antigo garantia isso por convencao
-- (`WHERE id = (SELECT id FROM store_config LIMIT 1)`); aqui o CHECK garante.
CREATE TABLE canastra.config_loja (
  id                integer PRIMARY KEY DEFAULT 1
                      CONSTRAINT config_loja_linha_unica CHECK (id = 1),
  banner_desktop    text,
  banner_mobile     text,
  titulo_site       text,
  whatsapp          text,
  barra_de_aviso    text,
  atualizado_em     timestamptz NOT NULL DEFAULT now()
);
```

- [ ] **Step 4: Rodar para ver passar**

Run: `npm --prefix backend test`
Expected: PASS nos 4 testes de pedidos.

- [ ] **Step 5: Commit**

```bash
git add backend/db/migrations/0005_pedidos_promocoes_config.sql backend/test/pedidos.test.js
git commit -m "feat: migracao 0005 — pedidos com idempotencia garantida por indice"
```

---

### Task 8: Migração 0006 — RLS

Esta é a tarefa central da fase. Os testes negativos importam mais que os positivos.

> **Herdado da execução da Task 4 — decidir antes de escrever as políticas.**
>
> 1. **`canastra.exigir_um_admin()` é `SECURITY INVOKER` e consulta
>    `canastra.admins`**, que esta tarefa vai colocar sob RLS. Se a política de
>    `admins` esconder linhas do papel que está apagando, `NOT EXISTS` fica
>    verdadeiro com admins existindo, e o guard recusaria uma remoção legítima.
>    Duas saídas: manter `admins` gravável só por `service_role` (que tem
>    `BYPASSRLS`), ou tornar a função `SECURITY DEFINER` com `search_path` fixo —
>    igual ao que `eh_cliente()` e `eh_admin()` já fazem nesta migração.
> 2. **`TRUNCATE` ignora o trigger por completo**, e o `GRANT ALL ON TABLES TO
>    service_role` da migração 0001 inclui `TRUNCATE`. Aceito: `service_role` é
>    credencial de servidor, confiável por definição. Mas a docstring do trigger
>    não pode alegar valer "por qualquer caminho".
> 3. **`ALTER DEFAULT PRIVILEGES` da 0001 só alcança tabelas criadas pelo mesmo
>    papel que rodou o `ALTER`.** Tabela criada pelo Studio do Supabase ou por um
>    psql com outro login nasce sem `GRANT` nenhum para `anon`/`authenticated` —
>    e o sintoma é PostgREST devolvendo 404 com a política de RLS perfeitamente
>    correta. Toda tabela desta fase precisa nascer pelo runner de migrações.
> 4. **O `anon` saiu do `ALTER DEFAULT PRIVILEGES` da 0001.** O desenho original
>    dava `SELECT` a `anon` em toda tabela nova e mandava esta tarefa desfazer
>    caso a caso — começando por `REVOKE SELECT ON canastra.produtos FROM anon`.
>    Escada de conceder-e-revogar **falha aberta**: um `REVOKE` esquecido em
>    `pedidos`, `enderecos` ou `carrinhos` é vazamento silencioso de dado
>    pessoal. Agora nada é legível por `anon` por padrão, e cada migração concede
>    explicitamente o que é público de verdade. **Consequência para esta tarefa:
>    o `REVOKE SELECT ON canastra.produtos FROM anon` deixa de ser necessário —
>    confira se ainda faz sentido antes de copiá-lo.**
> 5. **A 0002 já liga `ENABLE ROW LEVEL SECURITY` em `clientes` e `admins`.**
>    Sem isso, `nome`, `cpf` e `telefone` ficavam legíveis por `anon` via
>    PostgREST desde o commit da 0002 até esta migração — e um deploy que
>    aplicasse a 0002 e falhasse aqui deixaria dado pessoal exposto. O `ENABLE`
>    desta tarefa é idempotente em cima disso; mantenha-o.
> 6. **Trocar o desenho da view do catálogo — medido e recomendado.** A 0003 usa
>    `security_invoker = false`, que faz a leitura pública depender da isenção de
>    RLS do dono da view. Isso funciona, mas duas coisas ruins vêm junto: ligar
>    `FORCE ROW LEVEL SECURITY` em `canastra.produtos` esvazia a vitrine **em
>    silêncio**, e a escrita só é barrada por um `REVOKE` que nenhuma regra
>    estrutural regenera — view nova em `canastra` nasce gravável de novo. O
>    desenho alternativo foi medido e é melhor em todos os eixos:
>
>    ```sql
>    ALTER VIEW canastra.produtos_publicos SET (security_invoker = true);
>    GRANT SELECT (produto_id, nome, tamanho, categoria, preco, imagem,
>                  quantidade, descricao, peso, largura, altura, comprimento,
>                  destacado_em, sku)
>      ON canastra.produtos TO anon, authenticated;
>    CREATE POLICY catalogo_publico ON canastra.produtos FOR SELECT USING (true);
>    ```
>
>    `custo` continua inalcançável (42501), a escalação morre na raiz em vez de
>    depender de um `REVOKE`, e o modo de esvaziamento silencioso deixa de
>    existir. Custo aceito conscientemente: `canastra.produtos` passa a ser um
>    endpoint visível no PostgREST que responde 42501 a um `select=*` cru —
>    barulhento, nunca vazante. **Mantenha o `REVOKE` mesmo assim.**
> 7. **Três tabelas públicas ainda devolvem zero linha para `anon`** —
>    `produto_opcoes`, `promocoes` e `config_loja` têm o `GRANT` mas nenhuma
>    política. É de propósito (falha fechada), mas é uma lacuna viva: sem
>    `FOR SELECT TO anon USING (true)` a vitrine perde filtros, promoções e
>    banner. `produtos` **não** está nessa lista — é lido pela view.
> 8. **Pedido órfão (`user_id IS NULL`) é invisível a qualquer política de
>    dono.** `ON DELETE SET NULL` preserva a venda quando o cliente é apagado, e
>    `USING (user_id = auth.uid())` avalia NULL, não TRUE. Correto para o
>    cliente; o painel precisa de um caminho próprio para listar histórico.
> 9. **Toda política de escrita precisa ser escrita como `FOR SELECT` ou com
>    escopo em `canastra.admins`, nunca `FOR ALL USING (true)`.** Foi medido: a
>    forma natural apaga linha do catálogo com token de outro projeto.

**Files:**
- Create: `backend/db/migrations/0006_rls.sql`
- Create: `backend/test/rls.test.js`

- [ ] **Step 1: Escrever os testes que falham**

Create `backend/test/rls.test.js`:

```js
"use strict";

const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { subirPostgres } = require("./ajuda/postgres.js");
const { comoPapel } = require("./ajuda/sessao.js");
const { aplicarMigracoes } = require("../db/migrar.js");

let bd;

const ANA = "aaaaaaaa-0000-0000-0000-000000000001";   // cliente da loja
const BRUNO = "bbbbbbbb-0000-0000-0000-000000000002"; // cliente da loja
const DORA = "dddddddd-0000-0000-0000-000000000004";  // admin da loja
const ESTRANHA = "eeeeeeee-0000-0000-0000-000000000005"; // OUTRO projeto

before(async () => {
  bd = await subirPostgres();
  await aplicarMigracoes(bd.pool);

  await bd.pool.query(
    `INSERT INTO auth.users (id, email) VALUES
       ($1,'ana@ex.com'), ($2,'bruno@ex.com'), ($3,'dora@ex.com'), ($4,'estranha@outro.com')`,
    [ANA, BRUNO, DORA, ESTRANHA],
  );

  // ESTRANHA existe em auth.users — e usuaria de OUTRO projeto da instancia —
  // mas NAO entra em canastra.clientes. E esse o cenario que o teste negativo
  // cobre.
  await bd.pool.query(
    `INSERT INTO canastra.clientes (user_id, nome) VALUES
       ($1,'Ana'), ($2,'Bruno'), ($3,'Dora')`,
    [ANA, BRUNO, DORA],
  );
  await bd.pool.query("INSERT INTO canastra.admins (user_id) VALUES ($1)", [DORA]);

  await bd.pool.query(
    `INSERT INTO canastra.produtos (produto_id, nome, preco, custo, sku)
     VALUES ('cccccccc-0000-0000-0000-000000000001','Classico',54.90,22.50,'CAN-CLA-250')`,
  );
  await bd.pool.query(
    `INSERT INTO canastra.enderecos (endereco_id, user_id, cidade) VALUES
       ('11111111-1111-1111-1111-111111111111', $1, 'Belo Horizonte'),
       ('22222222-2222-2222-2222-222222222222', $2, 'Sao Roque de Minas')`,
    [ANA, BRUNO],
  );
  await bd.pool.query(
    `INSERT INTO canastra.pedidos (pedido_id, user_id, total) VALUES
       ('33333333-3333-3333-3333-333333333333', $1, 54.90)`,
    [ANA],
  );
}, { timeout: 120_000 });

after(async () => {
  await bd.derrubar();
});

// ── A trava que sustenta o isolamento (spec §2.2) ────────────────────────────

test("NEGATIVO: usuario de outro projeto da instancia nao ve endereco nenhum", async () => {
  const { rows } = await comoPapel(
    bd.pool,
    { papel: "authenticated", sub: ESTRANHA },
    (c) => c.query("SELECT * FROM canastra.enderecos"),
  );
  assert.deepEqual(rows, [], "token valido de outro projeto NAO pode ler a loja");
});

test("NEGATIVO: usuario de outro projeto nao ve pedido nenhum", async () => {
  const { rows } = await comoPapel(
    bd.pool,
    { papel: "authenticated", sub: ESTRANHA },
    (c) => c.query("SELECT * FROM canastra.pedidos"),
  );
  assert.deepEqual(rows, []);
});

test("NEGATIVO: usuario de outro projeto nao consegue virar cliente sozinho", async () => {
  await assert.rejects(
    () =>
      comoPapel(bd.pool, { papel: "authenticated", sub: ESTRANHA }, (c) =>
        c.query("INSERT INTO canastra.clientes (user_id, nome) VALUES ($1,'Invasora')", [
          ESTRANHA,
        ]),
      ),
    /row-level security|permission denied/i,
  );
});

// ── Isolamento entre clientes da propria loja ────────────────────────────────

test("NEGATIVO: Ana nao ve o endereco de Bruno", async () => {
  const { rows } = await comoPapel(bd.pool, { papel: "authenticated", sub: ANA }, (c) =>
    c.query("SELECT cidade FROM canastra.enderecos"),
  );
  assert.deepEqual(rows.map((r) => r.cidade), ["Belo Horizonte"]);
});

test("POSITIVO: Ana ve o proprio pedido", async () => {
  const { rows } = await comoPapel(bd.pool, { papel: "authenticated", sub: ANA }, (c) =>
    c.query("SELECT total FROM canastra.pedidos"),
  );
  assert.equal(rows.length, 1);
});

test("NEGATIVO: Bruno nao ve o pedido de Ana", async () => {
  const { rows } = await comoPapel(bd.pool, { papel: "authenticated", sub: BRUNO }, (c) =>
    c.query("SELECT total FROM canastra.pedidos"),
  );
  assert.deepEqual(rows, []);
});

// ── Catalogo publico ─────────────────────────────────────────────────────────

test("POSITIVO: visitante anonimo le o catalogo pela view", async () => {
  const { rows } = await comoPapel(bd.pool, { papel: "anon" }, (c) =>
    c.query("SELECT nome, preco FROM canastra.produtos_publicos"),
  );
  assert.equal(rows.length, 1);
  assert.equal(rows[0].nome, "Classico");
});

test("NEGATIVO: visitante anonimo nao alcanca a tabela de produtos, so a view", async () => {
  await assert.rejects(
    () =>
      comoPapel(bd.pool, { papel: "anon" }, (c) =>
        c.query("SELECT custo FROM canastra.produtos"),
      ),
    /permission denied/i,
  );
});

test("NEGATIVO: cliente comum nao cadastra produto", async () => {
  await assert.rejects(
    () =>
      comoPapel(bd.pool, { papel: "authenticated", sub: ANA }, (c) =>
        c.query("INSERT INTO canastra.produtos (nome) VALUES ('Pirata')"),
      ),
    /row-level security|permission denied/i,
  );
});

// ── Admin ────────────────────────────────────────────────────────────────────

test("POSITIVO: admin cadastra produto", async () => {
  const { rowCount } = await comoPapel(
    bd.pool,
    { papel: "authenticated", sub: DORA },
    (c) => c.query("INSERT INTO canastra.produtos (nome, preco) VALUES ('Novo', 10)"),
  );
  assert.equal(rowCount, 1);
});

test("POSITIVO: admin ve todos os pedidos", async () => {
  const { rows } = await comoPapel(bd.pool, { papel: "authenticated", sub: DORA }, (c) =>
    c.query("SELECT pedido_id FROM canastra.pedidos"),
  );
  assert.equal(rows.length, 1);
});

test("NEGATIVO: admin nao cria pedido pelo PostgREST", async () => {
  // Criar pedido e baixar estoque e do servico Node, dentro de transacao. Se o
  // painel pudesse inserir por aqui, o furo de idempotencia que esta obra fecha
  // voltaria por outra porta (spec §3.2).
  await assert.rejects(
    () =>
      comoPapel(bd.pool, { papel: "authenticated", sub: DORA }, (c) =>
        c.query("INSERT INTO canastra.pedidos (total) VALUES (99)"),
      ),
    /row-level security|permission denied/i,
  );
});

test("POSITIVO: admin muda o status de um pedido", async () => {
  const { rowCount } = await comoPapel(
    bd.pool,
    { papel: "authenticated", sub: DORA },
    (c) =>
      c.query(
        "UPDATE canastra.pedidos SET status = 'pago' WHERE pedido_id = '33333333-3333-3333-3333-333333333333'",
      ),
  );
  assert.equal(rowCount, 1);
});
```

- [ ] **Step 2: Rodar para ver falhar**

Run: `npm --prefix backend test`
Expected: FAIL — sem RLS, os testes NEGATIVOS falham (leem dado que não deveriam).

- [ ] **Step 3: Escrever a migração**

Create `backend/db/migrations/0006_rls.sql`:

```sql
-- Row Level Security de toda a loja, num arquivo so para serem lidas juntas.
--
-- A REGRA QUE NAO PODE SER QUEBRADA
-- Nenhuma politica usa `auth.uid() IS NOT NULL`. A instancia Supabase e
-- compartilhada com outros projetos: `auth.users` e o JWT_SECRET sao unicos por
-- instancia, entao um token emitido para outro projeto chega aqui com
-- assinatura valida e `auth.uid()` preenchido (spec §2.2).
--
-- Ser cliente da loja e TER LINHA em canastra.clientes. Toda politica de dono
-- passa por `canastra.eh_cliente()`. Quem revisar este arquivo: um `USING
-- (auth.uid() = user_id)` sem a checagem de cliente parece equivalente e nao e —
-- ele confere apenas que a pessoa e dona da linha, e o caminho de virar dono de
-- uma linha e justamente o que a checagem fecha.

-- Funcoes de apoio. STABLE e SECURITY DEFINER: precisam ler `clientes` e
-- `admins` mesmo quando o chamador nao tem permissao de leitura nelas, senao a
-- politica se auto-referencia e recursa.
CREATE FUNCTION canastra.eh_cliente() RETURNS boolean
  LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path = canastra, pg_temp
AS $$
  SELECT EXISTS (SELECT 1 FROM canastra.clientes WHERE user_id = auth.uid())
$$;

CREATE FUNCTION canastra.eh_admin() RETURNS boolean
  LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path = canastra, pg_temp
AS $$
  SELECT EXISTS (SELECT 1 FROM canastra.admins WHERE user_id = auth.uid())
$$;

GRANT EXECUTE ON FUNCTION canastra.eh_cliente() TO anon, authenticated;
GRANT EXECUTE ON FUNCTION canastra.eh_admin()   TO anon, authenticated;

ALTER TABLE canastra.clientes        ENABLE ROW LEVEL SECURITY;
ALTER TABLE canastra.admins          ENABLE ROW LEVEL SECURITY;
ALTER TABLE canastra.produtos        ENABLE ROW LEVEL SECURITY;
ALTER TABLE canastra.produto_opcoes  ENABLE ROW LEVEL SECURITY;
ALTER TABLE canastra.enderecos       ENABLE ROW LEVEL SECURITY;
ALTER TABLE canastra.carrinhos       ENABLE ROW LEVEL SECURITY;
ALTER TABLE canastra.carrinho_itens  ENABLE ROW LEVEL SECURITY;
ALTER TABLE canastra.pedidos         ENABLE ROW LEVEL SECURITY;
ALTER TABLE canastra.promocoes       ENABLE ROW LEVEL SECURITY;
ALTER TABLE canastra.config_loja     ENABLE ROW LEVEL SECURITY;

-- ── clientes ────────────────────────────────────────────────────────────────
-- Sem politica de INSERT: virar cliente da loja acontece no cadastro, via
-- `service_role` (que ignora RLS). Se `authenticated` pudesse inserir, qualquer
-- usuario de outro projeto se cadastraria sozinho e a trava inteira cairia.
CREATE POLICY clientes_le_o_proprio ON canastra.clientes
  FOR SELECT TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY clientes_edita_o_proprio ON canastra.clientes
  FOR UPDATE TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

CREATE POLICY clientes_admin_le_todos ON canastra.clientes
  FOR SELECT TO authenticated
  USING (canastra.eh_admin());

-- ── admins ──────────────────────────────────────────────────────────────────
-- So leitura, e so para admin. Escrever aqui e privilegio de `service_role`.
CREATE POLICY admins_admin_le ON canastra.admins
  FOR SELECT TO authenticated
  USING (canastra.eh_admin());

-- ── produtos e opcoes ───────────────────────────────────────────────────────
-- `anon` NAO ganha politica aqui: ele le pela view produtos_publicos, que nao
-- expoe `custo`. O GRANT de 0001 dava SELECT a anon; revogamos, porque a view e
-- a unica porta publica.
REVOKE SELECT ON canastra.produtos FROM anon;

CREATE POLICY produtos_cliente_le ON canastra.produtos
  FOR SELECT TO authenticated
  USING (true);

CREATE POLICY produtos_admin_escreve ON canastra.produtos
  FOR ALL TO authenticated
  USING (canastra.eh_admin())
  WITH CHECK (canastra.eh_admin());

CREATE POLICY opcoes_todos_leem ON canastra.produto_opcoes
  FOR SELECT TO anon, authenticated
  USING (true);

CREATE POLICY opcoes_admin_escreve ON canastra.produto_opcoes
  FOR ALL TO authenticated
  USING (canastra.eh_admin())
  WITH CHECK (canastra.eh_admin());

-- ── enderecos ───────────────────────────────────────────────────────────────
CREATE POLICY enderecos_do_dono ON canastra.enderecos
  FOR ALL TO authenticated
  USING (canastra.eh_cliente() AND user_id = auth.uid())
  WITH CHECK (canastra.eh_cliente() AND user_id = auth.uid());

-- ── carrinho ────────────────────────────────────────────────────────────────
CREATE POLICY carrinhos_do_dono ON canastra.carrinhos
  FOR ALL TO authenticated
  USING (canastra.eh_cliente() AND user_id = auth.uid())
  WITH CHECK (canastra.eh_cliente() AND user_id = auth.uid());

CREATE POLICY carrinho_itens_do_dono ON canastra.carrinho_itens
  FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM canastra.carrinhos c
      WHERE c.carrinho_id = carrinho_itens.carrinho_id
        AND c.user_id = auth.uid()
    )
    AND canastra.eh_cliente()
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM canastra.carrinhos c
      WHERE c.carrinho_id = carrinho_itens.carrinho_id
        AND c.user_id = auth.uid()
    )
    AND canastra.eh_cliente()
  );

-- ── pedidos ─────────────────────────────────────────────────────────────────
-- Sem politica de INSERT para ninguem: criar pedido e baixar estoque acontece
-- no servico Node, dentro de transacao e com chave de idempotencia. Deixar o
-- painel inserir por PostgREST reabriria o furo que esta obra fecha.
CREATE POLICY pedidos_dono_le ON canastra.pedidos
  FOR SELECT TO authenticated
  USING (canastra.eh_cliente() AND user_id = auth.uid());

CREATE POLICY pedidos_admin_le ON canastra.pedidos
  FOR SELECT TO authenticated
  USING (canastra.eh_admin());

-- O admin muda status e rastreio; nao mexe em total nem em itens. A restricao
-- de COLUNA vem do GRANT abaixo, porque politica de RLS nao distingue coluna.
CREATE POLICY pedidos_admin_atualiza ON canastra.pedidos
  FOR UPDATE TO authenticated
  USING (canastra.eh_admin())
  WITH CHECK (canastra.eh_admin());

REVOKE UPDATE ON canastra.pedidos FROM authenticated;
GRANT UPDATE (status, codigo_rastreio, metodo_envio, atualizado_em)
  ON canastra.pedidos TO authenticated;

REVOKE INSERT, DELETE ON canastra.pedidos FROM authenticated;

-- ── promocoes e config ──────────────────────────────────────────────────────
CREATE POLICY promocoes_todos_leem ON canastra.promocoes
  FOR SELECT TO anon, authenticated
  USING (true);

CREATE POLICY promocoes_admin_escreve ON canastra.promocoes
  FOR ALL TO authenticated
  USING (canastra.eh_admin())
  WITH CHECK (canastra.eh_admin());

CREATE POLICY config_todos_leem ON canastra.config_loja
  FOR SELECT TO anon, authenticated
  USING (true);

CREATE POLICY config_admin_escreve ON canastra.config_loja
  FOR ALL TO authenticated
  USING (canastra.eh_admin())
  WITH CHECK (canastra.eh_admin());
```

- [ ] **Step 4: Rodar para ver passar**

Run: `npm --prefix backend test`
Expected: PASS nos 13 testes de RLS.

Se algum teste NEGATIVO ainda passar dado adiante, **não relaxe o teste**: é a
política que está errada. O teste `usuario de outro projeto da instancia nao ve
endereco nenhum` é o que separa esta loja dos outros projetos da instância.

- [ ] **Step 5: Commit**

```bash
git add backend/db/migrations/0006_rls.sql backend/test/rls.test.js
git commit -m "feat: migracao 0006 — RLS com trava de cliente contra a instancia compartilhada"
```

---

### Task 9: Migração 0007 — RPC de fusão da sacola

**Files:**
- Create: `backend/db/migrations/0007_fundir_sacola.sql`
- Create: `backend/test/fundir_sacola.test.js`

- [ ] **Step 1: Escrever o teste que falha**

Create `backend/test/fundir_sacola.test.js`:

```js
"use strict";

const { test, before, after, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const { subirPostgres } = require("./ajuda/postgres.js");
const { comoPapel } = require("./ajuda/sessao.js");
const { aplicarMigracoes } = require("../db/migrar.js");

let bd;
const ANA = "aaaaaaaa-0000-0000-0000-000000000001";
const ESTRANHA = "eeeeeeee-0000-0000-0000-000000000005";
const CAFE = "cccccccc-0000-0000-0000-000000000001";
const CHA = "cccccccc-0000-0000-0000-000000000002";

before(async () => {
  bd = await subirPostgres();
  await aplicarMigracoes(bd.pool);
  await bd.pool.query(
    "INSERT INTO auth.users (id, email) VALUES ($1,'ana@ex.com'), ($2,'e@outro.com')",
    [ANA, ESTRANHA],
  );
  await bd.pool.query("INSERT INTO canastra.clientes (user_id, nome) VALUES ($1,'Ana')", [ANA]);
}, { timeout: 120_000 });

after(async () => {
  await bd.derrubar();
});

beforeEach(async () => {
  await bd.pool.query("DELETE FROM canastra.carrinhos");
});

const itens = (lista) => JSON.stringify(lista);

test("cria o carrinho na primeira fusao", async () => {
  await comoPapel(bd.pool, { papel: "authenticated", sub: ANA }, async (c) => {
    await c.query("SELECT canastra.fundir_sacola($1::jsonb)", [
      itens([{ produto_id: CAFE, quantidade: 2, preco: 54.9, nome: "Classico" }]),
    ]);
    const { rows } = await c.query(
      "SELECT produto_id, quantidade FROM canastra.carrinho_itens",
    );
    assert.deepEqual(rows, [{ produto_id: CAFE, quantidade: 2 }]);
  });
});

test("soma a quantidade quando o item ja esta na conta", async () => {
  await comoPapel(bd.pool, { papel: "authenticated", sub: ANA }, async (c) => {
    await c.query("SELECT canastra.fundir_sacola($1::jsonb)", [
      itens([{ produto_id: CAFE, quantidade: 1, preco: 54.9, nome: "Classico" }]),
    ]);
    await c.query("SELECT canastra.fundir_sacola($1::jsonb)", [
      itens([{ produto_id: CAFE, quantidade: 3, preco: 54.9, nome: "Classico" }]),
    ]);
    const { rows } = await c.query(
      "SELECT quantidade FROM canastra.carrinho_itens WHERE produto_id = $1",
      [CAFE],
    );
    assert.deepEqual(rows, [{ quantidade: 4 }]);
  });
});

test("mantem os itens que ja estavam na conta e nao vieram na sacola", async () => {
  await comoPapel(bd.pool, { papel: "authenticated", sub: ANA }, async (c) => {
    await c.query("SELECT canastra.fundir_sacola($1::jsonb)", [
      itens([{ produto_id: CHA, quantidade: 1, preco: 20, nome: "Cha" }]),
    ]);
    await c.query("SELECT canastra.fundir_sacola($1::jsonb)", [
      itens([{ produto_id: CAFE, quantidade: 1, preco: 54.9, nome: "Classico" }]),
    ]);
    const { rows } = await c.query(
      "SELECT count(*)::int AS n FROM canastra.carrinho_itens",
    );
    assert.equal(rows[0].n, 2);
  });
});

test("moagens diferentes do mesmo produto sao itens distintos", async () => {
  await comoPapel(bd.pool, { papel: "authenticated", sub: ANA }, async (c) => {
    await c.query("SELECT canastra.fundir_sacola($1::jsonb)", [
      itens([
        { produto_id: CAFE, quantidade: 1, preco: 54.9, nome: "Classico", moagem: "fina" },
        { produto_id: CAFE, quantidade: 1, preco: 54.9, nome: "Classico", moagem: "grossa" },
      ]),
    ]);
    const { rows } = await c.query(
      "SELECT count(*)::int AS n FROM canastra.carrinho_itens",
    );
    assert.equal(rows[0].n, 2);
  });
});

test("NEGATIVO: quem nao e cliente da loja nao consegue fundir sacola", async () => {
  await assert.rejects(
    () =>
      comoPapel(bd.pool, { papel: "authenticated", sub: ESTRANHA }, (c) =>
        c.query("SELECT canastra.fundir_sacola($1::jsonb)", [
          itens([{ produto_id: CAFE, quantidade: 1, preco: 54.9, nome: "X" }]),
        ]),
      ),
    /nao e cliente/i,
  );
});

test("quantidade zero ou negativa e ignorada", async () => {
  await comoPapel(bd.pool, { papel: "authenticated", sub: ANA }, async (c) => {
    await c.query("SELECT canastra.fundir_sacola($1::jsonb)", [
      itens([
        { produto_id: CAFE, quantidade: 0, preco: 54.9, nome: "Classico" },
        { produto_id: CHA, quantidade: -5, preco: 20, nome: "Cha" },
      ]),
    ]);
    const { rows } = await c.query(
      "SELECT count(*)::int AS n FROM canastra.carrinho_itens",
    );
    assert.equal(rows[0].n, 0);
  });
});
```

- [ ] **Step 2: Rodar para ver falhar**

Run: `npm --prefix backend test`
Expected: FAIL — `function canastra.fundir_sacola(jsonb) does not exist`

- [ ] **Step 3: Escrever a migração**

Create `backend/db/migrations/0007_fundir_sacola.sql`:

```sql
/**
 * Funde a sacola anonima com a sacola da conta, no login.
 *
 * POR QUE ISTO EXISTE
 * A vitrine guarda a sacola de quem nao esta logado em `localStorage["cart"]`
 * (frontend/lib/sacola/sacola.tsx). Ate agora, quem fundia era o `signIn` do
 * backend proprio. Com o GoTrue assumindo o login, esse ponto de costura some —
 * e sem substituto, todo cliente que monta a sacola deslogado e depois entra
 * PERDE os itens, em silencio. A sacola e o caminho para a receita; e o pior
 * lugar para uma perda silenciosa.
 *
 * SECURITY INVOKER (o padrao): a funcao roda com os poderes de quem chama, e a
 * RLS de carrinhos/carrinho_itens continua valendo. A checagem de `eh_cliente`
 * e explicita porque a mensagem de erro clara vale mais, aqui, que um resultado
 * vazio inexplicavel.
 */
CREATE FUNCTION canastra.fundir_sacola(itens jsonb) RETURNS void
  LANGUAGE plpgsql
AS $$
DECLARE
  id_do_carrinho uuid;
BEGIN
  IF NOT canastra.eh_cliente() THEN
    RAISE EXCEPTION 'Quem chamou nao e cliente da loja.';
  END IF;

  INSERT INTO canastra.carrinhos (user_id)
  VALUES (auth.uid())
  ON CONFLICT (user_id) DO UPDATE SET atualizado_em = now()
  RETURNING carrinho_id INTO id_do_carrinho;

  INSERT INTO canastra.carrinho_itens
    (carrinho_id, produto_id, quantidade, preco, nome, imagem, tamanho, moagem)
  SELECT
    id_do_carrinho,
    (item ->> 'produto_id')::uuid,
    (item ->> 'quantidade')::integer,
    coalesce((item ->> 'preco')::numeric, 0),
    item ->> 'nome',
    item ->> 'imagem',
    item ->> 'tamanho',
    item ->> 'moagem'
  FROM jsonb_array_elements(itens) AS item
  -- Quantidade nao positiva vem de sacola corrompida no navegador. Ignorar e
  -- melhor que falhar: o cliente acabou de logar e nao pode ver erro por causa
  -- de um localStorage sujo.
  WHERE coalesce((item ->> 'quantidade')::integer, 0) > 0
  ON CONFLICT (carrinho_id, produto_id, moagem) DO UPDATE
    SET quantidade = canastra.carrinho_itens.quantidade + EXCLUDED.quantidade;
END;
$$;

GRANT EXECUTE ON FUNCTION canastra.fundir_sacola(jsonb) TO authenticated;
```

- [ ] **Step 4: Rodar para ver passar**

Run: `npm --prefix backend test`
Expected: PASS nos 6 testes de fusão.

Se o teste de moagem falhar com violação de constraint, o motivo é que
`UNIQUE (carrinho_id, produto_id, moagem)` trata `NULL` como distinto: dois
itens sem moagem não colidem. Isso é aceitável nesta fase — a vitrine sempre
envia moagem para café moído — mas registre em `docs/producao.md` como limitação
conhecida em vez de mudar a constraint sem discussão.

- [ ] **Step 5: Commit**

```bash
git add backend/db/migrations/0007_fundir_sacola.sql backend/test/fundir_sacola.test.js
git commit -m "feat: migracao 0007 — RPC que funde a sacola anonima no login"
```

---

### Task 10: Seed contra o GoTrue

**Files:**
- Modify: `backend/db/seed.js` (reescrita completa das partes de conta e produto)
- Create: `backend/test/seed.test.js`

- [ ] **Step 1: Ler o seed atual antes de mexer**

Run: `cat backend/db/seed.js`

Entenda dois pontos antes de editar: o UUID v5 derivado do SKU (é o que torna o
seed idempotente para produtos) e a criação da conta inicial (é o que muda).

- [ ] **Step 2: Escrever o teste que falha**

Create `backend/test/seed.test.js`:

```js
"use strict";

const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { subirPostgres } = require("./ajuda/postgres.js");
const { aplicarMigracoes } = require("../db/migrar.js");
const { semearProdutos } = require("../db/seed.js");

let bd;

before(async () => {
  bd = await subirPostgres();
  await aplicarMigracoes(bd.pool);
}, { timeout: 120_000 });

after(async () => {
  await bd.derrubar();
});

test("semear duas vezes nao duplica produto", async () => {
  const primeira = await semearProdutos(bd.pool);
  const segunda = await semearProdutos(bd.pool);

  const { rows } = await bd.pool.query(
    "SELECT count(*)::int AS n FROM canastra.produtos",
  );
  assert.equal(rows[0].n, primeira.inseridos);
  assert.equal(segunda.inseridos, 0, "a segunda rodada nao insere nada novo");
});

test("semear de novo NAO sobrescreve preco editado no painel", async () => {
  await semearProdutos(bd.pool);
  await bd.pool.query(
    "UPDATE canastra.produtos SET preco = 999.99 WHERE sku IS NOT NULL",
  );
  await semearProdutos(bd.pool);

  const { rows } = await bd.pool.query(
    "SELECT DISTINCT preco FROM canastra.produtos WHERE sku IS NOT NULL",
  );
  assert.deepEqual(rows, [{ preco: "999.99" }], "preco do painel manda");
});
```

- [ ] **Step 3: Rodar para ver falhar**

Run: `npm --prefix backend test`
Expected: FAIL — `semearProdutos is not a function`

- [ ] **Step 4: Adaptar `backend/db/seed.js`**

Três mudanças, mantendo o resto:

1. Exportar `semearProdutos(pool)` separado de `semearAdmin()`, para o teste
   poder semear produtos sem falar com o GoTrue.
2. Trocar `public.products` por `canastra.produtos` e os nomes de coluna
   (`name`→`nome`, `price`→`preco`, `quantity`→`quantidade`, `image`→`imagem`,
   `size`→`tamanho`, `category`→`categoria`, `description`→`descricao`,
   `weight`→`peso`, `width`→`largura`, `height`→`altura`, `length`→`comprimento`,
   `timestamp`→`destacado_em`, `created_at`→`criado_em`).
3. Substituir o `INSERT INTO users` por esta função:

```js
/**
 * Cria a conta inicial no GoTrue, nao no banco.
 *
 * A credencial deixou de ser nossa: quem guarda hash de senha agora e o
 * `auth.users` do Supabase. Aqui so pedimos a criacao pela Admin API e ligamos
 * a conta a loja (`clientes` + `admins`).
 *
 * `email_confirm: true` porque o fluxo normal exige confirmar por link, e a
 * conta inicial precisa entrar no painel na primeira tentativa.
 *
 * Idempotente: se o e-mail ja existe, a Admin API responde 422 e nos apenas
 * reaproveitamos o usuario, sem NUNCA sobrescrever a senha de quem ja existe.
 */
async function semearAdmin(pool) {
  const email = process.env.SEED_ADMIN_EMAIL;
  const senha = process.env.SEED_ADMIN_PASSWORD;
  const nome = process.env.SEED_ADMIN_NAME || "Administração";

  if (!email || !senha) {
    console.log("  · SEED_ADMIN_EMAIL/PASSWORD vazios: conta inicial nao criada.");
    return { criado: false };
  }

  const base = process.env.SUPABASE_URL;
  const chave = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!base || !chave) {
    throw new Error(
      "SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY sao necessarias para criar a conta inicial.",
    );
  }

  const cabecalho = {
    "Content-Type": "application/json",
    apikey: chave,
    Authorization: `Bearer ${chave}`,
  };

  let userId;
  const criacao = await fetch(`${base}/auth/v1/admin/users`, {
    method: "POST",
    headers: cabecalho,
    body: JSON.stringify({ email, password: senha, email_confirm: true }),
  });

  if (criacao.ok) {
    userId = (await criacao.json()).id;
  } else if (criacao.status === 422) {
    // Ja existe. Procuramos o id e seguimos, sem tocar na senha.
    const busca = await fetch(
      `${base}/auth/v1/admin/users?filter=${encodeURIComponent(email)}`,
      { headers: cabecalho },
    );
    if (!busca.ok) {
      throw new Error(`Nao consegui localizar ${email} no GoTrue: ${busca.status}`);
    }
    const { users } = await busca.json();
    userId = users?.[0]?.id;
    if (!userId) throw new Error(`GoTrue nao devolveu id para ${email}.`);
  } else {
    throw new Error(
      `GoTrue recusou criar a conta inicial: ${criacao.status} ${await criacao.text()}`,
    );
  }

  await pool.query(
    `INSERT INTO canastra.clientes (user_id, nome) VALUES ($1, $2)
     ON CONFLICT (user_id) DO NOTHING`,
    [userId, nome],
  );
  await pool.query(
    `INSERT INTO canastra.admins (user_id) VALUES ($1)
     ON CONFLICT (user_id) DO NOTHING`,
    [userId],
  );

  return { criado: true, userId };
}

module.exports = { semearProdutos, semearAdmin };
```

O `INSERT` de produto passa a terminar com:

```sql
ON CONFLICT (sku) WHERE sku IS NOT NULL DO NOTHING
```

`DO NOTHING`, não `DO UPDATE`: preço e estoque pertencem ao painel a partir da
primeira semeadura. Um `DO UPDATE` faria cada deploy reverter o preço que o
administrador acabou de corrigir.

- [ ] **Step 5: Rodar para ver passar**

Run: `npm --prefix backend test`
Expected: PASS nos 2 testes de seed.

- [ ] **Step 6: Commit**

```bash
git add backend/db/seed.js backend/test/seed.test.js
git commit -m "feat: seed cria a conta inicial pelo GoTrue e nunca sobrescreve preco do painel"
```

---

### Task 11: Scripts, remoção do schema.sql e runbook

**Files:**
- Modify: `package.json` (raiz)
- Delete: `backend/db/schema.sql`
- Modify: `docs/producao.md`

- [ ] **Step 1: Trocar os scripts na raiz**

Em `package.json`, substituir `db:schema` e `db:setup`:

```json
"db:migrar": "node backend/db/migrar.js",
"db:seed": "node backend/db/seed.js",
"db:setup": "npm run db:migrar && npm run db:seed",
```

Remover a linha `db:schema` (que chamava `psql -f backend/db/schema.sql`). O
runner usa `pg`, então deixa de exigir `psql` instalado na máquina de deploy.

- [ ] **Step 2: Confirmar que nada mais referencia schema.sql**

Run: `grep -rn "schema.sql" --include=*.js --include=*.json --include=*.md . | grep -v node_modules`
Expected: só as menções em `docs/` que serão reescritas neste passo.

- [ ] **Step 3: Apagar o schema antigo**

```bash
git rm backend/db/schema.sql
```

- [ ] **Step 4: Atualizar `docs/producao.md`**

Na seção 2.1, substituir o bloco de comandos por:

````markdown
### 2.1 Banco

```bash
export DATABASE_URL="postgres://postgres:SENHA@HOST:5432/postgres"
export SUPABASE_URL="https://supabase.SEU-DOMINIO"
export SUPABASE_SERVICE_ROLE_KEY="..."
npm run db:migrar    # aplica as migracoes pendentes, em ordem, em transacao
npm run db:seed      # popula o catalogo e cria a conta inicial no GoTrue
```

`db:migrar` pode rodar a cada deploy: cada arquivo roda uma vez e fica
registrado em `canastra.migracoes`. `db:seed` é idempotente — casa produtos por
UUID v5 derivado do SKU, **nunca sobrescreve preço nem estoque** já editados no
painel, e nunca toca a senha de uma conta existente.
````

Na seção 4, remover o item "Sem migrações versionadas" da lista de pendências e
acrescentar, no lugar:

````markdown
### 4.2 Instância Supabase compartilhada com outros projetos

Decisão registrada em `docs/superpowers/specs/2026-08-17-supabase-selfhosted-design.md`
§2.2. `auth.users` e o `JWT_SECRET` são únicos por instância self-hosted, então
a loja divide os dois com os outros projetos da VPS.

O que está protegido: usuário legítimo de outro projeto autentica mas não é
cliente da loja, e a RLS não lhe entrega nada (`canastra.eh_cliente()`).

O que **não** está: quem obtiver o `JWT_SECRET` ou a `service_role key` da
instância — por qualquer um dos projetos que a dividem — compromete a loja
junto. Subir um stack Supabase separado para a loja é o que fecha isso.
````

- [ ] **Step 5: Rodar a suíte inteira**

Run: `npm --prefix backend test && npm test`
Expected: PASS em tudo — os 15 testes de pagamento originais e os ~30 novos de
banco, mais os 52 da vitrine (que esta fase não toca).

- [ ] **Step 6: Commit**

```bash
git add package.json docs/producao.md
git rm --cached backend/db/schema.sql 2>/dev/null || true
git commit -m "chore: db:migrar substitui schema.sql e o runbook passa a exigir SUPABASE_*"
```

---

## Ao final da F1

O que existe: schema `canastra` completo, migrações versionadas com runner
idempotente, RLS provada por teste positivo e negativo, RPC de fusão de sacola,
seed contra o GoTrue.

O que **não** existe ainda, e é a F2: nada da aplicação usa isso. O Express
continua lendo `public.users` e o painel continua no `frontend/legacy/`. Aplicar
esta fase na instância real (`npm run db:migrar`) é seguro justamente por isso —
cria estrutura nova ao lado, sem tocar no que está rodando.

**Passo manual do operador, fora do alcance dos testes:** rodar
`npm run db:migrar` contra a instância da VPS, com `DATABASE_URL` apontando para
o Postgres do Supabase. Os testes provam as políticas contra um Postgres 16 real
com o mesmo shim de `auth.uid()`, mas só a execução na instância confirma que os
papéis `anon`/`authenticated`/`service_role` de lá têm as permissões esperadas.
