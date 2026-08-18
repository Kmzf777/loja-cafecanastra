import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

/**
 * O que estes testes protegem NÃO é o supabase-js — é cada decisão de
 * `sessao.ts` cuja falha é invisível em produção:
 *
 *   - erro do GoTrue cru na tela ..... o cliente lê "Invalid login credentials";
 *   - senha errada × e-mail pendente . a tela oferece a ação errada, ou nenhuma;
 *   - papel vindo de claim ........... qualquer conta se promove a administrador;
 *   - vínculo ausente ................ pessoa logada, banco não a reconhece,
 *                                      endereços e carrinho voltam vazios;
 *   - `destinoSeguro` frouxo ......... phishing com o domínio verdadeiro.
 *
 * Nenhuma dessas cinco aparece em `next build`.
 */

/** Cliente Supabase de mentira, montado caso a caso. */
type Linha = Record<string, unknown> | null;

const cenario: {
  sessao: unknown;
  erroDeLogin: { message?: string; code?: string } | null;
  clientes: Linha;
  admins: Linha;
  erroEmAdmins: { code?: string; message?: string } | null;
  tabelasConsultadas: string[];
  saidaCom: unknown;
} = {
  sessao: null,
  erroDeLogin: null,
  clientes: null,
  admins: null,
  erroEmAdmins: null,
  tabelasConsultadas: [],
  saidaCom: undefined,
};

const falso = {
  auth: {
    signInWithPassword: vi.fn(async () => {
      if (cenario.erroDeLogin) {
        return { data: { session: null, user: null }, error: cenario.erroDeLogin };
      }
      return { data: { session: cenario.sessao, user: null }, error: null };
    }),
    getSession: vi.fn(async () => ({
      data: { session: cenario.sessao },
      error: null,
    })),
    signOut: vi.fn(async (opcoes: unknown) => {
      cenario.saidaCom = opcoes;
      return { error: null };
    }),
  },
  from(tabela: string) {
    cenario.tabelasConsultadas.push(tabela);
    return {
      select: () => ({
        eq: () => ({
          maybeSingle: async () => {
            if (tabela === "admins") {
              return { data: cenario.admins, error: cenario.erroEmAdmins };
            }
            return { data: cenario.clientes, error: null };
          },
        }),
      }),
    };
  },
};

vi.mock("../supabase/cliente", () => ({
  clienteNavegador: () => falso,
}));

// `vi.hoisted` porque a fábrica de `vi.mock` sobe para o topo do arquivo e não
// enxerga um `const` declarado depois dela.
const garantirClienteFalso = vi.hoisted(() => vi.fn(async () => {}));
vi.mock("./cadastro", async (importarOriginal) => {
  const original = await importarOriginal<typeof import("./cadastro")>();
  return { ...original, garantirCliente: garantirClienteFalso };
});

import { ErroDeVinculo } from "./cadastro";
import {
  CODIGO_EMAIL_NAO_CONFIRMADO,
  ErroDeLogin,
  _esquecerPerfil,
  destinoDe,
  destinoSeguro,
  entrar,
  recuperarSessao,
  sair,
} from "./sessao";

/**
 * `sessao.ts` só faz qualquer coisa quando existe `window` — `recuperarSessao`
 * devolve `null` fora do navegador de propósito, porque `clienteNavegador()`
 * fora dali é sempre anônimo.
 */
function fingirNavegador() {
  (globalThis as any).window = {
    location: { hostname: "localhost", origin: "http://localhost:3000" },
  };
  (globalThis as any).localStorage = {
    getItem: () => null,
    setItem: () => {},
    removeItem: vi.fn(),
  };
}

/** Sessão do GoTrue com um claim de papel PLANTADO — ver o teste do papel. */
function sessaoFalsa(extras: Record<string, unknown> = {}) {
  return {
    access_token: "token-de-teste",
    refresh_token: "r1",
    user: {
      id: "uid-1",
      email: "ana@exemplo.com",
      app_metadata: { role: "admin" },
      user_metadata: { role: "admin", nome: "Ana do Metadado" },
      ...extras,
    },
  };
}

beforeEach(() => {
  fingirNavegador();
  cenario.sessao = null;
  cenario.erroDeLogin = null;
  cenario.clientes = null;
  cenario.admins = null;
  cenario.erroEmAdmins = null;
  cenario.tabelasConsultadas = [];
  cenario.saidaCom = undefined;
  garantirClienteFalso.mockClear();
  garantirClienteFalso.mockImplementation(async () => {});
  _esquecerPerfil();
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
  delete (globalThis as any).window;
  delete (globalThis as any).localStorage;
});

/* ------------------------------------------------------------------ */

