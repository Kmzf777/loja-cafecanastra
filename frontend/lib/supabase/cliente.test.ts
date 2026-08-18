import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { readFileSync } from "node:fs";
import { clienteNavegador, _limparSingleton } from "./cliente";

/**
 * O que estes testes protegem não é a biblioteca — é cada decisão tomada em
 * `cliente.ts`/`ambiente.ts` cuja falha é SILENCIOSA em produção:
 *
 *   - esquema errado ....... 404 com o banco perfeito;
 *   - variável faltando .... tela vazia sem erro;
 *   - dois clientes ........ sacola fundida duas vezes no login;
 *   - storage errado ....... logado no navegador, anônimo no servidor.
 *
 * Nenhuma dessas quatro aparece em `next build`.
 *
 * SOBRE O AVISO "Multiple GoTrueClient instances detected" NO STDERR
 * Ele é do próprio supabase-js e conta instâncias criadas no PROCESSO inteiro,
 * não simultâneas. Cada caso abaixo começa com o cache limpo, então o processo
 * de teste realmente cria várias — de propósito. Não é o singleton falhando; o
 * teste "sobrevive à reavaliação do módulo" é quem responde por isso.
 */

const URL_FALSA = "https://exemplo.supabase.co";
const CHAVE_FALSA = "chave-anon-de-teste";

/** Faz o módulo acreditar que está num navegador, com um document.cookie observável. */
function fingirNavegador() {
  const gravados: string[] = [];
  const doc = {
    get cookie() {
      return "";
    },
    set cookie(valor: string) {
      gravados.push(valor);
    },
  };
  const chavesLocalStorage: string[] = [];
  (globalThis as any).document = doc;
  (globalThis as any).window = {
    document: doc,
    localStorage: {
      getItem: () => null,
      setItem: (chave: string) => chavesLocalStorage.push(chave),
      removeItem: () => {},
    },
  };
  return { gravados, chavesLocalStorage };
}

/** Substitui o fetch global e devolve o registro do que a rede teria recebido. */
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

const fetchOriginal = globalThis.fetch;

beforeEach(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = URL_FALSA;
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = CHAVE_FALSA;
  _limparSingleton();
});

afterEach(() => {
  delete (globalThis as any).window;
  delete (globalThis as any).document;
  globalThis.fetch = fetchOriginal;
  _limparSingleton();
  vi.resetModules();
});

describe("variáveis de ambiente", () => {
  it("falha nomeando NEXT_PUBLIC_SUPABASE_URL quando ela falta", () => {
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    expect(() => clienteNavegador()).toThrowError(/NEXT_PUBLIC_SUPABASE_URL/);
  });

  it("falha nomeando NEXT_PUBLIC_SUPABASE_ANON_KEY quando ela falta", () => {
    delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    expect(() => clienteNavegador()).toThrowError(
      /NEXT_PUBLIC_SUPABASE_ANON_KEY/,
    );
  });

  // Variável presente porém vazia é o caso real do painel de deploy: alguém
  // cria a chave e esquece de colar o valor. Um teste de "!valor" pega isso,
  // um teste de "=== undefined" não.
  it("trata string vazia como ausente", () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = "   ";
    expect(() => clienteNavegador()).toThrowError(/NEXT_PUBLIC_SUPABASE_URL/);
  });
});

describe("esquema canastra", () => {
  it("manda Accept-Profile: canastra em uma consulta", async () => {
    const chamadas = espionarRede();
    await clienteNavegador().from("cafes").select("id");

    expect(chamadas).toHaveLength(1);
    expect(chamadas[0].url).toBe(`${URL_FALSA}/rest/v1/cafes?select=id`);
    expect(chamadas[0].cabecalhos["accept-profile"]).toBe("canastra");
  });

  /**
   * Registro de um resultado apurado ao ler o supabase-js 2.112: `db.schema` é
   * repassado APENAS ao PostgrestClient. O auth fala com o GoTrue em
   * `/auth/v1/*`, que não tem noção de esquema — os usuários vivem no esquema
   * `auth`, gerenciado pelo serviço, não pela nossa opção.
   *
   * Fica como teste porque a dúvida oposta ("mudei o schema, será que quebrei o
   * login?") custaria uma tarde de investigação.
   */
  it("não contamina as chamadas de autenticação", async () => {
    const chamadas = espionarRede({ error: "invalid_grant" });
    await clienteNavegador()
      .auth.signInWithPassword({ email: "a@b.co", password: "x" })
      .catch(() => {});

    expect(chamadas[0].url).toContain("/auth/v1/token");
    expect(chamadas[0].cabecalhos["accept-profile"]).toBeUndefined();
    expect(chamadas[0].cabecalhos["content-profile"]).toBeUndefined();
  });
});

