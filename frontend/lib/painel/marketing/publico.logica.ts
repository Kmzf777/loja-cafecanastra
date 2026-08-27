import { formatarDataHora } from "../data";
import {
  estadoAtualPorTitular,
  type Consentimento,
  type EstadoAtual,
} from "./consentimentos.logica";

/**
 * A montagem do público de WhatsApp — e a razão de ela ser um módulo puro com
 * teste exaustivo, e não trinta linhas dentro de um componente.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * O DISPARADOR NÃO PERGUNTA NADA. `POST https://webhook.canastrainteligencia.com
 * /webhook/disparador` recebe `{ mensagem, numeros }` e manda. Ele não tem
 * autenticação, não confere consentimento, não deduplica e não valida número.
 * TUDO o que decide quem recebe a mensagem acontece AQUI — e é por isso que
 * aqui é o único lugar do painel onde um defeito lógico vira, direto, uma
 * mensagem enviada a quem pediu para não receber.
 *
 * A REGRA CENTRAL: NINGUÉM ENTRA NO PÚBLICO SEM CONSENTIMENTO REGISTRADO E
 * VIGENTE. "Vigente" é a palavra que carrega o trabalho — `consentimentos` é
 * append-only, e a linha `concedido` de janeiro convive com a `revogado` de
 * março. Quem lê `estado = 'concedido'` do filtro do backend monta um público
 * que inclui quem revogou. Por isso a entrada desta função é o HISTÓRICO
 * inteiro e a primeira coisa que ela faz é reduzi-lo (`quemConsenteHoje`).
 *
 * E A SEGUNDA REGRA: TODA EXCLUSÃO É CONTADA E EXPLICADA. Um público que sai
 * de 400 consentimentos e vira 180 números sem dizer o que houve com os outros
 * 220 é indistinguível de um público quebrado. A tela mostra a conta.
 * ────────────────────────────────────────────────────────────────────────────
 */

export const ROTA_DE_WHATSAPP = "/dashboard/marketing/whatsapp";

/**
 * O endereço do disparador, escrito por extenso e num lugar só.
 *
 * ELE MORA FORA DESTE REPOSITÓRIO: a API do WhatsApp vive numa automação
 * (`Sites/Disparador` fala com este mesmo webhook), não em código daqui. O
 * painel monta o público e entrega — e as duas ressalvas abaixo são o que a
 * tela precisa dizer em texto, porque nenhuma delas tem conserto nesta onda.
 */
export const URL_DO_DISPARADOR =
  "https://webhook.canastrainteligencia.com/webhook/disparador";

export const RESSALVAS_DO_DISPARADOR = [
  "O webhook não tem autenticação: quem souber a URL dispara em nome da loja. Ela não é segredo — está no código do painel e no do disparador.",
  "A mensagem vai como texto livre, o que indica uma API não-oficial do WhatsApp. Volume alto e conteúdo promocional aumentam o risco de bloqueio do número.",
] as const;

/** O motivo de alguém ter ficado de fora. Cada um é uma linha da conta que a
 *  tela mostra — e cada um tem uma frase própria, porque "inválido" não diz o
 *  que fazer e "sem telefone" diz. */
export type MotivoDeExclusao =
  | "consentimento_revogado"
  | "sem_telefone"
  | "telefone_irreconhecivel"
  | "numero_repetido";

export const FRASE_DO_MOTIVO: Record<MotivoDeExclusao, string> = {
  consentimento_revogado:
    "Revogou o consentimento de WhatsApp. A linha mais recente do histórico diz «revogado», e é ela que vale.",
  sem_telefone:
    "Consentiu, mas a linha do consentimento não trouxe telefone — não há para onde mandar.",
  telefone_irreconhecivel:
    "O telefone gravado não tem a forma de um número brasileiro (10 ou 11 dígitos, com DDD). Corrija o cadastro antes de incluir.",
  numero_repetido:
    "O mesmo número já entrou no público por outro registro de consentimento. Entra uma vez só.",
};

export type Excluido = {
  motivo: MotivoDeExclusao;
  /** Como identificar a pessoa na tela, sem UUID. */
  identificacao: string;
  /** Quando e de onde veio a decisão que a excluiu — a procedência que a LGPD
   *  pede, e a resposta a "por que fulano não recebeu?". */
  detalhe: string;
};

export type Incluido = {
  /** O número já pronto para o disparador: só dígitos, com o 55 na frente. */
  numero: string;
  identificacao: string;
  origem: string;
};

export type Publico = {
  incluidos: Incluido[];
  excluidos: Excluido[];
  /** `incluidos.length`, repetido por conveniência de quem desenha o resumo. */
  total: number;
};

/* -------------------------------------------------------------------------- *
 * O número
 * -------------------------------------------------------------------------- */

