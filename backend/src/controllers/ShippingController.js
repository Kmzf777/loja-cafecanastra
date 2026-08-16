const axios = require("axios");

/** CEPs atendidos por entrega propria. */
const LOCAL_PREFIXES = ["350"];

/**
 * Calcula as opcoes de frete para um CEP e uma lista de itens.
 *
 * Extraido do handler HTTP para poder ser chamado TAMBEM no checkout. O motivo
 * e de seguranca: a rota /shipping/calculate devolve as opcoes ao navegador, e
 * o navegador depois manda `shippingCost` de volta em /checkout/process_payment.
 * Confiar nesse numero deixa qualquer pessoa escolher quanto paga de frete —
 * inclusive valor negativo, que ABATE do total do pedido. Com esta funcao, o
 * checkout recalcula e confere em vez de acreditar.
 *
 * `itens` precisa vir do BANCO (peso e dimensoes reais), nunca do corpo da
 * requisicao: senao o cliente declara um pacote de 1 g e paga frete de carta.
 */
async function calcularOpcoesDeFrete({ zipCode, itens }) {
  const cleanZip = String(zipCode || "").replace(/\D/g, "");
  if (!cleanZip) throw new Error("CEP é obrigatório");

  const totalQuantity = itens.reduce((acc, i) => acc + Number(i.quantity), 0);
  const isLocal = LOCAL_PREFIXES.some((prefix) => cleanZip.startsWith(prefix));

  let shippingOptions = [];
  if (isLocal) {
    shippingOptions.push({
      id: 1,
      name: "Entrega Local",
      price: totalQuantity >= 3 ? 0 : 5,
      days: 1,
      company_picture: "https://cdn-icons-png.flaticon.com/512/7541/7541900.png",
    });
  }

  const productsPayload = itens.map((item) => ({
    id: item.product_id,
    width: item.width ? Number(item.width) : 20,
    height: item.height ? Number(item.height) : 5,
    length: item.length ? Number(item.length) : 20,
    weight: item.weight ? Number(item.weight) : 0.3,
    insurance_value: Number(item.price),
    quantity: Number(item.quantity),
  }));

  const payload = {
    from: { postal_code: process.env.ZIPCODE_ORIGIN },
    to: { postal_code: cleanZip },
    products: productsPayload,
    options: { receipt: false, own_hand: false },
  };

  try {
    const response = await axios.post(
      `${process.env.MELHOR_ENVIO_URL}/api/v2/me/shipment/calculate`,
      payload,
      {
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
          Authorization: `Bearer ${process.env.MELHOR_ENVIO_TOKEN}`,
          "User-Agent": `${process.env.LOJA_NOME || "Cafe Canastra"}/1.0 (${process.env.LOJA_EMAIL || "contato@cafecanastra.com"})`,
        },
        timeout: 12000,
      },
    );

    const apiOptions = (response.data || [])
      .filter((opt) => !opt.error)
      .map((opt) => ({
        id: opt.id,
        name: `${opt.company.name} ${opt.name}`,
        price: Number(opt.price),
        days: opt.delivery_time,
        company_picture: opt.company.picture,
      }));

    shippingOptions = [...shippingOptions, ...apiOptions];
  } catch (apiError) {
    console.error("Erro na API Melhor Envio:", apiError.message);
    // Se a entrega local ja cobre o CEP, seguimos com ela; senao o chamador
    // decide (a rota HTTP devolve 500, o checkout recusa o pedido).
    if (shippingOptions.length === 0) {
      const erro = new Error("Erro ao calcular frete externo.");
      erro.code = "FRETE_INDISPONIVEL";
      throw erro;
    }
  }

  return shippingOptions;
}

class ShippingController {
  async calculate(req, res) {
    try {
      const { zipCode, items } = req.body;
      if (!zipCode) return res.status(400).json({ error: "CEP é obrigatório" });
      if (!Array.isArray(items) || items.length === 0) {
        return res.status(400).json({ error: "Informe os itens do carrinho." });
      }

      const opcoes = await calcularOpcoesDeFrete({ zipCode, itens: items });
      return res.json(opcoes);
    } catch (error) {
      if (error.code === "FRETE_INDISPONIVEL") {
        return res.status(500).json({ error: error.message });
      }
      console.error("Erro geral no frete:", error);
      return res.status(500).json({ error: "Falha ao calcular frete" });
    }
  }
}

module.exports = new ShippingController();
module.exports.calcularOpcoesDeFrete = calcularOpcoesDeFrete;
