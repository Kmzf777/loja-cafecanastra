import { montarUrl, textoDoParametro, type ChipDeFiltro } from "../filtros";
import { paginaValida } from "../paginacao";
import {
  CANAIS_DE_CONTATO,
  ESTADOS_DE_CONSENTIMENTO,
  rotuloDe,
} from "./vocabulario";

/**
 * A decisão da tela de Consentimentos — o livro-razão da autorização.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * CONSENTIMENTO É UM ESTADO COM PROCEDÊNCIA, NÃO UM BOOLEANO — e o modelo de
 * dados de 0033 leva isso a sério de um jeito que a tela precisa respeitar.
 *
 * `canastra.consentimentos` é APPEND-ONLY: o Express não tem PATCH nem DELETE,
 * e a ausência é a decisão, não uma lacuna. A tabela responde "com base em quê
 * vocês me mandaram esta mensagem em março?", e editar a linha antiga apagaria
 * a prova do que valia antes — que é justamente o que a prestação de contas da
 * LGPD exige guardar. Revogar é uma linha NOVA com `estado = 'revogado'`.
 *
 * A CONSEQUÊNCIA PARA A TELA: a lista é um HISTÓRICO, e o "estado de hoje" de
 * uma pessoa num canal NÃO está em nenhuma linha isolada — é a linha mais
 * recente daquele par (titular, canal). Quem monta um público de disparo lendo
 * `estado = 'concedido'` cru inclui gente que revogou depois. É por isso que
 * `estadoAtualPorTitular` existe, e é por isso que ela tem tanto teste.
 * ────────────────────────────────────────────────────────────────────────────
 */

export const ROTA_DE_CONSENTIMENTOS = "/dashboard/marketing/consentimentos";

export const POR_PAGINA = 20;

/** Como o Express devolve — `COLUNAS_DE_CONSENTIMENTO`, exatamente. */
export type Consentimento = {
  id: string;
  user_id: string | null;
  email: string | null;
  telefone: string | null;
  canal: string;
  estado: string;
  /** NOT NULL e não-vazio no banco (`consentimentos_origem_preenchida`): é a
   *  PROCEDÊNCIA, a metade do registro que a LGPD pede e que um booleano perde. */
  origem: string;
  texto_aceito: string | null;
  ip: string | null;
  criado_em: string;
};

export type RespostaDeConsentimentos = {
  data: Consentimento[];
  total: number;
  totalPages: number;
  page: number;
};

/**
 * O estado da lista — CANAL E ESTADO, e NENHUM E-MAIL.
 *
 * O R2 manda pôr filtro na URL e traz uma ressalva explícita: nunca CPF,
 * e-mail ou endereço na query string. Aqui a ressalva pesa mais que a regra —
 * uma URL de painel vai para o histórico do navegador, para o `Referer` de
 * qualquer recurso externo e para o print que alguém cola num grupo. Nesta
 * tela, especificamente, o e-mail na URL seria um dado pessoal exposto pela
 * própria ferramenta de conformidade.
 *
 * A consulta por titular existe (o backend aceita `?email=`), e ela mora numa
 * Server Action que recebe o e-mail no CORPO. O preço é que aquele resultado
 * não sobrevive ao F5 — e a tela diz isso em texto, em vez de silenciosamente
 * não ter a função.
 */
export type EstadoDosConsentimentos = {
  canal: string;
  estado: string;
  pagina: number;
};

export function lerEstado(
  parametros: Record<string, string | string[] | undefined>,
): EstadoDosConsentimentos {
  const canal = textoDoParametro(parametros.canal);
  const estado = textoDoParametro(parametros.estado);

  return {
    // Valor fora do vocabulário vira "sem filtro" em vez de 400: a rota recusa
    // com frase, e um link velho transformaria a tela numa tarja de erro.
    canal: CANAIS_DE_CONTATO.some((c) => c.valor === canal) ? canal : "",
    estado: ESTADOS_DE_CONSENTIMENTO.some((e) => e.valor === estado) ? estado : "",
    pagina: paginaValida(parametros.pagina, Number.MAX_SAFE_INTEGER),
  };
}

export function montarConsulta(estado: EstadoDosConsentimentos): string {
  return montarUrl("/admin/consentimentos", {
    canal: estado.canal || undefined,
    estado: estado.estado || undefined,
    page: estado.pagina,
    limit: POR_PAGINA,
  });
}

export function urlDaTela(estado: Partial<EstadoDosConsentimentos>): string {
  const pagina = estado.pagina ?? 1;
  return montarUrl(ROTA_DE_CONSENTIMENTOS, {
    canal: estado.canal || undefined,
    estado: estado.estado || undefined,
    pagina: pagina > 1 ? pagina : undefined,
  });
}

