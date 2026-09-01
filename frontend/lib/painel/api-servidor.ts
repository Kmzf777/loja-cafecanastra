import { API_BASE } from "@/lib/api-base";
import { criarClienteServidor } from "@/lib/supabase/servidor";
import { ehSinalDoNext } from "@/lib/conta/painel-servidor";
import { fraseDeErro, lerCorpo } from "./resposta";

/**
 * A leitura autenticada da API Express feita DO SERVIDOR — o gêmeo de
 * `transporte.ts`, para o lado em que não existe navegador.
 *
 * POR QUE `authFetch` NÃO SERVE AQUI. Ele lê o token com
 * `clienteNavegador().auth.getSession()`, e `clienteNavegador` monta um cliente
 * que guarda a sessão em `localStorage`: num Server Component não há
 * `localStorage`, não há sessão para ler, e o `fetch` sairia SEM
 * `Authorization` — as rotas `/admin/*` responderiam 401 e a tela desenharia
 * "sua sessão expirou" para um gestor perfeitamente logado. A sessão, no
 * servidor, mora nos COOKIES da requisição, e quem os lê é
 * `criarClienteServidor`.
 *
 * `getSession()` E NÃO `getUser()`, ao contrário de `painel-servidor.ts`: ali a
 * pergunta é "quem é essa pessoa?", e a resposta tem de vir do GoTrue. Aqui a
 * pergunta é "qual token repassar?", e só `getSession()` devolve o
 * `access_token`. Quem confere o token é o `isAuthenticated` do Express, do
 * outro lado — não vale a pena uma ida a mais ao GoTrue para validar antes de
 * mandar a quem vai validar de novo. E a identidade já foi conferida: o
 * `layout.tsx` de `(protegido)` chamou `exigirAdminNoPainel` antes de qualquer
 * página deste grupo renderizar.
 *
 * O RESULTADO É UM TIPO SOMA, e não `T | null`. Toda tela do painel precisa
 * distinguir três coisas — "ainda não perguntei", "perguntei e falhou",
 * "perguntei e não veio nada" —, e é o `<EstadoDaTela>` que as desenha
 * diferente. Um `null` colapsa as duas últimas, e é assim que o painel legado
 * desenhava "nenhum pedido" com o banco fora do ar: zero é um número plausível,
 * então a mentira passa por verdade.
 *
 * NÃO É `"use server"` E NÃO É ROTA. É um módulo de leitura chamado de dentro
 * de Server Components, então `exigirAdminEmAcao()` não se aplica (ele guarda
 * Server Action e Route Handler, que escapam do layout); quem guarda estas
 * telas é o layout de `(protegido)`. Nenhuma função daqui escreve.
 */

export type Leitura<T> =
  | { ok: true; dados: T }
  | { ok: false; erro: string };

/** Oito segundos: mais do que o `/vitrine` (5s) porque as rotas do painel
 *  agregam e contam, e menos do que o gestor aguenta olhando para a tela. */
const ESPERA_PADRAO_MS = 8000;

async function tokenDaRequisicao(): Promise<string | null> {
  try {
    const supabase = await criarClienteServidor();
    const { data } = await supabase.auth.getSession();
    return data?.session?.access_token ?? null;
  } catch (erro) {
    // O `cookies()` lá dentro lança `DYNAMIC_SERVER_USAGE` durante o build —
    // ver o comentário de `ehSinalDoNext`. Engolido, ele viraria "não deu para
    // ler" e a rota seria prerenderizada mostrando erro para todo mundo.
    if (ehSinalDoNext(erro)) throw erro;
    console.warn("[painel] Não foi possível ler a sessão do servidor.", erro);
    return null;
  }
}

/**
 * `GET` autenticado, com a frase de erro já resolvida.
 *
 * A FRASE DO SERVIDOR GANHA SEMPRE (`fraseDeErro`): "Status inválido: 'pago'.
 * Use um de: …" é o diagnóstico, e trocá-la por "Erro ao carregar" transforma
 * um problema de dois minutos num chamado.
 *
 * `cache: "no-store"` porque quem abre o painel precisa ver o que ESTÁ no banco
 * agora. É a mesma decisão da tela de vitrine, e o oposto da home da loja, que
 * lê a mesma API com `revalidate` — leituras com propósitos opostos, políticas
 * opostas.
 */
export async function lerDaApi<T>(
  caminho: string,
  { esperaMs = ESPERA_PADRAO_MS }: { esperaMs?: number } = {},
): Promise<Leitura<T>> {
  const token = await tokenDaRequisicao();

  let res: Response;
  try {
    res = await fetch(`${API_BASE}${caminho}`, {
      cache: "no-store",
      signal: AbortSignal.timeout(esperaMs),
      headers: {
        Accept: "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
    });
  } catch (erro) {
    if (ehSinalDoNext(erro)) throw erro;
    console.warn(`[painel] GET ${caminho} não completou.`, erro);
    return {
      ok: false,
      // Sem código HTTP nenhum: não houve resposta. Dizer "erro 500" aqui
      // apontaria para o servidor da loja quando o problema pode ser a rede
      // desta máquina — e mandaria quem investiga para o lado errado.
      erro: "A API não respondeu. Recarregue a página; nada foi alterado.",
    };
  }

  if (!res.ok) {
    return { ok: false, erro: fraseDeErro(res.status, await lerCorpo(res)) };
  }

  try {
    return { ok: true, dados: (await res.json()) as T };
  } catch {
    // 200 com corpo que não é JSON: proxy interceptando, HTML de erro de
    // gateway. Tratar como sucesso entregaria `undefined` à tela, e ela
    // desenharia o estado vazio — "nenhum cliente" por causa de um nginx.
    return {
      ok: false,
      erro: "A API respondeu algo que não é JSON. Recarregue a página.",
    };
  }
}
