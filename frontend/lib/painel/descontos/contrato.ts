/**
 * O contrato da tela de Descontos — o vocabulário de `0032_motor_de_promocao.sql`
 * escrito em TypeScript, e as rotas que a tela consome.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * POR QUE O VOCABULÁRIO É COPIADO DO BANCO, E NÃO INVENTADO AQUI.
 *
 * Quase toda coluna nova de 0032 carrega um `CHECK`, e isso foi decisão da
 * migração: "hoje `promocoes.tipo` e `promocoes.aplica_a` são `text` sem CHECK
 * nenhum, e só o JavaScript de UM caminho valida". A tela repete essas listas
 * para RECUSAR ANTES DE IR, não para substituir o banco — quem manda continua
 * sendo o `CHECK`. A diferença que isso faz na prática é a frase: um valor fora
 * do vocabulário barrado aqui vira "Escolha uma mecânica"; barrado só no
 * Postgres vira um 500 com `23514` no log e nada na tela.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * A UNIDADE ESTÁ NO NOME DE TODO CAMPO DE DINHEIRO, e isto é a lição mais cara
 * do checklist de paridade: "as unidades monetárias são inconsistentes dentro
 * do mesmo schema e da mesma tela — é o erro mais barato de cometer e o mais
 * caro de descobrir".
 *
 *   `valor` .................. REAIS, e chega como STRING (é `numeric(10,2)` do
 *                              pg, que o driver entrega como texto para não
 *                              perder precisão). A UNIDADE DELE DEPENDE DA
 *                              MECÂNICA — ver `MECANICAS`.
 *   `*_centavos` ............. CENTAVOS, inteiro. Todo dinheiro de COMPARAÇÃO
 *                              (mínimo, teto, orçamento) é assim, pela regra de
 *                              0009/0010.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * AS ROTAS AINDA NÃO EXISTEM NO EXPRESS — e este arquivo é onde isso está
 * escrito.
 *
 * A Onda 3 criou as sete tabelas e a Onda 4 escreveu o motor (`utils/motor.js`
 * + `repositories/motorRepository.js`), mas NENHUMA rota de administração do
 * motor foi montada: `backend/src/routes/` não tem um único caminho que fale
 * com `canastra.promocoes` nova. `promotions.routes.js` continua servindo a
 * tabela LEGADA (`promocoes_legado`), que é outra coisa.
 *
 * A tela é escrita contra o contrato abaixo e degrada com frase própria quando
 * a rota responde 404 — que é exatamente a mitigação transversal do checklist
 * de paridade ("toda tela degrada com frase própria para 404 de módulo ausente,
 * porque produção pode estar atrás do repositório"). Aqui não é produção que
 * está atrás: é o backend que ainda não tem a onda dele.
 */

/* ========================================================================== *
 * 1. O vocabulário fechado de 0032
 * ========================================================================== */

/**
 * `automatico` aplica sozinho no carrinho; `codigo` exige o cliente digitar.
 * É a unificação de promoção e cupom numa entidade só (spec §3.1).
 */
export const METODOS = ["automatico", "codigo"] as const;
export type Metodo = (typeof METODOS)[number];

/** A ordem de aplicação do motor é esta ordem, e não é acidente (motor.js). */
export const CLASSES = ["produto", "pedido", "frete"] as const;
export type Classe = (typeof CLASSES)[number];

export const MECANICAS = [
  "percentual",
  "valor_fixo",
  "preco_fixo",
  "leve_x_pague_y",
  "progressivo",
  "brinde",
  "frete_gratis",
] as const;
export type Mecanica = (typeof MECANICAS)[number];

/**
 * AS MECÂNICAS QUE O BANCO ACEITA E O MOTOR NÃO CALCULA.
 *
 * `brinde` passa em todo `CHECK` de 0032 — a regra salva, aparece na lista,
 * mostra "vigente" — e `utils/motor.js` não gera ajuste monetário nenhum para
 * ela. O resultado é uma regra INERTE: o gestor cadastra o brinde, anuncia, e o
 * carrinho cobra o preço cheio sem que nada na tela indique o porquê.
 *
 * A tela recusa salvar. Não é zelo excessivo: uma regra que existe e não faz
 * nada é pior do que uma regra que não existe, porque consome a confiança de
 * quem a cadastrou em todas as outras.
 */
export const MECANICAS_INERTES: readonly Mecanica[] = ["brinde"] as const;

export const MINIMOS = ["nenhum", "subtotal", "quantidade"] as const;
export type MinimoTipo = (typeof MINIMOS)[number];

export const TIPOS_DE_ESCOPO = [
  "produto",
  "categoria",
  "sku",
  "todos",
  "assinante",
] as const;
export type TipoDeEscopo = (typeof TIPOS_DE_ESCOPO)[number];

/** `todos` e `assinante` são PORTEIROS: valem para o carrinho, não miram um
 *  alvo. O `CHECK promocao_escopo_alvo_coerente` exige `alvo IS NULL` neles. */
