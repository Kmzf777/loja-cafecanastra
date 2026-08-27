import { describe, it, expect } from "vitest";

import {
  LIMIAR_DE_ESTOQUE,
  contagemDeStatus,
  contarEstoqueBaixo,
  linhasSemResposta,
  montarFila,
  montarIndicadores,
  numero,
  serieDeReceita,
  somaDaSerie,
  totalDaFila,
  variacao,
  type ResumoDoPainel,
} from "./home.logica";

/**
 * O MÓDULO DA HOME, e o defeito que quase todos os casos aqui perseguem é UM SÓ:
 * **`null` virando `0`**.
 *
 * Ele não dá erro em lugar nenhum. A tela fica bonita, o número fica plausível,
 * e o gestor lê "nenhum pedido a despachar" numa manhã em que há trinta e a API
 * está fora do ar. O painel legado documenta essa lição em `HomeDashboard.jsx`,
 * e ela custou caro o bastante para virar a doutrina do `<EstadoDaTela>`.
 */

describe("numero — a fronteira onde ausência vira zero", () => {
  it("converte o que o pg manda como string", () => {
    // `numeric` e `bigint` chegam como STRING pelo driver do pg.
    expect(numero("1234.56")).toBe(1234.56);
    expect(numero("42")).toBe(42);
    expect(numero(42)).toBe(42);
    expect(numero(0)).toBe(0);
  });

  /**
   * `Number(null)` é `0` e `Number("")` é `0`. São as duas armadilhas que fazem
   * uma ausência virar um zero convincente — e as duas passam por qualquer
   * `if (n)` sem levantar suspeita.
   */
  it.each([null, undefined, "", "   "])("ausência (%j) é null, JAMAIS zero", (bruto) => {
    expect(numero(bruto)).toBeNull();
    expect(numero(bruto)).not.toBe(0);
  });

  it.each(["abc", "R$ 12,00", Number.NaN, Infinity, -Infinity])(
    "lixo (%j) é null, não NaN",
    (bruto) => {
      expect(numero(bruto)).toBeNull();
    },
  );

  /**
   * ESTE CASO PEGOU A IMPLEMENTAÇÃO NO VERMELHO, e por isso ele tem teste
   * próprio: `Number([])` é `0` e `Number(true)` é `1`. A primeira versão da
   * função recusava `null`, `undefined` e string vazia e convertia "o resto" —
   * e devolvia zero para um array vazio, que é exatamente a forma que um campo
   * JSON assume quando um contrato muda.
   *
   * A lição virou regra: enumerar o que é LIXO exige acertar a lista inteira;
   * enumerar o que é DADO exige acertar dois casos.
   */
  it("nem array, nem booleano, nem objeto viram número", () => {
    for (const bruto of [[], [1], {}, true, false, () => 1]) {
      expect(numero(bruto)).toBeNull();
    }
  });
});

describe("contagemDeStatus — onde o zero É legítimo", () => {
  const chart = [
    { status: "aprovado", count: "12" },
    { status: "pendente", count: "3" },
  ];

  it("acha o status e converte a contagem", () => {
    expect(contagemDeStatus(chart, "aprovado")).toBe(12);
  });

  /**
   * O `statusChart` é um `GROUP BY status`: status sem nenhum pedido NÃO APARECE
   * na lista. Ausente-na-lista quer dizer ZERO — a pergunta foi feita e
   * respondida —, e devolver `null` aqui faria a tela mostrar travessão para
   * uma resposta que ela tem.
   */
  it("status ausente do GROUP BY é ZERO, porque a pergunta foi respondida", () => {
    expect(contagemDeStatus(chart, "rejeitado")).toBe(0);
  });

  /**
   * A leitura FALHOU: não há chart nenhum. Aqui `0` seria a mentira — e é a
   * distinção que a função inteira existe para manter.
   */
  it.each([null, undefined, "não é lista"])(
    "chart ausente (%j) é null, e não zero",
    (chartRuim) => {
      expect(contagemDeStatus(chartRuim as never, "aprovado")).toBeNull();
    },
  );

  it("contagem corrompida na linha certa vira zero, e não NaN", () => {
    expect(contagemDeStatus([{ status: "aprovado", count: null }], "aprovado")).toBe(0);
  });
});

