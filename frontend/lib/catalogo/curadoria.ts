import { PRODUTOS, type ProdutoDoCatalogo } from "./produtos";

/**
 * QUEM ENTRA EM CADA CARROSSEL DA HOME.
 *
 * ISTO É CURADORIA, NÃO AGREGAÇÃO DE VENDA. `maisVendido` no catálogo é a casa
 * declarando o que sai mais, num arquivo versionado e revisável em pull
 * request. NÃO é `SELECT sku, count(*) FROM order_items`.
 *
 * O registro existe porque este repositório já removeu várias afirmações por
 * não terem fonte — a `Lavoura` com altitude inventada por lote, o "SCA 80+"
 * aplicado a um café de 75 pontos, o "lote rastreado" da faixa de prova. A
 * fonte desta aqui é o dono da loja, o que é legítimo; o nome do campo e este
 * comentário existem para que ninguém, daqui a seis meses, confunda uma com a
 * outra.
 *
 * O CAMINHO PARA O DADO REAL ESTÁ ABERTO E NÃO FOI TOMADO: um endpoint que
 * agregue `order_items` por SKU substitui a curadoria sem tocar em componente
 * nenhum, porque a ordenação já entra pronta daqui.
 */

/** Seis cards e o sétimo é o "Ver mais". Acima disso ninguém arrasta. */
export const TETO_DA_SECAO = 6;

/** Dá para comprar isto hoje? É a única pergunta que filtra as três seções. */
export function ehVendavel(p: ProdutoDoCatalogo): boolean {
  return p.estoque > 0 && p.precoCentavos > 0;
}

/** Caixa fechada ou kit que mistura linhas — o recorte que a PLP já usa. */
export function ehCaixaOuKit(p: ProdutoDoCatalogo): boolean {
  return p.kit === true || p.pacotes > 1;
}

/** Pacote avulso: o que as duas seções curadas vendem. */
function ehPacoteAvulso(p: ProdutoDoCatalogo): boolean {
  return !ehCaixaOuKit(p) && (p.formato === "graos" || p.formato === "moido");
}

/**
 * A QUEDA, e ela é a razão de as funções abaixo aceitarem a lista por
 * parâmetro em vez de lerem `PRODUTOS` direto.
 *
 * A curadoria é um arquivo editado à mão. No dia em que alguém apagar uma
 * linha por engano, a seção não pode renderizar vazia: cai para os compráveis
 * mais baratos, que é uma vitrine defensável em vez de um buraco. É o mesmo
 * princípio de `repositorio.ts`, que serve o JSON versionado quando a API não
 * responde — loja com vitrine de ontem é melhor que loja que não abre.
 */
function queda(produtos: ProdutoDoCatalogo[]): ProdutoDoCatalogo[] {
  return produtos
    .filter((p) => ehVendavel(p) && ehPacoteAvulso(p))
    .sort((a, b) => a.precoCentavos - b.precoCentavos)
    .slice(0, TETO_DA_SECAO);
}

/**
 * Ordena pela posição declarada e corta no teto.
 *
 * `ehVendavel` filtra ANTES da ordenação de propósito: um SKU curado que
 * esgotou não deve ocupar a primeira posição do carrossel com o botão
 * desabilitado. Ele reaparece sozinho quando o estoque voltar, sem ninguém
 * editar o JSON de novo — que é justamente o que uma curadoria por posição
 * permite e uma lista fixa de SKUs não permitiria.
 */
function porCuradoria(
  produtos: ProdutoDoCatalogo[],
  campo: "maisVendido" | "escolhaDoProdutor",
): ProdutoDoCatalogo[] {
  const curados = produtos
    .filter((p) => p[campo] !== undefined && ehVendavel(p))
    .sort((a, b) => (a[campo] as number) - (b[campo] as number))
    .slice(0, TETO_DA_SECAO);

  return curados.length > 0 ? curados : queda(produtos);
}

/** Seção 1 da home. */
export function maisVendidos(
  produtos: ProdutoDoCatalogo[] = PRODUTOS,
): ProdutoDoCatalogo[] {
  return porCuradoria(produtos, "maisVendido");
}

/** Seção 3 da home. */
export function escolhaDoProdutor(
  produtos: ProdutoDoCatalogo[] = PRODUTOS,
): ProdutoDoCatalogo[] {
  return porCuradoria(produtos, "escolhaDoProdutor");
}

/**
 * Seção 2 da home — e ela NÃO lê a curadoria, porque não precisa.
 *
 * Só três produtos do catálogo carregam `kit: true`, e DOIS SÃO CÁPSULAS COM
 * PREÇO E ESTOQUE ZERADOS. Uma seção que lesse só aquela flag nasceria com um
 * card. O recorte é o que a PLP já chama de "Kits e caixas" — `kit` ou mais de
 * um pacote —, que traz quatro caixas de fato compráveis.
 *
 * NÃO SE PREENCHE COM ESGOTADO PARA FECHAR SEIS. Quatro cards que vendem valem
 * mais que seis onde dois estão mortos; o "Ver mais" no fim leva a quem quiser
 * ver o resto, inclusive o que acabou.
 */
export function kitsECaixas(
  produtos: ProdutoDoCatalogo[] = PRODUTOS,
): ProdutoDoCatalogo[] {
  return produtos
    .filter((p) => ehCaixaOuKit(p) && ehVendavel(p))
    .sort((a, b) => b.precoCentavos - a.precoCentavos)
    .slice(0, TETO_DA_SECAO);
}
