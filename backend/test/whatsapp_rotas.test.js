"use strict";

/**
 * AS ROTAS DO PAINEL — a API que a tela do gestor consome para OPERAR o bot.
 *
 * Os handlers sao chamados DIRETAMENTE com `req`/`res` falsos (o
 * `respostaFalsa()` da convencao, `f4_checkout_e_webhook.test.js:39-55`): subir
 * servidor so acrescentaria porta, socket e flakiness a um teste cuja pergunta
 * e o que o handler decide.
 *
 * BANCO REAL, e nao duble de pool. As tres afirmacoes que mais importam aqui
 * — a mascara no GET, o campo em branco que NAO apaga o segredo gravado e a
 * chave estranha ignorada sem derrubar as legitimas — sao sobre o que ficou
 * NA COLUNA depois do PUT. Um duble de pool provaria que o SQL foi montado;
 * so o Postgres prova que o token continua la.
 *
 * A GRAPH API ENTRA PELO CLIENTE DE VERDADE, com `fetchImpl` falso. O hook de
 * `Module.prototype.require` instala um duble que DELEGA para
 * `services/whatsappClient` injetando o fetch de mentira — entao o que os
 * testes inspecionam e a REQUISICAO QUE A META RECEBERIA (URL, metodo, corpo),
 * e a frase de erro que chega ao painel e a frase redigida de verdade, montada
 * pelo cliente real. Um duble que so registrasse chamadas deixaria passar tanto
 * um corpo de template errado quanto um token vazando na mensagem de erro.
 *
 * AS COISAS QUE ESTE ARQUIVO EXISTE PARA PROVAR:
 *
 *   1. o segredo NAO volta pelo GET — a busca e pela string do token no JSON
 *      INTEIRO da resposta, nao no campo onde se espera que ele nao esteja;
 *   2. campo em branco no PUT nao apaga o que esta gravado (o mesmo cuidado de
 *      `ordersRepository.js:125-128` com `codigo_rastreio`): o gestor abre a
 *      tela, muda um interruptor e salva — se isso apagasse o token, a
 *      integracao morreria por um clique;
 *   3. chave estranha e ignorada E as chaves legitimas do MESMO corpo
 *      continuam sendo gravadas (uma implementacao que recusasse o objeto
 *      inteiro passaria num teste mais preguicoso);
 *   4. integracao desligada e 503 com codigo e frase — nunca 404 nem 500. A
 *      tela usa exatamente essa distincao para desabilitar botao em vez de
 *      deixar o erro acontecer (`bling.routes.js:37-47`);
 *   5. o historico mostra `telefone_final` e mais nada — nem telefone
 *      completo, nem `wamid`, cujo miolo em base64 E o telefone do cliente;
 *   6. TODA rota deste roteador passa por `isAuthenticated` ANTES de `isAdmin`
 *      — `isAdmin` le `req.user.ehAdmin`, que so existe depois do primeiro.
 */

const { test, before, after, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const Module = require("node:module");
const { subirPostgres } = require("./ajuda/postgres.js");
const { aplicarMigracoes } = require("../db/migrar.js");

let bd;
let controller;
let rotas;
let config;
let autenticar;
let isAdmin;
let TEMPLATES;

const ANA = "aaaaaaaa-0000-0000-0000-000000000001";
const PEDIDO = "3f2504e0-4f89-11d3-9a0c-0305e82c3301";

/**
 * As credenciais de mentira. Cada segredo tem uma cauda propria e reconhecivel
 * porque a asseveracao e "esta string nao aparece em lugar nenhum da resposta"
 * — valores parecidos entre si dariam falso negativo.
 */
const TOKEN = "EAAGtokenQueNuncaPodeSair4821";
const APP_SECRET = "appSecretQueNuncaPodeSair9911";
const VERIFY = "verifyTokenQueNuncaPodeSair7777";
const PHONE_ID = "1029384756";
const WABA = "5647382910";

/** O telefone da Ana, completo — a string que NENHUMA resposta pode conter. */
const TELEFONE = "5531999990000";
/**
 * Um wamid no formato real: `wamid.` + base64. O miolo abaixo e literalmente
 * `55319999900001` em base64 — e por isso que o historico nao devolve wamid.
 */
const WAMID = `wamid.HBgN${Buffer.from(`${TELEFONE}1`).toString("base64")}`;

// ── O duble da Graph API: cliente REAL, fetch de mentira ────────────────────

/** Toda requisicao que teria saido para a Meta, na ordem. */
let chamadas = [];
/**
 * Falha CRUA (nao-`ErroDaMeta`) na sonda do numero, ligada dentro de um teste.
 * O cliente real e airtight — tudo que sai dele ja vem redigido —, entao o
 * unico jeito de exercitar o caminho "erro que nao e da Meta" e injeta-lo.
 */
const quebrar = { perfil: null };
/**
 * O que a Meta responde: um `{status, corpo}` fixo ou uma funcao do indice da
 * chamada — e a funcao que permite fazer SO a terceira falhar.
 */
let respostaDaMeta = null;

function metaResponde(status, corpo) {
  respostaDaMeta = { status, corpo };
}

function metaRespondeCom(fn) {
  respostaDaMeta = fn;
}

async function fetchFalso(url, opcoes = {}) {
  const indice = chamadas.length;
  chamadas.push({
    url: String(url),
    metodo: opcoes.method,
    autorizacao: opcoes.headers?.Authorization ?? null,
    corpo: opcoes.body ? JSON.parse(opcoes.body) : null,
  });
  const bruto = respostaDaMeta ?? { status: 200, corpo: {} };
  const { status, corpo } = typeof bruto === "function" ? bruto(indice) : bruto;
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(corpo),
  };
}

