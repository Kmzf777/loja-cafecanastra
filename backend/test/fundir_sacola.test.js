"use strict";

/**
 * A RPC de fusao da sacola (migracao 0007), vista de fora.
 *
 * O QUE ELA IMPEDE
 * A sacola de quem nao esta logado vive em `localStorage["cart"]`. Hoje o
 * `signIn` do backend proprio funde essa lista na sacola da conta; com o GoTrue
 * assumindo o login, essa costura some. Sem substituto, TODO cliente que monta a
 * sacola deslogado e depois entra PERDE os itens, em silencio — e a sacola e o
 * caminho da receita. Entao a fusao passa a ser esta funcao, chamada pelo
 * navegador logo depois do login.
 *
 * DUAS COISAS QUE ORIENTAM TODO ESTE ARQUIVO:
 *
 *  1. A fusao roda no INSTANTE do login. Qualquer excecao aqui aparece na cara
 *     de quem acabou de entrar na loja. Por isso metade dos testes e sobre lixo:
 *     `localStorage` e escrito por versoes antigas do site, por extensao de
 *     navegador e por quem abrir o console. O que ele tolera e o que ele recusa
 *     esta afirmado abaixo, item por item.
 *
 *  2. ESTRANHA e a usuaria de OUTRO projeto da instancia Supabase compartilhada:
 *     existe em `auth.users`, nao existe em `canastra.clientes`. Token de
 *     assinatura valida, `auth.uid()` preenchido, e nenhum direito nesta loja.
 *     A recusa dela e assertada em SQLSTATE, nunca em texto de mensagem — pelo
 *     motivo que test/ajuda/sessao.js documenta.
 */

