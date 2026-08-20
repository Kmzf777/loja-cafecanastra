"use strict";

/**
 * A regra do cupom, PURA — sem banco, sem rede, sem relogio proprio.
 *
 * E uma funcao so porque ela roda em DOIS lugares que nao podem discordar: no
 * `POST /cupons/validar` (o navegador perguntando "vale?") e DENTRO do
 * `process_payment` (a revalidacao que decide dinheiro). Se a regra vivesse
 * duplicada, um cupom "valido" na tela poderia ser recusado no pagamento — ou
 * pior, o contrario.
 *
 * Tudo em CENTAVOS e inteiro, como o frete gratis (0009) e o `minimo_centavos`
 * (0010): a fronteira do "vale/nao vale" e exatamente onde float erra.
 *
 * Os MOTIVOS sao contrato fixado no plano mestre — o texto vai direto para a
 * tela do checkout, entao mudanca aqui e mudanca de interface:
 *   "Cupom não encontrado" | "Cupom expirado" | "Cupom esgotado" |
 *   "Pedido mínimo de R$ X" | "Cupom inativo"
 */

/**
 * "  cafe10 " -> "CAFE10". O cliente digita como quiser; o banco so conhece
 * maiusculo (CHECK de 0010). Uma funcao so para os QUATRO lugares que recebem
 * codigo de fora (validar, CRUD, checkout, cotacao de frete) nunca divergirem
 * — duas normalizacoes diferentes fariam o mesmo codigo valer numa rota e
 * nao valer na outra.
 */
function normalizarCodigo(codigo) {
  return String(codigo || "").trim().toUpperCase();
}

/** 4999 -> "49,99"; 15000 -> "150,00". Sem Intl para o teste nao depender de ICU. */
function reaisPorExtenso(centavos) {
  const reais = Math.trunc(centavos / 100);
  const resto = String(centavos % 100).padStart(2, "0");
  // Ponto de milhar deliberadamente ausente: "R$ 1500,00" e legivel e estavel;
  // o Intl.NumberFormat produziria "1.500,00" ou "1,500.00" conforme o ICU da
  // maquina, e uma frase de contrato nao pode variar por ambiente.
  return `${reais},${resto}`;
}

/**
 * Avalia um cupom contra um subtotal (em centavos) num instante.
 *
 * @param {object|null} cupom     A linha de `canastra.cupons` (ou null/undefined
 *                                quando a busca nao achou o codigo).
 * @param {number} subtotalCentavos Subtotal JA promocional, calculado pelo
 *                                servidor a partir dos precos do banco.
 * @param {Date} [agora]          Injetavel para teste; default relogio real.
 * @returns {{valido: true, descontoCentavos: number} |
 *           {valido: false, motivo: string}}
 */
function avaliarCupom(cupom, subtotalCentavos, agora = new Date()) {
  if (!cupom) {
    return { valido: false, motivo: "Cupom não encontrado" };
  }

  // Inativo cobre DOIS estados: o desligado pelo painel e o que ainda nao
  // comecou. Para quem esta validando, os dois significam a mesma coisa —
  // "este codigo nao esta valendo agora" — e "expirado" mentiria no segundo.
  if (!cupom.ativo) {
    return { valido: false, motivo: "Cupom inativo" };
  }
  if (cupom.inicio_em && agora < new Date(cupom.inicio_em)) {
    return { valido: false, motivo: "Cupom inativo" };
  }
  if (cupom.fim_em && agora > new Date(cupom.fim_em)) {
    return { valido: false, motivo: "Cupom expirado" };
  }

  // Esta checagem e CORTESIA de leitura: quem garante o esgotado de verdade e
  // o incremento atomico de `usos` na transacao do checkout (reservarUso).
  // Aqui ela so evita mandar ao checkout um cupom que ja se sabe morto.
  if (cupom.limite_usos !== null && cupom.limite_usos !== undefined) {
    if (Number(cupom.usos) >= Number(cupom.limite_usos)) {
      return { valido: false, motivo: "Cupom esgotado" };
    }
  }

  const minimo = Number(cupom.minimo_centavos) || 0;
  if (subtotalCentavos < minimo) {
    return {
      valido: false,
      motivo: `Pedido mínimo de R$ ${reaisPorExtenso(minimo)}`,
    };
  }

  // `valor` chega como string do pg (numeric) — Number() antes de qualquer conta.
  const valor = Number(cupom.valor);
  const descontoCentavos =
    cupom.tipo === "percent"
      ? Math.round((subtotalCentavos * valor) / 100)
      : // fixed: desconta ate o teto do proprio subtotal — cupom nunca deixa
        // o pedido negativo nem "paga" o frete do cliente.
        Math.min(Math.round(valor * 100), subtotalCentavos);

  return { valido: true, descontoCentavos };
}

module.exports = { avaliarCupom, normalizarCodigo, reaisPorExtenso };
