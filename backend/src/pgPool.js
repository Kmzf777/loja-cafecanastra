const pg = require("pg");
const { Pool } = pg;
const isProduction = process.env.NODE_ENV === "production";

const poolConfig = {
  connectionString: process.env.DATABASE_URL,
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
