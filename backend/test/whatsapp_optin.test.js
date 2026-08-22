"use strict";

/**
 * `canastra.registrar_optin_whatsapp` (0019): o unico caminho pelo qual o
 * titular grava o proprio numero DEPOIS do cadastro, e a unica escrita em
 * `whatsapp_promo_optin_em` disponivel a quem nao e `service_role`.
 *
 * O QUE ESTE ARQUIVO DEFENDE, e cada item corresponde a uma frase da migracao
 * que sem teste nao fica vermelha quando alguem a apaga:
 *
 *   · O NUMERO E O CARIMBO ANDAM JUNTOS. `notificacoes.js` manda para quem tem
 *     `telefone` e nao tem `whatsapp_optout_em` — nao consulta o carimbo. Um
 *     telefone gravado sem `whatsapp_optin_em` faz a loja escrever para alguem
 *     sobre quem ela nao tem prova nenhuma de consentimento (LGPD Art. 8 par.
 *     2), e nada nisso levanta erro.
 *   · AS DUAS METADES SAO INDEPENDENTES. Aviso de pedido e execucao de contrato
 *     (Art. 7 V); promocao e consentimento (Art. 7 I). Um parametro que mexa na
 *     coluna do outro funde as duas bases legais dentro do banco, onde nenhuma
 *     tela consegue desfazer.
 *   · A REVOGACAO FUNCIONA. `promocoes => false` tem de APAGAR o carimbo. Se
 *     ela virar "nao mexa", desmarcar a caixa deixa de desmarcar qualquer coisa
 *     — e o Art. 8 par. 5 exige que revogar seja gratuito e facilitado.
 *
 * O banco e REAL porque privilegio de coluna, SECURITY DEFINER e ROW_COUNT sao
 * exatamente o que um duble de pool nao prova: um mock responde o que o teste
 * mandar responder.
 */

