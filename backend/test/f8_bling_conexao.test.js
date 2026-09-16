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
 *
 * A TERCEIRA PARTE são as ROTAS de `/bling/conexao` num Express de verdade, com
 * a cadeia inteira de middlewares. Não é cerimônia: o 401 de quem não tem
 * sessão, o 400 do corpo vazio, o 409 de ligar sem conexão e — sobretudo — o
 * callback PÚBLICO que só age com `state` vivo são decisões que moram NA ROTA.
 * Chamar o serviço direto (como faz a segunda parte) não passa por nenhuma
 * delas. O padrão de subir o app e assinar o token de admin é copiado de
 * `f7_bling.test.js`; um segundo jeito de fazer isso não ajudaria ninguém.
 */

const { test, before, after, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const express = require("express");
const jwt = require("jsonwebtoken");
const { subirPostgres } = require("./ajuda/postgres.js");
const { aplicarMigracoes } = require("../db/migrar.js");

let bd;
/** O pool do harness. `blingClient` fala com o MESMO banco, pelo src/pgPool. */
let pool;
let blingClient;
let blingConexao;
let blingPedidos;
let servidor;
let urlDaApi;
let tokenDeAdmin;
let blingFalso;

/** A Ana: cliente desta loja E administradora — `isAdmin` lê o BANCO. */
const ANA = "aaaaaaaa-0000-0000-0000-000000000008";

/**
 * O "BLING" DESTA SUÍTE É UM SERVIDOR HTTP LOCAL, e não um `fetchImpl` injetado.
 *
 * A segunda parte do arquivo injeta o `fetch` porque chama o serviço direto.
 * Aqui quem chama é a ROTA, e ela não tem (nem deve ter) um parâmetro de teste:
 * abrir um ponto de injeção na assinatura HTTP só para o teste alcançar seria
 * código de produção existindo para o teste. `BLING_API_URL` já é
 * sobrescritível — é a mesma porta que `baseDaApi()` usa —, então apontá-la
 * para 127.0.0.1 exercita a rota INTEIRA, fetch nativo incluído, sem sair para
 * a internet.
 */
const blingFalsoResponde = { status: 200, json: {} };
/** O que foi pedido ao "Bling": evidência de que a troca de token aconteceu. */
const chamadasAoBlingFalso = [];

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

  blingFalso = http.createServer((req, res) => {
    let corpo = "";
    req.on("data", (pedaco) => {
      corpo += pedaco;
    });
    req.on("end", () => {
      chamadasAoBlingFalso.push({ caminho: req.url, corpo });
      res.writeHead(blingFalsoResponde.status, {
        "content-type": "application/json",
      });
      res.end(JSON.stringify(blingFalsoResponde.json));
    });
  });
  await new Promise((pronto) => blingFalso.listen(0, "127.0.0.1", pronto));
  process.env.BLING_API_URL = `http://127.0.0.1:${blingFalso.address().port}`;

  blingClient = require("../src/services/blingClient.js");
  blingConexao = require("../src/services/blingConexao.js");
  blingPedidos = require("../src/services/blingPedidos.js");

  // O token é HS256 do `SUPABASE_JWT_SECRET`, o caminho self-hosted que é o
  // alvo de produção; a Ana entra em `canastra.admins` porque `isAdmin` lê o
  // BANCO, nunca um claim (e `isAuthenticated` exige a linha em `clientes`).
  await pool.query("INSERT INTO auth.users (id, email) VALUES ($1, 'ana@ex.com')", [
    ANA,
  ]);
  await pool.query(
    "INSERT INTO canastra.clientes (user_id, nome, cpf) VALUES ($1, 'Ana', '52998224725') ON CONFLICT (user_id) DO NOTHING",
    [ANA],
  );
  await pool.query("INSERT INTO canastra.admins (user_id) VALUES ($1)", [ANA]);
  process.env.SUPABASE_JWT_SECRET = "segredo-de-teste-hs256";
  tokenDeAdmin = jwt.sign(
    { sub: ANA, role: "authenticated", email: "ana@ex.com" },
    process.env.SUPABASE_JWT_SECRET,
    { expiresIn: "1h" },
  );

  // `express.json()` porque duas das rotas novas recebem corpo — é o mesmo
  // parser que o `index.js` monta antes de `app.use("/bling", ...)`.
  const app = express();
  app.use(express.json());
  app.use("/bling", require("../src/routes/bling.routes.js"));
  await new Promise((pronto) => {
    servidor = app.listen(0, "127.0.0.1", pronto);
  });
  urlDaApi = `http://127.0.0.1:${servidor.address().port}`;
}, { timeout: 120_000 });

