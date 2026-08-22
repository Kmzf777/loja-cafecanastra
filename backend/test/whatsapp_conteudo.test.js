"use strict";

/**
 * Os seis templates de utilidade, e as regras da Meta afirmadas em TESTE e nao
 * em comentario -- um template que viola a regra de formatacao volta REJECTED
 * depois de ate 24h de espera, e o erro so aparece la.
 *
 * Sem banco e sem rede: e mapa e funcao pura.
 */

const { test } = require("node:test");
const assert = require("node:assert/strict");
const {
  TEMPLATES,
  conteudoDoStatusWhats,
  corpoSemVariavelPendurada,
} = require("../src/utils/whatsappMensagens.js");

const PEDIDO = {
  order_id: "3f2504e0-4f89-11d3-9a0c-0305e82c3301",
  total_amount: "89.90",
  tracking_code: "AA123456789BR",
};

test("cada status que avisa produz o seu template", () => {
  const casos = [
    ["pendente", "pedido_recebido"],
    ["aprovado", "pagamento_aprovado"],
    ["enviado", "pedido_enviado"],
    ["entregue", "pedido_entregue"],
    ["cancelado", "pedido_cancelado"],
    ["rejeitado", "pedido_cancelado"],
    ["reembolsado", "pedido_reembolsado"],
  ];
  for (const [status, template] of casos) {
    const c = conteudoDoStatusWhats(status, PEDIDO, "Ana", PEDIDO.tracking_code);
    assert.equal(c?.template, template, `status ${status}`);
    assert.equal(c?.idioma, "pt_BR");
  }
});

test("os status intermediarios do gateway ficam em silencio", () => {
  // O MESMO recorte que o e-mail faz (emailSender.js:47-48). Avisar "seu
  // pagamento esta em analise" a cada oscilacao do gateway so gera ansiedade —
  // e, no WhatsApp, custa dinheiro por mensagem.
  assert.equal(conteudoDoStatusWhats("em_processamento", PEDIDO, "Ana"), null);
  assert.equal(conteudoDoStatusWhats("autorizado", PEDIDO, "Ana"), null);
  assert.equal(conteudoDoStatusWhats("inventado", PEDIDO, "Ana"), null);
});

test("o recorte do WhatsApp e o mesmo do e-mail, status por status", () => {
  // A prova de que as duas listas nao divergem: se alguem acrescentar um status
  // ao e-mail e esquecer o WhatsApp (ou o contrario), este teste morde.
  const { conteudoDoStatus } = require("../src/utils/emailSender.js");
  const { STATUS_VALIDOS } = require("../src/utils/statusDePedido.js");

  for (const status of STATUS_VALIDOS) {
    const email = conteudoDoStatus(status, PEDIDO, "Ana", null);
    const zap = conteudoDoStatusWhats(status, PEDIDO, "Ana", null);
    assert.equal(
      Boolean(email),
      Boolean(zap),
      `status "${status}": e-mail e WhatsApp discordam sobre avisar`,
    );
  }
});

test("os parametros nomeados chegam preenchidos", () => {
  const c = conteudoDoStatusWhats("enviado", PEDIDO, "Ana", "AA123456789BR");
  assert.equal(c.parametros.nome_cliente, "Ana");
  assert.equal(c.parametros.numero_pedido, "3f2504e0");
  assert.equal(c.parametros.codigo_rastreio, "AA123456789BR");
});

test("pedido enviado sem rastreio ainda avisa, sem prometer codigo", () => {
  // O painel permite mudar para 'enviado' sem digitar o codigo. O aviso nao
  // pode sair com "seu codigo e undefined".
  const c = conteudoDoStatusWhats("enviado", PEDIDO, "Ana", null);
  assert.equal(c.template, "pedido_enviado_sem_rastreio");
  assert.equal(c.botaoUrl, null);
});

