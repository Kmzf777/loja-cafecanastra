"use strict";

/**
 * A camada de marketing de 0033, vista de fora.
 *
 * O QUE ESTA MIGRACAO E: a atribuicao de venda (de onde veio cada pedido), as
 * campanhas com custo de midia, o consentimento como ESTADO COM PROCEDENCIA, o
 * log de envio por destinatario e as automacoes. Aqui nada ENVIA nada: quem
 * dispara e a Onda 4. O criterio de pronto desta onda e outro, e e o que este
 * arquivo mede: **o banco aceita e recusa as coisas certas**.
 *
 * TRES FAMILIAS DE ASERCAO:
 *
 *   VOCABULARIO ..... valor fora da lista fechada recusa com 23514
 *                     (check_violation) ou 23505 (unique_violation).
 *   PRIVILEGIO/RLS .. 42501, ou zero linhas. O molde e `test/rls.test.js` e a
 *                     personagem principal e a mesma: ESTRANHA, o token valido
 *                     de OUTRO projeto da instancia Supabase compartilhada.
 *   LGPD ............ o que a redacao do titular alcanca e o que ela preserva.
 *                     Aqui mora a decisao sobre `gclid`/`fbclid`.
 *
 * TODA ASERCAO DE RECUSA E EM `err.code`, nunca em texto de mensagem — a mesma
 * regra de rls.test.js, e pelo mesmo motivo: /permission denied/i casa
 * igualmente com um GRANT faltando numa migracao, que e o bug OPOSTO.
 */

const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");

const { subirPostgres } = require("./ajuda/postgres.js");
const { comoPapel, PERMISSAO_NEGADA } = require("./ajuda/sessao.js");
const { aplicarMigracoes } = require("../db/migrar.js");

/** SQLSTATE `check_violation` — o vocabulario fechado recusando. */
const CHECK_VIOLADO = "23514";
/** SQLSTATE `unique_violation` — a campanha repetida, o token repetido. */
const UNICO_VIOLADO = "23505";
/** SQLSTATE `not_null_violation` — a procedencia do consentimento faltando. */
const NULO_VIOLADO = "23502";

let bd;

const ANA = "aaaaaaaa-0000-0000-0000-000000000001";
const DORA = "dddddddd-0000-0000-0000-000000000004";
const ESTRANHA = "eeeeeeee-0000-0000-0000-000000000005";

const SESSAO_ANA = { papel: "authenticated", sub: ANA };
const SESSAO_DORA = { papel: "authenticated", sub: DORA };
const SESSAO_ESTRANHA = { papel: "authenticated", sub: ESTRANHA };
const SESSAO_ANON = { papel: "anon" };

const PED_ANA = "a3333333-0000-0000-0000-000000000001";
const CAMPANHA = "caaaaaaa-0000-4000-8000-000000000001";

/**
 * As quatro tabelas que carregam vinculo com pessoa ou dinheiro de midia e que
 * `anon` NAO pode enxergar de jeito nenhum. A lista e chumbada de proposito: um
 * nome que sair daqui tem de sair no diff.
 */
const FECHADAS_PARA_ANON = ["campanhas", "consentimentos", "envios", "automacoes"];

async function exigeRecusa(sessao, sql, parametros, contexto, codigo = PERMISSAO_NEGADA) {
  await assert.rejects(
    () => comoPapel(bd.pool, sessao, (cliente) => cliente.query(sql, parametros)),
    (erro) => {
      assert.equal(erro.code, codigo, `deveria recusar com ${codigo}: ${contexto}`);
      return true;
    },
  );
}

/** Recusa vinda do PROPRIO banco (dono, sem RLS no caminho): CHECK e UNIQUE. */
async function exigeRecusaDoBanco(sql, parametros, contexto, codigo = CHECK_VIOLADO) {
  await assert.rejects(
    () => bd.pool.query(sql, parametros),
    (erro) => {
      assert.equal(erro.code, codigo, `deveria recusar com ${codigo}: ${contexto}`);
      return true;
    },
  );
}

