import { describe, it, expect } from "vitest";
import { LOCALES } from "../../../../lib/i18n/tipos";
import { HISTORIA, ANCORAS_DOS_REGISTROS } from "./conteudo";

/**
 * O que estes testes protegem não é o layout — é o CONTEÚDO.
 *
 * A página é praticamente só texto, e texto é justamente o que some numa
 * refatoração sem ninguém perceber: um parágrafo apagado por engano não quebra
 * build nenhum, não gera erro de tipo, e a página continua bonita e errada. Os
 * dados abaixo (as variedades, os países de exportação, os nomes da família)
 * vieram do site institucional e são a razão de a página existir; o repositório
 * inteiro é uma cicatriz de dado inventado (ver lib/catalogo/tipos.ts), e a
 * regra aqui é a mesma: dado real sem teste é dado com prazo de validade.
 */

describe("conteúdo da /historia", () => {
  it("existe nos três idiomas do site", () => {
    for (const locale of LOCALES) {
      expect(HISTORIA[locale], locale).toBeDefined();
    }
  });

  /**
   * A âncora é a MESMA nos três idiomas de propósito: `/en/historia#ano-2008`
   * precisa apontar para o mesmo registro que `/historia#ano-2008`, senão um
   * link compartilhado quebra ao trocar de idioma. Por isso as âncoras são uma
   * constante única, fora do conteúdo traduzido.
   */
  it("tem os cinco registros da linha do tempo, na mesma ordem, nos três idiomas", () => {
    expect(ANCORAS_DOS_REGISTROS).toEqual([
      "ano-1985",
      "ano-1996",
      "ano-2008",
      "ano-2016",
      "hoje",
    ]);

    for (const locale of LOCALES) {
      const registros = HISTORIA[locale].registros;
      expect(registros, locale).toHaveLength(ANCORAS_DOS_REGISTROS.length);
      expect(
        registros.map((r) => r.ancora),
        locale,
      ).toEqual([...ANCORAS_DOS_REGISTROS]);
    }
  });

  it("nenhum registro chega vazio na tela", () => {
    for (const locale of LOCALES) {
      for (const registro of HISTORIA[locale].registros) {
        expect(registro.rotuloDoAno.trim(), `${locale}/${registro.ancora}`).not.toBe("");
        expect(registro.titulo.trim(), `${locale}/${registro.ancora}`).not.toBe("");
        expect(registro.paragrafos.length, `${locale}/${registro.ancora}`).toBeGreaterThan(0);
        for (const p of registro.paragrafos) {
          expect(p.trim(), `${locale}/${registro.ancora}`).not.toBe("");
        }
      }
    }
  });

  /**
   * Os quatro anos são dado, não enredo: eles carimbam a linha do tempo em
   * Martian Mono (estetica.md §4.2 — "números em Martian Mono, sempre") e são
   * o que um leitor de fato leva da página. Traduzir "1985" seria erro.
   */
  it("os anos não se traduzem", () => {
    for (const locale of LOCALES) {
      const anos = HISTORIA[locale].registros.slice(0, 4).map((r) => r.rotuloDoAno);
      expect(anos, locale).toEqual(["1985", "1996", "2008", "2016"]);
    }
  });

  /**
   * As três variedades vêm do texto institucional, e o
   * `marca.variedades` de data/catalogo-canastra.json passou a trazer as
   * mesmas — a lista antiga (Bourbon, Catuaí Vermelho, Araras, Mundo Novo)
   * vinha de pesquisa-web e contradizia a própria marca. As duas fontes agora
   * concordam, e este teste é o que impede a página de perder as reais no meio
   * do caminho.
   */
  it("guarda as três variedades da Canastra em todos os idiomas", () => {
    for (const locale of LOCALES) {
      const texto = HISTORIA[locale].registros
        .flatMap((r) => r.paragrafos)
        .join(" ");
      for (const variedade of ["Araras", "Caturra 2SL", "Paraíso"]) {
        expect(texto, `${locale} · ${variedade}`).toContain(variedade);
      }
    }
  });

  /**
   * Seis destinos, e eles são a prova concreta da frase "exportação direta".
   * Sem a lista, a afirmação vira marketing.
   */
  it("lista os seis destinos de exportação em todos os idiomas", () => {
    for (const locale of LOCALES) {
      expect(HISTORIA[locale].exportacao.destinos, locale).toHaveLength(6);
      expect(HISTORIA[locale].exportacao.nota.trim(), locale).not.toBe("");
    }
    expect(HISTORIA.pt.exportacao.destinos).toEqual([
      "Chile",
      "Argentina",
      "Estados Unidos",
      "Irlanda",
      "Holanda",
      "Emirados Árabes Unidos",
    ]);
  });

  /**
   * Os nomes são de pessoas reais e cada geração tem o seu: sem eles a página
   * conta a história de uma empresa, não de uma família — que é exatamente a
   * diferença que o institucional tinha e a loja não.
   */
  it("mantém os nomes das três gerações", () => {
    for (const locale of LOCALES) {
      const texto = HISTORIA[locale].registros
        .flatMap((r) => r.paragrafos)
        .join(" ");
      for (const nome of ["Conceição", "Belchior", "Silvio", "Arthur"]) {
        expect(texto, `${locale} · ${nome}`).toContain(nome);
      }
    }
  });

  it("tem título e descrição de metadata em cada idioma", () => {
    for (const locale of LOCALES) {
      expect(HISTORIA[locale].meta.titulo, locale).toContain("Canastra");
      // O limite prático do snippet do Google. Acima disso o buscador corta a
      // frase no meio, e a descrição perde justamente o fecho.
      expect(HISTORIA[locale].meta.descricao.length, locale).toBeLessThanOrEqual(160);
      expect(HISTORIA[locale].meta.descricao.length, locale).toBeGreaterThan(50);
    }
  });
});
