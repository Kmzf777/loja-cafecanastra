require("dotenv").config({ path: "./src/.env" });

const express = require("express");
const helmet = require("helmet");
const cors = require("cors");
const cookieParser = require("cookie-parser");
const csrf = require("csurf");

const productsRoutes = require("./routes/products.routes");
const loginRoutes = require("./routes/login.routes");
const optionsRoutes = require("./routes/options.routes");
const promotionsRoutes = require("./routes/promotions.routes");
const cartRoutes = require("./routes/cart.routes");
const paymentRoutes = require("./routes/orders.routes");
const addressRoutes = require("./routes/address.routes");
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

const allowedOrigins = [
  "https://www.shopnaw.com.br",
  "https://shopnaw.com.br",
  "https://shopnaw-web.onrender.com",
  "http://localhost:5173",
  // A vitrine migrou de Vite (5173) para Next (3000) e o painel passou a ser
  // servido pelo Next junto com ela. Sem esta origem, toda chamada do painel
  // morre no CORS antes de chegar numa rota.
  "http://localhost:3000",
  "http://127.0.0.1:3000",
  process.env.CORS_ORIGIN,
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
    allowedHeaders: ["Content-Type", "X-CSRF-Token", "Authorization", "Accept"],
    credentials: true,
  }),
);

app.options("*", (req, res) => res.sendStatus(200));

// Middleware essenciais
app.use(express.json({ limit: "10mb" }));
app.use(cookieParser());
app.use(express.urlencoded({ limit: "10mb", extended: true }));

// Pasta pública de uploads
app.use("/uploads", express.static("uploads"));

app.post("/webhook/mercadopago", PaymentController.receiveWebhook);
app.post("/shipping/calculate", ShippingController.calculate);

// CSRF protection via cookie.
//
// `secure: true` + `SameSite=None` e obrigatorio em producao, onde front e back
// vivem em dominios diferentes sob HTTPS. Em desenvolvimento e o oposto: o
// navegador DESCARTA silenciosamente um cookie `Secure` vindo de
// http://localhost, entao o backend nunca reconhece o token que ele mesmo
// emitiu e todo POST — inclusive o login — responde 403 "Formulario expirado".
// Nada no log denuncia isso; o cookie simplesmente nao existe.
const csrfProtection = csrf({
  cookie: {
    httpOnly: true,
    secure: isProd,
    sameSite: isProd ? "None" : "Lax",
    signed: false,
  },
});

app.use(csrfProtection);

// Rota para fornecer o token CSRF ao frontend
app.get("/csrf-token", (req, res) => {
  res.json({ csrfToken: req.csrfToken() });
});

// Rotas protegidas
app.use("/promotions", promotionsRoutes);
app.use("/cart", cartRoutes);
app.use(productsRoutes);
app.use("/auth", loginRoutes);
app.use("/options", optionsRoutes);
app.use(paymentRoutes);
app.use(addressRoutes);

// Tratamento de erros gerais e CSRF
app.use((err, req, res, next) => {
  if (err.code === "EBADCSRFTOKEN") {
    console.warn("Bloqueio CSRF detectado. Headers:", req.headers.origin);
    return res
      .status(403)
      .json({ message: "Formulário expirado ou inválido. Tente novamente." });
  }
  console.error(err);
  res.status(500).json({ message: "Erro interno no servidor." });
});

// Iniciar servidor
app.listen(port, () => {
  console.log(`Servidor está rodando na porta ${port}`);
});
