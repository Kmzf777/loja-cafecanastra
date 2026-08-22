import type { Metadata } from "next";
import Image from "next/image";
import { listarLotes } from "@/lib/catalogo/repositorio";
import { traduzirLote } from "@/lib/catalogo/produtos";
import { MARCA } from "@/lib/catalogo/produtos";
import { PONTO_TORRA } from "@/lib/catalogo/rotulos";
import { Serra } from "@/components/marca/Serra";
import { BotaoLink } from "@/components/ui/Botao";
import { alternativasDeIdioma, href } from "@/lib/i18n/rotas";
import { comoLocale } from "@/lib/i18n/tipos";
import { dicionario } from "@/lib/i18n/dicionario";
import { MARCO_DE_ORIGEM, textosDaSerra } from "./conteudo";

/**
 * A Serra — estetica.md §7.5.
 *
 * Pagina editorial longa, o oposto de uma "About" corporativa. O documento
 * proibe explicitamente: timeline com bolinhas, contadores animados de "anos de
 * historia", icones de folha/xicara/coracao. Nada disso e da Canastra.
 *
 * O TEXTO MORA EM `conteudo.ts`, e o comentario de la explica o que foi
 * corrigido: esta pagina afirmava quarenta anos na mesma serra, e a serra so
 * entrou na historia em 2008.
 *
 * ALTERNANCIA DE SUPERFICIE (§7.1: "nunca duas secoes escuras seguidas"):
 *   heroi fuligem -> origem cal -> torras kraft -> a torra fuligem
 *   -> rastreabilidade cal -> rodape fuligem
 * A faixa final em Cal nao e so um lugar para o link: sem ela a secao escura
 * da torra encostava direto no rodape, que tambem e escuro.
 */

/**
 * `generateMetadata` e não um `metadata` constante porque o canônico precisa
 * ser a PRÓPRIA página, no próprio idioma — ver a nota em lib/i18n/rotas.ts.
 *
 * O título vem SEM "— Café Canastra": o `title.template` de app/layout.tsx já
 * acrescenta a marca, e o valor antigo a trazia embutida, o que rendia
 * "A Serra — Café Canastra — Café Canastra" na aba do navegador.
 */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const locale = comoLocale((await params).locale);
  const t = textosDaSerra(locale);

  return {
    title: t.metaTitulo,
    description: t.metaDescricao,
    alternates: alternativasDeIdioma("/a-serra", locale),
  };
}

export const revalidate = 3600;

