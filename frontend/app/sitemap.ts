import type { MetadataRoute } from "next";
import { listarSlugs } from "@/lib/catalogo/repositorio";
import { absoluta, urlDoSite } from "@/lib/seo/jsonld";
import { alternativasDeIdioma, href } from "@/lib/i18n/rotas";
import { LOCALES } from "@/lib/i18n/tipos";

/**
 * Sitemap da vitrine — convenção de arquivo do App Router (vira /sitemap.xml).
 *
 * Entram só as rotas que valem indexação, AGORA MULTIPLICADAS PELOS TRÊS
 * IDIOMAS: home, PLP, as PDPs (uma por slug do catálogo — são elas que valem
 * dinheiro no orgânico), clube, a-serra, história, rastreabilidade, bio e as
 * institucionais. Sacola, checkout, conta e painel ficam FORA daqui e ainda
 * levam Disallow no robots.ts: página de estado pessoal não é resultado de
 * busca. Elas também não têm versão traduzida — vivem fora do `[locale]` de
 * propósito (spec §1) —, então não haveria o que multiplicar.
 *
 * OS ENDEREÇOS E O hreflang SAEM DAS MESMAS FUNÇÕES QUE O `<head>` USA:
 * `href()` e `alternativasDeIdioma()`, de lib/i18n/rotas. É a única maneira de
 * o sitemap não desmentir o metadata da própria página — e um conjunto de
 * hreflang que o sitemap contradiz é descartado inteiro pelo buscador, o que
 * apagaria do índice justamente as páginas em inglês e espanhol que este
 * projeto existe para criar.
 *
 * O QUE NÃO ENTRA E POR QUÊ:
 *  - `/pt/...` não existe como endereço público: o middleware o devolve com um
 *    308 para o caminho sem prefixo. Anunciar um redirect no sitemap é pedir
 *    ao crawler que descubra sozinho;
 *  - `/blog` e `/blog/[slug]` não são rotas — a seção da home está desenhada e
 *    vazia por decisão do cliente (spec §4).
 *
 * A base vem de `urlDoSite()` — mesma variável e mesmo fallback do
 * `metadataBase` em app/layout.tsx, para o sitemap nunca anunciar um domínio
 * que os metadados desmentem. O `alternates` do sitemap PRECISA de URL
 * absoluta (o `metadataBase` não alcança este arquivo), então cada caminho
 * relativo devolvido por `alternativasDeIdioma` passa por `absoluta()`.
 */

/** Tudo que uma entrada carrega além do endereço e do bloco de idiomas. */
type Cadencia = Pick<
  MetadataRoute.Sitemap[number],
  "changeFrequency" | "priority"
>;

/**
 * Uma rota canônica vira TRÊS entradas — uma por idioma —, cada uma com o
 * conjunto completo e recíproco de alternativas.
 *
 * O conjunto de `languages` é o mesmo nas três (só o `canonical`, que o
 * sitemap não usa, muda), então ele é montado uma vez só.
 */
function porIdioma(caminho: string, base: string, cadencia: Cadencia) {
  const { languages } = alternativasDeIdioma(caminho, LOCALES[0]);
  const alternates = {
    languages: Object.fromEntries(
      Object.entries(languages).map(([tag, relativo]) => [
        tag,
        absoluta(relativo, base),
      ]),
    ),
  };

  return LOCALES.map((locale) => ({
    url: absoluta(href(locale, caminho), base),
    alternates,
    ...cadencia,
  }));
}

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const base = urlDoSite();
  const slugs = await listarSlugs();

  /**
   * A ordem é a da importância comercial, e a prioridade acompanha: a home e a
   * PLP trazem a visita, a PDP fecha a venda, o Clube é a recorrência. As
   * institucionais e as jurídicas existem para serem encontradas por quem as
   * procura pelo nome, não para disputar consulta genérica.
   */
  const fixas: [string, Cadencia][] = [
    ["/", { changeFrequency: "weekly", priority: 1 }],
    ["/cafes", { changeFrequency: "weekly", priority: 0.9 }],
    ["/clube", { changeFrequency: "monthly", priority: 0.6 }],
    ["/a-serra", { changeFrequency: "monthly", priority: 0.5 }],
    ["/historia", { changeFrequency: "monthly", priority: 0.5 }],
    // Página curta e informativa: um link honesto para a base do Cerrado
    // Mineiro. Vale ser encontrada, não vale competir com o catálogo.
    ["/rastreabilidade", { changeFrequency: "yearly", priority: 0.3 }],
    // Página de link de perfil de Instagram. Entra porque existe e responde
    // 200 — página indexável fora do sitemap é ruído para o crawler —, com a
    // prioridade que ela tem de verdade.
    ["/bio", { changeFrequency: "monthly", priority: 0.3 }],
    ["/termos-de-uso", { changeFrequency: "yearly", priority: 0.2 }],
    ["/politica-de-privacidade", { changeFrequency: "yearly", priority: 0.2 }],
  ];

  return [
    ...fixas.flatMap(([caminho, cadencia]) =>
      porIdioma(caminho, base, cadencia),
    ),
    ...slugs.flatMap((slug) =>
      porIdioma(`/cafes/${slug}`, base, {
        changeFrequency: "weekly",
        priority: 0.8,
      }),
    ),
  ];
}
