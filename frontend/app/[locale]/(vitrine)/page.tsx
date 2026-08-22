import type { Metadata } from "next";
import Image from "next/image";
import { listarLotes } from "@/lib/catalogo/repositorio";
import { traduzirLote } from "@/lib/catalogo/produtos";
import { CardCafe } from "@/components/catalogo/CardCafe";
import { SecaoDoBlog } from "@/components/blog/SecaoDoBlog";
import { BotaoLink } from "@/components/ui/Botao";
import { Serra } from "@/components/marca/Serra";
import { alternativasDeIdioma, href, openGraphDaPagina } from "@/lib/i18n/rotas";
import { LOCALES, comoLocale, type Locale } from "@/lib/i18n/tipos";
import { dicionario } from "@/lib/i18n/dicionario";
import { MARCO_DE_ORIGEM } from "./a-serra/conteudo";

/**
 * Home — estetica.md §7.1.
 *
 * ALTERNANCIA DE SUPERFICIE (§7.1: "nunca duas secoes escuras seguidas"):
 *   heroi fuligem -> prova cal -> torra cal -> processo kraft -> clube mata
 *   -> historia cal -> BLOG kraft -> rodape fuligem
 *
 * O BLOG ENTRA NO PENULTIMO LUGAR, e a alternancia e o que decide isso. O
 * rodape e Fuligem, entao a secao antes dele tem de ser clara; entre as duas
 * claras disponiveis, o kraft e a superficie de papel e esta e a secao de
 * texto. Encaixar o blog antes do Clube teria posto duas secoes Cal seguidas e
 * empurrado a assinatura — que vende — para baixo de uma secao que hoje esta
 * vazia.
 *
 * O documento previa o heroi como foto full-bleed do chapadao ao amanhecer. Ela
 * nao existe (§8 e o caminho critico do projeto). Em vez de forcar a unica foto
 * disponivel — sepia quente, justamente o vies que o §2 manda evitar — o heroi
 * roda em superficie escura com a serra, que e a "mao" do §3 aparecendo uma vez.
 */

export const revalidate = 3600;

/**
 * AS TRÊS HOMES SAEM DO BUILD — e sem esta função nenhuma delas sai.
 *
 * Um segmento dinâmico só é prerenderizado se alguém disser QUAIS valores ele
 * assume. Sem `generateStaticParams`, o `[locale]` faz o Next tratar a rota
 * como sob demanda, e aí `revalidate` acima já não guarda um HTML pronto: cada
 * visita paga render de servidor MAIS o `fetch` a `/dashboard`. Foi
 * exatamente o que aconteceu quando a vitrine entrou no segmento de idioma —
 * `.next/prerender-manifest.json` ficou só com as 15 PDPs, que são as únicas
 * que já declaravam a função. docs/performance-dev.md §7 tem o preço disso
 * medido: a PLP estática servia em 46-90 ms.
 *
 * Nada aqui lê `cookies()`, `headers()` nem `searchParams` — o repositório do
 * catálogo é `fetch` com `next: { revalidate }`, que é justamente a leitura
 * que sobrevive à geração estática —, então a home é elegível e volta a ser
 * HTML pronto com revalidação de hora em hora.
 */
export function generateStaticParams() {
  return LOCALES.map((locale) => ({ locale }));
}

