import { type Locale } from "../../../../lib/i18n/tipos";

/**
 * O texto da /historia nos três idiomas.
 *
 * POR QUE UM MÓDULO SÓ, E NÃO `lib/i18n/dicionario.ts`: o dicionário guarda
 * RÓTULO de interface — "Cafés", "Sacola", "Ver os cafés" — e o comentário no
 * topo dele diz isso com todas as letras ("o que NÃO entra: [...] o texto
 * corrido das páginas institucionais, que é conteúdo e não rótulo"). Despejar
 * doze parágrafos de história lá dentro faria o arquivo mais compartilhado do
 * site crescer para 20 KB por causa de uma página só, e obrigaria a Onda 3A a
 * traduzir prosa no meio dos rótulos. Aqui o conteúdo mora ao lado da página
 * que o consome, e some junto com ela se um dia a página sair.
 *
 * O TEXTO EM `en` E `es` JÁ ESTÁ TRADUZIDO — veio pronto do site institucional
 * (`app/en/historia/page.tsx` e `app/es/historia/page.tsx` de
 * github.com/Kmzf777/cafecanastrablog), não de tradução automática. A Onda 3
 * não precisa plugar nada nesta página: precisa revisar, se quiser.
 *
 * IMPORT RELATIVO, não `@/`: o vitest.config.ts não resolve o alias, e este
 * módulo tem teste (mesma nota de lib/i18n/rotas.ts).
 */

/** Um tempo da linha do tempo. O ano é dado; o resto é prosa. */
type Registro = {
  /**
   * O `id` da seção e o alvo do índice do topo. É o MESMO nos três idiomas de
   * propósito: `/en/historia#ano-2008` tem de cair no mesmo registro que
   * `/historia#ano-2008`, senão um link compartilhado quebra na troca de
   * idioma. Prefixado com `ano-` porque `id="1985"` é válido em HTML5 mas
   * exige escape em `querySelector`, e ninguém lembra disso na hora errada.
   */
  ancora: string;
  /** "1985" … "Hoje". Sai em Martian Mono — estetica.md §4.2. */
  rotuloDoAno: string;
  titulo: string;
  paragrafos: string[];
};

type ConteudoHistoria = {
  meta: { titulo: string; descricao: string };
  /** Kicker em caixa alta acima do H1. */
  rotulo: string;
  titulo: string;
  /** A frase de abertura do institucional, mantida como epígrafe. */
  epigrafe: string;
  /** Rótulo acessível do índice de anos do topo. */
  indice: string;
  registros: Registro[];
  /**
   * Os destinos da exportação direta saem da prosa e viram lista por uma razão
   * de projeto: são o dado mais concreto da página, e dado enterrado no meio de
   * um parágrafo não é lido — vira adjetivo. Em lista, "exportação direta"
   * deixa de ser promessa e passa a ser verificável.
   *
   * A `nota` existe porque a fonte diz "entre outros". Sem ela, uma lista de
   * seis passaria a afirmar que são exatamente seis — e ninguém verificou isso.
   */
  exportacao: { rotulo: string; destinos: string[]; nota: string };
  /** O fecho editorial, em Redaction sobre superfície clara. */
  fecho: string;
};

/**
 * A ordem canônica dos registros, fora do conteúdo traduzido porque ela é
 * estrutura, não texto. O teste compara os três idiomas contra esta lista — é
 * o que impede um idioma de perder um tempo da história em silêncio.
 */
export const ANCORAS_DOS_REGISTROS = [
  "ano-1985",
  "ano-1996",
  "ano-2008",
  "ano-2016",
  "hoje",
] as const;

