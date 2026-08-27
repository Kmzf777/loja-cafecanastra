import { describe, it, expect, vi, beforeEach } from "vitest";

import { html } from "@/lib/teste/html";

/**
 * A CASCA da tela de Ajustes — só o que a função pura não alcança.
 *
 * A decisão inteira (analisar o frete, montar o corpo omitindo o vazio, separar
 * as duas listas, decidir a ordem das perguntas do Bling) vive em
 * `ajustes.logica.ts` e tem 68 casos lá. O que sobra para cá é o que só existe
 * quando o JSX é montado:
 *
 *   · que os QUATRO blocos falhem SEPARADAMENTE — o Bling fora do ar não pode
 *     apagar o campo de frete grátis da tela;
 *   · que a leitura falhada de `/config` NÃO desenhe um formulário em branco,
 *     que é um convite a salvar o branco por cima do que estava lá;
 *   · que a barra de aviso e os banners sejam APONTADOS e não duplicados;
 *   · que a marca de "em uso" só apareça quando a leitura cobriu o catálogo;
 *   · que a tela leve à de Administradores, que o menu ainda não tem.
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

/** As Server Actions são importadas pelas ilhas, e as de verdade puxam
 *  `next/cache`. Nenhum caso abaixo clica em nada. */
vi.mock("./acoes", () => ({
  salvarLoja: async () => ({ ok: true, frase: "" }),
  adicionarOpcao: async () => ({ ok: true, frase: "" }),
  excluirOpcao: async () => ({ ok: true, frase: "" }),
}));

const lerDaApi = vi.fn();
vi.mock("@/lib/painel/api-servidor", () => ({
  lerDaApi: (...args: unknown[]) => lerDaApi(...args),
}));

const { default: PaginaDeAjustes } = await import("./page");

const CONFIG = {
  site_title: "Café Canastra",
  whatsapp_number: "5537999990000",
  frete_gratis_minimo_centavos: 14900,
};

const OPCOES = [
  { id: "o1", type: "category", value: "Clássico" },
  { id: "o2", type: "category", value: "Micro-lote" },
  { id: "o3", type: "size", value: "250 g" },
];

/** Cada rota responde por si — os quatro blocos falham separadamente, e é isso
 *  que estes testes precisam poder simular. */
function responder(
  respostas: Partial<Record<"config" | "options" | "dashboard" | "bling", unknown>> = {},
) {
  const padrao = {
    config: { ok: true, dados: CONFIG },
    options: { ok: true, dados: OPCOES },
    dashboard: {
      ok: true,
      dados: { products: [{ category: "Clássico", size: "250 g" }], total: 1 },
    },
    bling: {
      ok: true,
      dados: { configurado: true, token: { ok: true }, ativo: true, nfeAuto: false },
    },
  };
  const mapa = { ...padrao, ...respostas };
  lerDaApi.mockImplementation((caminho: string) => {
    if (caminho === "/config") return mapa.config;
    if (caminho === "/options") return mapa.options;
    if (caminho.startsWith("/dashboard")) return mapa.dashboard;
    if (caminho === "/bling/status") return mapa.bling;
    throw new Error(`rota não prevista no teste: ${caminho}`);
  });
}

async function saida(): Promise<string> {
  return html(await PaginaDeAjustes());
}

beforeEach(() => {
  lerDaApi.mockReset();
});

/* ========================================================================== */

describe("as quatro leituras", () => {
  it("pede config, options, o catálogo e a sonda do Bling", async () => {
    responder();
    await saida();
    const caminhos = lerDaApi.mock.calls.map((c) => c[0] as string).sort();
    expect(caminhos).toEqual([
      "/bling/status",
      "/config",
      "/dashboard?limit=200",
      "/options",
    ]);
  });
});

