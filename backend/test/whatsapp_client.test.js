"use strict";

/**
 * O cliente HTTP da Graph API.
 *
 * A Graph API e DUBLE porque teste que faz requisicao de verdade nao distingue
 * "a logica esta errada" de "a Meta caiu". A costura e `fetchImpl` no default
 * do parametro, o mesmo desenho de blingClient.js:175.
 *
 * REGRA ZERO DA CASA: ninguem sobrescreve globalThis.fetch.
 */

const { test } = require("node:test");
const assert = require("node:assert/strict");
const cliente = require("../src/services/whatsappClient.js");

const CFG = {
  ativo: true,
  access_token: "EAAG-token-secreto-4821",
  phone_number_id: "1234567890",
  waba_id: "9876543210",
};

/** O formato de Response falso e fixo na casa (f7_bling.test.js:680-693). */
function graphFalsa(respostas) {
  const chamadas = [];
  const fetchImpl = async (url, opts) => {
    chamadas.push({ url: String(url), opts });
    const { status = 200, corpo = {} } = respostas.shift() ?? {};
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => corpo,
      text: async () => JSON.stringify(corpo),
    };
  };
  return { fetchImpl, chamadas };
}

test("o template sai para o numero certo, na versao fixada, com o Bearer", async () => {
  const g = graphFalsa([{ corpo: { messages: [{ id: "wamid.OK" }] } }]);

  const r = await cliente.enviarTemplate(
    CFG,
    {
      para: "5531999990000",
      template: "pedido_enviado",
      idioma: "pt_BR",
      parametros: { nome_cliente: "Ana", numero_pedido: "3f2504e0" },
      botaoUrl: "AA123456789BR",
    },
    { fetchImpl: g.fetchImpl },
  );

  assert.equal(r.wamid, "wamid.OK");
  assert.equal(g.chamadas.length, 1);
  assert.equal(g.chamadas[0].url, "https://graph.facebook.com/v26.0/1234567890/messages");
  assert.equal(g.chamadas[0].opts.method, "POST");
  assert.equal(g.chamadas[0].opts.headers.Authorization, "Bearer EAAG-token-secreto-4821");

  const corpo = JSON.parse(g.chamadas[0].opts.body);
  assert.equal(corpo.messaging_product, "whatsapp");
  assert.equal(corpo.to, "5531999990000");
  assert.equal(corpo.type, "template");
  assert.equal(corpo.template.name, "pedido_enviado");
  assert.equal(corpo.template.language.code, "pt_BR");
});

test("os parametros nomeados viram a forma que a Meta espera", async () => {
  const g = graphFalsa([{ corpo: { messages: [{ id: "wamid.OK" }] } }]);
  await cliente.enviarTemplate(
    CFG,
    { para: "5531999990000", template: "t", idioma: "pt_BR", parametros: { nome_cliente: "Ana" } },
    { fetchImpl: g.fetchImpl },
  );

  const corpo = JSON.parse(g.chamadas[0].opts.body);
  const body = corpo.template.components.find((c) => c.type === "body");
  assert.deepEqual(body.parameters, [
    { type: "text", parameter_name: "nome_cliente", text: "Ana" },
  ]);
});

test("o botao de URL entra como componente proprio, indice zero", async () => {
  const g = graphFalsa([{ corpo: { messages: [{ id: "wamid.OK" }] } }]);
  await cliente.enviarTemplate(
    CFG,
    { para: "5531999990000", template: "t", idioma: "pt_BR", parametros: {}, botaoUrl: "AA1BR" },
    { fetchImpl: g.fetchImpl },
  );

  const corpo = JSON.parse(g.chamadas[0].opts.body);
  const botao = corpo.template.components.find((c) => c.type === "button");
  assert.equal(botao.sub_type, "url");
  assert.equal(botao.index, "0");
  assert.deepEqual(botao.parameters, [{ type: "text", text: "AA1BR" }]);
});

test("sem botaoUrl, nenhum componente de botao e enviado", async () => {
  // Mandar componente de botao para um template que nao tem botao URL faz a
  // Meta recusar a mensagem inteira com 132000.
  const g = graphFalsa([{ corpo: { messages: [{ id: "wamid.OK" }] } }]);
  await cliente.enviarTemplate(
    CFG,
    { para: "5531999990000", template: "t", idioma: "pt_BR", parametros: {}, botaoUrl: null },
    { fetchImpl: g.fetchImpl },
  );
  const corpo = JSON.parse(g.chamadas[0].opts.body);
  assert.equal(corpo.template.components.some((c) => c.type === "button"), false);
});

