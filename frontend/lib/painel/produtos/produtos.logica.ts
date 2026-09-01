import { montarUrl, textoDoParametro, type ChipDeFiltro } from "../filtros";
import { paginaValida, totalDePaginas } from "../paginacao";

/**
 * A DECISÃO da tela de Produtos — sem React, sem fetch, sem DOM (spec §2.8).
 *
 * ────────────────────────────────────────────────────────────────────────────
 * O QUE ATRAVESSA DAQUI PARA A LOJA, e por que esta lista abre com isso.
 *
 * Foi medido, não suposto. `lib/catalogo/repositorio.ts` lê
 * `GET /dashboard?limit=200` e o tipo que ele declara para a resposta tem
 * QUATRO campos: `product_id`, `sku`, `price` e `quantity`. A função que
 * sobrepõe o banco sobre o catálogo editorial (`sobreporAoVivo`) escreve
 * exatamente três coisas na estrutura da vitrine: id, preço e estoque. Nome,
 * categoria, embalagem, descrição e IMAGEM não são lidos por superfície nenhuma
 * da loja — o texto e a foto de cada café vêm de `data/catalogo-canastra.json`,
 * que é versionado e revisado em PR.
 *
 * E o casamento entre as duas metades é feito por **SKU**: `buscarDadosAoVivo`
 * filtra `linhas.filter((p) => p.sku)` e indexa por ele. Consequência direta, e
 * é a informação mais útil desta tela inteira: **produto sem SKU não existe
 * para a loja** — o preço e o estoque que se digita aqui não chegam a lugar
 * nenhum, sem erro em lugar nenhum.
 *
 * A quarta coisa que atravessa não vai pela vitrine e sim pelo FRETE:
 * `ShippingController.calcularOpcoesDeFrete` monta o pacote com
 * `weight/width/height/length` lidos do BANCO ("nunca do corpo da requisição:
 * senão o cliente declara um pacote de 1 g e paga frete de carta"). É por isso
 * que as quatro medidas são campo de primeira classe aqui, e não detalhe.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * O DEFEITO MEDIDO QUE ESTA TELA EXISTE PARA FECHAR.
 *
 * O formulário legado (`legacy/.../GProducts/form/Form.jsx:394-397`) enviava
 * `weight`, `width`, `height` e `length` SEM TER INPUT PARA NENHUM DOS QUATRO:
 * `undefined` virava a string `"undefined"` no FormData, `Number("undefined")`
 * é NaN, e o backend caía nos padrões da caixa — 0,3 kg / 20 / 5 / 20 cm — em
 * TODA edição. Um café de 1,2 kg voltava a 0,3 kg quando alguém corrigia o
 * preço, e a loja passava a cotar frete errado sem nenhum sinal na tela. O
 * comentário do arquivo legado ainda diz que o bug foi corrigido.
 *
 * O backend já foi consertado (`editProduct` preserva o valor atual quando o
 * campo não vem). O que faltava era a TELA: `medidaEhOPadrao` abaixo é a
 * impressão digital do estrago, e a coluna "Caixa" da lista a torna visível sem
 * ninguém precisar abrir produto por produto.
 */

/** A rota desta tela, num lugar só — é base de URL e de comparação no teste. */
export const ROTA_DE_PRODUTOS = "/dashboard/produtos";

/**
 * Vinte por página, o mesmo de Clientes e Pedidos.
 *
 * O backend aceita até 200 (`dashboardRepository.getProducts`), e é tentador
 * pedir 200 para "paginar menos". R17 diz que painel é tarefa: uma tabela de
 * duzentas linhas é uma tela de rolagem em que o cabeçalho fixo é a única
 * âncora. Vinte cabem numa tela de trabalho quase inteira — e vinte também é o
 * teto do que a edição em lote consegue aplicar em idas sequenciais.
 */
export const POR_PAGINA = 20;

/**
 * O que `GET /dashboard` e `GET /dashboard/:id` devolvem — a lista literal de
 * `COLUNAS_DO_CONTRATO` no `dashboardRepository`.
 *
 * A UNIDADE ESTÁ NO NOME ONDE ELA É AMBÍGUA: `price` é `numeric(10,2)` e o
 * driver do `pg` o entrega como STRING em REAIS ("59.90"), nunca em centavos.
 * Quem formatar isto com `formatarCentavos` transforma R$ 59,90 em R$ 0,60 — e
 * é justamente para esse par que `lib/painel/dinheiro.ts` se recusa a adivinhar.
 *
 * `size` É A EMBALAGEM. O rótulo visível é "Embalagem" (o campo carrega o
 * formato do café — "250 g", "Caixa 3×250 g"), mas o nome no contrato continua
 * sendo `size`, herança da loja de camisetas de onde este backend veio.
 * Renomear quebra a vitrine e o backend ao mesmo tempo.
 *
 * O QUE NÃO ESTÁ AQUI E EXISTE NO BANCO: `custo` (rota própria — ver
 * `ficha.logica.ts`), `estado` e as doze colunas fiscais de 0034. Nenhuma delas
 * entra em `COLUNAS_DO_CONTRATO`, então nenhuma chega a esta tela. Não é
 * omissão do tipo: é o contrato de hoje, e a tela diz isso por escrito em vez
 * de desenhar campos que não têm para onde ir.
 */
