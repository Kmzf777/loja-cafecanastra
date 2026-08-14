import { PONTO_TORRA } from "@/lib/catalogo/rotulos";

/**
 * estetica.md §5.3 — escala 1-5.
 *
 * O trilho vai de juta a barro a fuligem: e a rampa da brasa do fogao a lenha,
 * nao uma barra generica. O valor textual fica SEMPRE visivel — o §5.3 e
 * explicito quanto a isso, porque a barra sozinha nao e acessivel.
 */

type Props = {
  valor: number;
  /** Em `compacto`, o rotulo fica na mesma linha da barra (uso no card). */
  compacto?: boolean;
  className?: string;
};

export function PontoTorra({ valor, compacto = false, className = "" }: Props) {
  const rotulo = PONTO_TORRA[valor] ?? "Torra";

  const barra = (
    <span
      className="relative block h-1.5 w-full overflow-hidden"
      style={{
        background:
          "linear-gradient(90deg, var(--color-juta) 0%, var(--color-barro) 55%, var(--color-fuligem) 100%)",
      }}
    >
      {/* Mascara o trecho a direita do valor: o preenchido e a intensidade. */}
      <span
        className="absolute inset-y-0 right-0 bg-fuligem-20"
        style={{ width: `${((5 - valor) / 5) * 100}%` }}
      />
    </span>
  );

  if (compacto) {
    return (
      <p
        className={`flex items-center gap-2 ${className}`}
        aria-label={`${rotulo}, ${valor} de 5`}
      >
        <span aria-hidden className="w-16 shrink-0">
          {barra}
        </span>
        <span className="text-[13px] text-fuligem-55">
          {rotulo} · <span className="font-dado">{valor}</span>
        </span>
      </p>
    );
  }

  return (
    <div className={className} aria-label={`${rotulo}, ${valor} de 5`}>
      <div className="flex items-baseline justify-between">
        <span className="text-[12px] font-semibold uppercase tracking-[0.14em] text-fuligem-55">
          Clara
        </span>
        <span className="text-[12px] font-semibold uppercase tracking-[0.14em] text-fuligem-55">
          Escura
        </span>
      </div>
      <div aria-hidden className="mt-2">
        {barra}
      </div>
      <p className="mt-2 text-[14px]">
        {rotulo} · <span className="font-dado">{valor} de 5</span>
      </p>
    </div>
  );
}
