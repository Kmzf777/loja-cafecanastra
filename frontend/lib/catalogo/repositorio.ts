import { LOTES } from "./produtos";
import type { Filtros, Lote, Ordenacao, Variante } from "./tipos";

/**
 * Unica porta de entrada do catalogo. Nenhuma pagina conhece a origem do dado:
 * trocar a fonte local pela API real e reescrever so este arquivo. As funcoes
 * sao `async` de proposito — quando a API entrar, a assinatura nao muda.
 */

export async function listarLotes(
  filtros: Filtros = {},
  ordenacao: Ordenacao = "relevancia",
): Promise<Lote[]> {
  const casa = LOTES.filter((lote) => {
    if (filtros.linha && lote.linha !== filtros.linha) return false;
    if (filtros.pontoTorraMin && lote.pontoTorra < filtros.pontoTorraMin) return false;
    if (filtros.pontoTorraMax && lote.pontoTorra > filtros.pontoTorraMax) return false;
    if (filtros.moagem && !lote.variantes.some((v) => v.moagem === filtros.moagem)) return false;
    if (filtros.formato) {
      const emVariantes = lote.variantes.some((v) => v.formato === filtros.formato);
      const emEspeciais = lote.formatosEspeciais.some(
        (f) => f.formato === filtros.formato,
      );
      if (!emVariantes && !emEspeciais) return false;
    }
    if (
      filtros.pesoGramas &&
      !lote.variantes.some((v) => v.pesoGramas === filtros.pesoGramas)
    )
      return false;
    if (filtros.soDisponiveis && !temEstoque(lote)) return false;
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
      return copia.sort((a, b) => precoOrdenavel(a) - precoOrdenavel(b));
    case "preco-desc":
      return copia.sort((a, b) => precoOrdenavel(b) - precoOrdenavel(a));
    case "torra-asc":
      return copia.sort((a, b) => a.pontoTorra - b.pontoTorra);
    case "torra-desc":
      return copia.sort((a, b) => b.pontoTorra - a.pontoTorra);
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

/** Os outros cafés da casa — a seção "Da mesma serra" da PDP. */
export async function lotesRelacionados(lote: Lote, limite = 4): Promise<Lote[]> {
  const torraParecida = LOTES.filter(
    (l) => l.slug !== lote.slug && Math.abs(l.pontoTorra - lote.pontoTorra) <= 1,
  );
  const resto = LOTES.filter(
    (l) => l.slug !== lote.slug && !torraParecida.includes(l),
  );
  return [...torraParecida, ...resto].slice(0, limite);
}

/** Faixa de ponto de torra da coleção — domínio do eixo do §6 (Plano B). */
export async function faixaTorra(): Promise<{ min: number; max: number }> {
  const pontos = LOTES.map((l) => l.pontoTorra);
  return { min: Math.min(...pontos), max: Math.max(...pontos) };
}

/**
 * Menor preço entre as variantes — o "a partir de" do card.
 *
 * Devolve `null` quando a linha não tem nenhuma variante de pacote com preço:
 * é o caso real da Canela, cujos únicos formatos capturados (drip e cápsula)
 * estão esgotados e sem preço na loja. Inventar um número aqui seria mentir na
 * vitrine; quem consome trata o `null` mostrando "Indisponível".
 */
export function precoMinimo(lote: Lote): number | null {
  const precos = lote.variantes.filter((v) => v.preco > 0).map((v) => v.preco);
  return precos.length ? Math.min(...precos) : null;
}

/** Como `precoMinimo`, mas com um valor alto no lugar do nulo, para ordenação. */
function precoOrdenavel(lote: Lote): number {
  return precoMinimo(lote) ?? Number.MAX_SAFE_INTEGER;
}

/** Há ao menos uma combinação comprável? */
export function temEstoque(lote: Lote): boolean {
  return (
    lote.variantes.some((v) => v.estoque > 0) ||
    lote.formatosEspeciais.some((f) => f.estoque > 0)
  );
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
  pacotes = 1,
): Variante | undefined {
  return lote.variantes.find(
    (v) =>
      v.moagem === moagem && v.pesoGramas === pesoGramas && v.pacotes === pacotes,
  );
}

/** Quantos pacotes por embalagem existem para uma combinação (1, 3, 4...). */
export function embalagensDe(
  lote: Lote,
  moagem: Variante["moagem"],
  pesoGramas: Variante["pesoGramas"],
): number[] {
  return [
    ...new Set(
      lote.variantes
        .filter((v) => v.moagem === moagem && v.pesoGramas === pesoGramas)
        .map((v) => v.pacotes),
    ),
  ].sort((a, b) => a - b);
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
