// Relativo, e não "@/": o alias vive só no tsconfig/Next — o Vitest não o
// resolve, e este módulo é coberto por checkout.test.ts.
import { API_BASE } from "../api-base";
import type { ItemDaSacola } from "./sacola";
import type { DadosDoCartao } from "./cartao";
import { assinaturaDoPedido, chaveDeIdempotencia } from "./idempotencia";

/**
 * Chamadas do checkout.
 *
 * Separadas da tela para o componente cuidar só de estado e render.
 *
 * O TOKEN CSRF SAIU DAQUI NA TASK 5, e o motivo não é limpeza: o `csurf` saiu
 * do backend porque a premissa dele saiu junto. A API autentica exclusivamente
 * por `Authorization: Bearer` e não aceita mais cookie de sessão — sem
 * credencial que o navegador anexe sozinho, não há CSRF a prevenir (o
 * raciocínio inteiro está em `backend/src/index.js`). `/csrf-token` deixou de
 * existir; continuar chamando seria um 404 por requisição.
 *
 * `credentials: "include"` FICA: o backend responde com
 * `Access-Control-Allow-Credentials`, e tirar de um lado só é o tipo de mudança
 * que quebra com erro de CORS em vez de erro de autenticação.
 */

export type Endereco = {
  zip_code: string;
  street: string;
  number: string;
  complement?: string;
  neighborhood: string;
  city: string;
  state: string;
};

export type OpcaoDeFrete = {
  id: number | string;
  name: string;
  price: number;
  days: number;
  company_picture?: string;
  /**
   * Marcador do servidor: o subtotal atingiu o piso e ESTA opção foi zerada
   * pela regra de frete grátis (ShippingController). A tela usa o marcador
   * para rotular "Frete grátis" em vez de exibir um R$ 0,00 sem explicação.
   */
  gratis?: boolean;
};

function cabecalhos(token: string) {
  return {
    "Content-Type": "application/json",
    Authorization: `Bearer ${token}`,
  };
}

export async function buscarEndereco(token: string): Promise<Endereco | null> {
  try {
    const r = await fetch(`${API_BASE}/address`, {
      credentials: "include",
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!r.ok) return null;
    const d = await r.json();
    return d?.zip_code ? d : null;
  } catch {
    return null;
  }
}

export async function salvarEndereco(
  token: string,
  endereco: Endereco,
): Promise<Endereco> {
  const r = await fetch(`${API_BASE}/address`, {
    method: "POST",
    credentials: "include",
    headers: cabecalhos(token),
    body: JSON.stringify(endereco),
  });
  if (!r.ok) {
    throw new Error("Não foi possível salvar o endereço.");
  }
  return r.json();
}

/**
 * Cotação de frete.
 *
 * Roda sem sessão de propósito — é a mesma rota pública que o backend expõe, e
 * o valor escolhido aqui é apenas uma sugestão: o checkout RECALCULA no
 * servidor antes de cobrar e recusa qualquer número que não corresponda a uma
 * opção real (ver conferirFrete em PaymentController).
 *
 * `cupom` viaja como CÓDIGO, nunca como desconto: o servidor o resolve do
 * banco e abate ANTES de comparar com o piso do frete grátis. Sem ele, um
 * cupom que derruba o subtotal para baixo do piso faria a cotação prometer
 * frete grátis que o conferirFrete recusaria com 409 — e a recotação sem o
 * cupom devolveria o grátis de novo: beco sem saída. Quem cota com o MESMO
 * cupom que vai pagar nunca entra nesse ciclo.
 */
export async function cotarFrete(
  zipCode: string,
  itens: ItemDaSacola[],
  cupom?: string,
  fetchFn: typeof fetch = fetch,
): Promise<OpcaoDeFrete[]> {
  const r = await fetchFn(`${API_BASE}/shipping/calculate`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      zipCode,
      items: itens.map((i) => ({
        product_id: i.product_id,
        quantity: i.quantity,
        price: i.price,
      })),
      ...(cupom ? { cupom } : {}),
    }),
  });

  if (!r.ok) {
    const d = await r.json().catch(() => ({}));
    throw new Error(d.error || "Não foi possível calcular o frete.");
  }
  return r.json();
}

export type RespostaDoPagamento = {
  status: string;
  orderId: string;
  ticketUrl?: string;
};

/** O que os dois meios de pagamento têm em comum. */
type DadosDoPedido = {
  itens: ItemDaSacola[];
  email: string;
  /** Só dígitos — obrigatório: vai para a nota fiscal e para o gateway. */
  cpf: string;
  endereco: Endereco;
  frete: OpcaoDeFrete;
  /** Código já validado por /cupons/validar; o servidor revalida. */
  cupom?: string;
};

