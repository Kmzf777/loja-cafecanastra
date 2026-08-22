import { describe, expect, it } from "vitest";
import { LOCALES, type Locale } from "../../../../lib/i18n/tipos";
import { caminhoSemLocale, href } from "../../../../lib/i18n/rotas";
import { lotesDoLocale } from "../../../../lib/catalogo/produtos";
import { LINHAS } from "../../../../lib/catalogo/tipos";
import { filtrarPorTexto } from "../../../../lib/busca";
import {
  faixaDeTorraDoCatalogo,
  linhasDoCatalogo,
  notasDoCatalogo,
  textosDaPlp,
  type Sugestao,
} from "./conteudo";

/**
 * O QUE ESTE ARQUIVO EXISTE PARA IMPEDIR.
 *
 * A tela vazia da PLP mandava procurar por "frutado" — nota que NENHUMA linha
 * tem desde que o catálogo passou a usar as notas publicadas pela marca — e
 * dizia que a casa ia "da torra média do Suave à média-escura do Clássico",
 * quando o Clássico virou torra escura no mesmo diff. Era o único lugar da
 * página que existe para resgatar uma busca vazia, e ele produzia outra.
 *
 * Texto citado à mão envelhece em silêncio. Por isso o conteúdo do resgate é
 * DERIVADO do catálogo, e por isso estes testes: eles não conferem a frase,
 * conferem que toda sugestão que a tela oferece encontra café de verdade.
 */

/**
 * Os valores em que a tradução coincide com o português DE PROPÓSITO — mesma
 * mecânica do lib/i18n/dicionario.test.ts. Cada linha é uma afirmação, não um
 * esquecimento tolerado.
 */
const IGUAIS_DE_PROPOSITO: Record<Exclude<Locale, "pt">, string[]> = {
  en: [],
  es: [
    // "Cafés" e "Café Canastra" são a mesma coisa nas duas línguas — o nome da
    // marca não se traduz e o plural coincide.
    "metaTitulo",
    // Palavras idênticas em português e espanhol.
    "filtroFormato",
    "filtroOrdem",
    "opcaoTodas",
    "botaoFiltrar",
  ],
};

/**
 * ABRE O CHIP COMO A PÁGINA ABRIRIA: lê a querystring do caminho e devolve os
 * cafés que sobram. É a mesma dupla que a PLP usa nesse endereço — a faceta do
 * repositório e, depois dela, a busca por texto.
 */
function cafesQueOChipEncontra(sugestao: Sugestao, locale: Locale) {
  const url = new URL(sugestao.caminho, "https://loja.exemplo");
  const linha = url.searchParams.get("linha");
  const q = url.searchParams.get("q");

  const porFaceta = lotesDoLocale(locale).filter(
    // A mesma leitura de `lerFiltros`: valor fora de `LINHAS` seria DESCARTADO
    // pela página, e o chip mostraria o catálogo inteiro em vez do que promete.
    (lote) => !linha || lote.linha === linha,
  );
  return { achados: filtrarPorTexto(porFaceta, q ?? undefined, locale), linha, q };
}

describe("os textos da PLP", () => {
  it("não deixa nenhum valor vazio em idioma nenhum", () => {
    for (const locale of LOCALES) {
      for (const [chave, valor] of Object.entries(textosDaPlp(locale))) {
        expect(valor.trim(), `${locale}.${chave}`).not.toBe("");
      }
    }
  });

  it.each(["en", "es"] as const)(
    "não deixa texto em português vazando para %s",
    (locale) => {
      const traduzido = textosDaPlp(locale);
      for (const [chave, valor] of Object.entries(textosDaPlp("pt"))) {
        if (IGUAIS_DE_PROPOSITO[locale].includes(chave)) {
          expect(traduzido[chave as keyof typeof traduzido], chave).toBe(valor);
        } else {
          expect(traduzido[chave as keyof typeof traduzido], chave).not.toBe(
            valor,
          );
        }
      }
    },
  );

  /**
   * A descrição da PLP anunciava quatro linhas e a loja vende cinco: o Néctar
   * de Minas é um SKU à venda e faltava no cartão de resultado do buscador.
   */
  it("anuncia as cinco linhas na meta description, nos três idiomas", () => {
    for (const locale of LOCALES) {
      const descricao = textosDaPlp(locale).metaDescricao;
      for (const linha of linhasDoCatalogo(locale)) {
        expect(descricao, `${locale} · ${linha.slug}`).toContain(linha.rotulo);
      }
    }
  });
});

