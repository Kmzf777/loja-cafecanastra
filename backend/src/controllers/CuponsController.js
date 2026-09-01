const pool = require("../pgPool");
const cuponsRepository = require("../repositories/cuponsRepository");
const PromotionsRepository = require("../repositories/promotionsRepository");
const { avaliarCupom, normalizarCodigo, reaisPorExtenso } = require("../utils/cupom");
const { precoComPromocao, somarCentavos } = require("../utils/preco");
// O motor (0032 + Onda 4). `motor.js` é PURO — a conta; o repositório é quem
// sabe ler as sete tabelas. Os dois são os MESMOS que o checkout usa, e é essa
// identidade que faz a tela e a cobrança não discordarem sobre um código.
const { calcularDescontos } = require("../utils/motor");
const motorRepository = require("../repositories/motorRepository");
const { registrar, ACOES, ENTIDADES } = require("../services/adminLog");

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
 * O carrinho precificado PELO SERVIDOR: preço do banco, promoção legada ativa
 * aplicada (o cupom desconta sobre o preço já promocional — mesma função
 * `precoComPromocao` do checkout, então validação e cobrança nunca divergem).
 *
 * O corpo pode até mandar `price`; ele é ignorado de propósito — número que
 * vira dinheiro nunca vem do navegador (regra da F4).
 *
 * DEVOLVE TAMBÉM AS LINHAS NO VOCABULÁRIO DO MOTOR e os ids das promoções
 * legadas vigentes. As duas coisas existem pela mesma razão: desde a 0032 um
 * código de desconto pode morar em `canastra.cupons` (legado) OU em
 * `promocao_codigos` (motor), e esta rota precisa perguntar aos dois — sem
 * deixar que uma campanha que existe nas duas tabelas seja contada duas vezes.
 */
async function precificarCarrinho(itens) {
  const { rows } = await pool.query(
    `SELECT produto_id AS product_id,
            preco      AS price,
            categoria  AS category,
            sku
       FROM canastra.produtos
      WHERE produto_id = ANY($1::uuid[])`,
    [itens.map((i) => i.productId)],
  );
  const porId = new Map(rows.map((p) => [p.product_id, p]));

  const activePromotions = await promotionsRepo.findActivePromotionsForCheckout();

  const precificados = itens.map((item) => {
    const produto = porId.get(item.productId);
    if (!produto) {
      const erro = new Error("Um dos produtos do carrinho não existe mais.");
      erro.status = 400;
      throw erro;
    }
    return {
      produto,
      price: precoComPromocao(produto, activePromotions),
      quantity: item.quantity,
    };
  });

  return {
    // A soma em si é a `somarCentavos` de utils/preco — a MESMA do frete e do
    // checkout, para os três nunca discordarem sobre o mesmo carrinho.
    subtotalCentavos: somarCentavos(precificados),
    linhas: precificados.map((p) => ({
      produtoId: p.produto.product_id,
      sku: p.produto.sku ?? null,
      categoria: p.produto.category ?? null,
      // `precoCentavos` é o UNITÁRIO já promocional: a promoção legada é etapa
      // zero e o motor começa do que ela deixou. Idêntico ao
      // `carrinhoParaOMotor` do PaymentController.
      precoCentavos: Math.round(Number(p.price) * 100),
      quantidade: Number(p.quantity),
    })),
    idsLegados: new Set(activePromotions.map((p) => String(p.id)).filter(Boolean)),
  };
}

/**
 * A MESMA ponte de transição do `PaymentController.semSobreposicaoComOLegado`,
 * e ela precisa ser a mesma: a 0032 INSERIU cada linha de `promocoes_legado` e
 * de `cupons` na tabela `promocoes` nova REAPROVEITANDO o `id`. Enquanto os dois
 * caminhos convivem, uma campanha migrada seria aplicada DUAS VEZES sobre o
 * mesmo carrinho — e aqui o efeito seria a tela prometer um desconto que o
 * checkout não vai dar, que é o defeito que esta rota existe para não ter.
 *
 * O corte é pelo `id` justamente porque a migração o reaproveitou: igualdade
 * exata, não heurística. E o código digitado tem dono único — se a busca em
 * `canastra.cupons` achou o código, a regra de método `codigo` do motor é a
 * MESMA campanha, e quem aplica é o caminho legado.
 */
function semSobreposicaoComOLegado(regras, { idsLegados, cupomLegadoAplicado }) {
  return regras.filter((regra) => {
    if (idsLegados.has(String(regra.id))) return false;
    if (cupomLegadoAplicado && regra.metodo === "codigo") return false;
    return true;
  });
}

