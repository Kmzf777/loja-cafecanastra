const pool = require("../pgPool");
const cuponsRepository = require("../repositories/cuponsRepository");
const PromotionsRepository = require("../repositories/promotionsRepository");
const { avaliarCupom, normalizarCodigo } = require("../utils/cupom");
const { precoComPromocao, somarCentavos } = require("../utils/preco");

const promotionsRepo = new PromotionsRepository();

const FORMATO_UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** O mesmo formato do CHECK `cupons_codigo_formato` (0010), conferido ANTES do
 *  banco para a recusa ter frase em vez de 23514. */
const FORMATO_CODIGO = /^[A-Z0-9]{3,30}$/;

/**
 * Piso de tamanho para código NOVO — mais estreito que o CHECK de 0010 (que
 * fica em 3-30, sem editar migração) de propósito, e só na CRIAÇÃO/renomeação:
 * com 3 caracteres A-Z0-9 existem só 46 mil combinações, e a rota pública
 * /cupons/validar, mesmo a 30/min por IP, deixaria um botnet enumerar códigos
 * curtos em horas. Com 6, são ~2 bilhões — enumeração deixa de pagar. Cupons
 * LEGADOS de 3-5 caracteres continuam válidos para APLICAR e para editar os
 * demais campos; só não nascem mais assim.
 */
const TAMANHO_MINIMO_DE_CODIGO_NOVO = 6;

/**
 * Subtotal EM CENTAVOS calculado no servidor: preço do banco, promoção ativa
 * aplicada (o cupom desconta sobre o preço já promocional — mesma função
 * `precoComPromocao` do checkout, então validação e cobrança nunca divergem).
 *
 * O corpo pode até mandar `price`; ele é ignorado de propósito — número que
 * vira dinheiro nunca vem do navegador (regra da F4).
 */
async function subtotalDoServidorCentavos(itens) {
  const { rows } = await pool.query(
    `SELECT produto_id AS product_id,
            preco      AS price,
            categoria  AS category
       FROM canastra.produtos
      WHERE produto_id = ANY($1::uuid[])`,
    [itens.map((i) => i.productId)],
  );
  const porId = new Map(rows.map((p) => [p.product_id, p]));

  const activePromotions = await promotionsRepo.findActivePromotionsForCheckout();

  // A soma em si é a `somarCentavos` de utils/preco — a MESMA do frete e do
  // checkout, para os três nunca discordarem sobre o mesmo carrinho.
  const precificados = itens.map((item) => {
    const produto = porId.get(item.productId);
    if (!produto) {
      const erro = new Error("Um dos produtos do carrinho não existe mais.");
      erro.status = 400;
      throw erro;
    }
    return {
      price: precoComPromocao(produto, activePromotions),
      quantity: item.quantity,
    };
  });
  return somarCentavos(precificados);
}

/** Recusa em cima o que o CHECK do banco recusaria embaixo — com frase. */
function validarCampos({
  codigo,
  tipo,
  valor,
  minimoCentavos,
  limiteUsos,
  // Janela de validade (Onda 2E): opcional nos dois lados, mas quando as
  // duas pontas vêm, fim antes do início é um cupom que NUNCA vale — o
  // gestor publicaria um código morto sem nenhum aviso.
  inicioEm = null,
  fimEm = null,
}) {
  if (!FORMATO_CODIGO.test(codigo)) {
    return "O código precisa ter de 3 a 30 letras (A-Z) e números, sem espaços.";
  }
  if (tipo !== "percent" && tipo !== "fixed") {
    return "Tipo de desconto inválido. Use 'percent' ou 'fixed'.";
  }
  const n = Number(valor);
  if (!Number.isFinite(n) || n <= 0) {
    return "O valor do desconto precisa ser um número maior que zero.";
  }
  if (tipo === "percent" && n > 90) {
    // O mesmo teto das promoções, pelo mesmo motivo: acima disso é quase
    // certamente engano, e um 100% libera a loja de graça.
    return "Desconto percentual acima de 90% não é permitido.";
  }
  if (
    !Number.isInteger(minimoCentavos) ||
    minimoCentavos < 0 ||
    minimoCentavos > 100_000_000
  ) {
    return "O pedido mínimo precisa ser um valor em centavos (inteiro, não negativo).";
  }
  if (
    limiteUsos !== null &&
    (!Number.isInteger(limiteUsos) || limiteUsos < 1)
  ) {
    return "O limite de usos precisa ser um inteiro maior que zero (ou vazio para ilimitado).";
  }
  const inicio = inicioEm ? new Date(inicioEm) : null;
  const fim = fimEm ? new Date(fimEm) : null;
  if (inicio && Number.isNaN(inicio.getTime())) {
    return "Data de início da validade inválida.";
  }
  if (fim && Number.isNaN(fim.getTime())) {
    return "Data de fim da validade inválida.";
  }
  if (inicio && fim && fim.getTime() <= inicio.getTime()) {
    return "O fim da validade precisa ser depois do início.";
  }
  return null;
}