describe("os blocos falham SEPARADAMENTE", () => {
  /**
   * Um `<EstadoDaTela>` em volta da página inteira colapsaria quatro
   * diagnósticos num só, e o gestor abriria chamado dizendo "os ajustes não
   * abrem" sobre uma tela em que três dos quatro blocos funcionam.
   */
  it("Bling fora do ar não apaga o formulário da loja", async () => {
    responder({ bling: { ok: false, erro: "A API não respondeu." } });
    const saidaHtml = await saida();

    expect(saidaHtml).toContain("Piso do frete grátis");
    expect(saidaHtml).toContain("Não deu para perguntar");
    expect(saidaHtml).toContain("não quer dizer que a integração está desligada");
  });

  it("options fora do ar não apaga o bloco do Bling", async () => {
    responder({ options: { ok: false, erro: "Erro ao buscar opções" } });
    const saidaHtml = await saida();

    expect(saidaHtml).toContain("Erro ao buscar opções");
    expect(saidaHtml).toContain("Integração com o Bling");
  });

  /**
   * Um formulário em branco por causa de rede caída é um convite a salvar o
   * branco por cima do que estava lá — e neste formulário o campo em branco era
   * exatamente o que desligava o frete grátis da loja inteira.
   */
  it("config fora do ar NÃO desenha formulário em branco", async () => {
    responder({ config: { ok: false, erro: "A API não respondeu." } });
    const saidaHtml = await saida();

    expect(saidaHtml).toContain("A API não respondeu");
    expect(saidaHtml).not.toContain("Piso do frete grátis");
  });
});

describe("o formulário da loja", () => {
  it("chega com o valor de hoje já em reais, não em centavos", async () => {
    responder();
    const saidaHtml = await saida();
    expect(saidaHtml).toContain('value="149,00"');
    expect(saidaHtml).not.toContain('value="14900"');
  });

  /**
   * Deixar em branco NÃO zera — o `PUT` é parcial e o campo omitido fica como
   * estava. Foi por não dizer isso que o campo virava zero e a loja inteira
   * passava a dar frete grátis.
   */
  it("diz que campo em branco quer dizer 'não mexer'", async () => {
    responder();
    const saidaHtml = await saida();
    expect(saidaHtml).toContain("Deixar o campo em branco NÃO zera");
  });

  it("diz, campo a campo, o que a loja lê e o que ela não lê", async () => {
    responder();
    const saidaHtml = await saida();
    expect(saidaHtml).toContain("A loja lê este valor");
    expect(saidaHtml).toContain("NEXT_PUBLIC_WHATSAPP");
  });
});

describe("o que NÃO é duplicado aqui", () => {
  /**
   * A barra de aviso já é editável em `/dashboard/vitrine`, com prévia ao vivo
   * e abas de idioma (R33). A coluna `config_loja.barra_de_aviso` está morta: a
   * 0030 moveu o texto para `canastra.vitrine_texto`. Um segundo editor aqui
   * gravaria numa coluna que ninguém lê.
   */
  it("a barra de aviso é apontada para a Vitrine, e não editada", async () => {
    responder();
    const saidaHtml = await saida();
    expect(saidaHtml).toContain('href="/dashboard/vitrine"');
    expect(saidaHtml).toContain("Herói e barra de aviso");
    // Nenhum campo de edição da barra por aqui.
    expect(saidaHtml).not.toContain("announcement_bar");
  });

  it("não há uploader de banner — as duas colunas não têm leitor na loja nova", async () => {
    responder();
    const saidaHtml = await saida();
    expect(saidaHtml).not.toContain('type="file"');
    expect(saidaHtml).toContain("a loja nova não lê nenhuma delas");
  });

  it("a operação de NF-e continua dentro do pedido", async () => {
    responder();
    const saidaHtml = await saida();
    expect(saidaHtml).toContain('href="/dashboard/pedidos"');
    expect(saidaHtml).toContain("é lá que você está quando percebe que a nota não saiu");
  });
});

