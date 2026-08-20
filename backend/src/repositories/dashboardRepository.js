const pool = require("../pgPool");
const { v4 } = require("uuid");
const { GRUPO_ATIVO } = require("../utils/statusDePedido");

/**
 * Catálogo do painel, contra `canastra.produtos`.
 *
 * O CONTRATO HTTP NÃO MUDA DE FORMA (decisão 2 do plano mestre): o painel
 * legado e a vitrine (`frontend/lib/catalogo/repositorio.ts`) continuam
 * recebendo `product_id`, `name`, `price`, `quantity`, `timestamp`... O que
 * muda é o SQL, que agora aponta para as colunas em português criadas em
 * 0003. `timestamp` sai de `destacado_em` — o eixo "novidades" do painel,
 * exatamente o papel que a coluna antiga cumpria.
 */

const COLUNAS_DO_CONTRATO = `
  produto_id   AS product_id,
  sku,
  nome         AS name,
  tamanho      AS size,
  categoria    AS category,
  preco        AS price,
  imagem       AS image,
  destacado_em AS "timestamp",
  quantidade   AS quantity,
  descricao    AS description,
  peso         AS weight,
  largura      AS width,
  altura       AS height,
  comprimento  AS length
`;

/**
 * Número positivo com valor padrão. `Number("abc")` é NaN — e NaN passa num
 * `?`, então ia para o banco; e nada impedia valor NEGATIVO, que num preço
 * significa produto que paga o cliente para levar.
 */
function numeroPositivo(valor, padrao) {
  const n = Number(valor);
  if (!Number.isFinite(n) || n < 0) return padrao;
  return n;
}

/** Valida o que o painel manda ao cadastrar ou editar um produto. */
function validarProduto(corpo) {
  const erros = [];

  const nome = String(corpo.name ?? "").trim();
  if (nome.length < 2) erros.push("O nome do produto é obrigatório.");
  if (nome.length > 200) erros.push("O nome do produto é longo demais.");

  const preco = Number(corpo.price);
  if (!Number.isFinite(preco) || preco < 0) {
    erros.push("Preço inválido.");
  } else if (preco > 1_000_000) {
    // Teto contra erro de digitação: um zero a mais no painel vira um produto
    // de um milhão de reais na vitrine.
    erros.push("Preço acima do limite permitido.");
  }

  const estoque = Number(corpo.quantity);
  if (!Number.isInteger(estoque) || estoque < 0) {
    erros.push("Estoque deve ser um número inteiro igual ou maior que zero.");
  }

  return {
    erros,
    valores: {
      name: nome,
      size: corpo.size ? String(corpo.size).trim() : null,
      category: corpo.category ? String(corpo.category).trim() : null,
      price: preco,
      quantity: estoque,
      description: corpo.description ? String(corpo.description) : "",
      weight: numeroPositivo(corpo.weight, 0.3),
      width: numeroPositivo(corpo.width, 20),
      height: numeroPositivo(corpo.height, 5),
      length: numeroPositivo(corpo.length, 20),
      // O SKU é a chave que costura vitrine e banco (0003). O formulário do
      // painel ainda não o envia (Onda 2E), mas o contrato já o aceita.
      sku: corpo.sku ? String(corpo.sku).trim() : null,
    },
  };
}

class DashboardRepository {
  async createProduct(request, response) {
    const { erros, valores } = validarProduto(request.body);
    if (erros.length) {
      return response.status(400).json({ message: erros.join(" ") });
    }

    const image = request.file ? request.file.path : null;

    try {
      await pool.query(
        `INSERT INTO canastra.produtos
           (produto_id, nome, tamanho, categoria, preco, imagem, destacado_em,
            quantidade, descricao, peso, largura, altura, comprimento, sku)
         VALUES ($1, $2, $3, $4, $5, $6, now(), $7, $8, $9, $10, $11, $12, $13)`,
        [
          v4(),
          valores.name,
          valores.size,
          valores.category,
          valores.price,
          image,
          valores.quantity,
          valores.description,
          valores.weight,
          valores.width,
          valores.height,
          valores.length,
          valores.sku,
        ],
      );

      response.status(201).json({ message: "Produto criado com sucesso!" });
    } catch (err) {
      // `produtos_sku_idx` é único: SKU repetido é conflito do pedido, não
      // erro do servidor.
      if (err.code === "23505") {
        return response
          .status(409)
          .json({ message: "Já existe um produto com este SKU." });
      }
      // O objeto de erro do `pg` traz a query e o nome das colunas; devolvê-lo
      // ao navegador entrega o schema do banco a quem estiver olhando.
      console.error("createProduct error:", err);
      response.status(500).json({ message: "Erro ao criar o produto." });
    }
  }

