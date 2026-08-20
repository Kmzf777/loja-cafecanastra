"use strict";

/**
 * Ordena itens pelo `product_id` antes de qualquer sequência de travas ou
 * UPDATEs de estoque dentro de uma transação.
 *
 * O motivo é deadlock: dois pedidos com os mesmos produtos em ordens opostas
 * (A trava café-1 e espera café-2; B trava café-2 e espera café-1) morreriam
 * em 40P01 — o Postgres mata um dos dois e o cliente vê um 500 aleatório em
 * horário de pico, o pior tipo de bug para reproduzir. Com ordem canônica,
 * quem chega segundo espera na PRIMEIRA linha em comum e segue em fila.
 *
 * Vale para os três lugares que travam/movimentam estoque em lote: o checkout
 * (FOR UPDATE + reserva), o webhook (devolução/retirada) e o painel do admin
 * (mudança manual de status). Um módulo só, para os três nunca divergirem.
 */
function ordenarPorProduto(itens) {
  return [...itens].sort((a, b) =>
    String(a.product_id).localeCompare(String(b.product_id)),
  );
}

module.exports = { ordenarPorProduto };
