"use strict";

const { test, before, after, beforeEach } = require("node:test");
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

beforeEach(() => {
  // Sem esta guarda, um before() que falha faz CADA teste morrer num
  // "Cannot read properties of undefined (reading 'pool')", e o erro de boot —
  // que e a informacao util — some sob dez erros derivados.
  if (!bd) {
    throw new Error(
      "O Postgres nao subiu no before(); a causa real esta no erro daquele hook.",
    );
  }
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

test("anon le o catalogo pela view, agora com os proprios privilegios", async () => {
  // O ARRANJO QUE SUSTENTA A VITRINE INTEIRA — e ele MUDOU em 0006, entao este
  // comentario descreve o de hoje e nao o de 0003.
  //
  // ATE 0005 a view era `security_invoker = false`: rodava com os poderes de
  // quem a criou (o dono da tabela, isento de RLS), e o recorte de colunas da
  // view era, sozinho, o controle de acesso. Funcionava e tinha dois defeitos
  // caros: ligar FORCE ROW LEVEL SECURITY em `produtos` esvaziava a vitrine em
  // SILENCIO, e a escrita atraves da view (que e auto-atualizavel) era barrada
  // so por um REVOKE.
  //
  // A PARTIR DE 0006 a view e `security_invoker = true` e a leitura publica e
  // feita da forma comum: `anon` tem GRANT nas colunas publicas de
  // `canastra.produtos` e a politica `produtos_leitura_publica` deixa passar as
  // linhas. A isencao do dono saiu do caminho critico da vitrine — o que ela
  // ainda sustenta e `canastra.eh_cliente()`/`eh_admin()`, e essa dependencia
  // esta afirmada como invariante em test/rls.test.js.
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
  // Asercoes de CATALOGO, nao de comportamento, e e de proposito — mas as chaves
  // sao OUTRAS desde 0006, e a inversao do `security_invoker` e a maior delas.
  //
  // `view_invoker` TEM de ser true. Com ele false, a view volta a ler `produtos`
  // com os poderes do dono, e ai a vitrine passa a depender de novo da isencao de
  // RLS do dono — o arranjo que 0006 desmontou de proposito, porque seu modo de
  // falha (FORCE RLS -> vitrine vazia, sem erro e sem log) e silencioso.
  //
  // `produtos_forca_rls` continua tendo de ser false, agora por um motivo
  // diferente: nao e mais a vitrine que quebra (a politica
  // `produtos_leitura_publica` cobre o `anon` com ou sem FORCE), e sim
  // `canastra.eh_cliente()`/`eh_admin()`, que leem por baixo da RLS contando com
  // a isencao do dono. A regra geral disso — nenhuma tabela de `canastra` liga
  // FORCE — esta afirmada como invariante em test/rls.test.js; aqui fica so a
  // ponta que este arquivo ja vigiava.
  //
  // No harness o dono e superusuario e ignora ate o FORCE, entao um teste apenas
  // comportamental passaria verde com a producao quebrada. Ler o catalogo do
  // Postgres e o que fecha isso.
  const { rows } = await bd.pool.query(`
    SELECT
      (SELECT c.relforcerowsecurity
         FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'canastra' AND c.relname = 'produtos') AS produtos_forca_rls,
      (SELECT 'security_invoker=true' = ANY (c.reloptions)
         FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'canastra' AND c.relname = 'produtos_publicos') AS view_invoker
  `);

  assert.deepEqual(rows[0], {
    produtos_forca_rls: false,
    view_invoker: true,
  });
});

test("anon NAO alcanca `custo` por baixo da view", async () => {
  // O outro lado do teste acima, e desde 0006 e ele que guarda a margem da loja.
  //
  // Antes, o que protegia `custo` era a PROJECAO da view: `anon` nao tinha
  // privilegio nenhum na tabela base e a view escolhia o que sair. Agora `anon`
  // TEM privilegio na tabela — de COLUNA, na lista publica — e `custo` esta fora
  // dela. O caminho direto continua fechado, so que por outro mecanismo, e por
  // isso a asercao continua valendo a pena.
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

test("o que anon LE em produtos: colunas sim, tabela inteira nunca", async () => {
  // Regra 1 de 0001: nada nasce legivel por `anon`, quem for publico leva GRANT
  // proprio. `produto_opcoes` alimenta os filtros da vitrine e leva; `produtos`
  // leva um GRANT DE COLUNA desde 0006, para que a view possa ler a tabela com os
  // privilegios de quem chama.
  //
  // AS DUAS COLUNAS DESTA ASERCAO DIZEM COISAS DIFERENTES E AS DUAS IMPORTAM:
  // `has_table_privilege(..., 'SELECT')` responde pelo privilegio de TABELA e
  // continua `false`, que e o que impede um `select=*` de sair; um GRANT de
  // coluna nao o torna verdadeiro. `has_any_column_privilege` e o que virou
  // `true` em 0006. Se alguem um dia trocar o GRANT de coluna por um de tabela —
  // o "conserto" obvio para um 42501 no PostgREST —, `anon_le_tabela` acusa, e
  // `custo` teria acabado de vazar.
  //
  // So LEITURA e conferida aqui: `anon` NUNCA recebe INSERT de default privilege
  // nenhum, entao "anon nao escreve" seria verdade mesmo com esta migracao
  // inteira apagada. Quem tem escrita por padrao e `authenticated`, e e o teste
  // seguinte que cobre esse — o que de fato pode dar errado.
  const { rows } = await bd.pool.query(`
    SELECT
      has_table_privilege('anon', 'canastra.produtos', 'SELECT')             AS anon_le_tabela,
      has_any_column_privilege('anon', 'canastra.produtos', 'SELECT')        AS anon_le_colunas,
      has_column_privilege('anon', 'canastra.produtos', 'custo', 'SELECT')   AS anon_le_custo,
      has_column_privilege('anon', 'canastra.produtos', 'preco', 'SELECT')   AS anon_le_preco,
      has_table_privilege('anon', 'canastra.produto_opcoes', 'SELECT')       AS anon_le_opcoes,
      has_table_privilege('anon', 'canastra.produtos_publicos', 'SELECT')    AS anon_le_view
  `);

  assert.deepEqual(rows[0], {
    anon_le_tabela: false,
    anon_le_colunas: true,
    anon_le_custo: false,
    anon_le_preco: true,
    anon_le_opcoes: true,
    anon_le_view: true,
  });
});

test("em `admins` e na view a escrita continua REVOGADA; no catalogo ela voltou", async () => {
  // ESTE TESTE MUDOU DE LADO EM 0006, e a mudanca e a decisao mais cara da
  // migracao — entao ela fica escrita aqui, e nao so no SQL.
  //
  // 0003 revogou INSERT/UPDATE/DELETE de `authenticated` em `produtos` e
  // `produto_opcoes` porque, sem politica nenhuma, uma primeira politica ampla
  // demais (`FOR ALL USING (true)`) acordaria o `arwd` que 0001 concede por
  // padrao e entregaria o catalogo a um token de OUTRO projeto da instancia. O
  // REVOKE era a segunda tranca justamente porque a primeira nao existia.
  //
  // 0006 devolve esses privilegios de proposito: o painel do admin fala DIRETO
  // com o Supabase por supabase-js, e admin autentica como `authenticated` igual
  // a todo mundo — sem eles, nao ha como cadastrar produto. A segunda tranca foi
  // trocada por uma politica estreita (`canastra.eh_admin()`) e testada em
  // test/rls.test.js, que tambem afirma como INVARIANTE que nenhuma politica de
  // escrita deste schema e `USING (true)`.
  //
  // DUAS RELACOES NAO ENTRAM NA VOLTA, e sao as duas em que o estrago seria
  // irreversivel:
  //
  //   `admins` ............. sem privilegio de INSERT, nenhuma politica escrita
  //                          por engano promove um token estrangeiro a
  //                          administrador desta loja. E o alcapao.
  //   `produtos_publicos` .. a view e janela de LEITURA; escrita passa pela
  //                          tabela, onde a politica alcanca.
  const { rows } = await bd.pool.query(`
    SELECT
      t.relacao,
      has_table_privilege('authenticated', 'canastra.' || t.relacao, 'INSERT') AS insere,
      has_table_privilege('authenticated', 'canastra.' || t.relacao, 'UPDATE') AS altera,
      has_table_privilege('authenticated', 'canastra.' || t.relacao, 'DELETE') AS apaga,
      has_any_column_privilege('authenticated', 'canastra.' || t.relacao, 'SELECT') AS le
    FROM (VALUES ('produtos'), ('produto_opcoes'), ('produtos_publicos'), ('admins'))
      AS t(relacao)
    ORDER BY t.relacao
  `);

  assert.deepEqual(
    rows.map(({ relacao, insere, altera, apaga }) => ({ relacao, insere, altera, apaga })),
    [
      { relacao: "admins", insere: false, altera: false, apaga: false },
      { relacao: "produto_opcoes", insere: true, altera: true, apaga: true },
      { relacao: "produtos", insere: true, altera: true, apaga: true },
      { relacao: "produtos_publicos", insere: false, altera: false, apaga: false },
    ],
  );

  // A LEITURA continua de pe, e conferir isso importa tanto quanto o resto: um
  // `REVOKE ALL` distraido no lugar do REVOKE de escrita passaria na asercao
  // acima e quebraria o painel inteiro, que le estas tabelas como usuario logado.
  //
  // `has_any_column_privilege`, e nao `has_table_privilege`: em `produtos` a
  // leitura de `authenticated` e por COLUNA desde 0006 (a lista publica), para
  // que `custo` nao saia no PostgREST. Ver o teste das colunas de `anon` acima.
  assert.deepEqual(rows.map((r) => r.le), [true, true, true, true]);
});

test("na pratica: authenticated de fora da loja nao apaga o catalogo", async () => {
  // O que o teste acima afirma pelo catalogo do Postgres, agora como comando de
  // verdade: `sub` que NAO esta em `canastra.clientes` — o token de outro projeto
  // da instancia compartilhada — indo direto na tabela, sem passar pela view.
  //
  // DESDE 0006 A RECUSA TEM DUAS FORMAS, porque quem barra deixou de ser o
  // privilegio de tabela (que voltou) e passou a ser a politica:
  //
  //   INSERT ........... 42501, o WITH CHECK barra a linha nova
  //   UPDATE / DELETE .. 0 linhas afetadas, SEM erro — o USING nao casa nada
  //
  // A segunda forma e silenciosa e e a semantica normal da RLS: o USING filtra,
  // nao acusa. O intruso recebe "sucesso, 0 linhas" e o catalogo fica intacto —
  // que e o desfecho certo, so que menos barulhento do que era. Registrado aqui
  // para que ninguem o descubra depurando producao.
  await assert.rejects(
    () =>
      comoPapel(bd.pool, { papel: "authenticated", sub: INTRUSO }, (cliente) =>
        cliente.query("INSERT INTO canastra.produtos (nome) VALUES ('Invasor direto')"),
      ),
    (erro) => {
      assert.equal(erro.code, PERMISSAO_NEGADA);
      return true;
    },
  );

  for (const sql of [
    "UPDATE canastra.produtos SET preco = 0.01",
    "DELETE FROM canastra.produtos",
    "DELETE FROM canastra.produto_opcoes",
  ]) {
    const afetadas = await comoPapel(
      bd.pool,
      { papel: "authenticated", sub: INTRUSO },
      async (cliente) => {
        const { rowCount } = await cliente.query(sql);
        return rowCount;
      },
    );
    assert.equal(afetadas, 0, `nao deveria afetar linha nenhuma: ${sql}`);
  }

  const { rows } = await bd.pool.query(
    "SELECT count(*)::int AS n FROM canastra.produtos",
  );
  assert.ok(rows[0].n > 0, "o catalogo deveria continuar de pe");
});

/* --------------------------------------------------------------------------
 * `estado` e os DOIS leitores da view publica (0037)
 * -------------------------------------------------------------------------- */

const ARQUIVADO = "cccccccc-0000-0000-0000-0000000000a9";
const RASCUNHO = "cccccccc-0000-0000-0000-0000000000a8";

/** Os dois produtos que só existem para medir o recorte de `estado`. */
async function semearEstados() {
  await bd.pool.query(
    `INSERT INTO canastra.produtos
       (produto_id, nome, preco, quantidade, sku, estado)
     VALUES
       ($1, 'Canastra Aposentado', 39.90, 0, 'CAN-APO-250', 'arquivado'),
       ($2, 'Canastra Em Estudo',  49.90, 3, 'CAN-EST-250', 'rascunho')
     ON CONFLICT (produto_id) DO NOTHING`,
    [ARQUIVADO, RASCUNHO],
  );
}

test("a vitrine deixa de ver o produto ARQUIVADO", async () => {
  // Sem este recorte, arquivar um café não o tira da loja: a view não tinha
  // WHERE nenhum, e `estado` prometia mais do que entregava.
  await semearEstados();

  const nomes = await comoPapel(bd.pool, { papel: "anon" }, async (cliente) => {
    const { rows } = await cliente.query(
      "SELECT nome FROM canastra.produtos_publicos ORDER BY nome",
    );
    return rows.map((r) => r.nome);
  });

  assert.ok(!nomes.includes("Canastra Aposentado"), "arquivado não pode aparecer");
  assert.ok(nomes.includes("Canastra Classico"), "o catálogo ativo continua de pé");
  // `<> 'arquivado'` e NÃO `= 'ativo'`: o rascunho continua visível, e isso é
  // uma decisão de produto que a tela da Onda 5 precisa conhecer — se ela
  // salvar rascunho, o rascunho aparece na loja.
  assert.ok(nomes.includes("Canastra Em Estudo"));
});

test("o SEGUNDO leitor continua resolvendo o SKU do produto arquivado", async () => {
  // `AvaliarPedido.tsx` traduz `product_id` (congelado em `pedidos.itens`) para
  // o SKU por onde a avaliação é gravada. Se ele lesse a view filtrada, arquivar
  // um café apagaria em silêncio o formulário de avaliação de quem já o comprou
  // — sem erro nenhum na tela. `pode_avaliar(sku)` não olha estado: quem
  // recebeu, avalia.
  await semearEstados();

  const linhas = await comoPapel(
    bd.pool,
    { papel: "authenticated", sub: INTRUSO },
    async (cliente) => {
      const { rows } = await cliente.query(
        "SELECT produto_id, sku FROM canastra.produtos_sku WHERE produto_id = $1",
        [ARQUIVADO],
      );
      return rows;
    },
  );

  assert.equal(linhas.length, 1);
  assert.equal(linhas[0].sku, "CAN-APO-250");
});

test("`produtos_sku` mostra o SKU e mais nada — e `anon` não a alcança", async () => {
  const { rows } = await bd.pool.query(
    `SELECT column_name FROM information_schema.columns
      WHERE table_schema = 'canastra' AND table_name = 'produtos_sku'
      ORDER BY column_name`,
  );
  assert.deepEqual(rows.map((r) => r.column_name), ["produto_id", "sku"]);

  // Só quem tem conta abre a página do próprio pedido. `anon` não tem por que
  // enumerar SKU de produto arquivado.
  await assert.rejects(
    () =>
      comoPapel(bd.pool, { papel: "anon" }, (cliente) =>
        cliente.query("SELECT produto_id FROM canastra.produtos_sku"),
      ),
    (erro) => {
      assert.equal(erro.code, PERMISSAO_NEGADA);
      return true;
    },
  );
});

test("`produtos_sku` é janela de LEITURA: escrita por ela é recusada", async () => {
  // O mesmo furo que 0003 fechou em `produtos_publicos`: os ALTER DEFAULT
  // PRIVILEGES de 0001 alcançam VIEWS, e uma view auto-atualizável nasce
  // gravável por `authenticated`.
  for (const sql of [
    "INSERT INTO canastra.produtos_sku (produto_id, sku) VALUES (gen_random_uuid(), 'X')",
    "UPDATE canastra.produtos_sku SET sku = 'X'",
    "DELETE FROM canastra.produtos_sku",
  ]) {
    await assert.rejects(
      () =>
        comoPapel(bd.pool, { papel: "authenticated", sub: INTRUSO }, (cliente) =>
          cliente.query(sql),
        ),
      (erro) => {
        assert.equal(erro.code, PERMISSAO_NEGADA, sql);
        return true;
      },
    );
  }
});
