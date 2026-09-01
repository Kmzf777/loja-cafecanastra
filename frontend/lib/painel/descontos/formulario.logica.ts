import { centavosParaReais, reaisParaCentavos } from "../dinheiro";
import { FUSO } from "../data";
import {
  ESCOPOS_SEM_ALVO,
  FORMATO_DE_CODIGO,
  MECANICAS_INERTES,
  TETO_PERCENTUAL,
  UFS,
  type Classe,
  type CodigoDaRegra,
  type Faixa,
  type LinhaDeEscopo,
  type Mecanica,
  type MeioDePagamento,
  type MinimoTipo,
  type Metodo,
  type PayloadDeRegra,
  type RegraCompleta,
  type TipoDeEscopo,
  type TipoDeFaixa,
  type Uf,
} from "./contrato";

/**
 * O formulário guiado de seis passos — a decisão inteira, sem uma linha de React.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * OS SEIS PASSOS SÃO UMA ORDEM DE PERGUNTAS, NÃO UMA DIVISÃO DE CAMPOS.
 *
 * `o que desconta → quanto → para quem → o que inclui e o que exclui →
 * requisitos e limites → janela`. Cada passo responde uma pergunta que o
 * anterior deixou aberta, e é por isso que a ordem não é negociável: "quanto"
 * não faz sentido antes de se saber se o desconto incide sobre a linha, sobre o
 * pedido ou sobre o frete, porque a lista de mecânicas plausíveis muda.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * TUDO É STRING NO FORMULÁRIO, E A CONVERSÃO ACONTECE UMA VEZ SÓ.
 *
 * `<input>` devolve string, sempre. Guardar número no estado obriga a converter
 * a cada tecla — e `Number("")` é `0`, que é o defeito que já derrubou o frete
 * grátis desta loja: "campo enviado VAZIO sobrescreve; `Number('')` é 0, e 0
 * DESLIGA o frete grátis da loja inteira". Aqui vazio permanece vazio até
 * `montarPayload`, e lá ele vira `null` — que é "sem limite", não "limite zero".
 *
 * ────────────────────────────────────────────────────────────────────────────
 * A UNIDADE ESTÁ NO NOME DE TODO CAMPO DE DINHEIRO DO FORMULÁRIO.
 *
 * `teto_desconto_reais` é o que o gestor digita; `teto_desconto_centavos` é o
 * que o banco guarda. Os dois nomes coexistem de propósito: o dia em que
 * alguém passar um pelo outro, o nome grita.
 */

/* ========================================================================== *
 * 1. A forma
 * ========================================================================== */

export type EscopoNoFormulario = {
  tipo: TipoDeEscopo;
  alvo: string;
  incluir: boolean;
};

export type FaixaNoFormulario = {
  quantidade_min: string;
  desconto_tipo: TipoDeFaixa;
  desconto_valor: string;
};

export type CodigoNoFormulario = {
  codigo: string;
  uso_unico: boolean;
  limite_usos: string;
  ativo: boolean;
};

export type FreteNoFormulario = {
  teto_frete_reais: string;
  ufs: Uf[];
  apenas_modalidade_mais_barata: boolean;
  cep_inicio: string;
  cep_fim: string;
};

export type FormularioDeDesconto = {
  nome: string;
  descricao: string;
  metodo: Metodo;
  classe: Classe;
  mecanica: Mecanica;
  /** A UNIDADE DEPENDE DA MECÂNICA — ver `rotuloDoValor`. */
  valor: string;
  teto_desconto_reais: string;
  minimo_tipo: MinimoTipo;
  /** Reais quando `minimo_tipo` é `subtotal`; unidades quando é `quantidade`. */
  minimo_valor: string;
  prioridade: string;
  exclusiva: boolean;
  grupo_exclusividade: string;
  meios_pagamento: MeioDePagamento[];
  limite_usos: string;
  limite_por_cliente: string;
  orcamento_reais: string;
  /** Formato de `<input type="datetime-local">`: `2026-08-27T09:00`. */
  inicio_em: string;
  fim_em: string;
  habilitada: boolean;
  escopo: EscopoNoFormulario[];
  faixas: FaixaNoFormulario[];
  frete: FreteNoFormulario;
  codigos: CodigoNoFormulario[];
};

export const FRETE_VAZIO: FreteNoFormulario = {
  teto_frete_reais: "",
  ufs: [],
  apenas_modalidade_mais_barata: false,
  cep_inicio: "",
  cep_fim: "",
};

/**
 * A regra nova nasce DESLIGADA e sem escopo.
 *
 * `habilitada: false` é a única escolha honesta para uma regra que ainda não
 * foi simulada: o padrão do banco é `true`, e um padrão que põe desconto no ar
 * no instante em que se clica em Salvar transforma um rascunho em prejuízo. O
 * gestor liga quando o simulador confirmou o número.
 */
