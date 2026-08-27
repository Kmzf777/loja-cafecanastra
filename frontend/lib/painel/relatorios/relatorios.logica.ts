import { diaEmSaoPaulo, janelaDeDias, somarDias } from "../data";
import { montarUrl, textoDoParametro, type ChipDeFiltro } from "../filtros";
import { STATUS_DE_PEDIDO, rotuloDoStatus } from "../status";

/**
 * A decisão inteira da tela de Relatórios — sem React e sem fetch.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * O QUE ESTA TELA PODE PROMETER, E O QUE ELA NÃO PODE
 * ════════════════════════════════════════════════════════════════════════════
 *
 * Não existe rota de agregação no Express. Não há `GET /admin/relatorios`,
 * `/vendas-por-produto` nem nada parecido: o que existe é
 * `GET /admin/orders?de&ate&status&page&limit`, paginado, com teto de 100 por
 * página. Então este módulo AGREGA NO SERVIDOR DO NEXT, lendo páginas daquela
 * rota — e essa escolha tem um teto, que está declarado (`TETO_DE_PEDIDOS`),
 * medido (`coberturaDoRelatorio`) e escrito na tela.
 *
 * Um relatório que cobre em silêncio só os mil pedidos mais recentes é pior que
 * relatório nenhum, porque parece uma resposta. Um que diz "esta conta cobre os
 * 1.000 mais recentes; o filtro tem 3.482" é uma ferramenta honesta enquanto a
 * loja for pequena, e diz exatamente o que falta para deixar de ter teto.
 *
 * TRÊS RELATÓRIOS PEDIDOS NÃO EXISTEM AQUI, e cada ausência tem uma causa
 * verificada — estão em `RELATORIOS_IMPOSSIVEIS`, e a tela as mostra em vez de
 * desenhar uma tabela de zeros. O caso mais importante é a MARGEM: a migração
 * 0034 decidiu guardar `custo_centavos` em cada item de `pedidos.itens`, mas o
 * checkout ainda não o escreve (`PaymentController.validatedItems` monta o item
 * sem essa chave). Um relatório de margem hoje leria custo zero em todo pedido
 * e informaria 100% de margem — a mentira mais cara que esta tela poderia
 * contar.
 */

export const ROTA_DE_RELATORIOS = "/dashboard/relatorios";

/**
 * O TETO, e por que ele é 1.000.
 *
 * `/admin/orders` tem limite de 100 por página (teto do controller, com o
 * comentário que explica por quê). Dez páginas são dez idas ao Express dentro
 * de uma renderização de Server Component — já é bastante para uma tela que o
 * gestor abre e espera. Vinte páginas dobrariam a espera para cobrir um caso
 * que esta loja não tem hoje, e o teto certo não é "o maior que aguenta": é o
 * menor que serve, DECLARADO, para a conversa sobre a rota de agregação
 * acontecer antes de a loja crescer, e não depois.
 */
export const POR_PAGINA_NA_LEITURA = 100;
export const PAGINAS_NO_MAXIMO = 10;
export const TETO_DE_PEDIDOS = POR_PAGINA_NA_LEITURA * PAGINAS_NO_MAXIMO;

/* -------------------------------------------------------------------------- *
 * O que conta como VENDA
 * -------------------------------------------------------------------------- */

/**
 * Os status que contam como venda — o MESMO recorte do `/dashboard/summary`.
 *
 * GRUPO_ATIVO menos `pendente` e `autorizado`: cancelado, rejeitado e
 * reembolsado ficam de fora porque não são receita, e pendente e autorizado
 * ficam de fora porque ainda não são — um PIX gerado e não pago é um pedido
 * `pendente`, e contá-lo infla o faturamento com dinheiro que talvez nunca
 * chegue.
 *
 * A LISTA É DERIVADA DE `STATUS_DE_PEDIDO`, e não escrita à mão: é a mesma
 * disciplina do resto do painel, e é o que faz um status novo do backend cair
 * automaticamente no lugar certo. `relatorios.logica.test.ts` compara o
 * resultado com `backend/src/utils/statusDePedido.js` lido do disco.
 *
 * QUE ESTE RECORTE SEJA O DO `summary` NÃO É COINCIDÊNCIA E NEM PREGUIÇA: a
 * home do painel mostra "vendas dos últimos 7 dias" com aquele recorte, e um
 * relatório que usasse outro faria as duas telas discordarem sobre o mesmo
 * número — que é o começo de "o sistema está quebrado".
 */
