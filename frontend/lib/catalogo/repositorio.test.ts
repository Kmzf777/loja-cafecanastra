import { describe, it, expect } from "vitest";
import { listarLotes, obterLote, listarSlugs, precoMinimo } from "./repositorio";

describe("repositorio do catalogo", () => {
  it("lista todos os lotes sem filtro", async () => {
    expect((await listarLotes()).length).toBeGreaterThanOrEqual(6);
  });

  it("filtra por linha", async () => {
    const r = await listarLotes({ linha: "suave" });
    expect(r.length).toBeGreaterThan(0);
    expect(r.every((l) => l.linha === "suave")).toBe(true);
  });

  it("filtra por faixa de ponto de torra", async () => {
    const r = await listarLotes({ pontoTorraMin: 3, pontoTorraMax: 4 });
    expect(r.every((l) => l.pontoTorra >= 3 && l.pontoTorra <= 4)).toBe(true);
  });

  it("filtra por SCA minima", async () => {
    const r = await listarLotes({ scaMin: 84 });
    expect(r.every((l) => l.sca >= 84)).toBe(true);
  });

  it("filtra por nota de sabor", async () => {
    const todos = await listarLotes();
    const nota = todos[0].notas[0];
    const r = await listarLotes({ notas: [nota] });
    expect(r.every((l) => l.notas.includes(nota))).toBe(true);
  });

  it("combina filtros", async () => {
    const r = await listarLotes({ linha: "classico", scaMin: 80 });
    expect(r.every((l) => l.linha === "classico" && l.sca >= 80)).toBe(true);
  });

  it("devolve lista vazia quando nada casa, nunca erro", async () => {
    expect(await listarLotes({ scaMin: 99 })).toEqual([]);
  });

  it("obtem lote por slug", async () => {
    const lote = await obterLote("casca-danta");
    expect(lote?.slug).toBe("casca-danta");
  });

  it("devolve null para slug inexistente", async () => {
    expect(await obterLote("nao-existe")).toBeNull();
  });

  it("lista os slugs para generateStaticParams", async () => {
    const slugs = await listarSlugs();
    expect(slugs).toContain("casca-danta");
  });

  it("calcula o preco minimo do lote", async () => {
    const lote = await obterLote("casca-danta");
    expect(precoMinimo(lote!)).toBe(Math.min(...lote!.variantes.map((v) => v.preco)));
  });
});
