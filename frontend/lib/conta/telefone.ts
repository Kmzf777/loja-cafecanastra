/**
 * Telefone brasileiro no NAVEGADOR — cópia DECLARADA de
 * `backend/src/utils/telefone.js`.
 *
 * POR QUE HÁ DUAS CÓPIAS, e por que isso é uma escolha e não um descuido: o
 * bundle do Next não importa de `backend/`. Aquilo é CommonJS de servidor, na
 * mesma árvore de `pg`, `axios` e `nodemailer`; puxá-lo para cá arrastaria
 * módulos de Node para dentro de um pacote que roda no navegador. Um pacote
 * compartilhado resolveria — e custaria um workspace novo, um passo de build e
 * uma versão para manter, para compartilhar quarenta linhas.
 *
 * O QUE SEGURA AS DUAS JUNTAS É `telefone.test.ts`, e não a boa vontade: ele
 * carrega a versão do backend de verdade (`createRequire`) e compara as duas
 * entrada por entrada. Divergir passa a ser um teste vermelho, e não um bug de
 * produção. **Mudou aqui, mude lá — e o contrário também.**
 *
 * A ARMADILHA QUE JUSTIFICA O MÓDULO é do Brasil. A documentação da Meta diz,
 * com estas palavras: "For Brazil and Mexico, the extra added prefix of the
 * phone number may be modified by the Cloud API". Ou seja: manda-se
 * 5531999990000 e o webhook pode devolver 553199990000, sem o nono dígito. O
 * lado que casa as duas formas é o do servidor (`variantesBrasil`); daqui sai
 * só a NORMALIZAÇÃO do que a pessoa digitou, que é a semente do primeiro envio.
 */

const DDI_BRASIL = "55";

/** Dígitos e nada mais. Máscara, espaço, parêntese e o "+" saem. */
function soDigitos(valor: unknown): string {
  return String(valor ?? "").replace(/\D/g, "");
}

/**
 * Devolve o número em E.164 sem o "+" (o formato que a Graph API quer no campo
 * `to`), ou `null` quando o que veio não é telefone brasileiro plausível.
 *
 * O recorte: depois do 55, sobram 10 dígitos (DDD + fixo de 8) ou 11 (DDD +
 * celular de 9). Qualquer outra coisa é `null` — mandar lixo para a Meta gasta
 * cota e derruba a nota de qualidade do número.
 *
 * ESTE CORPO É O DO BACKEND, LINHA A LINHA. Se ele precisar mudar, o teste de
 * concordância é quem cobra a outra metade.
 */
export function paraE164(valor: unknown): string | null {
  const digitos = soDigitos(valor);
  if (!digitos) return null;

  const semDdi = digitos.startsWith(DDI_BRASIL)
    ? digitos.slice(DDI_BRASIL.length)
    : digitos;

  if (semDdi.length !== 10 && semDdi.length !== 11) return null;

  // DDD brasileiro vai de 11 a 99; nenhum começa com zero.
  const ddd = Number(semDdi.slice(0, 2));
  if (!Number.isInteger(ddd) || ddd < 11) return null;

  return DDI_BRASIL + semDdi;
}

/**
 * O mesmo número, mas exigindo que seja CELULAR — nove dígitos começando com 9.
 *
 * MAIS ESTRITO QUE `paraE164`, E DE PROPÓSITO. `paraE164` serve ao ENVIO: o bot
 * manda para o que estiver gravado, inclusive num cadastro antigo em que
 * alguém digitou o fixo da casa. Esta função serve à TELA, que é o único
 * momento em que ainda dá para corrigir: o campo se chama "WhatsApp", e
 * WhatsApp em fixo é conta de empresa verificada por ligação — não é o que um
 * cliente da loja digita.
 *
 * O CUSTO DE ERRAR PARA O LADO PERMISSIVO é invisível e caro: o número entra,
 * `whatsapp_optin_em` é carimbado, a loja passa a acreditar que tem canal com
 * aquela pessoa — e todo aviso de pedido morre calado do lado da Meta, com
 * gasto de cota e queda na nota de qualidade do número da loja.
 */
export function paraWhatsapp(valor: unknown): string | null {
  const e164 = paraE164(valor);
  if (!e164) return null;

  const assinante = e164.slice(DDI_BRASIL.length + 2);
  if (assinante.length !== 9 || !assinante.startsWith("9")) return null;

  return e164;
}

/**
 * A máscara do campo: "(31) 99999-0000", montada enquanto a pessoa digita.
 *
 * NÃO VALIDA NADA — devolve o que couber, inclusive número pela metade. Validar
 * aqui faria o campo apagar o que a pessoa acabou de digitar.
 *
 * O DDI SAI QUANDO HÁ MAIS DE ONZE DÍGITOS, e a condição é essa e não
 * "começa com 55": o DDD 55 é Santa Maria (RS). Um "(55) 99999-0000" tem onze
 * dígitos e começa com 55 sem ter DDI nenhum; cortar dois dígitos ali viraria
 * "(99) 9990-000" no meio da digitação de quem mora lá.
 */
export function formatarTelefone(valor: unknown): string {
  let digitos = soDigitos(valor);
  if (digitos.startsWith(DDI_BRASIL) && digitos.length > 11) {
    digitos = digitos.slice(DDI_BRASIL.length);
  }
  digitos = digitos.slice(0, 11);

  if (digitos.length <= 2) return digitos;

  const ddd = `(${digitos.slice(0, 2)}) `;
  const assinante = digitos.slice(2);

  if (assinante.length <= 4) return ddd + assinante;
  if (assinante.length <= 8) {
    return `${ddd}${assinante.slice(0, 4)}-${assinante.slice(4)}`;
  }
  return `${ddd}${assinante.slice(0, 5)}-${assinante.slice(5)}`;
}
