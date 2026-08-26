import type { TomDeStatus } from "../status";
import { montarUrl, textoDoParametro, type ChipDeFiltro } from "../filtros";
import { paginaValida, totalDePaginas } from "../paginacao";

/**
 * A DECISÃO da tela de Assinaturas do Clube — sem React, sem fetch, sem DOM.
 *
 * ESTA TELA FILTRA E PAGINA EM MEMÓRIA, E ISSO É UMA EXCEÇÃO CONSCIENTE.
 *
 * A regra desta casa é que filtro e paginação acontecem NO BANCO — foi o
 * conserto da Onda 4 para pedidos e clientes, porque filtrar em memória esconde
 * o registro que casa e está na página 3, e mostra um total que é o total
 * geral. Aqui não há escolha: `GET /admin/assinaturas` faz um `SELECT` sem
 * `WHERE`, sem `LIMIT` e sem `OFFSET`, e devolve um ARRAY CRU — não há `page`,
 * não há `total`, não há parâmetro nenhum a passar.
 *
 * A diferença que torna a exceção segura é que a resposta é COMPLETA: a lista
 * inteira chega ao servidor do Next, então filtrar aqui filtra sobre TODAS as
 * linhas, e o total é o total de verdade. É o oposto do defeito legado, que
 * filtrava sobre uma página. O preço é a resposta crescer com a base — está
 * relatado como pendência de backend, e é o que muda quando a rota ganhar
 * paginação.
 */

/** A rota desta tela, num lugar só. */
export const ROTA_DE_ASSINATURAS = "/dashboard/assinaturas";

export const POR_PAGINA = 20;

/**
 * O VOCABULÁRIO DE STATUS, IGUAL AO CHECK `assinaturas_status_valido` (0015).
 *
 * A lista é comparada com a migração pelo teste, lendo o arquivo do disco — a
 * mesma técnica de `status.ts` para os nove status de pedido, e pela mesma
 * razão: um status novo no banco que não exista aqui sairia na tela como texto
 * cru, e um status daqui que não exista lá seria uma aba que nunca traz nada.
 *
 * NÃO É A LISTA DE PEDIDO, e não pode ser: são quatro valores, não nove, e
 * `cancelada` significa outra coisa em cada uma. Importar `STATUS_DE_PEDIDO`
 * aqui teria "funcionado" para três dos quatro e falhado calado no resto.
 *
 * NENHUM TOM É `erro`, E ISSO É R21. Vermelho no painel significa exclusivamente
 * erro e ação destrutiva. Uma assinatura cancelada não é um erro — é um fato,
 * geralmente uma decisão do cliente —, e pintá-la de vermelho numa lista em que
 * ela é comum ensina o gestor a ignorar o vermelho. (`STATUS_DE_PEDIDO` usa
 * `erro` em "cancelado" porque ali ele é excepcional; aqui é rotina.)
 */
export const STATUS_DE_ASSINATURA = [
  {
    valor: "pendente",
    rotulo: "Pendente",
    // O cliente começou a adesão e ainda não autorizou o débito no Mercado
    // Pago. Não é problema, mas também não é receita — merece o olho.
    tom: "alerta",
  },
  { valor: "ativa", rotulo: "Ativa", tom: "sucesso" },
  {
    valor: "pausada",
    rotulo: "Pausada",
    // Quem pausa é o MP, e quase sempre por problema de cobrança. É o estado
    // que mais pede uma olhada humana.
    tom: "alerta",
  },
  { valor: "cancelada", rotulo: "Cancelada", tom: "neutro" },
] as const satisfies ReadonlyArray<{
  valor: string;
  rotulo: string;
  tom: TomDeStatus;
}>;

export type StatusDeAssinatura = (typeof STATUS_DE_ASSINATURA)[number]["valor"];

/** Valor desconhecido devolve a si mesmo — esconder atrás de "Outro" faria um
 *  status novo do backend sumir da tela sem ninguém notar. */
export function rotuloDeStatus(valor: string): string {
  return STATUS_DE_ASSINATURA.find((s) => s.valor === valor)?.rotulo ?? valor;
}

export function tomDeStatus(valor: string): TomDeStatus {
  return STATUS_DE_ASSINATURA.find((s) => s.valor === valor)?.tom ?? "neutro";
}

/**
 * Uma linha de `GET /admin/assinaturas` (`ClubeController.listarTodas`).
 *
 * `cliente_nome` e `cliente_email` já vêm com fallback do backend ("Cliente
 * removido" e "—") porque o JOIN é LEFT: cliente apagado por LGPD não some com
 * a assinatura da lista do gestor. `preco_centavos` é INTEGER — centavos, não
 * reais —, e é por isso que a tela usa `formatarCentavos` e não `formatarReais`:
 * o mesmo schema devolve as duas unidades, e trocá-las faz R$ 59,00 virar
 * R$ 0,59 sem nenhum sinal.
 */
