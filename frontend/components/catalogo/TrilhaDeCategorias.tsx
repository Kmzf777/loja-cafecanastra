import Link from "next/link";
import { Carrossel } from "@/components/ui/Carrossel";
import { dicionario } from "@/lib/i18n/dicionario";
import { href } from "@/lib/i18n/rotas";
import { LOCALE_PADRAO, type Locale } from "@/lib/i18n/tipos";

/**
 * A FAIXA LOGO ABAIXO DA PROVA — e ela é TIPOGRÁFICA, sem cartela nem foto.
 *
 * A decisão é de acervo antes de ser de gosto. O §8 do estetica.md declara a
 * produção fotográfica como caminho crítico do projeto, e ela não aconteceu:
 * seis cartelas exigiriam seis imagens que não existem, e a alternativa real
 * seria recortar arte de embalagem — que é exatamente o "default de IA" que o
 * §2 manda evitar. Tipografia é o que a marca tem de verdade.
 *
 * CÁPSULAS E DRIPS NÃO TÊM NADA COMPRÁVEL HOJE — os 13 SKUs desses dois
 * formatos estão todos esgotados ou sem preço. Eles ficam na trilha assim
 * mesmo, pela regra que `CardKit`, `PainelCompra` e `repositorio.ts` já
 * documentam: sumir com produto é pior do que dizer que acabou. A PLP filtra
 * por LINHA, não por SKU, então `?formato=drip` devolve as linhas que oferecem
 * drip e mostra o estado real de cada uma — o link não leva a lugar vazio. No
 * dia em que o estoque voltar, a trilha já está certa.
 */

export const CATEGORIAS_DA_TRILHA = [
  { chave: "capsula", caminho: "/cafes?formato=capsula" },
  { chave: "drip", caminho: "/cafes?formato=drip" },
  { chave: "graos", caminho: "/cafes?formato=graos" },
  { chave: "moido", caminho: "/cafes?formato=moido" },
  { chave: "kit", caminho: "/cafes?tipo=kit" },
  { chave: "todas", caminho: "/cafes" },
] as const;

export function TrilhaDeCategorias({
  locale = LOCALE_PADRAO,
}: {
  locale?: Locale;
}) {
  const d = dicionario(locale);

  /**
   * OS NOMES DE FORMATO SAEM DO DICIONÁRIO, NÃO DE UMA TABELA NOVA. "Em
   * grãos", "Moído", "Drip Coffee" e "Cápsulas" já são o vocabulário dos
   * filtros da PLP e dos chips da PDP; escrevê-los aqui de novo criaria o
   * segundo lugar onde eles podem discordar.
   */
  function rotulo(chave: (typeof CATEGORIAS_DA_TRILHA)[number]["chave"]) {
    if (chave === "kit") return d.comum.nossosKits;
    if (chave === "todas") return d.comum.maisCategorias;
    return d.catalogo.formato[chave];
  }

  return (
    <section className="border-b border-fuligem-20 bg-cal">
      <div className="mx-auto max-w-[1440px] px-4 py-5 md:px-10">
        <Carrossel rotulo={d.comum.categorias}>
          {CATEGORIAS_DA_TRILHA.map((c) => (
            /*
              `basis-auto` em vez do slide de largura fixa: aqui o item é uma
              PALAVRA, e forçá-la a 58% da tela deixaria "Kits" sozinho num
              quarteirão vazio. O `shrink-0` é o que mantém a faixa numa linha
              só e faz o overflow acontecer — que é o que a torna arrastável.
            */
            <li key={c.chave} className="shrink-0 snap-start">
              <Link
                href={href(locale, c.caminho)}
                className="inline-flex min-h-11 items-center px-4 text-[14px] font-semibold uppercase tracking-[0.1em] text-fuligem transition-colors duration-200 hover:text-vermelho focus-visible:outline-2 focus-visible:outline-offset-[3px] focus-visible:outline-vermelho md:px-6"
              >
                {rotulo(c.chave)}
              </Link>
            </li>
          ))}
        </Carrossel>
      </div>
    </section>
  );
}
