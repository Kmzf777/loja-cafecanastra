import { dicionario } from "../../../../lib/i18n/dicionario";
import { href } from "../../../../lib/i18n/rotas";
import type { Locale } from "../../../../lib/i18n/tipos";
import { lotesDoLocale } from "../../../../lib/catalogo/produtos";
import { COR_DA_LINHA, rotuloNota } from "../../../../lib/catalogo/rotulos";
import type { Linha } from "../../../../lib/catalogo/tipos";

/**
 * O conteúdo da PLP — os rótulos da própria página e o RESGATE da tela vazia.
 *
 * POR QUE ISTO NÃO ESTÁ EM lib/i18n/dicionario.ts. O dicionário diz no topo o
 * que aceita: navegação, rótulos de interface REPETIDOS e o vocabulário do
 * catálogo. "Torra mínima", "Ordenar por" e o texto da tela vazia existem numa
 * página só, e é o mesmo corte que a-serra, historia, bio e rastreabilidade já
 * seguem — cada página com o seu `conteudo.ts`. O que a PLP consome do
 * dicionário é o que de fato se repete: o nome das linhas, os pontos de torra,
 * os formatos e as ordenações, que também alimentam a PDP e os cards.
 *
 * A TRAVA É A MESMA DO DICIONÁRIO: `pt` é a fonte do tipo, `en` e `es` são
 * DECLARADOS como `TextosDaPlp`, e faltou chave o TypeScript quebra o build.
 * O teste ao lado cobra a outra metade — que o valor não seja o português
 * copiado.
 */

/* -------------------------------------------------------------------------
   O QUE A TELA VAZIA MOSTRA — E POR QUE ELE É DERIVADO, NUNCA ESCRITO À MÃO.

   O texto anterior sugeria procurar por "frutado" e afirmava que a casa ia
   "da torra média do Suave à média-escura do Clássico". As duas coisas eram
   falsas no mesmo dia em que foram lidas: nenhuma linha tem a nota `frutado`
   desde que o catálogo passou a usar as notas publicadas pela marca, e o
   Clássico virou `pontoTorra: 5` — torra escura — no mesmo diff.

   Uma tela vazia que sugere uma busca vazia é pior que nenhuma tela vazia: é
   o único lugar da PLP que existe para resgatar quem não achou nada, e ele
   devolvia a pessoa ao mesmo beco. Por isso nada aqui é citado à mão. As três
   funções abaixo leem o catálogo, e o teste ao lado prova que TODA sugestão
   que elas devolvem encontra pelo menos um café.
------------------------------------------------------------------------- */

/**
 * O ENDEREÇO VEM JUNTO COM O RÓTULO, e não é detalhe de organização: é o que
 * permite ao teste ao lado ABRIR cada sugestão — ler a querystring do chip,
 * rodar o filtro de verdade sobre o catálogo e provar que sobra café. Se a URL
 * fosse montada dentro do JSX, o teste só poderia conferir a lista de palavras
 * e a promessa "nenhum chip leva a outra tela vazia" ficaria sem prova.
 *
 * O caminho é sempre `/cafes` com UM parâmetro, nunca o filtro atual mais um:
 * de uma tela vazia, o resgate alarga; estreitar levaria ao mesmo lugar.
 */
export type Sugestao = {
  rotulo: string;
  /** Já passou por `href()`: sem prefixo em pt, com prefixo em en e es. */
  caminho: string;
};

/**
 * As linhas que existem de verdade, com a cor da própria embalagem.
 *
 * Sai dos LOTES e não da tabela `LINHAS` de propósito: a tabela é o contrato
 * de valores aceitos no filtro, e um valor sem lote correspondente viraria um
 * chip que leva a outra tela vazia. O que está aqui, está no catálogo.
 */
