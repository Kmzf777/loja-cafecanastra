"use client";

import type { ReactNode } from "react";

import { Selo } from "@/components/painel/ui/Selo";
import { ETIQUETA } from "@/components/painel/ui/estilos";
import { formatarDataHora } from "@/lib/painel/data";
import { formatarReais } from "@/lib/painel/dinheiro";
import { rotuloDoStatus, tomDoStatus } from "@/lib/painel/status";
import {
  enderecoDoPedido,
  lerItens,
  numeroDoPedido,
  totalDeUnidades,
  type PedidoDoPainel,
} from "@/lib/painel/pedidos/pedidos.logica";

import { BlocoDoBling } from "./BlocoDoBling";
import { MudarStatus } from "./MudarStatus";

/**
 * O CORPO DO DETALHE — o mesmo nas duas portas de entrada.
 *
 * Ele aparece no painel lateral da lista (o caminho de triagem, R26) e na rota
 * própria `/dashboard/pedidos/[id]` (o deep-link, que só existe desde que
 * `GET /admin/orders/:id` foi aberta). Um componente só, porque duas cópias
 * divergem no primeiro ajuste — e a primeira coisa a divergir seria justamente
 * o bloco do Bling, que é o que menos pode.
 *
 * A ORDEM DOS BLOCOS É A DA PERGUNTA QUE O GESTOR TEM NA MÃO ao abrir um
 * pedido: quem é e para onde vai (despachar), o que mudou de status, o que se
 * cobrou, se a nota saiu, e o que tem dentro da caixa. O total fica no fim
 * porque é a conferência, não a pergunta.
 */

/** Um par rótulo/valor. O rótulo é carimbo (11px, caixa alta); o valor é
 *  texto normal — a hierarquia é de VOZ, não de tamanho. */
function Dado({
  rotulo,
  children,
  largo = false,
}: {
  rotulo: string;
  children: ReactNode;
  largo?: boolean;
}) {
  return (
    <div className={largo ? "sm:col-span-2" : undefined}>
      <dt className={`text-[10px] ${ETIQUETA} text-fuligem-55`}>{rotulo}</dt>
      <dd className="mt-0.5 break-words text-[13px]">{children}</dd>
    </div>
  );
}

/** Uma seção do detalhe. Não é `<Ficha>` de propósito: dentro do painel lateral
 *  (que já é uma folha sobre a cal) uma ficha por bloco desenharia caixa dentro
 *  de caixa. Aqui a separação é o filete de topo — a mesma gramática, um nível
 *  abaixo. */
function Bloco({ titulo, children }: { titulo: string; children: ReactNode }) {
  return (
    <section aria-label={titulo} className="border-t border-fuligem-20 px-5 py-4">
      <h3 className={`text-[11px] ${ETIQUETA} text-fuligem`}>{titulo}</h3>
      <div className="mt-3">{children}</div>
    </section>
  );
}

const GRADE = "grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2";