const { test, before, after, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const { subirPostgres } = require("./ajuda/postgres.js");
const { comoPapel, PERMISSAO_NEGADA } = require("./ajuda/sessao.js");
const { aplicarMigracoes } = require("../db/migrar.js");

let bd;

// Cliente da loja: linha em `auth.users` E em `canastra.clientes`.
const ANA = "aaaaaaaa-0000-0000-0000-000000000001";
// SO em `auth.users` — o token de outro projeto da instancia compartilhada.
const ESTRANHA = "eeeeeeee-0000-0000-0000-000000000005";

const CAFE = "cccccccc-0000-0000-0000-000000000001";
const DRIP = "cccccccc-0000-0000-0000-000000000002";

/**
 * SQLSTATE `invalid_parameter_value`.
 *
 * E o mesmo codigo que o proprio `jsonb_array_elements` levanta quando recebe
 * algo que nao e lista; a RPC so troca a mensagem por uma que se explica. Fica
 * declarado aqui, e nao em ajuda/sessao.js, porque so este arquivo o usa —
 * aquele modulo guarda os codigos que VARIOS arquivos assertam.
 */
const PARAMETRO_INVALIDO = "22023";

const SESSAO_ANA = { papel: "authenticated", sub: ANA };
const SESSAO_ESTRANHA = { papel: "authenticated", sub: ESTRANHA };
const SESSAO_ANON = { papel: "anon" };

const FUNDIR = "SELECT canastra.fundir_sacola($1::jsonb)";

/** Um item no formato que a vitrine manda; `extra` sobrescreve o que quiser. */
function item(extra = {}) {
  return {
    produto_id: CAFE,
    quantidade: 1,
    preco: 39.7,
    nome: "Canastra Classico",
    imagem: "/cafe-classico.png",
    tamanho: "Pacote com 250 g",
    moagem: "Moido",
    ...extra,
  };
}

const sacola = (...itens) => JSON.stringify(itens);

/**
 * Le a sacola da conta de Ana, ordenada, dentro da transacao de quem chamou.
 *
 * `moagem NULLS LAST` fixa a ordem tambem quando ha item sem moagem — senao a
 * ordem viria do heap e o deepEqual falharia de vez em quando, que e a pior
 * especie de teste.
 */
async function lerSacola(cliente) {
  const { rows } = await cliente.query(
    `SELECT i.produto_id, i.quantidade, i.moagem, i.preco, i.nome, i.tamanho
     FROM canastra.carrinho_itens i
     JOIN canastra.carrinhos c ON c.carrinho_id = i.carrinho_id
     WHERE c.user_id = $1
     ORDER BY i.produto_id, i.moagem NULLS LAST`,
    [ANA],
  );
  return rows;
}

/**
 * Funde uma sacola como Ana e devolve o que ficou na conta.
 *
 * `antes` monta o estado da conta ANTES da fusao e roda na MESMA transacao de
 * proposito: `comoPapel` termina em ROLLBACK, entao um preparo feito fora dela
 * seria desfeito no meio do caminho e o assert leria outro banco.
 *
 * `parametro` vai cru para o `$1` — assim um teste consegue mandar SQL NULL
 * (`null`) e outro consegue mandar o JSON `null` (a string "null"), que sao
 * coisas diferentes e a RPC trata as duas.
 */
async function fundirComoAna(parametro, antes) {
  return comoPapel(bd.pool, SESSAO_ANA, async (cliente) => {
    if (antes) await antes(cliente);
    await cliente.query(FUNDIR, [parametro]);
    return lerSacola(cliente);
  });
}

/** Cria a sacola da conta de Ana com os itens dados, dentro da transacao. */
function comSacolaNaConta(...linhas) {
  return async (cliente) => {
    const { rows } = await cliente.query(
      "INSERT INTO canastra.carrinhos (user_id) VALUES ($1) RETURNING carrinho_id",
      [ANA],
    );
    for (const linha of linhas) {
      await cliente.query(
        `INSERT INTO canastra.carrinho_itens
           (carrinho_id, produto_id, quantidade, preco, nome, tamanho, moagem)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [
          rows[0].carrinho_id,
          linha.produto_id,
          linha.quantidade,
          linha.preco ?? 0,
          linha.nome ?? null,
          linha.tamanho ?? null,
          linha.moagem ?? null,
        ],
      );
    }
  };
}

before(async () => {
  bd = await subirPostgres();
  await aplicarMigracoes(bd.pool);

  // Semeadura como dono do banco (isento de RLS), de proposito: o que se testa
  // aqui e a CHAMADA da RPC pelos papeis do Supabase, nao a montagem do cenario.
  await bd.pool.query(
    `INSERT INTO auth.users (id, email) VALUES
       ($1, 'ana@ex.com'), ($2, 'estranha@outroprojeto.com')`,
    [ANA, ESTRANHA],
  );
  await bd.pool.query(
    "INSERT INTO canastra.clientes (user_id, nome) VALUES ($1, 'Ana')",
    [ANA],
  );
}, { timeout: 120_000 });

after(async () => {
  await bd?.derrubar();
});

beforeEach(() => {
  // Sem esta guarda, um before() que falha faz CADA teste morrer num
  // "Cannot read properties of undefined (reading 'pool')", e o erro de boot —
  // que e a informacao util — some sob N erros derivados.
  if (!bd) {
    throw new Error(
      "O Postgres nao subiu no before(); a causa real esta no erro daquele hook.",
    );
  }
});

/* ------------------------------------------------------------------------- *
 * O caminho feliz
 * ------------------------------------------------------------------------- */

test("a primeira fusao cria a sacola da conta e grava os itens", async () => {
  // Primeiro login de quem nunca teve sacola no servidor: nao ha linha em
  // `carrinhos` para conflitar, entao este e o ramo INSERT do upsert.
  const itens = await fundirComoAna(
    sacola(
      item({ quantidade: 2 }),
      item({ produto_id: DRIP, quantidade: 1, moagem: null, nome: "Drip" }),
    ),
  );

  assert.deepEqual(
    itens.map((i) => ({ produto_id: i.produto_id, quantidade: i.quantidade, moagem: i.moagem })),
    [
      { produto_id: CAFE, quantidade: 2, moagem: "Moido" },
      { produto_id: DRIP, quantidade: 1, moagem: null },
    ],
  );
  // As copias de exibicao viajam junto: sem elas a sacola aparece sem nome e sem
  // preco ate a vitrine reler o catalogo.
  assert.equal(itens[0].nome, "Canastra Classico");
  assert.equal(itens[0].preco, "39.70");
  assert.equal(itens[0].tamanho, "Pacote com 250 g");
});

test("o mesmo item ja na conta SOMA a quantidade em vez de duplicar", async () => {
  // Este teste tambem e a prova de que `RETURNING carrinho_id INTO` preenche a
  // variavel no ramo DO UPDATE, e nao so no INSERT: como a sacola ja existe, o
  // upsert cai no UPDATE, e se o RETURNING viesse vazio o INSERT dos itens
  // morreria com NOT NULL em `carrinho_id` em vez de somar.
  const itens = await fundirComoAna(
    sacola(item({ quantidade: 3 })),
    comSacolaNaConta({ produto_id: CAFE, quantidade: 2, moagem: "Moido" }),
  );

  assert.deepEqual(itens.map((i) => [i.produto_id, i.quantidade, i.moagem]), [
    [CAFE, 5, "Moido"],
  ]);
});

test("o que so existia na conta continua la depois da fusao", async () => {
  // Fusao, e nao substituicao: a sacola local nao pode apagar o que a pessoa
  // montou noutro aparelho.
  const itens = await fundirComoAna(
    sacola(item({ produto_id: DRIP, moagem: null, nome: "Drip" })),
    comSacolaNaConta({ produto_id: CAFE, quantidade: 4, moagem: "Graos" }),
  );

  assert.deepEqual(itens.map((i) => [i.produto_id, i.quantidade, i.moagem]), [
    [CAFE, 4, "Graos"],
    [DRIP, 1, null],
  ]);
});

test("moagens diferentes do mesmo produto continuam sendo itens diferentes", async () => {
  // A metade que FUNCIONA do UNIQUE (carrinho_id, produto_id, moagem): quem
  // pediu grao e moido do mesmo cafe pediu duas coisas.
  const itens = await fundirComoAna(
    sacola(item({ moagem: "Graos", quantidade: 1 }), item({ moagem: "Moido", quantidade: 2 })),
    comSacolaNaConta({ produto_id: CAFE, quantidade: 5, moagem: "Moido" }),
  );

  assert.deepEqual(itens.map((i) => [i.quantidade, i.moagem]), [
    [1, "Graos"],
    [7, "Moido"],
  ]);
});

test("a fusao carimba `atualizado_em` da sacola, que nao tem gatilho nenhum", async () => {
  // Nao ha `moddatetime` neste schema (0004 registra isso): manter a coluna e
  // trabalho de quem escreve, e esta RPC e uma das escritoras. Sem o carimbo, a
  // data de alteracao fica igual a de criacao para sempre — uma data que nao
  // alterou engana mais do que ajuda.
  const carimbo = await comoPapel(bd.pool, SESSAO_ANA, async (cliente) => {
    await cliente.query(
      `INSERT INTO canastra.carrinhos (user_id, criado_em, atualizado_em)
       VALUES ($1, now() - interval '2 days', now() - interval '2 days')`,
      [ANA],
    );
    await cliente.query(FUNDIR, [sacola(item())]);
    const { rows } = await cliente.query(
      "SELECT atualizado_em > criado_em AS avancou FROM canastra.carrinhos WHERE user_id = $1",
      [ANA],
    );
    return rows[0];
  });

  assert.deepEqual(carimbo, { avancou: true });
});

/* ------------------------------------------------------------------------- *
 * Quem nao e cliente desta loja
 * ------------------------------------------------------------------------- */

test("ESTRANHA e recusada, apesar do token valido desta instancia", async () => {
  // A regra que sustenta o schema inteiro: estar autenticado nesta instancia
  // Supabase compartilhada nao diz NADA sobre esta loja. Ser cliente e ter linha
  // em `canastra.clientes`.
  //
  // A RLS de 0006 ja recusaria sozinha (`carrinhos_dono` exige
  // `canastra.eh_cliente()`), e a checagem explicita da RPC nao e redundancia
  // inutil: sem ela a recusa viria do INSERT, com uma mensagem que fala de
  // politica de linha e nao de cadastro. Com ela, o mesmo 42501 vem com um texto
  // que diz o que fazer.
  await assert.rejects(
    () =>
      comoPapel(bd.pool, SESSAO_ESTRANHA, (cliente) =>
        cliente.query(FUNDIR, [sacola(item())]),
      ),
    (erro) => {
      assert.equal(erro.code, PERMISSAO_NEGADA);
      return true;
    },
  );

  // E nada ficou para tras: a recusa acontece antes de qualquer escrita.
  const { rows } = await bd.pool.query(
    "SELECT count(*)::int AS n FROM canastra.carrinhos WHERE user_id = $1",
    [ESTRANHA],
  );
  assert.equal(rows[0].n, 0);
});

test("`anon` nem chega a executar a funcao", async () => {
  // `proacl` nasce nulo, o que significa EXECUTE para PUBLIC — e PUBLIC inclui
  // `anon`. Sem o REVOKE de 0007 um visitante anonimo entraria na funcao e so
  // seria barrado la dentro, pelo `eh_cliente()`. Barrar no privilegio e a
  // camada de baixo, e ela nega primeiro.
  await assert.rejects(
    () =>
      comoPapel(bd.pool, SESSAO_ANON, (cliente) =>
        cliente.query(FUNDIR, [sacola(item())]),
      ),
    (erro) => {
      assert.equal(erro.code, PERMISSAO_NEGADA);
      return true;
    },
  );
});

test("a RPC NAO e SECURITY DEFINER, e isso e uma decisao medida", async () => {
  // Asercao de CATALOGO, e nao de comportamento, porque o comportamento das duas
  // formas e identico no caminho feliz — e e justamente no caminho infeliz que
  // elas diferem.
  //
  // A funcao nao precisa de DEFINER: medido, Ana faz o upsert em `carrinhos` e o
  // upsert em `carrinho_itens` sob as PROPRIAS politicas de 0006, e ESTRANHA leva
  // 42501 nos mesmos comandos. Uma versao SECURITY DEFINER acrescentaria
  // exatamente a superficie de bypass de RLS que 0006 gasta o arquivo inteiro
  // fechando: dentro dela `auth.uid()` continuaria sendo o do chamador, mas a
  // RLS pararia de valer, e qualquer erro de escrita no corpo (um `user_id`
  // vindo do JSON, por exemplo) viraria escrita na sacola alheia sem que
  // politica nenhuma reclamasse.
  //
  // Se alguem "consertar" isto ligando DEFINER, e este teste que grita.
  const { rows } = await bd.pool.query(`
    SELECT p.prosecdef AS definer,
           has_function_privilege('anon', p.oid, 'EXECUTE')          AS anon_executa,
           has_function_privilege('authenticated', p.oid, 'EXECUTE') AS auth_executa
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'canastra' AND p.proname = 'fundir_sacola'
  `);

  assert.deepEqual(rows, [
    { definer: false, anon_executa: false, auth_executa: true },
  ]);
});

/* ------------------------------------------------------------------------- *
 * Lixo em `localStorage` — o que e tolerado e o que e recusado
 * ------------------------------------------------------------------------- */

test("sacola vazia, SQL NULL e JSON null nao quebram, e garantem a sacola da conta", async () => {
  // As tres formas de "nao ha nada a fundir" que o navegador consegue mandar.
  // Nenhuma pode virar excecao: a fusao roda no instante do login, e derrubar o
  // login de quem tem a sacola vazia seria trocar um problema nenhum por um
  // problema grande.
  //
  // A sacola da conta e criada MESMO ASSIM, de proposito: depois desta chamada a
  // vitrine tem onde escrever, sem um segundo caminho de "cria se nao existir".
  for (const [nome, parametro] of [
    ["lista vazia", "[]"],
    ["SQL NULL", null],
    ["JSON null", "null"],
  ]) {
    const resultado = await comoPapel(bd.pool, SESSAO_ANA, async (cliente) => {
      await cliente.query(FUNDIR, [parametro]);
      const { rows } = await cliente.query(
        `SELECT (SELECT count(*)::int FROM canastra.carrinhos WHERE user_id = $1)      AS carrinhos,
                (SELECT count(*)::int FROM canastra.carrinho_itens)                    AS itens`,
        [ANA],
      );
      return rows[0];
    });
    assert.deepEqual(resultado, { carrinhos: 1, itens: 0 }, `falhou em: ${nome}`);
  }
});

test("quantidade zero, negativa, fracionada ou nao-numerica e descartada", async () => {
  // A quantidade e a unica coisa aqui que vira dinheiro, entao o filtro e o mais
  // estreito de todos: so inteiro positivo passa. `carrinho_itens` ja tem
  // CHECK (quantidade > 0) — sem o filtro, um zero vindo do `localStorage`
  // levantaria 23514 e derrubaria a fusao inteira por causa de um item.
  const itens = await fundirComoAna(
    sacola(
      item({ quantidade: 0 }),
      item({ quantidade: -3 }),
      item({ quantidade: 1.5 }),
      item({ quantidade: "muitos" }),
      item({ quantidade: null }),
      item({ produto_id: DRIP, quantidade: 2, moagem: null }),
    ),
  );

  assert.deepEqual(itens.map((i) => [i.produto_id, i.quantidade]), [[DRIP, 2]]);
});

test("item malformado e jogado fora sem derrubar a fusao dos outros", async () => {
  // O ponto do teste esta no ultimo item da lista: ele TEM de chegar. Uma RPC
  // que estourasse no primeiro lixo perderia a sacola inteira de quem tivesse um
  // resto de versao antiga do site guardado no navegador.
  const itens = await fundirComoAna(
    sacola(
      null,
      "isto nao e um item",
      42,
      [],
      {},
      { quantidade: 2 }, // sem produto_id
      item({ produto_id: "nao-e-uuid" }),
      item({ produto_id: null }),
      item({ produto_id: "cccccccc-0000-0000-0000" }), // uuid pela metade
      item({ produto_id: DRIP, quantidade: 3, moagem: null, nome: "Drip" }),
    ),
  );

  assert.deepEqual(itens.map((i) => [i.produto_id, i.quantidade]), [[DRIP, 3]]);
});

test("preco ausente ou impresentavel vira zero, e o item sobrevive", async () => {
  // Preco nao pode derrubar a fusao: ele e COPIA DE EXIBICAO. Quem cobra e o
  // checkout, que rele preco e estoque do banco antes de gerar o pagamento — e
  // por isso zerar aqui nao vende cafe de graca, so mostra "R$ 0,00" ate a
  // vitrine reler o catalogo. Perder o item, esse sim, seria irreversivel.
  const itens = await fundirComoAna(
    sacola(
      item({ moagem: "Graos", preco: "de graca" }),
      item({ moagem: "Moido", preco: null }),
      item({ produto_id: DRIP, moagem: null, preco: 12.5 }),
    ),
  );

  assert.deepEqual(itens.map((i) => [i.moagem, i.preco]), [
    ["Graos", "0.00"],
    ["Moido", "0.00"],
    [null, "12.50"],
  ]);
});

test("a mesma linha repetida na sacola local soma, em vez de estourar 21000", async () => {
  // ARMADILHA REAL DO `ON CONFLICT`, e a que mais custaria caro: um unico INSERT
  // nao pode tocar a MESMA linha duas vezes. Com duas entradas de mesmo produto e
  // mesma moagem na lista, o comando morre com 21000 ("ON CONFLICT DO UPDATE
  // command cannot affect row a second time") — no login, na cara do cliente, e
  // com a sacola inteira perdida.
  //
  // `localStorage` chega assim com facilidade: basta uma versao antiga do site
  // que juntasse itens por outra chave. Somar ANTES de inserir mata o caso.
  const itens = await fundirComoAna(
    sacola(
      item({ quantidade: 2 }),
      item({ quantidade: 3 }),
      item({ produto_id: DRIP, quantidade: 1, moagem: null }),
      item({ produto_id: DRIP, quantidade: 4, moagem: null }),
    ),
  );

  assert.deepEqual(itens.map((i) => [i.produto_id, i.quantidade, i.moagem]), [
    [CAFE, 5, "Moido"],
    [DRIP, 5, null],
  ]);
});

test("sacola que nao e uma lista e RECUSADA, e nao tolerada", async () => {
  // Aqui a linha entre tolerar e recusar: o ENVELOPE tem de estar certo, o
  // CONTEUDO e melhor esforco.
  //
  // Um objeto ou um numero no lugar da lista nao e dado velho de cliente — o
  // `lerLocal()` da vitrine ja devolve `[]` para qualquer coisa que nao seja
  // array, entao esta forma so chega aqui por bug de quem chama. Tolerar em
  // silencio significaria a sacola sumir no login sem uma linha de log, que e
  // exatamente a falha que esta migracao existe para impedir. Recusar alto poe o
  // erro no lugar em que ele pode ser consertado.
  for (const parametro of ['{"cart": []}', "42", '"[]"', "true"]) {
    await assert.rejects(
      () =>
        comoPapel(bd.pool, SESSAO_ANA, (cliente) =>
          cliente.query(FUNDIR, [parametro]),
        ),
      (erro) => {
        assert.equal(erro.code, PARAMETRO_INVALIDO, `deveria recusar: ${parametro}`);
        return true;
      },
    );
  }
});

/* ------------------------------------------------------------------------- *
 * Limites conhecidos, escritos em vez de lembrados
 * ------------------------------------------------------------------------- */

test("LIMITE CONHECIDO: sem moagem, o item da conta duplica em vez de somar", async () => {
  // Isto NAO e o comportamento desejado; e o ACEITO nesta fase, herdado de 0004 e
  // ja medido em test/carrinho.test.js. No Postgres cada NULL e distinto dos
  // outros num indice unico (NULLS DISTINCT, o padrao), entao a chave
  // (carrinho_id, produto_id, NULL) nunca colide com ela mesma e o ON CONFLICT
  // da RPC simplesmente nao dispara.
  //
  // A RPC NAO conserta isso por conta propria, e a decisao e deliberada: um
  // `coalesce(moagem, 'padrao')` aqui gravaria uma moagem que a vitrine nunca
  // escreve quando insere direto pelo PostgREST, e as duas metades da sacola
  // passariam a nao casar NUNCA MAIS — trocaria uma duplicata visivel por uma
  // divergencia permanente entre dois caminhos de escrita. O conserto de verdade
  // e no UNIQUE (`NULLS NOT DISTINCT`, PG 15+) ou num default na coluna, e mexe
  // no alvo do ON CONFLICT desta funcao. NAO mude um sem o outro.
  //
  // Passa porque a vitrine sempre manda moagem para cafe, o unico produto com
  // essa variacao. Se um dia entrar item sem moagem (caneca, assinatura), e este
  // teste que documenta o que vai acontecer.
  const itens = await fundirComoAna(
    sacola(item({ produto_id: DRIP, quantidade: 1, moagem: null })),
    comSacolaNaConta({ produto_id: DRIP, quantidade: 1, moagem: null }),
  );

  assert.deepEqual(itens.map((i) => [i.quantidade, i.moagem]), [
    [1, null],
    [1, null],
  ]);
});

test("LIMITE CONHECIDO: fundir a MESMA sacola duas vezes soma duas vezes", async () => {
  // A RPC nao tem — e nao pode ter — como saber que a lista que chegou ja foi
  // fundida: ela nao carrega identidade nenhuma.
  //
  // ISTO E UM RECADO PARA QUEM ESCREVER O LADO DO NAVEGADOR. `onAuthStateChange`
  // do supabase-js dispara mais de uma vez por sessao (INITIAL_SESSION,
  // SIGNED_IN, TOKEN_REFRESHED). Chamar a fusao em todas elas DOBRA a sacola do
  // cliente a cada evento. A unica defesa esta do lado de la: limpar
  // `localStorage["cart"]` assim que a fusao responder, e so entao.
  const itens = await comoPapel(bd.pool, SESSAO_ANA, async (cliente) => {
    await cliente.query(FUNDIR, [sacola(item({ quantidade: 2 }))]);
    await cliente.query(FUNDIR, [sacola(item({ quantidade: 2 }))]);
    return lerSacola(cliente);
  });

  assert.deepEqual(itens.map((i) => i.quantidade), [4]);
});
