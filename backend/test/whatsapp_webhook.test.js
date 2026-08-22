"use strict";

/**
 * A PORTA DE ENTRADA DO WEBHOOK DA META — assinatura, verificação e dedupe.
 *
 * Não sobe servidor nem banco: exercita as funções puras exportadas pelo
 * WhatsappController, que é exatamente onde a decisão de segurança acontece —
 * a mesma postura de `pagamento.test.js`, que testa `validarAssinaturaWebhook`
 * sem Mercado Pago nenhum do outro lado.
 *
 * O que o banco faria (o PRIMARY KEY de `canastra.whatsapp_eventos` recusando
 * a chave repetida) entra aqui como dublê de pool: um Set. O dublê é ESTRITO de
 * propósito — SQL que não seja o INSERT de deduplicação faz o teste estourar.
 * Assim uma implementação que trocasse o `ON CONFLICT` por um `SELECT` antes do
 * `INSERT` (que tem corrida entre a leitura e a escrita) fica vermelha aqui, e
 * não em produção, com dois processos recebendo a mesma reentrega.
 *
 * POR QUE ESTES TESTES EXISTEM, em uma frase: o código de exemplo publicado
 * pela própria Meta deixa passar requisição SEM cabeçalho de assinatura (só
 * `console.warn`) e compara os hashes com `!=`. Copiá-lo seria um bypass total
 * para quem simplesmente omitisse o cabeçalho.
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const Module = require("node:module");

// ── Dublês: o pool e a configuração ─────────────────────────────────────────

const SEGREDO = "app-secret-de-teste";
const VERIFY_TOKEN = "token-que-a-meta-devolve";

/** O que o painel (ou a `.env`) teriam configurado. Trocável dentro do teste. */
const cfgFalsa = { app_secret: SEGREDO, verify_token: VERIFY_TOKEN };

/** Toda chave que chegou ao INSERT, na ordem — inclusive as que conflitaram. */
let chavesGravadas = [];
/** O dublê do PRIMARY KEY: quem já entrou não entra de novo. */
let jaNoBanco = new Set();
/** O SQL que o controller mandou — para provar QUEM decide a duplicata. */
let sqlsExecutados = [];

function zerarBanco() {
  chavesGravadas = [];
  jaNoBanco = new Set();
  sqlsExecutados = [];
}

const poolFalso = {
  query: async (sql, valores) => {
    sqlsExecutados.push(sql);
    if (!/whatsapp_eventos/.test(sql)) {
      throw new Error(`SQL inesperado no dublê de pool: ${sql}`);
    }
    const novas = [];
    for (const chave of valores[0]) {
      chavesGravadas.push(chave);
      if (jaNoBanco.has(chave)) continue; // ON CONFLICT DO NOTHING
      jaNoBanco.add(chave);
      novas.push(chave);
    }
    return { rows: novas.map((dedupe_key) => ({ dedupe_key })), rowCount: novas.length };
  },
};

// O controller importa o pool e a configuração; trocamos os dois ANTES do
// require, como `pagamento.test.js:22-33` faz com o ShippingController.
const requireOriginal = Module.prototype.require;
Module.prototype.require = function (caminho) {
  if (caminho === "../pgPool") return poolFalso;
  if (caminho === "../services/whatsappConfig") {
    // O MODULO REAL POR BAIXO, e so `carregar` trocado. Um dublê que fosse SO
    // `{ carregar }` mentiria sobre a forma do modulo: o controller também lê
    // dele as listas de campos (`INTERRUPTORES` e companhia, que as rotas do
    // painel usam para peneirar o PUT), e o `require` estoura no topo — uma
    // falha que fala de iteração e não tem nada a ver com o webhook. Espalhar
    // o real deixa o dublê acompanhar sozinho o que o módulo passar a exportar.
    // (O `pgPool` de que ele depende já cai no dublê da linha acima, e
    // `carregar` — o único caminho que tocaria o banco aqui — está trocado.)
    return { ...requireOriginal.apply(this, arguments), carregar: async () => cfgFalsa };
  }
  return requireOriginal.apply(this, arguments);
};
const {
  validarAssinatura,
  responderVerificacao,
  chavesDeDeduplicacao,
  classificarMensagem,
  eventosNovos,
  verificar,
  receber,
} = require("../src/controllers/WhatsappController.js");
Module.prototype.require = requireOriginal;

// ── Ferramentas do teste ────────────────────────────────────────────────────

