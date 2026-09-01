const pool = require("../pgPool");
const { v4 } = require("uuid");
const { GRUPO_ATIVO } = require("../utils/statusDePedido");
// A MESMA forma de UUID de `conta.routes.js` e `lgpd.routes.js`: o id vem da
// URL e vira `$1` numa coluna `uuid`.
const { ehUuid } = require("../utils/formatoUuid");
const { registrar, ACOES, ENTIDADES } = require("../services/adminLog");

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
 *
 * A string VAZIA precisa de teste próprio, antes do `Number`: `Number('')` é
 * `0`, que é finito e não é negativo — passaria pelas duas guardas abaixo e
 * gravaria uma caixa de peso zero, que é a mesma cotação errada que este
 * arquivo tenta evitar. Campo em branco é ausência; quem quiser mesmo zerar
 * manda `0`.
 */
function numeroPositivo(valor, padrao) {
  if (valor === undefined || valor === null) return padrao;
  if (String(valor).trim() === "") return padrao;
  const n = Number(valor);
  if (!Number.isFinite(n) || n < 0) return padrao;
  return n;
}

/**
 * Peso e dimensões de uma caixa de café quando o formulário não os informa.
 *
 * Valem SÓ NA CRIAÇÃO. Na edição o padrão é o valor que já está no banco — ver
 * `editProduct`, e o porquê está lá: o formulário legado envia os quatro campos
 * sem ter input para nenhum deles, `undefined` vira a string `"undefined"` no
 * FormData, e aplicar estes números aqui em toda edição fazia a loja cotar
 * frete errado sem nenhum sinal na tela.
 */
const MEDIDAS_PADRAO = { weight: 0.3, width: 20, height: 5, length: 20 };

/**
 * Valida o que o painel manda ao cadastrar ou editar um produto.
 *
 * `padroesDeMedida` é o que vale quando peso/largura/altura/comprimento chegam
 * ausentes, vazios ou não-numéricos: os padrões da caixa na criação, e os
 * valores ATUAIS do produto na edição.
 */
