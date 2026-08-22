import type { Locale } from "../../../../lib/i18n/tipos";

/**
 * O conteúdo da /a-serra.
 *
 * ESTA PÁGINA AFIRMAVA DUAS COISAS FALSAS, e este arquivo é onde elas foram
 * corrigidas:
 *
 *   1. **"Quarenta anos na mesma serra."** Não são. A família Boaventura
 *      plantou o primeiro pé em 1985 em PATROCÍNIO, no Chapadão de Ferro —
 *      cerrado mineiro — e só chegou à Serra da Canastra em 2008. São quarenta
 *      anos de café e dezoito de Canastra. Fonte: a própria história da marca,
 *      publicada em cafecanastra.com/historia.
 *   2. **A altitude "entre 900 e 1.320 metros"**, que estava na home. Não tem
 *      fonte nenhuma. Cai pela mesma regra que apagou o tipo `Lavoura` do
 *      catálogo — ver o comentário de `Origem` em lib/catalogo/tipos.ts. O que
 *      a marca afirma sobre a Canastra é qualitativo ("dias quentes, noites
 *      frias, maturação lenta"), e é só isso que a página diz.
 *
 * DADO SEPARADO DE TEXTO, como em /bio: as datas são as mesmas nos três
 * idiomas, então vivem fora da tabela de tradução. Uma tradução distraída não
 * deve conseguir mudar um fato.
 *
 * AS VARIEDADES NÃO ESTÃO AQUI, e isso foi uma escolha. Elas são Araras,
 * Caturra 2SL e Paraíso — como a marca as declara na própria história ("é lá
 * que cultivamos variedades nobres como…") — e vivem em `marca.variedades`,
 * dentro de data/catalogo-canastra.json, que é a mesma fonte que alimenta o
 * seed do banco. A página as lê de lá. Guardar uma segunda cópia aqui daria
 * dois lugares para a mesma afirmação, que é exatamente como a versão errada
 * de "quarenta anos na mesma serra" sobreviveu tanto tempo.
 *
 * IMPORT RELATIVO, não `@/`: o vitest.config.ts não resolve o alias, e este
 * módulo é importado pelo teste ao lado (mesma nota de lib/i18n/rotas.ts).
 */

/**
 * As duas datas, juntas, em três caracteres de diferença. É a correção inteira
 * dita de uma vez — e é por isso que elas são um dado só e não duas linhas de
 * texto que a tradução possa separar.
 */
export const MARCO_DE_ORIGEM = "1985 → 2008";

/* -------------------------------------------------------------------------
   Os textos, nos três idiomas.

   Mesma trava do lib/i18n/dicionario.ts: `pt` é a fonte do tipo, `en` e `es`
   são DECLARADOS como `TextosDaSerra`, e chave faltante quebra o build em vez
   de virar `undefined` na tela. Objeto raso de propósito — o teste ao lado
   varre `Object.values` atrás de altitude inventada e de 1985 desacompanhado.
------------------------------------------------------------------------- */

const pt = {
  metaTitulo: "A Serra",
  metaDescricao:
    "Café de família desde 1985, na Serra da Canastra desde 2008. O território, as variedades e a torra de cada linha.",

  heroiRotulo: "O território",
  heroiTitulo: "A serra faz o café.",
  heroiTexto:
    "Nascente do São Francisco, escarpa da Casca d'Anta, estrada de terra vermelha. É onde a lavoura fica desde 2008 — e é isso que a xícara mostra.",

  origemTitulo: "Quarenta anos de café, dezoito na Canastra",
  origemP1:
    "A família Boaventura plantou o primeiro pé em 1985, em Patrocínio, no Chapadão de Ferro. Cerrado mineiro, não Canastra: foi ali que Conceição e Belchior começaram, num sítio pequeno.",
  origemP2:
    "A Serra da Canastra veio em 2008, na procura por um terroir mais alto. Dias quentes, noites frias, maturação lenta — é de lá que sai o café desta loja.",
  origemLink: "Ver a história completa",
  imagemAlt: "Dois produtores entre as fileiras de café, no fim da tarde",

  torraTitulo: "Da torra clara à escura",
  torraTexto:
    "Torra mais clara guarda a fruta e a acidez do grão; mais escura traz corpo, cacau e amargor. Nenhuma das duas é melhor — são xícaras diferentes, e a serra dá conta das duas.",
  variedadesRotulo: "As variedades da Canastra",
  /** Sufixo da escala de torra: "3 de 5". */
  pontoDeCinco: "de 5",

  aTorraRotulo: "A torra",
  aTorraTitulo: "Em lotes pequenos, sob demanda",
  aTorraTexto:
    "Torramos na terça e enviamos na quarta. Café torrado há três semanas já não é o mesmo café — por isso não mantemos estoque torrado parado.",

  rastreioTitulo: "Dá para conferir a origem.",
  rastreioTexto:
    "O registro do produtor fica numa base do Cerrado Mineiro, mantida fora deste site.",
  rastreioLink: "Como conferir",
};

