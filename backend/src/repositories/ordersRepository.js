const pool = require("../pgPool");
const { v4: uuidv4 } = require("uuid");

/**
 * Pedidos, contra `canastra.pedidos` — colunas em português no banco, contrato
 * em inglês na borda HTTP (decisão 2 do plano mestre: a FORMA do JSON que o
 * painel legado e a vitrine consomem não muda; muda só o vocabulário de
 * status). O mapa coluna→campo vive nos SELECTs, num lugar só.
 *
 * NENHUM MÉTODO ENGOLE ERRO. A versão anterior devolvia [] / null / objeto
 * vazio no catch, e o efeito era o painel mostrando "nenhum pedido" com o
 * banco fora do ar — zero e um número plausível, então a mentira passava por
 * verdade. Erro agora sobe, vira 500 no handler e aparece no log.
 */

/** A projeção de um pedido no contrato HTTP. */
const COLUNAS_DO_CONTRATO = `
  pedido_id          AS order_id,
  user_id,
  total              AS total_amount,
  status,
  metodo_pagamento   AS payment_method,
  pagamento_id_mp    AS payment_id_mp,
  chave_idempotencia AS idempotency_key,
  itens              AS items,
  endereco_json      AS address_json,
  frete              AS shipping_cost,
  metodo_envio       AS shipping_method,
  codigo_rastreio    AS tracking_code,
  criado_em          AS created_at,
  atualizado_em      AS updated_at
`;

class OrderRepository {
  /**
   * Cria o pedido. `chaveIdempotencia` é obrigatória por desenho: o índice
   * parcial `pedidos_idempotencia_idx` (0005) é a defesa contra o duplo clique
   * do checkout, e ela só funciona se TODA gravação carregar uma chave.
   * Chave repetida estoura 23505 — quem chama decide o que responder.
   */
  async createOrder({
    userId,
    totalAmount,
    items,
    paymentMethod,
    paymentIdMp,
    address_json,
    shippingCost,
    shippingMethod,
    chaveIdempotencia,
    status = "pendente",
  }) {
    const { rows } = await pool.query(
      `INSERT INTO canastra.pedidos
         (pedido_id, user_id, total, status, metodo_pagamento, pagamento_id_mp,
          chave_idempotencia, itens, endereco_json, frete, metodo_envio)
       VALUES ($1::uuid, $2::uuid, $3, $4, $5, $6, $7, $8::jsonb, $9::jsonb, $10, $11)
       RETURNING ${COLUNAS_DO_CONTRATO}`,
      [
        uuidv4(),
        userId,
        totalAmount,
        status,
        paymentMethod,
        paymentIdMp,
        chaveIdempotencia,
        JSON.stringify(items),
        address_json ? JSON.stringify(address_json) : null,
        shippingCost,
        shippingMethod,
      ],
    );
    return rows[0];
  }

  /**
   * O pedido de uma chave de idempotência, se já existir. É o que transforma a
   * retentativa do mesmo clique em "devolve o pedido que já criei" em vez de
   * segunda cobrança.
   */
  async getOrderByIdempotencyKey(chave, client = pool) {
    const { rows } = await client.query(
      `SELECT ${COLUNAS_DO_CONTRATO} FROM canastra.pedidos
        WHERE chave_idempotencia = $1 LIMIT 1`,
      [chave],
    );
    return rows[0];
  }

  /**
   * `client` opcional para rodar DENTRO de uma transação aberta por quem
   * chama (webhook e painel movimentam estoque e status atomicamente — a
   * versão anterior abria um segundo cliente aqui e o UPDATE de status ficava
   * FORA da transação de estoque).
   *
   * `atualizado_em = now()` não é opcional: não há trigger de moddatetime
   * neste schema (0005), quem atualiza escreve a data junto ou a coluna mente.
   */
  async updateOrderStatus(orderId, status, trackingCode = null, client = pool) {
    const campos = ["status = $1", "atualizado_em = now()"];
    const values = [status, orderId];
    if (trackingCode) {
      campos.push(`codigo_rastreio = $${values.length + 1}`);
      values.push(trackingCode);
    }

    const { rows } = await client.query(
      `UPDATE canastra.pedidos SET ${campos.join(", ")}
        WHERE pedido_id = $2::uuid
        RETURNING ${COLUNAS_DO_CONTRATO}`,
      values,
    );
    return rows[0];
  }

