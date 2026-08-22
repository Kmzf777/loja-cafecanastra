import type { ComponentProps, ReactNode } from "react";
import Link from "next/link";

/**
 * estetica.md §5.7 — quatro variantes, altura 48px, raio 2px, caixa alta em
 * Archivo 600 com tracking 0.08em. O foco e vermelho com offset de 3px; sobre
 * fundo vermelho ele inverte para fuligem, senao some.
 */

type Variante = "primario" | "primarioEscuro" | "secundario" | "texto";

const BASE =
  "inline-flex items-center justify-center gap-2 rounded-bt font-semibold uppercase " +
  "tracking-[0.08em] text-[13px] leading-none transition-colors duration-200 " +
  "focus-visible:outline-2 focus-visible:outline-offset-[3px] focus-visible:outline-vermelho";

const ALTURA = "h-12 px-6";

/**
 * A variante `texto` e o unico caso em que a caixa NAO pode ser a mesma: ela e
 * um link sublinhado, e `px-6` afastaria a palavra da margem do bloco em que
 * ela vive. Mas alvo de toque ela precisa ser — e com o `leading-none` do BASE
 * a caixa clicavel media ~13px de altura, menos de um terco dos 44px do §10.
 * Piso de 48px de altura (a mesma h-12 das outras tres) e 48px de largura, sem
 * padding lateral: `items-center` centraliza o texto na caixa e o sublinhado
 * continua colado na palavra, entao nada se desloca — o que muda e so o
 * tamanho do que o dedo acerta.
 */
const ALVO_DE_TOQUE = "min-h-12 min-w-12";

const VARIANTES: Record<Variante, string> = {
  primario: `${ALTURA} bg-vermelho text-white hover:bg-vermelho-esc focus-visible:outline-fuligem`,
  primarioEscuro: `${ALTURA} bg-cal text-fuligem hover:bg-cal-puro`,
  secundario: `${ALTURA} border border-current text-current hover:bg-fuligem hover:text-cal`,
  texto: `${ALVO_DE_TOQUE} underline underline-offset-4 decoration-1 text-vermelho hover:text-vermelho-esc`,
};

type Comum = { variante?: Variante; className?: string; children: ReactNode };

export function Botao({
  variante = "primario",
  className = "",
  children,
  ...props
}: Comum & ComponentProps<"button">) {
  return (
    <button className={`${BASE} ${VARIANTES[variante]} ${className}`} {...props}>
      {children}
    </button>
  );
}

export function BotaoLink({
  variante = "primario",
  className = "",
  children,
  ...props
}: Comum & ComponentProps<typeof Link>) {
  return (
    <Link className={`${BASE} ${VARIANTES[variante]} ${className}`} {...props}>
      {children}
    </Link>
  );
}
