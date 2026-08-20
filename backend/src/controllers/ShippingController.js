const axios = require("axios");
const pool = require("../pgPool");

/** CEPs atendidos por entrega propria. */
const LOCAL_PREFIXES = ["350"];

/**
 * O piso do frete gratis, em centavos, lido de `canastra.config_loja` (0009).
 *
 * FRETE GRATIS E REGRA DE SERVIDOR (decisao 3 do plano mestre): o navegador
 * exibe a barra de progresso, mas quem decide e esta leitura — a mesma para a
 * cotacao publica e para o `conferirFrete` do checkout, entao os dois lados
 * sempre concordam.
 *
 * `0` DESLIGA o frete gratis, de proposito e nao por acidente aritmetico:
 * "subtotal >= 0" seria verdadeiro para todo carrinho, e um admin zerando o
 * campo por engano daria frete gratis para a loja inteira — o erro caro e
 * silencioso. Quem quiser frete gratis sempre poe 1 centavo.
 *
 * O catch aqui NAO e um catch mentiroso, e a distincao esta medida nos
 * testes: falhar a leitura NAO devolve dado errado como se fosse certo —
 * devolve "sem frete gratis", com erro no log, e o cliente paga o frete real.
 * A cotacao publica nao pode cair junto com o banco (ela funciona ate sem
 * cadastro), e no checkout o banco acabou de responder o estoque, entao a
 * janela real disso e minima. O modo de falha e visivel: o navegador manda 0,
 * a recotacao vem com preco, e o checkout responde 409 "o frete mudou".
 */
async function freteGratisMinimoCentavos() {
  try {
    const { rows } = await pool.query(
      "SELECT frete_gratis_minimo_centavos FROM canastra.config_loja WHERE id = 1",
    );
    if (!rows.length) return null;
    const minimo = Number(rows[0].frete_gratis_minimo_centavos);
    return Number.isInteger(minimo) && minimo > 0 ? minimo : null;
  } catch (erro) {
    console.error(
      "Frete grátis: não consegui ler config_loja, cotando SEM o desconto:",
      erro.message,
    );
    return null;
  }
}

/**
 * Subtotal dos itens em CENTAVOS. `price` viaja em reais (contrato antigo);
 * cada preco vira inteiro ANTES da soma, porque `49.67 * 3` em float da
 * 149.01000000000002 e uma comparacao em reais erraria exatamente na
 * fronteira do piso.
 */
function subtotalEmCentavos(itens) {
  return itens.reduce(
    (acc, i) => acc + Math.round(Number(i.price) * 100) * Number(i.quantity),
    0,
  );
}

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

  /**
   * O frete gratis entra por ULTIMO, sobre as opcoes ja cotadas: quando o
   * subtotal atinge o piso, toda opcao com preco vira `price: 0` com o
   * marcador `gratis: true` (a vitrine usa o marcador para dizer "gratis" em
   * vez de "R$ 0,00"). Zerar TODAS as opcoes, e nao so as externas, e o que
   * mantem o `conferirFrete` simples: qualquer opcao real casa com o zero.
   *
   * Na cotacao publica o `price` dos itens vem do navegador e vale como
   * SUGESTAO, como o resto da cotacao; quem decide dinheiro e o checkout, que
   * chama esta mesma funcao com os precos relidos do banco.
   */
  const minimo = await freteGratisMinimoCentavos();
  if (minimo !== null && subtotalEmCentavos(itens) >= minimo) {
    shippingOptions = shippingOptions.map((opcao) => ({
      ...opcao,
      price: 0,
      gratis: true,
    }));
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
