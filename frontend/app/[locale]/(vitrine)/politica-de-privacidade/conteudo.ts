import { type Locale } from "../../../../lib/i18n/tipos";

/**
 * O texto da Política de privacidade nos três idiomas.
 *
 * DE ONDE VEIO. A base é `app/politica-privacidade` do site institucional
 * (github.com/Kmzf777/cafecanastrablog), que era um modelo genérico: listava
 * "data de nascimento" e "informações de pagamento" entre os dados coletados —
 * a loja não pede nem guarda nenhum dos dois — e resolvia os destinatários com
 * "prestadores de serviços que nos ajudam a operar nosso negócio", sem nomear
 * ninguém. Aqui cada operador é nomeado, e cada nome corresponde a código vivo.
 *
 * O QUE FOI DESCARTADO INTEIRO: `politica.md` e `app/politica-privacidade-app`
 * do material de referência. O primeiro é o contrato de licenciamento do
 * "SISTEMA ZPRO", de outra empresa, com outro CNPJ e outro foro; o segundo é
 * esse mesmo contrato com o nome trocado, falando de VPS, tenants e API do
 * WhatsApp. Ver a nota equivalente em ../termos-de-uso/conteudo.ts.
 *
 * A REGRA QUE ORGANIZOU ESTE TEXTO: nenhum direito é prometido sem porta. Cada
 * item da seção "Seus direitos" aponta para uma superfície que existe — o
 * `DELETE /auth/users/me` atrás de "Encerrar minha conta", o descadastro da
 * newsletter, o "Rever cookies", e o `GET /lgpd/titulares/:id/dados` que o
 * administrador roda quando alguém pede a cópia. O que é self-service está na
 * lista do self-service; o que é pedido por e-mail está na lista do pedido. A
 * loja já cometeu o erro contrário uma vez (mandava escrever e-mail para
 * exercer uma exclusão que a própria conta cumpria em segundos), e a lição está
 * escrita em components/conta/EncerrarConta.tsx.
 *
 * IMPORT RELATIVO, não `@/`: o vitest.config.ts não resolve o alias, e este
 * módulo tem teste ao lado (mesma nota de lib/i18n/rotas.ts).
 */

/** Ver a nota de `Trecho` em ../termos-de-uso/conteudo.ts — a forma é a mesma. */
export type Trecho =
  | string
  | { forte: string }
  /** Caminho interno (`/…`), `mailto:` ou `tel:`. O locale é aplicado na tela. */
  | { texto: string; href: string }
  /**
   * O botão que revoga o consentimento de cookies. É COMPONENTE, e não texto:
   * ele apaga a chave de consentimento e mata o gtag na hora — a página que
   * promete a escolha é a página onde ela se exerce (BotaoReverCookies).
   */
  | { acao: "rever-cookies" };

export type Paragrafo = string | Trecho[];

/**
 * Uma seção é uma SEQUÊNCIA de blocos, e não um punhado de campos — mesma
 * decisão dos Termos, e aqui ela pesa mais: a seção "Seus direitos" alterna
 * parágrafo, lista, parágrafo, lista, e a frase "Você faz sozinho, agora" só
 * significa alguma coisa colada na lista que ela anuncia.
 *
 * O `papel` das listas é o que permite ao teste contar as portas do
 * self-service sem ler prosa.
 */
export type Bloco =
  | { paragrafo: Paragrafo }
  | { lista: Paragrafo[]; papel?: "sozinho" | "pedindo" }
  /** O formulário de descadastro da newsletter, no ponto exato onde entra. */
  | { formulario: "descadastro-newsletter" };

export type Secao = {
  ancora: string;
  titulo: string;
  blocos: Bloco[];
};

export type ConteudoLegal = {
  meta: { titulo: string; descricao: string };
  titulo: string;
  atualizacao: string;
  secoes: Secao[];
};

/** Estrutura, não texto: a âncora é a mesma nos três idiomas. */
export const SECOES_DA_PRIVACIDADE = [
  "controlador",
  "o-que-coletamos",
  "por-que",
  "compartilhamento",
  "fora-do-brasil",
  "onde-ficam",
  "cookies",
  "seguranca",
  "retencao",
  "direitos",
  "criancas",
  "mudancas",
  "contato",
] as const;

const EMAIL = "comercial@cafecanastra.com";

