import { centavosParaReais, reaisParaCentavos } from "../dinheiro";
import type { TomDeStatus } from "../status";

/**
 * A DECISÃO da tela de Ajustes — sem React, sem fetch, sem DOM (spec §2.8).
 *
 * Três blocos moram nela e não se parecem: a configuração da LOJA
 * (`PUT /config`), as CATEGORIAS (`/options`) e a integração com o BLING
 * (sonda). O que os une é serem o que se mexe uma vez por mês — e é por isso
 * que a tela é a última do menu.
 *
 * O DEFEITO QUE ESTE ARQUIVO EXISTE PARA IMPEDIR tem nome e endereço:
 * `PUT /config` chega por MULTIPART, e um campo enviado VAZIO vale `''`, que
 * não é `undefined`. `Number('')` é `0`, `Number.isInteger(0)` é `true` e
 * `0 < 0` é falso — a validação APROVAVA, o piso do frete grátis virava zero, e
 * **zero DESLIGA o frete grátis da loja inteira**, arrastado por qualquer outro
 * campo que o formulário estivesse salvando. Sem aviso, sem log, e a loja
 * passava a dar frete grátis para todo mundo.
 *
 * O backend foi endurecido (`ConfigRepository.ehAusencia`: vazio vira
 * ausência). **Esta tela não depende disso.** `montarPayloadDaLoja` OMITE o
 * campo em branco em vez de mandá-lo vazio — duas trancas na mesma porta,
 * porque a porta dá para a receita de frete da loja inteira.
 */

/** A rota desta tela, num lugar só. */
export const ROTA_DE_AJUSTES = "/dashboard/ajustes";

/* ==========================================================================
 * BLOCO 1 — A LOJA (`GET /config`, `PUT /config`)
 * ========================================================================== */

/**
 * O que `GET /config` devolve, com os nomes do CONTRATO (que é inglês, embora a
 * tabela fale português: `titulo_site AS site_title` e companhia).
 *
 * `frete_gratis_minimo_centavos` sai com o nome do banco mesmo — é campo NOVO
 * (0009), sem consumidor legado a preservar.
 */
export type RespostaDaConfig = {
  id?: number;
  banner_desktop?: string | null;
  banner_mobile?: string | null;
  site_title?: string | null;
  whatsapp_number?: string | null;
  announcement_bar?: string | null;
  frete_gratis_minimo_centavos?: number | null;
  updated_at?: string | null;
};

/** O que o formulário tem em mãos — TUDO texto, porque é o que um `<input>`
 *  devolve. Converter cedo demais é como um `0` entra sem ninguém pedir. */
export type EstadoDaLoja = {
  titulo: string;
  whatsapp: string;
  /** Em REAIS, como a pessoa digita: "149,00". A conversão para centavos
   *  acontece numa borda só, em `analisarFreteGratis`. */
  freteGratisReais: string;
};

/**
 * O piso do frete grátis, de centavos para o campo — "149,00".
 *
 * A CONVERSÃO REAIS↔CENTAVOS VIVE SÓ NAS DUAS BORDAS DESTA TELA, e é uma regra
 * do checklist de paridade: entrada divide por 100, saída faz
 * `Math.round(reais*100)`. Espalhá-la é como quatro telas legadas acabaram com
 * um `moeda()` local cada uma, adivinhando a unidade pela ordem de grandeza.
 *
 * `null` e `undefined` viram campo VAZIO, e não "0,00": o zero é um valor com
 * significado grave aqui (desliga o frete grátis), e escrevê-lo por causa de um
 * campo que o servidor não mandou seria pôr na tela uma decisão que ninguém
 * tomou — que, salva, vira a decisão de verdade.
 */
export function centavosParaCampo(centavos: number | null | undefined): string {
  if (typeof centavos !== "number" || !Number.isFinite(centavos)) return "";
  return centavosParaReais(centavos).toFixed(2).replace(".", ",");
}

