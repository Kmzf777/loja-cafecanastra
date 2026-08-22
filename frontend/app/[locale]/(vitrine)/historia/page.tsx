import type { Metadata } from "next";
import { Serra } from "@/components/marca/Serra";
import { BotaoLink } from "@/components/ui/Botao";
import { alternativasDeIdioma, href } from "@/lib/i18n/rotas";
import { LOCALES, comoLocale, type Locale } from "@/lib/i18n/tipos";
import { dicionario } from "@/lib/i18n/dicionario";
import { HISTORIA } from "./conteudo";

/**
 * História — a linha do tempo da família Boaventura, 1985 → hoje.
 *
 * A FORMA, E POR QUE ELA NÃO É UMA TIMELINE COM BOLINHAS. O estetica.md §7.5
 * proíbe isso com todas as letras ("Não usar: timeline com bolinhas,
 * contadores animados de anos de história"), e o motivo é prático além de
 * estético: um trilho vertical com marcadores é um desenho de desktop que, em
 * 360 px, vira uma coluna de 24 px de enfeite comendo a medida de leitura.
 *
 * Aqui a linha do tempo é feita de duas coisas que o telefone já tem de graça:
 *
 *   1. O ALTERNAR DE SUPERFÍCIE. Cada tempo tem o seu papel — cal, kraft, cal,
 *      kraft, mata. Descer a página é atravessar papéis diferentes, e é isso
 *      que se sente como passagem de tempo. §7.1: "alternância obrigatória de
 *      superfície para dar ritmo", "nunca duas seções escuras seguidas".
 *   2. O ANO CARIMBADO. Grande, em Martian Mono, sobre um filete que abre o
 *      registro. Em telefone ele encabeça o bloco; a partir de `md` migra para
 *      uma calha à esquerda e fica GRUDADO (`sticky`) enquanto se lê o
 *      capítulo — o alinhamento dos cinco anos numa coluna só é a espinha da
 *      linha do tempo, sem um pixel de trilho desenhado.
 *
 * SEM FOTO, E ISSO É DECISÃO. O único ativo de arquivo em `public/` é
 * `nossa-historia.png`, que já carrega o bloco de 1985 da home E o de
 * `/a-serra`. Uma terceira aparição transformaria a única foto do site em
 * papel de parede. O estetica.md §8 diz que a fotografia responde por ~60% da
 * percepção de qualidade e é o caminho crítico do projeto; até ela existir,
 * esta página roda tipográfica — que é, aliás, o que a fonte também é.
 *
 * O TEXTO NOS TRÊS IDIOMAS mora em `./conteudo.ts`, já traduzido a partir do
 * site institucional. Esta página não tem string em português cravada.
 */

/**
 * `og:locale` exige `idioma_TERRITÓRIO`, então não dá para reaproveitar o
 * `TAG_BCP47` de lib/i18n/tipos.ts, que devolve `en` e `es` secos. O território
 * aqui é convenção de crawler, não afirmação sobre o público: quem lê em
 * espanhol é sobretudo Chile e Argentina, mas `es_ES` é o valor que o Facebook
 * documenta como padrão da língua.
 */
const OG_LOCALE: Record<Locale, string> = {
  pt: "pt_BR",
  en: "en_US",
  es: "es_ES",
};

/**
 * As três versões saem prontas do build — e esta é a página que mais tinha a
 * perder sem isso: todo o conteúdo dela é constante de `conteudo.ts`, sem uma
 * única leitura de rede, e mesmo assim o segmento `[locale]` sem
 * `generateStaticParams` a fazia renderizar de novo a cada visita. Por não ter
 * dado que envelhece, ela também não precisa de `revalidate`: o HTML gerado no
 * build vale até o próximo deploy. A explicação longa está na home
 * ((vitrine)/page.tsx).
 */
export function generateStaticParams() {
  return LOCALES.map((locale) => ({ locale }));
}

