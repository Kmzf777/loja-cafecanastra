"use strict";

/**
 * F7 — avaliações (migração 0014): quem RECEBEU o café avalia, o resto não.
 *
 * O banco é REAL (harness de test/ajuda/postgres.js) porque o que está sob
 * teste é RLS + privilégio de coluna + trigger — nada disso existe num mock.
 *
 * O QUE ESTE ARQUIVO FIXA, na ordem em que dói:
 *   1. `pode_avaliar(sku)` lê o formato REAL de `pedidos.itens` — o
 *      `validatedItems` do PaymentController, que tem `product_id` e NÃO tem
 *      `sku`. A função resolve o SKU pelo join com `canastra.produtos`.
 *   2. INSERT só com pedido `entregue` contendo o SKU; a linha nasce
 *      `pendente` e com `nome_exibicao` congelado pela trigger (o navegador
 *      não escolhe o nome nem o status — 42501 nas duas colunas).
 *   3. Leitura pública é SÓ de `status = 'aprovada'`, e sem `user_id`.
 *   4. Moderação é GRANT de coluna (status, moderado_em) + política de admin.
 *   5. A avaliação sobrevive à exclusão da conta (SET NULL) com o nome.
 */

const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");

const { subirPostgres } = require("./ajuda/postgres.js");
const { aplicarMigracoes } = require("../db/migrar.js");
const { comoPapel, PERMISSAO_NEGADA } = require("./ajuda/sessao.js");

let bd;

const ANA = "aaaaaaaa-0000-0000-0000-0000000000a1"; // cliente com pedido entregue (P1 e P2)
const BRUNO = "bbbbbbbb-0000-0000-0000-0000000000b1"; // cliente com pedido só 'enviado'
const CAROL = "cccccccc-0000-0000-0000-0000000000c1"; // cliente com avaliação APROVADA semeada
const DAVI = "dddddddd-0000-0000-0000-0000000000d1"; // cliente que apaga a conta no fim
const ALICE = "eeeeeeee-0000-0000-0000-0000000000e1"; // administradora
const INTRUSO = "ffffffff-0000-0000-0000-0000000000f1"; // token válido de OUTRO projeto: sem linha em clientes

const P1 = "11111111-0000-0000-0000-0000000000a1";
const P2 = "11111111-0000-0000-0000-0000000000a2";
const P3 = "11111111-0000-0000-0000-0000000000a3"; // nunca vendido a ninguém

const SKU1 = "F7-CLASSICO-250";
const SKU2 = "F7-SUAVE-500";
const SKU3 = "F7-SEM-PEDIDO";

/** Item no formato EXATO que o PaymentController grava (validatedItems). */
function itemDePedido(produtoId, nome) {
  return {
    product_id: produtoId,
    name: nome,
    image: null,
    price: 42,
    quantity: 1,
    size: "250g",
    weight: 0.3,
    width: 12,
    height: 18,
    length: 6,
  };
}

async function inserirPedido({ userId, status, itens }) {
  await bd.pool.query(
    `INSERT INTO canastra.pedidos (user_id, total, status, itens)
     VALUES ($1, 42, $2, $3::jsonb)`,
    [userId, status, itens === null ? null : JSON.stringify(itens)],
  );
}

