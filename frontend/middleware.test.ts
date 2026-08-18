import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

/**
 * O middleware existe por um motivo que não se vê e falha calado: com rotação
 * de refresh token, uma renovação feita num Server Component QUEIMA o token
 * antigo e o substituto morre no `catch` vazio de `servidor.ts`. Passado o
 * intervalo de tolerância a reuso, a sessão do navegador está morta e não há
 * erro em lugar nenhum.
 *
 * Estes testes fixam as duas coisas que, se saírem daqui, levam esse conserto
 * junto — e uma terceira que é pior que a doença:
 *
 *   1. alguma chamada de auth é feita (é ELA que dispara a renovação);
 *   2. o cookie novo sai na RESPOSTA;
 *   3. os cabeçalhos anti-cache do `setAll` são copiados — sem eles o proxy
 *      reverso na frente da loja pode guardar um `Set-Cookie` de sessão e
 *      servi-lo ao próximo visitante, que passa a estar logado na conta alheia.
 */

const capturado: {
  opcoes: {
    cookies: {
      getAll: () => { name: string; value: string }[];
      setAll: (
        cookies: { name: string; value: string; options?: unknown }[],
        cabecalhos: Record<string, string>,
      ) => void;
    };
  } | null;
  chamouAuth: string[];
  cookiesParaGravar: { name: string; value: string; options?: unknown }[];
  cabecalhos: Record<string, string>;
} = {
  opcoes: null,
  chamouAuth: [],
  cookiesParaGravar: [],
  cabecalhos: {},
};

vi.mock("@supabase/ssr", () => ({
  createServerClient: (_url: string, _chave: string, opcoes: never) => {
    capturado.opcoes = opcoes;
    return {
      auth: {
        getClaims: async () => {
          capturado.chamouAuth.push("getClaims");
          // É aqui que o supabase-js grava o token renovado na resposta.
          capturado.opcoes!.cookies.setAll(
            capturado.cookiesParaGravar,
            capturado.cabecalhos,
          );
          return { data: null, error: null };
        },
      },
    };
  },
}));

import { NextRequest } from "next/server";
import { middleware } from "./middleware";

/** Cabeçalhos exatos que o @supabase/ssr 0.12.4 passa junto dos cookies. */
const CABECALHOS_DO_SSR = {
  "Cache-Control": "private, no-cache, no-store, must-revalidate, max-age=0",
  Expires: "0",
  Pragma: "no-cache",
};

function requisicao() {
  return new NextRequest("https://loja.exemplo/account");
}

beforeEach(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://exemplo.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "chave-anon-de-teste";
  capturado.opcoes = null;
  capturado.chamouAuth = [];
  capturado.cookiesParaGravar = [
    { name: "sb-exemplo-auth-token", value: "token-renovado", options: {} },
  ];
  capturado.cabecalhos = { ...CABECALHOS_DO_SSR };
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("middleware de sessão", () => {
  /**
   * Sem UMA chamada de auth, o middleware não faz nada: é ela que faz o
   * supabase-js perceber o token vencido e renová-lo.
   */
  it("chama o auth para forçar a renovação", async () => {
    await middleware(requisicao());
    expect(capturado.chamouAuth).toContain("getClaims");
  });

  it("devolve na resposta o cookie renovado", async () => {
    const resposta = await middleware(requisicao());
    expect(resposta.cookies.get("sb-exemplo-auth-token")?.value).toBe(
      "token-renovado",
    );
  });

  /**
   * O SEGUNDO ARGUMENTO DO `setAll`. Se este teste ficar vermelho, a resposta
   * com `Set-Cookie` de sessão volta a ser cacheável — e o sintoma em produção
   * é um visitante abrindo a loja já logado na conta de outra pessoa.
   */
  it("copia os cabeçalhos anti-cache para a resposta", async () => {
    const resposta = await middleware(requisicao());
    for (const [nome, valor] of Object.entries(CABECALHOS_DO_SSR)) {
      expect(resposta.headers.get(nome)).toBe(valor);
    }
  });

  /**
   * `ambiente.ts` lança quando falta variável, e faz bem numa página. Aqui não:
   * o middleware roda em TODA requisição, inclusive na home e no catálogo, que
   * não precisam de sessão. Deixar subir trocaria "cliente não fica logado"
   * por "a loja inteira responde 500".
   */
  it("não derruba a loja quando a configuração falta", async () => {
    delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    const resposta = await middleware(requisicao());
    expect(resposta).toBeDefined();
    expect(capturado.chamouAuth).toHaveLength(0);
  });
});
