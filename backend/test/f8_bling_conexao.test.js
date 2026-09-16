"use strict";

/**
 * F8 — a configuração do Bling sai da env e vai para o banco.
 *
 * O QUE ESTE ARQUIVO PROVA: `carregarConfig()` lê `bling_client_id`,
 * `bling_client_secret`, `bling_ativo` e `bling_refresh_token` de
 * `canastra.config_loja` na ordem BANCO → ENV, e o `NULL` de `bling_ativo`
 * significa "não decidido — use a env", nunca `false`.
 *
 * Essa distinção é o coração da migração 0039 e por isso ganha DOIS casos
 * (um para o NULL, um para o `false` gravado): sem ela, a migração desligaria
 * em silêncio toda instalação que hoje tem `BLING_ATIVO=true` no `.env` — o
 * banco passaria a mandar em todo mundo no instante em que a coluna nasceu.
 *
 * SEM DUBLÊ DE BANCO, e pelo mesmo motivo de f7: a precedência é uma decisão
 * que só existe contra um SELECT de verdade, e um mock devolveria exatamente o
 * que o teste mandou devolver. Sobe o MESMO Postgres embutido de
 * `test/ajuda/postgres.js` que todas as outras suítes usam.
 *
 * A SEGUNDA METADE DO ARQUIVO é o fluxo OAuth (`blingConexao.js`): o `state` de
 * uso único, a URL de autorização e a troca do `code` pelo par de tokens. Só o
 * `fetch` é dublado ali — o Bling é do lado de fora e não há como pedir a ele um
 * `code` de verdade num teste; a gravação continua indo ao Postgres real, que é
 * justamente o que se quer provar.
 */

