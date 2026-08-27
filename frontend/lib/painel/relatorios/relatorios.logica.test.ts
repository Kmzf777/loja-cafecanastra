import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  DIAS_PADRAO,
  DIVERGENCIAS,
  FORMULAS,
  MODELO_DE_ATRIBUICAO,
  PAGINAS_NO_MAXIMO,
  POR_PAGINA_NA_LEITURA,
  RELATORIOS,
  RELATORIOS_IMPOSSIVEIS,
  ROTA_DE_RELATORIOS,
  SEM_CUPOM,
  STATUS_DE_VENDA,
  TETO_DE_PEDIDOS,
  agregarPorCupom,
  agregarPorProduto,
  agregarPorStatus,
  centavosDeReais,
  centavosDoItem,
  chipsDoRelatorio,
  coberturaDoRelatorio,
  colunasDe,
  lerEstado,
  montarConsulta,
  ordenar,
  paraBr,
  serieDiaria,
  urlDaOrdenacao,
  urlDaTela,
  type EstadoDoRelatorio,
  type PedidoDoRelatorio,
} from "./relatorios.logica";

const HOJE = "2026-08-26";

let contador = 0;

function pedido(sobrescreve: Partial<PedidoDoRelatorio> = {}): PedidoDoRelatorio {
  contador += 1;
  return {
    order_id: `pedido-${contador}`,
    status: "aprovado",
    created_at: "2026-08-26T15:00:00.000Z",
    total_amount: "120.00",
    discount: "0",
    coupon_code: null,
    items: [{ product_id: 1, name: "Clássico 250g", price: 60, quantity: 2 }],
    ...sobrescreve,
  };
}

function estado(sobrescreve: Partial<EstadoDoRelatorio> = {}): EstadoDoRelatorio {
  return {
    relatorio: "produto",
    de: "2026-08-01",
    ate: "2026-08-26",
    ordem: "receita",
    direcao: "desc",
    grafico: true,
    ...sobrescreve,
  };
}

/* ========================================================================== *
 * O recorte de venda
 * ========================================================================== */

describe("STATUS_DE_VENDA", () => {
  /**
   * O recorte é o MESMO do `/dashboard/summary`. Um relatório com outro recorte
   * faria a home e os relatórios discordarem sobre o mesmo número — que é o
   * começo de "o sistema está quebrado".
   */
  it("é GRUPO_ATIVO menos pendente e autorizado, conferido no backend", () => {
    const fonte = readFileSync(
      join(__dirname, "..", "..", "..", "..", "backend", "src", "utils", "statusDePedido.js"),
      "utf8",
    );
    const validos = fonte.match(/STATUS_VALIDOS\s*=\s*Object\.freeze\(\[([\s\S]*?)\]\)/);
    const cancelado = fonte.match(/GRUPO_CANCELADO\s*=\s*Object\.freeze\(\[([\s\S]*?)\]\)/);
    expect(validos).not.toBeNull();
    expect(cancelado).not.toBeNull();

    const todos = [...validos![1].matchAll(/"([a-z_]+)"/g)].map((m) => m[1]);
    const cancelados = [...cancelado![1].matchAll(/"([a-z_]+)"/g)].map((m) => m[1]);
    const esperado = todos.filter(
      (s) => !cancelados.includes(s) && s !== "pendente" && s !== "autorizado",
    );

    expect(STATUS_DE_VENDA).toEqual(esperado);
  });

  it("cancelado, rejeitado e reembolsado NÃO são receita", () => {
    for (const s of ["cancelado", "rejeitado", "reembolsado"]) {
      expect(STATUS_DE_VENDA).not.toContain(s);
    }
  });

  /** Um PIX gerado e não pago é `pendente`; contá-lo infla o faturamento com
   *  dinheiro que talvez nunca chegue. */
  it("pendente e autorizado ficam de fora — ainda não são receita", () => {
    expect(STATUS_DE_VENDA).not.toContain("pendente");
    expect(STATUS_DE_VENDA).not.toContain("autorizado");
  });

  it("aprovado, em processamento, enviado e entregue contam", () => {
    expect(STATUS_DE_VENDA).toEqual([
      "aprovado",
      "em_processamento",
      "enviado",
      "entregue",
    ]);
  });
});

