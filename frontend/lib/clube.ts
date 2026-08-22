// Relativo, e não "@/": o alias vive só no tsconfig/Next — o Vitest não o
// resolve, e este módulo é coberto por clube.test.ts.
import { API_BASE } from "./api-base";
// O MESMO módulo de CPF do checkout (máscara + dígitos verificadores da
// Receita, coberto por cpf.test.ts): a adesão não reimplementa nada disso.
import { limparCpf } from "./cpf";
import type { Lote, Moagem, PesoGramas } from "./catalogo/tipos";
import type { Endereco } from "./sacola/checkout";

/**
 * Clube da Canastra — a lógica PURA do wizard de assinatura, separada da tela
 * (app/[locale]/(vitrine)/clube/AssinaturaWizard.tsx) para o Vitest fixá-la sem DOM.
 *
 * QUEM DECIDE DINHEIRO É O SERVIDOR. O `precoComDesconto` daqui existe para a
 * ETIQUETA do resumo; o backend recalcula os mesmos 10% sobre o preço do BANCO
 * e é esse número que o Mercado Pago cobra.
 *
 * AS DUAS CONTAS SÃO A MESMA EXPRESSÃO, e isso é literal: o ClubeController
 * converte o preço a centavos inteiros ANTES do desconto
 * (`round(preco_reais * 100)`) e só então faz `round(centavos * 0.9)` — o que
 * esta função faz. A versão anterior multiplicava em reais
 * (`round(preco_reais * 0.9 * 100)`) e o binário do float cobrava UM CENTAVO
 * A MENOS que a etiqueta em 947 de 200.000 preços (R$ 16,15 → 1453 lá, 1454
 * aqui). `clube.test.ts` varre a faixa inteira provando a igualdade, para o
 * dia em que alguém mexer numa das pontas.
 */

export const FREQUENCIAS_DIAS = [15, 30, 45] as const;
export type FrequenciaDias = (typeof FREQUENCIAS_DIAS)[number];

/**
 * O desconto do Clube. Espelho do DESCONTO_DO_CLUBE do ClubeController — que é
 * quem COBRA; este lado só exibe.
 *
 * É a ÚNICA fonte do lado da vitrine: o hero de /clube lê esta constante (lia
 * `assinatura.desconto` do catálogo, com fallback 0.1 — uma terceira verdade
 * capaz de anunciar 15% numa loja que cobra 10%). O campo do catálogo
 * continua marcando QUAIS linhas entram no Clube, e a prévia da PDP usa o
 * valor dele; `clube.test.ts` trava os dois no mesmo número.
 */
export const DESCONTO_DO_CLUBE = 0.1;

/** Preço de UM pacote com os 10% do Clube, em centavos inteiros. */
export function precoComDesconto(precoCentavos: number): number {
  return Math.round(precoCentavos * (1 - DESCONTO_DO_CLUBE));
}

/** O valor de cada cobrança: pacote com desconto × quantidade. */
export function precoPorEnvio(precoCentavos: number, quantidade: number): number {
  return precoComDesconto(precoCentavos) * quantidade;
}

/** Quanto o envio economiza sobre a compra avulsa — a linha "economia" do §7.4. */
export function economiaPorEnvio(precoCentavos: number, quantidade: number): number {
  return precoCentavos * quantidade - precoPorEnvio(precoCentavos, quantidade);
}

/** Uma combinação assinável: um pacote avulso (pacotes=1) de uma linha com Clube. */
export type VarianteDoClube = {
  /** SKU da LOJA (o que o backend procura em canastra.produtos.sku). */
  sku: string;
  moagem: Moagem;
  pesoGramas: PesoGramas;
  precoCentavos: number;
  estoque: number;
  /** Preço/estoque vieram do banco? Sem isso dá para navegar, não para assinar. */
  aoVivo: boolean;
};

export type OpcaoDoClube = {
  slug: string;
  nome: string;
  notas: string[];
  variantes: VarianteDoClube[];
};

/**
 * As linhas assináveis, no vocabulário do wizard. Só pacote avulso
 * (`pacotes === 1`): assinar uma caixa fechada seria outra oferta, e o
 * catálogo marca `assinatura` por LINHA, não por embalagem.
 */
export function opcoesDoClube(lotes: Lote[]): OpcaoDoClube[] {
  return lotes
    .filter((l) => l.assinatura)
    .map((l) => ({
      slug: l.slug,
      nome: l.nome,
      notas: l.notas,
      variantes: l.variantes
        .filter((v) => v.pacotes === 1)
        .map((v) => ({
          sku: v.skuLoja,
          moagem: v.moagem,
          pesoGramas: v.pesoGramas,
          precoCentavos: v.preco,
          estoque: v.estoque,
          aoVivo: Boolean(v.produtoId),
        })),
    }))
    .filter((o) => o.variantes.length > 0);
}

/** A variante exata de uma combinação, ou undefined (o wizard desabilita). */
export function varianteDoClube(
  opcao: OpcaoDoClube | undefined,
  moagem: Moagem,
  pesoGramas: PesoGramas,
): VarianteDoClube | undefined {
  return opcao?.variantes.find(
    (v) => v.moagem === moagem && v.pesoGramas === pesoGramas,
  );
}

