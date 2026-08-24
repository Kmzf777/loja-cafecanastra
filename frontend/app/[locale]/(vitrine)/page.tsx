import type { Metadata } from "next";
import Image from "next/image";
import { produtosDaHome } from "@/lib/catalogo/repositorio";
import { lotesDoLocale } from "@/lib/catalogo/produtos";
import { Carrossel, SlideDoCarrossel } from "@/components/ui/Carrossel";
import { CardProduto } from "@/components/catalogo/CardProduto";
import { CardVerMais } from "@/components/catalogo/CardVerMais";
import { TrilhaDeCategorias } from "@/components/catalogo/TrilhaDeCategorias";
import { SecaoDoBlog } from "@/components/blog/SecaoDoBlog";
import { BotaoLink } from "@/components/ui/Botao";
import { Serra } from "@/components/marca/Serra";
import { alternativasDeIdioma, href, openGraphDaPagina } from "@/lib/i18n/rotas";
import { LOCALES, comoLocale, type Locale } from "@/lib/i18n/tipos";
import { dicionario } from "@/lib/i18n/dicionario";
import type { ProdutoVendavel } from "@/lib/catalogo/tipos";

/**
 * Home — estetica.md §7.1.
 *
 * ELA DEIXOU DE SE APRESENTAR PARA VENDER. Eram sete secoes e so uma tinha
 * produto: uma grade estatica das cinco linhas, com "a partir de" no lugar do
 * preco. As outras seis eram marca, e tres delas repetiam, em versao curta,
 * texto que /a-serra, /historia e /clube ja publicam inteiro. Uma loja de um
 * produtor so nao precisa se apresentar quatro vezes antes de mostrar um
 * preco.
 *
 * O QUE ENTROU sao a trilha de categorias e tres carrosseis de SKU compravel,
 * com preco exato e botao de sacola em cada card. O QUE SAIU e "Torra da
 * semana", que os tres substituem, e o bloco Historia — este sem realocacao,
 * porque /historia conta a mesma narrativa inteira nos tres idiomas. "Do pe a
 * xicara" ficou, e foi para o fim: ela e conteudo, e conteudo vem depois de
 * produto.
 *
 * ALTERNANCIA DE SUPERFICIE (§7.1: "nunca duas secoes escuras seguidas"):
 *   heroi fuligem -> prova cal -> trilha cal -> mais vendidos cal
 *   -> kits kraft -> escolha do produtor cal -> clube mata -> BLOG kraft
 *   -> do pe a xicara cal -> rodape fuligem
 *
 * SO HA UMA ESCURA NO MIOLO, e e o Clube: Cal em cima, kraft embaixo. O rodape
 * e Fuligem, entao a ultima secao da pagina tem de ser clara — e e isso que
 * "Do pe a xicara" passou a ser ao mudar de lugar, trocando kraft por Cal para
 * nao encostar duas kraft no Blog. "Nossos kits" recebeu kraft pelo mesmo
 * motivo ao contrario: sem ele seriam tres carrosseis Cal empilhados, e a
 * pagina perderia o ritmo antes de chegar ao Clube.
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
   * AQUI MORAVA O BLOCO DE HISTÓRIA — título, texto e alt da foto — e ele saiu
   * inteiro, sem ir para lugar nenhum, porque /historia já publica a mesma
   * narrativa COMPLETA nos três idiomas. O que a home trazia era um resumo
   * dela, e resumir na porta de entrada o que a página vizinha conta melhor é
   * uma das quatro apresentações que esta página fazia antes de mostrar um
   * preço. O link para /historia continua vivo no rodapé e no menu.
   */
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
};

const es: TextosDaHome = {
  heroiRotulo: "Serra da Canastra · Minas Gerais, Brasil",
  heroiTitulo: "Café que viene de arriba.",
  heroiTexto: "Tostado bajo pedido, en lotes pequeños. Café de familia desde 1985.",
  heroiImagemAlt:
    "Cocina minera al amanecer: colador de tela, taza de peltre y un paquete de Café Canastra sobre la mesa de madera",

  prova: ["Tostado bajo pedido", "Origen único", "Desde 1985"],
  provaRotulo: "Garantías",

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
};

const TEXTOS: Record<Locale, TextosDaHome> = { pt, en, es };

/**
 * UMA SEÇÃO DE PRODUTO DA HOME — as três são a mesma coisa com dados
 * diferentes, e por isso são uma função só.
 *
 * O SÉTIMO CARD É SEMPRE O "VER MAIS", e ele entra aqui e não em cada chamada:
 * fosse responsabilidade de quem chama, o dia em que alguém acrescentasse a
 * quarta seção e esquecesse o card, o trilho terminaria num beco sem saída — e
 * ninguém veria, porque não quebra nada.
 */