export const FORMULARIO_VAZIO: FormularioDeDesconto = {
  nome: "",
  descricao: "",
  metodo: "automatico",
  classe: "produto",
  mecanica: "percentual",
  valor: "",
  teto_desconto_reais: "",
  minimo_tipo: "nenhum",
  minimo_valor: "",
  prioridade: "0",
  exclusiva: false,
  grupo_exclusividade: "",
  meios_pagamento: [],
  limite_usos: "",
  limite_por_cliente: "",
  orcamento_reais: "",
  inicio_em: "",
  fim_em: "",
  habilitada: false,
  escopo: [],
  faixas: [],
  frete: { ...FRETE_VAZIO },
  codigos: [],
};

/* ========================================================================== *
 * 2. Os passos
 * ========================================================================== */

export type ChaveDePasso =
  | "oque"
  | "quanto"
  | "quem"
  | "escopo"
  | "limites"
  | "janela"
  | "frete";

export type Passo = {
  chave: ChaveDePasso;
  titulo: string;
  pergunta: string;
};

/**
 * O passo de FRETE é condicional e fica por último — ele só existe quando a
 * regra é da classe `frete`, porque `promocao_frete` é uma tabela com uma linha
 * por promoção de frete e nenhuma para as outras. Mostrá-lo sempre ofereceria
 * "faixa de CEP" a quem está criando 10% no café moído.
 */
const TODOS_OS_PASSOS: Passo[] = [
  { chave: "oque", titulo: "O que desconta", pergunta: "Que tipo de regra é esta, e como o cliente chega nela?" },
  { chave: "quanto", titulo: "Quanto", pergunta: "Qual é a conta, e qual é o teto dela?" },
  { chave: "quem", titulo: "Para quem", pergunta: "Alguma condição sobre quem compra ou como paga?" },
  { chave: "escopo", titulo: "Inclui e exclui", pergunta: "Sobre o que ela incide — e o que fica de fora?" },
  { chave: "limites", titulo: "Requisitos e limites", pergunta: "O que o carrinho precisa ter, e até onde a regra pode ir?" },
  { chave: "janela", titulo: "Janela", pergunta: "De quando até quando?" },
  { chave: "frete", titulo: "Frete grátis", pergunta: "Para onde, com que teto, e em qual modalidade?" },
];

export function passosDoFormulario(forma: FormularioDeDesconto): Passo[] {
  return TODOS_OS_PASSOS.filter((p) => p.chave !== "frete" || forma.classe === "frete");
}

/** A qual passo pertence cada campo — é o que permite marcar a aba onde o erro
 *  está, em vez de dizer "há um erro" e deixar o gestor procurar. */
export function passoDoCampo(chave: string): ChaveDePasso {
  if (chave.startsWith("frete.")) return "frete";
  if (chave.startsWith("codigos.")) return "oque";
  if (chave.startsWith("faixas.")) return "quanto";
  if (chave.startsWith("escopo.")) return "escopo";
  if (chave === "nome" || chave === "descricao" || chave === "metodo" || chave === "classe") {
    return "oque";
  }
  if (chave === "mecanica" || chave === "valor" || chave === "teto_desconto_reais") {
    return "quanto";
  }
  if (chave === "meios_pagamento") return "quem";
  if (chave === "inicio_em" || chave === "fim_em") return "janela";
  return "limites";
}

export function passosComErro(erros: Record<string, string>): ChaveDePasso[] {
  const passos = new Set<ChaveDePasso>();
  for (const chave of Object.keys(erros)) passos.add(passoDoCampo(chave));
  return TODOS_OS_PASSOS.map((p) => p.chave).filter((c) => passos.has(c));
}

/* ========================================================================== *
 * 3. Rótulos que mudam com a mecânica
 * ========================================================================== */

/**
 * O RÓTULO DO CAMPO DE VALOR MUDA COM A MECÂNICA, e a ajuda diz a unidade.
 *
 * É item do checklist de paridade, herdado de `CuponsManager`: "o rótulo do
 * campo de valor muda com o tipo — 'Desconto (%)' ou 'Desconto (R$)' — e a
 * unidade também". Um campo chamado só "Valor" num formulário onde a mesma
 * caixa às vezes é porcentagem e às vezes é dinheiro é um erro de um dígito
 * esperando acontecer.
 */