export type TextosDaSerra = typeof pt;

const en: TextosDaSerra = {
  metaTitulo: "The Serra",
  metaDescricao:
    "A family coffee since 1985, in the Serra da Canastra since 2008. The land, the varieties and the roast of each line.",

  heroiRotulo: "The land",
  heroiTitulo: "The serra makes the coffee.",
  heroiTexto:
    "The headwaters of the São Francisco, the Casca d'Anta escarpment, red dirt roads. This is where the farm has been since 2008 — and it is what the cup shows.",

  origemTitulo: "Forty years of coffee, eighteen in the Canastra",
  origemP1:
    "The Boaventura family planted their first coffee trees in 1985, in Patrocínio, on the Chapadão de Ferro. Cerrado Mineiro, not Canastra: that is where Conceição and Belchior started, on a small plot.",
  origemP2:
    "The Serra da Canastra came in 2008, in search of higher ground. Warm days, cold nights, slow ripening — that is where the coffee in this store comes from.",
  origemLink: "Read the full story",
  imagemAlt: "Two growers between the coffee rows, late in the afternoon",

  torraTitulo: "From light roast to dark",
  torraTexto:
    "A lighter roast keeps the fruit and the acidity of the bean; a darker one brings body, cocoa and bitterness. Neither is better — they are different cups, and the serra handles both.",
  variedadesRotulo: "The Canastra varieties",
  pontoDeCinco: "of 5",

  aTorraRotulo: "The roast",
  aTorraTitulo: "Small batches, roasted to order",
  aTorraTexto:
    "We roast on Tuesday and ship on Wednesday. Coffee roasted three weeks ago is no longer the same coffee — which is why we keep no roasted stock sitting around.",

  rastreioTitulo: "The origin can be checked.",
  rastreioTexto:
    "The grower record sits in a Cerrado Mineiro database, kept outside this site.",
  rastreioLink: "How to check",
};

const es: TextosDaSerra = {
  metaTitulo: "La Serra",
  metaDescricao:
    "Café de familia desde 1985, en la Serra da Canastra desde 2008. El territorio, las variedades y el tueste de cada línea.",

  heroiRotulo: "El territorio",
  heroiTitulo: "La serra hace el café.",
  heroiTexto:
    "Nacimiento del São Francisco, escarpa de Casca d'Anta, camino de tierra roja. Ahí está el cafetal desde 2008 — y es eso lo que muestra la taza.",

  origemTitulo: "Cuarenta años de café, dieciocho en la Canastra",
  origemP1:
    "La familia Boaventura plantó los primeros cafetos en 1985, en Patrocínio, en el Chapadão de Ferro. Cerrado mineiro, no Canastra: ahí empezaron Conceição y Belchior, en una finca pequeña.",
  origemP2:
    "La Serra da Canastra llegó en 2008, buscando un terroir más alto. Días cálidos, noches frías, maduración lenta — de ahí sale el café de esta tienda.",
  origemLink: "Ver la historia completa",
  imagemAlt: "Dos productores entre las hileras de café, al final de la tarde",

  torraTitulo: "Del tueste claro al oscuro",
  torraTexto:
    "Un tueste más claro guarda la fruta y la acidez del grano; uno más oscuro trae cuerpo, cacao y amargor. Ninguno es mejor — son tazas distintas, y la serra da para las dos.",
  variedadesRotulo: "Las variedades de la Canastra",
  pontoDeCinco: "de 5",

  aTorraRotulo: "El tueste",
  aTorraTitulo: "En lotes pequeños, bajo pedido",
  aTorraTexto:
    "Tostamos el martes y enviamos el miércoles. Un café tostado hace tres semanas ya no es el mismo café — por eso no guardamos tueste parado.",

  rastreioTitulo: "El origen se puede verificar.",
  rastreioTexto:
    "El registro del productor está en una base del Cerrado Mineiro, mantenida fuera de este sitio.",
  rastreioLink: "Cómo verificar",
};

const TEXTOS: Record<Locale, TextosDaSerra> = { pt, en, es };

export function textosDaSerra(locale: Locale): TextosDaSerra {
  return TEXTOS[locale];
}
