import { describe, it, expect, vi, beforeEach } from "vitest";

import { html } from "@/lib/teste/html";
import type { RespostaDePedidos } from "@/lib/painel/relatorios/relatorios.logica";

/**
 * A CASCA da tela de Relatórios.
 *
 * As agregações inteiras vivem em `relatorios.logica.ts`, com 77 casos. O que se
 * prova AQUI é a costura, e nesta tela ela tem três partes perigosas:
 *
 *   · a PAGINAÇÃO da leitura — a tela agrega no servidor lendo páginas de
 *     `/admin/orders`, e parar cedo demais produziria uma queda de vendas que
 *     não existe;
 *   · a ORDEM DAS GUARDAS — "nenhuma venda" por causa de uma API fora do ar
 *     seria lido como faturamento zerado;
 *   · e o que a spec manda ESCREVER na tela: as divergências e os relatórios que
 *     não dá para fazer. Sem eles a tela é um chamado esperando acontecer.
 */

vi.mock("@/lib/conta/painel-servidor", () => ({
  lerAcessoDoPainel: async () => ({
    temSessao: true,
    ehAdmin: true,
    falhouConsulta: false,
    email: "gestao@cafecanastra.com",
    userId: "11111111-1111-1111-1111-111111111111",
  }),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: () => {}, replace: () => {}, refresh: () => {} }),
}));

const lerDaApi = vi.fn();
vi.mock("@/lib/painel/api-servidor", () => ({
  lerDaApi: (...args: unknown[]) => lerDaApi(...args),
}));

const { default: PaginaDeRelatorios } = await import("./page");

let contador = 0;

