import { type Locale } from "../../../../lib/i18n/tipos";

/**
 * O texto dos Termos de uso nos três idiomas.
 *
 * DE ONDE VEIO, E O QUE FOI RECUSADO. A base é a página `app/termos-uso` do
 * site institucional (github.com/Kmzf777/cafecanastrablog), que descrevia um
 * "site informativo" com blog e newsletter e não sabia nada de pedido, frete ou
 * assinatura. O que descrevia aquele site saiu; o que descreve ESTA loja — os
 * meios de pagamento, o Melhor Envio, o Clube — ficou, e é a parte que já era
 * da loja.
 *
 * O QUE NÃO PASSOU: o dia da semana da torra. "Torramos na terça, enviamos na
 * quarta" atravessa a loja como microcopy (estetica.md §11, a barra de aviso
 * inicial do `seed.js`, o selo do PainelCompra), mas não existe no repositório
 * uma fonte que diga que esse é o calendário de operação — e um Termos de uso
 * transforma tom de voz em obrigação contratual, em três idiomas de uma vez.
 * A cláusula ficou com o que a loja pratica e sustenta: torra sob demanda, sem
 * data. Ver a nota longa na seção "Torra e envio" de `pt`.
 *
 * DUAS FONTES FORAM DESCARTADAS INTEIRAS, e vale registrar por quê. O arquivo
 * `politica.md` que veio junto do material de referência **não é do Café
 * Canastra**: é o contrato de licenciamento do "SISTEMA ZPRO", da BIANCA SANT
 * ANA PEREIRA & CIA LTDA, com CNPJ próprio, requisito de 16 GB de VPS e foro em
 * Alfenas. E `app/politica-privacidade-app` do institucional é esse mesmo
 * contrato com "ZPRO" trocado por "Café Canastra" no editor de texto — fala de
 * revenda white-label, tenants e API do WhatsApp. Nada disso descreve uma loja
 * de café, e importar qualquer linha de lá teria posto o CNPJ de outra empresa
 * nos termos desta.
 *
 * É TAMBÉM O MOTIVO DE O `<AvisoJuridico>` FICAR: um material de referência em
 * que dois dos três documentos são o contrato de outra empresa não é um texto
 * que passou por advogado. Ver a nota na página.
 *
 * IMPORT RELATIVO, não `@/`: o vitest.config.ts não resolve o alias, e este
 * módulo tem teste ao lado (mesma nota de lib/i18n/rotas.ts).
 */

/**
 * Um pedaço de frase. Existe para que a tradução continue sendo edição de
 * TEXTO mesmo onde a frase carrega ênfase, link ou condicional — a alternativa
 * seria escrever a prosa em JSX e triplicá-la, e aí traduzir viraria mexer em
 * marcação.
 */
export type Trecho =
  | string
  /** Ênfase de consumo: o que a lei manda destacar (a cobrança recorrente). */
  | { forte: string }
  /** Caminho interno (`/…`), `mailto:` ou `tel:`. O locale é aplicado na tela. */
  | { texto: string; href: string }
  /**
   * A CLÁUSULA QUE MUDA COM O BUILD. `sim` quando a loja tem chave do Mercado
   * Pago, `nao` quando não tem — ver pagamento.ts, que lê a MESMA função do
   * checkout. Fica como dado, e não resolvida no texto, porque é preciso que
   * uma tradução não consiga achatá-la numa promessa fixa de cartão.
   */
  | { conforme: "cartao"; sim: string; nao: string };

/** Frase simples, ou frase montada por pedaços quando precisa de ênfase/link. */
export type Paragrafo = string | Trecho[];

/**
 * UMA SEÇÃO É UMA SEQUÊNCIA, e não um punhado de campos.
 *
 * Texto jurídico intercala: um parágrafo apresenta a lista, a lista enumera,
 * outro parágrafo fecha. Campos separados (`paragrafos` + `itens`) obrigariam a
 * página a adivinhar a ordem, e a adivinhação erraria na primeira seção que
 * fechasse depois da lista. Aqui a ordem escrita é a ordem exibida.
 */
export type Bloco = { paragrafo: Paragrafo } | { lista: Paragrafo[] };

export type Secao = {
  /** Âncora e `id` do `<h2>`. Igual nos três idiomas — ver o teste. */
  ancora: string;
  titulo: string;
  blocos: Bloco[];
};

export type ConteudoLegal = {
  meta: { titulo: string; descricao: string };
  /** O `<h1>` da página. */
  titulo: string;
  /** "agosto de 2026" — sai depois de "Atualizado em". */
  atualizacao: string;
  secoes: Secao[];
};

/**
 * A ordem canônica das seções, fora do conteúdo traduzido porque é estrutura.
 * `/en/termos-de-uso#trocas-e-devolucoes` tem de cair na mesma cláusula que o
 * português — um link compartilhado não pode quebrar na troca de idioma.
 */
export const SECOES_DOS_TERMOS = [
  "quem-somos",
  "aceite",
  "o-que-o-site-faz",
  "sua-conta",
  "pedidos-e-pagamento",
  "torra-e-envio",
  "trocas-e-devolucoes",
  "clube",
  "uso-do-site",
  "avaliacoes",
  "propriedade-intelectual",
  "links-externos",
  "disponibilidade",
  "lei-e-foro",
  "contato",
] as const;

const EMAIL = "comercial@cafecanastra.com";

