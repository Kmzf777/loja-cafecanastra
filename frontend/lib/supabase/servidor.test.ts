import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

/**
 * `next/headers` só existe dentro de uma requisição do Next. Aqui ele é
 * substituído por um cofre de cookies de mentira, controlável caso a caso —
 * inclusive no caso em que gravar cookie lança, que é exatamente o que um
 * Server Component faz.
 */
const cofre = {
  itens: [] as { name: string; value: string }[],
  gravados: [] as { name: string; value: string }[],
  gravarLanca: false,
  getAll() {
    return this.itens;
  },
  set(name: string, value: string) {
    if (this.gravarLanca) {
      throw new Error(
        "Cookies can only be modified in a Server Action or Route Handler",
      );
    }
    this.gravados.push({ name, value });
  },
};

vi.mock("next/headers", () => ({
  cookies: async () => cofre,
}));

import { criarClienteServidor } from "./servidor";

const URL_FALSA = "https://exemplo.supabase.co";
const fetchOriginal = globalThis.fetch;

/**
 * Access token de mentira, mas bem formado: `setSession` decodifica o JWT
 * localmente antes de qualquer coisa e recusa o que não for base64url válido
 * nas três partes. A assinatura não é conferida do lado do cliente.
 */
const TOKEN =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9." +
  "eyJzdWIiOiIxIiwiZXhwIjo5OTk5OTk5OTk5LCJyb2xlIjoiYXV0aGVudGljYXRlZCJ9." +
  "YXNzaW5hdHVyYS1mYWxzYQ";

/** `setSession` confirma o token no GoTrue antes de persistir a sessão. */
const USUARIO = {
  id: "1",
  email: "a@b.co",
  aud: "authenticated",
  app_metadata: {},
  user_metadata: {},
  created_at: "2020-01-01",
};

function espionarRede(corpo: unknown = []) {
  const chamadas: { url: string; cabecalhos: Record<string, string> }[] = [];
  globalThis.fetch = (async (entrada: any, init: any) => {
    chamadas.push({
      url: String(entrada),
      cabecalhos: Object.fromEntries(new Headers(init?.headers).entries()),
    });
    return new Response(JSON.stringify(corpo), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }) as any;
  return chamadas;
}

beforeEach(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = URL_FALSA;
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "chave-anon-de-teste";
  cofre.itens = [];
  cofre.gravados = [];
  cofre.gravarLanca = false;
});

afterEach(() => {
  globalThis.fetch = fetchOriginal;
});

describe("cliente de servidor", () => {
  it("falha nomeando a variável que falta", async () => {
    delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    await expect(criarClienteServidor()).rejects.toThrow(
      /NEXT_PUBLIC_SUPABASE_ANON_KEY/,
    );
  });

  it("consulta o esquema canastra", async () => {
    const chamadas = espionarRede();
    const supabase = await criarClienteServidor();
    await supabase.from("produtos_publicos").select("produto_id");

    expect(chamadas[0].cabecalhos["accept-profile"]).toBe("canastra");
  });

  /**
   * O oposto do cliente de navegador, e de propósito: cada requisição é de uma
   * pessoa diferente. Se este teste virar `toBe`, alguém transformou o cliente
   * de servidor em singleton e a sessão de um visitante passa a ser servida
   * para outro.
   */
  it("cria uma instância nova a cada chamada", async () => {
    expect(await criarClienteServidor()).not.toBe(
      await criarClienteServidor(),
    );
  });

  it("lê a sessão dos cookies da requisição", async () => {
    cofre.itens = [{ name: "sb-exemplo-auth-token", value: "qualquer-coisa" }];
    const lidos: string[] = [];
    const original = cofre.getAll;
    cofre.getAll = function () {
      lidos.push("chamou");
      return original.call(this);
    };

    const supabase = await criarClienteServidor();
    await supabase.auth.getSession();

    cofre.getAll = original;
    expect(lidos.length).toBeGreaterThan(0);
  });

  /**
   * O `catch` vazio do `setAll` existe porque um Server Component não pode
   * escrever cookies e o supabase-js tenta escrever sozinho, ao renovar o
   * token. Sem o catch, uma renovação de rotina derrubaria a página inteira.
   */
  it("grava o cookie quando o ambiente permite (Route Handler)", async () => {
    espionarRede(USUARIO);
    const supabase = await criarClienteServidor();
    const { error } = await supabase.auth.setSession({
      access_token: TOKEN,
      refresh_token: "r1",
    });

    expect(error).toBeNull();
    expect(cofre.gravados.map((c) => c.name)).toContain(
      "sb-exemplo-auth-token",
    );
  });

  /**
   * O `catch` vazio do `setAll` existe porque um Server Component não pode
   * escrever cookies e o supabase-js tenta escrever sozinho, ao renovar o
   * token. Sem o catch, uma renovação de rotina derrubaria a página inteira.
   *
   * O teste acima é o par deste: ele prova que este caminho realmente chega ao
   * `setAll` — sem ele, "não lançou" poderia significar só "nunca tentou".
   */
  it("não deixa a falha de gravar cookie derrubar a página", async () => {
    espionarRede(USUARIO);
    cofre.gravarLanca = true;
    const supabase = await criarClienteServidor();

    await expect(
      supabase.auth.setSession({ access_token: TOKEN, refresh_token: "r1" }),
    ).resolves.toBeDefined();
  });
});
