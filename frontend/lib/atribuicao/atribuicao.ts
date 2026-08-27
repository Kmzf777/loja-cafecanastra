/**
 * DE ONDE VEIO A VENDA — a captura, e ela e toda do lado do cliente.
 *
 * As dez colunas existem em `canastra.pedidos` desde a 0033 (`utm_source`,
 * `utm_medium`, `utm_campaign`, `utm_content`, `utm_term`, `canal`, `referrer`,
 * `landing_page`, `gclid`, `fbclid`) e ate a Onda 6 nenhuma delas recebia nada.
 *
 * O DADO E PERECIVEL, e e por isso que ele nao pode esperar: nao ha como
 * reconstruir depois de onde veio um pedido — nem pelo Mercado Pago, nem pelo
 * Bling. Cada dia sem captura e um dia de vendas cuja origem se perde para
 * sempre.
 *
 * ---------------------------------------------------------------------------
 * POR QUE ESTE MODULO NAO SABE O QUE E UM NAVEGADOR
 * ---------------------------------------------------------------------------
 *
 * A home e SSG: `generateStaticParams()` mais `revalidate = 3600` fazem as tres
 * homes sairem do build. Qualquer `cookies()`, `headers()` ou `searchParams`
 * introduzido nela a derruba para render sob demanda, com uma ida ao servidor
 * por visita. Entao a captura tem de ser do lado do CLIENTE — a URL ja esta no
 * navegador — e guardada junto da sacola.
 *
 * Aqui vivem so as decisoes, em funcoes puras que recebem string e devolvem
 * objeto: o que e uma chegada nova, qual e o canal, o que sobrescreve o que, e
 * o que vai no corpo do checkout. Quem toca `localStorage` e
 * `armazenamento.ts`; quem roda no navegador e `<CapturaDeOrigem>`.
 *
 * ---------------------------------------------------------------------------
 * LGPD
 * ---------------------------------------------------------------------------
 *
 * `gclid` e `fbclid` sao identificadores de CLIQUE e a 0033 ja os poe na
 * redacao de exclusao. Aqui a consequencia pratica e dupla: eles nunca entram
 * em log, e `referrer`/`landing_page` viajam SEM QUERY STRING. A landing page
 * de um anuncio carrega o mesmo `gclid` por construcao
 * (`/cafes?utm_source=google&gclid=Cj0KAQ`), e guardar o identificador na URL
 * ao lado da coluna redigida seria teatro de privacidade — o proprio comentario
 * da 0033 chama isso pelo nome. Todo parametro que importa ja tem coluna
 * propria, entao a query string nao carrega informacao nenhuma que se perca.
 */

/** O que se sabe sobre uma chegada. Todo campo e opcional menos os dois. */
export type Atribuicao = {
  utm_source?: string;
  utm_medium?: string;
  utm_campaign?: string;
  utm_content?: string;
  utm_term?: string;
  /** A origem em UMA palavra — ver `derivarCanal`. Sempre presente. */
  canal: Canal;
  /** Origem + caminho de quem indicou, sem query string. */
  referrer?: string;
  /** Caminho da primeira pagina desta chegada, sem query string. */
  landing_page?: string;
  gclid?: string;
  fbclid?: string;
  /** Milissegundos do relogio do navegador — so para a janela de atribuicao. */
  capturadaEm: number;
};

/**
 * O vocabulario de `pedidos.canal`, e sao QUATRO palavras.
 *
 * A coluna e a que a tela de pedidos mostra sem obrigar ninguem a ler cinco
 * utms (0033). Um quinto valor a tornaria tao ilegivel quanto os utms crus.
 */
export type Canal = "pago" | "organico" | "indicacao" | "direto";

/**
 * TETO DE TRANSPORTE, e ele nao e a normalizacao da 0033.
 *
 * A 0033 e explicita: as dez colunas nao tem CHECK nenhum, guardam o que
 * chegou CRU, e a canonizacao (minusculo, aparar espaco) e trabalho de quem
 * ESCREVE no banco — o backend. Recusar aqui um `utm_source` esquisito nao
 * produziria relatorio melhor: produziria PEDIDO PERDIDO, com o cliente ja no
 * cartao.
 *
 * O que este teto faz e outra coisa: impedir que uma URL patologica — um
 * encurtador que devolve 40 kB de parametro — vire um corpo de pagamento
 * gigante. Atribuicao e enfeite em cima de um pagamento, e enfeite nao derruba
 * a casa.
 */
export const TETO_DE_CARACTERES = 512;

/**
 * A JANELA DE ATRIBUICAO — 30 dias.
 *
 * Sem ela, o `gclid` de um anuncio de fevereiro atribuiria a venda de agosto ao
 * Google, e o relatorio de campanha ficaria melhor quanto mais VELHO fosse o
 * clique. Passada a janela, a proxima chegada recomeça a contagem: uma visita
 * direta um mes depois e uma visita direta, e e assim que ela deve aparecer.
 */
