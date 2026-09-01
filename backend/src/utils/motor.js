"use strict";

/**
 * O motor de desconto, PURO — sem banco, sem Express, sem relógio próprio.
 *
 * É uma função só, `calcularDescontos(carrinho, regras)`, e o isolamento é o
 * que permite testar precedência, empilhamento e arredondamento sem subir
 * Postgres. Mesmo desenho de `utils/preco.js` e `utils/cupom.js`, e pela mesma
 * razão: a regra que decide dinheiro tem de ser legível e testável num lugar
 * só. Quem lê o banco e monta a entrada daqui é `repositories/motorRepository`.
 *
 * A ORDEM DE APLICAÇÃO É DECLARADA, NÃO EMERGENTE. O que existe hoje em
 * `utils/preco.js:56` é um `Math.min` ingênuo entre todas as promoções que
 * casam — "a mais generosa ganha" é acidente do laço, não decisão de ninguém.
 * Aqui a ordem é:
 *
 *   1. classe `produto` .. sobre a LINHA, item a item.
 *   2. classe `pedido` ... sobre o subtotal JÁ REDUZIDO pela etapa 1. Duas
 *      regras de pedido incidem sobre o MESMO subtotal da etapa 1, nunca
 *      compostas entre si — senão a segunda desconta sobre o que a primeira
 *      deixou e o gestor recebe um desconto composto que ninguém cadastrou.
 *   3. classe `frete` .... por último, porque depende do subtotal final.
 *
 * Dentro de cada classe: `prioridade` decrescente, empate por `criada_em` e
 * depois por `id` (o desempate tem de ser TOTAL — dois valores iguais deixariam
 * o resultado depender da ordem de varredura do Postgres, que é exatamente o
 * defeito que `promocao_faixas_piso_unico` foi criado para impedir no banco).
 * `exclusiva` sem grupo corta o resto da classe; `exclusiva` com
 * `grupo_exclusividade` corta só o grupo — o CHECK de 0032 garante que grupo
 * preenchido implica exclusiva, então as duas formas cobrem tudo.
 *
 * TUDO EM CENTAVOS INTEIROS, SEMPRE. `utils/preco.js` já documenta o porquê:
 * 10% sobre 49,90 em float dá 44.910000000000004, e esse número iria para o
 * `itens` jsonb IMUTÁVEL do pedido (regra de 0005) e para a soma cobrada no
 * gateway. Aqui há um segundo motivo, mais duro: cada ajuste vira uma linha de
 * `pedido_ajustes_desconto` com `valor_centavos integer`, e a pergunta que
 * aquela tabela existe para responder — "por que este pedido saiu por R$
 * 137,40?" — só tem resposta se a soma das linhas for exatamente a diferença
 * do subtotal. Por isso o valor de cada linha é SUBTRAÍDO do estado depois de
 * arredondado: a identidade não é conferida no fim, ela é construída.
 *
 * O QUE ESTE MÓDULO NÃO FAZ, de propósito: não lê limite de uso, não conhece
 * `promocao_resgates` e não sabe se um código existe. Isso é do repositório,
 * que só entrega aqui as regras que já valem para este carrinho e este
 * cliente. Um motor que consultasse limite seria um motor com banco dentro.
 */

/* -------------------------------------------------------------------------- *
 * Vocabulário
 * -------------------------------------------------------------------------- */

/** Classes, na ORDEM de aplicação. A ordem desta lista é a regra. */
const ORDEM_DAS_CLASSES = Object.freeze(["produto", "pedido", "frete"]);

