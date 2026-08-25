"use strict";

/**
 * A LEITURA ÚNICA que alimenta toda cotação de frete.
 *
 * Existe uma vez só porque as DUAS pontas precisam do mesmo pacote: a rota
 * pública `/shipping/calculate`, que diz ao cliente quanto custa, e o checkout,
 * que decide quanto ele paga. Enquanto a primeira usava defaults do código e a
 * segunda lia do banco, os dois números discordavam em toda venda — e quem
 * descobria era o cliente, com 409 na hora de pagar.
 *
 * OS DOIS CHAMADORES, pelo nome: `montarItensDaCotacao` (ShippingController) e
 * `createPayment` (PaymentController). Não é o `conferirFrete` quem lê — ele
 * recebe os itens já montados e só reconfere o par nome/preço; confundir os
 * dois faz procurar a consulta no lugar errado.
 *
 * Devolve um Map indexado por `product_id` e NÃO um array: quem chama itera a
 * sacola (que tem quantidade e ordem) e busca aqui. Um array obrigaria cada
 * chamador a montar o índice de novo.
 *
 * Produto ausente do Map é produto que não existe no banco. O chamador decide o
 * que isso significa — na cotação, recusar; no checkout, "o produto não existe
 * mais". O repositório não inventa pacote.
 *
 * CONTRATO NUMÉRICO: `price`, `weight`, `width`, `height` e `length` chegam
 * como STRING, não como number. As colunas são `numeric` no Postgres, e este
 * código não registra `pg.types.setTypeParser` para o OID de `numeric` — sem
 * esse parser, o driver devolve o texto cru em vez de arredondar para float,
 * exatamente para não perder precisão em silêncio. `p.weight + 1` concatena em
 * vez de somar; é a mesma classe de erro silencioso que esta extração existe
 * para eliminar, um degrau abaixo dela.
 *
 * O repositório NÃO converte para Number aqui: fazer isso criaria um SEGUNDO
 * lugar onde o contrato numérico mora, e a resposta que o resto do código já
 * dá para esse problema (ver `precoComPromocao` em `utils/preco.js`, e o
 * `productsPayload` de `ShippingController.js`) é converter no PONTO da conta,
 * não na leitura. Quem chama `lerParaCotacao` converte com `Number(...)` antes
 * de somar, multiplicar ou comparar.
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
