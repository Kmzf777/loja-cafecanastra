import { describe, it, expect, vi, beforeEach } from "vitest";
import { act } from "react";

import { renderizar } from "@/lib/teste/renderizar";
import type {
  EstadoDosPedidos,
  PedidoDoPainel,
} from "@/lib/painel/pedidos/pedidos.logica";

/**
 * O QUE SÓ O DOM ALCANÇA nesta tela — e é por isso que o projeto `painel-dom`
 * existe.
 *
 * A decisão está toda em `pedidos.logica.ts` (87 casos, em node). O que não dá
 * para testar sem navegador é COMPORTAMENTO: o painel lateral que abre sem
 * cobrir a lista, o próximo/anterior, o Escape devolvendo o foco a quem abriu,
 * a seleção que diz quantos são desta página e quantos são do filtro — e, a
 * mais importante de todas, a TRAVA DE DUPLO CLIQUE DO BLING, que é um `useRef`
 * e cuja migração para `useState` reintroduziria a corrida sem nenhum sintoma
 * em teste manual.
 *
 * `renderToStaticMarkup` não serviria para nada disto: ele não executa efeito
 * nem evento, e um teste escrito nele passaria provando nada.
 */

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: () => {}, replace: () => {} }),
}));

const mudarStatusEmLote = vi.fn(async () => ({
  ok: true as const,
  frase: "2 de 2 pedidos atualizados.",
}));
vi.mock("./acoes", () => ({
  mudarStatusDoPedido: async () => ({ ok: true, frase: "Status atualizado." }),
  mudarStatusEmLote: (...args: unknown[]) =>
    (mudarStatusEmLote as unknown as (...a: unknown[]) => unknown)(...args),
}));

/** O transporte do navegador, que é por onde as ações do Bling saem. */
const chamarApi = vi.fn();
vi.mock("@/lib/painel/transporte", () => ({
  chamarApi: (...args: unknown[]) => chamarApi(...args),
  authFetch: vi.fn(),
  BASE_DA_API: "http://api.teste",
}));

const { ListaDePedidos } = await import("./ListaDePedidos");

const ESTADO: EstadoDosPedidos = {
  busca: "",
  status: [],
  de: "",
  ate: "",
  fila: "",
  pagina: 1,
};

function pedido(n: number, sobrepor: Partial<PedidoDoPainel> = {}): PedidoDoPainel {
  const id = `${n}${n}${n}${n}${n}${n}${n}${n}-1111-2222-3333-444455556666`;
  return {
    order_id: id,
    total_amount: "128.50",
    status: "aprovado",
    created_at: "2026-08-21T01:00:00.000Z",
    payment_method: "pix",
    items: [{ name: "Clássico 250g", quantity: 2, price: "59.00" }],
    address: { street: "Rua das Flores", number: "12", city: "Piumhi", state: "MG" },
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
    user_name: `Cliente ${n}`,
    user_email: `cliente${n}@exemplo.com`,
    user_cpf: "52998224725",
    ...sobrepor,
  };
}

function montar(linhas = [pedido(1), pedido(2), pedido(3)], totalDoFiltro = 134) {
  return renderizar(
    <ListaDePedidos
      linhas={linhas}
      estado={ESTADO}
      totalDoFiltro={totalDoFiltro}
      totalPaginas={7}
      blingLigado={true}
    />,
  );
}

beforeEach(() => {
  chamarApi.mockReset();
  mudarStatusEmLote.mockClear();
});

