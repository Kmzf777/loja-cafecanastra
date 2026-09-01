import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen } from "@testing-library/react";

import { renderizar } from "@/lib/teste/renderizar";
import type { AdministradorDaLista } from "@/lib/painel/administradores/administradores.logica";

/** Espera folgada porque todo caso aqui é clique → `useTransition` → asserção,
 *  e o `findBy*` desiste em 1 s. O porquê inteiro está em
 *  `PromoverAdministrador.test.tsx`. */

/**
 * A CONFIRMAÇÃO DA REMOÇÃO — R11/R12, com DOM e com clique.
 *
 * É a interface de maior consequência deste bloco: um clique tira de alguém o
 * acesso à loja, e um clique torto pode tirar o do próprio gestor. O que só
 * existe depois do gesto — e portanto não cabe em `renderToStaticMarkup` nem na
 * função pura — é:
 *
 *   · que o diálogo NOMEIE a pessoa e a consequência, e não pergunte "tem
 *     certeza?", que não carrega informação e treina a clicar em OK;
 *   · que remover a SI MESMO tenha texto próprio, porque a consequência é outra;
 *   · que o "Cancelar" fique ENTRE o resto da tela e o botão vermelho (R11);
 *   · que o erro do servidor apareça DENTRO do diálogo, com ele ainda aberto —
 *     é ali que o gestor está, e é a frase do último administrador que ele
 *     precisa ler.
 */

const removerAdministrador = vi.fn();

vi.mock("./acoes", () => ({
  removerAdministrador: (...args: unknown[]) => removerAdministrador(...args),
  promoverAdministrador: async () => ({ ok: true, frase: "" }),
  buscarCandidatos: async () => ({ ok: true, candidatos: [], todosJaSaoAdmin: false }),
}));

const { TabelaDeAdministradores } = await import("./TabelaDeAdministradores");

const EU = "dddddddd-0000-0000-0000-000000000001";

function admin(n: number, extras: Partial<AdministradorDaLista> = {}): AdministradorDaLista {
  return {
    user_id: `dddddddd-0000-0000-0000-00000000000${n}`,
    papel: "dono",
    criado_em: "2026-01-10T12:00:00.000Z",
    nome: `Gestor ${n}`,
    email: `gestor${n}@cafecanastra.com`,
    ...extras,
  };
}

function montar(linhas: AdministradorDaLista[], userIdDaSessao: string | null = EU) {
  return renderizar(
    <TabelaDeAdministradores linhas={linhas} userIdDaSessao={userIdDaSessao} />,
  );
}

beforeEach(() => {
  removerAdministrador.mockReset();
});

/* ========================================================================== */

