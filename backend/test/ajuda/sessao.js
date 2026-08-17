"use strict";

/**
 * Roda uma funcao dentro de uma transacao, assumindo um papel do Supabase.
 *
 * `SET LOCAL` so vale dentro de transacao — e por isso que tudo aqui roda entre
 * BEGIN e ROLLBACK. O ROLLBACK no fim e de proposito: cada teste ve o banco
 * limpo sem precisar de TRUNCATE.
 */

const { PAPEIS_SUPABASE } = require("./postgres.js");

const PAPEIS_VALIDOS = Object.keys(PAPEIS_SUPABASE);

/**
 * SQLSTATE de `insufficient_privilege` — o que o Postgres devolve quando a RLS
 * recusa. Os testes devem assertar NESTE codigo, nunca no texto da mensagem:
 * /permission denied/i casa tanto com uma recusa de politica quanto com um GRANT
 * faltando numa migracao, e sao bugs opostos.
 */
const PERMISSAO_NEGADA = "42501";

/**
 * Falha do proprio harness (BEGIN, troca de papel, injecao do claim), nao da
 * politica sob teste.
 *
 * Existe por causa dos ~15 testes que fazem `assert.rejects(() => comoPapel(...))`:
 * sem separar, um erro de preparo da sessao e indistinguivel da recusa de RLS
 * que o teste queria provar, e o teste passa verde tendo provado nada. Esta
 * classe NUNCA copia o `code` do Postgres — o original fica em `cause` —, entao
 * uma asercao em `err.code === PERMISSAO_NEGADA` jamais casa com erro de
 * harness.
 */
class ErroDeHarness extends Error {
  constructor(mensagem, causa) {
    super(mensagem);
    this.name = "ErroDeHarness";
    if (causa) this.cause = causa;
  }
}

async function comoPapel(pool, { papel, sub = null }, acao) {
  // O whitelist nao e paranoia de seguranca (isto e teste), e protecao contra
  // teste falso-verde: `papel: "postgres"` rodaria como superusuario e passaria
  // por cima de TODA a RLS, fazendo um teste de isolamento passar justamente
  // quando o isolamento nao existe.
  if (!PAPEIS_VALIDOS.includes(papel)) {
    throw new ErroDeHarness(
      `Papel desconhecido: ${JSON.stringify(papel)}. Validos: ${PAPEIS_VALIDOS.join(", ")}.`,
    );
  }

  // `sub: ""` (ou qualquer coisa falsy vinda de um campo errado, tipo
  // `usuario.userId` quando a coluna e `user_id`) cairia numa sessao anonima
  // silenciosa: auth.uid() vira NULL e o teste "usuario de outro projeto nao
  // consegue X" passa porque ninguem estava autenticado, nao porque a politica
  // funciona. Num harness cujo proposito e provar isolamento entre projetos,
  // anonimo-por-acidente e o pior default possivel.
  if (sub === "") {
    throw new ErroDeHarness(
      "sub vazio. Para rodar sem autenticacao passe { papel: 'anon' } sem sub.",
    );
  }

  const cliente = await pool.connect();
  try {
    try {
      await cliente.query("BEGIN");
      // set_config em vez de `SET LOCAL ROLE ${papel}`: nome de papel nao da
      // para parametrizar num SET, e a interpolacao era injetavel de verdade
      // (papel: "anon; SET LOCAL statement_timeout='1ms'" executava). Como GUC,
      // o valor viaja como parametro.
      await cliente.query("SELECT set_config('role', $1, true)", [papel]);
      if (sub != null) {
        await cliente.query(
          "SELECT set_config('request.jwt.claims', $1, true)",
          [JSON.stringify({ sub, role: papel })],
        );
      }
    } catch (causa) {
      throw new ErroDeHarness(
        `Falha ao preparar a sessao de ${papel} (isto e bug do harness, nao recusa de politica).`,
        causa,
      );
    }
    return await acao(cliente);
  } finally {
    await cliente.query("ROLLBACK").catch(() => {});
    cliente.release();
  }
}

module.exports = { comoPapel, ErroDeHarness, PERMISSAO_NEGADA };