/** O datetime-local do painel manda "" quando vazio — vira NULL, como nas promoções. */
const dataOuNull = (valor) => (valor ? valor : null);

class CuponsController {
  /**
   * POST /cupons/validar — público (rate limit na rota).
   *
   * 200 SEMPRE que a pergunta pôde ser respondida — inclusive "não vale", que
   * é resposta, não erro. 400 fica para corpo malformado. Contrato fixado no
   * plano mestre: { valido, codigo, tipo, valor, descontoCentavos, descricao }
   * ou { valido: false, motivo }.
   */
  async validar(req, res) {
    try {
      const { codigo, itens } = req.body || {};

      if (!Array.isArray(itens) || itens.length === 0) {
        return res.status(400).json({ error: "Informe os itens do carrinho." });
      }
      for (const item of itens) {
        const q = Number(item?.quantity);
        if (!Number.isInteger(q) || q < 1 || q > 999) {
          return res
            .status(400)
            .json({ error: "Quantidade inválida em um dos itens." });
        }
        if (!FORMATO_UUID.test(String(item?.productId || ""))) {
          return res
            .status(400)
            .json({ error: "Identificador de produto inválido." });
        }
      }

      const codigoNormalizado = normalizarCodigo(codigo);
      if (!codigoNormalizado) {
        return res.status(400).json({ error: "Informe o código do cupom." });
      }

      const subtotalCentavos = await subtotalDoServidorCentavos(itens);
      const cupom = await cuponsRepository.buscarPorCodigo(codigoNormalizado);
      const avaliacao = avaliarCupom(cupom, subtotalCentavos);

      if (!avaliacao.valido) {
        return res.status(200).json(avaliacao);
      }

      return res.status(200).json({
        valido: true,
        codigo: cupom.codigo,
        tipo: cupom.tipo,
        valor: Number(cupom.valor),
        descontoCentavos: avaliacao.descontoCentavos,
        descricao: cupom.descricao,
      });
    } catch (erro) {
      if (erro.status === 400) {
        return res.status(400).json({ error: erro.message });
      }
      console.error("Erro ao validar cupom:", erro);
      return res.status(500).json({ error: "Não foi possível validar o cupom." });
    }
  }

  /** GET /cupons (admin) → { data: [...] }. */
  async listar(req, res) {
    try {
      const data = await cuponsRepository.listar();
      return res.status(200).json({ data });
    } catch (erro) {
      console.error("Erro ao listar cupons:", erro);
      return res.status(500).json({ error: "Erro ao listar cupons." });
    }
  }

  /** POST /cupons (admin). */
  async criar(req, res) {
    try {
      const corpo = req.body || {};
      const codigo = normalizarCodigo(corpo.codigo);

      // Fora do validarCampos de propósito: a regra vale só para código
      // NOVO (criação e renomeação) — legados de 3-5 caracteres continuam
      // passando pelo validarCampos ao editar outros campos. Racional no
      // comentário de TAMANHO_MINIMO_DE_CODIGO_NOVO.
      if (codigo.length < TAMANHO_MINIMO_DE_CODIGO_NOVO) {
        return res.status(400).json({
          error: `O código precisa ter pelo menos ${TAMANHO_MINIMO_DE_CODIGO_NOVO} caracteres — códigos curtos são fáceis de adivinhar.`,
        });
      }

      const minimoCentavos =
        corpo.minimo_centavos === undefined || corpo.minimo_centavos === null
          ? 0
          : Number(corpo.minimo_centavos);
      const limiteUsos =
        corpo.limite_usos === undefined ||
        corpo.limite_usos === null ||
        corpo.limite_usos === ""
          ? null
          : Number(corpo.limite_usos);

      const problema = validarCampos({
        codigo,
        tipo: corpo.tipo,
        valor: corpo.valor,
        minimoCentavos,
        limiteUsos,
        inicioEm: dataOuNull(corpo.inicio_em),
        fimEm: dataOuNull(corpo.fim_em),
      });
      if (problema) return res.status(400).json({ error: problema });

      const cupom = await cuponsRepository.criar({
        codigo,
        tipo: corpo.tipo,
        valor: Number(corpo.valor),
        descricao: corpo.descricao || null,
        minimoCentavos,
        limiteUsos,
        inicioEm: dataOuNull(corpo.inicio_em),
        fimEm: dataOuNull(corpo.fim_em),
      });
      return res.status(201).json(cupom);
    } catch (erro) {
      if (erro.code === "23505") {
        // O UNIQUE de `cupons.codigo`: pedido correto, estado que não deixa.
        return res
          .status(409)
          .json({ error: "Já existe um cupom com esse código." });
      }
      console.error("Erro ao criar cupom:", erro);
      return res.status(500).json({ error: "Erro ao criar cupom." });
    }
  }

