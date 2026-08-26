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

/**
 * A projeção de um pedido no contrato HTTP.
 *
 * `coupon_code`/`discount` (colunas `cupom_codigo`/`desconto`, migração 0010)
 * entram na projeção porque o `createOrder` abaixo JÁ grava nelas — o módulo
 * inteiro depende da 0010 aplicada, então não há cenário em que ler as
 * colunas quebre e gravar funcione. O contrato do plano diz "se houver":
 * pedido sem cupom sai `coupon_code: null` e `discount: "0.00"` (numeric do
 * pg vira string), e é assim que painel e vitrine testam a presença
 * (`if (order.coupon_code)` / `Number(order.discount) > 0`). `discount` está
 * em REAIS, a mesma unidade de `total_amount` — decisão da 0010, como
 * `total` e `frete`.
 */
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
  cupom_codigo       AS coupon_code,
  desconto           AS discount,
  criado_em          AS created_at,
  atualizado_em      AS updated_at
`;

class OrderRepository {
  /**
   * Cria o pedido. `chaveIdempotencia` é obrigatória por desenho: o índice
   * parcial `pedidos_idempotencia_idx` (0005) é a defesa contra o duplo clique
   * do checkout, e ela só funciona se TODA gravação carregar uma chave.
   * Chave repetida estoura 23505 — quem chama decide o que responder.
   *
   * `client` OPCIONAL, mesmo padrão de `updateOrderStatus` logo abaixo, e aqui
   * ele existe por uma restrição de schema: `promocao_resgates.pedido_id` e
   * `pedido_ajustes_desconto.pedido_id` são NOT NULL com FK para esta tabela,
   * então o resgate e a decomposição do desconto SÓ podem existir na mesma
   * transação que grava o pedido — não há resgate sem pedido, por construção.
   * Sem este parâmetro o INSERT sairia pelo pool, commitando sozinho, e um erro
   * na gravação dos ajustes deixaria um pedido cobrado sem a linha que explica
   * por quanto ele saiu.
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
    // Cupons (0010): a fotografia do cupom no pedido. Os SELECTs do contrato
    // expõem as duas colunas como coupon_code/discount — ver
    // COLUNAS_DO_CONTRATO.
    cupomCodigo = null,
    desconto = 0,
    client = pool,
  }) {
    const { rows } = await client.query(
      `INSERT INTO canastra.pedidos
         (pedido_id, user_id, total, status, metodo_pagamento, pagamento_id_mp,
          chave_idempotencia, itens, endereco_json, frete, metodo_envio,
          cupom_codigo, desconto)
       VALUES ($1::uuid, $2::uuid, $3, $4, $5, $6, $7, $8::jsonb, $9::jsonb, $10, $11,
               $12, $13)
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
        cupomCodigo,
        desconto,
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
     *
     * OS CAMPOS DO BLING (0012) ENTRAM AQUI, E SÓ AQUI. A tela de Bling do
     * painel e o modal de detalhe de Pedidos leem a linha DESTA listagem —
     * é ela que precisa dizer se o pedido já foi ao ERP, em que situação
     * está lá e se a nota saiu. Sem isso, a fila do painel teria de fazer
     * uma ida por pedido só para descobrir o que já está na mesma linha.
     *
     * Os nomes saem SEM alias de propósito: `bling_id`, `bling_situacao` e
     * `nfe_*` são identificadores de OUTRO sistema — não têm tradução para
     * o vocabulário da loja, e são exatamente as chaves que as rotas de
     * `/bling` já devolvem no `pedido` da resposta (`COLUNAS_COM_BLING` em
     * services/blingPedidos.js). Iguais dos dois lados, o painel mescla a
     * resposta de uma ação na linha da lista sem mapa de conversão.
     *
     * `nfe_id` e `bling_claim_em` ficam de fora: são mecânica interna da
     * retentativa e do claim de idempotência, não informação de gestão —
     * quem os lê é o serviço, que consulta a tabela direto.
     *
     * `COLUNAS_DO_CONTRATO` (o detalhe de `/my-orders/:id` e o que o
     * checkout devolve) NÃO ganhou os campos: aquele contrato é do CLIENTE,
     * e nada na vitrine mostra ERP. Um dia que a vitrine queira exibir o
     * DANFE ao comprador, entra lá — como decisão de produto, não como
     * efeito colateral desta tela.
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
         p.cupom_codigo     AS coupon_code,
         p.desconto         AS discount,
         p.bling_id,
         p.bling_situacao,
         p.bling_sincronizado_em,
         p.nfe_numero,
         p.nfe_chave,
         p.nfe_url,
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

  /**
   * O detalhe de UM pedido para `GET /my-orders/:id`: a MESMA projeção da
   * listagem (`COLUNAS_DO_CONTRATO`, com coupon_code/discount). Quem decide
   * se o chamador PODE ver este pedido é o controller — aqui só se busca.
   */
  async getOrderDetail(orderId, client = pool) {
    return this.getOrderById(orderId, client);
  }

  /**
   * Todos os pedidos do período, SEM paginação, para o CSV do admin.
   *
   * `ate` é INCLUSIVO no dia: o gestor que pede "até 2026-08-20" espera os
   * pedidos daquele dia dentro — por isso `< ate + 1 dia`, e não `<= ate`
   * (que cortaria tudo depois da meia-noite). A ordem é cronológica
   * crescente porque é assim que uma planilha de conferência se lê.
   *
   * O DIA É O DE SÃO PAULO, não o de UTC — porque é o fuso em que o CSV
   * imprime a coluna `data` (csvDePedidos.dataBr). Sem o `AT TIME ZONE`,
   * um pedido de 23h de 20/08 (02h de 21/08 em UTC) apareceria no arquivo
   * "até 20/08" com data 20/08... ou ficaria de fora dele, dependendo do
   * fuso do servidor — as duas metades do relatório discordando do próprio
   * título. A expressão continua sargável: o índice em `criado_em` compara
   * contra uma constante calculada uma vez.
   *
   * O formato de `de`/`ate` (YYYY-MM-DD) é validado no controller; aqui o
   * cast `::date` é a última linha de defesa.
   */
  async getOrdersForExport({ de, ate } = {}) {
    const filtros = [];
    const values = [];
    if (de) {
      values.push(de);
      filtros.push(
        `p.criado_em >= ($${values.length}::date)::timestamp AT TIME ZONE 'America/Sao_Paulo'`,
      );
    }
    if (ate) {
      values.push(ate);
      filtros.push(
        `p.criado_em < ($${values.length}::date + 1)::timestamp AT TIME ZONE 'America/Sao_Paulo'`,
      );
    }
    const where = filtros.length ? `WHERE ${filtros.join(" AND ")}` : "";

    const { rows } = await pool.query(
      `SELECT
         p.pedido_id        AS order_id,
         p.criado_em        AS created_at,
         p.total            AS total_amount,
         p.status,
         p.metodo_pagamento AS payment_method,
         p.itens            AS items,
         p.frete            AS shipping_cost,
         p.codigo_rastreio  AS tracking_code,
         p.cupom_codigo     AS coupon_code,
         p.desconto         AS discount,
         COALESCE(c.nome, 'Cliente removido') AS user_name,
         COALESCE(u.email, '—')               AS user_email,
         c.cpf                                AS user_cpf
       FROM canastra.pedidos p
       LEFT JOIN canastra.clientes c ON c.user_id = p.user_id
       LEFT JOIN auth.users u        ON u.id      = p.user_id
       ${where}
       ORDER BY p.criado_em ASC`,
      values,
    );
    return rows;
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
