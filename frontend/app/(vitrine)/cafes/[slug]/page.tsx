import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import {
  obterLote,
  listarSlugs,
  lotesRelacionados,
  precoMinimo,
  formatarPreco,
} from "@/lib/catalogo/repositorio";
import { MOAGENS } from "@/lib/catalogo/tipos";
import { rotuloNota, formatarAltitude } from "@/lib/catalogo/rotulos";
import { SeloSCA } from "@/components/catalogo/SeloSCA";
import { PontoTorra } from "@/components/catalogo/PontoTorra";
import { FichaLavoura } from "@/components/catalogo/FichaLavoura";
import { PainelCompra } from "@/components/catalogo/PainelCompra";
import { CardCafe } from "@/components/catalogo/CardCafe";

/**
 * PDP — estetica.md §7.3, "a pagina mais importante".
 *
 * E a rota que justifica o projeto inteiro: e aqui que SEO e Open Graph valem
 * dinheiro, por isso ela e ESTATICA (generateStaticParams) com metadata por
 * lote. Uma SPA entregaria HTML vazio ao crawler.
 *
 * ORDEM INEGOCIAVEL (§7.3): nota de sabor ACIMA de qualquer dado tecnico, e a
 * ficha da lavoura sempre recolhida por padrao.
 */

export const dynamicParams = false;

