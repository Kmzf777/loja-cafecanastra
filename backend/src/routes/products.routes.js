const { Router } = require("express");

const { upload } = require("../middleware/multer");
const DashboardRepository = require("../repositories/dashboardRepository");
const DashboardController = require("../controllers/DashboardController");
const ConfigController = require("../controllers/ConfigController");

const authenticateToken = require("../middleware/isAuthenticated");
const isAdmin = require("../middleware/isAdmin");

const productsRoutes = Router();
const dashboardRepository = new DashboardRepository();
const dashboardController = new DashboardController();

productsRoutes.get(
  "/dashboard/summary",
  authenticateToken,
  isAdmin,
  async (request, response) => {
    await dashboardController.getSummary(request, response);
  }
);

productsRoutes.get("/dashboard", async (request, response) => {
  await dashboardRepository.getProducts(request, response);
});

productsRoutes.get("/dashboard/:id", async (request, response) => {
  await dashboardRepository.getProductById(request, response);
});

productsRoutes.get("/config", ConfigController.getConfig);

productsRoutes.post(
  "/dashboard",
  authenticateToken,
  isAdmin,
  upload.single("image"),
  async (request, response) => {
    await dashboardRepository.createProduct(request, response);
  }
);

productsRoutes.delete(
  "/dashboard/:id",
  authenticateToken,
  isAdmin,
  async (request, response) => {
    await dashboardRepository.deleteProduct(request, response);
  }
);

productsRoutes.put(
  "/dashboard/:id",
  authenticateToken,
  isAdmin,
  upload.single("image"),
  async (request, response) => {
    await dashboardRepository.editProduct(request, response);
  }
);

productsRoutes.put(
  "/config",
  authenticateToken,
  isAdmin,
  upload.fields([
    { name: "banner_desktop", maxCount: 1 },
    { name: "banner_mobile", maxCount: 1 },
  ]),
  ConfigController.updateConfig
);

/**
 * Ajuste de estoque, sozinho — ACRESCENTADA NO FIM.
 *
 * A ordem de registro deste arquivo é load-bearing: `/dashboard/summary` está
 * registrada ANTES de `/dashboard/:id` porque o Express casa na ordem, e
 * invertidas o summary viraria um produto de id "summary" e responderia 404
 * PÚBLICO — a rota administrativa desaparecendo sem 401 e sem erro. Esta linha
 * entra no fim e não desloca nada; `/dashboard/:id/estoque` tem sufixo próprio
 * e não colide com `/dashboard/:id`.
 *
 * SEM `upload` NO MEIO, e é o ponto da rota: o único caminho para corrigir o
 * estoque era o `PUT /dashboard/:id` multipart, que reenviava o formulário
 * inteiro — imagem incluída — e apagava as medidas do pacote pelo caminho.
 * JSON puro, um campo, nenhum efeito colateral.
 */
productsRoutes.patch(
  "/dashboard/:id/estoque",
  authenticateToken,
  isAdmin,
  async (request, response) => {
    await dashboardRepository.ajustarEstoque(request, response);
  }
);

module.exports = productsRoutes;
