"use strict";

const { test, before, after, beforeEach } = require("node:test");
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

beforeEach(() => {
  // Sem esta guarda, um before() que falha faz CADA teste morrer num
  // "Cannot read properties of undefined (reading 'pool')", e o erro de boot —
  // que e a informacao util — some sob N erros derivados.
  if (!bd) {
    throw new Error(
      "O Postgres nao subiu no before(); a causa real esta no erro daquele hook.",
    );
  }
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

/**
 * Toda tabela de `canastra` com a RLS ligada, sem lista de nomes.
 *
 * `migracoes` fica de fora por ser a escrituracao do proprio runner: ela nao
 * guarda dado de ninguem, e nasce fora de qualquer migracao (o bootstrap de
 * db/migrar.js a cria antes de existir migracao para ligar RLS nela).
 */
const SQL_TABELAS_SEM_RLS = `
  SELECT c.relname AS tabela
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'canastra'
    -- 'r' = tabela comum, 'p' = particionada. Views nao tem RLS propria (quem
    -- decide e a tabela de baixo) e sequencias tampouco, entao ficam fora.
    AND c.relkind IN ('r', 'p')
    AND c.relname <> 'migracoes'
    AND NOT c.relrowsecurity
  ORDER BY c.relname
`;

test("REGRA: toda tabela de canastra sai das migracoes com a RLS ligada", async () => {
  // A Regra 2 do projeto, afirmada como INVARIANTE e nao como lista.
  //
  // Antes disto, cada migracao tinha seu proprio teste conferindo as suas
  // tabelas pelo nome. Todos passavam e a regra mesmo assim nao estava
  // protegida: uma tabela criada em 0009 sem `ENABLE ROW LEVEL SECURITY` nao
  // aparece em lista nenhuma escrita antes dela, entao os tres testes seguiriam
  // verdes enquanto a tabela nova nasce aberta a quem tiver GRANT. Uma regra que
  // so vale para o que ja existe nao e uma regra, e um inventario.
  //
  // Assim, quem esquecer o ENABLE numa migracao futura descobre no CI, sem
  // precisar saber que esta regra existe — que e o unico jeito de uma convencao
  // sobreviver a quem nao leu a convencao.
  const { rows } = await bd.pool.query(SQL_TABELAS_SEM_RLS);

  assert.deepEqual(
    rows.map((r) => r.tabela),
    [],
    "estas tabelas estao sem RLS; falta ALTER TABLE ... ENABLE ROW LEVEL SECURITY na migracao que as criou",
  );
});

test("e a invariante de RLS realmente reprova uma tabela nova sem ENABLE", async () => {
  // Um teste que so afirma "a lista esta vazia" passa verde tambem quando a
  // consulta esta errada e nunca acharia nada — e ai a rede de seguranca nao
  // existe e ninguem fica sabendo. Entao a rede e testada: uma tabela de sonda
  // sem RLS TEM de aparecer.
  await bd.pool.query("CREATE TABLE canastra.sonda_sem_rls (id int)");
  try {
    const { rows } = await bd.pool.query(SQL_TABELAS_SEM_RLS);
    assert.deepEqual(rows.map((r) => r.tabela), ["sonda_sem_rls"]);

    // E some da lista assim que a migracao faz o que devia.
    await bd.pool.query("ALTER TABLE canastra.sonda_sem_rls ENABLE ROW LEVEL SECURITY");
    const depois = await bd.pool.query(SQL_TABELAS_SEM_RLS);
    assert.deepEqual(depois.rows, []);
  } finally {
    await bd.pool.query("DROP TABLE IF EXISTS canastra.sonda_sem_rls");
  }
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
      // O lado negativo e o que mais importa, e vale para LEITURA tambem: uma
      // tabela nova nao pode nascer legivel por visitante anonimo. Se nascesse,
      // `clientes`, `pedidos` e `enderecos` chegariam ao mundo com nome, CPF e
      // telefone abertos, e a protecao passaria a depender de alguem lembrar de
      // um REVOKE em cada migracao seguinte — uma escada que falha ABERTA.
      // Invertido, o esquecimento vira 404 no PostgREST: barulhento e achado no
      // primeiro teste da vitrine. Quem for de fato publico leva GRANT proprio.
      anon_le: false,
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
