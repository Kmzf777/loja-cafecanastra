import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  FUSO,
  diaEmSaoPaulo,
  formatarData,
  formatarDataHora,
  janelaAnterior,
  janelaDeDias,
  somarDias,
} from "./data";

/**
 * R31 virada em teste — "dd/mm/aaaa em America/Sao_Paulo, sempre".
 *
 * O DEFEITO QUE ESTES CASOS EXISTEM PARA PEGAR não aparece em nenhuma tela: ele
 * aparece no fechamento do mês, quando o relatório de agosto e a tela de
 * pedidos discordam de um dia. Um pedido das 22h de 20/08 em São Paulo é
 * `2026-08-21T01:00:00Z` no banco — se a formatação não disser o fuso, o
 * ambiente de quem roda decide, e o teste passa na máquina do desenvolvedor
 * (que está em -03) e mente na VPS (que está em UTC).
 *
 * Por isso TODOS os casos abaixo usam instantes que CAEM DOS DOIS LADOS da
 * meia-noite: um caso às 12h passaria mesmo com a formatação errada.
 */
describe("formatarData — o dia é o de São Paulo, não o de UTC", () => {
  it("22h de 20/08 em São Paulo é 20/08, e não o 21/08 do UTC", () => {
    // 2026-08-21T01:00:00Z === 2026-08-20T22:00 em São Paulo (UTC-3).
    expect(formatarData("2026-08-21T01:00:00.000Z")).toBe("20/08/2026");
  });

  it("e a virada do ano também: 23h de 31/12 não vira 01/01", () => {
    expect(formatarData("2027-01-01T02:00:00.000Z")).toBe("31/12/2026");
  });

  it("01h de 21/08 em São Paulo continua sendo 21/08", () => {
    expect(formatarData("2026-08-21T04:00:00.000Z")).toBe("21/08/2026");
  });

  it("aceita Date, string ISO e número de época — o banco manda os três", () => {
    const instante = Date.parse("2026-08-21T01:00:00.000Z");
    expect(formatarData(new Date(instante))).toBe("20/08/2026");
    expect(formatarData(instante)).toBe("20/08/2026");
    expect(formatarData("2026-08-21T01:00:00.000Z")).toBe("20/08/2026");
  });

  /**
   * AUSÊNCIA NÃO É 01/01/1970. `cancelada_em` é NULL na assinatura que nunca
   * foi cancelada, e `new Date(null)` é a época — uma data plausível o
   * bastante para ninguém desconfiar dela numa coluna.
   */
  it.each([null, undefined, ""])("ausência (%s) vira travessão", (valor) => {
    expect(formatarData(valor as null)).toBe("—");
  });

  /**
   * `new Date("qualquer coisa")` NÃO LANÇA: devolve `Invalid Date`, e
   * `Intl.format` de um Invalid Date lança `RangeError` — a tela inteira
   * quebrando por causa de uma linha ruim. Sem a guarda, o `.format` estouraria
   * aqui.
   */
  it("lixo não derruba a tela nem imprime 'Invalid Date'", () => {
    expect(formatarData("não é data")).toBe("—");
    expect(formatarData(new Date("nada"))).toBe("—");
  });
});

describe("formatarDataHora", () => {
  it("traz a hora de São Paulo, e ela é a que muda o dia", () => {
    const s = formatarDataHora("2026-08-21T01:00:00.000Z");
    expect(s).toContain("20/08/2026");
    expect(s).toContain("22:00");
  });

  it("ausência continua sendo travessão, não 1970", () => {
    expect(formatarDataHora(null)).toBe("—");
  });
});