/**
 * A MESMA chave para o MESMO pedido: reclique e retry repetem o header
 * `Idempotency-Key` e o servidor devolve o pedido que a primeira tentativa
 * criou (com ticketUrl), em vez de cobrar de novo. Mudou item, frete ou cupom
 * → assinatura nova → chave nova. Ver lib/sacola/idempotencia.ts.
 */
function chaveDestePedido(dados: DadosDoPedido): string {
  return chaveDeIdempotencia(
    assinaturaDoPedido({
      itens: dados.itens.map((i) => ({
        product_id: i.product_id,
        quantity: Number(i.quantity),
      })),
      freteId: dados.frete.id,
      freteNome: dados.frete.name,
      fretePreco: dados.frete.price,
      // Corrigir o CEP é OUTRO pedido — retry com endereço novo não pode
      // replayar o pedido gravado com o endereço velho.
      cep: dados.endereco.zip_code,
      cupom: dados.cupom,
    }),
  );
}

/**
 * Corpo comum do process_payment.
 *
 * O corpo NÃO manda userId nem preço de item: a identidade vem do token e o
 * total é recalculado no servidor a partir do banco. Mandar esses campos não
 * teria efeito — o backend passou a ignorá-los justamente porque eram
 * falsificáveis. O `cupom` viaja como CÓDIGO pela mesma razão: o servidor
 * revalida e calcula o desconto; o número do navegador é só exibição.
 */
function corpoComum(dados: DadosDoPedido) {
  return {
    items: dados.itens.map((i) => ({
      product_id: i.product_id,
      quantity: i.quantity,
      name: i.name,
    })),
    userEmail: dados.email,
    address: dados.endereco,
    shippingCost: dados.frete.price,
    shippingMethod: dados.frete.name,
    ...(dados.cupom ? { cupom: dados.cupom } : {}),
  };
}

async function processarPagamento(
  token: string,
  chave: string,
  corpo: Record<string, unknown>,
  fraseDeErro: string,
  fetchFn: typeof fetch,
): Promise<RespostaDoPagamento> {
  const r = await fetchFn(`${API_BASE}/checkout/process_payment`, {
    method: "POST",
    credentials: "include",
    headers: { ...cabecalhos(token), "Idempotency-Key": chave },
    body: JSON.stringify(corpo),
  });

  const d = await r.json().catch(() => ({}));
  if (!r.ok) {
    throw new Error(d.details || d.error || fraseDeErro);
  }
  /**
   * 200 sem `orderId` é resposta que a tela não sabe consumir (um proxy
   * devolvendo HTML, um corpo truncado): deixar passar quebraria no render
   * (`pago.orderId.slice`) DEPOIS de um pagamento possivelmente cobrado. O
   * erro manda conferir os pedidos antes de tentar de novo — a chave de
   * idempotência segue viva, então repetir é seguro de qualquer forma.
   */
  if (typeof d.orderId !== "string" || !d.orderId) {
    throw new Error(
      "Recebemos uma resposta inesperada do pagamento. Confira em Meus " +
        "pedidos se o pedido foi criado antes de tentar de novo.",
    );
  }
  return d;
}

export async function pagarComPix(
  token: string,
  dados: DadosDoPedido,
  fetchFn: typeof fetch = fetch,
): Promise<RespostaDoPagamento> {
  return processarPagamento(
    token,
    chaveDestePedido(dados),
    {
      formData: {
        paymentMethodId: "pix",
        payer: {
          email: dados.email,
          identification: { type: "CPF", number: dados.cpf },
        },
      },
      paymentMethodType: "pix",
      ...corpoComum(dados),
    },
    "Não foi possível gerar o Pix.",
    fetchFn,
  );
}

/**
 * Cartão: o número nunca passou por aqui — o CardForm (lib/sacola/cartao.ts)
 * o trocou por `token` nos iframes do Mercado Pago. Este corpo é exatamente o
 * que o PaymentController repassa ao gateway: token, bandeira
 * (payment_method_id), emissor, parcelas e o pagador com CPF.
 *
 * `transaction_amount` vai por contrato, mas quem cobra é o valor CONFERIDO
 * no servidor (releitura de preço + frete recotado) — divergência aqui não
 * muda o que se paga.
 */
export async function pagarComCartao(
  token: string,
  dados: DadosDoPedido & { cartao: DadosDoCartao },
  fetchFn: typeof fetch = fetch,
): Promise<RespostaDoPagamento> {
  const { cartao } = dados;
  return processarPagamento(
    token,
    chaveDestePedido(dados),
    {
      formData: {
        token: cartao.token,
        payment_method_id: cartao.paymentMethodId,
        issuer_id: cartao.issuerId,
        installments: Number(cartao.installments || 1),
        transaction_amount: Number(cartao.amount),
        payer: {
          email: dados.email,
          identification: { type: "CPF", number: dados.cpf },
        },
      },
      paymentMethodType: "credit_card",
      ...corpoComum(dados),
    },
    "Não foi possível processar o cartão.",
    fetchFn,
  );
}
