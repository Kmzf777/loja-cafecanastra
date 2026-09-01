import { formatarCentavos, formatarReais } from "../dinheiro";
import { formatarData } from "../data";
import { montarUrl, textoDoParametro, type ChipDeFiltro } from "../filtros";
import { paginaValida, totalDePaginas } from "../paginacao";
import type { TomDeStatus } from "../status";
import {
  API_DESCONTOS,
  CLASSES,
  METODOS,
  ROTA_DE_DESCONTOS,
  type Classe,
  type Mecanica,
  type Metodo,
  type RegraDaLista,
} from "./contrato";

/**
 * A lista de regras de desconto — filtro, estado na URL e as DERIVAÇÕES.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * O STATUS É DERIVADO DAS DATAS, E NÃO É COLUNA.
 *
 * Esta é a decisão que a tela inteira gira em volta, e ela nasceu de um defeito
 * medido no painel legado (`PromotionsManager.jsx:84-107`):
 *
 *   · o load MUTAVA `p.active = false` quando a data estava fora da janela;
 *   · `handleEdit` levava o valor MUTADO para o formulário;
 *   · o submit gravava `ativa = false`;
 *   · e o botão de reativar ficava `disabled` pela MESMA regra de janela.
 *
 * Resultado: abrir uma promoção expirada para corrigir a data a desativava
 * permanentemente e a tornava inalcançável pela tela. O gestor perdia a regra
 * exatamente no gesto que existia para salvá-la.
 *
 * A correção não é "não mutar" — é a derivação nunca virar dado. `habilitada` é
 * uma decisão do gestor e mora no banco; "vigente/agendada/expirada" é uma
 * LEITURA DO RELÓGIO e é calculada a cada render, aqui, a partir de um objeto
 * que ninguém tocou. As duas coisas nunca se escrevem uma na outra.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * `agora` É PARÂMETRO, E POR ISSO ESTE MÓDULO É TESTÁVEL.
 *
 * Uma função que lê `new Date()` por dentro só pode ser testada com o relógio
 * de hoje, e um teste de "expirada" escrito assim passa hoje e passa amanhã por
 * motivos diferentes. Com o instante entrando pela porta, a tabela-verdade de
 * vigência é escrita uma vez e vale sempre.
 */

/* ========================================================================== *
 * Vigência e situação
 * ========================================================================== */

/** As três leituras do relógio. Nunca gravadas, nunca enviadas. */
export type Vigencia = "agendada" | "vigente" | "expirada";

/**
 * O que a lista MOSTRA na coluna de status — e são cinco, não três.
 *
 * A vigência responde "o relógio permite?"; `habilitada` e `arquivada_em`
 * respondem "o gestor quer?". Mostrar só a vigência faria uma regra desligada
 * aparecer como "vigente", que é a mentira mais cara que esta tela poderia
 * contar: é ela que o gestor lê para decidir se o desconto está no ar.
 */
export type Situacao = Vigencia | "desligada" | "arquivada";

export const SITUACOES: readonly Situacao[] = [
  "vigente",
  "agendada",
  "expirada",
  "desligada",
  "arquivada",
];

export const NOME_DA_SITUACAO: Record<Situacao, string> = {
  vigente: "Vigente",
  agendada: "Agendada",
  expirada: "Expirada",
  desligada: "Desligada",
  arquivada: "Arquivada",
};

/**
 * O tom de cada situação — e nenhuma delas é vermelha.
 *
 * "Expirada" é o fim normal da vida de uma promoção, não um defeito. R21
 * reserva o vermelho a erro e ação destrutiva, e pintar de vermelho a metade da
 * lista que simplesmente já passou é o caminho mais curto para o gestor parar
 * de acreditar nos erros de verdade.
 */
export const TOM_DA_SITUACAO: Record<Situacao, TomDeStatus> = {
  vigente: "sucesso",
  agendada: "alerta",
  expirada: "neutro",
  desligada: "neutro",
  arquivada: "neutro",
};

type ComJanela = {
  inicio_em: string | null;
  fim_em: string | null;
};

function instante(valor: string | null): number | null {
  if (!valor) return null;
  const t = new Date(valor).getTime();
  return Number.isNaN(t) ? null : t;
}

