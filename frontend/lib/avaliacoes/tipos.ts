/**
 * Tipos do módulo de avaliações.
 *
 * A tabela por trás é `canastra.avaliacoes` (migração 0014). O vocabulário
 * aqui é o da VITRINE (camelCase, nomes de exibição); a tradução de/para as
 * colunas acontece só dentro de `avaliacoes.ts` e `servidor.ts` — nenhuma
 * página conhece o formato do PostgREST.
 */

/** Uma avaliação aprovada, como a PDP exibe. */
export type AvaliacaoPublica = {
  id: string;
  sku: string;
  /** Inteiro de 1 a 5. */
  nota: number;
  titulo: string | null;
  texto: string | null;
  /** Nome congelado no envio (trigger da 0014) — nunca vem de `clientes`. */
  nomeExibicao: string;
  /** ISO 8601. */
  criadoEm: string;
};

/** Uma avaliação do PRÓPRIO cliente, em qualquer status. */
export type MinhaAvaliacao = {
  id: string;
  sku: string;
  nota: number;
  titulo: string | null;
  texto: string | null;
  status: "pendente" | "aprovada" | "oculta";
  criadoEm: string;
};

/** Média + contagem de aprovadas — o que o `aggregateRating` precisa. */
export type AgregadoDeAvaliacoes = {
  /** Média aritmética das notas aprovadas (ex.: 4.6666…). Quem exibe arredonda. */
  media: number;
  contagem: number;
};

/** O que `listarAprovadas` devolve para a PDP. */
export type ResumoDeAvaliacoes = AgregadoDeAvaliacoes & {
  /** A página pedida, mais novas primeiro. */
  avaliacoes: AvaliacaoPublica[];
  /** Há mais páginas depois desta? */
  haMais: boolean;
};

/**
 * Teto da consulta de notas para a média — o MESMO nos dois caminhos (o
 * módulo do navegador e o fetch de servidor da PDP): acima disso a média
 * passa a ser "das 1000 mais recentes", distorção aceitável num catálogo de
 * 5 linhas, e o teto impede qualquer um dos dois de baixar um histórico
 * ilimitado. Vive aqui porque duas cópias divergiriam sem ninguém perceber.
 */
export const TETO_DE_NOTAS = 1000;

/**
 * Média aritmética das notas — a ÚNICA conta de média do módulo, usada pelo
 * navegador e pelo servidor. Lista vazia devolve 0; quem consome já trata o
 * "sem avaliações" ANTES (o servidor devolve `null`, a ilha mostra o convite),
 * então o 0 nunca vira nota exibida.
 */
export function mediaDeNotas(notas: number[]): number {
  if (notas.length === 0) return 0;
  return notas.reduce((soma, nota) => soma + nota, 0) / notas.length;
}
