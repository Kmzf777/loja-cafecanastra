"use strict";

/**
 * A auditoria de 0035, vista de fora.
 *
 * O QUE ESTA MIGRACAO E: o lugar onde fica escrito QUEM mexeu no quê. Hoje todo
 * admin pode tudo e nada registra nada — num painel que cria promocao, muda preco
 * e emite NF-e, "quem aprovou este desconto de 50%" simplesmente nao tem
 * resposta, e "quem exportou a base com CPF e e-mail" tampouco.
 *
 * O QUE ESTE ARQUIVO MEDE, e sao tres propriedades e nao uma:
 *
 *   1. NINGUEM DE FORA LE. `anon` nunca; cliente logado nunca; token de outro
 *      projeto da instancia compartilhada nunca. So a admin.
 *   2. O LOG E APPEND-ONLY PELO NAVEGADOR. Nem a admin insere, altera ou apaga
 *      linha pelo PostgREST — quem escreve e o servico, na mesma transacao do
 *      gesto que registrou.
 *   3. O AUTOR SOBREVIVE A DEMOCAO. Tirar alguem de `canastra.admins` nao pode
 *      apagar o nome dela do que ela ja fez — que e justamente quando o log
 *      importa.
 *
 * TODA ASERCAO DE RECUSA E EM `err.code`, nunca em texto de mensagem.
 */

const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");

const { subirPostgres } = require("./ajuda/postgres.js");
const {
  comoPapel,
  PERMISSAO_NEGADA,
  REMOCAO_BARRADA,
} = require("./ajuda/sessao.js");
const { aplicarMigracoes } = require("../db/migrar.js");

const CHECK_VIOLADO = "23514";
const NULO_VIOLADO = "23502";

let bd;

const ANA = "aaaaaaaa-0000-0000-0000-000000000001";
const DORA = "dddddddd-0000-0000-0000-000000000004";
const ELIS = "dddddddd-0000-0000-0000-000000000009";
const ESTRANHA = "eeeeeeee-0000-0000-0000-000000000005";

const SESSAO_ANA = { papel: "authenticated", sub: ANA };
const SESSAO_DORA = { papel: "authenticated", sub: DORA };
const SESSAO_ESTRANHA = { papel: "authenticated", sub: ESTRANHA };
const SESSAO_ANON = { papel: "anon" };

async function exigeRecusa(sessao, sql, parametros, contexto, codigo = PERMISSAO_NEGADA) {
  await assert.rejects(
    () => comoPapel(bd.pool, sessao, (cliente) => cliente.query(sql, parametros)),
    (erro) => {
      assert.equal(erro.code, codigo, `deveria recusar com ${codigo}: ${contexto}`);
      return true;
    },
  );
}

async function exigeRecusaDoBanco(sql, parametros, contexto, codigo = CHECK_VIOLADO) {
  await assert.rejects(
    () => bd.pool.query(sql, parametros),
    (erro) => {
      assert.equal(erro.code, codigo, `deveria recusar com ${codigo}: ${contexto}`);
      return true;
    },
  );
}

async function contar(sessao, relacao) {
  return comoPapel(bd.pool, sessao, async (cliente) => {
    const { rows } = await cliente.query(
      `SELECT count(*)::int AS n FROM canastra.${relacao}`,
    );
    return rows[0].n;
  });
}

/** Grava uma linha de log pelo caminho real: o servico, como dono do banco. */
async function registrar(admin, acao, entidade, entidadeId) {
  return bd.pool.query(
    `INSERT INTO canastra.admin_log
       (admin_user_id, acao, entidade, entidade_id, antes, depois)
     VALUES ($1, $2, $3, $4, '{"preco": 54.9}'::jsonb, '{"preco": 27.45}'::jsonb)
     RETURNING id, criado_em`,
    [admin, acao, entidade, entidadeId],
  );
}

before(async () => {
  bd = await subirPostgres();
  await aplicarMigracoes(bd.pool);

  await bd.pool.query(
    `INSERT INTO auth.users (id, email) VALUES
       ($1,'ana@ex.com'), ($2,'dora@ex.com'), ($3,'elis@ex.com'),
       ($4,'estranha@outroprojeto.com')`,
    [ANA, DORA, ELIS, ESTRANHA],
  );
  await bd.pool.query(
    `INSERT INTO canastra.clientes (user_id, nome) VALUES
       ($1,'Ana'), ($2,'Dora'), ($3,'Elis')`,
    [ANA, DORA, ELIS],
  );
  // DUAS administradoras de proposito: o trigger `admins_nunca_zero` (0002)
  // recusa deixar a loja sem admin, e o teste de democao precisa remover uma.
  await bd.pool.query(
    "INSERT INTO canastra.admins (user_id) VALUES ($1), ($2)",
    [DORA, ELIS],
  );
}, { timeout: 180_000 });

after(async () => {
  await bd?.derrubar();
});

/* ------------------------------------------------------------------------- *
 * `admins.papel`
 * ------------------------------------------------------------------------- */

test("papel: as linhas que ja existiam nascem 'dono', e o vocabulario e fechado", async () => {
  const { rows } = await bd.pool.query(
    "SELECT papel FROM canastra.admins WHERE user_id = $1",
    [DORA],
  );
  assert.equal(rows[0].papel, "dono");

  await bd.pool.query("UPDATE canastra.admins SET papel = 'operador' WHERE user_id = $1", [ELIS]);
  await exigeRecusaDoBanco(
    "UPDATE canastra.admins SET papel = 'chefao' WHERE user_id = $1",
    [ELIS],
    "papel fora da lista",
  );
  await exigeRecusaDoBanco(
    "UPDATE canastra.admins SET papel = NULL WHERE user_id = $1",
    [ELIS],
    "admin sem papel nenhum",
    NULO_VIOLADO,
  );
  await bd.pool.query("UPDATE canastra.admins SET papel = 'dono' WHERE user_id = $1", [ELIS]);
});

