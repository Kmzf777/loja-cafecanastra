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

/**
 * Origem da API.
 *
 * `NEXT_PUBLIC_*` e resolvido em tempo de BUILD e vai embutido no bundle. Se a
 * variavel faltar no build de producao, o fallback de desenvolvimento e assado
 * no JavaScript que o cliente baixa, e a loja publica tenta falar com a maquina
 * de quem visita. Nao ha erro no servidor, nada no log: simplesmente nada
 * funciona, para todo mundo.
 *
 * `conferirApiBase()`, logo abaixo, detecta exatamente esse estado em runtime.
 */
export const API_BASE = (
  process.env.NEXT_PUBLIC_API_URL || "http://localhost:3333"
).replace(/\/$/, "");

/**
 * Detecta a combinação que quebra tudo em silêncio: página servida de um
 * domínio real, apontando para localhost.
 *
 * A checagem é aqui e não no build porque `next build` roda com
 * NODE_ENV=production até quando é só uma verificação local — falhar ali
 * impediria compilar o projeto sem ter uma API configurada. O que importa de
 * fato é o runtime no navegador de quem visita, e isso só dá para saber
 * comparando com o host de onde a página veio.
 */
let jaAvisou = false;
function conferirApiBase() {
  if (typeof window === "undefined" || jaAvisou) return;

  const hostLocal = /^(localhost|127\.0\.0\.1|\[::1\])$/.test(
    window.location.hostname,
  );
  const apiLocal = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])/.test(API_BASE);

  if (!hostLocal && apiLocal) {
    jaAvisou = true;
    console.error(
      `[config] Esta página foi servida de ${window.location.origin}, mas a API ` +
        `está apontada para ${API_BASE}. Defina NEXT_PUBLIC_API_URL no build ` +
        "de produção — nenhuma chamada vai funcionar assim.",
    );
  }
}

/**
 * Destino de redirecionamento seguro.
 *
 * O `?de=` da tela de login era usado como veio. `?de=https://site-falso/`
 * mandava a pessoa para fora logo apos ela digitar a senha — a montagem
 * classica de phishing, com a credibilidade do dominio verdadeiro emprestada
 * ao golpe. So caminho interno vale.
 */
export function destinoSeguro(bruto: string | null, padrao: string): string {
  if (!bruto) return padrao;
  // Precisa comecar com uma barra e NAO com duas: "//evil.com" e URL absoluta
  // protocol-relative, que o navegador segue para fora do site.
  if (!bruto.startsWith("/") || bruto.startsWith("//")) return padrao;
  // "/\evil.com" e tratado como "//evil.com" por alguns navegadores.
  if (bruto.startsWith("/\\")) return padrao;
  return bruto;
}

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
  conferirApiBase();
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
