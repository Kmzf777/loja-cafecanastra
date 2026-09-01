import { describe, it, expect, vi, beforeEach } from "vitest";

import { html } from "@/lib/teste/html";
import type { Assinatura } from "@/lib/painel/assinaturas/assinaturas.logica";

/**
 * A CASCA da tela de Assinaturas — só o que a função pura não alcança.
 *
 * Filtro, contagem, paginação e vocabulário de status têm 58 casos em
 * `assinaturas.logica.test.ts`. O que sobra para cá é o que só existe quando o
 * JSX é montado, e nesta tela isso inclui algo que nenhuma outra tem: **a
 * honestidade sobre o que ela não faz**. Um botão de cancelar que aparecesse
 * aqui responderia "Assinatura não encontrada" para uma assinatura que está na
 * tela — e o teste é o que garante que ninguém o acrescente por parecer que
 * está faltando.
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
  useRouter: () => ({ push: () => {}, replace: () => {} }),
}));

const lerDaApi = vi.fn();
vi.mock("@/lib/painel/api-servidor", () => ({
  lerDaApi: (...args: unknown[]) => lerDaApi(...args),
}));

const { default: PaginaDeAssinaturas } = await import("./page");

function assinatura(sobrepor: Partial<Assinatura> = {}): Assinatura {
  return {
    id: "aaaaaaaa-0000-0000-0000-000000000001",
    sku: "CAN-CLA-250",
    quantidade: 2,
    frequencia_dias: 30,
    preco_centavos: 5900,
    status: "ativa",
    // 22h de 10/05 em São Paulo. Em UTC já é dia 11 — é o caso que a
    // formatação errada carimbaria no dia seguinte (R31).
    criado_em: "2026-05-11T01:00:00.000Z",
    atualizado_em: "2026-05-11T01:00:00.000Z",
    cancelada_em: null,
    nome_cafe: "Café Canastra Clássico",
    cliente_nome: "Maria Souza",
    cliente_email: "maria@exemplo.com",
    ...sobrepor,
  };
}

async function saida(
  parametros: Record<string, string | string[] | undefined> = {},
): Promise<string> {
  return html(await PaginaDeAssinaturas({ searchParams: Promise.resolve(parametros) }));
}

beforeEach(() => {
  lerDaApi.mockReset();
  lerDaApi.mockResolvedValue({ ok: true, dados: [assinatura()] });
});

describe("a tela de assinaturas, com dados", () => {
  it("monta, e chama a rota administrativa de leitura", async () => {
    const s = await saida();
    expect(s).toContain("<h1");
    expect(lerDaApi).toHaveBeenCalledWith("/admin/assinaturas");
  });

  it("mostra cliente, café, frequência e status", async () => {
    const s = await saida();
    expect(s).toContain("Maria Souza");
    expect(s).toContain("Café Canastra Clássico");
    expect(s).toContain("30 dias");
    expect(s).toContain("Ativa");
  });

  /**
   * `preco_centavos` É INTEGER, EM CENTAVOS. O mesmo schema devolve
   * `pedidos.total` em REAIS, e é por isso que `dinheiro.ts` tem a unidade no
   * nome: 5900 formatado como reais viraria R$ 5.900,00, e como centavos é
   * R$ 59,00. Nenhuma das duas telas dá erro — uma delas só está errada.
   */
  it("o valor é lido como CENTAVOS, não como reais", async () => {
    const s = await saida();
    expect(s).toContain("59,00");
    expect(s).not.toContain("5.900,00");
  });

  /**
   * R31 — dd/mm/aaaa em America/Sao_Paulo. A adesão das 22h de 10/05 é
   * 2026-05-11T01:00Z no banco, e uma formatação sem fuso a carimbaria como
   * 11/05.
   */
  it("a data da adesão é o dia de São Paulo, não o de UTC", async () => {
    const s = await saida();
    expect(s).toContain("10/05/2026");
    expect(s).not.toContain("11/05/2026");
  });

  /** Assinatura viva não foi cancelada em 01/01/1970. */
  it("assinatura ainda viva mostra travessão em 'Encerrada'", async () => {
    expect(await saida()).not.toContain("1970");
  });

  it("a primeira coluna é cabeçalho de linha, e não um UUID — R23", async () => {
    const s = await saida();
    expect(s).toContain('scope="row"');
    expect(s).not.toContain("aaaaaaaa-0000");
  });

  it("é uma <table> de verdade, nunca role=grid — R24", async () => {
    const s = await saida();
    expect(s).toContain("<table");
    expect(s).not.toContain('role="grid"');
  });

  it("a tela não abre um segundo <main> — o do layout já a envolve", async () => {
    expect(await saida()).not.toContain("<main");
  });
});