const pt: ConteudoHistoria = {
  meta: {
    titulo: "História — Café Canastra",
    descricao:
      "De um sítio em Patrocínio, em 1985, à Serra da Canastra e à exportação direta. A história da família Boaventura em cinco tempos.",
  },
  rotulo: "Três gerações",
  titulo: "Um legado em cada grão.",
  epigrafe: "Tudo começou com um sonho e um pedaço de terra fértil.",
  indice: "Ir para um ano",
  registros: [
    {
      ancora: "ano-1985",
      rotuloDoAno: "1985",
      titulo: "O início do sonho",
      paragrafos: [
        "Em 1985, no coração do cerrado mineiro, mais precisamente no lendário Chapadão de Ferro, nascia a paixão da família Boaventura pelo café. Foi ali, num pequeno sítio em Patrocínio, Minas Gerais, que a Sra. Conceição e o Sr. Belchior Boaventura decidiram plantar seus primeiros pés de café.",
        "Mais do que um cultivo, aquele era o início de um legado.",
      ],
    },
    {
      ancora: "ano-1996",
      rotuloDoAno: "1996",
      titulo: "Foco na excelência",
      paragrafos: [
        "Em 1996, o café ganhou novo propósito. Silvio Boaventura, filho do casal, enxergou além da tradição. Com um olhar atento ao futuro, percebeu que o mundo queria mais do que café — queria qualidade.",
        "Foi assim que a família trocou o foco da quantidade pela excelência, iniciando uma nova era voltada para mercados exigentes como os Estados Unidos, o Japão e a Europa.",
      ],
    },
    {
      ancora: "ano-2008",
      rotuloDoAno: "2008",
      titulo: "A descoberta da Canastra",
      paragrafos: [
        "2008 marcou uma virada: novos horizontes, novos aromas. O reconhecimento pelos cafés especiais da família crescia, e com ele a vontade de expandir. Na busca por um terroir único, encontramos o lugar: a Serra da Canastra, em Minas Gerais.",
        "A região não é apenas bonita — ela é generosa com o café. Altitudes entre as mais elevadas do país, regime de chuvas homogêneo, dias quentes e noites frias. O grão amadurece devagar, e é isso que intensifica a doçura natural e a complexidade sensorial.",
        "É lá que cultivamos variedades como Araras, Caturra 2SL e Paraíso, conhecidas por grãos maiores, mais densos e mais aromáticos.",
      ],
    },
    {
      ancora: "ano-2016",
      rotuloDoAno: "2016",
      titulo: "Do grão à xícara",
      paragrafos: [
        "Em 2016, a terceira geração entrou em cena. Arthur Boaventura assumiu a gestão da torrefação e, com ela, começou uma nova fase do nosso propósito: levar o café direto da fazenda até a mesa, sem intermediários.",
        "Nasceu o Café Canastra, a marca que expressa o que somos: tradição, inovação, sustentabilidade e respeito.",
      ],
    },
    {
      ancora: "hoje",
      rotuloDoAno: "Hoje",
      titulo: "Da serra para o mundo",
      paragrafos: [
        "Além do café torrado — em grãos, moído e em cápsulas —, esta fase marcou o início da exportação direta. Os cafés da família Boaventura saem da Serra da Canastra e chegam a torrefações fora do Brasil.",
        "E não paramos aí: ajudamos outros produtores a lançar as próprias marcas, com o serviço de private label — a mesma qualidade que cultivamos há gerações, com o nome deles no pacote.",
      ],
    },
  ],
  exportacao: {
    rotulo: "Para onde exportamos",
    destinos: [
      "Chile",
      "Argentina",
      "Estados Unidos",
      "Irlanda",
      "Holanda",
      "Emirados Árabes Unidos",
    ],
    nota: "entre outros",
  },
  fecho:
    "De grão em grão, o que começou como um sonho de família virou uma marca com alma, aroma e propósito.",
};

const en: ConteudoHistoria = {
  meta: {
    titulo: "Our History — Café Canastra",
    descricao:
      "From a smallholding in Patrocínio in 1985 to the Serra da Canastra and direct export. The Boaventura family story, in five chapters.",
  },
  rotulo: "Three generations",
  titulo: "A legacy in every bean.",
  epigrafe: "It all started with a dream and a piece of fertile land.",
  indice: "Jump to a year",
  registros: [
    {
      ancora: "ano-1985",
      rotuloDoAno: "1985",
      titulo: "The beginning of a dream",
      paragrafos: [
        "In 1985, in the heart of the Minas Gerais cerrado — more precisely in the legendary Chapadão de Ferro — the Boaventura family's passion for coffee was born. It was there, on a small farm in Patrocínio, Minas Gerais, that Mrs. Conceição and Mr. Belchior Boaventura decided to plant their first coffee trees.",
        "More than a crop, that was the beginning of a legacy.",
      ],
    },
    {
      ancora: "ano-1996",
      rotuloDoAno: "1996",
      titulo: "Focus on excellence",
      paragrafos: [
        "In 1996, coffee gained a new purpose. Silvio Boaventura, the couple's son, saw beyond tradition. With a keen eye on the future, he realized that the world wanted more than coffee — it wanted quality.",
        "That is how the family shifted focus from quantity to excellence, starting a new era aimed at demanding markets such as the United States, Japan and Europe.",
      ],
    },
    {
      ancora: "ano-2008",
      rotuloDoAno: "2008",
      titulo: "Discovering the Canastra",
      paragrafos: [
        "2008 marked a turning point: new horizons, new aromas. Recognition for the family's specialty coffees was growing, and with it the desire to expand. Searching for a unique terroir, we found the place: the Serra da Canastra, in Minas Gerais.",
        "This region is not merely beautiful — it is generous with coffee. Some of the highest altitudes in the country, a consistent rainfall regime, hot days and cold nights. The beans ripen slowly, and that is what intensifies their natural sweetness and sensory complexity.",
        "It is there that we grow varieties such as Araras, Caturra 2SL and Paraíso, known for larger, denser, more aromatic beans.",
      ],
    },
    {
      ancora: "ano-2016",
      rotuloDoAno: "2016",
      titulo: "From bean to cup",
      paragrafos: [
        "In 2016, the third generation stepped in. Arthur Boaventura took over the roastery and, with it, began a new phase of our purpose: taking coffee straight from the farm to the table, with no middlemen.",
        "Café Canastra was born, the brand that expresses what we are: tradition, innovation, sustainability and respect.",
      ],
    },
    {
      ancora: "hoje",
      rotuloDoAno: "Today",
      titulo: "From the Serra to the world",
      paragrafos: [
        "Beyond roasted coffee — whole bean, ground and in capsules — this phase marked the start of our direct export. The Boaventura family's coffees leave the Serra da Canastra and reach roasteries outside Brazil.",
        "And we do not stop there: we help other producers launch their own brands through our private label service — the same quality we have grown for generations, with their name on the bag.",
      ],
    },
  ],
  exportacao: {
    rotulo: "Where we export",
    destinos: [
      "Chile",
      "Argentina",
      "United States",
      "Ireland",
      "Netherlands",
      "United Arab Emirates",
    ],
    nota: "among others",
  },
  fecho:
    "Bean by bean, what started as a family dream became a brand with soul, aroma and purpose.",
};

