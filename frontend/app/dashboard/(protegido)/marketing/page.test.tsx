import { describe, it, expect, vi, beforeEach } from "vitest";

import { html } from "@/lib/teste/html";
import type { Leitura } from "@/lib/painel/api-servidor";
import type { RespostaDeCampanhas } from "@/lib/painel/marketing/campanhas.logica";

/**
 * A CASCA da tela de Campanhas — só o que a função pura não alcança.
 *
 * A decisão inteira (ler a URL, montar a consulta, derivar a situação, validar o
 * formulário) vive em `campanhas.logica.ts` e tem 80 casos lá. O que sobra para
 * cá é o que só existe quando o JSX é montado:
 *
 *   · a ORDEM DAS GUARDAS do <EstadoDaTela> — que a leitura falhada não vire
 *     "nenhuma campanha", que é o defeito mais caro do painel legado e o único
 *     que teste de unidade nenhum pega;
 *   · que a CONSULTA que sai daqui seja a que o módulo puro montou (a tela pode
 *     estar certa e chamar a rota errada);
 *   · que as ressalvas que a spec manda ESCREVER na tela estejam escritas.
 *
 * `await` na função e `html()` no resultado: um Server Component assíncrono é
 * uma função que devolve uma Promise de elemento. Fora do bundler RSC o
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

/** As ilhas de cliente chamam `useRouter`, que fora de um roteador não existe. */
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: () => {}, replace: () => {}, refresh: () => {} }),
}));

const lerDaApi = vi.fn();
vi.mock("@/lib/painel/api-servidor", () => ({
  lerDaApi: (...args: unknown[]) => lerDaApi(...args),
}));

const { default: PaginaDeMarketing } = await import("./page");

function campanha(n: number, sobrescreve = {}) {
  return {
    id: `aaaaaaaa-aaaa-aaaa-aaaa-00000000000${n}`,
    nome: `Campanha ${n}`,
    canal: "meta",
    utm_campaign: `campanha-${n}`,
    custo_centavos: n * 10_000,
    inicio_em: null,
    fim_em: null,
    ativa: true,
    criada_em: "2026-08-01T12:00:00.000Z",
    atualizada_em: "2026-08-01T12:00:00.000Z",
    ...sobrescreve,
  };
}

function respostaCom(
  linhas: ReturnType<typeof campanha>[],
  extra: Partial<RespostaDeCampanhas> = {},
): Leitura<RespostaDeCampanhas> {
  return {
    ok: true,
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
    await PaginaDeMarketing({ searchParams: Promise.resolve(parametros) }),
  );
}

beforeEach(() => {
  lerDaApi.mockReset();
  lerDaApi.mockResolvedValue(respostaCom([campanha(1)]));
});

describe("a leitura", () => {
  it("chama a rota que o módulo puro montou, com o limite da tela", async () => {
    await montar();
    expect(lerDaApi).toHaveBeenCalledWith("/admin/campanhas?page=1&limit=20");
  });

  it("leva os filtros da URL para a consulta", async () => {
    await montar({ q: "verao", canal: "google", ativa: "true" });
    const [caminho] = lerDaApi.mock.calls[0];
    expect(caminho).toContain("q=verao");
    expect(caminho).toContain("canal=google");
    expect(caminho).toContain("ativa=true");
  });

  /** Um canal fora do vocabulário responde 400 com frase; mandá-lo adiante
   *  transformaria a tela inteira numa tarja de erro. */
  it("não leva um canal inválido para o backend", async () => {
    await montar({ canal: "tiktok" });
    expect(lerDaApi.mock.calls[0][0]).not.toContain("canal=");
  });
});

describe("a ordem das guardas do <EstadoDaTela>", () => {
  /**
   * O DEFEITO MAIS CARO DO PAINEL LEGADO, num teste. Zero é um número
   * plausível: uma loja pode não ter campanha nenhuma. O que ela não pode é ler
   * "nenhuma campanha cadastrada" por causa de uma API fora do ar.
   */
  it("leitura falhada mostra o ERRO, e nunca o vazio", async () => {
    lerDaApi.mockResolvedValue({
      ok: false,
      erro: "A API não respondeu. Recarregue a página; nada foi alterado.",
    });
    const saida = await montar();

    expect(saida).toContain("A API não respondeu");
    expect(saida).not.toContain("Nenhuma campanha cadastrada");
  });

  it("zero campanhas com leitura boa mostra o vazio, e ele ensina o que fazer", async () => {
    lerDaApi.mockResolvedValue(respostaCom([]));
    const saida = await montar();

    expect(saida).toContain("Nenhuma campanha cadastrada");
    expect(saida).toContain("quanto cada anúncio custou");
  });

  /** R16: o vazio COM filtro é outro estado, com outra saída ("limpar"). */
  it("zero com filtro é o vazio de filtro, e não o de base vazia", async () => {
    lerDaApi.mockResolvedValue(respostaCom([]));
    const saida = await montar({ q: "nao-existe" });

    expect(saida).toContain("Nenhum resultado para este filtro");
    expect(saida).not.toContain("Nenhuma campanha cadastrada");
  });

  /** R1: a busca é sempre visível, e "sempre" inclui quando a tabela sumiu —
   *  é justamente aí que se precisa dela para tentar outra coisa. */
  it("a busca continua na tela quando a tabela não está", async () => {
    lerDaApi.mockResolvedValue({ ok: false, erro: "Deu ruim." });
    expect(await montar()).toContain("Buscar campanha");
  });
});

