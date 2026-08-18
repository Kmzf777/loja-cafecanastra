"use strict";

/**
 * O middleware de autenticacao, contra um Postgres de verdade.
 *
 * O CASO QUE IMPORTA MAIS TEM NOME, e e o mesmo de rls.test.js: ESTRANHA. Ela
 * tem conta no GoTrue da instancia COMPARTILHADA, token com assinatura
 * perfeita, `sub` preenchido e `role: "authenticated"`. O que ela nao tem e
 * linha em `canastra.clientes`. Se o Express parasse na assinatura — que e o
 * que ele fazia enquanto era o proprio emissor do token —, ela entraria como
 * cliente da loja. O teste dela e o motivo de este arquivo existir.
 *
 * POR QUE POSTGRES DE VERDADE, e nao um dublê do pool: a pergunta sob teste e
 * "existe linha nesta tabela?". Um dublê responderia o que o teste mandasse
 * responder e provaria apenas que o `if` funciona. Com banco real, a resposta
 * vem do mesmo schema que as migracoes criam — se alguem renomear
 * `canastra.clientes`, estes testes caem.
 *
 * O `require` dos middlewares acontece DENTRO do before(), depois de
 * `DATABASE_URL` apontar para o cluster efemero: `src/pgPool.js` le a variavel
 * no momento em que e carregado, e um require no topo do arquivo abriria pool
 * contra o banco de desenvolvimento da maquina.
 */

