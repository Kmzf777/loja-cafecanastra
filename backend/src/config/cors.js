/**
 * A configuracao de CORS da API, num modulo proprio.
 *
 * Mora fora do `index.js` por um motivo so: `index.js` abre porta, checa
 * ambiente e fala com o GoTrue no require — nao da para carrega-lo num teste.
 * A lista de cabecalhos liberados e a defesa contra cobranca duplicada (ver
 * `CABECALHOS_LIBERADOS` abaixo), entao ela precisa de teste que a exercite
 * pelo preflight de verdade, e nao de leitura de codigo-fonte.
 */

const isProd = process.env.NODE_ENV === "production";

/**
 * Origens liberadas.
 *
 * Antes a lista misturava dominios de outra loja com localhost,
 * e valia igual em producao. Manter localhost liberado em producao significa
 * que uma pagina rodando na maquina de um atacante (ou um app local malicioso)
 * fala com esta API a partir do navegador de quem esta logado.
 *
 * `credentials: true` FICA, apesar de nao existir mais cookie de sessao. Nao e
 * sobra: a vitrine e o painel chamam esta API com `credentials: "include"`, e
 * sem o `Access-Control-Allow-Credentials` na resposta o navegador BLOQUEIA a
 * resposta inteira — checkout, endereco e frete parariam com erro de CORS, nao
 * com erro de autenticacao. Enquanto quem chama mandar `include`, isto fica.
 *
 * Em producao vale so o que vier de CORS_ORIGIN (aceita lista separada por
 * virgula, para www e apex). Em desenvolvimento, as portas locais entram.
 */
const origensDeDesenvolvimento = [
  "http://localhost:5173",
  // A vitrine migrou de Vite (5173) para Next (3000) e o painel passou a ser
  // servido pelo Next junto com ela.
  "http://localhost:3000",
  "http://127.0.0.1:3000",
];

const allowedOrigins = [
  ...(process.env.CORS_ORIGIN || "").split(",").map((o) => o.trim()),
  ...(isProd ? [] : origensDeDesenvolvimento),
].filter(Boolean);

/**
 * Os cabecalhos que o preflight aceita.
 *
 * `X-CSRF-Token` saiu da lista junto com o csurf: um cabecalho liberado no
 * preflight que ninguem valida so confunde quem le. Ver o bloco do CSRF, logo
 * abaixo do healthcheck em index.js.
 *
 * `Idempotency-Key` e `X-Idempotency-Key` estao aqui porque o checkout do
 * navegador ENVIA o primeiro (frontend/lib/sacola/checkout.ts) e o
 * `PaymentController` LE os dois (`req.headers["idempotency-key"] ||
 * req.headers["x-idempotency-key"]`). Tirar qualquer um destes dois desta lista
 * nao quebra teste nenhum de checkout e nao produz erro visivel: o preflight
 * recusa o cabecalho, a requisicao nem sai, e quando ela sai por outro caminho
 * (mesma origem) o controller cai no fallback silencioso para um uuid novo — ou
 * seja, a defesa contra COBRANCA DUPLICADA deixa de existir EM SILENCIO. Os
 * dois nomes ficam porque as duas leituras existem; sincronize os dois lados ou
 * nenhum.
 */
const CABECALHOS_LIBERADOS = [
  "Content-Type",
  "Authorization",
  "Accept",
  "Idempotency-Key",
  "X-Idempotency-Key",
];

const opcoesDeCors = {
  origin: (origin, callback) => {
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error("Not allowed by CORS"));
    }
  },
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  allowedHeaders: CABECALHOS_LIBERADOS,
  credentials: true,
};

module.exports = { opcoesDeCors, CABECALHOS_LIBERADOS, allowedOrigins };
