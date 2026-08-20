import type { Metadata } from "next";
import type { ReactNode } from "react";
import { Archivo, Martian_Mono } from "next/font/google";
import { urlDoSite } from "@/lib/seo/jsonld";
import "./globals.css";

const archivo = Archivo({
  subsets: ["latin", "latin-ext"],
  variable: "--fonte-ui",
  display: "swap",
  preload: true,
});

const martianMono = Martian_Mono({
  subsets: ["latin"],
  variable: "--fonte-dado",
  display: "swap",
  preload: false,
});

/**
 * `metadataBase` resolve as URLs relativas de Open Graph. Sem ele o Next avisa
 * no build e cai em http://localhost:3000 — o que faz o card compartilhado no
 * WhatsApp e no Instagram apontar para a máquina de quem compilou, sem imagem.
 *
 * `urlDoSite()` é a MESMA fonte do sitemap, do robots e do JSON-LD — uma
 * origem só, para os metadados nunca desmentirem o que o sitemap anuncia.
 */
export const metadata: Metadata = {
  metadataBase: new URL(urlDoSite()),
  title: {
    default: "Café Canastra",
    template: "%s — Café Canastra",
  },
  description: "Café que vem de cima. Torrado sob demanda, desde 1985.",
  openGraph: {
    type: "website",
    locale: "pt_BR",
    siteName: "Café Canastra",
    // Imagem padrao dos cards compartilhados: o heroi da home (1280x720, a
    // proporcao mais proxima do 1.91:1 que os crawlers pedem — o
    // bannerdesktop.jpg e 1600x500, esticado demais para card). Paginas com
    // imagem propria (a PDP) sobrepoem esta no seu generateMetadata.
    images: [
      {
        url: "/imagem-banner.jpg",
        width: 1280,
        height: 720,
        alt: "Café Canastra — Serra da Canastra, Minas Gerais",
      },
    ],
  },
  robots: { index: true, follow: true },
};

/**
 * Layout raiz — envolve TANTO a vitrine quanto o painel legado em /dashboard.
 * Nada de estilo visual entra aqui: as classes de fonte apenas expoem
 * --fonte-ui / --fonte-dado no <html>; quem as aplica e `.vitrine`, em
 * app/globals.css. Ver o comentario no topo daquele arquivo.
 */
export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="pt-BR" className={`${archivo.variable} ${martianMono.variable}`}>
      <body>{children}</body>
    </html>
  );
}