export function chipsDosConsentimentos(
  estado: EstadoDosConsentimentos,
): ChipDeFiltro[] {
  const chips: ChipDeFiltro[] = [];
  if (estado.canal) {
    chips.push({
      chave: "canal",
      dimensao: "Canal",
      valor: rotuloDe(CANAIS_DE_CONTATO, estado.canal),
      href: urlDaTela({ ...estado, canal: "", pagina: 1 }),
    });
  }
  if (estado.estado) {
    chips.push({
      chave: "estado",
      dimensao: "Estado",
      valor: rotuloDe(ESTADOS_DE_CONSENTIMENTO, estado.estado),
      href: urlDaTela({ ...estado, estado: "", pagina: 1 }),
    });
  }
  return chips;
}

export function temFiltro(estado: EstadoDosConsentimentos): boolean {
  return estado.canal !== "" || estado.estado !== "";
}

/* -------------------------------------------------------------------------- *
 * Quem é o titular de uma linha
 * -------------------------------------------------------------------------- */

/**
 * A CHAVE DO TITULAR — e ela é o que decide se o público de disparo está certo.
 *
 * O CHECK `consentimentos_identifica_alguem` exige pelo menos um de três:
 * `user_id`, `email` ou `telefone`. A ordem de preferência aqui é a da
 * ESTABILIDADE: `user_id` é imutável e é o mesmo titular em qualquer canal;
 * e-mail é estável na prática e vem normalizado em minúscula (o índice do banco
 * é sobre `lower(email)`); telefone é o último porque é o menos confiável desta
 * base — `clientes.telefone` é dado herdado da loja antiga, sem formato
 * conhecido, e duas grafias do mesmo número virariam dois titulares.
 *
 * O PREFIXO NO RETORNO NÃO É ENFEITE. Sem ele, um `user_id` que por acaso
 * fosse igual a um telefone colidiria; mais importante, ele deixa legível, em
 * qualquer depuração, POR QUAL identidade a linha foi agrupada.
 */
export function chaveDoTitular(linha: Consentimento): string {
  if (linha.user_id) return `id:${linha.user_id}`;
  const email = (linha.email ?? "").trim().toLowerCase();
  if (email) return `email:${email}`;
  const telefone = (linha.telefone ?? "").replace(/\D/g, "");
  if (telefone) return `tel:${telefone}`;
  // O CHECK do banco impede isto; a linha existe para a função ser total e para
  // uma linha corrompida não virar um titular "undefined" agrupando tudo.
  return `sem-identificacao:${linha.id}`;
}

/** O que a primeira coluna mostra (R23: identificador HUMANO, nunca UUID). */
export function identificarTitular(linha: Consentimento): string {
  const email = (linha.email ?? "").trim();
  if (email) return email;
  const telefone = (linha.telefone ?? "").trim();
  if (telefone) return telefone;
  if (linha.user_id) return "Titular com conta (sem contato na linha)";
  return "Sem identificação";
}

/* -------------------------------------------------------------------------- *
 * O ESTADO DE HOJE — a redução do histórico
 * -------------------------------------------------------------------------- */

export type EstadoAtual = {
  chave: string;
  canal: string;
  /** `"concedido"` ou `"revogado"` — o da linha MAIS RECENTE do par. */
  estado: string;
  /** A linha que decidiu. É ela que a tela mostra ao explicar a exclusão: a
   *  data e a origem são a resposta a "por que esta pessoa ficou de fora?". */
  decisiva: Consentimento;
};

/**
 * O estado de HOJE de cada par (titular, canal), reduzido do histórico.
 *
 * ESTA É A FUNÇÃO QUE IMPEDE O DEFEITO CARO DESTA ÁREA: filtrar
 * `estado = 'concedido'` direto da lista inclui quem concedeu em janeiro e
 * revogou em março — as duas linhas existem, as duas são verdadeiras, e só a
 * segunda vale. Um disparo montado com o filtro cru manda mensagem para quem
 * pediu para parar de receber, que é exatamente o que a LGPD trata como
 * violação e o que esta tabela existe para tornar impossível.
 *
 * O DESEMPATE É POR `criado_em`, E O EMPATE É PELO ÚLTIMO DA ENTRADA. Duas
 * linhas no mesmo instante são improváveis mas possíveis (o `now()` de uma
 * transação é constante), e nesse caso vale a que veio depois na resposta — que
 * o Express ordena por `criado_em DESC`, então "depois na entrada" é a mais
 * antiga entre as empatadas. A escolha é ARBITRÁRIA e está escrita para que
 * ninguém a leia como intenção: o que não é arbitrário é ela ser DETERMINÍSTICA,
 * porque um público que muda de tamanho entre dois cliques sem nada ter mudado
 * no banco destrói a confiança na tela inteira.
 *
 * A entrada NÃO precisa vir ordenada, e o teste prova isso: depender da ordem
 * da resposta é depender de um `ORDER BY` que vive noutro repositório.
 */
