import { afterEach, describe, expect, it, vi } from "vitest";
import {
  FRETE_GRATIS_PADRAO_CENTAVOS,
  _limparCacheConfig,
  freteGratisMinimoCentavos,
} from "./config-loja";

afterEach(() => {
  _limparCacheConfig();
  vi.useRealTimers();
});

function fetchComValor(valor: unknown) {
  return vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ frete_gratis_minimo_centavos: valor }),
  }) as unknown as typeof fetch & ReturnType<typeof vi.fn>;
}

describe("freteGratisMinimoCentavos", () => {
  it("lê o valor real de GET /config", async () => {
    const f = fetchComValor(20000);
    expect(await freteGratisMinimoCentavos(f)).toBe(20000);
    const url = String((f as ReturnType<typeof vi.fn>).mock.calls[0][0]);
    expect(url.endsWith("/config")).toBe(true);
  });

  it("guarda em cache de módulo: a segunda chamada não volta à rede", async () => {
    const f = fetchComValor(20000);
    await freteGratisMinimoCentavos(f);
    await freteGratisMinimoCentavos(f);
    expect(f).toHaveBeenCalledTimes(1);
  });

  it("o cache expira em 5 minutos", async () => {
    vi.useFakeTimers();
    const f = fetchComValor(20000);
    await freteGratisMinimoCentavos(f);
    vi.advanceTimersByTime(5 * 60_000 + 1);
    await freteGratisMinimoCentavos(f);
    expect(f).toHaveBeenCalledTimes(2);
  });

  it("API fora → fallback 14900, e a falha NÃO fica em cache (a próxima tenta de novo)", async () => {
    const f = vi.fn().mockRejectedValue(new Error("offline")) as unknown as typeof fetch &
      ReturnType<typeof vi.fn>;
    expect(await freteGratisMinimoCentavos(f)).toBe(FRETE_GRATIS_PADRAO_CENTAVOS);
    expect(await freteGratisMinimoCentavos(f)).toBe(14900);
    expect(f).toHaveBeenCalledTimes(2);
  });

  it("resposta não-ok → fallback", async () => {
    const f = vi.fn().mockResolvedValue({ ok: false, json: async () => ({}) });
    expect(await freteGratisMinimoCentavos(f as unknown as typeof fetch)).toBe(14900);
  });

  it("valor ausente ou inválido no corpo → fallback (não NaN)", async () => {
    expect(await freteGratisMinimoCentavos(fetchComValor(undefined))).toBe(14900);
    _limparCacheConfig();
    expect(await freteGratisMinimoCentavos(fetchComValor("abc"))).toBe(14900);
  });

  it("0 explícito significa frete grátis DESLIGADO → null, e as barras somem", async () => {
    // No servidor, 0 desliga o frete grátis de propósito (ShippingController).
    // Prometer "frete grátis acima de R$ 149" com a regra desligada seria
    // propaganda falsa — pior que não mostrar barra nenhuma.
    expect(await freteGratisMinimoCentavos(fetchComValor(0))).toBeNull();
  });
});
