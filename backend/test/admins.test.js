"use strict";

const { test, before, after, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const { subirPostgres } = require("./ajuda/postgres.js");
const { aplicarMigracoes } = require("../db/migrar.js");

let bd;

const ANA = "aaaaaaaa-0000-0000-0000-000000000001";
const BRUNO = "bbbbbbbb-0000-0000-0000-000000000002";

/** SQLSTATE `restrict_violation` — o codigo com que a trava do ultimo admin recusa. */
const REMOCAO_BARRADA = "23001";

before(async () => {
  bd = await subirPostgres();
  await aplicarMigracoes(bd.pool);
}, { timeout: 120_000 });

after(async () => {
  await bd?.derrubar();
});

beforeEach(async () => {
  // Sem esta guarda, um before() que falha faz CADA teste morrer num
  // "Cannot read properties of undefined (reading 'pool')", e o erro de boot —
  // que e a informacao util — some sob N erros derivados.
  if (!bd) {
    throw new Error(
      "O Postgres nao subiu no before(); a causa real esta no erro daquele hook.",
    );
  }

  // TRUNCATE, e nao DELETE, e a escolha esta ligada ao que se testa aqui: a
  // trava de 0002 recusa qualquer DELETE que zere `admins`, e isso inclui a
  // limpeza entre testes — que precisa justamente chegar ao zero. TRUNCATE nao
  // dispara trigger de DELETE e por isso serve. O outro lado da mesma moeda esta
  // anotado em 0002: essa e a unica porta que a trava nao guarda, e so o dono do
  // banco e o `service_role` a alcancam.
  await bd.pool.query(
    "TRUNCATE auth.users, canastra.clientes, canastra.admins CASCADE",
  );
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

test("a recusa vem com SQLSTATE proprio, nao com o P0001 generico", async () => {
  // O painel precisa transformar esta recusa numa mensagem util e as demais num
  // 500. Com o P0001 padrao do RAISE, a unica forma de distinguir seria casar o
  // TEXTO da mensagem — que muda com a redacao e com o locale, exatamente a
  // fragilidade que test/ajuda/sessao.js registrou a proposito do 42501.
  await bd.pool.query("INSERT INTO canastra.admins (user_id) VALUES ($1)", [ANA]);

  await assert.rejects(
    () => bd.pool.query("DELETE FROM canastra.admins WHERE user_id = $1", [ANA]),
    (erro) => {
      assert.equal(erro.code, REMOCAO_BARRADA);
      return true;
    },
  );
});

test("DELETE que nao casa linha nenhuma nao acusa falta de admin", async () => {
  // O caso da instalacao nova: `admins` vazia e alguem roda uma limpeza
  // idempotente antes de cadastrar o primeiro administrador. Trigger de
  // statement dispara mesmo com zero linhas afetadas, entao sem a tabela de
  // transicao de 0002 este DELETE inofensivo recusava com "sem administrador" —
  // travando justamente o momento em que a loja ainda nao tem admin nenhum.
  await bd.pool.query("DELETE FROM canastra.admins");
  await bd.pool.query("DELETE FROM canastra.admins WHERE user_id = $1", [ANA]);

  const { rows } = await bd.pool.query("SELECT count(*)::int AS n FROM canastra.admins");
  assert.equal(rows[0].n, 0);
});

test("apagar cliente comum sem nenhum admin cadastrado nao acusa", async () => {
  // Mesma raiz do teste acima, por outra porta: a cascata de `clientes` para
  // `admins` executa um DELETE que casa zero linhas quando o cliente nao era
  // admin — e isso bastava para a versao sem tabela de transicao recusar o
  // cadastro/remocao de qualquer cliente enquanto a loja nao tivesse admin.
  await bd.pool.query("DELETE FROM canastra.clientes WHERE user_id = $1", [BRUNO]);

  const { rows } = await bd.pool.query(
    "SELECT user_id FROM canastra.clientes ORDER BY user_id",
  );
  assert.deepEqual(rows.map((r) => r.user_id), [ANA]);
});

test("apagar no auth.users o unico admin e recusado, e nada fica pela metade", async () => {
  // Cenario real: o operador remove o usuario pelo Supabase Studio, que apaga em
  // `auth.users`. A cascata desce por `clientes` ate `admins` e esbarra na
  // trava. O que importa aqui e o depois: como tudo acontece num comando so, a
  // recusa desfaz TAMBEM a remocao do usuario e do cliente. Se a trava fosse
  // BEFORE por linha, ou se o Postgres nao abortasse o comando inteiro, sobraria
  // um usuario meio apagado — pior que a remocao que se queria evitar.
  await bd.pool.query("INSERT INTO canastra.admins (user_id) VALUES ($1)", [ANA]);

  await assert.rejects(
    () => bd.pool.query("DELETE FROM auth.users WHERE id = $1", [ANA]),
    (erro) => {
      assert.equal(erro.code, REMOCAO_BARRADA);
      return true;
    },
  );

  const { rows } = await bd.pool.query(`
    SELECT
      (SELECT count(*)::int FROM auth.users)        AS usuarios,
      (SELECT count(*)::int FROM canastra.clientes) AS clientes,
      (SELECT count(*)::int FROM canastra.admins)   AS admins
  `);
  assert.deepEqual(rows[0], { usuarios: 2, clientes: 2, admins: 1 });
});

test("apagar no auth.users um admin entre dois desce os dois saltos da cascata", async () => {
  // O outro lado do teste anterior: quando a remocao e legitima, a cascata de
  // dois saltos (auth.users -> clientes -> admins) tem mesmo de limpar tudo.
  await bd.pool.query(
    "INSERT INTO canastra.admins (user_id) VALUES ($1), ($2)",
    [ANA, BRUNO],
  );

  await bd.pool.query("DELETE FROM auth.users WHERE id = $1", [BRUNO]);

  const { rows } = await bd.pool.query(`
    SELECT
      (SELECT count(*)::int FROM auth.users)        AS usuarios,
      (SELECT count(*)::int FROM canastra.clientes) AS clientes,
      (SELECT count(*)::int FROM canastra.admins)   AS admins
  `);
  assert.deepEqual(rows[0], { usuarios: 1, clientes: 1, admins: 1 });
});

test("cpf e opcional para muitos, mas unico para quem tem", async () => {
  // As duas metades importam. Se o UNIQUE tratasse NULLs como iguais, o segundo
  // cadastro sem CPF ja falharia e o cadastro da loja quebraria no dia 2 — e o
  // CPF so e pedido no checkout com nota.
  await bd.pool.query("UPDATE canastra.clientes SET cpf = NULL");
  const semCpf = await bd.pool.query(
    "SELECT count(*)::int AS n FROM canastra.clientes WHERE cpf IS NULL",
  );
  assert.equal(semCpf.rows[0].n, 2);

  await bd.pool.query("UPDATE canastra.clientes SET cpf = $1 WHERE user_id = $2", [
    "11111111111",
    ANA,
  ]);
  await assert.rejects(
    () =>
      bd.pool.query("UPDATE canastra.clientes SET cpf = $1 WHERE user_id = $2", [
        "11111111111",
        BRUNO,
      ]),
    (erro) => {
      assert.equal(erro.code, "23505");
      return true;
    },
  );
});

test("os GRANTs padrao de 0001 alcancaram as duas tabelas de 0002", async () => {
  // A duvida que 0001 deixou em aberto, agora contra tabelas de verdade:
  // ALTER DEFAULT PRIVILEGES so vale para o que o papel que o executou criar. Se
  // nao valesse, cada rota da loja daria 404 no PostgREST com a RLS perfeita, e
  // a investigacao comecaria pela politica — o lugar errado.
  const { rows } = await bd.pool.query(`
    SELECT
      t.tabela,
      has_table_privilege('anon',          'canastra.' || t.tabela, 'SELECT') AS anon_le,
      has_table_privilege('anon',          'canastra.' || t.tabela, 'INSERT') AS anon_escreve,
      has_table_privilege('authenticated', 'canastra.' || t.tabela, 'SELECT') AS auth_le,
      has_table_privilege('authenticated', 'canastra.' || t.tabela, 'DELETE') AS auth_apaga,
      has_table_privilege('service_role',  'canastra.' || t.tabela, 'INSERT') AS servico_escreve
    FROM (VALUES ('clientes'), ('admins')) AS t(tabela)
    ORDER BY t.tabela
  `);

  assert.deepEqual(rows, [
    {
      tabela: "admins",
      anon_le: true,
      anon_escreve: false,
      auth_le: true,
      auth_apaga: true,
      servico_escreve: true,
    },
    {
      tabela: "clientes",
      anon_le: true,
      anon_escreve: false,
      auth_le: true,
      auth_apaga: true,
      servico_escreve: true,
    },
  ]);
});
