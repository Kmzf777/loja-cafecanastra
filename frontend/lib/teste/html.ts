import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

/**
 * O render de teste do repositório, num lugar só.
 *
 * Esta função estava COPIADA À MÃO em 20 arquivos de teste, sempre idêntica.
 * Não era um problema de estilo: era 20 lugares para mudar no dia em que a
 * técnica mudasse, e nenhum deles com nome que os ligasse.
 *
 * A técnica: `environment: "node"` no vitest.config.ts, sem jsdom e sem
 * testing-library. Isso NÃO EXECUTA EFEITO — uma ilha de cliente que busca
 * dados renderiza vazio aqui, e um teste que só verifique "não quebrou"
 * passaria provando nada. Para o que precisa de DOM existe
 * `lib/teste/renderizar.tsx`, restrito ao painel.
 */
export function html(no: ReactElement): string {
  return renderToStaticMarkup(no);
}
