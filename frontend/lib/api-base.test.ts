import { describe, expect, it } from "vitest";
import { resolverApiBase } from "./api-base";

/**
 * O caso que motivou este arquivo está em `api-base.ts`: com
 * `NEXT_PUBLIC_API_URL=/api`, o `fetch` do Node recusa a URL relativa e TODA
 * leitura server-side do painel vira "A API não respondeu" — com a API de pé e
 * o log dela vazio.
 *
 * A regra é testada como função pura porque a constante lê `process.env` e
 * `window` no import: exercitá-la exigiria `vi.resetModules()` a cada caso e um
 * `window` de mentira, e o que se quer afirmar é a PRECEDÊNCIA, não o
 * mecanismo de import do Vite.
 */
describe("resolverApiBase", () => {
  const RELATIVA = "/api";
  const INTERNA = "http://api:3333";

  it("no navegador usa o valor do build, mesmo relativo — é o caso de produção", () => {
    expect(
      resolverApiBase({ noNavegador: true, doBuild: RELATIVA, interna: INTERNA }),
    ).toBe(RELATIVA);
  });

  it("no servidor prefere a interna: é ela que torna a URL absoluta", () => {
    expect(
      resolverApiBase({ noNavegador: false, doBuild: RELATIVA, interna: INTERNA }),
    ).toBe(INTERNA);
  });

  it("no servidor sem interna cai no valor do build — sem conserto possível aqui", () => {
    // Não é um caso desejável: é o estado que produzia o defeito. Fica no teste
    // para que a mudança de comportamento seja deliberada, e não acidental.
    expect(
      resolverApiBase({ noNavegador: false, doBuild: RELATIVA, interna: undefined }),
    ).toBe(RELATIVA);
  });

  it("no servidor sem interna, um valor de build ABSOLUTO continua servindo", () => {
    // `next start` na mão, apontando para uma API em outra máquina.
    expect(
      resolverApiBase({
        noNavegador: false,
        doBuild: "https://api.exemplo.com",
        interna: undefined,
      }),
    ).toBe("https://api.exemplo.com");
  });

  it("tira a barra final dos dois lados, para não montar `//caminho`", () => {
    expect(
      resolverApiBase({
        noNavegador: true,
        doBuild: "https://api.exemplo.com/",
        interna: undefined,
      }),
    ).toBe("https://api.exemplo.com");
    expect(
      resolverApiBase({
        noNavegador: false,
        doBuild: RELATIVA,
        interna: "http://api:3333/",
      }),
    ).toBe("http://api:3333");
  });

  it("sem nenhuma das duas, o fallback de desenvolvimento", () => {
    expect(
      resolverApiBase({ noNavegador: true, doBuild: undefined, interna: undefined }),
    ).toBe("http://localhost:3333");
    expect(
      resolverApiBase({ noNavegador: false, doBuild: "", interna: "" }),
    ).toBe("http://localhost:3333");
  });
});
