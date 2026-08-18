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
const { aplicarMigracoes, listarMigracoes, PASTA_PADRAO } = require("../db/migrar.js");
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

test("os dois arquivos aplicam num banco que nao seja UTF-8", () => {
  /**
   * Ja mordeu tres vezes nesta sessao, sempre do mesmo jeito.
   *
   * Um caractere fora do Latin-1 num COMENTARIO do SQL — um emoji de aviso, um
   * traco de moldura — faz o Postgres recusar o arquivo INTEIRO com
   * `22P05: character with byte sequence ... has no equivalent in encoding
   * "WIN1252"`. Nao e uma linha que falha: e a instalacao que nao comeca, por
   * causa de enfeite.
   *
   * O Supabase gerenciado e UTF-8 e nao se importaria. Mas um arquivo de deploy
   * que depende do encoding do destino para os proprios comentarios e fragil de
   * graca, e o autor nao tem como saber em que banco ele vai ser colado.
   * Acentuacao portuguesa e travessao passam — o WIN1252 os tem.
   */
  for (const [nome, conteudo] of [
    ["instalacao-completa.sql", sqlGerado],
    ["reset.sql", gerarReset()],
  ]) {
    const proibidos = [...new Set(conteudo)].filter((c) => {
      const ponto = c.codePointAt(0);
      // Latin-1 puro passa; acima disso, so o punhado que o WIN1252 mapeia
      // (travessao, aspas curvas, reticencias, bullet...) na faixa 0x2013-0x2026.
      if (ponto <= 0xff) return false;
      return !(ponto >= 0x2013 && ponto <= 0x2026);
    });
    assert.deepEqual(
      proibidos,
      [],
      `${nome} tem caractere que um banco WIN1252 recusa (22P05): ` +
        proibidos.map((c) => `U+${c.codePointAt(0).toString(16)}`).join(", "),
    );
  }
});

