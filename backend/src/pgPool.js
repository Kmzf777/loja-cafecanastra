const pg = require("pg");
const { Pool } = pg;
const isProduction = process.env.NODE_ENV === "production";

const poolConfig = {
  connectionString: process.env.DATABASE_URL,

  /**
   * Limites explicitos.
   *
   * `max` ja valia 10 por padrao, mas implicitamente. Declarar aqui e o lembrete
   * de que existe um teto — e `connectionTimeoutMillis` e o que muda o
   * comportamento na falha: sem ele, esgotar o pool faz cada requisicao ficar
   * pendurada em `pool.connect()` PARA SEMPRE, sem erro, sem log, sem timeout.
   * O sintoma e "o site parou" sem nada no log. Com o timeout, vira um erro
   * visivel em 5 segundos, que aparece no monitoramento e no /health.
   */
  max: Number(process.env.PG_POOL_MAX || 10),
  connectionTimeoutMillis: 5000,
  idleTimeoutMillis: 30_000,
};

if (isProduction) {
  poolConfig.ssl = {
    rejectUnauthorized: false,
  };
}

const pool = new Pool(poolConfig);

// Um cliente ocioso que cai (restart do Postgres, queda de rede, timeout do
// provedor) emite este evento. Derrubar o processo inteiro por causa disso
// transforma uma falha recuperavel de UMA conexao em indisponibilidade total —
// e foi o que impediu qualquer verificacao do painel ate agora: sem banco no
// ar, o Express morria no primeiro acesso e nao havia como sequer logar
// (docs/superpowers/plans/baseline-painel.md).
//
// O `pg` ja descarta o cliente quebrado e abre outro na proxima query, entao
// registrar o erro basta. Em producao a queda continua visivel no log, e o
// orquestrador reinicia o processo se ele realmente ficar insalubre.
pool.on("error", (err) => {
  console.error("Erro inesperado num cliente ocioso do pool:", err.message);
});

module.exports = pool;
