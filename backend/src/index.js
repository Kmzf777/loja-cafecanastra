require("dotenv").config({ path: "./src/.env" });

// Antes de qualquer outra coisa: em producao, recusa subir com segredo de
// exemplo, ausente ou fraco. Ver src/config/ambiente.js.
require("./config/ambiente").conferirAmbiente();

const express = require("express");
const helmet = require("helmet");
const cors = require("cors");
const rateLimit = require("express-rate-limit");
const pool = require("./pgPool");

const productsRoutes = require("./routes/products.routes");
const { contaRoutes } = require("./routes/conta.routes");
const optionsRoutes = require("./routes/options.routes");
const promotionsRoutes = require("./routes/promotions.routes");
const paymentRoutes = require("./routes/orders.routes");
const addressRoutes = require("./routes/address.routes");
const cuponsRoutes = require("./routes/cupons.routes");
const { newsletterRoutes } = require("./routes/newsletter.routes");
const { lgpdRoutes } = require("./routes/lgpd.routes");
const blingRoutes = require("./routes/bling.routes");
const clubeRoutes = require("./routes/clube.routes");
const PaymentController = require("./controllers/PaymentController");
const ShippingController = require("./controllers/ShippingController");

const app = express();
const port = process.env.PORT || 3333;

app.set("trust proxy", 1);

// Segurança com headers HTTP
app.use(
  helmet({
    contentSecurityPolicy:
      process.env.NODE_ENV === "production" ? undefined : false,
    crossOriginResourcePolicy: { policy: "cross-origin" },
  }),
);

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

// Liberação de origem controlada
app.use(
  cors({
    origin: (origin, callback) => {
      if (!origin || allowedOrigins.includes(origin)) {
        callback(null, true);
      } else {
        callback(new Error("Not allowed by CORS"));
      }
    },
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    // `X-CSRF-Token` saiu da lista junto com o csurf: um cabecalho liberado no
    // preflight que ninguem valida so confunde quem le. Ver o bloco do CSRF,
    // logo abaixo do healthcheck.
    allowedHeaders: ["Content-Type", "Authorization", "Accept"],
    credentials: true,
  }),
);

app.options("*", (req, res) => res.sendStatus(200));

// Middleware essenciais.
//
// O limite de corpo caiu de 10 MB para 256 KB no JSON: nenhuma rota desta API
// recebe JSON grande — imagem sobe por multipart, tratada pelo multer, que tem
// o proprio limite. 10 MB de JSON por requisicao e superficie de exaustao de
// memoria de graca.
app.use(express.json({ limit: "256kb" }));
app.use(express.urlencoded({ limit: "256kb", extended: true }));

// NAO ha mais `/uploads`: nenhuma rota grava arquivo em disco local — imagem
// de produto e banner sobem para a Cloudinary pelo multer e o banco guarda a
// URL absoluta. O static que ficava aqui servia uma pasta que nao existe.

/**
 * As duas rotas sem autenticacao alguma, por natureza:
 *  - o webhook e chamado pelo Mercado Pago, que nao carrega token da loja; ele
 *    se autentica por assinatura HMAC (ver PaymentController).
 *  - a cotacao de frete e consultada antes de haver sessao.
 *
 * Ambas sao publicas e ambas custam dinheiro quando abusadas: o frete consome
 * cota do token da Melhor Envio, e o webhook dispara consulta a API do MP.
 * Por isso ganham limite de taxa proprio.
 */
const webhookLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 120,
  message: { error: "Muitas notificações." },
});

const freteLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  message: { error: "Muitas cotações de frete. Aguarde um instante." },
});

app.post("/webhook/mercadopago", webhookLimiter, PaymentController.receiveWebhook);
app.post("/shipping/calculate", freteLimiter, ShippingController.calculate);

/** Healthcheck para o orquestrador saber se o processo esta de pe. */
app.get("/health", async (req, res) => {
  try {
    await pool.query("SELECT 1");
    return res.json({ status: "ok", banco: "ok" });
  } catch {
    return res.status(503).json({ status: "degradado", banco: "indisponível" });
  }
});

/**
 * NAO HA MAIS CSRF AQUI, E O MOTIVO E ESPECIFICO.
 *
 * O `csurf` saiu porque a PREMISSA dele saiu, nao porque o pacote esta
 * obsoleto. CSRF e um ataque contra credencial que o NAVEGADOR ANEXA SOZINHO:
 * cookie de sessao. Enquanto esta API autenticava por cookie (`refreshToken`
 * emitido pelo antigo /auth/sign-in), um formulario em outro site conseguia
 * disparar um POST autenticado sem ler nada da resposta, e o token de CSRF era
 * a defesa.
 *
 * A partir da F2 a identidade vem de `Authorization: Bearer <token do GoTrue>`,
 * e a API RECUSA autenticacao por cookie — `middleware/isAuthenticated.js` le
 * exclusivamente aquele cabecalho e nao existe mais nenhum caminho que aceite
 * cookie. Um cabecalho tem de ser escrito por JavaScript da propria origem: o
 * site do atacante nao consegue anexa-lo, e a requisicao chega anonima. Sem
 * credencial ambiente, nao ha o que forjar.
 *
 * SE UM DIA ALGUMA ROTA VOLTAR A LER `req.cookies` PARA AUTENTICAR, o CSRF
 * volta junto — a protecao nao foi julgada desnecessaria, a superficie que ela
 * cobria e que deixou de existir. Pelo mesmo motivo o `cookie-parser` saiu:
 * nenhuma rota le cookie.
 */

