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
const {
  ordenarPorProduto,
  lerItensDoPedido,
  aplicarTransicaoDeEstoque,
  DEVOLVEU,
  REBAIXOU,
} = require("../utils/estoque");
// `precoComPromocao` morou aqui até a F6; foi para utils/preco.js quando o
// POST /cupons/validar virou o terceiro chamador — o histórico e o porquê
// estão no próprio módulo.
const { precoComPromocao, somarCentavos } = require("../utils/preco");
// `garantirCpf` morou AQUI dentro ate a revisao transversal da F7. Foi para
// utils/cpf.js quando a adesao do Clube virou o segundo chamador — o
// comportamento e o mesmo, linha por linha; o contrato esta no proprio modulo.
const { garantirCpf } = require("../utils/cpf");
const { avaliarCupom, normalizarCodigo } = require("../utils/cupom");
const cuponsRepository = require("../repositories/cuponsRepository");
const promotionsRepo = new PromotionsRepository();
const {
  sendStatusEmail,
  sendAdminNewOrderEmail,
} = require("../utils/emailSender");
// Bling (onda 3G): o gatilho `aoAprovarPedido` é quem decide se age — ele
// mesmo confere BLING_ATIVO e roda fora da resposta, com catch (o padrão dos
// e-mails). Daqui só sai a CHAMADA, sempre depois do commit.
const blingPedidos = require("../services/blingPedidos");

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
 *
 * `descontoCentavos` (F6) e o cupom entrando na MESMA regra: o frete gratis e
 * decidido pelo subtotal COM desconto, entao a recotacao daqui tem de usar o
 * mesmo numero que a cotacao do navegador usou (a rota /shipping/calculate
 * aceita `cupom` e desconta identicamente) — senao um cupom que derruba o
 * subtotal para baixo do piso geraria 409 falso, ou pior, o contrario: frete
 * gratis decidido pelo subtotal cheio de um pedido que o cupom baratearia.
 */
