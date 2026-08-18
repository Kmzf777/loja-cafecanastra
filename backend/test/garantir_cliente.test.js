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
/**
 * Ja e cliente E esta com `email_confirmed_at` NULL ao mesmo tempo.
 *
 * O GoTrue normalmente nao desconfirma ninguem, entao esta combinacao chega por
 * fora: conta migrada a mao, restauracao parcial de backup, troca de e-mail em
 * alguma versao. Ela existe aqui para fixar a ORDEM dos blocos da RPC — ver o
 * teste "cliente estabelecido nao fica trancado do lado de fora".
 */
const ANTIGA = "eeeeeeee-0000-0000-0000-000000000005";

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
       ($4, 'pendente@ex.com', NULL),
       ($5, 'antiga@ex.com',   NULL)`,
    [ANA, BRUNO, VETERANA, PENDENTE, ANTIGA],
  );
  await bd.pool.query(
    `INSERT INTO canastra.clientes (user_id, nome, telefone, cpf) VALUES
       ($1, 'Veterana Como Ela Se Escreveu', '31988887777', '11122233344'),
       ($2, 'Antiga',                        NULL,          NULL)`,
    [VETERANA, ANTIGA],
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

/**
 * Duas identidades `authenticated` DIFERENTES dentro de UMA transacao.
 *
 * POR QUE ISTO NAO E `comoPapel`, e por que nao pode ser: aquele helper amarra
 * uma identidade por transacao de proposito (um `sub` que some vira teste
 * falso-verde, e o comentario dele explica). Aqui a pergunta e sobre um INDICE
 * UNICO, e um indice so ve as duas linhas se as duas estiverem na MESMA
 * transacao.
 *
 * E NAO ADIANTARIA ABRIR DUAS: a segunda transacao bateria no indice unico
 * enquanto a primeira ainda esta aberta, e o Postgres nao recusa nesse caso — ele
 * BLOQUEIA esperando a primeira terminar. Como a primeira so termina quando o
 * teste devolver, o resultado de uma regressao no `nullif` seria o suite
 * PENDURADO ate o `connectionTimeoutMillis` do pool, e nao um vermelho. Numa
 * transacao so, a mesma regressao levanta 23505 na hora.
 *
 * `set_config(..., true)` e transacional e pode ser reescrito quantas vezes se
 * quiser dentro da mesma transacao — e disso que a troca de identidade vive.
 */
async function comSessoesEncadeadas(acao) {
  const cliente = await bd.pool.connect();
  const entrarComo = (sub) =>
    cliente.query("SELECT set_config('request.jwt.claims', $1, true)", [
      JSON.stringify({ sub, role: "authenticated" }),
    ]);
  try {
    await cliente.query("BEGIN");
    await cliente.query("SELECT set_config('role', 'authenticated', true)");
    return await acao(cliente, entrarComo);
  } finally {
    let falhaNoRollback;
    try {
      await cliente.query("ROLLBACK");
    } catch (erro) {
      falhaNoRollback = erro;
    }
    // Mesmo motivo de sessao.js: um cliente que nao saiu da transacao voltaria
    // ao pool ainda dentro dela e contaminaria os proximos testes.
    cliente.release(falhaNoRollback);
  }
}

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

test("telefone e CPF vazios viram NULL, e por isso DOIS cadastros vazios convivem", async () => {
  // O QUE ESTE TESTE GUARDA: as tres linhas de `nullif(btrim(...), '')` da RPC.
  // Antes dele, o `nullif` do `cpf` era defendido por catorze linhas de
  // comentario e por teste NENHUM — apagar aquela linha deixava a suite inteira
  // verde. Um comentario nao fica vermelho.
  //
  // O DESFECHO QUE IMPORTA E O DA SEGUNDA PESSOA. `cpf` e UNIQUE. Duas clientes
  // que deixam o campo em branco mandam '' as duas; sem o `nullif`, a SEGUNDA
  // leva 23505 no proprio cadastro, falando de um CPF que ela nao digitou. Com
  // NULL, o indice trata cada ausencia como distinta (NULLS DISTINCT, o padrao) e
  // as duas passam — que e o que 0002 documentou querer.
  //
  // `telefone` vem junto porque a regra de "nao informado" tem de ser a MESMA nos
  // tres campos: um '' aqui e um NULL ali fariam a tela de perfil testar as duas
  // formas para sempre.
  const linhas = await comSessoesEncadeadas(async (cliente, entrarComo) => {
    // O SEGUNDO `GARANTIR` E O TESTE. Com o `nullif` no lugar as duas linhas
    // guardam NULL e o indice unico nao ve conflito nenhum; sem ele, as duas
    // guardariam '' e ESTA chamada morreria com 23505 aqui mesmo.
    await entrarComo(ANA);
    await cliente.query(GARANTIR, ["Ana Souza", "", ""]);
    await entrarComo(BRUNO);
    await cliente.query(GARANTIR, ["Bruno Dias", "  ", "  "]);

    // A conferencia e feita por CADA uma, e nao num SELECT so: `clientes_dono_le`
    // de 0006 mostra apenas a propria linha, entao uma leitura unica traria so a
    // ultima identidade — foi o que este teste devolveu na primeira versao. Sair
    // da RLS para ler as duas de uma vez resolveria o sintoma trocando o assunto.
    const lidas = [];
    for (const sub of [ANA, BRUNO]) {
      await entrarComo(sub);
      const { rows } = await cliente.query(
        "SELECT user_id, telefone, cpf FROM canastra.clientes WHERE user_id = $1",
        [sub],
      );
      lidas.push(...rows);
    }
    return lidas;
  });

  assert.deepEqual(linhas, [
    { user_id: ANA, telefone: null, cpf: null },
    { user_id: BRUNO, telefone: null, cpf: null },
  ]);
});

test("nome em branco recusa com mensagem CURADA, e nao com o texto da constraint", async () => {
  // ALTO e CURADO sao propriedades diferentes. Sem o RAISE explicito da RPC a
  // recusa acontece do mesmo jeito (o NOT NULL de 0002 barra), mas chega no
  // navegador como "null value in column nome of relation clientes violates
  // not-null constraint" — nome de tabela e de coluna na cara de quem so errou um
  // campo do formulario. Este e, junto do CPF repetido, o erro de cadastro mais
  // provavel de todos; nao da para exigir SQLSTATE escolhido do resto do arquivo
  // e entregar cru justamente ele.
  //
  // O CODIGO CONTINUA 23502 DE PROPOSITO: e o que a propria coluna usaria, entao
  // quem chama trata UM caso, venha a recusa do RAISE ou da tabela.
  await assert.rejects(
    () =>
      comoPapel(bd.pool, SESSAO_ANA, (cliente) =>
        cliente.query(GARANTIR, ["   ", null, null]),
      ),
    (erro) => {
      assert.equal(erro.code, "23502");
      assert.match(erro.message, /nome/i);
      assert.ok(erro.hint, "a recusa curada tem de trazer HINT");
      // Se o RAISE for removido, quem responde e a coluna — e ai estes dois
      // campos vem preenchidos pelo Postgres. E a diferenca que o teste mede.
      assert.equal(erro.column, undefined);
      assert.equal(erro.table, undefined);
      return true;
    },
  );
});

test("CPF ja usado por outra conta recusa com mensagem CURADA", async () => {
  // VETERANA foi semeada com '11122233344'. Ana manda o mesmo numero.
  //
  // Sem o handler da RPC isto chega no navegador como 23505 com
  // `clientes_cpf_key` no corpo — e "clientes_cpf_key" nao e uma frase que se
  // mostre a alguem. O codigo segue 23505 pelo mesmo motivo do 23502 acima.
  //
  // A TRADUCAO SO E CORRETA POR CAUSA DE UMA INVARIANTE: depois do
  // `ON CONFLICT (user_id) DO NOTHING` a chave primaria nao pode mais levantar
  // 23505, e `UNIQUE (cpf)` e a unica outra restricao de unicidade de `clientes`.
  // Um UNIQUE novo naquela tabela faz esta mensagem mentir — e e por isso que
  // 0002 leva o aviso preso a ele.
  await assert.rejects(
    () =>
      comoPapel(bd.pool, SESSAO_ANA, (cliente) =>
        cliente.query(GARANTIR, ["Ana Souza", null, "11122233344"]),
      ),
    (erro) => {
      assert.equal(erro.code, "23505");
      assert.match(erro.message, /CPF/);
      assert.ok(erro.hint, "a recusa curada tem de trazer HINT");
      assert.equal(erro.constraint, undefined, "o nome da constraint nao pode vazar");
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

test("cliente estabelecido nao fica trancado do lado de fora sem confirmacao", async () => {
  // ISTO E UM TESTE DE ORDEM DOS BLOCOS, e a ordem ja esteve invertida.
  //
  // A checagem de e-mail guarda o ato de VIRAR cliente. Rodando ANTES da saida
  // de "ja e cliente", ela passa a valer tambem para quem ja entrou: um uid com
  // linha em `clientes` e `email_confirmed_at` nulo — conta migrada a mao,
  // restauracao parcial, troca de e-mail em alguma versao do GoTrue — receberia
  // 28000 em TODA sessao. E se o front leu 28000 como "voce ainda nao tem
  // vinculo", o cliente antigo entra em laco pedindo a confirmacao de um link que
  // ja clicou.
  //
  // A prova foi dada uma vez; a linha em `clientes` e o recibo.
  const resultado = await comoPapel(
    bd.pool,
    { papel: "authenticated", sub: ANTIGA },
    async (cliente) => {
      await cliente.query(GARANTIR, ["Antiga", null, null]);
      const { rows } = await cliente.query(
        `SELECT canastra.eh_cliente()                                     AS eh_cliente,
                (SELECT count(*)::int FROM canastra.clientes WHERE user_id = $1) AS linhas`,
        [ANTIGA],
      );
      return rows[0];
    },
  );

  assert.deepEqual(resultado, { eh_cliente: true, linhas: 1 });
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

test("conta sem linha em `auth.users` responde BYTE A BYTE como o e-mail pendente", async () => {
  // Um uid que nao existe em `auth.users` (conta apagada, token de uma instancia
  // que nao e esta) e um e-mail nao confirmado sao causas DIFERENTES com remedios
  // OPOSTOS — "reenvie o link" contra "esta conta nao existe mais". Mesmo assim a
  // RESPOSTA e a mesma, e este teste compara os campos um a um em vez de so
  // conferir o SQLSTATE: mensagem, hint e detail tambem separam os dois casos se
  // alguem os deixar divergir.
  //
  // POR QUE UNIFICAR: codigos ou textos distintos fariam da RPC um oraculo sobre
  // o `auth.users` da instancia compartilhada. O argumento de que "so da para
  // perguntar pelo proprio uid, porque e preciso ter o token dele" vale HOJE, com
  // o PostgREST na frente — um canal lateral fechado por acidente de topologia
  // nao esta fechado.
  //
  // O DIAGNOSTICO NAO SE PERDE: a RPC faz `RAISE LOG` do uid sem linha, que vai
  // para o log do SERVIDOR e nao para o cliente (`client_min_messages` e NOTICE
  // por padrao, acima de LOG na ordem do cliente; `log_min_messages` e WARNING,
  // abaixo de LOG na ordem do servidor). Se um dia aquele LOG virar NOTICE por
  // engano, a mensagem passa a viajar na resposta — e este teste nao veria, mas o
  // 'notice' abaixo veria.
  const FANTASMA = "ffffffff-0000-0000-0000-00000000000f";

  async function recusaDe(sub) {
    const avisos = [];
    try {
      await comoPapel(bd.pool, { papel: "authenticated", sub }, (cliente) => {
        cliente.on("notice", (aviso) => avisos.push(aviso.message));
        return cliente.query(GARANTIR, ["Nome Qualquer", null, null]);
      });
    } catch (erro) {
      return {
        code: erro.code,
        message: erro.message,
        hint: erro.hint,
        detail: erro.detail,
        avisos,
      };
    }
    throw new Error(`a RPC deveria ter recusado ${sub}`);
  }

  const pendente = await recusaDe(PENDENTE);
  const fantasma = await recusaDe(FANTASMA);

  assert.equal(pendente.code, EMAIL_NAO_CONFIRMADO);
  assert.deepEqual(fantasma, pendente);
  // O uid nao pode ter chegado ao cliente por nenhum canal, nem como aviso.
  assert.deepEqual(fantasma.avisos, []);
});