export async function generateStaticParams() {
  const slugs = await listarSlugs();
  return slugs.map((slug) => ({ slug }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const lote = await obterLote(slug);
  if (!lote) return { title: "Café não encontrado" };

  const notas = lote.notas.map(rotuloNota).join(", ");
  const descricao = `${lote.descricao} Notas de ${notas.toLowerCase()}. SCA ${Math.floor(lote.sca)}, ${lote.lavoura.municipio}.`;

  return {
    title: `${lote.nome} — Café Canastra`,
    description: descricao,
    openGraph: {
      title: `${lote.nome} — Café Canastra`,
      description: descricao,
      type: "website",
      locale: "pt_BR",
      images: [{ url: lote.fotos.pacote.src, alt: lote.fotos.pacote.alt }],
    },
  };
}

export default async function PaginaLote({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const lote = await obterLote(slug);
  if (!lote) notFound();

  const relacionados = await lotesRelacionados(lote);
  const galeria = [lote.fotos.sabor, lote.fotos.pacote, lote.fotos.terreiro].filter(
    (f): f is NonNullable<typeof f> => Boolean(f),
  );

  return (
    <>
      {/* ── Topo: galeria + compra ──────────────────────────── superfície cal */}
      <div className="mx-auto max-w-[1440px] px-5 py-10 md:px-10 md:py-16">
        <nav aria-label="Trilha" className="mb-8 text-[12px] uppercase tracking-[0.14em] text-fuligem-55">
          <Link href="/cafes" className="hover:text-vermelho">
            Cafés
          </Link>
          <span aria-hidden> · </span>
          <span>{lote.nome}</span>
        </nav>

        <div className="grid gap-10 lg:grid-cols-2 lg:gap-16">
          <div className="space-y-3">
            {galeria.map((foto, i) => (
              <Image
                key={foto.src + i}
                src={foto.src}
                alt={foto.alt}
                width={foto.w}
                height={foto.h}
                priority={i === 0}
                sizes="(min-width: 1024px) 45vw, 100vw"
                className="w-full border border-fuligem-20 bg-cal-puro"
              />
            ))}
          </div>

          <div>
            <p className="text-[12px] font-semibold uppercase tracking-[0.14em] text-fuligem-55">
              {lote.lavoura.municipio}
              <span aria-hidden> · </span>
              <span className="font-dado normal-case tracking-[0.06em]">
                {formatarAltitude(lote.lavoura.altitude)}
              </span>
            </p>

            <h1 className="mt-3 font-titulo text-[clamp(2.25rem,5vw,3.75rem)] leading-[1] tracking-[-0.015em]">
              {lote.nome}
            </h1>

            <p className="mt-2 text-[15px] text-fuligem-55">
              {lote.lavoura.produtor}
              <span aria-hidden> · </span>
              <span className="font-dado">Safra {lote.lavoura.safra}</span>
            </p>

            <SeloSCA sca={lote.sca} className="mt-6 inline-block" />

            {/* Nota de sabor em destaque, ACIMA de qualquer dado tecnico. */}
            <p className="mt-6 text-[19px] leading-relaxed">
              {lote.notas.map(rotuloNota).join(" · ")}
            </p>

            <PontoTorra valor={lote.pontoTorra} className="mt-6 max-w-sm" />

            <div className="mt-8">
              <PainelCompra lote={lote} />
            </div>

            <div className="mt-10">
              <FichaLavoura lote={lote} />
            </div>
          </div>
        </div>
      </div>

      {/* ── História do lote ────────────────────────────── superfície fuligem */}
      <section className="bg-fuligem py-16 text-cal md:py-24">
        <div className="mx-auto max-w-[1440px] px-5 md:px-10">
          <p className="text-[12px] font-semibold uppercase tracking-[0.18em] text-juta">
            A história deste lote
          </p>
          <p className="mt-6 max-w-[62ch] font-titulo text-[clamp(1.5rem,3vw,2.25rem)] leading-tight">
            {lote.descricao}
          </p>
          <p className="mt-6 max-w-[62ch] text-[17px] leading-relaxed text-cal/80">
            Colhido em {lote.lavoura.produtor}, em {lote.lavoura.municipio}, a{" "}
            <span className="font-dado">
              {formatarAltitude(lote.lavoura.altitude)}
            </span>
            . Variedade {lote.lavoura.variedade}, processo{" "}
            {lote.lavoura.processo.toLowerCase()}.
          </p>
        </div>
      </section>

      {/* ── Como preparar ─────────────────────────────────── superfície kraft */}
      <section className="bg-juta-claro py-16 md:py-24">
        <div className="mx-auto max-w-[1440px] px-5 md:px-10">
          <h2 className="font-titulo text-[clamp(1.75rem,3.5vw,2.75rem)] leading-tight">
            Como preparar
          </h2>

          <div className="mt-10 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {lote.preparo.map((p) => {
              const metodo =
                MOAGENS.find((m) => m.valor === p.metodo)?.rotulo ?? p.metodo;
              const linhas: [string, string][] = [
                ["Proporção", `${p.proporcao} · ${p.gramas} g / ${p.ml} ml`],
                ["Temperatura", `${p.temperaturaC} °C`],
                [
                  "Tempo",
                  `${Math.floor(p.tempoSegundos / 60)} min ${p.tempoSegundos % 60 ? `${p.tempoSegundos % 60} s` : ""}`.trim(),
                ],
                ["Moagem", p.moagem],
              ];
              return (
                <div key={p.metodo} className="border border-fuligem/25 bg-cal p-6">
                  <h3 className="text-[13px] font-semibold uppercase tracking-[0.14em]">
                    {metodo}
                  </h3>
                  <dl className="mt-4">
                    {linhas.map(([k, v]) => (
                      <div
                        key={k}
                        className="flex items-baseline justify-between gap-4 border-b border-fuligem-20 py-2 last:border-b-0"
                      >
                        <dt className="text-[11px] uppercase tracking-[0.14em] text-fuligem-55">
                          {k}
                        </dt>
                        <dd className="font-dado text-[13px]">{v}</dd>
                      </div>
                    ))}
                  </dl>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* ── Da mesma serra ──────────────────────────────────── superfície cal */}
      <section className="bg-cal py-16 md:py-24">
        <div className="mx-auto max-w-[1440px] px-5 md:px-10">
          <div className="flex flex-wrap items-baseline justify-between gap-4">
            <h2 className="font-titulo text-[clamp(1.75rem,3.5vw,2.75rem)] leading-tight">
              Da mesma serra
            </h2>
            <span className="font-dado text-[13px] text-fuligem-55">
              a partir de {formatarPreco(Math.min(...relacionados.map(precoMinimo)))}
            </span>
          </div>
          <div className="mt-10 grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-4">
            {relacionados.map((l) => (
              <CardCafe key={l.slug} lote={l} />
            ))}
          </div>
        </div>
      </section>
    </>
  );
}
