const { payment } = require("../config/mercadopago");
const OrderRepository = require("../repositories/ordersRepository");
const pool = require("../pgPool");
const PromotionsRepository = require("../repositories/promotionsRepository");
const promotionsRepo = new PromotionsRepository();
const {
  sendStatusEmail,
  sendAdminNewOrderEmail,
} = require("../utils/emailSender");

class PaymentController {
  async createPayment(req, res) {
    const client = await pool.connect();
    try {
      const {
        formData,
        items,
        userId,
        userEmail,
        paymentMethodType,
        address,
        shippingCost,
        shippingMethod,
      } = req.body;

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

      if (!items || items.length === 0) {
        return res.status(400).json({ error: "Carrinho vazio" });
      }

      const activePromotions =
        await promotionsRepo.findActivePromotionsForCheckout();

      let validatedTotalAmount = 0;
      const validatedItems = [];

      for (const item of items) {
        const { rows } = await client.query(
          "SELECT quantity, price, name, category, product_id, image, size FROM products WHERE product_id = $1",
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
        });
      }

      let finalAmountToCharge = Number(validatedTotalAmount.toFixed(2));

      if (shippingCost) {
        finalAmountToCharge += Number(shippingCost);
      }

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
        description: `Pedido Shopnaw - ${validatedItems.length} itens`,
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

      const mpResponse = await payment.create({ body: paymentData });
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
        shippingCost: Number(shippingCost || 0),
        shippingMethod: shippingMethod || "Retirada",
      });

      await sendAdminNewOrderEmail(newOrder);

      if (mpStatus) {
        await OrderRepository.updateOrderStatus(newOrder.order_id, mpStatus);
        await sendStatusEmail(newOrder, mpStatus);
      }

      // --- ATUALIZAÇÃO DE ESTOQUE ---
      if (
        mpStatus === "approved" ||
        mpStatus === "pending" ||
        mpStatus === "in_process"
      ) {
        try {
          for (const item of items) {
            await client.query(
              `UPDATE products 
                       SET quantity = GREATEST(0, quantity::integer - $1)
                       WHERE product_id = $2`,
              [Number(item.quantity), item.product_id],
            );
          }

          if (userId) {
            const cartRes = await client.query(
              "SELECT cart_id FROM carts WHERE user_id = $1::uuid LIMIT 1",
              [userId],
            );

            if (cartRes.rows.length > 0) {
              const cartId = cartRes.rows[0].cart_id;
              await client.query(
                "DELETE FROM cart_items WHERE cart_id = $1::uuid",
                [cartId],
              );
            }
          }
        } catch (err) {
          console.error("Erro pós-pagamento (estoque/carrinho):", err);
        }
      }
      return res.status(201).json({
        message: "Pagamento processado!",
        status: mpStatus,
        orderId: newOrder.order_id,
        ticketUrl:
          mpResponse.point_of_interaction?.transaction_data?.ticket_url,
      });
    } catch (error) {
      console.error("Erro ao processar pagamento:", error);
      const statusCode = error.message.includes("Estoque insuficiente")
        ? 400
        : 500;
      return res.status(statusCode).json({
        error: "Falha no pagamento",
        details: error.message || "Erro desconhecido",
      });
    } finally {
      client.release();
    }
  }

  async receiveWebhook(req, res) {
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
            const cancelledGroup = ["cancelled", "rejected"];
            const activeGroup = [
              "pending",
              "approved",
              "in_process",
              "authorized",
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
