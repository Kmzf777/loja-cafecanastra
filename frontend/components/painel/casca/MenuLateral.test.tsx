import { describe, it, expect, vi } from "vitest";
import { renderizar } from "@/lib/teste/renderizar";
import { SERRA_PATH } from "@/components/marca/Serra";
import { MENU } from "./menu.logica";

/**
 * `vi.hoisted` e não um `let` solto: `vi.mock` é içado para cima dos imports, e
 * uma variável de módulo referenciada dentro da fábrica estoura em TDZ. O
 * objeto vem de `hoisted`, sobe junto, e cada teste só troca o campo dentro
 * dele.
 */
const { rota } = vi.hoisted(() => ({ rota: { caminho: "/dashboard" } }));
vi.mock("next/navigation", () => ({ usePathname: () => rota.caminho }));

import { MenuLateral } from "./MenuLateral";

function menuEm(caminho: string) {
  rota.caminho = caminho;
  return renderizar(<MenuLateral />);
}

const TODOS_OS_ITENS = MENU.flatMap((g) => g.itens);

describe("MenuLateral", () => {
  it("desenha todo item do módulo puro, com o href dele", () => {
    const { container } = menuEm("/dashboard");
    const hrefs = [...container.querySelectorAll("a")].map((a) =>
      a.getAttribute("href"),
    );
    for (const item of TODOS_OS_ITENS) expect(hrefs).toContain(item.href);
  });

  /**
   * R20 — ícone sem texto não é compreendido, tem alvo menor pela lei de Fitts
   * e não ensina o vocabulário do sistema. Este teste é a trava contra a
   * "barra fininha só de ícones" que todo painel tenta virar quando falta
   * espaço.
   */
  it("nenhum item é só ícone: todo link tem rótulo E pictograma", () => {
    const { container } = menuEm("/dashboard");
    const links = [...container.querySelectorAll("nav a")];
    expect(links.length).toBe(TODOS_OS_ITENS.length);
    for (const link of links) {
      expect(link.textContent?.trim()).not.toBe("");
      expect(link.querySelector("svg")).not.toBeNull();
    }
  });

  it("todo item do menu tem um pictograma próprio — nenhum <svg> vazio", () => {
    const { container } = menuEm("/dashboard");
    for (const link of container.querySelectorAll("nav a")) {
      const svg = link.querySelector("svg")!;
      expect(svg.childElementCount).toBeGreaterThan(0);
    }
  });

  /**
   * A regra que o `itemAtivo` decide e que o DOM tem de refletir: UM. Dois
   * "página atual" na mesma tela fazem o leitor de tela anunciar duas páginas
   * atuais, e nenhuma das duas é confiável depois disso.
   */
  it.each([
    ["/dashboard", "/dashboard"],
    ["/dashboard/pedidos", "/dashboard/pedidos"],
    ["/dashboard/pedidos/abc-123", "/dashboard/pedidos"],
  ])("em %s acende exatamente um item, e é %s", (caminho, esperado) => {
    const { container } = menuEm(caminho);
    const acesos = [...container.querySelectorAll('[aria-current="page"]')];
    expect(acesos).toHaveLength(1);
    expect(acesos[0].getAttribute("href")).toBe(esperado);
  });

  it("em rota que não é do menu, nada fica aceso", () => {
    const { container } = menuEm("/dashboard/inventado");
    expect(container.querySelectorAll('[aria-current="page"]')).toHaveLength(0);
  });

  /**
   * Uma das TRÊS aparições da "mão" no painel inteiro (spec §2.5). A asserção é
   * sobre o path REAL do componente de marca, e não sobre "existe um svg": o
   * dia em que a serra for trocada pelo traço vetorizado de verdade, este teste
   * continua verde sozinho, porque ele importa a constante em vez de copiá-la.
   */
  it("a marca no topo é a serra, herdando a cor por currentColor", () => {
    const { container } = menuEm("/dashboard");
    const serra = [...container.querySelectorAll("path")].find(
      (p) => p.getAttribute("d") === SERRA_PATH,
    );
    expect(serra).toBeDefined();
    expect(serra!.getAttribute("stroke")).toBe("currentColor");
  });

  it("a barra se apresenta ao leitor de tela como navegação nomeada", () => {
    const { container } = menuEm("/dashboard");
    const nav = container.querySelector("nav")!;
    expect(nav.getAttribute("aria-label")).toBe("Seções do painel");
  });

  /**
   * Cada grupo é uma lista NOMEADA. Sem o nome, quem navega por listas ouve
   * "lista com 3 itens" cinco vezes seguidas e não sabe qual é qual — e o
   * título já está na tela, então repeti-lo numa string à parte criaria a
   * segunda cópia que um dia discorda da primeira.
   */
  it("cada grupo com título aponta para o cabeçalho que já está na tela", () => {
    const { container } = menuEm("/dashboard");
    const comTitulo = MENU.filter((g) => g.titulo);
    const listasNomeadas = [...container.querySelectorAll("ul[aria-labelledby]")];
    expect(listasNomeadas).toHaveLength(comTitulo.length);
    for (const ul of listasNomeadas) {
      /* `getElementById` e não `querySelector("#...")`: o `useId()` do React 18
         devolve ids com guilhemetes (`«r0»`), que são sintaxe inválida num
         seletor CSS e precisariam de `CSS.escape` — que este jsdom não expõe.
         Buscar por id não passa por parser de seletor nenhum. */
      const alvo = container.ownerDocument.getElementById(
        ul.getAttribute("aria-labelledby")!,
      );
      expect(alvo).not.toBeNull();
      expect(alvo!.textContent?.trim()).not.toBe("");
    }
  });
});
