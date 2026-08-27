import { describe, it, expect, vi, beforeEach } from "vitest";

import { html } from "@/lib/teste/html";
import type { PedidoDoPainel } from "@/lib/painel/pedidos/pedidos.logica";

/**
 * A CASCA da tela de Pedidos — só o que a função pura não alcança.
 *
 * Filtro, abas, chips, número do pedido, endereço, seleção e exportação têm 87
 * casos em `pedidos.logica.test.ts`, sem DOM nenhum. O que sobra para cá é o
 * que só existe quando o JSX é montado: que a primeira coluna é cabeçalho de
 * linha e não um UUID, que o dinheiro sai em reais e não em centavos, que a
 * data é o dia de São Paulo, que o vazio se cala quando houve erro — e que a
 * coluna de NF-e destaca a nota que PARECE emitida e não está.
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

/** As ações do painel são Server Actions; num teste de markup elas nunca são
 *  chamadas, mas o módulo real arrastaria a sessão do Supabase para dentro do
 *  jsdom só para ser importado. */
vi.mock("./acoes", () => ({
  mudarStatusDoPedido: async () => ({ ok: true, frase: "Status atualizado." }),
  mudarStatusEmLote: async () => ({ ok: true, frase: "1 de 1 pedidos atualizados." }),
}));

const lerDaApi = vi.fn();
vi.mock("@/lib/painel/api-servidor", () => ({
  lerDaApi: (...args: unknown[]) => lerDaApi(...args),
}));

const { default: PaginaDePedidos } = await import("./page");

function pedido(sobrepor: Partial<PedidoDoPainel> = {}): PedidoDoPainel {
  return {
    order_id: "3f9a2c11-1111-2222-3333-444455556666",
    total_amount: "128.50",
    status: "aprovado",
    // 22h de 20/08 em São Paulo. Em UTC já é dia 21 — é o caso que a
    // formatação sem fuso carimbaria no dia seguinte (R31).
    created_at: "2026-08-21T01:00:00.000Z",
    payment_method: "pix",
    items: [{ name: "Clássico 250g", size: "250g", quantity: 2, price: "59.00" }],
    address: {
      street: "Rua das Flores",
      number: "12",
      neighborhood: "Centro",
      city: "Piumhi",
      state: "MG",
      zip_code: "37925000",
    },
    shipping_cost: "18.90",
    shipping_method: "PAC",
    tracking_code: null,
    coupon_code: null,
    discount: "0.00",
    bling_id: null,
    bling_situacao: null,
    bling_sincronizado_em: null,
    nfe_numero: null,
    nfe_chave: null,
    nfe_url: null,
    user_name: "Maria Souza",
    user_email: "maria@exemplo.com",
    user_cpf: "52998224725",
    ...sobrepor,
  };
}

/** A listagem responde `{data,total,totalPages,page}`; a sonda do Bling
 *  responde sempre, ligada ou não. */
function responder({
  linhas = [pedido()],
  total = 1,
  totalPages = 1,
  page = 1,
  erroDaLista = null as string | null,
  bling = { ativo: false } as { ativo: boolean } | null,
} = {}) {
  lerDaApi.mockImplementation(async (caminho: string) => {
    if (caminho.startsWith("/bling/status")) {
      return bling ? { ok: true, dados: bling } : { ok: false, erro: "sonda muda" };
    }
    if (erroDaLista) return { ok: false, erro: erroDaLista };
    return { ok: true, dados: { data: linhas, total, totalPages, page } };
  });
}

/*
  O ESPAÇO DE "R$ 128,50" É UM NBSP (U+00A0) — é o que o `Intl.NumberFormat`
  do pt-BR emite entre o símbolo e o número, e ele é INVISÍVEL numa mensagem de
  falha: a saída esperada e a recebida aparecem idênticas na tela e o teste
  continua vermelho. Normalizar aqui deixa as asserções legíveis sem esconder
  nada do que a tela mostra.
*/
async function saida(
  parametros: Record<string, string | string[] | undefined> = {},
): Promise<string> {
  const bruto = html(
    await PaginaDePedidos({ searchParams: Promise.resolve(parametros) }),
  );
  return bruto.replace(/\u00a0/g, " ");
}

beforeEach(() => {
  lerDaApi.mockReset();
  responder();
});