// ── Ferramentas do teste ────────────────────────────────────────────────────

/** O `res` da convencao: guarda codigo e corpo em vez de escrever no socket. */
function respostaFalsa() {
  const res = { codigo: null, corpo: null };
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
    return res;
  };
  return res;
}

/** `req` minimo: o que os handlers do painel leem, e nada mais. */
function requisicaoFalsa({ body, query } = {}) {
  return { body: body ?? {}, query: query ?? {}, user: { userId: ANA, ehAdmin: true } };
}

/** O JSON inteiro da resposta, para procurar segredo onde ele nao devia estar. */
function textoDa(res) {
  return JSON.stringify(res.corpo ?? null);
}

/** A configuracao completa e ligada, como o gestor a deixaria no painel. */
async function configurarTudo(extras = {}) {
  await config.gravar({
    ativo: true,
    access_token: TOKEN,
    app_secret: APP_SECRET,
    verify_token: VERIFY,
    phone_number_id: PHONE_ID,
    waba_id: WABA,
    ...extras,
  });
}

before(async () => {
  bd = await subirPostgres();
  await aplicarMigracoes(bd.pool);

  await bd.pool.query("INSERT INTO auth.users (id, email) VALUES ($1, 'ana@ex.com')", [ANA]);
  await bd.pool.query(
    "INSERT INTO canastra.clientes (user_id, nome, telefone) VALUES ($1::uuid, 'Ana', $2)",
    [ANA, TELEFONE],
  );
  await bd.pool.query(
    `INSERT INTO canastra.pedidos (pedido_id, user_id, total, status)
     VALUES ($1::uuid, $2::uuid, 120.00, 'enviado')`,
    [PEDIDO, ANA],
  );

  // DATABASE_URL ANTES de qualquer require de src/: `pgPool.js` le a variavel
  // ao ser carregado, e um require adiantado apontaria para o banco errado.
  process.env.DATABASE_URL = bd.connectionString;
  process.env.NODE_ENV = "development";

  // As SEMENTES DA `.env` saem de cena: `whatsappConfig` le banco -> env, entao
  // um META_ACCESS_TOKEN na maquina de quem roda a suite preencheria a
  // configuracao sozinho e o teste de "desligado" nunca exercitaria o 503.
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

  // O cliente REAL, carregado antes do hook (o literal e outro, nao ha
  // recursao) — o duble so lhe injeta o `fetchImpl`.
  const clienteReal = require("../src/services/whatsappClient.js");
  const dubleCliente = {
    ...clienteReal,
    criarTemplate: (cfg, dados, opcoes = {}) =>
      clienteReal.criarTemplate(cfg, dados, { ...opcoes, fetchImpl: fetchFalso }),
    enviarTemplate: (cfg, dados, opcoes = {}) =>
      clienteReal.enviarTemplate(cfg, dados, { ...opcoes, fetchImpl: fetchFalso }),
    listarTemplates: (cfg, opcoes = {}) =>
      clienteReal.listarTemplates(cfg, { ...opcoes, fetchImpl: fetchFalso }),
    perfilDoNumero: (cfg, opcoes = {}) => {
      if (quebrar.perfil) throw quebrar.perfil;
      return clienteReal.perfilDoNumero(cfg, { ...opcoes, fetchImpl: fetchFalso });
    },
  };

  // O `caminho` casado e o LITERAL que o controller escreve.
  const requireOriginal = Module.prototype.require;
  Module.prototype.require = function (caminho) {
    if (caminho === "../services/whatsappClient") return dubleCliente;
    return requireOriginal.apply(this, arguments);
  };
  try {
    controller = require("../src/controllers/WhatsappController.js");
    // O roteador pega o controller do cache (mesmo arquivo resolvido), entao
    // ele enxerga o mesmo duble.
    rotas = require("../src/routes/whatsapp.routes.js");
  } finally {
    Module.prototype.require = requireOriginal;
  }

  config = require("../src/services/whatsappConfig.js");
  autenticar = require("../src/middleware/isAuthenticated.js");
  isAdmin = require("../src/middleware/isAdmin.js");
  ({ TEMPLATES } = require("../src/utils/whatsappMensagens.js"));
}, { timeout: 120_000 });

