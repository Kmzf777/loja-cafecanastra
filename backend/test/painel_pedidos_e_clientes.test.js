"use strict";

/**
 * Onda 4 — as rotas de PEDIDO e CLIENTE que a Onda 5 precisa para desenhar as
 * telas, e o registro de auditoria que toda escrita do painel passa a deixar.
 *
 * O QUE ESTE ARQUIVO PRENDE, na ordem em que dói:
 *
 *  1. `GET /admin/orders/:id` existe. Sem ela, `/dashboard/pedidos/[id]` não
 *     tem deep-link: o detalhe só existia a partir da linha já em memória, e
 *     recarregar a página perdia o pedido.
 *  2. `GET /admin/orders` filtra por status, período e busca. Uma tela com
 *     filtro sobre uma página de 100 linhas MENTE — ela filtra o que carregou,
 *     não o que existe, e o `total` que a paginação mostra é o total errado.
 *  3. `GET /auth/users` faz o mesmo com clientes.
 *  4. A ORDEM DE REGISTRO CONTINUA INTACTA: `/admin/orders/export` responde
 *     CSV e não cai como `:id` (o Express casa na ordem, e `export` é um id
 *     perfeitamente válido para uma rota de `:id` registrada antes).
 *  5. A exportação de dado pessoal deixou de ser um botão que baixa a base
 *     inteira em silêncio: sem datas exige confirmação explícita, tem teto de
 *     linhas, tem período máximo, e SEMPRE grava em `admin_log` quem exportou,
 *     quando e com que filtro (LGPD art. 6º, X — prestação de contas).
 *  6. Toda rota de ESCRITA grava `admin_log`. O teste é por rota e não por
 *     trigger pela razão que a 0035 anotou: o painel escreve pelo pool do
 *     Express, como dono e sem claim, então `auth.uid()` num trigger seria NULL
 *     e todo log sairia sem autor — que é a única coluna que a tabela existe
 *     para guardar.
 *
 * PADRÃO DE vitrine_rotas.test.js: as requisições atravessam a PILHA REAL do
 * router (guardas incluídos), com `req`/`res` de mentira. É isso que faz "sem
 * token responde 401" ser uma afirmação sobre a ROTA, e não sobre o
 * `isAuthenticated` — um dia em que alguém montar a rota sem os guardas, um
 * teste de repositório continuaria verde e este fica vermelho.
 *
 * E `process.env.DATABASE_URL` é definida ANTES do `require` dos módulos de
 * `src/`: o `pgPool` lê a variável no momento do require.
 */

const { test, before, after, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const jwt = require("jsonwebtoken");
const { subirPostgres } = require("./ajuda/postgres.js");
const { aplicarMigracoes } = require("../db/migrar.js");
const { BOM } = require("../src/utils/csvDePedidos.js");

let bd;
let paymentRoutes;
let contaRoutes;

const ANA = "aaaaaaaa-0000-0000-0000-000000000001"; // cliente
const BETO = "bbbbbbbb-0000-0000-0000-000000000002"; // cliente
const DORA = "dddddddd-0000-0000-0000-000000000004"; // administradora

const P1 = "11111111-0000-0000-0000-0000000000a1";

let pedidoDaAna; // entregue, com cupom
let pedidoDoBeto; // pendente
let pedidoAntigo; // 2020, da Ana
let pedidoLimite; // 23:59 de 2026-09-10 em São Paulo

const SEGREDO = "segredo-de-teste-com-tamanho-suficiente-para-hs256";

function token(sub) {
  return jwt.sign({ sub, role: "authenticated" }, SEGREDO, { expiresIn: "1h" });
}

/** Dublê de `res`: status/json/send/sendStatus/setHeader + `terminou`. */
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
  res.setHeader = (nome, valor) => {
    res.cabecalhos[String(nome).toLowerCase()] = valor;
    return res;
  };
  return res;
}

/** Uma requisição pela pilha real de um router montado SEM prefixo. */
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

/** As linhas de auditoria, mais novas primeiro. */
async function logs() {
  const { rows } = await bd.pool.query(
    `SELECT admin_user_id, acao, entidade, entidade_id, antes, depois
       FROM canastra.admin_log ORDER BY criado_em DESC, acao`,
  );
  return rows;
}