const { test, before, after, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const { subirPostgres } = require("./ajuda/postgres.js");
const { comoPapel, PERMISSAO_NEGADA } = require("./ajuda/sessao.js");
const { aplicarMigracoes } = require("../db/migrar.js");

let bd;

/** Cliente da loja, com telefone e sem promocao. O caso comum. */
const ANA = "cccccccc-0000-4000-8000-000000000001";
/** Cliente da loja SEM telefone — o cadastro antigo, e quem confirmou depois. */
const BIA = "cccccccc-0000-4000-8000-000000000002";
/** Conta do GoTrue que NAO e cliente desta loja. Nao ha linha para carimbar. */
const CARLA = "cccccccc-0000-4000-8000-000000000003";

/** SQLSTATE que 0019 escolheu para "logado, mas sem vinculo com a loja". */
const SEM_VINCULO = "P0002";

/**
 * Prepara o estado de partida COMO DONO DO BANCO, e nunca por dentro de
 * `comoPapel`.
 *
 * O motivo e a propria migracao que este arquivo testa: 0018 fechou
 * `whatsapp_optin_em`, `whatsapp_promo_optin_em`, `whatsapp_wa_id` e
 * `whatsapp_ultima_entrada_em` para `authenticated`. Um cenario montado com um
 * UPDATE de sessao autenticada morre com 42501 — e o teste acusaria a funcao
 * nova por um erro que na verdade e a prova de que 0018 funciona.
 */
async function preparar(sub, campos) {
  const colunas = Object.keys(campos);
  const atribuicoes = colunas
    .map((c, i) => `${c} = $${i + 2}`)
    .join(", ");
  await bd.pool.query(
    `UPDATE canastra.clientes SET ${atribuicoes} WHERE user_id = $1`,
    [sub, ...colunas.map((c) => campos[c])],
  );
}

async function registrar(sub, telefone, promocoes) {
  return comoPapel(bd.pool, { papel: "authenticated", sub }, async (cliente) => {
    await cliente.query("SELECT canastra.registrar_optin_whatsapp($1, $2)", [
      telefone,
      promocoes,
    ]);
    // A LEITURA ACONTECE DENTRO DA TRANSACAO de proposito: `comoPapel` termina
    // em ROLLBACK, entao ler depois nao acharia escrita nenhuma — e o teste
    // passaria a medir o estado do `before`, calado.
    const { rows } = await cliente.query(
      `SELECT telefone, whatsapp_optin_em, whatsapp_promo_optin_em,
              whatsapp_optout_em, whatsapp_wa_id
         FROM canastra.clientes WHERE user_id = $1`,
      [sub],
    );
    return rows[0];
  });
}

async function recusaDe(sub, telefone, promocoes) {
  return comoPapel(bd.pool, { papel: "authenticated", sub }, (cliente) =>
    cliente
      .query("SELECT canastra.registrar_optin_whatsapp($1, $2)", [
        telefone,
        promocoes,
      ])
      .then(() => null, (e) => e),
  );
}

before(async () => {
  bd = await subirPostgres();
  await aplicarMigracoes(bd.pool);

  await bd.pool.query(
    `INSERT INTO auth.users (id, email, email_confirmed_at) VALUES
       ($1, 'ana@ex.com',   now()),
       ($2, 'bia@ex.com',   now()),
       ($3, 'carla@ex.com', now())`,
    [ANA, BIA, CARLA],
  );
  // CARLA fica de fora de propósito: conta do GoTrue sem linha em `clientes`.
  await bd.pool.query(
    `INSERT INTO canastra.clientes (user_id, nome, telefone) VALUES
       ($1, 'Ana Souza', '5531999990000'),
       ($2, 'Bia Lima',  NULL)`,
    [ANA, BIA],
  );
}, { timeout: 120_000 });

after(async () => {
  await bd?.derrubar();
});

beforeEach(async () => {
  if (!bd) {
    throw new Error(
      "O Postgres nao subiu no before(); a causa real esta no erro daquele hook.",
    );
  }
  /**
   * Estado de partida zerado a cada teste.
   *
   * `comoPapel` termina em ROLLBACK, entao o que a RPC escreve nao vaza — mas o
   * que `preparar()` escreve, escrito pelo dono fora daquela transacao, VAZA. Um
   * `whatsapp_optout_em` deixado por um teste faria o seguinte medir outra coisa
   * sem dizer, e a ordem dos testes viraria parte do contrato.
   */
  await bd.pool.query(
    `UPDATE canastra.clientes
        SET telefone = CASE WHEN user_id = $1 THEN '5531999990000' END,
            whatsapp_wa_id = NULL,
            whatsapp_optin_em = NULL,
            whatsapp_promo_optin_em = NULL,
            whatsapp_optout_em = NULL,
            whatsapp_ultima_entrada_em = NULL
      WHERE user_id IN ($1, $2)`,
    [ANA, BIA],
  );
});

/* --------------------------------------------------------------------------
 * O telefone, e o carimbo que anda com ele
 * -------------------------------------------------------------------------- */

test("grava o telefone de quem nao tinha e carimba o optin no mesmo gesto", async () => {
  const linha = await registrar(BIA, "5531988887777", null);

  assert.equal(linha.telefone, "5531988887777");
  // O par. Sem o carimbo, `notificacoes.js` mandaria assim mesmo — e a loja
  // estaria escrevendo para um numero sobre o qual nao tem prova nenhuma.
  assert.notEqual(linha.whatsapp_optin_em, null);
});

test("trocar de numero RECARIMBA, em vez de preservar a data antiga", async () => {
  // O carimbo tem de descrever o numero que esta gravado AGORA. Um carimbo de
  // janeiro sobre um numero que entrou em agosto e pior do que nenhum carimbo,
  // porque PARECE prova.
  const antes = new Date("2020-01-01T00:00:00Z");
  await preparar(ANA, { whatsapp_optin_em: antes });

  const linha = await registrar(ANA, "5531977776666", null);

  assert.equal(linha.telefone, "5531977776666");
  assert.ok(
    linha.whatsapp_optin_em > antes,
    "o carimbo tem de acompanhar o numero novo",
  );
});

test("marcar promocao sem telefone nao mexe no numero nem no carimbo de aviso", async () => {
  // A independencia dos dois parametros, no sentido que mais importa: a tela da
  // area da conta marca a caixa sem tocar no campo do telefone, e um COALESCE
  // errado ali apagaria o numero de quem so queria receber novidades.
  const linha = await registrar(ANA, null, true);

  assert.equal(linha.telefone, "5531999990000");
  assert.notEqual(linha.whatsapp_promo_optin_em, null);
});

test("informar telefone NAO carimba promocao — sao bases legais diferentes", async () => {
  // Se esta asercao cair, o consentimento de promocao passa a ser efeito
  // colateral de deixar o numero: exatamente o "ou aceita ou nao cria conta"
  // que nao e consentimento livre.
  const linha = await registrar(BIA, "5531988887777", null);

  assert.equal(linha.whatsapp_promo_optin_em, null);
});

/* --------------------------------------------------------------------------
 * A promocao: consentir, nao mexer, revogar
 * -------------------------------------------------------------------------- */

test("promocao => true carimba", async () => {
  const linha = await registrar(ANA, null, true);
  assert.notEqual(linha.whatsapp_promo_optin_em, null);
});

test("promocao => false REVOGA, e nao e o mesmo que nao mexer", async () => {
  const linha = await comoPapel(
    bd.pool,
    { papel: "authenticated", sub: ANA },
    async (cliente) => {
      await cliente.query("SELECT canastra.registrar_optin_whatsapp($1, $2)", [
        null,
        true,
      ]);
      await cliente.query("SELECT canastra.registrar_optin_whatsapp($1, $2)", [
        null,
        false,
      ]);
      const { rows } = await cliente.query(
        "SELECT whatsapp_promo_optin_em FROM canastra.clientes WHERE user_id = $1",
        [ANA],
      );
      return rows[0];
    },
  );

  assert.equal(linha.whatsapp_promo_optin_em, null);
});

test("promocao => NULL nao mexe no carimbo que ja existia", async () => {
  const marcado = new Date("2020-06-01T00:00:00Z");
  await preparar(ANA, { whatsapp_promo_optin_em: marcado });

  const linha = await registrar(ANA, "5531955554444", null);

  assert.deepEqual(linha.whatsapp_promo_optin_em, marcado);
});

test("remarcar a caixa nao adianta o carimbo do primeiro consentimento", async () => {
  // A data em que a pessoa DE FATO consentiu e a unica coisa que a coluna
  // existe para guardar. Um `now()` a cada visita a tela apagaria isso e
  // deixaria a loja com uma prova que diz sempre "hoje".
  const marcado = new Date("2020-06-01T00:00:00Z");
  await preparar(ANA, { whatsapp_promo_optin_em: marcado });

  const linha = await registrar(ANA, null, true);

  assert.deepEqual(linha.whatsapp_promo_optin_em, marcado);
});

/* --------------------------------------------------------------------------
 * O que a funcao NAO faz
 * -------------------------------------------------------------------------- */

test("nao religa quem pediu para parar", async () => {
  // Religar o canal como efeito colateral de trocar de numero e o oposto do que
  // `whatsapp_optout_em` significa. O silencio e o lado seguro do erro.
  await preparar(ANA, { whatsapp_optout_em: new Date("2026-01-01T00:00:00Z") });

  const linha = await registrar(ANA, "5531933332222", true);

  assert.notEqual(linha.whatsapp_optout_em, null);
});

test("nao limpa o wa_id ao trocar de numero", async () => {
  // Pode ser o mesmo aparelho com o telefone digitado de outro jeito. Limpar o
  // wa_id faria a loja voltar a adivinhar o nono digito para um cliente sobre o
  // qual ja tinha a resposta do webhook.
  await preparar(ANA, { whatsapp_wa_id: "5531999990000" });

  const linha = await registrar(ANA, "5531911110000", null);

  assert.equal(linha.whatsapp_wa_id, "5531999990000");
});

test("chamada vazia nao escreve nada e nao levanta erro", async () => {
  const linha = await registrar(ANA, null, null);
  assert.equal(linha.telefone, "5531999990000");
  assert.equal(linha.whatsapp_promo_optin_em, null);
});

test("telefone so com espaco conta como nao informado", async () => {
  // `nullif(btrim(...), '')`: um '' gravado seria "tem telefone" para o bot, e
  // `paraE164('')` devolve null — a loja acharia que alcanca a pessoa e nao
  // mandaria nada, calada.
  const linha = await registrar(BIA, "   ", null);
  assert.equal(linha.telefone, null);
  assert.equal(linha.whatsapp_optin_em, null);
});

/* --------------------------------------------------------------------------
 * As recusas, cada uma com o proprio codigo
 * -------------------------------------------------------------------------- */

test("sessao sem identidade e 42501, e nao um silencio", async () => {
  // `anon` nao chega no corpo (o REVOKE barra antes), e os dois caminhos
  // respondem 42501 — que e o ponto: quem chama trata um caso so.
  const erro = await comoPapel(bd.pool, { papel: "anon" }, (cliente) =>
    cliente
      .query("SELECT canastra.registrar_optin_whatsapp($1, $2)", ["5531999990000", true])
      .then(() => null, (e) => e),
  );

  assert.equal(erro?.code, PERMISSAO_NEGADA);
});

test("logado sem vinculo com a loja e P0002, e nao 42501", async () => {
  // A DISTINCAO QUE IMPORTA: 42501 leva ao login, P0002 leva a recarregar. Um
  // codigo so mandaria para o login quem ja esta logado — o laco que 0008
  // gastou paragrafos evitando.
  const erro = await recusaDe(CARLA, "5531999990000", true);

  assert.equal(erro?.code, SEM_VINCULO);
  assert.notEqual(erro?.code, PERMISSAO_NEGADA);
  assert.match(erro.message, /cadastro/i);
});

test("a recusa de quem nao tem vinculo nao escreve nada em ninguem", async () => {
  await recusaDe(CARLA, "5531999990000", true);

  const { rows } = await bd.pool.query(
    "SELECT count(*)::int AS n FROM canastra.clientes WHERE user_id = $1",
    [CARLA],
  );
  // O contrario seria a funcao virar um segundo caminho de INSERT em
  // `clientes` — exatamente o furo que 0006 fechou.
  assert.equal(rows[0].n, 0);
});

/* --------------------------------------------------------------------------
 * O privilegio: a funcao e a porta, e a coluna continua fechada
 * -------------------------------------------------------------------------- */

test("a funcao e SECURITY DEFINER com search_path fixo", async () => {
  // Sem o DEFINER o UPDATE morre no REVOKE de 0018; sem o search_path quem
  // chama escolhe em que schema `clientes` sera procurada e executa o que
  // quiser com os poderes do dono do banco.
  const { rows } = await bd.pool.query(
    `SELECT p.prosecdef AS definer, p.proconfig::text AS config
       FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'canastra' AND p.proname = 'registrar_optin_whatsapp'`,
  );

  assert.equal(rows.length, 1, "a funcao existe, e uma so");
  assert.equal(rows[0].definer, true);
  assert.match(rows[0].config, /search_path=canastra,\s*pg_temp/);
});

test("a assinatura e `telefone text, promocoes boolean` — sem user_id", async () => {
  /**
   * Afirmada NO CATALOGO, e nao pelo comportamento, pela mesma razao de
   * test/garantir_cliente.test.js: um terceiro parametro criaria uma FUNCAO
   * NOVA, e um teste de comportamento sobre a antiga continuaria verde
   * enquanto a tela passaria a chamar outra.
   *
   * OS NOMES FAZEM PARTE DO CONTRATO, e nao so os tipos: o PostgREST monta a
   * chamada com argumentos NOMEADOS. Renomear `promocoes` para `promo` deixa a
   * funcao perfeitamente valida e faz o navegador receber PGRST202 — "could not
   * find the function", com a funcao ali.
   *
   * E O QUE ELA NAO TEM E O QUE MAIS IMPORTA: nao ha parametro de uid. Um faria
   * desta funcao um jeito de carimbar consentimento no nome de outra pessoa e
   * de apontar o WhatsApp dela para um numero escolhido por quem chamou.
   */
  const { rows } = await bd.pool.query(
    `SELECT pg_get_function_identity_arguments(p.oid) AS assinatura
       FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'canastra' AND p.proname = 'registrar_optin_whatsapp'`,
  );

  assert.equal(rows[0].assinatura, "telefone text, promocoes boolean");
  assert.doesNotMatch(rows[0].assinatura, /uid|user_id/);
});

test("PUBLIC nao executa; `authenticated` executa", async () => {
  const { rows } = await bd.pool.query(
    `SELECT has_function_privilege('authenticated',
              'canastra.registrar_optin_whatsapp(text, boolean)', 'EXECUTE') AS logado,
            has_function_privilege('anon',
              'canastra.registrar_optin_whatsapp(text, boolean)', 'EXECUTE') AS anonimo`,
  );

  assert.equal(rows[0].logado, true);
  assert.equal(rows[0].anonimo, false);
});

test("0019 nao reabre o UPDATE de coluna que 0018 fechou", async () => {
  // A regressao que esta migracao poderia causar sem querer: se a porta nova
  // viesse acompanhada de um GRANT largo, a funcao seria enfeite e a coluna
  // voltaria a ser escrivel direto do navegador.
  const { rows } = await bd.pool.query(
    `SELECT a.attname AS coluna
       FROM pg_attribute a
      WHERE a.attrelid = 'canastra.clientes'::regclass
        AND a.attnum > 0 AND NOT a.attisdropped
        AND has_column_privilege('authenticated', a.attrelid, a.attname, 'UPDATE')
      ORDER BY a.attname`,
  );

  assert.deepEqual(rows.map((r) => r.coluna), [
    "cpf",
    "criado_em",
    "nome",
    "telefone",
    "user_id",
    "whatsapp_optout_em",
  ]);
});
