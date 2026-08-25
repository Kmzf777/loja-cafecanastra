const axios = require("axios");
const pool = require("../pgPool");
// Sem ciclo aqui: cuponsRepository, cotacaoRepository, promotionsRepository e
// os utils só dependem do pgPool. (É o PaymentController que importa ESTE
// módulo, nunca o contrário — e é por isso que a lista abaixo não pode ganhar
// um require de controller.)
const cuponsRepository = require("../repositories/cuponsRepository");
const cotacaoRepository = require("../repositories/cotacaoRepository");
const PromotionsRepository = require("../repositories/promotionsRepository");
const { avaliarCupom, normalizarCodigo } = require("../utils/cupom");
const { ehUuid } = require("../utils/formatoUuid");
const { precoComPromocao, somarCentavos } = require("../utils/preco");

/**
 * Uma instância por processo, como no PaymentController e no CuponsController:
 * o repositório não guarda estado (fala com o pool, que já é singleton), então
 * instanciar por requisição seria lixo de graça.
 */
const promotionsRepo = new PromotionsRepository();

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
 * Subtotal dos itens em CENTAVOS — delega para `somarCentavos` (utils/preco),
 * a MESMA soma do checkout e da validacao de cupom, para os tres nunca
 * discordarem sobre o mesmo carrinho. O nome local fica pelo contexto: aqui
 * ele e o lado esquerdo da comparacao com o piso do frete gratis.
 */
