import { describe, it, expect } from "vitest";
import { html } from "./html";

describe("html", () => {
  it("serializa um elemento em string", () => {
    expect(html(<p>oi</p>)).toBe("<p>oi</p>");
  });

  it("preserva atributos ARIA, que é o que a maioria das asserções lê", () => {
    expect(html(<button aria-label="Salvar" />)).toContain('aria-label="Salvar"');
  });
});
