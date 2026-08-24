import Link from "next/link";
import { dicionario } from "@/lib/i18n/dicionario";
import { href } from "@/lib/i18n/rotas";
import { LOCALE_PADRAO, type Locale } from "@/lib/i18n/tipos";

/**
 * O SÉTIMO CARD DE TODO CARROSSEL DE PRODUTO.
 *
 * Ele é card, e não um botão solto embaixo da seção, por uma razão de gesto:
 * quem arrasta até o fim de um trilho está justamente procurando mais — e
 * encontrar o "ver mais" ali, na continuação do movimento, custa zero passo. Um
 * botão abaixo da seção exigiria parar de arrastar, olhar para baixo e mudar de
 * gesto.
 *
 * SEM FOTO, DE PROPÓSITO. Ele não é produto: é navegação, e uma imagem o faria
 * competir com os seis cards que de fato vendem. O que ele tem é tipografia e
 * uma seta.
 *
 * O FILETE É TRACEJADO ATÉ O HOVER, e é a única peça da vitrine que usa traço
 * interrompido: é o que diz "aqui a lista não continua, ela termina" sem
 * precisar de mais uma palavra. No hover ele fecha em linha cheia e vermelha,
 * junto com o deslocamento de 4px dos cards irmãos — a mesma gramática de
 * carimbo do §4.4, aplicada a um card que não vende.
 *
 * Server component — não tem estado, e por isso não paga hidratação.
 */
export function CardVerMais({
  caminho,
  locale = LOCALE_PADRAO,
}: {
  /** Caminho canônico em português, com querystring. `href()` cuida do idioma. */
  caminho: string;
  locale?: Locale;
}) {
  const d = dicionario(locale);

  return (
    <Link
      href={href(locale, caminho)}
      className="group flex h-full min-h-[220px] flex-col items-start justify-center gap-3 border border-dashed border-fuligem-20 bg-transparent p-6 transition-[border-color,box-shadow,transform] duration-[320ms] ease-canastra hover:-translate-x-1 hover:-translate-y-1 hover:border-solid hover:border-vermelho hover:shadow-[4px_4px_0_var(--color-fuligem)] focus-visible:outline-2 focus-visible:outline-offset-[3px] focus-visible:outline-vermelho"
    >
      <span className="text-[18px] font-semibold leading-tight">
        {d.comum.verMais}
      </span>
      <span
        aria-hidden
        className="font-dado text-[22px] leading-none text-vermelho transition-transform duration-[320ms] ease-canastra group-hover:translate-x-1"
      >
        →
      </span>
    </Link>
  );
}
