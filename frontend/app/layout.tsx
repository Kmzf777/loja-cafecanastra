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

export const metadata: Metadata = {
  title: "Café Canastra",
  description: "Café que vem de cima. Torrado sob demanda, desde 1985.",
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