const NAO_SAO_VENDA = ["cancelado", "rejeitado", "reembolsado", "pendente", "autorizado"];

export const STATUS_DE_VENDA: string[] = STATUS_DE_PEDIDO.map((s) => s.valor).filter(
  (valor) => !NAO_SAO_VENDA.includes(valor),
);

/* -------------------------------------------------------------------------- *
 * O contrato de leitura
 * -------------------------------------------------------------------------- */

/**
 * O item dentro de `pedidos.itens` — a fotografia congelada da venda.
 *
 * `price` É UM NÚMERO EM REAIS, e não centavos: o checkout grava
 * `price: bestPrice`, que é reais. A agregação converte para centavos na
 * ENTRADA (`centavosDoItem`) e nunca soma reais em ponto flutuante — somar
 * 0.1 + 0.2 vinte mil vezes produz um total que não fecha com o extrato, e
 * ninguém acha a causa.
 *
 * `custo_centavos` ESTÁ DECLARADO E É OPCIONAL, e a opcionalidade é o registro
 * do que falta: 0034 decidiu a chave, o checkout ainda não a escreve. Enquanto
 * ela não vier, `RELATORIOS_IMPOSSIVEIS` explica a ausência do relatório de
 * margem em vez de a tela informar 100%.
 */
export type ItemDoPedido = {
  product_id?: string | number | null;
  name?: string | null;
  price?: number | string | null;
  quantity?: number | string | null;
  custo_centavos?: number | null;
};

/** A linha de `/admin/orders` — só os campos que o relatório usa. */
export type PedidoDoRelatorio = {
  order_id: string;
  status: string;
  created_at: string;
  /** REAIS, COMO STRING — é `numeric` do pg. A unidade está no nome do tipo
   *  porque nesta loja ela não é adivinhável, e trocar por centavos erra por
   *  cem sem nenhum sintoma. */
  total_amount: string | number | null;
  discount?: string | number | null;
  coupon_code?: string | null;
  items?: ItemDoPedido[] | null;
};

export type RespostaDePedidos = {
  data: PedidoDoRelatorio[];
  total: number;
  totalPages: number;
  page: number;
};

/* -------------------------------------------------------------------------- *
 * O estado da tela
 * -------------------------------------------------------------------------- */

export const RELATORIOS = [
  { valor: "produto", rotulo: "Vendas por produto" },
  { valor: "cupom", rotulo: "Vendas por cupom" },
  { valor: "dia", rotulo: "Vendas por dia" },
  { valor: "status", rotulo: "Pedidos por status" },
] as const;

export type NomeDoRelatorio = (typeof RELATORIOS)[number]["valor"];

export type EstadoDoRelatorio = {
  relatorio: NomeDoRelatorio;
  /** YYYY-MM-DD, o formato que `/admin/orders` valida. */
  de: string;
  ate: string;
  ordem: string;
  direcao: "asc" | "desc";
  /** R30: o gráfico é OPCIONAL e tem de poder ser desligado. Na URL, para o
   *  desligamento sobreviver ao F5 — quem desliga um gráfico está tentando ler
   *  a tabela, e vê-lo voltar a cada navegação é hostil. */
  grafico: boolean;
};

const FORMATO_DATA = /^\d{4}-\d{2}-\d{2}$/;

/** A janela padrão: os últimos 30 dias, contados em São Paulo. */
export const DIAS_PADRAO = 30;