after(async () => {
  await require("../src/pgPool.js").end().catch(() => {});
  await bd?.derrubar();
});

beforeEach(async () => {
  if (!bd) {
    throw new Error("O Postgres nao subiu no before(); a causa real esta no erro daquele hook.");
  }
  await bd.pool.query("DELETE FROM canastra.whatsapp_config");
  await bd.pool.query("DELETE FROM canastra.whatsapp_mensagens");
  config.esquecer();
  chamadas = [];
  respostaDaMeta = null;
  quebrar.perfil = null;
});

/* ------------------------------------------------------------------------- *
 * 1. O segredo nao volta pelo GET
 * ------------------------------------------------------------------------- */

test("GET /config devolve mascara e o token nao aparece em lugar nenhum da resposta", async () => {
  await configurarTudo();

  const res = respostaFalsa();
  await controller.lerConfig(requisicaoFalsa(), res);

  assert.equal(res.codigo, 200);
  assert.equal(res.corpo.access_token_mascara, "••••4821");
  assert.equal(res.corpo.app_secret_mascara, "••••9911");
  assert.equal(res.corpo.verify_token_mascara, "••••7777");

  // A BUSCA E NO JSON INTEIRO, e nao em `corpo.access_token`: o modo de falha
  // real nao e devolver o token no campo obvio — e ele viajar de carona num
  // campo novo, num eco do corpo recebido ou numa mensagem de erro.
  const inteiro = textoDa(res);
  for (const segredo of [TOKEN, APP_SECRET, VERIFY]) {
    assert.equal(inteiro.includes(segredo), false, `o segredo vazou: ${inteiro}`);
  }

  // Os identificadores de conta VAO INTEIROS de proposito: aparecem no painel
  // da Meta para qualquer um com acesso la e nao autorizam nada sozinhos —
  // mascara-los so atrapalharia quem confere se o numero certo esta ligado.
  assert.equal(res.corpo.phone_number_id, PHONE_ID);
  assert.equal(res.corpo.waba_id, WABA);
});

/* ------------------------------------------------------------------------- *
 * 2. A lista permitida
 * ------------------------------------------------------------------------- */

test("PUT /config ignora chave estranha E grava as legitimas do mesmo corpo", async () => {
  const res = respostaFalsa();
  await controller.gravarConfig(
    requisicaoFalsa({
      body: {
        // As legitimas, que PRECISAM sobreviver ao corpo com lixo dentro:
        // uma implementacao que recusasse o objeto inteiro passaria num teste
        // que so conferisse "a chave estranha nao foi gravada".
        phone_number_id: PHONE_ID,
        aviso_entregue: false,
        // O `id` repontaria a linha; o resto e chave que nao existe. Nenhuma
        // pode virar coluna, e nenhuma pode derrubar as de cima.
        id: 99,
        atualizado_em: "1999-01-01",
        "access_token = 'roubado', ativo": true,
        // Vem pelo PROTOTIPO, nao como chave propria: uma leitura por
        // `corpo[campo] !== undefined` a acharia e LIGARIA a integracao que
        // ninguem pediu para ligar. `Object.hasOwn` nao a enxerga.
        __proto__: { ativo: true },
      },
    }),
    res,
  );

  assert.equal(res.codigo, 200);

  const { rows } = await bd.pool.query(
    `SELECT id, ativo, phone_number_id, aviso_entregue, aviso_enviado, access_token
       FROM canastra.whatsapp_config`,
  );
  assert.equal(rows.length, 1);
  assert.equal(rows[0].id, 1, "a linha continua sendo a 1: o corpo nao escolhe id");
  assert.equal(rows[0].ativo, false, "o `ativo` do prototipo ligou a integracao");
  assert.equal(rows[0].phone_number_id, PHONE_ID, "a chave legitima foi gravada");
  assert.equal(rows[0].aviso_entregue, false, "o interruptor legitimo foi gravado");
  assert.equal(rows[0].aviso_enviado, true, "o que nao veio no corpo nao foi tocado");
  assert.equal(rows[0].access_token, null, "nenhuma chave estranha virou coluna");
});

test("PUT /config com corpo sem nenhum campo conhecido responde 400 com frase, e nao 200 mudo", async () => {
  // "Salvou!" sem ter salvado nada e o pior desfecho possivel desta tela.
  const res = respostaFalsa();
  await controller.gravarConfig(requisicaoFalsa({ body: { bobagem: 1 } }), res);

  assert.equal(res.codigo, 400);
  assert.ok(res.corpo.error, "a tela precisa de codigo para decidir o que mostrar");
  assert.match(res.corpo.message, /\S/);
});

test("PUT /config recusa corpo malformado sem virar 500", async () => {
  for (const body of [null, undefined, "texto solto", [1, 2, 3], 42]) {
    const res = respostaFalsa();
    await controller.gravarConfig(requisicaoFalsa({ body }), res);
    assert.equal(res.codigo, 400, `corpo ${JSON.stringify(body ?? null)} devia dar 400`);
    assert.match(res.corpo.message, /\S/);
  }
});