after(async () => {
  if (servidor) await new Promise((pronto) => servidor.close(pronto));
  if (blingFalso) await new Promise((pronto) => blingFalso.close(pronto));
  await require("../src/pgPool.js").end().catch(() => {});
  await bd?.derrubar();
});

/**
 * Uma chamada às rotas `/bling`. `admin: true` manda a credencial; sem ela a
 * requisição sai anônima, que é o que prova o 401.
 *
 * `redirect: "manual"` NÃO É DETALHE: o `fetch` do Node segue 302 por padrão, e
 * seguir o do callback pediria `/dashboard/bling` a um Express que não serve a
 * vitrine — a resposta viraria 404 e o `location`, que é justamente o que os
 * testes do callback examinam, sumiria.
 */
async function pedir(metodo, caminho, { admin = false, corpo } = {}) {
  const resposta = await fetch(`${urlDaApi}${caminho}`, {
    method: metodo,
    redirect: "manual",
    headers: {
      ...(admin ? { Authorization: `Bearer ${tokenDeAdmin}` } : {}),
      ...(corpo !== undefined ? { "Content-Type": "application/json" } : {}),
    },
    ...(corpo !== undefined ? { body: JSON.stringify(corpo) } : {}),
  });
  const texto = await resposta.text();
  let json = null;
  try {
    json = texto ? JSON.parse(texto) : null;
  } catch {
    json = texto;
  }
  return {
    status: resposta.status,
    corpo: json,
    cabecalhos: Object.fromEntries(resposta.headers),
  };
}

/** O refresh token gravado, que vários testes comparam antes/depois. */
async function refreshNoBanco() {
  const { rows } = await pool.query(
    "SELECT bling_refresh_token FROM canastra.config_loja WHERE id = 1",
  );
  return rows[0].bling_refresh_token;
}

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

/* ------------------------------------------------------------------------ *
 * AS ROTAS — `src/routes/bling.routes.js`
 *
 * Express de verdade, `isAuthenticated` e `isAdmin` inclusive. O contrato que
 * o frontend já consome está no topo de
 * `docs/superpowers/plans/2026-09-16-conexao-bling.md`.
 * ------------------------------------------------------------------------ */

test("POST /bling/conexao/credenciais grava, e exige admin", async () => {
  const semSessao = await pedir("POST", "/bling/conexao/credenciais", {
    corpo: { clientId: "a", clientSecret: "b" },
  });
  assert.equal(semSessao.status, 401);

  const r = await pedir("POST", "/bling/conexao/credenciais", {
    admin: true,
    corpo: { clientId: "id-do-painel", clientSecret: "segredo-do-painel" },
  });
  assert.equal(r.status, 200);
  assert.equal(r.corpo.salvo, true);

  const { rows } = await pool.query(
    "SELECT bling_client_id, bling_client_secret FROM canastra.config_loja WHERE id = 1",
  );
  assert.equal(rows[0].bling_client_id, "id-do-painel");
  assert.equal(rows[0].bling_client_secret, "segredo-do-painel");

  // A rota esqueceu o cache ao gravar: sem isso, a tela salvaria a credencial
  // nova e a integração seguiria autenticando com a antiga por até 30s.
  assert.equal((await blingClient.carregarConfig()).clientId, "id-do-painel");
});

