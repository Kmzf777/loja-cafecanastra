/**
 * Chamadas do painel legado à API Express.
 *
 * O QUE A TASK 6 MUDOU AQUI, E POR QUÊ
 *
 * 1. `/csrf-token` SUMIU — e este arquivo era o ponto mais afiado da Task 5.
 *    O `getCsrfToken()` antigo lançava quando a resposta não era ok, e ele era
 *    a PRIMEIRA linha de `fetchDataForm`. Com a rota devolvendo 404, nenhum
 *    formulário do painel chegava a emitir requisição nenhuma — nem os que não
 *    tinham nada a ver com CSRF (o catálogo, as categorias, a configuração da
 *    loja). Uma rota de autenticação apagada derrubava telas de leitura.
 *
 * 2. `X-CSRF-Token` NÃO PODE MAIS SER ENVIADO. O cabeçalho saiu de
 *    `allowedHeaders` no CORS do Express (`backend/src/index.js`): mandá-lo
 *    hoje faz o PREFLIGHT falhar, e o erro que aparece no console é de CORS,
 *    não de autenticação — dez minutos de investigação na direção errada.
 *    Nada neste arquivo monta esse cabeçalho.
 *
 * 3. `credentials: "include"` FICA. Não é sobra do esquema de cookie: o
 *    `cors({ credentials: true })` continua ligado do outro lado justamente
 *    porque a vitrine manda `include`, e a autenticação de verdade agora viaja
 *    em `Authorization: Bearer`.
 *
 * O TOKEN VEM DO CLIENTE SUPABASE, NUNCA DO ESTADO DO REACT. Este módulo é
 * importado por `contexts/searchProduct` e outros que rodam FORA da árvore do
 * `AuthProvider` — não há contexto para ler ali. Ler do supabase-js também é
 * o que mantém uma fonte de verdade só.
 */
import { clienteNavegador } from "../lib/supabase/cliente";

export const API_BASE =
  process.env.NEXT_PUBLIC_API_URL || "http://localhost:3333";

/**
 * Access token da sessão atual, ou `null`.
 *
 * `getSession()` é também o gatilho da RENOVAÇÃO: se o token expirou, o
 * supabase-js troca o refresh token aqui dentro antes de responder. É por isso
 * que o caminho de 401 lá embaixo é exceção, e não a regra.
 */
const tokenDeAcesso = async () => {
  try {
    const { data } = await clienteNavegador().auth.getSession();
    return data?.session?.access_token ?? null;
  } catch (erro) {
    // Variável de ambiente faltando (`ambiente.ts` lança com o nome dela) ou
    // rede fora. Seguir sem token é melhor do que não emitir a requisição: as
    // rotas públicas do catálogo continuam respondendo, e as privadas voltam
    // 401 — que é a verdade, e aparece como tal.
    console.warn("[legacy] Não foi possível ler a sessão do Supabase.", erro);
    return null;
  }
};

/**
 * `fetch` com o token do GoTrue, e com UMA renovação no máximo.
 *
 * SOMENTE 401 MERECE RENOVAÇÃO — esta é a decisão que este bloco existe para
 * fixar. O backend responde 403 com "Sua conta ainda não está vinculada a esta
 * loja." para um token PERFEITAMENTE VÁLIDO cujo dono não tem linha em
 * `canastra.clientes`. Ler isso como "sessão expirada" renovaria o token,
 * receberia o mesmo 403 e renovaria de novo, para sempre: um laço contra o
 * GoTrue que nunca converge, porque o problema nunca foi o token. O 403 sobe
 * para quem chamou, com a mensagem do servidor intacta.
 *
 * E a retentativa só acontece se o token REALMENTE MUDOU. Reenviar o mesmo
 * token contra a mesma rota é um segundo 401 garantido — requisição a mais,
 * resposta idêntica.
 */
export const authFetch = async (url, options = {}) => {
  const opts = { ...options, headers: { ...(options.headers || {}) } };
  opts.credentials = "include";

  const token = await tokenDeAcesso();
  if (token) opts.headers["Authorization"] = `Bearer ${token}`;

  const res = await fetch(url, opts);

  if (res.status !== 401 || !token) return res;

  let novoToken = null;
  try {
    const { data } = await clienteNavegador().auth.refreshSession();
    novoToken = data?.session?.access_token ?? null;
  } catch (erro) {
    console.warn("[legacy] Renovação da sessão falhou.", erro);
  }

  if (!novoToken || novoToken === token) return res;

  return fetch(url, {
    ...opts,
    headers: { ...opts.headers, Authorization: `Bearer ${novoToken}` },
  });
};

/**
 * Assinatura preservada: vinte e um pontos do painel chamam
 * `fetchDataForm(caminho, método, corpo)` e nenhum deles precisou de edição.
 */
const fetchDataForm = async (url, method = "POST", body, extraOpts = {}) => {
  const opts = {
    method,
    ...extraOpts,
    headers: { ...(extraOpts.headers || {}) },
  };

  if (method !== "GET" && method !== "HEAD") {
    if (body instanceof FormData) {
      opts.body = body;
    } else if (body !== undefined) {
      opts.headers["Content-Type"] = "application/json";
      opts.body = JSON.stringify(body);
    }
  }

  return authFetch(`${API_BASE}${url}`, opts);
};

export default fetchDataForm;
