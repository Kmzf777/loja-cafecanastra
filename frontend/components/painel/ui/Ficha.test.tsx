import { describe, it, expect } from "vitest";
import { html } from "@/lib/teste/html";
import { Ficha } from "./Ficha";

describe("Ficha", () => {
  it("desenha o conteúdo que recebe", () => {
    expect(html(<Ficha>Doze pedidos aguardando</Ficha>)).toContain("Doze pedidos aguardando");
  });

  it("a superfície é cal-pura com filete, e a profundidade NUNCA é sombra", () => {
    const saida = html(<Ficha>x</Ficha>);
    expect(saida).toContain("bg-cal-puro");
    expect(saida).toContain("border-fuligem-20");
    expect(saida).not.toContain("shadow");
  });

  it("sem título não inventa cabeçalho nem heading", () => {
    const saida = html(<Ficha>x</Ficha>);
    expect(saida).not.toContain("<h2");
    expect(saida).not.toContain("<h3");
  });

  it("com título vira <h2> — o nível padrão abaixo do <h1> da página", () => {
    const saida = html(<Ficha titulo="Pedidos de hoje">x</Ficha>);
    expect(saida).toContain("<h2");
    expect(saida).toContain("Pedidos de hoje");
  });

  /**
   * Nível ajustável porque a Ficha não sabe a que profundidade foi montada, e
   * pular de <h1> para <h3> — ou repetir <h2> dentro de <h2> — quebra a
   * navegação por cabeçalho, que é como quem usa leitor de tela percorre uma
   * tela densa sem ouvir tudo.
   */
  it("aceita outro nível de cabeçalho quando está aninhada", () => {
    const saida = html(
      <Ficha titulo="Itens" nivel={3}>
        x
      </Ficha>,
    );
    expect(saida).toContain("<h3");
    expect(saida).not.toContain("<h2");
  });

  /** Ficha com título é uma região nomeada: dá ao leitor de tela um ponto de
   *  salto entre os blocos de uma tela cheia deles. Sem título não há nome, e
   *  região sem nome só acrescenta ruído — então nem vira <section>. */
  it("com título vira uma região nomeada; sem título, não", () => {
    expect(html(<Ficha titulo="Resumo">x</Ficha>)).toContain('aria-label="Resumo"');
    expect(html(<Ficha>x</Ficha>)).not.toContain("<section");
  });

  it("o slot de ação vive no cabeçalho, junto do título", () => {
    const saida = html(
      <Ficha titulo="Produtos" acao={<button type="button">Novo</button>}>
        corpo
      </Ficha>,
    );
    expect(saida.indexOf("Novo")).toBeGreaterThan(saida.indexOf("Produtos"));
    expect(saida.indexOf("Novo")).toBeLessThan(saida.indexOf("corpo"));
  });

  /**
   * Uma tabela dentro de uma ficha precisa encostar no filete dela. Com o
   * preenchimento padrão, o cabeçalho fixo da tabela flutua a 20px da moldura e
   * a linha da tabela desenha um segundo retângulo por dentro do primeiro.
   */
  it("semPreenchimento tira o respiro do corpo, para tabela encostar no filete", () => {
    expect(html(<Ficha>x</Ficha>)).toContain("p-5");
    expect(html(<Ficha semPreenchimento>x</Ficha>)).not.toContain("p-5");
  });
});