function SecaoDeProdutos({
  titulo,
  produtos,
  verMais,
  locale,
  superficie,
}: {
  titulo: string;
  produtos: ProdutoVendavel[];
  /** Caminho canônico em português — `href()` cuida do idioma. */
  verMais: string;
  locale: Locale;
  /** A superfície da seção. §7.1: a alternância é o que dá ritmo à página. */
  superficie: "cal" | "juta-claro";
}) {
  return (
    <section
      className={`${superficie === "cal" ? "bg-cal" : "bg-juta-claro"} py-12 md:py-16`}
    >
      <div className="mx-auto max-w-[1440px] px-4 md:px-10">
        <h2 className="titulo-secao text-[clamp(1.5rem,3vw,2.25rem)] leading-tight">
          {titulo}
        </h2>
      </div>

      {/*
        O TRILHO SANGRA ATÉ A BORDA, e a calha vira padding DELE — é o que as
        quatro classes de filho fazem. Sem isso o card cortado terminaria no
        meio da margem, e o corte pareceria erro de layout em vez de convite a
        arrastar. O alvo é o container que rola, que mora dentro do
        <Carrossel>; a mesma regra alcança a camada das setas, que passa a
        respeitar a mesma calha.
      */}
      <div className="mt-6 md:mt-8">
        <Carrossel
          rotulo={titulo}
          className="[&>div]:mx-auto [&>div]:max-w-[1440px] [&>div]:px-4 md:[&>div]:px-10"
        >
          {produtos.map((p) => (
            <SlideDoCarrossel key={p.sku}>
              <CardProduto produto={p} locale={locale} />
            </SlideDoCarrossel>
          ))}
          <SlideDoCarrossel>
            <CardVerMais caminho={verMais} locale={locale} />
          </SlideDoCarrossel>
        </Carrossel>
      </div>
    </section>
  );
}

export default async function Home({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const locale = comoLocale((await params).locale);
  const d = dicionario(locale);
  const t = TEXTOS[locale];
  /**
   * A faixa de pontuação da coleção, do menor ao maior — 75 (Néctar de Minas,
   * gourmet) a 86 (Microlote). Sai do catálogo e não de uma constante escrita
   * à mão: no dia em que uma linha entrar ou sair, a faixa acompanha sozinha.
   * `font-dado` (Martian Mono) é exatamente para isto — número e código.
   *
   * O QUE MUDOU FOI A FONTE — `lotesDoLocale` no lugar de `listarLotes`. A
   * home não desenha mais card de LINHA, e nota de xícara é editorial puro:
   * não precisa do preço do banco para ser calculada. Quem fala com a API
   * agora é `produtosDaHome()`, logo abaixo, que é quem de fato vende.
   */
  const notasSca = lotesDoLocale(locale).map((l) => l.sca);
  const faixaSca = `SCA ${Math.min(...notasSca)}–${Math.max(...notasSca)}`;

  /**
   * UMA LEITURA DA API PARA AS TRÊS SEÇÕES — ver `produtosDaHome()`. É aqui
   * que o preço do painel e o `produtoId` do banco entram na página; sem este
   * `await`, os carrosséis anunciariam o preço do JSON e nenhum botão
   * conseguiria pôr nada na sacola.
   *
   * Isto NÃO tira a home da geração estática: `buscarDadosAoVivo` é `fetch`
   * com `next: { revalidate }`, que é justamente a leitura que sobrevive ao
   * prerender — a mesma que a listagem de lotes já fazia nesta página antes.
   */
  const seccoes = await produtosDaHome();

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

      {/* ── CATEGORIAS ────────────────────────────────────────────── superfície cal */}
      {/* Logo abaixo da prova, e é o primeiro atalho da página: quem já sabe o
          que quer sai daqui para a listagem em um toque, sem rolar os três
          carrosséis. */}
      <TrilhaDeCategorias locale={locale} />

      {/* ── MAIS VENDIDOS ─────────────────────────────────────────── superfície cal */}
      {/* PRIMEIRA PORQUE É A MAIS FÁCIL DE ESCOLHER. Quem chega sem decisão
          tomada compra o que os outros compram, e o §6.1 do spec registra que
          a ordem aqui é curadoria da casa, declarada no catálogo — não
          agregação de pedidos. */}
      <SecaoDeProdutos
        titulo={d.comum.maisVendidos}
        produtos={seccoes.maisVendidos}
        verMais="/cafes?destaque=mais-vendidos"
        locale={locale}
        superficie="cal"
      />

      {/* ── NOSSOS KITS ────────────────────────────────────────── superfície kraft */}
      {/* Kraft aqui é o que impede três carrosséis Cal empilhados — §7.1 pede
          alternância, e sem ela a página perde o ritmo antes do Clube. */}
      <SecaoDeProdutos
        titulo={d.comum.nossosKits}
        produtos={seccoes.kits}
        verMais="/cafes?tipo=kit"
        locale={locale}
        superficie="juta-claro"
      />

      {/* ── ESCOLHA DO PRODUTOR ───────────────────────────────────── superfície cal */}
      {/* A última das três de propósito: é a seção para quem já sabe o que
          quer, e ela puxa o microlote e os formatos de 1 kg. */}
      <SecaoDeProdutos
        titulo={d.comum.escolhaDoProdutor}
        produtos={seccoes.escolhaDoProdutor}
        verMais="/cafes?destaque=escolha-do-produtor"
        locale={locale}
        superficie="cal"
      />

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

      {/* ── BLOG ──────────────────────────────────────────────── superfície kraft */}
      {/* Só a casca, marcada "Em breve" — spec §4 e o comentário do componente.
          Aqui, entre o Clube e as etapas, era a HISTÓRIA: um resumo do que
          /historia já publica por inteiro nos três idiomas. Saiu sem ir para
          lugar nenhum, e o link para a página continua no menu e no rodapé. */}
      <SecaoDoBlog locale={locale} />

      {/* ── DO PÉ À XÍCARA ──────────────────────────────────────── superfície cal */}
      {/* Trocou kraft por Cal ao mudar de lugar: agora ela encosta no Blog, que
          é kraft, e duas kraft seguidas apagariam a divisa entre as duas. */}
      <section className="bg-cal py-16 md:py-24">
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
    </>
  );
}
