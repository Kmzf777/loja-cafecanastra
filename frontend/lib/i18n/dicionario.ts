import { type Locale } from "./tipos";

/**
 * O dicionário de interface da vitrine.
 *
 * A TRAVA ESTÁ NO TIPO, E É A RAZÃO DESTE ARQUIVO EXISTIR ASSIM. O objeto `pt`
 * é a fonte da verdade: `Dicionario` é `typeof pt`, e `en`/`es` são DECLARADOS
 * como `Dicionario`. Faltou uma chave, o TypeScript quebra o build — e é essa
 * quebra que impede uma tradução esquecida de virar `undefined` na tela do
 * cliente. Um `Record<string, string>` aceitaria qualquer coisa e o erro só
 * apareceria em produção, em inglês, numa página que ninguém revisita.
 *
 * ACESSO POR PROPRIEDADE, NUNCA POR STRING. `d.nav.cafes`, jamais
 * `t("nav.cafes")`: com a string, o compilador não verifica nada e a trava
 * acima vira decoração.
 *
 * O QUE ENTRA AQUI: navegação, rótulos de interface repetidos e o aviso de que
 * a compra segue em português. O que NÃO entra: o editorial dos cafés (vive em
 * data/catalogo-canastra.i18n.json, indexado por slug) e o texto corrido das
 * páginas institucionais, que é conteúdo e não rótulo.
 *
 * IMPORTS RELATIVOS, não `@/`: o vitest.config.ts não resolve o alias.
 */