/**
 * O CORAÇÃO DESTA TELA. A pesquisa é explícita: "não prometer nenhum indicador
 * de saúde da assinatura antes de existir dunning", e "um painel novo que mostre
 * 'ativa' mente sobre quem não paga há meses".
 */
describe("a honestidade sobre o que a tela não sabe e não faz", () => {
  it("avisa que 'ativa' não quer dizer 'em dia'", async () => {
    const s = await saida();
    expect(s).toContain("em dia");
    expect(s).toContain("rejeitado");
  });

  /**
   * O aviso é `alerta` (ocre), NÃO `erro` (vermelho): nada está quebrado — é
   * assim que o sistema foi construído. Gastar o vermelho numa faixa
   * permanente é como se ensina o gestor a ignorar o vermelho de verdade (R21).
   */
  it("o aviso é alerta e não erro — R21 reserva o vermelho", async () => {
    const s = await saida();
    expect(s).toContain("border-alerta");
    expect(s).not.toContain("border-vermelho");
    expect(s).not.toContain("text-vermelho");
  });

  it("diz, em texto, que a tela é só leitura", async () => {
    expect(await saida()).toContain("não cria, não pausa e não cancela");
  });

  it("explica por que não há cancelamento, em vez de deixar deduzir", async () => {
    const s = await saida();
    expect(s).toContain("Cancelar");
    expect(s).toContain("não encontrada");
  });

  /**
   * NENHUM CONTROLE DE ESCRITA. `POST /clube/assinaturas/:id/cancelar` filtra
   * por dono e responde 404 ao administrador; não existe nenhuma outra rota
   * administrativa de escrita. Um botão aqui responderia "Assinatura não
   * encontrada" para uma assinatura visível na tela — o pior diagnóstico
   * possível, porque manda quem investiga procurar um bug de dados que não
   * existe.
   *
   * O teste olha por FORMULÁRIO e por BOTÃO DE AÇÃO, não pela palavra: a busca
   * é um `<form>` legítimo com um `<button type="submit">`, e o teste tem de
   * distinguir os dois.
   */
  it("não existe botão de ação nenhum além do de buscar", async () => {
    const s = await saida();
    const botoes = [...s.matchAll(/<button[^>]*>([\s\S]*?)<\/button>/g)].map((m) =>
      m[1].replace(/<[^>]*>/g, "").trim(),
    );
    // "Sair" vem do <Cabecalho>, "Buscar" da ilha de busca. Mais nada.
    expect(botoes.sort()).toEqual(["Buscar", "Sair"]);
  });

  it("nem link de ação disfarçado — todo href leva a esta mesma lista", async () => {
    lerDaApi.mockResolvedValue({
      ok: true,
      dados: [assinatura({ id: "a" }), assinatura({ id: "b" })],
    });
    const s = await saida();
    for (const href of [...s.matchAll(/href="([^"]*)"/g)].map((m) => m[1])) {
      expect(href.split("?")[0]).toBe("/dashboard/assinaturas");
    }
  });
});

