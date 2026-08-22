import { afterEach, describe, expect, it } from "vitest";
import {
  absoluta,
  breadcrumbJsonLd,
  centavosParaDecimal,
  organizationJsonLd,
  productJsonLd,
  serializarJsonLd,
  urlDoSite,
  websiteJsonLd,
} from "./jsonld";
import { LOTES } from "../catalogo/produtos";
import type { Lote, Variante } from "../catalogo/tipos";
import { LOCALES, TAG_BCP47 } from "../i18n/tipos";

const BASE = "https://exemplo.test";

function varianteDe(sobrepor: Partial<Variante>): Variante {
  return {
    sku: "classico-250-grao",
    skuLoja: "classico-250",
    formato: "graos",
    moagem: "grao",
    pesoGramas: 250,
    pacotes: 1,
    rotuloEmbalagem: "Pacote com 250 g",
    preco: 3970,
    estoque: 10,
    ...sobrepor,
  };
}

describe("centavosParaDecimal", () => {
  it("emite decimal com ponto, duas casas", () => {
    expect(centavosParaDecimal(3970)).toBe("39.70");
    expect(centavosParaDecimal(10570)).toBe("105.70");
  });

  it("valor redondo mantem as duas casas", () => {
    expect(centavosParaDecimal(10000)).toBe("100.00");
  });

  it("centavo solto nao vira notacao estranha", () => {
    expect(centavosParaDecimal(1)).toBe("0.01");
  });
});

describe("urlDoSite e absoluta", () => {
  afterEach(() => {
    delete process.env.NEXT_PUBLIC_SITE_URL;
  });

  it("usa o mesmo fallback do metadataBase", () => {
    delete process.env.NEXT_PUBLIC_SITE_URL;
    expect(urlDoSite()).toBe("https://loja.cafecanastra.com");
  });

  it("le NEXT_PUBLIC_SITE_URL e tira a barra final", () => {
    process.env.NEXT_PUBLIC_SITE_URL = "https://loja.exemplo.com/";
    expect(urlDoSite()).toBe("https://loja.exemplo.com");
  });

  it("prefixa caminho relativo e respeita URL ja absoluta", () => {
    expect(absoluta("/foto.png", BASE)).toBe(`${BASE}/foto.png`);
    expect(absoluta("foto.png", BASE)).toBe(`${BASE}/foto.png`);
    expect(absoluta("https://cdn.exemplo.com/x.png", BASE)).toBe(
      "https://cdn.exemplo.com/x.png",
    );
  });
});

describe("serializarJsonLd", () => {
  it("escapa < para o dado nao poder fechar a tag script", () => {
    const saida = serializarJsonLd({ nome: "</script><script>alert(1)" });
    expect(saida).not.toContain("</script>");
    expect(saida).toContain("\\u003c/script>");
    // O valor sobrevive a viagem: quem parseia le o texto original.
    expect(JSON.parse(saida).nome).toBe("</script><script>alert(1)");
  });
});

describe("organizationJsonLd", () => {
  it("descreve a marca com logo absoluto", () => {
    const org = organizationJsonLd(BASE);
    expect(org["@type"]).toBe("Organization");
    expect(org.name).toBe("Café Canastra");
    expect(org.url).toBe(BASE);
    expect(org.logo).toBe(`${BASE}/logo-canastra.png`);
    expect(org.foundingDate).toBe("1985");
  });

  /**
   * Organization descreve a EMPRESA, não um documento — nome próprio, logo,
   * ano de fundação e estado não mudam de idioma. `inLanguage` no schema.org é
   * propriedade de CreativeWork, e quem a carrega é o WebSite. Cravar um
   * idioma aqui repetiria, num nó que não fala idioma nenhum, o defeito que o
   * `websiteJsonLd` tinha.
   */
  it("NÃO afirma idioma nenhum — a marca é a mesma nos três", () => {
    expect("inLanguage" in organizationJsonLd(BASE)).toBe(false);
  });
});

/**
 * O DEFEITO QUE ESTES TESTES IMPEDEM DE VOLTAR: `inLanguage` estava cravado em
 * `"pt-BR"`, e a moldura (`app/moldura-da-loja.tsx`) emite este bloco em TODA
 * página da loja. Em /en e /es o dado estruturado contradizia, DENTRO do
 * documento, o `hreflang` que existe para desmenti-lo.
 */
