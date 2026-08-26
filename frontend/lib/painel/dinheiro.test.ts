import { describe, it, expect } from "vitest";
import {
  formatarCentavos,
  formatarReais,
  reaisParaCentavos,
  centavosParaReais,
} from "./dinheiro";

/**
 * O REAL É ESCRITO COM ESPAÇO NÃO SEPARÁVEL, E ISSO NÃO É ACIDENTE.
 *
 * `Intl.NumberFormat("pt-BR", { currency: "BRL" })` põe U+00A0 entre "R$" e o
 * número, seguindo o CLDR. É tipografia correta: impede que o símbolo da moeda
 * fique órfão no fim da linha, separado do valor.
 *
 * Está aqui como constante nomeada, e não como um caractere invisível colado no
 * meio de um literal, porque um `"R$ 149,00"` digitado com espaço comum falha
 * com a mensagem mais inútil que o Vitest sabe produzir — `expected 'R$ 149,00'
 * to be 'R$ 149,00'`, duas strings visualmente idênticas. Quem cair nisso daqui
 * a seis meses lê este comentário em vez de perder a tarde.
 *
 * A vitrine já emite o mesmo NBSP em `lib/catalogo/repositorio.ts:308`
 * (`formatarPreco`), então normalizar para espaço comum aqui faria o painel e a
 * loja escreverem preço de dois jeitos diferentes.
 */
const NBSP = "\u00A0";
const reais = (texto: string) => `R$${NBSP}${texto}`;

describe("formatarCentavos", () => {
  it("formata inteiro de centavos", () => {
    expect(formatarCentavos(14900)).toBe(reais("149,00"));
  });
  it("formata zero sem virar traço", () => {
    expect(formatarCentavos(0)).toBe(reais("0,00"));
  });
  it("devolve traço para ausência, que é diferente de zero", () => {
    expect(formatarCentavos(null)).toBe("—");
  });
});

describe("formatarReais", () => {
  it("aceita a STRING que o pg devolve para numeric", () => {
    expect(formatarReais("149.00")).toBe(reais("149,00"));
  });
  it("aceita número", () => {
    expect(formatarReais(59.9)).toBe(reais("59,90"));
  });
  it("escreve o preço igualzinho ao formatador de centavos", () => {
    // A garantia que sustenta a divisão inteira deste módulo: as duas portas
    // produzem a MESMA string para o mesmo dinheiro. Se um dia divergirem, a
    // mesma venda apareceria escrita de dois jeitos em duas telas do painel.
    expect(formatarReais("59.90")).toBe(formatarCentavos(5990));
  });
  it("devolve traço para ausência", () => {
    expect(formatarReais(null)).toBe("—");
  });
});

describe("conversão", () => {
  it("reais para centavos arredonda ao centavo, sem erro de ponto flutuante", () => {
    expect(reaisParaCentavos("59.90")).toBe(5990);
    expect(reaisParaCentavos(0.07)).toBe(7);
    expect(reaisParaCentavos("1.005")).toBe(101);
  });

  it("aceita o formato que o gestor digita, com vírgula", () => {
    expect(reaisParaCentavos("59,90")).toBe(5990);
  });

  it("centavos para reais devolve número, não string", () => {
    expect(centavosParaReais(5990)).toBe(59.9);
  });

  it("devolve null para entrada vazia — vazio NÃO é zero", () => {
    expect(reaisParaCentavos("")).toBeNull();
    expect(reaisParaCentavos(null)).toBeNull();
  });
});