describe("o que a tela mostra da campanha", () => {
  it("o nome, o canal traduzido e a UTM", async () => {
    const saida = await montar();
    expect(saida).toContain("Campanha 1");
    expect(saida).toContain("Meta (Instagram/Facebook)");
    expect(saida).toContain("campanha-1");
  });

  it("o custo formatado em reais, a partir de CENTAVOS", async () => {
    lerDaApi.mockResolvedValue(respostaCom([campanha(1, { custo_centavos: 150_000 })]));
    expect(await montar()).toContain("1.500,00");
  });

  /** Data em branco significa "vale sempre" NESTE modelo — o oposto da regra do
   *  painel antigo. A célula diz a palavra em vez de um travessão. */
  it("campanha sem datas mostra «Sempre», e não um travessão", async () => {
    expect(await montar()).toContain("Sempre");
  });

  /**
   * O estado que a tela existe para nomear: o gestor acha que está anunciando e
   * não está. Só `ativa` diria "Ligada"; a junção diz "Encerrada".
   */
  it("ligada e fora da janela aparece como «Encerrada»", async () => {
    lerDaApi.mockResolvedValue(
      respostaCom([
        campanha(1, { ativa: true, fim_em: "2020-01-01T00:00:00.000Z" }),
      ]),
    );
    expect(await montar()).toContain("Encerrada");
  });

  it("a soma do custo diz «nesta página», e não «do período»", async () => {
    const saida = await montar();
    expect(saida).toContain("nesta página");
    expect(saida).not.toContain("do período");
  });
});

describe("o formulário vive na URL — R2", () => {
  it("sem parâmetro, o formulário não está na tela", async () => {
    expect(await montar()).not.toContain("Nova campanha</h2>");
  });

  it("«editar=novo» abre o formulário de criação", async () => {
    const saida = await montar({ editar: "novo" });
    expect(saida).toContain("Criar campanha");
    expect(saida).toContain("Custo de mídia");
  });

  it("um id da página abre a campanha certa", async () => {
    const saida = await montar({ editar: "aaaaaaaa-aaaa-aaaa-aaaa-000000000001" });
    expect(saida).toContain("Salvar alterações");
    expect(saida).toContain("Campanha 1");
  });

  /**
   * NÃO HÁ `GET /admin/campanhas/:id`. Abrir um formulário vazio para um id que
   * não está na página faria a pessoa CRIAR achando que edita.
   */
  it("um id fora da página avisa, em vez de abrir formulário vazio", async () => {
    const saida = await montar({ editar: "de-outra-pagina" });
    expect(saida).toContain("não está nesta página");
    expect(saida).not.toContain("Salvar alterações");
  });
});

describe("as ressalvas que a spec manda escrever na tela", () => {
  /**
   * R28 aplicado ao que ainda NÃO existe: as colunas de UTM nasceram na 0033,
   * mas a captura é da Onda 6. Sem esta frase, o gestor cadastra a campanha e
   * espera um relatório de origem que não vai existir — e conclui que quebrou.
   */
  it("diz que pedido nenhum tem origem gravada ainda, e por quê", async () => {
    const saida = await montar();
    expect(saida).toContain("Hoje nenhum pedido tem origem gravada");
    expect(saida).toContain("0033");
  });

  it("diz que o cadastro de hoje não é trabalho perdido", async () => {
    expect(await montar()).toContain("o custo de mídia só existe aqui");
  });

  /** A atribuição junta só por campanha: «Google pago» e «Google orgânico» não
   *  serão separáveis nem depois da captura. */
  it("diz que a junção é só por campanha, e nomeia o que falta", async () => {
    const saida = await montar();
    expect(saida).toContain("utm_source");
    expect(saida).toContain("utm_medium");
  });
});

describe("as lacunas de backend, declaradas na própria tela", () => {
  /**
   * Newsletter, carrinho abandonado e automações foram pedidos e não têm rota.
   * Uma tela vazia com "em breve" ensina que os controles deste painel podem não
   * levar a lugar nenhum; o silêncio vira chamado. A ficha é a terceira saída.
   */
  it("as três aparecem nomeadas", async () => {
    const saida = await montar();
    expect(saida).toContain("Newsletter");
    expect(saida).toContain("Carrinho abandonado");
    expect(saida).toContain("Automações");
  });

  it("cada uma diz o que já existe e o que falta", async () => {
    const saida = await montar();
    expect(saida).toContain("newsletter_inscritos");
    expect(saida).toContain("lembrete_enviado_em");
    expect(saida).toContain("canastra.automacoes");
  });

  /** Elas NÃO viram links: um item de menu que leva a uma tela inerte é pior
   *  que a lacuna declarada. */
  it("nenhuma delas vira link do sub-menu", async () => {
    const saida = await montar();
    expect(saida).not.toContain('href="/dashboard/marketing/newsletter"');
    expect(saida).not.toContain('href="/dashboard/marketing/automacoes"');
  });
});

describe("a navegação da área", () => {
  it("as quatro telas que existem estão na faixa", async () => {
    const saida = await montar();
    for (const href of [
      "/dashboard/marketing",
      "/dashboard/marketing/consentimentos",
      "/dashboard/marketing/envios",
      "/dashboard/marketing/whatsapp",
    ]) {
      expect(saida).toContain(`href="${href}"`);
    }
  });

  /** R18: uma ação primária, sempre no mesmo lugar — no <Cabecalho>. */
  it("a ação primária é «Nova campanha», e ela é um link", async () => {
    expect(await montar()).toContain("editar=novo");
  });
});