export const JANELA_DE_ATRIBUICAO_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * `utm_medium` que significa "houve dinheiro neste clique".
 *
 * A lista e de PREFIXOS conhecidos do mercado, nao um vocabulario fechado: quem
 * cadastra a campanha e uma pessoa, e `paid_social`, `paid-social` e
 * `paidsocial` sao a mesma intencao escrita de tres jeitos.
 */
const MEIOS_PAGOS = [
  "cpc",
  "ppc",
  "cpm",
  "cpv",
  "paid",
  "display",
  "banner",
  "retargeting",
  "remarketing",
];

/**
 * Hosts de busca. Casa por SUFIXO para pegar `google.com.br`, `google.co.uk` e
 * companhia sem listar os cinquenta dominios do Google um a um.
 */
const BUSCADORES = [
  "google.",
  "bing.com",
  "duckduckgo.com",
  "yahoo.",
  "ecosia.org",
  "qwant.com",
  "startpage.com",
  "brave.com",
  "baidu.com",
  "yandex.",
  "ask.com",
];

/** Apara e corta. Vazio vira `undefined` — coluna nula e melhor que string vazia. */
export function limparValor(bruto: string | null | undefined): string | undefined {
  if (typeof bruto !== "string") return undefined;
  const limpo = bruto.trim().slice(0, TETO_DE_CARACTERES);
  return limpo === "" ? undefined : limpo;
}

/** O host de uma URL, ou `undefined` quando ela nem URL e. */
function hostDe(url: string): string | undefined {
  try {
    return new URL(url).host.toLowerCase();
  } catch {
    return undefined;
  }
}

function ehBuscador(host: string): boolean {
  return BUSCADORES.some((b) => host === b || host.endsWith(b) || host.includes(b));
}

/**
 * A ORIGEM EM UMA PALAVRA, e a ordem das perguntas e a decisao.
 *
 *  1. Houve dinheiro no clique? Identificador de clique do Google ou da Meta,
 *     ou um `utm_medium` de midia paga → `pago`. Vem primeiro porque e a unica
 *     das quatro que tem custo do outro lado, e confundi-la com organico faz o
 *     relatorio de retorno sobre investimento mentir para os dois lados.
 *  2. Veio de um buscador, sem ser anuncio? → `organico`.
 *  3. Veio de FORA de algum outro jeito — outro site, uma rede social, um
 *     e-mail, um QR code com utm na embalagem? → `indicacao`. Alguem
 *     encaminhou, e nao foi por clique pago nem por busca.
 *  4. Nada disso: a pessoa digitou o endereco, ou veio de um lugar que nao se
 *     anuncia (aplicativo, PDF, mensagem). → `direto`.
 */
export function derivarCanal(dados: {
  utm_medium?: string;
  utm_source?: string;
  utm_campaign?: string;
  gclid?: string;
  fbclid?: string;
  hostDoReferrer?: string;
}): Canal {
  if (dados.gclid || dados.fbclid) return "pago";

  const meio = (dados.utm_medium ?? "").toLowerCase();
  if (MEIOS_PAGOS.some((m) => meio.includes(m))) return "pago";

  if (dados.hostDoReferrer && ehBuscador(dados.hostDoReferrer)) return "organico";

  if (dados.utm_source || dados.utm_medium || dados.utm_campaign) {
    return "indicacao";
  }
  if (dados.hostDoReferrer) return "indicacao";

  return "direto";
}

/**
 * A chegada, lida da URL do navegador e do `document.referrer`.
 *
 * `agoraMs` entra por parametro em vez de sair de `Date.now()` aqui dentro pelo
 * motivo de sempre: relogio dentro de funcao pura e teste que so passa hoje.
 *
 * REFERRER DO PROPRIO SITE NAO E REFERRER. Sem esta verificacao, clicar de
 * `/cafes` para `/cafes/classico` registraria a loja como se ela tivesse
 * indicado a si mesma, e todo pedido viraria `indicacao` no relatorio.
 */
export function lerChegada({
  url,
  referrer,
  agoraMs,
}: {
  url: string;
  referrer?: string | null;
  agoraMs: number;
}): Atribuicao | null {
  let parametros: URLSearchParams;
  let caminho: string;
  let hostAtual: string;
  try {
    const u = new URL(url);
    parametros = u.searchParams;
    caminho = u.pathname;
    hostAtual = u.host.toLowerCase();
  } catch {
    // URL que nao se le nao produz atribuicao. Nao e caminho hipotetico: este
    // modulo tambem roda a partir do que estiver gravado no `localStorage`.
    return null;
  }

  const campos = {
    utm_source: limparValor(parametros.get("utm_source")),
    utm_medium: limparValor(parametros.get("utm_medium")),
    utm_campaign: limparValor(parametros.get("utm_campaign")),
    utm_content: limparValor(parametros.get("utm_content")),
    utm_term: limparValor(parametros.get("utm_term")),
    gclid: limparValor(parametros.get("gclid")),
    fbclid: limparValor(parametros.get("fbclid")),
  };

  const hostDoReferrer = referrer ? hostDe(referrer) : undefined;
  const referrerExterno =
    hostDoReferrer && hostDoReferrer !== hostAtual ? hostDoReferrer : undefined;

  return {
    ...semVazios(campos),
    canal: derivarCanal({ ...campos, hostDoReferrer: referrerExterno }),
    ...(referrerExterno
      ? { referrer: limparValor(semQueryString(referrer as string)) }
      : {}),
    ...(limparValor(caminho) ? { landing_page: limparValor(caminho) } : {}),
    capturadaEm: agoraMs,
  };
}

