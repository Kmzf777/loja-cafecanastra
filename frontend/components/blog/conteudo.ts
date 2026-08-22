import { TAG_BCP47, type Locale } from "../../lib/i18n/tipos";

/**
 * O CONTRATO DE DADOS DO BLOG, escrito antes de existir blog.
 *
 * O cliente decidiu (spec §4) que a home ganha a SEÇÃO e não o blog: sem API,
 * sem tabela `blog_posts`, sem admin. Uma seção que promete post e entrega erro
 * seria pior que nenhuma seção — então a seção existe, desenhada e vazia, e
 * diz "Em breve" na cara.
 *
 * ESTE ARQUIVO É O QUE PERMITE LIGAR O BLOG SEM REDESENHAR A SEÇÃO. O tipo
 * `PostDoBlog` é o formato que o <SecaoDoBlog> já sabe renderizar; a única
 * peça que muda no dia da integração é o corpo de `listarPostsDoBlog()`.
 * O que MAIS falta nesse dia está escrito lá — para ninguém descobrir tarde.
 *
 * IMPORT RELATIVO, não `@/`: o vitest.config.ts não resolve o alias, e este
 * módulo é importado pelo teste ao lado (mesma nota de lib/i18n/rotas.ts).
 */

/** Quantos posts a home mostra. estetica.md §7.1 reserva três no bloco APRENDER. */
export const POSTS_NA_HOME = 3;

/**
 * O post como a home precisa dele — chamada, não corpo.
 *
 * O corpo do texto NÃO entra aqui de propósito: a home mostra cartão, e puxar
 * o markdown inteiro de três posts para renderizar três resumos é peso morto
 * no caminho mais visitado do site.
 */
export type PostDoBlog = {
  /** Último segmento da URL: `/blog/como-moer-em-casa`. */
  slug: string;
  titulo: string;
  /** Chamada de duas ou três linhas — é o que o cartão mostra. */
  resumo: string;
  /**
   * Data de publicação em ISO 8601, só o dia: `2026-08-22`.
   *
   * SEM HORA E SEM FUSO, e é decisão: post tem dia de publicação, não instante.
   * O formato ISO ainda ordena corretamente por comparação de string, o que é
   * o que `postsEmDestaque` explora.
   */
  data: string;
  /** Opcional: sem imagem o cartão continua de pé, só mais curto. */
  imagem?: { src: string; alt: string; w: number; h: number };
};

/**
 * A FONTE. Hoje devolve vazio, e isso é a decisão do cliente, não uma pendência
 * esquecida.
 *
 * PARA LIGAR O BLOG DE VERDADE, TROCAR O CORPO DESTA FUNÇÃO — e mais duas
 * coisas que não estão neste arquivo:
 *
 *   1. a rota `/blog/[slug]`, que ainda não existe. Sem ela, cada cartão desta
 *      seção é um link para 404.
 *   2. o link "todos os textos" no rodapé, que hoje não é oferecido justamente
 *      porque não há para onde levar.
 *
 * Se a fonte virar assíncrona (API, Supabase), a assinatura passa a
 * `Promise<readonly PostDoBlog[]>` e o <SecaoDoBlog> vira `async` — ele já é
 * componente de servidor, então nada mais muda.
 */
export function listarPostsDoBlog(): readonly PostDoBlog[] {
  return [];
}

/**
 * Os mais recentes primeiro, no máximo `limite`.
 *
 * A comparação é de STRING, não de `Date`: em ISO 8601 a ordem alfabética é a
 * ordem cronológica, e converter para `Date` só acrescentaria o risco de fuso
 * que `formatarDataDoPost` documenta logo abaixo.
 *
 * A cópia com `[...posts]` também não é enfeite — `sort` ordena no lugar, e
 * reordenar a lista do chamador é o tipo de efeito colateral que só aparece
 * quando a fonte passa a ser um cache de módulo.
 */
export function postsEmDestaque(
  posts: readonly PostDoBlog[],
  limite: number,
): PostDoBlog[] {
  return [...posts]
    .sort((a, b) => b.data.localeCompare(a.data))
    .slice(0, limite);
}

/**
 * A data do post no idioma da página.
 *
 * `timeZone: "UTC"` É O CORAÇÃO DESTA FUNÇÃO. `new Date("2026-08-22")` é
 * meia-noite em UTC; formatada no fuso do servidor (ou do leitor), no Brasil
 * ela vira 21 de agosto. Uma data que anda um dia para trás é o erro perfeito:
 * ninguém confere, e o único sintoma é um dígito.
 */
export function formatarDataDoPost(iso: string, locale: Locale): string {
  return new Intl.DateTimeFormat(TAG_BCP47[locale], {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${iso}T00:00:00Z`));
}

/* -------------------------------------------------------------------------
   Os textos da seção, nos três idiomas.

   Mesma trava do lib/i18n/dicionario.ts: `pt` é a fonte do tipo e `en`/`es`
   são DECLARADOS como `TextosDoBlog`, então chave faltante quebra o build em
   vez de virar `undefined` na tela. Objeto raso de propósito — o teste ao lado
   varre `Object.entries` atrás de string vazia.
------------------------------------------------------------------------- */

const pt = {
  rotulo: "Blog",
  titulo: "O caderno ainda está em branco.",
  texto: "Nenhum texto publicado até agora. Quando o primeiro sair, ele aparece aqui.",
  carimbo: "Em breve",
  /** Rótulo do landmark da lista de posts. Só existe quando há post. */
  listaRotulo: "Últimos textos",
};

export type TextosDoBlog = typeof pt;

const en: TextosDoBlog = {
  rotulo: "Blog",
  titulo: "The notebook is still blank.",
  texto: "Nothing published yet. When the first piece goes out, it shows up here.",
  carimbo: "Coming soon",
  listaRotulo: "Latest posts",
};

const es: TextosDoBlog = {
  rotulo: "Blog",
  titulo: "El cuaderno todavía está en blanco.",
  texto:
    "Todavía no publicamos ningún texto. Cuando salga el primero, aparece aquí.",
  carimbo: "Muy pronto",
  listaRotulo: "Últimos textos",
};

const TEXTOS: Record<Locale, TextosDoBlog> = { pt, en, es };

export function textosDoBlog(locale: Locale): TextosDoBlog {
  return TEXTOS[locale];
}