/* ========================================================================== *
 * O estado da tela
 * ========================================================================== */

describe("lerEstado", () => {
  it("sem parâmetro nenhum: vendas por produto, últimos 30 dias, gráfico ligado", () => {
    const e = lerEstado({}, HOJE);
    expect(e.relatorio).toBe("produto");
    expect(e.ate).toBe(HOJE);
    expect(e.de).toBe("2026-07-28");
    expect(e.grafico).toBe(true);
    expect(DIAS_PADRAO).toBe(30);
  });

  it("relatório fora da lista cai no padrão em vez de quebrar", () => {
    expect(lerEstado({ relatorio: "inventado" }, HOJE).relatorio).toBe("produto");
  });

  it("cada relatório da lista é aceito", () => {
    for (const r of RELATORIOS) {
      expect(lerEstado({ relatorio: r.valor }, HOJE).relatorio).toBe(r.valor);
    }
  });

  /** `/admin/orders` responde 400 com frase para formato inválido: um link
   *  velho viraria uma tarja de erro em vez do relatório do mês. */
  it("data malformada cai no padrão e não vai para o backend", () => {
    const e = lerEstado({ de: "26/08/2026", ate: "ontem" }, HOJE);
    expect(e.de).toBe("2026-07-28");
    expect(e.ate).toBe(HOJE);
  });

  /**
   * O CASO SILENCIOSO: com `de > ate` o backend NÃO erra — devolve zero
   * pedidos, sem reclamar. A tela desenharia "nenhuma venda no período", e
   * ninguém desconfiaria de um período que ele mesmo montou errado.
   */
  it("janela invertida é endireitada, e não devolve zero pedidos calada", () => {
    const e = lerEstado({ de: "2026-08-26", ate: "2026-08-01" }, HOJE);
    expect(e.de).toBe("2026-08-01");
    expect(e.ate).toBe("2026-08-26");
  });

  it("o gráfico só desliga com o literal «nao» — R30, e o desligamento persiste", () => {
    expect(lerEstado({ grafico: "nao" }, HOJE).grafico).toBe(false);
    expect(lerEstado({ grafico: "sim" }, HOJE).grafico).toBe(true);
    expect(lerEstado({}, HOJE).grafico).toBe(true);
  });

  it("ordem fora das colunas daquele relatório cai no padrão dele", () => {
    expect(lerEstado({ relatorio: "produto", ordem: "codigo" }, HOJE).ordem).toBe(
      "receita",
    );
    expect(lerEstado({ relatorio: "cupom", ordem: "codigo" }, HOJE).ordem).toBe(
      "codigo",
    );
  });

  /** Série temporal se lê na ordem do tempo: uma linha do tempo ordenada por
   *  receita não é uma linha do tempo. */
  it("o relatório por dia nasce ordenado pelo DIA, crescente", () => {
    const e = lerEstado({ relatorio: "dia" }, HOJE);
    expect(e.ordem).toBe("dia");
    expect(e.direcao).toBe("asc");
  });

  it("direção inválida cai no padrão do relatório", () => {
    expect(lerEstado({ direcao: "aleatoria" }, HOJE).direcao).toBe("desc");
  });
});

describe("urlDaTela", () => {
  it("o padrão não polui a URL", () => {
    expect(urlDaTela({ relatorio: "produto" })).toBe(ROTA_DE_RELATORIOS);
  });

  it("o gráfico desligado aparece na URL, para sobreviver ao F5", () => {
    expect(urlDaTela(estado({ grafico: false }))).toContain("grafico=nao");
    expect(urlDaTela(estado({ grafico: true }))).not.toContain("grafico");
  });

  it("o período viaja junto — R2", () => {
    const url = urlDaTela(estado());
    expect(url).toContain("de=2026-08-01");
    expect(url).toContain("ate=2026-08-26");
  });
});

