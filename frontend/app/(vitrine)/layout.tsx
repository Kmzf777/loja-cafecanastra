import type { ReactNode } from "react";
import { Cabecalho } from "@/components/layout/Cabecalho";
import { Rodape } from "@/components/layout/Rodape";
import { BannerCookies } from "@/components/layout/BannerCookies";
import { BotaoWhatsApp } from "@/components/layout/BotaoWhatsApp";
import { ScriptsAnalytics } from "@/components/analytics/ScriptsAnalytics";
import { Grao } from "@/components/ui/Grao";
import { ProvedorDaSacola } from "@/lib/sacola/sacola";
import {
  organizationJsonLd,
  serializarJsonLd,
  websiteJsonLd,
} from "@/lib/seo/jsonld";

/**
 * Layout do grupo de rotas da vitrine.
 *
 * O grupo `(vitrine)` nao altera a URL: `app/(vitrine)/page.tsx` continua
 * servindo `/`. Sua funcao aqui e dupla — aplicar a classe `.vitrine`, que
 * ativa o reset do Tailwind definido em app/globals.css, e montar a moldura
 * (cabecalho, rodape, grao de papel) comum a todas as paginas da loja.
 *
 * O reset NAO pode subir para o <body> em app/layout.tsx: aquele layout tambem
 * envolve /dashboard, onde vive o painel legado em styled-components, que
 * depende dos defaults do navegador para titulos, botoes e links.
 *
 * JSON-LD DE ORGANIZATION/WEBSITE FICA AQUI, e nao no layout raiz, pelo mesmo
 * motivo: quem quer rich results e a loja — o painel em /dashboard nao tem
 * nada a anunciar a crawler. Product e Breadcrumb ficam na PDP, que e quem os
 * conhece.
 */
export default function VitrineLayout({ children }: { children: ReactNode }) {
  return (
    // O provedor da sacola envolve só a vitrine, não o painel: /dashboard tem o
    // próprio conjunto de contexts legados e não precisa de carrinho.
    <ProvedorDaSacola>
      <div className="vitrine flex min-h-screen flex-col">
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            __html: serializarJsonLd(organizationJsonLd()),
          }}
        />
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            __html: serializarJsonLd(websiteJsonLd()),
          }}
        />
        <Grao />
        <Cabecalho />
        <main className="flex-1">{children}</main>
        <Rodape />
        {/* Conveniencias fixas da moldura: o botao so existe com a env de
            WhatsApp; o GA4 so carrega com env definida E consentimento do
            banner — ver os comentarios de cada componente. */}
        <BotaoWhatsApp />
        <BannerCookies />
        <ScriptsAnalytics />
      </div>
    </ProvedorDaSacola>
  );
}