before(async () => {
  bd = await subirPostgres();
  await aplicarMigracoes(bd.pool);

  for (const [uid, email, nome] of [
    [ANA, "ana@f7.teste", "Ana"],
    [BRUNO, "bruno@f7.teste", "Bruno"],
    [CAROL, "carol@f7.teste", "Carol"],
    [DAVI, "davi@f7.teste", "Davi"],
    [ALICE, "alice@f7.teste", "Alice Admin"],
  ]) {
    await bd.pool.query("INSERT INTO auth.users (id, email) VALUES ($1, $2)", [
      uid,
      email,
    ]);
    await bd.pool.query(
      "INSERT INTO canastra.clientes (user_id, nome) VALUES ($1, $2)",
      [uid, nome],
    );
  }
  // O INTRUSO tem conta na instância compartilhada, mas NUNCA passou pelo
  // cadastro desta loja — é o caso que a Regra 2 de 0006 existe para barrar.
  await bd.pool.query(
    "INSERT INTO auth.users (id, email) VALUES ($1, 'intruso@outro.projeto')",
    [INTRUSO],
  );
  await bd.pool.query("INSERT INTO canastra.admins (user_id) VALUES ($1)", [
    ALICE,
  ]);

  await bd.pool.query(
    `INSERT INTO canastra.produtos (produto_id, nome, preco, quantidade, sku) VALUES
       ($1, 'Café Clássico 250g', 42.00, 10, $4),
       ($2, 'Café Suave 500g',    68.00, 10, $5),
       ($3, 'Café Sem Pedido',    42.00, 10, $6)`,
    [P1, P2, P3, SKU1, SKU2, SKU3],
  );

  // Ana RECEBEU um pedido com os dois cafés.
  await inserirPedido({
    userId: ANA,
    status: "entregue",
    itens: [itemDePedido(P1, "Café Clássico 250g"), itemDePedido(P2, "Café Suave 500g")],
  });
  // Bruno comprou o mesmo café, mas o pedido ainda está na transportadora.
  await inserirPedido({
    userId: BRUNO,
    status: "enviado",
    itens: [itemDePedido(P1, "Café Clássico 250g")],
  });
  // Pedidos DEFEITUOSOS de Bruno, ambos 'entregue': `pode_avaliar` não pode
  // estourar com `itens` nulo nem com jsonb que não é array.
  await inserirPedido({ userId: BRUNO, status: "entregue", itens: null });
  await bd.pool.query(
    `INSERT INTO canastra.pedidos (user_id, total, status, itens)
     VALUES ($1, 42, 'entregue', '{"formato":"legado"}'::jsonb)`,
    [BRUNO],
  );
  // Carol e Davi também receberam.
  await inserirPedido({
    userId: CAROL,
    status: "entregue",
    itens: [itemDePedido(P2, "Café Suave 500g")],
  });
  await inserirPedido({
    userId: DAVI,
    status: "entregue",
    itens: [itemDePedido(P1, "Café Clássico 250g")],
  });

  // Estado COMMITADO para os testes de leitura (comoPapel sempre dá ROLLBACK):
  // a avaliação aprovada da Carol e a pendente da Ana (sobre o SKU2 — o SKU1
  // fica livre para os testes de INSERT da própria Ana).
  await bd.pool.query(
    `INSERT INTO canastra.avaliacoes (user_id, sku, nota, titulo, texto)
     VALUES ($1, $2, 5, 'Café da casa', 'Doce de rapadura, corpo alto.')`,
    [CAROL, SKU2],
  );
  await bd.pool.query(
    `UPDATE canastra.avaliacoes SET status = 'aprovada', moderado_em = now()
      WHERE user_id = $1`,
    [CAROL],
  );
  await bd.pool.query(
    `INSERT INTO canastra.avaliacoes (user_id, sku, nota, texto)
     VALUES ($1, $2, 4, 'Ainda aguardando moderação.')`,
    [ANA, SKU2],
  );
}, { timeout: 240_000 });

after(async () => {
  await bd?.derrubar();
});

/* ------------------------------------------------------------------ *
 * pode_avaliar — com o formato real de `itens`
 * ------------------------------------------------------------------ */

async function podeAvaliar(sessao, sku) {
  return comoPapel(bd.pool, sessao, async (c) => {
    const { rows } = await c.query("SELECT canastra.pode_avaliar($1) AS pode", [
      sku,
    ]);
    return rows[0].pode;
  });
}

test("pode_avaliar: TRUE para quem tem pedido entregue com o SKU", async () => {
  assert.equal(await podeAvaliar({ papel: "authenticated", sub: ANA }, SKU1), true);
  assert.equal(await podeAvaliar({ papel: "authenticated", sub: ANA }, SKU2), true);
});

test("pode_avaliar: FALSE enquanto o pedido não é 'entregue'", async () => {
  assert.equal(
    await podeAvaliar({ papel: "authenticated", sub: BRUNO }, SKU1),
    false,
  );
});

test("pode_avaliar: FALSE para SKU que a pessoa nunca recebeu", async () => {
  assert.equal(await podeAvaliar({ papel: "authenticated", sub: ANA }, SKU3), false);
});

test("pode_avaliar: itens nulo ou não-array não estoura — responde FALSE", async () => {
  // Os dois pedidos defeituosos de Bruno estão 'entregue'; se a função
  // tentasse jsonb_array_elements neles, seria 22023 aqui.
  assert.equal(
    await podeAvaliar({ papel: "authenticated", sub: BRUNO }, SKU3),
    false,
  );
});

