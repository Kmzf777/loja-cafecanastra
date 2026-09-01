/**
 * A DECISÃO da paginação — sem React, sem DOM, sem URL.
 *
 * R17: "paginação, nunca scroll infinito — painel é tarefa, não descoberta". O
 * componente `<Paginacao>` desenha; QUAL página existe, quantas há e quais
 * botões mostrar decide-se aqui, porque é conta com casos de borda (uma página
 * só, página fora do intervalo, total zero) e conta com caso de borda é
 * exatamente o que a spec §2.8 manda tirar de dentro de componente.
 *
 * MORA EM `lib/painel/` E NÃO AO LADO DO COMPONENTE por duas razões. A primeira
 * é de conteúdo: R17 vale para TODA tela de lista do painel — clientes,
 * assinaturas, pedidos, produtos, descontos —, então isto é uma regra da casa,
 * como `dinheiro.ts` e `data.ts`, e não a regra de um desenho. A segunda é do
 * `vitest.config.ts`: tudo sob `components/painel/**` roda no projeto
 * `painel-dom`, em jsdom, e a spec §2.8 quer módulo puro no projeto `vitrine`,
 * em node. Um módulo sem React testado com jsdom em volta é jsdom pago por
 * nada.
 */

/** Um salto de páginas na régua — o "…" entre 1 e 7. */
export const SALTO = "salto" as const;
export type ItemDaRegua = number | typeof SALTO;

/**
 * Quantas páginas existem, dado o total de linhas.
 *
 * ZERO LINHAS DÁ UMA PÁGINA, e não zero. "Página 1 de 0" é uma frase que não
 * significa nada, e um `totalPaginas` de zero faz toda aritmética de "próxima"
 * virar comparação com o vazio. A lista vazia é a página 1, que está vazia.
 */
export function totalDePaginas(total: number, porPagina: number): number {
  if (!Number.isFinite(total) || total <= 0) return 1;
  if (!Number.isFinite(porPagina) || porPagina <= 0) return 1;
  return Math.max(1, Math.ceil(total / porPagina));
}

/**
 * A página pedida, presa dentro do que existe.
 *
 * `?pagina=999` numa lista de 3 páginas é o caso do favorito velho e do botão
 * de voltar: sem a trava, a tela pede `offset=9980` ao backend e desenha uma
 * lista vazia com o filtro aplicado — que o gestor lê como "sumiram meus
 * clientes". Preso na última página, ele vê a última página.
 *
 * Aceita o que vem da URL (string, lista, nada) porque é de lá que ele vem:
 * `searchParams` do Next entrega `string[]` quando o parâmetro se repete, e
 * ambiguidade cai no padrão em vez de escolher uma das duas.
 */
export function paginaValida(
  bruto: string | string[] | number | null | undefined,
  totalPaginas: number,
): number {
  const teto = Math.max(1, Math.floor(totalPaginas) || 1);
  if (Array.isArray(bruto)) return 1;
  const n = typeof bruto === "number" ? bruto : Number.parseInt(String(bruto ?? ""), 10);
  if (!Number.isFinite(n) || n < 1) return 1;
  return Math.min(Math.floor(n), teto);
}

/**
 * "1–20 de 134" — o intervalo que ESTA página mostra.
 *
 * R17 de novo, e a razão é de confiança: paginação sem contagem obriga a clicar
 * até o fim para saber o tamanho da fila, e um gestor que não sabe quantos
 * pedidos existem não sabe se o filtro dele pegou tudo. `fim` é preso ao
 * `total` porque a última página quase nunca está cheia — sem isso, "121–140 de
 * 134" prometeria seis linhas que não existem.
 */
export function intervaloDaPagina(
  pagina: number,
  porPagina: number,
  total: number,
): { inicio: number; fim: number; total: number } {
  if (total <= 0) return { inicio: 0, fim: 0, total: 0 };
  const inicio = (pagina - 1) * porPagina + 1;
  return { inicio, fim: Math.min(pagina * porPagina, total), total };
}

/**
 * A régua de páginas, com saltos.
 *
 * A REGRA: a primeira, a última, a atual e `janela` vizinhas de cada lado; um
 * `SALTO` onde o corte deixou buraco. Imprimir as 68 páginas de uma base de
 * 1.360 clientes empurra a tabela para fora da tela e transforma "ir para a
 * página 3" numa caçada.
 *
 * O SALTO SÓ ENTRA QUANDO ELE ESCONDE MAIS DE UMA PÁGINA. Trocar a página 2 por
 * um "…" não economiza espaço nenhum e ainda tira um destino do alcance do
 * dedo — um "…" que representa uma página só é pior que a página.
 */
export function reguaDePaginas(
  pagina: number,
  totalPaginas: number,
  janela = 1,
): ItemDaRegua[] {
  const ultima = Math.max(1, Math.floor(totalPaginas) || 1);
  const atual = Math.min(Math.max(1, Math.floor(pagina) || 1), ultima);

  const numeros = new Set<number>([1, ultima]);
  for (let n = atual - janela; n <= atual + janela; n += 1) {
    if (n >= 1 && n <= ultima) numeros.add(n);
  }

  const ordenados = [...numeros].sort((a, b) => a - b);
  const regua: ItemDaRegua[] = [];
  for (let i = 0; i < ordenados.length; i += 1) {
    const n = ordenados[i];
    const anterior = ordenados[i - 1];
    if (anterior !== undefined) {
      const buraco = n - anterior;
      if (buraco === 2) regua.push(anterior + 1);
      else if (buraco > 2) regua.push(SALTO);
    }
    regua.push(n);
  }
  return regua;
}