/* -------------------------------------------------------------------------
   O QUE A HOME DIZ AO BUSCADOR, nos três idiomas.

   Ela era a ÚNICA página da vitrine sem título e sem descrição próprios: o
   `generateMetadata` devolvia só `alternates`, e por isso `/en` servia o
   título padrão do layout raiz — "Café Canastra", sem nome de página — com a
   descrição em PORTUGUÊS, repetida em `og:description` e
   `twitter:description`. Idêntico em `/es`. A porta de entrada dos três
   idiomas era a única que não se traduzia, enquanto /a-serra, /clube,
   /historia, /bio, /rastreabilidade, os termos, a privacidade e a PDP todas
   traduziam.

   Tabela à parte do `TEXTOS` da página logo abaixo, e de propósito: isto não é
   texto de tela, é o cartão de resultado. É a mesma separação que /a-serra,
   /clube e /historia já fazem, guardando o `meta` fora dos textos da página.

   O CONTEÚDO NÃO INVENTA NADA. Origem única da Serra da Canastra, torra sob
   demanda em lotes pequenos, família desde 1985 e Canastra desde 2008 são os
   mesmos fatos de `a-serra/conteudo.ts` — e o vocabulário dos três idiomas é o
   do herói e do bloco de história desta própria página, para o cartão de
   resultado não prometer numa língua o que a tela diz noutra.
------------------------------------------------------------------------- */
const META: Record<Locale, { titulo: string; descricao: string }> = {
  pt: {
    titulo: "Café Canastra — Café de origem única da Serra da Canastra",
    descricao:
      "Café de origem única da Serra da Canastra, torrado sob demanda em lotes pequenos. Café da família Boaventura desde 1985, na Canastra desde 2008.",
  },
  en: {
    titulo: "Café Canastra — Single origin coffee from the Serra da Canastra",
    descricao:
      "Single origin coffee from the Serra da Canastra, roasted to order in small batches. A Boaventura family coffee since 1985, in the Canastra since 2008.",
  },
  es: {
    titulo: "Café Canastra — Café de origen único de la Serra da Canastra",
    descricao:
      "Café de origen único de la Serra da Canastra, tostado bajo pedido en lotes pequeños. Café de la familia Boaventura desde 1985, en la Canastra desde 2008.",
  },
};

/**
 * `alternates` é o que impede `/`, `/en` e `/es` de concorrerem entre si no
 * buscador. É `generateMetadata` e não um `metadata` constante por um motivo
 * só: o canônico precisa ser a PRÓPRIA página, e para isso é preciso saber o
 * idioma. Ver a nota em lib/i18n/rotas.ts.
 */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const locale = comoLocale((await params).locale);
  const m = META[locale];

  return {
    /**
     * `absolute` porque o título já traz a marca NA FRENTE, que é o lugar dela
     * na home. O `title.template` de app/layout.tsx acrescenta "— Café
     * Canastra" ao fim de qualquer título-string, e o resultado seria a marca
     * duas vezes na aba e no cartão de resultado. Mesma decisão de /bio.
     */
    title: { absolute: m.titulo },
    description: m.descricao,
    alternates: alternativasDeIdioma("/", locale),
    openGraph: openGraphDaPagina({
      locale,
      caminho: "/",
      titulo: m.titulo,
      descricao: m.descricao,
    }),
  };
}

/**
 * A numeração de "Do pé à xícara" é CALCULADA, não escrita: ela fica fora da
 * tabela de tradução porque é sequência e não texto (§7.1 a justifica por ser
 * real e irreversível), e é derivada da posição para não existir a hipótese de
 * uma lista traduzida com um passo a mais ficar sem número.
 */
function numeroDaEtapa(indice: number): string {
  return String(indice + 1).padStart(2, "0");
}

/* -------------------------------------------------------------------------
   Os textos da home, nos três idiomas.

   Mesma trava do lib/i18n/dicionario.ts: `pt` é a fonte do tipo, `en` e `es`
   são DECLARADOS como `TextosDaHome`, e chave faltante quebra o build. Só os
   RÓTULOS reaproveitados (botões, contagem de lotes) continuam vindo do
   dicionário; texto corrido de página é conteúdo, e conteúdo mora com a
   página — é o que o comentário do dicionário determina.

   A tabela vive dentro do page.tsx, e não num `conteudo.ts` ao lado como em
   /bio e /a-serra, porque esta tarefa recebeu como seu apenas este arquivo do
   diretório. Mover a tabela para fora é um passo de arrumação, não de
   conteúdo.
------------------------------------------------------------------------- */

