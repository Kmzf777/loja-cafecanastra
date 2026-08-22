import type { Linha } from "./tipos";

/**
 * Rotulos de exibicao e mapas de cor.
 *
 * Ficam aqui, ao lado de MOAGENS em tipos.ts, para que os componentes nao
 * inventem cada um a sua traducao. As `notas` sao gravadas em kebab-case sem
 * acento no contrato (`castanha-do-para`) porque sao chave de filtro; a forma
 * legivel e responsabilidade desta camada, nunca do componente.
 */

/**
 * estetica.md §4.1 — cada linha herda a cor da PROPRIA embalagem, nunca uma cor
 * inventada. Preto (Clássico), kraft (Suave), vermelho (Canela) vêm da tabela
 * de ativos do §1; o barro do Microlote vem do papel do stand-up pouch, e a
 * mata do Néctar de Minas o separa do Clássico, com quem divide o pacote preto.
 */
export const LINHAS: Record<Linha, { rotulo: string; corVar: string }> = {
  classico: { rotulo: "Clássico", corVar: "var(--color-fuligem)" },
  suave: { rotulo: "Suave", corVar: "var(--color-juta)" },
  canela: { rotulo: "Canela", corVar: "var(--color-vermelho)" },
  microlote: { rotulo: "Microlote", corVar: "var(--color-barro)" },
  "nectar-de-minas": { rotulo: "Néctar de Minas", corVar: "var(--color-mata)" },
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
  amadeirado: "Amadeirado",
  especiarias: "Especiarias",
  chocolate: "Chocolate",
  castanha: "Castanha",
  jabuticaba: "Jabuticaba",
  // As três que entraram com as notas publicadas pela marca. Ficam aqui, e não
  // no fallback, porque o fallback só sabe trocar hífen por espaço: ele
  // devolveria "Melaco" e "Citrico", sem os acentos que a palavra tem.
  caramelo: "Caramelo",
  melaco: "Melaço",
  citrico: "Cítrico",
  frutado: "Frutado",
  floral: "Floral",
  amendoa: "Amêndoa",
  pessego: "Pêssego",
  baunilha: "Baunilha",
  rapadura: "Rapadura",
  cacau: "Cacau",
  canela: "Canela",
  cravo: "Cravo",
  doce: "Doçura",
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

/**
 * "250 g" / "1 kg" — o peso do pacote, na Martian Mono.
 * Substitui `formatarAltitude`: a altitude por lote era dado inventado e saiu
 * do contrato (ver o comentário sobre `Origem` em tipos.ts).
 */
export function formatarPeso(gramas: number): string {
  return gramas >= 1000
    ? `${(gramas / 1000).toLocaleString("pt-BR")} kg`
    : `${gramas} g`;
}

/**
 * "SCA 80+" quando o número é o PISO da embalagem; "SCA 86" quando é a nota
 * daquela linha.
 *
 * O "+" é uma afirmação, não enfeite: ele diz "pelo menos isto". Colocá-lo
 * numa nota exata inventa um piso que ninguém declarou; tirá-lo do piso
 * transforma o mínimo da coleção na nota de cada café. `Math.floor` continua
 * barrando o decimal do mock antigo (84,25) por qualquer das duas portas.
 */
export function formatarSca(sca: number, exata: boolean): string {
  const n = Math.floor(sca);
  return exata ? `SCA ${n}` : `SCA ${n}+`;
}

/**
 * Café especial ou café gourmet — e quem decide é o número, não o marketing.
 *
 * 80 é o corte da própria SCA, e é ele que autoriza a palavra "especial". O
 * Néctar de Minas tem 75: chamá-lo de especial seria mentir exatamente no selo
 * que a marca usa para se provar. A embalagem dele diz gourmet, e é isso que a
 * vitrine passa a dizer. Ver `<SeloSCA>`, que muda de forma por esta função.
 */
export type ClassificacaoSca = "especial" | "gourmet";

export function classificacaoSca(sca: number): ClassificacaoSca {
  return sca >= 80 ? "especial" : "gourmet";
}