test("o botao de rastreio leva o codigo como sufixo, percent-encoded", () => {
  // A Meta aceita UMA variavel no botao URL, e so no fim. E exige
  // percent-encoding de caractere especial.
  const c = conteudoDoStatusWhats("enviado", PEDIDO, "Ana", "AA 123/BR");
  assert.equal(c.botaoUrl, "AA%20123%2FBR");
});

test("nenhum corpo de template comeca ou termina em variavel", () => {
  // Regra dura e documentada da Meta: "dangling parameters are not allowed".
  // Violar isto reprova o template na revisao, ate 24h depois.
  for (const [nome, tpl] of Object.entries(TEMPLATES)) {
    assert.equal(
      corpoSemVariavelPendurada(tpl.corpo),
      true,
      `template "${nome}" comeca ou termina em variavel`,
    );
  }
});

test("nenhum corpo tem duas variaveis coladas", () => {
  for (const [nome, tpl] of Object.entries(TEMPLATES)) {
    assert.equal(
      /\}\}\s*\{\{/.test(tpl.corpo),
      false,
      `template "${nome}" tem variaveis adjacentes`,
    );
  }
});

test("nenhum corpo passa de 1024 caracteres e nenhum rodape passa de 60", () => {
  for (const [nome, tpl] of Object.entries(TEMPLATES)) {
    assert.ok(tpl.corpo.length <= 1024, `corpo de "${nome}" estourou 1024`);
    assert.ok(tpl.rodape.length <= 60, `rodape de "${nome}" estourou 60`);
    // Rodape com variavel e recusado pela Meta.
    assert.equal(/\{\{/.test(tpl.rodape), false, `rodape de "${nome}" tem variavel`);
  }
});

test("todo nome de template respeita o alfabeto que a Meta aceita", () => {
  for (const nome of Object.keys(TEMPLATES)) {
    assert.match(nome, /^[a-z0-9_]{1,512}$/, `nome "${nome}" invalido`);
  }
});

test("nenhum template de utilidade carrega palavra de venda", () => {
  // O exemplo LITERAL da Meta do que vira MARKETING e "an order update with a
  // promo". Reclassificacao multiplica o preco por ~9 e "template
  // misclassification" e motivo explicito de bloqueio de envio.
  const proibidas = [
    "desconto", "promo", "oferta", "cupom", "aproveite",
    "compre", "%", "gratis", "imperdivel", "novidade",
  ];
  for (const [nome, tpl] of Object.entries(TEMPLATES)) {
    const texto = (tpl.corpo + " " + tpl.rodape).toLowerCase();
    for (const palavra of proibidas) {
      assert.equal(
        texto.includes(palavra),
        false,
        `template "${nome}" contem "${palavra}" — isso o reclassifica para MARKETING`,
      );
    }
  }
});

test("todo template leva o botao que abre a janela de atendimento", () => {
  // E o quick-reply que da entrada no menu de suporte: sem ele, o cliente que
  // precisa de ajuda nao tem por onde comecar sem sair do WhatsApp.
  for (const [nome, tpl] of Object.entries(TEMPLATES)) {
    assert.ok(
      tpl.botoes.some((b) => b.type === "QUICK_REPLY"),
      `template "${nome}" nao tem quick-reply de ajuda`,
    );
  }
});

test("quando ha botao URL, ele vem antes dos quick-reply", () => {
  // A Meta recusa quick-reply intercalado com nao-quick-reply: "URL, QR, QR" e
  // valido; "QR, URL, QR" nao e.
  for (const [nome, tpl] of Object.entries(TEMPLATES)) {
    const tipos = tpl.botoes.map((b) => b.type);
    const primeiroQr = tipos.indexOf("QUICK_REPLY");
    const ultimoNaoQr = tipos.map((t, i) => (t === "QUICK_REPLY" ? -1 : i)).reduce((a, b) => Math.max(a, b), -1);
    assert.ok(
      primeiroQr === -1 || ultimoNaoQr < primeiroQr,
      `template "${nome}" intercala quick-reply com outro tipo`,
    );
  }
});
