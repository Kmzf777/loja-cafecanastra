"use strict";

/**
 * O vocabulário de status de pedido, em português — decisão 1 do plano mestre
 * (docs/superpowers/plans/2026-08-20-plano-mestre-pendencias.md).
 *
 * A lista vive num módulo próprio porque três lugares diferentes precisam
 * EXATAMENTE dela: o CHECK da migração 0009 (que é quem manda), o
 * OrderController (que valida o que o painel envia) e o webhook do Mercado
 * Pago (que traduz o status do gateway antes de gravar). Duas listas
 * divergindo aqui não dão erro — dão pedido que some de filtro e estoque que
 * nunca volta, como o comentário de 0005 já avisava sobre o texto livre.
 */

const STATUS_VALIDOS = Object.freeze([
  "pendente",
  "aprovado",
  "em_processamento",
  "autorizado",
  "enviado",
  "entregue",
  "cancelado",
  "rejeitado",
  "reembolsado",
]);

/**
 * Os status que significam "esta venda não vale mais": o estoque reservado no
 * checkout volta para a prateleira. Tudo que não está aqui é do grupo ATIVO.
 */
const GRUPO_CANCELADO = Object.freeze(["cancelado", "rejeitado", "reembolsado"]);

/** Derivado, e não escrito à mão, para as duas listas não divergirem. */
const GRUPO_ATIVO = Object.freeze(
  STATUS_VALIDOS.filter((s) => !GRUPO_CANCELADO.includes(s)),
);

/**
 * Tradução do status do Mercado Pago para o vocabulário da loja.
 *
 * `in_mediation` e `charged_back` NÃO estão na lista fixada pelo plano mestre,
 * mas EXISTEM na API do MP. Deixá-los sem mapa faria o webhook tentar gravar a
 * string crua, esbarrar no CHECK de 0009 com 23514 e responder 500 — e o MP
 * reenvia diante de erro, então seria um retry infinito. A leitura escolhida:
 * mediação é um pagamento em disputa, ainda em aberto (`em_processamento`);
 * chargeback é dinheiro devolvido ao cliente (`reembolsado`).
 */
const DE_STATUS_MP = Object.freeze({
  pending: "pendente",
  approved: "aprovado",
  in_process: "em_processamento",
  in_mediation: "em_processamento",
  authorized: "autorizado",
  cancelled: "cancelado",
  rejected: "rejeitado",
  refunded: "reembolsado",
  charged_back: "reembolsado",
});

/**
 * Devolve o status em português, ou `null` quando o MP inventar um estado que
 * este mapa não conhece. Quem chama decide o que fazer com o `null` — no
 * webhook, é warn no log + 200 sem efeito, nunca gravar a string crua.
 */
function traduzirStatusMp(statusMp) {
  return DE_STATUS_MP[String(statusMp || "").toLowerCase()] || null;
}

module.exports = {
  STATUS_VALIDOS,
  GRUPO_CANCELADO,
  GRUPO_ATIVO,
  DE_STATUS_MP,
  traduzirStatusMp,
};
