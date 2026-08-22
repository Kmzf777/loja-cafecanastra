import type { Lote, Variante } from "../catalogo/tipos";
import { LOCALE_PADRAO, TAG_BCP47, type Locale } from "../i18n/tipos";
import { href } from "../i18n/rotas";

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

/**
 * A marca. NÃO TEM `inLanguage`, E ISSO ESTÁ CERTO — não é esquecimento.
 *
 * Este nó descreve a EMPRESA, não um documento: nome próprio, logo, ano de
 * fundação e o estado. Nenhum desses campos muda entre /cafes, /en/cafes e
 * /es/cafes, e `inLanguage` no schema.org é propriedade de CreativeWork — quem
 * a carrega aqui é o `websiteJsonLd()` logo abaixo, que descreve o site. Cravar
 * um idioma nesta função seria repetir, num nó que não fala idioma nenhum, o
 * defeito que o `websiteJsonLd` acabou de corrigir; o teste ao lado trava isso.
 */
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

/**
 * O site, no idioma da página que está emitindo o bloco.
 *
 * O `locale` VEM PRIMEIRO E É O PARÂMETRO QUE IMPORTA. `inLanguage` estava
 * cravado em `"pt-BR"`, e a moldura (`app/moldura-da-loja.tsx`) emite este nó
 * em TODA página da loja — /en e /es inclusive. O resultado era um dado
 * estruturado dizendo "esta página é portuguesa" ao lado do `hreflang` que
 * existe justamente para dizer o contrário: das duas afirmações, a que o
 * crawler encontra dentro do documento é esta.
 *
 * `url` e a busca também acompanham o idioma, e não por simetria: a caixa de
 * busca do cabeçalho tem `action={href(locale, "/cafes")}` (ver
 * components/layout/Cabecalho.tsx), então em /en ela vai para `/en/cafes?q=…`.
 * Uma SearchAction apontando para `/cafes` prometeria ao Google um endereço de
 * busca que aquela versão do site não usa.
 */
export function websiteJsonLd(
  locale: Locale = LOCALE_PADRAO,
  base: string = urlDoSite(),
) {
  // A home DESTE idioma: `/` em português, `/en` e `/es` nos outros. Sem barra
  // final, porque `${base}/` e `${base}` são duas URLs para a mesma página — e
  // esta é a que o canônico da home anuncia (ver `alternativasDeIdioma`).
  const home = href(locale, "/");

  return {
    "@context": "https://schema.org",
    "@type": "WebSite",
    name: "Café Canastra",
    url: home === "/" ? base : `${base}${home}`,
    inLanguage: TAG_BCP47[locale],
    potentialAction: {
      "@type": "SearchAction",
      target: {
        "@type": "EntryPoint",
        urlTemplate: `${base}${href(locale, "/cafes")}?q={termo}`,
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
 * Uma Offer por `skuLoja` ÚNICO. Grão e moído de um mesmo peso são produtos
 * distintos com SKU próprio, mas caixa fechada e pacote avulso podem repetir
 * SKU — e duas Offers idênticas seriam ruído para o crawler. Variante sem
 * preço (`preco <= 0`, caso real dos formatos esgotados sem preço na loja)
 * fica FORA: o schema.org exige `price`, e inventar um número aqui seria
 * mentir exatamente onde o Google confere.
 *
 * O `locale` VEM PRIMEIRO E É OBRIGATÓRIO, como em `websiteJsonLd`. Um valor
 * padrão aqui já custou caro três vezes nesta branch: `@id`, `url` e as `url`
 * de cada Offer apontavam para a PDP em português mesmo na página em inglês,
 * contradizendo o canônico da própria página. E `@id` igual nos três idiomas
 * faz o Google FUNDIR as três páginas num nó só — o oposto do que o hreflang
 * ao lado está tentando dizer. Sem padrão, quem esquecer não compila.
 *
 * E quando NENHUMA variante tem preço (caso real da linha Canela, esgotada na
 * captura), o retorno é `null` e a PDP não emite Product nenhum: um Product
 * sem `offers` é erro de elegibilidade no Search Console — pior para o site
 * inteiro do que uma página sem rich result. O Breadcrumb da página não passa
 * por aqui e continua saindo.
 */
/**
 * Média + contagem das avaliações APROVADAS da linha — o que
 * `lib/avaliacoes/servidor.ts` devolve. `null`/`undefined` (nenhuma aprovada,
 * ou a pergunta falhou no build) significa SEM `aggregateRating`: um rating
 * inventado é mentir exatamente onde o Google confere — a mesma regra do
 * preço, logo abaixo.
 */
export type AvaliacoesParaJsonLd = { media: number; contagem: number };

export function productJsonLd(
  locale: Locale,
  lote: Lote,
  variantes: Variante[] = lote.variantes,
  base: string = urlDoSite(),
  avaliacoes?: AvaliacoesParaJsonLd | null,
) {
  const urlDaPdp = `${base}${href(locale, `/cafes/${lote.slug}`)}`;

  const porSku = new Map<string, Variante>();
  for (const v of variantes) {
    if (v.preco <= 0) continue;
    if (!porSku.has(v.skuLoja)) porSku.set(v.skuLoja, v);
  }
  if (porSku.size === 0) return null;

  // `ratingValue` com UMA casa e ponto decimal ("4.7"), como o preço: o
  // schema.org aceita número ou string, e a string fixa o formato — um
  // toLocaleString pt-BR aqui produziria "4,7", que o crawler lê como 47.
  const aggregateRating =
    avaliacoes && avaliacoes.contagem > 0
      ? {
          "@type": "AggregateRating",
          ratingValue: avaliacoes.media.toFixed(1),
          reviewCount: avaliacoes.contagem,
          bestRating: 5,
          worstRating: 1,
        }
      : null;

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
    // Diferente do Organization logo acima, que NÃO tem `inLanguage` de
    // propósito (a marca não tem idioma), o Product descreve uma página: nome
    // e descrição saem daqui já traduzidos, e sem declarar em que língua o
    // crawler tem de adivinhar.
    inLanguage: TAG_BCP47[locale],
    name: lote.nome,
    description: lote.descricao,
    image: [absoluta(lote.fotos.pacote.src, base)],
    sku: variantes[0]?.skuLoja,
    brand: { "@type": "Brand", name: "Café Canastra" },
    offers,
    // Espalhado condicionalmente: `aggregateRating: undefined` ainda seria
    // uma CHAVE no objeto e sobreviveria em serializações fora do JSON.
    ...(aggregateRating ? { aggregateRating } : {}),
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