export function rotuloDoValor(mecanica: Mecanica): {
  rotulo: string;
  ajuda: string;
  usa: boolean;
} {
  switch (mecanica) {
    case "percentual":
      return {
        rotulo: "Desconto (%)",
        ajuda: `Pontos percentuais, de 1 a ${TETO_PERCENTUAL}. O banco recusa acima disso — 100% libera a loja de graça.`,
        usa: true,
      };
    case "valor_fixo":
      return {
        rotulo: "Desconto (R$)",
        ajuda: "Reais abatidos. Sem teto: o serviço trava o desconto no subtotal do pedido.",
        usa: true,
      };
    case "preco_fixo":
      return {
        rotulo: "Preço promocional (R$)",
        ajuda: "O que o item passa a custar, não o quanto sai. Um item de R$ 60 com preço fixo de R$ 45 desconta R$ 15.",
        usa: true,
      };
    case "leve_x_pague_y":
      return {
        rotulo: "Leve quantos (X)",
        ajuda: "A quantidade que o cliente leva. Quantos ele paga (Y) vai na faixa, abaixo.",
        usa: true,
      };
    case "progressivo":
      return {
        rotulo: "Valor",
        ajuda: "Progressivo não usa este campo: são as faixas que carregam os valores.",
        usa: false,
      };
    case "brinde":
      return { rotulo: "Valor", ajuda: "Brinde não usa valor.", usa: false };
    case "frete_gratis":
      return {
        rotulo: "Valor",
        ajuda: "Frete grátis não usa valor — o teto do frete fica no passo Frete grátis.",
        usa: false,
      };
  }
}

/** As mecânicas que carregam faixas — e sem faixa elas não fazem nada. */
export function usaFaixas(mecanica: Mecanica): boolean {
  return mecanica === "progressivo" || mecanica === "leve_x_pague_y";
}

/* ========================================================================== *
 * 4. Datas — o fuso, e por que ele é escrito à mão
 * ========================================================================== */

/**
 * `<input type="datetime-local">` NÃO TEM FUSO. Ele devolve `2026-08-27T09:00`
 * e o navegador não diz de onde. Deixar o `new Date()` do JavaScript resolver
 * isso significa gravar o horário do RELÓGIO DA MÁQUINA de quem cadastrou: o
 * gestor viajando, um servidor em UTC ou um notebook com o fuso errado gravam
 * três instantes diferentes para a mesma digitação.
 *
 * O painel inteiro é `America/Sao_Paulo` (R31), então a conversão é explícita:
 * `-03:00`. O Brasil abandonou o horário de verão em 2019, então o deslocamento
 * é constante — se um dia voltar, ESTA é a linha que muda, e ela está sozinha.
 */
const DESLOCAMENTO_DE_SAO_PAULO = "-03:00";