/** Origem + caminho, sem `?` nem `#` — ver a nota de LGPD no topo. */
function semQueryString(url: string): string {
  try {
    const u = new URL(url);
    return `${u.origin}${u.pathname}`;
  } catch {
    return url;
  }
}

function semVazios<T extends Record<string, string | undefined>>(o: T): T {
  return Object.fromEntries(
    Object.entries(o).filter(([, v]) => v !== undefined),
  ) as T;
}

/** Ha algo nesta chegada que IDENTIFIQUE uma campanha? */
export function temMarcadorDeCampanha(a: Atribuicao): boolean {
  return Boolean(
    a.utm_source ||
      a.utm_medium ||
      a.utm_campaign ||
      a.utm_content ||
      a.utm_term ||
      a.gclid ||
      a.fbclid,
  );
}

/**
 * O QUE SOBRESCREVE O QUE — a regra que decide de quem e a venda.
 *
 * Devolve o que deve ser gravado, ou `null` para "nao toque no que ja esta la".
 *
 *  - Chegada COM marcador de campanha sempre grava. E um contato novo e
 *    identificavel: a pessoa clicou num anuncio hoje, e atribuir a venda a
 *    campanha de tres semanas atras porque ela chegou primeiro faria o
 *    relatorio premiar o clique mais VELHO.
 *  - Nada guardado ainda grava qualquer chegada, inclusive a sem marcador. Sem
 *    isto, `direto`, `organico` e `indicacao` nunca existiriam no relatorio —
 *    so campanha apareceria, e toda venda pareceria vir de anuncio.
 *  - Guardado e ainda dentro da janela: NAO toca. E aqui que mora o "primeiro
 *    contato": navegar de `/cafes` para a sacola nao pode apagar o utm que
 *    trouxe a pessoa, e sem esta linha ele seria apagado na primeira troca de
 *    pagina, porque a URL interna nao tem utm nenhum.
 *  - Guardado e VENCIDO: grava. Ver `JANELA_DE_ATRIBUICAO_MS`.
 */
export function decidirGravacao(
  guardada: Atribuicao | null,
  nova: Atribuicao,
  agoraMs: number,
): Atribuicao | null {
  if (temMarcadorDeCampanha(nova)) return nova;
  if (!guardada) return nova;
  if (agoraMs - guardada.capturadaEm > JANELA_DE_ATRIBUICAO_MS) return nova;
  return null;
}

/** As dez colunas de `pedidos`, no formato do corpo do checkout. */
export type CorpoDeAtribuicao = {
  utm_source?: string;
  utm_medium?: string;
  utm_campaign?: string;
  utm_content?: string;
  utm_term?: string;
  canal?: string;
  referrer?: string;
  landing_page?: string;
  gclid?: string;
  fbclid?: string;
};

/**
 * O que viaja no corpo do `process_payment` — e `capturadaEm` NAO viaja.
 *
 * Aquele carimbo e do navegador e serve a UMA pergunta local: a janela de
 * atribuicao ja venceu? Nao ha coluna para ele, o relogio da maquina do
 * cliente nao e prova de nada, e `pedidos.criado_em` ja diz quando a venda
 * aconteceu.
 *
 * REGRA DURA, E ELA VALE DINHEIRO: nenhum destes campos entra na assinatura de
 * `chaveDestePedido()`. Chave de idempotencia diferente numa retentativa e
 * exatamente o que cobra duas vezes quando a primeira resposta se perde na
 * rede. Duas tentativas do mesmo pedido tem de gerar a mesma chave, com ou sem
 * utm — ha teste em `checkout.test.ts` cravando isso.
 *
 * Devolve `null` quando nao ha nada a dizer, para o corpo nao carregar um
 * objeto vazio.
 */
export function corpoDeAtribuicao(
  a: Atribuicao | null,
): CorpoDeAtribuicao | null {
  if (!a) return null;
  const corpo: CorpoDeAtribuicao = semVazios({
    utm_source: a.utm_source,
    utm_medium: a.utm_medium,
    utm_campaign: a.utm_campaign,
    utm_content: a.utm_content,
    utm_term: a.utm_term,
    canal: a.canal,
    referrer: a.referrer,
    landing_page: a.landing_page,
    gclid: a.gclid,
    fbclid: a.fbclid,
  });
  return Object.keys(corpo).length > 0 ? corpo : null;
}