test("pode_avaliar: anônimo (sem auth.uid) responde FALSE, não erro", async () => {
  assert.equal(await podeAvaliar({ papel: "anon" }, SKU1), false);
});

/* ------------------------------------------------------------------ *
 * INSERT — quem recebeu avalia; a linha nasce pendente e com nome congelado
 * ------------------------------------------------------------------ */

test("cliente com pedido entregue insere; nasce 'pendente' com nome congelado", async () => {
  await comoPapel(bd.pool, { papel: "authenticated", sub: ANA }, async (c) => {
    const { rows } = await c.query(
      `INSERT INTO canastra.avaliacoes (user_id, sku, nota, titulo, texto)
       VALUES ($1, $2, 5, 'Melhor da casa', 'Chegou dois dias após a torra.')
       RETURNING status, nome_exibicao, moderado_em`,
      [ANA, SKU1],
    );
    assert.equal(rows[0].status, "pendente");
    assert.equal(rows[0].nome_exibicao, "Ana");
    assert.equal(rows[0].moderado_em, null);
  });
});

test("sem pedido entregue com o SKU, o INSERT recusa com 42501", async () => {
  await assert.rejects(
    comoPapel(bd.pool, { papel: "authenticated", sub: BRUNO }, (c) =>
      c.query(
        `INSERT INTO canastra.avaliacoes (user_id, sku, nota) VALUES ($1, $2, 5)`,
        [BRUNO, SKU1],
      ),
    ),
    (erro) => erro.code === PERMISSAO_NEGADA,
  );
});

test("token de outro projeto (sem linha em clientes) recusa com 42501", async () => {
  await assert.rejects(
    comoPapel(bd.pool, { papel: "authenticated", sub: INTRUSO }, (c) =>
      c.query(
        `INSERT INTO canastra.avaliacoes (user_id, sku, nota) VALUES ($1, $2, 5)`,
        [INTRUSO, SKU1],
      ),
    ),
    (erro) => erro.code === PERMISSAO_NEGADA,
  );
});

test("assinar pelo uid ALHEIO recusa com 42501", async () => {
  await assert.rejects(
    comoPapel(bd.pool, { papel: "authenticated", sub: BRUNO }, (c) =>
      c.query(
        `INSERT INTO canastra.avaliacoes (user_id, sku, nota) VALUES ($1, $2, 5)`,
        [ANA, SKU1],
      ),
    ),
    (erro) => erro.code === PERMISSAO_NEGADA,
  );
});

test("o navegador não escolhe o status: coluna fora do GRANT de INSERT (42501)", async () => {
  await assert.rejects(
    comoPapel(bd.pool, { papel: "authenticated", sub: ANA }, (c) =>
      c.query(
        `INSERT INTO canastra.avaliacoes (user_id, sku, nota, status)
         VALUES ($1, $2, 5, 'aprovada')`,
        [ANA, SKU1],
      ),
    ),
    (erro) => erro.code === PERMISSAO_NEGADA,
  );
});

test("o navegador não assina com outro nome: nome_exibicao fora do GRANT (42501)", async () => {
  await assert.rejects(
    comoPapel(bd.pool, { papel: "authenticated", sub: ANA }, (c) =>
      c.query(
        `INSERT INTO canastra.avaliacoes (user_id, sku, nota, nome_exibicao)
         VALUES ($1, $2, 5, 'Equipe Canastra')`,
        [ANA, SKU1],
      ),
    ),
    (erro) => erro.code === PERMISSAO_NEGADA,
  );
});

test("uma avaliação por cliente por café: UNIQUE (user_id, sku) → 23505", async () => {
  await assert.rejects(
    comoPapel(bd.pool, { papel: "authenticated", sub: ANA }, async (c) => {
      await c.query(
        `INSERT INTO canastra.avaliacoes (user_id, sku, nota) VALUES ($1, $2, 5)`,
        [ANA, SKU1],
      );
      await c.query(
        `INSERT INTO canastra.avaliacoes (user_id, sku, nota) VALUES ($1, $2, 3)`,
        [ANA, SKU1],
      );
    }),
    (erro) => erro.code === "23505",
  );
});

