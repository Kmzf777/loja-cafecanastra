"use strict";

/**
 * A API DE ORDERS DO MERCADO PAGO — a tradução entre a loja e o gateway.
 *
 * POR QUE ESTE MÓDULO EXISTE, e não é escolha de arquitetura. A loja inteira
 * foi escrita contra `POST /v1/payments`, e essa chamada responde **401
 * "Unauthorized use of live credentials"** na aplicação `7289536483168143`. A
 * frase mente sobre a causa — não é credencial de produção, não é cartão de
 * teste em modo live, não é o SDK; o Pix dá o mesmo 401 e Pix não tem cartão.
 * O aplicativo foi criado escolhendo Checkout Transparente **via Orders**, e o
 * Mercado Pago não autoriza a API de Payments nele. Enquanto o checkout
 * chamasse `/v1/payments`, NENHUMA venda saía — nem Pix, nem cartão.
 *
 * A sonda de dez segundos que decide isso está em `docs/mercadopago-orders.md`
 * §1, e foi reconfirmada em 16/09/2026: `/v1/payments` → 401, `/v1/orders` →
 * 201.
 *
 * O QUE MUDA DE FORMA, e cada linha foi arrancada de um erro real do gateway,
 * não de documentação:
 *
 *   · valor é STRING de duas casas ("79.40"), não número;
 *   · a SOMA DOS ITENS tem de fechar com o total — frete e desconto viram
 *     linha de item, senão é 400 `order_items_total_amount_mismatch`;
 *   · `statement_descriptor` mora dentro de `payment_method`, não no topo;
 *   · `external_code` aceita 30 caracteres e o `product_id` tem 36;
 *   · token e parcelas moram dentro de `payment_method`;
 *   · o status fala outro idioma (`processed/accredited` no lugar de
 *     `approved`).
 *
 * O QUE **NÃO** MUDA, e é por isso que o webhook ficou quase intacto: a
 * notificação continua chegando como `type: "payment"` com o id NUMÉRICO, e
 * `GET /v1/payments/{id_numérico}` responde 200 com o vocabulário ANTIGO
 * (`approved`, `pending`, `rejected`) e com `external_reference`. Quem traduz
 * a notificação continua sendo `traduzirStatusMp` (utils/statusDePedido.js).
 * Este módulo traduz a resposta SÍNCRONA da criação, que é outra coisa.
 */

/** O que o gateway aceita em `items[].external_code`. Medido, não lido. */
const LIMITE_EXTERNAL_CODE = 30;

/**
 * A janela do Pix, no formato de duração ISO-8601 que a Orders usa.
 *
 * Trinta minutos é o que a integração de Payments já praticava
 * (`date_of_expiration`), e mantê-lo é o ponto: o QR expirando no mesmo prazo
 * de antes evita que esta migração mude, de carona, uma regra de negócio que
 * ninguém pediu para mudar. Sem o campo, o padrão do gateway é 24 horas —
 * medido — e estoque reservado por 24 horas é estoque que some da prateleira.
 */
const EXPIRACAO_DO_PIX = "PT30M";

/** Os títulos das duas linhas sintéticas. Constantes porque o teste os lê. */
const LINHA_DE_FRETE = "Frete";
const LINHA_DE_DESCONTO = "Desconto";

/**
 * Centavos para a string de duas casas que a Orders exige.
 *
 * A CONVERSÃO ACONTECE UMA VEZ, AQUI, e a loja segue falando centavos inteiros
 * do lado de dentro — é a mesma disciplina de `somarCentavos` e de
 * `frete_gratis_minimo_centavos`. Formatar em vários lugares é como nasce o
 * pedido de "79.4" que o gateway recusa, ou o de "79.400000000000006" que ele
 * aceita e cobra errado.
 */
function reais(centavos) {
  return (Number(centavos) / 100).toFixed(2);
}

/**
 * O tipo do meio de pagamento, que a Orders exige e a Payments deduzia sozinha.
 *
 * `credit_card` É O PADRÃO, e não uma suposição preguiçosa: os meios que a
 * loja oferece são Pix e cartão de crédito, e toda bandeira (visa, master,
 * amex, elo) entra por este ramo. Os outros dois estão aqui porque o gateway
 * os aceita na mesma conta e um `bolbradesco` chegando como `credit_card`
 * seria 400 sem nenhuma pista no log.
 */
