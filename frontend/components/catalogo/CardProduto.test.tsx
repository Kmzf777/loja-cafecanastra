import type { ReactElement } from "react";
import { describe, it, expect, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

// Sacola dublada — mesma técnica de CardKit.test.tsx: sem DOM não há clique,
// então prova-se o que o servidor pinta.
vi.mock("@/lib/sacola/sacola", () => ({
  useSacola: () => ({ adicionar: async () => {}, itens: [] }),
}));

import { CardProduto } from "./CardProduto";
import type { ProdutoVendavel } from "@/lib/catalogo/tipos";

function html(no: ReactElement) {
  return renderToStaticMarkup(no);
}

/**
 * O SEPARADOR DE MILHAR DO `Intl` É ESPAÇO NÃO SEPARÁVEL (U+00A0), e não o
 * espaço comum. Está escrito assim, com a sequência de escape, porque o
 * caractere cru é invisível no código e ninguém saberia por que a asserção
 * falhou. React NÃO o transforma em `&nbsp;`: o `renderToStaticMarkup` escapa
 * só `& < > " '` e deixa o resto passar como está.
 */
const NBSP = "\u00a0";

/**
 * Fixture no formato que a Task 5B produz — `preco`/`estoque`/`produtoId`, o
 * vocabulário comercial da casa. NÃO é o produto cru do JSON: aquele não tem
 * `produtoId`, e um card montado a partir dele nunca conseguiria vender.
 */
const CLASSICO_250: ProdutoVendavel = {
  sku: "classico-graos-250",
  skuLoja: "classico-graos-250",
  produtoId: "prod-teste-1",
  linha: "classico",
  formato: "graos",
  gramas: 250,
  pacotes: 1,
  rotuloEmbalagem: "Pacote com 250 g",
  rotuloChave: "pacote-250g",
  nome: "Café Especial Canastra Clássico em Grãos - Pacote com 250 gramas",
  imagem: "/capa-classico.jpg",
  preco: 3970,
  estoque: 20,
};

const ESGOTADO: ProdutoVendavel = { ...CLASSICO_250, estoque: 0 };

describe("CardProduto", () => {
  it("mostra o preço EXATO, não 'a partir de'", () => {
    // O card de linha diz "a partir de" porque agrupa variantes. Este é um
    // SKU: o preço é o que a pessoa vai pagar, e hedgear seria mentir para
    // baixo.
    const saida = html(<CardProduto produto={CLASSICO_250} locale="pt" />);
    expect(saida).toContain(`R$${NBSP}39,70`);
    expect(saida).not.toContain("a partir de");
  });

  it("diz de que embalagem se trata", () => {
    const saida = html(<CardProduto produto={CLASSICO_250} locale="pt" />);
    expect(saida).toContain("250 g");
  });

  it("vende no idioma da página", () => {
    expect(html(<CardProduto produto={CLASSICO_250} locale="en" />)).toContain(
      "Add to bag",
    );
    expect(html(<CardProduto produto={CLASSICO_250} locale="es" />)).toContain(
      "Añadir a la bolsa",
    );
  });

  it("não deixa português vazar para en e es", () => {
    for (const locale of ["en", "es"] as const) {
      const saida = html(<CardProduto produto={CLASSICO_250} locale={locale} />);
      expect(saida, `botão em ${locale}`).not.toContain("Adicionar à sacola");
    }
  });

  it("esgotado aparece marcado, não some", () => {
    // A regra da casa, documentada em CardKit e repositorio.ts: sumir com
    // produto é pior do que dizer que acabou.
    const saida = html(<CardProduto produto={ESGOTADO} locale="pt" />);
    expect(saida).toContain("Esgotado");
    expect(saida).toContain("disabled");
  });

  it("leva à página do café a que o SKU pertence", () => {
    const saida = html(<CardProduto produto={CLASSICO_250} locale="pt" />);
    expect(saida).toContain('href="/cafes/classico"');
  });

  it("prefixa o idioma no link fora do português", () => {
    const saida = html(<CardProduto produto={CLASSICO_250} locale="en" />);
    expect(saida).toContain('href="/en/cafes/classico"');
  });
});