test("PUT /config recusa interruptor que nao seja booleano", async () => {
  // `"false"` (string) e truthy: aceito por coercao, ele LIGARIA o aviso que o
  // gestor acabou de desligar, e a tela mostraria "salvo".
  const res = respostaFalsa();
  await controller.gravarConfig(
    requisicaoFalsa({ body: { aviso_pendente: "false" } }),
    res,
  );

  assert.equal(res.codigo, 400);
  assert.match(res.corpo.message, /aviso_pendente/);

  const { rows } = await bd.pool.query("SELECT count(*)::int AS n FROM canastra.whatsapp_config");
  assert.equal(rows[0].n, 0, "corpo recusado nao pode ter escrito nada");
});

/* ------------------------------------------------------------------------- *
 * 3. Campo em branco nao apaga
 * ------------------------------------------------------------------------- */

test("PUT /config com o campo de token em branco NAO apaga o token gravado", async () => {
  await configurarTudo();

  // O caso comum: o gestor abre a tela (onde o campo de segredo vem VAZIO,
  // porque o GET so devolve mascara), mexe em outra coisa e salva.
  const res = respostaFalsa();
  await controller.gravarConfig(
    requisicaoFalsa({
      body: {
        access_token: "",
        app_secret: "   ",
        verify_token: "",
        numero_suporte: "31 3333-4444",
        aviso_reembolsado: false,
      },
    }),
    res,
  );

  assert.equal(res.codigo, 200);

  const { rows } = await bd.pool.query(
    `SELECT access_token, app_secret, verify_token, numero_suporte, aviso_reembolsado
       FROM canastra.whatsapp_config`,
  );
  // O QUE ESTE TESTE EXISTE PARA PEGAR: um teste que so conferisse
  // "numero_suporte foi salvo" ficaria verde com o token apagado ao lado.
  assert.equal(rows[0].access_token, TOKEN, "o token em branco apagou o token gravado");
  assert.equal(rows[0].app_secret, APP_SECRET, "so espacos tambem nao apagam");
  assert.equal(rows[0].verify_token, VERIFY);
  assert.equal(rows[0].numero_suporte, "31 3333-4444", "o campo que veio preenchido foi salvo");
  assert.equal(rows[0].aviso_reembolsado, false);

  // E a integracao continua de pe depois do salvamento inocente.
  config.esquecer();
  assert.equal(config.configurado(await config.carregar()), true);
});

test("PUT /config com null explicito APAGA — em branco e outra coisa de nulo", async () => {
  await configurarTudo();

  const res = respostaFalsa();
  await controller.gravarConfig(requisicaoFalsa({ body: { access_token: null } }), res);

  assert.equal(res.codigo, 200);
  const { rows } = await bd.pool.query("SELECT access_token FROM canastra.whatsapp_config");
  assert.equal(rows[0].access_token, null);
});

/* ------------------------------------------------------------------------- *
 * 4. O status diz o que falta
 * ------------------------------------------------------------------------- */

test("GET /status devolve ligado:false e a lista do que falta preencher", async () => {
  const res = respostaFalsa();
  await controller.status(requisicaoFalsa(), res);

  assert.equal(res.codigo, 200, "desligado e estado conhecido, nao erro");
  assert.equal(res.corpo.ligado, false);
  assert.equal(res.corpo.ativo, false);
  assert.deepEqual(res.corpo.faltando, [
    "access_token",
    "app_secret",
    "verify_token",
    "phone_number_id",
    "waba_id",
  ]);
  // Sem credencial nao ha a quem perguntar: a sonda nao vai a rede.
  assert.equal(chamadas.length, 0);
});

test("GET /status com meia configuracao lista SO o que falta", async () => {
  await config.gravar({ ativo: true, access_token: TOKEN, phone_number_id: PHONE_ID });

  const res = respostaFalsa();
  await controller.status(requisicaoFalsa(), res);

  assert.equal(res.corpo.ligado, true, "o minimo para falar com a Meta ja esta la");
  assert.deepEqual(res.corpo.faltando, ["app_secret", "verify_token", "waba_id"]);
  assert.equal(textoDa(res).includes(TOKEN), false);
});

test("GET /status com tudo configurado traz a saude do numero", async () => {
  await configurarTudo();
  metaResponde(200, {
    display_phone_number: "+55 31 3333-4444",
    verified_name: "Café Canastra",
    quality_rating: "GREEN",
    code_verification_status: "VERIFIED",
  });

  const res = respostaFalsa();
  await controller.status(requisicaoFalsa(), res);

  assert.equal(res.codigo, 200);
  assert.equal(res.corpo.ligado, true);
  assert.deepEqual(res.corpo.faltando, []);
  assert.equal(res.corpo.numero.quality_rating, "GREEN");
  assert.equal(res.corpo.erro, null);
  assert.equal(chamadas.length, 1);
  assert.match(chamadas[0].url, /\/1029384756\?/);
  assert.equal(textoDa(res).includes(TOKEN), false);
});

