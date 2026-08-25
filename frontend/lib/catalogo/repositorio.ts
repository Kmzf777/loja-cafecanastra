import { API_BASE } from "../api-base";
import {
  KITS_DA_LOJA,
  LOTES,
  PRODUTOS,
  imagemDoProduto,
  imagemEstudioDoProduto,
  type ProdutoDoCatalogo,
} from "./produtos";
import {
  maisVendidos,
  kitsECaixas,
  escolhaDoProdutor,
  ehCaixaOuKit,
} from "./curadoria";
import type {
  Filtros,
  Kit,
  Lote,
  Ordenacao,
  ProdutoVendavel,
  Variante,
} from "./tipos";

/**
 * Unica porta de entrada do catalogo. Nenhuma pagina conhece a origem do dado.
 *
 * O catalogo tem duas metades, e elas moram em lugares diferentes de proposito:
 *
 *   EDITORIAL — linha, notas, ponto de torra, fotos, textos. Vive em
 *   data/catalogo-canastra.json, versionado, revisado em pull request. Nao muda
 *   sozinho e nao deveria ser editavel por um formulario.
 *
 *   COMERCIAL — preco e estoque. Vive no BANCO e e editado pelo painel. Muda
 *   todo dia e nao passa por deploy.
 *
 * Ate agora a vitrine so lia o JSON: o administrador mudava o preco no painel e
 * a loja continuava anunciando o preco antigo ate alguem recompilar o site.
 * `aplicarDadosAoVivo` casa os dois pelo `sku` e deixa o banco mandar em preco
 * e estoque. Se a API estiver fora, a vitrine continua de pe com o JSON — uma
 * loja que nao abre e pior que uma loja com preco de ontem, e o checkout
 * reconfere tudo no servidor antes de cobrar.
 */

/** Quanto tempo o Next guarda a resposta da API antes de perguntar de novo. */
const SEGUNDOS_DE_CACHE = 60;

/**
 * TETO DE ESPERA DA API, e ele faltava aqui.
 *
 * `fetch` nao tem timeout proprio. Uma API que aceita a conexao e nunca
 * responde — o processo travado, a conexao com o banco esgotada, o container
 * subindo — deixa esta promessa pendurada para SEMPRE. Nao e hipotese: e o
 * mesmo defeito que `lib/avaliacoes/servidor.ts` ja documentava e resolvia com
 * 3 segundos, e aqui ele custa mais caro, porque quem espera e a home, a PLP e
 * a revalidacao de toda PDP. As tres param juntas, sem log e sem erro, com o
 * banco perfeitamente de pe.
 *
 * A alternativa a esperar ja estava escrita e nunca era alcancada: o `catch`
 * abaixo devolve mapa vazio e a vitrine vende pelo JSON versionado. Loja com
 * preco de ontem e melhor que loja que nao abre, e o checkout reconfere preco
 * e estoque no servidor antes de cobrar.
 *
 * 3 segundos, o MESMO numero do irmao, de proposito: sao duas leituras de
 * contingencia do mesmo tipo, e dois tetos diferentes seriam duas conversas
 * sobre o mesmo problema.
 */
export const ESPERA_MAXIMA_MS = 3000;

type ProdutoDaApi = {
  product_id: string;
  sku: string | null;
  price: string | number;
  quantity: number;
};

async function buscarDadosAoVivo(): Promise<Map<string, ProdutoDaApi>> {
  try {
    const res = await fetch(`${API_BASE}/dashboard?limit=200`, {
      next: { revalidate: SEGUNDOS_DE_CACHE },
      // Estourado o prazo, o `fetch` rejeita com TimeoutError e o `catch`
      // logo abaixo trata isso como qualquer outra falha de rede: mapa vazio,
      // vitrine no JSON. Ver `ESPERA_MAXIMA_MS`.
      signal: AbortSignal.timeout(ESPERA_MAXIMA_MS),
    });
    if (!res.ok) return new Map();

    const dados = await res.json();
    const linhas: ProdutoDaApi[] = dados.products ?? [];

    return new Map(
      linhas.filter((p) => p.sku).map((p) => [p.sku as string, p]),
    );
  } catch {
    // Silencioso de proposito: a vitrine cai para o JSON e continua vendendo.
    // Cai aqui tanto a API fora do ar quanto a API que passou do teto de
    // espera — para a loja, sao a mesma coisa.
    return new Map();
  }
}

