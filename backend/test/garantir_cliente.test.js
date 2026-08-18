"use strict";

/**
 * A RPC que liga uma conta do GoTrue a esta loja (migracao 0008), vista de fora.
 *
 * O QUE ELA E, E POR QUE ELA E DELICADA
 * 0006 REVOGOU `INSERT` em `canastra.clientes` de `authenticated`, e aquele
 * revoke e a peca central de seguranca da fase: uma linha ali fabrica
 * `canastra.eh_cliente()`, e `eh_cliente()` e a metade que sustenta TODA politica
 * de dono do schema. Mas o cadastro precisa criar exatamente essa linha. Esta RPC
 * e a UNICA porta, e ela tem nome e regra:
 *
 *   · escreve `auth.uid()` e mais ninguem — nao ha parametro de uid;
 *   · so depois do e-mail confirmado, lido de `auth.users` e nao de claim;
 *   · nunca toca `canastra.admins`.
 *
 * Cada um desses tres esta afirmado abaixo, e os dois primeiros tambem no
 * catalogo (assinatura e `prosecdef`), para que "consertar" a funcao acrescentando
 * um parametro fique vermelho no CI e nao passe numa revisao distraida.
 *
 * A ASSERCAO E SEMPRE EM SQLSTATE, nunca em texto de mensagem, pelo motivo que
 * test/ajuda/sessao.js documenta. Os dois codigos que importam:
 *   42501 — nao esta logado nesta loja (o REVOKE para `anon`, o uid nulo)
 *   28000 — esta logado, falta confirmar o e-mail
 */