function pedido(sobrescreve = {}) {
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

function paginaCom(
  linhas: ReturnType<typeof pedido>[],
  extra: Partial<RespostaDePedidos> = {},
) {
  return {
    ok: true as const,
    dados: {
      data: linhas,
      total: linhas.length,
      totalPages: 1,
      page: 1,
      ...extra,
    },
  };
}

async function montar(parametros: Record<string, string> = {}) {
  return html(
    await PaginaDeRelatorios({ searchParams: Promise.resolve(parametros) }),
  );
}

beforeEach(() => {
  contador = 0;
  lerDaApi.mockReset();
  lerDaApi.mockResolvedValue(paginaCom([pedido()]));
});

describe("a leitura", () => {
  it("pede só os status que contam como venda, e o período", async () => {
    await montar({ de: "2026-08-01", ate: "2026-08-26" });
    const [caminho] = lerDaApi.mock.calls[0];
    expect(caminho).toContain("/admin/orders");
    expect(caminho).toContain("de=2026-08-01");
    expect(caminho).toContain("ate=2026-08-26");
    expect(caminho).toContain("aprovado");
    expect(caminho).not.toContain("pendente");
  });

  it("uma página só: não insiste depois de `totalPages`", async () => {
    await montar();
    expect(lerDaApi).toHaveBeenCalledTimes(1);
  });

  /**
   * Parar cedo demais produziria uma queda de vendas que não existe. A leitura é
   * SEQUENCIAL de propósito — só a primeira resposta diz quantas páginas há.
   */
  it("segue paginando enquanto houver página", async () => {
    lerDaApi
      .mockResolvedValueOnce(paginaCom([pedido()], { totalPages: 3, total: 3, page: 1 }))
      .mockResolvedValueOnce(paginaCom([pedido()], { totalPages: 3, total: 3, page: 2 }))
      .mockResolvedValueOnce(paginaCom([pedido()], { totalPages: 3, total: 3, page: 3 }));

    await montar();
    expect(lerDaApi).toHaveBeenCalledTimes(3);
    expect(lerDaApi.mock.calls[2][0]).toContain("page=3");
  });

  /** O teto é dez páginas, e ele existe para a tela não virar cinquenta idas ao
   *  Postgres numa renderização. */
  it("não passa do teto de dez páginas", async () => {
    lerDaApi.mockResolvedValue(paginaCom([pedido()], { totalPages: 99, total: 9900 }));
    await montar();
    expect(lerDaApi).toHaveBeenCalledTimes(10);
  });

  /**
   * Um relatório montado com sete das dez páginas, SEM avisar, mostraria uma
   * queda de vendas que não existe.
   */
  it("uma página que falha vira erro na tela, e não um relatório pela metade", async () => {
    lerDaApi
      .mockResolvedValueOnce(paginaCom([pedido()], { totalPages: 3, total: 3 }))
      .mockResolvedValueOnce({ ok: false, erro: "A API não respondeu." });

    const saida = await montar();
    expect(saida).toContain("A API não respondeu");
    expect(saida).not.toContain("Nenhuma venda neste período");
  });
});

describe("a cobertura declarada", () => {
  /**
   * Um relatório que cobre em silêncio só os mil mais recentes é pior que
   * relatório nenhum, porque parece uma resposta.
   */
  it("quando o filtro passa do teto, a tela diz os dois números", async () => {
    lerDaApi.mockResolvedValue(
      paginaCom([pedido()], { totalPages: 99, total: 3482 }),
    );
    const saida = await montar();
    expect(saida).toContain("3482");
    expect(saida).toContain("encurte o período");
  });

  /** Um aviso que aparece sempre é um aviso que ninguém lê. */
  it("dentro do teto, nenhum aviso de cobertura aparece", async () => {
    expect(await montar()).not.toContain("encurte o período");
  });
});

describe("a ordem das guardas", () => {
  it("leitura falhada mostra o erro, e nunca «nenhuma venda»", async () => {
    lerDaApi.mockResolvedValue({ ok: false, erro: "Deu ruim." });
    const saida = await montar();
    expect(saida).toContain("Deu ruim");
    expect(saida).not.toContain("Nenhuma venda neste período");
  });

  /** Um mês sem venda é um fato, não um defeito — e a frase explica o recorte
   *  em vez de deixar a pessoa achar que faltou pedido. */
  it("zero pedidos com leitura boa explica o que conta como venda", async () => {
    lerDaApi.mockResolvedValue(paginaCom([]));
    const saida = await montar();
    expect(saida).toContain("Nenhuma venda neste período");
    expect(saida).toContain("pendente de pagamento não entra");
  });
});

describe("os quatro relatórios", () => {
  it("por produto é o padrão, e soma o valor dos itens", async () => {
    const saida = await montar();
    expect(saida).toContain("Clássico 250g");
    expect(saida).toContain("Unidades");
  });

  it("por cupom mostra a linha «Sem cupom», para a tabela FECHAR", async () => {
    const saida = await montar({ relatorio: "cupom" });
    expect(saida).toContain("Sem cupom");
  });

  it("por dia cobre a janela inteira, com os dias sem venda", async () => {
    const saida = await montar({
      relatorio: "dia",
      de: "2026-08-24",
      ate: "2026-08-26",
    });
    expect(saida).toContain("24/08/2026");
    expect(saida).toContain("25/08/2026");
    expect(saida).toContain("26/08/2026");
  });

  it("por status traduz o valor para o rótulo em português", async () => {
    lerDaApi.mockResolvedValue(
      paginaCom([pedido({ status: "em_processamento" })]),
    );
    expect(await montar({ relatorio: "status" })).toContain("Em processamento");
  });

  /** Esta coluna mistura entregue com cancelado: o total seria um número que não
   *  responde pergunta nenhuma. */
  it("por status NÃO mostra total no rodapé", async () => {
    expect(await montar({ relatorio: "status" })).not.toContain("Total no período");
  });

  it("os outros três mostram o total", async () => {
    for (const relatorio of ["produto", "cupom", "dia"]) {
      expect(await montar({ relatorio })).toContain("Total no período");
    }
  });
});

describe("a ordenação vive na URL — R2", () => {
  /** Clicar num cabeçalho é NAVEGAR: o link abre em nova aba, o "voltar"
   *  desfaz, e o F5 mantém. Um `<button>` com `router.push` perde as três. */
  it("os cabeçalhos são links de ordenação, e não botões", async () => {
    const saida = await montar();
    expect(saida).toContain("ordem=unidades");
    expect(saida).toContain("aria-sort");
  });

  it("a coluna ativa anuncia a direção, e as outras anunciam «none»", async () => {
    const saida = await montar({ ordem: "receita", direcao: "desc" });
    expect(saida).toContain('aria-sort="descending"');
    expect(saida).toContain('aria-sort="none"');
  });

  it("ordenar preserva o período", async () => {
    const saida = await montar({ de: "2026-08-01", ate: "2026-08-26" });
    expect(saida).toContain("de=2026-08-01");
  });
});

describe("o gráfico é opcional — R30", () => {
  it("ligado por padrão, com o link para ocultar", async () => {
    expect(await montar()).toContain("Ocultar gráfico");
  });

  /** Quem desliga um gráfico está tentando ler a tabela; vê-lo voltar a cada
   *  visita é hostil, e por isso o desligamento vive na URL. */
  it("desligado pela URL, e o link então oferece mostrar", async () => {
    const saida = await montar({ grafico: "nao" });
    expect(saida).toContain("Mostrar gráfico");
    expect(saida).not.toContain("Ocultar gráfico");
  });

  it("a tabela continua inteira com o gráfico desligado", async () => {
    expect(await montar({ grafico: "nao" })).toContain("Clássico 250g");
  });
});

describe("o que a spec manda escrever na tela", () => {
  /** R29: o modelo de atribuição AO LADO do número. */
  it("o modelo de atribuição nomeia o fuso e os status que contam", async () => {
    const saida = await montar();
    expect(saida).toContain("Como este número é feito");
    expect(saida).toContain("aprovado");
  });

  /** R29: a fórmula de cada métrica. Ela está no `title` do cabeçalho E por
   *  extenso na ficha — `title` só aparece para quem pousa o mouse. */
  it("a fórmula da receita avisa do frete e da taxa do Mercado Pago", async () => {
    const saida = await montar();
    expect(saida).toContain("Mercado Pago");
    expect(saida).toContain("A conta de cada coluna");
  });

  /**
   * A divergência mais importante: o `purchase` do GA4 dispara na resposta
   * síncrona do MP, inclusive para PIX não pago. Os dois números estão certos e
   * nunca vão bater — sem esta ficha, a conclusão é que um deles quebrou.
   */
  it("declara que o GA4 conta PIX não pago e este relatório não", async () => {
    const saida = await montar();
    expect(saida).toContain("PIX");
    expect(saida).toContain("Por que este número não bate com aquele");
  });

  /** R28: "sem dados antes de dd/mm" em vez de um gráfico vazio que parece
   *  queda de vendas. */
  it("declara que nenhum pedido tem origem gravada, e que a captura é da Onda 6", async () => {
    const saida = await montar();
    expect(saida).toContain("0033");
    expect(saida).toContain("Onda 6");
  });

  /**
   * O relatório de margem é o que mais precisa da explicação: com custo zero em
   * todo pedido ele informaria 100% de margem — a mentira mais cara que esta
   * tela poderia contar, e a que o gestor não teria como desconfiar.
   */
  it("explica por que não há relatório de margem, nomeando a causa", async () => {
    const saida = await montar();
    expect(saida).toContain("Relatórios que ainda não dá para fazer");
    expect(saida).toContain("custo_centavos");
    expect(saida).toContain("0034");
  });

  it("lista também categoria, assinaturas e novos contra recorrentes", async () => {
    const saida = await montar();
    expect(saida).toContain("Vendas por categoria");
    expect(saida).toContain("Assinaturas ativas");
    expect(saida).toContain("recorrentes");
  });
});
