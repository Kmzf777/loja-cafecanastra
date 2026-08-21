"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Botao } from "@/components/ui/Botao";
import {
  ErroDeExclusao,
  PALAVRA_DE_CONFIRMACAO,
  confirmacaoValida,
  excluirMinhaConta,
} from "@/lib/conta/exclusao";

/**
 * "Encerrar minha conta" — a porta do direito de eliminação (LGPD art. 18, VI).
 *
 * O BURACO QUE ISTO FECHA: `DELETE /auth/users/me` existe, é cuidadoso e não
 * tinha chamador vivo nenhum (só o cabeçalho do painel legado, que nem é
 * montado). A loja implementou o direito inteiro e mandava o cliente escrever
 * para o "canal de contato" para exercê-lo. A lógica de rede e a tradução dos
 * erros moram em `lib/conta/exclusao.ts`, com testes; aqui é só a tela.
 *
 * DISCRETO DE PROPÓSITO. Fica no fim da página, atrás de uma linha, em corpo
 * pequeno e com botão de texto: é uma ação destrutiva e irreversível, e uma
 * ação destrutiva nunca deve disputar atenção com "ver os cafés". Quem procura
 * acha; quem não procura não esbarra.
 *
 * A CONFIRMAÇÃO É DIGITADA, e não um `window.confirm`. O diálogo do navegador
 * é um segundo clique no mesmo lugar do primeiro — some com um Enter distraído
 * e não obriga ninguém a ler nada. Digitar a palavra é o único passo que exige
 * atenção deliberada. (O `window.confirm` do cancelamento de assinatura, logo
 * acima nesta mesma página, continua adequado lá: cancelar assinatura é
 * reversível — assinar de novo é um clique. Isto aqui não é.)
 *
 * O TEXTO NÃO SUAVIZA NADA. Cada linha da lista é uma promessa que o backend
 * cumpre passo a passo (ver "A ORDEM DA EXCLUSÃO DE CONTA" em
 * conta.routes.js), inclusive as duas que não são o que a pessoa espera ouvir:
 * o pedido antigo continua existindo (obrigação fiscal) e a avaliação
 * publicada continua no ar, sem o nome.
 */

type Props = {
  accessToken: string;
  /** Chamada UMA vez, depois do 200 — quem trata sessão e navegação é a página. */
  aoConcluir: () => void;
};

/**
 * O que a rota faz, em ordem, na linguagem de quem lê. Cada item corresponde a
 * um passo real: 3 (assinaturas), 4 (redação de pedidos/assinaturas/avaliações),
 * 5 (newsletter) e 6 (a conta no GoTrue).
 */
const O_QUE_ACONTECE = [
  "Sua conta e seu acesso somem: login, endereços salvos e sacola.",
  "Os pedidos que você já fez continuam existindo, porque a nota fiscal tem " +
    "prazo legal de guarda — mas sem seu nome, CPF, e-mail e endereço.",
  "Assinaturas do Clube são canceladas na hora, sem multa. Não há cobrança nova.",
  "Seu e-mail sai da lista da newsletter.",
  "Avaliações que você publicou continuam no site, assinadas como " +
    "“Cliente Canastra”.",
];