describe("serieDeReceita / somaDaSerie", () => {
  it("converte os totais e preserva a ordem que o backend deu", () => {
    const serie = serieDeReceita([
      { day: "18/08", total: "120.50" },
      { day: "19/08", total: "80.00" },
    ]);
    expect(serie).toEqual([
      { dia: "18/08", valor: 120.5 },
      { dia: "19/08", valor: 80 },
    ]);
  });

  /**
   * Um `NaN` no meio da série faz o recharts desenhar um buraco na linha sem
   * dizer por quê — e um buraco parece um dia sem venda, que é uma informação
   * errada. Fora da série, o dia simplesmente não existe no gráfico.
   */
  it("descarta ponto sem dia ou com total ilegível, em vez de plotar NaN", () => {
    expect(
      serieDeReceita([
        { day: "18/08", total: "120.50" },
        { day: "", total: "9" },
        { day: "19/08", total: "abc" },
        { day: "20/08", total: null },
      ]),
    ).toEqual([{ dia: "18/08", valor: 120.5 }]);
  });

  it.each([null, undefined, {} as never])("chart ausente (%j) é série vazia", (chart) => {
    expect(serieDeReceita(chart as never)).toEqual([]);
  });

  it("soma o que sobrou", () => {
    expect(somaDaSerie([{ dia: "a", valor: 10.5 }, { dia: "b", valor: 4.5 }])).toBe(15);
    expect(somaDaSerie([])).toBe(0);
  });
});

describe("contarEstoqueBaixo", () => {
  const catalogo = [
    { quantity: 0 },
    { quantity: 3 },
    { quantity: LIMIAR_DE_ESTOQUE },
    { quantity: LIMIAR_DE_ESTOQUE + 1 },
    { quantity: 200 },
  ];

  it("conta quem está no limite ou abaixo — o limite entra", () => {
    expect(contarEstoqueBaixo(catalogo)).toBe(3);
  });

  it("aceita a quantidade como string, que é como o pg às vezes entrega", () => {
    expect(contarEstoqueBaixo([{ quantity: "2" }, { quantity: "90" }])).toBe(1);
  });

  /**
   * NÃO SABER QUANTO HÁ NÃO É O MESMO QUE SABER QUE HÁ POUCO. Uma quantidade
   * ilegível contada como estoque baixo mandaria o gestor reabastecer um
   * produto cheio.
   */
  it("quantidade ilegível NÃO conta como estoque baixo", () => {
    expect(contarEstoqueBaixo([{ quantity: null }, { quantity: "abc" }, {}])).toBe(0);
  });

  it("catálogo não lido é null, e catálogo vazio é zero", () => {
    expect(contarEstoqueBaixo(null)).toBeNull();
    expect(contarEstoqueBaixo(undefined)).toBeNull();
    expect(contarEstoqueBaixo([])).toBe(0);
  });
});

