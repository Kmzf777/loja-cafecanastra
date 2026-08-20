/**
 * CEP — máscara e consulta ao ViaCEP.
 *
 * O checkout preenche rua/bairro/cidade/UF sozinho quando o CEP se completa.
 * A consulta é CONVENIÊNCIA, nunca condição: qualquer falha (rede, CEP
 * inexistente, resposta estranha) devolve `null` em silêncio e a pessoa segue
 * digitando à mão — um endereço que o ViaCEP não conhece ainda é um endereço
 * entregável.
 *
 * Módulo puro: o fetch é injetável e `interpretarViaCep` é uma função de
 * parsing sem efeito — é o que os testes fixam. Quem decide dinheiro (frete)
 * continua sendo o servidor; daqui sai só texto de formulário.
 */

/** Só os dígitos, no máximo 8. */
export function limparCep(bruto: string): string {
  return bruto.replace(/\D/g, "").slice(0, 8);
}

/** "37928000" → "37928-000", progressivo enquanto se digita. */
export function formatarCep(bruto: string): string {
  const d = limparCep(bruto);
  return d.length > 5 ? `${d.slice(0, 5)}-${d.slice(5)}` : d;
}

/** O gatilho da consulta: os 8 dígitos presentes. */
export function cepCompleto(bruto: string): boolean {
  return limparCep(bruto).length === 8;
}

/** Os campos que o formulário de endereço sabe preencher. */
export type EnderecoDoCep = {
  street: string;
  neighborhood: string;
  city: string;
  state: string;
};

/**
 * Resposta do ViaCEP → vocabulário do endereço do checkout.
 *
 * O ViaCEP responde 200 até para CEP que não existe — o "não achei" vem como
 * `{ erro: true }` no corpo (e já veio como string "true" em versões da API),
 * por isso o teste é `Boolean(erro)` e não `=== true`. Campo ausente vira
 * string vazia: CEP único de cidade pequena não tem logradouro por CEP, e
 * `undefined` num value de input controlado é o React trocando de
 * controlado para não-controlado no meio da digitação.
 */
export function interpretarViaCep(json: unknown): EnderecoDoCep | null {
  if (typeof json !== "object" || json === null) return null;
  const d = json as Record<string, unknown>;
  if (d.erro) return null;
  const texto = (v: unknown) => (typeof v === "string" ? v : "");
  return {
    street: texto(d.logradouro),
    neighborhood: texto(d.bairro),
    city: texto(d.localidade),
    state: texto(d.uf),
  };
}

/** Consulta o ViaCEP. Toda falha é `null` silencioso — ver o cabeçalho. */
export async function buscarCep(
  cep: string,
  fetchFn: typeof fetch = fetch,
): Promise<EnderecoDoCep | null> {
  if (!cepCompleto(cep)) return null;
  try {
    const r = await fetchFn(`https://viacep.com.br/ws/${limparCep(cep)}/json/`);
    if (!r.ok) return null;
    return interpretarViaCep(await r.json());
  } catch {
    return null;
  }
}
