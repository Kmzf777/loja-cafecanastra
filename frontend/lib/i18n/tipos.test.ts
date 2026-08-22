import { describe, it, expect } from "vitest";
import { LOCALES, LOCALE_PADRAO, ehLocale, comoLocale } from "./tipos";

/**
 * `ehLocale` é o único portão entre a URL e o resto do i18n: o segmento
 * `[locale]` aceita qualquer string, e é este predicado que decide se ela vira
 * um `Locale` ou um 404. Se ele afrouxar, `/qualquer-coisa/cafes` passa a
 * responder 200 com conteúdo em português — três URLs por página viram
 * infinitas, e o canônico se dissolve.
 */
describe("locales", () => {
  it("tem exatamente os três idiomas do projeto", () => {
    expect([...LOCALES]).toEqual(["pt", "en", "es"]);
  });

  it("o padrão é português — é ele que não aparece na URL", () => {
    expect(LOCALE_PADRAO).toBe("pt");
    expect(LOCALES).toContain(LOCALE_PADRAO);
  });

  it("reconhece os três e recusa o resto", () => {
    for (const locale of LOCALES) expect(ehLocale(locale)).toBe(true);
    for (const impostor of ["", "PT", "pt-BR", "fr", "cafes", "en/cafes"]) {
      expect(ehLocale(impostor)).toBe(false);
    }
  });

  /**
   * Página e layout renderizam em paralelo: no instante antes de o `notFound()`
   * do layout valer, a página já recebeu o segmento. Cair no português é o que
   * impede um `undefined` de aparecer na tela nesse intervalo.
   */
  it("comoLocale estreita o que é idioma e cai no padrão no resto", () => {
    expect(comoLocale("en")).toBe("en");
    expect(comoLocale("es")).toBe("es");
    expect(comoLocale("fr")).toBe(LOCALE_PADRAO);
    expect(comoLocale("")).toBe(LOCALE_PADRAO);
  });
});
