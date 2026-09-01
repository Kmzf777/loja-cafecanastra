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
// `garantirCpfENome` e a irma que le CPF e nome na MESMA consulta — e o que
// este controller usa, porque tambem precisa do nome para o `payer` do MP.
const { garantirCpfENome } = require("../utils/cpf");
const { avaliarCupom, normalizarCodigo } = require("../utils/cupom");
const cuponsRepository = require("../repositories/cuponsRepository");
// O motor de promoção (0032 + Onda 4). `motor.js` é PURO — a conta; o
// repositório é quem lê as sete tabelas e quem escreve as duas de registro.
const { calcularDescontos, meioDePagamentoDaLoja } = require("../utils/motor");
const motorRepository = require("../repositories/motorRepository");
const { hashDeDocumento } = motorRepository;
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

/**
 * O que o cliente lê na fatura do cartão.
 *
 * Sem isto sai o nome da conta Mercado Pago, e a pessoa não reconhece a
 * compra — que é como nasce boa parte das contestações.
 *
 * CONSTANTE, E NÃO `LOJA_NOME`: aquela variável vale "Cafe Canastra", com
 * espaço e 13 caracteres, e serve ao User-Agent da Melhor Envio. O descritor
 * aceita no máximo 13 e não aceita o mesmo conjunto de caracteres — reusar a
 * variável faria uma mudança inocente num campo virar recusa no outro.
 */
const DESCRITOR_NA_FATURA = "CAFECANASTRA";

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
 * dimensoes vindos do BANCO, e so aceita o valor da opcao que o cliente diz
 * ter escolhido — nome E preco, ver o casamento la embaixo. Devolve
 * `{ valor, metodo }` COTADOS, que e o que o pedido grava. Retirada na loja
 * (frete 0) continua valendo, sem cotar.
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
    // Retirada é o frete mais barato que existe (zero). O campo não muda nada
    // aqui — não há o que descontar —, mas responder `false` faria uma regra de
    // "só na modalidade mais barata" parecer não ter casado por outro motivo.
    return { valor: 0, metodo: "Retirada", ehMaisBarata: true };
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

  /**
   * CASA NOME **E** PRECO, nao so o preco. Antes era `.some()` sobre o valor,
   * contra o CONJUNTO de opcoes: o preco do PAC com o nome do SEDEX passava, e
   * o pedido nascia com um metodo que ninguem cotou — a operacao comprava a
   * etiqueta cara lendo uma string que o cliente escolheu.
   *
   * O nome sai da opcao COTADA, nunca do corpo da requisicao. E quando o frete
   * gratis zera TODAS as opcoes (ShippingController), o nome e a unica coisa
   * que ainda distingue uma da outra.
   */
  const escolhida = opcoes.find(
    (o) =>
      String(o.name) === String(shippingMethod) &&
      Math.abs(Number(o.price) - valor) <= TOLERANCIA_FRETE,
  );

  if (!escolhida) {
    const erro = new Error(
      "O frete mudou desde que você escolheu. Recalcule e tente de novo.",
    );
    erro.status = 409;
    throw erro;
  }

  /**
   * "É A MAIS BARATA?" SÓ DÁ PARA RESPONDER AQUI, e a resposta é insumo do
   * motor: `promocao_frete.apenas_modalidade_mais_barata` (0032) existe para a
   * loja bancar o PAC sem bancar o SEDEX, e sem este campo a diferença é entre
   * subsidiar R$ 25 e subsidiar R$ 90 na mesma venda.
   *
   * A comparação é contra a MENOR das opções COTADAS, e não contra um limite
   * fixo. Empate conta como mais barata: duas transportadoras pelo mesmo preço
   * são a mesma escolha para o bolso da loja.
   */
  const menorPreco = Math.min(...opcoes.map((o) => Number(o.price)));

  return {
    valor: Number(escolhida.price),
    metodo: String(escolhida.name),
    ehMaisBarata: Number(escolhida.price) <= menorPreco,
  };
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

/**
 * O carrinho no vocabulário do motor. `precoCentavos` é o preço UNITÁRIO já
 * promocional (o que `precoComPromocao` devolveu), porque é sobre ele que as
 * regras novas incidem: a promoção legada é etapa zero e o motor começa do que
 * ela deixou.
 */
function carrinhoParaOMotor(itens, { meioPagamento, assinante, frete }) {
  return {
    itens: itens.map((i) => ({
      produtoId: i.product_id,
      sku: i.sku ?? null,
      categoria: i.category ?? null,
      precoCentavos: Math.round(Number(i.price) * 100),
      quantidade: Number(i.quantity),
    })),
    meioPagamento,
    assinante,
    frete,
  };
}