const es: ConteudoHistoria = {
  meta: {
    titulo: "Nuestra Historia — Café Canastra",
    descricao:
      "De una finca en Patrocínio, en 1985, a la Serra da Canastra y a la exportación directa. La historia de la familia Boaventura en cinco tiempos.",
  },
  rotulo: "Tres generaciones",
  titulo: "Un legado en cada grano.",
  epigrafe: "Todo comenzó con un sueño y un pedazo de tierra fértil.",
  indice: "Ir a un año",
  registros: [
    {
      ancora: "ano-1985",
      rotuloDoAno: "1985",
      titulo: "El inicio del sueño",
      paragrafos: [
        "En 1985, en el corazón del cerrado de Minas Gerais, más precisamente en el legendario Chapadão de Ferro, nacía la pasión de la familia Boaventura por el café. Fue allí, en una pequeña finca en Patrocínio, Minas Gerais, donde la Sra. Conceição y el Sr. Belchior Boaventura decidieron plantar sus primeros cafetos.",
        "Más que un cultivo, aquel era el comienzo de un legado.",
      ],
    },
    {
      ancora: "ano-1996",
      rotuloDoAno: "1996",
      titulo: "Enfoque en la excelencia",
      paragrafos: [
        "En 1996, el café ganó un nuevo propósito. Silvio Boaventura, hijo de la pareja, vio más allá de la tradición. Con una mirada atenta al futuro, se dio cuenta de que el mundo quería más que café — quería calidad.",
        "Así fue como la familia cambió el enfoque de la cantidad por el de la excelencia, iniciando una nueva era dirigida a mercados exigentes como Estados Unidos, Japón y Europa.",
      ],
    },
    {
      ancora: "ano-2008",
      rotuloDoAno: "2008",
      titulo: "El descubrimiento de la Canastra",
      paragrafos: [
        "2008 marcó un giro: nuevos horizontes, nuevos aromas. El reconocimiento por los cafés especiales de la familia crecía, y con él el deseo de expandirse. En la búsqueda de un terroir único, encontramos el lugar: la Serra da Canastra, en Minas Gerais.",
        "Esta región no solo es hermosa — es generosa con el café. Altitudes entre las más elevadas del país, un régimen de lluvias homogéneo, días calurosos y noches frías. El grano madura despacio, y eso intensifica su dulzura natural y su complejidad sensorial.",
        "Es allí donde cultivamos variedades como Araras, Caturra 2SL y Paraíso, conocidas por sus granos más grandes, densos y aromáticos.",
      ],
    },
    {
      ancora: "ano-2016",
      rotuloDoAno: "2016",
      titulo: "Del grano a la taza",
      paragrafos: [
        "En 2016, la tercera generación entró en escena. Arthur Boaventura asumió la gestión del tostado y, con ella, comenzó una nueva fase de nuestro propósito: llevar el café directo de la finca a la mesa, sin intermediarios.",
        "Nació Café Canastra, la marca que expresa todo lo que somos: tradición, innovación, sostenibilidad y respeto.",
      ],
    },
    {
      ancora: "hoje",
      rotuloDoAno: "Hoy",
      titulo: "De la sierra al mundo",
      paragrafos: [
        "Además del café tostado — en grano, molido y en cápsulas —, esta fase marcó el inicio de la exportación directa. Los cafés de la familia Boaventura salen de la Serra da Canastra y llegan a tostadores fuera de Brasil.",
        "Y no paramos ahí: ayudamos a otros productores a lanzar sus propias marcas con el servicio de private label — la misma calidad que cultivamos desde hace generaciones, con su nombre en el paquete.",
      ],
    },
  ],
  exportacao: {
    rotulo: "Adónde exportamos",
    destinos: [
      "Chile",
      "Argentina",
      "Estados Unidos",
      "Irlanda",
      "Países Bajos",
      "Emiratos Árabes Unidos",
    ],
    nota: "entre otros",
  },
  fecho:
    "Grano a grano, lo que comenzó como un sueño familiar se convirtió en una marca con alma, aroma y propósito.",
};

export const HISTORIA: Record<Locale, ConteudoHistoria> = { pt, en, es };
