import { describe, it, expect, vi, beforeEach } from "vitest";
import { configure, screen } from "@testing-library/react";

import { renderizar } from "@/lib/teste/renderizar";

/** Espera folgada porque todo caso aqui é digitar/clicar → `useTransition` →
 *  asserção, e o `findBy*` desiste em 1 s. O porquê inteiro está em
 *  `administradores/PromoverAdministrador.test.tsx`. */
vi.setConfig({ testTimeout: 20_000 });
configure({ asyncUtilTimeout: 8_000 });

/**
 * O FORMULÁRIO DA LOJA — com DOM e com clique, porque é o que só existe depois
 * de um gesto.
 *
 * Este é o formulário que já desligou o frete grátis da loja inteira sem
 * ninguém pedir: `PUT /config` chega por multipart, campo vazio vale `''`,
 * `Number('')` é `0`, a validação APROVAVA, e zero DESLIGA o frete grátis —
 * arrastado por qualquer outro campo que estivesse sendo salvo junto. As
 * defesas que se conferem aqui são as que só aparecem em execução:
 *
 *   · a SAVE BAR só acende com alteração pendente (R5) e some ao salvar;
 *   · o submit é ATÔMICO: frete inválido não deixa nem o título subir;
 *   · o zero é AVISADO antes de salvar, e o aviso é alerta e não erro — zero é
 *     legítimo, o que não pode é acontecer por descuido;
 *   · o campo em branco não vira zero em lugar nenhum do caminho.
 *
 * `renderToStaticMarkup` não executaria nenhum destes: o `useState` do
 * formulário nunca sairia do valor inicial.
 */

const salvarLoja = vi.fn();

vi.mock("./acoes", () => ({
  salvarLoja: (...args: unknown[]) => salvarLoja(...args),
  adicionarOpcao: async () => ({ ok: true, frase: "" }),
  excluirOpcao: async () => ({ ok: true, frase: "" }),
}));

const { FormularioDaLoja } = await import("./FormularioDaLoja");

const CONFIG = {
  site_title: "Café Canastra",
  whatsapp_number: "5537999990000",
  frete_gratis_minimo_centavos: 14900,
};

function montar(config: Record<string, unknown> | null = CONFIG) {
  return renderizar(<FormularioDaLoja config={config} />);
}

function campoDoFrete() {
  return screen.getByLabelText(/Piso do frete grátis/) as HTMLInputElement;
}

beforeEach(() => {
  salvarLoja.mockReset();
  salvarLoja.mockResolvedValue({ ok: true, frase: "Configurações atualizadas!" });
});

/* ========================================================================== */