describe("R3 — abas de status com contagem, e chips removíveis", () => {
  beforeEach(() => {
    lerDaApi.mockResolvedValue({
      ok: true,
      dados: [
        assinatura({ id: "1", status: "ativa" }),
        assinatura({ id: "2", status: "ativa" }),
        assinatura({ id: "3", status: "cancelada" }),
      ],
    });
  });

  it("as cinco abas existem, com a contagem de cada uma", async () => {
    const s = await saida();
    for (const rotulo of ["Todas", "Pendente", "Ativa", "Pausada", "Cancelada"]) {
      expect(s).toContain(rotulo);
    }
    expect(s).toContain('href="/dashboard/assinaturas?status=ativa"');
  });

  /**
   * TODA ABA APARECE, MESMO EM ZERO. Uma aba que some quando está vazia faz a
   * barra mudar de tamanho a cada busca, e o alvo dança debaixo do ponteiro.
   */
  it("aba sem nenhuma assinatura mostra zero, e não some", async () => {
    const s = await saida();
    expect(s).toMatch(/Pausada<span data-dado[^>]*>0<\/span>/);
  });

  it("a aba escolhida é anunciada, e não só pintada", async () => {
    expect(await saida({ status: "ativa" })).toContain('aria-current="page"');
  });

  it("com filtro, há chip e 'Limpar tudo'", async () => {
    const s = await saida({ status: "ativa", q: "maria" });
    expect(s).toContain("Limpar tudo");
    expect(s).toContain("Status");
    expect(s).toContain("Busca");
  });

  it("sem filtro, não há chip nem 'Limpar tudo'", async () => {
    expect(await saida()).not.toContain("Limpar tudo");
  });

  /** Status inventado na URL é ignorado, não obedecido: obedecido, ele
   *  esvaziaria a tela para sempre. */
  it("?status=paga não existe, e a tela mostra tudo em vez de nada", async () => {
    const s = await saida({ status: "paga" });
    expect(s).toContain("Maria Souza");
    expect(s).not.toContain("Nenhum resultado para este filtro");
  });
});

describe("os três estados vazios do R16", () => {
  it("a leitura que FALHOU vira erro, e nunca 'nenhuma assinatura'", async () => {
    lerDaApi.mockResolvedValue({ ok: false, erro: "A API não respondeu." });
    const s = await saida();

    expect(s).toContain("A API não respondeu");
    expect(s).toContain('role="alert"');
    expect(s).not.toContain("Nenhuma assinatura no Clube");
    expect(s).not.toContain("<table");
  });

  /**
   * A TARJA DE HONESTIDADE SOBREVIVE AO ERRO — ela não é sobre os dados, é
   * sobre como o Clube funciona, e continua verdadeira com a API fora do ar.
   */
  it("mesmo no erro, o aviso sobre 'ativa' e a busca continuam na tela", async () => {
    lerDaApi.mockResolvedValue({ ok: false, erro: "A API não respondeu." });
    const s = await saida();
    expect(s).toContain("em dia");
    expect(s).toContain("Buscar assinatura");
  });

  it("Clube sem nenhuma assinatura diz isso, e diz onde ela nasce", async () => {
    lerDaApi.mockResolvedValue({ ok: true, dados: [] });
    const s = await saida();
    expect(s).toContain("Nenhuma assinatura no Clube");
    expect(s).toContain("assistente de adesão");
    expect(s).not.toContain('role="alert"');
  });

  it("filtro sem resultado diz que é o FILTRO, e oferece limpá-lo", async () => {
    const s = await saida({ q: "zzzz" });
    expect(s).toContain("Nenhum resultado para este filtro");
    expect(s).not.toContain("Nenhuma assinatura no Clube");
  });
});

describe("R17 — paginação sobre a lista inteira", () => {
  /**
   * A rota devolve TUDO sem paginar, então a fatia é feita aqui. O que este
   * teste garante é que o rodapé conte a lista FILTRADA inteira, e não a
   * página — o defeito legado era exatamente o contrário (filtrar a página e
   * mostrar o total geral).
   */
  it("com mais de uma página, a régua aparece e o total é o da lista toda", async () => {
    lerDaApi.mockResolvedValue({
      ok: true,
      dados: Array.from({ length: 45 }, (_, i) =>
        assinatura({ id: `id-${i}`, cliente_nome: `Cliente ${i}` }),
      ),
    });
    const s = await saida();

    expect(s).toContain("45");
    expect(s).toContain("1–20");
    expect(s).toContain('aria-current="page"');
    expect(s).toContain("Próxima");
  });

  it("a página 2 mostra a fatia certa e mantém o filtro no link", async () => {
    lerDaApi.mockResolvedValue({
      ok: true,
      dados: Array.from({ length: 45 }, (_, i) =>
        assinatura({ id: `id-${i}`, cliente_nome: `Cliente ${i}` }),
      ),
    });
    const s = await saida({ pagina: "2", status: "ativa" });

    expect(s).toContain("21–40");
    expect(s).toContain("Cliente 20");
    expect(s).not.toContain("Cliente 19<");
    expect(s).toContain("status=ativa&amp;pagina=3");
  });
});