function subtotalEmCentavos(itens) {
  return somarCentavos(itens);
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
 *
 * `descontoCentavos` (F6): o cupom entra na decisao de frete gratis — o piso
 * e comparado com o subtotal COM desconto. Quem chama e responsavel pelo
 * numero: o checkout o recalcula dos precos do banco (PaymentController), e a
 * rota publica o deriva do proprio cupom (handler abaixo). Nunca e um valor
 * cru do corpo da requisicao.
 */
async function calcularOpcoesDeFrete({ zipCode, itens, descontoCentavos = 0 }) {
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

  /**
   * SEM DEFAULT, E ESTA É A CORREÇÃO DA F8.
   *
   * Este bloco tinha `item.weight ? Number(item.weight) : 0.3` e três irmãos
   * para as dimensões. Como o navegador nunca manda esses campos
   * (`frontend/lib/sacola/checkout.ts` envia product_id, quantity e price),
   * TODA cotação da vitrine saía com um pacote de 0,3 kg e 20×5×20 — que não é
   * nenhum produto do catálogo. O checkout recotava com o peso do banco, os
   * dois números discordavam, e o cliente levava 409 na hora de pagar.
   *
   * Recusar é o lado seguro do erro: cotação que falha é um aviso na tela;
   * cotação errada é uma venda perdida no último passo, sem ninguém saber por
   * quê. Quem chama é responsável por trazer o pacote do banco
   * (`cotacaoRepository.lerParaCotacao`).
   */
  const productsPayload = itens.map((item) => {
    const dimensoes = {
      width: Number(item.width),
      height: Number(item.height),
      length: Number(item.length),
      weight: Number(item.weight),
    };
    for (const [campo, valor] of Object.entries(dimensoes)) {
      if (!Number.isFinite(valor) || valor <= 0) {
        const erro = new Error(
          `Item ${item.product_id} sem ${campo}: o peso e as dimensões têm de ` +
            "vir do banco (cotacaoRepository), nunca do navegador.",
        );
        erro.code = "ITEM_SEM_PACOTE";
        throw erro;
      }
    }
    return {
      id: item.product_id,
      ...dimensoes,
      insurance_value: Number(item.price),
      quantity: Number(item.quantity),
    };
  });

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
   * mantem o `conferirFrete` simples: a opcao que o cliente escolheu casa com
   * o zero, seja ela qual for. Quem separa uma opcao da outra depois do zero e
   * o NOME — e por isso que `conferirFrete` casa nome e preco, nao so o preco.
   *
   * O `price` dos itens vem do BANCO nos DOIS caminhos desde a F8: a rota
   * publica o relê em `montarItensDaCotacao` e o checkout em `conferirFrete`.
   * Antes o da rota publica vinha do navegador, e era por isso que a promessa
   * de frete gratis da vitrine podia nao sobreviver ao pagamento.
   */
  // O desconto do cupom abate ANTES da comparacao com o piso: um carrinho de
  // R$ 160 com cupom de 10% e um carrinho de R$ 144 para efeito de frete
  // gratis. `Math.max(0, ...)` porque um fixed maior que o subtotal ja foi
  // travado por quem calculou o desconto, mas esta funcao nao confia nisso.
  const minimo = await freteGratisMinimoCentavos();
  const subtotalComDesconto = Math.max(
    0,
    subtotalEmCentavos(itens) - (Number(descontoCentavos) || 0),
  );
  if (minimo !== null && subtotalComDesconto >= minimo) {
    shippingOptions = shippingOptions.map((opcao) => ({
      ...opcao,
      price: 0,
      gratis: true,
    }));
  }

  return shippingOptions;
}

/**
 * Transforma o que o NAVEGADOR mandou no pacote que a transportadora vai levar.
 *
 * Do corpo da requisição sobrevivem dois campos: `product_id` e `quantity`.
 * Todo o resto — peso, dimensões, preço, categoria — vem do banco. É o que faz
 * esta cotação e a recotação do checkout (`conferirFrete`) chegarem ao MESMO
 * número, que era exatamente o que não acontecia antes da F8.
 *
 * O PREÇO TAMBÉM VEM DO BANCO, e não é excesso de zelo: o preço entra na
 * decisão de frete grátis (o piso é comparado com o subtotal) e na promoção. O
 * checkout aplica `precoComPromocao`; se aqui o preço viesse da sacola, um
 * carrinho com promoção ativa poderia prometer frete grátis que o checkout
 * recusaria — o mesmo 409 por outra porta.
 */
async function montarItensDaCotacao(items) {
  /**
   * A SACOLA VELHA DA TRAY É O CASO REAL AQUI, e é por isso que a checagem vem
   * ANTES da consulta. A loja está saindo da Tray, e a sacola mora no
   * `localStorage` do navegador: quem voltar com um carrinho montado na loja
   * antiga traz `product_id` NUMÉRICO, o id da Tray, não o uuid do Postgres.
   * Isso não é hipótese — é a cauda esperada da migração.
   *
   * Sem esta linha esse id chega ao `ANY($1::uuid[])` do `lerParaCotacao`,
   * estoura 22P02 lá dentro e a rota devolve 500 "Falha ao calcular frete": a
   * loja parece quebrada quando quem está velho é o carrinho. Pior, o checkout
   * já responde 400 "Identificador de produto inválido." para a MESMA sacola
   * (`PaymentController`) — as duas rotas discordando sobre o mesmo problema.
   * A frase daqui é igual à de lá de propósito.
   *
   * `ehUuid` vem de `utils/formatoUuid`, que existe exatamente para esta
   * expressão não ser copiada mais uma vez.
   */
  for (const item of items) {
    if (!ehUuid(item.product_id)) {
      const erro = new Error("Identificador de produto inválido.");
      erro.code = "PRODUTO_ID_INVALIDO";
      throw erro;
    }
  }

  const ids = items.map((i) => i.product_id);
  const porId = await cotacaoRepository.lerParaCotacao(ids);

  /**
   * SEM `.catch` AQUI, E A VERSÃO ANTERIOR TINHA UM — com a justificativa
   * errada: "sem promoção vale o preço de catálogo, que é mais ALTO, o lado
   * seguro do erro". Não é o lado seguro. É o 409 que esta correção inteira
   * existe para matar, entrando por outra porta.
   *
   * A CONTA, com o piso do frete grátis em R$ 100,00: as promoções falham na
   * cotação → preço de catálogo R$ 109,90 → subtotal 10990 ≥ piso → toda opção
   * sai zerada e `gratis: true`, e a vitrine promete frete grátis. Trinta
   * segundos depois, no checkout, as promoções respondem → preço promocional
   * R$ 87,92 → subtotal 8792 < piso → o PAC volta a custar R$ 24,90.
   * `conferirFrete` casa nome E preço; o par não bate; o cliente leva 409 na
   * hora de pagar, depois de ter lido "frete grátis" na tela.
   *
   * E NÃO EXISTE LADO SEGURO PARA ONDE CAIR — é isto que derruba o argumento
   * do "preço mais alto". O casamento do checkout é EXATO, então prometer de
   * MENOS estoura 409 exatamente igual a prometer de mais. O que precisa ser
   * verdade não é "errar para o lado bom": é NÃO DIVERGIR. Com as promoções
   * mudas, a única forma de não divergir é não responder.
   *
   * POR QUE ISTO NÃO CONTRADIZ `freteGratisMinimoCentavos` (bem acima), que
   * TEM catch e assume o mesmo risco de 409 de olhos abertos: lá o catch
   * compra uma coisa que aqui não existe — a cotação da vitrine continuar de
   * pé com o BANCO fora do ar. Aqui o banco acabou de responder: o
   * `lerParaCotacao` deste mesmo carrinho está na linha de cima. Não há
   * vitrine a salvar, só um número que o checkout não vai confirmar.
   *
   * O checkout também não protege esta leitura (`PaymentController`): lá uma
   * falha de promoção já é 500. Um catch só deste lado deixaria os dois
   * assimétricos de propósito, que é a definição do problema.
   *
   * Cotação que falha é um aviso na tela, com botão de tentar de novo. Cotação
   * errada é uma venda perdida no último passo, e com cara de propaganda
   * enganosa.
   */
  const promocoes = await promotionsRepo.findActivePromotionsForCheckout();

  return items.map((item) => {
    const produto = porId.get(String(item.product_id));
    if (!produto) {
      const erro = new Error(`O produto ${item.product_id} não existe.`);
      erro.code = "PRODUTO_INEXISTENTE";
      throw erro;
    }
    return {
      product_id: produto.product_id,
      quantity: Number(item.quantity),
      price: precoComPromocao(produto, promocoes),
      weight: produto.weight,
      width: produto.width,
      height: produto.height,
      length: produto.length,
    };
  });
}

class ShippingController {
  async calculate(req, res) {
    try {
      const { zipCode, items, cupom } = req.body;
      if (!zipCode) return res.status(400).json({ error: "CEP é obrigatório" });
      if (!Array.isArray(items) || items.length === 0) {
        return res.status(400).json({ error: "Informe os itens do carrinho." });
      }

      /**
       * Cupom na cotacao (F6): opcional, e so o CODIGO — o desconto e
       * resolvido aqui, do banco, com a MESMA `avaliarCupom` do checkout.
       * Sem isto, um cupom que derruba o subtotal para baixo do piso faria a
       * cotacao prometer frete gratis que o `conferirFrete` (que desconta)
       * recusaria com 409.
       *
       * Cupom invalido NAO derruba a cotacao: frete e frete — quem explica o
       * problema do cupom e o POST /cupons/validar. Aqui ele apenas nao
       * desconta. E o resultado desta rota continua sendo SUGESTAO: quem decide
       * dinheiro e o checkout, que confere estoque e trava as linhas antes de
       * cobrar. O que mudou na F8 e que os dois agora contam a partir da MESMA
       * base — as linhas do banco, nao a sacola do navegador.
       */
      let itensDoBanco;
      try {
        itensDoBanco = await montarItensDaCotacao(items);
      } catch (erro) {
        // Os dois são sacola ruim, não loja quebrada: id que nunca foi uuid
        // (a sacola velha da Tray) e uuid de produto que saiu do catálogo.
        // 400 nos dois, para o navegador saber que precisa limpar a sacola.
        if (
          erro.code === "PRODUTO_ID_INVALIDO" ||
          erro.code === "PRODUTO_INEXISTENTE"
        ) {
          return res.status(400).json({ error: erro.message });
        }
        throw erro;
      }

      let descontoCentavos = 0;
      const codigoDeCupom = normalizarCodigo(cupom);
      if (codigoDeCupom) {
        try {
          const linha = await cuponsRepository.buscarPorCodigo(codigoDeCupom);
          // O subtotal do cupom sai dos itens DO BANCO, pela mesma razão que o
          // do frete grátis: os dois lados têm de somar sobre a mesma base.
          const avaliacao = avaliarCupom(
            linha,
            subtotalEmCentavos(itensDoBanco),
          );
          if (avaliacao.valido) descontoCentavos = avaliacao.descontoCentavos;
        } catch (erro) {
          console.error("Cupom ignorado na cotação de frete:", erro.message);
        }
      }

      const opcoes = await calcularOpcoesDeFrete({
        zipCode,
        itens: itensDoBanco,
        descontoCentavos,
      });
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
module.exports.montarItensDaCotacao = montarItensDaCotacao;