test("POST /bling/conexao/credenciais recusa corpo vazio com frase util", async () => {
  const r = await pedir("POST", "/bling/conexao/credenciais", {
    admin: true,
    corpo: { clientId: "", clientSecret: "" },
  });
  assert.equal(r.status, 400);
  assert.equal(r.corpo.error, "CREDENCIAIS_INVALIDAS");
  assert.match(r.corpo.message, /Client ID/);

  // E a recusa não apagou o que já estava gravado.
  assert.equal((await blingClient.carregarConfig()).clientId, "id-do-painel");
});

test("POST /bling/conexao/iniciar devolve a URL do Bling, e nao o state", async () => {
  await pool.query(
    `UPDATE canastra.config_loja
        SET bling_client_id = NULL, bling_client_secret = NULL WHERE id = 1`,
  );
  blingClient.zerarCacheParaTeste();
  const sem = await pedir("POST", "/bling/conexao/iniciar", { admin: true });
  assert.equal(sem.status, 409);
  assert.equal(sem.corpo.error, "SEM_CREDENCIAIS");

  // Restaura pelo caminho do gestor: a própria rota de credenciais.
  await pedir("POST", "/bling/conexao/credenciais", {
    admin: true,
    corpo: { clientId: "id-do-painel", clientSecret: "segredo-do-painel" },
  });

  const r = await pedir("POST", "/bling/conexao/iniciar", { admin: true });
  assert.equal(r.status, 200);
  const u = new URL(r.corpo.url);
  assert.equal(u.hostname, "www.bling.com.br");
  assert.equal(u.searchParams.get("client_id"), "id-do-painel");
  assert.ok(u.searchParams.get("state"), "o state viaja DENTRO da URL");
  assert.equal(
    r.corpo.state,
    undefined,
    "e não repetido no corpo: o cliente não tem o que fazer com ele",
  );
});

test("GET /bling/callback SEM state valido nao grava nada", async () => {
  const antes = await refreshNoBanco();
  const chamadasAntes = chamadasAoBlingFalso.length;

  const r = await pedir("GET", "/bling/callback?code=qualquer&state=inventado");
  assert.equal(r.status, 302);
  assert.match(r.cabecalhos.location, /^\/dashboard\/bling\?erro=/);

  assert.equal(await refreshNoBanco(), antes, "nada foi gravado");
  assert.equal(
    chamadasAoBlingFalso.length,
    chamadasAntes,
    "e o `code` nem chegou a ser apresentado ao Bling",
  );
});

test("GET /bling/callback com state valido conecta e redireciona", async () => {
  // O state sai da rota autenticada, como em produção: é ela quem o emite, e
  // provar que o callback público aceita JUSTAMENTE esse é o desenho inteiro.
  const iniciou = await pedir("POST", "/bling/conexao/iniciar", { admin: true });
  const state = new URL(iniciou.corpo.url).searchParams.get("state");

  blingFalsoResponde.status = 200;
  blingFalsoResponde.json = {
    refresh_token: "refresh-do-callback",
    access_token: "access-do-callback",
    expires_in: 21600,
  };

  const r = await pedir("GET", `/bling/callback?code=bom&state=${state}`);
  assert.equal(r.status, 302);
  assert.equal(r.cabecalhos.location, "/dashboard/bling?conectado=1");
  assert.equal(await refreshNoBanco(), "refresh-do-callback");

  // Uso único: o mesmo state de novo é recusado sem tocar em nada.
  blingFalsoResponde.json = { refresh_token: "nao-deveria-gravar" };
  const repetido = await pedir("GET", `/bling/callback?code=bom&state=${state}`);
  assert.match(repetido.cabecalhos.location, /erro=/);
  assert.equal(await refreshNoBanco(), "refresh-do-callback");
});