function tipoDoMeio(meioDePagamento) {
  if (meioDePagamento === "pix") return "bank_transfer";
  if (meioDePagamento === "bolbradesco") return "ticket";
  if (meioDePagamento === "account_money") return "account_money";
  return "credit_card";
}

/**
 * Status da Orders para o vocabulário de nove palavras da loja (migração 0009).
 *
 * MEDIDOS CONTRA A CONTA DE TESTE em 16/09/2026, um cartão por linha — os
 * titulares especiais do Mercado Pago (`APRO`, `CONT`, `FUND`…) produzem cada
 * um destes. `failed` merece nota: a recusa de cartão na Orders **não** volta
 * como 201 com status `rejected`, como voltava na Payments — volta como HTTP
 * 402, com a order inteira no campo `data` do erro e `status: "failed"`. Quem
 * desembrulha isso é `PaymentController`; a tradução da palavra é aqui.
 *
 * DESCONHECIDO DEVOLVE `null`, nunca a string crua: `pedidos.status` tem CHECK
 * na 0009, e gravar cru é 23514 no meio do checkout. Quem chama decide.
 */
const DE_STATUS_DA_ORDER = Object.freeze({
  action_required: "pendente",
  processing: "em_processamento",
  canceled: "cancelado",
  cancelled: "cancelado",
  expired: "cancelado",
  refunded: "reembolsado",
  failed: "rejeitado",
  rejected: "rejeitado",
});

function traduzirStatusDaOrder(status, detalhe) {
  const s = String(status || "").toLowerCase();
  const d = String(detalhe || "").toLowerCase();

  /**
   * `processed` sozinho não diz se o dinheiro entrou, e a diferença é de
   * caixa: `pending_capture` é uma autorização que ainda pode não virar
   * dinheiro nenhum. O vocabulário da loja já separava os dois (`autorizado`
   * ≠ `aprovado`) desde a 0009; é aqui que a separação sobrevive à migração.
   */
  if (s === "processed") {
    if (d === "pending_capture" || d === "authorized") return "autorizado";
    if (d === "refunded" || d === "partially_refunded") return "reembolsado";
    return "aprovado";
  }

  return DE_STATUS_DA_ORDER[s] || null;
}

/**
 * As linhas de item do pedido — e elas são o VALOR COBRADO, não enfeite.
 *
 * Na Payments, `additional_info.items` servia ao motor de risco e o valor
 * vinha de `transaction_amount`; os dois podiam divergir à vontade. Na Orders
 * o gateway confere: `sum(unit_price × quantity) == total_amount`, ou 400
 * `order_items_total_amount_mismatch`. Por isso frete e desconto, que na loja
 * são campos do pedido, precisam virar linha aqui — e o desconto vira linha
 * NEGATIVA, que o gateway aceita (medido).
 *
 * O EFEITO COLATERAL É BOM: a fatura do cliente e o painel do Mercado Pago
 * passam a mostrar a composição do preço, item a item, em vez de um total
 * cego.
 */
function montarItens({ itens, freteCentavos, descontoCentavos }) {
  const linhas = itens.map((item) => {
    const precoCentavos = Math.round(Number(item.price) * 100);
    const linha = {
      title: item.name,
      unit_price: reais(precoCentavos),
      quantity: Number(item.quantity),
    };

    /**
     * O SKU, e nunca o `product_id`: o UUID tem 36 caracteres e o campo aceita
     * 30 — "'$.items[0].external_code' - length must be <= 30, but got 36", um
     * 400 real. O campo é OPCIONAL (medido), então sem SKU ele simplesmente
     * SOME: mandar um UUID cortado seria mandar um identificador que não
     * identifica nada, que é pior do que não mandar.
     */
    const sku = item.sku ? String(item.sku).trim() : "";
    if (sku) linha.external_code = sku.slice(0, LIMITE_EXTERNAL_CODE);

    return linha;
  });

  if (freteCentavos > 0) {
    linhas.push({
      title: LINHA_DE_FRETE,
      unit_price: reais(freteCentavos),
      quantity: 1,
    });
  }

  if (descontoCentavos > 0) {
    linhas.push({
      title: LINHA_DE_DESCONTO,
      unit_price: reais(-descontoCentavos),
      quantity: 1,
    });
  }

  return linhas;
}

