import { describe, it, expect, vi, beforeEach } from "vitest";

import { renderizar } from "@/lib/teste/renderizar";
import type {
  EstadoDosProdutos,
  ProdutoDoPainel,
} from "@/lib/painel/produtos/produtos.logica";

/**
 * O QUE SÓ O DOM ALCANÇA na lista de Produtos.
 *
 * A decisão está toda em `produtos.logica.ts` (35 casos) e `lote.logica.ts`
 * (26), em node. O que não dá para testar sem navegador é COMPORTAMENTO — e
 * aqui há um comportamento que vale dinheiro:
 *
 *   **NÃO EXISTE CAMINHO DE APLICAR UM LOTE SEM VER O LOTE.** R6 diz que preço
 *   e estoque nunca vão com autosave, porque "uma vírgula errada publica R$
 *   5,90 no lugar de R$ 59,00". A defesa desta tela não é perguntar "tem
 *   certeza?" (R12: não carrega informação e treina a clicar em OK), é mostrar
 *   o `de → para` de cada linha antes de qualquer escrita. Um `renderToStatic-
 *   Markup` não abre diálogo, não digita e não clica: um teste escrito nele
 *   passaria provando nada.
 *
 * E o segundo: a frase do R25, que é a única defesa contra "achei que reajustei
 * 1.284 quando reajustei 20".
 */

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: () => {}, replace: () => {} }),
}));

const ajustarPrecoEmLote = vi.fn(async () => ({
  ok: true as const,
  frase: "2 produtos atualizados.",
}));
const ajustarEstoqueEmLote = vi.fn(async () => ({
  ok: true as const,
  frase: "2 produtos atualizados.",
}));
vi.mock("./acoes", () => ({
  ajustarPrecoEmLote: (...a: unknown[]) =>
    (ajustarPrecoEmLote as unknown as (...x: unknown[]) => unknown)(...a),
  ajustarEstoqueEmLote: (...a: unknown[]) =>
    (ajustarEstoqueEmLote as unknown as (...x: unknown[]) => unknown)(...a),
}));

const { ListaDeProdutos } = await import("./ListaDeProdutos");

const ESTADO: EstadoDosProdutos = {
  busca: "",
  categoria: "",
  embalagem: "",
  novidade: "",
  pagina: 1,
};

function produto(n: number, sobrepor: Partial<ProdutoDoPainel> = {}): ProdutoDoPainel {
  return {
    product_id: `3333333${n}-1111-4111-8111-111111111111`,
    sku: `classico-${n}`,
    name: `Café ${n}`,
    size: "250 g",
    category: "Especial",
    price: "100.00",
    image: null,
    timestamp: null,
    quantity: 10,
    description: null,
    weight: "1.200",
    width: "24.00",
    height: "9.00",
    length: "31.00",
    ...sobrepor,
  };
}

function montar(linhas = [produto(1), produto(2), produto(3)], totalDoFiltro = 1284) {
  return renderizar(
    <ListaDeProdutos
      linhas={linhas}
      estado={ESTADO}
      totalDoFiltro={totalDoFiltro}
      totalPaginas={65}
    />,
  );
}

beforeEach(() => {
  ajustarPrecoEmLote.mockClear();
  ajustarEstoqueEmLote.mockClear();
});