/** Soma os ajustes de um alvo. Em centavos, como tudo que vem do motor. */
function somaDosAjustes(ajustes, alvo) {
  return ajustes
    .filter((a) => a.alvo === alvo)
    .reduce((total, a) => total + a.valorCentavos, 0);
}

/**
 * `mecanica` do motor → o `tipo` do contrato desta rota.
 *
 * O contrato ({ valido, codigo, tipo, valor, descontoCentavos, descricao }) é
 * anterior ao motor e fala 'percent'/'fixed'. As mecânicas que NÃO têm tradução
 * — preço fixo, leve 3 pague 2, progressivo, frete grátis — saem com `tipo:
 * null` em vez de um rótulo aproximado: quem consome esta resposta usa
 * `descontoCentavos` e `descricao` (ver `frontend/lib/sacola/cupom.ts`), e
 * chamar um "leve 3 pague 2" de 'percent' seria escrever um número errado num
 * campo que ninguém confere.
 */
const TIPO_POR_MECANICA = Object.freeze({
  percentual: "percent",
  valor_fixo: "fixed",
});

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

      const { subtotalCentavos, linhas, idsLegados } = await precificarCarrinho(itens);
      const cupom = await cuponsRepository.buscarPorCodigo(codigoNormalizado);

      /**
       * O CÓDIGO TEM DOIS DONOS POSSÍVEIS enquanto a transição dura, e até a
       * Onda 4 esta rota só conhecia um: um código de `promocao_codigos`
       * respondia `valido: false` aqui e era ACEITO no checkout. Não cobrava a
       * mais — o `process_payment` já fala com o motor —, mas a tela MENTIA
       * para o cliente, mandando-o procurar erro de digitação num código que
       * ele copiou certo do anúncio.
       *
       * `meioPagamento: null` e `assinante: false` NÃO são preguiça: esta rota é
       * PÚBLICA (não há sessão para perguntar se a pessoa é do Clube) e roda
       * antes de o meio de pagamento existir. O motor já trata os dois — sem
       * meio conhecido, uma regra condicionada a Pix não vale, "porque um
       * desconto de Pix aplicado a um pagamento cujo método ainda não se sabe é
       * um desconto que a cobrança não consegue justificar depois". Prometer o
       * desconto de Pix aqui produziria exatamente a divergência que este
       * arquivo existe para evitar; o troco é uma promessa a MENOS, que é o
       * lado seguro do erro.
       */
      const regras = semSobreposicaoComOLegado(
        await motorRepository.carregarRegrasVigentes({ codigo: codigoNormalizado }),
        { idsLegados, cupomLegadoAplicado: Boolean(cupom) },
      );
      const regrasDoCodigo = regras.filter(
        (regra) => regra.codigo && regra.codigo.codigo === codigoNormalizado,
      );

      // "Não encontrado" só é verdade quando NENHUM dos dois reconhece o
      // código. `diagnosticarCodigo` custa uma consulta e devolve a frase certa
      // ("inativo", "expirado", "esgotado") do vocabulário fechado de
      // `utils/cupom.js` — as mesmas cinco que o checkout usa.
      if (!cupom && regrasDoCodigo.length === 0) {
        return res.status(200).json({
          valido: false,
          motivo: await motorRepository.diagnosticarCodigo(codigoNormalizado),
        });
      }

      const motorPrevio = calcularDescontos(
        { itens: linhas, meioPagamento: null, assinante: false, frete: null },
        regras,
      );

      /**
       * A BASE DO CUPOM LEGADO DESCONTA A ETAPA 1 DO MOTOR — a mesma regra que
       * o motor aplica às suas próprias regras de pedido, e a mesma que o
       * `PaymentController` usa: desconto sobre o subtotal incide sobre o
       * subtotal JÁ REDUZIDO pelos descontos de linha. Sem regra nova
       * cadastrada o subtraendo é zero e a conta é, ao centavo, a de sempre.
       */
      const baseCentavos = subtotalCentavos - somaDosAjustes(motorPrevio.ajustes, "item");

      if (cupom) {
        const avaliacao = avaliarCupom(cupom, baseCentavos);
        if (!avaliacao.valido) return res.status(200).json(avaliacao);

        return res.status(200).json({
          valido: true,
          codigo: cupom.codigo,
          tipo: cupom.tipo,
          valor: Number(cupom.valor),
          descontoCentavos: Math.max(
            0,
            Math.min(
              avaliacao.descontoCentavos,
              baseCentavos - somaDosAjustes(motorPrevio.ajustes, "pedido"),
            ),
          ),
          descricao: cupom.descricao,
        });
      }

      // Daqui para baixo, o código é do MOTOR.
      const regra = regrasDoCodigo[0];
      const descontoCentavos = motorPrevio.ajustes
        .filter((ajuste) => ajuste.codigo === codigoNormalizado)
        .reduce((total, ajuste) => total + ajuste.valorCentavos, 0);

      if (descontoCentavos === 0) {
        /**
         * O código existe e está vigente, e mesmo assim não virou desconto. As
         * três saídas abaixo são situações DIFERENTES, e responder a mesma coisa
         * para as três seria mentir de um jeito ou de outro.
         */

        // 1. É um código de FRETE, e o frete ainda não foi cotado (a classe
        //    `frete` do motor depende da modalidade escolhida). Recusar diria
        //    "inválido" para um código que o checkout vai honrar; anunciar um
        //    número seria inventá-lo. Vale, com zero — e a descrição explica.
        if (regrasDoCodigo.every((r) => r.classe === "frete")) {
          return res.status(200).json({
            valido: true,
            codigo: codigoNormalizado,
            tipo: TIPO_POR_MECANICA[regra.mecanica] ?? null,
            valor: Number.isFinite(Number(regra.valor)) ? Number(regra.valor) : null,
            descontoCentavos: 0,
            descricao: regra.nome,
          });
        }

        // 2. O carrinho não atingiu o mínimo — a MESMA frase do cupom legado,
        //    com o valor em reais, porque para quem digitou é o mesmo problema
        //    e a mesma solução ("falta pouco, coloque mais um café").
        const porMinimo = regrasDoCodigo.find(
          (r) => r.minimoTipo === "subtotal" && baseCentavos < Number(r.minimoValor),
        );
        if (porMinimo) {
          return res.status(200).json({
            valido: false,
            motivo: `Pedido mínimo de R$ ${reaisPorExtenso(Number(porMinimo.minimoValor))}`,
          });
        }

        // 3. Escopo, quantidade mínima, exclusividade: o código é bom e não
        //    alcança NADA do que está na sacola. Nenhuma das cinco frases do
        //    contrato descreve isso — "esgotado" ou "inativo" mandariam procurar
        //    o problema no cupom, e ele está no carrinho.
        return res.status(200).json({
          valido: false,
          motivo: "Este cupom não vale para os itens deste carrinho",
        });
      }

      return res.status(200).json({
        valido: true,
        codigo: codigoNormalizado,
        tipo: TIPO_POR_MECANICA[regra.mecanica] ?? null,
        valor: Number.isFinite(Number(regra.valor)) ? Number(regra.valor) : null,
        descontoCentavos,
        descricao: regra.nome,
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

      // O cupom e o registro de quem o criou nascem na MESMA transação: um
      // código de desconto é dinheiro, e "quem criou o CAFE50?" não pode
      // depender de um segundo INSERT que a rede derruba no meio.
      const client = await pool.connect();
      let cupom;
      try {
        await client.query("BEGIN");
        cupom = await cuponsRepository.criar({
          codigo,
          tipo: corpo.tipo,
          valor: Number(corpo.valor),
          descricao: corpo.descricao || null,
          minimoCentavos,
          limiteUsos,
          inicioEm: dataOuNull(corpo.inicio_em),
          fimEm: dataOuNull(corpo.fim_em),
          client,
        });
        await registrar(client, {
          adminUserId: req.user?.userId ?? null,
          acao: ACOES.CUPOM_CRIADO,
          entidade: ENTIDADES.CUPOM,
          entidadeId: cupom.id,
          depois: {
            codigo: cupom.codigo,
            tipo: cupom.tipo,
            valor: cupom.valor,
            limite_usos: cupom.limite_usos,
          },
        });
        await client.query("COMMIT");
      } catch (erro) {
        await client.query("ROLLBACK").catch(() => {});
        throw erro;
      } finally {
        client.release();
      }
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

      const client = await pool.connect();
      let atualizado;
      try {
        await client.query("BEGIN");
        atualizado = await cuponsRepository.atualizar(id, campos, client);
        await registrar(client, {
          adminUserId: req.user?.userId ?? null,
          acao: ACOES.CUPOM_ALTERADO,
          entidade: ENTIDADES.CUPOM,
          entidadeId: id,
          // Os dois lados guardam SÓ os campos tocados: um PUT parcial que
          // desliga o cupom não deve produzir um diff de linha inteira.
          antes: Object.fromEntries(
            Object.keys(campos).map((chave) => [chave, existente[chave] ?? null]),
          ),
          depois: Object.fromEntries(
            Object.keys(campos).map((chave) => [chave, atualizado[chave] ?? null]),
          ),
        });
        await client.query("COMMIT");
      } catch (erro) {
        await client.query("ROLLBACK").catch(() => {});
        throw erro;
      } finally {
        client.release();
      }
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