/**
 * A vigência de uma regra, lida do relógio.
 *
 * NULO SIGNIFICA "SEM BORDA DESTE LADO", e é aqui que o modelo novo é o oposto
 * do legado. Em `promocoes_legado`, `findActivePromotionsForCheckout` só
 * aplicava a promoção com `inicio_em` E `fim_em` preenchidos — uma promoção
 * salva sem datas nunca valia, sem aviso nenhum. Em 0032 o `CHECK` só exige que
 * início venha antes do fim: sem início, vale desde já; sem fim, vale para
 * sempre. O formulário DIZ isso na cara do gestor (ver `formulario.logica.ts`),
 * porque uma inversão silenciosa de significado é pior que as duas regras.
 */
export function vigenciaDaRegra(regra: ComJanela, agora: Date): Vigencia {
  const t = agora.getTime();
  const inicio = instante(regra.inicio_em);
  const fim = instante(regra.fim_em);

  if (inicio !== null && t < inicio) return "agendada";
  if (fim !== null && t > fim) return "expirada";
  return "vigente";
}

export function situacaoDaRegra(
  regra: ComJanela & { habilitada: boolean; arquivada_em: string | null },
  agora: Date,
): Situacao {
  // A ordem é a da precedência de decisão: arquivar é definitivo, desligar é
  // do gestor, e só então o relógio tem voz.
  if (regra.arquivada_em) return "arquivada";
  if (!regra.habilitada) return "desligada";
  return vigenciaDaRegra(regra, agora);
}

/**
 * A regra está DE FATO descontando neste instante?
 *
 * As três condições juntas, num nome só, porque a lista precisa dizer "está no
 * ar" numa palavra e três booleanos espalhados pelo JSX viram três chances de
 * esquecer um.
 */
export function estaNoAr(
  regra: ComJanela & { habilitada: boolean; arquivada_em: string | null },
  agora: Date,
): boolean {
  return situacaoDaRegra(regra, agora) === "vigente";
}

/* ========================================================================== *
 * Formatadores
 * ========================================================================== */

const AUSENTE = "—";

export const NOME_DO_METODO: Record<Metodo, string> = {
  automatico: "Automático",
  codigo: "Com código",
};

export const NOME_DA_CLASSE: Record<Classe, string> = {
  produto: "Por produto",
  pedido: "No pedido",
  frete: "No frete",
};

export const NOME_DA_MECANICA: Record<Mecanica, string> = {
  percentual: "Percentual",
  valor_fixo: "Valor fixo",
  preco_fixo: "Preço fixo",
  leve_x_pague_y: "Leve X pague Y",
  progressivo: "Progressivo",
  brinde: "Brinde",
  frete_gratis: "Frete grátis",
};

/**
 * O valor da regra em texto, e o RÓTULO MUDA COM A MECÂNICA porque a UNIDADE
 * muda com a mecânica.
 *
 * É herança deliberada de `cupons` (0010), registrada na própria migração:
 * percentual são pontos percentuais, `valor_fixo` são reais abatidos,
 * `preco_fixo` são os reais que o item passa a custar, `leve_x_pague_y` é o X.
 * Mostrar "15" sem dizer se são quinze por cento ou quinze reais é oferecer ao
 * gestor a chance de errar por um fator de quatro.
 */
export function valorEmTexto(
  mecanica: Mecanica,
  valor: string | null,
  faixas?: { quantidade_min: number; desconto_valor: string }[],
): string {
  const n = valor === null || valor === "" ? null : Number(valor);

  switch (mecanica) {
    case "percentual":
      return n === null || Number.isNaN(n) ? AUSENTE : `${formatarNumero(n)}%`;
    case "valor_fixo":
      return formatarReais(valor);
    case "preco_fixo":
      return `${formatarReais(valor)} por item`;
    case "leve_x_pague_y": {
      const x = n === null || Number.isNaN(n) ? null : Math.trunc(n);
      const y = faixas?.[0]?.desconto_valor;
      if (x === null) return AUSENTE;
      return y ? `Leve ${x}, pague ${Math.trunc(Number(y))}` : `Leve ${x}`;
    }
    case "progressivo":
      return faixas?.length ? `${faixas.length} faixas` : "Sem faixas";
    case "brinde":
      return "Brinde";
    case "frete_gratis":
      return "Frete grátis";
  }
}

/** Sem casa decimal quando não há: "10%" e não "10,00%". */
function formatarNumero(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(2).replace(".", ",");
}

/**
 * A janela em texto, com as QUATRO formas — e a quarta é a que precisa dizer o
 * que significa.
 *
 * "Sem prazo" sozinho é ambíguo entre "nunca vale" (o legado) e "vale sempre"
 * (o modelo novo), e o gestor que trabalhou com o painel antigo lê a primeira.
 * Por isso a frase carrega o significado junto.
 */
