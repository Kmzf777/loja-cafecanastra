/**
 * Configuração pública da loja — hoje, o piso do frete grátis.
 *
 * FRETE GRÁTIS É REGRA DE SERVIDOR (decisão 3 do plano mestre): quem zera o
 * frete é o ShippingController lendo `canastra.config_loja`. Este módulo só
 * pergunta o piso para as SUPERFÍCIES DE EXIBIÇÃO — a barra do Cabeçalho e a
 * barra de progresso da sacola/checkout. Nenhuma decisão de dinheiro sai
 * daqui: se este valor divergir do servidor por causa do cache, o pior caso é
 * a barra prometer um piso de até cinco minutos atrás, e o checkout cobrar o
 * certo.
 *
 * CACHE DE MÓDULO, 5 MINUTOS: o Cabeçalho aparece em toda página e a barra de
 * progresso re-renderiza a cada item na sacola — sem cache seria um GET
 * /config por navegação. Só SUCESSO entra no cache; falha devolve o fallback e
 * a próxima chamada tenta de novo (uma queda de 2 s da API não pode congelar o
 * fallback por 5 minutos).
 *
 * TRÊS RESPOSTAS POSSÍVEIS, e a diferença é deliberada:
 *  - inteiro > 0 ......... o piso real, vindo do banco;
 *  - `null` .............. o servidor disse `0`, que DESLIGA o frete grátis
 *                          (ShippingController trata 0 assim de propósito).
 *                          As barras somem — prometer frete grátis com a regra
 *                          desligada é propaganda falsa;
 *  - fallback 14900 ...... a API falhou ou respondeu sem o campo. É o default
 *                          da migração 0009, o mesmo número que o servidor
 *                          usaria numa instalação recém-semeada.
 */

import { API_BASE } from "./api-base";

/** Default da migração 0009 — o que o servidor usa quando ninguém mexeu. */
export const FRETE_GRATIS_PADRAO_CENTAVOS = 14900;

const VALIDADE_MS = 5 * 60_000;

let cache: { valor: number | null; expiraEm: number } | null = null;

/** Só para os testes: o cache é de módulo e sobreviveria entre casos. */
export function _limparCacheConfig(): void {
  cache = null;
}

export async function freteGratisMinimoCentavos(
  fetchFn: typeof fetch = fetch,
): Promise<number | null> {
  if (cache && Date.now() < cache.expiraEm) return cache.valor;

  try {
    const r = await fetchFn(`${API_BASE}/config`);
    if (!r.ok) return FRETE_GRATIS_PADRAO_CENTAVOS;

    const corpo = (await r.json()) as { frete_gratis_minimo_centavos?: unknown };
    const bruto = Number(corpo?.frete_gratis_minimo_centavos);

    let valor: number | null;
    if (Number.isInteger(bruto) && bruto > 0) {
      valor = bruto;
    } else if (bruto === 0) {
      valor = null; // desligado de propósito — ver o cabeçalho
    } else {
      return FRETE_GRATIS_PADRAO_CENTAVOS; // campo ausente/estranho: não cacheia
    }

    cache = { valor, expiraEm: Date.now() + VALIDADE_MS };
    return valor;
  } catch {
    return FRETE_GRATIS_PADRAO_CENTAVOS;
  }
}
