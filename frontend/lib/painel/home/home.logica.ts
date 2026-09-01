import { montarUrl } from "../filtros";
import { formatarReais } from "../dinheiro";

/**
 * A DECISÃO da tela de Início — sem React, sem fetch, sem DOM (spec §2.8).
 *
 * A TELA É UMA FILA DE TRABALHO, NÃO UMA VITRINE DE RECEITA. A frase da pesquisa
 * é literal: *"o lojista não abre o painel para admirar receita, abre para saber
 * o que embalar"*. Então o topo é o que precisa ser feito hoje, cada linha é um
 * LINK para a lista já filtrada, e os números de gestão vêm abaixo — nunca
 * acima.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * A REGRA QUE GOVERNA ESTE ARQUIVO INTEIRO: `null` NÃO É `0`.
 *
 * Toda contagem daqui é `number | null`. `0` significa "perguntei e não há
 * nenhum"; `null` significa "não consegui perguntar". Colapsar os dois é o
 * defeito mais caro que um painel pode ter — o gestor lê "não tenho nada para
 * despachar" numa manhã em que há trinta pedidos e a API está fora do ar, e vai
 * tomar café. É a mesma doutrina do `<EstadoDaTela>`, aplicada por LINHA porque
 * esta tela agrega sete leituras independentes.
 */

/* --------------------------------------------------------------------------
 * O que as rotas devolvem
 * -------------------------------------------------------------------------- */

/**
 * `GET /dashboard/summary` (`dashboardRepository.getDashboardSummary`).
 *
 * TUDO É OPCIONAL NO TIPO, e não por preguiça: este objeto vem de uma API que
 * pode mudar, e um `.counts.users` num contrato que perdeu a chave derruba a
 * página inteira do painel. Os tipos opcionais forçam o código abaixo a passar
 * por `numero()`, que devolve `null` em vez de estourar.
 *
 * `salesChart[].total` é `SUM(total)` de uma coluna `numeric`, e o driver do
 * `pg` entrega numeric como STRING. `statusChart[].count` é `COUNT(*)`, que é
 * `bigint`, e vem como STRING pelo mesmo motivo.
 */
export type ResumoDoPainel = {
  counts?: { products?: number; orders?: number; users?: number };
  salesChart?: { day?: string; total?: string | number | null }[];
  statusChart?: { status?: string; count?: string | number | null }[];
};

/** O envelope das rotas que contam (`/admin/orders`, `/admin/avaliacoes`). */
export type Contagem = { total?: number | string | null };

/** Uma linha de `GET /dashboard` — só o que a fila precisa. */
export type ProdutoDoCatalogo = { quantity?: number | string | null };

/* --------------------------------------------------------------------------
 * Conversões
 * -------------------------------------------------------------------------- */

/**
 * Número, ou `null`. NUNCA `0` por padrão.
 *
 * `Number(null)` é `0`, `Number("")` é `0`, `Number([])` é `0` e `Number(true)`
 * é `1` — quatro maneiras de uma ausência virar um número convincente, e
 * nenhuma delas levanta suspeita num `if`.
 *
 * POR ISSO A FUNÇÃO ACEITA POR LISTA, E NÃO RECUSA POR LISTA. A primeira versão
 * era "recusa `null`, `undefined` e string vazia, e converte o resto"; um teste
 * a pegou devolvendo `0` para `[]`. Enumerar o que é lixo exige acertar a lista
 * inteira; enumerar o que é DADO — número ou string numérica, e nada mais —
 * exige acertar dois casos. É a mesma disciplina de `ehFalhaDeInfraestrutura`
 * em `painel-servidor.ts`, e ela nasceu do mesmo tipo de furo.
 */
export function numero(bruto: unknown): number | null {
  if (typeof bruto === "number") return Number.isFinite(bruto) ? bruto : null;
  if (typeof bruto !== "string") return null;
  const texto = bruto.trim();
  if (texto === "") return null;
  const n = Number(texto);
  return Number.isFinite(n) ? n : null;
}

/**
 * Quantos pedidos há NESTE status, segundo o `statusChart`.
 *
 * AQUI O ZERO É LEGÍTIMO, e a distinção é a alma da função: o `statusChart` é
 * um `GROUP BY status`, então um status sem nenhum pedido simplesmente NÃO
 * APARECE na lista. Ausente-na-lista quer dizer zero — a pergunta foi feita e
 * respondida. Por isso `chart` ausente (a leitura falhou) devolve `null`, e
 * `chart` presente sem a linha devolve `0`.
 */
export function contagemDeStatus(
  chart: ResumoDoPainel["statusChart"] | null | undefined,
  status: string,
): number | null {
  if (!Array.isArray(chart)) return null;
  const linha = chart.find((l) => l?.status === status);
  if (!linha) return 0;
  return numero(linha.count) ?? 0;
}

