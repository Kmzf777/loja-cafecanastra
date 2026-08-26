"use strict";

/**
 * `canastra.admin_log` escrito pelo MESMO código que faz a ação (migração 0035).
 *
 * POR QUE NÃO É UM TRIGGER, e a 0035 já mediu: o painel escreve pelo pool do
 * Express, que conecta como DONO do banco e sem claim nenhum — `auth.uid()`
 * dentro de um trigger seria NULL, e todo log sairia sem autor, que é a única
 * coluna que a tabela existe para guardar. Registrar quem foi exige que quem
 * SABE quem foi escreva a linha. O que fecha a lacuna do esquecimento é teste
 * por rota, e é isso que `painel_*.test.js` faz.
 *
 * NA MESMA TRANSAÇÃO DA AÇÃO, sempre que houver uma: quem chama passa o
 * `client` da transação aberta, e aí ou os dois acontecem ou nenhum. Um INSERT
 * separado depois do COMMIT é um log que some justamente quando alguma coisa
 * deu errado — que é quando ele seria lido.
 */

/**
 * O VOCABULÁRIO DE `acao`, EM UM LUGAR SÓ.
 *
 * A coluna é texto livre no banco de propósito (0035): um CHECK que recusasse
 * uma ação fora da lista faria ROLLBACK DA AÇÃO, e a auditoria passaria a poder
 * derrubar a loja — justamente na tela nova, que é a que ninguém lembrou de
 * acrescentar à lista. A disciplina mora aqui, onde o custo de errar é um
 * relatório feio e não uma venda perdida.
 *
 * O formato é `entidade_verbo_no_particípio`, sempre em minúsculas com `_`:
 * 'preco_alterado' e 'precoAlterado' virariam duas linhas do mesmo relatório.
 */
const ACOES = Object.freeze({
  PEDIDO_STATUS_ALTERADO: "pedido_status_alterado",
  PEDIDOS_EXPORTADOS: "pedidos_exportados",
  PRODUTO_ESTOQUE_AJUSTADO: "produto_estoque_ajustado",
  PRODUTO_CUSTO_ALTERADO: "produto_custo_alterado",
  AVALIACOES_MODERADAS: "avaliacoes_moderadas",
  ADMIN_PROMOVIDO: "admin_promovido",
  ADMIN_REMOVIDO: "admin_removido",
  CAMPANHA_CRIADA: "campanha_criada",
  CAMPANHA_ALTERADA: "campanha_alterada",
  CONSENTIMENTO_REGISTRADO: "consentimento_registrado",
  ENVIO_CRIADO: "envio_criado",
  ENVIO_ALTERADO: "envio_alterado",
});

/** As entidades — o "sobre o quê". Mesma razão de `ACOES` para viver aqui. */
const ENTIDADES = Object.freeze({
  PEDIDO: "pedido",
  PEDIDOS: "pedidos",
  PRODUTO: "produto",
  AVALIACAO: "avaliacao",
  ADMIN: "admin",
  CAMPANHA: "campanha",
  CONSENTIMENTO: "consentimento",
  ENVIO: "envio",
});

/**
 * Grava uma linha de auditoria.
 *
 * @param {object} conexao Cliente da transação da ação, ou o pool quando a ação
 *   não tem transação (uma leitura auditada, como a exportação).
 * @param {object} dados
 *   `adminUserId`: quem fez. Vem de `req.user.userId`.
 *   `acao`/`entidade`: do vocabulário acima.
 *   `entidadeId`: qual — texto, porque nem toda entidade tem uuid. Nulável: a
 *   exportação de uma LISTA não tem um id, e é o gesto mais sensível da tabela.
 *   `antes`/`depois`: os dois nuláveis. Criação só tem `depois`, remoção só tem
 *   `antes`, alteração tem os dois, e uma exportação não tem nenhum — ali o
 *   `depois` guarda o filtro usado, que é o que responde "baixou a base inteira
 *   ou só a semana?".
 *
 * O AUTOR ENTRA POR SUBCONSULTA, e isso não é preciosismo: `admin_user_id`
 * referencia `canastra.clientes` (0035), e um uuid sem linha lá levantaria 23503
 * DENTRO da transação da ação — a auditoria derrubando a operação, exatamente o
 * que a 0035 recusou ao deixar `acao` sem CHECK. Com a subconsulta, autor
 * desconhecido vira log de autor NULO (que diz "uma conta que não existe mais
 * fez isto") mais um aviso no log do processo, e a ação segue.
 */
async function registrar(
  conexao,
  { adminUserId = null, acao, entidade, entidadeId = null, antes = null, depois = null },
) {
  const { rows } = await conexao.query(
    `INSERT INTO canastra.admin_log
       (admin_user_id, acao, entidade, entidade_id, antes, depois)
     VALUES (
       (SELECT user_id FROM canastra.clientes WHERE user_id = $1::uuid),
       $2, $3, $4, $5::jsonb, $6::jsonb
     )
     RETURNING id, admin_user_id`,
    [
      adminUserId || null,
      acao,
      entidade,
      entidadeId === null || entidadeId === undefined ? null : String(entidadeId),
      antes === null || antes === undefined ? null : JSON.stringify(antes),
      depois === null || depois === undefined ? null : JSON.stringify(depois),
    ],
  );

  if (adminUserId && !rows[0].admin_user_id) {
    console.warn(
      `AUDITORIA: "${acao}" registrada SEM autor — ${adminUserId} não tem linha ` +
        "em canastra.clientes. A ação foi preservada; o nome, não.",
    );
  }
  return rows[0].id;
}

module.exports = { registrar, ACOES, ENTIDADES };