/**
 * Telefone gravado → número que o WhatsApp entende. `null` quando não dá.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * O QUE ELA ACEITA, E POR QUE A LISTA É CURTA:
 *
 *   11 dígitos ..... celular com DDD (35 9 9999 8888) → ganha o 55
 *   10 dígitos ..... fixo com DDD, ou celular antigo sem o nono → ganha o 55
 *   12 ou 13 ....... já tem o 55 na frente → fica como está
 *
 * QUALQUER OUTRA COISA É RECUSADA, e a recusa é o ponto: `clientes.telefone`
 * desta loja é dado herdado, sem formato conhecido e sem caminho de escrita no
 * backend atual — a tela de Clientes já registra isso por escrito. Adivinhar o
 * DDD de um número de 9 dígitos, ou cortar o excesso de um de 15, produziria um
 * número VÁLIDO que pertence a OUTRA PESSOA. Num disparo, isso é mandar a
 * promoção da loja para um desconhecido; e o erro é invisível, porque o
 * disparador aceita qualquer coisa e não devolve quem não existe.
 *
 * NÃO SE CORRIGE O NONO DÍGITO. Um fixo de 10 dígitos não vira celular por
 * ganhar um 9, e um celular antigo de 10 dígitos que precisaria dele é
 * indistinguível de um fixo aqui — a diferença mora numa faixa de prefixo que
 * muda por região e por ano. Deixar passar como está é o que o disparador
 * resolve ou recusa lá na ponta, com informação que este painel não tem.
 * ────────────────────────────────────────────────────────────────────────────
 */
export function numeroParaDisparo(bruto: string | null | undefined): string | null {
  const digitos = (bruto ?? "").replace(/\D/g, "");
  if (digitos === "") return null;

  if (digitos.length === 10 || digitos.length === 11) return `55${digitos}`;
  if ((digitos.length === 12 || digitos.length === 13) && digitos.startsWith("55")) {
    return digitos;
  }
  return null;
}

/* -------------------------------------------------------------------------- *
 * O público
 * -------------------------------------------------------------------------- */

/**
 * Monta o público a partir do HISTÓRICO INTEIRO de consentimentos.
 *
 * A ENTRADA É O HISTÓRICO, E NÃO UMA LISTA JÁ FILTRADA — a assinatura é assim
 * de propósito. Se ela recebesse "os concedidos", a decisão mais importante
 * (qual linha vale hoje) teria migrado para quem chama, isto é, para um
 * componente, onde ela não tem teste. Aqui ela é a primeira linha da função.
 *
 * A ORDEM DE SAÍDA É A DA ENTRADA, estável: o público não pode mudar de ordem
 * entre dois cliques, senão a conferência antes de disparar não serve para
 * nada.
 */
export function montarPublico(historico: Consentimento[]): Publico {
  const incluidos: Incluido[] = [];
  const excluidos: Excluido[] = [];
  const numerosJaVistos = new Set<string>();

  /*
    OS REVOGADOS ENTRAM NA CONTA, e não são simplesmente ignorados. É a
    diferença entre "o público tem 180" e "o público tem 180; 12 revogaram".
    A segunda frase é a que responde ao gestor que jurava ter 192 contatos — e
    é a que prova, num pedido de titular, que a revogação foi respeitada.

    A varredura é sobre o estado ATUAL de cada par, e não sobre as linhas: uma
    pessoa que concedeu, revogou e concedeu de novo aparece UMA vez, incluída.
  */
  for (const atual of estadoAtualDeWhatsapp(historico)) {
    if (atual.estado !== "concedido") {
      excluidos.push({
        motivo: "consentimento_revogado",
        identificacao: identificar(atual),
        detalhe: `Revogado em ${formatarDataHora(atual.decisiva.criado_em)} · origem: ${atual.decisiva.origem}`,
      });
      continue;
    }

    const numero = numeroParaDisparo(atual.decisiva.telefone);

    if (numero === null) {
      const temAlgumDigito = /\d/.test(atual.decisiva.telefone ?? "");
      excluidos.push({
        motivo: temAlgumDigito ? "telefone_irreconhecivel" : "sem_telefone",
        identificacao: identificar(atual),
        detalhe: temAlgumDigito
          ? `Gravado como «${atual.decisiva.telefone}»`
          : `Consentimento de ${formatarDataHora(atual.decisiva.criado_em)} · origem: ${atual.decisiva.origem}`,
      });
      continue;
    }

    if (numerosJaVistos.has(numero)) {
      excluidos.push({
        motivo: "numero_repetido",
        identificacao: identificar(atual),
        detalhe: `O número ${numero} já entrou no público`,
      });
      continue;
    }

    numerosJaVistos.add(numero);
    incluidos.push({
      numero,
      identificacao: identificar(atual),
      origem: atual.decisiva.origem,
    });
  }

  return { incluidos, excluidos, total: incluidos.length };
}

