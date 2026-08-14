import Image from "next/image";
import Link from "next/link";
import type { Lote } from "@/lib/catalogo/tipos";
import { precoMinimo, formatarPreco } from "@/lib/catalogo/repositorio";
import { LINHAS, rotuloNota, formatarAltitude } from "@/lib/catalogo/rotulos";
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

export function CardCafe({ lote }: { lote: Lote }) {
  const linha = LINHAS[lote.linha];
  const preco = precoMinimo(lote);

  return (
    <article className="group relative h-full">
      <Link
        href={`/cafes/${lote.slug}`}
        className="flex h-full flex-col border border-fuligem-20 bg-cal-puro transition-[box-shadow,border-color,transform] duration-[320ms] ease-canastra hover:-translate-x-1 hover:-translate-y-1 hover:border-vermelho hover:shadow-[4px_4px_0_var(--color-fuligem)] focus-visible:outline-2 focus-visible:outline-offset-[3px] focus-visible:outline-vermelho"
      >
        {/* Fita da linha: a cor vem da embalagem, nunca inventada (§4.1). */}
        <span
          aria-hidden
          className="block h-1 w-full"
          style={{ backgroundColor: linha.corVar }}
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
            variante="compacto"
            className="absolute bottom-3 right-3"
          />
        </div>

        <div className="flex flex-1 flex-col border-t border-fuligem-20 p-5">
          <p className="text-[12px] font-semibold uppercase tracking-[0.14em] text-fuligem-55">
            {lote.lavoura.municipio.replace(" — MG", "")}
            <span aria-hidden> · </span>
            {/* `normal-case` porque a unidade e "m", nao "M" — o uppercase do
                rotulo nao pode alcancar o dado. */}
            <span className="font-dado normal-case tracking-[0.06em]">
              {formatarAltitude(lote.lavoura.altitude)}
            </span>
          </p>

          <h3 className="mt-2 text-[20px] font-semibold leading-tight">
            {lote.nome}
          </h3>

          <p className="mt-1.5 text-[14px] text-fuligem-55">
            {lote.notas.map(rotuloNota).join(" · ")}
          </p>

          {/* mt-auto empurra torra e preco para a base: os cards da grade
              terminam alinhados mesmo com numero diferente de linhas de nota. */}
          <PontoTorra valor={lote.pontoTorra} compacto className="mt-3 pt-1" />

          <p className="mt-auto flex items-baseline gap-2 pt-4">
            <span className="text-[11px] uppercase tracking-[0.14em] text-fuligem-55">
              a partir de
            </span>
            <span
              className="font-dado text-[17px] tracking-[0.02em]"
              aria-label={formatarPreco(preco).replace("R$", "").trim() + " reais"}
            >
              {formatarPreco(preco)}
            </span>
          </p>
        </div>
      </Link>
    </article>
  );
}
