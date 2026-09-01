"use strict";

/**
 * A TABELA-VERDADE DO MOTOR DE DESCONTO.
 *
 * Sem banco e sem Express de propósito: `utils/motor.js` é puro, e é esse
 * isolamento que permite afirmar precedência, empilhamento e arredondamento
 * caso a caso, em milissegundos, sem subir um cluster Postgres. Quem lê o banco
 * é `motorRepository`, e tem arquivo próprio.
 *
 * CADA `test` AQUI É UMA LINHA DA TABELA. A lista veio da Onda 4 e não é
 * decoração: é a lista das formas conhecidas de o desconto sair errado, e cada
 * uma delas custa dinheiro de um lado ou do outro do balcão. As três que mais
 * merecem atenção estão marcadas no comentário do próprio teste.
 *
 * TODA ASSERÇÃO É EM CENTAVOS INTEIROS. Um resultado fracionário aqui não é
 * "quase certo": ele iria para `pedido_ajustes_desconto.valor_centavos`
 * (integer), para o `itens` jsonb imutável do pedido e para a soma cobrada no
 * gateway. Por isso os testes conferem `Number.isSafeInteger` além do valor.
 */

const { test } = require("node:test");
const assert = require("node:assert/strict");

const {
  calcularDescontos,
  meioDePagamentoDaLoja,
} = require("../src/utils/motor.js");

/* --------------------------------------------------------------------------
 * Cenário
 * -------------------------------------------------------------------------- */

const CLASSICO = "11111111-0000-4000-8000-000000000001";
const MICROLOTE = "11111111-0000-4000-8000-000000000002";

/** Um item de carrinho, no formato que o motor recebe. */
function item(produtoId, precoCentavos, quantidade, extra = {}) {
  return {
    produtoId,
    sku: extra.sku ?? null,
    categoria: extra.categoria ?? "cafe",
    precoCentavos,
    quantidade,
  };
}

function carrinho(itens, extra = {}) {
  return {
    itens,
    // `in` e não `??`: o teste do meio DESCONHECIDO passa `null` de propósito,
    // e um `??` o trocaria por "pix" — o caso que mais importa viraria o caso
    // que menos importa, verde e provando nada.
    meioPagamento: "meioPagamento" in extra ? extra.meioPagamento : "pix",
    assinante: extra.assinante ?? false,
    frete: extra.frete ?? null,
  };
}

/**
 * Uma regra com os defaults que o banco daria. O teste só escreve o que
 * importa para a linha da tabela que ele representa — assim, quando um default
 * mudar, o diff mostra o default e não vinte cópias dele.
 */
let contadorDeRegras = 0;
function regra(campos) {
  contadorDeRegras += 1;
  return {
    id: `99999999-0000-4000-8000-${String(contadorDeRegras).padStart(12, "0")}`,
    nome: campos.nome || `Regra ${contadorDeRegras}`,
    metodo: "automatico",
    classe: "produto",
    mecanica: "percentual",
    valor: null,
    tetoDescontoCentavos: null,
    minimoTipo: "nenhum",
    minimoValor: null,
    prioridade: 0,
    exclusiva: false,
    grupoExclusividade: null,
    meiosPagamento: null,
    criadaEm: "2026-01-01T00:00:00.000Z",
    escopo: [{ tipo: "todos", alvo: null, incluir: true }],
    faixas: [],
    frete: null,
    codigo: null,
    ...campos,
  };
}

/** O subtotal de catálogo do carrinho — o lado esquerdo da identidade. */
function subtotalDe(c) {
  return c.itens.reduce((a, i) => a + i.precoCentavos * i.quantidade, 0);
}

/**
 * Confere o que TODO caso desta tabela tem de respeitar, sempre: valores
 * inteiros, positivos, sequência contígua a partir de 1 e soma coerente.
 * Chamada por quase todos os testes — uma regressão de forma aparece em todos
 * de uma vez em vez de escapar pelo caso que ninguém olhou.
 */
