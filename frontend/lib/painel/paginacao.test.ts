import { describe, it, expect } from "vitest";

import {
  SALTO,
  intervaloDaPagina,
  paginaValida,
  reguaDePaginas,
  totalDePaginas,
} from "./paginacao";

/**
 * R17 virada em função — e os casos de borda são o motivo de ela existir.
 *
 * Paginação é o código que todo mundo acha trivial e que erra sempre no mesmo
 * lugar: a lista vazia, a última página incompleta e a página que não existe. E
 * os três falham do jeito mais caro possível — desenhando uma lista vazia com
 * ar de resposta legítima, que o gestor lê como "sumiram meus clientes".
 */

describe("totalDePaginas", () => {
  it("divide e arredonda para cima — a última página quase nunca está cheia", () => {
    expect(totalDePaginas(134, 20)).toBe(7);
    expect(totalDePaginas(140, 20)).toBe(7);
    expect(totalDePaginas(141, 20)).toBe(8);
  });

  it("uma linha é uma página", () => {
    expect(totalDePaginas(1, 20)).toBe(1);
  });

  /**
   * ZERO LINHAS DÁ UMA PÁGINA. "Página 1 de 0" não significa nada, e um
   * `totalPaginas` de zero faz `paginaValida` prender tudo em zero — a tela
   * pediria `?pagina=0` ao backend, que devolve a página 1, e o rodapé diria
   * outra coisa do que a tabela mostra.
   */
  it("zero linhas continua sendo UMA página — a página 1, vazia", () => {
    expect(totalDePaginas(0, 20)).toBe(1);
  });

  it.each([
    [-5, 20],
    [Number.NaN, 20],
    [100, 0],
    [100, -1],
    [100, Number.NaN],
  ])("entrada impossível (%s, %s) não devolve 0 nem NaN", (total, porPagina) => {
    expect(totalDePaginas(total, porPagina)).toBe(1);
  });
});

describe("paginaValida — a trava que impede a lista vazia mentirosa", () => {
  it("passa o que existe", () => {
    expect(paginaValida("3", 7)).toBe(3);
    expect(paginaValida(3, 7)).toBe(3);
  });

  /**
   * O CASO DO FAVORITO VELHO: `?pagina=999` numa lista que encolheu. Sem a
   * trava, o backend recebe `offset=19960`, devolve zero linhas, e a tela
   * desenha o estado vazio com o filtro aplicado.
   */
  it("prende na última página quando pedem além do fim", () => {
    expect(paginaValida("999", 7)).toBe(7);
  });

  it("prende em 1 quando pedem antes do começo", () => {
    expect(paginaValida("0", 7)).toBe(1);
    expect(paginaValida("-4", 7)).toBe(1);
  });

  it.each(["", "abc", "1.5.2", null, undefined])(
    "lixo (%s) cai na página 1 em vez de virar NaN na query",
    (bruto) => {
      expect(paginaValida(bruto as string, 7)).toBe(1);
    },
  );

  /** `?pagina=2&pagina=5` — o `searchParams` do Next entrega os dois. */
  it("parâmetro repetido é ambiguidade, e ambiguidade cai no padrão", () => {
    expect(paginaValida(["2", "5"], 7)).toBe(1);
  });

  it("'1.9' é a página 1, não a 2 — trunca, não arredonda", () => {
    expect(paginaValida("1.9", 7)).toBe(1);
  });
});

