import { describe, it, expect, vi, beforeEach } from "vitest";

import { html } from "@/lib/teste/html";
import { LEGADO } from "@/components/painel/casca/menu.logica";
import { diaEmSaoPaulo } from "@/lib/painel/data";

/**
 * A HOME do painel, renderizada de verdade.
 *
 * POR QUE ESTE TESTE EXISTE, se a regra do repositório é que a decisão mora num
 * módulo puro e a casca só desenha: esta tela monta seis componentes de cliente
 * recebendo elementos como props, e agrega SETE leituras de API que podem
 * falhar independentemente. Nada disso é pego pelo `next build` — `/dashboard` é
 * rota dinâmica, então ela nunca é renderizada durante a compilação, e um erro
 * de montagem aqui só apareceria na cara do gestor.
 *
 * E há uma coisa que só se prova aqui: **a ORDEM da tela**. O §4.1 é uma
 * decisão de ordem — fila primeiro, números depois —, e ordem não existe em
 * função pura nenhuma.
 *
 * `await` na função e `html()` no resultado: um Server Component assíncrono é
 * uma função que devolve uma Promise de elemento. Fora do bundler RSC, o
 * `"use client"` dos filhos é só uma string no topo do arquivo, e eles
 * renderizam como componentes React normais.
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

/**
 * O recharts é dublado. Ele mede o contêiner com `ResizeObserver`, que o jsdom
 * não implementa — e o que interessa deste lado é a tela MONTAR e passar a
 * série certa, não o SVG que a biblioteca desenha. O dublê imprime a série em
 * texto para o teste poder conferi-la.
 */
vi.mock("./GraficoDeReceita", () => ({
  GraficoDeReceita: ({ serie }: { serie: { dia: string; valor: number }[] }) => (
    <div data-grafico={serie.map((p) => `${p.dia}=${p.valor}`).join("|")} />
  ),
}));

const lerDaApi = vi.fn();
vi.mock("@/lib/painel/api-servidor", () => ({
  lerDaApi: (...args: unknown[]) => lerDaApi(...args),
}));

const { default: PaginaInicialDoPainel } = await import("./page");

const RESUMO = {
  counts: { products: 24, orders: 310, users: 187 },
  salesChart: [
    { day: "18/08", total: "120.50" },
    { day: "19/08", total: "80.00" },
  ],
  statusChart: [
    { status: "aprovado", count: "12" },
    { status: "pendente", count: "3" },
    { status: "rejeitado", count: "2" },
  ],
};

/**
 * Uma resposta por rota. A home faz sete chamadas, e o dublê responde pelo
 * CAMINHO — não pela ordem: `Promise.all` não garante ordem de invocação, e um
 * mock por índice viraria um teste que falha sozinho um dia.
 */
function respondendo(sobrepor: Record<string, unknown> = {}) {
  lerDaApi.mockImplementation(async (caminho: string) => {
    for (const [prefixo, resposta] of Object.entries(sobrepor)) {
      if (caminho.startsWith(prefixo)) return resposta;
    }
    if (caminho.startsWith("/dashboard/summary")) return { ok: true, dados: RESUMO };
    if (caminho.startsWith("/admin/avaliacoes")) return { ok: true, dados: { total: 4 } };
    if (caminho.startsWith("/dashboard?")) {
      return {
        ok: true,
        dados: {
          products: [{ quantity: 0 }, { quantity: 2 }, { quantity: 90 }],
          totalPages: 1,
        },
      };
    }
    if (caminho.startsWith("/admin/orders")) {
      /*
        A JANELA ATUAL TERMINA HOJE; a anterior, não. Responder o mesmo total
        para as quatro chamadas faria toda comparação sair "igual", e o caminho
        de "subiu/desceu" — que é o que a tela desenha na prática — nunca seria
        exercido.
      */
      const atual = caminho.includes(`ate=${diaEmSaoPaulo()}`);
      return { ok: true, dados: { total: atual ? 12 : 10 } };
    }
    throw new Error(`rota não prevista no teste: ${caminho}`);
  });
}

async function saida(): Promise<string> {
  return html(await PaginaInicialDoPainel());
}

beforeEach(() => {
  lerDaApi.mockReset();
  respondendo();
});

describe("a home do painel", () => {
  it("monta sem estourar, e o título da página é Início", async () => {
    const s = await saida();
    expect(s).toContain("<h1");
    expect(s).toContain("Início");
  });

  it("diz em nome de quem se está trabalhando", async () => {
    expect(await saida()).toContain("gestao@cafecanastra.com");
  });

  it("a tela não abre um segundo <main> — o do layout já a envolve", async () => {
    expect(await saida()).not.toContain("<main");
  });

  /**
   * Enquanto a maior parte das telas não existir, sem este link o gestor abre
   * `/dashboard` e não tem como fazer o trabalho do dia.
   */
  it("aponta para o painel antigo, que é onde a maior parte do trabalho é feita", async () => {
    expect(await saida()).toContain(`href="${LEGADO.href}"`);
  });
});