function conferirForma(resultado) {
  let soma = 0;
  resultado.ajustes.forEach((ajuste, indice) => {
    assert.equal(ajuste.sequencia, indice + 1, "a sequência é contígua desde 1");
    assert.ok(
      Number.isSafeInteger(ajuste.valorCentavos),
      `ajuste ${indice} não é centavo inteiro: ${ajuste.valorCentavos}`,
    );
    assert.ok(ajuste.valorCentavos > 0, "ajuste de valor zero não vira linha");
    assert.ok(ajuste.rotulo, "todo ajuste tem rótulo — a tabela responde 'por quê'");
    if (ajuste.alvo === "item") assert.ok(ajuste.alvoRef, "item exige alvo_ref");
    else assert.equal(ajuste.alvoRef, null, "pedido e frete não têm alvo_ref");
    soma += ajuste.valorCentavos;
  });
  assert.equal(resultado.totalCentavos, soma);
  assert.ok(Number.isSafeInteger(resultado.totalCentavos));
}

/* --------------------------------------------------------------------------
 * 1-3. As três mecânicas de valor
 * -------------------------------------------------------------------------- */

test("percentual simples: 10% sobre a linha, arredondado ao centavo", () => {
  const c = carrinho([item(CLASSICO, 4990, 1)]);
  const r = calcularDescontos(c, [regra({ mecanica: "percentual", valor: 10 })]);

  conferirForma(r);
  // 10% de 49,90 é 4,99 — e em float seria 4.9910000000000005 * 100.
  assert.equal(r.totalCentavos, 499);
  assert.equal(r.ajustes.length, 1);
  assert.equal(r.ajustes[0].alvo, "item");
  assert.equal(r.ajustes[0].alvoRef, CLASSICO);
});

test("valor fixo: reais abatidos POR UNIDADE, como no preço legado", () => {
  const c = carrinho([item(CLASSICO, 4990, 2)]);
  const r = calcularDescontos(c, [regra({ mecanica: "valor_fixo", valor: 5 })]);

  conferirForma(r);
  // R$ 5 por unidade × 2 unidades. Se fosse por LINHA seriam 500, e "R$ 5 de
  // desconto" mudaria de significado entre o preço legado e o motor.
  assert.equal(r.totalCentavos, 1000);
});

test("preço fixo: o item passa a custar o valor, a unidade", () => {
  const c = carrinho([item(CLASSICO, 4990, 2)]);
  const r = calcularDescontos(c, [regra({ mecanica: "preco_fixo", valor: 39.9 })]);

  conferirForma(r);
  // 2 × 49,90 = 99,80 → 2 × 39,90 = 79,80. Desconto de 20,00.
  assert.equal(r.totalCentavos, 2000);
});

/* --------------------------------------------------------------------------
 * 4. O teto
 * -------------------------------------------------------------------------- */

test("teto_desconto_centavos corta o percentual, e o corte é rateado", () => {
  const c = carrinho([item(CLASSICO, 10000, 1), item(MICROLOTE, 20000, 1)]);
  const r = calcularDescontos(c, [
    regra({ mecanica: "percentual", valor: 20, tetoDescontoCentavos: 3000 }),
  ]);

  conferirForma(r);
  // 20% de 300,00 seriam 60,00; o teto trava em 30,00. E o corte é RATEADO
  // (10,00 + 20,00), porque a NF-e rateia desconto por item: um teto que
  // caísse todo numa linha faria a nota mentir sobre a outra.
  assert.equal(r.totalCentavos, 3000);
  assert.deepEqual(
    r.ajustes.map((a) => a.valorCentavos),
    [1000, 2000],
  );
});

/* --------------------------------------------------------------------------
 * 5-6. Os mínimos
 * -------------------------------------------------------------------------- */

test("minimo_tipo=subtotal que não é atingido: a regra não aplica", () => {
  const c = carrinho([item(CLASSICO, 5000, 1)]);
  const r = calcularDescontos(c, [
    regra({
      mecanica: "percentual",
      valor: 10,
      minimoTipo: "subtotal",
      minimoValor: 10000,
    }),
  ]);

  conferirForma(r);
  assert.equal(r.totalCentavos, 0);
  assert.equal(r.ajustes.length, 0);
});

/**
 * ATENÇÃO ESPECIAL 1 de 3.
 *
 * Contar o carrinho inteiro faria "leve 3 do micro-lote" ser satisfeito por 3
 * pacotes do clássico — e o desconto do micro-lote sairia com nenhum
 * micro-lote na sacola.
 */