/**
 * Pré-seleção vinda da PDP (`/clube?cafe=<slug>&moagem=<m>`): só aceita o que
 * existe de verdade nas opções — query inventada cai no padrão em silêncio,
 * nunca num estado inválido do wizard.
 */
export function preSelecaoDaQuery(
  params: { get(nome: string): string | null },
  opcoes: OpcaoDoClube[],
): { cafe?: string; moagem?: Moagem } {
  const resultado: { cafe?: string; moagem?: Moagem } = {};
  const cafe = params.get("cafe");
  const opcao = cafe ? opcoes.find((o) => o.slug === cafe) : undefined;
  if (opcao) resultado.cafe = opcao.slug;

  const moagem = params.get("moagem");
  const alvo = opcao ?? opcoes[0];
  if (moagem && alvo?.variantes.some((v) => v.moagem === moagem)) {
    resultado.moagem = moagem as Moagem;
  }
  return resultado;
}

export type CorpoDeAssinatura = {
  sku: string;
  quantidade: number;
  frequenciaDias: FrequenciaDias;
  /**
   * Só dígitos. É o dado da NOTA FISCAL de cada envio: toda cobrança do Clube
   * vira pedido de venda no Bling, e o ERP recusa pedido sem contato
   * identificado — sem CPF a assinatura cobra e nunca emite nota.
   *
   * OPCIONAL no contrato de propósito: quem já tem CPF no cadastro (comprou
   * avulso antes, por exemplo) não precisa redigitar, e o servidor usa o da
   * conta. A chave é OMITIDA quando não há número — mandar `""` seria dizer
   * "o CPF é vazio", que é diferente de "não informei".
   */
  cpf?: string;
  endereco: Endereco;
};

/**
 * O corpo do POST /clube/assinar — exatamente o contrato do backend, montado
 * num lugar só. Note o que NÃO viaja: preço. O desconto exibido é cortesia; o
 * servidor recalcula do banco.
 */
export function montarCorpoDeAssinatura(dados: {
  variante: VarianteDoClube;
  quantidade: number;
  frequenciaDias: FrequenciaDias;
  cpf?: string;
  endereco: Endereco;
}): CorpoDeAssinatura {
  // A máscara fica na tela; o que viaja são dígitos, como no checkout.
  const cpf = limparCpf(dados.cpf ?? "");
  return {
    sku: dados.variante.sku,
    quantidade: dados.quantidade,
    frequenciaDias: dados.frequenciaDias,
    ...(cpf ? { cpf } : {}),
    endereco: dados.endereco,
  };
}

export type AssinaturaDaConta = {
  id: string;
  sku: string;
  nome_cafe: string;
  quantidade: number;
  frequencia_dias: number;
  preco_centavos: number;
  status: "pendente" | "ativa" | "pausada" | "cancelada" | string;
  criado_em: string;
  cancelada_em: string | null;
};

function cabecalhos(token: string) {
  return {
    "Content-Type": "application/json",
    Authorization: `Bearer ${token}`,
  };
}

/**
 * Cria a assinatura e devolve a URL de aprovação do MP (`initPoint`) — é LÁ
 * que o cliente autoriza a cobrança recorrente; sem o redirect ela fica
 * pendente para sempre.
 */
export async function assinarClube(
  token: string,
  corpo: CorpoDeAssinatura,
  fetchFn: typeof fetch = fetch,
): Promise<{ initPoint: string }> {
  const r = await fetchFn(`${API_BASE}/clube/assinar`, {
    method: "POST",
    credentials: "include",
    headers: cabecalhos(token),
    body: JSON.stringify(corpo),
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) {
    throw new Error(d.details || d.error || "Não foi possível criar a assinatura.");
  }
  if (typeof d.initPoint !== "string" || !d.initPoint) {
    throw new Error(
      "A assinatura foi criada mas não recebemos a página de autorização. " +
        "Confira em Minha conta antes de tentar de novo.",
    );
  }
  return { initPoint: d.initPoint };
}

export async function listarAssinaturas(
  token: string,
  fetchFn: typeof fetch = fetch,
): Promise<AssinaturaDaConta[]> {
  const r = await fetchFn(`${API_BASE}/clube/assinaturas`, {
    credentials: "include",
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!r.ok) throw new Error("Não foi possível carregar suas assinaturas.");
  const d = await r.json();
  return Array.isArray(d) ? d : [];
}

export async function cancelarAssinatura(
  token: string,
  id: string,
  fetchFn: typeof fetch = fetch,
): Promise<void> {
  const r = await fetchFn(`${API_BASE}/clube/assinaturas/${id}/cancelar`, {
    method: "POST",
    credentials: "include",
    headers: cabecalhos(token),
  });
  if (!r.ok) {
    const d = await r.json().catch(() => ({}));
    throw new Error(d.details || d.error || "Não foi possível cancelar agora.");
  }
}

/** Rótulos de exibição do status da assinatura — conta e painel falam igual. */
export const STATUS_DA_ASSINATURA: Record<string, string> = {
  pendente: "Aguardando autorização",
  ativa: "Ativa",
  pausada: "Pausada",
  cancelada: "Cancelada",
};