export function linhasDoCatalogo(
  locale: Locale,
): (Sugestao & { slug: Linha; cor: string })[] {
  const d = dicionario(locale);
  const vistas = new Set<Linha>();

  return lotesDoLocale(locale).flatMap((lote) => {
    if (vistas.has(lote.linha)) return [];
    vistas.add(lote.linha);
    return [
      {
        slug: lote.linha,
        rotulo: d.catalogo.linha[lote.linha],
        cor: COR_DA_LINHA[lote.linha],
        caminho: href(locale, `/cafes?linha=${lote.linha}`),
      },
    ];
  });
}

/**
 * As notas de xícara do catálogo, no idioma da página, sem repetição.
 *
 * DEVOLVE O RÓTULO, E É ELE QUE VAI PARA A QUERYSTRING. A chave crua
 * (`melaco`, `citrico`) daria uma URL mais curta e um chip "Busca: “melaco”"
 * sem cedilha na cara de quem lê em português. O rótulo casa igual, porque
 * `filtrarPorTexto` normaliza acento dos dois lados e o corpo de busca inclui
 * tanto a chave quanto o rótulo — e ainda aparece legível na barra de
 * endereços de quem compartilha o link.
 *
 * O editorial traduzido grava a nota já no idioma dele (`molasses`, `melaza`),
 * então esta lista muda de idioma junto com o catálogo, sem tabela paralela.
 */
export function notasDoCatalogo(locale: Locale): Sugestao[] {
  const vistas = new Set<string>();

  for (const lote of lotesDoLocale(locale)) {
    for (const nota of lote.notas) vistas.add(rotuloNota(nota, locale));
  }
  return [...vistas].map((rotulo) => ({
    rotulo,
    caminho: href(locale, `/cafes?q=${encodeURIComponent(rotulo)}`),
  }));
}

/**
 * Os dois extremos da escala de torra da casa, do catálogo.
 *
 * Aqui era a mentira mais cara: a frase citava "média-escura do Clássico" e o
 * Clássico é 5, torra escura. Um número lido do JSON não envelhece.
 *
 * Vive aqui e não em `repositorio.faixaTorra()` — que existe e faz o mesmo —
 * porque aquela é `async` (passa pelo caminho da API) e esta precisa ser pura
 * para o teste ao lado rodar em node sem tocar `fetch`.
 */
export function faixaDeTorraDoCatalogo(): { min: number; max: number } {
  const pontos = lotesDoLocale("pt").map((l) => l.pontoTorra);
  return { min: Math.min(...pontos), max: Math.max(...pontos) };
}

/* -------------------------------------------------------------------------
   Os textos, nos três idiomas.
------------------------------------------------------------------------- */

const pt = {
  metaTitulo: "Cafés — Café Canastra",
  /**
   * AS CINCO LINHAS, e não quatro: a descrição anterior listava Clássico,
   * Suave, Canela e Microlote e esquecia o Néctar de Minas, que é um SKU à
   * venda. "Moído na hora do pedido" também saiu — a casa promete torra sob
   * demanda, e prometer moagem sob demanda é uma afirmação a mais do que a
   * marca faz.
   */
  metaDescricao:
    "As linhas do Café Canastra: Clássico, Suave, Canela, Microlote e Néctar de Minas. Origem única da Serra da Canastra, em grãos ou moído.",

  filtroLinha: "Linha",
  filtroTorraMinima: "Torra mínima",
  filtroFormato: "Formato",
  filtroOrdem: "Ordenar por",
  /** A primeira opção de "Linha" — o filtro desligado. */
  opcaoTodas: "Todas",
  /** A primeira opção de "Torra mínima" e de "Formato". */
  opcaoQualquer: "Qualquer",
  soDisponiveisCampo: "Só o que está disponível",
  botaoFiltrar: "Filtrar",

  ativosRotulo: "Ativos:",
  /** Vem colado ao termo entre aspas: Busca: “chocolate”. */
  buscaChip: "Busca:",
  /** O mesmo filtro do campo acima, dito curto porque é chip. */
  soDisponiveisChip: "Só disponíveis",

  /** Vem colado ao termo entre aspas: Nenhum café para “xyz”. */
  vazioBuscaTitulo: "Nenhum café para",
  vazioFiltroTitulo: "Nenhum café com esses filtros.",
  /**
   * A promessa que o teste ao lado sustenta: qualquer chip desta tela devolve
   * café. Se um dia deixar de ser verdade, o teste fica vermelho antes de a
   * frase chegar ao cliente.
   */
  vazioLead:
    "O catálogo inteiro cabe nesta tela. Qualquer linha ou nota daqui devolve café.",
  vazioLinhasRotulo: "As linhas",
  vazioNotasRotulo: "As notas na xícara",
  vazioTorraRotulo: "A torra vai de",

  kitsTitulo: "Kits e caixas",
  kitsTexto:
    "Mais de uma linha na mesma caixa — para conhecer a casa inteira ou não escolher entre os favoritos.",
};

