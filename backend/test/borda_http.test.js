"use strict";

/**
 * A borda HTTP da API: o que o navegador consegue MANDAR e o que ele consegue
 * LER de volta quando algo dá errado.
 *
 * Nenhum teste daqui precisa de banco — são dois defeitos de middleware, e
 * ambos são invisíveis pelo caminho feliz:
 *
 *  - o preflight recusando `Idempotency-Key` não produz erro de aplicação
 *    nenhum: a requisição simplesmente não acontece, e o controller tem
 *    fallback silencioso para um uuid novo (a defesa contra cobrança duplicada
 *    some sem deixar rastro);
 *  - o erro do multer virando 500 genérico não produz erro nenhum tampouco: a
 *    frase certa existe, está escrita, e nunca chega ao navegador.
 *
 * `index.js` NÃO é carregável num teste (abre porta, confere ambiente e fala
 * com o GoTrue no require), então o que se testa aqui são os módulos que ele
 * monta — e uma asserção de fonte garante que ele os monta na ordem certa,
 * mesmo padrão de vitrine_rotas.test.js:530.
 */

const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const express = require("express");
const cors = require("cors");
const fs = require("node:fs");
const path = require("node:path");

const multer = require("multer");

const { opcoesDeCors, CABECALHOS_LIBERADOS } = require("../src/config/cors.js");
const {
  erroDeUpload,
  CODIGO_DE_FORMATO,
  LIMITE_DE_TAMANHO_BYTES,
} = require("../src/middleware/erroDeUpload.js");

let servidor;
let urlDaApi;

before(async () => {
  // O mesmo `cors(opcoesDeCors)` que index.js monta — não uma cópia da
  // configuração, senão o teste passaria com a API recusando o cabeçalho.
  const app = express();
  app.use(cors(opcoesDeCors));
  app.post("/payment/process", (req, res) => res.json({ ok: true }));

  // As rotas de upload: cada uma injeta o erro que o multer lancaria, para o
  // teste medir a TRADUCAO e nao a deteccao do multer (que e do multer).
  app.post("/upload/:codigo", (req, res, next) => {
    next(new multer.MulterError(req.params.codigo));
  });
  app.post("/upload-formato", (req, res, next) => {
    const erro = new Error("Formato não aceito. Envie JPG, PNG, WebP ou AVIF.");
    erro.code = CODIGO_DE_FORMATO;
    next(erro);
  });
  app.post("/estoura", (req, res, next) => {
    next(new Error("qualquer outra coisa"));
  });

  // A MESMA ordem de index.js: o tradutor do multer na frente do global.
  app.use(erroDeUpload);
  app.use((err, req, res, next) => {
    res.status(500).json({ message: "Erro interno no servidor." });
  });

  await new Promise((pronto) => {
    servidor = app.listen(0, "127.0.0.1", pronto);
  });
  urlDaApi = `http://127.0.0.1:${servidor.address().port}`;
});

after(async () => {
  if (servidor) await new Promise((pronto) => servidor.close(pronto));
});

/* --------------------------------------------------------------------------
 * CORS: o cabeçalho de idempotência atravessa o preflight
 * -------------------------------------------------------------------------- */

test("o preflight libera Idempotency-Key, que o checkout envia e o PaymentController lê", async () => {
  const resposta = await fetch(`${urlDaApi}/payment/process`, {
    method: "OPTIONS",
    headers: {
      Origin: "http://localhost:3000",
      "Access-Control-Request-Method": "POST",
      // Em minúsculas de propósito: é assim que o navegador manda.
      "Access-Control-Request-Headers": "idempotency-key",
    },
  });

  assert.equal(resposta.status, 204);

  const liberados = (resposta.headers.get("access-control-allow-headers") || "")
    .split(",")
    .map((c) => c.trim().toLowerCase());

  assert.ok(
    liberados.includes("idempotency-key"),
    "sem este cabeçalho no preflight o checkout cross-origin nem sai do navegador, " +
      "e a defesa contra cobrança duplicada desaparece sem erro nenhum",
  );
  // O controller lê os DOIS nomes; liberar só um deixa metade da leitura morta.
  assert.ok(liberados.includes("x-idempotency-key"));

  // E os três de sempre continuam de pé.
  assert.ok(liberados.includes("content-type"));
  assert.ok(liberados.includes("authorization"));
  assert.ok(liberados.includes("accept"));
});