export type ProdutoDoPainel = {
  product_id: string;
  sku: string | null;
  name: string;
  /** A embalagem ("250 g"). `size` é o nome do contrato — ver acima. */
  size: string | null;
  category: string | null;
  /** REAIS, como string do `numeric`. Nunca centavos. */
  price: string | number;
  image: string | null;
  timestamp: string | null;
  quantity: number;
  description: string | null;
  /** Quilogramas. */
  weight: string | number;
  /** Centímetros. */
  width: string | number;
  height: string | number;
  length: string | number;
};

export type RespostaDeProdutos = {
  products: ProdutoDoPainel[];
  total: number;
  totalPages: number;
  page: number;
};

/** Uma opção de filtro vinda de `GET /options` (`produto_opcoes`). */
export type OpcaoDeProduto = { id: string; type: string; value: string };

/**
 * O eixo "novidade" que o backend oferece: `onlyNew=true` traz o que foi
 * destacado nos últimos 5 dias, `onlyOld=true` o resto. São os dois únicos
 * valores que existem — qualquer outro vira "sem recorte".
 */
export type RecorteDeNovidade = "" | "novos" | "antigos";

/** O estado da tela, que é exatamente o que está na URL (R2). */
export type EstadoDosProdutos = {
  /** O que a pessoa digitou, como ela digitou. */
  busca: string;
  categoria: string;
  /** A EMBALAGEM. Vai para a API como `size` — ver o comentário do tipo. */
  embalagem: string;
  novidade: RecorteDeNovidade;
  pagina: number;
};

/**
 * O estado a partir da URL.
 *
 * A PÁGINA SAI DAQUI APENAS SANEADA (≥ 1), como em Clientes: o aperto contra a
 * última página existente depende do total, que só se conhece depois da
 * resposta. Chutar aqui faria a tela pedir uma página e mostrar outra.
 */
export function lerEstado(
  parametros: Record<string, string | string[] | undefined>,
): EstadoDosProdutos {
  const novidade = textoDoParametro(parametros.novidade);
  return {
    busca: textoDoParametro(parametros.q),
    categoria: textoDoParametro(parametros.categoria),
    embalagem: textoDoParametro(parametros.embalagem),
    novidade: novidade === "novos" || novidade === "antigos" ? novidade : "",
    pagina: paginaValida(parametros.pagina, Number.MAX_SAFE_INTEGER),
  };
}

/**
 * A consulta que vai para `GET /dashboard`.
 *
 * `q` VAI CRU, e essa é a diferença desta tela para a de Clientes: lá o CPF
 * pontuado precisava ser normalizado porque o banco guarda dígitos. Aqui o
 * backend monta um `to_tsquery('portuguese')` com prefixo (`termo:*`) e um
 * `nome ILIKE` em paralelo, e ele próprio limpa a pontuação de cada termo. Uma
 * normalização a mais deste lado só teria como piorar o que já funciona.
 *
 * A BUSCA EXISTE, E O PAINEL LEGADO NUNCA A USOU. `?q=` está no backend desde
 * 0003 (é a coluna gerada `tsv` com índice GIN), e `GProducts` filtrava a
 * página carregada em memória — o mesmo defeito que a tela de Clientes tinha e
 * que a Onda 4 consertou lá. Com um catálogo de mais de vinte itens, o café que
 * casava e estava na página 2 simplesmente não aparecia.
 *
 * `limit` VAI SEMPRE EXPLÍCITO: o padrão do backend é 10, e uma tela que pagina
 * de 20 em 20 mostrando 10 linhas é uma tela que discorda do próprio rodapé.
 */
export function montarConsulta(estado: EstadoDosProdutos): string {
  return montarUrl("/dashboard", {
    q: estado.busca || undefined,
    category: estado.categoria || undefined,
    // O contrato fala `size`; a tela fala "embalagem". A tradução acontece aqui,
    // num lugar só, e não espalhada por cada `<a href>` da tela.
    size: estado.embalagem || undefined,
    onlyNew: estado.novidade === "novos" ? "true" : undefined,
    onlyOld: estado.novidade === "antigos" ? "true" : undefined,
    page: estado.pagina,
    limit: POR_PAGINA,
  });
}

