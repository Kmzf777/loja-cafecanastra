import { describe, expect, it } from "vitest";
import { traduzirErroMp } from "./cartao";

/**
 * Só a parte PURA do módulo é testada aqui: a tradução de erro por código.
 * O resto (script tag do SDK, CardForm) é DOM e depende do iframe do Mercado
 * Pago — não há como exercitá-lo em ambiente node sem dublar o SDK inteiro.
 */
describe("traduzirErroMp", () => {
  it("traduz pelo CÓDIGO, ignorando o texto em inglês do gateway", () => {
    const erro = [{ code: "E301", description: "invalid parameter cardNumber" }];
    const frase = traduzirErroMp(erro);
    expect(frase).toMatch(/número do cartão/i);
    expect(frase).not.toMatch(/invalid parameter/);
  });

  it("aceita os três formatos em que o SDK entrega a causa", () => {
    // Array de causas, objeto com `cause`, objeto com `code` direto.
    expect(traduzirErroMp([{ code: "224" }])).toMatch(/código de segurança/i);
    expect(traduzirErroMp({ cause: [{ code: "224" }] })).toMatch(/código de segurança/i);
    expect(traduzirErroMp({ code: "224" })).toMatch(/código de segurança/i);
  });

  it("cobre os códigos de campo obrigatório e de valor inválido", () => {
    expect(traduzirErroMp({ code: "205" })).toMatch(/número do cartão/i);
    expect(traduzirErroMp({ code: "208" })).toMatch(/validade/i);
    expect(traduzirErroMp({ code: "221" })).toMatch(/nome/i);
    expect(traduzirErroMp({ code: "214" })).toMatch(/CPF/);
    expect(traduzirErroMp({ code: "324" })).toMatch(/CPF/);
    expect(traduzirErroMp({ code: "E302" })).toMatch(/código de segurança/i);
    expect(traduzirErroMp({ code: "326" })).toMatch(/validade/i);
  });

  it("código desconhecido cai num fallback honesto em português", () => {
    for (const erro of [{ code: "999" }, "string solta", null, undefined, {}]) {
      const frase = traduzirErroMp(erro);
      expect(frase).toMatch(/cartão/i);
      expect(frase.length).toBeGreaterThan(20);
    }
  });
});
