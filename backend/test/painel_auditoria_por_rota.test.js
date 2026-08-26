"use strict";

/**
 * Task 5 da Onda 4: `admin_log` escrito, com teste POR ROTA.
 *
 * POR QUE POR ROTA E NÃO POR TRIGGER — a 0035 mediu e escreveu: o painel escreve
 * pelo pool do Express, que conecta como DONO do banco e sem claim nenhum,
 * então `auth.uid()` dentro de um trigger seria NULL e todo log sairia sem
 * autor, que é a única coluna que a tabela existe para guardar. Registrar quem
 * foi exige que quem SABE quem foi escreva a linha — e o preço disso é que uma
 * ação nova cujo autor esqueceu de chamar `registrar` não deixa rastro nenhum,
 * em SILÊNCIO. Este arquivo é o que fecha essa lacuna.
 *
 * DUAS METADES, e as duas são necessárias:
 *
 *   1. UMA ASSERÇÃO POR AÇÃO, chamando o handler de verdade e conferindo a
 *      linha no banco. As rotas de pedido, produto/avaliação e admin/marketing
 *      têm as suas nos arquivos `painel_*.test.js` correspondentes; aqui ficam
 *      as que sobraram — catálogo, configuração, promoção, cupom, opção,
 *      vitrine, redação LGPD e exclusão de cliente.
 *   2. UM INVENTÁRIO DE FONTE que quebra quando um ROUTER NOVO com escrita de
 *      admin aparece sem auditoria. É o que impede o esquecimento silencioso de
 *      voltar pela porta de uma onda futura.
 *
 * Os handlers são chamados DIRETO (com `req`/`res` de mentira) e não pela pilha
 * do router: metade deles vive atrás de `multer`, que num `req` falso não tem
 * stream para consumir. Quem prova que os guardas estão na frente são os outros
 * arquivos; o que se mede aqui é a LINHA DE LOG.
 */

