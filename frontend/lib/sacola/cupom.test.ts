import { describe, expect, it, vi } from "vitest";
import { interpretarRespostaCupom, validarCupom } from "./cupom";

describe("interpretarRespostaCupom", () => {
  it("cupom válido: código, desconto em centavos e descrição", () => {
    expect(
      interpretarRespostaCupom({
        valido: true,
        codigo: "SERRA10",
        tipo: "percentual",
        valor: 10,
        descontoCentavos: 1097,
        descricao: "10% de desconto",
      }),
    ).toEqual({
      valido: true,
      cupom: { codigo: "SERRA10", descontoCentavos: 1097, descricao: "10% de desconto" },
    });
  });

  it("cupom inválido: repassa o motivo do servidor", () => {
    expect(
      interpretarRespostaCupom({ valido: false, motivo: "Este cupom expirou." }),
    ).toEqual({ valido: false, motivo: "Este cupom expirou." });
  });

  it("inválido sem motivo ganha uma frase honesta, não undefined na tela", () => {
    const r = interpretarRespostaCupom({ valido: false });
    expect(r.valido).toBe(false);
    if (!r.valido) expect(r.motivo.length).toBeGreaterThan(5);
  });

  it("desconto que não é inteiro ≥ 0 é recusado — dinheiro não viaja quebrado", () => {
    for (const desconto of [-1, 10.5, "1097", undefined, NaN]) {
      const r = interpretarRespostaCupom({
        valido: true,
        codigo: "X",
        descontoCentavos: desconto,
      });
      expect(r.valido, String(desconto)).toBe(false);
    }
  });

  it("resposta que não é objeto é recusada", () => {
    expect(interpretarRespostaCupom(null).valido).toBe(false);
    expect(interpretarRespostaCupom("erro").valido).toBe(false);
  });
});

describe("validarCupom", () => {
  const itens = [
    { product_id: "a1", quantity: 2 },
    { product_id: "b2", quantity: 1 },
  ];

  it("chama POST /cupons/validar com o contrato fixado (productId camelCase)", async () => {
    const fetchFalso = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ valido: true, codigo: "SERRA10", descontoCentavos: 500 }),
    });

    const r = await validarCupom("  serra10 ", itens, fetchFalso as unknown as typeof fetch);

    expect(r).toEqual({
      valido: true,
      cupom: { codigo: "SERRA10", descontoCentavos: 500, descricao: undefined },
    });

    const [url, init] = (fetchFalso as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(String(url).endsWith("/cupons/validar")).toBe(true);
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({
      codigo: "SERRA10",
      itens: [
        { productId: "a1", quantity: 2 },
        { productId: "b2", quantity: 1 },
      ],
    });
  });

  it("código vazio nem vai à rede", async () => {
    const fetchFalso = vi.fn();
    const r = await validarCupom("   ", itens, fetchFalso as unknown as typeof fetch);
    expect(r.valido).toBe(false);
    expect(fetchFalso).not.toHaveBeenCalled();
  });

  it("rede fora → inválido com frase honesta, sem exceção subindo à tela", async () => {
    const fetchFalso = vi.fn().mockRejectedValue(new Error("offline"));
    const r = await validarCupom("SERRA10", itens, fetchFalso as unknown as typeof fetch);
    expect(r.valido).toBe(false);
    if (!r.valido) expect(r.motivo).toMatch(/cupom/i);
  });

  it("resposta não-ok (rota ainda não existe, rate limit) → inválido honesto", async () => {
    const fetchFalso = vi.fn().mockResolvedValue({ ok: false, status: 404, json: async () => ({}) });
    const r = await validarCupom("SERRA10", itens, fetchFalso as unknown as typeof fetch);
    expect(r.valido).toBe(false);
  });
});