async function conferirFrete({
  address,
  itens,
  shippingCost,
  shippingMethod,
  descontoCentavos = 0,
}) {
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
    opcoes = await calcularOpcoesDeFrete({ zipCode: cep, itens, descontoCentavos });
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
 * A FRASE do 409 de preco. Uma constante porque a conferencia roda DUAS vezes
 * (antes e dentro da transacao) e as duas tem de dizer exatamente o mesmo.
 */
const FRASE_PRECO_MUDOU =
  "O preço de um item mudou desde que você abriu a sacola — confira o resumo.";

/**
 * Confere o SUBTOTAL DOS ITENS que o navegador exibiu contra o que o servidor
 * acabou de ler do banco. Irma gemea de `conferirFrete`, logo acima, e pelo
 * mesmo motivo: o numero que o cliente VIU e o numero que a loja COBRA tem de
 * ser o mesmo, e ate aqui so o frete tinha essa conferencia.
 *
 * O buraco que ela fecha: a sacola guarda `price` no localStorage e nunca o
 * revalida; o servidor cobra o preco do BANCO. Se o gestor mudar um preco
 * enquanto alguem esta com a sacola aberta, o cliente e cobrado por um valor
 * diferente do que leu na tela — no cartao e pior ainda, porque o CardForm e
 * montado com o total exibido e o `transaction_amount` enviado ao MP e o do
 * servidor.
 *
 * TOLERANCIA ZERO, e de proposito: preco nao e frete. O 409 do frete tolera um
 * centavo porque compara com uma COTACAO de transportadora, que arredonda; aqui
 * os dois lados somam `round(preco * 100) * quantidade` sobre a mesma linha do
 * banco. Um centavo de diferenca E preco diferente.
 *
 * O QUE SE COMPARA E O SUBTOTAL DE VITRINE — a soma dos precos de CATALOGO, sem
 * promocao, sem cupom e sem frete. Nao e o valor cobrado, e nem deveria ser: e
 * exatamente o que a vitrine mostra (`repositorio.ts` sobrepoe `preco` do banco
 * sobre o JSON editorial e a sacola guarda esse numero) e portanto o unico
 * numero que os dois lados calculam a partir da MESMA base. Comparar contra o
 * valor promocional daria 409 em toda venda com promocao ativa — a vitrine nao
 * renderiza preco promocional, entao o navegador nunca teria como acertar —, e
 * `precoComPromocao` so ABAIXA o preco (ver utils/preco.js): promocao aparecendo
 * ou sumindo no meio do caminho so faz o cliente pagar menos do que viu, que e
 * o lado seguro do erro.
 *
 * `declarado` nulo = nenhuma conferencia. O campo e OPCIONAL no contrato porque
 * o checkout legado (frontend/legacy/pages/Checkout/Checkout.jsx) ainda nao o
 * manda, e recusar o pedido dele seria trocar um defeito de exibicao por uma
 * loja que nao vende. Nao ha risco de seguranca em omitir: o valor cobrado
 * NUNCA sai deste campo — ele so serve para o servidor perceber que a tela do
 * cliente esta velha.
 */
function conferirSubtotal(declarado, subtotalDeVitrineCentavos) {
  if (declarado === null) return;
  if (declarado === subtotalDeVitrineCentavos) return;

  const erro = new Error(FRASE_PRECO_MUDOU);
  erro.status = 409;
  // Codigo proprio para o navegador reconhecer ESTE 409 e recarregar os precos
  // em vez de so exibir a frase — um 409 de frete pede outra acao.
  erro.codigoPublico = "PRECO_MUDOU";
  throw erro;
}

/**
 * Le `subtotalCentavos` do corpo. Ausente vira `null` (sem conferencia, ver
 * acima); presente mas torto e 400 na hora — cair no silencio desarmaria a
 * unica protecao que o cliente tem contra pagar diferente do que viu, e um
 * campo que "as vezes protege" e pior que campo nenhum.
 */
function lerSubtotalDeclarado(valor) {
  if (valor === undefined || valor === null) return null;
  const n = Number(valor);
  if (!Number.isSafeInteger(n) || n < 0) {
    const erro = new Error(
      "Subtotal do pedido inválido: use o total dos itens em centavos.",
    );
    erro.status = 400;
    throw erro;
  }
  return n;
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
    // O cupom fica FORA do try pelo mesmo motivo do resto: o bloco de erro
    // compensa (devolve o uso junto com o estoque) e precisa alcancar os dois.
    let cupomAplicado = null;
    let usoDeCupomReservado = false;

    /**
     * A compensacao COMPLETA de uma reserva ja commitada: estoque de volta e,
     * se um cupom foi consumido na mesma transacao, o uso de volta junto.
     * Fatorada porque roda em QUATRO lugares (gateway caiu, 23505 do INSERT,
     * pagamento nascido recusado, catch externo) e a versao repetida ja tinha
     * quase esquecido o cupom num deles. Os flags zeram aqui dentro para a
     * proxima chamada — inclusive a do catch — ser no-op em vez de dobro.
     */
    const compensarReserva = async () => {
      if (estoqueReservado) {
        await devolverEstoque(pool, validatedItems);
        estoqueReservado = false;
      }
      if (usoDeCupomReservado && cupomAplicado) {
        await cuponsRepository.devolverUso(cupomAplicado.id, pool);
        usoDeCupomReservado = false;
      }
    };
    try {
      const {
        formData,
        items,
        userEmail,
        paymentMethodType,
        address,
        shippingCost,
        shippingMethod,
        cupom,
        // O subtotal dos itens QUE A TELA EXIBIU, em centavos, sem frete e sem
        // desconto. Nao entra em conta nenhuma — so e conferido (ver
        // `conferirSubtotal`). Opcional: o checkout legado ainda nao o manda.
        subtotalCentavos,
      } = req.body;

      const subtotalDeclarado = lerSubtotalDeclarado(subtotalCentavos);

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
      // O subtotal de CATALOGO desta leitura — a base que a vitrine exibe, sem
      // promocao. E o numero que a conferencia de preco compara.
      let subtotalDeVitrinePreviaCentavos = 0;
      for (const item of itensOrdenados) {
        const previa = previaPorId.get(item.product_id);
        if (!previa) {
          const erro = new Error(`O produto "${item.name}" não existe mais.`);
          erro.status = 400;
          throw erro;
        }
        subtotalDeVitrinePreviaCentavos +=
          Math.round(Number(previa.price) * 100) * Number(item.quantity);
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

      /**
       * PRECO, PRIMEIRA PASSADA — a que da a resposta CERTA depressa.
       *
       * A conferencia que vale dinheiro e a de baixo, sobre os precos travados;
       * esta existe porque um preco mudado tambem muda o frete (o piso do frete
       * gratis e comparado com o subtotal), e sem ela o cliente receberia
       * primeiro o 409 do FRETE — mandando recalcular a entrega quando o que
       * mudou foi a etiqueta do café. Alem disso, `conferirFrete` pode chamar a
       * transportadora (ate 12s de rede): cotar um pedido que ja sabemos que vai
       * ser recusado e trabalho jogado fora.
       *
       * Mesmo desenho das DUAS passadas do cupom, logo abaixo, e pela mesma
       * razao: a leitura sem trava serve para responder, a leitura travada serve
       * para cobrar.
       */
      conferirSubtotal(subtotalDeclarado, subtotalDeVitrinePreviaCentavos);

      /**
       * CUPOM, PRIMEIRA PASSADA (F6). O navegador manda so o CODIGO; o
       * desconto que ele exibiu nunca e aceito — e recalculado aqui sobre o
       * subtotal dos precos do BANCO ja promocionais (o cupom desconta sobre
       * o preco com promocao, mesma `precoComPromocao` da cobranca).
       *
       * A avaliacao roda ANTES da conferencia de frete por necessidade, nao
       * por estilo: o frete gratis e decidido pelo subtotal COM desconto, e a
       * recotacao precisa do numero. Cupom invalido para AQUI, com frase, sem
       * reservar nem cobrar nada.
       */
      const codigoDeCupom = normalizarCodigo(cupom);
      let descontoPrevioCentavos = 0;
      if (codigoDeCupom) {
        cupomAplicado = await cuponsRepository.buscarPorCodigo(codigoDeCupom);
        const subtotalPrevioCentavos = somarCentavos(itensParaCotacao);
        const avaliacao = avaliarCupom(cupomAplicado, subtotalPrevioCentavos);
        if (!avaliacao.valido) {
          const erro = new Error(avaliacao.motivo);
          erro.status = 400;
          erro.codigoPublico = "CUPOM_INVALIDO";
          throw erro;
        }
        descontoPrevioCentavos = avaliacao.descontoCentavos;
      }

      const freteConferido = await conferirFrete({
        address,
        itens: itensParaCotacao,
        shippingCost,
        shippingMethod,
        descontoCentavos: descontoPrevioCentavos,
      });

      /**
       * Subtotal em CENTAVOS e inteiro. Ate a F6 a soma era em reais
       * (`validatedTotalAmount`); com o desconto entrando na conta, a
       * subtracao passa a acontecer exatamente na fronteira de um piso
       * (frete gratis, total > 0) — e float erra fronteira. Cada bestPrice
       * ja sai arredondado a centavo, entao a conversao aqui e exata.
       */
      let validatedSubtotalCentavos = 0;

      /**
       * O MESMO subtotal, mas de CATALOGO (sem promocao) e sobre as linhas
       * TRAVADAS: e este que a conferencia de preco compara com o que a tela
       * exibiu. Anda lado a lado com o de cima porque um cobra e o outro
       * confere — ver `conferirSubtotal`.
       */
      let subtotalDeVitrineCentavos = 0;

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
        validatedSubtotalCentavos += Math.round(bestPrice * 100) * qtdSolicitada;
        subtotalDeVitrineCentavos +=
          Math.round(Number(productDb.price) * 100) * qtdSolicitada;

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
       * PRECO, SEGUNDA PASSADA — A QUE VALE DINHEIRO.
       *
       * Sobre as linhas TRAVADAS, portanto sobre exatamente os precos que vao
       * ser cobrados: se um preco mudou entre a leitura previa e esta, e AQUI
       * que a divergencia aparece. Roda ANTES da reserva de estoque e da
       * reserva do uso do cupom — o throw vira ROLLBACK e o pedido morre sem
       * ter tirado nada da prateleira, sem gastar cupom e (obviamente) sem
       * cobrar: o gateway so entra em cena depois do COMMIT.
       */
      conferirSubtotal(subtotalDeclarado, subtotalDeVitrineCentavos);

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

      /**
       * CUPOM, SEGUNDA PASSADA — a que vale dinheiro. Reavalia com a MESMA
       * funcao sobre o subtotal dos precos TRAVADOS (se um preco mudou entre
       * as duas leituras, e este que sera cobrado), e so entao reserva o uso:
       *
       *   UPDATE ... SET usos = usos + 1
       *    WHERE ativo AND (limite_usos IS NULL OR usos < limite_usos)
       *
       * O incremento atomico e a trava do esgotamento — dois checkouts no
       * ultimo uso serializam na linha do cupom e o segundo recebe rowCount 0
       * AQUI, dentro da transacao de reserva, ANTES de cobrar: o throw abaixo
       * vira ROLLBACK e devolve estoque e uso juntos, de graca.
       */
      let descontoCentavos = 0;
      if (cupomAplicado) {
        const reavaliacao = avaliarCupom(
          cupomAplicado,
          validatedSubtotalCentavos,
        );
        if (!reavaliacao.valido) {
          const erro = new Error(reavaliacao.motivo);
          erro.status = 400;
          erro.codigoPublico = "CUPOM_INVALIDO";
          throw erro;
        }
        descontoCentavos = reavaliacao.descontoCentavos;

        const reservou = await cuponsRepository.reservarUso(
          cupomAplicado.id,
          client,
        );
        if (!reservou) {
          const erro = new Error("Cupom esgotado");
          erro.status = 400;
          erro.codigoPublico = "CUPOM_INVALIDO";
          throw erro;
        }
      }

      const finalAmountToCharge = Number(
        (
          (validatedSubtotalCentavos - descontoCentavos) / 100 +
          freteConferido
        ).toFixed(2),
      );

      if (!(finalAmountToCharge > 0)) {
        // Dois motivos possiveis, duas frases: um cupom fixed pode cobrir o
        // subtotal inteiro (o desconto trava la, mas com frete zero o total
        // fecha em 0.00) — e "valor invalido" mandaria a pessoa cacar um erro
        // que nao cometeu. O MP nao cobra R$ 0, e pedido gratis nao e um
        // fluxo que esta loja vende.
        const erro = new Error(
          cupomAplicado && descontoCentavos >= validatedSubtotalCentavos
            ? "O cupom cobre o valor inteiro do pedido; ajuste os itens ou fale com a gente."
            : "Valor total do pedido inválido.",
        );
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
      // O uso do cupom commitou JUNTO com a reserva: a partir daqui, toda
      // compensacao de estoque devolve o uso tambem.
      usoDeCupomReservado = Boolean(cupomAplicado);
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
        // do estoque sem ninguem ter comprado. O uso do cupom volta junto —
        // ele foi reservado na mesma transacao e um cupom "gasto" numa compra
        // que nao existiu esgotaria o limite sem vender nada.
        await compensarReserva();
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
          // A fotografia do cupom (0010): o codigo usado e o desconto em
          // reais, ambos os RECALCULADOS — nunca o que o navegador exibiu.
          cupomCodigo: cupomAplicado ? cupomAplicado.codigo : null,
          desconto: descontoCentavos / 100,
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
          await compensarReserva();
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
          /**
           * A compra ENCERRA o episodio do lembrete de abandono (F6): a marca
           * `lembrete_enviado_em` significa "esta sacola ja foi lembrada", e
           * a sacola que ela lembrava acabou de virar pedido. Sem o reset, o
           * cliente que comprou e depois montou OUTRA sacola nunca mais
           * receberia lembrete — "um lembrete por carrinho" e por episodio de
           * abandono, nao por cliente para sempre. Semantica documentada na
           * 0011 e no job (jobs/carrinhoAbandonado.js).
           */
          await pool.query(
            `UPDATE canastra.carrinhos
                SET lembrete_enviado_em = NULL
              WHERE user_id = $1::uuid AND lembrete_enviado_em IS NOT NULL`,
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
        // O pagamento ja nasceu recusado: a reserva nao se justifica — e o
        // uso do cupom tampouco, porque a venda nao aconteceu. (Se o webhook
        // tivesse vencido esta corrida, statusAplicado seria null e quem
        // devolve estoque E uso e ele — ver receiveWebhook.)
        await compensarReserva();
      } else if (userId) {
        await limparCarrinho();
      }

      /**
       * BLING (3G): o pagamento APROVADO na resposta sincrona vai ao ERP.
       * Nao bloqueante e depois de todo commit — uma falha do Bling vira log
       * e `bling_id` nulo, nunca erro num pagamento que ja aconteceu; o
       * painel ressincroniza (POST /bling/pedidos/:id/sincronizar). Quando o
       * webhook vence a corrida (statusAplicado null), o gatilho e DELE.
       */
      if (statusAplicado === "aprovado") {
        blingPedidos.aoAprovarPedido(newOrder.order_id);
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
      // O uso do cupom foi commitado na mesma transacao da reserva; se a
      // reserva esta voltando na mao, ele volta junto (compensarReserva zera
      // os flags, entao um caminho que ja compensou nao compensa duas vezes).
      if (!pedidoCriado) {
        await compensarReserva();
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
        const items = lerItensDoPedido(pedido.items, "Webhook");

        /**
         * A MOVIMENTAÇÃO em si mora em utils/estoque.js desde a revisão da
         * 3J: era um bloco copiado aqui e no webhook do Clube, e um status
         * novo em GRUPO_* obrigava a acertar os dois. O helper decide a
         * travessia (ativo↔cancelado), itera em ordem canônica — um webhook e
         * um checkout tocando os mesmos produtos em ordens opostas seria
         * deadlock 40P01 — e diz o que fez. O que sobra AQUI é o que é só
         * deste webhook: o uso do cupom.
         */
        const movimento = await aplicarTransicaoDeEstoque(
          client,
          items,
          pedido.status,
          statusPt,
        );

        if (movimento === DEVOLVEU) {
          console.log(`🔄 Estoque devolvido do pedido ${pedido.order_id}.`);

          /**
           * O USO DO CUPOM VOLTA JUNTO COM O ESTOQUE, na mesma transacao: a
           * venda morreu, e um cupom de limite 50 "gasto" em pedidos
           * cancelados esgotaria a campanha sem vender nada.
           *
           * QUEM DEVOLVE E EXATAMENTE UM, tracado pelos dois lados da corrida
           * checkout×webhook (a mesma corrida do estoque, resolvida pelo
           * mesmo mecanismo — o FOR UPDATE do pedido e o `status !== statusPt`):
           *
           *   · checkout vence (avancarStatusInicial aplicou pendente→recusado):
           *     o proprio checkout devolve estoque e uso (compensarReserva);
           *     quando o webhook chegar, vera o status ja igual e este bloco
           *     NEM RODA — zero dobro.
           *   · webhook vence (chegou antes da resposta sincrona): devolve
           *     estoque e uso AQUI; o checkout recebe `avancado` vazio
           *     (statusAplicado null) e, por contrato daquele ramo, nao
           *     produz efeito nenhum — nem estoque, nem uso — zero perda.
           *
           * A idempotencia do reenvio e a de sempre: a segunda notificacao
           * identica encontra `status` ja transicionado e nao entra aqui.
           *
           * `false` = nenhuma linha casou (cupom renomeado apos a venda, ou
           * contador ja zerado). Nao e falha da transicao — loga e segue.
           */
          if (pedido.coupon_code) {
            const devolveu = await cuponsRepository.devolverUsoPorCodigo(
              pedido.coupon_code,
              client,
            );
            if (!devolveu) {
              console.warn(
                `CUPOM: uso do cupom "${pedido.coupon_code}" (pedido ${pedido.order_id}) ` +
                  "não pôde ser devolvido — código renomeado ou contador zerado. " +
                  "Confira o contador manualmente.",
              );
            }
          }
        } else if (movimento === REBAIXOU) {
          // O caminho de volta (um rejeitado que o MP reprocessa e aprova): o
          // estoque que a devolucao repos saiu de novo (com GREATEST(0, ...),
          // ver utils/estoque.js).
          console.log(`🔄 Estoque rebaixado de novo no pedido ${pedido.order_id}.`);

          /**
           * O caminho de volta NAO re-reserva o uso do cupom, de proposito.
           * Re-incrementar as cegas (`usos + 1`) poderia ESTOURAR o limite —
           * a vaga devolvida no cancelamento pode ja ter sido consumida por
           * outro pedido nesse meio tempo — e um `reservarUso` que falhasse
           * aqui nao teria resposta boa: cancelar a reaprovacao de um
           * pagamento JA APROVADO por causa de contador de campanha seria
           * deixar o marketing mandar no dinheiro. O contador fica 1 abaixo
           * do real para este cupom; a divergencia e conhecida, logada e
           * conferivel no painel.
           */
          if (pedido.coupon_code) {
            console.warn(
              `CUPOM: pedido ${pedido.order_id} voltou a ativo com o cupom ` +
                `"${pedido.coupon_code}" ja devolvido — o contador de usos ` +
                "fica 1 abaixo do real para este cupom (divergência conhecida, " +
                "não re-reservamos às cegas para não estourar o limite).",
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
      /**
       * BLING (3G): pedido que ENTROU em 'aprovado' pelo webhook vai ao ERP.
       * So quando `mudou` — o reenvio do MP com o mesmo status nao entra aqui,
       * entao o gatilho dispara UMA vez por transicao (e `sincronizarPedido` e
       * idempotente por `bling_id` de qualquer forma). Depois do COMMIT e fora
       * da resposta: falha do Bling e log + campo nulo, nunca 500 — um 500
       * aqui poria o MP em retry de uma transicao ja aplicada.
       */
      if (statusPt === "aprovado") {
        blingPedidos.aoAprovarPedido(pedido.order_id);
      }
      console.log(`✅ Pedido ${pedido.order_id} atualizado para: ${statusPt}`);
    }

    return res.sendStatus(200);
  }
}

module.exports = new PaymentController();

// Exportados para teste. Sao as regras que protegem dinheiro: quanto o cliente
// paga de frete, se o preco que ele viu ainda e o preco da loja, e quem pode
// dizer que um pagamento mudou de status.
module.exports.conferirFrete = conferirFrete;
module.exports.conferirSubtotal = conferirSubtotal;
module.exports.validarAssinaturaWebhook = validarAssinaturaWebhook;
