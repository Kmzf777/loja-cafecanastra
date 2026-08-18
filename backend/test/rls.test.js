"use strict";

/**
 * As politicas de RLS de 0006, vistas de fora.
 *
 * O CASO QUE IMPORTA MAIS E O NEGATIVO, e ele tem nome: ESTRANHA. Ela existe em
 * `auth.users` e NAO existe em `canastra.clientes` — e o usuario de OUTRO
 * projeto da instancia Supabase compartilhada, com token de assinatura valida e
 * `auth.uid()` preenchido chegando no PostgREST desta loja. Toda politica deste
 * schema existe para que ela nao enxergue nem escreva nada, e metade dos testes
 * deste arquivo e sobre ela.
 *
 * TODA ASERCAO DE RECUSA E EM `err.code === PERMISSAO_NEGADA`, nunca em texto de
 * mensagem: /permission denied/i casa igualmente com "permission denied for
 * schema canastra", que seria um GRANT faltando numa migracao — bug OPOSTO ao
 * que estes testes querem provar, e que passaria verde.
 *
 * O QUE A RLS FAZ QUANDO RECUSA, e vale saber antes de ler as asercoes abaixo:
 * ela nem sempre erra. INSERT sem politica de WITH CHECK que case levanta 42501;
 * UPDATE e DELETE sem politica de USING que case simplesmente NAO ENCONTRAM
 * LINHA e devolvem zero afetadas, sem erro nenhum. Os dois desfechos aparecem
 * aqui de proposito, porque quem depurar isto em producao precisa saber que "0
 * linhas" tambem e uma recusa.
 */

const { test, before, after, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const { subirPostgres } = require("./ajuda/postgres.js");
const { comoPapel, PERMISSAO_NEGADA } = require("./ajuda/sessao.js");
const { aplicarMigracoes } = require("../db/migrar.js");

let bd;

// Clientes da loja: linha em `auth.users` E em `canastra.clientes`.
const ANA = "aaaaaaaa-0000-0000-0000-000000000001";
const BRUNO = "bbbbbbbb-0000-0000-0000-000000000002";
// Cliente E administradora.
const DORA = "dddddddd-0000-0000-0000-000000000004";
// SO em `auth.users`. Usuaria de outro projeto da instancia compartilhada — o
// motivo de este arquivo existir.
const ESTRANHA = "eeeeeeee-0000-0000-0000-000000000005";

const CAFE = "cccccccc-0000-0000-0000-000000000001";
const END_ANA = "a1111111-0000-0000-0000-000000000001";
const END_BRUNO = "b1111111-0000-0000-0000-000000000002";
const CAR_ANA = "a2222222-0000-0000-0000-000000000001";
const CAR_BRUNO = "b2222222-0000-0000-0000-000000000002";
const PED_ANA = "a3333333-0000-0000-0000-000000000001";
const PED_BRUNO = "b3333333-0000-0000-0000-000000000002";
// Pedido de cliente ja apagado: `pedidos.user_id` e ON DELETE SET NULL (0005).
const PED_ORFAO = "03333333-0000-0000-0000-000000000009";

/** As quatro relacoes genuinamente publicas da loja. */
const PUBLICAS = ["config_loja", "produto_opcoes", "produtos", "promocoes"];

const SESSAO_ANA = { papel: "authenticated", sub: ANA };
const SESSAO_BRUNO = { papel: "authenticated", sub: BRUNO };
const SESSAO_DORA = { papel: "authenticated", sub: DORA };
const SESSAO_ESTRANHA = { papel: "authenticated", sub: ESTRANHA };
const SESSAO_ANON = { papel: "anon" };

/**
 * Roda um comando e exige 42501.
 *
 * O retorno do assert.rejects e verificado com um predicado, e nao com regex,
 * pelo motivo do cabecalho. O `contexto` entra na mensagem porque estes testes
 * rodam em laco: sem ele, "expected 42501" nao diz QUAL comando passou.
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

/** Conta linhas visiveis numa tabela, sob a sessao dada. */
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

  // A semeadura roda como dono do banco, que e isento de RLS — de proposito: o
  // que se testa aqui e a LEITURA e a ESCRITA pelos papeis do Supabase, nao a
  // montagem do cenario. O caminho real de semeadura (`service_role`) tem teste
  // proprio mais abaixo.
  await bd.pool.query(
    `INSERT INTO auth.users (id, email) VALUES
       ($1,'ana@ex.com'), ($2,'bruno@ex.com'), ($3,'dora@ex.com'), ($4,'estranha@outroprojeto.com')`,
    [ANA, BRUNO, DORA, ESTRANHA],
  );
  await bd.pool.query(
    `INSERT INTO canastra.clientes (user_id, nome) VALUES
       ($1,'Ana'), ($2,'Bruno'), ($3,'Dora')`,
    [ANA, BRUNO, DORA],
  );
  await bd.pool.query("INSERT INTO canastra.admins (user_id) VALUES ($1)", [DORA]);

  await bd.pool.query(
    `INSERT INTO canastra.produtos
       (produto_id, nome, tamanho, categoria, preco, custo, quantidade, sku)
     VALUES ($1, 'Canastra Classico', '250 g', 'Cafe', 54.90, 22.50, 10, 'CAN-CLA-250')`,
    [CAFE],
  );
  await bd.pool.query(
    "INSERT INTO canastra.produto_opcoes (tipo, valor) VALUES ('tamanho', '250 g')",
  );
  await bd.pool.query("INSERT INTO canastra.promocoes (titulo) VALUES ('Frete gratis')");
  await bd.pool.query(
    "INSERT INTO canastra.config_loja (id, titulo_site) VALUES (1, 'Cafe Canastra')",
  );

  await bd.pool.query(
    `INSERT INTO canastra.enderecos (endereco_id, user_id, rua) VALUES
       ($1, $2, 'Rua da Ana'), ($3, $4, 'Rua do Bruno')`,
    [END_ANA, ANA, END_BRUNO, BRUNO],
  );
  await bd.pool.query(
    `INSERT INTO canastra.carrinhos (carrinho_id, user_id) VALUES ($1,$2), ($3,$4)`,
    [CAR_ANA, ANA, CAR_BRUNO, BRUNO],
  );
  await bd.pool.query(
    `INSERT INTO canastra.carrinho_itens (carrinho_id, produto_id, quantidade, moagem)
     VALUES ($1, $2, 2, 'media'), ($3, $2, 1, 'grossa')`,
    [CAR_ANA, CAFE, CAR_BRUNO],
  );
  await bd.pool.query(
    `INSERT INTO canastra.pedidos (pedido_id, user_id, total, itens) VALUES
       ($1, $2, 99.90, '[]'::jsonb),
       ($3, $4, 54.90, '[]'::jsonb),
       ($5, NULL,  10.00, '[]'::jsonb)`,
    [PED_ANA, ANA, PED_BRUNO, BRUNO, PED_ORFAO],
  );
}, { timeout: 120_000 });

after(async () => {
  await bd?.derrubar();
});

beforeEach(() => {
  // Sem esta guarda, um before() que falha faz CADA teste morrer num
  // "Cannot read properties of undefined (reading 'pool')", e o erro de boot —
  // que e a informacao util — some sob N erros derivados.
  //
  // Nao ha limpeza entre testes e nao precisa haver: toda escrita destes testes
  // acontece dentro de `comoPapel`, que roda em transacao e faz ROLLBACK.
  if (!bd) {
    throw new Error(
      "O Postgres nao subiu no before(); a causa real esta no erro daquele hook.",
    );
  }
});

/* --------------------------------------------------------------------------
 * 1 a 6: o intruso e o vizinho — os casos negativos
 * -------------------------------------------------------------------------- */