test("minimo_tipo=quantidade conta só os itens ELEGÍVEIS, não o carrinho todo", () => {
  const soDoMicrolote = {
    mecanica: "percentual",
    valor: 15,
    minimoTipo: "quantidade",
    minimoValor: 3,
    escopo: [{ tipo: "produto", alvo: MICROLOTE, incluir: true }],
  };

  const naoAtinge = calcularDescontos(
    carrinho([item(CLASSICO, 5000, 3), item(MICROLOTE, 8000, 1)]),
    [regra(soDoMicrolote)],
  );
  conferirForma(naoAtinge);
  assert.equal(
    naoAtinge.totalCentavos,
    0,
    "3 clássicos + 1 micro-lote NÃO satisfazem 'leve 3 do micro-lote'",
  );

  const atinge = calcularDescontos(
    carrinho([item(CLASSICO, 5000, 1), item(MICROLOTE, 8000, 3)]),
    [regra(soDoMicrolote)],
  );
  conferirForma(atinge);
  // 15% de 3 × 80,00, e SÓ sobre o micro-lote.
  assert.equal(atinge.totalCentavos, 3600);
  assert.equal(atinge.ajustes[0].alvoRef, MICROLOTE);
});

/* --------------------------------------------------------------------------
 * 7. Escopo com exceção
 * -------------------------------------------------------------------------- */

test("escopo com exceção: 10% na loja toda MENOS o micro-lote", () => {
  const c = carrinho([item(CLASSICO, 4990, 1), item(MICROLOTE, 12000, 1)]);
  const r = calcularDescontos(c, [
    regra({
      mecanica: "percentual",
      valor: 10,
      escopo: [
        { tipo: "todos", alvo: null, incluir: true },
        { tipo: "produto", alvo: MICROLOTE, incluir: false },
      ],
    }),
  ]);

  conferirForma(r);
  assert.equal(r.ajustes.length, 1, "só o clássico é descontado");
  assert.equal(r.ajustes[0].alvoRef, CLASSICO);
  assert.equal(r.totalCentavos, 499);
});

/* --------------------------------------------------------------------------
 * 8-10. Precedência e exclusividade
 * -------------------------------------------------------------------------- */

test("duas regras da mesma classe: a prioridade decide a ORDEM, e a ordem muda a conta", () => {
  const c = carrinho([item(CLASSICO, 10000, 1)]);
  const r = calcularDescontos(c, [
    regra({ nome: "Cinco reais", mecanica: "valor_fixo", valor: 5, prioridade: 1 }),
    regra({ nome: "Dez por cento", mecanica: "percentual", valor: 10, prioridade: 10 }),
  ]);

  conferirForma(r);
  assert.deepEqual(
    r.ajustes.map((a) => a.rotulo),
    ["Dez por cento", "Cinco reais"],
    "prioridade maior primeiro, independente da ordem do array",
  );
  // 10% de 100,00 = 10,00; depois R$ 5 sobre a linha já em 90,00 = 5,00.
  // Na ordem inversa dariam 5,00 + 9,50 = 14,50 — a ordem não é cosmética.
  assert.equal(r.totalCentavos, 1500);
});

test("exclusiva sem grupo corta o resto da classe", () => {
  const c = carrinho([item(CLASSICO, 10000, 1)]);
  const r = calcularDescontos(c, [
    regra({ nome: "Cinco reais", mecanica: "valor_fixo", valor: 5, prioridade: 1 }),
    regra({
      nome: "Dez por cento",
      mecanica: "percentual",
      valor: 10,
      prioridade: 10,
      exclusiva: true,
    }),
  ]);

  conferirForma(r);
  assert.equal(r.ajustes.length, 1);
  assert.equal(r.ajustes[0].rotulo, "Dez por cento");
  assert.equal(r.totalCentavos, 1000);
});

test("grupo_exclusividade: só uma do grupo passa, e o resto da classe segue", () => {
  const c = carrinho([item(CLASSICO, 10000, 1)]);
  const r = calcularDescontos(c, [
    regra({
      nome: "Pix 10%",
      classe: "pedido",
      mecanica: "percentual",
      valor: 10,
      prioridade: 10,
      exclusiva: true,
      grupoExclusividade: "pagamento",
      escopo: [],
    }),
    regra({
      nome: "Pix 20%",
      classe: "pedido",
      mecanica: "percentual",
      valor: 20,
      prioridade: 5,
      exclusiva: true,
      grupoExclusividade: "pagamento",
      escopo: [],
    }),
    regra({
      nome: "Clube 5%",
      classe: "pedido",
      mecanica: "percentual",
      valor: 5,
      prioridade: 1,
      escopo: [],
    }),
  ]);

  conferirForma(r);
  assert.deepEqual(
    r.ajustes.map((a) => a.rotulo),
    ["Pix 10%", "Clube 5%"],
    "a segunda do grupo é cortada; a de fora do grupo continua somando",
  );
  assert.equal(r.totalCentavos, 1500);
});