export function lerEstado(
  parametros: Record<string, string | string[] | undefined>,
  hoje: string = diaEmSaoPaulo(),
): EstadoDoRelatorio {
  const padrao = janelaDeDias(DIAS_PADRAO, hoje);

  const relatorio = textoDoParametro(parametros.relatorio);
  const de = textoDoParametro(parametros.de);
  const ate = textoDoParametro(parametros.ate);
  const direcao = textoDoParametro(parametros.direcao);

  const escolhido = RELATORIOS.some((r) => r.valor === relatorio)
    ? (relatorio as NomeDoRelatorio)
    : "produto";

  /*
    DATA MALFORMADA CAI NO PADRÃO, e não vai para o backend: `/admin/orders`
    responde 400 com frase para formato inválido, e um link velho viraria uma
    tarja de erro em vez do relatório do mês.

    E A JANELA INVERTIDA TAMBÉM: com `de > ate` o backend não erra — devolve
    ZERO pedidos, sem reclamar. A tela desenharia "nenhuma venda no período", e
    ninguém desconfiaria de um período que ele mesmo montou errado.
  */
  let inicio = FORMATO_DATA.test(de) ? de : padrao.de;
  let fim = FORMATO_DATA.test(ate) ? ate : padrao.ate;
  if (inicio > fim) [inicio, fim] = [fim, inicio];

  const ordemPadrao = ORDEM_PADRAO[escolhido];
  const ordem = textoDoParametro(parametros.ordem);

  return {
    relatorio: escolhido,
    de: inicio,
    ate: fim,
    ordem: colunasDe(escolhido).includes(ordem) ? ordem : ordemPadrao.ordem,
    direcao: direcao === "asc" || direcao === "desc" ? direcao : ordemPadrao.direcao,
    // Ausente é LIGADO: o gráfico é o padrão útil, e só quem o desligou de
    // propósito carrega `grafico=nao` na URL.
    grafico: textoDoParametro(parametros.grafico) !== "nao",
  };
}

/** As colunas ordenáveis de cada relatório — é a lista que valida `?ordem=`. */
export function colunasDe(relatorio: NomeDoRelatorio): string[] {
  if (relatorio === "produto") return ["nome", "unidades", "receita", "pedidos"];
  if (relatorio === "cupom") return ["codigo", "pedidos", "desconto", "receita"];
  if (relatorio === "dia") return ["dia", "pedidos", "receita"];
  return ["status", "pedidos", "receita"];
}

const ORDEM_PADRAO: Record<
  NomeDoRelatorio,
  { ordem: string; direcao: "asc" | "desc" }
> = {
  // Receita decrescente: a primeira pergunta de "vendas por produto" é sempre
  // "o que mais vendeu", nunca "o que vem primeiro no alfabeto".
  produto: { ordem: "receita", direcao: "desc" },
  cupom: { ordem: "receita", direcao: "desc" },
  // O dia é a exceção: série temporal se lê na ordem do tempo, e uma linha do
  // tempo ordenada por receita não é uma linha do tempo.
  dia: { ordem: "dia", direcao: "asc" },
  status: { ordem: "pedidos", direcao: "desc" },
};

export function urlDaTela(estado: Partial<EstadoDoRelatorio>): string {
  return montarUrl(ROTA_DE_RELATORIOS, {
    relatorio: estado.relatorio && estado.relatorio !== "produto" ? estado.relatorio : undefined,
    de: estado.de,
    ate: estado.ate,
    ordem: estado.ordem,
    direcao: estado.direcao,
    grafico: estado.grafico === false ? "nao" : undefined,
  });
}

/**
 * A URL de um clique no cabeçalho da coluna.
 *
 * Clicar na coluna JÁ ordenada inverte a direção; clicar noutra começa pela
 * direção padrão DAQUELA coluna — texto sobe (A→Z é o que se espera de nome) e
 * número desce (o maior primeiro é o que se procura num relatório).
 */
export function urlDaOrdenacao(
  estado: EstadoDoRelatorio,
  coluna: string,
): string {
  const inverte = estado.ordem === coluna;
  const direcao: "asc" | "desc" = inverte
    ? estado.direcao === "asc"
      ? "desc"
      : "asc"
    : COLUNAS_DE_TEXTO.includes(coluna)
      ? "asc"
      : "desc";
  return urlDaTela({ ...estado, ordem: coluna, direcao });
}

const COLUNAS_DE_TEXTO = ["nome", "codigo", "dia", "status"];