describe("instância única no navegador", () => {
  it("devolve o mesmo objeto em chamadas repetidas", () => {
    fingirNavegador();
    expect(clienteNavegador()).toBe(clienteNavegador());
  });

  /**
   * O caso que um `let` de módulo NÃO resolveria.
   *
   * `vi.resetModules()` reproduz o que o Fast Refresh do `next dev` faz a cada
   * salvamento e o que um bundler faz ao duplicar um módulo entre chunks: o
   * arquivo é avaliado de novo, do zero. A asserção de que as funções são
   * diferentes é o que prova que a reavaliação aconteceu de fato — sem ela o
   * teste passaria de graça.
   *
   * Se o cache voltasse a ser um `let`, a segunda chamada devolveria um cliente
   * novo, com um segundo `onAuthStateChange`, e a fusão da sacola da Tarefa 4
   * rodaria duas vezes no login.
   */
  it("sobrevive à reavaliação do módulo", async () => {
    fingirNavegador();

    const primeiro = await import("./cliente");
    const antes = primeiro.clienteNavegador();

    vi.resetModules();
    const segundo = await import("./cliente");

    expect(segundo.clienteNavegador).not.toBe(primeiro.clienteNavegador);
    expect(segundo.clienteNavegador()).toBe(antes);
  });

  /**
   * Fora do navegador o cache é proibido de propósito: `globalThis` no Node
   * dura entre requisições de pessoas diferentes, e um cliente que guarda
   * sessão cacheado ali entregaria a sessão de um visitante para outro.
   */
  it("não cacheia fora do navegador", () => {
    expect((globalThis as any).window).toBeUndefined();
    expect(clienteNavegador()).not.toBe(clienteNavegador());
  });
});

describe("sessão legível pelo servidor", () => {
  /**
   * A razão de usar `createBrowserClient` (@supabase/ssr) em vez do
   * `createClient` do supabase-js: o segundo guarda a sessão no `localStorage`,
   * que o servidor nunca vê. `servidor.ts` lê os mesmos cookies via
   * `next/headers` — se esta asserção cair, o usuário fica logado no navegador
   * e anônimo em toda renderização de servidor, e a RLS devolve vazio sem erro.
   */
  it("grava a sessão em cookie e não no localStorage", async () => {
    const { gravados, chavesLocalStorage } = fingirNavegador();
    espionarRede({
      access_token:
        "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxIiwiZXhwIjo5OTk5OTk5OTk5fQ.x",
      refresh_token: "r1",
      expires_in: 3600,
      token_type: "bearer",
      user: {
        id: "1",
        email: "a@b.co",
        aud: "authenticated",
        app_metadata: {},
        user_metadata: {},
        created_at: "2020-01-01",
      },
    });

    const { error } = await clienteNavegador().auth.signInWithPassword({
      email: "a@b.co",
      password: "x",
    });

    expect(error).toBeNull();
    expect(gravados.some((c) => c.startsWith("sb-exemplo-auth-token="))).toBe(
      true,
    );
    expect(chavesLocalStorage).toEqual([]);
  });
});

describe("chaves secretas", () => {
  /**
   * Guarda contra o conserto errado. Quando uma policy de RLS barra alguma
   * coisa, a tentação é trocar a chave anon pela `service_role` — que ignora
   * RLS e, sob um nome `NEXT_PUBLIC_`, seria baixada por qualquer visitante da
   * loja. Este teste transforma esse "conserto" numa falha de teste.
   */
  it("nenhum módulo do diretório lê uma chave secreta", () => {
    for (const arquivo of ["ambiente.ts", "cliente.ts", "servidor.ts"]) {
      const fonte = readFileSync(new URL(arquivo, import.meta.url), "utf8");
      const usos = fonte
        .split("\n")
        .filter((linha) => /service_role|SERVICE_ROLE|sb_secret_/.test(linha))
        // A proibição escrita em comentário é bem-vinda; o que não pode é a
        // chave ser lida do ambiente ou entregue a um construtor de cliente.
        .filter((linha) =>
          /process\.env|createClient|createServerClient|createBrowserClient/.test(
            linha,
          ),
        );
      expect(usos, `${arquivo} usa uma chave secreta`).toEqual([]);
    }
  });
});
