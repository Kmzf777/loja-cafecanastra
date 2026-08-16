import { LOTES } from "./mock";
import type { Filtros, Lote, Ordenacao, Variante } from "./tipos";

/**
 * Unica porta de entrada do catalogo. Nenhuma pagina conhece a origem do dado:
 * trocar o mock pela API real e reescrever so este arquivo. As funcoes sao
 * `async` de proposito — quando a API entrar, a assinatura nao muda.
 */

export async function listarLotes(
  filtros: Filtros = {},
  ordenacao: Ordenacao = "relevancia",
): Promise<Lote[]> {
  const casa = LOTES.filter((lote) => {
    if (filtros.linha && lote.linha !== filtros.linha) return false;
    if (filtros.pontoTorraMin && lote.pontoTorra < filtros.pontoTorraMin) return false;
    if (filtros.pontoTorraMax && lote.pontoTorra > filtros.pontoTorraMax) return false;
    if (filtros.scaMin && lote.sca < filtros.scaMin) return false;
    if (filtros.altitudeMin && lote.lavoura.altitude < filtros.altitudeMin) return false;
    if (filtros.altitudeMax && lote.lavoura.altitude > filtros.altitudeMax) return false;
    if (filtros.moagem && !lote.variantes.some((v) => v.moagem === filtros.moagem)) return false;
    if (
      filtros.pesoGramas &&
      !lote.variantes.some((v) => v.pesoGramas === filtros.pesoGramas)
    )
      return false;
    // AND deliberado — ver o comentario sobre `notas` em tipos.ts.
    if (filtros.notas?.length && !filtros.notas.every((n) => lote.notas.includes(n)))
      return false;
    return true;
  });

  return ordenar(casa, ordenacao);
}

function ordenar(lotes: Lote[], ordenacao: Ordenacao): Lote[] {
  const copia = [...lotes];
  switch (ordenacao) {
    case "preco-asc":
      return copia.sort((a, b) => precoMinimo(a) - precoMinimo(b));
    case "preco-desc":
      return copia.sort((a, b) => precoMinimo(b) - precoMinimo(a));
    case "altitude-desc":
      return copia.sort((a, b) => b.lavoura.altitude - a.lavoura.altitude);
    case "sca-desc":
      return copia.sort((a, b) => b.sca - a.sca);
    default:
      return copia;
  }
}

export async function obterLote(slug: string): Promise<Lote | null> {
  return LOTES.find((l) => l.slug === slug) ?? null;
}

export async function listarSlugs(): Promise<string[]> {
  return LOTES.map((l) => l.slug);
}

/** Lotes da mesma linha, exceto o proprio — a secao "Da mesma serra" da PDP. */
export async function lotesRelacionados(lote: Lote, limite = 4): Promise<Lote[]> {
  const mesmaLinha = LOTES.filter((l) => l.slug !== lote.slug && l.linha === lote.linha);
  const resto = LOTES.filter((l) => l.slug !== lote.slug && l.linha !== lote.linha);
  return [...mesmaLinha, ...resto].slice(0, limite);
}

/** Faixa de altitude de toda a colecao — dominio do slider da PLP e do eixo §6. */
export async function faixaAltitude(): Promise<{ min: number; max: number }> {
  const alts = LOTES.map((l) => l.lavoura.altitude);
  return { min: Math.min(...alts), max: Math.max(...alts) };
}

/** Menor preco entre as variantes — o "a partir de" do card. */
export function precoMinimo(lote: Lote): number {
  return Math.min(...lote.variantes.map((v) => v.preco));
}

/**
 * A variante exata para uma combinacao. Devolve `undefined` quando ela nao
 * existe — a PDP DESABILITA a combinacao em vez de esconde-la (estetica.md
 * §5.5 trata a moagem como escolha explicita do cliente).
 */
export function acharVariante(
  lote: Lote,
  moagem: Variante["moagem"],
  pesoGramas: Variante["pesoGramas"],
): Variante | undefined {
  return lote.variantes.find(
    (v) => v.moagem === moagem && v.pesoGramas === pesoGramas,
  );
}

/** Centavos para "R$ 42,00". */
export function formatarPreco(centavos: number): string {
  return (centavos / 100).toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
  });
}

/** "R$ 42,00" -> "42 reais", para o aria-label (estetica.md §10). */
export function precoParaLeitor(centavos: number): string {
  const reais = Math.floor(centavos / 100);
  const cents = centavos % 100;
  return cents === 0 ? `${reais} reais` : `${reais} reais e ${cents} centavos`;
}
