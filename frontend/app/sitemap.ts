import type { MetadataRoute } from "next";
import { listarSlugs } from "@/lib/catalogo/repositorio";
import { urlDoSite } from "@/lib/seo/jsonld";

/**
 * Sitemap da vitrine — convenção de arquivo do App Router (vira /sitemap.xml).
 *
 * Entram só as rotas que valem indexação: home, PLP, as PDPs (uma por slug do
 * catálogo — são elas que valem dinheiro no orgânico), clube, a-serra e as
 * institucionais. Sacola, checkout, conta e painel ficam FORA daqui e ainda
 * levam Disallow no robots.ts: página de estado pessoal não é resultado de
 * busca.
 *
 * A base vem de `urlDoSite()` — mesma variável e mesmo fallback do
 * `metadataBase` em app/layout.tsx, para o sitemap nunca anunciar um domínio
 * que os metadados desmentem.
 */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const base = urlDoSite();
  const slugs = await listarSlugs();

  const fixas: MetadataRoute.Sitemap = [
    { url: `${base}/`, changeFrequency: "weekly", priority: 1 },
    { url: `${base}/cafes`, changeFrequency: "weekly", priority: 0.9 },
    { url: `${base}/clube`, changeFrequency: "monthly", priority: 0.6 },
    { url: `${base}/a-serra`, changeFrequency: "monthly", priority: 0.5 },
    { url: `${base}/termos-de-uso`, changeFrequency: "yearly", priority: 0.2 },
    {
      url: `${base}/politica-de-privacidade`,
      changeFrequency: "yearly",
      priority: 0.2,
    },
  ];

  const pdps: MetadataRoute.Sitemap = slugs.map((slug) => ({
    url: `${base}/cafes/${slug}`,
    changeFrequency: "weekly",
    priority: 0.8,
  }));

  return [...fixas, ...pdps];
}