export type TextosDaPlp = typeof pt;

const en: TextosDaPlp = {
  metaTitulo: "Coffees — Café Canastra",
  metaDescricao:
    "The Café Canastra lines: Clássico, Suave, Canela, Microlote and Néctar de Minas. Single origin from the Serra da Canastra, whole bean or ground.",

  filtroLinha: "Line",
  filtroTorraMinima: "Minimum roast",
  filtroFormato: "Format",
  filtroOrdem: "Sort by",
  opcaoTodas: "All",
  opcaoQualquer: "Any",
  /** `In stock` é como uma loja escreve; `available` é jargão de sistema. */
  soDisponiveisCampo: "Only what is in stock",
  botaoFiltrar: "Filter",

  ativosRotulo: "Active:",
  buscaChip: "Search:",
  soDisponiveisChip: "In stock only",

  vazioBuscaTitulo: "No coffee for",
  vazioFiltroTitulo: "No coffee with those filters.",
  vazioLead:
    "The whole catalog fits on this screen. Any line or note here brings coffee back.",
  vazioLinhasRotulo: "The lines",
  vazioNotasRotulo: "Notes in the cup",
  vazioTorraRotulo: "Roast runs from",

  kitsTitulo: "Kits and boxes",
  kitsTexto:
    "More than one line in the same box — to get to know the whole house, or to not choose between favorites.",
};

const es: TextosDaPlp = {
  metaTitulo: "Cafés — Café Canastra",
  metaDescricao:
    "Las líneas de Café Canastra: Clássico, Suave, Canela, Microlote y Néctar de Minas. Origen único de la Serra da Canastra, en grano o molido.",

  filtroLinha: "Línea",
  filtroTorraMinima: "Tueste mínimo",
  filtroFormato: "Formato",
  filtroOrdem: "Ordenar por",
  opcaoTodas: "Todas",
  opcaoQualquer: "Cualquiera",
  soDisponiveisCampo: "Solo lo que está disponible",
  botaoFiltrar: "Filtrar",

  ativosRotulo: "Activos:",
  buscaChip: "Búsqueda:",
  soDisponiveisChip: "Solo disponibles",

  vazioBuscaTitulo: "Ningún café para",
  vazioFiltroTitulo: "Ningún café con esos filtros.",
  vazioLead:
    "El catálogo entero cabe en esta pantalla. Cualquier línea o nota de aquí devuelve café.",
  vazioLinhasRotulo: "Las líneas",
  vazioNotasRotulo: "Las notas en la taza",
  vazioTorraRotulo: "El tueste va de",

  kitsTitulo: "Kits y cajas",
  kitsTexto:
    "Más de una línea en la misma caja — para conocer la casa entera o no tener que elegir entre los favoritos.",
};

const TEXTOS: Record<Locale, TextosDaPlp> = { pt, en, es };

export function textosDaPlp(locale: Locale): TextosDaPlp {
  return TEXTOS[locale];
}
