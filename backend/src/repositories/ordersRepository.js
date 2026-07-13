const pool = require("../pgPool");
const { v4: uuidv4 } = require("uuid");

class OrderRepository {
  async createOrder({
    userId,
    totalAmount,
    items,
    paymentMethod,
    paymentIdMp,
    address_json,
    shippingCost,
    shippingMethod,
  }) {
    const client = await pool.connect();
    try {
      const orderId = uuidv4();

      const query = `
        INSERT INTO orders 
        (order_id, user_id, total_amount, status, payment_method, payment_id_mp, items, address_json, shipping_cost, shipping_method)
        VALUES ($1::uuid, $2::uuid, $3, 'pending', $4, $5, $6, $7, $8, $9)
        RETURNING *
      `;

      const values = [
        orderId,
        userId,
        totalAmount,
        paymentMethod,
        paymentIdMp,
        JSON.stringify(items),
        address_json,
        shippingCost,
        shippingMethod,
      ];

      const { rows } = await client.query(query, values);
      return rows[0];
    } catch (err) {
      console.error("Erro ao criar pedido:", err);
      throw new Error("Falha ao registrar pedido no banco.");
    } finally {
      client.release();
    }
  }

  async updateOrderStatus(orderId, status, trackingCode = null) {
    const client = await pool.connect();
    try {
      let query = `
        UPDATE orders 
        SET status = $1, updated_at = NOW() 
      `;
      const values = [status, orderId];

      if (trackingCode) {
        query += `, tracking_code = $3 `;
        values.push(trackingCode);
      }

      query += ` WHERE order_id = $2::uuid RETURNING *`;

      const { rows } = await client.query(query, values);
      return rows[0];
    } catch (err) {
      console.error("Erro ao atualizar status do pedido:", err);
      throw err;
    } finally {
      client.release();
    }
  }

  async getOrdersByUser(userId) {
    const client = await pool.connect();
    try {
      const query = `
        SELECT * FROM orders 
        WHERE user_id = $1::uuid 
        ORDER BY created_at DESC
      `;
      const { rows } = await client.query(query, [userId]);
      return rows;
    } catch (err) {
      console.error("Erro ao buscar pedidos:", err);
      return [];
    } finally {
      client.release();
    }
  }

  async getAllOrders(page = 1, limit = 10) {
    const client = await pool.connect();
    try {
      const countRes = await client.query("SELECT COUNT(*) FROM orders");
      const total = parseInt(countRes.rows[0].count);
      const totalPages = Math.ceil(total / limit);
      const offset = (page - 1) * limit;

      const query = `
        SELECT 
          o.order_id, 
          o.total_amount, 
          o.status, 
          o.created_at, 
          o.payment_method,
          o.items,
          o.address_json as address,
          o.shipping_cost,   
          o.shipping_method,
          u.name as user_name,
          u.email as user_email,
          u.cpf as user_cpf
        FROM orders o
        JOIN users u ON o.user_id = u.user_id
        ORDER BY o.created_at DESC
        LIMIT $1 OFFSET $2
      `;
      const { rows } = await client.query(query, [limit, offset]);
      return {
        data: rows,
        total,
        totalPages,
        page,
      };
    } catch (err) {
      console.error("Erro ao buscar todos os pedidos:", err);
      return { data: [], total: 0, totalPages: 0, page: 1 };
    } finally {
      client.release();
    }
  }

  async getOrderById(orderId) {
    const client = await pool.connect();
    try {
      const { rows } = await client.query(
        `SELECT * FROM orders WHERE order_id = $1::uuid`,
        [orderId],
      );
      return rows[0];
    } catch (err) {
      console.error("Erro ao buscar pedido por ID:", err);
      return null;
    } finally {
      client.release();
    }
  }

  async getOrderByPaymentId(paymentIdMp) {
    const client = await pool.connect();
    try {
      const { rows } = await client.query(
        `SELECT * FROM orders WHERE payment_id_mp = $1 LIMIT 1`,
        [paymentIdMp.toString()],
      );
      return rows[0];
    } catch (err) {
      console.error("Erro ao buscar pedido pelo ID do MP:", err);
      return null;
    } finally {
      client.release();
    }
  }
}

module.exports = new OrderRepository();