/**
 * O vocabulário FECHADO de meio de pagamento da loja (0032), e a tradução do
 * vocabulário ABERTO do Mercado Pago para ele.
 *
 * O que o checkout grava em `pedidos.metodo_pagamento` é o `payment_method_id`
 * do MP (`PaymentController.js`), e aquilo é uma lista aberta: 'visa',
 * 'master', 'elo', 'amex', 'hipercard', 'bolbradesco', 'debvisa'... Uma regra
 * escrita contra 'visa' simplesmente não se aplicaria a um Mastercard, EM
 * SILÊNCIO — que é a armadilha que a 0032 fechou no schema fechando a lista.
 *
 * A tradução mora aqui, num lugar só e testável, porque é a mesma decisão em
 * três pontos futuros (cobrança, cotação e relatório) e três cópias divergiriam.
 *
 * O DEFAULT É `credito` E ISSO É DELIBERADO: cartão é o caso comum e o
 * vocabulário do MP para crédito é aberto de verdade (cada bandeira nova entra
 * com um id próprio). Pix e boleto são listas curtas e estáveis, e débito tem
 * o prefixo `deb` — os três são reconhecidos por nome; o resto é cartão de
 * crédito. Entrada vazia devolve `null`, e uma regra com `meios_pagamento`
 * preenchido NÃO se aplica a `null`: desconto que depende do meio de pagamento
 * só vale quando se sabe qual é.
 */
const MEIOS_PIX = Object.freeze(["pix", "bank_transfer"]);
const MEIOS_BOLETO = Object.freeze(["bolbradesco", "boleto", "pec", "ticket"]);
const MEIOS_DEBITO = Object.freeze(["maestro", "debit_card", "debito"]);

function meioDePagamentoDaLoja(idDoMercadoPago) {
  const bruto = String(idDoMercadoPago || "").trim().toLowerCase();
  if (!bruto) return null;
  if (MEIOS_PIX.includes(bruto)) return "pix";
  if (MEIOS_BOLETO.includes(bruto)) return "boleto";
  if (MEIOS_DEBITO.includes(bruto) || bruto.startsWith("deb")) return "debito";
  return "credito";
}

/* -------------------------------------------------------------------------- *
 * Aritmética
 * -------------------------------------------------------------------------- */

/** Reais (numeric do pg chega como string) → centavos inteiros. */
function emCentavos(reais) {
  return Math.round(Number(reais) * 100);
}

/** Inteiro não negativo, ou 0. Blinda contra `null`, `undefined` e NaN. */
function inteiro(valor) {
  const n = Number(valor);
  return Number.isFinite(n) ? Math.round(n) : 0;
}

/**
 * Reparte `total` entre `pesos` devolvendo INTEIROS que somam exatamente
 * `total` — método do maior resto.
 *
 * Existe por causa do teto: "20% com teto de R$ 30" numa compra de três linhas
 * precisa cortar o desconto das três de forma que a soma dê 3000 e nem um
 * centavo a mais. Arredondar cada parte isolada erraria a soma, e o erro iria
 * direto para a diferença entre `pedido_ajustes_desconto` e o valor cobrado.
 */
function ratear(total, pesos) {
  const somaDosPesos = pesos.reduce((a, p) => a + p, 0);
  if (somaDosPesos <= 0 || total <= 0) return pesos.map(() => 0);

  const exatos = pesos.map((p) => (total * p) / somaDosPesos);
  const partes = exatos.map((x) => Math.floor(x));
  let sobra = total - partes.reduce((a, p) => a + p, 0);

  // Os maiores restos recebem o troco, um centavo cada, em ordem estável.
  const ordem = exatos
    .map((x, i) => ({ i, resto: x - Math.floor(x) }))
    .sort((a, b) => b.resto - a.resto || a.i - b.i);

  for (let k = 0; sobra > 0; k += 1, sobra -= 1) {
    partes[ordem[k % ordem.length].i] += 1;
  }
  return partes;
}

/* -------------------------------------------------------------------------- *
 * Escopo
 * -------------------------------------------------------------------------- */

/** "  Café Especial " ≡ "café especial". A mesma normalização de preco.js. */
function textoNormalizado(valor) {
  return String(valor ?? "").trim().toLowerCase();
}

