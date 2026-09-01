const multer = require("multer");

/**
 * Traduz o erro do multer para uma resposta que o gestor consegue LER.
 *
 * O multer lanca ANTES do handler da rota — arquivo grande demais, arquivo a
 * mais, mimetype recusado. Sem este middleware o erro caia direto no error
 * handler global de `index.js`, que responde `{message:"Erro interno no
 * servidor."}` com 500. Ou seja: a frase certa existia, estava escrita no
 * `fileFilter`, e NUNCA chegava ao navegador — quem subisse um HEIC lia "erro
 * interno" e abria chamado.
 *
 * Sao todos erros DO PEDIDO, entao 400. E ele tem de ser registrado ANTES do
 * handler global: o Express casa os error handlers na ordem de registro, e o
 * primeiro que responder encerra.
 */

/** 5 MB por arquivo. */
const LIMITE_DE_TAMANHO_BYTES = 5 * 1024 * 1024;

/** O formulario de config envia 2 banners; nenhuma rota precisa de mais. */
const LIMITE_DE_ARQUIVOS = 2;

/**
 * O `fileFilter` recusa por mimetype com um `Error` COMUM, nao com um
 * `MulterError` — o multer so repassa o que o filtro lhe deu. Sem uma marca, a
 * unica forma de reconhecer essa recusa aqui seria comparar o TEXTO da
 * mensagem, que muda no dia em que alguem melhorar a frase. A marca e o codigo.
 */
const CODIGO_DE_FORMATO = "FORMATO_NAO_ACEITO";

const MB = 1024 * 1024;

const FRASES = {
  LIMIT_FILE_SIZE: `Imagem grande demais. O limite é ${LIMITE_DE_TAMANHO_BYTES / MB} MB por arquivo.`,
  LIMIT_FILE_COUNT: `Arquivos demais. Envie no máximo ${LIMITE_DE_ARQUIVOS}.`,
  // Campo de arquivo que a rota nao espera. Para quem esta na tela e a mesma
  // historia da quantidade: veio arquivo que nao cabia neste formulario.
  LIMIT_UNEXPECTED_FILE: `Arquivos demais. Envie no máximo ${LIMITE_DE_ARQUIVOS}, e só nos campos do formulário.`,
};

function erroDeUpload(err, req, res, next) {
  if (err && err.code === CODIGO_DE_FORMATO) {
    // A frase do proprio filtro: "Formato não aceito. Envie JPG, PNG, WebP ou
    // AVIF." — a lista de formatos mora la, e duas copias divergem.
    return res.status(400).json({ message: err.message });
  }

  if (err instanceof multer.MulterError) {
    return res.status(400).json({
      message:
        FRASES[err.code] ||
        // Os demais codigos (LIMIT_PART_COUNT, LIMIT_FIELD_*) tambem sao do
        // pedido, nunca do servidor: 400 com o que o multer soube dizer.
        `Não foi possível receber o arquivo enviado (${err.code}).`,
    });
  }

  // Nao e erro de upload: segue para o handler global, que loga e responde 500.
  return next(err);
}

module.exports = {
  erroDeUpload,
  CODIGO_DE_FORMATO,
  LIMITE_DE_TAMANHO_BYTES,
  LIMITE_DE_ARQUIVOS,
};
