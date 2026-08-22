import { rotuloPontoTorra } from "@/lib/catalogo/rotulos";
import { LOCALE_PADRAO, type Locale } from "@/lib/i18n/tipos";

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
  /**
   * O idioma da pagina. Tem padrao pelo mesmo motivo do <CardCafe>: o card
   * aparece em lugares que nao recebem os parametros de rota (o "not-found" da
   * PDP e um deles). "Torra media" era portugues em /en e em /es ate aqui.
   *
   * AS OUTRAS TRES STRINGS DESTE COMPONENTE — "Clara", "Escura" e "de 5" —
   * continuam em portugues, e isso e pendencia declarada, nao descuido: elas
   * sao da interface do componente e nao da tabela de rotulos do catalogo, que
   * e o que esta mudanca cobre.
   */
  locale?: Locale;
  className?: string;
};

export function PontoTorra({
  valor,
  compacto = false,
  locale = LOCALE_PADRAO,
  className = "",
}: Props) {
  const rotulo = rotuloPontoTorra(valor, locale);

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