export function montarConsulta(estado: EstadoDoRelatorio, pagina: number): string {
  return montarUrl("/admin/orders", {
    de: estado.de,
    ate: estado.ate,
    // A vírgula é o separador que o controller entende — sem ela seriam cinco
    // idas ao Express somadas no navegador.
    status: STATUS_DE_VENDA.join(","),
    page: pagina,
    limit: POR_PAGINA_NA_LEITURA,
  });
}

export function chipsDoRelatorio(estado: EstadoDoRelatorio): ChipDeFiltro[] {
  return [
    {
      chave: "periodo",
      dimensao: "Período",
      valor: `${paraBr(estado.de)} a ${paraBr(estado.ate)}`,
      // O período NÃO é removível — um relatório sem recorte de tempo leria a
      // base inteira e bateria no teto na primeira abertura. O chip existe para
      // MOSTRAR o recorte, e o link o devolve ao padrão em vez de o apagar.
      href: urlDaTela({ ...estado, ...janelaDeDias(DIAS_PADRAO) }),
    },
  ];
}

/** YYYY-MM-DD → dd/mm/aaaa, sem passar por `Date` — R31 sem armadilha de fuso.
 *  `new Date("2026-08-26")` é MEIA-NOITE UTC, que em São Paulo é 25/08 21h: o
 *  caminho "óbvio" imprime o dia anterior no rótulo do próprio filtro. */
export function paraBr(dia: string): string {
  if (!FORMATO_DATA.test(dia)) return "—";
  return `${dia.slice(8, 10)}/${dia.slice(5, 7)}/${dia.slice(0, 4)}`;
}

/* -------------------------------------------------------------------------- *
 * A cobertura — o teto, declarado
 * -------------------------------------------------------------------------- */

export type Cobertura = {
  /** Quantos pedidos o filtro tem, segundo o próprio backend. */
  noFiltro: number;
  /** Quantos entraram na conta. */
  lidos: number;
  completa: boolean;
  /** A frase que a tela mostra. Vazia quando a cobertura é completa — um aviso
   *  que aparece sempre é um aviso que ninguém lê. */
  aviso: string;
};

export function coberturaDoRelatorio(noFiltro: number, lidos: number): Cobertura {
  const completa = lidos >= noFiltro;
  return {
    noFiltro,
    lidos,
    completa,
    aviso: completa
      ? ""
      : `Esta conta cobre os ${lidos} pedidos mais recentes do período; o filtro tem ${noFiltro}. ` +
        "O painel agrega no servidor porque a API não tem rota de totais — encurte o período para uma conta completa.",
  };
}

/* -------------------------------------------------------------------------- *
 * As agregações
 * -------------------------------------------------------------------------- */

/** Reais (número ou string do pg) → centavos inteiros. Ausente é zero. */
export function centavosDeReais(valor: number | string | null | undefined): number {
  if (valor === null || valor === undefined || valor === "") return 0;
  const n = typeof valor === "number" ? valor : Number(valor);
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 100);
}

function quantidadeDe(item: ItemDoPedido): number {
  const n = Number(item.quantity ?? 0);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}

/** O valor de uma linha de item, em centavos: preço unitário × quantidade.
 *  Arredonda o PREÇO antes de multiplicar — é o que o checkout faz
 *  (`Math.round(Number(productDb.price) * 100)`), e fazer diferente produz
 *  divergências de um centavo que ninguém consegue explicar. */
export function centavosDoItem(item: ItemDoPedido): number {
  return centavosDeReais(item.price) * quantidadeDe(item);
}

export type LinhaPorProduto = {
  chave: string;
  nome: string;
  unidades: number;
  receitaCentavos: number;
  pedidos: number;
};

