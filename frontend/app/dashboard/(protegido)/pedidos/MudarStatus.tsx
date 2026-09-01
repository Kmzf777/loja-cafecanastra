"use client";

import { useState, useTransition } from "react";

import { Botao } from "@/components/painel/ui/Botao";
import { Dialogo } from "@/components/painel/ui/Dialogo";
import { Tarja } from "@/components/painel/ui/Tarja";
import { ETIQUETA, FOCO } from "@/components/painel/ui/estilos";
import { STATUS_DE_PEDIDO } from "@/lib/painel/status";
import { precisaDeRastreio } from "@/lib/painel/pedidos/pedidos.logica";

import { mudarStatusDoPedido } from "./acoes";

/** A caixa do `<select>`, com a mesma pele do `<Campo>`: filete de 1px, 2px de
 *  raio (§4.3 reserva o canto reto ao contêiner) e os 44px do alvo (R22). */
const CAIXA_DO_SELECT =
  `min-h-11 rounded-bt border border-fuligem-20 bg-cal-puro px-3 text-fuligem ` +
  `hover:border-fuligem-55 disabled:cursor-not-allowed disabled:opacity-40 ${FOCO}`;

/**
 * A MUDANÇA DE STATUS — e a maior diferença desta tela para a legada.
 *
 * NO LEGADO ISTO ERA UM `<select onChange>` EM CADA LINHA DA TABELA. Um clique
 * torto na lista, sem ver de quem era o pedido nem quanto ele custava, mudava o
 * status: o backend movimenta ESTOQUE dentro da transação (devolve ou rebaixa,
 * conforme a travessia), devolve o uso do CUPOM quando a venda morre e dispara
 * E-MAIL ao cliente. Sem confirmação, sem contexto e sem desfazer.
 *
 * Aqui o controle vive no DETALHE, onde o pedido inteiro está à vista, e são
 * dois gestos: escolher e aplicar. Escolher sem aplicar não faz nada — fechar o
 * painel devolve o `<select>` ao valor do servidor, porque o valor inicial vem
 * de `pedido.status`. É o R6 pelo avesso: autosave só onde o erro custa zero, e
 * aqui ele custa uma caixa de café e um e-mail errado.
 *
 * R14 — DINHEIRO NÃO USA UI OTIMISTA. Enquanto o servidor não confirma, o botão
 * diz "Aplicando…" e o controle fica travado; o status na tela continua sendo o
 * que o servidor conhece. O pior estado de uma operação assim não é lento, é
 * "não sei se aconteceu": pintar o novo status antes da confirmação faria o
 * gestor fechar o painel achando que despachou.
 *
 * `useTransition` E `revalidatePath`: quando a ação volta bem, o Next refaz a
 * leitura do servidor e a linha aparece com o status novo — vindo do banco, não
 * de um palpite do navegador.
 */
