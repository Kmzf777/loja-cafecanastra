/**
 * estetica.md §4.4 — grao de papel. Overlay global, aplicado uma vez.
 *
 * Profundidade neste projeto se faz por papel e filete, nunca por sombra
 * difusa. A textura vem de um SVG feTurbulence embutido como data-URI, nao de
 * PNG (§10: peso e nitidez em qualquer densidade de tela).
 */

const RUIDO =
  "data:image/svg+xml;utf8," +
  encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="180" height="180">
      <filter id="r"><feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="3"/></filter>
      <rect width="180" height="180" filter="url(#r)"/>
    </svg>`,
  );

export function Grao() {
  return (
    <div
      aria-hidden
      className="pointer-events-none fixed inset-0 z-[9999] opacity-[0.035] mix-blend-multiply"
      style={{ backgroundImage: `url("${RUIDO}")` }}
    />
  );
}