describe("montarFila — cada linha é um link para uma lista filtrada", () => {
  const contagens = {
    aDespachar: 12,
    pagamentoPendente: 3,
    pagamentoRecusado: 1,
    avaliacoesPendentes: 4,
    estoqueBaixo: 2,
  };

  it("são cinco linhas, na ordem do §4.1", () => {
    expect(montarFila(contagens).map((l) => l.chave)).toEqual([
      "despachar",
      "pagamento-pendente",
      "pagamento-recusado",
      "avaliacoes",
      "estoque",
    ]);
  });

  /**
   * "CADA LINHA É UM LINK PARA UMA ABA SALVA DE VERDADE, não um número
   * decorativo" — §4.1, literal. O que faz a aba ser "de verdade" é o FILTRO
   * estar na URL: um link para `/dashboard/pedidos` sem `?status=` levaria à
   * lista inteira, e o gestor teria de refazer à mão o recorte que a home
   * acabou de fazer por ele.
   */
  it("todo href leva o filtro na query string, e nenhum é decorativo", () => {
    for (const linha of montarFila(contagens)) {
      expect(linha.href).toContain("?");
      expect(linha.href.startsWith("/dashboard/")).toBe(true);
    }
  });

  it("os destinos são os que a onda seguinte vai acender", () => {
    const hrefs = Object.fromEntries(montarFila(contagens).map((l) => [l.chave, l.href]));
    expect(hrefs.despachar).toBe("/dashboard/pedidos?status=aprovado");
    expect(hrefs["pagamento-pendente"]).toBe("/dashboard/pedidos?status=pendente");
    expect(hrefs["pagamento-recusado"]).toBe("/dashboard/pedidos?status=rejeitado");
    expect(hrefs.avaliacoes).toBe("/dashboard/avaliacoes?status=pendente");
    expect(hrefs.estoque).toBe("/dashboard/produtos?estoque=baixo");
  });

  /**
   * R29: um número que não se confere é um número em que não se confia. Toda
   * linha diz o que ela conta.
   */
  it("toda linha carrega a definição da própria contagem", () => {
    for (const linha of montarFila(contagens)) {
      expect(linha.definicao.length).toBeGreaterThan(10);
    }
  });

  /**
   * A LINHA QUE A SPEC PEDIU E QUE NÃO EXISTE. §4.1 lista "assinatura com
   * cobrança falhada"; não há dunning nesta loja, então esse número não é
   * computável — a cobrança que falha vira um pedido `rejeitado` e a assinatura
   * continua `ativa`. A fila conta o que existe e se chama pelo que conta, e a
   * definição avisa que ali há duas coisas misturadas.
   */
  it("não promete indicador de saúde de assinatura", () => {
    const fila = montarFila(contagens);
    for (const linha of fila) {
      expect(linha.rotulo.toLowerCase()).not.toContain("assinatura");
    }
    const recusado = fila.find((l) => l.chave === "pagamento-recusado")!;
    expect(recusado.definicao).toContain("Clube");
    expect(recusado.definicao).toContain("não distingue");
  });

  /**
   * O limiar de estoque é FIXO porque `canastra.produtos` não tem
   * `estoque_minimo` em migração nenhuma. Dizê-lo é o que impede o gestor de
   * procurar a tela onde se configura um mínimo que não existe.
   */
  it("a linha de estoque diz que o limite é fixo, e por quê", () => {
    const estoque = montarFila(contagens).find((l) => l.chave === "estoque")!;
    expect(estoque.definicao).toContain(String(LIMIAR_DE_ESTOQUE));
    expect(estoque.ressalva).toContain("não há estoque mínimo");
  });

  it("catálogo maior que uma página troca a ressalva por 'contagem parcial'", () => {
    const estoque = montarFila({ ...contagens, estoqueParcial: true }).find(
      (l) => l.chave === "estoque",
    )!;
    expect(estoque.ressalva).toContain("parcial");
  });

  it("null atravessa a montagem sem virar zero", () => {
    const fila = montarFila({
      aDespachar: null,
      pagamentoPendente: 0,
      pagamentoRecusado: null,
      avaliacoesPendentes: 0,
      estoqueBaixo: null,
    });
    expect(fila.map((l) => l.contagem)).toEqual([null, 0, null, 0, null]);
  });
});

