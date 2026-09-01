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

/**
 * A projeção do PAINEL — a linha da listagem de `/admin/orders` e, desde a
 * Onda 4, também a de `/admin/orders/:id`.
 *
 * ESTÁ NUMA CONSTANTE PORQUE OS DOIS TÊM DE SER IGUAIS. O detalhe nasceu para
 * dar deep-link à `/dashboard/pedidos/[id]`, e uma tela que mostra MENOS quando
 * a pessoa recarrega a página do que quando ela clica na linha é pior que não
 * ter deep-link nenhum: o gestor volta para a listagem para ver o cliente. Duas
 * listas de colunas divergiriam na primeira coluna nova.
 *
 * Os campos do Bling e os do cliente continuam FORA de `COLUNAS_DO_CONTRATO`
 * pelo motivo escrito lá: aquele é o contrato do CLIENTE, e nada na vitrine
 * mostra ERP nem o CPF de quem comprou.
 */
const COLUNAS_DO_PAINEL = `
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
`;

/**
 * O join que `COLUNAS_DO_PAINEL` pressupõe.
 *
 * LEFT JOIN, não INNER — a lição é a mesma desde a versão antiga: `user_id`
 * aceita NULL (cliente apagado, 0005 preserva a venda) e um pedido órfão sumir
 * da tela do admin seria faturamento sumindo junto. O e-mail vem de
 * `auth.users`: é o GoTrue quem o guarda desde a F2, e o pool conecta como dono
 * do banco, que lê `auth` sem cerimônia.
 */
const DE_PEDIDOS_COM_CLIENTE = `
  FROM canastra.pedidos p
  LEFT JOIN canastra.clientes c ON c.user_id = p.user_id
  LEFT JOIN auth.users u        ON u.id      = p.user_id
`;

/**
 * O RECORTE DE PERÍODO, EM UM LUGAR SÓ — a listagem filtrada e a exportação
 * medem o mesmo dia.
 *
 * `ate` é INCLUSIVO no dia: quem pede "até 2026-08-20" espera os pedidos
 * daquele dia dentro, por isso `< ate + 1 dia` e não `<= ate` (que cortaria
 * tudo depois da meia-noite).
 *
 * E O DIA É O DE SÃO PAULO, não o de UTC, porque é o fuso em que a tela e o CSV
 * imprimem a data (`csvDePedidos.dataBr`). Sem o `AT TIME ZONE`, um pedido das
 * 23h de 20/08 (02h de 21/08 em UTC) apareceria no relatório "até 20/08" com
 * data 20/08... ou ficaria de fora dele, dependendo do fuso do servidor — as
 * duas metades do relatório discordando do próprio título. A expressão continua
 * sargável: o índice em `criado_em` compara contra uma constante calculada uma
 * vez.
 *
 * O formato de `de`/`ate` (YYYY-MM-DD) é validado no controller; o cast `::date`
 * é a última linha de defesa.
 */