/** O estado inicial do formulário, a partir do que o servidor tem hoje. */
export function estadoInicialDaLoja(config: RespostaDaConfig | null): EstadoDaLoja {
  return {
    titulo: config?.site_title ?? "",
    whatsapp: config?.whatsapp_number ?? "",
    freteGratisReais: centavosParaCampo(config?.frete_gratis_minimo_centavos),
  };
}

/**
 * A frase de erro do campo de frete — a do checklist de paridade, ao pé da
 * letra.
 *
 * "use reais, ex: 149,00" diz a UNIDADE e mostra o FORMATO. "Valor inválido"
 * não faz nem uma coisa nem outra, e o gestor tentaria "14900" — que é o valor
 * certo na unidade errada, e o pior tipo de erro: passa.
 */
export const ERRO_DO_FRETE =
  "Use reais, com vírgula — ex.: 149,00. (Não é em centavos.)";

/**
 * O campo de frete grátis tem TRÊS resultados, e colapsar dois deles é o
 * defeito inteiro.
 *
 *   ausente ..... campo em branco. NÃO É ZERO, e por isso não é enviado: o PUT
 *                 é parcial, e o que não vai fica como estava. Era exatamente
 *                 aqui que `Number('')` virava `0`.
 *   invalido .... texto que não é dinheiro. ABORTA O SUBMIT INTEIRO (nem o
 *                 título sobe), porque um salvamento parcial deixaria o gestor
 *                 com metade do formulário gravado e nenhuma pista de qual
 *                 metade.
 *   valor ....... um inteiro de centavos. `desliga` quando é zero — que é
 *                 legítimo e precisa ser dito em voz alta antes de salvar.
 *
 * `reaisParaCentavos` de `dinheiro.ts` devolve `null` tanto para vazio quanto
 * para lixo, o que é a decisão certa PARA ELE (o nome diz o que faz, e quem
 * chama resolve). Aqui os dois casos levam a caminhos opostos, então a
 * separação acontece antes, no formato.
 */
export type FreteAnalisado =
  | { tipo: "ausente" }
  | { tipo: "invalido"; erro: string }
  | { tipo: "valor"; centavos: number; desliga: boolean };

/**
 * Dinheiro em reais: até sete dígitos inteiros e no máximo duas casas, com
 * vírgula OU ponto.
 *
 * O separador de milhar fica DE FORA de propósito: "1.490,00" e "1,490.00" são
 * a mesma sequência de símbolos em convenções opostas, e aceitar as duas é
 * escolher em silêncio entre R$ 1.490 e R$ 1,49. Recusar manda a pessoa digitar
 * "1490,00", que não é ambíguo em convenção nenhuma.
 */
const DINHEIRO_EM_REAIS = /^\d{1,7}([.,]\d{1,2})?$/;

export function analisarFreteGratis(bruto: string): FreteAnalisado {
  const texto = (bruto ?? "").trim();
  if (texto === "") return { tipo: "ausente" };

  // O "R$" colado por quem copiou de outro lugar não é erro do gestor.
  const limpo = texto.replace(/^R\$\s*/i, "").trim();
  if (!DINHEIRO_EM_REAIS.test(limpo)) {
    return { tipo: "invalido", erro: ERRO_DO_FRETE };
  }

  const centavos = reaisParaCentavos(limpo);
  // Só acontece se a expressão acima e a conversão discordarem; a guarda existe
  // porque um `null` daqui viraria `NaN` no corpo do PUT.
  if (centavos === null || !Number.isInteger(centavos) || centavos < 0) {
    return { tipo: "invalido", erro: ERRO_DO_FRETE };
  }

  return { tipo: "valor", centavos, desliga: centavos === 0 };
}

/**
 * O AVISO DO ZERO, e por que ele é aviso e não erro.
 *
 * Zero é um valor LEGÍTIMO — é como se desliga o frete grátis de propósito, e o
 * `ShippingController` o trata assim. O que não pode é acontecer por descuido,
 * que é como acontecia. `null` quando não há o que avisar.
 */
