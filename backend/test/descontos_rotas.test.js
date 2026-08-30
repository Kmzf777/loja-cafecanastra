"use strict";

/**
 * As rotas de administração do motor de promoção — `/admin/descontos`.
 *
 * A Onda 3 criou as sete tabelas de `0032_motor_de_promocao.sql` e a Onda 4
 * escreveu o motor (`utils/motor.js` + `repositories/motorRepository.js`), mas
 * nenhuma rota de administração foi montada: `promotions.routes.js` continua
 * servindo a tabela LEGADA (`promocoes_legado`), que é outra coisa. A tela de
 * Descontos já existe, já tem teste, e degradava com frase porque a rota
 * respondia 404. Este arquivo é o contrato HTTP que a fecha.
 *
 * O TESTE RODA O ROUTER DE VERDADE, com a PILHA REAL de middlewares no meio —
 * molde de `vitrine_rotas.test.js`. É o que faz "sem token responde 401" ser
 * uma afirmação sobre a ROTA e não sobre `isAuthenticated`: o dia em que
 * alguém montar um PUT sem os guardas, um teste de repositório continuaria
 * verde e este fica vermelho.
 *
 * O DETALHE QUE QUEBRA TUDO SE ESQUECIDO: `process.env.DATABASE_URL` é
 * definida ANTES do `require` dos módulos de `src/` — o `pgPool` lê a variável
 * no momento do require, e um require no topo do arquivo pegaria `undefined` e
 * todo teste falharia com "connection refused" apontando para lugar nenhum.
 *
 * AS QUATRO ARMADILHAS QUE ESTE ARQUIVO EXISTE PARA NÃO REPETIR, todas com
 * endereço nesta loja:
 *
 *   1. `PUT /config` — corpo multipart, campo enviado VAZIO sobrescrevendo, e
 *      `Number('')` virando 0 no mínimo de frete grátis: o gestor salvava a
 *      barra de aviso e desligava o frete grátis da loja inteira.
 *   2. `PUT /promotions/:id` — campo AUSENTE virando NULL, isto é, um
 *      formulário que mandasse só o campo alterado apagava título e datas.
 *   3. A mesma rota respondendo `200 "Promocao atualizada."` para id que não
 *      existe, tendo atualizado zero linhas.
 *   4. `promocao_resgates.codigo_id` é `ON DELETE RESTRICT`: apagar um código
 *      já usado não é uma escolha de produto, é um 23503 no meio do PUT.
 */

