import type { Metadata } from "next";
import type { ReactNode } from "react";
import { Archivo, Martian_Mono } from "next/font/google";
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
 */
export const metadata: Metadata = {
  metadataBase: new URL(
    process.env.NEXT_PUBLIC_SITE_URL || "https://loja.cafecanastra.com",
  ),
  title: {
    default: "Café Canastra",
    template: "%s — Café Canastra",
  },
  description: "Café que vem de cima. Torrado sob demanda, desde 1985.",
  openGraph: {
    type: "website",
    locale: "pt_BR",
    siteName: "Café Canastra",
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
