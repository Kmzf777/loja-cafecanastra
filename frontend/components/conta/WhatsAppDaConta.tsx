"use client";

import { useEffect, useState } from "react";
import { Botao } from "@/components/ui/Botao";
import {
  ErroDeVinculo,
  lerWhatsappDaConta,
  registrarOptinDeWhatsapp,
  voltarAReceberNoWhatsapp,
  type ContatoDeWhatsapp,
} from "@/lib/conta/cadastro";
import { formatarTelefone } from "@/lib/conta/telefone";

/**
 * O WhatsApp na área da conta — o bloco que existe porque o cadastro não
 * alcança todo mundo.
 *
 * QUEM CHEGA AQUI SEM NÚMERO, E POR QUÊ (as duas listas são diferentes):
 *
 *   1. QUEM CONFIRMOU O E-MAIL DEPOIS. Com confirmação ligada — a configuração
 *      desta loja — o `signUp` não devolve sessão, e o número digitado no
 *      cadastro não tem onde ser guardado: telefone NÃO viaja em
 *      `user_metadata` (o JWT desta instância compartilhada acompanha a pessoa
 *      para outros projetos). Quem cria o vínculo dias depois é
 *      `montarUsuario()`, e ele só sabe o nome.
 *   2. QUEM JÁ TINHA CONTA. Toda linha de `clientes` anterior a esta fase tem
 *      `telefone` nulo — a loja nunca coletou telefone de ninguém.
 *
 * SEM TRAVAR NADA. O bloco convida; não bloqueia pedido, não bloqueia login,
 * não aparece como aviso de erro. Quem não quiser deixar o número continua
 * comprando exatamente como antes — o e-mail de status nunca dependeu disto.
 *
 * E ELE TAMBÉM APARECE PARA QUEM JÁ TEM NÚMERO, com outra cara: ali ele é a
 * revogação da promoção, e ela é requisito, não conveniência. O Art. 8º §5º
 * pede que retirar o consentimento seja gratuito e FACILITADO; sem este ramo, a
 * única saída de quem marcou a caixa no cadastro seria responder PARAR — que
 * desliga também o aviso de pedido, ou seja, obriga a abrir mão de uma coisa
 * para recusar outra.
 *
 * NÃO HÁ TESTE DE COMPONENTE NESTA CASA (o vitest roda em `node`, sem jsdom, e
 * só sobre `.ts`), então TODA a decisão que dá para errar mora em
 * `lib/conta/cadastro.ts` e é testada lá: o que se lê, o que se escreve, o que
 * é `false` explícito e o que é ausência. O que sobra aqui é estado de tela.
 */

const CAMPO =
  "h-12 w-full border border-fuligem-20 bg-cal-puro px-3 text-[15px] " +
  "focus-visible:outline-2 focus-visible:outline-offset-[3px] focus-visible:outline-vermelho";
const ROTULO =
  "block text-[11px] font-semibold uppercase tracking-[0.14em] text-fuligem-55";