/** Assina como a Meta assina: HMAC-SHA256 do corpo CRU, em hex, com prefixo. */
function assinar(corpoCru, segredo = SEGREDO) {
  return `sha256=${crypto.createHmac("sha256", segredo).update(corpoCru).digest("hex")}`;
}

/** O Response falso da casa (`f4_checkout_e_webhook.test.js:39`), com `send`. */
function respostaFalsa() {
  const res = { codigo: null, corpo: null, tipo: null, usouJson: false };
  res.status = (codigo) => {
    res.codigo = codigo;
    return res;
  };
  res.sendStatus = (codigo) => {
    res.codigo = codigo;
    return res;
  };
  res.json = (corpo) => {
    if (res.codigo === null) res.codigo = 200;
    res.corpo = corpo;
    res.usouJson = true;
    return res;
  };
  res.send = (corpo) => {
    if (res.codigo === null) res.codigo = 200;
    res.corpo = corpo;
    return res;
  };
  res.type = (tipo) => {
    res.tipo = tipo;
    return res;
  };
  return res;
}

/** Cala e registra o que o código avisou — o aviso é comportamento, aqui. */
function capturarAvisos() {
  const warnOriginal = console.warn;
  const errorOriginal = console.error;
  const linhas = [];
  console.warn = (...partes) => linhas.push(`warn: ${partes.join(" ")}`);
  console.error = (...partes) => linhas.push(`error: ${partes.join(" ")}`);
  return {
    linhas,
    restaurar() {
      console.warn = warnOriginal;
      console.error = errorOriginal;
    },
  };
}

/**
 * Um wamid de verdade tem esta cara — e o miolo em base64 DECODIFICA PARA O
 * TELEFONE DO CLIENTE. É por isso que ele não entra em log nenhum.
 */
const WAMID = "wamid.HBgNNTUzMTk5OTk5OTk5ORUCABIYFjNBMEE=";

const CORPO = Buffer.from('{"object":"whatsapp_business_account","entry":[]}', "utf8");

function corpoDeStatus(status, wamid = WAMID) {
  return {
    object: "whatsapp_business_account",
    entry: [
      {
        id: "WABA-1",
        changes: [
          {
            field: "messages",
            value: {
              messaging_product: "whatsapp",
              statuses: [{ id: wamid, status, timestamp: "1700000000", recipient_id: "5531999999999" }],
            },
          },
        ],
      },
    ],
  };
}

function corpoDeMensagem(mensagem) {
  return {
    object: "whatsapp_business_account",
    entry: [
      {
        id: "WABA-1",
        changes: [{ field: "messages", value: { messaging_product: "whatsapp", messages: [mensagem] } }],
      },
    ],
  };
}

// ── validarAssinatura ───────────────────────────────────────────────────────

test("assinatura: aceita o corpo assinado com o app secret certo", () => {
  assert.equal(validarAssinatura(CORPO, assinar(CORPO), SEGREDO, "production"), true);
});

test("assinatura: recusa segredo forjado", () => {
  const forjada = assinar(CORPO, "chute-do-atacante");
  assert.equal(validarAssinatura(CORPO, forjada, SEGREDO, "production"), false);
});

test("assinatura: recusa o corpo ALTERADO depois de assinado", () => {
  // O ataque de verdade não é trocar o hash — é reaproveitar um hash válido
  // sobre outro corpo.
  const original = Buffer.from('{"a":1}', "utf8");
  const adulterado = Buffer.from('{"a":2}', "utf8");
  assert.equal(validarAssinatura(adulterado, assinar(original), SEGREDO, "production"), false);
});

test("assinatura: recusa requisição SEM cabeçalho — o exemplo da Meta deixaria passar", () => {
  // O exemplo oficial só faz `console.warn` e segue: omitir o cabeçalho é
  // bypass total. Aqui recusa, e recusa também em desenvolvimento — a única
  // folga de dev é a de segredo AUSENTE, nunca a de assinatura ausente.
  assert.equal(validarAssinatura(CORPO, undefined, SEGREDO, "production"), false);
  assert.equal(validarAssinatura(CORPO, undefined, SEGREDO, "development"), false);
  assert.equal(validarAssinatura(CORPO, "", SEGREDO, "production"), false);
  // Cabeçalho repetido chega como array em alguns caminhos; não é string.
  assert.equal(validarAssinatura(CORPO, [assinar(CORPO)], SEGREDO, "production"), false);
});

