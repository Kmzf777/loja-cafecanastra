"use strict";

/**
 * As duas pontas que a revisao de 0017 achou abertas, medidas no banco de
 * verdade e na rota de verdade.
 *
 * A PONTA DE ESCRITA. `canastra.clientes` e a unica tabela desta loja em que
 * `authenticated` conserva `UPDATE` (0006 o mantem de proposito, para o cliente
 * corrigir o proprio nome, telefone e CPF). Como o GRANT era de TABELA, as
 * cinco colunas que 0017 acrescentou nasceram escrevendo-se sozinhas pelo
 * PostgREST — inclusive `whatsapp_wa_id`, que e para onde a loja manda o aviso
 * do pedido. 0018 troca o grant de tabela pela lista explicita de colunas.
 *
 * A PONTA DE LEITURA. O Art. 18 tem dois direitos, e 0017 so argumentou sobre
 * um: as colunas somem por cascata (eliminacao), mas ninguem as devolvia a quem
 * pedisse uma COPIA (acesso). A exportacao de `lgpd.routes.js` enumera colunas
 * a mao, entao coluna nova nao entra sozinha, e `whatsapp_mensagens` — com quem
 * a loja falou, quando e sobre qual pedido — nao entrava de jeito nenhum.
 *
 * POR QUE OS DOIS ASSUNTOS DIVIDEM UM ARQUIVO: sao o mesmo descuido visto de
 * dois lados — coluna nova em `clientes` herda o regime da tabela, e o regime
 * de `clientes` nunca foi "fechado". Separa-los faria duas suites subirem dois
 * Postgres para provar as duas metades de uma frase so.
 *
 * O banco e REAL porque privilegio de coluna e exatamente o que um duble de
 * pool nao prova: um mock responde o que o teste mandar responder.
 */

