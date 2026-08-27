import { describe, it, expect, afterEach } from "vitest";
import { cleanup } from "@testing-library/react";
import { html } from "@/lib/teste/html";
import { renderizar } from "@/lib/teste/renderizar";
import { Tabela, type Coluna } from "./Tabela";

afterEach(cleanup);

type Pedido = { id: string; numero: string; cliente: string; total: string };

const LINHAS: Pedido[] = [
  { id: "9f1c-uuid", numero: "#1042", cliente: "Maria Souza", total: "R$ 128,00" },
  { id: "3ab7-uuid", numero: "#1043", cliente: "João Lima", total: "R$ 64,50" },
];

const COLUNAS: Coluna<Pedido>[] = [
  { chave: "numero", rotulo: "Pedido", ordenavel: true, celula: (p) => `${p.numero} · ${p.cliente}` },
  { chave: "cliente", rotulo: "Cliente", celula: (p) => p.cliente },
  { chave: "total", rotulo: "Total", dado: true, ordenavel: true, celula: (p) => p.total },
];

const base = {
  legenda: "Pedidos",
  colunas: COLUNAS,
  linhas: LINHAS,
  chaveDaLinha: (p: Pedido) => p.id,
  aoOrdenar: () => {},
};

describe("Tabela", () => {
  /**
   * R24 é explícita: `<table>` nativa, nunca `role="grid"`. Adotar grid
   * obrigaria a escrever navegação 2D por setas, roving tabindex e
   * virtualização acessível à mão; com a tabela nativa o teclado funciona de
   * graça. Este teste é a trava.
   */
  it("é uma <table> de verdade e NUNCA role=grid", () => {
    const saida = html(<Tabela {...base} />);
    expect(saida).toContain("<table");
    expect(saida).not.toContain('role="grid"');
    expect(saida).not.toContain('role="row"');
    expect(saida).not.toContain('role="gridcell"');
  });

  it("tem <caption>, que é o nome da tabela para o leitor de tela", () => {
    const saida = html(<Tabela {...base} />);
    expect(saida).toContain("<caption");
    expect(saida).toContain("Pedidos");
  });

  it("todo cabeçalho de coluna é <th scope=\"col\">", () => {
    const { container } = renderizar(<Tabela {...base} />);
    const ths = [...container.querySelectorAll("thead th")];
    expect(ths).toHaveLength(3);
    for (const th of ths) expect(th.getAttribute("scope")).toBe("col");
  });

  /**
   * R23: a primeira coluna é o identificador humano da linha, então ela é o
   * CABEÇALHO da linha — `<th scope="row">`. É o que faz o leitor de tela
   * anunciar "Maria Souza, Total, R$ 128,00" ao andar pela linha, em vez de
   * "R$ 128,00" solto sem dizer de quem.
   */
  it("a primeira célula de cada linha é <th scope=\"row\">, o identificador humano", () => {
    const { container } = renderizar(<Tabela {...base} />);
    const linhas = [...container.querySelectorAll("tbody tr")];
    expect(linhas).toHaveLength(2);
    for (const tr of linhas) {
      const primeira = tr.firstElementChild!;
      expect(primeira.tagName).toBe("TH");
      expect(primeira.getAttribute("scope")).toBe("row");
    }
    expect(linhas[0].textContent).toContain("#1042 · Maria Souza");
    expect(linhas[0].textContent).not.toContain("9f1c-uuid");
  });

  it("a ordenação é um <button> DENTRO do <th> — não um th clicável", () => {
    const { container } = renderizar(<Tabela {...base} />);
    const ordenavel = container.querySelectorAll("thead th button");
    expect(ordenavel).toHaveLength(2);
    for (const b of ordenavel) expect(b.getAttribute("type")).toBe("button");
  });

  /**
   * Marcar a coluna como `ordenavel` sem passar `aoOrdenar` NÃO é meio-termo:
   * seria um botão que não faz nada e um `aria-sort` prometendo ao leitor de
   * tela um recurso que a tela não tem. Mesma doutrina do <EstadoDaTela>, que
   * não oferece "Tentar de novo" quando ninguém lhe deu o que tentar.
   */
  it("coluna ordenável sem quem ouvir não vira botão nem promete aria-sort", () => {
    const { container } = renderizar(<Tabela {...base} aoOrdenar={undefined} />);
    expect(container.querySelectorAll("thead th button")).toHaveLength(0);
    for (const th of container.querySelectorAll("thead th")) {
      expect(th.hasAttribute("aria-sort")).toBe(false);
    }
  });

  it("coluna não ordenável não ganha botão que não faz nada", () => {
    const { container } = renderizar(<Tabela {...base} />);
    const ths = [...container.querySelectorAll("thead th")];
    expect(ths[1].querySelector("button")).toBeNull();
  });

  it("aria-sort diz a direção da coluna ordenada, e 'none' nas demais", () => {
    const { container } = renderizar(
      <Tabela {...base} ordenacao={{ chave: "total", direcao: "desc" }} />,
    );
    const ths = [...container.querySelectorAll("thead th")];
    expect(ths[0].getAttribute("aria-sort")).toBe("none");
    expect(ths[2].getAttribute("aria-sort")).toBe("descending");
  });

  it("ascendente diz ascending", () => {
    const { container } = renderizar(
      <Tabela {...base} ordenacao={{ chave: "numero", direcao: "asc" }} />,
    );
    const ths = [...container.querySelectorAll("thead th")];
    expect(ths[0].getAttribute("aria-sort")).toBe("ascending");
  });

  it("sem ordenação nenhuma, coluna ordenável fica em 'none' — nunca sem o atributo", () => {
    const { container } = renderizar(<Tabela {...base} />);
    const ths = [...container.querySelectorAll("thead th")];
    expect(ths[0].getAttribute("aria-sort")).toBe("none");
    expect(ths[1].hasAttribute("aria-sort")).toBe(false);
  });

  /**
   * A Tabela não ordena: ela avisa qual coluna foi pedida. A DECISÃO (qual
   * comparador, ordenação estável, o que fazer com nulo) é regra de negócio e
   * mora num `*.logica.ts` puro, testável sem DOM — spec §2.8.
   */
  it("clicar no cabeçalho avisa QUAL coluna, e não ordena por conta própria", async () => {
    const pedidas: string[] = [];
    const { getByRole, usuario } = renderizar(
      <Tabela {...base} aoOrdenar={(chave) => pedidas.push(chave)} />,
    );
    await usuario.click(getByRole("button", { name: /Total/ }));
    await usuario.click(getByRole("button", { name: /Pedido/ }));
    expect(pedidas).toEqual(["total", "numero"]);
  });

  /** `data-dado` é o gancho que o globals.css usa para dar monoespaçada com
   *  numeral tabular (R23): comparar valores vira comparar POSIÇÃO, não
   *  comprimento de string. */
  it("célula numérica leva data-dado; célula de texto, não", () => {
    const { container } = renderizar(<Tabela {...base} />);
    const primeira = container.querySelector("tbody tr")!;
    const celulas = [...primeira.querySelectorAll("td")];
    expect(celulas[0].hasAttribute("data-dado")).toBe(false);
    expect(celulas[1].hasAttribute("data-dado")).toBe(true);
    expect(celulas[1].textContent).toBe("R$ 128,00");
  });

  it("o cabeçalho da coluna numérica também alinha à direita, junto com os números", () => {
    const { container } = renderizar(<Tabela {...base} />);
    const ths = [...container.querySelectorAll("thead th")];
    expect(ths[2].className).toContain("text-right");
  });

  it("o cabeçalho é fixo — R23", () => {
    expect(html(<Tabela {...base} />)).toContain("sticky");
  });

  /**
   * Zero linhas NÃO é assunto da Tabela: distinguir "não há pedidos" de "não
   * consegui perguntar" é o trabalho do <EstadoDaTela>, e uma Tabela que
   * desenha o próprio vazio é o caminho mais curto para uma tela mostrar
   * "nenhum pedido" depois de um fetch que falhou.
   */
  it("sem linhas desenha o cabeçalho e mais nada — o vazio é do EstadoDaTela", () => {
    const { container } = renderizar(<Tabela {...base} linhas={[]} />);
    expect(container.querySelectorAll("thead th")).toHaveLength(3);
    expect(container.querySelectorAll("tbody tr")).toHaveLength(0);
    expect(container.textContent).not.toMatch(/nenhum|vazio|sem resultado/i);
  });
});