test("GET /status com a Meta recusando o token continua 200 e diz o motivo", async () => {
  // E JUSTAMENTE AQUI que o gestor precisa desta tela: um 500 esconderia o
  // unico lugar que diz "seu token venceu".
  await configurarTudo();
  metaResponde(401, {
    error: { message: `Invalid OAuth access token: ${TOKEN}`, code: 190 },
  });

  const res = respostaFalsa();
  await controller.status(requisicaoFalsa(), res);

  assert.equal(res.codigo, 200);
  assert.equal(res.corpo.numero, null);
  assert.match(res.corpo.erro, /\S/, "a frase do servidor precisa chegar a tela");
  assert.equal(res.corpo.codigo, 190);
  assert.equal(textoDa(res).includes(TOKEN), false, "o token voltou dentro da frase de erro da Meta");
});

/* ------------------------------------------------------------------------- *
 * 5. Desligado e 503, com codigo e frase
 * ------------------------------------------------------------------------- */

test("POST /teste com a integracao desligada devolve 503 com codigo e frase", async () => {
  const res = respostaFalsa();
  await controller.enviarTeste(requisicaoFalsa({ body: { para: TELEFONE } }), res);

  // 503 E NAO 500: e por essa distincao que a tela decide entre "desabilite o
  // botao e mostre o que falta" e "abra chamado". E nao e 404: a rota existe.
  assert.equal(res.codigo, 503);
  assert.notEqual(res.codigo, 500);
  assert.notEqual(res.codigo, 404);
  assert.ok(res.corpo.error, "a tela precisa do codigo, nao so da frase");
  assert.match(res.corpo.message, /\S/);
  assert.equal(res.corpo.ligado, false);
  assert.ok(Array.isArray(res.corpo.faltando));
  assert.equal(chamadas.length, 0, "desligado nao gasta chamada na Meta");
});

test("POST /templates com a integracao desligada devolve 503, e nao 502", async () => {
  const res = respostaFalsa();
  await controller.criarTemplates(requisicaoFalsa(), res);

  assert.equal(res.codigo, 503);
  assert.match(res.corpo.message, /\S/);
  assert.equal(chamadas.length, 0);
});

test("POST /templates ligado mas SEM waba_id ainda e 503, dizendo qual campo falta", async () => {
  // Template vai para a WABA, nao para o numero: `configurado()` passa e a
  // acao mesmo assim nao tem para onde ir.
  await config.gravar({ ativo: true, access_token: TOKEN, phone_number_id: PHONE_ID });

  const res = respostaFalsa();
  await controller.criarTemplates(requisicaoFalsa(), res);

  assert.equal(res.codigo, 503);
  assert.ok(res.corpo.faltando.includes("waba_id"));
  assert.match(res.corpo.message, /waba_id/);
});

test("POST /teste ligado envia de verdade e nao devolve telefone completo nem wamid", async () => {
  // O contraponto do 503: sem este teste, uma implementacao que respondesse
  // 503 SEMPRE passaria nos de cima.
  await configurarTudo();
  metaResponde(200, { messages: [{ id: WAMID }] });

  const res = respostaFalsa();
  await controller.enviarTeste(
    requisicaoFalsa({ body: { para: "(31) 99999-0000", template: "pedido_recebido" } }),
    res,
  );

  assert.equal(res.codigo, 200);
  assert.equal(res.corpo.enviado, true);
  assert.equal(res.corpo.template, "pedido_recebido");
  assert.equal(res.corpo.telefone_final, "0000");

  // A requisicao que a Meta receberia — e nao "o duble foi chamado".
  assert.equal(chamadas.length, 1);
  assert.equal(chamadas[0].metodo, "POST");
  assert.match(chamadas[0].url, /\/1029384756\/messages$/);
  assert.equal(chamadas[0].corpo.to, TELEFONE, "o numero digitado com mascara vira E.164");
  assert.equal(chamadas[0].corpo.template.name, "pedido_recebido");
  assert.equal(chamadas[0].corpo.template.language.code, "pt_BR");
  // `parameter_name` porque os templates desta loja sao `parameter_format:
  // "named"`: posicional num template nomeado e 132000 na cara.
  const parametros = chamadas[0].corpo.template.components[0].parameters;
  assert.ok(parametros.every((p) => typeof p.parameter_name === "string" && p.parameter_name));

  const inteiro = textoDa(res);
  assert.equal(inteiro.includes(TELEFONE), false, "telefone completo voltou na resposta");
  assert.equal(inteiro.includes(WAMID), false, "o wamid decodifica para o telefone do cliente");
  assert.equal(inteiro.includes(TOKEN), false);
});