export const ESCOPOS_SEM_ALVO: readonly TipoDeEscopo[] = ["todos", "assinante"];

export const TIPOS_DE_FAIXA = [
  "percentual",
  "valor_fixo",
  "preco_fixo",
  "pague_y",
] as const;
export type TipoDeFaixa = (typeof TIPOS_DE_FAIXA)[number];

/**
 * O vocabulário FECHADO da loja para meio de pagamento.
 *
 * O que o checkout grava é o `payment_method_id` do Mercado Pago, que é uma
 * lista ABERTA ('visa', 'master', 'elo', 'bolbradesco'...). `motor.js` traduz
 * aquilo para estes quatro antes de comparar — uma regra escrita contra 'visa'
 * simplesmente não se aplicaria a um Mastercard, em silêncio, e é essa a
 * armadilha que 0032 fechou no schema.
 */
export const MEIOS_DE_PAGAMENTO = ["pix", "credito", "debito", "boleto"] as const;
export type MeioDePagamento = (typeof MEIOS_DE_PAGAMENTO)[number];

export const NOME_DO_MEIO: Record<MeioDePagamento, string> = {
  pix: "PIX",
  credito: "Cartão de crédito",
  debito: "Cartão de débito",
  boleto: "Boleto",
};

/** As 27 UFs, na mesma ordem do `CHECK promocao_frete_ufs_validas`. */
export const UFS = [
  "AC", "AL", "AP", "AM", "BA", "CE", "DF", "ES", "GO",
  "MA", "MT", "MS", "MG", "PA", "PB", "PR", "PE", "PI",
  "RJ", "RN", "RS", "RO", "RR", "SC", "SP", "SE", "TO",
] as const;
export type Uf = (typeof UFS)[number];

/** O formato de código de 0010, repetido palavra por palavra em 0032. */
export const FORMATO_DE_CODIGO = /^[A-Z0-9]{3,30}$/;

/** O teto de percentual do banco. "100%" libera a loja de graça para quem
 *  abrir a página — e o `CHECK promocoes_percentual_ate_90` existe por isso. */
export const TETO_PERCENTUAL = 90;

/* ========================================================================== *
 * 2. O que a API devolve
 * ========================================================================== */

export type LinhaDeEscopo = {
  id?: string;
  tipo: TipoDeEscopo;
  alvo: string | null;
  /**
   * `false` É A EXCEÇÃO, e é o campo que dá "10% na loja toda, MENOS o
   * micro-lote". Sem ele, a única forma de excluir um produto seria listar
   * todos os outros à mão.
   */
  incluir: boolean;
};

export type Faixa = {
  id?: string;
  quantidade_min: number;
  desconto_tipo: TipoDeFaixa;
  /** REAIS, exceto em `pague_y`, onde é a QUANTIDADE que se paga. */
  desconto_valor: string;
};

export type RegraDeFrete = {
  teto_frete_centavos: number | null;
  ufs: Uf[] | null;
  apenas_modalidade_mais_barata: boolean;
  /** Oito dígitos, sem hífen — o `CHECK` do banco recusa o formatado. */
  cep_inicio: string | null;
  cep_fim: string | null;
};

export type CodigoDaRegra = {
  id?: string;
  codigo: string;
  uso_unico: boolean;
  limite_usos: number | null;
  ativo: boolean;
  /** Contador do banco. A FONTE DA VERDADE do uso é `promocao_resgates`;
   *  este número é o denormalizado, e a Shopify documenta que o dela defasa. */
  usos?: number;
};

/** A linha da LISTA — o que `GET /admin/descontos` devolve por regra. */
export type RegraDaLista = {
  id: string;
  nome: string;
  metodo: Metodo;
  classe: Classe;
  mecanica: Mecanica;
  /** REAIS como string; a unidade depende da mecânica. */
  valor: string | null;
  inicio_em: string | null;
  fim_em: string | null;
  habilitada: boolean;
  arquivada_em: string | null;
  limite_usos: number | null;
  /** Resgates NÃO estornados — contados de `promocao_resgates`, nunca do
   *  contador denormalizado de `promocao_codigos`. */
  usos: number;
  /** A soma dos resgates não estornados, em CENTAVOS. */
  descontado_centavos: number;
  /** Os códigos, só para a lista conseguir mostrá-los sem uma segunda ida. */
  codigos: string[];
};

export type RegraCompleta = RegraDaLista & {
  descricao: string | null;
  teto_desconto_centavos: number | null;
  minimo_tipo: MinimoTipo;
  minimo_valor: number | null;
  prioridade: number;
  exclusiva: boolean;
  grupo_exclusividade: string | null;
  meios_pagamento: MeioDePagamento[] | null;
  limite_por_cliente: number | null;
  orcamento_centavos: number | null;
  escopo: LinhaDeEscopo[];
  faixas: Faixa[];
  frete: RegraDeFrete | null;
  codigos_detalhe: CodigoDaRegra[];
};