describe("urlDaOrdenacao", () => {
  it("clicar na coluna já ordenada inverte a direção", () => {
    expect(urlDaOrdenacao(estado({ ordem: "receita", direcao: "desc" }), "receita")).toContain(
      "direcao=asc",
    );
    expect(urlDaOrdenacao(estado({ ordem: "receita", direcao: "asc" }), "receita")).toContain(
      "direcao=desc",
    );
  });

  /** Número procura o maior primeiro; texto procura o A. */
  it("coluna nova começa: número decrescente, texto crescente", () => {
    expect(urlDaOrdenacao(estado({ ordem: "nome" }), "unidades")).toContain("direcao=desc");
    expect(urlDaOrdenacao(estado({ ordem: "unidades" }), "nome")).toContain("direcao=asc");
  });

  it("ordenar preserva o período e o gráfico desligado", () => {
    const url = urlDaOrdenacao(estado({ grafico: false }), "unidades");
    expect(url).toContain("de=2026-08-01");
    expect(url).toContain("grafico=nao");
  });
});

describe("montarConsulta", () => {
  it("pede só os status que contam como venda, numa ida só", () => {
    const c = montarConsulta(estado(), 1);
    expect(c).toContain("status=aprovado%2Cem_processamento%2Cenviado%2Centregue");
  });

  it("leva o período e o limite máximo da rota", () => {
    const c = montarConsulta(estado(), 3);
    expect(c).toContain("de=2026-08-01");
    expect(c).toContain("ate=2026-08-26");
    expect(c).toContain(`limit=${POR_PAGINA_NA_LEITURA}`);
    expect(c).toContain("page=3");
  });

  it("bate na rota que existe de verdade", () => {
    expect(montarConsulta(estado(), 1).startsWith("/admin/orders?")).toBe(true);
  });
});

describe("chipsDoRelatorio", () => {
  it("mostra o período em dd/mm/aaaa — R31", () => {
    expect(chipsDoRelatorio(estado())[0].valor).toBe("01/08/2026 a 26/08/2026");
  });

  /** Sem recorte de tempo o relatório leria a base inteira e bateria no teto
   *  na primeira abertura: o chip do período mostra, mas não remove. */
  it("o chip do período devolve ao padrão em vez de apagar o recorte", () => {
    expect(chipsDoRelatorio(estado())[0].href).toContain("de=");
  });
});

describe("paraBr", () => {
  /**
   * `new Date("2026-08-26")` é MEIA-NOITE UTC, que em São Paulo é 25/08 21h: o
   * caminho "óbvio" imprime o dia anterior no rótulo do próprio filtro.
   */
  it("não passa por Date, e por isso não perde um dia no fuso", () => {
    expect(paraBr("2026-08-26")).toBe("26/08/2026");
    expect(paraBr("2026-01-01")).toBe("01/01/2026");
  });

  it("entrada fora do formato vira travessão", () => {
    expect(paraBr("26/08/2026")).toBe("—");
    expect(paraBr("")).toBe("—");
  });
});

/* ========================================================================== *
 * A cobertura — o teto declarado
 * ========================================================================== */

