"use strict";

/**
 * O FRETE ENQUANTO A COTAÇÃO REAL NÃO VOLTA — e o nome do arquivo é a ressalva.
 *
 * O QUE ESTE MÓDULO **NÃO** MUDA: a integração com o Melhor Envio é, e sempre
 * foi, **só cotação**. `shipment/calculate` é o único endpoint dela no código
 * inteiro — a loja nunca comprou etiqueta, nunca chamou `cart`, `checkout` nem
 * `generate`. Quem compra a etiqueta é a operação, à mão, no painel do Melhor
 * Envio, depois que o pedido entra. Escolher uma opção no checkout grava nome e
 * preço no pedido, e nada mais. Isso continua exatamente igual aqui.
 *
 * O QUE ELE SUBSTITUI é a cotação, enquanto ela está inalcançável: o firewall
 * do Melhor Envio bloqueia o IP desta VPS no sandbox (`E-WAF-0003`, medido em
 * 17/09/2026 — a home responde 403 sem token nenhum, e produção responde 200 do
 * mesmo servidor).
 *
 * POR QUE DUAS OPÇÕES, E NÃO UMA FIXA. Uma opção só destrava a venda mas não
 * exercita a ESCOLHA — e escolha de frete é metade do checkout: o preço muda, o
 * total muda, o CardForm do Mercado Pago **remonta** com o novo valor (ele fixa
 * `amount` na montagem), e o `conferirFrete` casa nome **e** preço contra a
 * recotação do servidor. Com uma opção só, nada disso chega a ser testado — e
 * era justamente testar pagamento que se queria.
 *
 * OS NÚMEROS SÃO PLACEHOLDER. Não são tabela de transportadora, não foram
 * negociados com ninguém, e não devem sobreviver ao dia em que a cotação real
 * voltar — `melhorEnvioAtiva()` desliga este caminho inteiro. Todos saem de
 * variável de ambiente para poderem ser ajustados sem deploy.
 *
 * A forma do retorno é a MESMA da cotação real (`id`, `name`, `price`, `days`,
 * `company_picture`), de propósito: o navegador, o `conferirFrete` e o piso do
 * frete grátis não sabem — nem precisam saber — de onde o número veio. O campo
 * extra `simulado: true` existe para a vitrine poder ser honesta na tela, se
 * um dia quiser.
 */

/** R$ 25,00 e 7 dias: o padrão combinado, na zona da própria origem. */
const BASE_PADRAO_CENTAVOS = 2500;
const PRAZO_PADRAO_DIAS = 7;

/** Quanto cada quilo acrescenta. Café é leve; o peso raramente domina. */
const POR_QUILO_CENTAVOS = 600;

/** A expressa: mais cara, mais rápida. */
const FATOR_EXPRESSO = 1.8;
const PRAZO_EXPRESSO_DIAS = 3;

/** Peso de um item quando ele vem sem peso (o default da coluna no banco). */
const PESO_PADRAO_KG = 0.3;

/**
 * As zonas, pelo PRIMEIRO dígito do CEP, a partir da origem em Uberlândia/MG
 * (`ZIPCODE_ORIGIN=38402330`, zona 3).
 *
 * É uma aproximação grosseira de distância, e é para ser: o objetivo é o
 * checkout mostrar números diferentes para destinos diferentes, não acertar
 * uma tabela de transportadora que este módulo não tem.
 *
 *   0,1 SP · 2 RJ/ES · 3 MG   -> Sudeste, a zona da origem
 *   7 Centro-Oeste · 8 PR/SC · 9 RS -> Sul e Centro-Oeste
 *   4,5,6 Nordeste e Norte    -> o resto
 */
const ZONAS = [
  { digitos: "0123", nome: "Sudeste", fator: 1.0, diasExtras: 0 },
  { digitos: "789", nome: "Sul/Centro-Oeste", fator: 1.3, diasExtras: 2 },
  { digitos: "456", nome: "Nordeste/Norte", fator: 1.7, diasExtras: 5 },
];

/** A mais cara, usada quando o CEP não é reconhecível. */
const ZONA_MAIS_CARA = ZONAS[ZONAS.length - 1];

/**
 * CEP irreconhecível cai na zona MAIS CARA, e a escolha é deliberada: errar
 * para o lado caro faz a loja cobrar a mais de um CEP estranho; errar para o
 * barato faz a loja BANCAR um frete que não previu, em toda venda daquele CEP.
 * O primeiro erro o cliente reclama e alguém conserta; o segundo é silencioso.
 */
function zonaDoCep(cep) {
  const digitos = String(cep || "").replace(/\D/g, "");
  if (digitos.length < 8) return ZONA_MAIS_CARA;
  return ZONAS.find((z) => z.digitos.includes(digitos[0])) || ZONA_MAIS_CARA;
}

/** Peso total do carrinho, em quilos. Item sem peso vale o default do banco. */
function pesoTotalKg(itens) {
  return (itens || []).reduce((total, item) => {
    const peso = Number(item?.weight);
    const quantidade = Number(item?.quantity) || 1;
    return total + (Number.isFinite(peso) && peso > 0 ? peso : PESO_PADRAO_KG) * quantidade;
  }, 0);
}

/** Lê um inteiro do ambiente, caindo no padrão quando o valor não presta. */
function inteiroDoAmbiente(nome, padrao) {
  const valor = Number(process.env[nome]);
  return Number.isInteger(valor) && valor >= 0 ? valor : padrao;
}

/**
 * As opções simuladas para um CEP e um carrinho.
 *
 * `price` sai em REAIS com duas casas, como a cotação real devolve — a conta
 * inteira acontece em centavos inteiros e a divisão é a última operação, para
 * não existir a dízima que faria `conferirFrete` recusar por um centavo.
 */
function cotarFreteSimulado({ cep, itens }) {
  const zona = zonaDoCep(cep);
  const peso = pesoTotalKg(itens);

  const base = inteiroDoAmbiente("FRETE_FIXO_CENTAVOS", BASE_PADRAO_CENTAVOS);
  const porQuilo = inteiroDoAmbiente("FRETE_POR_QUILO_CENTAVOS", POR_QUILO_CENTAVOS);
  const prazoBase = inteiroDoAmbiente("FRETE_FIXO_PRAZO_DIAS", PRAZO_PADRAO_DIAS) || PRAZO_PADRAO_DIAS;

  const padraoCentavos = Math.round((base + porQuilo * peso) * zona.fator);
  const expressoCentavos = Math.round(padraoCentavos * FATOR_EXPRESSO);

  return [
    {
      id: "simulado-padrao",
      name: "Entrega padrão",
      price: padraoCentavos / 100,
      days: prazoBase + zona.diasExtras,
      company_picture: null,
      simulado: true,
    },
    {
      id: "simulado-expresso",
      name: "Entrega expressa",
      price: expressoCentavos / 100,
      days: PRAZO_EXPRESSO_DIAS + zona.diasExtras,
      company_picture: null,
      simulado: true,
    },
  ];
}

module.exports = { cotarFreteSimulado, zonaDoCep, pesoTotalKg };
