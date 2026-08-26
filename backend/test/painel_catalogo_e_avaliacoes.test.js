"use strict";

/**
 * Onda 4 — o catálogo e as avaliações pelo Express.
 *
 * TRÊS DEFEITOS COM NOME, e cada rota daqui existe por causa de um:
 *
 *  1. AJUSTAR ESTOQUE OBRIGAVA A REENVIAR O FORMULÁRIO INTEIRO por multipart,
 *     imagem incluída. É por esse caminho que as medidas do pacote eram
 *     apagadas: o formulário legado manda `weight/width/height/length` sem ter
 *     input para nenhum, `undefined` vira a string "undefined" no FormData, e
 *     a loja passa a cotar frete de uma caixa que não existe. Corrigir uma
 *     unidade de café não pode ter esse alcance.
 *  2. `produtos.custo` NÃO É LEGÍVEL POR `authenticated` (0006) e `RETURNING *`
 *     responde 42501 até para o admin. A 0006 adiou a decisão "para a tarefa
 *     que construir o painel": é esta, e o caminho é a rota admin no Express,
 *     que conecta como dono. A vitrine continua sem ver margem.
 *  3. A TELA DE AVALIAÇÕES FALAVA DIRETO COM O PostgREST, e lá um não-admin
 *     atualiza ZERO linhas SEM ERRO (semântica do `USING`): o toast mentia
 *     sucesso e nada mudava no banco. Um modelo de acesso só, e a contagem de
 *     linhas afetadas volta na resposta.
 *
 * Padrão de vitrine_rotas.test.js: a requisição atravessa a PILHA REAL do
 * router, guardas incluídos, e `DATABASE_URL` é definida ANTES do require.
 */

