const { Router } = require("express");

const DashboardRepository = require("../repositories/dashboardRepository");
const avaliacoesRepository = require("../repositories/avaliacoesRepository");

const isAuthenticated = require("../middleware/isAuthenticated");
const isAdmin = require("../middleware/isAdmin");

const painelRoutes = Router();
const dashboardRepository = new DashboardRepository();

/**
 * As rotas do PAINEL que não cabem em nenhum router existente: o custo do
 * produto e a moderação de avaliações.
 *
 * TODAS EXIGEM ADMIN, e nenhuma delas é a metade administrativa de uma rota
 * pública — é por isso que elas vivem aqui e não dentro de `products.routes.js`
 * ou de uma tela do PostgREST. As cinco rotas de leitura PÚBLICAS da API
 * (`GET /dashboard`, `/dashboard/:id`, `/config`, `/promotions`, `/options`)
 * continuam públicas: a vitrine as consome em Server Component, sem sessão, e
 * "consertá-las" com `isAdmin` derrubaria a loja. Quando incomoda expor algo
 * por elas — `custo` é o caso —, a saída é uma rota admin NOVA, que é esta.
 *
 * OS CAMINHOS SÃO ABSOLUTOS (`/admin/...`) e o router é montado sem prefixo,
 * como `orders.routes.js`. E ele entra NO FIM de `index.js`: a ordem de
 * registro é load-bearing nesta API — três pares já quebram se invertidos
 * (`/dashboard/summary` antes de `/dashboard/:id`, `/admin/orders/export` antes
 * de `/admin/orders/:id`, `/users/me` antes de `/users/:id`) — e acrescentar no
 * fim é o que garante não mexer em nenhum deles. Nada aqui tem `:id` na raiz de
 * um caminho que já exista, então este router não forma par novo com ninguém.
 *
 * Os guardas vêm nesta ordem porque `isAdmin` lê `req.user.ehAdmin`, que só
 * existe depois de `isAuthenticated` consultar `canastra.admins`. Invertidos,
 * `isAdmin` veria `req.user` indefinido e responderia 403 a todo mundo — falha
 * fechada, então o erro apareceria como "o painel não abre" e não como
 * vazamento.
 */

/* --------------------------------------------------------------------------
 * Custo do produto — a coluna que a 0006 escondeu de `authenticated`
 * -------------------------------------------------------------------------- */

painelRoutes.get(
  "/admin/produtos/:id/custo",
  isAuthenticated,
  isAdmin,
  (req, res) => dashboardRepository.getCusto(req, res),
);

painelRoutes.patch(
  "/admin/produtos/:id/custo",
  isAuthenticated,
  isAdmin,
  (req, res) => dashboardRepository.atualizarCusto(req, res),
);

/* --------------------------------------------------------------------------
 * Avaliações — um modelo de acesso só
 * -------------------------------------------------------------------------- */

painelRoutes.get("/admin/avaliacoes", isAuthenticated, isAdmin, async (req, res) => {
  try {
    return res.json(await avaliacoesRepository.listar(req.query));
  } catch (erro) {
    if (erro.status === 400) return res.status(400).json({ error: erro.message });
    console.error("Erro ao listar avaliações:", erro);
    return res.status(500).json({ error: "Erro ao listar avaliações." });
  }
});

/**
 * `PATCH` no COLETIVO (`/admin/avaliacoes`, sem `:id`) porque a operação é
 * sobre um conjunto: a fila de moderação se resolve marcando várias e clicando
 * uma vez. Uma rota `/:id` obrigaria a N requisições para um gesto só, e cada
 * uma poderia falhar sozinha — deixando metade da fila moderada sem que a tela
 * soubesse dizer qual metade.
 */
painelRoutes.patch("/admin/avaliacoes", isAuthenticated, isAdmin, async (req, res) => {
  try {
    const { ids, status } = req.body || {};
    const resultado = await avaliacoesRepository.moderar({
      ids,
      status,
      adminUserId: req.user?.userId ?? null,
    });
    return res.json(resultado);
  } catch (erro) {
    if (erro.status === 400) return res.status(400).json({ error: erro.message });
    console.error("Erro ao moderar avaliações:", erro);
    return res.status(500).json({ error: "Erro ao moderar avaliações." });
  }
});

module.exports = painelRoutes;
