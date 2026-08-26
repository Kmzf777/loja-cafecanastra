/**
 * Os design tokens do estetica.md §4.1 e §4.3 em TypeScript.
 *
 * POR QUE ESTE ARQUIVO EXISTE. O CSS e a autoridade em runtime — quem pinta a
 * tela e `var(--color-*)`, gerado por `@theme static` em app/globals.css. Mas
 * ha consumidores que nao conseguem ler CSS: o teste de contraste WCAG roda em
 * Node, e qualquer calculo de cor (canvas, geracao de OG image, checagem de
 * legibilidade) precisa do hex literal. Antes, lib/cor.test.ts mantinha uma
 * COPIA dos hex; trocar --color-juta no CSS deixava o teste verde sobre o valor
 * velho, e as duas proibicoes de contraste que o §4.1 manda codificar paravam
 * de proteger em silencio.
 *
 * O par CSS/TS e mantido honesto por lib/tokens.test.ts, que le o bloco @theme
 * de app/globals.css e exige igualdade de nomes e valores. Nao ha codegen: os
 * dois arquivos sao escritos a mao, e a divergencia e um teste vermelho, nunca
 * um bug silencioso. Ao mexer num, mexa no outro.
 *
 * Nomenclatura: o estetica.md chama estes tokens de `--c-*`; aqui e no CSS eles
 * sao `--color-*`, porque o Tailwind v4 so gera utilitario para o token que
 * estiver no namespace `--color-`. Os valores sao os mesmos.
 */

/** Cores literais. Chave = sufixo do token CSS (`fuligem` -> `--color-fuligem`). */
export const CORES = {
  // — Superficies e tinta —
  fuligem: "#14110E",
  "fuligem-80": "#3A342E",
  "fuligem-55": "#6E655C",
  "fuligem-20": "#CFC8BE",
  cal: "#F1F0EA",
  "cal-puro": "#FBFAF7",

  // — Cores de territorio —
  juta: "#C9A87A",
  "juta-claro": "#E2D3B8",
  barro: "#8E4B2E",
  mata: "#2C3B2E",

  // — Acento de marca —
  vermelho: "#C4231E",
  "vermelho-esc": "#9A1A16",

  // — Semanticas —
  sucesso: "#3F6B45",
  alerta: "#B87514",
  // O par do `vermelho`/`vermelho-esc`, pelo mesmo motivo e medido: o ocre da
  // marca da 3,60:1 sobre cal-puro — passa na WCAG 1.4.11 (3:1, filete) e
  // reprova na 1.4.3 (4,5:1, texto pequeno). Filete no tom da marca, TEXTO no
  // tom escuro, que da 4,87:1.
  "alerta-esc": "#9A620F",
} as const;

export type NomeCor = keyof typeof CORES;

/**
 * Tokens que apontam para outro token em vez de trazer hex proprio.
 * `--color-erro: var(--color-vermelho)` — estetica.md §4.1. Mantido como alias
 * de proposito: erro e vermelho porque a marca decidiu assim, e no dia em que
 * o vermelho mudar o erro tem que mudar junto, sem ninguem lembrar.
 */
export const ALIAS_COR = {
  erro: "vermelho",
} as const satisfies Record<string, NomeCor>;

export const RAIOS = {
  /** Caixas: canto vivo. O territorio nao tem raio. */
  cx: "0px",
  /** Botoes: 2px, so para tirar o serrilhado do canto. */
  bt: "2px",
} as const;

export const EASINGS = {
  canastra: "cubic-bezier(.22, 1, .36, 1)",
} as const;

/** `varCor("juta")` -> `"var(--color-juta)"`. Use isto em `style={{}}` e SVG. */
export function varCor(nome: NomeCor | keyof typeof ALIAS_COR): string {
  return `var(--color-${nome})`;
}

/** Resolve um alias ate o hex literal. `hexDe("erro")` -> `"#C4231E"`. */
export function hexDe(nome: NomeCor | keyof typeof ALIAS_COR): string {
  return nome in CORES
    ? CORES[nome as NomeCor]
    : CORES[ALIAS_COR[nome as keyof typeof ALIAS_COR]];
}