const pt: ConteudoLegal = {
  meta: {
    titulo: "Termos de uso — Café Canastra",
    descricao:
      "Quem vende, como se paga, quando sai da torrefação e como se desiste da compra. As condições da loja do Café Canastra.",
  },
  titulo: "Termos de uso",
  atualizacao: "agosto de 2026",
  secoes: [
    {
      ancora: "quem-somos",
      titulo: "Quem somos",
      blocos: [
        {
          paragrafo:
            "A loja do Café Canastra é operada pela Boaventura Cafés Especiais Ltda, em Uberlândia, Minas Gerais. É com ela que você contrata ao comprar aqui.",
        },
        {
          // A frase que a home dizia — "quarenta anos na mesma serra" — é falsa,
          // e o spec §3 a derruba: são quarenta anos de café e dezoito de
          // Canastra. Os termos não podem repetir o erro que a home corrige.
          paragrafo:
            "O café vem da família Boaventura, que planta desde 1985 — primeiro em Patrocínio, no Cerrado Mineiro — e produz na Serra da Canastra desde 2008.",
        },
        {
          paragrafo: [
            "Endereço: Rua Nivaldo Guerreiro Nunes, 701, Distrito Industrial, Uberlândia, Minas Gerais. Contato: ",
            { texto: EMAIL, href: `mailto:${EMAIL}` },
            " ou (34) 3226-2600.",
          ],
        },
      ],
    },
    {
      ancora: "aceite",
      titulo: "Aceitar estes termos",
      blocos: [
        {
          paragrafo:
            "Navegar, criar conta, comprar ou assinar aqui significa aceitar estes termos. Se você não concorda com algum ponto, não use a loja.",
        },
        {
          paragrafo:
            "Podemos mudar este texto. Vale a versão publicada, e a data no topo diz quando ela mudou.",
        },
        {
          paragrafo:
            "Mudança não alcança pedido já confirmado nem assinatura já ativa: o que valeu na sua compra foi o texto do dia dela.",
        },
      ],
    },
    {
      ancora: "o-que-o-site-faz",
      titulo: "O que este site faz",
      blocos: [
        {
          paragrafo:
            "Aqui você conhece os cafés, compra, acompanha o pedido pela sua conta e pode assinar o Clube da Canastra.",
        },
        {
          paragrafo:
            "Enviamos para endereços no Brasil. Sacola, checkout e conta existem só em português, inclusive nas versões em inglês e espanhol do site.",
        },
        {
          paragrafo:
            "As páginas sobre a serra, a história e as linhas são informativas: elas contam de onde vem o café, não substituem o que está escrito no rótulo do pacote.",
        },
      ],
    },
    {
      ancora: "sua-conta",
      titulo: "Sua conta",
      blocos: [
        {
          paragrafo:
            "A conta é pessoal. Pedido feito com o seu login é tratado como seu, então cuide da senha.",
        },
        {
          paragrafo:
            "Nome, CPF e endereço precisam estar corretos: eles vão para a nota fiscal e para a etiqueta de entrega. Endereço errado atrasa ou perde a encomenda.",
        },
        {
          paragrafo: [
            "Você encerra a conta quando quiser, sozinho, em Minha conta. É definitivo — a ",
            { texto: "Política de privacidade", href: "/politica-de-privacidade" },
            " explica o que some e o que fica.",
          ],
        },
        {
          paragrafo:
            "Podemos suspender ou encerrar conta usada para fraude ou para o que a seção Uso do site proíbe.",
        },
      ],
    },
    {
      ancora: "pedidos-e-pagamento",
      titulo: "Pedidos e pagamento",
      blocos: [
        {
          paragrafo: [
            "O pedido só é confirmado depois que o pagamento é aprovado. Trabalhamos com ",
            { conforme: "cartao", sim: "Pix e cartão de crédito", nao: "Pix" },
            ", pelo Mercado Pago.",
          ],
        },
        {
          paragrafo:
            "O número do cartão não passa pelos nossos servidores: os campos são do próprio Mercado Pago, e o que chega até nós é um código de uso único.",
        },
        { paragrafo: "Preço pode mudar sem aviso — nunca depois de um pedido confirmado." },
        {
          paragrafo:
            "Se um preço ou um estoque estiver errado por falha nossa, avisamos você e cancelamos o pedido. O que já tiver sido pago volta integral.",
        },
      ],
    },
    {
      ancora: "torra-e-envio",
      titulo: "Torra e envio",
      blocos: [
        /**
         * SEM DIA DA SEMANA AQUI, E ISSO É DECISÃO. "Torramos na terça,
         * enviamos na quarta" é microcopy de vitrine — está no estetica.md
         * §11 como exemplo de tom, e é o valor INICIAL da barra de aviso que
         * o `seed.js` grava numa coluna que o painel edita a qualquer hora.
         * Nenhuma dessas três coisas é um calendário de operação conferido, e
         * num Termos de uso um dia da semana deixa de ser tom de voz e vira
         * OBRIGAÇÃO: um pedido postado na quinta passa a ser descumprimento
         * de cláusula. O que fica é o que a loja de fato pratica e consegue
         * sustentar — torra sob demanda —, sem número que ninguém apurou.
         */
        {
          paragrafo:
            "Torramos sob demanda, em lotes pequenos: o pedido é postado depois de o lote dele ficar pronto, e não sai de estoque torrado parado. Por isso o prazo até a postagem acompanha a torra.",
        },
        {
          paragrafo:
            "O frete é calculado pelo Melhor Envio, com as transportadoras que atendem o seu CEP. O prazo mostrado no checkout começa a contar do envio, não do pedido.",
        },
        { paragrafo: "Enviamos só para endereços no Brasil." },
      ],
    },
    {
      ancora: "trocas-e-devolucoes",
      titulo: "Trocas e devoluções",
      blocos: [
        {
          lista: [
            "Você pode desistir da compra em até 7 dias corridos após o recebimento, conforme o Código de Defesa do Consumidor.",
            "Pacotes abertos não são aceitos em devolução por arrependimento, por se tratar de alimento.",
            "Se o produto chegar avariado ou diferente do pedido, trocamos sem custo — basta avisar em até 7 dias com uma foto.",
          ],
        },
        {
          paragrafo: [
            "Para abrir uma troca, escreva para ",
            { texto: EMAIL, href: `mailto:${EMAIL}` },
            " ou use os canais do rodapé.",
          ],
        },
      ],
    },
    {
      // As regras REAIS do Clube, que abriu na Onda 3J. Sem condicional de env,
      // diferente do cartão: o wizard de /clube e o backend existem em todo
      // build. O que depende de credencial é o Mercado Pago aceitar a criação
      // da assinatura — e nesse caso a própria tela recusa com erro claro, na
      // hora, antes de qualquer promessa virar cobrança. Termos condicionais a
      // segredo de SERVIDOR não seriam verificáveis por quem os lê.
      ancora: "clube",
      titulo: "Assinatura — Clube da Canastra",
      blocos: [
        {
          paragrafo: [
            "O Clube da Canastra é uma assinatura com ",
            { forte: "cobrança recorrente" },
            " processada pelo Mercado Pago: você autoriza uma única vez, na página do próprio Mercado Pago, e o valor de cada envio é debitado automaticamente na frequência escolhida (a cada 15, 30 ou 45 dias).",
          ],
        },
        {
          lista: [
            [
              "O preço de cada envio é o do café no momento da adesão, com 10% de desconto e a entrega incluída — e fica ",
              { forte: "travado" },
              ": reajustes futuros de catálogo não alteram assinaturas já ativas.",
            ],
            [
              "Você pode ",
              { forte: "cancelar a qualquer momento" },
              ", sem multa e sem carência, na sua conta (Minha conta → Minha assinatura). O cancelamento interrompe as próximas cobranças na hora; envios já cobrados são entregues normalmente.",
            ],
            "Cada cobrança confirmada gera um pedido com as mesmas regras de torra e envio das compras avulsas, descritas acima.",
          ],
        },
      ],
    },
    {
      ancora: "uso-do-site",
      titulo: "Uso do site",
      blocos: [
        { paragrafo: "O site é para conhecer e comprar café. Não use para:" },
        {
          lista: [
            "tentar acesso não autorizado a qualquer parte da loja ou à conta de outra pessoa;",
            "sondar, sobrecarregar ou derrubar o serviço;",
            "extrair conteúdo em massa por robô, para revenda ou para montar catálogo de terceiro;",
            "enviar código malicioso;",
            "passar-se por outra pessoa ou pela própria Canastra;",
            "qualquer finalidade ilegal.",
          ],
        },
      ],
    },
    {
      ancora: "avaliacoes",
      titulo: "Avaliações",
      blocos: [
        {
          paragrafo:
            "A avaliação que você publica na página de um café é pública e fica assinada com o nome que você escolher exibir. Ao publicar, você nos autoriza a mantê-la no site.",
        },
        {
          paragrafo:
            "Podemos remover avaliação com ofensa, dado pessoal de terceiro, propaganda ou texto que não fale do produto.",
        },
        {
          paragrafo:
            "Se você encerrar a conta, a avaliação continua no ar assinada como Cliente Canastra, sem o seu nome.",
        },
      ],
    },
    {
      ancora: "propriedade-intelectual",
      titulo: "Propriedade intelectual",
      blocos: [
        {
          paragrafo:
            "As fotos, os textos, o logotipo e o desenho deste site são da Boaventura Cafés Especiais Ltda ou de quem nos licenciou.",
        },
        {
          paragrafo:
            "Você pode ver, salvar e imprimir para uso pessoal. Republicar, vender ou usar em outro site depende de autorização por escrito.",
        },
      ],
    },
    {
      ancora: "links-externos",
      titulo: "Links para fora daqui",
      blocos: [
        {
          paragrafo:
            "Alguns links levam para fora do site: a verificação de origem na base do Cerrado Mineiro, o Mercado Pago, as redes sociais da marca.",
        },
        {
          paragrafo:
            "O que acontece nesses sites é responsabilidade de quem os opera, e vale a política deles, não esta.",
        },
      ],
    },
    {
      ancora: "disponibilidade",
      titulo: "Disponibilidade e responsabilidade",
      blocos: [
        {
          paragrafo:
            "Trabalhamos para o site ficar no ar, mas não prometemos que ele nunca sai. Manutenção, atualização e falha de infraestrutura acontecem.",
        },
        { paragrafo: "Quando uma interrupção atinge um pedido em andamento, avisamos você." },
        {
          paragrafo:
            "Respondemos pelo que vendemos: o café, o prazo, a entrega e o que o Código de Defesa do Consumidor determina.",
        },
        {
          // A cláusula do institucional isentava a empresa de "danos diretos,
          // indiretos, incidentais, especiais ou consequenciais" em bloco. Numa
          // relação de consumo isso é cláusula abusiva (CDC art. 51, I) e não
          // protege ninguém: escrever uma isenção que o juiz risca é pior que
          // não escrever nada, porque dá ao cliente uma ideia errada do que
          // ele tem. A entrega, em especial, continua sendo responsabilidade da
          // loja mesmo quando quem atrasa é a transportadora.
          paragrafo:
            "Não respondemos por uso indevido da sua senha nem por falha de serviço de terceiro que não controlamos, como a operadora do seu cartão ou a sua conexão.",
        },
      ],
    },
    {
      ancora: "lei-e-foro",
      titulo: "Lei aplicável e foro",
      blocos: [
        { paragrafo: "Vale a lei brasileira, em especial o Código de Defesa do Consumidor." },
        {
          // O institucional elegia Uberlândia e parava aí. A eleição de foro não
          // afasta o art. 101, I do CDC, e omitir isso faria a cláusula parecer
          // tirar do cliente um direito que ela não tira.
          paragrafo:
            "Fica eleito o foro de Uberlândia, Minas Gerais. Se você é consumidor, a lei também permite processar no foro do seu domicílio, e esta cláusula não afasta esse direito.",
        },
        { paragrafo: "Se um trecho destes termos for considerado inválido, o resto continua valendo." },
      ],
    },
    {
      ancora: "contato",
      titulo: "Contato",
      blocos: [
        {
          paragrafo: [
            "Dúvida sobre pedido, troca ou sobre estes termos: ",
            { texto: EMAIL, href: `mailto:${EMAIL}` },
            " ou (34) 3226-2600.",
          ],
        },
        {
          paragrafo:
            "Para o andamento de um pedido, os canais do rodapé são o caminho mais rápido.",
        },
      ],
    },
  ],
};

