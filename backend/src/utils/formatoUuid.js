"use strict";

/**
 * A forma de um UUID, em UM lugar só.
 *
 * POR QUE EXISTE: `conta.routes.js` e `lgpd.routes.js` carregavam a MESMA
 * expressão, copiada verbatim, e as duas guardam a mesma fronteira — o
 * identificador que vem da URL antes de virar `$1::uuid` numa consulta. Um
 * texto qualquer no lugar do id estoura 22P02 no meio do handler e vira um 500
 * opaco; pior, num caminho DESTRUTIVO (exclusão de conta, redação LGPD) o erro
 * chega tarde demais para dizer o que aconteceu. A checagem tem de ser a mesma
 * nos dois, e cópia divergindo é questão de tempo: a primeira correção só
 * acerta uma delas.
 *
 * OUTROS MÓDULOS AINDA CARREGAM A PRÓPRIA CÓPIA (ClubeController,
 * OrderController, CuponsController, PaymentController, bling.routes,
 * isAuthenticated). Não foram migrados aqui de propósito — cada um é
 * território de outra onda, e mexer neles junto misturaria a correção com
 * risco alheio. Este módulo é o destino quando alguém passar por lá.
 *
 * NÃO É VALIDAÇÃO DE UUID DE VERDADE, e não precisa ser: não confere versão nem
 * variante. O trabalho dela é impedir que lixo chegue ao cast do Postgres — a
 * existência de fato é a consulta seguinte que responde (e o 404 uniforme que
 * as rotas dão vale tanto para "nunca existiu" quanto para "não é desta loja").
 *
 * SEM a flag `g`, de propósito: `RegExp.prototype.test` com `g` carrega
 * `lastIndex` entre chamadas e alterna resultados para a MESMA entrada. Numa
 * constante compartilhada por dois módulos isso seria um bug intermitente de
 * origem impossível de achar.
 */
const FORMATO_UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * `ehUuid(valor)` — a pergunta que os dois chamadores realmente fazem, com o
 * `String(... || "")` embutido: `undefined`/`null` respondem `false` em vez de
 * virarem a string "undefined" (que também responderia `false`, mas por
 * acidente).
 */
function ehUuid(valor) {
  return FORMATO_UUID.test(String(valor || ""));
}

module.exports = { FORMATO_UUID, ehUuid };
