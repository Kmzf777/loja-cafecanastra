import { rotuloPontoTorra } from "@/lib/catalogo/rotulos";
import { dicionario } from "@/lib/i18n/dicionario";
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
   * PDP e um deles).
   *
   * ELE VALE PARA A REGUA INTEIRA AGORA. O degrau ("Torra escura") ja se
   * traduzia e as pontas do eixo nao: em /en a legenda dizia "Dark roast" com
   * "Clara" e "Escura" em cima dela, e o `aria-label` de todo card levava
   * "Dark roast, 5 de 5" ao leitor de tela. Um componente que traduz metade do
   * proprio texto e pior que um que nao traduz nada — o primeiro parece pronto.
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
  const escala = dicionario(locale).catalogo.escala;
  // A REGUA APARECE NAS DUAS FORMAS E TEM DE DIZER O MESMO: e este texto que
  // vai no aria-label do card compacto e na legenda visivel da PDP.
  const deCinco = `${valor} ${escala.deCinco}`;

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
        aria-label={`${rotulo}, ${deCinco}`}
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
    <div className={className} aria-label={`${rotulo}, ${deCinco}`}>
      <div className="flex items-baseline justify-between">
        <span className="text-[12px] font-semibold uppercase tracking-[0.14em] text-fuligem-55">
          {escala.clara}
        </span>
        <span className="text-[12px] font-semibold uppercase tracking-[0.14em] text-fuligem-55">
          {escala.escura}
        </span>
      </div>
      <div aria-hidden className="mt-2">
        {barra}
      </div>
      <p className="mt-2 text-[14px]">
        {rotulo} · <span className="font-dado">{deCinco}</span>
      </p>
    </div>
  );
}
