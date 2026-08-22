import type { MetadataRoute } from "next";
import { urlDoSite } from "@/lib/seo/jsonld";

/**
 * robots.txt — convenção de arquivo do App Router.
 *
 * Allow geral: a vitrine vive de orgânico. Os Disallow são as áreas de estado
 * pessoal ou administrativo, que indexadas só produziriam resultado quebrado
 * (painel pede login, sacola é do visitante, checkout sem sacola redireciona).
 *
 * A LISTA CONTINUA CERTA DEPOIS DO i18n, e vale dizer por quê — é o tipo de
 * arquivo que se esquece de conferir quando as rotas mudam:
 *
 *   - sacola, checkout, conta e pedido saíram do grupo da vitrine, mas as URLs
 *     delas NÃO mudaram: continuam `/sacola`, `/checkout`, `/account`. Vivem
 *     fora do `[locale]` por serem pt-BR, então não existem `/en/checkout` nem
 *     `/es/sacola` para bloquear;
 *   - `/pt/...` não precisa de Disallow: o middleware o devolve ao endereço
 *     canônico com um 308, e crawler nenhum indexa o lado de cá de um redirect
 *     permanente;
 *   - `/en/...` e `/es/...` são páginas de catálogo e marca, e é justamente
 *     para elas que o hreflang existe. Bloqueá-las mataria o motivo do projeto.
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