const pt = {
  heroiRotulo: "Serra da Canastra · Minas Gerais",
  heroiTitulo: "Café que vem de cima.",
  /**
   * "Torrado sob demanda… desde 1985" dizia que a torrefação existe desde 1985.
   * Não existe: a família planta café desde 1985, e a torrefação própria é de
   * 2016 (ver o comentário de a-serra/conteudo.ts). A frase foi partida em duas
   * para cada metade poder ser verdadeira.
   */
  heroiTexto: "Torrado sob demanda, em lotes pequenos. Café da família desde 1985.",
  heroiImagemAlt:
    "Cozinha mineira ao amanhecer: coador de pano, caneca de ágata e um pacote de Café Canastra sobre a mesa de madeira",

  /**
   * "Lote rastreado" SAIU e "Origem única" entrou. A rastreabilidade que a marca
   * de fato oferece é o registro do PRODUTOR na base do Cerrado Mineiro — é o
   * que a /rastreabilidade explica, e ela diz na cara que não há código por
   * embalagem. Prometer lote rastreado na faixa de prova e desmentir isso duas
   * páginas adiante é pior do que não prometer. "Origem única da Serra da
   * Canastra" é atributo declarado da marca em data/catalogo-canastra.json.
   */
  /**
   * "SCA 80+" SAIU DAQUI, e é a mesma cirurgia que o <SeloSCA> sofreu: a
   * afirmação é verdadeira para as quatro linhas Canastra e FALSA para o
   * Néctar de Minas, que tem 75 e é gourmet pela própria embalagem. Uma faixa
   * de prova afirma sobre a coleção inteira. No lugar entra a FAIXA REAL,
   * calculada a partir das notas do catálogo — número derivado do dado, que
   * não pode envelhecer e não pode mentir.
   */
  prova: ["Torra sob demanda", "Origem única", "Desde 1985"],
  /** Rótulo do landmark da faixa — só leitor de tela ouve. */
  provaRotulo: "Garantias",

  torraTitulo: "Torra da semana",

  etapasTitulo: "Do pé à xícara",
  etapas: [
    { titulo: "Colheita", texto: "Grão maduro, colhido no ponto." },
    { titulo: "Terreiro", texto: "Secagem lenta, ao sol, sobre o cimento." },
    { titulo: "Beneficiamento", texto: "Separação por peneira e densidade." },
    { titulo: "Torra", texto: "Em lotes pequenos, sob demanda." },
    { titulo: "Sua casa", texto: "Moído na hora do pedido, ou em grão." },
  ],

  clubeRotulo: "Assinatura",
  clubeTitulo: "Clube da Canastra",
  clubeTexto:
    "Café novo em casa a cada 15, 30 ou 45 dias, moído do jeito que você prepara. Cancele quando quiser, sem multa.",

  /**
   * "Quarenta anos na mesma serra" era falso, e a altitude "entre 900 e 1.320
   * metros" nunca teve fonte. A correção inteira está documentada em
   * a-serra/conteudo.ts; aqui fica a versão curta.
   */
  historiaTitulo: "Quarenta anos de café, dezoito na Canastra",
  historiaTexto:
    "A família Boaventura plantou em 1985 no cerrado, em Patrocínio. A Serra da Canastra veio em 2008: dias quentes, noites frias, grão que amadurece devagar. É o que a xícara mostra.",
  historiaImagemAlt:
    "Dois produtores entre as fileiras de café, no fim da tarde",
};

type TextosDaHome = typeof pt;

const en: TextosDaHome = {
  heroiRotulo: "Serra da Canastra · Minas Gerais, Brazil",
  heroiTitulo: "Coffee from up high.",
  heroiTexto: "Roasted to order, in small batches. A family coffee since 1985.",
  heroiImagemAlt:
    "A Minas kitchen at dawn: a cloth filter, an enamel mug and a bag of Café Canastra on the wooden table",

  prova: ["Roasted to order", "Single origin", "Since 1985"],
  provaRotulo: "Guarantees",

  torraTitulo: "This week's roast",

  etapasTitulo: "From tree to cup",
  etapas: [
    { titulo: "Harvest", texto: "Ripe cherries, picked at the right moment." },
    { titulo: "Drying patio", texto: "Slow drying in the sun, on the concrete." },
    { titulo: "Milling", texto: "Sorted by screen size and density." },
    { titulo: "Roasting", texto: "Small batches, roasted to order." },
    { titulo: "Your kitchen", texto: "Ground when you order, or whole bean." },
  ],

  clubeRotulo: "Subscription",
  clubeTitulo: "Clube da Canastra",
  clubeTexto:
    "Fresh coffee at home every 15, 30 or 45 days, ground the way you brew. Cancel whenever you want, no penalty.",

  historiaTitulo: "Forty years of coffee, eighteen in the Canastra",
  historiaTexto:
    "The Boaventura family planted in 1985 in the cerrado, in Patrocínio. The Serra da Canastra came in 2008: warm days, cold nights, beans that ripen slowly. That is what the cup shows.",
  historiaImagemAlt: "Two growers between the coffee rows, late in the afternoon",
};

