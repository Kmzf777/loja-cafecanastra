import { describe, it, expect } from "vitest";
import { LOTES } from "./mock";
import { MOAGENS } from "./tipos";

describe("mock do catalogo", () => {
  it("tem ao menos 6 lotes", () => {
    expect(LOTES.length).toBeGreaterThanOrEqual(6);
  });

  it("tem slugs unicos", () => {
    const slugs = LOTES.map((l) => l.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
  });

  it("tem preco inteiro em centavos e positivo", () => {
    for (const lote of LOTES) {
      for (const v of lote.variantes) {
        expect(Number.isInteger(v.preco)).toBe(true);
        expect(v.preco).toBeGreaterThan(0);
      }
    }
  });

  it("tem ao menos uma variante por lote", () => {
    for (const lote of LOTES) expect(lote.variantes.length).toBeGreaterThan(0);
  });

  it("so usa moagens do contrato", () => {
    const validas = new Set(MOAGENS.map((m) => m.valor));
    for (const lote of LOTES) {
      for (const v of lote.variantes) expect(validas.has(v.moagem)).toBe(true);
    }
  });

  it("tem ponto de torra entre 1 e 5", () => {
    for (const lote of LOTES) {
      expect(lote.pontoTorra).toBeGreaterThanOrEqual(1);
      expect(lote.pontoTorra).toBeLessThanOrEqual(5);
    }
  });

  it("tem altitude real por lote — requisito do Escolha pela Serra", () => {
    for (const lote of LOTES) expect(lote.lavoura.altitude).toBeGreaterThan(0);
  });

  it("tem altitudes distintas, senao o eixo da serra nao existe", () => {
    const alts = LOTES.map((l) => l.lavoura.altitude);
    expect(new Set(alts).size).toBe(alts.length);
  });

  it("tem alt text descritivo em toda foto", () => {
    for (const lote of LOTES) {
      expect(lote.fotos.sabor.alt.length).toBeGreaterThan(10);
      expect(lote.fotos.pacote.alt.length).toBeGreaterThan(10);
    }
  });
});
