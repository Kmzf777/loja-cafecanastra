const multer = require("multer");
const { CloudinaryStorage } = require("multer-storage-cloudinary");
const { v2: cloudinary } = require("cloudinary");
const { v4: uuidv4 } = require("uuid");
const {
  CODIGO_DE_FORMATO,
  LIMITE_DE_TAMANHO_BYTES,
  LIMITE_DE_ARQUIVOS,
} = require("./erroDeUpload");

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

const storage = new CloudinaryStorage({
  cloudinary: cloudinary,
  params: async (req, file) => {
    const originalName = file.originalname
      .split(".")[0]
      .replace(/[^a-zA-Z0-9]/g, "");
    const uniqueId = `${originalName}_${uuidv4()}`;

    return {
      // Era a pasta de outro catalogo. As imagens do Canastra ficam na
      // pasta do Canastra.
      folder: "canastra_produtos",
      // Mesma lista do fileFilter (TIPOS_ACEITOS) — as duas cercas divergindo
      // significava AVIF passando pelo filtro e morrendo na Cloudinary.
      allowed_formats: ["jpg", "png", "jpeg", "webp", "avif"],
      public_id: uniqueId,
    };
  },
});

/**
 * Limites do upload de imagem do painel.
 *
 * Nao havia limite nenhum: qualquer arquivo, de qualquer tamanho, ia direto
 * para a Cloudinary. Isso e conta de armazenamento aberta e um caminho barato
 * de esgotar disco/banda com uploads grandes em sequencia.
 *
 * `allowed_formats` do CloudinaryStorage so age DEPOIS do arquivo subir. O
 * fileFilter corta antes, na entrada — mas repare que ele confere o mimetype
 * declarado, que o cliente controla; a garantia real de que o conteudo e mesmo
 * uma imagem vem da Cloudinary, que recusa o que nao souber decodificar.
 */
const TIPOS_ACEITOS = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/avif",
]);

const upload = multer({
  storage: storage,
  limits: {
    // Os dois limites vem de `erroDeUpload` porque e la que eles viram FRASE
    // ("O limite e 5 MB por arquivo"): numero e mensagem em arquivos
    // diferentes divergem no primeiro dia em que alguem mexer num so.
    fileSize: LIMITE_DE_TAMANHO_BYTES, // 5 MB por arquivo
    files: LIMITE_DE_ARQUIVOS, // o formulario de config envia 2 banners
  },
  fileFilter: (req, file, cb) => {
    if (!TIPOS_ACEITOS.has(file.mimetype)) {
      // O `code` e o que permite `erroDeUpload` reconhecer esta recusa sem
      // comparar o TEXTO da mensagem. Sem ele, esta frase — que existe
      // justamente para ser lida por quem esta na tela — morria no error
      // handler global como "Erro interno no servidor.".
      const erro = new Error("Formato não aceito. Envie JPG, PNG, WebP ou AVIF.");
      erro.code = CODIGO_DE_FORMATO;
      return cb(erro, false);
    }
    cb(null, true);
  },
});

module.exports = { upload, cloudinary };
