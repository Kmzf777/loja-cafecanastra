import type { Locale } from "../../../../lib/i18n/tipos";

/**
 * O texto da /clube — página de venda E wizard de assinatura — nos três idiomas.
 *
 * POR QUE AQUI E NÃO EM lib/i18n/dicionario.ts: aquele arquivo é o rótulo
 * REPETIDO da moldura (navegação, rodapé, vocabulário do catálogo). Isto aqui é
 * o conteúdo de uma página só, e é o mesmo lugar que /bio e /historia já usam
 * (`conteudo.ts` ao lado da página). O que este arquivo NÃO duplica são os
 * rótulos de moagem: "Grão"/"Moído" continuam vindo de `catalogo.moagem` do
 * dicionário, porque a PDP, a PLP e o wizard precisam falar a mesma palavra.
 *
 * A TRAVA É A MESMA DO DICIONÁRIO: `pt` é a fonte do tipo, `en` e `es` são
 * DECLARADOS como `TextosDoClube`, e chave faltando quebra o build. O teste ao
 * lado cobra o passo seguinte, que o tipo não cobra: que o valor não seja o
 * português copiado.
 *
 * AS INTERPOLAÇÕES SÃO FUNÇÕES, não pedaços de frase concatenados. "10% de
 * desconto" e "10% off" põem o número em posições diferentes da oração, e
 * partir a frase em `antes` + valor + `depois` obrigaria o inglês e o espanhol
 * a caber na sintaxe do português. A função devolve a frase inteira e cada
 * idioma monta a sua.
 *
 * IMPORT RELATIVO, não `@/`: o vitest.config.ts não resolve o alias, e este
 * módulo é importado pelo teste ao lado (mesma nota de lib/i18n/rotas.ts).
 */

/**
 * A ordem em que o FAQ aparece na tela.
 *
 * Existe separada do objeto de textos porque `Object.keys` de um objeto de
 * tradução é ordem de digitação — e uma tradução reordenada por descuido
 * mudaria a ordem das perguntas só num idioma. Aqui a ordem é uma afirmação, e
 * o teste ao lado cobra que os três idiomas tenham exatamente estas chaves.
 */
export const ORDEM_DO_FAQ = ["cobranca", "viagem", "fidelidade", "moido"] as const;

