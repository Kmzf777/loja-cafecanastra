/**
 * Os 9 status de pedido — VALOR separado de RÓTULO.
 *
 * O `valor` é o que trafega para o backend e é gravado no banco; o `rotulo` é o
 * que o gestor lê. Confundir os dois é o defeito que estava esperando para
 * acontecer: traduzir os VALORES em vez dos rótulos faz o backend responder 400
 * em toda mudança de status, e o CHECK de 0009 recusar no banco.
 *
 * A lista vive aqui e é comparada com `backend/src/utils/statusDePedido.js`
 * por `status.test.ts`, lendo o arquivo do disco. Não copie esta lista para
 * dentro de componente nenhum — foi assim que ela virou três cópias.
 */
export type TomDeStatus = "sucesso" | "alerta" | "erro" | "neutro";

export const STATUS_DE_PEDIDO = [
  { valor: "pendente", rotulo: "Pendente", tom: "alerta" },
  { valor: "aprovado", rotulo: "Aprovado", tom: "sucesso" },
  { valor: "em_processamento", rotulo: "Em processamento", tom: "neutro" },
  { valor: "autorizado", rotulo: "Autorizado", tom: "neutro" },
  { valor: "enviado", rotulo: "Enviado", tom: "neutro" },
  { valor: "entregue", rotulo: "Entregue", tom: "sucesso" },
  { valor: "cancelado", rotulo: "Cancelado", tom: "erro" },
  { valor: "rejeitado", rotulo: "Rejeitado", tom: "erro" },
  { valor: "reembolsado", rotulo: "Reembolsado", tom: "erro" },
] as const satisfies ReadonlyArray<{
  valor: string;
  rotulo: string;
  tom: TomDeStatus;
}>;

export type StatusDePedido = (typeof STATUS_DE_PEDIDO)[number]["valor"];

/** Valor desconhecido devolve a si mesmo. Esconder atrás de "Outro" faria um
 *  status novo do backend sumir da tela sem ninguém notar. */
export function rotuloDoStatus(valor: string): string {
  return STATUS_DE_PEDIDO.find((s) => s.valor === valor)?.rotulo ?? valor;
}

export function tomDoStatus(valor: string): TomDeStatus {
  return STATUS_DE_PEDIDO.find((s) => s.valor === valor)?.tom ?? "neutro";
}
