"use strict";

/**
 * O wrapper que substitui as seis chamadas de sendStatusEmail.
 *
 * Banco REAL: quem tem telefone, quem deu opt-out e qual e o wa_id sao
 * perguntas que so o banco responde. E-mail e WhatsApp sao DUBLES, instalados
 * pelo hook de Module.prototype.require — o desenho de f7_bling.test.js:290-330.
 */

const { test, before, after, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const Module = require("node:module");
const { subirPostgres } = require("./ajuda/postgres.js");
const { aplicarMigracoes } = require("../db/migrar.js");

let bd;
let notificacoes;
let config;
let pgPool;
const emails = [];
const zaps = [];

const ANA = "aaaaaaaa-0000-0000-0000-000000000001";
const BIA = "aaaaaaaa-0000-0000-0000-000000000002";
const CADU = "aaaaaaaa-0000-0000-0000-000000000003";

/**
 * O pedido existe no banco porque `whatsapp_mensagens.pedido_id` REFERENCIA
 * `canastra.pedidos` (0017). Sem a linha, a gravacao do rastro morre em 23503,
 * o wrapper engole (que e o contrato dele) e todo teste de silencio passaria
 * por acidente — verde pelo motivo errado, que e o unico jeito de errar aqui.
 */
const PEDIDO = "3f2504e0-4f89-11d3-9a0c-0305e82c3301";

/**
 * O duble do e-mail NAO expoe `conteudoDoStatus`, e a ausencia e deliberada:
 * pega-lo do modulo real aqui em cima carregaria `src/pgPool.js` ANTES de
 * `process.env.DATABASE_URL` existir, e o pool nasceria apontando para o banco
 * errado (a mesma armadilha que whatsapp_config.test.js:21 documenta). O
 * wrapper so precisa de `sendStatusEmail`.
 */
const quebrar = { email: false };

const dubleEmail = {
  sendStatusEmail: async (order, status, rastreio) => {
    // `sendStatusEmail` PROMETE nao lancar (emailSender.js:105-110), e "promete"
    // nao e "impede": um require que falha ou um campo que sumiu sobe como
    // qualquer outro erro. E o unico jeito de provar que os dois canais sao
    // engolidos INDEPENDENTEMENTE.
    if (quebrar.email) throw new Error("Resend caiu");
    emails.push({ order, status, rastreio });
  },
};

const dubleCliente = {
  VERSAO_GRAPH: "v26.0",
  enviarTemplate: async (cfg, dados) => {
    zaps.push(dados);
    if (dados.para === "5531000000000") {
      const e = new Error("ErroDaMeta: POST /messages 131026");
      e.name = "ErroDaMeta";
      e.codigo = 131026;
      throw e;
    }
    return { wamid: "wamid.T" + zaps.length };
  },
};

before(async () => {
  bd = await subirPostgres();
  await aplicarMigracoes(bd.pool);

  for (const [id, email, nome, telefone] of [
    [ANA, "ana@ex.com", "Ana", "31999990000"],
    [BIA, "bia@ex.com", "Bia", null],
    [CADU, "cadu@ex.com", "Cadu", "31000000000"],
  ]) {
    await bd.pool.query("INSERT INTO auth.users (id, email) VALUES ($1, $2)", [id, email]);
    await bd.pool.query(
      // `$3::text` explicito: usado nos dois ramos do CASE, o parametro fica sem
      // tipo inferivel e o Postgres recusa com 42P08 antes de executar.
      `INSERT INTO canastra.clientes (user_id, nome, telefone, whatsapp_optin_em)
       VALUES ($1::uuid, $2, $3::text, CASE WHEN $3::text IS NULL THEN NULL ELSE now() END)`,
      [id, nome, telefone],
    );
  }

  await bd.pool.query(
    `INSERT INTO canastra.pedidos (pedido_id, user_id, total, status)
     VALUES ($1::uuid, $2::uuid, 89.90, 'aprovado')`,
    [PEDIDO, ANA],
  );

  process.env.DATABASE_URL = bd.connectionString;
  process.env.NODE_ENV = "development";

  // O `caminho` casado e o LITERAL que o modulo alvo escreve.
  const requireOriginal = Module.prototype.require;
  Module.prototype.require = function (caminho) {
    if (caminho === "../utils/emailSender") return dubleEmail;
    if (caminho === "./whatsappClient") return dubleCliente;
    return requireOriginal.apply(this, arguments);
  };
  try {
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
  emails.length = 0;
  zaps.length = 0;
  quebrar.email = false;
  await bd.pool.query("DELETE FROM canastra.whatsapp_mensagens");
  await bd.pool.query("DELETE FROM canastra.whatsapp_config");
  // O `wa_id` volta a NULL junto com o opt-out: quem o grava e um teste so, e
  // sem esta linha ele sobreviveria para os seguintes — que passariam a medir o
  // caminho do wa_id achando que medem o do telefone digitado.
  //
  // `whatsapp_optin_em` volta pelo MESMO motivo, e pela mesma regra do
  // `before()`: o carimbo acompanha o telefone (quem nao tem numero nao tem o
  // que carimbar). O teste do carimbo ausente apaga o de Ana; sem esta linha
  // ele apagaria para todos os testes seguintes, e os que medem envio ficariam
  // verdes ou vermelhos pelo motivo errado.
  await bd.pool.query(
    `UPDATE canastra.clientes
        SET whatsapp_optout_em = NULL,
            whatsapp_wa_id = NULL,
            whatsapp_optin_em = CASE WHEN telefone IS NULL THEN NULL ELSE now() END`,
  );
  config.esquecer();
  await config.gravar({
    ativo: true,
    access_token: "tok",
    phone_number_id: "111",
    aviso_enviado: true,
    aviso_entregue: true,
  });
});

const pedidoDe = (userId, extras = {}) => ({
  order_id: PEDIDO,
  user_id: userId,
  total_amount: "89.90",
  status: "aprovado",
  ...extras,
});

test("os dois canais saem para quem tem telefone", async () => {
  await notificacoes.avisarCliente(pedidoDe(ANA), "enviado", "AA123BR");

  assert.equal(emails.length, 1);
  assert.equal(zaps.length, 1);
  assert.equal(zaps[0].para, "5531999990000");
  assert.equal(zaps[0].template, "pedido_enviado");
});

test("quem nao tem telefone recebe so o e-mail, sem erro", async () => {
  // O caso comum de quem tem conta antiga: silencio no zap nao e falha.
  await notificacoes.avisarCliente(pedidoDe(BIA), "enviado", "AA123BR");

  assert.equal(emails.length, 1);
  assert.equal(zaps.length, 0);
});

test("o WhatsApp falhando nao impede o e-mail nem lanca", async () => {
  // O contrato de emailSender.js:105-110 vale para os dois: pedido pago nao
  // pode virar erro porque o aviso nao saiu.
  await notificacoes.avisarCliente(pedidoDe(CADU), "enviado", "AA123BR");

  assert.equal(emails.length, 1);
  const { rows } = await bd.pool.query(
    "SELECT status, erro_codigo FROM canastra.whatsapp_mensagens",
  );
  assert.equal(rows[0].status, "falhou");
  assert.equal(rows[0].erro_codigo, 131026);
});

test("o e-mail lancando nao impede o WhatsApp nem lanca", async () => {
  // O espelho do caso acima, e o que obriga os DOIS `try` separados: com um
  // bloco so, o e-mail que estourasse pularia o WhatsApp inteiro — e o canal
  // que a loja paga para usar sumiria por causa de uma queda do Resend.
  quebrar.email = true;
  await notificacoes.avisarCliente(pedidoDe(ANA), "enviado", "AA123BR");

  assert.equal(emails.length, 0);
  assert.equal(zaps.length, 1);

  const { rows } = await bd.pool.query(
    "SELECT status FROM canastra.whatsapp_mensagens",
  );
  assert.equal(rows[0].status, "enviada");
});

test("o envio bem-sucedido deixa rastro com o wamid e so quatro digitos", async () => {
  await notificacoes.avisarCliente(pedidoDe(ANA), "enviado", "AA123BR");

  const { rows } = await bd.pool.query(
    "SELECT status, wamid, telefone_final, template FROM canastra.whatsapp_mensagens",
  );
  assert.equal(rows[0].status, "enviada");
  assert.equal(rows[0].wamid, "wamid.T1");
  assert.equal(rows[0].telefone_final, "0000");
  assert.equal(rows[0].template, "pedido_enviado");
});

test("integracao desligada e silencio no zap, e-mail normal", async () => {
  await config.gravar({ ativo: false });
  await notificacoes.avisarCliente(pedidoDe(ANA), "enviado", "AA123BR");

  assert.equal(emails.length, 1);
  assert.equal(zaps.length, 0);
});

test("aviso desligado para aquele status e silencio no zap", async () => {
  await config.gravar({ aviso_entregue: false });
  await notificacoes.avisarCliente(pedidoDe(ANA), "entregue", null);

  assert.equal(emails.length, 1);
  assert.equal(zaps.length, 0);
});

test("quem pediu para parar nao recebe mais", async () => {
  await bd.pool.query(
    "UPDATE canastra.clientes SET whatsapp_optout_em = now() WHERE user_id = $1::uuid",
    [ANA],
  );
  await notificacoes.avisarCliente(pedidoDe(ANA), "enviado", "AA123BR");

  assert.equal(emails.length, 1, "o e-mail continua: o opt-out e do WhatsApp");
  assert.equal(zaps.length, 0);
});

test("quem tem telefone mas nao tem carimbo de consentimento nao recebe", async () => {
  // O modo de falha que isto impede: `authenticated` tem UPDATE em
  // `clientes.telefone` (0018) e NAO tem em `whatsapp_optin_em`. Um numero
  // gravado por fora do fluxo de cadastro chega sem prova de consentimento —
  // e o cabecalho de 0017 promete, com todas as letras, que sem carimbo o bot
  // nao manda. Ate 0020 aquilo era so uma frase: a consulta do destinatario
  // nunca leu a coluna.
  await bd.pool.query(
    "UPDATE canastra.clientes SET whatsapp_optin_em = NULL WHERE user_id = $1::uuid",
    [ANA],
  );

  await notificacoes.avisarCliente(pedidoDe(ANA), "enviado", "AA123BR");

  assert.equal(emails.length, 1, "o e-mail continua: o carimbo e do WhatsApp");
  assert.equal(zaps.length, 0);

  // Sem linha nenhuma de rastro: o silencio acontece ANTES do INSERT, como
  // todos os outros silencios legitimos. Uma linha 'pendente' aqui seria a
  // loja registrando que tentou escrever para quem nao consentiu.
  const { rows } = await bd.pool.query(
    "SELECT count(*)::int AS n FROM canastra.whatsapp_mensagens",
  );
  assert.equal(rows[0].n, 0);
});

test("o carimbo de consentimento nao vale pelo wa_id ja conhecido", async () => {
  // O caminho lateral: o cliente ja respondeu ao bot alguma vez, entao ha
  // `whatsapp_wa_id` gravado e o destino existe SEM depender do telefone. Se a
  // guarda do carimbo ficasse presa ao ramo do telefone, este cliente
  // continuaria recebendo — e e justamente quem a loja tem como alcancar.
  await bd.pool.query(
    `UPDATE canastra.clientes
        SET whatsapp_optin_em = NULL, whatsapp_wa_id = '553199990000'
      WHERE user_id = $1::uuid`,
    [ANA],
  );

  await notificacoes.avisarCliente(pedidoDe(ANA), "enviado", "AA123BR");

  assert.equal(emails.length, 1);
  assert.equal(zaps.length, 0);
});

test("status intermediario do gateway nao aciona canal nenhum", async () => {
  await notificacoes.avisarCliente(pedidoDe(ANA), "em_processamento", null);

  assert.equal(emails.length, 1, "o e-mail e chamado e decide sozinho ficar quieto");
  assert.equal(zaps.length, 0);
});

test("o mesmo status duas vezes so avisa uma vez no WhatsApp", async () => {
  // A guarda que C1 (OrderController.js:243) nao tem: dois cliques no painel
  // hoje mandam dois avisos. WhatsApp duplicado custa dinheiro e derruba a
  // nota de qualidade do template.
  //
  // O E-MAIL CONTINUA SAINDO DUAS VEZES, E ISSO E A DECISAO, nao um descuido.
  // A unica prova de "ja avisei" que existe e a linha em `whatsapp_mensagens`,
  // e ela so nasce quando o WhatsApp de fato tentou: cliente sem telefone,
  // opt-out ou integracao DESLIGADA (o estado de toda instalacao ate alguem
  // ligar no painel) nunca geram linha nenhuma. Estender essa guarda ao e-mail
  // entregaria uma deduplicacao que funciona para uns clientes e nao para
  // outros, e que evapora justamente quando o WhatsApp esta fora — pior que
  // nao ter. O e-mail e chamado SEMPRE, sem condicao; ele tem os proprios
  // recortes e nao e papel do wrapper decidir por ele.
  const pedido = pedidoDe(ANA, { status: "enviado" });
  await notificacoes.avisarCliente(pedido, "enviado", "AA123BR");
  await notificacoes.avisarCliente(pedido, "enviado", "AA123BR");

  assert.equal(zaps.length, 1);
  assert.equal(emails.length, 2);

  const { rows } = await bd.pool.query(
    "SELECT count(*)::int AS n FROM canastra.whatsapp_mensagens",
  );
  assert.equal(rows[0].n, 1, "a segunda passagem nao deixa nem linha de rastro");
});

test("perder a corrida da guarda de repetido nao vira erro: 23505 e 'ja avisado'", async () => {
  // A GUARDA DE `jaAvisado()` LE E DEPOIS ESCREVE, e entre as duas coisas ha
  // uma janela. 0021 poe a mesma regra no banco (indice unico parcial em
  // pedido+template); este teste RE-CRIA a corrida, gravando a linha
  // concorrente depois do SELECT e antes do INSERT — que e o unico jeito de
  // exercitar o ramo de verdade num teste de um processo so.
  //
  // O DESFECHO CERTO E SILENCIO, e nao erro: perder a corrida significa que a
  // outra ponta ja gravou o rastro, que e exatamente o que a guarda queria. Uma
  // linha de "Erro ao avisar o cliente por WhatsApp" aqui mandaria alguem
  // procurar defeito num sistema que se comportou como projetado.
  const queryOriginal = pgPool.query.bind(pgPool);
  let jaCorreu = false;
  pgPool.query = async function (texto, params) {
    if (
      !jaCorreu &&
      typeof texto === "string" &&
      texto.includes("INSERT INTO canastra.whatsapp_mensagens")
    ) {
      jaCorreu = true;
      await queryOriginal(
        `INSERT INTO canastra.whatsapp_mensagens (pedido_id, template, status)
         VALUES ($1::uuid, 'pedido_enviado', 'pendente')`,
        [PEDIDO],
      );
    }
    return queryOriginal(texto, params);
  };

  const linhas = [];
  const originais = { error: console.error, warn: console.warn, log: console.log };
  for (const nivel of Object.keys(originais)) {
    console[nivel] = (...args) => linhas.push(args.map(String).join(" "));
  }

  try {
    await notificacoes.avisarCliente(pedidoDe(ANA, { status: "enviado" }), "enviado", "AA123BR");
  } finally {
    delete pgPool.query;
    Object.assign(console, originais);
  }

  assert.equal(zaps.length, 0, "quem perdeu a corrida nao manda a segunda mensagem");

  const { rows } = await bd.pool.query(
    "SELECT count(*)::int AS n FROM canastra.whatsapp_mensagens",
  );
  assert.equal(rows[0].n, 1, "a linha do concorrente, e nada mais");

  const log = linhas.join("\n");
  assert.equal(
    /Erro ao avisar o cliente por WhatsApp/.test(log),
    false,
    `a corrida perdida virou erro no log: ${log}`,
  );
});

test("o envio que falhou pode ser tentado de novo", async () => {
  // A guarda de repetido ignora `falhou` de proposito: uma queda da Meta nao
  // pode trancar o aviso para sempre. Sem essa exclusao, o primeiro 131026
  // silenciaria aquele pedido em definitivo.
  await notificacoes.avisarCliente(pedidoDe(CADU), "enviado", "AA123BR");
  await notificacoes.avisarCliente(pedidoDe(CADU), "enviado", "AA123BR");

  assert.equal(zaps.length, 2);
});

test("o wa_id gravado vence o telefone digitado", async () => {
  // Depois da primeira resposta do cliente, a chave canonica e o wa_id — a
  // Meta pode ter mexido no nono digito.
  await bd.pool.query(
    "UPDATE canastra.clientes SET whatsapp_wa_id = '553199990000' WHERE user_id = $1::uuid",
    [ANA],
  );
  await notificacoes.avisarCliente(pedidoDe(ANA), "enviado", "AA123BR");

  assert.equal(zaps[0].para, "553199990000");
});

test("pedido sem dono nao aciona canal nenhum", async () => {
  await notificacoes.avisarCliente(pedidoDe(null), "enviado", "AA123BR");
  assert.equal(zaps.length, 0);
});

test("pedido malformado nao lanca", async () => {
  // `avisarCliente` NUNCA lanca — e o contrato inteiro deste modulo. Os seis
  // call sites o chamam no meio de um pedido pago; uma excecao daqui viraria
  // 500 numa rota que ja cobrou o cliente. `order` nulo e o pior caso que a
  // assinatura permite, e ele passa por dois `?.` que sao faceis de perder num
  // refactor.
  await notificacoes.avisarCliente(null, "enviado", "AA123BR");
  await notificacoes.avisarCliente({}, "enviado", null);
  await notificacoes.avisarCliente(pedidoDe(ANA), null, null);

  assert.equal(zaps.length, 0);
});
