"use strict";

/**
 * O `instalacao-completa.sql` produz o MESMO banco que o runner de migracoes?
 *
 * POR QUE ESTE TESTE E O QUE JUSTIFICA O ARQUIVO EXISTIR
 * Ha dois caminhos para levantar este banco: `npm run db:migrar && npm run
 * db:seed`, e colar `instalacao-completa.sql` no editor SQL do Supabase. Dois
 * caminhos para o mesmo destino e uma divergencia esperando para acontecer — e
 * uma divergencia que NAO levanta erro. A loja instalada por um caminho
 * simplesmente se comporta diferente da instalada pelo outro: uma politica de RLS
 * que existe num lado e nao no outro, um GRANT a mais, um preco diferente. Isso
 * so apareceria quando alguem comparasse os dois bancos — ou seja, nunca.
 *
 * Entao aqui sobem DOIS Postgres de verdade, um por caminho, e o teste compara
 * catalogo a catalogo: colunas e tipos, indices, politicas, funcoes, privilegios
 * e os dados semeados. Se alguem editar o SQL gerado a mao, ou acrescentar uma
 * migracao sem regerar o arquivo, e aqui que aparece.
 *
 * O QUE ESTE TESTE NAO COBRE
 * O trecho das contas de teste. Ele escreve direto em `auth.users` e
 * `auth.identities`, que sao do GoTrue — o harness local traz so um arremedo de
 * `auth.users` (id e email). O teste corta esse trecho pelos marcadores e o
 * declara verificavel somente contra um Supabase de verdade.
 */

const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");

const { subirPostgres } = require("./ajuda/postgres.js");
const { aplicarMigracoes } = require("../db/migrar.js");
const { semearProdutos, semearOpcoes, semearConfig } = require("../db/seed.js");
const {
  gerar,
  gerarReset,
  CONTAS_DE_TESTE,
  INICIO_DAS_CONTAS,
  FIM_DAS_CONTAS,
  DESTINO,
  DESTINO_RESET,
} = require("../db/gerar-instalacao.js");

/** `viaRunner` = db:migrar + db:seed. `viaSql` = o arquivo colavel. */
let viaRunner;
let viaSql;
let sqlGerado;

/**
 * Remove o trecho das contas, que exige o schema `auth` de verdade.
 *
 * Falha alto se os marcadores nao estiverem la: sem eles o corte seria silencioso
 * e o teste passaria a rodar SQL que nao pode funcionar aqui, culpando o arquivo
 * errado.
 */
function semAsContas(sql) {
  const i = sql.indexOf(INICIO_DAS_CONTAS);
  const f = sql.indexOf(FIM_DAS_CONTAS);
  assert.ok(i !== -1, "marcador de inicio das contas desapareceu do gerador");
  assert.ok(f > i, "marcador de fim das contas desapareceu do gerador");
  return sql.slice(0, i) + sql.slice(f + FIM_DAS_CONTAS.length);
}

before(async () => {
  sqlGerado = await gerar();

  viaRunner = await subirPostgres();
  await aplicarMigracoes(viaRunner.pool);
  await semearProdutos(viaRunner.pool);
  await semearOpcoes(viaRunner.pool);
  await semearConfig(viaRunner.pool);

  viaSql = await subirPostgres();
  await viaSql.pool.query(semAsContas(sqlGerado));
}, { timeout: 240_000 });

after(async () => {
  await viaRunner?.derrubar();
  await viaSql?.derrubar();
});

/** Roda a mesma consulta nos dois bancos e exige resultado identico. */
async function iguais(descricao, sql) {
  const [a, b] = await Promise.all([
    viaRunner.pool.query(sql),
    viaSql.pool.query(sql),
  ]);
  assert.deepEqual(
    b.rows,
    a.rows,
    `${descricao}: instalacao-completa.sql divergiu do runner. ` +
      "Rode `node backend/db/gerar-instalacao.js` e commite o arquivo gerado.",
  );
  return a.rows;
}

test("o arquivo no repositorio esta em dia com o gerador", () => {
  // Se este teste falhar, alguem mudou uma migracao (ou o seed) e nao regerou.
  // O arquivo commitado e o que a pessoa vai colar no editor SQL; ele nao pode
  // ficar atras do schema de verdade.
  const emDisco = fs.readFileSync(DESTINO, "utf8");
  assert.equal(
    emDisco,
    sqlGerado,
    "backend/db/instalacao-completa.sql esta desatualizado. " +
      "Rode: node backend/db/gerar-instalacao.js",
  );

  const resetEmDisco = fs.readFileSync(DESTINO_RESET, "utf8");
  assert.equal(
    resetEmDisco,
    gerarReset(),
    "backend/db/reset.sql esta desatualizado. " +
      "Rode: node backend/db/gerar-instalacao.js",
  );
});

