"use strict";

const { test, before, after, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const os = require("node:os");
const fs = require("node:fs/promises");
const { execFile } = require("node:child_process");
const { promisify } = require("node:util");
const { subirPostgres } = require("./ajuda/postgres.js");
const { aplicarMigracoes } = require("../db/migrar.js");

const executar = promisify(execFile);

let bd;
let pasta;

// Cada teste ganha uma pasta nova e nenhuma e apagada no caminho — apagar entre
// testes atrapalharia depurar uma falha. O `after()` limpa todas de uma vez: sem
// isso cada `npm test` deixaria uma canastra-mig-* orfa no %TEMP% para sempre,
// e nao ha aqui nenhum motivo (como o do datadir do Postgres, que pode ficar com
// handles abertos) para aceitar o vazamento.
const pastasCriadas = [];

before(async () => {
  bd = await subirPostgres();
}, { timeout: 120_000 });

after(async () => {
  await bd?.derrubar();
  await Promise.all(
    pastasCriadas.map((p) => fs.rm(p, { recursive: true, force: true })),
  );
});

beforeEach(async () => {
  // Sem esta guarda, um before() que falha faz CADA teste morrer num
  // "Cannot read properties of undefined (reading 'pool')" — e o erro de boot,
  // que e a informacao util, fica soterrado sob N erros derivados.
  if (!bd) {
    throw new Error(
      "O Postgres nao subiu no before(); a causa real esta no erro daquele hook.",
    );
  }
  pasta = await fs.mkdtemp(path.join(os.tmpdir(), "canastra-mig-"));
  pastasCriadas.push(pasta);
  await bd.pool.query("DROP SCHEMA IF EXISTS canastra CASCADE");
});

test("aplica arquivos em ordem numerica, nao alfabetica", async () => {
  // 0002 e 0010: alfabeticamente 0010 vem antes de 0002. Se o runner ordenar
  // como texto, a segunda migracao roda antes da primeira e o CREATE TABLE
  // referencia uma tabela que ainda nao existe.
  await fs.writeFile(
    path.join(pasta, "0002_primeira.sql"),
    "CREATE TABLE canastra.a (id int PRIMARY KEY);",
  );
  await fs.writeFile(
    path.join(pasta, "0010_segunda.sql"),
    "CREATE TABLE canastra.b (id int REFERENCES canastra.a(id));",
  );

  const aplicadas = await aplicarMigracoes(bd.pool, pasta);
  assert.deepEqual(aplicadas, ["0002_primeira", "0010_segunda"]);
});

test("rodar de novo nao reaplica nada", async () => {
  await fs.writeFile(
    path.join(pasta, "0001_uma.sql"),
    "CREATE TABLE canastra.c (id int);",
  );

  const primeira = await aplicarMigracoes(bd.pool, pasta);
  const segunda = await aplicarMigracoes(bd.pool, pasta);

  assert.deepEqual(primeira, ["0001_uma"]);
  assert.deepEqual(segunda, []);
});

test("migracao que falha nao deixa rastro nem e registrada", async () => {
  await fs.writeFile(
    path.join(pasta, "0001_boa.sql"),
    "CREATE TABLE canastra.d (id int);",
  );
  await fs.writeFile(
    path.join(pasta, "0002_ruim.sql"),
    "CREATE TABLE canastra.e (id int); SELECT coluna_que_nao_existe;",
  );

  await assert.rejects(() => aplicarMigracoes(bd.pool, pasta));

  const tabelas = await bd.pool.query(
    "SELECT tablename FROM pg_tables WHERE schemaname = 'canastra' ORDER BY tablename",
  );
  // `d` ficou (migracao anterior, ja commitada). `e` nao pode ter ficado.
  assert.deepEqual(
    tabelas.rows.map((r) => r.tablename),
    ["d", "migracoes"],
  );

  const registro = await bd.pool.query(
    "SELECT versao FROM canastra.migracoes ORDER BY versao",
  );
  assert.deepEqual(registro.rows.map((r) => r.versao), ["0001_boa"]);
});

test("o erro de uma migracao preserva o SQLSTATE e nomeia a versao", async () => {
  // Quem chama precisa poder distinguir "tabela ja existe" (42P07) de "sintaxe
  // invalida" (42601) sem casar texto de mensagem — a mesma licao que sessao.js
  // registrou sobre o 42501. Embrulhar so `erro.message` jogaria o `code` fora.
  await fs.writeFile(
    path.join(pasta, "0001_sintaxe.sql"),
    "ISTO NAO E SQL;",
  );

  await assert.rejects(() => aplicarMigracoes(bd.pool, pasta), (erro) => {
    assert.equal(erro.code, "42601");
    assert.equal(erro.versao, "0001_sintaxe");
    assert.match(erro.message, /0001_sintaxe/);
    return true;
  });
});

test("recusa arquivo sem prefixo numerico, mesmo sendo o unico", async () => {
  // "mesmo sendo o unico" e o caso que importa: validar dentro do comparador do
  // sort() nao pega nada quando ha um arquivo so, porque o sort nem chama o
  // comparador — e o arquivo seria executado e registrado com a versao errada.
  await fs.writeFile(
    path.join(pasta, "cria_tudo.sql"),
    "CREATE TABLE canastra.f (id int);",
  );

  await assert.rejects(() => aplicarMigracoes(bd.pool, pasta), /cria_tudo\.sql/);

  const tabelas = await bd.pool.query(
    "SELECT tablename FROM pg_tables WHERE schemaname = 'canastra'",
  );
  assert.deepEqual(
    tabelas.rows.map((r) => r.tablename),
    ["migracoes"],
  );
});

test("recusa migracao vazia ou so com comentario", async () => {
  // A armadilha real: criar o arquivo, rodar o migrar por habito e SO ENTAO
  // escrever o SQL. A versao fica registrada como aplicada para sempre, o
  // conteudo nunca roda, e o migrar seguinte responde "nada pendente". Como nao
  // ha checksum (e nao deve haver), recusar o arquivo vazio e o unico ponto em
  // que isso da para pegar.
  await fs.writeFile(path.join(pasta, "0001_vazia.sql"), "");
  await assert.rejects(() => aplicarMigracoes(bd.pool, pasta), /0001_vazia\.sql/);
  await fs.rm(path.join(pasta, "0001_vazia.sql"));

  await fs.writeFile(
    path.join(pasta, "0001_so_comentario.sql"),
    "-- TODO: escrever o ALTER\n/* nada aqui ainda */\n",
  );
  await assert.rejects(
    () => aplicarMigracoes(bd.pool, pasta),
    /0001_so_comentario\.sql/,
  );
  await fs.rm(path.join(pasta, "0001_so_comentario.sql"));

  const registro = await bd.pool.query("SELECT versao FROM canastra.migracoes");
  assert.deepEqual(registro.rows, []);

  // E o outro lado, que importa tanto quanto: comentario junto de SQL de
  // verdade tem de passar. Uma heuristica de vazio agressiva demais barraria
  // toda migracao bem documentada — que e justamente o estilo desta base.
  await fs.writeFile(
    path.join(pasta, "0001_com_comentario.sql"),
    "-- cria a tabela de teste\nCREATE TABLE canastra.g (id int); -- fim\n",
  );
  assert.deepEqual(await aplicarMigracoes(bd.pool, pasta), ["0001_com_comentario"]);
});

test("migracao salva com BOM (Bloco de Notas do Windows) aplica normalmente", async () => {
  // O BOM nao e hipotese: e o que o Bloco de Notas grava ao salvar um .sql em
  // UTF-8, e as sete migracoes desta fase serao editadas nesta maquina Windows.
  // Sem o corte na leitura o arquivo passa por temComandoSql() e morre so no
  // Postgres, com 22P05 ("character with byte sequence 0xef 0xbb 0xbf") — uma
  // mensagem que nao aponta para o editor e manda procurar erro de sintaxe onde
  // nao ha nenhum.
  await fs.writeFile(
    path.join(pasta, "0001_com_bom.sql"),
    "\uFEFF-- salva com BOM\nCREATE TABLE canastra.i (id int);",
  );

  assert.deepEqual(await aplicarMigracoes(bd.pool, pasta), ["0001_com_bom"]);

  const tabelas = await bd.pool.query(
    "SELECT tablename FROM pg_tables WHERE schemaname = 'canastra' ORDER BY tablename",
  );
  assert.deepEqual(tabelas.rows.map((r) => r.tablename), ["i", "migracoes"]);
});

test("falha de leitura nomeia a versao e nao aplica nada antes dela", async () => {
  await fs.writeFile(
    path.join(pasta, "0001_boa.sql"),
    "CREATE TABLE canastra.h (id int);",
  );
  // Um diretorio no lugar do arquivo e a forma barata de forcar erro de leitura.
  await fs.mkdir(path.join(pasta, "0002_diretorio.sql"));

  await assert.rejects(() => aplicarMigracoes(bd.pool, pasta), (erro) => {
    assert.equal(erro.name, "ErroDeMigracao");
    assert.equal(erro.versao, "0002_diretorio");
    assert.equal(erro.code, "EISDIR");
    return true;
  });

  // O ponto do teste: como a leitura de TODOS os arquivos acontece antes da
  // primeira transacao, nem a 0001 — que e perfeitamente valida — chega a ser
  // aplicada. Lendo sob demanda, ela ficava commitada e o EISDIR escapava cru,
  // sem versao e sem tratamento, com o banco ja meio migrado.
  const registro = await bd.pool.query("SELECT versao FROM canastra.migracoes");
  assert.deepEqual(registro.rows, []);
});

test("a CLI recusa rodar sem DATABASE_URL", async () => {
  // A unica defesa aqui que existe puramente por seguranca de producao: sem ela
  // o pg cai no padrao do libpq e migra qualquer banco alcancavel, em silencio.
  // Precisa de teste justamente por nunca ser exercitada pelo caminho normal.
  const ambiente = { ...process.env };
  delete ambiente.DATABASE_URL;

  await assert.rejects(
    () =>
      executar(process.execPath, [require.resolve("../db/migrar.js")], {
        env: ambiente,
        timeout: 15_000,
      }),
    (erro) => {
      assert.equal(erro.code, 1);
      assert.match(erro.stderr, /DATABASE_URL não está definida/);
      return true;
    },
  );
});

test("recusa duas migracoes com o mesmo numero", async () => {
  // Dois branches que criam 0003 e um acidente de merge comum. Com numeros
  // iguais o comparador devolve 0 e a ordem passa a ser a do readdir(), que
  // varia por sistema de arquivos: rodaria numa ordem no Windows e noutra no
  // Linux do VPS. Falhar alto e melhor que ordem nao-determinista.
  await fs.writeFile(path.join(pasta, "0003_a.sql"), "SELECT 1;");
  await fs.writeFile(path.join(pasta, "0003_b.sql"), "SELECT 1;");

  await assert.rejects(
    () => aplicarMigracoes(bd.pool, pasta),
    /0003_a\.sql.*0003_b\.sql|0003_b\.sql.*0003_a\.sql/s,
  );
});