/**
 * A URL desta tela para um estado — a "aba salva" do R2.
 *
 * `pagina: 1` é OMITIDA: é o valor padrão, e `?pagina=1` cria uma segunda URL
 * para a mesma tela — duas entradas no histórico e dois favoritos que o gestor
 * não sabe distinguir.
 */
export function urlDaTela(estado: Partial<EstadoDosProdutos>): string {
  const pagina = estado.pagina ?? 1;
  return montarUrl(ROTA_DE_PRODUTOS, {
    q: estado.busca?.trim() || undefined,
    categoria: estado.categoria?.trim() || undefined,
    embalagem: estado.embalagem?.trim() || undefined,
    novidade: estado.novidade || undefined,
    pagina: pagina > 1 ? pagina : undefined,
  });
}

/** A ficha de um produto. O id vive na URL — ver `urlDoProduto`. */
export function urlDoProduto(id: string): string {
  return `${ROTA_DE_PRODUTOS}/${id}`;
}

/**
 * A tela de cadastro.
 *
 * ELA É UMA ROTA, E ISSO É UMA CORREÇÃO DE GRAÇA. No painel legado o
 * `productId` morava em memória volátil, dentro de um context: sair de uma
 * edição sem salvar e clicar em "Cadastrar produto" abria o formulário de
 * EDIÇÃO do produto anterior, com o botão escrito "Atualizar" — e salvar ali
 * sobrescrevia o produto errado achando que criava um novo. Um F5 no meio da
 * edição fazia o inverso. Com o id na URL, os dois casos deixam de existir sem
 * ninguém precisar lembrar deles.
 */
export const ROTA_DE_NOVO_PRODUTO = `${ROTA_DE_PRODUTOS}/novo`;

/**
 * O estado depois de ver a resposta — a página presa dentro do que existe.
 *
 * O caso é o favorito velho: `?pagina=9` num catálogo que encolheu para duas
 * páginas. Sem isto a tela desenha "nenhum resultado para este filtro", que o
 * gestor lê como "o filtro não achou nada" e não como "esta página não existe".
 */
export function estadoCorrigido(
  estado: EstadoDosProdutos,
  total: number,
): EstadoDosProdutos {
  return {
    ...estado,
    pagina: paginaValida(estado.pagina, totalDePaginas(total, POR_PAGINA)),
  };
}

/**
 * Os chips do R3 — um por filtro ativo, cada um com o `href` que o REMOVE.
 *
 * TODO `href` DE REMOÇÃO ZERA A PÁGINA. Tirar um filtro estando na página 4 e
 * continuar na 4 é o jeito mais rápido de fazer uma lista sem filtro parecer
 * vazia — e é o defeito que o R3 inteiro existe para impedir.
 */
export function chipsDosProdutos(estado: EstadoDosProdutos): ChipDeFiltro[] {
  const chips: ChipDeFiltro[] = [];

  if (estado.busca) {
    chips.push({
      chave: "q",
      dimensao: "Busca",
      // O que a PESSOA digitou: ela precisa reconhecer o próprio texto para
      // saber o que está removendo.
      valor: estado.busca,
      href: urlDaTela({ ...estado, busca: "", pagina: 1 }),
    });
  }

  if (estado.categoria) {
    chips.push({
      chave: "categoria",
      dimensao: "Categoria",
      valor: estado.categoria,
      href: urlDaTela({ ...estado, categoria: "", pagina: 1 }),
    });
  }

  if (estado.embalagem) {
    chips.push({
      chave: "embalagem",
      dimensao: "Embalagem",
      valor: estado.embalagem,
      href: urlDaTela({ ...estado, embalagem: "", pagina: 1 }),
    });
  }

  if (estado.novidade) {
    chips.push({
      chave: "novidade",
      dimensao: "Destaque",
      valor: estado.novidade === "novos" ? "Destacados há 5 dias" : "Destaque antigo",
      href: urlDaTela({ ...estado, novidade: "", pagina: 1 }),
    });
  }

  return chips;
}

/** Há filtro ligado? É o que decide qual dos três estados vazios o R16 mostra. */
export function temFiltro(estado: EstadoDosProdutos): boolean {
  return Boolean(
    estado.busca || estado.categoria || estado.embalagem || estado.novidade,
  );
}

/**
 * Os padrões que o backend aplica quando as medidas não vêm — `MEDIDAS_PADRAO`
 * em `dashboardRepository.js`.
 *
 * A CÓPIA É DELIBERADA E TEM DE SER EXATA, porque o que se procura aqui não é
 * "um valor plausível": é a IMPRESSÃO DIGITAL do formulário legado, que é o
 * conjunto exato dos quatro números que ele deixava para trás. Um teste desta
 * pasta compara esta constante com o arquivo do backend lido do disco, no mesmo
 * molde de `lib/painel/status.ts` — se um lado mudar sozinho, fica vermelho.
 */
