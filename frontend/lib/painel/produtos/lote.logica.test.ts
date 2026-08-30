import { describe, it, expect } from "vitest";

import {
  PRECO_MAXIMO_REAIS,
  aplicaveis,
  lerNumero,
  preverEstoques,
  preverPrecos,
  resumoDaSelecao,
  resumoDoLote,
} from "./lote.logica";
import type { ProdutoDoPainel } from "./produtos.logica";

function produto(
  id: string,
  price: string | number,
  quantity: number,
  name = `Café ${id}`,
): ProdutoDoPainel {
  return {
    product_id: id,
    sku: `sku-${id}`,
    name,
    size: "250 g",
    category: "Especial",
    price,
    image: null,
    timestamp: null,
    quantity,
    description: null,
    weight: "0.300",
    width: "20.00",
    height: "5.00",
    length: "20.00",
  };
}

describe("lerNumero", () => {
  /**
   * VAZIO DEVOLVE `null`, NUNCA `0` — a mesma regra de `reaisParaCentavos`, e
   * pelo mesmo motivo que `PUT /config` demonstrou nesta loja: `Number('')` é
   * `0`, e um `0` silencioso num "definir preço" zera o catálogo marcado.
   */
  it("vazio é null, não zero", () => {
    expect(lerNumero("")).toBeNull();
    expect(lerNumero("   ")).toBeNull();
  });

  it("aceita a vírgula do teclado brasileiro", () => {
    expect(lerNumero("59,90")).toBe(59.9);
  });

  it("texto que não é número é null", () => {
    expect(lerNumero("dez")).toBeNull();
    expect(lerNumero("--3")).toBeNull();
  });

  it("negativo é número — é assim que se reduz preço", () => {
    expect(lerNumero("-10")).toBe(-10);
  });
});

describe("preverPrecos", () => {
  const linhas = [produto("a", "100.00", 5), produto("b", "59.90", 2)];

  /** Sem número digitado não há prévia — e sem prévia o botão de aplicar fica
   *  travado. Não há como confirmar um lote sem ver o lote. */
  it("sem valor, não há prévia", () => {
    expect(preverPrecos(linhas, "percentual", "")).toEqual([]);
  });

  it("definir dá o mesmo preço a todos", () => {
    const p = preverPrecos(linhas, "definir", "79,90");
    expect(p.map((x) => x.para)).toEqual([79.9, 79.9]);
    expect(p.map((x) => x.de)).toEqual([100, 59.9]);
  });

  it("percentual negativo reduz, positivo aumenta", () => {
    expect(preverPrecos(linhas, "percentual", "-10").map((x) => x.para)).toEqual([90, 53.91]);
    expect(preverPrecos(linhas, "percentual", "10").map((x) => x.para)).toEqual([110, 65.89]);
  });

  it("valor fixo soma ou subtrai o mesmo em todos", () => {
    expect(preverPrecos(linhas, "valor", "5,10").map((x) => x.para)).toEqual([105.1, 65]);
  });

  /**
   * O ARREDONDAMENTO É O DE `reaisParaCentavos`, e este caso é o que separa a
   * conta certa da errada: `Math.round(1.005 * 100)` dá 100 (o ponto flutuante
   * guarda 100.49999…) e trunca um centavo para menos. Num lote de duzentos
   * produtos isso é dinheiro.
   */
  it("arredonda pelo caminho que não perde o centavo do 1,005", () => {
    const [p] = preverPrecos([produto("c", "1.00", 1)], "percentual", "0,5");
    expect(p.para).toBe(1.01);
  });

  it("recusa a linha que ficaria negativa, e só ela", () => {
    const p = preverPrecos([produto("a", "10.00", 1), produto("b", "100.00", 1)], "valor", "-50");
    expect(p[0].para).toBeNull();
    expect(p[0].problema).toBe("Ficaria negativo.");
    // A outra passa: uma linha impossível não derruba o lote, senão o gestor
    // teria de caçar qual é — que é o trabalho que ele veio evitar.
    expect(p[1].para).toBe(50);
  });

  it("recusa acima do teto que o backend também recusa", () => {
    const [p] = preverPrecos([produto("a", String(PRECO_MAXIMO_REAIS), 1)], "valor", "1");
    expect(p.para).toBeNull();
    expect(p.problema).toContain("teto");
  });

  it("preço atual ilegível vira problema com nome, não exceção", () => {
    const [p] = preverPrecos([produto("a", "undefined", 1)], "percentual", "-10");
    expect(p.para).toBeNull();
    expect(p.nome).toBe("Café a");
  });

  it("aplicaveis deixa passar só o que tem destino", () => {
    const p = preverPrecos([produto("a", "10.00", 1), produto("b", "100.00", 1)], "valor", "-50");
    expect(aplicaveis(p)).toHaveLength(1);
  });
});

