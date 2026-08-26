"use strict";

/**
 * Os defeitos dos repositórios do painel que só aparecem contra o banco de
 * verdade — todos da família "a escrita foi aceita e destruiu o que não veio no
 * corpo", que é a família que não deixa rastro nenhum na tela.
 *
 * Padrão de f4_repositorios.test.js: Postgres embarcado, `DATABASE_URL`
 * apontando para o cluster efêmero ANTES do require dos módulos de `src/` (o
 * `pgPool` lê a variável no momento do require) e dublê de `res`.
 */

const { test, before, after, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const { subirPostgres } = require("./ajuda/postgres.js");
const { aplicarMigracoes } = require("../db/migrar.js");

let bd;
let ConfigRepository;
let PromotionsRepository;
let DashboardRepository;

/** Dublê de `res` no padrão de f4_repositorios.test.js, com send() para o 204. */
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
  res.send = () => {
    if (res.codigo === null) res.codigo = 200;
    return res;
  };
  return res;
}

before(async () => {
  bd = await subirPostgres();
  await aplicarMigracoes(bd.pool);

  await bd.pool.query(
    "INSERT INTO canastra.config_loja (id) VALUES (1) ON CONFLICT (id) DO NOTHING",
  );

  process.env.DATABASE_URL = bd.connectionString;

  ConfigRepository = require("../src/repositories/configRepository.js");
  PromotionsRepository = require("../src/repositories/promotionsRepository.js");
  DashboardRepository = require("../src/repositories/dashboardRepository.js");
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
 * PUT /config — campo em branco é ausência, e só `0` explícito zera o piso
 * -------------------------------------------------------------------------- */

/** Deixa a config num estado conhecido, direto no banco. */
async function configConhecida() {
  await bd.pool.query(
    `UPDATE canastra.config_loja
        SET titulo_site = 'Café Canastra',
            whatsapp = '5535999990000',
            barra_de_aviso = 'Torramos na terça.',
            frete_gratis_minimo_centavos = 14900
      WHERE id = 1`,
  );
}

test("config: piso do frete grátis em BRANCO não muda o valor no banco", async () => {
  await configConhecida();

  // É exatamente o que o multipart entrega quando o campo do formulário fica
  // vazio — e era aqui que a loja inteira ganhava frete grátis: `Number('')` é
  // 0, `Number.isInteger(0)` é true, `0 < 0` é falso, a validação APROVAVA.
  const res = respostaFalsa();
  await ConfigRepository.updateConfig(
    {
      body: {
        site_title: "Café Canastra",
        frete_gratis_minimo_centavos: "",
      },
      files: undefined,
    },
    res,
  );
  assert.equal(res.codigo, 200);

  const depois = await ConfigRepository.getConfig();
  assert.equal(
    depois.frete_gratis_minimo_centavos,
    14900,
    "campo em branco é ausência: salvar qualquer outro campo do formulário não pode desligar o frete grátis",
  );
});

test("config: piso do frete grátis com 0 EXPLÍCITO zera (é assim que se desliga)", async () => {
  await configConhecida();

  // O número 0 (JSON) e a string "0" (multipart) são o mesmo pedido: desligar.
  for (const zero of [0, "0"]) {
    await configConhecida();

    const res = respostaFalsa();
    await ConfigRepository.updateConfig(
      { body: { frete_gratis_minimo_centavos: zero }, files: undefined },
      res,
    );
    assert.equal(res.codigo, 200);

    const depois = await ConfigRepository.getConfig();
    assert.equal(
      depois.frete_gratis_minimo_centavos,
      0,
      `zerar de propósito continua possível (enviado como ${JSON.stringify(zero)})`,
    );
  }
});

test("config: site_title em BRANCO não apaga o título", async () => {
  await configConhecida();

  const res = respostaFalsa();
  await ConfigRepository.updateConfig(
    {
      body: {
        site_title: "",
        whatsapp_number: "",
        announcement_bar: "",
        frete_gratis_minimo_centavos: "19900",
      },
      files: undefined,
    },
    res,
  );
  assert.equal(res.codigo, 200);

  const depois = await ConfigRepository.getConfig();
  assert.equal(depois.site_title, "Café Canastra");
  assert.equal(depois.whatsapp_number, "5535999990000");
  assert.equal(depois.announcement_bar, "Torramos na terça.");
  // E o campo que veio de verdade foi gravado — parcial não é o mesmo que inerte.
  assert.equal(depois.frete_gratis_minimo_centavos, 19900);
});

test("config: valor inválido continua 400, e não toca em nada", async () => {
  await configConhecida();

  const res = respostaFalsa();
  await ConfigRepository.updateConfig(
    {
      body: { site_title: "Outro nome", frete_gratis_minimo_centavos: "-1" },
      files: undefined,
    },
    res,
  );
  assert.equal(res.codigo, 400);

  const depois = await ConfigRepository.getConfig();
  assert.equal(depois.site_title, "Café Canastra");
  assert.equal(depois.frete_gratis_minimo_centavos, 14900);
});

/* --------------------------------------------------------------------------
 * PUT /promotions/:id — parcial de verdade, e 404 para id inexistente
 * -------------------------------------------------------------------------- */

/** Cria uma promoção completa e devolve a linha crua do banco. */
async function promocaoCompleta(titulo) {
  const repo = new PromotionsRepository();
  const res = respostaFalsa();
  await repo.createPromotion(
    {
      body: {
        title: titulo,
        description: "10% na linha de moídos",
        type: "percent",
        value: 10,
        applies_to: "category",
        category: "Café moído",
        start_date: "2020-01-01T00:00",
        end_date: "2099-12-31T23:59",
      },
    },
    res,
  );
  assert.equal(res.codigo, 201);

  const { rows } = await bd.pool.query(
    "SELECT * FROM canastra.promocoes_legado WHERE titulo = $1",
    [titulo],
  );
  return rows[0];
}

test("promoções: PUT só com o título preserva descrição, valor, datas e categoria", async () => {
  const repo = new PromotionsRepository();
  const antes = await promocaoCompleta("Semana do moído");

  // O corpo tem UM campo. A versão anterior escrevia todas as colunas com o que
  // veio, então tudo o que não veio virava NULL — e a promoção continuava
  // "ativa" apontando para lugar nenhum, sem sinal na tela.
  const res = respostaFalsa();
  await repo.updatePromotion(
    { params: { id: antes.id }, body: { title: "Semana do moído (nova)" } },
    res,
  );
  assert.equal(res.codigo, 200);

  const { rows } = await bd.pool.query(
    "SELECT * FROM canastra.promocoes_legado WHERE id = $1",
    [antes.id],
  );
  const depois = rows[0];

  assert.equal(depois.titulo, "Semana do moído (nova)");
  assert.equal(depois.descricao, antes.descricao);
  assert.equal(Number(depois.valor), Number(antes.valor));
  assert.equal(depois.tipo, antes.tipo);
  assert.equal(depois.aplica_a, antes.aplica_a);
  assert.equal(depois.categoria, antes.categoria);
  assert.deepEqual(depois.inicio_em, antes.inicio_em);
  assert.deepEqual(depois.fim_em, antes.fim_em);
  assert.equal(depois.ativa, antes.ativa);
});

test("promoções: PUT num id inexistente responde 404, não 200", async () => {
  const repo = new PromotionsRepository();

  const res = respostaFalsa();
  await repo.updatePromotion(
    {
      // UUID bem formado e que não existe: o 200 de antes fazia a tela
      // anunciar "Promoção atualizada." tendo atualizado zero linhas.
      params: { id: "00000000-0000-4000-8000-000000000000" },
      body: { title: "Fantasma", type: "percent", value: 10 },
    },
    res,
  );

  assert.equal(res.codigo, 404);
});

test("promoções: o PUT completo do painel legado continua funcionando igual", async () => {
  const repo = new PromotionsRepository();
  const antes = await promocaoCompleta("Semana do grão");

  // PromotionsManager.jsx:124 monta SEMPRE o objeto inteiro, inclusive no
  // toggle de ativo. Num UPDATE parcial isso dá exatamente o mesmo resultado.
  const res = respostaFalsa();
  await repo.updatePromotion(
    {
      params: { id: antes.id },
      body: {
        title: "Semana do grão",
        description: "15% na linha de grãos",
        type: "percent",
        value: 15,
        applies_to: "all",
        category: "",
        product_id: "",
        start_date: "",
        end_date: "",
        active: false,
      },
    },
    res,
  );
  assert.equal(res.codigo, 200);

  const { rows } = await bd.pool.query(
    "SELECT * FROM canastra.promocoes_legado WHERE id = $1",
    [antes.id],
  );
  assert.equal(Number(rows[0].valor), 15);
  assert.equal(rows[0].aplica_a, "all");
  assert.equal(rows[0].categoria, null);
  assert.equal(rows[0].inicio_em, null);
  assert.equal(rows[0].ativa, false);
});

test("promoções: o teto de 90% vale mesmo quando o PUT manda só o valor", async () => {
  const repo = new PromotionsRepository();
  const antes = await promocaoCompleta("Semana do coado");

  // O `tipo` da promoção não está no corpo — só no banco. Sem ler a linha
  // antes de validar, um PUT parcial passaria por cima do teto e o checkout
  // calcularia preço negativo, que ABATE dos outros itens do carrinho.
  const res = respostaFalsa();
  await repo.updatePromotion(
    { params: { id: antes.id }, body: { value: 150 } },
    res,
  );
  assert.equal(res.codigo, 400);

  const { rows } = await bd.pool.query(
    "SELECT valor FROM canastra.promocoes_legado WHERE id = $1",
    [antes.id],
  );
  assert.equal(Number(rows[0].valor), 10);
});

/* --------------------------------------------------------------------------
 * PUT /dashboard/:id — peso e dimensões sobrevivem à edição
 * -------------------------------------------------------------------------- */

/** Cria um produto e devolve a linha crua do banco. */
async function produtoCriado(repo, body) {
  const res = respostaFalsa();
  await repo.createProduct({ body, file: undefined }, res);
  assert.equal(res.codigo, 201, JSON.stringify(res.corpo));

  const { rows } = await bd.pool.query(
    "SELECT * FROM canastra.produtos WHERE sku = $1",
    [body.sku],
  );
  return rows[0];
}

test("produto: criar sem peso usa o padrão da caixa (0,3 kg / 20 / 5 / 20)", async () => {
  const repo = new DashboardRepository();
  const criado = await produtoCriado(repo, {
    name: "Canastra Clássico 250g",
    price: 42.9,
    quantity: 10,
    sku: "MEDIDA-PADRAO",
  });

  // Na CRIAÇÃO não há valor anterior a preservar: o padrão é o que existe.
  assert.equal(Number(criado.peso), 0.3);
  assert.equal(Number(criado.largura), 20);
  assert.equal(Number(criado.altura), 5);
  assert.equal(Number(criado.comprimento), 20);
});

test("produto: editar só o preço MANTÉM o peso de 1,2 kg", async () => {
  const repo = new DashboardRepository();
  const criado = await produtoCriado(repo, {
    name: "Kit Canastra 4x250g",
    price: 159.9,
    quantity: 5,
    sku: "MEDIDA-KIT",
    weight: 1.2,
    width: 30,
    height: 12,
    length: 30,
  });
  assert.equal(Number(criado.peso), 1.2);

  // O formulário do painel manda nome/preço/estoque e NENHUM campo de medida.
  const res = respostaFalsa();
  await repo.editProduct(
    {
      params: { id: criado.produto_id },
      body: { name: "Kit Canastra 4x250g", price: 149.9, quantity: 5 },
      file: undefined,
    },
    res,
  );
  assert.equal(res.codigo, 200);

  const { rows } = await bd.pool.query(
    "SELECT * FROM canastra.produtos WHERE produto_id = $1",
    [criado.produto_id],
  );
  assert.equal(Number(rows[0].preco), 149.9, "o preço mudou, que era o pedido");
  assert.equal(
    Number(rows[0].peso),
    1.2,
    "corrigir o preço não pode devolver a caixa ao padrão: a loja passaria a cotar frete errado sem sinal na tela",
  );
  assert.equal(Number(rows[0].largura), 30);
  assert.equal(Number(rows[0].altura), 12);
  assert.equal(Number(rows[0].comprimento), 30);
});

test('produto: a string "undefined" no peso MANTÉM o valor atual, não vira padrão', async () => {
  const repo = new DashboardRepository();
  const criado = await produtoCriado(repo, {
    name: "Canastra Grão 1kg",
    price: 99.9,
    quantity: 3,
    sku: "MEDIDA-GRAO",
    weight: 1.05,
    width: 25,
    height: 10,
    length: 25,
  });

  // Isto é literalmente o que Form.jsx:394-397 envia: os quatro campos vão
  // no FormData sem ter input nenhum, e `undefined` serializa como texto.
  // A string vazia entra junto porque é o que um input vazio entregaria.
  const res = respostaFalsa();
  await repo.editProduct(
    {
      params: { id: criado.produto_id },
      body: {
        name: "Canastra Grão 1kg",
        price: 99.9,
        quantity: 3,
        weight: "undefined",
        width: "undefined",
        height: "",
        length: "   ",
      },
      file: undefined,
    },
    res,
  );
  assert.equal(res.codigo, 200);

  const { rows } = await bd.pool.query(
    "SELECT * FROM canastra.produtos WHERE produto_id = $1",
    [criado.produto_id],
  );
  assert.equal(Number(rows[0].peso), 1.05);
  assert.equal(Number(rows[0].largura), 25);
  assert.equal(Number(rows[0].altura), 10);
  assert.equal(Number(rows[0].comprimento), 25);
});

test("produto: medida enviada DE VERDADE continua sendo gravada", async () => {
  const repo = new DashboardRepository();
  const criado = await produtoCriado(repo, {
    name: "Canastra Coado 500g",
    price: 64.9,
    quantity: 8,
    sku: "MEDIDA-COADO",
    weight: 0.55,
  });

  // Preservar o atual não pode virar "ignorar o que veio": a tela nova, que
  // terá os quatro inputs, precisa conseguir corrigir uma caixa.
  const res = respostaFalsa();
  await repo.editProduct(
    {
      params: { id: criado.produto_id },
      body: {
        name: "Canastra Coado 500g",
        price: 64.9,
        quantity: 8,
        weight: "0.62",
        width: "22",
      },
      file: undefined,
    },
    res,
  );
  assert.equal(res.codigo, 200);

  const { rows } = await bd.pool.query(
    "SELECT * FROM canastra.produtos WHERE produto_id = $1",
    [criado.produto_id],
  );
  assert.equal(Number(rows[0].peso), 0.62);
  assert.equal(Number(rows[0].largura), 22);
});

/* --------------------------------------------------------------------------
 * DELETE /dashboard/:id — 204 é "eu apaguei", e só o rowCount sabe disso
 * -------------------------------------------------------------------------- */

test("produto: DELETE num id inexistente responde 404, não 204", async () => {
  const repo = new DashboardRepository();

  const res = respostaFalsa();
  await repo.deleteProduct(
    { params: { id: "00000000-0000-4000-8000-0000000000ff" } },
    res,
  );

  // Uma tela que confie no status para anunciar "Produto deletado!" mentia.
  assert.equal(res.codigo, 404);
});

test("produto: DELETE num id existente continua 204 e some do banco", async () => {
  const repo = new DashboardRepository();
  const criado = await produtoCriado(repo, {
    name: "Canastra Descontinuado",
    price: 39.9,
    quantity: 1,
    sku: "PARA-EXCLUIR",
  });

  const res = respostaFalsa();
  await repo.deleteProduct({ params: { id: criado.produto_id } }, res);
  assert.equal(res.codigo, 204);

  const { rows } = await bd.pool.query(
    "SELECT 1 FROM canastra.produtos WHERE produto_id = $1",
    [criado.produto_id],
  );
  assert.equal(rows.length, 0);
});

/* --------------------------------------------------------------------------
 * `:id` MALFORMADO — 400 com frase, nunca 500
 * -------------------------------------------------------------------------- */

/**
 * "Malformado" NÃO é "inexistente", e os dois já tinham desfechos diferentes —
 * o problema é que o segundo estava certo e o primeiro não.
 *
 * Um id que não tem forma de UUID chega intacto ao `$1` de uma coluna `uuid`,
 * o Postgres levanta 22P02 ("invalid input syntax for type uuid"), o `catch`
 * genérico do repositório vê um erro qualquer e responde 500 "Erro ao
 * atualizar promoção." — a frase que o painel mostra quando o SERVIDOR quebrou.
 * E não quebrou: quem mandou o pedido errado foi o cliente. O gestor lê "erro
 * interno", abre um chamado, e o log do servidor enche de 22P02 que parecem
 * incidente de banco.
 *
 * A checagem é ANTES do banco de propósito: é a mesma disciplina de
 * `conta.routes.js` e `lgpd.routes.js`, que usam o `ehUuid` de
 * `utils/formatoUuid.js` — lixo não chega ao cast.
 *
 * O 404 do id BEM FORMADO e inexistente continua sendo 404 (os dois testes
 * acima), e é essa diferença que a tela precisa: "não existe" manda recarregar
 * a lista, "está malformado" manda olhar o link.
 */
const IDS_MALFORMADOS = [
  ["texto puro", "abc"],
  ["número", "123"],
  ["uuid com um dígito a menos", "00000000-0000-4000-8000-00000000000"],
  ["uuid sem hífens", "00000000000040008000000000000000"],
  ["texto com aspas", "abc'--"],
];

test("promoções: por PRODUTO exige um uuid de verdade no corpo", async () => {
  // ESTE TESTE NÃO NASCEU DE UM BUG: ele existe para prender o comportamento
  // ANTES de a validação daqui trocar a regex copiada pelo `ehUuid` comum — um
  // refactor só é seguro quando existe alguém para reprovar a diferença. Vale
  // nas duas versões, e é isso que o torna útil.
  //
  // Repare que o alvo é o `product_id` do CORPO, não o `:id` da URL: aqui o
  // uuid inválido nunca chegou ao banco (a validação já existia). O que se
  // ganha é uma cópia a menos da mesma pergunta.
  const repo = new PromotionsRepository();

  for (const invalido of [undefined, null, "", "abc", "00000000-0000-4000-8000-0000000000"]) {
    const res = respostaFalsa();
    await repo.createPromotion(
      {
        body: {
          title: "Só neste café",
          type: "percent",
          value: 10,
          applies_to: "product",
          product_id: invalido,
        },
      },
      res,
    );
    assert.equal(res.codigo, 400, `product_id = ${JSON.stringify(invalido)}`);
    assert.match(res.corpo.error, /UUID/i);
  }

  // E o caminho feliz continua criando, com o uuid guardado como veio.
  const res = respostaFalsa();
  await repo.createPromotion(
    {
      body: {
        title: "Só neste café (válida)",
        type: "percent",
        value: 10,
        applies_to: "product",
        product_id: "00000000-0000-4000-8000-00000000abcd",
      },
    },
    res,
  );
  assert.equal(res.codigo, 201);
  const { rows } = await bd.pool.query(
    "SELECT produto_id FROM canastra.promocoes_legado WHERE titulo = $1",
    ["Só neste café (válida)"],
  );
  assert.equal(rows[0].produto_id, "00000000-0000-4000-8000-00000000abcd");
});

test("promoções: PUT com :id malformado é 400 com frase, não 500", async () => {
  const repo = new PromotionsRepository();

  for (const [nome, id] of IDS_MALFORMADOS) {
    const res = respostaFalsa();
    await repo.updatePromotion(
      { params: { id }, body: { title: "Qualquer coisa" } },
      res,
    );

    assert.equal(res.codigo, 400, `${nome} deveria ser 400 (é erro do pedido)`);
    // A frase importa tanto quanto o código: é ela que diz ao gestor que o
    // problema está no link, e não no servidor.
    assert.notEqual(res.corpo.error, "Erro ao atualizar promoção.", nome);
    assert.match(res.corpo.error, /identificador/i, nome);
  }
});

test("produto: DELETE com :id malformado é 400 com frase, não 500", async () => {
  const repo = new DashboardRepository();

  for (const [nome, id] of IDS_MALFORMADOS) {
    const res = respostaFalsa();
    await repo.deleteProduct({ params: { id } }, res);

    assert.equal(res.codigo, 400, `${nome} deveria ser 400 (é erro do pedido)`);
    assert.notEqual(res.corpo.message, "Erro ao deletar produto.", nome);
    assert.match(res.corpo.error, /identificador/i, nome);
  }
});

test("produto: GET e PUT com :id malformado são 400 com frase, não 500", async () => {
  // As DUAS IRMÃS das rotas acima, no mesmo arquivo e com o mesmo defeito.
  // `GET /dashboard/:id` é pública (sem `isAuthenticated`), então ela é a que
  // qualquer visitante alcança digitando na barra de endereço — e era a que
  // mais barato enchia o log de 22P02 parecendo incidente de banco.
  const repo = new DashboardRepository();

  for (const [nome, id] of IDS_MALFORMADOS) {
    const leitura = respostaFalsa();
    await repo.getProductById({ params: { id } }, leitura);
    assert.equal(leitura.codigo, 400, `GET ${nome}`);
    assert.notEqual(leitura.corpo.message, "Erro ao buscar produto.", nome);
    assert.match(leitura.corpo.error, /identificador/i, `GET ${nome}`);

    const edicao = respostaFalsa();
    await repo.editProduct(
      { params: { id }, body: { name: "Qualquer", price: 10, quantity: 1 } },
      edicao,
    );
    assert.equal(edicao.codigo, 400, `PUT ${nome}`);
    assert.notEqual(edicao.corpo.message, "Erro ao editar produto.", nome);
    assert.match(edicao.corpo.error, /identificador/i, `PUT ${nome}`);
  }
});

test("o :id malformado nem chega ao banco — a recusa é anterior à consulta", async () => {
  // Sem esta asserção, um `catch (err) { if (err.code === '22P02') 400 }` também
  // passaria nos dois testes acima — e aí o lixo teria ido ao banco, gasto uma
  // conexão do pool e deixado um 22P02 no log do Postgres a cada clique errado.
  // A guarda tem de ser ANTES.
  const consultasAntes = [];
  const poolReal = require("../src/pgPool.js");
  const queryOriginal = poolReal.query.bind(poolReal);
  poolReal.query = (...args) => {
    consultasAntes.push(args[0]);
    return queryOriginal(...args);
  };

  try {
    await new PromotionsRepository().updatePromotion(
      { params: { id: "abc" }, body: { title: "x" } },
      respostaFalsa(),
    );
    await new DashboardRepository().deleteProduct(
      { params: { id: "abc" } },
      respostaFalsa(),
    );
    await new DashboardRepository().getProductById(
      { params: { id: "abc" } },
      respostaFalsa(),
    );
    await new DashboardRepository().editProduct(
      { params: { id: "abc" }, body: { name: "x", price: 1, quantity: 1 } },
      respostaFalsa(),
    );
  } finally {
    poolReal.query = queryOriginal;
  }

  assert.deepEqual(consultasAntes, [], "nenhuma consulta deveria ter saído");
});
