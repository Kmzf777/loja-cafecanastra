"use strict";

/**
 * `motorRepository` contra o banco de verdade.
 *
 * O QUE SÓ APARECE AQUI, e por isso este arquivo sobe um Postgres em vez de
 * mockar o pool:
 *
 *   · A NÃO-DIVERGÊNCIA DO FILTRO DE VIGÊNCIA. O pool do Express conecta como
 *     DONO das tabelas, e o dono não passa por RLS — a política
 *     `promocoes_vigentes_publicas` de 0032 não filtra nada nas consultas do
 *     repositório. Se os dois predicados divergirem, a VITRINE (que lê como
 *     `anon`, sob a política) e a COBRANÇA (que lê como dono, sob o WHERE)
 *     discordam sobre o mesmo carrinho — o defeito que `utils/preco.js` existe
 *     para evitar, só que entre camadas. O teste compara CONJUNTO com CONJUNTO,
 *     sobre o mesmo cenário, com os cinco estados que a vitrine tem de
 *     distinguir sem nenhuma coluna de status existir.
 *   · O CHECK de `documento_hash`. Um CPF cru leva 23514 antes de tocar o
 *     disco, e isso é uma afirmação sobre o BANCO, não sobre o JavaScript.
 *   · O incremento atômico de `promocao_codigos.usos`, que é a trava do
 *     esgotamento e não existe fora de uma transação real.
 *   · "Uma consulta, não N+1" — contável só com um cliente de verdade no meio.
 */

