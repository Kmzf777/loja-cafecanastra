import { describe, it, expect, vi, beforeEach } from "vitest";

import { html } from "@/lib/teste/html";
import type { RespostaDeAvaliacoes } from "@/lib/painel/avaliacoes/avaliacoes.logica";
import type { Leitura } from "@/lib/painel/api-servidor";

/**
 * A CASCA da tela de Avaliações — só o que a função pura não alcança.
 *
 * A decisão inteira (ler a URL, montar a consulta, prender a página, montar os
 * chips, escolher a frase do placar) vive em `avaliacoes.logica.ts` e tem 70
 * casos lá. O que sobra para cá é o que só existe quando o JSX é montado:
 *
 *   · a ORDEM DAS GUARDAS do <EstadoDaTela> — que a leitura falhada não seja
 *     desenhada como "nenhuma avaliação", que é o defeito mais caro do painel
 *     legado e o único que não aparece em teste de unidade nenhum;
 *   · que as DUAS consultas saiam (a da lista e a do contador de pendentes), e
 *     que o contador sobreviva ao filtro — é a razão de ele ter ida própria;
 *   · que o contador NÃO desenhe zero quando a ida dele falhou;
 *   · que a busca e as abas continuem na tela quando a tabela não está.
 *
 * `await` na função e `html()` no resultado: um Server Component assíncrono é
 * uma função que devolve uma Promise de elemento. Fora do bundler RSC o
 * `"use client"` dos filhos é só uma string no topo do arquivo, e eles
 * renderizam como componentes React normais — que é exatamente o que se quer
 * conferir aqui.
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

/** A ilha de busca chama `useRouter`, que fora de um roteador não existe. */
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: () => {}, replace: () => {} }),
}));

/** A Server Action não é chamada em nenhum destes casos (não há clique), mas o
 *  módulo é IMPORTADO pela ilha — e o de verdade puxa `next/cache`. */
vi.mock("./acoes", () => ({
  moderarAvaliacoes: async () => ({ ok: true, frase: "" }),
}));

const lerDaApi = vi.fn();
vi.mock("@/lib/painel/api-servidor", () => ({
  lerDaApi: (...args: unknown[]) => lerDaApi(...args),
}));

const { default: PaginaDeAvaliacoes } = await import("./page");

function avaliacao(n: number, extras: Record<string, unknown> = {}) {
  return {
    id: `aaaaaaa${n}-1111-1111-1111-111111111111`,
    sku: `CLA-25${n}`,
    nota: 5,
    titulo: `Título ${n}`,
    texto: `Texto da avaliação ${n}`,
    nome_exibicao: `Cliente ${n}`,
    status: "pendente",
    user_id: `bbbbbbb${n}-1111-1111-1111-111111111111`,
    criado_em: "2026-08-20T13:00:00.000Z",
    moderado_em: null,
    ...extras,
  };
}

function respostaCom(
  data: ReturnType<typeof avaliacao>[],
  extras: Partial<RespostaDeAvaliacoes> = {},
): Leitura<RespostaDeAvaliacoes> {
  return {
    ok: true,
    dados: { data, total: data.length, totalPages: 1, page: 1, ...extras },
  };
}

/** O contador de pendentes — a SEGUNDA ida. `data: []` porque `limit=1` e só
 *  `total` é lido. */
function contagem(total: number): Leitura<RespostaDeAvaliacoes> {
  return { ok: true, dados: { data: [], total, totalPages: 1, page: 1 } };
}

/**
 * A tela dispara as duas leituras num `Promise.all`, então o dublê responde
 * PELA CONSULTA e não pela ordem de chamada — depender da ordem de resolução de
 * um `Promise.all` é escrever um teste que passa por acaso.
 */
function responder(lista: Leitura<RespostaDeAvaliacoes>, pendentes = contagem(0)) {
  lerDaApi.mockImplementation((caminho: string) =>
    caminho.includes("limit=1") ? pendentes : lista,
  );
}

async function saida(
  parametros: Record<string, string | string[] | undefined> = {},
): Promise<string> {
  return html(await PaginaDeAvaliacoes({ searchParams: Promise.resolve(parametros) }));
}

beforeEach(() => {
  lerDaApi.mockReset();
});

/* ========================================================================== */

