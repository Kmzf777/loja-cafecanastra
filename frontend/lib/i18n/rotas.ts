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