test("os dois nomes lidos pelo PaymentController estão na lista liberada", () => {
  // Casa a lista do CORS com a leitura real do controller: se alguém trocar o
  // nome num lado, este teste é o aviso — o navegador não daria nenhum.
  const controller = fs.readFileSync(
    path.join(__dirname, "..", "src", "controllers", "PaymentController.js"),
    "utf8",
  );
  const lidos = [...controller.matchAll(/req\.headers\["([a-z-]*idempotency-key)"\]/g)].map(
    (m) => m[1],
  );

  assert.deepEqual(new Set(lidos), new Set(["idempotency-key", "x-idempotency-key"]));
  for (const nome of lidos) {
    assert.ok(
      CABECALHOS_LIBERADOS.some((c) => c.toLowerCase() === nome),
      `o controller lê "${nome}" e o preflight não o libera`,
    );
  }
});

/* --------------------------------------------------------------------------
 * Upload: o erro do multer chega ao navegador como frase, não como 500
 * -------------------------------------------------------------------------- */

/** Um POST e o corpo já lido como JSON (as respostas daqui são todas JSON). */
async function postar(caminho) {
  const resposta = await fetch(`${urlDaApi}${caminho}`, { method: "POST" });
  return { status: resposta.status, corpo: await resposta.json() };
}

test("upload: arquivo grande demais é 400 citando o limite, não 500 genérico", async () => {
  const { status, corpo } = await postar("/upload/LIMIT_FILE_SIZE");

  assert.equal(status, 400, "é erro do PEDIDO: o servidor está inteiro");
  assert.notEqual(corpo.message, "Erro interno no servidor.");
  // A frase precisa dizer QUAL é o limite — "arquivo grande demais" sozinho
  // não diz ao gestor o que fazer com o arquivo que ele tem na mão.
  const limiteEmMb = LIMITE_DE_TAMANHO_BYTES / (1024 * 1024);
  assert.ok(
    corpo.message.includes(`${limiteEmMb} MB`),
    `a mensagem deveria citar o limite de ${limiteEmMb} MB, e veio: ${corpo.message}`,
  );
});

test("upload: arquivos demais é 400 falando de quantidade", async () => {
  for (const codigo of ["LIMIT_FILE_COUNT", "LIMIT_UNEXPECTED_FILE"]) {
    const { status, corpo } = await postar(`/upload/${codigo}`);
    assert.equal(status, 400, codigo);
    assert.match(corpo.message, /no máximo 2/, codigo);
  }
});

test("upload: mimetype recusado devolve a frase do fileFilter, com os formatos", async () => {
  const { status, corpo } = await postar("/upload-formato");

  assert.equal(status, 400);
  // É esta a frase que nunca chegava ao navegador: quem subia um HEIC lia
  // "Erro interno no servidor." e não tinha como saber o que converter.
  assert.equal(
    corpo.message,
    "Formato não aceito. Envie JPG, PNG, WebP ou AVIF.",
  );
});

test("upload: erro que NÃO é de upload continua indo para o handler global", async () => {
  // O tradutor não pode virar um catch-all: um 500 de verdade tem de continuar
  // sendo 500, com o log do servidor por trás.
  const { status, corpo } = await postar("/estoura");
  assert.equal(status, 500);
  assert.equal(corpo.message, "Erro interno no servidor.");
});

test("upload: o fileFilter do multer marca a recusa com o código que o tradutor lê", () => {
  // Os dois lados desta ligação são invisíveis um para o outro em tempo de
  // execução: se alguém tirar o `code` do fileFilter, nada quebra — a frase só
  // volta a virar 500 em produção. Este teste é o aviso.
  const fonte = fs.readFileSync(
    path.join(__dirname, "..", "src", "middleware", "multer.js"),
    "utf8",
  );
  assert.match(fonte, /erro\.code = CODIGO_DE_FORMATO/);
});

test("upload: em index.js o tradutor vem ANTES do handler global", () => {
  // A ordem É o conserto: o Express casa error handler na ordem de registro e
  // o primeiro que responder encerra. Registrado depois do global, este
  // middleware nunca roda e a frase continua morrendo como "Erro interno".
  const indice = fs.readFileSync(
    path.join(__dirname, "..", "src", "index.js"),
    "utf8",
  );

  const posicaoDoTradutor = indice.indexOf("app.use(erroDeUpload)");
  // A linha do handler, não a frase: a frase também aparece no comentário que
  // explica por que a ordem importa, e casaria antes da linha real.
  const posicaoDoGlobal = indice.indexOf(
    'res.status(500).json({ message: "Erro interno no servidor." })',
  );

  assert.ok(posicaoDoTradutor > 0, "index.js precisa montar o erroDeUpload");
  assert.ok(posicaoDoGlobal > 0);
  assert.ok(
    posicaoDoTradutor < posicaoDoGlobal,
    "o tradutor de erro de upload tem de ser registrado antes do handler global",
  );
});