describe("as listas de opções", () => {
  it("o rótulo é 'Embalagens' embora o tipo seja 'size'", async () => {
    responder();
    const saidaHtml = await saida();
    expect(saidaHtml).toContain("Categorias");
    expect(saidaHtml).toContain("Embalagens");
    expect(saidaHtml).toContain("250 g");
  });

  it("marca 'Em uso' e tira o botão de excluir da opção usada", async () => {
    responder();
    const saidaHtml = await saida();
    expect(saidaHtml).toContain("Em uso");
    expect(saidaHtml).toContain("troque a opção nesses produtos antes de excluir");
    // A opção livre continua com botão.
    expect(saidaHtml).toContain(">Excluir<");
  });

  /**
   * `GET /dashboard` tem teto de 200. Com 250 produtos, os 50 de fora poderiam
   * usar justamente a opção marcada como livre — e marca errada numa tela de
   * exclusão convida ao clique.
   */
  it("com catálogo maior que a leitura, NÃO marca nada e diz por quê", async () => {
    responder({
      dashboard: {
        ok: true,
        dados: { products: [{ category: "Clássico", size: "250 g" }], total: 250 },
      },
    });
    const saidaHtml = await saida();
    expect(saidaHtml).toContain("não marca quais opções estão em uso");
    expect(saidaHtml).not.toContain(">Em uso<");
  });

  it("catálogo fora do ar também desliga a marca, sem esconder as listas", async () => {
    responder({ dashboard: { ok: false, erro: "A API não respondeu." } });
    const saidaHtml = await saida();
    expect(saidaHtml).toContain("Clássico");
    expect(saidaHtml).toContain("não marca quais opções estão em uso");
  });
});

describe("o bloco do Bling", () => {
  it("ligado mostra o selo de sucesso e lembra onde a nota se emite", async () => {
    responder();
    const saidaHtml = await saida();
    expect(saidaHtml).toContain("Ligada");
    expect(saidaHtml).toContain("dentro do pedido");
  });

  /**
   * Estado de FÁBRICA, não erro — a mesma decisão da caixa azul do painel
   * legado. R21 reserva o vermelho a erro e destruição.
   */
  it("sem credencial não usa vermelho — desligada não é erro", async () => {
    responder({ bling: { ok: true, dados: { configurado: false } } });
    const saidaHtml = await saida();
    expect(saidaHtml).toContain("Nunca foi configurada");
    expect(saidaHtml).toContain("BLING_CLIENT_ID");

    /*
      A conferência é do FILETE DESTA TARJA, e não da página: o botão "Excluir"
      das listas de opções é destrutivo e legitimamente vermelho, então um
      `not.toContain("border-vermelho")` na página inteira estaria medindo outra
      coisa — e passaria a falhar no dia em que a lista mudasse.
    */
    const ateAqui = saidaHtml.slice(0, saidaHtml.indexOf("Faltam BLING_CLIENT_ID"));
    expect(ateAqui.lastIndexOf("border-fuligem-20 rounded-cx")).toBeGreaterThan(
      ateAqui.lastIndexOf("border-vermelho"),
    );
  });

  it("token que não renova É erro, com a frase do servidor inteira", async () => {
    responder({
      bling: {
        ok: true,
        dados: {
          configurado: true,
          token: { ok: false, erro: "O refresh token ficou OBSOLETO." },
        },
      },
    });
    const saidaHtml = await saida();
    expect(saidaHtml).toContain("A autorização não renova");
    expect(saidaHtml).toContain("O refresh token ficou OBSOLETO.");
    expect(saidaHtml).toContain("border-vermelho");
  });

  it("nomeia as variáveis dos dois interruptores", async () => {
    responder();
    const saidaHtml = await saida();
    expect(saidaHtml).toContain("BLING_NFE_AUTO");
    expect(saidaHtml).toContain("BLING_RASTREIO_CRON");
  });

  /**
   * A tela diz o que não consegue fazer — a doutrina da tela de Assinaturas.
   * Não há rota de callback OAuth: dizer isso separa "a tela não tem o botão" de
   * "a tela está quebrada".
   */
  it("explica que não dá para reautorizar por aqui, e qual é o caminho real", async () => {
    responder();
    const saidaHtml = await saida();
    expect(saidaHtml).toContain("BLING_REFRESH_TOKEN");
    expect(saidaHtml).toContain("publicar a API de novo");
  });
});

describe("a porta para Administradores", () => {
  /**
   * `menu.logica.ts` não tem a entrada, e este bloco não pode editá-la (regra
   * de isolamento da onda). Sem este link a tela nova seria inalcançável — e
   * uma tela inalcançável é uma tela que não existe. Está RELATADO.
   */
  it("leva à tela de administradores, e diz por que vale abrir hoje", async () => {
    responder();
    const saidaHtml = await saida();
    expect(saidaHtml).toContain('href="/dashboard/administradores"');
    expect(saidaHtml).toContain("a um esquecimento de perder a gestão");
  });
});
