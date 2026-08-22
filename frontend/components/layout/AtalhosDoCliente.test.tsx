import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

/**
 * O contador da sacola é a única coisa desta peça que muda de estado, e era ele
 * que estourava a barra de 360px. O teste renderiza para string com
 * `react-dom/server` e lê o HTML — sem jsdom, sem testing-library, sem
 * dependência nova, igual ao `SeletorDeIdioma.test.tsx`.
 *
 * A SACOLA É MOCKADA porque o que interessa aqui é a MARCAÇÃO que cada
 * quantidade produz, não o provedor: montar o <ProvedorDaSacola> devolveria
 * sempre zero (a hidratação do localStorage acontece num efeito, que
 * `renderToStaticMarkup` não roda) e o caso que quebrava — 1 item, 12 itens —
 * ficaria sem teste.
 */
const estado = vi.hoisted(() => ({ quantidade: 0 }));

vi.mock("@/lib/sacola/sacola", () => ({
  useSacola: () => ({ quantidadeTotal: estado.quantidade }),
}));

import { AtalhosDoCliente, type RotulosDeAtalho } from "./AtalhosDoCliente";

const PT: RotulosDeAtalho = {
  conta: "Conta",
  minhaConta: "Minha conta",
  sacola: "Sacola",
  sacolaVazia: "Sacola vazia",
  item: "item",
  itens: "itens",
};

function telefone(quantidade: number) {
  estado.quantidade = quantidade;
  return renderToStaticMarkup(<AtalhosDoCliente r={PT} variante="telefone" />);
}

function barra(quantidade: number) {
  estado.quantidade = quantidade;
  return renderToStaticMarkup(<AtalhosDoCliente r={PT} variante="barra" />);
}

/**
 * A `class` do <a> da sacola — é ela que decide a largura da caixa.
 *
 * A busca é pela TAG inteira e não por um regex de atributo em ordem: o React
 * não promete a ordem em que serializa `href`, `aria-label` e `class`.
 */
function classeDaSacola(saida: string): string {
  const tag = (saida.match(/<a\b[^>]*>/g) ?? []).find((t) =>
    t.includes('href="/sacola"'),
  );
  return tag?.match(/class="([^"]*)"/)?.[1] ?? "";
}

describe("AtalhosDoCliente", () => {
  describe("na barra de telefone", () => {
    it("mantém a MESMA caixa com 0, 1 e 12 itens — é o conserto do estouro", () => {
      // O defeito media 344px de borda com a sacola vazia, 353px com 1 item e
      // 362px com 12 (2px de rolagem horizontal em 360). A causa era a
      // contagem entrar no fluxo. Se a classe da caixa passar a depender da
      // quantidade, a largura volta a depender dela.
      const vazia = classeDaSacola(telefone(0));

      expect(vazia).toContain("size-11");
      expect(classeDaSacola(telefone(1))).toBe(vazia);
      expect(classeDaSacola(telefone(12))).toBe(vazia);
    });

    it("tira a contagem do fluxo em vez de reservar espaço para ela", () => {
      const saida = telefone(12);

      // `absolute` é o que impede o número de empurrar a barra. Sem isto o
      // teste acima passaria com uma caixa de largura fixa grande demais.
      expect(saida).toMatch(/<span[^>]*class="[^"]*absolute[^"]*"[^>]*>12<\/span>/);
    });

    it("não mostra contagem nenhuma com a sacola vazia", () => {
      expect(telefone(0)).not.toContain("<span");
    });

    it("diz Sacola por extenso no rótulo acessível, que é o único texto dela", () => {
      // O glifo é `aria-hidden`: sem o aria-label o leitor de tela anuncia um
      // link sem nome.
      expect(telefone(0)).toContain('aria-label="Sacola vazia"');
      expect(telefone(1)).toContain('aria-label="Sacola · 1 item"');
      expect(telefone(12)).toContain('aria-label="Sacola · 12 itens"');
      expect(telefone(1)).toContain("<svg");
    });

    it("não repete a palavra na tela — o glifo substitui o rótulo visível", () => {
      // `>Sacola<` seria o texto visível; o aria-label não casa com isso.
      expect(telefone(0)).not.toContain(">Sacola<");
    });

    it("não leva a conta para a barra: ela vive no acordeão", () => {
      expect(telefone(0)).not.toContain('href="/account"');
    });
  });

  describe("na barra de desktop", () => {
    it("traz conta e sacola por extenso, com a contagem colada ao rótulo", () => {
      const saida = barra(3);

      expect(saida).toContain('href="/account"');
      expect(saida).toContain("Conta");
      expect(saida).toContain(">Sacola");
      expect(saida).toContain(">3</span>");
    });

    it("nomeia a conta por extenso para quem só ouve", () => {
      // "CONTA" sozinho, no meio de uma lista de links, não diz de quem é.
      expect(barra(0)).toContain('aria-label="Minha conta"');
    });
  });

  it("escreve /sacola e /account crus: são transacionais e não têm idioma", () => {
    // `href()` os devolveria assim de qualquer jeito — o teste trava a decisão
    // para que ninguém os prefixe achando que corrige um esquecimento.
    expect(barra(0)).toContain('href="/sacola"');
    expect(telefone(0)).toContain('href="/sacola"');
  });
});
