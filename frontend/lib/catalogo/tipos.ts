export type Linha =
  | "classico"
  | "suave"
  | "canela"
  | "microlote"
  | "nectar-de-minas";

/** Como o café sai da torrefação. É o eixo de variação real do catálogo. */
export type Formato = "graos" | "moido" | "drip" | "capsula";

/**
 * O que se COMPRA. Dois valores, porque a loja vende dois.
 *
 * Eram SETE — `grao` mais os seis métodos de preparo — e o tipo respondia com
 * a mesma palavra a duas perguntas diferentes: o que entra no pacote, e como o
 * café vai ser feito em casa. Só a primeira é uma escolha de compra: existe UM
 * SKU moído por peso, e os seis métodos apontavam todos para ele, com o mesmo
 * preço e o mesmo estoque. Eram sete botões na PDP para dois produtos.
 */
export type Moagem = "grao" | "moido";

/**
 * Como se PREPARA — e isto NÃO é opção de compra.
 *
 * Vive na seção "Como preparar" da PDP, que é receita, não prateleira. A casa
 * mói na hora do pedido, então o método diz de que jeito o mesmo pacote moído
 * sai da máquina; não é outro produto, não tem outro preço e não sai de outro
 * estoque.
 */
export type Metodo =
  | "espresso"
  | "coado-papel"
  | "coador-pano"
  | "prensa-francesa"
  | "italiana-moka"
  | "aeropress";

export type PesoGramas = 250 | 500 | 1000;

export type Imagem = { src: string; alt: string; w: number; h: number };

/**
 * Uma combinação comprável, e há exatamente uma por SKU de pacote da loja.
 *
 * A loja real vende dois formatos de café em pacote — "em grãos" e "moído" — e
 * NÃO vende uma moagem por método. O método de preparo é orientação de receita
 * (ver `Metodo`), não escolha de prateleira: o que a casa anuncia é "moído na
 * hora do pedido", com um único SKU moído por peso.
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
   * A pontuação SCA desta linha — e ela tem DOIS REGIMES, que é o que
   * `scaExata` distingue.
   *
   * A embalagem dos pacotes Canastra declara "SCA 80+", que é um PISO de
   * coleção e não a nota daquele café. Guardar 80 e exibir "80+" é o que a
   * lata diz; o mock antigo exibia 84,25 e 85,50, números que nenhuma prova
   * de xícara produziu. Nada mudou nesse princípio.
   *
   * O que mudou é que duas linhas têm nota PUBLICADA pela marca, e a nota
   * vence o piso: o Microlote tem 86 (que "80+" subestimava) e o Néctar de
   * Minas tem 75 — abaixo do corte da própria SCA, ou seja, NÃO é café
   * especial. É gourmet, e é o que a embalagem dele diz.
   */
  sca: number;
  /**
   * `false` = o número acima é o piso da embalagem, e a tela escreve "80+".
   * `true` = é a nota daquela linha, e a tela escreve "86" — sem o "+", que
   * afirmaria um piso que ninguém declarou.
   *
   * É o campo que impede as duas mentiras simétricas: anunciar 80+ num café de
   * 75, e vender 86 como se fosse "pelo menos 80".
   */
  scaExata: boolean;
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

/**
 * NÃO HÁ FILTRO DE MOAGEM AQUI, e a ausência é a decisão. O filtro "Formato"
 * logo abaixo já recorta o mesmo eixo — grãos, moído, drip, cápsula — e é o
 * eixo de variação verdadeiro deste catálogo. Dois filtros para um eixo é
 * ruído na PLP; o antigo ainda por cima oferecia sete valores para uma loja que
 * vende dois.
 */
export type Filtros = {
  linha?: Linha;
  pontoTorraMin?: number;
  pontoTorraMax?: number;
  notas?: string[];
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

/** As duas formas de comprar o pacote. É desta lista que a PDP faz os botões. */
export const MOAGENS: { valor: Moagem; rotulo: string }[] = [
  { valor: "grao", rotulo: "Grão" },
  { valor: "moido", rotulo: "Moído" },
];

/**
 * Os seis métodos de preparo, com o rótulo que a tela mostra.
 *
 * Saíram de `MOAGENS` e continuam aqui inteiros: a seção "Como preparar" da
 * PDP é conteúdo bom e não tinha por que morrer junto com o seletor de sete
 * botões. Quem renderiza receita lê DAQUI — nenhum componente traduz método
 * por conta própria.
 */
export const METODOS: { valor: Metodo; rotulo: string }[] = [
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