/** Uma linha de `promocao_escopo` contra um item do carrinho. */
function escopoCasa(linhaDeEscopo, item) {
  const alvo = textoNormalizado(linhaDeEscopo.alvo);
  switch (linhaDeEscopo.tipo) {
    case "todos":
      return true;
    case "produto":
      return alvo !== "" && alvo === textoNormalizado(item.produtoId);
    case "sku":
      return alvo !== "" && alvo === textoNormalizado(item.sku);
    case "categoria":
      return alvo !== "" && alvo === textoNormalizado(item.categoria);
    default:
      // 'assinante' não seleciona item — é porteiro, tratado em `portaAberta`.
      return false;
  }
}

/**
 * O porteiro `assinante` (o Clube, 0015). É condição de SIM/NÃO sobre o
 * carrinho inteiro, não filtro de item — por isso ele não entra na conta das
 * inclusões abaixo. `incluir = false` é a forma de dizer "esta regra é para
 * quem NÃO assina".
 */
function portaAberta(regra, carrinho) {
  const porteiros = (regra.escopo || []).filter((e) => e.tipo === "assinante");
  return porteiros.every((p) => Boolean(carrinho.assinante) === Boolean(p.incluir));
}

/**
 * As linhas do carrinho que a regra alcança.
 *
 * A AUSÊNCIA DE INCLUSÃO SIGNIFICA COISAS DIFERENTES POR CLASSE, e as duas
 * leituras estão escritas no repositório de origem, não inventadas aqui:
 *
 *   classe `produto` ..... sem inclusão a regra é INERTE. É o comportamento que
 *                          a 0032 preservou palavra por palavra ao migrar as
 *                          promoções legadas: "sem linha de escopo elas
 *                          continuam inertes". Tratar ausência como "a loja
 *                          toda" viraria 10% em tudo por um campo em branco —
 *                          o mesmo erro caro que o CHECK `sku SEM alvo` barra.
 *   `pedido` e `frete` ... sem inclusão a regra vale para o pedido inteiro. É o
 *                          que o cupom SEMPRE foi (`utils/cupom.js` desconta
 *                          sobre o subtotal, sem escopo nenhum), e é como a
 *                          0032 migrou `cupons` — sem nenhuma linha de escopo.
 */
function linhasAlcancadas(regra, linhas, carrinho) {
  if (!portaAberta(regra, carrinho)) return [];

  const escopo = (regra.escopo || []).filter((e) => e.tipo !== "assinante");
  const inclusoes = escopo.filter((e) => e.incluir);
  const exclusoes = escopo.filter((e) => !e.incluir);

  let alcancadas;
  if (inclusoes.length === 0) {
    if (regra.classe === "produto") return [];
    alcancadas = linhas.slice();
  } else {
    alcancadas = linhas.filter((linha) =>
      inclusoes.some((e) => escopoCasa(e, linha.item)),
    );
  }

  if (exclusoes.length === 0) return alcancadas;
  return alcancadas.filter(
    (linha) => !exclusoes.some((e) => escopoCasa(e, linha.item)),
  );
}

/* -------------------------------------------------------------------------- *
 * Condições
 * -------------------------------------------------------------------------- */

/**
 * O mínimo, contra a base sobre a qual a regra incide.
 *
 * `quantidade` CONTA SÓ OS ITENS ELEGÍVEIS, e este é o ponto que separa uma
 * regra que funciona de uma que dá dinheiro embora: "leve 3 do micro-lote"
 * contado sobre o carrinho inteiro seria satisfeito por 3 pacotes do clássico,
 * e o desconto do micro-lote sairia sem que nenhum micro-lote estivesse na
 * sacola.
 */
function atendeMinimo(regra, baseCentavos, quantidadeElegivel) {
  if (regra.minimoTipo === "subtotal") {
    return baseCentavos >= inteiro(regra.minimoValor);
  }
  if (regra.minimoTipo === "quantidade") {
    return quantidadeElegivel >= inteiro(regra.minimoValor);
  }
  return true;
}

