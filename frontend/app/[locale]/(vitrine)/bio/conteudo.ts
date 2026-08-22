import type { Locale } from "../../../../lib/i18n/tipos";

/**
 * O conteúdo da /bio — a página de link do Instagram.
 *
 * DESTINO E RÓTULO FICAM SEPARADOS, e é a decisão que dá forma a este arquivo.
 * A tradução mexe em texto; a URL é a mesma nos três idiomas. Se cada idioma
 * carregasse a própria lista de links, bastaria uma tradução distraída para o
 * espanhol apontar para o lugar errado — e ninguém revisita a /bio em espanhol
 * para descobrir. Aqui o endereço existe UMA vez, em `PRINCIPAIS`, e o idioma
 * só decide como ele se chama.
 */

/** Os quatro caminhos que a marca quer que o visitante do Instagram tome. */
export const PRINCIPAIS = [
  {
    id: "loja",
    /**
     * INTERNO, e sem UTM de propósito. O original do site institucional
     * apontava para `loja.cafecanastra.com/?utm_campaign=lojaonline` porque a
     * loja era outro domínio; depois da fusão ela é esta aplicação, e o
     * caminho é `/cafes`. A campanha já foi contada quando a pessoa abriu a
     * /bio pelo Instagram — carimbá-la de novo aqui abriria uma sessão nova
     * no meio da visita.
     */
    href: "/cafes",
  },
  {
    id: "privateLabel",
    href: "https://atacado.cafecanastra.com/terceirizacaocafe?utm_source=instagram&utm_medium=linkbio&utm_campaign=privatelabel",
  },
  {
    id: "atacado",
    href: "https://atacado.cafecanastra.com/cafeatacado?utm_source=instagram&utm_medium=linkbio&utm_campaign=atacado",
  },
  {
    /**
     * Mesma página do atacado, campanha diferente — é assim no institucional.
     * O que muda é a porta de entrada, não o destino; a marca separa os dois
     * públicos pela UTM.
     */
    id: "assinaturaEmpresa",
    href: "https://atacado.cafecanastra.com/cafeatacado?utm_source=instagram&utm_medium=linkbio&utm_campaign=assinatura",
  },
] as const;

/**
 * Os três atalhos de marca, todos internos.
 *
 * O QUE SAIU DA LISTA DO INSTITUCIONAL, E POR QUÊ:
 *
 *   - **Site** (`cafecanastra.com`) — era um link para o outro site. Este
 *     projeto funde os dois: a partir daqui, o site É esta aplicação, e a
 *     decisão de domínio está adiada (spec §"Domínio"). Um link cravado no
 *     domínio antigo seria a única linha do repositório a afirmar qual é o
 *     endereço final.
 *   - **Blog** — existe só como seção "Em breve" na home (spec §4). Página de
 *     link de Instagram tem quatro segundos de atenção; gastá-los levando a
 *     pessoa a uma promessa vazia é pior do que não oferecer o link.
 *
 * No lugar entraram três páginas que existem e têm conteúdo.
 */
export const SECUNDARIOS = [
  { id: "historia", href: "/historia" },
  { id: "aSerra", href: "/a-serra" },
  { id: "clube", href: "/clube" },
] as const;

export type IdPrincipal = (typeof PRINCIPAIS)[number]["id"];
export type IdSecundario = (typeof SECUNDARIOS)[number]["id"];

/** Absoluto é de fora; com barra inicial é desta casa. */
export function ehExterno(href: string): boolean {
  return /^https?:\/\//i.test(href);
}

/**
 * O domínio de um destino externo, para mostrar ANTES do clique.
 *
 * Não é enfeite: é a diferença entre "abre uma aba" e "abre uma aba num site
 * que não é este". Quem toca num link de bio no telefone não vê barra de
 * status nem status bar de hover — se o bloco não disser para onde vai, nada
 * diz. Caminho interno devolve vazio, e o chamador não desenha o aviso.
 */