describe("o painel lateral — R26", () => {
  it("abre pelo clique na linha, sem sair da página", async () => {
    const { usuario, getByRole, queryByRole } = montar();
    expect(queryByRole("complementary")).toBeNull();

    await usuario.click(getByRole("link", { name: /#11111111/ }));

    expect(getByRole("complementary", { name: /Detalhe do pedido/ })).toBeTruthy();
  });

  /**
   * O PONTO DO R26: ele NÃO é modal. A lista continua na árvore e operável —
   * é ela o dado de referência que a pessoa consulta enquanto decide.
   */
  it("não cobre a lista e não mente sobre isso ao leitor de tela", async () => {
    const { usuario, getByRole, container } = montar();
    await usuario.click(getByRole("link", { name: /#11111111/ }));

    expect(container.querySelector("table")).not.toBeNull();
    const painel = getByRole("complementary");
    expect(painel.getAttribute("aria-modal")).toBeNull();
    expect(painel.getAttribute("role")).toBe("complementary");
  });

  it("anda pela fila com próximo e anterior, sem voltar à lista", async () => {
    const { usuario, getByRole } = montar();
    await usuario.click(getByRole("link", { name: /#11111111/ }));

    await usuario.click(getByRole("button", { name: "Próximo pedido" }));
    expect(getByRole("complementary", { name: /2 de 3/ })).toBeTruthy();

    await usuario.click(getByRole("button", { name: "Pedido anterior" }));
    expect(getByRole("complementary", { name: /1 de 3/ })).toBeTruthy();
  });

  it("no primeiro e no último, o passo que não existe fica travado", async () => {
    const { usuario, getByRole } = montar();
    await usuario.click(getByRole("link", { name: /#11111111/ }));
    expect(getByRole("button", { name: "Pedido anterior" })).toHaveProperty(
      "disabled",
      true,
    );
    expect(getByRole("button", { name: "Próximo pedido" })).toHaveProperty(
      "disabled",
      false,
    );
  });

  /**
   * Sem a devolução do foco, quem navega por teclado volta ao topo do documento
   * a cada pedido conferido — e a triagem de doze cliques vira doze viagens de
   * Tab.
   */
  it("Escape fecha e devolve o foco a quem abriu", async () => {
    const { usuario, getByRole, queryByRole } = montar();
    const gatilho = getByRole("link", { name: /#11111111/ });
    await usuario.click(gatilho);

    await usuario.keyboard("{Escape}");

    expect(queryByRole("complementary")).toBeNull();
    expect(document.activeElement).toBe(gatilho);
  });

  it("o botão de fechar também devolve o foco", async () => {
    const { usuario, getByRole, queryByRole } = montar();
    const gatilho = getByRole("link", { name: /#22222222/ });
    await usuario.click(gatilho);
    await usuario.click(getByRole("button", { name: "Fechar o detalhe" }));

    expect(queryByRole("complementary")).toBeNull();
    expect(document.activeElement).toBe(gatilho);
  });

  it("o detalhe traz o UUID inteiro e o CPF, que a lista não mostra", async () => {
    const { usuario, getByRole } = montar();
    await usuario.click(getByRole("link", { name: /#11111111/ }));
    const painel = getByRole("complementary");

    expect(painel.textContent).toContain("11111111-1111-2222-3333-444455556666");
    expect(painel.textContent).toContain("52998224725");
    expect(painel.textContent).toContain("Rua das Flores, 12");
  });

  /** O deep-link continua existindo, e o painel diz por onde chegar nele. */
  it("oferece o endereço da rota própria", async () => {
    const { usuario, getByRole } = montar();
    await usuario.click(getByRole("link", { name: /#11111111/ }));
    const link = getByRole("link", { name: /página própria/ });
    expect(link.getAttribute("href")).toBe(
      "/dashboard/pedidos/11111111-1111-2222-3333-444455556666",
    );
  });
});

describe("a seleção em massa — R25", () => {
  it("a caixa do cabeçalho marca os desta página", async () => {
    const { usuario, getByLabelText, getByRole } = montar();
    await usuario.click(getByLabelText(/Marcar os 3 pedidos desta página/));

    /**
     * A FRASE QUE O R25 EXIGE: ela nomeia os DOIS números e diz qual deles a
     * ação alcança. Sem ela o gestor acha que marcou 134 quando marcou 3.
     */
    const barra = getByRole("status");
    expect(barra.textContent).toContain("3");
    expect(barra.textContent).toContain("134");
    expect(barra.textContent).toContain("alcança só os 3");
  });

  it("seleção parcial fala da página, não do filtro", async () => {
    const { usuario, getByLabelText, getByRole } = montar();
    await usuario.click(getByLabelText(/Marcar o pedido #11111111/));
    expect(getByRole("status").textContent).toBe(
      "1 de 3 pedidos desta página marcados.",
    );
  });

  /**
   * NÃO HÁ "marcar os 134 do filtro", e a ausência é a decisão: não existe rota
   * de lote no backend, e oferecer a marcação para depois agir sobre três seria
   * exatamente a mentira que o R25 nomeia.
   */
  it("não oferece marcar os do filtro inteiro", async () => {
    const { usuario, getByLabelText, container } = montar();
    await usuario.click(getByLabelText(/Marcar os 3 pedidos desta página/));
    expect(container.textContent).not.toMatch(/marcar os 134|selecionar todos/i);
  });

  /**
   * Um lote gravaria o MESMO código de rastreio em vários pedidos, e cada
   * cliente receberia por e-mail o rastreio de outra pessoa.
   */
  it("'Enviado' não é oferecido em lote", async () => {
    const { usuario, getByLabelText, container } = montar();
    await usuario.click(getByLabelText(/Marcar os 3 pedidos desta página/));

    const opcoes = [...container.querySelectorAll("select option")].map(
      (o) => o.textContent,
    );
    expect(opcoes).toContain("Entregue");
    expect(opcoes).not.toContain("Enviado");
  });

  it("a confirmação nomeia o objeto e as consequências — R12", async () => {
    const { usuario, getByLabelText, getByRole, container } = montar();
    await usuario.click(getByLabelText(/Marcar os 3 pedidos desta página/));

    const select = container.querySelector("select")!;
    await usuario.selectOptions(select, "entregue");
    await usuario.click(getByRole("button", { name: "Aplicar" }));

    const dialogo = getByRole("dialog");
    expect(dialogo.textContent).toContain("3 pedidos");
    expect(dialogo.textContent).toContain("Entregue");
    expect(dialogo.textContent).toContain("estoque");
    expect(dialogo.textContent).toContain("e-mail");
    expect(dialogo.textContent).toContain("desfazer");
    // Nada foi enviado ainda: confirmar é um gesto à parte.
    expect(mudarStatusEmLote).not.toHaveBeenCalled();
  });

  it("cancelar a confirmação não muda nada", async () => {
    const { usuario, getByLabelText, getByRole, container } = montar();
    await usuario.click(getByLabelText(/Marcar os 3 pedidos desta página/));
    await usuario.selectOptions(container.querySelector("select")!, "entregue");
    await usuario.click(getByRole("button", { name: "Aplicar" }));
    await usuario.click(getByRole("button", { name: "Cancelar" }));

    expect(mudarStatusEmLote).not.toHaveBeenCalled();
  });

  it("confirmado, manda os ids marcados e o status escolhido", async () => {
    const { usuario, getByLabelText, getByRole, container } = montar();
    await usuario.click(getByLabelText(/Marcar o pedido #11111111/));
    await usuario.selectOptions(container.querySelector("select")!, "entregue");
    await usuario.click(getByRole("button", { name: "Aplicar" }));
    await usuario.click(getByRole("button", { name: /Mudar 1 pedido/ }));

    expect(mudarStatusEmLote).toHaveBeenCalledWith(
      ["11111111-1111-2222-3333-444455556666"],
      "entregue",
    );
  });
});

describe("a trava de duplo clique do Bling", () => {
  /**
   * ESTE É O TESTE QUE A PESQUISA PEDE, e ele só distingue as duas
   * implementações por causa do `act` em volta.
   *
   * `setState` é ASSÍNCRONO. Dentro de um único `act`, os dois cliques
   * acontecem ANTES de qualquer re-render: se a trava morasse no estado, o
   * segundo clique leria o mesmo `emAndamento` vazio do primeiro e dispararia
   * uma SEGUNDA requisição — e as três ações do Bling mexem na mesma linha do
   * banco. Com o `ref`, a escrita é imediata e o segundo clique desiste.
   *
   * A promessa que nunca resolve é o que mantém a primeira requisição "em voo"
   * durante o segundo clique, que é exatamente a condição da corrida.
   */
  it("dois cliques no mesmo tick viram UMA requisição", async () => {
    chamarApi.mockImplementation(() => new Promise(() => {}));

    const { usuario, getByRole } = montar();
    await usuario.click(getByRole("link", { name: /#11111111/ }));

    const sincronizar = getByRole("button", { name: "Sincronizar" });
    await act(async () => {
      sincronizar.click();
      sincronizar.click();
    });

    expect(chamarApi).toHaveBeenCalledTimes(1);
    expect(chamarApi).toHaveBeenCalledWith(
      "/bling/pedidos/11111111-1111-2222-3333-444455556666/sincronizar",
      "POST",
    );
  });

  /** Uma ação em voo tranca as TRÊS daquele pedido: elas mexem na mesma linha. */
  it("com uma ação em voo, as outras duas ficam travadas", async () => {
    chamarApi.mockImplementation(() => new Promise(() => {}));

    const { usuario, getByRole } = montar();
    await usuario.click(getByRole("link", { name: /#11111111/ }));
    await usuario.click(getByRole("button", { name: "Sincronizar" }));

    expect(getByRole("button", { name: "Sincronizando…" })).toHaveProperty(
      "disabled",
      true,
    );
    expect(getByRole("button", { name: "Emitir NF-e" })).toHaveProperty(
      "disabled",
      true,
    );
  });
});

describe("o bloco do Bling dentro do detalhe", () => {
  /** Buscar rastreio de um pedido que nunca foi ao Bling é uma ida garantida ao
   *  erro — `precisaDeSincronia` apaga o botão que não faria nada. */
  it("sem pedido de venda, 'Buscar rastreio' fica travado", async () => {
    const { usuario, getByRole } = montar();
    await usuario.click(getByRole("link", { name: /#11111111/ }));
    expect(getByRole("button", { name: "Buscar rastreio" })).toHaveProperty(
      "disabled",
      true,
    );
  });

  /**
   * A FRASE DO SERVIDOR É O DIAGNÓSTICO. "SKU tal não está cadastrado no Bling"
   * resolve o problema em dois minutos; "Erro ao sincronizar" abre um chamado.
   */
  it("a recusa do servidor chega inteira, numa tarja que não some sozinha", async () => {
    chamarApi.mockResolvedValue({
      ok: false,
      status: 400,
      json: async () => ({
        error: "BLING_SKU",
        message: "O SKU CAN-CLA-250 não está cadastrado no Bling.",
      }),
    });

    const { usuario, getByRole } = montar();
    await usuario.click(getByRole("link", { name: /#11111111/ }));
    await usuario.click(getByRole("button", { name: "Sincronizar" }));

    expect(getByRole("alert").textContent).toContain(
      "O SKU CAN-CLA-250 não está cadastrado no Bling.",
    );
  });

  /**
   * A LINHA SE ATUALIZA COM A RESPOSTA, campo a campo. `mesclarPedido` mantém a
   * lista congelada de nove campos: um spread apagaria `user_name` e
   * `user_cpf`, que a resposta de `/bling` NÃO traz.
   */
  it("a resposta atualiza a linha sem apagar os dados do cliente", async () => {
    chamarApi.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        message: "Pedido sincronizado com o Bling.",
        // A projeção de `/bling` — sem `user_name`, sem `user_cpf`.
        pedido: { bling_id: "77", bling_situacao: "em aberto" },
      }),
    });

    const { usuario, getByRole } = montar();
    await usuario.click(getByRole("link", { name: /#11111111/ }));
    await usuario.click(getByRole("button", { name: "Sincronizar" }));

    const painel = getByRole("complementary");
    expect(painel.textContent).toContain("Pedido 77");
    expect(painel.textContent).toContain("Cliente 1");
    expect(painel.textContent).toContain("52998224725");
  });

  /** Venda não confirmada não vira pedido de venda nem nota — e a tela explica
   *  em vez de mostrar três botões que respondem 409. */
  it("pedido não pago não ganha as três ações, e a tela diz por quê", async () => {
    const { usuario, getByRole, queryByRole } = montar([
      pedido(1, { status: "pendente" }),
    ]);
    await usuario.click(getByRole("link", { name: /#11111111/ }));

    expect(queryByRole("button", { name: "Sincronizar" })).toBeNull();
    expect(getByRole("complementary").textContent).toContain(
      "Só pedidos pagos (aprovado, enviado, entregue) vão ao ERP",
    );
  });
});
