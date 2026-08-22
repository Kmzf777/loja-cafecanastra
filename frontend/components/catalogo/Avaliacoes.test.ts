import { describe, it, expect } from "vitest";

import { contagem, dataDaAvaliacao } from "./Avaliacoes";
import { dicionario } from "@/lib/i18n/dicionario";
import { LOCALES } from "@/lib/i18n/tipos";

/**
 * As duas decisões da seção de avaliações que não são markup: o plural da
 * contagem e o formato da data.
 *
 * POR QUE NÃO SE RENDERIZA O COMPONENTE AQUI: ele é ilha de cliente e a lista
 * só chega depois do efeito que busca no PostgREST. Sem DOM, o efeito não roda
 * e `renderToStaticMarkup` devolve string vazia — um teste de markup não
 * verificaria nada. O que sobra de verificável são estas duas funções, e são
 * justamente as que erram calado: um "1 avaliações" e uma data de 08/03 lida
 * como 3 de agosto não quebram nada, só ficam errados na tela.
 */

describe("contagem de avaliações", () => {
  it("usa o singular só no 1, em cada idioma", () => {
    for (const locale of LOCALES) {
      const d = dicionario(locale);
      expect(contagem(1, d), `singular em ${locale}`).toBe(d.avaliacoes.uma);
      expect(contagem(2, d), `plural em ${locale}`).toBe(d.avaliacoes.muitas);
      // Zero vai para o plural nas três línguas — "0 avaliações", "0 reviews",
      // "0 opiniones". É por isso que a regra é uma função e não um `> 1`.
      expect(contagem(0, d), `zero em ${locale}`).toBe(d.avaliacoes.muitas);
    }
  });

  it("distingue singular de plural nas três línguas", () => {
    // Se as duas formas fossem iguais, o teste acima passaria sem provar nada.
    for (const locale of LOCALES) {
      const d = dicionario(locale);
      expect(d.avaliacoes.uma, locale).not.toBe(d.avaliacoes.muitas);
    }
  });
});

describe("data da avaliação", () => {
  it("escreve a data como o idioma da página escreve", () => {
    // 3 de agosto de 2026. O Brasil escreve dia/mês, os Estados Unidos
    // mês/dia — a mesma string ISO tem de sair diferente.
    const iso = "2026-08-03T12:00:00.000Z";

    expect(dataDaAvaliacao(iso, "pt")).toBe("03/08/2026");
    expect(dataDaAvaliacao(iso, "en")).toBe("8/3/2026");
    expect(dataDaAvaliacao(iso, "es")).toBe("3/8/2026");
  });

  it("some em vez de mostrar 'Invalid Date'", () => {
    // O campo vem do banco; se um dia vier torto, a linha da avaliação perde a
    // data e mantém o texto, que é o que a pessoa escreveu.
    expect(dataDaAvaliacao("nao-e-data", "pt")).toBe("");
  });
});