/**
 * INGLÊS E ESPANHOL, ESCRITOS NA ONDA 3C — e a nota da 2C que dizia `= pt`
 * termina aqui.
 *
 * O QUE MUDOU DESDE AQUELA NOTA. A 2C recusou traduzir porque "traduzir texto
 * jurídico por conta própria seria inventar cláusula em outro idioma", e o
 * receio é justo. A resposta não é deixar um documento inteiro em português
 * para quem não lê português — isso não protege ninguém, só transfere o
 * problema para o leitor. A resposta é traduzir sem deslocar o direito:
 *
 *   1. NENHUM INSTITUTO ESTRANGEIRO É INVOCADO. A compra é regida pela lei
 *      brasileira, então onde a regra tem nome, o nome fica em português e vem
 *      com uma explicação curta ao lado — "Código de Defesa do Consumidor
 *      (Brazil's consumer protection law)". A tentação era escrever "consumer
 *      right of withdrawal under EU law" ou "UCC"; isso seria prometer um
 *      direito que esta loja não dá e este foro não julga.
 *   2. NÚMERO, PRAZO E NOME PRÓPRIO SÃO LITERAIS. Os 7 dias, os 15, 30 e 45
 *      dias do Clube, os 10%, a razão social, o foro de Uberlândia, "Mercado
 *      Pago", "Melhor Envio", "Clube da Canastra", "nota fiscal", "CPF", "CEP"
 *      e "Pix" atravessam os três idiomas iguais — é isso que o teste ao lado
 *      cobra em todos os locales, e não por acaso.
 *   3. O DOCUMENTO DIZ QUE É TRADUÇÃO. Em `en` e `es` o aviso do topo declara
 *      que a versão em português é a que rege. É prática corrente em contrato
 *      bilíngue, e é a única frase que impede uma escolha de palavra minha de
 *      virar cláusula.
 *
 * O `<AvisoJuridico>` CONTINUA NAS TRÊS — ver AVISO_JURIDICO abaixo. Um texto
 * sem revisão de advogado não passa a ser revisado por ter sido traduzido.
 */
