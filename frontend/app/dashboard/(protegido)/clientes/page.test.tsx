import { describe, it, expect, vi, beforeEach } from "vitest";

import { html } from "@/lib/teste/html";
import type { RespostaDeClientes } from "@/lib/painel/clientes/clientes.logica";
import type { Leitura } from "@/lib/painel/api-servidor";

/**
 * A CASCA da tela de Clientes — só o que a função pura não alcança.
 *
 * A decisão inteira (normalizar o CPF, montar a consulta, prender a página,
 * montar os chips) vive em `clientes.logica.ts` e tem 49 casos lá. O que sobra
 * para cá é o que só existe quando o JSX é montado:
 *
 *   · a ORDEM DAS GUARDAS do <EstadoDaTela> — que a leitura falhada não seja
 *     desenhada como "nenhum cliente", que é o defeito mais caro do painel
 *     legado e o único que não aparece em teste de unidade nenhum;
 *   · que a CONSULTA que sai daqui seja a que o módulo puro montou (a tela pode
 *     estar certa e chamar a rota errada);
 *   · que a busca continue na tela quando a tabela não está.
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

const lerDaApi = vi.fn();
vi.mock("@/lib/painel/api-servidor", () => ({
  lerDaApi: (...args: unknown[]) => lerDaApi(...args),
}));

const { default: PaginaDeClientes } = await import("./page");

function cliente(n: number) {
  return {
    user_id: `1111111${n}-1111-1111-1111-111111111111`,
    name: `Cliente ${n}`,
    email: `cliente${n}@exemplo.com`,
    phone: `(35) 9999-000${n}`,
    purchases: n,
  };
}

function respostaCom(
  users: ReturnType<typeof cliente>[],
  extras: Partial<RespostaDeClientes> = {},
): Leitura<RespostaDeClientes> {
  return {
    ok: true,
    dados: {
      users,
      total: users.length,
      totalPages: 1,
      page: 1,
      ...extras,
    },
  };
}

async function saida(
  parametros: Record<string, string | string[] | undefined> = {},
): Promise<string> {
  return html(await PaginaDeClientes({ searchParams: Promise.resolve(parametros) }));
}

beforeEach(() => {
  lerDaApi.mockReset();
  lerDaApi.mockResolvedValue(respostaCom([cliente(1), cliente(2)]));
});

describe("a tela de clientes, com dados", () => {
  it("monta, e o título é Clientes", async () => {
    const s = await saida();
    expect(s).toContain("<h1");
    expect(s).toContain("Clientes");
  });

  it("desenha uma linha por cliente, com e-mail e contagem de compras", async () => {
    const s = await saida();
    expect(s).toContain("Cliente 1");
    expect(s).toContain("cliente2@exemplo.com");
    expect(s).toContain("(35) 9999-0001");
  });

  /**
   * R23 — a primeira coluna é o identificador HUMANO, e a <Tabela> a transforma
   * em `<th scope="row">`. Sem isso o leitor de tela anuncia "3" sem dizer de
   * quem, e comparar valores vira comparar posição sem âncora.
   */
  it("a primeira coluna é cabeçalho de linha, e não uma célula qualquer", async () => {
    expect(await saida()).toContain('scope="row"');
  });

  /** R24 — tabela nativa, nunca `role="grid"`. */
  it("é uma <table> de verdade", async () => {
    const s = await saida();
    expect(s).toContain("<table");
    expect(s).not.toContain('role="grid"');
  });

  it("nenhum UUID de cliente vai para a tela", async () => {
    const s = await saida();
    expect(s).not.toContain("11111111-1111-1111-1111-111111111111".slice(0, 18));
  });

  /** R1 — a busca é um campo, não um ícone que abre um campo. */
  it("a busca está visível, com rótulo", async () => {
    const s = await saida();
    expect(s).toContain('role="search"');
    expect(s).toContain("Buscar cliente");
    expect(s).toContain('type="search"');
  });

  it("diz em nome de quem se está trabalhando", async () => {
    expect(await saida()).toContain("gestao@cafecanastra.com");
  });

  it("a tela não abre um segundo <main> — o do layout já a envolve", async () => {
    expect(await saida()).not.toContain("<main");
  });
});