test("as mesmas sete migracoes ficam registradas nos dois caminhos", async () => {
  // E isto que faz `npm run db:migrar` ser um no-op depois da instalacao pelo
  // SQL. Sem o registro, o runner tentaria reaplicar tudo e morreria no primeiro
  // CREATE de objeto existente.
  const versoes = await iguais(
    "canastra.migracoes",
    "SELECT versao FROM canastra.migracoes ORDER BY versao",
  );
  assert.equal(versoes.length, 7);
});

test("tabelas, colunas, tipos e defaults sao identicos", async () => {
  await iguais(
    "colunas",
    `SELECT table_name, column_name, data_type, is_nullable,
            character_maximum_length, numeric_precision, numeric_scale,
            column_default
     FROM information_schema.columns
     WHERE table_schema = 'canastra'
     ORDER BY table_name, column_name`,
  );
});

test("indices sao identicos", async () => {
  await iguais(
    "indices",
    `SELECT tablename, indexname, indexdef
     FROM pg_indexes WHERE schemaname = 'canastra'
     ORDER BY tablename, indexname`,
  );
});

test("a RLS esta ligada nas mesmas tabelas, e FORCE em nenhuma", async () => {
  const linhas = await iguais(
    "relrowsecurity",
    `SELECT c.relname, c.relrowsecurity, c.relforcerowsecurity
     FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'canastra' AND c.relkind = 'r'
     ORDER BY c.relname`,
  );
  // Nao basta serem iguais: as duas instalacoes podem estar igualmente erradas.
  for (const t of linhas) {
    if (t.relname === "migracoes") continue;
    assert.equal(t.relrowsecurity, true, `RLS desligada em ${t.relname}`);
    assert.equal(t.relforcerowsecurity, false, `FORCE RLS ligada em ${t.relname}`);
  }
});

test("as politicas de RLS sao identicas, predicado a predicado", async () => {
  const politicas = await iguais(
    "pg_policies",
    `SELECT tablename, policyname, permissive, roles::text, cmd, qual, with_check
     FROM pg_policies WHERE schemaname = 'canastra'
     ORDER BY tablename, policyname`,
  );
  assert.ok(politicas.length > 0, "nenhuma politica encontrada — 0006 nao rodou?");
});

test("as funcoes sao identicas, inclusive SECURITY DEFINER e search_path", async () => {
  const funcoes = await iguais(
    "funcoes",
    `SELECT p.proname, pg_get_functiondef(p.oid) AS definicao,
            p.prosecdef, p.proconfig::text, p.proacl::text
     FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'canastra'
     ORDER BY p.proname, p.oid`,
  );
  const nomes = funcoes.map((f) => f.proname);
  for (const esperada of ["eh_admin", "eh_cliente", "fundir_sacola", "exigir_um_admin"]) {
    assert.ok(nomes.includes(esperada), `funcao ${esperada} nao existe nos dois bancos`);
  }
});

test("os privilegios de tabela e de coluna sao identicos", async () => {
  // A parte de COLUNA importa: o GRANT SELECT por coluna em canastra.produtos e
  // o que esconde `custo`. Uma divergencia aqui vaza margem ou devolve 42501 na
  // vitrine, e nenhum dos dois aparece como erro na instalacao.
  await iguais(
    "privilegios de tabela",
    `SELECT table_name, grantee, privilege_type
     FROM information_schema.role_table_grants
     WHERE table_schema = 'canastra'
       AND grantee IN ('anon', 'authenticated', 'service_role')
     ORDER BY table_name, grantee, privilege_type`,
  );

  await iguais(
    "privilegios de coluna",
    `SELECT table_name, column_name, grantee, privilege_type
     FROM information_schema.column_privileges
     WHERE table_schema = 'canastra'
       AND grantee IN ('anon', 'authenticated', 'service_role')
     ORDER BY table_name, column_name, grantee, privilege_type`,
  );
});

test("as triggers e constraints sao identicas", async () => {
  await iguais(
    "triggers",
    `SELECT c.relname, t.tgname, pg_get_triggerdef(t.oid) AS definicao
     FROM pg_trigger t
     JOIN pg_class c ON c.oid = t.tgrelid
     JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'canastra' AND NOT t.tgisinternal
     ORDER BY c.relname, t.tgname`,
  );

  await iguais(
    "constraints",
    `SELECT c.conname, r.relname, pg_get_constraintdef(c.oid) AS definicao
     FROM pg_constraint c
     JOIN pg_class r ON r.oid = c.conrelid
     JOIN pg_namespace n ON n.oid = r.relnamespace
     WHERE n.nspname = 'canastra'
     ORDER BY r.relname, c.conname`,
  );
});

test("a view publica tem a mesma definicao e o mesmo dono efetivo", async () => {
  await iguais(
    "views",
    `SELECT c.relname, pg_get_viewdef(c.oid, true) AS definicao, c.reloptions::text
     FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'canastra' AND c.relkind = 'v'
     ORDER BY c.relname`,
  );
});