describe("a save bar — R5", () => {
  it("não existe enquanto nada foi tocado", () => {
    montar();
    expect(screen.queryByRole("button", { name: "Salvar" })).toBeNull();
    expect(screen.queryByText("Há alterações não salvas.")).toBeNull();
  });

  it("acende na primeira alteração", async () => {
    const { usuario } = montar();
    await usuario.type(screen.getByLabelText(/Título do site/), "!");

    expect(screen.getByText("Há alterações não salvas.")).toBeDefined();
    expect(screen.getByRole("button", { name: "Salvar" })).toBeDefined();
  });

  it("Descartar devolve o valor do servidor e apaga a barra", async () => {
    const { usuario } = montar();
    const titulo = screen.getByLabelText(/Título do site/) as HTMLInputElement;

    await usuario.clear(titulo);
    await usuario.type(titulo, "Outro nome");
    await usuario.click(screen.getByRole("button", { name: "Descartar" }));

    expect(titulo.value).toBe("Café Canastra");
    expect(screen.queryByRole("button", { name: "Salvar" })).toBeNull();
  });

  it("Descartar vem ANTES de Salvar, e é o de menor peso", async () => {
    const { usuario } = montar();
    await usuario.type(screen.getByLabelText(/Título do site/), "!");

    const descartar = screen.getByRole("button", { name: "Descartar" });
    const salvar = screen.getByRole("button", { name: "Salvar" });
    expect(
      descartar.compareDocumentPosition(salvar) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(descartar.className).toContain("border-fuligem-20");
    expect(salvar.className).toContain("bg-fuligem");
  });
});

describe("o campo de frete grátis", () => {
  it("chega em REAIS, e não em centavos", () => {
    montar();
    expect(campoDoFrete().value).toBe("149,00");
  });

  /**
   * O defeito inteiro: campo em branco NÃO é zero. O corpo omite o campo, e o
   * `PUT` parcial deixa o valor de hoje como está.
   */
  it("apagar o campo NÃO manda zero — manda o campo de menos", async () => {
    const { usuario } = montar();
    await usuario.clear(campoDoFrete());
    await usuario.click(screen.getByRole("button", { name: "Salvar" }));

    expect(salvarLoja).toHaveBeenCalledWith(
      expect.objectContaining({ freteGratisReais: "" }),
    );
  });

  /**
   * Zero é LEGÍTIMO — é como se desliga o frete grátis de propósito. O que não
   * pode é acontecer por descuido, que é como acontecia. Alerta e não erro: R21
   * reserva o vermelho a erro e ação destrutiva.
   */
  it("digitar zero avisa em voz alta ANTES de salvar", async () => {
    const { usuario } = montar();
    await usuario.clear(campoDoFrete());
    await usuario.type(campoDoFrete(), "0");

    const aviso = screen.getByText(/DESLIGA o frete grátis da loja inteira/);
    expect(aviso).toBeDefined();
    // A tarja de alerta, não a de erro.
    expect(aviso.closest("div")?.className).toContain("border-alerta");
  });

  it("mas deixa salvar o zero — desligar de propósito é um caminho", async () => {
    const { usuario } = montar();
    await usuario.clear(campoDoFrete());
    await usuario.type(campoDoFrete(), "0");
    await usuario.click(screen.getByRole("button", { name: "Salvar" }));

    expect(salvarLoja).toHaveBeenCalledWith(
      expect.objectContaining({ freteGratisReais: "0" }),
    );
  });
});

describe("o submit é ATÔMICO", () => {
  /**
   * O item do checklist de paridade: valor de frete inválido aborta o submit
   * INTEIRO. Um salvamento parcial deixaria o gestor com metade do formulário
   * gravado e nenhuma pista de qual metade — ele releria a tela, veria o título
   * novo e concluiria que o frete também foi.
   */
  it("frete inválido não deixa nem o título subir", async () => {
    const { usuario } = montar();
    await usuario.type(screen.getByLabelText(/Título do site/), " novo");
    await usuario.clear(campoDoFrete());
    await usuario.type(campoDoFrete(), "14900reais");
    await usuario.click(screen.getByRole("button", { name: "Salvar" }));

    expect(salvarLoja).not.toHaveBeenCalled();
  });

  /**
   * A reclamação do campo espera o primeiro blur — é o contrato do <Campo>
   * desta casa, e existe para "149," não virar erro no meio da digitação.
   */
  it("o campo só reclama depois que a pessoa sai dele", async () => {
    const { usuario } = montar();
    await usuario.clear(campoDoFrete());
    await usuario.type(campoDoFrete(), "abc");
    expect(screen.queryByText(/Use reais, com vírgula/)).toBeNull();

    await usuario.tab();
    expect(await screen.findByText(/Use reais, com vírgula/)).toBeDefined();
  });

  it("a frase de erro diz a UNIDADE e mostra o FORMATO", async () => {
    const { usuario } = montar();
    await usuario.clear(campoDoFrete());
    await usuario.type(campoDoFrete(), "abc");
    // Pelo submit, que é o caminho que alcança quem nunca saiu do campo.
    await usuario.click(screen.getByRole("button", { name: "Salvar" }));

    const erros = screen.getAllByText(/Use reais, com vírgula/);
    expect(erros.length).toBeGreaterThan(0);
    expect(erros[0].textContent).toContain("149,00");
    expect(erros[0].textContent).toContain("centavos");
  });
});

describe("o resultado", () => {
  /**
   * R9 — banner persistente, nunca toast: um flash pode não ser anunciado pelo
   * leitor de tela, some na ampliação e não pode ser relido. Numa tela que se
   * abre uma vez por mês, "não vi a mensagem" é "não sei se salvei".
   */
  it("no sucesso, a frase do servidor fica na tela e a barra some", async () => {
    salvarLoja.mockResolvedValue({ ok: true, frase: "Configurações atualizadas!" });
    const { usuario } = montar();
    await usuario.type(screen.getByLabelText(/Título do site/), "!");
    await usuario.click(screen.getByRole("button", { name: "Salvar" }));

    expect(await screen.findByText("Configurações atualizadas!")).toBeDefined();
    /* A pergunta é sobre a BARRA, e não sobre o botão: enquanto a transição
       corre o botão diz "Salvando…", e procurá-lo por "Salvar" daria `null`
       também aí — o teste passaria pelo motivo errado. */
    expect(screen.queryByText("Há alterações não salvas.")).toBeNull();
  });

  /**
   * A frase do servidor É o diagnóstico. "frete_gratis_minimo_centavos precisa
   * ser um inteiro em centavos…" diz o que consertar; "Erro ao salvar"
   * transforma um problema de dois minutos num chamado.
   */
  it("no erro, a frase do servidor chega inteira e a barra CONTINUA acesa", async () => {
    salvarLoja.mockResolvedValue({
      ok: false,
      erro:
        "frete_gratis_minimo_centavos precisa ser um inteiro em centavos, zero ou maior (zero desliga o frete grátis).",
    });
    const { usuario } = montar();
    await usuario.type(screen.getByLabelText(/Título do site/), "!");
    await usuario.click(screen.getByRole("button", { name: "Salvar" }));

    expect(
      await screen.findByText(/precisa ser um inteiro em centavos/),
    ).toBeDefined();
    // A barra fica: o trabalho não foi salvo, e sumir com ela seria perdê-lo.
    // `findByRole` porque o botão diz "Salvando…" até a transição terminar, e o
    // erro aparece antes disso.
    expect(await screen.findByRole("button", { name: "Salvar" })).toBeDefined();
  });
});

describe("o WhatsApp", () => {
  /**
   * A normalização é na SAÍDA, e não enquanto se digita: apagar a pontuação
   * debaixo do cursor é o jeito mais rápido de tornar um campo impossível de
   * corrigir. Quem converte é `montarPayloadDaLoja`, do lado do servidor.
   */
  it("aceita pontuação no campo, sem apagá-la debaixo do cursor", async () => {
    const { usuario } = montar();
    const campo = screen.getByLabelText(/WhatsApp da loja/) as HTMLInputElement;

    await usuario.clear(campo);
    await usuario.type(campo, "(37) 99999-0000");
    expect(campo.value).toBe("(37) 99999-0000");
  });
});

describe("sem config nenhuma", () => {
  it("nasce vazio — e o campo de frete NÃO nasce em '0,00'", () => {
    montar(null);
    expect(campoDoFrete().value).toBe("");
    expect(screen.queryByText(/DESLIGA o frete grátis/)).toBeNull();
  });
});