describe("a consulta que sai daqui", () => {
  it("pede a rota do painel com página e limite", async () => {
    await saida();
    expect(lerDaApi).toHaveBeenCalledWith("/auth/users?page=1&limit=20");
  });

  /**
   * A NORMALIZAÇÃO DO CPF É INVISÍVEL NA TELA, então é aqui que ela se prova de
   * ponta a ponta: o que o gestor colou tem pontos, e o que chega à API não.
   */
  it("o CPF colado com pontos chega à API sem pontos", async () => {
    await saida({ q: "529.982.247-25" });
    expect(lerDaApi).toHaveBeenCalledWith(
      "/auth/users?q=52998224725&page=1&limit=20",
    );
  });

  it("a página da URL vira a página da consulta", async () => {
    await saida({ pagina: "3" });
    expect(lerDaApi).toHaveBeenCalledWith("/auth/users?page=3&limit=20");
  });
});

describe("R3 — o filtro aparece e dá para tirar", () => {
  it("sem busca, não há chip nem 'Limpar tudo'", async () => {
    const s = await saida();
    expect(s).not.toContain("Limpar tudo");
  });

  it("com busca, o chip mostra o que foi digitado e o 'Limpar tudo' existe", async () => {
    const s = await saida({ q: "maria" });
    expect(s).toContain("maria");
    expect(s).toContain("Limpar tudo");
    expect(s).toContain('href="/dashboard/clientes"');
  });
});

/**
 * A DOUTRINA DO <EstadoDaTela>, virada em teste: "zero é um número plausível;
 * mostrar o estado inicial depois de um fetch que falhou é informação errada
 * apresentada com toda a confiança".
 */
describe("os três estados vazios do R16", () => {
  it("a leitura que FALHOU vira erro, e nunca 'nenhum cliente cadastrado'", async () => {
    lerDaApi.mockResolvedValue({
      ok: false,
      erro: "A API não respondeu. Recarregue a página; nada foi alterado.",
    });
    const s = await saida();

    expect(s).toContain("A API não respondeu");
    expect(s).toContain('role="alert"');
    expect(s).not.toContain("Nenhum cliente cadastrado");
    expect(s).not.toContain("Nenhum resultado para este filtro");
    // E não desenha a tabela vazia por baixo do erro: uma tabela sem linhas
    // ao lado de um aviso é a tela dizendo as duas coisas ao mesmo tempo.
    expect(s).not.toContain("<table");
  });

  /**
   * A BUSCA SOBREVIVE AO ERRO. Se ela morasse dentro da <Ficha>, sumiria junto
   * com a tabela — e o gestor ficaria olhando para um aviso sem nenhum controle
   * para tentar outra coisa.
   */
  it("mesmo no erro, a busca continua na tela", async () => {
    lerDaApi.mockResolvedValue({ ok: false, erro: "A API não respondeu." });
    expect(await saida()).toContain("Buscar cliente");
  });

  it("base vazia de verdade diz que ela está vazia", async () => {
    lerDaApi.mockResolvedValue(respostaCom([]));
    const s = await saida();
    expect(s).toContain("Nenhum cliente cadastrado");
    expect(s).not.toContain('role="alert"');
  });

  /**
   * R16 pede TRÊS estados distintos, e este é o que mais se perde: "não achei
   * com este filtro" tem ação (limpar o filtro), "não há nada" não tem.
   */
  it("busca sem resultado diz que é o FILTRO, e oferece limpá-lo", async () => {
    lerDaApi.mockResolvedValue(respostaCom([]));
    const s = await saida({ q: "zzzz" });
    expect(s).toContain("Nenhum resultado para este filtro");
    expect(s).not.toContain("Nenhum cliente cadastrado");
  });
});