export type Assinatura = {
  id: string;
  sku: string | null;
  quantidade: number;
  frequencia_dias: number;
  preco_centavos: number;
  status: string;
  criado_em: string | null;
  atualizado_em: string | null;
  cancelada_em: string | null;
  nome_cafe: string | null;
  cliente_nome: string | null;
  cliente_email: string | null;
};

export type EstadoDasAssinaturas = {
  busca: string;
  /** `""` = todas. */
  status: string;
  pagina: number;
};

/**
 * O texto comparável de uma busca: minúsculo e SEM ACENTO.
 *
 * Aqui a comparação é em JavaScript, e não o `ILIKE` do Postgres — então quem
 * digita "cafe" não acha "Café" a não ser que alguém tire o acento dos dois
 * lados. Numa loja cujos produtos se chamam "Café Canastra Clássico", isso é a
 * diferença entre a busca servir e não servir.
 *
 * `NFD` separa a letra do acento e o `\p{Diacritic}` remove o acento; sem o
 * `NFD`, "é" é um caractere único e a expressão não acha nada nele.
 *
 * O `trim` FOI ACRESCENTADO POR UM TESTE VERMELHO, e a lição é registrada aqui
 * porque ela não é óbvia: uma busca de só espaços ("   ") é uma string
 * TRUTHY, então ela passava pela guarda de "busca vazia" e virava um filtro por
 * espaço — que não casa com nada e esvazia a tela. `lerEstado` já apara o que
 * vem da URL, mas a função não pode depender de quem a chama para não mentir.
 */
export function comparavel(texto: string | null | undefined): string {
  return (texto ?? "")
    .trim()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLocaleLowerCase("pt-BR");
}

/** O estado a partir da URL. Status desconhecido é ignorado, não filtra nada:
 *  `?status=paga` (que não existe) devolveria lista vazia para sempre, e o
 *  gestor leria "não há assinaturas" em vez de "esse filtro não existe". */
export function lerEstado(
  parametros: Record<string, string | string[] | undefined>,
): EstadoDasAssinaturas {
  const status = textoDoParametro(parametros.status);
  return {
    busca: textoDoParametro(parametros.q),
    status: STATUS_DE_ASSINATURA.some((s) => s.valor === status) ? status : "",
    pagina: paginaValida(parametros.pagina, Number.MAX_SAFE_INTEGER),
  };
}

/** A URL desta tela para um estado — a "aba salva" do R2. */
export function urlDaTela(estado: Partial<EstadoDasAssinaturas>): string {
  const pagina = estado.pagina ?? 1;
  return montarUrl(ROTA_DE_ASSINATURAS, {
    q: estado.busca?.trim() || undefined,
    status: estado.status || undefined,
    // `pagina: 1` é o padrão, e `?pagina=1` criaria uma segunda URL para a
    // mesma tela.
    pagina: pagina > 1 ? pagina : undefined,
  });
}

/**
 * A busca, sobre os quatro campos que o gestor tem na mão quando alguém liga: o
 * nome que a pessoa disse, o e-mail com que ela assinou, o café que ela recebe e
 * o SKU que aparece na etiqueta da caixa.
 */
export function filtrarPorBusca(
  lista: Assinatura[],
  busca: string,
): Assinatura[] {
  const alvo = comparavel(busca);
  if (!alvo) return lista;
  return lista.filter((a) =>
    [a.cliente_nome, a.cliente_email, a.nome_cafe, a.sku].some((campo) =>
      comparavel(campo).includes(alvo),
    ),
  );
}

export function filtrarPorStatus(lista: Assinatura[], status: string): Assinatura[] {
  if (!status) return lista;
  return lista.filter((a) => a.status === status);
}

/**
 * Quantas assinaturas cada status tem — a contagem que vai ao lado de cada aba.
 *
 * A CONTAGEM É FEITA DEPOIS DA BUSCA E ANTES DO STATUS, e a ordem é a regra:
 * "Ativas (3)" tem de significar "3 dos resultados da SUA busca estão ativas".
 * Contar sobre a lista inteira faria a aba prometer 40 e entregar 3 assim que
 * houvesse busca; contar depois do status faria toda aba não-selecionada
 * mostrar zero, que é a versão mais inútil possível de uma contagem.
 */
