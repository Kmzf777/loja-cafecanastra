import type { ReactNode } from "react";
import { Cabecalho } from "@/components/layout/Cabecalho";
import { Rodape } from "@/components/layout/Rodape";
import { Grao } from "@/components/ui/Grao";
import { ProvedorDaSacola } from "@/lib/sacola/sacola";

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
 */
export default function VitrineLayout({ children }: { children: ReactNode }) {
  return (
    // O provedor da sacola envolve só a vitrine, não o painel: /dashboard tem o
    // próprio conjunto de contexts legados e não precisa de carrinho.
    <ProvedorDaSacola>
      <div className="vitrine flex min-h-screen flex-col">
        <Grao />
        <Cabecalho />
        <main className="flex-1">{children}</main>
        <Rodape />
      </div>
    </ProvedorDaSacola>
  );
}