const { test, before, after, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const { createHash } = require("node:crypto");

const { subirPostgres } = require("./ajuda/postgres.js");
const { comoPapel } = require("./ajuda/sessao.js");
const { aplicarMigracoes } = require("../db/migrar.js");

let bd;
let motorRepo;
let hashDeDocumento;
let calcularDescontos;

const ANA = "aaaaaaaa-0000-0000-0000-000000000001";
const DORA = "dddddddd-0000-0000-0000-000000000004";

const CAFE = "cccccccc-0000-4000-8000-000000000001";
const MICROLOTE = "cccccccc-0000-4000-8000-000000000002";

/** Os cinco estados derivados, mais o de código. Nenhum é coluna. */
const VIGENTE = "10000000-0000-4000-8000-000000000001";
const AGENDADA = "10000000-0000-4000-8000-000000000002";
const EXPIRADA = "10000000-0000-4000-8000-000000000003";
const DESABILITADA = "10000000-0000-4000-8000-000000000004";
const ARQUIVADA = "10000000-0000-4000-8000-000000000005";
const COM_CODIGO = "10000000-0000-4000-8000-000000000006";
const SEM_PONTAS = "10000000-0000-4000-8000-000000000007";
const COM_FRETE = "10000000-0000-4000-8000-000000000008";

const CPF_DA_ANA = "52998224725";
const CPF_DA_DORA = "11144477735";
const HASH_DA_ANA = createHash("sha256").update(CPF_DA_ANA).digest("hex");
const HASH_DA_DORA = createHash("sha256").update(CPF_DA_DORA).digest("hex");

/** Cria um pedido mínimo — `promocao_resgates.pedido_id` é NOT NULL com FK. */
async function criarPedido(userId) {
  const { rows } = await bd.pool.query(
    `INSERT INTO canastra.pedidos (user_id, total, status)
     VALUES ($1::uuid, 100, 'pendente') RETURNING pedido_id`,
    [userId],
  );
  return rows[0].pedido_id;
}

async function idsVigentes(contexto) {
  const regras = await motorRepo.carregarRegrasVigentes(contexto);
  return regras.map((r) => r.id);
}

before(async () => {
  bd = await subirPostgres();
  await aplicarMigracoes(bd.pool);

  await bd.pool.query(
    "INSERT INTO auth.users (id, email) VALUES ($1, 'ana@ex.com'), ($2, 'dora@ex.com')",
    [ANA, DORA],
  );
  await bd.pool.query(
    "INSERT INTO canastra.clientes (user_id, nome) VALUES ($1, 'Ana'), ($2, 'Dora')",
    [ANA, DORA],
  );
  await bd.pool.query(
    `INSERT INTO canastra.produtos (produto_id, nome, preco, quantidade, sku, categoria)
     VALUES ($1, 'Clássico', 50.00, 100, 'CLAS-250', 'Café'),
            ($2, 'Micro-lote', 120.00, 100, 'MICRO-250', 'Especial')`,
    [CAFE, MICROLOTE],
  );

  /**
   * O CENÁRIO É O MESMO PARA OS DOIS LADOS DA COMPARAÇÃO. Cada linha aqui
   * existe para separar um estado do outro: só `VIGENTE`, `SEM_PONTAS` e
   * `COM_FRETE` valem agora; `COM_CODIGO` vale, mas só quando o código é
   * digitado; e as quatro do meio são as que a vitrine NÃO pode enxergar.
   */
  await bd.pool.query(
    `INSERT INTO canastra.promocoes
       (id, nome, metodo, classe, mecanica, valor, prioridade,
        inicio_em, fim_em, habilitada, arquivada_em, criada_em)
     VALUES
       ($1, 'Vigente 10%',    'automatico', 'produto', 'percentual', 10, 50,
        now() - interval '1 day', now() + interval '1 day', true, NULL, now()),
       ($2, 'Agendada',       'automatico', 'produto', 'percentual', 10, 0,
        now() + interval '1 day', now() + interval '2 day', true, NULL, now()),
       ($3, 'Expirada',       'automatico', 'produto', 'percentual', 10, 0,
        now() - interval '2 day', now() - interval '1 day', true, NULL, now()),
       ($4, 'Desabilitada',   'automatico', 'produto', 'percentual', 10, 0,
        now() - interval '1 day', now() + interval '1 day', false, NULL, now()),
       ($5, 'Arquivada',      'automatico', 'produto', 'percentual', 10, 0,
        now() - interval '1 day', now() + interval '1 day', true, now(), now()),
       ($6, 'Cupom CAFE20',   'codigo',     'pedido',  'percentual', 20, 0,
        NULL, NULL, true, NULL, now()),
       ($7, 'Sem pontas 5%',  'automatico', 'pedido',  'percentual',  5, 10,
        NULL, NULL, true, NULL, now()),
       ($8, 'Frete grátis',   'automatico', 'frete',   'frete_gratis', NULL, 1,
        NULL, NULL, true, NULL, now())`,
    [VIGENTE, AGENDADA, EXPIRADA, DESABILITADA, ARQUIVADA, COM_CODIGO, SEM_PONTAS, COM_FRETE],
  );

  await bd.pool.query(
    `INSERT INTO canastra.promocao_codigos (promocao_id, codigo, limite_usos)
     VALUES ($1, 'CAFE20', NULL)`,
    [COM_CODIGO],
  );

  // Escopo com exceção — "10% na loja toda MENOS o micro-lote", a frase que o
  // escopo legado (três colunas mutuamente exclusivas) não conseguia escrever.
  await bd.pool.query(
    `INSERT INTO canastra.promocao_escopo (promocao_id, tipo, alvo, incluir)
     VALUES ($1, 'todos', NULL, true),
            ($1, 'produto', $2, false)`,
    [VIGENTE, MICROLOTE],
  );

  await bd.pool.query(
    `INSERT INTO canastra.promocao_faixas (promocao_id, quantidade_min, desconto_tipo, desconto_valor)
     VALUES ($1, 3, 'percentual', 5), ($1, 6, 'percentual', 10)`,
    [SEM_PONTAS],
  );

  await bd.pool.query(
    `INSERT INTO canastra.promocao_frete
       (promocao_id, teto_frete_centavos, ufs, apenas_modalidade_mais_barata,
        cep_inicio, cep_fim)
     VALUES ($1, 3000, ARRAY['MG','SP'], true, '30000000', '39999999')`,
    [COM_FRETE],
  );

  process.env.DATABASE_URL = bd.connectionString;

  motorRepo = require("../src/repositories/motorRepository.js");
  ({ hashDeDocumento } = motorRepo);
  ({ calcularDescontos } = require("../src/utils/motor.js"));
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
 * A não-divergência dos dois filtros de vigência
 * -------------------------------------------------------------------------- */

/**
 * ESTA É A ASSERÇÃO CENTRAL DO ARQUIVO.
 *
 * Ela não compara TEXTO de predicado — comparar strings de SQL passaria verde
 * com um espaço a mais e falharia com um parêntese a mais, e nenhuma das duas
 * coisas é o que importa. Ela compara o CONJUNTO DE LINHAS que cada lado
 * enxerga, sobre o mesmo cenário, com os cinco estados representados. Se um dia
 * alguém estreitar a política (ou alargar o WHERE), este teste fica vermelho
 * dizendo exatamente qual promoção mudou de lado.
 */
test("o filtro de vigência do repositório é o MESMO que a política de anon enxerga", async () => {
  const peloRepositorio = (await idsVigentes())
    .filter((id) => id !== COM_CODIGO)
    .sort();

  const pelaPolitica = await comoPapel(bd.pool, { papel: "anon" }, async (cliente) => {
    const { rows } = await cliente.query(
      "SELECT id FROM canastra.promocoes ORDER BY id",
    );
    return rows.map((r) => r.id);
  });

  assert.deepEqual(
    peloRepositorio,
    pelaPolitica.slice().sort(),
    "vitrine e cobrança têm de ver as MESMAS regras automáticas",
  );

  // E o conjunto é o esperado, não um vazio dos dois lados por acidente — um
  // teste de igualdade entre dois conjuntos vazios prova nada.
  assert.deepEqual(peloRepositorio, [VIGENTE, SEM_PONTAS, COM_FRETE].sort());
  assert.ok(!peloRepositorio.includes(AGENDADA), "campanha agendada não vaza");
  assert.ok(!peloRepositorio.includes(EXPIRADA));
  assert.ok(!peloRepositorio.includes(DESABILITADA));
  assert.ok(!peloRepositorio.includes(ARQUIVADA));
});

test("regra de CÓDIGO não sai sem código, e a política de anon também não a mostra", async () => {
  const semCodigo = await idsVigentes();
  assert.ok(!semCodigo.includes(COM_CODIGO), "o mapa de descontos não sai por GET");

  const comCodigo = await idsVigentes({ codigo: "CAFE20" });
  assert.ok(comCodigo.includes(COM_CODIGO));

  // A política de `anon` também recorta por `metodo = 'automatico'` — o
  // recorte de PUBLICIDADE, separado do de vigência. Os dois lados concordam.
  const pelaPolitica = await comoPapel(bd.pool, { papel: "anon" }, async (cliente) => {
    const { rows } = await cliente.query(
      "SELECT count(*)::int AS n FROM canastra.promocoes WHERE metodo = 'codigo'",
    );
    return rows[0].n;
  });
  assert.equal(pelaPolitica, 0);
});

test("código desconhecido, inativo ou esgotado não traz a regra", async () => {
  assert.ok(!(await idsVigentes({ codigo: "FANTASMA" })).includes(COM_CODIGO));

  await bd.pool.query(
    "UPDATE canastra.promocao_codigos SET ativo = false WHERE codigo = 'CAFE20'",
  );
  assert.ok(!(await idsVigentes({ codigo: "CAFE20" })).includes(COM_CODIGO));
  await bd.pool.query(
    "UPDATE canastra.promocao_codigos SET ativo = true WHERE codigo = 'CAFE20'",
  );

  await bd.pool.query(
    "UPDATE canastra.promocao_codigos SET limite_usos = 1, usos = 1 WHERE codigo = 'CAFE20'",
  );
  assert.ok(!(await idsVigentes({ codigo: "CAFE20" })).includes(COM_CODIGO));
  await bd.pool.query(
    "UPDATE canastra.promocao_codigos SET limite_usos = NULL, usos = 0 WHERE codigo = 'CAFE20'",
  );
  assert.ok((await idsVigentes({ codigo: "CAFE20" })).includes(COM_CODIGO));
});

/* --------------------------------------------------------------------------
 * Os filhos vêm juntos, e numa consulta só
 * -------------------------------------------------------------------------- */

test("escopo, faixas e frete chegam no formato do motor, na MESMA consulta", async () => {
  let consultas = 0;
  const espiao = {
    query: (...args) => {
      consultas += 1;
      return bd.pool.query(...args);
    },
  };

  const regras = await motorRepo.carregarRegrasVigentes({
    codigo: "CAFE20",
    client: espiao,
  });

  // UMA. Um `for` de promoções com uma consulta de escopo dentro seria uma
  // consulta por campanha cadastrada, no caminho mais quente da loja.
  assert.equal(consultas, 1, "uma consulta, não N+1");

  const porId = new Map(regras.map((r) => [r.id, r]));

  assert.deepEqual(porId.get(VIGENTE).escopo, [
    { tipo: "todos", alvo: null, incluir: true },
    { tipo: "produto", alvo: MICROLOTE, incluir: false },
  ]);

  assert.deepEqual(porId.get(SEM_PONTAS).faixas, [
    { quantidadeMin: 3, descontoTipo: "percentual", descontoValor: 5 },
    { quantidadeMin: 6, descontoTipo: "percentual", descontoValor: 10 },
  ]);

  assert.deepEqual(porId.get(COM_FRETE).frete, {
    tetoFreteCentavos: 3000,
    ufs: ["MG", "SP"],
    apenasModalidadeMaisBarata: true,
    cepInicio: "30000000",
    cepFim: "39999999",
  });
  assert.equal(porId.get(VIGENTE).frete, null, "quem não tem linha de frete vem nulo");

  assert.deepEqual(porId.get(COM_CODIGO).codigo, {
    id: porId.get(COM_CODIGO).codigo.id,
    codigo: "CAFE20",
  });
  assert.equal(porId.get(VIGENTE).codigo, null);

  // E a ordem já sai por prioridade decrescente — o motor reordena de novo
  // (ele é puro e não confia na entrada), mas a consulta não devolve heap.
  const automaticas = regras.filter((r) => r.metodo === "automatico");
  assert.deepEqual(
    automaticas.map((r) => r.nome),
    ["Vigente 10%", "Sem pontas 5%", "Frete grátis"],
  );
});

test("o que o repositório carrega alimenta o motor sem tradução no meio", async () => {
  const regras = await motorRepo.carregarRegrasVigentes({ codigo: "CAFE20" });
  const resultado = calcularDescontos(
    {
      itens: [
        { produtoId: CAFE, sku: "CLAS-250", categoria: "Café", precoCentavos: 5000, quantidade: 2 },
        { produtoId: MICROLOTE, sku: "MICRO-250", categoria: "Especial", precoCentavos: 12000, quantidade: 1 },
      ],
      meioPagamento: "pix",
      assinante: false,
      frete: { valorCentavos: 2500, metodo: "PAC", ehMaisBarata: true, uf: "MG", cep: "38402330" },
    },
    regras,
  );

  // Etapa 1: 10% sobre os 100,00 do clássico (o micro-lote está EXCLUÍDO) = 10,00.
  // Etapa 2 sobre os 210,00 que sobraram: "Sem pontas" 5% = 10,50 e o cupom
  // 20% = 42,00, nesta ORDEM (prioridade 10 contra 0) e os dois sobre a MESMA
  // base — compostos dariam 39,90 no segundo. Etapa 3: frete grátis de 25,00
  // (MG, CEP na faixa, abaixo do teto de 30,00, modalidade mais barata).
  assert.deepEqual(
    resultado.ajustes.map((a) => [a.alvo, a.valorCentavos]),
    [
      ["item", 1000],
      ["pedido", 1050],
      ["pedido", 4200],
      ["frete", 2500],
    ],
  );
  assert.equal(resultado.totalCentavos, 8750);
});

/* --------------------------------------------------------------------------
 * Limites — a verdade mora em `promocao_resgates`
 * -------------------------------------------------------------------------- */

test("limite_usos conta resgates NÃO estornados; o estorno devolve a vaga", async () => {
  await bd.pool.query(
    "UPDATE canastra.promocoes SET limite_usos = 1 WHERE id = $1",
    [SEM_PONTAS],
  );
  try {
    assert.ok((await idsVigentes()).includes(SEM_PONTAS));

    const pedido = await criarPedido(ANA);
    await bd.pool.query(
      `INSERT INTO canastra.promocao_resgates (promocao_id, pedido_id, valor_centavos)
       VALUES ($1, $2, 1050)`,
      [SEM_PONTAS, pedido],
    );
    assert.ok(!(await idsVigentes()).includes(SEM_PONTAS), "esgotada some");

    // Pedido cancelado devolve o uso — e é `estornado_em`, não DELETE, porque
    // apagar a linha apagaria o registro de que a campanha foi tentada.
    await motorRepo.estornarResgatesDoPedido(pedido, bd.pool);
    assert.ok((await idsVigentes()).includes(SEM_PONTAS), "estorno devolve a vaga");
  } finally {
    await bd.pool.query(
      "UPDATE canastra.promocoes SET limite_usos = NULL WHERE id = $1",
      [SEM_PONTAS],
    );
    await bd.pool.query("DELETE FROM canastra.promocao_resgates");
    await bd.pool.query("DELETE FROM canastra.pedidos");
  }
});

test("limite_por_cliente é por CPF, e some só para quem já usou", async () => {
  await bd.pool.query(
    "UPDATE canastra.promocoes SET limite_por_cliente = 1 WHERE id = $1",
    [SEM_PONTAS],
  );
  try {
    const pedido = await criarPedido(ANA);
    await bd.pool.query(
      `INSERT INTO canastra.promocao_resgates
         (promocao_id, pedido_id, user_id, documento_hash, valor_centavos)
       VALUES ($1, $2, $3, $4, 1050)`,
      [SEM_PONTAS, pedido, ANA, HASH_DA_ANA],
    );

    assert.ok(!(await idsVigentes({ documentoHash: HASH_DA_ANA })).includes(SEM_PONTAS));
    assert.ok((await idsVigentes({ documentoHash: HASH_DA_DORA })).includes(SEM_PONTAS));
    // Convidado sem CPF: o limite por cliente simplesmente não se aplica —
    // é o que a coluna nulável de 0032 diz, e não um esquecimento.
    assert.ok((await idsVigentes()).includes(SEM_PONTAS));
  } finally {
    await bd.pool.query(
      "UPDATE canastra.promocoes SET limite_por_cliente = NULL WHERE id = $1",
      [SEM_PONTAS],
    );
    await bd.pool.query("DELETE FROM canastra.promocao_resgates");
    await bd.pool.query("DELETE FROM canastra.pedidos");
  }
});

test("orcamento_centavos corta a campanha quando o gasto o alcança", async () => {
  await bd.pool.query(
    "UPDATE canastra.promocoes SET orcamento_centavos = 2000 WHERE id = $1",
    [SEM_PONTAS],
  );
  try {
    const pedido = await criarPedido(ANA);
    await bd.pool.query(
      `INSERT INTO canastra.promocao_resgates (promocao_id, pedido_id, valor_centavos)
       VALUES ($1, $2, 1999)`,
      [SEM_PONTAS, pedido],
    );
    assert.ok((await idsVigentes()).includes(SEM_PONTAS), "1 centavo de folga ainda vale");

    await bd.pool.query(
      "UPDATE canastra.promocao_resgates SET valor_centavos = 2000 WHERE pedido_id = $1",
      [pedido],
    );
    assert.ok(!(await idsVigentes()).includes(SEM_PONTAS));
  } finally {
    await bd.pool.query(
      "UPDATE canastra.promocoes SET orcamento_centavos = NULL WHERE id = $1",
      [SEM_PONTAS],
    );
    await bd.pool.query("DELETE FROM canastra.promocao_resgates");
    await bd.pool.query("DELETE FROM canastra.pedidos");
  }
});

/* --------------------------------------------------------------------------
 * O hash do CPF
 * -------------------------------------------------------------------------- */

test("hashDeDocumento produz o que o CHECK aceita; o CPF cru leva 23514", async () => {
  assert.equal(hashDeDocumento("529.982.247-25"), HASH_DA_ANA);
  assert.equal(hashDeDocumento(CPF_DA_ANA), HASH_DA_ANA);
  assert.match(hashDeDocumento(CPF_DA_ANA), /^[0-9a-f]{64}$/);
  // Documento que não é CPF vira `null` em vez de virar um hash de lixo: ali o
  // limite por cliente não se aplica, e é o que a coluna nulável diz.
  assert.equal(hashDeDocumento("123"), null);
  assert.equal(hashDeDocumento(""), null);
  assert.equal(hashDeDocumento(null), null);

  const pedido = await criarPedido(ANA);
  try {
    await assert.rejects(
      () =>
        bd.pool.query(
          `INSERT INTO canastra.promocao_resgates
             (promocao_id, pedido_id, documento_hash, valor_centavos)
           VALUES ($1, $2, $3, 100)`,
          [SEM_PONTAS, pedido, CPF_DA_ANA],
        ),
      (erro) => {
        // 23514 = check_violation. É o banco recusando o número de documento
        // ANTES de escrevê-lo no disco — a garantia de que "combinamos de
        // guardar o hash" não depende de ninguém lembrar.
        assert.equal(erro.code, "23514");
        return true;
      },
    );
  } finally {
    await bd.pool.query("DELETE FROM canastra.pedidos");
  }
});

/* --------------------------------------------------------------------------
 * A trava do esgotamento
 * -------------------------------------------------------------------------- */

test("reservarCodigo é atômico: o segundo uso do limite 1 recebe false", async () => {
  await bd.pool.query(
    "UPDATE canastra.promocao_codigos SET limite_usos = 1, usos = 0 WHERE codigo = 'CAFE20'",
  );
  const { rows } = await bd.pool.query(
    "SELECT id FROM canastra.promocao_codigos WHERE codigo = 'CAFE20'",
  );
  const codigoId = rows[0].id;

  const cliente = await bd.pool.connect();
  try {
    await cliente.query("BEGIN");
    assert.equal(await motorRepo.reservarCodigo(codigoId, cliente), true);
    assert.equal(
      await motorRepo.reservarCodigo(codigoId, cliente),
      false,
      "a MESMA linha de SQL que soma o uso é a que confere o limite",
    );
    await cliente.query("ROLLBACK");
  } finally {
    cliente.release();
  }

  // O ROLLBACK devolveu o uso de graça — é por isso que o incremento vive
  // DENTRO da transação de reserva de estoque.
  const { rows: depois } = await bd.pool.query(
    "SELECT usos FROM canastra.promocao_codigos WHERE codigo = 'CAFE20'",
  );
  assert.equal(depois[0].usos, 0);

  await bd.pool.query(
    "UPDATE canastra.promocao_codigos SET limite_usos = NULL, usos = 0 WHERE codigo = 'CAFE20'",
  );
});

test("devolverCodigo não deixa o contador negativo (o CHECK vira no-op)", async () => {
  const { rows } = await bd.pool.query(
    "SELECT id FROM canastra.promocao_codigos WHERE codigo = 'CAFE20'",
  );
  const codigoId = rows[0].id;

  assert.equal(await motorRepo.devolverCodigo(codigoId, bd.pool), false);
  const { rows: depois } = await bd.pool.query(
    "SELECT usos FROM canastra.promocao_codigos WHERE id = $1",
    [codigoId],
  );
  assert.equal(depois[0].usos, 0, "uma devolução a mais é no-op, não 23514");
});

/* --------------------------------------------------------------------------
 * As duas tabelas de registro
 * -------------------------------------------------------------------------- */

test("gravarResgates e gravarAjustes escrevem a decomposição do pedido", async () => {
  const pedido = await criarPedido(ANA);
  const cliente = await bd.pool.connect();
  try {
    await cliente.query("BEGIN");
    await motorRepo.gravarResgates(cliente, {
      pedidoId: pedido,
      userId: ANA,
      documentoHash: HASH_DA_ANA,
      resgates: [{ promocaoId: VIGENTE, codigoId: null, valorCentavos: 1000 }],
    });
    // Reentrega de webhook: o UNIQUE (promocao_id, pedido_id) faz a segunda
    // gravação virar zero linhas, não uma segunda venda no relatório.
    const repetido = await motorRepo.gravarResgates(cliente, {
      pedidoId: pedido,
      resgates: [{ promocaoId: VIGENTE, codigoId: null, valorCentavos: 1000 }],
    });
    assert.deepEqual(repetido, []);

    await motorRepo.gravarAjustes(cliente, pedido, [
      { sequencia: 1, promocaoId: VIGENTE, codigo: null, alvo: "item", alvoRef: CAFE, valorCentavos: 1000, rotulo: "Vigente 10%" },
      { sequencia: 2, promocaoId: COM_CODIGO, codigo: "CAFE20", alvo: "pedido", alvoRef: null, valorCentavos: 4200, rotulo: "Cupom CAFE20" },
    ]);
    await cliente.query("COMMIT");
  } finally {
    cliente.release();
  }

  const { rows } = await bd.pool.query(
    `SELECT sequencia, alvo, alvo_ref, valor_centavos, codigo, rotulo
       FROM canastra.pedido_ajustes_desconto
      WHERE pedido_id = $1 ORDER BY sequencia`,
    [pedido],
  );
  assert.equal(rows.length, 2);
  assert.equal(rows[0].alvo_ref, CAFE);
  assert.equal(rows[1].codigo, "CAFE20");
  assert.equal(rows[0].valor_centavos + rows[1].valor_centavos, 5200);

  const { rows: resgates } = await bd.pool.query(
    "SELECT count(*)::int AS n FROM canastra.promocao_resgates WHERE pedido_id = $1",
    [pedido],
  );
  assert.equal(resgates[0].n, 1);

  await bd.pool.query("DELETE FROM canastra.pedidos WHERE pedido_id = $1", [pedido]);
});

test("nem a admin escreve nas duas tabelas de registro — é REVOKE, não política", async () => {
  const pedido = await criarPedido(ANA);
  await bd.pool.query(
    "INSERT INTO canastra.admins (user_id) VALUES ($1) ON CONFLICT DO NOTHING",
    [ANA],
  );
  try {
    for (const sql of [
      `INSERT INTO canastra.promocao_resgates (promocao_id, pedido_id, valor_centavos)
       VALUES ('${VIGENTE}', '${pedido}', 100)`,
      `INSERT INTO canastra.pedido_ajustes_desconto
         (pedido_id, alvo, sequencia, valor_centavos, rotulo)
       VALUES ('${pedido}', 'pedido', 1, 100, 'x')`,
    ]) {
      await assert.rejects(
        () =>
          comoPapel(bd.pool, { papel: "authenticated", sub: ANA }, (c) => c.query(sql)),
        (erro) => {
          // 42501 = insufficient_privilege. O recorte é de OPERAÇÃO INTEIRA, e
          // por isso mora no privilégio e não numa política — as duas linhas
          // nascem na transação do checkout, pelo pool do Express, que conecta
          // como dono. É de propósito; não se "conserta".
          assert.equal(erro.code, "42501");
          return true;
        },
      );
    }
  } finally {
    // A admin FICA: o gatilho `admins_nunca_zero` (0002) recusa remover a
    // última, com 23001, e este é o último teste do arquivo — limpar aqui
    // trocaria uma asserção verde por um erro de teardown.
    await bd.pool.query("DELETE FROM canastra.pedidos WHERE pedido_id = $1", [pedido]);
  }
});
