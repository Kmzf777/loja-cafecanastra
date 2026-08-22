"use strict";

/**
 * O que a migracao 0017 promete ao resto do sistema, afirmado no CATALOGO e
 * nao no texto do arquivo: as tres tabelas existem, nenhuma delas e alcancavel
 * por `authenticated`, e o CHECK de status recusa vocabulario inventado.
 *
 * O banco e REAL porque privilegio e CHECK sao exatamente o que um duble de
 * pool nao prova.
 */

const { test, before, after, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const { subirPostgres } = require("./ajuda/postgres.js");
const { comoPapel } = require("./ajuda/sessao.js");
const { aplicarMigracoes } = require("../db/migrar.js");

let bd;

/** Conta confirmada que ainda nao e cliente — quem informa telefone. */
const ANA = "aaaaaaaa-0000-0000-0000-000000000001";
/** Conta confirmada que ainda nao e cliente — quem NAO informa telefone. */
const BIA = "aaaaaaaa-0000-0000-0000-000000000002";

before(async () => {
  bd = await subirPostgres();
  await aplicarMigracoes(bd.pool);

  // `email_confirmed_at` PREENCHIDO nao e detalhe de cenario: `garantir_cliente`
  // (0008) recusa com 28000 quem tem a coluna nula, e as duas contas abaixo
  // existem justamente para chegar ate o INSERT.
  await bd.pool.query(
    `INSERT INTO auth.users (id, email, email_confirmed_at) VALUES
       ($1, 'ana@ex.com', now()),
       ($2, 'bia@ex.com', now())`,
    [ANA, BIA],
  );
}, { timeout: 120_000 });

after(async () => {
  await bd?.derrubar();
});

beforeEach(() => {
  if (!bd) {
    throw new Error("O Postgres nao subiu no before(); a causa real esta no erro daquele hook.");
  }
});

test("as tres tabelas do WhatsApp existem no schema canastra", async () => {
  const { rows } = await bd.pool.query(
    `SELECT tablename FROM pg_tables
      WHERE schemaname = 'canastra'
        AND tablename LIKE 'whatsapp%'
      ORDER BY tablename`,
  );
  assert.deepEqual(
    rows.map((r) => r.tablename),
    ["whatsapp_config", "whatsapp_eventos", "whatsapp_mensagens"],
  );
});

test("nenhuma tabela do WhatsApp e alcancavel por anon nem por authenticated", async () => {
  // Impede o modo de falha real: uma politica distraida amanha acordaria o
  // pacote `arwd` que 0001 concede por default a `authenticated`.
  //
  // `has_table_privilege`, e nao `information_schema.role_table_grants`, e o
  // padrao da casa para privilegio (admins/carrinho/catalogo/pedidos.test.js).
  // As duas consultas veem o REVOKE sumir — isso foi MEDIDO, e a view nao e
  // cega ao grant so por a sessao ser a do dono. A diferenca que decide esta:
  // `GRANT SELECT ON canastra.whatsapp_config TO PUBLIC` deixa a view VAZIA
  // (o grantee gravado e 'PUBLIC', e o filtro procura 'anon'/'authenticated')
  // enquanto a funcao responde `true` para os dois — tambem medido. A funcao
  // responde pelo privilegio EFETIVO; a view, so pelo grant nominal.
  const { rows } = await bd.pool.query(
    `SELECT t.tablename AS tabela, p.papel, v.privilegio
       FROM pg_tables t
       CROSS JOIN (VALUES ('anon'), ('authenticated')) AS p(papel)
       CROSS JOIN (VALUES ('SELECT'), ('INSERT'), ('UPDATE'), ('DELETE')) AS v(privilegio)
      WHERE t.schemaname = 'canastra'
        AND t.tablename LIKE 'whatsapp%'
        AND has_table_privilege(p.papel, 'canastra.' || t.tablename, v.privilegio)
      ORDER BY 1, 2, 3`,
  );
  assert.deepEqual(rows, []);
});

test("mas `service_role` continua alcancando as tres — o REVOKE nao o pegou junto", async () => {
  // O par negativo do teste acima. Sem ele, um `REVOKE ALL ... FROM
  // authenticated, service_role` deixaria a suite verde e o bot morto: quem
  // envia e quem recebe webhook fala pelo Express, com credencial de servidor.
  //
  // OS QUATRO privilegios, e nao so SELECT, porque o bot faz os quatro: escreve
  // a mensagem, atualiza o status quando o webhook volta, grava a chave de
  // deduplicacao e APAGA as chaves vencidas na limpeza dos 7 dias.
  const { rows } = await bd.pool.query(
    `SELECT t.tablename AS tabela, v.privilegio
       FROM pg_tables t
       CROSS JOIN (VALUES ('SELECT'), ('INSERT'), ('UPDATE'), ('DELETE')) AS v(privilegio)
      WHERE t.schemaname = 'canastra'
        AND t.tablename LIKE 'whatsapp%'
        AND NOT has_table_privilege('service_role', 'canastra.' || t.tablename, v.privilegio)
      ORDER BY 1, 2`,
  );
  assert.deepEqual(rows, []);
});

test("as tres tabelas do WhatsApp tem RLS ligada", async () => {
  const { rows } = await bd.pool.query(
    `SELECT relname FROM pg_class c
       JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'canastra'
        AND c.relname LIKE 'whatsapp%'
        AND c.relkind = 'r'
        AND c.relrowsecurity = false`,
  );
  assert.deepEqual(rows, []);
});

test("whatsapp_config so aceita a linha 1", async () => {
  await bd.pool.query("INSERT INTO canastra.whatsapp_config (id) VALUES (1)");
  const erro = await bd.pool
    .query("INSERT INTO canastra.whatsapp_config (id) VALUES (2)")
    .then(() => null, (e) => e);
  // SQLSTATE, nunca o texto: 23514 e violacao de CHECK.
  assert.equal(erro?.code, "23514");
});

test("whatsapp_mensagens recusa status fora do vocabulario", async () => {
  const erro = await bd.pool
    .query(
      `INSERT INTO canastra.whatsapp_mensagens (template, status)
       VALUES ('pedido_enviado', 'entregando')`,
    )
    .then(() => null, (e) => e);
  assert.equal(erro?.code, "23514");
});

test("o mesmo wamid nao vira duas linhas, mas varios NULL cabem", async () => {
  await bd.pool.query(
    `INSERT INTO canastra.whatsapp_mensagens (template, wamid)
     VALUES ('pedido_enviado', 'wamid.AAA')`,
  );
  const erro = await bd.pool
    .query(
      `INSERT INTO canastra.whatsapp_mensagens (template, wamid)
       VALUES ('pedido_entregue', 'wamid.AAA')`,
    )
    .then(() => null, (e) => e);
  assert.equal(erro?.code, "23505");

  // O indice e PARCIAL: linha sem wamid nao colide com outra sem wamid.
  await bd.pool.query(
    `INSERT INTO canastra.whatsapp_mensagens (template) VALUES ('pedido_recebido')`,
  );
  await bd.pool.query(
    `INSERT INTO canastra.whatsapp_mensagens (template) VALUES ('pedido_recebido')`,
  );
});

test("clientes ganhou as cinco colunas de WhatsApp", async () => {
  const { rows } = await bd.pool.query(
    `SELECT column_name FROM information_schema.columns
      WHERE table_schema = 'canastra' AND table_name = 'clientes'
        AND column_name LIKE 'whatsapp%'
      ORDER BY column_name`,
  );
  assert.deepEqual(rows.map((r) => r.column_name), [
    "whatsapp_optin_em",
    "whatsapp_optout_em",
    "whatsapp_promo_optin_em",
    "whatsapp_ultima_entrada_em",
    "whatsapp_wa_id",
  ]);
});

/**
 * A sessao vem de `comoPapel`, e nao de um `set_config` avulso, porque o shim de
 * `auth.uid()` em test/ajuda/postgres.js le `request.jwt.claims` — o JSON
 * INTEIRO que o PostgREST injeta — e nao um GUC por claim. Escrever
 * `request.jwt.claim.sub` deixaria `auth.uid()` NULL e as duas chamadas abaixo
 * morreriam com 42501, longe da coluna que se quer medir.
 *
 * A leitura acontece DENTRO da transacao de proposito: `comoPapel` termina em
 * ROLLBACK, entao ler depois nao acharia linha nenhuma.
 */

test("garantir_cliente carimba o optin quando um telefone e gravado", async () => {
  const linha = await comoPapel(
    bd.pool,
    { papel: "authenticated", sub: ANA },
    async (cliente) => {
      await cliente.query("SELECT canastra.garantir_cliente($1, $2, $3)", [
        "Ana",
        "31999990000",
        null,
      ]);
      const { rows } = await cliente.query(
        "SELECT telefone, whatsapp_optin_em FROM canastra.clientes WHERE user_id = $1",
        [ANA],
      );
      return rows[0];
    },
  );

  assert.equal(linha.telefone, "31999990000");
  assert.notEqual(linha.whatsapp_optin_em, null);
});

test("garantir_cliente sem telefone nao carimba optin", async () => {
  // O consentimento e o ATO de deixar o numero. Carimbar sempre transformaria a
  // coluna num `criado_em` com outro nome, e ela e justamente a prova que a LGPD
  // (Art. 8 par. 2) poe a cargo da loja.
  const linha = await comoPapel(
    bd.pool,
    { papel: "authenticated", sub: BIA },
    async (cliente) => {
      await cliente.query("SELECT canastra.garantir_cliente($1, $2, $3)", [
        "Bia",
        null,
        null,
      ]);
      const { rows } = await cliente.query(
        "SELECT whatsapp_optin_em FROM canastra.clientes WHERE user_id = $1",
        [BIA],
      );
      return rows[0];
    },
  );

  assert.equal(linha.whatsapp_optin_em, null);
});
