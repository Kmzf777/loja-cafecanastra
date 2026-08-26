"use strict";

/**
 * Onda 3H — LGPD: redação dos dados do titular e exclusão de conta que fecha
 * tudo que ficaria pendurado.
 *
 * O problema que esta suíte guarda: apagar a conta (GoTrue → cascade em
 * `clientes`) deixa o registro órfão (`user_id` NULL — venda é registro
 * fiscal, 0005; a assinatura é histórico comercial, 0015; a avaliação é prova
 * social, 0014), mas nome, CPF, endereço e telefone sobreviviam congelados em
 * `pedidos.endereco_json`, `assinaturas.endereco_json` e
 * `avaliacoes.nome_exibicao` — este último PÚBLICO na vitrine. As migrações
 * 0013 e 0016 criam a redação; aqui se mede que:
 *
 *   1. a redação apaga o pessoal e preserva o estatístico (cidade/UF/prefixo
 *      de CEP) e o fiscal (total, status, itens de produto) — nos DOIS
 *      vocabulários de chave que já passaram por esta loja (inglês da vitrine
 *      atual, português do legado);
 *   2. nenhuma forma inesperada de `endereco_json` a derruba: lista, escalar,
 *      objeto vazio, JSON null, SQL NULL, CEP impresentável. Um erro aqui
 *      abortaria a exclusão de conta daquela pessoa PARA SEMPRE;
 *   3. é idempotente e carimba `redigido_em` UMA vez (auditoria da primeira);
 *   4. recusa titular NULL — um no-op silencioso aqui deixaria a exclusão de
 *      conta "redigir" nada e criar o órfão irredigível;
 *   5. a exclusão de conta CANCELA as assinaturas vivas, depois REDIGE, e só
 *      então chama o GoTrue — abortando se qualquer um dos dois falhar;
 *   6. a segunda tentativa depois de um GoTrue caído conclui (a redação
 *      repetida devolve 0 sem erro e o DELETE prossegue);
 *   7. os endpoints de atendimento a titular exportam TUDO que a loja guarda
 *      e respondem 404 UNIFORME para quem não é titular desta loja (a
 *      instância é compartilhada; o painel não pode ser oráculo sobre contas
 *      alheias).
 *
 * CADA TESTE TEM PERSONAGENS PRÓPRIOS (`novoTitular`), e isso não é preciosismo:
 * a redação é destrutiva e carimba `redigido_em`, então um titular reaproveitado
 * chega ao teste seguinte JÁ REDIGIDO e o resultado passa a depender da ordem de
 * execução — o modo de falha mais caro que uma suíte pode ter é o que só
 * aparece quando alguém roda um teste sozinho.
 */