export function avisoDoFreteGratis(analisado: FreteAnalisado): string | null {
  if (analisado.tipo !== "valor" || !analisado.desliga) return null;
  return (
    "Zero DESLIGA o frete grátis da loja inteira: as barras de progresso somem " +
    "e todo pedido passa a pagar frete. Deixe o campo em branco se a intenção " +
    "era não mexer no piso."
  );
}

/**
 * SÓ DÍGITOS no WhatsApp.
 *
 * O checklist de paridade pede "WhatsApp só números", e a razão é o consumidor:
 * um link `wa.me` só aceita dígitos com DDI. Guardar "(37) 99999-0000" faz o
 * link nascer quebrado, e o defeito aparece no telefone do cliente, não aqui.
 * A normalização é na SAÍDA e não enquanto se digita — apagar a pontuação
 * debaixo do cursor é o jeito mais rápido de tornar um campo impossível de
 * corrigir.
 */
export function somenteDigitos(valor: string): string {
  return (valor ?? "").replace(/\D/g, "");
}

export type CampoDoPayload = { campo: string; valor: string };

/**
 * O corpo do `PUT /config` — e a regra é OMITIR, nunca mandar vazio.
 *
 * Cada campo em branco simplesmente não entra. Para o texto isso significa que
 * ESVAZIAR o título deixou de ser possível por campo em branco (é a mesma
 * limitação que o backend assumiu ao tratar `''` como ausência) — apagar por
 * engano é o erro caro, e apagar de propósito precisa de um caminho explícito
 * que hoje não existe, e está RELATADO.
 *
 * Para o frete, omitir é a tranca: o campo em branco não pode virar zero em
 * lugar nenhum do caminho, nem se o `ehAusencia` do servidor for "simplificado"
 * um dia.
 *
 * Devolve uma LISTA e não um objeto porque o corpo é `multipart/form-data` (a
 * rota usa `upload.fields` para os banners), e um `FormData` se monta
 * empilhando pares — a ordem é a de leitura, o que faz o corpo ser legível no
 * painel de rede do navegador quando alguém for depurar.
 */
export function montarPayloadDaLoja(
  estado: EstadoDaLoja,
  analisado: FreteAnalisado,
): CampoDoPayload[] {
  const campos: CampoDoPayload[] = [];

  const titulo = estado.titulo.trim();
  if (titulo) campos.push({ campo: "site_title", valor: titulo });

  const whatsapp = somenteDigitos(estado.whatsapp);
  if (whatsapp) campos.push({ campo: "whatsapp_number", valor: whatsapp });

  if (analisado.tipo === "valor") {
    campos.push({
      campo: "frete_gratis_minimo_centavos",
      valor: String(analisado.centavos),
    });
  }

  return campos;
}

/**
 * Há alteração pendente? É o que acende a barra de salvar (R5) e o que arma o
 * bloqueio de saída.
 *
 * A COMPARAÇÃO É DO TEXTO CRU, e não do valor normalizado. "149,00" e "149.00"
 * viram o mesmo número, mas quem trocou a vírgula pelo ponto MEXEU no campo — e
 * uma barra de salvar que não aparece depois de uma edição visível é uma barra
 * em que não se confia. Falso positivo aqui custa um clique; falso negativo
 * custa o trabalho.
 */
export function houveMudanca(inicial: EstadoDaLoja, atual: EstadoDaLoja): boolean {
  return (
    inicial.titulo !== atual.titulo ||
    inicial.whatsapp !== atual.whatsapp ||
    inicial.freteGratisReais !== atual.freteGratisReais
  );
}

