import { describe, it, expect } from "vitest";
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { MENU, itemAtivo } from "./menu.logica";

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

  /**
   * TODA TELA DO PAINEL TEM UM CAMINHO NO MENU — e este teste existe porque uma
   * delas não tinha.
   *
   * `/dashboard/administradores` nasceu na Onda 4 e ficou órfã: nenhum link em
   * lugar nenhum do menu, e o único acesso era um parágrafo dentro de Ajustes.
   * Uma tela que só se alcança por quem já sabe o endereço é uma tela que não
   * existe — e esta é a que impede a loja de perder a gestão quando alguém
   * esquece a senha, que neste projeto é irrecuperável.
   *
   * A varredura é do DIRETÓRIO, e não uma lista escrita à mão: uma lista aqui
   * seria a segunda cópia do mapa do painel, e o próximo órfão nasceria com o
   * teste verde. A única exclusão que restou é a das pastas entre parênteses e
   * colchetes, que são route group e segmento dinâmico — nenhuma das duas vira
   * uma tela com endereço próprio.
   *
   * ATÉ A ONDA 7 HAVIA UMA SEGUNDA EXCLUSÃO, `legado`, e ela sumiu junto com o
   * painel antigo. Está dito aqui porque a lista de exceções é o lugar onde
   * uma tela órfã se esconde com o teste verde: quem precisar acrescentar a
   * próxima tem de escrever o porquê ao lado, como o `legado` tinha.
   */
  it("nenhuma tela do painel fica órfã de menu", () => {
    const RAIZ = join(__dirname, "..", "..", "..", "app", "dashboard", "(protegido)");

    const telas = readdirSync(RAIZ, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => e.name)
      .filter((nome) => !nome.startsWith("(") && !nome.startsWith("["));

    const hrefs = MENU.flatMap((g) => g.itens.map((i) => i.href));
    for (const tela of telas) {
      expect(hrefs, `a tela /dashboard/${tela} não tem link no menu`).toContain(
        `/dashboard/${tela}`,
      );
    }
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
