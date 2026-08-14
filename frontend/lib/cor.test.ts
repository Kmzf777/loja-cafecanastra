import { describe, it, expect } from "vitest";
import { razaoContraste } from "./cor";

const T = {
  fuligem: "#14110E",
  cal: "#F1F0EA",
  juta: "#C9A87A",
  mata: "#2C3B2E",
  vermelho: "#C4231E",
  branco: "#FFFFFF",
};

describe("contraste dos tokens", () => {
  it("fuligem sobre cal atinge AAA", () => {
    expect(razaoContraste(T.fuligem, T.cal)).toBeGreaterThanOrEqual(7);
  });

  it("branco sobre vermelho atinge AA", () => {
    expect(razaoContraste(T.branco, T.vermelho)).toBeGreaterThanOrEqual(4.5);
  });

  it("PROIBIDO: branco sobre juta nao atinge AA", () => {
    expect(razaoContraste(T.branco, T.juta)).toBeLessThan(4.5);
  });

  it("PROIBIDO: vermelho sobre mata nao atinge AA", () => {
    expect(razaoContraste(T.vermelho, T.mata)).toBeLessThan(4.5);
  });
});