test("POST /teste recusa telefone invalido com 400, antes de gastar chamada", async () => {
  await configurarTudo();

  for (const para of ["", "123", "abc", undefined]) {
    const res = respostaFalsa();
    await controller.enviarTeste(requisicaoFalsa({ body: { para } }), res);
    assert.equal(res.codigo, 400, `"${para}" devia dar 400`);
    assert.match(res.corpo.message, /\S/);
  }
  assert.equal(chamadas.length, 0);
});

test("POST /teste recusa template que nao existe no mapa desta loja", async () => {
  await configurarTudo();

  const res = respostaFalsa();
  await controller.enviarTeste(
    requisicaoFalsa({ body: { para: TELEFONE, template: "constructor" } }),
    res,
  );

  // `constructor` acharia o prototipo do objeto se a busca fosse `TEMPLATES[x]`
  // sem `hasOwn` — e a Meta receberia um template chamado "constructor".
  assert.equal(res.codigo, 400);
  assert.equal(chamadas.length, 0);
});

/* ------------------------------------------------------------------------- *
 * 6. Os templates
 * ------------------------------------------------------------------------- */

test("POST /templates posta TODOS os templates do mapa e devolve o resultado de cada um", async () => {
  await configurarTudo();
  metaResponde(200, { id: "1111", status: "PENDING", category: "UTILITY" });

  const res = respostaFalsa();
  await controller.criarTemplates(requisicaoFalsa(), res);

  const nomes = Object.keys(TEMPLATES);
  assert.equal(res.codigo, 200);
  assert.equal(res.corpo.resultados.length, nomes.length);
  assert.deepEqual(res.corpo.resultados.map((r) => r.nome), nomes);
  assert.ok(res.corpo.resultados.every((r) => r.criado === true));
  assert.equal(res.corpo.criados, nomes.length);
  assert.equal(res.corpo.falharam, 0);

  // Uma requisicao por template, todas para a WABA (nao para o numero).
  assert.equal(chamadas.length, nomes.length);
  for (const chamada of chamadas) {
    assert.equal(chamada.metodo, "POST");
    assert.match(chamada.url, /\/5647382910\/message_templates$/);
    assert.equal(chamada.corpo.language, "pt_BR");
    assert.equal(chamada.corpo.category, "UTILITY");
    assert.equal(chamada.corpo.parameter_format, "named");
  }

  // O EXEMPLO E OBRIGATORIO: a Meta recusa criar template cujo corpo tem
  // variavel sem `body_text_named_params`, e a reprovacao so aparece na
  // revisao, ate 24h depois.
  const primeiro = chamadas[0].corpo.components.find((c) => c.type === "BODY");
  assert.ok(primeiro.example.body_text_named_params.length > 0);
  assert.ok(primeiro.example.body_text_named_params.every((p) => p.param_name && p.example));
});

test("POST /templates: um template que falha nao derruba os outros", async () => {
  // O modo de falha que este teste fecha: um `Promise.all` (ou um `throw` no
  // meio do laco) faria o primeiro erro cancelar a criacao dos que faltam, e o
  // gestor ficaria com metade dos templates sem saber quais.
  await configurarTudo();
  const nomes = Object.keys(TEMPLATES);
  const QUEBRADO = 1;
  metaRespondeCom((indice) =>
    indice === QUEBRADO
      ? { status: 400, corpo: { error: { message: "Invalid parameter", code: 100 } } }
      : { status: 200, corpo: { id: `id-${indice}`, status: "PENDING" } },
  );

  const res = respostaFalsa();
  await controller.criarTemplates(requisicaoFalsa(), res);

  assert.equal(res.codigo, 200, "com algum criado, a acao nao falhou");
  assert.equal(chamadas.length, nomes.length, "todos foram tentados");
  assert.equal(res.corpo.criados, nomes.length - 1);
  assert.equal(res.corpo.falharam, 1);

  const quebrado = res.corpo.resultados[QUEBRADO];
  assert.equal(quebrado.nome, nomes[QUEBRADO]);
  assert.equal(quebrado.criado, false);
  assert.equal(quebrado.codigo, 100);
  assert.match(quebrado.erro, /\S/, "a linha do template que falhou diz por que");
  assert.equal(res.corpo.resultados[0].criado, true);
  assert.equal(res.corpo.resultados[nomes.length - 1].criado, true);
});

test("POST /templates: template que ja existe na Meta nao conta como falha", async () => {
  // O segundo clique no botao e o caso comum, e ele nao pode parecer um erro
  // de integracao: 2388023 e "esse nome ja existe", nao "nao deu para criar".
  await configurarTudo();
  metaResponde(400, {
    error: { message: "Template name already exists", code: 2388023 },
  });

  const res = respostaFalsa();
  await controller.criarTemplates(requisicaoFalsa(), res);

  assert.equal(res.codigo, 200);
  assert.equal(res.corpo.falharam, 0);
  assert.equal(res.corpo.jaExistiam, Object.keys(TEMPLATES).length);
  assert.ok(res.corpo.resultados.every((r) => r.jaExistia === true));
});

