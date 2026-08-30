import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import { renderizar } from "@/lib/teste/renderizar";

/**
 * O QUE ESTE ARQUIVO COBRE, E O QUE ELE DEIXA PARA A FUNÇÃO PURA.
 *
 * A REGRA (quem sai, para onde) é `anel-de-sessao.logica.ts` e está testada lá,
 * sem DOM. Aqui fica só o que a função pura não alcança e que já falhou em
 * projeto de verdade: a inscrição no evento, a ida ao banco pelo papel, a
 * navegação DURA, e o cancelamento da inscrição ao desmontar. Um anel que não se
 * desinscreve deixa uma callback viva por tela visitada — e todas disparam no
 * próximo `TOKEN_REFRESHED`.
 *
 * `vi.hoisted` e não `let` solto: `vi.mock` é içado para cima dos imports, e uma
 * variável de módulo referenciada dentro da fábrica estoura em TDZ.
 */
const dublê = vi.hoisted(() => {
  const estado = {
    /** A callback que o componente registrou — o teste a dispara à mão. */
    aoMudar: null as ((evento: string, sessao: unknown) => void) | null,
    desinscrever: vi.fn(),
    /** O que `canastra.admins` responde. `erro` cobre o PostgREST fora do ar. */
    admin: { data: null as { user_id: string } | null, error: null as unknown },
    /** Quantas vezes o banco foi consultado — é o custo que o anel promete não ter. */
    consultas: 0,
    /** `clienteNavegador()` lança? É o caso da variável de ambiente faltando. */
    lanca: false,
  };

  const cliente = {
    auth: {
      onAuthStateChange(cb: (evento: string, sessao: unknown) => void) {
        estado.aoMudar = cb;
        return { data: { subscription: { unsubscribe: estado.desinscrever } } };
      },
    },
    from() {
      return {
        select: () => ({
          eq: () => ({
            maybeSingle: async () => {
              estado.consultas += 1;
              return estado.admin;
            },
          }),
        }),
      };
    },
  };

  return { estado, cliente };
});

vi.mock("@/lib/supabase/cliente", () => ({
  clienteNavegador: () => {
    if (dublê.estado.lanca) throw new Error("NEXT_PUBLIC_SUPABASE_URL ausente");
    return dublê.cliente;
  },
}));

import { AnelDeSessao } from "./AnelDeSessao";

const ADMIN = "11111111-1111-4111-8111-111111111111";
const OUTRO = "22222222-2222-4222-8222-222222222222";

/**
 * A NAVEGAÇÃO É SUBSTITUÍDA, e não espionada: o `location.replace` do jsdom
 * responde "Not implemented: navigation" no stderr e não registra nada, então
 * espioná-lo provaria menos do que parece. Trocar o objeto inteiro também deixa
 * o `pathname`/`search` sob controle, que é o que vira o `?de=`.
 */
const localizacaoReal = window.location;
let replace: ReturnType<typeof vi.fn>;

function emQue(caminho: string, query = "") {
  replace = vi.fn();
  Object.defineProperty(window, "location", {
    configurable: true,
    value: { pathname: caminho, search: query, replace },
  });
}

beforeEach(() => {
  dublê.estado.aoMudar = null;
  dublê.estado.admin = { data: null, error: null };
  dublê.estado.consultas = 0;
  dublê.estado.lanca = false;
  dublê.estado.desinscrever.mockClear();
  emQue("/dashboard/pedidos");
});

afterEach(() => {
  Object.defineProperty(window, "location", {
    configurable: true,
    value: localizacaoReal,
  });
});

/**
 * Dispara o evento de sessão e deixa as promessas do efeito resolverem.
 *
 * A callback do supabase-js NÃO é `async` de propósito (eventos são entregues em
 * fila, e uma callback lenta atrasa os próximos): ela dispara o trabalho e volta
 * na hora. Quem espera é o teste, e são três voltas de microtarefa porque o
 * caminho mais longo tem três — a chamada de `avaliar`, a consulta ao banco e a
 * decisão depois dela.
 */