describe("as duas leituras", () => {
  it("pede a lista com o filtro da URL e a contagem SEM ele", async () => {
    responder(respostaCom([avaliacao(1)]));
    await saida({ status: "aprovada", q: "ana", pagina: "2" });

    const caminhos = lerDaApi.mock.calls.map((c) => c[0] as string);
    expect(caminhos).toHaveLength(2);

    const daLista = caminhos.find((c) => !c.includes("limit=1"))!;
    expect(daLista).toContain("status=aprovada");
    expect(daLista).toContain("q=ana");
    expect(daLista).toContain("page=2");

    /**
     * A ida do contador NÃO carrega o filtro da tela — é a razão inteira de ela
     * existir. Com o filtro junto, "pendentes" com a fila em "Aprovadas" daria
     * zero, e "0 pendentes" é a frase que faz o gestor fechar o painel achando
     * que acabou.
     */
    const doContador = caminhos.find((c) => c.includes("limit=1"))!;
    expect(doContador).toBe("/admin/avaliacoes?status=pendente&limit=1");
  });
});

describe("o contador de pendentes", () => {
  it("aparece na aba Pendente mesmo com o filtro em Aprovadas", async () => {
    responder(respostaCom([avaliacao(1, { status: "aprovada" })]), contagem(7));
    const saidaHtml = await saida({ status: "aprovada" });
    expect(saidaHtml).toContain("Pendente");
    expect(saidaHtml).toMatch(/data-dado[^>]*>7</);
  });

  /**
   * Zero é um número plausível, e por isso ele nunca pode ser o valor de "não
   * consegui perguntar": um "0" desenhado por causa de rede caída diz "a fila
   * acabou" com toda a confiança.
   */
  it("some quando a ida do contador falhou — nunca desenha zero por falha", async () => {
    lerDaApi.mockImplementation((caminho: string) =>
      caminho.includes("limit=1")
        ? { ok: false, erro: "A API não respondeu." }
        : respostaCom([avaliacao(1)]),
    );
    const saidaHtml = await saida();
    // A tabela veio; o que não veio é o número ao lado da aba.
    expect(saidaHtml).toContain("Cliente 1");
    expect(saidaHtml).not.toMatch(/data-dado[^>]*>0</);
  });

  it("desenha o zero quando ele foi MEDIDO — a fila vazia é informação", async () => {
    responder(respostaCom([avaliacao(1, { status: "aprovada" })]), contagem(0));
    expect(await saida()).toMatch(/data-dado[^>]*>0</);
  });
});

describe("a ordem das guardas do EstadoDaTela", () => {
  /**
   * O DEFEITO MAIS CARO DO PAINEL LEGADO, e o que este teste guarda: leitura
   * falhada desenhada como lista vazia. O gestor lê "nenhuma avaliação", conclui
   * que ninguém avaliou, e a API está fora do ar.
   */
  it("erro de leitura vira a frase do servidor, NUNCA 'nenhuma avaliação'", async () => {
    responder({ ok: false, erro: 'Status inválido: "recusada". Use um de: pendente, aprovada, oculta.' });
    const saidaHtml = await saida({ status: "recusada" });

    expect(saidaHtml).toContain("Status inválido");
    expect(saidaHtml).toContain("pendente, aprovada, oculta");
    expect(saidaHtml).not.toContain("Nenhuma avaliação ainda");
  });

  it("lista vazia SEM filtro é o vazio de primeira vez", async () => {
    responder(respostaCom([]));
    const saidaHtml = await saida();
    expect(saidaHtml).toContain("Nenhuma avaliação ainda");
    expect(saidaHtml).not.toContain("Nenhum resultado para este filtro");
  });

  it("lista vazia COM filtro é o vazio de filtro — diagnósticos opostos", async () => {
    responder(respostaCom([]));
    const saidaHtml = await saida({ q: "inexistente" });
    expect(saidaHtml).toContain("Nenhum resultado para este filtro");
    expect(saidaHtml).not.toContain("Nenhuma avaliação ainda");
  });

  /**
   * R1: a busca é sempre visível, e "sempre" inclui o estado de erro — é
   * justamente ali que o gestor precisa do controle para tentar outra coisa. É
   * por isso que ela mora FORA da <Ficha>.
   */
  it("a busca e as abas continuam na tela quando a tabela não está", async () => {
    responder({ ok: false, erro: "A API não respondeu." });
    const saidaHtml = await saida();
    expect(saidaHtml).toContain("Buscar avaliação");
    expect(saidaHtml).toContain("Filtrar por status");
  });
});