const pt: ConteudoLegal = {
  meta: {
    titulo: "Política de privacidade — Café Canastra",
    descricao:
      "Quais dados a loja coleta, por quê, com quem compartilha e como você apaga os seus — com o que dá para fazer sozinho, agora.",
  },
  titulo: "Política de privacidade",
  atualizacao: "agosto de 2026",
  secoes: [
    {
      ancora: "controlador",
      titulo: "Quem responde pelos seus dados",
      blocos: [
        {
          paragrafo:
            "O controlador dos seus dados é a Boaventura Cafés Especiais Ltda, Rua Nivaldo Guerreiro Nunes, 701, Distrito Industrial, Uberlândia, Minas Gerais.",
        },
        {
          paragrafo: [
            "Pedido de titular, dúvida ou reclamação sobre dados pessoais: ",
            { texto: EMAIL, href: `mailto:${EMAIL}` },
            ". É esse endereço que responde.",
          ],
        },
      ],
    },
    {
      ancora: "o-que-coletamos",
      titulo: "O que coletamos",
      blocos: [
        {
          lista: [
            "Nome, e-mail, CPF e telefone — para emitir a nota fiscal e falar com você sobre o pedido.",
            "Endereço — para calcular o frete e entregar. Ele fica congelado dentro do pedido, como fotografia do que foi combinado naquele dia.",
            "O que você põe na sacola — para a sacola sobreviver entre visitas e entre aparelhos.",
            "As avaliações que você publica, com o nome que escolher exibir.",
            "Seu e-mail, se você se inscrever na newsletter do rodapé.",
            "Páginas vistas e eventos de compra no Google Analytics 4 — só depois que você aceita no aviso de cookies.",
          ],
        },
        {
          // O institucional listava "data de nascimento" e "informações de
          // pagamento" entre os dados coletados. A loja não pede a primeira e
          // nunca vê a segunda: os campos do cartão são iframes do Mercado Pago
          // (lib/sacola/cartao.ts). Dizer o que NÃO se coleta é a parte que o
          // modelo genérico não tinha como escrever.
          paragrafo:
            "Não pedimos data de nascimento e não guardamos número de cartão: os campos do cartão são do Mercado Pago, e o número não chega aos nossos servidores.",
        },
      ],
    },
    {
      ancora: "por-que",
      titulo: "Por que coletamos",
      blocos: [
        { paragrafo: "Cada dado tem um motivo, e o motivo é o que a lei chama de base legal:" },
        {
          lista: [
            "Executar a compra que você pediu — é o contrato entre nós.",
            "Emitir a nota e guardar o que a legislação fiscal manda guardar — é obrigação legal.",
            "Mandar novidades por e-mail e medir o uso do site — é consentimento, e você pode retirar.",
            "Prevenir fraude e manter a loja segura — é o legítimo interesse da loja.",
          ],
        },
        {
          paragrafo:
            "Retirar o consentimento de e-mail não afeta as suas compras, e vale na hora. É o formulário abaixo.",
        },
        // A promessa e a implementação lado a lado. O formulário chama
        // POST /newsletter/descadastrar, que apaga a inscrição do rodapé.
        { formulario: "descadastro-newsletter" },
        {
          paragrafo:
            "Se você excluir a conta, esse e-mail sai da lista junto — não é preciso pedir as duas coisas.",
        },
      ],
    },
    {
      ancora: "compartilhamento",
      titulo: "Com quem compartilhamos",
      blocos: [
        {
          lista: [
            "Mercado Pago — pagamento do pedido e a cobrança recorrente do Clube.",
            "Melhor Envio e as transportadoras — cálculo de frete e entrega.",
            "Resend — envio dos e-mails de status do pedido.",
            // O Bling entrou na Onda 3 (backend/src/services/blingPedidos.js):
            // ao aprovar o pedido, nome, CPF, e-mail e endereço vão para lá.
            // Sem condicional de env — a chave é segredo de SERVIDOR, e ninguém
            // que lê esta página teria como verificar a condicional.
            "Bling — cadastro do contato e emissão da nota fiscal do pedido.",
            "Google Analytics 4 — medição de uso, só se você aceitar no aviso de cookies.",
          ],
        },
        {
          paragrafo:
            "Não vendemos seus dados para ninguém. Além desses cinco, só entregamos dado pessoal a autoridade quando existe ordem legal que obrigue.",
        },
      ],
    },
    {
      ancora: "fora-do-brasil",
      titulo: "Dados que saem do Brasil",
      blocos: [
        {
          paragrafo:
            "Dois desses serviços são operados por empresas de fora do Brasil: o Resend, que envia os e-mails, e o Google, que faz a medição.",
        },
        {
          paragrafo:
            "Quando você recebe um e-mail nosso, ou quando aceita a medição, esses dados são tratados fora do país. É o que a lei chama de transferência internacional.",
        },
      ],
    },
    {
      ancora: "onde-ficam",
      titulo: "Onde os dados ficam",
      blocos: [
        {
          paragrafo:
            "A conta e o banco de dados da loja ficam em servidor próprio, com Supabase auto-hospedado — não num serviço de banco de dados de terceiro.",
        },
        {
          paragrafo:
            "A senha nunca chega até nós: quem cuida do login é o GoTrue, e o que fica guardado é um resumo criptográfico, não a senha.",
        },
      ],
    },
    {
      ancora: "cookies",
      titulo: "Cookies e medição",
      blocos: [
        {
          paragrafo:
            "Usamos cookies necessários para manter você conectado e guardar a sacola. Sem eles a loja não funciona, e por isso eles não dependem de escolha.",
        },
        {
          paragrafo:
            "Cookies de medição só entram se você aceitar no aviso que aparece na primeira visita.",
        },
        {
          paragrafo: [
            "Mudou de ideia? ",
            { acao: "rever-cookies" },
            " — o aviso volta a aparecer e a medição para na hora. Sessão e sacola continuam funcionando.",
          ],
        },
      ],
    },
    {
      ancora: "seguranca",
      titulo: "Segurança",
      blocos: [
        {
          paragrafo:
            "O painel administrativo e as rotas que leem dado pessoal exigem login e permissão de administrador.",
        },
        {
          paragrafo:
            "O número do cartão não passa por aqui, e a senha fica só como resumo criptográfico.",
        },
        {
          paragrafo:
            "Nenhum sistema é inviolável. Se houver incidente de segurança com risco relevante para você, comunicamos você e a ANPD.",
        },
      ],
    },
    {
      // Cada linha desta lista corresponde a um passo real da rota de exclusão,
      // na mesma ordem em que ela executa (ver "A ORDEM DA EXCLUSÃO DE CONTA"
      // em backend/src/routes/conta.routes.js e a lista O_QUE_ACONTECE de
      // components/conta/EncerrarConta.tsx). Se a rota mudar e esta seção não,
      // a página passa a mentir sobre o que acontece com os dados de alguém.
      ancora: "retencao",
      titulo: "Por quanto tempo guardamos",
      blocos: [
        {
          lista: [
            "Conta e cadastro: enquanto a conta existir. Você encerra quando quiser.",
            "Pedido e nota fiscal: pelo prazo legal de guarda fiscal, mesmo depois de a conta ser encerrada — mas sem o seu nome, CPF, e-mail e endereço, que são apagados do pedido.",
            "Assinatura do Clube: cancelada na hora em que a conta é encerrada, sem multa.",
            "Newsletter: até você sair da lista.",
            "Avaliação publicada: continua no site, assinada como Cliente Canastra, sem o seu nome.",
          ],
        },
      ],
    },
    {
      ancora: "direitos",
      titulo: "Seus direitos",
      blocos: [
        {
          paragrafo:
            "A LGPD dá a você um conjunto de direitos sobre os seus dados. Abaixo está onde cada um se exerce — e a diferença entre clicar e pedir importa.",
        },
        { paragrafo: "Você faz sozinho, agora:" },
        {
          papel: "sozinho",
          lista: [
            [
              "Apagar seus dados pessoais e encerrar a conta — ",
              { texto: "entre na sua conta", href: "/account" },
              " e use Encerrar minha conta, no fim da página. Não precisa pedir nem esperar.",
            ],
            "Sair da lista de novidades — o formulário da seção Por que coletamos, acima.",
            "Rever o consentimento de cookies — o botão Rever cookies, na seção Cookies.",
          ],
        },
        { paragrafo: "Você pede por e-mail, e respondemos em até 15 dias:" },
        {
          papel: "pedindo",
          lista: [
            "Uma cópia de tudo que a loja guarda sobre você, em arquivo — o direito de acesso e o de portabilidade, atendidos de uma vez.",
            "Correção de nome, CPF, telefone ou endereço.",
            "Apagar seus dados dos pedidos antigos sem encerrar a conta.",
            "Saber com quem compartilhamos e o que acontece se você não consentir.",
            "Se opor a um tratamento específico.",
          ],
        },
        {
          paragrafo:
            "Alguns dados ficam mesmo depois de um pedido de exclusão, quando há obrigação fiscal: a nota fiscal tem prazo legal de guarda.",
        },
      ],
    },
    {
      ancora: "criancas",
      titulo: "Crianças e adolescentes",
      blocos: [
        { paragrafo: "Comprar aqui é firmar um contrato, e por isso a loja é para maiores de 18 anos." },
        {
          paragrafo:
            "Não coletamos dados de crianças de propósito. Se isso tiver acontecido, escreva para o endereço acima e apagamos.",
        },
      ],
    },
    {
      ancora: "mudancas",
      titulo: "Mudanças nesta política",
      blocos: [
        { paragrafo: "Quando esta política mudar, a data no topo muda junto." },
        {
          paragrafo:
            "Mudança que amplie o uso dos seus dados só vale depois de um novo consentimento seu.",
        },
      ],
    },
    {
      ancora: "contato",
      titulo: "Contato e ANPD",
      blocos: [
        {
          paragrafo: [
            "Fale com a gente em ",
            { texto: EMAIL, href: `mailto:${EMAIL}` },
            " ou (34) 3226-2600.",
          ],
        },
        {
          paragrafo:
            "Você também pode levar uma reclamação sobre dados pessoais à ANPD, a Autoridade Nacional de Proteção de Dados.",
        },
      ],
    },
  ],
};