export function janelaEmTexto(regra: ComJanela): string {
  const temInicio = Boolean(regra.inicio_em);
  const temFim = Boolean(regra.fim_em);

  if (temInicio && temFim) {
    return `${formatarData(regra.inicio_em)} a ${formatarData(regra.fim_em)}`;
  }
  if (temInicio) return `A partir de ${formatarData(regra.inicio_em)}`;
  if (temFim) return `Até ${formatarData(regra.fim_em)}`;
  return "Sem prazo — vale sempre";
}

/** "3/100" ou "3/sem limite" — o mesmo formatador de `CuponsManager`, que é o
 *  que o gestor já sabe ler. */
export function usosEmTexto(usos: number, limite: number | null): string {
  const usados = Number.isFinite(usos) ? usos : 0;
  return limite === null || limite === undefined
    ? `${usados}/sem limite`
    : `${usados}/${limite}`;
}

/** O que a regra já tirou do caixa, em reais. É a coluna que responde a
 *  pergunta que o dono da loja faz primeiro: "quanto isso custou?". */
export function descontadoEmTexto(centavos: number): string {
  return formatarCentavos(Number.isFinite(centavos) ? centavos : 0);
}

/** Os códigos da regra, resumidos: um cupom de influencer pode ter 500. */
export function codigosEmTexto(codigos: string[]): string {
  if (!codigos || codigos.length === 0) return AUSENTE;
  if (codigos.length === 1) return codigos[0];
  return `${codigos[0]} +${codigos.length - 1}`;
}

/* ========================================================================== *
 * O estado da lista, na URL — R2
 * ========================================================================== */

export const POR_PAGINA = 20;

export type EstadoDosDescontos = {
  busca: string;
  situacao: Situacao | "";
  metodo: Metodo | "";
  classe: Classe | "";
  pagina: number;
};

function umDe<T extends string>(
  lista: readonly T[],
  bruto: string | string[] | undefined,
): T | "" {
  const texto = textoDoParametro(bruto);
  return (lista as readonly string[]).includes(texto) ? (texto as T) : "";
}

export function lerEstado(
  parametros: Record<string, string | string[] | undefined>,
): EstadoDosDescontos {
  return {
    busca: textoDoParametro(parametros.q),
    situacao: umDe(SITUACOES, parametros.situacao),
    metodo: umDe(METODOS, parametros.metodo),
    classe: umDe(CLASSES, parametros.classe),
    // Teto de verdade só com a resposta em mãos — aqui só interessa "não é
    // lixo e não é menor que 1".
    pagina: paginaValida(parametros.pagina, Number.MAX_SAFE_INTEGER),
  };
}

export function urlDaTela(estado: Partial<EstadoDosDescontos>): string {
  const pagina = estado.pagina ?? 1;
  return montarUrl(ROTA_DE_DESCONTOS, {
    q: estado.busca?.trim() || undefined,
    situacao: estado.situacao || undefined,
    metodo: estado.metodo || undefined,
    classe: estado.classe || undefined,
    pagina: pagina > 1 ? pagina : undefined,
  });
}

/**
 * A consulta que vai à API.
 *
 * `situacao` VIAJA PARA O SERVIDOR mesmo sendo derivada — e não é contradição.
 * Derivar no cliente resolveria a página atual e mentiria sobre a contagem: com
 * 300 regras e 20 por página, filtrar "vigente" depois de paginar mostraria as
 * vigentes DAS VINTE, e o rodapé diria 300. É o mesmo defeito que a tela legada
 * de clientes tinha ("filtrava em memória: a caixa de busca escondia quem
 * casava e estava na página 3"). O servidor deriva a mesma coisa, com o mesmo
 * predicado de janela que `motorRepository.PREDICADO_DE_VIGENCIA` já usa.
 */
export function montarConsulta(estado: EstadoDosDescontos): string {
  return montarUrl(API_DESCONTOS, {
    q: estado.busca.trim() || undefined,
    situacao: estado.situacao || undefined,
    metodo: estado.metodo || undefined,
    classe: estado.classe || undefined,
    pagina: estado.pagina,
    limite: POR_PAGINA,
  });
}

/* ========================================================================== *
 * Chips — R3
 * ========================================================================== */