const en: ConteudoLegal = {
  meta: {
    titulo: "Terms of use — Café Canastra",
    descricao:
      "Who sells, how you pay, when the coffee leaves the roastery and how to withdraw from a purchase. The terms of the Café Canastra store.",
  },
  titulo: "Terms of use",
  atualizacao: "August 2026",
  secoes: [
    {
      ancora: "quem-somos",
      titulo: "Who we are",
      blocos: [
        {
          paragrafo:
            "The Café Canastra store is operated by Boaventura Cafés Especiais Ltda, in Uberlândia, Minas Gerais, Brazil. That is the company you enter into a contract with when you buy here.",
        },
        {
          paragrafo:
            "The coffee comes from the Boaventura family, who have been growing since 1985 — first in Patrocínio, in the Cerrado Mineiro — and producing in the Serra da Canastra since 2008.",
        },
        {
          paragrafo: [
            // O `+55` não é dado novo: é o código do Brasil na frente do mesmo
            // número da versão em português. Sem ele, o telefone de contato de
            // uma página em inglês é um número que não se disca de fora.
            "Address: Rua Nivaldo Guerreiro Nunes, 701, Distrito Industrial, Uberlândia, Minas Gerais, Brazil. Contact: ",
            { texto: EMAIL, href: `mailto:${EMAIL}` },
            " or +55 (34) 3226-2600.",
          ],
        },
      ],
    },
    {
      ancora: "aceite",
      titulo: "Accepting these terms",
      blocos: [
        {
          paragrafo:
            "Browsing, creating an account, buying or subscribing here means accepting these terms. If you disagree with any of them, do not use the store.",
        },
        {
          paragrafo:
            "We may change this text. The published version is the one that applies, and the date at the top says when it changed.",
        },
        {
          paragrafo:
            "A change does not reach an order already confirmed or a subscription already active: what applied to your purchase is the text of the day you made it.",
        },
      ],
    },
    {
      ancora: "o-que-o-site-faz",
      titulo: "What this site does",
      blocos: [
        {
          paragrafo:
            "Here you get to know the coffees, buy them, follow your order from your account and subscribe to the Clube da Canastra.",
        },
        {
          paragrafo:
            "We ship to addresses in Brazil. The bag, the checkout and the account exist in Portuguese only, including on the English and Spanish versions of this site.",
        },
        {
          paragrafo:
            "The pages about the range, the history and the coffee lines are informative: they tell where the coffee comes from, and do not replace what is written on the bag.",
        },
      ],
    },
    {
      ancora: "sua-conta",
      titulo: "Your account",
      blocos: [
        {
          paragrafo:
            "The account is personal. An order placed with your login is treated as yours, so look after your password.",
        },
        {
          paragrafo:
            "Your name, CPF (the Brazilian taxpayer number) and address must be correct: they go on the nota fiscal — the Brazilian tax invoice — and on the shipping label. A wrong address delays or loses the parcel.",
        },
        {
          paragrafo: [
            "You can close the account whenever you want, on your own, under My account. It is final — the ",
            { texto: "Privacy policy", href: "/politica-de-privacidade" },
            " explains what is erased and what stays.",
          ],
        },
        {
          paragrafo:
            "We may suspend or close an account used for fraud or for anything the Using the site section forbids.",
        },
      ],
    },
    {
      ancora: "pedidos-e-pagamento",
      titulo: "Orders and payment",
      blocos: [
        {
          paragrafo: [
            "An order is only confirmed once payment is approved. We work with ",
            {
              conforme: "cartao",
              sim: "Pix (Brazil's instant bank transfer) and credit card",
              nao: "Pix, Brazil's instant bank transfer",
            },
            ", through Mercado Pago.",
          ],
        },
        {
          paragrafo:
            "Your card number never passes through our servers: the card fields belong to Mercado Pago itself, and what reaches us is a single-use token.",
        },
        {
          paragrafo:
            "Prices may change without notice — never after an order is confirmed.",
        },
        {
          paragrafo:
            "If a price or a stock figure is wrong through our fault, we tell you and cancel the order. Anything already paid is refunded in full.",
        },
      ],
    },
    {
      ancora: "torra-e-envio",
      titulo: "Roasting and shipping",
      blocos: [
        {
          // Sem dia da semana, pelo mesmo motivo do português — ver a nota na
          // seção "Torra e envio" de `pt`.
          paragrafo:
            "We roast to order, in small batches: an order is dispatched once its batch is ready, never out of roasted stock left sitting. The time until dispatch therefore follows the roast.",
        },
        {
          paragrafo:
            "Shipping is quoted by Melhor Envio, with the carriers that serve your CEP (the Brazilian postcode). The delivery time shown at checkout counts from dispatch, not from the order.",
        },
        { paragrafo: "We ship to addresses in Brazil only." },
      ],
    },
    {
      ancora: "trocas-e-devolucoes",
      titulo: "Returns and exchanges",
      blocos: [
        {
          lista: [
            // O prazo e a lei são literais de propósito: 7 dias corridos é o
            // que o CDC dá, e nomear a lei em português é o que impede o
            // leitor estrangeiro de supor o prazo do país dele.
            "You may withdraw from the purchase within 7 calendar days of receiving it, under the Código de Defesa do Consumidor — Brazil's consumer protection law.",
            "Opened bags are not accepted back on withdrawal, because coffee is food.",
            "If the product arrives damaged or different from what you ordered, we replace it at no cost — just tell us within 7 days, with a photo.",
          ],
        },
        {
          paragrafo: [
            "To open a return, write to ",
            { texto: EMAIL, href: `mailto:${EMAIL}` },
            " or use the channels in the footer.",
          ],
        },
      ],
    },
    {
      ancora: "clube",
      titulo: "Subscription — Clube da Canastra",
      blocos: [
        {
          paragrafo: [
            "The Clube da Canastra is a subscription with a ",
            { forte: "recurring charge" },
            " processed by Mercado Pago: you authorise it once, on Mercado Pago's own page, and the amount of each delivery is then charged automatically at the frequency you chose (every 15, 30 or 45 days).",
          ],
        },
        {
          lista: [
            [
              "The price of each delivery is the price of the coffee on the day you subscribed, with 10% off and delivery included — and it is ",
              { forte: "locked" },
              ": later catalogue increases do not change subscriptions already active.",
            ],
            [
              "You can ",
              { forte: "cancel at any time" },
              ", with no penalty and no minimum term, from your account (My account → My subscription). Cancelling stops the next charges immediately; deliveries already charged for are shipped as normal.",
            ],
            "Each confirmed charge creates an order under the same roasting and shipping rules as one-off purchases, described above.",
          ],
        },
      ],
    },
    {
      ancora: "uso-do-site",
      titulo: "Using the site",
      blocos: [
        {
          paragrafo:
            "This site is for getting to know and buying coffee. Do not use it to:",
        },
        {
          lista: [
            "attempt unauthorised access to any part of the store or to another person's account;",
            "probe, overload or bring down the service;",
            "harvest content in bulk with robots, for resale or to build someone else's catalogue;",
            "send malicious code;",
            "impersonate another person or Canastra itself;",
            "any unlawful purpose.",
          ],
        },
      ],
    },
    {
      ancora: "avaliacoes",
      titulo: "Reviews",
      blocos: [
        {
          paragrafo:
            "A review you publish on a coffee's page is public and is signed with the name you choose to display. By publishing it, you allow us to keep it on the site.",
        },
        {
          paragrafo:
            "We may remove a review containing abuse, someone else's personal data, advertising, or text that is not about the product.",
        },
        {
          paragrafo:
            "If you close your account, the review stays online signed as Cliente Canastra, without your name.",
        },
      ],
    },
    {
      ancora: "propriedade-intelectual",
      titulo: "Intellectual property",
      blocos: [
        {
          paragrafo:
            "The photographs, texts, logo and design of this site belong to Boaventura Cafés Especiais Ltda or to whoever licensed them to us.",
        },
        {
          paragrafo:
            "You may view, save and print them for personal use. Republishing, selling or using them on another site requires written permission.",
        },
      ],
    },
    {
      ancora: "links-externos",
      titulo: "Links that leave this site",
      blocos: [
        {
          paragrafo:
            "Some links go outside this site: the origin check on the Cerrado Mineiro database, Mercado Pago, and the brand's social networks.",
        },
        {
          paragrafo:
            "What happens on those sites is the responsibility of whoever runs them, and their policies apply there, not this one.",
        },
      ],
    },
    {
      ancora: "disponibilidade",
      titulo: "Availability and liability",
      blocos: [
        {
          paragrafo:
            "We work to keep the site up, but we do not promise it never goes down. Maintenance, updates and infrastructure failures happen.",
        },
        {
          paragrafo:
            "When an outage affects an order in progress, we tell you.",
        },
        {
          paragrafo:
            "We answer for what we sell: the coffee, the deadline, the delivery, and whatever the Código de Defesa do Consumidor requires.",
        },
        {
          // Mesma recusa da versão em português: a cláusula original isentava
          // a empresa de dano "direto, indireto, incidental" em bloco, o que é
          // abusivo no CDC art. 51, I. Traduzir a cláusula abusiva daria a um
          // leitor estrangeiro uma ideia errada do que ele tem.
          paragrafo:
            "We do not answer for misuse of your password, nor for failures in third-party services we do not control, such as your card issuer or your connection.",
        },
      ],
    },
    {
      ancora: "lei-e-foro",
      titulo: "Governing law and jurisdiction",
      blocos: [
        {
          paragrafo:
            "Brazilian law applies, in particular the Código de Defesa do Consumidor, Brazil's consumer protection law.",
        },
        {
          paragrafo:
            "The courts of Uberlândia, Minas Gerais, are elected as the forum. If you are a consumer, Brazilian law also lets you sue in the courts of your own domicile, and this clause does not take that right away.",
        },
        {
          paragrafo:
            "If any part of these terms is held invalid, the rest remains in force.",
        },
      ],
    },
    {
      ancora: "contato",
      titulo: "Contact",
      blocos: [
        {
          paragrafo: [
            "Questions about an order, a return or these terms: ",
            { texto: EMAIL, href: `mailto:${EMAIL}` },
            " or +55 (34) 3226-2600.",
          ],
        },
        {
          paragrafo:
            "For the progress of an order, the channels in the footer are the fastest route.",
        },
      ],
    },
  ],
};

