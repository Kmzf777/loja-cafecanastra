"use strict";

/**
 * F8 — o ciclo de vida do token da Melhor Envio.
 *
 * `fetchImpl` é injetável no serviço justamente para este arquivo: o fluxo
 * OAuth inteiro se prova sem rede. O molde é o de `f7_bling.test.js`.
 */

const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { subirPostgres } = require("./ajuda/postgres.js");
const { aplicarMigracoes } = require("../db/migrar.js");

let bd;

before(async () => {
  bd = await subirPostgres();
  await aplicarMigracoes(bd.pool);
  await bd.pool.query("INSERT INTO canastra.config_loja (id) VALUES (1)");
  process.env.DATABASE_URL = bd.connectionString;
}, { timeout: 120_000 });

after(async () => {
  await bd?.derrubar();
});

test("a migração 0017 cria as colunas de token e de etiqueta", async () => {
  const { rows: config } = await bd.pool.query(
    `SELECT column_name FROM information_schema.columns
      WHERE table_schema = 'canastra' AND table_name = 'config_loja'
        AND column_name LIKE 'melhor_envio%'
      ORDER BY column_name`,
  );
  assert.deepEqual(config.map((r) => r.column_name), [
    "melhor_envio_refresh_token",
    "melhor_envio_token_expira_em",
  ]);

  const { rows: pedidos } = await bd.pool.query(
    `SELECT column_name FROM information_schema.columns
      WHERE table_schema = 'canastra' AND table_name = 'pedidos'
        AND column_name LIKE 'me\\_%'
      ORDER BY column_name`,
  );
  assert.deepEqual(pedidos.map((r) => r.column_name), [
    "me_claim_em",
    "me_comprada_em",
    "me_order_id",
    "me_protocolo",
    "me_servico_id",
    "me_situacao",
  ]);
});

test("o refresh token da Melhor Envio não é legível por anon nem authenticated", async () => {
  /**
   * CLIENTE DEDICADO, e não `bd.pool.query`: `SET ROLE` vale para a CONEXÃO, e
   * o pool entrega uma conexão qualquer a cada query. Trocar o papel numa e
   * consultar noutra testaria o papel errado — e passaria por acidente, que é
   * o pior resultado possível para um teste de privilégio.
   */
  for (const papel of ["anon", "authenticated"]) {
    const cliente = await bd.pool.connect();
    try {
      await cliente.query(`SET ROLE ${papel}`);
      await assert.rejects(
        () =>
          cliente.query(
            "SELECT melhor_envio_refresh_token FROM canastra.config_loja WHERE id = 1",
          ),
        /permission denied|42501/i,
        `${papel} não pode ler o refresh token`,
      );
    } finally {
      await cliente.query("RESET ROLE").catch(() => {});
      cliente.release();
    }
  }
});

test("duas etiquetas para o mesmo pedido é impossível pelo índice", async () => {
  const primeiro = await bd.pool.query(
    `INSERT INTO canastra.pedidos (total, status) VALUES (10, 'aprovado')
     RETURNING pedido_id`,
  );
  await bd.pool.query(
    "UPDATE canastra.pedidos SET me_order_id = 'etq-1' WHERE pedido_id = $1",
    [primeiro.rows[0].pedido_id],
  );

  const segundo = await bd.pool.query(
    `INSERT INTO canastra.pedidos (total, status) VALUES (10, 'aprovado')
     RETURNING pedido_id`,
  );
  await assert.rejects(
    () =>
      bd.pool.query(
        "UPDATE canastra.pedidos SET me_order_id = 'etq-1' WHERE pedido_id = $1",
        [segundo.rows[0].pedido_id],
      ),
    /duplicate key|unique/i,
  );
});

test("as colunas me_* não são escrevíveis por authenticated", async () => {
  const cliente = await bd.pool.connect();
  try {
    await cliente.query("SET ROLE authenticated");
    await assert.rejects(
      () =>
        cliente.query(
          "UPDATE canastra.pedidos SET me_situacao = 'released' WHERE true",
        ),
      /permission denied|42501/i,
      "um cliente não pode fingir que a própria etiqueta já foi paga",
    );
  } finally {
    await cliente.query("RESET ROLE").catch(() => {});
    cliente.release();
  }
});
