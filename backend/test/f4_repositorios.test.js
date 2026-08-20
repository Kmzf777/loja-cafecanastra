"use strict";

/**
 * F4 — os repositories contra o schema `canastra.*` de verdade.
 *
 * O que este arquivo afirma, em uma frase por bloco:
 *  - pedidos gravam em `canastra.pedidos` e a chave de idempotência não deixa
 *    o mesmo clique virar dois pedidos;
 *  - os catches mentirosos morreram: erro de banco REJEITA em vez de virar
 *    lista vazia/null;
 *  - cada repositório devolve o CONTRATO antigo (product_id, price, zip_code,
 *    applies_to...) lendo as colunas em português;
 *  - as rotas de clientes do painel voltaram, no formato que o
 *    RegisteredClients.jsx consome, e só enxergam clientes DESTA loja.
 *
 * Require dos módulos de `src/` DENTRO do before(), depois de DATABASE_URL
 * apontar para o cluster efêmero (padrão de autenticacao.test.js).
 */

const { test, before, after, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const { subirPostgres } = require("./ajuda/postgres.js");
const { aplicarMigracoes } = require("../db/migrar.js");

let bd;
let OrderRepository;
let AddressRepository;
let DashboardRepository;
let OptionsRepository;
let PromotionsRepository;
let ConfigRepository;
let conta;

const ANA = "aaaaaaaa-0000-0000-0000-000000000001";
const DORA = "dddddddd-0000-0000-0000-000000000004";

/** Dublê de `res` no padrão de autenticacao.test.js, com send() para o 204. */
function respostaFalsa() {
  const res = { codigo: null, corpo: null };
  res.status = (codigo) => {
    res.codigo = codigo;
    return res;
  };
  res.sendStatus = (codigo) => {
    res.codigo = codigo;
    return res;
  };
  res.json = (corpo) => {
    if (res.codigo === null) res.codigo = 200;
    res.corpo = corpo;
    return res;
  };
  res.send = () => res;
  return res;
}

before(async () => {
  bd = await subirPostgres();
  await aplicarMigracoes(bd.pool);

  await bd.pool.query(
    `INSERT INTO auth.users (id, email) VALUES
       ($1, 'ana@ex.com'), ($2, 'dora@ex.com')`,
    [ANA, DORA],
  );
  await bd.pool.query(
    `INSERT INTO canastra.clientes (user_id, nome, telefone) VALUES
       ($1, 'Ana', '35999990000'), ($2, 'Dora', NULL)`,
    [ANA, DORA],
  );
  await bd.pool.query("INSERT INTO canastra.admins (user_id) VALUES ($1)", [DORA]);
  await bd.pool.query("INSERT INTO canastra.config_loja (id) VALUES (1)");

  process.env.DATABASE_URL = bd.connectionString;

  OrderRepository = require("../src/repositories/ordersRepository.js");
  AddressRepository = require("../src/repositories/addressRepository.js");
  DashboardRepository = require("../src/repositories/dashboardRepository.js");
  OptionsRepository = require("../src/repositories/optionsRepository.js");
  PromotionsRepository = require("../src/repositories/promotionsRepository.js");
  ConfigRepository = require("../src/repositories/configRepository.js");
  conta = require("../src/routes/conta.routes.js");
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

/* --------------------------------------------------------------------------
 * Pedidos
 * -------------------------------------------------------------------------- */

test("createOrder grava em canastra.pedidos e devolve o contrato antigo", async () => {
  const pedido = await OrderRepository.createOrder({
    userId: ANA,
    totalAmount: 54.9,
    items: [{ product_id: "11111111-0000-0000-0000-000000000001", quantity: 2 }],
    paymentMethod: "pix",
    paymentIdMp: "MP-REPO-1",
    address_json: { zip_code: "35012345", street: "Rua X" },
    shippingCost: 12.5,
    shippingMethod: "Correios PAC",
    chaveIdempotencia: "clique-1",
  });

  // O contrato: nomes em inglês, como o painel e a vitrine consomem.
  assert.ok(pedido.order_id);
  assert.equal(pedido.status, "pendente");
  assert.equal(Number(pedido.total_amount), 54.9);
  assert.equal(pedido.payment_method, "pix");
  assert.equal(pedido.shipping_method, "Correios PAC");
  assert.equal(pedido.idempotency_key, "clique-1");

  // E a linha existe MESMO, nas colunas em português.
  const { rows } = await bd.pool.query(
    `SELECT status, total, metodo_pagamento, chave_idempotencia
       FROM canastra.pedidos WHERE pedido_id = $1`,
    [pedido.order_id],
  );
  assert.equal(rows.length, 1);
  assert.equal(rows[0].status, "pendente");
  assert.equal(rows[0].chave_idempotencia, "clique-1");
});

test("a mesma chave de idempotência NÃO cria segundo pedido (23505)", async () => {
  await assert.rejects(
    () =>
      OrderRepository.createOrder({
        userId: ANA,
        totalAmount: 54.9,
        items: [],
        paymentMethod: "pix",
        paymentIdMp: "MP-REPO-2",
        address_json: null,
        shippingCost: 0,
        shippingMethod: "Retirada",
        chaveIdempotencia: "clique-1",
      }),
    (erro) => {
      assert.equal(erro.code, "23505");
      assert.match(erro.message, /pedidos_idempotencia_idx/);
      return true;
    },
  );

  const existente = await OrderRepository.getOrderByIdempotencyKey("clique-1");
  assert.equal(existente.payment_id_mp, "MP-REPO-1");
});

test("o catch mentiroso morreu: erro de banco REJEITA em vez de devolver null/[]", async () => {
  // A versão anterior fazia `catch { return null }` / `catch { return [] }`:
  // um uuid malformado (ou o banco fora do ar) virava "pedido não existe" e
  // "você não tem pedidos" — mentira apresentada com cara de verdade. Agora o
  // 22P02 sobe e o controller responde 500 com log.
  await assert.rejects(
    () => OrderRepository.getOrderById("nao-e-uuid"),
    (erro) => {
      assert.equal(erro.code, "22P02");
      return true;
    },
  );
  await assert.rejects(
    () => OrderRepository.getOrdersByUser("nao-e-uuid"),
    (erro) => {
      assert.equal(erro.code, "22P02");
      return true;
    },
  );
});

test("getAllOrders junta nome do cliente e e-mail do GoTrue", async () => {
  const pagina = await OrderRepository.getAllOrders(1, 10);
  assert.ok(pagina.total >= 1);
  const doRepo = pagina.data.find((p) => p.order_id);
  assert.equal(doRepo.user_name, "Ana");
  assert.equal(doRepo.user_email, "ana@ex.com");
  assert.ok("shipping_cost" in doRepo && "items" in doRepo && "address" in doRepo);
});

/* --------------------------------------------------------------------------
 * Endereços
 * -------------------------------------------------------------------------- */

test("endereço: upsert em canastra.enderecos com o contrato do checkout", async () => {
  const criado = await AddressRepository.createAddress({
    userId: ANA,
    zipCode: "35012345",
    street: "Rua das Torras",
    number: "42",
    complement: null,
    neighborhood: "Centro",
    city: "Gov. Valadares",
    state: "MG",
  });
  assert.equal(criado.zip_code, "35012345");
  assert.equal(criado.street, "Rua das Torras");
  assert.equal(criado.number, "42");

  // Segunda gravação ATUALIZA a mesma linha, não cria outra.
  await AddressRepository.createAddress({
    userId: ANA,
    zipCode: "35012399",
    street: "Rua Nova",
    number: "7",
    complement: "casa",
    neighborhood: "Centro",
    city: "Gov. Valadares",
    state: "MG",
  });

  const { rows } = await bd.pool.query(
    "SELECT count(*)::int AS n FROM canastra.enderecos WHERE user_id = $1",
    [ANA],
  );
  assert.equal(rows[0].n, 1);

  const lido = await AddressRepository.getAddressByUserId(ANA);
  assert.equal(lido.zip_code, "35012399");

  // E o erro sobe aqui também.
  await assert.rejects(
    () => AddressRepository.getAddressByUserId("nao-e-uuid"),
    (erro) => erro.code === "22P02",
  );
});

/* --------------------------------------------------------------------------
 * Produtos (painel + vitrine leem o MESMO contrato)
 * -------------------------------------------------------------------------- */

test("produto: cria, busca por texto e lê pelo contrato antigo", async () => {
  const repo = new DashboardRepository();

  let res = respostaFalsa();
  await repo.createProduct(
    {
      body: {
        name: "Café Canastra Teste",
        price: 42.9,
        quantity: 10,
        category: "Café moído",
        size: "250 g",
        description: "Torra média, notas de chocolate.",
        sku: "TESTE-250-MOIDO",
      },
      file: undefined,
    },
    res,
  );
  assert.equal(res.codigo, 201);

  // SKU repetido é conflito do pedido, não 500.
  res = respostaFalsa();
  await repo.createProduct(
    {
      body: { name: "Duplicata", price: 1, quantity: 1, sku: "TESTE-250-MOIDO" },
      file: undefined,
    },
    res,
  );
  assert.equal(res.codigo, 409);

  // A busca usa o `tsv` gerado em 0003 ('portuguese') + ILIKE no nome.
  res = respostaFalsa();
  await repo.getProducts({ query: { q: "chocolate", limit: "10" } }, res);
  assert.equal(res.codigo, 200);
  assert.ok(res.corpo.total >= 1);
  const produto = res.corpo.products.find((p) => p.sku === "TESTE-250-MOIDO");
  assert.ok(produto, "a busca full-text deveria achar o produto");
  assert.equal(produto.name, "Café Canastra Teste");
  assert.equal(Number(produto.price), 42.9);
  assert.equal(produto.quantity, 10);
  assert.ok(produto.timestamp, "o contrato expõe destacado_em como timestamp");

  res = respostaFalsa();
  await repo.getProductById({ params: { id: produto.product_id } }, res);
  assert.equal(res.codigo, 200);
  assert.equal(res.corpo.category, "Café moído");
  assert.equal(res.corpo.size, "250 g");
});

/* --------------------------------------------------------------------------
 * Opções de filtro (o painel fala inglês, o seed grava português)
 * -------------------------------------------------------------------------- */

test("opções: type=category vira tipo='categoria' e volta traduzido", async () => {
  const repo = new OptionsRepository();

  let res = respostaFalsa();
  await repo.addOption({ body: { type: "category", value: "Kits" } }, res);
  assert.equal(res.codigo, 201);

  // No banco, em português — como o seed de 0003 grava.
  const { rows } = await bd.pool.query(
    "SELECT tipo FROM canastra.produto_opcoes WHERE valor = 'Kits'",
  );
  assert.equal(rows[0].tipo, "categoria");

  // Na resposta, em inglês — como o ManageCategories.jsx espera.
  res = respostaFalsa();
  await repo.getOptions({ query: { type: "category" } }, res);
  assert.equal(res.codigo, 200);
  const kits = res.corpo.find((o) => o.value === "Kits");
  assert.equal(kits.type, "category");

  // Duplicata: 409, não 500.
  res = respostaFalsa();
  await repo.addOption({ body: { type: "category", value: "Kits" } }, res);
  assert.equal(res.codigo, 409);

  // Excluir opção usada por produto é recusado (o produto do teste anterior
  // tem categoria 'Café moído').
  res = respostaFalsa();
  await repo.addOption({ body: { type: "category", value: "Café moído" } }, res);
  assert.equal(res.codigo, 201);

  const { rows: opcao } = await bd.pool.query(
    "SELECT id FROM canastra.produto_opcoes WHERE tipo = 'categoria' AND valor = 'Café moído'",
  );
  res = respostaFalsa();
  await repo.deleteOption({ params: { id: opcao[0].id } }, res);
  assert.equal(res.codigo, 409);

  // Sem produto usando, a exclusão passa.
  const { rows: kitsId } = await bd.pool.query(
    "SELECT id FROM canastra.produto_opcoes WHERE tipo = 'categoria' AND valor = 'Kits'",
  );
  res = respostaFalsa();
  await repo.deleteOption({ params: { id: kitsId[0].id } }, res);
  assert.equal(res.codigo, 204);
});

/* --------------------------------------------------------------------------
 * Promoções
 * -------------------------------------------------------------------------- */

test("promoções: contrato do painel, datas vazias viram NULL", async () => {
  const repo = new PromotionsRepository();

  // O datetime-local manda "" quando vazio; a versão antiga estourava 22007.
  let res = respostaFalsa();
  await repo.createPromotion(
    {
      body: {
        title: "Sem data",
        type: "percent",
        value: 10,
        applies_to: "all",
        start_date: "",
        end_date: "",
      },
    },
    res,
  );
  assert.equal(res.codigo, 201);

  res = respostaFalsa();
  await repo.createPromotion(
    {
      body: {
        title: "Semana do café",
        description: "10% em tudo",
        type: "percent",
        value: 10,
        applies_to: "all",
        start_date: "2020-01-01T00:00",
        end_date: "2099-12-31T23:59",
      },
    },
    res,
  );
  assert.equal(res.codigo, 201);

  res = respostaFalsa();
  await repo.getPromotions({}, res);
  assert.equal(res.codigo, 200);
  const promo = res.corpo.find((p) => p.title === "Semana do café");
  assert.equal(promo.type, "percent");
  assert.equal(Number(promo.value), 10);
  assert.equal(promo.applies_to, "all");
  assert.equal(promo.active, true);
  assert.ok(promo.start_date);

  // O checkout só vê a promoção com as duas datas cobrindo o agora — a sem
  // data fica de fora (semântica herdada do legado, mantida de propósito).
  const ativas = await repo.findActivePromotionsForCheckout();
  assert.ok(ativas.some((p) => p.title === "Semana do café"));
  assert.equal(ativas.some((p) => p.title === "Sem data"), false);
});

/* --------------------------------------------------------------------------
 * Config
 * -------------------------------------------------------------------------- */

test("config: contrato antigo + frete_gratis_minimo_centavos no GET", async () => {
  const config = await ConfigRepository.getConfig();
  assert.equal(config.frete_gratis_minimo_centavos, 14900);
  assert.ok("site_title" in config);
  assert.ok("whatsapp_number" in config);
  assert.ok("announcement_bar" in config);

  const res = respostaFalsa();
  await ConfigRepository.updateConfig(
    {
      body: {
        site_title: "Café Canastra",
        whatsapp_number: "5535999990000",
        announcement_bar: "Torramos na terça.",
        frete_gratis_minimo_centavos: 9900,
      },
      files: undefined,
    },
    res,
  );
  assert.equal(res.codigo, 200);

  const depois = await ConfigRepository.getConfig();
  assert.equal(depois.site_title, "Café Canastra");
  assert.equal(depois.frete_gratis_minimo_centavos, 9900);
});

/* --------------------------------------------------------------------------
 * Resumo do painel
 * -------------------------------------------------------------------------- */

test("summary: contagens reais e status do gráfico em português", async () => {
  const repo = new DashboardRepository();
  const resumo = await repo.getDashboardSummary();

  assert.ok(resumo.counts.products >= 1);
  assert.ok(resumo.counts.orders >= 1);
  assert.equal(resumo.counts.users, 2);
  for (const linha of resumo.statusChart) {
    assert.match(
      linha.status,
      /^(pendente|aprovado|em_processamento|autorizado|enviado|entregue|cancelado|rejeitado|reembolsado)$/,
    );
  }
});

/* --------------------------------------------------------------------------
 * Clientes do painel (rotas recriadas)
 * -------------------------------------------------------------------------- */

test("listarClientes devolve o formato do RegisteredClients.jsx", async () => {
  const res = respostaFalsa();
  await conta.listarClientes({ query: { page: "1", limit: "10" } }, res, {
    conexao: bd.pool,
  });
  assert.equal(res.codigo, 200);

  const { users, total, totalPages, page } = res.corpo;
  assert.equal(total, 2);
  assert.equal(totalPages, 1);
  assert.equal(page, 1);

  const ana = users.find((u) => u.user_id === ANA);
  assert.ok(ana, "Ana deveria estar na lista");
  assert.equal(ana.id, ANA);
  assert.equal(ana.name, "Ana");
  assert.equal(ana.email, "ana@ex.com");
  assert.equal(ana.phone, "35999990000");

  const { rows } = await bd.pool.query(
    "SELECT count(*)::int AS n FROM canastra.pedidos WHERE user_id = $1",
    [ANA],
  );
  assert.equal(ana.purchases, rows[0].n);
});

test("excluir cliente pelo admin: 404 fora da loja, 409 último admin, 503 sem chave", async () => {
  // Usuária de OUTRO projeto da instância: existe em auth.users, não é
  // cliente da loja — o painel desta loja não pode apagá-la.
  const ESTRANHA = "eeeeeeee-0000-0000-0000-000000000005";
  await bd.pool.query(
    "INSERT INTO auth.users (id, email) VALUES ($1, 'estranha@outro.com')",
    [ESTRANHA],
  );

  let res = respostaFalsa();
  await conta.excluirClientePeloAdmin(
    { params: { id: ESTRANHA } },
    res,
    { conexao: bd.pool, buscar: async () => ({ ok: true, status: 200 }) },
  );
  assert.equal(res.codigo, 404);

  // Dora é a única admin: excluí-la deixaria a loja sem quem administre.
  res = respostaFalsa();
  await conta.excluirClientePeloAdmin(
    { params: { id: DORA } },
    res,
    { conexao: bd.pool, buscar: async () => ({ ok: true, status: 200 }) },
  );
  assert.equal(res.codigo, 409);
  assert.match(res.corpo.message, /administrador/i);

  // Sem a service key não há como apagar no GoTrue — 503, nunca sucesso falso.
  res = respostaFalsa();
  await conta.excluirClientePeloAdmin(
    { params: { id: ANA } },
    res,
    { conexao: bd.pool, ambiente: {} },
  );
  assert.equal(res.codigo, 503);

  // id que nem uuid é: 400 antes de tocar o banco.
  res = respostaFalsa();
  await conta.excluirClientePeloAdmin({ params: { id: "me" } }, res, {
    conexao: bd.pool,
  });
  assert.equal(res.codigo, 400);
});

test("excluir cliente pelo admin: o caminho feliz chama a Admin API certa", async () => {
  const chamadas = [];
  const res = respostaFalsa();
  await conta.excluirClientePeloAdmin(
    { params: { id: ANA } },
    res,
    {
      conexao: bd.pool,
      ambiente: {
        SUPABASE_URL: "http://kong.local:8000/",
        SUPABASE_SERVICE_ROLE_KEY: "chave-de-teste",
      },
      buscar: async (url, opcoes) => {
        chamadas.push({ url, metodo: opcoes.method, headers: opcoes.headers });
        return { ok: true, status: 200 };
      },
    },
  );

  assert.equal(res.codigo, 200);
  assert.equal(chamadas.length, 1);
  assert.equal(chamadas[0].url, `http://kong.local:8000/auth/v1/admin/users/${ANA}`);
  assert.equal(chamadas[0].metodo, "DELETE");
  // O Kong exige `apikey`, o GoTrue exige o Bearer — os DOIS vão.
  assert.equal(chamadas[0].headers.apikey, "chave-de-teste");
  assert.equal(chamadas[0].headers.Authorization, "Bearer chave-de-teste");
});
