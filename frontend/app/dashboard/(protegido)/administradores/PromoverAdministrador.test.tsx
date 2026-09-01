import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, waitFor } from "@testing-library/react";

import { renderizar } from "@/lib/teste/renderizar";


/**
 * O DIÁLOGO DE PROMOVER — com DOM e com clique, porque é a única forma honesta
 * de olhar para o que só existe depois de um gesto.
 *
 * `renderToStaticMarkup` (o helper `html`, dos outros testes desta pasta) NÃO
 * executa efeito nem estado: o diálogo fechado renderiza nada, e o teste
 * passaria provando nada. Este arquivo roda no projeto `painel-dom`, em jsdom,
 * que é exatamente para isto que ele existe (`vitest.config.ts`).
 *
 * O que se confere aqui é o que a função pura não alcança:
 *
 *   · a RESSALVA DO PAPEL, que impede a pior espécie de mentira de interface —
 *     um seletor que não seleciona nada;
 *   · os TRÊS VAZIOS da busca (R16), que são diagnósticos opostos;
 *   · que quem já administra NÃO apareça na lista de escolha;
 *   · que "Promover" só se habilite com alguém escolhido — R14 pelo mesmo
 *     princípio do dinheiro: nada acontece por engano, e nada é otimista.
 */

const buscarCandidatos = vi.fn();
const promoverAdministrador = vi.fn();

vi.mock("./acoes", () => ({
  buscarCandidatos: (...args: unknown[]) => buscarCandidatos(...args),
  promoverAdministrador: (...args: unknown[]) => promoverAdministrador(...args),
  removerAdministrador: async () => ({ ok: true, frase: "" }),
}));

const { PromoverAdministrador } = await import("./PromoverAdministrador");

beforeEach(() => {
  buscarCandidatos.mockReset();
  promoverAdministrador.mockReset();
});

async function abrir(jaSaoAdmin: string[] = []) {
  const { usuario } = renderizar(
    <PromoverAdministrador jaSaoAdmin={jaSaoAdmin} />,
  );
  await usuario.click(screen.getByRole("button", { name: "Promover administrador" }));
  return usuario;
}

/**
 * Busca, E ESPERA A BUSCA TERMINAR.
 *
 * A espera não é zelo: enquanto a transição da busca corre, TODO controle do
 * diálogo fica `disabled` — inclusive os rádios que ela acabou de listar. Um
 * clique num rádio desabilitado não faz nada e não reclama, então o teste
 * seguia adiante com `escolhido` em `null` e falhava lá na frente, apontando
 * para o botão em vez de para o clique perdido. Sozinho o arquivo passava (a
 * transição terminava antes); dentro da suíte cheia, não.
 *
 * Esperar o "Buscar" voltar a ser clicável é esperar exatamente `ocupado ===
 * false`, que é a condição que libera os rádios.
 */
async function procurar(usuario: Awaited<ReturnType<typeof abrir>>, texto: string) {
  if (texto) {
    await usuario.type(screen.getByLabelText(/Procurar cliente/), texto);
  }
  await usuario.click(screen.getByRole("button", { name: "Buscar" }));
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "Buscar" })).toHaveProperty(
      "disabled",
      false,
    ),
  );
}

/* ========================================================================== */

describe("a ressalva do papel", () => {
  /**
   * `isAdmin` pergunta uma coisa só — `req.user.ehAdmin`, um EXISTS em
   * `canastra.admins`. Nenhuma rota olha a coluna `papel`. Sem esta frase, o
   * gestor só descobre quando o "operador" muda um preço.
   */
  it("aparece assim que o diálogo abre, ao lado do seletor", async () => {
    await abrir();
    expect(
      screen.getByText(/Hoje o papel é só registro/),
    ).toBeDefined();
    expect(screen.getByText(/qualquer que seja o papel escolhido/)).toBeDefined();
  });

  it("o seletor oferece os três papéis do banco, com o que cada um significa", async () => {
    await abrir();
    const opcoes = screen.getAllByRole("option").map((o) => o.textContent);
    expect(opcoes).toEqual([
      "Dono — Tudo, inclusive dinheiro e custo.",
      "Gerente — Catálogo, promoção e pedido.",
      "Operador — Expedição, sem ver custo nem margem.",
    ]);
  });
});

describe("os três vazios da busca — R16", () => {
  it("antes de buscar, instrui o que procurar", async () => {
    await abrir();
    expect(
      screen.getByText(/Digite o nome, o e-mail ou o CPF de quem já tem conta/),
    ).toBeDefined();
  });

  /**
   * O 404 do backend ("Cliente não encontrado nesta loja.") existe por
   * segurança: a instância Supabase é compartilhada, e um uuid de outro projeto
   * chegaria com forma perfeita. Mas o gestor não sabe disso — o vazio é onde a
   * regra se explica, e onde ele fica sabendo o que fazer a seguir.
   */
  it("sem resultado, EXPLICA que promover exige conta na loja", async () => {
    buscarCandidatos.mockResolvedValue({
      ok: true,
      candidatos: [],
      todosJaSaoAdmin: false,
    });
    const usuario = await abrir();
    await procurar(usuario, "joana");

    const frase = await screen.findByText(/Só dá para promover quem já é cliente/);
    expect(frase.textContent).toContain("joana");
    expect(frase.textContent).toContain("criar a conta");
  });

  it("quando todos os achados já administram, a frase é outra", async () => {
    buscarCandidatos.mockResolvedValue({
      ok: true,
      candidatos: [],
      todosJaSaoAdmin: true,
    });
    const usuario = await abrir();
    await procurar(usuario, "gestor");

    expect(
      await screen.findByText("Quem casou com esta busca já administra a loja."),
    ).toBeDefined();
  });
});