export type PontoDaSerie = { dia: string; valor: number };

/**
 * A série de receita por dia, pronta para o gráfico.
 *
 * O backend já devolve `TO_CHAR(criado_em, 'DD/MM')` e ordena por
 * `MIN(criado_em)`, então a ordem cronológica vem pronta. O que se faz aqui é
 * converter o `total` (string do numeric) e DESCARTAR ponto sem dia ou sem
 * número — um `NaN` no meio da série faz o recharts desenhar um buraco sem
 * dizer por quê.
 */
export function serieDeReceita(
  chart: ResumoDoPainel["salesChart"] | null | undefined,
): PontoDaSerie[] {
  if (!Array.isArray(chart)) return [];
  return chart.flatMap((ponto) => {
    const dia = typeof ponto?.day === "string" ? ponto.day.trim() : "";
    const valor = numero(ponto?.total);
    return dia && valor !== null ? [{ dia, valor }] : [];
  });
}

export function somaDaSerie(serie: PontoDaSerie[]): number {
  return serie.reduce((total, ponto) => total + ponto.valor, 0);
}

/**
 * Quantos produtos estão com estoque no chão.
 *
 * O LIMIAR É FIXO PORQUE NÃO EXISTE OUTRO. A spec fala em "abaixo do mínimo
 * cadastrado no produto", e essa coluna NÃO EXISTE em `canastra.produtos` —
 * não há `estoque_minimo` em nenhuma das migrações. Inventar um mínimo por
 * produto seria inventar dado; usar um número fixo e DIZÊ-LO na tela é a única
 * saída honesta. Está relatado como pendência de backend.
 *
 * Quantidade que não é número não conta como estoque baixo: não saber quanto há
 * não é o mesmo que saber que há pouco.
 */
export const LIMIAR_DE_ESTOQUE = 5;

export function contarEstoqueBaixo(
  produtos: ProdutoDoCatalogo[] | null | undefined,
  limiar: number = LIMIAR_DE_ESTOQUE,
): number | null {
  if (!Array.isArray(produtos)) return null;
  return produtos.filter((produto) => {
    const quantidade = numero(produto?.quantity);
    return quantidade !== null && quantidade <= limiar;
  }).length;
}

/* --------------------------------------------------------------------------
 * A fila de trabalho
 * -------------------------------------------------------------------------- */

export type LinhaDaFila = {
  chave: string;
  rotulo: string;
  /**
   * A DEFINIÇÃO DA CONTAGEM, e ela não é ajuda de tela — é R29.
   *
   * "Pedidos a despachar" sem dizer o que conta como despachável é um número
   * que o gestor não consegue conferir, e um número que não se confere é um
   * número em que ele não confia. Na terceira vez que ele desconfiar, para de
   * olhar a tela.
   */
  definicao: string;
  /** `null` = não deu para perguntar. Ver o cabeçalho deste arquivo. */
  contagem: number | null;
  /** A URL da lista JÁ FILTRADA — a "aba salva" do §4.1. */
  href: string;
  /** Quando a contagem é conhecidamente incompleta ou aproximada. */
  ressalva?: string;
};

/**
 * As cinco linhas da fila, e as escolhas de contrato que cada uma exigiu.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * "ASSINATURA COM COBRANÇA FALHADA" NÃO EXISTE, E VIROU "PAGAMENTO RECUSADO".
 *
 * A spec §4.1 pede a linha; a pesquisa prova que ela não é computável. Não há
 * dunning nesta loja: cobrança do Clube que falha vira um pedido `rejeitado`, e
 * o status da assinatura continua `ativa` para sempre. Não existe contador de
 * falhas nem tabela de eventos — não há o que consultar.
 *
 * O QUE EXISTE é o pedido `rejeitado`, que é onde a falha do Clube de fato
 * aterrissa. Então a linha conta ISSO e se chama pelo que conta. A definição
 * avisa que ali dentro há duas coisas misturadas (recusa de compra avulsa e
 * cobrança de assinatura que falhou) e que não dá para separá-las. Uma linha
 * chamada "assinatura com cobrança falhada" mostrando esse mesmo número seria
 * uma promessa que o sistema não cumpre.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * "A DESPACHAR" É `aprovado`, E A DEFINIÇÃO DIZ ISSO.
 *
 * A definição ideal seria "pago e ainda sem código de rastreio", mas
 * `GET /admin/orders` não filtra por `codigo_rastreio` — só por status, período
 * e busca. `aprovado` é o status em que o pedido fica entre o pagamento e o
 * envio, então ele é a melhor aproximação disponível, e a definição na tela é
 * literal ("aprovados, ainda não marcados como enviados") em vez de prometer o
 * recorte que a API não faz.
 */