/**
 * A PONTE DA TRANSIÇÃO, e ela existe porque a 0032 COPIOU o legado.
 *
 * Aquela migração inseriu cada linha de `promocoes_legado` e de `cupons` na
 * tabela `promocoes` nova — REAPROVEITANDO o `id`. Enquanto os dois caminhos
 * convivem (o legado por `precoComPromocao`/`avaliarCupom`, o novo pelo motor),
 * uma campanha migrada seria aplicada DUAS VEZES sobre o mesmo carrinho, e o
 * cliente pagaria menos do que a loja aprovou — em silêncio, porque nada no
 * total revela que o desconto veio dobrado.
 *
 * O corte é pelo `id` justamente porque a migração o reaproveitou: é uma
 * igualdade exata, não uma heurística. E o código digitado tem dono único: se a
 * busca em `canastra.cupons` achou o código, a regra de método `codigo` do
 * motor é a MESMA campanha, e quem aplica é o caminho legado.
 *
 * QUEM REMOVE ISTO é a `0036_aposentar_promocoes_e_cupons.sql`, junto com o
 * caminho legado inteiro — a ponte cai com as duas margens que ela liga.
 */
function semSobreposicaoComOLegado(regras, { idsLegados, cupomLegadoAplicado }) {
  return regras.filter((regra) => {
    if (idsLegados.has(String(regra.id))) return false;
    if (cupomLegadoAplicado && regra.metodo === "codigo") return false;
    return true;
  });
}

/**
 * O carrinho é de assinante do Clube (0015)?
 *
 * A CONSULTA SÓ SAI QUANDO ALGUMA REGRA PERGUNTA. Nenhuma campanha com escopo
 * `assinante` cadastrada significa zero round-trip a mais no caminho mais
 * quente da loja; com uma cadastrada, a pergunta é feita uma vez e a resposta
 * atravessa as duas passadas.
 *
 * Responder `false` cegamente seria pior que a consulta: a regra ficaria salva
 * e INERTE para sempre, que é exatamente o modo de falha da promoção legada sem
 * datas — o que a 0032 existe para não repetir.
 */
async function carrinhoDeAssinante(userId, regras) {
  if (!userId) return false;
  const alguemPergunta = regras.some((regra) =>
    (regra.escopo || []).some((e) => e.tipo === "assinante"),
  );
  if (!alguemPergunta) return false;

  const { rows } = await pool.query(
    `SELECT 1 FROM canastra.assinaturas
      WHERE user_id = $1::uuid AND status = 'ativa' LIMIT 1`,
    [userId],
  );
  return rows.length > 0;
}

