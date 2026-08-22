import { describe, it, expect } from "vitest";

import { moagemDaReceita } from "./receita";
import { dicionario } from "@/lib/i18n/dicionario";
import { lotesDoLocale } from "@/lib/catalogo/produtos";
import { LOCALES } from "@/lib/i18n/tipos";

/**
 * A ponte entre a receita e o dicionário.
 *
 * O TESTE QUE IMPORTA É O SEGUNDO: ele varre as receitas REAIS do catálogo e
 * exige que cada espessura de moagem escrita lá tenha tradução. É o que impede
 * que uma receita nova — "Extrafina", um dia — apareça em português no meio de
 * uma PDP em inglês sem ninguém notar, que foi exatamente como esta linha
 * escapou da onda de tradução.
 */

/** Todas as espessuras que o catálogo de fato usa hoje. */
const NO_CATALOGO = [
  ...new Set(lotesDoLocale("pt").flatMap((l) => l.preparo.map((p) => p.moagem))),
];

describe("moagemDaReceita", () => {
  it("traduz a espessura escrita na receita", () => {
    expect(moagemDaReceita("Média-fina", dicionario("en"))).toBe("Medium-fine");
    expect(moagemDaReceita("Grossa", dicionario("es"))).toBe("Gruesa");
    expect(moagemDaReceita("Média", dicionario("pt"))).toBe("Média");
  });

  it("cobre todas as espessuras que o catálogo usa, nos três idiomas", () => {
    expect(NO_CATALOGO.length).toBeGreaterThan(0);

    for (const locale of LOCALES) {
      const d = dicionario(locale);
      const daTabela = Object.values(d.catalogo.moagemDaReceita);
      // A PROVA É "SAIU DA TABELA", E NÃO "MUDOU DE TEXTO". `Fina` se escreve
      // igual em português e espanhol: comparar entrada com saída acusaria
      // como esquecida uma chave que está lá e está certa.
      const semTraducao = NO_CATALOGO.filter(
        (texto) => !daTabela.includes(moagemDaReceita(texto, d)),
      );
      expect(semTraducao, `sem tradução em ${locale}`).toEqual([]);
    }
  });

  it("devolve o texto original quando não reconhece, nunca vazio", () => {
    // O mesmo contrato de `rotuloNota()`: valor fora da tabela aparece como
    // veio. Uma ficha em branco é pior que uma ficha em português.
    expect(moagemDaReceita("Extrafina", dicionario("en"))).toBe("Extrafina");
    expect(moagemDaReceita("", dicionario("en"))).toBe("");
  });

  it("não se importa com acento nem com caixa", () => {
    // A chave é normalizada porque o texto vem de `Preparo.moagem`, que é
    // string livre — quem escreve a receita não sabe que existe uma tabela.
    expect(moagemDaReceita("MÉDIA", dicionario("en"))).toBe("Medium");
    expect(moagemDaReceita("media-fina", dicionario("en"))).toBe(
      "Medium-fine",
    );
  });
});
