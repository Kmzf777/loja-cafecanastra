import { describe, expect, it } from "vitest";
import { formatarCpf, limparCpf, validarCpf } from "./cpf";

describe("limparCpf", () => {
  it("descarta tudo que não é dígito", () => {
    expect(limparCpf("529.982.247-25")).toBe("52998224725");
    expect(limparCpf("abc")).toBe("");
  });

  it("corta no décimo primeiro dígito — colar um número longo não estoura a máscara", () => {
    expect(limparCpf("529982247259999")).toBe("52998224725");
  });
});

describe("formatarCpf", () => {
  it("aplica a máscara completa", () => {
    expect(formatarCpf("52998224725")).toBe("529.982.247-25");
  });

  it("é progressiva: formata o que já foi digitado, sem sufixo fantasma", () => {
    expect(formatarCpf("5")).toBe("5");
    expect(formatarCpf("529")).toBe("529");
    expect(formatarCpf("5299")).toBe("529.9");
    expect(formatarCpf("529982247")).toBe("529.982.247");
    expect(formatarCpf("5299822472")).toBe("529.982.247-2");
  });

  it("reformata entrada já mascarada (o onChange devolve o valor com pontos)", () => {
    expect(formatarCpf("529.982.247-25")).toBe("529.982.247-25");
  });
});

describe("validarCpf", () => {
  it("aceita CPFs com dígitos verificadores corretos", () => {
    // Números de exemplo publicamente conhecidos (gerados pela regra da RFB).
    expect(validarCpf("529.982.247-25")).toBe(true);
    expect(validarCpf("52998224725")).toBe(true);
    expect(validarCpf("111.444.777-35")).toBe(true);
  });

  it("recusa dígito verificador errado", () => {
    expect(validarCpf("529.982.247-26")).toBe(false);
    expect(validarCpf("111.444.777-34")).toBe(false);
  });

  it("recusa os onze dígitos repetidos — passam na conta, mas não são CPF", () => {
    for (const d of "0123456789") {
      expect(validarCpf(d.repeat(11)), d.repeat(11)).toBe(false);
    }
  });

  it("recusa tamanho errado e vazio", () => {
    expect(validarCpf("")).toBe(false);
    expect(validarCpf("5299822472")).toBe(false);
    expect(validarCpf("nem é número")).toBe(false);
  });

  it("cobre o resto zero: dígito verificador 0 não pode virar 11", () => {
    // 460.614.850 produz resto < 2 nas DUAS contas → ambos os DVs são 0. Um
    // `11 - resto` sem o piso devolveria 11 e recusaria um CPF legítimo.
    expect(validarCpf("460.614.850-00")).toBe(true);
  });
});
