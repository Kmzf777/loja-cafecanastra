"use strict";

const { calcularDescontos } = require("./motor");

/**
 * O menor preco do produto dadas as promocoes ativas, arredondado a centavo.
 *
 * MOROU DENTRO DO PaymentController ate a F6; saiu de la porque ganhou um
 * TERCEIRO chamador: alem da cotacao de frete (leitura sem trava) e do calculo
 * do valor cobrado (releitura com FOR UPDATE), agora o `POST /cupons/validar`
 * precisa do MESMO preco promocional para calcular o subtotal sobre o qual o
 * cupom desconta — e importar o PaymentController de la puxaria o SDK do
 * Mercado Pago para um caminho que nao cobra nada. Copias desta logica
 * divergindo fariam o cupom, o frete gratis e a cobranca discordarem sobre o
 * mesmo carrinho.
 *
 * O arredondamento nao e cosmetico: 10% sobre 49.90 em float da
 * 44.910000000000004, e esse numero iria para o JSON IMUTAVEL do pedido
 * (`itens`, regra de 0005) e para a soma cobrada no gateway.
 *
 * `productDb` fala o CONTRATO (price, category, product_id — os aliases dos
 * SELECTs), nao as colunas do banco; `activePromotions` e o formato de
 * `promotionsRepository.findActivePromotionsForCheckout`.
 *
 * ---------------------------------------------------------------------------
 * A CONTA AGORA E DO MOTOR (Onda 4), E A ASSINATURA NAO MUDOU
 * ---------------------------------------------------------------------------
 *
 * A aritmetica de "percent" e "fixed" saiu daqui e virou uma chamada a
 * `utils/motor.js`: cada promocao legada e traduzida para uma regra de classe
 * `produto` e avaliada sobre uma linha de UMA unidade. Os tres chamadores nao
 * mudam — a funcao continua recebendo o par (produto, promocoes) e devolvendo
 * um preco em REAIS.
 *
 * O ganho e o que o cabecalho acima ja pedia: existe UMA implementacao de
 * "desconto em centavos inteiros" na loja, e nao duas. A conta passou a
 * arredondar o DESCONTO em vez do preco resultante — que e o que o motor
 * precisa fazer para a soma de `pedido_ajustes_desconto` fechar ao centavo com
 * o valor cobrado. Nos dois casos o resultado e o mesmo real, salvo o meio
 * centavo exato, onde o novo caminho e o mais defensavel: ele nunca passa por
 * um produto em ponto flutuante.
 *
 * O `Math.min` FICA, e a permanencia e deliberada. "A mais generosa ganha" e
 * acidente e nao decisao — a Onda 4 registrou isso —, mas a decisao NOVA (a
 * ordem declarada: produto, depois pedido, depois frete; prioridade,
 * exclusiva, grupo) vale para as regras da tabela `promocoes` de 0032, que o
 * motor le pelo `motorRepository`. As linhas de `promocoes_legado` continuam
 * com a semantica com que foram cadastradas ate a `0036` aposenta-las: mudar o
 * criterio de selecao aqui mudaria, hoje, o preco de campanhas que ja estao no
 * ar, sem ninguem ter pedido.
 */

/** O default de uma regra do motor — so o legado preenche o que usa. */
function regraDaPromocaoLegada(promocao) {
  const escopo = [];
  if (promocao.applies_to === "all") {
    escopo.push({ tipo: "todos", alvo: null, incluir: true });
  } else if (promocao.applies_to === "category") {
    escopo.push({ tipo: "categoria", alvo: promocao.category, incluir: true });
  } else if (promocao.applies_to === "product") {
    escopo.push({ tipo: "produto", alvo: promocao.product_id, incluir: true });
  }
  // Escopo VAZIO deixa a regra inerte no motor, e e o comportamento preservado:
  // `applies_to = 'category'` sem categoria e `'product'` sem produto_id nunca
  // casaram nesta funcao, e a migracao 0032 nao criou linha de escopo para
  // eles justamente por isso.

  return {
    id: promocao.id ?? null,
    nome: promocao.title || "Promoção",
    metodo: "automatico",
    classe: "produto",
    mecanica: promocao.type === "percent" ? "percentual" : "valor_fixo",
    valor: promocao.value,
    tetoDescontoCentavos: null,
    minimoTipo: "nenhum",
    minimoValor: null,
    prioridade: 0,
    exclusiva: false,
    grupoExclusividade: null,
    meiosPagamento: null,
    criadaEm: promocao.created_at ?? null,
    escopo,
    faixas: [],
    frete: null,
    codigo: null,
  };
}

function precoComPromocao(productDb, activePromotions) {
  const precoOriginalCentavos = Math.round(Number(productDb.price) * 100);
  let melhorCentavos = precoOriginalCentavos;

  // UMA unidade: esta funcao devolve preco UNITARIO, e e assim que os tres
  // chamadores a usam. Quantidade entra depois, em `somarCentavos`.
  const carrinho = {
    itens: [
      {
        produtoId: productDb.product_id,
        sku: productDb.sku ?? null,
        categoria: productDb.category,
        precoCentavos: precoOriginalCentavos,
        quantidade: 1,
      },
    ],
    meioPagamento: null,
    assinante: false,
    frete: null,
  };

  // UMA REGRA POR VEZ, de proposito: e o que preserva o `Math.min` (ver o
  // cabecalho). Avaliar as duas juntas faria o motor EMPILHA-LAS, que e a
  // ordem nova — correta para `promocoes`, e uma mudanca de preco silenciosa
  // para `promocoes_legado`.
  for (const promocao of activePromotions || []) {
    const { totalCentavos } = calcularDescontos(carrinho, [
      regraDaPromocaoLegada(promocao),
    ]);
    const comDesconto = precoOriginalCentavos - totalCentavos;
    if (comDesconto < melhorCentavos) melhorCentavos = comDesconto;
  }

  return melhorCentavos / 100;
}

/**
 * Subtotal de uma lista de itens em CENTAVOS e inteiro. `price` viaja em reais
 * (contrato antigo); cada preco vira inteiro ANTES da soma, porque `49.67 * 3`
 * em float da 149.01000000000002 — e as comparacoes que consomem este numero
 * (piso do frete gratis, minimo do cupom, desconto) erram exatamente na
 * fronteira.
 *
 * Uma funcao so para os tres somadores (cotacao de frete, validacao de cupom,
 * checkout) nunca divergirem sobre o mesmo carrinho.
 */
function somarCentavos(itens) {
  return itens.reduce(
    (acc, i) => acc + Math.round(Number(i.price) * 100) * Number(i.quantity),
    0,
  );
}

module.exports = { precoComPromocao, somarCentavos };
