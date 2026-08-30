import { describe, it, expect, vi, beforeEach } from "vitest";

import { renderizar } from "@/lib/teste/renderizar";
import type { ProdutoDoSeletor, RegraCompleta } from "@/lib/painel/descontos/contrato";
import {
  FORMULARIO_VAZIO,
  formularioDaRegra,
} from "@/lib/painel/descontos/formulario.logica";

/**
 * O QUE SÓ O DOM ALCANÇA nesta tela.
 *
 * A decisão inteira está em `lib/painel/descontos/` (130 casos, em node): a
 * derivação de vigência, a validação, o payload, a leitura da simulação. O que
 * não dá para testar sem navegador é COMPORTAMENTO — e nesta tela são quatro
 * comportamentos que custam dinheiro se regredirem:
 *
 *  1. O TOGGLE "LIGADA" NÃO É DESABILITADO POR CAUSA DA JANELA. É o defeito
 *     legado inteiro: o botão de reativar ficava `disabled` quando a data
 *     estava fora do intervalo, e como o load já tinha gravado `ativa = false`,
 *     a promoção virava inalcançável. Nenhum teste de função pura pega um
 *     atributo `disabled`.
 *
 *  2. `brinde` NÃO É ESCOLHÍVEL, e a opção continua VISÍVEL com o motivo. Uma
 *     opção que some faz o gestor concluir que a tela está incompleta; uma
 *     opção escolhível salva uma regra que fica inerte.
 *
 *  3. A BARRA DE SALVAR nasce com a alteração e morre com o descarte (R5), e
 *     descartar pede duas etapas.
 *
 *  4. O SIMULADOR NÃO CALCULA NADA SOZINHO: sem clicar em "Simular" não há
 *     número na tela, e o resultado MORRE quando o carrinho muda. Um resultado
 *     velho ao lado de um carrinho novo mente com autoridade.
 *
 * `renderToStaticMarkup` não serviria: ele não executa efeito nem evento, e um
 * teste escrito nele passaria provando nada.
 */

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: () => {}, replace: () => {}, refresh: () => {} }),
}));

const simularDesconto = vi.fn(async () => ({
  ok: true as const,
  dados: {
    ajustes: [
      {
        sequencia: 1,
        promocaoId: null,
        codigo: null,
        alvo: "item",
        alvoRef: "CAN-CLA-250",
        valorCentavos: 1200,
        rotulo: "Dez por cento no PIX",
      },
    ],
    totalCentavos: 1200,
    subtotalCentavos: 12000,
    freteFinalCentavos: null,
  },
}));

vi.mock("./acoes", () => ({
  criarDesconto: async () => ({ ok: false, erro: "não usado neste teste" }),
  salvarDesconto: async () => ({ ok: false, erro: "não usado neste teste" }),
  alternarDesconto: async () => ({ ok: false, erro: "não usado neste teste" }),
  arquivarDesconto: async () => ({ ok: false, erro: "não usado neste teste" }),
  desarquivarDesconto: async () => ({ ok: false, erro: "não usado neste teste" }),
  simularDesconto: (...args: unknown[]) =>
    (simularDesconto as unknown as (...a: unknown[]) => unknown)(...args),
}));

const { FormularioDeRegra } = await import("./FormularioDeRegra");

const PRODUTOS: ProdutoDoSeletor[] = [
  {
    product_id: "11111111-1111-4111-8111-111111111111",
    name: "Clássico 250g",
    sku: "CAN-CLA-250",
    category: "torrado",
    price: "60.00",
  },
];

function regraCompleta(parcial: Partial<RegraCompleta> = {}): RegraCompleta {
  return {
    id: "22222222-2222-4222-8222-222222222222",
    nome: "Black Friday 2026",
    metodo: "automatico",
    classe: "pedido",
    mecanica: "percentual",
    valor: "20",
    inicio_em: "2020-11-01T03:00:00Z",
    fim_em: "2020-11-30T03:00:00Z",
    habilitada: true,
    arquivada_em: null,
    limite_usos: null,
    usos: 3,
    descontado_centavos: 9000,
    codigos: [],
    descricao: null,
    teto_desconto_centavos: 3000,
    minimo_tipo: "nenhum",
    minimo_valor: null,
    prioridade: 0,
    exclusiva: false,
    grupo_exclusividade: null,
    meios_pagamento: null,
    limite_por_cliente: null,
    orcamento_centavos: null,
    escopo: [],
    faixas: [],
    frete: null,
    codigos_detalhe: [],
    ...parcial,
  };
}

const AGORA = new Date("2026-08-27T12:00:00Z").getTime();

