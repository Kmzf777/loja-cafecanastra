import { describe, it, expect } from "vitest";
import { METODOS, MOAGENS } from "./tipos";
import type { Metodo, Moagem, Preparo } from "./tipos";
import { LOTES } from "./produtos";

/**
 * O contrato de MOAGEM e MÉTODO, que até esta mudança eram um tipo só.
 *
 * O tipo antigo tinha sete valores — `grao` mais os seis métodos de preparo —
 * e respondia a duas perguntas diferentes com a mesma palavra: o que entra no
 * pacote (grão ou moído) e como o café vai ser feito em casa. A loja vende
 * dois formatos; os seis métodos apontavam todos para o MESMO SKU, com o mesmo
 * preço e o mesmo estoque.
 *
 * Estes testes são a trava dessa separação. Se alguém devolver os métodos à
 * lista de compra, a PDP volta a mostrar sete botões para dois produtos e a
 * contagem aqui embaixo falha antes de a tela existir.
 */

describe("Moagem — o que se COMPRA", () => {
  it("tem exatamente dois valores, porque a loja vende dois", () => {
    expect(MOAGENS).toHaveLength(2);
    expect(MOAGENS.map((m) => m.valor)).toEqual(["grao", "moido"]);
  });

  it("dá rótulo de tela a cada um", () => {
    for (const m of MOAGENS) expect(m.rotulo.trim().length).toBeGreaterThan(0);
  });

  it("nenhum método de preparo sobrou na lista de compra", () => {
    const valores = new Set<string>(MOAGENS.map((m) => m.valor));
    for (const metodo of METODOS) {
      expect(valores.has(metodo.valor), `${metodo.valor} virou opção de compra`).toBe(
        false,
      );
    }
  });
});

describe("Metodo — como se PREPARA", () => {
  it("guarda os seis métodos que saíram da compra", () => {
    expect(METODOS.map((m) => m.valor)).toEqual([
      "espresso",
      "coado-papel",
      "coador-pano",
      "prensa-francesa",
      "italiana-moka",
      "aeropress",
    ]);
  });

  it("dá rótulo de tela a cada um — a PDP lê daqui, não inventa o seu", () => {
    for (const m of METODOS) expect(m.rotulo.trim().length).toBeGreaterThan(0);
  });

  it("toda receita do catálogo usa um método do contrato", () => {
    // `Preparo.metodo` sempre foi um MÉTODO, e não uma moagem — este teste é o
    // que prova que a mudança de tipo casou com o dado que já existia.
    const validos = new Set<string>(METODOS.map((m) => m.valor));
    for (const lote of LOTES) {
      expect(lote.preparo.length).toBeGreaterThan(0);
      for (const p of lote.preparo) {
        expect(validos.has(p.metodo), `${lote.slug} prepara em "${p.metodo}"`).toBe(
          true,
        );
      }
    }
  });
});

/**
 * Trava de COMPILAÇÃO, não de execução: o vitest apaga os tipos e não olharia
 * para isto. Quem cobra é o `tsc` do `next build`. Se `Preparo.metodo` voltar
 * a ser a união de compra, esta linha deixa de compilar — e "aeropress" some
 * de um dos dois lados sem ninguém perceber.
 */
const RECEITA_DE_AEROPRESS: Preparo = {
  metodo: "aeropress",
  proporcao: "1:13",
  gramas: 16,
  ml: 210,
  temperaturaC: 88,
  tempoSegundos: 120,
  moagem: "Fina",
};

/** O mesmo, do outro lado: a compra só conhece dois valores. */
const COMPRA_MOIDA: Moagem = "moido";
const PREPARO_ESPRESSO: Metodo = "espresso";

describe("as duas uniões não se cruzam mais (trava de compilação)", () => {
  it("carrega as constantes que só compilam com os tipos separados", () => {
    expect(RECEITA_DE_AEROPRESS.metodo).toBe("aeropress");
    expect(COMPRA_MOIDA).toBe("moido");
    expect(PREPARO_ESPRESSO).toBe("espresso");
  });
});
