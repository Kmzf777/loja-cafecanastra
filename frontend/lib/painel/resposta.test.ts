import { describe, it, expect } from "vitest";
import { lerCorpo, fraseDeErro } from "./resposta";

function resposta(status: number, corpo?: string): Response {
  return new Response(corpo ?? null, { status });
}

describe("lerCorpo", () => {
  it("devolve objeto vazio quando o corpo é vazio (o caso do 401)", async () => {
    expect(await lerCorpo(resposta(401))).toEqual({});
  });

  it("devolve objeto vazio quando o corpo não é JSON", async () => {
    expect(await lerCorpo(resposta(500, "<html>502 Bad Gateway</html>"))).toEqual({});
  });

  it("devolve o JSON quando há JSON", async () => {
    expect(await lerCorpo(resposta(409, '{"message":"Já existe um produto com este SKU."}')))
      .toEqual({ message: "Já existe um produto com este SKU." });
  });
});

describe("fraseDeErro", () => {
  it("prefere `message`, que é a frase que o servidor escreveu", () => {
    expect(fraseDeErro(409, { message: "Já existe um produto com este SKU." }))
      .toBe("Já existe um produto com este SKU.");
  });

  it("cai em `error` quando não há `message` — o backend usa os dois campos", () => {
    expect(fraseDeErro(400, { error: "Informe um e-mail válido." }))
      .toBe("Informe um e-mail válido.");
  });

  it("explica o 401 de corpo vazio em vez de dizer 'erro'", () => {
    expect(fraseDeErro(401, {})).toMatch(/sess/i);
  });

  it("explica o 403 SEM sugerir que a sessão expirou", () => {
    const frase = fraseDeErro(403, {});
    expect(frase).toMatch(/permiss/i);
    expect(frase).not.toMatch(/sess/i);
  });

  it("não devolve string vazia para status desconhecido", () => {
    expect(fraseDeErro(418, {}).length).toBeGreaterThan(0);
  });
});