describe("a tela de pedidos, com dados", () => {
  it("monta, e pergunta à listagem administrativa com o limite da tela", async () => {
    const s = await saida();
    expect(s).toContain("<h1");
    expect(lerDaApi).toHaveBeenCalledWith("/admin/orders?page=1&limit=20");
  });

  /**
   * R23 — a primeira coluna é o identificador HUMANO. E o número é o dos OITO
   * PRIMEIROS dígitos, que é o que o cliente lê no assunto do e-mail: o painel
   * legado mostrava os seis ÚLTIMOS, e os dois números nunca batiam.
   */
  it("a primeira coluna é o número do cliente e o nome, nunca o UUID", async () => {
    const s = await saida();
    expect(s).toContain('scope="row"');
    expect(s).toContain("#3F9A2C11");
    expect(s).toContain("Maria Souza");
    /* O UUID não aparece em TEXTO — é ele que ninguém reconhece. A comparação
       é sobre o conteúdo visível e não sobre o HTML cru, porque o UUID viaja
       no `href` do deep-link de propósito (é o identificador opaco da rota, e
       é o que o teste logo abaixo exige que esteja lá). */
    const visivel = s.replace(/<[^>]*>/g, " ");
    expect(visivel).not.toContain("3f9a2c11-1111-2222-3333-444455556666");
  });

  /** A linha é um `<a href>` de verdade: Ctrl+clique abre o pedido noutra aba,
   *  e a tela continua navegável sem JavaScript. O painel lateral entra só no
   *  clique comum. */
  it("a linha aponta para a rota própria do pedido", async () => {
    expect(await saida()).toContain(
      'href="/dashboard/pedidos/3f9a2c11-1111-2222-3333-444455556666"',
    );
  });

  it("é uma <table> de verdade, nunca role=grid — R24", async () => {
    const s = await saida();
    expect(s).toContain("<table");
    expect(s).not.toContain('role="grid"');
  });

  /**
   * `total_amount` é `numeric(10,2)` em REAIS, entregue como STRING. O mesmo
   * schema devolve `preco_centavos` em CENTAVOS noutras telas — trocar os dois
   * formatadores faz R$ 128,50 virar R$ 1,28 sem nenhum sinal.
   */
  it("o total é lido como REAIS, não como centavos", async () => {
    const s = await saida();
    expect(s).toContain("128,50");
    expect(s).not.toContain("1,28");
  });

  /** R31 — o pedido das 22h de 20/08 é 21/08 em UTC. */
  it("a data é o dia de São Paulo, não o de UTC", async () => {
    const s = await saida();
    expect(s).toContain("20/08/2026");
    expect(s).not.toContain("21/08/2026");
  });

  it("o status aparece pelo RÓTULO, nunca pelo valor do banco", async () => {
    const s = await saida({ });
    expect(s).toContain("Aprovado");
    expect(s).not.toContain(">em_processamento<");
  });

  it("os números vão em data-dado — R23, comparar valor é comparar posição", async () => {
    expect(await saida()).toContain("data-dado");
  });
});

describe("a coluna de NF-e", () => {
  /**
   * O ESTADO QUE MAIS PRECISA DE DESTAQUE: nota GERADA no Bling e não
   * transmitida à SEFAZ. Ela *parece* resolvida — existe número — e não está.
   */
  it("nota com número e sem chave aparece como não transmitida", async () => {
    responder({ linhas: [pedido({ nfe_numero: "1234" })] });
    const s = await saida();
    expect(s).toContain("Não transmitida");
  });

  it("nota com chave da SEFAZ aparece como emitida", async () => {
    responder({ linhas: [pedido({ nfe_numero: "1234", nfe_chave: "3526..." })] });
    expect(await saida()).toContain("NF-e emitida");
  });

  /** Venda não confirmada não vira pedido de venda nem nota — a coluna diz
   *  isso com um travessão, e não com um alerta que não cabe. */
  it("pedido não pago não recebe estado de NF-e", async () => {
    responder({ linhas: [pedido({ status: "pendente" })] });
    const s = await saida();
    expect(s).not.toContain("Sem nota");
    expect(s).toContain("Pendente");
  });
});

describe("as abas salvas — R4", () => {
  it("são links com o filtro dentro, não botões com estado", async () => {
    const s = await saida();
    expect(s).toContain('href="/dashboard/pedidos?status=aprovado"');
    expect(s).toContain("A despachar");
    expect(s).toContain("Pagamento pendente");
    expect(s).toContain("Aguardando NF-e");
  });

  it("a aba aberta se anuncia, e explica o recorte", async () => {
    const s = await saida({ status: "aprovado" });
    expect(s).toContain('aria-current="page"');
    expect(s).toContain("ainda não despachado");
  });

  it("a aba de NF-e confessa que o recorte olha só a página carregada", async () => {
    const s = await saida({ status: "aprovado,enviado,entregue", nfe: "pendente" });
    expect(s).toContain("página carregada");
  });
});

