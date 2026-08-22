import { describe, it, expect } from "vitest";
import { LOCALES } from "../../lib/i18n/tipos";
import {
  formatarDataDoPost,
  listarPostsDoBlog,
  postsEmDestaque,
  textosDoBlog,
  type PostDoBlog,
} from "./conteudo";

/**
 * O que estes testes travam é o que quebra em silêncio numa seção que hoje não
 * tem conteúdo: a data que anda um dia para trás, a ordem invertida, e o dia em
 * que alguém ligar a fonte sem criar a página de destino.
 */

function post(slug: string, data: string): PostDoBlog {
  return { slug, titulo: slug, resumo: slug, data };
}

/**
 * TRIPWIRE, não tautologia. A fonte devolver vazio é a decisão do cliente
 * (spec §4: só a casca), e este teste é o alarme que dispara no dia em que
 * alguém a preencher — obrigando a leitura do comentário em
 * `listarPostsDoBlog`, que lista o que mais falta antes de a seção poder
 * mostrar post: a rota /blog/[slug], que ainda não existe.
 */
describe("a fonte dos posts", () => {
  it("está vazia — a seção é casca, por decisão", () => {
    expect(listarPostsDoBlog()).toHaveLength(0);
  });
});

describe("postsEmDestaque", () => {
  it("devolve vazio quando não há post", () => {
    expect(postsEmDestaque([], 3)).toEqual([]);
  });

  it("põe o mais recente primeiro", () => {
    const escolhidos = postsEmDestaque(
      [post("velho", "2026-01-10"), post("novo", "2026-08-22")],
      3,
    );
    expect(escolhidos.map((p) => p.slug)).toEqual(["novo", "velho"]);
  });

  it("respeita o limite", () => {
    const tres = postsEmDestaque(
      [
        post("a", "2026-01-01"),
        post("b", "2026-02-01"),
        post("c", "2026-03-01"),
        post("d", "2026-04-01"),
      ],
      3,
    );
    expect(tres.map((p) => p.slug)).toEqual(["d", "c", "b"]);
  });

  /**
   * `Array.prototype.sort` ordena NO LUGAR. Se a função ordenar o array que
   * recebeu, ela reordena a lista do chamador — e no dia em que a fonte for um
   * cache de módulo, a ordem original se perde para sempre, em silêncio.
   */
  it("não reordena o array que recebeu", () => {
    const originais = [post("velho", "2026-01-10"), post("novo", "2026-08-22")];
    postsEmDestaque(originais, 3);
    expect(originais.map((p) => p.slug)).toEqual(["velho", "novo"]);
  });
});

describe("formatarDataDoPost", () => {
  /**
   * O BUG QUE ESTE TESTE EXISTE PARA IMPEDIR: `new Date("2026-08-22")` é
   * meia-noite em UTC, e o Brasil está três horas atrás. Formatado no fuso
   * local, o dia 22 vira 21 — a data do post anda um dia para trás para todo
   * visitante brasileiro, e ninguém percebe porque a diferença é de um dígito.
   */
  it("não anda um dia para trás", () => {
    for (const locale of LOCALES) {
      const texto = formatarDataDoPost("2026-08-22", locale);
      expect(texto).toContain("22");
      expect(texto).not.toContain("21");
      expect(texto).toContain("2026");
    }
  });

  it("fala o idioma pedido", () => {
    expect(formatarDataDoPost("2026-08-22", "pt")).not.toBe(
      formatarDataDoPost("2026-08-22", "en"),
    );
  });
});

/**
 * A Onda 3 traduz valor por valor. Uma string esvaziada no caminho não quebra
 * o build — só some da tela, num idioma que quem escreveu não relê.
 */
describe("os textos da seção", () => {
  it("não têm texto vazio em nenhum idioma", () => {
    for (const locale of LOCALES) {
      for (const [chave, valor] of Object.entries(textosDoBlog(locale))) {
        expect(valor, `${locale}.${chave}`).not.toBe("");
      }
    }
  });
});