/** Conta linhas visiveis numa relacao, sob a sessao dada. */
async function contar(sessao, relacao, filtro = "") {
  return comoPapel(bd.pool, sessao, async (cliente) => {
    const { rows } = await cliente.query(
      `SELECT count(*)::int AS n FROM canastra.${relacao} ${filtro}`,
    );
    return rows[0].n;
  });
}

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

  await bd.pool.query(
    `INSERT INTO canastra.campanhas (id, nome, canal, utm_campaign, custo_centavos)
     VALUES ($1, 'Black Friday', 'meta', 'blackfriday26', 250000)`,
    [CAMPANHA],
  );
}, { timeout: 180_000 });

after(async () => {
  await bd?.derrubar();
});

/* ------------------------------------------------------------------------- *
 * Atribuicao: as dez colunas de `pedidos`
 * ------------------------------------------------------------------------- */

test("pedidos ganha as dez colunas de atribuicao, e nenhuma delas recusa uma venda", async () => {
  // O ponto do teste nao e "a coluna existe", e "escrever nela nao pode
  // derrubar o checkout". Atribuicao e enfeite em cima de um pagamento: um
  // CHECK que recuse um utm esquisito trocaria um relatorio por uma VENDA.
  await bd.pool.query(
    `INSERT INTO canastra.pedidos
       (pedido_id, user_id, total, itens, utm_source, utm_medium, utm_campaign,
        utm_content, utm_term, canal, referrer, landing_page, gclid, fbclid)
     VALUES ($1, $2, 99.90, '[]'::jsonb,
             'Google Ads', 'cpc', 'BlackFriday 26', 'anuncio A', 'cafe especial',
             'pago', 'https://google.com/?q=cafe%20especial',
             'https://cafecanastra.com/cafes?utm_source=google&gclid=Cj0KAQ',
             'Cj0KAQ', 'IwAR3xyz')`,
    [PED_ANA, ANA],
  );

  const { rows } = await bd.pool.query(
    "SELECT utm_source, gclid, fbclid FROM canastra.pedidos WHERE pedido_id = $1",
    [PED_ANA],
  );
  assert.equal(rows[0].utm_source, "Google Ads");
  assert.equal(rows[0].gclid, "Cj0KAQ");
});

test("anon NAO le pedido nenhum, e portanto nao le nenhuma coluna de UTM", async () => {
  // `pedidos` nunca teve GRANT para `anon` (0001 inverteu o padrao). As colunas
  // novas herdam essa ausencia, e este teste e a prova de que herdaram — o
  // pedido de "GRANT SELECT nas UTMs para a vitrine" nunca vai chegar sem
  // passar por aqui.
  await exigeRecusa(
    SESSAO_ANON,
    "SELECT utm_source, gclid FROM canastra.pedidos",
    [],
    "anon lendo a atribuicao dos pedidos",
  );
});

/* ------------------------------------------------------------------------- *
 * O que `anon` nao alcanca
 * ------------------------------------------------------------------------- */

test("anon NAO le consentimentos, envios, campanhas nem automacoes", async () => {
  for (const relacao of FECHADAS_PARA_ANON) {
    await exigeRecusa(
      SESSAO_ANON,
      `SELECT * FROM canastra.${relacao}`,
      [],
      `anon lendo ${relacao}`,
    );
  }
});

test("um token de OUTRO projeto nao le nem escreve nada disto", async () => {
  for (const relacao of FECHADAS_PARA_ANON) {
    assert.equal(
      await contar(SESSAO_ESTRANHA, relacao),
      0,
      `${relacao} nao pode mostrar linha a token estrangeiro`,
    );
  }

  await exigeRecusa(
    SESSAO_ESTRANHA,
    "INSERT INTO canastra.campanhas (nome, canal) VALUES ('Golpe', 'meta')",
    [],
    "estranha criando campanha",
  );
});

test("cliente logado nao escreve marketing nenhum", async () => {
  await exigeRecusa(
    SESSAO_ANA,
    "INSERT INTO canastra.campanhas (nome, canal) VALUES ('Minha', 'email')",
    [],
    "cliente criando campanha",
  );
  await exigeRecusa(
    SESSAO_ANA,
    "INSERT INTO canastra.automacoes (nome, gatilho, acao) VALUES ('x','pedido_pago','{}'::jsonb)",
    [],
    "cliente criando automacao",
  );
  assert.equal(await contar(SESSAO_ANA, "campanhas"), 0, "cliente nao le campanha");
});

/* ------------------------------------------------------------------------- *
 * O admin, e o que nem ele escreve
 * ------------------------------------------------------------------------- */