test("as mesmas migracoes ficam registradas nos dois caminhos", async () => {
  // E isto que faz `npm run db:migrar` ser um no-op depois da instalacao pelo
  // SQL. Sem o registro, o runner tentaria reaplicar tudo e morreria no primeiro
  // CREATE de objeto existente.
  const versoes = await iguais(
    "canastra.migracoes",
    "SELECT versao FROM canastra.migracoes ORDER BY versao",
  );
  // A contagem vem da PASTA, e nao de um numero escrito aqui: com o literal, toda
  // migracao nova reprovava este teste por um motivo que nao e o dele — e o
  // reflexo de quem visse o vermelho seria trocar o numero, sem conferir se as
  // duas listas continuam iguais. `iguais()` acima ja compara os dois bancos; o
  // que falta e provar que nenhum dos dois PULOU uma migracao, e disso quem sabe
  // e o disco.
  const naPasta = await listarMigracoes(PASTA_PADRAO);
  assert.deepEqual(
    versoes.map((linha) => linha.versao),
    naPasta.map((m) => m.versao),
  );
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

test("o reset limpa o banco inteiro, e nao so o schema da loja", async () => {
  // ESTE E O TESTE QUE A PRIMEIRA VERSAO DO RESET NAO TINHA, E POR ISSO ELA
  // PASSOU DIREITO ESTANDO ERRADA.
  //
  // Aquele reset so derrubava `canastra`. Num banco de teste onde ainda moravam
  // as tabelas da loja ANTIGA (em `public`), ele rodava, dizia "concluído", e
  // nao apagava nada do que a pessoa estava vendo. O sintoma nao e um erro: e um
  // reset que parece ter funcionado. Entao o teste planta exatamente essa
  // situacao — sobra em `public`, conta em `auth.users` — antes de resetar.
  //
  // O reset roda no banco `viaSql`, derrubado no `after` de qualquer forma.
  const reset = gerarReset();

  await viaSql.pool.query(`
    CREATE TABLE public.produtos_da_loja_antiga (id int PRIMARY KEY, nome text);
    INSERT INTO public.produtos_da_loja_antiga VALUES (1, 'sobra do schema antigo');
    CREATE VIEW public.uma_view AS SELECT 1 AS x;
    CREATE SCHEMA um_outro_schema;
    CREATE TABLE um_outro_schema.t (id int);
    INSERT INTO auth.users (id, email)
      VALUES ('99999999-9999-9999-9999-999999999999', 'sobrou@exemplo.com');
  `);

  await viaSql.pool.query(reset);

  const { rows: sobrou } = await viaSql.pool.query(`
    SELECT
      (SELECT count(*)::int FROM information_schema.schemata
        WHERE schema_name IN ('canastra', 'um_outro_schema'))            AS schemas_de_projeto,
      (SELECT count(*)::int FROM pg_tables  WHERE schemaname = 'public') AS tabelas_public,
      (SELECT count(*)::int FROM pg_views   WHERE schemaname = 'public') AS views_public,
      (SELECT count(*)::int FROM auth.users)                             AS contas
  `);
  assert.deepEqual(
    sobrou[0],
    { schemas_de_projeto: 0, tabelas_public: 0, views_public: 0, contas: 0 },
    "o reset deixou sobra: era para o banco voltar ao estado de projeto novo",
  );

  // `public` tem de continuar existindo — recriado, nao apenas removido. Meio
  // mundo assume que ele esta la, a comecar pelo proprio painel do Supabase.
  const { rows: temPublic } = await viaSql.pool.query(
    "SELECT 1 FROM information_schema.schemata WHERE schema_name = 'public'",
  );
  assert.equal(temPublic.length, 1, "o reset removeu public e nao recriou");

  // E os privilegios de fabrica voltaram: sem isto o PostgREST responde
  // "permission denied for schema public" em tudo, e o sintoma nao aponta daqui.
  const { rows: grants } = await viaSql.pool.query(`
    SELECT bool_and(has_schema_privilege(r, 'public', 'USAGE')) AS todos_enxergam
    FROM unnest(ARRAY['anon','authenticated','service_role']) AS r
  `);
  assert.equal(grants[0].todos_enxergam, true, "public ficou sem GRANT para os papeis do Supabase");

  // Rodar de novo num banco ja limpo tem de passar quieto.
  await viaSql.pool.query(reset);

  // E a instalacao volta a aplicar por cima do reset.
  await viaSql.pool.query(semAsContas(sqlGerado));
  const { rows: depois } = await viaSql.pool.query(
    "SELECT count(*)::int AS n FROM canastra.produtos",
  );
  assert.equal(depois[0].n, 29);
});

test("um Storage protegido nao aborta o reset inteiro", async () => {
  /**
   * O bug que este teste existe para nao voltar.
   *
   * O Supabase gerenciado protege as tabelas de Storage com um trigger que
   * recusa DELETE direto:
   *
   *   42501: Direct deletion from storage tables is not allowed.
   *          Use the Storage API instead.
   *
   * Como o reset e UM comando `DO`, ou seja UMA transacao, essa recusa abortava
   * tudo — inclusive os DROP SCHEMA que ja tinham rodado com sucesso. O operador
   * via um erro falando de Storage e ficava com o banco INTACTO. Pior que um
   * reset que falha e um reset que falha por um motivo que parece periferico.
   *
   * Aqui o `storage` do Supabase e reproduzido com o mesmo formato de recusa.
   */
  await viaSql.pool.query(`
    DROP SCHEMA IF EXISTS storage CASCADE;
    CREATE SCHEMA storage;
    CREATE TABLE storage.buckets (id text PRIMARY KEY);
    CREATE TABLE storage.objects (
      id     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      bucket text REFERENCES storage.buckets (id)
    );
    INSERT INTO storage.buckets (id) VALUES ('canastra-produtos');
    INSERT INTO storage.objects (bucket) VALUES ('canastra-produtos');

    CREATE FUNCTION storage.protect_delete() RETURNS trigger LANGUAGE plpgsql AS $pd$
    BEGIN
      RAISE EXCEPTION 'Direct deletion from storage tables is not allowed. Use the Storage API instead.'
        USING ERRCODE = 'insufficient_privilege';
    END $pd$;

    CREATE TRIGGER protege_objects BEFORE DELETE ON storage.objects
      FOR EACH STATEMENT EXECUTE FUNCTION storage.protect_delete();
    CREATE TRIGGER protege_buckets BEFORE DELETE ON storage.buckets
      FOR EACH STATEMENT EXECUTE FUNCTION storage.protect_delete();
  `);

  // Uma sobra de projeto, para provar que o resto do reset rodou.
  await viaSql.pool.query("CREATE SCHEMA sobra_de_projeto");

  // Nao pode lancar. Antes da correcao, lancava 42501 e desfazia tudo.
  await viaSql.pool.query(gerarReset());

  const { rows } = await viaSql.pool.query(`
    SELECT
      (SELECT count(*)::int FROM information_schema.schemata
        WHERE schema_name IN ('canastra', 'sobra_de_projeto'))  AS schemas_de_projeto,
      (SELECT count(*)::int FROM information_schema.schemata
        WHERE schema_name = 'storage')                          AS storage_de_pe,
      (SELECT count(*)::int FROM storage.objects)               AS objetos_intactos
  `);
  assert.equal(rows[0].schemas_de_projeto, 0, "o reset parou antes de limpar os schemas");
  assert.equal(rows[0].storage_de_pe, 1, "o reset derrubou o schema storage");
  assert.equal(
    rows[0].objetos_intactos,
    1,
    "o objeto protegido deveria continuar la — o reset avisa, nao forca",
  );

  // Limpa a simulacao para nao atrapalhar os testes seguintes.
  await viaSql.pool.query(`
    DROP TRIGGER protege_objects ON storage.objects;
    DROP TRIGGER protege_buckets ON storage.buckets;
    DROP SCHEMA storage CASCADE;
  `);
  await viaSql.pool.query(semAsContas(sqlGerado));
});

test("o reset nao derruba os schemas que o Supabase administra", async () => {
  // O outro lado do risco. Derrubar `auth` nao "limparia" o GoTrue: quebraria o
  // servico, e nenhum SQL de instalacao reconstroi aquilo. O laco do reset apaga
  // por categoria, entao a lista de protegidos e a unica coisa entre ele e uma
  // instancia inutilizavel.
  const { rows } = await viaSql.pool.query(
    "SELECT 1 FROM information_schema.schemata WHERE schema_name = 'auth'",
  );
  assert.equal(rows.length, 1, "o reset derrubou o schema auth");

  const { rows: fn } = await viaSql.pool.query(
    "SELECT auth.uid() IS NULL AS ok",
  );
  assert.equal(fn[0].ok, true, "auth.uid() sumiu junto com o schema");
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

test("as contas de teste estao declaradas na instalacao", () => {
  // O trecho de contas nao roda no harness (o shim de `auth` e minimo), mas a
  // declaracao roda: um admin e um cliente comum. O cliente comum existe para se
  // conferir a fronteira de RLS na mao — e com ele que se ve, no navegador, que
  // um cliente nao enxerga pedido alheio.
  assert.ok(CONTAS_DE_TESTE.length >= 2, "esperado ao menos um admin e um cliente");
  assert.equal(CONTAS_DE_TESTE.filter((c) => c.admin).length, 1);
  assert.equal(CONTAS_DE_TESTE.filter((c) => !c.admin).length >= 1, true);

  for (const conta of CONTAS_DE_TESTE) {
    assert.ok(
      sqlGerado.includes(conta.email),
      `${conta.email} nao aparece na instalacao`,
    );
  }

  // O reset nao precisa mais nomear conta nenhuma — ele apaga auth.users
  // inteiro. Mas justamente por isso o cabecalho tem de gritar, e o arquivo NAO
  // pode ser usado numa instancia compartilhada.
  const reset = gerarReset();
  assert.ok(
    /RESET TOTAL/.test(reset) && /compartilhada/i.test(reset),
    "o cabecalho do reset perdeu o aviso de raio total / instancia compartilhada",
  );
});

test("o reset protege os schemas de servico e apaga o resto por categoria", () => {
  // A lista de protegidos e a unica coisa entre este arquivo e uma instancia
  // Supabase inutilizavel. Vale afirma-la por nome, e nao so pelo comportamento
  // no harness — que so tem `auth` e nao exercita os outros.
  const reset = gerarReset();
  const executavel = reset
    .split("\n")
    .filter((linha) => !linha.trim().startsWith("--"))
    .join("\n");

  for (const schema of [
    "auth",
    "storage",
    "realtime",
    "extensions",
    "graphql",
    "vault",
    "supabase_functions",
    "supabase_migrations",
  ]) {
    assert.ok(
      new RegExp(`'${schema}'`).test(executavel),
      `${schema} saiu da lista de protegidos — o reset passaria a derruba-lo`,
    );
  }

  // E o `public` tem de ser recriado, nao so derrubado.
  assert.ok(
    /DROP SCHEMA IF EXISTS public CASCADE/.test(executavel) &&
      /CREATE SCHEMA public/.test(executavel),
    "o reset derruba public sem recriar",
  );
});
