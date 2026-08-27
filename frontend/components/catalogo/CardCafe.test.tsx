import { describe, it, expect } from "vitest";
import { html } from "@/lib/teste/html";
import { CardCafe } from "./CardCafe";
import { LOTES } from "@/lib/catalogo/produtos";
import type { Lote } from "@/lib/catalogo/tipos";

/**
 * O SEGUNDO VOCABULÁRIO DE CARD, e ele existe por um motivo que continua
 * valendo: o `<CardProduto>` vende UM SKU e diz o preço exato; este vende uma
 * LINHA inteira e diz "a partir de". Nenhum dos dois pode ser aposentado, e
 * nenhum dos dois pode ficar sem "de/por" — a promoção já descontava na
 * cobrança e não aparecia em superfície nenhuma.
 */

const LOTE = LOTES[0];

/** O mesmo lote, com as variantes trocadas por preços de laboratório. */
function comVariantes(precos: Array<{ preco: number; promo?: number }>): Lote {
  return {
    ...LOTE,
    variantes: precos.map((p, i) => ({
      ...LOTE.variantes[0],
      sku: `teste-${i}`,
      skuLoja: `teste-${i}`,
      estoque: 10,
      preco: p.preco,
      ...(p.promo === undefined ? {} : { precoPromocional: p.promo }),
    })),
  };
}

describe("CardCafe e o 'a partir de'", () => {
  it("sem campanha, imprime o menor preço de catálogo e nada riscado", () => {
    const saida = html(<CardCafe lote={comVariantes([{ preco: 7000 }, { preco: 6000 }])} />);
    expect(saida).toContain("a partir de");
    expect(saida).toContain("60,00");
    expect(saida).not.toContain("<s ");
  });

  it("com campanha, risca o preço da MESMA variante e marca o desconto", () => {
    const saida = html(
      <CardCafe lote={comVariantes([{ preco: 6000, promo: 5400 }])} />,
    );
    expect(saida).toContain("<s ");
    expect(saida).toContain("60,00");
    expect(saida).toContain("54,00");
    expect(saida).toContain("−10%");
  });

  it("O PAR SAI INTEIRO DA MESMA VARIANTE — o card não inventa desconto", () => {
    // 250 g a R$ 60 sem campanha; 500 g a R$ 70 com R$ 56. Casar o "de" de uma
    // com o "por" da outra anunciaria 6,7% que não existem em SKU nenhum.
    const saida = html(
      <CardCafe
        lote={comVariantes([{ preco: 6000 }, { preco: 7000, promo: 5600 }])}
      />,
    );
    expect(saida).toContain("70,00");
    expect(saida).toContain("56,00");
    expect(saida).toContain("−20%");
  });

  it("linha sem nenhum preço continua dizendo 'Indisponível'", () => {
    const saida = html(<CardCafe lote={comVariantes([{ preco: 0 }])} />);
    expect(saida).toContain("Indisponível");
  });

  it("o rótulo 'a partir de' acompanha o idioma da página", () => {
    const lote = comVariantes([{ preco: 6000 }]);
    expect(html(<CardCafe lote={lote} locale="en" />)).toContain("from");
    expect(html(<CardCafe lote={lote} locale="es" />)).toContain("desde");
  });
});