describe("websiteJsonLd", () => {
  it("declara o idioma da página que o emite", () => {
    expect(websiteJsonLd("pt", BASE).inLanguage).toBe("pt-BR");
    expect(websiteJsonLd("en", BASE).inLanguage).toBe("en");
    expect(websiteJsonLd("es", BASE).inLanguage).toBe("es");
  });

  /**
   * `inLanguage` e o `hreflang` saem da MESMA tabela. Se um dia divergirem, o
   * crawler recebe duas respostas para a mesma pergunta no mesmo documento.
   */
  it("usa a mesma etiqueta BCP 47 do hreflang", () => {
    for (const locale of LOCALES) {
      expect(websiteJsonLd(locale, BASE).inLanguage).toBe(TAG_BCP47[locale]);
    }
  });

  it("sem idioma pedido cai no português, que é o padrão do site", () => {
    expect(websiteJsonLd(undefined, BASE).inLanguage).toBe("pt-BR");
  });

  /** A home daquele idioma, e sem barra final — `${BASE}/` seria um segundo nó. */
  it("aponta para a home do próprio idioma", () => {
    expect(websiteJsonLd("pt", BASE).url).toBe(BASE);
    expect(websiteJsonLd("en", BASE).url).toBe(`${BASE}/en`);
    expect(websiteJsonLd("es", BASE).url).toBe(`${BASE}/es`);
  });

  /**
   * A caixa de busca do cabeçalho tem `action={href(locale, "/cafes")}`, então
   * em /en ela submete para `/en/cafes`. Uma SearchAction fixa em `/cafes`
   * prometeria ao Google um endereço de busca que aquela versão não usa.
   */
  it("aponta a SearchAction para a busca daquele idioma", () => {
    const site = websiteJsonLd("pt", BASE);
    expect(site["@type"]).toBe("WebSite");
    expect(site.potentialAction.target.urlTemplate).toBe(
      `${BASE}/cafes?q={termo}`,
    );
    expect(site.potentialAction["query-input"]).toContain("termo");

    expect(websiteJsonLd("en", BASE).potentialAction.target.urlTemplate).toBe(
      `${BASE}/en/cafes?q={termo}`,
    );
    expect(websiteJsonLd("es", BASE).potentialAction.target.urlTemplate).toBe(
      `${BASE}/es/cafes?q={termo}`,
    );
  });
});