/** O pagador, com todo campo vazio OMITIDO em vez de enviado em branco. */
function montarPagador({ email, primeiroNome, sobrenome, identificacao, endereco }) {
  return {
    email,
    ...(primeiroNome ? { first_name: primeiroNome } : {}),
    ...(sobrenome ? { last_name: sobrenome } : {}),
    ...(identificacao && identificacao.number
      ? {
          identification: {
            type: identificacao.type || "CPF",
            number: identificacao.number,
          },
        }
      : {}),
    ...(endereco && endereco.zip_code ? { address: endereco } : {}),
  };
}

/**
 * O corpo do `POST /v1/orders`.
 *
 * `totalCentavos` VEM DE FORA e é CONFERIDO aqui contra a soma das linhas.
 * Poderia ser derivado — mas derivar esconderia divergência: quem cobra é o
 * `finalAmountToCharge` que o PaymentController calculou do banco, e se a
 * aritmética das linhas não fechar com ele, o certo é uma exceção com o nome
 * da causa, na nossa borda, ANTES de reservar estoque — e não um 400 genérico
 * do gateway no meio do checkout, com o estoque já tirado da prateleira.
 */
function montarCorpoDaOrder({
  chaveIdempotencia,
  itens,
  freteCentavos = 0,
  descontoCentavos = 0,
  totalCentavos,
  meioDePagamento,
  token,
  parcelas,
  descritor,
  pagador,
}) {
  const linhas = montarItens({ itens, freteCentavos, descontoCentavos });

  const somaDasLinhas = linhas.reduce(
    (total, linha) =>
      total + Math.round(Number(linha.unit_price) * 100) * linha.quantity,
    0,
  );

  if (somaDasLinhas !== Number(totalCentavos)) {
    throw new Error(
      `A soma dos itens (${somaDasLinhas}) não fecha com o total do pedido ` +
        `(${totalCentavos}). O Mercado Pago recusaria a order inteira com ` +
        "`order_items_total_amount_mismatch`.",
    );
  }

  const ehPix = meioDePagamento === "pix";
  const tipo = tipoDoMeio(meioDePagamento);

  /**
   * PARCELA E COISA DE CARTAO, e o gateway e literal sobre isso:
   * "'$.transactions.payments[0].payment_method' - additionalProperties
   * 'installments' not allowed", HTTP 400 — medido em 16/09/2026, com Pix.
   *
   * O DETALHE QUE CUSTA A VENDA: o checkout manda `installments: 1` sempre,
   * porque o CardForm preenche o campo e o corpo e o mesmo para os dois meios.
   * Esse `1` inofensivo — parcela unica, o padrao de qualquer compra — fazia a
   * Orders recusar o PEDIDO INTEIRO no Pix. Nao e "ignorado quando nao se
   * aplica": e propriedade nao permitida, e a resposta e 400.
   *
   * A condicao e pelo TIPO, e nao por `!== "pix"`: boleto (`ticket`) e saldo
   * em conta (`account_money`) tambem nao parcelam, e escrever a regra pelo
   * que ela e evita o mesmo 400 no dia em que um deles for ligado.
   */
  const ehCartao = tipo === "credit_card" || tipo === "debit_card";

  const pagamento = {
    amount: reais(totalCentavos),
    ...(ehPix ? { expiration_time: EXPIRACAO_DO_PIX } : {}),
    payment_method: {
      id: meioDePagamento,
      type: tipo,
      ...(token ? { token } : {}),
      ...(ehCartao && parcelas ? { installments: Number(parcelas) } : {}),
      statement_descriptor: descritor,
    },
  };

  return {
    type: "online",
    // O FIO DA CONCILIAÇÃO, e agora ele carrega peso a mais: é por
    // `external_reference` que o webhook reencontra o pedido, porque o id que
    // a notificação traz (numérico) não é o que a loja gravou (o da order).
    external_reference: chaveIdempotencia,
    total_amount: reais(totalCentavos),
    items: linhas,
    payer: montarPagador(pagador),
    transactions: { payments: [pagamento] },
  };
}

