import { describe, it, expect, vi, beforeEach } from "vitest";
import { configure, screen } from "@testing-library/react";

import { renderizar } from "@/lib/teste/renderizar";
import type { OpcaoDaLista } from "@/lib/painel/ajustes/ajustes.logica";

/** Espera folgada porque todo caso aqui é clique → `useTransition` → asserção,
 *  e o `findBy*` desiste em 1 s. O porquê inteiro está em
 *  `administradores/PromoverAdministrador.test.tsx`. */
vi.setConfig({ testTimeout: 20_000 });
configure({ asyncUtilTimeout: 8_000 });

/**
 * AS DUAS LISTAS DE OPÇÕES — e o que se confere aqui é sobretudo o que o painel
 * legado JOGAVA FORA.
 *
 * `ManageCategories.jsx` capturava a resposta de erro e mostrava "Erro ao
 * adicionar." no lugar de "Esta opção já existe." — que manda o gestor tentar
 * de novo exatamente a mesma coisa —, e no lugar do 409 de opção em uso, que
 * diz por que a exclusão não vale. As duas frases são o produto desta tela, e
 * elas só existem depois de um clique.
 */

const adicionarOpcao = vi.fn();
const excluirOpcao = vi.fn();

vi.mock("./acoes", () => ({
  adicionarOpcao: (...args: unknown[]) => adicionarOpcao(...args),
  excluirOpcao: (...args: unknown[]) => excluirOpcao(...args),
  salvarLoja: async () => ({ ok: true, frase: "" }),
}));

const { ListasDeOpcoes } = await import("./ListasDeOpcoes");

const OPCOES: OpcaoDaLista[] = [
  { id: "o1", type: "category", value: "Clássico" },
  { id: "o2", type: "category", value: "Micro-lote" },
  { id: "o3", type: "size", value: "250 g" },
];

function montar(emUso: string[] = ["Clássico"], podeMarcarUso = true) {
  return renderizar(
    <ListasDeOpcoes opcoes={OPCOES} emUso={emUso} podeMarcarUso={podeMarcarUso} />,
  );
}

beforeEach(() => {
  adicionarOpcao.mockReset();
  excluirOpcao.mockReset();
});

/* ========================================================================== */

describe("as duas listas", () => {
  it("são independentes, e o rótulo de 'size' é 'Embalagens'", () => {
    montar();
    expect(screen.getByRole("heading", { name: "Categorias" })).toBeDefined();
    expect(screen.getByRole("heading", { name: "Embalagens" })).toBeDefined();
    expect(screen.getByLabelText(/Nova categoria/)).toBeDefined();
    expect(screen.getByLabelText(/Nova embalagem/)).toBeDefined();
  });

  it("cada tipo manda o `type` do CONTRATO, não o rótulo", async () => {
    adicionarOpcao.mockResolvedValue({ ok: true, frase: "Opção adicionada com sucesso!" });
    const { usuario } = montar();

    await usuario.type(screen.getByLabelText(/Nova embalagem/), "1 kg");
    const botoes = screen.getAllByRole("button", { name: "Adicionar" });
    await usuario.click(botoes[botoes.length - 1]);

    expect(adicionarOpcao).toHaveBeenCalledWith("size", "1 kg");
  });
});

describe("acrescentar", () => {
  /**
   * O ponto exato em que o painel legado perdia a frase: "Esta opção já existe."
   * vira "Erro ao adicionar.", e o gestor tenta de novo a mesma coisa.
   */
  it("o 409 do servidor chega INTEIRO à tela", async () => {
    adicionarOpcao.mockResolvedValue({ ok: false, erro: "Esta opção já existe." });
    const { usuario } = montar();

    await usuario.type(screen.getByLabelText(/Nova categoria/), "Clássico");
    await usuario.click(screen.getAllByRole("button", { name: "Adicionar" })[0]);

    expect(await screen.findByText("Esta opção já existe.")).toBeDefined();
  });

  it("campo em branco não vira ida à rede", async () => {
    const { usuario } = montar();
    await usuario.click(screen.getAllByRole("button", { name: "Adicionar" })[0]);

    expect(adicionarOpcao).not.toHaveBeenCalled();
    expect(screen.getByText("Escreva o valor antes de adicionar.")).toBeDefined();
  });

  it("no sucesso, a confirmação nomeia o valor e o campo se esvazia", async () => {
    adicionarOpcao.mockResolvedValue({ ok: true, frase: "Opção adicionada." });
    const { usuario } = montar();
    const campo = screen.getByLabelText(/Nova categoria/) as HTMLInputElement;

    await usuario.type(campo, "Especial");
    await usuario.click(screen.getAllByRole("button", { name: "Adicionar" })[0]);

    expect(await screen.findByText('"Especial" foi acrescentado.')).toBeDefined();
    expect(campo.value).toBe("");
  });
});

