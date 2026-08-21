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
});

describe("websiteJsonLd", () => {
  it("aponta a SearchAction para a busca da PLP", () => {
    const site = websiteJsonLd(BASE);
    expect(site["@type"]).toBe("WebSite");
    expect(site.potentialAction.target.urlTemplate).toBe(
      `${BASE}/cafes?q={termo}`,
    );
    expect(site.potentialAction["query-input"]).toContain("termo");
  });
});

describe("productJsonLd", () => {
  const lote = LOTES.find((l) => l.slug === "classico") as Lote;

  it("monta Product com identidade, url, imagem absoluta, sku e marca", () => {
    const p = productJsonLd(lote, lote.variantes, BASE)!;
    expect(p).not.toBeNull();
    expect(p["@type"]).toBe("Product");
    expect(p["@id"]).toBe(`${BASE}/cafes/${lote.slug}#product`);
    expect(p.url).toBe(`${BASE}/cafes/${lote.slug}`);
    expect(p.name).toBe(lote.nome);
    expect(p.image[0]).toMatch(new RegExp(`^${BASE}/`));
    expect(p.sku).toBe(lote.variantes[0].skuLoja);
    expect(p.brand).toEqual({ "@type": "Brand", name: "Café Canastra" });
  });

  it("emite uma Offer por skuLoja, com preco decimal em BRL", () => {
    const variantes = [
      varianteDe({ sku: "a-grao", skuLoja: "a", preco: 3970, estoque: 5 }),
      varianteDe({ sku: "a-espresso", skuLoja: "a", preco: 3970, estoque: 5 }),
      varianteDe({ sku: "b-grao", skuLoja: "b", preco: 10570, estoque: 0 }),
    ];
    const p = productJsonLd(lote, variantes, BASE)!;
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
    const p = productJsonLd(lote, variantes, BASE)!;
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
    expect(productJsonLd(lote, variantes, BASE)).toBeNull();
  });

  it("com avaliacoes aprovadas emite aggregateRating em formato de crawler", () => {
    const p = productJsonLd(lote, lote.variantes, BASE, {
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
      const p = productJsonLd(lote, lote.variantes, BASE, agregado)!;
      expect(p).not.toBeNull();
      expect("aggregateRating" in p).toBe(false);
    }
  });

  it("todas as PDPs reais elegiveis produzem JSON-LD serializavel", () => {
    let elegiveis = 0;
    for (const l of LOTES) {
      const p = productJsonLd(l, l.variantes, BASE);
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
