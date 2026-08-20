import type { MetadataRoute } from "next";
import { urlDoSite } from "@/lib/seo/jsonld";

/**
 * robots.txt — convenção de arquivo do App Router.
 *
 * Allow geral: a vitrine vive de orgânico. Os Disallow são as áreas de estado
 * pessoal ou administrativo, que indexadas só produziriam resultado quebrado
 * (painel pede login, sacola é do visitante, checkout sem sacola redireciona).
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        disallow: ["/dashboard", "/account", "/checkout", "/sacola"],
      },
    ],
    sitemap: `${urlDoSite()}/sitemap.xml`,
  };
}
