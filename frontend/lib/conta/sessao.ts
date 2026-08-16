/**
 * Sessão da vitrine.
 *
 * Fala com o MESMO backend e usa a MESMA convenção de persistência do painel
 * legado (`legacy/contexts/loginContext/authContextProvider.jsx`):
 *
 *   - o refresh token vive num cookie httpOnly que o backend emite no sign-in;
 *   - `localStorage["has_refresh"] = "true"` é a pista de que vale a pena
 *     tentar `/auth/refresh-token` ao abrir a página.
 *
 * Reimplementar isso com outra chave criaria duas sessões desconectadas: o
 * cliente entraria pela vitrine e o painel continuaria achando que ninguém
 * está logado — que é exatamente a pendência 2 do baseline-painel.md.
 * Por isso a chave é copiada, não inventada.
 */

export const API_BASE =
  process.env.NEXT_PUBLIC_API_URL || "http://localhost:3333";

/** Mesma chave gravada por `loginUser` no painel legado. */
const CHAVE_REFRESH = "has_refresh";

export type Usuario = {
  userId: string;
  email: string;
  name: string;
  role: string;
};

export type Sessao = { usuario: Usuario; accessToken: string };

/**
 * O backend protege todo POST com CSRF por cookie (csurf). Sem este token o
 * login responde 403 "Formulário expirado ou inválido".
 */
async function obterCsrf(): Promise<string | null> {
  try {
    const res = await fetch(`${API_BASE}/csrf-token`, {
      credentials: "include",
    });
    if (!res.ok) return null;
    const { csrfToken } = await res.json();
    return csrfToken ?? null;
  } catch {
    return null;
  }
}

export class ErroDeLogin extends Error {}

export async function entrar(
  email: string,
  senha: string,
): Promise<Sessao> {
  const csrf = await obterCsrf();

  // O carrinho anônimo do localStorage viaja junto: o backend funde com o
  // carrinho salvo da conta e devolve o resultado. Sem isto, quem monta a
  // sacola deslogado e depois entra perde tudo.
  const carrinhoLocal = (() => {
    try {
      return JSON.parse(localStorage.getItem("cart") || "[]");
    } catch {
      return [];
    }
  })();

  const res = await fetch(`${API_BASE}/auth/sign-in`, {
    method: "POST",
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      ...(csrf ? { "X-CSRF-Token": csrf } : {}),
    },
    body: JSON.stringify({ email, password: senha, localCart: carrinhoLocal }),
  });

  const dados = await res.json().catch(() => ({}));

  if (!res.ok) {
    throw new ErroDeLogin(dados.message || "Não foi possível entrar.");
  }

  localStorage.setItem(CHAVE_REFRESH, "true");

  if (dados.mergedCart) {
    window.dispatchEvent(
      new CustomEvent("shop:cartMerged", { detail: dados.mergedCart }),
    );
  }

  return { usuario: dados.user, accessToken: dados.accessToken };
}

/**
 * Restaura a sessão a partir do cookie httpOnly. Devolve `null` sem barulho
 * quando não há sessão — é o caminho normal de quem chega deslogado.
 */
export async function recuperarSessao(): Promise<Sessao | null> {
  if (typeof window === "undefined") return null;
  if (!localStorage.getItem(CHAVE_REFRESH)) return null;

  try {
    const csrf = await obterCsrf();
    const res = await fetch(`${API_BASE}/auth/refresh-token`, {
      method: "POST",
      credentials: "include",
      headers: csrf ? { "X-CSRF-Token": csrf } : {},
    });

    if (!res.ok) {
      localStorage.removeItem(CHAVE_REFRESH);
      return null;
    }

    const dados = await res.json();
    if (!dados.user) return null;
    return { usuario: dados.user, accessToken: dados.accessToken };
  } catch {
    return null;
  }
}

export async function sair(): Promise<void> {
  const csrf = await obterCsrf();
  try {
    await fetch(`${API_BASE}/auth/sign-out`, {
      method: "POST",
      credentials: "include",
      headers: csrf ? { "X-CSRF-Token": csrf } : {},
    });
  } catch {
    // Falhar o logout no servidor não pode prender o usuário na conta:
    // a pista local sai de qualquer jeito logo abaixo.
  }
  localStorage.removeItem(CHAVE_REFRESH);
}

/** Para onde mandar alguém que acabou de entrar. */
export function destinoDe(usuario: Usuario): string {
  return usuario.role === "admin" ? "/dashboard" : "/account";
}
