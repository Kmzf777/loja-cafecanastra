const OrderRepository = require("../repositories/ordersRepository");
const pool = require("../pgPool");
const { sendStatusEmail } = require("../utils/emailSender");

/**
 * Status que um pedido pode assumir.
 *
 * `updateStatus` gravava a string crua do corpo da requisicao. Um erro de
 * digitacao no painel ("aprovado" em vez de "approved") gravava um status que
 * NENHUM dos grupos abaixo reconhece — e a partir dali o pedido nunca mais
 * devolvia estoque nem aparecia nos relatorios de venda, que filtram por
 * status conhecido. Sem lista fechada, o dado apodrece em silencio.
 */
const STATUS_VALIDOS = [
  "pending",
  "in_process",
  "authorized",
  "approved",
  "sent",
  "delivered",
  "cancelled",
  "rejected",
  "refunded",
];

/** Le page/limit da query com piso, teto e valor padrao. */
function paginacao(query) {
  const page = Math.max(1, Number.parseInt(query.page, 10) || 1);
  const limitBruto = Number.parseInt(query.limit, 10) || 10;
  // Teto de 100: sem ele, `?limit=100000` faz o banco montar a tabela inteira
  // em memoria e serializar tudo numa resposta.
  const limit = Math.min(100, Math.max(1, limitBruto));
  return { page, limit };
}

class OrderController {
  async getUserOrders(req, res) {
    try {
      const { userId } = req.user;
      const orders = await OrderRepository.getOrdersByUser(userId);
      return res.json(orders);
    } catch (error) {
      console.error("Erro ao buscar pedidos:", error);
      return res
        .status(500)
        .json({ error: "Erro ao buscar histórico de pedidos." });
    }
  }

  async getAllOrdersAdmin(req, res) {
    try {
      const { page, limit } = paginacao(req.query);
      const orders = await OrderRepository.getAllOrders(page, limit);
      return res.json(orders);
    } catch (error) {
      return res
        .status(500)
        .json({ error: "Erro ao buscar pedidos do admin." });
    }
  }

  async updateStatus(req, res) {
    const client = await pool.connect();
    try {
      const { id } = req.params;
      const { status: newStatus, trackingCode } = req.body;

      if (!STATUS_VALIDOS.includes(newStatus)) {
        return res.status(400).json({
          error: `Status inválido. Use um de: ${STATUS_VALIDOS.join(", ")}.`,
        });
      }

      const order = await OrderRepository.getOrderById(id);
      if (!order) {
        return res.status(404).json({ error: "Pedido não encontrado" });
      }

      // Devolver/retirar estoque e mudar o status precisam ser atomicos: sem
      // transacao, uma falha no meio deixava o estoque movimentado com o pedido
      // ainda no status antigo — e a proxima tentativa movimentava DE NOVO.
      await client.query("BEGIN");

      const currentStatus = order.status;
      /**
       * Grupos de status para o ajuste de estoque.
       *
       * `activeGroup` nao incluia "in_process" nem "authorized" — os dois
       * estados em que o Mercado Pago deixa um pagamento em analise. Como o
       * estoque e reservado no momento do checkout, cancelar um pedido que
       * estivesse num desses estados NAO devolvia nada: a unidade ficava
       * debitada para sempre, e o produto sumia do catalogo sem ter sido
       * vendido. Os dois estados agora contam como ativos, que e o que sao.
       *
       * A lista sai de STATUS_VALIDOS menos os cancelados, para as duas nao
       * poderem divergir de novo quando alguem acrescentar um status.
       */
      const cancelledGroup = ["cancelled", "rejected", "refunded"];
      const activeGroup = STATUS_VALIDOS.filter(
        (st) => !cancelledGroup.includes(st),
      );
      const isNowCancelled = cancelledGroup.includes(newStatus);
      const wasCancelled = cancelledGroup.includes(currentStatus);
      const isNowActive = activeGroup.includes(newStatus);
      const wasActive = activeGroup.includes(currentStatus);

      let items = order.items;
      if (typeof items === "string") {
        try {
          items = JSON.parse(items);
        } catch (e) {
          console.error("Erro ao parsear items do pedido:", e);
        }
      }

      if (wasActive && isNowCancelled) {
        if (Array.isArray(items)) {
          for (const item of items) {
            await client.query(
              `UPDATE products 
               SET quantity = quantity::integer + $1 
               WHERE product_id = $2`,
              [Number(item.quantity), item.product_id],
            );
          }
        }
      } else if (wasCancelled && isNowActive) {
        if (Array.isArray(items)) {
          for (const item of items) {
            await client.query(
              `UPDATE products 
               SET quantity = GREATEST(0, quantity::integer - $1) 
               WHERE product_id = $2`,
              [Number(item.quantity), item.product_id],
            );
          }
        }
      }

      const updated = await OrderRepository.updateOrderStatus(
        id,
        newStatus,
        trackingCode,
      );

      await client.query("COMMIT");

      // E-mail depois do COMMIT e sem travar a resposta: avisar o cliente e
      // importante, mas o provedor estar fora nao pode fazer o admin achar que
      // a mudanca de status falhou — ela ja esta gravada.
      sendStatusEmail(order, newStatus, trackingCode).catch((e) =>
        console.error("Falha ao enviar e-mail de status:", e.message),
      );

      return res.json(updated);
    } catch (error) {
      await client.query("ROLLBACK").catch(() => {});
      console.error("Erro ao atualizar status do pedido:", error);
      return res.status(500).json({ error: "Erro ao atualizar status." });
    } finally {
      client.release();
    }
  }
}

module.exports = new OrderController();