/** A regra condicionada a meio de pagamento contra o meio DESTE checkout. */
function meioDePagamentoCasa(regra, carrinho) {
  if (!Array.isArray(regra.meiosPagamento) || regra.meiosPagamento.length === 0) {
    return true;
  }
  // Sem meio conhecido a regra NÃO vale: um desconto de Pix aplicado a um
  // pagamento cujo método ainda não se sabe é um desconto que a cobrança não
  // consegue justificar depois.
  if (!carrinho.meioPagamento) return false;
  return regra.meiosPagamento.includes(carrinho.meioPagamento);
}

/**
 * As condições próprias de `promocao_frete`.
 *
 * O TETO É COMPARADO COM O FRETE BRUTO, e é assim que "frete grátis até R$ 30"
 * significa o que o gestor quis: uma modalidade de R$ 90 fica de fora inteira
 * (o cliente paga os R$ 90), em vez de ganhar R$ 30 de abatimento. Bancar
 * parcialmente um SEDEX para o Acre é justamente o que aquele campo existe
 * para impedir.
 *
 * O CEP entra em DÍGITOS. A comparação é de texto e isso basta porque o CHECK
 * de 0032 garante 8 dígitos dos dois lados — mas quem chama tem de normalizar,
 * e por isso a normalização acontece aqui também: comparar '01310-100' com
 * '01310100' é o bug que passa em todo teste escrito com o formato certo e
 * falha no primeiro cliente que digitar o hífen.
 */
function condicoesDeFreteCasam(regra, frete) {
  const cfg = regra.frete;
  if (!cfg) return true;

  if (cfg.tetoFreteCentavos !== null && cfg.tetoFreteCentavos !== undefined) {
    if (frete.valorCentavos > inteiro(cfg.tetoFreteCentavos)) return false;
  }
  if (cfg.apenasModalidadeMaisBarata && !frete.ehMaisBarata) return false;

  if (Array.isArray(cfg.ufs) && cfg.ufs.length > 0) {
    const uf = String(frete.uf || "").trim().toUpperCase();
    if (!uf || !cfg.ufs.includes(uf)) return false;
  }

  if (cfg.cepInicio && cfg.cepFim) {
    const cep = String(frete.cep || "").replace(/\D/g, "");
    if (cep.length !== 8) return false;
    if (cep < String(cfg.cepInicio) || cep > String(cfg.cepFim)) return false;
  }

  return true;
}

/* -------------------------------------------------------------------------- *
 * Mecânicas
 * -------------------------------------------------------------------------- */

/**
 * A faixa que vale, dada a quantidade elegível: A MAIS ALTA ATINGIDA, nunca a
 * soma das faixas.
 *
 * Somar as faixas de um progressivo dá desconto composto que ninguém cadastrou
 * — "5% a partir de 3, 10% a partir de 6" viraria 15% em seis unidades, e o
 * gestor descobriria no relatório do mês.
 */
function faixaVigente(regra, quantidade, tipoEsperado = null) {
  const candidatas = (regra.faixas || [])
    .filter((f) => inteiro(f.quantidadeMin) <= quantidade)
    .filter((f) => (tipoEsperado ? f.descontoTipo === tipoEsperado : true))
    .sort((a, b) => inteiro(b.quantidadeMin) - inteiro(a.quantidadeMin));
  return candidatas[0] || null;
}

/**
 * O desconto de uma mecânica de VALOR sobre um conjunto de linhas, devolvido
 * por linha (mesma ordem de entrada).
 *
 * `percentual` incide sobre a linha; `valor_fixo` e `preco_fixo` são POR
 * UNIDADE — é a leitura herdada de `utils/preco.js`, onde `fixed` abate reais
 * do preço unitário, e trocá-la faria "R$ 5 de desconto" significar coisas
 * diferentes antes e depois desta onda.
 */