/**
 * O que a loja precisa da resposta da order, num objeto só.
 *
 * `pagamentoId` É O ID DA ORDER (`ORDTST01...`), e a escolha tem medição:
 * `GET /v1/payments/PAY01...` responde **404** — o endpoint antigo não lê o id
 * novo —, enquanto `GET /v1/orders/{id}` responde 200. Guardar o `PAY01...`
 * seria guardar uma chave que não abre nenhuma porta. `pedidos.pagamento_id_mp`
 * já é `text` desde a 0005, decisão deliberada de quem escreveu aquela
 * migração, então a string cabe sem migração de banco.
 *
 * O QR DO PIX MUDOU DE LUGAR: era `point_of_interaction.transaction_data`, é
 * `transactions.payments[].payment_method`. E agora vêm TRÊS formas — a URL do
 * ticket (que o checkout já usava), o código copia-e-cola e o PNG em base64.
 * As três são devolvidas porque as três existem; quem escolhe é a tela.
 *
 * NADA AQUI EXPLODE COM RESPOSTA INCOMPLETA: uma order sem `transactions` é
 * resposta possível (recusa, erro parcial), e um `TypeError` nesta função
 * viraria 500 num checkout que precisava responder "cartão recusado".
 */
function leituraDaOrder(order) {
  const pagamento = order?.transactions?.payments?.[0];
  const meio = pagamento?.payment_method;

  return {
    pagamentoId: order?.id,
    status: traduzirStatusDaOrder(order?.status, order?.status_detail),
    statusDoGateway: order?.status,
    detalheDoGateway: order?.status_detail,
    ticketUrl: meio?.ticket_url,
    qrCode: meio?.qr_code,
    qrCodeBase64: meio?.qr_code_base64,
  };
}

/**
 * A RECUSA DO GATEWAY EM UMA LINHA QUE NOMEIA O CAMPO.
 *
 * POR QUE ISTO EXISTE, e custou uma hora para nascer: `console.error` do Node
 * imprime profundidade 2 por padrão, e a recusa da Orders tem a informação útil
 * na profundidade 3 — `errors[].details[]`. O log de produção saía assim:
 *
 *     Erro ao processar pagamento: {
 *       errors: [ { code: 'property_value', message: '...', details: [Array] } ]
 *     }
 *
 * "Invalid value for property" sem dizer QUAL propriedade é um log que só
 * informa que algo deu errado — exatamente o que já se sabia. O que estava
 * escondido dentro daquele `[Array]` era
 * "'$.transactions.payments[0].payment_method' - additionalProperties
 * 'installments' not allowed", que é o diagnóstico inteiro numa frase.
 *
 * PROCURA EM TRÊS LUGARES porque o SDK aninha a resposta em profundidades
 * diferentes conforme o caminho do erro (lançado pela validação, pelo HTTP, ou
 * embrulhado em `cause`). Olhar num lugar só fazia a linha sair vazia
 * justamente na falha que importava.
 *
 * NUNCA LANÇA: uma função que existe para explicar erro não pode ser a próxima
 * causa de erro. Sem forma reconhecível, devolve a mensagem que houver.
 */
function descreverErroDoMp(erro) {
  const listas = [erro?.errors, erro?.cause?.errors, erro?.response?.data?.errors];
  const erros = listas.find((lista) => Array.isArray(lista) && lista.length);

  if (!erros) return String(erro?.message || erro || "erro sem mensagem");

  return erros
    .map((e) => {
      const detalhes = Array.isArray(e?.details) ? e.details.join("; ") : "";
      return [e?.code, e?.message, detalhes].filter(Boolean).join(" — ");
    })
    .join(" | ");
}

module.exports = {
  montarCorpoDaOrder,
  descreverErroDoMp,
  traduzirStatusDaOrder,
  leituraDaOrder,
  reais,
  LIMITE_EXTERNAL_CODE,
  EXPIRACAO_DO_PIX,
};
