import { describe, expect, it } from "vitest";
import { filtrarPorTexto, normalizarTexto } from "./busca";
import { LOTES } from "./catalogo/produtos";

describe("normalizarTexto", () => {
  it("tira acento, caixa e espaco das pontas", () => {
    expect(normalizarTexto("  Canastra Clássico ")).toBe("canastra classico");
    expect(normalizarTexto("CANELA")).toBe("canela");
    expect(normalizarTexto("Néctar de Minas")).toBe("nectar de minas");
  });

  it("vazio continua vazio", () => {
    expect(normalizarTexto("")).toBe("");
    expect(normalizarTexto("   ")).toBe("");
  });
});

describe("filtrarPorTexto", () => {
  it("busca vazia ou indefinida devolve a lista intacta", () => {
    expect(filtrarPorTexto(LOTES, undefined)).toBe(LOTES);
    expect(filtrarPorTexto(LOTES, "")).toBe(LOTES);
    expect(filtrarPorTexto(LOTES, "   ")).toBe(LOTES);
  });

  it("acha por nome, ignorando acento e caixa", () => {
    const r = filtrarPorTexto(LOTES, "clássico");
    expect(r.length).toBeGreaterThan(0);
    expect(r.some((l) => l.slug === "classico")).toBe(true);

    // Sem acento acha o mesmo conjunto.
    expect(filtrarPorTexto(LOTES, "classico")).toEqual(r);
  });

  it("acha pelo rotulo da linha", () => {
    const r = filtrarPorTexto(LOTES, "suave");
    expect(r.some((l) => l.linha === "suave")).toBe(true);
  });

  it("acha por nota de sabor, tanto chave quanto rotulo", () => {
    const chocolate = filtrarPorTexto(LOTES, "chocolate");
    expect(chocolate.length).toBeGreaterThan(0);
    expect(chocolate.every((l) => l.notas.includes("chocolate"))).toBe(true);
  });

  it("mais de uma palavra e AND, nao OR", () => {
    const soSuave = filtrarPorTexto(LOTES, "suave");
    const suaveComChocolate = filtrarPorTexto(LOTES, "suave chocolate");
    expect(suaveComChocolate.length).toBeLessThanOrEqual(soSuave.length);
    expect(
      suaveComChocolate.every((l) =>
        `${l.nome} ${l.descricao} ${l.notas.join(" ")}`
          .toLowerCase()
          .includes("chocolate"),
      ),
    ).toBe(true);
  });

  it("o que nao existe devolve lista vazia", () => {
    expect(filtrarPorTexto(LOTES, "guarana com rolha")).toEqual([]);
  });
});