const pt = {
  meta: {
    titulo: "Clube da Canastra — Assinatura",
    descricao:
      "Café novo em casa a cada 15, 30 ou 45 dias, moído do jeito que você prepara. Cancele quando quiser, sem multa.",
  },

  /** A sobrancelha acima do H1. O H1 é nome próprio e não passa por aqui. */
  etiqueta: "Assinatura",

  /** O desconto chega como inteiro já arredondado (10, não 0.1). */
  chamada: (desconto: number) =>
    `Café novo em casa a cada 15, 30 ou 45 dias, moído do jeito que você prepara. ${desconto}% de desconto em todo envio, com a entrega incluída. Cancele quando quiser, sem multa.`,

  /**
   * O AVISO DA FRONTEIRA, e ele só é DESENHADO fora do português — mesma regra
   * do aviso de compra da moldura (app/moldura-da-loja.tsx), que também mantém
   * a versão `pt` sem renderizá-la.
   *
   * Ele existe porque o Clube não é "checkout em português": é um fluxo
   * estruturalmente brasileiro. O frete é Melhor Envio (só Brasil), a cobrança
   * recorrente é um preapproval do Mercado Pago Brasil em reais, o endereço é
   * CEP+UF e a nota fiscal de cada remessa exige CPF. Dizer isso ANTES do
   * primeiro passo é o que impede o visitante de fora de preencher três telas
   * para bater numa parede — e é o mesmo tipo de honestidade que o spec §1
   * exigiu do checkout.
   */
  aviso: {
    titulo: "A assinatura é para endereços no Brasil.",
    texto:
      "A cobrança recorrente é autorizada no Mercado Pago Brasil, em reais; a entrega é para um endereço brasileiro e a nota fiscal de cada remessa exige CPF. As telas do Mercado Pago e da sua conta seguem em português.",
  },

  faq: {
    titulo: "Perguntas diretas",
    cobranca: {
      pergunta: "Como funciona a cobrança?",
      resposta:
        "Você autoriza uma vez, no Mercado Pago, e o valor do envio é cobrado automaticamente na frequência escolhida. O preço fica travado no valor da adesão.",
    },
    viagem: {
      pergunta: "E se eu viajar?",
      resposta:
        "Dá para pausar a assinatura no Mercado Pago sem cancelar — e reativar quando voltar.",
    },
    fidelidade: {
      pergunta: "Tem fidelidade?",
      resposta:
        "Não. Cancele quando quiser, pela sua conta, sem multa e sem precisar ligar.",
    },
    moido: {
      pergunta: "O café vem moído?",
      resposta:
        "Do jeito que você escolher: em grãos ou moído. Moemos na hora do envio, não antes.",
    },
  },

  wizard: {
    /** Região viva da barra de progresso — §7.4, em Martian Mono. */
    passoDeTres: (passo: number) => `Passo ${passo} de 3`,

    passo1: {
      titulo: "Qual café, e como?",
      cafe: "Café",
      moagem: "Moagem",
      peso: "Peso do pacote",
      quantidade: "Pacotes por envio",
      semEsteCafe: "Não disponível para este café",
      diminuir: "Diminuir quantidade",
      aumentar: "Aumentar quantidade",
      esgotado: "Esta combinação está esgotada. Tente outro peso ou outra moagem.",
      porEnvio: (valor: string) => `${valor} por envio`,
      economia: (valor: string) => `(economia de ${valor})`,
    },

    passo2: {
      titulo: "De quanto em quanto tempo?",
      /**
       * A frase é a MESMA da resposta "E se eu viajar?" desta página, e por
       * obrigação: quem pausa é o Mercado Pago, e a versão anterior prometia
       * "adiar um envio" numa loja sem porta para adiar.
       */
      pausa:
        "Dá para pausar a assinatura no Mercado Pago sem cancelar — e cancelar quando quiser, pela sua conta, sem multa.",
      aCada: (dias: number) => `A cada ${dias} dias`,
    },

    passo3: {
      titulo: "Onde o café chega?",
      explicacao:
        "A entrega recorrente usa ESTE endereço, guardado na assinatura — mudar o endereço da conta depois não muda os envios do Clube.",
      /**
       * CEP, UF e CPF SÃO NOMES DE DOCUMENTO BRASILEIRO e ficam visíveis nos
       * três idiomas: é a sigla que está impressa na conta de luz e no cartão
       * que a pessoa vai consultar. O que se traduz é a explicação ao lado, não
       * a sigla — "Postal code" sozinho faria alguém de fora procurar um ZIP de
       * cinco dígitos.
       */
      cep: "CEP",
      numero: "Número",
      rua: "Rua",
      complemento: "Complemento (opcional)",
      bairro: "Bairro",
      cidade: "Cidade",
      uf: "UF",
      cpf: "CPF",
      cpfAjuda: "Usamos o CPF para emitir a nota fiscal de cada envio.",
      cpfInvalido: "Este CPF não confere. Confira os dígitos.",
    },

    resumo: {
      cafe: "Café",
      moagem: "Moagem",
      peso: "Peso",
      frequencia: "Frequência",
      aCada: (dias: number) => `a cada ${dias} dias`,
      porEnvio: "Por envio",
      /** Só para leitor de tela: "R$" lido em voz alta não vira dinheiro. */
      porEnvioLeitor: (valor: string) => `Por envio: ${valor}`,
      economiaEEntrega: (valor: string) => `economia de ${valor} · entrega incluída`,
      autorizacao:
        "Você autoriza a cobrança no Mercado Pago e cancela quando quiser, sem multa, pela sua conta.",
      precisaDeConta:
        "Assinar pede uma conta — você entra na próxima tela e volta para cá com tudo isto preenchido.",
    },

    botoes: {
      continuar: "Continuar",
      voltar: "Voltar",
      assinar: "Assinar",
      assinando: "Criando sua assinatura…",
    },

    erros: {
      semLoja: "Não conseguimos falar com a loja agora. Tente de novo em instantes.",
      endereco: "Preencha o endereço de entrega: CEP, rua, número, cidade e UF.",
      cpf: "Informe um CPF válido: ele é o dado da nota fiscal de cada envio.",
      falha: "Não foi possível criar a assinatura.",
      semInitPoint:
        "A assinatura foi criada mas não recebemos a página de autorização. Confira em Minha conta antes de tentar de novo.",
      /**
       * A ETIQUETA DA RECUSA QUE VEIO DO SERVIDOR. O backend é pt-BR por decisão
       * (spec §1) e as frases dele são específicas — "estoque insuficiente",
       * "CPF obrigatório". Traduzir seria inventar; engolir seria trocar um
       * motivo real por um "não deu" genérico. Então em `en` e `es` a tela diz a
       * frase genérica traduzida e mostra a do servidor abaixo, marcada como
       * português (`lang="pt-BR"`, para o leitor de tela trocar de voz).
       * Em português esta linha nunca aparece — a frase do servidor é a resposta.
       */
      respostaDaLoja: "A loja respondeu:",
    },
  },
};

