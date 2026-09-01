const { Router } = require("express");

const { lerVitrine, gravarVitrine } = require("../repositories/vitrineRepository");
const authenticateToken = require("../middleware/isAuthenticated");
const isAdmin = require("../middleware/isAdmin");

const vitrineRoutes = Router();

/**
 * O herói da home e a barra de aviso.
 *
 * O GET É PÚBLICO POR NATUREZA, como `/config` e o catálogo: a home é servida a
 * quem ainda não tem conta, e o herói é a primeira coisa que ela desenha. Uma
 * autenticação aqui não protegeria nada — o conteúdo já está na página que
 * qualquer um abre — e faria o topo da loja nascer vazio.
 *
 * O PUT LEVA OS DOIS GUARDAS, e a ordem entre eles importa: `isAdmin` lê
 * `req.user.ehAdmin`, que só existe depois de `authenticateToken` consultar
 * `canastra.admins`. Invertidos, `isAdmin` veria `req.user` indefinido e
 * responderia 403 a todo mundo — falha fechada, então o erro apareceria como
 * "o painel não salva", não como um vazamento.
 *
 * As funções entram no `Router` DIRETO, sem embrulhar num arrow: assim o nome
 * delas aparece em rastro de pilha e na inspeção do `router.stack`, que é o que
 * `test/vitrine_rotas.test.js` usa para provar que os guardas continuam na
 * frente do handler.
 */
vitrineRoutes.get("/", lerVitrine);
vitrineRoutes.put("/", authenticateToken, isAdmin, gravarVitrine);

module.exports = vitrineRoutes;