const es: ConteudoLegal = {
  meta: {
    titulo: "Términos de uso — Café Canastra",
    descricao:
      "Quién vende, cómo se paga, cuándo sale de la tostaduría y cómo se desiste de la compra. Las condiciones de la tienda del Café Canastra.",
  },
  titulo: "Términos de uso",
  atualizacao: "agosto de 2026",
  secoes: [
    {
      ancora: "quem-somos",
      titulo: "Quiénes somos",
      blocos: [
        {
          paragrafo:
            "La tienda del Café Canastra la opera Boaventura Cafés Especiais Ltda, en Uberlândia, Minas Gerais, Brasil. Es con ella con quien usted contrata al comprar aquí.",
        },
        {
          paragrafo:
            "El café viene de la familia Boaventura, que planta desde 1985 — primero en Patrocínio, en el Cerrado Mineiro — y produce en la Serra da Canastra desde 2008.",
        },
        {
          paragrafo: [
            "Dirección: Rua Nivaldo Guerreiro Nunes, 701, Distrito Industrial, Uberlândia, Minas Gerais, Brasil. Contacto: ",
            { texto: EMAIL, href: `mailto:${EMAIL}` },
            " o +55 (34) 3226-2600.",
          ],
        },
      ],
    },
    {
      ancora: "aceite",
      titulo: "Aceptar estos términos",
      blocos: [
        {
          paragrafo:
            "Navegar, crear una cuenta, comprar o suscribirse aquí significa aceptar estos términos. Si usted no está de acuerdo con algún punto, no use la tienda.",
        },
        {
          paragrafo:
            "Podemos cambiar este texto. Rige la versión publicada, y la fecha del encabezado dice cuándo cambió.",
        },
        {
          paragrafo:
            "El cambio no alcanza a un pedido ya confirmado ni a una suscripción ya activa: lo que valió en su compra fue el texto del día en que la hizo.",
        },
      ],
    },
    {
      ancora: "o-que-o-site-faz",
      titulo: "Qué hace este sitio",
      blocos: [
        {
          paragrafo:
            "Aquí usted conoce los cafés, compra, sigue el pedido desde su cuenta y puede suscribirse al Clube da Canastra.",
        },
        {
          paragrafo:
            "Enviamos a direcciones en Brasil. La bolsa, el checkout y la cuenta existen solo en portugués, también en las versiones en inglés y español del sitio.",
        },
        {
          paragrafo:
            "Las páginas sobre la sierra, la historia y las líneas son informativas: cuentan de dónde viene el café, no sustituyen lo que está escrito en el paquete.",
        },
      ],
    },
    {
      ancora: "sua-conta",
      titulo: "Su cuenta",
      blocos: [
        {
          paragrafo:
            "La cuenta es personal. Un pedido hecho con su acceso se trata como suyo, así que cuide la contraseña.",
        },
        {
          paragrafo:
            "El nombre, el CPF (el número de contribuyente brasileño) y la dirección tienen que estar correctos: van a la nota fiscal — la factura fiscal brasileña — y a la etiqueta de entrega. Una dirección equivocada atrasa o pierde el envío.",
        },
        {
          paragrafo: [
            "Usted cierra la cuenta cuando quiera, solo, en Mi cuenta. Es definitivo — la ",
            { texto: "Política de privacidad", href: "/politica-de-privacidade" },
            " explica qué se borra y qué se queda.",
          ],
        },
        {
          paragrafo:
            "Podemos suspender o cerrar una cuenta usada para fraude o para lo que la sección Uso del sitio prohíbe.",
        },
      ],
    },
    {
      ancora: "pedidos-e-pagamento",
      titulo: "Pedidos y pago",
      blocos: [
        {
          paragrafo: [
            "El pedido solo se confirma después de que el pago es aprobado. Trabajamos con ",
            {
              conforme: "cartao",
              sim: "Pix (la transferencia instantánea brasileña) y tarjeta de crédito",
              nao: "Pix, la transferencia instantánea brasileña",
            },
            ", por Mercado Pago.",
          ],
        },
        {
          paragrafo:
            "El número de la tarjeta no pasa por nuestros servidores: los campos son del propio Mercado Pago, y lo que llega hasta nosotros es un código de un solo uso.",
        },
        {
          paragrafo:
            "El precio puede cambiar sin aviso — nunca después de un pedido confirmado.",
        },
        {
          paragrafo:
            "Si un precio o un stock está equivocado por falla nuestra, le avisamos y cancelamos el pedido. Lo que ya se haya pagado vuelve íntegro.",
        },
      ],
    },
    {
      ancora: "torra-e-envio",
      titulo: "Tueste y envío",
      blocos: [
        {
          // Sem dia da semana, pelo mesmo motivo do português — ver a nota na
          // seção "Torra e envio" de `pt`.
          paragrafo:
            "Tostamos bajo pedido, en lotes pequeños: el pedido se despacha cuando su lote está listo, y no sale de tueste guardado. Por eso el plazo hasta el despacho acompaña al tueste.",
        },
        {
          paragrafo:
            "El flete lo calcula Melhor Envio, con los transportistas que atienden su CEP (el código postal brasileño). El plazo que se muestra en el checkout empieza a contar desde el envío, no desde el pedido.",
        },
        { paragrafo: "Enviamos solo a direcciones en Brasil." },
      ],
    },
    {
      ancora: "trocas-e-devolucoes",
      titulo: "Cambios y devoluciones",
      blocos: [
        {
          lista: [
            "Usted puede desistir de la compra en un plazo de 7 días corridos desde que la recibe, conforme al Código de Defesa do Consumidor, la ley brasileña de defensa del consumidor.",
            "Los paquetes abiertos no se aceptan en devolución por arrepentimiento, por tratarse de un alimento.",
            "Si el producto llega dañado o distinto del pedido, lo cambiamos sin costo — basta avisar en un plazo de 7 días con una foto.",
          ],
        },
        {
          paragrafo: [
            "Para abrir un cambio, escriba a ",
            { texto: EMAIL, href: `mailto:${EMAIL}` },
            " o use los canales del pie de página.",
          ],
        },
      ],
    },
    {
      ancora: "clube",
      titulo: "Suscripción — Clube da Canastra",
      blocos: [
        {
          paragrafo: [
            "El Clube da Canastra es una suscripción con ",
            { forte: "cobro recurrente" },
            " procesado por Mercado Pago: usted autoriza una sola vez, en la página del propio Mercado Pago, y el valor de cada envío se debita automáticamente en la frecuencia elegida (cada 15, 30 o 45 días).",
          ],
        },
        {
          lista: [
            [
              "El precio de cada envío es el del café en el momento de la adhesión, con 10% de descuento y la entrega incluida — y queda ",
              { forte: "fijo" },
              ": los reajustes futuros del catálogo no alteran suscripciones ya activas.",
            ],
            [
              "Usted puede ",
              { forte: "cancelar en cualquier momento" },
              ", sin multa y sin permanencia, en su cuenta (Mi cuenta → Mi suscripción). La cancelación interrumpe los próximos cobros al instante; los envíos ya cobrados se entregan normalmente.",
            ],
            "Cada cobro confirmado genera un pedido con las mismas reglas de tueste y envío de las compras sueltas, descritas arriba.",
          ],
        },
      ],
    },
    {
      ancora: "uso-do-site",
      titulo: "Uso del sitio",
      blocos: [
        {
          paragrafo:
            "El sitio es para conocer y comprar café. No lo use para:",
        },
        {
          lista: [
            "intentar el acceso no autorizado a cualquier parte de la tienda o a la cuenta de otra persona;",
            "sondear, sobrecargar o tumbar el servicio;",
            "extraer contenido en masa con robots, para reventa o para armar el catálogo de un tercero;",
            "enviar código malicioso;",
            "hacerse pasar por otra persona o por la propia Canastra;",
            "cualquier finalidad ilegal.",
          ],
        },
      ],
    },
    {
      ancora: "avaliacoes",
      titulo: "Reseñas",
      blocos: [
        {
          paragrafo:
            "La reseña que usted publica en la página de un café es pública y queda firmada con el nombre que elija mostrar. Al publicarla, nos autoriza a mantenerla en el sitio.",
        },
        {
          paragrafo:
            "Podemos retirar una reseña con ofensa, con datos personales de terceros, con propaganda o con texto que no hable del producto.",
        },
        {
          paragrafo:
            "Si usted cierra la cuenta, la reseña sigue publicada firmada como Cliente Canastra, sin su nombre.",
        },
      ],
    },
    {
      ancora: "propriedade-intelectual",
      titulo: "Propiedad intelectual",
      blocos: [
        {
          paragrafo:
            "Las fotos, los textos, el logotipo y el diseño de este sitio son de Boaventura Cafés Especiais Ltda o de quien nos los licenció.",
        },
        {
          paragrafo:
            "Usted puede ver, guardar e imprimir para uso personal. Republicar, vender o usar en otro sitio depende de autorización por escrito.",
        },
      ],
    },
    {
      ancora: "links-externos",
      titulo: "Enlaces fuera de aquí",
      blocos: [
        {
          paragrafo:
            "Algunos enlaces llevan fuera del sitio: la verificación de origen en la base del Cerrado Mineiro, Mercado Pago, las redes sociales de la marca.",
        },
        {
          paragrafo:
            "Lo que pasa en esos sitios es responsabilidad de quien los opera, y rige la política de ellos, no esta.",
        },
      ],
    },
    {
      ancora: "disponibilidade",
      titulo: "Disponibilidad y responsabilidad",
      blocos: [
        {
          paragrafo:
            "Trabajamos para que el sitio esté en el aire, pero no prometemos que nunca se caiga. El mantenimiento, la actualización y la falla de infraestructura ocurren.",
        },
        {
          paragrafo:
            "Cuando una interrupción alcanza un pedido en curso, le avisamos.",
        },
        {
          paragrafo:
            "Respondemos por lo que vendemos: el café, el plazo, la entrega y lo que determina el Código de Defesa do Consumidor.",
        },
        {
          paragrafo:
            "No respondemos por el uso indebido de su contraseña ni por la falla de un servicio de terceros que no controlamos, como la operadora de su tarjeta o su conexión.",
        },
      ],
    },
    {
      ancora: "lei-e-foro",
      titulo: "Ley aplicable y fuero",
      blocos: [
        {
          paragrafo:
            "Rige la ley brasileña, en especial el Código de Defesa do Consumidor, la ley brasileña de defensa del consumidor.",
        },
        {
          paragrafo:
            "Queda elegido el fuero de Uberlândia, Minas Gerais. Si usted es consumidor, la ley brasileña también permite demandar en el fuero de su domicilio, y esta cláusula no le quita ese derecho.",
        },
        {
          paragrafo:
            "Si un tramo de estos términos se considera inválido, el resto sigue valiendo.",
        },
      ],
    },
    {
      ancora: "contato",
      titulo: "Contacto",
      blocos: [
        {
          paragrafo: [
            "Dudas sobre un pedido, un cambio o sobre estos términos: ",
            { texto: EMAIL, href: `mailto:${EMAIL}` },
            " o +55 (34) 3226-2600.",
          ],
        },
        {
          paragrafo:
            "Para el avance de un pedido, los canales del pie de página son el camino más rápido.",
        },
      ],
    },
  ],
};