test("admin escreve campanha e automacao", async () => {
  await comoPapel(bd.pool, SESSAO_DORA, async (cliente) => {
    await cliente.query(
      `INSERT INTO canastra.campanhas (nome, canal, utm_campaign, custo_centavos)
       VALUES ('Natal', 'google', 'natal26', 100000)`,
    );
    await cliente.query(
      `INSERT INTO canastra.automacoes (nome, gatilho, espera_minutos, acao)
       VALUES ('Lembrete de sacola', 'carrinho_abandonado', 240,
               '{"canal":"email","template":"abandono"}'::jsonb)`,
    );
  });
  assert.ok((await contar(SESSAO_DORA, "campanhas")) >= 1);
});

test("admin LE consentimentos e envios, e NAO escreve nenhum dos dois", async () => {
  // Sao REGISTRO do que aconteceu, nao regra: quem escreve e o servico, na
  // mesma transacao do gesto que registrou. E a mesma divisao que 0032 fez em
  // `promocao_resgates`.
  assert.equal(await contar(SESSAO_DORA, "consentimentos"), 0);
  assert.equal(await contar(SESSAO_DORA, "envios"), 0);

  await exigeRecusa(
    SESSAO_DORA,
    `INSERT INTO canastra.consentimentos (email, canal, estado, origem)
     VALUES ('x@ex.com', 'email', 'concedido', 'rodape')`,
    [],
    "admin gravando consentimento pelo navegador",
  );
  await exigeRecusa(
    SESSAO_DORA,
    `INSERT INTO canastra.envios (canal, destinatario_final, template)
     VALUES ('email', 'x@ex.com', 'boas_vindas')`,
    [],
    "admin gravando envio pelo navegador",
  );
});

/* ------------------------------------------------------------------------- *
 * Vocabulario e coerencia
 * ------------------------------------------------------------------------- */

test("campanhas: utm_campaign e unica e canonica", async () => {
  await exigeRecusaDoBanco(
    `INSERT INTO canastra.campanhas (nome, canal, utm_campaign)
     VALUES ('Outra', 'email', 'blackfriday26')`,
    [],
    "duas campanhas com o mesmo utm_campaign",
    UNICO_VIOLADO,
  );

  // 'BlackFriday' e 'blackfriday' sao a MESMA campanha para o gestor e duas
  // linhas diferentes para o `=` do Postgres. E a familia de bug do CEP
  // (commit 7fe8d36): a atribuicao casaria por igualdade exata e a metade das
  // vendas cairia fora do relatorio, sem erro nenhum.
  await exigeRecusaDoBanco(
    `INSERT INTO canastra.campanhas (nome, canal, utm_campaign)
     VALUES ('Maiuscula', 'email', 'BlackFriday')`,
    [],
    "utm_campaign com maiuscula",
  );
  await exigeRecusaDoBanco(
    `INSERT INTO canastra.campanhas (nome, canal, utm_campaign)
     VALUES ('Com espaco', 'email', 'black friday')`,
    [],
    "utm_campaign com espaco",
  );

  await exigeRecusaDoBanco(
    `INSERT INTO canastra.campanhas (nome, canal) VALUES ('Fora', 'telepatia')`,
    [],
    "canal de campanha fora da lista",
  );

  await exigeRecusaDoBanco(
    `INSERT INTO canastra.campanhas (nome, canal, custo_centavos)
     VALUES ('Negativa', 'meta', -1)`,
    [],
    "custo de midia negativo",
  );
});

test("consentimentos: canal, estado e a procedencia", async () => {
  await exigeRecusaDoBanco(
    `INSERT INTO canastra.consentimentos (email, canal, estado, origem)
     VALUES ('a@ex.com', 'pombo', 'concedido', 'rodape')`,
    [],
    "canal de consentimento fora da lista",
  );
  await exigeRecusaDoBanco(
    `INSERT INTO canastra.consentimentos (email, canal, estado, origem)
     VALUES ('a@ex.com', 'email', 'talvez', 'rodape')`,
    [],
    "estado de consentimento fora da lista",
  );
  // A PROCEDENCIA E O QUE PROVA O CONSENTIMENTO. Sem ela sobra um booleano, que
  // e exatamente o que a LGPD nao aceita como prova.
  await exigeRecusaDoBanco(
    `INSERT INTO canastra.consentimentos (email, canal, estado)
     VALUES ('a@ex.com', 'email', 'concedido')`,
    [],
    "consentimento sem origem",
    NULO_VIOLADO,
  );
  // E um consentimento que nao identifica ninguem nao prova nada sobre
  // ninguem.
  await exigeRecusaDoBanco(
    `INSERT INTO canastra.consentimentos (canal, estado, origem)
     VALUES ('email', 'concedido', 'rodape')`,
    [],
    "consentimento sem titular, e-mail nem telefone",
  );
});

