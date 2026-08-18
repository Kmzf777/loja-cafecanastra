"use strict";

/**
 * O seed, contra um banco de verdade e contra um GoTrue de mentira.
 *
 * DUAS METADES, E ELAS TEM RISCOS OPOSTOS:
 *
 *  · `semearProdutos` fala so com o Postgres, e o perigo dele e ESCREVER DEMAIS.
 *    O seed roda a cada deploy; um upsert generoso reverte, toda vez, o preco e o
 *    estoque que o administrador acabou de corrigir no painel — sem erro, sem
 *    log, e so descoberto quando um cliente paga o preco velho.
 *
 *  · `semearAdmin` fala com o GoTrue, e o perigo dele e ESCREVER A SENHA ERRADA.
 *    A credencial nao e mais nossa: quem guarda hash agora e o `auth.users` do
 *    Supabase. Se o seed reenviar a senha do `.env` numa conta que ja existe, ele
 *    REBAIXA a senha real do administrador de volta para a do arquivo de deploy.
 *
 * O GOTRUE E INJETADO, E NAO ALCANCADO PELA REDE. Teste que faz requisicao de
 * verdade depende de um servico de pe para dizer se o CODIGO esta certo — e
 * quando falha, nao distingue "a logica esta errada" de "o VPS caiu". O `buscar`
 * daqui e um `fetch` falso que ANOTA cada requisicao, entao da para afirmar a
 * coisa que mais importa e que nenhum teste de rede afirmaria com clareza: que a
 * senha viaja UMA vez, na criacao, e nunca mais.
 */

const { test, before, after, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const { subirPostgres } = require("./ajuda/postgres.js");
const { aplicarMigracoes } = require("../db/migrar.js");
const {
  semearProdutos,
  semearOpcoes,
  semearConfig,
  semearAdmin,
} = require("../db/seed.js");

let bd;

const BASE = "https://supabase.exemplo.test";
const ID_DA_CONTA = "11111111-2222-3333-4444-555555555555";

/** O ambiente minimo em que `semearAdmin` faz alguma coisa. */
const AMBIENTE = Object.freeze({
  SEED_ADMIN_EMAIL: "gestao@cafecanastra.test",
  SEED_ADMIN_PASSWORD: "uma-senha-longa-o-bastante",
  SEED_ADMIN_NAME: "Administração",
  SUPABASE_URL: BASE,
  SUPABASE_SERVICE_ROLE_KEY: "chave-de-servico-falsa",
});

/**
 * Um GoTrue de mentira que anota tudo o que recebe.
 *
 * `criarResponde` decide o desfecho do POST de criacao: 200 (conta nova) ou 422
 * (o e-mail ja existe), que sao os dois unicos caminhos que a Admin API produz
 * aqui. O GET de busca sempre devolve a conta, porque so e alcancado no 422.
 */
function gotrueFalso({ criarResponde = 200 } = {}) {
  const pedidos = [];

  async function buscar(url, opcoes = {}) {
    const corpo = opcoes.body ? JSON.parse(opcoes.body) : null;
    pedidos.push({ url, metodo: opcoes.method || "GET", corpo, cabecalho: opcoes.headers });

    if (opcoes.method === "POST") {
      if (criarResponde === 200) {
        // O GoTrue de verdade cria a linha em `auth.users` como efeito deste
        // POST. Sem reproduzir isso, a FK de `canastra.clientes` recusaria o
        // vinculo e o teste falharia por um motivo que nao e o testado.
        await bd.pool.query(
          "INSERT INTO auth.users (id, email) VALUES ($1, $2) ON CONFLICT (id) DO NOTHING",
          [ID_DA_CONTA, corpo.email],
        );
        return resposta(200, { id: ID_DA_CONTA, email: corpo.email });
      }
      return resposta(422, { code: 422, msg: "email address already registered" });
    }

    return resposta(200, { users: [{ id: ID_DA_CONTA, email: AMBIENTE.SEED_ADMIN_EMAIL }] });
  }

  return { buscar, pedidos };
}

function resposta(status, corpo) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => corpo,
    text: async () => JSON.stringify(corpo),
  };
}

/** Conta o vinculo da conta inicial com a loja. */
async function vinculos() {
  const { rows } = await bd.pool.query(`
    SELECT (SELECT count(*)::int FROM canastra.clientes) AS clientes,
           (SELECT count(*)::int FROM canastra.admins)   AS admins
  `);
  return rows[0];
}

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
  await bd.pool.query("DELETE FROM canastra.produtos");
  // `admins` entra no TRUNCATE pelo motivo anotado em admins.test.js: a trava de
  // 0002 recusa DELETE que zere a tabela, e TRUNCATE e a unica porta que ela nao
  // guarda.
  await bd.pool.query(
    "TRUNCATE auth.users, canastra.clientes, canastra.admins CASCADE",
  );
});