test("ESTRANHA nao enxerga NADA da loja, apesar do token valido", async () => {
  // O teste que resume a fase. Ela tem `auth.uid()` preenchido, papel
  // `authenticated` e assinatura boa — falta so a linha em `canastra.clientes`,
  // e e essa falta que as politicas perguntam. Se algum dia uma politica trocar
  // `eh_cliente()` por `auth.uid() IS NOT NULL`, todos estes zeros viram numeros.
  const vistos = {};
  for (const tabela of ["clientes", "enderecos", "carrinhos", "carrinho_itens", "pedidos"]) {
    vistos[tabela] = await contar(SESSAO_ESTRANHA, tabela);
  }

  assert.deepEqual(vistos, {
    clientes: 0,
    enderecos: 0,
    carrinhos: 0,
    carrinho_itens: 0,
    pedidos: 0,
  });
});

test("ESTRANHA nao se cadastra como cliente da loja", async () => {
  // A porta que sustenta todas as outras. `eh_cliente()` so responde "sim" para
  // quem tem linha em `canastra.clientes`; se `authenticated` pudesse inserir
  // essa linha, qualquer usuario de qualquer outro projeto da instancia se
  // auto-cadastraria e a defesa inteira cairia num INSERT.
  //
  // Nao ha politica de INSERT em `clientes` PARA NINGUEM. Quem cadastra e o
  // `service_role`, no fluxo de cadastro da loja.
  await exigeRecusa(
    SESSAO_ESTRANHA,
    "INSERT INTO canastra.clientes (user_id, nome) VALUES ($1, 'Estranha')",
    [ESTRANHA],
    "auto-cadastro em clientes",
  );

  // E nem com o uid de outra pessoa, que seria a variante esperta.
  await exigeRecusa(
    SESSAO_ESTRANHA,
    "INSERT INTO canastra.clientes (user_id, nome) VALUES ($1, 'Nao sou a Ana')",
    ["ffffffff-0000-0000-0000-00000000000f"],
    "cadastro com uid de terceiro",
  );
});

test("ESTRANHA nao se promove a administradora", async () => {
  // Aqui a recusa vem uma camada ABAIXO da RLS: 0003 revogou INSERT de
  // `authenticated` em `admins` e 0006 nao devolve — de proposito, e e a unica
  // tabela do catalogo em que a escrita nao volta. So o `service_role` escreve.
  // Duas camadas negam: sem privilegio de tabela, nenhuma politica ampla demais
  // escrita um dia por engano chega a ser consultada.
  await exigeRecusa(
    SESSAO_ESTRANHA,
    "INSERT INTO canastra.admins (user_id) VALUES ($1)",
    [ESTRANHA],
    "auto-promocao a admin",
  );

  // E, sem ser admin, ela nem enxerga quem administra a loja.
  assert.equal(await contar(SESSAO_ESTRANHA, "admins"), 0);
});

test("ESTRANHA nao escreve o catalogo — e o que ela recebe de volta", async () => {
  // 0006 DEVOLVE INSERT/UPDATE/DELETE a `authenticated` no catalogo (o painel do
  // admin fala direto com o Supabase, e admin autentica como `authenticated`
  // igual a todo mundo). Ou seja: a partir desta migracao, o privilegio de
  // tabela ja NAO barra a Estranha, e quem barra e so a politica. Este teste e
  // quem prova que a troca foi paga.
  //
  // Repare nos DOIS desfechos, que sao diferentes e os dois sao recusa:
  //   INSERT ........... 42501, o WITH CHECK barra a linha nova
  //   UPDATE / DELETE .. 0 linhas afetadas, SEM erro — o USING nao casa nada
  await exigeRecusa(
    SESSAO_ESTRANHA,
    "INSERT INTO canastra.produtos (nome, preco) VALUES ('Invasor', 0.01)",
    [],
    "insercao de produto",
  );
  await exigeRecusa(
    SESSAO_ESTRANHA,
    "INSERT INTO canastra.produto_opcoes (tipo, valor) VALUES ('tamanho', 'invasor')",
    [],
    "insercao de filtro",
  );
  await exigeRecusa(
    SESSAO_ESTRANHA,
    "INSERT INTO canastra.promocoes (titulo) VALUES ('Invasor')",
    [],
    "insercao de promocao",
  );

  const SILENCIOSOS = [
    "UPDATE canastra.produtos SET preco = 0.01",
    "DELETE FROM canastra.produtos",
    "DELETE FROM canastra.produto_opcoes",
    "UPDATE canastra.promocoes SET titulo = 'Invasor'",
    "UPDATE canastra.config_loja SET titulo_site = 'Invadido'",
    "DELETE FROM canastra.config_loja",
  ];
  for (const sql of SILENCIOSOS) {
    const afetadas = await comoPapel(bd.pool, SESSAO_ESTRANHA, async (cliente) => {
      const { rowCount } = await cliente.query(sql);
      return rowCount;
    });
    assert.equal(afetadas, 0, `nao deveria afetar linha nenhuma: ${sql}`);
  }

  // E o catalogo continua de pe, o que e a pergunta que realmente importa.
  const { rows } = await bd.pool.query(`
    SELECT
      (SELECT count(*)::int FROM canastra.produtos)       AS produtos,
      (SELECT count(*)::int FROM canastra.produto_opcoes) AS opcoes,
      (SELECT count(*)::int FROM canastra.promocoes)      AS promocoes,
      (SELECT count(*)::int FROM canastra.config_loja)    AS config
  `);
  assert.deepEqual(rows[0], { produtos: 1, opcoes: 1, promocoes: 1, config: 1 });
});

test("Ana e Bruno nao se enxergam, nem plantam linha um na conta do outro", async () => {
  // Isolamento entre CLIENTES, que e um problema diferente do da Estranha: os
  // dois sao clientes de verdade, `eh_cliente()` diz sim para ambos, e o que
  // separa e o `user_id = auth.uid()`. As duas metades da politica cobrem
  // ataques diferentes, e por isso as duas sao testadas.
  const anaVe = await comoPapel(bd.pool, SESSAO_ANA, async (cliente) => {
    const enderecos = await cliente.query(
      "SELECT endereco_id FROM canastra.enderecos ORDER BY rua",
    );
    const carrinhos = await cliente.query("SELECT carrinho_id FROM canastra.carrinhos");
    const pedidos = await cliente.query("SELECT pedido_id FROM canastra.pedidos");
    return {
      enderecos: enderecos.rows.map((r) => r.endereco_id),
      carrinhos: carrinhos.rows.map((r) => r.carrinho_id),
      pedidos: pedidos.rows.map((r) => r.pedido_id),
    };
  });
  assert.deepEqual(anaVe, {
    enderecos: [END_ANA],
    carrinhos: [CAR_ANA],
    pedidos: [PED_ANA],
  });

  // O outro lado, afirmado DIRETAMENTE e nao por espelho: que Ana enxergue so o
  // que e dela nao e a mesma frase que "Bruno nao enxerga o que e da Ana", e as
  // duas podem divergir (uma politica que somasse um OR generoso so para Bruno,
  // por exemplo, deixaria a asercao acima intacta). Custa uma consulta.
  const brunoVe = await comoPapel(bd.pool, SESSAO_BRUNO, async (cliente) => {
    const endereco = await cliente.query(
      "SELECT endereco_id FROM canastra.enderecos WHERE endereco_id = $1",
      [END_ANA],
    );
    const carrinho = await cliente.query(
      "SELECT carrinho_id FROM canastra.carrinhos WHERE carrinho_id = $1",
      [CAR_ANA],
    );
    const pedido = await cliente.query(
      "SELECT pedido_id FROM canastra.pedidos WHERE pedido_id = $1",
      [PED_ANA],
    );
    const meusPedidos = await cliente.query(
      "SELECT pedido_id FROM canastra.pedidos",
    );
    return {
      enderecoDaAna: endereco.rowCount,
      carrinhoDaAna: carrinho.rowCount,
      pedidoDaAna: pedido.rowCount,
      // Bruno tem UM pedido: o dele. Nem o da Ana, nem o orfao.
      todosOsPedidos: meusPedidos.rows.map((r) => r.pedido_id),
    };
  });
  assert.deepEqual(brunoVe, {
    enderecoDaAna: 0,
    carrinhoDaAna: 0,
    pedidoDaAna: 0,
    todosOsPedidos: [PED_BRUNO],
  });

  // O ataque que so o WITH CHECK barra: escrever uma linha na conta alheia. Sem
  // ele, um endereco plantado muda para onde a encomenda do vizinho vai — e a
  // vitima nem veria a linha, porque o USING a esconderia dela.
  await exigeRecusa(
    SESSAO_ANA,
    "INSERT INTO canastra.enderecos (user_id, rua) VALUES ($1, 'Rua do sequestro')",
    [BRUNO],
    "Ana plantando endereco na conta do Bruno",
  );
  await exigeRecusa(
    SESSAO_ANA,
    "INSERT INTO canastra.carrinho_itens (carrinho_id, produto_id, quantidade) VALUES ($1, $2, 1)",
    [CAR_BRUNO, CAFE],
    "Ana escrevendo no carrinho do Bruno",
  );

  // E alterar a linha do outro nao erra: nao encontra.
  const alteradas = await comoPapel(bd.pool, SESSAO_ANA, async (cliente) => {
    const { rowCount } = await cliente.query(
      "UPDATE canastra.enderecos SET rua = 'Rua roubada' WHERE endereco_id = $1",
      [END_BRUNO],
    );
    return rowCount;
  });
  assert.equal(alteradas, 0);
});