/**
 * INGLÊS E ESPANHOL, ESCRITOS NA ONDA 3C. As três regras que governaram a
 * tradução estão na nota longa de ../termos-de-uso/conteudo.ts; aqui vale
 * repetir a que mais pesa nesta página: **a LGPD não é traduzida, é nomeada.**
 *
 * A tentação, num texto de privacidade em inglês, é escrever "GDPR" — e seria
 * falso duas vezes: esta loja não trata dado sob o regulamento europeu, e o
 * catálogo de direitos da LGPD não é o mesmo do GDPR (não há, por exemplo, o
 * direito de "restriction of processing" nos termos do art. 18 europeu). O que
 * o leitor estrangeiro precisa saber é qual lei o protege AQUI. Então a lei
 * aparece pelo nome — LGPD, Lei Geral de Proteção de Dados — com a explicação
 * ao lado, e a ANPD idem.
 *
 * E as duas listas de "Seus direitos" continuam sendo duas: o que se faz
 * sozinho e o que se pede. Promover um pedido a botão numa tradução inventaria
 * uma porta que a tela não tem — o teste ao lado conta as duas listas nos três
 * idiomas exatamente por isso.
 */
const en: ConteudoLegal = {
  meta: {
    titulo: "Privacy policy — Café Canastra",
    descricao:
      "What data the store collects, why, who it is shared with and how you erase yours — starting with what you can do on your own, right now.",
  },
  titulo: "Privacy policy",
  atualizacao: "August 2026",
  secoes: [
    {
      ancora: "controlador",
      titulo: "Who answers for your data",
      blocos: [
        {
          paragrafo:
            "The controller of your data is Boaventura Cafés Especiais Ltda, Rua Nivaldo Guerreiro Nunes, 701, Distrito Industrial, Uberlândia, Minas Gerais, Brazil.",
        },
        {
          paragrafo: [
            "Data subject requests, questions or complaints about personal data: ",
            { texto: EMAIL, href: `mailto:${EMAIL}` },
            ". That is the address that answers.",
          ],
        },
      ],
    },
    {
      ancora: "o-que-coletamos",
      titulo: "What we collect",
      blocos: [
        {
          lista: [
            "Name, e-mail, CPF (the Brazilian taxpayer number) and phone — to issue the nota fiscal, the Brazilian tax invoice, and to talk to you about your order.",
            "Address — to quote shipping and to deliver. It is frozen inside the order, as a photograph of what was agreed that day.",
            "What you put in the bag — so the bag survives between visits and between devices.",
            "The reviews you publish, with the name you choose to display.",
            "Your e-mail, if you sign up for the newsletter in the footer.",
            "Pages viewed and purchase events in Google Analytics 4 — only after you accept in the cookie notice.",
          ],
        },
        {
          paragrafo:
            "We do not ask for your date of birth and we do not store card numbers: the card fields belong to Mercado Pago, and the number never reaches our servers.",
        },
      ],
    },
    {
      ancora: "por-que",
      titulo: "Why we collect it",
      blocos: [
        {
          paragrafo:
            "Every piece of data has a reason, and the reason is what the law calls a legal basis:",
        },
        {
          lista: [
            "To carry out the purchase you asked for — that is the contract between us.",
            "To issue the invoice and keep what Brazilian tax law requires us to keep — that is a legal obligation.",
            "To send news by e-mail and to measure use of the site — that is consent, and you can withdraw it.",
            "To prevent fraud and keep the store safe — that is the store's legitimate interest.",
          ],
        },
        {
          paragrafo:
            "Withdrawing consent for e-mail does not affect your purchases, and it takes effect immediately. Use the form below.",
        },
        { formulario: "descadastro-newsletter" },
        {
          paragrafo:
            "If you delete your account, that e-mail leaves the list along with it — you do not have to ask for both.",
        },
      ],
    },
    {
      ancora: "compartilhamento",
      titulo: "Who we share it with",
      blocos: [
        {
          lista: [
            "Mercado Pago — payment for the order and the recurring charge of the Clube.",
            "Melhor Envio and the carriers — shipping quotes and delivery.",
            "Resend — sending the order status e-mails.",
            "Bling — registering the contact and issuing the nota fiscal for the order.",
            "Google Analytics 4 — usage measurement, only if you accept in the cookie notice.",
          ],
        },
        {
          paragrafo:
            "We do not sell your data to anyone. Beyond those five, we only hand personal data to an authority when there is a legal order requiring it.",
        },
      ],
    },
    {
      ancora: "fora-do-brasil",
      titulo: "Data that leaves Brazil",
      blocos: [
        {
          paragrafo:
            "Two of those services are run by companies outside Brazil: Resend, which sends the e-mails, and Google, which does the measurement.",
        },
        {
          paragrafo:
            "When you receive an e-mail from us, or when you accept measurement, that data is processed outside the country. This is what the law calls an international transfer, and telling you about it is a duty under the LGPD, Brazil's data protection law.",
        },
      ],
    },
    {
      ancora: "onde-ficam",
      titulo: "Where the data lives",
      blocos: [
        {
          paragrafo:
            "The account and the store's database live on our own server, with a self-hosted Supabase — not on a third-party database service.",
        },
        {
          paragrafo:
            "Your password never reaches us: login is handled by GoTrue, and what is stored is a cryptographic digest, not the password.",
        },
      ],
    },
    {
      ancora: "cookies",
      titulo: "Cookies and measurement",
      blocos: [
        {
          paragrafo:
            "We use the cookies needed to keep you signed in and to hold your bag. Without them the store does not work, which is why they are not a choice.",
        },
        {
          paragrafo:
            "Measurement cookies only load if you accept them in the notice that appears on your first visit.",
        },
        {
          paragrafo: [
            "Changed your mind? ",
            { acao: "rever-cookies" },
            " — the notice comes back and measurement stops immediately. Your session and your bag keep working.",
          ],
        },
      ],
    },
    {
      ancora: "seguranca",
      titulo: "Security",
      blocos: [
        {
          paragrafo:
            "The admin panel and the routes that read personal data require a login and administrator permission.",
        },
        {
          paragrafo:
            "Card numbers do not pass through here, and the password is kept only as a cryptographic digest.",
        },
        {
          paragrafo:
            "No system is impregnable. If there is a security incident with relevant risk to you, we notify you and the ANPD.",
        },
      ],
    },
    {
      ancora: "retencao",
      titulo: "How long we keep it",
      blocos: [
        {
          lista: [
            "Account and registration: for as long as the account exists. You close it whenever you want.",
            "Order and nota fiscal: for the legal tax retention period, even after the account is closed — but without your name, CPF, e-mail and address, which are erased from the order.",
            "Clube subscription: cancelled the moment the account is closed, with no penalty.",
            "Newsletter: until you leave the list.",
            "Published review: it stays on the site, signed as Cliente Canastra, without your name.",
          ],
        },
      ],
    },
    {
      ancora: "direitos",
      titulo: "Your rights",
      blocos: [
        {
          paragrafo:
            "The LGPD — Lei Geral de Proteção de Dados, Brazil's data protection law — gives you a set of rights over your data. Below is where each one is exercised, and the difference between clicking and asking matters.",
        },
        { paragrafo: "You do this on your own, right now:" },
        {
          papel: "sozinho",
          lista: [
            [
              "Erase your personal data and close the account — ",
              { texto: "sign in to your account", href: "/account" },
              " and use Close my account, at the bottom of the page. No request, no waiting.",
            ],
            "Leave the newsletter — the form in the Why we collect it section, above.",
            "Review your cookie consent — the Review cookies button, in the Cookies section.",
          ],
        },
        { paragrafo: "You ask by e-mail, and we answer within 15 days:" },
        {
          papel: "pedindo",
          lista: [
            "A copy of everything the store keeps about you, as a file — the right of access and the right to portability, served at once.",
            "Correction of your name, CPF, phone or address.",
            "Erasure of your data from past orders without closing the account.",
            "Knowing who we share data with, and what happens if you do not consent.",
            "Objecting to a specific processing activity.",
          ],
        },
        {
          paragrafo:
            "Some data stays even after an erasure request, where there is a tax obligation: the nota fiscal has a legal retention period.",
        },
      ],
    },
    {
      ancora: "criancas",
      titulo: "Children and adolescents",
      blocos: [
        {
          paragrafo:
            "Buying here means entering into a contract, which is why the store is for people over 18.",
        },
        {
          paragrafo:
            "We do not knowingly collect children's data. If that has happened, write to the address above and we will erase it.",
        },
      ],
    },
    {
      ancora: "mudancas",
      titulo: "Changes to this policy",
      blocos: [
        {
          paragrafo:
            "When this policy changes, the date at the top changes with it.",
        },
        {
          paragrafo:
            "A change that widens the use of your data only takes effect after you consent again.",
        },
      ],
    },
    {
      ancora: "contato",
      titulo: "Contact and the ANPD",
      blocos: [
        {
          paragrafo: [
            "Talk to us at ",
            { texto: EMAIL, href: `mailto:${EMAIL}` },
            " or +55 (34) 3226-2600.",
          ],
        },
        {
          paragrafo:
            "You can also take a complaint about personal data to the ANPD, the Autoridade Nacional de Proteção de Dados — Brazil's national data protection authority.",
        },
      ],
    },
  ],
};

