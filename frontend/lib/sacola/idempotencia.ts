/**
 * Idempotência do pagamento, do lado do navegador.
 *
 * O servidor já se defende: `process_payment` aceita `Idempotency-Key` e, se a
 * chave já tem pedido, devolve O MESMO pedido com `ticketUrl` em vez de cobrar
 * de novo (índice parcial da 0005 + replay no PaymentController). Mas a defesa
 * só arma se o navegador MANDAR a chave — este módulo é quem a gera.
 *
 * A REGRA: uma chave por TENTATIVA DE PAGAMENTO, não por clique.
 *  - Reclique no botão e retry depois de timeout são A MESMA tentativa → a
 *    mesma chave → o servidor devolve o pedido que a primeira criou.
 *  - Mudou item, quantidade, frete ou cupom → é OUTRO pedido → chave nova.
 *    (Sem isso, quem pagou um pedido e montou outro receberia o pedido antigo
 *    de volta, "pago", sem cobrança do novo — o replay viraria bug.)
 *
 * A troca é detectada por uma ASSINATURA canônica do pedido (itens ordenados +
 * frete + cupom). Só a tentativa CORRENTE fica guardada: voltar a uma
 * assinatura antiga gera chave nova, e isso é o lado seguro — o custo é, no
 * máximo, um pedido pendente duplicado que ninguém pagou; o inverso (reusar
 * chave de uma tentativa já paga) devolveria pedido pago sem cobrar.
 *
 * `descartarChave()` fecha a tentativa, e o checkout o chama nos DOIS
 * desfechos definitivos:
 *  - RECUSA: o pedido daquela chave nasceu e morreu (`rejeitado`); repetir a
 *    chave devolveria o pedido morto para sempre.
 *  - SUCESSO: o pedido daquela chave está pago; uma compra IDÊNTICA na mesma
 *    sessão (mesmos itens e frete, sem reload) casaria a assinatura e viraria
 *    replay — o servidor devolveria o pedido antigo sem cobrar nem criar nada.
 * A chave só sobrevive ao que NÃO encerra a tentativa: timeout, queda de rede,
 * 4xx antes de o pedido existir — exatamente os casos em que repetir a chave é
 * a proteção, não o bug.
 *
 * Estado de módulo (não React): a chave precisa sobreviver a re-render e não
 * precisa sobreviver a reload — depois de um reload não há retry automático em
 * curso, e o servidor continua sendo a defesa de verdade.
 */

type Dados = {
  itens: { product_id: string; quantity: number }[];
  freteId: string | number;
  freteNome: string;
  fretePreco: number;
  /**
   * CEP de entrega. Entra na assinatura porque corrigir o endereço É mudar o
   * pedido: sem ele, quem errasse o CEP, pagasse, visse o erro e tentasse de
   * novo com o CEP certo receberia o REPLAY do pedido antigo — com o endereço
   * velho gravado. Normalizado para dígitos: "37928-000" e "37928000" são o
   * mesmo lugar.
   */
  cep: string;
  cupom?: string;
};

/** Assinatura canônica: itens em ordem estável + frete + CEP + cupom. */
export function assinaturaDoPedido(dados: Dados): string {
  const itens = [...dados.itens]
    .map((i) => `${i.product_id}x${Number(i.quantity)}`)
    .sort()
    .join("|");
  return [
    itens,
    `frete:${dados.freteId}:${dados.freteNome}:${Number(dados.fretePreco)}`,
    `cep:${dados.cep.replace(/\D/g, "")}`,
    `cupom:${dados.cupom ?? ""}`,
  ].join(";");
}

let tentativa: { assinatura: string; chave: string } | null = null;

function uuid(): string {
  const c = globalThis.crypto;
  if (c?.randomUUID) return c.randomUUID();
  // Fallback para navegador sem randomUUID (contexto não-seguro antigo):
  // aleatório simples, no mesmo formato — o servidor só exige unicidade.
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (ch) => {
    const r = (Math.random() * 16) | 0;
    return (ch === "x" ? r : (r & 0x3) | 0x8).toString(16);
  });
}

/** A chave da tentativa corrente: reusa para a mesma assinatura, troca ao mudar. */
export function chaveDeIdempotencia(assinatura: string): string {
  if (!tentativa || tentativa.assinatura !== assinatura) {
    tentativa = { assinatura, chave: uuid() };
  }
  return tentativa.chave;
}

/**
 * Encerra a tentativa: a próxima ganha chave nova, mesmo com a MESMA
 * assinatura. Chamado na recusa definitiva E no sucesso — ver o cabeçalho.
 */
export function descartarChave(): void {
  tentativa = null;
}

/** Só para os testes — estado de módulo sobreviveria entre casos. */
export function _zerarIdempotencia(): void {
  tentativa = null;
}