test("assinatura: recusa cabeçalho sem o prefixo sha256=", () => {
  const hex = crypto.createHmac("sha256", SEGREDO).update(CORPO).digest("hex");
  assert.equal(validarAssinatura(CORPO, hex, SEGREDO, "production"), false);
  assert.equal(validarAssinatura(CORPO, `sha1=${hex}`, SEGREDO, "production"), false);
});

test("assinatura: sem app secret, RECUSA em produção e aceita COM AVISO em desenvolvimento", () => {
  const avisos = capturarAvisos();
  let emProducao;
  let emDesenvolvimento;
  try {
    emProducao = validarAssinatura(CORPO, assinar(CORPO), null, "production");
    emDesenvolvimento = validarAssinatura(CORPO, assinar(CORPO), null, "development");
  } finally {
    avisos.restaurar();
  }
  assert.equal(emProducao, false);
  assert.equal(emDesenvolvimento, true);
  // O aviso é a única coisa que separa "dev sem segredo" de "webhook aberto".
  assert.equal(avisos.linhas.filter((l) => l.startsWith("warn:")).length, 1);
});

test("assinatura: o HMAC é sobre o corpo CRU, não sobre o JSON.stringify do corpo já parseado", () => {
  // Como a Meta manda no fio: unicode ESCAPADO.
  const daMeta = Buffer.from('{"texto":"caf\\u00e9 \\ud83d\\ude0a"}', "utf8");
  const assinatura = assinar(daMeta);
  const reserializado = Buffer.from(JSON.stringify(JSON.parse(daMeta.toString("utf8"))), "utf8");

  // A armadilha existe: o stringify do V8 emite os caracteres decodificados.
  assert.notEqual(reserializado.toString("utf8"), daMeta.toString("utf8"));

  assert.equal(validarAssinatura(daMeta, assinatura, SEGREDO, "production"), true);
  // O sintoma de conferir a forma errada: 401 SÓ com acento e emoji.
  assert.equal(validarAssinatura(reserializado, assinatura, SEGREDO, "production"), false);
});

test("assinatura: recusa corpo ausente ou vazio — sem corpo não há o que conferir", () => {
  // `req.rawBody` é `undefined` quando o `express.json` não rodou (por exemplo,
  // Content-Type que não é JSON). Falhar fechado é obrigatório aqui.
  assert.equal(validarAssinatura(undefined, assinar(CORPO), SEGREDO, "production"), false);
  const vazio = Buffer.alloc(0);
  assert.equal(validarAssinatura(vazio, assinar(vazio), SEGREDO, "production"), false);
});

// ── responderVerificacao ────────────────────────────────────────────────────

test("verificação: o token certo devolve o desafio CRU, em string", () => {
  const r = responderVerificacao(
    { modo: "subscribe", token: VERIFY_TOKEN, desafio: "1158201444" },
    VERIFY_TOKEN,
  );
  assert.equal(r.status, 200);
  assert.equal(r.corpo, "1158201444");
  // String, e não número nem objeto: quem responde tem de poder mandar TEXTO.
  assert.equal(typeof r.corpo, "string");
});

test("verificação: token errado devolve 403", () => {
  const r = responderVerificacao(
    { modo: "subscribe", token: "chute", desafio: "1158201444" },
    VERIFY_TOKEN,
  );
  assert.deepEqual(r, { status: 403 });
});

test("verificação: hub.mode diferente de subscribe devolve 403", () => {
  const r = responderVerificacao(
    { modo: "unsubscribe", token: VERIFY_TOKEN, desafio: "1158201444" },
    VERIFY_TOKEN,
  );
  assert.deepEqual(r, { status: 403 });
});

test("verificação: sem verify_token configurado recusa, inclusive quando a Meta não manda token", () => {
  // A armadilha: `undefined === undefined` é `true`. Uma comparação ingênua
  // completaria o handshake com QUALQUER UM enquanto o campo estivesse vazio.
  assert.deepEqual(
    responderVerificacao({ modo: "subscribe", token: undefined, desafio: "1" }, undefined),
    { status: 403 },
  );
  assert.deepEqual(
    responderVerificacao({ modo: "subscribe", token: "", desafio: "1" }, ""),
    { status: 403 },
  );
});

// ── chavesDeDeduplicacao ────────────────────────────────────────────────────