function montarNova() {
  return renderizar(
    <FormularioDeRegra
      inicial={FORMULARIO_VAZIO}
      produtos={PRODUTOS}
      categorias={["torrado", "grão"]}
      agoraEmMs={AGORA}
    />,
  );
}

/**
 * Uma regra JÁ VÁLIDA, para os testes do simulador.
 *
 * Ele recusa simular enquanto a regra tem erro — um número calculado sobre uma
 * regra que o banco vai rejeitar é a saída mais perigosa que este componente
 * poderia ter. Os testes do simulador precisam, então, partir de uma regra que
 * passa na validação; é o que este helper monta.
 */
function montarValida() {
  return renderizar(
    <FormularioDeRegra
      inicial={{ ...FORMULARIO_VAZIO, nome: "Dez por cento", valor: "10" }}
      produtos={PRODUTOS}
      categorias={["torrado"]}
      agoraEmMs={AGORA}
    />,
  );
}

function montarExistente(parcial: Partial<RegraCompleta> = {}) {
  const regra = regraCompleta(parcial);
  return {
    regra,
    ...renderizar(
      <FormularioDeRegra
        inicial={formularioDaRegra(regra)}
        regra={regra}
        produtos={PRODUTOS}
        categorias={["torrado"]}
        agoraEmMs={AGORA}
      />,
    ),
  };
}

beforeEach(() => {
  simularDesconto.mockClear();
});

/* ========================================================================== *
 * 1. O defeito legado — o toggle que ficava travado
 * ========================================================================== */

describe("editar uma regra fora da janela — o defeito que tornava a promoção inalcançável", () => {
  it("a regra expirada mostra o selo “Expirada”, e é só um selo", () => {
    const { getByText } = montarExistente();
    expect(getByText("Expirada")).toBeTruthy();
  });

  it("o toggle “Ligada” NÃO é desabilitado pela janela — e continua marcado", async () => {
    const { usuario, getByRole, getByLabelText } = montarExistente();
    await usuario.click(getByRole("tab", { name: /Janela/ }));

    const toggle = getByLabelText("Ligada") as HTMLInputElement;
    // No painel legado, este é o controle que ficava `disabled` — pela mesma
    // regra de janela que já tinha gravado `ativa = false`.
    expect(toggle.disabled).toBe(false);
    expect(toggle.checked).toBe(true);
  });

  it("as datas continuam editáveis — corrigi-las é o gesto que a trava impedia", async () => {
    const { usuario, getByRole, getByLabelText } = montarExistente();
    await usuario.click(getByRole("tab", { name: /Janela/ }));

    const fim = getByLabelText(/Termina em/) as HTMLInputElement;
    expect(fim.disabled).toBe(false);
    expect(fim.value).not.toBe("");
  });
});

/* ========================================================================== *
 * 2. A trava do brinde
 * ========================================================================== */

describe("o brinde aparece e não se escolhe", () => {
  it("a opção continua na lista, marcada como indisponível", async () => {
    const { usuario, getByRole } = montarNova();
    await usuario.click(getByRole("tab", { name: /Quanto/ }));

    const opcao = getByRole("option", { name: /Brinde/ }) as HTMLOptionElement;
    expect(opcao.disabled).toBe(true);
  });

  it("e a tela diz por que ela está indisponível", async () => {
    const { usuario, getByRole, getByText } = montarNova();
    await usuario.click(getByRole("tab", { name: /Quanto/ }));

    expect(getByText(/ainda não calcula ajuste para ela/)).toBeTruthy();
  });
});

/* ========================================================================== *
 * 3. A barra de salvar — R5 e R6
 * ========================================================================== */

