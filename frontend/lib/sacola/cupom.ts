/**
 * Cupom de desconto — validação pelo servidor, exibição pelo navegador.
 *
 * O contrato é a decisão 6 do plano mestre: `POST /cupons/validar` é público,
 * recebe `{ codigo, itens: [{ productId, quantity }] }` e responde 200 com
 * `{ valido: true, codigo, tipo, valor, descontoCentavos, descricao }` ou
 * `{ valido: false, motivo }`.
 *
 * O DESCONTO DAQUI É SÓ PARA MOSTRAR. O checkout manda o CÓDIGO (campo
 * `cupom` do process_payment) e o servidor revalida — o desconto do navegador
 * nunca é aceito. Por isso o parsing é defensivo com honestidade: um
 * `descontoCentavos` quebrado vira "inválido" na tela em vez de virar um
 * resumo que promete um total que o servidor vai recusar.
 *
 * Módulo puro, fetch injetável, sem exceção subindo: TODA falha (rede, rota
 * ainda não publicada, resposta estranha) vira `{ valido: false, motivo }` —
 * cupom é acessório do checkout e não pode travá-lo.
 */

import { API_BASE } from "../api-base";

export type CupomAplicado = {
  codigo: string;
  /** Inteiro ≥ 0 — dinheiro não viaja quebrado (mesma regra do catálogo). */
  descontoCentavos: number;
  descricao?: string;
};

export type ResultadoCupom =
  | { valido: true; cupom: CupomAplicado }
  | { valido: false; motivo: string };

const MOTIVO_PADRAO = "Não foi possível validar o cupom agora. Tente de novo.";

/** Resposta do servidor → resultado que a tela consome. Defensivo — ver topo. */
export function interpretarRespostaCupom(json: unknown): ResultadoCupom {
  if (typeof json !== "object" || json === null) {
    return { valido: false, motivo: MOTIVO_PADRAO };
  }
  const d = json as Record<string, unknown>;

  if (d.valido !== true) {
    const motivo =
      typeof d.motivo === "string" && d.motivo.trim()
        ? d.motivo
        : "Este cupom não é válido.";
    return { valido: false, motivo };
  }

  const codigo = typeof d.codigo === "string" ? d.codigo.trim() : "";
  const desconto = d.descontoCentavos;
  if (!codigo || typeof desconto !== "number" || !Number.isInteger(desconto) || desconto < 0) {
    return { valido: false, motivo: MOTIVO_PADRAO };
  }

  return {
    valido: true,
    cupom: {
      codigo,
      descontoCentavos: desconto,
      descricao: typeof d.descricao === "string" ? d.descricao : undefined,
    },
  };
}

export async function validarCupom(
  codigo: string,
  itens: { product_id: string; quantity: number }[],
  fetchFn: typeof fetch = fetch,
): Promise<ResultadoCupom> {
  // Maiúsculas na borda: o campo aceita "serra10" e o servidor guarda SERRA10.
  const limpo = codigo.trim().toUpperCase();
  if (!limpo) return { valido: false, motivo: "Digite o código do cupom." };

  try {
    const r = await fetchFn(`${API_BASE}/cupons/validar`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        codigo: limpo,
        itens: itens.map((i) => ({
          productId: i.product_id,
          quantity: Number(i.quantity),
        })),
      }),
    });
    if (!r.ok) return { valido: false, motivo: MOTIVO_PADRAO };
    return interpretarRespostaCupom(await r.json());
  } catch {
    return { valido: false, motivo: MOTIVO_PADRAO };
  }
}