/**
 * SEM `as const` acima, pelo mesmo motivo do dicionário: o que se quer travar é
 * o conjunto de CHAVES, não o texto — com literais, `en` só compilaria
 * repetindo o português para sempre.
 */
export type TextosDoClube = typeof pt;

/**
 * O QUE NÃO SE TRADUZ AQUI: `Clube da Canastra` e `Mercado Pago` (nomes
 * próprios), e `CEP`, `UF`, `CPF` (siglas de documento brasileiro — ver a nota
 * em `passo3`). O vocabulário de café é o da indústria: em grãos = whole bean /
 * en grano, moído = ground / molido.
 *
 * O CUIDADO EXTRA DESTA TELA É QUE ELA AUTORIZA COBRANÇA RECORRENTE. Cada frase
 * sobre dinheiro diz o mesmo fato nas três línguas: a autorização é uma só, o
 * preço trava na adesão, o cancelamento é pela conta e não tem multa. Uma
 * tradução "mais leve" aqui não é estilo — é outra promessa.
 */
const en: TextosDoClube = {
  meta: {
    titulo: "Clube da Canastra — Coffee subscription",
    descricao:
      "Fresh coffee at your door every 15, 30 or 45 days, whole bean or ground the way you brew it. Cancel whenever you want, no penalty. Ships within Brazil.",
  },

  etiqueta: "Subscription",

  chamada: (desconto: number) =>
    `Fresh coffee at your door every 15, 30 or 45 days, whole bean or ground the way you brew it. ${desconto}% off every shipment, delivery included. Cancel whenever you want, no penalty.`,

  aviso: {
    titulo: "Subscriptions ship inside Brazil only.",
    texto:
      "The recurring charge is authorised at Mercado Pago Brazil, in Brazilian reais; delivery goes to a Brazilian address, and the invoice for each shipment requires a CPF, the Brazilian taxpayer number. The Mercado Pago screens and your account are in Portuguese.",
  },

  faq: {
    titulo: "Straight answers",
    cobranca: {
      pergunta: "How does billing work?",
      resposta:
        "You authorise it once, at Mercado Pago, and each shipment is charged automatically at the frequency you chose. The price stays locked at what it was when you signed up.",
    },
    viagem: {
      pergunta: "What if I travel?",
      resposta:
        "You can pause the subscription at Mercado Pago without cancelling it — and start it again when you are back.",
    },
    fidelidade: {
      pergunta: "Is there a minimum term?",
      resposta:
        "No. Cancel whenever you want, from your account, with no penalty and without phoning anyone.",
    },
    moido: {
      pergunta: "Does the coffee come ground?",
      resposta:
        "Whichever way you choose: whole bean or ground. We grind it as we ship, not before.",
    },
  },

  wizard: {
    passoDeTres: (passo: number) => `Step ${passo} of 3`,

    passo1: {
      titulo: "Which coffee, and how?",
      cafe: "Coffee",
      moagem: "Grind",
      peso: "Bag size",
      quantidade: "Bags per shipment",
      semEsteCafe: "Not available for this coffee",
      diminuir: "Decrease quantity",
      aumentar: "Increase quantity",
      esgotado: "This combination is sold out. Try another size or another grind.",
      porEnvio: (valor: string) => `${valor} per shipment`,
      economia: (valor: string) => `(you save ${valor})`,
    },

    passo2: {
      titulo: "How often?",
      pausa:
        "You can pause the subscription at Mercado Pago without cancelling — and cancel whenever you want, from your account, with no penalty.",
      aCada: (dias: number) => `Every ${dias} days`,
    },

    passo3: {
      titulo: "Where does the coffee go?",
      explicacao:
        "Recurring delivery uses THIS address, stored with the subscription — changing your account address later does not change Club shipments.",
      cep: "CEP (Brazilian postcode)",
      numero: "Number",
      rua: "Street",
      complemento: "Unit / extra (optional)",
      bairro: "Neighbourhood",
      uf: "State (UF)",
      cidade: "City",
      cpf: "CPF",
      cpfAjuda:
        "We use your CPF — the Brazilian taxpayer number — to issue the invoice for each shipment.",
      cpfInvalido: "This CPF does not check out. Check the digits.",
    },

    resumo: {
      cafe: "Coffee",
      moagem: "Grind",
      peso: "Size",
      frequencia: "Frequency",
      aCada: (dias: number) => `every ${dias} days`,
      porEnvio: "Per shipment",
      porEnvioLeitor: (valor: string) => `Per shipment: ${valor}`,
      economiaEEntrega: (valor: string) => `you save ${valor} · delivery included`,
      autorizacao:
        "You authorise the charge at Mercado Pago and cancel whenever you want, with no penalty, from your account.",
      precisaDeConta:
        "Subscribing needs an account — you sign in on the next screen and come back here with all of this still filled in.",
    },

    botoes: {
      continuar: "Continue",
      voltar: "Back",
      assinar: "Subscribe",
      assinando: "Creating your subscription…",
    },

    erros: {
      semLoja: "We could not reach the store right now. Try again in a moment.",
      endereco:
        "Fill in the delivery address: CEP, street, number, city and state.",
      cpf: "Enter a valid CPF: it is what each shipment's invoice is issued against.",
      falha: "We could not create the subscription.",
      semInitPoint:
        "The subscription was created but we did not get the authorisation page. Check My account before trying again.",
      respostaDaLoja: "The store replied, in Portuguese:",
    },
  },
};

