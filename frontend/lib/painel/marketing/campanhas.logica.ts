import { formatarCentavos, reaisParaCentavos } from "../dinheiro";
import { montarUrl, textoDoParametro, type ChipDeFiltro } from "../filtros";
import { paginaValida } from "../paginacao";
import type { TomDeStatus } from "../status";
import { CANAIS_DE_CAMPANHA, rotuloDe } from "./vocabulario";

/**
 * A decisão inteira da tela de Campanhas — sem React e sem fetch.
 *
 * O QUE UMA CAMPANHA É AQUI: um NOME, um CANAL, uma UTM que a amarra ao que
 * chega em `pedidos.utm_campaign`, um CUSTO DE MÍDIA e uma janela. O custo é o
 * campo que decide se a tela presta: sem ele o relatório de campanha soma
 * receita e chama de resultado, que é vaidade — "esta campanha trouxe R$ 4.200"
 * sem dizer que custou R$ 5.000 é pior que não ter relatório nenhum, porque
 * parece uma resposta.
 */

export const ROTA_DE_MARKETING = "/dashboard/marketing";

/** O mesmo teto do backend (`paginacao` em marketingRepository.js: padrão 20,
 *  máximo 100). Pedir mais do que ele entrega faria o rodapé prometer uma
 *  página que a tabela não tem. */
export const POR_PAGINA = 20;

/** Como o Express devolve a campanha — `COLUNAS_DE_CAMPANHA`, exatamente. */
export type Campanha = {
  id: string;
  nome: string;
  canal: string;
  utm_campaign: string | null;
  /**
   * CENTAVOS, INTEIRO — e a unidade está no nome da coluna porque nesta loja
   * ela não é adivinhável: `pedidos.total` vem em REAIS como string do pg, e
   * `campanhas.custo_centavos` vem em centavos como inteiro. Formatar um com o
   * formatador do outro erra por cem, e erra calado.
   */
  custo_centavos: number;
  inicio_em: string | null;
  fim_em: string | null;
  ativa: boolean;
  criada_em: string;
  atualizada_em: string;
};

export type RespostaDeCampanhas = {
  data: Campanha[];
  total: number;
  totalPages: number;
  page: number;
};

export type EstadoDasCampanhas = {
  busca: string;
  canal: string;
  /** `""` = sem filtro, `"true"`/`"false"` = o filtro do backend. Três estados,
   *  e por isso texto e não booleano: um `boolean | undefined` na URL vira
   *  `"undefined"` na query string na primeira distração. */
  ativa: string;
  pagina: number;
  /**
   * QUAL FORMULÁRIO ESTÁ ABERTO — `""` nenhum, `"novo"` o de criação, ou o id
   * de uma campanha da página atual.
   *
   * ELE VIVE NA URL, e não num `useState`, e é R2 levado a sério onde ele
   * costuma ser abandonado: com o formulário na URL, o F5 no meio do preenchi-
   * mento devolve o formulário aberto; o "voltar" do navegador fecha o
   * formulário em vez de sair da tela; e um link colado para outra pessoa abre
   * a campanha certa. Um formulário em estado local perde as três coisas, e a
   * terceira é a que mais custa num painel operado por duas pessoas.
   *
   * NÃO HÁ `GET /admin/campanhas/:id` NO EXPRESS — só listagem, POST e PATCH.
   * Então `editar` só resolve para uma campanha que esteja na PÁGINA carregada,
   * o que é sempre verdade quando se chega pelo link da linha. Um id de outra
   * página abre o formulário vazio em vez de mentir; a tela avisa.
   */
  editar: string;
};

const VAZIO: EstadoDasCampanhas = {
  busca: "",
  canal: "",
  ativa: "",
  pagina: 1,
  editar: "",
};

export function lerEstado(
  parametros: Record<string, string | string[] | undefined>,
): EstadoDasCampanhas {
  const canal = textoDoParametro(parametros.canal);
  const ativa = textoDoParametro(parametros.ativa);

  return {
    busca: textoDoParametro(parametros.q),
    /*
      UM CANAL FORA DA LISTA VIRA "SEM FILTRO", e não vai para o backend.
      A rota responde 400 com frase para canal inválido, e um link velho ou um
      parâmetro digitado à mão transformariam a tela inteira numa tarja de erro
      — quando o certo é mostrar a lista completa. O mesmo para `ativa`: só os
      dois literais que o backend entende passam.
    */
    canal: CANAIS_DE_CAMPANHA.some((c) => c.valor === canal) ? canal : "",
    ativa: ativa === "true" || ativa === "false" ? ativa : "",
    // O teto real vem do backend; aqui só se impede página zero ou negativa.
    pagina: paginaValida(parametros.pagina, Number.MAX_SAFE_INTEGER),
    editar: textoDoParametro(parametros.editar),
  };
}