  async getProducts(request, response) {
    const { category, size, onlyOld } = request.query;
    let page = parseInt(request.query.page) || 1;
    // Teto de 200: `?limit=999999` faria o painel puxar o catálogo inteiro
    // numa resposta só. A vitrine usa exatamente 200 (repositorio.ts).
    let limit = Math.min(200, Math.max(1, parseInt(request.query.limit) || 10));

    try {
      const filters = [];
      const values = [];

      if (category) {
        filters.push(`categoria = $${values.length + 1}`);
        values.push(category);
      }

      if (size) {
        filters.push(`tamanho = $${values.length + 1}`);
        values.push(size);
      }

      if (onlyOld === "true") {
        filters.push(`destacado_em < now() - INTERVAL '5 days'`);
      }

      if (request.query.onlyNew === "true") {
        filters.push(`destacado_em >= now() - INTERVAL '5 days'`);
      }

      const qRaw = (request.query.q || "").trim();
      let rankSelect = null;
      if (qRaw) {
        const terms = qRaw
          .split(/\s+/)
          .map((t) => t.replace(/[^\p{L}\p{N}_-]/gu, "").trim())
          .filter(Boolean);

        if (terms.length > 0) {
          const tsQuery = terms.map((t) => `${t}:*`).join(" & ");

          const qIdx = values.length + 1;
          const ilikeIdx = qIdx + 1;

          // A coluna gerada `tsv` (0003) indexa nome, categoria, tamanho e
          // descrição com a configuração 'portuguese' — a mesma daqui, senão
          // o índice GIN não é usado.
          filters.push(
            `(tsv @@ to_tsquery('portuguese', $${qIdx}) OR nome ILIKE $${ilikeIdx})`,
          );

          rankSelect = `ts_rank_cd(tsv, to_tsquery('portuguese', $${qIdx})) AS rank`;

          values.push(tsQuery, `%${qRaw}%`);
        } else {
          const qIdx = values.length + 1;
          filters.push(`nome ILIKE $${qIdx}`);
          values.push(`%${qRaw}%`);
        }
      }

      const whereClause = filters.length
        ? `WHERE ${filters.join(" AND ")}`
        : "";

      const countResult = await pool.query(
        `SELECT COUNT(*) FROM canastra.produtos ${whereClause}`,
        values,
      );
      const total = parseInt(countResult.rows[0].count);
      const totalPages = Math.ceil(total / limit);

      if (page < 1) page = 1;
      if (page > totalPages) page = totalPages || 1;
      const offset = (page - 1) * limit;

      const selectFields = [COLUNAS_DO_CONTRATO];
      if (rankSelect) selectFields.push(rankSelect);

      // Com busca, o rank calculado MANDA na ordem — senão o resultado mais
      // relevante afunda atrás do produto destacado mais recente e a busca
      // parece quebrada. Sem busca, não há rank nem no SELECT.
      const ordem = rankSelect
        ? "rank DESC, destacado_em DESC"
        : "destacado_em DESC";

      const result = await pool.query(
        `SELECT ${selectFields.join(", ")}
           FROM canastra.produtos
           ${whereClause}
          ORDER BY ${ordem}
          LIMIT $${values.length + 1} OFFSET $${values.length + 2}`,
        [...values, limit, offset],
      );

      return response.status(200).json({
        products: result.rows,
        total,
        totalPages,
        page,
      });
    } catch (err) {
      console.error("getProducts error:", err);
      return response.status(500).json({ message: "Erro ao buscar produtos!" });
    }
  }

