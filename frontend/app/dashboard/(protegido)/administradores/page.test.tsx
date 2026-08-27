import { describe, it, expect, vi, beforeEach } from "vitest";

import { html } from "@/lib/teste/html";
import type { RespostaDeAdministradores } from "@/lib/painel/administradores/administradores.logica";
import type { Leitura } from "@/lib/painel/api-servidor";

/**
 * A CASCA da tela de Administradores — só o que a função pura não alcança.
 *
 * A decisão inteira (quem é o último, quem é você, as frases da confirmação, o
 * filtro dos candidatos, os três vazios da busca) vive em
 * `administradores.logica.ts` e tem 37 casos lá. O que sobra para cá é o que só
 * existe quando o JSX é montado:
 *
 *   · a ORDEM DAS GUARDAS do <EstadoDaTela> — que a leitura falhada não vire
 *     "nenhum administrador cadastrado", que numa tela de acesso é a frase mais
 *     assustadora possível;
 *   · que o aviso do ÚLTIMO administrador apareça ANTES da tentativa, e que o
 *     botão de remover não exista nessa situação;
 *   · que a própria linha do gestor seja marcada como "Você";
 *   · que a tela diga a diferença entre remover o crachá e apagar a conta.
 */

const USUARIO = "11111111-1111-1111-1111-111111111111";

vi.mock("@/lib/conta/painel-servidor", () => ({
  lerAcessoDoPainel: async () => ({
    temSessao: true,
    ehAdmin: true,
    falhouConsulta: false,
    email: "gestao@cafecanastra.com",
    userId: USUARIO,
  }),
}));

/** As Server Actions são importadas pelas ilhas, e as de verdade puxam
 *  `next/cache`. Nenhum caso abaixo clica em nada. */
vi.mock("./acoes", () => ({
  promoverAdministrador: async () => ({ ok: true, frase: "" }),
  removerAdministrador: async () => ({ ok: true, frase: "" }),
  buscarCandidatos: async () => ({ ok: true, candidatos: [], todosJaSaoAdmin: false }),
}));

const lerDaApi = vi.fn();
vi.mock("@/lib/painel/api-servidor", () => ({
  lerDaApi: (...args: unknown[]) => lerDaApi(...args),
}));

const { default: PaginaDeAdministradores } = await import("./page");

function admin(n: number, extras: Record<string, unknown> = {}) {
  return {
    user_id: `dddddddd-0000-0000-0000-00000000000${n}`,
    papel: "dono",
    criado_em: "2026-01-10T12:00:00.000Z",
    nome: `Gestor ${n}`,
    email: `gestor${n}@cafecanastra.com`,
    ...extras,
  };
}

function respostaCom(
  data: ReturnType<typeof admin>[],
): Leitura<RespostaDeAdministradores> {
  return { ok: true, dados: { data } };
}

async function saida(): Promise<string> {
  return html(await PaginaDeAdministradores());
}

beforeEach(() => {
  lerDaApi.mockReset();
});

/* ========================================================================== */

describe("a leitura", () => {
  it("pede a lista de administradores, sem filtro nem página", async () => {
    lerDaApi.mockResolvedValue(respostaCom([admin(1)]));
    await saida();
    expect(lerDaApi).toHaveBeenCalledWith("/admin/administradores");
  });
});

describe("a ordem das guardas do EstadoDaTela", () => {
  /**
   * Numa tela de ACESSO, "nenhum administrador cadastrado" é a frase mais
   * assustadora que o painel pode desenhar — e por falha de rede ela seria
   * simplesmente falsa. O caminho de erro tem de mostrar a frase do servidor.
   */
  it("erro de leitura vira a frase do servidor, NUNCA 'nenhum administrador'", async () => {
    lerDaApi.mockResolvedValue({
      ok: false,
      erro: "A API não respondeu. Recarregue a página; nada foi alterado.",
    });
    const saidaHtml = await saida();
    expect(saidaHtml).toContain("A API não respondeu");
    expect(saidaHtml).not.toContain("Nenhum administrador cadastrado");
  });

  it("com erro, o aviso do último administrador também não aparece", async () => {
    lerDaApi.mockResolvedValue({ ok: false, erro: "A API não respondeu." });
    // Zero linhas por FALHA não é "só uma pessoa administra": seria um alarme
    // inventado a partir de uma lista que ninguém conseguiu ler.
    expect(await saida()).not.toContain("Só uma pessoa administra esta loja");
  });

  it("lista vazia medida tem texto próprio, que diz que isso não deveria acontecer", async () => {
    lerDaApi.mockResolvedValue(respostaCom([]));
    expect(await saida()).toContain("Nenhum administrador cadastrado");
  });
});

