import { describe, it, expect } from "vitest";
import {
  descontoPercentual,
  precoExibido,
  precoMinimoExibido,
  precoPromocionalDaApi,
  temPromocao,
} from "./promocao";
import { LOTES } from "./produtos";
import type { Lote, Variante } from "./tipos";

/**
 * A regra do "de/por" e o que ela recusa.
 *
 * Esta e a funcao pura da Onda 6: e ela que decide o que a vitrine anuncia. As
 * recusas valem tanto quanto os acertos — cada uma delas e uma mentira que a
 * loja nao vai imprimir.
 */

/** Um lote real, com as variantes trocadas — o resto do editorial fica intacto. */
function loteCom(variantes: Array<Pick<Variante, "preco"> & Partial<Variante>>): Lote {
  const base = LOTES[0];
  return {
    ...base,
    variantes: variantes.map((v, i) => ({
      ...base.variantes[0],
      sku: `teste-${i}`,
      skuLoja: `teste-${i}`,
      ...v,
    })),
  };
}

describe("precoExibido — o par que a tela desenha", () => {
  it("sem promocao, devolve o preco de catalogo e nenhum riscado", () => {
    expect(precoExibido({ preco: 6000 })).toEqual({ de: null, por: 6000 });
  });

  it("com promocao, risca o catalogo e destaca o promocional", () => {
    expect(precoExibido({ preco: 6000, precoPromocional: 5400 })).toEqual({
      de: 6000,
      por: 5400,
    });
  });

  it("recusa promocional IGUAL ao catalogo — 'de R$ 60 por R$ 60' nao e promocao", () => {
    expect(precoExibido({ preco: 6000, precoPromocional: 6000 })).toEqual({
      de: null,
      por: 6000,
    });
  });

  it("recusa promocional MAIOR que o catalogo — seria anuncio enganoso", () => {
    expect(precoExibido({ preco: 6000, precoPromocional: 7000 })).toEqual({
      de: null,
      por: 6000,
    });
  });

  it("recusa zero e negativo — cafe de graca nao e campanha, e dado torto", () => {
    expect(precoExibido({ preco: 6000, precoPromocional: 0 })).toEqual({
      de: null,
      por: 6000,
    });
    expect(precoExibido({ preco: 6000, precoPromocional: -100 })).toEqual({
      de: null,
      por: 6000,
    });
  });

  it("recusa NaN e Infinity sem propagar o lixo para a tela", () => {
    expect(precoExibido({ preco: 6000, precoPromocional: NaN }).por).toBe(6000);
    expect(precoExibido({ preco: 6000, precoPromocional: Infinity }).por).toBe(
      6000,
    );
  });

  it("um centavo de desconto ja e promocao — a tolerancia e zero nos dois lados", () => {
    expect(precoExibido({ preco: 6000, precoPromocional: 5999 })).toEqual({
      de: 6000,
      por: 5999,
    });
  });

  it("temPromocao responde exatamente ao que precoExibido decidiu", () => {
    expect(temPromocao({ preco: 6000, precoPromocional: 5400 })).toBe(true);
    expect(temPromocao({ preco: 6000, precoPromocional: 6000 })).toBe(false);
    expect(temPromocao({ preco: 6000 })).toBe(false);
  });
});

describe("descontoPercentual — o numero do selo", () => {
  it("10% exatos saem como 10", () => {
    expect(descontoPercentual(6000, 5400)).toBe(10);
  });

  it("ARREDONDA PARA BAIXO: 9,6% vira 9, nunca 10", () => {
    // 5000 -> 4520 e 9,6%. Um selo de "10%" seria desmentido pela conta da
    // sacola; prometer menos do que se entrega nunca gera reclamacao.
    expect(descontoPercentual(5000, 4520)).toBe(9);
  });

  it("desconto pequeno demais para virar 1% devolve 0, e o selo some", () => {
    expect(descontoPercentual(6000, 5999)).toBe(0);
  });

  it("devolve 0 para entrada sem sentido em vez de NaN ou Infinity na tela", () => {
    expect(descontoPercentual(0, 0)).toBe(0);
    expect(descontoPercentual(5400, 6000)).toBe(0);
    expect(descontoPercentual(-1, 10)).toBe(0);
  });
});