describe("productJsonLd", () => {
  const lote = LOTES.find((l) => l.slug === "classico") as Lote;

  it("monta Product com identidade, url, imagem absoluta, sku e marca", () => {
    const p = productJsonLd("pt", lote, lote.variantes, BASE)!;
    expect(p).not.toBeNull();
    expect(p["@type"]).toBe("Product");
    expect(p["@id"]).toBe(`${BASE}/cafes/${lote.slug}#product`);
    expect(p.url).toBe(`${BASE}/cafes/${lote.slug}`);
    expect(p.name).toBe(lote.nome);
    expect(p.image[0]).toMatch(new RegExp(`^${BASE}/`));
    expect(p.sku).toBe(lote.variantes[0].skuLoja);
    expect(p.brand).toEqual({ "@type": "Brand", name: "Café Canastra" });
  });

  /**
   * Estes três casos existem porque o defeito já aconteceu: a PDP em inglês
   * emitia `@id`, `url` e as `url` de cada Offer apontando para a página em
   * PORTUGUÊS, contradizendo o canônico da própria página. E `@id` idêntico
   * nos três idiomas faz o Google fundir as três num nó só, que é o contrário
   * do que o hreflang ao lado afirma.
   */
  it("aponta @id, url e as Offers para a PDP DO IDIOMA pedido", () => {
    for (const [locale, prefixo] of [
      ["pt", ""],
      ["en", "/en"],
      ["es", "/es"],
    ] as const) {
      const p = productJsonLd(locale, lote, lote.variantes, BASE)!;
      const esperada = `${BASE}${prefixo}/cafes/${lote.slug}`;
      expect(p["@id"]).toBe(`${esperada}#product`);
      expect(p.url).toBe(esperada);
      for (const oferta of p.offers) expect(oferta.url).toBe(esperada);
    }
  });

  it("da um @id DIFERENTE para cada idioma", () => {
    const ids = (["pt", "en", "es"] as const).map(
      (l) => productJsonLd(l, lote, lote.variantes, BASE)!["@id"],
    );
    expect(new Set(ids).size).toBe(3);
  });

  it("declara inLanguage, porque o Product descreve uma pagina", () => {
    expect(productJsonLd("pt", lote, lote.variantes, BASE)!.inLanguage).toBe(
      "pt-BR",
    );
    expect(productJsonLd("en", lote, lote.variantes, BASE)!.inLanguage).toBe(
      "en",
    );
  });

  it("emite uma Offer por skuLoja, com preco decimal em BRL", () => {
    const variantes = [
      varianteDe({ sku: "a-grao", skuLoja: "a", preco: 3970, estoque: 5 }),
      varianteDe({ sku: "a-espresso", skuLoja: "a", preco: 3970, estoque: 5 }),
      varianteDe({ sku: "b-grao", skuLoja: "b", preco: 10570, estoque: 0 }),
    ];
    const p = productJsonLd("pt", lote, variantes, BASE)!;
    const offers = p.offers;
    expect(offers).toHaveLength(2);
    expect(offers.map((o) => o.sku)).toEqual(["a", "b"]);
    expect(offers[0].price).toBe("39.70");
    expect(offers[1].price).toBe("105.70");
    for (const o of offers) {
      expect(o.priceCurrency).toBe("BRL");
      expect(o.url).toBe(`${BASE}/cafes/${lote.slug}`);
    }
  });

  it("disponibilidade segue o estoque", () => {
    const variantes = [
      varianteDe({ skuLoja: "com-estoque", estoque: 3 }),
      varianteDe({ sku: "x", skuLoja: "sem-estoque", estoque: 0 }),
    ];
    const p = productJsonLd("pt", lote, variantes, BASE)!;
    const offers = p.offers;
    expect(offers.find((o) => o.sku === "com-estoque")?.availability).toBe(
      "https://schema.org/InStock",
    );
    expect(offers.find((o) => o.sku === "sem-estoque")?.availability).toBe(
      "https://schema.org/OutOfStock",
    );
  });

  it("sem variante com preco NAO ha bloco Product — erro de elegibilidade", () => {
    // Caso real da linha Canela: esgotada, sem preco na captura da loja.
    const variantes = [varianteDe({ skuLoja: "sem-preco", preco: 0 })];
    expect(productJsonLd("pt", lote, variantes, BASE)).toBeNull();
  });

  it("com avaliacoes aprovadas emite aggregateRating em formato de crawler", () => {
    const p = productJsonLd("pt", lote, lote.variantes, BASE, {
      media: 14 / 3, // 4.666… — o formato exibido tem UMA casa e PONTO.
      contagem: 3,
    })!;
    expect(p.aggregateRating).toEqual({
      "@type": "AggregateRating",
      ratingValue: "4.7",
      reviewCount: 3,
      bestRating: 5,
      worstRating: 1,
    });
    // Serializado, o valor continua com ponto — nunca "4,7".
    expect(serializarJsonLd(p)).toContain('"ratingValue":"4.7"');
  });

  it("sem avaliacoes NAO existe a chave aggregateRating — nota nao se inventa", () => {
    for (const agregado of [undefined, null, { media: 0, contagem: 0 }]) {
      const p = productJsonLd("pt", lote, lote.variantes, BASE, agregado)!;
      expect(p).not.toBeNull();
      expect("aggregateRating" in p).toBe(false);
    }
  });

  it("todas as PDPs reais elegiveis produzem JSON-LD serializavel", () => {
    let elegiveis = 0;
    for (const l of LOTES) {
      const p = productJsonLd("pt", l, l.variantes, BASE);
      if (p === null) {
        // So e aceitavel ficar sem Product quando nada tem preco de verdade.
        expect(l.variantes.every((v) => v.preco <= 0)).toBe(true);
        continue;
      }
      elegiveis++;
      const texto = serializarJsonLd(p);
      expect(() => JSON.parse(texto)).not.toThrow();
    }
    expect(elegiveis).toBeGreaterThan(0);
  });
});

describe("breadcrumbJsonLd", () => {
  it("numera as posicoes a partir de 1 e resolve as URLs", () => {
    const trilha = breadcrumbJsonLd(
      [
        { nome: "Início", url: "/" },
        { nome: "Cafés", url: "/cafes" },
        { nome: "Canastra Clássico", url: "/cafes/classico" },
      ],
      BASE,
    );
    expect(trilha["@type"]).toBe("BreadcrumbList");
    expect(trilha.itemListElement.map((i) => i.position)).toEqual([1, 2, 3]);
    expect(trilha.itemListElement[2].item).toBe(`${BASE}/cafes/classico`);
    expect(trilha.itemListElement[0].item).toBe(`${BASE}/`);
  });
});