export function contarPorStatus(lista: Assinatura[]): Record<string, number> {
  const contagem: Record<string, number> = { "": lista.length };
  for (const { valor } of STATUS_DE_ASSINATURA) contagem[valor] = 0;
  for (const assinatura of lista) {
    // `?? 0` e não `contagem[x]++`: um status vindo do banco que não esteja na
    // lista fechada tem de ser contado, não virar NaN em silêncio.
    contagem[assinatura.status] = (contagem[assinatura.status] ?? 0) + 1;
  }
  return contagem;
}

export type Pagina<T> = {
  itens: T[];
  total: number;
  totalPaginas: number;
  pagina: number;
};

/**
 * A fatia da página. A PÁGINA É CORRIGIDA AQUI, contra o total já filtrado.
 *
 * O caso é o mesmo de sempre: `?status=cancelada&pagina=5` guardado como
 * favorito, e depois só duas páginas de canceladas. Fatiar sem corrigir
 * devolveria zero itens, e a tela desenharia "nenhum resultado para este filtro"
 * — que o gestor lê como "não há canceladas", e não como "esta página não
 * existe".
 */
export function paginar<T>(
  lista: T[],
  pagina: number,
  porPagina: number = POR_PAGINA,
): Pagina<T> {
  const totalPaginas = totalDePaginas(lista.length, porPagina);
  const atual = paginaValida(pagina, totalPaginas);
  const inicio = (atual - 1) * porPagina;
  return {
    itens: lista.slice(inicio, inicio + porPagina),
    total: lista.length,
    totalPaginas,
    pagina: atual,
  };
}

/** Busca, status e página, na ordem em que a tela precisa deles. */
export function aplicar(
  lista: Assinatura[],
  estado: EstadoDasAssinaturas,
): { pagina: Pagina<Assinatura>; contagem: Record<string, number> } {
  const porBusca = filtrarPorBusca(lista, estado.busca);
  return {
    contagem: contarPorStatus(porBusca),
    pagina: paginar(filtrarPorStatus(porBusca, estado.status), estado.pagina),
  };
}

/** Os chips do R3 — cada um com o `href` que REMOVE só a si mesmo, zerando a
 *  página. Tirar um filtro estando na página 4 e continuar na 4 é o jeito mais
 *  rápido de fazer uma lista menos filtrada parecer vazia. */
export function chipsDasAssinaturas(estado: EstadoDasAssinaturas): ChipDeFiltro[] {
  const chips: ChipDeFiltro[] = [];
  if (estado.busca) {
    chips.push({
      chave: "q",
      dimensao: "Busca",
      valor: estado.busca,
      href: urlDaTela({ ...estado, busca: "", pagina: 1 }),
    });
  }
  if (estado.status) {
    chips.push({
      chave: "status",
      dimensao: "Status",
      valor: rotuloDeStatus(estado.status),
      href: urlDaTela({ ...estado, status: "", pagina: 1 }),
    });
  }
  return chips;
}

export function temFiltro(estado: EstadoDasAssinaturas): boolean {
  return estado.busca !== "" || estado.status !== "";
}

/**
 * "a cada 15 dias" — a frequência em português.
 *
 * O CHECK de 0015 fecha em 15, 30 e 45, e a tela poderia traduzir os três para
 * "quinzenal / mensal / a cada 45 dias". NÃO TRADUZ de propósito: "mensal" é
 * falso para 30 dias (fevereiro tem 28, e o MP cobra a cada 30 dias corridos,
 * não todo dia 5), e um rótulo que arredonda a regra de cobrança é o tipo de
 * imprecisão que vira reclamação de cliente. O número é o que o contrato diz.
 */
export function frequenciaEmTexto(dias: number): string {
  if (!Number.isFinite(dias) || dias <= 0) return "—";
  return `${dias} dias`;
}

/**
 * O identificador HUMANO da linha — R23, "nunca UUID".
 *
 * O backend já troca cliente apagado por "Cliente removido", então o `null` só
 * aparece se o contrato mudar. Vale a guarda: uma célula vazia na primeira
 * coluna parece defeito de carregamento, e `assinaturas.id` na tela não
 * identifica ninguém.
 */
export function identificarAssinatura(assinatura: Assinatura): string {
  const nome = (assinatura.cliente_nome ?? "").trim();
  if (nome) return nome;
  const email = (assinatura.cliente_email ?? "").trim();
  if (email && email !== "—") return email;
  return "Cliente sem identificação";
}

/** O café da assinatura: o nome do produto, ou o SKU quando o produto saiu do
 *  catálogo (o backend já faz `COALESCE(p.nome, a.sku)`, então isto é a terceira
 *  linha de defesa — assinatura sem SKU não deveria existir). */
export function cafeDaAssinatura(assinatura: Assinatura): string {
  return (
    (assinatura.nome_cafe ?? "").trim() ||
    (assinatura.sku ?? "").trim() ||
    "Café não identificado"
  );
}
