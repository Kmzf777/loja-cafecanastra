/**
 * O ESTADO DE UMA LISTA MORA NA URL — R2 — e este módulo é o que o mantém
 * honesto nas duas direções: ler o que veio dela, e montar a próxima.
 *
 * R2, na pesquisa: "busca, filtro, ordenação, página e colunas na URL — voltar
 * do detalhe devolve a MESMA lista; sobrevive ao F5". A consequência de desenho
 * é que a tela é um Server Component lendo `searchParams`, e que TODO controle
 * de filtro é um `<a href>`. Não há `useState` de filtro em lugar nenhum destas
 * telas, e é por isso que elas funcionam com o botão Voltar, com o favorito e
 * com o link colado no WhatsApp.
 *
 * A RESSALVA DO R2 QUE VALE MAIS QUE A REGRA: **nunca colocar CPF, e-mail ou
 * endereço na query string**. URL vaza — vai para o histórico do navegador, para
 * o `Referer` da próxima requisição, para o log do proxy e para a captura de
 * tela que o gestor manda no grupo. Por isso o que entra aqui é o que a pessoa
 * DIGITOU na busca, e nunca um dado do RESULTADO: nenhuma tela deste painel
 * monta `?email=` nem `?cpf=`, e um link para o detalhe de alguém leva o
 * identificador opaco, nunca o documento.
 */

/**
 * Um filtro ativo, já resolvido pela tela — o que `<ChipsDeFiltro>` desenha.
 *
 * O TIPO MORA AQUI E NÃO NO COMPONENTE por causa da direção da dependência: os
 * módulos puros (`clientes.logica.ts`, `assinaturas.logica.ts`) é que MONTAM os
 * chips, e um módulo puro importando de `components/` arrastaria React para
 * dentro do projeto de teste que roda em node. É a mesma direção que `Selo.tsx`
 * já usa ao buscar `TomDeStatus` em `lib/painel/status.ts`.
 */
export type ChipDeFiltro = {
  /** Identificador estável, para a `key` e para o teste. */
  chave: string;
  /** A DIMENSÃO ("Busca", "Status"), que a tela imprime em caixa alta. */
  dimensao: string;
  /** O VALOR ("maria", "Ativa"), como a pessoa o reconhece. */
  valor: string;
  /** Para onde ir ao remover ESTE filtro, com todo o resto preservado. */
  href: string;
};

/**
 * Um parâmetro de `searchParams`, virado texto — ou `""`.
 *
 * `searchParams` do Next entrega `string | string[] | undefined`, e o
 * `string[]` não é hipótese: `?q=a&q=b` acontece por link mal colado e por bug
 * de quem montou a URL. AMBIGUIDADE CAI NO PADRÃO em vez de escolher uma das
 * duas — é a mesma decisão de `destinoDoPainel` em `painel-servidor.ts`, e a
 * razão é a mesma: escolher em silêncio faz a tela mostrar um filtro que não é
 * o que está na barra de endereço.
 *
 * O `trim` está aqui e não em cada tela porque `?q=%20%20` é uma busca por dois
 * espaços — que o backend traduz em `ILIKE '%  %'` e devolve quase nada, com o
 * chip de filtro mostrando o que parece ser nada.
 */
export function textoDoParametro(
  bruto: string | string[] | null | undefined,
): string {
  if (typeof bruto !== "string") return "";
  return bruto.trim();
}

/**
 * Monta `base?a=1&b=2`, OMITINDO tudo que for vazio.
 *
 * OMITIR É A REGRA, e ela é o que mantém a URL legível e o histórico limpo:
 * `/dashboard/clientes?q=&status=&pagina=1` e `/dashboard/clientes` são a mesma
 * tela, e duas URLs para uma tela são duas entradas no histórico, dois
 * favoritos diferentes e dois caches. Quem chama passa `undefined` para o que
 * está no valor padrão — inclusive `pagina: 1`.
 *
 * `URLSearchParams` e não concatenação à mão: é ele que escapa `&`, `=`, `#` e
 * acento. Uma busca por "café & cia" concatenada crua vira dois parâmetros, e o
 * segundo deles some.
 */
export function montarUrl(
  base: string,
  parametros: Record<string, string | number | undefined | null>,
): string {
  const busca = new URLSearchParams();
  for (const [chave, valor] of Object.entries(parametros)) {
    if (valor === undefined || valor === null) continue;
    const texto = String(valor).trim();
    if (texto === "") continue;
    busca.set(chave, texto);
  }
  const consulta = busca.toString();
  return consulta ? `${base}?${consulta}` : base;
}
