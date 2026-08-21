"use strict";

const { GRUPO_ATIVO, GRUPO_CANCELADO } = require("./statusDePedido");

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

/**
 * Os itens de um pedido como ARRAY, venham eles como jsonb já desserializado
 * (o caminho normal do node-postgres) ou como texto.
 *
 * O `contexto` só existe para o log: item ilegível é divergência de estoque
 * esperando para acontecer e precisa aparecer com o nome de quem leu. Lista
 * que não é array vira `[]` — a transição de status continua, o estoque é que
 * não se move sobre um dado que ninguém consegue interpretar.
 */
function lerItensDoPedido(itens, contexto = "Pedido") {
  if (typeof itens === "string") {
    try {
      const lidos = JSON.parse(itens);
      return Array.isArray(lidos) ? lidos : [];
    } catch (erro) {
      console.error(`${contexto}: itens do pedido ilegíveis:`, erro);
      return [];
    }
  }
  return Array.isArray(itens) ? itens : [];
}

/** O que `aplicarTransicaoDeEstoque` fez — o vocabulário dos dois chamadores. */
const DEVOLVEU = "devolveu";
const REBAIXOU = "rebaixou";

/**
 * A MOVIMENTAÇÃO DE ESTOQUE DE UMA TRANSIÇÃO DE STATUS, num lugar só.
 *
 * Duas travessias importam, e só duas:
 *
 *   ativo → cancelado   o pedido morreu; o café volta para a prateleira;
 *   cancelado → ativo   o pedido ressuscitou (um recusado que o MP reprocessa
 *                       e aprova); o café sai de novo, com GREATEST(0, ...)
 *                       porque a unidade pode já ter sido vendida nesse meio
 *                       tempo — estoque negativo mentiria pior que zero.
 *
 * Qualquer outra combinação (pendente→aprovado, aprovado→enviado, o reenvio
 * com o mesmo status) NÃO move estoque: quem reserva é o checkout, e o
 * webhook do Clube baixa na criação do pedido.
 *
 * Roda SEMPRE dentro da transação de quem chama (`client`), na MESMA que grava
 * o status — a movimentação e a transição commitam juntas ou não acontecem.
 * Itera em ordem canônica (ver `ordenarPorProduto`) e ignora item sem
 * `product_id`: café que saiu do catálogo não tem linha para atualizar.
 *
 * Devolve "devolveu" | "rebaixou" | null — o que aconteceu, para o chamador
 * decidir o que mais depende da mesma travessia (o uso do cupom, no
 * PaymentController) sem recalcular os grupos de status por conta própria.
 * Este módulo virou o dono da regra porque ela estava COPIADA em dois
 * controllers: um status novo em GRUPO_* exigia acertar os dois.
 */
async function aplicarTransicaoDeEstoque(client, itens, de, para) {
  const eraAtivo = GRUPO_ATIVO.includes(de);
  const eraCancelado = GRUPO_CANCELADO.includes(de);
  const ficouAtivo = GRUPO_ATIVO.includes(para);
  const ficouCancelado = GRUPO_CANCELADO.includes(para);

  const devolver = eraAtivo && ficouCancelado;
  const rebaixar = eraCancelado && ficouAtivo;
  if (!devolver && !rebaixar) return null;

  const comProduto = (Array.isArray(itens) ? itens : []).filter(
    (item) => item && item.product_id,
  );

  for (const item of ordenarPorProduto(comProduto)) {
    await client.query(
      devolver
        ? `UPDATE canastra.produtos SET quantidade = quantidade + $1
            WHERE produto_id = $2`
        : `UPDATE canastra.produtos
              SET quantidade = GREATEST(0, quantidade - $1)
            WHERE produto_id = $2`,
      [Number(item.quantity), item.product_id],
    );
  }

  return devolver ? DEVOLVEU : REBAIXOU;
}

module.exports = {
  ordenarPorProduto,
  lerItensDoPedido,
  aplicarTransicaoDeEstoque,
  DEVOLVEU,
  REBAIXOU,
};