// Rotas protegidas
app.use("/promotions", promotionsRoutes);
app.use(productsRoutes);
// So a exclusao da propria conta sobrou sob /auth — o resto virou GoTrue.
app.use("/auth", contaRoutes);
app.use("/options", optionsRoutes);
app.use(paymentRoutes);
app.use(addressRoutes);
// Cupons: /cupons/validar e publico (rate limit proprio, dentro da rota);
// o CRUD exige admin. Newsletter: publica, rate limit proprio.
app.use("/cupons", cuponsRoutes);
app.use("/newsletter", newsletterRoutes);
// LGPD: atendimento a titular (acesso e redacao), so admin.
app.use("/lgpd", lgpdRoutes);
// Bling: sincronizacao de pedido, NF-e e rastreio, so admin; ações exigem BLING_ATIVO.
app.use("/bling", blingRoutes);
// Clube: /clube/* (cliente), /admin/assinaturas (admin) e o webhook proprio de
// assinaturas (/webhook/mercadopago/assinaturas, rate limit dentro do router).
app.use(clubeRoutes);

/**
 * Carrinho abandonado: cron de hora em hora, DESLIGADO por padrao (decisao 5
 * do plano mestre — integracao nova nao pode quebrar nem surpreender a
 * subida). So ABANDONO_ATIVO=true literal liga; qualquer outra coisa, o
 * processo sobe identico ao de antes, sem nem carregar o node-cron.
 */
if (process.env.ABANDONO_ATIVO === "true") {
  require("./jobs/carrinhoAbandonado").iniciarCronDeAbandono();
}

// Bling: cron de rastreio (minuto 30), DESLIGADO por padrao — exige as DUAS.
if (process.env.BLING_ATIVO === "true" && process.env.BLING_RASTREIO_CRON === "true") {
  require("./services/blingPedidos").iniciarCronBling();
}

// Tratamento de erros gerais
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ message: "Erro interno no servidor." });
});

// Iniciar servidor
const server = app.listen(port, () => {
  console.log(
    `Servidor do Café Canastra na porta ${port} (${process.env.NODE_ENV || "development"})`,
  );
});

/**
 * Sobra algum caminho de verificacao de token? — e ja aquece o cache do JWKS.
 *
 * Fica DEPOIS do `listen` porque e a unica conferencia da subida que precisa de
 * rede: atrasar a porta por causa dela faria o health check do orquestrador
 * falhar enquanto o Kong ainda sobe, na mesma VPS. Quando a resposta e
 * definitiva ("nada aqui verifica nada"), o processo encerra — e a mesma
 * postura do `conferirAmbiente`: falhar no `npm start` e barato.
 */
require("./config/ambiente")
  .conferirCaminhosDeVerificacao()
  .catch((erro) => {
    console.error(erro.message);
    encerrar("configuração de verificação de token", 1);
  });

/**
 * Rede de seguranca do processo.
 *
 * Sem estes dois ouvintes, uma promessa rejeitada sem catch derruba o Node em
 * silencio a partir da v15 — a loja sai do ar sem deixar rastro no log de por
 * que. Registrar antes de sair transforma "o site caiu" em "o site caiu por
 * causa DISTO", que e a diferenca entre conseguir e nao conseguir consertar.
 */
process.on("unhandledRejection", (motivo) => {
  console.error("Promessa rejeitada sem tratamento:", motivo);
});

process.on("uncaughtException", (err) => {
  console.error("Exceção não capturada:", err);
  // Estado do processo e desconhecido a partir daqui: encerra de forma
  // ordenada e deixa o orquestrador subir um processo limpo.
  encerrar("uncaughtException", 1);
});

/** Encerramento ordenado: para de aceitar conexao e fecha o pool. */
function encerrar(sinal, codigo = 0) {
  console.log(`Encerrando (${sinal})...`);
  server.close(() => {
    pool
      .end()
      .catch((e) => console.error("Erro ao fechar o pool:", e.message))
      .finally(() => process.exit(codigo));
  });
  // Se as conexoes nao fecharem em 10s, sai assim mesmo — senao o deploy trava.
  setTimeout(() => process.exit(codigo), 10_000).unref();
}

process.on("SIGTERM", () => encerrar("SIGTERM"));
process.on("SIGINT", () => encerrar("SIGINT"));
