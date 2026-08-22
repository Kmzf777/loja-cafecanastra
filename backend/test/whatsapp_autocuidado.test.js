"use strict";

/**
 * As duas coisas que o bot faz por conta propria: parar de tentar quando a
 * credencial morreu, e esquecer eventos velhos.
 *
 * Sao testes SEPARADOS dos de notificacao porque provam POLITICA, nao envio:
 * o que acontece depois que a Meta diz "nao".
 *
 * TRES COISAS QUE ESTE ARQUIVO PRECISA E QUE NAO SAO OBVIAS:
 *
 *   1. OS PEDIDOS EXISTEM NO BANCO. `whatsapp_mensagens.pedido_id` REFERENCIA
 *      `canastra.pedidos` (0017). Sem a linha, o INSERT do rastro morre em
 *      23503 ANTES de o envio acontecer, `avisarCliente` engole (que e o
 *      contrato dele) e nenhum erro da Meta chega a ser produzido — todo teste
 *      de desligamento ficaria vermelho pelo motivo errado, e todo teste de
 *      "NAO desliga" ficaria verde pelo motivo errado.
 *   2. O CARIMBO DE OPT-IN ESTA POSTO. Desde a 0020 o envio exige
 *      `whatsapp_optin_em`; sem ele nao ha tentativa, e nao ha o que desligar.
 *   3. O E-MAIL E DUBLE. `avisarCliente` chama os dois canais, e o de e-mail
 *      real subiria `config/mailer` para simular um envio a cada caso — ruido
 *      num arquivo que so fala de politica do WhatsApp.
 */