/**
 * Vendas por produto.
 *
 * A CHAVE É `product_id` QUANDO EXISTE, e o NOME quando não — e a ordem
 * importa: `itens` é uma fotografia congelada, então o mesmo produto renomeado
 * aparece com dois nomes ao longo do tempo. Agrupar por nome partiria a linha
 * em duas no dia em que alguém corrigisse um acento. O nome exibido é o da
 * ocorrência MAIS RECENTE, que é o que o gestor reconhece hoje.
 *
 * `pedidos` CONTA PEDIDOS DISTINTOS, e não linhas: dois cafés diferentes no
 * mesmo pedido são um pedido para cada café, mas o mesmo café repetido em duas
 * linhas do mesmo pedido é um pedido só. Sem isso, "em quantos pedidos este
 * café apareceu" viraria "quantas linhas de item existem", que é outra coisa.
 */
export function agregarPorProduto(pedidos: PedidoDoRelatorio[]): LinhaPorProduto[] {
  const porChave = new Map<string, LinhaPorProduto & { deQuaisPedidos: Set<string> }>();

  for (const pedido of pedidos) {
    for (const item of pedido.items ?? []) {
      const nome = (item.name ?? "").trim() || "Produto sem nome";
      const chave =
        item.product_id !== undefined && item.product_id !== null && item.product_id !== ""
          ? `id:${item.product_id}`
          : `nome:${nome.toLowerCase()}`;

      const atual = porChave.get(chave) ?? {
        chave,
        nome,
        unidades: 0,
        receitaCentavos: 0,
        pedidos: 0,
        deQuaisPedidos: new Set<string>(),
      };

      atual.nome = nome;
      atual.unidades += quantidadeDe(item);
      atual.receitaCentavos += centavosDoItem(item);
      atual.deQuaisPedidos.add(pedido.order_id);
      porChave.set(chave, atual);
    }
  }

  return [...porChave.values()].map(({ deQuaisPedidos, ...linha }) => ({
    ...linha,
    pedidos: deQuaisPedidos.size,
  }));
}

export type LinhaPorCupom = {
  chave: string;
  codigo: string;
  pedidos: number;
  descontoCentavos: number;
  receitaCentavos: number;
};

/**
 * Vendas por cupom — e os pedidos SEM cupom entram numa linha própria.
 *
 * Deixá-los de fora faria a soma da coluna "receita" não bater com o
 * faturamento do período, e a primeira reação a um relatório que não fecha é
 * desconfiar do relatório inteiro. A linha "Sem cupom" é a diferença entre uma
 * tabela que fecha e uma que levanta suspeita.
 *
 * O CÓDIGO É COMPARADO EM MAIÚSCULA porque é assim que cupom se escreve e se
 * digita — "VERAO10" e "verao10" são o mesmo cupom, e duas linhas para ele
 * dividiriam o resultado da mesma campanha ao meio.
 */
export const SEM_CUPOM = "Sem cupom";

export function agregarPorCupom(pedidos: PedidoDoRelatorio[]): LinhaPorCupom[] {
  const porChave = new Map<string, LinhaPorCupom>();

  for (const pedido of pedidos) {
    const bruto = (pedido.coupon_code ?? "").trim();
    const codigo = bruto === "" ? SEM_CUPOM : bruto.toUpperCase();

    const atual = porChave.get(codigo) ?? {
      chave: codigo,
      codigo,
      pedidos: 0,
      descontoCentavos: 0,
      receitaCentavos: 0,
    };

    atual.pedidos += 1;
    atual.descontoCentavos += centavosDeReais(pedido.discount);
    atual.receitaCentavos += centavosDeReais(pedido.total_amount);
    porChave.set(codigo, atual);
  }

  return [...porChave.values()];
}

export type LinhaPorDia = {
  chave: string;
  /** YYYY-MM-DD em São Paulo — a chave de ordenação. */
  dia: string;
  /** dd/mm/aaaa — o que o gestor lê. */
  diaBr: string;
  pedidos: number;
  receitaCentavos: number;
};

/**
 * Vendas por dia, com os dias VAZIOS presentes.
 *
 * O DIA É O DE SÃO PAULO — R31. Um pedido das 22h de 26/08 é
 * `2026-08-27T01:00Z`, e agrupá-lo por UTC o joga no dia seguinte: no
 * fechamento do mês, a venda da última noite aparece no mês que vem, e a soma
 * do relatório não bate com a soma dos pedidos. Este é o defeito que destrói a
 * confiança em TODO relatório, e não só neste.
 *
 * OS DIAS SEM VENDA ENTRAM COM ZERO, e isso é sobre o gráfico: uma linha
 * desenhada só com os dias que tiveram venda liga 20/08 a 24/08 com um traço
 * reto e esconde que 21, 22 e 23 foram zero. A queda some do desenho.
 */