export function estadoAtualPorTitular(
  linhas: Consentimento[],
): Map<string, EstadoAtual> {
  const porPar = new Map<string, EstadoAtual>();

  for (const linha of linhas) {
    const chave = chaveDoTitular(linha);
    const par = `${chave}|${linha.canal}`;
    const atual = porPar.get(par);

    if (atual === undefined || maisRecente(linha, atual.decisiva)) {
      porPar.set(par, {
        chave,
        canal: linha.canal,
        estado: linha.estado,
        decisiva: linha,
      });
    }
  }

  return porPar;
}

function maisRecente(candidata: Consentimento, atual: Consentimento): boolean {
  const a = Date.parse(candidata.criado_em);
  const b = Date.parse(atual.criado_em);
  // Data ilegível NUNCA desbanca uma legível: uma linha com `criado_em`
  // corrompido não pode virar a palavra final sobre um consentimento.
  if (Number.isNaN(a)) return false;
  if (Number.isNaN(b)) return true;
  return a >= b;
}

/**
 * Quem, HOJE, consente naquele canal.
 *
 * Devolve só o estado atual `concedido` — e devolve o objeto inteiro, e não só
 * a chave, porque quem monta o público precisa da LINHA (o telefone, a origem,
 * a data) para dizer o que fez e com base em quê.
 */
export function quemConsenteHoje(
  linhas: Consentimento[],
  canal: string,
): EstadoAtual[] {
  return [...estadoAtualPorTitular(linhas).values()]
    .filter((atual) => atual.canal === canal)
    .filter((atual) => atual.estado === "concedido");
}

/* -------------------------------------------------------------------------- *
 * O registro de um consentimento novo
 * -------------------------------------------------------------------------- */

export type FormularioDeConsentimento = {
  canal: string;
  estado: string;
  origem: string;
  email: string;
  telefone: string;
};

export function formularioDeConsentimentoVazio(): FormularioDeConsentimento {
  return { canal: "", estado: "concedido", origem: "", email: "", telefone: "" };
}

/** As frases do backend, copiadas — e travadas por teste, como em campanhas. */
export const FRASE_SEM_ORIGEM =
  "Informe a origem do consentimento (de onde ele veio).";
export const FRASE_SEM_TITULAR =
  "Um consentimento precisa identificar o titular: informe user_id, e-mail ou telefone.";

export type ErrosDoConsentimento = Partial<
  Record<"canal" | "estado" | "origem" | "email", string>
>;

export function validarConsentimento(
  form: FormularioDeConsentimento,
): ErrosDoConsentimento {
  const erros: ErrosDoConsentimento = {};

  if (!CANAIS_DE_CONTATO.some((c) => c.valor === form.canal)) {
    erros.canal = "Escolha o canal a que este consentimento se refere.";
  }
  if (!ESTADOS_DE_CONSENTIMENTO.some((e) => e.valor === form.estado)) {
    erros.estado = "Escolha se o consentimento foi concedido ou revogado.";
  }
  if (form.origem.trim() === "") erros.origem = FRASE_SEM_ORIGEM;

  if (form.email.trim() === "" && form.telefone.trim() === "") {
    // A frase do servidor cita `user_id`, que esta tela não oferece: quem
    // registra à mão tem o e-mail ou o telefone na frente, não o UUID.
    erros.email = "Informe o e-mail ou o telefone de quem consentiu.";
  }

  return erros;
}

export type PayloadDeConsentimento = {
  canal: string;
  estado: string;
  origem: string;
  email: string | null;
  telefone: string | null;
};

/**
 * O corpo do `POST /admin/consentimentos`.
 *
 * O E-MAIL VAI EM MINÚSCULA porque o índice do banco é sobre `lower(email)` e o
 * filtro do repositório compara `lower()` dos dois lados: gravar "Ana@Ex.com"
 * faria a consulta por "ana@ex.com" achar a linha (o filtro normaliza), mas
 * `chaveDoTitular` aqui na tela agruparia as duas grafias no mesmo titular
 * enquanto o banco guardaria duas caixas diferentes. Normalizar na entrada é o
 * que mantém as duas visões iguais.
 *
 * O TELEFONE VAI COMO FOI DIGITADO, e não normalizado — de propósito. Esta
 * tabela é PROVA: o que se guarda é o que a pessoa forneceu. A normalização
 * para disparo acontece em `publico.logica.ts`, onde ela é declarada, contada e
 * mostrada — e onde um número que ela não entende vira uma exclusão explicada,
 * em vez de um dígito adivinhado gravado para sempre.
 */
export function montarPayloadDeConsentimento(
  form: FormularioDeConsentimento,
): PayloadDeConsentimento {
  return {
    canal: form.canal,
    estado: form.estado,
    origem: form.origem.trim(),
    email: form.email.trim().toLowerCase() || null,
    telefone: form.telefone.trim() || null,
  };
}