/**
 * A DECISÃO CENTRAL DO §4.1, e a única que não cabe em função pura: **a fila
 * vem antes dos números**. "O lojista não abre o painel para admirar receita,
 * abre para saber o que embalar."
 */
describe("a ordem da tela — fila de trabalho antes de vitrine de receita", () => {
  it("a fila aparece ANTES dos indicadores e do gráfico", async () => {
    const s = await saida();
    const fila = s.indexOf("O que precisa ser feito hoje");
    const indicadores = s.indexOf("Indicadores");
    const grafico = s.indexOf("Receita por dia");

    expect(fila).toBeGreaterThan(-1);
    expect(indicadores).toBeGreaterThan(fila);
    expect(grafico).toBeGreaterThan(indicadores);
  });

  it("as cinco linhas da fila estão lá, com a contagem de cada uma", async () => {
    const s = await saida();
    for (const rotulo of [
      "Pedidos a despachar",
      "Pagamento pendente",
      "Pagamento recusado",
      "Avaliação a moderar",
      "Estoque baixo",
    ]) {
      expect(s).toContain(rotulo);
    }
    // 12 aprovados, 3 pendentes, 2 rejeitados, 4 avaliações, 2 com estoque ≤ 5.
    expect(s).toMatch(/>12</);
    expect(s).toMatch(/>4</);
  });

  /**
   * "CADA LINHA É UM LINK PARA UMA ABA SALVA DE VERDADE, não um número
   * decorativo" — §4.1, literal. O que faz a aba ser "de verdade" é o filtro
   * estar na URL.
   */
  it("cada linha leva a uma lista JÁ FILTRADA", async () => {
    const s = await saida();
    for (const href of [
      "/dashboard/pedidos?status=aprovado",
      "/dashboard/pedidos?status=pendente",
      "/dashboard/pedidos?status=rejeitado",
      "/dashboard/avaliacoes?status=pendente",
      "/dashboard/produtos?estoque=baixo",
    ]) {
      expect(s).toContain(`href="${href}"`);
    }
  });

  /**
   * R29 — um número que não se confere é um número em que não se confia. E a
   * linha de "Pagamento recusado" carrega a ressalva que a torna honesta:
   * cobrança do Clube que falha cai ali dentro, indistinguível de uma recusa de
   * compra avulsa.
   */
  it("toda linha diz o que conta, e a de recusa avisa o que está misturado", async () => {
    const s = await saida();
    expect(s).toContain("aprovados, ainda não marcados como enviados");
    expect(s).toContain("não distingue");
  });

  it("a linha de estoque avisa que o limite é fixo, porque não há mínimo no cadastro", async () => {
    expect(await saida()).toContain("não há estoque mínimo");
  });

  /**
   * A REGRA DA PESQUISA: "não prometer nenhum indicador de saúde da assinatura
   * antes de existir dunning". Não há dunning nesta loja, então a home não
   * inventa a linha — ela conta o pedido `rejeitado`, que é onde a falha de
   * fato aterrissa, e se chama pelo que conta.
   */
  it("não existe linha de 'assinatura com cobrança falhada'", async () => {
    expect(await saida()).not.toContain("Assinatura com cobrança falhada");
  });
});

describe("os indicadores", () => {
  it("mostram receita, contagens e as comparações de período", async () => {
    const s = await saida();
    expect(s).toContain("Receita");
    expect(s).toContain("200,50");
    expect(s).toContain("187"); // clientes
    expect(s).toContain("os 7 dias anteriores");
    expect(s).toContain("os 30 dias anteriores");
  });

  /**
   * A comparação de período é REAL: duas chamadas a
   * `GET /admin/orders?de=&ate=&limit=1`, e o backend conta no banco com o
   * recorte do dia de São Paulo. `limit=1` porque só o `total` interessa — sem
   * ele viriam dez pedidos completos, com CPF e endereço dentro, para serem
   * descartados.
   */
  it("as janelas são pedidas ao backend, com limite 1", async () => {
    await saida();
    const deOrders = lerDaApi.mock.calls
      .map(([caminho]) => caminho as string)
      .filter((c) => c.startsWith("/admin/orders"));

    expect(deOrders.length).toBe(4);
    for (const caminho of deOrders) {
      expect(caminho).toContain("limit=1");
      expect(caminho).toMatch(/de=\d{4}-\d{2}-\d{2}/);
      expect(caminho).toMatch(/ate=\d{4}-\d{2}-\d{2}/);
    }
    // As quatro janelas são distintas: duas atuais e duas anteriores.
    expect(new Set(deOrders).size).toBe(4);
  });

  /**
   * A DIREÇÃO NÃO É COR. R21 reserva o vermelho a erro e ação destrutiva, e um
   * KPI que caiu 3% não é um erro; e "subir" nem sempre é bom — cancelamentos
   * subindo em verde seria a tela mentindo com cor. A direção viaja no glifo e
   * na palavra, que é o que a WCAG 1.4.1 exige.
   */
  it("a variação não usa cor para dizer se subiu ou desceu", async () => {
    const s = await saida();
    expect(s).toContain("acima de");
    expect(s).toContain("20%");
    expect(s).not.toContain("text-vermelho");
    expect(s).not.toContain("text-sucesso");
  });
});