test("GET /bling/callback nunca poe token na URL de redirecionamento", async () => {
  blingFalsoResponde.status = 200;
  blingFalsoResponde.json = {
    refresh_token: "refresh-ultrassecreto",
    access_token: "access-ultrassecreto",
    expires_in: 21600,
  };
  const state = blingConexao.gerarState();
  const ok = await pedir("GET", `/bling/callback?code=bom&state=${state}`);
  assert.equal(/refresh|token|secret/i.test(ok.cabecalhos.location), false);

  /*
    E O CAMINHO DE ERRO, que é onde mora a tentação de "ajudar no diagnóstico".
    A frase do Bling volta inteira para o gestor ler — é o contrato da tela —,
    então o que este caso cerca são os VALORES: o `code` apresentado, o
    client_secret e o refresh token não podem aparecer numa URL que vai para o
    histórico do navegador, para o log do Traefik e para o `Referer` da página
    seguinte. (A regex do caso feliz não serve aqui: uma frase legítima do Bling
    pode conter a PALAVRA "token" sem vazar valor nenhum.)
  */
  blingFalsoResponde.status = 400;
  blingFalsoResponde.json = { error: { description: "invalid_grant: expirado" } };
  const state2 = blingConexao.gerarState();
  const erro = await pedir(
    "GET",
    `/bling/callback?code=code-ultrassecreto&state=${state2}`,
  );
  const location = erro.cabecalhos.location;
  assert.match(location, /erro=/);
  assert.match(decodeURIComponent(location), /invalid_grant/);
  assert.equal(location.includes("code-ultrassecreto"), false);
  assert.equal(location.includes("segredo-do-painel"), false);
  assert.equal(location.includes("refresh-ultrassecreto"), false);
});

test("POST /bling/conexao/ativo recusa ligar sem conexao", async () => {
  await pool.query(
    "UPDATE canastra.config_loja SET bling_refresh_token = NULL WHERE id = 1",
  );
  blingClient.zerarCacheParaTeste();

  const r = await pedir("POST", "/bling/conexao/ativo", {
    admin: true,
    corpo: { ativo: true },
  });
  assert.equal(r.status, 409);
  assert.equal(r.corpo.error, "SEM_CONEXAO");
  const { rows } = await pool.query(
    "SELECT bling_ativo FROM canastra.config_loja WHERE id = 1",
  );
  assert.notEqual(rows[0].bling_ativo, true, "e a recusa não ligou nada");

  // Com conexão, o interruptor funciona nos dois sentidos.
  await pool.query(
    "UPDATE canastra.config_loja SET bling_refresh_token = 'refresh-vivo' WHERE id = 1",
  );
  blingClient.zerarCacheParaTeste();

  const ligou = await pedir("POST", "/bling/conexao/ativo", {
    admin: true,
    corpo: { ativo: true },
  });
  assert.equal(ligou.status, 200);
  assert.equal(ligou.corpo.ativo, true);
  assert.equal((await blingClient.carregarConfig()).ativo, true);

  const desligou = await pedir("POST", "/bling/conexao/ativo", {
    admin: true,
    corpo: { ativo: false },
  });
  assert.equal(desligou.status, 200);
  assert.equal(desligou.corpo.ativo, false);
  assert.equal((await blingClient.carregarConfig()).ativo, false);
});

test("DELETE /bling/conexao desconecta, e so o admin pode", async () => {
  await pool.query(
    "UPDATE canastra.config_loja SET bling_refresh_token = 'refresh-vivo', bling_ativo = true WHERE id = 1",
  );
  blingClient.zerarCacheParaTeste();

  const semSessao = await pedir("DELETE", "/bling/conexao");
  assert.equal(semSessao.status, 401);
  assert.equal(await refreshNoBanco(), "refresh-vivo", "anônimo não desconecta");

  const r = await pedir("DELETE", "/bling/conexao", { admin: true });
  assert.equal(r.status, 200);
  assert.equal(r.corpo.desconectado, true);

  const { rows } = await pool.query(
    `SELECT bling_refresh_token, bling_ativo, bling_client_id
       FROM canastra.config_loja WHERE id = 1`,
  );
  assert.equal(rows[0].bling_refresh_token, null);
  assert.equal(rows[0].bling_ativo, false, "desconectar TAMBÉM desliga");
  assert.equal(
    rows[0].bling_client_id,
    "id-do-painel",
    "o aplicativo continua cadastrado: desconectar é refazer a autorização",
  );
});