test("Ana, cliente comum, nao cadastra produto", async () => {
  // A diferenca entre cliente e administrador, medida. `eh_cliente()` diz sim
  // para Ana e `eh_admin()` diz nao — e e `eh_admin()` que a politica de escrita
  // do catalogo consulta. Se um dia alguem trocar uma pela outra, e este teste
  // que grita.
  await exigeRecusa(
    SESSAO_ANA,
    "INSERT INTO canastra.produtos (nome, preco) VALUES ('Cafe da Ana', 1)",
    [],
    "cliente comum cadastrando produto",
  );
});

/* --------------------------------------------------------------------------
 * 7 a 9: a vitrine e o cliente
 * -------------------------------------------------------------------------- */

test("anon le a vitrine inteira: catalogo, filtros, promocoes e configuracao", async () => {
  // As quatro leituras publicas da loja, todas sem login. Ate 0006 as tres
  // ultimas respondiam ZERO linhas apesar do GRANT: a RLS estava ligada e sem
  // politica nenhuma (falha fechada, de proposito). Fechar isso e parte do
  // trabalho desta migracao.
  const visto = await comoPapel(bd.pool, SESSAO_ANON, async (cliente) => {
    const catalogo = await cliente.query(
      "SELECT nome, preco FROM canastra.produtos_publicos ORDER BY nome",
    );
    const filtros = await cliente.query("SELECT valor FROM canastra.produto_opcoes");
    const promocoes = await cliente.query("SELECT titulo FROM canastra.promocoes");
    const config = await cliente.query("SELECT titulo_site FROM canastra.config_loja");
    return {
      catalogo: catalogo.rows.map((r) => r.nome),
      filtros: filtros.rows.map((r) => r.valor),
      promocoes: promocoes.rows.map((r) => r.titulo),
      config: config.rows.map((r) => r.titulo_site),
    };
  });

  assert.deepEqual(visto, {
    catalogo: ["Canastra Classico"],
    filtros: ["250 g"],
    promocoes: ["Frete gratis"],
    config: ["Cafe Canastra"],
  });
});

test("`custo` nao sai nem pela view nem pela tabela, para ninguem sem servico", async () => {
  // A margem da loja. Depois de 0006 a vitrine le a TABELA `produtos` (a view
  // virou `security_invoker = true`), entao o que protege `custo` deixou de ser
  // a projecao da view e passou a ser o GRANT DE COLUNA. As duas pontas sao
  // conferidas aqui porque agora sao duas.
  const { rows } = await bd.pool.query(
    `SELECT column_name FROM information_schema.columns
      WHERE table_schema = 'canastra' AND table_name = 'produtos_publicos'`,
  );
  const colunas = rows.map((r) => r.column_name);
  assert.ok(colunas.includes("preco"), "preco deveria estar na view");
  assert.ok(!colunas.includes("custo"), "custo NAO pode estar na view publica");

  // E na tabela, para os dois papeis do navegador. `authenticated` entra aqui
  // porque ele TINHA SELECT de tabela em `produtos` pelo default de 0001: sem o
  // REVOKE que 0006 faz, a politica de catalogo publico — que e `USING (true)` —
  // entregaria `custo` a qualquer token da instancia compartilhada.
  await exigeRecusa(SESSAO_ANON, "SELECT custo FROM canastra.produtos", [], "anon lendo custo");
  await exigeRecusa(
    SESSAO_ESTRANHA,
    "SELECT custo FROM canastra.produtos",
    [],
    "authenticated lendo custo",
  );
  await exigeRecusa(
    SESSAO_DORA,
    "SELECT custo FROM canastra.produtos",
    [],
    "ate a admin le custo so pelo servico",
  );

  // E o `select=*` cru na tabela, que e o preco aceito da virada da view: 42501,
  // barulhento, nunca vazado.
  await exigeRecusa(SESSAO_ANON, "SELECT * FROM canastra.produtos", [], "anon com select=*");
});

test("Ana le e escreve o que e dela", async () => {
  // O lado positivo, sem o qual os testes negativos acima passariam tambem com
  // a loja inteira quebrada. Repare que `carrinho_itens` e o caso delicado: a
  // politica dela subconsulta `carrinhos`, que esta sob RLS, e uma subconsulta
  // de politica roda como o INVOCADOR. Se `carrinhos_dono` deixasse de mostrar o
  // proprio carrinho, a sacola esvaziaria em silencio.
  const resultado = await comoPapel(bd.pool, SESSAO_ANA, async (cliente) => {
    const endereco = await cliente.query(
      "SELECT rua FROM canastra.enderecos WHERE endereco_id = $1",
      [END_ANA],
    );
    const itens = await cliente.query(
      "SELECT quantidade FROM canastra.carrinho_itens",
    );
    const pedido = await cliente.query(
      "SELECT total FROM canastra.pedidos WHERE pedido_id = $1",
      [PED_ANA],
    );

    const tocado = await cliente.query(
      "UPDATE canastra.carrinhos SET atualizado_em = now() WHERE carrinho_id = $1",
      [CAR_ANA],
    );
    const inserido = await cliente.query(
      `INSERT INTO canastra.carrinho_itens (carrinho_id, produto_id, quantidade, moagem)
       VALUES ($1, $2, 3, 'fina')`,
      [CAR_ANA, CAFE],
    );
    const novoEndereco = await cliente.query(
      "INSERT INTO canastra.enderecos (user_id, rua) VALUES ($1, 'Casa nova')",
      [ANA],
    );
    const perfil = await cliente.query(
      "UPDATE canastra.clientes SET telefone = '31999990000' WHERE user_id = $1",
      [ANA],
    );
    // Esvaziar a sacola e operacao de todo dia e passa pelo mesmo `FOR ALL`. O
    // comando vai SEM WHERE de proposito: se o USING da politica falhasse para
    // mais largo, este DELETE levaria junto o item do Bruno — e a contagem
    // abaixo, que espera exatamente os dois da Ana, e quem acusaria.
    const esvaziado = await cliente.query("DELETE FROM canastra.carrinho_itens");

    return {
      rua: endereco.rows[0]?.rua,
      itens: itens.rows.map((r) => r.quantidade),
      total: pedido.rows[0]?.total,
      carrinhoTocado: tocado.rowCount,
      itemInserido: inserido.rowCount,
      enderecoInserido: novoEndereco.rowCount,
      perfilAtualizado: perfil.rowCount,
      itensApagados: esvaziado.rowCount,
    };
  });

  assert.deepEqual(resultado, {
    rua: "Rua da Ana",
    itens: [2],
    total: "99.90",
    carrinhoTocado: 1,
    itemInserido: 1,
    enderecoInserido: 1,
    perfilAtualizado: 1,
    // O do before() e o inserido logo acima. O do Bruno NAO entra.
    itensApagados: 2,
  });

  // E o item do Bruno sobreviveu ao DELETE sem WHERE da Ana. A transacao do
  // `comoPapel` ja fez ROLLBACK, entao a contagem aqui e do banco de verdade.
  const { rows } = await bd.pool.query(
    "SELECT count(*)::int AS n FROM canastra.carrinho_itens WHERE carrinho_id = $1",
    [CAR_BRUNO],
  );
  assert.equal(rows[0].n, 1);
});

