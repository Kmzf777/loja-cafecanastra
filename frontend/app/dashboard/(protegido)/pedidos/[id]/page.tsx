import Link from "next/link";
import type { Metadata } from "next";

import { Cabecalho } from "@/components/painel/casca/Cabecalho";
import { EstadoDaTela } from "@/components/painel/ui/EstadoDaTela";
import { FOCO } from "@/components/painel/ui/estilos";
import { lerAcessoDoPainel } from "@/lib/conta/painel-servidor";
import { lerDaApi } from "@/lib/painel/api-servidor";
import {
  ROTA_DE_PEDIDOS,
  numeroDoPedido,
  type RespostaDeUmPedido,
} from "@/lib/painel/pedidos/pedidos.logica";

import { FichaDoPedido } from "../FichaDoPedido";

/**
 * `/dashboard/pedidos/[id]` — o DEEP-LINK do pedido, que até a Onda 4 não
 * existia.
 *
 * O detalhe do painel legado só existia como um modal aberto A PARTIR DA LINHA:
 * a tela guardava a linha em memória e a mostrava. Não havia endereço para
 * mandar a alguém, não havia como voltar por favorito, e um F5 no meio da
 * conferência devolvia a lista do começo. `GET /admin/orders/:id` (aberta na
 * Onda 4) é o que torna esta rota possível.
 *
 * ELA CONVIVE COM O PAINEL LATERAL, e as duas não competem: o painel é o
 * caminho de TRIAGEM (abrir vinte pedidos em sequência sem sair da lista), esta
 * rota é o caminho de REFERÊNCIA (o endereço que se cola num chamado, no e-mail
 * do contador, na conversa com o cliente). O corpo é o MESMO componente —
 * `DetalheDoPedido` —, então nunca há duas verdades sobre o mesmo pedido.
 */
export const metadata: Metadata = {
  title: "Pedido",
  robots: { index: false, follow: false },
};

type StatusDoBling = { ativo?: boolean };

export default async function PaginaDeUmPedido({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const [acesso, { id }] = await Promise.all([lerAcessoDoPainel(), params]);

  const [resposta, sonda] = await Promise.all([
    lerDaApi<RespostaDeUmPedido>(`/admin/orders/${encodeURIComponent(id)}`),
    lerDaApi<StatusDoBling>("/bling/status"),
  ]);
  // `null` quando a sonda não respondeu — e `null` NÃO desabilita nada: o
  // servidor continua sendo a autoridade sobre o que o Bling aceita.
  const blingLigado = sonda.ok ? Boolean(sonda.dados?.ativo) : null;

  const pedido = resposta.ok ? resposta.dados?.order : null;

  return (
    <>
      <Cabecalho
        /* O TÍTULO É O NÚMERO DO CLIENTE, não o UUID — R23 vale aqui como vale
           na lista. O UUID inteiro aparece uma vez, dentro do detalhe, em texto
           selecionável, porque é ele que se cola numa consulta ao banco. */
        titulo={`Pedido #${numeroDoPedido(id)}`}
        descricao="Aberto por link direto. Para triar vários seguidos, use o painel lateral da lista."
        email={acesso.email}
      />

      <div className="mx-auto max-w-[1200px] space-y-4 px-5 py-6">
        <Link
          href={ROTA_DE_PEDIDOS}
          className={`inline-flex min-h-11 items-center text-[13px] underline decoration-1 underline-offset-4 hover:decoration-2 ${FOCO}`}
        >
          ← Voltar para a lista de pedidos
        </Link>

        <EstadoDaTela
          carregando={false}
          esqueleto={null}
          /*
            A FRASE DO SERVIDOR CHEGA INTEIRA. O backend distingue de propósito
            "Identificador de pedido inválido." (400, id truncado no copiar e
            colar) de "Pedido não encontrado." (404) — e ele distingue AQUI e não
            em `/my-orders/:id`, onde tudo responde 404 para não confirmar a
            existência de pedido alheio a quem enumera ids. Trocar as duas por
            "Erro ao carregar" mandaria o gestor procurar no lugar errado.
          */
          erro={
            resposta.ok && !pedido
              ? "A API respondeu sem o pedido. Recarregue a página."
              : resposta.ok
                ? null
                : resposta.erro
          }
          vazio={false}
          vazioTitulo="Pedido não encontrado"
          vazioTexto="Confira o endereço — o identificador pode ter sido cortado ao copiar."
        >
          {pedido && <FichaDoPedido pedido={pedido} blingLigado={blingLigado} />}
        </EstadoDaTela>
      </div>
    </>
  );
}