function descontoPorLinha(tipo, valor, linhas) {
  return linhas.map((linha) => {
    const atual = linha.valorCentavos;
    if (atual <= 0) return 0;
    const quantidade = Math.max(1, inteiro(linha.item.quantidade));

    if (tipo === "percentual") {
      return Math.min(atual, Math.round((atual * Number(valor)) / 100));
    }
    if (tipo === "valor_fixo") {
      return Math.min(atual, emCentavos(valor) * quantidade);
    }
    if (tipo === "preco_fixo") {
      // O item passa a custar `valor` reais A UNIDADE. Sobre a linha JÁ
      // reduzida por uma regra anterior, um preço fixo mais caro que o atual
      // não "sobe" o preço: desconto negativo não existe.
      return Math.max(0, atual - emCentavos(valor) * quantidade);
    }
    return 0;
  });
}

/**
 * `leve X pague Y`: as unidades grátis saem das MAIS BARATAS.
 *
 * A escolha é conservadora de propósito. Numa promoção que alcança dois
 * produtos de preços diferentes, dar as caras seria decidir, em silêncio, um
 * desconto maior do que o gestor leu na tela ("leve 3 pague 2" num carrinho
 * misto). O varejo faz assim, e o lado seguro do erro aqui é o da loja.
 */
function descontoLeveXPagueY(regra, linhas, quantidadeElegivel) {
  const faixa = faixaVigente(regra, quantidadeElegivel, "pague_y");
  if (!faixa) return linhas.map(() => 0);

  const leve = inteiro(faixa.quantidadeMin);
  const pague = inteiro(faixa.descontoValor);
  if (leve <= 0 || pague < 0 || pague >= leve) return linhas.map(() => 0);

  let gratis = Math.floor(quantidadeElegivel / leve) * (leve - pague);
  if (gratis <= 0) return linhas.map(() => 0);

  const porPreco = linhas
    .map((linha, indice) => ({
      indice,
      linha,
      quantidade: Math.max(1, inteiro(linha.item.quantidade)),
      unitario: Math.round(
        linha.valorCentavos / Math.max(1, inteiro(linha.item.quantidade)),
      ),
    }))
    .sort((a, b) => a.unitario - b.unitario || a.indice - b.indice);

  const descontos = linhas.map(() => 0);
  for (const alvo of porPreco) {
    if (gratis <= 0) break;
    const unidades = Math.min(gratis, alvo.quantidade);
    // Fração EXATA da linha, e não `unitario * unidades`: numa linha de 3 por
    // R$ 49,90 o unitário arredondado erraria um centavo, e esse centavo iria
    // para a diferença entre os ajustes e o valor cobrado.
    descontos[alvo.indice] = Math.min(
      alvo.linha.valorCentavos,
      Math.round((alvo.linha.valorCentavos * unidades) / alvo.quantidade),
    );
    gratis -= unidades;
  }
  return descontos;
}

/** O desconto de uma regra de classe `produto`, por linha. */
function descontosDaRegraDeProduto(regra, linhas, quantidadeElegivel) {
  switch (regra.mecanica) {
    case "percentual":
    case "valor_fixo":
    case "preco_fixo":
      return descontoPorLinha(regra.mecanica, regra.valor, linhas);
    case "leve_x_pague_y":
      return descontoLeveXPagueY(regra, linhas, quantidadeElegivel);
    case "progressivo": {
      const faixa = faixaVigente(regra, quantidadeElegivel);
      if (!faixa || faixa.descontoTipo === "pague_y") return linhas.map(() => 0);
      return descontoPorLinha(faixa.descontoTipo, faixa.descontoValor, linhas);
    }
    default:
      // `brinde` não é desconto em dinheiro (acrescenta item, e o motor não
      // mexe no carrinho) e `frete_gratis` é de outra classe. Os dois saem
      // daqui valendo zero em vez de valendo um palpite.
      return linhas.map(() => 0);
  }
}