describe("linhasSemResposta / totalDaFila", () => {
  const fila = (contagens: (number | null)[]) =>
    montarFila({
      aDespachar: contagens[0],
      pagamentoPendente: contagens[1],
      pagamentoRecusado: contagens[2],
      avaliacoesPendentes: contagens[3],
      estoqueBaixo: contagens[4],
    });

  it("conta quantas não puderam ser consultadas", () => {
    expect(linhasSemResposta(fila([1, 2, 3, 4, 5]))).toBe(0);
    expect(linhasSemResposta(fila([null, 2, null, 4, 5]))).toBe(2);
  });

  it("soma o que há para fazer", () => {
    expect(totalDaFila(fila([1, 2, 3, 4, 5]))).toBe(15);
    expect(totalDaFila(fila([0, 0, 0, 0, 0]))).toBe(0);
  });

  /**
   * COM NENHUMA LINHA LIDA, O TOTAL É `null` — nunca `0`. Somar só o que
   * respondeu e chamar de total inventaria um número MENOR que o verdadeiro, e
   * um total menor é pior que total nenhum: ele parece uma boa notícia.
   */
  it("nada lido é null, e não zero", () => {
    expect(totalDaFila(fila([null, null, null, null, null]))).toBeNull();
  });

  it("com leitura parcial, soma o que sabe (a tela avisa que é parcial)", () => {
    expect(totalDaFila(fila([3, null, null, null, null]))).toBe(3);
  });
});

describe("variacao — e a divisão por zero, que é o caso REAL", () => {
  it("sobe, desce e fica igual", () => {
    expect(variacao(12, 10)).toEqual({ tipo: "sobe", percentual: 20 });
    expect(variacao(8, 10)).toEqual({ tipo: "desce", percentual: -20 });
    expect(variacao(10, 10)).toEqual({ tipo: "igual", percentual: 0 });
  });

  it("arredonda para inteiro — casa decimal em variação é falsa precisão", () => {
    expect(variacao(13, 10)).toEqual({ tipo: "sobe", percentual: 30 });
    expect(variacao(101, 100)).toEqual({ tipo: "sobe", percentual: 1 });
    // 100 → 100.4 arredonda para 0%, e "0%" é "igual", não "subiu um
    // pouquinho": mostrar seta de alta com 0% ao lado é o painel se
    // contradizendo na mesma linha.
    expect(variacao(1004, 1000)).toEqual({ tipo: "igual", percentual: 0 });
  });

  /**
   * UMA LOJA PEQUENA TEM SEMANA COM ZERO PEDIDO, então `(5 - 0) / 0` é o caso
   * comum e não o exótico. `Infinity` formatado vira "+Infinity%"; "consertado"
   * para 100% vira uma mentira com duas casas de precisão. "Sem base de
   * comparação" é a única resposta verdadeira.
   */
  it("período anterior zerado NÃO vira +100% nem +∞%", () => {
    expect(variacao(5, 0)).toEqual({ tipo: "sem-base", percentual: null });
    expect(Number.isFinite(variacao(5, 0).percentual as number)).toBe(false);
  });

  /** Zero contra zero é `igual`: não houve mudança, e isso é informação. */
  it("zero contra zero é igual, não 'sem base'", () => {
    expect(variacao(0, 0)).toEqual({ tipo: "igual", percentual: 0 });
  });

  it.each([
    [null, 10],
    [10, null],
    [null, null],
  ])("ponta não lida (%j, %j) é 'desconhecida', não 0%", (atual, anterior) => {
    expect(variacao(atual, anterior)).toEqual({ tipo: "desconhecida", percentual: null });
  });
});

