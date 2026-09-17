"use strict";

/**
 * O FRETE SIMULADO — o que a loja oferece enquanto a cotação real não volta.
 *
 * POR QUE ELE EXISTE, e por que é honesto chamá-lo de simulado. A integração
 * com o Melhor Envio é, e sempre foi, **só cotação**: `shipment/calculate` é o
 * único endpoint dela no código inteiro. A loja nunca comprou etiqueta — quem
 * compra é a operação, à mão, no painel do Melhor Envio, depois que o pedido
 * entra. Escolher uma opção no checkout grava nome e preço no pedido, e nada
 * mais. Isso não muda com este módulo.
 *
 * O que este módulo substitui é a COTAÇÃO, enquanto ela está inalcançável: o
 * firewall do Melhor Envio bloqueia o IP desta VPS no sandbox (E-WAF-0003,
 * medido em 17/09/2026). Uma opção fixa destrava a venda, mas não exercita a
 * ESCOLHA — e escolha de frete é metade do checkout: o preço muda, o total
 * muda, o CardForm remonta com o novo valor, o `conferirFrete` casa nome e
 * preço. Com uma opção só, nada disso é testado.
 *
 * OS NÚMEROS SÃO PLACEHOLDER, E O NOME DO ARQUIVO DIZ ISSO. Não são tabela de
 * transportadora, não foram negociados com ninguém, e não devem sobreviver ao
 * dia em que a cotação real voltar — ela desliga este caminho inteiro
 * (`melhorEnvioAtiva()`).
 */

const { test } = require("node:test");
const assert = require("node:assert/strict");

const { cotarFreteSimulado } = require("../src/utils/freteSimulado.js");

/** Um item de 250 g, o pacote de café que a loja mais vende. */
const CAFE = { price: 39.7, quantity: 1, weight: 0.25 };

/** CEPs reais, um por zona, a partir da origem em Uberlândia (38402330). */
const SAO_PAULO = "01310100";   // Sudeste — a mesma zona da origem
const PORTO_ALEGRE = "90010150"; // Sul
const MANAUS = "69005010";       // Norte

test("oferece DUAS modalidades, para a escolha existir de verdade", () => {
  const opcoes = cotarFreteSimulado({ cep: SAO_PAULO, itens: [CAFE] });

  assert.deepEqual(
    opcoes.map((o) => o.name),
    ["Entrega padrão", "Entrega expressa"],
  );
  // Ids estáveis: o navegador casa a escolha por id, e o `conferirFrete` por
  // nome e preço. Os dois precisam ser determinísticos.
  assert.deepEqual(opcoes.map((o) => o.id), ["simulado-padrao", "simulado-expresso"]);
});

test("a expressa custa mais e chega antes — senão não é escolha", () => {
  const [padrao, expressa] = cotarFreteSimulado({ cep: SAO_PAULO, itens: [CAFE] });

  assert.ok(expressa.price > padrao.price, "expressa mais cara");
  assert.ok(expressa.days < padrao.days, "expressa mais rápida");
});

test("mais longe custa mais e demora mais", () => {
  const perto = cotarFreteSimulado({ cep: SAO_PAULO, itens: [CAFE] })[0];
  const sul = cotarFreteSimulado({ cep: PORTO_ALEGRE, itens: [CAFE] })[0];
  const norte = cotarFreteSimulado({ cep: MANAUS, itens: [CAFE] })[0];

  assert.ok(sul.price > perto.price, "Sul mais caro que Sudeste");
  assert.ok(norte.price > sul.price, "Norte mais caro que Sul");
  assert.ok(norte.days > perto.days, "Norte demora mais");
});

test("carrinho mais pesado custa mais — é o que o cliente espera ver", () => {
  const um = cotarFreteSimulado({ cep: SAO_PAULO, itens: [CAFE] })[0];
  const seis = cotarFreteSimulado({
    cep: SAO_PAULO,
    itens: [{ ...CAFE, quantity: 6 }],
  })[0];

  assert.ok(seis.price > um.price, `6 pacotes (${seis.price}) > 1 (${um.price})`);
});

test("o preço tem duas casas — dinheiro não anda com dízima", () => {
  for (const cep of [SAO_PAULO, PORTO_ALEGRE, MANAUS]) {
    for (const o of cotarFreteSimulado({ cep, itens: [{ ...CAFE, quantity: 3 }] })) {
      assert.equal(
        o.price,
        Number(o.price.toFixed(2)),
        `${o.name} para ${cep} veio ${o.price}`,
      );
    }
  }
});

test("item sem peso cai no peso padrão, e não em NaN", () => {
  // `weight` é NOT NULL no banco (default 0.3), mas a cotação pública recebe
  // itens do NAVEGADOR — e de lá vem o que o navegador quiser.
  const opcoes = cotarFreteSimulado({ cep: SAO_PAULO, itens: [{ price: 39.7, quantity: 1 }] });
  for (const o of opcoes) assert.ok(Number.isFinite(o.price), `${o.name} = ${o.price}`);
});

test("CEP irreconhecível não derruba a cotação — cai na zona mais cara", () => {
  // Errar para o lado caro é o lado seguro: a loja cobra a mais de um CEP
  // estranho em vez de bancar um frete que não previu.
  const opcoes = cotarFreteSimulado({ cep: "", itens: [CAFE] });
  assert.ok(opcoes.length === 2);
  const norte = cotarFreteSimulado({ cep: MANAUS, itens: [CAFE] })[0];
  assert.equal(opcoes[0].price, norte.price);
});

test("toda opção é marcada como SIMULADA, e a vitrine pode dizer isso", () => {
  for (const o of cotarFreteSimulado({ cep: SAO_PAULO, itens: [CAFE] })) {
    assert.equal(o.simulado, true);
  }
});