describe("coberturaDoRelatorio", () => {
  it("o teto é dez páginas de cem", () => {
    expect(TETO_DE_PEDIDOS).toBe(POR_PAGINA_NA_LEITURA * PAGINAS_NO_MAXIMO);
    expect(TETO_DE_PEDIDOS).toBe(1000);
  });

  /** Um aviso que aparece sempre é um aviso que ninguém lê. */
  it("cobertura completa não gera aviso nenhum", () => {
    const c = coberturaDoRelatorio(48, 48);
    expect(c.completa).toBe(true);
    expect(c.aviso).toBe("");
  });

  /**
   * Um relatório que cobre em silêncio só os mil mais recentes é pior que
   * relatório nenhum, porque parece uma resposta. A frase diz os dois números
   * e o que fazer.
   */
  it("cobertura parcial diz os dois números e o que fazer", () => {
    const c = coberturaDoRelatorio(3482, 1000);
    expect(c.completa).toBe(false);
    expect(c.aviso).toContain("1000");
    expect(c.aviso).toContain("3482");
    expect(c.aviso).toContain("encurte o período");
  });

  it("zero pedidos é cobertura completa — não há nada faltando", () => {
    expect(coberturaDoRelatorio(0, 0).completa).toBe(true);
  });
});

/* ========================================================================== *
 * Dinheiro
 * ========================================================================== */

describe("centavosDeReais", () => {
  it("lê a string numeric do pg", () => {
    expect(centavosDeReais("120.00")).toBe(12_000);
    expect(centavosDeReais("59.90")).toBe(5990);
  });

  it("lê número também", () => {
    expect(centavosDeReais(59.9)).toBe(5990);
  });

  /** Somar reais em ponto flutuante produz um total que não fecha com o
   *  extrato, e ninguém acha a causa. */
  it("arredonda o centavo, e a soma de centavos fecha", () => {
    const linhas = ["0.10", "0.20"].map(centavosDeReais);
    expect(linhas.reduce((a, b) => a + b, 0)).toBe(30);
  });

  it("nulo, vazio e texto viram zero em vez de NaN", () => {
    expect(centavosDeReais(null)).toBe(0);
    expect(centavosDeReais(undefined)).toBe(0);
    expect(centavosDeReais("")).toBe(0);
    expect(centavosDeReais("abc")).toBe(0);
  });
});

describe("centavosDoItem", () => {
  it("preço unitário × quantidade, em centavos", () => {
    expect(centavosDoItem({ price: 59.9, quantity: 2 })).toBe(11_980);
  });

  it("quantidade ausente ou negativa vale zero, e não NaN na soma", () => {
    expect(centavosDoItem({ price: 59.9 })).toBe(0);
    expect(centavosDoItem({ price: 59.9, quantity: -3 })).toBe(0);
  });

  it("quantidade como string (jsonb solto) é lida", () => {
    expect(centavosDoItem({ price: 10, quantity: "3" })).toBe(3000);
  });
});

/* ========================================================================== *
 * Vendas por produto
 * ========================================================================== */

