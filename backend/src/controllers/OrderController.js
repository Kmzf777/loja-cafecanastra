const OrderRepository = require("../repositories/ordersRepository");
const pool = require("../pgPool");
const { sendStatusEmail } = require("../utils/emailSender");
const {
  STATUS_VALIDOS,
  GRUPO_ATIVO,
  GRUPO_CANCELADO,
} = require("../utils/statusDePedido");
const { ordenarPorProduto } = require("../utils/estoque");

/**
 * Os status validos vem do modulo unico (`utils/statusDePedido`), que e o
 * mesmo que o CHECK da migracao 0009 fixa — em portugues, decisao 1 do plano
 * mestre. O painel legado ainda envia o vocabulario antigo do MP ate a Onda
 * 2E; ate la, um `pending` responde 400 com a lista certa na mensagem, que e
 * o comportamento honesto (gravar traduzindo em silencio esconderia que o
 * painel esta desatualizado).
 */

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
      console.error("Erro ao buscar pedidos do admin:", error);
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

      /**
       * Devolver/retirar estoque e mudar o status precisam ser atomicos, e
       * agora SAO: a leitura do pedido entra na mesma transacao, com FOR
       * UPDATE (a versao anterior lia fora e atualizava o status por OUTRA
       * conexao — a transacao de estoque nao cobria o proprio UPDATE de
       * status, e uma falha no meio movimentava estoque DE NOVO na proxima
       * tentativa).
       */
      await client.query("BEGIN");

      const { rows } = await client.query(
        `SELECT pedido_id AS order_id, status, itens AS items, user_id,
                total AS total_amount
           FROM canastra.pedidos
          WHERE pedido_id = $1::uuid
            FOR UPDATE`,
        [id],
      );
      if (!rows.length) {
        await client.query("ROLLBACK");
        return res.status(404).json({ error: "Pedido não encontrado" });
      }
      const order = rows[0];
      const currentStatus = order.status;

      const isNowCancelled = GRUPO_CANCELADO.includes(newStatus);
      const wasCancelled = GRUPO_CANCELADO.includes(currentStatus);
      const isNowActive = GRUPO_ATIVO.includes(newStatus);
      const wasActive = GRUPO_ATIVO.includes(currentStatus);

      let items = order.items;
      if (typeof items === "string") {
        try {
          items = JSON.parse(items);
        } catch (e) {
          console.error("Erro ao parsear items do pedido:", e);
        }
      }

      // Ordem canonica nas travas de estoque (ver utils/estoque.js): o painel
      // mudando um pedido enquanto um checkout reserva os mesmos produtos em
      // ordem oposta seria deadlock 40P01.
      if (wasActive && isNowCancelled) {
        if (Array.isArray(items)) {
          for (const item of ordenarPorProduto(items)) {
            await client.query(
              `UPDATE canastra.produtos
                  SET quantidade = quantidade + $1
                WHERE produto_id = $2`,
              [Number(item.quantity), item.product_id],
            );
          }
        }
      } else if (wasCancelled && isNowActive) {
        if (Array.isArray(items)) {
          for (const item of ordenarPorProduto(items)) {
            // GREATEST(0, ...): a unidade devolvida pode ja ter sido vendida;
            // estoque negativo mentiria pior que zero.
            await client.query(
              `UPDATE canastra.produtos
                  SET quantidade = GREATEST(0, quantidade - $1)
                WHERE produto_id = $2`,
              [Number(item.quantity), item.product_id],
            );
          }
        }
      }

      const updated = await OrderRepository.updateOrderStatus(
        id,
        newStatus,
        trackingCode,
        client,
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