export function WhatsAppDaConta({ userId }: { userId: string }) {
  const [contato, setContato] = useState<ContatoDeWhatsapp | null>(null);
  const [telefone, setTelefone] = useState("");
  const [promocoes, setPromocoes] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [recibo, setRecibo] = useState<string | null>(null);

  useEffect(() => {
    let vivo = true;
    lerWhatsappDaConta(userId).then((lido) => {
      if (!vivo || !lido) return;
      setContato(lido);
      setPromocoes(lido.promocoes);
    });
    return () => {
      vivo = false;
    };
  }, [userId]);

  // `null` cobre dois casos e os dois querem a mesma coisa: ainda carregando, e
  // leitura que falhou. Some com o bloco em vez de piscar um formulário que
  // talvez não faça falta — ver `lerWhatsappDaConta`.
  if (!contato) return null;

  async function salvar(evento: React.FormEvent) {
    evento.preventDefault();
    setErro(null);
    setRecibo(null);

    /**
     * O campo é `required`, e mesmo assim esta trava existe.
     *
     * Sem ela, um envio que escape da validação do navegador (autofill parcial,
     * script, `noValidate`) chamaria a RPC só com `promocoes` e a tela diria
     * "está tudo salvo" sobre um número que não foi gravado — a pessoa sairia
     * daqui achando que a loja tem o WhatsApp dela.
     */
    if (!contato?.telefone && !telefone.trim()) {
      setErro("Informe seu WhatsApp para salvar.");
      return;
    }

    setSalvando(true);
    try {
      await registrarOptinDeWhatsapp({
        // Só manda o telefone quando ele está sendo INFORMADO agora. No ramo de
        // quem já tem número, o campo nem existe, e mandar o que já está
        // gravado recarimbaria `whatsapp_optin_em` a cada visita — apagando a
        // data em que a pessoa de fato deixou o número.
        telefone: contato?.telefone ? undefined : telefone,
        promocoes,
      });
      const salvo = await lerWhatsappDaConta(userId);
      if (salvo) setContato(salvo);
      setRecibo("Pronto. Está tudo salvo.");
    } catch (e) {
      setErro(
        e instanceof ErroDeVinculo || e instanceof Error
          ? e.message
          : "Não foi possível salvar agora.",
      );
    } finally {
      setSalvando(false);
    }
  }

  async function voltarAReceber() {
    setErro(null);
    setRecibo(null);
    setSalvando(true);
    try {
      await voltarAReceberNoWhatsapp(userId);
      const salvo = await lerWhatsappDaConta(userId);
      if (salvo) setContato(salvo);
      setRecibo("Voltamos a avisar seus pedidos pelo WhatsApp.");
    } catch (e) {
      setErro(
        e instanceof Error ? e.message : "Não foi possível salvar agora.",
      );
    } finally {
      setSalvando(false);
    }
  }

  /**
   * QUEM PEDIU PARA PARAR VÊ O ESTADO, E A VOLTA — nunca a caixa de promoções.
   *
   * Com `whatsapp_optout_em` carimbado nada sai, promoção inclusive
   * (`notificacoes.js` sai antes de tudo). Mostrar ali uma caixa de "quero
   * receber novidades" seria oferecer uma escolha que não tem efeito nenhum.
   */
  if (contato.parado) {
    return (
      <section className="mt-16 max-w-[52ch]">
        <h2 className="titulo-secao text-[clamp(1.5rem,3vw,2.25rem)] leading-tight">
          WhatsApp
        </h2>
        <p className="mt-5 text-[17px] leading-relaxed text-fuligem-80">
          Você pediu para parar de receber mensagens nossas. Nada sai daqui —
          nem aviso de pedido, nem novidade. O status continua nesta página e no
          e-mail.
        </p>
        {recibo ? (
          <p role="status" className="mt-4 text-[14px] text-fuligem-80">
            {recibo}
          </p>
        ) : null}
        {erro ? (
          <p role="alert" className="mt-4 text-[14px] text-vermelho">
            {erro}
          </p>
        ) : null}
        <div className="mt-6">
          <Botao
            variante="secundario"
            onClick={voltarAReceber}
            disabled={salvando}
          >
            {salvando ? "Salvando…" : "Voltar a receber"}
          </Botao>
        </div>
      </section>
    );
  }

  const temNumero = Boolean(contato.telefone);

  return (
    <section className="mt-16 max-w-[52ch]">
      <h2 className="titulo-secao text-[clamp(1.5rem,3vw,2.25rem)] leading-tight">
        WhatsApp
      </h2>

      <form onSubmit={salvar} className="mt-5">
        {temNumero ? (
          <p className="text-[17px] leading-relaxed text-fuligem-80">
            Avisamos o andamento dos seus pedidos por mensagem no WhatsApp, em
            nome do Café Canastra, no número{" "}
            <span className="font-dado">
              {formatarTelefone(contato.telefone)}
            </span>
            .
          </p>
        ) : (
          <>
            {/* §11: o convite diz o que a pessoa GANHA, e não o que falta no
                cadastro dela. "Complete seu perfil" é a versão que trata a
                pessoa como um formulário incompleto. */}
            <p className="text-[17px] leading-relaxed text-fuligem-80">
              Deixe seu WhatsApp e avisamos o andamento de cada pedido por
              mensagem, em nome do Café Canastra — da confirmação ao código de
              rastreio. Para parar, responda PARAR em qualquer mensagem.
            </p>
            <div className="mt-5">
              <label htmlFor="whatsapp-da-conta" className={ROTULO}>
                WhatsApp
              </label>
              <input
                id="whatsapp-da-conta"
                name="telefone"
                type="tel"
                inputMode="numeric"
                autoComplete="tel-national"
                required
                value={formatarTelefone(telefone)}
                onChange={(e) => setTelefone(e.target.value)}
                placeholder="(37) 99999-0000"
                className={`${CAMPO} mt-1.5 font-dado`}
              />
            </div>
          </>
        )}

        {/* A caixa à parte, com a mesma finalidade dita por extenso do
            cadastro. Aqui ela é também a REVOGAÇÃO: desmarcar e salvar manda
            `promocoes: false`, e a 0019 apaga o carimbo. */}
        <div className="mt-5 flex items-start gap-3">
          <input
            id="promocoes-da-conta"
            name="promocoes"
            type="checkbox"
            checked={promocoes}
            onChange={(e) => setPromocoes(e.target.checked)}
            className="mt-1 h-4 w-4 shrink-0 accent-vermelho focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-vermelho"
          />
          <label
            htmlFor="promocoes-da-conta"
            className="text-[14px] leading-relaxed text-fuligem-80"
          >
            Quero receber também novidades e ofertas do Café Canastra pelo
            WhatsApp. Desmarcar aqui vale na hora, e não afeta os avisos de
            pedido.
          </label>
        </div>

        {recibo ? (
          <p role="status" className="mt-5 text-[14px] text-fuligem-80">
            {recibo}
          </p>
        ) : null}
        {erro ? (
          <p role="alert" className="mt-5 text-[14px] text-vermelho">
            {erro}
          </p>
        ) : null}

        <div className="mt-6">
          <Botao
            type="submit"
            variante="secundario"
            disabled={salvando}
            className="disabled:cursor-not-allowed disabled:border-fuligem-20 disabled:text-fuligem-55"
          >
            {salvando ? "Salvando…" : temNumero ? "Salvar preferência" : "Salvar WhatsApp"}
          </Botao>
        </div>
      </form>
    </section>
  );
}