const { test, before, after, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const jwt = require("jsonwebtoken");
const { subirPostgres } = require("./ajuda/postgres.js");
const { aplicarMigracoes } = require("../db/migrar.js");

let bd;
let descontosRoutes;

const ANA = "aaaaaaaa-0000-0000-0000-000000000001"; // cliente
const DORA = "dddddddd-0000-0000-0000-000000000004"; // administradora

const CAFE = "cccccccc-0000-4000-8000-000000000001";

const SEGREDO = "segredo-de-teste-com-tamanho-suficiente-para-hs256";

function token(sub) {
  return jwt.sign({ sub, role: "authenticated" }, SEGREDO, { expiresIn: "1h" });
}

/** Dublê de `res` — `terminou` é o que separa "respondeu" de "ainda pendura". */
function respostaFalsa() {
  const res = { codigo: null, corpo: null };
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

/**
 * Uma requisição pela pilha real do router.
 *
 * `req.query` é preenchida à mão porque quem a monta é o middleware `query` do
 * APP, e aqui só o router está de pé — sem isso, `req.query` seria `undefined`
 * e a listagem estouraria por um motivo que não é o do teste.
 */
async function chamar({ metodo = "GET", caminho, corpo, consulta = {}, sub = null } = {}) {
  const req = {
    method: metodo,
    url: caminho,
    originalUrl: caminho,
    headers: {},
    query: consulta,
    body: corpo,
  };
  if (sub) req.headers.authorization = `Bearer ${token(sub)}`;

  const res = respostaFalsa();
  const semRota = new Promise((resolve, reject) => {
    descontosRoutes(req, res, (erro) => (erro ? reject(erro) : resolve("SEM ROTA")));
  });

  const desfecho = await Promise.race([res.terminou, semRota]);
  assert.notEqual(
    desfecho,
    "SEM ROTA",
    `nenhuma rota casou com ${metodo} ${caminho} — a linha de registro sumiu de descontos.routes.js`,
  );
  return res;
}

/** O payload mínimo que a tela manda (`montarPayload` com o formulário vazio). */
function regraBase(mudancas = {}) {
  return {
    nome: "Dez por cento",
    descricao: null,
    metodo: "automatico",
    classe: "pedido",
    mecanica: "percentual",
    valor: 10,
    teto_desconto_centavos: null,
    minimo_tipo: "nenhum",
    minimo_valor: null,
    prioridade: 0,
    exclusiva: false,
    grupo_exclusividade: null,
    meios_pagamento: null,
    limite_usos: null,
    limite_por_cliente: null,
    orcamento_centavos: null,
    inicio_em: null,
    fim_em: null,
    habilitada: true,
    escopo: [],
    faixas: [],
    frete: null,
    codigos: [],
    ...mudancas,
  };
}

async function criarRegra(mudancas = {}) {
  const res = await chamar({
    metodo: "POST",
    caminho: "/admin/descontos",
    corpo: regraBase(mudancas),
    sub: DORA,
  });
  assert.equal(res.codigo, 201, `esperava 201 e veio ${res.codigo}: ${JSON.stringify(res.corpo)}`);
  return res.corpo;
}

/** Um pedido mínimo — `promocao_resgates.pedido_id` é NOT NULL com FK. */
async function criarPedido() {
  const { rows } = await bd.pool.query(
    `INSERT INTO canastra.pedidos (user_id, total, status)
     VALUES ($1::uuid, 100, 'pendente') RETURNING pedido_id`,
    [ANA],
  );
  return rows[0].pedido_id;
}

async function resgatar(promocaoId, { codigoId = null, centavos = 500, estornado = false } = {}) {
  const pedidoId = await criarPedido();
  await bd.pool.query(
    `INSERT INTO canastra.promocao_resgates
       (promocao_id, codigo_id, pedido_id, user_id, valor_centavos, estornado_em)
     VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, $5,
             CASE WHEN $6 THEN now() END)`,
    [promocaoId, codigoId, pedidoId, ANA, centavos, estornado],
  );
}

async function contarLogs() {
  const { rows } = await bd.pool.query(
    "SELECT acao, entidade, entidade_id, antes, depois FROM canastra.admin_log ORDER BY criado_em",
  );
  return rows;
}

before(async () => {
  bd = await subirPostgres();
  await aplicarMigracoes(bd.pool);

  await bd.pool.query(
    "INSERT INTO auth.users (id, email) VALUES ($1,'ana@ex.com'), ($2,'dora@ex.com')",
    [ANA, DORA],
  );
  await bd.pool.query(
    "INSERT INTO canastra.clientes (user_id, nome) VALUES ($1,'Ana'), ($2,'Dora')",
    [ANA, DORA],
  );
  await bd.pool.query("INSERT INTO canastra.admins (user_id) VALUES ($1)", [DORA]);
  await bd.pool.query(
    `INSERT INTO canastra.produtos (produto_id, nome, preco, quantidade, sku, categoria)
     VALUES ($1, 'Clássico', 60.00, 100, 'CLAS-250', 'Café')`,
    [CAFE],
  );

  process.env.SUPABASE_JWT_SECRET = SEGREDO;
  process.env.DATABASE_URL = bd.connectionString;

  descontosRoutes = require("../src/routes/descontos.routes.js");
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
  // `promocao_resgates` referencia `promocoes` com ON DELETE RESTRICT e
  // `pedidos` com CASCADE — o TRUNCATE precisa das quatro juntas.
  await bd.pool.query(
    `TRUNCATE canastra.promocoes, canastra.promocao_resgates,
              canastra.pedido_ajustes_desconto, canastra.pedidos,
              canastra.admin_log CASCADE`,
  );
});

/* --------------------------------------------------------------------------
 * Os dois guardas, em toda porta
 * -------------------------------------------------------------------------- */

test("GET /admin/descontos sem token responde 401", async () => {
  const res = await chamar({ caminho: "/admin/descontos" });
  assert.equal(res.codigo, 401);
});

test("GET /admin/descontos com token de cliente responde 403", async () => {
  // Ana passa por `isAuthenticated` inteiro, inclusive pela conferência de
  // vínculo em `canastra.clientes`. O que a barra é a linha que ela NÃO tem em
  // `canastra.admins` — ser administrador nunca é claim de JWT.
  const res = await chamar({ caminho: "/admin/descontos", sub: ANA });
  assert.equal(res.codigo, 403);
});

test("POST /admin/descontos sem token responde 401 e não grava nada", async () => {
  const res = await chamar({
    metodo: "POST",
    caminho: "/admin/descontos",
    corpo: regraBase(),
  });
  assert.equal(res.codigo, 401);
  const { rows } = await bd.pool.query("SELECT count(*)::int AS n FROM canastra.promocoes");
  assert.equal(rows[0].n, 0);
});

test("POST /admin/descontos/simular com token de cliente responde 403", async () => {
  const res = await chamar({
    metodo: "POST",
    caminho: "/admin/descontos/simular",
    corpo: { regra: regraBase(), carrinho: { itens: [] } },
    sub: ANA,
  });
  assert.equal(res.codigo, 403);
});

/* --------------------------------------------------------------------------
 * Criar
 * -------------------------------------------------------------------------- */

test("POST cria a regra inteira — cabeçalho, escopo, faixas, frete e códigos", async () => {
  const regra = await criarRegra({
    nome: "Frete grátis no Sudeste",
    classe: "frete",
    mecanica: "frete_gratis",
    valor: null,
    minimo_tipo: "subtotal",
    minimo_valor: 14900,
    meios_pagamento: ["pix"],
    metodo: "codigo",
    escopo: [
      { tipo: "categoria", alvo: "Café", incluir: true },
      { tipo: "assinante", alvo: null, incluir: true },
    ],
    faixas: [],
    frete: {
      teto_frete_centavos: 3500,
      ufs: ["SP", "MG"],
      apenas_modalidade_mais_barata: true,
      cep_inicio: "01310100",
      cep_fim: "01310999",
    },
    codigos: [{ codigo: "CAFE20", uso_unico: false, limite_usos: 100, ativo: true }],
  });

  assert.equal(regra.nome, "Frete grátis no Sudeste");
  assert.equal(regra.classe, "frete");
  assert.equal(regra.minimo_valor, 14900);
  assert.deepEqual(regra.meios_pagamento, ["pix"]);
  assert.equal(regra.escopo.length, 2);
  assert.deepEqual(regra.frete, {
    teto_frete_centavos: 3500,
    ufs: ["SP", "MG"],
    apenas_modalidade_mais_barata: true,
    cep_inicio: "01310100",
    cep_fim: "01310999",
  });
  assert.deepEqual(regra.codigos, ["CAFE20"]);
  assert.equal(regra.codigos_detalhe[0].limite_usos, 100);
  assert.equal(regra.codigos_detalhe[0].usos, 0);
  // Os derivados nascem zerados e NUNCA são coluna gravada.
  assert.equal(regra.usos, 0);
  assert.equal(regra.descontado_centavos, 0);
  assert.equal(regra.arquivada_em, null);
});

test("POST grava a linha de auditoria com autor e id", async () => {
  const regra = await criarRegra();
  const logs = await contarLogs();
  assert.equal(logs.length, 1);
  assert.equal(logs[0].acao, "promocao_criada");
  assert.equal(logs[0].entidade, "promocao");
  assert.equal(logs[0].entidade_id, regra.id);
});

test("POST recusa `brinde` com frase — o banco aceita e o motor não calcula", async () => {
  const res = await chamar({
    metodo: "POST",
    caminho: "/admin/descontos",
    corpo: regraBase({ mecanica: "brinde", valor: null }),
    sub: DORA,
  });
  assert.equal(res.codigo, 400);
  assert.match(res.corpo.error, /brinde/i);
});

test("POST recusa percentual acima de 90 com frase, e não com 23514", async () => {
  const res = await chamar({
    metodo: "POST",
    caminho: "/admin/descontos",
    corpo: regraBase({ valor: 95 }),
    sub: DORA,
  });
  assert.equal(res.codigo, 400);
  assert.match(res.corpo.error, /90/);
});

test("POST recusa regra sem nome", async () => {
  const res = await chamar({
    metodo: "POST",
    caminho: "/admin/descontos",
    corpo: regraBase({ nome: "   " }),
    sub: DORA,
  });
  assert.equal(res.codigo, 400);
});

test("POST recusa mínimo incoerente — 'subtotal' sem valor é 'acima de nada'", async () => {
  const res = await chamar({
    metodo: "POST",
    caminho: "/admin/descontos",
    corpo: regraBase({ minimo_tipo: "subtotal", minimo_valor: null }),
    sub: DORA,
  });
  assert.equal(res.codigo, 400);
});

test("POST recusa progressivo sem faixa — a regra nasceria inerte", async () => {
  const res = await chamar({
    metodo: "POST",
    caminho: "/admin/descontos",
    corpo: regraBase({ mecanica: "progressivo", valor: null, faixas: [] }),
    sub: DORA,
  });
  assert.equal(res.codigo, 400);
});

test("POST recusa código já usado por OUTRA regra, com o código na frase", async () => {
  await criarRegra({
    metodo: "codigo",
    codigos: [{ codigo: "CAFE20", uso_unico: false, limite_usos: null, ativo: true }],
  });

  const res = await chamar({
    metodo: "POST",
    caminho: "/admin/descontos",
    corpo: regraBase({
      nome: "Outra",
      metodo: "codigo",
      codigos: [{ codigo: "CAFE20", uso_unico: false, limite_usos: null, ativo: true }],
    }),
    sub: DORA,
  });
  assert.equal(res.codigo, 409);
  assert.match(res.corpo.error, /CAFE20/);

  // E a recusa é ATÔMICA: a segunda regra não ficou pela metade no banco.
  const { rows } = await bd.pool.query("SELECT count(*)::int AS n FROM canastra.promocoes");
  assert.equal(rows[0].n, 1);
});

/* --------------------------------------------------------------------------
 * Listar
 * -------------------------------------------------------------------------- */

test("GET /admin/descontos devolve a forma que a tela espera", async () => {
  await criarRegra();
  const res = await chamar({
    caminho: "/admin/descontos",
    consulta: { pagina: "1", limite: "20" },
    sub: DORA,
  });

  assert.equal(res.codigo, 200);
  assert.equal(Array.isArray(res.corpo.data), true);
  assert.equal(res.corpo.total, 1);
  assert.equal(res.corpo.pagina, 1);
  assert.equal(res.corpo.totalPaginas, 1);
  // `valor` é `numeric(10,2)`: chega como STRING, para não perder precisão.
  assert.equal(typeof res.corpo.data[0].valor, "string");
});

test("usos e descontado_centavos vêm dos resgates NÃO estornados", async () => {
  const regra = await criarRegra();
  await resgatar(regra.id, { centavos: 1200 });
  await resgatar(regra.id, { centavos: 800 });
  await resgatar(regra.id, { centavos: 5000, estornado: true });

  const res = await chamar({ caminho: "/admin/descontos", sub: DORA });
  const linha = res.corpo.data[0];
  // O pedido cancelado devolve o uso: `estornado_em` preenchido sai da conta.
  assert.equal(linha.usos, 2);
  assert.equal(linha.descontado_centavos, 2000);
});

test("o filtro de situação deriva do relógio, e não de coluna nenhuma", async () => {
  const ontem = new Date(Date.now() - 86_400_000).toISOString();
  const anteontem = new Date(Date.now() - 172_800_000).toISOString();
  const amanha = new Date(Date.now() + 86_400_000).toISOString();

  const vigente = await criarRegra({ nome: "Vigente" });
  const agendada = await criarRegra({ nome: "Agendada", inicio_em: amanha });
  const expirada = await criarRegra({ nome: "Expirada", inicio_em: anteontem, fim_em: ontem });
  const desligada = await criarRegra({ nome: "Desligada", habilitada: false });

  const so = async (situacao) => {
    const res = await chamar({
      caminho: "/admin/descontos",
      consulta: { situacao },
      sub: DORA,
    });
    return res.corpo.data.map((r) => r.id).sort();
  };

  assert.deepEqual(await so("vigente"), [vigente.id]);
  assert.deepEqual(await so("agendada"), [agendada.id]);
  assert.deepEqual(await so("expirada"), [expirada.id]);
  assert.deepEqual(await so("desligada"), [desligada.id]);
});

test("a busca casa nome e código, e não diferencia caixa", async () => {
  const porNome = await criarRegra({ nome: "Semana do Micro-lote" });
  const porCodigo = await criarRegra({
    nome: "Influenciadora",
    metodo: "codigo",
    codigos: [{ codigo: "CAFE20", uso_unico: false, limite_usos: null, ativo: true }],
  });

  const buscar = async (q) => {
    const res = await chamar({ caminho: "/admin/descontos", consulta: { q }, sub: DORA });
    return res.corpo.data.map((r) => r.id);
  };

  assert.deepEqual(await buscar("micro"), [porNome.id]);
  assert.deepEqual(await buscar("cafe20"), [porCodigo.id]);
});

test("os filtros de método e classe recortam a lista, e o total acompanha", async () => {
  await criarRegra({ nome: "Automática" });
  const comCodigo = await criarRegra({
    nome: "Com código",
    metodo: "codigo",
    codigos: [{ codigo: "CUPOM10", uso_unico: false, limite_usos: null, ativo: true }],
  });

  const res = await chamar({
    caminho: "/admin/descontos",
    consulta: { metodo: "codigo" },
    sub: DORA,
  });
  assert.equal(res.corpo.total, 1);
  assert.deepEqual(res.corpo.data.map((r) => r.id), [comCodigo.id]);
});

test("a paginação é do servidor: o rodapé não pode discordar da tabela", async () => {
  for (let i = 0; i < 3; i += 1) await criarRegra({ nome: `Regra ${i}` });

  const res = await chamar({
    caminho: "/admin/descontos",
    consulta: { pagina: "2", limite: "2" },
    sub: DORA,
  });
  assert.equal(res.corpo.total, 3);
  assert.equal(res.corpo.pagina, 2);
  assert.equal(res.corpo.totalPaginas, 2);
  assert.equal(res.corpo.data.length, 1);
});

/* --------------------------------------------------------------------------
 * A ficha
 * -------------------------------------------------------------------------- */

test("GET /admin/descontos/:id devolve a regra completa", async () => {
  const criada = await criarRegra({
    escopo: [{ tipo: "produto", alvo: CAFE, incluir: true }],
  });
  const res = await chamar({ caminho: `/admin/descontos/${criada.id}`, sub: DORA });

  assert.equal(res.codigo, 200);
  assert.equal(res.corpo.id, criada.id);
  assert.equal(res.corpo.escopo.length, 1);
  assert.equal(res.corpo.escopo[0].alvo, CAFE);
});

test("GET /admin/descontos/:id com uuid malformado responde 400, não 500", async () => {
  // Sem `ehUuid` na frente, `$1::uuid` estoura 22P02 e o gestor lê "Erro
  // interno no servidor." para um link digitado errado.
  const res = await chamar({ caminho: "/admin/descontos/nao-e-uuid", sub: DORA });
  assert.equal(res.codigo, 400);
});

test("GET /admin/descontos/:id de regra que não existe responde 404", async () => {
  const res = await chamar({
    caminho: "/admin/descontos/11111111-2222-4333-8444-555555555555",
    sub: DORA,
  });
  assert.equal(res.codigo, 404);
});

/* --------------------------------------------------------------------------
 * Editar — as duas armadilhas do legado
 * -------------------------------------------------------------------------- */

test("PUT substitui as LISTAS por inteiro: duas faixas querem dizer estas duas", async () => {
  const criada = await criarRegra({
    mecanica: "progressivo",
    valor: null,
    faixas: [
      { quantidade_min: 3, desconto_tipo: "percentual", desconto_valor: "5" },
      { quantidade_min: 6, desconto_tipo: "percentual", desconto_valor: "10" },
    ],
  });

  const res = await chamar({
    metodo: "PUT",
    caminho: `/admin/descontos/${criada.id}`,
    corpo: regraBase({
      mecanica: "progressivo",
      valor: null,
      faixas: [{ quantidade_min: 4, desconto_tipo: "percentual", desconto_valor: "7" }],
    }),
    sub: DORA,
  });

  assert.equal(res.codigo, 200);
  assert.equal(res.corpo.faixas.length, 1);
  assert.equal(res.corpo.faixas[0].quantidade_min, 4);
});

test("PUT com campo AUSENTE não apaga a coluna — o defeito de PUT /promotions/:id", async () => {
  const criada = await criarRegra({
    descricao: "Campanha de agosto",
    teto_desconto_centavos: 3000,
    limite_usos: 50,
  });

  // O corpo mais parcial possível: só o nome.
  const res = await chamar({
    metodo: "PUT",
    caminho: `/admin/descontos/${criada.id}`,
    corpo: { nome: "Campanha de agosto (renomeada)" },
    sub: DORA,
  });

  assert.equal(res.codigo, 200);
  assert.equal(res.corpo.nome, "Campanha de agosto (renomeada)");
  assert.equal(res.corpo.descricao, "Campanha de agosto");
  assert.equal(res.corpo.teto_desconto_centavos, 3000);
  assert.equal(res.corpo.limite_usos, 50);
});

test("PUT com null grava vazio — é assim que o gestor APAGA um campo", async () => {
  const criada = await criarRegra({ descricao: "Campanha de agosto", limite_usos: 50 });

  const res = await chamar({
    metodo: "PUT",
    caminho: `/admin/descontos/${criada.id}`,
    corpo: { descricao: null, limite_usos: null },
    sub: DORA,
  });

  assert.equal(res.corpo.descricao, null);
  assert.equal(res.corpo.limite_usos, null);
});

test("PUT em id inexistente responde 404 — nunca 200 com zero linhas afetadas", async () => {
  const res = await chamar({
    metodo: "PUT",
    caminho: "/admin/descontos/11111111-2222-4333-8444-555555555555",
    corpo: regraBase(),
    sub: DORA,
  });
  assert.equal(res.codigo, 404);
});

test("PUT com uuid malformado responde 400, não 500", async () => {
  const res = await chamar({
    metodo: "PUT",
    caminho: "/admin/descontos/nao-e-uuid",
    corpo: regraBase(),
    sub: DORA,
  });
  assert.equal(res.codigo, 400);
});

test("PUT confere a coerência sobre a FUSÃO, e não só sobre o que veio", async () => {
  // A regra é percentual; o PUT manda só o valor. O `CHECK` de 90% é sobre a
  // linha resultante, e não sobre o corpo.
  const criada = await criarRegra({ valor: 10 });
  const res = await chamar({
    metodo: "PUT",
    caminho: `/admin/descontos/${criada.id}`,
    corpo: { valor: 95 },
    sub: DORA,
  });
  assert.equal(res.codigo, 400);
  assert.match(res.corpo.error, /90/);
});

test("PUT preserva o contador de uso do código que continua", async () => {
  const criada = await criarRegra({
    metodo: "codigo",
    codigos: [{ codigo: "CAFE20", uso_unico: false, limite_usos: 100, ativo: true }],
  });
  await bd.pool.query(
    "UPDATE canastra.promocao_codigos SET usos = 7 WHERE codigo = 'CAFE20'",
  );

  const res = await chamar({
    metodo: "PUT",
    caminho: `/admin/descontos/${criada.id}`,
    corpo: {
      codigos: [{ codigo: "CAFE20", uso_unico: false, limite_usos: 200, ativo: false }],
    },
    sub: DORA,
  });

  assert.equal(res.codigo, 200);
  const codigo = res.corpo.codigos_detalhe[0];
  assert.equal(codigo.limite_usos, 200);
  assert.equal(codigo.ativo, false);
  // O contador NÃO volta a zero: apagar e recriar o código perderia o uso.
  assert.equal(codigo.usos, 7);
});

test("PUT recusa remover um código JÁ RESGATADO, e o código continua lá", async () => {
  const criada = await criarRegra({
    metodo: "codigo",
    codigos: [{ codigo: "CAFE20", uso_unico: false, limite_usos: null, ativo: true }],
  });
  const { rows } = await bd.pool.query(
    "SELECT id FROM canastra.promocao_codigos WHERE codigo = 'CAFE20'",
  );
  await resgatar(criada.id, { codigoId: rows[0].id });

  const res = await chamar({
    metodo: "PUT",
    caminho: `/admin/descontos/${criada.id}`,
    corpo: { codigos: [] },
    sub: DORA,
  });

  // `promocao_resgates.codigo_id` é ON DELETE RESTRICT: sem esta recusa o PUT
  // morreria com 23503 no meio, e o gestor leria "Erro interno no servidor.".
  assert.equal(res.codigo, 409);
  assert.match(res.corpo.error, /CAFE20/);
  const depois = await bd.pool.query(
    "SELECT count(*)::int AS n FROM canastra.promocao_codigos WHERE codigo = 'CAFE20'",
  );
  assert.equal(depois.rows[0].n, 1);
});

test("PUT apaga um código NUNCA usado sem reclamar", async () => {
  const criada = await criarRegra({
    metodo: "codigo",
    codigos: [
      { codigo: "CAFE20", uso_unico: false, limite_usos: null, ativo: true },
      { codigo: "CAFE30", uso_unico: false, limite_usos: null, ativo: true },
    ],
  });

  const res = await chamar({
    metodo: "PUT",
    caminho: `/admin/descontos/${criada.id}`,
    corpo: {
      codigos: [{ codigo: "CAFE20", uso_unico: false, limite_usos: null, ativo: true }],
    },
    sub: DORA,
  });

  assert.equal(res.codigo, 200);
  assert.deepEqual(res.corpo.codigos, ["CAFE20"]);
});

test("PUT recusa deixar uma regra de código SEM nenhum código", async () => {
  // Sem código, o `LEFT JOIN` de `carregarRegrasVigentes` nunca casa: a regra
  // existe, aparece "vigente" na tela e o motor nunca a vê.
  const criada = await criarRegra({
    metodo: "codigo",
    codigos: [{ codigo: "CAFE20", uso_unico: false, limite_usos: null, ativo: true }],
  });

  const res = await chamar({
    metodo: "PUT",
    caminho: `/admin/descontos/${criada.id}`,
    corpo: { codigos: [] },
    sub: DORA,
  });

  assert.equal(res.codigo, 400);
  // E o ROLLBACK devolveu o código: a recusa não pode deixar meia edição.
  const { rows } = await bd.pool.query(
    "SELECT count(*)::int AS n FROM canastra.promocao_codigos WHERE promocao_id = $1::uuid",
    [criada.id],
  );
  assert.equal(rows[0].n, 1);
});

test("PUT grava auditoria com antes e depois dos campos TOCADOS", async () => {
  const criada = await criarRegra({ valor: 10 });
  await bd.pool.query("DELETE FROM canastra.admin_log");

  await chamar({
    metodo: "PUT",
    caminho: `/admin/descontos/${criada.id}`,
    corpo: { valor: 15 },
    sub: DORA,
  });

  const logs = await contarLogs();
  assert.equal(logs.length, 1);
  assert.equal(logs[0].acao, "promocao_alterada");
  assert.equal(Number(logs[0].antes.valor), 10);
  assert.equal(Number(logs[0].depois.valor), 15);
});

/* --------------------------------------------------------------------------
 * Ligar, desligar, arquivar
 * -------------------------------------------------------------------------- */

test("PATCH /habilitada toca UMA coluna e mais nada", async () => {
  const criada = await criarRegra({
    escopo: [{ tipo: "produto", alvo: CAFE, incluir: true }],
  });

  const res = await chamar({
    metodo: "PATCH",
    caminho: `/admin/descontos/${criada.id}/habilitada`,
    corpo: { habilitada: false },
    sub: DORA,
  });

  assert.equal(res.codigo, 200);
  assert.equal(res.corpo.habilitada, false);
  // O gesto que NÃO é edição de formulário não pode levar o escopo junto: foi
  // isso que tornou a promoção legada inalcançável pela tela.
  assert.equal(res.corpo.escopo.length, 1);
});

test("PATCH /habilitada recusa corpo que não é booleano", async () => {
  const criada = await criarRegra();
  const res = await chamar({
    metodo: "PATCH",
    caminho: `/admin/descontos/${criada.id}/habilitada`,
    corpo: { habilitada: "sim" },
    sub: DORA,
  });
  assert.equal(res.codigo, 400);
});

test("PATCH /habilitada em id inexistente responde 404", async () => {
  const res = await chamar({
    metodo: "PATCH",
    caminho: "/admin/descontos/11111111-2222-4333-8444-555555555555/habilitada",
    corpo: { habilitada: false },
    sub: DORA,
  });
  assert.equal(res.codigo, 404);
});

test("arquivar carimba `arquivada_em` e a regra continua legível", async () => {
  const criada = await criarRegra();

  const res = await chamar({
    metodo: "POST",
    caminho: `/admin/descontos/${criada.id}/arquivar`,
    corpo: {},
    sub: DORA,
  });

  assert.equal(res.codigo, 200);
  assert.notEqual(res.corpo.arquivada_em, null);

  // ARQUIVAR, NUNCA DELETE (R13): a linha continua lá, e o relatório do pedido
  // que a usou continua respondendo.
  const { rows } = await bd.pool.query("SELECT count(*)::int AS n FROM canastra.promocoes");
  assert.equal(rows[0].n, 1);

  const naLista = await chamar({
    caminho: "/admin/descontos",
    consulta: { situacao: "arquivada" },
    sub: DORA,
  });
  assert.deepEqual(naLista.corpo.data.map((r) => r.id), [criada.id]);
});

test("desarquivar limpa a coluna e devolve a regra à vida", async () => {
  const criada = await criarRegra();
  await chamar({
    metodo: "POST",
    caminho: `/admin/descontos/${criada.id}/arquivar`,
    corpo: {},
    sub: DORA,
  });

  const res = await chamar({
    metodo: "POST",
    caminho: `/admin/descontos/${criada.id}/desarquivar`,
    corpo: {},
    sub: DORA,
  });

  assert.equal(res.codigo, 200);
  assert.equal(res.corpo.arquivada_em, null);
});

test("arquivar id inexistente responde 404", async () => {
  const res = await chamar({
    metodo: "POST",
    caminho: "/admin/descontos/11111111-2222-4333-8444-555555555555/arquivar",
    corpo: {},
    sub: DORA,
  });
  assert.equal(res.codigo, 404);
});

/* --------------------------------------------------------------------------
 * Simular — o motor de verdade, e nenhuma escrita
 * -------------------------------------------------------------------------- */

test("simular chama o motor: 2× R$ 60 com 10% no pedido descontam R$ 12,00", async () => {
  const res = await chamar({
    metodo: "POST",
    caminho: "/admin/descontos/simular",
    corpo: {
      regra: regraBase({ valor: 10 }),
      carrinho: {
        itens: [
          {
            produtoId: CAFE,
            sku: "CLAS-250",
            categoria: "Café",
            precoCentavos: 6000,
            quantidade: 2,
          },
        ],
        meioPagamento: null,
        assinante: false,
        frete: null,
      },
    },
    sub: DORA,
  });

  assert.equal(res.codigo, 200);
  assert.equal(res.corpo.subtotalCentavos, 12000);
  assert.equal(res.corpo.totalCentavos, 1200);
  assert.equal(res.corpo.ajustes.length, 1);
  assert.equal(res.corpo.ajustes[0].alvo, "pedido");
  assert.equal(res.corpo.ajustes[0].rotulo, "Dez por cento");
  // Frete não cotado é `null`, e não zero: as duas coisas não são a mesma.
  assert.equal(res.corpo.freteFinalCentavos, null);
});

test("simular NÃO escreve nada — nem regra, nem auditoria", async () => {
  await chamar({
    metodo: "POST",
    caminho: "/admin/descontos/simular",
    corpo: {
      regra: regraBase(),
      carrinho: {
        itens: [{ produtoId: CAFE, sku: null, categoria: null, precoCentavos: 6000, quantidade: 1 }],
        meioPagamento: null,
        assinante: false,
        frete: null,
      },
    },
    sub: DORA,
  });

  const promocoes = await bd.pool.query("SELECT count(*)::int AS n FROM canastra.promocoes");
  const logs = await contarLogs();
  assert.equal(promocoes.rows[0].n, 0);
  assert.equal(logs.length, 0);
});

test("simular devolve o frete depois dos ajustes de classe frete", async () => {
  const res = await chamar({
    metodo: "POST",
    caminho: "/admin/descontos/simular",
    corpo: {
      regra: regraBase({
        nome: "Frete grátis",
        classe: "frete",
        mecanica: "frete_gratis",
        valor: null,
        frete: {
          teto_frete_centavos: 3500,
          ufs: null,
          apenas_modalidade_mais_barata: false,
          cep_inicio: null,
          cep_fim: null,
        },
      }),
      carrinho: {
        itens: [{ produtoId: CAFE, sku: null, categoria: null, precoCentavos: 6000, quantidade: 1 }],
        meioPagamento: null,
        assinante: false,
        frete: { valorCentavos: 2500, ehMaisBarata: true, uf: "SP", cep: "01310100" },
      },
    },
    sub: DORA,
  });

  assert.equal(res.codigo, 200);
  assert.equal(res.corpo.totalCentavos, 2500);
  assert.equal(res.corpo.freteFinalCentavos, 0);
});

test("simular não devolve a string \"null\" como referência de item avulso", async () => {
  // `motor.js` monta a referência com `String(item.produtoId)`, e um item
  // avulso (só SKU) produz o texto literal "null" — que a tela estamparia
  // como "· null" ao lado do desconto.
  const res = await chamar({
    metodo: "POST",
    caminho: "/admin/descontos/simular",
    corpo: {
      regra: regraBase({
        classe: "produto",
        escopo: [{ tipo: "sku", alvo: "AVULSO-1", incluir: true }],
      }),
      carrinho: {
        itens: [
          {
            produtoId: null,
            sku: "AVULSO-1",
            categoria: null,
            precoCentavos: 5000,
            quantidade: 1,
          },
        ],
        meioPagamento: null,
        assinante: false,
        frete: null,
      },
    },
    sub: DORA,
  });

  assert.equal(res.codigo, 200);
  assert.equal(res.corpo.ajustes.length, 1);
  assert.equal(res.corpo.ajustes[0].alvo, "item");
  assert.equal(res.corpo.ajustes[0].alvoRef, null);
});

test("simular recusa a mesma regra que o POST recusaria", async () => {
  const res = await chamar({
    metodo: "POST",
    caminho: "/admin/descontos/simular",
    corpo: {
      regra: regraBase({ valor: 95 }),
      carrinho: { itens: [], meioPagamento: null, assinante: false, frete: null },
    },
    sub: DORA,
  });
  assert.equal(res.codigo, 400);
});

test("simular não confunde `/simular` com um id de regra", async () => {
  // A ordem de registro é load-bearing: `POST /admin/descontos/simular`
  // precede qualquer caminho com `:id`, senão "simular" viraria um uuid
  // malformado e a resposta seria 400 em vez da simulação.
  const res = await chamar({
    metodo: "POST",
    caminho: "/admin/descontos/simular",
    corpo: {
      regra: regraBase(),
      carrinho: {
        itens: [{ produtoId: CAFE, sku: null, categoria: null, precoCentavos: 1000, quantidade: 1 }],
        meioPagamento: null,
        assinante: false,
        frete: null,
      },
    },
    sub: DORA,
  });
  assert.equal(res.codigo, 200);
});