const es: TextosDaHome = {
  heroiRotulo: "Serra da Canastra · Minas Gerais, Brasil",
  heroiTitulo: "Café que viene de arriba.",
  heroiTexto: "Tostado bajo pedido, en lotes pequeños. Café de familia desde 1985.",
  heroiImagemAlt:
    "Cocina minera al amanecer: colador de tela, taza de peltre y un paquete de Café Canastra sobre la mesa de madera",

  prova: ["Tostado bajo pedido", "Origen único", "Desde 1985"],
  provaRotulo: "Garantías",

  torraTitulo: "El tueste de la semana",

  etapasTitulo: "Del cafeto a la taza",
  etapas: [
    { titulo: "Cosecha", texto: "Grano maduro, cosechado en su punto." },
    { titulo: "Terrero", texto: "Secado lento, al sol, sobre el cemento." },
    { titulo: "Beneficio", texto: "Separación por criba y densidad." },
    { titulo: "Tueste", texto: "En lotes pequeños, bajo pedido." },
    { titulo: "Su casa", texto: "Molido al hacer el pedido, o en grano." },
  ],

  clubeRotulo: "Suscripción",
  clubeTitulo: "Clube da Canastra",
  clubeTexto:
    "Café nuevo en casa cada 15, 30 o 45 días, molido como usted prepara. Cancele cuando quiera, sin multa.",

  historiaTitulo: "Cuarenta años de café, dieciocho en la Canastra",
  historiaTexto:
    "La familia Boaventura plantó en 1985 en el cerrado, en Patrocínio. La Serra da Canastra llegó en 2008: días cálidos, noches frías, grano que madura despacio. Es eso lo que muestra la taza.",
  historiaImagemAlt: "Dos productores entre las hileras de café, al final de la tarde",
};

const TEXTOS: Record<Locale, TextosDaHome> = { pt, en, es };

