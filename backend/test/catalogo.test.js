"use strict";

const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { subirPostgres } = require("./ajuda/postgres.js");
const { comoPapel, PERMISSAO_NEGADA } = require("./ajuda/sessao.js");
const { aplicarMigracoes } = require("../db/migrar.js");

let bd;
const CAFE = "cccccccc-0000-0000-0000-000000000001";
// Um `sub` qualquer de sessao autenticada. NAO precisa existir em `auth.users`:
// e exatamente esse o cenario perigoso da instancia compartilhada — token valido
// de OUTRO projeto, `auth.uid()` preenchido, e nenhuma linha em
// `canastra.clientes`.
const INTRUSO = "eeeeeeee-0000-0000-0000-000000000005";

before(async () => {
  bd = await subirPostgres();
  await aplicarMigracoes(bd.pool);
  await bd.pool.query(
    `INSERT INTO canastra.produtos
       (produto_id, nome, tamanho, categoria, preco, quantidade, descricao, sku, custo)
     VALUES ($1, 'Canastra Classico', '250 g', 'Cafe', 54.90, 10,
             'Torra media, notas de chocolate', 'CAN-CLA-250', 22.50)`,
    [CAFE],
  );
}, { timeout: 120_000 });

after(async () => {
  await bd?.derrubar();
});

test("a busca por texto acha o produto pelo termo da descricao", async () => {
  const { rows } = await bd.pool.query(
    `SELECT nome FROM canastra.produtos
     WHERE tsv @@ plainto_tsquery('portuguese', 'chocolate')`,
  );
  assert.deepEqual(rows.map((r) => r.nome), ["Canastra Classico"]);
});

test("a configuracao de busca 'portuguese' existe neste Postgres", async () => {
  // A coluna gerada `tsv` esta amarrada a esta configuracao: se ela nao
  // existisse, a propria migracao 0003 falharia com 42704 e o deploy pararia.
  // Conferir aqui separa "o dicionario nao existe" de "o texto nao casou" —
  // dois diagnosticos completamente diferentes para o mesmo teste vermelho
  // acima. Vale tambem como aviso: um Postgres compilado sem o snowball
  // portugues nao serve para esta loja.
  const { rows } = await bd.pool.query(
    "SELECT count(*)::int AS n FROM pg_ts_config WHERE cfgname = 'portuguese'",
  );
  assert.equal(rows[0].n, 1);
});

test("sku e unico, mas varios produtos podem ter sku nulo", async () => {
  await bd.pool.query(
    `INSERT INTO canastra.produtos (produto_id, nome) VALUES
       (gen_random_uuid(), 'Sem sku 1'), (gen_random_uuid(), 'Sem sku 2')`,
  );

  await assert.rejects(
    () =>
      bd.pool.query(
        `INSERT INTO canastra.produtos (produto_id, nome, sku)
         VALUES (gen_random_uuid(), 'Duplicado', 'CAN-CLA-250')`,
      ),
    /produtos_sku_idx|duplicate key/i,
  );
});

test("a view publica nao expoe custo", async () => {
  const { rows } = await bd.pool.query(
    `SELECT column_name FROM information_schema.columns
     WHERE table_schema = 'canastra' AND table_name = 'produtos_publicos'`,
  );
  const colunas = rows.map((r) => r.column_name);
  assert.ok(colunas.includes("preco"), "preco deveria estar na view");
  assert.ok(!colunas.includes("custo"), "custo NAO pode estar na view publica");
});