test("exclusiva que NÃO chegou a aplicar não cala a classe", () => {
  const c = carrinho([item(CLASSICO, 5000, 1)]);
  const r = calcularDescontos(c, [
    regra({
      nome: "Acima de cem",
      mecanica: "percentual",
      valor: 30,
      prioridade: 10,
      exclusiva: true,
      minimoTipo: "subtotal",
      minimoValor: 10000,
    }),
    regra({ nome: "Sempre 10%", mecanica: "percentual", valor: 10, prioridade: 1 }),
  ]);

  conferirForma(r);
  // Uma regra que não atingiu o mínimo é uma regra que NÃO ACONTECEU; calar as
  // outras por causa dela deixaria o carrinho sem desconto nenhum e ninguém
  // conseguiria explicar por quê.
  assert.equal(r.ajustes.length, 1);
  assert.equal(r.ajustes[0].rotulo, "Sempre 10%");
  assert.equal(r.totalCentavos, 500);
});

/* --------------------------------------------------------------------------
 * 11-12. Faixas
 * -------------------------------------------------------------------------- */

test("leve 3 pague 2 com 7 unidades: 2 grátis, sobra 1", () => {
  const c = carrinho([item(CLASSICO, 3000, 7)]);
  const r = calcularDescontos(c, [
    regra({
      mecanica: "leve_x_pague_y",
      valor: 3,
      faixas: [{ quantidadeMin: 3, descontoTipo: "pague_y", descontoValor: 2 }],
    }),
  ]);

  conferirForma(r);
  // floor(7 / 3) = 2 grupos completos, 1 unidade grátis cada → 2 grátis.
  assert.equal(r.totalCentavos, 6000);
  assert.equal(
    subtotalDe(c) - r.totalCentavos,
    15000,
    "sobram 5 unidades pagas de 7",
  );
});

/**
 * ATENÇÃO ESPECIAL 2 de 3.
 *
 * Somar as faixas dá desconto composto que ninguém cadastrou: "5% a partir de
 * 3, 10% a partir de 6" viraria 15% em seis unidades.
 */
test("progressivo: a faixa mais ALTA atingida ganha, não a soma das faixas", () => {
  const c = carrinho([item(CLASSICO, 2000, 6)]);
  const r = calcularDescontos(c, [
    regra({
      mecanica: "progressivo",
      faixas: [
        { quantidadeMin: 3, descontoTipo: "percentual", descontoValor: 5 },
        { quantidadeMin: 6, descontoTipo: "percentual", descontoValor: 10 },
      ],
    }),
  ]);

  conferirForma(r);
  assert.equal(r.totalCentavos, 1200, "10% de 120,00 — nunca 5% + 10%");
  assert.equal(r.ajustes.length, 1, "uma faixa, um ajuste");
});

/* --------------------------------------------------------------------------
 * 13-14. Frete
 * -------------------------------------------------------------------------- */

function regraDeFreteGratis(cfg = {}) {
  return regra({
    nome: "Frete grátis",
    classe: "frete",
    mecanica: "frete_gratis",
    escopo: [],
    frete: {
      tetoFreteCentavos: null,
      ufs: null,
      apenasModalidadeMaisBarata: false,
      cepInicio: null,
      cepFim: null,
      ...cfg,
    },
  });
}

