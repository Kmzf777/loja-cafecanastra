"use strict";

/**
 * A migração 0030, vista de fora: quem lê e quem escreve o herói da home e a
 * barra de aviso.
 *
 * POR QUE ESTE ARQUIVO EXISTE SEPARADO DE rls.test.js. Aquele arquivo prova as
 * políticas de 0006 contra as tabelas de 0006; este prova as duas tabelas
 * novas, e as duas coisas envelhecem em ritmos diferentes. O que os dois
 * compartilham é o molde e a disciplina: papel do Supabase assumido por
 * `comoPapel`, dentro de BEGIN/ROLLBACK, e asserção em SQLSTATE — nunca em
 * texto de mensagem.
 *
 * AS QUATRO IDENTIDADES, e a razão de nenhuma poder faltar:
 *
 *   ANON ........ a vitrine antes de qualquer login. É quem MAIS precisa ler o
 *                 herói (ele é a primeira coisa da página) e quem nunca pode
 *                 escrever.
 *   ANA ......... cliente desta loja. Tem linha em `canastra.clientes`, e por
 *                 isso passa por `eh_cliente()` — o que não lhe dá NADA aqui.
 *   ESTRANHA .... token válido de OUTRO projeto da instância Supabase
 *                 compartilhada. Assinatura boa, `auth.uid()` preenchido, e
 *                 nenhuma linha em `clientes`. É contra ela que 0006 foi
 *                 escrito, e é ela que um `auth.uid() IS NOT NULL` deixaria
 *                 entrar.
 *   DORA ........ cliente E administradora (linha em `canastra.admins`). A
 *                 única que escreve.
 *
 * O QUE A RLS FAZ QUANDO RECUSA, porque os dois desfechos aparecem abaixo:
 * INSERT sem WITH CHECK que case levanta 42501; UPDATE e DELETE sem USING que
 * case simplesmente NÃO ENCONTRAM LINHA e devolvem zero afetadas, sem erro.
 * "0 linhas" também é uma recusa, e quem depurar isto em produção precisa
 * saber disso antes.
 */

