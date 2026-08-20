const crypto = require("node:crypto");
const { v4: uuidv4 } = require("uuid");
const { payment } = require("../config/mercadopago");
const OrderRepository = require("../repositories/ordersRepository");
const pool = require("../pgPool");
const PromotionsRepository = require("../repositories/promotionsRepository");
const { calcularOpcoesDeFrete } = require("./ShippingController");
const {
  GRUPO_ATIVO,
  GRUPO_CANCELADO,
  traduzirStatusMp,
} = require("../utils/statusDePedido");
const { ordenarPorProduto } = require("../utils/estoque");
const promotionsRepo = new PromotionsRepository();
const {
  sendStatusEmail,
  sendAdminNewOrderEmail,
} = require("../utils/emailSender");

/** Tolerancia de centavo ao comparar o frete recalculado com o enviado. */
const TOLERANCIA_FRETE = 0.01;

const FORMATO_UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Confere o frete que o navegador mandou contra o que o servidor calcula.
 *
 * O fluxo antigo somava `req.body.shippingCost` direto no valor cobrado. Como o
 * numero vinha do cliente, dava para mandar 0 e nao pagar frete — ou mandar um
 * valor NEGATIVO e abater do preco dos produtos, porque a soma nao tinha piso.
 *
 * Aqui o servidor recalcula as opcoes para o CEP do pedido, usando peso e
 * dimensoes vindos do BANCO, e so aceita um valor que corresponda a alguma
 * opcao real. Retirada na loja (frete 0) continua valendo.
 *
 * O FRETE GRATIS DE SERVIDOR (0009) passa por aqui SEM mudar esta funcao: a
 * recotacao chama o mesmo `calcularOpcoesDeFrete`, que ja zera as opcoes
 * quando o subtotal atinge o piso — entao o `shippingCost: 0` do navegador
 * casa com uma opcao real de preco 0. Abaixo do piso, o zero nao casa com
 * nada e cai no 409 de sempre.
 */
async function conferirFrete({ address, itens, shippingCost, shippingMethod }) {
  const valor = Number(shippingCost || 0);

  if (!Number.isFinite(valor) || valor < 0) {
    const erro = new Error("Valor de frete inválido.");
    erro.status = 400;
    throw erro;
  }

  const ehRetirada = /retirada|retirar/i.test(String(shippingMethod || ""));
  if (ehRetirada) {
    if (valor > 0) {
      const erro = new Error("Retirada na loja não tem frete.");
      erro.status = 400;
      throw erro;
    }
    return 0;
  }

  const cep = address?.zip_code || address?.zipCode || address?.cep;
  if (!cep) {
    const erro = new Error("Endereço sem CEP: não é possível confirmar o frete.");
    erro.status = 400;
    throw erro;
  }

  let opcoes;
  try {
    opcoes = await calcularOpcoesDeFrete({ zipCode: cep, itens });
  } catch {
    // Sem conseguir recalcular, aceitar o numero do cliente seria reabrir o
    // buraco. Recusar o pedido e o comportamento seguro — e o checkout ja
    // estaria quebrado de qualquer forma, porque o frete nao pode ser cotado.
    const erro = new Error(
      "Não foi possível confirmar o frete agora. Tente novamente em instantes.",
    );
    erro.status = 503;
    throw erro;
  }

  const combina = opcoes.some(
    (o) => Math.abs(Number(o.price) - valor) <= TOLERANCIA_FRETE,
  );

  if (!combina) {
    const erro = new Error(
      "O frete mudou desde que você escolheu. Recalcule e tente de novo.",
    );
    erro.status = 409;
    throw erro;
  }

  return valor;
}
/**
 * Confere a assinatura da notificacao do Mercado Pago.
 *
 * O segredo sai do painel do MP (Suas integracoes > Webhooks > Chave secreta) e
 * entra como MP_WEBHOOK_SECRET.
 *
 * Sem o segredo configurado, o comportamento depende do ambiente: em producao
 * RECUSA — um webhook aberto e porta aberta, e falhar fechado e a unica escolha
 * defensavel numa loja de verdade. Em desenvolvimento aceita, com aviso, para
 * nao travar quem esta testando o fluxo local com o ngrok.
 */
