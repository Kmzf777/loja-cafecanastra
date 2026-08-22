import { describe, it, expect } from "vitest";
import { LOCALES } from "../../../../lib/i18n/tipos";
import { MARCO_DE_ORIGEM, textosDaSerra } from "./conteudo";

/**
 * ESTES TESTES GUARDAM UM FATO, não um layout.
 *
 * A página dizia "Quarenta anos na mesma serra" e afirmava altitude de 900 a
 * 1.320 metros. As duas coisas eram falsas: a família plantou em 1985 em
 * Patrocínio, no cerrado, e só chegou à Canastra em 2008 — e a altitude nunca
 * teve fonte, pelo mesmo motivo que derrubou o tipo `Lavoura`
 * (lib/catalogo/tipos.ts, comentário de `Origem`).
 *
 * O risco agora não é alguém reescrever a página: é a tradução. Um "1985"
 * traduzido sem o "2008" ao lado, ou um "Patrocínio" virando "the countryside",
 * ressuscita a mentira num idioma que ninguém relê. Por isso as asserções
 * varrem os TRÊS idiomas.
 */

/** Todo o texto corrido de um idioma, num pedaço só. */
function prosaDe(locale: (typeof LOCALES)[number]): string[] {
  return Object.values(textosDaSerra(locale));
}

describe("a correção factual", () => {
  it("nunca cita 1985 sem citar 2008, em nenhum idioma", () => {
    for (const locale of LOCALES) {
      const prosa = prosaDe(locale).join(" ");
      if (prosa.includes("1985")) {
        expect(prosa, `${locale}: 1985 sozinho`).toContain("2008");
      }
    }
  });

  it("cita Patrocínio nos três idiomas — nome próprio não se traduz", () => {
    for (const locale of LOCALES) {
      expect(prosaDe(locale).join(" "), locale).toContain("Patrocínio");
    }
  });

  /**
   * A altitude por lote foi apagada do catálogo por não ter fonte. Reintroduzi-la
   * como texto de página seria o mesmo dado inventado, só que fora do tipo — e
   * fora do alcance de qualquer revisão de contrato.
   */
  it("não afirma altitude em metros", () => {
    for (const locale of LOCALES) {
      for (const texto of prosaDe(locale)) {
        expect(texto, `${locale}: "${texto}"`).not.toMatch(
          /\bmetros?\b|\bmeters?\b|\d\s?m\b/i,
        );
      }
    }
  });
});

describe("os dados que não se traduzem", () => {
  it("o marco de origem carrega as duas datas", () => {
    expect(MARCO_DE_ORIGEM).toContain("1985");
    expect(MARCO_DE_ORIGEM).toContain("2008");
  });
});

describe("os textos", () => {
  it("não têm texto vazio em nenhum idioma", () => {
    for (const locale of LOCALES) {
      for (const [chave, valor] of Object.entries(textosDaSerra(locale))) {
        expect(valor, `${locale}.${chave}`).not.toBe("");
      }
    }
  });
});