test("com a RLS ligada e ZERO politicas, anon ainda le o catalogo pela view", async () => {
  // O ARRANJO QUE SUSTENTA A VITRINE INTEIRA, e o unico ponto desta fase em que
  // duas regras aparentemente opostas se cruzam: `produtos` sai da migracao com
  // RLS ligada e sem politica nenhuma (Regra 2, falhar fechado), e mesmo assim o
  // catalogo tem de ser publico.
  //
  // Quem resolve e o `security_invoker = false`: a view roda com os poderes de
  // quem a criou — o dono da tabela —, e dono de tabela e isento de RLS enquanto
  // ninguem ligar FORCE ROW LEVEL SECURITY. Ou seja, a RLS de `produtos` nao
  // filtra a leitura feita pela view, e o recorte de colunas da view e que faz o
  // controle de acesso.
  //
  // ATENCAO AO ALCANCE DESTE TESTE, que e menor do que parece: aqui o dono e o
  // `postgres` do harness, superusuario, e superusuario ignora RLS por outro
  // caminho que nao a isencao do dono. Ou seja, este caso cobre o
  // `security_invoker` virar true (vira 42501) e a view mudar de dono, mas NAO
  // cobre alguem ligar FORCE ROW LEVEL SECURITY — medido a parte, com dono
  // nao-superusuario: com FORCE a leitura devolve ZERO linhas, calada. Esse
  // buraco e fechado pelo teste seguinte, que le o catalogo do Postgres.
  const linhas = await comoPapel(bd.pool, { papel: "anon" }, async (cliente) => {
    const { rows } = await cliente.query(
      "SELECT nome, preco FROM canastra.produtos_publicos ORDER BY nome",
    );
    return rows;
  });

  assert.ok(linhas.length >= 1, "anon deveria enxergar o catalogo pela view");
  assert.ok(
    linhas.some((l) => l.nome === "Canastra Classico"),
    "o cafe cadastrado no before() deveria aparecer para anon",
  );
});

test("as duas chaves que fazem a vitrine funcionar continuam na posicao", async () => {
  // Duas asercoes de CATALOGO, nao de comportamento, e e de proposito. Com dono
  // nao-superusuario — a forma de producao — foi medido que:
  //
  //   FORCE ROW LEVEL SECURITY em `produtos`  -> anon le ZERO linhas, sem erro
  //   security_invoker = true na view         -> 42501 na vitrine inteira
  //
  // O segundo caso e barulhento e o teste comportamental acima o pega. O primeiro
  // e SILENCIOSO — a loja fica sem produto nenhum e nada aparece em log — e, pior,
  // no harness ele nem se manifesta, porque o dono aqui e superusuario e
  // superusuario ignora ate o FORCE. Um teste so comportamental passaria verde
  // com a producao vazia. Ler o catalogo do Postgres e o que fecha isso.
  const { rows } = await bd.pool.query(`
    SELECT
      (SELECT c.relforcerowsecurity
         FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'canastra' AND c.relname = 'produtos') AS produtos_forca_rls,
      (SELECT 'security_invoker=true' = ANY (c.reloptions)
         FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'canastra' AND c.relname = 'produtos_publicos') AS view_invoker,
      (SELECT pg_get_userbyid(t.relowner) = pg_get_userbyid(v.relowner)
         FROM pg_class t, pg_class v
        WHERE t.oid = 'canastra.produtos'::regclass
          AND v.oid = 'canastra.produtos_publicos'::regclass) AS mesmo_dono
  `);

  assert.deepEqual(rows[0], {
    produtos_forca_rls: false,
    // NULL tambem seria "nao esta ligado" (reloptions vazio), mas a migracao
    // escreve a opcao explicitamente, entao esperar `false` e mais apertado: se o
    // WITH (...) sumir da view, isto acusa.
    view_invoker: false,
    mesmo_dono: true,
  });
});

test("anon NAO alcanca a tabela produtos por baixo da view", async () => {
  // O outro lado do teste acima. A view so e um controle de acesso se o caminho
  // direto estiver fechado: com GRANT na tabela base, `custo` sairia no PostgREST
  // junto com o resto.
  await assert.rejects(
    () =>
      comoPapel(bd.pool, { papel: "anon" }, (cliente) =>
        cliente.query("SELECT custo FROM canastra.produtos"),
      ),
    (erro) => {
      assert.equal(erro.code, PERMISSAO_NEGADA);
      return true;
    },
  );
});

