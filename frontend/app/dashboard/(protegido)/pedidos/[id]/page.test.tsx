import { describe, it, expect, vi, beforeEach } from "vitest";

import { html } from "@/lib/teste/html";
import type { PedidoDoPainel } from "@/lib/painel/pedidos/pedidos.logica";

/**
 * O DEEP-LINK do pedido — a rota que o painel legado não tinha.
 *
 * Lá o detalhe só existia como um modal aberto a partir da linha, com a linha
 * guardada em memória: não havia endereço para mandar a ninguém, e um F5 no
 * meio da conferência devolvia a lista do começo. `GET /admin/orders/:id`
 * (Onda 4) é o que torna esta tela possível.
 *
 * O corpo é o MESMO componente do painel lateral, então o que se testa aqui é
 * só o que é próprio da rota: a leitura por id, as duas recusas que o backend
 * distingue de propósito, e os campos que só o detalhe mostra.
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

vi.mock("../acoes", () => ({
  mudarStatusDoPedido: async () => ({ ok: true, frase: "Status atualizado." }),
  mudarStatusEmLote: async () => ({ ok: true, frase: "ok" }),
}));

const lerDaApi = vi.fn();
vi.mock("@/lib/painel/api-servidor", () => ({
  lerDaApi: (...args: unknown[]) => lerDaApi(...args),
}));

const { default: PaginaDeUmPedido } = await import("./page");

const ID = "3f9a2c11-1111-2222-3333-444455556666";

function pedido(sobrepor: Partial<PedidoDoPainel> = {}): PedidoDoPainel {
  return {
    order_id: ID,
    total_amount: "128.50",
    status: "aprovado",
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

function responder({
  order = pedido() as PedidoDoPainel | null,
  erro = null as string | null,
} = {}) {
  lerDaApi.mockImplementation(async (caminho: string) => {
    if (caminho.startsWith("/bling/status")) return { ok: true, dados: { ativo: false } };
    if (erro) return { ok: false, erro };
    return { ok: true, dados: { order } };
  });
}

/*
  O ESPAÇO DE "R$ 128,50" É UM NBSP (U+00A0) — é o que o `Intl.NumberFormat`
  do pt-BR emite entre o símbolo e o número, e ele é INVISÍVEL numa mensagem de
  falha: a saída esperada e a recebida aparecem idênticas na tela e o teste
  continua vermelho. Normalizar aqui deixa as asserções legíveis sem esconder
  nada do que a tela mostra.
*/
async function saida(id = ID): Promise<string> {
  const bruto = html(await PaginaDeUmPedido({ params: Promise.resolve({ id }) }));
  return bruto.replace(/\u00a0/g, " ");
}

beforeEach(() => {
  lerDaApi.mockReset();
  responder();
});

describe("o detalhe em rota própria", () => {
  it("pergunta pelo id, na rota administrativa", async () => {
    await saida();
    expect(lerDaApi).toHaveBeenCalledWith(`/admin/orders/${ID}`);
  });

  it("o título é o número do cliente, não o UUID — R23", async () => {
    const s = await saida();
    expect(s).toContain("Pedido #3F9A2C11");
  });

  /** O UUID inteiro aparece UMA vez, selecionável: é ele que se cola num
   *  chamado ou numa consulta ao banco. */
  it("mostra o UUID inteiro dentro do detalhe", async () => {
    expect(await saida()).toContain(ID);
  });

  it("traz cliente, endereço formatado, frete e total", async () => {
    const s = await saida();
    expect(s).toContain("Maria Souza");
    expect(s).toContain("52998224725");
    expect(s).toContain("Rua das Flores, 12 - Centro, Piumhi - MG (CEP: 37925000)");
    expect(s).toContain("R$ 18,90");
    expect(s).toContain("R$ 128,50");
  });

  it("o meio de pagamento sai em caixa alta, como no extrato", async () => {
    expect(await saida()).toContain("PIX");
  });

  /** CPF ausente é a diferença entre poder e não poder emitir a nota — um
   *  travessão no meio de outros travessões não conta essa história. */
  it("CPF ausente diz 'Não informado', e não um travessão", async () => {
    responder({ order: pedido({ user_cpf: null }) });
    expect(await saida()).toContain("Não informado");
  });

  /**
   * `endereco_json` de pedido anterior à loja nova não é objeto. Um
   * `addr.street` ali lançaria e derrubaria a tela inteira.
   */
  it("pedido antigo com endereço em texto não derruba a tela", async () => {
    responder({ order: pedido({ address: "Rua tal, 12 - Centro" }) });
    const s = await saida();
    expect(s).toContain("pedido antigo");
    expect(s).toContain("Maria Souza");
  });

  it("itens gravados como string JSON são lidos", async () => {
    responder({
      order: pedido({ items: '[{"name":"Micro-lote","quantity":1,"price":"89.00"}]' }),
    });
    const s = await saida();
    expect(s).toContain("Micro-lote");
    expect(s).toContain("R$ 89,00");
  });

  it("itens ilegíveis explicam o formato antigo em vez de parecerem lista vazia", async () => {
    responder({ order: pedido({ items: "isso não é json" }) });
    expect(await saida()).toContain("formato antigo");
  });

  it("o desconto aparece com sinal de menos, e só quando existe", async () => {
    responder({ order: pedido({ discount: "12.00", coupon_code: "CANASTRA10" }) });
    const s = await saida();
    expect(s).toContain("−R$ 12,00");
    expect(s).toContain("CANASTRA10");
  });

  it("sem desconto, a linha não é desenhada", async () => {
    expect(await saida()).not.toContain("Desconto");
  });
});