const pt = {
  /**
   * A faixa preta acima do cabeçalho. Duas promessas e nada mais — é a
   * primeira coisa que qualquer visitante lê, em qualquer idioma, e era a
   * única superfície da moldura que continuava em português depois do i18n.
   */
  barra: {
    torradoSobDemanda: "Torrado sob demanda",
    /** Vem colado ao valor formatado: "Frete grátis acima de R$ 149". */
    freteGratisAcimaDe: "Frete grátis acima de",
  },

  nav: {
    /** Rótulo do landmark <nav>, não um link. Aparece só para leitor de tela. */
    principal: "Principal",
    cafes: "Cafés",
    assinatura: "Assinatura",
    aSerra: "A Serra",
    historia: "História",
    /**
     * `bio` e `abrirMenu` SAÍRAM na Onda 4, e a remoção é a regra da casa:
     * chave sem consumidor é promessa de um elemento de tela que não existe.
     *
     * `nav.bio` foi reservado para um item de menu apontando para `/bio`, e a
     * `/bio` não entra na navegação — é endereço de perfil de Instagram,
     * alcançado por link direto, e um quinto item espremeria a barra. Ela está
     * no sitemap, que é onde faz diferença.
     *
     * `nav.abrirMenu` era o `aria-label` do botão do acordeão. O botão passou a
     * ter nome acessível vindo do texto visível, que troca de "Menu" para
     * "Fechar" quando o painel abre — um rótulo fixo em "Abrir menu" mentia na
     * metade dos estados.
     */
    menu: "Menu",
    fechar: "Fechar",
    buscar: "Buscar cafés",
    buscarNoMenu: "Buscar cafés (menu)",
    /**
     * DUAS FORMAS PARA A MESMA PORTA, e a razão é largura. `conta` é o rótulo
     * visível na barra, onde cada pixel disputa com a navegação e a busca;
     * `minhaConta` é o nome acessível, que não ocupa espaço e pode ser
     * inequívoco. "CONTA" sozinho, lido em voz alta no meio de uma lista de
     * links, não diz de quem é a conta.
     */
    conta: "Conta",
    minhaConta: "Minha conta",
    sacola: "Sacola",
    sacolaVazia: "Sacola vazia",
  },

  rodape: {
    colunaCafes: "Cafés",
    todosOsCafes: "Todos os cafés",
    colunaAssinatura: "Assinatura",
    clubeDaCanastra: "Clube da Canastra",
    comoFunciona: "Como funciona",
    colunaCanastra: "A Canastra",
    aSerra: "A serra",
    asLinhas: "As linhas",
    aTorra: "A torra",
    /**
     * A coluna do rodapé tem rótulo próprio, separado de `nav.historia`: no
     * cabeçalho o item concorre com três vizinhos e precisa ser curto; aqui
     * ele convive com "A serra" e "As linhas", que são sintagmas nominais.
     * Em inglês a diferença é visível — "Our story" na navegação, "The story"
     * na coluna, para não repetir o possessivo três linhas abaixo de "The
     * serra".
     */
    historia: "A história",
    colunaAjuda: "Ajuda",
    termosDeUso: "Termos de uso",
    politicaDePrivacidade: "Política de privacidade",
    rastreabilidade: "Rastreabilidade",
  },

  comum: {
    verOsCafes: "Ver os cafés",
    verTodosOsCafes: "Ver todos os cafés",
    irParaOsCafes: "Ir para os cafés",
    conhecerASerra: "Conhecer a serra",
    comecarAssinatura: "Começar assinatura",
    voltarAoInicio: "Voltar ao início",
    limparTudo: "Limpar tudo",
    limparFiltros: "Limpar filtros",
    aPartirDe: "a partir de",
    esgotado: "Esgotado",
    /**
     * Linha SEM NENHUM preço na loja — não é o mesmo que esgotado, e a
     * diferença importa: esgotado é "voltará", indisponível é "não há como
     * comprar isto aqui". É o caso real da Canela, cujos únicos formatos
     * capturados são drip e cápsula, ambos sem preço.
     */
    indisponivel: "Indisponível",
    /** Prefixo da data das páginas institucionais: "Atualizado em agosto de 2026". */
    atualizadoEm: "Atualizado em",
    /** Contagem de lotes na PLP e na home: "12 lotes", "1 lote". */
    lote: "lote",
    lotes: "lotes",
    /** Contagem da sacola no rótulo acessível: "Sacola · 3 itens". */
    item: "item",
    itens: "itens",
  },

  /**
   * O aviso da fronteira do i18n — spec §1, "A fronteira, dita na cara".
   *
   * Existe por honestidade operacional, não por preguiça de tradução: o frete é
   * Melhor Envio (só Brasil) e o pagamento é Mercado Pago BR. Traduzir o
   * checkout sem resolver esses dois seria prometer uma compra que a loja não
   * consegue entregar. O aviso é onde essa decisão encara o cliente.
   */
  compra: {
    avisoTitulo: "A compra segue em português.",
    avisoTexto:
      "Sacola, checkout e conta existem só em português. Enviamos para o Brasil, e o pagamento é em real.",
  },

  /**
   * O aviso de cookies e o botão que o desfaz.
   *
   * ELE APARECE EM TODA PRIMEIRA VISITA, em qualquer idioma, e é um pedido de
   * consentimento: um consentimento que a pessoa não consegue ler não é
   * consentimento. Era a maior string em português da moldura.
   */
  cookies: {
    aviso: "Aviso de cookies",
    texto:
      "Usamos cookies de medição para entender o que funciona na loja. Os essenciais — sessão e sacola — ficam de qualquer jeito.",
    soOEssencial: "Só o essencial",
    aceitar: "Aceitar",
    rever: "Rever cookies",
  },

  /** A newsletter do rodapé (estetica.md §5.10). */
  newsletter: {
    titulo: "Novidades",
    /** Sem promessa de cadência: prometer frequência viraria dívida. */
    chamada: "Café novo e o que acontece na serra, no seu e-mail.",
    email: "E-mail",
    /** Exemplo dentro do campo. Muda de idioma porque "seu@" é português. */
    exemploDeEmail: "seu@email.com",
    assinar: "Assinar",
    enviando: "Enviando…",
    obrigado: "Pronto. Seu e-mail está na lista.",
    emailInvalido: "Confira o e-mail digitado.",
    falhou: "Não deu agora. Tente de novo em instantes.",
    /**
     * O formulário de saída da lista, que vive DENTRO da Política de
     * privacidade. É o exercício de um direito da LGPD: a pessoa tem de
     * entender o que está fazendo no idioma em que está lendo a política.
     */
    sairTexto:
      "Digite o e-mail que você cadastrou e ele sai da lista de novidades. Os avisos sobre os seus pedidos continuam chegando.",
    sairBotao: "Sair da lista",
    sairPronto: "Pronto. Esse e-mail não está mais na lista de novidades.",
  },
};

/**
 * SEM `as const` NO OBJETO ACIMA, e isso é deliberado: com ele, cada valor
 * viraria o seu próprio tipo literal (`"Cafés"`, e não `string`) e o `en` só
 * compilaria se repetisse o português para sempre. O que se quer travar é o
 * conjunto de CHAVES, não o texto.
 */
export type Dicionario = typeof pt;