const { test, before, after, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const { subirPostgres } = require("./ajuda/postgres.js");
const {
  comoPapel,
  PERMISSAO_NEGADA,
  EMAIL_NAO_CONFIRMADO,
} = require("./ajuda/sessao.js");
const { aplicarMigracoes } = require("../db/migrar.js");

let bd;

/** Conta com e-mail confirmado que AINDA NAO e cliente — o caso do cadastro. */
const ANA = "aaaaaaaa-0000-0000-0000-000000000001";
/** Outra conta confirmada e sem vinculo — a vitima dos testes de plantio. */
const BRUNO = "bbbbbbbb-0000-0000-0000-000000000002";
/** Ja e cliente, com nome, telefone e CPF proprios. O login dela nao pode reverter nada. */
const VETERANA = "cccccccc-0000-0000-0000-000000000003";
/** Cadastrou-se e nao clicou no link: `email_confirmed_at` NULL. */
const PENDENTE = "dddddddd-0000-0000-0000-000000000004";

const SESSAO_ANA = { papel: "authenticated", sub: ANA };
const SESSAO_VETERANA = { papel: "authenticated", sub: VETERANA };
const SESSAO_PENDENTE = { papel: "authenticated", sub: PENDENTE };
const SESSAO_ANON = { papel: "anon" };

const GARANTIR = "SELECT canastra.garantir_cliente($1, $2, $3)";

before(async () => {
  bd = await subirPostgres();
  await aplicarMigracoes(bd.pool);

  // Semeadura como dono do banco (isento de RLS), de proposito: o que se testa
  // aqui e a CHAMADA da RPC pelos papeis do Supabase, nao a montagem do cenario.
  await bd.pool.query(
    `INSERT INTO auth.users (id, email, email_confirmed_at) VALUES
       ($1, 'ana@ex.com',      now()),
       ($2, 'bruno@ex.com',    now()),
       ($3, 'veterana@ex.com', now()),
       ($4, 'pendente@ex.com', NULL)`,
    [ANA, BRUNO, VETERANA, PENDENTE],
  );
  await bd.pool.query(
    `INSERT INTO canastra.clientes (user_id, nome, telefone, cpf)
     VALUES ($1, 'Veterana Como Ela Se Escreveu', '31988887777', '11122233344')`,
    [VETERANA],
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

/** Le a linha de cliente de um uid, como dono do banco (por baixo da RLS). */
async function lerCliente(uid) {
  const { rows } = await bd.pool.query(
    "SELECT nome, telefone, cpf FROM canastra.clientes WHERE user_id = $1",
    [uid],
  );
  return rows[0] ?? null;
}

/* ------------------------------------------------------------------------- *
 * O caminho feliz
 * ------------------------------------------------------------------------- */

test("cria o vinculo com a loja para quem chamou", async () => {
  // A linha nasce com o uid da SESSAO. Nenhum parametro escolhe o dono — ver o
  // bloco "ninguem cria vinculo para outro uid" mais abaixo.
  const linha = await comoPapel(bd.pool, SESSAO_ANA, async (cliente) => {
    await cliente.query(GARANTIR, ["Ana Souza", "31999998888", "52998224725"]);
    const { rows } = await cliente.query(
      "SELECT user_id, nome, telefone, cpf FROM canastra.clientes WHERE user_id = $1",
      [ANA],
    );
    return rows[0];
  });

  assert.deepEqual(linha, {
    user_id: ANA,
    nome: "Ana Souza",
    telefone: "31999998888",
    cpf: "52998224725",
  });
});

test("telefone e CPF sao opcionais — o cadastro so exige nome", async () => {
  // `cpf` so entra no checkout com nota (0002 registra isso), e exigi-lo no
  // cadastro barraria a criacao da conta. Os DEFAULT NULL da assinatura sao o que
  // deixa o PostgREST chamar com `{"nome": "..."}` e mais nada.
  const linha = await comoPapel(bd.pool, SESSAO_ANA, async (cliente) => {
    await cliente.query("SELECT canastra.garantir_cliente($1)", ["Ana Souza"]);
    const { rows } = await cliente.query(
      "SELECT nome, telefone, cpf FROM canastra.clientes WHERE user_id = $1",
      [ANA],
    );
    return rows[0];
  });

  assert.deepEqual(linha, { nome: "Ana Souza", telefone: null, cpf: null });
});

test("chamar duas vezes na mesma sessao nao duplica nem estoura", async () => {
  // A RPC roda em TODA sessao autenticada, nao so no cadastro: e assim que o
  // vinculo aparece para quem confirma o e-mail dias depois. Se a segunda chamada
  // levantasse 23505 na chave primaria, o segundo login de cada cliente morreria.
  const contagem = await comoPapel(bd.pool, SESSAO_ANA, async (cliente) => {
    await cliente.query(GARANTIR, ["Ana Souza", null, null]);
    await cliente.query(GARANTIR, ["Ana Souza", null, null]);
    await cliente.query(GARANTIR, ["Ana Souza", null, null]);
    const { rows } = await cliente.query(
      "SELECT count(*)::int AS n FROM canastra.clientes WHERE user_id = $1",
      [ANA],
    );
    return rows[0].n;
  });

  assert.equal(contagem, 1);
});

test("NAO sobrescreve o cadastro de quem ja e cliente", async () => {
  // O caso concreto: a cliente corrigiu o proprio nome no perfil (a politica
  // `clientes_dono_atualiza` de 0006 existe para isso) e depois fez login noutro
  // aparelho. Um `DO UPDATE` aqui reverteria a correcao dela para o que o GoTrue
  // guardou no cadastro — uma perda de dado silenciosa, disparada por um login.
  //
  // Telefone e CPF entram no mesmo teste porque o modo de falha e o mesmo, e o do
  // CPF e pior: ele e UNIQUE, e sobrescrever com o valor do formulario de outra
  // sessao levantaria 23505 no login de outra pessoa.
  const linha = await comoPapel(bd.pool, SESSAO_VETERANA, async (cliente) => {
    await cliente.query(GARANTIR, ["Nome Do Formulario", "11000000000", "39053344705"]);
    const { rows } = await cliente.query(
      "SELECT nome, telefone, cpf FROM canastra.clientes WHERE user_id = $1",
      [VETERANA],
    );
    return rows[0];
  });

  assert.deepEqual(linha, {
    nome: "Veterana Como Ela Se Escreveu",
    telefone: "31988887777",
    cpf: "11122233344",
  });
});

test("nome em branco nao vira cliente sem nome, e a recusa vem da propria coluna", async () => {
  // `nullif(btrim(...), '')` transforma "   " em NULL e a coluna NOT NULL de 0002
  // recusa com 23502. O contrario — aceitar — criaria um cliente que aparece em
  // branco no painel e no rotulo da encomenda, sem erro nenhum na hora.
  await assert.rejects(
    () =>
      comoPapel(bd.pool, SESSAO_ANA, (cliente) =>
        cliente.query(GARANTIR, ["   ", null, null]),
      ),
    (erro) => {
      assert.equal(erro.code, "23502");
      return true;
    },
  );
});

/* ------------------------------------------------------------------------- *
 * O ponto da funcao inteira: depois dela, a RLS de dono passa a funcionar
 * ------------------------------------------------------------------------- */

test("ANTES da chamada, `enderecos` e `carrinhos` recusam a propria dona", async () => {
  // A metade que prova que o teste seguinte mede alguma coisa. Ana tem token
  // valido e `auth.uid()` preenchido; falta a linha em `clientes`, e por isso o
  // `canastra.eh_cliente()` das politicas de 0006 responde false.
  //
  // Cada tentativa vai na PROPRIA transacao: o primeiro 42501 aborta a transacao,
  // e um segundo comando na mesma so responderia 25P02.
  for (const comando of [
    "INSERT INTO canastra.enderecos (user_id, cidade) VALUES ($1, 'Belo Horizonte')",
    "INSERT INTO canastra.carrinhos (user_id) VALUES ($1)",
  ]) {
    await assert.rejects(
      () =>
        comoPapel(bd.pool, SESSAO_ANA, (cliente) => cliente.query(comando, [ANA])),
      (erro) => {
        assert.equal(erro.code, PERMISSAO_NEGADA, `deveria recusar: ${comando}`);
        return true;
      },
    );
  }
});

test("DEPOIS da chamada, a mesma sessao escreve e le o proprio endereco e a propria sacola", async () => {
  // ISTO E O PONTO DA MIGRACAO INTEIRA, ponta a ponta e na MESMA sessao: nada
  // alem da RPC mudou entre este teste e o anterior — mesmo papel, mesmo uid,
  // mesmos comandos.
  //
  // Repare que o INSERT em `enderecos` tambem exercita a chave estrangeira para
  // `canastra.clientes`: sem a linha criada pela RPC ele levaria 23503 mesmo que
  // a politica deixasse passar.
  const visto = await comoPapel(bd.pool, SESSAO_ANA, async (cliente) => {
    await cliente.query(GARANTIR, ["Ana Souza", null, null]);
    await cliente.query(
      "INSERT INTO canastra.enderecos (user_id, cidade) VALUES ($1, 'Belo Horizonte')",
      [ANA],
    );
    await cliente.query("INSERT INTO canastra.carrinhos (user_id) VALUES ($1)", [ANA]);
    const { rows } = await cliente.query(
      `SELECT (SELECT count(*)::int FROM canastra.enderecos) AS enderecos,
              (SELECT count(*)::int FROM canastra.carrinhos) AS carrinhos,
              canastra.eh_cliente()                          AS eh_cliente`,
    );
    return rows[0];
  });

  // As contagens sao sem WHERE de proposito: sob RLS elas contam o que a SESSAO
  // enxerga, entao 1 e 1 diz tanto "escreveu" quanto "le de volta".
  assert.deepEqual(visto, { enderecos: 1, carrinhos: 1, eh_cliente: true });
});

/* ------------------------------------------------------------------------- *
 * As recusas
 * ------------------------------------------------------------------------- */

test("e-mail nao confirmado e RECUSADO, e nada e escrito", async () => {
  // A defesa contra o cadastro com o e-mail de outra pessoa: sem esta checagem,
  // quem digita o endereco alheio vira cliente desta loja ANTES de provar que o
  // endereco e dele — e o dono de verdade recebe o link de confirmacao de uma
  // conta que ja esta comprando.
  //
  // A leitura e de `auth.users.email_confirmed_at`, nao de claim no JWT: nesta
  // instancia compartilhada quem emite o token nao e a loja, e um claim
  // `email_verified` e escrito por quem emite.
  await assert.rejects(
    () =>
      comoPapel(bd.pool, SESSAO_PENDENTE, (cliente) =>
        cliente.query(GARANTIR, ["Pendente", null, null]),
      ),
    (erro) => {
      assert.equal(erro.code, EMAIL_NAO_CONFIRMADO);
      return true;
    },
  );

  assert.equal(await lerCliente(PENDENTE), null);
});

test("`anon` nem chega a executar a funcao", async () => {
  // `proacl` nasce nulo, o que significa EXECUTE para PUBLIC — e PUBLIC inclui
  // `anon`. Sem o REVOKE de 0008 um visitante anonimo entraria na funcao e so
  // seria barrado la dentro, pelo `auth.uid()` nulo. Barrar no privilegio e a
  // camada de baixo, e ela nega primeiro — o padrao estabelecido em 0001.
  await assert.rejects(
    () =>
      comoPapel(bd.pool, SESSAO_ANON, (cliente) =>
        cliente.query(GARANTIR, ["Anonima", null, null]),
      ),
    (erro) => {
      assert.equal(erro.code, PERMISSAO_NEGADA);
      return true;
    },
  );
});

test("sessao sem `auth.uid()` recusa com erro, e nao com um vinculo orfao", async () => {
  // Este caminho NAO passa por `comoPapel`, e nao por preguica: aquele helper
  // proibe `authenticated` sem sub de proposito (um sub que some vira teste
  // falso-verde), e `anon` para no REVOKE antes de entrar na funcao. Sobra o DONO
  // do banco, que executa por ser dono e chega sem claim nenhum — que e
  // exatamente a forma da falha real: PostgREST mal configurado, ou um psql.
  //
  // O que se prova aqui e que a funcao ERRA em vez de inserir
  // `user_id = NULL` — que a chave primaria recusaria com 23502, uma mensagem
  // sobre coluna nula que nao diz nada sobre sessao.
  await assert.rejects(
    () => bd.pool.query(GARANTIR, ["Sem Sessao", null, null]),
    (erro) => {
      assert.equal(erro.code, PERMISSAO_NEGADA);
      return true;
    },
  );
});

/* ------------------------------------------------------------------------- *
 * Ninguem cria vinculo para outro uid
 * ------------------------------------------------------------------------- */

test("a assinatura NAO tem por onde passar um uid", async () => {
  // ASSERCAO DE CATALOGO, e ela e o guarda de verdade desta propriedade. Um teste
  // de comportamento so prova que a funcao de HOJE ignora o uid alheio; este
  // prova que nao existe parametro por onde manda-lo — que e o furo que 0006
  // fechou com o REVOKE de INSERT em `clientes`.
  //
  // A contagem no fim cobre a sobrecarga: `garantir_cliente(text, text, text,
  // uuid)` seria uma FUNCAO NOVA, com este teste passando verde sobre a antiga.
  const { rows } = await bd.pool.query(`
    SELECT p.proname,
           pg_get_function_identity_arguments(p.oid) AS argumentos,
           p.proargnames                             AS nomes,
           pg_get_function_result(p.oid)             AS retorno
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'canastra' AND p.proname = 'garantir_cliente'
  `);

  assert.deepEqual(rows, [
    {
      proname: "garantir_cliente",
      argumentos: "nome text, telefone text, cpf text",
      nomes: ["nome", "telefone", "cpf"],
      retorno: "void",
    },
  ]);
});

test("chamar com o nome de outra pessoa cria o vinculo de QUEM CHAMOU", async () => {
  // A metade de comportamento. Ana manda o nome de Bruno; o que nasce e a linha
  // de ANA, e Bruno continua sem vinculo nenhum. O uid vem de `auth.uid()`, que
  // vem do token — e nao ha caminho do parametro ate a coluna `user_id`.
  const resultado = await comoPapel(bd.pool, SESSAO_ANA, async (cliente) => {
    await cliente.query(GARANTIR, ["Bruno", null, null]);
    const { rows } = await cliente.query(
      `SELECT user_id, nome FROM canastra.clientes
       WHERE user_id IN ($1, $2) ORDER BY user_id`,
      [ANA, BRUNO],
    );
    return rows;
  });

  assert.deepEqual(resultado, [{ user_id: ANA, nome: "Bruno" }]);
});

test("a RPC NAO toca `canastra.admins` — virar admin continua sendo do service_role", async () => {
  // O alcapao de 0002/0003/0006: `admins` referencia `clientes`, entao esta RPC
  // fabrica o PRE-REQUISITO de administrador. O que ela nao pode fazer, nem por
  // engano futuro, e dar o segundo passo.
  const depois = await comoPapel(bd.pool, SESSAO_ANA, async (cliente) => {
    await cliente.query(GARANTIR, ["Ana Souza", null, null]);
    const { rows } = await cliente.query(
      `SELECT (SELECT count(*)::int FROM canastra.admins)              AS admins,
              canastra.eh_admin()                                       AS eh_admin`,
    );
    return rows[0];
  });

  assert.deepEqual(depois, { admins: 0, eh_admin: false });
});

/* ------------------------------------------------------------------------- *
 * O catalogo: o que faz a funcao poder escrever onde `authenticated` nao pode
 * ------------------------------------------------------------------------- */

test("e SECURITY DEFINER com search_path fixo, e so `authenticated` executa", async () => {
  // As quatro propriedades que sustentam a funcao, afirmadas no catalogo porque
  // no caminho feliz nenhuma delas aparece:
  //
  //   prosecdef ....... e o que deixa a funcao inserir numa tabela em que
  //                     `authenticated` nao tem INSERT (REVOKE de 0006).
  //   proconfig ....... SEM `search_path` fixo, uma funcao SECURITY DEFINER do
  //                     dono do banco e o vetor de escalonamento classico: quem
  //                     chama escolhe em que schema `clientes` e procurada.
  //                     `pg_temp` por ULTIMO — na frente, uma tabela temporaria
  //                     do proprio chamador sequestraria o nome.
  //   anon ............ fora de proposito (ver o teste do `anon` acima).
  //   service_role .... fora tambem: ele tem BYPASSRLS e escreve direto na
  //                     tabela; um EXECUTE aqui seria privilegio sem uso.
  const { rows } = await bd.pool.query(`
    SELECT p.prosecdef                                             AS definer,
           p.proconfig                                             AS config,
           has_function_privilege('anon', p.oid, 'EXECUTE')         AS anon_executa,
           has_function_privilege('authenticated', p.oid, 'EXECUTE') AS auth_executa,
           has_function_privilege('service_role', p.oid, 'EXECUTE')  AS servico_executa
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'canastra' AND p.proname = 'garantir_cliente'
  `);

  assert.deepEqual(rows, [
    {
      definer: true,
      config: ["search_path=canastra, pg_temp"],
      anon_executa: false,
      auth_executa: true,
      servico_executa: false,
    },
  ]);
});

/* ------------------------------------------------------------------------- *
 * Limites conhecidos, escritos em vez de lembrados
 * ------------------------------------------------------------------------- */

test("LIMITE CONHECIDO: qualquer conta confirmada da instancia consegue virar cliente", async () => {
  // BRUNO aqui faz o papel do usuario de OUTRO projeto da instancia Supabase
  // compartilhada: existe em `auth.users`, e-mail confirmado, e nunca passou pelo
  // formulario desta loja. Ele CHAMA a RPC e vira cliente.
  //
  // Isso NAO e um furo, e esta escrito como teste para nao ser descoberto como
  // surpresa: o cadastro desta loja e aberto ao publico, entao qualquer pessoa
  // podia virar cliente de qualquer forma. O que 0006 impedia — e continua
  // impedindo — nao e "alguem virar cliente", e sim "alguem virar cliente de
  // ESCOLHA PROPRIA sobre QUAL uid": ninguem cria vinculo para o uid alheio,
  // ninguem entra sem confirmar e-mail, e ninguem alcanca dado de terceiro
  // (as politicas de dono continuam exigindo `user_id = auth.uid()`).
  //
  // SE UM DIA A LOJA PRECISAR DE CADASTRO FECHADO (convite, lista de espera), e
  // AQUI que a regra entra — e este teste e que vira vermelho primeiro.
  const virou = await comoPapel(
    bd.pool,
    { papel: "authenticated", sub: BRUNO },
    async (cliente) => {
      await cliente.query(GARANTIR, ["Bruno de Outro Projeto", null, null]);
      const { rows } = await cliente.query("SELECT canastra.eh_cliente() AS ok");
      return rows[0].ok;
    },
  );

  assert.equal(virou, true);
});

test("LIMITE CONHECIDO: conta sem linha em `auth.users` recebe a MESMA recusa do e-mail pendente", async () => {
  // Um uid que nao existe em `auth.users` (conta apagada, token de uma instancia
  // que nao e esta) cai no mesmo 28000 de quem nao confirmou o e-mail, e nao num
  // codigo proprio.
  //
  // E DELIBERADO: dois codigos distintos aqui transformariam a RPC num oraculo
  // sobre `auth.users` — quem chamasse saberia se um uid existe na instancia. Que
  // hoje isso exija ja possuir um token daquele uid nao torna o vazamento
  // aceitavel; e o mesmo argumento pelo qual `eh_admin()` de 0006 nao recebe
  // parametro.
  const FANTASMA = "ffffffff-0000-0000-0000-00000000000f";
  await assert.rejects(
    () =>
      comoPapel(bd.pool, { papel: "authenticated", sub: FANTASMA }, (cliente) =>
        cliente.query(GARANTIR, ["Fantasma", null, null]),
      ),
    (erro) => {
      assert.equal(erro.code, EMAIL_NAO_CONFIRMADO);
      return true;
    },
  );
});
