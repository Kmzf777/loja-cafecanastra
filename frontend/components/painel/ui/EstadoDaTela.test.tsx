import { describe, it, expect, afterEach } from "vitest";
import { cleanup } from "@testing-library/react";
import { html } from "@/lib/teste/html";
import { renderizar } from "@/lib/teste/renderizar";
import { EstadoDaTela } from "./EstadoDaTela";

const base = {
  esqueleto: <p>carregando…</p>,
  vazioTitulo: "Nenhum produto ainda",
  vazioTexto: "Cadastre o primeiro café.",
  children: <table />,
};

afterEach(cleanup);

describe("EstadoDaTela", () => {
  it("carregando ganha o esqueleto e mais nada", () => {
    const saida = html(<EstadoDaTela {...base} carregando erro={null} vazio={false} />);
    expect(saida).toContain("carregando…");
    expect(saida).not.toContain("<table");
  });

  it("carregando vence até quando já há erro — a ordem das guardas é a regra", () => {
    const saida = html(<EstadoDaTela {...base} carregando erro="caiu" vazio />);
    expect(saida).toContain("carregando…");
    expect(saida).not.toContain("caiu");
  });

  it("ERRO COM LISTA VAZIA mostra o erro, NUNCA o estado vazio", () => {
    const saida = html(
      <EstadoDaTela {...base} carregando={false} erro="Não foi possível carregar." vazio />,
    );
    expect(saida).toContain("Não foi possível carregar.");
    expect(saida).not.toContain("Nenhum produto ainda");
  });

  it("erro com filtro ativo continua sendo erro, não 'nenhum resultado'", () => {
    const saida = html(
      <EstadoDaTela {...base} carregando={false} erro="A rede caiu." vazio filtroAtivo />,
    );
    expect(saida).toContain("A rede caiu.");
    expect(saida).not.toContain("Nenhum resultado para este filtro.");
  });

  it("o erro é anunciado como alert — ele interrompe", () => {
    const saida = html(<EstadoDaTela {...base} carregando={false} erro="caiu" vazio={false} />);
    expect(saida).toContain('role="alert"');
  });

  it("sem aoTentarDeNovo não oferece um botão que não faz nada", () => {
    const saida = html(<EstadoDaTela {...base} carregando={false} erro="caiu" vazio={false} />);
    expect(saida).not.toContain("Tentar de novo");
  });

  it("vazio com filtro ativo oferece limpar, e não ensina a cadastrar", () => {
    const saida = html(<EstadoDaTela {...base} carregando={false} erro={null} vazio filtroAtivo />);
    expect(saida).toContain("Nenhum resultado para este filtro.");
    expect(saida).not.toContain("Nenhum produto ainda");
  });

  it("vazio de verdade ensina o próximo passo", () => {
    const saida = html(<EstadoDaTela {...base} carregando={false} erro={null} vazio />);
    expect(saida).toContain("Nenhum produto ainda");
    expect(saida).toContain("Cadastre o primeiro café.");
  });

  it("com conteúdo, desenha o conteúdo", () => {
    const saida = html(<EstadoDaTela {...base} carregando={false} erro={null} vazio={false} />);
    expect(saida).toContain("<table");
  });

  it("tentar de novo e limpar filtro chamam quem os deu — e são type=button", async () => {
    let tentou = 0;
    const tela = renderizar(
      <EstadoDaTela
        {...base}
        carregando={false}
        erro="caiu"
        vazio={false}
        aoTentarDeNovo={() => (tentou += 1)}
      />,
    );
    const botao = tela.getByRole("button", { name: "Tentar de novo" });
    expect(botao.getAttribute("type")).toBe("button");
    await tela.usuario.click(botao);
    expect(tentou).toBe(1);

    let limpou = 0;
    const filtrada = renderizar(
      <EstadoDaTela
        {...base}
        carregando={false}
        erro={null}
        vazio
        filtroAtivo
        aoLimparFiltro={() => (limpou += 1)}
      />,
    );
    await filtrada.usuario.click(filtrada.getByRole("button", { name: "Limpar filtros" }));
    expect(limpou).toBe(1);
  });
});