test("envios: estado fechado e as datas em ordem", async () => {
  await exigeRecusaDoBanco(
    `INSERT INTO canastra.envios (canal, destinatario_final, estado)
     VALUES ('email', 'a@ex.com', 'quase')`,
    [],
    "estado de envio fora da lista",
  );
  await exigeRecusaDoBanco(
    `INSERT INTO canastra.envios (canal, destinatario_final, estado, entregue_em)
     VALUES ('email', 'a@ex.com', 'entregue', now())`,
    [],
    "entregue sem ter sido enviado",
  );
  await exigeRecusaDoBanco(
    `INSERT INTO canastra.envios (canal, destinatario_final, estado, erro_texto)
     VALUES ('email', 'a@ex.com', 'entregue', 'caiu')`,
    [],
    "texto de erro num envio que nao falhou",
  );
});

test("automacoes: gatilho fechado, acao de verdade, e nasce DESLIGADA", async () => {
  await exigeRecusaDoBanco(
    `INSERT INTO canastra.automacoes (nome, gatilho, acao)
     VALUES ('x', 'quando_der_vontade', '{}'::jsonb)`,
    [],
    "gatilho fora da lista",
  );
  await exigeRecusaDoBanco(
    `INSERT INTO canastra.automacoes (nome, gatilho, acao, espera_minutos)
     VALUES ('x', 'pedido_pago', '{}'::jsonb, -5)`,
    [],
    "espera negativa",
  );
  await exigeRecusaDoBanco(
    `INSERT INTO canastra.automacoes (nome, gatilho, acao)
     VALUES ('x', 'pedido_pago', '"mande um email"'::jsonb)`,
    [],
    "acao que nao e objeto",
  );

  const { rows } = await bd.pool.query(
    `INSERT INTO canastra.automacoes (nome, gatilho, acao)
     VALUES ('Boas-vindas', 'cliente_novo', '{"canal":"email"}'::jsonb)
     RETURNING ativa`,
  );
  // Automacao que nasce LIGADA dispara para clientes de verdade antes de
  // alguem ter revisado o texto. O interruptor e um gesto deliberado.
  assert.equal(rows[0].ativa, false);
});

/* ------------------------------------------------------------------------- *
 * A saida da lista, e o link que devolve a sacola
 * ------------------------------------------------------------------------- */

test("newsletter: o token de descadastro e unico e tem entropia minima", async () => {
  const token = "a".repeat(43);
  await bd.pool.query(
    `INSERT INTO canastra.newsletter_inscritos (email, token_descadastro)
     VALUES ('bea@ex.com', $1)`,
    [token],
  );
  await exigeRecusaDoBanco(
    `INSERT INTO canastra.newsletter_inscritos (email, token_descadastro)
     VALUES ('cida@ex.com', $1)`,
    [token],
    "dois inscritos com o mesmo token",
    UNICO_VIOLADO,
  );
  // Token curto e token adivinhavel, e um token adivinhavel descadastra
  // terceiro. O CHECK e o que faz "esqueci de sortear" ERRAR.
  await exigeRecusaDoBanco(
    `INSERT INTO canastra.newsletter_inscritos (email, token_descadastro)
     VALUES ('duda@ex.com', '123456')`,
    [],
    "token de descadastro curto demais",
  );
  // Dois inscritos SEM token continuam podendo existir: o indice e parcial.
  await bd.pool.query(
    "INSERT INTO canastra.newsletter_inscritos (email) VALUES ('eva@ex.com'), ('fabi@ex.com')",
  );

  await bd.pool.query(
    `UPDATE canastra.newsletter_inscritos SET optout_em = now(), confirmado_em = now()
      WHERE email = 'bea@ex.com'`,
  );
});