/**
 * Sobrepoe o comercial do banco sobre UM item vendavel (variante, formato
 * especial ou kit — qualquer coisa com `skuLoja`/`preco`/`estoque`). Extraida
 * de `aplicarDadosAoVivo` quando os kits ganharam superficie de venda, para os
 * tres caminhos usarem exatamente a mesma regra de casamento por SKU.
 */
function sobreporAoVivo<
  T extends { skuLoja: string; preco: number; estoque: number },
>(v: T, aoVivo: Map<string, ProdutoDaApi>): T {
  const vivo = aoVivo.get(v.skuLoja);
  if (!vivo) return v;
  return {
    ...v,
    produtoId: vivo.product_id,
    preco: Math.round(Number(vivo.price) * 100),
    estoque: Number(vivo.quantity),
  };
}

/** Sobrepoe preco e estoque do banco sobre a estrutura editorial. */
function aplicarDadosAoVivo(lote: Lote, aoVivo: Map<string, ProdutoDaApi>): Lote {
  if (aoVivo.size === 0) return lote;

  return {
    ...lote,
    variantes: lote.variantes.map((v) => sobreporAoVivo(v, aoVivo)),
    formatosEspeciais: lote.formatosEspeciais.map((f) =>
      sobreporAoVivo(f, aoVivo),
    ),
  };
}

/**
 * Os kits da loja, com preco/estoque/produtoId ao vivo quando a API responde.
 *
 * Mesmo desenho de contingencia de `listarLotes`: API fora → o JSON versionado
 * segue de pe e o kit sem `produtoId` aparece mas nao vende (o CardKit avisa,
 * como o PainelCompra). Kit esgotado NAO e filtrado aqui — a PLP o mostra
 * desabilitado, porque sumir com produto e pior que dizer que acabou.
 */
export async function listarKits(): Promise<Kit[]> {
  const aoVivo = await buscarDadosAoVivo();
  return KITS_DA_LOJA.map((k) => sobreporAoVivo(k, aoVivo));
}

export async function listarLotes(
  filtros: Filtros = {},
  ordenacao: Ordenacao = "relevancia",
): Promise<Lote[]> {
  const aoVivo = await buscarDadosAoVivo();
  const catalogo = LOTES.map((l) => aplicarDadosAoVivo(l, aoVivo));

  const casa = catalogo.filter((lote) => {
    if (filtros.linha && lote.linha !== filtros.linha) return false;
    if (filtros.pontoTorraMin && lote.pontoTorra < filtros.pontoTorraMin) return false;
    if (filtros.pontoTorraMax && lote.pontoTorra > filtros.pontoTorraMax) return false;
    if (filtros.formato) {
      const emVariantes = lote.variantes.some((v) => v.formato === filtros.formato);
      const emEspeciais = lote.formatosEspeciais.some(
        (f) => f.formato === filtros.formato,
      );
      if (!emVariantes && !emEspeciais) return false;
    }
    if (
      filtros.pesoGramas &&
      !lote.variantes.some((v) => v.pesoGramas === filtros.pesoGramas)
    )
      return false;
    if (filtros.soDisponiveis && !temEstoque(lote)) return false;
    // AND deliberado — ver o comentario sobre `notas` em tipos.ts.
    if (filtros.notas?.length && !filtros.notas.every((n) => lote.notas.includes(n)))
      return false;

    /**
     * OS DOIS FILTROS DA HOME, E ELES FILTRAM LINHA A PARTIR DE SKU.
     *
     * A curadoria vive por SKU ("Clássico em Grãos 250 g") e esta listagem é
     * por LINHA ("Canastra Clássico"). O recorte então é: a linha entra se ao
     * menos um SKU dela satisfaz. Não é aproximação — é o que mantém uma PLP
     * só, com os mesmos filtros, a mesma busca e o mesmo SEO, em vez de uma
     * segunda listagem por SKU que teria de repetir tudo isso.
     */
    if (filtros.destaque) {
      const campo =
        filtros.destaque === "mais-vendidos" ? "maisVendido" : "escolhaDoProdutor";
      const temCurado = PRODUTOS.some(
        (p) => p.linha === lote.linha && p[campo] !== undefined,
      );
      if (!temCurado) return false;
    }

    if (filtros.tipo === "kit") {
      const temCaixa = PRODUTOS.some(
        (p) => p.linha === lote.linha && ehCaixaOuKit(p),
      );
      if (!temCaixa) return false;
    }

    return true;
  });

  return ordenar(casa, ordenacao);
}