export function montarFila(contagens: {
  aDespachar: number | null;
  pagamentoPendente: number | null;
  pagamentoRecusado: number | null;
  avaliacoesPendentes: number | null;
  estoqueBaixo: number | null;
  /** `true` quando o catálogo não coube na única página que a API permite. */
  estoqueParcial?: boolean;
}): LinhaDaFila[] {
  return [
    {
      chave: "despachar",
      rotulo: "Pedidos a despachar",
      definicao: "aprovados, ainda não marcados como enviados",
      contagem: contagens.aDespachar,
      href: montarUrl("/dashboard/pedidos", { status: "aprovado" }),
    },
    {
      chave: "pagamento-pendente",
      rotulo: "Pagamento pendente",
      definicao: "aguardando a confirmação do Mercado Pago",
      contagem: contagens.pagamentoPendente,
      href: montarUrl("/dashboard/pedidos", { status: "pendente" }),
    },
    {
      chave: "pagamento-recusado",
      rotulo: "Pagamento recusado",
      definicao:
        "compras recusadas e cobranças do Clube que falharam, misturadas — a loja não distingue as duas",
      contagem: contagens.pagamentoRecusado,
      href: montarUrl("/dashboard/pedidos", { status: "rejeitado" }),
    },
    {
      chave: "avaliacoes",
      rotulo: "Avaliação a moderar",
      definicao: "escritas pelo cliente e ainda não publicadas",
      contagem: contagens.avaliacoesPendentes,
      href: montarUrl("/dashboard/avaliacoes", { status: "pendente" }),
    },
    {
      chave: "estoque",
      rotulo: "Estoque baixo",
      definicao: `${LIMIAR_DE_ESTOQUE} unidades ou menos`,
      contagem: contagens.estoqueBaixo,
      href: montarUrl("/dashboard/produtos", { estoque: "baixo" }),
      ressalva: contagens.estoqueParcial
        ? "o catálogo é maior do que a API devolve numa página, então a contagem é parcial"
        : // O limiar é fixo porque não existe `estoque_minimo` em
          // `canastra.produtos` — dizê-lo é o que impede o gestor de procurar
          // onde configurar um mínimo que não existe.
          "não há estoque mínimo por produto no cadastro; o limite é fixo",
    },
  ];
}

/** Quantas linhas da fila não puderam ser consultadas. É o que decide se a tela
 *  mostra a tarja de leitura incompleta. */
export function linhasSemResposta(fila: LinhaDaFila[]): number {
  return fila.filter((linha) => linha.contagem === null).length;
}

/** Quanto trabalho há na fila. `null` quando NENHUMA linha respondeu — somar
 *  só o que respondeu e chamar de total seria inventar um número menor. */
export function totalDaFila(fila: LinhaDaFila[]): number | null {
  const conhecidas = fila.filter((l) => l.contagem !== null);
  if (conhecidas.length === 0) return null;
  return conhecidas.reduce((soma, l) => soma + (l.contagem ?? 0), 0);
}

/* --------------------------------------------------------------------------
 * Os indicadores
 * -------------------------------------------------------------------------- */

export type Variacao =
  | { tipo: "sobe" | "desce" | "igual"; percentual: number }
  /** O período anterior foi zero: não há percentual que signifique alguma
   *  coisa, e "+∞%" ou "+100%" seriam invenções. */
  | { tipo: "sem-base"; percentual: null }
  /** Uma das duas pontas não foi lida. */
  | { tipo: "desconhecida"; percentual: null };

/**
 * A variação entre dois períodos.
 *
 * DIVIDIR POR ZERO É O CASO REAL, NÃO O EXÓTICO: uma loja pequena tem semana com
 * zero pedido, e `(5 - 0) / 0` é `Infinity`. Um KPI que mostre "+∞%" ou, pior,
 * "+100%" (que é o que se escreve para "consertar" o infinito) está mentindo com
 * precisão de duas casas. "Sem base de comparação" é a resposta certa.
 *
 * `0 → 0` é `igual`, e não `sem-base`: aí não houve mudança nenhuma, e isso é
 * uma informação de verdade.
 */
export function variacao(
  atual: number | null,
  anterior: number | null,
): Variacao {
  if (atual === null || anterior === null) return { tipo: "desconhecida", percentual: null };
  if (anterior === 0) {
    if (atual === 0) return { tipo: "igual", percentual: 0 };
    return { tipo: "sem-base", percentual: null };
  }
  const percentual = Math.round(((atual - anterior) / anterior) * 100);
  if (percentual === 0) return { tipo: "igual", percentual: 0 };
  return { tipo: percentual > 0 ? "sobe" : "desce", percentual };
}