/**
 * O que a loja NOVA realmente lê de `config_loja` — e a resposta é: um campo
 * só.
 *
 * ISTO NÃO É TRIVIA, É O QUE A TELA PRECISA DIZER. `banner_desktop`,
 * `banner_mobile` e `barra_de_aviso` são colunas que o painel legado editava e
 * que a vitrine nova NUNCA LEU (spec §1): o gestor subia uma imagem, via
 * "salvo com sucesso", e nada acontecia em lugar nenhum. A 0030 moveu herói e
 * barra de aviso para `canastra.vitrine_*`, que é o que `/dashboard/vitrine`
 * edita — com prévia ao vivo e abas de idioma. As três colunas antigas
 * continuam no banco, mortas.
 *
 * `titulo_site` e `whatsapp` sobreviveram no contrato mas não têm leitor na
 * loja nova: o WhatsApp vem de `NEXT_PUBLIC_WHATSAPP`, resolvida no BUILD
 * (`lib/whatsapp.ts`), e o título não é lido em lugar nenhum. Editá-los aqui
 * grava — e não muda a loja. Uma tela que não diz isso repete o defeito que a
 * 0030 corrigiu, só que pela outra porta.
 */
export const ONDE_A_LOJA_LE: Record<string, string> = {
  frete_gratis_minimo_centavos:
    "A loja lê este valor: é ele que zera o frete e desenha as barras de progresso.",
  whatsapp_number:
    "A loja NÃO lê este campo: o botão de WhatsApp usa a variável NEXT_PUBLIC_WHATSAPP, definida na publicação. Mudar aqui não muda o botão.",
  site_title:
    "A loja NÃO lê este campo hoje. Ele fica gravado, mas nenhuma página o usa.",
};

/* ==========================================================================
 * BLOCO 2 — CATEGORIAS (`/options`)
 * ========================================================================== */

/**
 * As duas listas, e o descompasso que o checklist de paridade nomeia: **o
 * rótulo é "Embalagens" e o `type` é `size`**.
 *
 * São três vocabulários no mesmo caminho — a tabela grava `categoria`/`tamanho`
 * (português), o contrato HTTP fala `category`/`size` (inglês), e o gestor lê
 * "Categorias"/"Embalagens". A tradução português↔inglês mora no
 * `optionsRepository`; a de inglês↔gestor mora aqui. Nenhuma das duas pode
 * viver dentro de um componente, que foi como o painel legado acabou com o
 * mesmo mapa em três lugares.
 */
export const TIPOS_DE_OPCAO = [
  {
    tipo: "category",
    rotulo: "Categorias",
    singular: "categoria",
    ajuda: "Como os cafés se agrupam na loja — Clássico, Especial, Micro-lote.",
  },
  {
    tipo: "size",
    rotulo: "Embalagens",
    singular: "embalagem",
    ajuda: "O tamanho de cada pacote — 250 g, 500 g, 1 kg.",
  },
] as const satisfies ReadonlyArray<{
  tipo: string;
  rotulo: string;
  singular: string;
  ajuda: string;
}>;

export type TipoDeOpcao = (typeof TIPOS_DE_OPCAO)[number]["tipo"];

/** O que `GET /options` devolve, já traduzido pelo repositório. */
export type OpcaoDaLista = { id: string; type: string; value: string };

/** As opções de um tipo, na ordem que o backend já garantiu (`valor ASC`). */
export function opcoesDoTipo(
  opcoes: readonly OpcaoDaLista[],
  tipo: string,
): OpcaoDaLista[] {
  return opcoes.filter((o) => o.type === tipo);
}

/** O produto, no recorte que esta tela usa de `GET /dashboard`. */
export type ProdutoDoCatalogo = { category?: string | null; size?: string | null };

/**
 * Quais valores estão EM USO por algum produto.
 *
 * O checklist pede que a tela sinalize o uso ANTES da tentativa de excluir: o
 * backend recusa com 409 ("opção em uso"), e a frase chega — mas descobrir pelo
 * erro custa um clique e uma dúvida ("em uso por qual produto?"). Marcado
 * antes, o gestor nem tenta.
 *
 * A comparação é pelo VALOR e não pelo id porque é assim que o backend a faz:
 * `canastra.produtos.categoria` guarda o texto, não uma chave estrangeira.
 */