test("GET /bling/status conta a verdade e NAO vaza segredo", async () => {
  await pool.query(
    `UPDATE canastra.config_loja
        SET bling_client_id = 'id', bling_client_secret = 'segredo-secretissimo',
            bling_refresh_token = 'refresh-secretissimo', bling_ativo = true
      WHERE id = 1`,
  );
  blingClient.zerarCacheParaTeste();
  // A sonda do /status renova o access token: o "Bling" local responde por ele.
  blingFalsoResponde.status = 200;
  blingFalsoResponde.json = {
    access_token: "access-de-teste",
    refresh_token: "refresh-secretissimo",
    expires_in: 21600,
  };

  const semSessao = await pedir("GET", "/bling/status");
  assert.equal(semSessao.status, 401);

  const r = await pedir("GET", "/bling/status", { admin: true });
  assert.equal(r.status, 200);
  assert.equal(r.corpo.temCredenciais, true);
  assert.equal(r.corpo.conectado, true);
  assert.equal(r.corpo.ativo, true, "o `ativo` sai do BANCO, não da env");
  assert.equal(r.corpo.configurado, true);
  assert.equal(r.corpo.token.ok, true);

  const inteiro = JSON.stringify(r.corpo);
  assert.equal(inteiro.includes("segredo-secretissimo"), false);
  assert.equal(inteiro.includes("refresh-secretissimo"), false);
  assert.equal(inteiro.includes("access-de-teste"), false);
});

/* ------------------------------------------------------------------------ *
 * O CRON — `rodadaDeRastreio` consulta o BANCO a cada tique
 * ------------------------------------------------------------------------ */

test("o cron nao age com a integracao desligada no banco", async () => {
  // Um pedido que a consulta do cron ENCONTRARIA: tem bling_id, não tem
  // rastreio, está aprovado e é recente. Sem ele o teste passaria por engano,
  // afirmando zero sobre uma fila que já era vazia.
  const { rows } = await pool.query(
    `INSERT INTO canastra.pedidos
       (user_id, total, status, metodo_pagamento, itens, endereco_json,
        frete, metodo_envio, bling_id, codigo_rastreio)
     VALUES ($1, 50, 'aprovado', 'pix', '[]'::jsonb, '{}'::jsonb, 0,
             'Retirada', '999', NULL)
     RETURNING pedido_id`,
    [ANA],
  );
  assert.ok(rows[0].pedido_id);

  // O "Bling" responde um pedido sem volume: a rodada anda inteira e não acha
  // rastreio — é a fila que interessa aqui, não o código.
  blingFalsoResponde.status = 200;
  blingFalsoResponde.json = {
    data: { id: 999, situacao: { valor: "Em aberto" }, transporte: { volumes: [] } },
  };

  await pool.query("UPDATE canastra.config_loja SET bling_ativo = true WHERE id = 1");
  blingClient.zerarCacheParaTeste();
  const ligado = await blingPedidos.rodadaDeRastreio();
  assert.ok(ligado.candidatos > 0, "ligado, o cron enxerga a fila");

  await pool.query("UPDATE canastra.config_loja SET bling_ativo = false WHERE id = 1");
  blingClient.zerarCacheParaTeste();
  const desligado = await blingPedidos.rodadaDeRastreio();
  assert.deepEqual(desligado, { candidatos: 0, atualizados: 0 });
});
