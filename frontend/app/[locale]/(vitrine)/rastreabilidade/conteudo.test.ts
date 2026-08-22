import { describe, it, expect } from "vitest";
import { LOCALES } from "../../../../lib/i18n/tipos";
import {
  HOSPEDEIRO_DA_BASE,
  REGISTRO_DO_PRODUTOR,
  URL_DA_BASE,
  textosDaRastreabilidade,
} from "./conteudo";

/**
 * A página inteira é um link. O que ela promete antes do clique — o domínio e o
 * número do registro — precisa ser o que o clique entrega; caso contrário ela
 * vira exatamente o tipo de aviso decorativo que o projeto existe para não ter.
 * Estes testes travam essa coincidência.
 */

describe("o destino externo", () => {
  it("é https — a base é de terceiros e o caminho não pode ser em claro", () => {
    expect(URL_DA_BASE).toMatch(/^https:\/\//);
  });

  it("leva ao domínio que a página mostra", () => {
    expect(URL_DA_BASE.startsWith(`https://${HOSPEDEIRO_DA_BASE}/`)).toBe(true);
  });

  it("leva ao registro que a página mostra", () => {
    expect(URL_DA_BASE).toContain(REGISTRO_DO_PRODUTOR);
  });
});

describe("os textos", () => {
  it("não têm texto vazio em nenhum idioma", () => {
    for (const locale of LOCALES) {
      for (const [chave, valor] of Object.entries(
        textosDaRastreabilidade(locale),
      )) {
        expect(valor, `${locale}.${chave}`).not.toBe("");
      }
    }
  });

  /**
   * O aviso de que o clique sai do site é o motivo de a página existir — sem
   * ele, o honesto seria mandar o rodapé direto para a URL externa. Uma
   * tradução que o esvaziasse deixaria só o botão.
   */
  it("avisam que o clique sai do site, nos três idiomas", () => {
    for (const locale of LOCALES) {
      const t = textosDaRastreabilidade(locale);
      expect(t.avisoTitulo.length, locale).toBeGreaterThan(10);
      expect(t.avisoTexto, locale).toContain("Cerrado Mineiro");
      expect(t.abreEmOutraAba.length, locale).toBeGreaterThan(5);
    }
  });
});
