import { describe, it, expect } from "vitest";
import {
  href,
  localeDaRota,
  caminhoSemLocale,
  alternativasDeIdioma,
  openGraphDaPagina,
  TAG_OPEN_GRAPH,
} from "./rotas";
import { LOCALES, TAG_BCP47 } from "./tipos";

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

/**
 * O DEFEITO QUE ESTES TESTES EXISTEM PARA IMPEDIR DE VOLTAR: o site tinha TRÊS
 * tabelas de `og:locale` — /historia e a PDP com `en_US`/`es_ES`, /bio com
 * `en`/`es` montado à mão a partir do `TAG_BCP47` — e sete rotas traduzidas sem
 * tabela nenhuma, herdando `pt_BR` do layout raiz. O `hreflang` dizia "esta
 * página é inglesa" e o Open Graph ao lado dizia "português do Brasil".
 */
describe("TAG_OPEN_GRAPH", () => {
  /**
   * O erro que o /bio cometia. `og:locale` exige `idioma_TERRITÓRIO`; o
   * `TAG_BCP47` devolve `en` e `es` secos porque o `hreflang` os quer assim.
   * As duas tabelas parecem intercambiáveis e não são.
   */
  it("é sempre idioma_TERRITÓRIO, com sublinhado e nunca hífen", () => {
    for (const locale of LOCALES) {
      expect(TAG_OPEN_GRAPH[locale]).toMatch(/^[a-z]{2}_[A-Z]{2}$/);
      expect(TAG_OPEN_GRAPH[locale]).not.toContain("-");
    }
  });

  it("cobre os três idiomas com valores distintos", () => {
    expect(TAG_OPEN_GRAPH).toEqual({ pt: "pt_BR", en: "en_US", es: "es_ES" });
    expect(new Set(Object.values(TAG_OPEN_GRAPH)).size).toBe(LOCALES.length);
  });

  /** A confusão que gerou a terceira implementação, travada por escrito. */
  it("NÃO é o TAG_BCP47 com o hífen trocado por sublinhado", () => {
    expect(TAG_OPEN_GRAPH.en).not.toBe(TAG_BCP47.en.replace("-", "_"));
    expect(TAG_OPEN_GRAPH.es).not.toBe(TAG_BCP47.es.replace("-", "_"));
  });
});

describe("openGraphDaPagina", () => {
  it("declara o idioma da própria página, não o do layout raiz", () => {
    expect(
      openGraphDaPagina({
        locale: "en",
        caminho: "/historia",
        titulo: "t",
        descricao: "d",
      }).locale,
    ).toBe("en_US");
    expect(
      openGraphDaPagina({
        locale: "es",
        caminho: "/historia",
        titulo: "t",
        descricao: "d",
      }).locale,
    ).toBe("es_ES");
  });

  /** A `og:url` é a versão traduzida, e relativa — o Next resolve pelo metadataBase. */
  it("aponta para o endereço daquele idioma", () => {
    expect(
      openGraphDaPagina({ locale: "pt", caminho: "/bio", titulo: "t", descricao: "d" })
        .url,
    ).toBe("/bio");
    expect(
      openGraphDaPagina({ locale: "en", caminho: "/bio", titulo: "t", descricao: "d" })
        .url,
    ).toBe("/en/bio");
    expect(
      openGraphDaPagina({ locale: "es", caminho: "/", titulo: "t", descricao: "d" }).url,
    ).toBe("/es");
  });

  /**
   * O bloco tem de vir COMPLETO: o Next substitui o `openGraph` do layout raiz
   * inteiro quando a rota declara o seu. Faltar `siteName` ou imagem aqui é o
   * card sair sem marca e sem foto — foi por ter de repetir os dois à mão em
   * cada arquivo que as três tabelas discordantes apareceram.
   */
  it("traz siteName, tipo e imagem sem a rota precisar repetir", () => {
    const og = openGraphDaPagina({
      locale: "pt",
      caminho: "/",
      titulo: "Título",
      descricao: "Descrição",
    });
    expect(og.siteName).toBe("Café Canastra");
    expect(og.type).toBe("website");
    expect(og.title).toBe("Título");
    expect(og.description).toBe("Descrição");
    expect(og.images).toEqual([
      {
        url: "/imagem-banner.jpg",
        width: 1280,
        height: 720,
        alt: "Café Canastra — Serra da Canastra, Minas Gerais",
      },
    ]);
  });

  it("aceita outro tipo e outra imagem quando a página tem os seus", () => {
    const og = openGraphDaPagina({
      locale: "pt",
      caminho: "/historia",
      titulo: "t",
      descricao: "d",
      tipo: "article",
      imagens: [{ url: "/foto.png", alt: "foto" }],
    });
    expect(og.type).toBe("article");
    expect(og.images).toEqual([{ url: "/foto.png", alt: "foto" }]);
  });
});
