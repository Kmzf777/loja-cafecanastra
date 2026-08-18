import { API_BASE } from "@/lib/conta/sessao";
import type { ItemDaSacola } from "./sacola";

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
 */
export async function cotarFrete(
  zipCode: string,
  itens: ItemDaSacola[],
): Promise<OpcaoDeFrete[]> {
  const r = await fetch(`${API_BASE}/shipping/calculate`, {
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

/**
 * Cria o pagamento.
 *
 * O corpo NÃO manda userId nem preço: a identidade vem do token e o total é
 * recalculado no servidor a partir do banco. Mandar esses campos não teria
 * efeito — o backend passou a ignorá-los justamente porque eram falsificáveis.
 */
export async function pagarComPix(
  token: string,
  dados: {
    itens: ItemDaSacola[];
    email: string;
    cpf?: string;
    endereco: Endereco;
    frete: OpcaoDeFrete;
  },
): Promise<RespostaDoPagamento> {
  const r = await fetch(`${API_BASE}/checkout/process_payment`, {
    method: "POST",
    credentials: "include",
    headers: cabecalhos(token),
    body: JSON.stringify({
      formData: {
        paymentMethodId: "pix",
        payer: {
          email: dados.email,
          ...(dados.cpf
            ? { identification: { type: "CPF", number: dados.cpf } }
            : {}),
        },
      },
      paymentMethodType: "pix",
      items: dados.itens.map((i) => ({
        product_id: i.product_id,
        quantity: i.quantity,
        name: i.name,
      })),
      userEmail: dados.email,
      address: dados.endereco,
      shippingCost: dados.frete.price,
      shippingMethod: dados.frete.name,
    }),
  });

  const d = await r.json().catch(() => ({}));
  if (!r.ok) {
    throw new Error(d.details || d.error || "Não foi possível gerar o Pix.");
  }
  return d;
}
