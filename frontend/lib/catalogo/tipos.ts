export type Linha =
  | "classico"
  | "suave"
  | "canela"
  | "microlote"
  | "nectar-de-minas";

/** Como o café sai da torrefação. É o eixo de variação real do catálogo. */
export type Formato = "graos" | "moido" | "drip" | "capsula";

export type Moagem =
  | "grao" | "espresso" | "coado-papel" | "coador-pano"
  | "prensa-francesa" | "italiana-moka" | "aeropress";

export type Metodo = Exclude<Moagem, "grao">;

export type PesoGramas = 250 | 500 | 1000;

export type Imagem = { src: string; alt: string; w: number; h: number };

/**
 * Uma combinação comprável.
 *
 * A loja real vende dois formatos de café em pacote — "em grãos" e "moído" — e
 * NÃO vende uma moagem por método. Quem escolhe o método aqui está escolhendo
 * como o mesmo SKU moído será moído no momento do pedido, que é o serviço que a
 * casa já anuncia ("moído na hora do pedido"). Por isso todas as variantes
 * moídas de um mesmo peso compartilham `skuLoja`, preço e estoque: é um produto
 * só no estoque, com um pedido de moagem junto.
 */
export type Variante = {
  /** Chave da combinação nesta vitrine. */
  sku: string;
  /** SKU correspondente na loja real — a rastreabilidade do dado. */
  skuLoja: string;
  /**
   * `product_id` da linha no banco. Chega junto com preco e estoque quando a
   * API responde; fica indefinido no modo de contingencia (so JSON). E o que o
   * carrinho precisa para falar com o backend — sem ele, da para navegar mas
   * nao da para comprar.
   */
  produtoId?: string;
  formato: Formato;
  moagem: Moagem;
  pesoGramas: PesoGramas;
  /** 1 = pacote avulso; >1 = caixa fechada. */
  pacotes: number;
  rotuloEmbalagem: string;
  /** Em centavos. 3970 = R$ 39,70 */
  preco: number;
  estoque: number;
};

/**
 * Drip coffee e cápsula não entram na matriz moagem × peso — não têm peso de
 * pacote nem moagem a escolher. Ficam numa lista à parte na PDP em vez de serem
 * espremidos num seletor que não os descreve.
 */
export type FormatoEspecial = {
  sku: string;
  skuLoja: string;
  produtoId?: string;
  formato: Extract<Formato, "drip" | "capsula">;
  nome: string;
  rotuloEmbalagem: string;
  unidades: number;
  /** Em centavos. 0 quando a loja não exibe preço por estar esgotado. */
  preco: number;
  estoque: number;
};

/**
 * Caixa que mistura linhas — o kit não é variante de PDP nenhuma (uma caixa
 * com um pacote de cada linha não pertence a nenhuma delas), então ganha um
 * tipo próprio e uma superfície própria na PLP ("Kits e caixas").
 *
 * Mesmos nomes de campo comercial da `Variante` (`preco`, `estoque`,
 * `produtoId`, `skuLoja`) DE PROPÓSITO: é o que deixa o kit passar pelo mesmo
 * mecanismo de dados ao vivo do repositório sem contrato paralelo.
 */
export type Kit = {
  sku: string;
  skuLoja: string;
  produtoId?: string;
  nome: string;
  rotuloEmbalagem: string;
  formato: Formato;
  /** Linha "dominante" do kit no catálogo — define fita de cor e imagem. */
  linha: Linha;
  /** Arte da linha dominante — os kits não têm foto própria no acervo. */
  imagem: string;
  /** Em centavos. 0 quando a loja não exibe preço por estar esgotado. */
  preco: number;
  estoque: number;
  /** Quantos pacotes/caixas dentro do kit. */
  pacotes: number;
  /** Unidades (sachês, cápsulas) quando o formato conta por unidade. */
  unidades?: number;
};

