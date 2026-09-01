const pool = require("../pgPool");
const { v4 } = require("uuid");
const { registrar, ACOES, ENTIDADES } = require("../services/adminLog");

/**
 * Valores de filtro do painel, contra `canastra.produto_opcoes`.
 *
 * A TABELA FALA PORTUGUÊS, O CONTRATO FALA INGLÊS — inclusive nos VALORES de
 * `tipo`: o seed grava `('categoria', ...)` e `('tamanho', ...)`, enquanto o
 * painel legado pergunta `/options?type=category` e `/options?type=size`
 * (ManageCategories.jsx) e o formulário de produto envia `type: "category"`.
 * A tradução acontece aqui, nos dois sentidos, num lugar só.
 */

const TIPO_DO_CONTRATO = { category: "categoria", size: "tamanho" };
const CONTRATO_DO_TIPO = { categoria: "category", tamanho: "size" };

/** A coluna de `canastra.produtos` que cada tipo de opção referencia. */
const COLUNA_DO_TIPO = { categoria: "categoria", tamanho: "tamanho" };

class OptionsRepository {
  async getOptions(req, res) {
    const { type } = req.query;

    try {
      let rows;
      if (type) {
        const tipo = TIPO_DO_CONTRATO[type];
        // Tipo que o contrato não conhece: lista vazia, como o painel espera
        // de um filtro sem valores — não um 500.
        if (!tipo) return res.status(200).json([]);
        ({ rows } = await pool.query(
          `SELECT id, tipo, valor AS value FROM canastra.produto_opcoes
            WHERE tipo = $1 ORDER BY valor ASC`,
          [tipo],
        ));
      } else {
        ({ rows } = await pool.query(
          `SELECT id, tipo, valor AS value FROM canastra.produto_opcoes
            ORDER BY tipo, valor ASC`,
        ));
      }

      res.status(200).json(
        rows.map(({ id, tipo, value }) => ({
          id,
          type: CONTRATO_DO_TIPO[tipo] || tipo,
          value,
        })),
      );
    } catch (err) {
      console.error("getOptions:", err);
      res.status(500).json({ error: "Erro ao buscar opções" });
    }
  }

  async addOption(req, res) {
    const { type, value } = req.body;
    const tipo = TIPO_DO_CONTRATO[type];
    const valor = String(value ?? "").trim();

    if (!tipo || !valor) {
      return res.status(400).json({
        error: "Informe type ('category' ou 'size') e um value não vazio.",
      });
    }

    const id = v4();
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(
        "INSERT INTO canastra.produto_opcoes (id, tipo, valor) VALUES ($1, $2, $3)",
        [id, tipo, valor],
      );
      // O valor de filtro é a costura entre catálogo e vitrine: criar
      // "Especial" e "especial" parte a mesma prateleira em duas, e sem log não
      // há como saber quem criou qual.
      await registrar(client, {
        adminUserId: req.user?.userId ?? null,
        acao: ACOES.OPCAO_CRIADA,
        entidade: ENTIDADES.OPCAO,
        entidadeId: id,
        depois: { tipo, valor },
      });
      await client.query("COMMIT");
      res.status(201).json({ message: "Opção adicionada com sucesso!" });
    } catch (err) {
      await client.query("ROLLBACK").catch(() => {});
      // O UNIQUE (tipo, valor) de 0003 pegando a duplicata é pedido repetido,
      // não erro do servidor.
      if (err.code === "23505") {
        return res.status(409).json({ error: "Esta opção já existe." });
      }
      console.error("addOption:", err);
      res.status(500).json({ error: "Erro ao adicionar opção" });
    } finally {
      client.release();
    }
  }

  async deleteOption(req, res) {
    const { id } = req.params;

    try {
      const optionRes = await pool.query(
        "SELECT tipo, valor FROM canastra.produto_opcoes WHERE id = $1",
        [id],
      );
      if (optionRes.rows.length === 0) {
        return res.status(404).json({ error: "Opção não encontrada." });
      }

      const { tipo, valor } = optionRes.rows[0];
      const coluna = COLUNA_DO_TIPO[tipo];

      if (coluna) {
        const conflito = await pool.query(
          `SELECT 1 FROM canastra.produtos WHERE ${coluna} = $1 LIMIT 1`,
          [valor],
        );
        if (conflito.rows.length > 0) {
          return res.status(409).json({
            error: "Não é possível excluir.",
            message: `Existem produtos cadastrados com ${
              tipo === "categoria" ? "a categoria" : "o tamanho"
            } "${valor}". Remova ou edite os produtos antes de excluir esta opção.`,
          });
        }
      }

      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        await client.query("DELETE FROM canastra.produto_opcoes WHERE id = $1", [id]);
        await registrar(client, {
          adminUserId: req.user?.userId ?? null,
          acao: ACOES.OPCAO_REMOVIDA,
          entidade: ENTIDADES.OPCAO,
          entidadeId: id,
          // Remoção tem só `antes`, e aqui ele é o único lugar onde o valor
          // apagado sobrevive: a linha some do banco no COMMIT.
          antes: { tipo, valor },
        });
        await client.query("COMMIT");
      } catch (erro) {
        await client.query("ROLLBACK").catch(() => {});
        throw erro;
      } finally {
        client.release();
      }
      res.status(204).send();
    } catch (err) {
      console.error("deleteOption:", err);
      res.status(500).json({ error: "Erro ao deletar opção" });
    }
  }
}

module.exports = OptionsRepository;
