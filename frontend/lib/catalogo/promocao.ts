import type { Lote } from "./tipos";

/**
 * A REGRA DO PRECO "DE/POR", NUM LUGAR SO — e nenhuma tela decide sozinha.
 *
 * A promocao ja existia e ja descontava: `precoComPromocao` (backend,
 * utils/preco.js) abate o valor na hora de cobrar. O que nao existia era a
 * EXIBICAO — o cliente via R$ 60, pagava R$ 54 e descobria no fim. Promocao
 * invisivel nao vende.
 *
 * ---------------------------------------------------------------------------
 * A MINA TERRESTRE, E POR QUE ESTE MODULO NAO PISA NELA
 * ---------------------------------------------------------------------------
 *
 * `conferirSubtotal` (PaymentController.js) compara com TOLERANCIA ZERO o
 * subtotal declarado pelo navegador contra o subtotal de CATALOGO. O campo
 * `subtotalCentavos` nao significa "o que o cliente vai pagar" — significa "o
 * que a tela somou a partir do catalogo", e existe so para o servidor perceber
 * que a tela esta velha.
 *
 * Por isso a decisao aqui e de RENDERIZACAO, nunca de armazenamento: a sacola
 * continua guardando `price` de catalogo e `subtotalCentavos` continua sendo a
 * soma dele. O preco promocional viaja em campo SEPARADO e opcional. Guardar o
 * promocional no lugar do de catalogo faria os dois lados calcularem sobre
 * bases diferentes e toda venda com promocao morreria em 409 `PRECO_MUDOU`.
 * Ver §5.1 da spec do painel de gestao.
 *
 * ---------------------------------------------------------------------------
 * TUDO EM CENTAVOS, INTEIRO — a unidade esta no nome dos campos que a mudam.
 */

/**
 * O minimo que uma coisa vendavel precisa ter para ganhar preco de/por.
 *
 * `Variante`, `FormatoEspecial`, `Kit` e `ProdutoVendavel` satisfazem os quatro
 * a esta forma de proposito (e o motivo esta em `tipos.ts`): e o que deixa um
 * so mecanismo servir aos dois vocabularios de card, a PDP e a sacola.
 */
export type ItemComPreco = {
  /** Preco de catalogo, em centavos. */
  preco: number;
  /** Preco ja com a promocao ativa aplicada, em centavos. Ausente = sem promocao. */
  precoPromocional?: number;
};

/**
 * O par que a tela desenha. `de` nulo quer dizer "nao ha promocao a mostrar",
 * e nesse caso a tela desenha exatamente o que sempre desenhou.
 */
export type PrecoExibido = {
  /** O preco riscado. Nulo quando nao ha promocao valida. */
  de: number | null;
  /** O preco em destaque — o que a pessoa paga por unidade. */
  por: number;
};

/**
 * O par de/por de UM item.
 *
 * TRES RECUSAS, e cada uma evita uma mentira diferente na vitrine:
 *
 *  - promocional AUSENTE — nao ha promocao, e o card fica como sempre esteve;
 *  - promocional MAIOR OU IGUAL ao de catalogo — "de R$ 50 por R$ 50" nao e
 *    promocao, e "de R$ 50 por R$ 60" e anuncio enganoso. `precoComPromocao` so
 *    ABAIXA o preco, entao um valor maior chegando aqui e dado torto da API, nao
 *    uma campanha;
 *  - promocional NAO-POSITIVO — zero ou negativo anunciaria cafe de graca. O
 *    backend nunca produz isso (o teto de 90% do desconto vive em
 *    promotionsRepository), mas a vitrine nao confia no que chega pela rede.
 *
 * Em qualquer das tres a queda e para o preco de catalogo, que e o lado seguro
 * do erro: o cliente ve o valor cheio e paga o promocional.
 */
export function precoExibido(item: ItemComPreco): PrecoExibido {
  const { preco, precoPromocional } = item;
  if (precoPromocional === undefined || precoPromocional === null) {
    return { de: null, por: preco };
  }
  if (!Number.isFinite(precoPromocional)) return { de: null, por: preco };
  if (precoPromocional <= 0) return { de: null, por: preco };
  if (precoPromocional >= preco) return { de: null, por: preco };
  return { de: preco, por: precoPromocional };
}

