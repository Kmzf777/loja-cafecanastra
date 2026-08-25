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
 * Os nomes das dimensões em PORTUGUÊS, para a frase que o operador lê.
 *
 * Os campos viajam em inglês porque é o contrato da Melhor Envio e são os
 * aliases do `cotacaoRepository`. Mas quem recebe o log de "produto sem X" é o
 * gestor da loja, e ele vai procurar "peso" no formulário do painel — não
 * "weight". Traduzir na borda é mais barato que renomear o contrato.
 */
const NOME_DO_CAMPO = {
  weight: "peso",
  width: "largura",
  height: "altura",
  length: "comprimento",
};

/**
 * A resposta ÚNICA para `ITEM_SEM_PACOTE`, usada pelas DUAS rotas.
 *
 * As duas encontram o mesmo produto quebrado — a vitrine ao cotar, o checkout ao
 * reconferir — e têm de dizer a mesma coisa sobre ele. Deixar cada uma com a
 * própria frase e o próprio status é como o `frontend` e o backend acabaram
 * discordando sobre o pacote, um degrau abaixo: duas cópias divergem, e a
 * primeira correção só acerta uma.
 *
 * 422 E NÃO 500/503, e é aqui que mora a diferença que importa. 5xx diz "o
 * serviço caiu": convida a tentar de novo e acorda quem está de plantão. Este
 * erro é determinístico e permanente até alguém EDITAR o produto — toda
 * tentativa falha igualzinha, e "tente novamente em instantes" é mentira. 422
 * diz o que de fato é: a requisição está bem formada, mas tem um item que esta
 * loja não consegue processar.
 *
 * As duas audiências ficam separadas de propósito: `log` nomeia produto e
 * coluna, porque quem conserta é o operador; `mensagem` carrega a saída que o
 * CLIENTE tem agora (tirar o item da sacola), porque ele não pode esperar o
 * conserto.
 */
