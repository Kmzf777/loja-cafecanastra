import Image from "next/image";
import Link from "next/link";
import type { Lote } from "@/lib/catalogo/tipos";
import { precoMinimo, formatarPreco, temEstoque } from "@/lib/catalogo/repositorio";
import { COR_DA_LINHA, rotuloNota } from "@/lib/catalogo/rotulos";
import { dicionario } from "@/lib/i18n/dicionario";
import { href } from "@/lib/i18n/rotas";
import { LOCALE_PADRAO, type Locale } from "@/lib/i18n/tipos";
import { SeloSCA } from "./SeloSCA";
import { PontoTorra } from "./PontoTorra";

/**
 * estetica.md §5.2.
 *
 * O card e "etiqueta" pura: grid, filete, mono, alinhamento. O contraste com a
 * superficie de "mao" em volta e o design (§3).
 *
 * Hover: crossfade sabor -> pacote, sombra de carimbo de 4px (deslocamento
 * solido, nunca sombra difusa — §4.4) e o filete passando a vermelho.
 *
 * DUAS LIMITACOES CONHECIDAS, ambas de acervo e nao de codigo:
 *  - `fotos.sabor` e hoje um fallback do pacote (§8 pede o ingrediente da nota
 *    de degustacao). O crossfade existe e funciona, mas as duas imagens sao a
 *    mesma, entao ele nao aparece ate a producao fotografica acontecer.
 *  - Os PNGs disponiveis sao 1:1 e o card e 4:5 (§8). Usamos `object-cover`,
 *    o que recorta o quadrado — decisao de enquadramento provisoria.
 */

export function CardCafe({
  lote,
  locale = LOCALE_PADRAO,
}: {
  lote: Lote;
  /**
   * O idioma da página que renderiza o card. Tem padrão porque o card aparece
   * em cinco lugares e um deles — o "not-found" da PDP — não recebe os
   * parâmetros de rota do App Router e por isso não sabe o idioma. Está
   * documentado no topo daquele arquivo.
   */
  locale?: Locale;
}) {
  const d = dicionario(locale);
  const corDaLinha = COR_DA_LINHA[lote.linha];
  const preco = precoMinimo(lote);
  const disponivel = temEstoque(lote);

  return (
    <article className="group relative h-full">
      <Link
        // O link mais clicado do site inteiro. Cru, ele tirava do inglês
        // qualquer pessoa que clicasse num café a partir de /en/cafes.
        href={href(locale, `/cafes/${lote.slug}`)}
        className="flex h-full flex-col border border-fuligem-20 bg-cal-puro transition-[box-shadow,border-color,transform] duration-[320ms] ease-canastra hover:-translate-x-1 hover:-translate-y-1 hover:border-vermelho hover:shadow-[4px_4px_0_var(--color-fuligem)] focus-visible:outline-2 focus-visible:outline-offset-[3px] focus-visible:outline-vermelho"
      >
        {/* Fita da linha: a cor vem da embalagem, nunca inventada (§4.1). */}
        <span
          aria-hidden
          className="block h-1 w-full"
          style={{ backgroundColor: corDaLinha }}
        />

        <div className="relative aspect-[4/5] overflow-hidden">
          <Image
            src={lote.fotos.sabor.src}
            alt={lote.fotos.sabor.alt}
            width={lote.fotos.sabor.w}
            height={lote.fotos.sabor.h}
            sizes="(min-width: 1200px) 25vw, (min-width: 600px) 50vw, 100vw"
            className="h-full w-full object-cover transition-opacity duration-[320ms] ease-canastra group-hover:opacity-0"
          />
          <Image
            src={lote.fotos.pacote.src}
            alt=""
            aria-hidden
            width={lote.fotos.pacote.w}
            height={lote.fotos.pacote.h}
            sizes="(min-width: 1200px) 25vw, (min-width: 600px) 50vw, 100vw"
            className="absolute inset-0 h-full w-full object-cover opacity-0 transition-opacity duration-[320ms] ease-canastra group-hover:opacity-100"
          />
          <SeloSCA
            sca={lote.sca}
            scaExata={lote.scaExata}
            locale={locale}
            variante="compacto"
            className="absolute bottom-3 right-3"
          />
        </div>

        <div className="flex flex-1 flex-col border-t border-fuligem-20 p-5">
          {/* Antes vinha "município · altitude", ambos inventados por lote.
              A origem verdadeira é a mesma para toda a coleção, então o que
              distingue um card do outro aqui é a torra — que é real. */}
          <p className="text-[12px] font-semibold uppercase tracking-[0.14em] text-fuligem-55">
            {lote.origem.regiao.replace(" — Minas Gerais", "")}
            <span aria-hidden> · </span>
            <span className="normal-case">{lote.torra}</span>
          </p>

          <h3 className="mt-2 text-[20px] font-semibold leading-tight">
            {lote.nome}
          </h3>

          <p className="mt-1.5 text-[14px] text-fuligem-55">
            {lote.notas.map((nota) => rotuloNota(nota, locale)).join(" · ")}
          </p>

          {/* mt-auto empurra torra e preco para a base: os cards da grade
              terminam alinhados mesmo com numero diferente de linhas de nota. */}
          <PontoTorra
            valor={lote.pontoTorra}
            compacto
            locale={locale}
            className="mt-3 pt-1"
          />

          {/* `preco` é nulo quando a linha não tem nenhuma variante com preço
              na loja — hoje é o caso da Canela, cujos formatos capturados
              estão todos esgotados. Mostrar "a partir de R$ 0,00" seria pior
              do que dizer que não dá para comprar. */}
          <p className="mt-auto flex items-baseline gap-2 pt-4">
            {preco === null ? (
              <span className="text-[13px] uppercase tracking-[0.14em] text-fuligem-55">
                {d.comum.indisponivel}
              </span>
            ) : (
              <>
                <span className="text-[11px] uppercase tracking-[0.14em] text-fuligem-55">
                  {d.comum.aPartirDe}
                </span>
                <span
                  className="font-dado text-[17px] tracking-[0.02em]"
                  aria-label={
                    formatarPreco(preco).replace("R$", "").trim() + " reais"
                  }
                >
                  {formatarPreco(preco)}
                </span>
                {!disponivel ? (
                  <span className="text-[11px] uppercase tracking-[0.14em] text-vermelho">
                    {d.comum.esgotado}
                  </span>
                ) : null}
              </>
            )}
          </p>
        </div>
      </Link>
    </article>
  );
}