/** Ha promocao a exibir neste item? */
export function temPromocao(item: ItemComPreco): boolean {
  return precoExibido(item).de !== null;
}

/**
 * O desconto em pontos percentuais inteiros, para o selo "−10%".
 *
 * ARREDONDA PARA BAIXO, e a escolha e deliberada: `Math.round` transformaria
 * 9,6% num selo de "10%" que a conta na sacola desmente. Anunciar menos do que
 * se entrega nunca gera reclamacao; o contrario gera.
 *
 * Devolve 0 quando nao ha desconto util — quem desenha esconde o selo, porque
 * "−0%" e ruido que ocupa o lugar de informacao.
 */
export function descontoPercentual(de: number, por: number): number {
  if (!(de > 0) || !(por >= 0) || por >= de) return 0;
  return Math.floor(((de - por) / de) * 100);
}

/**
 * O "a partir de" do `<CardCafe>`, agora ciente de promocao.
 *
 * A SUTILEZA QUE FARIA O CARD MENTIR: o menor preco de CATALOGO e o menor preco
 * EFETIVO podem ser de variantes diferentes. Uma linha com 250 g a R$ 60 sem
 * promocao e 500 g a R$ 70 com 20% de desconto tem menor catalogo = 6000 e
 * menor efetivo = 5600. Casar o "de" da primeira com o "por" da segunda
 * anunciaria "de R$ 60 por R$ 56" — um desconto de 6,7% que nao existe em SKU
 * nenhum. Por isso a escolha e da VARIANTE (pelo preco efetivo) e o par sai
 * dela inteiro.
 *
 * Devolve `null` pelo mesmo motivo que `precoMinimo`: linha sem nenhuma
 * variante com preco (a Canela e o caso real) nao tem numero honesto a mostrar.
 *
 * DESEMPATE DETERMINISTICO — mesmo preco efetivo, ganha o menor catalogo. Sem
 * ele a ordem de `lote.variantes` decidiria qual par o card mostra, e um
 * reordenamento do JSON mudaria a vitrine sem ninguem ter pedido.
 */
export function precoMinimoExibido(lote: Lote): PrecoExibido | null {
  const candidatos = lote.variantes
    .filter((v) => v.preco > 0)
    .map((v) => precoExibido(v));

  if (candidatos.length === 0) return null;

  return candidatos.reduce((melhor, atual) => {
    if (atual.por !== melhor.por) return atual.por < melhor.por ? atual : melhor;
    const deAtual = atual.de ?? atual.por;
    const deMelhor = melhor.de ?? melhor.por;
    return deAtual < deMelhor ? atual : melhor;
  });
}

/**
 * O preco promocional que chega da API, em centavos — ou `undefined`.
 *
 * A API fala o contrato antigo: preco em REAIS, string ou numero (`price` vem
 * de uma coluna `numeric` do Postgres, e o `pg` a entrega como string para nao
 * perder precisao). Este e o unico lugar que faz a travessia, pela MESMA conta
 * de `sobreporAoVivo` — `Math.round(Number(x) * 100)` —, porque duas contas de
 * reais para centavos divergem no centavo e o centavo aqui e a diferenca entre
 * exibir a promocao e nao exibir.
 *
 * Devolve `undefined` para ausente, nulo, nao-numerico e para qualquer valor
 * que nao seja MENOR que o catalogo: um "promocional" que nao desconta so
 * ocuparia memoria na sacola e viajaria de volta no corpo do checkout.
 */
export function precoPromocionalDaApi(
  cru: unknown,
  precoDeCatalogoCentavos: number,
): number | undefined {
  if (cru === undefined || cru === null || cru === "") return undefined;
  const n = Number(cru);
  if (!Number.isFinite(n)) return undefined;
  const centavos = Math.round(n * 100);
  if (centavos <= 0) return undefined;
  if (centavos >= precoDeCatalogoCentavos) return undefined;
  return centavos;
}