describe("a seleção em massa — R25", () => {
  it("a caixa do cabeçalho marca os desta página", async () => {
    const { usuario, getByRole, getByText } = montar();
    await usuario.click(getByRole("checkbox", { name: /Marcar os 3 produtos desta página/ }));
    expect(getByText(/3 produtos marcados nesta página de 3/)).toBeTruthy();
  });

  /**
   * A FRASE QUE O R25 EXISTE PARA EXIGIR. Os dois números aparecem juntos, e
   * está escrito que a ação vale só para os marcados — porque não há rota de
   * lote no backend, e oferecer "marcar os 1.284" para agir sobre 3 seria
   * exatamente a mentira que o R25 nomeia.
   */
  it("distingue os desta página dos do filtro, e diz o alcance da ação", async () => {
    const { usuario, getByRole, getByRole: papel } = montar();
    await usuario.click(papel("checkbox", { name: /Marcar Café 1/ }));
    const resumo = getByRole("status");
    expect(resumo.textContent).toContain("1 produto marcado nesta página de 3");
    expect(resumo.textContent).toContain("1284");
    expect(resumo.textContent).toContain("só para os marcados");
  });

  /**
   * O TERCEIRO ESTADO DA CAIXA não é uma prop do React: ele só existe como
   * propriedade do elemento. Sem ele, marcar um de três deixaria a caixa do
   * cabeçalho vazia, dizendo "nada marcado" com uma linha marcada na tela.
   */
  it("a caixa do cabeçalho fica indeterminada com seleção parcial", async () => {
    const { usuario, getByRole } = montar();
    await usuario.click(getByRole("checkbox", { name: /Marcar Café 1/ }));
    const cabecalho = getByRole("checkbox", {
      name: /Marcar os 3 produtos desta página/,
    }) as HTMLInputElement;
    expect(cabecalho.indeterminate).toBe(true);
    expect(cabecalho.checked).toBe(false);
  });

  /** O nome NOMEIA O OBJETO: "Selecionar" sozinho obriga quem não vê a tela a
   *  adivinhar qual das vinte linhas está sob o cursor. */
  it("cada caixa diz de qual café ela é", () => {
    const { getByRole } = montar();
    expect(getByRole("checkbox", { name: "Marcar Café 2" })).toBeTruthy();
  });

  it("sem nada marcado, a barra do lote não existe", () => {
    const { queryByRole } = montar();
    expect(queryByRole("button", { name: "Ajustar preço" })).toBeNull();
  });
});

/**
 * R6 — A PRÉVIA É A DEFESA, e estes são os testes que a sustentam.
 */
describe("o lote de preço", () => {
  async function abrirComDois() {
    const r = montar();
    await r.usuario.click(r.getByRole("checkbox", { name: "Marcar Café 1" }));
    await r.usuario.click(r.getByRole("checkbox", { name: "Marcar Café 2" }));
    await r.usuario.click(r.getByRole("button", { name: "Ajustar preço" }));
    return r;
  }

  it("sem número digitado, o botão de aplicar está travado e não há prévia", async () => {
    const { getByRole } = await abrirComDois();
    const aplicar = getByRole("button", { name: /Aplicar a 0 produtos/ });
    expect(aplicar).toHaveProperty("disabled", true);
  });

  it("mostra o de → para de cada linha antes de qualquer escrita", async () => {
    const { usuario, getByRole, getByLabelText } = await abrirComDois();
    await usuario.type(getByLabelText("Valor"), "-10");

    const dialogo = getByRole("dialog");
    expect(dialogo.textContent).toContain("Café 1");
    // 100,00 com -10% vira 90,00 — os dois números na mesma linha.
    expect(dialogo.textContent).toContain("R$\xa0100,00");
    expect(dialogo.textContent).toContain("R$\xa090,00");
    expect(ajustarPrecoEmLote).not.toHaveBeenCalled();
  });

  it("aplica só o que a prévia mostrou, e com os valores da prévia", async () => {
    const { usuario, getByRole, getByLabelText } = await abrirComDois();
    await usuario.type(getByLabelText("Valor"), "-10");
    await usuario.click(getByRole("button", { name: /Aplicar a 2 produtos/ }));

    expect(ajustarPrecoEmLote).toHaveBeenCalledTimes(1);
    const [ajustes] = ajustarPrecoEmLote.mock.calls[0] as unknown as [
      { id: string; valor: number }[],
    ];
    expect(ajustes.map((a) => a.valor)).toEqual([90, 90]);
  });

  /** Uma linha impossível não derruba o lote — o gestor não vai caçar qual é —,
   *  mas ela sai da conta e o motivo fica escrito na linha dela. */
  it("a linha que ficaria negativa sai do lote, com o motivo ao lado", async () => {
    const r = montar([produto(1, { price: "10.00" }), produto(2, { price: "100.00" })]);
    await r.usuario.click(r.getByRole("checkbox", { name: "Marcar Café 1" }));
    await r.usuario.click(r.getByRole("checkbox", { name: "Marcar Café 2" }));
    await r.usuario.click(r.getByRole("button", { name: "Ajustar preço" }));
    await r.usuario.click(r.getByRole("radio", { name: /Ajustar em R\$/ }));
    await r.usuario.type(r.getByLabelText("Valor"), "-50");

    expect(r.getByRole("dialog").textContent).toContain("Ficaria negativo.");
    expect(r.getByRole("button", { name: /Aplicar a 1 produto/ })).toBeTruthy();
  });

  /** R9 — o placar é uma tarja persistente, nunca um toast: é ele que diz quais
   *  produtos ficaram de fora, e ele precisa poder ser relido. */
  it("o placar do servidor vira tarja e não some sozinho", async () => {
    const { usuario, getByRole, getByLabelText, findByText } = await abrirComDois();
    await usuario.type(getByLabelText("Valor"), "-10");
    await usuario.click(getByRole("button", { name: /Aplicar a 2 produtos/ }));

    expect(await findByText("2 produtos atualizados.")).toBeTruthy();
  });

  /** R11 — o "Cancelar" fica entre o dedo e a confirmação, e cancelar não
   *  escreve nada. */
  it("cancelar fecha sem chamar a ação", async () => {
    const { usuario, getByRole, getByLabelText, queryByRole } = await abrirComDois();
    await usuario.type(getByLabelText("Valor"), "-10");
    await usuario.click(getByRole("button", { name: "Cancelar" }));

    expect(queryByRole("dialog")).toBeNull();
    expect(ajustarPrecoEmLote).not.toHaveBeenCalled();
  });
});