test("frete grátis com teto: a modalidade ACIMA do teto não fica grátis", () => {
  const cara = calcularDescontos(
    carrinho([item(CLASSICO, 20000, 1)], {
      frete: { valorCentavos: 9000, metodo: "Correios SEDEX", ehMaisBarata: false },
    }),
    [regraDeFreteGratis({ tetoFreteCentavos: 3000 })],
  );
  conferirForma(cara);
  // O teto NÃO abate 30,00 de um frete de 90,00: a regra simplesmente não vale,
  // e o cliente paga o frete inteiro. Bancar meio SEDEX para o Acre é
  // exatamente o que o campo existe para impedir.
  assert.equal(cara.totalCentavos, 0);

  const barata = calcularDescontos(
    carrinho([item(CLASSICO, 20000, 1)], {
      frete: { valorCentavos: 2500, metodo: "Correios PAC", ehMaisBarata: true },
    }),
    [regraDeFreteGratis({ tetoFreteCentavos: 3000 })],
  );
  conferirForma(barata);
  assert.equal(barata.totalCentavos, 2500);
  assert.equal(barata.ajustes[0].alvo, "frete");
});

test("frete grátis só na modalidade mais barata", () => {
  const sedex = calcularDescontos(
    carrinho([item(CLASSICO, 20000, 1)], {
      frete: { valorCentavos: 4000, metodo: "SEDEX", ehMaisBarata: false },
    }),
    [regraDeFreteGratis({ apenasModalidadeMaisBarata: true })],
  );
  conferirForma(sedex);
  assert.equal(sedex.totalCentavos, 0, "SEDEX de graça é o que a loja não quis");

  const pac = calcularDescontos(
    carrinho([item(CLASSICO, 20000, 1)], {
      frete: { valorCentavos: 2000, metodo: "PAC", ehMaisBarata: true },
    }),
    [regraDeFreteGratis({ apenasModalidadeMaisBarata: true })],
  );
  conferirForma(pac);
  assert.equal(pac.totalCentavos, 2000);
});

test("frete: UF fora da lista e CEP fora da faixa não valem", () => {
  const base = carrinho([item(CLASSICO, 20000, 1)], {
    frete: {
      valorCentavos: 2500,
      metodo: "PAC",
      ehMaisBarata: true,
      uf: "MG",
      cep: "38402-330",
    },
  });

  assert.equal(
    calcularDescontos(base, [regraDeFreteGratis({ ufs: ["SP", "RJ"] })]).totalCentavos,
    0,
  );
  assert.equal(
    calcularDescontos(base, [regraDeFreteGratis({ ufs: ["MG"] })]).totalCentavos,
    2500,
  );
  assert.equal(
    calcularDescontos(base, [
      regraDeFreteGratis({ cepInicio: "01000000", cepFim: "09999999" }),
    ]).totalCentavos,
    0,
  );
  // O CEP chegou com hífen e mesmo assim casa: comparar '38402-330' com
  // '38402330' é o bug que passa em todo teste escrito com o formato certo.
  assert.equal(
    calcularDescontos(base, [
      regraDeFreteGratis({ cepInicio: "30000000", cepFim: "39999999" }),
    ]).totalCentavos,
    2500,
  );
});

/* --------------------------------------------------------------------------
 * 15. Meio de pagamento
 * -------------------------------------------------------------------------- */

test("meio de pagamento: regra de PIX não aplica em cartão", () => {
  const regraPix = regra({
    nome: "Pix 5%",
    mecanica: "percentual",
    valor: 5,
    meiosPagamento: ["pix"],
  });

  const noCartao = calcularDescontos(
    carrinho([item(CLASSICO, 10000, 1)], { meioPagamento: "credito" }),
    [regraPix],
  );
  conferirForma(noCartao);
  assert.equal(noCartao.totalCentavos, 0);

  const noPix = calcularDescontos(
    carrinho([item(CLASSICO, 10000, 1)], { meioPagamento: "pix" }),
    [regraPix],
  );
  conferirForma(noPix);
  assert.equal(noPix.totalCentavos, 500);

  // Meio DESCONHECIDO não ganha o desconto: um abatimento que a cobrança não
  // consegue justificar depois é pior que abatimento nenhum.
  const semMeio = calcularDescontos(
    carrinho([item(CLASSICO, 10000, 1)], { meioPagamento: null }),
    [regraPix],
  );
  assert.equal(semMeio.totalCentavos, 0);
});

