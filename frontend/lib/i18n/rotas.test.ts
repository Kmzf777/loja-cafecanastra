import { describe, it, expect } from "vitest";
import {
  href,
  localeDaRota,
  caminhoSemLocale,
  alternativasDeIdioma,
} from "./rotas";

/**
 * A regra que estes testes travam é a mesma do middleware, vista do outro lado:
 * **o português não aparece na URL.** Se `href("pt", "/cafes")` um dia devolver
 * `/pt/cafes`, todo link interno da loja passa a apontar para um endereço que o
 * middleware redireciona — e cada clique vira duas viagens, com o backlink
 * antigo apontando para o lugar errado.
 */
describe("href", () => {
  it("em português devolve o caminho cru", () => {
    expect(href("pt", "/cafes")).toBe("/cafes");
    expect(href("pt", "/")).toBe("/");
  });

  it("em inglês e espanhol prefixa", () => {
    expect(href("en", "/cafes")).toBe("/en/cafes");
    expect(href("es", "/cafes")).toBe("/es/cafes");
  });

  /** A home traduzida é `/en`, nunca `/en/` — barra final duplica a URL. */
  it("a home traduzida não ganha barra final", () => {
    expect(href("en", "/")).toBe("/en");
    expect(href("es", "/")).toBe("/es");
  });

  it("preserva querystring e âncora", () => {
    expect(href("en", "/cafes?linha=suave")).toBe("/en/cafes?linha=suave");
    expect(href("es", "/a-serra#torra")).toBe("/es/a-serra#torra");
  });

  /**
   * O caminho transacional é pt-BR por decisão do cliente (spec §1) e sai do
   * prefixo. Prefixá-lo levaria a `/en/checkout`, que não existe: 404 no meio
   * do caminho de compra.
   */
  it("não prefixa o caminho transacional em nenhum idioma", () => {
    for (const caminho of ["/sacola", "/checkout", "/account", "/pedido/42"]) {
      expect(href("en", caminho)).toBe(caminho);
      expect(href("es", caminho)).toBe(caminho);
    }
  });

  /** Link externo e âncora pura passam intocados — prefixá-los os quebraria. */
  it("não toca em URL absoluta nem em âncora pura", () => {
    expect(href("en", "https://cafecanastra.com")).toBe(
      "https://cafecanastra.com",
    );
    expect(href("en", "mailto:oi@cafecanastra.com")).toBe(
      "mailto:oi@cafecanastra.com",
    );
    expect(href("en", "#torra")).toBe("#torra");
  });
});

describe("localeDaRota", () => {
  it("lê o prefixo quando ele existe", () => {
    expect(localeDaRota("/en/cafes")).toBe("en");
    expect(localeDaRota("/es")).toBe("es");
  });

  it("sem prefixo é português", () => {
    expect(localeDaRota("/")).toBe("pt");
    expect(localeDaRota("/cafes")).toBe("pt");
    expect(localeDaRota("/checkout")).toBe("pt");
  });

  /** `/endereco` começa com "en" mas não é inglês. O corte é por segmento. */
  it("não confunde prefixo com começo de palavra", () => {
    expect(localeDaRota("/endereco")).toBe("pt");
    expect(localeDaRota("/especiais")).toBe("pt");
  });
});

describe("caminhoSemLocale", () => {
  it("tira o prefixo e devolve o caminho canônico", () => {
    expect(caminhoSemLocale("/en/cafes")).toBe("/cafes");
    expect(caminhoSemLocale("/es/a-serra")).toBe("/a-serra");
    expect(caminhoSemLocale("/cafes")).toBe("/cafes");
  });

  /** A home dos três idiomas volta como `/`, nunca como string vazia. */
  it("a home volta como barra", () => {
    expect(caminhoSemLocale("/en")).toBe("/");
    expect(caminhoSemLocale("/")).toBe("/");
  });
});

/**
 * O hreflang é o que impede o Google de tratar `/cafes`, `/en/cafes` e
 * `/es/cafes` como três páginas concorrendo entre si. Os três precisam apontar
 * uns para os outros E para si mesmos — um conjunto incompleto é ignorado
 * inteiro pelo buscador.
 */
describe("alternativasDeIdioma", () => {
  it("aponta os três idiomas e o x-default para o português", () => {
    const alt = alternativasDeIdioma("/cafes", "pt");
    expect(alt.languages).toEqual({
      "pt-BR": "/cafes",
      en: "/en/cafes",
      es: "/es/cafes",
      "x-default": "/cafes",
    });
  });

  /**
   * O ERRO QUE ESTE TESTE EXISTE PARA IMPEDIR: canônico de `/en/cafes`
   * apontando para `/cafes`. Isso não diz "versões de idioma" ao buscador —
   * diz "esta é cópia daquela, indexe só a outra", e apagaria do índice as
   * páginas em inglês e espanhol que o projeto existe para criar.
   */
  it("o canônico é sempre a própria página, no próprio idioma", () => {
    expect(alternativasDeIdioma("/cafes", "pt").canonical).toBe("/cafes");
    expect(alternativasDeIdioma("/cafes", "en").canonical).toBe("/en/cafes");
    expect(alternativasDeIdioma("/cafes", "es").canonical).toBe("/es/cafes");
  });

  /** As alternativas NÃO mudam com o idioma da página — é o que as faz recíprocas. */
  it("o conjunto de alternativas é o mesmo nos três", () => {
    expect(alternativasDeIdioma("/cafes", "en").languages).toEqual(
      alternativasDeIdioma("/cafes", "pt").languages,
    );
  });

  it("funciona na home", () => {
    const alt = alternativasDeIdioma("/", "en");
    expect(alt.canonical).toBe("/en");
    expect(alt.languages.en).toBe("/en");
    expect(alt.languages["x-default"]).toBe("/");
  });
});