async function inserirPedido({ userId, status, criadoEm, total = 100, cupom = null }) {
  const { rows } = await bd.pool.query(
    `INSERT INTO canastra.pedidos
       (user_id, total, status, criado_em, itens, cupom_codigo, desconto,
        metodo_pagamento, frete)
     VALUES ($1, $2, $3, COALESCE($4::timestamptz, now()), $5::jsonb, $6, 0, 'pix', 10)
     RETURNING pedido_id`,
    [
      userId,
      total,
      status,
      criadoEm,
      JSON.stringify([
        { product_id: P1, name: "Café Clássico 250g", price: 42, quantity: 1, size: "250g" },
      ]),
      cupom,
    ],
  );
  return rows[0].pedido_id;
}

before(async () => {
  bd = await subirPostgres();
  await aplicarMigracoes(bd.pool);

  await bd.pool.query(
    `INSERT INTO auth.users (id, email) VALUES
       ($1,'ana@ex.com'), ($2,'beto@outro.com'), ($3,'dora@ex.com')`,
    [ANA, BETO, DORA],
  );
  await bd.pool.query(
    `INSERT INTO canastra.clientes (user_id, nome, cpf, telefone) VALUES
       ($1,'Ana Ribeiro','52998224725','31988887777'),
       ($2,'Beto Silva', NULL, '11999996666'),
       ($3,'Dora Gestora', NULL, NULL)`,
    [ANA, BETO, DORA],
  );
  await bd.pool.query("INSERT INTO canastra.admins (user_id) VALUES ($1)", [DORA]);
  await bd.pool.query(
    `INSERT INTO canastra.produtos (produto_id, nome, preco, quantidade, sku)
     VALUES ($1, 'Café Clássico 250g', 42.00, 10, 'PC-CLASSICO-250')`,
    [P1],
  );

  // DATA EXPLÍCITA, e não `now()`. Os testes de período deste arquivo filtram
  // janelas ABSOLUTAS de setembro de 2026, e um pedido nascido em `now()` entra
  // sozinho na janela no dia em que o calendário chega lá. Foi exatamente o que
  // aconteceu: a suíte passou até 31/08/2026 e amanheceu vermelha em 01/09 sem
  // ninguém tocar no código — a exportação da janela 01/09–30/09 registrou
  // `linhas: 3` no lugar de `linhas: 1`, porque estes dois pedidos passaram a
  // ser de setembro. Agosto de 2026 os mantém "recentes" e FORA de toda janela
  // que este arquivo afirma, inclusive a de 10/09 (que quebraria daqui a nove
  // dias pelo mesmo motivo). Só `pedidoLimite` é de setembro, e é o ponto.
  pedidoDaAna = await inserirPedido({
    userId: ANA,
    status: "entregue",
    criadoEm: "2026-08-20T15:00:00Z",
    cupom: "CAFE10",
  });
  pedidoDoBeto = await inserirPedido({
    userId: BETO,
    status: "pendente",
    criadoEm: "2026-08-21T15:00:00Z",
  });
  pedidoAntigo = await inserirPedido({
    userId: ANA,
    status: "aprovado",
    criadoEm: "2020-03-15T12:00:00Z",
  });
  // 23:59 de 10/09/2026 em São Paulo = 02:59 do dia 11 em UTC. É o pedido que
  // um `<= ate` ingênuo (ou um filtro em UTC) joga para o dia errado.
  pedidoLimite = await inserirPedido({
    userId: BETO,
    status: "enviado",
    criadoEm: "2026-09-11T02:59:00Z",
  });

  process.env.SUPABASE_JWT_SECRET = SEGREDO;
  process.env.DATABASE_URL = bd.connectionString;

  paymentRoutes = require("../src/routes/orders.routes.js");
  contaRoutes = require("../src/routes/conta.routes.js").contaRoutes;
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
  delete process.env.PEDIDOS_EXPORT_TETO;
  delete process.env.PEDIDOS_EXPORT_DIAS_MAX;
});

