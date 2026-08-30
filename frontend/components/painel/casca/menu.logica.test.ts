import { describe, it, expect } from "vitest";
import { readdirSync } from "node:fs";
import { join } from "node:path";
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
   * teste verde. Pastas entre parênteses são route groups (não viram URL), e
   * `legado` é a saída de emergência que fica FORA do `MENU` de propósito — as
   * duas exceções estão nomeadas para que ninguém acrescente uma terceira sem
   * escrever o porquê.
   */
  it("nenhuma tela do painel fica órfã de menu", () => {
    const RAIZ = join(__dirname, "..", "..", "..", "app", "dashboard", "(protegido)");
    const FORA_DO_MENU = ["legado"];

    const telas = readdirSync(RAIZ, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => e.name)
      .filter((nome) => !nome.startsWith("(") && !nome.startsWith("["))
      .filter((nome) => !FORA_DO_MENU.includes(nome));

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