  /**
   * PUT /cupons/:id (admin) — PARCIAL: só o que veio no corpo muda. Não há
   * DELETE de cupom de propósito: um código já divulgado apagado e recriado
   * por outra campanha herdaria o histórico; desativar (`ativo: false`)
   * preserva o rastro e recusa novos usos.
   */
  async atualizar(req, res) {
    try {
      const { id } = req.params || {};
      if (!FORMATO_UUID.test(String(id || ""))) {
        return res.status(400).json({ error: "Identificador de cupom inválido." });
      }

      const existente = await cuponsRepository.buscarPorId(id);
      if (!existente) {
        return res.status(404).json({ error: "Cupom não encontrado." });
      }

      const corpo = req.body || {};
      const campos = {};
      if ("codigo" in corpo) {
        campos.codigo = normalizarCodigo(corpo.codigo);
        // Renomear É criar um código novo — mesmo piso anti-enumeração da
        // criação. Editar os DEMAIS campos de um cupom legado curto passa.
        if (campos.codigo.length < TAMANHO_MINIMO_DE_CODIGO_NOVO) {
          return res.status(400).json({
            error: `O código precisa ter pelo menos ${TAMANHO_MINIMO_DE_CODIGO_NOVO} caracteres — códigos curtos são fáceis de adivinhar.`,
          });
        }
      }
      for (const chave of ["tipo", "valor", "descricao", "ativo"]) {
        if (chave in corpo) campos[chave] = corpo[chave];
      }
      if ("minimo_centavos" in corpo)
        campos.minimo_centavos = Number(corpo.minimo_centavos);
      if ("limite_usos" in corpo)
        campos.limite_usos =
          corpo.limite_usos === null || corpo.limite_usos === ""
            ? null
            : Number(corpo.limite_usos);
      if ("inicio_em" in corpo) campos.inicio_em = dataOuNull(corpo.inicio_em);
      if ("fim_em" in corpo) campos.fim_em = dataOuNull(corpo.fim_em);

      // A régua do criar vale na edição, sobre o resultado FUNDIDO — sem
      // isto, dava para criar um percent de 10 e editá-lo para 95, ou trocar
      // o tipo para percent deixando um valor de 500 (o furo que as
      // promoções já fecharam em validarDesconto).
      const fundido = { ...existente, ...campos };
      const problema = validarCampos({
        codigo: fundido.codigo,
        tipo: fundido.tipo,
        valor: fundido.valor,
        minimoCentavos: Number(fundido.minimo_centavos),
        limiteUsos:
          fundido.limite_usos === null || fundido.limite_usos === undefined
            ? null
            : Number(fundido.limite_usos),
        inicioEm: fundido.inicio_em,
        fimEm: fundido.fim_em,
      });
      if (problema) return res.status(400).json({ error: problema });

      const atualizado = await cuponsRepository.atualizar(id, campos);
      return res.status(200).json(atualizado);
    } catch (erro) {
      if (erro.code === "23505") {
        return res
          .status(409)
          .json({ error: "Já existe um cupom com esse código." });
      }
      console.error("Erro ao atualizar cupom:", erro);
      return res.status(500).json({ error: "Erro ao atualizar cupom." });
    }
  }
}

module.exports = new CuponsController();
