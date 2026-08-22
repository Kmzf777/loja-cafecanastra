"use strict";

/**
 * As rotas do PAINEL do WhatsApp — no molde de `bling.routes.js`, que é o
 * precedente desta casa para integração operada pelo gestor.
 *
 * TODAS EXIGEM `isAuthenticated` E DEPOIS `isAdmin`, E A ORDEM É A DEFESA.
 * `isAdmin` lê `req.user.ehAdmin`, que só existe depois de `isAuthenticated`
 * ter conferido o token E o vínculo no banco. Montada fora de ordem, a rota
 * fica INACESSÍVEL em vez de aberta (`isAdmin.js` falha fechado, 403 sem
 * `req.user`) — o lado certo do erro, mas ainda assim um erro. Colar um
 * `whatsappRoutes.get(...)` aqui sem os dois é o único jeito de abrir uma
 * porta administrativa neste arquivo, e `test/whatsapp_rotas.test.js` percorre
 * `whatsappRoutes.stack` afirmando os dois, na ordem, em TODA rota montada —
 * sem citar os nomes uma a uma, para uma rota nova nascer coberta.
 *
 * O WEBHOOK DA META NÃO ESTÁ AQUI, e a ausência é deliberada. Ele continua
 * montado em `index.js` porque depende de duas coisas que só existem lá: o
 * `express.json({ verify })` que preserva o corpo CRU (sem ele não há como
 * recalcular o HMAC) e o `whatsappLimiter` próprio, de 600/min. Repetir o
 * `GET /webhook` e o `POST /webhook` neste roteador criaria uma SEGUNDA
 * definição da rota mais sensível do bot — a que qualquer um na internet
 * alcança — sem limite de taxa, sombreada pela de `index.js` só enquanto
 * ninguém reordenasse os `app.use`. Uma rota de segurança definida em dois
 * lugares é uma que um dia diverge.
 *
 * REGISTRO NO index.js:
 *
 *   const whatsappRoutes = require("./routes/whatsapp.routes");
 *   app.use("/whatsapp", whatsappRoutes);
 *
 * NADA DE CABEÇALHO NOVO: `allowedHeaders` é
 * `["Content-Type", "Authorization", "Accept"]` (`index.js:87`), e um
 * cabeçalho fora da lista quebra o preflight de CORS antes de a requisição
 * chegar aqui. O corpo do PUT cabe no teto global de 256 KB com folga — a
 * exceção de 3 MB vale só no webhook.
 */

const { Router } = require("express");

const isAuthenticated = require("../middleware/isAuthenticated");
const isAdmin = require("../middleware/isAdmin");
const WhatsappController = require("../controllers/WhatsappController");

const whatsappRoutes = Router();

/**
 * A sonda do painel. Responde SEMPRE, ligada ou não: é o endpoint que
 * DIAGNOSTICA o desligado, então ele é o único que não pode ser fechado pelo
 * 503 que as ações devolvem (`bling.routes.js` faz igual com `/bling/status`).
 */
whatsappRoutes.get("/status", isAuthenticated, isAdmin, WhatsappController.status);

/** A credencial: o GET devolve MÁSCARA, o PUT grava só a lista permitida. */
whatsappRoutes.get("/config", isAuthenticated, isAdmin, WhatsappController.lerConfig);
whatsappRoutes.put("/config", isAuthenticated, isAdmin, WhatsappController.gravarConfig);

/** O histórico do que saiu — sem telefone completo e sem wamid. */
whatsappRoutes.get("/mensagens", isAuthenticated, isAdmin, WhatsappController.historico);

/** Os templates: o estado de cada um na Meta, e o botão que os cria lá. */
whatsappRoutes.get("/templates", isAuthenticated, isAdmin, WhatsappController.lerTemplates);
whatsappRoutes.post("/templates", isAuthenticated, isAdmin, WhatsappController.criarTemplates);

/** O envio de teste, para validar a instalação antes do primeiro pedido. */
whatsappRoutes.post("/teste", isAuthenticated, isAdmin, WhatsappController.enviarTeste);

module.exports = whatsappRoutes;
