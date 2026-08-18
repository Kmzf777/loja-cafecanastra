"use strict";

const { test, before, after, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const { subirPostgres } = require("./ajuda/postgres.js");
const {
  comoPapel,
  PERMISSAO_NEGADA,
  REMOCAO_BARRADA,
} = require("./ajuda/sessao.js");
const { aplicarMigracoes } = require("../db/migrar.js");

let bd;

const ANA = "aaaaaaaa-0000-0000-0000-000000000001";
const BRUNO = "bbbbbbbb-0000-0000-0000-000000000002";

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
    (erro) => {
      // O SQLSTATE, e nao so o texto: o painel precisa transformar ESTA recusa
      // numa mensagem util e qualquer outra num 500. Com o P0001 que o RAISE da
      // de graca, distinguir exigiria casar texto de mensagem — que muda com a
      // redacao e com o locale, a fragilidade que ajuda/sessao.js ja registrou a
      // proposito do 42501.
      assert.equal(erro.code, REMOCAO_BARRADA);
      assert.match(erro.message, /sem administrador/i);
      return true;
    },
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

test("a trava vale tambem para o service_role, que e quem escreve admins", async () => {
  // Os demais testes rodam como `postgres`, superusuario e dono das tabelas —
  // que ignora RLS. Em producao quem mexe em `admins` e o `service_role`, e a
  // partir da migracao de politicas e ele, nao o superusuario, que precisa ver a
  // trava funcionar. Sem este caso, uma trava que so vale para superusuario
  // passaria despercebida.
  await comoPapel(bd.pool, { papel: "service_role" }, async (cliente) => {
    await cliente.query("INSERT INTO canastra.admins (user_id) VALUES ($1)", [ANA]);

    await assert.rejects(
      () => cliente.query("DELETE FROM canastra.admins WHERE user_id = $1", [ANA]),
      (erro) => {
        assert.equal(erro.code, REMOCAO_BARRADA);
        return true;
      },
    );
  });
});

test("nao da para virar admin sem ser cliente da loja", async () => {
  // A regra que justifica o arquivo inteiro, e a unica ate agora sem medicao:
  // `admins` referencia `clientes`, nao `auth.users`. Como a instancia Supabase
  // e compartilhada, um usuario de OUTRO projeto existe em `auth.users` sem
  // nunca ter passado pelo cadastro da loja — e nao pode ser promovido a
  // administrador daqui. Se um dia alguem "simplificar" a FK apontando para
  // `auth.users`, e este teste que grita.
  const ESTRANHO = "dddddddd-0000-0000-0000-000000000004";
  await bd.pool.query("INSERT INTO auth.users (id, email) VALUES ($1,'d@ex.com')", [
    ESTRANHO,
  ]);

  await assert.rejects(
    () => bd.pool.query("INSERT INTO canastra.admins (user_id) VALUES ($1)", [ESTRANHO]),
    (erro) => {
      assert.equal(erro.code, "23503");
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

test("os GRANTs padrao de 0001 alcancaram as duas tabelas, e anon ficou de fora", async () => {
  // Duas perguntas de uma vez. A primeira e a duvida que 0001 deixou em aberto,
  // agora contra tabelas de verdade: ALTER DEFAULT PRIVILEGES so vale para o que
  // o papel que o executou criar. Se nao valesse, cada rota da loja daria 404 no
  // PostgREST com a RLS perfeita, e a investigacao comecaria pela politica — o
  // lugar errado.
  //
  // A segunda e o lado negativo, e vale mais: `anon` NAO entra por padrao. Se
  // entrasse, `clientes` — com nome, CPF e telefone — nasceria legivel por
  // visitante anonimo, e a protecao dependeria de alguem lembrar de um REVOKE
  // numa migracao posterior.
  const { rows } = await bd.pool.query(`
    SELECT
      t.tabela,
      has_table_privilege('anon',          'canastra.' || t.tabela, 'SELECT') AS anon_le,
      has_table_privilege('authenticated', 'canastra.' || t.tabela, 'SELECT') AS auth_le,
      has_table_privilege('authenticated', 'canastra.' || t.tabela, 'DELETE') AS auth_apaga,
      has_table_privilege('service_role',  'canastra.' || t.tabela, 'INSERT') AS servico_escreve
    FROM (VALUES ('clientes'), ('admins')) AS t(tabela)
    ORDER BY t.tabela
  `);

  assert.deepEqual(rows, [
    {
      tabela: "admins",
      anon_le: false,
      auth_le: true,
      // ERA `true` ATE A MIGRACAO 0003, e a mudanca e deliberada. O default de
      // 0001 de fato alcancou `admins` — quem prova isso agora e a linha de
      // `clientes` logo abaixo —, mas 0003 REVOGA a escrita de `authenticated`
      // aqui de proposito: enquanto ela existisse, uma unica politica permissiva
      // de INSERT escrita na migracao de politicas deixaria um token de OUTRO
      // projeto da instancia compartilhada se promover a administrador desta
      // loja. Que e exatamente o ataque que esta tabela inteira existe para
      // impedir quando referencia `clientes` em vez de `auth.users` (ver o teste
      // "nao da para virar admin sem ser cliente da loja" acima) — sem o REVOKE,
      // a defesa estrutural de 0002 dependia de ninguem escrever a politica
      // errada em 0006.
      //
      // Quem escreve em `admins` e o `service_role`, que continua com tudo.
      auth_apaga: false,
      servico_escreve: true,
    },
    {
      // `clientes` NAO leva REVOKE e por isso continua sendo a testemunha de que
      // o ALTER DEFAULT PRIVILEGES de 0001 alcanca as tabelas das migracoes: o
      // cliente logado escreve mesmo na propria linha (cria a conta, corrige
      // telefone), e o recorte de QUAL linha e trabalho da politica de RLS, que
      // sabe distinguir dono de vizinho. Privilegio de tabela nao sabe.
      tabela: "clientes",
      anon_le: false,
      auth_le: true,
      auth_apaga: true,
      servico_escreve: true,
    },
  ]);
});

test("as duas tabelas ja saem de 0002 com a RLS ligada", async () => {
  // A chave geral, e nao uma politica. Entre o COMMIT de 0002 e o da migracao
  // que escreve as politicas ha uma janela real — cada migracao commita na
  // propria transacao —, e um deploy que pare no meio (a migracao de RLS
  // falhando e o caso obvio) deixaria `nome`, `cpf` e `telefone` servidos pelo
  // PostgREST. Com ENABLE aqui e sem policy, ninguem alem do dono e de quem tem
  // BYPASSRLS passa: a sequencia falha FECHADA.
  //
  // A asercao e so `relrowsecurity`, de proposito. Conferir tambem "zero
  // politicas" descreveria o banco de HOJE e obrigaria a migracao de politicas a
  // apagar este teste — um teste que atrapalha em vez de proteger. O que precisa
  // valer para sempre e a chave estar ligada.
  const { rows } = await bd.pool.query(`
    SELECT c.relname AS tabela, c.relrowsecurity AS ligada
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'canastra' AND c.relname IN ('clientes', 'admins')
    ORDER BY c.relname
  `);

  assert.deepEqual(rows, [
    { tabela: "admins", ligada: true },
    { tabela: "clientes", ligada: true },
  ]);

  // E o efeito, nao so o catalogo: como `anon` nem GRANT tem, a recusa vem antes
  // da RLS, com 42501. As duas camadas negam, e e assim que tem de ser.
  await assert.rejects(
    () =>
      comoPapel(bd.pool, { papel: "anon" }, (cliente) =>
        cliente.query("SELECT count(*) FROM canastra.clientes"),
      ),
    (erro) => {
      assert.equal(erro.code, PERMISSAO_NEGADA);
      return true;
    },
  );
});