test("dedupe: mensagem de entrada gera a chave do wamid", () => {
  const corpo = corpoDeMensagem({ id: WAMID, from: "5531999999999", type: "text", text: { body: "oi" } });
  assert.deepEqual(chavesDeDeduplicacao(corpo), [WAMID]);
});

test("dedupe: sent, delivered e read do MESMO wamid geram TRÊS chaves diferentes", () => {
  // Deduplicar só pelo wamid descartaria `delivered` e `read` como se fossem
  // reentrega do `sent` — e o pedido ficaria "enviado" para sempre.
  const chaves = ["sent", "delivered", "read"].flatMap((s) => chavesDeDeduplicacao(corpoDeStatus(s)));
  assert.deepEqual(chaves, [`${WAMID}:sent`, `${WAMID}:delivered`, `${WAMID}:read`]);
  assert.equal(new Set(chaves).size, 3);
});

test("dedupe: um lote com dois entry e dois changes gera TODAS as chaves", () => {
  // A Meta agrega até 1000 updates e a doc dela diz que "batching cannot be
  // guaranteed": `entry[0].changes[0]` é bug esperando acontecer.
  const corpo = {
    object: "whatsapp_business_account",
    entry: [
      {
        id: "WABA-1",
        changes: [
          { field: "messages", value: { messages: [{ id: "wamid.A", type: "text", text: { body: "oi" } }] } },
          { field: "messages", value: { statuses: [{ id: "wamid.B", status: "delivered" }] } },
        ],
      },
      {
        id: "WABA-2",
        changes: [
          {
            field: "messages",
            value: {
              statuses: [
                { id: "wamid.C", status: "sent" },
                { id: "wamid.D", status: "read" },
              ],
            },
          },
          { field: "messages", value: { messages: [{ id: "wamid.E", type: "text", text: { body: "tudo bem?" } }] } },
        ],
      },
    ],
  };
  assert.deepEqual(chavesDeDeduplicacao(corpo), [
    "wamid.A",
    "wamid.B:delivered",
    "wamid.C:sent",
    "wamid.D:read",
    "wamid.E",
  ]);
});

test("dedupe: corpo com `object` diferente de whatsapp_business_account gera lista vazia", () => {
  const corpo = corpoDeMensagem({ id: WAMID, type: "text", text: { body: "oi" } });
  corpo.object = "page";
  assert.deepEqual(chavesDeDeduplicacao(corpo), []);
});

test("dedupe: change de outro `field` é ignorado", () => {
  // O `value` abaixo tem forma de mensagem DE PROPÓSITO: sem o filtro por
  // `field`, um aviso de aprovação de template entraria como evento de
  // conversa. A assinatura de webhook cobre a origem, não a semântica.
  const corpo = {
    object: "whatsapp_business_account",
    entry: [
      {
        id: "WABA-1",
        changes: [
          {
            field: "message_template_status_update",
            value: { messages: [{ id: "wamid.NAO", type: "text", text: { body: "x" } }] },
          },
        ],
      },
    ],
  };
  assert.deepEqual(chavesDeDeduplicacao(corpo), []);
});

test("dedupe: corpo malformado não lança — a Meta reentregaria para sempre", () => {
  // Exceção aqui viraria 500, e 500 faz a Meta reentregar o mesmo lote
  // quebrado por sete dias.
  for (const corpo of [
    undefined,
    null,
    {},
    { object: "whatsapp_business_account" },
    { object: "whatsapp_business_account", entry: [null] },
    { object: "whatsapp_business_account", entry: [{ changes: [{ field: "messages" }] }] },
    { object: "whatsapp_business_account", entry: [{ changes: [{ field: "messages", value: {} }] }] },
    // `?? []` não cobre estes: `for...of` sobre objeto ou número LANÇA.
    { object: "whatsapp_business_account", entry: {} },
    { object: "whatsapp_business_account", entry: 7 },
    { object: "whatsapp_business_account", entry: [{ changes: {} }] },
    {
      object: "whatsapp_business_account",
      entry: [{ changes: [{ field: "messages", value: { messages: 1, statuses: 2 } }] }],
    },
  ]) {
    assert.deepEqual(chavesDeDeduplicacao(corpo), []);
  }
});

// ── classificarMensagem ─────────────────────────────────────────────────────

test("classificação: type text vira texto com o corpo", () => {
  const msg = { id: WAMID, from: "5531999999999", type: "text", text: { body: "quero rastrear" } };
  assert.deepEqual(classificarMensagem(msg), { tipo: "texto", corpo: "quero rastrear" });
});

