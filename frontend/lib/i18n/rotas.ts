import { LOCALES, LOCALE_PADRAO, TAG_BCP47, type Locale } from "./tipos";

/**
 * O endereço de cada página nos três idiomas.
 *
 * REGRA ÚNICA, E ELA É A METADE VISÍVEL DO MIDDLEWARE: o português não aparece
 * na URL. `href("pt", "/cafes")` devolve `/cafes`, e é o rewrite interno do
 * middleware que faz aquele endereço cair em `app/[locale]/(vitrine)/cafes`
 * com `locale = "pt"`. Se este arquivo passar a emitir `/pt/cafes`, todo link
 * da loja passa a apontar para o endereço não-canônico — e o middleware o
 * redireciona de volta, cobrando uma viagem extra por clique.
 *
 * IMPORTS RELATIVOS, não `@/`: o vitest.config.ts não resolve o alias, e este
 * módulo é importado pelos testes (mesma nota de lib/seo/jsonld.ts).
 */

/**
 * As raízes do caminho de compra, que são **pt-BR nos três idiomas** por
 * decisão do cliente: o frete é Melhor Envio (só Brasil) e o pagamento é
 * Mercado Pago BR. Traduzir o checkout sem resolver esses dois seria prometer
 * uma compra que a loja não consegue entregar (spec §1).
 *
 * Elas vivem em `app/(transacional)/`, FORA do `[locale]` — logo `/en/checkout`
 * simplesmente não existe, e prefixar um destes caminhos daria 404 no meio do
 * caminho que traz o dinheiro. O middleware lê a mesma lista.
 */
export const CAMINHOS_TRANSACIONAIS = [
  "/sacola",
  "/checkout",
  "/account",
  "/pedido",
] as const;

/** `/pedido/42` conta; `/pedidos-especiais` não. O corte é por segmento. */
export function ehCaminhoTransacional(caminho: string): boolean {
  return CAMINHOS_TRANSACIONAIS.some(
    (raiz) => caminho === raiz || caminho.startsWith(`${raiz}/`),
  );
}

/** Coisas que não são caminho interno: link externo, e-mail, âncora pura. */
function ehEnderecoDeFora(caminho: string): boolean {
  return /^[a-z][a-z0-9+.-]*:/i.test(caminho) || caminho.startsWith("#");
}

/**
 * O href de um caminho canônico (sempre escrito em português, sempre com barra
 * inicial) no idioma pedido.
 *
 * Querystring e âncora vêm juntas de propósito — `href("en", "/cafes?linha=suave")`
 * é o caso real dos links do rodapé, e separar isso obrigaria cada chamador a
 * remontar a URL.
 */
export function href(locale: Locale, caminho: string): string {
  if (ehEnderecoDeFora(caminho)) return caminho;
  if (locale === LOCALE_PADRAO) return caminho;
  if (ehCaminhoTransacional(caminho)) return caminho;
  // A home traduzida é `/en`, nunca `/en/`: a barra final é uma segunda URL
  // para a mesma página, e o Next normaliza uma para a outra com um redirect.
  return caminho === "/" ? `/${locale}` : `/${locale}${caminho}`;
}

/** O primeiro segmento do caminho, ou string vazia. */
function primeiroSegmento(caminho: string): string {
  return caminho.split("?")[0].split("#")[0].split("/")[1] ?? "";
}

/**
 * Que idioma um endereço está servindo. Sem prefixo é português — é a mesma
 * leitura que o middleware faz antes de decidir o rewrite.
 */
export function localeDaRota(caminho: string): Locale {
  const segmento = primeiroSegmento(caminho);
  const achado = LOCALES.find((l) => l === segmento);
  return achado ?? LOCALE_PADRAO;
}

/**
 * O caminho canônico por trás de um endereço traduzido: `/en/cafes` → `/cafes`.
 *
 * É o par de `href()`, e é o que permite trocar de idioma SEM SAIR DA PÁGINA —
 * `href(outroIdioma, caminhoSemLocale(atual))`. Sem ele, o seletor de idioma
 * só saberia levar para a home.
 */
export function caminhoSemLocale(caminho: string): string {
  const segmento = primeiroSegmento(caminho);
  if (!LOCALES.some((l) => l === segmento)) return caminho;
  const resto = caminho.slice(segmento.length + 1);
  return resto.startsWith("/") ? resto : `/${resto}`;
}

/* -------------------------------------------------------------------------
   O QUE UMA PÁGINA DIZ DE SI AO CRAWLER

   `tipos.ts` responde "quais são os idiomas". Daqui para baixo é a outra
   pergunta: como uma página traduzida se apresenta ao buscador e às redes.
   `alternates` e `og:locale` são o mesmo assunto — e é por não serem o mesmo
   assunto de `tipos.ts` que eles moram aqui, ao lado de `href()`, que é quem
   sabe montar o endereço de cada versão.
------------------------------------------------------------------------- */

