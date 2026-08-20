/**
 * GA4 e consentimento de cookies — a parte SEM React.
 *
 * Módulo puro de propósito: nada aqui importa React nem assume que `window`
 * existe, então os testes rodam em Vitest ambiente node com um dublê. Quem
 * injeta o gtag.js é `components/analytics/ScriptsAnalytics.tsx`; quem pergunta
 * ao visitante é `components/layout/BannerCookies.tsx`. Os dois conversam por
 * este arquivo: a chave do localStorage, o evento de troca e os disparos.
 *
 * REGRA DE OURO: todo evento é no-op silencioso quando `window.gtag` não
 * existe. O gtag só existe quando (a) `NEXT_PUBLIC_GA4_ID` está definida e
 * (b) o visitante ACEITOU medição no banner — a Política de privacidade
 * promete exatamente isso ("cookies de medição só são usados se você aceitar").
 * Um evento que enfileirasse dados antes do consentimento quebraria a promessa.
 *
 * Preço: o catálogo fala em CENTAVOS; o GA4 quer decimal. A conversão acontece
 * aqui, uma vez, em `paraItemGa4` — nenhuma tela faz aritmética de preço.
 */

/** Chave no localStorage E nome do evento que anuncia a troca da escolha. */
export const CHAVE_CONSENTIMENTO = "cookies:consentimento";
export const EVENTO_CONSENTIMENTO = "cookies:consentimento";

export type Consentimento = "aceito" | "essencial";

type JanelaComGtag = {
  gtag?: (...args: unknown[]) => void;
  localStorage?: Storage;
  dispatchEvent?: (evento: Event) => boolean;
};

function janela(): JanelaComGtag | undefined {
  return typeof window === "undefined"
    ? undefined
    : (window as unknown as JanelaComGtag);
}

/** A escolha registrada, ou `null` na primeira visita (banner deve aparecer). */
export function lerConsentimento(): Consentimento | null {
  try {
    const valor = janela()?.localStorage?.getItem(CHAVE_CONSENTIMENTO);
    return valor === "aceito" || valor === "essencial" ? valor : null;
  } catch {
    // Modo privado com cota zerada: sem registro, o banner volta a aparecer.
    return null;
  }
}

/** Grava a escolha e anuncia — o ScriptsAnalytics reage sem recarregar. */
export function gravarConsentimento(valor: Consentimento): void {
  const w = janela();
  if (!w) return;
  try {
    w.localStorage?.setItem(CHAVE_CONSENTIMENTO, valor);
  } catch {
    // Sem localStorage a escolha vale só para esta página — melhor que travar.
  }
  w.dispatchEvent?.(new Event(EVENTO_CONSENTIMENTO));
}

/**
 * Desfaz a escolha — o "Rever cookies" da Política de privacidade e do rodapé.
 *
 * A LGPD (e a própria Política) só faz sentido se aceitar for tão reversível
 * quanto foi dizer sim. Apagar a chave devolve o estado de primeira visita: o
 * BannerCookies reaparece (ele ouve o evento) e o ScriptsAnalytics deixa de
 * renderizar os scripts. O gtag JÁ CARREGADO não tem como ser descarregado da
 * página — por isso o `delete` de `window.gtag`: os eventos de comércio são
 * no-op sem ele, então a medição PARA no instante da revogação, não só no
 * próximo load.
 */
export function revogarConsentimento(): void {
  const w = janela();
  if (!w) return;
  try {
    w.localStorage?.removeItem(CHAVE_CONSENTIMENTO);
  } catch {
    // Sem localStorage não havia escolha persistida a apagar.
  }
  delete w.gtag;
  w.dispatchEvent?.(new Event(EVENTO_CONSENTIMENTO));
}

/** Item de comércio como as telas o conhecem: centavos, nomes em português. */
export type ItemAnalytics = {
  /** Identificador estável — o `skuLoja` do catálogo. */
  id: string;
  nome: string;
  precoCentavos: number;
  quantidade: number;
  /** Rótulo da variação (moagem, embalagem), quando houver. */
  variante?: string;
};

type ItemGa4 = {
  item_id: string;
  item_name: string;
  price: number;
  quantity: number;
  item_variant?: string;
};

function valorDecimal(centavos: number): number {
  return Number((centavos / 100).toFixed(2));
}

/** Centavos → decimal em número (o GA4 aceita number; 3970 → 39.7). */
export function paraItemGa4(item: ItemAnalytics): ItemGa4 {
  return {
    item_id: item.id,
    item_name: item.nome,
    price: valorDecimal(item.precoCentavos),
    quantity: item.quantidade,
    ...(item.variante ? { item_variant: item.variante } : {}),
  };
}

function disparar(nome: string, parametros: Record<string, unknown>): void {
  const gtag = janela()?.gtag;
  if (typeof gtag !== "function") return;
  gtag("event", nome, parametros);
}

/** O item entrou na sacola (PainelCompra da PDP, CardKit da PLP). */
export function eventoAddToCart(item: ItemAnalytics): void {
  disparar("add_to_cart", {
    currency: "BRL",
    value: valorDecimal(item.precoCentavos * item.quantidade),
    items: [paraItemGa4(item)],
  });
}

/** A pessoa saiu da sacola rumo ao checkout. */
export function eventoBeginCheckout(itens: ItemAnalytics[]): void {
  disparar("begin_checkout", {
    currency: "BRL",
    value: valorDecimal(
      itens.reduce((soma, i) => soma + i.precoCentavos * i.quantidade, 0),
    ),
    items: itens.map(paraItemGa4),
  });
}

/**
 * Compra fechada.
 *
 * PONTO DE DISPARO (Onda 2-D): a confirmação do checkout —
 * `concluir()` em app/(vitrine)/checkout/page.tsx, UMA vez por pedido (uma
 * ref barra StrictMode e re-render), com `transaction_id` = orderId real e
 * itens identificados pelo skuLoja (o mesmo id do add_to_cart e do
 * begin_checkout, senão o funil não fecha).
 *
 * PIX PENDENTE CONTA COMO PURCHASE, e isso é DELIBERADO: o pedido existe, o
 * estoque está reservado e a convenção do GA4 é medir na confirmação — não há
 * outra visita garantida (o QR se paga no app do banco, sem retorno ao site).
 * O custo é contar um Pix que expira sem pagamento; o inverso (esperar o
 * webhook) exigiria disparo server-side via Measurement Protocol, que não
 * existe nesta loja. Recusas de cartão NÃO disparam: `concluir()` sai antes.
 */
export function eventoPurchase(pedido: {
  idTransacao: string;
  valorCentavos: number;
  freteCentavos?: number;
  itens: ItemAnalytics[];
}): void {
  disparar("purchase", {
    transaction_id: pedido.idTransacao,
    currency: "BRL",
    value: valorDecimal(pedido.valorCentavos),
    ...(pedido.freteCentavos !== undefined
      ? { shipping: valorDecimal(pedido.freteCentavos) }
      : {}),
    items: pedido.itens.map(paraItemGa4),
  });
}
