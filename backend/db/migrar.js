"use strict";

/**
 * Aplicador de migracoes.
 *
 * POR QUE ISTO SUBSTITUI schema.sql
 * `schema.sql` so criava (tudo IF NOT EXISTS) e nunca alterava. A auditoria
 * registrou o efeito (docs/producao.md): a proxima mudanca de coluna seria
 * manual e sem historico. Aqui cada arquivo roda uma vez, em ordem, dentro de
 * uma transacao, e fica registrado.
 *
 * O bootstrap de `canastra.migracoes` vive no codigo, e nao numa migracao, pelo
 * problema obvio do ovo e da galinha: o runner precisa da tabela para saber o
 * que ja rodou.
 */

const fs = require("node:fs/promises");
const path = require("node:path");

const PASTA_PADRAO = path.join(__dirname, "migrations");

const BOOTSTRAP = `
  CREATE SCHEMA IF NOT EXISTS canastra;
  CREATE TABLE IF NOT EXISTS canastra.migracoes (
    versao      text PRIMARY KEY,
    aplicada_em timestamptz NOT NULL DEFAULT now()
  );
`;

/**
 * Falha ao aplicar uma migracao, com contexto suficiente para agir.
 *
 * COPIA o `code` do erro do Postgres de proposito. Isto e o oposto do que
 * `test/ajuda/sessao.js` faz com o ErroDeHarness, e pelo motivo oposto: la, o
 * `code` e escondido porque uma falha do harness NAO e uma recusa de politica e
 * confundir as duas faria um teste passar verde a toa. Aqui o erro E o erro do
 * banco, so que embrulhado para dizer QUAL migracao quebrou — se o SQLSTATE
 * sumisse, quem chama teria de casar texto de mensagem para distinguir
 * "relacao ja existe" (42P07) de "sintaxe invalida" (42601), e mensagem do
 * Postgres muda com a versao e com o locale. O erro original continua em
 * `cause`.
 */
class ErroDeMigracao extends Error {
  constructor(mensagem, causa, versao = null) {
    super(mensagem);
    this.name = "ErroDeMigracao";
    this.versao = versao;
    if (causa) {
      this.cause = causa;
      if (causa.code) this.code = causa.code;
    }
  }
}

/** "0010_segunda.sql" -> 10. Ordem numerica, nao alfabetica. */
function numeroDaVersao(arquivo) {
  const inicio = arquivo.match(/^(\d+)_/);
  return inicio ? Number(inicio[1]) : null;
}

/**
 * Lista as migracoes da pasta ja validadas e em ordem.
 *
 * A validacao acontece AQUI, num passo separado, e nao dentro do comparador do
 * `sort()`. Dois motivos, os dois medidos:
 *
 * 1. `sort()` nao chama o comparador quando ha um elemento so. Uma pasta com um
 *    unico `cria_tudo.sql` passaria batido pela conferencia e seria executada e
 *    registrada com "cria_tudo" no lugar de uma versao — exatamente o arquivo
 *    que a conferencia existia para barrar.
 * 2. Excecao vinda de comparador sai no meio de uma ordenacao parcial e nao diz
 *    quantos arquivos estao errados; aqui sai uma lista completa, de uma vez.
 *
 * Numeros repetidos sao recusados em vez de tolerados. Com numeros iguais o
 * comparador devolve 0, o `sort()` (estavel desde o ES2019) preserva a ordem do
 * `readdir()`, e essa ordem depende do sistema de arquivos: alfabetica no NTFS,
 * ordem de hash no ext4. Ou seja, a mesma pasta rodaria numa ordem nesta
 * maquina e noutra no VPS, sem aviso nenhum. Dois branches criando `0003_` e um
 * acidente de merge banal; descobri-lo aqui custa renomear um arquivo.
 */
async function listarMigracoes(pasta) {
  const arquivos = (await fs.readdir(pasta)).filter((a) => a.endsWith(".sql"));

  const semNumero = arquivos.filter((a) => numeroDaVersao(a) === null);
  if (semNumero.length) {
    throw new ErroDeMigracao(
      `Migracao sem prefixo numerico: ${semNumero.join(", ")}. ` +
        "Use NNNN_descricao.sql (ex.: 0003_pedidos.sql).",
    );
  }

  const porNumero = new Map();
  for (const arquivo of arquivos) {
    const numero = numeroDaVersao(arquivo);
    const irmaos = porNumero.get(numero);
    if (irmaos) irmaos.push(arquivo);
    else porNumero.set(numero, [arquivo]);
  }

  const repetidos = [...porNumero.values()].filter((g) => g.length > 1);
  if (repetidos.length) {
    throw new ErroDeMigracao(
      "Numero de migracao repetido, a ordem ficaria indefinida: " +
        repetidos.map((g) => g.sort().join(" e ")).join("; ") +
        ". Renumere uma delas.",
    );
  }

  return arquivos
    .sort((a, b) => numeroDaVersao(a) - numeroDaVersao(b))
    .map((arquivo) => ({ arquivo, versao: arquivo.replace(/\.sql$/, "") }));
}

