import type { Metadata } from "next";
import { Serra } from "@/components/marca/Serra";
import { BotaoLink } from "@/components/ui/Botao";
import { alternativasDeIdioma, href, openGraphDaPagina } from "@/lib/i18n/rotas";
import { LOCALES, comoLocale } from "@/lib/i18n/tipos";
import {
  HOSPEDEIRO_DA_BASE,
  REGISTRO_DO_PRODUTOR,
  URL_DA_BASE,
  textosDaRastreabilidade,
} from "./conteudo";

/**
 * /rastreabilidade — uma página curta que é, honestamente, um link.
 *
 * O institucional tinha aqui um `redirect()` seco para a base do Cerrado
 * Mineiro. O `conteudo.ts` ao lado explica por que ele não foi copiado e por
 * que também não bastava apontar o rodapé direto para fora.
 *
 * SUPERFÍCIES: cabeçalho fuligem -> corpo cal -> rodapé fuligem. Duas escuras
 * seguidas é o que o §7.1 proíbe, e é por isso que o corpo é claro mesmo sendo
 * curto.
 *
 * MOBILE PRIMEIRO: uma coluna, medida de leitura de 62ch, e o bloco de link com
 * alvo de toque grande. O `active:` repete o `hover:` porque telefone não tem
 * hover — sem ele, tocar no único elemento clicável da página não dá retorno
 * nenhum.
 */

/**
 * As três versões saem prontas do build. A página é constante — o destino, o
 * registro e os textos vêm de `conteudo.ts`, e não há leitura de rede nenhuma
 * —, então sem esta função o `[locale]` a fazia renderizar de novo a cada
 * visita para devolver sempre o mesmo HTML. Sem dado que envelhece, também não
 * precisa de `revalidate`. A explicação longa está na home
 * ((vitrine)/page.tsx).
 */