describe("as linhas que a tela vazia oferece", () => {
  it("são as do catálogo, sem repetição, com cor de embalagem", () => {
    for (const locale of LOCALES) {
      const linhas = linhasDoCatalogo(locale);
      expect(linhas.length, locale).toBeGreaterThan(0);
      expect(new Set(linhas.map((l) => l.slug)).size).toBe(linhas.length);
      for (const linha of linhas) {
        expect(linha.rotulo.trim(), `${locale}.${linha.slug}`).not.toBe("");
        expect(linha.cor, `${locale}.${linha.slug}`).toMatch(/^var\(--color-/);
      }
    }
  });

  /**
   * O chip leva a `/cafes?linha=<slug>` com todos os outros filtros zerados.
   * Se um slug oferecido aqui não casasse com lote nenhum, o resgate levaria a
   * pessoa da tela vazia para outra tela vazia.
   */
  it("todas encontram pelo menos um café", () => {
    for (const locale of LOCALES) {
      for (const linha of linhasDoCatalogo(locale)) {
        const { achados } = cafesQueOChipEncontra(linha, locale);
        expect(achados.length, `${locale} · ${linha.slug}`).toBeGreaterThan(0);
      }
    }
  });

  /**
   * O slug precisa ser um valor que `lerFiltros` ACEITA. Um valor fora de
   * `LINHAS` seria descartado em silêncio e o chip mostraria o catálogo
   * inteiro — não é tela vazia, mas é o chip prometendo uma coisa e entregando
   * outra.
   */
  it("filtram por um valor que a página reconhece", () => {
    for (const locale of LOCALES) {
      for (const linha of linhasDoCatalogo(locale)) {
        expect(LINHAS, `${locale} · ${linha.slug}`).toContain(linha.slug);
      }
    }
  });
});

describe("as notas que a tela vazia oferece", () => {
  it("saem do catálogo, sem repetição", () => {
    for (const locale of LOCALES) {
      const notas = notasDoCatalogo(locale);
      expect(notas.length, locale).toBeGreaterThan(0);
      expect(new Set(notas.map((n) => n.rotulo)).size, locale).toBe(
        notas.length,
      );
    }
  });

  /**
   * O TESTE QUE DERRUBA O DEFEITO ORIGINAL. O chip leva a `/cafes?q=<nota>`
   * com os filtros zerados; abrir esse endereço é exatamente o que a função
   * acima faz.
   */
  it("todas encontram pelo menos um café, nos três idiomas", () => {
    for (const locale of LOCALES) {
      for (const nota of notasDoCatalogo(locale)) {
        const { achados } = cafesQueOChipEncontra(nota, locale);
        expect(achados.length, `${locale} · ${nota.rotulo}`).toBeGreaterThan(0);
      }
    }
  });

  /**
   * A regressão nomeada: "frutado" era a sugestão cravada na mão, e nenhuma
   * linha da casa tem essa nota. Se um dia o catálogo ganhar um café frutado,
   * ela volta sozinha — e este teste passa a falhar, que é quando ele deve
   * ser reescrito com a nota que sumiu no lugar desta.
   */
  it("não sugere nota que o catálogo não tem", () => {
    const inexistentes: Record<Locale, string> = {
      pt: "Frutado",
      en: "Fruity",
      es: "Afrutado",
    };
    for (const locale of LOCALES) {
      expect(
        notasDoCatalogo(locale).map((n) => n.rotulo),
        locale,
      ).not.toContain(inexistentes[locale]);
      expect(
        filtrarPorTexto(lotesDoLocale(locale), inexistentes[locale], locale),
        `${locale} · a nota citada à mão continua sem café`,
      ).toHaveLength(0);
    }
  });

  it("mudam de idioma junto com o editorial traduzido", () => {
    const rotulos = (locale: Locale) =>
      notasDoCatalogo(locale).map((n) => n.rotulo);
    expect(rotulos("en")).not.toEqual(rotulos("pt"));
    expect(rotulos("es")).not.toEqual(rotulos("en"));
  });
});

describe("os endereços do resgate", () => {
  const todas = (locale: Locale): Sugestao[] => [
    ...linhasDoCatalogo(locale),
    ...notasDoCatalogo(locale),
  ];

  /**
   * O chip fica no idioma de quem o vê. Sem o `href()`, `/en/cafes` mandaria a
   * pessoa para a versão em português — e o middleware ainda cobraria um
   * redirect por clique.
   */
  it("ficam no idioma da página", () => {
    for (const locale of LOCALES) {
      for (const sugestao of todas(locale)) {
        expect(sugestao.caminho, `${locale} · ${sugestao.rotulo}`).toBe(
          href(locale, caminhoSemLocale(sugestao.caminho)),
        );
      }
    }
  });

  /**
   * SEMPRE `/cafes`, SEMPRE UM PARÂMETRO SÓ. Carregar o filtro atual junto
   * estreitaria a busca a partir de uma tela que já não achou nada — o resgate
   * tem de alargar. Um caminho errado aqui daria 404 no meio do resgate.
   */
  it("levam à própria PLP, com um filtro só e nada mais", () => {
    for (const locale of LOCALES) {
      for (const sugestao of todas(locale)) {
        const url = new URL(sugestao.caminho, "https://loja.exemplo");
        expect(caminhoSemLocale(url.pathname), sugestao.caminho).toBe("/cafes");
        expect([...url.searchParams.keys()], sugestao.caminho).toHaveLength(1);
      }
    }
  });
});

describe("a faixa de torra", () => {
  const faixa = faixaDeTorraDoCatalogo();

  it("tem café nos dois extremos — é o que a frase afirma", () => {
    const pontos = lotesDoLocale("pt").map((l) => l.pontoTorra);
    expect(pontos).toContain(faixa.min);
    expect(pontos).toContain(faixa.max);
  });

  it("não deixa nenhum café de fora", () => {
    for (const lote of lotesDoLocale("pt")) {
      expect(lote.pontoTorra, lote.slug).toBeGreaterThanOrEqual(faixa.min);
      expect(lote.pontoTorra, lote.slug).toBeLessThanOrEqual(faixa.max);
    }
  });

  it("é uma faixa de verdade, não um ponto só", () => {
    expect(faixa.min).toBeLessThan(faixa.max);
  });
});
