import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

/**
 * O que estes testes protegem é curto de propósito. São três decisões cuja
 * falha é SILENCIOSA em produção:
 *
 *   - token não anexado ..... toda tela do painel volta 401 e parece "sessão
 *                             expirada"; ninguém suspeita do `fetch`;
 *   - 403 tratado como 401 .. o painel renova a sessão, leva o mesmo 403,
 *                             renova de novo — laço contra o GoTrue que só
 *                             aparece como lentidão e rate limit;
 *   - papel de admin vindo de erro de consulta ... uma queda de rede abriria a
 *                             área de gestão para quem não é administrador.
 *
 * Nenhuma das três aparece em `next build` nem em `tsc --noEmit`.
 *
 * ESTE ARQUIVO VEIO DE `legacy/api.test.ts` POR `git mv`, e veio ANTES de o
 * painel legado ser apagado na Onda 6 — não depois. Ele era o único lugar do
 * repositório que cobria o laço de 403; apagar `legacy/` levaria os onze casos
 * junto, e o painel novo reimplementaria a regra sem rede nenhuma embaixo.
 */

type SessaoFalsa = {
  access_token: string;
  refresh_token: string;
  user: { id: string; email: string; user_metadata?: Record<string, unknown> };
} | null;

const cenario: {
  sessao: SessaoFalsa;
  sessaoRenovada: SessaoFalsa;
  clientes: Record<string, unknown> | null;
  admins: Record<string, unknown> | null;
  erroEmAdmins: { code?: string; message?: string } | null;
  renovacoes: number;
} = {
  sessao: null,
  sessaoRenovada: null,
  clientes: null,
  admins: null,
  erroEmAdmins: null,
  renovacoes: 0,
};

const falso = {
  auth: {
    getSession: vi.fn(async () => ({
      data: { session: cenario.sessao },
      error: null,
    })),
    refreshSession: vi.fn(async () => {
      cenario.renovacoes += 1;
      return { data: { session: cenario.sessaoRenovada }, error: null };
    }),
  },
  from(tabela: string) {
    return {
      select: () => ({
        eq: () => ({
          maybeSingle: async () =>
            tabela === "admins"
              ? { data: cenario.admins, error: cenario.erroEmAdmins }
              : { data: cenario.clientes, error: null },
        }),
      }),
    };
  },
  rpc: vi.fn(async () => ({ error: null })),
};

/**
 * O caminho é o mesmo módulo que `lib/painel/transporte.ts` e
 * `lib/conta/sessao.ts` importam (de diretórios diferentes, mas resolvendo
 * para o mesmo arquivo), de modo que os dois recebem este cliente.
 */
vi.mock("@/lib/supabase/cliente", () => ({ clienteNavegador: () => falso }));

import { authFetch, chamarApi, BASE_DA_API } from "./transporte";
import { _esquecerPerfil, recuperarSessao } from "@/lib/conta/sessao";

const sessaoDe = (token: string): SessaoFalsa => ({
  access_token: token,
  refresh_token: "r1",
  // Claim de papel PLANTADO. Ver o teste do guarda, lá embaixo.
  user: {
    id: "uid-1",
    email: "ana@exemplo.com",
    user_metadata: { role: "admin" },
  },
});

/** Respostas encadeadas: uma por chamada de `fetch`, na ordem. */
let respostas: { status: number }[] = [];
const chamadas: { url: string; init: RequestInit }[] = [];

function fingirNavegador() {
  (globalThis as any).window = {
    location: { hostname: "localhost", origin: "http://localhost:3000" },
  };
  (globalThis as any).localStorage = {
    getItem: () => null,
    setItem: () => {},
    removeItem: () => {},
  };
}

const cabecalhos = (i: number) =>
  (chamadas[i].init.headers ?? {}) as Record<string, string>;

beforeEach(() => {
  fingirNavegador();
  cenario.sessao = null;
  cenario.sessaoRenovada = null;
  cenario.clientes = null;
  cenario.admins = null;
  cenario.erroEmAdmins = null;
  cenario.renovacoes = 0;
  respostas = [];
  chamadas.length = 0;
  _esquecerPerfil();
  vi.spyOn(console, "warn").mockImplementation(() => {});

  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: RequestInit = {}) => {
      chamadas.push({ url, init });
      const { status } = respostas.shift() ?? { status: 200 };
      return { ok: status >= 200 && status < 300, status } as Response;
    }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  delete (globalThis as any).window;
  delete (globalThis as any).localStorage;
});

/* ------------------------------------------------------------------ */

