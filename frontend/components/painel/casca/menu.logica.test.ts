import { describe, it, expect } from "vitest";
import { MENU, itemAtivo, LEGADO, legadoAtivo } from "./menu.logica";

describe("MENU", () => {
  it("nenhuma rota em inglês sobreviveu", () => {
    for (const grupo of MENU) {
      for (const item of grupo.itens) {
        expect(item.href).not.toMatch(/products|orders|settings|clients|addProduct/i);
      }
    }
  });

  it("todo href começa em /dashboard", () => {
    for (const grupo of MENU) {
      for (const item of grupo.itens) {
        expect(item.href.startsWith("/dashboard")).toBe(true);
      }
    }
  });

  it("não há href repetido", () => {
    const hrefs = MENU.flatMap((g) => g.itens.map((i) => i.href));
    expect(new Set(hrefs).size).toBe(hrefs.length);
  });
});

describe("itemAtivo", () => {
  it("a home só acende no caminho exato", () => {
    expect(itemAtivo("/dashboard")).toBe("/dashboard");
    expect(itemAtivo("/dashboard/pedidos")).toBe("/dashboard/pedidos");
  });

  it("mantém o item aceso na rota de detalhe", () => {
    expect(itemAtivo("/dashboard/pedidos/abc-123")).toBe("/dashboard/pedidos");
  });

  it("corta por segmento, não por string", () => {
    expect(itemAtivo("/dashboard/produtos-arquivados")).toBeNull();
  });

  it("devolve null para rota que não está no menu", () => {
    expect(itemAtivo("/dashboard/inventado")).toBeNull();
  });
});

/**
 * O legado é a saída de emergência desta onda, e o teste guarda as duas coisas
 * que fariam o menu mentir: ele NÃO pode ser um item do `MENU` (senão a
 * estrutura do painel novo passa a incluir o velho, e alguém esquece de
 * removê-lo na Onda 6), e ele NÃO pode acender junto de um item do menu novo —
 * dois `aria-current="page"` na mesma tela é o leitor de tela anunciando duas
 * páginas atuais.
 */
describe("o painel antigo", () => {
  it("não é um item do menu novo", () => {
    const hrefs = MENU.flatMap((g) => g.itens.map((i) => i.href));
    expect(hrefs).not.toContain(LEGADO.href);
  });

  it("acende em /dashboard/legado e no que estiver abaixo dele", () => {
    expect(legadoAtivo("/dashboard/legado")).toBe(true);
    expect(legadoAtivo("/dashboard/legado/orders")).toBe(true);
  });

  it("corta por segmento, como o resto do menu", () => {
    expect(legadoAtivo("/dashboard/legado-de-teste")).toBe(false);
  });

  it("nunca acende junto com um item do menu novo", () => {
    for (const caminho of [
      "/dashboard",
      "/dashboard/legado",
      "/dashboard/legado/orders",
      "/dashboard/pedidos/abc-123",
      "/dashboard/inventado",
    ]) {
      const acesos = [itemAtivo(caminho), legadoAtivo(caminho) ? LEGADO.href : null];
      expect(acesos.filter(Boolean).length).toBeLessThanOrEqual(1);
    }
  });
});
