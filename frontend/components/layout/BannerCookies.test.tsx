import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import { BannerCookies, VAR_ALTURA_DO_AVISO } from "./BannerCookies";

/**
 * O aviso de cookies visto do servidor — que é onde ele NÃO pode aparecer.
 *
 * SEM DOM (vitest em ambiente `node`), então o que dá para verificar aqui é o
 * markup do servidor e o contrato que o aviso publica para o resto da loja. O
 * comportamento vivo — aparecer, medir-se, sumir — foi medido em Playwright a
 * 360×800 nos três idiomas.
 */

describe("BannerCookies", () => {
  it("não escreve nada no HTML do servidor", () => {
    // A escolha mora no localStorage, que o servidor não enxerga. Renderizar o
    // aviso no HTML e removê-lo na hidratação daria diferença entre os dois —
    // e, pior, mostraria o aviso por um instante a quem já respondeu.
    for (const locale of ["pt", "en", "es"] as const) {
      expect(
        renderToStaticMarkup(<BannerCookies locale={locale} />),
        locale,
      ).toBe("");
    }
  });

  it("publica a altura do aviso como propriedade CSS customizada", () => {
    // Este nome é o contrato com quem mais disputa a base da janela — hoje a
    // barra de compra fixa da PDP (components/catalogo/PainelCompra.tsx), que
    // ficava 73px INTEIRA por baixo do aviso em 360×800. Tem de ser uma
    // custom property de verdade, senão o `var()` do outro lado não resolve.
    expect(VAR_ALTURA_DO_AVISO.startsWith("--")).toBe(true);
    expect(VAR_ALTURA_DO_AVISO).toBe("--altura-do-aviso-de-cookies");
  });
});