export function chipsDosDescontos(estado: EstadoDosDescontos): ChipDeFiltro[] {
  const chips: ChipDeFiltro[] = [];
  const semPagina = { ...estado, pagina: 1 };

  if (estado.busca) {
    chips.push({
      chave: "q",
      dimensao: "Busca",
      valor: estado.busca,
      href: urlDaTela({ ...semPagina, busca: "" }),
    });
  }
  if (estado.situacao) {
    chips.push({
      chave: "situacao",
      dimensao: "Situação",
      valor: NOME_DA_SITUACAO[estado.situacao],
      href: urlDaTela({ ...semPagina, situacao: "" }),
    });
  }
  if (estado.metodo) {
    chips.push({
      chave: "metodo",
      dimensao: "Método",
      valor: NOME_DO_METODO[estado.metodo],
      href: urlDaTela({ ...semPagina, metodo: "" }),
    });
  }
  if (estado.classe) {
    chips.push({
      chave: "classe",
      dimensao: "Onde incide",
      valor: NOME_DA_CLASSE[estado.classe],
      href: urlDaTela({ ...semPagina, classe: "" }),
    });
  }
  return chips;
}

export function temFiltro(estado: EstadoDosDescontos): boolean {
  return chipsDosDescontos(estado).length > 0;
}

export function estadoCorrigido(
  estado: EstadoDosDescontos,
  total: number,
): EstadoDosDescontos {
  return {
    ...estado,
    pagina: paginaValida(estado.pagina, totalDePaginas(total, POR_PAGINA)),
  };
}

/* ========================================================================== *
 * Abas salvas — R4
 * ========================================================================== */

export type AbaSalva = { rotulo: string; href: string; ativa: boolean };

/**
 * As abas que o gestor abre toda semana, salvas de verdade — cada uma é uma URL
 * completa, não um estado de componente. É o que faz "Vigentes" sobreviver ao
 * F5, ao link colado no WhatsApp e ao botão Voltar.
 *
 * "Frete grátis" é uma aba e não uma tela separada: são as mesmas regras, na
 * mesma tabela, com a mesma janela e o mesmo relatório. Uma tela própria só
 * para elas obrigaria a manter dois filtros, duas paginações e duas listas de
 * colunas, e faria o gestor procurar em dois lugares a regra que ele não lembra
 * como cadastrou.
 */
export function abasDosDescontos(estado: EstadoDosDescontos): AbaSalva[] {
  const zerado: EstadoDosDescontos = {
    busca: "",
    situacao: "",
    metodo: "",
    classe: "",
    pagina: 1,
  };
  const vazio =
    !estado.situacao && !estado.classe && !estado.metodo && !estado.busca;

  return [
    { rotulo: "Todas", href: urlDaTela(zerado), ativa: vazio },
    {
      rotulo: "Vigentes",
      href: urlDaTela({ ...zerado, situacao: "vigente" }),
      ativa: estado.situacao === "vigente" && !estado.classe && !estado.metodo,
    },
    {
      rotulo: "Agendadas",
      href: urlDaTela({ ...zerado, situacao: "agendada" }),
      ativa: estado.situacao === "agendada" && !estado.classe && !estado.metodo,
    },
    {
      rotulo: "Com código",
      href: urlDaTela({ ...zerado, metodo: "codigo" }),
      ativa: estado.metodo === "codigo" && !estado.situacao && !estado.classe,
    },
    {
      rotulo: "Frete grátis",
      href: urlDaTela({ ...zerado, classe: "frete" }),
      ativa: estado.classe === "frete" && !estado.situacao && !estado.metodo,
    },
    {
      rotulo: "Arquivadas",
      href: urlDaTela({ ...zerado, situacao: "arquivada" }),
      ativa: estado.situacao === "arquivada",
    },
  ];
}

/* ========================================================================== *
 * A frase da confirmação de arquivamento — R11/R12
 * ========================================================================== */

/**
 * "Tem certeza?" NÃO CARREGA INFORMAÇÃO e treina a clicar em OK. A confirmação
 * nomeia o objeto e diz a consequência, e aqui a consequência tem duas metades
 * que o gestor precisa ouvir juntas: a regra sai do ar AGORA, e o histórico
 * fica. R13 desta casa manda arquivar em vez de apagar, e `promocao_resgates`
 * referencia a promoção com `ON DELETE RESTRICT` — o banco não deixaria apagar
 * uma regra já usada nem se alguém quisesse.
 */
export function fraseDeArquivamento(regra: RegraDaLista): string {
  const usos = Number.isFinite(regra.usos) ? regra.usos : 0;
  const historico =
    usos === 0
      ? " Nada é apagado: a regra sai da lista e continua no histórico."
      : usos === 1
        ? " O resgate já feito continua no histórico e nos relatórios."
        : ` Os ${usos} resgates já feitos continuam no histórico e nos relatórios.`;

  return `Arquivar "${regra.nome}" tira a regra do ar imediatamente — nenhum carrinho novo vai recebê-la.${historico}`;
}