const es: ConteudoLegal = {
  meta: {
    titulo: "Política de privacidad — Café Canastra",
    descricao:
      "Qué datos recoge la tienda, por qué, con quién los comparte y cómo borra los suyos — empezando por lo que usted puede hacer solo, ahora mismo.",
  },
  titulo: "Política de privacidad",
  atualizacao: "agosto de 2026",
  secoes: [
    {
      ancora: "controlador",
      titulo: "Quién responde por sus datos",
      blocos: [
        {
          paragrafo:
            "El controlador de sus datos es Boaventura Cafés Especiais Ltda, Rua Nivaldo Guerreiro Nunes, 701, Distrito Industrial, Uberlândia, Minas Gerais, Brasil.",
        },
        {
          paragrafo: [
            "Solicitud de titular, duda o reclamo sobre datos personales: ",
            { texto: EMAIL, href: `mailto:${EMAIL}` },
            ". Es esa dirección la que responde.",
          ],
        },
      ],
    },
    {
      ancora: "o-que-coletamos",
      titulo: "Qué recogemos",
      blocos: [
        {
          lista: [
            "Nombre, correo, CPF (el número de contribuyente brasileño) y teléfono — para emitir la nota fiscal, la factura fiscal brasileña, y para hablar con usted sobre el pedido.",
            "Dirección — para calcular el flete y entregar. Queda congelada dentro del pedido, como fotografía de lo acordado aquel día.",
            "Lo que usted pone en la bolsa — para que la bolsa sobreviva entre visitas y entre aparatos.",
            "Las reseñas que usted publica, con el nombre que elija mostrar.",
            "Su correo, si se suscribe al boletín del pie de página.",
            "Páginas vistas y eventos de compra en Google Analytics 4 — solo después de que usted acepte en el aviso de cookies.",
          ],
        },
        {
          paragrafo:
            "No pedimos fecha de nacimiento y no guardamos número de tarjeta: los campos de la tarjeta son de Mercado Pago, y el número no llega a nuestros servidores.",
        },
      ],
    },
    {
      ancora: "por-que",
      titulo: "Por qué los recogemos",
      blocos: [
        {
          paragrafo:
            "Cada dato tiene un motivo, y el motivo es lo que la ley llama base legal:",
        },
        {
          lista: [
            "Ejecutar la compra que usted pidió — es el contrato entre nosotros.",
            "Emitir la factura y guardar lo que la legislación fiscal brasileña manda guardar — es una obligación legal.",
            "Mandar novedades por correo y medir el uso del sitio — es consentimiento, y usted puede retirarlo.",
            "Prevenir el fraude y mantener la tienda segura — es el interés legítimo de la tienda.",
          ],
        },
        {
          paragrafo:
            "Retirar el consentimiento del correo no afecta a sus compras, y vale al instante. Es el formulario de abajo.",
        },
        { formulario: "descadastro-newsletter" },
        {
          paragrafo:
            "Si usted elimina la cuenta, ese correo sale de la lista junto — no hace falta pedir las dos cosas.",
        },
      ],
    },
    {
      ancora: "compartilhamento",
      titulo: "Con quién los compartimos",
      blocos: [
        {
          lista: [
            "Mercado Pago — pago del pedido y el cobro recurrente del Clube.",
            "Melhor Envio y los transportistas — cálculo del flete y entrega.",
            "Resend — envío de los correos de estado del pedido.",
            "Bling — registro del contacto y emisión de la nota fiscal del pedido.",
            "Google Analytics 4 — medición de uso, solo si usted acepta en el aviso de cookies.",
          ],
        },
        {
          paragrafo:
            "No vendemos sus datos a nadie. Además de esos cinco, solo entregamos datos personales a una autoridad cuando existe una orden legal que obligue.",
        },
      ],
    },
    {
      ancora: "fora-do-brasil",
      titulo: "Datos que salen de Brasil",
      blocos: [
        {
          paragrafo:
            "Dos de esos servicios los operan empresas de fuera de Brasil: Resend, que envía los correos, y Google, que hace la medición.",
        },
        {
          paragrafo:
            "Cuando usted recibe un correo nuestro, o cuando acepta la medición, esos datos se tratan fuera del país. Es lo que la ley llama transferencia internacional, y avisarlo es un deber de la LGPD, la ley brasileña de protección de datos.",
        },
      ],
    },
    {
      ancora: "onde-ficam",
      titulo: "Dónde están los datos",
      blocos: [
        {
          paragrafo:
            "La cuenta y la base de datos de la tienda están en servidor propio, con Supabase autoalojado — no en un servicio de base de datos de terceros.",
        },
        {
          paragrafo:
            "La contraseña nunca llega hasta nosotros: de la autenticación se encarga GoTrue, y lo que queda guardado es un resumen criptográfico, no la contraseña.",
        },
      ],
    },
    {
      ancora: "cookies",
      titulo: "Cookies y medición",
      blocos: [
        {
          paragrafo:
            "Usamos cookies necesarias para mantenerlo conectado y guardar la bolsa. Sin ellas la tienda no funciona, y por eso no dependen de elección.",
        },
        {
          paragrafo:
            "Las cookies de medición solo entran si usted las acepta en el aviso que aparece en la primera visita.",
        },
        {
          paragrafo: [
            "¿Cambió de idea? ",
            { acao: "rever-cookies" },
            " — el aviso vuelve a aparecer y la medición para al instante. La sesión y la bolsa siguen funcionando.",
          ],
        },
      ],
    },
    {
      ancora: "seguranca",
      titulo: "Seguridad",
      blocos: [
        {
          paragrafo:
            "El panel administrativo y las rutas que leen datos personales exigen acceso y permiso de administrador.",
        },
        {
          paragrafo:
            "El número de la tarjeta no pasa por aquí, y la contraseña queda solo como resumen criptográfico.",
        },
        {
          paragrafo:
            "Ningún sistema es inviolable. Si hay un incidente de seguridad con riesgo relevante para usted, se lo comunicamos a usted y a la ANPD.",
        },
      ],
    },
    {
      ancora: "retencao",
      titulo: "Por cuánto tiempo los guardamos",
      blocos: [
        {
          lista: [
            "Cuenta y registro: mientras la cuenta exista. Usted la cierra cuando quiera.",
            "Pedido y nota fiscal: por el plazo legal de guarda fiscal, incluso después de cerrada la cuenta — pero sin su nombre, CPF, correo y dirección, que se borran del pedido.",
            "Suscripción del Clube: cancelada en el momento en que se cierra la cuenta, sin multa.",
            "Boletín: hasta que usted salga de la lista.",
            "Reseña publicada: sigue en el sitio, firmada como Cliente Canastra, sin su nombre.",
          ],
        },
      ],
    },
    {
      ancora: "direitos",
      titulo: "Sus derechos",
      blocos: [
        {
          paragrafo:
            "La LGPD — Lei Geral de Proteção de Dados, la ley brasileña de protección de datos — le da un conjunto de derechos sobre sus datos. Abajo está dónde se ejerce cada uno, y la diferencia entre hacer clic y pedir importa.",
        },
        { paragrafo: "Usted lo hace solo, ahora mismo:" },
        {
          papel: "sozinho",
          lista: [
            [
              "Borrar sus datos personales y cerrar la cuenta — ",
              { texto: "entre en su cuenta", href: "/account" },
              " y use Cerrar mi cuenta, al final de la página. No hace falta pedir ni esperar.",
            ],
            "Salir de la lista de novedades — el formulario de la sección Por qué los recogemos, arriba.",
            "Revisar el consentimiento de cookies — el botón Revisar cookies, en la sección Cookies.",
          ],
        },
        { paragrafo: "Usted lo pide por correo, y respondemos en hasta 15 días:" },
        {
          papel: "pedindo",
          lista: [
            "Una copia de todo lo que la tienda guarda sobre usted, en archivo — el derecho de acceso y el de portabilidad, atendidos de una vez.",
            "Corrección de nombre, CPF, teléfono o dirección.",
            "Borrar sus datos de los pedidos antiguos sin cerrar la cuenta.",
            "Saber con quién compartimos y qué pasa si usted no consiente.",
            "Oponerse a un tratamiento específico.",
          ],
        },
        {
          paragrafo:
            "Algunos datos quedan incluso después de una solicitud de eliminación, cuando hay obligación fiscal: la nota fiscal tiene plazo legal de guarda.",
        },
      ],
    },
    {
      ancora: "criancas",
      titulo: "Niños y adolescentes",
      blocos: [
        {
          paragrafo:
            "Comprar aquí es firmar un contrato, y por eso la tienda es para mayores de 18 años.",
        },
        {
          paragrafo:
            "No recogemos datos de niños a propósito. Si eso ha ocurrido, escriba a la dirección de arriba y los borramos.",
        },
      ],
    },
    {
      ancora: "mudancas",
      titulo: "Cambios en esta política",
      blocos: [
        {
          paragrafo:
            "Cuando esta política cambie, la fecha del encabezado cambia junto.",
        },
        {
          paragrafo:
            "Un cambio que amplíe el uso de sus datos solo vale después de un nuevo consentimiento suyo.",
        },
      ],
    },
    {
      ancora: "contato",
      titulo: "Contacto y ANPD",
      blocos: [
        {
          paragrafo: [
            "Hable con nosotros en ",
            { texto: EMAIL, href: `mailto:${EMAIL}` },
            " o +55 (34) 3226-2600.",
          ],
        },
        {
          paragrafo:
            "Usted también puede llevar un reclamo sobre datos personales a la ANPD, la Autoridade Nacional de Proteção de Dados — la autoridad brasileña de protección de datos.",
        },
      ],
    },
  ],
};

