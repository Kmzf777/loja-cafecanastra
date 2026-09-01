"use server";

import { revalidatePath } from "next/cache";

import { API_BASE } from "@/lib/api-base";
import { exigirAdminEmAcao } from "@/lib/conta/painel-servidor";
import { criarClienteServidor } from "@/lib/supabase/servidor";
import { fraseDeErro, lerCorpo } from "@/lib/painel/resposta";
import {
  ROTA_DE_PEDIDOS,
  numeroDoPedido,
  precisaDeRastreio,
  resumoDoLote,
  urlDoPedido,
} from "@/lib/painel/pedidos/pedidos.logica";

/**
 * As escritas da tela de Pedidos — mudar status, uma a uma e em lote.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * A PRIMEIRA LINHA DE CADA AÇÃO É `exigirAdminEmAcao()`, E ISSO NÃO É ESTILO.
 *
 * O layout de `(protegido)` NÃO protege Server Action. A ação POSTa para a
 * própria rota, EXECUTA, e só então a página re-renderiza — momento em que o
 * layout finalmente chama `exigirAdminNoPainel`. Ou seja: a checagem do layout
 * roda DEPOIS de o pedido já ter mudado de status, movimentado estoque e
 * disparado e-mail ao cliente. Quem descobrir o endereço de uma Server Action
 * pode invocá-la sem nunca renderizar a página.
 *
 * `lib/conta/painel-servidor.test.ts` lê o diretório e fica vermelho se um
 * arquivo com `"use server"` sob `app/dashboard/**` ou `lib/painel/**` não
 * chamar esta função — inclusive se a chamada estiver COMENTADA.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * POR QUE SERVER ACTION AQUI, E `chamarApi` DO NAVEGADOR NO BLING.
 *
 * Mudar status é uma escrita que muda a LISTA: o pedido sai da aba "A
 * despachar" e entra em "Enviado". `revalidatePath` refaz a leitura do
 * servidor, e a tabela volta coerente com o filtro — sem isso a linha ficaria
 * na tela dizendo "Aprovado" depois de o e-mail de envio ter saído.
 *
 * As ações do Bling são o oposto: a resposta traz o pedido inteiro, a fila NÃO
 * deve se reordenar embaixo do dedo de quem está trabalhando linha a linha, e
 * a trava de duplo clique é por pedido, num `ref`. Elas continuam saindo do
 * navegador, por `chamarApi` — ver `usarAcoesDoBling.ts`.
 */

export type ResultadoDaMudanca =
  | { ok: true; frase: string }
  | { ok: false; erro: string };

/**
 * O token de quem está logado, para o Express aplicar `isAdmin` e o Postgres
 * aplicar RLS.
 *
 * É uma segunda ida ao Supabase nesta requisição (a primeira foi
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
 * O PUT em UM pedido. Devolve a frase do servidor nos dois caminhos.
 *
 * `res.ok` É CONFERIDO — `fetch` não lança em 4xx/5xx, e é exatamente por não
 * conferir que o painel legado já anunciou "Produto deletado!" com o produto
 * intacto. E o corpo é lido por `lerCorpo`, nunca por `res.json()` cru: os
 * 401/403 do `isAuthenticated` saem por `sendStatus`, com corpo VAZIO, e um
 * `json()` desprotegido quebra com SyntaxError justamente no caminho de sessão
 * expirada.
 */
async function enviarStatus(
  token: string,
  orderId: string,
  status: string,
  codigoDeRastreio: string | null,
): Promise<ResultadoDaMudanca> {
  let res: Response;
  try {
    res = await fetch(`${API_BASE}/admin/orders/${orderId}/status`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      /*
        O backend lê `trackingCode` (camelCase) — é o nome do corpo desde o
        painel legado. `null` é o valor certo para "não há código": o campo
        aceita nulo, e entrega local não tem rastreio nenhum.
      */
      body: JSON.stringify({ status, trackingCode: codigoDeRastreio }),
      cache: "no-store",
    });
  } catch {
    return {
      ok: false,
      // Sem código HTTP: não houve resposta. Dizer "erro 500" apontaria para o
      // servidor da loja quando o problema pode ser a rede desta máquina.
      erro: "A API não respondeu. Nada foi alterado — tente de novo.",
    };
  }

  if (!res.ok) {
    /*
      A FRASE DO SERVIDOR GANHA SEMPRE. `Status inválido. Use um de: pendente,
      aprovado, …` diz o que fazer; "Erro ao salvar" transforma um problema de
      dois minutos num chamado.
    */
    return { ok: false, erro: fraseDeErro(res.status, await lerCorpo(res)) };
  }

  const corpo = await lerCorpo(res);
  return { ok: true, frase: corpo.message || "Status atualizado." };
}

