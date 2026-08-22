import type { Lote } from "./catalogo/tipos";
import { rotuloNota } from "./catalogo/rotulos";
import { dicionario } from "./i18n/dicionario";
import { LOCALE_PADRAO, type Locale } from "./i18n/tipos";

/**
 * Busca por texto da PLP (`/cafes?q=…`).
 *
 * Fica FORA do repositório de propósito: o repositório filtra por facetas do
 * contrato (linha, torra, formato), enquanto isto aqui é casamento de texto
 * livre — regra de apresentação, não de catálogo. Função pura para o teste
 * rodar em node sem tocar fetch.
 */

/** Minúsculas e sem acento: "Clássico" e "classico" são a mesma busca. */
export function normalizarTexto(texto: string): string {
  return texto
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

/** Tudo em que uma busca pode acertar num lote, já normalizado. */
function corpoDeBusca(lote: Lote, locale: Locale): string {
  const d = dicionario(locale);
  return normalizarTexto(
    [
      lote.nome,
      lote.descricao,
      lote.linha,
      d.catalogo.linha[lote.linha],
      lote.torra,
      ...lote.notas,
      ...lote.notas.map((nota) => rotuloNota(nota, locale)),
    ].join(" "),
  );
}

/**
 * Filtra por texto livre sobre nome, descrição, linha, torra e notas.
 *
 * AND entre palavras — como o filtro de `notas` do repositório: quem digita
 * "suave chocolate" quer o café que é as duas coisas, não a união de tudo que
 * é suave com tudo que tem chocolate. Busca vazia devolve a lista intacta
 * (mesma referência: nenhum trabalho, nenhuma cópia).
 *
 * O `locale` TEM PADRÃO, e é o único desta mudança que tem: o corpo de busca é
 * quase todo o lote JÁ TRADUZIDO que a PLP entrega (nome, descrição, torra e
 * as notas, que chegam com a chave do idioma). O idioma aqui decide só os dois
 * rótulos derivados — o nome da linha e a forma legível da nota — e a PLP,
 * que é quem chama de verdade, passa o dela.
 */
export function filtrarPorTexto(
  lotes: Lote[],
  q: string | undefined,
  locale: Locale = LOCALE_PADRAO,
): Lote[] {
  const termo = normalizarTexto(q ?? "");
  if (!termo) return lotes;

  const palavras = termo.split(/\s+/);
  return lotes.filter((lote) => {
    const corpo = corpoDeBusca(lote, locale);
    return palavras.every((palavra) => corpo.includes(palavra));
  });
}