async function aplicarMigracoes(pool, pasta = PASTA_PADRAO) {
  try {
    await pool.query(BOOTSTRAP);
  } catch (erro) {
    // Sem este embrulho o operador ve so "permission denied for database
    // postgres" e nenhuma pista de que quem pediu foi o runner, nem do que ele
    // estava tentando criar. Numa instancia compartilhada com os outros
    // projetos do VPS, a causa mais provavel e o papel do DATABASE_URL nao ter
    // direito de CREATE — e a mensagem precisa dizer isso.
    throw new ErroDeMigracao(
      `Nao foi possivel preparar o schema canastra e a tabela canastra.migracoes: ${erro.message}. ` +
        "O papel do DATABASE_URL precisa de CREATE no banco.",
      erro,
    );
  }

  const migracoes = await listarMigracoes(pasta);

  const jaAplicadas = new Set(
    (await pool.query("SELECT versao FROM canastra.migracoes")).rows.map(
      (r) => r.versao,
    ),
  );

  const aplicadas = [];

  for (const { arquivo, versao } of migracoes) {
    if (jaAplicadas.has(versao)) continue;

    const sql = await fs.readFile(path.join(pasta, arquivo), "utf8");
    const cliente = await pool.connect();
    let falhaNoRollback;

    try {
      await cliente.query("BEGIN");
      await cliente.query(sql);
      await cliente.query("INSERT INTO canastra.migracoes (versao) VALUES ($1)", [
        versao,
      ]);
      await cliente.query("COMMIT");
      aplicadas.push(versao);
      console.log(`  · ${versao}`);
    } catch (erro) {
      try {
        await cliente.query("ROLLBACK");
      } catch (falha) {
        falhaNoRollback = falha;
      }
      const sqlstate = erro.code ? ` (SQLSTATE ${erro.code})` : "";
      throw new ErroDeMigracao(
        `Migracao ${versao} falhou${sqlstate}: ${erro.message}`,
        erro,
        versao,
      );
    } finally {
      // Mesma licao que `test/ajuda/sessao.js` registrou: se o ROLLBACK falhou
      // (conexao caida no meio da migracao, por exemplo), este cliente pode
      // voltar ao pool AINDA dentro da transacao e contaminar quem o pegar
      // depois. `release(erro)` destroi a conexao; sem argumento e um release
      // normal.
      cliente.release(falhaNoRollback);
    }
  }

  return aplicadas;
}

module.exports = { aplicarMigracoes, ErroDeMigracao, PASTA_PADRAO };

if (require.main === module) {
  const { Pool } = require("pg");

  // `new Pool({ connectionString: undefined })` NAO falha: o pg cai no
  // comportamento do libpq e monta a conexao a partir de PGHOST/PGUSER/PGDATABASE
  // ou, na ausencia deles, de localhost:5432 com o usuario do sistema. Este
  // comando e rodado a mao contra o VPS de producao — um DATABASE_URL esquecido
  // no shell aplicaria as migracoes em QUALQUER banco que estivesse a mao, em
  // silencio e com a saida de sucesso de sempre. Recusar e a unica leitura
  // segura.
  if (!process.env.DATABASE_URL) {
    console.error(
      "\n❌ DATABASE_URL nao esta definida.\n" +
        "   Sem ela a conexao cairia no padrao do libpq e as migracoes poderiam\n" +
        "   ser aplicadas num banco que nao e o pretendido.\n",
    );
    process.exit(1);
  }

  const pool = new Pool({ connectionString: process.env.DATABASE_URL });

  aplicarMigracoes(pool)
    .then((aplicadas) => {
      console.log(
        aplicadas.length
          ? `${aplicadas.length} migracao(oes) aplicada(s).`
          : "Nada pendente.",
      );
      return pool.end();
    })
    .catch(async (erro) => {
      console.error(`\n❌ ${erro.message}\n`);
      await pool.end().catch(() => {});
      process.exit(1);
    });
}
