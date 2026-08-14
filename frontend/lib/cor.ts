/** Converte "#RRGGBB" nos canais 0-255. */
function canais(hex: string): [number, number, number] {
  const h = hex.replace("#", "");
  return [
    parseInt(h.slice(0, 2), 16),
    parseInt(h.slice(2, 4), 16),
    parseInt(h.slice(4, 6), 16),
  ];
}

/** Luminancia relativa conforme WCAG 2.1. */
function luminancia(hex: string): number {
  const [r, g, b] = canais(hex).map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** Razao de contraste WCAG entre duas cores hex. Vai de 1 a 21. */
export function razaoContraste(a: string, b: string): number {
  const la = luminancia(a);
  const lb = luminancia(b);
  const [claro, escuro] = la > lb ? [la, lb] : [lb, la];
  return (claro + 0.05) / (escuro + 0.05);
}