describe("agregarPorProduto", () => {
  it("soma unidades e receita do mesmo produto entre pedidos", () => {
    const linhas = agregarPorProduto([
      pedido({ items: [{ product_id: 1, name: "Clássico 250g", price: 60, quantity: 2 }] }),
      pedido({ items: [{ product_id: 1, name: "Clássico 250g", price: 60, quantity: 1 }] }),
    ]);
    expect(linhas).toHaveLength(1);
    expect(linhas[0].unidades).toBe(3);
    expect(linhas[0].receitaCentavos).toBe(18_000);
    expect(linhas[0].pedidos).toBe(2);
  });

  /**
   * `itens` é fotografia congelada: o mesmo produto renomeado aparece com dois
   * nomes ao longo do tempo. Agrupar por nome partiria a linha em duas no dia
   * em que alguém corrigisse um acento.
   */
  it("agrupa por product_id, e o produto renomeado continua sendo uma linha", () => {
    const linhas = agregarPorProduto([
      pedido({ items: [{ product_id: 7, name: "Classico 250g", price: 60, quantity: 1 }] }),
      pedido({ items: [{ product_id: 7, name: "Clássico 250 g", price: 60, quantity: 1 }] }),
    ]);
    expect(linhas).toHaveLength(1);
    // E o nome exibido é o da ocorrência mais recente — o que o gestor reconhece.
    expect(linhas[0].nome).toBe("Clássico 250 g");
  });

  it("sem product_id, agrupa por nome — e não junta produtos diferentes", () => {
    const linhas = agregarPorProduto([
      pedido({ items: [{ name: "Clássico", price: 60, quantity: 1 }] }),
      pedido({ items: [{ name: "Micro-lote", price: 90, quantity: 1 }] }),
    ]);
    expect(linhas).toHaveLength(2);
  });

  /**
   * Dois cafés no mesmo pedido são um pedido para cada café; o mesmo café em
   * duas linhas do mesmo pedido é UM pedido. Sem isso, "em quantos pedidos este
   * café apareceu" viraria "quantas linhas de item existem".
   */
  it("o mesmo produto em duas linhas do MESMO pedido conta um pedido só", () => {
    const linhas = agregarPorProduto([
      pedido({
        order_id: "unico",
        items: [
          { product_id: 1, name: "Clássico", price: 60, quantity: 1 },
          { product_id: 1, name: "Clássico", price: 60, quantity: 2 },
        ],
      }),
    ]);
    expect(linhas[0].pedidos).toBe(1);
    expect(linhas[0].unidades).toBe(3);
  });

  it("item sem nome ganha um rótulo, e não uma linha em branco", () => {
    const linhas = agregarPorProduto([
      pedido({ items: [{ price: 10, quantity: 1 }] }),
    ]);
    expect(linhas[0].nome).toBe("Produto sem nome");
  });

  it("pedido sem itens não derruba a agregação", () => {
    expect(agregarPorProduto([pedido({ items: null }), pedido({ items: [] })])).toEqual([]);
  });

  it("lista vazia devolve lista vazia", () => {
    expect(agregarPorProduto([])).toEqual([]);
  });
});

/* ========================================================================== *
 * Vendas por cupom
 * ========================================================================== */

describe("agregarPorCupom", () => {
  it("agrupa por código e soma desconto e receita", () => {
    const linhas = agregarPorCupom([
      pedido({ coupon_code: "VERAO10", discount: "12.00", total_amount: "108.00" }),
      pedido({ coupon_code: "VERAO10", discount: "6.00", total_amount: "54.00" }),
    ]);
    expect(linhas).toHaveLength(1);
    expect(linhas[0].pedidos).toBe(2);
    expect(linhas[0].descontoCentavos).toBe(1800);
    expect(linhas[0].receitaCentavos).toBe(16_200);
  });

  /** "VERAO10" e "verao10" são o mesmo cupom; duas linhas dividiriam o
   *  resultado da mesma campanha ao meio. */
  it("o código é comparado em maiúscula", () => {
    expect(
      agregarPorCupom([
        pedido({ coupon_code: "VERAO10" }),
        pedido({ coupon_code: "verao10" }),
      ]),
    ).toHaveLength(1);
  });

  /**
   * Sem a linha "Sem cupom" a soma da coluna não bate com o faturamento do
   * período — e a primeira reação a um relatório que não fecha é desconfiar do
   * relatório inteiro.
   */
  it("os pedidos sem cupom entram numa linha própria, para a tabela FECHAR", () => {
    const linhas = agregarPorCupom([
      pedido({ coupon_code: null, total_amount: "100.00" }),
      pedido({ coupon_code: "  ", total_amount: "50.00" }),
      pedido({ coupon_code: "VERAO10", total_amount: "90.00" }),
    ]);
    const semCupom = linhas.find((l) => l.codigo === SEM_CUPOM)!;
    expect(semCupom.pedidos).toBe(2);
    expect(semCupom.receitaCentavos).toBe(15_000);

    const somaDaColuna = linhas.reduce((a, l) => a + l.receitaCentavos, 0);
    expect(somaDaColuna).toBe(24_000);
  });
});

/* ========================================================================== *
 * Vendas por dia — R31
 * ========================================================================== */