describe("diaEmSaoPaulo — o YYYY-MM-DD que vai para ?de=/?ate=", () => {
  /**
   * ESTE É O CASO QUE `toISOString().slice(0,10)` ERRA, e é o motivo de a
   * função existir: das 21h à meia-noite de São Paulo, o UTC já virou o dia.
   * Uma janela de "últimos 7 dias" montada com o dia de UTC começaria amanhã.
   */
  it("às 22h de 20/08 em São Paulo, hoje é 2026-08-20", () => {
    expect(diaEmSaoPaulo(new Date("2026-08-21T01:00:00.000Z"))).toBe("2026-08-20");
  });

  it("e o mesmo instante em toISOString daria o dia seguinte — a prova", () => {
    const agora = new Date("2026-08-21T01:00:00.000Z");
    expect(agora.toISOString().slice(0, 10)).toBe("2026-08-21");
    expect(diaEmSaoPaulo(agora)).not.toBe(agora.toISOString().slice(0, 10));
  });

  it("às 10h de 21/08 em São Paulo, hoje é 2026-08-21", () => {
    expect(diaEmSaoPaulo(new Date("2026-08-21T13:00:00.000Z"))).toBe("2026-08-21");
  });

  it("sai no formato exato que o backend valida", () => {
    expect(diaEmSaoPaulo(new Date())).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

describe("somarDias", () => {
  it("anda para a frente e para trás", () => {
    expect(somarDias("2026-08-20", 1)).toBe("2026-08-21");
    expect(somarDias("2026-08-20", -1)).toBe("2026-08-19");
    expect(somarDias("2026-08-20", 0)).toBe("2026-08-20");
  });

  it("atravessa mês e ano sem ajuda", () => {
    expect(somarDias("2026-08-31", 1)).toBe("2026-09-01");
    expect(somarDias("2026-01-01", -1)).toBe("2025-12-31");
  });

  it("conhece ano bissexto", () => {
    expect(somarDias("2028-02-28", 1)).toBe("2028-02-29");
    expect(somarDias("2027-02-28", 1)).toBe("2027-03-01");
  });

  /**
   * Entrada que não é dia devolve "", e quem chama OMITE o parâmetro. Mandar
   * "NaN-NaN-NaN" faria o backend responder 400 com uma frase sobre formato, e
   * a tela mostraria um erro de API para um defeito que é daqui.
   */
  it.each(["", "20/08/2026", "2026-8-2", "hoje", "2026-08-20T00:00:00Z"])(
    "%s não é um dia, e devolve vazio em vez de NaN",
    (entrada) => {
      expect(somarDias(entrada, 1)).toBe("");
    },
  );
});

describe("janelaDeDias / janelaAnterior — as duas metades da comparação", () => {
  /**
   * "ÚLTIMOS 7 DIAS" INCLUI HOJE. Com `de = hoje - 7` a janela teria oito dias,
   * e a comparação com o período anterior estaria errada em ~14% para sempre —
   * sem nada na tela denunciando, porque os dois números continuariam parecendo
   * plausíveis.
   */
  it("a janela de 7 dias tem 7 dias e termina hoje", () => {
    expect(janelaDeDias(7, "2026-08-20")).toEqual({
      de: "2026-08-14",
      ate: "2026-08-20",
    });
  });

  it("a de 30 idem", () => {
    expect(janelaDeDias(30, "2026-08-20")).toEqual({
      de: "2026-07-22",
      ate: "2026-08-20",
    });
  });

  /**
   * A JANELA ANTERIOR TERMINA NA VÉSPERA DO INÍCIO DA ATUAL. Terminar no mesmo
   * dia em que a atual começa contaria esse dia nas duas, e o KPI diria "+3%"
   * num dia em que nada mudou.
   */
  it("a janela anterior encosta na atual sem sobrepor nem pular", () => {
    const atual = janelaDeDias(7, "2026-08-20");
    const anterior = janelaAnterior(7, "2026-08-20");
    expect(anterior).toEqual({ de: "2026-08-07", ate: "2026-08-13" });
    expect(somarDias(anterior.ate, 1)).toBe(atual.de);
  });

  it("as duas janelas têm exatamente o mesmo tamanho — senão a comparação mente", () => {
    for (const dias of [1, 7, 14, 30, 90]) {
      const atual = janelaDeDias(dias, "2026-03-15");
      const anterior = janelaAnterior(dias, "2026-03-15");
      const tamanho = (j: { de: string; ate: string }) =>
        (Date.parse(j.ate) - Date.parse(j.de)) / 86_400_000 + 1;
      expect(tamanho(anterior)).toBe(dias);
      expect(tamanho(atual)).toBe(dias);
    }
  });
});

describe("o fuso é o da loja, e está escrito", () => {
  it("America/Sao_Paulo", () => {
    expect(FUSO).toBe("America/Sao_Paulo");
  });

  /**
   * ESTE TESTE É ESTRUTURAL, E ELE EXISTE PORQUE OS DE CIMA NÃO BASTAM — foi
   * MEDIDO, não suposto.
   *
   * Apagando `timeZone: FUSO` do `DIA_BR` e rodando a suíte nesta máquina, os
   * casos de "22h de 20/08" continuaram VERDES: o relógio do computador já está
   * em -03, então a formatação sem fuso acerta por coincidência. Numa VPS em
   * UTC os mesmos casos ficariam vermelhos — ou seja, o teste comportamental
   * protege o servidor e não protege quem escreve o código, que é justamente
   * quem vai apagar a linha.
   *
   * Um teste que só falha em metade das máquinas é pior que nenhum: ele ensina
   * que a mudança passou. Por isso a guarda de verdade lê o ARQUIVO e exige que
   * TODO `Intl.DateTimeFormat` deste módulo declare o fuso — uma pergunta cuja
   * resposta não depende do relógio de ninguém. É o mesmo mecanismo que
   * `proibicoes.test.ts` e `status.test.ts` já usam nesta casa.
   */
  it("todo formatador deste módulo declara o fuso — e não herda o do relógio", () => {
    const fonte = readFileSync(join(__dirname, "data.ts"), "utf8");

    const formatadores = [...fonte.matchAll(/new Intl\.DateTimeFormat\(([\s\S]*?)\}\)/g)];

    // Se um dia a implementação parar de usar `Intl.DateTimeFormat`, este teste
    // passaria a não olhar para nada e a passar por engano.
    expect(formatadores.length).toBeGreaterThanOrEqual(3);

    for (const [trecho] of formatadores) {
      expect(trecho).toContain("timeZone: FUSO");
    }
  });
});