function ordenar(lotes: Lote[], ordenacao: Ordenacao): Lote[] {
  const copia = [...lotes];
  switch (ordenacao) {
    case "preco-asc":
      return copia.sort((a, b) => precoOrdenavel(a) - precoOrdenavel(b));
    case "preco-desc":
      return copia.sort((a, b) => precoOrdenavel(b) - precoOrdenavel(a));
    case "torra-asc":
      return copia.sort((a, b) => a.pontoTorra - b.pontoTorra);
    case "torra-desc":
      return copia.sort((a, b) => b.pontoTorra - a.pontoTorra);
    default:
      return copia;
  }
}

export async function obterLote(slug: string): Promise<Lote | null> {
  const lote = LOTES.find((l) => l.slug === slug);
  if (!lote) return null;
  return aplicarDadosAoVivo(lote, await buscarDadosAoVivo());
}

export async function listarSlugs(): Promise<string[]> {
  return LOTES.map((l) => l.slug);
}

/** Os outros cafés da casa — a seção "Da mesma serra" da PDP. */
export async function lotesRelacionados(lote: Lote, limite = 4): Promise<Lote[]> {
  const torraParecida = LOTES.filter(
    (l) => l.slug !== lote.slug && Math.abs(l.pontoTorra - lote.pontoTorra) <= 1,
  );
  const resto = LOTES.filter(
    (l) => l.slug !== lote.slug && !torraParecida.includes(l),
  );
  return [...torraParecida, ...resto].slice(0, limite);
}

/** Faixa de ponto de torra da coleção — domínio do eixo do §6 (Plano B). */
export async function faixaTorra(): Promise<{ min: number; max: number }> {
  const pontos = LOTES.map((l) => l.pontoTorra);
  return { min: Math.min(...pontos), max: Math.max(...pontos) };
}

/**
 * Menor preço entre as variantes — o "a partir de" do card.
 *
 * Devolve `null` quando a linha não tem nenhuma variante de pacote com preço:
 * é o caso real da Canela, cujos únicos formatos capturados (drip e cápsula)
 * estão esgotados e sem preço na loja. Inventar um número aqui seria mentir na
 * vitrine; quem consome trata o `null` mostrando "Indisponível".
 */
export function precoMinimo(lote: Lote): number | null {
  const precos = lote.variantes.filter((v) => v.preco > 0).map((v) => v.preco);
  return precos.length ? Math.min(...precos) : null;
}

/** Como `precoMinimo`, mas com um valor alto no lugar do nulo, para ordenação. */
function precoOrdenavel(lote: Lote): number {
  return precoMinimo(lote) ?? Number.MAX_SAFE_INTEGER;
}

/** Há ao menos uma combinação comprável? */
export function temEstoque(lote: Lote): boolean {
  return (
    lote.variantes.some((v) => v.estoque > 0) ||
    lote.formatosEspeciais.some((f) => f.estoque > 0)
  );
}

/**
 * A variante exata para uma combinacao. Devolve `undefined` quando ela nao
 * existe — a PDP DESABILITA a combinacao em vez de esconde-la (estetica.md
 * §5.5 trata a moagem como escolha explicita do cliente).
 */
export function acharVariante(
  lote: Lote,
  moagem: Variante["moagem"],
  pesoGramas: Variante["pesoGramas"],
  pacotes = 1,
): Variante | undefined {
  return lote.variantes.find(
    (v) =>
      v.moagem === moagem && v.pesoGramas === pesoGramas && v.pacotes === pacotes,
  );
}