function validarAssinaturaWebhook(req) {
  const segredo = process.env.MP_WEBHOOK_SECRET;

  if (!segredo) {
    if (process.env.NODE_ENV === "production") {
      console.error(
        "MP_WEBHOOK_SECRET não configurado: webhooks recusados em produção.",
      );
      return false;
    }
    console.warn(
      "MP_WEBHOOK_SECRET ausente — assinatura do webhook NÃO conferida (só em desenvolvimento).",
    );
    return true;
  }

  const assinatura = req.headers["x-signature"];
  const requestId = req.headers["x-request-id"];
  if (!assinatura || typeof assinatura !== "string") return false;

  const partes = Object.fromEntries(
    assinatura.split(",").map((p) => {
      const [k, ...v] = p.split("=");
      return [k.trim(), v.join("=").trim()];
    }),
  );

  const ts = partes.ts;
  const recebido = partes.v1;
  if (!ts || !recebido) return false;

  // Janela de 5 minutos: barra reenvio de uma notificacao capturada semanas
  // atras, que continuaria com assinatura valida para sempre.
  const idadeSegundos = Math.abs(Date.now() / 1000 - Number(ts));
  if (!Number.isFinite(idadeSegundos) || idadeSegundos > 300) {
    console.warn("Webhook recusado: timestamp fora da janela.", { ts });
    return false;
  }

  const id = req.body?.data?.id ?? "";
  const manifesto = `id:${id};request-id:${requestId ?? ""};ts:${ts};`;
  const esperado = crypto
    .createHmac("sha256", segredo)
    .update(manifesto)
    .digest("hex");

  // timingSafeEqual exige buffers do mesmo tamanho.
  const a = Buffer.from(esperado, "utf8");
  const b = Buffer.from(recebido, "utf8");
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

/**
 * O menor preco do produto dadas as promocoes ativas, arredondado a centavo.
 *
 * Fatorado porque roda DUAS vezes por checkout: na cotacao de frete (leitura
 * sem trava, antes da transacao) e no calculo do valor cobrado (releitura com
 * FOR UPDATE). Duas copias desta logica divergindo fariam o frete gratis e a
 * cobranca discordarem sobre o mesmo carrinho.
 *
 * O arredondamento nao e cosmetico: 10% sobre 49.90 em float da
 * 44.910000000000004, e esse numero iria para o JSON IMUTAVEL do pedido
 * (`itens`, regra de 0005) e para a soma cobrada no gateway.
 */
function precoComPromocao(productDb, activePromotions) {
  const precoOriginal = Number(productDb.price);
  let bestPrice = precoOriginal;

  activePromotions.forEach((p) => {
    let match = false;

    const promoCategory = p.category
      ? String(p.category).trim().toLowerCase()
      : "";
    const prodCategory = productDb.category
      ? String(productDb.category).trim().toLowerCase()
      : "";

    if (p.applies_to === "all") {
      match = true;
    } else if (p.applies_to === "category") {
      if (promoCategory && promoCategory === prodCategory) {
        match = true;
      }
    } else if (p.applies_to === "product") {
      if (String(p.product_id) === String(productDb.product_id)) {
        match = true;
      }
    }

    if (match) {
      const value = Number(p.value);
      const discounted =
        p.type === "percent"
          ? precoOriginal * (1 - value / 100)
          : Math.max(0, precoOriginal - value);

      if (discounted < bestPrice) bestPrice = discounted;
    }
  });

  return Math.round(bestPrice * 100) / 100;
}

/**
 * Rele a URL de pagamento (QR do Pix, boleto) de um pagamento ja criado no MP.
 *
 * E a peca que faltava no REPLAY de idempotencia: a retentativa do mesmo
 * clique recebia o pedido existente mas SEM `ticketUrl` — no Pix isso e um
 * pedido morto, porque o cliente fica sem QR para pagar. A URL nao esta
 * gravada no pedido (e nao vamos criar coluna para um dado que o MP ja
 * guarda), entao ela e relida da API. Falha aqui nao derruba o replay:
 * responde sem ticketUrl, com o motivo no log.
 */
async function ticketUrlDoPagamento(paymentIdMp) {
  if (!paymentIdMp) return undefined;
  try {
    const pagamento = await payment.get({ id: paymentIdMp });
    return pagamento?.point_of_interaction?.transaction_data?.ticket_url;
  } catch (erro) {
    console.warn(
      `Replay: não consegui reler o ticket do pagamento ${paymentIdMp}:`,
      erro.message,
    );
    return undefined;
  }
}

/**
 * Compensacao: devolve ao estoque o que uma reserva ja tinha tirado. Recebe a
 * conexao (em geral o proprio pool: sao UPDATEs soltos, cada um commita
 * sozinho — compensacao nao pode depender de uma transacao que talvez ja
 * tenha morrido).
 */
async function devolverEstoque(conexao, itens) {
  for (const item of itens) {
    try {
      await conexao.query(
        "UPDATE canastra.produtos SET quantidade = quantidade + $1 WHERE produto_id = $2",
        [Number(item.quantity), item.product_id],
      );
    } catch (err) {
      // Perder a devolucao de um item nao pode abortar a dos outros. Fica no
      // log como divergencia de estoque para conferencia manual.
      console.error(
        `ESTOQUE: falha ao devolver ${item.quantity}x ${item.product_id}:`,
        err.message,
      );
    }
  }
}

/**
 * Grava o CPF do corpo em `canastra.clientes` e devolve o CPF vigente.
 *
 * A Onda 2D vai coletar o CPF no checkout; o backend ja aceita: se
 * `formData.payer.identification` trouxer um CPF de 11 digitos, ele e
 * persistido ANTES da conferencia — e a partir dai a conta tem CPF para
 * sempre. Sem CPF de nenhuma fonte, o checkout recusa com CPF_MISSING, como
 * sempre recusou.
 */
async function garantirCpf(userId, identification) {
  const tipo = String(identification?.type || "CPF").toUpperCase();
  const digitos = String(identification?.number || "").replace(/\D/g, "");

  if (tipo === "CPF" && digitos.length === 11) {
    try {
      await pool.query(
        "UPDATE canastra.clientes SET cpf = $1 WHERE user_id = $2::uuid",
        [digitos, userId],
      );
    } catch (err) {
      if (err.code === "23505") {
        // O UNIQUE de `clientes.cpf` (0002): este numero ja pertence a outra
        // conta. Recusar com frase e melhor que um 500 sem explicacao.
        const erro = new Error("Este CPF já está cadastrado em outra conta.");
        erro.status = 400;
        erro.codigoPublico = "CPF_EM_USO";
        throw erro;
      }
      throw err;
    }
  }

  const { rows } = await pool.query(
    "SELECT cpf FROM canastra.clientes WHERE user_id = $1::uuid",
    [userId],
  );
  return rows.length ? rows[0].cpf : null;
}

class PaymentController {
  async createPayment(req, res) {
    // Fora do try: o bloco de erro precisa saber em que ponto do fluxo parou.
    //
    // `client` NULO ate a hora do BEGIN, de proposito: tudo antes da transacao
    // (idempotencia, CPF, promocoes, cotacao de frete) fala com o banco pelo
    // pool. Adquirir a conexao dedicada na primeira linha — como estava —
    // fazia cada checkout segurar DUAS conexoes durante as idas preliminares
    // (uma delas com rede no meio), cortando o teto util do pool pela metade
    // numa rajada.
    let client = null;
    let estoqueReservado = false;
    let pedidoCriado = null;
    let validatedItems = [];
    try {
      const {
        formData,
        items,
        userEmail,
        paymentMethodType,
        address,
        shippingCost,
        shippingMethod,
      } = req.body;

      /**
       * A IDENTIDADE VEM DO TOKEN, NUNCA DO CORPO.
       *
       * Antes `userId` era desestruturado de req.body. A rota exige login, mas
       * nada amarrava o corpo a quem estava logado: bastava mandar o id de
       * outra pessoa para criar pedido no nome dela, usar o CPF dela e — mais
       * abaixo — ESVAZIAR O CARRINHO dela. req.user vem do JWT verificado em
       * middleware/isAuthenticated.js e nao e falsificavel pelo cliente.
       */
      const userId = req.user?.userId;

      /**
       * IDEMPOTENCIA DO CHECKOUT (indice parcial de 0005).
       *
       * O navegador PODE mandar `Idempotency-Key`; duas tentativas do mesmo
       * clique chegam com a mesma chave e a segunda recebe o pedido que a
       * primeira criou, SEM segunda cobranca. Sem o cabecalho, o servidor
       * gera uma chave propria — o pedido nunca grava sem chave, entao o
       * indice unico continua armado para todo caminho futuro.
       */
      const chaveDoCliente = String(
        req.headers["idempotency-key"] || req.headers["x-idempotency-key"] || "",
      ).trim();
      const chaveIdempotencia =
        chaveDoCliente && chaveDoCliente.length <= 128
          ? `${userId}:${chaveDoCliente}`
          : uuidv4();

      if (chaveDoCliente) {
        const existente =
          await OrderRepository.getOrderByIdempotencyKey(chaveIdempotencia);
        if (existente) {
          // O QR do Pix vai junto: replay sem ticketUrl era um pedido morto —
          // o cliente recebia "já processado" e ficava sem o que pagar.
          return res.status(200).json({
            message: "Este pedido já tinha sido processado.",
            status: existente.status,
            orderId: existente.order_id,
            ticketUrl: await ticketUrlDoPagamento(existente.payment_id_mp),
          });
        }
      }

      if (userId) {
        const cpf = await garantirCpf(userId, formData?.payer?.identification);
        if (!cpf) {
          return res.status(400).json({
            error: "CPF_MISSING",
            message:
              "É necessário informar o CPF para prosseguir com a entrega.",
          });
        }
      }

      if (!Array.isArray(items) || items.length === 0) {
        return res.status(400).json({ error: "Carrinho vazio" });
      }

      /**
       * Quantidade tambem e entrada de usuario. Sem este piso, `quantity: -5`
       * fazia a soma do pedido DIMINUIR e ainda devolvia estoque na baixa.
       * O formato do id tambem: um `product_id` que nao e UUID estourava
       * 22P02 dentro da transacao e virava 500 sem explicacao.
       */
      for (const item of items) {
        const q = Number(item.quantity);
        if (!Number.isInteger(q) || q < 1 || q > 999) {
          return res
            .status(400)
            .json({ error: "Quantidade inválida em um dos itens." });
        }
        if (!FORMATO_UUID.test(String(item.product_id || ""))) {
          return res
            .status(400)
            .json({ error: "Identificador de produto inválido." });
        }
      }

      const activePromotions =
        await promotionsRepo.findActivePromotionsForCheckout();

      /**
       * Ordem canonica ANTES de qualquer trava: dois pedidos com os mesmos
       * produtos em ordens opostas se matariam em deadlock 40P01 (ver
       * utils/estoque.js). Tudo daqui para baixo itera nesta ordem.
       */
      const itensOrdenados = ordenarPorProduto(items);

      /**
       * PRIMEIRA PASSADA, SEM TRAVA: le peso, dimensoes e preco so para
       * conferir o frete ANTES de abrir a transacao. A conferencia pode
       * chamar a Melhor Envio (ate 12s de timeout), e segurar o FOR UPDATE de
       * todos os produtos do carrinho durante uma chamada de rede bloquearia
       * qualquer outro checkout com um item em comum — o mesmo motivo pelo
       * qual o COMMIT acontece antes da ida ao Mercado Pago.
       *
       * O que se le aqui vale para a COTACAO; o dinheiro cobrado sai da
       * releitura com FOR UPDATE logo abaixo. Se um preco mudar exatamente
       * entre as duas leituras, o pior caso e a decisao de frete gratis ter
       * usado o subtotal de milissegundos atras — e frete, e uma janela que
       * nao justifica prender a prateleira inteira.
       */
      const { rows: leituraPrevia } = await pool.query(
        `SELECT produto_id  AS product_id,
                preco       AS price,
                categoria   AS category,
                nome        AS name,
                peso        AS weight,
                largura     AS width,
                altura      AS height,
                comprimento AS length
           FROM canastra.produtos
          WHERE produto_id = ANY($1::uuid[])`,
        [itensOrdenados.map((i) => i.product_id)],
      );
      const previaPorId = new Map(leituraPrevia.map((p) => [p.product_id, p]));

      const itensParaCotacao = [];
      for (const item of itensOrdenados) {
        const previa = previaPorId.get(item.product_id);
        if (!previa) {
          const erro = new Error(`O produto "${item.name}" não existe mais.`);
          erro.status = 400;
          throw erro;
        }
        itensParaCotacao.push({
          product_id: previa.product_id,
          quantity: Number(item.quantity),
          price: precoComPromocao(previa, activePromotions),
          // Peso e dimensoes reais, para o frete ser reconferido com o pacote
          // de verdade e nao com o que o cliente disser que e.
          weight: previa.weight,
          width: previa.width,
          height: previa.height,
          length: previa.length,
        });
      }

      const freteConferido = await conferirFrete({
        address,
        itens: itensParaCotacao,
        shippingCost,
        shippingMethod,
      });

      let validatedTotalAmount = 0;

      /**
       * Agora sim a transacao — enxuta: so leitura travada e reserva, nenhuma
       * chamada de rede dentro dela.
       *
       * Antes da F4 a checagem de estoque e a baixa eram duas consultas
       * soltas, separadas por uma chamada de rede ao Mercado Pago. Duas
       * compras simultaneas do ultimo pacote passavam as duas pela checagem,
       * e o `GREATEST(0, ...)` da baixa escondia o rombo zerando em vez de
       * falhar. `FOR UPDATE` serializa os concorrentes na linha do produto.
       */
      client = await pool.connect();
      await client.query("BEGIN");

      for (const item of itensOrdenados) {
        const { rows } = await client.query(
          `SELECT quantidade  AS quantity,
                  preco       AS price,
                  nome        AS name,
                  categoria   AS category,
                  produto_id  AS product_id,
                  imagem      AS image,
                  tamanho     AS size,
                  peso        AS weight,
                  largura     AS width,
                  altura      AS height,
                  comprimento AS length
             FROM canastra.produtos
            WHERE produto_id = $1
              FOR UPDATE`,
          [item.product_id],
        );

        if (rows.length === 0) {
          const erro = new Error(`O produto "${item.name}" não existe mais.`);
          erro.status = 400;
          throw erro;
        }

        const productDb = rows[0];
        const stockAtual = Number(productDb.quantity);
        const qtdSolicitada = Number(item.quantity);

        if (stockAtual < qtdSolicitada) {
          // O texto "Estoque insuficiente" e CONTRATO: o checkout legado o
          // procura em `details` para recarregar o carrinho.
          const erro = new Error(
            `Estoque insuficiente para "${productDb.name}". Restam ${stockAtual} unidades.`,
          );
          erro.status = 400;
          throw erro;
        }

        const bestPrice = precoComPromocao(productDb, activePromotions);
        validatedTotalAmount += bestPrice * qtdSolicitada;

        validatedItems.push({
          product_id: productDb.product_id,
          name: productDb.name,
          image: productDb.image,
          price: bestPrice,
          quantity: qtdSolicitada,
          size: productDb.size,
          weight: productDb.weight,
          width: productDb.width,
          height: productDb.height,
          length: productDb.length,
        });
      }

      /**
       * RESERVA DO ESTOQUE, ainda dentro da transacao e ANTES de cobrar.
       *
       * A baixa acontecia depois do pagamento, dentro de um try/catch que
       * ENGOLIA o erro: se falhasse, o cliente era cobrado e o estoque
       * continuava cheio, vendendo o mesmo pacote de novo. Reservar antes
       * inverte o risco para o lado seguro — se o pagamento nao sair, o
       * ROLLBACK devolve tudo.
       *
       * O `WHERE quantidade >= $1` e a rede de seguranca final: se ainda assim
       * a linha nao casar, rowCount = 0 e o pedido inteiro e desfeito, em vez
       * de gravar estoque negativo.
       */
      for (const item of validatedItems) {
        const baixa = await client.query(
          `UPDATE canastra.produtos
              SET quantidade = quantidade - $1
            WHERE produto_id = $2 AND quantidade >= $1`,
          [item.quantity, item.product_id],
        );
        if (baixa.rowCount === 0) {
          const erro = new Error(`Estoque insuficiente para "${item.name}".`);
          erro.status = 400;
          throw erro;
        }
      }

      const finalAmountToCharge = Number(
        (validatedTotalAmount + freteConferido).toFixed(2),
      );

      if (!(finalAmountToCharge > 0)) {
        const erro = new Error("Valor total do pedido inválido.");
        erro.status = 400;
        throw erro;
      }

      /**
       * Fecha a transacao com o estoque JA reservado, e devolve a conexao ao
       * pool ANTES da ida ao Mercado Pago: dali em diante tudo e pool.query, e
       * uma conexao parada durante uma chamada de rede e uma conexao roubada
       * de outro checkout.
       */
      await client.query("COMMIT");
      estoqueReservado = true;
      client.release();
      client = null;

      const paymentMethodIdRaw =
        formData.paymentMethodId ||
        formData.payment_method_id ||
        paymentMethodType;
      const finalPaymentMethodId =
        paymentMethodIdRaw === "bank_transfer" ? "pix" : paymentMethodIdRaw;
      const identification = formData.payer?.identification;

      const webhookUrl = process.env.WEBHOOK_URL;

      const paymentData = {
        transaction_amount: finalAmountToCharge,
        token: formData?.token,
        description: `Pedido Café Canastra - ${validatedItems.length} itens`,
        installments: Number(formData.installments || 1),
        payment_method_id: finalPaymentMethodId,
        notification_url: webhookUrl,
        payer: {
          email: formData.payer.email || userEmail,
          ...(identification && identification.number
            ? {
                identification: {
                  type: identification.type || "CPF",
                  number: identification.number,
                },
              }
            : {}),
        },
      };

      if (finalPaymentMethodId === "pix") {
        const date = new Date();
        date.setMinutes(date.getMinutes() + 30);
        paymentData.date_of_expiration = date.toISOString();
      }

      if (formData.issuerId || formData.issuer_id) {
        paymentData.issuer_id = formData.issuerId || formData.issuer_id;
      }

      let mpResponse;
      try {
        mpResponse = await payment.create({ body: paymentData });
      } catch (falhaNoGateway) {
        // Cobranca nao saiu: devolve o que foi reservado, senao o produto some
        // do estoque sem ninguem ter comprado.
        await devolverEstoque(pool, validatedItems);
        estoqueReservado = false;
        throw falhaNoGateway;
      }

      // A partir daqui a API fala portugues: o status do MP e traduzido UMA
      // vez e e o vocabulario da loja que vai para o banco, para o e-mail e
      // para a resposta (decisao 1 do plano mestre).
      const mpStatus = mpResponse.status;
      const statusPt = traduzirStatusMp(mpStatus);
      const mpId = mpResponse.id;

      let newOrder;
      try {
        // Nasce 'pendente' — o status inicial fixado — e ja recebe o status
        // real do MP logo abaixo, quando houver.
        newOrder = await OrderRepository.createOrder({
          userId: userId,
          totalAmount: finalAmountToCharge,
          items: validatedItems,
          paymentMethod: finalPaymentMethodId,
          paymentIdMp: mpId.toString(),
          address_json: address,
          // O frete gravado no pedido e o CONFERIDO, nao o que o cliente mandou.
          shippingCost: freteConferido,
          shippingMethod: shippingMethod || "Retirada",
          chaveIdempotencia,
          status: "pendente",
        });
      } catch (erroDeInsert) {
        if (erroDeInsert.code === "23505") {
          /**
           * Corrida real de duplo clique: as DUAS requisicoes passaram pela
           * conferencia inicial antes de qualquer uma gravar, e o indice
           * unico barrou a segunda — que ja cobrou o MP. A reserva desta
           * requisicao volta e o cliente recebe o pedido que valeu; o
           * pagamento duplicado fica GRITADO no log para estorno manual
           * (estornar automaticamente exigiria a API de refunds, fora desta
           * onda).
           */
          await devolverEstoque(pool, validatedItems);
          estoqueReservado = false;
          console.error(
            `PAGAMENTO DUPLICADO: chave ${chaveIdempotencia} ja tinha pedido; ` +
              `pagamento MP ${mpId} precisa de estorno manual.`,
          );
          const existente =
            await OrderRepository.getOrderByIdempotencyKey(chaveIdempotencia);
          if (existente) {
            return res.status(200).json({
              message: "Este pedido já tinha sido processado.",
              status: existente.status,
              orderId: existente.order_id,
              ticketUrl: await ticketUrlDoPagamento(existente.payment_id_mp),
            });
          }
        } else {
          /**
           * O outro jeito de nascer uma cobranca orfa: o MP cobrou e o INSERT
           * falhou por qualquer motivo que nao a idempotencia (banco caiu,
           * por exemplo). O estoque volta pelo catch externo; o dinheiro so
           * volta se alguem estornar — por isso a linha propria, gritada, com
           * tudo que o estorno manual precisa.
           */
          console.error(
            `COBRANÇA ÓRFÃ: o MP cobrou o pagamento ${mpId} mas o pedido não ` +
              `foi gravado (user ${userId}, chave ${chaveIdempotencia}). ` +
              `Estorne manualmente no painel do MP. Causa: ${erroDeInsert.message}`,
          );
        }
        throw erroDeInsert;
      }

      pedidoCriado = newOrder;

      /**
       * Avanca do 'pendente' para o status da resposta sincrona do MP — mas so
       * se o pedido AINDA esta 'pendente'. O webhook pode chegar entre o
       * INSERT e esta linha (Pix notifica em segundos), e um UPDATE cego
       * atropelaria o status que ele gravou e, pior, o bloco de estoque
       * abaixo devolveria unidades que o webhook JA devolveu. Se o webhook
       * venceu (`avancado` vazio), este caminho nao produz mais efeito:
       * nem estoque, nem e-mail de status.
       */
      let statusAplicado = "pendente";
      if (statusPt && statusPt !== "pendente") {
        const avancado = await OrderRepository.avancarStatusInicial(
          newOrder.order_id,
          statusPt,
        );
        if (avancado) {
          statusAplicado = statusPt;
        } else {
          statusAplicado = null;
          console.log(
            `Checkout: o webhook chegou antes no pedido ${newOrder.order_id}; efeitos ja aplicados la.`,
          );
        }
      } else if (!statusPt && mpStatus) {
        console.warn(
          `Status do MP sem tradução no checkout: "${mpStatus}" — pedido ${newOrder.order_id} segue 'pendente'.`,
        );
      }

      // Carrinho so esvazia com o pedido de pe. Falhar aqui nao pode derrubar
      // uma compra que ja foi cobrada — no pior caso o carrinho fica sujo.
      const limparCarrinho = async () => {
        try {
          await pool.query(
            `DELETE FROM canastra.carrinho_itens
              WHERE carrinho_id IN (
                SELECT carrinho_id FROM canastra.carrinhos WHERE user_id = $1::uuid
              )`,
            [userId],
          );
        } catch (err) {
          console.error("Falha ao limpar o carrinho após a compra:", err.message);
        }
      };

      if (statusAplicado === null) {
        // O webhook decidiu primeiro; estoque e e-mail sao dele. So espelha a
        // limpeza do carrinho se o pedido seguiu vivo.
        const atual = await OrderRepository.getOrderById(
          newOrder.order_id,
        ).catch(() => null);
        if (userId && atual && GRUPO_ATIVO.includes(atual.status)) {
          await limparCarrinho();
        }
      } else if (GRUPO_CANCELADO.includes(statusAplicado)) {
        // O pagamento ja nasceu recusado: a reserva nao se justifica.
        await devolverEstoque(pool, validatedItems);
        estoqueReservado = false;
      } else if (userId) {
        await limparCarrinho();
      }

      // E-mail e efeito colateral: se o provedor estiver fora, o pedido esta
      // pago e gravado do mesmo jeito e a resposta nao pode virar erro.
      Promise.allSettled([
        sendAdminNewOrderEmail(newOrder),
        statusAplicado ? sendStatusEmail(newOrder, statusAplicado) : null,
      ]).then((r) => {
        r.filter((x) => x.status === "rejected").forEach((x) =>
          console.error("Falha ao enviar e-mail do pedido:", x.reason?.message),
        );
      });

      return res.status(201).json({
        message: "Pagamento processado!",
        status: statusPt || mpStatus,
        orderId: newOrder.order_id,
        ticketUrl:
          mpResponse.point_of_interaction?.transaction_data?.ticket_url,
      });
    } catch (error) {
      // Se a transacao ainda estiver aberta, desfaz. Se ja tinha commitado a
      // reserva e o pedido nao chegou a existir, devolve o estoque na mao.
      if (client) {
        await client.query("ROLLBACK").catch(() => {});
      }
      if (estoqueReservado && !pedidoCriado) {
        await devolverEstoque(pool, validatedItems);
      }

      console.error("Erro ao processar pagamento:", error);

      // Quem lanca com intencao carrega `erro.status`; o resto e 500. (Os
      // erros de estoque levam 400 no proprio throw — nada de farejar
      // substring de mensagem para adivinhar a classe do erro.)
      const statusCode = error.status || 500;

      // Detalhe de erro so vaza quando NOS o escrevemos. Mensagem de excecao
      // crua pode carregar SQL, nome de coluna ou resposta do gateway.
      const publico =
        statusCode < 500
          ? error.message
          : "Não foi possível concluir o pagamento. Tente novamente.";

      return res.status(statusCode).json({
        error: error.codigoPublico || "Falha no pagamento",
        details: publico,
      });
    } finally {
      if (client) client.release();
    }
  }

  async receiveWebhook(req, res) {
    /**
     * O webhook e publico por natureza e a unica coisa que separa uma
     * notificacao do Mercado Pago de um POST de qualquer pessoa na internet e
     * a assinatura HMAC (formato: `x-signature: ts=<epoch>,v1=<hmac>` sobre o
     * manifesto `id:<data.id>;request-id:<x-request-id>;ts:<ts>;`).
     *
     * O status NUNCA vem do corpo: ele e relido da API do MP logo abaixo —
     * por isso um terceiro nao consegue forjar transicao nem com o webhook
     * aberto em desenvolvimento.
     */
    if (!validarAssinaturaWebhook(req)) {
      console.warn("Webhook recusado: assinatura inválida.", {
        origem: req.ip,
        requestId: req.headers["x-request-id"],
      });
      // 401 e deliberado: o MP reenvia diante de erro, e queremos que uma
      // notificacao legitima com config errada apareca no painel deles.
      return res.sendStatus(401);
    }

    const { type, data } = req.body;
    if (type !== "payment") return res.sendStatus(200);

    const paymentId = data?.id;

    // A ida ao MP fica FORA da transacao: e rede, e segurar trava de linha
    // durante ela bloquearia o proprio pedido (e o checkout) pelo tempo da
    // resposta. Falhou? 500, e o MP reenvia.
    let statusPt;
    let mpStatus;
    try {
      const mpPayment = await payment.get({ id: paymentId });
      mpStatus = mpPayment.status;
      statusPt = traduzirStatusMp(mpStatus);
    } catch (erro) {
      console.error(`Webhook: falha ao reler o pagamento ${paymentId} no MP:`, erro);
      return res.sendStatus(500);
    }

    console.log(`🔔 Webhook: pagamento ${paymentId} está ${mpStatus} (${statusPt}).`);

    if (!statusPt) {
      // Um status que o vocabulario da loja nao representa (o mapa ja cobre
      // in_mediation e charged_back). Gravar a string crua esbarraria no CHECK
      // de 0009; responder 500 poria o MP em retry infinito de uma notificacao
      // que nunca vamos aplicar. Warn + 200 e a unica saida honesta.
      console.warn(
        `Webhook: status "${mpStatus}" sem tradução — notificação reconhecida e ignorada.`,
      );
      return res.sendStatus(200);
    }

    /**
     * DAQUI PARA BAIXO E UMA TRANSACAO SO, E ERRO DE BANCO E 500 DE VERDADE.
     *
     * A versao anterior devolvia estoque fora de transacao e respondia 200 ate
     * quando o UPDATE falhava — o MP dava a notificacao por entregue e a loja
     * ficava com pedido em status velho para sempre. Agora:
     *
     *   FOR UPDATE  -> duas notificacoes do mesmo pagamento serializam;
     *   status igual -> 200 sem efeito (o reenvio do MP e por desenho);
     *   ativo <-> cancelado -> estoque movimenta UMA vez, na MESMA transacao
     *                          que muda o status;
     *   qualquer erro -> ROLLBACK + 500, para o MP reenviar.
     */
    const client = await pool.connect();
    let pedido;
    let mudou = false;
    try {
      await client.query("BEGIN");

      pedido = await OrderRepository.lockOrderByPaymentId(paymentId, client);

      if (!pedido) {
        await client.query("ROLLBACK");
        // 404 de verdade, logado: ou a notificacao e de um pagamento que nao e
        // desta loja, ou o pedido sumiu — os dois merecem aparecer no painel
        // do MP como falha, nao como entrega.
        console.warn(`⚠️ Webhook: nenhum pedido para o pagamento MP ${paymentId}.`);
        return res.sendStatus(404);
      }

      if (pedido.status !== statusPt) {
        const eraAtivo = GRUPO_ATIVO.includes(pedido.status);
        const ficouCancelado = GRUPO_CANCELADO.includes(statusPt);
        const eraCancelado = GRUPO_CANCELADO.includes(pedido.status);
        const ficouAtivo = GRUPO_ATIVO.includes(statusPt);

        let items = pedido.items;
        if (typeof items === "string") {
          try {
            items = JSON.parse(items);
          } catch (e) {
            console.error("Webhook: itens do pedido ilegíveis:", e);
            items = [];
          }
        }

        // Ordem canonica nas travas de estoque (ver utils/estoque.js): um
        // webhook e um checkout tocando os mesmos produtos em ordens opostas
        // seria deadlock 40P01.
        if (eraAtivo && ficouCancelado && Array.isArray(items)) {
          console.log(`🔄 Devolvendo estoque do pedido ${pedido.order_id}...`);
          for (const item of ordenarPorProduto(items)) {
            await client.query(
              `UPDATE canastra.produtos
                  SET quantidade = quantidade + $1
                WHERE produto_id = $2`,
              [Number(item.quantity), item.product_id],
            );
          }
        } else if (eraCancelado && ficouAtivo && Array.isArray(items)) {
          // O caminho de volta (um rejeitado que o MP reprocessa e aprova):
          // o estoque que a devolucao repos sai de novo. GREATEST(0, ...)
          // porque a prateleira pode ja ter vendido a unidade nesse meio
          // tempo — estoque negativo mentiria pior que zero.
          console.log(`🔄 Rebaixando estoque do pedido ${pedido.order_id}...`);
          for (const item of ordenarPorProduto(items)) {
            await client.query(
              `UPDATE canastra.produtos
                  SET quantidade = GREATEST(0, quantidade - $1)
                WHERE produto_id = $2`,
              [Number(item.quantity), item.product_id],
            );
          }
        }

        await OrderRepository.updateOrderStatus(
          pedido.order_id,
          statusPt,
          null,
          client,
        );
        mudou = true;
      }

      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK").catch(() => {});
      console.error("Erro no Webhook:", error);
      return res.sendStatus(500);
    } finally {
      client.release();
    }

    if (mudou) {
      // E-mail DEPOIS do commit e sem prender a resposta: o provedor fora do
      // ar nao pode fazer o MP reenviar uma transicao ja aplicada.
      sendStatusEmail(pedido, statusPt).catch((e) =>
        console.error("Falha ao enviar e-mail de status:", e.message),
      );
      console.log(`✅ Pedido ${pedido.order_id} atualizado para: ${statusPt}`);
    }

    return res.sendStatus(200);
  }
}

module.exports = new PaymentController();

// Exportados para teste. Sao as duas regras que protegem dinheiro: quanto o
// cliente paga de frete, e quem pode dizer que um pagamento mudou de status.
module.exports.conferirFrete = conferirFrete;
module.exports.validarAssinaturaWebhook = validarAssinaturaWebhook;