const PARTES_LOCAIS = new Intl.DateTimeFormat("sv-SE", {
  timeZone: FUSO,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

/** ISO do banco → o valor de `datetime-local`, já em horário de São Paulo. */
export function paraCampoDeData(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  // `sv-SE` formata como `2026-08-27 09:00` — só o espaço separa do que o
  // input espera. É o truque mais barato para não montar a string à mão.
  return PARTES_LOCAIS.format(d).replace(" ", "T");
}

/** O valor de `datetime-local` → ISO com fuso explícito, para o banco. */
export function deCampoDeData(campo: string): string | null {
  const texto = campo.trim();
  if (!texto) return null;
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(texto)) return null;
  return `${texto}:00${DESLOCAMENTO_DE_SAO_PAULO}`;
}

/* ========================================================================== *
 * 5. Números — vazio é ausência, nunca zero
 * ========================================================================== */

/** Inteiro positivo, ou `null` quando o campo está vazio. NUNCA `0`: campo em
 *  branco significa "sem limite", e `Number("")` daria zero, que significa
 *  "limite de nenhum uso" — a regra nasceria morta. */
export function inteiroOuNulo(texto: string): number | null {
  const limpo = texto.trim();
  if (limpo === "") return null;
  const n = Number(limpo);
  if (!Number.isFinite(n)) return null;
  return Math.trunc(n);
}

/** Reais digitados → centavos, ou `null` no vazio. Aceita vírgula. */
export function centavosOuNulo(texto: string): number | null {
  const limpo = texto.trim();
  if (limpo === "") return null;
  return reaisParaCentavos(limpo);
}

/** Número decimal (o `valor` da regra, que é `numeric` no banco). */
export function numeroOuNulo(texto: string): number | null {
  const limpo = texto.trim().replace(",", ".");
  if (limpo === "") return null;
  const n = Number(limpo);
  return Number.isFinite(n) ? n : null;
}

/** Só dígitos — o CEP entra no banco com oito e sem hífen, e o `CHECK` recusa
 *  o formatado. Comparar `'01310-100'` com `'01310100'` é um bug que só aparece
 *  em produção, e esta loja já teve um dessa família (commit `7fe8d36`). */
export function soDigitos(texto: string): string {
  return texto.replace(/\D/g, "");
}

/* ========================================================================== *
 * 6. Validação — o que a tela recusa antes de ir
 * ========================================================================== */

export type Erros = Record<string, string>;

/**
 * A validação inteira. Cada regra aqui espelha um `CHECK` de 0032 ou uma
 * armadilha registrada no checklist de paridade — e nenhuma delas SUBSTITUI o
 * banco: o Postgres continua sendo quem manda. O que a tela ganha é a FRASE.
 */
export function validar(forma: FormularioDeDesconto): Erros {
  const erros: Erros = {};

  /* --- Passo 1: o que desconta ------------------------------------------- */

  if (!forma.nome.trim()) {
    erros.nome = "Dê um nome à regra — é por ele que ela vai ser encontrada daqui a três meses.";
  }

  if (forma.metodo === "codigo") {
    const ativos = forma.codigos.filter((c) => c.codigo.trim() !== "");
    if (ativos.length === 0) {
      erros["codigos.0.codigo"] =
        "Método com código exige pelo menos um código — sem ele ninguém tem como pedir o desconto.";
    }
    const vistos = new Set<string>();
    forma.codigos.forEach((c, i) => {
      const codigo = c.codigo.trim().toUpperCase();
      if (codigo === "") return;
      if (!FORMATO_DE_CODIGO.test(codigo)) {
        erros[`codigos.${i}.codigo`] =
          "De 3 a 30 caracteres, só letras maiúsculas e números — é o formato que o banco aceita.";
      } else if (vistos.has(codigo)) {
        erros[`codigos.${i}.codigo`] = "Este código já está repetido nesta regra.";
      }
      vistos.add(codigo);

      const limite = inteiroOuNulo(c.limite_usos);
      if (limite !== null && limite <= 0) {
        erros[`codigos.${i}.limite_usos`] = "Deixe em branco para sem limite, ou informe um número maior que zero.";
      }
    });
  }

  /* --- Passo 2: quanto ---------------------------------------------------- */

  /**
   * A TRAVA DO BRINDE — a única proibição desta tela que não vem de um `CHECK`.
   *
   * O banco aceita `mecanica = 'brinde'` e `utils/motor.js` não gera ajuste
   * monetário nenhum para ela. A regra salva, aparece "vigente" na lista, e o
   * carrinho cobra o preço cheio: uma regra INERTE, indistinguível de uma que
   * funciona. Recusar aqui é a única forma de o gestor saber.
   */
  if (MECANICAS_INERTES.includes(forma.mecanica)) {
    erros.mecanica =
      "O motor de descontos ainda não calcula brinde: a regra seria salva e ficaria inerte, sem descontar nada e sem avisar. Escolha outra mecânica.";
  }

  const valor = numeroOuNulo(forma.valor);
  const usoDoValor = rotuloDoValor(forma.mecanica);

  if (usoDoValor.usa) {
    if (valor === null || valor <= 0) {
      erros.valor = "Informe um valor maior que zero.";
    } else if (forma.mecanica === "percentual" && valor > TETO_PERCENTUAL) {
      erros.valor = `O teto é ${TETO_PERCENTUAL}% — acima disso o checkout calcularia preço negativo, que abatia dos outros itens.`;
    } else if (forma.mecanica === "leve_x_pague_y" && (!Number.isInteger(valor) || valor < 2)) {
      erros.valor = "Leve quantos precisa ser um número inteiro de 2 para cima.";
    }
  }

  const teto = centavosOuNulo(forma.teto_desconto_reais);
  if (forma.teto_desconto_reais.trim() !== "" && (teto === null || teto <= 0)) {
    erros.teto_desconto_reais = "Use reais, por exemplo 30,00. Em branco significa sem teto.";
  }

  if (usaFaixas(forma.mecanica)) {
    if (forma.faixas.length === 0) {
      erros["faixas.0.quantidade_min"] =
        forma.mecanica === "progressivo"
          ? "Progressivo sem faixa não desconta nada — acrescente pelo menos uma."
          : "Informe quantos itens o cliente paga (Y) numa faixa.";
    }
    const pisos = new Set<number>();
    forma.faixas.forEach((faixa, i) => {
      const qtd = inteiroOuNulo(faixa.quantidade_min);
      const dv = numeroOuNulo(faixa.desconto_valor);

      if (qtd === null || qtd <= 0) {
        erros[`faixas.${i}.quantidade_min`] = "A partir de quantos itens? Um número maior que zero.";
      } else if (pisos.has(qtd)) {
        // O `UNIQUE (promocao_id, quantidade_min)` do banco existe porque duas
        // faixas com o mesmo piso deixariam o motor escolher pela ordem do heap.
        erros[`faixas.${i}.quantidade_min`] = "Já existe uma faixa com este piso.";
      }
      if (qtd !== null) pisos.add(qtd);

      if (dv === null || dv <= 0) {
        erros[`faixas.${i}.desconto_valor`] = "Informe um valor maior que zero.";
      } else if (faixa.desconto_tipo === "percentual" && dv > TETO_PERCENTUAL) {
        erros[`faixas.${i}.desconto_valor`] = `O teto é ${TETO_PERCENTUAL}%.`;
      } else if (faixa.desconto_tipo === "pague_y" && qtd !== null && dv >= qtd) {
        erros[`faixas.${i}.desconto_valor`] =
          "Pagar tantos quanto se leva não é desconto — Y precisa ser menor que a quantidade da faixa.";
      }
    });
  }

  /* --- Passo 4: escopo ---------------------------------------------------- */

  const alvosVistos = new Set<string>();
  forma.escopo.forEach((linha, i) => {
    const precisaDeAlvo = !ESCOPOS_SEM_ALVO.includes(linha.tipo);
    const alvo = linha.alvo.trim();

    if (precisaDeAlvo && alvo === "") {
      erros[`escopo.${i}.alvo`] = "Escolha o produto, a categoria ou o SKU.";
    }
    const chave = `${linha.tipo}:${precisaDeAlvo ? alvo : ""}`;
    if (alvosVistos.has(chave) && (alvo !== "" || !precisaDeAlvo)) {
      erros[`escopo.${i}.alvo`] = "Esta linha já está no escopo.";
    }
    alvosVistos.add(chave);
  });

  /* --- Passo 5: requisitos e limites -------------------------------------- */

  if (forma.minimo_tipo !== "nenhum") {
    const bruto =
      forma.minimo_tipo === "subtotal"
        ? centavosOuNulo(forma.minimo_valor)
        : inteiroOuNulo(forma.minimo_valor);
    if (bruto === null || bruto <= 0) {
      // "'subtotal' + NULL" é "acima de nada" — vale sempre, com o gestor
      // achando que colocou um piso. O `CHECK promocoes_minimo_coerente`
      // recusa; aqui a frase explica.
      erros.minimo_valor =
        forma.minimo_tipo === "subtotal"
          ? "Informe o piso em reais, por exemplo 149,00 — ou volte o tipo para “sem mínimo”."
          : "Informe quantos itens, no mínimo — ou volte o tipo para “sem mínimo”.";
    }
  }

  for (const [campo, rotulo] of [
    ["limite_usos", "usos no total"],
    ["limite_por_cliente", "usos por CPF"],
  ] as const) {
    const texto = forma[campo];
    const n = inteiroOuNulo(texto);
    if (texto.trim() !== "" && (n === null || n <= 0)) {
      erros[campo] = `Deixe em branco para sem limite de ${rotulo}, ou informe um número maior que zero.`;
    }
  }

  const orcamento = centavosOuNulo(forma.orcamento_reais);
  if (forma.orcamento_reais.trim() !== "" && (orcamento === null || orcamento <= 0)) {
    erros.orcamento_reais = "Use reais, por exemplo 5.000,00. Em branco significa sem orçamento.";
  }

  const prioridade = inteiroOuNulo(forma.prioridade);
  if (forma.prioridade.trim() !== "" && prioridade === null) {
    erros.prioridade = "Um número inteiro. Maior aplica primeiro.";
  }

  // O `CHECK promocoes_grupo_exige_exclusiva`: grupo preenchido implica
  // exclusiva. Sem a trava seria um campo que não faz nada.
  if (forma.grupo_exclusividade.trim() !== "" && !forma.exclusiva) {
    erros.grupo_exclusividade =
      "Grupo só faz sentido em regra exclusiva — marque “exclusiva” ou deixe o grupo em branco.";
  }

  /* --- Passo 6: janela ---------------------------------------------------- */

  const inicio = deCampoDeData(forma.inicio_em);
  const fim = deCampoDeData(forma.fim_em);
  if (forma.inicio_em.trim() !== "" && inicio === null) {
    erros.inicio_em = "Data ou hora incompleta.";
  }
  if (forma.fim_em.trim() !== "" && fim === null) {
    erros.fim_em = "Data ou hora incompleta.";
  }
  if (inicio && fim && new Date(inicio).getTime() >= new Date(fim).getTime()) {
    erros.fim_em = "O fim precisa vir depois do início.";
  }

  /* --- Passo condicional: frete ------------------------------------------- */

  if (forma.classe === "frete") {
    const f = forma.frete;
    const tetoFrete = centavosOuNulo(f.teto_frete_reais);
    if (f.teto_frete_reais.trim() !== "" && (tetoFrete === null || tetoFrete <= 0)) {
      erros["frete.teto_frete_reais"] = "Use reais, por exemplo 35,00.";
    }

    const inicioCep = soDigitos(f.cep_inicio);
    const fimCep = soDigitos(f.cep_fim);
    const temUm = Boolean(inicioCep) !== Boolean(fimCep);
    if (temUm) {
      // `CHECK ((cep_inicio IS NULL) = (cep_fim IS NULL))` — meia faixa não é
      // faixa, e o banco recusa.
      erros[inicioCep ? "frete.cep_fim" : "frete.cep_inicio"] =
        "A faixa de CEP precisa dos dois extremos — ou nenhum.";
    }
    if (inicioCep && inicioCep.length !== 8) {
      erros["frete.cep_inicio"] = "Oito dígitos. O hífen pode ir, ele é removido.";
    }
    if (fimCep && fimCep.length !== 8) {
      erros["frete.cep_fim"] = "Oito dígitos. O hífen pode ir, ele é removido.";
    }
    if (
      inicioCep.length === 8 &&
      fimCep.length === 8 &&
      inicioCep > fimCep
    ) {
      erros["frete.cep_fim"] = "O CEP final precisa ser maior ou igual ao inicial.";
    }

    const forasteiras = f.ufs.filter((uf) => !(UFS as readonly string[]).includes(uf));
    if (forasteiras.length) {
      erros["frete.ufs"] = `UF desconhecida: ${forasteiras.join(", ")}.`;
    }
  }

  return erros;
}

/* ========================================================================== *
 * 7. Avisos — o que a tela DIZ sem impedir
 * ========================================================================== */

export type Aviso = {
  chave: string;
  passo: ChaveDePasso;
  texto: string;
  /** `alerta` custa dinheiro se ignorado; `aviso` é só informação. */
  tom: "alerta" | "aviso";
};

/**
 * Os avisos que existem porque o SILÊNCIO é que era o defeito.
 *
 * A armadilha do painel legado era exatamente esta: uma promoção `ativa` sem
 * datas nunca valia, e nada na tela dizia. No modelo novo o significado é o
 * OPOSTO — data nula é "sem borda deste lado" — e uma inversão silenciosa de
 * significado é pior que as duas regras isoladas, porque quem trabalhou com o
 * painel antigo vai ler o que aprendeu. Então a tela fala.
 */
export function avisosDoFormulario(forma: FormularioDeDesconto): Aviso[] {
  const avisos: Aviso[] = [];
  const semInicio = forma.inicio_em.trim() === "";
  const semFim = forma.fim_em.trim() === "";

  if (semInicio && semFim) {
    avisos.push({
      chave: "janela.nenhuma",
      passo: "janela",
      tom: "alerta",
      texto:
        "Sem nenhuma data, esta regra vale SEMPRE — a partir do instante em que for ligada, e até alguém desligá-la à mão. (No painel antigo era o contrário: promoção sem datas nunca valia.)",
    });
  } else if (semFim) {
    avisos.push({
      chave: "janela.sem_fim",
      passo: "janela",
      tom: "alerta",
      texto:
        "Sem data de fim, a regra vale para sempre. Ninguém vai desligá-la por você.",
    });
  } else if (semInicio) {
    avisos.push({
      chave: "janela.sem_inicio",
      passo: "janela",
      tom: "aviso",
      texto: "Sem data de início, a regra vale desde já.",
    });
  }

  /**
   * O TETO EM DINHEIRO É A METADE DA DEFESA QUE O PERCENTUAL NÃO TEM.
   * "20% de desconto" numa compra de R$ 3.000 são R$ 600 que ninguém aprovou.
   */
  if (
    (forma.mecanica === "percentual" || forma.mecanica === "progressivo") &&
    forma.teto_desconto_reais.trim() === ""
  ) {
    avisos.push({
      chave: "teto.ausente",
      passo: "quanto",
      tom: "alerta",
      texto:
        "Sem teto, um percentual desconta proporcionalmente a qualquer carrinho: 20% numa compra de R$ 3.000 são R$ 600.",
    });
  }

  /**
   * O LIMITE POR CPF É O QUE IMPEDE UM CUPOM VAZADO DE COMER A MARGEM DO MÊS.
   * E é por CPF, não por e-mail, porque e-mail é infinito e gratuito — cupom de
   * primeira compra controlado por e-mail é cupom permanente.
   */
  if (forma.metodo === "codigo" && forma.limite_por_cliente.trim() === "") {
    avisos.push({
      chave: "cpf.ausente",
      passo: "limites",
      tom: "alerta",
      texto:
        "Código sem limite por CPF: se ele cair num grupo de WhatsApp, a mesma pessoa usa quantas vezes quiser. O limite é por CPF porque e-mail é infinito e gratuito.",
    });
  }

  if (forma.classe === "frete") {
    if (forma.frete.teto_frete_reais.trim() === "") {
      avisos.push({
        chave: "frete.sem_teto",
        passo: "frete",
        tom: "alerta",
        texto:
          "Sem teto do frete, “frete grátis acima de R$ 149” significa bancar um SEDEX de R$ 90 para o Acre. O teto é o valor de frete acima do qual a regra deixa de valer.",
      });
    }
    if (!forma.frete.apenas_modalidade_mais_barata) {
      avisos.push({
        chave: "frete.modalidade",
        passo: "frete",
        tom: "aviso",
        texto:
          "Sem “só na modalidade mais barata”, o cliente escolhe o SEDEX de graça quando a loja queria bancar o PAC.",
      });
    }
    if (forma.frete.ufs.length === 0 && forma.frete.cep_inicio.trim() === "") {
      avisos.push({
        chave: "frete.sem_regiao",
        passo: "frete",
        tom: "aviso",
        texto: "Sem UF nem faixa de CEP, a regra vale para o Brasil inteiro.",
      });
    }
  }

  if (forma.escopo.length === 0) {
    avisos.push({
      chave: "escopo.vazio",
      passo: "escopo",
      tom: "aviso",
      texto:
        forma.classe === "produto"
          ? "Sem escopo, a regra alcança todos os itens do carrinho."
          : "Sem escopo, a regra alcança qualquer carrinho.",
    });
  }

  /**
   * CLASSE E MECÂNICA PODEM DIVERGIR SEM O BANCO RECLAMAR — não há `CHECK` que
   * as ligue. Uma regra de classe `frete` com mecânica `percentual` é aceita e
   * desconta 10% DO FRETE, que pode ser o que se queria ou não. Aviso, não erro.
   */
  if (forma.classe === "frete" && forma.mecanica !== "frete_gratis") {
    avisos.push({
      chave: "classe.frete",
      passo: "quanto",
      tom: "aviso",
      texto:
        "Regra de frete com mecânica que não é “frete grátis”: o desconto incide sobre o VALOR DO FRETE, não sobre os produtos.",
    });
  }
  if (forma.classe !== "frete" && forma.mecanica === "frete_gratis") {
    avisos.push({
      chave: "classe.nao_frete",
      passo: "quanto",
      tom: "alerta",
      texto:
        "“Frete grátis” só tem efeito na classe Frete. Nesta classe a regra não vai descontar nada.",
    });
  }

  if (!forma.habilitada) {
    avisos.push({
      chave: "desligada",
      passo: "janela",
      tom: "aviso",
      texto:
        "A regra está desligada: ela é salva, fica na lista e não desconta nada até ser ligada.",
    });
  }

  return avisos;
}

/* ========================================================================== *
 * 8. Ida e volta com a API
 * ========================================================================== */

export function montarPayload(forma: FormularioDeDesconto): PayloadDeRegra {
  const usoDoValor = rotuloDoValor(forma.mecanica);

  const escopo: LinhaDeEscopo[] = forma.escopo.map((linha) => ({
    tipo: linha.tipo,
    // `todos` e `assinante` exigem `alvo IS NULL` no banco. Mandar string vazia
    // levaria 23514 — o `CHECK` recusa `btrim(alvo) = ''` também.
    alvo: ESCOPOS_SEM_ALVO.includes(linha.tipo) ? null : linha.alvo.trim() || null,
    incluir: linha.incluir,
  }));

  const faixas: Faixa[] = usaFaixas(forma.mecanica)
    ? forma.faixas
        .filter((f) => f.quantidade_min.trim() !== "")
        .map((f) => ({
          quantidade_min: inteiroOuNulo(f.quantidade_min) ?? 0,
          desconto_tipo: f.desconto_tipo,
          desconto_valor: String(numeroOuNulo(f.desconto_valor) ?? 0),
        }))
        .sort((a, b) => a.quantidade_min - b.quantidade_min)
    : [];

  const codigos: CodigoDaRegra[] =
    forma.metodo === "codigo"
      ? forma.codigos
          .filter((c) => c.codigo.trim() !== "")
          .map((c) => ({
            // MAIÚSCULAS E `trim`, sempre: o `CHECK` do banco é
            // `^[A-Z0-9]{3,30}$`, e "cafe20" digitado em minúscula viraria 23514
            // em vez de virar CAFE20.
            codigo: c.codigo.trim().toUpperCase(),
            uso_unico: c.uso_unico,
            limite_usos: inteiroOuNulo(c.limite_usos),
            ativo: c.ativo,
          }))
      : [];

  return {
    nome: forma.nome.trim(),
    descricao: forma.descricao.trim() || null,
    metodo: forma.metodo,
    classe: forma.classe,
    mecanica: forma.mecanica,
    valor: usoDoValor.usa ? numeroOuNulo(forma.valor) : null,
    teto_desconto_centavos: centavosOuNulo(forma.teto_desconto_reais),
    minimo_tipo: forma.minimo_tipo,
    minimo_valor:
      forma.minimo_tipo === "nenhum"
        ? null
        : forma.minimo_tipo === "subtotal"
          ? centavosOuNulo(forma.minimo_valor)
          : inteiroOuNulo(forma.minimo_valor),
    prioridade: inteiroOuNulo(forma.prioridade) ?? 0,
    exclusiva: forma.exclusiva,
    grupo_exclusividade: forma.exclusiva
      ? forma.grupo_exclusividade.trim() || null
      : null,
    // Array vazio NÃO é lista vazia no banco: o `CHECK` exige
    // `cardinality > 0` quando a coluna não é nula. Vazio é "qualquer meio".
    meios_pagamento: forma.meios_pagamento.length ? [...forma.meios_pagamento] : null,
    limite_usos: inteiroOuNulo(forma.limite_usos),
    limite_por_cliente: inteiroOuNulo(forma.limite_por_cliente),
    orcamento_centavos: centavosOuNulo(forma.orcamento_reais),
    inicio_em: deCampoDeData(forma.inicio_em),
    fim_em: deCampoDeData(forma.fim_em),
    habilitada: forma.habilitada,
    escopo,
    faixas,
    frete:
      forma.classe === "frete"
        ? {
            teto_frete_centavos: centavosOuNulo(forma.frete.teto_frete_reais),
            ufs: forma.frete.ufs.length ? [...forma.frete.ufs] : null,
            apenas_modalidade_mais_barata: forma.frete.apenas_modalidade_mais_barata,
            cep_inicio: soDigitos(forma.frete.cep_inicio) || null,
            cep_fim: soDigitos(forma.frete.cep_fim) || null,
          }
        : null,
    codigos,
  };
}

/**
 * A regra do servidor → o formulário.
 *
 * NADA AQUI MUTA `regra`. É a linha que separa esta tela do defeito legado:
 * lá o load escrevia `p.active = false` no objeto vindo do servidor, e aquele
 * valor mutado chegava ao submit. Aqui o objeto é só lido; toda derivação vive
 * em `lista.logica.ts` e é recalculada a cada render.
 */
export function formularioDaRegra(regra: RegraCompleta): FormularioDeDesconto {
  return {
    nome: regra.nome ?? "",
    descricao: regra.descricao ?? "",
    metodo: regra.metodo,
    classe: regra.classe,
    mecanica: regra.mecanica,
    valor: regra.valor === null || regra.valor === undefined ? "" : String(regra.valor),
    teto_desconto_reais:
      regra.teto_desconto_centavos === null || regra.teto_desconto_centavos === undefined
        ? ""
        : String(centavosParaReais(regra.teto_desconto_centavos)),
    minimo_tipo: regra.minimo_tipo ?? "nenhum",
    minimo_valor:
      regra.minimo_valor === null || regra.minimo_valor === undefined
        ? ""
        : regra.minimo_tipo === "subtotal"
          ? String(centavosParaReais(regra.minimo_valor))
          : String(regra.minimo_valor),
    prioridade: String(regra.prioridade ?? 0),
    exclusiva: Boolean(regra.exclusiva),
    grupo_exclusividade: regra.grupo_exclusividade ?? "",
    meios_pagamento: regra.meios_pagamento ? [...regra.meios_pagamento] : [],
    limite_usos: regra.limite_usos === null || regra.limite_usos === undefined ? "" : String(regra.limite_usos),
    limite_por_cliente:
      regra.limite_por_cliente === null || regra.limite_por_cliente === undefined
        ? ""
        : String(regra.limite_por_cliente),
    orcamento_reais:
      regra.orcamento_centavos === null || regra.orcamento_centavos === undefined
        ? ""
        : String(centavosParaReais(regra.orcamento_centavos)),
    inicio_em: paraCampoDeData(regra.inicio_em),
    fim_em: paraCampoDeData(regra.fim_em),
    // O TOGGLE VEM DO SERVIDOR E SÓ DELE. Nenhuma leitura de relógio o toca:
    // é assim que editar a data de uma regra expirada deixa de desligá-la.
    habilitada: Boolean(regra.habilitada),
    escopo: (regra.escopo ?? []).map((e) => ({
      tipo: e.tipo,
      alvo: e.alvo ?? "",
      incluir: e.incluir !== false,
    })),
    faixas: (regra.faixas ?? []).map((f) => ({
      quantidade_min: String(f.quantidade_min),
      desconto_tipo: f.desconto_tipo,
      desconto_valor: String(f.desconto_valor),
    })),
    frete: regra.frete
      ? {
          teto_frete_reais:
            regra.frete.teto_frete_centavos === null ||
            regra.frete.teto_frete_centavos === undefined
              ? ""
              : String(centavosParaReais(regra.frete.teto_frete_centavos)),
          ufs: regra.frete.ufs ? [...regra.frete.ufs] : [],
          apenas_modalidade_mais_barata: Boolean(regra.frete.apenas_modalidade_mais_barata),
          cep_inicio: regra.frete.cep_inicio ?? "",
          cep_fim: regra.frete.cep_fim ?? "",
        }
      : { ...FRETE_VAZIO },
    codigos: (regra.codigos_detalhe ?? []).map((c) => ({
      codigo: c.codigo,
      uso_unico: Boolean(c.uso_unico),
      limite_usos: c.limite_usos === null || c.limite_usos === undefined ? "" : String(c.limite_usos),
      ativo: c.ativo !== false,
    })),
  };
}

/** Sujo é "o payload que sairia daqui é diferente do que entrou" — comparar o
 *  PAYLOAD e não o formulário evita que trocar `10` por `10,0` acuse alteração
 *  onde não há. */
export function estaSujo(
  base: FormularioDeDesconto,
  forma: FormularioDeDesconto,
): boolean {
  return JSON.stringify(montarPayload(base)) !== JSON.stringify(montarPayload(forma));
}