const { test, before, after, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const { subirPostgres } = require("./ajuda/postgres.js");
const { aplicarMigracoes } = require("../db/migrar.js");

let bd;
/** O pool do harness. `blingClient` fala com o MESMO banco, pelo src/pgPool. */
let pool;
let blingClient;
let blingConexao;

before(async () => {
  bd = await subirPostgres();
  await aplicarMigracoes(bd.pool);
  await bd.pool.query(
    "INSERT INTO canastra.config_loja (id) VALUES (1) ON CONFLICT (id) DO NOTHING",
  );
  pool = bd.pool;

  // A ORDEM IMPORTA: `src/pgPool.js` lê DATABASE_URL no instante do require, e
  // quem o puxa aqui é o próprio blingClient. Requerer antes de exportar a URL
  // daria um pool apontado para lugar nenhum — mesma ordem de f7_bling.test.js.
  process.env.DATABASE_URL = bd.connectionString;
  process.env.NODE_ENV = "development";

  blingClient = require("../src/services/blingClient.js");
  blingConexao = require("../src/services/blingConexao.js");
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

test("carregarConfig: o banco tem precedencia sobre a env", async () => {
  process.env.BLING_CLIENT_ID = "id-da-env";
  process.env.BLING_CLIENT_SECRET = "segredo-da-env";
  await pool.query(
    `INSERT INTO canastra.config_loja (id, bling_client_id, bling_client_secret)
     VALUES (1, 'id-do-banco', 'segredo-do-banco')
     ON CONFLICT (id) DO UPDATE SET bling_client_id = EXCLUDED.bling_client_id,
                                    bling_client_secret = EXCLUDED.bling_client_secret`,
  );
  blingClient.zerarCacheParaTeste();

  const config = await blingClient.carregarConfig();
  assert.equal(config.clientId, "id-do-banco");
  assert.equal(config.clientSecret, "segredo-do-banco");
});

test("carregarConfig: sem linha no banco, cai na env", async () => {
  process.env.BLING_CLIENT_ID = "id-da-env";
  process.env.BLING_CLIENT_SECRET = "segredo-da-env";
  await pool.query(
    `UPDATE canastra.config_loja
        SET bling_client_id = NULL, bling_client_secret = NULL WHERE id = 1`,
  );
  blingClient.zerarCacheParaTeste();

  const config = await blingClient.carregarConfig();
  assert.equal(config.clientId, "id-da-env");
  assert.equal(config.clientSecret, "segredo-da-env");
});

test("carregarConfig: bling_ativo NULL quer dizer 'use a env'", async () => {
  process.env.BLING_ATIVO = "true";
  await pool.query("UPDATE canastra.config_loja SET bling_ativo = NULL WHERE id = 1");
  blingClient.zerarCacheParaTeste();
  assert.equal((await blingClient.carregarConfig()).ativo, true);

  process.env.BLING_ATIVO = "false";
  blingClient.zerarCacheParaTeste();
  assert.equal((await blingClient.carregarConfig()).ativo, false);
});

test("carregarConfig: bling_ativo=false no banco VENCE a env ligada", async () => {
  process.env.BLING_ATIVO = "true";
  await pool.query("UPDATE canastra.config_loja SET bling_ativo = false WHERE id = 1");
  blingClient.zerarCacheParaTeste();
  assert.equal((await blingClient.carregarConfig()).ativo, false);
});

test("configurado() responde pelo que ha no banco", async () => {
  delete process.env.BLING_CLIENT_ID;
  delete process.env.BLING_CLIENT_SECRET;
  await pool.query(
    `UPDATE canastra.config_loja
        SET bling_client_id = 'id', bling_client_secret = 'segredo' WHERE id = 1`,
  );
  blingClient.zerarCacheParaTeste();

  /*
    DIVERGÊNCIA DELIBERADA DO PLANO, e ela vale um parágrafo.

    O plano escreveu `assert.equal(await blingClient.configurado(), true)` com
    `configurado()` virando `async`. Isso é IMPOSSÍVEL de conciliar com
    `f7_bling.test.js:753`, que faz `assert.equal(blingClient.configurado(),
    false)` — sem `await`, e com `node:assert/strict`, onde `equal` É
    `strictEqual`. Uma Promise nunca é `false` em igualdade estrita, e manter os
    22 casos de f7 passando SEM tocar no arquivo é o critério que valida esta
    entrega. Os dois não cabem: ou `configurado()` devolve Promise (e f7
    reprova), ou devolve booleano (e o `await` do plano não faz o banco chegar
    sozinho). f7 vence.

    Então `configurado()` continuou SÍNCRONA, respondendo pela config JÁ
    CARREGADA, e a porta assíncrona — a que vai ao banco — é `carregarConfig()`.
    O teste ficou MAIS FORTE do que o do plano em vez de mais fraco: prova a
    precedência do banco (segunda asserção, com a env apagada, o que só o
    SELECT explica) E prova a fronteira entre as duas funções (primeira
    asserção), que é justamente o que alguém mexendo aqui precisa saber.
  */
  assert.equal(
    blingClient.configurado(),
    false,
    "cache frio: `configurado()` só enxerga a env, e ela está vazia",
  );

  await blingClient.carregarConfig();
  assert.equal(
    blingClient.configurado(),
    true,
    "carregada a config, a credencial do BANCO é quem responde",
  );
});

/* ------------------------------------------------------------------------ *
 * O FLUXO OAUTH — `src/services/blingConexao.js`
 *
 * O `state` é a ÚNICA autenticação que o callback tem: ele é um redirect de
 * navegador vindo do Bling, e redirect não carrega `Authorization`. Por isso os
 * quatro primeiros casos abaixo cercam o `state` por todos os lados — uso único,
 * desconhecido, vazio, nulo e vencido —, e não só o caminho feliz.
 * ------------------------------------------------------------------------ */

test("gerarState devolve states distintos e imprevisiveis", () => {
  const a = blingConexao.gerarState();
  const b = blingConexao.gerarState();
  assert.notEqual(a, b);
  assert.ok(a.length >= 32);
});

test("consumirState aceita uma vez e RECUSA a segunda", () => {
  const s = blingConexao.gerarState();
  assert.equal(blingConexao.consumirState(s), true);
  assert.equal(blingConexao.consumirState(s), false);
});

test("consumirState recusa state desconhecido, vazio e nulo", () => {
  assert.equal(blingConexao.consumirState("inventado"), false);
  assert.equal(blingConexao.consumirState(""), false);
  assert.equal(blingConexao.consumirState(null), false);
});

test("consumirState recusa state vencido", () => {
  const s = blingConexao.gerarState();
  blingConexao.envelhecerStatesParaTeste();
  assert.equal(blingConexao.consumirState(s), false);
});

test("urlDeAutorizacao aponta para www.bling.com.br e leva o state", async () => {
  await pool.query(
    `UPDATE canastra.config_loja SET bling_client_id = 'meu-id' WHERE id = 1`,
  );
  blingClient.zerarCacheParaTeste();
  const { url, state } = await blingConexao.urlDeAutorizacao();
  const u = new URL(url);
  assert.equal(u.hostname, "www.bling.com.br");
  assert.equal(u.searchParams.get("response_type"), "code");
  assert.equal(u.searchParams.get("client_id"), "meu-id");
  assert.equal(u.searchParams.get("state"), state);
});

test("trocarCodePorTokens grava o refresh token e nao devolve segredo", async () => {
  const fetchFalso = async () =>
    new Response(JSON.stringify({ refresh_token: "novo-refresh", access_token: "a", expires_in: 21600 }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });

  const r = await blingConexao.trocarCodePorTokens("um-code", { fetchImpl: fetchFalso });
  assert.equal(r.conectado, true);
  assert.equal(JSON.stringify(r).includes("novo-refresh"), false);

  const { rows } = await pool.query(
    "SELECT bling_refresh_token FROM canastra.config_loja WHERE id = 1",
  );
  assert.equal(rows[0].bling_refresh_token, "novo-refresh");
});

test("trocarCodePorTokens devolve a frase do Bling quando ele recusa", async () => {
  const fetchFalso = async () =>
    new Response(JSON.stringify({ error: { description: "invalid_grant: code expirado" } }), {
      status: 400,
      headers: { "content-type": "application/json" },
    });

  await assert.rejects(
    () => blingConexao.trocarCodePorTokens("velho", { fetchImpl: fetchFalso }),
    (erro) => /code expirado/.test(erro.message),
  );

  const { rows } = await pool.query(
    "SELECT bling_refresh_token FROM canastra.config_loja WHERE id = 1",
  );
  assert.notEqual(rows[0].bling_refresh_token, "");
});

test("desconectar apaga o refresh token e desliga", async () => {
  await blingConexao.desconectar();
  const { rows } = await pool.query(
    "SELECT bling_refresh_token, bling_ativo FROM canastra.config_loja WHERE id = 1",
  );
  assert.equal(rows[0].bling_refresh_token, null);
  assert.equal(rows[0].bling_ativo, false);
});
