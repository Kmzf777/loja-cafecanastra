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
 * Vale para TODO lugar que trava/movimenta estoque em lote: o checkout (FOR
 * UPDATE + reserva), o webhook do Mercado Pago, o webhook do Clube e o painel
 * do admin (mudança manual de status). Um módulo só, para eles nunca
 * divergirem — e desde a revisão de dinheiro os três últimos não chamam nem
 * esta função diretamente: chamam `aplicarTransicaoDeEstoque`, que já itera
 * nesta ordem. Quem ainda a usa sozinho é o checkout, que ordena os itens
 * ANTES de travar, e não uma transição de status.
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

/** O que `aplicarTransicaoDeEstoque` fez — o vocabulário dos chamadores. */
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
 * PaymentController e no OrderController) sem recalcular os grupos de status
 * por conta própria.
 *
 * OS TRÊS CHAMADORES: o webhook do Mercado Pago (PaymentController), o webhook
 * do Clube (ClubeController) e o painel do admin (OrderController.updateStatus).
 * Este módulo virou o dono da regra porque ela estava COPIADA em controllers
 * diferentes: um status novo em GRUPO_* exigia acertar todos. O painel foi o
 * último a entrar — a cópia dele coincidia nas regras de estoque e DIVERGIA no
 * que vinha depois (não devolvia o uso do cupom), que é precisamente o tipo de
 * divergência que a cópia esconde.
 */
async function aplicarTransicaoDeEstoque(client, itens, de, para) {
  const eraAtivo = GRUPO_ATIVO.includes(de);
  const eraCancelado = GRUPO_CANCELADO.includes(de);
  const ficouAtivo = GRUPO_ATIVO.includes(para);
  const ficouCancelado = GRUPO_CANCELADO.includes(para);

  const devolver = eraAtivo && ficouCancelado;
  const rebaixar = eraCancelado && ficouAtivo;
  if (!devolver && !rebaixar) return null;

  /**
   * DUAS EXCLUSÕES, E A SEGUNDA É A QUE FECHA UM ROMBO REAL.
   *
   * `product_id` ausente: café que saiu do catálogo não tem linha para
   * atualizar (era o único filtro até a revisão transversal da F7).
   *
   * `sem_reserva`: o item NUNCA saiu da prateleira, então não pode voltar para
   * ela. Quem marca é o webhook do Clube (ver ClubeController.aplicarCobranca):
   * quando falta café, a cobrança vira pedido MESMO ASSIM — o dinheiro já saiu
   * do cliente — e o pedido nasce sem baixa nenhuma. Sem esta linha, o gestor
   * que fizesse o que o próprio e-mail de alerta manda (estornar no painel do
   * MP) faria o webhook aplicar ativo→cancelado e DEVOLVER unidades
   * inexistentes: o caminho de recuperação recomendado inflava o estoque.
   *
   * A exclusão vale para as DUAS travessias de propósito. Pular só a devolução
   * e deixar a ressurreição (cancelado→ativo) rebaixar trocaria estoque
   * inflado por estoque sumido, porque o pedido continuaria marcado e o
   * cancelamento seguinte não devolveria o que essa baixa tirou. O invariante é
   * "pedido marcado não move estoque", ponto — a conta dele é do gestor, que
   * separa o café ou estorna com o alerta na mão.
   */
  const comProduto = (Array.isArray(itens) ? itens : []).filter(
    (item) => item && item.product_id && item.sem_reserva !== true,
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
