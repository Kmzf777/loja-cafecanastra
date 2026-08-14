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

export const metadata = {
  title: "Café Canastra",
  description: "Café que vem de cima. Torrado sob demanda, desde 1985.",
};

export default function RootLayout({ children }) {
  return (
    <html lang="pt-BR" className={`${archivo.variable} ${martianMono.variable}`}>
      <body>{children}</body>
    </html>
  );
}