test("meioDePagamentoDaLoja traduz o vocabulário ABERTO do Mercado Pago", () => {
  // A lista do MP é aberta ('visa', 'master', 'elo', 'amex'...): uma regra
  // escrita contra 'visa' não se aplicaria a um Mastercard, em silêncio.
  assert.equal(meioDePagamentoDaLoja("pix"), "pix");
  assert.equal(meioDePagamentoDaLoja("bank_transfer"), "pix");
  assert.equal(meioDePagamentoDaLoja("bolbradesco"), "boleto");
  assert.equal(meioDePagamentoDaLoja("debvisa"), "debito");
  assert.equal(meioDePagamentoDaLoja("debmaster"), "debito");
  assert.equal(meioDePagamentoDaLoja("visa"), "credito");
  assert.equal(meioDePagamentoDaLoja("master"), "credito");
  assert.equal(meioDePagamentoDaLoja("hipercard"), "credito");
  assert.equal(meioDePagamentoDaLoja(""), null);
  assert.equal(meioDePagamentoDaLoja(undefined), null);
});

/* --------------------------------------------------------------------------
 * 16. Os tetos naturais
 * -------------------------------------------------------------------------- */

test("o desconto nunca ultrapassa o valor da linha nem o do pedido", () => {
  const naLinha = calcularDescontos(carrinho([item(CLASSICO, 1200, 1)]), [
    regra({ mecanica: "valor_fixo", valor: 20 }),
  ]);
  conferirForma(naLinha);
  // R$ 20 sobre um café de R$ 12 zera o café e PARA — não vira crédito nos
  // outros itens, que é como a soma do pedido ficaria negativa.
  assert.equal(naLinha.totalCentavos, 1200);

  const noPedido = calcularDescontos(carrinho([item(CLASSICO, 10000, 1)]), [
    regra({
      nome: "Oitenta A",
      classe: "pedido",
      mecanica: "valor_fixo",
      valor: 80,
      prioridade: 10,
      escopo: [],
    }),
    regra({
      nome: "Oitenta B",
      classe: "pedido",
      mecanica: "valor_fixo",
      valor: 80,
      prioridade: 1,
      escopo: [],
    }),
  ]);
  conferirForma(noPedido);
  assert.equal(noPedido.totalCentavos, 10000, "nunca mais que o próprio pedido");
  assert.deepEqual(
    noPedido.ajustes.map((a) => a.valorCentavos),
    [8000, 2000],
  );
});

/* --------------------------------------------------------------------------
 * 17. Arredondamento — a linha que o plano chama de não-cosmética
 * -------------------------------------------------------------------------- */

/**
 * ATENÇÃO ESPECIAL 3 de 3.
 *
 * `utils/preco.js` já documenta que 10% sobre 49,90 em float dá
 * 44.910000000000004, e esse número iria para o `itens` jsonb IMUTÁVEL do
 * pedido e para a soma cobrada no gateway. Aqui há o segundo credor: cada
 * ajuste vira uma linha de `pedido_ajustes_desconto`, e "por que este pedido
 * saiu por R$ 137,40?" só tem resposta se a soma das linhas for exatamente a
 * diferença do subtotal.
 */
test("arredondamento: o total dos ajustes bate com a diferença do subtotal, ao centavo", () => {
  const c = carrinho([item(CLASSICO, 4990, 3), item(MICROLOTE, 3333, 1)]);
  const r = calcularDescontos(c, [
    regra({ nome: "Vitrine 10%", mecanica: "percentual", valor: 10, prioridade: 10 }),
    regra({
      nome: "Cupom 10%",
      classe: "pedido",
      mecanica: "percentual",
      valor: 10,
      prioridade: 5,
      escopo: [],
      codigo: { id: "aaaaaaaa-0000-4000-8000-000000000001", codigo: "CAFE10" },
    }),
  ]);

  conferirForma(r);

  // Etapa 1, linha a linha: 149,70 → 14,97 e 33,33 → 3,33 (round, não trunc).
  // Etapa 2 sobre o subtotal JÁ reduzido: 164,73 → 16,47 (round de 16,473).
  assert.deepEqual(
    r.ajustes.map((a) => a.valorCentavos),
    [1497, 333, 1647],
  );
  assert.equal(r.totalCentavos, 3477);

  // A identidade, reconstruída de fora: subtotal de catálogo menos a soma dos
  // ajustes é o valor dos itens a cobrar, e os dois são inteiros.
  const subtotal = subtotalDe(c);
  assert.equal(subtotal, 18303);
  assert.equal(subtotal - r.totalCentavos, 14826);
  assert.ok(Number.isSafeInteger(subtotal - r.totalCentavos));

  // E o código viaja junto do ajuste — é o que `pedido_ajustes_desconto.codigo`
  // guarda como fotografia, para o relatório não depender da campanha viva.
  assert.equal(r.ajustes[2].codigo, "CAFE10");
  assert.equal(r.ajustes[0].codigo, null);
});