/* ------------------------------------------------------------------------- *
 * Catalogo
 * ------------------------------------------------------------------------- */

test("semear duas vezes nao duplica produto", async () => {
  // A idempotencia vem do UUID v5 derivado do `sku`: o `produto_id` de um SKU e o
  // MESMO em toda execucao e em toda maquina, entao pedido e item de sacola
  // antigos continuam apontando para o lugar certo depois de qualquer reseed.
  const primeira = await semearProdutos(bd.pool);
  const segunda = await semearProdutos(bd.pool);

  const { rows } = await bd.pool.query(
    "SELECT count(*)::int AS n FROM canastra.produtos",
  );
  assert.equal(rows[0].n, primeira.inseridos);
  assert.equal(segunda.inseridos, 0, "a segunda rodada nao insere nada novo");
  assert.equal(segunda.ignorados, primeira.total);
});

test("semear de novo NAO sobrescreve preco editado no painel", async () => {
  // O teste que justifica o `DO NOTHING`. Com `DO UPDATE`, esta segunda semeadura
  // devolveria todo preco ao valor do catalogo versionado — e a loja passaria a
  // cobrar o preco antigo depois de cada deploy, sem ninguem tocar em nada.
  //
  // Preco e estoque pertencem ao PAINEL a partir da primeira semeadura. O
  // catalogo em `data/catalogo-canastra.json` continua sendo a fonte da metade
  // EDITORIAL (nome, descricao, imagem); a metade COMERCIAL fica no banco.
  await semearProdutos(bd.pool);
  await bd.pool.query(
    "UPDATE canastra.produtos SET preco = 999.99 WHERE sku IS NOT NULL",
  );
  await semearProdutos(bd.pool);

  const { rows } = await bd.pool.query(
    "SELECT DISTINCT preco FROM canastra.produtos WHERE sku IS NOT NULL",
  );
  assert.deepEqual(rows, [{ preco: "999.99" }], "preco do painel manda");
});

test("o estoque zerado pela venda tambem sobrevive ao reseed", async () => {
  // Mesmo motivo do preco, e com uma consequencia pior: um `DO UPDATE` devolveria
  // o estoque do catalogo a cada deploy, e a loja voltaria a vender cafe que ja
  // acabou. Vale a asercao propria porque `quantidade` e outra coluna e nada no
  // codigo garante que as duas andem juntas.
  await semearProdutos(bd.pool);
  await bd.pool.query("UPDATE canastra.produtos SET quantidade = 0");
  await semearProdutos(bd.pool);

  const { rows } = await bd.pool.query(
    "SELECT max(quantidade)::int AS maior FROM canastra.produtos",
  );
  assert.equal(rows[0].maior, 0);
});

