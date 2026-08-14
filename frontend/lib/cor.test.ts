import { describe, it, expect } from "vitest";
import { razaoContraste } from "./cor";
import { CORES } from "./tokens";

/**
 * As cores vem de lib/tokens.ts, que lib/tokens.test.ts amarra ao bloco @theme
 * de app/globals.css. Antes havia uma copia dos hex aqui dentro: trocar
 * --color-juta no CSS deixava estes testes verdes sobre o valor antigo, e as
 * duas proibicoes que o estetica.md §4.1 manda codificar paravam de proteger
 * sem ninguem perceber. Agora mudar o token quebra o teste, que e o ponto.
 */
const BRANCO = "#FFFFFF";

describe("razaoContraste", () => {
  // Ancora de sanidade. Todas as demais assercoes sao de limiar (">= 4.5",
  // "< 4.5") e passariam mesmo com um erro sutil nos coeficientes de
  // luminancia. Preto contra branco tem um unico valor certo: 21.
  it("da exatamente 21 entre preto e branco", () => {
    expect(razaoContraste("#000000", "#FFFFFF")).toBeCloseTo(21, 10);
  });

  it("da 1 para a cor contra ela mesma", () => {
    expect(razaoContraste(CORES.juta, CORES.juta)).toBeCloseTo(1, 10);
  });

  it("e simetrica na ordem dos argumentos", () => {
    expect(razaoContraste(CORES.fuligem, CORES.cal))
      .toBeCloseTo(razaoContraste(CORES.cal, CORES.fuligem), 10);
  });
});

describe("contraste dos tokens", () => {
  it("fuligem sobre cal atinge AAA", () => {
    expect(razaoContraste(CORES.fuligem, CORES.cal)).toBeGreaterThanOrEqual(7);
  });

  it("branco sobre vermelho atinge AA", () => {
    expect(razaoContraste(BRANCO, CORES.vermelho)).toBeGreaterThanOrEqual(4.5);
  });

  it("PROIBIDO: branco sobre juta nao atinge AA", () => {
    expect(razaoContraste(BRANCO, CORES.juta)).toBeLessThan(4.5);
  });

  it("PROIBIDO: vermelho sobre mata nao atinge AA", () => {
    expect(razaoContraste(CORES.vermelho, CORES.mata)).toBeLessThan(4.5);
  });
});
