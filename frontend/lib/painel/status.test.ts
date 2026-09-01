import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { STATUS_DE_PEDIDO, rotuloDoStatus, tomDoStatus } from "./status";

describe("STATUS_DE_PEDIDO", () => {
  /**
   * O teste que importa: a lista do painel COMPARADA COM A DO BACKEND, lida do
   * disco. O backend recusa com 400 qualquer valor fora de STATUS_VALIDOS, e o
   * CHECK da migração 0009 recusa no banco. Uma divergência aqui quebra toda
   * mudança de status — e não aparece em `next build` nem em `tsc`.
   */
  it("tem exatamente os mesmos valores de backend/src/utils/statusDePedido.js", () => {
    const fonte = readFileSync(
      join(__dirname, "..", "..", "..", "backend", "src", "utils", "statusDePedido.js"),
      "utf8",
    );
    const bloco = fonte.match(/STATUS_VALIDOS\s*=\s*Object\.freeze\(\[([\s\S]*?)\]\)/);
    expect(bloco).not.toBeNull();
    const doBackend = [...bloco![1].matchAll(/"([a-z_]+)"/g)].map((m) => m[1]);

    expect(STATUS_DE_PEDIDO.map((s) => s.valor)).toEqual(doBackend);
  });

  it("todo status tem rótulo em português", () => {
    for (const s of STATUS_DE_PEDIDO) {
      expect(s.rotulo.length).toBeGreaterThan(0);
      expect(s.rotulo).not.toBe(s.valor);
    }
  });
});

describe("rotuloDoStatus", () => {
  it("traduz valor conhecido", () => {
    expect(rotuloDoStatus("em_processamento")).toBe("Em processamento");
  });

  it("devolve o próprio valor para desconhecido, em vez de esconder", () => {
    expect(rotuloDoStatus("inventado")).toBe("inventado");
  });
});

describe("tomDoStatus", () => {
  it("cancelado, rejeitado e reembolsado são o tom de erro", () => {
    expect(tomDoStatus("cancelado")).toBe("erro");
    expect(tomDoStatus("rejeitado")).toBe("erro");
    expect(tomDoStatus("reembolsado")).toBe("erro");
  });
  it("entregue é sucesso", () => {
    expect(tomDoStatus("entregue")).toBe("sucesso");
  });
  it("pendente é alerta", () => {
    expect(tomDoStatus("pendente")).toBe("alerta");
  });
});