/* --------------------------------------------------------------------------
 * GET /admin/orders/:id — o deep-link do detalhe
 * -------------------------------------------------------------------------- */

test("GET /admin/orders/:id sem token responde 401 de corpo vazio", async () => {
  const res = await chamar(paymentRoutes, { url: `/admin/orders/${pedidoDaAna}` });
  assert.equal(res.codigo, 401);
  // `sendStatus` — corpo VAZIO. Quem consumir precisa de `.json().catch(...)`.
  assert.equal(res.corpo, null);
});

test("GET /admin/orders/:id de cliente comum responde 403", async () => {
  const res = await chamar(paymentRoutes, {
    url: `/admin/orders/${pedidoDaAna}`,
    sub: ANA,
  });
  assert.equal(res.codigo, 403);
});

test("GET /admin/orders/:id devolve a MESMA linha da listagem, com cliente e Bling", async () => {
  const res = await chamar(paymentRoutes, {
    url: `/admin/orders/${pedidoDaAna}`,
    sub: DORA,
  });
  assert.equal(res.codigo, 200);
  const pedido = res.corpo.order;
  assert.equal(pedido.order_id, pedidoDaAna);
  // Os campos que a tela de detalhe mostra e que `COLUNAS_DO_CONTRATO` (o
  // contrato do CLIENTE) não tem: sem eles o deep-link mostraria menos que a
  // linha da lista, e o gestor voltaria para a listagem para ver o cliente.
  assert.equal(pedido.user_name, "Ana Ribeiro");
  assert.equal(pedido.user_email, "ana@ex.com");
  assert.equal(pedido.user_cpf, "52998224725");
  assert.equal(pedido.coupon_code, "CAFE10");
  assert.ok("bling_id" in pedido);
  assert.ok("nfe_chave" in pedido);
  assert.ok(Array.isArray(pedido.items));
});

test("GET /admin/orders/:id com id malformado responde 400, não 500", async () => {
  // Sem a guarda, o texto ia intacto para o `$1::uuid`, levantava 22P02 e
  // virava "Erro interno" — a frase de servidor quebrado para um pedido errado.
  const res = await chamar(paymentRoutes, { url: "/admin/orders/nao-e-uuid", sub: DORA });
  assert.equal(res.codigo, 400);
  assert.match(res.corpo.error, /inválido/i);
});

test("GET /admin/orders/:id inexistente responde 404", async () => {
  const res = await chamar(paymentRoutes, {
    url: "/admin/orders/99999999-0000-0000-0000-000000000999",
    sub: DORA,
  });
  assert.equal(res.codigo, 404);
});

test("A ORDEM DE REGISTRO: /admin/orders/export continua CSV e não vira id", async () => {
  // O par que quebra se invertido. `export` é um id perfeitamente válido para
  // uma rota `:id` registrada antes dela — e o sintoma seria 400
  // "Identificador de pedido inválido" no lugar do arquivo.
  const res = await chamar(paymentRoutes, {
    url: "/admin/orders/export?de=2026-01-01&ate=2026-12-31",
    sub: DORA,
  });
  assert.equal(res.codigo, 200);
  assert.match(res.cabecalhos["content-type"], /text\/csv/);
  assert.ok(String(res.corpo).startsWith(BOM));
});

/* --------------------------------------------------------------------------
 * GET /admin/orders — filtro de verdade, no banco
 * -------------------------------------------------------------------------- */

test("filtro por status devolve só o status pedido — e o total é o do FILTRO", async () => {
  const res = await chamar(paymentRoutes, {
    url: "/admin/orders?status=entregue",
    sub: DORA,
  });
  assert.equal(res.codigo, 200);
  assert.equal(res.corpo.data.length, 1);
  assert.equal(res.corpo.data[0].order_id, pedidoDaAna);
  // O total é o que a paginação mostra. Se ele continuasse sendo o total geral,
  // a tela diria "1 de 4" e ofereceria páginas vazias.
  assert.equal(res.corpo.total, 1);
});

