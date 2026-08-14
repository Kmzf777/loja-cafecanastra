import { LOTES } from "./mock";
import type { Filtros, Lote } from "./tipos";

export async function listarLotes(filtros: Filtros = {}): Promise<Lote[]> {
  return LOTES.filter((lote) => {
    if (filtros.linha && lote.linha !== filtros.linha) return false;
    if (filtros.pontoTorraMin && lote.pontoTorra < filtros.pontoTorraMin) return false;
    if (filtros.pontoTorraMax && lote.pontoTorra > filtros.pontoTorraMax) return false;
    if (filtros.scaMin && lote.sca < filtros.scaMin) return false;
    if (filtros.moagem && !lote.variantes.some((v) => v.moagem === filtros.moagem)) return false;
    if (filtros.notas?.length && !filtros.notas.every((n) => lote.notas.includes(n))) return false;
    return true;
  });
}

export async function obterLote(slug: string): Promise<Lote | null> {
  return LOTES.find((l) => l.slug === slug) ?? null;
}

export async function listarSlugs(): Promise<string[]> {
  return LOTES.map((l) => l.slug);
}

/** Menor preco entre as variantes — o "a partir de" do card. */
export function precoMinimo(lote: Lote): number {
  return Math.min(...lote.variantes.map((v) => v.preco));
}

/** Centavos para "R$ 42,00". */
export function formatarPreco(centavos: number): string {
  return (centavos / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}