test("POST /templates com a Meta recusando TUDO devolve 502 com a frase dela", async () => {
  await configurarTudo();
  metaResponde(400, {
    error: { message: `Invalid OAuth access token: ${TOKEN}`, code: 190 },
  });

  const res = respostaFalsa();
  await controller.criarTemplates(requisicaoFalsa(), res);

  assert.equal(res.codigo, 502, "a Meta recusando tudo nao e 200 nem 500");
  assert.match(res.corpo.message, /\S/);
  assert.equal(res.corpo.criados, 0);
  assert.equal(res.corpo.resultados.length, Object.keys(TEMPLATES).length);
  assert.equal(textoDa(res).includes(TOKEN), false, "o token voltou dentro do erro da Meta");
});

test("GET /templates cruza o mapa da loja com o que a Meta tem", async () => {
  await configurarTudo();
  metaResponde(200, {
    data: [
      {
        name: "pedido_recebido",
        status: "APPROVED",
        category: "UTILITY",
        correct_category: "MARKETING",
      },
      { name: "pedido_entregue", status: "REJECTED", rejected_reason: "INVALID_FORMAT" },
    ],
  });

  const res = respostaFalsa();
  await controller.lerTemplates(requisicaoFalsa(), res);

  assert.equal(res.codigo, 200);
  const porNome = Object.fromEntries(res.corpo.templates.map((t) => [t.nome, t]));
  assert.equal(res.corpo.templates.length, Object.keys(TEMPLATES).length);
  assert.equal(porNome.pedido_recebido.status, "APPROVED");
  // Reclassificacao pendente: a Meta anuncia por `correct_category` ANTES de
  // passar a cobrar como marketing.
  assert.equal(porNome.pedido_recebido.correct_category, "MARKETING");
  assert.equal(porNome.pedido_entregue.rejected_reason, "INVALID_FORMAT");
  // O que a Meta nao tem aparece como ausente, e nao some da lista.
  assert.equal(porNome.pagamento_aprovado.status, null);
});

/* ------------------------------------------------------------------------- *
 * 7. O historico
 * ------------------------------------------------------------------------- */

test("GET /mensagens devolve telefone_final e nenhum telefone completo", async () => {
  await bd.pool.query(
    `INSERT INTO canastra.whatsapp_mensagens
       (pedido_id, user_id, telefone_final, template, status, wamid, enviado_em, criado_em)
     VALUES ($1::uuid, $2::uuid, '0000', 'pedido_recebido', 'enviada', $3, now(), now())`,
    [PEDIDO, ANA, WAMID],
  );
  await bd.pool.query(
    `INSERT INTO canastra.whatsapp_mensagens
       (pedido_id, user_id, telefone_final, template, status, erro_codigo, erro_texto, criado_em)
     VALUES ($1::uuid, $2::uuid, '0000', 'pedido_entregue', 'falhou', 131047,
             'WhatsApp: POST /messages respondeu HTTP 400, código 131047', now() - interval '1 hour')`,
    [PEDIDO, ANA],
  );

  const res = respostaFalsa();
  await controller.historico(requisicaoFalsa(), res);

  assert.equal(res.codigo, 200);
  assert.equal(res.corpo.mensagens.length, 2);
  assert.equal(res.corpo.mensagens[0].template, "pedido_recebido", "mais recente primeiro");
  assert.equal(res.corpo.mensagens[0].telefone_final, "0000");
  assert.equal(res.corpo.mensagens[1].status, "falhou");
  // A frase do erro E o que a tela mostra ao gestor quando o aviso nao saiu.
  assert.match(res.corpo.mensagens[1].erro_texto, /131047/);
  assert.equal(res.corpo.mensagens[1].erro_codigo, 131047);

  const inteiro = textoDa(res);
  assert.equal(inteiro.includes(TELEFONE), false, "telefone completo no historico");
  assert.equal(
    inteiro.includes(WAMID),
    false,
    "o wamid decodifica em base64 para o telefone do cliente — ele nao sai daqui",
  );
  assert.equal(
    inteiro.includes(Buffer.from(`${TELEFONE}1`).toString("base64")),
    false,
    "nem o miolo do wamid",
  );
});

test("GET /mensagens respeita o teto do limite pedido", async () => {
  for (let i = 0; i < 5; i += 1) {
    await bd.pool.query(
      `INSERT INTO canastra.whatsapp_mensagens (template, status, telefone_final, criado_em)
       VALUES ('pedido_recebido', 'enviada', '0000', now() - ($1 || ' minutes')::interval)`,
      [String(i)],
    );
  }

  const res = respostaFalsa();
  await controller.historico(requisicaoFalsa({ query: { limite: "2" } }), res);
  assert.equal(res.corpo.mensagens.length, 2);

  // Lixo no parametro nao pode virar 500 nem `LIMIT NaN`.
  for (const limite of ["abc", "-3", "0", "999999", ""]) {
    const outra = respostaFalsa();
    await controller.historico(requisicaoFalsa({ query: { limite } }), outra);
    assert.equal(outra.codigo, 200, `limite=${limite} devia responder 200`);
    assert.ok(outra.corpo.mensagens.length <= 5);
  }
});

