import { describe, it, expect } from "vitest";

import {
  CARRINHO_VAZIO,
  fraseDoResultado,
  itemDoProduto,
  montarCarrinho,
  resumoDaSimulacao,
  rotuloDoProduto,
  subtotalDoCarrinho,
  validarCarrinho,
  type CarrinhoNoSimulador,
} from "./simulador.logica";
import type { ProdutoDoSeletor, RespostaDaSimulacao } from "./contrato";

const NBSP = String.fromCharCode(0x00a0);
const reais = (texto: string) => `R$${NBSP}${texto}`;

const CLASSICO: ProdutoDoSeletor = {
  product_id: "11111111-1111-4111-8111-111111111111",
  name: "Clássico 250g",
  sku: "CAN-CLA-250",
  category: "torrado",
  price: "60.00",
};

function carrinho(parcial: Partial<CarrinhoNoSimulador> = {}): CarrinhoNoSimulador {
  return {
    ...CARRINHO_VAZIO,
    itens: [{ ...itemDoProduto(CLASSICO), quantidade: "2" }],
    ...parcial,
  };
}

describe("o produto do catálogo vira linha do carrinho, sem UUID digitado à mão", () => {
  it("traz preço, SKU e categoria junto", () => {
    expect(itemDoProduto(CLASSICO)).toEqual({
      produtoId: CLASSICO.product_id,
      sku: "CAN-CLA-250",
      categoria: "torrado",
      precoReais: "60.00",
      quantidade: "1",
    });
  });

  it("o rótulo é humano — R23 vale no seletor também", () => {
    expect(rotuloDoProduto(CLASSICO)).toBe("Clássico 250g · CAN-CLA-250");
    expect(rotuloDoProduto({ ...CLASSICO, sku: null })).toBe("Clássico 250g");
    expect(rotuloDoProduto({ ...CLASSICO, name: "  ", sku: null })).toBe("Sem nome");
  });

  it("produto sem preço não inventa um", () => {
    expect(itemDoProduto({ ...CLASSICO, price: null }).precoReais).toBe("");
  });
});

describe("a única aritmética do simulador é a soma do carrinho", () => {
  it("2× R$ 60 são R$ 120 em centavos", () => {
    expect(subtotalDoCarrinho(carrinho())).toBe(12000);
  });

  it("linha sem preço não entra na conta", () => {
    const c = carrinho({
      itens: [
        { ...itemDoProduto(CLASSICO), quantidade: "2" },
        { produtoId: "", sku: "", categoria: "", precoReais: "", quantidade: "3" },
      ],
    });
    expect(subtotalDoCarrinho(c)).toBe(12000);
  });

  it("quantidade inválida não vira NaN no total", () => {
    const c = carrinho({
      itens: [{ ...itemDoProduto(CLASSICO), quantidade: "abc" }],
    });
    expect(subtotalDoCarrinho(c)).toBe(0);
  });
});

describe("a validação do carrinho de teste", () => {
  it("carrinho vazio é apontado no primeiro item", () => {
    expect(validarCarrinho(CARRINHO_VAZIO)["itens.0.precoReais"]).toContain(
      "ao menos um item",
    );
  });

  it("carrinho preenchido passa", () => {
    expect(validarCarrinho(carrinho())).toEqual({});
  });

  it("preço zero é recusado com a unidade na frase", () => {
    const c = carrinho({ itens: [{ ...itemDoProduto(CLASSICO), precoReais: "0" }] });
    expect(validarCarrinho(c)["itens.0.precoReais"]).toContain("reais");
  });

  it("CEP incompleto é apontado, e vazio não é erro", () => {
    expect(validarCarrinho(carrinho({ freteCep: "0131" })).freteCep).toBeDefined();
    expect(validarCarrinho(carrinho({ freteCep: "" })).freteCep).toBeUndefined();
    expect(validarCarrinho(carrinho({ freteCep: "01310-100" })).freteCep).toBeUndefined();
  });
});