export function serieDiaria(
  pedidos: PedidoDoRelatorio[],
  de: string,
  ate: string,
): LinhaPorDia[] {
  const porDia = new Map<string, { pedidos: number; receitaCentavos: number }>();

  for (const pedido of pedidos) {
    /*
      A DATA É CONFERIDA ANTES DE SER FORMATADA, e não depois.

      `diaEmSaoPaulo` embrulha um `Intl.DateTimeFormat`, e `format()` de uma
      data inválida LANÇA `RangeError: Invalid time value` — não devolve
      "Invalid Date". Uma única linha com `criado_em` corrompido derrubaria a
      renderização da tela INTEIRA, e o gestor veria a página de erro do Next
      no lugar do relatório do mês. Medido: o teste "data ilegível no pedido é
      ignorada" reproduzia exatamente esse RangeError.

      A guarda mora aqui e não em `data.ts` porque aquele módulo é compartilhado
      e a decisão de engolir uma data inválida é DESTA tela: num relatório, um
      pedido de data ilegível é um pedido que não entra na série; noutro lugar
      pode ser um erro que precisa aparecer.
    */
    const quando = new Date(pedido.created_at);
    if (Number.isNaN(quando.getTime())) continue;

    const dia = diaEmSaoPaulo(quando);
    if (!FORMATO_DATA.test(dia)) continue;
    const atual = porDia.get(dia) ?? { pedidos: 0, receitaCentavos: 0 };
    atual.pedidos += 1;
    atual.receitaCentavos += centavosDeReais(pedido.total_amount);
    porDia.set(dia, atual);
  }

  const linhas: LinhaPorDia[] = [];
  // Trava de segurança: uma janela absurda (por URL adulterada) não pode virar
  // um laço de um milhão de iterações no servidor.
  for (let dia = de, passos = 0; dia <= ate && passos < 400; dia = somarDias(dia, 1)) {
    passos += 1;
    const achado = porDia.get(dia) ?? { pedidos: 0, receitaCentavos: 0 };
    linhas.push({ chave: dia, dia, diaBr: paraBr(dia), ...achado });
  }
  return linhas;
}

export type LinhaPorStatus = {
  chave: string;
  status: string;
  rotulo: string;
  pedidos: number;
  receitaCentavos: number;
};

/**
 * Pedidos por status — e ele lê os pedidos SEM o recorte de venda.
 *
 * É o único relatório desta tela que quer ver o cancelado e o pendente: a
 * pergunta dele é "onde a fila está parada", não "quanto entrou". Quem chama
 * passa a lista completa; a assinatura não tem como impedir o engano, e por
 * isso está escrito aqui e testado lá.
 */
export function agregarPorStatus(pedidos: PedidoDoRelatorio[]): LinhaPorStatus[] {
  const porStatus = new Map<string, LinhaPorStatus>();

  for (const pedido of pedidos) {
    const status = pedido.status;
    const atual = porStatus.get(status) ?? {
      chave: status,
      status,
      rotulo: rotuloDoStatus(status),
      pedidos: 0,
      receitaCentavos: 0,
    };
    atual.pedidos += 1;
    atual.receitaCentavos += centavosDeReais(pedido.total_amount);
    porStatus.set(status, atual);
  }

  return [...porStatus.values()];
}

/* -------------------------------------------------------------------------- *
 * A ordenação
 * -------------------------------------------------------------------------- */

/**
 * A ordenação da tabela — ESTÁVEL e com o texto comparado em pt-BR.
 *
 * ESTÁVEL PORQUE O EMPATE É COMUM num relatório (três produtos com 2 unidades
 * cada), e uma ordem que muda a cada renderização faz o gestor achar que os
 * dados mudaram. O desempate é pela CHAVE, que é única e não muda.
 *
 * `localeCompare` com `pt-BR` porque "Ácido" tem de vir junto de "Acidez", e
 * não depois de "Zurique" — a comparação de código de caractere põe todo
 * acento no fim do alfabeto.
 */
