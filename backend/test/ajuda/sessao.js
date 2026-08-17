"use strict";

/**
 * Roda uma funcao dentro de uma transacao, assumindo um papel do Supabase.
 *
 * `SET LOCAL` so vale dentro de transacao — e por isso que tudo aqui roda entre
 * BEGIN e ROLLBACK. O ROLLBACK no fim e de proposito: cada teste ve o banco
 * limpo sem precisar de TRUNCATE.
 */

async function comoPapel(pool, { papel, sub = null }, funcao) {
  const cliente = await pool.connect();
  try {
    await cliente.query("BEGIN");
    await cliente.query(`SET LOCAL ROLE ${papel}`);
    if (sub) {
      await cliente.query("SELECT set_config('request.jwt.claims', $1, true)", [
        JSON.stringify({ sub, role: papel }),
      ]);
    }
    return await funcao(cliente);
  } finally {
    await cliente.query("ROLLBACK").catch(() => {});
    cliente.release();
  }
}

module.exports = { comoPapel };