/**
 * O QUE NÃO SE TRADUZ, EM IDIOMA NENHUM: `Café Canastra`, `Serra da Canastra`,
 * `Canastra`, `Clube da Canastra`, os nomes das linhas (Clássico, Suave,
 * Canela, Microlote, Néctar de Minas) e `Pix`. São nome próprio de produto —
 * traduzi-los desliga o reconhecimento da marca e quebra a busca de quem
 * chega pelo rótulo do pacote.
 *
 * O VOCABULÁRIO DE CAFÉ É O DA INDÚSTRIA, não o do dicionário bilíngue: em
 * grãos = whole bean / en grano; moído = ground / molido; torra = roast /
 * tueste; lote = lot / lote. É como uma torrefação de especialidade escreve, e
 * é o que o leitor estrangeiro procura.
 *
 * AS CHAVES ESTÃO ESCRITAS POR EXTENSO, e não espalhadas com `...pt`: um
 * espalhamento deixaria a chave esquecida herdar o português em silêncio, que
 * é exatamente o defeito que `dicionario.test.ts` existe para pegar. O tipo
 * cobra a chave; o teste ao lado cobra que o valor não seja o português.
 */
const en: Dicionario = {
  barra: {
    /** `Roasted to order` é como uma torrefação escreve; `on demand` é jargão de nuvem. */
    torradoSobDemanda: "Roasted to order",
    freteGratisAcimaDe: "Free shipping over",
  },
  nav: {
    principal: "Main",
    cafes: "Coffees",
    assinatura: "Subscription",
    /**
     * `The Serra`, e não `The Range`: é o mesmo nome que a própria página usa
     * no título (`a-serra/conteudo.ts`), e `Serra` sobrevive como parte de
     * `Serra da Canastra`. Rótulo de navegação que discorda do título da
     * página de destino faz a pessoa achar que clicou errado.
     */
    aSerra: "The Serra",
    historia: "Our story",
    menu: "Menu",
    fechar: "Close",
    buscar: "Search coffees",
    buscarNoMenu: "Search coffees (menu)",
    conta: "Account",
    minhaConta: "My account",
    /** `Bag`, não `Cart`: a loja chama de sacola, e o gesto é o mesmo. */
    sacola: "Bag",
    sacolaVazia: "Empty bag",
  },
  rodape: {
    colunaCafes: "Coffees",
    todosOsCafes: "All coffees",
    colunaAssinatura: "Subscription",
    clubeDaCanastra: "Clube da Canastra",
    comoFunciona: "How it works",
    colunaCanastra: "Canastra",
    aSerra: "The serra",
    asLinhas: "The lines",
    aTorra: "The roast",
    /** Ver a nota do `pt`: aqui é "The story", não "Our story". */
    historia: "The story",
    colunaAjuda: "Help",
    termosDeUso: "Terms of use",
    politicaDePrivacidade: "Privacy policy",
    rastreabilidade: "Traceability",
  },
  comum: {
    verOsCafes: "Browse the coffees",
    verTodosOsCafes: "Browse all coffees",
    irParaOsCafes: "Go to the coffees",
    conhecerASerra: "Get to know the serra",
    comecarAssinatura: "Start a subscription",
    voltarAoInicio: "Back to home",
    limparTudo: "Clear all",
    limparFiltros: "Clear filters",
    aPartirDe: "from",
    esgotado: "Sold out",
    indisponivel: "Unavailable",
    /** Sem preposição: em inglês a data segue direto — "Updated August 2026". */
    atualizadoEm: "Updated",
    /** `lot`, o termo da indústria — não `batch`. */
    lote: "lot",
    lotes: "lots",
    item: "item",
    itens: "items",
  },
  compra: {
    avisoTitulo: "Checkout is in Portuguese.",
    /**
     * `Brazilian reais` e não só `reais`: quem lê em inglês precisa da moeda
     * nomeada para saber o que vai ser cobrado. Não é dado novo — é o mesmo
     * fato do português, dito para quem não mora aqui.
     */
    avisoTexto:
      "Bag, checkout and account exist only in Portuguese. We ship to Brazil, and payment is in Brazilian reais.",
  },
  cookies: {
    aviso: "Cookie notice",
    texto:
      "We use measurement cookies to understand what works in the shop. The essential ones — session and bag — stay either way.",
    soOEssencial: "Essential only",
    aceitar: "Accept",
    rever: "Review cookies",
  },
  newsletter: {
    titulo: "News",
    chamada: "New coffee and what happens up on the serra, in your inbox.",
    email: "Email",
    exemploDeEmail: "you@email.com",
    assinar: "Subscribe",
    enviando: "Sending…",
    obrigado: "Done. Your email is on the list.",
    emailInvalido: "Check the email you typed.",
    falhou: "That did not work. Try again in a moment.",
    sairTexto:
      "Type the email you signed up with and it leaves the news list. Notices about your orders keep coming.",
    sairBotao: "Leave the list",
    sairPronto: "Done. That email is no longer on the news list.",
  },
};