export const TERMOS: Record<Locale, ConteudoLegal> = { pt, en, es };

/**
 * A CLÁUSULA DE PREVALÊNCIA, que é o que torna a tradução segura.
 *
 * Um contrato traduzido sem dizer qual versão rege tem duas versões regendo, e
 * a diferença entre elas passa a ser argumento. Esta frase resolve isso em uma
 * linha, é prática corrente em contrato bilíngue, e é verdadeira: a compra é
 * feita no Brasil, sob lei brasileira, e o texto em português é o assinado.
 *
 * Ela aparece só em `en` e `es` — na página em português seria uma frase se
 * declarando prevalente sobre si mesma.
 */
export const AVISO_DE_TRADUCAO: Record<Exclude<Locale, "pt">, string> = {
  en: "This is a translation provided for convenience. The Portuguese version is the one that legally applies, and the purchase is governed by Brazilian law.",
  es: "Esta es una traducción de cortesía. La versión en portugués es la que rige legalmente, y la compra se rige por la ley brasileña.",
};

/**
 * O AVISO JURÍDICO NOS OUTROS DOIS IDIOMAS.
 *
 * O `<AvisoJuridico>` de components/layout/PaginaTexto.tsx é fixo em português
 * — e aquele arquivo é de outro dono nesta onda, então não dá para ensiná-lo a
 * falar três idiomas. Deixar o aviso em português numa página em inglês seria
 * pior do que qualquer alternativa: é justamente o aviso que o leitor PRECISA
 * entender, e o único que ele não entenderia.
 *
 * Então em `en` e `es` a página renderiza este texto, na mesma moldura visual,
 * com a cláusula de prevalência anexada — um aviso só, e não dois blocos de
 * alerta empilhados em 360 px. No dia em que o `PaginaTexto` aceitar o locale,
 * este objeto e o ramo que o renderiza somem juntos.
 */