export function ordenar<L extends { chave: string }>(
  linhas: L[],
  coluna: string,
  direcao: "asc" | "desc",
): L[] {
  const sinal = direcao === "asc" ? 1 : -1;

  return [...linhas].sort((a, b) => {
    const va = valorDaColuna(a, coluna);
    const vb = valorDaColuna(b, coluna);

    let comparacao: number;
    if (typeof va === "number" && typeof vb === "number") {
      comparacao = va - vb;
    } else {
      comparacao = String(va).localeCompare(String(vb), "pt-BR", {
        sensitivity: "base",
        numeric: true,
      });
    }

    if (comparacao !== 0) return comparacao * sinal;
    // O desempate NÃO leva o sinal: a ordem dos empatados é a mesma nas duas
    // direções, que é o que faz inverter a coluna não embaralhar os empates.
    return a.chave.localeCompare(b.chave, "pt-BR");
  });
}

/** O nome da coluna na URL não é o nome do campo — `receita` lê
 *  `receitaCentavos`, e `dia` lê a chave ISO e não o `dd/mm` (ordenar texto
 *  brasileiro poria 01/09 antes de 02/08). */
function valorDaColuna(linha: Record<string, unknown>, coluna: string): number | string {
  if (coluna === "receita") return Number(linha.receitaCentavos ?? 0);
  if (coluna === "desconto") return Number(linha.descontoCentavos ?? 0);
  if (coluna === "dia") return String(linha.dia ?? "");
  if (coluna === "status") return String(linha.rotulo ?? "");
  const bruto = linha[coluna];
  if (typeof bruto === "number") return bruto;
  return String(bruto ?? "");
}

/* -------------------------------------------------------------------------- *
 * R29: a fórmula de cada métrica, e o modelo de atribuição
 * -------------------------------------------------------------------------- */

/**
 * A fórmula de cada coluna, em português — R29.
 *
 * Ela existe porque o número VAI divergir do extrato do Mercado Pago, por
 * desenho e não por defeito, e sem o rótulo a conclusão é "o sistema está
 * quebrado". Um gestor que lê "receita = soma de `pedidos.total`, com frete e
 * já com desconto" sabe por que o extrato do MP mostra outro número — e sabe
 * qual dos dois responde a pergunta dele.
 */
export const FORMULAS: Record<string, string> = {
  receita:
    "Soma de `pedidos.total` — o valor cobrado, JÁ com frete e JÁ com desconto abatido. Não é o líquido: a taxa do Mercado Pago não é descontada aqui, então este número é sempre maior que o do extrato.",
  unidades:
    "Soma de `quantity` de cada linha de item do pedido, na fotografia congelada em `pedidos.itens`.",
  pedidos:
    "Contagem de pedidos DISTINTOS. Um pedido com três cafés conta uma vez em cada café e uma vez no total.",
  desconto:
    "Soma de `pedidos.desconto` — só o desconto de CUPOM registrado na coluna do pedido. Promoção automática de vitrine abate o preço do item e não aparece aqui.",
  receitaPorProduto:
    "Soma de (preço unitário congelado × quantidade) de cada linha de item. NÃO inclui frete, e por isso a soma desta coluna é menor que a receita total do período.",
};

/** O modelo de atribuição, mostrado AO LADO do número — R29. */
export const MODELO_DE_ATRIBUICAO =
  "Atribuição por pedido, no dia da CRIAÇÃO do pedido, fuso America/São_Paulo. Contam os status " +
  STATUS_DE_VENDA.join(", ") +
  " — pendente e autorizado ficam de fora porque ainda não são receita.";

/* -------------------------------------------------------------------------- *
 * O que a tela precisa DIZER, por escrito
 * -------------------------------------------------------------------------- */

export type Divergencia = { titulo: string; texto: string };

