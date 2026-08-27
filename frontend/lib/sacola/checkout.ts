// Relativo, e não "@/": o alias vive só no tsconfig/Next — o Vitest não o
// resolve, e este módulo é coberto por checkout.test.ts.
import { API_BASE } from "../api-base";
import type { ItemDaSacola } from "./sacola";
import type { DadosDoCartao } from "./cartao";
import { deviceIdDoNavegador } from "./cartao";
import { assinaturaDoPedido, chaveDeIdempotencia } from "./idempotencia";
// Relativo pelo mesmo motivo do `API_BASE` acima: o Vitest não resolve o alias.
import { precoPromocionalDaApi } from "../catalogo/promocao";

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

/**
 * Preço de catálogo AO VIVO dos itens da sacola, por `product_id`, em REAIS.
 *
 * Existe para o desfecho do 409 de preço: a sacola guarda `price` no
 * `localStorage` e nunca o revalida, então quando o servidor recusa o pedido
 * dizendo "o preço mudou" a tela precisa de um jeito de saber o preço novo —
 * senão o cliente reenvia o mesmo número velho e leva outro 409, para sempre.
 *
 * A FONTE É A MESMA DA VITRINE: `GET /dashboard`, público, o endpoint que
 * `lib/catalogo/repositorio.ts` já usa para sobrepor preço e estoque do banco
 * sobre o JSON editorial. Isso não é detalhe — é o que garante que o número
 * relido aqui seja exatamente o que a conferência do servidor compara (o preço
 * de catálogo, sem promoção; ver `conferirSubtotal` no PaymentController).
 *
 * Sem cache de propósito (o `next.revalidate` de 60s do repositório serve à
 * vitrine, não a uma correção de preço em curso), e sem engolir a falha: quem
 * chama precisa saber que não conseguiu reler para poder mandar recarregar a
 * página em vez de prometer um total que não conferiu.
 *
 * O PROMOCIONAL VEM JUNTO, E ELE É METADE DO CONSERTO. Desde a Onda 6 a tela
 * também declara `subtotalPromocionalCentavos`, conferido com a mesma
 * tolerância zero contra a soma de `precoComPromocao` no servidor. Reler só o
 * preço de catálogo deixaria a promoção VELHA colada no item — e a segunda
 * tentativa levaria 409 pelo outro campo, que é o mesmo laço infinito que esta
 * função existe para quebrar, com outro nome.
 */
export type PrecoRelido = {
  /** Preço de catálogo, em REAIS — o vocabulário de `ItemDaSacola.price`. */
  precoReais: number;
  /** Preço promocional em CENTAVOS, ou ausente quando não há campanha. */
  precoPromocionalCentavos?: number;
};

export async function buscarPrecosAtuais(
  itens: ItemDaSacola[],
  fetchFn: typeof fetch = fetch,
): Promise<Map<string, PrecoRelido>> {
  const r = await fetchFn(`${API_BASE}/dashboard?limit=200`, {
    cache: "no-store",
  });
  if (!r.ok) throw new Error("Não foi possível reler os preços agora.");

  const dados = await r.json();
  const linhas: {
    product_id?: string;
    price?: string | number;
    promotional_price?: string | number | null;
  }[] = dados?.products ?? [];

  const naSacola = new Set(itens.map((i) => i.product_id));
  const precos = new Map<string, PrecoRelido>();
  for (const p of linhas) {
    if (!p?.product_id || !naSacola.has(p.product_id)) continue;
    const preco = Number(p.price);
    if (!Number.isFinite(preco) || preco < 0) continue;
    const promocional = precoPromocionalDaApi(
      p.promotional_price,
      Math.round(preco * 100),
    );
    precos.set(p.product_id, {
      precoReais: preco,
      ...(promocional === undefined
        ? {}
        : { precoPromocionalCentavos: promocional }),
    });
  }
  return precos;
}

/**
 * O subtotal DOS ITENS em centavos — sem frete, sem desconto. A mesma conta do
 * `totalCentavos` da sacola (`round(price * 100) * quantity`, item a item, para
 * float não errar na fronteira) porque é literalmente o mesmo número: o que a
 * tela exibe como "Subtotal" e o que viaja no corpo do pagamento.
 */
export function subtotalDosItensCentavos(itens: ItemDaSacola[]): number {
  return itens.reduce(
    (soma, i) => soma + Math.round(Number(i.price) * 100) * Number(i.quantity),
    0,
  );
}

/**
 * O SUBTOTAL QUE A PESSOA DE FATO PAGA PELOS ITENS — promoção já aplicada.
 *
 * É o número da TELA: resumo da sacola, resumo do checkout, base do teto do
 * cupom, base da barra de frete grátis e valor com que o CardForm do Mercado
 * Pago é montado. Item sem campanha entra pelo preço de catálogo, então sem
 * promoção nenhuma este número é idêntico ao de `subtotalDosItensCentavos` e
 * nada na loja muda de comportamento.
 *
 * O QUE ELE NÃO É: o `subtotalCentavos` do corpo do pagamento. Aquele continua
 * sendo a soma do CATÁLOGO, porque é contra o catálogo que `conferirSubtotal`
 * compara, com tolerância zero. Os dois números existem porque respondem a
 * duas perguntas diferentes — "quanto custa" e "a tela está velha?" — e
 * fundi-los num só é o caminho que mata toda venda com promoção em 409.
 */