/* --------------------------------------------------------------------------
 * 10 a 13: a administradora e os pedidos
 * -------------------------------------------------------------------------- */

test("DORA administra: cadastra produto, le todos os pedidos e todos os clientes", async () => {
  // A decisao que 0006 implementa: o painel fala DIRETO com o Supabase, entao a
  // administradora precisa mesmo de INSERT/UPDATE/DELETE no catalogo — e o
  // recorte e `eh_admin()`, nao o privilegio de tabela (que agora e igual para
  // ela e para a Estranha).
  const feito = await comoPapel(bd.pool, SESSAO_DORA, async (cliente) => {
    const produto = await cliente.query(
      `INSERT INTO canastra.produtos (nome, preco, custo) VALUES ('Novo cafe', 60, 25)
       RETURNING produto_id`,
    );
    const opcao = await cliente.query(
      "INSERT INTO canastra.produto_opcoes (tipo, valor) VALUES ('categoria', 'Especial')",
    );
    const promo = await cliente.query(
      "INSERT INTO canastra.promocoes (titulo) VALUES ('Semana do cafe')",
    );
    const config = await cliente.query(
      "UPDATE canastra.config_loja SET barra_de_aviso = 'Entrega em 2 dias', atualizado_em = now()",
    );
    const pedidos = await cliente.query("SELECT count(*)::int AS n FROM canastra.pedidos");
    const clientes = await cliente.query("SELECT count(*)::int AS n FROM canastra.clientes");
    const admins = await cliente.query("SELECT count(*)::int AS n FROM canastra.admins");
    const status = await cliente.query(
      `UPDATE canastra.pedidos SET status = 'enviado', codigo_rastreio = 'BR123',
              metodo_envio = 'PAC', atualizado_em = now()
        WHERE pedido_id = $1`,
      [PED_ANA],
    );

    return {
      produtoCriado: produto.rowCount,
      opcaoCriada: opcao.rowCount,
      promoCriada: promo.rowCount,
      configAlterada: config.rowCount,
      // Os TRES pedidos, inclusive o orfao: o painel nao pode perder historico.
      pedidos: pedidos.rows[0].n,
      clientes: clientes.rows[0].n,
      admins: admins.rows[0].n,
      statusAlterado: status.rowCount,
    };
  });

  assert.deepEqual(feito, {
    produtoCriado: 1,
    opcaoCriada: 1,
    promoCriada: 1,
    configAlterada: 1,
    pedidos: 3,
    clientes: 3,
    admins: 1,
    statusAlterado: 1,
  });
});

test("DORA NAO reescreve o valor da venda — a trava e de COLUNA, nao de linha", async () => {
  // A politica de RLS autoriza a admin a mexer NA LINHA do pedido; ela nao sabe
  // dizer QUAIS colunas. Quem corta por coluna e o par
  // `REVOKE UPDATE` + `GRANT UPDATE (status, codigo_rastreio, metodo_envio,
  // atualizado_em)` de 0006. Sem ele, o painel poderia reescrever total e itens
  // de uma venda ja paga — o achado de auditoria que esta fase fecha.
  //
  // Medido: a recusa e 42501 com "permission denied for table pedidos" — erro na
  // hora, e nao um UPDATE que ignora a coluna em silencio.
  const PROIBIDOS = [
    ["total", "UPDATE canastra.pedidos SET total = 1 WHERE pedido_id = $1"],
    ["itens", "UPDATE canastra.pedidos SET itens = '[]'::jsonb WHERE pedido_id = $1"],
    [
      "endereco_json",
      "UPDATE canastra.pedidos SET endereco_json = '{}'::jsonb WHERE pedido_id = $1",
    ],
    [
      "pagamento_id_mp",
      "UPDATE canastra.pedidos SET pagamento_id_mp = 'falso' WHERE pedido_id = $1",
    ],
    // A variante esperta: uma coluna permitida no mesmo comando de uma proibida.
    // Se a checagem fosse por comando e nao por coluna, isto passaria.
    [
      "status junto de total",
      "UPDATE canastra.pedidos SET status = 'enviado', total = 1 WHERE pedido_id = $1",
    ],
    // AS QUATRO FORMAS QUE UM ATACANTE COM CREDENCIAL DE ADMIN TENTA ANTES DAS
    // DE CIMA, e nenhuma delas e o `UPDATE ... SET coluna = valor` simples que a
    // intuicao testa. Todas passam pela mesma checagem de privilegio de coluna —
    // mas isso e um fato do Postgres, nao uma escolha desta migracao, e um fato
    // nao afirmado e um fato que ninguem percebe mudar.
    [
      "SET multi-coluna",
      "UPDATE canastra.pedidos SET (status, total) = ('enviado', 1) WHERE pedido_id = $1",
    ],
    [
      "UPDATE ... FROM",
      `UPDATE canastra.pedidos p SET total = c.n
         FROM (SELECT 1 AS n) c WHERE p.pedido_id = $1`,
    ],
    [
      "CTE que escreve",
      `WITH mexida AS (
         UPDATE canastra.pedidos SET total = 1 WHERE pedido_id = $1 RETURNING pedido_id
       ) SELECT count(*) FROM mexida`,
    ],
    [
      "MERGE",
      `MERGE INTO canastra.pedidos p
       USING (SELECT $1::uuid AS id) o ON p.pedido_id = o.id
       WHEN MATCHED THEN UPDATE SET total = 1`,
    ],
  ];

  for (const [coluna, sql] of PROIBIDOS) {
    await exigeRecusa(SESSAO_DORA, sql, [PED_ANA], `admin escrevendo ${coluna}`);
  }
});