export default async function Home({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const locale = comoLocale((await params).locale);
  const d = dicionario(locale);
  const t = TEXTOS[locale];
  // Preço e estoque do banco primeiro; o editorial traduzido por cima.
  const lotes = (await listarLotes()).map((l) => traduzirLote(l, locale));

  /**
   * A faixa de pontuação da coleção, do menor ao maior — 75 (Néctar de Minas,
   * gourmet) a 86 (Microlote). Sai do catálogo e não de uma constante escrita
   * à mão: no dia em que uma linha entrar ou sair, a faixa acompanha sozinha.
   * `font-dado` (Martian Mono) é exatamente para isto — número e código.
   */
  const notasSca = lotes.map((l) => l.sca);
  const faixaSca = `SCA ${Math.min(...notasSca)}–${Math.max(...notasSca)}`;

  return (
    <>
      {/* ── HERÓI ─────────────────────────────────────────── superfície fuligem */}
      <section className="relative flex min-h-[88vh] flex-col justify-end overflow-hidden bg-fuligem text-cal">
        <Image
          src="/imagem-banner.jpg"
          alt={t.heroiImagemAlt}
          fill
          priority
          fetchPriority="high"
          sizes="100vw"
          className="object-cover object-center"
        />
        {/* §7.1: sobreposição em gradiente de fuligem, 0 -> 60%, de baixo para
            cima. Sem ela o texto em Cal não passa contraste sobre a foto. */}
        <div
          aria-hidden
          className="absolute inset-0"
          style={{
            background:
              "linear-gradient(to top, var(--color-fuligem) 0%, color-mix(in srgb, var(--color-fuligem) 78%, transparent) 38%, color-mix(in srgb, var(--color-fuligem) 30%, transparent) 72%, transparent 100%)",
          }}
        />
        {/* Horizonte, nao pico: o viewBox e 5:1 e a altura precisa respeitar
            isso, senao a serra vira uma piramide esticada. */}
        <Serra
          aria-hidden
          className="absolute inset-x-0 bottom-0 h-[18vh] max-h-[180px] w-full text-fuligem/70"
          strokeWidth={1.5}
          preenchido
        />
        <div className="relative mx-auto w-full max-w-[1440px] px-4 pb-20 pt-32 md:px-10 md:pb-28">
          <p className="text-[12px] font-semibold uppercase tracking-[0.18em] text-juta">
            {t.heroiRotulo}
          </p>
          <h1 className="mt-6 max-w-[14ch] font-titulo text-[clamp(2.75rem,7vw,5.5rem)] leading-[0.95] tracking-[-0.02em]">
            {t.heroiTitulo}
          </h1>
          <p className="mt-6 max-w-[52ch] text-[18px] leading-relaxed text-cal/80">
            {t.heroiTexto}
          </p>
          <div className="mt-10 flex flex-wrap gap-4">
            <BotaoLink href={href(locale, "/cafes")} variante="primario">
              {d.comum.verOsCafes}
            </BotaoLink>
            <BotaoLink
              href={href(locale, "/a-serra")}
              variante="secundario"
              className="text-cal"
            >
              {d.comum.conhecerASerra}
            </BotaoLink>
          </div>
        </div>
      </section>

      {/* ── FAIXA DE PROVA ──────────────────────────────────────── superfície cal */}
      <section aria-label={t.provaRotulo} className="border-b border-fuligem-20 bg-cal">
        <ul className="mx-auto grid max-w-[1440px] grid-cols-2 md:grid-cols-4">
          {[faixaSca, ...t.prova].map((item, i) => (
            <li
              key={item}
              className={`px-4 py-6 text-center font-dado text-[12px] uppercase tracking-[0.1em] md:px-10 ${
                i > 0 ? "md:border-l md:border-fuligem-20" : ""
              } ${i === 1 || i === 3 ? "border-l border-fuligem-20" : ""} ${
                i > 1 ? "border-t border-fuligem-20 md:border-t-0" : ""
              }`}
            >
              {item}
            </li>
          ))}
        </ul>
      </section>

      {/* ── TORRA DA SEMANA ─────────────────────────────────────── superfície cal */}
      <section className="bg-cal py-16 md:py-24">
        <div className="mx-auto max-w-[1440px] px-4 md:px-10">
          <div className="flex flex-wrap items-baseline justify-between gap-4">
            <h2 className="titulo-secao text-[clamp(1.75rem,3.5vw,2.75rem)] leading-tight">
              {t.torraTitulo}
            </h2>
            <span className="font-dado text-[13px] tracking-[0.06em] text-fuligem-55">
              {lotes.length} {lotes.length === 1 ? d.comum.lote : d.comum.lotes}
            </span>
          </div>

          <div className="mt-10 grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {lotes.map((lote) => (
              <CardCafe key={lote.slug} lote={lote} locale={locale} />
            ))}
          </div>

          <div className="mt-12">
            <BotaoLink href={href(locale, "/cafes")} variante="secundario">
              {d.comum.verTodosOsCafes}
            </BotaoLink>
          </div>
        </div>
      </section>

      {/* ── DO PÉ À XÍCARA ────────────────────────────────────── superfície kraft */}
      <section className="bg-juta-claro py-16 md:py-24">
        <div className="mx-auto max-w-[1440px] px-4 md:px-10">
          <h2 className="titulo-secao text-[clamp(1.75rem,3.5vw,2.75rem)] leading-tight">
            {t.etapasTitulo}
          </h2>
          {/* Numeração justificada: é sequência real e irreversível (§7.1). */}
          <ol className="mt-10 grid grid-cols-1 gap-x-8 gap-y-8 sm:grid-cols-2 lg:grid-cols-5">
            {t.etapas.map((etapa, i) => (
              <li key={etapa.titulo} className="border-t border-fuligem/25 pt-4">
                <span className="font-dado text-[13px] tracking-[0.08em] text-barro">
                  {numeroDaEtapa(i)}
                </span>
                <h3 className="mt-2 text-[17px] font-semibold">{etapa.titulo}</h3>
                <p className="mt-1.5 text-[15px] leading-relaxed text-fuligem-80">
                  {etapa.texto}
                </p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      {/* ── CLUBE ────────────────────────────────────────────── superfície mata */}
      <section className="bg-mata py-16 text-cal md:py-24">
        <div className="mx-auto max-w-[1440px] px-4 md:px-10">
          <p className="text-[12px] font-semibold uppercase tracking-[0.18em] text-juta">
            {t.clubeRotulo}
          </p>
          <h2 className="mt-5 max-w-[18ch] titulo-secao text-[clamp(1.75rem,3.5vw,2.75rem)] leading-tight">
            {t.clubeTitulo}
          </h2>
          <p className="mt-5 max-w-[62ch] text-[17px] leading-relaxed text-cal/85">
            {t.clubeTexto}
          </p>
          {/* §4.1: vermelho sobre mata é 2,0:1 — proibido. CTA em cal. */}
          <div className="mt-10">
            <BotaoLink href={href(locale, "/clube")} variante="primarioEscuro">
              {d.comum.comecarAssinatura}
            </BotaoLink>
          </div>
        </div>
      </section>

      {/* ── HISTÓRIA ────────────────────────────────────────────── superfície cal */}
      <section className="bg-cal py-16 md:py-24">
        <div className="mx-auto grid max-w-[1440px] items-center gap-8 px-4 md:grid-cols-2 md:gap-10 md:px-10">
          {/* min-w-0: sem isto a largura intrinseca da imagem empurra a coluna
              do grid e o documento estoura em mobile. */}
          <div className="min-w-0">
            <Image
              src="/nossa-historia.png"
              alt={t.historiaImagemAlt}
              width={1448}
              height={1448}
              sizes="(min-width: 768px) 50vw, 100vw"
              className="h-auto w-full border border-fuligem-20"
            />
          </div>
          <div className="min-w-0">
            {/* As duas datas vêm de a-serra/conteudo.ts — uma fonte só para o
                fato. Duas páginas que afirmam a mesma coisa por duas constantes
                diferentes é como a versão errada sobreviveu até aqui. */}
            <p className="font-dado text-[13px] tracking-[0.08em] text-barro">
              {MARCO_DE_ORIGEM}
            </p>
            <h2 className="mt-4 titulo-secao text-[clamp(1.75rem,3.5vw,2.75rem)] leading-tight">
              {t.historiaTitulo}
            </h2>
            <p className="mt-5 max-w-[62ch] text-[17px] leading-relaxed text-fuligem-80">
              {t.historiaTexto}
            </p>
            <div className="mt-8 flex flex-wrap items-center gap-x-6 gap-y-3">
              <BotaoLink href={href(locale, "/a-serra")} variante="secundario">
                {d.comum.conhecerASerra}
              </BotaoLink>
              {/* ALVO DE TOQUE: `min-h-[44px]` porque a variante `texto` é a
                  única das quatro do <BotaoLink> que não recebe a altura
                  `h-12` — e o BASE dela traz `leading-none`, então o alvo
                  fecharia em ~13px de altura, um terço dos 44px que o §10
                  exige. O conserto certo é no componente (ver o comentário
                  igual em /a-serra e /rastreabilidade), mas
                  components/ui/Botao.tsx não é desta tarefa; enquanto isso, o
                  mínimo vem de fora. `inline-flex items-center` do BASE
                  centraliza o texto na altura, e o sublinhado continua só
                  embaixo da palavra. */}
              <BotaoLink
                href={href(locale, "/historia")}
                variante="texto"
                className="min-h-[44px]"
              >
                {d.nav.historia}
              </BotaoLink>
            </div>
          </div>
        </div>
      </section>

      {/* ── BLOG ──────────────────────────────────────────────── superfície kraft */}
      {/* Só a casca, marcada "Em breve" — spec §4 e o comentário do componente. */}
      <SecaoDoBlog locale={locale} />
    </>
  );
}