describe("destinoSeguro", () => {
  // Comportamento que já existia e NÃO pode regredir: o `?de=` da tela de
  // login vira redirecionamento logo depois de a pessoa digitar a senha.
  it("aceita caminho interno", () => {
    expect(destinoSeguro("/checkout", "/account")).toBe("/checkout");
  });

  it("recusa URL absoluta", () => {
    expect(destinoSeguro("https://site-falso/", "/account")).toBe("/account");
  });

  it("recusa protocol-relative //evil.com", () => {
    expect(destinoSeguro("//evil.com", "/account")).toBe("/account");
  });

  it("recusa /\\evil.com, que alguns navegadores tratam como //", () => {
    expect(destinoSeguro("/\\evil.com", "/account")).toBe("/account");
  });

  it("usa o padrão quando não há nada", () => {
    expect(destinoSeguro(null, "/account")).toBe("/account");
    expect(destinoSeguro("", "/account")).toBe("/account");
  });
});

describe("destinoDe", () => {
  it("manda admin para o painel e cliente para a conta", () => {
    const base = { userId: "1", email: "a@b.co", name: "A" };
    expect(destinoDe({ ...base, role: "admin" })).toBe("/dashboard");
    expect(destinoDe({ ...base, role: "cliente" })).toBe("/account");
  });
});

/* ------------------------------------------------------------------ */

describe("entrar — tradução dos erros do GoTrue", () => {
  it("traduz credencial inválida sem repetir a frase em inglês", async () => {
    cenario.erroDeLogin = {
      code: "invalid_credentials",
      message: "Invalid login credentials",
    };
    await expect(entrar("a@b.co", "x")).rejects.toThrow(
      /E-mail ou senha incorretos/,
    );
  });

  /**
   * O TESTE CENTRAL DESTA SUÍTE. As duas recusas mais comuns levam a AÇÕES
   * DIFERENTES na tela: "tente de novo" contra "reenviar o link". Se um dia as
   * duas caírem na mesma mensagem ou no mesmo código, a tela perde a distinção
   * e quem não confirmou o e-mail fica batendo na senha certa para sempre.
   */
  it("distingue e-mail não confirmado de senha errada", async () => {
    cenario.erroDeLogin = { code: "invalid_credentials", message: "x" };
    const senhaErrada = await entrar("a@b.co", "x").catch((e) => e);

    cenario.erroDeLogin = { code: "email_not_confirmed", message: "y" };
    const naoConfirmado = await entrar("a@b.co", "x").catch((e) => e);

    expect(senhaErrada).toBeInstanceOf(ErroDeLogin);
    expect(naoConfirmado).toBeInstanceOf(ErroDeLogin);
    expect(naoConfirmado.codigo).toBe(CODIGO_EMAIL_NAO_CONFIRMADO);
    expect(senhaErrada.codigo).not.toBe(naoConfirmado.codigo);
    expect(senhaErrada.message).not.toBe(naoConfirmado.message);
    expect(naoConfirmado.message).toMatch(/confirmad/i);
  });

  it("não denuncia que o e-mail não existe", async () => {
    cenario.erroDeLogin = { code: "user_not_found", message: "User not found" };
    const erro = await entrar("a@b.co", "x").catch((e) => e);
    // Mesma frase de senha errada: a tela de login não pode virar verificador
    // de quem é cliente da loja.
    expect(erro.message).toBe("E-mail ou senha incorretos. Confira e tente de novo.");
  });

  it("usa frase genérica para código desconhecido, e guarda o código", async () => {
    cenario.erroDeLogin = { code: "codigo_do_futuro", message: "Something" };
    const erro = await entrar("a@b.co", "x").catch((e) => e);
    expect(erro.message).not.toMatch(/Something/);
    expect(erro.codigo).toBe("codigo_do_futuro");
  });

  it("ainda distingue os dois casos num GoTrue antigo, que não manda code", async () => {
    cenario.erroDeLogin = { message: "Email not confirmed" };
    const erro = await entrar("a@b.co", "x").catch((e) => e);
    expect(erro.codigo).toBe(CODIGO_EMAIL_NAO_CONFIRMADO);
  });
});

/* ------------------------------------------------------------------ */