describe("authFetch — o token", () => {
  it("anexa o access token do GoTrue e NÃO manda X-CSRF-Token", async () => {
    cenario.sessao = sessaoDe("tok-1");

    await authFetch(`${BASE_DA_API}/dashboard`);

    expect(chamadas).toHaveLength(1);
    expect(cabecalhos(0).Authorization).toBe("Bearer tok-1");
    // O cabeçalho saiu do `allowedHeaders` do CORS na Task 5: mandá-lo hoje faz
    // o PREFLIGHT falhar, e o erro no console é de CORS, não de autenticação.
    expect(cabecalhos(0)).not.toHaveProperty("X-CSRF-Token");
  });

  it("não busca /csrf-token em lugar nenhum", async () => {
    cenario.sessao = sessaoDe("tok-1");

    await chamarApi("/options?type=category", "GET");

    // A rota devolve 404 desde a Task 5, e o `getCsrfToken` antigo LANÇAVA
    // nesse caso — antes de emitir qualquer requisição. Era isso que deixava as
    // telas de leitura do painel mudas.
    expect(chamadas.some((c) => c.url.includes("/csrf-token"))).toBe(false);
    expect(chamadas).toHaveLength(1);
  });

  it("emite a requisição mesmo sem sessão, sem Authorization", async () => {
    cenario.sessao = null;

    await authFetch(`${BASE_DA_API}/dashboard`);

    expect(chamadas).toHaveLength(1);
    expect(cabecalhos(0)).not.toHaveProperty("Authorization");
  });

  it("chamarApi monta o corpo JSON e passa pelo mesmo caminho", async () => {
    cenario.sessao = sessaoDe("tok-1");

    await chamarApi("/promotions", "POST", { ativo: true });

    expect(chamadas[0].url).toBe(`${BASE_DA_API}/promotions`);
    expect(cabecalhos(0)["Content-Type"]).toBe("application/json");
    expect(cabecalhos(0).Authorization).toBe("Bearer tok-1");
    expect(chamadas[0].init.body).toBe(JSON.stringify({ ativo: true }));
  });
});

describe("authFetch — quando renovar, e quando NÃO renovar", () => {
  it("NÃO renova no 403 de conta sem vínculo — seria um laço", async () => {
    cenario.sessao = sessaoDe("tok-1");
    // O backend responde isto para um token VÁLIDO cujo dono não tem linha em
    // `canastra.clientes`. Renovar devolveria o mesmo 403, para sempre.
    respostas = [{ status: 403 }];

    const res = await authFetch(`${BASE_DA_API}/dashboard`);

    expect(res.status).toBe(403);
    expect(cenario.renovacoes).toBe(0);
    expect(chamadas).toHaveLength(1);
  });

  it("renova UMA vez no 401 e repete a requisição com o token novo", async () => {
    cenario.sessao = sessaoDe("tok-velho");
    cenario.sessaoRenovada = sessaoDe("tok-novo");
    respostas = [{ status: 401 }, { status: 200 }];

    const res = await authFetch(`${BASE_DA_API}/dashboard`);

    expect(cenario.renovacoes).toBe(1);
    expect(chamadas).toHaveLength(2);
    expect(cabecalhos(1).Authorization).toBe("Bearer tok-novo");
    expect(res.status).toBe(200);
  });

  it("não repete quando a renovação devolve o mesmo token", async () => {
    cenario.sessao = sessaoDe("tok-1");
    cenario.sessaoRenovada = sessaoDe("tok-1");
    respostas = [{ status: 401 }];

    const res = await authFetch(`${BASE_DA_API}/dashboard`);

    // Reenviar o mesmo token contra a mesma rota é um segundo 401 garantido.
    expect(chamadas).toHaveLength(1);
    expect(res.status).toBe(401);
  });

  it("não repete quando não há mais sessão para renovar", async () => {
    cenario.sessao = sessaoDe("tok-1");
    cenario.sessaoRenovada = null;
    respostas = [{ status: 401 }];

    const res = await authFetch(`${BASE_DA_API}/dashboard`);

    expect(chamadas).toHaveLength(1);
    expect(res.status).toBe(401);
  });
});

/* ------------------------------------------------------------------ */

/**
 * `routes/AdminRoutes.jsx` decide com `user.role !== "admin"`, e `user` é o que
 * `authContextProvider.jsx` recebeu de `recuperarSessao()`. Estes testes
 * percorrem esse caminho inteiro, com o claim de administrador PLANTADO no
 * `user_metadata` da sessão falsa — que é exatamente o que um projeto vizinho
 * na mesma instância do Supabase conseguiria escrever.
 */
const guardaLibera = (papel: string | undefined) => papel === "admin";

describe("guarda do painel", () => {
  it("IGNORA o claim do token e lê canastra.admins", async () => {
    cenario.sessao = sessaoDe("tok-1");
    cenario.clientes = { nome: "Ana" };
    cenario.admins = null; // a RLS não devolve linha para quem não é admin

    const sessao = await recuperarSessao();

    expect(sessao?.usuario.role).toBe("cliente");
    expect(guardaLibera(sessao?.usuario.role)).toBe(false);
  });

  it("NEGA quando a consulta a canastra.admins FALHA", async () => {
    cenario.sessao = sessaoDe("tok-1");
    cenario.clientes = { nome: "Ana" };
    cenario.erroEmAdmins = { code: "PGRST301", message: "JWT expired" };

    const sessao = await recuperarSessao();

    // Abrir na dúvida entregaria a área de gestão por causa de um timeout.
    expect(guardaLibera(sessao?.usuario.role)).toBe(false);
  });

  it("libera quando a tabela devolve linha", async () => {
    cenario.sessao = sessaoDe("tok-1");
    cenario.clientes = { nome: "Ana" };
    cenario.admins = { user_id: "uid-1" };

    const sessao = await recuperarSessao();

    expect(guardaLibera(sessao?.usuario.role)).toBe(true);
  });
});