/**
 * Os pares do canal `whatsapp` no estado de hoje — CONCEDIDOS E REVOGADOS.
 *
 * Usa `estadoAtualPorTitular` e não `quemConsenteHoje` porque este módulo
 * precisa dos dois lados: os concedidos viram o público, e os revogados viram a
 * linha "12 revogaram" da conta das exclusões. `quemConsenteHoje` descarta os
 * revogados por contrato, e com ela a tela não teria como provar, num pedido de
 * titular, que a revogação foi respeitada.
 *
 * O FILTRO POR CANAL VEM ANTES DA REDUÇÃO, e a ordem importa: reduzir primeiro
 * e filtrar depois daria o mesmo resultado só porque a chave do Map já inclui o
 * canal — uma coincidência de implementação daquela função, não uma garantia
 * desta. Filtrar antes torna esta função correta por si.
 */
function estadoAtualDeWhatsapp(historico: Consentimento[]): EstadoAtual[] {
  const soWhatsapp = historico.filter((linha) => linha.canal === "whatsapp");
  return [...estadoAtualPorTitular(soWhatsapp).values()];
}

function identificar(atual: EstadoAtual): string {
  const linha = atual.decisiva;
  const email = (linha.email ?? "").trim();
  if (email) return email;
  const telefone = (linha.telefone ?? "").trim();
  if (telefone) return telefone;
  return "Titular com conta (sem contato na linha)";
}

/**
 * A conta das exclusões, agrupada por motivo — é isto que a tela mostra.
 *
 * A ordem é a de `FRASE_DO_MOTIVO`, que é a da gravidade: o consentimento
 * revogado primeiro, porque é o único que NÃO é um problema a consertar — é a
 * regra funcionando. Os outros três são cadastro para arrumar.
 */
export function contarExclusoes(
  excluidos: Excluido[],
): { motivo: MotivoDeExclusao; frase: string; quantidade: number }[] {
  return (Object.keys(FRASE_DO_MOTIVO) as MotivoDeExclusao[])
    .map((motivo) => ({
      motivo,
      frase: FRASE_DO_MOTIVO[motivo],
      quantidade: excluidos.filter((e) => e.motivo === motivo).length,
    }))
    .filter((linha) => linha.quantidade > 0);
}

/* -------------------------------------------------------------------------- *
 * A mensagem e o corpo do disparo
 * -------------------------------------------------------------------------- */

export const LIMITE_DA_MENSAGEM = 900;

export type ErrosDoDisparo = Partial<Record<"mensagem" | "publico", string>>;

/**
 * O que impede o disparo de sair.
 *
 * O PÚBLICO VAZIO É UM ERRO, e não um disparo de zero mensagens: `{ numeros:
 * [] }` seria aceito pelo webhook sem reclamar, a tela diria "enviado" e o
 * gestor concluiria que o WhatsApp não funciona. R14 vale aqui — o pior estado
 * não é lento, é "não sei se aconteceu".
 *
 * O LIMITE DE CARACTERES É DESTA TELA, não do webhook — ele aceita qualquer
 * tamanho. 900 é folgado para uma mensagem promocional e curto o bastante para
 * não virar um texto que ninguém lê num celular; e um teto explícito é o que
 * impede um "colei o texto errado" de virar mil disparos de um documento
 * inteiro. Está escrito aqui porque um número mágico dentro do JSX seria
 * confundido com um limite do WhatsApp.
 */
export function validarDisparo(
  mensagem: string,
  publico: Publico,
): ErrosDoDisparo {
  const erros: ErrosDoDisparo = {};

  const texto = mensagem.trim();
  if (texto === "") {
    erros.mensagem = "Escreva a mensagem antes de disparar.";
  } else if (texto.length > LIMITE_DA_MENSAGEM) {
    erros.mensagem = `A mensagem tem ${texto.length} caracteres; o limite desta tela é ${LIMITE_DA_MENSAGEM}.`;
  }

  if (publico.total === 0) {
    erros.publico =
      "Nenhum número no público. Sem consentimento de WhatsApp registrado e vigente, não há para quem disparar.";
  }

  return erros;
}

export type PayloadDoDisparo = { mensagem: string; numeros: string[] };

/** O corpo que o webhook lê — exatamente as duas chaves, e nada mais. */
export function montarPayloadDoDisparo(
  mensagem: string,
  publico: Publico,
): PayloadDoDisparo {
  return {
    mensagem: mensagem.trim(),
    numeros: publico.incluidos.map((i) => i.numero),
  };
}
