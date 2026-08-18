"use client";

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
 *
 * POR QUE O `"use client"` ACIMA
 * Sem a diretiva, um Server Component pode importar este módulo sem reclamação
 * nenhuma. Ele cairia no ramo fora-do-navegador de `clienteNavegador()`, e o
 * @supabase/ssr dá a um cliente de navegador criado fora do navegador um
 * `getAll` que devolve `[]` — ou seja, um cliente que afirma, com toda a
 * calma, que ninguém está logado. Página renderizada como visitante anônimo,
 * RLS negando tudo, zero erro em qualquer lugar. É a mesma falha silenciosa
 * que os outros comentários deste arquivo existem para impedir.
 *
 * Com a diretiva, esse import vira um erro NOMEADO do React Server Components
 * em vez de uma sessão fantasma. O SSR de um componente de cliente de verdade
 * — a válvula deliberada logo abaixo — continua funcionando, porque módulo de
 * cliente ainda é executado no servidor durante o SSR.
 *
 * `ambiente.ts` NÃO leva a diretiva: ele é código comum e continua servindo
 * `servidor.ts`, que roda justamente do lado proibido aqui.
 */
import { createBrowserClient } from "@supabase/ssr";
import { ESQUEMA, chaveAnonima, urlSupabase } from "./ambiente";
import type { Database } from "./tipos";

function criar(url: string, chave: string) {
  return createBrowserClient<Database, typeof ESQUEMA>(url, chave, {
    // Ver o comentário longo de ESQUEMA em ./ambiente.ts: sem isto tudo é 404.
    db: { schema: ESQUEMA },
    // Desliga o cache do @supabase/ssr para que o cache seja um só, o daqui.
    // Com os dois ligados, `_limparSingletonParaTestes()` limparia o nosso e o
    // da biblioteca responderia no lugar — duas fontes de verdade, e a de fora
    // não é limpável nem inspecionável. O teste "respeita a configuração nova
    // depois de limpar o cache" existe para esta linha.
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
 * A Tarefa 4 pendura a fusão da sacola nesse evento, e a fusão NÃO é idempotente
 * (0007): chamada duas vezes, soma duas vezes. `globalThis` sobrevive à
 * reavaliação de módulo e fecha esse buraco.
 *
 * ISTO NÃO DISPENSA UMA TRAVA DE FUSÃO, e ler o parágrafo acima como "problema
 * resolvido" seria o erro. O Fast Refresh reavalia também o módulo que se
 * INSCREVE no evento: um único cliente com dois `onAuthStateChange` registrados
 * dobra a sacola exatamente igual. Além disso o supabase-js dispara o evento
 * mais de uma vez por sessão sozinho (INITIAL_SESSION, SIGNED_IN,
 * TOKEN_REFRESHED). O singleton fecha uma das portas; a trava do lado de quem
 * consome é obrigatória de qualquer jeito.
 */
const CHAVE_SINGLETON = "__supabaseCanastraNavegador__";
const raiz = globalThis as unknown as Record<string, Cliente | undefined>;

/**
 * Devolve SEMPRE a mesma instância dentro do navegador.
 *
 * No servidor (um componente de cliente também é renderizado no servidor, no
 * SSR) devolve uma instância nova e descartável, de propósito: `globalThis` no
 * Node persiste entre requisições de pessoas diferentes, então cachear ali um
 * cliente que guarda sessão vazaria a sessão de um visitante para outro. E o
 * singleton só importa no navegador — é lá que existe `onAuthStateChange`.
 *
 * Essa instância de SSR não enxerga sessão nenhuma (não há cookie a ler fora do
 * navegador). Quem precisa de sessão no servidor usa `criarClienteServidor()`.
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
 * APENAS PARA TESTES: apaga o cache para que cada caso comece do zero.
 *
 * Inerte em produção de propósito. Ele vai no bundle — é exportado e importado
 * pelo teste, então nenhum tree-shaking o remove — e a única coisa entre ele e
 * uma chamada distraída seria o `_` do nome. Chamado em produção, criar o
 * próximo cliente devolveria uma SEGUNDA instância, com um segundo
 * `onAuthStateChange`, que é precisamente o que o resto do arquivo impede.
 *
 * Para o timer de renovação antes de soltar a instância. No navegador esse
 * timer é o que mantém a sessão viva, mas num teste ele continua disparando
 * depois do fim do caso, contra um `document` que já foi desmontado — barulho
 * no stderr que esconde falhas de verdade.
 */
export function _limparSingletonParaTestes(): void {
  if (process.env.NODE_ENV === "production") {
    console.error(
      "[supabase] _limparSingletonParaTestes() foi chamada em produção e " +
        "ignorada. Ela existe só para o teste; em produção soltar o cache " +
        "criaria um segundo cliente e um segundo onAuthStateChange.",
    );
    return;
  }
  const antigo = raiz[CHAVE_SINGLETON];
  antigo?.auth.stopAutoRefresh().catch(() => {});
  delete raiz[CHAVE_SINGLETON];
}