describe("o gráfico — R30", () => {
  it("é de linha, e recebe a série do resumo", async () => {
    expect(await saida()).toContain('data-grafico="18/08=120.5|19/08=80"');
  });

  /**
   * O `PieChart` de `HomeDashboard.jsx` NÃO SOBREVIVE: R30 proíbe pizza, donut,
   * gauge, treemap e 3D, porque ângulo e área não são canais visuais precisos.
   */
  it("não sobrou nenhum gráfico de pizza", async () => {
    const s = (await saida()).toLowerCase();
    for (const proibido of ["piechart", "donut", "gauge", "treemap"]) {
      expect(s).not.toContain(proibido);
    }
  });

  /**
   * R29 de novo, e aqui ele vale mais do que em qualquer outro lugar da tela: o
   * gráfico e o KPI de "Pedidos · 7 dias" NÃO medem a mesma janela. O gráfico
   * conta 168 horas corridas no fuso do servidor da API; o KPI conta sete dias
   * de calendário de São Paulo. Sem isso escrito, o painel produz duas verdades
   * incompatíveis na mesma tela.
   */
  it("diz que o corte do dia vem do servidor, e não do fuso de São Paulo", async () => {
    const s = await saida();
    expect(s).toContain("168 horas");
    expect(s).toContain("não do fuso de São Paulo");
  });
});

/**
 * A DOUTRINA, virada em teste: zero é um número perfeitamente plausível, e
 * mostrá-lo sem ter perguntado é o painel afirmando com confiança algo que ele
 * não sabe.
 */
describe("leitura que falha nunca vira zero", () => {
  it("resumo fora do ar dá travessão nas linhas dele, e NUNCA zero", async () => {
    respondendo({ "/dashboard/summary": { ok: false, erro: "A API não respondeu." } });
    const s = await saida();

    // As três linhas que vêm do resumo perdem a contagem…
    expect(s).toContain("não foi possível consultar");
    // …e nenhuma delas virou um "0" desenhado na coluna do número.
    expect(s).not.toMatch(/data-dado="true">0</);
    // A tarja diz quantas faltaram.
    expect(s).toContain("linhas da fila não puderam ser consultadas");
  });

  it("a linha sem contagem deixa de ser link — não se abre o que não se contou", async () => {
    respondendo({ "/dashboard/summary": { ok: false, erro: "fora do ar" } });
    const s = await saida();
    expect(s).not.toContain('href="/dashboard/pedidos?status=aprovado"');
    // …enquanto a que respondeu continua clicável.
    expect(s).toContain('href="/dashboard/avaliacoes?status=pendente"');
  });

  it("com tudo respondendo, a tarja de leitura incompleta não aparece", async () => {
    const s = await saida();
    expect(s).not.toContain("não puderam ser consultadas");
    expect(s).not.toContain("não pôde ser consultada");
  });

  it("uma rota fora do ar não derruba as outras seis", async () => {
    respondendo({ "/admin/avaliacoes": { ok: false, erro: "fora do ar" } });
    const s = await saida();
    expect(s).toContain("Pedidos a despachar");
    expect(s).toMatch(/>12</);
    expect(s).toContain("linha da fila não pôde ser consultada");
  });

  /**
   * O GRÁFICO USA `<EstadoDaTela>` INTEIRO — fonte única, três desfechos
   * distintos e todos plausíveis. "Sete dias sem venda" e "não consegui
   * perguntar" precisam ler diferente.
   */
  it("resumo fora do ar mostra ERRO no gráfico, não 'nenhuma venda'", async () => {
    respondendo({ "/dashboard/summary": { ok: false, erro: "A API não respondeu." } });
    const s = await saida();
    expect(s).toContain('role="alert"');
    expect(s).not.toContain("Nenhuma venda nos últimos 7 dias");
  });

  it("sete dias sem venda de verdade dizem isso, sem alarme", async () => {
    respondendo({
      "/dashboard/summary": { ok: true, dados: { ...RESUMO, salesChart: [] } },
    });
    const s = await saida();
    expect(s).toContain("Nenhuma venda nos últimos 7 dias");
    expect(s).not.toContain('role="alert"');
  });

  it("catálogo maior que uma página avisa que a contagem é parcial", async () => {
    respondendo({
      "/dashboard?": {
        ok: true,
        dados: { products: [{ quantity: 1 }], totalPages: 3 },
      },
    });
    expect(await saida()).toContain("parcial");
  });
});
