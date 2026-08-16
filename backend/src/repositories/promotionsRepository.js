const pool = require("../pgPool");
const { v4: uuidv4 } = require("uuid");

/**
 * Valida tipo e valor do desconto.
 *
 * Nao havia checagem nenhuma. Um percentual de 150 fazia o checkout calcular
 * `preco * (1 - 150/100)` = preco NEGATIVO — e, como o total do pedido e uma
 * soma, um item negativo ABATIA o preco dos outros itens do carrinho. Bastava
 * um erro de digitacao no painel para a loja passar a pagar para vender.
 * (O checkout hoje recusa total <= 0, mas isso e a ultima linha de defesa, e
 * ainda deixaria o desconto errado corromper o valor dos outros itens.)
 */
function validarDesconto(type, value) {
  const n = Number(value);

  if (!Number.isFinite(n) || n <= 0) {
    return "O valor do desconto precisa ser um número maior que zero.";
  }
  if (type === "percent" && n > 90) {
    // Teto de 90%: acima disso quase certamente e engano, e um "100%" liberaria
    // o produto de graca para todo mundo que abrisse a loja.
    return "Desconto percentual acima de 90% não é permitido.";
  }
  if (type !== "percent" && type !== "fixed") {
    return "Tipo de desconto inválido. Use 'percent' ou 'fixed'.";
  }
  return null;
}

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

    const client = await pool.connect();
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

      await client.query(
        `INSERT INTO promotions (
          id, title, description, type, value, applies_to,
          category, product_id, start_date, end_date, active
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
          start_date,
          end_date,
          true,
        ]
      );
      response.status(201).json({ message: "Promoção criada com sucesso." });
    } catch (err) {
      console.error(err);
      response.status(500).json({ error: err.message });
    } finally {
      client.release();
    }
  }

  async getPromotions(request, response) {
    const client = await pool.connect();
    try {
      const result = await client.query(
        "SELECT * FROM promotions ORDER BY created_at DESC"
      );
      response.status(200).json(result.rows);
    } catch (err) {
      response.status(500).json({ error: err.message });
    } finally {
      client.release();
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

    // A mesma regra do cadastro vale na edicao: sem isto, dava para criar uma
    // promocao valida e depois edita-la para 150%.
    const erroDeDesconto = validarDesconto(type, value);
    if (erroDeDesconto) {
      return response.status(400).json({ error: erroDeDesconto });
    }

    const client = await pool.connect();
    try {
      await client.query(
        `UPDATE promotions SET 
           title=$1, description=$2, type=$3, value=$4, applies_to=$5,
           category=$6, product_id=$7, start_date=$8, end_date=$9, active=$10
         WHERE id=$11`,
        [
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
          id,
        ]
      );
      response.status(200).json({ message: "Promoção atualizada." });
    } catch (err) {
      response.status(500).json({ error: err.message });
    } finally {
      client.release();
    }
  }

  async findActivePromotionsForCheckout() {
    const client = await pool.connect();
    try {
      const result = await client.query(
        `SELECT * FROM promotions 
         WHERE active = true 
         AND start_date <= NOW() 
         AND end_date >= NOW()`
      );
      return result.rows;
    } finally {
      client.release();
    }
  }
}

module.exports = PromotionsRepository;