describe("o payload do carrinho fala o vocabulário do motor", () => {
  it("preço vira centavos inteiros, como calcularDescontos espera", () => {
    const p = montarCarrinho(carrinho());
    expect(p.itens).toEqual([
      {
        produtoId: CLASSICO.product_id,
        sku: "CAN-CLA-250",
        categoria: "torrado",
        precoCentavos: 6000,
        quantidade: 2,
      },
    ]);
  });

  it("“qualquer meio de pagamento” é null, e não um meio escolhido por padrão", () => {
    // Uma regra com `meios_pagamento` preenchido NÃO se aplica a `null`:
    // desconto que depende do meio só vale quando se sabe qual é.
    expect(montarCarrinho(carrinho()).meioPagamento).toBeNull();
    expect(montarCarrinho(carrinho({ meioPagamento: "pix" })).meioPagamento).toBe("pix");
  });

  it("frete em branco é “não cotado”, e a classe frete do motor nem roda", () => {
    expect(montarCarrinho(carrinho()).frete).toBeNull();
  });

  it("frete cotado leva UF em maiúscula e CEP só com dígitos", () => {
    const p = montarCarrinho(
      carrinho({ freteReais: "24,90", freteUf: "sp", freteCep: "01310-100" }),
    );
    expect(p.frete).toEqual({
      valorCentavos: 2490,
      ehMaisBarata: true,
      uf: "SP",
      cep: "01310100",
    });
  });

  it("linha sem preço não vai ao motor", () => {
    const c = carrinho({
      itens: [
        { ...itemDoProduto(CLASSICO), quantidade: "2" },
        { produtoId: "", sku: "", categoria: "", precoReais: "", quantidade: "1" },
      ],
    });
    expect(montarCarrinho(c).itens).toHaveLength(1);
  });
});

describe("a leitura da resposta — o “depois” é subtração de dois números do servidor", () => {
  const resposta: RespostaDaSimulacao = {
    ajustes: [
      {
        sequencia: 1,
        promocaoId: null,
        codigo: "CAFE20",
        alvo: "item",
        alvoRef: "CAN-CLA-250",
        valorCentavos: 1200,
        rotulo: "Dez por cento no PIX",
      },
    ],
    totalCentavos: 1200,
    subtotalCentavos: 12000,
    freteFinalCentavos: null,
  };

  it("monta a linha com rótulo, alvo e o sinal de menos colado no número", () => {
    const r = resumoDaSimulacao(resposta);
    expect(r.linhas).toHaveLength(1);
    expect(r.linhas[0].rotulo).toBe("Dez por cento no PIX");
    expect(r.linhas[0].detalhe).toBe("no item · CAN-CLA-250 · código CAFE20");
    expect(r.linhas[0].valor).toBe(`− ${reais("12,00")}`);
  });

  it("o subtotal depois é o antes menos o total, com os dois vindos do servidor", () => {
    const r = resumoDaSimulacao(resposta);
    expect(r.subtotalAntes).toBe(reais("120,00"));
    expect(r.descontoTotal).toBe(reais("12,00"));
    expect(r.subtotalDepois).toBe(reais("108,00"));
    expect(r.totalDepois).toBe(reais("108,00"));
  });

  it("frete não cotado fica null, e não vira R$ 0,00 — não são a mesma coisa", () => {
    expect(resumoDaSimulacao(resposta).freteDepois).toBeNull();
    expect(
      resumoDaSimulacao({ ...resposta, freteFinalCentavos: 0 }).freteDepois,
    ).toBe(reais("0,00"));
  });

  it("frete cotado entra no total final", () => {
    const r = resumoDaSimulacao({ ...resposta, freteFinalCentavos: 2490 });
    expect(r.totalDepois).toBe(reais("132,90"));
  });

  it("zero ajustes é um estado próprio, e não “R$ 0,00”", () => {
    const r = resumoDaSimulacao({ ...resposta, ajustes: [], totalCentavos: 0 });
    expect(r.semEfeito).toBe(true);
    expect(r.linhas).toEqual([]);
  });

  it("o desconto nunca deixa o subtotal negativo na tela", () => {
    const r = resumoDaSimulacao({ ...resposta, totalCentavos: 999999 });
    expect(r.subtotalDepois).toBe(reais("0,00"));
  });
});

describe("a frase que o gestor lê em voz alta", () => {
  const resposta: RespostaDaSimulacao = {
    ajustes: [],
    totalCentavos: 1200,
    subtotalCentavos: 12000,
    freteFinalCentavos: null,
  };

  it("é exatamente a do plano da onda", () => {
    expect(fraseDoResultado(carrinho(), [CLASSICO], resposta)).toBe(
      `Num carrinho com 2× Clássico 250g = ${reais("120,00")}, esta regra desconta ${reais("12,00")}.`,
    );
  });

  it("quando não desconta, DIZ que não desconta — em vez de mostrar R$ 0,00", () => {
    expect(
      fraseDoResultado(carrinho(), [CLASSICO], { ...resposta, totalCentavos: 0 }),
    ).toContain("não desconta nada");
  });

  it("item avulso, sem produto do catálogo, é nomeado pelo SKU", () => {
    const c = carrinho({
      itens: [
        { produtoId: "", sku: "AVULSO-1", categoria: "", precoReais: "60,00", quantidade: "2" },
      ],
    });
    expect(fraseDoResultado(c, [CLASSICO], resposta)).toContain("2× AVULSO-1");
  });
});
