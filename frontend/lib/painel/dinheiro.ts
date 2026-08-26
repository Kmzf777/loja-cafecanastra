/**
 * Dinheiro no painel, com a UNIDADE NO NOME — e por que isso não é preciosismo.
 *
 * O mesmo schema devolve `total_amount`, `shipping_cost` e `discount` em REAIS
 * (numeric(10,2), que o driver do pg entrega como STRING) e
 * `minimo_centavos`, `preco_centavos` e `frete_gratis_minimo_centavos` em
 * CENTAVOS (integer). Quatro telas legadas resolveram isso com um `moeda()`
 * local que adivinha pela ordem de grandeza. Um cupom de R$ 10 formatado como
 * centavos vira R$ 0,10 e ninguém percebe até o cliente perceber.
 *
 * Nenhuma função aqui adivinha. Ou você chama a de centavos, ou a de reais.
 */

const BRL = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
});

/** Ausência é diferente de zero: R$ 0,00 é um desconto de zero, "—" é a
 *  ausência de desconto. Colapsar os dois esconde bug de gravação. */
const AUSENTE = "—";

export function formatarCentavos(centavos: number | null | undefined): string {
  if (centavos === null || centavos === undefined || Number.isNaN(centavos)) {
    return AUSENTE;
  }
  return BRL.format(centavos / 100);
}

export function formatarReais(reais: string | number | null | undefined): string {
  if (reais === null || reais === undefined || reais === "") return AUSENTE;
  const n = typeof reais === "string" ? Number(reais) : reais;
  if (Number.isNaN(n)) return AUSENTE;
  return BRL.format(n);
}

/**
 * VAZIO DEVOLVE `null`, NUNCA `0`. Esta é a regra que impede o defeito de
 * `PUT /config`: lá, `Number('')` é `0`, e `0` no mínimo de frete grátis
 * DESLIGA o frete grátis da loja inteira. Quem chama decide o que fazer com o
 * `null` — e "não mandar o campo" é quase sempre a resposta certa.
 */
export function reaisParaCentavos(
  entrada: string | number | null | undefined,
): number | null {
  if (entrada === null || entrada === undefined) return null;
  const texto = String(entrada).trim().replace(",", ".");
  if (texto === "") return null;
  const n = Number(texto);
  if (Number.isNaN(n)) return null;
  // `Math.round(n * 100)` sozinho erra em 1.005 (ponto flutuante dá 100.49999).
  return Math.round((n + Number.EPSILON) * 100);
}

export function centavosParaReais(centavos: number): number {
  return centavos / 100;
}
