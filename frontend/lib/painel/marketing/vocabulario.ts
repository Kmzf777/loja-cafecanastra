/**
 * Os quatro vocabulários fechados da migração 0033 — VALOR separado de RÓTULO.
 *
 * A mesma disciplina de `status.ts`, pelo mesmo motivo e com a mesma trava: o
 * `valor` é o que trafega para o Express e é gravado no banco; o `rotulo` é o
 * que o gestor lê. `vocabulario.test.ts` compara estas listas com
 * `backend/src/repositories/marketingRepository.js`, lido do disco — porque a
 * divergência não aparece no `next build` nem no `tsc`: ela aparece como um 400
 * ("Canal inválido. Use um de: …") na cara de quem estava salvando.
 *
 * Traduzir os VALORES em vez dos rótulos é o defeito que os 9 status já
 * custaram a esta casa uma vez. Aqui ele custaria quatro vezes.
 *
 * NÃO COPIE NENHUMA DESTAS LISTAS PARA DENTRO DE COMPONENTE. Foi assim que a
 * lista de status virou três cópias no painel legado.
 */

import type { TomDeStatus } from "@/lib/painel/status";

type Termo = { valor: string; rotulo: string };

/**
 * O canal da CAMPANHA — oito valores, `campanhas_canal_valido` (0033).
 *
 * A ordem é a do CHECK, e não a alfabética: é a ordem que o teste compara, e
 * reordenar aqui faria o teste falhar por uma diferença que não é um defeito.
 * Se um dia o backend reordenar, a falha aponta para o lugar certo.
 */
export const CANAIS_DE_CAMPANHA = [
  { valor: "google", rotulo: "Google" },
  { valor: "meta", rotulo: "Meta (Instagram/Facebook)" },
  { valor: "email", rotulo: "E-mail" },
  { valor: "whatsapp", rotulo: "WhatsApp" },
  { valor: "sms", rotulo: "SMS" },
  { valor: "organico", rotulo: "Orgânico" },
  { valor: "influenciador", rotulo: "Influenciador" },
  { valor: "outro", rotulo: "Outro" },
] as const satisfies ReadonlyArray<Termo>;

export type CanalDeCampanha = (typeof CANAIS_DE_CAMPANHA)[number]["valor"];

/** O canal de CONTATO — três valores, e vale para `consentimentos` e `envios`
 *  (os dois CHECKs de 0033 têm exatamente a mesma lista). */
export const CANAIS_DE_CONTATO = [
  { valor: "email", rotulo: "E-mail" },
  { valor: "whatsapp", rotulo: "WhatsApp" },
  { valor: "sms", rotulo: "SMS" },
] as const satisfies ReadonlyArray<Termo>;

export type CanalDeContato = (typeof CANAIS_DE_CONTATO)[number]["valor"];

/**
 * O estado do CONSENTIMENTO — e ele é dois valores, não um booleano.
 *
 * `consentimentos` guarda canal, estado, ORIGEM e DATA porque a LGPD trata
 * consentimento como estado com procedência: a pergunta que a tabela responde é
 * "com base em quê vocês me mandaram esta mensagem em março?". Um booleano
 * `aceita_marketing` na linha do cliente responderia "hoje ele aceita" — que é
 * outra pergunta.
 *
 * Por isso o backend NÃO TEM PATCH nem DELETE de consentimento: revogar é uma
 * linha NOVA com `estado = 'revogado'`. A tela obedece a isso — ver
 * `consentimentos.logica.ts`.
 */
export const ESTADOS_DE_CONSENTIMENTO = [
  { valor: "concedido", rotulo: "Concedido", tom: "sucesso" },
  { valor: "revogado", rotulo: "Revogado", tom: "erro" },
] as const satisfies ReadonlyArray<Termo & { tom: TomDeStatus }>;

export type EstadoDeConsentimento =
  (typeof ESTADOS_DE_CONSENTIMENTO)[number]["valor"];

/**
 * O estado do ENVIO — cinco valores, na ordem da VIDA da mensagem.
 *
 * pendente → enviado → entregue → lido, e `falhou` fora da linha. A ordem é a
 * do CHECK e é a que a tela usa para ordenar o filtro: um seletor em ordem
 * alfabética ("entregue, enviado, falhou, lido, pendente") esconde que os
 * quatro primeiros são etapas de uma coisa só.
 *
 * `falhou` é o único que autoriza `erro_texto` — `envios_erro_so_em_falha`
 * (0033) impede a contradição de existir no banco, e a tela mostra o texto
 * exatamente onde ele explica alguma coisa.
 */
export const ESTADOS_DE_ENVIO = [
  { valor: "pendente", rotulo: "Pendente", tom: "alerta" },
  { valor: "enviado", rotulo: "Enviado", tom: "neutro" },
  { valor: "entregue", rotulo: "Entregue", tom: "sucesso" },
  { valor: "lido", rotulo: "Lido", tom: "sucesso" },
  { valor: "falhou", rotulo: "Falhou", tom: "erro" },
] as const satisfies ReadonlyArray<Termo & { tom: TomDeStatus }>;

export type EstadoDeEnvio = (typeof ESTADOS_DE_ENVIO)[number]["valor"];

/**
 * Os oito gatilhos de `automacoes` — `automacoes_gatilho_valido` (0033).
 *
 * ELES ESTÃO AQUI SEM QUE EXISTA TELA DE AUTOMAÇÃO, e isso é deliberado: a tela
 * de Marketing LISTA os oito para dizer o que o banco já aceita e o que ainda
 * não tem rota (não há CRUD de `automacoes` no Express — ver o relatório da
 * onda). Uma lista de gatilhos escrita à mão dentro do JSX divergiria do CHECK
 * no primeiro gatilho novo, e ninguém compararia.
 *
 * A lista é comparada com a MIGRAÇÃO, e não com um repositório — é o único
 * lugar onde ela existe hoje do lado do servidor.
 */
export const GATILHOS_DE_AUTOMACAO = [
  { valor: "carrinho_abandonado", rotulo: "Carrinho abandonado" },
  { valor: "pedido_aprovado", rotulo: "Pedido aprovado" },
  { valor: "pedido_enviado", rotulo: "Pedido enviado" },
  { valor: "pedido_entregue", rotulo: "Pedido entregue" },
  { valor: "cliente_novo", rotulo: "Cliente novo" },
  { valor: "newsletter_confirmada", rotulo: "Newsletter confirmada" },
  { valor: "assinatura_criada", rotulo: "Assinatura criada" },
  { valor: "assinatura_cancelada", rotulo: "Assinatura cancelada" },
] as const satisfies ReadonlyArray<Termo>;

/**
 * O tradutor genérico. Valor desconhecido devolve a si mesmo, como
 * `rotuloDoStatus` — esconder atrás de "Outro" faria um valor novo do backend
 * sumir da tela sem ninguém notar, que é o oposto do que estas listas existem
 * para garantir.
 */
export function rotuloDe(
  lista: ReadonlyArray<Termo>,
  valor: string | null | undefined,
): string {
  if (!valor) return "—";
  return lista.find((t) => t.valor === valor)?.rotulo ?? valor;
}

export function tomDe(
  lista: ReadonlyArray<Termo & { tom: TomDeStatus }>,
  valor: string | null | undefined,
): TomDeStatus {
  if (!valor) return "neutro";
  return lista.find((t) => t.valor === valor)?.tom ?? "neutro";
}