describe("intervaloDaPagina — o '1–20 de 134' do rodapé", () => {
  it("conta a partir de 1, não de 0 — o rodapé fala com gente", () => {
    expect(intervaloDaPagina(1, 20, 134)).toEqual({ inicio: 1, fim: 20, total: 134 });
    expect(intervaloDaPagina(2, 20, 134)).toEqual({ inicio: 21, fim: 40, total: 134 });
  });

  /**
   * A ÚLTIMA PÁGINA É A QUE ERRA: com `pagina * porPagina` cru, ela prometeria
   * "121–140 de 134" — seis linhas que não existem, num rodapé que o gestor usa
   * para conferir se o filtro pegou tudo.
   */
  it("a última página não promete linha que não existe", () => {
    expect(intervaloDaPagina(7, 20, 134)).toEqual({ inicio: 121, fim: 134, total: 134 });
  });

  it("lista vazia não diz '1–0 de 0'", () => {
    expect(intervaloDaPagina(1, 20, 0)).toEqual({ inicio: 0, fim: 0, total: 0 });
  });

  it("uma linha só", () => {
    expect(intervaloDaPagina(1, 20, 1)).toEqual({ inicio: 1, fim: 1, total: 1 });
  });
});

describe("reguaDePaginas", () => {
  it("com poucas páginas, mostra todas — não há o que economizar", () => {
    expect(reguaDePaginas(1, 1)).toEqual([1]);
    expect(reguaDePaginas(2, 3)).toEqual([1, 2, 3]);
    expect(reguaDePaginas(3, 5)).toEqual([1, 2, 3, 4, 5]);
  });

  it("corta o meio com um salto quando a lista é longa", () => {
    expect(reguaDePaginas(1, 20)).toEqual([1, 2, SALTO, 20]);
    expect(reguaDePaginas(10, 20)).toEqual([1, SALTO, 9, 10, 11, SALTO, 20]);
    expect(reguaDePaginas(20, 20)).toEqual([1, SALTO, 19, 20]);
  });

  /**
   * UM SALTO QUE ESCONDE UMA PÁGINA SÓ É PIOR QUE A PÁGINA: ocupa o mesmo
   * espaço e tira um destino do alcance do dedo. Na página 3 de 5 com janela 1,
   * o corte deixaria buraco entre 1 e 2 — e o certo é imprimir o 2.
   */
  it("não troca uma página por reticências", () => {
    const regua = reguaDePaginas(4, 6);
    expect(regua).toEqual([1, 2, 3, 4, 5, 6]);
    expect(regua).not.toContain(SALTO);
  });

  it("a primeira e a última estão SEMPRE na régua — são os dois destinos fixos", () => {
    for (const pagina of [1, 5, 12, 40]) {
      const regua = reguaDePaginas(pagina, 40);
      expect(regua[0]).toBe(1);
      expect(regua[regua.length - 1]).toBe(40);
    }
  });

  it("a página atual está sempre na régua — senão não há como saber onde se está", () => {
    for (let pagina = 1; pagina <= 30; pagina += 1) {
      expect(reguaDePaginas(pagina, 30)).toContain(pagina);
    }
  });

  it("nunca repete número nem sai da ordem", () => {
    for (let pagina = 1; pagina <= 30; pagina += 1) {
      const numeros = reguaDePaginas(pagina, 30).filter(
        (i): i is number => i !== SALTO,
      );
      expect(numeros).toEqual([...new Set(numeros)]);
      expect(numeros).toEqual([...numeros].sort((a, b) => a - b));
    }
  });

  it("nunca põe dois saltos encostados", () => {
    for (let pagina = 1; pagina <= 50; pagina += 1) {
      const regua = reguaDePaginas(pagina, 50);
      for (let i = 1; i < regua.length; i += 1) {
        expect(regua[i] === SALTO && regua[i - 1] === SALTO).toBe(false);
      }
    }
  });

  it("página fora do intervalo não estoura a régua", () => {
    expect(reguaDePaginas(99, 3)).toEqual([1, 2, 3]);
    expect(reguaDePaginas(0, 3)).toEqual([1, 2, 3]);
  });

  it("uma janela maior mostra mais vizinhas", () => {
    expect(reguaDePaginas(10, 20, 2)).toEqual([1, SALTO, 8, 9, 10, 11, 12, SALTO, 20]);
  });
});