describe("o bloco do Bling, dentro do detalhe", () => {
  /** É AQUI que o gestor está quando percebe que a nota não saiu — mandá-lo
   *  trocar de tela seria transformar um clique numa busca. */
  it("aparece no detalhe, com o estado do documento fiscal", async () => {
    const s = await saida();
    expect(s).toContain("Bling (ERP e NF-e)");
    expect(s).toContain("Não sincronizado");
  });

  it("nota gerada e não transmitida ganha a instrução que resolve o caso", async () => {
    responder({ order: pedido({ nfe_numero: "1234" }) });
    const s = await saida();
    expect(s).toContain("NF-e 1234 não transmitida");
    expect(s).toContain("não chegou à SEFAZ");
  });

  it("com nfe_url, oferece o DANFE pelo número da nota", async () => {
    responder({
      order: pedido({ nfe_numero: "1234", nfe_chave: "3526...", nfe_url: "https://bling/danfe" }),
    });
    expect(await saida()).toContain("Abrir DANFE da NF-e 1234");
  });

  /** Desligada não é erro, é o estado de fábrica: a caixa é de aviso e diz qual
   *  variável liga. */
  it("integração desligada explica a variável, sem tom de erro", async () => {
    const s = await saida();
    expect(s).toContain("BLING_ATIVO");
    expect(s).toContain("docs/bling.md");
  });
});

describe("as duas recusas que o backend distingue", () => {
  /**
   * "Identificador de pedido inválido." (400, id truncado no copiar e colar) e
   * "Pedido não encontrado." (404) são frases diferentes de propósito — e essa
   * distinção só existe na rota ADMIN, porque em `/my-orders/:id` tudo responde
   * 404 para não confirmar a existência de pedido alheio.
   */
  it("id malformado mostra a frase do servidor, não um genérico", async () => {
    responder({ erro: "Identificador de pedido inválido." });
    const s = await saida("abc");
    expect(s).toContain("Identificador de pedido inválido.");
  });

  it("pedido inexistente mostra a frase do servidor", async () => {
    responder({ erro: "Pedido não encontrado." });
    expect(await saida()).toContain("Pedido não encontrado.");
  });

  /** Mesmo no erro, o caminho de volta continua na tela. */
  it("o link para a lista sobrevive ao erro", async () => {
    responder({ erro: "Pedido não encontrado." });
    expect(await saida()).toContain('href="/dashboard/pedidos"');
  });

  /** 200 com corpo sem `order` (proxy no meio, contrato mudado) não pode virar
   *  uma ficha em branco que parece um pedido vazio. */
  it("resposta sem o pedido dentro vira erro, não ficha vazia", async () => {
    responder({ order: null });
    expect(await saida()).toContain("A API respondeu sem o pedido");
  });
});