/** O desconto de uma regra de classe `pedido` sobre uma base única. */
function descontoDeRegraDePedido(regra, baseCentavos, quantidadeElegivel) {
  const aplicar = (tipo, valor) => {
    if (tipo === "percentual") {
      return Math.round((baseCentavos * Number(valor)) / 100);
    }
    if (tipo === "valor_fixo") return emCentavos(valor);
    if (tipo === "preco_fixo") return Math.max(0, baseCentavos - emCentavos(valor));
    return 0;
  };

  if (regra.mecanica === "progressivo") {
    const faixa = faixaVigente(regra, quantidadeElegivel);
    if (!faixa || faixa.descontoTipo === "pague_y") return 0;
    return Math.min(baseCentavos, aplicar(faixa.descontoTipo, faixa.descontoValor));
  }
  return Math.min(baseCentavos, aplicar(regra.mecanica, regra.valor));
}

/* -------------------------------------------------------------------------- *
 * O motor
 * -------------------------------------------------------------------------- */

/** prioridade DESC, `criada_em` ASC, `id` ASC — desempate TOTAL. */
function ordenarRegras(regras) {
  return regras.slice().sort((a, b) => {
    const porPrioridade = inteiro(b.prioridade) - inteiro(a.prioridade);
    if (porPrioridade !== 0) return porPrioridade;
    const ta = new Date(a.criadaEm || 0).getTime() || 0;
    const tb = new Date(b.criadaEm || 0).getTime() || 0;
    if (ta !== tb) return ta - tb;
    return String(a.id).localeCompare(String(b.id));
  });
}

/**
 * `teto_desconto_centavos` cortando o desconto já calculado. O corte é
 * rateado, e não aplicado ao acaso numa das linhas: as linhas de
 * `pedido_ajustes_desconto` alimentam o rateio da NF-e por item, e um teto que
 * caísse todo numa linha faria a nota mentir sobre as outras.
 */
function aplicarTeto(regra, descontos) {
  const teto = regra.tetoDescontoCentavos;
  if (teto === null || teto === undefined) return descontos;
  const total = descontos.reduce((a, d) => a + d, 0);
  if (total <= inteiro(teto)) return descontos;
  return ratear(inteiro(teto), descontos);
}

/**
 * Calcula os descontos de um carrinho contra um conjunto de regras já
 * filtradas por vigência, limite e código (ver `motorRepository`).
 *
 * @param {object} carrinho
 *   `itens`: `[{ produtoId, sku, categoria, precoCentavos, quantidade }]` —
 *   `precoCentavos` é o preço UNITÁRIO de catálogo, inteiro.
 *   `meioPagamento`: o vocabulário FECHADO da loja (ver `meioDePagamentoDaLoja`).
 *   `assinante`: booleano.
 *   `frete`: `{ valorCentavos, metodo, ehMaisBarata, uf, cep }` ou null quando
 *   o frete ainda não foi cotado — nesse caso a classe `frete` não roda.
 * @param {Array<object>} regras Regras no formato de `carregarRegrasVigentes`.
 * @returns {{ajustes: Array<object>, totalCentavos: number}} `ajustes` já em
 *   ordem de aplicação, com `sequencia` começando em 1 — a mesma coluna de
 *   `pedido_ajustes_desconto`, que é onde eles vão parar.
 */
