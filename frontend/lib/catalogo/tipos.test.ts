import { describe, it, expect } from "vitest";
import { FORMATOS, LINHAS, METODOS, MOAGENS, ORDENACOES } from "./tipos";
import type { Metodo, Moagem, Preparo } from "./tipos";
import { LOTES } from "./produtos";
import { dicionario } from "../i18n/dicionario";
import { LOCALES } from "../i18n/tipos";

/**
 * O contrato de MOAGEM e MÉTODO, que até esta mudança eram um tipo só.
 *
 * O tipo antigo tinha sete valores — `grao` mais os seis métodos de preparo —
 * e respondia a duas perguntas diferentes com a mesma palavra: o que entra no
 * pacote (grão ou moído) e como o café vai ser feito em casa. A loja vende
 * dois formatos; os seis métodos apontavam todos para o MESMO SKU, com o mesmo
 * preço e o mesmo estoque.
 *
 * Estes testes são a trava dessa separação. Se alguém devolver os métodos à
 * lista de compra, a PDP volta a mostrar sete botões para dois produtos e a
 * contagem aqui embaixo falha antes de a tela existir.
 */

describe("Moagem — o que se COMPRA", () => {
  it("tem exatamente dois valores, porque a loja vende dois", () => {
    expect(MOAGENS).toHaveLength(2);
    expect(MOAGENS).toEqual(["grao", "moido"]);
  });

  it("nenhum método de preparo sobrou na lista de compra", () => {
    const valores = new Set<string>(MOAGENS);
    for (const metodo of METODOS) {
      expect(valores.has(metodo), `${metodo} virou opção de compra`).toBe(false);
    }
  });
});

describe("Metodo — como se PREPARA", () => {
  it("guarda os seis métodos que saíram da compra", () => {
    expect(METODOS).toEqual([
      "espresso",
      "coado-papel",
      "coador-pano",
      "prensa-francesa",
      "italiana-moka",
      "aeropress",
    ]);
  });

  it("toda receita do catálogo usa um método do contrato", () => {
    // `Preparo.metodo` sempre foi um MÉTODO, e não uma moagem — este teste é o
    // que prova que a mudança de tipo casou com o dado que já existia.
    const validos = new Set<string>(METODOS);
    for (const lote of LOTES) {
      expect(lote.preparo.length).toBeGreaterThan(0);
      for (const p of lote.preparo) {
        expect(validos.has(p.metodo), `${lote.slug} prepara em "${p.metodo}"`).toBe(
          true,
        );
      }
    }
  });
});

/**
 * Trava de COMPILAÇÃO, não de execução: o vitest apaga os tipos e não olharia
 * para isto. Quem cobra é o `tsc` do `next build`. Se `Preparo.metodo` voltar
 * a ser a união de compra, esta linha deixa de compilar — e "aeropress" some
 * de um dos dois lados sem ninguém perceber.
 */
const RECEITA_DE_AEROPRESS: Preparo = {
  metodo: "aeropress",
  proporcao: "1:13",
  gramas: 16,
  ml: 210,
  temperaturaC: 88,
  tempoSegundos: 120,
  moagem: "Fina",
};

/** O mesmo, do outro lado: a compra só conhece dois valores. */
const COMPRA_MOIDA: Moagem = "moido";
const PREPARO_ESPRESSO: Metodo = "espresso";

describe("as duas uniões não se cruzam mais (trava de compilação)", () => {
  it("carrega as constantes que só compilam com os tipos separados", () => {
    expect(RECEITA_DE_AEROPRESS.metodo).toBe("aeropress");
    expect(COMPRA_MOIDA).toBe("moido");
    expect(PREPARO_ESPRESSO).toBe("espresso");
  });
});

/**
 * A TRAVA DA MUDANÇA QUE TIROU O TEXTO DAQUI.
 *
 * As tabelas eram `{ valor, rotulo }[]` com um rótulo só, em português, e
 * alimentavam a PLP, a PDP e o Clube em qualquer idioma. Agora elas guardam
 * VALOR, e o texto está em `catalogo.*` no dicionário, chaveado pelo valor.
 *
 * Este bloco cobra as duas metades do combinado. A primeira é de COMPILAÇÃO e
 * acontece antes de o teste rodar: acrescentar um `Formato` novo à união sem
 * lhe dar rótulo faz `c.formato[f]` deixar de compilar aqui — o `tsc` do build
 * cobra os três idiomas de uma vez. A segunda é de execução, e pega o que o
 * tipo não pega: rótulo em branco, que compila e some na tela.
 */
describe("todo valor do contrato tem rótulo nos três idiomas", () => {
  it.each(LOCALES)("%s dá nome a cada valor, e nenhum em branco", (locale) => {
    const c = dicionario(locale).catalogo;

    for (const l of LINHAS)
      expect(c.linha[l].trim(), `${locale}.linha.${l}`).not.toBe("");
    for (const m of MOAGENS)
      expect(c.moagem[m].trim(), `${locale}.moagem.${m}`).not.toBe("");
    for (const m of METODOS)
      expect(c.metodo[m].trim(), `${locale}.metodo.${m}`).not.toBe("");
    for (const f of FORMATOS)
      expect(c.formato[f].trim(), `${locale}.formato.${f}`).not.toBe("");
    for (const o of ORDENACOES)
      expect(c.ordenacao[o].trim(), `${locale}.ordenacao.${o}`).not.toBe("");
  });

  it("a ordem da tabela é a ordem da tela, e ela não é acidental", () => {
    // A lista decide a sequência dos <option> e dos botões. "Relevância" é o
    // padrão da PLP e vem primeiro; os preços crescem; a torra vai de clara a
    // escura, na mesma direção da barra do <PontoTorra>.
    expect(ORDENACOES[0]).toBe("relevancia");
    expect(ORDENACOES).toEqual([
      "relevancia",
      "preco-asc",
      "preco-desc",
      "torra-asc",
      "torra-desc",
    ]);
    expect(FORMATOS).toEqual(["graos", "moido", "drip", "capsula"]);
    expect(LINHAS).toEqual([
      "classico",
      "suave",
      "canela",
      "microlote",
      "nectar-de-minas",
    ]);
  });

  it("as cinco linhas do contrato são as cinco do catálogo", () => {
    // `LINHAS` alimenta o <select> do filtro. Uma linha a mais ou a menos aqui
    // é um filtro que promete um café que não existe, ou esconde um que existe.
    expect([...LINHAS].sort()).toEqual(LOTES.map((l) => l.slug).sort());
  });
});