test("nota fora de 1..5 e título acima de 80 recusam com 23514", async () => {
  for (const [colunas, valores] of [
    ["nota", "($1, $2, 6)"],
    ["nota", "($1, $2, 0)"],
  ]) {
    await assert.rejects(
      comoPapel(bd.pool, { papel: "authenticated", sub: ANA }, (c) =>
        c.query(
          `INSERT INTO canastra.avaliacoes (user_id, sku, ${colunas}) VALUES ${valores}`,
          [ANA, SKU1],
        ),
      ),
      (erro) => erro.code === "23514",
    );
  }
  await assert.rejects(
    comoPapel(bd.pool, { papel: "authenticated", sub: ANA }, (c) =>
      c.query(
        `INSERT INTO canastra.avaliacoes (user_id, sku, nota, titulo)
         VALUES ($1, $2, 5, repeat('a', 81))`,
        [ANA, SKU1],
      ),
    ),
    (erro) => erro.code === "23514",
  );
});

test("titulo/texto so de espacos recusam com 23514 — 'nao informado' e NULL", async () => {
  // A PDP decide renderizar por veracidade (`avaliacao.texto ?`): uma string
  // de espacos e truthy e vira paragrafo vazio na pagina do cafe. O formulario
  // ja normaliza para NULL, mas o INSERT direto no PostgREST nao passa por ele.
  for (const [coluna, valor] of [
    ["titulo", "   "],
    ["texto", " \n\t "],
    ["titulo", ""],
    ["texto", ""],
  ]) {
    await assert.rejects(
      comoPapel(bd.pool, { papel: "authenticated", sub: ANA }, (c) =>
        c.query(
          `INSERT INTO canastra.avaliacoes (user_id, sku, nota, ${coluna})
           VALUES ($1, $2, 5, $3)`,
          [ANA, SKU1, valor],
        ),
      ),
      (erro) => erro.code === "23514",
      `${coluna} = ${JSON.stringify(valor)} deveria ser recusado`,
    );
  }

  // E o NULL continua passando: "sem titulo" e um desfecho legitimo.
  await comoPapel(bd.pool, { papel: "authenticated", sub: ANA }, async (c) => {
    const { rows } = await c.query(
      `INSERT INTO canastra.avaliacoes (user_id, sku, nota, titulo, texto)
       VALUES ($1, $2, 5, NULL, NULL) RETURNING titulo, texto`,
      [ANA, SKU1],
    );
    assert.equal(rows[0].titulo, null);
    assert.equal(rows[0].texto, null);
  });
});

/* ------------------------------------------------------------------ *
 * SELECT — público vê só aprovada (e sem user_id); dono vê as suas
 * ------------------------------------------------------------------ */

const COLUNAS_PUBLICAS =
  "id, sku, nota, titulo, texto, nome_exibicao, status, criado_em";

test("anon lê SÓ as aprovadas", async () => {
  const linhas = await comoPapel(bd.pool, { papel: "anon" }, async (c) => {
    const { rows } = await c.query(
      `SELECT ${COLUNAS_PUBLICAS} FROM canastra.avaliacoes ORDER BY criado_em`,
    );
    return rows;
  });
  assert.equal(linhas.length, 1);
  assert.equal(linhas[0].status, "aprovada");
  assert.equal(linhas[0].nome_exibicao, "Carol");
  assert.equal(linhas[0].sku, SKU2);
});

test("anon não alcança user_id nem moderado_em: 42501, nunca dado", async () => {
  for (const coluna of ["user_id", "moderado_em"]) {
    await assert.rejects(
      comoPapel(bd.pool, { papel: "anon" }, (c) =>
        c.query(`SELECT ${coluna} FROM canastra.avaliacoes`),
      ),
      (erro) => erro.code === PERMISSAO_NEGADA,
    );
  }
});

test("dono lê a própria avaliação pendente; o vizinho não a vê", async () => {
  const daAna = await comoPapel(
    bd.pool,
    { papel: "authenticated", sub: ANA },
    async (c) => {
      const { rows } = await c.query(
        `SELECT sku, status FROM canastra.avaliacoes WHERE user_id = $1`,
        [ANA],
      );
      return rows;
    },
  );
  assert.equal(daAna.length, 1);
  assert.equal(daAna[0].status, "pendente");

  const doBruno = await comoPapel(
    bd.pool,
    { papel: "authenticated", sub: BRUNO },
    async (c) => {
      const { rows } = await c.query(
        `SELECT status FROM canastra.avaliacoes`,
      );
      return rows;
    },
  );
  // Bruno enxerga apenas o que é público — a pendente da Ana não aparece.
  assert.deepEqual(
    doBruno.map((l) => l.status),
    ["aprovada"],
  );
});