export type RespostaDeDescontos = {
  data: RegraDaLista[];
  total: number;
  pagina: number;
  totalPaginas: number;
};

/* ========================================================================== *
 * 3. O que a tela envia
 * ========================================================================== */

/**
 * O corpo de `POST` e de `PUT`.
 *
 * O `PUT` É SUBSTITUIÇÃO TOTAL, E DE PROPÓSITO — mas não pelo motivo do
 * legado. Lá, `PUT /promotions/:id` "não é parcial: o repositório escreve todas
 * as colunas com o que veio no corpo, e campo ausente vira NULL", o que fazia
 * um formulário que enviasse só o campo alterado apagar título, datas e
 * categoria. Aqui a substituição é total porque `escopo` e `faixas` são LISTAS,
 * e "mesclar" uma lista é uma operação sem significado único: enviar duas
 * faixas quer dizer "estas duas e mais nenhuma".
 *
 * O que muda em relação ao legado é que o formulário SEMPRE carrega a regra
 * inteira (veio do `GET`), então nunca envia um objeto parcial por acidente. E
 * os dois gestos que NÃO são edição de formulário — ligar/desligar e arquivar —
 * têm rota própria, justamente para não precisarem montar o objeto todo.
 */
export type PayloadDeRegra = {
  nome: string;
  descricao: string | null;
  metodo: Metodo;
  classe: Classe;
  mecanica: Mecanica;
  valor: number | null;
  teto_desconto_centavos: number | null;
  minimo_tipo: MinimoTipo;
  minimo_valor: number | null;
  prioridade: number;
  exclusiva: boolean;
  grupo_exclusividade: string | null;
  meios_pagamento: MeioDePagamento[] | null;
  limite_usos: number | null;
  limite_por_cliente: number | null;
  orcamento_centavos: number | null;
  inicio_em: string | null;
  fim_em: string | null;
  habilitada: boolean;
  escopo: LinhaDeEscopo[];
  faixas: Faixa[];
  frete: RegraDeFrete | null;
  codigos: CodigoDaRegra[];
};

/* ========================================================================== *
 * 4. A simulação
 * ========================================================================== */

/**
 * O carrinho que vai ao motor. É o mesmo formato que `calcularDescontos`
 * documenta — `precoCentavos` é o preço UNITÁRIO de catálogo, inteiro.
 */
export type ItemDaSimulacao = {
  produtoId: string | null;
  sku: string | null;
  categoria: string | null;
  precoCentavos: number;
  quantidade: number;
};

export type CarrinhoDaSimulacao = {
  itens: ItemDaSimulacao[];
  meioPagamento: MeioDePagamento | null;
  assinante: boolean;
  frete: {
    valorCentavos: number;
    ehMaisBarata: boolean;
    uf: string | null;
    cep: string | null;
  } | null;
};

/** Um ajuste como o motor o devolve — a mesma forma de
 *  `pedido_ajustes_desconto`, que é onde eles vão parar de verdade. */
export type AjusteSimulado = {
  sequencia: number;
  promocaoId: string | null;
  codigo: string | null;
  alvo: string;
  alvoRef: string | null;
  valorCentavos: number;
  rotulo: string;
};

export type RespostaDaSimulacao = {
  ajustes: AjusteSimulado[];
  totalCentavos: number;
  /** O subtotal que o motor viu, para a tela não precisar recalcular nada. */
  subtotalCentavos: number;
  /** O frete depois dos ajustes de classe `frete`, ou null se não houve. */
  freteFinalCentavos: number | null;
};

/* ========================================================================== *
 * 5. Os caminhos
 * ========================================================================== */

/**
 * `/admin/...` porque é o prefixo que `painel.routes.js` já usa para o que é
 * exclusivo do painel — e a razão dele está escrita lá: as cinco rotas de
 * leitura públicas da API não podem ganhar `isAdmin` sem derrubar a vitrine,
 * então o que precisa de admin nasce em caminho novo.
 */
export const API_DESCONTOS = "/admin/descontos";
export const API_SIMULAR = "/admin/descontos/simular";
export const ROTA_DE_DESCONTOS = "/dashboard/descontos";

/** O catálogo para os seletores. Teto de 200 é o do próprio backend, e a
 *  vitrine já usa exatamente esse número. O UUID nunca é digitado à mão: um
 *  caractere errado apontava para produto nenhum, sem erro em lugar algum. */
export const API_PRODUTOS = "/dashboard?limit=200";

export type ProdutoDoSeletor = {
  product_id: string;
  name: string | null;
  sku: string | null;
  category: string | null;
  /** REAIS — a coluna `preco` do catálogo, traduzida para `price`. */
  price: string | number | null;
};

export type RespostaDeProdutos = {
  products: ProdutoDoSeletor[];
  total: number;
};
