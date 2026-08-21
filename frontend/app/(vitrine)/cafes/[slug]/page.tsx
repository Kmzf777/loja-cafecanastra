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
import { rotuloNota } from "@/lib/catalogo/rotulos";
import {
  breadcrumbJsonLd,
  productJsonLd,
  serializarJsonLd,
} from "@/lib/seo/jsonld";
import { SeloSCA } from "@/components/catalogo/SeloSCA";
import { PontoTorra } from "@/components/catalogo/PontoTorra";
import { FichaLavoura } from "@/components/catalogo/FichaLavoura";
import { PainelCompra } from "@/components/catalogo/PainelCompra";
import { CardCafe } from "@/components/catalogo/CardCafe";
import { Avaliacoes } from "@/components/catalogo/Avaliacoes";
import { agregadoAprovadas } from "@/lib/avaliacoes/servidor";

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

/**
 * A PDP era estática SEM revalidação — correto enquanto tudo nela vinha do
 * build (o comercial já tinha o cache de 60 s do repositório por baixo). O
 * `aggregateRating` do JSON-LD mudou isso: avaliação aprovada é dado que nasce
 * DEPOIS do build, e sem revalidate o rating congelaria até o próximo deploy.
 * Uma hora casa com o `REVALIDAR_SEGUNDOS` do fetch em `lib/avaliacoes/
 * servidor.ts` — os dois expiram juntos. A LISTA visível de avaliações não
 * depende disto: é client island e busca ao vivo.
 */