describe("serieDiaria", () => {
  /**
   * O DEFEITO QUE DESTRÓI A CONFIANÇA EM TODO RELATÓRIO: um pedido das 22h de
   * 26/08 é `2026-08-27T01:00Z`. Agrupado por UTC, ele cai no dia seguinte — e
   * no fechamento do mês a venda da última noite aparece no mês que vem.
   */
  it("agrupa pelo dia de SÃO PAULO, e não pelo de UTC", () => {
    const linhas = serieDiaria(
      [pedido({ created_at: "2026-08-27T01:00:00.000Z", total_amount: "100.00" })],
      "2026-08-26",
      "2026-08-27",
    );
    expect(linhas.find((l) => l.dia === "2026-08-26")!.pedidos).toBe(1);
    expect(linhas.find((l) => l.dia === "2026-08-27")!.pedidos).toBe(0);
  });

  /**
   * Uma linha desenhada só com os dias que tiveram venda liga 20/08 a 24/08 com
   * um traço reto e esconde que 21, 22 e 23 foram zero. A queda some do desenho.
   */
  it("os dias sem venda entram com zero — senão a queda some do gráfico", () => {
    const linhas = serieDiaria([], "2026-08-01", "2026-08-05");
    expect(linhas).toHaveLength(5);
    expect(linhas.every((l) => l.pedidos === 0 && l.receitaCentavos === 0)).toBe(true);
  });

  it("os dias saem em ordem crescente e cobrem a janela inteira", () => {
    const linhas = serieDiaria([], "2026-08-01", "2026-08-03");
    expect(linhas.map((l) => l.dia)).toEqual(["2026-08-01", "2026-08-02", "2026-08-03"]);
  });

  it("cada dia traz o rótulo em dd/mm/aaaa junto da chave ISO", () => {
    const [primeiro] = serieDiaria([], "2026-08-01", "2026-08-01");
    expect(primeiro.dia).toBe("2026-08-01");
    expect(primeiro.diaBr).toBe("01/08/2026");
  });

  it("soma vários pedidos do mesmo dia", () => {
    const linhas = serieDiaria(
      [
        pedido({ created_at: "2026-08-10T13:00:00.000Z", total_amount: "100.00" }),
        pedido({ created_at: "2026-08-10T20:00:00.000Z", total_amount: "50.00" }),
      ],
      "2026-08-10",
      "2026-08-10",
    );
    expect(linhas[0].pedidos).toBe(2);
    expect(linhas[0].receitaCentavos).toBe(15_000);
  });

  /** Uma janela absurda por URL adulterada não pode virar um laço de um milhão
   *  de iterações no servidor. */
  it("uma janela absurda é truncada em vez de travar o servidor", () => {
    expect(serieDiaria([], "2000-01-01", "2030-01-01").length).toBeLessThanOrEqual(400);
  });

  it("data ilegível no pedido é ignorada, e não vira um dia inventado", () => {
    const linhas = serieDiaria(
      [pedido({ created_at: "não é data" })],
      "2026-08-01",
      "2026-08-02",
    );
    expect(linhas.every((l) => l.pedidos === 0)).toBe(true);
  });
});

/* ========================================================================== *
 * Pedidos por status
 * ========================================================================== */

describe("agregarPorStatus", () => {
  it("agrupa e traduz o status para o rótulo em português", () => {
    const linhas = agregarPorStatus([
      pedido({ status: "em_processamento" }),
      pedido({ status: "em_processamento" }),
      pedido({ status: "entregue" }),
    ]);
    expect(linhas).toHaveLength(2);
    const emProcessamento = linhas.find((l) => l.status === "em_processamento")!;
    expect(emProcessamento.rotulo).toBe("Em processamento");
    expect(emProcessamento.pedidos).toBe(2);
  });

  /** A pergunta dele é "onde a fila está parada", não "quanto entrou" — este é
   *  o único relatório da tela que quer ver cancelado e pendente. */
  it("não aplica o recorte de venda: cancelado e pendente aparecem", () => {
    const linhas = agregarPorStatus([
      pedido({ status: "cancelado" }),
      pedido({ status: "pendente" }),
    ]);
    expect(linhas.map((l) => l.status).sort()).toEqual(["cancelado", "pendente"]);
  });

  it("status desconhecido aparece com o próprio valor, e não some", () => {
    const [linha] = agregarPorStatus([pedido({ status: "inventado" })]);
    expect(linha.rotulo).toBe("inventado");
  });
});

