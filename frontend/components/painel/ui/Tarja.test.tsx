import { describe, it, expect, afterEach } from "vitest";
import { cleanup } from "@testing-library/react";
import { html } from "@/lib/teste/html";
import { renderizar } from "@/lib/teste/renderizar";
import { Tarja } from "./Tarja";

afterEach(cleanup);

describe("Tarja", () => {
  it("erro usa role=alert, que interrompe o leitor de tela", () => {
    expect(html(<Tarja tom="erro">falhou</Tarja>)).toContain('role="alert"');
  });

  it("os demais tons usam role=status, que não interrompe", () => {
    expect(html(<Tarja tom="sucesso">salvo</Tarja>)).toContain('role="status"');
    expect(html(<Tarja tom="alerta">atenção</Tarja>)).toContain('role="status"');
    expect(html(<Tarja tom="aviso">nota</Tarja>)).toContain('role="status"');
  });

  it("mostra a frase recebida — ela é o diagnóstico", () => {
    expect(html(<Tarja>Já existe um produto com este SKU.</Tarja>)).toContain(
      "Já existe um produto com este SKU.",
    );
  });

  it("sem onFechar não desenha botão de fechar", () => {
    expect(html(<Tarja>x</Tarja>)).not.toContain("Fechar aviso");
  });

  it("o botão de fechar é type=button — dentro de <form> um type ausente submete", () => {
    const saida = html(
      <Tarja onFechar={() => {}}>x</Tarja>,
    );
    expect(saida).toContain('type="button"');
    expect(saida).toContain('aria-label="Fechar aviso"');
  });

  it("fechar chama o que recebeu, e só quando é clicado", async () => {
    let fechou = 0;
    const { getByRole, usuario } = renderizar(
      <Tarja onFechar={() => (fechou += 1)}>x</Tarja>,
    );
    expect(fechou).toBe(0);
    await usuario.click(getByRole("button", { name: "Fechar aviso" }));
    expect(fechou).toBe(1);
  });
});