test("o trigger admins_nunca_zero continua de pe depois da coluna nova", async () => {
  // A coluna entrou por ALTER TABLE, e o trigger e AFTER DELETE ... REFERENCING
  // OLD TABLE. Este teste existe para provar que o formato da tabela de
  // transicao nao quebrou com ela — e o modo de falha seria a loja aceitar ficar
  // sem administrador nenhum, calada.
  await bd.pool.query("BEGIN");
  try {
    // Com duas admins, remover uma passa.
    await bd.pool.query("DELETE FROM canastra.admins WHERE user_id = $1", [ELIS]);
    // Removida a segunda, o trigger recusa a operacao inteira.
    await assert.rejects(
      () => bd.pool.query("DELETE FROM canastra.admins WHERE user_id = $1", [DORA]),
      (erro) => {
        assert.equal(erro.code, REMOCAO_BARRADA);
        return true;
      },
    );
  } finally {
    await bd.pool.query("ROLLBACK");
  }
});

/* ------------------------------------------------------------------------- *
 * `admin_log` — quem le
 * ------------------------------------------------------------------------- */

test("anon NUNCA le o admin_log", async () => {
  await registrar(DORA, "preco_alterado", "produto", "algum-id");
  await exigeRecusa(
    SESSAO_ANON,
    "SELECT * FROM canastra.admin_log",
    [],
    "anon lendo o log de auditoria",
  );
  // E nem a lista de administradores com o papel de cada uma.
  await exigeRecusa(
    SESSAO_ANON,
    "SELECT user_id, papel FROM canastra.admins",
    [],
    "anon lendo os papeis dos admins",
  );
});

test("cliente logado e token de outro projeto nao veem linha nenhuma", async () => {
  assert.equal(await contar(SESSAO_ANA, "admin_log"), 0, "cliente nao le o log");
  assert.equal(await contar(SESSAO_ESTRANHA, "admin_log"), 0, "estranha nao le o log");
});

test("a admin le o log inteiro", async () => {
  assert.ok((await contar(SESSAO_DORA, "admin_log")) >= 1);
});

/* ------------------------------------------------------------------------- *
 * `admin_log` — append-only pelo navegador
 * ------------------------------------------------------------------------- */

test("nem a admin escreve no log pelo navegador: quem registra e o servico", async () => {
  for (const [sql, contexto] of [
    [
      `INSERT INTO canastra.admin_log (admin_user_id, acao, entidade)
       VALUES ('${DORA}', 'inventada', 'produto')`,
      "admin inserindo linha de log",
    ],
    ["UPDATE canastra.admin_log SET acao = 'outra'", "admin reescrevendo o log"],
    ["DELETE FROM canastra.admin_log", "admin apagando o log"],
  ]) {
    await exigeRecusa(SESSAO_DORA, sql, [], contexto);
  }
});

/* ------------------------------------------------------------------------- *
 * O que o log exige, e o que ele preserva
 * ------------------------------------------------------------------------- */

test("acao e entidade sao obrigatorias e nao podem ser vazias", async () => {
  await exigeRecusaDoBanco(
    `INSERT INTO canastra.admin_log (admin_user_id, entidade) VALUES ($1, 'produto')`,
    [DORA],
    "log sem acao",
    NULO_VIOLADO,
  );
  await exigeRecusaDoBanco(
    `INSERT INTO canastra.admin_log (admin_user_id, acao, entidade) VALUES ($1, '   ', 'produto')`,
    [DORA],
    "log com acao em branco",
  );
  await exigeRecusaDoBanco(
    `INSERT INTO canastra.admin_log (admin_user_id, acao, entidade) VALUES ($1, 'x', '')`,
    [DORA],
    "log com entidade vazia",
  );
});

test("o autor sobrevive a democao, e a linha sobrevive a exclusao da conta", async () => {
  const { rows } = await registrar(ELIS, "exportacao_de_pedidos", "pedidos", null);
  const idDoLog = rows[0].id;

  // DEMOCAO: Elis deixa de ser administradora. O log tem de continuar dizendo
  // que foi ela — e justamente quando alguem sai que se pergunta o que ela fez.
  await bd.pool.query("DELETE FROM canastra.admins WHERE user_id = $1", [ELIS]);
  const depoisDaDemocao = await bd.pool.query(
    "SELECT admin_user_id, acao FROM canastra.admin_log WHERE id = $1",
    [idDoLog],
  );
  assert.equal(depoisDaDemocao.rows[0].admin_user_id, ELIS);
  assert.equal(depoisDaDemocao.rows[0].acao, "exportacao_de_pedidos");

  // EXCLUSAO DA CONTA (LGPD): a pessoa some, o registro do que foi feito fica —
  // com o autor em NULL, como `pedidos.user_id` faz desde 0005.
  await bd.pool.query("DELETE FROM canastra.clientes WHERE user_id = $1", [ELIS]);
  const depoisDaExclusao = await bd.pool.query(
    "SELECT admin_user_id, acao FROM canastra.admin_log WHERE id = $1",
    [idDoLog],
  );
  assert.equal(depoisDaExclusao.rows[0].admin_user_id, null);
  assert.equal(depoisDaExclusao.rows[0].acao, "exportacao_de_pedidos");
});