test("a view publica nao e porta de ESCRITA para authenticated", async () => {
  // Furo real e nada obvio, medido antes de existir o REVOKE de 0003: os ALTER
  // DEFAULT PRIVILEGES de 0001 valem tambem para VIEWS, entao `authenticated`
  // nascia com INSERT/UPDATE/DELETE em `produtos_publicos`. E a view e
  // auto-atualizavel (projecao simples de uma tabela so), entao a escrita chegava
  // em `canastra.produtos` — com os poderes do DONO, por causa do
  // `security_invoker = false`, portanto PASSANDO POR CIMA da RLS.
  //
  // Ou seja: qualquer usuario logado da instancia compartilhada poderia inserir,
  // alterar preco ou apagar produtos do catalogo. O `security_invoker = false` e
  // necessario para a leitura publica e, sem o REVOKE, entregava a escrita junto.
  const ESCRITAS = [
    `INSERT INTO canastra.produtos_publicos (nome, preco) VALUES ('Invasor', 0.01)`,
    `UPDATE canastra.produtos_publicos SET preco = 0.01`,
    `DELETE FROM canastra.produtos_publicos`,
  ];

  for (const sql of ESCRITAS) {
    await assert.rejects(
      () =>
        comoPapel(
          bd.pool,
          { papel: "authenticated", sub: INTRUSO },
          (cliente) => cliente.query(sql),
        ),
      (erro) => {
        assert.equal(erro.code, PERMISSAO_NEGADA, `deveria recusar: ${sql}`);
        return true;
      },
    );
  }

  const { rows } = await bd.pool.query(
    "SELECT count(*)::int AS n FROM canastra.produtos WHERE nome = 'Invasor'",
  );
  assert.equal(rows[0].n, 0);
});

test("produto_opcoes e publico no nivel de TABELA; produtos nao", async () => {
  // Regra 1 de 0001: nada nasce legivel por `anon`, quem for publico leva GRANT
  // proprio. `produto_opcoes` alimenta os filtros da vitrine e leva; `produtos`
  // fica fechada porque o publico dela e a view.
  const { rows } = await bd.pool.query(`
    SELECT
      has_table_privilege('anon', 'canastra.produtos', 'SELECT')           AS anon_le_produtos,
      has_table_privilege('anon', 'canastra.produto_opcoes', 'SELECT')     AS anon_le_opcoes,
      has_table_privilege('anon', 'canastra.produto_opcoes', 'INSERT')     AS anon_escreve_opcoes,
      has_table_privilege('anon', 'canastra.produtos_publicos', 'SELECT')  AS anon_le_view,
      has_table_privilege('anon', 'canastra.produtos_publicos', 'INSERT')  AS anon_escreve_view
  `);

  assert.deepEqual(rows[0], {
    anon_le_produtos: false,
    anon_le_opcoes: true,
    anon_escreve_opcoes: false,
    anon_le_view: true,
    anon_escreve_view: false,
  });
});

test("as duas tabelas de 0003 saem com a RLS ligada", async () => {
  // Mesma chave geral de 0002: entre o COMMIT desta migracao e o da que escreve
  // as politicas ha uma janela real, e um deploy que pare no meio tem de parar
  // FECHADO. Vale inclusive para `produtos`, cuja leitura publica nao depende de
  // politica nenhuma — depende da view.
  const { rows } = await bd.pool.query(`
    SELECT c.relname AS tabela, c.relrowsecurity AS ligada
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'canastra' AND c.relname IN ('produtos', 'produto_opcoes')
    ORDER BY c.relname
  `);

  assert.deepEqual(rows, [
    { tabela: "produto_opcoes", ligada: true },
    { tabela: "produtos", ligada: true },
  ]);
});
