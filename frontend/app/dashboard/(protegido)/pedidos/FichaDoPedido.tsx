"use client";

import { useState } from "react";

import { Ficha } from "@/components/painel/ui/Ficha";
import { mesclarPedido } from "@/lib/painel/bling/contrato";
import type { PedidoDoPainel } from "@/lib/painel/pedidos/pedidos.logica";

import { DetalheDoPedido } from "./DetalheDoPedido";

/**
 * O detalhe na ROTA PRÓPRIA — a casca de cliente que `/dashboard/pedidos/[id]`
 * precisa e a `page.tsx` não pode ser.
 *
 * `DetalheDoPedido` recebe `aoAtualizarPedido`, que é uma FUNÇÃO, e função não
 * atravessa a fronteira Server→Client serializada. Um Server Component que a
 * passasse faria o React lançar "Functions cannot be passed directly to Client
 * Components" — e isso NÃO aparece no `next build`, porque as rotas do painel
 * são dinâmicas: o erro só existiria em execução, com a tela em branco na
 * frente do gestor.
 *
 * A CÓPIA LOCAL DO PEDIDO existe pelo mesmo motivo da lista: a resposta de uma
 * ação do Bling traz o pedido inteiro, e mesclá-la campo a campo evita uma
 * segunda ida ao servidor para saber o que ele acabou de contar. `mesclarPedido`
 * (e não spread) porque a resposta de `/bling` não traz `address`, `user_name`,
 * `user_email` nem `user_cpf`.
 *
 * A reconciliação por identidade de prop é a mesma de `ListaDePedidos`: quando
 * uma mudança de status revalida a rota, o dado do servidor ganha da cópia.
 */
export function FichaDoPedido({
  pedido: doServidor,
  blingLigado,
}: {
  pedido: PedidoDoPainel;
  blingLigado: boolean | null;
}) {
  const [pedido, setPedido] = useState(doServidor);
  const [ultimoDoServidor, setUltimoDoServidor] = useState(doServidor);
  if (doServidor !== ultimoDoServidor) {
    setUltimoDoServidor(doServidor);
    setPedido(doServidor);
  }

  return (
    <Ficha semPreenchimento className="max-w-[46rem]">
      <DetalheDoPedido
        pedido={pedido}
        blingLigado={blingLigado}
        aoAtualizarPedido={(_orderId, parcial) =>
          setPedido(
            (atual) =>
              mesclarPedido(
                atual as unknown as Record<string, unknown>,
                parcial as unknown as Record<string, unknown>,
              ) as unknown as PedidoDoPainel,
          )
        }
      />
    </Ficha>
  );
}
