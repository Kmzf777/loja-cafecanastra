"use server";

import { revalidatePath } from "next/cache";

import { API_BASE } from "@/lib/api-base";
import { exigirAdminEmAcao } from "@/lib/conta/painel-servidor";
import { criarClienteServidor } from "@/lib/supabase/servidor";
import { fraseDeErro, lerCorpo } from "@/lib/painel/resposta";
import {
  LIMITE_DO_LOTE,
  ROTA_DE_AVALIACOES,
  STATUS_DE_AVALIACAO,
  resumoDaModeracao,
  type PlacarDaModeracao,
} from "@/lib/painel/avaliacoes/avaliacoes.logica";

/**
 * A escrita da tela de Avaliações — a moderação em lote.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * A PRIMEIRA LINHA É `exigirAdminEmAcao()`, E ISSO NÃO É ESTILO.
 *
 * O layout de `(protegido)` NÃO protege Server Action. A ação POSTa para a
 * própria rota, EXECUTA, e só então a página re-renderiza — momento em que o
 * layout finalmente chama `exigirAdminNoPainel`. A checagem do layout rodaria
 * DEPOIS de as avaliações já terem mudado de estado, e quem descobrir o
 * endereço de uma Server Action pode invocá-la sem nunca renderizar a página.
 *
 * `lib/conta/painel-servidor.test.ts` lê o diretório e fica vermelho se um
 * arquivo com `"use server"` sob `app/dashboard/**` ou `lib/painel/**` não
 * chamar esta função — inclusive se a chamada estiver COMENTADA.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * POR QUE UMA IDA SÓ, E NÃO UMA POR AVALIAÇÃO.
 *
 * A fila de moderação se resolve marcando várias e clicando uma vez. Vinte
 * `PATCH /admin/avaliacoes/:id` seriam vinte requisições para um gesto só, cada
 * uma podendo falhar sozinha — e a tela ficaria sem saber QUAL metade da fila
 * moderou. O `PATCH` do coletivo faz um `UPDATE ... WHERE id = ANY($2::uuid[])`
 * e devolve `{pedidas, atualizadas}`: um número, medido no banco.
 *
 * É o oposto de `mudarStatusEmLote` dos Pedidos, que é sequencial de propósito
 * — lá cada PUT abre transação que trava linha de estoque, e não existe rota de
 * lote. Aqui existe, e ela é a que diz a verdade sobre o efeito.
 */

export type ResultadoDaModeracao =
  | { ok: true; frase: string }
  | { ok: false; erro: string };

/**
 * O token de quem está logado, para o Express aplicar `isAdmin`.
 *
 * Segunda ida ao Supabase nesta requisição (a primeira foi
 * `exigirAdminEmAcao`, que usa `getUser()`), e ela é deliberada: `getUser()`
 * confere o token COM o GoTrue e é o certo para decidir acesso; `getSession()`
 * é o único que devolve o access token para repassar adiante.
 */
async function tokenDaAcao(): Promise<string | null> {
  const supabase = await criarClienteServidor();
  const { data } = await supabase.auth.getSession();
  return data?.session?.access_token ?? null;
}

/**
 * Modera um lote — e devolve a contagem REAL, nunca a pedida.
 *
 * AS GUARDAS ESTÃO REPETIDAS AQUI de propósito, embora a tela também as faça:
 * uma Server Action é uma SUPERFÍCIE DE REDE, e quem a invocar direto não passa
 * pela tabela. O backend valida tudo de novo (é ele a autoridade), mas recusar
 * aqui devolve a frase certa sem gastar uma ida.
 */
