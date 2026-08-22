import type { Dicionario } from "@/lib/i18n/dicionario";

/**
 * A espessura da moagem de uma receita, no idioma da página.
 *
 * É UMA PONTE, E ELA EXISTE PORQUE O TIPO AINDA NÃO FECHOU. `Preparo.moagem` é
 * `string` livre (lib/catalogo/tipos.ts) e as receitas de `lib/catalogo/
 * produtos.ts` a escrevem em português — "Média", "Média-fina", "Grossa",
 * "Fina". Sem esta função, a última linha em português de uma PDP em inglês
 * era justamente a do cartão de preparo, que o estetica.md §7.3 chama de "a
 * etiqueta em estado puro".
 *
 * Normaliza o texto para a chave canônica (minúscula, sem acento) e CAI NO
 * ORIGINAL quando não reconhece — o mesmo contrato de `rotuloNota()` em
 * lib/catalogo/rotulos.ts: valor inesperado aparece como veio, nunca como
 * vazio nem como a chave crua.
 *
 * O CONSERTO DEFINITIVO NÃO É AQUI: é `Preparo.moagem` deixar de ser `string`
 * e virar a união dos quatro valores, como `Moagem` e `Metodo` já são. No dia
 * em que isso acontecer, esta função morre e a leitura vira direta —
 * `d.catalogo.moagemDaReceita[p.moagem]`. Ela mora fora do page.tsx para poder
 * ser testada sem montar a página inteira.
 */
export function moagemDaReceita(texto: string, d: Dicionario): string {
  const chave = texto
    .toLowerCase()
    .normalize("NFD")
    // O bloco de acentos combinantes: `NFD` separa o "é" em "e" + acento, e
    // esta faixa apaga o segundo.
    .replace(/[\u0300-\u036f]/g, "");
  const tabela: Record<string, string> = d.catalogo.moagemDaReceita;
  return tabela[chave] ?? texto;
}
