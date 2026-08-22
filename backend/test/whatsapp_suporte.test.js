"use strict";

/**
 * O ROTEADOR DO MENU DE SUPORTE — o que acontece quando o cliente aperta
 * "Preciso de ajuda", e o que acontece com tudo mais que ele mandar.
 *
 * BANCO REAL, e nao dublê: quem e cliente, qual e o pedido mais recente, quem
 * ja pediu para parar e QUANDO foi a ultima entrada sao perguntas que so o
 * Postgres responde — e tres dos comportamentos aqui (o casamento pelo nono
 * digito, o wa_id gravado, o teto de um menu por janela) sao exatamente sobre a
 * resposta dele. Um dublê de pool provaria que o SQL foi montado, nao que ele
 * acha o cliente.
 *
 * A Graph API entra como dublê instalado pelo hook de `Module.prototype.require`
 * — o mesmo desenho de `whatsapp_notificacoes.test.js`, casando O LITERAL que
 * cada modulo alvo escreve (`../services/whatsappClient` no controller,
 * `./whatsappClient` no servico de notificacoes).
 *
 * AS CINCO COISAS QUE ESTE ARQUIVO EXISTE PARA PROVAR:
 *
 *   1. o roteamento usa `interactive.button_reply.id`, NUNCA `button.payload` —
 *      o payload vem do TEXTO do template aprovado e muda se ele for traduzido;
 *   2. nao existe STOP nativo na Meta, entao PARAR/SAIR/STOP em texto livre
 *      precisa ter o mesmo efeito do botao;
 *   3. o `from` do webhook pode vir SEM o nono digito (a Meta documenta que,
 *      para Brasil e Mexico, ela mesma pode mexer no prefixo), e casar so pelo
 *      literal daria "cliente desconhecido" para metade do pais;
 *   4. o teto de UM MENU POR JANELA, sem o qual cliente e bot entram em
 *      pingue-pongue e cada volta conta contra a nota de qualidade do numero;
 *   5. `rotearMensagem` nunca lanca — o handler do webhook ja respondeu 200.
 */