  async deleteProduct(request, response) {
    const { id } = request.params;

    try {
      await pool.query("DELETE FROM canastra.produtos WHERE produto_id = $1", [
        id,
      ]);
      response.status(204).send();
    } catch (err) {
      console.error("deleteProduct error:", err);
      response.status(500).json({ message: "Erro ao deletar produto." });
    }
  }

  async editProduct(request, response) {
    const { erros, valores } = validarProduto(request.body);
    if (erros.length) {
      return response.status(400).json({ message: erros.join(" ") });
    }
    const { id } = request.params;

    try {
      const existing = await pool.query(
        "SELECT imagem, sku FROM canastra.produtos WHERE produto_id = $1",
        [id],
      );
      if (!existing.rows.length) {
        return response.status(404).json({ error: "Produto não encontrado." });
      }

      const newImage = request.file ? request.file.path : existing.rows[0].imagem;
      // Sem `sku` no corpo, o que está no banco fica: o SKU é a costura com o
      // catálogo editorial e não pode ser apagado por um formulário que ainda
      // nem tem o campo.
      const novoSku = request.body.sku !== undefined ? valores.sku : existing.rows[0].sku;

      await pool.query(
        `UPDATE canastra.produtos
            SET nome = $1, tamanho = $2, categoria = $3, preco = $4, imagem = $5,
                quantidade = $6, descricao = $7, peso = $8, largura = $9,
                altura = $10, comprimento = $11, sku = $12
          WHERE produto_id = $13`,
        [
          valores.name,
          valores.size,
          valores.category,
          valores.price,
          newImage,
          valores.quantity,
          valores.description,
          valores.weight,
          valores.width,
          valores.height,
          valores.length,
          novoSku,
          id,
        ],
      );

      response.status(200).json({ message: "Produto editado com sucesso!" });
    } catch (err) {
      if (err.code === "23505") {
        return response
          .status(409)
          .json({ message: "Já existe um produto com este SKU." });
      }
      console.error("editProduct error:", err);
      response.status(500).json({ message: "Erro ao atualizar produto!" });
    }
  }

  async getProductById(request, response) {
    const { id } = request.params;
    try {
      const { rows } = await pool.query(
        `SELECT ${COLUNAS_DO_CONTRATO} FROM canastra.produtos
          WHERE produto_id = $1`,
        [id],
      );

      if (!rows.length) {
        return response.status(404).json({ error: "Produto não encontrado." });
      }

      return response.status(200).json(rows[0]);
    } catch (err) {
      console.error("getProductById error:", err);
      return response.status(500).json({ message: "Erro ao buscar produto." });
    }
  }

  async getDashboardSummary() {
    const [produtosRes, pedidosRes, clientesRes] = await Promise.all([
      pool.query("SELECT COUNT(*) FROM canastra.produtos"),
      pool.query("SELECT COUNT(*) FROM canastra.pedidos"),
      pool.query("SELECT COUNT(*) FROM canastra.clientes"),
    ]);

    const counts = {
      products: Number(produtosRes.rows[0].count),
      orders: Number(pedidosRes.rows[0].count),
      users: Number(clientesRes.rows[0].count),
    };

    // Vendas dos últimos 7 dias. "Venda real" = pedido do grupo ATIVO que não
    // está só aguardando pagamento — o mesmo recorte da versão anterior
    // (approved/delivered/sent/in_process), agora em português e derivado da
    // lista única de status para não divergir quando ela mudar.
    const statusDeVenda = GRUPO_ATIVO.filter(
      (s) => s !== "pendente" && s !== "autorizado",
    );
    const salesRes = await pool.query(
      `SELECT
         TO_CHAR(criado_em, 'DD/MM') AS day,
         SUM(total)                  AS total
       FROM canastra.pedidos
       WHERE criado_em >= now() - INTERVAL '7 days'
         AND status = ANY($1)
       GROUP BY day
       ORDER BY MIN(criado_em) ASC`,
      [statusDeVenda],
    );

    const statusRes = await pool.query(
      `SELECT status, COUNT(*) AS count
       FROM canastra.pedidos
       GROUP BY status`,
    );

    return {
      counts,
      salesChart: salesRes.rows,
      statusChart: statusRes.rows,
    };
  }
}

module.exports = DashboardRepository;
