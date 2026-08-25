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
import {
  formatarSca,
  rotuloDaEmbalagem,
  rotuloNota,
} from "@/lib/catalogo/rotulos";
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
import { alternativasDeIdioma, href, openGraphDaPagina } from "@/lib/i18n/rotas";
import { LOCALES, comoLocale, type Locale } from "@/lib/i18n/tipos";
import { dicionario } from "@/lib/i18n/dicionario";
import { traduzirLote } from "@/lib/catalogo/produtos";
import { moagemDaReceita } from "@/components/catalogo/receita";

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

/**
 * `dynamicParams` VOLTOU A SER `true`, E A RAZÃO É A TELA DE 404.
 *
 * Com `false`, o Next respondia 404 ANTES de entrar neste segmento: nem o
 * `not-found.tsx` ao lado nem o `notFound()` abaixo eram alcançados, e quem
 * digitava `/en/cafes/slug-errado` recebia a página crua do Next — sem
 * cabeçalho, sem rodapé, sem saída, em inglês inclusive no site em português.
 * A tentativa de consertar isso com uma rede em `app/not-found.tsx` custou
 * caro e foi MEDIDA nesta árvore: um `not-found` de raiz que toca API dinâmica
 * derruba a geração estática do site INTEIRO — de 51 rotas prerenderizadas
 * para 4, e zero HTML em disco, levando junto `/checkout`, `/sacola` e as
 * páginas de conta.
 *
 * Com `true`, o slug inválido entra no segmento, `obterLote` devolve `null`, o
 * `notFound()` abaixo dispara e quem responde é o `not-found.tsx` deste
 * diretório — DENTRO do layout do `[locale]`, ou seja, com a moldura já no
 * idioma certo. Custo: um render de servidor por slug inventado, que termina
 * numa busca em memória e num 404. As 15 PDPs reais continuam saindo do build
 * pelo `generateStaticParams` logo abaixo.
 */
export const dynamicParams = true;

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

/**
 * IDIOMA × SLUG, e o produto cartesiano é montado AQUI, na folha.
 *
 * O App Router aceita duas formas: cada segmento gera os próprios parâmetros,
 * ou a folha gera todos de uma vez. A segunda é a usada porque `dynamicParams`
 * é `false` logo acima — a lista devolvida daqui é literalmente o conjunto de
 * endereços que existem, e é bom que ele caiba num `console.log`. Nenhum
 * segmento acima deste pode declarar `generateStaticParams`, ou as duas formas
 * se atropelam.
 */
export async function generateStaticParams() {
  const slugs = await listarSlugs();
  return LOCALES.flatMap((locale) => slugs.map((slug) => ({ locale, slug })));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string; slug: string }>;
}): Promise<Metadata> {
  const { locale: bruto, slug } = await params;
  const locale = comoLocale(bruto);
  // O METADATA TAMBEM SE TRADUZ, e era ele o pior caso: `title` e
  // `description` sao montados a partir de `lote.descricao` e `lote.notas`, e
  // sem esta linha a PDP em ingles anunciava ao Google um resumo em portugues
  // — a pagina inteira traduzida e o cartao de resultado em outra lingua.
  const d = dicionario(locale);
  const cru = await obterLote(slug);
  if (!cru) return { title: d.pdp.naoEncontrado.metaTitulo };
  const lote = traduzirLote(cru, locale);

  const notas = lote.notas.map((n) => rotuloNota(n, locale)).join(", ");
  // `formatarSca` e nao um template com "+": a meta description do Nectar de
  // Minas anunciava "SCA 75+" ao buscador, que e a mesma mentira da plaqueta.
  // A EMENDA DAS NOTAS TAMBÉM É TRADUZIDA: as notas já vinham no idioma certo
  // (`rotuloNota`) e o "Notas de" à frente delas não, então o cartão de
  // resultado em inglês saía metade em português.
  const descricao = `${lote.descricao} ${d.pdp.notasDe} ${notas.toLowerCase()}. ${formatarSca(lote.sca, lote.scaExata)}, ${lote.origem.regiao}.`;

  return {
    title: `${lote.nome} — Café Canastra`,
    description: descricao,
    // O slug é o MESMO nos três idiomas — a URL do produto não se traduz, só o
    // texto. É o que mantém um link de PDP válido para quem trocar de idioma.
    alternates: alternativasDeIdioma(`/cafes/${slug}`, locale),
    /**
     * A PDP montava este bloco à mão, com uma tabela `OG_LOCALE` local. O
     * comentário dela previa o desfecho — "o dia em que aparecer uma terceira
     * cópia ela tem de subir" — e a terceira apareceu, inline em /bio. Eram
     * três tabelas discordando sobre a mesma língua, e as SEIS rotas que não
     * declaravam bloco nenhum herdavam `pt_BR` do layout raiz.
     * `openGraphDaPagina()` é a fonte única, e ela também traz `siteName`, que
     * este bloco perdia por substituir o da raiz inteiro.
     */
    openGraph: openGraphDaPagina({
      locale,
      caminho: `/cafes/${slug}`,
      titulo: `${lote.nome} — Café Canastra`,
      descricao,
      imagens: [{ url: lote.fotos.pacote.src, alt: lote.fotos.pacote.alt }],
    }),
  };
}

