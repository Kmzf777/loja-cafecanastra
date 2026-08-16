export type Linha = "classico" | "suave" | "aromatizado";

export type Moagem =
  | "grao" | "espresso" | "coado-papel" | "coador-pano"
  | "prensa-francesa" | "italiana-moka" | "aeropress";

export type Metodo = Exclude<Moagem, "grao">;

export type PesoGramas = 250 | 500 | 1000;

export type Imagem = { src: string; alt: string; w: number; h: number };

export type Variante = {
  sku: string;
  moagem: Moagem;
  pesoGramas: PesoGramas;
  /** Em centavos. 4200 = R$ 42,00 */
  preco: number;
  estoque: number;
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

export type Lavoura = {
  altitude: number;
  variedade: string;
  processo: string;
  safra: number;
  produtor: string;
  municipio: string;
};

export type Lote = {
  slug: string;
  nome: string;
  linha: Linha;
  notas: string[];
  pontoTorra: 1 | 2 | 3 | 4 | 5;
  sca: number;
  descricao: string;
  lavoura: Lavoura;
  fotos: { sabor: Imagem; pacote: Imagem; terreiro?: Imagem; moido?: Imagem };
  variantes: Variante[];
  preparo: Preparo[];
  assinatura?: { desconto: number; frequenciasDias: number[] };
};

export type Filtros = {
  linha?: Linha;
  pontoTorraMin?: number;
  pontoTorraMax?: number;
  scaMin?: number;
  notas?: string[];
  moagem?: Moagem;
  /** estetica.md §7.2 — slider de faixa desenhado sobre a silhueta da serra. */
  altitudeMin?: number;
  altitudeMax?: number;
  /** Filtro "Formato" do §7.2. */
  pesoGramas?: PesoGramas;
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
  | "altitude-desc"
  | "sca-desc";

export const ORDENACOES: { valor: Ordenacao; rotulo: string }[] = [
  { valor: "relevancia", rotulo: "Relevância" },
  { valor: "preco-asc", rotulo: "Menor preço" },
  { valor: "preco-desc", rotulo: "Maior preço" },
  { valor: "altitude-desc", rotulo: "Mais alto" },
  { valor: "sca-desc", rotulo: "Maior pontuação" },
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