export const revalidate = 3600;

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
  const descricao = `${lote.descricao} Notas de ${notas.toLowerCase()}. SCA ${Math.floor(lote.sca)}+, ${lote.origem.regiao}.`;

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

  // Uma LINHA da vitrine agrupa varios SKUs do banco (um por peso/pacote, e a
  // avaliacao e gravada no SKU exato que a pessoa recebeu) — a busca e sempre
  // pela lista inteira da linha.
  const skusDaLinha = [
    ...new Set(
      [...lote.variantes, ...lote.formatosEspeciais].map((v) => v.skuLoja),
    ),
  ];

  // Busca de SERVIDOR, anonima, com revalidate de 1h (ver o comentario do
  // `export const revalidate`): sem avaliacao aprovada — ou com o PostgREST
  // fora no build — volta `null` e o Product sai sem aggregateRating.
  const agregadoDeAvaliacoes = await agregadoAprovadas(skusDaLinha);

  // `null` quando NENHUMA variante tem preco (a Canela esgotada da captura):
  // Product sem oferta e erro de elegibilidade no Search Console, entao a
  // pagina fica so com o Breadcrumb ate a linha voltar a ter preco.
  const productLd = productJsonLd(
    lote,
    lote.variantes,
    undefined,
    agregadoDeAvaliacoes,
  );

  return (
    <>
      {/* JSON-LD de Product + Breadcrumb — e por isto que a PDP e estatica:
          o crawler recebe oferta, preco e disponibilidade sem executar JS.
          O preco/estoque aqui e o do build (ou do cache de 60 s do
          repositorio); quem cobra continua sendo o checkout, no servidor. */}
      {productLd ? (
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            __html: serializarJsonLd(productLd),
          }}
        />
      ) : null}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: serializarJsonLd(
            breadcrumbJsonLd([
              { nome: "Início", url: "/" },
              { nome: "Cafés", url: "/cafes" },
              { nome: lote.nome, url: `/cafes/${lote.slug}` },
            ]),
          ),
        }}
      />

      {/* ── Topo: galeria + compra ──────────────────────────── superfície cal */}
      <div className="mx-auto max-w-[1440px] px-4 py-10 md:px-10 md:py-16">
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
              {lote.origem.regiao}
            </p>

            <h1 className="mt-3 font-titulo text-[clamp(2.5rem,5vw,3.75rem)] leading-[1] tracking-[-0.015em]">
              {lote.nome}
            </h1>

            {/* Antes esta linha trazia produtor e safra, ambos inventados por
                lote. Torra e corpo são o que a marca de fato declara sobre
                cada linha — e são o que diferencia uma da outra. */}
            <p className="mt-2 text-[15px] text-fuligem-55">
              {lote.torra}
              <span aria-hidden> · </span>
              {lote.corpo}
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

            {/* Drip coffee e cápsula existem na loja mas não têm peso de
                pacote nem moagem a escolher — ficam fora do seletor, listados
                com o estado real de estoque em vez de sumirem da página. */}
            {lote.formatosEspeciais.length ? (
              <section className="mt-10 border-t border-fuligem-20 pt-6">
                <h2 className="text-[12px] font-semibold uppercase tracking-[0.14em] text-fuligem-55">
                  Também nesta linha
                </h2>
                <ul className="mt-4 grid gap-2">
                  {lote.formatosEspeciais.map((f) => (
                    <li
                      key={f.sku}
                      className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border border-fuligem-20 px-4 py-3"
                    >
                      <span className="text-[14px]">{f.rotuloEmbalagem}</span>
                      <span className="font-dado text-[13px] text-fuligem-55">
                        {f.estoque > 0 && f.preco > 0
                          ? formatarPreco(f.preco)
                          : "Esgotado"}
                      </span>
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}

            <div className="mt-10">
              <FichaLavoura lote={lote} />
            </div>
          </div>
        </div>
      </div>

      {/* ── História do lote ────────────────────────────── superfície fuligem */}
      <section className="bg-fuligem py-16 text-cal md:py-24">
        <div className="mx-auto max-w-[1440px] px-4 md:px-10">
          <p className="text-[12px] font-semibold uppercase tracking-[0.18em] text-juta">
            Sobre esta linha
          </p>
          <p className="mt-6 max-w-[62ch] titulo-secao text-[clamp(1.5rem,3vw,2.25rem)] leading-tight">
            {lote.descricao}
          </p>
          {/* Origem única: a mesma serra para toda a coleção. O texto antigo
              afirmava sítio, safra e altitude por lote — nada disso existe num
              blend de origem única, e nada disso vinha de fonte. */}
          <p className="mt-6 max-w-[62ch] text-[17px] leading-relaxed text-cal/80">
            Origem única da {lote.origem.regiao}. Blend 100% arábica das
            variedades {lote.origem.variedades.join(", ")}. {lote.torra},{" "}
            {lote.corpo.toLowerCase()}. Rende melhor em{" "}
            {lote.preparoSugerido.toLowerCase()}.
          </p>
        </div>
      </section>

      {/* ── Como preparar ─────────────────────────────────── superfície kraft */}
      <section className="bg-juta-claro py-16 md:py-24">
        <div className="mx-auto max-w-[1440px] px-4 md:px-10">
          <h2 className="titulo-secao text-[clamp(1.75rem,3.5vw,2.75rem)] leading-tight">
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
        <div className="mx-auto max-w-[1440px] px-4 md:px-10">
          <div className="flex flex-wrap items-baseline justify-between gap-4">
            <h2 className="titulo-secao text-[clamp(1.75rem,3.5vw,2.75rem)] leading-tight">
              Da mesma serra
            </h2>
            {/* Linhas sem preço (tudo esgotado) não podem entrar no mínimo:
                `precoMinimo` devolve null nesse caso e Math.min viraria NaN. */}
            {(() => {
              const precos = relacionados
                .map(precoMinimo)
                .filter((p): p is number => p !== null);
              return precos.length ? (
                <span className="font-dado text-[13px] text-fuligem-55">
                  a partir de {formatarPreco(Math.min(...precos))}
                </span>
              ) : null;
            })()}
          </div>
          <div className="mt-10 grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-4">
            {relacionados.map((l) => (
              <CardCafe key={l.slug} lote={l} />
            ))}
          </div>
        </div>
      </section>

      {/* ── Avaliações ──────────────────────────── client island, ao vivo.
          A pagina e estatica; a lista busca no PostgREST ao montar (aprovadas
          apenas — RLS de 0014). Erro na busca = a secao nao aparece. */}
      <Avaliacoes skus={skusDaLinha} />
    </>
  );
}
