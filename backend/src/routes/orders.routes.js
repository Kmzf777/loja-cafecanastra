const PaymentController = require("../controllers/PaymentController");
const { Router } = require("express");
const paymentRoutes = Router();
const isAuthenticated = require("../middleware/isAuthenticated");
const isAdmin = require("../middleware/isAdmin");
const OrderController = require("../controllers/OrderController");

paymentRoutes.post(
  "/checkout/process_payment",
  isAuthenticated,
  PaymentController.createPayment
);

paymentRoutes.get("/my-orders", isAuthenticated, OrderController.getUserOrders);

// Detalhe de UM pedido: dono OU admin; o resto recebe 404 (nunca 403 — ver
// o comentário em OrderController.getOrderDetail).
paymentRoutes.get(
  "/my-orders/:id",
  isAuthenticated,
  OrderController.getOrderDetail
);

// Rotas ADMIN
paymentRoutes.get(
  "/admin/orders",
  isAuthenticated,
  isAdmin,
  OrderController.getAllOrdersAdmin
);

// ANTES de qualquer futura "/admin/orders/:id": o Express casa na ordem de
// registro, e "export" cairia como id.
paymentRoutes.get(
  "/admin/orders/export",
  isAuthenticated,
  isAdmin,
  OrderController.exportOrdersCsv
);
paymentRoutes.put(
  "/admin/orders/:id/status",
  isAuthenticated,
  isAdmin,
  OrderController.updateStatus
);

module.exports = paymentRoutes;