export const PRIVACIDADE: Record<Locale, ConteudoLegal> = { pt, en, es };

/** A cláusula de prevalência — a nota está em ../termos-de-uso/conteudo.ts. */
export const AVISO_DE_TRADUCAO: Record<Exclude<Locale, "pt">, string> = {
  en: "This is a translation provided for convenience. The Portuguese version is the one that legally applies, and the purchase is governed by Brazilian law.",
  es: "Esta es una traducción de cortesía. La versión en portugués es la que rige legalmente, y la compra se rige por la ley brasileña.",
};

/**
 * O aviso jurídico em `en` e `es`, porque o `<AvisoJuridico>` compartilhado é
 * fixo em português e PaginaTexto.tsx é de outro dono nesta onda. Ver a nota
 * completa em ../termos-de-uso/conteudo.ts — os dois documentos carregam o
 * mesmo aviso pela mesma razão, e o duplicam pelo mesmo motivo que já
 * duplicavam o aviso anterior: são duas páginas independentes.
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

/** As listas de um papel específico dentro de uma seção. */
export function listasCom(secao: Secao, papel: "sozinho" | "pedindo"): Paragrafo[] {
  return secao.blocos.flatMap((b) => ("lista" in b && b.papel === papel ? b.lista : []));
}

/** Os parágrafos de uma seção, na ordem, sem distinguir texto solto de lista. */
export function paragrafosDa(secao: Secao): Paragrafo[] {
  return secao.blocos.flatMap((b) => {
    if ("lista" in b) return b.lista;
    if ("paragrafo" in b) return [b.paragrafo];
    return [];
  });
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
            return "";
          })
          .join("");

  return [secao.titulo, ...paragrafosDa(secao).map(achatar)].join(" ");
}