export function montarConsulta(estado: EstadoDasCampanhas): string {
  return montarUrl("/admin/campanhas", {
    q: estado.busca || undefined,
    canal: estado.canal || undefined,
    ativa: estado.ativa || undefined,
    page: estado.pagina,
    limit: POR_PAGINA,
  });
}

export function urlDaTela(estado: Partial<EstadoDasCampanhas>): string {
  const pagina = estado.pagina ?? 1;
  return montarUrl(ROTA_DE_MARKETING, {
    q: estado.busca?.trim() || undefined,
    canal: estado.canal || undefined,
    ativa: estado.ativa || undefined,
    pagina: pagina > 1 ? pagina : undefined,
    editar: estado.editar || undefined,
  });
}

/**
 * A campanha que o formulário deve mostrar — ou `null` para o de criação.
 *
 * Devolve `null` TAMBÉM quando o id não está na página carregada, e essa é a
 * decisão que a ausência de `GET /admin/campanhas/:id` obriga: sem a rota, um
 * id de outra página não tem como ser resolvido. Abrir o formulário VAZIO ali
 * seria pior que não abrir — a pessoa preencheria achando que edita e criaria
 * uma campanha nova. Quem chama recebe `{ aberto, campanha, perdida }` e a tela
 * desenha o aviso quando `perdida` é verdadeiro.
 */
export function formularioAberto(
  estado: EstadoDasCampanhas,
  linhas: Campanha[],
): { aberto: boolean; campanha: Campanha | null; perdida: boolean } {
  if (estado.editar === "") return { aberto: false, campanha: null, perdida: false };
  if (estado.editar === "novo") return { aberto: true, campanha: null, perdida: false };

  const campanha = linhas.find((linha) => linha.id === estado.editar) ?? null;
  return { aberto: campanha !== null, campanha, perdida: campanha === null };
}

/**
 * Os chips — R3. Cada um remove SÓ a sua dimensão e volta para a página 1.
 *
 * Voltar para a 1 não é detalhe: quem está na página 4 de um filtro e o remove
 * cai numa página 4 que pode não existir mais, e a tela desenha "nenhum
 * resultado" logo depois de ele ter LIMPADO um filtro — exatamente a leitura
 * "sumiu tudo" que o R3 existe para impedir.
 */
export function chipsDasCampanhas(estado: EstadoDasCampanhas): ChipDeFiltro[] {
  const chips: ChipDeFiltro[] = [];

  /*
    REMOVER UM FILTRO FECHA O FORMULÁRIO (`editar: ""`), e isso não é
    arbitrário: a campanha em edição está na página ATUAL, e mudar o filtro
    refaz a página. Carregar `editar` adiante abriria a tela num estado
    "perdido" — id na URL, linha fora da lista —, e o aviso de campanha não
    encontrada apareceria logo depois de a pessoa ter clicado num chip, sem
    nenhuma relação aparente com o que ela fez.
  */
  const semFormulario = { ...estado, editar: "", pagina: 1 };

  if (estado.busca) {
    chips.push({
      chave: "q",
      dimensao: "Busca",
      valor: estado.busca,
      href: urlDaTela({ ...semFormulario, busca: "" }),
    });
  }
  if (estado.canal) {
    chips.push({
      chave: "canal",
      dimensao: "Canal",
      valor: rotuloDe(CANAIS_DE_CAMPANHA, estado.canal),
      href: urlDaTela({ ...semFormulario, canal: "" }),
    });
  }
  if (estado.ativa) {
    chips.push({
      chave: "ativa",
      dimensao: "Situação",
      valor: estado.ativa === "true" ? "Ligada" : "Desligada",
      href: urlDaTela({ ...semFormulario, ativa: "" }),
    });
  }
  return chips;
}

export function temFiltro(estado: EstadoDasCampanhas): boolean {
  return estado.busca !== "" || estado.canal !== "" || estado.ativa !== "";
}

export function estadoLimpo(): EstadoDasCampanhas {
  return { ...VAZIO };
}

/* -------------------------------------------------------------------------- *
 * A JANELA, DERIVADA DAS DATAS — nunca uma coluna gravada
 * -------------------------------------------------------------------------- */

export type FaseDaJanela = "sem_janela" | "agendada" | "vigente" | "encerrada";