/**
 * `generateMetadata` e não um `metadata` constante porque o canônico precisa
 * ser a PRÓPRIA página, no próprio idioma — ver a nota em lib/i18n/rotas.ts.
 */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const locale = comoLocale((await params).locale);
  const { meta } = HISTORIA[locale];

  return {
    title: meta.titulo,
    description: meta.descricao,
    alternates: alternativasDeIdioma("/historia", locale),
    openGraph: {
      title: meta.titulo,
      description: meta.descricao,
      type: "article",
      locale: OG_LOCALE[locale],
      // A imagem é REDECLARADA porque o Next SUBSTITUI o bloco `openGraph` do
      // layout raiz em vez de fundir campo a campo: sem esta linha, o card
      // compartilhado desta página sairia sem imagem nenhuma. É o mesmo banner
      // do layout (1280x720) e não o `nossa-historia.png`, que tem 3,7 MB e
      // demoraria mais para o crawler buscar do que a página inteira.
      images: [
        {
          url: "/imagem-banner.jpg",
          width: 1280,
          height: 720,
          alt: "Café Canastra — Serra da Canastra, Minas Gerais",
        },
      ],
    },
  };
}

/** O papel de cada registro. A ordem de uso está no comentário do topo. */
type Tom = "cal" | "kraft" | "mata";

/**
 * As classes de cada superfície, resolvidas num mapa e não com template
 * string: o Tailwind v4 varre o código-fonte em busca de nomes de classe
 * LITERAIS, e `bg-${tom}` não gera CSS nenhum — o bug se manifesta como seção
 * transparente, sem erro de build.
 */
const TONS: Record<
  Tom,
  { secao: string; filete: string; ano: string; titulo: string; corpo: string }
> = {
  cal: {
    secao: "bg-cal",
    filete: "border-fuligem/20",
    ano: "text-barro",
    titulo: "",
    corpo: "text-fuligem-80",
  },
  kraft: {
    secao: "bg-juta-claro",
    filete: "border-fuligem/25",
    ano: "text-barro",
    titulo: "",
    corpo: "text-fuligem-80",
  },
  // §4.1: sobre mata, vermelho é 2,0:1 — proibido. O ano vai em juta (5,4:1) e
  // o corpo em cal.
  mata: {
    secao: "bg-mata text-cal",
    filete: "border-cal/25",
    ano: "text-juta",
    titulo: "text-cal",
    corpo: "text-cal/85",
  },
};

/** Cal → kraft → cal → kraft → mata, na ordem dos cinco tempos. */
const TOM_DO_REGISTRO: Tom[] = ["cal", "kraft", "cal", "kraft", "mata"];

