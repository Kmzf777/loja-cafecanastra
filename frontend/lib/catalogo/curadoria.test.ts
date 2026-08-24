import { describe, it, expect } from "vitest";
import {
  maisVendidos,
  escolhaDoProdutor,
  kitsECaixas,
  TETO_DA_SECAO,
} from "./curadoria";
import { PRODUTOS } from "./produtos";

/**
 * A curadoria é editorial — a casa edita um JSON à mão. Estes testes travam as
 * três coisas que um arquivo editado à mão erra: ordem, teto e o dia em que
 * alguém apagar tudo.
 */
describe("curadoria", () => {
  it("respeita a ordem declarada, crescente", () => {
    const skus = maisVendidos().map((p) => p.sku);
    expect(skus[0]).toBe("classico-graos-250");
    expect(skus[1]).toBe("suave-graos-250");
  });

  it("nunca passa de seis cards", () => {
    expect(maisVendidos().length).toBeLessThanOrEqual(TETO_DA_SECAO);
    expect(escolhaDoProdutor().length).toBeLessThanOrEqual(TETO_DA_SECAO);
    expect(kitsECaixas().length).toBeLessThanOrEqual(TETO_DA_SECAO);
  });

  it("não repete a mesma vitrine nas duas seções curadas", () => {
    // Se "Escolha do produtor" devolvesse os mesmos SKUs de "Mais vendidos",
    // a home teria dois carrosséis idênticos e um deles seria ruído.
    const a = new Set(maisVendidos().map((p) => p.sku));
    const b = escolhaDoProdutor().map((p) => p.sku);
    expect(b.some((sku) => !a.has(sku))).toBe(true);
  });

  it("só põe caixa comprável em Nossos Kits, e não preenche com esgotado", () => {
    // §5.3 do spec: quatro que vendem é melhor que seis com dois mortos.
    for (const kit of kitsECaixas()) {
      expect(kit.estoque, kit.sku).toBeGreaterThan(0);
      expect(kit.precoCentavos, kit.sku).toBeGreaterThan(0);
    }
  });

  it("Nossos Kits traz caixa de verdade, não pacote avulso", () => {
    for (const kit of kitsECaixas()) {
      const ehCaixa = kit.pacotes > 1 || kit.kit === true;
      expect(ehCaixa, kit.sku).toBe(true);
    }
  });

  it("cai para os compráveis mais baratos quando a curadoria está vazia", () => {
    // A queda do §6.0: o dia em que alguém apagar uma linha do JSON por
    // engano, a home continua vendendo em vez de renderizar seção vazia.
    //
    // O CATÁLOGO ENTRA INTEIRO, SÓ QUE SEM NINGUÉM DECLARANDO O CAMPO — que é
    // o cenário do §6.0. Passar `[]` provaria outra coisa: catálogo vazio não
    // tem por onde cair, e devolver produto ali seria inventar vitrine.
    const semCuradoria = maisVendidos(
      PRODUTOS.filter((p) => p.maisVendido === undefined),
    );
    expect(semCuradoria.length).toBeGreaterThan(0);
    expect(semCuradoria.length).toBeLessThanOrEqual(TETO_DA_SECAO);
    const precos = semCuradoria.map((p) => p.precoCentavos);
    expect([...precos].sort((a, b) => a - b)).toEqual(precos);
  });

  it("nunca oferece o que não dá para comprar", () => {
    for (const p of [...maisVendidos(), ...escolhaDoProdutor()]) {
      expect(p.precoCentavos, p.sku).toBeGreaterThan(0);
    }
  });
});