describe("o aviso do último administrador — ANTES da tentativa", () => {
  /**
   * O trigger `admins_nunca_zero` (0002) impede no banco e o repositório traduz
   * o 23001 numa frase decente. A tela avisa antes porque quem clicou em
   * "Remover" já decidiu remover — e porque o aviso carrega o CONSERTO, que o
   * erro não carregaria de forma acionável.
   */
  it("com um só, avisa e NÃO desenha o botão de remover", async () => {
    lerDaApi.mockResolvedValue(respostaCom([admin(1)]));
    const saidaHtml = await saida();

    expect(saidaHtml).toContain("Só uma pessoa administra esta loja");
    expect(saidaHtml).toContain("única pessoa que administra a loja");
    expect(saidaHtml).toContain("Promova outro administrador");
    expect(saidaHtml).not.toContain(">Remover<");
  });

  it("com dois, o aviso some e o botão aparece", async () => {
    lerDaApi.mockResolvedValue(respostaCom([admin(1), admin(2)]));
    const saidaHtml = await saida();

    expect(saidaHtml).not.toContain("Só uma pessoa administra esta loja");
    expect(saidaHtml).toContain(">Remover<");
  });

  /**
   * R21: um só administrador é um estado FRÁGIL da loja, não uma falha. Pintar
   * de vermelho a configuração normal de uma loja de uma pessoa só é como se
   * deixa de acreditar nos erros de verdade.
   */
  it("o aviso é alerta, não erro — vermelho é só erro e destruição", async () => {
    lerDaApi.mockResolvedValue(respostaCom([admin(1)]));
    const saidaHtml = await saida();
    const trecho = saidaHtml.slice(
      0,
      saidaHtml.indexOf("Só uma pessoa administra esta loja"),
    );
    // A tarja do aviso é a última aberta antes do texto; ela é de alerta.
    expect(trecho.lastIndexOf("border-alerta")).toBeGreaterThan(
      trecho.lastIndexOf("border-vermelho"),
    );
  });
});

describe("a lista", () => {
  it("mostra nome, e-mail, papel e a data em dd/mm/aaaa (R31)", async () => {
    lerDaApi.mockResolvedValue(
      respostaCom([
        admin(1, { criado_em: "2026-01-10T02:00:00.000Z" }),
        admin(2, { papel: "gerente" }),
      ]),
    );
    const saidaHtml = await saida();

    expect(saidaHtml).toContain("Gestor 1");
    expect(saidaHtml).toContain("gestor1@cafecanastra.com");
    expect(saidaHtml).toContain("Gerente");
    // 02:00 UTC do dia 10 é 23:00 do dia 9 em São Paulo.
    expect(saidaHtml).toContain("09/01/2026");
  });

  /**
   * R23 levado ao caso mais perigoso: numa tela de "quem pode mexer na loja", um
   * uuid obrigaria a cruzar identificador com pessoa na mão — que é exatamente
   * o gesto que ninguém faz antes de clicar em remover.
   */
  it("não imprime uuid em lugar nenhum da linha", async () => {
    const linha = admin(1);
    lerDaApi.mockResolvedValue(respostaCom([linha, admin(2)]));
    expect(await saida()).not.toContain(linha.user_id);
  });

  it("marca a própria linha do gestor com 'Você'", async () => {
    lerDaApi.mockResolvedValue(
      respostaCom([admin(1, { user_id: USUARIO }), admin(2)]),
    );
    expect(await saida()).toContain(">Você<");
  });

  it("sem nome no cadastro, cai para o e-mail — nunca célula vazia", async () => {
    lerDaApi.mockResolvedValue(
      respostaCom([admin(1, { nome: null }), admin(2)]),
    );
    expect(await saida()).toContain("gestor1@cafecanastra.com");
  });
});

describe("a ação primária", () => {
  it("fica no cabeçalho, no canto de sempre (R18)", async () => {
    lerDaApi.mockResolvedValue(respostaCom([admin(1)]));
    const saidaHtml = await saida();
    const promover = saidaHtml.indexOf("Promover administrador");
    const tabela = saidaHtml.indexOf("Quem administra a loja");
    expect(promover).toBeGreaterThan(-1);
    expect(promover).toBeLessThan(tabela);
  });
});

describe("o que a tela diz por escrito", () => {
  /**
   * A confusão que custa caro: "Remover" aqui e "Excluir" em Clientes parecem a
   * mesma coisa e são opostas. Uma tira o crachá; a outra apaga a pessoa com os
   * pedidos dela, e não tem volta.
   */
  it("distingue remover o acesso de apagar a conta", async () => {
    lerDaApi.mockResolvedValue(respostaCom([admin(1), admin(2)]));
    const saidaHtml = await saida();
    expect(saidaHtml).toContain("tira só o acesso ao painel");
    expect(saidaHtml).toContain("esse não tem volta");
  });

  it("explica por que administrador é linha no banco, e não marca no login", async () => {
    lerDaApi.mockResolvedValue(respostaCom([admin(1)]));
    const saidaHtml = await saida();
    expect(saidaHtml).toContain("canastra.admins");
    expect(saidaHtml).toContain("compartilhada");
  });

  /**
   * O DIÁLOGO NÃO ESTÁ NO HTML INICIAL, e é bom que não esteja: o `<Dialogo>`
   * desta casa só monta o portal quando aberto, para não repetir em toda tela o
   * aviso do `useLayoutEffect` no render de servidor. O conteúdo dele — a
   * ressalva do papel, os vazios da busca, o seletor — é conferido em
   * `PromoverAdministrador.test.tsx`, com DOM e com clique, que é a única forma
   * honesta de olhar para o que só existe depois de um gesto.
   */
  it("o diálogo de promover não vem montado — só o botão que o abre", async () => {
    lerDaApi.mockResolvedValue(respostaCom([admin(1)]));
    const saidaHtml = await saida();
    expect(saidaHtml).toContain("Promover administrador");
    expect(saidaHtml).not.toContain("Procurar cliente");
  });
});
