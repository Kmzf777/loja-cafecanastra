"use client";

import { useCallback, useRef, useState } from "react";

import { chamarApi } from "@/lib/painel/transporte";
import { lerCorpo } from "@/lib/painel/resposta";
import {
  acaoBling,
  fraseDeErro,
  type PedidoDoPainel,
} from "@/lib/painel/bling/contrato";

/**
 * As três ações do Bling — portadas de `legacy/.../Bling/useBlingAcoes.js`,
 * com a trava intacta.
 *
 * O NOME COMEÇA EM INGLÊS num painel escrito inteiro em português, e não é
 * descuido: a regra `react-hooks/rules-of-hooks` reconhece um hook pelo prefixo
 * `use` e só por ele. Batizado de `usarAcoesDoBling`, o `next build` FALHA
 * dizendo que os hooks estão sendo chamados fora de um componente — e a saída
 * seria calar a regra com um `eslint-disable`, que é justamente a que impede
 * hook dentro de `if` e de laço. O legado já tinha chegado à mesma conclusão
 * (`useBlingAcoes.js`): o prefixo é vocabulário da ferramenta, não da casa.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * 1. A TRAVA DE DUPLO CLIQUE É UM `useRef`, E NÃO `useState`.
 *
 * `setState` é ASSÍNCRONO: dois cliques no mesmo tick leem o mesmo estado
 * "livre" e disparam duas requisições. Com o `ref` a segunda encontra a marca
 * da primeira e desiste, porque a escrita no `.current` é imediata. Migrar isto
 * para `useState` reintroduz a corrida SEM NENHUM SINTOMA em teste manual — e
 * as três ações mexem na MESMA linha do banco.
 *
 * A trava é POR PEDIDO: o gestor pode sincronizar o pedido A enquanto o B emite
 * nota, que é como uma fila se trabalha. Dentro de um pedido, porém, qualquer
 * ação em voo tranca as três.
 *
 * O `useState` ao lado existe só para RE-RENDERIZAR (um `ref` mudando não
 * repinta nada). Ele é a fotografia da trava, nunca a trava.
 *
 * (O backend também se defende — o claim de `bling_situacao` existe para isso
 * —, mas defender-se aqui evita a ida inútil e a confusão de dois "carregando"
 * na mesma linha.)
 *
 * ────────────────────────────────────────────────────────────────────────────
 * 2. A LINHA SE ATUALIZA COM A RESPOSTA, SEM REFETCH.
 *
 * Toda rota de `/bling` devolve o `pedido` inteiro depois da ação. Recarregar a
 * lista seria uma segunda viagem para saber o que o servidor acabou de contar —
 * e faria a fila pular embaixo do dedo de quem está trabalhando linha a linha.
 * Quem funde os campos é `mesclarPedido`, com a lista congelada de nove campos:
 * um `{...linha, ...pedido}` apagaria `address`, `user_name`, `user_email` e
 * `user_cpf`, que a resposta de `/bling` NÃO traz.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * 3. NÃO HÁ TOAST — E É AQUI QUE ESTE HOOK DIVERGE DO LEGADO.
 *
 * O original chamava `toast.error` E `aoFalhar`, a mesma frase em dois lugares.
 * R9 é explícita: erro é banner persistente, nunca toast — um flash de 2s pode
 * não ser anunciado por leitor de tela, some para quem usa ampliação e não pode
 * ser relido por quem olhou tarde. Ficou só o caminho persistente.
 *
 * O AVISO DE SUCESSO TAMBÉM SOBE INTEIRO, e não vira "Pronto!": `message` vem
 * do servidor e é específica ("Este pedido já estava sincronizado com o
 * Bling.", "O Bling ainda não tem código de rastreio para este pedido.") —
 * dizer só "Pronto" perderia a diferença entre "fiz" e "não havia o que fazer",
 * que é a informação que o gestor quer.
 */
export function useAcoesDoBling({
  aoAtualizarPedido,
  aoFalhar,
  aoConcluir,
}: {
  aoAtualizarPedido?: (orderId: string, pedido: PedidoDoPainel) => void;
  aoFalhar?: (frase: string) => void;
  aoConcluir?: (frase: string) => void;
}) {
  /** `{ [orderId]: chaveDaAcao }` — a fotografia, para o JSX repintar. */
  const [emAndamento, setEmAndamento] = useState<Record<string, string>>({});
  /** A TRAVA. Escrita síncrona, lida antes de qualquer `await`. */
  const emAndamentoRef = useRef<Record<string, string>>({});

  const marcar = useCallback((orderId: string, chave: string | null) => {
    if (chave) emAndamentoRef.current[orderId] = chave;
    else delete emAndamentoRef.current[orderId];
    setEmAndamento({ ...emAndamentoRef.current });
  }, []);

  const acionar = useCallback(
    async (orderId: string, chaveDaAcao: string): Promise<boolean> => {
      const acao = acaoBling(chaveDaAcao);
      if (!acao || !orderId) return false;
      // A trava: segundo clique no mesmo pedido não vira segunda requisição.
      if (emAndamentoRef.current[orderId]) return false;

      marcar(orderId, acao.chave);
      try {
        const res = await chamarApi(acao.caminho(orderId), "POST");
        const corpo = await lerCorpo(res);

        /*
          `res.ok` conferido: `fetch` não lança em 4xx/5xx. Sem isto, um 503 de
          integração desligada cairia no caminho de sucesso e a tela diria
          "sincronizado" sobre um pedido que nunca saiu daqui.
        */
        if (!res.ok) {
          aoFalhar?.(fraseDeErro(res.status, corpo));
          return false;
        }

        aoConcluir?.(corpo.message || "Ação concluída no Bling.");
        const pedido = (corpo as Record<string, unknown>).pedido;
        if (pedido && typeof pedido === "object") {
          aoAtualizarPedido?.(orderId, pedido as PedidoDoPainel);
        }
        return true;
      } catch {
        aoFalhar?.(
          "Não foi possível falar com o servidor da loja para acionar o Bling.",
        );
        return false;
      } finally {
        // No `finally`: uma exceção que não destravasse deixaria os três botões
        // daquele pedido mortos até o F5.
        marcar(orderId, null);
      }
    },
    [aoAtualizarPedido, aoConcluir, aoFalhar, marcar],
  );

  return {
    /** A ação em voo neste pedido, ou `null`. */
    acaoEmAndamento: (orderId: string): string | null =>
      emAndamento[orderId] || null,
    acionar,
  };
}