export type Preparo = {
  metodo: Metodo;
  proporcao: string;
  gramas: number;
  ml: number;
  temperaturaC: number;
  tempoSegundos: number;
  moagem: string;
};

/**
 * Origem do café.
 *
 * Substitui a antiga `Lavoura`, que trazia altitude, produtor e safra POR LOTE.
 * Aqueles campos eram inventados: o Café Canastra vende linhas de blend com
 * origem única na Serra da Canastra, não micro-lotes rastreados por sítio. Um
 * "Sítio Boa Vista a 1.320 m" que não existe é pior do que não ter o campo —
 * estetica.md §6 é explícito de que dado de origem falso derruba a credibilidade
 * exatamente onde a marca tenta ganhá-la.
 *
 * O que ficou aqui é o que a marca de fato afirma, e vale para toda a coleção.
 */
export type Origem = {
  regiao: string;
  estado: string;
  variedades: string[];
  atributos: string[];
};

export type Lote = {
  slug: string;
  nome: string;
  linha: Linha;
  notas: string[];
  pontoTorra: 1 | 2 | 3 | 4 | 5;
  /**
   * A embalagem declara "SCA 80+", que é um piso e não uma nota exata. Guardar
   * 80 e exibir "80+" é o que a lata diz; o mock antigo exibia 84,25 e 85,50,
   * números que nenhuma prova de xícara produziu.
   */
  sca: number;
  descricao: string;
  torra: string;
  corpo: string;
  preparoSugerido: string;
  origem: Origem;
  fotos: { sabor: Imagem; pacote: Imagem; terreiro?: Imagem; moido?: Imagem };
  variantes: Variante[];
  formatosEspeciais: FormatoEspecial[];
  preparo: Preparo[];
  assinatura?: { desconto: number; frequenciasDias: number[] };
};

export type Filtros = {
  linha?: Linha;
  pontoTorraMin?: number;
  pontoTorraMax?: number;
  notas?: string[];
  moagem?: Moagem;
  formato?: Formato;
  /** Filtro "Formato" do §7.2. */
  pesoGramas?: PesoGramas;
  /** Esconde o que está esgotado em todas as combinações. */
  soDisponiveis?: boolean;
};

/**
 * `notas` e AND, nao OR: marcar "rapadura" e "cacau" traz so os lotes que tem
 * as duas. Facetas de PLP costumam ser OR, entao a escolha e deliberada — aqui
 * a nota e uma promessa sobre a xicara, e quem marca duas quer as duas. Se o
 * comportamento mudar, `repositorio.test.ts` falha de proposito.
 */
export type Ordenacao =
  | "relevancia"
  | "preco-asc"
  | "preco-desc"
  | "torra-asc"
  | "torra-desc";

export const ORDENACOES: { valor: Ordenacao; rotulo: string }[] = [
  { valor: "relevancia", rotulo: "Relevância" },
  { valor: "preco-asc", rotulo: "Menor preço" },
  { valor: "preco-desc", rotulo: "Maior preço" },
  { valor: "torra-asc", rotulo: "Torra mais clara" },
  { valor: "torra-desc", rotulo: "Torra mais escura" },
];

export const MOAGENS: { valor: Moagem; rotulo: string }[] = [
  { valor: "grao", rotulo: "Grão" },
  { valor: "espresso", rotulo: "Espresso" },
  { valor: "coado-papel", rotulo: "Coado (papel)" },
  { valor: "coador-pano", rotulo: "Coador de pano" },
  { valor: "prensa-francesa", rotulo: "Prensa francesa" },
  { valor: "italiana-moka", rotulo: "Italiana / Moka" },
  { valor: "aeropress", rotulo: "Aeropress" },
];

export const FORMATOS: { valor: Formato; rotulo: string }[] = [
  { valor: "graos", rotulo: "Em grãos" },
  { valor: "moido", rotulo: "Moído" },
  { valor: "drip", rotulo: "Drip Coffee" },
  { valor: "capsula", rotulo: "Cápsulas" },
];