export function valoresEmUso(produtos: readonly ProdutoDoCatalogo[]): Set<string> {
  const usados = new Set<string>();
  for (const p of produtos) {
    const categoria = (p.category ?? "").trim();
    const tamanho = (p.size ?? "").trim();
    if (categoria) usados.add(categoria);
    if (tamanho) usados.add(tamanho);
  }
  return usados;
}

/**
 * DÁ PARA CONFIAR NA MARCA DE "EM USO"?
 *
 * Só se a leitura do catálogo alcançou o catálogo INTEIRO. `GET /dashboard` tem
 * teto de 200 por página; numa loja com 250 produtos, os 50 de fora poderiam
 * usar justamente a opção que a tela marcaria como livre — e uma marca errada
 * numa tela de exclusão é pior que marca nenhuma, porque ela convida ao clique.
 *
 * Quando não dá, a tela não marca nada e diz por quê. O 409 do backend continua
 * sendo a autoridade nos dois casos.
 */
export function podeSinalizarUso(
  totalDoCatalogo: number,
  carregados: number,
): boolean {
  return Number.isFinite(totalDoCatalogo) && carregados >= totalDoCatalogo;
}

/**
 * A frase que substitui o botão de excluir quando a opção está em uso.
 *
 * Ela diz o CONSERTO, e não só a proibição: excluir uma categoria em uso exige
 * primeiro tirar os produtos dela. Sem isso, o gestor fica sabendo que não pode
 * e não fica sabendo o que fazer.
 */
export function motivoParaNaoExcluir(emUso: boolean): string | null {
  if (!emUso) return null;
  return "Em uso por algum produto — troque a opção nesses produtos antes de excluir.";
}

/** A opção nova, antes de ir ao servidor. Vazio não vira `POST`: o backend
 *  recusaria com 400, e uma ida à rede para descobrir que o campo está em
 *  branco é uma ida a menos que a tela podia poupar. */
export function validarNovaOpcao(valor: string): string | null {
  if ((valor ?? "").trim() === "") return "Escreva o valor antes de adicionar.";
  return null;
}

/* ==========================================================================
 * BLOCO 3 — BLING (a sonda)
 * ========================================================================== */

/** O que `GET /bling/status` responde. Ele responde SEMPRE, ligado ou não — é
 *  o endpoint que diagnostica o desligado. */
export type SondaDoBling = {
  ativo?: boolean;
  nfeAuto?: boolean;
  rastreioCron?: boolean;
  configurado?: boolean;
  token?: { ok?: boolean; erro?: string };
};

export type EstadoDaIntegracao = {
  chave: string;
  titulo: string;
  texto: string;
  tom: TomDeStatus;
};

/**
 * O estado da integração, NA ORDEM DA VIDA DA CREDENCIAL — e a ordem é a coisa
 * que não se reordena.
 *
 * É a mesma doutrina de `estadoDoBling` para o documento fiscal, aplicada à
 * outra ponta: as perguntas vão da mais fundamental para a mais superficial,
 * porque cada uma só faz sentido depois da anterior. Perguntar "está ativo?"
 * antes de "as credenciais existem?" produz "desligado" para uma instalação que
 * nunca foi configurada — e manda o gestor procurar um interruptor em vez do
 * cadastro.
 *
 *   1. a sonda não respondeu ..... não se sabe nada. NÃO é "desligado".
 *   2. sem credencial ............ estado de FÁBRICA, não erro. Sem vermelho:
 *                                  R21 o reserva a erro e destruição, e pintar
 *                                  de vermelho o estado normal de quem nunca
 *                                  ligou a integração ensina a ignorar
 *                                  vermelho. Foi a mesma decisão da caixa azul
 *                                  do painel legado.
 *   3. credencial que não renova .. ISSO é erro: o refresh token rotativo
 *                                  expirou ou foi invalidado, e a NF-e vai
 *                                  falhar no pior momento — com o pedido do
 *                                  cliente parado.
 *   4. tudo certo, BLING_ATIVO=false . o interruptor está desligado de
 *                                  propósito. Alerta, porque nada vai ao ERP.
 *   5. ligada .................... sucesso.
 */