export function DetalheDoPedido({
  pedido,
  blingLigado,
  aoAtualizarPedido,
}: {
  pedido: PedidoDoPainel;
  blingLigado: boolean | null;
  aoAtualizarPedido: (orderId: string, parcial: PedidoDoPainel) => void;
}) {
  const itens = lerItens(pedido.items);
  const unidades = totalDeUnidades(pedido.items);
  const desconto = Number(pedido.discount ?? 0);

  return (
    <div>
      <div className="px-5 py-4">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          {/* O NÚMERO É O DO E-MAIL DO CLIENTE (oito primeiros dígitos) e vai em
              `data-dado`: monoespaçada com numeral tabular, que é o que faz
              conferir dois pedidos ser conferir posição. */}
          <p data-dado className="text-[18px] font-medium leading-none">
            #{numeroDoPedido(pedido.order_id)}
          </p>
          <Selo tom={tomDoStatus(pedido.status)}>{rotuloDoStatus(pedido.status)}</Selo>
        </div>
        <p className="mt-2 text-[12px] text-fuligem-55">
          {/* Data COM hora, ao contrário da lista: aqui ela decide alguma coisa
              ("entrou antes ou depois do corte das 14h?"). R31 — fuso de São
              Paulo, senão um pedido das 22h aparece no dia seguinte. */}
          Feito em <span data-dado>{formatarDataHora(pedido.created_at)}</span>
        </p>
        {/* O UUID INTEIRO SÓ AQUI, e em texto selecionável: é o que se cola num
            chamado ou numa consulta ao banco. Na lista ele nunca aparece (R23). */}
        <p data-dado className="mt-1 select-all break-all text-[11px] text-fuligem-55">
          {pedido.order_id}
        </p>
      </div>

      <Bloco titulo="Situação">
        <MudarStatus orderId={pedido.order_id} statusAtual={pedido.status} />
      </Bloco>

      <Bloco titulo="Cliente">
        <dl className={GRADE}>
          <Dado rotulo="Nome">{pedido.user_name || "—"}</Dado>
          <Dado rotulo="E-mail">{pedido.user_email || "—"}</Dado>
          {/* "Não informado" e não "—": o CPF ausente é a diferença entre poder
              e não poder emitir a nota, e um travessão no meio de outros
              travessões não conta essa história. */}
          <Dado rotulo="CPF">
            <span data-dado>{pedido.user_cpf || "Não informado"}</span>
          </Dado>
        </dl>
      </Bloco>

      <Bloco titulo="Entrega">
        <dl className={GRADE}>
          <Dado rotulo="Endereço" largo>
            {enderecoDoPedido(pedido.address)}
          </Dado>
          <Dado rotulo="Método">{pedido.shipping_method || "Não informado"}</Dado>
          <Dado rotulo="Frete">
            {/* REAIS, como string — `formatarReais`, nunca `formatarCentavos`.
                O mesmo painel lê `preco_centavos` em outras telas. */}
            <span data-dado>{formatarReais(pedido.shipping_cost)}</span>
          </Dado>
          {pedido.tracking_code && (
            <Dado rotulo="Rastreio" largo>
              <span data-dado className="select-all">
                {pedido.tracking_code}
              </span>
            </Dado>
          )}
        </dl>
      </Bloco>

      <Bloco titulo="Pagamento">
        <dl className={GRADE}>
          <Dado rotulo="Método">
            {/* Caixa alta porque é sigla de meio de pagamento (PIX, BOLETO) e
                é assim que ela aparece no extrato do Mercado Pago. */}
            {(pedido.payment_method || "—").toUpperCase()}
          </Dado>
          {pedido.coupon_code && (
            <Dado rotulo="Cupom">
              <span data-dado>{pedido.coupon_code}</span>
            </Dado>
          )}
          {desconto > 0 && (
            <Dado rotulo="Desconto">
              {/* O sinal de menos é o U+2212 (menos matemático), não o hífen:
                  ele tem a mesma largura do numeral tabular e alinha na coluna.
                  Verde porque desconto é dinheiro que SAIU do total — e é a
                  única cor do bloco. */}
              <span data-dado className="text-sucesso">
                −{formatarReais(pedido.discount)}
              </span>
            </Dado>
          )}
          <Dado rotulo="Total">
            <span data-dado className="text-[15px] font-medium">
              {formatarReais(pedido.total_amount)}
            </span>
          </Dado>
        </dl>
      </Bloco>

      <Bloco titulo="Bling (ERP e NF-e)">
        <BlocoDoBling
          pedido={pedido}
          blingLigado={blingLigado}
          aoAtualizarPedido={aoAtualizarPedido}
        />
      </Bloco>

      <Bloco titulo="Itens">
        {itens.length === 0 ? (
          /* Pedido sem item legível existe: `itens` é `jsonb` e pedidos antigos
             gravaram texto. Dizer isso é melhor do que uma lista vazia, que se
             lê como "o pedido está vazio". */
          <p className="text-[13px] text-fuligem-55">
            Não foi possível ler os itens deste pedido — o registro está num
            formato antigo.
          </p>
        ) : (
          <>
            <ul className="divide-y divide-fuligem-20 border-y border-fuligem-20">
              {itens.map((item, indice) => (
                <li
                  key={`${item.sku ?? item.name ?? "item"}-${indice}`}
                  className="flex items-baseline justify-between gap-4 py-2"
                >
                  <span className="min-w-0">
                    <span className="block text-[13px]">{item.name || "Item sem nome"}</span>
                    <span className="block text-[12px] text-fuligem-55">
                      {item.size ? `${item.size} · ` : ""}
                      <span data-dado>{item.quantity ?? 1}</span> un.
                      {item.sku ? (
                        <>
                          {" · "}
                          <span data-dado>{item.sku}</span>
                        </>
                      ) : null}
                    </span>
                  </span>
                  {/* Preço UNITÁRIO congelado na venda, em reais. Não é o
                      subtotal da linha: multiplicar aqui inventaria um número
                      que o backend não gravou e que não bate com o CSV. */}
                  <span data-dado className="shrink-0 text-[13px]">
                    {formatarReais(item.price ?? null)}
                  </span>
                </li>
              ))}
            </ul>
            <p className="mt-2 text-[12px] text-fuligem-55">
              <span data-dado>{unidades}</span>{" "}
              {unidades === 1 ? "unidade" : "unidades"} em{" "}
              <span data-dado>{itens.length}</span>{" "}
              {itens.length === 1 ? "linha" : "linhas"}
            </p>
          </>
        )}
      </Bloco>
    </div>
  );
}
