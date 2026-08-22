import { chavePublicaMp } from "../../../../lib/sacola/cartao";

/**
 * Os Termos prometem cartão exatamente quando o checkout oferece cartão.
 *
 * UMA FONTE SÓ, E ELA NÃO É DAQUI. A página lia `process.env.NEXT_PUBLIC_MP_PUBLIC_KEY`
 * por conta própria; o checkout lê pela `chavePublicaMp()` de
 * lib/sacola/cartao.ts. Duas leituras da mesma env é uma promessa jurídica
 * capaz de divergir do produto no dia em que uma das duas mudar de critério —
 * um `?.trim()` que vira `!== undefined`, por exemplo, e a página passa a
 * anunciar cartão num build em que o rádio "Cartão" nem existe.
 *
 * A CONDICIONAL FUNCIONA porque os dois lados são resolvidos em tempo de
 * BUILD: a página é estática e `NEXT_PUBLIC_*` é assada no bundle. O build que
 * mostra o rádio é o mesmo que promete cartão aqui, e o build sem a chave
 * promete só Pix. Escolhido em vez de "cartão quando disponível" porque termos
 * de uso com condicional vaga não dizem nada.
 *
 * IMPORT RELATIVO, não `@/`: o vitest.config.ts não resolve o alias, e este
 * módulo tem teste ao lado (mesma nota de lib/i18n/rotas.ts).
 */
export function aceitaCartao(): boolean {
  return chavePublicaMp() !== null;
}
