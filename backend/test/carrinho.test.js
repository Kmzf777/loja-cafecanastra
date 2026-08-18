"use strict";

const { test, before, after, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const { subirPostgres } = require("./ajuda/postgres.js");
const { aplicarMigracoes } = require("../db/migrar.js");

let bd;

const ANA = "aaaaaaaa-0000-0000-0000-000000000001";
const CAFE = "cccccccc-0000-0000-0000-000000000001";

/** SQLSTATE `check_violation`. */
const CHECK_VIOLADO = "23514";
/** SQLSTATE `unique_violation`. */
const CHAVE_REPETIDA = "23505";

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

  // TRUNCATE em `auth.users` desce por toda a cascata da loja. `admins` entra na
  // lista pelo motivo anotado em admins.test.js: a trava de 0002 recusa DELETE
  // que zere a tabela, e TRUNCATE e a unica porta que ela nao guarda.
  await bd.pool.query(
    "TRUNCATE auth.users, canastra.clientes, canastra.admins CASCADE",
  );
  await bd.pool.query(
    "INSERT INTO auth.users (id, email) VALUES ($1, 'ana@ex.com')",
    [ANA],
  );
  await bd.pool.query(
    "INSERT INTO canastra.clientes (user_id, nome) VALUES ($1, 'Ana')",
    [ANA],
  );
});

/** Cria o carrinho de Ana e devolve o id. */
async function carrinhoDeAna() {
  const { rows } = await bd.pool.query(
    "INSERT INTO canastra.carrinhos (user_id) VALUES ($1) RETURNING carrinho_id",
    [ANA],
  );
  return rows[0].carrinho_id;
}

test("item de carrinho com quantidade zero ou negativa e recusado", async () => {
  // A regra existia so no codigo do frontend. Um decremento que passe do zero, ou
  // um PATCH direto no PostgREST, gravava quantidade 0 ou -1 — e o total do
  // pedido saia menor que o cobrado. Como CHECK, vale para qualquer caminho.
  const carrinho = await carrinhoDeAna();

  for (const quantidade of [0, -1]) {
    await assert.rejects(
      () =>
        bd.pool.query(
          `INSERT INTO canastra.carrinho_itens (carrinho_id, produto_id, quantidade)
           VALUES ($1, $2, $3)`,
          [carrinho, CAFE, quantidade],
        ),
      (erro) => {
        assert.equal(erro.code, CHECK_VIOLADO);
        return true;
      },
    );
  }

  // E o UPDATE tambem, que e por onde o "diminuir" da sacola passa.
  await bd.pool.query(
    `INSERT INTO canastra.carrinho_itens (carrinho_id, produto_id, quantidade, moagem)
     VALUES ($1, $2, 1, 'Moido')`,
    [carrinho, CAFE],
  );
  await assert.rejects(
    () =>
      bd.pool.query(
        "UPDATE canastra.carrinho_itens SET quantidade = quantidade - 1",
      ),
    (erro) => {
      assert.equal(erro.code, CHECK_VIOLADO);
      return true;
    },
  );
});

test("apagar o cliente leva junto carrinho, itens e enderecos", async () => {
  // Duas cascatas em serie: `clientes` -> `carrinhos` -> `carrinho_itens`. O
  // segundo salto e o que costuma faltar, porque `carrinho_itens` nao referencia
  // o cliente — se ele nao existisse, o item sobreviveria a um carrinho apagado e
  // a tabela viraria lixo que ninguem alcanca.
  const carrinho = await carrinhoDeAna();
  await bd.pool.query(
    `INSERT INTO canastra.carrinho_itens (carrinho_id, produto_id, quantidade, moagem)
     VALUES ($1, $2, 2, 'Moido')`,
    [carrinho, CAFE],
  );
  await bd.pool.query(
    `INSERT INTO canastra.enderecos (user_id, cep, cidade)
     VALUES ($1, '37925-000', 'Piumhi')`,
    [ANA],
  );

  await bd.pool.query("DELETE FROM canastra.clientes WHERE user_id = $1", [ANA]);

  const { rows } = await bd.pool.query(`
    SELECT
      (SELECT count(*)::int FROM canastra.carrinhos)      AS carrinhos,
      (SELECT count(*)::int FROM canastra.carrinho_itens) AS itens,
      (SELECT count(*)::int FROM canastra.enderecos)      AS enderecos
  `);
  assert.deepEqual(rows[0], { carrinhos: 0, itens: 0, enderecos: 0 });
});

test("um cliente tem no maximo um carrinho", async () => {
  // O UNIQUE em `user_id` e o que permite `ON CONFLICT (user_id)` na RPC de fusao
  // da sacola (migracao 0007) sem ler antes de escrever. Sem ele, duas abas
  // abrindo a loja ao mesmo tempo criariam dois carrinhos e um deles sumiria da
  // vista do cliente com itens dentro.
  await carrinhoDeAna();
  await assert.rejects(
    () =>
      bd.pool.query("INSERT INTO canastra.carrinhos (user_id) VALUES ($1)", [ANA]),
    (erro) => {
      assert.equal(erro.code, CHAVE_REPETIDA);
      return true;
    },
  );
});