describe("o filtro, na URL — R2 e R3", () => {
  it("repassa status, período e busca à API", async () => {
    await saida({ q: "maria", status: "aprovado", de: "2026-08-01", ate: "2026-08-31" });
    expect(lerDaApi).toHaveBeenCalledWith(
      "/admin/orders?q=maria&status=aprovado&de=2026-08-01&ate=2026-08-31&page=1&limit=20",
    );
  });

  it("cada filtro ligado vira um chip removível, com 'Limpar tudo'", async () => {
    const s = await saida({ q: "maria", status: "aprovado" });
    expect(s).toContain("Limpar tudo");
    expect(s).toContain("Remover filtro Busca: maria");
    expect(s).toContain("Remover filtro Status: Aprovado");
  });

  /**
   * A ressalva explícita do R2: URL vai para o histórico, para o `Referer`,
   * para o log do proxy e para a captura de tela do grupo. Nenhum `href` desta
   * tela carrega CPF, e-mail ou endereço — o único identificador que trafega é
   * o UUID do pedido, que é opaco.
   */
  it("nenhum href leva dado pessoal do RESULTADO", async () => {
    responder({ linhas: [pedido()] });
    const s = await saida({ q: "maria" });
    for (const href of s.match(/href="[^"]*"/g) ?? []) {
      expect(href).not.toContain("maria@exemplo.com");
      expect(href).not.toContain("52998224725");
      expect(href).not.toContain("Piumhi");
    }
  });
});

describe("os estados da tela — R16", () => {
  /**
   * ZERO PEDIDOS É UM NÚMERO PLAUSÍVEL, e mostrar "nenhum pedido" depois de um
   * fetch que falhou é informação errada apresentada com toda a confiança. É o
   * defeito que o painel legado documenta em `HomeDashboard.jsx`.
   */
  it("com erro, a frase do servidor aparece e o vazio SE CALA", async () => {
    responder({ erroDaLista: "Status inválido: \"delivered\"." });
    const s = await saida();
    expect(s).toContain("Status inválido");
    expect(s).not.toContain("Nenhum pedido ainda");
  });

  it("vazio sem filtro é educativo", async () => {
    responder({ linhas: [], total: 0 });
    const s = await saida();
    expect(s).toContain("Nenhum pedido ainda");
  });

  it("vazio COM filtro oferece limpar, e não afirma que a loja não vendeu", async () => {
    responder({ linhas: [], total: 0 });
    const s = await saida({ status: "cancelado" });
    expect(s).toContain("Nenhum resultado para este filtro");
    expect(s).not.toContain("Nenhum pedido ainda");
  });

  /** A busca precisa continuar visível JUSTAMENTE no erro: é dela que o gestor
   *  precisa para tentar outra coisa. */
  it("a busca sobrevive ao erro — R1", async () => {
    responder({ erroDaLista: "A API não respondeu." });
    expect(await saida()).toContain("Buscar pedido");
  });
});

describe("o recorte de NF-e, que acontece em memória", () => {
  it("filtra a página e CONFESSA a contagem", async () => {
    responder({
      linhas: [pedido({ nfe_chave: "3526..." }), pedido({ order_id: "bbbbbbbb-2" })],
      total: 134,
      totalPages: 7,
    });
    const s = await saida({ status: "aprovado,enviado,entregue", nfe: "pendente" });
    expect(s).toContain("1 de 2 pedidos desta página");
    expect(s).toContain("134 no total");
    expect(s).toContain("olha só a página carregada");
  });

  /** Sem o recorte, nenhuma confissão: uma ressalva permanente vira ruído e
   *  para de ser lida quando importa. */
  it("sem o recorte, a frase não aparece", async () => {
    expect(await saida()).not.toContain("olha só a página carregada");
  });
});

describe("a exportação", () => {
  it("o botão fica no canto da ação primária — R18", async () => {
    expect(await saida()).toContain("Exportar CSV");
  });

  /** R27 até onde o backend permite: a rota do CSV aceita só `de` e `ate`, e a
   *  tela DIZ o que não vai no arquivo em vez de deixar o gestor descobrir no
   *  Excel. */
  it("a tela diz que status e busca NÃO vão para o arquivo", async () => {
    const s = await saida({ status: "aprovado", q: "maria" });
    expect(s).toContain("A exportação leva só o período");
  });
});

describe("a sonda do Bling", () => {
  it("é perguntada junto com a listagem, numa ida paralela", async () => {
    await saida();
    expect(lerDaApi).toHaveBeenCalledWith("/bling/status");
  });

  /**
   * A sonda responde 200 mesmo com tudo desligado — é o endpoint que
   * DIAGNOSTICA o desligado. Um erro nela significa problema no servidor da
   * loja, e nesse caso nada é desabilitado: o servidor continua sendo a
   * autoridade.
   */
  it("sonda muda não derruba a tela nem some com a lista", async () => {
    responder({ bling: null });
    const s = await saida();
    expect(s).toContain("#3F9A2C11");
  });
});
