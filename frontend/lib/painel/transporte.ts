import { clienteNavegador } from "@/lib/supabase/cliente";

export const BASE_DA_API =
  process.env.NEXT_PUBLIC_API_URL || "http://localhost:3333";

/**
 * Access token da sessão atual, ou `null`.
 *
 * `getSession()` é também o gatilho da RENOVAÇÃO: se o token expirou, o
 * supabase-js troca o refresh token aqui dentro antes de responder. É por isso
 * que o caminho de 401 lá embaixo é exceção, e não a regra.
 */
async function tokenDeAcesso(): Promise<string | null> {
  try {
    const { data } = await clienteNavegador().auth.getSession();
    return data?.session?.access_token ?? null;
  } catch (erro) {
    // Variável de ambiente faltando (`ambiente.ts` lança com o nome dela) ou
    // rede fora. Seguir sem token é melhor do que não emitir a requisição: as
    // rotas públicas do catálogo continuam respondendo, e as privadas voltam
    // 401 — que é a verdade, e aparece como tal.
    console.warn("[painel] Não foi possível ler a sessão do Supabase.", erro);
    return null;
  }
}

/**
 * O transporte do painel — e as três regras que ele carrega.
 *
 * 1. O TOKEN É LIDO A CADA CHAMADA, do supabase-js, e nunca guardado. Guardar
 *    significa servir um token vencido depois que outra aba renovou a sessão.
 *    (É também por isso que ele não vem do estado do React: este módulo é
 *    importado por código que roda FORA da árvore de qualquer provider.)
 *
 * 2. SÓ 401 RENOVA, E SÓ SE O TOKEN MUDOU. O backend responde **403** com
 *    `{message:"Sua conta ainda não está vinculada a esta loja."}` para um token
 *    PERFEITAMENTE VÁLIDO (isAuthenticated.js:307-316). Tratar 403 como sessão
 *    expirada renova, leva o mesmo 403, renova de novo — laço contra o GoTrue
 *    que aparece como lentidão e rate limit, não como erro. Já aconteceu neste
 *    projeto. E a comparação `novoToken === token` existe porque o supabase-js
 *    resolve `refreshSession()` com o token ANTIGO quando não havia o que
 *    renovar: sem ela, a mesma requisição vai duas vezes para dar o mesmo 401.
 *
 * 3. NENHUM CABEÇALHO FORA DOS TRÊS DO CORS. `backend/src/index.js:87` aceita
 *    exatamente `Content-Type`, `Authorization` e `Accept`. Um `X-Request-Id`
 *    acrescentado aqui faz o PREFLIGHT falhar, e o erro no console é de CORS —
 *    dez minutos de investigação na direção errada. Header novo exige mexer no
 *    backend primeiro. (Foi assim que o `X-CSRF-Token` saiu daqui: ele deixou
 *    de estar em `allowedHeaders` e derrubou o preflight de tela nenhuma.)
 *
 * `credentials: "include"` FICA, e não é sobra do esquema de cookie: o
 * `cors({ credentials: true })` continua ligado do outro lado justamente porque
 * a vitrine manda `include`, e a autenticação de verdade viaja em
 * `Authorization: Bearer`.
 */
export async function authFetch(
  url: string,
  options: RequestInit = {},
): Promise<Response> {
  const opts: RequestInit = {
    ...options,
    headers: { ...((options.headers as Record<string, string>) || {}) },
  };
  opts.credentials = "include";

  const token = await tokenDeAcesso();
  if (token) {
    (opts.headers as Record<string, string>).Authorization = `Bearer ${token}`;
  }

  const res = await fetch(url, opts);
  if (res.status !== 401 || !token) return res;

  let novoToken: string | null = null;
  try {
    const { data } = await clienteNavegador().auth.refreshSession();
    novoToken = data?.session?.access_token ?? null;
  } catch (erro) {
    console.warn("[painel] Renovação da sessão falhou.", erro);
  }
  if (!novoToken || novoToken === token) return res;

  return fetch(url, {
    ...opts,
    headers: {
      ...(opts.headers as Record<string, string>),
      Authorization: `Bearer ${novoToken}`,
    },
  });
}

