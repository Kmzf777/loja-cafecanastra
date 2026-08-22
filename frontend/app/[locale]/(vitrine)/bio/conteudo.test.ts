import { describe, it, expect } from "vitest";
import { LOCALES } from "../../../../lib/i18n/tipos";
import {
  PRINCIPAIS,
  SECUNDARIOS,
  ehExterno,
  hospedeiroDe,
  textosDaBio,
} from "./conteudo";

/**
 * O que estes testes travam é o que quebra em silêncio numa página de link de
 * Instagram: um destino errado, um rótulo que só existe em português, ou um
 * link externo que perdeu o `noopener`. Nada disso aparece na tela de quem
 * escreveu — aparece na de quem clicou pelo telefone.
 */

const TODOS = [...PRINCIPAIS, ...SECUNDARIOS];

describe("os destinos", () => {
  it("interno começa com barra; externo é https absoluto", () => {
    for (const link of TODOS) {
      if (ehExterno(link.href)) {
        expect(link.href).toMatch(/^https:\/\//);
      } else {
        expect(link.href).toMatch(/^\//);
      }
    }
  });

  /**
   * Dois destinos idênticos em blocos diferentes é o erro de copiar e colar
   * que ninguém revisa. Os dois links do atacado só se distinguem pelo
   * `utm_campaign` — se um dia alguém apagar a querystring de um deles, esta
   * asserção é que avisa.
   */
  it("nenhum destino se repete", () => {
    const hrefs = TODOS.map((l) => l.href);
    expect(new Set(hrefs).size).toBe(hrefs.length);
  });

  /**
   * UTM em link INTERNO reinicia a atribuição no meio da visita: a pessoa já
   * chegou do Instagram na própria /bio, e a campanha já foi contada ali. O
   * segundo carimbo transformaria um clique interno numa sessão nova.
   */
  it("link interno não carrega utm", () => {
    for (const link of TODOS.filter((l) => !ehExterno(l.href))) {
      expect(link.href).not.toContain("utm_");
    }
  });

  /** O externo precisa do rastreio da marca — é o funil do atacado. */
  it("todo link externo declara a campanha", () => {
    for (const link of TODOS.filter((l) => ehExterno(l.href))) {
      expect(link.href).toContain("utm_campaign=");
    }
  });
});

describe("hospedeiroDe", () => {
  /** É o aviso VISÍVEL de que o clique sai do site — sem ele, o bloco mente. */
  it("devolve o domínio sem esquema nem caminho", () => {
    expect(hospedeiroDe("https://atacado.cafecanastra.com/cafeatacado?x=1")).toBe(
      "atacado.cafecanastra.com",
    );
  });

  it("corta a querystring mesmo sem caminho", () => {
    expect(hospedeiroDe("https://atacado.cafecanastra.com?utm_source=x")).toBe(
      "atacado.cafecanastra.com",
    );
  });

  it("devolve string vazia para caminho interno", () => {
    expect(hospedeiroDe("/cafes")).toBe("");
  });
});

describe("os textos", () => {
  /**
   * A trava é a mesma do dicionário de interface: o `pt` é a fonte do tipo, e
   * o TypeScript recusa `en`/`es` com chave faltando. Este teste é o segundo
   * cadeado, porque o tipo não impede uma string VAZIA — e string vazia num
   * bloco de link é um retângulo mudo na tela.
   */
  it("existem nos três idiomas, e nenhum é vazio", () => {
    for (const locale of LOCALES) {
      const t = textosDaBio(locale);
      for (const link of PRINCIPAIS) {
        expect(t.principais[link.id].rotulo.trim()).not.toBe("");
        expect(t.principais[link.id].apoio.trim()).not.toBe("");
      }
      for (const link of SECUNDARIOS) {
        expect(t.secundarios[link.id].trim()).not.toBe("");
      }
      expect(t.saiDoSite.trim()).not.toBe("");
      expect(t.abreEmOutraAba.trim()).not.toBe("");
    }
  });

  it("o título e a descrição de metadata existem nos três idiomas", () => {
    for (const locale of LOCALES) {
      const t = textosDaBio(locale);
      expect(t.titulo.trim()).not.toBe("");
      expect(t.descricao.length).toBeGreaterThan(40);
    }
  });
});