export function generateStaticParams() {
  return LOCALES.map((locale) => ({ locale }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const locale = comoLocale((await params).locale);
  const t = textosDaRastreabilidade(locale);

  return {
    title: t.metaTitulo,
    description: t.metaDescricao,
    alternates: alternativasDeIdioma("/rastreabilidade", locale),
    openGraph: openGraphDaPagina({
      locale,
      caminho: "/rastreabilidade",
      titulo: t.metaTitulo,
      descricao: t.metaDescricao,
    }),
  };
}

export default async function PaginaRastreabilidade({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const locale = comoLocale((await params).locale);
  const t = textosDaRastreabilidade(locale);

  return (
    <>
      {/* ── Cabeçalho ───────────────────────────────────── superfície fuligem */}
      <section className="relative overflow-hidden bg-fuligem py-14 text-cal md:py-20">
        <Serra
          aria-hidden
          className="absolute inset-x-0 bottom-0 h-16 w-full text-fuligem-80 md:h-24"
          strokeWidth={1.5}
          preenchido
        />
        <div className="relative mx-auto max-w-[1440px] px-4 md:px-10">
          <p className="text-[12px] font-semibold uppercase tracking-[0.18em] text-juta">
            {t.rotulo}
          </p>
          {/* O PISO É 2,5rem, E ISSO NÃO É AJUSTE DE GOSTO. A Redaction 35
              (`font-titulo`) só pode aparecer a partir de 40px — o §4.2 é
              categórico, e a razão é que a degradação de impressão simulada
              dela vira sujeira em corpo pequeno. O piso anterior era 2,25rem =
              36px, e como o termo do meio (5vw) só passa de 40px a partir de
              800px de viewport, TODO telefone via a serifada quebrada. 2,5rem
              é o mesmo piso do herói de /a-serra e da /historia, e o título
              mais longo dos três idiomas — "Rastreabilidade", 15 caracteres —
              ainda cabe na linha em 360px. */}
          <h1 className="mt-5 font-titulo text-[clamp(2.5rem,5vw,3.75rem)] leading-none tracking-[-0.015em]">
            {t.titulo}
          </h1>
          <p className="mt-6 max-w-[58ch] text-[17px] leading-relaxed text-cal/80">
            {t.lead}
          </p>
        </div>
      </section>

      {/* ── O que é, o aviso e o link ────────────────────────── superfície cal */}
      <section className="bg-cal py-12 md:py-20">
        <div className="mx-auto max-w-[1440px] px-4 md:px-10">
          <div className="max-w-[62ch]">
            <h2 className="text-[13px] font-semibold uppercase tracking-[0.14em] text-fuligem">
              {t.oQueETitulo}
            </h2>
            <p className="mt-4 text-[17px] leading-relaxed text-fuligem-80">
              {t.oQueETexto}
            </p>

            {/* O aviso vem ANTES do link, e não como legenda embaixo: quem lê de
                cima para baixo precisa saber que sai do site antes de chegar ao
                alvo de toque. Mesma moldura do <AvisoJuridico>. */}
            <div className="mt-10 border border-alerta/40 bg-alerta/5 p-4">
              <p className="text-[15px] font-semibold text-fuligem">
                {t.avisoTitulo}
              </p>
              <p className="mt-1.5 text-[15px] leading-relaxed text-fuligem-80">
                {t.avisoTexto}
              </p>
            </div>

            {/* `noopener noreferrer`: sem ele a página aberta recebe
                `window.opener` e pode reescrever esta aba. O leitor de tela
                ganha, no `sr-only`, o aviso que o vidente lê no domínio. */}
            <a
              href={URL_DA_BASE}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-4 flex flex-col gap-4 border border-fuligem-20 bg-cal-puro p-5 transition-[box-shadow,border-color,transform] duration-[320ms] ease-canastra hover:-translate-x-1 hover:-translate-y-1 hover:border-vermelho hover:shadow-[4px_4px_0_var(--color-fuligem)] focus-visible:outline-2 focus-visible:outline-offset-[3px] focus-visible:outline-vermelho active:-translate-x-1 active:-translate-y-1 active:shadow-[4px_4px_0_var(--color-fuligem)]"
            >
              <span className="flex items-center justify-between gap-4">
                {/* Domínio em Martian Mono: é código, não frase (§4.2). */}
                <span className="min-w-0 break-all font-dado text-[12px] tracking-[0.04em] text-fuligem-55">
                  {HOSPEDEIRO_DA_BASE}
                </span>
                <SetaParaFora />
              </span>

              <span className="text-[19px] font-semibold leading-tight md:text-[21px]">
                {t.botao}
                <span className="sr-only"> ({t.abreEmOutraAba})</span>
              </span>

              <span className="flex items-baseline gap-2 border-t border-fuligem-20 pt-4">
                <span className="text-[11px] uppercase tracking-[0.14em] text-fuligem-55">
                  {t.registroRotulo}
                </span>
                <span className="font-dado text-[15px] tracking-[0.04em]">
                  {REGISTRO_DO_PRODUTOR}
                </span>
              </span>
            </a>

            {/* `min-h-[44px]`: a variante `texto` é a única do <BotaoLink> sem
                a altura `h-12`, e com o `leading-none` do BASE o alvo de toque
                fecharia em ~13px — o §10 pede 44. Numa página cujo corpo é um
                link e mais nada, errar o segundo alvo é errar a página. O
                conserto definitivo é em components/ui/Botao.tsx, que não é
                desta tarefa. */}
            <p className="mt-10">
              <BotaoLink
                href={href(locale, "/a-serra")}
                variante="texto"
                className="min-h-[44px]"
              >
                {t.voltarLink}
              </BotaoLink>
            </p>
          </div>
        </div>
      </section>
    </>
  );
}

/**
 * Seta saindo de uma moldura — o pictograma de "link externo".
 *
 * SVG inline, traço de 1,25px, sem biblioteca de ícone: o repositório não tem
 * uma para a vitrine e não vai ganhar uma por causa de um glifo (§5.5 descreve
 * os pictogramas exatamente assim).
 */
function SetaParaFora() {
  return (
    <svg
      aria-hidden
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.25}
      className="size-4 shrink-0 text-fuligem-55"
    >
      <path d="M12.5 9V13H3V3.5h4" />
      <path d="M9.5 2.5h4v4" />
      <path d="M13.5 2.5 7.5 8.5" />
    </svg>
  );
}