const { test, before, after, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const jwt = require("jsonwebtoken");
const { subirPostgres } = require("./ajuda/postgres.js");
const { aplicarMigracoes } = require("../db/migrar.js");

let bd;
let productsRoutes;
let painelRoutes;

const ANA = "aaaaaaaa-0000-0000-0000-000000000001"; // cliente
const BETO = "bbbbbbbb-0000-0000-0000-000000000002"; // cliente
const DORA = "dddddddd-0000-0000-0000-000000000004"; // administradora

const P1 = "11111111-0000-0000-0000-0000000000a1";
const P2 = "11111111-0000-0000-0000-0000000000a2";

const SEGREDO = "segredo-de-teste-com-tamanho-suficiente-para-hs256";

function token(sub) {
  return jwt.sign({ sub, role: "authenticated" }, SEGREDO, { expiresIn: "1h" });
}

function respostaFalsa() {
  const res = { codigo: null, corpo: null, cabecalhos: {} };
  let terminar;
  res.terminou = new Promise((resolve) => {
    terminar = resolve;
  });
  res.status = (codigo) => {
    res.codigo = codigo;
    return res;
  };
  res.json = (corpo) => {
    if (res.codigo === null) res.codigo = 200;
    res.corpo = corpo;
    terminar(res);
    return res;
  };
  res.send = (corpo) => {
    if (res.codigo === null) res.codigo = 200;
    res.corpo = corpo;
    terminar(res);
    return res;
  };
  res.sendStatus = (codigo) => {
    res.codigo = codigo;
    terminar(res);
    return res;
  };
  res.setHeader = () => res;
  return res;
}

async function chamar(router, { metodo = "GET", url, corpo, sub = null } = {}) {
  const [caminho, consulta = ""] = url.split("?");
  const query = {};
  for (const [chave, valor] of new URLSearchParams(consulta)) query[chave] = valor;

  const req = {
    method: metodo,
    url,
    originalUrl: url,
    path: caminho,
    query,
    headers: {},
    body: corpo,
  };
  if (sub) req.headers.authorization = `Bearer ${token(sub)}`;

  const res = respostaFalsa();
  const semRota = new Promise((resolve, reject) => {
    router(req, res, (erro) => (erro ? reject(erro) : resolve("SEM ROTA")));
  });

  const desfecho = await Promise.race([res.terminou, semRota]);
  assert.notEqual(
    desfecho,
    "SEM ROTA",
    `nenhuma rota casou com ${metodo} ${url} — a linha de registro sumiu`,
  );
  return res;
}

async function logs() {
  const { rows } = await bd.pool.query(
    `SELECT admin_user_id, acao, entidade, entidade_id, antes, depois
       FROM canastra.admin_log ORDER BY criado_em DESC, acao`,
  );
  return rows;
}

async function produto(id) {
  const { rows } = await bd.pool.query(
    `SELECT nome, preco, custo, quantidade, peso, largura, altura, comprimento,
            imagem, sku, estado
       FROM canastra.produtos WHERE produto_id = $1`,
    [id],
  );
  return rows[0];
}

before(async () => {
  bd = await subirPostgres();
  await aplicarMigracoes(bd.pool);

  await bd.pool.query(
    `INSERT INTO auth.users (id, email) VALUES
       ($1,'ana@ex.com'), ($2,'beto@ex.com'), ($3,'dora@ex.com')`,
    [ANA, BETO, DORA],
  );
  await bd.pool.query(
    `INSERT INTO canastra.clientes (user_id, nome) VALUES
       ($1,'Ana'), ($2,'Beto'), ($3,'Dora')`,
    [ANA, BETO, DORA],
  );
  await bd.pool.query("INSERT INTO canastra.admins (user_id) VALUES ($1)", [DORA]);

  process.env.SUPABASE_JWT_SECRET = SEGREDO;
  process.env.DATABASE_URL = bd.connectionString;

  productsRoutes = require("../src/routes/products.routes.js");
  painelRoutes = require("../src/routes/painel.routes.js");
}, { timeout: 120_000 });

after(async () => {
  await require("../src/pgPool.js").end().catch(() => {});
  await bd?.derrubar();
});

beforeEach(async () => {
  if (!bd) {
    throw new Error(
      "O Postgres nao subiu no before(); a causa real esta no erro daquele hook.",
    );
  }
  await bd.pool.query("TRUNCATE canastra.admin_log");
  await bd.pool.query("DELETE FROM canastra.avaliacoes");
  await bd.pool.query("DELETE FROM canastra.produtos");
  // Um produto com medidas CUSTOMIZADAS: é ele que prova que o ajuste de
  // estoque não passa por cima da caixa.
  await bd.pool.query(
    `INSERT INTO canastra.produtos
       (produto_id, nome, preco, custo, quantidade, peso, largura, altura,
        comprimento, imagem, sku)
     VALUES
       ($1,'Café Clássico 250g', 42.00, 17.50, 10, 1.200, 33, 22, 11,
        'https://cdn/x.jpg','PC-CLASSICO-250'),
       ($2,'Café Suave 500g',    68.00, 28.00,  4, 0.600, 20,  5, 20,
        NULL,'PC-SUAVE-500')`,
    [P1, P2],
  );
});

/* --------------------------------------------------------------------------
 * PATCH /dashboard/:id/estoque
 * -------------------------------------------------------------------------- */

test("PATCH /dashboard/:id/estoque sem token responde 401 de corpo vazio", async () => {
  const res = await chamar(productsRoutes, {
    metodo: "PATCH",
    url: `/dashboard/${P1}/estoque`,
    corpo: { quantity: 3 },
  });
  assert.equal(res.codigo, 401);
  assert.equal(res.corpo, null);
});

test("PATCH /dashboard/:id/estoque de cliente comum responde 403", async () => {
  const res = await chamar(productsRoutes, {
    metodo: "PATCH",
    url: `/dashboard/${P1}/estoque`,
    corpo: { quantity: 3 },
    sub: ANA,
  });
  assert.equal(res.codigo, 403);
});

test("o ajuste de estoque muda a QUANTIDADE e mais nada", async () => {
  // O teste de regressão que o documento de riscos pede, na rota nova: peso,
  // dimensões, imagem, SKU, preço e custo ficam onde estavam. É o defeito que
  // fazia a loja cotar frete errado sem sinal nenhum na tela.
  const antes = await produto(P1);
  const res = await chamar(productsRoutes, {
    metodo: "PATCH",
    url: `/dashboard/${P1}/estoque`,
    corpo: { quantity: 3 },
    sub: DORA,
  });

  assert.equal(res.codigo, 200);
  assert.equal(res.corpo.product_id, P1);
  assert.equal(res.corpo.quantity, 3);

  const depois = await produto(P1);
  assert.equal(depois.quantidade, 3);
  assert.equal(Number(depois.peso), 1.2);
  assert.equal(Number(depois.largura), 33);
  assert.equal(Number(depois.altura), 22);
  assert.equal(Number(depois.comprimento), 11);
  assert.equal(depois.imagem, antes.imagem);
  assert.equal(depois.sku, antes.sku);
  assert.equal(Number(depois.preco), Number(antes.preco));
  assert.equal(Number(depois.custo), Number(antes.custo));
});

test("estoque negativo, fracionário ou ausente recusa com frase e não grava", async () => {
  for (const corpo of [{ quantity: -1 }, { quantity: 1.5 }, { quantity: "dez" }, {}]) {
    const res = await chamar(productsRoutes, {
      metodo: "PATCH",
      url: `/dashboard/${P1}/estoque`,
      corpo,
      sub: DORA,
    });
    assert.equal(res.codigo, 400, `corpo ${JSON.stringify(corpo)} devia recusar`);
    assert.match(res.corpo.message, /inteiro/i);
  }
  assert.equal((await produto(P1)).quantidade, 10);
});

test("estoque em produto inexistente responde 404, e id malformado 400", async () => {
  const inexistente = await chamar(productsRoutes, {
    metodo: "PATCH",
    url: "/dashboard/99999999-0000-0000-0000-000000000999/estoque",
    corpo: { quantity: 1 },
    sub: DORA,
  });
  assert.equal(inexistente.codigo, 404);

  const malformado = await chamar(productsRoutes, {
    metodo: "PATCH",
    url: "/dashboard/nao-e-uuid/estoque",
    corpo: { quantity: 1 },
    sub: DORA,
  });
  assert.equal(malformado.codigo, 400);
});

test("o ajuste de estoque grava antes e depois em admin_log", async () => {
  await chamar(productsRoutes, {
    metodo: "PATCH",
    url: `/dashboard/${P1}/estoque`,
    corpo: { quantity: 7 },
    sub: DORA,
  });

  const [linha] = await logs();
  assert.equal(linha.admin_user_id, DORA);
  assert.equal(linha.acao, "produto_estoque_ajustado");
  assert.equal(linha.entidade, "produto");
  assert.equal(linha.entidade_id, P1);
  assert.equal(linha.antes.quantidade, 10);
  assert.equal(linha.depois.quantidade, 7);
});

/* --------------------------------------------------------------------------
 * O custo, que só o painel vê
 * -------------------------------------------------------------------------- */

test("GET /admin/produtos/:id/custo exige admin", async () => {
  const semToken = await chamar(painelRoutes, { url: `/admin/produtos/${P1}/custo` });
  assert.equal(semToken.codigo, 401);

  const cliente = await chamar(painelRoutes, {
    url: `/admin/produtos/${P1}/custo`,
    sub: ANA,
  });
  assert.equal(cliente.codigo, 403);
});

test("GET /admin/produtos/:id/custo devolve o custo e a margem que ele permite", async () => {
  const res = await chamar(painelRoutes, {
    url: `/admin/produtos/${P1}/custo`,
    sub: DORA,
  });
  assert.equal(res.codigo, 200);
  assert.equal(res.corpo.product_id, P1);
  assert.equal(Number(res.corpo.custo), 17.5);
  assert.equal(Number(res.corpo.price), 42);
});

test("PATCH /admin/produtos/:id/custo grava, e o valor inválido recusa com frase", async () => {
  const ok = await chamar(painelRoutes, {
    metodo: "PATCH",
    url: `/admin/produtos/${P1}/custo`,
    corpo: { custo: 19.9 },
    sub: DORA,
  });
  assert.equal(ok.codigo, 200);
  assert.equal(Number((await produto(P1)).custo), 19.9);

  const [linha] = await logs();
  assert.equal(linha.acao, "produto_custo_alterado");
  assert.equal(linha.entidade_id, P1);
  assert.equal(Number(linha.antes.custo), 17.5);
  assert.equal(Number(linha.depois.custo), 19.9);

  const ruim = await chamar(painelRoutes, {
    metodo: "PATCH",
    url: `/admin/produtos/${P1}/custo`,
    corpo: { custo: -1 },
    sub: DORA,
  });
  assert.equal(ruim.codigo, 400);
  assert.equal(Number((await produto(P1)).custo), 19.9);
});

test("o custo NÃO vaza pela rota pública de produto", async () => {
  // `GET /dashboard/:id` é PÚBLICA de propósito (a vitrine a consome em Server
  // Component, sem sessão). O custo entrando ali publicaria a margem da loja
  // para qualquer visitante — que é exatamente o que 0006 fechou ao dar SELECT
  // por COLUNA em `canastra.produtos`.
  const res = await chamar(productsRoutes, { url: `/dashboard/${P1}` });
  assert.equal(res.codigo, 200);
  assert.equal("custo" in res.corpo, false);
  assert.equal("cost" in res.corpo, false);
});

/* --------------------------------------------------------------------------
 * /admin/avaliacoes — um modelo de acesso só
 * -------------------------------------------------------------------------- */

/**
 * Três avaliações. Os autores VARIAM de propósito: `avaliacoes_uma_por_cafe`
 * (0014) é UNIQUE (user_id, sku) — uma pessoa avalia cada café uma vez só.
 */
async function semear() {
  const ids = [];
  for (const [autor, sku, nota, status, texto] of [
    [ANA, "PC-CLASSICO-250", 5, "pendente", "Café excelente, chegou rápido"],
    [BETO, "PC-CLASSICO-250", 2, "aprovada", "Veio amassado"],
    [ANA, "PC-SUAVE-500", 4, "oculta", "Bom"],
  ]) {
    const { rows } = await bd.pool.query(
      `INSERT INTO canastra.avaliacoes (user_id, sku, nota, texto, status)
       VALUES ($1, $2, $3, $4, $5) RETURNING id`,
      [autor, sku, nota, texto, status],
    );
    ids.push(rows[0].id);
  }
  return ids;
}

test("GET /admin/avaliacoes exige admin", async () => {
  const semToken = await chamar(painelRoutes, { url: "/admin/avaliacoes" });
  assert.equal(semToken.codigo, 401);
  const cliente = await chamar(painelRoutes, { url: "/admin/avaliacoes", sub: ANA });
  assert.equal(cliente.codigo, 403);
});

test("a listagem tem contagem, paginação e filtro por status e por SKU", async () => {
  await semear();

  const tudo = await chamar(painelRoutes, { url: "/admin/avaliacoes", sub: DORA });
  assert.equal(tudo.codigo, 200);
  assert.equal(tudo.corpo.total, 3);
  assert.equal(tudo.corpo.data.length, 3);
  // O nome congelado pela trigger vem junto: é o que a tela de moderação
  // mostra, e é o que sobrevive à exclusão da conta de quem escreveu.
  assert.deepEqual(
    new Set(tudo.corpo.data.map((a) => a.nome_exibicao)),
    new Set(["Ana", "Beto"]),
  );

  const pendentes = await chamar(painelRoutes, {
    url: "/admin/avaliacoes?status=pendente",
    sub: DORA,
  });
  assert.equal(pendentes.corpo.total, 1);

  const porSku = await chamar(painelRoutes, {
    url: "/admin/avaliacoes?sku=PC-SUAVE-500",
    sub: DORA,
  });
  assert.equal(porSku.corpo.total, 1);

  const porTexto = await chamar(painelRoutes, {
    url: "/admin/avaliacoes?q=amassado",
    sub: DORA,
  });
  assert.equal(porTexto.corpo.total, 1);

  const pagina = await chamar(painelRoutes, {
    url: "/admin/avaliacoes?limit=2&page=2",
    sub: DORA,
  });
  assert.equal(pagina.corpo.total, 3);
  assert.equal(pagina.corpo.data.length, 1);
});

test("status fora do vocabulário do banco recusa com a lista, não com 23514", async () => {
  const res = await chamar(painelRoutes, {
    url: "/admin/avaliacoes?status=recusada",
    sub: DORA,
  });
  assert.equal(res.codigo, 400);
  assert.match(res.corpo.error, /oculta/);
});

test("PATCH em lote aprova as duas e devolve a contagem REAL", async () => {
  const [pendente, aprovada] = await semear();

  const res = await chamar(painelRoutes, {
    metodo: "PATCH",
    url: "/admin/avaliacoes",
    corpo: { ids: [pendente, aprovada], status: "aprovada" },
    sub: DORA,
  });
  assert.equal(res.codigo, 200);
  assert.equal(res.corpo.atualizadas, 2);

  const { rows } = await bd.pool.query(
    "SELECT status, moderado_em FROM canastra.avaliacoes WHERE id = ANY($1::uuid[])",
    [[pendente, aprovada]],
  );
  assert.ok(rows.every((r) => r.status === "aprovada"));
  // `moderado_em` é escrito À MÃO: não há trigger de moddatetime neste schema,
  // e sem esta linha a coluna mentiria sobre quando a moderação aconteceu.
  assert.ok(rows.every((r) => r.moderado_em instanceof Date));
});

test("PATCH com id que não existe devolve a contagem menor — o toast não mente", async () => {
  // O defeito de origem: pelo PostgREST, um não-admin atualizava ZERO linhas
  // SEM ERRO (semântica do USING) e a tela anunciava sucesso. Aqui a resposta
  // sempre diz quantas linhas mudaram de verdade.
  const [pendente] = await semear();
  const res = await chamar(painelRoutes, {
    metodo: "PATCH",
    url: "/admin/avaliacoes",
    corpo: {
      ids: [pendente, "99999999-0000-0000-0000-000000000999"],
      status: "oculta",
    },
    sub: DORA,
  });
  assert.equal(res.codigo, 200);
  assert.equal(res.corpo.atualizadas, 1);
  assert.equal(res.corpo.pedidas, 2);
});

test("PATCH recusa lote vazio, id malformado e status inválido", async () => {
  const vazio = await chamar(painelRoutes, {
    metodo: "PATCH",
    url: "/admin/avaliacoes",
    corpo: { ids: [], status: "aprovada" },
    sub: DORA,
  });
  assert.equal(vazio.codigo, 400);

  const malformado = await chamar(painelRoutes, {
    metodo: "PATCH",
    url: "/admin/avaliacoes",
    corpo: { ids: ["nao-e-uuid"], status: "aprovada" },
    sub: DORA,
  });
  assert.equal(malformado.codigo, 400);

  const status = await chamar(painelRoutes, {
    metodo: "PATCH",
    url: "/admin/avaliacoes",
    corpo: { ids: ["99999999-0000-0000-0000-000000000999"], status: "recusada" },
    sub: DORA,
  });
  assert.equal(status.codigo, 400);
});

test("a moderação em lote grava uma linha de auditoria com os ids e o status", async () => {
  const [pendente, aprovada] = await semear();
  await chamar(painelRoutes, {
    metodo: "PATCH",
    url: "/admin/avaliacoes",
    corpo: { ids: [pendente, aprovada], status: "oculta" },
    sub: DORA,
  });

  const [linha] = await logs();
  assert.equal(linha.admin_user_id, DORA);
  assert.equal(linha.acao, "avaliacoes_moderadas");
  assert.equal(linha.entidade, "avaliacao");
  assert.equal(linha.entidade_id, null); // lote: a linha é sobre N avaliações
  assert.deepEqual(new Set(linha.antes.ids), new Set([pendente, aprovada]));
  assert.equal(linha.depois.status, "oculta");
  assert.equal(linha.depois.atualizadas, 2);
});

/* --------------------------------------------------------------------------
 * A ordem de registro e as cinco rotas públicas continuam como estavam
 * -------------------------------------------------------------------------- */

test("GET /dashboard/summary sem token responde 401 — NUNCA 404", async () => {
  // O par que quebra se invertido: `/dashboard/summary` está registrada ANTES
  // de `/dashboard/:id`, e o Express casa na ordem. Invertidas, o summary
  // viraria um produto de id "summary" e responderia 404 PÚBLICO — a rota
  // administrativa sumindo sem 401, sem erro e sem ninguém perceber.
  const res = await chamar(productsRoutes, { url: "/dashboard/summary" });
  assert.equal(res.codigo, 401);
  assert.notEqual(res.codigo, 404);
});

test("as rotas de leitura PÚBLICAS continuam públicas depois da Onda 4", async () => {
  // Parece bug e não é: a vitrine consome estas rotas em Server Component, sem
  // sessão. Pôr `isAdmin` nelas derruba a loja. O que a Onda 4 fez com `custo`
  // é a saída certa quando incomoda expor algo por elas — rota admin NOVA.
  const catalogo = await chamar(productsRoutes, { url: "/dashboard" });
  assert.equal(catalogo.codigo, 200);

  const detalhe = await chamar(productsRoutes, { url: `/dashboard/${P1}` });
  assert.equal(detalhe.codigo, 200);

  const config = await chamar(productsRoutes, { url: "/config" });
  assert.equal(config.codigo, 200);
});

test("index.js monta o router do painel, e monta DEPOIS dos que têm `:id`", () => {
  // A asserção de fonte do mesmo tipo que vitrine_rotas.test.js faz: `index.js`
  // não é carregável num teste (abre porta, confere ambiente e fala com o
  // GoTrue no require), então o que se prende aqui é a linha de montagem.
  const fs = require("node:fs");
  const path = require("node:path");
  const fonte = fs.readFileSync(
    path.join(__dirname, "..", "src", "index.js"),
    "utf8",
  );

  assert.match(fonte, /require\("\.\/routes\/painel\.routes"\)/);
  assert.match(fonte, /app\.use\(painelRoutes\)/);

  // E ela vem DEPOIS de `productsRoutes` e de `paymentRoutes`, que são os dois
  // routers com rotas de `:id` no mesmo espaço de caminhos.
  assert.ok(
    fonte.indexOf("app.use(painelRoutes)") > fonte.indexOf("app.use(productsRoutes)"),
    "o router do painel tem de ser montado DEPOIS de products.routes",
  );
  assert.ok(
    fonte.indexOf("app.use(painelRoutes)") > fonte.indexOf("app.use(paymentRoutes)"),
    "o router do painel tem de ser montado DEPOIS de orders.routes",
  );
});