const es: TextosDoClube = {
  meta: {
    titulo: "Clube da Canastra — Suscripción de café",
    descricao:
      "Café nuevo en casa cada 15, 30 o 45 días, en grano o molido como usted prepara. Cancele cuando quiera, sin penalización. Envíos dentro de Brasil.",
  },

  etiqueta: "Suscripción",

  chamada: (desconto: number) =>
    `Café nuevo en casa cada 15, 30 o 45 días, en grano o molido como usted prepara. ${desconto}% de descuento en cada envío, con la entrega incluida. Cancele cuando quiera, sin penalización.`,

  aviso: {
    titulo: "La suscripción solo llega a direcciones en Brasil.",
    texto:
      "El cobro recurrente se autoriza en Mercado Pago Brasil, en reales brasileños; la entrega es a una dirección brasileña y la factura de cada remesa exige CPF, el documento fiscal brasileño. Las pantallas de Mercado Pago y de su cuenta siguen en portugués.",
  },

  faq: {
    titulo: "Respuestas directas",
    cobranca: {
      pergunta: "¿Cómo funciona el cobro?",
      resposta:
        "Usted autoriza una sola vez, en Mercado Pago, y el valor de cada envío se cobra automáticamente con la frecuencia elegida. El precio queda fijado en el valor de la adhesión.",
    },
    viagem: {
      pergunta: "¿Y si viajo?",
      resposta:
        "Puede pausar la suscripción en Mercado Pago sin cancelarla — y reactivarla cuando vuelva.",
    },
    fidelidade: {
      pergunta: "¿Hay permanencia mínima?",
      resposta:
        "No. Cancele cuando quiera, desde su cuenta, sin penalización y sin tener que llamar a nadie.",
    },
    moido: {
      pergunta: "¿El café viene molido?",
      resposta:
        "Como usted elija: en grano o molido. Lo molemos al despachar, no antes.",
    },
  },

  wizard: {
    passoDeTres: (passo: number) => `Paso ${passo} de 3`,

    passo1: {
      titulo: "¿Qué café, y cómo?",
      cafe: "Café",
      moagem: "Molienda",
      peso: "Peso del paquete",
      quantidade: "Paquetes por envío",
      semEsteCafe: "No disponible para este café",
      diminuir: "Disminuir cantidad",
      aumentar: "Aumentar cantidad",
      esgotado: "Esta combinación está agotada. Pruebe otro peso u otra molienda.",
      porEnvio: (valor: string) => `${valor} por envío`,
      economia: (valor: string) => `(ahorro de ${valor})`,
    },

    passo2: {
      titulo: "¿Cada cuánto tiempo?",
      pausa:
        "Puede pausar la suscripción en Mercado Pago sin cancelarla — y cancelar cuando quiera, desde su cuenta, sin penalización.",
      aCada: (dias: number) => `Cada ${dias} días`,
    },

    passo3: {
      titulo: "¿Adónde llega el café?",
      explicacao:
        "La entrega recurrente usa ESTA dirección, guardada en la suscripción — cambiar después la dirección de la cuenta no cambia los envíos del Club.",
      cep: "CEP (código postal brasileño)",
      numero: "Número",
      rua: "Calle",
      complemento: "Complemento (opcional)",
      bairro: "Barrio",
      cidade: "Ciudad",
      uf: "Estado (UF)",
      cpf: "CPF",
      cpfAjuda:
        "Usamos el CPF — el documento fiscal brasileño — para emitir la factura de cada envío.",
      cpfInvalido: "Este CPF no cuadra. Revise los dígitos.",
    },

    resumo: {
      cafe: "Café",
      moagem: "Molienda",
      peso: "Peso",
      frequencia: "Frecuencia",
      aCada: (dias: number) => `cada ${dias} días`,
      porEnvio: "Por envío",
      porEnvioLeitor: (valor: string) => `Por envío: ${valor}`,
      economiaEEntrega: (valor: string) => `ahorro de ${valor} · entrega incluida`,
      autorizacao:
        "Usted autoriza el cobro en Mercado Pago y cancela cuando quiera, sin penalización, desde su cuenta.",
      precisaDeConta:
        "Suscribirse requiere una cuenta — usted entra en la próxima pantalla y vuelve aquí con todo esto ya completado.",
    },

    botoes: {
      continuar: "Continuar",
      voltar: "Volver",
      assinar: "Suscribirse",
      assinando: "Creando su suscripción…",
    },

    erros: {
      semLoja: "No pudimos hablar con la tienda ahora. Inténtelo de nuevo en unos instantes.",
      endereco:
        "Complete la dirección de entrega: CEP, calle, número, ciudad y estado.",
      cpf: "Informe un CPF válido: es el dato de la factura de cada envío.",
      falha: "No fue posible crear la suscripción.",
      semInitPoint:
        "La suscripción se creó pero no recibimos la página de autorización. Revise Mi cuenta antes de intentarlo de nuevo.",
      respostaDaLoja: "La tienda respondió, en portugués:",
    },
  },
};

const POR_IDIOMA: Record<Locale, TextosDoClube> = { pt, en, es };

export function textosDoClube(locale: Locale): TextosDoClube {
  return POR_IDIOMA[locale];
}
