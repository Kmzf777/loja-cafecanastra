"use client";

import { useState } from "react";

import { Botao } from "@/components/painel/ui/Botao";
import { Selo } from "@/components/painel/ui/Selo";
import { Tarja } from "@/components/painel/ui/Tarja";
import { FOCO } from "@/components/painel/ui/estilos";
import {
  ACOES_BLING,
  estadoDoBling,
  pedidoPodeIrAoBling,
  type PedidoDoPainel as PedidoDoContrato,
} from "@/lib/painel/bling/contrato";
import { formatarDataHora } from "@/lib/painel/data";
import { tomDoBling, type PedidoDoPainel } from "@/lib/painel/pedidos/pedidos.logica";

import { useAcoesDoBling } from "./useAcoesDoBling";

/**
 * O BLING DENTRO DO DETALHE DO PEDIDO — porque é AQUI que o gestor está quando
 * percebe que a nota não saiu.
 *
 * Mandá-lo trocar de tela e reencontrar o pedido por um número truncado seria
 * transformar um clique numa busca. A fila inteira continua tendo casa própria
 * (a aba "Aguardando NF-e" desta mesma tela); este bloco é o momento em que ele
 * abriu um pedido para conferir e viu que faltava alguma coisa.
 *
 * A ORDEM DAS PERGUNTAS DE `estadoDoBling` NÃO É TOCADA AQUI, e não pode ser
 * tocada em lugar nenhum: ela é a ordem da vida do documento fiscal
 * (`nfe_chave` → `nfe_numero` sem chave → `sincronizando` → `bling_id` → nada),
 * está travada por 21 testes em `lib/painel/bling/contrato.test.ts`, e
 * reordená-la produz uma tela que diz "tudo certo" sobre uma nota que nunca
 * chegou à SEFAZ. Este componente só LÊ o que ela decidiu.
 *
 * A ÚNICA TRADUÇÃO É A DA COR. `estadoDoBling` carrega `cor: "#00796b"` desde
 * que era `blingContrato.js` — hexadecimais do material design do painel
 * legado. `tomDoBling` os converte em tom da casa a partir da `chave`, que é
 * estável; o contrato continua intocado.
 */
export function BlocoDoBling({
  pedido,
  blingLigado,
  aoAtualizarPedido,
}: {
  pedido: PedidoDoPainel;
  /**
   * O que `GET /bling/status` respondeu — `null` quando a sonda não respondeu.
   *
   * `null` NÃO DESABILITA NADA. A sonda responde 200 mesmo com tudo desligado
   * (é o endpoint que DIAGNOSTICA o desligado), então "não respondeu" significa
   * problema no servidor da loja, não no Bling. Travar os botões por causa
   * disso tiraria do gestor a única forma de descobrir o que houve — e o
   * servidor continua sendo a autoridade: ele recusa com 503 e frase.
   */
  blingLigado: boolean | null;
  aoAtualizarPedido: (orderId: string, parcial: PedidoDoPainel) => void;
}) {
  const [erro, setErro] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);

  const { acaoEmAndamento, acionar } = useAcoesDoBling({
    aoAtualizarPedido: (id, parcial) => aoAtualizarPedido(id, parcial as PedidoDoPainel),
    aoFalhar: (frase) => {
      setAviso(null);
      setErro(frase);
    },
    aoConcluir: (frase) => {
      setErro(null);
      setAviso(frase);
    },
  });

  const comoContrato = pedido as unknown as PedidoDoContrato;
  const estado = estadoDoBling(comoContrato);
  const emAndamento = acaoEmAndamento(pedido.order_id);
  const vaiAoBling = pedidoPodeIrAoBling(comoContrato);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <Selo tom={tomDoBling(estado.chave)}>{estado.rotulo}</Selo>
        {pedido.bling_sincronizado_em && (
          <span className="text-[12px] text-fuligem-55">
            última sincronia em{" "}
            <span data-dado>{formatarDataHora(pedido.bling_sincronizado_em)}</span>
          </span>
        )}
      </div>

      {/* O DETALHE VEM DO CONTRATO E VEM INTEIRO. "A nota foi gerada no Bling
          mas não chegou à SEFAZ. Corrija a configuração fiscal e emita de novo
          — retransmite a mesma nota." é a instrução que resolve o problema;
          resumi-la para caber bonito é jogar fora o diagnóstico. */}
      <p className="max-w-[62ch] text-[13px] text-fuligem-55">{estado.detalhe}</p>

      {pedido.nfe_url && (
        <p className="text-[13px]">
          <a
            href={pedido.nfe_url}
            target="_blank"
            rel="noreferrer"
            className={`underline decoration-1 underline-offset-4 hover:decoration-2 ${FOCO}`}
          >
            Abrir DANFE
            {pedido.nfe_numero ? ` da NF-e ${pedido.nfe_numero}` : ""}
          </a>
        </p>
      )}

      {/* A CAIXA DA INTEGRAÇÃO DESLIGADA NÃO É DE ERRO. "Desligada" é o estado
          de fábrica — em produção o checklist de go-live tem todos os itens do
          Bling desmarcados —, e pintá-la de erro faria o gestor abrir chamado
          por uma configuração que nunca foi feita. `tom="aviso"` é filete
          neutro; o texto diz qual variável liga e onde está o passo a passo. */}
      {blingLigado === false && (
        <Tarja tom="aviso">
          A integração com o Bling está desligada (<code>BLING_ATIVO</code>).
          Enquanto ela estiver assim, as três ações abaixo respondem que a
          integração não está ligada. O passo a passo está em{" "}
          <code>docs/bling.md</code>.
        </Tarja>
      )}

      {erro && <Tarja onFechar={() => setErro(null)}>{erro}</Tarja>}
      {aviso && (
        <Tarja tom="sucesso" onFechar={() => setAviso(null)}>
          {aviso}
        </Tarja>
      )}

      {vaiAoBling ? (
        <div className="flex flex-wrap gap-2">
          {/* A ORDEM É A DO FLUXO REAL: primeiro o pedido de venda existe no
              ERP, depois a nota sai dele, e só então há rastreio para buscar.
              `ACOES_BLING` já vem nessa ordem e é iterada como veio. */}
          {ACOES_BLING.map((acao) => {
            const semPedidoDeVenda = acao.precisaDeSincronia && !pedido.bling_id;
            // Uma ação em voo tranca as TRÊS deste pedido: as três mexem na
            // mesma linha do banco.
            const travado = Boolean(emAndamento) || semPedidoDeVenda;
            return (
              <Botao
                key={acao.chave}
                variante="secundaria"
                disabled={travado}
                title={
                  semPedidoDeVenda
                    ? "Sincronize o pedido com o Bling primeiro."
                    : acao.titulo
                }
                onClick={() => acionar(pedido.order_id, acao.chave)}
              >
                {/* R14 — dinheiro e documento fiscal não usam UI otimista. O
                    rótulo ocupado ("Emitindo…") fica até o SERVIDOR confirmar;
                    o pior estado de uma emissão de nota não é lento, é "não sei
                    se aconteceu". */}
                {emAndamento === acao.chave ? acao.rotuloOcupado : acao.rotulo}
              </Botao>
            );
          })}
        </div>
      ) : (
        <p className="max-w-[62ch] text-[13px] text-fuligem-55">
          Só pedidos pagos (aprovado, enviado, entregue) vão ao ERP — venda não
          confirmada não vira pedido de venda nem nota.
        </p>
      )}
    </div>
  );
}