/* ------------------------------------------------------------------------- *
 * 8. O erro da Meta vira a frase do servidor
 * ------------------------------------------------------------------------- */

test("o erro da Meta chega ao painel como frase, com codigo, e sem segredo dentro", async () => {
  await configurarTudo();
  metaResponde(400, {
    error: {
      message: "(#131030) Recipient phone number not in allowed list",
      code: 131030,
      error_data: { details: `Add +${TELEFONE} to the allowed list. Token ${TOKEN}` },
    },
  });

  const res = respostaFalsa();
  await controller.enviarTeste(requisicaoFalsa({ body: { para: TELEFONE } }), res);

  // 502 e nao 500: o problema e do lado de la, e a frase e para o gestor ler.
  assert.equal(res.codigo, 502);
  assert.equal(res.corpo.codigo, 131030);
  assert.match(res.corpo.message, /131030/, "a tela mostra `corpo.message`");
  assert.match(res.corpo.message, /\S/);

  const inteiro = textoDa(res);
  assert.equal(inteiro.includes(TOKEN), false, "o token veio de carona na frase da Meta");
  assert.equal(inteiro.includes(TELEFONE), false, "o telefone veio de carona na frase da Meta");
});

test("erro que NAO e da Meta nao repassa a `message` para a tela", async () => {
  // So `ErroDaMeta` vem redigido. A `message` de um erro do `pg` e
  // `Failing row contains (1, f, EAAG..., ...)` — a LINHA INTEIRA, token
  // dentro —, e ela chegaria ao navegador se a sonda repassasse qualquer
  // `erro.message` que aparecesse.
  await configurarTudo();
  const cru = new Error(`Failing row contains (1, f, ${TOKEN}, ${TELEFONE})`);
  cru.code = "23502";
  quebrar.perfil = cru;

  const res = respostaFalsa();
  await controller.status(requisicaoFalsa(), res);

  assert.equal(res.codigo, 200);
  assert.match(res.corpo.erro, /\S/, "a tela ainda precisa de uma frase");
  const inteiro = textoDa(res);
  assert.equal(inteiro.includes(TOKEN), false, "a `message` crua vazou o token");
  assert.equal(inteiro.includes(TELEFONE), false);
});

test("falha do banco no historico vira 500 COM frase, nunca 500 mudo", async () => {
  // O historico e a unica rota do painel que consulta tabela direto; a queda do
  // banco nao pode virar resposta sem texto para a tela mostrar.
  const pgPool = require("../src/pgPool.js");
  const queryOriginal = pgPool.query;
  pgPool.query = async () => {
    const erro = new Error("connection terminated");
    erro.code = "57P01";
    throw erro;
  };
  try {
    const res = respostaFalsa();
    await controller.historico(requisicaoFalsa(), res);
    assert.equal(res.codigo, 500);
    assert.match(res.corpo.message, /\S/);
    assert.ok(res.corpo.error);
  } finally {
    pgPool.query = queryOriginal;
  }
});

/* ------------------------------------------------------------------------- *
 * 9. A ordem dos middlewares — a rota que fica aberta por engano
 * ------------------------------------------------------------------------- */

test("TODA rota do painel passa por isAuthenticated ANTES de isAdmin", async () => {
  const camadas = rotas.stack.filter((camada) => camada.route);
  assert.ok(camadas.length >= 7, "o roteador precisa ter as rotas do painel");

  for (const camada of camadas) {
    const caminho = camada.route.path;
    const pilha = camada.route.stack.map((c) => c.handle);
    // Identidade, e nao nome: um middleware homonimo passaria por nome.
    assert.equal(pilha[0], autenticar, `${caminho}: isAuthenticated tem de ser o PRIMEIRO`);
    assert.equal(pilha[1], isAdmin, `${caminho}: isAdmin vem logo depois`);
  }

  // E o roteador nao esconde rota que ninguem conferiu.
  const montadas = camadas
    .map((c) => `${Object.keys(c.route.methods)[0].toUpperCase()} ${c.route.path}`)
    .sort();
  assert.deepEqual(montadas, [
    "GET /config",
    "GET /mensagens",
    "GET /status",
    "GET /templates",
    "POST /teste",
    "POST /templates",
    "PUT /config",
  ].sort());
});

test("isAdmin sem isAuthenticated na frente FECHA a rota — a falha e para o lado certo", () => {
  // A prova de que a ordem importa por um motivo concreto, e nao por estilo.
  const res = respostaFalsa();
  isAdmin({ /* sem req.user */ }, res, () => {
    throw new Error("isAdmin deixou passar requisicao sem req.user");
  });
  assert.equal(res.codigo, 403);
});