test("classificação: type button é o quick-reply de TEMPLATE, e traz o payload", () => {
  // O `payload` vem do TEXTO do botão do template e MUDA se o template for
  // traduzido — por isso ele não é o mesmo que o `id` do botão interativo.
  const msg = { id: WAMID, type: "button", button: { text: "Ver meu pedido", payload: "Ver meu pedido" } };
  assert.deepEqual(classificarMensagem(msg), { tipo: "botao_template", payload: "Ver meu pedido" });
});

test("classificação: type interactive com button_reply traz o id, que é NOSSO e é estável", () => {
  const msg = {
    id: WAMID,
    type: "interactive",
    interactive: { type: "button_reply", button_reply: { id: "menu_rastreio", title: "Rastrear pedido" } },
  };
  assert.deepEqual(classificarMensagem(msg), {
    tipo: "botao",
    id: "menu_rastreio",
    titulo: "Rastrear pedido",
  });
});

test("classificação: tipo desconhecido não lança e devolve o próprio tipo", () => {
  assert.deepEqual(classificarMensagem({ id: WAMID, type: "image", image: { id: "1" } }), { tipo: "image" });
  assert.deepEqual(classificarMensagem({ id: WAMID, type: "sticker" }), { tipo: "sticker" });
  // Sem `type` nenhum, e sem mensagem nenhuma: continua sem lançar.
  assert.deepEqual(classificarMensagem({}), { tipo: "desconhecido" });
  assert.deepEqual(classificarMensagem(undefined), { tipo: "desconhecido" });
  // Um `interactive` que não é button_reply também não pode lançar.
  assert.deepEqual(
    classificarMensagem({ type: "interactive", interactive: { type: "list_reply", list_reply: { id: "x" } } }),
    { tipo: "interactive" },
  );
});

// ── eventosNovos: a deduplicação contra o banco ─────────────────────────────

test("dedupe no banco: a reentrega do mesmo lote não devolve evento nenhum na segunda vez", () => {
  zerarBanco();
  const corpo = corpoDeMensagem({ id: WAMID, from: "5531999999999", type: "text", text: { body: "oi" } });
  return eventosNovos(corpo).then(async (primeira) => {
    assert.deepEqual(primeira.map((e) => e.chave), [WAMID]);
    assert.equal(primeira[0].tipo, "mensagem");
    const segunda = await eventosNovos(corpo);
    assert.deepEqual(segunda, []);
    // Quem decidiu a duplicata foi o PRIMARY KEY, e não uma leitura antes da
    // escrita — que teria corrida entre dois processos recebendo a reentrega.
    assert.ok(/ON CONFLICT/i.test(sqlsExecutados[1]));
    assert.ok(/RETURNING/i.test(sqlsExecutados[1]));
  });
});

test("dedupe no banco: delivered e read do mesmo wamid NÃO são descartados como repetição do sent", () => {
  zerarBanco();
  return (async () => {
    const sent = await eventosNovos(corpoDeStatus("sent"));
    const delivered = await eventosNovos(corpoDeStatus("delivered"));
    const read = await eventosNovos(corpoDeStatus("read"));
    assert.deepEqual(sent.map((e) => e.chave), [`${WAMID}:sent`]);
    assert.deepEqual(delivered.map((e) => e.chave), [`${WAMID}:delivered`]);
    assert.deepEqual(read.map((e) => e.chave), [`${WAMID}:read`]);
    assert.equal(delivered[0].tipo, "status");
    assert.equal(delivered[0].status.status, "delivered");
    // E a reentrega do `sent`, essa sim, é descartada.
    assert.deepEqual(await eventosNovos(corpoDeStatus("sent")), []);
  })();
});

test("dedupe no banco: lote sem evento nenhum não vai ao banco", () => {
  zerarBanco();
  return eventosNovos({ object: "page", entry: [] }).then((novos) => {
    assert.deepEqual(novos, []);
    assert.deepEqual(sqlsExecutados, []);
  });
});

// ── Os handlers ─────────────────────────────────────────────────────────────

test("handler GET: devolve o desafio como TEXTO PURO, nunca por res.json", async () => {
  const res = respostaFalsa();
  await verificar(
    {
      query: {
        "hub.mode": "subscribe",
        "hub.verify_token": VERIFY_TOKEN,
        "hub.challenge": "1158201444",
      },
    },
    res,
  );
  assert.equal(res.codigo, 200);
  assert.equal(res.corpo, "1158201444");
  // `res.json("1158201444")` devolveria `"1158201444"` COM ASPAS no corpo, e a
  // Meta recusa o handshake. É o erro clássico desta integração.
  assert.equal(res.usouJson, false);
  assert.equal(res.tipo, "text/plain");
});

