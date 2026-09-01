import { describe, it, expect, afterEach } from "vitest";
import { cleanup } from "@testing-library/react";
import { html } from "@/lib/teste/html";
import { renderizar } from "@/lib/teste/renderizar";
import { Botao } from "./Botao";

/** `renderizar` nao limpa sozinho: o auto-cleanup do testing-library so se
 *  registra quando `globals: true`, e o vitest.config.ts do repositorio nao o
 *  liga. Sem isto o segundo `getByRole("button")` do arquivo acha dois. */
afterEach(cleanup);

describe("Botao", () => {
  it("type é 'button' por padrão — sem isso um filtro dentro de <form> salva o formulário", () => {
    expect(html(<Botao>Filtrar</Botao>)).toContain('type="button"');
  });

  it("quem quer submeter pede submit — a exceção é explícita, não o padrão", () => {
    expect(html(<Botao type="submit">Salvar</Botao>)).toContain('type="submit"');
  });

  it("mostra o rótulo recebido", () => {
    expect(html(<Botao>Arquivar produto</Botao>)).toContain("Arquivar produto");
  });

  it("a primária é fuligem sólido, e nunca vermelha (R21)", () => {
    const saida = html(<Botao variante="primaria">Salvar</Botao>);
    expect(saida).toContain("bg-fuligem");
    expect(saida).not.toContain("vermelho");
  });

  it("a secundária é filete, sem preenchimento", () => {
    const saida = html(<Botao variante="secundaria">Cancelar</Botao>);
    expect(saida).toContain("border-fuligem-20");
    expect(saida).not.toMatch(/\bbg-fuligem\b/);
    expect(saida).not.toContain("vermelho");
  });

  /**
   * O teste que guarda o R11: "peso E cor diferentes". Se um dia alguém
   * transformar a destrutiva em `bg-vermelho` sólido, ela vira a primária com a
   * cor trocada — e passa a gritar mais alto que a ação que a pessoa veio
   * fazer, que é a inversão de hierarquia que o R11 proíbe.
   */
  it("a destrutiva NÃO é a primária com a cor trocada: é filete, não preenchimento", () => {
    const saida = html(<Botao variante="destrutiva">Excluir</Botao>);
    expect(saida).toContain("text-vermelho");
    expect(saida).toContain("border-vermelho");
    expect(saida).not.toContain("bg-vermelho");
  });

  it("desabilitado sai desabilitado e não dispara o clique", async () => {
    let cliques = 0;
    const { getByRole, usuario } = renderizar(
      <Botao disabled onClick={() => (cliques += 1)}>
        Salvar
      </Botao>,
    );
    const botao = getByRole("button");
    expect(botao.hasAttribute("disabled")).toBe(true);
    await usuario.click(botao);
    expect(cliques).toBe(0);
  });

  it("clique chama quem o deu", async () => {
    let cliques = 0;
    const { getByRole, usuario } = renderizar(<Botao onClick={() => (cliques += 1)}>Ir</Botao>);
    await usuario.click(getByRole("button"));
    expect(cliques).toBe(1);
  });

  it("aceita as props nativas de <button> — aria-* inclusive", () => {
    const saida = html(
      <Botao aria-describedby="ajuda-1" name="acao" value="arquivar">
        Arquivar
      </Botao>,
    );
    expect(saida).toContain('aria-describedby="ajuda-1"');
    expect(saida).toContain('name="acao"');
  });

  it("o alvo de toque é de 44px em toda variante — R22 comprime padding, não alvo", () => {
    for (const variante of ["primaria", "secundaria", "destrutiva"] as const) {
      expect(html(<Botao variante={variante}>x</Botao>)).toContain("min-h-11");
    }
  });
});
