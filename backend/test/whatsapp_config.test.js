"use strict";

/**
 * A credencial e os interruptores. Banco REAL porque a ordem de precedencia
 * (memoria -> banco -> env) e a garantia de que a linha 1 existe sao
 * exatamente o que um duble de pool nao prova.
 */

const { test, before, after, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const { subirPostgres } = require("./ajuda/postgres.js");
const { aplicarMigracoes } = require("../db/migrar.js");

let bd;
let config;

before(async () => {
  bd = await subirPostgres();
  await aplicarMigracoes(bd.pool);

  // DATABASE_URL ANTES do require de src/ — pgPool.js le a variavel ao ser
  // carregado, e um require adiantado apontaria para o banco errado.
  process.env.DATABASE_URL = bd.connectionString;
  process.env.NODE_ENV = "development";

  config = require("../src/services/whatsappConfig.js");
}, { timeout: 120_000 });

after(async () => {
  await require("../src/pgPool.js").end().catch(() => {});
  await bd?.derrubar();
});

beforeEach(async () => {
  if (!bd) {
    throw new Error("O Postgres nao subiu no before(); a causa real esta no erro daquele hook.");
  }
  await bd.pool.query("DELETE FROM canastra.whatsapp_config");
  config.esquecer();
  delete process.env.META_ACCESS_TOKEN;
  delete process.env.META_PHONE_NUMBER_ID;
});

test("sem banco e sem env, a integracao nao esta configurada", async () => {
  const atual = await config.carregar();
  assert.equal(atual.ativo, false);
  assert.equal(config.configurado(atual), false);
});

test("a env vale como semente quando o banco esta vazio", async () => {
  process.env.META_ACCESS_TOKEN = "EAAG-token-da-env";
  process.env.META_PHONE_NUMBER_ID = "111";
  config.esquecer();

  const atual = await config.carregar();
  assert.equal(atual.access_token, "EAAG-token-da-env");
  assert.equal(atual.phone_number_id, "111");
});

test("o que o painel gravou vence a env", async () => {
  // A ordem e memoria -> banco -> env, a mesma de blingClient.js:118-136: o
  // painel e a fonte, a env e a semente.
  process.env.META_ACCESS_TOKEN = "EAAG-token-da-env";
  await config.gravar({ access_token: "EAAG-token-do-painel" });

  const atual = await config.carregar();
  assert.equal(atual.access_token, "EAAG-token-do-painel");
});

test("gravar cria a linha 1 quando ela nao existe", async () => {
  // Sem o INSERT ... ON CONFLICT DO NOTHING, o UPDATE seria no-op SILENCIOSO
  // numa instalacao sem seed — o gestor salvaria e nada aconteceria.
  await config.gravar({ phone_number_id: "222" });
  const { rows } = await bd.pool.query("SELECT id, phone_number_id FROM canastra.whatsapp_config");
  assert.equal(rows.length, 1);
  assert.equal(rows[0].id, 1);
  assert.equal(rows[0].phone_number_id, "222");
});

test("gravar e parcial: o que nao vem no corpo nao e apagado", async () => {
  await config.gravar({ access_token: "tok", phone_number_id: "333" });
  await config.gravar({ phone_number_id: "444" });

  const atual = await config.carregar();
  assert.equal(atual.access_token, "tok");
  assert.equal(atual.phone_number_id, "444");
});

test("configurado() exige token, phone_number_id e o interruptor ligado", async () => {
  await config.gravar({ access_token: "tok", phone_number_id: "555" });
  assert.equal(config.configurado(await config.carregar()), false, "ativo false");

  await config.gravar({ ativo: true });
  assert.equal(config.configurado(await config.carregar()), true);

  await config.gravar({ access_token: null });
  assert.equal(config.configurado(await config.carregar()), false, "sem token");
});

test("paraOPainel devolve mascara, nunca o segredo", async () => {
  // O modo de falha que isto impede: um GET que devolve o token deixa o
  // segredo no cache do navegador, no log do proxy e no DevTools de quem abrir.
  await config.gravar({ access_token: "EAAGsuperSecretoLongo4821", app_secret: "abc123" });
  const visivel = await config.paraOPainel();

  assert.equal(visivel.access_token, undefined);
  assert.equal(visivel.app_secret, undefined);
  assert.equal(visivel.access_token_mascara, "••••4821");
  assert.equal(visivel.app_secret_mascara, "••••c123");
  assert.equal(JSON.stringify(visivel).includes("superSecreto"), false);
});

test("mascara de valor curto nao revela o valor", async () => {
  await config.gravar({ access_token: "abc" });
  const visivel = await config.paraOPainel();
  assert.equal(visivel.access_token_mascara, "••••");
});

test("avisoLigado responde por status, e o desconhecido e nao", async () => {
  await config.gravar({ aviso_enviado: true, aviso_entregue: false });
  const atual = await config.carregar();

  assert.equal(config.avisoLigado(atual, "enviado"), true);
  assert.equal(config.avisoLigado(atual, "entregue"), false);
  // `rejeitado` compartilha o interruptor de `cancelado`, como o template.
  await config.gravar({ aviso_cancelado: false });
  assert.equal(config.avisoLigado(await config.carregar(), "rejeitado"), false);
  assert.equal(config.avisoLigado(atual, "em_processamento"), false);
});
