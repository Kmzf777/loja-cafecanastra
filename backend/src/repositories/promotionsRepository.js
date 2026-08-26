const pool = require("../pgPool");
const { v4: uuidv4 } = require("uuid");
// A MESMA forma de UUID de `conta.routes.js` e `lgpd.routes.js`, e pelo mesmo
// motivo: o identificador vem de fora e vira `$1` numa coluna `uuid`. Este
// módulo faz a pergunta duas vezes — no `:id` da URL (updatePromotion) e no
// `product_id` do corpo (createPromotion) —, e as duas passam por aqui: era a
// segunda que carregava uma cópia literal da regex, e cópia divergindo é
// questão de tempo, como `utils/formatoUuid.js` já explica.
const { ehUuid } = require("../utils/formatoUuid");

/**
 * Promoções, contra `canastra.promocoes`. O contrato HTTP segue o que o
 * PromotionsManager.jsx do painel legado envia e lê (`title`, `type`,
 * `value`, `applies_to`, `start_date`...); o mapa para as colunas em
 * português (`titulo`, `tipo`, `valor`, `aplica_a`, `inicio_em`...) vive
 * nos SELECTs e INSERTs daqui.
 */

const COLUNAS_DO_CONTRATO = `
  id,
  titulo     AS title,
  descricao  AS description,
  tipo       AS type,
  valor      AS value,
  aplica_a   AS applies_to,
  categoria  AS category,
  produto_id AS product_id,
  inicio_em  AS start_date,
  fim_em     AS end_date,
  ativa      AS active,
  criada_em  AS created_at
`;

/**
 * Valida tipo e valor do desconto — inalterado da versão anterior, porque a
 * regra protege dinheiro: um percentual acima de 100 fazia o checkout calcular
 * preço NEGATIVO, que abatia dos outros itens do carrinho.
 */
function validarDesconto(type, value) {
  const n = Number(value);

  if (!Number.isFinite(n) || n <= 0) {
    return "O valor do desconto precisa ser um número maior que zero.";
  }
  if (type === "percent" && n > 90) {
    // Teto de 90%: acima disso quase certamente é engano, e um "100%"
    // liberaria o produto de graça para todo mundo que abrisse a loja.
    return "Desconto percentual acima de 90% não é permitido.";
  }
  if (type !== "percent" && type !== "fixed") {
    return "Tipo de desconto inválido. Use 'percent' ou 'fixed'.";
  }
  return null;
}

/**
 * O datetime-local do painel manda "" quando o campo fica vazio, e "" não é
 * timestamptz: a versão antiga estourava 22007 no INSERT. Vazio vira NULL —
 * e promoção sem data não entra no checkout (o filtro de ativas exige as
 * duas datas, comportamento herdado do legado e mantido).
 */
const dataOuNull = (valor) => (valor ? valor : null);

