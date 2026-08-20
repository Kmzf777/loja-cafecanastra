import type { Lote } from "./catalogo/tipos";
import { LINHAS, rotuloNota } from "./catalogo/rotulos";

/**
 * Busca por texto da PLP (`/cafes?q=…`).
 *
 * Fica FORA do repositório de propósito: o repositório filtra por facetas do
 * contrato (linha, torra, formato), enquanto isto aqui é casamento de texto
 * livre — regra de apresentação, não de catálogo. Função pura para o teste
 * rodar em node sem tocar fetch.
 *
 * IMPORTS RELATIVOS, não `@/`: o vitest.config.ts não resolve o alias.
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
function corpoDeBusca(lote: Lote): string {
  return normalizarTexto(
    [
      lote.nome,
      lote.descricao,
      lote.linha,
      LINHAS[lote.linha].rotulo,
      lote.torra,
      ...lote.notas,
      ...lote.notas.map(rotuloNota),
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
 */
export function filtrarPorTexto(lotes: Lote[], q: string | undefined): Lote[] {
  const termo = normalizarTexto(q ?? "");
  if (!termo) return lotes;

  const palavras = termo.split(/\s+/);
  return lotes.filter((lote) => {
    const corpo = corpoDeBusca(lote);
    return palavras.every((palavra) => corpo.includes(palavra));
  });
}