describe("o que a tela desenha da avaliação", () => {
  it("mostra o texto INTEIRO, sem reticências", async () => {
    const longo = "Chegou amassado. ".repeat(40).trim();
    responder(respostaCom([avaliacao(1, { texto: longo })]));
    const saidaHtml = await saida();
    expect(saidaHtml).toContain(longo);
    expect(saidaHtml).not.toContain("…");
  });

  it("preserva as quebras de linha com pre-wrap — moderar exige ler tudo", async () => {
    responder(respostaCom([avaliacao(1)]));
    expect(await saida()).toContain("whitespace-pre-wrap");
  });

  it("a data sai em dd/mm/aaaa no fuso de São Paulo (R31)", async () => {
    responder(respostaCom([avaliacao(1, { criado_em: "2026-08-20T02:00:00.000Z" })]));
    // 02:00 UTC do dia 20 é 23:00 do dia 19 em São Paulo.
    expect(await saida()).toContain("19/08/2026");
  });

  it("a nota é 'n/5' e não uma fileira de estrelas", async () => {
    responder(respostaCom([avaliacao(1, { nota: 4 })]));
    const saidaHtml = await saida();
    expect(saidaHtml).toContain("4/5");
    expect(saidaHtml).not.toContain("★");
  });
});

describe("o vocabulário da tela", () => {
  /**
   * `recusada` não existe no CHECK da 0014, e é o nome que todo mundo tenta
   * primeiro. A tela não pode oferecer o botão — mas TEM de dizer que ele não
   * existe, senão não achar é indistinguível de a tela estar quebrada.
   */
  it("oferece os três estados que existem, e nenhum 'Recusar'", async () => {
    responder(respostaCom([avaliacao(1)]));
    const saidaHtml = await saida();
    expect(saidaHtml).toContain("Aprovar");
    expect(saidaHtml).toContain("Ocultar");
    expect(saidaHtml).toContain("Voltar a pendente");
    expect(saidaHtml).not.toContain("Recusar");
  });

  it("diz por escrito que não existe 'recusada' e que a tela não apaga", async () => {
    responder(respostaCom([avaliacao(1)]));
    const saidaHtml = await saida();
    expect(saidaHtml).toContain("recusada");
    expect(saidaHtml).toContain("Esta tela não apaga avaliação");
  });

  /**
   * R25: a ação alcança só o que está marcado, e a tela diz isso em vez de
   * fingir que alcança o filtro inteiro — "senão o lojista acha que arquivou
   * 1.284 quando arquivou 50".
   */
  it("a barra de seleção nomeia o escopo: a página e o filtro", async () => {
    responder(respostaCom([avaliacao(1), avaliacao(2)], { total: 134, totalPages: 67 }));
    expect(await saida()).toContain("2 nesta página, 134 no filtro");
  });
});

describe("as abas de status", () => {
  it("trocar de aba zera a página e preserva a busca", async () => {
    responder(respostaCom([avaliacao(1)], { page: 3 }));
    const saidaHtml = await saida({ q: "ana", pagina: "3", status: "pendente" });
    expect(saidaHtml).toContain('href="/dashboard/avaliacoes?q=ana&amp;status=oculta"');
  });

  it("a aba ativa recebe aria-current, não só a cor", async () => {
    responder(respostaCom([avaliacao(1)]));
    expect(await saida({ status: "oculta" })).toContain('aria-current="page"');
  });
});

describe("o rodapé da lista", () => {
  it("usa o total e a página que o SERVIDOR devolveu, não os que a URL pediu", async () => {
    responder(
      respostaCom([avaliacao(1)], { total: 134, totalPages: 7, page: 2 }),
    );
    const saidaHtml = await saida({ pagina: "999" });
    expect(saidaHtml).toContain("134");
    // A régua desenha a página corrigida (2), nunca a 999 do favorito velho.
    expect(saidaHtml).not.toContain("999");
  });
});