export function EncerrarConta({ accessToken, aoConcluir }: Props) {
  const [aberto, setAberto] = useState(false);
  const [palavra, setPalavra] = useState("");
  const [excluindo, setExcluindo] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const campo = useRef<HTMLInputElement>(null);

  // Abrir a confirmação leva o foco para o campo: quem chegou aqui pelo
  // teclado não deveria ter que tabular por um texto que acabou de aparecer.
  useEffect(() => {
    if (aberto) campo.current?.focus();
  }, [aberto]);

  const liberado = confirmacaoValida(palavra) && !excluindo;

  const excluir = useCallback(async () => {
    if (!confirmacaoValida(palavra) || excluindo) return;
    setErro(null);
    setExcluindo(true);
    try {
      await excluirMinhaConta(accessToken);
      // Só aqui: `excluirMinhaConta` lança em TODO desfecho que não seja 200.
      aoConcluir();
    } catch (falha) {
      setErro(
        falha instanceof ErroDeExclusao
          ? falha.message
          : // Nenhum caminho conhecido chega aqui — o módulo traduz tudo,
            // inclusive rede fora. Mesmo assim a frase mantém o invariante:
            // nunca dizer que a conta sumiu quando não se sabe.
            "Não foi possível excluir sua conta agora. Ela continua ativa; " +
              "tente de novo em instantes.",
      );
      setExcluindo(false);
    }
  }, [accessToken, aoConcluir, excluindo, palavra]);

  return (
    <section className="mt-24 border-t border-fuligem-20 pt-8">
      <h2 className="text-[12px] font-semibold uppercase tracking-[0.14em] text-fuligem-55">
        Encerrar minha conta
      </h2>

      <p className="mt-3 max-w-[62ch] text-[15px] leading-relaxed text-fuligem-80">
        Você pode apagar sua conta você mesmo, agora, sem pedir para ninguém. É
        definitivo: não dá para desfazer nem recuperar depois.
      </p>

      {!aberto ? (
        <div className="mt-4">
          <Botao variante="texto" onClick={() => setAberto(true)}>
            Quero encerrar minha conta
          </Botao>
        </div>
      ) : (
        <div className="mt-5 max-w-[62ch] border-l-2 border-fuligem-20 pl-5">
          <p className="text-[14px] font-semibold">O que acontece:</p>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-[14px] leading-relaxed text-fuligem-80">
            {O_QUE_ACONTECE.map((linha) => (
              <li key={linha}>{linha}</li>
            ))}
          </ul>

          <label className="mt-5 block">
            <span className="text-[12px] font-semibold uppercase tracking-[0.14em] text-fuligem-55">
              Digite {PALAVRA_DE_CONFIRMACAO} para confirmar
            </span>
            <input
              ref={campo}
              type="text"
              value={palavra}
              onChange={(e) => setPalavra(e.target.value)}
              disabled={excluindo}
              autoComplete="off"
              autoCapitalize="characters"
              spellCheck={false}
              aria-describedby="encerrar-conta-dica"
              className="mt-1 w-full max-w-[18rem] rounded-bt border border-fuligem-20 bg-cal-puro px-3 py-2 font-dado text-[15px] tracking-[0.08em] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-vermelho disabled:opacity-60"
            />
          </label>
          <p id="encerrar-conta-dica" className="mt-1 text-[13px] text-fuligem-55">
            O botão de excluir só funciona depois que a palavra estiver certa.
          </p>

          {/* O estado em voz alta. `role="status"` (aria-live="polite") anuncia
              a espera para quem não vê o botão mudar de rótulo — e a rota
              demora mesmo: ela fala com o Mercado Pago e com o GoTrue em série,
              antes de apagar qualquer coisa. */}
          <p
            role="status"
            className={`mt-4 text-[14px] leading-relaxed ${
              excluindo ? "text-fuligem-80" : "sr-only"
            }`}
          >
            {excluindo
              ? "Excluindo sua conta. Isto leva alguns segundos: cancelamos as " +
                "assinaturas do Clube, apagamos seus dados pessoais dos pedidos " +
                "e removemos seu acesso. Não feche esta página."
              : ""}
          </p>

          {erro ? (
            <p
              role="alert"
              className="mt-4 border-l-2 border-vermelho bg-cal-puro py-2 pl-3 text-[14px] leading-relaxed"
            >
              {erro}
            </p>
          ) : null}

          <div className="mt-5 flex flex-wrap items-center gap-4">
            <Botao
              variante="secundario"
              onClick={excluir}
              disabled={!liberado}
              className="disabled:opacity-40"
            >
              {excluindo ? "Excluindo…" : "Excluir minha conta"}
            </Botao>
            <Botao
              variante="texto"
              onClick={() => {
                setAberto(false);
                setPalavra("");
                setErro(null);
              }}
              disabled={excluindo}
            >
              Deixar como está
            </Botao>
          </div>
        </div>
      )}
    </section>
  );
}