export function hospedeiroDe(href: string): string {
  if (!ehExterno(href)) return "";
  // Corta no primeiro `/`, `?` ou `#`: sem o `?` na lista, uma URL sem
  // caminho ("https://exemplo.com?x=1") mostraria a querystring inteira como
  // se fosse o domínio.
  return href.replace(/^https?:\/\//i, "").split(/[/?#]/)[0];
}

/**
 * O texto de cada bloco, por idioma.
 *
 * A trava é a mesma do lib/i18n/dicionario.ts: `pt` é a fonte do tipo, `en` e
 * `es` são DECLARADOS como `TextosDaBio`, e chave faltando quebra o build. Não
 * fica no dicionário de interface porque aquele arquivo é de rótulo repetido
 * de navegação; isto aqui é conteúdo de uma página só — e a Onda 3C é dona dos
 * arquivos de conteúdo criados nesta onda.
 *
 * NENHUMA DATA NA CHAMADA, e é deliberado: o "desde 1985" que o institucional
 * usa ao lado de "Serra da Canastra" é justamente o erro factual que o spec §3
 * manda corrigir — a lavoura de 1985 é de Patrocínio, no Cerrado; a Canastra
 * vem de 2008. Enquanto a frase certa não existir escrita em algum lugar do
 * repositório, esta página não repete a errada.
 */
const pt = {
  titulo: "Links — Café Canastra",
  descricao:
    "Todos os caminhos do Café Canastra num lugar só: a loja, o café no atacado, a marca própria e a assinatura para empresas.",
  tagline: "Torrado sob demanda",
  local: "Serra da Canastra · Minas Gerais",
  chamadaPrincipais: "Por onde você quer entrar",
  chamadaSecundarios: "Conheça a Canastra",
  saiDoSite: "sai do site",
  /** Só para leitor de tela — o aviso visível é o domínio ao lado. */
  abreEmOutraAba: "abre em outra aba",
  principais: {
    loja: { rotulo: "Loja online", apoio: "Comprar em grãos ou moído" },
    privateLabel: {
      rotulo: "Quero minha marca própria",
      apoio: "Private Label: nosso café, o seu rótulo",
    },
    atacado: {
      rotulo: "Sou dono de cafeteria",
      apoio: "Comprar no atacado, por volume",
    },
    assinaturaEmpresa: {
      rotulo: "Quero assinatura para minha empresa",
      apoio: "Café recorrente para o escritório",
    },
  },
  secundarios: {
    historia: "História",
    aSerra: "A Serra",
    clube: "Clube",
  },
};

/**
 * SEM `as const` acima, pelo mesmo motivo do dicionário: o que se quer travar
 * é o conjunto de chaves, não o texto — com literais, `en` só compilaria
 * repetindo o português.
 */
export type TextosDaBio = typeof pt;

const en: TextosDaBio = {
  titulo: "Links — Café Canastra",
  descricao:
    "Every way into Café Canastra in one place: the online store, wholesale coffee, private label and coffee subscriptions for companies.",
  tagline: "Roasted to order",
  local: "Serra da Canastra · Minas Gerais, Brazil",
  chamadaPrincipais: "Where do you want to start",
  chamadaSecundarios: "About Canastra",
  saiDoSite: "leaves this site",
  abreEmOutraAba: "opens in a new tab",
  principais: {
    loja: { rotulo: "Online store", apoio: "Buy whole bean or ground" },
    privateLabel: {
      rotulo: "I want my own brand",
      apoio: "Private label: our coffee, your name on it",
    },
    atacado: {
      rotulo: "I run a coffee shop",
      apoio: "Buy wholesale, in volume",
    },
    assinaturaEmpresa: {
      rotulo: "I want a subscription for my company",
      apoio: "Recurring coffee for the office",
    },
  },
  secundarios: {
    historia: "Our story",
    aSerra: "The Serra",
    clube: "The Club",
  },
};

const es: TextosDaBio = {
  titulo: "Enlaces — Café Canastra",
  descricao:
    "Todos los caminos del Café Canastra en un solo lugar: la tienda, el café al por mayor, la marca propia y la suscripción para empresas.",
  tagline: "Tostado bajo pedido",
  local: "Serra da Canastra · Minas Gerais, Brasil",
  chamadaPrincipais: "Por dónde quiere empezar",
  chamadaSecundarios: "Conozca la Canastra",
  saiDoSite: "sale de este sitio",
  abreEmOutraAba: "abre en otra pestaña",
  principais: {
    loja: { rotulo: "Tienda online", apoio: "Comprar en grano o molido" },
    privateLabel: {
      rotulo: "Quiero mi marca propia",
      apoio: "Private label: nuestro café, su etiqueta",
    },
    atacado: {
      rotulo: "Tengo una cafetería",
      apoio: "Comprar al por mayor, por volumen",
    },
    assinaturaEmpresa: {
      rotulo: "Quiero suscripción para mi empresa",
      apoio: "Café recurrente para la oficina",
    },
  },
  secundarios: {
    historia: "Historia",
    aSerra: "La sierra",
    clube: "El Club",
  },
};

const POR_IDIOMA: Record<Locale, TextosDaBio> = { pt, en, es };

export function textosDaBio(locale: Locale): TextosDaBio {
  return POR_IDIOMA[locale];
}
