import { describe, it, expect } from "vitest";
import { renderizar } from "@/lib/teste/renderizar";
import { Botao } from "../ui/Botao";
import { Cabecalho } from "./Cabecalho";

describe("Cabecalho", () => {
  it("o título da página é o <h1> — um só, e o primeiro cabeçalho da tela", () => {
    const { container } = renderizar(<Cabecalho titulo="Pedidos" />);
    const h1s = [...container.querySelectorAll("h1")];
    expect(h1s).toHaveLength(1);
    expect(h1s[0].textContent).toBe("Pedidos");
  });

  it("a descrição é opcional e não deixa um parágrafo vazio quando falta", () => {
    const { container } = renderizar(<Cabecalho titulo="Início" />);
    for (const p of container.querySelectorAll("header > div > div > p")) {
      expect(p.textContent?.trim()).not.toBe("");
    }
  });

  /**
   * R18 — a ação primária tem um lugar e é sempre o mesmo. O teste amarra o
   * que dá para amarrar sem um navegador: ela está DENTRO do cabeçalho e DEPOIS
   * do título na ordem do documento. Isso já impede a regressão real, que é
   * cada tela desenhar o seu botão onde couber.
   */
  it("a ação primária mora no cabeçalho, depois do título", () => {
    const { container } = renderizar(
      <Cabecalho titulo="Produtos" acao={<Botao>Novo produto</Botao>} />,
    );
    const h1 = container.querySelector("h1")!;
    const botao = [...container.querySelectorAll("header button")].find((b) =>
      b.textContent?.includes("Novo produto"),
    );
    expect(botao).toBeDefined();
    expect(
      h1.compareDocumentPosition(botao!) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("diz em nome de quem se está trabalhando", () => {
    const { container } = renderizar(
      <Cabecalho titulo="Início" email="gestao@cafecanastra.com" />,
    );
    expect(container.textContent).toContain("gestao@cafecanastra.com");
    expect(container.textContent).toContain("Conectado como");
  });

  /**
   * Sem e-mail não se inventa identidade. "Conectado como —" ou um avatar mudo
   * seriam a tela afirmando com confiança algo que ela não sabe, que é o mesmo
   * defeito que o <EstadoDaTela> existe para evitar nas listas.
   */
  it("sem e-mail, não escreve nada no lugar", () => {
    const { container } = renderizar(<Cabecalho titulo="Início" />);
    expect(container.textContent).not.toContain("Conectado como");
  });

  /**
   * O botão que o painel legado nunca teve, e que é queixa registrada no mapa
   * do terreno: sem ele, a única saída é fechar a aba — e num computador
   * compartilhado a sessão do gestor fica de pé.
   */
  it("dá para sair do painel daqui, em qualquer tela", () => {
    const { container } = renderizar(<Cabecalho titulo="Relatórios" />);
    const sair = [...container.querySelectorAll("button")].find(
      (b) => b.textContent?.trim() === "Sair",
    );
    expect(sair).toBeDefined();
  });
});
