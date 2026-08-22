import type { MetadataRoute } from "next";
import { urlDoSite } from "@/lib/seo/jsonld";

/**
 * robots.txt — convenção de arquivo do App Router.
 *
 * Allow geral: a vitrine vive de orgânico. Os Disallow são as áreas de estado
 * pessoal ou administrativo, que indexadas só produziriam resultado quebrado
 * (painel pede login, sacola é do visitante, checkout sem sacola redireciona).
 *
 * `/rastreio` entrou pelo mesmo critério: ela só faz sentido com o `?codigo=`
 * que o botão do WhatsApp carrega, e indexada renderizaria para sempre a tela
 * de "sem código" — ou, pior, deixaria o código de rastreio de um cliente
 * virar resultado de busca.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        disallow: ["/dashboard", "/account", "/checkout", "/sacola", "/rastreio"],
      },
    ],
    sitemap: `${urlDoSite()}/sitemap.xml`,
  };
}