describe("papel de administrador", () => {
  /**
   * A DECISÃO MAIS IMPORTANTE DO ARQUIVO. A sessão de mentira traz
   * `role: "admin"` em `app_metadata` E em `user_metadata` — e `user_metadata` é
   * editável pelo próprio dono da conta. Se este teste ficar verde com
   * "admin", qualquer cliente se promove sozinho, e numa instância Supabase
   * compartilhada qualquer projeto vizinho também.
   */
  it("IGNORA claim de papel no token e lê canastra.admins", async () => {
    cenario.sessao = sessaoFalsa();
    cenario.clientes = { nome: "Ana" };
    cenario.admins = null; // a RLS não devolve linha para quem não é admin

    const sessao = await recuperarSessao();

    expect(sessao?.usuario.role).toBe("cliente");
    expect(cenario.tabelasConsultadas).toContain("admins");
  });

  it("reconhece admin quando a tabela devolve linha", async () => {
    cenario.sessao = sessaoFalsa();
    cenario.clientes = { nome: "Ana" };
    cenario.admins = { user_id: "uid-1" };

    const sessao = await recuperarSessao();
    expect(sessao?.usuario.role).toBe("admin");
    expect(destinoDe(sessao!.usuario)).toBe("/dashboard");
  });

  it("cai para cliente, e não para admin, quando a consulta falha", async () => {
    cenario.sessao = sessaoFalsa();
    cenario.clientes = { nome: "Ana" };
    cenario.erroEmAdmins = { code: "PGRST301", message: "JWT expired" };

    const sessao = await recuperarSessao();
    // Assumir admin numa falha de rede abriria o painel por causa de um timeout.
    expect(sessao?.usuario.role).toBe("cliente");
  });
});

/* ------------------------------------------------------------------ */

describe("recuperarSessao", () => {
  it("devolve null sem barulho quando não há sessão", async () => {
    cenario.sessao = null;
    expect(await recuperarSessao()).toBeNull();
  });

  it("monta Usuario e accessToken a partir da sessão do GoTrue", async () => {
    cenario.sessao = sessaoFalsa();
    cenario.clientes = { nome: "Ana Maria" };

    const sessao = await recuperarSessao();

    expect(sessao).toEqual({
      usuario: {
        userId: "uid-1",
        email: "ana@exemplo.com",
        name: "Ana Maria",
        role: "cliente",
      },
      accessToken: "token-de-teste",
    });
  });

  /**
   * O contrato da 0008: a RPC roda em TODA sessão autenticada, não só no
   * cadastro. É por aqui que o vínculo aparece para quem confirma o e-mail dias
   * depois e entra direto pelo login — sem isto, a pessoa fica logada numa
   * conta que a RLS não reconhece.
   */
  it("cria o vínculo quando não há linha em canastra.clientes", async () => {
    cenario.sessao = sessaoFalsa();
    cenario.clientes = null;

    const sessao = await recuperarSessao();

    expect(garantirClienteFalso).toHaveBeenCalledWith({
      nome: "Ana do Metadado",
    });
    expect(sessao?.usuario.name).toBe("Ana do Metadado");
  });

  it("NÃO chama a RPC quando o vínculo já existe", async () => {
    cenario.sessao = sessaoFalsa();
    cenario.clientes = { nome: "Ana" };

    await recuperarSessao();
    expect(garantirClienteFalso).not.toHaveBeenCalled();
  });

  /**
   * E-mail pendente é o caso realista de recusa (28000). Deixar o erro subir
   * deslogaria a pessoa por causa de um link não clicado — e sumiria junto com
   * o botão de reenviar, que é a única saída dela.
   */
  it("não derruba a sessão quando o vínculo é recusado", async () => {
    cenario.sessao = sessaoFalsa();
    cenario.clientes = null;
    garantirClienteFalso.mockImplementation(async () => {
      throw new ErroDeVinculo("Confirme o e-mail.", "28000", "Reenvie o link.");
    });

    const sessao = await recuperarSessao();
    expect(sessao?.usuario.userId).toBe("uid-1");
  });

  it("consulta o banco uma vez só quando é chamado de novo na mesma sessão", async () => {
    cenario.sessao = sessaoFalsa();
    cenario.clientes = { nome: "Ana" };

    await recuperarSessao();
    const depoisDaPrimeira = cenario.tabelasConsultadas.length;
    await recuperarSessao();

    expect(cenario.tabelasConsultadas.length).toBe(depoisDaPrimeira);
  });

  it("devolve null em vez de explodir quando o cliente não pode ser criado", async () => {
    cenario.sessao = sessaoFalsa();
    falso.auth.getSession.mockImplementationOnce(async () => {
      throw new Error("NEXT_PUBLIC_SUPABASE_URL não está definida.");
    });
    expect(await recuperarSessao()).toBeNull();
  });
});

/* ------------------------------------------------------------------ */

describe("sair", () => {
  /**
   * O padrão do supabase-js é `scope: "global"`, que revoga a sessão em TODOS
   * os aparelhos. Sair no computador derrubaria a pessoa no celular — não é o
   * que "Sair" significa numa loja, nem o que o Express antigo fazia.
   */
  it("encerra apenas a sessão deste navegador", async () => {
    await sair();
    expect(cenario.saidaCom).toEqual({ scope: "local" });
  });

  it("apaga a pista do esquema antigo do painel legado", async () => {
    await sair();
    expect((globalThis as any).localStorage.removeItem).toHaveBeenCalledWith(
      "has_refresh",
    );
  });
});