const es: Dicionario = {
  barra: {
    torradoSobDemanda: "Tostado bajo pedido",
    freteGratisAcimaDe: "Envío gratis desde",
  },
  nav: {
    principal: "Principal",
    cafes: "Cafés",
    assinatura: "Suscripción",
    aSerra: "La Serra",
    historia: "Historia",
    menu: "Menú",
    fechar: "Cerrar",
    buscar: "Buscar cafés",
    buscarNoMenu: "Buscar cafés (menú)",
    conta: "Cuenta",
    minhaConta: "Mi cuenta",
    sacola: "Bolsa",
    sacolaVazia: "Bolsa vacía",
  },
  rodape: {
    colunaCafes: "Cafés",
    todosOsCafes: "Todos los cafés",
    colunaAssinatura: "Suscripción",
    clubeDaCanastra: "Clube da Canastra",
    comoFunciona: "Cómo funciona",
    colunaCanastra: "La Canastra",
    aSerra: "La serra",
    asLinhas: "Las líneas",
    aTorra: "El tueste",
    historia: "La historia",
    colunaAjuda: "Ayuda",
    termosDeUso: "Términos de uso",
    politicaDePrivacidade: "Política de privacidad",
    rastreabilidade: "Trazabilidad",
  },
  comum: {
    verOsCafes: "Ver los cafés",
    verTodosOsCafes: "Ver todos los cafés",
    irParaOsCafes: "Ir a los cafés",
    conhecerASerra: "Conocer la serra",
    comecarAssinatura: "Empezar la suscripción",
    voltarAoInicio: "Volver al inicio",
    limparTudo: "Borrar todo",
    limparFiltros: "Borrar filtros",
    aPartirDe: "desde",
    esgotado: "Agotado",
    indisponivel: "No disponible",
    atualizadoEm: "Actualizado en",
    lote: "lote",
    lotes: "lotes",
    item: "artículo",
    itens: "artículos",
  },
  compra: {
    avisoTitulo: "La compra sigue en portugués.",
    avisoTexto:
      "La bolsa, el checkout y la cuenta solo existen en portugués. Enviamos a Brasil y el pago es en reales brasileños.",
  },
  cookies: {
    aviso: "Aviso sobre cookies",
    texto:
      "Usamos cookies de medición para entender qué funciona en la tienda. Las esenciales — la sesión y la bolsa — se quedan de todos modos.",
    soOEssencial: "Solo lo esencial",
    aceitar: "Aceptar",
    rever: "Revisar cookies",
  },
  newsletter: {
    titulo: "Novedades",
    chamada: "Café nuevo y lo que pasa en la sierra, en su correo.",
    email: "Correo electrónico",
    exemploDeEmail: "su@email.com",
    assinar: "Suscribirse",
    /** Mesma palavra nas duas línguas — declarado no dicionario.test.ts. */
    enviando: "Enviando…",
    obrigado: "Listo. Su correo ya está en la lista.",
    emailInvalido: "Revise el correo que escribió.",
    falhou: "Ahora no funcionó. Inténtelo de nuevo en un momento.",
    sairTexto:
      "Escriba el correo con el que se registró y sale de la lista de novedades. Los avisos sobre sus pedidos siguen llegando.",
    sairBotao: "Salir de la lista",
    sairPronto: "Listo. Ese correo ya no está en la lista de novedades.",
  },
};

const DICIONARIOS: Record<Locale, Dicionario> = { pt, en, es };

/**
 * O dicionário de um idioma. Função e não objeto exportado direto para que o
 * chamador não consiga escrever `DICIONARIOS[qualquerString]` e receber
 * `undefined` — `Locale` já passou pelo `ehLocale` do layout antes de chegar
 * aqui.
 */
export function dicionario(locale: Locale): Dicionario {
  return DICIONARIOS[locale];
}
