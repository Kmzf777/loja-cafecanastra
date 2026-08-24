import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

/**
 * A ORDEM DA HOME, provada pelo texto do arquivo.
 *
 * Não é o teste que se gostaria de ter — o ideal renderizaria a página. Mas a
 * home é um Server Component `async` que faz `fetch` ao repositório, e a suíte
 * roda em `environment: "node"` sem DOM nem servidor. Provar a ORDEM DAS
 * SEÇÕES pela posição no arquivo é o que dá para provar aqui, e é justamente
 * o que esta mudança pode quebrar sem ninguém ver.
 */
const fonte = readFileSync(new URL("./page.tsx", import.meta.url), "utf8");

/**
 * A MARCA É SEMPRE A DO JSX, NUNCA O NOME NU DA COISA — `<SecaoDoBlog` e não
 * `SecaoDoBlog`, `t.clubeTitulo` e não `clubeTitulo`.
 *
 * O nome nu casa três vezes no arquivo: no import lá em cima, na tabela de
 * textos do meio e na seção de fato. `indexOf` devolve a PRIMEIRA, que é a
 * linha do import — e um teste de ordem escrito sobre a ordem dos imports
 * mede a ordem errada e passa (ou falha) por acidente. O que precisa ser
 * verdade é a ordem em que as seções aparecem na TELA, e na tela cada uma tem
 * exatamente uma marca: a tag que a monta, ou o texto que ela imprime.
 */
function posicao(marca: string): number {
  const i = fonte.indexOf(marca);
  expect(i, `não achei ${marca}`).toBeGreaterThan(-1);
  return i;
}

/**
 * O código sem os comentários — a mesma função, pelo mesmo motivo, que
 * `paginas-estaticas.test.ts` ao lado já documenta.
 *
 * Este repositório EXPLICA a decisão no próprio arquivo, e a home traz escrito
 * por extenso que não lê `cookies()` nem a query da URL. Uma busca por texto
 * cru acusaria justamente a frase que PROMETE o contrário do defeito, e o
 * conserto seria mutilar um comentário verdadeiro para agradar ao teste.
 * Comentário é prosa, não comportamento.
 */
function semComentarios(texto: string): string {
  return texto.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

describe("ordem da home", () => {
  it("põe produto acima de conteúdo", () => {
    expect(posicao("<TrilhaDeCategorias")).toBeLessThan(
      posicao("seccoes.maisVendidos"),
    );
    expect(posicao("seccoes.maisVendidos")).toBeLessThan(posicao("seccoes.kits"));
    expect(posicao("seccoes.kits")).toBeLessThan(
      posicao("seccoes.escolhaDoProdutor"),
    );
    expect(posicao("seccoes.escolhaDoProdutor")).toBeLessThan(
      posicao("t.clubeTitulo"),
    );
    expect(posicao("t.clubeTitulo")).toBeLessThan(posicao("<SecaoDoBlog"));
    expect(posicao("<SecaoDoBlog")).toBeLessThan(posicao("t.etapasTitulo"));
  });

  it("a trilha vem depois da faixa de prova", () => {
    expect(posicao("t.provaRotulo")).toBeLessThan(posicao("<TrilhaDeCategorias"));
  });

  it("o bloco História saiu — /historia já o conta inteiro", () => {
    expect(fonte).not.toContain("historiaTitulo");
    expect(fonte).not.toContain("historiaImagemAlt");
  });

  it("continua estática", () => {
    // Sem isto a home paga render de servidor a cada visita — está medido em
    // docs/performance-dev.md §7.
    expect(fonte).toContain("generateStaticParams");
    expect(fonte).toContain("export const revalidate");
    const codigo = semComentarios(fonte);
    expect(codigo).not.toContain("cookies()");
    expect(codigo).not.toContain("searchParams");
  });

  it("nunca põe duas superfícies escuras seguidas", () => {
    // §7.1 do estetica.md. As escuras são fuligem e mata; entre uma e outra
    // tem de haver clara.
    const escuras = [...fonte.matchAll(/bg-(fuligem|mata)\b/g)].map(
      (m) => m.index!,
    );
    const claras = [...fonte.matchAll(/bg-(cal|juta-claro)\b/g)].map(
      (m) => m.index!,
    );
    for (let i = 1; i < escuras.length; i++) {
      const houveClara = claras.some((c) => c > escuras[i - 1] && c < escuras[i]);
      expect(houveClara, `duas escuras seguidas na posição ${escuras[i]}`).toBe(
        true,
      );
    }
  });
});