const { test, before, after, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const Module = require("node:module");
const { subirPostgres } = require("./ajuda/postgres.js");
const { aplicarMigracoes } = require("../db/migrar.js");

let bd;
let conta;
let lgpd;

// Conta de OUTRO projeto da instância compartilhada: existe em auth.users,
// nunca foi cliente desta loja.
const OTAVIO = "e5e5e5e5-0000-4000-8000-000000000005";
// Nem em auth.users existe.
const FANTASMA = "f6f6f6f6-0000-4000-8000-000000000006";

/** O que a vitrine atual grava (frontend/lib/sacola/checkout.ts, tipo Endereco). */
const ENDERECO_VITRINE = Object.freeze({
  zip_code: "37928-000",
  street: "Rua das Ameixas",
  number: "42",
  complement: "casa dos fundos",
  neighborhood: "Centro",
  city: "Piumhi",
  state: "MG",
});

/** O vocabulário da loja anterior/legado (o exemplo literal do cabeçalho de 0005). */
const ENDERECO_LEGADO = Object.freeze({
  nome: "Ana Souza",
  cpf: "12345678901",
  telefone: "35999990000",
  rua: "Rua das Ameixas",
  numero: "42",
  complemento: "casa dos fundos",
  bairro: "Centro",
  cidade: "Piumhi",
  uf: "MG",
  cep: "37928000",
});

/** O formato real de `itens` (validatedItems do PaymentController): só produto. */
const ITENS_DE_PRODUTO = Object.freeze([
  {
    product_id: "11111111-2222-4333-8444-555555555555",
    name: "Café Clássico 500g",
    image: "https://exemplo/cafe.jpg",
    price: 54.9,
    quantity: 2,
    size: "500g",
    weight: 0.5,
  },
]);

const AMBIENTE_COM_GOTRUE = Object.freeze({
  SUPABASE_URL: "http://kong",
  SUPABASE_SERVICE_ROLE_KEY: "chave",
});

async function criarPessoa(id, email, nome, { cpf = null, telefone = null } = {}) {
  await bd.pool.query(
    "INSERT INTO auth.users (id, email) VALUES ($1, $2) ON CONFLICT (id) DO NOTHING",
    [id, email],
  );
  await bd.pool.query(
    `INSERT INTO canastra.clientes (user_id, nome, cpf, telefone)
     VALUES ($1, $2, $3, $4) ON CONFLICT (user_id) DO NOTHING`,
    [id, nome, cpf, telefone],
  );
}

/**
 * Um titular novo em folha, com uuid e e-mail próprios. O contador dá o
 * sufixo: quem lê o log de uma falha vê `...000000000007` e sabe de qual teste
 * a linha saiu, sem que dois testes disputem o mesmo personagem.
 */
let sequencia = 0;
async function novoTitular(nome = "Ana Souza", { cpf = null, telefone = null } = {}) {
  sequencia += 1;
  const id = `00000000-0000-4000-8000-${String(sequencia).padStart(12, "0")}`;
  const email = `titular${sequencia}@ex.com`;
  await criarPessoa(id, email, nome, { cpf, telefone });
  return { id, email, nome };
}

async function criarPedido(
  userId,
  { endereco = ENDERECO_VITRINE, itens = ITENS_DE_PRODUTO, total = 129.7 } = {},
) {
  const { rows } = await bd.pool.query(
    `INSERT INTO canastra.pedidos (user_id, total, status, itens, endereco_json)
     VALUES ($1, $2, 'aprovado', $3::jsonb, $4::jsonb)
     RETURNING pedido_id`,
    [userId, total, JSON.stringify(itens), JSON.stringify(endereco)],
  );
  return rows[0].pedido_id;
}

async function lerPedido(pedidoId) {
  const { rows } = await bd.pool.query(
    `SELECT user_id, total, status, itens, endereco_json, redigido_em, atualizado_em
       FROM canastra.pedidos WHERE pedido_id = $1`,
    [pedidoId],
  );
  return rows[0];
}

/**
 * Uma assinatura do Clube (0015). `preapproval` NULL é a pendente que nunca
 * chegou ao MP; com id é a que o cancelamento tem de levar ao MP antes de
 * fechar aqui.
 */
async function criarAssinatura(
  userId,
  { status = "ativa", endereco = ENDERECO_VITRINE, preapproval = null } = {},
) {
  const { rows } = await bd.pool.query(
    `INSERT INTO canastra.assinaturas
       (user_id, sku, quantidade, frequencia_dias, preco_centavos,
        endereco_json, status, preapproval_id)
     VALUES ($1, 'CLUBE-250', 1, 30, 3573, $2::jsonb, $3, $4)
     RETURNING id`,
    [userId, JSON.stringify(endereco), status, preapproval],
  );
  return rows[0].id;
}

async function lerAssinatura(id) {
  const { rows } = await bd.pool.query(
    "SELECT status, endereco_json, redigido_em, cancelada_em FROM canastra.assinaturas WHERE id = $1",
    [id],
  );
  return rows[0];
}

/** `nome_exibicao` NÃO é passado: a trigger `avaliacoes_congela_nome` o copia. */
async function criarAvaliacao(userId, { sku = "CLUBE-250", nota = 5 } = {}) {
  const { rows } = await bd.pool.query(
    `INSERT INTO canastra.avaliacoes (user_id, sku, nota, texto)
     VALUES ($1, $2, $3, 'Café excelente, chegou rápido.')
     RETURNING id, nome_exibicao`,
    [userId, sku, nota],
  );
  return rows[0];
}

async function lerAvaliacao(id) {
  const { rows } = await bd.pool.query(
    "SELECT nome_exibicao, nota, texto, moderado_em FROM canastra.avaliacoes WHERE id = $1",
    [id],
  );
  return rows[0];
}

async function redigir(userId) {
  const { rows } = await bd.pool.query(
    "SELECT canastra.redigir_dados_do_titular($1::uuid) AS n",
    [userId],
  );
  return rows[0].n;
}

/**
 * O dublê do Clube: faz LOCALMENTE o que `cancelarAssinaturasDoTitular` faz
 * depois de falar com o MP (o contrato dela está coberto por
 * f7_clube.test.js, com o dublê do SDK; aqui o que se mede é o FLUXO da
 * exclusão de conta em volta dela).
 */
async function cancelarAssinaturasFalso(userId) {
  const { rows } = await bd.pool.query(
    `UPDATE canastra.assinaturas
        SET status = 'cancelada', cancelada_em = now(), atualizado_em = now()
      WHERE user_id = $1::uuid AND status <> 'cancelada'
      RETURNING id`,
    [userId],
  );
  return rows.map((linha) => linha.id);
}

/** A recusa do MP, no formato exato do contrato: Error com status 502. */
function recusaDoMercadoPago(jaCanceladas = []) {
  const erro = new Error("Não foi possível cancelar a assinatura no Mercado Pago.");
  erro.status = 502;
  erro.canceladas = jaCanceladas;
  return erro;
}

before(async () => {
  bd = await subirPostgres();
  await aplicarMigracoes(bd.pool);

  process.env.DATABASE_URL = bd.connectionString;

  conta = require("../src/routes/conta.routes.js");
  lgpd = require("../src/routes/lgpd.routes.js");

  await bd.pool.query(
    "INSERT INTO auth.users (id, email) VALUES ($1, 'otavio@outro-projeto.com')",
    [OTAVIO],
  );
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
  return res;
}

/* --------------------------------------------------------------------------
 * A função de redação (migrações 0013 + 0016)
 * -------------------------------------------------------------------------- */

test("redação: apaga o pessoal, preserva região e valor — nos dois vocabulários", async () => {
  const titular = await novoTitular();
  const vizinho = await novoTitular("Beto Lima");

  const pedidoVitrine = await criarPedido(titular.id, { endereco: ENDERECO_VITRINE });
  const pedidoLegado = await criarPedido(titular.id, { endereco: ENDERECO_LEGADO });
  // Pedido de OUTRO titular: prova que a redação é do titular, não da tabela.
  const pedidoDoVizinho = await criarPedido(vizinho.id);

  const n = await redigir(titular.id);
  assert.equal(n, 2, "os dois pedidos do titular deveriam ter sido redigidos");

  const vitrine = await lerPedido(pedidoVitrine);
  // O que fica: estatística de venda por região e o registro fiscal.
  assert.equal(vitrine.endereco_json.city, "Piumhi");
  assert.equal(vitrine.endereco_json.state, "MG");
  assert.equal(vitrine.endereco_json.zip_code, "379xxxxx");
  assert.equal(vitrine.total, "129.70");
  assert.equal(vitrine.status, "aprovado");
  // O que sai: tudo que identifica a pessoa ou a porta da casa dela.
  assert.equal(vitrine.endereco_json.street, "[redigido]");
  assert.equal(vitrine.endereco_json.number, "[redigido]");
  assert.equal(vitrine.endereco_json.complement, "[redigido]");
  assert.equal(vitrine.endereco_json.neighborhood, "[redigido]");
  assert.ok(vitrine.redigido_em, "redigido_em deveria estar carimbado");

  const legado = await lerPedido(pedidoLegado);
  assert.equal(legado.endereco_json.cidade, "Piumhi");
  assert.equal(legado.endereco_json.uf, "MG");
  assert.equal(legado.endereco_json.cep, "379xxxxx");
  for (const chave of ["nome", "cpf", "telefone", "rua", "numero", "complemento", "bairro"]) {
    assert.equal(legado.endereco_json[chave], "[redigido]", `"${chave}" deveria ter sido redigida`);
  }

  // A whitelist decide, não a denylist: uma chave que a redação nunca viu
  // (um campo novo do checkout de amanhã) cai para o lado seguro.
  const recemChegado = await novoTitular("Caio Prado");
  const pedidoComChaveNova = await criarPedido(recemChegado.id, {
    endereco: { ...ENDERECO_VITRINE, ponto_de_referencia: "portão azul" },
  });
  await redigir(recemChegado.id);
  const chaveNova = await lerPedido(pedidoComChaveNova);
  assert.equal(chaveNova.endereco_json.ponto_de_referencia, "[redigido]");

  const doVizinho = await lerPedido(pedidoDoVizinho);
  assert.equal(doVizinho.redigido_em, null, "o pedido do vizinho não era alvo");
  assert.deepEqual(doVizinho.endereco_json, ENDERECO_VITRINE);
});

test("redação de itens: produto fica (registro fiscal), dado pessoal defensivo sai", async () => {
  // O formato REAL gravado pelo checkout só tem produto — mas a redação é
  // defensiva: se um formato histórico/futuro carregar um campo pessoal
  // dentro do item, ele sai junto.
  const titular = await novoTitular("Dina Reis");
  const pedidoId = await criarPedido(titular.id, {
    itens: [{ ...ITENS_DE_PRODUTO[0], cpf: "12345678901", telefone: "35999990000" }],
  });

  await redigir(titular.id);
  const { itens } = await lerPedido(pedidoId);

  assert.equal(itens.length, 1);
  assert.equal(itens[0].product_id, ITENS_DE_PRODUTO[0].product_id);
  assert.equal(itens[0].name, "Café Clássico 500g", "nome de PRODUTO não é dado pessoal");
  assert.equal(itens[0].price, 54.9);
  assert.equal(itens[0].quantity, 2);
  assert.equal(itens[0].cpf, "[redigido]");
  assert.equal(itens[0].telefone, "[redigido]");
});

/**
 * AS FORMAS INESPERADAS DE `endereco_json`, e por que elas têm teste próprio:
 * a coluna é `jsonb` NULÁVEL e SEM constraint de forma (0005) — nada no banco
 * obriga que ali dentro haja um objeto. Um pedido antigo, um import da loja
 * anterior ou um caminho de escrita futuro pode ter gravado uma lista, uma
 * string, `{}` ou o JSON `null`.
 *
 * O QUE ESTÁ EM JOGO NÃO É COSMÉTICO: a redação roda DENTRO da exclusão de
 * conta, e uma exceção em qualquer uma dessas linhas (22023 "cannot deconstruct
 * a scalar", por exemplo) abortaria a exclusão daquela pessoa — para sempre,
 * porque o pedido esquisito não se conserta sozinho. A 0013/0016 trata os
 * casos; até aqui, nenhum teste os exercitava.
 */
test("formas inesperadas de endereço: nenhuma derruba a redação", async () => {
  const titular = await novoTitular("Elis Moreira");

  const lista = await criarPedido(titular.id, {
    endereco: ["Rua das Ameixas", 42, "Piumhi"],
  });
  const escalar = await criarPedido(titular.id, {
    endereco: "Rua das Ameixas, 42 — Piumhi/MG",
  });
  const vazio = await criarPedido(titular.id, { endereco: {} });
  const jsonNull = await criarPedido(titular.id, { endereco: null });
  const cepComLixo = await criarPedido(titular.id, {
    endereco: { zip_code: "não sei o CEP", city: "Piumhi", state: "MG" },
  });
  // SQL NULL é outro caso que o JS não distingue do JSON null na leitura — vai
  // por INSERT próprio e é conferido em SQL.
  const { rows: semEndereco } = await bd.pool.query(
    `INSERT INTO canastra.pedidos (user_id, total, status, itens, endereco_json)
     VALUES ($1, 99.90, 'aprovado', $2::jsonb, NULL) RETURNING pedido_id`,
    [titular.id, JSON.stringify(ITENS_DE_PRODUTO)],
  );
  const sqlNull = semEndereco[0].pedido_id;

  assert.equal(await redigir(titular.id), 6, "os seis pedidos são alvo");

  // Lista e escalar: não há como saber o que há dentro, então o valor INTEIRO
  // vira a string "[redigido]" — perde-se a estatística, nunca o dado.
  assert.equal((await lerPedido(lista)).endereco_json, "[redigido]");
  assert.equal((await lerPedido(escalar)).endereco_json, "[redigido]");

  // `{}` continua `{}` (o COALESCE da função: agregar zero linhas dá NULL, e
  // NULL na coluna seria PERDER a informação de que havia um objeto vazio).
  assert.deepEqual((await lerPedido(vazio)).endereco_json, {});

  // JSON null e SQL NULL são coisas diferentes no banco e o JS mostra as duas
  // como `null`: a distinção se mede em SQL.
  const { rows: tipos } = await bd.pool.query(
    `SELECT pedido_id,
            jsonb_typeof(endereco_json) AS tipo,
            endereco_json IS NULL       AS eh_sql_null,
            redigido_em
       FROM canastra.pedidos WHERE pedido_id = ANY($1::uuid[])`,
    [[jsonNull, sqlNull]],
  );
  const porId = Object.fromEntries(tipos.map((linha) => [linha.pedido_id, linha]));
  assert.equal(porId[jsonNull].tipo, "null", "JSON null continua JSON null");
  assert.equal(porId[jsonNull].eh_sql_null, false);
  assert.equal(porId[sqlNull].eh_sql_null, true, "SQL NULL continua SQL NULL");
  // Os dois foram VISITADOS: carimbados, contados, e nunca mais alvo.
  assert.ok(porId[jsonNull].redigido_em);
  assert.ok(porId[sqlNull].redigido_em);

  // CEP impresentável: sem dígito nenhum para prefixar, degrada para 'xxxxx'
  // (a estatística por CEP se perde; o campo NUNCA volta com o lixo original,
  // que poderia ser texto livre digitado pela pessoa). Cidade e UF ficam.
  const lixo = await lerPedido(cepComLixo);
  assert.equal(lixo.endereco_json.zip_code, "xxxxx");
  assert.equal(lixo.endereco_json.city, "Piumhi");
  assert.equal(lixo.endereco_json.state, "MG");

  // E a segunda passagem não acha mais nada: `redigido_em` cobre TODAS as
  // formas, inclusive as que "não mudaram nada" visivelmente.
  assert.equal(await redigir(titular.id), 0);
});

test("redação é idempotente: a segunda chamada devolve 0 e não toca nada", async () => {
  const titular = await novoTitular("Fábio Nunes");
  const pedidoId = await criarPedido(titular.id);
  assert.equal(await redigir(titular.id), 1);

  const primeira = await lerPedido(pedidoId);
  assert.equal(await redigir(titular.id), 0, "segunda chamada não deveria achar alvo");
  const segunda = await lerPedido(pedidoId);

  // `redigido_em` audita a PRIMEIRA redação — repetir a chamada não o move.
  assert.deepEqual(segunda.redigido_em, primeira.redigido_em);
  assert.deepEqual(segunda.endereco_json, primeira.endereco_json);
});

test("titular NULL é recusado: órfão não tem redação por titular", async () => {
  // Um no-op silencioso aqui seria o pior desfecho possível: a exclusão de
  // conta "redigiria" nada, apagaria a conta, e o pedido órfão ficaria
  // irredigível para sempre. A recusa é 22004 (null_value_not_allowed).
  await assert.rejects(
    () => bd.pool.query("SELECT canastra.redigir_dados_do_titular(NULL)"),
    (erro) => {
      assert.equal(erro.code, "22004");
      return true;
    },
  );
});

test("EXECUTE: só service_role (e o dono); a função é INVOKER de propósito", async () => {
  const { rows } = await bd.pool.query(`
    SELECT
      p.prosecdef,
      has_function_privilege('service_role',  p.oid, 'EXECUTE') AS servico,
      has_function_privilege('authenticated', p.oid, 'EXECUTE') AS logado,
      has_function_privilege('anon',          p.oid, 'EXECUTE') AS anonimo
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'canastra' AND p.proname = 'redigir_dados_do_titular'
  `);
  assert.equal(rows.length, 1, "a função deveria existir, uma vez");
  // INVOKER: quem chama (pool postgres/dono, service_role BYPASSRLS) já tem o
  // privilégio — DEFINER só acrescentaria superfície de bypass (lição de 0007).
  assert.equal(rows[0].prosecdef, false);
  assert.equal(rows[0].servico, true);
  assert.equal(rows[0].logado, false, "redação não é gesto do navegador");
  assert.equal(rows[0].anonimo, false);
});

/* --------------------------------------------------------------------------
 * Exclusão de conta: cancelar → redigir → apagar, nesta ordem
 * -------------------------------------------------------------------------- */

test("excluirMinhaConta redige os pedidos ANTES de pedir a exclusão ao GoTrue", async () => {
  const titular = await novoTitular("Gil Faria");
  const pedidoId = await criarPedido(titular.id);

  let redigidoQuandoOGoTrueFoiChamado = null;
  const res = respostaFalsa();

  await conta.excluirMinhaConta({ user: { userId: titular.id } }, res, {
    cancelarAssinaturas: async () => [],
    buscar: async () => {
      // Fotografa o estado NO MOMENTO da chamada ao GoTrue: se a redação
      // viesse depois, este valor seria null e o teste ficaria vermelho.
      const { rows } = await bd.pool.query(
        "SELECT redigido_em FROM canastra.pedidos WHERE pedido_id = $1",
        [pedidoId],
      );
      redigidoQuandoOGoTrueFoiChamado = rows[0].redigido_em;
      return { ok: true, status: 200 };
    },
    ambiente: AMBIENTE_COM_GOTRUE,
  });

  assert.equal(res.codigo, 200);
  assert.ok(
    redigidoQuandoOGoTrueFoiChamado,
    "quando o GoTrue foi chamado, o pedido JÁ deveria estar redigido",
  );
  const pedido = await lerPedido(pedidoId);
  assert.equal(pedido.endereco_json.street, "[redigido]");
});

/**
 * A ORDEM COMPLETA, e o motivo dela: a redação da 0016 só alcança assinatura
 * `cancelada` (enquanto a entrega recorrente existe, o endereço é necessário à
 * execução do contrato — art. 16, I). Se o cancelamento viesse DEPOIS, a
 * assinatura seria fechada já sem redação e o endereço ficaria lá, órfão e
 * irredigível — o mesmo furo de `pedidos`, com o agravante de haver cobrança
 * no meio.
 */
test("excluirMinhaConta cancela as assinaturas ANTES de redigir, e a redação as alcança", async () => {
  const titular = await novoTitular("Helena Braga");
  const assinaturaId = await criarAssinatura(titular.id, {
    status: "ativa",
    preapproval: "pre-helena",
  });
  const pedidoId = await criarPedido(titular.id);

  const ordem = [];
  const res = respostaFalsa();

  await conta.excluirMinhaConta({ user: { userId: titular.id } }, res, {
    cancelarAssinaturas: async (uid) => {
      ordem.push("cancelar");
      const { rows } = await bd.pool.query(
        "SELECT redigido_em FROM canastra.pedidos WHERE pedido_id = $1",
        [pedidoId],
      );
      assert.equal(rows[0].redigido_em, null, "cancelar vem ANTES de redigir");
      return cancelarAssinaturasFalso(uid);
    },
    buscar: async () => {
      ordem.push("gotrue");
      return { ok: true, status: 200 };
    },
    ambiente: AMBIENTE_COM_GOTRUE,
  });

  assert.equal(res.codigo, 200);
  assert.deepEqual(ordem, ["cancelar", "gotrue"]);

  const assinatura = await lerAssinatura(assinaturaId);
  assert.equal(assinatura.status, "cancelada");
  assert.ok(assinatura.cancelada_em);
  assert.ok(
    assinatura.redigido_em,
    "cancelada ANTES da redação, ela é alcançada pela mesma passagem",
  );
  assert.equal(assinatura.endereco_json.street, "[redigido]");
  assert.equal(assinatura.endereco_json.city, "Piumhi", "a região sobrevive, como em pedidos");
});

test("recusa do Mercado Pago ABORTA a exclusão: 502, e nem redigir nem apagar acontecem", async () => {
  const titular = await novoTitular("Ivo Salles");
  const pedidoId = await criarPedido(titular.id);
  const assinaturaId = await criarAssinatura(titular.id, {
    status: "ativa",
    preapproval: "pre-ivo",
  });

  let chamouGoTrue = false;
  const res = respostaFalsa();

  await conta.excluirMinhaConta({ user: { userId: titular.id } }, res, {
    cancelarAssinaturas: async () => {
      throw recusaDoMercadoPago([]);
    },
    buscar: async () => {
      chamouGoTrue = true;
      return { ok: true, status: 200 };
    },
    ambiente: AMBIENTE_COM_GOTRUE,
  });

  assert.equal(res.codigo, 502, "a recusa do MP é do MP, e o 502 diz isso");
  assert.match(res.corpo.message, /Clube/, "a mensagem tem de dizer o que travou");
  assert.equal(
    chamouGoTrue,
    false,
    "apagar a conta deixaria um preapproval vivo cobrando quem já não existe",
  );

  // NADA aconteceu: nem redação, nem exclusão. A pessoa tenta de novo.
  assert.equal((await lerPedido(pedidoId)).redigido_em, null);
  assert.equal((await lerAssinatura(assinaturaId)).status, "ativa");
  const { rows } = await bd.pool.query(
    "SELECT 1 FROM canastra.clientes WHERE user_id = $1",
    [titular.id],
  );
  assert.equal(rows.length, 1, "a conta continua de pé");
});

test("falha do banco no cancelamento responde 500, não 502: o culpado importa", async () => {
  // Sem `.status` carimbado não foi o MP que recusou — foi esta casa. Um 502
  // ali mandaria quem depura procurar o problema no Mercado Pago.
  const titular = await novoTitular("Joana Prado");
  const res = respostaFalsa();
  let chamouGoTrue = false;

  await conta.excluirMinhaConta({ user: { userId: titular.id } }, res, {
    cancelarAssinaturas: async () => {
      throw new Error("o banco caiu ao listar as assinaturas");
    },
    buscar: async () => {
      chamouGoTrue = true;
      return { ok: true, status: 200 };
    },
    ambiente: AMBIENTE_COM_GOTRUE,
  });

  assert.equal(res.codigo, 500);
  assert.equal(chamouGoTrue, false);
});

test("excluirMinhaConta ABORTA se a redação falhar: 500 e o GoTrue nem é chamado", async () => {
  const titular = await novoTitular("Lúcia Amaral");
  const pedidoId = await criarPedido(titular.id);

  let chamouGoTrue = false;
  const res = respostaFalsa();

  // Conexão que deixa tudo passar MENOS a redação — o banco caiu bem ali.
  const conexao = {
    query: (sql, params) => {
      if (String(sql).includes("redigir_dados_do_titular")) {
        throw new Error("o banco caiu no meio da redação");
      }
      return bd.pool.query(sql, params);
    },
  };

  await conta.excluirMinhaConta({ user: { userId: titular.id } }, res, {
    conexao,
    cancelarAssinaturas: async () => [],
    buscar: async () => {
      chamouGoTrue = true;
      return { ok: true, status: 200 };
    },
    ambiente: AMBIENTE_COM_GOTRUE,
  });

  assert.equal(res.codigo, 500);
  assert.equal(chamouGoTrue, false, "apagar sem redigir criaria o órfão irredigível");
  const pedido = await lerPedido(pedidoId);
  assert.equal(pedido.redigido_em, null);
  assert.equal(pedido.endereco_json.street, ENDERECO_VITRINE.street);
});

/**
 * O TROCO ASSUMIDO, exercido de verdade: o GoTrue cai DEPOIS da redação e
 * sobra uma conta viva com os pedidos já redigidos. O desenho aposta que isso
 * é reversível no que importa porque a operação é RE-EXECUTÁVEL — e é essa
 * aposta que este teste cobra. Se a segunda tentativa estourasse (uma redação
 * que "já rodou" virando erro, por exemplo), a pessoa ficaria com uma conta
 * impossível de excluir.
 */
test("retry: GoTrue falha depois de redigir, e a SEGUNDA tentativa conclui", async () => {
  const titular = await novoTitular("Marta Vilela");
  const pedidoId = await criarPedido(titular.id);

  const primeira = respostaFalsa();
  await conta.excluirMinhaConta({ user: { userId: titular.id } }, primeira, {
    cancelarAssinaturas: async () => [],
    buscar: async () => ({ ok: false, status: 500, text: async () => "gotrue caiu" }),
    ambiente: AMBIENTE_COM_GOTRUE,
  });

  assert.equal(primeira.codigo, 502, "o GoTrue recusou; a conta NÃO foi apagada");
  const depoisDaFalha = await lerPedido(pedidoId);
  assert.ok(depoisDaFalha.redigido_em, "o pedido ficou redigido — o lado certo do erro");

  // Segunda tentativa: a redação não acha mais alvo (devolve 0 SEM erro) e o
  // DELETE prossegue. É isto que faz do troco um troco aceitável.
  let redigiuDeNovo = null;
  const segunda = respostaFalsa();
  await conta.excluirMinhaConta({ user: { userId: titular.id } }, segunda, {
    conexao: {
      query: async (sql, params) => {
        const resultado = await bd.pool.query(sql, params);
        if (String(sql).includes("redigir_dados_do_titular")) {
          redigiuDeNovo = resultado.rows[0];
        }
        return resultado;
      },
    },
    cancelarAssinaturas: async () => [],
    buscar: async () => ({ ok: true, status: 200 }),
    ambiente: AMBIENTE_COM_GOTRUE,
  });

  assert.equal(segunda.codigo, 200, "a segunda tentativa conclui");
  assert.ok(redigiuDeNovo, "a redação foi mesmo chamada de novo");
  assert.equal(
    Object.values(redigiuDeNovo)[0],
    0,
    "a redação repetida devolve 0 sem erro — idempotência que destrava o retry",
  );
  const depoisDoRetry = await lerPedido(pedidoId);
  assert.deepEqual(
    depoisDoRetry.redigido_em,
    depoisDaFalha.redigido_em,
    "o carimbo continua sendo o da PRIMEIRA redação",
  );
});

/**
 * A FIAÇÃO DE PRODUÇÃO: todos os testes acima injetam o cancelamento, então
 * nenhum deles veria um erro de digitação no caminho padrão. Aqui o dublê é
 * instalado no `require` (mesmo recurso de f7_clube.test.js) para provar que,
 * SEM injeção, a rota chama `ClubeController.cancelarAssinaturasDoTitular`.
 * O gancho também mantém o ClubeController de verdade (e o SDK do MP) fora
 * desta suíte, que não tem nada com o Mercado Pago.
 */
test("sem injeção, a exclusão chama o cancelamento do ClubeController", async () => {
  const titular = await novoTitular("Nina Rocha");
  await criarPedido(titular.id);

  const chamadas = [];
  const requireOriginal = Module.prototype.require;
  Module.prototype.require = function (caminho) {
    if (caminho === "../controllers/ClubeController") {
      return {
        cancelarAssinaturasDoTitular: async (uid) => {
          chamadas.push(uid);
          return [];
        },
      };
    }
    return requireOriginal.apply(this, arguments);
  };

  const res = respostaFalsa();
  try {
    await conta.excluirMinhaConta({ user: { userId: titular.id } }, res, {
      buscar: async () => ({ ok: true, status: 200 }),
      ambiente: AMBIENTE_COM_GOTRUE,
    });
  } finally {
    Module.prototype.require = requireOriginal;
  }

  assert.equal(res.codigo, 200);
  assert.deepEqual(chamadas, [titular.id], "o titular certo, pelo caminho padrão");
});

/* --------------------------------------------------------------------------
 * A inscrição na newsletter: o vínculo é o E-MAIL, e o e-mail some com a conta
 * -------------------------------------------------------------------------- */

/** Uma inscrição do rodapé para este e-mail, na caixa que se quiser. */
async function inscreverNaNewsletter(email) {
  await bd.pool.query(
    "INSERT INTO canastra.newsletter_inscritos (email, origem) VALUES ($1, 'rodape')",
    [email],
  );
}

async function inscricoesDe(email) {
  const { rows } = await bd.pool.query(
    "SELECT count(*)::int AS n FROM canastra.newsletter_inscritos WHERE lower(email) = lower($1)",
    [email],
  );
  return rows[0].n;
}

/**
 * O furo que este teste guarda: `newsletter_inscritos` (0011) não tem
 * `user_id` — o vínculo com a pessoa é o e-mail, que só existe em
 * `auth.users`. Se o DELETE no GoTrue vier primeiro, ninguém mais consegue
 * dizer de quem era aquela linha, e o e-mail de quem pediu para sumir do banco
 * fica na lista da loja para sempre. Mesma mecânica do pedido irredigível.
 */
test("excluirMinhaConta apaga a inscrição na newsletter ANTES de chamar o GoTrue", async () => {
  const titular = await novoTitular("Sônia Vaz");
  const vizinho = await novoTitular("Tadeu Melo");
  // Em CAIXA DIFERENTE de propósito: quem digitou "Titular9@EX.com" no rodapé
  // continua sendo o titular de "titular9@ex.com".
  await inscreverNaNewsletter(titular.email.toUpperCase());
  await inscreverNaNewsletter(vizinho.email);

  let inscricoesQuandoOGoTrueFoiChamado = null;
  const res = respostaFalsa();

  await conta.excluirMinhaConta({ user: { userId: titular.id } }, res, {
    cancelarAssinaturas: async () => [],
    buscar: async () => {
      // Fotografa o estado NO MOMENTO da chamada: se o DELETE viesse depois,
      // este valor seria 1 e o teste ficaria vermelho.
      inscricoesQuandoOGoTrueFoiChamado = await inscricoesDe(titular.email);
      return { ok: true, status: 200 };
    },
    ambiente: AMBIENTE_COM_GOTRUE,
  });

  assert.equal(res.codigo, 200);
  assert.equal(
    inscricoesQuandoOGoTrueFoiChamado,
    0,
    "quando o GoTrue foi chamado, a inscrição JÁ deveria ter sido apagada",
  );
  assert.equal(await inscricoesDe(vizinho.email), 1, "só a de quem foi excluído");
});

test("falha ao apagar a inscrição ABORTA a exclusão: 500 e o GoTrue nem é chamado", async () => {
  // Mesma disciplina da redação: nada de apagar a conta e deixar o e-mail
  // para trás — depois do DELETE ele fica sem dono identificável.
  const titular = await novoTitular("Ulisses Rocha");
  await inscreverNaNewsletter(titular.email);

  let chamouGoTrue = false;
  const res = respostaFalsa();

  const conexao = {
    query: (sql, params) => {
      if (String(sql).includes("newsletter_inscritos")) {
        throw new Error("o banco caiu ao apagar a inscrição");
      }
      return bd.pool.query(sql, params);
    },
  };

  await conta.excluirMinhaConta({ user: { userId: titular.id } }, res, {
    conexao,
    cancelarAssinaturas: async () => [],
    buscar: async () => {
      chamouGoTrue = true;
      return { ok: true, status: 200 };
    },
    ambiente: AMBIENTE_COM_GOTRUE,
  });

  assert.equal(res.codigo, 500);
  assert.equal(chamouGoTrue, false, "apagar a conta deixaria o e-mail órfão na lista");
  assert.equal(await inscricoesDe(titular.email), 1, "nada foi apagado");
  const { rows } = await bd.pool.query(
    "SELECT 1 FROM canastra.clientes WHERE user_id = $1",
    [titular.id],
  );
  assert.equal(rows.length, 1, "a conta continua de pé");
});

test("titular sem e-mail no GoTrue não trava a exclusão: não há o que casar", async () => {
  // Acontece na SEGUNDA tentativa de uma exclusão que falhou no fim, ou num
  // cliente cuja conta foi apagada por fora. Insistir aqui travaria para
  // sempre uma exclusão que só quer terminar.
  sequencia += 1;
  const id = `00000000-0000-4000-8000-${String(sequencia).padStart(12, "0")}`;
  await criarPessoa(id, null, "Vera Sem E-mail");

  const res = respostaFalsa();
  await conta.excluirMinhaConta({ user: { userId: id } }, res, {
    cancelarAssinaturas: async () => [],
    buscar: async () => ({ ok: true, status: 200 }),
    ambiente: AMBIENTE_COM_GOTRUE,
  });

  assert.equal(res.codigo, 200);
});

test("excluirClientePeloAdmin cancela e redige antes de apagar, pela mesma regra", async () => {
  const titular = await novoTitular("Otto Lemos");
  const pedidoId = await criarPedido(titular.id);
  const assinaturaId = await criarAssinatura(titular.id, { status: "pausada" });
  await inscreverNaNewsletter(titular.email);

  const ordem = [];
  let inscricoesNoGoTrue = null;
  const res = respostaFalsa();

  await conta.excluirClientePeloAdmin(
    { params: { id: titular.id }, user: { userId: OTAVIO } },
    res,
    {
      conexao: bd.pool,
      cancelarAssinaturas: async (uid) => {
        ordem.push("cancelar");
        return cancelarAssinaturasFalso(uid);
      },
      buscar: async () => {
        const { rows } = await bd.pool.query(
          "SELECT redigido_em FROM canastra.pedidos WHERE pedido_id = $1",
          [pedidoId],
        );
        ordem.push(rows[0].redigido_em ? "gotrue-com-redacao" : "gotrue-sem-redacao");
        inscricoesNoGoTrue = await inscricoesDe(titular.email);
        return { ok: true, status: 200 };
      },
      ambiente: AMBIENTE_COM_GOTRUE,
    },
  );

  assert.equal(res.codigo, 200);
  assert.deepEqual(ordem, ["cancelar", "gotrue-com-redacao"]);
  const assinatura = await lerAssinatura(assinaturaId);
  assert.equal(assinatura.status, "cancelada");
  assert.ok(assinatura.redigido_em);
  // A rota do admin segue a MESMA ordem: a inscrição já saiu quando o GoTrue
  // é chamado — depois dele, ela não teria mais dono identificável.
  assert.equal(inscricoesNoGoTrue, 0);
});

test("exclusão pelo admin também aborta na recusa do MP", async () => {
  const titular = await novoTitular("Pedro Lins");
  const pedidoId = await criarPedido(titular.id);
  let chamouGoTrue = false;
  const res = respostaFalsa();

  await conta.excluirClientePeloAdmin(
    { params: { id: titular.id }, user: { userId: OTAVIO } },
    res,
    {
      conexao: bd.pool,
      cancelarAssinaturas: async () => {
        throw recusaDoMercadoPago(["ja-fechada-antes-da-falha"]);
      },
      buscar: async () => {
        chamouGoTrue = true;
        return { ok: true, status: 200 };
      },
      ambiente: AMBIENTE_COM_GOTRUE,
    },
  );

  assert.equal(res.codigo, 502);
  assert.equal(chamouGoTrue, false);
  assert.equal((await lerPedido(pedidoId)).redigido_em, null);
});

/* --------------------------------------------------------------------------
 * Atendimento a titular (lgpd.routes.js)
 * -------------------------------------------------------------------------- */

test("exportação devolve TUDO que a loja guarda sobre o titular", async () => {
  const titular = await novoTitular("Ana Souza", {
    cpf: "12345678901",
    telefone: "35999990000",
  });

  await bd.pool.query(
    `INSERT INTO canastra.enderecos (user_id, cep, rua, numero, bairro, cidade, estado)
     VALUES ($1, '37928-000', 'Rua das Ameixas', '42', 'Centro', 'Piumhi', 'MG')`,
    [titular.id],
  );
  await criarPedido(titular.id);
  await criarAssinatura(titular.id, { status: "ativa", preapproval: "pre-ana" });
  await criarAvaliacao(titular.id);
  // A newsletter é ligada por E-MAIL, não por user_id: a inscrição do rodapé
  // não exige conta. Em CAIXA DIFERENTE de propósito — quem digitou
  // "Titular1@EX.com" continua sendo o titular de "titular1@ex.com".
  await bd.pool.query(
    "INSERT INTO canastra.newsletter_inscritos (email, origem) VALUES ($1, 'rodape')",
    [titular.email.toUpperCase()],
  );
  // Inscrição de OUTRA pessoa: a exportação não pode varrer a tabela.
  await bd.pool.query(
    "INSERT INTO canastra.newsletter_inscritos (email) VALUES ('alheio@ex.com') ON CONFLICT DO NOTHING",
  );

  const res = respostaFalsa();
  await lgpd.exportarDadosDoTitular({ params: { userId: titular.id } }, res, {
    conexao: bd.pool,
  });

  assert.equal(res.codigo, 200);
  const dados = res.corpo;
  assert.ok(dados.gerado_em, "a exportação é datada");
  assert.equal(dados.titular.user_id, titular.id);
  assert.equal(dados.titular.email, titular.email);
  assert.equal(dados.cliente.nome, "Ana Souza");
  assert.equal(dados.cliente.cpf, "12345678901");
  assert.equal(dados.cliente.telefone, "35999990000");

  assert.ok(dados.enderecos.length >= 1);
  assert.equal(dados.enderecos[0].cidade, "Piumhi");

  assert.ok(dados.pedidos.length >= 1, "os pedidos fazem parte dos dados do titular");
  assert.ok(dados.pedidos[0].pedido_id);
  assert.ok(dados.pedidos[0].total);

  // As três que faltavam — art. 18 é direito de acesso ao QUE A LOJA GUARDA,
  // e omitir tabela é responder errado.
  assert.equal(dados.assinaturas.length, 1, "o Clube entra na exportação");
  assert.equal(dados.assinaturas[0].sku, "CLUBE-250");
  assert.equal(dados.assinaturas[0].preco_centavos, 3573);
  assert.equal(dados.assinaturas[0].endereco_json.street, "Rua das Ameixas");

  assert.equal(dados.avaliacoes.length, 1, "a avaliação é texto DA pessoa");
  assert.equal(dados.avaliacoes[0].nome_exibicao, "Ana Souza");
  assert.equal(dados.avaliacoes[0].nota, 5);

  assert.equal(dados.newsletter.length, 1, "a inscrição casa por e-mail, sem caixa");
  assert.equal(dados.newsletter[0].origem, "rodape");
  assert.deepEqual(
    dados.newsletter.map((linha) => linha.email.toLowerCase()),
    [titular.email],
    "e SÓ a do titular",
  );

  // AS COLUNAS DE ATRIBUIÇÃO (0033) FAZEM PARTE DA RESPOSTA. `gclid`/`fbclid`
  // são literalmente o identificador com que uma plataforma de anúncio
  // reconhece esta pessoa, e `referrer`/`landing_page` são comportamento de
  // navegação atrelado a uma venda identificada. Omiti-los faria a exportação
  // esconder algo que a loja guarda.
  for (const coluna of [
    "utm_source",
    "utm_medium",
    "utm_campaign",
    "utm_content",
    "utm_term",
    "canal",
    "referrer",
    "landing_page",
    "gclid",
    "fbclid",
  ]) {
    assert.ok(
      coluna in dados.pedidos[0],
      `a exportação do pedido precisa projetar "${coluna}"`,
    );
  }
});

test("a exportação alcança consentimentos e envios — as duas tabelas que a 0033 criou", async () => {
  // O cabeçalho de `lgpd.routes.js` diz que a lista é "TODA tabela desta loja
  // com dado da pessoa, e quem criar a próxima tem de voltar aqui".
  // `consentimentos` e `envios` nasceram fora dela.
  const titular = await novoTitular("Rita Campos");

  // Consentimento por USER_ID, e outro só por E-MAIL (o do rodapé, dado antes
  // de a pessoa ter conta): a exportação tem de alcançar os dois, senão o
  // histórico mais antigo — que é o que uma contestação vai buscar — some.
  await bd.pool.query(
    `INSERT INTO canastra.consentimentos (user_id, canal, estado, origem)
     VALUES ($1, 'whatsapp', 'concedido', 'checkout')`,
    [titular.id],
  );
  await bd.pool.query(
    `INSERT INTO canastra.consentimentos (email, canal, estado, origem)
     VALUES ($1, 'email', 'revogado', 'rodape')`,
    [titular.email.toUpperCase()],
  );
  // De OUTRA pessoa: a exportação não pode varrer a tabela.
  await bd.pool.query(
    `INSERT INTO canastra.consentimentos (email, canal, estado, origem)
     VALUES ('alheio@ex.com', 'email', 'concedido', 'rodape')`,
  );

  await bd.pool.query(
    `INSERT INTO canastra.envios (canal, user_id, destinatario_final, estado, template)
     VALUES ('email', $1, $2, 'entregue', 'boas-vindas')`,
    [titular.id, titular.email],
  );
  await bd.pool.query(
    `INSERT INTO canastra.envios (canal, destinatario_final, estado)
     VALUES ('email', 'alheio@ex.com', 'enviado')`,
  );

  const res = respostaFalsa();
  await lgpd.exportarDadosDoTitular({ params: { userId: titular.id } }, res, {
    conexao: bd.pool,
  });

  assert.equal(res.codigo, 200);
  assert.equal(res.corpo.consentimentos.length, 2, "por user_id E por e-mail");
  assert.deepEqual(
    new Set(res.corpo.consentimentos.map((c) => c.canal)),
    new Set(["whatsapp", "email"]),
  );
  assert.equal(res.corpo.envios.length, 1);
  assert.equal(res.corpo.envios[0].template, "boas-vindas");
});

test("exportação de titular sem nada devolve listas vazias, nunca erro", async () => {
  // Um cadastro recém-criado é o caso mais comum de um pedido de acesso, e um
  // `undefined` aqui viraria 500 no lugar de uma resposta legítima.
  const titular = await novoTitular("Quitéria Alves");
  const res = respostaFalsa();
  await lgpd.exportarDadosDoTitular({ params: { userId: titular.id } }, res, {
    conexao: bd.pool,
  });

  assert.equal(res.codigo, 200);
  assert.deepEqual(res.corpo.pedidos, []);
  assert.deepEqual(res.corpo.assinaturas, []);
  assert.deepEqual(res.corpo.avaliacoes, []);
  assert.deepEqual(res.corpo.newsletter, []);
  assert.deepEqual(res.corpo.consentimentos, []);
  assert.deepEqual(res.corpo.envios, []);
});

test("404 uniforme: não-cliente e inexistente são indistinguíveis, nos dois endpoints", async () => {
  // OTAVIO existe em auth.users (outro projeto da instância); FANTASMA não
  // existe em lugar nenhum. Se as respostas diferissem, o endpoint viraria
  // oráculo sobre o auth.users compartilhado.
  const respostas = [];
  for (const alvo of [OTAVIO, FANTASMA]) {
    const res = respostaFalsa();
    await lgpd.exportarDadosDoTitular({ params: { userId: alvo } }, res, {
      conexao: bd.pool,
    });
    respostas.push({ codigo: res.codigo, corpo: res.corpo });
  }
  assert.equal(respostas[0].codigo, 404);
  assert.deepEqual(respostas[0], respostas[1], "exportação: byte a byte iguais");

  const redacoes = [];
  for (const alvo of [OTAVIO, FANTASMA]) {
    const res = respostaFalsa();
    await lgpd.redigirTitular({ params: { userId: alvo } }, res, {
      conexao: bd.pool,
    });
    redacoes.push({ codigo: res.codigo, corpo: res.corpo });
  }
  assert.equal(redacoes[0].codigo, 404);
  assert.deepEqual(redacoes[0], redacoes[1], "redação: byte a byte iguais");
});

/**
 * A eliminação PARCIAL, com o limite que a 0016 escolheu: assinatura VIVA não
 * é redigida, porque o endereço é o que executa o contrato que a pessoa
 * continua tendo (art. 16, I). O que sai aqui é o pedido antigo e o nome
 * PÚBLICO da avaliação.
 */
test("redação por endpoint: redige sem apagar a conta e não toca a assinatura viva", async () => {
  const titular = await novoTitular("Rita Campos");
  const pedidoId = await criarPedido(titular.id);
  const avaliacao = await criarAvaliacao(titular.id);
  const assinaturaId = await criarAssinatura(titular.id, { status: "ativa" });
  assert.equal(avaliacao.nome_exibicao, "Rita Campos", "a trigger congelou o nome");

  const res = respostaFalsa();
  await lgpd.redigirTitular(
    { params: { userId: titular.id }, user: { userId: OTAVIO } },
    res,
    { conexao: bd.pool },
  );

  assert.equal(res.codigo, 200);
  assert.equal(res.corpo.pedidosRedigidos, 1);

  const pedido = await lerPedido(pedidoId);
  assert.equal(pedido.endereco_json.street, "[redigido]");

  // O nome PÚBLICO da vitrine sai; nota e texto ficam (prova social, 0014).
  const depois = await lerAvaliacao(avaliacao.id);
  assert.equal(depois.nome_exibicao, "Cliente Canastra");
  assert.equal(depois.nota, 5);
  assert.ok(depois.texto, "o texto da avaliação não é dado pessoal");
  assert.equal(depois.moderado_em, null, "redação não é moderação");

  // A assinatura VIVA fica intacta — redigi-la destruiria a entrega de quem
  // continua assinante.
  const assinatura = await lerAssinatura(assinaturaId);
  assert.equal(assinatura.status, "ativa");
  assert.equal(assinatura.redigido_em, null);
  assert.equal(assinatura.endereco_json.street, "Rua das Ameixas");

  // SEM apagar a conta: é a eliminação parcial do art. 18 — a titular segue
  // cliente.
  const { rows } = await bd.pool.query(
    "SELECT 1 FROM canastra.clientes WHERE user_id = $1",
    [titular.id],
  );
  assert.equal(rows.length, 1, "a conta do titular não é tocada por este endpoint");
});

test("identificador que nem UUID é: 400 antes de tocar o banco", async () => {
  for (const handler of [lgpd.exportarDadosDoTitular, lgpd.redigirTitular]) {
    const res = respostaFalsa();
    await handler({ params: { userId: "me" } }, res, {
      conexao: {
        query: () => {
          throw new Error("o banco não deveria ter sido consultado");
        },
      },
    });
    assert.equal(res.codigo, 400);
  }
});