const { test, before, after, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const Module = require("node:module");
const { subirPostgres } = require("./ajuda/postgres.js");
const { aplicarMigracoes } = require("../db/migrar.js");

let bd, notificacoes, config, controller;
let proximoErro = null;
let proximoTexto = null;
const zaps = [];

const ANA = "aaaaaaaa-0000-0000-0000-000000000001";

/** Dois pedidos: o segundo prova que a integracao desligada nao tenta de novo. */
const PEDIDO_1 = "3f2504e0-4f89-11d3-9a0c-0305e82c3301";
const PEDIDO_2 = "3f2504e0-4f89-11d3-9a0c-0305e82c3302";

/** O e-mail nao e o assunto deste arquivo: engole e segue. */
const dubleEmail = { sendStatusEmail: async () => {} };

const dubleCliente = {
  VERSAO_GRAPH: "v26.0",
  enviarTemplate: async (cfg, dados) => {
    zaps.push(dados);
    if (proximoErro) {
      const e = new Error(proximoTexto || `ErroDaMeta: POST /messages ${proximoErro}`);
      e.name = "ErroDaMeta";
      e.codigo = proximoErro;
      throw e;
    }
    return { wamid: "wamid.A" + zaps.length };
  },
};

before(async () => {
  bd = await subirPostgres();
  await aplicarMigracoes(bd.pool);

  await bd.pool.query("INSERT INTO auth.users (id, email) VALUES ($1, 'ana@ex.com')", [ANA]);
  await bd.pool.query(
    `INSERT INTO canastra.clientes (user_id, nome, telefone, whatsapp_optin_em)
     VALUES ($1::uuid, 'Ana', '31999990000', now())`,
    [ANA],
  );
  for (const pedidoId of [PEDIDO_1, PEDIDO_2]) {
    await bd.pool.query(
      `INSERT INTO canastra.pedidos (pedido_id, user_id, total, status)
       VALUES ($1::uuid, $2::uuid, 89.90, 'aprovado')`,
      [pedidoId, ANA],
    );
  }

  process.env.DATABASE_URL = bd.connectionString;
  process.env.NODE_ENV = "development";

  const requireOriginal = Module.prototype.require;
  Module.prototype.require = function (caminho) {
    if (caminho === "./whatsappClient") return dubleCliente;
    if (caminho === "../utils/emailSender") return dubleEmail;
    return requireOriginal.apply(this, arguments);
  };
  try {
    notificacoes = require("../src/services/notificacoes.js");
    controller = require("../src/controllers/WhatsappController.js");
  } finally {
    Module.prototype.require = requireOriginal;
  }

  config = require("../src/services/whatsappConfig.js");
}, { timeout: 120_000 });

after(async () => {
  await require("../src/pgPool.js").end().catch(() => {});
  await bd?.derrubar();
});

beforeEach(async () => {
  if (!bd) {
    throw new Error("O Postgres nao subiu no before(); a causa real esta no erro daquele hook.");
  }
  zaps.length = 0;
  proximoErro = null;
  proximoTexto = null;
  await bd.pool.query("DELETE FROM canastra.whatsapp_mensagens");
  await bd.pool.query("DELETE FROM canastra.whatsapp_eventos");
  await bd.pool.query("DELETE FROM canastra.whatsapp_config");
  config.esquecer();
  await config.gravar({ ativo: true, access_token: "tok", phone_number_id: "111" });
});

const pedido = (id) => ({
  order_id: id,
  user_id: ANA,
  total_amount: "89.90",
  status: "aprovado",
});

/**
 * Guarda o que foi para o console durante um trecho, e devolve o console.
 *
 * O LOG E O PRODUTO AQUI, e nao enfeite: um desligamento automatico e a unica
 * coisa nesta base que acontece sem ninguem olhando, e a linha de log e o unico
 * lugar em que a loja fica sabendo. Um `console.error` que so registre "codigo
 * 190" nao diz a pessoa nenhuma que os clientes pararam de ser avisados.
 */
async function comConsoleGravado(corpo) {
  const linhas = [];
  const originais = { error: console.error, warn: console.warn, log: console.log };
  for (const nivel of Object.keys(originais)) {
    console[nivel] = (...args) => linhas.push(args.map(String).join(" "));
  }
  try {
    await corpo();
  } finally {
    Object.assign(console, originais);
  }
  return linhas.join("\n");
}

/** O estado da integracao direto do banco, sem passar pelo cache do modulo. */
async function noBanco() {
  const { rows } = await bd.pool.query(
    "SELECT ativo, ultimo_erro, desligado_em FROM canastra.whatsapp_config WHERE id = 1",
  );
  return rows[0];
}

/* ------------------------------------------------------------------------- *
 * 1. O desligamento automatico
 * ------------------------------------------------------------------------- */

test("token invalido desliga a integracao, e o motivo fica visivel", async () => {
  // O modo de falha que isto impede: com a credencial morta, cada pedido novo
  // dispara uma tentativa que ja se sabe perdida — queima cota da API, enche o
  // log e a loja so descobre quando um cliente reclama.
  proximoErro = 190;
  await notificacoes.avisarCliente(pedido(PEDIDO_1), "aprovado", null);

  const atual = await config.carregar();
  assert.equal(atual.ativo, false);
  assert.match(String(atual.ultimo_erro), /190/);

  // `desligado_em` e a metade que responde "quando", e sem ela `ultimo_erro`
  // nao distingue "morreu agora" de "morreu em marco e alguem religou".
  assert.notEqual(atual.desligado_em, null);

  // A falha da MENSAGEM continua registrada: o desligamento e politica POR
  // CIMA do rastro, e nao no lugar dele.
  const { rows } = await bd.pool.query(
    "SELECT status, erro_codigo FROM canastra.whatsapp_mensagens",
  );
  assert.equal(rows[0].status, "falhou");
  assert.equal(rows[0].erro_codigo, 190);
});

test("depois de desligar sozinho, nao tenta de novo", async () => {
  proximoErro = 190;
  await notificacoes.avisarCliente(pedido(PEDIDO_1), "aprovado", null);
  assert.equal(zaps.length, 1);

  proximoErro = null;
  await notificacoes.avisarCliente(pedido(PEDIDO_2), "aprovado", null);
  assert.equal(zaps.length, 1, "a integracao esta desligada; nao deveria ter tentado");
});

test("erro de entrega NAO desliga a integracao", async () => {
  // 131026 e "aquele numero nao recebe" — problema de UM cliente. Desligar a
  // loja inteira por causa de um numero errado seria a cura pior que a doenca.
  proximoErro = 131026;
  await notificacoes.avisarCliente(pedido(PEDIDO_1), "aprovado", null);

  assert.equal((await config.carregar()).ativo, true);

  // AS DUAS ASSERCOES ABAIXO SAO O QUE IMPEDE ESTE TESTE DE PASSAR DE GRACA.
  // "continua ligado" e verdade numa implementacao que nunca desliga nada; ja
  // "o motivo continua em branco" prova que o caminho do desligamento foi
  // AVALIADO e recusou, e o envio seguinte prova que a integracao esta viva de
  // verdade, e nao so com a coluna intacta.
  const linha = await noBanco();
  assert.equal(linha.ultimo_erro, null);
  assert.equal(linha.desligado_em, null);

  proximoErro = null;
  await notificacoes.avisarCliente(pedido(PEDIDO_2), "aprovado", null);
  assert.equal(zaps.length, 2, "o proximo cliente continua sendo avisado");
});

test("fora da janela tambem nao desliga", async () => {
  // 131047 e "re-engagement": so significa que o template era necessario.
  proximoErro = 131047;
  await notificacoes.avisarCliente(pedido(PEDIDO_1), "aprovado", null);

  assert.equal((await config.carregar()).ativo, true);

  const linha = await noBanco();
  assert.equal(linha.ultimo_erro, null);
  assert.equal(linha.desligado_em, null);

  proximoErro = null;
  await notificacoes.avisarCliente(pedido(PEDIDO_2), "aprovado", null);
  assert.equal(zaps.length, 2);
});

test("a lista de codigos que desligam e fechada, e os dois lados sao medidos", async () => {
  // A tabela inteira num teste so, porque a decisao e uma LISTA e uma lista
  // errada erra dos dois jeitos: um codigo a mais derruba a loja por um numero
  // torto; um a menos deixa o bot batendo numa credencial morta. Os quatro de
  // baixo dizem "a credencial ou a conta morreu"; os quatro de cima dizem "esta
  // mensagem, para este destinatario, nao saiu".
  const naoDesligam = [131026, 131047, 131000, 132001];
  const desligam = [190, 200, 10, 131031];

  for (const [codigo, esperado] of [
    ...naoDesligam.map((c) => [c, true]),
    ...desligam.map((c) => [c, false]),
  ]) {
    await bd.pool.query("DELETE FROM canastra.whatsapp_mensagens");
    await bd.pool.query("DELETE FROM canastra.whatsapp_config");
    config.esquecer();
    await config.gravar({ ativo: true, access_token: "tok", phone_number_id: "111" });

    proximoErro = codigo;
    await notificacoes.avisarCliente(pedido(PEDIDO_1), "aprovado", null);

    const linha = await noBanco();
    assert.equal(
      linha.ativo,
      esperado,
      `o codigo ${codigo} deveria ${esperado ? "MANTER" : "DESLIGAR"} a integracao`,
    );
    // "Desligou" e "registrou por que" andam juntos: uma integracao desligada
    // sem motivo e o mesmo painel mudo de antes desta migracao.
    assert.equal(linha.desligado_em === null, esperado, `o carimbo do codigo ${codigo}`);
  }
});

test("o motivo do desligamento passa pela mesma redacao de erro_texto", async () => {
  // `ultimo_erro` e texto que uma PESSOA le no painel, e o cabecalho de 0020
  // promete que ele nunca carrega dado pessoal. A mensagem de erro tambem
  // chega de runtime, que ninguem escreveu pensando nisso.
  proximoErro = 190;
  proximoTexto = "ErroDaMeta: POST /messages 190 (destino 5531999990000)";
  await notificacoes.avisarCliente(pedido(PEDIDO_1), "aprovado", null);

  const { ultimo_erro: motivo } = await noBanco();
  assert.equal(motivo.includes("5531999990000"), false, `o numero vazou: ${motivo}`);
  assert.match(motivo, /\[numero\]/);
  assert.match(motivo, /190/, "o codigo tem de sobreviver: e o que se procura na documentacao");
});

test("o desligamento que falha nao leva junto o registro da falha da mensagem", async () => {
  // A rede do processo: gravar a configuracao e uma SEGUNDA ida ao banco, e ela
  // pode falhar sozinha (constraint, banco reiniciando). Se ela derrubasse o
  // `catch` do envio, a loja perderia as duas coisas — o desligamento E a linha
  // que explica por que aquele aviso nao saiu.
  //
  // A falha e induzida por CHECK de verdade, e nao por dublê: e o unico jeito
  // de exercitar o caminho de erro do `gravar()` real.
  await bd.pool.query(
    `ALTER TABLE canastra.whatsapp_config
       ADD CONSTRAINT whatsapp_config_sabotagem CHECK (ultimo_erro IS NULL)`,
  );
  try {
    proximoErro = 190;
    // Nao lanca: o contrato de `avisarCliente` vale inclusive aqui.
    const log = await comConsoleGravado(() =>
      notificacoes.avisarCliente(pedido(PEDIDO_1), "aprovado", null),
    );

    // O LOG TEM DE DIZER AS DUAS COISAS, e e esta assercao que obriga o
    // desligamento a ter `try/catch` PROPRIO: sem ele, o erro do Postgres sobe
    // para o `catch` generico de `avisarCliente` e a unica linha que sobra e
    // "Erro ao avisar o cliente por WhatsApp" — que nao conta a quem esta lendo
    // que a credencial morreu, nem o que fazer a respeito.
    assert.match(log, /credencial/i, `o log nao diz que a credencial morreu: ${log}`);
    assert.match(log, /painel/i, `o log nao diz o que fazer: ${log}`);

    const { rows } = await bd.pool.query(
      "SELECT status, erro_codigo FROM canastra.whatsapp_mensagens",
    );
    assert.equal(rows[0].status, "falhou");
    assert.equal(rows[0].erro_codigo, 190);

    // A integracao continua ligada — e essa e a verdade: o desligamento nao
    // aconteceu. Mentir aqui (cache dizendo `false` com o banco dizendo `true`)
    // faria o painel discordar do banco ate o restart.
    assert.equal((await noBanco()).ativo, true);
  } finally {
    await bd.pool.query(
      "ALTER TABLE canastra.whatsapp_config DROP CONSTRAINT whatsapp_config_sabotagem",
    );
  }
});

test("o log do desligamento grita a CONSEQUENCIA, e nao carrega dado pessoal", async () => {
  // As duas metades da mesma linha de log, e as duas sao regra desta casa:
  //
  //   · GRITAR A CONSEQUENCIA. Um "erro 190" sozinho e um numero; o que a
  //     pessoa que abre o log precisa saber e que a loja PAROU de avisar
  //     cliente, e que so um humano no painel desfaz isso.
  //   · NAO CARREGAR NUMERO NEM TOKEN. O log leva o `motivo`, que vem da
  //     mensagem da Meta — o mesmo texto de `erro_texto`, e portanto o mesmo
  //     lugar por onde um telefone entraria.
  proximoErro = 190;
  proximoTexto = "ErroDaMeta: POST /messages 190 (destino 5531999990000)";

  const log = await comConsoleGravado(() =>
    notificacoes.avisarCliente(pedido(PEDIDO_1), "aprovado", null),
  );

  assert.match(log, /DESLIGAD/i, `o log nao diz que a integracao parou: ${log}`);
  assert.match(log, /nenhum cliente/i, `o log nao diz quem deixa de ser avisado: ${log}`);
  assert.match(log, /painel/i, `o log nao diz onde religar: ${log}`);
  assert.equal(log.includes("5531999990000"), false, `o telefone vazou no log: ${log}`);
  assert.equal(log.includes("tok"), false, `o token vazou no log: ${log}`);
});

/* ------------------------------------------------------------------------- *
 * 2. O motivo, visto do painel
 * ------------------------------------------------------------------------- */

test("o painel enxerga o motivo e a hora do desligamento, inteiros", async () => {
  // Nao sao segredo: e a unica resposta a pergunta "fui eu quem desligou, ou a
  // credencial morreu?". Mascara-los seria esconder o diagnostico de quem abriu
  // a tela justamente para diagnosticar.
  proximoErro = 190;
  await notificacoes.avisarCliente(pedido(PEDIDO_1), "aprovado", null);

  const visivel = await config.paraOPainel();
  assert.equal(visivel.ativo, false);
  assert.match(String(visivel.ultimo_erro), /190/);
  assert.notEqual(visivel.desligado_em, null);
});

test("religar no painel apaga o motivo do desligamento anterior", async () => {
  // O modo de falha que isto impede: o gestor troca o token, religa, e o painel
  // continua exibindo "desligado em 12/03 por 190". Meses depois ele desliga a
  // integracao A MAO para uma manutencao, abre a tela e le aquele mesmo motivo
  // velho — e conclui que a credencial morreu de novo. Um `ultimo_erro` que
  // sobrevive ao religamento nao e um diagnostico desatualizado: e um
  // diagnostico ERRADO, que e pior do que nao ter nenhum.
  proximoErro = 190;
  await notificacoes.avisarCliente(pedido(PEDIDO_1), "aprovado", null);
  assert.notEqual((await noBanco()).ultimo_erro, null);

  const res = { codigo: null, corpo: null };
  res.status = (c) => ((res.codigo = c), res);
  res.json = (c) => ((res.codigo = res.codigo ?? 200), (res.corpo = c), res);
  await controller.gravarConfig({ body: { ativo: true, access_token: "tok2" } }, res);

  assert.equal(res.codigo, 200);
  const linha = await noBanco();
  assert.equal(linha.ativo, true);
  assert.equal(linha.ultimo_erro, null);
  assert.equal(linha.desligado_em, null);
});

test("desligar a mao no painel nao inventa motivo nenhum", async () => {
  // O espelho do teste acima: `ultimo_erro` diz "a credencial morreu", e so
  // isso. Um desligamento humano deixa a coluna em branco de proposito — e o
  // branco E a resposta ("fui eu quem desligou").
  const res = { codigo: null, corpo: null };
  res.status = (c) => ((res.codigo = c), res);
  res.json = (c) => ((res.codigo = res.codigo ?? 200), (res.corpo = c), res);
  await controller.gravarConfig({ body: { ativo: false } }, res);

  const linha = await noBanco();
  assert.equal(linha.ativo, false);
  assert.equal(linha.ultimo_erro, null);
  assert.equal(linha.desligado_em, null);
});

test("o painel nao escreve ultimo_erro nem desligado_em pelo corpo do PUT", async () => {
  // Sao colunas de DIAGNOSTICO: quem as escreve e o proprio bot, ao desistir.
  // Aceitas no PUT, elas viravam campo de texto livre — e um painel que
  // "explica" um desligamento que nunca houve.
  const res = { codigo: null, corpo: null };
  res.status = (c) => ((res.codigo = c), res);
  res.json = (c) => ((res.codigo = res.codigo ?? 200), (res.corpo = c), res);
  await controller.gravarConfig(
    { body: { ultimo_erro: "inventado", desligado_em: "2020-01-01T00:00:00Z" } },
    res,
  );

  // Nenhum campo CONHECIDO veio no corpo: a rota recusa em vez de responder
  // "salvo!" sem ter salvado nada.
  assert.equal(res.codigo, 400);
  assert.equal(res.corpo.error, "NADA_A_GRAVAR");
  assert.equal((await noBanco()).ultimo_erro, null);
});

/* ------------------------------------------------------------------------- *
 * 3. A limpeza dos eventos
 * ------------------------------------------------------------------------- */

test("a limpeza apaga evento com mais de sete dias e preserva o de ontem", async () => {
  // Sete dias, e nao "algumas horas": e a janela de reentrega documentada pela
  // Meta. Cortar antes deixa passar justamente a duplicata do fim da janela,
  // que e a que ninguem esta olhando.
  // AS DUAS LINHAS DE BORDA (`limite` e `quase`) PRENDEM O CORTE NUMA JANELA DE
  // DOIS MINUTOS, e sem elas o teste nao mediria os sete dias coisa nenhuma:
  // com so 'velho' (8d) e 'ontem' (1d), QUALQUER corte entre um e oito dias
  // apagaria exatamente as mesmas linhas, e trocar '7 days' por '2 days' — que
  // e o erro real, o TTL curto demais que joga fora a duplicata do fim da
  // janela — passaria verde.
  await bd.pool.query(
    `INSERT INTO canastra.whatsapp_eventos (dedupe_key, recebido_em) VALUES
       ('velho', now() - interval '8 days'),
       ('limite', now() - interval '7 days' - interval '1 minute'),
       ('quase', now() - interval '7 days' + interval '1 minute'),
       ('ontem', now() - interval '1 day'),
       ('agora', now())`,
  );

  const apagados = await controller.limparEventosVelhos();

  assert.equal(apagados, 2);
  // O QUE SOBROU, E NAO SO QUANTOS SUMIRAM: apagar demais e apagar de menos sao
  // erros diferentes, e uma contagem sozinha nao os distingue — um corte em
  // '6 days' tambem apagaria DUAS linhas, so que a segunda seria 'quase', que a
  // Meta ainda pode reentregar.
  const { rows } = await bd.pool.query(
    "SELECT dedupe_key FROM canastra.whatsapp_eventos ORDER BY dedupe_key",
  );
  assert.deepEqual(rows.map((r) => r.dedupe_key), ["agora", "ontem", "quase"]);
});

test("a limpeza numa tabela vazia devolve zero, sem erro", async () => {
  assert.equal(await controller.limparEventosVelhos(), 0);
});