describe("o diálogo de remoção — R11/R12", () => {
  it("nomeia a pessoa e diz que a conta de cliente CONTINUA", async () => {
    const { usuario } = montar([admin(1), admin(2)]);
    await usuario.click(screen.getAllByRole("button", { name: "Remover" })[1]);

    expect(await screen.findByText(/Gestor 2 vai perder o acesso ao painel/)).toBeDefined();
    expect(screen.getByText(/conta de cliente continua existindo/)).toBeDefined();
    expect(screen.getByText(/promover de novo/)).toBeDefined();
  });

  it("o botão nomeia o gesto — nunca um 'OK' nem um 'Sim'", async () => {
    const { usuario } = montar([admin(1), admin(2)]);
    await usuario.click(screen.getAllByRole("button", { name: "Remover" })[1]);

    expect(await screen.findByRole("button", { name: "Remover o acesso" })).toBeDefined();
    expect(screen.queryByRole("button", { name: "OK" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Sim" })).toBeNull();
  });

  /**
   * R11 — "destrutivo longe da confirmação", e aqui "longe" é literal: o
   * "Cancelar" fica ENTRE o resto da tela e o botão vermelho, de modo que o
   * clique por inércia caia no que não estraga nada.
   */
  it("o 'Cancelar' vem ANTES do botão destrutivo na ordem do documento", async () => {
    const { usuario } = montar([admin(1), admin(2)]);
    await usuario.click(screen.getAllByRole("button", { name: "Remover" })[1]);

    const cancelar = await screen.findByRole("button", { name: "Cancelar" });
    const confirmar = screen.getByRole("button", { name: "Remover o acesso" });
    expect(
      cancelar.compareDocumentPosition(confirmar) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("cancelar fecha sem chamar a ação", async () => {
    const { usuario } = montar([admin(1), admin(2)]);
    await usuario.click(screen.getAllByRole("button", { name: "Remover" })[1]);
    await usuario.click(await screen.findByRole("button", { name: "Cancelar" }));

    expect(removerAdministrador).not.toHaveBeenCalled();
  });
});

describe("remover a si mesmo", () => {
  /**
   * O backend permite quando há outro administrador, e é a porta de saída mais
   * rápida do painel: a tela de administradores é a única que promove, e depois
   * de sair dela ninguém a alcança. A consequência é outra, então o texto é
   * outro.
   */
  it("tem título, texto e botão próprios", async () => {
    const { usuario } = montar([admin(1), admin(2)]);
    await usuario.click(screen.getAllByRole("button", { name: "Remover" })[0]);

    expect(await screen.findByText("Remover o seu próprio acesso")).toBeDefined();
    expect(screen.getByText(/Você vai tirar de si mesmo \(Gestor 1\)/)).toBeDefined();
    expect(
      screen.getByRole("button", { name: "Remover o meu acesso" }),
    ).toBeDefined();
  });

  /**
   * Sessão sem uuid: melhor não avisar do que avisar a pessoa errada de que ela
   * está se removendo. Falha para o lado do texto genérico, que é verdadeiro
   * nos dois casos menos o alarme.
   */
  it("sem uuid na sessão, ninguém é 'você'", async () => {
    const { usuario } = montar([admin(1), admin(2)], null);
    await usuario.click(screen.getAllByRole("button", { name: "Remover" })[0]);

    expect(await screen.findByText("Remover administrador")).toBeDefined();
    expect(screen.queryByText("Remover o seu próprio acesso")).toBeNull();
  });
});

describe("o resultado da remoção", () => {
  /**
   * A frase do servidor é "Administrador removido.", que não distingue entre as
   * três linhas que estavam na tela — a tela nomeia quem saiu.
   */
  it("no sucesso, o banner nomeia quem saiu e o diálogo fecha", async () => {
    removerAdministrador.mockResolvedValue({ ok: true, frase: "Administrador removido." });
    const { usuario } = montar([admin(1), admin(2)]);

    await usuario.click(screen.getAllByRole("button", { name: "Remover" })[1]);
    await usuario.click(await screen.findByRole("button", { name: "Remover o acesso" }));

    expect(
      await screen.findByText("Gestor 2 não administra mais a loja."),
    ).toBeDefined();
    /*
      A pergunta é sobre o DIÁLOGO, e não sobre o botão. Procurar o botão pelo
      nome daria `null` também durante a transição (quando ele diz
      "Removendo…"), e o teste passaria pelo motivo errado — provando que o
      diálogo fechou justamente quando ele ainda está aberto.
    */
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  /**
   * O DIÁLOGO FICA ABERTO NO ERRO. Fechar jogaria a mensagem para trás de um
   * gesto que não aconteceu — e a mensagem é justamente a do último
   * administrador, quando outro gestor removeu um terceiro entre o carregamento
   * desta lista e este clique.
   */
  it("no erro, a frase do servidor aparece DENTRO do diálogo, que continua aberto", async () => {
    removerAdministrador.mockResolvedValue({
      ok: false,
      erro:
        "Esta é a única pessoa que administra a loja. Promova outro administrador antes de remover este.",
    });
    const { usuario } = montar([admin(1), admin(2)]);

    await usuario.click(screen.getAllByRole("button", { name: "Remover" })[1]);
    await usuario.click(await screen.findByRole("button", { name: "Remover o acesso" }));

    expect(await screen.findByText(/única pessoa que administra a loja/)).toBeDefined();
    /*
      `findByRole` E NÃO `getByRole`, e a diferença é real: enquanto a transição
      corre o botão diz "Removendo…", e o React descarrega o estado do erro
      antes de a transição terminar. Um `get` aqui media o instante entre as
      duas coisas — passava sozinho e falhava dentro da suíte cheia, que é o
      pior tipo de teste: o que depende da carga da máquina.
    */
    expect(
      await screen.findByRole("button", { name: "Remover o acesso" }),
    ).toBeDefined();
  });

  it("chama a ação com o uuid da linha escolhida, e não com o da primeira", async () => {
    removerAdministrador.mockResolvedValue({ ok: true, frase: "" });
    const linhas = [admin(1), admin(2)];
    const { usuario } = montar(linhas);

    await usuario.click(screen.getAllByRole("button", { name: "Remover" })[1]);
    await usuario.click(await screen.findByRole("button", { name: "Remover o acesso" }));

    expect(removerAdministrador).toHaveBeenCalledWith(linhas[1].user_id);
  });
});

describe("o último administrador", () => {
  /**
   * O aviso ocupa o LUGAR do botão. Um botão desabilitado sem explicação parece
   * defeito e não diz o que fazer; a frase diz a regra E o conserto.
   */
  it("com um só, não há botão de remover — há a razão", () => {
    montar([admin(1)]);
    expect(screen.queryByRole("button", { name: "Remover" })).toBeNull();
    expect(
      screen.getByText(/É a única pessoa que administra a loja/),
    ).toBeDefined();
  });
});