const { test, before, after, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const Module = require("node:module");
const { subirPostgres } = require("./ajuda/postgres.js");
const { aplicarMigracoes } = require("../db/migrar.js");

let bd;
let controller;
let notificacoes;
let config;
let pgPool;

/** Tudo que saiu para a Meta, na ordem, ja na forma que o cliente HTTP recebe. */
const enviadas = [];
/** Os e-mails do wrapper de notificacao — so para provar o opt-out ponta a ponta. */
const emails = [];
/** Interruptores de falha, ligados dentro de um teste e zerados no beforeEach. */
const quebrar = { envio: false };

/**
 * A resposta HTTP em voo, quando o teste ponta a ponta chama `receber`.
 *
 * O dublê anota `resEmVoo?.codigo` em cada envio: e assim que se prova que o
 * 200 saiu ANTES do roteamento. Uma implementacao que roteasse primeiro e
 * respondesse depois deixaria `respondeuAntes` em `undefined` — e a Meta, do
 * outro lado, ja teria contado o atraso contra o webhook.
 */
let resEmVoo = null;

const ANA = "aaaaaaaa-0000-0000-0000-000000000001";
const CADU = "aaaaaaaa-0000-0000-0000-000000000002";
const DANI = "aaaaaaaa-0000-0000-0000-000000000003";

/** O que cada um digitou no cadastro — SEM DDI, que e como quase todo mundo digita. */
const TELEFONES = Object.freeze({
  [ANA]: "31999990000",
  [CADU]: "31977776666",
  [DANI]: "31966665555",
});

/** O `from` que a Meta manda para a Ana no caso comum: E.164, com o nono digito. */
const WA_ANA = "5531999990000";
/** O MESMO numero como a Cloud API brasileira pode devolve-lo: sem o nono. */
const WA_ANA_SEM_NONO = "553199990000";
const WA_CADU = "5531977776666";
/** Ninguem. Nao casa por wa_id nem por variante. */
const WA_ESTRANHO = "5511900001111";

/** O numero humano da loja, que "Falar com alguem" entrega. */
const SUPORTE = "553133334444";

const PEDIDO_VELHO = "3f2504e0-4f89-11d3-9a0c-0305e82c3301";
const PEDIDO_NOVO = "3f2504e0-4f89-11d3-9a0c-0305e82c3302";

const dubleCliente = {
  VERSAO_GRAPH: "v26.0",
  enviarInterativa: async (cfg, dados) => {
    if (quebrar.envio) {
      const e = new Error("WhatsApp: POST /messages respondeu HTTP 400, código 131047");
      e.name = "ErroDaMeta";
      e.codigo = 131047;
      throw e;
    }
    enviadas.push({ tipo: "interativa", respondeuAntes: resEmVoo?.codigo, ...dados });
    return { wamid: `wamid.I${enviadas.length}` };
  },
  enviarTexto: async (cfg, dados) => {
    if (quebrar.envio) {
      const e = new Error("WhatsApp: POST /messages respondeu HTTP 400, código 131047");
      e.name = "ErroDaMeta";
      e.codigo = 131047;
      throw e;
    }
    enviadas.push({ tipo: "texto", respondeuAntes: resEmVoo?.codigo, ...dados });
    return { wamid: `wamid.T${enviadas.length}` };
  },
  enviarTemplate: async (cfg, dados) => {
    enviadas.push({ tipo: "template", ...dados });
    return { wamid: `wamid.M${enviadas.length}` };
  },
};

const dubleEmail = {
  sendStatusEmail: async (order, status, rastreio) => {
    emails.push({ order, status, rastreio });
  },
};

before(async () => {
  bd = await subirPostgres();
  await aplicarMigracoes(bd.pool);

  for (const [id, email, nome] of [
    [ANA, "ana@ex.com", "Ana"],
    [CADU, "cadu@ex.com", "Cadu"],
    [DANI, "dani@ex.com", "Dani"],
  ]) {
    await bd.pool.query("INSERT INTO auth.users (id, email) VALUES ($1, $2)", [id, email]);
    await bd.pool.query(
      `INSERT INTO canastra.clientes (user_id, nome, telefone, whatsapp_optin_em)
       VALUES ($1::uuid, $2, $3, now())`,
      [id, nome, TELEFONES[id]],
    );
  }

  // DOIS pedidos para a Ana, com datas diferentes: "o mais recente" so e uma
  // afirmacao verificavel se existir um mais antigo para o teste errar.
  await bd.pool.query(
    `INSERT INTO canastra.pedidos (pedido_id, user_id, total, status, codigo_rastreio, criado_em)
     VALUES ($1::uuid, $3::uuid, 89.90, 'entregue', 'VV111111111BR', now() - interval '10 days'),
            ($2::uuid, $3::uuid, 120.00, 'enviado',  'AA123456789BR', now() - interval '1 day')`,
    [PEDIDO_VELHO, PEDIDO_NOVO, ANA],
  );

  process.env.DATABASE_URL = bd.connectionString;
  process.env.NODE_ENV = "development";

  // As SEMENTES DA `.env` SAEM DE CENA. `whatsappConfig` le banco → env, entao
  // um `LOJA_WHATSAPP` na maquina de quem roda a suite preencheria
  // `numero_suporte` sozinho e o teste de "sem numero de suporte" nunca
  // exercitaria o ramo que ele existe para cobrir.
  for (const chave of [
    "META_ACCESS_TOKEN",
    "META_APP_SECRET",
    "META_VERIFY_TOKEN",
    "META_PHONE_NUMBER_ID",
    "META_WABA_ID",
    "META_ATIVO",
    "LOJA_WHATSAPP",
  ]) {
    delete process.env[chave];
  }

  // O `caminho` casado e o LITERAL que cada modulo alvo escreve — sao dois
  // literais diferentes para o MESMO arquivo, e e por isso que os dois estao
  // aqui.
  const requireOriginal = Module.prototype.require;
  Module.prototype.require = function (caminho) {
    if (caminho === "../services/whatsappClient") return dubleCliente;
    if (caminho === "./whatsappClient") return dubleCliente;
    if (caminho === "../utils/emailSender") return dubleEmail;
    return requireOriginal.apply(this, arguments);
  };
  try {
    controller = require("../src/controllers/WhatsappController.js");
    notificacoes = require("../src/services/notificacoes.js");
  } finally {
    Module.prototype.require = requireOriginal;
  }

  config = require("../src/services/whatsappConfig.js");
  pgPool = require("../src/pgPool.js");
}, { timeout: 120_000 });

after(async () => {
  await require("../src/pgPool.js").end().catch(() => {});
  await bd?.derrubar();
});

beforeEach(async () => {
  if (!bd) {
    throw new Error("O Postgres nao subiu no before(); a causa real esta no erro daquele hook.");
  }
  enviadas.length = 0;
  emails.length = 0;
  quebrar.envio = false;
  resEmVoo = null;

  await bd.pool.query("DELETE FROM canastra.whatsapp_mensagens");
  await bd.pool.query("DELETE FROM canastra.whatsapp_eventos");
  await bd.pool.query("DELETE FROM canastra.whatsapp_config");

  // O wa_id, o opt-out, o relogio da janela E o telefone voltam ao estado
  // semeado. O telefone entra nesta limpeza porque um dos testes o troca para
  // fabricar ambiguidade; sem restaura-lo, os seguintes mediriam outra coisa.
  for (const [id, telefone] of Object.entries(TELEFONES)) {
    await bd.pool.query(
      `UPDATE canastra.clientes
          SET telefone = $2, whatsapp_wa_id = NULL, whatsapp_optout_em = NULL,
              whatsapp_ultima_entrada_em = NULL
        WHERE user_id = $1::uuid`,
      [id, telefone],
    );
  }

  config.esquecer();
  await config.gravar({
    ativo: true,
    access_token: "tok",
    phone_number_id: "111",
    numero_suporte: SUPORTE,
  });
});

/* ------------------------------------------------------------------------- *
 * Fabricas de mensagem — as tres formas que a Meta manda
 * ------------------------------------------------------------------------- */

let sequencia = 0;
const proximoWamid = () => `wamid.HBgNNTUzMTk5OTk5MDAwMD${++sequencia}`;

/** Texto livre. */
const msgTexto = (corpo, from = WA_ANA) => ({
  id: proximoWamid(),
  from,
  type: "text",
  text: { body: corpo },
});

/**
 * O clique no quick-reply de um TEMPLATE aprovado. O que ele traz e
 * `button.payload`, que vem do TEXTO do botao e muda se o template for
 * traduzido.
 */
const msgBotaoDeTemplate = (payload, from = WA_ANA) => ({
  id: proximoWamid(),
  from,
  type: "button",
  button: { payload, text: payload },
});

/** O clique numa mensagem INTERATIVA. O `id` e definido por nos, e e estavel. */
const msgBotao = (id, titulo = null, from = WA_ANA) => ({
  id: proximoWamid(),
  from,
  type: "interactive",
  interactive: { type: "button_reply", button_reply: { id, title: titulo } },
});

/** O `value` do webhook, que e o segundo parametro de `rotearMensagem`. */
const valorDe = (msg) => ({
  messaging_product: "whatsapp",
  metadata: { display_phone_number: "5531000000000", phone_number_id: "111" },
  contacts: [{ profile: { name: "Ana" }, wa_id: msg.from }],
  messages: [msg],
});

const rotear = (msg) => controller.rotearMensagem(msg, valorDe(msg));

const clienteDe = async (userId) => {
  const { rows } = await bd.pool.query(
    `SELECT whatsapp_wa_id, whatsapp_optout_em, whatsapp_ultima_entrada_em
       FROM canastra.clientes WHERE user_id = $1::uuid`,
    [userId],
  );
  return rows[0];
};

/** Captura TODO console — e por onde se prova que nada pessoal vai para o log. */
function capturarLog() {
  const linhas = [];
  const originais = {
    log: console.log,
    info: console.info,
    warn: console.warn,
    error: console.error,
  };
  const captar = (...args) => {
    linhas.push(args.map((a) => (typeof a === "string" ? a : JSON.stringify(a))).join(" "));
  };
  console.log = captar;
  console.info = captar;
  console.warn = captar;
  console.error = captar;
  return {
    linhas,
    restaurar() {
      Object.assign(console, originais);
    },
  };
}

/* ------------------------------------------------------------------------- *
 * 1-2. O botao do template abre a conversa
 * ------------------------------------------------------------------------- */

test("o quick-reply do template responde com o menu de tres botoes", async () => {
  await rotear(msgBotaoDeTemplate("Preciso de ajuda"));

  assert.equal(enviadas.length, 1);
  assert.equal(enviadas[0].tipo, "interativa");
  assert.equal(enviadas[0].para, WA_ANA);
  assert.deepEqual(
    enviadas[0].botoes.map((b) => b.id),
    ["meu_pedido", "falar_humano", "parar_avisos"],
  );
});

test("o clique carimba whatsapp_ultima_entrada_em — e o relogio da janela de 24h", async () => {
  assert.equal((await clienteDe(ANA)).whatsapp_ultima_entrada_em, null);

  await rotear(msgBotaoDeTemplate("Preciso de ajuda"));

  const depois = (await clienteDe(ANA)).whatsapp_ultima_entrada_em;
  assert.ok(depois instanceof Date, "sem o carimbo, o teto de um menu por janela nunca dispara");
  // O carimbo e recente de verdade, e nao um valor herdado de outro caminho.
  assert.ok(Date.now() - depois.getTime() < 60_000);
});

/* ------------------------------------------------------------------------- *
 * 3-5. As tres acoes do menu
 * ------------------------------------------------------------------------- */

test("meu_pedido responde o status do pedido MAIS RECENTE, por extenso e com o rastreio", async () => {
  await rotear(msgBotao("meu_pedido", "Meu pedido"));

  assert.equal(enviadas.length, 1);
  assert.equal(enviadas[0].tipo, "texto");
  const texto = enviadas[0].texto;
  // Por extenso: "enviado" e vocabulario interno, e nao frase que se manda a
  // alguem. O cliente le o que aconteceu com a encomenda dele.
  assert.ok(/a caminho/i.test(texto), `sem o status por extenso: ${texto}`);
  assert.ok(texto.includes("AA123456789BR"), `sem o codigo de rastreio: ${texto}`);
  assert.ok(texto.includes(PEDIDO_NOVO.slice(0, 8)));
  // E o pedido de dez dias atras NAO e o que ele recebe.
  assert.ok(!texto.includes("VV111111111BR"), `respondeu o pedido velho: ${texto}`);
  assert.ok(!/entregue/i.test(texto), `respondeu o status do pedido velho: ${texto}`);
});

test("meu_pedido de pedido sem rastreio nao promete codigo nenhum", async () => {
  await bd.pool.query(
    "UPDATE canastra.pedidos SET codigo_rastreio = NULL WHERE pedido_id = $1::uuid",
    [PEDIDO_NOVO],
  );
  try {
    await rotear(msgBotao("meu_pedido"));
  } finally {
    await bd.pool.query(
      "UPDATE canastra.pedidos SET codigo_rastreio = 'AA123456789BR' WHERE pedido_id = $1::uuid",
      [PEDIDO_NOVO],
    );
  }

  assert.equal(enviadas.length, 1);
  assert.ok(/a caminho/i.test(enviadas[0].texto));
  assert.ok(!/rastreio/i.test(enviadas[0].texto), enviadas[0].texto);
  assert.ok(!/null|undefined/.test(enviadas[0].texto), enviadas[0].texto);
});

test("meu_pedido de quem nao tem pedido nenhum responde, sem erro", async () => {
  await rotear(msgBotao("meu_pedido", "Meu pedido", WA_CADU));

  assert.equal(enviadas.length, 1);
  assert.equal(enviadas[0].para, WA_CADU);
  assert.ok(
    /n[aã]o encontrei pedido no seu n[uú]mero/i.test(enviadas[0].texto),
    enviadas[0].texto,
  );
});

test("falar_humano responde o link do numero lido de whatsapp_config.numero_suporte", async () => {
  await rotear(msgBotao("falar_humano", "Falar com alguém"));

  assert.equal(enviadas.length, 1);
  assert.equal(enviadas[0].tipo, "texto");
  assert.ok(
    enviadas[0].texto.includes(`https://wa.me/${SUPORTE}`),
    `o link nao saiu do numero configurado: ${enviadas[0].texto}`,
  );
});

test("falar_humano sem numero de suporte configurado ainda responde, sem link quebrado", async () => {
  // O ramo existe porque `numero_suporte` e NULL em toda instalacao ate alguem
  // preencher o painel. Sem ele, o cliente receberia "https://wa.me/null".
  await config.gravar({ numero_suporte: null });

  await rotear(msgBotao("falar_humano"));

  assert.equal(enviadas.length, 1);
  assert.ok(!/wa\.me/.test(enviadas[0].texto), enviadas[0].texto);
  assert.ok(!/null|undefined/.test(enviadas[0].texto), enviadas[0].texto);
});

/* ------------------------------------------------------------------------- *
 * 6-8. O opt-out, que a Meta nao faz por voce
 * ------------------------------------------------------------------------- */

test("parar_avisos carimba whatsapp_optout_em e confirma", async () => {
  await rotear(msgBotao("parar_avisos", "Parar avisos"));

  const cliente = await clienteDe(ANA);
  assert.ok(cliente.whatsapp_optout_em instanceof Date, "o opt-out nao foi carimbado");
  assert.equal(enviadas.length, 1);
  assert.equal(enviadas[0].tipo, "texto");
  assert.ok(enviadas[0].texto.length > 0);
});

test("depois do opt-out, avisarCliente nao manda mais nada para aquele cliente", async () => {
  // A prova PONTA A PONTA: o botao do roteador e a guarda do wrapper de
  // notificacao sao codigos diferentes, e so esta linha amarra os dois.
  await rotear(msgBotao("parar_avisos"));
  enviadas.length = 0;

  await notificacoes.avisarCliente(
    { order_id: PEDIDO_NOVO, user_id: ANA, total_amount: "120.00", status: "enviado" },
    "enviado",
    "AA123456789BR",
  );

  assert.equal(emails.length, 1, "o e-mail continua: o opt-out e do WhatsApp");
  assert.equal(enviadas.length, 0, "o opt-out nao alcancou o aviso de status");
  const { rows } = await bd.pool.query(
    "SELECT count(*)::int AS n FROM canastra.whatsapp_mensagens",
  );
  assert.equal(rows[0].n, 0, "nem rastro de tentativa deve nascer");
});

test("PARAR, parar e sair em texto livre tem o MESMO efeito do botao", async () => {
  // NAO EXISTE STOP NATIVO NA META: ela nao intercepta texto nenhum. Parar de
  // mandar e inteiramente responsabilidade da loja, e por isso o texto livre
  // precisa valer tanto quanto o botao.
  for (const palavra of ["PARAR", "parar", "sair", "Stop", " PARAR! "]) {
    enviadas.length = 0;
    await bd.pool.query(
      `UPDATE canastra.clientes
          SET whatsapp_optout_em = NULL, whatsapp_ultima_entrada_em = NULL
        WHERE user_id = $1::uuid`,
      [ANA],
    );

    await rotear(msgTexto(palavra));

    const cliente = await clienteDe(ANA);
    assert.ok(
      cliente.whatsapp_optout_em instanceof Date,
      `"${palavra}" nao carimbou o opt-out`,
    );
    assert.equal(enviadas.length, 1, `"${palavra}" nao confirmou nada`);
    assert.equal(enviadas[0].tipo, "texto");
  }
});

test("texto que apenas CONTEM 'parar' nao desliga os avisos de ninguem", async () => {
  // O casamento e da frase inteira, e nao de substring: "nao quero parar de
  // receber" pedindo o contrario do que dispararia.
  await rotear(msgTexto("nao quero parar de receber"));

  assert.equal((await clienteDe(ANA)).whatsapp_optout_em, null);
});

/* ------------------------------------------------------------------------- *
 * 9-10. O texto livre e o teto de um menu por janela
 * ------------------------------------------------------------------------- */

test("texto livre nao reconhecido responde o menu de botoes", async () => {
  await rotear(msgTexto("oi, tudo bem?"));

  assert.equal(enviadas.length, 1);
  assert.equal(enviadas[0].tipo, "interativa");
  assert.deepEqual(
    enviadas[0].botoes.map((b) => b.id),
    ["meu_pedido", "falar_humano", "parar_avisos"],
  );
});

test("texto livre nao reconhecido DUAS vezes na mesma janela responde o menu uma vez so", async () => {
  await rotear(msgTexto("oi, tudo bem?"));
  await rotear(msgTexto("alguem ai?"));

  // A CONTAGEM SOZINHA NAO BASTA, e e a armadilha obvia deste teste: um
  // roteador que nunca responde tambem "responde uma vez so". Por isso as duas
  // linhas seguintes exigem que a UNICA volta tenha sido o menu de verdade.
  assert.equal(enviadas.length, 1, "o teto nao segurou a segunda volta");
  assert.equal(enviadas[0].tipo, "interativa");
  assert.deepEqual(
    enviadas[0].botoes.map((b) => b.id),
    ["meu_pedido", "falar_humano", "parar_avisos"],
  );
});

test("passada a janela de 24h, o menu volta", async () => {
  // O teto e TEMPORAL, e nao um "menu uma vez na vida". Sem este teste, uma
  // implementacao que respondesse so a primeira mensagem de sempre passaria no
  // teste do teto.
  await rotear(msgTexto("oi"));
  assert.equal(enviadas.length, 1);

  await bd.pool.query(
    `UPDATE canastra.clientes
        SET whatsapp_ultima_entrada_em = now() - interval '25 hours'
      WHERE user_id = $1::uuid`,
    [ANA],
  );

  await rotear(msgTexto("oi de novo"));
  assert.equal(enviadas.length, 2, "a janela nova nao reabriu o menu");
  assert.equal(enviadas[1].tipo, "interativa");
});

test("o teto NAO alcanca o botao do template nem as acoes do menu", async () => {
  // O botao e um pedido explicito de ajuda; o teto existe contra pingue-pongue
  // de texto livre, e cala-lo aqui deixaria o cliente sem resposta bem no
  // gesto que ele fez de proposito.
  await rotear(msgBotaoDeTemplate("Preciso de ajuda"));
  await rotear(msgBotao("meu_pedido"));
  await rotear(msgBotaoDeTemplate("Preciso de ajuda"));

  assert.equal(enviadas.length, 3);
  assert.deepEqual(
    enviadas.map((e) => e.tipo),
    ["interativa", "texto", "interativa"],
  );
});

/* ------------------------------------------------------------------------- *
 * 11. `button_reply.id`, e nunca `button.payload`
 * ------------------------------------------------------------------------- */

test("o roteamento usa button_reply.id: um payload de template nao casa com acao nenhuma", async () => {
  // O `payload` vem do TEXTO do botao do template aprovado e MUDA se o
  // template for traduzido. Rotear por ele e combinar com um texto que a Meta
  // pode reescrever — e, no caso de `parar_avisos`, desligar os avisos de
  // alguem que so apertou "Preciso de ajuda".
  await rotear(msgBotaoDeTemplate("parar_avisos"));

  assert.equal((await clienteDe(ANA)).whatsapp_optout_em, null, "o payload desligou os avisos");
  assert.equal(enviadas.length, 1);
  assert.equal(enviadas[0].tipo, "interativa", "o payload disparou uma acao do menu");
});

test("um payload com o TITULO traduzido tambem nao casa com acao nenhuma", async () => {
  await rotear(msgBotaoDeTemplate("Meu pedido"));

  assert.equal(enviadas.length, 1);
  assert.equal(enviadas[0].tipo, "interativa", "o payload virou consulta de pedido");
});

test("o titulo do botao interativo nao decide nada — quem decide e o id", async () => {
  // O `title` chega junto no webhook e e tao instavel quanto o payload: ele e
  // o texto que o cliente VIU. Um roteador que casasse por titulo funcionaria
  // ate a primeira troca de palavra no menu.
  await rotear(msgBotao("desconhecido_de_versao_antiga", "Parar avisos"));

  assert.equal((await clienteDe(ANA)).whatsapp_optout_em, null, "o titulo desligou os avisos");
  assert.equal(enviadas.length, 1);
  assert.equal(enviadas[0].tipo, "interativa", "id desconhecido devolve o menu, nao uma acao");
});

/* ------------------------------------------------------------------------- *
 * 12-14. A armadilha do nono digito
 * ------------------------------------------------------------------------- */

test("mensagem de quem nao e cliente nao quebra e nao responde", async () => {
  const log = capturarLog();
  try {
    await rotear(msgTexto("oi", WA_ESTRANHO));
  } finally {
    log.restaurar();
  }

  assert.equal(enviadas.length, 0);
  // E o silencio e silencio: o telefone de quem escreveu nao vira linha de log.
  assert.ok(!log.linhas.join(" ").includes(WA_ESTRANHO), log.linhas.join(" | "));
});

test("o from SEM o nono digito casa com a cliente cadastrada COM ele", async () => {
  // A doc da Meta: "For Brazil and Mexico, the extra added prefix of the phone
  // number may be modified by the Cloud API". Casar so pelo literal daria
  // "cliente desconhecido" para metade do pais.
  await rotear(msgBotao("meu_pedido", "Meu pedido", WA_ANA_SEM_NONO));

  // A prova e que ELA FOI ENCONTRADA — o pedido dela voltou —, e nao apenas
  // que nada quebrou.
  assert.equal(enviadas.length, 1, "a cliente do nono digito virou desconhecida");
  assert.equal(enviadas[0].para, WA_ANA_SEM_NONO);
  assert.ok(enviadas[0].texto.includes("AA123456789BR"), enviadas[0].texto);
});

test("ao casar por variante o wa_id e GRAVADO, e dai em diante nao se adivinha mais", async () => {
  await rotear(msgBotao("meu_pedido", "Meu pedido", WA_ANA_SEM_NONO));

  const cliente = await clienteDe(ANA);
  assert.equal(cliente.whatsapp_wa_id, WA_ANA_SEM_NONO, "a adivinhacao nao virou fato");

  // E a prova de que a adivinhacao ACABOU: sem telefone nenhum no cadastro, o
  // wa_id sozinho ainda acha a cliente. Uma implementacao que gravasse o wa_id
  // e continuasse procurando pelo telefone ficaria vermelha aqui.
  await bd.pool.query("UPDATE canastra.clientes SET telefone = NULL WHERE user_id = $1::uuid", [
    ANA,
  ]);
  enviadas.length = 0;

  await rotear(msgBotao("meu_pedido", "Meu pedido", WA_ANA_SEM_NONO));

  assert.equal(enviadas.length, 1, "o wa_id gravado nao foi usado na segunda entrada");
  assert.ok(enviadas[0].texto.includes("AA123456789BR"), enviadas[0].texto);
});

test("numero que casa com MAIS DE UM cadastro nao vincula ninguem e fica em silencio", async () => {
  // Um numero compartilhado (casal, familia) casaria com duas linhas de
  // `clientes`. Escolher uma ao acaso gravaria o wa_id na pessoa errada e
  // mandaria o pedido DELA para quem escreveu — vazamento, nao inconveniencia.
  // Falhar fechado custa uma resposta; falhar aberto custa o dado de outro.
  await bd.pool.query("UPDATE canastra.clientes SET telefone = $2 WHERE user_id = $1::uuid", [
    DANI,
    TELEFONES[ANA],
  ]);

  const log = capturarLog();
  try {
    await rotear(msgBotao("meu_pedido", "Meu pedido", WA_ANA));
  } finally {
    log.restaurar();
  }

  assert.equal(enviadas.length, 0);
  assert.equal((await clienteDe(ANA)).whatsapp_wa_id, null);
  assert.equal((await clienteDe(DANI)).whatsapp_wa_id, null);
  assert.ok(!log.linhas.join(" ").includes(WA_ANA), log.linhas.join(" | "));
});

/* ------------------------------------------------------------------------- *
 * As duas decisoes ja tomadas, e o contrato de nunca lancar
 * ------------------------------------------------------------------------- */

test("com a integracao desligada o roteador sai em silencio", async () => {
  // Uma loja com o bot desligado nao deve mandar mensagem. O webhook continua
  // deduplicando e devolvendo 200 — responder diferente de 200 faria a Meta
  // reentregar o mesmo lote por sete dias.
  await config.gravar({ ativo: false });

  await rotear(msgBotaoDeTemplate("Preciso de ajuda"));
  await rotear(msgBotao("parar_avisos"));
  await rotear(msgTexto("PARAR"));

  assert.equal(enviadas.length, 0);
  assert.equal((await clienteDe(ANA)).whatsapp_optout_em, null);
});

test("os tres titulos cabem no teto de 20 caracteres da Meta", async () => {
  // `enviarInterativa` NAO trunca titulo — ela so corta o QUARTO botao. Um
  // titulo de 21 caracteres reprova a mensagem INTEIRA, e o cliente fica sem
  // menu nenhum. O teto so aparece na resposta da Meta, em producao.
  await rotear(msgBotaoDeTemplate("Preciso de ajuda"));

  const botoes = enviadas[0].botoes;
  assert.equal(botoes.length, 3, "a Cloud API aceita no maximo tres botoes de resposta");
  for (const botao of botoes) {
    // Por CARACTERE e nao por code unit: o "é" de "alguém" e um so, mas quem
    // trocar por um emoji ou por um acento decomposto muda a conta.
    assert.ok(
      [...botao.titulo].length <= 20,
      `"${botao.titulo}" tem ${[...botao.titulo].length} caracteres`,
    );
    assert.ok(botao.titulo.trim().length > 0);
  }
});

test("rotearMensagem nunca lanca: corpo malformado, envio caido, banco fora", async () => {
  // O handler do webhook JA respondeu 200 quando esta funcao roda. Uma excecao
  // daqui vira unhandledRejection, nao vira resposta nenhuma, e derruba o
  // processo sob a configuracao padrao do Node 22.
  await controller.rotearMensagem(null, null);
  await controller.rotearMensagem(undefined, undefined);
  await controller.rotearMensagem({}, {});
  await controller.rotearMensagem({ from: WA_ANA, type: "text" }, {});
  await controller.rotearMensagem({ from: WA_ANA, type: "image", image: {} }, {});
  await controller.rotearMensagem({ from: "nao-e-telefone", type: "text", text: {} }, {});

  // O envio caindo (131047: a janela fechou entre o webhook e a resposta).
  quebrar.envio = true;
  const log = capturarLog();
  try {
    await controller.rotearMensagem(msgBotao("meu_pedido"), {});
  } finally {
    log.restaurar();
    quebrar.envio = false;
  }

  // E o banco fora do ar. A configuracao e aquecida ANTES, senao `carregar()`
  // devolve o degradado (ativo: false) e o roteador sairia em silencio sem
  // nunca chegar ao SQL que este caso existe para exercitar.
  await config.carregar();
  const queryOriginal = pgPool.query;
  pgPool.query = async () => {
    const erro = new Error("connection refused");
    erro.code = "ECONNREFUSED";
    throw erro;
  };
  const log2 = capturarLog();
  try {
    await controller.rotearMensagem(msgTexto("oi"), {});
  } finally {
    pgPool.query = queryOriginal;
    log2.restaurar();
  }
});

test("nada do que o roteador loga carrega telefone, wamid ou o corpo da mensagem", async () => {
  // O WAMID NAO E OPACO: o miolo dele em base64 decodifica para o telefone do
  // cliente em texto claro. Logar um wamid e escrever telefone em disco sem
  // ninguem ter digitado `console.log(telefone)`.
  const segredo = "meu cpf e 111.222.333-44";
  const msg = msgTexto(segredo, WA_ANA);

  quebrar.envio = true;
  const log = capturarLog();
  try {
    await rotear(msg);
    await rotear(msgBotao("meu_pedido"));
    await rotear(msgTexto("oi", WA_ESTRANHO));
  } finally {
    log.restaurar();
    quebrar.envio = false;
  }

  const tudo = log.linhas.join(" | ");
  assert.ok(!tudo.includes(msg.id), `o wamid vazou: ${tudo}`);
  assert.ok(!tudo.includes(WA_ANA), `o telefone vazou: ${tudo}`);
  assert.ok(!tudo.includes(WA_ESTRANHO), `o telefone vazou: ${tudo}`);
  assert.ok(!tudo.includes(segredo), `o corpo da mensagem vazou: ${tudo}`);
});

/* ------------------------------------------------------------------------- *
 * O webhook ponta a ponta — a prova de que o roteador esta ligado
 * ------------------------------------------------------------------------- */

test("o clique chega pelo POST do webhook e o menu sai — depois do 200", async () => {
  const msg = msgBotaoDeTemplate("Preciso de ajuda");
  const corpo = {
    object: "whatsapp_business_account",
    entry: [{ id: "0", changes: [{ field: "messages", value: valorDe(msg) }] }],
  };
  const cru = Buffer.from(JSON.stringify(corpo), "utf8");

  const res = {
    codigo: null,
    sendStatus(codigo) {
      this.codigo = codigo;
      return this;
    },
  };
  resEmVoo = res;

  const log = capturarLog();
  try {
    await controller.receber({ headers: {}, rawBody: cru, body: corpo, ip: "127.0.0.1" }, res);
  } finally {
    log.restaurar();
  }

  assert.equal(res.codigo, 200);
  assert.equal(enviadas.length, 1, "o roteador nao esta ligado ao handler do webhook");
  assert.equal(enviadas[0].tipo, "interativa");
  // O 200 SAI ANTES do roteamento: a Meta conta o tempo de resposta do webhook,
  // e uma chamada a Graph API no meio do caminho e latencia que ela ve.
  assert.equal(enviadas[0].respondeuAntes, 200);

  // E a reentrega do MESMO lote nao manda o menu de novo.
  enviadas.length = 0;
  const log2 = capturarLog();
  try {
    await controller.receber({ headers: {}, rawBody: cru, body: corpo, ip: "127.0.0.1" }, res);
  } finally {
    log2.restaurar();
  }
  assert.equal(enviadas.length, 0, "a dedupe nao segurou a reentrega");
});