export function estadoDaIntegracao(
  sonda: SondaDoBling | null,
): EstadoDaIntegracao {
  if (!sonda) {
    return {
      chave: "sem-resposta",
      titulo: "Não deu para perguntar",
      texto:
        "A sonda do Bling não respondeu. Isso não quer dizer que a integração " +
        "está desligada — quer dizer que não se sabe. Recarregue a página.",
      tom: "neutro",
    };
  }

  if (!sonda.configurado) {
    return {
      chave: "sem-credencial",
      titulo: "Nunca foi configurada",
      texto:
        "Faltam BLING_CLIENT_ID e BLING_CLIENT_SECRET na publicação da API. " +
        "Isto é o estado de fábrica, não um defeito: enquanto não houver " +
        "credencial, nenhum pedido vai ao ERP e nenhuma nota é emitida.",
      tom: "neutro",
    };
  }

  if (!sonda.token?.ok) {
    return {
      chave: "token-invalido",
      titulo: "A autorização não renova",
      texto:
        sonda.token?.erro ||
        "O Bling recusou a renovação do token e não disse por quê.",
      // O único tom de erro deste bloco, e ele é erro de verdade: com o token
      // parado, a emissão de NF-e falha com o pedido do cliente já pago.
      tom: "erro",
    };
  }

  if (!sonda.ativo) {
    return {
      chave: "desligada",
      titulo: "Configurada, mas desligada",
      texto:
        "A credencial funciona e a autorização renova, mas BLING_ATIVO não " +
        "está em 'true': nenhum pedido é enviado ao ERP e nenhuma nota sai.",
      tom: "alerta",
    };
  }

  return {
    chave: "ligada",
    titulo: "Ligada",
    texto:
      "A credencial funciona, a autorização renova e os pedidos pagos vão ao " +
      "ERP. Emitir a nota de um pedido continua sendo feito dentro do pedido.",
    tom: "sucesso",
  };
}

/**
 * Os interruptores secundários, com o nome da variável que os controla.
 *
 * Eles são só LEITURA aqui, e a tela diz isso: não há rota que os mude. Nomear
 * a variável é o que transforma "está desligado" em algo acionável — sem o
 * nome, o gestor abre chamado para perguntar qual é.
 */
export function interruptoresDoBling(
  sonda: SondaDoBling | null,
): { rotulo: string; variavel: string; ligado: boolean }[] {
  return [
    {
      rotulo: "Emitir NF-e automaticamente",
      variavel: "BLING_NFE_AUTO",
      ligado: Boolean(sonda?.nfeAuto),
    },
    {
      rotulo: "Buscar rastreio periodicamente",
      variavel: "BLING_RASTREIO_CRON",
      ligado: Boolean(sonda?.rastreioCron),
    },
  ];
}

/**
 * A ressalva que a tela precisa fazer sobre si mesma: **não há como
 * (re)autorizar o Bling pelo painel.**
 *
 * O fluxo OAuth do Bling usa refresh token ROTATIVO: o primeiro é colado à mão
 * em `BLING_REFRESH_TOKEN` e, a cada renovação, o Bling invalida o usado e
 * devolve outro — que o `blingClient` grava em
 * `canastra.config_loja.bling_refresh_token`. Não existe rota de callback nem
 * caminho de aplicação para colar um token novo. Quando a corrente quebra
 * (a API ficou parada tempo demais, alguém revogou no Bling), o conserto é
 * gerar outro refresh token no painel do Bling e publicar a API de novo.
 *
 * Dizer isso é o que separa "a tela não tem o botão" de "a tela está quebrada".
 * Está RELATADO como falta de backend.
 */
export const SEM_REAUTORIZACAO_PELO_PAINEL =
  "Não dá para (re)autorizar o Bling por aqui: o primeiro token é colado na " +
  "publicação da API, em BLING_REFRESH_TOKEN, e a partir daí ele se renova " +
  "sozinho. Se a autorização parar de renovar, é preciso gerar outro token no " +
  "painel do Bling e publicar a API de novo.";