export default async function PaginaHistoria({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const locale = comoLocale((await params).locale);
  const d = dicionario(locale);
  const c = HISTORIA[locale];

  return (
    <>
      {/* ── HERÓI ────────────────────────────────────────── superfície fuligem */}
      <section className="relative flex min-h-[62vh] flex-col justify-end overflow-hidden bg-fuligem text-cal">
        {/* O único divisor de pincelada da página — §4.4 permite um, e só um. */}
        <Serra
          aria-hidden
          className="absolute inset-x-0 bottom-0 h-[20vh] max-h-[200px] w-full text-fuligem-80"
          strokeWidth={1.5}
          preenchido
        />
        <div className="relative mx-auto w-full max-w-[1440px] px-4 pb-14 pt-28 md:px-10 md:pb-20 md:pt-36">
          <p className="text-[12px] font-semibold uppercase tracking-[0.18em] text-juta">
            {c.rotulo}
          </p>
          {/* Redaction direta, sem `.titulo-secao`: o piso do clamp é 2,5rem =
              40px, exatamente o mínimo que o §4.2 exige da fonte. */}
          <h1 className="mt-6 max-w-[15ch] font-titulo text-[clamp(2.5rem,6vw,4.5rem)] leading-[0.98] tracking-[-0.02em]">
            {c.titulo}
          </h1>
          {/* Epígrafe em itálico e SEM aspas: cada idioma pontua citação de um
              jeito (« » em espanhol, “ ” aqui) e o itálico diz a mesma coisa
              nos três sem virar decisão tipográfica por locale. */}
          <p className="mt-6 max-w-[44ch] text-[18px] italic leading-relaxed text-cal/80">
            {c.epigrafe}
          </p>
        </div>
      </section>

      {/* ── ÍNDICE DOS ANOS ──────────────────────────────── superfície kraft */}
      {/* Uma faixa de kraft logo abaixo do herói, como a tarja de rótulo do
          pacote. Não é enfeite: a página tem cinco capítulos longos, e em
          telefone rolar até 2008 sem um atalho é trabalho. */}
      <nav
        aria-label={c.indice}
        className="border-y border-fuligem/15 bg-juta-claro"
      >
        <ul className="mx-auto flex max-w-[1440px] flex-wrap items-center gap-x-4 px-4 md:px-10">
          {c.registros.map((registro, i) => (
            <li
              key={registro.ancora}
              className={
                i > 0 ? "border-l border-fuligem/25 pl-4" : undefined
              }
            >
              <a
                href={`#${registro.ancora}`}
                // min-h de 44px é o alvo de toque do §10, e o `py` sozinho não
                // garante isso num texto de 13px.
                className="inline-flex min-h-[44px] items-center font-dado text-[13px] tracking-[0.06em] text-fuligem-80 underline decoration-transparent underline-offset-4 transition-colors hover:text-fuligem hover:decoration-current focus-visible:outline-2 focus-visible:outline-offset-[3px] focus-visible:outline-vermelho"
              >
                {registro.rotuloDoAno}
              </a>
            </li>
          ))}
        </ul>
      </nav>

      {/* ── OS CINCO TEMPOS ───────────────── cal · kraft · cal · kraft · mata */}
      {c.registros.map((registro, i) => {
        const tom = TONS[TOM_DO_REGISTRO[i]];
        const ehUltimo = i === c.registros.length - 1;

        return (
          <section
            key={registro.ancora}
            id={registro.ancora}
            aria-labelledby={`${registro.ancora}-titulo`}
            // O CABEÇALHO GRUDENTO, MEDIDO — sem `scroll-mt`, clicar num ano
            // do índice para com o registro atrás da barra.
            //
            // O CORTE É `xl`, NÃO `md`. Esta página foi escrita quando a barra
            // crescia em 768px; depois dela, a costura moveu a barra alta para
            // 1280px (components/layout/Cabecalho.tsx explica por quê: em
            // inglês a navegação só cabe a partir de 1.185px). O desconto
            // ficou para trás — entre 768px e 1279px ele reservava 92px para
            // uma barra que voltou a medir 72, e a rolagem parava com um vão
            // de 13px onde o desenho pede o registro encostado.
            //
            // E OS NÚMEROS CERTOS SÃO 79 E 99, não 72 e 92: o que cobre o
            // registro é o bloco grudento INTEIRO — a linha da barra (72px,
            // `xl:92px`) mais a serra de 6px que a fecha mais o filete de 1px.
            // Com 72, em telefone, o topo da seção parava 7px atrás da barra.
            className={`scroll-mt-[79px] py-12 md:py-20 xl:scroll-mt-[99px] ${tom.secao}`}
          >
            <div className="mx-auto max-w-[1440px] px-4 md:px-10">
              <div
                className={`border-t pt-6 md:grid md:grid-cols-[9rem_1fr] md:gap-x-10 md:pt-8 ${tom.filete}`}
              >
                {/*
                  O ano é dado, e dado vai em Martian Mono (§4.2). "Hoje" não é
                  número, mas ocupa a mesma casa da coluna: trocar de fonte só
                  na última linha quebraria justamente a espinha que alinha os
                  cinco.

                  `md:sticky` é o que faz a coluna virar linha do tempo — o ano
                  acompanha a leitura do próprio capítulo e sai de cena quando
                  o próximo empurra.

                  O `top` acompanha o mesmo corte do `scroll-mt` acima, pela
                  mesma medição: 79px de cabeçalho até `xl`, 99px a partir
                  dele, mais 16px de folga. O valor único de 108px vinha de
                  quando a barra alta começava em 768px, e deixava o ano
                  boiando 29px abaixo da barra em todo o intervalo de tablet.
                */}
                <p
                  className={`font-dado text-[2rem] leading-none tracking-[-0.02em] md:sticky md:top-[95px] md:self-start md:text-[2.75rem] xl:top-[115px] ${tom.ano}`}
                >
                  {registro.rotuloDoAno}
                </p>

                <div className="mt-5 min-w-0 md:mt-0">
                  <h2
                    id={`${registro.ancora}-titulo`}
                    className={`titulo-secao text-[clamp(1.5rem,3vw,2.25rem)] leading-tight ${tom.titulo}`}
                  >
                    {registro.titulo}
                  </h2>

                  {/* 62ch é a medida de leitura do §4.2. Nunca full-width. */}
                  <div className="mt-5 max-w-[62ch] space-y-4">
                    {registro.paragrafos.map((paragrafo) => (
                      <p
                        key={paragrafo.slice(0, 40)}
                        className={`text-[17px] leading-relaxed ${tom.corpo}`}
                      >
                        {paragrafo}
                      </p>
                    ))}
                  </div>

                  {/* A exportação pertence ao último tempo — é o que "hoje"
                      quer dizer — e por isso mora dentro dele, não numa seção
                      própria que abriria uma sexta superfície escura. */}
                  {ehUltimo ? (
                    <div className="mt-10">
                      <h3 className="text-[12px] font-semibold uppercase tracking-[0.18em] text-juta">
                        {c.exportacao.rotulo}
                      </h3>
                      {/* Grade de filetes por `gap-px` sobre fundo claro: dois
                          por linha em 360px, três a partir de `sm`. Caixa alta
                          em Archivo, NÃO em Martian Mono — o §4.2 restringe a
                          mono a "números e códigos, nunca frase", e nome de
                          país não é nenhum dos dois. O que dá o ar de etiqueta
                          é o tracking do rótulo, que é o mesmo do selo da
                          embalagem. */}
                      <ul className="mt-4 grid grid-cols-2 gap-px bg-cal/25 sm:grid-cols-3">
                        {c.exportacao.destinos.map((destino) => (
                          <li
                            key={destino}
                            className="bg-mata px-3 py-4 text-[12px] font-semibold uppercase leading-snug tracking-[0.12em] text-cal"
                          >
                            {destino}
                          </li>
                        ))}
                      </ul>
                      <p className="mt-3 text-[13px] text-cal/60">
                        {c.exportacao.nota}
                      </p>
                    </div>
                  ) : null}
                </div>
              </div>
            </div>
          </section>
        );
      })}

      {/* ── FECHO ────────────────────────────────────────────── superfície cal */}
      {/* Volta ao claro depois do mata: §7.1 proíbe duas seções escuras
          coladas, e o fecho é onde o leitor precisa enxergar o botão. */}
      <section className="bg-cal py-16 md:py-24">
        <div className="mx-auto max-w-[1440px] px-4 md:px-10">
          {/* `.titulo-secao` troca Archivo 700 por Redaction a partir de 768px;
              com 6vw o título já chega em 46px nesse ponto, acima do piso de
              40px que a Redaction exige. */}
          <blockquote className="titulo-secao max-w-[22ch] text-[clamp(1.75rem,6vw,3.5rem)] leading-[1.05]">
            {c.fecho}
          </blockquote>
          <div className="mt-10">
            {/* O rótulo do botão vem do dicionário, e não de `conteudo.ts`:
                é o mesmo texto do herói da home e da /a-serra. Duas fontes
                para um rótulo repetido é como ele começa a divergir. */}
            <BotaoLink href={href(locale, "/cafes")} variante="primario">
              {d.comum.verOsCafes}
            </BotaoLink>
          </div>
        </div>
      </section>
    </>
  );
}