  /**
   * Avança o status APENAS se o pedido ainda está no 'pendente' inicial.
   *
   * É o fecho da corrida entre o checkout e o webhook: o MP pode notificar
   * antes de o checkout aplicar o status da resposta síncrona (Pix notifica
   * em segundos). Um UPDATE cego atropelaria o que o webhook já gravou — e o
   * checkout ainda devolveria um estoque que o webhook já devolveu. Com o
   * `WHERE status = 'pendente'`, quem chegar segundo recebe `undefined` e
   * sabe que não deve produzir efeito nenhum.
   */
  async avancarStatusInicial(orderId, status) {
    const { rows } = await pool.query(
      `UPDATE canastra.pedidos
          SET status = $1, atualizado_em = now()
        WHERE pedido_id = $2::uuid AND status = 'pendente'
        RETURNING ${COLUNAS_DO_CONTRATO}`,
      [status, orderId],
    );
    return rows[0];
  }

  async getOrdersByUser(userId) {
    const { rows } = await pool.query(
      `SELECT ${COLUNAS_DO_CONTRATO} FROM canastra.pedidos
        WHERE user_id = $1::uuid
        ORDER BY criado_em DESC`,
      [userId],
    );
    return rows;
  }

  async getAllOrders(page = 1, limit = 10) {
    const countRes = await pool.query("SELECT COUNT(*) FROM canastra.pedidos");
    const total = parseInt(countRes.rows[0].count, 10);
    const totalPages = Math.ceil(total / limit);
    const offset = (page - 1) * limit;

    /**
     * LEFT JOIN, não INNER — a lição continua a mesma da versão antiga:
     * `user_id` aceita NULL (cliente apagado, 0005 preserva a venda) e um
     * pedido órfão sumir da tela do admin seria faturamento sumindo junto.
     *
     * O e-mail vem de `auth.users`: é o GoTrue quem o guarda desde a F2. O
     * pool conecta como dono do banco, que lê `auth` sem cerimônia.
     */
    const { rows } = await pool.query(
      `SELECT
         p.pedido_id        AS order_id,
         p.total            AS total_amount,
         p.status,
         p.criado_em        AS created_at,
         p.metodo_pagamento AS payment_method,
         p.itens            AS items,
         p.endereco_json    AS address,
         p.frete            AS shipping_cost,
         p.metodo_envio     AS shipping_method,
         p.codigo_rastreio  AS tracking_code,
         COALESCE(c.nome, 'Cliente removido') AS user_name,
         COALESCE(u.email, '—')               AS user_email,
         c.cpf                                AS user_cpf
       FROM canastra.pedidos p
       LEFT JOIN canastra.clientes c ON c.user_id = p.user_id
       LEFT JOIN auth.users u        ON u.id      = p.user_id
       ORDER BY p.criado_em DESC
       LIMIT $1 OFFSET $2`,
      [limit, offset],
    );

    return { data: rows, total, totalPages, page };
  }

  async getOrderById(orderId, client = pool) {
    const { rows } = await client.query(
      `SELECT ${COLUNAS_DO_CONTRATO} FROM canastra.pedidos
        WHERE pedido_id = $1::uuid`,
      [orderId],
    );
    return rows[0];
  }

  async getOrderByPaymentId(paymentIdMp, client = pool) {
    const { rows } = await client.query(
      `SELECT ${COLUNAS_DO_CONTRATO} FROM canastra.pedidos
        WHERE pagamento_id_mp = $1 LIMIT 1`,
      [String(paymentIdMp)],
    );
    return rows[0];
  }

  /**
   * A variante do webhook: mesma busca, com a linha TRAVADA (`FOR UPDATE`).
   * Duas notificações simultâneas do mesmo pagamento serializam aqui, e a
   * segunda enxerga o status que a primeira commitou — é o que impede o
   * estoque de ser devolvido duas vezes.
   */
  async lockOrderByPaymentId(paymentIdMp, client) {
    const { rows } = await client.query(
      `SELECT ${COLUNAS_DO_CONTRATO} FROM canastra.pedidos
        WHERE pagamento_id_mp = $1 LIMIT 1
        FOR UPDATE`,
      [String(paymentIdMp)],
    );
    return rows[0];
  }
}

module.exports = new OrderRepository();