describe("o lote de estoque", () => {
  it("soma ao que já existe e mostra a conta antes", async () => {
    const r = montar();
    await r.usuario.click(r.getByRole("checkbox", { name: "Marcar Café 1" }));
    await r.usuario.click(r.getByRole("button", { name: "Ajustar estoque" }));
    await r.usuario.type(r.getByLabelText("Quantidade"), "5");

    expect(r.getByRole("dialog").textContent).toContain("15");
    await r.usuario.click(r.getByRole("button", { name: /Aplicar a 1 produto/ }));

    const [ajustes] = ajustarEstoqueEmLote.mock.calls[0] as unknown as [
      { id: string; valor: number }[],
    ];
    expect(ajustes).toEqual([
      { id: "33333331-1111-4111-8111-111111111111", valor: 15 },
    ]);
  });

  /** O piso em zero é o comportamento, não um erro — a mesma decisão do botão
   *  "−" do formulário legado, que travava em 0 em vez de recusar o clique. */
  it("subtrair mais do que existe trava em zero, sem recusar a linha", async () => {
    const r = montar([produto(1, { quantity: 3 })]);
    await r.usuario.click(r.getByRole("checkbox", { name: "Marcar Café 1" }));
    await r.usuario.click(r.getByRole("button", { name: "Ajustar estoque" }));
    await r.usuario.click(r.getByRole("radio", { name: /Saiu mercadoria/ }));
    await r.usuario.type(r.getByLabelText("Quantidade"), "5");

    expect(r.getByRole("button", { name: /Aplicar a 1 produto/ })).toHaveProperty(
      "disabled",
      false,
    );
  });
});

/**
 * A SELEÇÃO SE RENDE À LISTA. Quando `revalidatePath` traz dados novos, os
 * produtos marcados podem ter saído do filtro — e agir sobre uma seleção que se
 * refere a uma lista que já não existe é o defeito que o R25 inteiro combate.
 */
describe("a reconciliação com o servidor", () => {
  it("lista nova zera a seleção", async () => {
    const { usuario, getByRole, rerender, queryByRole } = montar();
    await usuario.click(getByRole("checkbox", { name: "Marcar Café 1" }));
    expect(getByRole("button", { name: "Ajustar preço" })).toBeTruthy();

    rerender(
      <ListaDeProdutos
        linhas={[produto(4), produto(5)]}
        estado={ESTADO}
        totalDoFiltro={1284}
        totalPaginas={65}
      />,
    );

    expect(queryByRole("button", { name: "Ajustar preço" })).toBeNull();
  });
});
