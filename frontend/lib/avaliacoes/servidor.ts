/**
 * O agregado de avaliações para a PDP ESTÁTICA — fetch cru ao PostgREST.
 *
 * POR QUE NÃO `criarClienteServidor()`: ele chama `cookies()`, e qualquer
 * página que toque `cookies()` deixa de ser estática. A PDP é gerada no build
 * (`generateStaticParams` + `dynamicParams = false`) e revalidada a cada hora
 * (`export const revalidate = 3600` na página) — o `aggregateRating` do
 * JSON-LD só precisa da leitura ANÔNIMA, e a RLS de 0014 já garante que a
 * chave anônima enxerga apenas `status = 'aprovada'`.
 *
 * POR QUE `fetch` E NÃO o supabase-js sem cookies: é o `fetch` do Next que
 * carrega o `next: { revalidate }` — o cache incremental por URL. O supabase-js
 * aceitaria um fetch customizado, mas seria indireção para chegar na mesma
 * chamada.
 *
 * ERRO → `null`, SEMPRE: variável de ambiente ausente no build, PostgREST
 * fora, resposta estranha — nenhum desses pode derrubar o build da PDP. Sem
 * agregado, a página sai sem `aggregateRating`, que é o comportamento correto
 * ("não invente nota" é a mesma regra do preço em jsonld.ts).
 */
import { ESQUEMA, chaveAnonima, urlSupabase } from "../supabase/ambiente";
import { TETO_DE_NOTAS, mediaDeNotas } from "./tipos";
import type { AgregadoDeAvaliacoes } from "./tipos";

/**
 * O MESMO valor do `export const revalidate` da PDP — o fetch expira junto
 * com a página; um número maior aqui seguraria um rating velho numa página
 * nova.
 */
export const REVALIDAR_SEGUNDOS = 3600;

/**
 * TETO DE ESPERA, e ele é obrigatório aqui.
 *
 * `fetch` não tem timeout próprio: um PostgREST que aceita a conexão e nunca
 * responde deixa esta promessa pendurada para SEMPRE. E como a PDP é estática
 * (`generateStaticParams` + `dynamicParams = false`), essa espera não atrasa
 * uma requisição — ela segura a GERAÇÃO DE TODAS AS PDPs, ou seja, o build
 * inteiro, sem log e sem erro.
 *
 * 3 segundos porque a alternativa a esperar é boa: o `catch` abaixo devolve
 * `null` e a página sai sem `aggregateRating`, que é exatamente o desfecho
 * previsto para "não deu para perguntar". Melhor uma PDP sem estrelinha no
 * JSON-LD que um build travado.
 */
const ESPERA_MAXIMA_MS = 3000;

/**
 * Média + contagem das avaliações aprovadas de uma lista de SKUs, ou `null`
 * quando não há nenhuma (ou quando não deu para perguntar).
 */
export async function agregadoAprovadas(
  skus: string[],
): Promise<AgregadoDeAvaliacoes | null> {
  if (skus.length === 0) return null;

  try {
    // Aspas em cada valor do `in.(...)`: um SKU com vírgula ou parêntese não
    // pode virar sintaxe. Aspas/backslashes DENTRO do SKU são removidos — não
    // existem no catálogo, e um valor desses seria injeção, não dado.
    const lista = skus
      .map((s) => `"${s.replace(/["\\]/g, "")}"`)
      .join(",");
    const parametros = new URLSearchParams({
      select: "nota",
      status: "eq.aprovada",
      sku: `in.(${lista})`,
      limit: String(TETO_DE_NOTAS),
    });

    const resposta = await fetch(
      `${urlSupabase()}/rest/v1/avaliacoes?${parametros}`,
      {
        headers: {
          apikey: chaveAnonima(),
          Authorization: `Bearer ${chaveAnonima()}`,
          // Sem este cabeçalho o PostgREST procura `avaliacoes` em `public`
          // e responde 404 com o banco perfeito — a falha nº 1 deste stack
          // (ver lib/supabase/ambiente.ts).
          "Accept-Profile": ESQUEMA,
        },
        next: { revalidate: REVALIDAR_SEGUNDOS },
        // Estourado o prazo, o `fetch` rejeita com TimeoutError e o `catch`
        // logo abaixo transforma isso em `null`, como qualquer outra falha.
        signal: AbortSignal.timeout(ESPERA_MAXIMA_MS),
      },
    );
    if (!resposta.ok) return null;

    const linhas: unknown = await resposta.json();
    if (!Array.isArray(linhas)) return null;

    const notas = linhas
      .map((linha) => Number((linha as { nota?: unknown }).nota))
      .filter((n) => Number.isFinite(n));
    if (notas.length === 0) return null;

    // `mediaDeNotas` mora em `./tipos` e é a MESMA conta do módulo do
    // navegador: média de servidor divergindo da média da ilha seria um número
    // no JSON-LD e outro na tela da mesma página.
    return { media: mediaDeNotas(notas), contagem: notas.length };
  } catch {
    return null;
  }
}
