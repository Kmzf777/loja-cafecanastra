/**
 * Cliente Supabase do NAVEGADOR.
 *
 * POR QUE `createBrowserClient` DO @supabase/ssr, E NÃO `createClient`
 * O `createClient` puro do supabase-js guarda a sessão no `localStorage`, que o
 * servidor nunca enxerga. A loja precisa do contrário: Server Components e
 * Route Handlers têm de reconhecer quem está logado para aplicar RLS no
 * servidor. `createBrowserClient` troca o storage por um adaptador sobre
 * `document.cookie` — a mesma sessão que `servidor.ts` lê de volta via
 * `next/headers`. Com `createClient` o usuário apareceria logado no navegador e
 * anônimo em toda renderização de servidor, e as consultas server-side
 * voltariam vazias por RLS sem erro nenhum.
 *
 * Ele também fixa `flowType: "pkce"`, que é o fluxo que grava o code verifier
 * em cookie — necessário para o callback de e-mail/OAuth ser trocado do lado do
 * servidor.
 */
import { createBrowserClient } from "@supabase/ssr";
import { ESQUEMA, chaveAnonima, urlSupabase } from "./ambiente";

function criar(url: string, chave: string) {
  return createBrowserClient(url, chave, {
    // Ver o comentário longo de ESQUEMA em ./ambiente.ts: sem isto tudo é 404.
    db: { schema: ESQUEMA },
    // O @supabase/ssr tem cache próprio, mas ele vive dentro do módulo do
    // pacote e some junto com ele. O cache confiável é o nosso, logo abaixo;
    // deixar os dois ligados só criaria duas fontes de verdade.
    isSingleton: false,
  });
}

type Cliente = ReturnType<typeof criar>;

/**
 * O singleton mora em `globalThis`, não num `let` de módulo.
 *
 * Um `let` de módulo é zerado sempre que o módulo é reavaliado, e isso acontece
 * de verdade: o Fast Refresh do `next dev` reavalia módulos a cada salvamento, e
 * o bundler pode duplicar um módulo entre chunks diferentes. Cada reavaliação
 * produziria OUTRO cliente — e cada cliente registra o seu próprio
 * `onAuthStateChange`.
 *
 * A Tarefa 4 pendura a fusão da sacola nesse evento. Dois listeners = a sacola
 * do cliente fundida duas vezes no login, ou seja, quantidades dobradas no
 * carrinho de quem acabou de entrar. `globalThis` sobrevive à reavaliação de
 * módulo e fecha esse buraco.
 */
const CHAVE_SINGLETON = "__supabaseCanastraNavegador__";
const raiz = globalThis as unknown as Record<string, Cliente | undefined>;

/**
 * Devolve SEMPRE a mesma instância dentro do navegador.
 *
 * No servidor (client components também são renderizados no servidor) devolve
 * uma instância nova e descartável, de propósito: `globalThis` no Node persiste
 * entre requisições de pessoas diferentes, então cachear ali um cliente que
 * guarda sessão vazaria a sessão de um visitante para outro. E o singleton só
 * importa no navegador — é lá que existe `onAuthStateChange`.
 */
export function clienteNavegador(): Cliente {
  const url = urlSupabase();
  const chave = chaveAnonima();

  const noNavegador = typeof window !== "undefined";
  if (!noNavegador) return criar(url, chave);

  const existente = raiz[CHAVE_SINGLETON];
  if (existente) return existente;

  const novo = criar(url, chave);
  raiz[CHAVE_SINGLETON] = novo;
  return novo;
}

/**
 * Só para os testes: apaga o cache para que cada caso comece do zero.
 *
 * Para o timer de renovação antes de soltar a instância. No navegador esse
 * timer é o que mantém a sessão viva, mas num teste ele continua disparando
 * depois do fim do caso, contra um `document` que já foi desmontado — barulho
 * no stderr que esconde falhas de verdade.
 */
export function _limparSingleton(): void {
  const antigo = raiz[CHAVE_SINGLETON];
  antigo?.auth.stopAutoRefresh().catch(() => {});
  delete raiz[CHAVE_SINGLETON];
}