export function MudarStatus({
  orderId,
  statusAtual,
}: {
  orderId: string;
  statusAtual: string;
}) {
  const [destino, setDestino] = useState(statusAtual);
  const [erro, setErro] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [rastreio, setRastreio] = useState<string | null>(null);
  const [aplicando, iniciar] = useTransition();

  /**
   * O `<select>` SE RENDE AO SERVIDOR — o mesmo padrão de `BuscaDaLista`, sem
   * `useEffect` e sem `key`.
   *
   * Depois de aplicar, `revalidatePath` traz o pedido com o status novo e o
   * componente re-renderiza com `statusAtual` diferente. Sem esta
   * reconciliação, o `<select>` continuaria marcando o valor antigo — ou, pior,
   * o botão "Aplicar" ficaria habilitado prometendo repetir uma mudança que já
   * aconteceu.
   */
  const [statusConhecido, setStatusConhecido] = useState(statusAtual);
  if (statusAtual !== statusConhecido) {
    setStatusConhecido(statusAtual);
    setDestino(statusAtual);
  }

  function aplicar(codigoDeRastreio: string | null) {
    setErro(null);
    setAviso(null);
    iniciar(async () => {
      const r = await mudarStatusDoPedido(orderId, destino, codigoDeRastreio);
      if (r.ok) setAviso(r.frase);
      else setErro(r.erro);
    });
  }

  function pedirAplicacao() {
    // Marcar como enviado NÃO envia direto: abre o pedido do código. O
    // legado usava `window.prompt`, que não tem rótulo claro, some em alguns
    // navegadores e não segue o visual do painel.
    if (precisaDeRastreio(destino)) setRastreio("");
    else aplicar(null);
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end gap-2">
        <label className="flex min-w-0 flex-col gap-1.5">
          <span className={`text-[11px] ${ETIQUETA} text-fuligem-55`}>
            Mudar status para
          </span>
          <select
            value={destino}
            disabled={aplicando}
            onChange={(evento) => setDestino(evento.target.value)}
            className={CAIXA_DO_SELECT}
          >
            {/*
              OS NOVE STATUS VÊM DE `lib/painel/status.ts`, e a lista NÃO é
              copiada para cá. O `valor` é o que trafega (`pendente`,
              `em_processamento`) e o `rotulo` é o que o gestor lê: traduzir os
              VALORES em vez dos rótulos faz o backend responder 400 em toda
              mudança e o CHECK da 0009 recusar no banco. Foi copiando esta
              lista para dentro dos componentes que ela virou três cópias no
              painel legado.
            */}
            {STATUS_DE_PEDIDO.map((s) => (
              <option key={s.valor} value={s.valor}>
                {s.rotulo}
              </option>
            ))}
          </select>
        </label>

        <Botao
          onClick={pedirAplicacao}
          disabled={aplicando || destino === statusAtual}
        >
          {aplicando ? "Aplicando…" : "Aplicar"}
        </Botao>
      </div>

      {/* A CONSEQUÊNCIA FICA VISÍVEL ANTES DO CLIQUE, e não numa confirmação
          depois. Nenhuma das três é óbvia olhando o botão, e é justamente por
          isso que o `<select>` da lista legada era perigoso. */}
      <p className="max-w-[62ch] text-[12px] text-fuligem-55">
        Aplicar movimenta o estoque, devolve o cupom quando a venda morre e
        envia e-mail ao cliente. Não há como desfazer.
      </p>

      {erro && <Tarja onFechar={() => setErro(null)}>{erro}</Tarja>}
      {aviso && (
        <Tarja tom="sucesso" onFechar={() => setAviso(null)}>
          {aviso}
        </Tarja>
      )}

      <Dialogo
        aberto={rastreio !== null}
        aoMudar={(aberto) => {
          // Cancelar não muda nada: o `<select>` volta ao valor do servidor,
          // como no legado.
          if (!aberto) {
            setRastreio(null);
            setDestino(statusAtual);
          }
        }}
        titulo="Marcar como enviado"
        descricao={
          <>
            O código vai por e-mail ao cliente. <strong>Deixe vazio</strong> se
            a entrega é local — entrega da região não tem rastreio, e um código
            inventado chega na caixa de entrada de alguém.
          </>
        }
        acoes={
          <>
            <Botao
              variante="secundaria"
              onClick={() => {
                setRastreio(null);
                setDestino(statusAtual);
              }}
            >
              Cancelar
            </Botao>
            <Botao
              onClick={() => {
                const codigo = rastreio;
                setRastreio(null);
                aplicar(codigo);
              }}
            >
              Confirmar envio
            </Botao>
          </>
        }
      >
        <label className="flex flex-col gap-1.5">
          <span className={`text-[11px] ${ETIQUETA} text-fuligem-55`}>
            Código de rastreio
          </span>
          <input
            autoFocus
            value={rastreio ?? ""}
            onChange={(evento) => setRastreio(evento.target.value)}
            onKeyDown={(evento) => {
              // Enter confirma — é o gesto de quem colou o código e quer
              // seguir para o próximo pedido.
              if (evento.key === "Enter") {
                evento.preventDefault();
                const codigo = rastreio;
                setRastreio(null);
                aplicar(codigo);
              }
            }}
            placeholder="Ex: AA123456789BR"
            data-dado
            className={CAIXA_DO_SELECT}
          />
        </label>
      </Dialogo>
    </div>
  );
}
