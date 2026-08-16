const crypto = require("node:crypto");
const { payment } = require("../config/mercadopago");
const OrderRepository = require("../repositories/ordersRepository");
const pool = require("../pgPool");
const PromotionsRepository = require("../repositories/promotionsRepository");
const { calcularOpcoesDeFrete } = require("./ShippingController");
const promotionsRepo = new PromotionsRepository();
const {
  sendStatusEmail,
  sendAdminNewOrderEmail,
} = require("../utils/emailSender");

/** Tolerancia de centavo ao comparar o frete recalculado com o enviado. */
const TOLERANCIA_FRETE = 0.01;

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

/** Compensacao: devolve ao estoque o que uma reserva ja tinha tirado. */
async function devolverEstoque(client, itens) {
  for (const item of itens) {
    try {
      await client.query(
        "UPDATE products SET quantity = quantity + $1 WHERE product_id = $2",
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

class PaymentController {
  async createPayment(req, res) {
    const client = await pool.connect();
    // Fora do try: o bloco de erro precisa saber em que ponto do fluxo parou.
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

      if (userId) {
        const userCheck = await client.query(
          "SELECT cpf FROM users WHERE user_id = $1",
          [userId],
        );

        if (userCheck.rowCount === 0 || !userCheck.rows[0].cpf) {
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
       */
      for (const item of items) {
        const q = Number(item.quantity);
        if (!Number.isInteger(q) || q < 1 || q > 999) {
          return res
            .status(400)
            .json({ error: "Quantidade inválida em um dos itens." });
        }
      }

      const activePromotions =
        await promotionsRepo.findActivePromotionsForCheckout();

      let validatedTotalAmount = 0;

      /**
       * Tudo que le e reserva estoque roda numa transacao so.
       *
       * Antes a checagem de estoque e a baixa eram duas consultas soltas,
       * separadas por uma chamada de rede ao Mercado Pago. Duas compras
       * simultanea do ultimo pacote passavam as duas pela checagem, e o
       * `GREATEST(0, ...)` da baixa escondia o rombo zerando em vez de falhar.
       * `FOR UPDATE` serializa os concorrentes na linha do produto.
       */
      await client.query("BEGIN");

      for (const item of items) {
        const { rows } = await client.query(
          `SELECT quantity, price, name, category, product_id, image, size,
                  weight, width, height, length
             FROM products
            WHERE product_id = $1
              FOR UPDATE`,
          [item.product_id],
        );

        if (rows.length === 0) {
          throw new Error(`O produto "${item.name}" não existe mais.`);
        }

        const productDb = rows[0];
        const stockAtual = Number(productDb.quantity);
        const qtdSolicitada = Number(item.quantity);
        const precoOriginal = Number(productDb.price);

        if (stockAtual < qtdSolicitada) {
          throw new Error(
            `Estoque insuficiente para "${productDb.name}". Restam ${stockAtual} unidades.`,
          );
        }

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

        validatedTotalAmount += bestPrice * qtdSolicitada;

        validatedItems.push({
          product_id: productDb.product_id,
          name: productDb.name,
          image: productDb.image,
          price: bestPrice,
          quantity: qtdSolicitada,
          size: productDb.size,
          // Peso e dimensoes reais, para o frete ser reconferido com o pacote
          // de verdade e nao com o que o cliente disser que e.
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
       * O `WHERE quantity >= $1` e a rede de seguranca final: se ainda assim
       * a linha nao casar, rowCount = 0 e o pedido inteiro e desfeito, em vez
       * de gravar estoque negativo.
       */
      for (const item of validatedItems) {
        const baixa = await client.query(
          `UPDATE products
              SET quantity = quantity - $1
            WHERE product_id = $2 AND quantity >= $1`,
          [item.quantity, item.product_id],
        );
        if (baixa.rowCount === 0) {
          throw new Error(`Estoque insuficiente para "${item.name}".`);
        }
      }

      const freteConferido = await conferirFrete({
        address,
        itens: validatedItems,
        shippingCost,
        shippingMethod,
      });

      const finalAmountToCharge = Number(
        (validatedTotalAmount + freteConferido).toFixed(2),
      );

      if (!(finalAmountToCharge > 0)) {
        const erro = new Error("Valor total do pedido inválido.");
        erro.status = 400;
        throw erro;
      }

      /**
       * Fecha a transacao com o estoque JA reservado.
       *
       * A chamada ao Mercado Pago e rede: segurar as travas de `FOR UPDATE`
       * durante ela bloquearia todo mundo que quisesse comprar o mesmo produto
       * pelo tempo da resposta do gateway. Commit aqui, e se a cobranca falhar
       * o bloco de compensacao logo abaixo devolve o estoque.
       */
      await client.query("COMMIT");
      estoqueReservado = true;

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
        await devolverEstoque(client, validatedItems);
        estoqueReservado = false;
        throw falhaNoGateway;
      }

      const mpStatus = mpResponse.status;
      const mpId = mpResponse.id;

      // Cria o pedido
      const newOrder = await OrderRepository.createOrder({
        userId: userId,
        totalAmount: finalAmountToCharge,
        items: validatedItems,
        paymentMethod: finalPaymentMethodId,
        paymentIdMp: mpId.toString(),
        address_json: address,
        // O frete gravado no pedido e o CONFERIDO, nao o que o cliente mandou.
        shippingCost: freteConferido,
        shippingMethod: shippingMethod || "Retirada",
      });

      pedidoCriado = newOrder;

      if (mpStatus) {
        await OrderRepository.updateOrderStatus(newOrder.order_id, mpStatus);
      }

      // Se o pagamento ja nasceu recusado, a reserva nao se justifica.
      if (["rejected", "cancelled"].includes(mpStatus)) {
        await devolverEstoque(client, validatedItems);
        estoqueReservado = false;
      } else if (userId) {
        // Carrinho so esvazia com o pedido de pe. Falhar aqui nao pode derrubar
        // uma compra que ja foi cobrada — no pior caso o carrinho fica sujo.
        try {
          await client.query(
            `DELETE FROM cart_items
              WHERE cart_id IN (SELECT cart_id FROM carts WHERE user_id = $1::uuid)`,
            [userId],
          );
        } catch (err) {
          console.error("Falha ao limpar o carrinho após a compra:", err.message);
        }
      }

      // E-mail e efeito colateral: se o provedor estiver fora, o pedido esta
      // pago e gravado do mesmo jeito e a resposta nao pode virar erro.
      Promise.allSettled([
        sendAdminNewOrderEmail(newOrder),
        mpStatus ? sendStatusEmail(newOrder, mpStatus) : null,
      ]).then((r) => {
        r.filter((x) => x.status === "rejected").forEach((x) =>
          console.error("Falha ao enviar e-mail do pedido:", x.reason?.message),
        );
      });

      return res.status(201).json({
        message: "Pagamento processado!",
        status: mpStatus,
        orderId: newOrder.order_id,
        ticketUrl:
          mpResponse.point_of_interaction?.transaction_data?.ticket_url,
      });
    } catch (error) {
      // Se a transacao ainda estiver aberta, desfaz. Se ja tinha commitado a
      // reserva e o pedido nao chegou a existir, devolve o estoque na mao.
      try {
        await client.query("ROLLBACK");
      } catch {
        /* nao havia transacao aberta */
      }
      if (estoqueReservado && !pedidoCriado) {
        await devolverEstoque(client, validatedItems);
      }

      console.error("Erro ao processar pagamento:", error);

      const statusCode =
        error.status ||
        (String(error.message).includes("Estoque insuficiente") ? 400 : 500);

      // Detalhe de erro so vaza quando NOS o escrevemos. Mensagem de excecao
      // crua pode carregar SQL, nome de coluna ou resposta do gateway.
      const publico =
        statusCode < 500
          ? error.message
          : "Não foi possível concluir o pagamento. Tente novamente.";

      return res.status(statusCode).json({
        error: "Falha no pagamento",
        details: publico,
      });
    } finally {
      client.release();
    }
  }

  async receiveWebhook(req, res) {
    /**
     * O webhook e publico por natureza: fica ANTES do middleware de CSRF em
     * index.js e nao tem sessao. A unica coisa que separa uma notificacao do
     * Mercado Pago de um POST de qualquer pessoa na internet e a assinatura.
     *
     * Sem esta conferencia, um terceiro conseguia disparar o handler para
     * qualquer id de pagamento e provocar devolucao de estoque e disparo de
     * e-mail de status em pedidos que nao sao dele. (O status em si nunca foi
     * forjavel: ele e relido da API do MP logo abaixo, nao do corpo.)
     *
     * Formato: header `x-signature: ts=<epoch>,v1=<hmac>`, sobre o manifesto
     * `id:<data.id>;request-id:<x-request-id>;ts:<ts>;` com HMAC-SHA256.
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

    const client = await pool.connect();
    try {
      const { type, data } = req.body;

      if (type === "payment") {
        const paymentId = data.id;
        const mpPayment = await payment.get({ id: paymentId });
        const currentStatus = mpPayment.status;

        console.log(
          `🔔 Webhook recebido: Pagamento ${paymentId} está ${currentStatus}`,
        );

        const order = await OrderRepository.getOrderByPaymentId(paymentId);

        if (order) {
          if (order.status !== currentStatus) {
            // Mesmos grupos do painel (OrderController). "refunded" tambem
            // devolve estoque: um estorno e um cancelamento depois do pago.
            const cancelledGroup = ["cancelled", "rejected", "refunded"];
            const activeGroup = [
              "pending",
              "approved",
              "in_process",
              "authorized",
              "sent",
              "delivered",
            ];
            const isNowCancelled = cancelledGroup.includes(currentStatus);
            const wasActive = activeGroup.includes(order.status);

            if (wasActive && isNowCancelled) {
              console.log(
                `🔄 Devolvendo estoque para o pedido ${order.order_id}...`,
              );

              let items = order.items;
              if (typeof items === "string") {
                try {
                  items = JSON.parse(items);
                } catch (e) {
                  console.error("Erro ao parsear itens:", e);
                  items = [];
                }
              }

              if (Array.isArray(items)) {
                for (const item of items) {
                  await client.query(
                    `UPDATE products 
                             SET quantity = quantity::integer + $1 
                             WHERE product_id = $2`,
                    [Number(item.quantity), item.product_id],
                  );
                }
                console.log("✅ Estoque devolvido com sucesso.");
              }
            }

            await OrderRepository.updateOrderStatus(
              order.order_id,
              currentStatus,
            );

            await sendStatusEmail(order, currentStatus);

            console.log(
              `✅ Pedido ${order.order_id} atualizado para: ${currentStatus}`,
            );
          }
        } else {
          console.warn(
            `⚠️ Pedido não encontrado para o pagamento MP: ${paymentId}`,
          );
        }
      }

      return res.sendStatus(200);
    } catch (error) {
      console.error("Erro no Webhook:", error);
      return res.sendStatus(500);
    } finally {
      client.release();
    }
  }
}

module.exports = new PaymentController();

// Exportados para teste. Sao as duas regras que protegem dinheiro: quanto o
// cliente paga de frete, e quem pode dizer que um pagamento mudou de status.
module.exports.conferirFrete = conferirFrete;
module.exports.validarAssinaturaWebhook = validarAssinaturaWebhook;