const { test, before, after, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { subirPostgres } = require("./ajuda/postgres.js");
const { aplicarMigracoes } = require("../db/migrar.js");

let bd;
let DashboardRepository;
let dashboard;
let ConfigRepository;
let PromotionsRepository;
let promocoes;
let CuponsController;
let OptionsRepository;
let opcoes;
let vitrine;
let lgpd;
let conta;

const ANA = "aaaaaaaa-0000-0000-0000-000000000001"; // cliente
const DORA = "dddddddd-0000-0000-0000-000000000004"; // administradora
const BETO = "bbbbbbbb-0000-0000-0000-000000000002"; // cliente a excluir

const P1 = "11111111-0000-0000-0000-0000000000a1";

function respostaFalsa() {
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
  res.send = (corpo) => {
    if (res.codigo === null) res.codigo = 200;
    res.corpo = corpo;
    return res;
  };
  res.sendStatus = (codigo) => {
    res.codigo = codigo;
    return res;
  };
  res.setHeader = () => res;
  return res;
}

/** A ÚNICA linha de auditoria — e a asserção de que é uma só. */
async function unicoLog() {
  const { rows } = await bd.pool.query(
    `SELECT admin_user_id, acao, entidade, entidade_id, antes, depois
       FROM canastra.admin_log ORDER BY criado_em DESC`,
  );
  assert.equal(rows.length, 1, `esperava UMA linha de auditoria, vieram ${rows.length}`);
  return rows[0];
}

before(async () => {
  bd = await subirPostgres();
  await aplicarMigracoes(bd.pool);

  await bd.pool.query(
    `INSERT INTO auth.users (id, email) VALUES
       ($1,'ana@ex.com'), ($2,'dora@ex.com'), ($3,'beto@ex.com')`,
    [ANA, DORA, BETO],
  );
  await bd.pool.query(
    `INSERT INTO canastra.clientes (user_id, nome) VALUES
       ($1,'Ana'), ($2,'Dora'), ($3,'Beto')`,
    [ANA, DORA, BETO],
  );
  await bd.pool.query("INSERT INTO canastra.admins (user_id) VALUES ($1)", [DORA]);

  process.env.DATABASE_URL = bd.connectionString;

  DashboardRepository = require("../src/repositories/dashboardRepository.js");
  dashboard = new DashboardRepository();
  ConfigRepository = require("../src/repositories/configRepository.js");
  PromotionsRepository = require("../src/repositories/promotionsRepository.js");
  promocoes = new PromotionsRepository();
  CuponsController = require("../src/controllers/CuponsController.js");
  OptionsRepository = require("../src/repositories/optionsRepository.js");
  opcoes = new OptionsRepository();
  vitrine = require("../src/repositories/vitrineRepository.js");
  lgpd = require("../src/routes/lgpd.routes.js");
  conta = require("../src/routes/conta.routes.js");
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
  await bd.pool.query("DELETE FROM canastra.promocoes_legado");
  await bd.pool.query("DELETE FROM canastra.cupons");
  await bd.pool.query("DELETE FROM canastra.produto_opcoes");
  await bd.pool.query("DELETE FROM canastra.produtos");
  await bd.pool.query(
    `INSERT INTO canastra.produtos (produto_id, nome, preco, quantidade, sku)
     VALUES ($1, 'Café Clássico 250g', 42.00, 10, 'AUD-CLASSICO')`,
    [P1],
  );
});

/* --------------------------------------------------------------------------
 * Catálogo
 * -------------------------------------------------------------------------- */

test("POST /dashboard registra quem criou o produto", async () => {
  const res = respostaFalsa();
  await dashboard.createProduct(
    {
      body: { name: "Café Novo", price: 39.9, quantity: 5, sku: "AUD-NOVO" },
      user: { userId: DORA },
    },
    res,
  );
  assert.equal(res.codigo, 201);

  const linha = await unicoLog();
  assert.equal(linha.admin_user_id, DORA);
  assert.equal(linha.acao, "produto_criado");
  assert.equal(linha.entidade, "produto");
  assert.equal(linha.antes, null);
  assert.equal(linha.depois.sku, "AUD-NOVO");
});

test("PUT /dashboard/:id registra o antes e o depois do PREÇO", async () => {
  // "Quem mudou o preço do micro-lote na sexta à noite?" é a segunda das três
  // perguntas que a 0035 diz não terem resposta hoje.
  const res = respostaFalsa();
  await dashboard.editProduct(
    {
      params: { id: P1 },
      body: { name: "Café Clássico 250g", price: 47.5, quantity: 10 },
      user: { userId: DORA },
    },
    res,
  );
  assert.equal(res.codigo, 200);

  const linha = await unicoLog();
  assert.equal(linha.acao, "produto_alterado");
  assert.equal(linha.entidade_id, P1);
  assert.equal(linha.antes.preco, 42);
  assert.equal(linha.depois.preco, 47.5);
});

test("DELETE /dashboard/:id registra o que o produto ERA — a linha some depois", async () => {
  const res = respostaFalsa();
  await dashboard.deleteProduct({ params: { id: P1 }, user: { userId: DORA } }, res);
  assert.equal(res.codigo, 204);

  const linha = await unicoLog();
  assert.equal(linha.acao, "produto_removido");
  assert.equal(linha.entidade_id, P1);
  assert.equal(linha.antes.sku, "AUD-CLASSICO");
  assert.equal(linha.depois, null);
});

test("uma edição RECUSADA não deixa linha de auditoria — não houve mudança", async () => {
  const res = respostaFalsa();
  await dashboard.editProduct(
    { params: { id: P1 }, body: { name: "x", price: -1, quantity: 1 }, user: { userId: DORA } },
    res,
  );
  assert.equal(res.codigo, 400);
  const { rows } = await bd.pool.query("SELECT count(*) FROM canastra.admin_log");
  assert.equal(Number(rows[0].count), 0);
});

/* --------------------------------------------------------------------------
 * Configuração da loja
 * -------------------------------------------------------------------------- */

test("PUT /config registra SÓ o que mudou — e o frete grátis é o campo que importa", async () => {
  // Um `0` no piso do frete grátis libera frete grátis para a loja INTEIRA, e
  // até aqui não havia em lugar nenhum um registro de quem o escreveu.
  await bd.pool.query(
    `INSERT INTO canastra.config_loja (id, titulo_site, frete_gratis_minimo_centavos)
     VALUES (1, 'Café Canastra', 14900)
     ON CONFLICT (id) DO UPDATE
        SET titulo_site = 'Café Canastra', frete_gratis_minimo_centavos = 14900`,
  );

  const res = respostaFalsa();
  await ConfigRepository.updateConfig(
    {
      body: { frete_gratis_minimo_centavos: "0" },
      files: {},
      user: { userId: DORA },
    },
    res,
  );
  assert.equal(res.codigo, 200);

  const linha = await unicoLog();
  assert.equal(linha.admin_user_id, DORA);
  assert.equal(linha.acao, "config_alterada");
  assert.equal(linha.entidade, "config_loja");
  assert.equal(linha.entidade_id, "1");
  assert.equal(linha.antes.frete_gratis_minimo_centavos, 14900);
  assert.equal(linha.depois.frete_gratis_minimo_centavos, 0);
  // O título não veio no corpo e não pode aparecer no diff.
  assert.equal("site_title" in linha.depois, false);
});

test("PUT /config que não muda nada não gera linha de auditoria", async () => {
  await bd.pool.query(
    `INSERT INTO canastra.config_loja (id, titulo_site) VALUES (1, 'Café Canastra')
     ON CONFLICT (id) DO UPDATE SET titulo_site = 'Café Canastra'`,
  );
  const res = respostaFalsa();
  await ConfigRepository.updateConfig(
    { body: { site_title: "Café Canastra" }, files: {}, user: { userId: DORA } },
    res,
  );
  assert.equal(res.codigo, 200);
  const { rows } = await bd.pool.query("SELECT count(*) FROM canastra.admin_log");
  assert.equal(Number(rows[0].count), 0, "salvar o mesmo valor não é alteração");
});

/* --------------------------------------------------------------------------
 * Promoções e cupons — as duas telas que decidem dinheiro
 * -------------------------------------------------------------------------- */

test("POST /promotions registra quem aprovou o desconto", async () => {
  const res = respostaFalsa();
  await promocoes.createPromotion(
    {
      body: { title: "Metade do preço", type: "percent", value: 50, applies_to: "all" },
      user: { userId: DORA },
    },
    res,
  );
  assert.equal(res.codigo, 201);

  const linha = await unicoLog();
  assert.equal(linha.admin_user_id, DORA);
  assert.equal(linha.acao, "promocao_criada");
  assert.equal(linha.depois.valor, 50);
});

test("PUT /promotions/:id registra o antes e o depois de `ativa`", async () => {
  const { rows } = await bd.pool.query(
    `INSERT INTO canastra.promocoes_legado (titulo, tipo, valor, aplica_a, ativa)
     VALUES ('Dez', 'percent', 10, 'all', true) RETURNING id`,
  );
  const res = respostaFalsa();
  await promocoes.updatePromotion(
    { params: { id: rows[0].id }, body: { active: false }, user: { userId: DORA } },
    res,
  );
  assert.equal(res.codigo, 200);

  const linha = await unicoLog();
  assert.equal(linha.acao, "promocao_alterada");
  assert.equal(linha.antes.ativa, true);
  assert.equal(linha.depois.ativa, false);
});

test("POST /cupons e PUT /cupons/:id registram criação e alteração", async () => {
  const criacao = respostaFalsa();
  await CuponsController.criar(
    {
      body: { codigo: "AUDITA10", tipo: "percent", valor: 10 },
      user: { userId: DORA },
    },
    criacao,
  );
  assert.equal(criacao.codigo, 201);

  let linha = await unicoLog();
  assert.equal(linha.acao, "cupom_criado");
  assert.equal(linha.depois.codigo, "AUDITA10");

  await bd.pool.query("TRUNCATE canastra.admin_log");

  const edicao = respostaFalsa();
  await CuponsController.atualizar(
    { params: { id: criacao.corpo.id }, body: { ativo: false }, user: { userId: DORA } },
    edicao,
  );
  assert.equal(edicao.codigo, 200);

  linha = await unicoLog();
  assert.equal(linha.acao, "cupom_alterado");
  assert.equal(linha.antes.ativo, true);
  assert.equal(linha.depois.ativo, false);
});

/* --------------------------------------------------------------------------
 * Opções de filtro e vitrine
 * -------------------------------------------------------------------------- */

test("POST /options e DELETE /options/:id deixam rastro", async () => {
  const criacao = respostaFalsa();
  await opcoes.addOption(
    { body: { type: "category", value: "Especial" }, user: { userId: DORA } },
    criacao,
  );
  assert.equal(criacao.codigo, 201);

  let linha = await unicoLog();
  assert.equal(linha.acao, "opcao_criada");
  assert.equal(linha.depois.valor, "Especial");

  await bd.pool.query("TRUNCATE canastra.admin_log");

  const { rows } = await bd.pool.query(
    "SELECT id FROM canastra.produto_opcoes WHERE valor = 'Especial'",
  );
  const remocao = respostaFalsa();
  await opcoes.deleteOption({ params: { id: rows[0].id }, user: { userId: DORA } }, remocao);
  assert.equal(remocao.codigo, 204);

  linha = await unicoLog();
  assert.equal(linha.acao, "opcao_removida");
  assert.equal(linha.antes.valor, "Especial");
});

test("PUT /vitrine registra QUAIS chaves foram tocadas, não o conteúdo inteiro", async () => {
  const res = respostaFalsa();
  await vitrine.gravarVitrine(
    {
      body: {
        heroi: { imagem_desktop: "https://cdn/heroi.jpg" },
        textos: { barra_aviso: { pt: { texto: "Frete grátis acima de R$ 149" } } },
      },
      user: { userId: DORA },
    },
    res,
  );
  assert.equal(res.codigo, 200);

  const linha = await unicoLog();
  assert.equal(linha.acao, "vitrine_alterada");
  assert.deepEqual(linha.depois.heroi, ["imagem_desktop"]);
  assert.deepEqual(linha.depois.textos, ["barra_aviso.pt"]);
});

/* --------------------------------------------------------------------------
 * Os dois gestos destrutivos sobre PESSOAS
 * -------------------------------------------------------------------------- */

test("POST /lgpd/titulares/:id/redigir registra quem redigiu, sem copiar o dado", async () => {
  const res = respostaFalsa();
  await lgpd.redigirTitular(
    { params: { userId: ANA }, user: { userId: DORA } },
    res,
    { conexao: bd.pool },
  );
  assert.equal(res.codigo, 200);

  const linha = await unicoLog();
  assert.equal(linha.admin_user_id, DORA);
  assert.equal(linha.acao, "titular_redigido");
  assert.equal(linha.entidade_id, ANA);
  // O `antes` seria a cópia em texto claro do que o UPDATE acabou de apagar —
  // o log desfaria a redação.
  assert.equal(linha.antes, null);
  assert.equal(typeof Number(linha.depois.pedidos_redigidos), "number");
});

test("DELETE /auth/users/:id registra quem apagou o cliente, e o nome que sumiu", async () => {
  const res = respostaFalsa();
  await conta.excluirClientePeloAdmin(
    { params: { id: BETO }, user: { userId: DORA } },
    res,
    {
      conexao: bd.pool,
      cancelarAssinaturas: async () => [],
      buscar: async () => ({ ok: true, status: 200 }),
      ambiente: {
        SUPABASE_URL: "http://gotrue.local",
        SUPABASE_SERVICE_ROLE_KEY: "chave-de-teste",
      },
    },
  );
  assert.equal(res.codigo, 200);

  const linha = await unicoLog();
  assert.equal(linha.admin_user_id, DORA);
  assert.equal(linha.acao, "cliente_excluido");
  assert.equal(linha.entidade_id, BETO);
  assert.equal(linha.antes.nome, "Beto");
  // CPF e telefone NÃO entram: o registro da exclusão não pode ser a cópia que
  // sobrou do dado que se apagou.
  assert.equal("cpf" in linha.antes, false);
});

/* --------------------------------------------------------------------------
 * O inventário: um router NOVO com escrita de admin não passa em silêncio
 * -------------------------------------------------------------------------- */

/**
 * Os routers que registram escrita atrás de `isAdmin`, e onde a auditoria mora.
 *
 * A lista é EXPLÍCITA porque o esquecimento é o modo de falha desta tabela: o
 * log é escrito pelo mesmo código que faz a ação, então uma rota nova sem
 * `registrar` não deixa rastro e NÃO dá erro. O teste abaixo compara esta lista
 * com o que existe em disco — um router novo com escrita administrativa quebra
 * aqui até alguém decidir de que lado ele fica.
 */
const AUDITADOS = Object.freeze({
  "products.routes.js": ["dashboardRepository.js", "configRepository.js"],
  "orders.routes.js": ["OrderController.js"],
  "promotions.routes.js": ["promotionsRepository.js"],
  "options.routes.js": ["optionsRepository.js"],
  "cupons.routes.js": ["CuponsController.js"],
  "vitrine.routes.js": ["vitrineRepository.js"],
  "painel.routes.js": [
    "dashboardRepository.js",
    "avaliacoesRepository.js",
    "administradoresRepository.js",
  ],
  "marketing.routes.js": ["marketingRepository.js"],
  "conta.routes.js": ["conta.routes.js"],
  "lgpd.routes.js": ["lgpd.routes.js"],
});

/**
 * Os que NÃO auditam ainda, com o motivo — e é uma dívida declarada, não um
 * esquecimento:
 *
 *   `bling.routes.js` .. as ações são de INTEGRAÇÃO (sincronizar pedido, emitir
 *      NF-e, buscar rastreio) e cada uma já grava o próprio rastro nas colunas
 *      `bling_*`/`nfe_*` do pedido, com carimbo e situação. O que falta ali é o
 *      AUTOR, e acrescentá-lo é uma linha por ação — fora do escopo desta onda
 *      porque a tela de Bling não foi reescrita nela.
 *   `clube.routes.js` . `/admin/assinaturas` cancela assinatura de terceiro, e
 *      isso PRECISA de autor. Mesma razão: a tela do Clube é de outra onda, e
 *      mexer no cancelamento junto misturaria a auditoria com a mecânica de
 *      preapproval do Mercado Pago.
 *
 * Quem construir essas telas volta aqui e move o nome de lista.
 */
const SEM_AUDITORIA_AINDA = Object.freeze(["bling.routes.js", "clube.routes.js"]);

test("todo router com escrita de admin ou audita, ou está na lista de dívida", () => {
  const pastaDeRotas = path.join(__dirname, "..", "src", "routes");
  const arquivos = fs.readdirSync(pastaDeRotas).filter((n) => n.endsWith(".routes.js"));

  for (const arquivo of arquivos) {
    const fonte = fs.readFileSync(path.join(pastaDeRotas, arquivo), "utf8");
    const temEscrita = /\.(post|put|patch|delete)\(/.test(fonte);
    const temAdmin = /isAdmin/.test(fonte);
    if (!temEscrita || !temAdmin) continue;

    if (SEM_AUDITORIA_AINDA.includes(arquivo)) continue;

    assert.ok(
      AUDITADOS[arquivo],
      `${arquivo} registra escrita de admin e não está em AUDITADOS nem em ` +
        "SEM_AUDITORIA_AINDA — decida de que lado ele fica antes de subir.",
    );
  }
});

test("cada módulo declarado como auditado realmente chama `registrar`", () => {
  // A segunda metade do inventário: estar na lista não basta, o `registrar` tem
  // de estar no arquivo. Isto pega o dia em que alguém remover a chamada e
  // deixar a lista intacta.
  const raiz = path.join(__dirname, "..", "src");
  const pastas = ["routes", "repositories", "controllers"];

  for (const [router, modulos] of Object.entries(AUDITADOS)) {
    for (const modulo of modulos) {
      const caminho = pastas
        .map((p) => path.join(raiz, p, modulo))
        .find((c) => fs.existsSync(c));
      assert.ok(caminho, `${modulo} (de ${router}) não existe em src/`);

      const fonte = fs.readFileSync(caminho, "utf8");
      assert.match(
        fonte,
        /require\("\.\.\/services\/adminLog"\)/,
        `${modulo} está declarado como auditado e não carrega services/adminLog`,
      );
      assert.match(
        fonte,
        /registrar\(/,
        `${modulo} carrega o serviço de auditoria e nunca chama registrar()`,
      );
    }
  }
});