/**
 * Em que fase da janela a campanha está AGORA.
 *
 * DERIVADA, NUNCA GRAVADA — é a lição que `PromotionsManager.jsx` deixou nesta
 * casa: ele MUTAVA `p.active = false` ao carregar uma promoção fora da janela,
 * o formulário levava o valor mutado, o submit gravava `ativa = false`, e o
 * botão de reativar ficava travado pela mesma regra de janela. A promoção
 * ficava inalcançável pela tela que deveria consertá-la. Aqui a fase é uma
 * FUNÇÃO das duas datas e não toca em `ativa`.
 *
 * DATA NULA SIGNIFICA "VALE SEMPRE", e é o OPOSTO do modelo legado — lá uma
 * promoção `ativa` sem datas nunca valia. As duas nulas é `sem_janela`, e a
 * tela diz por escrito o que isso quer dizer, porque a pessoa que administrava
 * o painel antigo aprendeu a regra contrária.
 */
export function faseDaJanela(
  campanha: Pick<Campanha, "inicio_em" | "fim_em">,
  agora: Date = new Date(),
): FaseDaJanela {
  const inicio = instante(campanha.inicio_em);
  const fim = instante(campanha.fim_em);

  if (inicio === null && fim === null) return "sem_janela";
  if (inicio !== null && agora.getTime() < inicio) return "agendada";
  if (fim !== null && agora.getTime() > fim) return "encerrada";
  return "vigente";
}

function instante(valor: string | null): number | null {
  if (!valor) return null;
  const t = new Date(valor).getTime();
  return Number.isNaN(t) ? null : t;
}

export type SituacaoDaCampanha = {
  rotulo: string;
  tom: TomDeStatus;
  /** A frase que explica a situação — vai no `title` e na ficha, nunca só a
   *  cor: quem não distingue verde de âmbar precisa da palavra. */
  explicacao: string;
};

/**
 * O que a coluna "Situação" mostra — a junção do INTERRUPTOR com a JANELA.
 *
 * As duas coisas são independentes no banco (`ativa` é boolean, a janela são
 * duas datas), e mostrar só uma delas produz uma tela que mente de dois jeitos
 * opostos:
 *
 *   · só `ativa` ...... "Ligada" numa campanha que terminou em março;
 *   · só a janela ..... "Vigente" numa campanha que o gestor desligou ontem.
 *
 * A CONTRADIÇÃO É O CASO QUE MAIS PRECISA DE NOME: `ativa = true` fora da
 * janela é o estado em que a pessoa acha que está anunciando e não está. Ele
 * ganha o tom de alerta e uma frase que diz o que fazer.
 */
export function situacaoDaCampanha(
  campanha: Pick<Campanha, "ativa" | "inicio_em" | "fim_em">,
  agora: Date = new Date(),
): SituacaoDaCampanha {
  const fase = faseDaJanela(campanha, agora);

  if (!campanha.ativa) {
    return {
      rotulo: "Desligada",
      tom: "neutro",
      explicacao:
        "O interruptor está desligado. As datas não importam enquanto ele estiver assim.",
    };
  }

  if (fase === "sem_janela") {
    return {
      rotulo: "Sem janela",
      tom: "sucesso",
      explicacao:
        "Ligada e sem datas: vale sempre, até alguém desligar. Neste modelo data em branco é «sem limite», não «nunca vale».",
    };
  }
  if (fase === "vigente") {
    return {
      rotulo: "Vigente",
      tom: "sucesso",
      explicacao: "Ligada e dentro da janela de datas.",
    };
  }
  if (fase === "agendada") {
    return {
      rotulo: "Agendada",
      tom: "alerta",
      explicacao:
        "Ligada, mas a janela ainda não começou — nenhuma venda será atribuída a ela até lá.",
    };
  }
  return {
    rotulo: "Encerrada",
    tom: "alerta",
    explicacao:
      "Ligada, mas a janela já passou. Se o anúncio ainda está no ar, corrija a data de fim; se acabou mesmo, desligue.",
  };
}

/* -------------------------------------------------------------------------- *
 * O formulário
 * -------------------------------------------------------------------------- */

/**
 * O que o gestor digita. TUDO TEXTO, porque tudo veio de um `<input>` — e o
 * custo é em REAIS, com vírgula, porque é assim que ele pensa em dinheiro. A
 * conversão para centavos acontece num lugar só, em `montarPayload`.
 */
export type FormularioDeCampanha = {
  nome: string;
  canal: string;
  utm_campaign: string;
  custoEmReais: string;
  /** `datetime-local`: "2026-08-26T09:00". Vazio é NULL, como nas promoções. */
  inicio_em: string;
  fim_em: string;
  ativa: boolean;
};