test("carrinho: o token de retomada e unico, tem entropia minima e nao vaza para fora do dono", async () => {
  const token = "b".repeat(43);
  await bd.pool.query(
    "INSERT INTO canastra.carrinhos (user_id, token_retomada) VALUES ($1, $2)",
    [ANA, token],
  );
  await exigeRecusaDoBanco(
    "INSERT INTO canastra.carrinhos (user_id, token_retomada) VALUES ($1, $2)",
    [DORA, token],
    "dois carrinhos com o mesmo token de retomada",
    UNICO_VIOLADO,
  );
  await exigeRecusaDoBanco(
    "UPDATE canastra.carrinhos SET token_retomada = 'abc' WHERE user_id = $1",
    [ANA],
    "token de retomada curto demais",
  );

  // O token e a chave do carrinho no link do e-mail. Quem nao e dono da linha
  // nao ve a linha, entao nao ve o token — a politica `carrinhos_dono` de 0006
  // ja resolve, e este caso e a prova de que a coluna nova nao abriu porta.
  assert.equal(await contar(SESSAO_ESTRANHA, "carrinhos"), 0);
  assert.equal(await contar(SESSAO_ANA, "carrinhos"), 1);
});

/* ------------------------------------------------------------------------- *
 * LGPD: a decisao sobre `gclid` e `fbclid`
 * ------------------------------------------------------------------------- */

test("a redacao do titular apaga o identificador de anuncio e preserva a campanha", async () => {
  await bd.pool.query(
    `INSERT INTO canastra.envios (canal, campanha_id, user_id, destinatario_final, template, estado)
     VALUES ('email', $1, $2, 'ana@ex.com', 'boas_vindas', 'enviado')`,
    [CAMPANHA, ANA],
  );

  const redigidos = await bd.pool.query(
    "SELECT canastra.redigir_dados_do_titular($1) AS n",
    [ANA],
  );
  assert.ok(redigidos.rows[0].n >= 1, "a redacao tem de alcancar o pedido da Ana");

  const { rows } = await bd.pool.query(
    `SELECT utm_source, utm_campaign, canal, gclid, fbclid, referrer, landing_page
       FROM canastra.pedidos WHERE pedido_id = $1`,
    [PED_ANA],
  );
  const pedido = rows[0];

  // SAI: identificador de clique. Google e Meta resolvem `gclid`/`fbclid` para
  // um perfil de pessoa — e o pedido ja diz quem, quando e para onde.
  assert.equal(pedido.gclid, null, "gclid tem de sair na redacao");
  assert.equal(pedido.fbclid, null, "fbclid tem de sair na redacao");

  // FICA: a campanha. E estatistica de venda, como cidade e UF em 0013 — nao
  // identifica ninguem sozinha e e o unico registro de onde a venda veio.
  assert.equal(pedido.utm_source, "Google Ads");
  assert.equal(pedido.utm_campaign, "BlackFriday 26");
  assert.equal(pedido.canal, "pago");

  // E A QUERY STRING SAI JUNTO: a `landing_page` de um anuncio carrega o MESMO
  // gclid por construcao. Redigir a coluna e deixar o identificador na URL ao
  // lado seria teatro de redacao.
  assert.equal(pedido.landing_page, "https://cafecanastra.com/cafes");
  assert.equal(pedido.referrer, "https://google.com/");

  // O log de envio guarda a ESTATISTICA e perde o endereco.
  const envio = await bd.pool.query(
    "SELECT destinatario_final, estado FROM canastra.envios WHERE user_id = $1",
    [ANA],
  );
  assert.equal(envio.rows[0].destinatario_final, "[redigido]");
  assert.equal(envio.rows[0].estado, "enviado");
});

test("redigir_url sozinha: as formas que nao sao URL nenhuma nao derrubam a redacao", async () => {
  const { rows } = await bd.pool.query(
    `SELECT canastra.redigir_url('https://a.com/p?x=1#frag') AS com_query,
            canastra.redigir_url('https://a.com/p')          AS sem_query,
            canastra.redigir_url('lixo sem url')             AS lixo,
            canastra.redigir_url(NULL)                       AS nulo,
            canastra.redigir_url('')                         AS vazio`,
  );
  assert.equal(rows[0].com_query, "https://a.com/p");
  assert.equal(rows[0].sem_query, "https://a.com/p");
  assert.equal(rows[0].lixo, "lixo sem url");
  assert.equal(rows[0].nulo, null);
  assert.equal(rows[0].vazio, "");
});