describe("R17 — paginação, nunca scroll infinito", () => {
  /**
   * UMA PÁGINA SÓ NÃO GANHA RÉGUA: "‹ 1 ›" com as duas setas desativadas são
   * três controles que não fazem nada, e controle inerte ensina que os
   * controles desta tela podem ser inertes. A contagem fica — ela é o que diz
   * ao gestor que o filtro pegou tudo.
   */
  it("com uma página só, há contagem mas não há régua de páginas", async () => {
    const s = await saida();
    expect(s).toMatch(/2<\/span>\s*clientes/);
    expect(s).not.toContain('aria-current="page"');
    expect(s).not.toContain("Próxima");
  });

  it("com várias páginas, a régua aparece e leva a busca junto", async () => {
    lerDaApi.mockResolvedValue(
      respostaCom([cliente(1)], { total: 134, totalPages: 7, page: 2 }),
    );
    const s = await saida({ q: "maria", pagina: "2" });

    expect(s).toContain('aria-current="page"');
    // A URL da próxima página CARREGA O FILTRO — sem isso, virar a página
    // apaga a busca, e a lista completa aparece como se o filtro tivesse
    // sumido sozinho.
    expect(s).toContain("q=maria&amp;pagina=3");
    expect(s).toContain("Próxima");
  });

  /**
   * O rodapé conta a fila inteira, não a página: sem isso, a única forma de
   * saber quantos clientes casam com o filtro é clicar até o fim.
   */
  it("o rodapé diz o intervalo e o total", async () => {
    lerDaApi.mockResolvedValue(
      respostaCom([cliente(1)], { total: 134, totalPages: 7, page: 2 }),
    );
    const s = await saida({ pagina: "2" });
    expect(s).toContain("21–40");
    expect(s).toContain("134");
  });

  /**
   * QUEM MANDA NA PÁGINA EXIBIDA É A RESPOSTA. O backend prende `page` dentro
   * do que existe; usar o número pedido no rodapé enquanto a tabela mostra
   * outro faria a tela discordar de si mesma.
   */
  it("a página do rodapé é a que o backend devolveu, não a que foi pedida", async () => {
    lerDaApi.mockResolvedValue(
      respostaCom([cliente(1)], { total: 40, totalPages: 2, page: 2 }),
    );
    const s = await saida({ pagina: "999" });
    expect(s).toContain("21–40");
  });
});

/**
 * A RESSALVA DO R2, na tela: nada de dado de cliente na barra de endereço.
 * Nenhum `href` desta página carrega e-mail, CPF ou telefone de ninguém.
 */
describe("R2 — o que vai (e o que não vai) para a URL", () => {
  it("nenhum href leva e-mail, cpf ou telefone", async () => {
    lerDaApi.mockResolvedValue(
      respostaCom([cliente(1)], { total: 134, totalPages: 7, page: 2 }),
    );
    const s = await saida({ pagina: "2" });

    for (const href of [...s.matchAll(/href="([^"]*)"/g)].map((m) => m[1])) {
      expect(href).not.toContain("@");
      expect(href).not.toMatch(/\b(?:cpf|email|telefone|endereco)=/i);
    }
  });
});

/**
 * R13 — NÃO SE APAGA CLIENTE POR AQUI, E A TELA DIZ ISSO.
 *
 * A decisão já estava tomada e escrita no comentário do arquivo; o gestor não lê
 * comentário. Quem procura a lixeira e não a acha conclui que a tela nova está
 * incompleta, e o caminho seguinte é abrir o painel antigo ou pedir a alguém que
 * rode um DELETE — as duas saídas são piores do que a frase.
 *
 * O `DELETE /auth/users/:id` continua existindo no backend, e continua sem
 * nenhuma UI que o chame. É uma decisão, não uma lacuna.
 */
describe("R13 — a exclusão não mora nesta tela, e a tela explica", () => {
  /* A busca é por CONTROLE, e não pela palavra: a frase que explica a ausência
     contém "exclusão", e um casamento de texto solto ensinaria a apagar a
     explicação para calar o teste — que é o oposto do que se quer. */
  it("não desenha botão nem link de excluir", async () => {
    const s = await saida();
    expect(s).not.toMatch(/<(?:button|a)\b[^>]*>[^<]*(?:Excluir|Apagar|Remover)/i);
  });

  /** A frase nomeia o caminho CERTO, e não só o proibido: um aviso que só diz
   *  "não dá" manda a pessoa procurar como dar. */
  it("aponta o fluxo de LGPD, e diz que ele preserva a venda", async () => {
    const s = await saida();
    expect(s).toContain("Não há como excluir um cliente por aqui");
    expect(s).toContain("LGPD");
    expect(s).toContain("registro fiscal");
  });
});
