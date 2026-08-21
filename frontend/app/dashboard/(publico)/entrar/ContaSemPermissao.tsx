"use client";

import { useEffect, useRef } from "react";
import Link from "next/link";
import { BotaoDeSaida } from "./BotaoDeSaida";

/**
 * "Esta conta não é de gestor" — UMA redação, dois lugares.
 *
 * O MESMO FATO ESTAVA ESCRITO DUAS VEZES: uma em `page.tsx` (para quem chega já
 * logado como cliente) e outra em `FormularioDeEntrada.tsx` (para quem descobre
 * isso depois de digitar a senha). Eram duas frases diferentes para a mesma
 * situação, e iam envelhecer em direções distintas — a hora em que se ajusta o
 * texto é justamente a hora em que se esquece do outro arquivo.
 *
 * A DIFERENÇA ENTRE OS DOIS CASOS É REAL, e o componente a preserva em vez de
 * apagá-la: quem chega logado vê o e-mail da conta aberta (senão não sabe se
 * errou de conta ou se a conta certa é que não foi liberada); quem acabou de
 * entrar não precisa, porque acabou de digitar o endereço.
 */
export function ContaSemPermissao({
  email,
  focarAoMontar = false,
}: {
  email?: string | null;
  /**
   * Só quando este bloco SUBSTITUI o formulário. Ao carregar a página ele já é
   * o conteúdo principal, e mover o foco na carga é surpreendente sem motivo.
   */
  focarAoMontar?: boolean;
}) {
  const alvo = useRef<HTMLDivElement>(null);

  /**
   * Sem isto, quem usa leitor de tela ou teclado ficava com o foco num botão
   * "Entrar" que sumiu da árvore: a mensagem aparecia na tela e o foco caía no
   * começo do documento, sem anunciar nada. `tabIndex={-1}` torna o bloco
   * focável por código sem o inserir na ordem de tabulação.
   */
  useEffect(() => {
    if (focarAoMontar) alvo.current?.focus();
  }, [focarAoMontar]);

  /**
   * SEM `role="status"` AQUI, de propósito. Havia os dois — região viva E foco
   * — e o resultado era o leitor de tela anunciando o mesmo texto DUAS vezes
   * quando este bloco substituía o formulário. Escolhido o foco, porque ele
   * resolve também o teclado: a região viva anunciaria a mensagem mas deixaria
   * o cursor perdido no começo do documento. No caso servido pelo servidor
   * (pessoa já logada abrindo a página) não há anúncio a fazer — o bloco é o
   * conteúdo principal, e o leitor lê a página normalmente.
   */
  return (
    <div
      ref={alvo}
      tabIndex={-1}
      className="max-w-[46ch] focus-visible:outline-2 focus-visible:outline-offset-[6px] focus-visible:outline-vermelho"
    >
      <p className="text-[17px] leading-relaxed text-fuligem-80">
        {email ? (
          <>
            Você está na loja como{" "}
            <span className="font-dado text-[15px] text-fuligem">{email}</span>,
            e essa conta não tem acesso à área de gestão.
          </>
        ) : (
          <>
            Você entrou, mas esta conta não tem acesso à área de gestão.
          </>
        )}{" "}
        O painel é liberado conta a conta — se deveria ser a sua, fale com quem
        administra a loja.
      </p>
      <div className="mt-7 flex flex-wrap gap-3">
        <BotaoDeSaida rotulo="Entrar com outra conta" />
        <Link
          href="/account"
          className="inline-flex h-12 items-center text-[14px] text-vermelho underline underline-offset-4"
        >
          Ir para a minha conta
        </Link>
      </div>
    </div>
  );
}