/**
 * A referência que vai para `pedido_ajustes_desconto.alvo_ref` — e por que ela
 * não pode ser um `String(...)` solto.
 *
 * `String(null)` é a string `"null"`, e o CHECK da coluna
 * (`pedido_ajustes_alvo_ref_coerente`, 0032) exige apenas
 * `alvo_ref IS NOT NULL AND btrim(alvo_ref) <> ''` — que `"null"` satisfaz. O
 * banco aceitaria, calado, a PALAVRA "null" na única tabela que existe para
 * responder "por que este pedido saiu por R$ 137,40?".
 *
 * O `sku` é a segunda referência legítima, não um remendo: é por ele que a
 * avaliação e o Bling falam do mesmo produto, e kit e variante nem sempre
 * carregam `produtoId`.
 *
 * Sem nenhum dos dois, o motor RECUSA. É defeito de quem montou o carrinho, e
 * a alternativa — seguir e gravar lixo — troca um erro visível por uma
 * auditoria corrompida em silêncio, descoberta meses depois por um contador.
 */
function referenciaDoItem(item) {
  const porId = textoNormalizado(item?.produtoId);
  if (porId !== "") return String(item.produtoId).trim();

  const porSku = textoNormalizado(item?.sku);
  if (porSku !== "") return String(item.sku).trim();

  throw new Error(
    "Item de carrinho sem identificador: todo item precisa de produtoId ou sku " +
      "para o desconto poder ser rateado por linha no pedido.",
  );
}

