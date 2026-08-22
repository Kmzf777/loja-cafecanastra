"use strict";

/**
 * Telefone do cliente para a Cloud API da Meta.
 *
 * A ARMADILHA QUE JUSTIFICA ESTE MODULO e do Brasil. A documentacao da Meta
 * diz, com estas palavras: "For Brazil and Mexico, the extra added prefix of
 * the phone number may be modified by the Cloud API." Ou seja: voce manda
 * 5531999990000 e o webhook pode devolver 553199990000, sem o nono digito.
 * Comparar o `from` do webhook com o que esta em `clientes.telefone` daria
 * "cliente desconhecido" para metade do pais.
 *
 * Daí as duas funcoes: `paraE164` normaliza o que o cliente digitou (para o
 * PRIMEIRO envio), e `variantesBrasil` devolve as duas formas para o webhook
 * casar ate `clientes.whatsapp_wa_id` estar gravado. Depois disso a chave
 * canonica e o wa_id, e nada mais adivinha.
 */

const DDI_BRASIL = "55";

/** Digitos e nada mais. Mascara, espaco, parentese e o "+" saem. */
function soDigitos(valor) {
  return String(valor ?? "").replace(/\D/g, "");
}

/**
 * Devolve o numero em E.164 sem o "+" (o formato que a Graph API quer no campo
 * `to`), ou `null` quando o que veio nao e telefone brasileiro plausivel.
 *
 * O recorte: depois do 55, sobram 10 digitos (DDD + fixo de 8) ou 11 (DDD +
 * celular de 9). Qualquer outra coisa e `null` — mandar lixo para a Meta gasta
 * cota e derruba a nota de qualidade do numero.
 */
function paraE164(valor) {
  const digitos = soDigitos(valor);
  if (!digitos) return null;

  const semDdi = digitos.startsWith(DDI_BRASIL)
    ? digitos.slice(DDI_BRASIL.length)
    : digitos;

  if (semDdi.length !== 10 && semDdi.length !== 11) return null;

  // DDD brasileiro vai de 11 a 99; nenhum comeca com zero.
  const ddd = Number(semDdi.slice(0, 2));
  if (!Number.isInteger(ddd) || ddd < 11) return null;

  return DDI_BRASIL + semDdi;
}

/**
 * As duas formas do mesmo celular — com e sem o nono digito —, a informada
 * primeiro. Fixo devolve só a si mesmo: acrescentar 9 a um fixo produz um
 * numero que nao existe.
 *
 * Lista vazia quando a entrada nao normaliza; quem chama itera e nao acha nada,
 * em vez de consultar o banco com `undefined`.
 */
function variantesBrasil(valor) {
  const e164 = paraE164(valor);
  if (!e164) return [];

  const assinante = e164.slice(DDI_BRASIL.length + 2);
  const prefixo = e164.slice(0, DDI_BRASIL.length + 2);

  if (assinante.length === 9 && assinante.startsWith("9")) {
    return [e164, prefixo + assinante.slice(1)];
  }
  // Oito digitos comecando com 6-9 e celular antigo: ganha a forma com o 9.
  if (assinante.length === 8 && /^[6-9]/.test(assinante)) {
    return [e164, prefixo + "9" + assinante];
  }
  return [e164];
}

/**
 * Os quatro ultimos digitos, que e tudo que o painel precisa mostrar.
 * O telefone completo mora em `clientes.telefone` e em lugar nenhum mais — ver
 * o cabecalho de 0017.
 */
function ultimosQuatro(valor) {
  const digitos = soDigitos(valor);
  return digitos.length >= 4 ? digitos.slice(-4) : null;
}

module.exports = { paraE164, variantesBrasil, ultimosQuatro };
