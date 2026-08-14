/**
 * Silhueta da serra.
 *
 * PROVISORIO. O estetica.md §1 exige que este path seja EXTRAIDO do logo real
 * (traco de pincel, com as falhas brancas caracteristicas) e simplificado para
 * ~40 pontos. O ativo disponivel hoje e `public/logo-canastra.png`, raster de
 * 3508x2481 — nao vetorizado. O desenho abaixo tem o perfil e a assimetria do
 * chapadao, mas NAO e o traco da marca: e um marcador de lugar para que o
 * layout exista enquanto a vetorizacao nao acontece.
 *
 * Ao substituir, manter: `currentColor` no stroke (permite trocar cor por CSS),
 * viewBox limpo, sem <style> inline. O componente <EscolhaPelaSerra> do proximo
 * plano depende deste path para posicionar os lotes por altitude via
 * getPointAtLength — por isso o path e um so, continuo, sem subpaths.
 */

export const SERRA_VIEWBOX = "0 0 1200 240";

/** Path continuo, um subpath so — requisito do getPointAtLength. */
export const SERRA_PATH =
  "M0 232 L74 214 L118 198 L152 205 L196 176 L233 186 L268 154 L310 163 " +
  "L352 132 L389 141 L424 118 L462 126 L498 96 L534 104 L566 78 L598 62 " +
  "L628 40 L658 20 L688 34 L714 58 L742 48 L774 72 L806 62 L838 88 " +
  "L872 78 L906 104 L940 96 L972 124 L1006 116 L1040 146 L1074 158 " +
  "L1108 184 L1146 200 L1200 226";

type Props = {
  className?: string;
  /** Espessura do traco. O §5.5 usa 1,5px nos pictogramas; o heroi pede mais. */
  strokeWidth?: number;
  /** Preenche a area sob a linha — usado como faixa decorativa de secao. */
  preenchido?: boolean;
  title?: string;
};

export function Serra({
  className,
  strokeWidth = 2,
  preenchido = false,
  title,
}: Props) {
  return (
    <svg
      viewBox={SERRA_VIEWBOX}
      className={className}
      fill="none"
      preserveAspectRatio="none"
      aria-hidden={title ? undefined : true}
      role={title ? "img" : undefined}
      focusable="false"
    >
      {title ? <title>{title}</title> : null}
      {preenchido ? (
        <path d={`${SERRA_PATH} L1200 240 L0 240 Z`} fill="currentColor" />
      ) : null}
      <path
        d={SERRA_PATH}
        stroke="currentColor"
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}