test("o catalogo semeado e byte a byte o mesmo nos dois caminhos", async () => {
  // Este e o teste que impede as DUAS listas de catalogo de existirem. O gerador
  // le de `linhasDeProdutos()`, a mesma funcao que o seed usa; se alguem
  // escrever os INSERTs a mao no SQL, e aqui que a diferenca de preco aparece.
  // `destacado_em` e `criado_em` ficam fora: sao `now()` nos dois lados.
  const produtos = await iguais(
    "canastra.produtos",
    `SELECT produto_id, sku, nome, tamanho, categoria, preco, imagem,
            quantidade, descricao, peso, largura, altura, comprimento, custo
     FROM canastra.produtos ORDER BY sku`,
  );
  assert.equal(produtos.length, 29, "esperados 29 SKUs do catalogo");

  await iguais(
    "canastra.produto_opcoes",
    "SELECT id, tipo, valor FROM canastra.produto_opcoes ORDER BY tipo, valor",
  );

  await iguais(
    "canastra.config_loja",
    `SELECT id, banner_desktop, banner_mobile, titulo_site, whatsapp, barra_de_aviso
     FROM canastra.config_loja ORDER BY id`,
  );
});

test("o reset derruba a loja e o arquivo pode ser colado de novo", async () => {
  // O reset roda no banco `viaSql`, que sera derrubado no `after` de qualquer
  // forma — nenhum outro teste depende dele depois deste ponto.
  //
  // O trecho de `auth` do reset e exercitado de verdade: o shim tem `auth.users`,
  // e as contas nunca foram inseridas aqui, entao o caminho "nenhuma conta
  // encontrada" e o que roda. E exatamente o caminho de um banco limpo.
  const reset = gerarReset().replace(
    "DELETE FROM auth.identities WHERE user_id = ANY (ids_apagados);",
    // O shim nao tem auth.identities; trocar por um no-op mantem o resto do
    // bloco (o DROP SCHEMA e a contagem) sob teste.
    "PERFORM 1;",
  );
  await viaSql.pool.query(reset);

  const { rows } = await viaSql.pool.query(
    "SELECT 1 FROM information_schema.schemata WHERE schema_name = 'canastra'",
  );
  assert.deepEqual(rows, [], "o reset deixou o schema canastra de pe");

  // Rodar de novo num banco onde nada existe tem de passar quieto.
  await viaSql.pool.query(reset);

  // E o arquivo de instalacao volta a aplicar por cima do reset.
  await viaSql.pool.query(semAsContas(sqlGerado));
  const { rows: depois } = await viaSql.pool.query(
    "SELECT count(*)::int AS n FROM canastra.produtos",
  );
  assert.equal(depois[0].n, 29);
});

test("a guarda recusa colar o arquivo em cima de uma instalacao existente", async () => {
  // O banco `viaSql` acabou de ser reinstalado pelo teste anterior, entao o
  // schema existe. Colar de novo tem de parar na primeira instrucao, com uma
  // mensagem que diz o que fazer — e nao no meio, com parte aplicada.
  await assert.rejects(
    () => viaSql.pool.query(semAsContas(sqlGerado)),
    (erro) => {
      assert.match(erro.message, /schema "canastra" já existe/i);
      return true;
    },
  );
});

test("as contas de teste estao declaradas e sao coerentes entre os dois arquivos", () => {
  // O trecho de contas nao roda aqui, mas o acordo entre os dois arquivos roda:
  // toda conta que a instalacao cria, o reset tem de apagar. Um e-mail a menos no
  // reset deixa conta orfa em auth.users, e a reinstalacao reaproveita a senha
  // antiga sem avisar ninguem.
  assert.ok(CONTAS_DE_TESTE.length >= 2, "esperado ao menos um admin e um cliente");
  assert.equal(CONTAS_DE_TESTE.filter((c) => c.admin).length, 1);

  const reset = gerarReset();
  for (const conta of CONTAS_DE_TESTE) {
    assert.ok(
      sqlGerado.includes(conta.email),
      `${conta.email} nao aparece na instalacao`,
    );
    assert.ok(
      reset.includes(conta.email),
      `${conta.email} e criado na instalacao mas o reset nao apaga`,
    );
  }

  // O reset nao pode apagar por padrao — um LIKE '%teste%' pegaria conta real de
  // outro projeto na mesma instancia compartilhada.
  //
  // A checagem e sobre o SQL EXECUTAVEL, com os comentarios fora: o cabecalho do
  // reset explica por extenso por que nao se usa LIKE, e uma busca ingenua no
  // arquivo inteiro reprovaria o arquivo por causa da propria explicacao.
  const executavel = reset
    .split("\n")
    .filter((linha) => !linha.trim().startsWith("--"))
    .join("\n");

  assert.ok(
    !/\bI?LIKE\b/i.test(executavel),
    "o reset usa LIKE: numa instancia compartilhada isso apaga conta de terceiro",
  );
  assert.ok(
    /email = ANY \(contas_de_teste\)/.test(executavel),
    "o reset deixou de casar e-mail por igualdade exata",
  );
});