describe("preverEstoques", () => {
  const linhas = [produto("a", "10.00", 3), produto("b", "10.00", 40)];

  it("definir dá a mesma quantidade a todos", () => {
    expect(preverEstoques(linhas, "definir", "10").map((x) => x.para)).toEqual([10, 10]);
  });

  it("somar é entrada de mercadoria", () => {
    expect(preverEstoques(linhas, "somar", "5").map((x) => x.para)).toEqual([8, 45]);
  });

  /**
   * O PISO EM ZERO NÃO É UM ERRO, É O COMPORTAMENTO — a mesma decisão do botão
   * "−" do formulário legado, que travava em 0 em vez de recusar o clique.
   * Recusar a linha obrigaria o gestor a descobrir quais dos vinte marcados
   * tinham menos de cinco.
   */
  it("subtrair trava em zero em vez de recusar a linha", () => {
    const p = preverEstoques(linhas, "subtrair", "5");
    expect(p.map((x) => x.para)).toEqual([0, 35]);
    expect(p[0].problema).toBeUndefined();
  });

  it("definir negativo é recusado — aí é a intenção que está errada", () => {
    const [p] = preverEstoques(linhas, "definir", "-1");
    expect(p.para).toBeNull();
  });

  it("estoque é contado em unidades inteiras", () => {
    const p = preverEstoques(linhas, "somar", "1,5");
    expect(p.every((x) => x.para === null)).toBe(true);
    expect(p[0].problema).toContain("inteiras");
  });

  it("sem valor, não há prévia", () => {
    expect(preverEstoques(linhas, "somar", "")).toEqual([]);
  });
});

describe("resumoDaSelecao — R25", () => {
  it("sem nada marcado, diz isso", () => {
    expect(resumoDaSelecao(0, 20, 1284)).toBe("Nenhum produto marcado.");
  });

  /**
   * A FRASE QUE O R25 EXISTE PARA EXIGIR: "senão o lojista acha que arquivou
   * 1.284 quando arquivou 50". Os dois números têm de aparecer, e tem de estar
   * escrito que a ação vale só para os marcados.
   */
  it("com filtro maior que a página, diz os dois números", () => {
    const frase = resumoDaSelecao(20, 20, 1284);
    expect(frase).toContain("20");
    expect(frase).toContain("1284");
    expect(frase).toContain("só para os marcados");
  });

  /** Quando o filtro cabe na página não há dois números para confundir, e
   *  repetir o total só acrescentaria ruído. */
  it("com o filtro inteiro na página, não repete o total", () => {
    expect(resumoDaSelecao(3, 12, 12)).toBe("3 produtos marcados nesta página de 12.");
  });

  it("concorda no singular", () => {
    expect(resumoDaSelecao(1, 12, 12)).toContain("1 produto marcado");
  });
});

describe("resumoDoLote", () => {
  it("tudo certo, só a contagem", () => {
    expect(resumoDoLote(20, [])).toBe("20 produtos atualizados.");
    expect(resumoDoLote(1, [])).toBe("1 produto atualizado.");
  });

  /**
   * O PLACAR É O REAL, NUNCA O PEDIDO — a mesma lição do `PATCH` em lote de
   * avaliações. E a frase de cada falha vem com o NOME do produto na frente:
   * "Já existe um produto com este SKU." sem dizer de qual obriga a abrir os
   * vinte.
   */
  it("com falha, diz quantas, quais e por quê", () => {
    const frase = resumoDoLote(18, [
      { nome: "Clássico 250 g", frase: "Já existe um produto com este SKU." },
      { nome: "Micro-lote", frase: "Produto não encontrado." },
    ]);
    expect(frase).toContain("18 produtos atualizados");
    expect(frase).toContain("2 ficaram de fora");
    expect(frase).toContain("Clássico 250 g: Já existe um produto com este SKU.");
    expect(frase).toContain("Micro-lote: Produto não encontrado.");
  });

  it("zero atualizados também é um placar", () => {
    expect(resumoDoLote(0, [{ nome: "X", frase: "Sem permissão." }])).toContain(
      "0 produtos atualizados",
    );
  });
});
