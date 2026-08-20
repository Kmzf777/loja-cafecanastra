import type { Lote, Variante } from "../catalogo/tipos";

/**
 * Builders de JSON-LD (schema.org) da vitrine.
 *
 * Funções PURAS de propósito: recebem dados e devolvem o objeto pronto para
 * serializar. Nada aqui toca `window`, `fetch` ou React — é o que permite
 * testá-las em Vitest ambiente node e injetá-las tanto num layout (Server
 * Component) quanto numa página estática.
 *
 * IMPORTS RELATIVOS, não `@/`: o vitest.config.ts não resolve o alias, e este
 * módulo é importado pelos testes.
 *
 * Preço: o catálogo inteiro fala em CENTAVOS (`3970` = R$ 39,70). O schema.org
 * exige decimal com ponto ("39.70") — `centavosParaDecimal` é a única conversão
 * e fica exportada para o teste travar o formato.
 */

/** O MESMO fallback do `metadataBase` em app/layout.tsx — nunca divergir. */
const ORIGEM_PADRAO = "https://loja.cafecanastra.com";

/** Origem pública da loja, sem barra final. */
export function urlDoSite(): string {
  return (process.env.NEXT_PUBLIC_SITE_URL || ORIGEM_PADRAO).replace(/\/+$/, "");
}

/** `3970` → `"39.70"`. Schema.org quer ponto decimal, nunca vírgula. */
export function centavosParaDecimal(centavos: number): string {
  return (centavos / 100).toFixed(2);
}

/** `/cafe-classico.png` → `https://loja.cafecanastra.com/cafe-classico.png`. */
export function absoluta(caminho: string, base: string = urlDoSite()): string {
  if (/^https?:\/\//.test(caminho)) return caminho;
  return `${base}${caminho.startsWith("/") ? "" : "/"}${caminho}`;
}

/**
 * JSON para dentro de `<script type="application/ld+json">`.
 *
 * O `<` vira `<` para que nenhum dado do catálogo consiga fechar a tag
 * `</script>` e injetar HTML — o JSON continua válido, o navegador continua
 * lendo o mesmo valor, e a classe de ataque morre na serialização.
 */
export function serializarJsonLd(dados: object): string {
  return JSON.stringify(dados).replace(/</g, "\\u003c");
}

export function organizationJsonLd(base: string = urlDoSite()) {
  return {
    "@context": "https://schema.org",
    "@type": "Organization",
    name: "Café Canastra",
    url: base,
    logo: absoluta("/logo-canastra.png", base),
    foundingDate: "1985",
    address: {
      "@type": "PostalAddress",
      addressRegion: "MG",
      addressCountry: "BR",
    },
  };
}

export function websiteJsonLd(base: string = urlDoSite()) {
  return {
    "@context": "https://schema.org",
    "@type": "WebSite",
    name: "Café Canastra",
    url: base,
    inLanguage: "pt-BR",
    // Casa com a caixa de busca do cabeçalho: form GET para /cafes?q=…
    potentialAction: {
      "@type": "SearchAction",
      target: {
        "@type": "EntryPoint",
        urlTemplate: `${base}/cafes?q={termo}`,
      },
      "query-input": "required name=termo",
    },
  };
}

const EM_ESTOQUE = "https://schema.org/InStock";
const ESGOTADO = "https://schema.org/OutOfStock";

/**
 * Product + Offers de uma PDP — ou `null` quando o bloco não é elegível.
 *
 * Uma Offer por `skuLoja` ÚNICO: as seis variantes moídas de um mesmo peso
 * compartilham SKU, preço e estoque (ver o comentário de `Variante` em
 * tipos.ts) — seis Offers idênticas seriam ruído para o crawler. Variante sem
 * preço (`preco <= 0`, caso real dos formatos esgotados sem preço na loja)
 * fica FORA: o schema.org exige `price`, e inventar um número aqui seria
 * mentir exatamente onde o Google confere.
 *
 * E quando NENHUMA variante tem preço (caso real da linha Canela, esgotada na
 * captura), o retorno é `null` e a PDP não emite Product nenhum: um Product
 * sem `offers` é erro de elegibilidade no Search Console — pior para o site
 * inteiro do que uma página sem rich result. O Breadcrumb da página não passa
 * por aqui e continua saindo.
 */
export function productJsonLd(
  lote: Lote,
  variantes: Variante[] = lote.variantes,
  base: string = urlDoSite(),
) {
  const urlDaPdp = `${base}/cafes/${lote.slug}`;

  const porSku = new Map<string, Variante>();
  for (const v of variantes) {
    if (v.preco <= 0) continue;
    if (!porSku.has(v.skuLoja)) porSku.set(v.skuLoja, v);
  }
  if (porSku.size === 0) return null;

  const offers = [...porSku.values()].map((v) => ({
    "@type": "Offer",
    sku: v.skuLoja,
    price: centavosParaDecimal(v.preco),
    priceCurrency: "BRL",
    availability: v.estoque > 0 ? EM_ESTOQUE : ESGOTADO,
    url: urlDaPdp,
  }));

  return {
    "@context": "https://schema.org",
    "@type": "Product",
    // `@id` dá ao Product uma identidade citável por outros nós do grafo (a
    // âncora #product distingue a COISA da PÁGINA que a descreve).
    "@id": `${urlDaPdp}#product`,
    url: urlDaPdp,
    name: lote.nome,
    description: lote.descricao,
    image: [absoluta(lote.fotos.pacote.src, base)],
    sku: variantes[0]?.skuLoja,
    brand: { "@type": "Brand", name: "Café Canastra" },
    offers,
  };
}

export type ItemDaTrilha = { nome: string; url: string };

export function breadcrumbJsonLd(
  trilha: ItemDaTrilha[],
  base: string = urlDoSite(),
) {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: trilha.map((item, i) => ({
      "@type": "ListItem",
      position: i + 1,
      name: item.nome,
      item: absoluta(item.url, base),
    })),
  };
}
