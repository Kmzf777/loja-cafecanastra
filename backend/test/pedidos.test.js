"use strict";

const { test, before, after, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const { subirPostgres } = require("./ajuda/postgres.js");
const { aplicarMigracoes } = require("../db/migrar.js");

let bd;
const ANA = "aaaaaaaa-0000-0000-0000-000000000001";

before(async () => {
  bd = await subirPostgres();
  await aplicarMigracoes(bd.pool);
  await bd.pool.query("INSERT INTO auth.users (id, email) VALUES ($1, 'ana@ex.com')", [ANA]);
  await bd.pool.query("INSERT INTO canastra.clientes (user_id, nome) VALUES ($1, 'Ana')", [ANA]);
}, { timeout: 120_000 });

after(async () => {
  await bd?.derrubar();
});

beforeEach(() => {
  // Sem esta guarda, um before() que falha faz CADA teste morrer num
  // "Cannot read properties of undefined (reading 'pool')", e o erro de boot —
  // que e a informacao util — some sob oito erros derivados.
  if (!bd) {
    throw new Error(
      "O Postgres nao subiu no before(); a causa real esta no erro daquele hook.",
    );
  }
});

test("o mesmo pagamento do MP nao pode gerar dois pedidos", async () => {
  // O Mercado Pago reenvia webhook por desenho. A auditoria registrou que
  // reentrega repetida podia inflar o estoque. O indice unico e a defesa: ela
  // vale mesmo se o codigo do webhook esquecer de checar.
  await bd.pool.query(
    `INSERT INTO canastra.pedidos (pedido_id, user_id, total, pagamento_id_mp)
     VALUES (gen_random_uuid(), $1, 54.90, 'MP-123')`,
    [ANA],
  );

  await assert.rejects(
    () =>
      bd.pool.query(
        `INSERT INTO canastra.pedidos (pedido_id, user_id, total, pagamento_id_mp)
         VALUES (gen_random_uuid(), $1, 54.90, 'MP-123')`,
        [ANA],
      ),
    /pedidos_pagamento_mp_idx|duplicate key/i,
  );
});

test("varios pedidos podem estar sem pagamento_id_mp", async () => {
  // Pedido criado ANTES de cobrar (correcao da auditoria): nesse instante ainda
  // nao ha id do MP. Se o indice unico nao fosse parcial, o segundo pedido
  // pendente da loja inteira falharia.
  //
  // As duas linhas sao MARCADAS e a contagem filtra pela marca. Contar todos os
  // `pagamento_id_mp IS NULL` da tabela parecia mais simples e era uma armadilha:
  // o numero so fechava porque os testes anteriores deste arquivo tinham inserido
  // exatamente o que tinham inserido. Reordenar, renomear ou acrescentar um teste
  // acima quebraria este aqui, e a mensagem de falha apontaria para o lugar
  // errado.
  await bd.pool.query(
    `INSERT INTO canastra.pedidos (pedido_id, user_id, total, chave_idempotencia) VALUES
       (gen_random_uuid(), $1, 10, 'sem-mp-a'), (gen_random_uuid(), $1, 20, 'sem-mp-b')`,
    [ANA],
  );

  const { rows } = await bd.pool.query(
    `SELECT count(*)::int AS n FROM canastra.pedidos
     WHERE pagamento_id_mp IS NULL AND chave_idempotencia IN ('sem-mp-a', 'sem-mp-b')`,
  );
  assert.equal(rows[0].n, 2);
});

test("a chave de idempotencia do checkout e unica", async () => {
  await bd.pool.query(
    `INSERT INTO canastra.pedidos (pedido_id, user_id, total, chave_idempotencia)
     VALUES (gen_random_uuid(), $1, 10, 'req-abc')`,
    [ANA],
  );

  await assert.rejects(
    () =>
      bd.pool.query(
        `INSERT INTO canastra.pedidos (pedido_id, user_id, total, chave_idempotencia)
         VALUES (gen_random_uuid(), $1, 10, 'req-abc')`,
        [ANA],
      ),
    /pedidos_idempotencia_idx|duplicate key/i,
  );
});

test("apagar o cliente preserva o pedido, orfao", async () => {
  // A UNICA chave estrangeira para `clientes` que NAO e CASCADE, e de proposito:
  // apagar um cliente (pedido de exclusao de dados, engano do operador) nao pode
  // apagar a venda do historico da loja — o faturamento e a contabilidade
  // dependem dela. Por isso `user_id` e NULAVEL aqui e NOT NULL em `enderecos`:
  // ON DELETE SET NULL numa coluna NOT NULL nao e configuracao valida, o DELETE
  // estouraria com 23502 e a exclusao do cliente ficaria impossivel.
  //
  // O troco, e a nota que a migracao de politicas precisa ler: com `user_id`
  // NULL, uma politica de dono do tipo `USING (user_id = auth.uid())` avalia NULL,
  // que nao e TRUE — o pedido orfao fica invisivel para TODO cliente, inclusive
  // pelo PostgREST. Isso e o desfecho certo (ninguem herda a compra de outro),
  // mas significa que o painel do admin nao pode depender daquela mesma politica
  // para listar o historico.
  const ORFAO = "ffffffff-0000-0000-0000-000000000009";
  await bd.pool.query("INSERT INTO auth.users (id, email) VALUES ($1, 'orfao@ex.com')", [
    ORFAO,
  ]);
  await bd.pool.query("INSERT INTO canastra.clientes (user_id, nome) VALUES ($1, 'Orfao')", [
    ORFAO,
  ]);
  const { rows: criado } = await bd.pool.query(
    `INSERT INTO canastra.pedidos (user_id, total, endereco_json)
     VALUES ($1, 99.90, $2::jsonb) RETURNING pedido_id`,
    [
      ORFAO,
      JSON.stringify({ nome: "Ana Silva", cpf: "12345678901", rua: "R. X 99" }),
    ],
  );

  await bd.pool.query("DELETE FROM canastra.clientes WHERE user_id = $1", [ORFAO]);

  const { rows } = await bd.pool.query(
    "SELECT user_id, total, endereco_json FROM canastra.pedidos WHERE pedido_id = $1",
    [criado[0].pedido_id],
  );
  assert.equal(rows[0].user_id, null);
  assert.equal(rows[0].total, "99.90");

  // E A PARTE DESCONFORTAVEL, afirmada aqui para nao virar so uma frase de
  // comentario: apagar o cliente NAO apaga os dados pessoais da pessoa. Nome, CPF
  // e endereco continuam em `endereco_json` (e o que foi comprado, em `itens`),
  // porque o SET NULL preserva a VENDA inteira, nao so o valor dela.
  //
  // Ou seja, atender a um pedido de exclusao pela LGPD exige um passo A MAIS que
  // este schema ainda nao tem: redigir esses dois campos preservando o que a
  // obrigacao fiscal manda guardar. Este teste existe para que a lacuna fique
  // MEDIDA, e nao lembrada; quando a tarefa da redacao chegar, e ele que muda —
  // de proposito, para que a mudanca seja consciente.
  assert.deepEqual(rows[0].endereco_json, {
    nome: "Ana Silva",
    cpf: "12345678901",
    rua: "R. X 99",
  });
});

test("config_loja aceita no maximo uma linha", async () => {
  await bd.pool.query("INSERT INTO canastra.config_loja (id) VALUES (1)");
  await assert.rejects(
    () => bd.pool.query("INSERT INTO canastra.config_loja (id) VALUES (2)"),
    /config_loja_linha_unica|violates check/i,
  );
});

test("a segunda linha de config_loja sem id explicito esbarra na CHAVE, nao no CHECK", async () => {
  // Os dois guardas cobrem portas diferentes e o teste acima so exercita um. O
  // caminho REAL do painel e `INSERT ... DEFAULT VALUES` (ou sem citar `id`), que
  // pega o DEFAULT 1, passa pelo CHECK e bate na chave primaria com 23505. Quem
  // for tratar o erro no painel precisa esperar OS DOIS SQLSTATEs — 23505 aqui e
  // 23514 no insert com id explicito —, e nao so o do teste anterior.
  await assert.rejects(
    () => bd.pool.query("INSERT INTO canastra.config_loja DEFAULT VALUES"),
    (erro) => {
      assert.equal(erro.code, "23505");
      assert.match(erro.message, /config_loja_pkey/);
      return true;
    },
  );
});

test("o que 0005 abre para anon: promocoes e config, nunca pedidos", async () => {
  // Regra 1 de 0001: nada nasce legivel por `anon`. A vitrine precisa do banner e
  // da barra de aviso (`config_loja`) e das promocoes ativas, entao essas duas
  // levam GRANT explicito. `pedidos` guarda endereco e itens comprados de cada
  // cliente e fica fora — se um dia aparecer aqui, e este teste que grita.
  const { rows } = await bd.pool.query(`
    SELECT
      t.tabela,
      has_table_privilege('anon', 'canastra.' || t.tabela, 'SELECT') AS anon_le,
      has_table_privilege('anon', 'canastra.' || t.tabela, 'UPDATE') AS anon_escreve
    FROM (VALUES ('pedidos'), ('promocoes'), ('config_loja')) AS t(tabela)
    ORDER BY t.tabela
  `);

  assert.deepEqual(rows, [
    { tabela: "config_loja", anon_le: true, anon_escreve: false },
    { tabela: "pedidos", anon_le: false, anon_escreve: false },
    { tabela: "promocoes", anon_le: true, anon_escreve: false },
  ]);
});

test("authenticated nao escreve em promocoes nem na config da loja", async () => {
  // A guarda de catalogo dos REVOKEs de 0005, gemea da de 0003 e pelo mesmo
  // motivo: o `arwd` que 0001 concede por padrao esta inerte apenas enquanto a
  // RLS nao tiver politica, e a primeira politica ampla demais o acorda. O dano
  // aqui seria o banner e a barra de aviso da loja reescritos, ou promocao
  // inventada, por um token de outro projeto da instancia compartilhada.
  //
  // `pedidos` NAO entra nesta lista de proposito: ali o cliente logado escreve de
  // verdade (fecha o proprio pedido), e o recorte e trabalho da politica de RLS,
  // que sabe distinguir a linha do dono da linha do vizinho. Privilegio de tabela
  // nao sabe.
  const { rows } = await bd.pool.query(`
    SELECT
      t.tabela,
      has_table_privilege('authenticated', 'canastra.' || t.tabela, 'INSERT') AS insere,
      has_table_privilege('authenticated', 'canastra.' || t.tabela, 'UPDATE') AS altera,
      has_table_privilege('authenticated', 'canastra.' || t.tabela, 'DELETE') AS apaga,
      has_table_privilege('authenticated', 'canastra.' || t.tabela, 'SELECT') AS le
    FROM (VALUES ('promocoes'), ('config_loja')) AS t(tabela)
    ORDER BY t.tabela
  `);

  assert.deepEqual(rows, [
    { tabela: "config_loja", insere: false, altera: false, apaga: false, le: true },
    { tabela: "promocoes", insere: false, altera: false, apaga: false, le: true },
  ]);
});