export function formularioVazio(): FormularioDeCampanha {
  return {
    nome: "",
    // O canal é OBRIGATÓRIO no backend e não tem padrão sensato: pré-selecionar
    // "google" faria a campanha do panfleto nascer com canal errado por
    // distração. Vazio força a escolha.
    canal: "",
    utm_campaign: "",
    custoEmReais: "",
    inicio_em: "",
    fim_em: "",
    ativa: true,
  };
}

export function formularioDe(campanha: Campanha): FormularioDeCampanha {
  return {
    nome: campanha.nome,
    canal: campanha.canal,
    utm_campaign: campanha.utm_campaign ?? "",
    /*
      CENTAVOS → REAIS COM VÍRGULA, e não `String(custo_centavos / 100)`: em
      pt-BR o separador decimal é a vírgula, e um campo que abre com "1500.5"
      convida a pessoa a "consertar" para "1500,5" — ou pior, a ler mil e
      quinhentos como mil quinhentos e cinquenta.
    */
    custoEmReais: (campanha.custo_centavos / 100).toFixed(2).replace(".", ","),
    inicio_em: paraCampoLocal(campanha.inicio_em),
    fim_em: paraCampoLocal(campanha.fim_em),
    ativa: campanha.ativa,
  };
}

/**
 * ISO → o valor que `<input type="datetime-local">` aceita.
 *
 * O CORTE É EM São Paulo, e não em UTC. `toISOString().slice(0,16)` é o atalho
 * óbvio e está errado por três horas: uma campanha que começa às 21h de 25/08
 * em Brasília é `2026-08-26T00:00Z`, e o campo abriria em **26/08 00:00** — o
 * gestor salvaria de volta e a campanha andaria um dia para a frente a cada
 * edição. R31 existe por isto.
 */
export function paraCampoLocal(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";

  const partes = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(d);

  const p = (tipo: string) => partes.find((x) => x.type === tipo)?.value ?? "";
  // `en-CA` entrega hora 24h, mas a meia-noite sai como "24" em alguns ICUs.
  const hora = p("hour") === "24" ? "00" : p("hour");
  return `${p("year")}-${p("month")}-${p("day")}T${hora}:${p("minute")}`;
}

/**
 * AS FRASES SÃO AS DO BACKEND, COPIADAS DE PROPÓSITO — e há teste que as
 * compara com `marketingRepository.js` lido do disco.
 *
 * A regra desta casa é "a frase do servidor ganha sempre", e a validação local
 * parece contrariá-la. Não contraria: ela existe para a pessoa não esperar uma
 * ida ao servidor para descobrir que digitou espaço numa UTM. O que a faria
 * mentir seria INVENTAR uma frase diferente — aí a mesma recusa teria dois
 * textos, e o gestor que ligasse para o suporte leria um que não existe em
 * lugar nenhum do código do servidor. Copiadas e travadas por teste, as duas
 * pontas dizem a mesma coisa ou o teste fica vermelho.
 */
export const FRASE_UTM_COM_ESPACO =
  "A UTM da campanha não pode conter espaço — use hífen (dia-das-maes-2026).";
export const FRASE_UTM_LONGA =
  "A UTM da campanha é longa demais (máximo de 120 caracteres).";
export const FRASE_SEM_NOME = "A campanha precisa de um nome.";
export const FRASE_JANELA_INVERTIDA =
  "O fim da campanha precisa ser depois do início.";

export type ErrosDaCampanha = Partial<
  Record<"nome" | "canal" | "utm_campaign" | "custoEmReais" | "fim_em", string>
>;

/**
 * A UTM canônica — minúscula, sem espaço, até 120.
 *
 * MAIÚSCULA É NORMALIZADA E ESPAÇO É RECUSADO, e a assimetria é a do backend,
 * não uma escolha desta tela: `lower()` é conversão sem perda (a UTM é a CHAVE
 * de junção com `pedidos.utm_campaign`, e "Verao"/"verao" partiriam a campanha
 * em duas linhas de relatório), mas "dia das maes" e "dia-das-maes" são
 * decisões diferentes sobre a mesma campanha — e escolher uma por conta própria
 * mudaria a chave que o anúncio já está usando lá fora.
 */
export function utmCanonica(bruto: string): {
  valor: string | null;
  erro: string | null;
} {
  const texto = bruto.trim();
  if (texto === "") return { valor: null, erro: null };

  const normalizada = texto.toLowerCase();
  if (/\s/.test(normalizada)) return { valor: null, erro: FRASE_UTM_COM_ESPACO };
  if (normalizada.length > 120) return { valor: null, erro: FRASE_UTM_LONGA };
  return { valor: normalizada, erro: null };
}