function respostaDeItemSemPacote(erro) {
  const campo = NOME_DO_CAMPO[erro.campo] || erro.campo;
  return {
    status: 422,
    mensagem:
      "Um dos produtos da sacola está sem peso ou medidas cadastradas, " +
      "então não dá para calcular o frete dele. Remova o item para " +
      "seguir, ou fale com a loja.",
    log:
      `o produto ${erro.productId} está sem ${campo} no catálogo. ` +
      "Corrija peso e dimensões no painel — toda cotação com este item " +
      "falha até lá.",
  };
}

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
 * O catch aqui nao devolve dado errado como se fosse certo: devolve "sem frete
 * gratis", com erro no log, e o cliente paga o frete real.
 *
 * O QUE ELE COMPRAVA ACABOU NA F8, e o texto que morava aqui virou falso.
 * Dizia que a cotacao publica nao podia cair junto com o banco, "porque ela
 * funciona ate sem cadastro". Isso era verdade: antes da F8 esta rota inventava
 * peso e dimensao no codigo e nao consultava produto nenhum, entao cotava ate
 * item que o catalogo desconhecia. Hoje `calculate` COMECA por
 * `montarItensDaCotacao`, que le produtos e promocoes — com o banco fora, a
 * requisicao morre la e esta funcao nem chega a ser chamada; e product_id que o
 * catalogo nao conhece agora e 400, nao uma cotacao com default.
 *
 * O QUE ELE AINDA ABSORVE e so uma falha ISOLADA em `config_loja`: o banco de
 * pe, produtos e promocoes ja respondidos, e so esta leitura falhando. E
 * absorver isso NAO e de graca. Sem o piso, a cotacao devolve frete com preco;
 * se no checkout a leitura funcionar, o subtotal cruza o piso, a opcao vira
 * zero, o par nome/preco nao casa e sai 409 "o frete mudou". E o mesmo 409 do
 * fallback de promocoes que a F8 removeu (ver `montarItensDaCotacao`), so que
 * na direcao oposta — prometer de MENOS quebra igual, porque o casamento e
 * exato.
 *
 * ENTAO POR QUE ELE CONTINUA AQUI: por ESCOPO, nao por mecanismo. Este catch e
 * anterior a F8, e nenhum teste fixa o caminho de falha dele — o que torna
 * remove-lo facil demais para se fazer de passagem, junto de outra correcao.
 * Pelo argumento acima ele provavelmente deveria sair; isso e decisao de quem
 * cuida do frete gratis, com um teste que fixe a escolha.
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
   * SEM DEFAULT: item sem pacote completo é recusa, não pacote inventado.
   *
   * O default antigo era 0,3 kg e 20×5×20 cm, que não é nenhum produto do
   * catálogo — os reais pesam de 0,250 a 2,000 kg e medem 18×7×24 ou 24×10×32.
   *
   * Quem chama traz peso e dimensões do banco: `montarItensDaCotacao` na rota
   * pública, a leitura prévia do `PaymentController` no checkout. POR QUE os
   * dois têm de ler o mesmo, está na docstring do `cotacaoRepository`.
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
        // Campo e produto SEPARADOS da frase para o handler poder logar o que
        // o operador precisa (qual produto, qual coluna) sem reabrir a string.
        erro.productId = item.product_id;
        erro.campo = campo;
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
   * publica o relê em `montarItensDaCotacao`, o checkout em `createPayment`.
   * NAO e o `conferirFrete` quem relê — ele nao consulta nada, recebe os itens
   * ja montados; quem le e quem chama. Antes, o preco da rota publica vinha do
   * navegador, e era por isso que a promessa de frete gratis da vitrine podia
   * nao sobreviver ao pagamento.
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
 * Peso, dimensões e preço saem do banco, e é o que faz esta cotação e a
 * recotação do checkout (`conferirFrete`) chegarem ao MESMO número — que era
 * exatamente o que não acontecia antes da F8.
 *
 * A `categoria` também é lida, mas NÃO viaja no item devolvido: ela serve aqui
 * dentro, para `precoComPromocao` decidir se uma promoção de categoria pega
 * este produto. A transportadora não tem o que fazer com ela, e devolvê-la
 * daria a impressão de que alguém adiante depende do campo.
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
    /**
     * A QUANTIDADE, com a mesma régua do checkout (`PaymentController`, que
     * confere inteiro entre 1 e 999 no mesmo laço do uuid). Aqui ela faltava, e
     * `quantity: -3` atravessava até a Melhor Envio — além de envenenar a regra
     * da entrega local, que zera o frete a partir de 3 unidades somadas.
     *
     * O princípio é o mesmo da checagem de uuid logo acima: as duas rotas têm
     * de dizer a MESMA coisa sobre a mesma sacola ruim. Uma sacola que o
     * checkout vai recusar não pode receber uma cotação bonita antes.
     */
    const quantidade = Number(item.quantity);
    if (!Number.isInteger(quantidade) || quantidade < 1 || quantidade > 999) {
      const erro = new Error("Quantidade inválida em um dos itens.");
      erro.code = "QUANTIDADE_INVALIDA";
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
   * SOBRAM DOIS CATCHES COM ESTE MESMO DEFEITO, e nenhum deles é precedente
   * para um catch aqui. Os dois são anteriores à F8, e ficam por ESCOPO, não
   * por mérito — mexer neles de passagem seria mudar comportamento alheio no
   * escuro. Ficam nomeados para a lista não ser mentira:
   *
   * 1. `freteGratisMinimoCentavos` (bem acima). Sobrevivente da rota PRÉ-F8,
   *    quando esta cotação rodava sem banco nenhum: hoje `calculate` já leu
   *    produtos e promoções antes, então com o banco fora a requisição morre
   *    antes e aquele catch nem é alcançado. O que ele ainda absorve é uma
   *    falha isolada em `config_loja`, e absorvê-la dá o 409 desta conta na
   *    direção oposta — cotação com preço, checkout com grátis. A docstring
   *    dele explica.
   *
   * 2. O catch do CUPOM, no handler `calculate` logo abaixo. Como
   *    `buscarPorCodigo` devolve `rows[0]`, código inexistente é `undefined` e
   *    não exceção: aquele catch só dispara com o BANCO falhando. E aí o
   *    caminho é idêntico ao desta conta — sem desconto o subtotal fica mais
   *    alto, cruza o piso, a vitrine promete grátis, o checkout aplica o
   *    desconto, o subtotal cai abaixo do piso e o par não casa. Mesmo 409,
   *    mesma direção de dano.
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
        // Os três são sacola ruim, não loja quebrada: id que nunca foi uuid (a
        // sacola velha da Tray), quantidade que não é quantidade, e uuid de
        // produto que saiu do catálogo. 400 nos três, para o navegador saber
        // que o problema está na sacola dele.
        if (
          erro.code === "PRODUTO_ID_INVALIDO" ||
          erro.code === "QUANTIDADE_INVALIDA" ||
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
          /**
           * ESTE CATCH SÓ DISPARA COM O BANCO FALHANDO, e não com cupom
           * inexistente: `buscarPorCodigo` devolve `rows[0]`, então código que
           * ninguém cadastrou é `undefined` e `avaliarCupom` o recusa sem
           * exceção. O nome "cupom ignorado" sempre deu a entender o contrário.
           *
           * E seguir sem desconto tem o preço que `montarItensDaCotacao`
           * descreve: subtotal mais alto → cruza o piso → a vitrine promete
           * frete grátis → no checkout o desconto entra, o subtotal cai abaixo
           * do piso, a opção volta a ter preço e o par não casa. 409.
           *
           * Fica por ESCOPO — é anterior a esta correção e sem teste que fixe
           * o caminho de falha dele. Está na lista de catches condenados na
           * docstring de `montarItensDaCotacao`, para não passar por seguro.
           */
          console.error(
            "Cupom não pôde ser lido na cotação (banco), seguindo SEM desconto:",
            erro.message,
          );
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

      /**
       * PRODUTO COM PACOTE INCOMPLETO — dado da LOJA errado, não da sacola.
       *
       * É alcançável de verdade: `numeroPositivo` (dashboardRepository) aceita
       * zero, e não há CHECK em `peso`, então um gestor que digite 0 no campo
       * de peso cria um produto que derruba TODA cotação que o contenha, para
       * sempre. Sem este braço isso saía como "Falha ao calcular frete", que
       * não nomeia nada: ninguém descobre qual produto, e a loja parece
       * quebrada quando quem está errado é uma linha do catálogo.
       *
       * O status e as duas frases vêm de `respostaDeItemSemPacote`, que o
       * `conferirFrete` do checkout também usa — o porquê está lá.
       */
      if (error.code === "ITEM_SEM_PACOTE") {
        const resposta = respostaDeItemSemPacote(error);
        console.error("Cotação impossível:", resposta.log);
        return res.status(resposta.status).json({ error: resposta.mensagem });
      }

      console.error("Erro geral no frete:", error);
      return res.status(500).json({ error: "Falha ao calcular frete" });
    }
  }
}

module.exports = new ShippingController();
module.exports.calcularOpcoesDeFrete = calcularOpcoesDeFrete;
module.exports.montarItensDaCotacao = montarItensDaCotacao;
module.exports.respostaDeItemSemPacote = respostaDeItemSemPacote;