export default async function PaginaSerra({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const locale = comoLocale((await params).locale);
  const d = dicionario(locale);
  const t = textosDaSerra(locale);
  // Ordenado da torra mais clara à mais escura. Era "altitude-desc", que
  // ordenava por um número inventado — ver o comentário sobre `Origem` em
  // lib/catalogo/tipos.ts.
  const lotes = (await listarLotes({}, "torra-asc")).map((l) =>
    traduzirLote(l, locale),
  );

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
            {t.heroiRotulo}
          </p>
          <h1 className="mt-6 max-w-[16ch] font-titulo text-[clamp(2.5rem,6vw,4.5rem)] leading-[0.98] tracking-[-0.02em]">
            {t.heroiTitulo}
          </h1>
          <p className="mt-6 max-w-[56ch] text-[18px] leading-relaxed text-cal/80">
            {t.heroiTexto}
          </p>
        </div>
      </section>

      {/* ── A origem, com as duas datas ─────────────────────── superfície cal */}
      <section className="bg-cal py-16 md:py-24">
        <div className="mx-auto grid max-w-[1440px] items-center gap-10 px-4 md:grid-cols-2 md:px-10">
          <div className="min-w-0">
            {/* As duas datas em Martian Mono: são número, que é exatamente o
                que o §4.2 reserva para a monoespaçada. Elas contam a correção
                antes de o parágrafo começar. */}
            <p className="font-dado text-[13px] tracking-[0.08em] text-barro">
              {MARCO_DE_ORIGEM}
            </p>
            <h2 className="mt-4 titulo-secao text-[clamp(1.75rem,3.5vw,2.75rem)] leading-tight">
              {t.origemTitulo}
            </h2>
            <p className="mt-5 max-w-[62ch] text-[17px] leading-relaxed text-fuligem-80">
              {t.origemP1}
            </p>
            <p className="mt-4 max-w-[62ch] text-[17px] leading-relaxed text-fuligem-80">
              {t.origemP2}
            </p>
            <p className="mt-6">
              <BotaoLink href={href(locale, "/historia")} variante="texto">
                {t.origemLink}
              </BotaoLink>
            </p>
          </div>
          {/* min-w-0: item de grid tem `min-width: auto` por padrao, entao a
              largura intrinseca da imagem (1448px) empurra a coluna e estoura
              o documento em mobile. */}
          <div className="min-w-0">
            <Image
              src="/nossa-historia.png"
              alt={t.imagemAlt}
              width={1448}
              height={1448}
              sizes="(min-width: 768px) 50vw, 100vw"
              className="h-auto w-full border border-fuligem-20"
            />
          </div>
        </div>
      </section>

      {/* ── Território / torras ──────────────────────────── superfície kraft */}
      <section className="bg-juta-claro py-16 md:py-24">
        <div className="mx-auto max-w-[1440px] px-4 md:px-10">
          {/* Este bloco desenhava um eixo de ALTITUDE por lote (estetica.md §6).
              O próprio §6 condiciona esse eixo a haver dado real de altitude por
              lote — "senão o eixo vira ficção e a marca perde credibilidade" — e
              prescreve o Plano B: mesma serra, mesmo mecanismo, eixo de Ponto de
              Torra. Como o Canastra vende linhas de origem única, e não lotes de
              altitudes distintas, é o Plano B que vale. */}
          <h2 className="titulo-secao text-[clamp(1.75rem,3.5vw,2.75rem)] leading-tight">
            {t.torraTitulo}
          </h2>
          <p className="mt-5 max-w-[62ch] text-[17px] leading-relaxed text-fuligem-80">
            {t.torraTexto}
          </p>

          {/* As variedades vêm do catálogo, e não da tabela de tradução: nome
              de cultivar é nome próprio, igual nos três idiomas, e
              `marca.variedades` é a mesma fonte que alimenta o seed do banco.
              Uma segunda cópia aqui poderia desmentir a primeira. */}
          <div className="mt-8 flex flex-col gap-2 border-t border-fuligem/25 pt-4 sm:flex-row sm:items-baseline sm:gap-6">
            <h3 className="text-[12px] font-semibold uppercase tracking-[0.18em] text-barro">
              {t.variedadesRotulo}
            </h3>
            <ul className="flex flex-wrap items-baseline gap-x-3 gap-y-1 text-[16px] font-semibold">
              {MARCA.variedades.map((variedade, i) => (
                <li key={variedade} className="flex items-baseline gap-3">
                  {i > 0 ? (
                    <span aria-hidden className="text-fuligem-55">
                      ·
                    </span>
                  ) : null}
                  {variedade}
                </li>
              ))}
            </ul>
          </div>

          <div className="relative mt-12">
            <Serra
              aria-hidden
              className="h-24 w-full text-fuligem/30 md:h-32"
              strokeWidth={1.5}
            />
            {/* Lista acessivel com o mesmo conteudo do desenho (§6). */}
            <ol className="mt-6 grid gap-px border border-fuligem/20 bg-fuligem/20 sm:grid-cols-2 lg:grid-cols-3">
              {lotes.map((l) => (
                <li key={l.slug} className="bg-juta-claro p-4">
                  <span className="font-dado text-[15px] tracking-[0.04em]">
                    {l.pontoTorra} {t.pontoDeCinco}
                  </span>
                  <p className="mt-1 text-[15px] font-semibold">{l.nome}</p>
                  <p className="text-[13px] text-fuligem-80">
                    {PONTO_TORRA[l.pontoTorra]} · {l.corpo}
                  </p>
                </li>
              ))}
            </ol>
          </div>
        </div>
      </section>

      {/* ── A torra ─────────────────────────────────────── superfície fuligem */}
      {/* id: o rodapé aponta para cá. Âncora que não existe rola a página para
          o topo em silêncio, e ninguém percebe que o link está quebrado. */}
      <section id="torra" className="bg-fuligem py-16 text-cal md:py-24">
        <div className="mx-auto max-w-[1440px] px-4 md:px-10">
          <p className="text-[12px] font-semibold uppercase tracking-[0.18em] text-juta">
            {t.aTorraRotulo}
          </p>
          <h2 className="mt-5 max-w-[20ch] titulo-secao text-[clamp(1.75rem,3.5vw,2.75rem)] leading-tight">
            {t.aTorraTitulo}
          </h2>
          <p className="mt-5 max-w-[62ch] text-[17px] leading-relaxed text-cal/80">
            {t.aTorraTexto}
          </p>
          <div className="mt-10">
            <BotaoLink href={href(locale, "/cafes")} variante="primarioEscuro">
              {d.comum.verOsCafes}
            </BotaoLink>
          </div>
        </div>
      </section>

      {/* ── Conferir a origem ───────────────────────────────── superfície cal */}
      {/* Faixa curta, não seção: a página fecha na torra, e este é o rodapé
          editorial dela. O destino é interno de propósito — quem explica que a
          base é de terceiros e que o clique sai do site é a /rastreabilidade,
          não um link cru para fora daqui. */}
      <section className="border-t border-fuligem-20 bg-cal py-10 md:py-12">
        <div className="mx-auto flex max-w-[1440px] flex-col gap-5 px-4 md:flex-row md:items-center md:justify-between md:gap-10 md:px-10">
          <div className="min-w-0">
            <h2 className="text-[19px] font-semibold leading-tight md:text-[21px]">
              {t.rastreioTitulo}
            </h2>
            <p className="mt-1.5 max-w-[56ch] text-[15px] leading-relaxed text-fuligem-80">
              {t.rastreioTexto}
            </p>
          </div>
          <BotaoLink
            href={href(locale, "/rastreabilidade")}
            variante="secundario"
            className="self-start md:shrink-0 md:self-auto"
          >
            {t.rastreioLink}
          </BotaoLink>
        </div>
      </section>
    </>
  );
}