test("handler GET: token errado devolve 403 e não ecoa o desafio", async () => {
  const avisos = capturarAvisos();
  const res = respostaFalsa();
  try {
    await verificar(
      { query: { "hub.mode": "subscribe", "hub.verify_token": "chute", "hub.challenge": "1158201444" } },
      res,
    );
  } finally {
    avisos.restaurar();
  }
  assert.equal(res.codigo, 403);
  assert.equal(res.corpo, null);
});

test("handler POST: requisição sem assinatura leva 401 e NÃO grava evento nenhum", async () => {
  zerarBanco();
  const corpo = corpoDeStatus("sent");
  const avisos = capturarAvisos();
  const res = respostaFalsa();
  try {
    await receber({ headers: {}, rawBody: Buffer.from(JSON.stringify(corpo), "utf8"), body: corpo }, res);
  } finally {
    avisos.restaurar();
  }

  assert.equal(res.codigo, 401);
  // A DEDUPE VEM DEPOIS DA VALIDAÇÃO. Se viesse antes, qualquer um do lado de
  // fora envenenaria `whatsapp_eventos` com wamids forjados e o evento
  // legítimo da Meta chegaria depois e seria descartado como duplicata.
  assert.deepEqual(chavesGravadas, []);
  assert.deepEqual(sqlsExecutados, []);
  // E o log da recusa não carrega o corpo: o wamid é o telefone do cliente.
  assert.ok(!avisos.linhas.join(" ").includes(WAMID));
});

test("handler POST: requisição assinada responde 200 e registra as chaves do lote", async () => {
  zerarBanco();
  const corpo = corpoDeStatus("delivered");
  const cru = Buffer.from(JSON.stringify(corpo), "utf8");
  const res = respostaFalsa();
  await receber(
    { headers: { "x-hub-signature-256": assinar(cru) }, rawBody: cru, body: corpo },
    res,
  );

  assert.equal(res.codigo, 200);
  assert.deepEqual(chavesGravadas, [`${WAMID}:delivered`]);
});

test("handler POST: corpo assinado mas ADULTERADO no caminho leva 401", async () => {
  zerarBanco();
  const original = corpoDeStatus("sent");
  const cru = Buffer.from(JSON.stringify(original), "utf8");
  const assinatura = assinar(cru);

  const adulterado = corpoDeStatus("read", "wamid.DE_OUTRA_PESSOA");
  const cruAdulterado = Buffer.from(JSON.stringify(adulterado), "utf8");

  const avisos = capturarAvisos();
  const res = respostaFalsa();
  try {
    await receber(
      { headers: { "x-hub-signature-256": assinatura }, rawBody: cruAdulterado, body: adulterado },
      res,
    );
  } finally {
    avisos.restaurar();
  }
  assert.equal(res.codigo, 401);
  assert.deepEqual(chavesGravadas, []);
});

test("handler POST: banco fora do ar responde 500, para a Meta reentregar", async () => {
  zerarBanco();
  const corpo = corpoDeStatus("sent");
  const cru = Buffer.from(JSON.stringify(corpo), "utf8");
  const queryOriginal = poolFalso.query;
  poolFalso.query = async () => {
    const erro = new Error("connection refused");
    erro.code = "ECONNREFUSED";
    throw erro;
  };
  const avisos = capturarAvisos();
  const res = respostaFalsa();
  try {
    await receber({ headers: { "x-hub-signature-256": assinar(cru) }, rawBody: cru, body: corpo }, res);
  } finally {
    avisos.restaurar();
    poolFalso.query = queryOriginal;
  }

  // 200 aqui perderia o evento para sempre: a Meta só reentrega diante de
  // resposta diferente de 200, e a janela dela é de sete dias.
  assert.equal(res.codigo, 500);
  // E o log NÃO carrega o wamid: o miolo dele em base64 é o telefone do
  // cliente, a mesma disciplina de `whatsappClient.js`.
  assert.equal(avisos.linhas.length, 1);
  assert.ok(!avisos.linhas[0].includes(WAMID));
  assert.ok(!avisos.linhas[0].includes("5531999999999"));
});
