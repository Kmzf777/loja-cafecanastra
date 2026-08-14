import type { ReactNode } from "react";

/**
 * Layout do grupo de rotas da vitrine.
 *
 * O grupo `(vitrine)` nao altera a URL: `app/(vitrine)/page.tsx` continua
 * servindo `/`. Sua funcao aqui e puramente de escopo de estilo — aplicar a
 * classe `.vitrine`, que ativa o reset do Tailwind definido em app/globals.css.
 *
 * O reset NAO pode subir para o <body> em app/layout.jsx: aquele layout tambem
 * envolve /dashboard, onde vive o painel legado em styled-components, que
 * depende dos defaults do navegador para titulos, botoes e links.
 */
export default function VitrineLayout({ children }: { children: ReactNode }) {
  return <div className="vitrine">{children}</div>;
}