/**
 * `og:locale` — A ÚNICA TABELA DO SITE, e a unicidade é o ponto.
 *
 * Ela já existiu em TRÊS cópias que discordavam: /historia e a PDP diziam
 * `en_US`/`es_ES` por duas tabelas gêmeas copiadas uma da outra, e /bio dizia
 * `en`/`es` por um `TAG_BCP47[locale].replace("-", "_")` escrito à mão. Três
 * valores para a mesma língua no mesmo site — e o Facebook lê o valor, não a
 * intenção.
 *
 * NÃO DÁ PARA REAPROVEITAR O `TAG_BCP47` de ./tipos: o Open Graph exige
 * `idioma_TERRITÓRIO` sempre, e aquela tabela devolve `en` e `es` secos — que
 * é exatamente o valor inválido que /bio emitia. O território é convenção de
 * crawler, não afirmação sobre o público: quem lê em espanhol aqui é sobretudo
 * Chile e Argentina, mas `es_ES` é o valor que o Facebook documenta como
 * padrão da língua.
 */
export const TAG_OPEN_GRAPH: Record<Locale, string> = {
  pt: "pt_BR",
  en: "en_US",
  es: "es_ES",
};

export type ImagemOpenGraph = {
  url: string;
  width?: number;
  height?: number;
  alt?: string;
};

/**
 * A imagem padrão dos cards compartilhados: o herói da home, 1280x720 — a
 * proporção mais próxima do 1.91:1 que os crawlers pedem (o `bannerdesktop.jpg`
 * é 1600x500, esticado demais para card). Páginas com imagem própria passam a
 * sua em `imagens`.
 */
const IMAGEM_PADRAO: ImagemOpenGraph = {
  url: "/imagem-banner.jpg",
  width: 1280,
  height: 720,
  alt: "Café Canastra — Serra da Canastra, Minas Gerais",
};

/**
 * O bloco `openGraph` COMPLETO de uma página traduzida.
 *
 * TODA ROTA TRADUZIDA PRECISA CHAMAR ESTA FUNÇÃO, e o motivo é uma regra do
 * Next que só morde quem não a conhece: `openGraph` NÃO é fundido campo a
 * campo com o do layout pai — a rota que declara SUBSTITUI o objeto inteiro.
 * Daí as duas metades do defeito que esta função fecha:
 *
 *   - quem NÃO declarava herdava um `locale` fixo do layout raiz e anunciava
 *     ao Facebook e ao WhatsApp que a versão em inglês era portuguesa;
 *   - quem declarava perdia `siteName` e a imagem do card, e tinha de repetir
 *     os dois à mão — foi copiando essa repetição que as três tabelas de
 *     `og:locale` discordantes nasceram.
 *
 * Por isso o retorno é o bloco INTEIRO, com `siteName` e imagem dentro: uma
 * chamada só por rota, barata o bastante para nenhuma rota nova "esquecer" de
 * declarar — e é o esquecimento, não o erro de digitação, que produziu as sete
 * rotas erradas.
 *
 * `url` sai de `href()` e por isso é RELATIVA, como as de `alternativasDeIdioma`
 * logo abaixo: o Next a resolve contra o `metadataBase` de app/layout.tsx, que
 * é a mesma origem do sitemap e do JSON-LD. Escrever o domínio aqui criaria uma
 * segunda fonte, capaz de desmentir as outras.
 */
export function openGraphDaPagina({
  locale,
  caminho,
  titulo,
  descricao,
  tipo = "website",
  imagens = [IMAGEM_PADRAO],
}: {
  locale: Locale;
  caminho: string;
  titulo: string;
  descricao: string;
  tipo?: "website" | "article";
  imagens?: ImagemOpenGraph[];
}) {
  return {
    type: tipo,
    siteName: "Café Canastra",
    locale: TAG_OPEN_GRAPH[locale],
    url: href(locale, caminho),
    title: titulo,
    description: descricao,
    images: imagens,
  };
}

/**
 * O bloco `alternates` do metadata de uma página traduzida.
 *
 * É ele que impede o Google de tratar `/cafes`, `/en/cafes` e `/es/cafes` como
 * três páginas concorrendo pela mesma consulta. O conjunto precisa ser
 * COMPLETO e RECÍPROCO — cada versão aponta para as três, inclusive para si
 * mesma; um conjunto incompleto é descartado inteiro pelo buscador.
 *
 * O `locale` É OBRIGATÓRIO PORQUE O CANÔNICO É SEMPRE A PRÓPRIA PÁGINA. Um
 * canônico de `/en/cafes` apontando para `/cafes` não diz "estas são versões de
 * idioma": diz "esta página é cópia daquela, indexe só a outra" — e apagaria do
 * índice justamente as páginas em inglês e espanhol que este projeto existe
 * para criar. O canônico próprio ainda serve para o que ele resolve de fato:
 * colapsar `/cafes?linha=suave&ordem=preco` de volta em `/cafes`.
 *
 * `x-default` vai para o português porque é a versão que vende: o checkout só
 * existe em pt-BR, e é para lá que um visitante de idioma desconhecido deve
 * cair.
 *
 * Os caminhos ficam RELATIVOS: o Next os resolve contra o `metadataBase` de
 * app/layout.tsx, que por sua vez sai de `urlDoSite()` — a mesma origem do
 * sitemap e do JSON-LD. Escrever o domínio aqui criaria uma segunda fonte,
 * capaz de desmentir as outras.
 */
export function alternativasDeIdioma(
  caminho: string,
  locale: Locale,
): {
  canonical: string;
  languages: Record<string, string>;
} {
  const languages: Record<string, string> = {};
  for (const outro of LOCALES) {
    languages[TAG_BCP47[outro]] = href(outro, caminho);
  }
  languages["x-default"] = href(LOCALE_PADRAO, caminho);

  return { canonical: href(locale, caminho), languages };
}
