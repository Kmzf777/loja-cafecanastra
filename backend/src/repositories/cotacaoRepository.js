"use strict";

/**
 * A LEITURA ÚNICA que alimenta toda cotação de frete.
 *
 * Existe uma vez só porque as DUAS pontas precisam do mesmo pacote: a rota
 * pública `/shipping/calculate`, que diz ao cliente quanto custa, e o
 * `conferirFrete` do checkout, que decide quanto ele paga. Enquanto a primeira
 * usava defaults do código e a segunda lia do banco, os dois números discordavam
 * em toda venda — e quem descobria era o cliente, com 409 na hora de pagar.
 *
 * Devolve um Map indexado por `product_id` e NÃO um array: quem chama itera a
 * sacola (que tem quantidade e ordem) e busca aqui. Um array obrigaria cada
 * chamador a montar o índice de novo.
 *
 * Produto ausente do Map é produto que não existe no banco. O chamador decide o
 * que isso significa — na cotação, recusar; no checkout, "o produto não existe
 * mais". O repositório não inventa pacote.
 */

const pool = require("../pgPool");

async function lerParaCotacao(productIds) {
  const ids = [...new Set((productIds || []).map(String))];
  if (ids.length === 0) return new Map();

  const { rows } = await pool.query(
    `SELECT produto_id  AS product_id,
            preco       AS price,
            categoria   AS category,
            nome        AS name,
            peso        AS weight,
            largura     AS width,
            altura      AS height,
            comprimento AS length
       FROM canastra.produtos
      WHERE produto_id = ANY($1::uuid[])`,
    [ids],
  );

  return new Map(rows.map((p) => [p.product_id, p]));
}

module.exports = { lerParaCotacao };