test("o produto semeado nasce pronto para a vitrine e para o frete", async () => {
  // O seed alimenta o painel e o calculo de frete do checkout. Uma coluna
  // esquecida na renomeacao para o schema `canastra` nao apareceria como erro —
  // apareceria como produto sem descricao no painel e frete calculado com o peso
  // padrao da tabela. Entao as colunas que mudaram de nome sao conferidas.
  await semearProdutos(bd.pool);

  const { rows } = await bd.pool.query(
    `SELECT nome, tamanho, categoria, descricao, imagem,
            preco > 0     AS tem_preco,
            peso > 0      AS tem_peso,
            largura > 0   AS tem_largura,
            altura > 0    AS tem_altura,
            comprimento > 0 AS tem_comprimento,
            destacado_em IS NOT NULL AS tem_destaque
     FROM canastra.produtos
     WHERE sku = 'classico-graos-250'`,
  );

  assert.equal(rows.length, 1);
  const p = rows[0];
  assert.match(p.nome, /Canastra Cl(á|a)ssico/i);
  assert.equal(p.tamanho, "Pacote com 250 g");
  assert.equal(p.categoria, "Café em grãos");
  assert.ok(p.descricao && p.descricao.length > 20, "descricao de vitrine vazia");
  // Absoluta de proposito: o painel resolve caminho relativo contra o BACKEND,
  // que so serve /uploads — as artes vivem em frontend/public, servidas pelo Next.
  assert.match(p.imagem, /^https?:\/\//);
  assert.deepEqual(
    {
      tem_preco: p.tem_preco,
      tem_peso: p.tem_peso,
      tem_largura: p.tem_largura,
      tem_altura: p.tem_altura,
      tem_comprimento: p.tem_comprimento,
      tem_destaque: p.tem_destaque,
    },
    {
      tem_preco: true,
      tem_peso: true,
      tem_largura: true,
      tem_altura: true,
      tem_comprimento: true,
      tem_destaque: true,
    },
  );
});

test("filtros e configuracao da loja tambem sao semeados, e tambem nao voltam atras", async () => {
  // `produto_opcoes` e `config_loja` mudaram de nome de tabela E de coluna na
  // migracao para o schema `canastra` (`type`/`value` -> `tipo`/`valor`,
  // `site_title` -> `titulo_site`, `announcement_bar` -> `barra_de_aviso`). Um
  // nome errado aqui nao aparece em `npm test` sem esta asercao — aparece no
  // deploy, como 42703 no meio do seed, com o catalogo ja gravado.
  //
  // A barra de aviso e a asercao que importa: ela e editavel no painel e o seed
  // roda a cada deploy. Com `DO UPDATE`, a campanha publicada pelo administrador
  // voltaria para o texto de fabrica toda vez.
  await bd.pool.query("DELETE FROM canastra.produto_opcoes");
  await bd.pool.query("DELETE FROM canastra.config_loja");

  const quantas = await semearOpcoes(bd.pool);
  assert.equal(await semearConfig(bd.pool), true);

  const { rows: opcoes } = await bd.pool.query(
    `SELECT count(*)::int AS n,
            count(*) FILTER (WHERE tipo = 'categoria')::int AS categorias,
            count(*) FILTER (WHERE tipo = 'tamanho')::int   AS tamanhos
     FROM canastra.produto_opcoes`,
  );
  assert.equal(opcoes[0].n, quantas);
  assert.ok(opcoes[0].categorias > 0 && opcoes[0].tamanhos > 0);

  await bd.pool.query(
    "UPDATE canastra.config_loja SET barra_de_aviso = 'Frete grátis em dezembro'",
  );
  await semearOpcoes(bd.pool);
  assert.equal(
    await semearConfig(bd.pool),
    false,
    "a segunda semeadura nao pode reescrever a linha de config",
  );

  const { rows: config } = await bd.pool.query(
    "SELECT titulo_site, barra_de_aviso, banner_desktop FROM canastra.config_loja",
  );
  assert.deepEqual(config.length, 1);
  assert.equal(config[0].titulo_site, "Café Canastra");
  assert.equal(config[0].barra_de_aviso, "Frete grátis em dezembro");
  assert.match(config[0].banner_desktop, /^https?:\/\//);

  // E os filtros nao duplicaram na segunda passada.
  const { rows: depois } = await bd.pool.query(
    "SELECT count(*)::int AS n FROM canastra.produto_opcoes",
  );
  assert.equal(depois[0].n, quantas);
});

/* ------------------------------------------------------------------------- *
 * Conta inicial, pelo GoTrue
 * ------------------------------------------------------------------------- */

test("sem SEED_ADMIN_EMAIL/PASSWORD o seed nao inventa administrador", async () => {
  // Rodar `db:seed` para popular o catalogo e um gesto rotineiro. Ele nao pode,
  // de passagem, criar conta de acesso a partir de variavel vazia.
  const gotrue = gotrueFalso();
  const resultado = await semearAdmin(bd.pool, {
    ambiente: { SUPABASE_URL: BASE, SUPABASE_SERVICE_ROLE_KEY: "x" },
    buscar: gotrue.buscar,
  });

  assert.deepEqual(resultado, { criado: false });
  assert.deepEqual(gotrue.pedidos, [], "nao pode falar com o GoTrue sem credencial pedida");
  assert.deepEqual(await vinculos(), { clientes: 0, admins: 0 });
});

test("com a conta pedida e sem SUPABASE_URL, o seed PARA em vez de seguir", async () => {
  // O modo de falha que isto impede: o catalogo entra, o seed diz "concluído", e
  // a loja fica em producao SEM NINGUEM que consiga entrar no painel. Falhar alto
  // e a unica leitura segura — a conta inicial foi PEDIDA e nao foi criada.
  await assert.rejects(
    () =>
      semearAdmin(bd.pool, {
        ambiente: { ...AMBIENTE, SUPABASE_URL: undefined },
        buscar: gotrueFalso().buscar,
      }),
    /SUPABASE_URL/,
  );
});

test("a conta inicial e criada no GoTrue e ligada a loja como cliente e admin", async () => {
  const gotrue = gotrueFalso();
  const resultado = await semearAdmin(bd.pool, {
    ambiente: AMBIENTE,
    buscar: gotrue.buscar,
  });

  assert.equal(resultado.criado, true);
  assert.equal(resultado.jaExistia, false);
  assert.equal(resultado.userId, ID_DA_CONTA);

  assert.equal(gotrue.pedidos.length, 1);
  const [criacao] = gotrue.pedidos;
  assert.equal(criacao.metodo, "POST");
  assert.equal(criacao.url, `${BASE}/auth/v1/admin/users`);
  assert.equal(criacao.corpo.email, AMBIENTE.SEED_ADMIN_EMAIL);
  // `email_confirm: true` e o que faz a conta inicial entrar no painel na
  // PRIMEIRA tentativa. O fluxo normal exige clicar num link de confirmacao, e
  // numa instalacao nova o envio de e-mail e justamente o que ainda nao esta de
  // pe — a conta nasceria travada em "confirme seu e-mail" sem ninguem para
  // destravar.
  assert.equal(criacao.corpo.email_confirm, true);
  // A chave de servico vai nos DOIS cabecalhos: o Kong exige `apikey`, o GoTrue
  // exige `Authorization`. Faltando um, a resposta e 401 e nao 422 — e o codigo
  // trataria como "recusou criar" em vez de "ja existe".
  assert.equal(criacao.cabecalho.apikey, AMBIENTE.SUPABASE_SERVICE_ROLE_KEY);
  assert.match(criacao.cabecalho.Authorization, /^Bearer /);

  // `admins` referencia `clientes`, e nao `auth.users`: administrador da loja e,
  // antes disso, cliente da loja (0002). O vinculo tem de existir nas duas.
  assert.deepEqual(await vinculos(), { clientes: 1, admins: 1 });
  const { rows } = await bd.pool.query(
    "SELECT user_id, nome FROM canastra.clientes",
  );
  assert.deepEqual(rows, [{ user_id: ID_DA_CONTA, nome: AMBIENTE.SEED_ADMIN_NAME }]);
});

test("conta que JA existe: o seed reaproveita o id e NUNCA reenvia a senha", async () => {
  // A regra mais importante deste arquivo. O seed e idempotente por desenho e vai
  // ser rodado de novo em producao — depois de o administrador ter trocado a
  // senha, e com o deploy ainda carregando SEED_ADMIN_PASSWORD do ambiente.
  // Qualquer caminho que reenvie a senha REBAIXA a credencial real de volta para
  // a do arquivo de deploy, calado.
  //
  // A versao anterior deste seed tinha exatamente esse defeito, num
  // `ON CONFLICT (email) DO UPDATE SET password = ...`. Agora a senha nem e nossa
  // — mas o erro equivalente (um PUT em /admin/users/:id com `password`) esta a
  // uma linha de distancia, entao a ausencia dele e afirmada, e nao confiada.
  const gotrue = gotrueFalso({ criarResponde: 422 });
  await bd.pool.query("INSERT INTO auth.users (id, email) VALUES ($1, $2)", [
    ID_DA_CONTA,
    AMBIENTE.SEED_ADMIN_EMAIL,
  ]);

  const resultado = await semearAdmin(bd.pool, {
    ambiente: AMBIENTE,
    buscar: gotrue.buscar,
  });

  assert.equal(resultado.criado, true);
  assert.equal(resultado.jaExistia, true);
  assert.equal(resultado.userId, ID_DA_CONTA);
  assert.deepEqual(await vinculos(), { clientes: 1, admins: 1 });

  // Depois do 422, nenhuma outra requisicao pode carregar a senha. O POST inicial
  // e o unico lugar do mundo onde ela aparece.
  const comSenha = gotrue.pedidos.filter((p) => p.corpo && "password" in p.corpo);
  assert.equal(comSenha.length, 1, "a senha viajou mais de uma vez");
  assert.equal(comSenha[0].metodo, "POST");
  const depoisDoPost = gotrue.pedidos.slice(1);
  assert.ok(depoisDoPost.length > 0, "faltou a busca pelo id da conta existente");
  assert.ok(
    depoisDoPost.every((p) => p.metodo === "GET"),
    "so leitura depois do 422 — qualquer escrita aqui mexe numa conta alheia",
  );
});

test("semear a conta duas vezes nao duplica cliente nem administrador", async () => {
  const primeira = await semearAdmin(bd.pool, {
    ambiente: AMBIENTE,
    buscar: gotrueFalso().buscar,
  });
  const segunda = await semearAdmin(bd.pool, {
    ambiente: AMBIENTE,
    buscar: gotrueFalso({ criarResponde: 422 }).buscar,
  });

  assert.equal(primeira.userId, segunda.userId);
  assert.deepEqual(await vinculos(), { clientes: 1, admins: 1 });
});

test("GoTrue fora do ar nao vira 'seed concluído'", async () => {
  // 500 nao e 422: nao ha conta para reaproveitar e nao ha id para vincular.
  // Seguir em frente registraria sucesso com o painel inalcancavel.
  const buscar = async () => resposta(500, { msg: "database error" });
  await assert.rejects(
    () => semearAdmin(bd.pool, { ambiente: AMBIENTE, buscar }),
    /500/,
  );
  assert.deepEqual(await vinculos(), { clientes: 0, admins: 0 });
});