describe("a marca de 'Em uso'", () => {
  /**
   * O 409 chega, mas descobrir pelo erro custa um clique e deixa a pergunta
   * seguinte sem resposta ("em uso por qual produto?"). Marcado antes, o gestor
   * nem tenta — e a frase carrega o conserto, não só a proibição.
   */
  it("tira o botão de excluir e põe a razão com o conserto", () => {
    montar(["Clássico"]);
    expect(screen.getByText(/troque a opção nesses produtos antes de excluir/)).toBeDefined();
    // A opção livre continua com botão: são duas categorias e uma embalagem,
    // e só "Clássico" está em uso.
    expect(screen.getAllByRole("button", { name: "Excluir" })).toHaveLength(2);
  });

  /**
   * Marca errada numa tela de exclusão é pior que marca nenhuma, porque convida
   * ao clique. Quando a leitura do catálogo não alcançou o catálogo inteiro, a
   * tela não marca e diz por quê.
   */
  it("quando não dá para confiar, não marca nada e explica", () => {
    montar(["Clássico"], false);
    expect(screen.getByText(/não marca quais opções estão em uso/)).toBeDefined();
    expect(screen.getAllByRole("button", { name: "Excluir" })).toHaveLength(3);
  });
});

describe("excluir — R11/R12", () => {
  it("a confirmação nomeia a OPÇÃO e a consequência real", async () => {
    const { usuario } = montar([]);
    await usuario.click(screen.getAllByRole("button", { name: "Excluir" })[0]);

    const texto = await screen.findByText(/A opção "Clássico" sai da loja/);
    expect(texto.textContent).toContain("Nenhum produto é apagado");
    expect(texto.textContent).toContain("MESMA grafia");
  });

  it("o 'Cancelar' vem ANTES do botão destrutivo (R11)", async () => {
    const { usuario } = montar([]);
    await usuario.click(screen.getAllByRole("button", { name: "Excluir" })[0]);

    const cancelar = await screen.findByRole("button", { name: "Cancelar" });
    const confirmar = screen.getByRole("button", { name: "Excluir a opção" });
    expect(
      cancelar.compareDocumentPosition(confirmar) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("chama a ação com o id da opção escolhida", async () => {
    excluirOpcao.mockResolvedValue({ ok: true, frase: "Opção excluída." });
    const { usuario } = montar([]);

    await usuario.click(screen.getAllByRole("button", { name: "Excluir" })[1]);
    await usuario.click(await screen.findByRole("button", { name: "Excluir a opção" }));

    expect(excluirOpcao).toHaveBeenCalledWith("o2");
  });

  /**
   * O diálogo fica ABERTO no erro: é ali que o gestor está, e a frase que ele
   * precisa ler é a do 409 de opção em uso — que responde a pergunta que o
   * clique acabou de fazer.
   */
  it("no erro, a frase do servidor aparece dentro do diálogo, que continua aberto", async () => {
    excluirOpcao.mockResolvedValue({
      ok: false,
      erro: "Esta opção está em uso por algum produto.",
    });
    const { usuario } = montar([]);

    await usuario.click(screen.getAllByRole("button", { name: "Excluir" })[0]);
    await usuario.click(await screen.findByRole("button", { name: "Excluir a opção" }));

    expect(
      await screen.findByText("Esta opção está em uso por algum produto."),
    ).toBeDefined();
    /* `findByRole` e não `getByRole`: o botão diz "Excluindo…" enquanto a
       transição corre, e o React descarrega o estado do erro antes de a
       transição terminar. Um `get` aqui mediria o instante entre as duas
       coisas — passava sozinho e falhava dentro da suíte cheia. */
    expect(
      await screen.findByRole("button", { name: "Excluir a opção" }),
    ).toBeDefined();
  });

  it("no sucesso, o diálogo fecha e a confirmação nomeia o que saiu", async () => {
    excluirOpcao.mockResolvedValue({ ok: true, frase: "Opção excluída." });
    const { usuario } = montar([]);

    await usuario.click(screen.getAllByRole("button", { name: "Excluir" })[0]);
    await usuario.click(await screen.findByRole("button", { name: "Excluir a opção" }));

    expect(await screen.findByText('"Clássico" foi excluído.')).toBeDefined();
    /* A pergunta é sobre o DIÁLOGO: procurar o botão pelo nome daria `null`
       também durante a transição (quando ele diz "Excluindo…"), e o teste
       passaria pelo motivo errado. */
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
