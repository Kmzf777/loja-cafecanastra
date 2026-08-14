import "./globals.css";

export const metadata = {
  title: "Café Canastra",
  description: "Café que vem de cima. Torrado sob demanda, desde 1985.",
};

export default function RootLayout({ children }) {
  return (
    <html lang="pt-BR">
      <body>{children}</body>
    </html>
  );
}
