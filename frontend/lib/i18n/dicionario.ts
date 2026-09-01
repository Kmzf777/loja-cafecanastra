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

    /**
     * OS RÓTULOS DAS TRÊS SEÇÕES DE VENDA DA HOME, e eles moram no dicionário
     * — não num `conteudo.ts` de página — porque cada um aparece DUAS VEZES:
     * como título da seção na home e como rótulo do chip do filtro na PLP,
     * quando alguém clica em "Ver mais". Duas superfícies, um texto só.
     *
     * `maisVendidos` É AFIRMAÇÃO EDITORIAL, NÃO DADO DE PEDIDO. A ordem sai da
     * curadoria de data/catalogo-canastra.json, que a casa edita à mão. Está
     * documentado em lib/catalogo/curadoria.ts e no §6.1 do spec; o rótulo
     * aparece aqui só porque é texto de tela.
     */
    maisVendidos: "Mais vendidos",
    nossosKits: "Nossos kits",
    escolhaDoProdutor: "Escolha do produtor",

    /** O 7º card de todo carrossel de produto — leva à PLP filtrada. */
    verMais: "Ver mais",

    /**
     * A trilha logo abaixo da faixa de prova. `maisCategorias` é o último item
     * dela e leva à PLP inteira, sem filtro — por isso não é "Ver mais": ele
     * não continua uma lista, ele abre o catálogo.
     */
    categorias: "Categorias",
    maisCategorias: "+ Categorias",

    /**
     * O ANÚNCIO DE `aria-live` E O AVISO DE TETO, EM VERSÃO GENÉRICA.
     *
     * `venda.kit.adicionado` e `venda.kit.noTeto` já dizem estas duas coisas,
     * mas dizem "kit" — e o `CardProduto` vende PACOTE. Reusar aquelas chaves
     * faria quem usa leitor de tela ouvir "Kit adicionado à sacola" depois de
     * pôr 250 g de café moído no carrinho. As do kit continuam onde estão,
     * porque lá a palavra está certa.
     */
    adicionadoASacola: "Produto adicionado à sacola",
    noTetoDoEstoque: "Você já tem o máximo disponível deste item na sacola.",

    irParaOsCafes: "Ir para os cafés",
    conhecerASerra: "Conhecer a serra",
    comecarAssinatura: "Começar assinatura",
    voltarAoInicio: "Voltar ao início",
    limparTudo: "Limpar tudo",
    limparFiltros: "Limpar filtros",
    aPartirDe: "a partir de",
    /**
     * AS TRÊS PALAVRAS DO PREÇO "DE/POR" — e elas existem só para o leitor de
     * tela.
     *
     * Na tela, o riscado e o número em destaque já dizem tudo, e escrever "de"
     * ao lado de um preço riscado seria repetir com palavra o que a forma já
     * comunica. Mas `<s>` não é anunciado de forma confiável por leitor de
     * tela nenhum, e "R$ 60,00 R$ 54,00" sem preposição é a leitura de um
     * preço de cento e catorze reais. Por isso `<Preco>` esconde os números e
     * põe a frase inteira num `sr-only` montado com estas chaves.
     */
    precoDe: "de",
    precoPor: "por",
    /** Vem depois do número: "10% de desconto". */
    desconto: "de desconto",
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
    /**
     * O `alt` do lockup do logotipo — cabeçalho e rodapé.
     *
     * ERA A ÚNICA IMAGEM DA MOLDURA QUE CONTINUAVA EM PORTUGUÊS EM /en E /es.
     * A justificativa antiga ("o `alt` descreve o que está impresso, e a
     * embalagem não muda de idioma") trocava DESCRIÇÃO por TRANSCRIÇÃO: o
     * `alt` não é a legenda do desenho, é o que a pessoa que não enxerga a
     * imagem ouve — e ela ouve no idioma da página que está lendo. No rodapé
     * a marca aparece FORA de link, e lá este texto é o único que existe (no
     * cabeçalho o `aria-label` do link já cobre o nome acessível).
     */
    logoAlt: "Logotipo do Café Canastra, desde 1985",
    /**
     * O nome acessível e o tooltip do botão flutuante de WhatsApp. É o único
     * texto daquele botão, e ele acompanha a moldura inteira — inclusive /en
     * e /es. `WhatsApp` é nome próprio e não se traduz.
     */
    falarNoWhatsApp: "Falar com a gente no WhatsApp",
  },

  /**
   * O VOCABULÁRIO DO CATÁLOGO — e ele estava preso em português até aqui.
   *
   * As tabelas de `lib/catalogo/tipos.ts` e `lib/catalogo/rotulos.ts` guardavam
   * `{ valor, rotulo }` com UM rótulo só, em português, e alimentavam os
   * filtros da PLP, os chips, a escala de torra e a ficha da PDP em QUALQUER
   * idioma. Era por isso que `/en/cafes` mostrava "Menor preço" e "Torra
   * escura" — e não havia como consertar sem duplicar texto dentro de cada
   * componente.
   *
   * A REGRA PASSOU A SER UMA SÓ: a tabela guarda o VALOR, este dicionário
   * guarda o TEXTO, e a chave do texto é o próprio valor do contrato —
   * `catalogo.moagem.grao`, `catalogo.formato.capsula`, `catalogo.ordenacao
   * ["preco-asc"]`. Quem tem o valor na mão sabe onde está o rótulo sem
   * procurar, e é a mesma leitura `d.alguma.coisa` do resto do dicionário.
   *
   * AS EXCEÇÕES SÃO AS DE CHAVE ABERTA, e por isso passam por função em
   * rotulos.ts: a nota de sabor (`rotuloNota`) chega do editorial já no idioma
   * do texto — `melaco` em pt, `molasses` em en —, o ponto de torra
   * (`rotuloPontoTorra`) pode chegar fora da escala pela querystring, e o
   * rótulo de embalagem e o atributo da marca (`rotuloDaEmbalagem`,
   * `rotuloDoAtributo`) chegam do JSON de catálogo, que TypeScript nenhum lê.
   * Todas precisam de um fallback que uma leitura direta não tem.
   */
  catalogo: {
    /**
     * NOME PRÓPRIO, IGUAL NOS TRÊS IDIOMAS: é o que está impresso no pacote
     * que chega na casa da pessoa, e traduzir desliga o reconhecimento da
     * marca e a busca de quem chega pelo rótulo. Fica AQUI, e não numa tabela
     * sem idioma, porque `Lote.nome` já é traduzível pelo editorial
     * (data/catalogo-canastra.i18n.json) — o dia em que uma linha nova tiver
     * nome traduzível, o lugar de dizer isso já existe. Cada uma das cinco
     * está declarada em `IGUAIS_DE_PROPOSITO` no teste ao lado.
     */
    linha: {
      classico: "Clássico",
      suave: "Suave",
      canela: "Canela",
      microlote: "Microlote",
      "nectar-de-minas": "Néctar de Minas",
    },

    /** estetica.md §5.3 — a escala 1-5 SEMPRE acompanhada do texto, nunca só a barra. */
    pontoTorra: {
      1: "Torra clara",
      2: "Torra clara-média",
      3: "Torra média",
      4: "Torra média-escura",
      5: "Torra escura",
    },

    /**
     * AS DUAS PONTAS DA RÉGUA DO <PontoTorra>, que são outra coisa que a
     * tabela acima: `pontoTorra` nomeia CADA degrau ("Torra média"), `escala`
     * rotula o EIXO em que os degraus se distribuem — o "Clara" à esquerda, o
     * "Escura" à direita, e o "de 5" que diz de que tamanho é a régua.
     *
     * Estavam cravadas em português dentro do componente, que já recebia o
     * `locale` e já o usava para o degrau: em /en a torra dizia "Dark roast" e
     * a régua ao lado dela dizia "Clara · Escura · 5 de 5". O mesmo português
     * ia no `aria-label` de todo card da home, da PLP e do bloco da PDP.
     *
     * O "5" mora DENTRO do texto porque a escala é fixa em cinco pela própria
     * assinatura de `Lote.pontoTorra` (1 | 2 | 3 | 4 | 5). Costurar número e
     * preposição no componente sairia mais barato em português e erraria na
     * primeira língua que pusesse os dois em outra ordem.
     */
    escala: {
      clara: "Clara",
      escura: "Escura",
      deCinco: "de 5",
    },

    /**
     * O vocabulário de prova de xícara, chaveado pela CHAVE CANÔNICA EM
     * PORTUGUÊS — a mesma que `data/catalogo-canastra.json` grava em kebab-case
     * sem acento, porque ela é chave de filtro e de busca antes de ser texto.
     *
     * O editorial traduzido grava a nota já no idioma dele (`molasses`,
     * `melaza`), e essas chaves não estão aqui de propósito: `rotuloNota()`
     * capitaliza o que não encontra, e é assim que "molasses" vira "Molasses"
     * numa página em inglês em vez de cair no português. O que ESTA tabela
     * resolve é o caminho contrário, que era o defeito real — a chave em
     * português alcançada numa página em inglês devolvia "Melaço", com
     * cedilha, na ficha de quem não lê português.
     */
    nota: {
      "castanha-do-para": "Castanha-do-pará",
      "doce-de-leite": "Doce de leite",
      "amendoim-torrado": "Amendoim torrado",
      "chocolate-meio-amargo": "Chocolate meio amargo",
      "laranja-da-terra": "Laranja-da-terra",
      "milho-torrado": "Milho torrado",
      amadeirado: "Amadeirado",
      especiarias: "Especiarias",
      chocolate: "Chocolate",
      castanha: "Castanha",
      jabuticaba: "Jabuticaba",
      caramelo: "Caramelo",
      melaco: "Melaço",
      citrico: "Cítrico",
      frutado: "Frutado",
      floral: "Floral",
      amendoa: "Amêndoa",
      pessego: "Pêssego",
      baunilha: "Baunilha",
      rapadura: "Rapadura",
      cacau: "Cacau",
      canela: "Canela",
      cravo: "Cravo",
      doce: "Doçura",
      cana: "Cana",
      mel: "Mel",
    },

    /** O que se COMPRA — dois valores, porque a loja vende dois (§5.5). */
    moagem: {
      grao: "Grão",
      moido: "Moído",
    },

    /**
     * A ESPESSURA DA MOAGEM DE CADA RECEITA, que não é o mesmo eixo do
     * `moagem` acima: lá é o que se compra (grão ou moído), aqui é quão fino
     * se mói para aquele método — a linha "MOAGEM  Média" do cartão de
     * preparo (estetica.md §7.3).
     *
     * ELA ENTRA NO DICIONÁRIO PELA PORTA DOS FUNDOS, e isso está declarado:
     * `Preparo.moagem` é `string` livre em `lib/catalogo/produtos.ts`, escrita
     * em português junto da receita. A PDP normaliza aquele texto para a chave
     * daqui e cai no original quando não reconhece — nunca em vazio. O lugar
     * certo de consertar é o tipo, trocando a string livre por estes quatro
     * valores; enquanto isso não acontece, é esta ponte que impede um "Grossa"
     * de aparecer no meio de uma página em inglês.
     */
    moagemDaReceita: {
      fina: "Fina",
      "media-fina": "Média-fina",
      media: "Média",
      grossa: "Grossa",
    },

    /** Como se PREPARA — a seção "Como preparar" da PDP, que é receita. */
    metodo: {
      espresso: "Espresso",
      "coado-papel": "Coado (papel)",
      "coador-pano": "Coador de pano",
      "prensa-francesa": "Prensa francesa",
      "italiana-moka": "Italiana / Moka",
      aeropress: "Aeropress",
    },

    /** O filtro "Formato" da PLP — o eixo de variação verdadeiro do catálogo. */
    formato: {
      graos: "Em grãos",
      moido: "Moído",
      /** Nome do produto na caixa da loja, nos três idiomas. */
      drip: "Drip Coffee",
      capsula: "Cápsulas",
    },

    /**
     * O RÓTULO DA EMBALAGEM — treze valores fechados, e é por serem fechados
     * que eles estão AQUI e não no editorial traduzido por linha.
     *
     * "Pacote com 250 g" se repete em cinco SKUs; "3 caixas — 30 cápsulas" em
     * dois. Traduzir por SKU seria escrever a mesma frase dezenas de vezes em
     * dois idiomas, e o dia em que uma delas ficasse para trás ninguém
     * notaria — JSON não tem compilador. Chaveado por `rotuloChave`
     * (data/catalogo-canastra.json), o rótulo ganha a trava do dicionário:
     * chave faltando quebra o build.
     *
     * O PORTUGUÊS DAQUI NÃO É A FONTE: o `rotuloEmbalagem` do JSON é, porque é
     * ele que o seed grava em `canastra.produtos.tamanho` e é de lá que o
     * checkout relê o item na hora de cobrar. `produtos.test.ts` cobra que os
     * dois digam exatamente a mesma coisa.
     *
     * A TABELA ESPELHA O CATÁLOGO INTEIRO, e nem todas as treze linhas chegam à
     * tela hoje: as que a vitrine mostra são as dos formatos especiais e dos
     * kits (a lista "Também nesta linha" na PDP e o card de kit na PLP). As
     * cinco de pacote — 250 g, 500 g, 1 kg e as duas caixas — só aparecem na
     * sacola, que é pt-BR por decisão, porque o seletor da PDP compõe o próprio
     * texto (`pdp.umPacote`, `pdp.caixaCom`) em vez de imprimir o rótulo. Elas
     * ficam aqui mesmo assim: uma tabela que espelha o catálogo é completa por
     * construção e o teste consegue afirmar isso; uma tabela com buracos é uma
     * armadilha esperando o dia em que uma tela nova mostrar o rótulo de um
     * pacote e ninguém lembrar que aquela linha faltava.
     */
    embalagem: {
      "pacote-250g": "Pacote com 250 g",
      "pacote-500g": "Pacote com 500 g",
      "pacote-1kg": "Pacote com 1 kg",
      "caixa-4x500g": "Caixa com 4 pacotes de 500 g",
      "caixa-3x250g": "Caixa com 3 pacotes de 250 g",
      /** A caixa que mistura linhas — "de cada" é o que a distingue da acima. */
      "caixa-1x250g-de-cada": "Caixa com 1 pacote de 250 g de cada",
      "display-10-saches": "Display com 10 sachês",
      "caixas-3-saches-30": "3 caixas — 30 sachês",
      "caixas-6-saches-60": "6 caixas — 60 sachês",
      "caixas-1-capsulas-10": "1 caixa — 10 cápsulas",
      "caixas-3-capsulas-30": "3 caixas — 30 cápsulas",
      "caixas-4-capsulas-40": "4 caixas — 40 cápsulas",
      "caixas-6-capsulas-60": "6 caixas — 60 cápsulas",
    },

    /**
     * OS SELOS QUE VALEM PARA A COLEÇÃO INTEIRA — os chips do pé da ficha da
     * PDP. Vêm de `marca.atributos` e eram renderizados crus: a ficha em
     * inglês, com rótulo e definição já traduzidos, terminava numa fileira de
     * "100% arábica · Carbono zero · Sem glúten".
     *
     * São afirmação de MARCA e não de produto, e por isso o texto vive aqui e
     * não no editorial por linha: é a mesma frase nas cinco. A chave é
     * `marca.atributosChaves`, na mesma ordem da lista em português —
     * `produtos.test.ts` casa as duas listas e cobra que este português seja
     * idêntico ao do JSON, que é o que o seed cola na descrição de cada SKU.
     */
    atributo: {
      arabica: "100% arábica",
      "origem-unica": "Origem única da Serra da Canastra",
      "carbono-zero": "Carbono zero",
      "energia-fotovoltaica": "100% energia fotovoltaica",
      "sem-gluten": "Sem glúten",
      vegano: "Vegano",
    },

    /**
     * A PLAQUETA DO <SeloSCA> (estetica.md §5.1), e ela tem uma sutileza.
     *
     * `sobrancelha` é a palavra que as caixas de Drip Coffee estampam ACIMA de
     * "ESPECIAL" — inglês impresso numa embalagem brasileira. Ela é a mesma
     * nos três idiomas porque é REPRODUÇÃO, não tradução. Numa página em
     * inglês ela colide com `especial`, que ali também é "Specialty", e a
     * plaqueta diria a mesma palavra duas vezes: o componente compara as duas
     * e some com a sobrancelha quando coincidem.
     *
     * `gourmet` é o que está impresso no pacote do Néctar de Minas, e é
     * empréstimo do francês nas três línguas — não se traduz em nenhuma.
     */
    selo: {
      especial: "Especial",
      gourmet: "Gourmet",
      sobrancelha: "Specialty",
    },

    ordenacao: {
      relevancia: "Relevância",
      "preco-asc": "Menor preço",
      "preco-desc": "Maior preço",
      "torra-asc": "Torra mais clara",
      "torra-desc": "Torra mais escura",
    },

    /**
     * A ficha da PDP (estetica.md §5.4): o rótulo de cada linha e a definição
     * de uma frase que o `<abbr title>` mostra.
     *
     * A DEFINIÇÃO ENTRA NO DICIONÁRIO JUNTO COM O RÓTULO porque ela é a metade
     * que faz a ficha servir ao iniciante — um rótulo em inglês com a
     * explicação em português deixa a pessoa exatamente onde ela estava.
     *
     * NÃO HÁ MAIS LINHA "VARIEDADES", e a ausência é decisão: variedade é dado
     * da MARCA, não de cada pacote. Ver o comentário de `Origem` em
     * lib/catalogo/tipos.ts.
     */
    ficha: {
      titulo: "Ficha do café",
      rotulo: {
        origem: "Origem",
        torra: "Torra",
        corpo: "Corpo",
        pontuacao: "Pontuação",
        preparo: "Preparo",
      },
      definicao: {
        origem: "A região onde o café foi cultivado, colhido e beneficiado.",
        torra:
          "Quanto tempo e a que temperatura o grão foi torrado. Torras mais escuras trazem mais corpo e amargor; mais claras preservam acidez e fruta.",
        corpo: "O peso do café na boca — de aquoso e leve a denso e encorpado.",
        pontuacao:
          "Nota de 0 a 100 dada em prova cega segundo o protocolo da SCA. De 80 para cima o café é classificado como especial; abaixo disso é gourmet. Onde o site mostra 80+, o número é o piso que a embalagem declara para a coleção, não a nota daquele café; onde mostra um número sem o +, é a nota que a marca publica para aquela linha.",
        preparo: "Os métodos em que esta linha costuma render melhor.",
      },
    },

    /**
     * O TEXTO ALTERNATIVO DE TODA FOTO DO CATÁLOGO, e ele é MOLDE, não frase.
     *
     * `{embalagem}` chega do editorial traduzido por linha
     * (data/catalogo-canastra.i18n.json) e `{nome}` é nome próprio, igual nos
     * três idiomas. É molde porque a ordem e a preposição mudam de língua para
     * língua: costurá-las no componente produziria "Black bag do Canastra
     * Clássico". Quem monta é `lib/catalogo/produtos.ts`; quem consome é a foto
     * de todo card, a galeria da PDP e o `og:image:alt` — ou seja, quem não
     * enxerga a imagem, que era exatamente quem estava ouvindo português numa
     * página em inglês.
     *
     * O ALT DO PACOTE DIZIA "de 250 g" E O NÚMERO SAIU. A mesma frase servia
     * ao Néctar de Minas, que só existe em 1 kg: era peso inventado no lugar
     * onde ninguém confere. O que a foto mostra é o pacote; o peso é do SKU e
     * está no rótulo ao lado.
     */
    alt: {
      sabor: "{embalagem} do {nome} sobre fundo claro",
      pacote: "{embalagem} do {nome}",
    },
  },

  /**
   * A PDP — estetica.md §7.3, "a página mais importante", e a última grande
   * superfície da vitrine que continuava falando português em /en e /es.
   *
   * O QUE ENTRA AQUI: o que a PÁGINA diz sobre qualquer café. O que cada café
   * diz de si — nome, descrição, torra, corpo, notas, preparo sugerido — vem
   * do editorial traduzido (data/catalogo-canastra.i18n.json) e não daqui;
   * dois lugares para o mesmo texto seriam dois lugares onde ele pode estar
   * errado.
   */
  pdp: {
    /**
     * A tela e o metadata de slug que não existe. Não é a mesma frase: o
     * `metaTitulo` é aba de navegador e resultado de busca, o `titulo` é o H1
     * de quem já está na página. estetica.md §11 — a tela de erro explica e
     * resolve, e nunca pede desculpa.
     */
    naoEncontrado: {
      metaTitulo: "Café não encontrado",
      titulo: "Esse café não está no catálogo.",
      texto:
        "Pode ser um lote que já acabou — torramos em quantidade pequena e alguns saem de linha. Estes estão disponíveis agora.",
    },

    /**
     * A emenda da meta description, que é montada com o editorial do lote:
     * "{descrição} Notas de {notas}. {SCA}, {região}." Em inglês o termo da
     * indústria é `tasting notes` e ele pede dois-pontos, por isso a
     * pontuação viaja junto com a chave em vez de ficar no template.
     */
    notasDe: "Notas de",

    /** Rótulo do <nav> do breadcrumb e o nome da primeira parada dele. */
    trilha: "Trilha",
    inicio: "Início",

    /** Drip e cápsula: o que a linha tem além da matriz moagem × peso. */
    tambemNestaLinha: "Também nesta linha",

    /** A faixa fuligem com a descrição editorial. */
    sobreEstaLinha: "Sobre esta linha",
    /**
     * As duas metades da frase de resumo, que é montada com dados do lote:
     * "Origem única da {região}. {torra}, {corpo}. Rende melhor em {preparo}."
     * Ficam separadas porque o miolo é editorial traduzido — costurar tudo
     * numa chave só obrigaria a repetir o editorial aqui.
     */
    origemUnicaDa: "Origem única da",
    rendeMelhorEm: "Rende melhor em",

    comoPreparar: "Como preparar",
    /** O cartão de receita de cada método (§7.3: "a etiqueta em estado puro"). */
    receita: {
      proporcao: "Proporção",
      temperatura: "Temperatura",
      tempo: "Tempo",
      moagem: "Moagem",
    },

    daMesmaSerra: "Da mesma serra",

    /** §5.6 — as duas abas acima do preço. */
    modoDeCompra: "Modo de compra",
    compraUnica: "Compra única",
    /**
     * O que a aba de assinatura promete. É a PORTA do Clube, não a compra: o
     * botão leva ao wizard de /clube, e é lá que frequência, endereço e a
     * autorização no Mercado Pago acontecem.
     */
    clubeExplicacao:
      "A cada 15, 30 ou 45 dias, com a entrega incluída. Você escolhe a frequência no Clube e cancela quando quiser, sem multa.",
    montarAssinatura: "Montar minha assinatura",
    /** A barra fixa do mobile, onde não cabe a frase inteira (§10). */
    assinar: "Assinar",

    /** A ponte para "Como preparar", que os sete botões antigos faziam. */
    moidoNoDia:
      "Moído no dia do pedido. A moagem de cada método está em",

    /** As legendas dos três seletores. */
    rotulo: {
      moagem: "Moagem",
      peso: "Peso",
      embalagem: "Embalagem",
    },
    /** §5.5 — combinação inexistente aparece DESABILITADA, com o motivo. */
    semEstaMoagem: "Não disponível para este lote",
    semEstePeso: "Não disponível nesta moagem",
    umPacote: "1 pacote",
    /** Vem colado ao número: "Caixa com 3". */
    caixaCom: "Caixa com",

    diminuirQuantidade: "Diminuir quantidade",
    aumentarQuantidade: "Aumentar quantidade",
    maximoEmEstoque: "Este é o máximo disponível em estoque agora.",
    combinacaoEsgotada:
      "Esta combinação está esgotada. Tente outro peso ou outra moagem.",
    torramosNaTerca: "Torramos na terça, enviamos na quarta.",
  },

  /**
   * Pôr algo na sacola A PARTIR DA VITRINE — o painel da PDP e o card de kit
   * da PLP, que são as duas únicas superfícies traduzidas com botão de compra.
   *
   * A SACOLA EM SI CONTINUA SÓ EM PORTUGUÊS (spec §1), e não há contradição:
   * o que se traduz aqui é o botão e o aviso de quem ainda está na vitrine. O
   * rótulo GRAVADO no item — a moagem que viaja para o localStorage, para a
   * RPC e para o funil do GA4 — é sempre o português, e quem trata disso é o
   * `MOAGEM_NA_SACOLA` do PainelCompra.
   *
   * estetica.md §11: o botão diz "Adicionar à sacola", logo a confirmação diz
   * "adicionado à sacola". O mesmo nome do começo ao fim, nos três idiomas.
   */
  venda: {
    adicionarASacola: "Adicionar à sacola",
    /** A barra fixa do mobile, onde o botão divide a linha com o preço. */
    adicionar: "Adicionar",
    naSacola: "Na sacola",
    itemAdicionado: "Item adicionado à sacola.",
    /** API fora: o botão avisa em vez de fingir que guardou. */
    semLoja:
      "Não conseguimos falar com a loja agora. Tente de novo em instantes.",
    naoDeuParaAdicionar: "Não foi possível adicionar à sacola.",
    kit: {
      adicionado: "Kit adicionado à sacola.",
      noTeto: "Sua sacola já tem o máximo disponível deste kit.",
      esgotado:
        "Este kit está esgotado na loja. Volte em breve — a torra é semanal.",
      /** Sachês ou cápsulas, quando o formato conta por unidade. */
      unidades: "unidades",
    },
  },

  /**
   * A última seção da PDP. TOM SÓBRIO (estetica.md §2/§8.1): o texto carrega a
   * informação e as estrelas são decoração `aria-hidden` — por isso o "de 5" e
   * a contagem precisam existir em cada idioma, e não só o número.
   */
  avaliacoes: {
    /** Rótulo da <section>; o H2 visível é o `titulo`, mais curto. */
    deClientes: "Avaliações de clientes",
    titulo: "Avaliações",
    /**
     * Singular e plural da contagem. A REGRA DE PLURAL É POR IDIOMA — nestes
     * três ela coincide (só 1 é singular; 0 vai para o plural), e é o
     * componente que escolhe entre as duas formas, num lugar só.
     */
    uma: "avaliação",
    muitas: "avaliações",
    /** Tela vazia é convite, nunca lamento (§11). */
    vazio: "Seja o primeiro a avaliar — compre e conte o que achou.",
    /** O texto que o leitor de tela ouve no lugar das estrelas. */
    nota: "Nota",
    deCinco: "de 5",
    buscando: "Buscando…",
    verMais: "Ver mais avaliações",
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

  /**
   * A fronteira de erro — `app/erro-de-pagina.tsx`.
   *
   * Ela serve OS DOIS GRUPOS DE ROTA: a vitrine traduzida e o caminho de
   * compra, que é pt-BR por decisão do cliente. Quem resolve isso é o próprio
   * componente, que força `pt` em caminho transacional; estas chaves existem
   * para o lado traduzido, onde até agora uma falha em /en/cafes respondia em
   * português a quem não lê português.
   */
  erro: {
    titulo: "Não foi possível carregar esta página.",
    /** §11: o erro explica e resolve. Nunca pede desculpa, nunca culpa. */
    texto:
      "A conexão pode ter caído no meio do caminho. Tentar de novo costuma resolver.",
    tentarDeNovo: "Tentar de novo",
    /** Prefixo do `digest` do Next — o que o cliente repete para o suporte. */
    codigo: "Código do erro",
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
    maisVendidos: "Best sellers",
    nossosKits: "Our boxes",
    escolhaDoProdutor: "The grower's pick",
    verMais: "See more",
    categorias: "Categories",
    maisCategorias: "+ Categories",
    adicionadoASacola: "Product added to your bag",
    noTetoDoEstoque:
      "You already have the maximum available of this item in your bag.",
    irParaOsCafes: "Go to the coffees",
    conhecerASerra: "Get to know the serra",
    comecarAssinatura: "Start a subscription",
    voltarAoInicio: "Back to home",
    limparTudo: "Clear all",
    limparFiltros: "Clear filters",
    aPartirDe: "from",
    /** Ver o comentário em `pt` — as três só existem para o leitor de tela. */
    precoDe: "was",
    precoPor: "now",
    /** Vem depois do número: "10% off". */
    desconto: "off",
    esgotado: "Sold out",
    indisponivel: "Unavailable",
    /** Sem preposição: em inglês a data segue direto — "Updated August 2026". */
    atualizadoEm: "Updated",
    /** `lot`, o termo da indústria — não `batch`. */
    lote: "lot",
    lotes: "lots",
    item: "item",
    itens: "items",
    logoAlt: "Café Canastra logo, since 1985",
    falarNoWhatsApp: "Message us on WhatsApp",
  },
  catalogo: {
    /** Nome próprio do produto: idêntico nos três idiomas, por decisão. */
    linha: {
      classico: "Clássico",
      suave: "Suave",
      canela: "Canela",
      microlote: "Microlote",
      "nectar-de-minas": "Néctar de Minas",
    },
    /**
     * `roast` é a palavra da indústria e ela vem DEPOIS do adjetivo: uma
     * torrefação escreve "Light roast", nunca "Clear toast". A escala é a
     * mesma nas três línguas — uma torra 5 é escura em qualquer idioma — e
     * `produtos.test.ts` trava a igualdade contra o editorial traduzido.
     */
    pontoTorra: {
      1: "Light roast",
      2: "Light-medium roast",
      3: "Medium roast",
      4: "Medium-dark roast",
      5: "Dark roast",
    },
    /**
     * As pontas do eixo saem SEM a palavra `roast`: elas rotulam a régua, e
     * "Light roast — Dark roast" nas duas pontas repetiria o degrau escrito
     * logo abaixo dela.
     */
    escala: {
      clara: "Light",
      escura: "Dark",
      deCinco: "of 5",
    },
    nota: {
      /** O nome que a castanha tem em inglês é o do país de onde ela sai. */
      "castanha-do-para": "Brazil nut",
      /** Empréstimo já corrente em inglês; traduzir viraria "milk jam". */
      "doce-de-leite": "Dulce de leche",
      "amendoim-torrado": "Roasted peanut",
      "chocolate-meio-amargo": "Semisweet chocolate",
      "laranja-da-terra": "Bitter orange",
      "milho-torrado": "Toasted corn",
      amadeirado: "Woody",
      especiarias: "Spices",
      chocolate: "Chocolate",
      /** Na roda de sabores da SCA a família é `nutty`, não `chestnut`. */
      castanha: "Nutty",
      /** Fruta brasileira sem nome em inglês — a roda de sabores usa o nosso. */
      jabuticaba: "Jabuticaba",
      caramelo: "Caramel",
      melaco: "Molasses",
      /** `Citrus`, a família da roda de sabores — não `Citric`, que é o ácido. */
      citrico: "Citrus",
      frutado: "Fruity",
      floral: "Floral",
      amendoa: "Almond",
      pessego: "Peach",
      baunilha: "Vanilla",
      /** Não há rapadura em inglês; a ficha de prova escreve o produto. */
      rapadura: "Raw cane sugar",
      /** `Cocoa` é o grão e a nota; `cacao` em inglês é a árvore. */
      cacau: "Cocoa",
      canela: "Cinnamon",
      cravo: "Clove",
      doce: "Sweetness",
      cana: "Sugarcane",
      mel: "Honey",
    },
    /** `Whole bean` e `Ground` são como uma torrefação escreve no rótulo. */
    moagem: {
      grao: "Whole bean",
      moido: "Ground",
    },
    /** A escala de espessura da receita — `coarse` é o termo da indústria. */
    moagemDaReceita: {
      fina: "Fine",
      "media-fina": "Medium-fine",
      media: "Medium",
      grossa: "Coarse",
    },
    metodo: {
      espresso: "Espresso",
      /** `Pour over` é o método; `paper` distingue do coador de pano. */
      "coado-papel": "Pour over (paper)",
      "coador-pano": "Cloth filter",
      "prensa-francesa": "French press",
      /** `Moka pot` é o nome do objeto em inglês — "Italian" sozinho não diz. */
      "italiana-moka": "Moka pot",
      aeropress: "Aeropress",
    },
    formato: {
      graos: "Whole bean",
      moido: "Ground",
      /** Nome do produto na caixa, nos três idiomas. */
      drip: "Drip Coffee",
      capsula: "Capsules",
    },
    /**
     * `bag` e `box` são o que uma torrefação escreve no rótulo em inglês —
     * `packet` é remédio e `package` é encomenda dos Correios. `sachet` é o
     * termo do drip coffee de saquinho; `display` é o expositor de balcão, e a
     * palavra é a mesma nas duas línguas.
     */
    embalagem: {
      "pacote-250g": "250 g bag",
      "pacote-500g": "500 g bag",
      "pacote-1kg": "1 kg bag",
      "caixa-4x500g": "Box with four 500 g bags",
      "caixa-3x250g": "Box with three 250 g bags",
      "caixa-1x250g-de-cada": "Box with one 250 g bag of each",
      "display-10-saches": "Display box with 10 sachets",
      "caixas-3-saches-30": "3 boxes — 30 sachets",
      "caixas-6-saches-60": "6 boxes — 60 sachets",
      "caixas-1-capsulas-10": "1 box — 10 capsules",
      "caixas-3-capsulas-30": "3 boxes — 30 capsules",
      "caixas-4-capsulas-40": "4 boxes — 40 capsules",
      "caixas-6-capsulas-60": "6 boxes — 60 capsules",
    },
    atributo: {
      arabica: "100% arabica",
      "origem-unica": "Single origin from Serra da Canastra",
      /**
       * `Zero carbon`, e não `carbon neutral`: as duas não dizem a mesma
       * coisa, e neutralidade por compensação é afirmação que a marca não
       * publica. O que ela publica é "Carbono zero".
       */
      "carbono-zero": "Zero carbon",
      "energia-fotovoltaica": "100% photovoltaic energy",
      "sem-gluten": "Gluten free",
      vegano: "Vegan",
    },
    /**
     * Aqui `especial` e `sobrancelha` são a MESMA palavra, e é justamente isso
     * que o <SeloSCA> detecta para não escrever "Specialty" duas vezes numa
     * plaqueta só. Ver a nota no `pt`.
     */
    selo: {
      especial: "Specialty",
      gourmet: "Gourmet",
      sobrancelha: "Specialty",
    },
    ordenacao: {
      relevancia: "Relevance",
      "preco-asc": "Lowest price",
      "preco-desc": "Highest price",
      "torra-asc": "Lightest roast",
      "torra-desc": "Darkest roast",
    },
    ficha: {
      titulo: "Coffee spec sheet",
      rotulo: {
        origem: "Origin",
        torra: "Roast",
        corpo: "Body",
        pontuacao: "Score",
        preparo: "Brewing",
      },
      definicao: {
        origem: "The region where the coffee was grown, picked and processed.",
        torra:
          "How long and how hot the bean was roasted. Darker roasts bring more body and bitterness; lighter ones keep acidity and fruit.",
        corpo:
          "The weight of the coffee in the mouth — from thin and light to dense and full.",
        pontuacao:
          "A 0-to-100 score given in blind cupping under the SCA protocol. From 80 up the coffee is graded as specialty; below that it is gourmet. Where the site shows 80+, the number is the floor the packaging declares for the whole collection, not the score of that coffee; where it shows a number without the +, it is the score the roaster publishes for that line.",
        preparo: "The methods this line tends to shine in.",
      },
    },
    alt: {
      sabor: "{embalagem} of {nome} on a light background",
      pacote: "{embalagem} of {nome}",
    },
  },
  pdp: {
    naoEncontrado: {
      metaTitulo: "Coffee not found",
      titulo: "That coffee is not in the catalogue.",
      texto:
        "It may be a lot that ran out — we roast in small batches and some are discontinued. These are available now.",
    },
    notasDe: "Tasting notes:",
    trilha: "Breadcrumb",
    inicio: "Home",
    tambemNestaLinha: "Also in this line",
    sobreEstaLinha: "About this line",
    /**
     * `from the`, com artigo: a região chega como `Serra da Canastra` e é nome
     * próprio de lugar — "Single origin from Serra da Canastra" soa a
     * telegrama, e traduzir a serra está proibido.
     */
    origemUnicaDa: "Single origin from the",
    /** `Brews best as` é como uma torrefação escreve a recomendação. */
    rendeMelhorEm: "Brews best as",
    /** `Brew`, não `prepare`: é o verbo do café em inglês. */
    comoPreparar: "How to brew",
    receita: {
      /** `Ratio` é o termo da receita; `proportion` é aula de matemática. */
      proporcao: "Ratio",
      temperatura: "Temperature",
      tempo: "Time",
      /** `Grind size` diz espessura; `grind` sozinho já é o seletor de cima. */
      moagem: "Grind size",
    },
    daMesmaSerra: "From the same serra",
    modoDeCompra: "Purchase mode",
    /** `One-time` é como uma loja de assinatura chama a compra avulsa. */
    compraUnica: "One-time purchase",
    clubeExplicacao:
      "Every 15, 30 or 45 days, delivery included. You choose the frequency in the Clube and cancel whenever you like, with no penalty.",
    montarAssinatura: "Build my subscription",
    assinar: "Subscribe",
    moidoNoDia:
      "Ground on the day of your order. The grind for each method is in",
    rotulo: {
      moagem: "Grind",
      peso: "Weight",
      embalagem: "Packaging",
    },
    semEstaMoagem: "Not available for this lot",
    semEstePeso: "Not available in this grind",
    umPacote: "1 pack",
    caixaCom: "Box of",
    diminuirQuantidade: "Decrease quantity",
    aumentarQuantidade: "Increase quantity",
    maximoEmEstoque: "That is all we have in stock right now.",
    combinacaoEsgotada:
      "This combination is sold out. Try another weight or grind.",
    torramosNaTerca: "We roast on Tuesday and ship on Wednesday.",
  },
  venda: {
    adicionarASacola: "Add to bag",
    adicionar: "Add",
    naSacola: "In the bag",
    itemAdicionado: "Item added to the bag.",
    semLoja: "We could not reach the shop right now. Try again in a moment.",
    naoDeuParaAdicionar: "We could not add this to the bag.",
    kit: {
      adicionado: "Kit added to the bag.",
      noTeto: "Your bag already has all we have of this kit.",
      esgotado: "This kit is sold out. Come back soon — we roast every week.",
      unidades: "units",
    },
  },
  avaliacoes: {
    deClientes: "Customer reviews",
    titulo: "Reviews",
    uma: "review",
    muitas: "reviews",
    vazio: "Be the first to review — buy it and tell us what you thought.",
    nota: "Rating",
    deCinco: "out of 5",
    buscando: "Loading…",
    verMais: "See more reviews",
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
  erro: {
    titulo: "We could not load this page.",
    texto:
      "The connection may have dropped along the way. Trying again usually sorts it out.",
    tentarDeNovo: "Try again",
    codigo: "Error code",
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
    maisVendidos: "Más vendidos",
    nossosKits: "Nuestros kits",
    escolhaDoProdutor: "Elección del productor",
    verMais: "Ver más",
    categorias: "Categorías",
    maisCategorias: "+ Categorías",
    adicionadoASacola: "Producto añadido a la bolsa",
    noTetoDoEstoque:
      "Ya tiene el máximo disponible de este artículo en la bolsa.",
    irParaOsCafes: "Ir a los cafés",
    conhecerASerra: "Conocer la serra",
    comecarAssinatura: "Empezar la suscripción",
    voltarAoInicio: "Volver al inicio",
    limparTudo: "Borrar todo",
    limparFiltros: "Borrar filtros",
    aPartirDe: "desde",
    /** Ver o comentário em `pt` — as três só existem para o leitor de tela. */
    precoDe: "antes",
    precoPor: "ahora",
    /** Vem depois do número: "10% de descuento". */
    desconto: "de descuento",
    esgotado: "Agotado",
    indisponivel: "No disponible",
    atualizadoEm: "Actualizado en",
    lote: "lote",
    lotes: "lotes",
    item: "artículo",
    itens: "artículos",
    logoAlt: "Logotipo de Café Canastra, desde 1985",
    falarNoWhatsApp: "Hablar con nosotros por WhatsApp",
  },
  catalogo: {
    /** Nombre propio del producto: idéntico en los tres idiomas, por decisión. */
    linha: {
      classico: "Clássico",
      suave: "Suave",
      canela: "Canela",
      microlote: "Microlote",
      "nectar-de-minas": "Néctar de Minas",
    },
    /** `tueste` é a palavra da indústria em espanhol; `torrado` é o grão pronto. */
    pontoTorra: {
      1: "Tueste claro",
      2: "Tueste claro-medio",
      3: "Tueste medio",
      4: "Tueste medio-oscuro",
      5: "Tueste oscuro",
    },
    /**
     * Masculino, ao contrário do português: quem concorda aqui é `tueste`, e
     * não `torra`. Trocar só o acento — "Clara"/"Escura" — deixaria a régua em
     * português no meio de uma página em espanhol.
     */
    escala: {
      clara: "Claro",
      escura: "Oscuro",
      deCinco: "de 5",
    },
    nota: {
      "castanha-do-para": "Nuez de Brasil",
      "doce-de-leite": "Dulce de leche",
      /** `Maní` e não `cacahuete`: a exportação é Chile e Argentina. */
      "amendoim-torrado": "Maní tostado",
      "chocolate-meio-amargo": "Chocolate semiamargo",
      "laranja-da-terra": "Naranja amarga",
      "milho-torrado": "Maíz tostado",
      amadeirado: "Amaderado",
      especiarias: "Especias",
      chocolate: "Chocolate",
      castanha: "Nuez",
      /** Fruta brasileira sem nome em espanhol — fica a nossa. */
      jabuticaba: "Jabuticaba",
      caramelo: "Caramelo",
      melaco: "Melaza",
      citrico: "Cítrico",
      frutado: "Afrutado",
      floral: "Floral",
      amendoa: "Almendra",
      /** `Durazno`, o termo do Cone Sul, e não `melocotón`, que é da Espanha. */
      pessego: "Durazno",
      baunilha: "Vainilla",
      /** `Panela` é o mesmo açúcar de cana não refinado, com o nome de lá. */
      rapadura: "Panela",
      cacau: "Cacao",
      canela: "Canela",
      cravo: "Clavo",
      doce: "Dulzor",
      cana: "Caña",
      mel: "Miel",
    },
    /** `En grano` e `molido` são o que está escrito no pacote em espanhol. */
    moagem: {
      grao: "En grano",
      moido: "Molido",
    },
    /** `Gruesa` é a espessura; `grosera` seria falta de educação. */
    moagemDaReceita: {
      fina: "Fina",
      "media-fina": "Media-fina",
      media: "Media",
      grossa: "Gruesa",
    },
    metodo: {
      espresso: "Espresso",
      "coado-papel": "Filtrado (papel)",
      "coador-pano": "Colador de tela",
      "prensa-francesa": "Prensa francesa",
      "italiana-moka": "Cafetera italiana / Moka",
      aeropress: "Aeropress",
    },
    formato: {
      graos: "En grano",
      moido: "Molido",
      /** Nombre del producto en la caja, en los tres idiomas. */
      drip: "Drip Coffee",
      capsula: "Cápsulas",
    },
    /**
     * `Bolsa` e não `paquete`: é o que está impresso en el envase de café en
     * español. `Sobre` é o sachê de drip coffee — `sachet` é galicismo que a
     * góndola do Cone Sul não usa.
     */
    embalagem: {
      "pacote-250g": "Bolsa de 250 g",
      "pacote-500g": "Bolsa de 500 g",
      "pacote-1kg": "Bolsa de 1 kg",
      "caixa-4x500g": "Caja con 4 bolsas de 500 g",
      "caixa-3x250g": "Caja con 3 bolsas de 250 g",
      "caixa-1x250g-de-cada": "Caja con 1 bolsa de 250 g de cada",
      "display-10-saches": "Display con 10 sobres",
      "caixas-3-saches-30": "3 cajas — 30 sobres",
      "caixas-6-saches-60": "6 cajas — 60 sobres",
      "caixas-1-capsulas-10": "1 caja — 10 cápsulas",
      "caixas-3-capsulas-30": "3 cajas — 30 cápsulas",
      "caixas-4-capsulas-40": "4 cajas — 40 cápsulas",
      "caixas-6-capsulas-60": "6 cajas — 60 cápsulas",
    },
    atributo: {
      arabica: "100% arábica",
      "origem-unica": "Origen único de la Serra da Canastra",
      /** `Carbono cero`, o mesmo que o português diz — não neutralidade. */
      "carbono-zero": "Carbono cero",
      "energia-fotovoltaica": "100% energía fotovoltaica",
      "sem-gluten": "Sin gluten",
      vegano: "Vegano",
    },
    /**
     * A sobrancelha continua em inglês porque é o que a caixa estampa, e em
     * espanhol ela NÃO colide com `especial` — a plaqueta sai igual à da
     * embalagem, "Specialty / Especial / SCA 80+".
     */
    selo: {
      especial: "Especial",
      gourmet: "Gourmet",
      sobrancelha: "Specialty",
    },
    ordenacao: {
      relevancia: "Relevancia",
      "preco-asc": "Menor precio",
      "preco-desc": "Mayor precio",
      "torra-asc": "Tueste más claro",
      "torra-desc": "Tueste más oscuro",
    },
    ficha: {
      titulo: "Ficha del café",
      rotulo: {
        origem: "Origen",
        torra: "Tueste",
        corpo: "Cuerpo",
        pontuacao: "Puntuación",
        preparo: "Preparación",
      },
      definicao: {
        origem: "La región donde el café fue cultivado, cosechado y beneficiado.",
        torra:
          "Cuánto tiempo y a qué temperatura se tostó el grano. Los tuestes más oscuros dan más cuerpo y amargor; los más claros conservan acidez y fruta.",
        corpo:
          "El peso del café en la boca — de aguado y ligero a denso y con cuerpo.",
        pontuacao:
          "Puntuación de 0 a 100 dada en cata a ciegas según el protocolo de la SCA. De 80 en adelante el café se clasifica como especial; por debajo es gourmet. Donde el sitio muestra 80+, el número es el piso que el empaque declara para toda la colección, no la nota de ese café; donde muestra un número sin el +, es la nota que la marca publica para esa línea.",
        preparo: "Los métodos en los que esta línea suele rendir mejor.",
      },
    },
    alt: {
      sabor: "{embalagem} de {nome} sobre fondo claro",
      pacote: "{embalagem} de {nome}",
    },
  },
  pdp: {
    naoEncontrado: {
      metaTitulo: "Café no encontrado",
      titulo: "Ese café no está en el catálogo.",
      texto:
        "Puede ser un lote que se acabó — tostamos en cantidad pequeña y algunos salen de línea. Estos están disponibles ahora.",
    },
    notasDe: "Notas de",
    trilha: "Ruta de navegación",
    inicio: "Inicio",
    tambemNestaLinha: "También en esta línea",
    sobreEstaLinha: "Sobre esta línea",
    origemUnicaDa: "Origen único de la",
    rendeMelhorEm: "Rinde mejor en",
    comoPreparar: "Cómo preparar",
    receita: {
      proporcao: "Proporción",
      temperatura: "Temperatura",
      tempo: "Tiempo",
      moagem: "Molienda",
    },
    daMesmaSerra: "De la misma serra",
    modoDeCompra: "Modo de compra",
    compraUnica: "Compra única",
    clubeExplicacao:
      "Cada 15, 30 o 45 días, con la entrega incluida. Usted elige la frecuencia en el Clube y cancela cuando quiera, sin multa.",
    montarAssinatura: "Armar mi suscripción",
    assinar: "Suscribirse",
    moidoNoDia:
      "Molido el día del pedido. La molienda de cada método está en",
    rotulo: {
      moagem: "Molienda",
      peso: "Peso",
      embalagem: "Empaque",
    },
    semEstaMoagem: "No disponible para este lote",
    semEstePeso: "No disponible en esta molienda",
    umPacote: "1 paquete",
    caixaCom: "Caja de",
    diminuirQuantidade: "Disminuir cantidad",
    aumentarQuantidade: "Aumentar cantidad",
    maximoEmEstoque: "Es el máximo disponible en stock ahora.",
    combinacaoEsgotada:
      "Esta combinación está agotada. Pruebe otro peso u otra molienda.",
    torramosNaTerca: "Tostamos el martes y enviamos el miércoles.",
  },
  venda: {
    adicionarASacola: "Añadir a la bolsa",
    adicionar: "Añadir",
    naSacola: "En la bolsa",
    itemAdicionado: "Artículo añadido a la bolsa.",
    semLoja:
      "No pudimos conectar con la tienda ahora. Inténtelo de nuevo en un momento.",
    naoDeuParaAdicionar: "No se pudo añadir a la bolsa.",
    kit: {
      adicionado: "Kit añadido a la bolsa.",
      noTeto: "Su bolsa ya tiene el máximo disponible de este kit.",
      esgotado:
        "Este kit está agotado en la tienda. Vuelva pronto — el tueste es semanal.",
      unidades: "unidades",
    },
  },
  avaliacoes: {
    /** `Opinión` é o que uma loja hispanohablante chama a avaliação. */
    deClientes: "Opiniones de clientes",
    titulo: "Opiniones",
    uma: "opinión",
    muitas: "opiniones",
    vazio: "Sea el primero en opinar — compre y cuéntenos qué le pareció.",
    nota: "Calificación",
    deCinco: "de 5",
    buscando: "Cargando…",
    verMais: "Ver más opiniones",
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
  erro: {
    titulo: "No fue posible cargar esta página.",
    texto:
      "La conexión puede haberse caído a mitad de camino. Intentarlo de nuevo suele resolverlo.",
    tentarDeNovo: "Intentar de nuevo",
    codigo: "Código del error",
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