function calcularDescontos(carrinho, regras) {
  const linhas = (carrinho?.itens || []).map((item) => {
    // A recusa acontece AQUI, na entrada, antes de qualquer conta de dinheiro —
    // e não no `registrar`, lá embaixo. Falhar no meio do cálculo deixaria
    // ajustes já empilhados de regras anteriores, e quem tratasse a exceção
    // teria de saber descartá-los. Na fronteira, ou o carrinho inteiro é
    // calculável ou nada foi calculado.
    referenciaDoItem(item);
    return {
      item,
      valorCentavos:
        inteiro(item.precoCentavos) * Math.max(0, inteiro(item.quantidade)),
    };
  });

  const ajustes = [];
  const registrar = (regra, alvo, alvoRef, valorCentavos) => {
    if (valorCentavos <= 0) return;
    ajustes.push({
      sequencia: ajustes.length + 1,
      promocaoId: regra.id ?? null,
      codigo: regra.codigo?.codigo ?? null,
      codigoId: regra.codigo?.id ?? null,
      alvo,
      alvoRef,
      valorCentavos,
      rotulo: regra.nome || "Desconto",
    });
  };

  const ordenadas = ordenarRegras(
    (regras || []).filter((r) => ORDEM_DAS_CLASSES.includes(r.classe)),
  );

  // ATRAVESSA as classes, e é o único estado que atravessa: a etapa 3 precisa
  // saber quanto a etapa 2 já tirou, porque o mínimo do frete grátis é
  // conferido contra o subtotal FINAL.
  let descontoDePedido = 0;

  for (const classe of ORDEM_DAS_CLASSES) {
    const daClasse = ordenadas.filter((r) => r.classe === classe);
    if (daClasse.length === 0) continue;

    /**
     * A EXCLUSIVIDADE É POR CLASSE, e por isso estas duas variáveis nascem
     * dentro do laço: uma promoção exclusiva de produto não pode calar o frete
     * grátis, que é de outra natureza e outra etapa. É a leitura literal de
     * 0032 — "duas promoções de pagamento se excluem entre si e ainda assim
     * somam com uma de frete".
     */
    let classeBloqueada = false;
    const gruposUsados = new Set();

    // A base da etapa 2 é congelada ANTES da primeira regra de pedido rodar:
    // é isso que faz dois percentuais de pedido incidirem sobre o mesmo
    // número em vez de um sobre o resto do outro.
    const subtotalDaEtapa1 = linhas.reduce((a, l) => a + l.valorCentavos, 0);
    let freteRestante =
      classe === "frete" && carrinho?.frete
        ? inteiro(carrinho.frete.valorCentavos)
        : 0;

    if (classe === "frete" && freteRestante <= 0) continue;

    for (const regra of daClasse) {
      if (classeBloqueada) break;
      if (regra.grupoExclusividade && gruposUsados.has(regra.grupoExclusividade)) {
        continue;
      }
      if (!meioDePagamentoCasa(regra, carrinho)) continue;

      const alcancadas = linhasAlcancadas(regra, linhas, carrinho);
      if (alcancadas.length === 0) continue;

      const quantidadeElegivel = alcancadas.reduce(
        (a, l) => a + Math.max(0, inteiro(l.item.quantidade)),
        0,
      );

      let aplicou = false;

      if (classe === "produto") {
        const base = alcancadas.reduce((a, l) => a + l.valorCentavos, 0);
        if (base <= 0) continue;
        if (!atendeMinimo(regra, base, quantidadeElegivel)) continue;

        const brutos = descontosDaRegraDeProduto(regra, alcancadas, quantidadeElegivel);
        // O desconto NUNCA ultrapassa a linha: uma regra de R$ 20 sobre um café
        // de R$ 12 zera o café e para, em vez de virar crédito nos outros itens.
        const limitados = brutos.map((d, i) =>
          Math.max(0, Math.min(d, alcancadas[i].valorCentavos)),
        );
        const finais = aplicarTeto(regra, limitados);

        finais.forEach((desconto, i) => {
          if (desconto <= 0) return;
          alcancadas[i].valorCentavos -= desconto;
          registrar(regra, "item", referenciaDoItem(alcancadas[i].item), desconto);
          aplicou = true;
        });
      } else if (classe === "pedido") {
        // A base é o pedaço ELEGÍVEL do subtotal da etapa 1, não o subtotal
        // corrente: um cupom de 10% e um "clube 5%" descontam os dois sobre o
        // mesmo número, e a soma nunca passa dele (o teto logo abaixo).
        const base = alcancadas.reduce((a, l) => a + l.valorCentavos, 0);
        if (base <= 0) continue;
        if (!atendeMinimo(regra, base, quantidadeElegivel)) continue;

        const bruto = descontoDeRegraDePedido(regra, base, quantidadeElegivel);
        const comTeto = aplicarTeto(regra, [bruto])[0];
        const desconto = Math.max(
          0,
          Math.min(comTeto, subtotalDaEtapa1 - descontoDePedido),
        );
        if (desconto > 0) {
          descontoDePedido += desconto;
          registrar(regra, "pedido", null, desconto);
          aplicou = true;
        }
      } else {
        const baseDoMinimo = subtotalDaEtapa1 - descontoDePedido;
        if (!atendeMinimo(regra, baseDoMinimo, quantidadeElegivel)) continue;
        if (!condicoesDeFreteCasam(regra, carrinho.frete)) continue;

        const bruto =
          regra.mecanica === "frete_gratis"
            ? freteRestante
            : descontoDeRegraDePedido(regra, freteRestante, quantidadeElegivel);
        const comTeto = aplicarTeto(regra, [bruto])[0];
        const desconto = Math.max(0, Math.min(comTeto, freteRestante));
        if (desconto > 0) {
          freteRestante -= desconto;
          registrar(regra, "frete", null, desconto);
          aplicou = true;
        }
      }

      // A exclusividade só morde quando a regra APLICOU. Uma regra exclusiva
      // que não atingiu o mínimo é uma regra que não aconteceu, e calar as
      // outras por causa dela deixaria o carrinho sem desconto nenhum sem que
      // ninguém conseguisse explicar por quê.
      if (!aplicou) continue;
      if (regra.grupoExclusividade) gruposUsados.add(regra.grupoExclusividade);
      else if (regra.exclusiva) classeBloqueada = true;
    }
  }

  return {
    ajustes,
    totalCentavos: ajustes.reduce((a, x) => a + x.valorCentavos, 0),
  };
}

module.exports = {
  calcularDescontos,
  meioDePagamentoDaLoja,
  emCentavos,
  ORDEM_DAS_CLASSES,
};
