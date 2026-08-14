import type { Linha } from "./tipos";

/**
 * Rotulos de exibicao e mapas de cor.
 *
 * Ficam aqui, ao lado de MOAGENS em tipos.ts, para que os componentes nao
 * inventem cada um a sua traducao. As `notas` sao gravadas em kebab-case sem
 * acento no contrato (`castanha-do-para`) porque sao chave de filtro; a forma
 * legivel e responsabilidade desta camada, nunca do componente.
 */

/** estetica.md §4.1 — cada linha herda a cor da propria embalagem. */
export const LINHAS: Record<Linha, { rotulo: string; corVar: string }> = {
  classico: { rotulo: "Clássico", corVar: "var(--color-fuligem)" },
  suave: { rotulo: "Suave", corVar: "var(--color-juta)" },
  aromatizado: { rotulo: "Aromatizado", corVar: "var(--color-vermelho)" },
};

/** estetica.md §5.3 — a escala 1-5 sempre acompanhada do texto, nunca so a barra. */
export const PONTO_TORRA: Record<number, string> = {
  1: "Torra clara",
  2: "Torra clara-média",
  3: "Torra média",
  4: "Torra média-escura",
  5: "Torra escura",
};

const NOTAS_IRREGULARES: Record<string, string> = {
  "castanha-do-para": "Castanha-do-pará",
  "doce-de-leite": "Doce de leite",
  "amendoim-torrado": "Amendoim torrado",
  "chocolate-meio-amargo": "Chocolate meio amargo",
  "laranja-da-terra": "Laranja-da-terra",
  "milho-torrado": "Milho torrado",
  jabuticaba: "Jabuticaba",
  amendoa: "Amêndoa",
  pessego: "Pêssego",
  baunilha: "Baunilha",
  rapadura: "Rapadura",
  cacau: "Cacau",
  canela: "Canela",
  cravo: "Cravo",
  cana: "Cana",
  mel: "Mel",
};

/** Kebab-case do contrato para texto de tela. */
export function rotuloNota(nota: string): string {
  return (
    NOTAS_IRREGULARES[nota] ??
    nota.replace(/-/g, " ").replace(/^./, (c) => c.toUpperCase())
  );
}

/** "1.180 m" — separador de milhar pt-BR, para a Martian Mono. */
export function formatarAltitude(metros: number): string {
  return `${metros.toLocaleString("pt-BR")} m`;
}