test("admin lê tudo, inclusive as pendentes", async () => {
  const linhas = await comoPapel(
    bd.pool,
    { papel: "authenticated", sub: ALICE },
    async (c) => {
      const { rows } = await c.query(
        "SELECT status FROM canastra.avaliacoes ORDER BY status",
      );
      return rows;
    },
  );
  assert.deepEqual(
    linhas.map((l) => l.status),
    ["aprovada", "pendente"],
  );
});

/* ------------------------------------------------------------------ *
 * Moderação — GRANT de coluna + política de admin
 * ------------------------------------------------------------------ */

test("admin aprova: UPDATE de status + moderado_em passa", async () => {
  await comoPapel(bd.pool, { papel: "authenticated", sub: ALICE }, async (c) => {
    const { rowCount } = await c.query(
      `UPDATE canastra.avaliacoes
          SET status = 'aprovada', moderado_em = now()
        WHERE user_id = $1 AND sku = $2`,
      [ANA, SKU2],
    );
    assert.equal(rowCount, 1);
  });
});

test("nem o admin reescreve a nota: coluna fora do GRANT de UPDATE (42501)", async () => {
  await assert.rejects(
    comoPapel(bd.pool, { papel: "authenticated", sub: ALICE }, (c) =>
      c.query("UPDATE canastra.avaliacoes SET nota = 1 WHERE sku = $1", [SKU2]),
    ),
    (erro) => erro.code === PERMISSAO_NEGADA,
  );
});

test("não-admin moderando: 0 linhas afetadas, sem erro (semântica do USING)", async () => {
  await comoPapel(bd.pool, { papel: "authenticated", sub: BRUNO }, async (c) => {
    const { rowCount } = await c.query(
      `UPDATE canastra.avaliacoes SET status = 'oculta', moderado_em = now()`,
    );
    assert.equal(rowCount, 0);
  });
});

test("DELETE não é do navegador: authenticated recusa 42501, service_role passa", async () => {
  await assert.rejects(
    comoPapel(bd.pool, { papel: "authenticated", sub: ANA }, (c) =>
      c.query("DELETE FROM canastra.avaliacoes WHERE user_id = $1", [ANA]),
    ),
    (erro) => erro.code === PERMISSAO_NEGADA,
  );

  await comoPapel(bd.pool, { papel: "service_role" }, async (c) => {
    const { rowCount } = await c.query(
      "DELETE FROM canastra.avaliacoes WHERE user_id = $1",
      [ANA],
    );
    assert.equal(rowCount, 1); // ROLLBACK do harness devolve a linha.
  });
});

/* ------------------------------------------------------------------ *
 * A avaliação sobrevive à conta
 * ------------------------------------------------------------------ */

test("conta apagada: user_id vira NULL, o nome congelado fica e a vitrine segue lendo", async () => {
  // Davi avalia e a avaliação é aprovada (committado, via pool).
  await bd.pool.query(
    `INSERT INTO canastra.avaliacoes (user_id, sku, nota, texto)
     VALUES ($1, $2, 5, 'Comprarei de novo.')`,
    [DAVI, SKU1],
  );
  await bd.pool.query(
    `UPDATE canastra.avaliacoes SET status = 'aprovada', moderado_em = now()
      WHERE user_id = $1`,
    [DAVI],
  );

  // A conta sai da loja (o caminho real passa pelo GoTrue; aqui interessa o
  // efeito na FK: ON DELETE SET NULL).
  await bd.pool.query("DELETE FROM canastra.clientes WHERE user_id = $1", [
    DAVI,
  ]);

  const { rows } = await bd.pool.query(
    "SELECT user_id, nome_exibicao, status FROM canastra.avaliacoes WHERE sku = $1",
    [SKU1],
  );
  assert.equal(rows.length, 1);
  assert.equal(rows[0].user_id, null);
  assert.equal(rows[0].nome_exibicao, "Davi");
  assert.equal(rows[0].status, "aprovada");

  // E o público continua vendo, com nome — a prova de que congelar no INSERT
  // era necessário: um join com `clientes` aqui voltaria vazio.
  const publicas = await comoPapel(bd.pool, { papel: "anon" }, async (c) => {
    const { rows: r } = await c.query(
      `SELECT nome_exibicao FROM canastra.avaliacoes WHERE sku = $1`,
      [SKU1],
    );
    return r;
  });
  assert.equal(publicas[0].nome_exibicao, "Davi");
});