export type Indicador = {
  chave: string;
  rotulo: string;
  /** Já formatado. `null` = não foi possível ler — a tela desenha o travessão. */
  valor: string | null;
  /** R29: a fórmula, ao lado do número. Ver `LinhaDaFila.definicao`. */
  definicao: string;
  variacao: Variacao;
  /** "vs. os 7 dias anteriores". Ausente quando não há comparação possível. */
  comparadoCom?: string;
};

/**
 * De quatro a oito indicadores (§4.1), e SÓ COM AS COMPARAÇÕES QUE EXISTEM.
 *
 * O QUE A API OFERECE, E O QUE ELA NÃO OFERECE. `GET /dashboard/summary` devolve
 * três contagens totais e uma série de SETE dias — não há parâmetro de período,
 * não há série anterior, não há como pedir catorze dias. A comparação de período
 * que esta tela mostra vem de outro lugar: duas chamadas a
 * `GET /admin/orders?de=&ate=&limit=1`, que devolvem `total` — o backend conta
 * no banco, com o recorte do dia de São Paulo, e a tela não baixa pedido nenhum
 * para isso.
 *
 * DUAS MÉTRICAS COM O MESMO "7 DIAS" MEDEM COISAS DIFERENTES, e a definição de
 * cada uma diz qual. A receita vem do `salesChart`, que recorta
 * `criado_em >= now() - INTERVAL '7 days'` (168 horas corridas, no fuso do
 * servidor) e só conta status de venda; a contagem de pedidos vem de `?de=&ate=`,
 * que recorta SETE DIAS DE CALENDÁRIO DE SÃO PAULO e conta todo status. Deixar
 * as duas com o rótulo "7 dias" sem dizer isso é o jeito clássico de um painel
 * produzir duas verdades incompatíveis na mesma tela — e a divergência aparece
 * justamente no fechamento, quando alguém confere.
 */
export function montarIndicadores(entrada: {
  resumo: ResumoDoPainel | null;
  pedidos7: number | null;
  pedidos7Anteriores: number | null;
  pedidos30: number | null;
  pedidos30Anteriores: number | null;
}): Indicador[] {
  const serie = serieDeReceita(entrada.resumo?.salesChart);
  const receita = entrada.resumo ? somaDaSerie(serie) : null;

  const contagemDeClientes = entrada.resumo ? numero(entrada.resumo.counts?.users) : null;
  const contagemDeProdutos = entrada.resumo ? numero(entrada.resumo.counts?.products) : null;
  const contagemDePedidos = entrada.resumo ? numero(entrada.resumo.counts?.orders) : null;

  const semComparacao: Variacao = { tipo: "desconhecida", percentual: null };

  return [
    {
      chave: "receita-7",
      rotulo: "Receita · 7 dias",
      valor: receita === null ? null : formatarReais(receita),
      definicao:
        "soma dos pedidos pagos das últimas 168 horas — a API não devolve outro período, então não há comparação",
      variacao: semComparacao,
    },
    {
      chave: "pedidos-7",
      rotulo: "Pedidos · 7 dias",
      valor: entrada.pedidos7 === null ? null : String(entrada.pedidos7),
      definicao: "todos os pedidos criados nos 7 últimos dias de São Paulo, em qualquer status",
      variacao: variacao(entrada.pedidos7, entrada.pedidos7Anteriores),
      comparadoCom: "os 7 dias anteriores",
    },
    {
      chave: "pedidos-30",
      rotulo: "Pedidos · 30 dias",
      valor: entrada.pedidos30 === null ? null : String(entrada.pedidos30),
      definicao: "mesmo recorte, numa janela larga o bastante para não oscilar com um dia forte",
      variacao: variacao(entrada.pedidos30, entrada.pedidos30Anteriores),
      comparadoCom: "os 30 dias anteriores",
    },
    {
      chave: "clientes",
      rotulo: "Clientes",
      valor: contagemDeClientes === null ? null : String(contagemDeClientes),
      definicao: "contas criadas na loja, desde sempre",
      variacao: semComparacao,
    },
    {
      chave: "produtos",
      rotulo: "Produtos",
      valor: contagemDeProdutos === null ? null : String(contagemDeProdutos),
      definicao: "itens no catálogo, incluindo os sem estoque",
      variacao: semComparacao,
    },
    {
      chave: "pedidos-total",
      rotulo: "Pedidos, no total",
      valor: contagemDePedidos === null ? null : String(contagemDePedidos),
      definicao: "todos os pedidos já registrados, em qualquer status",
      variacao: semComparacao,
    },
  ];
}