export default async function PaginaLote({
  params,
}: {
  params: Promise<{ locale: string; slug: string }>;
}) {
  const { locale: bruto, slug } = await params;
  const locale = comoLocale(bruto);
  const d = dicionario(locale);
  // Repositorio primeiro (preco e estoque do banco), traducao depois — a
  // mesma ordem da PLP, pelo mesmo motivo.
  const cru = await obterLote(slug);
  if (!cru) notFound();
  const lote = traduzirLote(cru, locale);

  const relacionados = (await lotesRelacionados(lote)).map((l) =>
    traduzirLote(l, locale),
  );
  // SEM REPETIDA. `sabor` e `pacote` sao o MESMO arquivo nas linhas que ainda
  // nao tem foto de estudio (ver `doPacote` em lib/catalogo/produtos.ts), e a
  // galeria empilhava o packshot duas vezes, uma embaixo da outra. Nas tres
  // linhas principais sao duas fotos de verdade e as duas aparecem.
  const galeria = [lote.fotos.sabor, lote.fotos.pacote, lote.fotos.terreiro]
    .filter((f): f is NonNullable<typeof f> => Boolean(f))
    .filter(
      (f, i, todas) => todas.findIndex((o) => o.src === f.src) === i,
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
    locale,
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
            // A trilha do JSON-LD usa os MESMOS endereços dos links visíveis:
            // um breadcrumb que aponta para `/cafes` numa página servida em
            // `/en/cafes/...` manda o crawler para outro idioma.
            breadcrumbJsonLd([
              { nome: d.pdp.inicio, url: href(locale, "/") },
              { nome: d.nav.cafes, url: href(locale, "/cafes") },
              { nome: lote.nome, url: href(locale, `/cafes/${lote.slug}`) },
            ]),
          ),
        }}
      />

      {/* ── Topo: galeria + compra ──────────────────────────── superfície cal */}
      <div className="mx-auto max-w-[1440px] px-4 py-10 md:px-10 md:py-16">
        <nav
          aria-label={d.pdp.trilha}
          className="mb-8 text-[12px] uppercase tracking-[0.14em] text-fuligem-55"
        >
          <Link href={href(locale, "/cafes")} className="hover:text-vermelho">
            {d.nav.cafes}
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

            <SeloSCA
              sca={lote.sca}
              scaExata={lote.scaExata}
              locale={locale}
              className="mt-6 inline-block"
            />

            {/* Nota de sabor em destaque, ACIMA de qualquer dado tecnico. */}
            <p className="mt-6 text-[19px] leading-relaxed">
              {lote.notas.map((n) => rotuloNota(n, locale)).join(" · ")}
            </p>

            <PontoTorra
              valor={lote.pontoTorra}
              locale={locale}
              className="mt-6 max-w-sm"
            />

            <div className="mt-8">
              <PainelCompra lote={lote} locale={locale} />
            </div>

            {/* Drip coffee e cápsula existem na loja mas não têm peso de
                pacote nem moagem a escolher — ficam fora do seletor, listados
                com o estado real de estoque em vez de sumirem da página.

                O rótulo é a ÚNICA coisa que distingue um item do outro nesta
                lista, e ele chegava cru: "Display com 10 sachês" numa página em
                inglês. A tradução acontece AQUI, na hora de desenhar, e não no
                dado: `f.rotuloEmbalagem` continua em português porque é ele que
                vai para a sacola e para o GA4 — ver `rotuloDaEmbalagem()`. */}
            {lote.formatosEspeciais.length ? (
              <section className="mt-10 border-t border-fuligem-20 pt-6">
                <h2 className="text-[12px] font-semibold uppercase tracking-[0.14em] text-fuligem-55">
                  {d.pdp.tambemNestaLinha}
                </h2>
                <ul className="mt-4 grid gap-2">
                  {lote.formatosEspeciais.map((f) => (
                    <li
                      key={f.sku}
                      className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border border-fuligem-20 px-4 py-3"
                    >
                      <span className="text-[14px]">
                        {rotuloDaEmbalagem(f, locale)}
                      </span>
                      <span className="font-dado text-[13px] text-fuligem-55">
                        {f.estoque > 0 && f.preco > 0
                          ? formatarPreco(f.preco)
                          : d.comum.esgotado}
                      </span>
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}

            <div className="mt-10">
              <FichaLavoura lote={lote} locale={locale} />
            </div>
          </div>
        </div>
      </div>

      {/* ── História do lote ────────────────────────────── superfície fuligem */}
      <section className="bg-fuligem py-16 text-cal md:py-24">
        <div className="mx-auto max-w-[1440px] px-4 md:px-10">
          <p className="text-[12px] font-semibold uppercase tracking-[0.18em] text-juta">
            {d.pdp.sobreEstaLinha}
          </p>
          <p className="mt-6 max-w-[62ch] titulo-secao text-[clamp(1.5rem,3vw,2.25rem)] leading-tight">
            {lote.descricao}
          </p>
          {/* Origem única: a mesma serra para toda a coleção. O texto antigo
              afirmava sítio, safra e altitude por lote — nada disso existe num
              blend de origem única, e nada disso vinha de fonte.

              A FRASE É COSTURADA, E SÓ AS EMENDAS SÃO DO DICIONÁRIO: região,
              torra, corpo e preparo sugerido chegam do editorial já no idioma
              da página (data/catalogo-canastra.i18n.json). Guardar a frase
              inteira numa chave obrigaria a repetir o editorial dentro do
              dicionário — dois lugares para o mesmo texto. */}
          {/* AS VARIEDADES SAÍRAM DESTA FRASE, e a ausência é o conserto.
              Ela afirmava "Blend 100% arábica das variedades Araras, Caturra
              2SL e Paraíso" nas CINCO linhas, porque `monta()` copiava a lista
              da marca para cada lote. Araras, Caturra 2SL e Paraíso são o que a
              CASA planta; nem o Microlote (lote separado por definição) nem o
              Néctar de Minas (marca irmã, 75 pontos, pacote próprio) têm
              composição publicada. A afirmação continua em /a-serra, onde ela é
              sobre a lavoura e não sobre o pacote. */}
          <p className="mt-6 max-w-[62ch] text-[17px] leading-relaxed text-cal/80">
            {d.pdp.origemUnicaDa} {lote.origem.regiao}. {lote.torra},{" "}
            {lote.corpo.toLowerCase()}. {d.pdp.rendeMelhorEm}{" "}
            {lote.preparoSugerido.toLowerCase()}.
          </p>
        </div>
      </section>

      {/* ── Como preparar ─────────────────────────────────── superfície kraft */}
      {/* O `id` é o destino do link do PainelCompra: quando o seletor de
          moagem deixou de listar os seis métodos, esta seção passou a ser o
          único lugar da página que responde "e o meu espresso?". */}
      <section id="como-preparar" className="scroll-mt-24 bg-juta-claro py-16 md:py-24">
        <div className="mx-auto max-w-[1440px] px-4 md:px-10">
          <h2 className="titulo-secao text-[clamp(1.75rem,3.5vw,2.75rem)] leading-tight">
            {d.pdp.comoPreparar}
          </h2>

          <div className="mt-10 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {lote.preparo.map((p) => {
              const metodo = d.catalogo.metodo[p.metodo];
              const linhas: [string, string][] = [
                [
                  d.pdp.receita.proporcao,
                  `${p.proporcao} · ${p.gramas} g / ${p.ml} ml`,
                ],
                [d.pdp.receita.temperatura, `${p.temperaturaC} °C`],
                [
                  d.pdp.receita.tempo,
                  `${Math.floor(p.tempoSegundos / 60)} min ${p.tempoSegundos % 60 ? `${p.tempoSegundos % 60} s` : ""}`.trim(),
                ],
                [d.pdp.receita.moagem, moagemDaReceita(p.moagem, d)],
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
              {d.pdp.daMesmaSerra}
            </h2>
            {/* Linhas sem preço (tudo esgotado) não podem entrar no mínimo:
                `precoMinimo` devolve null nesse caso e Math.min viraria NaN. */}
            {(() => {
              const precos = relacionados
                .map(precoMinimo)
                .filter((p): p is number => p !== null);
              return precos.length ? (
                <span className="font-dado text-[13px] text-fuligem-55">
                  {d.comum.aPartirDe} {formatarPreco(Math.min(...precos))}
                </span>
              ) : null;
            })()}
          </div>
          <div className="mt-10 grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-4">
            {relacionados.map((l) => (
              <CardCafe key={l.slug} lote={l} locale={locale} />
            ))}
          </div>
        </div>
      </section>

      {/* ── Avaliações ──────────────────────────── client island, ao vivo.
          A pagina e estatica; a lista busca no PostgREST ao montar (aprovadas
          apenas — RLS de 0014). Erro na busca = a secao nao aparece. */}
      <Avaliacoes skus={skusDaLinha} locale={locale} />
    </>
  );
}