describe("a barra de salvar é contextual — R5", () => {
  it("não existe antes da primeira alteração", () => {
    const { queryByRole } = montarNova();
    expect(queryByRole("button", { name: "Salvar" })).toBeNull();
  });

  it("nasce com a primeira tecla", async () => {
    const { usuario, getByLabelText, getByRole } = montarNova();
    await usuario.type(getByLabelText(/Nome da regra/), "PIX");
    expect(getByRole("button", { name: "Salvar" })).toBeTruthy();
  });

  it("descartar pede duas etapas, e a segunda desfaz a digitação", async () => {
    const { usuario, getByLabelText, getByRole, queryByRole } = montarNova();
    const nome = getByLabelText(/Nome da regra/) as HTMLInputElement;
    await usuario.type(nome, "PIX");

    await usuario.click(getByRole("button", { name: "Descartar" }));
    // Um clique errado num "Descartar" de uma etapa apaga meia hora de
    // digitação sem nada para desfazer.
    expect(getByRole("button", { name: "Continuar editando" })).toBeTruthy();

    await usuario.click(getByRole("button", { name: "Descartar mesmo" }));
    expect(nome.value).toBe("");
    expect(queryByRole("button", { name: "Salvar" })).toBeNull();
  });

  it("salvar com erro leva ao PASSO do erro, em vez de só dizer que ele existe", async () => {
    const { usuario, getByLabelText, getByRole } = montarNova();
    // Sai do passo 1 e suja o formulário por outro campo, para o erro do nome
    // ficar num passo que não está aberto.
    await usuario.click(getByRole("tab", { name: /Quanto/ }));
    await usuario.type(getByLabelText(/Desconto \(%\)/), "10");
    await usuario.click(getByRole("button", { name: "Salvar" }));

    expect(getByRole("tab", { name: /O que desconta/ }).getAttribute("aria-selected")).toBe(
      "true",
    );
    expect(getByRole("alert").textContent).toContain("nada foi salvo");
  });

  it("o passo com erro é marcado por glifo E por texto, nunca só por cor", async () => {
    const { usuario, getByLabelText, getByRole } = montarNova();
    await usuario.click(getByRole("tab", { name: /Quanto/ }));
    await usuario.type(getByLabelText(/Desconto \(%\)/), "10");
    await usuario.click(getByRole("button", { name: "Salvar" }));

    expect(getByRole("tab", { name: /O que desconta/ }).textContent).toContain("(com erro)");
  });
});

/* ========================================================================== *
 * 4. Os passos
 * ========================================================================== */

describe("os passos são abas de verdade", () => {
  it("são seis, e a de frete só aparece na classe frete", async () => {
    const { usuario, getAllByRole, getByLabelText } = montarNova();
    expect(getAllByRole("tab")).toHaveLength(6);

    await usuario.selectOptions(getByLabelText(/Onde o desconto incide/), "frete");
    expect(getAllByRole("tab")).toHaveLength(7);
  });

  it("as setas andam pelas abas — WAI-ARIA para tablist", async () => {
    const { usuario, getAllByRole, getByRole } = montarNova();
    const primeira = getAllByRole("tab")[0];
    primeira.focus();

    await usuario.keyboard("{ArrowRight}");
    expect(getByRole("tab", { name: /Quanto/ }).getAttribute("aria-selected")).toBe("true");

    await usuario.keyboard("{End}");
    expect(getByRole("tab", { name: /Janela/ }).getAttribute("aria-selected")).toBe("true");
  });

  it("trocar a classe com a aba de frete aberta não deixa a tela em branco", async () => {
    const { usuario, getByLabelText, getByRole } = montarNova();
    await usuario.selectOptions(getByLabelText(/Onde o desconto incide/), "frete");
    await usuario.click(getByRole("tab", { name: /Frete grátis/ }));

    await usuario.click(getByRole("tab", { name: /O que desconta/ }));
    await usuario.selectOptions(getByLabelText(/Onde o desconto incide/), "produto");

    expect(getByRole("tabpanel")).toBeTruthy();
  });
});

/* ========================================================================== *
 * 5. Os avisos que não deixam o silêncio voltar
 * ========================================================================== */

describe("os avisos", () => {
  it("a regra nova avisa, no passo Janela, que sem data ela vale SEMPRE", async () => {
    const { usuario, getByRole, getByText } = montarNova();
    await usuario.click(getByRole("tab", { name: /Janela/ }));
    expect(getByText(/vale SEMPRE/)).toBeTruthy();
  });

  it("os alertas dos OUTROS passos ficam visíveis fora deles, e levam até lá", async () => {
    const { usuario, getByRole, getByText } = montarNova();
    // O passo aberto é o 1; o alerta do teto vive no passo 2.
    const atalho = getByText(/20% numa compra de R\$/);
    await usuario.click(atalho);
    expect(getByRole("tab", { name: /Quanto/ }).getAttribute("aria-selected")).toBe("true");
  });

  it("o alerta do teto some quando o teto é preenchido", async () => {
    const { usuario, getByRole, getByLabelText, queryByText } = montarExistente();
    await usuario.click(getByRole("tab", { name: /Quanto/ }));
    // A regra de exemplo já tem teto de R$ 30.
    expect(queryByText(/20% numa compra de R\$/)).toBeNull();

    await usuario.clear(getByLabelText(/Teto do desconto/));
    expect(queryByText(/20% numa compra de R\$/)).not.toBeNull();
  });
});

/* ========================================================================== *
 * 6. O simulador
 * ========================================================================== */