/**
 * Muda o status de UM pedido.
 *
 * O CÓDIGO DE RASTREIO VAZIO SEGUE VAZIO, de propósito: a loja entrega na
 * região e entrega local não tem código. Obrigar um valor faria o gestor
 * inventar um — e um rastreio inventado vai por e-mail ao cliente.
 */
export async function mudarStatusDoPedido(
  orderId: string,
  status: string,
  codigoDeRastreio: string | null = null,
): Promise<ResultadoDaMudanca> {
  await exigirAdminEmAcao();

  const token = await tokenDaAcao();
  if (!token) {
    return { ok: false, erro: "Sua sessão expirou. Entre de novo para continuar." };
  }

  const codigo = precisaDeRastreio(status)
    ? (codigoDeRastreio ?? "").trim() || null
    : null;

  const resultado = await enviarStatus(token, orderId, status, codigo);
  if (resultado.ok) {
    revalidatePath(ROTA_DE_PEDIDOS);
    revalidatePath(urlDoPedido(orderId));
  }
  return resultado;
}

/**
 * Muda o status de VÁRIOS pedidos — o que a seleção em massa do R25 aciona.
 *
 * SEQUENCIAL, E NÃO `Promise.all`. Cada PUT abre uma transação que trava as
 * linhas de estoque dos produtos do pedido (`FOR UPDATE`, em ordem canônica).
 * Vinte transações concorrentes sobre o mesmo café disputam a mesma linha, e o
 * ganho de tempo seria de segundos contra o risco de espera em cascata. Vinte
 * idas sequenciais são o teto desta tela — a página tem vinte linhas.
 *
 * NÃO PARA NO PRIMEIRO ERRO. Um pedido que falhou (já cancelado, apagado por
 * outra pessoa) não é motivo para deixar os outros dezenove sem tratar; o que
 * a tela precisa é do PLACAR REAL, com a frase de cada falha. É a mesma lição
 * do `PATCH` em lote de avaliações: mostrar a contagem pedida em vez da
 * efetivada é mentir sobre a única coisa que a operação existe para informar.
 *
 * `enviado` não chega aqui — `STATUS_EM_LOTE` o exclui, porque o código de
 * rastreio é por pedido. A guarda está repetida abaixo porque uma Server
 * Action é uma superfície de rede: quem a invocar direto não passa pela tela.
 */
export async function mudarStatusEmLote(
  ids: string[],
  status: string,
): Promise<ResultadoDaMudanca> {
  await exigirAdminEmAcao();

  if (precisaDeRastreio(status)) {
    return {
      ok: false,
      erro:
        'Marcar como "Enviado" precisa do código de rastreio de cada pedido, ' +
        "então não vai em lote — abra os pedidos um a um.",
    };
  }

  const alvos = [...new Set(ids.filter(Boolean))];
  if (alvos.length === 0) {
    return { ok: false, erro: "Nenhum pedido marcado." };
  }

  const token = await tokenDaAcao();
  if (!token) {
    return { ok: false, erro: "Sua sessão expirou. Entre de novo para continuar." };
  }

  let atualizados = 0;
  const falhas: { numero: string; frase: string }[] = [];

  for (const id of alvos) {
    const resultado = await enviarStatus(token, id, status, null);
    if (resultado.ok) atualizados += 1;
    else falhas.push({ numero: numeroDoPedido(id), frase: resultado.erro });
  }

  // A revalidação acontece mesmo com falhas parciais: os que passaram MUDARAM,
  // e deixar a lista velha faria a tela discordar do placar que ela acabou de
  // mostrar.
  revalidatePath(ROTA_DE_PEDIDOS);
  for (const id of alvos) revalidatePath(urlDoPedido(id));

  const frase = resumoDoLote(atualizados, falhas);
  return falhas.length === 0 ? { ok: true, frase } : { ok: false, erro: frase };
}