/* --------------------------------------------------------------------------
 * Acréscimos: as regras de composição que a tabela pressupõe
 * -------------------------------------------------------------------------- */

test("a etapa 2 incide sobre o subtotal JÁ REDUZIDO pela etapa 1", () => {
  const r = calcularDescontos(carrinho([item(CLASSICO, 10000, 1)]), [
    regra({ nome: "Produto 10%", mecanica: "percentual", valor: 10, prioridade: 10 }),
    regra({
      nome: "Pedido 10%",
      classe: "pedido",
      mecanica: "percentual",
      valor: 10,
      prioridade: 5,
      escopo: [],
    }),
  ]);

  conferirForma(r);
  // 10,00 na linha; depois 10% de 90,00 = 9,00. Sobre o subtotal CHEIO seriam
  // 10,00 e o cliente pagaria 80,00 em vez de 81,00.
  assert.deepEqual(
    r.ajustes.map((a) => a.valorCentavos),
    [1000, 900],
  );
});

test("dois percentuais de PEDIDO incidem sobre a mesma base, nunca compostos", () => {
  const r = calcularDescontos(carrinho([item(CLASSICO, 10000, 1)]), [
    regra({
      nome: "Pedido 10%",
      classe: "pedido",
      mecanica: "percentual",
      valor: 10,
      prioridade: 10,
      escopo: [],
    }),
    regra({
      nome: "Pedido 20%",
      classe: "pedido",
      mecanica: "percentual",
      valor: 20,
      prioridade: 5,
      escopo: [],
    }),
  ]);

  conferirForma(r);
  // 20% de 100,00 = 20,00. Composto sobre os 90,00 que sobraram daria 18,00 —
  // um desconto que ninguém cadastrou, para mais ou para menos conforme a ordem.
  assert.deepEqual(
    r.ajustes.map((a) => a.valorCentavos),
    [1000, 2000],
  );
});

test("a exclusividade é por CLASSE: produto exclusivo não cala o frete", () => {
  const r = calcularDescontos(
    carrinho([item(CLASSICO, 10000, 1)], {
      frete: { valorCentavos: 2000, metodo: "PAC", ehMaisBarata: true },
    }),
    [
      regra({
        nome: "Produto exclusivo",
        mecanica: "percentual",
        valor: 10,
        exclusiva: true,
      }),
      regraDeFreteGratis(),
    ],
  );

  conferirForma(r);
  assert.deepEqual(
    r.ajustes.map((a) => a.alvo),
    ["item", "frete"],
  );
  assert.equal(r.totalCentavos, 3000);
});

test("sem escopo: a regra de PRODUTO é inerte; a de PEDIDO vale o pedido inteiro", () => {
  const c = carrinho([item(CLASSICO, 10000, 1)]);

  const produtoSemEscopo = calcularDescontos(c, [
    regra({ mecanica: "percentual", valor: 10, escopo: [] }),
  ]);
  // É o comportamento que a 0032 preservou ao migrar as promoções legadas sem
  // `aplica_a` utilizável: "sem linha de escopo elas continuam inertes".
  assert.equal(produtoSemEscopo.totalCentavos, 0);

  const pedidoSemEscopo = calcularDescontos(c, [
    regra({ classe: "pedido", mecanica: "percentual", valor: 10, escopo: [] }),
  ]);
  // É o que o cupom SEMPRE foi — `utils/cupom.js` desconta sobre o subtotal,
  // sem escopo nenhum, e foi assim que a 0032 migrou `cupons`.
  assert.equal(pedidoSemEscopo.totalCentavos, 1000);
});

test("o porteiro `assinante` liga e desliga a regra pelo Clube", () => {
  const soAssinante = regra({
    mecanica: "percentual",
    valor: 10,
    escopo: [
      { tipo: "todos", alvo: null, incluir: true },
      { tipo: "assinante", alvo: null, incluir: true },
    ],
  });

  assert.equal(
    calcularDescontos(carrinho([item(CLASSICO, 10000, 1)], { assinante: false }), [
      soAssinante,
    ]).totalCentavos,
    0,
  );
  assert.equal(
    calcularDescontos(carrinho([item(CLASSICO, 10000, 1)], { assinante: true }), [
      soAssinante,
    ]).totalCentavos,
    1000,
  );
});