test("a mensagem interativa carrega ate tres botoes com id proprio", async () => {
  const g = graphFalsa([{ corpo: { messages: [{ id: "wamid.INT" }] } }]);
  await cliente.enviarInterativa(
    CFG,
    {
      para: "5531999990000",
      texto: "Como posso ajudar?",
      botoes: [
        { id: "meu_pedido", titulo: "Meu pedido" },
        { id: "falar_humano", titulo: "Falar com alguém" },
        { id: "parar_avisos", titulo: "Parar avisos" },
      ],
    },
    { fetchImpl: g.fetchImpl },
  );

  const corpo = JSON.parse(g.chamadas[0].opts.body);
  assert.equal(corpo.type, "interactive");
  assert.equal(corpo.interactive.type, "button");
  assert.equal(corpo.interactive.body.text, "Como posso ajudar?");
  assert.deepEqual(corpo.interactive.action.buttons[0], {
    type: "reply",
    reply: { id: "meu_pedido", title: "Meu pedido" },
  });
});

test("o erro da Meta vira erro nomeado, com o codigo preservado", async () => {
  const g = graphFalsa([
    { status: 400, corpo: { error: { code: 131047, message: "Re-engagement message" } } },
  ]);

  const erro = await cliente
    .enviarTemplate(CFG, { para: "5531999990000", template: "t", idioma: "pt_BR", parametros: {} }, { fetchImpl: g.fetchImpl })
    .then(() => null, (e) => e);

  assert.equal(erro.codigo, 131047);
  assert.match(erro.message, /131047/);
});

test("nenhum erro do cliente carrega o token", async () => {
  // O modo de falha que isto impede: o token no log do PM2, que fica em disco
  // e vai para qualquer backup.
  const g = graphFalsa([{ status: 401, corpo: { error: { code: 190, message: "Invalid OAuth" } } }]);

  const erro = await cliente
    .enviarTemplate(CFG, { para: "5531999990000", template: "t", idioma: "pt_BR", parametros: {} }, { fetchImpl: g.fetchImpl })
    .then(() => null, (e) => e);

  const tudo = String(erro.message) + String(erro.stack);
  assert.equal(tudo.includes("EAAG-token-secreto-4821"), false);
});

test("nenhum erro do cliente carrega o telefone do cliente", async () => {
  // Telefone e dado pessoal, e mensagem de erro acaba em log e em ticket.
  const g = graphFalsa([{ status: 400, corpo: { error: { code: 131026, message: "undeliverable" } } }]);

  const erro = await cliente
    .enviarTemplate(CFG, { para: "5531999990000", template: "t", idioma: "pt_BR", parametros: {} }, { fetchImpl: g.fetchImpl })
    .then(() => null, (e) => e);

  assert.equal(String(erro.message).includes("5531999990000"), false);
});

test("a rede caindo vira erro nomeado, e nao um TypeError cru", async () => {
  const fetchImpl = async () => {
    const e = new Error("The operation was aborted");
    e.name = "AbortError";
    throw e;
  };

  const erro = await cliente
    .enviarTemplate(CFG, { para: "5531999990000", template: "t", idioma: "pt_BR", parametros: {} }, { fetchImpl })
    .then(() => null, (e) => e);

  assert.equal(erro.name, "ErroDaMeta");
});

test("criarTemplate posta na WABA, nao no numero", async () => {
  const g = graphFalsa([{ corpo: { id: "999", status: "PENDING", category: "UTILITY" } }]);
  const r = await cliente.criarTemplate(
    CFG,
    { nome: "pedido_enviado", corpo: "Olá, {{nome_cliente}}. Fim.", rodape: "Café Canastra", botoes: [], exemplos: { nome_cliente: "Ana" } },
    { fetchImpl: g.fetchImpl },
  );

  assert.equal(g.chamadas[0].url, "https://graph.facebook.com/v26.0/9876543210/message_templates");
  const corpo = JSON.parse(g.chamadas[0].opts.body);
  assert.equal(corpo.category, "UTILITY");
  assert.equal(corpo.language, "pt_BR");
  assert.equal(corpo.parameter_format, "named");
  assert.equal(r.status, "PENDING");
});

test("listarTemplates pede os campos que o painel mostra", async () => {
  const g = graphFalsa([{ corpo: { data: [{ name: "pedido_enviado", status: "APPROVED" }] } }]);
  await cliente.listarTemplates(CFG, { fetchImpl: g.fetchImpl });

  assert.match(g.chamadas[0].url, /^https:\/\/graph\.facebook\.com\/v26\.0\/9876543210\/message_templates\?/);
  // `correct_category` e o que revela reclassificacao pendente da Meta.
  assert.match(g.chamadas[0].url, /correct_category/);
  assert.equal(g.chamadas[0].opts.method ?? "GET", "GET");
});