export function validarCampanha(
  form: FormularioDeCampanha,
): ErrosDaCampanha {
  const erros: ErrosDaCampanha = {};

  if (form.nome.trim() === "") erros.nome = FRASE_SEM_NOME;

  if (!CANAIS_DE_CAMPANHA.some((c) => c.valor === form.canal)) {
    // A frase do backend lista os oito valores CRUS ("google, meta, …"); aqui a
    // tela tem um seletor, então a instrução útil é a do gesto, não a lista.
    erros.canal = "Escolha o canal da campanha.";
  }

  const utm = utmCanonica(form.utm_campaign);
  if (utm.erro) erros.utm_campaign = utm.erro;

  const custo = custoEmCentavos(form.custoEmReais);
  if (custo === null) {
    erros.custoEmReais = "Informe o custo em reais (0 se não houve gasto).";
  }

  const inicio = form.inicio_em.trim();
  const fim = form.fim_em.trim();
  if (inicio && fim && new Date(fim).getTime() <= new Date(inicio).getTime()) {
    erros.fim_em = FRASE_JANELA_INVERTIDA;
  }

  return erros;
}

/**
 * REAIS DIGITADOS → CENTAVOS INTEIROS. Vazio é ZERO, e não erro.
 *
 * O backend tem `custo_centavos NOT NULL DEFAULT 0` e um CHECK de não-negativo:
 * campanha sem custo é uma coisa que existe (o panfleto, o post orgânico, o
 * influenciador que não cobrou). Exigir um número ali obrigaria a digitar "0"
 * para registrar o que não custou nada — e um campo obrigatório que quase
 * sempre vale zero é um campo que se preenche sem ler.
 *
 * Devolve `null` só para o que NÃO É NÚMERO ou é negativo, que é o que a
 * validação transforma em frase.
 */
export function custoEmCentavos(digitado: string): number | null {
  const texto = digitado.trim();
  if (texto === "") return 0;
  const centavos = reaisParaCentavos(texto);
  if (centavos === null || centavos < 0) return null;
  return centavos;
}

/** O corpo do `POST /admin/campanhas` — exatamente os sete campos que ele lê. */
export type PayloadDeCampanha = {
  nome: string;
  canal: string;
  utm_campaign: string | null;
  custo_centavos: number;
  inicio_em: string | null;
  fim_em: string | null;
  ativa: boolean;
};

/**
 * O payload. Só é chamado depois de `validarCampanha` devolver vazio.
 *
 * As datas vão como o `datetime-local` as entregou ("2026-08-26T09:00"), sem
 * fuso: é o que `new Date(...)` do Node interpreta no fuso do SERVIDOR, e o
 * contêiner do Express roda em `America/Sao_Paulo` como o resto desta loja. É
 * também exatamente o que as promoções já mandam — divergir aqui faria as duas
 * telas gravarem horários diferentes para o mesmo clique.
 */
export function montarPayload(form: FormularioDeCampanha): PayloadDeCampanha {
  return {
    nome: form.nome.trim(),
    canal: form.canal,
    utm_campaign: utmCanonica(form.utm_campaign).valor,
    custo_centavos: custoEmCentavos(form.custoEmReais) ?? 0,
    inicio_em: form.inicio_em.trim() || null,
    fim_em: form.fim_em.trim() || null,
    ativa: form.ativa,
  };
}

/* -------------------------------------------------------------------------- *
 * O que a tabela mostra
 * -------------------------------------------------------------------------- */

/** A UTM ausente NÃO é um defeito, e a tela não pode sugerir que seja: o índice
 *  de 0033 é PARCIAL (`UNIQUE ... WHERE utm_campaign IS NOT NULL`) justamente
 *  para o panfleto e o influenciador sem link rastreado conviverem. */
export function utmEmTexto(campanha: Campanha): string {
  return campanha.utm_campaign ?? "Sem UTM";
}

export function custoEmTexto(campanha: Campanha): string {
  return formatarCentavos(campanha.custo_centavos);
}

/**
 * A soma do custo da PÁGINA — e o nome diz "daPagina" porque é isso que ela é.
 *
 * O backend não devolve total de custo, e somar as 20 linhas visíveis e chamar
 * de "investimento do período" seria a mentira mais fácil desta tela. Quem
 * desenha o rodapé escreve "nesta página" ao lado, e o nome da função é o que
 * impede a próxima pessoa de reusá-la achando que é o total.
 */
export function custoDaPaginaEmCentavos(linhas: Campanha[]): number {
  return linhas.reduce((soma, c) => soma + (c.custo_centavos || 0), 0);
}