/* ========================================================================== *
 * A ordenação
 * ========================================================================== */

describe("ordenar", () => {
  const linhas = [
    { chave: "c", nome: "Café", unidades: 2, receitaCentavos: 300 },
    { chave: "a", nome: "Ácido", unidades: 5, receitaCentavos: 100 },
    { chave: "b", nome: "Zurique", unidades: 2, receitaCentavos: 200 },
  ];

  it("ordena número nos dois sentidos", () => {
    expect(ordenar(linhas, "unidades", "desc").map((l) => l.chave)).toEqual([
      "a",
      "b",
      "c",
    ]);
    expect(ordenar(linhas, "unidades", "asc").map((l) => l.chave)).toEqual([
      "b",
      "c",
      "a",
    ]);
  });

  it("«receita» lê receitaCentavos — o nome da coluna não é o do campo", () => {
    expect(ordenar(linhas, "receita", "desc").map((l) => l.chave)).toEqual([
      "c",
      "b",
      "a",
    ]);
  });

  /** "Ácido" tem de vir junto de "Acidez", e não depois de "Zurique". */
  it("texto compara em pt-BR: o acento não vai para o fim do alfabeto", () => {
    expect(ordenar(linhas, "nome", "asc").map((l) => l.nome)).toEqual([
      "Ácido",
      "Café",
      "Zurique",
    ]);
  });

  /**
   * Empate é comum num relatório (três produtos com 2 unidades cada), e uma
   * ordem que muda a cada renderização faz o gestor achar que os dados mudaram.
   */
  it("é ESTÁVEL: o empate desempata pela chave, e não pela sorte", () => {
    const empatados = [
      { chave: "z", unidades: 1 },
      { chave: "a", unidades: 1 },
      { chave: "m", unidades: 1 },
    ];
    expect(ordenar(empatados, "unidades", "desc").map((l) => l.chave)).toEqual([
      "a",
      "m",
      "z",
    ]);
  });

  it("inverter a direção não embaralha os empatados", () => {
    const empatados = [
      { chave: "z", unidades: 1 },
      { chave: "a", unidades: 1 },
    ];
    expect(ordenar(empatados, "unidades", "asc").map((l) => l.chave)).toEqual(["a", "z"]);
    expect(ordenar(empatados, "unidades", "desc").map((l) => l.chave)).toEqual(["a", "z"]);
  });

  it("não muta a lista recebida", () => {
    const original = [...linhas];
    ordenar(linhas, "unidades", "asc");
    expect(linhas).toEqual(original);
  });

  /** Ordenar `dd/mm` como texto poria 01/09 antes de 02/08. */
  it("«dia» ordena pela chave ISO, e não pelo rótulo brasileiro", () => {
    const dias = [
      { chave: "2026-09-01", dia: "2026-09-01", diaBr: "01/09/2026" },
      { chave: "2026-08-02", dia: "2026-08-02", diaBr: "02/08/2026" },
    ];
    expect(ordenar(dias, "dia", "asc").map((l) => l.dia)).toEqual([
      "2026-08-02",
      "2026-09-01",
    ]);
  });

  it("coluna desconhecida não derruba a tabela", () => {
    expect(ordenar(linhas, "inventada", "asc")).toHaveLength(3);
  });
});

describe("colunasDe", () => {
  it("todo relatório tem colunas ordenáveis declaradas", () => {
    for (const r of RELATORIOS) {
      expect(colunasDe(r.valor).length).toBeGreaterThan(1);
    }
  });
});

/* ========================================================================== *
 * O que a tela precisa DIZER — R28 e R29
 * ========================================================================== */