/** Quantos pacotes por embalagem existem para uma combinação (1, 3, 4...). */
export function embalagensDe(
  lote: Lote,
  moagem: Variante["moagem"],
  pesoGramas: Variante["pesoGramas"],
): number[] {
  return [
    ...new Set(
      lote.variantes
        .filter((v) => v.moagem === moagem && v.pesoGramas === pesoGramas)
        .map((v) => v.pacotes),
    ),
  ].sort((a, b) => a - b);
}

/** Centavos para "R$ 42,00". */
export function formatarPreco(centavos: number): string {
  return (centavos / 100).toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
  });
}

/** "R$ 42,00" -> "42 reais", para o aria-label (estetica.md §10). */
export function precoParaLeitor(centavos: number): string {
  const reais = Math.floor(centavos / 100);
  const cents = centavos % 100;
  return cents === 0 ? `${reais} reais` : `${reais} reais e ${cents} centavos`;
}

/**
 * O produto cru do JSON no vocabulário comercial da casa.
 *
 * `precoCentavos` vira `preco` e o `sku` vira também `skuLoja` — para o SKU
 * avulso os dois são o mesmo, porque a chave do catálogo É a chave da loja. É
 * essa tradução que deixa o produto passar por `sobreporAoVivo` junto com as
 * variantes e os kits, em vez de ganhar um caminho próprio que divergiria.
 */
function comoVendavel(p: ProdutoDoCatalogo): ProdutoVendavel {
  return {
    sku: p.sku,
    skuLoja: p.sku,
    linha: p.linha as ProdutoVendavel["linha"],
    formato: p.formato as ProdutoVendavel["formato"],
    ...("gramas" in p ? { gramas: p.gramas as number } : {}),
    pacotes: p.pacotes,
    rotuloEmbalagem: p.rotuloEmbalagem,
    rotuloChave: p.rotuloChave,
    nome: p.nome,
    imagem: imagemDoProduto(p),
    imagemEstudio: imagemEstudioDoProduto(p),
    preco: p.precoCentavos,
    estoque: p.estoque,
  };
}

/**
 * AS TRÊS SEÇÕES DA HOME, COM PREÇO E ESTOQUE DO BANCO.
 *
 * A curadoria (`lib/catalogo/curadoria.ts`) decide QUAIS SKUs; ela é pura e
 * não sabe o que é uma API. Esta função é quem põe o comercial por cima, pelo
 * mesmo mecanismo que `listarLotes` e `listarKits` já usam.
 *
 * SEM ELA A HOME NÃO VENDERIA. `produtoId` não existe em produto nenhum do
 * JSON — ele nasce aqui, do casamento por SKU com o banco —, e é ele que o
 * carrinho envia ao backend. Um card sem `produtoId` responde "não deu para
 * falar com a loja" em todo clique: a home pareceria uma loja e não cobraria
 * ninguém. O preço tem a mesma história: sem a sobreposição, a vitrine
 * anunciaria o valor do JSON enquanto o painel mostra outro.
 *
 * UMA LEITURA SÓ PARA AS TRÊS SEÇÕES. `buscarDadosAoVivo` é chamada uma vez e
 * o mapa é reusado — três chamadas custariam três `fetch` por render, e o
 * cache de 60 s do Next abafaria isso sem tornar certo depender dele.
 *
 * A CONTINGÊNCIA É A MESMA DAS IRMÃS: API fora, o mapa volta vazio, e a home
 * vende pelo JSON versionado. Loja com preço de ontem é melhor que loja que
 * não abre, e o checkout reconfere preço e estoque no servidor antes de
 * cobrar.
 */
export async function produtosDaHome(): Promise<{
  maisVendidos: ProdutoVendavel[];
  kits: ProdutoVendavel[];
  escolhaDoProdutor: ProdutoVendavel[];
}> {
  const aoVivo = await buscarDadosAoVivo();
  const comercial = (lista: ProdutoDoCatalogo[]) =>
    lista.map((p) => sobreporAoVivo(comoVendavel(p), aoVivo));

  return {
    maisVendidos: comercial(maisVendidos(PRODUTOS)),
    kits: comercial(kitsECaixas(PRODUTOS)),
    escolhaDoProdutor: comercial(escolhaDoProdutor(PRODUTOS)),
  };
}