test("filtro por status aceita mais de um, separados por vírgula", async () => {
  const res = await chamar(paymentRoutes, {
    url: "/admin/orders?status=entregue,pendente",
    sub: DORA,
  });
  assert.equal(res.corpo.total, 2);
});

test("status fora do vocabulário responde 400 com a lista, não filtra em silêncio", async () => {
  // O painel legado ainda fala inglês em alguns pontos; um `?status=delivered`
  // ignorado em silêncio exportaria/filtraria a base inteira achando que
  // filtrou — o mesmo defeito que a validação de datas do export já fecha.
  const res = await chamar(paymentRoutes, {
    url: "/admin/orders?status=delivered",
    sub: DORA,
  });
  assert.equal(res.codigo, 400);
  assert.match(res.corpo.error, /entregue/);
});

test("filtro por período usa o dia de São Paulo e é inclusivo no fim", async () => {
  const res = await chamar(paymentRoutes, {
    url: "/admin/orders?de=2026-09-10&ate=2026-09-10",
    sub: DORA,
  });
  assert.equal(res.corpo.total, 1);
  assert.equal(res.corpo.data[0].order_id, pedidoLimite);
});

test("filtro por período recusa data malformada com frase", async () => {
  const res = await chamar(paymentRoutes, { url: "/admin/orders?de=10/09/2026", sub: DORA });
  assert.equal(res.codigo, 400);
  assert.match(res.corpo.error, /YYYY-MM-DD/);
});

test("busca acha por nome do cliente, por e-mail e pelo número do pedido", async () => {
  const porNome = await chamar(paymentRoutes, { url: "/admin/orders?q=Ribeiro", sub: DORA });
  assert.equal(porNome.corpo.total, 2); // os dois pedidos da Ana

  const porEmail = await chamar(paymentRoutes, {
    url: "/admin/orders?q=beto@outro.com",
    sub: DORA,
  });
  assert.equal(porEmail.corpo.total, 2); // os dois do Beto

  const porNumero = await chamar(paymentRoutes, {
    url: `/admin/orders?q=${pedidoAntigo}`,
    sub: DORA,
  });
  assert.equal(porNumero.corpo.total, 1);
  assert.equal(porNumero.corpo.data[0].order_id, pedidoAntigo);
});

test("busca e status se combinam com E, não com OU", async () => {
  const res = await chamar(paymentRoutes, {
    url: "/admin/orders?q=Ribeiro&status=aprovado",
    sub: DORA,
  });
  assert.equal(res.corpo.total, 1);
  assert.equal(res.corpo.data[0].order_id, pedidoAntigo);
});

/* --------------------------------------------------------------------------
 * GET /auth/users — a mesma história, para clientes
 * -------------------------------------------------------------------------- */

test("a lista de clientes busca por nome, e-mail, telefone e CPF", async () => {
  const porNome = await chamar(contaRoutes, { url: "/users?q=Beto", sub: DORA });
  assert.equal(porNome.codigo, 200);
  assert.equal(porNome.corpo.total, 1);
  assert.equal(porNome.corpo.users[0].name, "Beto Silva");

  const porEmail = await chamar(contaRoutes, { url: "/users?q=ana@ex.com", sub: DORA });
  assert.equal(porEmail.corpo.total, 1);

  const porCpf = await chamar(contaRoutes, { url: "/users?q=52998224725", sub: DORA });
  assert.equal(porCpf.corpo.total, 1);

  const porTelefone = await chamar(contaRoutes, { url: "/users?q=999996666", sub: DORA });
  assert.equal(porTelefone.corpo.total, 1);
});

test("a busca de clientes sem resultado devolve lista vazia e total 0, não a base", async () => {
  const res = await chamar(contaRoutes, { url: "/users?q=zzzzzz", sub: DORA });
  assert.equal(res.corpo.total, 0);
  assert.deepEqual(res.corpo.users, []);
});

/* --------------------------------------------------------------------------
 * A exportação: teto, período e auditoria
 * -------------------------------------------------------------------------- */