const { test, before, after, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const jwt = require("jsonwebtoken");
const { subirPostgres } = require("./ajuda/postgres.js");
const { aplicarMigracoes } = require("../db/migrar.js");

/** Cliente comum da loja: linha em `auth.users` E em `canastra.clientes`. */
const ANA = "aaaaaaaa-0000-0000-0000-000000000001";
/** Cliente E administradora — a unica linha de `canastra.admins`. */
const DORA = "dddddddd-0000-0000-0000-000000000004";
/** So em `auth.users`. Usuaria de outro projeto da instancia compartilhada. */
const ESTRANHA = "eeeeeeee-0000-0000-0000-000000000005";

// Precisa ter 32+ caracteres pelo mesmo motivo que o de producao tem: se o
// teste rodasse com segredo curto, a conferencia de ambiente e o teste
// contariam historias diferentes sobre o que e um segredo aceitavel.
const SEGREDO = "segredo-de-teste-do-gotrue-com-32+-caracteres";
const OUTRO_SEGREDO = "segredo-de-outra-instancia-com-32+-caracteres";

let bd;
let isAuthenticated;
let isAdmin;
let conta;

/**
 * Um token como o GoTrue emite: HS256, `sub` com o uuid de `auth.users`,
 * `role: "authenticated"`, `exp` no futuro.
 */
function tokenDe(sub, { segredo = SEGREDO, expiraEm = "1h", ...extras } = {}) {
  return jwt.sign(
    { sub, role: "authenticated", aud: "authenticated", email: "x@ex.com", ...extras },
    segredo,
    { algorithm: "HS256", expiresIn: expiraEm },
  );
}

/**
 * Dublê de `res` que registra o que o middleware respondeu.
 *
 * `sendStatus` e `status().json()` sao os dois caminhos que o codigo usa, e os
 * dois precisam ser distinguiveis: uma recusa com corpo e uma sem corpo tem o
 * mesmo numero e significados operacionais diferentes.
 */
function respostaFalsa() {
  const res = { codigo: null, corpo: null };
  res.sendStatus = (codigo) => {
    res.codigo = codigo;
    return res;
  };
  res.status = (codigo) => {
    res.codigo = codigo;
    return res;
  };
  res.json = (corpo) => {
    res.corpo = corpo;
    return res;
  };
  return res;
}

/** Roda um middleware e devolve o que ele fez: seguiu adiante, ou respondeu. */
async function chamar(middleware, req) {
  const res = respostaFalsa();
  let seguiu = false;
  await middleware(req, res, () => {
    seguiu = true;
  });
  return { seguiu, codigo: res.codigo, corpo: res.corpo, req };
}

const comToken = (token) => ({ headers: { authorization: `Bearer ${token}` } });

before(async () => {
  bd = await subirPostgres();
  await aplicarMigracoes(bd.pool);

  await bd.pool.query(
    `INSERT INTO auth.users (id, email) VALUES
       ($1,'ana@ex.com'), ($2,'dora@ex.com'), ($3,'estranha@outroprojeto.com')`,
    [ANA, DORA, ESTRANHA],
  );
  await bd.pool.query(
    `INSERT INTO canastra.clientes (user_id, nome) VALUES ($1,'Ana'), ($2,'Dora')`,
    [ANA, DORA],
  );
  await bd.pool.query("INSERT INTO canastra.admins (user_id) VALUES ($1)", [DORA]);

  process.env.DATABASE_URL = bd.connectionString;
  process.env.SUPABASE_JWT_SECRET = SEGREDO;
  isAuthenticated = require("../src/middleware/isAuthenticated.js");
  isAdmin = require("../src/middleware/isAdmin.js");
  conta = require("../src/routes/conta.routes.js");
}, { timeout: 120_000 });

after(async () => {
  // O pool do `src/pgPool.js` e outro objeto, apontando para o mesmo cluster:
  // sem fecha-lo, o processo do `node --test` fica de pe segurando conexao.
  await require("../src/pgPool.js").end().catch(() => {});
  await bd?.derrubar();
});

beforeEach(() => {
  // Sem esta guarda, um before() que falha faz CADA teste morrer num erro
  // derivado e a causa real some.
  if (!bd) {
    throw new Error(
      "O Postgres nao subiu no before(); a causa real esta no erro daquele hook.",
    );
  }
});

/* --------------------------------------------------------------------------
 * O vinculo: assinatura valida nao e pertencimento
 * -------------------------------------------------------------------------- */

test("cliente com linha em canastra.clientes entra", async () => {
  const r = await chamar(isAuthenticated, comToken(tokenDe(ANA)));

  assert.equal(r.seguiu, true);
  assert.equal(r.codigo, null);
  // `userId` e o nome que PaymentController, OrderController e AddressController
  // leem. Renomear aqui desamarra o pedido de quem esta logado.
  assert.equal(r.req.user.userId, ANA);
  assert.equal(r.req.user.ehAdmin, false);
});

test("ESTRANHA tem token perfeito e NAO entra: falta a linha em clientes", async () => {
  // O teste mais importante do arquivo. A instancia Supabase e compartilhada
  // com outros projetos: um `auth.users` e um segredo de JWT para todos. Este
  // token e legitimo — foi emitido pelo mesmo GoTrue, com o mesmo segredo, e
  // passaria por qualquer verificacao de assinatura. Se este teste ficar verde
  // com `seguiu: true`, a loja aceita como cliente qualquer usuario dos outros
  // projetos da VPS.
  const r = await chamar(isAuthenticated, comToken(tokenDe(ESTRANHA)));

  assert.equal(r.seguiu, false);
  assert.equal(r.codigo, 403);
  // 403 e nao 401 de proposito: a credencial nao venceu, ela nao serve aqui.
  // Renovar o token nao muda nada, e um cliente que trate isto como "expirou"
  // entra num laco de renovacao.
  assert.match(r.corpo.message, /vinculada/i);
});

test("uuid inexistente no banco tambem nao entra", async () => {
  // Mesma recusa da ESTRANHA por outro caminho: aqui nem em `auth.users` ha
  // linha. Prova que a consulta de vinculo nao depende da existencia previa da
  // conta para negar.
  const r = await chamar(
    isAuthenticated,
    comToken(tokenDe("ffffffff-0000-0000-0000-00000000000f")),
  );

  assert.equal(r.seguiu, false);
  assert.equal(r.codigo, 403);
});

/* --------------------------------------------------------------------------
 * A assinatura e o formato do token
 * -------------------------------------------------------------------------- */

test("token EXPIRADO responde 401, e nao 403", async () => {
  // A distincao continua carregando peso depois da troca de emissor: o
  // `supabase-js` renova pelo refresh token e repete a chamada quando ve 401, e
  // nao tem o que fazer com 403 alem de desistir. Com 403 para tudo, a sessao
  // morre no meio sem mensagem e sem levar ninguem ao login.
  const vencido = jwt.sign({ sub: ANA, role: "authenticated" }, SEGREDO, {
    algorithm: "HS256",
    expiresIn: "-10s",
  });

  const r = await chamar(isAuthenticated, comToken(vencido));

  assert.equal(r.seguiu, false);
  assert.equal(r.codigo, 401);
});

test("token assinado com OUTRO segredo e recusado", async () => {
  const r = await chamar(isAuthenticated, comToken(tokenDe(ANA, { segredo: OUTRO_SEGREDO })));

  assert.equal(r.seguiu, false);
  assert.equal(r.codigo, 403);
});

test("token sem `sub` (as chaves de API da instancia) e recusado", async () => {
  // A `anon key` e a `service_role key` sao JWT assinados com ESTE MESMO
  // segredo — `jwt.verify` aprova as duas. O que elas nao tem e `sub`. Sem esta
  // recusa, o `sub` indefinido chegaria na consulta de vinculo.
  const anonKey = jwt.sign({ role: "anon", iss: "supabase" }, SEGREDO, {
    algorithm: "HS256",
    expiresIn: "10y",
  });

  const r = await chamar(isAuthenticated, comToken(anonKey));

  assert.equal(r.seguiu, false);
  assert.equal(r.codigo, 403);
});

test("sem cabecalho Authorization responde 401", async () => {
  const r = await chamar(isAuthenticated, { headers: {} });

  assert.equal(r.seguiu, false);
  assert.equal(r.codigo, 401);
});

/* --------------------------------------------------------------------------
 * O papel: `canastra.admins`, nunca um claim
 * -------------------------------------------------------------------------- */

test("claim de admin NAO faz admin: sem linha em canastra.admins, isAdmin recusa", async () => {
  // Ana e cliente de verdade, entao ela ATRAVESSA o isAuthenticated — e e por
  // isso que este caso testa o isAdmin, e nao a porta de entrada. O token dela
  // carrega todo claim de administrador que um projeto vizinho conseguiria
  // inventar. Nenhum deles e lido.
  const token = tokenDe(ANA, {
    user_role: "admin",
    is_admin: true,
    app_metadata: { role: "admin", claims_admin: true },
  });

  const entrada = await chamar(isAuthenticated, comToken(token));
  assert.equal(entrada.seguiu, true, "Ana e cliente: deveria passar pela autenticacao");
  assert.equal(entrada.req.user.ehAdmin, false);

  const r = await chamar(isAdmin, entrada.req);

  assert.equal(r.seguiu, false);
  assert.equal(r.codigo, 403);
});

test("`role: \"admin\"` no topo do token nem chega ao isAdmin", async () => {
  // Complemento do caso acima, e a razao de ele existir separado: `role` e o
  // claim que o PostgREST usa para trocar de papel no banco, e esta API so
  // aceita "authenticated". Um token com `role: "admin"` e recusado na entrada,
  // antes de qualquer pergunta sobre privilegio.
  const r = await chamar(isAuthenticated, comToken(tokenDe(ANA, { role: "admin" })));

  assert.equal(r.seguiu, false);
  assert.equal(r.codigo, 403);
});

test("quem TEM linha em canastra.admins passa pelo isAdmin", async () => {
  const entrada = await chamar(isAuthenticated, comToken(tokenDe(DORA)));
  assert.equal(entrada.req.user.ehAdmin, true);

  const r = await chamar(isAdmin, entrada.req);

  assert.equal(r.seguiu, true);
  assert.equal(r.codigo, null);
});

test("isAdmin falha FECHADO quando nao houve isAuthenticated antes", async () => {
  const r = await chamar(isAdmin, { headers: {} });

  assert.equal(r.seguiu, false);
  assert.equal(r.codigo, 403);
});

/* --------------------------------------------------------------------------
 * Excluir a propria conta: a loja nao pode ficar sem administrador
 * -------------------------------------------------------------------------- */

test("o unico administrador nao consegue excluir a propria conta", async () => {
  // A garantia de verdade e a trigger `admins_nunca_zero` (0002), que dispara
  // na cascata de `auth.users`. Ela levantaria 23001 dentro da transacao do
  // GoTrue e voltaria como 500 opaco; o que esta sob teste aqui e a frase que a
  // pessoa le, e o fato de o GoTrue nem ser chamado.
  let chamouGoTrue = false;
  const res = respostaFalsa();

  await conta.excluirMinhaConta({ user: { userId: DORA } }, res, {
    buscar: async () => {
      chamouGoTrue = true;
      return { ok: true, status: 200 };
    },
    ambiente: { SUPABASE_URL: "http://kong", SUPABASE_SERVICE_ROLE_KEY: "chave" },
  });

  assert.equal(res.codigo, 409);
  assert.equal(res.corpo.message, conta.MENSAGEM_ULTIMO_ADMIN);
  assert.equal(chamouGoTrue, false, "nada deveria ter sido pedido ao GoTrue");
});

test("cliente comum exclui a propria conta pela Admin API do GoTrue", async () => {
  let pedido;
  const res = respostaFalsa();

  await conta.excluirMinhaConta({ user: { userId: ANA } }, res, {
    buscar: async (url, opcoes) => {
      pedido = { url, opcoes };
      return { ok: true, status: 200 };
    },
    ambiente: { SUPABASE_URL: "http://kong/", SUPABASE_SERVICE_ROLE_KEY: "chave" },
  });

  assert.equal(res.codigo, 200);
  // O id vem de `req.user`, nunca de parametro de rota: e a diferenca entre
  // "excluir minha conta" e "excluir a conta de qualquer um".
  assert.equal(pedido.url, `http://kong/auth/v1/admin/users/${ANA}`);
  assert.equal(pedido.opcoes.method, "DELETE");
  // O Kong exige `apikey`; o GoTrue exige o Bearer. Faltando um dos dois, a
  // chamada volta 401 e a conta nao e apagada.
  assert.equal(pedido.opcoes.headers.apikey, "chave");
  assert.equal(pedido.opcoes.headers.Authorization, "Bearer chave");
});

test("sem SUPABASE_URL/SERVICE_ROLE a exclusao falha alto, e nao finge sucesso", async () => {
  const res = respostaFalsa();

  await conta.excluirMinhaConta({ user: { userId: ANA } }, res, {
    buscar: async () => assert.fail("nao deveria chamar o GoTrue sem credencial"),
    ambiente: {},
  });

  assert.equal(res.codigo, 503);
});