describe("as fórmulas e o modelo de atribuição — R29", () => {
  /**
   * A fórmula existe porque o número VAI divergir do extrato do Mercado Pago,
   * por desenho. Sem o rótulo, a conclusão é "o sistema está quebrado".
   */
  it("a fórmula da receita avisa que o frete entra e a taxa do MP não sai", () => {
    expect(FORMULAS.receita).toMatch(/frete/i);
    expect(FORMULAS.receita).toMatch(/Mercado Pago/);
  });

  it("a fórmula do desconto avisa que promoção de vitrine não entra nela", () => {
    expect(FORMULAS.desconto).toMatch(/cupom/i);
    expect(FORMULAS.desconto).toMatch(/vitrine/i);
  });

  it("toda fórmula é uma frase de verdade, e não um rótulo", () => {
    for (const [chave, texto] of Object.entries(FORMULAS)) {
      expect(texto.length, chave).toBeGreaterThan(40);
    }
  });

  it("o modelo de atribuição nomeia o fuso e os status que contam", () => {
    expect(MODELO_DE_ATRIBUICAO).toMatch(/S(ã|a)o.?Paulo/);
    for (const status of STATUS_DE_VENDA) {
      expect(MODELO_DE_ATRIBUICAO).toContain(status);
    }
  });
});

describe("as divergências escritas na tela — R28", () => {
  it("o PIX não pago do GA4 está declarado, com o motivo", () => {
    const ga4 = DIVERGENCIAS.find((d) => d.titulo.includes("GA4"))!;
    expect(ga4.texto).toMatch(/PIX/);
    expect(ga4.texto).toMatch(/analytics/);
  });

  it("a ausência de captura de UTM está declarada — «sem dados» em vez de gráfico vazio", () => {
    const utm = DIVERGENCIAS.find((d) => d.titulo.includes("origem"))!;
    expect(utm.texto).toMatch(/0033/);
    expect(utm.texto).toMatch(/Onda 6/);
  });

  it("a atribuição só por campanha está declarada", () => {
    expect(DIVERGENCIAS.some((d) => d.texto.includes("utm_campaign"))).toBe(true);
    expect(DIVERGENCIAS.some((d) => d.texto.includes("utm_source"))).toBe(true);
  });

  it("toda divergência tem título e texto que explicam, não só nomeiam", () => {
    for (const d of DIVERGENCIAS) {
      expect(d.titulo.length).toBeGreaterThan(15);
      expect(d.texto.length).toBeGreaterThan(80);
    }
  });
});

describe("os relatórios que não dá para fazer", () => {
  /**
   * O relatório de margem é o que MAIS precisa da explicação: com custo zero em
   * todo pedido ele informaria 100% de margem, que é a mentira mais cara que
   * esta tela poderia contar.
   */
  it("a margem está listada, e a causa é o custo que o checkout não grava", () => {
    const margem = RELATORIOS_IMPOSSIVEIS.find((r) => r.titulo.includes("margem"))!;
    expect(margem.falta).toMatch(/0034/);
    expect(margem.falta).toMatch(/custo_centavos/);
    expect(margem.falta).toMatch(/checkout/i);
  });

  it("categoria, assinaturas e novos-contra-recorrentes também estão listados", () => {
    const titulos = RELATORIOS_IMPOSSIVEIS.map((r) => r.titulo).join(" | ");
    expect(titulos).toMatch(/categoria/i);
    expect(titulos).toMatch(/Assinaturas/i);
    expect(titulos).toMatch(/recorrentes/i);
  });

  /** É a lista que a próxima onda usa como tarefa: "não dá" sem o porquê é um
   *  chamado; com o porquê é uma informação. */
  it("cada um diz o que exatamente falta, e não só que falta", () => {
    for (const r of RELATORIOS_IMPOSSIVEIS) {
      expect(r.falta.length).toBeGreaterThan(100);
    }
  });
});
