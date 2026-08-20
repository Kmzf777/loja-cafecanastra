import { describe, expect, it, vi } from "vitest";
import {
  buscarCep,
  cepCompleto,
  formatarCep,
  interpretarViaCep,
  limparCep,
} from "./cep";

describe("limparCep / formatarCep / cepCompleto", () => {
  it("descarta o que não é dígito e corta em 8", () => {
    expect(limparCep("37928-000x")).toBe("37928000");
    expect(limparCep("379280001234")).toBe("37928000");
  });

  it("máscara progressiva 00000-000", () => {
    expect(formatarCep("3")).toBe("3");
    expect(formatarCep("37928")).toBe("37928");
    expect(formatarCep("379280")).toBe("37928-0");
    expect(formatarCep("37928000")).toBe("37928-000");
    expect(formatarCep("37928-000")).toBe("37928-000");
  });

  it("cepCompleto exige os 8 dígitos", () => {
    expect(cepCompleto("37928-000")).toBe(true);
    expect(cepCompleto("37928-00")).toBe(false);
    expect(cepCompleto("")).toBe(false);
  });
});

describe("interpretarViaCep", () => {
  it("mapeia logradouro/bairro/localidade/uf para o vocabulário do endereço", () => {
    expect(
      interpretarViaCep({
        logradouro: "Praça Monsenhor José Luiz Rocha",
        bairro: "Centro",
        localidade: "São Roque de Minas",
        uf: "MG",
      }),
    ).toEqual({
      street: "Praça Monsenhor José Luiz Rocha",
      neighborhood: "Centro",
      city: "São Roque de Minas",
      state: "MG",
    });
  });

  it("CEP inexistente ({erro: true}) devolve null — o ViaCEP responde 200 mesmo assim", () => {
    expect(interpretarViaCep({ erro: true })).toBeNull();
    expect(interpretarViaCep({ erro: "true" })).toBeNull();
  });

  it("resposta que não é objeto devolve null", () => {
    expect(interpretarViaCep(null)).toBeNull();
    expect(interpretarViaCep("html de erro")).toBeNull();
  });

  it("campos ausentes viram string vazia — CEP de cidade sem logradouro por CEP", () => {
    expect(interpretarViaCep({ localidade: "Vargem Bonita", uf: "MG" })).toEqual({
      street: "",
      neighborhood: "",
      city: "Vargem Bonita",
      state: "MG",
    });
  });
});

describe("buscarCep", () => {
  it("consulta o ViaCEP com o CEP limpo e devolve o endereço interpretado", async () => {
    const fetchFalso = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ logradouro: "Rua A", bairro: "B", localidade: "C", uf: "MG" }),
    });
    const endereco = await buscarCep("37928-000", fetchFalso as unknown as typeof fetch);
    expect(fetchFalso).toHaveBeenCalledWith("https://viacep.com.br/ws/37928000/json/");
    expect(endereco).toEqual({ street: "Rua A", neighborhood: "B", city: "C", state: "MG" });
  });

  it("CEP incompleto nem vai à rede", async () => {
    const fetchFalso = vi.fn();
    expect(await buscarCep("37928", fetchFalso as unknown as typeof fetch)).toBeNull();
    expect(fetchFalso).not.toHaveBeenCalled();
  });

  it("falha de rede é silenciosa: null, e o preenchimento manual segue", async () => {
    const fetchFalso = vi.fn().mockRejectedValue(new Error("offline"));
    expect(await buscarCep("37928000", fetchFalso as unknown as typeof fetch)).toBeNull();
  });

  it("resposta não-ok é silenciosa: null", async () => {
    const fetchFalso = vi.fn().mockResolvedValue({ ok: false, json: async () => ({}) });
    expect(await buscarCep("37928000", fetchFalso as unknown as typeof fetch)).toBeNull();
  });
});
