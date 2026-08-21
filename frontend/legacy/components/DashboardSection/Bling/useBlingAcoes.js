import { useCallback, useRef, useState } from "react";
import { toast } from "react-toastify";

import { API_BASE } from "../../../api";
import { acaoBling, fraseDeErro, mesclarPedido } from "./blingContrato";

/**
 * As três ações do Bling, uma vez só, para as DUAS telas que as oferecem: a
 * fila de `/dashboard/bling` e o modal de detalhe de `Orders.jsx`.
 *
 * O gestor descobre que a nota não saiu enquanto olha o pedido — é ali que o
 * botão precisa estar. E a tela de Bling é onde ele trabalha a fila inteira.
 * Duplicar as três chamadas nos dois lugares significaria, no primeiro ajuste,
 * um lado tratando o 502 do jeito novo e o outro do jeito velho.
 *
 * O QUE ESTE HOOK GARANTE, e que é fácil errar escrevendo à mão:
 *
 * 1. TRAVA DE DUPLO CLIQUE POR PEDIDO, num `ref` e não no estado. `setState`
 *    é assíncrono: dois cliques no mesmo tick leem o mesmo estado "livre" e
 *    disparam duas requisições. Com o `ref` a segunda encontra a marca da
 *    primeira e desiste. A trava é POR PEDIDO — o gestor pode sincronizar o
 *    pedido A enquanto o B emite nota, que é como uma fila se trabalha.
 *    (O backend também se defende — o claim de `bling_situacao` existe para
 *    isso —, mas defender-se aqui evita a ida inútil e a confusão de dois
 *    "carregando" na mesma linha.)
 *
 * 2. A LINHA SE ATUALIZA COM A RESPOSTA, sem refetch. Toda rota de `/bling`
 *    devolve o `pedido` inteiro depois da ação; recarregar a página da lista
 *    seria uma segunda viagem para saber o que o servidor acabou de contar —
 *    e faria a fila pular embaixo do dedo do gestor.
 *
 * 3. A FRASE DO SERVIDOR CHEGA INTEIRA. Ver `fraseDeErro` em
 *    `blingContrato.js`: as mensagens de 503/502/422/409/504 foram escritas
 *    para este gestor ler.
 *
 * O toast some em 2s e é o aviso do canto do olho; `aoFalhar` leva a MESMA
 * frase para a tarja persistente da tela, que é onde ela pode ser lida com
 * calma (mesmo desenho do erro de status em Orders.jsx).
 */
export function useBlingAcoes({ authFetch, aoAtualizarPedido, aoFalhar } = {}) {
  // { [orderId]: chaveDaAcao } — só um gesto por pedido de cada vez.
  const [emAndamento, setEmAndamento] = useState({});
  const emAndamentoRef = useRef({});

  const marcar = useCallback((orderId, chave) => {
    if (chave) emAndamentoRef.current[orderId] = chave;
    else delete emAndamentoRef.current[orderId];
    setEmAndamento({ ...emAndamentoRef.current });
  }, []);

  const acionar = useCallback(
    async (orderId, chaveDaAcao) => {
      const acao = acaoBling(chaveDaAcao);
      if (!acao || !orderId) return false;
      // A trava: segundo clique no mesmo pedido não vira segunda requisição.
      if (emAndamentoRef.current[orderId]) return false;

      marcar(orderId, acao.chave);
      try {
        const res = await authFetch(`${API_BASE}${acao.caminho(orderId)}`, {
          method: "POST",
        });
        const corpo = await res.json().catch(() => null);

        if (!res.ok) {
          const frase = fraseDeErro(res.status, corpo);
          toast.error(frase);
          aoFalhar?.(frase);
          return false;
        }

        // `message` vem do servidor e é específica ("Este pedido já estava
        // sincronizado", "O Bling ainda não tem código de rastreio para este
        // pedido") — dizer só "Pronto!" perderia a diferença entre "fiz" e
        // "não havia o que fazer", que é a informação que o gestor quer.
        toast.success(corpo?.message || "Ação concluída no Bling.");
        if (corpo?.pedido) aoAtualizarPedido?.(orderId, corpo.pedido);
        return true;
      } catch (err) {
        console.error(`Erro na ação "${acao.chave}" do Bling`, err);
        const frase =
          "Não foi possível falar com o servidor da loja para acionar o Bling.";
        toast.error(frase);
        aoFalhar?.(frase);
        return false;
      } finally {
        marcar(orderId, null);
      }
    },
    [authFetch, aoAtualizarPedido, aoFalhar, marcar],
  );

  return {
    /** `{ [orderId]: chaveDaAcao }` — o que está em voo agora. */
    emAndamento,
    /** A ação em voo neste pedido, ou `null`. */
    acaoEmAndamento: (orderId) => emAndamento[orderId] || null,
    acionar,
  };
}

export default useBlingAcoes;

/**
 * `GET /bling/status` — a sonda, isolada do hook porque quem a chama é UMA
 * tela (a de Bling) e ela não tem nada a ver com a trava por pedido.
 *
 * Devolve sempre `{ status, erro }`: a sonda responde 200 mesmo com tudo
 * desligado (é o endpoint que DIAGNOSTICA o desligado), então um erro aqui
 * significa problema no servidor da loja, não no Bling — e a tela precisa
 * dizer qual dos dois é.
 */
export async function buscarStatusDoBling(authFetch) {
  try {
    const res = await authFetch(`${API_BASE}/bling/status`);
    const corpo = await res.json().catch(() => null);
    if (!res.ok) return { status: null, erro: fraseDeErro(res.status, corpo) };
    return { status: corpo || {}, erro: null };
  } catch (err) {
    console.error("Erro ao consultar o status do Bling", err);
    return {
      status: null,
      erro: "Não foi possível falar com o servidor da loja.",
    };
  }
}
