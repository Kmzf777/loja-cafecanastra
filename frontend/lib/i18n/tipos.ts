/**
 * Os três idiomas do site, e nada além disso.
 *
 * POR QUE UM DICIONÁRIO PRÓPRIO E NÃO `next-intl`: a biblioteca quer o próprio
 * middleware, e `frontend/middleware.ts` já são 8 KB que renovam a sessão do
 * GoTrue. Encadear os dois mexeria no caminho de autenticação — a superfície
 * mais crítica do repositório — para ganhar ICU e negociação de idioma que uma
 * loja com checkout em português não usa. A decisão está registrada em
 * docs/superpowers/specs/2026-08-22-site-unico-producao-design.md §1.
 *
 * `as const` não é enfeite: é ele que faz `Locale` ser a união dos três
 * literais em vez de `string`, e é dessa união que sai a trava do dicionário
 * (ver lib/i18n/dicionario.ts).
 */
export const LOCALES = ["pt", "en", "es"] as const;

export type Locale = (typeof LOCALES)[number];

/**
 * O português é o padrão E NÃO APARECE NA URL. `/cafes` é servido por rewrite
 * interno para `/pt/cafes` — a barra de endereços continua mostrando `/cafes`,
 * e nenhum backlink, nenhum link existente e nenhuma entrada de sitemap quebra.
 * Ver o rewrite em middleware.ts e o `href()` em lib/i18n/rotas.ts, que são os
 * dois lados da mesma regra.
 */
export const LOCALE_PADRAO: Locale = "pt";

/**
 * O portão entre a URL e o resto do i18n.
 *
 * O segmento `[locale]` do App Router aceita QUALQUER string: sem este
 * predicado barrando o que não é idioma, `/qualquer-coisa/cafes` responderia
 * 200 com o conteúdo em português, e cada página passaria a ter infinitas
 * URLs.
 *
 * QUEM CHAMA É `app/[locale]/(vitrine)/layout.tsx`, que manda o resto para
 * `notFound()`. NÃO existe um `app/[locale]/layout.tsx` — e o endereço certo
 * importa aqui, porque quem vier conferir a trava vai procurá-la primeiro no
 * layout do segmento. A validação mora no layout do GRUPO porque ele é o mais
 * alto que toda rota traduzida atravessa; o comentário de lá explica o resto.
 */
export function ehLocale(valor: string): valor is Locale {
  return (LOCALES as readonly string[]).includes(valor);
}

/**
 * O `params.locale` de uma página, já estreitado para `Locale`.
 *
 * O App Router entrega o segmento como `string` e o layout já manda o que não
 * for idioma para `notFound()` — mas página e layout renderizam em PARALELO, e
 * durante esse instante a página pode receber a string inválida. Cair no
 * padrão é o que garante que a tela nunca mostre `undefined`; o 404 do layout
 * chega logo em seguida e é ele quem decide o status da resposta.
 */
export function comoLocale(valor: string): Locale {
  return ehLocale(valor) ? valor : LOCALE_PADRAO;
}

/**
 * A etiqueta BCP 47 de cada idioma, para `<html lang>`, `hreflang` e
 * `Open Graph`. O português é `pt-BR` porque o site fala o português do
 * Brasil, não o de Portugal — é o que o estetica.md §10 fixa.
 */
export const TAG_BCP47: Record<Locale, string> = {
  pt: "pt-BR",
  en: "en",
  es: "es",
};