test("NINGUEM insere pedido pelo PostgREST — so o service_role", async () => {
  // Nao ha politica de INSERT em `pedidos` para papel nenhum, e a ausencia e o
  // ponto. Criar pedido e baixar estoque acontecem no servico Node, numa
  // transacao unica com chave de idempotencia (os indices parciais de 0005). Um
  // INSERT vindo do navegador — ou do painel — escreveria total, itens e estoque
  // sem passar pelo checkout, que e exatamente o achado de auditoria que esta
  // fase fecha.
  for (const [quem, sessao] of [
    ["cliente", SESSAO_ANA],
    ["administradora", SESSAO_DORA],
    ["intrusa", SESSAO_ESTRANHA],
  ]) {
    await exigeRecusa(
      sessao,
      "INSERT INTO canastra.pedidos (user_id, total) VALUES ($1, 1)",
      [ANA],
      `${quem} inserindo pedido`,
    );
  }

  // E o caminho que TEM de continuar aberto, senao a loja nao vende: o
  // `service_role`, que tem BYPASSRLS. Este e o mesmo caminho do cadastro de
  // cliente e de admin, entao os tres sao semeados juntos aqui — se alguma
  // politica de 0006 quebrasse a semeadura, seria aqui que apareceria.
  //
  // A COBAIA E A PROPRIA ESTRANHA, de proposito: a porta que os testes acima
  // fecham nao e "ela nunca pode ser cliente", e "ela nao pode se cadastrar
  // sozinha". Pelo `service_role`, isto e, pelo cadastro da loja, ela entra
  // normalmente — e so ai `eh_cliente()` passa a dizer sim.
  //
  // O que o `service_role` NAO faz e criar a linha em `auth.users`: medido, ele
  // leva 42501 ali (o shim so lhe da USAGE no schema `auth`, como na instancia
  // real, onde `auth` pertence ao GoTrue). Criar usuario e trabalho do GoTrue,
  // e o vinculo com a loja e que e trabalho do `service_role`.
  const semeado = await comoPapel(
    bd.pool,
    { papel: "service_role" },
    async (cliente) => {
      const c = await cliente.query(
        "INSERT INTO canastra.clientes (user_id, nome) VALUES ($1, 'Estranha, agora cliente')",
        [ESTRANHA],
      );
      const a = await cliente.query("INSERT INTO canastra.admins (user_id) VALUES ($1)", [
        ESTRANHA,
      ]);
      const p = await cliente.query(
        "INSERT INTO canastra.pedidos (user_id, total, chave_idempotencia) VALUES ($1, 42, 'k-1')",
        [ESTRANHA],
      );
      const tudo = await cliente.query("SELECT count(*)::int AS n FROM canastra.pedidos");
      return {
        cliente: c.rowCount,
        admin: a.rowCount,
        pedido: p.rowCount,
        pedidosVisiveis: tudo.rows[0].n,
      };
    },
  );

  assert.deepEqual(semeado, {
    cliente: 1,
    admin: 1,
    pedido: 1,
    // BYPASSRLS: o servico enxerga os tres semeados no before() mais o novo.
    pedidosVisiveis: 4,
  });
});

test("o pedido orfao some para todo cliente e continua no painel", async () => {
  // `pedidos.user_id` e ON DELETE SET NULL (0005): apagado o cliente, a venda
  // fica com `user_id IS NULL` para preservar faturamento. Contra essa linha,
  // `user_id = auth.uid()` avalia NULL — que nao e TRUE —, entao ela some para
  // TODO cliente, que e o desfecho certo: ninguem herda a compra de outro.
  //
  // O troco e que o painel nao pode depender da politica de dono para listar o
  // historico, e por isso `pedidos_admin_le` existe separada. Se um dia alguem
  // "simplificar" as duas numa so, e este teste que grita.
  for (const [quem, sessao] of [
    ["Ana", SESSAO_ANA],
    ["Bruno", SESSAO_BRUNO],
    ["Estranha", SESSAO_ESTRANHA],
  ]) {
    const visivel = await comoPapel(bd.pool, sessao, async (cliente) => {
      const { rows } = await cliente.query(
        "SELECT count(*)::int AS n FROM canastra.pedidos WHERE pedido_id = $1",
        [PED_ORFAO],
      );
      return rows[0].n;
    });
    assert.equal(visivel, 0, `${quem} nao pode enxergar o pedido orfao`);
  }

  const paraAdmin = await comoPapel(bd.pool, SESSAO_DORA, async (cliente) => {
    const { rows } = await cliente.query(
      "SELECT user_id FROM canastra.pedidos WHERE pedido_id = $1",
      [PED_ORFAO],
    );
    return rows;
  });
  assert.deepEqual(paraAdmin, [{ user_id: null }]);
});

/* --------------------------------------------------------------------------
 * As invariantes: o que precisa continuar verdade depois de 0006
 * -------------------------------------------------------------------------- */

test("as duas perguntas da loja respondem certo para as quatro identidades", async () => {
  // `eh_cliente()` e `eh_admin()` sao o coracao das politicas, e um erro nelas
  // nao apareceria como recusa e sim como respostas erradas em todo lugar ao
  // mesmo tempo. Medi-las diretamente separa "a funcao esta errada" de "a
  // politica esta errada" — dois diagnosticos completamente diferentes.
  const respostas = {};
  for (const [quem, sub] of [
    ["ana", ANA],
    ["bruno", BRUNO],
    ["dora", DORA],
    ["estranha", ESTRANHA],
  ]) {
    respostas[quem] = await comoPapel(
      bd.pool,
      { papel: "authenticated", sub },
      async (cliente) => {
        const { rows } = await cliente.query(
          "SELECT canastra.eh_cliente() AS cliente, canastra.eh_admin() AS admin",
        );
        return rows[0];
      },
    );
  }
  respostas.anon = await comoPapel(bd.pool, SESSAO_ANON, async (cliente) => {
    const { rows } = await cliente.query(
      "SELECT canastra.eh_cliente() AS cliente, canastra.eh_admin() AS admin",
    );
    return rows[0];
  });

  assert.deepEqual(respostas, {
    ana: { cliente: true, admin: false },
    bruno: { cliente: true, admin: false },
    dora: { cliente: true, admin: true },
    estranha: { cliente: false, admin: false },
    // Sem claim nenhum, `auth.uid()` e NULL e o EXISTS nao casa. Este e o caso
    // que um `auth.uid() IS NOT NULL` mal escrito quebraria primeiro.
    anon: { cliente: false, admin: false },
  });
});

test("as duas funcoes continuam SECURITY DEFINER, com search_path fixo e sem RLS muda", async () => {
  // Asercao de CATALOGO, e nao de comportamento, porque os modos de falha sao
  // feios e nenhum deles se parece com o que se procuraria:
  //
  //   sem SECURITY DEFINER ... elas recursam pela propria politica que as chama,
  //                            e o Postgres devolve 54001 "stack depth limit
  //                            exceeded", nao o 42P17 de recursao (medido: o
  //                            detector so enxerga referencia DIRETA a tabela, e
  //                            a funcao no meio esconde o ciclo).
  //   sem SET search_path .... uma funcao SECURITY DEFINER do dono do banco passa
  //                            a executar o que o chamador plantar no caminho de
  //                            busca.
  //   sem row_security=off ... o dia em que alguem ligar FORCE ROW LEVEL SECURITY
  //                            numa destas tabelas, as duas funcoes passam a
  //                            responder FALSE PARA TODO MUNDO, caladas, e a loja
  //                            inteira diz nao sem uma linha de log. Com ele, o
  //                            mesmo cenario vira 42501 "query would be affected
  //                            by row-level security policy for table admins" —
  //                            no caminho saudavel e um no-op, porque o dono ja
  //                            e isento e nenhuma consulta e "afetada".
  //
  // A ORDEM DENTRO DE `proconfig` E A DA DECLARACAO na migracao, e a asercao e
  // literal de proposito: trocar a ordem nao muda comportamento nenhum, mas um
  // deepEqual que quebra e mais barato de ler do que um regex que aceita demais.
  const { rows } = await bd.pool.query(`
    SELECT p.proname AS funcao, p.prosecdef AS definer, p.proconfig::text AS config
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'canastra' AND p.proname IN ('eh_cliente', 'eh_admin')
    ORDER BY p.proname
  `);

  const ESPERADO = '{"search_path=canastra, pg_temp",row_security=off}';
  assert.deepEqual(rows, [
    { funcao: "eh_admin", definer: true, config: ESPERADO },
    { funcao: "eh_cliente", definer: true, config: ESPERADO },
  ]);
});

/**
 * Toda tabela de `canastra` com FORCE ROW LEVEL SECURITY, sem lista de nomes.
 *
 * `migracoes` fica de fora pelo mesmo motivo de schema.test.js: e a escrituracao
 * do runner e nasce fora de qualquer migracao.
 */
const SQL_TABELAS_COM_FORCE = `
  SELECT c.relname AS tabela
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'canastra'
    AND c.relkind IN ('r', 'p')
    AND c.relname <> 'migracoes'
    AND c.relforcerowsecurity
  ORDER BY c.relname
`;