async function sessaoVira(userId: string | null) {
  dublê.estado.aoMudar?.(
    userId ? "SIGNED_IN" : "SIGNED_OUT",
    userId ? { user: { id: userId } } : null,
  );
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

describe("AnelDeSessao", () => {
  it("não desenha nada — é o layout que é dono da tela", () => {
    const { container } = renderizar(<AnelDeSessao userIdDoServidor={ADMIN} />);
    expect(container.innerHTML).toBe("");
  });

  it("inscreve-se no evento de sessão ao montar", () => {
    renderizar(<AnelDeSessao userIdDoServidor={ADMIN} />);
    expect(dublê.estado.aoMudar).not.toBeNull();
  });

  /**
   * O caso que o anel existe para pegar. A navegação é DURA (`replace`) porque
   * sair daqui é descartar a sessão de painel inteira: o cache do App Router
   * poderia servir de volta, de dentro dele, a tela que acabou de deixar de ser
   * permitida.
   */
  it("sessão que morre leva para a entrada, com a rota E os filtros no ?de=", async () => {
    emQue("/dashboard/pedidos", "?status=aprovado&pagina=2");
    renderizar(<AnelDeSessao userIdDoServidor={ADMIN} />);

    await sessaoVira(null);

    expect(replace).toHaveBeenCalledWith(
      "/dashboard/entrar?de=%2Fdashboard%2Fpedidos%3Fstatus%3Daprovado%26pagina%3D2",
    );
  });

  /**
   * A entrega de um anel para o outro: o servidor já conferiu `canastra.admins`
   * nesta requisição. Sem isto, o `TOKEN_REFRESHED` de hora em hora viraria uma
   * ida à rede por hora, por aba, para reconfirmar o que não mudou.
   */
  it("a mesma pessoa que o servidor aprovou não custa consulta nenhuma", async () => {
    renderizar(<AnelDeSessao userIdDoServidor={ADMIN} />);

    await sessaoVira(ADMIN);

    expect(dublê.estado.consultas).toBe(0);
    expect(replace).not.toHaveBeenCalled();
  });

  it("outra conta sem linha em admins vai para a própria conta", async () => {
    dublê.estado.admin = { data: null, error: null };
    renderizar(<AnelDeSessao userIdDoServidor={ADMIN} />);

    await sessaoVira(OUTRO);

    expect(dublê.estado.consultas).toBe(1);
    expect(replace).toHaveBeenCalledWith("/account?painel=negado");
  });

  it("outra conta que TEM linha em admins fica", async () => {
    dublê.estado.admin = { data: { user_id: OUTRO }, error: null };
    renderizar(<AnelDeSessao userIdDoServidor={ADMIN} />);

    await sessaoVira(OUTRO);

    expect(replace).not.toHaveBeenCalled();
  });

  /**
   * A divergência deliberada com o anel de servidor: consulta que não respondeu
   * NÃO expulsa. Fechar aqui seria tirar da tela um gestor legítimo, no meio de
   * um formulário, por causa da oscilação de rede que causou a falha.
   */
  it("PostgREST fora do ar não tira ninguém da tela", async () => {
    dublê.estado.admin = { data: null, error: { code: "PGRST000", message: "fora" } };
    renderizar(<AnelDeSessao userIdDoServidor={ADMIN} />);

    await sessaoVira(OUTRO);

    expect(replace).not.toHaveBeenCalled();
  });

  it("desinscreve ao desmontar — senão sobra uma callback por tela visitada", () => {
    const { unmount } = renderizar(<AnelDeSessao userIdDoServidor={ADMIN} />);
    unmount();
    expect(dublê.estado.desinscrever).toHaveBeenCalledTimes(1);
  });

  /**
   * O anel é a SEGUNDA camada: uma variável de ambiente esquecida não pode
   * derrubar o painel inteiro, que é o que aconteceria sem o `catch` — este
   * componente está no layout, e o layout envolve todas as telas.
   */
  it("variável de ambiente faltando não derruba o painel", () => {
    dublê.estado.lanca = true;
    expect(() => renderizar(<AnelDeSessao userIdDoServidor={ADMIN} />)).not.toThrow();
  });
});