function validarProduto(corpo, padroesDeMedida = MEDIDAS_PADRAO) {
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
      weight: numeroPositivo(corpo.weight, padroesDeMedida.weight),
      width: numeroPositivo(corpo.width, padroesDeMedida.width),
      height: numeroPositivo(corpo.height, padroesDeMedida.height),
      length: numeroPositivo(corpo.length, padroesDeMedida.length),
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
    const produtoId = v4();

    // A auditoria entra na MESMA transação da criação (ver services/adminLog):
    // ou o produto e o registro de quem o criou existem juntos, ou nenhum dos
    // dois. Antes disto, a criação saía commitada sozinha.
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(
        `INSERT INTO canastra.produtos
           (produto_id, nome, tamanho, categoria, preco, imagem, destacado_em,
            quantidade, descricao, peso, largura, altura, comprimento, sku)
         VALUES ($1, $2, $3, $4, $5, $6, now(), $7, $8, $9, $10, $11, $12, $13)`,
        [
          produtoId,
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

      await registrar(client, {
        adminUserId: request.user?.userId ?? null,
        acao: ACOES.PRODUTO_CRIADO,
        entidade: ENTIDADES.PRODUTO,
        entidadeId: produtoId,
        // Criação tem só `depois`, e ele guarda o que a pessoa DECIDIU — não a
        // linha inteira do banco: descrição longa e URL de imagem inflariam
        // todo relatório sem responder nenhuma pergunta de gestão.
        depois: {
          nome: valores.name,
          sku: valores.sku,
          preco: valores.price,
          quantidade: valores.quantity,
        },
      });

      await client.query("COMMIT");
      response.status(201).json({ message: "Produto criado com sucesso!" });
    } catch (err) {
      await client.query("ROLLBACK").catch(() => {});
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
    } finally {
      client.release();
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

  /**
   * 204 é "eu apaguei", e só o `rowCount` sabe disso.
   *
   * A versão anterior respondia 204 mesmo quando o DELETE não achava nada:
   * qualquer tela que confie no status para dizer "Produto deletado!" mentia —
   * e este painel já mentiu por motivo parecido, quando um 403 caía no caminho
   * de sucesso e a lista anunciava exclusão com o produto intacto.
   */
  async deleteProduct(request, response) {
    const { id } = request.params;

    /**
     * MALFORMADO NÃO É INEXISTENTE. Um id sem forma de uuid ia intacto para o
     * `$1` da coluna `uuid`, levantava 22P02 e virava 500 "Erro ao deletar
     * produto." — a frase de servidor quebrado para um pedido errado do
     * cliente. A guarda vem ANTES da consulta (nada de tratar 22P02 no catch):
     * assim o lixo não gasta conexão do pool nem enche o log do Postgres.
     *
     * O `catch` abaixo NÃO deixa de ser necessário: ele continua sendo o 500 de
     * verdade — banco fora, FK inesperada, permissão. O que sai dele é só o
     * caso em que a culpa era do pedido.
     */
    if (!ehUuid(id)) {
      return response
        .status(400)
        .json({ error: "Identificador de produto inválido." });
    }

    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      // `RETURNING` por NOME, nunca `*`: em `canastra.produtos` — a única
      // relação do schema com privilégio de SELECT por COLUNA — o `*` alcança
      // `custo` e responde 42501 até para a admin (0006). A lista explícita é
      // também o que decide o que vai para o log.
      const resultado = await client.query(
        `DELETE FROM canastra.produtos WHERE produto_id = $1
         RETURNING nome, sku, preco, quantidade`,
        [id],
      );
      if (resultado.rowCount === 0) {
        await client.query("ROLLBACK");
        return response.status(404).json({ error: "Produto não encontrado." });
      }

      // Remoção tem só `antes` — e é o único lugar onde o que o produto ERA
      // ainda existe: depois do COMMIT, a linha não está em lugar nenhum.
      await registrar(client, {
        adminUserId: request.user?.userId ?? null,
        acao: ACOES.PRODUTO_REMOVIDO,
        entidade: ENTIDADES.PRODUTO,
        entidadeId: id,
        antes: resultado.rows[0],
      });

      await client.query("COMMIT");
      response.status(204).send();
    } catch (err) {
      await client.query("ROLLBACK").catch(() => {});
      console.error("deleteProduct error:", err);
      response.status(500).json({ message: "Erro ao deletar produto." });
    } finally {
      client.release();
    }
  }

  /**
   * NA EDIÇÃO, O PADRÃO DE PESO E DIMENSÕES É O QUE JÁ ESTÁ NO BANCO.
   *
   * O formulário legado (GProducts/form/Form.jsx) envia `weight`, `width`,
   * `height` e `length` sem ter input para nenhum dos quatro: `undefined` vira
   * a string `"undefined"` no FormData, `Number("undefined")` é NaN, e a versão
   * anterior caía nos padrões da caixa (0,3 kg / 20 / 5 / 20 cm) em TODA
   * edição. Um produto de 1,2 kg voltava a 0,3 kg quando alguém corrigia o
   * preço, e a loja passava a cotar frete errado sem nenhum sinal na tela.
   *
   * O conserto mora AQUI, e não no formulário, porque aqui ele é durável: vale
   * para o painel legado, para a tela nova e para qualquer cliente futuro. Os
   * padrões de `MEDIDAS_PADRAO` continuam valendo só na CRIAÇÃO, onde não há
   * valor anterior a preservar.
   *
   * Por isso a leitura da linha vem ANTES da validação: é ela que traz os
   * padrões desta edição.
   */
  async editProduct(request, response) {
    const { id } = request.params;

    // MALFORMADO NÃO É INEXISTENTE, e aqui a guarda precede até a leitura da
    // linha atual (que é quem traz os padrões de peso e dimensão desta edição).
    //
    // A chave da resposta é `error`, como nas outras duas guardas de id, e não
    // o `message` que a validação de campos usa logo abaixo: o formulário
    // legado lê `corpo.message || corpo.error` (Form.jsx:207), então as duas
    // chegam à tela — e manter as três guardas de id iguais entre si vale mais
    // que casar com o vizinho de dentro deste método.
    if (!ehUuid(id)) {
      return response
        .status(400)
        .json({ error: "Identificador de produto inválido." });
    }

    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      // `nome`, `preco` e `quantidade` entram na leitura por causa do LOG: o
      // `antes` de uma alteração de preço é a metade que responde "quem mudou o
      // preço do micro-lote na sexta à noite, e de quanto para quanto?".
      // A linha é travada porque o `antes` tem de ser o valor que ESTA edição
      // substituiu — sem a trava, duas edições simultâneas gravariam dois logs
      // dizendo que partiram do mesmo número.
      const existing = await client.query(
        `SELECT imagem, sku, peso, largura, altura, comprimento,
                nome, preco, quantidade
           FROM canastra.produtos WHERE produto_id = $1 FOR UPDATE`,
        [id],
      );
      if (!existing.rows.length) {
        await client.query("ROLLBACK");
        return response.status(404).json({ error: "Produto não encontrado." });
      }
      const atual = existing.rows[0];

      // `numeric` volta do pg como STRING ("1.200"); sem o Number aqui, o
      // padrão entraria como texto e a comparação de "mudou algo?" mentiria.
      const { erros, valores } = validarProduto(request.body, {
        weight: Number(atual.peso),
        width: Number(atual.largura),
        height: Number(atual.altura),
        length: Number(atual.comprimento),
      });
      if (erros.length) {
        await client.query("ROLLBACK");
        return response.status(400).json({ message: erros.join(" ") });
      }

      const newImage = request.file ? request.file.path : atual.imagem;
      // Sem `sku` no corpo, o que está no banco fica: o SKU é a costura com o
      // catálogo editorial e não pode ser apagado por um formulário que ainda
      // nem tem o campo.
      const novoSku = request.body.sku !== undefined ? valores.sku : atual.sku;

      await client.query(
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

      await registrar(client, {
        adminUserId: request.user?.userId ?? null,
        acao: ACOES.PRODUTO_ALTERADO,
        entidade: ENTIDADES.PRODUTO,
        entidadeId: id,
        // Os dois lados guardam o MESMO conjunto de campos, e só os que
        // respondem pergunta de gestão: comparar `antes` com `depois` no
        // relatório tem de ser uma leitura, não um diff de objeto grande.
        antes: {
          nome: atual.nome,
          sku: atual.sku,
          preco: Number(atual.preco),
          quantidade: atual.quantidade,
        },
        depois: {
          nome: valores.name,
          sku: novoSku,
          preco: valores.price,
          quantidade: valores.quantity,
        },
      });

      await client.query("COMMIT");
      response.status(200).json({ message: "Produto editado com sucesso!" });
    } catch (err) {
      await client.query("ROLLBACK").catch(() => {});
      if (err.code === "23505") {
        return response
          .status(409)
          .json({ message: "Já existe um produto com este SKU." });
      }
      console.error("editProduct error:", err);
      response.status(500).json({ message: "Erro ao atualizar produto!" });
    } finally {
      client.release();
    }
  }

  async getProductById(request, response) {
    const { id } = request.params;

    // MALFORMADO NÃO É INEXISTENTE — o mesmo defeito de `deleteProduct`, e esta
    // é a rota PÚBLICA do trio (products.routes.js não põe `isAuthenticated`
    // nela): qualquer visitante alcança digitando na barra de endereço, e cada
    // tentativa virava um 22P02 no log parecendo incidente de banco.
    if (!ehUuid(id)) {
      return response
        .status(400)
        .json({ error: "Identificador de produto inválido." });
    }

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

  /**
   * `PATCH /dashboard/:id/estoque` — mexe na QUANTIDADE, e em nada mais.
   *
   * POR QUE UMA ROTA SÓ PARA ISSO. Até a Onda 4 o único caminho para corrigir
   * o estoque de um café era reenviar o formulário inteiro por multipart —
   * imagem incluída —, e é exatamente por esse caminho que as medidas do pacote
   * eram apagadas: o formulário legado envia `weight/width/height/length` sem
   * ter input para nenhum dos quatro, `undefined` vira a string "undefined" no
   * FormData, e a loja passa a cotar frete de uma caixa que não existe. O
   * `editProduct` acima já defende esse caso preservando o valor do banco, mas
   * a defesa certa para "ajustar o estoque" é não ter de mandar o resto.
   *
   * O UPDATE PROJETA COLUNA POR NOME NO `RETURNING`, e não `*`: em
   * `canastra.produtos` — a única relação do schema com privilégio de SELECT
   * por COLUNA — `RETURNING *` alcança `custo` e responde 42501 até para a
   * admin (0006). Aqui o pool conecta como dono e passaria, mas a regra é da
   * tabela e não da conexão: um dia em que esta rota rodar por outro papel, a
   * lista explícita é o que a mantém de pé.
   *
   * A LEITURA ANTERIOR É TRAVADA (`FOR UPDATE`) e mora na mesma transação da
   * escrita: o `antes` do log tem de ser o valor que ESTA operação substituiu.
   * Sem a trava, dois ajustes simultâneos gravariam dois logs dizendo que
   * partiram do mesmo número, e o histórico do produto passaria a mentir.
   */
  async ajustarEstoque(request, response) {
    const { id } = request.params;

    if (!ehUuid(id)) {
      return response
        .status(400)
        .json({ error: "Identificador de produto inválido." });
    }

    const quantidade = request.body?.quantity ?? request.body?.quantidade;
    if (
      quantidade === undefined ||
      quantidade === null ||
      String(quantidade).trim() === "" ||
      !Number.isInteger(Number(quantidade)) ||
      Number(quantidade) < 0
    ) {
      return response.status(400).json({
        message: "Estoque deve ser um número inteiro igual ou maior que zero.",
      });
    }
    const novaQuantidade = Number(quantidade);

    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      const atual = await client.query(
        `SELECT quantidade FROM canastra.produtos
          WHERE produto_id = $1 FOR UPDATE`,
        [id],
      );
      if (!atual.rows.length) {
        await client.query("ROLLBACK");
        return response.status(404).json({ error: "Produto não encontrado." });
      }
      const antes = atual.rows[0].quantidade;

      const { rows } = await client.query(
        `UPDATE canastra.produtos SET quantidade = $1
          WHERE produto_id = $2
        RETURNING produto_id AS product_id, quantidade AS quantity`,
        [novaQuantidade, id],
      );

      await registrar(client, {
        adminUserId: request.user?.userId ?? null,
        acao: ACOES.PRODUTO_ESTOQUE_AJUSTADO,
        entidade: ENTIDADES.PRODUTO,
        entidadeId: id,
        antes: { quantidade: antes },
        depois: { quantidade: novaQuantidade },
      });

      await client.query("COMMIT");
      return response.status(200).json(rows[0]);
    } catch (err) {
      await client.query("ROLLBACK").catch(() => {});
      console.error("ajustarEstoque error:", err);
      return response.status(500).json({ message: "Erro ao ajustar o estoque." });
    } finally {
      client.release();
    }
  }

  /**
   * `GET /admin/produtos/:id/custo` — a rota que a migração 0006 encomendou.
   *
   * `produtos.custo` ficou FORA do `GRANT SELECT (…)` de coluna daquela
   * migração de propósito: com a instância Supabase compartilhada, dar a coluna
   * a `authenticated` seria entregar a margem da loja a qualquer token da VPS —
   * inclusive de outro projeto. O troco, que 0006 escreveu e adiou "para a
   * tarefa que construir o painel", é que nem a admin lê `custo` pelo PostgREST,
   * porque privilégio de coluna é por PAPEL e ela autentica como
   * `authenticated` igual a todo mundo.
   *
   * ESTA É A TAREFA. O caminho escolhido é o que a spec §7-C fixou: rota admin
   * no Express, que conecta como DONO do banco — sem RLS e sem privilégio de
   * coluna no caminho —, com `isAuthenticated` + `isAdmin` na frente fazendo o
   * porteiro. A alternativa (uma função SECURITY DEFINER com `eh_admin()`)
   * daria o mesmo resultado por um caminho que o painel não usa para mais nada.
   *
   * O PREÇO VEM JUNTO no corpo porque custo sozinho não responde a pergunta que
   * se faz olhando para ele ("dá margem?"), e buscá-lo numa segunda ida seria
   * duas idas para uma linha só.
   */
  async getCusto(request, response) {
    const { id } = request.params;
    if (!ehUuid(id)) {
      return response
        .status(400)
        .json({ error: "Identificador de produto inválido." });
    }

    try {
      const { rows } = await pool.query(
        `SELECT produto_id AS product_id, sku, nome AS name,
                preco AS price, custo
           FROM canastra.produtos WHERE produto_id = $1`,
        [id],
      );
      if (!rows.length) {
        return response.status(404).json({ error: "Produto não encontrado." });
      }
      return response.status(200).json(rows[0]);
    } catch (err) {
      console.error("getCusto error:", err);
      return response.status(500).json({ message: "Erro ao buscar o custo." });
    }
  }

  /**
   * `PATCH /admin/produtos/:id/custo` — e ela existe pelo mesmo motivo da
   * leitura, do outro lado: sem uma rota de escrita o custo continuaria sendo
   * um número que só o `psql` sabe mudar. O formulário de produto NÃO o envia
   * (nem envia hoje, nem passa a enviar aqui): custo não é campo de catálogo, é
   * de gestão, e misturá-lo ao `PUT /dashboard/:id` faria toda edição de preço
   * carregar a margem junto — com o risco de zerá-la quando o campo viesse
   * vazio, que é o defeito que `PUT /config` já demonstrou nesta loja.
   */
  async atualizarCusto(request, response) {
    const { id } = request.params;
    if (!ehUuid(id)) {
      return response
        .status(400)
        .json({ error: "Identificador de produto inválido." });
    }

    const bruto = request.body?.custo;
    const custo = Number(bruto);
    if (
      bruto === undefined ||
      bruto === null ||
      String(bruto).trim() === "" ||
      !Number.isFinite(custo) ||
      custo < 0 ||
      custo > 1_000_000
    ) {
      return response
        .status(400)
        .json({ message: "Custo inválido: informe um valor em reais, não negativo." });
    }

    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      const atual = await client.query(
        "SELECT custo FROM canastra.produtos WHERE produto_id = $1 FOR UPDATE",
        [id],
      );
      if (!atual.rows.length) {
        await client.query("ROLLBACK");
        return response.status(404).json({ error: "Produto não encontrado." });
      }

      const { rows } = await client.query(
        `UPDATE canastra.produtos SET custo = $1
          WHERE produto_id = $2
        RETURNING produto_id AS product_id, custo`,
        [custo, id],
      );

      await registrar(client, {
        adminUserId: request.user?.userId ?? null,
        acao: ACOES.PRODUTO_CUSTO_ALTERADO,
        entidade: ENTIDADES.PRODUTO,
        entidadeId: id,
        antes: { custo: Number(atual.rows[0].custo) },
        depois: { custo },
      });

      await client.query("COMMIT");
      return response.status(200).json(rows[0]);
    } catch (err) {
      await client.query("ROLLBACK").catch(() => {});
      console.error("atualizarCusto error:", err);
      return response.status(500).json({ message: "Erro ao atualizar o custo." });
    } finally {
      client.release();
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
