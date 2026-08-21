"use strict";

const { Router } = require("express");
const rateLimit = require("express-rate-limit");

const ClubeController = require("../controllers/ClubeController");
const isAuthenticated = require("../middleware/isAuthenticated");
const isAdmin = require("../middleware/isAdmin");

/**
 * Clube da Canastra — assinatura recorrente (Onda 3J).
 *
 * REGISTRO: `backend/src/index.js` monta este router com
 *
 *   const clubeRoutes = require("./routes/clube.routes");
 *   app.use(clubeRoutes);
 *
 * Os paths daqui já são absolutos (/clube/*, /admin/assinaturas,
 * /webhook/mercadopago/assinaturas), então o mount é sem prefixo — mesmo
 * desenho de orders.routes.js.
 */
const clubeRoutes = Router();

/**
 * O webhook de ASSINATURAS é público por natureza (quem chama é o MP) e
 * separado do de pagamentos avulsos de propósito: a `notification_url` de
 * cada preapproval aponta para cá, então tudo daquela assinatura chega aqui
 * sem o webhook antigo precisar distinguir os dois mundos. Autentica por
 * HMAC (a MESMA validarAssinaturaWebhook) e leva o mesmo teto do
 * webhookLimiter do index.js, pelo mesmo motivo: cada notificação dispara
 * consulta à API do MP, e endpoint público que custa rede não fica sem teto.
 */
const webhookAssinaturasLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 120,
  message: { error: "Muitas notificações." },
});

clubeRoutes.post(
  "/webhook/mercadopago/assinaturas",
  webhookAssinaturasLimiter,
  ClubeController.webhook,
);

/**
 * Teto do assinar. Não é anti-abuso genérico: cada POST que passa CRIA um
 * preapproval no Mercado Pago e grava linha no banco, então uma repetição
 * boba (o duplo clique de um botão que demora, um script) enche a conta do MP
 * de preapprovals pendentes que ninguém autoriza. 10/min por IP é folgado
 * para uma pessoa assinando (uma adesão leva minutos de wizard) e apertado
 * para um laço — o mesmo espírito do teto de /cupons/validar.
 */
const assinarLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  message: { error: "Muitas tentativas de assinatura. Aguarde um instante." },
});

// Assinar exige conta: a assinatura precisa de dono (pedidos recorrentes,
// cancelamento pela conta). O preço com -10% é recalculado no SERVIDOR.
clubeRoutes.post(
  "/clube/assinar",
  assinarLimiter,
  isAuthenticated,
  ClubeController.assinar,
);

// As assinaturas do dono — quem decide "dono" é o token, nunca o corpo.
clubeRoutes.get(
  "/clube/assinaturas",
  isAuthenticated,
  ClubeController.listarDoCliente,
);

// Cancela no MP e localmente, nesta ordem (ver ClubeController.cancelar).
clubeRoutes.post(
  "/clube/assinaturas/:id/cancelar",
  isAuthenticated,
  ClubeController.cancelar,
);

// A lista do painel, com os dados do cliente.
clubeRoutes.get(
  "/admin/assinaturas",
  isAuthenticated,
  isAdmin,
  ClubeController.listarTodas,
);

module.exports = clubeRoutes;