/** Soma os ajustes de um alvo. Em centavos, como tudo que vem do motor. */
function somaDosAjustes(ajustes, alvo) {
  return ajustes
    .filter((a) => a.alvo === alvo)
    .reduce((total, a) => total + a.valorCentavos, 0);
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
     * Os códigos do MOTOR cujo contador foi somado na transação da reserva.
     * A lista só é preenchida DEPOIS do COMMIT, pelo mesmo motivo de
     * `usoDeCupomReservado`: antes disso o ROLLBACK devolve o uso de graça, e
     * compensar na mão seria devolver duas vezes.
     */
    let codigosDoMotorReservados = [];
    // SHA-256 do CPF, calculado no servidor a partir do que `canastra.clientes`
    // guarda. Nunca recebido do navegador — ver `motorRepository`.
    let documentoHash = null;

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
      for (const codigoId of codigosDoMotorReservados) {
        await motorRepository.devolverCodigo(codigoId, pool);
      }
      codigosDoMotorReservados = [];
      /**
       * O RESGATE SÓ EXISTE SE O PEDIDO EXISTE — `promocao_resgates.pedido_id`
       * é NOT NULL com FK, e as duas linhas nascem na mesma transação. Então
       * este ramo só tem trabalho no caminho do pagamento NASCIDO RECUSADO, que
       * é o único em que se compensa com o pedido já gravado.
       *
       * `estornado_em`, e não DELETE: apagar apagaria junto o registro de que a
       * campanha foi tentada, que é metade do relatório. E o UPDATE é
       * idempotente (`estornado_em IS NULL`), então uma segunda passagem — pelo
       * webhook, por exemplo — não estorna de novo.
       */
      if (pedidoCriado) {
        try {
          await motorRepository.estornarResgatesDoPedido(
            pedidoCriado.order_id,
            pool,
          );
        } catch (err) {
          console.error(
            `MOTOR: falha ao estornar os resgates do pedido ${pedidoCriado.order_id}:`,
            err.message,
          );
        }
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

      /**
       * O nome do titular, para o `payer` que vai ao antifraude.
       *
       * `garantirCpfENome`, não `garantirCpf`: as duas leem a MESMA linha de
       * `canastra.clientes`, no mesmo request — antes desta função existir,
       * eram duas idas ao banco (uma dentro de `garantirCpf`, só pelo CPF, e
       * outra aqui, só pelo nome) para a mesma linha, fora de transação. Uma
       * consulta com as duas colunas resolve os dois. `garantirCpf` continua
       * existindo, com o contrato INALTERADO que a adesão do Clube usa; o
       * porquê da divisão está documentado por extenso em utils/cpf.js.
       */
      let nomeDoCliente = "";
      if (userId) {
        const { cpf, nome } = await garantirCpfENome(
          userId,
          formData?.payer?.identification,
        );
        if (!cpf) {
          return res.status(400).json({
            error: "CPF_MISSING",
            message:
              "É necessário informar o CPF para prosseguir com a entrega.",
          });
        }
        nomeDoCliente = String(nome || "").trim();
        // O limite por cliente é por CPF e não por e-mail (e-mail é infinito e
        // gratuito: cupom de primeira compra por e-mail é cupom permanente). O
        // que viaja daqui para baixo é o HASH, nunca o número.
        documentoHash = hashDeDocumento(cpf);
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

      /**
       * O MEIO DE PAGAMENTO SOBE PARA CÁ porque o motor precisa dele ANTES da
       * cotação (uma regra de Pix muda o subtotal, e o subtotal decide o frete
       * grátis). A expressão é a mesma de sempre, palavra por palavra; só o
       * lugar mudou, e as interrogações protegem o caso de `formData` ausente
       * exatamente como antes — quem manda corpo sem `formData` continua
       * falhando lá embaixo, em `formData.payer.email`, e não aqui.
       */
      const paymentMethodIdRaw =
        formData?.paymentMethodId ||
        formData?.payment_method_id ||
        paymentMethodType;
      const finalPaymentMethodId =
        paymentMethodIdRaw === "bank_transfer" ? "pix" : paymentMethodIdRaw;
      // Do vocabulário ABERTO do Mercado Pago para o FECHADO da loja, num lugar
      // só e testável — ver `utils/motor.js`.
      const meioDaLoja = meioDePagamentoDaLoja(finalPaymentMethodId);

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
                -- O SKU entra na leitura porque promocao_escopo sabe apontar
                -- para ele (0032): "10% no CLAS-250" e uma frase que o escopo
                -- legado, de tres colunas, nao conseguia escrever.
                sku,
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
          // Categoria e SKU viajam junto só para o motor decidir escopo; a
          // cotação de frete ignora os dois.
          category: previa.category,
          sku: previa.sku,
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
      if (codigoDeCupom) {
        cupomAplicado = await cuponsRepository.buscarPorCodigo(codigoDeCupom);
      }

      /**
       * O MOTOR, PRIMEIRA PASSADA — SEM FRETE, e a ausência é a resolução de um
       * ovo-e-galinha real: a classe `frete` depende da modalidade cotada, e a
       * cotação depende do subtotal já descontado (o piso do frete grátis de
       * 0009). Aqui rodam só as classes `produto` e `pedido`; a classe `frete`
       * roda na passada travada, quando a modalidade já é conhecida.
       *
       * ESTE DESCONTO **NÃO** ENTRA NO `descontoCentavos` DA RECOTAÇÃO, e a
       * decisão é o oposto do que a intuição pede — vale escrever o porquê.
       * Quem coloca o número na tela é `POST /shipping/calculate`, e aquela
       * rota conhece o cupom e mais nada: o motor é da Onda 4 e a cotação
       * pública só passa a falar com ele na Onda 6, junto com a exibição.
       * Enquanto isso, subtrair aqui um desconto que o navegador não subtraiu
       * cria a divergência EXATA que produz 409 falso: um carrinho acima do
       * piso do frete grátis recebe "R$ 0,00" na tela, chega aqui com o
       * subtotal reduzido pela promoção nova, cai abaixo do piso, é recotado
       * com preço — e o zero do cliente não casa com nada. Toda venda de
       * campanha na fronteira do piso morreria em "o frete mudou".
       *
       * Os dois lados usando a MESMA base é o que importa, e é a invariante que
       * `utils/preco.js` existe para manter. O troco — o piso do frete grátis
       * medido sobre um subtotal maior que o cobrado — é frete de graça um
       * pouco mais generoso, que é o lado seguro do erro.
       *
       * O `ehAssinante` é resolvido AQUI, fora da transação: a resposta serve
       * para as duas passadas e não vale segurar `FOR UPDATE` durante ela.
       */
      const idsDeLegadas = new Set(
        activePromotions.map((p) => String(p.id)).filter(Boolean),
      );
      const regrasPrevias = semSobreposicaoComOLegado(
        await motorRepository.carregarRegrasVigentes({
          codigo: codigoDeCupom,
          documentoHash,
        }),
        { idsLegados: idsDeLegadas, cupomLegadoAplicado: Boolean(cupomAplicado) },
      );
      const assinante = await carrinhoDeAssinante(userId, regrasPrevias);
      const motorPrevio = calcularDescontos(
        carrinhoParaOMotor(itensParaCotacao, {
          meioPagamento: meioDaLoja,
          assinante,
          frete: null,
        }),
        regrasPrevias,
      );

      /**
       * O CÓDIGO TEM DOIS DONOS POSSÍVEIS enquanto a transição dura: a tabela
       * `cupons` (0010) e `promocao_codigos` (0032). "Não encontrado" só é
       * verdade quando NENHUM dos dois o reconhece — recusar aqui só porque a
       * busca legada voltou vazia mataria toda campanha cadastrada na tela
       * nova, com a frase errada.
       */
      const codigoAchadoPeloMotor = regrasPrevias.some((r) => r.codigo);
      if (codigoDeCupom && !cupomAplicado && !codigoAchadoPeloMotor) {
        // A FRASE CERTA IMPORTA: "não encontrado" manda a pessoa procurar erro
        // de digitação num código que ela copiou certo do anúncio. O
        // diagnóstico custa UMA consulta e só roda neste caminho de recusa.
        const erro = new Error(
          await motorRepository.diagnosticarCodigo(codigoDeCupom),
        );
        erro.status = 400;
        erro.codigoPublico = "CUPOM_INVALIDO";
        throw erro;
      }

      /**
       * CUPOM LEGADO, PRIMEIRA PASSADA (F6). O navegador manda so o CODIGO; o
       * desconto que ele exibiu nunca e aceito.
       *
       * `descontoPrevioCentavos` carrega SÓ O CUPOM, pelo motivo escrito na
       * primeira passada do motor: é o único desconto que a cotação do
       * navegador também enxergou, e os dois lados têm de medir o piso do
       * frete grátis sobre a MESMA base.
       *
       * A BASE DO CUPOM, essa sim, desconta a etapa 1 do motor — a mesma regra
       * que o motor aplica às suas próprias regras de pedido: desconto sobre o
       * subtotal incide sobre o subtotal JÁ REDUZIDO pelos descontos de linha,
       * e dois descontos de pedido dividem essa base sem se compor. Sem regra
       * nova cadastrada o subtraendo é zero e a conta é, ao centavo, a de
       * sempre — que é o que mantém `f6_cupons` verde.
       */
      let descontoPrevioCentavos = 0;
      if (cupomAplicado) {
        const subtotalPrevioCentavos =
          somarCentavos(itensParaCotacao) - somaDosAjustes(motorPrevio.ajustes, "item");
        const avaliacao = avaliarCupom(cupomAplicado, subtotalPrevioCentavos);
        if (!avaliacao.valido) {
          const erro = new Error(avaliacao.motivo);
          erro.status = 400;
          erro.codigoPublico = "CUPOM_INVALIDO";
          throw erro;
        }
        descontoPrevioCentavos += Math.max(
          0,
          Math.min(
            avaliacao.descontoCentavos,
            subtotalPrevioCentavos - somaDosAjustes(motorPrevio.ajustes, "pedido"),
          ),
        );
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

      /** O carrinho no vocabulário do motor, montado das linhas TRAVADAS. */
      const itensParaOMotor = [];
      /** O que a promoção de vitrine legada já abateu, linha a linha. */
      const descontosLegadosPorItem = [];

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
                  sku,
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

        /**
         * O QUE A PROMOÇÃO LEGADA JÁ TIROU DESTA LINHA — para virar linha de
         * `pedido_ajustes_desconto` mais abaixo.
         *
         * `promocao_id` sai NULO nessas linhas, e a ausência é honesta e não
         * preguiça: `precoComPromocao` devolve UM preço, escolhido por um
         * `Math.min` entre todas as promoções que casam. Qual delas venceu é
         * uma pergunta que o modelo legado não consegue responder — e é
         * exatamente por isso que ele está sendo substituído. A `0036` aposenta
         * este ramo, e a partir dela toda linha aponta para a campanha.
         */
        const descontoLegadoCentavos =
          (Math.round(Number(productDb.price) * 100) -
            Math.round(bestPrice * 100)) *
          qtdSolicitada;
        if (descontoLegadoCentavos > 0) {
          descontosLegadosPorItem.push({
            produtoId: productDb.product_id,
            valorCentavos: descontoLegadoCentavos,
          });
        }

        itensParaOMotor.push({
          product_id: productDb.product_id,
          quantity: qtdSolicitada,
          price: bestPrice,
          category: productDb.category,
          sku: productDb.sku,
        });

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
      /**
       * O MOTOR, SEGUNDA PASSADA — A QUE VALE DINHEIRO.
       *
       * Sobre as linhas TRAVADAS e DENTRO da transação: as regras são relidas
       * com o mesmo `client`, então o limite de uso e o limite por CPF são
       * avaliados no mesmo instante em que o estoque é reservado, e não num
       * retrato de milissegundos atrás.
       *
       * Agora com o frete, que a primeira passada não tinha: a modalidade já
       * foi conferida, então `promocao_frete` tem contra o que decidir (teto,
       * UF, faixa de CEP e "só na mais barata").
       */
      const regrasTravadas = semSobreposicaoComOLegado(
        await motorRepository.carregarRegrasVigentes({
          codigo: codigoDeCupom,
          documentoHash,
          client,
        }),
        { idsLegados: idsDeLegadas, cupomLegadoAplicado: Boolean(cupomAplicado) },
      );
      const freteCentavos = Math.round(Number(freteConferido.valor) * 100);
      const descontosDoMotor = calcularDescontos(
        carrinhoParaOMotor(itensParaOMotor, {
          meioPagamento: meioDaLoja,
          assinante,
          frete: {
            valorCentavos: freteCentavos,
            metodo: freteConferido.metodo,
            ehMaisBarata: freteConferido.ehMaisBarata,
            uf: address?.state || address?.uf || address?.estado || null,
            cep: address?.zip_code || address?.zipCode || address?.cep || null,
          },
        }),
        regrasTravadas,
      );

      /**
       * A TRAVA DO ESGOTAMENTO DO MOTOR, mesmo desenho do cupom logo abaixo e
       * mesmo lugar: o incremento atômico roda DENTRO desta transação, então
       * dois checkouts simultâneos no último uso serializam na linha do código
       * e o segundo recebe `false` — o throw vira ROLLBACK e devolve estoque e
       * uso juntos, de graça, antes de o gateway entrar em cena.
       */
      const codigosDoMotor = [
        ...new Set(
          descontosDoMotor.ajustes.map((a) => a.codigoId).filter(Boolean),
        ),
      ];
      const codigosSomados = [];
      for (const codigoId of codigosDoMotor) {
        const reservou = await motorRepository.reservarCodigo(codigoId, client);
        if (!reservou) {
          const erro = new Error("Cupom esgotado");
          erro.status = 400;
          erro.codigoPublico = "CUPOM_INVALIDO";
          throw erro;
        }
        codigosSomados.push(codigoId);
      }

      let descontoCentavos = 0;
      if (cupomAplicado) {
        // A base é a mesma da primeira passada: subtotal travado MENOS o que as
        // regras de linha do motor já tiraram. Sem regra nova cadastrada o
        // subtraendo é zero, e a conta é a de sempre ao centavo.
        const baseDoCupomCentavos =
          validatedSubtotalCentavos -
          somaDosAjustes(descontosDoMotor.ajustes, "item");
        const reavaliacao = avaliarCupom(cupomAplicado, baseDoCupomCentavos);
        if (!reavaliacao.valido) {
          const erro = new Error(reavaliacao.motivo);
          erro.status = 400;
          erro.codigoPublico = "CUPOM_INVALIDO";
          throw erro;
        }
        // O cupom é o ÚLTIMO desconto de pedido, e a soma dos descontos de
        // pedido nunca passa da base — a mesma regra que o motor aplica às
        // suas próprias regras de classe `pedido`.
        descontoCentavos = Math.max(
          0,
          Math.min(
            reavaliacao.descontoCentavos,
            baseDoCupomCentavos -
              somaDosAjustes(descontosDoMotor.ajustes, "pedido"),
          ),
        );

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

      /**
       * A CONTA, INTEIRA EM CENTAVOS ATÉ O ÚLTIMO PASSO.
       *
       * Antes o frete entrava em reais no meio da soma; agora ele vira centavo
       * antes, pelo motivo de sempre — e porque o desconto de frete do motor
       * abate exatamente dele. `pedidos.frete` continua gravando o valor BRUTO
       * cotado: o abatimento tem linha própria em `pedido_ajustes_desconto`, e
       * é assim que a nota fiscal consegue dizer o que foi cobrado e o que foi
       * bancado pela loja.
       */
      const descontoTotalCentavos =
        descontoCentavos + descontosDoMotor.totalCentavos;
      const finalAmountToCharge = Number(
        (
          (validatedSubtotalCentavos + freteCentavos - descontoTotalCentavos) /
          100
        ).toFixed(2),
      );

      if (!(finalAmountToCharge > 0)) {
        // Dois motivos possiveis, duas frases: um cupom fixed pode cobrir o
        // subtotal inteiro (o desconto trava la, mas com frete zero o total
        // fecha em 0.00) — e "valor invalido" mandaria a pessoa cacar um erro
        // que nao cometeu. O MP nao cobra R$ 0, e pedido gratis nao e um
        // fluxo que esta loja vende.
        const erro = new Error(
          descontoTotalCentavos >= validatedSubtotalCentavos
            ? "O cupom cobre o valor inteiro do pedido; ajuste os itens ou fale com a gente."
            : "Valor total do pedido inválido.",
        );
        erro.status = 400;
        throw erro;
      }

      /**
       * A DECOMPOSIÇÃO COMPLETA DO DESCONTO, na ordem em que ele aconteceu — e
       * "completa" é a palavra que importa: a soma destas linhas tem de ser,
       * ao centavo, a diferença entre o subtotal de CATÁLOGO e o que o cliente
       * paga pelos itens. Uma linha faltando aqui é uma pergunta sem resposta
       * na tela de detalhe, um rateio errado na NF-e e um estorno parcial que
       * não fecha.
       *
       * Por isso a promoção de vitrine LEGADA também entra, mesmo sem saber
       * qual campanha venceu o `Math.min` (ver o comentário na leitura travada):
       * a alternativa seria uma tabela que só explica parte do preço.
       */
      const ajustesDoPedido = [
        ...descontosLegadosPorItem.map((linha) => ({
          promocaoId: null,
          codigo: null,
          alvo: "item",
          alvoRef: String(linha.produtoId),
          valorCentavos: linha.valorCentavos,
          rotulo: "Promoção de vitrine",
        })),
        ...descontosDoMotor.ajustes,
        ...(descontoCentavos > 0
          ? [
              {
                promocaoId: null,
                codigo: cupomAplicado.codigo,
                alvo: "pedido",
                alvoRef: null,
                valorCentavos: descontoCentavos,
                rotulo: `Cupom ${cupomAplicado.codigo}`,
              },
            ]
          : []),
        // `sequencia` é reatribuída aqui e não herdada do motor: a lista final
        // tem lados que o motor não viu, e o UNIQUE (pedido_id, sequencia) de
        // 0032 recusa qualquer repetição.
      ].map((ajuste, indice) => ({ ...ajuste, sequencia: indice + 1 }));

      /**
       * Os resgates: UM por promoção aplicada, com o valor que ela custou. É
       * daqui que saem o relatório de campanha e os dois limites (global e por
       * CPF) — `promocao_codigos.usos` é a cópia denormalizada que existe só
       * para o incremento atômico, e a própria 0032 diz isso.
       */
      const resgatesDoPedido = [
        ...descontosDoMotor.ajustes
          .reduce((mapa, ajuste) => {
            if (!ajuste.promocaoId) return mapa;
            const atual = mapa.get(ajuste.promocaoId) || {
              promocaoId: ajuste.promocaoId,
              codigoId: ajuste.codigoId || null,
              valorCentavos: 0,
            };
            atual.valorCentavos += ajuste.valorCentavos;
            mapa.set(ajuste.promocaoId, atual);
            return mapa;
          }, new Map())
          .values(),
      ];

      /**
       * Fecha a transacao com o estoque JA reservado, e devolve a conexao ao
       * pool ANTES da ida ao Mercado Pago: dali em diante tudo e pool.query, e
       * uma conexao parada durante uma chamada de rede e uma conexao roubada
       * de outro checkout.
       */
      await client.query("COMMIT");
      estoqueReservado = true;
      // O uso do cupom commitou JUNTO com a reserva: a partir daqui, toda
      // compensacao de estoque devolve o uso tambem. O mesmo vale para os
      // contadores dos códigos do motor.
      usoDeCupomReservado = Boolean(cupomAplicado);
      codigosDoMotorReservados = codigosSomados;
      client.release();
      client = null;

      const identification = formData.payer?.identification;

      const webhookUrl = process.env.WEBHOOK_URL;

      /**
       * O nome quebrado em dois, porque é assim que o Mercado Pago pede.
       *
       * `canastra.clientes.nome` é um campo só e aceita "Ana" tanto quanto
       * "Ana Maria de Souza". A primeira palavra é o nome; o resto, quando
       * existe, é o sobrenome. Nome de uma palavra só NÃO manda `last_name`
       * vazio: campo vazio é pior que campo ausente para o motor de risco.
       */
      const partesDoNome = nomeDoCliente.split(/\s+/).filter(Boolean);
      const primeiroNome = partesDoNome[0] || "";
      const sobrenome = partesDoNome.slice(1).join(" ");

      /**
       * O ENDEREÇO NO FORMATO DO MERCADO PAGO. O `address` do pedido usa os
       * nomes da loja (`zip_code`/`cep`, `street`/`rua`), e as duas grafias
       * circulam porque o corpo vem do navegador. Normaliza aqui, uma vez.
       *
       * `street_number` É INTEIRO no contrato do Mercado Pago (`payer.address`
       * e `additional_info.shipments.receiver_address`), e a API valida isso.
       * `canastra.enderecos.numero` é opcional (migração 0004) e nada no
       * checkout obriga a informar um — endereço sem número existe de
       * verdade (zona rural, "S/N"). Sem número, ou com um número que não é
       * número ("S/N", "120A"), A CHAVE SOME do payload em vez de virar ""
       * ou NaN: mandar lixo faria uma cobrança de cartão legítima levar 400
       * do gateway por causa de um campo que só existe para enriquecer o
       * antifraude — o mesmo raciocínio do `last_name` omitido ali em cima.
       */
      const numeroBruto = address?.number ?? address?.numero;
      const numeroConvertido = Number(numeroBruto);
      const numeroValido =
        numeroBruto !== null &&
        numeroBruto !== undefined &&
        String(numeroBruto).trim() !== "" &&
        Number.isFinite(numeroConvertido);
      const enderecoParaOMp = {
        zip_code: address?.zip_code || address?.zipCode || address?.cep || "",
        street_name: address?.street || address?.rua || "",
        ...(numeroValido ? { street_number: numeroConvertido } : {}),
      };

      const paymentData = {
        transaction_amount: finalAmountToCharge,
        token: formData?.token,
        description: `Pedido Café Canastra - ${validatedItems.length} itens`,
        installments: Number(formData.installments || 1),
        payment_method_id: finalPaymentMethodId,
        notification_url: webhookUrl,
        /**
         * O FIO DA CONCILIAÇÃO. Sem ele, o painel do Mercado Pago mostra
         * `payment_id` e mais nada, e casar um pagamento com um pedido da loja
         * vira garimpo manual.
         *
         * POR QUE NÃO O ID DO PEDIDO: nesta loja a cobrança acontece ANTES de
         * `createOrder` — o id ainda não existe aqui. A chave de idempotência
         * existe, é única por índice, e é exatamente o que a linha do pedido
         * grava em `chave_idempotencia`. Um campo, os dois lados.
         */
        external_reference: chaveIdempotencia,
        statement_descriptor: DESCRITOR_NA_FATURA,
        payer: {
          email: formData.payer.email || userEmail,
          ...(primeiroNome ? { first_name: primeiroNome } : {}),
          ...(sobrenome ? { last_name: sobrenome } : {}),
          ...(enderecoParaOMp.zip_code ? { address: enderecoParaOMp } : {}),
          ...(identification && identification.number
            ? {
                identification: {
                  type: identification.type || "CPF",
                  number: identification.number,
                },
              }
            : {}),
        },
        /**
         * O QUE O ANTIFRAUDE LÊ. Pedido sem `additional_info` é pedido cego
         * para o motor de risco do Mercado Pago: ele não vê o que foi
         * comprado, por quem, nem para onde vai. É o principal insumo de
         * aprovação de cartão, e é item pontuado na Qualidade da integração.
         *
         * Tudo aqui já está em mãos — `validatedItems` veio do banco e o
         * endereço já foi conferido. Nenhuma consulta nova.
         */
        additional_info: {
          items: validatedItems.map((item) => ({
            id: String(item.product_id),
            title: item.name,
            quantity: item.quantity,
            unit_price: item.price,
          })),
          payer: {
            ...(primeiroNome ? { first_name: primeiroNome } : {}),
            ...(sobrenome ? { last_name: sobrenome } : {}),
          },
          ...(enderecoParaOMp.zip_code
            ? { shipments: { receiver_address: enderecoParaOMp } }
            : {}),
          ...(req.ip ? { ip_address: req.ip } : {}),
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
        /**
         * A CHAVE VAI JUNTO, e é a mesma que o pedido grava.
         *
         * A loja já se defendia sozinha (índice único em `chave_idempotencia`),
         * mas a defesa era TARDIA: no duplo clique que vence a corrida, a
         * segunda requisição só é barrada DEPOIS de ter cobrado. Com a chave
         * no gateway, o Mercado Pago devolve o mesmo pagamento em vez de criar
         * outro — a cobrança dupla deixa de acontecer, em vez de ser
         * compensada.
         *
         * Funciona porque a chave é estável entre tentativas: o navegador
         * manda `Idempotency-Key` (lib/sacola/checkout.ts) e reusa o valor no
         * retry do mesmo pedido. Quando o cabeçalho não vem, cada requisição
         * gera um uuid próprio e o gateway não tem como deduplicar — mas
         * nesse caso a corrida de duplo clique também não existe, porque não
         * há dois cliques com a mesma identidade.
         *
         * O log de PAGAMENTO DUPLICADO mais abaixo FICA: defesa de servidor
         * não se aposenta porque apareceu uma defesa de gateway.
         */
        /**
         * O fingerprint que o security.js coletou no navegador; o SDK o
         * envia como `X-meli-session-id`. CONDICIONAL, e é o ponto todo:
         * bloqueador de script deixa o campo ausente, e nesse caso a
         * cobrança sai sem o header em vez de não sair.
         *
         * O LIMITE DE 128, mesmo raciocínio da `chaveDoCliente` lá em cima
         * (a chave de idempotência que o navegador manda): não é
         * vulnerabilidade — um CR/LF no valor já estoura dentro do
         * node-fetch antes de qualquer I/O, e o express.json tampa o corpo
         * em 256kb bem antes disso — é endurecimento barato que evita
         * forçar o retry-e-falha do SDK diante de uma entrada malformada.
         * Acima do limite a chave SOME, o mesmo comportamento de quando o
         * deviceId simplesmente não vem: falhar aberto é a regra aqui,
         * igual a um fingerprint ausente.
         */
        const requestOptions = {
          idempotencyKey: chaveIdempotencia,
          ...(typeof req.body?.deviceId === "string" &&
          req.body.deviceId &&
          req.body.deviceId.length <= 128
            ? { meliSessionId: req.body.deviceId }
            : {}),
        };

        mpResponse = await payment.create({
          body: paymentData,
          requestOptions,
        });
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
      /**
       * O PEDIDO, O RESGATE E A DECOMPOSIÇÃO NASCEM NA MESMA TRANSAÇÃO — e não
       * por gosto de transação, por RESTRIÇÃO DE SCHEMA: `promocao_resgates` e
       * `pedido_ajustes_desconto` têm `pedido_id` NOT NULL com FK para
       * `pedidos`, então a linha do resgate não pode existir antes do pedido, e
       * o pedido nesta loja nasce DEPOIS da cobrança (a chave de idempotência é
       * o fio da conciliação justamente porque o id ainda não existe na hora de
       * cobrar). Aqui os três commitam juntos ou nenhum: um pedido cobrado sem
       * a linha que explica o preço seria uma venda que ninguém consegue
       * auditar.
       *
       * A TRAVA DE CONCORRÊNCIA NÃO MORA AQUI, e vale ser explícito: quem faz
       * dois checkouts simultâneos no último uso serializarem é o incremento
       * atômico de `promocao_codigos.usos`, lá na transação de reserva de
       * estoque — o mesmo desenho de `cuponsRepository.reservarUso`. Esta
       * transação é a do REGISTRO.
       */
      const clienteDoPedido = await pool.connect();
      try {
        await clienteDoPedido.query("BEGIN");
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
          shippingCost: freteConferido.valor,
          // O METODO tambem e o conferido: a linha acima ja dizia isso do valor,
          // e o metodo continuava vindo cru do corpo da requisicao.
          shippingMethod: freteConferido.metodo,
          chaveIdempotencia,
          status: "pendente",
          // A fotografia do cupom (0010): o codigo usado e o desconto em
          // reais, ambos os RECALCULADOS — nunca o que o navegador exibiu.
          // `desconto` passa a ser o desconto TOTAL do pedido (cupom legado
          // mais motor): a coluna sempre significou "quanto saiu do preço", e
          // guardar só a parte do cupom faria `total + desconto` deixar de
          // fechar com o subtotal no dia em que a primeira campanha nova rodar.
          cupomCodigo: cupomAplicado ? cupomAplicado.codigo : null,
          desconto: descontoTotalCentavos / 100,
          client: clienteDoPedido,
        });

        await motorRepository.gravarAjustes(
          clienteDoPedido,
          newOrder.order_id,
          ajustesDoPedido,
        );
        await motorRepository.gravarResgates(clienteDoPedido, {
          pedidoId: newOrder.order_id,
          userId: userId || null,
          documentoHash,
          resgates: resgatesDoPedido,
        });

        await clienteDoPedido.query("COMMIT");
      } catch (erroDeInsert) {
        await clienteDoPedido.query("ROLLBACK").catch(() => {});
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
      } finally {
        clienteDoPedido.release();
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

          /**
           * OS RESGATES DO MOTOR VOLTAM PELO MESMO CAMINHO E NA MESMA
           * TRANSAÇÃO. É este ramo que faz o PIX EXPIRADO devolver o uso — o
           * MP notifica `cancelled`, que traduz para 'cancelado', que é
           * GRUPO_CANCELADO. Sem ele, carrinho abandonado queima campanha: um
           * limite de 50 gasto em pedidos que ninguém pagou esgota a promoção
           * sem vender nada.
           *
           * `estornado_em`, e não DELETE, e o UPDATE filtra `IS NULL` — então o
           * reenvio de notificação do MP (que é por desenho) não estorna duas
           * vezes nem desce o contador duas vezes.
           *
           * O `engolirErro: false` é deliberado, e é o mesmo raciocínio de
           * `devolverUsoPorCodigo`: aqui a devolução vive DENTRO da transação
           * do webhook, e erro engolido dentro de transação envenena tudo que
           * vier depois (25P02) além de commitar meia-verdade. O erro sobe,
           * vira ROLLBACK + 500, e o MP reenvia.
           */
          const estornados = await motorRepository.estornarResgatesDoPedido(
            pedido.order_id,
            client,
          );
          for (const resgate of estornados) {
            if (!resgate.codigo_id) continue;
            await motorRepository.devolverCodigo(resgate.codigo_id, client, {
              engolirErro: false,
            });
          }
          if (estornados.length) {
            console.log(
              `🔄 ${estornados.length} resgate(s) estornado(s) no pedido ${pedido.order_id}.`,
            );
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