/**
 * A COLUNA DE SELEÇÃO — R25, acrescentada na Onda 5 pela tela de Pedidos.
 *
 * Ela é uma prop e não mais uma `Coluna` por causa da marcação: `colunas[0]`
 * vira `<th scope="row">`, e uma caixa de seleção ali faria o leitor de tela
 * anunciar "caixa não marcada" no lugar de "Maria Souza" a cada célula da
 * linha. Estes testes travam as duas metades disso.
 */
describe("Tabela com seleção em massa", () => {
  const selecao = {
    cabecalho: <input type="checkbox" aria-label="Selecionar os desta página" />,
    celula: (p: Pedido) => (
      <input type="checkbox" aria-label={`Selecionar ${p.numero}`} />
    ),
  };

  it("sem a prop, nenhuma célula extra nasce — quem não usa não paga", () => {
    const { container } = renderizar(<Tabela {...base} />);
    expect(container.querySelectorAll("thead th")).toHaveLength(3);
    expect(container.querySelectorAll('input[type="checkbox"]')).toHaveLength(0);
  });

  it("com a prop, a caixa vem ANTES das colunas, num <td>", () => {
    const { container } = renderizar(<Tabela {...base} selecao={selecao} />);
    const primeiraLinha = container.querySelector("tbody tr")!;
    expect(primeiraLinha.firstElementChild!.tagName).toBe("TD");
    expect(
      primeiraLinha.firstElementChild!.querySelector('input[type="checkbox"]'),
    ).not.toBeNull();
  });

  /**
   * O ponto todo da prop: o cabeçalho da LINHA continua sendo o identificador
   * humano, e não a caixa.
   */
  it("o <th scope=\"row\"> continua sendo o nome do pedido, não a caixa", () => {
    const { container } = renderizar(<Tabela {...base} selecao={selecao} />);
    const linha = container.querySelector("tbody tr")!;
    const cabecalhoDaLinha = linha.querySelector('th[scope="row"]')!;
    expect(cabecalhoDaLinha.textContent).toContain("#1042 · Maria Souza");
    expect(cabecalhoDaLinha.querySelector("input")).toBeNull();
  });

  it("o cabeçalho da coluna de seleção é <th scope=\"col\">, como os outros", () => {
    const { container } = renderizar(<Tabela {...base} selecao={selecao} />);
    const ths = [...container.querySelectorAll("thead th")];
    expect(ths).toHaveLength(4);
    expect(ths[0].getAttribute("scope")).toBe("col");
    expect(ths[0].querySelector('input[type="checkbox"]')).not.toBeNull();
  });
});