const { test, before, after, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const { subirPostgres } = require("./ajuda/postgres.js");
const { comoPapel, PERMISSAO_NEGADA } = require("./ajuda/sessao.js");
const { aplicarMigracoes } = require("../db/migrar.js");

let bd;

/**
 * SQLSTATE `check_violation` — o que o Postgres devolve quando uma restrição
 * de CHECK recusa a linha. É por ele que a linha única do herói, o vocabulário
 * de `chave` e a lista de idiomas se defendem.
 */
const CHECK_VIOLADO = "23514";

/**
 * SQLSTATE `unique_violation`. O GUARDA DUPLO da linha única passa por ele:
 * um INSERT que NÃO cita `id` pega o DEFAULT 1, atravessa o CHECK sem tropeçar
 * e só então bate na chave primária. Quem tratar erro no painel precisa
 * esperar os DOIS códigos, e é por isso que os dois estão afirmados aqui.
 */
const CHAVE_DUPLICADA = "23505";

const ANA = "aaaaaaaa-0000-0000-0000-000000000001";
const DORA = "dddddddd-0000-0000-0000-000000000004";
const ESTRANHA = "eeeeeeee-0000-0000-0000-000000000005";

const SESSAO_ANON = { papel: "anon" };
const SESSAO_ANA = { papel: "authenticated", sub: ANA };
const SESSAO_DORA = { papel: "authenticated", sub: DORA };
const SESSAO_ESTRANHA = { papel: "authenticated", sub: ESTRANHA };

/** As duas tabelas desta migração, para os laços que valem para as duas. */
const TABELAS = ["vitrine_heroi", "vitrine_texto"];

/**
 * Roda um comando e exige 42501.
 *
 * O predicado, e não uma regex sobre a mensagem, pelo motivo do cabeçalho de
 * rls.test.js: /permission denied/i casa igualmente com "permission denied for
 * schema canastra", que seria um GRANT faltando na migração — bug OPOSTO ao que
 * estes testes provam, e que passaria verde. O `contexto` entra na mensagem
 * porque estes testes rodam em laço.
 */
async function exigeRecusa(sessao, sql, parametros, contexto) {
  await assert.rejects(
    () => comoPapel(bd.pool, sessao, (cliente) => cliente.query(sql, parametros)),
    (erro) => {
      assert.equal(erro.code, PERMISSAO_NEGADA, `deveria recusar com 42501: ${contexto}`);
      return true;
    },
  );
}

/** Roda um comando e exige o SQLSTATE dado (as violações de restrição). */
async function exigeSqlstate(sessao, sqlstate, sql, parametros, contexto) {
  await assert.rejects(
    () => comoPapel(bd.pool, sessao, (cliente) => cliente.query(sql, parametros)),
    (erro) => {
      assert.equal(erro.code, sqlstate, `deveria recusar com ${sqlstate}: ${contexto}`);
      return true;
    },
  );
}

/** Conta linhas visíveis numa tabela, sob a sessão dada. */
async function contar(sessao, tabela) {
  return comoPapel(bd.pool, sessao, async (cliente) => {
    const { rows } = await cliente.query(
      `SELECT count(*)::int AS n FROM canastra.${tabela}`,
    );
    return rows[0].n;
  });
}

before(async () => {
  bd = await subirPostgres();
  await aplicarMigracoes(bd.pool);

  // A semeadura roda como dono do banco, que é isento de RLS — de propósito: o
  // que se testa aqui é a LEITURA e a ESCRITA pelos papéis do Supabase, não a
  // montagem do cenário.
  await bd.pool.query(
    `INSERT INTO auth.users (id, email) VALUES
       ($1,'ana@ex.com'), ($2,'dora@ex.com'), ($3,'estranha@outroprojeto.com')`,
    [ANA, DORA, ESTRANHA],
  );
  await bd.pool.query(
    "INSERT INTO canastra.clientes (user_id, nome) VALUES ($1,'Ana'), ($2,'Dora')",
    [ANA, DORA],
  );
  await bd.pool.query("INSERT INTO canastra.admins (user_id) VALUES ($1)", [DORA]);

  await bd.pool.query(
    `INSERT INTO canastra.vitrine_heroi (id, imagem_desktop, imagem_mobile)
     VALUES (1, 'https://cdn/heroi-desktop.jpg', 'https://cdn/heroi-mobile.jpg')`,
  );
  await bd.pool.query(
    `INSERT INTO canastra.vitrine_texto (chave, locale, kicker, titulo, texto)
     VALUES ('heroi', 'pt', 'Da Serra da Canastra', 'Café de verdade', 'Torra do dia'),
            ('barra_aviso', 'pt', NULL, NULL, 'Frete grátis acima de R$ 149')`,
  );
}, { timeout: 120_000 });

after(async () => {
  await bd?.derrubar();
});

beforeEach(() => {
  // Sem esta guarda, um before() que falha faz CADA teste morrer num
  // "Cannot read properties of undefined (reading 'pool')", e o erro de boot —
  // que é a informação útil — some sob N erros derivados.
  if (!bd) {
    throw new Error(
      "O Postgres nao subiu no before(); a causa real esta no erro daquele hook.",
    );
  }
});

/* --------------------------------------------------------------------------
 * Leitura: a vitrine anônima
 * -------------------------------------------------------------------------- */

test("a vitrine anônima LÊ o herói e os textos", async () => {
  // O caso que justifica o GRANT para `anon`. O herói é a primeira coisa da
  // home e ela é servida antes de qualquer login: se este teste ficar vermelho,
  // a loja abre com o topo em branco para todo visitante — e o sintoma no
  // PostgREST seria um 404 que parece "a tabela não existe".
  assert.deepEqual(
    {
      heroi: await contar(SESSAO_ANON, "vitrine_heroi"),
      texto: await contar(SESSAO_ANON, "vitrine_texto"),
    },
    { heroi: 1, texto: 2 },
  );

  const heroi = await comoPapel(bd.pool, SESSAO_ANON, async (cliente) => {
    const { rows } = await cliente.query(
      "SELECT imagem_desktop, imagem_mobile FROM canastra.vitrine_heroi WHERE id = 1",
    );
    return rows[0];
  });
  assert.deepEqual(heroi, {
    imagem_desktop: "https://cdn/heroi-desktop.jpg",
    imagem_mobile: "https://cdn/heroi-mobile.jpg",
  });
});

test("quem está logado — cliente, admin ou estranho — lê o mesmo que o anônimo", async () => {
  // Não há recorte de linha na leitura, e é isso que se afirma: as duas tabelas
  // são conteúdo de vitrine, não dado de pessoa. Uma política de SELECT que um
  // dia estreitasse por identidade faria o herói sumir para quem estivesse
  // logado — e ninguém procuraria por ali.
  const vistos = {};
  for (const [quem, sessao] of [
    ["ana", SESSAO_ANA],
    ["dora", SESSAO_DORA],
    ["estranha", SESSAO_ESTRANHA],
  ]) {
    vistos[quem] = {
      heroi: await contar(sessao, "vitrine_heroi"),
      texto: await contar(sessao, "vitrine_texto"),
    };
  }

  assert.deepEqual(vistos, {
    ana: { heroi: 1, texto: 2 },
    dora: { heroi: 1, texto: 2 },
    estranha: { heroi: 1, texto: 2 },
  });
});

/* --------------------------------------------------------------------------
 * Escrita: os três que não podem, e a que pode
 * -------------------------------------------------------------------------- */

test("a vitrine anônima NÃO escreve", async () => {
  // Aqui a recusa vem do PRIVILÉGIO, não da política: `anon` recebeu apenas
  // `GRANT SELECT`, e o default de 0001 não lhe dá nada. Por isso os TRÊS
  // comandos erram com 42501 — inclusive UPDATE e DELETE, que para um papel
  // COM privilégio devolveriam zero linhas caladas (é o teste seguinte).
  await exigeRecusa(
    SESSAO_ANON,
    "INSERT INTO canastra.vitrine_heroi (id, imagem_desktop) VALUES (1, 'x')",
    [],
    "anon inserindo herói",
  );
  await exigeRecusa(
    SESSAO_ANON,
    "UPDATE canastra.vitrine_heroi SET imagem_desktop = 'x' WHERE id = 1",
    [],
    "anon alterando herói",
  );
  await exigeRecusa(
    SESSAO_ANON,
    "DELETE FROM canastra.vitrine_heroi WHERE id = 1",
    [],
    "anon apagando herói",
  );

  await exigeRecusa(
    SESSAO_ANON,
    "INSERT INTO canastra.vitrine_texto (chave, locale, titulo) VALUES ('heroi','en','x')",
    [],
    "anon inserindo texto",
  );
  await exigeRecusa(
    SESSAO_ANON,
    "UPDATE canastra.vitrine_texto SET titulo = 'x' WHERE chave = 'heroi'",
    [],
    "anon alterando texto",
  );
  await exigeRecusa(
    SESSAO_ANON,
    "DELETE FROM canastra.vitrine_texto WHERE chave = 'heroi'",
    [],
    "anon apagando texto",
  );
});

test("cliente logado NÃO escreve, e o estranho da instância tampouco", async () => {
  // A DIFERENÇA PARA O TESTE ACIMA É O QUE IMPORTA. Ana e Estranha têm
  // privilégio de tabela — o `ALTER DEFAULT PRIVILEGES` de 0001 dá
  // INSERT/UPDATE/DELETE a `authenticated` em toda tabela nova de `canastra`,
  // sem ninguém pedir. O que as barra é EXCLUSIVAMENTE a política, e por isso o
  // desfecho muda de forma: INSERT levanta 42501 (o WITH CHECK barra a linha
  // nova), UPDATE e DELETE devolvem ZERO linhas, sem erro nenhum.
  //
  // Ser cliente da loja não ajuda em nada aqui, e é essa a asserção: só a linha
  // em `canastra.admins` abre a porta.
  for (const [quem, sessao] of [
    ["ana", SESSAO_ANA],
    ["estranha", SESSAO_ESTRANHA],
  ]) {
    await exigeRecusa(
      sessao,
      "INSERT INTO canastra.vitrine_texto (chave, locale, titulo) VALUES ('heroi','en','invadido')",
      [],
      `${quem} inserindo texto`,
    );

    const afetadas = await comoPapel(bd.pool, sessao, async (cliente) => {
      const alterou = await cliente.query(
        "UPDATE canastra.vitrine_heroi SET imagem_desktop = 'invadido' WHERE id = 1",
      );
      const apagou = await cliente.query(
        "DELETE FROM canastra.vitrine_texto WHERE chave = 'heroi'",
      );
      return { alterou: alterou.rowCount, apagou: apagou.rowCount };
    });

    assert.deepEqual(
      afetadas,
      { alterou: 0, apagou: 0 },
      `${quem} não pode mexer em linha nenhuma`,
    );
  }

  // E o conteúdo continua exatamente o que era — a prova de que os zeros acima
  // são recusa, e não um UPDATE que casou e não mudou nada.
  const { rows } = await bd.pool.query(
    "SELECT imagem_desktop FROM canastra.vitrine_heroi WHERE id = 1",
  );
  assert.equal(rows[0].imagem_desktop, "https://cdn/heroi-desktop.jpg");
});

test("admin escreve: altera o herói, cria texto de outro idioma e apaga", async () => {
  const resultado = await comoPapel(bd.pool, SESSAO_DORA, async (cliente) => {
    const alterou = await cliente.query(
      "UPDATE canastra.vitrine_heroi SET imagem_desktop = $1, atualizado_em = now() WHERE id = 1",
      ["https://cdn/novo.jpg"],
    );

    // `RETURNING *` de propósito: em `canastra.produtos`, e SÓ nela, ele falha
    // com 42501 por causa do GRANT por COLUNA de 0006. Estas duas tabelas não
    // têm privilégio de coluna nenhum, então o painel pode usar `.select()` do
    // supabase-js à vontade — e é bom que um teste diga isso, porque a regra de
    // `produtos` não é óbvia nem local.
    const inseriu = await cliente.query(
      `INSERT INTO canastra.vitrine_texto (chave, locale, kicker, titulo, texto, rotulo_botao, destino, imagem_alt)
       VALUES ('heroi','en','From the Canastra','Real coffee','Roasted today','Shop','/en/produtos','Grãos torrados')
       RETURNING *`,
    );

    const apagou = await cliente.query(
      "DELETE FROM canastra.vitrine_texto WHERE chave = 'barra_aviso' AND locale = 'pt'",
    );

    const { rows } = await cliente.query(
      "SELECT imagem_desktop FROM canastra.vitrine_heroi WHERE id = 1",
    );

    return {
      alterou: alterou.rowCount,
      inseriu: inseriu.rows[0].titulo,
      apagou: apagou.rowCount,
      imagem: rows[0].imagem_desktop,
    };
  });

  assert.deepEqual(resultado, {
    alterou: 1,
    inseriu: "Real coffee",
    apagou: 1,
    imagem: "https://cdn/novo.jpg",
  });
});

/* --------------------------------------------------------------------------
 * As restrições de estrutura
 * -------------------------------------------------------------------------- */

test("vitrine_heroi é linha única, e recusa pelos DOIS caminhos", async () => {
  // O guarda duplo de `config_loja` (0005), repetido aqui porque quem trata o
  // erro no painel precisa esperar os dois SQLSTATEs — e um `catch` que só
  // conhecesse 23514 mostraria "erro inesperado" para o caminho mais provável,
  // que é o INSERT sem citar `id`.
  await exigeSqlstate(
    SESSAO_DORA,
    CHECK_VIOLADO,
    "INSERT INTO canastra.vitrine_heroi (id, imagem_desktop) VALUES (2, 'segundo heroi')",
    [],
    "id explícito diferente de 1",
  );

  await exigeSqlstate(
    SESSAO_DORA,
    CHAVE_DUPLICADA,
    "INSERT INTO canastra.vitrine_heroi (imagem_desktop) VALUES ('segundo heroi')",
    [],
    "sem citar id: pega o DEFAULT 1 e bate na PK",
  );
});

test("locale fora de (pt,en,es) é recusado", async () => {
  // 'pt-BR' é o erro provável, e o motivo de a lista ser fechada por CHECK: a
  // vitrine procura por 'pt' (é o que `app/[locale]` usa), então um 'pt-BR'
  // gravado nunca seria lido e o gestor veria o texto sumir sem mensagem
  // nenhuma. Melhor recusar na gravação do que perder em silêncio na leitura.
  await exigeSqlstate(
    SESSAO_DORA,
    CHECK_VIOLADO,
    "INSERT INTO canastra.vitrine_texto (chave, locale, titulo) VALUES ('heroi','pt-BR','x')",
    [],
    "locale pt-BR",
  );
  await exigeSqlstate(
    SESSAO_DORA,
    CHECK_VIOLADO,
    "INSERT INTO canastra.vitrine_texto (chave, locale, titulo) VALUES ('heroi','fr','x')",
    [],
    "locale fr",
  );

  // E os três válidos passam — senão o teste acima ficaria verde também com um
  // CHECK que recusasse tudo.
  const gravados = await comoPapel(bd.pool, SESSAO_DORA, async (cliente) => {
    await cliente.query(
      `INSERT INTO canastra.vitrine_texto (chave, locale, titulo) VALUES
         ('barra_aviso','en','x'), ('barra_aviso','es','y')`,
    );
    const { rows } = await cliente.query(
      "SELECT locale FROM canastra.vitrine_texto WHERE chave = 'barra_aviso' ORDER BY locale",
    );
    return rows.map((r) => r.locale);
  });
  assert.deepEqual(gravados, ["en", "es", "pt"]);
});

test("chave fora de (heroi,barra_aviso) é recusada", async () => {
  await exigeSqlstate(
    SESSAO_DORA,
    CHECK_VIOLADO,
    "INSERT INTO canastra.vitrine_texto (chave, locale, titulo) VALUES ('rodape','pt','x')",
    [],
    "chave rodape",
  );
});

test("toda coluna de conteúdo é nulável — o fallback do §3.6 escrito no schema", async () => {
  // A REGRA DE SEGURANÇA DA ONDA, afirmada como propriedade do catálogo e não
  // como comportamento: o valor de hoje, chumbado em `page.tsx`, é o PISO. Um
  // NOT NULL em qualquer campo de conteúdo obrigaria o gestor a preencher os
  // seis campos dos três idiomas antes de trocar uma foto — e um formulário
  // salvo pela metade apagaria o topo da loja.
  const { rows } = await bd.pool.query(`
    SELECT c.table_name AS tabela, c.column_name AS coluna
    FROM information_schema.columns c
    WHERE c.table_schema = 'canastra'
      AND c.table_name IN ('vitrine_heroi', 'vitrine_texto')
      AND c.is_nullable = 'NO'
    ORDER BY c.table_name, c.column_name
  `);

  // Só o que é CHAVE ou carimbo de tempo pode ser NOT NULL. Nada de conteúdo.
  assert.deepEqual(rows, [
    { tabela: "vitrine_heroi", coluna: "atualizado_em" },
    { tabela: "vitrine_heroi", coluna: "id" },
    { tabela: "vitrine_texto", coluna: "atualizado_em" },
    { tabela: "vitrine_texto", coluna: "chave" },
    { tabela: "vitrine_texto", coluna: "locale" },
  ]);

  // E uma linha só com a chave entra: é o formulário salvo pela metade.
  const vazia = await comoPapel(bd.pool, SESSAO_DORA, async (cliente) => {
    const { rows: r } = await cliente.query(
      `INSERT INTO canastra.vitrine_texto (chave, locale) VALUES ('heroi','es')
       RETURNING kicker, titulo, texto, rotulo_botao, destino, imagem_alt`,
    );
    return r[0];
  });
  assert.deepEqual(vazia, {
    kicker: null,
    titulo: null,
    texto: null,
    rotulo_botao: null,
    destino: null,
    imagem_alt: null,
  });
});

/* --------------------------------------------------------------------------
 * Privilégio e política, as duas camadas que se somam
 * -------------------------------------------------------------------------- */

test("os GRANTs são o que 0006 mandou: anon só lê, authenticated pode escrever e a política decide", async () => {
  // GRANT decide TABELA, política decide LINHA — as duas somam e nenhuma
  // substitui a outra. Este teste afirma a camada de baixo, que os testes de
  // comportamento acima não distinguem: um `anon` com INSERT concedido por
  // engano continuaria barrado pela política HOJE, e passaria a escrever no dia
  // em que alguém acrescentasse uma política de escrita larga demais.
  const { rows } = await bd.pool.query(`
    SELECT
      t.tabela,
      p.papel,
      has_table_privilege(p.papel, 'canastra.' || t.tabela, 'SELECT') AS le,
      has_table_privilege(p.papel, 'canastra.' || t.tabela, 'INSERT') AS insere,
      has_any_column_privilege(p.papel, 'canastra.' || t.tabela, 'UPDATE') AS altera,
      has_table_privilege(p.papel, 'canastra.' || t.tabela, 'DELETE') AS apaga
    FROM (VALUES ('vitrine_heroi'), ('vitrine_texto')) AS t(tabela)
    CROSS JOIN (VALUES ('anon'), ('authenticated')) AS p(papel)
    ORDER BY t.tabela, p.papel
  `);

  assert.deepEqual(rows, [
    { tabela: "vitrine_heroi", papel: "anon", le: true, insere: false, altera: false, apaga: false },
    { tabela: "vitrine_heroi", papel: "authenticated", le: true, insere: true, altera: true, apaga: true },
    { tabela: "vitrine_texto", papel: "anon", le: true, insere: false, altera: false, apaga: false },
    { tabela: "vitrine_texto", papel: "authenticated", le: true, insere: true, altera: true, apaga: true },
  ]);
});

test("as duas tabelas saem da migração com a RLS ligada e as políticas certas", async () => {
  // A invariante geral vive em schema.test.js e em rls.test.js; esta asserção é
  // local e nomeada, porque o modo de falha é mudo: política sem RLS ligada não
  // filtra nada e não avisa, e o sintoma seria a loja inteira editável por
  // qualquer token da instância compartilhada.
  const { rows } = await bd.pool.query(`
    SELECT c.relname AS tabela, c.relrowsecurity AS rls
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'canastra' AND c.relname = ANY($1)
    ORDER BY c.relname
  `, [TABELAS]);
  assert.deepEqual(rows, [
    { tabela: "vitrine_heroi", rls: true },
    { tabela: "vitrine_texto", rls: true },
  ]);

  const politicas = await bd.pool.query(`
    SELECT tablename AS tabela, policyname AS politica, cmd AS comando,
           roles::text AS papeis,
           coalesce(qual, '') AS usando,
           coalesce(with_check, '') AS conferindo
    FROM pg_policies
    WHERE schemaname = 'canastra' AND tablename = ANY($1)
    ORDER BY tablename, policyname
  `, [TABELAS]);

  // `true` SÓ em leitura, e escrita SEMPRE por `eh_admin()`. É a invariante que
  // rls.test.js afirma sobre `pg_policies` inteiro; repetida aqui de perto para
  // que a falha aponte para esta migração e não para "alguma política do
  // schema".
  for (const p of politicas.rows) {
    const predicado = `${p.usando} ${p.conferindo}`;
    if (p.comando === "SELECT") {
      assert.match(p.usando, /^true$/, `${p.politica} deveria ler tudo`);
    } else {
      assert.match(
        predicado,
        /eh_admin\(\)/,
        `${p.politica} escreve sem passar por canastra.eh_admin()`,
      );
    }
    // `TO public` alcançaria também o DONO das tabelas, que é quem
    // `eh_admin()` usa para ler por baixo da RLS. Manter as políticas presas a
    // `anon`/`authenticated` é o que mantém aquele caminho livre — e é
    // exatamente o que a rede `semPapel` de rls.test.js reprova.
    assert.notEqual(p.papeis, "{public}", `${p.politica} sem cláusula TO`);
  }

  assert.deepEqual(
    politicas.rows.map((p) => `${p.tabela}.${p.politica} (${p.comando})`),
    [
      "vitrine_heroi.vitrine_heroi_admin_escreve (ALL)",
      "vitrine_heroi.vitrine_heroi_publico_le (SELECT)",
      "vitrine_texto.vitrine_texto_admin_escreve (ALL)",
      "vitrine_texto.vitrine_texto_publico_le (SELECT)",
    ],
  );
});

test("a migração é idempotente sob o runner", async () => {
  // O runner grava o NOME COMPLETO do arquivo em `canastra.migracoes` e pula o
  // que já rodou. Rodar duas vezes tem de ser um no-op — e não um `CREATE
  // TABLE` estourando no meio do deploy seguinte.
  const aplicadas = await aplicarMigracoes(bd.pool);
  assert.deepEqual(aplicadas, [], "nada deveria ter sobrado para aplicar");

  const { rows } = await bd.pool.query(
    "SELECT count(*)::int AS n FROM canastra.migracoes WHERE versao = '0030_vitrine'",
  );
  assert.equal(rows[0].n, 1, "a migração precisa estar registrada uma única vez");
});
