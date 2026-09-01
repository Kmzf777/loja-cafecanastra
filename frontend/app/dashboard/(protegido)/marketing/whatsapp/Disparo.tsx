"use client";

import { useRef, useState, type FormEvent } from "react";

import { Botao } from "@/components/painel/ui/Botao";
import { Dialogo } from "@/components/painel/ui/Dialogo";
import { Ficha } from "@/components/painel/ui/Ficha";
import { Tarja } from "@/components/painel/ui/Tarja";
import { ETIQUETA, FOCO } from "@/components/painel/ui/estilos";
import {
  LIMITE_DA_MENSAGEM,
  montarPayloadDoDisparo,
  validarDisparo,
  type Publico,
} from "@/lib/painel/marketing/publico.logica";

import { dispararWhatsapp } from "../acoes";

/**
 * A escrita da mensagem e o disparo.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * ESTE É O ÚNICO CONTROLE DO PAINEL QUE FALA COM O MUNDO DE FORA, e ele é
 * IRREVERSÍVEL: mensagem enviada não se desfaz. Três decisões saem daí.
 *
 * 1. HÁ CONFIRMAÇÃO, e ela nomeia o objeto e a consequência (R12): não é «Tem
 *    certeza?», é «Enviar para 184 números?» com a mensagem inteira à vista. O
 *    texto que a pessoa escreveu é o que ela mais precisa reler antes de mandar,
 *    e é o que um «Tem certeza?» esconde.
 *
 * 2. O BOTÃO DE DISPARO NÃO É DESTRUTIVO NO SENTIDO DO R11 — não apaga nada —,
 *    então ele NÃO é vermelho: nesta casa o vermelho é só erro e destruição, e
 *    gastá-lo aqui ensinaria a não acreditar nos erros de verdade. O peso vem da
 *    confirmação e do que ela mostra, não da cor.
 *
 * 3. R14 ATÉ O FIM: nada de UI otimista. O botão fica em «Disparando…» até o
 *    servidor responder, e quando a resposta NÃO vem a frase não diz «nada foi
 *    enviado» — diz para conferir antes de repetir, porque a requisição pode ter
 *    chegado e a resposta ter se perdido. O pior estado não é lento, é «não sei
 *    se aconteceu», e repetir um disparo é mandar tudo duas vezes.
 * ────────────────────────────────────────────────────────────────────────────
 */