test("sem datas e sem confirmação, a exportação RECUSA com frase", async () => {
  // O defeito de origem: as datas vazias baixavam a base inteira com CPF e
  // e-mail de todos os clientes, sem confirmação e sem registro.
  const res = await chamar(paymentRoutes, { url: "/admin/orders/export", sub: DORA });
  assert.equal(res.codigo, 400);
  assert.match(res.corpo.error, /CPF/i);
  assert.match(res.corpo.error, /confirmar/i);
  assert.equal((await logs()).length, 0, "recusa não é exportação: nada a registrar");
});

test("sem datas, com confirmar=true, exporta e registra a confirmação", async () => {
  const res = await chamar(paymentRoutes, {
    url: "/admin/orders/export?confirmar=true",
    sub: DORA,
  });
  assert.equal(res.codigo, 200);
  assert.ok(String(res.corpo).startsWith(BOM));

  const [linha] = await logs();
  assert.equal(linha.admin_user_id, DORA);
  assert.equal(linha.entidade, "pedidos");
  assert.equal(linha.depois.confirmada, true);
  assert.equal(linha.depois.de, null);
  assert.equal(linha.depois.ate, null);
  assert.equal(linha.depois.linhas, 4);
});

test("acima do teto de linhas a exportação recusa com frase e não exporta", async () => {
  process.env.PEDIDOS_EXPORT_TETO = "2";
  const res = await chamar(paymentRoutes, {
    url: "/admin/orders/export?confirmar=true",
    sub: DORA,
  });
  assert.equal(res.codigo, 400);
  assert.match(res.corpo.error, /teto/i);
  // A frase diz QUANTAS linhas e qual o teto — sem os dois números, "reduza o
  // período" é um conselho sem medida.
  assert.match(res.corpo.error, /4/);
  assert.equal((await logs()).length, 0);
});

test("período maior que o máximo recusa com frase", async () => {
  process.env.PEDIDOS_EXPORT_DIAS_MAX = "31";
  const res = await chamar(paymentRoutes, {
    url: "/admin/orders/export?de=2026-01-01&ate=2026-12-31",
    sub: DORA,
  });
  assert.equal(res.codigo, 400);
  assert.match(res.corpo.error, /31/);
});

test("toda exportação grava quem exportou, quando e com que filtro", async () => {
  const res = await chamar(paymentRoutes, {
    url: "/admin/orders/export?de=2026-09-01&ate=2026-09-30",
    sub: DORA,
  });
  assert.equal(res.codigo, 200);

  const [linha] = await logs();
  assert.equal(linha.admin_user_id, DORA);
  assert.equal(linha.acao, "pedidos_exportados");
  assert.equal(linha.entidade, "pedidos");
  assert.equal(linha.entidade_id, null); // exportação de LISTA não tem um id
  assert.deepEqual(linha.depois, {
    de: "2026-09-01",
    ate: "2026-09-30",
    linhas: 1,
    confirmada: false,
  });
});

/* --------------------------------------------------------------------------
 * `admin_log` na escrita de pedido
 * -------------------------------------------------------------------------- */

test("PUT /admin/orders/:id/status grava antes e depois em admin_log", async () => {
  const pedido = await inserirPedido({ userId: BETO, status: "pendente", criadoEm: null });
  const res = await chamar(paymentRoutes, {
    metodo: "PUT",
    url: `/admin/orders/${pedido}/status`,
    corpo: { status: "enviado", trackingCode: "BR123" },
    sub: DORA,
  });
  assert.equal(res.codigo, 200);

  const [linha] = await logs();
  assert.equal(linha.admin_user_id, DORA);
  assert.equal(linha.acao, "pedido_status_alterado");
  assert.equal(linha.entidade, "pedido");
  assert.equal(linha.entidade_id, pedido);
  assert.equal(linha.antes.status, "pendente");
  assert.equal(linha.depois.status, "enviado");
  assert.equal(linha.depois.codigo_rastreio, "BR123");
});

test("status recusado não deixa linha de auditoria — não houve mudança", async () => {
  const res = await chamar(paymentRoutes, {
    metodo: "PUT",
    url: `/admin/orders/${pedidoDaAna}/status`,
    corpo: { status: "delivered" },
    sub: DORA,
  });
  assert.equal(res.codigo, 400);
  assert.equal((await logs()).length, 0);
});