describe("montarIndicadores", () => {
  const resumo: ResumoDoPainel = {
    counts: { products: 24, orders: 310, users: 187 },
    salesChart: [
      { day: "18/08", total: "120.50" },
      { day: "19/08", total: "80.00" },
    ],
    statusChart: [{ status: "aprovado", count: "12" }],
  };

  const completo = {
    resumo,
    pedidos7: 12,
    pedidos7Anteriores: 10,
    pedidos30: 40,
    pedidos30Anteriores: 50,
  };

  it("são seis — dentro dos 4 a 8 que o §4.1 pede", () => {
    const indicadores = montarIndicadores(completo);
    expect(indicadores.length).toBeGreaterThanOrEqual(4);
    expect(indicadores.length).toBeLessThanOrEqual(8);
  });

  /**
   * O `Intl` do `pt-BR` separa "R$" do número com um ESPAÇO NÃO-QUEBRÁVEL
   * (U+00A0), não com um espaço comum — e uma comparação escrita à mão falha
   * mostrando duas strings visualmente idênticas, que é dos erros mais
   * confusos de depurar. O `semNbsp` está aqui para ninguém repetir a conta.
   */
  const semNbsp = (texto: string | null) => texto?.replace(/ /g, " ") ?? null;

  it("a receita é a soma da série, formatada em reais", () => {
    const receita = montarIndicadores(completo).find((i) => i.chave === "receita-7")!;
    expect(semNbsp(receita.valor)).toBe("R$ 200,50");
  });

  it("as comparações de período que existem são reais", () => {
    const indicadores = montarIndicadores(completo);
    expect(indicadores.find((i) => i.chave === "pedidos-7")!.variacao).toEqual({
      tipo: "sobe",
      percentual: 20,
    });
    expect(indicadores.find((i) => i.chave === "pedidos-30")!.variacao).toEqual({
      tipo: "desce",
      percentual: -20,
    });
  });

  /**
   * `GET /dashboard/summary` devolve SETE DIAS e nada mais — não há parâmetro de
   * período nem série anterior. Um KPI de receita com uma seta ao lado seria uma
   * comparação inventada, e a definição diz por que ela não está lá.
   */
  it("a receita NÃO finge ter comparação — a API só devolve um período", () => {
    const receita = montarIndicadores(completo).find((i) => i.chave === "receita-7")!;
    expect(receita.variacao.tipo).toBe("desconhecida");
    expect(receita.comparadoCom).toBeUndefined();
    expect(receita.definicao).toContain("não há comparação");
  });

  /**
   * DUAS MÉTRICAS COM O MESMO "7 DIAS" MEDEM COISAS DIFERENTES: a receita conta
   * 168 horas corridas e só status de venda; a contagem de pedidos conta sete
   * dias de calendário de São Paulo e todo status. Sem isso escrito, o painel
   * produz duas verdades incompatíveis na mesma tela — e a divergência aparece
   * no fechamento, quando alguém confere.
   */
  it("as duas métricas de '7 dias' declaram recortes diferentes — R29", () => {
    const indicadores = montarIndicadores(completo);
    const receita = indicadores.find((i) => i.chave === "receita-7")!;
    const pedidos = indicadores.find((i) => i.chave === "pedidos-7")!;
    expect(receita.definicao).toContain("168 horas");
    expect(pedidos.definicao).toContain("São Paulo");
    expect(receita.definicao).not.toBe(pedidos.definicao);
  });

  it("toda métrica carrega a própria fórmula — R29", () => {
    for (const indicador of montarIndicadores(completo)) {
      expect(indicador.definicao.length).toBeGreaterThan(10);
    }
  });

  /**
   * O RESUMO NÃO LIDO NÃO VIRA R$ 0,00 NEM "0 clientes". É o mesmo defeito de
   * sempre, no lugar em que ele é mais convincente: zero receita é uma notícia
   * plausível numa terça de manhã.
   */
  it("resumo não lido dá travessão em tudo que vem dele, e nunca zero", () => {
    const indicadores = montarIndicadores({ ...completo, resumo: null });
    for (const chave of ["receita-7", "clientes", "produtos", "pedidos-total"]) {
      expect(indicadores.find((i) => i.chave === chave)!.valor).toBeNull();
    }
    // As contagens de pedidos vêm de outra rota, e essa respondeu.
    expect(indicadores.find((i) => i.chave === "pedidos-7")!.valor).toBe("12");
  });

  it("contagem faltando dentro do resumo também dá travessão", () => {
    const indicadores = montarIndicadores({ ...completo, resumo: { counts: {} } });
    expect(indicadores.find((i) => i.chave === "clientes")!.valor).toBeNull();
    // Série ausente é receita zero? Não: sem `salesChart` a soma é de nada, e a
    // tela mostra R$ 0,00 — o resumo VEIO, e ele diz que não houve venda.
    expect(semNbsp(indicadores.find((i) => i.chave === "receita-7")!.valor)).toBe(
      "R$ 0,00",
    );
  });
});