test("REGRA: nenhuma tabela de canastra liga FORCE ROW LEVEL SECURITY", async () => {
  // A dependencia escondida de 0006, e o pior modo de falha do schema inteiro.
  //
  // `eh_cliente()` e `eh_admin()` sao SECURITY DEFINER e leem `clientes` e
  // `admins` como DONO, contando com a isencao de RLS que todo dono de tabela
  // tem. FORCE ROW LEVEL SECURITY tira essa isencao. Medido com dono
  // NAO-superusuario (no harness o dono e superusuario e ignora ate o FORCE,
  // entao um teste apenas comportamental passaria verde com a producao
  // quebrada):
  //
  //   com FORCE em `admins` e `clientes`, para a Dora, que E admin e E cliente:
  //     canastra.eh_admin()   -> false
  //     canastra.eh_cliente() -> false
  //     INSERT em produtos    -> 42501
  //
  // Ou seja, as politicas nao erram: elas passam a dizer NAO para todo mundo. O
  // painel para de funcionar, o cliente deixa de ver o proprio endereco, e nao
  // ha nada em log apontando para ca. A razao e sutil: as politicas sao
  // `TO authenticated`, entao nao se aplicam ao dono, e sem politica aplicavel a
  // leitura devolve ZERO linhas em vez de erro.
  const { rows } = await bd.pool.query(SQL_TABELAS_COM_FORCE);

  assert.deepEqual(
    rows.map((r) => r.tabela),
    [],
    "FORCE RLS nestas tabelas cega canastra.eh_cliente()/eh_admin() em silencio",
  );
});

test("e a invariante de FORCE realmente reprova uma tabela que o ligue", async () => {
  // Um teste que so afirma "a lista esta vazia" passa verde tambem quando a
  // consulta esta errada e nunca acharia nada — e ai a rede nao existe e ninguem
  // fica sabendo.
  await bd.pool.query("CREATE TABLE canastra.sonda_force (id int)");
  try {
    await bd.pool.query("ALTER TABLE canastra.sonda_force ENABLE ROW LEVEL SECURITY");
    await bd.pool.query("ALTER TABLE canastra.sonda_force FORCE ROW LEVEL SECURITY");
    const { rows } = await bd.pool.query(SQL_TABELAS_COM_FORCE);
    assert.deepEqual(rows.map((r) => r.tabela), ["sonda_force"]);

    await bd.pool.query("ALTER TABLE canastra.sonda_force NO FORCE ROW LEVEL SECURITY");
    const depois = await bd.pool.query(SQL_TABELAS_COM_FORCE);
    assert.deepEqual(depois.rows, []);
  } finally {
    await bd.pool.query("DROP TABLE IF EXISTS canastra.sonda_force");
  }
});

const SQL_POLITICAS = `
  SELECT tablename AS tabela, policyname AS politica, cmd AS comando,
         roles::text AS papeis,
         coalesce(qual, '') AS usando,
         coalesce(with_check, '') AS conferindo
  FROM pg_policies
  WHERE schemaname = 'canastra'
  ORDER BY tablename, policyname
`;

/**
 * Em `canastra.clientes`, e SO nela, `user_id = auth.uid()` pode substituir
 * `canastra.eh_cliente()`.
 *
 * A prova esta no comentario de 0006 e cabe numa linha: se a linha sob teste
 * satisfaz a igualdade, ela propria e a testemunha do EXISTS que a funcao faz,
 * entao as duas condicoes coincidem. Somar a funcao ali seria uma chamada por
 * linha que nunca muda resposta nenhuma.
 *
 * CADA METADE DA POLITICA E EXIGIDA SEPARADAMENTE, e essa e a parte que importa.
 * A versao anterior desta analise testava `USING` e `WITH CHECK` CONCATENADOS, e
 * com isso deixava passar exatamente o que a excecao nao pode permitir:
 *
 *   FOR UPDATE USING (user_id = auth.uid()) WITH CHECK (cpf IS NOT NULL)
 *
 * casava pela metade do USING, escapava da rede, e nao tropecava na checagem de
 * `true` (que so dispara no literal). Essa politica deixa o dono MOVER a propria
 * linha de `clientes` para um uid estrangeiro — que e a fabricacao de
 * `eh_cliente()` que este schema inteiro existe para impedir, feita pela porta
 * dos fundos: sem INSERT, so mudando o dono de uma linha que ja existe.
 *
 * `''` — metade ausente, isto e, um `FOR SELECT` sem WITH CHECK — conta como
 * satisfeita, porque nao ha linha nova para conferir.
 */
const IGUALDADE_DO_DONO = /user_id = auth\.uid\(\)/;
const metadeCasaODono = (metade) => metade === "" || IGUALDADE_DO_DONO.test(metade);

/**
 * As quatro perguntas que se faz a toda politica de `canastra`.
 *
 * Mora fora do teste para poder ser rodada tambem contra politicas de SONDA — um
 * teste que so afirma "as listas estao vazias" passa verde igualmente quando a
 * analise esta errada e nunca acharia nada.
 */
function analisarPoliticas(politicas) {
  const frouxas = [];
  const publicasDemais = [];
  const semPapel = [];
  const proibidas = [];

  for (const p of politicas) {
    const predicado = `${p.usando} ${p.conferindo}`;
    const excecaoProvada =
      p.tabela === "clientes" &&
      metadeCasaODono(p.usando) &&
      metadeCasaODono(p.conferindo);

    // Escrita (INSERT/UPDATE/DELETE, e o ALL que os inclui) tem de nomear uma
    // das duas perguntas da loja. Nao basta "nao ser true": `auth.uid() IS NOT
    // NULL` tambem nao e `true` e seria igualmente fatal nesta instancia.
    if (
      p.comando !== "SELECT" &&
      !excecaoProvada &&
      !/eh_admin\(\)|eh_cliente\(\)/.test(predicado)
    ) {
      frouxas.push(`${p.tabela}.${p.politica} (${p.comando}): ${predicado.trim()}`);
    }

    // `true` so pode aparecer em leitura, e so nas relacoes publicas de verdade.
    if (
      (p.usando === "true" || p.conferindo === "true") &&
      !(p.comando === "SELECT" && PUBLICAS.includes(p.tabela))
    ) {
      publicasDemais.push(`${p.tabela}.${p.politica} (${p.comando})`);
    }

    // `TO public` alcancaria tambem o DONO das tabelas — e o dono e quem
    // `eh_cliente()`/`eh_admin()` usam para ler por baixo da RLS. Manter as
    // politicas presas a `anon`/`authenticated` e o que mantem aquele caminho
    // livre.
    if (p.papeis === "{public}") semPapel.push(`${p.tabela}.${p.politica}`);

    // AS DUAS AUSENCIAS QUE SUSTENTAM O RESTO, afirmadas como ausencia porque e
    // assim que elas existem: nao ha politica que AUTORIZE, e RLS ligada sem
    // politica nega.
    //
    //   clientes + INSERT .. e a porta de "virar cliente da loja". Aberta, um
    //                        token de outro projeto se auto-cadastra e
    //                        `eh_cliente()` passa a concordar com ele.
    //   pedidos  + INSERT .. e a porta de "criar venda". Aberta, total, itens e
    //                        estoque passam a ser escritos por fora do checkout.
    //
    // Desde 0006 as duas tem tambem REVOKE de INSERT no banco, que e a tranca de
    // producao; esta aqui e a de CI, e serve para a decisao aparecer no diff de
    // quem tentar reabrir a porta por politica.
    if (
      ["clientes", "pedidos"].includes(p.tabela) &&
      ["INSERT", "ALL"].includes(p.comando)
    ) {
      proibidas.push(`${p.tabela}.${p.politica} (${p.comando})`);
    }
  }

  return { frouxas, publicasDemais, semPapel, proibidas };
}

