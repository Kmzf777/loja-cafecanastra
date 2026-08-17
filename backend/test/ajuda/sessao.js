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

  // Ausencia de identidade e decidida pelo PAPEL, nunca pelo valor de `sub`.
  //
  // Checar valor a valor nao fecha o problema: `usuario.userId` quando o campo
  // real e `user_id` vale `undefined`, e `undefined` some no default `sub = null`
  // da desestruturacao acima. A sessao entao roda anonima em silencio, e um
  // teste negativo do tipo
  //
  //   assert.rejects(() => comoPapel(pool, { papel: "authenticated", sub }, ...))
  //
  // passa verde com 42501 — mas porque o WITH CHECK bateu contra auth.uid()
  // NULL, nao contra uma identidade estrangeira. Nada foi provado, e nem o
  // PERMISSAO_NEGADA distingue os dois casos. Exigir sub para "authenticated" e
  // proibi-lo para "anon" mata a classe inteira em vez de um valor.
  const semSub = sub === null || sub === undefined || sub === "";

  if (papel === "authenticated" && semSub) {
    throw new ErroDeHarness(
      `Sessao de 'authenticated' exige sub, mas veio ${JSON.stringify(sub)}. ` +
        "Se a intencao era rodar sem autenticacao, use { papel: 'anon' }.",
    );
  }

  if (papel === "anon" && !semSub) {
    throw new ErroDeHarness(
      `Sessao de 'anon' nao aceita sub, mas veio ${JSON.stringify(sub)}. ` +
        "Anonimo com identidade seria uma combinacao que o PostgREST nunca produz.",
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
      if (!semSub) {
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
    let falhaNoRollback;
    try {
      await cliente.query("ROLLBACK");
    } catch (erro) {
      falhaNoRollback = erro;
    }
    // Um cliente que nao conseguiu sair da transacao voltaria ao pool ainda
    // dentro dela e contaminaria os proximos testes. `release(erro)` destroi a
    // conexao em vez de reaproveita-la; sem argumento, e um release normal.
    cliente.release(falhaNoRollback);
  }
}

module.exports = { comoPapel, ErroDeHarness, PERMISSAO_NEGADA };
