import { describe, it, expect } from "vitest";
import {
  listarLotes,
  obterLote,
  listarSlugs,
  precoMinimo,
  temEstoque,
  acharVariante,
  embalagensDe,
} from "./repositorio";

describe("repositorio do catalogo", () => {
  it("lista todas as linhas sem filtro", async () => {
    expect((await listarLotes()).length).toBeGreaterThanOrEqual(5);
  });

  it("filtra por linha", async () => {
    const r = await listarLotes({ linha: "suave" });
    expect(r.length).toBeGreaterThan(0);
    expect(r.every((l) => l.linha === "suave")).toBe(true);
  });

  it("filtra por faixa de ponto de torra", async () => {
    const r = await listarLotes({ pontoTorraMin: 3, pontoTorraMax: 4 });
    expect(r.length).toBeGreaterThan(0);
    expect(r.every((l) => l.pontoTorra >= 3 && l.pontoTorra <= 4)).toBe(true);
  });

  it("filtra por formato", async () => {
    const r = await listarLotes({ formato: "graos" });
    expect(r.length).toBeGreaterThan(0);
    expect(r.every((l) => l.variantes.some((v) => v.formato === "graos"))).toBe(true);
  });

  it("filtra por peso do pacote", async () => {
    const r = await listarLotes({ pesoGramas: 1000 });
    expect(r.length).toBeGreaterThan(0);
    expect(r.every((l) => l.variantes.some((v) => v.pesoGramas === 1000))).toBe(true);
  });

  it("esconde o que esta esgotado quando pedido", async () => {
    const r = await listarLotes({ soDisponiveis: true });
    expect(r.length).toBeGreaterThan(0);
    expect(r.every(temEstoque)).toBe(true);
  });

  it("filtra por nota de sabor", async () => {
    const todos = await listarLotes();
    const nota = todos[0].notas[0];
    const r = await listarLotes({ notas: [nota] });
    expect(r.every((l) => l.notas.includes(nota))).toBe(true);
  });

  it("combina filtros", async () => {
    const r = await listarLotes({ linha: "classico", formato: "moido" });
    expect(
      r.every(
        (l) => l.linha === "classico" && l.variantes.some((v) => v.formato === "moido"),
      ),
    ).toBe(true);
  });

  it("devolve lista vazia quando nada casa, nunca erro", async () => {
    expect(await listarLotes({ pontoTorraMin: 5, pontoTorraMax: 1 })).toEqual([]);
  });

  it("ordena por torra nos dois sentidos", async () => {
    const asc = await listarLotes({}, "torra-asc");
    const desc = await listarLotes({}, "torra-desc");
    expect(asc[0].pontoTorra).toBeLessThanOrEqual(asc.at(-1)!.pontoTorra);
    expect(desc[0].pontoTorra).toBeGreaterThanOrEqual(desc.at(-1)!.pontoTorra);
  });

  it("ordena por preco sem quebrar com linha sem preco", async () => {
    // Uma linha esgotada tem precoMinimo null. `Math.min` sobre isso viraria
    // NaN e a ordenacao embaralharia silenciosamente.
    const r = await listarLotes({}, "preco-asc");
    const precos = r.map(precoMinimo).filter((p): p is number => p !== null);
    expect(precos).toEqual([...precos].sort((a, b) => a - b));
    expect(r.length).toBeGreaterThan(0);
  });

  it("obtem lote por slug", async () => {
    const lote = await obterLote("classico");
    expect(lote?.slug).toBe("classico");
  });

  it("devolve null para slug inexistente", async () => {
    expect(await obterLote("casca-danta")).toBeNull();
  });

  it("lista os slugs para generateStaticParams", async () => {
    const slugs = await listarSlugs();
    expect(slugs).toContain("classico");
    expect(slugs).toContain("suave");
  });

  it("calcula o preco minimo da linha", async () => {
    const lote = await obterLote("classico");
    // 250 g em graos, o mais barato do Classico na loja.
    expect(precoMinimo(lote!)).toBe(3970);
  });

  it("devolve preco nulo, e nao zero, para linha sem variante com preco", async () => {
    const canela = await obterLote("canela");
    expect(canela).not.toBeNull();
    expect(precoMinimo(canela!)).toBeNull();
  });

  it("acha a variante exata por moagem, peso e embalagem", async () => {
    const lote = await obterLote("suave");
    const v = acharVariante(lote!, "grao", 500, 1);
    expect(v?.preco).toBe(6570);
    expect(v?.formato).toBe("graos");
  });

  it("devolve undefined para combinacao inexistente, em vez de escondê-la", async () => {
    const lote = await obterLote("microlote");
    // O Microlote so existe em 250 g; 1 kg nao e vendido.
    expect(acharVariante(lote!, "grao", 1000, 1)).toBeUndefined();
  });

  it("lista as embalagens de uma combinacao", async () => {
    const lote = await obterLote("classico");
    // 500 g em grao existe avulso e em caixa fechada com 4.
    expect(embalagensDe(lote!, "grao", 500)).toEqual([1, 4]);
    // 250 g em grao so avulso.
    expect(embalagensDe(lote!, "grao", 250)).toEqual([1]);
  });
});