/**
 * As divergências conhecidas — e elas ficam na tela, não num documento.
 *
 * Cada uma é um chamado que não vai existir. R28 chama isso de "latência
 * declarada" e mede o efeito: metade dos chamados de relatório é alguém
 * comparando dois números que nunca foram para bater.
 */
export const DIVERGENCIAS: Divergencia[] = [
  {
    titulo: "O GA4 conta PIX não pago como venda; este relatório não conta",
    texto:
      "O evento `purchase` do GA4 dispara na confirmação do checkout, na resposta síncrona do Mercado Pago — inclusive para um PIX que ainda não foi pago (lib/analytics.ts). É deliberado: não há outra visita garantida, porque o QR se paga no app do banco. Aqui, um PIX pendente fica de fora até virar `aprovado`. Cruzar os dois números diverge por isso, não por defeito.",
  },
  {
    titulo: "Nenhum pedido tem origem gravada ainda — não há relatório de campanha",
    texto:
      "As colunas de UTM em `pedidos` nasceram na migração 0033, mas a CAPTURA na vitrine ainda não existe (é da Onda 6). Então hoje pedido nenhum carrega de onde veio, e um relatório de origem mostraria uma tabela vazia que se parece com queda de vendas. Ele não é desenhado até haver dado.",
  },
  {
    titulo: "A atribuição junta só por campanha, e nunca por origem/meio",
    texto:
      "`canastra.campanhas` tem `utm_campaign` com UNIQUE, e é essa a única chave de junção com o pedido. `utm_source` e `utm_medium` existem na coluna do pedido mas não têm par do lado da campanha — «Google/CPC» e «Google/orgânico» não serão separáveis mesmo depois da captura.",
  },
  {
    titulo: "O extrato do Mercado Pago mostra outro número, e os dois estão certos",
    texto:
      "Aqui a receita é o valor COBRADO. O extrato do MP é o valor LÍQUIDO, já sem a taxa da adquirente, e liquida em datas diferentes das do pedido. Os dois respondem perguntas diferentes: este diz quanto a loja vendeu, o extrato diz quanto entrou na conta.",
  },
];

export type RelatorioImpossivel = {
  titulo: string;
  /** O que exatamente falta. É o texto que a próxima onda vai usar como tarefa. */
  falta: string;
};

/**
 * O que foi PEDIDO e não pôde ser feito — com a causa verificada de cada um.
 *
 * ESTA LISTA VAI PARA A TELA. Um relatório que o gestor procura e não acha é
 * um chamado; um que ele lê "não existe ainda porque o custo não é gravado na
 * venda" é uma informação. E é a lista que a próxima onda usa como tarefa.
 */
export const RELATORIOS_IMPOSSIVEIS: RelatorioImpossivel[] = [
  {
    titulo: "Resultado econômico com custo e margem",
    falta:
      "A migração 0034 decidiu congelar `custo_centavos` em cada item de `pedidos.itens`, mas o checkout ainda não grava a chave — `PaymentController` monta o item com nome, preço, quantidade e medidas, e sem custo. Um relatório de margem hoje leria custo zero em todo pedido e informaria 100% de margem, que é pior que não existir. Falta o checkout escrever a chave (e o passado não tem conserto: o custo daquele dia não está guardado em lugar nenhum).",
  },
  {
    titulo: "Vendas por categoria",
    falta:
      "A categoria não é congelada no item do pedido: `pedidos.itens` guarda nome, preço, quantidade e medidas. Agrupar por categoria exigiria juntar com `produtos` pelo id — o que só o servidor consegue fazer, e não há rota que o faça.",
  },
  {
    titulo: "Assinaturas ativas, novas e canceladas no período",
    falta:
      "Não há rota que devolva assinatura por período nem por data de cancelamento. A tela de Assinaturas lista o estado de HOJE, e o estado de hoje não responde «quantas foram canceladas em julho».",
  },
  {
    titulo: "Clientes novos contra recorrentes",
    falta:
      "«Novo» quer dizer primeiro pedido de todos os tempos, e isso não é decidível a partir de uma janela de datas: quem comprou pela primeira vez em julho pode ter comprado em 2024. Precisaria da data do primeiro pedido de cada cliente, que nenhuma rota devolve.",
  },
];