export const AVISO_JURIDICO: Record<
  Exclude<Locale, "pt">,
  { forte: string; texto: string }
> = {
  en: {
    forte: "Provisional text, not yet reviewed by a lawyer.",
    texto:
      "This content is a development skeleton and must not go live as a legal document of Café Canastra without a lawyer looking at it — in particular on data protection (LGPD), the right of withdrawal and the returns policy.",
  },
  es: {
    forte: "Texto provisional, todavía sin revisión jurídica.",
    texto:
      "Este contenido es un esqueleto de desarrollo y no debe publicarse como documento legal del Café Canastra sin pasar por un abogado — en especial en los puntos de protección de datos (LGPD), derecho de arrepentimiento y política de cambios.",
  },
};

/** Os parágrafos de uma seção, na ordem, sem distinguir texto solto de lista. */
export function paragrafosDa(secao: Secao): Paragrafo[] {
  return secao.blocos.flatMap((b) => ("lista" in b ? b.lista : [b.paragrafo]));
}

/** Todo o texto de uma seção numa string — a forma que os testes leem. */
export function textoCorrido(secao: Secao): string {
  const achatar = (p: Paragrafo): string =>
    typeof p === "string"
      ? p
      : p
          .map((t) => {
            if (typeof t === "string") return t;
            if ("forte" in t) return t.forte;
            if ("texto" in t) return t.texto;
            return `${t.sim} ${t.nao}`;
          })
          .join("");

  return [secao.titulo, ...paragrafosDa(secao).map(achatar)].join(" ");
}
