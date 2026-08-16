import type { Metadata } from "next";
import Image from "next/image";
import { listarLotes } from "@/lib/catalogo/repositorio";
import { formatarAltitude } from "@/lib/catalogo/rotulos";
import { Serra } from "@/components/marca/Serra";
import { BotaoLink } from "@/components/ui/Botao";

/**
 * A Serra — estetica.md §7.5.
 *
 * Pagina editorial longa, o oposto de uma "About" corporativa. O documento
 * proibe explicitamente: timeline com bolinhas, contadores animados de "anos de
 * historia", icones de folha/xicara/coracao. Nada disso e da Canastra.
 */

export const metadata: Metadata = {
  title: "A Serra — Café Canastra",
  description:
    "Desde 1985 na Serra da Canastra, entre 900 e 1.320 metros. O território, os produtores e a torra.",
};

export const revalidate = 3600;

export default async function PaginaSerra() {
  const lotes = await listarLotes({}, "altitude-desc");
  const produtores = lotes.map((l) => ({
    nome: l.lavoura.produtor,
    municipio: l.lavoura.municipio.replace(" — MG", ""),
    altitude: l.lavoura.altitude,
    lote: l.nome,
  }));

  return (
    <>
      {/* ── Herói ───────────────────────────────────────── superfície fuligem */}
      <section className="relative flex min-h-[70vh] flex-col justify-end overflow-hidden bg-fuligem text-cal">
        <Serra
          aria-hidden
          className="absolute inset-x-0 bottom-0 h-[24vh] max-h-[240px] w-full text-fuligem-80"
          strokeWidth={1.5}
          preenchido
        />
        <div className="relative mx-auto w-full max-w-[1440px] px-4 pb-16 pt-28 md:px-10 md:pb-20">
          <p className="text-[12px] font-semibold uppercase tracking-[0.18em] text-juta">
            O território
          </p>
          <h1 className="mt-6 max-w-[16ch] font-titulo text-[clamp(2.5rem,6vw,4.5rem)] leading-[0.98] tracking-[-0.02em]">
            A serra faz o café.
          </h1>
          <p className="mt-6 max-w-[56ch] text-[18px] leading-relaxed text-cal/80">
            Nascente do São Francisco, escarpa da Casca d&apos;Anta, estrada de
            terra vermelha. É onde a lavoura fica — e é isso que a xícara mostra.
          </p>
        </div>
      </section>

      {/* ── 1985 ────────────────────────────────────────────── superfície cal */}
      <section className="bg-cal py-16 md:py-24">
        <div className="mx-auto grid max-w-[1440px] items-center gap-10 px-4 md:grid-cols-2 md:px-10">
          <div>
            <p className="font-dado text-[13px] tracking-[0.08em] text-barro">
              1985
            </p>
            <h2 className="mt-4 titulo-secao text-[clamp(1.75rem,3.5vw,2.75rem)] leading-tight">
              Quarenta anos na mesma serra
            </h2>
            <p className="mt-5 max-w-[62ch] text-[17px] leading-relaxed text-fuligem-80">
              A primeira lavoura foi plantada na borda do chapadão, onde a noite
              esfria mais rápido. Levou anos para entender que aquilo era uma
              vantagem, não um problema: o grão amadurece devagar e ganha doçura.
            </p>
            <p className="mt-4 max-w-[62ch] text-[17px] leading-relaxed text-fuligem-80">
              Desde então, mudou a torra, mudou o beneficiamento, mudou quem
              compra. A serra não mudou.
            </p>
          </div>
          {/* min-w-0: item de grid tem `min-width: auto` por padrao, entao a
              largura intrinseca da imagem (1448px) empurra a coluna e estoura
              o documento em mobile. */}
          <div className="min-w-0">
            <Image
              src="/nossa-historia.png"
              alt="Dois produtores entre as fileiras de café, no fim da tarde"
              width={1448}
              height={1448}
              sizes="(min-width: 768px) 50vw, 100vw"
              className="h-auto w-full border border-fuligem-20"
            />
          </div>
        </div>
      </section>

      {/* ── Território / altitudes ───────────────────────── superfície kraft */}
      <section className="bg-juta-claro py-16 md:py-24">
        <div className="mx-auto max-w-[1440px] px-4 md:px-10">
          <h2 className="titulo-secao text-[clamp(1.75rem,3.5vw,2.75rem)] leading-tight">
            De 900 a 1.320 metros
          </h2>
          <p className="mt-5 max-w-[62ch] text-[17px] leading-relaxed text-fuligem-80">
            Altitudes mais altas, noites mais frias: o grão amadurece devagar e
            ganha doçura e acidez cítrica. Mais abaixo, o corpo cresce e a torra
            aguenta ir mais longe. Nenhuma das duas é melhor — são xícaras
            diferentes.
          </p>

          <div className="relative mt-12">
            <Serra
              aria-hidden
              className="h-24 w-full text-fuligem/30 md:h-32"
              strokeWidth={1.5}
            />
            {/* Lista acessivel com o mesmo conteudo do desenho (§6). */}
            <ol className="mt-6 grid gap-px border border-fuligem/20 bg-fuligem/20 sm:grid-cols-2 lg:grid-cols-3">
              {produtores.map((p) => (
                <li key={p.lote} className="bg-juta-claro p-4">
                  <span className="font-dado text-[15px] tracking-[0.04em]">
                    {formatarAltitude(p.altitude)}
                  </span>
                  <p className="mt-1 text-[15px] font-semibold">{p.lote}</p>
                  <p className="text-[13px] text-fuligem-80">
                    {p.nome} · {p.municipio}
                  </p>
                </li>
              ))}
            </ol>
          </div>
        </div>
      </section>

      {/* ── A torra ─────────────────────────────────────── superfície fuligem */}
      <section className="bg-fuligem py-16 text-cal md:py-24">
        <div className="mx-auto max-w-[1440px] px-4 md:px-10">
          <p className="text-[12px] font-semibold uppercase tracking-[0.18em] text-juta">
            A torra
          </p>
          <h2 className="mt-5 max-w-[20ch] titulo-secao text-[clamp(1.75rem,3.5vw,2.75rem)] leading-tight">
            Em lotes pequenos, sob demanda
          </h2>
          <p className="mt-5 max-w-[62ch] text-[17px] leading-relaxed text-cal/80">
            Torramos na terça e enviamos na quarta. Café torrado há três semanas
            já não é o mesmo café — por isso não mantemos estoque torrado parado.
          </p>
          <div className="mt-10">
            <BotaoLink href="/cafes" variante="primarioEscuro">
              Ver os cafés
            </BotaoLink>
          </div>
        </div>
      </section>
    </>
  );
}