function filtrosDePeriodo({ de, ate }, filtros, values) {
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
}

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

  /**
   * A listagem do painel, FILTRADA NO BANCO.
   *
   * Até a Onda 4 esta rota aceitava só `page` e `limit`, e a tela filtrava o
   * que tinha em memória: uma página de 100 linhas com uma caixa de "status" em
   * cima MENTE duas vezes — esconde o pedido que casa e está na página 3, e
   * mostra um `total` que é o total geral, oferecendo páginas vazias. O filtro
   * tem de acontecer onde estão todas as linhas.
   *
   * OS CAMPOS DO BLING (0012) ENTRAM AQUI, E SÓ AQUI (ver `COLUNAS_DO_PAINEL`):
   * a tela de Bling e o modal de detalhe leem a linha DESTA listagem — é ela
   * que precisa dizer se o pedido já foi ao ERP, em que situação está lá e se a
   * nota saiu. Sem isso, a fila do painel faria uma ida por pedido só para
   * descobrir o que já está na mesma linha. `nfe_id` e `bling_claim_em` ficam
   * de fora: são mecânica interna da retentativa e do claim de idempotência,
   * não informação de gestão.
   *
   * @param {object} [filtro] `status` (lista já validada pelo controller),
   *   `de`/`ate` (YYYY-MM-DD) e `q` (texto livre).
   */
  async getAllOrders(page = 1, limit = 10, filtro = {}) {
    const filtros = [];
    const values = [];

    if (Array.isArray(filtro.status) && filtro.status.length) {
      values.push(filtro.status);
      filtros.push(`p.status = ANY($${values.length})`);
    }
    filtrosDePeriodo(filtro, filtros, values);

    /**
     * A BUSCA OLHA O QUE O GESTOR TEM NA MÃO quando alguém liga: o nome que a
     * pessoa disse, o e-mail do pedido de confirmação, o CPF da nota e o número
     * do pedido colado do e-mail. Os quatro num `OR` só, e o conjunto todo
     * entre parênteses — sem eles, o `OR` se espalharia sobre o `AND` do status
     * e a busca devolveria a base inteira com um filtro aplicado pela metade.
     */
    const q = String(filtro.q || "").trim();
    if (q) {
      values.push(`%${q}%`);
      const i = values.length;
      filtros.push(
        `(c.nome ILIKE $${i} OR u.email ILIKE $${i} OR c.cpf ILIKE $${i}
          OR p.pedido_id::text ILIKE $${i})`,
      );
    }

    const where = filtros.length ? `WHERE ${filtros.join(" AND ")}` : "";

    // A CONTAGEM USA O MESMO WHERE E O MESMO JOIN. Contar sem o join daria um
    // total maior que a lista sempre que a busca casasse por cliente.
    const countRes = await pool.query(
      `SELECT COUNT(*) ${DE_PEDIDOS_COM_CLIENTE} ${where}`,
      values,
    );
    const total = parseInt(countRes.rows[0].count, 10);
    const totalPages = Math.ceil(total / limit);
    const offset = (page - 1) * limit;

    const { rows } = await pool.query(
      `SELECT ${COLUNAS_DO_PAINEL}
       ${DE_PEDIDOS_COM_CLIENTE}
       ${where}
       ORDER BY p.criado_em DESC
       LIMIT $${values.length + 1} OFFSET $${values.length + 2}`,
      [...values, limit, offset],
    );

    return { data: rows, total, totalPages, page };
  }

  /**
   * UM pedido, na projeção do painel — o que `GET /admin/orders/:id` devolve.
   *
   * Existe para a página `/dashboard/pedidos/[id]` renderizada no servidor: ali
   * não há lista em memória de onde tirar a linha, e sem esta consulta o
   * detalhe só existia como um modal aberto a partir da listagem.
   */
  async getOrderForAdmin(orderId, client = pool) {
    const { rows } = await client.query(
      `SELECT ${COLUNAS_DO_PAINEL}
       ${DE_PEDIDOS_COM_CLIENTE}
       WHERE p.pedido_id = $1::uuid`,
      [orderId],
    );
    return rows[0];
  }

  /**
   * QUANTAS linhas a exportação alcançaria — a pergunta que o CSV passou a
   * fazer ANTES de montar o arquivo (Onda 4).
   *
   * Serve a duas recusas que só existem juntas: o teto de linhas e a
   * confirmação de "a base inteira". Sem contar antes, a única forma de saber
   * que a exportação era grande demais seria já ter carregado tudo na memória
   * do processo — com CPF e e-mail dentro.
   */
  async contarPedidosParaExport({ de, ate } = {}) {
    const filtros = [];
    const values = [];
    filtrosDePeriodo({ de, ate }, filtros, values);
    const where = filtros.length ? `WHERE ${filtros.join(" AND ")}` : "";

    const { rows } = await pool.query(
      `SELECT COUNT(*) FROM canastra.pedidos p ${where}`,
      values,
    );
    return parseInt(rows[0].count, 10);
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
   * Todos os pedidos do período, SEM paginação, para o CSV do admin. A ordem é
   * cronológica crescente porque é assim que uma planilha de conferência se lê.
   *
   * O recorte de período é o `filtrosDePeriodo` compartilhado com a listagem —
   * o dia de São Paulo, inclusivo no fim. Duas cópias divergindo fariam a tela
   * e o arquivo discordarem sobre o mesmo "de/até".
   */
  async getOrdersForExport({ de, ate } = {}) {
    const filtros = [];
    const values = [];
    filtrosDePeriodo({ de, ate }, filtros, values);
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