test("o mesmo produto na mesma moagem soma numa linha so", async () => {
  // A metade que FUNCIONA do UNIQUE (carrinho_id, produto_id, moagem), e a que a
  // RPC de fusao de 0007 usa como alvo do ON CONFLICT.
  const carrinho = await carrinhoDeAna();
  await bd.pool.query(
    `INSERT INTO canastra.carrinho_itens (carrinho_id, produto_id, quantidade, moagem)
     VALUES ($1, $2, 1, 'Moido')`,
    [carrinho, CAFE],
  );

  await assert.rejects(
    () =>
      bd.pool.query(
        `INSERT INTO canastra.carrinho_itens (carrinho_id, produto_id, quantidade, moagem)
         VALUES ($1, $2, 1, 'Moido')`,
        [carrinho, CAFE],
      ),
    (erro) => {
      assert.equal(erro.code, CHAVE_REPETIDA);
      return true;
    },
  );

  // Moagens diferentes SAO itens diferentes — nao e conflito.
  await bd.pool.query(
    `INSERT INTO canastra.carrinho_itens (carrinho_id, produto_id, quantidade, moagem)
     VALUES ($1, $2, 1, 'Graos')`,
    [carrinho, CAFE],
  );
  const { rows } = await bd.pool.query(
    "SELECT count(*)::int AS n FROM canastra.carrinho_itens",
  );
  assert.equal(rows[0].n, 2);
});

test("LIMITE CONHECIDO: sem moagem, o mesmo produto duplica em vez de somar", async () => {
  // Isto NAO e o comportamento desejado; e o comportamento ACEITO nesta fase, e
  // esta aqui escrito em vez de lembrado. No Postgres cada NULL e distinto dos
  // outros num indice unico (NULLS DISTINCT, o padrao), entao a chave
  // (carrinho_id, produto_id, NULL) nunca colide com ela mesma: dois cliques em
  // "adicionar" num produto sem moagem viram DUAS linhas na sacola, e o
  // ON CONFLICT da RPC de 0007 nao dispara.
  //
  // Aceito porque a vitrine sempre manda moagem para cafe — o unico produto com
  // essa variacao. Se um dia entrar item sem moagem nenhuma (caneca, assinatura),
  // isto vira bug visivel: a correcao e `UNIQUE NULLS NOT DISTINCT` (PG 15+) ou
  // um default 'padrao' na coluna. NAO mude a forma do UNIQUE sem ajustar junto o
  // ON CONFLICT de 0007, que depende exatamente desta lista de colunas.
  const carrinho = await carrinhoDeAna();
  await bd.pool.query(
    `INSERT INTO canastra.carrinho_itens (carrinho_id, produto_id, quantidade)
     VALUES ($1, $2, 1), ($1, $2, 1)`,
    [carrinho, CAFE],
  );

  const { rows } = await bd.pool.query(
    "SELECT count(*)::int AS n FROM canastra.carrinho_itens WHERE moagem IS NULL",
  );
  assert.equal(rows[0].n, 2);
});

test("item de carrinho sobrevive ao produto sair do catalogo", async () => {
  // Ausencia de FK para `produtos` e decisao, nao esquecimento: `nome`, `preco` e
  // `imagem` sao copias do momento da adicao. Com FK, tirar um cafe do catalogo
  // esvaziaria (ON DELETE CASCADE) ou travaria (RESTRICT) a sacola de quem ja o
  // tinha dentro. Se alguem "consertar" isto com uma FK, e este teste que grita.
  const carrinho = await carrinhoDeAna();
  await bd.pool.query(
    `INSERT INTO canastra.produtos (produto_id, nome) VALUES ($1, 'Efemero')`,
    [CAFE],
  );
  await bd.pool.query(
    `INSERT INTO canastra.carrinho_itens (carrinho_id, produto_id, quantidade, nome, preco, moagem)
     VALUES ($1, $2, 1, 'Efemero', 54.90, 'Moido')`,
    [carrinho, CAFE],
  );

  await bd.pool.query("DELETE FROM canastra.produtos WHERE produto_id = $1", [CAFE]);

  const { rows } = await bd.pool.query(
    "SELECT nome, preco FROM canastra.carrinho_itens",
  );
  assert.deepEqual(rows, [{ nome: "Efemero", preco: "54.90" }]);
});

test("as tres tabelas de 0004 saem com a RLS ligada e fechadas para anon", async () => {
  // Nada aqui e publico: endereco e carrinho sao dados pessoais. As duas camadas
  // negam — sem GRANT para `anon` (Regra 1 de 0001) e com a chave geral da RLS
  // ligada antes de qualquer politica existir (Regra 2).
  const { rows } = await bd.pool.query(`
    SELECT
      c.relname AS tabela,
      c.relrowsecurity AS ligada,
      has_table_privilege('anon', 'canastra.' || c.relname, 'SELECT') AS anon_le
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'canastra'
      AND c.relname IN ('enderecos', 'carrinhos', 'carrinho_itens')
    ORDER BY c.relname
  `);

  assert.deepEqual(rows, [
    { tabela: "carrinho_itens", ligada: true, anon_le: false },
    { tabela: "carrinhos", ligada: true, anon_le: false },
    { tabela: "enderecos", ligada: true, anon_le: false },
  ]);
});