test("escopo por categoria e por SKU, com a normalização de preco.js", () => {
  const c = carrinho([
    item(CLASSICO, 10000, 1, { categoria: "Café Especial", sku: "CLAS-250" }),
    item(MICROLOTE, 20000, 1, { categoria: "Acessórios", sku: "ACES-01" }),
  ]);

  const porCategoria = calcularDescontos(c, [
    regra({
      mecanica: "percentual",
      valor: 10,
      // Espaço e caixa diferentes: a mesma normalização que `precoComPromocao`
      // faz há três ondas, para o cadastro não depender de digitação exata.
      escopo: [{ tipo: "categoria", alvo: "  café especial ", incluir: true }],
    }),
  ]);
  conferirForma(porCategoria);
  assert.equal(porCategoria.totalCentavos, 1000);
  assert.equal(porCategoria.ajustes[0].alvoRef, CLASSICO);

  const porSku = calcularDescontos(c, [
    regra({
      mecanica: "percentual",
      valor: 10,
      escopo: [{ tipo: "sku", alvo: "ACES-01", incluir: true }],
    }),
  ]);
  conferirForma(porSku);
  assert.equal(porSku.totalCentavos, 2000);
  assert.equal(porSku.ajustes[0].alvoRef, MICROLOTE);
});

test("carrinho vazio, regras vazias e regra de classe desconhecida não quebram", () => {
  assert.deepEqual(calcularDescontos(carrinho([]), []), {
    ajustes: [],
    totalCentavos: 0,
  });
  assert.deepEqual(calcularDescontos({}, null), { ajustes: [], totalCentavos: 0 });
  const r = calcularDescontos(carrinho([item(CLASSICO, 1000, 1)]), [
    regra({ classe: "assinatura", mecanica: "percentual", valor: 10 }),
  ]);
  assert.equal(r.totalCentavos, 0);
});

/**
 * O ITEM SEM IDENTIFICADOR — o defeito que passava pelo CHECK.
 *
 * `alvoRef` saía de `String(item.produtoId)`, e `String(null)` é a string
 * `"null"`. O CHECK `pedido_ajustes_alvo_ref_coerente` (0032) exige
 * `alvo_ref IS NOT NULL AND btrim(alvo_ref) <> ''` — e `"null"` satisfaz os
 * dois. Ou seja: um item de carrinho sem `produtoId` gravaria a PALAVRA "null"
 * na tabela que existe justamente para responder "por que este pedido saiu por
 * R$ 137,40?".
 *
 * Não é hipótese de laboratório: kit e variante nem sempre carregam
 * `produtoId`, e o `itens` de `pedidos` é jsonb sem FK — ninguém do lado do
 * banco recusaria a linha.
 *
 * O conserto é de FRONTEIRA e tem duas metades. O `sku` serve de referência
 * quando não há `produtoId`, porque ele é identificador de verdade (é a chave
 * por onde a avaliação e o Bling falam do mesmo produto). E item sem NENHUM
 * dos dois faz o motor RECUSAR, alto, antes de qualquer conta de dinheiro:
 * carrinho assim é defeito de quem chamou, e seguir em frente trocaria um erro
 * visível por uma auditoria corrompida em silêncio.
 */
test("item sem produtoId usa o SKU como referência, e nunca a string 'null'", () => {
  const r = calcularDescontos(
    carrinho([{ produtoId: null, sku: "KIT-3X250", categoria: "cafe", precoCentavos: 12000, quantidade: 1 }]),
    [regra({ mecanica: "percentual", valor: 10 })],
  );
  assert.equal(r.totalCentavos, 1200);
  assert.equal(r.ajustes[0].alvoRef, "KIT-3X250");
  assert.notEqual(r.ajustes[0].alvoRef, "null");
});

test("item sem produtoId E sem sku faz o motor recusar, em vez de gravar lixo", () => {
  assert.throws(
    () =>
      calcularDescontos(
        carrinho([{ produtoId: null, sku: null, categoria: "cafe", precoCentavos: 1000, quantidade: 1 }]),
        [regra({ mecanica: "percentual", valor: 10 })],
      ),
    /identificador/i,
  );
});