const { test, before, after, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const { subirPostgres } = require("./ajuda/postgres.js");
const { comoPapel, PERMISSAO_NEGADA } = require("./ajuda/sessao.js");
const { aplicarMigracoes } = require("../db/migrar.js");

let bd;
let lgpd;

/**
 * As quatro que o titular NAO pode escrever, com o estrago de cada uma ao lado.
 * Lista nomeada uma vez so: os testes de catalogo e o de UPDATE real iteram por
 * ela, entao acrescentar coluna nova ao regime fechado e mexer num lugar.
 */
const FECHADAS = Object.freeze([
  // Decide PARA QUAL APARELHO o aviso do pedido vai. Escrevivel pelo titular,
  // ela desvia o aviso de um pedido para o telefone de outra pessoa.
  "whatsapp_wa_id",
  // O relogio da janela de 24h e o teto de "um menu por janela". A mao, contorna
  // o teto e faz o bot responder em laco.
  "whatsapp_ultima_entrada_em",
  // Prova de consentimento. O onus de provar que ele existiu e do controlador
  // (LGPD Art. 8 par. 2); carimbo que o titular forja nao prova nada.
  "whatsapp_optin_em",
  "whatsapp_promo_optin_em",
]);

/** A unica das cinco que e direito do titular: parar de receber. */
const ABERTA = "whatsapp_optout_em";

/**
 * A LISTA INTEIRA que `authenticated` pode atualizar depois de 0018 — e o
 * "nem uma a mais" desta tarefa.
 *
 * MEDIDA no catalogo antes de escrever a migracao, e nao copiada da descricao
 * dela: antes de 0018 o catalogo dizia que `authenticated` atualizava as DEZ
 * colunas de `clientes` (grant de tabela `authenticated=rw`), entao a lista
 * correta e aquelas dez menos as quatro de cima. `user_id` e `criado_em` ficam
 * porque ja estavam: 0018 fecha o que 0017 abriu por descuido, e nao aproveita
 * a viagem para estreitar o que 0006 decidiu de propriedade. (`user_id` nao e
 * um furo: o WITH CHECK de `clientes_dono_atualiza` recusa mudar a linha para
 * o uid de outra pessoa.)
 */
const ATUALIZAVEIS_POR_AUTHENTICATED = Object.freeze([
  "cpf",
  "criado_em",
  "nome",
  "telefone",
  "user_id",
  ABERTA,
]);

/** Titular dos testes de UPDATE real e da exportacao com mensagens. */
const ANA = "aaaaaaaa-0000-4000-8000-000000000001";
/** O outro titular: prova que a exportacao nao varre a tabela. */
const BRUNO = "aaaaaaaa-0000-4000-8000-000000000002";
/** Titular sem mensagem nenhuma — o caso mais comum de um pedido de acesso. */
const CLARA = "aaaaaaaa-0000-4000-8000-000000000003";

before(async () => {
  bd = await subirPostgres();
  await aplicarMigracoes(bd.pool);

  // A rota e requerida DEPOIS da env: `src/pgPool.js` le DATABASE_URL no
  // require. Os testes passam `{ conexao: bd.pool }`, entao aquele pool nunca
  // e usado — mas ele existe, e o `after` o fecha para o processo terminar.
  process.env.DATABASE_URL = bd.connectionString;
  lgpd = require("../src/routes/lgpd.routes.js");

  await bd.pool.query(
    `INSERT INTO auth.users (id, email) VALUES
       ($1, 'ana@ex.com'), ($2, 'bruno@ex.com'), ($3, 'clara@ex.com')`,
    [ANA, BRUNO, CLARA],
  );
  await bd.pool.query(
    `INSERT INTO canastra.clientes (user_id, nome, telefone) VALUES
       ($1, 'Ana Souza', '35999990000'),
       ($2, 'Bruno Lima', '35999991111'),
       ($3, 'Clara Reis', NULL)`,
    [ANA, BRUNO, CLARA],
  );
}, { timeout: 120_000 });

after(async () => {
  await require("../src/pgPool.js").end().catch(() => {});
  await bd?.derrubar();
});

beforeEach(() => {
  if (!bd) {
    throw new Error(
      "O Postgres nao subiu no before(); a causa real esta no erro daquele hook.",
    );
  }
});

/** `has_column_privilege` e o padrao da casa: ele responde pelo EFETIVO. */
async function podeAtualizar(papel, coluna) {
  const { rows } = await bd.pool.query(
    "SELECT has_column_privilege($1, 'canastra.clientes', $2, 'UPDATE') AS pode",
    [papel, coluna],
  );
  return rows[0].pode;
}

const respostaFalsa = () => {
  const res = { codigo: null, corpo: null };
  res.status = (codigo) => {
    res.codigo = codigo;
    return res;
  };
  res.json = (corpo) => {
    if (res.codigo === null) res.codigo = 200;
    res.corpo = corpo;
    return res;
  };
  return res;
};

async function exportar(userId) {
  const res = respostaFalsa();
  await lgpd.exportarDadosDoTitular({ params: { userId } }, res, {
    conexao: bd.pool,
  });
  return res;
}

/* --------------------------------------------------------------------------
 * O catalogo: quem pode escrever o que
 * -------------------------------------------------------------------------- */

test("authenticated nao escreve mais `whatsapp_wa_id` — o destino do aviso", async () => {
  // A coluna com o pior desfecho, sozinha e nomeada, porque e a que justifica a
  // migracao inteira: quem a escreve escolhe para qual aparelho a loja manda o
  // aviso de um pedido. Um teste que so olhasse a lista agregada esconderia
  // ESTA frase atras de um deepEqual.
  assert.equal(await podeAtualizar("authenticated", "whatsapp_wa_id"), false);
});

test("nem a janela de 24h, nem os dois carimbos de consentimento", async () => {
  const abertas = [];
  for (const coluna of FECHADAS.filter((c) => c !== "whatsapp_wa_id")) {
    if (await podeAtualizar("authenticated", coluna)) abertas.push(coluna);
  }
  assert.deepEqual(abertas, [], "estas colunas nao podem sair do Express");
});

test("mas o direito de parar continua sendo do titular: `whatsapp_optout_em`", async () => {
  // O par negativo dos dois testes acima. Sem ele, um REVOKE largo demais
  // deixaria a suite verde e o cliente sem como se desinscrever — falha que so
  // aparece quando alguem pede para parar e nao consegue.
  assert.equal(await podeAtualizar("authenticated", ABERTA), true);
});

test("e a lista atualizavel e exatamente a de antes de 0017 mais o optout", async () => {
  // O "nem uma a mais" desta tarefa, e tambem a regressao que importa no outro
  // sentido: `clientes` e a UNICA tabela em que 0006 deixa `authenticated`
  // atualizar, para a pessoa corrigir nome, telefone e CPF. Trocar grant de
  // tabela por lista de colunas e exatamente o gesto que fecha isso sem querer,
  // e uma lista esquecida aqui fecharia a tela de perfil em silencio.
  const { rows } = await bd.pool.query(
    `SELECT a.attname AS coluna
       FROM pg_attribute a
      WHERE a.attrelid = 'canastra.clientes'::regclass
        AND a.attnum > 0 AND NOT a.attisdropped
        AND has_column_privilege('authenticated', a.attrelid, a.attname, 'UPDATE')
      ORDER BY a.attname`,
  );
  assert.deepEqual(
    rows.map((r) => r.coluna),
    [...ATUALIZAVEIS_POR_AUTHENTICATED].sort(),
  );
});

test("service_role mantem UPDATE nas cinco — e credencial de servidor", async () => {
  // O par negativo do arquivo inteiro. Um `REVOKE ... FROM authenticated,
  // service_role` deixaria o catalogo "seguro" e o bot morto: quem carimba
  // optin, grava o wa_id e move o relogio da janela e o servico Node.
  const semPrivilegio = [];
  for (const coluna of [...FECHADAS, ABERTA]) {
    if (!(await podeAtualizar("service_role", coluna))) semPrivilegio.push(coluna);
  }
  assert.deepEqual(semPrivilegio, []);
});

/* --------------------------------------------------------------------------
 * O UPDATE de verdade, pela sessao que o PostgREST produz
 * -------------------------------------------------------------------------- */

/**
 * Os dois testes abaixo existem porque `has_column_privilege` responde sobre o
 * CATALOGO, e o que se quer garantir e o DESFECHO: a linha e do proprio
 * titular, a politica `clientes_dono_atualiza` (0006) a autoriza, e mesmo assim
 * o comando tem de morrer na coluna. Sem eles, uma politica nova amanha poderia
 * abrir um caminho que a asercao de catalogo nao ve.
 */

test("UPDATE real do proprio wa_id, como authenticated, recusa com 42501", async () => {
  const erro = await comoPapel(
    bd.pool,
    { papel: "authenticated", sub: ANA },
    (cliente) =>
      cliente
        .query(
          "UPDATE canastra.clientes SET whatsapp_wa_id = $1 WHERE user_id = $2",
          ["5535988887777", ANA],
        )
        .then(() => null, (e) => e),
  );
  // SQLSTATE, nunca o texto: /permission denied/ casaria tambem com um GRANT
  // esquecido numa migracao, que e o bug OPOSTO deste.
  assert.equal(erro?.code, PERMISSAO_NEGADA);
});

test("o mesmo UPDATE em `whatsapp_optout_em` passa e atinge a linha", async () => {
  const afetadas = await comoPapel(
    bd.pool,
    { papel: "authenticated", sub: ANA },
    async (cliente) => {
      const r = await cliente.query(
        "UPDATE canastra.clientes SET whatsapp_optout_em = now() WHERE user_id = $1",
        [ANA],
      );
      return r.rowCount;
    },
  );
  // `rowCount`, e nao so "nao lancou": um UPDATE que a RLS filtra para zero
  // linhas tambem nao lanca, e seria um opt-out que nao desinscreve ninguem.
  assert.equal(afetadas, 1);
});

/* --------------------------------------------------------------------------
 * A exportacao do Art. 18 (acesso), em lgpd.routes.js
 * -------------------------------------------------------------------------- */

test("a exportacao devolve os cinco campos de WhatsApp do cadastro", async () => {
  await bd.pool.query(
    `UPDATE canastra.clientes
        SET whatsapp_wa_id = '5535988887777',
            whatsapp_optin_em = now(),
            whatsapp_promo_optin_em = now(),
            whatsapp_optout_em = now(),
            whatsapp_ultima_entrada_em = now()
      WHERE user_id = $1`,
    [ANA],
  );

  const res = await exportar(ANA);

  assert.equal(res.codigo, 200);
  assert.equal(res.corpo.cliente.whatsapp_wa_id, "5535988887777");
  for (const campo of [...FECHADAS, ABERTA].filter((c) => c !== "whatsapp_wa_id")) {
    assert.notEqual(
      res.corpo.cliente[campo],
      undefined,
      `${campo} faz parte do que a loja guarda sobre a pessoa`,
    );
    assert.notEqual(res.corpo.cliente[campo], null, `${campo} foi carimbado`);
  }
});

test("a exportacao traz as mensagens do titular — e so as dele", async () => {
  await bd.pool.query(
    `INSERT INTO canastra.whatsapp_mensagens
       (user_id, telefone_final, template, status, enviado_em, entregue_em)
     VALUES
       ($1, '0000', 'pedido_aprovado', 'entregue', now(), now()),
       ($1, '0000', 'pedido_enviado',  'enviada',  now(), NULL),
       ($2, '1111', 'pedido_aprovado', 'entregue', now(), now())`,
    [ANA, BRUNO],
  );

  const res = await exportar(ANA);

  assert.equal(res.codigo, 200);
  const mensagens = res.corpo.whatsapp_mensagens;
  assert.equal(mensagens.length, 2, "as duas do titular, e nenhuma do vizinho");
  assert.deepEqual(
    mensagens.map((m) => m.template).sort(),
    ["pedido_aprovado", "pedido_enviado"],
  );
  // O que a pessoa tem direito de saber: com que numero a loja falou, o que
  // mandou, quando e se chegou.
  assert.deepEqual(
    [...new Set(mensagens.map((m) => m.telefone_final))],
    ["0000"],
    "o telefone_final do vizinho nao pode aparecer aqui",
  );
  assert.ok(mensagens.every((m) => m.criado_em instanceof Date));
  assert.ok(mensagens.some((m) => m.status === "entregue"));
});

test("titular sem mensagem nenhuma recebe lista vazia, nunca erro", async () => {
  // Um cadastro que nunca recebeu WhatsApp e o caso mais comum de um pedido de
  // acesso — e um `undefined` aqui viraria 500 em cima de uma pergunta legitima.
  const res = await exportar(CLARA);

  assert.equal(res.codigo, 200);
  assert.deepEqual(res.corpo.whatsapp_mensagens, []);
  assert.equal(res.corpo.cliente.whatsapp_wa_id, null);
});