export const MEDIDAS_PADRAO = {
  peso: 0.3,
  largura: 20,
  altura: 5,
  comprimento: 20,
} as const;

/** `numeric` volta do `pg` como STRING ("1.200"). Quem comparar sem converter
 *  compara texto, e "0.300" !== "0.3" mesmo sendo o mesmo peso. */
function comoNumero(valor: string | number | null | undefined): number {
  if (valor === null || valor === undefined || valor === "") return NaN;
  return typeof valor === "number" ? valor : Number(valor);
}

/**
 * O produto está com AS QUATRO medidas exatamente nos padrões da caixa?
 *
 * O QUE ISTO É E O QUE NÃO É. Não é um erro: um pacote de 250 g que realmente
 * pese 0,3 kg numa caixa de 20×5×20 cm é perfeitamente possível — os padrões
 * foram escolhidos justamente por serem a caixa mais comum desta loja. É um
 * SINAL: quando os quatro batem ao mesmo tempo, ou alguém digitou os quatro
 * iguais aos padrões, ou aquele produto passou pelo formulário legado e teve as
 * medidas reais substituídas sem nada aparecer na tela.
 *
 * OS QUATRO JUNTOS, e nunca um só. Peso 0,3 sozinho é comuníssimo; peso 0,3 com
 * 20×5×20 ao mesmo tempo é a assinatura. Marcar por um campo só encheria a
 * lista de alarme falso, e alarme falso é como se ensina a ignorar o alarme.
 */
export function medidaEhOPadrao(produto: {
  weight: string | number;
  width: string | number;
  height: string | number;
  length: string | number;
}): boolean {
  return (
    comoNumero(produto.weight) === MEDIDAS_PADRAO.peso &&
    comoNumero(produto.width) === MEDIDAS_PADRAO.largura &&
    comoNumero(produto.height) === MEDIDAS_PADRAO.altura &&
    comoNumero(produto.length) === MEDIDAS_PADRAO.comprimento
  );
}

/**
 * A caixa em uma linha — "0,3 kg · 20×5×20 cm".
 *
 * `pt-BR` com vírgula decimal, e a unidade JUNTO do número: uma coluna de
 * tabela com "0.3" solto obriga quem lê a lembrar se aquilo é quilo ou grama, e
 * a diferença entre as duas leituras é mil vezes o valor do frete.
 */
const NUMERO_BR = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 3 });

export function resumoDaCaixa(produto: {
  weight: string | number;
  width: string | number;
  height: string | number;
  length: string | number;
}): string {
  const peso = comoNumero(produto.weight);
  const l = comoNumero(produto.width);
  const a = comoNumero(produto.height);
  const c = comoNumero(produto.length);

  // Qualquer um ilegível derruba a linha inteira para "—": meia medida numa
  // coluna de frete é pior que nenhuma, porque parece completa.
  if ([peso, l, a, c].some((n) => !Number.isFinite(n))) return "—";

  return `${NUMERO_BR.format(peso)} kg · ${NUMERO_BR.format(l)}×${NUMERO_BR.format(
    a,
  )}×${NUMERO_BR.format(c)} cm`;
}

/**
 * O identificador HUMANO do produto, para a primeira coluna — R23.
 *
 * "nunca UUID": `product_id` é a chave, e ninguém reconhece um café por ela. Um
 * produto sem nome não deveria existir (o backend exige 2 caracteres), mas
 * cadastro herdado da loja antiga existe: nesse caso o SKU é o identificador
 * humano, porque é por ele que o café aparece na vitrine e no Bling.
 */
export function identificarProduto(produto: {
  name: string | null;
  sku: string | null;
}): string {
  const nome = (produto.name ?? "").trim();
  if (nome) return nome;
  const sku = (produto.sku ?? "").trim();
  if (sku) return sku;
  return "Sem nome";
}

export function temSku(produto: { sku: string | null }): boolean {
  return (produto.sku ?? "").trim() !== "";
}

/**
 * O que dizer no lugar do SKU quando não há SKU.
 *
 * NÃO É UM TRAVESSÃO. Em toda outra coluna do painel a ausência é "—", e aqui
 * ela não pode ser: SKU vazio não é um campo em branco, é o produto FORA da
 * loja — a vitrine casa por SKU e descarta quem não tem (ver o cabeçalho deste
 * arquivo). Um travessão diria "não informado"; o que precisa ser dito é a
 * CONSEQUÊNCIA, e é ela que faz alguém ir preencher.
 *
 * A frase é uma constante, e não um literal no JSX, porque ela aparece na lista
 * e na ficha: duas redações para o mesmo fato fazem parecer dois problemas.
 */
export const AVISO_SEM_SKU = "não aparece na loja";