class PromotionsRepository {
  async createPromotion(request, response) {
    const {
      title,
      description,
      type,
      value,
      applies_to,
      category,
      product_id,
      start_date,
      end_date,
    } = request.body;

    try {
      if (!title || !value || !type) {
        return response
          .status(400)
          .json({ error: "Campos obrigatórios faltando." });
      }

      const erroDeDesconto = validarDesconto(type, value);
      if (erroDeDesconto) {
        return response.status(400).json({ error: erroDeDesconto });
      }

      const categoryFixed = applies_to === "category" ? category : null;
      let productIdFixed = null;
      if (applies_to === "product") {
        // `ehUuid` já embute o `String(... || "")`, então `undefined`, `null` e
        // `""` respondem false sem precisar do teste separado que estava aqui.
        if (!ehUuid(product_id)) {
          return response.status(400).json({
            error:
              "Para promoção por produto, você deve fornecer o ID (UUID) válido do produto.",
          });
        }
        productIdFixed = product_id;
      }

      await pool.query(
        `INSERT INTO canastra.promocoes (
           id, titulo, descricao, tipo, valor, aplica_a,
           categoria, produto_id, inicio_em, fim_em, ativa
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
        [
          uuidv4(),
          title,
          description,
          type,
          value,
          applies_to,
          categoryFixed,
          productIdFixed,
          dataOuNull(start_date),
          dataOuNull(end_date),
          true,
        ],
      );
      response.status(201).json({ message: "Promoção criada com sucesso." });
    } catch (err) {
      console.error("createPromotion:", err);
      response.status(500).json({ error: "Erro ao criar promoção." });
    }
  }

  async getPromotions(request, response) {
    try {
      const result = await pool.query(
        `SELECT ${COLUNAS_DO_CONTRATO} FROM canastra.promocoes
          ORDER BY criada_em DESC`,
      );
      response.status(200).json(result.rows);
    } catch (err) {
      console.error("getPromotions:", err);
      response.status(500).json({ error: "Erro ao buscar promoções." });
    }
  }

  /**
   * O PUT é PARCIAL: só as colunas que vieram no corpo são escritas.
   *
   * A versão anterior escrevia TODAS as colunas com o que veio no corpo, então
   * um campo AUSENTE virava `NULL` — um formulário que enviasse só o campo
   * alterado apagava descrição, valor, datas e categoria. O painel legado
   * escapava por acidente (PromotionsManager.jsx:124 monta sempre o objeto
   * inteiro, inclusive no toggle de ativo), e continua escapando: mandar tudo
   * num UPDATE parcial dá exatamente o mesmo resultado de antes.
   *
   * E a rota respondia 200 "Promoção atualizada." tendo atualizado ZERO linhas,
   * o que faz um id inexistente parecer sucesso. Agora `rowCount === 0` é 404.
   */
  async updatePromotion(request, response) {
    const { id } = request.params;

    /**
     * MALFORMADO NÃO É INEXISTENTE, e antes disto os dois davam respostas
     * trocadas: o id que não existe já respondia 404 (logo abaixo), e o id que
     * não tem FORMA de uuid chegava ao `$1` da consulta, levantava 22P02
     * ("invalid input syntax for type uuid") e caía no `catch` como 500 "Erro ao
     * atualizar promoção." — a frase de servidor quebrado para um pedido errado
     * do cliente. O gestor lia "erro interno", e o log enchia de 22P02 que
     * parecem incidente de banco.
     *
     * A guarda é ANTES da consulta, e não um `if (err.code === '22P02')` no
     * catch: assim o lixo não gasta conexão do pool nem deixa rastro no log do
     * Postgres. `test/painel_repositorios.test.js` afirma as duas coisas — o
     * 400 e o "nenhuma consulta saiu".
     */
    if (!ehUuid(id)) {
      return response
        .status(400)
        .json({ error: "Identificador de promoção inválido." });
    }

    const corpo = request.body || {};
    const veio = (campo) => Object.prototype.hasOwnProperty.call(corpo, campo);

    /**
     * `campo do corpo` → `coluna, valor a gravar`, na mesma tradução do
     * COLUNAS_DO_CONTRATO. `category` e `product_id` continuam virando NULL
     * quando chegam vazios porque é assim que o painel diz "esta promoção não é
     * por categoria/produto" — string vazia não é chave de nada.
     */
    const MAPA = {
      title: ["titulo", (v) => v],
      description: ["descricao", (v) => v],
      type: ["tipo", (v) => v],
      value: ["valor", (v) => v],
      applies_to: ["aplica_a", (v) => v],
      category: ["categoria", (v) => v || null],
      product_id: ["produto_id", (v) => v || null],
      start_date: ["inicio_em", dataOuNull],
      end_date: ["fim_em", dataOuNull],
      active: ["ativa", (v) => v],
    };

    const atribuicoes = [];
    const values = [];
    for (const [campo, [coluna, converter]] of Object.entries(MAPA)) {
      if (!veio(campo)) continue;
      values.push(converter(corpo[campo]));
      atribuicoes.push(`${coluna} = $${values.length}`);
    }

    if (!atribuicoes.length) {
      return response
        .status(400)
        .json({ error: "Nenhum campo para atualizar." });
    }

    try {
      // A validação de desconto precisa do PAR completo (tipo e valor): editar
      // só o `value` de uma promoção percentual tem de continuar barrando 150%,
      // e o tipo, nesse PUT, só existe no banco. Por isso a leitura vem antes —
      // ela também é a que distingue "id inexistente" de "nada mudou".
      const atual = await pool.query(
        "SELECT tipo, valor FROM canastra.promocoes WHERE id = $1",
        [id],
      );
      if (!atual.rows.length) {
        return response.status(404).json({ error: "Promoção não encontrada." });
      }

      // A mesma regra do cadastro vale na edição: sem isto, dava para criar uma
      // promoção válida e depois editá-la para 150%. Só roda quando o PUT mexe
      // em tipo ou valor — um toggle de `ativa` não pode ser recusado por causa
      // de uma linha antiga que já estava fora da regra.
      if (veio("type") || veio("value")) {
        const erroDeDesconto = validarDesconto(
          veio("type") ? corpo.type : atual.rows[0].tipo,
          veio("value") ? corpo.value : atual.rows[0].valor,
        );
        if (erroDeDesconto) {
          return response.status(400).json({ error: erroDeDesconto });
        }
      }

      values.push(id);
      const resultado = await pool.query(
        `UPDATE canastra.promocoes SET ${atribuicoes.join(", ")}
          WHERE id = $${values.length}`,
        values,
      );

      // A linha existia na leitura acima e sumiu antes do UPDATE: 404 também,
      // porque "atualizada" continuaria sendo mentira.
      if (resultado.rowCount === 0) {
        return response.status(404).json({ error: "Promoção não encontrada." });
      }

      response.status(200).json({ message: "Promoção atualizada." });
    } catch (err) {
      console.error("updatePromotion:", err);
      response.status(500).json({ error: "Erro ao atualizar promoção." });
    }
  }

  /**
   * As promoções que o CHECKOUT aplica agora. Já saem no formato que o
   * PaymentController consome (`type`, `value`, `applies_to`, `category`,
   * `product_id`), para o cálculo de desconto não conhecer coluna de banco.
   *
   * As duas datas continuam obrigatórias para a promoção valer — semântica
   * herdada do legado (`start_date <= NOW() AND end_date >= NOW()`), mantida
   * para o vocabulário do painel não mudar de significado nesta onda.
   */
  async findActivePromotionsForCheckout() {
    const result = await pool.query(
      `SELECT ${COLUNAS_DO_CONTRATO} FROM canastra.promocoes
        WHERE ativa = true
          AND inicio_em <= now()
          AND fim_em >= now()`,
    );
    return result.rows;
  }
}

module.exports = PromotionsRepository;
