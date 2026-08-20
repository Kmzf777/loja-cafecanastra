const pool = require("../pgPool");
const { v4: uuidv4 } = require("uuid");

/**
 * Promoções, contra `canastra.promocoes`. O contrato HTTP segue o que o
 * PromotionsManager.jsx do painel legado envia e lê (`title`, `type`,
 * `value`, `applies_to`, `start_date`...); o mapa para as colunas em
 * português (`titulo`, `tipo`, `valor`, `aplica_a`, `inicio_em`...) vive
 * nos SELECTs e INSERTs daqui.
 */

const COLUNAS_DO_CONTRATO = `
  id,
  titulo     AS title,
  descricao  AS description,
  tipo       AS type,
  valor      AS value,
  aplica_a   AS applies_to,
  categoria  AS category,
  produto_id AS product_id,
  inicio_em  AS start_date,
  fim_em     AS end_date,
  ativa      AS active,
  criada_em  AS created_at
`;

/**
 * Valida tipo e valor do desconto — inalterado da versão anterior, porque a
 * regra protege dinheiro: um percentual acima de 100 fazia o checkout calcular
 * preço NEGATIVO, que abatia dos outros itens do carrinho.
 */
function validarDesconto(type, value) {
  const n = Number(value);

  if (!Number.isFinite(n) || n <= 0) {
    return "O valor do desconto precisa ser um número maior que zero.";
  }
  if (type === "percent" && n > 90) {
    // Teto de 90%: acima disso quase certamente é engano, e um "100%"
    // liberaria o produto de graça para todo mundo que abrisse a loja.
    return "Desconto percentual acima de 90% não é permitido.";
  }
  if (type !== "percent" && type !== "fixed") {
    return "Tipo de desconto inválido. Use 'percent' ou 'fixed'.";
  }
  return null;
}

/**
 * O datetime-local do painel manda "" quando o campo fica vazio, e "" não é
 * timestamptz: a versão antiga estourava 22007 no INSERT. Vazio vira NULL —
 * e promoção sem data não entra no checkout (o filtro de ativas exige as
 * duas datas, comportamento herdado do legado e mantido).
 */
const dataOuNull = (valor) => (valor ? valor : null);

class PromotionsRepository {
  async createPromotion(request, response) {
    const {
      title,
      description,
      type,
      value,
      applies_to,
      category,
      product_id,
      start_date,
      end_date,
    } = request.body;

    try {
      if (!title || !value || !type) {
        return response
          .status(400)
          .json({ error: "Campos obrigatórios faltando." });
      }

      const erroDeDesconto = validarDesconto(type, value);
      if (erroDeDesconto) {
        return response.status(400).json({ error: erroDeDesconto });
      }

      const categoryFixed = applies_to === "category" ? category : null;
      let productIdFixed = null;
      if (applies_to === "product") {
        const uuidRegex =
          /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
        if (!product_id || !uuidRegex.test(product_id)) {
          return response.status(400).json({
            error:
              "Para promoção por produto, você deve fornecer o ID (UUID) válido do produto.",
          });
        }
        productIdFixed = product_id;
      }

      await pool.query(
        `INSERT INTO canastra.promocoes (
           id, titulo, descricao, tipo, valor, aplica_a,
           categoria, produto_id, inicio_em, fim_em, ativa
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
        [
          uuidv4(),
          title,
          description,
          type,
          value,
          applies_to,
          categoryFixed,
          productIdFixed,
          dataOuNull(start_date),
          dataOuNull(end_date),
          true,
        ],
      );
      response.status(201).json({ message: "Promoção criada com sucesso." });
    } catch (err) {
      console.error("createPromotion:", err);
      response.status(500).json({ error: "Erro ao criar promoção." });
    }
  }

  async getPromotions(request, response) {
    try {
      const result = await pool.query(
        `SELECT ${COLUNAS_DO_CONTRATO} FROM canastra.promocoes
          ORDER BY criada_em DESC`,
      );
      response.status(200).json(result.rows);
    } catch (err) {
      console.error("getPromotions:", err);
      response.status(500).json({ error: "Erro ao buscar promoções." });
    }
  }

  async updatePromotion(request, response) {
    const { id } = request.params;
    const {
      title,
      description,
      type,
      value,
      applies_to,
      category,
      product_id,
      start_date,
      end_date,
      active,
    } = request.body;

    // A mesma regra do cadastro vale na edição: sem isto, dava para criar uma
    // promoção válida e depois editá-la para 150%.
    const erroDeDesconto = validarDesconto(type, value);
    if (erroDeDesconto) {
      return response.status(400).json({ error: erroDeDesconto });
    }

    try {
      await pool.query(
        `UPDATE canastra.promocoes SET
           titulo = $1, descricao = $2, tipo = $3, valor = $4, aplica_a = $5,
           categoria = $6, produto_id = $7, inicio_em = $8, fim_em = $9,
           ativa = $10
         WHERE id = $11`,
        [
          title,
          description,
          type,
          value,
          applies_to,
          category || null,
          product_id || null,
          dataOuNull(start_date),
          dataOuNull(end_date),
          active,
          id,
        ],
      );
      response.status(200).json({ message: "Promoção atualizada." });
    } catch (err) {
      console.error("updatePromotion:", err);
      response.status(500).json({ error: "Erro ao atualizar promoção." });
    }
  }

  /**
   * As promoções que o CHECKOUT aplica agora. Já saem no formato que o
   * PaymentController consome (`type`, `value`, `applies_to`, `category`,
   * `product_id`), para o cálculo de desconto não conhecer coluna de banco.
   *
   * As duas datas continuam obrigatórias para a promoção valer — semântica
   * herdada do legado (`start_date <= NOW() AND end_date >= NOW()`), mantida
   * para o vocabulário do painel não mudar de significado nesta onda.
   */
  async findActivePromotionsForCheckout() {
    const result = await pool.query(
      `SELECT ${COLUNAS_DO_CONTRATO} FROM canastra.promocoes
        WHERE ativa = true
          AND inicio_em <= now()
          AND fim_em >= now()`,
    );
    return result.rows;
  }
}

module.exports = PromotionsRepository;