export function Disparo({ publico }: { publico: Publico }) {
  const [mensagem, setMensagem] = useState("");
  const [confirmando, setConfirmando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [feito, setFeito] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  /** `useRef` e não `useState`: `setState` é assíncrono, e dois cliques no mesmo
   *  tick leem o mesmo estado "livre". Num disparo, isso é a lista inteira
   *  recebendo a mesma mensagem duas vezes. */
  const emVoo = useRef(false);

  const erros = validarDisparo(mensagem, publico);
  const restantes = LIMITE_DA_MENSAGEM - mensagem.trim().length;

  function abrirConfirmacao(evento: FormEvent<HTMLFormElement>) {
    evento.preventDefault();
    setErro(null);
    setFeito(null);
    if (Object.keys(erros).length > 0) return;
    setConfirmando(true);
  }

  async function disparar() {
    if (emVoo.current) return;
    emVoo.current = true;
    setEnviando(true);
    setErro(null);

    try {
      const resposta = await dispararWhatsapp(montarPayloadDoDisparo(mensagem, publico));
      setConfirmando(false);

      if (!resposta.ok) {
        setErro(resposta.erro);
        return;
      }
      setFeito(
        `Entregue ao disparador: ${resposta.dados.quantidade} ${resposta.dados.quantidade === 1 ? "número" : "números"}.`,
      );
      // A mensagem é limpa DEPOIS do sucesso: apagá-la antes faria um erro de
      // rede levar junto o texto que a pessoa escreveu.
      setMensagem("");
    } finally {
      emVoo.current = false;
      setEnviando(false);
    }
  }

  return (
    <Ficha titulo="Mensagem e disparo">
      <form onSubmit={abrirConfirmacao} className="space-y-4" noValidate>
        {erro && (
          <Tarja tom="erro" onFechar={() => setErro(null)}>
            {erro}
          </Tarja>
        )}
        {feito && (
          <Tarja tom="sucesso" onFechar={() => setFeito(null)}>
            {feito}
          </Tarja>
        )}

        <div className="flex flex-col gap-1.5">
          <label
            htmlFor="mensagem-do-disparo"
            className={`text-[11px] ${ETIQUETA} text-fuligem-55`}
          >
            Mensagem
          </label>
          <textarea
            id="mensagem-do-disparo"
            rows={5}
            value={mensagem}
            onChange={(e) => setMensagem(e.target.value)}
            placeholder="Chegou micro-lote novo na loja. Frete grátis acima de R$ 150 até domingo."
            aria-describedby="contagem-da-mensagem"
            className={`rounded-bt border border-fuligem-20 bg-cal-puro px-3 py-2 text-fuligem placeholder:text-fuligem-55 hover:border-fuligem-55 ${FOCO}`}
          />
          <p id="contagem-da-mensagem" className="text-[13px] text-fuligem-55">
            {/* A contagem é `data-dado` como todo número do painel, e ela some
                do vermelho enquanto está tudo bem — um número que já está
                vermelho quando não há problema não avisa de nada. */}
            <span data-dado className={restantes < 0 ? "text-vermelho" : undefined}>
              {restantes}
            </span>{" "}
            {restantes === 1 ? "caractere restante" : "caracteres restantes"}. A
            mesma mensagem vai para todos — não há substituição de nome.
          </p>
          {erros.mensagem && (
            <p className="text-[13px] text-vermelho">{erros.mensagem}</p>
          )}
        </div>

        {/*
          O PÚBLICO VAZIO É UM ERRO, e não um disparo de zero mensagens: o
          webhook aceitaria `{ numeros: [] }` sem reclamar, a tela diria
          «enviado», e o gestor concluiria que o WhatsApp não funciona.
        */}
        {erros.publico && <Tarja tom="alerta">{erros.publico}</Tarja>}

        <div className="flex flex-wrap items-center justify-end gap-3 border-t border-fuligem-20 pt-4">
          <p className="mr-auto text-[13px] text-fuligem-55">
            Vai para{" "}
            <span data-dado className="text-fuligem">
              {publico.total}
            </span>{" "}
            {publico.total === 1 ? "número" : "números"}.
          </p>
          <Botao type="submit" disabled={Object.keys(erros).length > 0 || enviando}>
            Revisar e disparar
          </Botao>
        </div>
      </form>

      <Dialogo
        aberto={confirmando}
        aoMudar={setConfirmando}
        /* R12: o título NOMEIA o objeto e a quantidade. «Tem certeza?» não
           carrega informação nenhuma e treina a clicar em OK. */
        titulo={`Disparar para ${publico.total} ${publico.total === 1 ? "número" : "números"}?`}
        descricao={
          <>
            Cada uma dessas pessoas tem consentimento de WhatsApp registrado e
            vigente. <strong>O envio não pode ser desfeito nem cancelado</strong>{" "}
            depois de começar.
          </>
        }
        acoes={
          <>
            {/* R11: a saída fica ENTRE o resto da tela e a ação de peso. */}
            <Botao
              variante="secundaria"
              onClick={() => setConfirmando(false)}
              disabled={enviando}
            >
              Cancelar
            </Botao>
            <Botao onClick={disparar} disabled={enviando}>
              {enviando ? "Disparando…" : "Disparar agora"}
            </Botao>
          </>
        }
      >
        {/*
          A MENSAGEM INTEIRA À VISTA NA CONFIRMAÇÃO. É o que a pessoa mais
          precisa reler antes de mandar, e é exatamente o que uma confirmação
          genérica esconde. `whitespace-pre-wrap` para as quebras de linha
          aparecerem como vão aparecer no WhatsApp.
        */}
        <blockquote className="max-h-48 overflow-y-auto whitespace-pre-wrap border-l-2 border-fuligem-20 bg-cal px-4 py-3 text-[13px]">
          {mensagem.trim()}
        </blockquote>
      </Dialogo>
    </Ficha>
  );
}
