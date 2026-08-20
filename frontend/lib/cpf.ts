/**
 * CPF — máscara e validação, sem biblioteca.
 *
 * O checkout exige CPF nos dois meios de pagamento (Pix e cartão): o backend o
 * grava em `canastra.clientes` e o Mercado Pago o exige em
 * `payer.identification` — e é o dado da nota fiscal, que é como a tela
 * explica o pedido ao cliente.
 *
 * Módulo puro de propósito: nada de `window`, nada de React — os testes rodam
 * em Vitest ambiente node. A máscara é progressiva (formata o que já foi
 * digitado, sem sufixo fantasma) porque o campo reaplica `formatarCpf` a cada
 * tecla; uma máscara de comprimento fixo brigaria com o cursor.
 */

/** Só os dígitos, no máximo 11 — colar um número longo não estoura a máscara. */
export function limparCpf(bruto: string): string {
  return bruto.replace(/\D/g, "").slice(0, 11);
}

/** "52998224725" → "529.982.247-25", progressivo enquanto se digita. */
export function formatarCpf(bruto: string): string {
  const d = limparCpf(bruto);
  const partes = [d.slice(0, 3), d.slice(3, 6), d.slice(6, 9)].filter(Boolean);
  const corpo = partes.join(".");
  const dv = d.slice(9, 11);
  return dv ? `${corpo}-${dv}` : corpo;
}

/**
 * Dígitos verificadores da Receita: pesos 10..2 e 11..2, resto < 2 → dígito 0.
 * Onze dígitos repetidos passam na conta mas não são CPF — recusados à parte.
 */
export function validarCpf(bruto: string): boolean {
  const d = bruto.replace(/\D/g, "");
  if (d.length !== 11) return false;
  if (/^(\d)\1{10}$/.test(d)) return false;

  const digito = (fatia: string, pesoInicial: number): number => {
    const soma = [...fatia].reduce(
      (acc, ch, i) => acc + Number(ch) * (pesoInicial - i),
      0,
    );
    const resto = soma % 11;
    return resto < 2 ? 0 : 11 - resto;
  };

  return (
    digito(d.slice(0, 9), 10) === Number(d[9]) &&
    digito(d.slice(0, 10), 11) === Number(d[10])
  );
}