test("REGRA: politica de ESCRITA nunca e `USING (true)`, e `true` so le o que e publico", async () => {
  // A armadilha nomeada em 0003, que um revisor demonstrou funcionando:
  //
  //   CREATE POLICY tudo ON canastra.produto_opcoes FOR ALL USING (true) WITH CHECK (true);
  //
  // e um token de OUTRO projeto da instancia apaga os filtros do catalogo. Uma
  // palavra separa o certo do vazamento, e desde 0006 o REVOKE que segurava o
  // estrago nao existe mais no catalogo — o privilegio de escrita voltou para
  // `authenticated` de proposito, e a politica passou a ser a UNICA camada.
  //
  // Por isso a regra e afirmada como INVARIANTE sobre `pg_policies`, e nao como
  // lista de nomes: uma politica escrita em 0012, num arquivo que ainda nao
  // existe, cai nesta rede sem que seu autor precise saber que a rede existe.
  const { rows } = await bd.pool.query(SQL_POLITICAS);
  assert.ok(rows.length > 0, "0006 deveria ter criado politicas");

  const achados = analisarPoliticas(rows);

  assert.deepEqual(achados.frouxas, [], "politica de escrita sem eh_admin()/eh_cliente()");
  assert.deepEqual(achados.publicasDemais, [], "`true` fora de uma leitura publica");
  assert.deepEqual(achados.semPapel, [], "politica sem clausula TO");
  assert.deepEqual(
    achados.proibidas,
    [],
    "nenhuma politica pode autorizar INSERT em clientes nem em pedidos",
  );
});

test("e a invariante das politicas reprova mesmo as tres formas que ela vigia", async () => {
  // Um teste que so afirma "as quatro listas estao vazias" passa verde tambem
  // quando a analise esta errada e nunca acharia nada — e ai a rede nao existe e
  // ninguem fica sabendo. Entao a rede e testada com politicas de sonda, uma por
  // buraco, e o terceiro caso e o que a versao anterior desta analise DEIXAVA
  // PASSAR.
  const SONDAS = [
    // 1. O erro classico, nomeado em 0003: escrita com `USING (true)`.
    [
      "frouxas",
      "CREATE POLICY sonda_frouxa ON canastra.produto_opcoes FOR ALL TO authenticated USING (true) WITH CHECK (true)",
      "sonda_frouxa",
    ],
    // 2. `true` numa leitura que NAO e de relacao publica.
    [
      "publicasDemais",
      "CREATE POLICY sonda_publica ON canastra.pedidos FOR SELECT TO authenticated USING (true)",
      "sonda_publica",
    ],
    // 3. O BURACO REAL QUE ESTA VERSAO FECHOU. A excecao de `clientes` era
    //    avaliada sobre `USING || WITH CHECK` concatenados, entao esta politica
    //    — com o USING correto e o WITH CHECK LARGO — casava pela metade certa e
    //    escapava. Ela permite ao dono MOVER a propria linha de `clientes` para
    //    um uid estrangeiro, que e a fabricacao de `eh_cliente()` que o schema
    //    inteiro existe para impedir. Se um dia a analise voltar a concatenar,
    //    esta sonda fica verde e o teste falha aqui.
    [
      "frouxas",
      "CREATE POLICY sonda_meia_excecao ON canastra.clientes FOR UPDATE TO authenticated USING (user_id = auth.uid()) WITH CHECK (cpf IS NOT NULL)",
      "sonda_meia_excecao",
    ],
    // 4. Politica de INSERT em `clientes`, a porta que nao pode existir.
    [
      "proibidas",
      "CREATE POLICY sonda_insert ON canastra.clientes FOR INSERT TO authenticated WITH CHECK (canastra.eh_cliente())",
      "sonda_insert",
    ],
  ];

  for (const [lista, ddl, nome] of SONDAS) {
    await bd.pool.query(ddl);
    try {
      const { rows } = await bd.pool.query(SQL_POLITICAS);
      const achados = analisarPoliticas(rows);
      assert.ok(
        achados[lista].some((linha) => linha.includes(nome)),
        `a analise deveria reprovar ${nome} em ${lista}, e devolveu ${JSON.stringify(achados[lista])}`,
      );
    } finally {
      await bd.pool.query(ddl.replace(/^CREATE POLICY (\w+) ON (\S+).*$/, "DROP POLICY $1 ON $2"));
    }
  }

  // E, com as sondas fora, tudo volta a estar limpo — senao uma sonda esquecida
  // faria o teste ACIMA falhar por motivo errado, dependendo da ordem.
  const { rows } = await bd.pool.query(SQL_POLITICAS);
  const achados = analisarPoliticas(rows);
  assert.deepEqual(
    [achados.frouxas, achados.publicasDemais, achados.semPapel, achados.proibidas],
    [[], [], [], []],
  );
});

test("a lista publica de colunas de `produtos` e exatamente a projecao da view", async () => {
  // As duas listas TEM de andar juntas, e nada no Postgres as amarra: a view
  // projeta um conjunto de colunas, e o GRANT de coluna concede outro. Coluna
  // que entrar na view sem entrar no GRANT quebra a vitrine com 42501; coluna
  // que entrar no GRANT sem ser publica de verdade vaza calada. `custo`,
  // `criado_em` e `tsv` ficam de fora das duas.
  //
  // Isto so passou a ser necessario em 0006: enquanto a view era
  // `security_invoker = false`, ela lia a tabela com os poderes do dono e nao
  // havia GRANT de coluna nenhum para divergir.
  const { rows } = await bd.pool.query(`
    SELECT
      -- column_name e do tipo information_schema.sql_identifier, e um array
      -- desse tipo volta do driver como STRING crua ("{a,b,c}") em vez de array
      -- de JS. O ::text explicito e o que faz os tres lados desta comparacao
      -- serem do mesmo tipo dos dois lados do socket.
      (SELECT array_agg(column_name::text ORDER BY column_name::text)
         FROM information_schema.columns
        WHERE table_schema = 'canastra' AND table_name = 'produtos_publicos') AS na_view,
      (SELECT array_agg(a.attname::text ORDER BY a.attname::text)
         FROM pg_attribute a
        WHERE a.attrelid = 'canastra.produtos'::regclass
          AND a.attnum > 0 AND NOT a.attisdropped
          AND has_column_privilege('anon', a.attrelid, a.attname, 'SELECT')) AS para_anon,
      (SELECT array_agg(a.attname::text ORDER BY a.attname::text)
         FROM pg_attribute a
        WHERE a.attrelid = 'canastra.produtos'::regclass
          AND a.attnum > 0 AND NOT a.attisdropped
          AND has_column_privilege('authenticated', a.attrelid, a.attname, 'SELECT')) AS para_auth,
      (SELECT 'security_invoker=true' = ANY (c.reloptions)
         FROM pg_class c WHERE c.oid = 'canastra.produtos_publicos'::regclass) AS view_invoker
  `);

  const { na_view, para_anon, para_auth, view_invoker } = rows[0];
  assert.equal(view_invoker, true, "a view precisa ser security_invoker = true");
  assert.deepEqual(para_anon, na_view);
  assert.deepEqual(para_auth, na_view);
  assert.ok(!na_view.includes("custo"), "custo nao pode estar em lista nenhuma");
});

