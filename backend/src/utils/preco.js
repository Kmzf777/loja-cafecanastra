"use strict";

/**
 * O menor preco do produto dadas as promocoes ativas, arredondado a centavo.
 *
 * MOROU DENTRO DO PaymentController ate a F6; saiu de la porque ganhou um
 * TERCEIRO chamador: alem da cotacao de frete (leitura sem trava) e do calculo
 * do valor cobrado (releitura com FOR UPDATE), agora o `POST /cupons/validar`
 * precisa do MESMO preco promocional para calcular o subtotal sobre o qual o
 * cupom desconta — e importar o PaymentController de la puxaria o SDK do
 * Mercado Pago para um caminho que nao cobra nada. Copias desta logica
 * divergindo fariam o cupom, o frete gratis e a cobranca discordarem sobre o
 * mesmo carrinho.
 *
 * O arredondamento nao e cosmetico: 10% sobre 49.90 em float da
 * 44.910000000000004, e esse numero iria para o JSON IMUTAVEL do pedido
 * (`itens`, regra de 0005) e para a soma cobrada no gateway.
 *
 * `productDb` fala o CONTRATO (price, category, product_id — os aliases dos
 * SELECTs), nao as colunas do banco; `activePromotions` e o formato de
 * `promotionsRepository.findActivePromotionsForCheckout`.
 */
function precoComPromocao(productDb, activePromotions) {
  const precoOriginal = Number(productDb.price);
  let bestPrice = precoOriginal;

  activePromotions.forEach((p) => {
    let match = false;

    const promoCategory = p.category
      ? String(p.category).trim().toLowerCase()
      : "";
    const prodCategory = productDb.category
      ? String(productDb.category).trim().toLowerCase()
      : "";

    if (p.applies_to === "all") {
      match = true;
    } else if (p.applies_to === "category") {
      if (promoCategory && promoCategory === prodCategory) {
        match = true;
      }
    } else if (p.applies_to === "product") {
      if (String(p.product_id) === String(productDb.product_id)) {
        match = true;
      }
    }

    if (match) {
      const value = Number(p.value);
      const discounted =
        p.type === "percent"
          ? precoOriginal * (1 - value / 100)
          : Math.max(0, precoOriginal - value);

      if (discounted < bestPrice) bestPrice = discounted;
    }
  });

  return Math.round(bestPrice * 100) / 100;
}

/**
 * Subtotal de uma lista de itens em CENTAVOS e inteiro. `price` viaja em reais
 * (contrato antigo); cada preco vira inteiro ANTES da soma, porque `49.67 * 3`
 * em float da 149.01000000000002 — e as comparacoes que consomem este numero
 * (piso do frete gratis, minimo do cupom, desconto) erram exatamente na
 * fronteira.
 *
 * Uma funcao so para os tres somadores (cotacao de frete, validacao de cupom,
 * checkout) nunca divergirem sobre o mesmo carrinho.
 */
function somarCentavos(itens) {
  return itens.reduce(
    (acc, i) => acc + Math.round(Number(i.price) * 100) * Number(i.quantity),
    0,
  );
}

module.exports = { precoComPromocao, somarCentavos };