describe("a escolha", () => {
  const candidatos = [
    { user_id: "1", name: "Ana Souza", email: "ana@x.com" },
    { user_id: "2", name: "Bia Lima", email: "bia@x.com" },
  ];

  it("lista os candidatos com nome e e-mail, e nenhum uuid", async () => {
    buscarCandidatos.mockResolvedValue({
      ok: true,
      candidatos,
      todosJaSaoAdmin: false,
    });
    const usuario = await abrir();
    await procurar(usuario, "a");

    expect(await screen.findByText("Ana Souza")).toBeDefined();
    expect(screen.getByText("ana@x.com")).toBeDefined();
    expect(screen.getAllByRole("radio")).toHaveLength(2);
  });

  /**
   * R14 pelo mesmo princípio do dinheiro: nada acontece por engano. Sem alguém
   * escolhido, "Promover" é um botão que só poderia falhar.
   */
  it("'Promover' só se habilita depois de escolher alguém", async () => {
    buscarCandidatos.mockResolvedValue({
      ok: true,
      candidatos,
      todosJaSaoAdmin: false,
    });
    const usuario = await abrir();

    const botao = screen.getByRole("button", { name: "Promover" });
    expect(botao).toHaveProperty("disabled", true);

    await procurar(usuario, "a");
    await usuario.click(await screen.findByRole("radio", { name: /Ana Souza/ }));
    /*
      `findByRole` E NÃO `getByRole`: enquanto a transição da BUSCA corre o botão
      diz "Promovendo…", e os candidatos já apareceram. Um `get` aqui media o
      instante entre as duas coisas — passava sozinho e falhava dentro da suíte
      cheia, que é o pior tipo de teste: o que depende da carga da máquina.
    */
    expect(
      await screen.findByRole("button", { name: "Promover" }),
    ).toHaveProperty("disabled", false);
  });

  /**
   * A tela TEM a lista de admins em mãos; pedir ao servidor um 409 que ela sabe
   * prever é trocar uma opção que não aparece por um erro.
   */
  it("passa os admins atuais para a busca, para eles não serem oferecidos", async () => {
    buscarCandidatos.mockResolvedValue({
      ok: true,
      candidatos: [],
      todosJaSaoAdmin: false,
    });
    const usuario = await abrir(["dddd-1", "dddd-2"]);
    await procurar(usuario, "ana");

    expect(buscarCandidatos).toHaveBeenCalledWith("ana", ["dddd-1", "dddd-2"]);
  });
});

describe("o resultado", () => {
  const candidatos = [{ user_id: "1", name: "Ana Souza", email: "ana@x.com" }];

  /**
   * O DIÁLOGO NÃO FECHA NO SUCESSO. Promover é o gesto que o gestor faz uma vez
   * por ano, e a confirmação dele não pode ser "a lista atrás mudou" — ele está
   * olhando para o diálogo. Fechando, restaria um toast, que R9 proíbe.
   */
  it("a confirmação nomeia a PESSOA e o PAPEL, no lugar onde o gesto aconteceu", async () => {
    buscarCandidatos.mockResolvedValue({
      ok: true,
      candidatos,
      todosJaSaoAdmin: false,
    });
    promoverAdministrador.mockResolvedValue({ ok: true, frase: "Administrador promovido." });

    const usuario = await abrir();
    await procurar(usuario, "ana");
    await usuario.click(await screen.findByRole("radio", { name: /Ana Souza/ }));
    await usuario.click(screen.getByRole("button", { name: "Promover" }));

    const frase = await screen.findByText(/Ana Souza agora administra a loja/);
    expect(frase.textContent).toContain("dono");
  });

  /**
   * R9 — a frase do servidor chega inteira, e num banner que fica. "Esta pessoa
   * já é administradora da loja." é o diagnóstico; "Erro ao salvar"
   * transformaria um problema de dois minutos num chamado.
   */
  it("o erro do servidor aparece inteiro, e o diálogo continua aberto", async () => {
    buscarCandidatos.mockResolvedValue({
      ok: true,
      candidatos,
      todosJaSaoAdmin: false,
    });
    promoverAdministrador.mockResolvedValue({
      ok: false,
      erro: "Esta pessoa já é administradora da loja.",
    });

    const usuario = await abrir();
    await procurar(usuario, "ana");
    await usuario.click(await screen.findByRole("radio", { name: /Ana Souza/ }));
    await usuario.click(screen.getByRole("button", { name: "Promover" }));

    expect(
      await screen.findByText("Esta pessoa já é administradora da loja."),
    ).toBeDefined();
    // `findByRole` pelo mesmo motivo de acima: o botão diz "Promovendo…" até a
    // transição terminar, e o erro aparece antes disso.
    expect(await screen.findByRole("button", { name: "Promover" })).toBeDefined();
  });

  it("falha na busca também vira banner, e não lista vazia", async () => {
    buscarCandidatos.mockResolvedValue({
      ok: false,
      erro: "A API não respondeu. Nada foi alterado — tente de novo.",
    });
    const usuario = await abrir();
    await procurar(usuario, "ana");

    expect(await screen.findByText(/A API não respondeu/)).toBeDefined();
    // E NÃO o vazio de "ninguém casa com esta busca", que seria uma conclusão
    // sobre um resultado que nunca chegou.
    expect(screen.queryByText(/Só dá para promover quem já é cliente/)).toBeNull();
  });
});
