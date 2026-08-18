import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { clienteNavegador, _limparSingletonParaTestes } from "./cliente";

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
 * Ele é do próprio supabase-js (GoTrueClient.js:164-176): um contador estático
 * POR `storageKey`, que nunca é decrementado, e o aviso só sai quando
 * `isBrowser()` é verdadeiro. Cada caso abaixo começa com o cache limpo e cria
 * outra instância sob a mesma chave, então o contador sobe — de propósito, e
 * não é o singleton falhando. Quem responde por ele é o teste "sobrevive à
 * reavaliação do módulo".
 *
 * A parte boa dessa leitura: como o aviso depende de `isBrowser()`, o cliente
 * descartável que o SSR cria a cada render NÃO vai poluir o log de produção.
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
  _limparSingletonParaTestes();
});

afterEach(() => {
  delete (globalThis as any).window;
  delete (globalThis as any).document;
  globalThis.fetch = fetchOriginal;
  _limparSingletonParaTestes();
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
    await clienteNavegador().from("produtos_publicos").select("produto_id");

    expect(chamadas).toHaveLength(1);
    expect(chamadas[0].url).toBe(`${URL_FALSA}/rest/v1/produtos_publicos?select=produto_id`);
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

  /**
   * O teste que amarra `isSingleton: false` em `cliente.ts`.
   *
   * Sem essa linha, o @supabase/ssr liga o cache DELE sozinho quando detecta um
   * navegador — e aí existem dois caches. Os dois testes acima continuariam
   * verdes, porque o cache da biblioteca devolveria o mesmo objeto e satisfaria
   * a asserção pelo motivo errado; `_limparSingletonParaTestes()` não alcança o
   * cache de dentro do pacote e não haveria como notar.
   *
   * A forma de enxergar a diferença é limpar o nosso cache e MUDAR a
   * configuração: com um cache só, o cliente seguinte fala com o host novo; com
   * o da biblioteca ligado por baixo, ele devolve o cliente velho e continua
   * falando com o host antigo. É também o cenário real de `next dev`, onde
   * editar o `.env.local` reinicia o servidor mas não a aba aberta.
   */
  it("respeita a configuração nova depois de limpar o cache", async () => {
    fingirNavegador();
    clienteNavegador();

    _limparSingletonParaTestes();
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://outro.supabase.co";

    const chamadas = espionarRede();
    await clienteNavegador().from("produtos_publicos").select("produto_id");

    expect(chamadas[0].url).toContain("https://outro.supabase.co");
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
   *
   * A lista de arquivos é LIDA DO DISCO, e não escrita à mão: um `admin.ts`
   * criado amanhã entra na varredura sozinho. Uma lista fixa cobriria só os
   * arquivos que existiam no dia em que o teste foi escrito, que é exatamente
   * quando ninguém ainda estava tentado a usar a chave.
   */
  const modulos = readdirSync(new URL(".", import.meta.url))
    .filter((nome) => nome.endsWith(".ts") && !nome.endsWith(".test.ts"));

  it("varre todo módulo do diretório", () => {
    // Se o filtro acima quebrar, o teste seguinte passaria vasculhando nada.
    expect(modulos).toContain("cliente.ts");
    expect(modulos).toContain("servidor.ts");
    expect(modulos).toContain("ambiente.ts");
    expect(modulos).not.toContain("cliente.test.ts");
  });

  it.each(modulos)("%s não lê uma chave secreta", (arquivo) => {
    const linhas = readFileSync(new URL(arquivo, import.meta.url), "utf8")
      .split(/\r?\n/)
      .map((linha) => linha.trim());

    /**
     * A proibição escrita em comentário é bem-vinda — é o que os arquivos
     * fazem. O que não pode é o nome do segredo aparecer em código.
     *
     * O filtro exclui a LINHA DE COMENTÁRIO em vez de exigir que o segredo e o
     * `process.env` estejam na mesma linha física. Com a exigência de mesma
     * linha, `const CHAVE = "SUPABASE_SERVICE_ROLE_KEY"` seguido de
     * `process.env[CHAVE]` duas linhas abaixo passava batido.
     */
    const emComentario = (linha: string) =>
      linha.startsWith("//") || linha.startsWith("*") || linha.startsWith("/*");

    const usos = linhas.filter(
      (linha) =>
        /service_role|SERVICE_ROLE|sb_secret_/.test(linha) &&
        !emComentario(linha),
    );

    expect(usos, `${arquivo} menciona uma chave secreta fora de comentário`)
      .toEqual([]);
  });
});