test("as duas portas que nao podem abrir tem tranca de BANCO, e nao so de CI", async () => {
  // A simetria que faltava. `admins` era a unica tabela com as duas camadas
  // negando; `clientes` e `pedidos` dependiam so da AUSENCIA de politica — que e
  // uma propriedade de CI (o teste acima), nao de producao. Um `CREATE POLICY`
  // distraido em 0012 a desfaz; um REVOKE nao se desfaz por distracao.
  //
  // E `clientes` e o alvo MAIS valioso dos tres: inserir uma linha ali fabrica
  // `eh_cliente()`, que e a metade que sustenta toda politica de dono do schema.
  // Virar admin exige passar por `clientes` antes (a FK de 0002); virar cliente
  // nao exigia passar por lugar nenhum alem da ausencia de uma politica.
  const { rows } = await bd.pool.query(`
    SELECT
      t.tabela,
      has_table_privilege('authenticated', 'canastra.' || t.tabela, 'SELECT') AS le,
      has_table_privilege('authenticated', 'canastra.' || t.tabela, 'INSERT') AS insere,
      has_any_column_privilege('authenticated', 'canastra.' || t.tabela, 'UPDATE') AS altera,
      has_table_privilege('authenticated', 'canastra.' || t.tabela, 'DELETE') AS apaga,
      has_table_privilege('service_role', 'canastra.' || t.tabela, 'INSERT') AS servico_insere
    FROM (VALUES ('clientes'), ('pedidos'), ('admins')) AS t(tabela)
    ORDER BY t.tabela
  `);

  assert.deepEqual(rows, [
    { tabela: "admins", le: true, insere: false, altera: false, apaga: false, servico_insere: true },
    // UPDATE fica: o cliente corrige mesmo o proprio telefone (`clientes`) e a
    // admin muda status e rastreio (`pedidos`, por coluna).
    { tabela: "clientes", le: true, insere: false, altera: true, apaga: false, servico_insere: true },
    { tabela: "pedidos", le: true, insere: false, altera: true, apaga: false, servico_insere: true },
  ]);

  // E a diferenca aparece na MENSAGEM, que e como se distingue qual camada
  // recusou. O SQLSTATE e 42501 nos dois casos — por isso a asercao principal
  // continua sendo a de privilegio acima, e esta e complementar:
  //
  //   sem privilegio de tabela ... "permission denied for table clientes"
  //   com privilegio, sem policy . "new row violates row-level security policy"
  //
  // Se esta asercao um dia falhar dizendo "new row violates...", quer dizer que
  // o REVOKE sumiu e sobrou so a rede de CI.
  await assert.rejects(
    () =>
      comoPapel(bd.pool, SESSAO_ESTRANHA, (cliente) =>
        cliente.query("INSERT INTO canastra.clientes (user_id, nome) VALUES ($1,'Eu')", [
          ESTRANHA,
        ]),
      ),
    (erro) => {
      assert.equal(erro.code, PERMISSAO_NEGADA);
      assert.match(erro.message, /permission denied for table clientes/);
      return true;
    },
  );

  // E o mesmo para um CLIENTE de verdade, que e o caso menos obvio: Ana passa em
  // `eh_cliente()` e mesmo assim nao cria linha nenhuma em `clientes`.
  await assert.rejects(
    () =>
      comoPapel(bd.pool, SESSAO_ANA, (cliente) =>
        cliente.query(
          "INSERT INTO canastra.pedidos (user_id, total) VALUES ($1, 1)",
          [ANA],
        ),
      ),
    (erro) => {
      assert.equal(erro.code, PERMISSAO_NEGADA);
      assert.match(erro.message, /permission denied for table pedidos/);
      return true;
    },
  );
});

test("canastra.migracoes nao e alcancavel pelos papeis do navegador", async () => {
  // A escrituracao do runner, e o unico objeto de `canastra` que fica de fora das
  // invariantes de RLS (desta e da de schema.test.js) por nascer no bootstrap de
  // db/migrar.js, antes de existir migracao.
  //
  // ELA ESTAVA PROTEGIDA POR ACIDENTE DE ORDEM, e isso e fragil de um jeito que
  // nao aparece em teste nenhum: o bootstrap roda ANTES de 0001, e e 0001 que faz
  // `ALTER DEFAULT PRIVILEGES`, que so alcanca objeto criado DEPOIS dele. Logo, a
  // tabela nasceu sem GRANT — sem que ninguem tivesse decidido isso.
  //
  // O acidente se desfaz na primeira vez que ela for recriada com 0001 ja
  // aplicado (recuperacao de desastre, um 0001 rodado a mao, um DROP TABLE
  // seguido de `migrar`): nasce com `arwd` para `authenticated` e sem RLS. Dai um
  // token de outro projeto insere a linha `('0007_...')` e o runner PULA uma
  // migracao futura de seguranca achando que ja rodou — sem erro, sem log, e o
  // deploy seguinte responde "nada pendente". Por isso o bootstrap agora REVOGA
  // explicitamente, e por isso isto e afirmado aqui.
  const { rows } = await bd.pool.query(`
    SELECT
      p.papel,
      has_table_privilege(p.papel, 'canastra.migracoes', 'SELECT') AS le,
      has_table_privilege(p.papel, 'canastra.migracoes', 'INSERT') AS insere,
      has_any_column_privilege(p.papel, 'canastra.migracoes', 'UPDATE') AS altera,
      has_table_privilege(p.papel, 'canastra.migracoes', 'DELETE') AS apaga
    FROM (VALUES ('anon'), ('authenticated')) AS p(papel)
    ORDER BY p.papel
  `);

  assert.deepEqual(rows, [
    { papel: "anon", le: false, insere: false, altera: false, apaga: false },
    { papel: "authenticated", le: false, insere: false, altera: false, apaga: false },
  ]);

  // E o efeito, que e o que realmente interessa: a linha falsa nao entra.
  await assert.rejects(
    () =>
      comoPapel(bd.pool, SESSAO_ESTRANHA, (cliente) =>
        cliente.query(
          "INSERT INTO canastra.migracoes (versao) VALUES ('0007_seguranca_futura')",
        ),
      ),
    (erro) => {
      assert.equal(erro.code, PERMISSAO_NEGADA);
      return true;
    },
  );
});

test("a tabela de migracoes continua fechada mesmo recriada DEPOIS de 0001", async () => {
  // O cenario que o teste acima descreve e nao mede: recuperacao de desastre. Com
  // os `ALTER DEFAULT PRIVILEGES` de 0001 ja aplicados, uma tabela nova em
  // `canastra` nasce com `arwd` para `authenticated` — e `canastra.migracoes`
  // recriada e uma tabela nova como qualquer outra.
  //
  // Sem o REVOKE no bootstrap, este teste falha na primeira asercao: e a
  // diferenca entre "esta fechada" e "esta fechada porque alguem fechou".
  await bd.pool.query("ALTER TABLE canastra.migracoes RENAME TO migracoes_guardada");
  try {
    await bd.pool.query(
      "CREATE TABLE canastra.migracoes (versao text PRIMARY KEY, aplicada_em timestamptz NOT NULL DEFAULT now())",
    );
    // As linhas voltam para a tabela nova antes de rodar o runner: sem elas ele
    // acharia que NADA foi aplicado e tentaria reexecutar 0001..0006 contra um
    // schema que ja existe. O que se quer medir aqui e so o BOOTSTRAP, que roda
    // em toda invocacao.
    await bd.pool.query(
      "INSERT INTO canastra.migracoes SELECT * FROM canastra.migracoes_guardada",
    );
    const antes = await bd.pool.query(
      "SELECT has_table_privilege('authenticated','canastra.migracoes','INSERT') AS insere",
    );
    assert.equal(
      antes.rows[0].insere,
      true,
      "o default de 0001 deveria alcancar a tabela recriada — se nao alcanca, este teste perdeu o sentido",
    );

    // E o bootstrap, rodado de novo (o runner o executa em toda invocacao),
    // fecha a porta que o default abriu.
    await aplicarMigracoes(bd.pool);
    const depois = await bd.pool.query(`
      SELECT
        has_table_privilege('authenticated','canastra.migracoes','INSERT') AS insere,
        has_table_privilege('authenticated','canastra.migracoes','SELECT') AS le
    `);
    assert.deepEqual(depois.rows[0], { insere: false, le: false });
  } finally {
    await bd.pool.query("DROP TABLE IF EXISTS canastra.migracoes");
    await bd.pool.query("ALTER TABLE canastra.migracoes_guardada RENAME TO migracoes");
  }
});