export async function moderarAvaliacoes(
  ids: string[],
  status: string,
): Promise<ResultadoDaModeracao> {
  await exigirAdminEmAcao();

  // `Set` porque um id repetido no corpo não é um erro do gestor, mas inflaria
  // `pedidas` e faria a frase acusar uma divergência que não existe.
  const alvos = [...new Set((ids ?? []).filter(Boolean))];

  if (alvos.length === 0) {
    return { ok: false, erro: "Nenhuma avaliação marcada." };
  }
  if (alvos.length > LIMITE_DO_LOTE) {
    return {
      ok: false,
      erro: `Modere no máximo ${LIMITE_DO_LOTE} avaliações por vez.`,
    };
  }
  if (!STATUS_DE_AVALIACAO.some((s) => s.valor === status)) {
    /*
      A frase nomeia os três valores que existem, como o backend faria. Vale a
      pena escrevê-la aqui porque este é o caminho em que `recusada` chega — e
      "Status inválido" sozinho mandaria o gestor adivinhar qual é o certo.
    */
    return {
      ok: false,
      erro: `Status inválido. Use um de: ${STATUS_DE_AVALIACAO.map((s) => s.valor).join(", ")}.`,
    };
  }

  const token = await tokenDaAcao();
  if (!token) {
    // Só acontece se a sessão morrer entre a checagem acima e esta linha.
    return { ok: false, erro: "Sua sessão expirou. Entre de novo para continuar." };
  }

  let res: Response;
  try {
    res = await fetch(`${API_BASE}/admin/avaliacoes`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ ids: alvos, status }),
      // O painel nunca lê de cache: quem modera precisa ver o que acabou de
      // gravar, não o que estava lá antes.
      cache: "no-store",
    });
  } catch (erro) {
    console.error("[painel] PATCH /admin/avaliacoes não chegou ao Express.", erro);
    return {
      ok: false,
      // Sem código HTTP nenhum: não houve resposta. Dizer "erro 500" apontaria
      // para o servidor da loja quando o problema pode ser a rede desta
      // máquina — e mandaria quem investiga para o lado errado.
      erro: "A API não respondeu. Nada foi alterado — tente de novo.",
    };
  }

  /*
    `res.ok` É CONFERIDO. `fetch` não lança em 4xx/5xx, e é exatamente por não
    conferir que o painel legado já anunciou "Produto deletado!" com o produto
    intacto. O corpo sai por `lerCorpo`, nunca por `res.json()` cru: os 401/403
    do `isAuthenticated` saem por `sendStatus`, com corpo VAZIO, e um `json()`
    desprotegido quebra com SyntaxError justamente no caminho de sessão
    expirada — o menos testado e o mais visitado numa quinta à noite.
  */
  if (!res.ok) {
    return { ok: false, erro: fraseDeErro(res.status, await lerCorpo(res)) };
  }

  const corpo = (await lerCorpo(res)) as Partial<PlacarDaModeracao>;

  /*
    UM 200 SEM PLACAR NÃO É SUCESSO. É o caso do proxy que devolve 200 com
    HTML, ou de um contrato que mudou: `lerCorpo` engole o que não é JSON e
    devolve `{}`, e tratar isso como "deu certo" faria a tela anunciar uma
    moderação que ninguém mediu — que é o defeito exato desta tela no painel
    legado, chegando pela outra porta.
  */
  const atualizadas = corpo.atualizadas;
  if (typeof atualizadas !== "number") {
    return {
      ok: false,
      erro:
        "O servidor respondeu sem dizer quantas avaliações mudaram. " +
        "Recarregue a página para ver o estado real da fila.",
    };
  }

  /*
    A REVALIDAÇÃO ACONTECE MESMO NO PARCIAL: as que passaram MUDARAM, e deixar
    a lista velha faria a tela discordar do placar que ela acabou de mostrar.

    SÓ ESTA ROTA É REVALIDADA. Aprovar publica a avaliação na PDP, e é tentador
    revalidar a página do café — mas a lista visível da PDP é uma ilha de
    cliente que lê o PostgREST em tempo de execução (`components/catalogo/
    Avaliacoes.tsx`), então ela já aparece na próxima visita, sem ajuda daqui.
    O que é servidor na PDP é o `aggregateRating` do JSON-LD, com
    `revalidate: 3600` — e alcançá-lo exigiria um mapa de `sku` para `slug` que
    a resposta do lote não traz. Chutar esse mapa para adiantar uma hora de
    dado estruturado seria mais frágil do que esperar a hora.
  */
  revalidatePath(ROTA_DE_AVALIACOES);

  const placar: PlacarDaModeracao = {
    pedidas: typeof corpo.pedidas === "number" ? corpo.pedidas : alvos.length,
    atualizadas,
  };
  const resumo = resumoDaModeracao(placar, status);

  return resumo.ok
    ? { ok: true, frase: resumo.frase }
    : { ok: false, erro: resumo.frase };
}