export function subtotalPromocionalCentavos(itens: ItemDaSacola[]): number {
  return itens.reduce(
    (soma, i) =>
      soma +
      (i.precoPromocionalCentavos ?? Math.round(Number(i.price) * 100)) *
        Number(i.quantity),
    0,
  );
}

/** Algum item da sacola está em campanha? */
export function temItemEmPromocao(itens: ItemDaSacola[]): boolean {
  return itens.some((i) => i.precoPromocionalCentavos !== undefined);
}

export type RespostaDoPagamento = {
  status: string;
  orderId: string;
  ticketUrl?: string;
};

/**
 * O código que o servidor devolve no 409 de preço (campo `error`). A tela o usa
 * para distinguir ESTE 409 do 409 de frete: um pede recarregar os preços, o
 * outro pede recalcular a entrega — e uma frase genérica deixaria o cliente
 * sem saber qual dos dois fazer.
 */
export const CODIGO_PRECO_MUDOU = "PRECO_MUDOU";

/**
 * Erro do `process_payment` COM o código de erro do servidor preservado.
 *
 * `processarPagamento` sempre lançou `new Error(details || error)` — a frase
 * chegava na tela, o CÓDIGO se perdia no caminho. Continua sendo um `Error` com
 * exatamente a mesma mensagem (nada que só olha `e.message` muda), mas agora
 * quem precisa AGIR conforme o motivo consegue.
 */
export class ErroDoPagamento extends Error {
  readonly codigo?: string;

  constructor(mensagem: string, codigo?: string) {
    super(mensagem);
    this.name = "ErroDoPagamento";
    this.codigo = codigo;
  }
}

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
 *
 * O SUBTOTAL NÃO ENTRA NA ASSINATURA, e isso é decisão, não esquecimento.
 * Corrigir o preço depois de um 409 não é montar outro pedido: são os mesmos
 * cafés, na mesma quantidade, para o mesmo CEP — é a MESMA tentativa, e ela
 * precisa da mesma chave. Se o preço entrasse aqui, a retentativa depois da
 * recarga ganharia chave nova; e uma retentativa com chave nova é exatamente o
 * que cobra duas vezes quando a primeira resposta se perde na rede. O 409 não
 * chega a criar pedido nenhum, então reusar a chave é seguro por construção.
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
 *
 * `subtotalCentavos` É A EXCEÇÃO QUE CONFIRMA A REGRA, e vale explicar por quê:
 * ele também não entra em conta nenhuma — o servidor continua somando o preço
 * do banco para cobrar. Ele é uma DECLARAÇÃO: "foi este o subtotal que eu
 * mostrei para o cliente". O servidor compara com o que acabou de ler e, se
 * divergir, recusa com 409 em vez de cobrar um valor que a pessoa não viu (o
 * cartão era o caso pior: o CardForm é montado com o total da tela e o
 * `transaction_amount` cobrado é o do servidor). É a mesma disciplina do
 * `shippingCost`, que o `conferirFrete` já reconferia — o preço dos itens é que
 * não tinha conferência nenhuma.
 */
function corpoComum(dados: DadosDoPedido) {
  const deviceId = deviceIdDoNavegador();
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
    subtotalCentavos: subtotalDosItensCentavos(dados.itens),
    /**
     * A DECLARAÇÃO DO QUE A TELA EXIBIU, e ela só viaja quando há o que
     * declarar.
     *
     * Sem nenhum item em campanha este número seria idêntico a
     * `subtotalCentavos` — um segundo campo dizendo a mesma coisa, com uma
     * segunda chance de divergir e recusar um pedido correto. Com campanha, ele
     * é o que pega a classe de erro que a EXIBIÇÃO introduziu: a tela mostrando
     * uma promoção que já expirou no servidor.
     *
     * O servidor confere contra a soma de `precoComPromocao`, com a mesma
     * tolerância zero de `conferirSubtotal`. Enquanto essa conferência não
     * existir do outro lado, o campo é inerte — o Express ignora corpo que não
     * lê —, e é assim que esta onda entra sem depender da anterior.
     */
    ...(temItemEmPromocao(dados.itens)
      ? { subtotalPromocionalCentavos: subtotalPromocionalCentavos(dados.itens) }
      : {}),
    ...(dados.cupom ? { cupom: dados.cupom } : {}),
    // Fingerprint do Mercado Pago. Vale para Pix e cartão — o motor de risco
    // lê o device nos dois. Ausente quando o security.js não carregou, e a
    // ausência é tratada como normal em todo o caminho.
    ...(deviceId ? { deviceId } : {}),
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
    throw new ErroDoPagamento(
      d.details || d.error || fraseDeErro,
      typeof d.error === "string" ? d.error : undefined,
    );
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
