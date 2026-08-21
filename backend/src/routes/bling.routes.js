"use strict";

/**
 * Rotas admin da integração Bling (onda 3G). Todas exigem
 * isAuthenticated + isAdmin: sincronizar, emitir nota e consultar rastreio
 * são gestos de GESTÃO — nenhum cliente da vitrine encosta aqui.
 *
 * Os handlers moram no próprio arquivo, e não num controller novo: são quatro
 * cascas finas sobre `services/blingPedidos` — a regra vive toda lá (e é lá
 * que os testes a exercitam); um controller só para repassar seria camada de
 * cerimônia.
 *
 * REGISTRO NO index.js (responsabilidade do orquestrador da onda — este
 * arquivo é compartilhado e não foi editado daqui):
 *
 *   const blingRoutes = require("./routes/bling.routes");
 *   app.use("/bling", blingRoutes);
 */

const { Router } = require("express");

const isAuthenticated = require("../middleware/isAuthenticated");
const isAdmin = require("../middleware/isAdmin");
const blingClient = require("../services/blingClient");
const blingPedidos = require("../services/blingPedidos");

const blingRoutes = Router();

const FORMATO_UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * As ações exigem BLING_ATIVO=true literal (decisão 5 do plano mestre). 503,
 * e não 404: a rota EXISTE, é a integração que está desligada — e a frase diz
 * exatamente qual variável liga.
 */
function blingLigado(req, res, next) {
  if (process.env.BLING_ATIVO !== "true") {
    return res.status(503).json({
      error: "BLING_DESLIGADO",
      message:
        "A integração com o Bling está desligada (BLING_ATIVO). Configure as " +
        "credenciais e ligue a variável — passo a passo em docs/bling.md.",
    });
  }
  return next();
}

/** O :id precisa ser UUID antes de qualquer ida ao banco (22P02 vira 400). */
function pedidoIdValido(req, res, next) {
  if (!FORMATO_UUID.test(String(req.params.id || ""))) {
    return res.status(400).json({ error: "Identificador de pedido inválido." });
  }
  return next();
}

/**
 * Tradução de erro para resposta: quem lança com intenção carrega
 * `erro.status` (404 pedido, 400 SKU, 409 corrida, 422 pedido redigido pela
 * LGPD, 504 Bling mudo ou prazo da sincronização estourado); erro vindo da API
 * do Bling carrega `statusBling` e vira 502 — o problema é do lado de lá, e a
 * mensagem (já legível, composta pelo blingClient) é para o gestor ler no
 * painel. O resto é 500 genérico, com o detalhe só no log.
 *
 * O 504 vale a distinção do 500: "o Bling não respondeu a tempo" é passageiro
 * e o botão do painel pode ser clicado de novo; "falha inesperada" manda o
 * gestor abrir chamado. Quem os separa é `erro.status`, posto lá no
 * blingClient/blingPedidos, onde se sabe o que aconteceu.
 */
function responderErro(res, erro, contexto) {
  console.error(`Bling (${contexto}):`, erro.message);
  if (erro.status) {
    return res.status(erro.status).json({
      error: erro.codigoPublico || "BLING_FALHOU",
      message: erro.message,
    });
  }
  if (erro.statusBling) {
    return res.status(502).json({ error: "BLING_FALHOU", message: erro.message });
  }
  return res.status(500).json({
    error: "BLING_FALHOU",
    message: "Falha inesperada na integração com o Bling. Veja o log do servidor.",
  });
}

/**
 * GET /bling/status — a sonda do painel: config presente? token renova?
 * Responde SEMPRE, ligado ou não — é o endpoint que diagnostica o desligado.
 * A sonda só vai à rede quando há credencial (blingClient.sondar decide).
 */
blingRoutes.get("/status", isAuthenticated, isAdmin, async (req, res) => {
  const sonda = await blingClient.sondar();
  return res.json({
    ativo: process.env.BLING_ATIVO === "true",
    nfeAuto: process.env.BLING_NFE_AUTO === "true",
    rastreioCron: process.env.BLING_RASTREIO_CRON === "true",
    ...sonda,
  });
});

/** POST /bling/pedidos/:id/sincronizar — reenvio manual pelo painel. */
blingRoutes.post(
  "/pedidos/:id/sincronizar",
  isAuthenticated,
  isAdmin,
  blingLigado,
  pedidoIdValido,
  async (req, res) => {
    try {
      const { jaSincronizado, blingId, pedido } =
        await blingPedidos.sincronizarPedido(req.params.id);
      return res.json({
        message: jaSincronizado
          ? "Este pedido já estava sincronizado com o Bling."
          : "Pedido sincronizado com o Bling.",
        jaSincronizado,
        blingId,
        pedido,
      });
    } catch (erro) {
      return responderErro(res, erro, `sincronizar ${req.params.id}`);
    }
  },
);

/** POST /bling/pedidos/:id/nfe — emissão manual da NF-e. */
blingRoutes.post(
  "/pedidos/:id/nfe",
  isAuthenticated,
  isAdmin,
  blingLigado,
  pedidoIdValido,
  async (req, res) => {
    try {
      const { jaEmitida, pedido } = await blingPedidos.emitirNfe(req.params.id);
      return res.json({
        message: jaEmitida
          ? "A NF-e deste pedido já tinha sido emitida."
          : "NF-e gerada e transmitida pelo Bling.",
        jaEmitida,
        pedido,
      });
    } catch (erro) {
      return responderErro(res, erro, `nfe ${req.params.id}`);
    }
  },
);

/** POST /bling/pedidos/:id/rastreio — busca manual do rastreio no Bling. */
blingRoutes.post(
  "/pedidos/:id/rastreio",
  isAuthenticated,
  isAdmin,
  blingLigado,
  pedidoIdValido,
  async (req, res) => {
    try {
      const { rastreio, pedido } = await blingPedidos.consultarRastreio(
        req.params.id,
      );
      return res.json({
        message: rastreio
          ? "Rastreio do Bling gravado no pedido."
          : "O Bling ainda não tem código de rastreio para este pedido.",
        rastreio,
        pedido,
      });
    } catch (erro) {
      return responderErro(res, erro, `rastreio ${req.params.id}`);
    }
  },
);

module.exports = blingRoutes;
