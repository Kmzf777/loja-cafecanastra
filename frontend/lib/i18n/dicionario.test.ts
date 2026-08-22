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
    // OS NOMES DAS CINCO LINHAS. É o que está impresso no pacote que chega na
    // casa da pessoa: traduzir desliga o reconhecimento da marca e quebra a
    // busca de quem chega pelo rótulo. Estão no dicionário mesmo assim para
    // que nenhum componente invente a sua própria versão.
    "catalogo.linha.classico",
    "catalogo.linha.suave",
    "catalogo.linha.canela",
    "catalogo.linha.microlote",
    "catalogo.linha.nectar-de-minas",
    // Notas de prova que se escrevem igual nas duas línguas.
    "catalogo.nota.chocolate",
    "catalogo.nota.floral",
    // Fruta brasileira sem nome em inglês — a roda de sabores usa o nosso.
    "catalogo.nota.jabuticaba",
    // Nomes de método que o inglês já empresta inteiros.
    "catalogo.metodo.espresso",
    "catalogo.metodo.aeropress",
    // Nome do produto impresso na caixa da loja.
    "catalogo.formato.drip",
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
    // Os nomes das cinco linhas — ver a nota do `en`.
    "catalogo.linha.classico",
    "catalogo.linha.suave",
    "catalogo.linha.canela",
    "catalogo.linha.microlote",
    "catalogo.linha.nectar-de-minas",
    // Notas de prova idênticas em português e espanhol.
    "catalogo.nota.chocolate",
    "catalogo.nota.caramelo",
    "catalogo.nota.citrico",
    "catalogo.nota.floral",
    "catalogo.nota.canela",
    "catalogo.nota.jabuticaba",
    "catalogo.metodo.espresso",
    "catalogo.metodo.prensa-francesa",
    "catalogo.metodo.aeropress",
    "catalogo.formato.drip",
    "catalogo.formato.capsula",
    // A moagem fina se escreve igual nas duas línguas; as outras três da
    // escala (média, média-fina, grossa) divergem e por isso não estão aqui.
    "catalogo.moagemDaReceita.fina",
    // "Temperatura" e "Peso" são a mesma palavra em português e espanhol.
    "pdp.receita.temperatura",
    "pdp.rotulo.peso",
    // "Modo de compra" e "Compra única" se escrevem igual nas duas línguas —
    // é a forma corrente em espanhol, não português deixado para trás.
    "pdp.modoDeCompra",
    "pdp.compraUnica",
    // "unidades" é a mesma palavra; o singular nem existe nesta tela.
    "venda.kit.unidades",
    // "4,8 de 5" se lê igual nas duas línguas.
    "avaliacoes.deCinco",
    // "Notas de cacao" é como o espanhol escreve — a mesma forma do português.
    // Em inglês a ficha de prova diz "tasting notes", e lá a chave diverge.
    "pdp.notasDe",
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