describe("precoMinimoExibido — o 'a partir de' do card de linha", () => {
  it("sem promocao nenhuma, e o menor preco de catalogo", () => {
    const lote = loteCom([{ preco: 7000 }, { preco: 6000 }, { preco: 8000 }]);
    expect(precoMinimoExibido(lote)).toEqual({ de: null, por: 6000 });
  });

  it("ignora variante sem preco, como precoMinimo sempre ignorou", () => {
    const lote = loteCom([{ preco: 0 }, { preco: 6000 }]);
    expect(precoMinimoExibido(lote)).toEqual({ de: null, por: 6000 });
  });

  it("linha sem nenhuma variante com preco devolve null — o caso real da Canela", () => {
    expect(precoMinimoExibido(loteCom([{ preco: 0 }]))).toBeNull();
  });

  it("O PAR SAI INTEIRO DA MESMA VARIANTE, e este e o caso que faria o card mentir", () => {
    // 250 g a R$ 60 sem promocao; 500 g a R$ 70 com 20% (= R$ 56). O menor
    // CATALOGO e 6000 e o menor EFETIVO e 5600, e sao variantes diferentes.
    // Casar os dois anunciaria "de R$ 60 por R$ 56" — 6,7% que nao existem em
    // SKU nenhum.
    const lote = loteCom([
      { preco: 6000 },
      { preco: 7000, precoPromocional: 5600 },
    ]);
    expect(precoMinimoExibido(lote)).toEqual({ de: 7000, por: 5600 });
  });

  it("a promocao que nao ganha do catalogo nao vira o 'a partir de'", () => {
    const lote = loteCom([
      { preco: 5000 },
      { preco: 7000, precoPromocional: 6500 },
    ]);
    expect(precoMinimoExibido(lote)).toEqual({ de: null, por: 5000 });
  });

  it("empate no efetivo desempata pelo menor catalogo, e nao pela ordem do JSON", () => {
    const comPromoPrimeiro = loteCom([
      { preco: 9000, precoPromocional: 5000 },
      { preco: 5000 },
    ]);
    const comPromoDepois = loteCom([
      { preco: 5000 },
      { preco: 9000, precoPromocional: 5000 },
    ]);
    expect(precoMinimoExibido(comPromoPrimeiro)).toEqual({ de: null, por: 5000 });
    expect(precoMinimoExibido(comPromoDepois)).toEqual({ de: null, por: 5000 });
  });
});

describe("precoPromocionalDaApi — a travessia de reais para centavos", () => {
  it("aceita a string do pg, que e como `numeric` chega", () => {
    expect(precoPromocionalDaApi("54.00", 6000)).toBe(5400);
  });

  it("aceita numero tambem", () => {
    expect(precoPromocionalDaApi(54, 6000)).toBe(5400);
  });

  it("usa a MESMA conta de sobreporAoVivo — arredondamento no centavo", () => {
    // 44.910000000000004 e o resultado real de 10% sobre 49.90 em float; o
    // backend ja arredonda, mas a vitrine nao depende disso.
    expect(precoPromocionalDaApi(44.910000000000004, 4990)).toBe(4491);
  });

  it("ausente, nulo e vazio nao viram promocao", () => {
    expect(precoPromocionalDaApi(undefined, 6000)).toBeUndefined();
    expect(precoPromocionalDaApi(null, 6000)).toBeUndefined();
    expect(precoPromocionalDaApi("", 6000)).toBeUndefined();
  });

  it("texto que nao e numero nao vira promocao", () => {
    expect(precoPromocionalDaApi("de graca", 6000)).toBeUndefined();
  });

  it("valor que nao desconta nao atravessa — nao ocupa a sacola nem o corpo do checkout", () => {
    expect(precoPromocionalDaApi(60, 6000)).toBeUndefined();
    expect(precoPromocionalDaApi(70, 6000)).toBeUndefined();
    expect(precoPromocionalDaApi(0, 6000)).toBeUndefined();
  });
});