/** Monta a URL e delega. `body` `FormData` NÃO leva `Content-Type` — o
 *  navegador precisa escrever o `boundary` sozinho.
 *
 *  A assinatura nasceu igual à que os vinte e um pontos do painel legado
 *  chamavam (`caminho, método, corpo`), e `legacy/api.js` a reexportava como
 *  default — era o que permitia mover a lógica para cá sem tocar nas telas
 *  antigas. A Onda 7 apagou aquele arquivo e a ponte junto; a forma ficou.
 *
 *  A ÚNICA diferença para o original é o padrão do método, que lá era `"POST"`
 *  e aqui é `"GET"`: todo chamador passa o verbo explicitamente, e ler sem
 *  dizê-lo é o caso frequente no painel novo. */
export async function chamarApi(
  caminho: string,
  metodo: string = "GET",
  corpo?: unknown,
  extras: RequestInit = {},
): Promise<Response> {
  const opts: RequestInit = {
    method: metodo,
    ...extras,
    headers: { ...((extras.headers as Record<string, string>) || {}) },
  };

  if (metodo !== "GET" && metodo !== "HEAD") {
    if (corpo instanceof FormData) {
      opts.body = corpo;
    } else if (corpo !== undefined) {
      (opts.headers as Record<string, string>)["Content-Type"] =
        "application/json";
      opts.body = JSON.stringify(corpo);
    }
  }

  return authFetch(`${BASE_DA_API}${caminho}`, opts);
}

/**
 * O ENDEREÇO DE UMA IMAGEM DO CADASTRO — absoluta passa, relativa ganha o
 * prefixo da API.
 *
 * O CAMPO GUARDA AS DUAS COISAS, e é isso que obriga a existir uma função. Na
 * maioria dos cafés `image` é uma URL da Cloudinary, inteira; em cadastro
 * herdado do painel antigo ele é um caminho relativo (`/uploads/…`), que o
 * Express serve e que, sem prefixo, o navegador resolve contra a ORIGEM DO
 * PAINEL — onde não existe nada. O resultado é uma miniatura quebrada, numa
 * ficha em que a foto é justamente o que se está conferindo.
 *
 * O legado fazia exatamente isto (`AddedProducts.jsx:145`, `Form.jsx:89`), e a
 * reescrita desenhou a `<img>` com a URL crua — com o comentário ao lado
 * admitindo que o campo guarda caminho relativo. Este é o conserto.
 *
 * O TESTE É `startsWith("http")` COMO NO LEGADO, e mais dois casos que ele não
 * cobria: `//host/x.jpg` (protocol-relative, que o navegador já resolve sozinho)
 * e `data:` (o URI embutido que uma prévia local produz). Prefixar qualquer um
 * dos três produziria um endereço sem sentido.
 *
 * A JUNÇÃO NORMALIZA AS BARRAS. `BASE_DA_API` sai de `NEXT_PUBLIC_API_URL` como
 * a pessoa a escreveu — com barra no fim quando ela escreveu assim —, e o
 * caminho vem do banco, onde às vezes tem a barra inicial e às vezes não. As
 * quatro combinações têm de dar o mesmo endereço; concatenar direto daria
 * `host//uploads` numa delas e `hostuploads` noutra.
 *
 * VAZIO DEVOLVE VAZIO, e não a base: `<img src="http://api">` pede a raiz da API
 * e desenha o ícone de imagem quebrada. Quem chama já esconde a miniatura quando
 * não há foto, e devolver `""` mantém as duas ausências iguais.
 */
export function urlDaImagemDoPainel(
  caminho: string | null | undefined,
): string {
  const cru = (caminho ?? "").trim();
  if (!cru) return "";

  const jaEhEndereco =
    cru.startsWith("http") || cru.startsWith("//") || cru.startsWith("data:");
  if (jaEhEndereco) return cru;

  return `${BASE_DA_API.replace(/\/+$/, "")}/${cru.replace(/^\/+/, "")}`;
}