describe("o simulador chama o motor, e não calcula nada por conta própria", () => {
  it("não mostra resultado nenhum antes de alguém clicar em Simular", () => {
    const { queryByText } = montarValida();
    expect(queryByText(/esta regra desconta/)).toBeNull();
    expect(simularDesconto).not.toHaveBeenCalled();
  });

  it("clicar em Simular manda a regra e o carrinho ao servidor", async () => {
    const { usuario, getByRole, getByLabelText, getAllByLabelText } = montarValida();

    await usuario.selectOptions(getByLabelText("Produto"), PRODUTOS[0].product_id);
    const qtd = getAllByLabelText("Qtd.")[0];
    await usuario.clear(qtd);
    await usuario.type(qtd, "2");
    await usuario.click(getByRole("button", { name: "Simular" }));

    expect(simularDesconto).toHaveBeenCalledTimes(1);
    const [, carrinho] = simularDesconto.mock.calls[0] as unknown as [
      unknown,
      { itens: { precoCentavos: number; quantidade: number }[] },
    ];
    // Centavos inteiros, como `calcularDescontos` documenta.
    expect(carrinho.itens[0]).toMatchObject({ precoCentavos: 6000, quantidade: 2 });
  });

  it("a frase que volta é a do motor, com o carrinho dentro", async () => {
    const { usuario, getByRole, getByLabelText, findByText } = montarValida();
    await usuario.selectOptions(getByLabelText("Produto"), PRODUTOS[0].product_id);
    await usuario.click(getByRole("button", { name: "Simular" }));

    expect(await findByText(/esta regra desconta/)).toBeTruthy();
  });

  it("mudar o carrinho MATA o resultado — um número velho mente com autoridade", async () => {
    const { usuario, getByRole, getByLabelText, getAllByLabelText, findByText, queryByText } =
      montarValida();

    await usuario.selectOptions(getByLabelText("Produto"), PRODUTOS[0].product_id);
    await usuario.click(getByRole("button", { name: "Simular" }));
    expect(await findByText(/esta regra desconta/)).toBeTruthy();

    await usuario.type(getAllByLabelText("Qtd.")[0], "0");
    expect(queryByText(/esta regra desconta/)).toBeNull();
  });

  it("carrinho vazio não vai ao servidor, e a tela diz que a simulação não foi feita", async () => {
    const { usuario, getByRole, getAllByRole } = montarValida();
    await usuario.click(getByRole("button", { name: "Simular" }));

    expect(simularDesconto).not.toHaveBeenCalled();
    const alertas = getAllByRole("alert").map((n) => n.textContent ?? "");
    expect(alertas.some((t) => t.includes("a simulação não foi feita"))).toBe(true);
  });

  it("regra inválida NÃO é simulada — um número sobre uma regra que o banco recusa é pior que nenhum", async () => {
    // A regra nova nasce sem nome e sem valor: dois erros.
    const { usuario, getByRole, getByLabelText, getAllByRole } = montarNova();
    await usuario.selectOptions(getByLabelText("Produto"), PRODUTOS[0].product_id);
    await usuario.click(getByRole("button", { name: "Simular" }));

    expect(simularDesconto).not.toHaveBeenCalled();
    const alertas = getAllByRole("alert").map((n) => n.textContent ?? "");
    expect(alertas.some((t) => t.includes("campos a corrigir nos passos acima"))).toBe(true);
  });
});

/* ========================================================================== *
 * 7. Arquivar — R11/R12/R13
 * ========================================================================== */

describe("arquivar nomeia o objeto e a consequência — R11/R12", () => {
  it("não existe botão “Excluir” em lugar nenhum da tela", () => {
    const { queryByRole } = montarExistente();
    expect(queryByRole("button", { name: /Excluir/i })).toBeNull();
    expect(queryByRole("button", { name: /Apagar/i })).toBeNull();
  });

  it("a confirmação diz o nome da regra e o que acontece com o histórico", async () => {
    const { usuario, getAllByRole, getByRole } = montarExistente();
    await usuario.click(getAllByRole("button", { name: "Arquivar" })[0]);

    const dialogo = getByRole("dialog");
    expect(dialogo.textContent).toContain("Black Friday 2026");
    expect(dialogo.textContent).toContain("continuam no histórico");
  });

  it("a regra já arquivada oferece desarquivar, e não arquivar de novo", () => {
    const { queryByRole, getAllByRole } = montarExistente({
      arquivada_em: "2026-08-01T00:00:00Z",
    });
    expect(queryByRole("button", { name: "Arquivar" })).toBeNull();
    expect(getAllByRole("button", { name: "Desarquivar" }).length).toBeGreaterThan(0);
  });
});
