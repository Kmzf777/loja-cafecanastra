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
 *
 * `variedades` SAIU DAQUI, e é o mesmo princípio uma segunda vez. Araras,
 * Caturra 2SL e Paraíso são as variedades que A CASA planta — dado da MARCA,
 * declarado uma vez em `marca.variedades` e explicado em
 * `marca.variedades_observacao`. `monta()` copiava essa lista para CADA lote e
 * a PDP escrevia "Blend 100% arábica das variedades Araras, Caturra 2SL e
 * Paraíso" em toda linha, inclusive onde a fonte não alcança: o Microlote é,
 * por definição, um lote separado do resto da lavoura, e o Néctar de Minas é
 * marca irmã, com 75 pontos e pacote próprio. Nenhum dos dois tem composição
 * publicada. A afirmação continua viva onde é verdadeira — em `/a-serra`, que
 * lê `MARCA.variedades` e a apresenta como "As variedades da Canastra".
 */
export type Origem = {
  regiao: string;
  estado: string;
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

/**
 * AS TABELAS DO CONTRATO GUARDAM VALOR, NUNCA TEXTO — e é esta a mudança.
 *
 * Elas eram `{ valor, rotulo }[]` com UM rótulo só, em português, e
 * alimentavam os filtros da PLP, os chips, os botões da PDP e o resumo do
 * Clube em QUALQUER idioma: `/en/cafes` mostrava "Menor preço" porque o texto
 * morava aqui, onde idioma não existe. Guardar rótulo num arquivo de contrato
 * é o que tornava a tradução impossível sem duplicar texto dentro de cada
 * componente.
 *
 * O texto passou inteiro para `lib/i18n/dicionario.ts`, chaveado pelo PRÓPRIO
 * VALOR desta lista: `d.catalogo.ordenacao["preco-asc"]`,
 * `d.catalogo.moagem.grao`. Quem tem o valor na mão acha o rótulo sem
 * procurar, e o TypeScript cobra a chave nos três idiomas.
 *
 * A ORDEM DESTAS LISTAS É A ORDEM DA TELA: é ela que decide a sequência dos
 * <option> do filtro e dos botões do seletor. Não é alfabética por acaso —
 * "Relevância" vem primeiro porque é o padrão, os preços crescem, e a torra
 * vai de clara a escura, na mesma direção da barra do <PontoTorra>.
 */
export const ORDENACOES: Ordenacao[] = [
  "relevancia",
  "preco-asc",
  "preco-desc",
  "torra-asc",
  "torra-desc",
];

/** As duas formas de comprar o pacote. É desta lista que a PDP faz os botões. */
export const MOAGENS: Moagem[] = ["grao", "moido"];

/**
 * Os seis métodos de preparo.
 *
 * Saíram de `MOAGENS` e continuam aqui inteiros: a seção "Como preparar" da
 * PDP é conteúdo bom e não tinha por que morrer junto com o seletor de sete
 * botões. Quem renderiza receita lê DAQUI — nenhum componente inventa a sua
 * própria lista, nem o seu próprio rótulo.
 */
export const METODOS: Metodo[] = [
  "espresso",
  "coado-papel",
  "coador-pano",
  "prensa-francesa",
  "italiana-moka",
  "aeropress",
];

export const FORMATOS: Formato[] = ["graos", "moido", "drip", "capsula"];

/**
 * As cinco linhas, na ordem em que a vitrine as apresenta.
 *
 * Estava em `rotulos.ts` como `Record<Linha, { rotulo, corVar }>`, misturando
 * três coisas num mapa só: a lista de valores, o texto e a cor da embalagem.
 * A lista ficou aqui, com as outras do contrato; a cor continua em
 * `COR_DA_LINHA` (rotulos.ts), que é onde mora apresentação; o nome está no
 * dicionário, em `catalogo.linha`, como todo o resto do texto.
 */
export const LINHAS: Linha[] = [
  "classico",
  "suave",
  "canela",
  "microlote",
  "nectar-de-minas",
];
