"use strict";

const pool = require("../pgPool");
const { ehUuid } = require("../utils/formatoUuid");
const { registrar, ACOES, ENTIDADES } = require("../services/adminLog");

/**
 * A moderação de avaliações (migração 0014) PELO EXPRESS.
 *
 * POR QUE A ROTA EXISTE, e o defeito que ela fecha tem nome: a tela legada de
 * Avaliações não passava por esta API — falava direto com o PostgREST e
 * dependia de RLS + GRANT de coluna. Lá, um não-admin executa o UPDATE e
 * atualiza ZERO linhas SEM ERRO NENHUM: é a semântica do `USING` de uma
 * política de RLS, que RECORTA o conjunto em vez de recusar a operação. Sem
 * pedir `count: "exact"` e conferi-lo, o toast anunciava sucesso e o banco
 * ficava intacto. Um painel com dois modelos de acesso tem esse defeito em
 * algum lugar por construção; com um só, a resposta sempre diz quantas linhas
 * mudaram DE VERDADE (`atualizadas`), e quem chama compara com o que pediu.
 *
 * `moderado_em` É ESCRITO À MÃO. Não há trigger de moddatetime neste schema
 * (regra desde 0005): quem atualiza carimba a data junto, ou a coluna mente.
 */

/**
 * O vocabulário de `status`, IGUAL ao CHECK `avaliacoes_status_valido` (0014).
 *
 * Conferido aqui para a recusa ter frase em vez de 23514 — e 'recusada', que é
 * o nome que todo mundo tenta primeiro, NÃO existe: a decisão da 0014 foi
 * `oculta`, porque a avaliação continua sendo do cliente e some da vitrine em
 * vez de ser negada.
 */
const STATUS_DE_AVALIACAO = Object.freeze(["pendente", "aprovada", "oculta"]);

/**
 * A projeção da moderação. `user_id` entra porque o painel precisa cruzar a
 * avaliação com o cliente (é a mesma pessoa de um chamado de suporte); ele NÃO
 * sai na leitura pública da vitrine, que é o recorte de coluna de `anon`.
 */
const COLUNAS = `
  id, sku, nota, titulo, texto, nome_exibicao, status, user_id,
  criado_em, moderado_em
`;

class AvaliacoesRepository {
  /**
   * A listagem da moderação: filtro, paginação e CONTAGEM.
   *
   * A contagem usa o mesmo WHERE da página — sem isso, a tela mostraria "1 de
   * 40" filtrando por 'pendente' numa base de 40 avaliações e ofereceria
   * páginas vazias.
   */
  async listar(query = {}) {
    const filtros = [];
    const values = [];

    const status = String(query.status || "").trim();
    if (status) {
      if (!STATUS_DE_AVALIACAO.includes(status)) {
        const erro = new Error(
          `Status inválido: "${status}". Use um de: ${STATUS_DE_AVALIACAO.join(", ")}.`,
        );
        erro.status = 400;
        throw erro;
      }
      values.push(status);
      filtros.push(`status = $${values.length}`);
    }

    const sku = String(query.sku || "").trim();
    if (sku) {
      values.push(sku);
      filtros.push(`sku = $${values.length}`);
    }

    // A busca olha o TEXTO da avaliação e o nome de quem escreveu: são os dois
    // caminhos por que a moderação chega ("aquela reclamação do café amassado",
    // "a avaliação da Ana").
    const q = String(query.q || "").trim();
    if (q) {
      values.push(`%${q}%`);
      const i = values.length;
      filtros.push(`(texto ILIKE $${i} OR titulo ILIKE $${i} OR nome_exibicao ILIKE $${i})`);
    }

    const where = filtros.length ? `WHERE ${filtros.join(" AND ")}` : "";
    const page = Math.max(1, Number.parseInt(query.page, 10) || 1);
    const limit = Math.min(100, Math.max(1, Number.parseInt(query.limit, 10) || 20));
    const offset = (page - 1) * limit;

    const contagem = await pool.query(
      `SELECT COUNT(*) FROM canastra.avaliacoes ${where}`,
      values,
    );
    const total = parseInt(contagem.rows[0].count, 10);

    const { rows } = await pool.query(
      `SELECT ${COLUNAS} FROM canastra.avaliacoes
       ${where}
       ORDER BY criado_em DESC
       LIMIT $${values.length + 1} OFFSET $${values.length + 2}`,
      [...values, limit, offset],
    );

    return { data: rows, total, totalPages: Math.ceil(total / limit), page };
  }

  /**
   * Moderação EM LOTE — a fila de aprovação se resolve marcando várias e
   * clicando uma vez, e uma ida por avaliação seria N requisições para um
   * gesto só.
   *
   * A resposta traz `pedidas` e `atualizadas`. A diferença entre as duas é
   * informação, não erro: um id que já saiu (avaliação apagada por exclusão de
   * conta) ou um id de outra loja simplesmente não casa, e a tela precisa
   * saber disso para não anunciar mais do que fez.
   */
  async moderar({ ids, status, adminUserId }) {
    if (!Array.isArray(ids) || ids.length === 0) {
      const erro = new Error("Informe as avaliações a moderar.");
      erro.status = 400;
      throw erro;
    }
    // Teto: um lote de 10 mil ids é uma consulta que trava a tabela inteira, e
    // nenhuma tela de moderação seleciona tanto.
    if (ids.length > 200) {
      const erro = new Error("Modere no máximo 200 avaliações por vez.");
      erro.status = 400;
      throw erro;
    }
    // MALFORMADO NÃO É INEXISTENTE: sem esta guarda o texto ia intacto para o
    // `$1::uuid[]` e o lote inteiro morria com 22P02 num 500 opaco.
    if (!ids.every(ehUuid)) {
      const erro = new Error("Há identificador de avaliação inválido no lote.");
      erro.status = 400;
      throw erro;
    }
    if (!STATUS_DE_AVALIACAO.includes(status)) {
      const erro = new Error(
        `Status inválido. Use um de: ${STATUS_DE_AVALIACAO.join(", ")}.`,
      );
      erro.status = 400;
      throw erro;
    }

    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      const { rows } = await client.query(
        `UPDATE canastra.avaliacoes
            SET status = $1, moderado_em = now()
          WHERE id = ANY($2::uuid[])
        RETURNING id, status`,
        [status, ids],
      );

      // O log é UM por lote, e não um por avaliação: o gesto foi um só, e N
      // linhas idênticas diriam a mesma coisa N vezes num relatório que se lê
      // por ordem cronológica.
      await registrar(client, {
        adminUserId,
        acao: ACOES.AVALIACOES_MODERADAS,
        entidade: ENTIDADES.AVALIACAO,
        // Sem `entidade_id`: a linha é sobre um conjunto. Os ids vão no `antes`,
        // que é o que responde "o que estava nesse lote?".
        entidadeId: null,
        antes: { ids },
        depois: { status, atualizadas: rows.length },
      });

      await client.query("COMMIT");
      return { pedidas: ids.length, atualizadas: rows.length };
    } catch (erro) {
      await client.query("ROLLBACK").catch(() => {});
      throw erro;
    } finally {
      client.release();
    }
  }
}

module.exports = new AvaliacoesRepository();
module.exports.STATUS_DE_AVALIACAO = STATUS_DE_AVALIACAO;
