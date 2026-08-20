const { Router } = require("express");
const rateLimit = require("express-rate-limit");

const CuponsController = require("../controllers/CuponsController");
const isAuthenticated = require("../middleware/isAuthenticated");
const isAdmin = require("../middleware/isAdmin");

const cuponsRoutes = Router();

/**
 * A validação é pública por natureza — o campo de cupom aparece no checkout
 * antes de qualquer conferência — e é exatamente por isso que leva teto: cada
 * chamada custa uma consulta de catálogo + promoções, e um laço tentando
 * códigos em sequência é um dicionário de força bruta contra os cupons da
 * loja. 30/min por IP segue o padrão do freteLimiter (index.js).
 */
const validarLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  message: { error: "Muitas tentativas de cupom. Aguarde um instante." },
});

cuponsRoutes.post("/validar", validarLimiter, CuponsController.validar);

// O CRUD é do painel. NÃO há DELETE de propósito: cupom já divulgado se
// desativa (PUT { ativo: false }) — apagar e recriar o código herdaria o
// histórico de usos de outra campanha.
cuponsRoutes.get("/", isAuthenticated, isAdmin, CuponsController.listar);
cuponsRoutes.post("/", isAuthenticated, isAdmin, CuponsController.criar);
cuponsRoutes.put("/:id", isAuthenticated, isAdmin, CuponsController.atualizar);

module.exports = cuponsRoutes;
