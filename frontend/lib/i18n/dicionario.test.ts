import { describe, expect, it } from "vitest";

import { dicionario } from "./dicionario";
import { LOCALES, type Locale } from "./tipos";

/**
 * O QUE ESTE TESTE PEGA, E QUE O TYPESCRIPT NÃO PEGA.
 *
 * O tipo `Dicionario` garante que a CHAVE existe em `en` e em `es`. Ele não
 * garante que o VALOR foi traduzido — uma chave copiada do português compila
 * perfeitamente e só aparece como um "Ver os cafés" no meio de uma página em
 * inglês, numa rota que ninguém da equipe revisita. Foi exatamente esse o
 * estado do arquivo entre a Onda 1 e a Onda 3.
 *
 * Então a trava aqui é o contrário da do tipo: todo valor de `en` e de `es`
 * PRECISA ser diferente do português, e a exceção tem de ser declarada uma a
 * uma em `IGUAIS_DE_PROPOSITO`. Cada linha daquela lista é uma afirmação
 * ("esta palavra é a mesma nesta língua, e é assim que se escreve"), e não um
 * esquecimento tolerado em silêncio.
 */

/**
 * Os caminhos em que o valor traduzido coincide com o português DE PROPÓSITO.
 * Nome próprio de produto, palavra idêntica nas duas línguas, ou empréstimo
 * que já é a forma usada no idioma de destino.
 */
const IGUAIS_DE_PROPOSITO: Record<Exclude<Locale, "pt">, string[]> = {
  en: [
    // "Menu" é a mesma palavra nas duas línguas.
    "nav.menu",
    // Nome próprio do produto — não se traduz em idioma nenhum.
    "rodape.clubeDaCanastra",
    // "item" é a mesma palavra nas duas línguas; o plural já diverge
    // ("itens"/"items") e por isso não está aqui.
    "comum.item",
  ],
  es: [
    "nav.principal",
    "nav.cafes",
    "nav.buscar",
    "rodape.colunaCafes",
    "rodape.clubeDaCanastra",
    // "lote" é a mesma palavra, e é também o termo da indústria em espanhol.
    "comum.lote",
    "comum.lotes",
    // Gerúndio idêntico nas duas línguas.
    "newsletter.enviando",
  ],
};

/** Achata `{ nav: { cafes: "Cafés" } }` em `[["nav.cafes", "Cafés"]]`. */
function folhas(objeto: object, prefixo = ""): [string, string][] {
  return Object.entries(objeto).flatMap(([chave, valor]) => {
    const caminho = prefixo ? `${prefixo}.${chave}` : chave;
    return typeof valor === "string"
      ? [[caminho, valor] as [string, string]]
      : folhas(valor as object, caminho);
  });
}

const PT = new Map(folhas(dicionario("pt")));

describe("dicionario", () => {
  it("tem exatamente as mesmas chaves nos três idiomas", () => {
    const esperado = [...PT.keys()].sort();
    for (const locale of LOCALES) {
      expect(
        [...new Map(folhas(dicionario(locale))).keys()].sort(),
        `chaves de ${locale}`,
      ).toEqual(esperado);
    }
  });

  it("não deixa nenhum valor vazio em idioma nenhum", () => {
    for (const locale of LOCALES) {
      for (const [caminho, valor] of folhas(dicionario(locale))) {
        expect(valor.trim(), `${locale}.${caminho}`).not.toBe("");
      }
    }
  });

  it.each(["en", "es"] as const)(
    "não deixa texto em português vazando para %s",
    (locale) => {
      const permitidos = new Set(IGUAIS_DE_PROPOSITO[locale]);
      const vazando = folhas(dicionario(locale))
        .filter(
          ([caminho, valor]) =>
            valor === PT.get(caminho) && !permitidos.has(caminho),
        )
        .map(([caminho]) => caminho);

      expect(vazando).toEqual([]);
    },
  );

  it.each(["en", "es"] as const)(
    "não declara exceção para chave que na verdade foi traduzida em %s",
    (locale) => {
      // Sem isto a lista de exceções vira lixo acumulado: uma chave traduzida
      // depois continuaria dispensada da trava para sempre.
      const obsoletas = IGUAIS_DE_PROPOSITO[locale].filter(
        (caminho) =>
          new Map(folhas(dicionario(locale))).get(caminho) !== PT.get(caminho),
      );

      expect(obsoletas).toEqual([]);
    },
  );

  it("preserva o nome do Clube da Canastra nos três idiomas", () => {
    for (const locale of LOCALES) {
      expect(dicionario(locale).rodape.clubeDaCanastra).toBe(
        "Clube da Canastra",
      );
    }
  });

  it("mantém o aviso da fronteira dizendo Brasil e o real em cada idioma", () => {
    // O aviso existe para a pessoa saber ANTES de tentar comprar que o envio é
    // só para o Brasil e a cobrança é em real (spec §1). Uma tradução que
    // perca um dos dois fatos devolve o cliente ao problema que ele resolve.
    expect(dicionario("en").compra.avisoTexto).toMatch(/Brazil/);
    expect(dicionario("en").compra.avisoTexto).toMatch(/reais/);
    expect(dicionario("es").compra.avisoTexto).toMatch(/Brasil/);
    expect(dicionario("es").compra.avisoTexto).toMatch(/reales/);
  });
});
