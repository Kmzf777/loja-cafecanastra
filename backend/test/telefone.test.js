"use strict";

/**
 * A normalizacao de telefone para a Cloud API, e a armadilha que e do Brasil.
 *
 * Sem banco e sem rede de proposito: e funcao pura, e o teste que precisa de
 * mock pesado e sinal de que o codigo esta no lugar errado.
 */

const { test } = require("node:test");
const assert = require("node:assert/strict");
const { paraE164, variantesBrasil, ultimosQuatro } = require("../src/utils/telefone.js");

test("tira mascara e devolve E.164 com o 55 na frente", () => {
  assert.equal(paraE164("(31) 99999-0000"), "5531999990000");
  assert.equal(paraE164("31 99999 0000"), "5531999990000");
  assert.equal(paraE164("31999990000"), "5531999990000");
});

test("aceita o numero que ja vem com o 55", () => {
  assert.equal(paraE164("5531999990000"), "5531999990000");
  assert.equal(paraE164("+55 31 99999-0000"), "5531999990000");
});

test("aceita fixo e celular de oito digitos", () => {
  assert.equal(paraE164("3133330000"), "553133330000");
});

test("devolve null para o que nao e telefone brasileiro", () => {
  // O modo de falha que isto impede: mandar lixo para a Meta gasta cota e
  // derruba a nota de qualidade do numero.
  assert.equal(paraE164(""), null);
  assert.equal(paraE164(null), null);
  assert.equal(paraE164("999"), null);
  assert.equal(paraE164("31999990000999999"), null);
  assert.equal(paraE164("(31) 9999-000A"), null);
});

test("devolve as duas formas do nono digito, sem repetir", () => {
  // A doc da Meta: "For Brazil and Mexico, the extra added prefix of the phone
  // number may be modified by the Cloud API". O webhook pode voltar sem o 9.
  assert.deepEqual(variantesBrasil("5531999990000"), [
    "5531999990000",
    "553199990000",
  ]);
  assert.deepEqual(variantesBrasil("553199990000"), [
    "553199990000",
    "5531999990000",
  ]);
});

test("fixo nao ganha variante de nono digito", () => {
  // Acrescentar 9 a um fixo produz um numero que nao existe.
  assert.deepEqual(variantesBrasil("553133330000"), ["553133330000"]);
});

test("variantesBrasil devolve lista vazia para entrada invalida", () => {
  assert.deepEqual(variantesBrasil("abc"), []);
});

test("ultimosQuatro devolve so o fim, para o painel", () => {
  assert.equal(ultimosQuatro("5531999990000"), "0000");
  assert.equal(ultimosQuatro("(31) 99999-1234"), "1234");
  assert.equal(ultimosQuatro(null), null);
});
