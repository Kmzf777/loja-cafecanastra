import type { ReactElement } from "react";
import { describe, it, expect, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

/**
 * O card de kit em três idiomas.
 *
 * O DEFEITO QUE ESTE ARQUIVO TRAVA: o card vivia na mesma grade da PLP que o
 * <CardCafe>, que já era traduzido, e era o único dos dois que não recebia
 * `locale` — a seção "Kits e caixas" de /en/cafes vendia em português ao lado
 * de cards em inglês.
 *
 * Mesma técnica do PainelCompra: markup por `renderToStaticMarkup`, sacola
 * dublada, e o que depende de clique ("Na sacola", o teto, os dois erros) fica
 * fora porque sem DOM não há evento.
 */
vi.mock("@/lib/sacola/sacola", () => ({
  useSacola: () => ({ adicionar: async () => {}, itens: [] }),
}));

import { CardKit } from "./CardKit";
import { KITS_DA_LOJA } from "@/lib/catalogo/produtos";
import type { Kit } from "@/lib/catalogo/tipos";

function html(no: ReactElement) {
  return renderToStaticMarkup(no);
}

/** Um kit real do catálogo, com preço e estoque do JSON. */
const KIT = KITS_DA_LOJA[0];
const KIT_ESGOTADO: Kit = { ...KIT, estoque: 0 };

describe("CardKit", () => {
  it("vende no idioma da página, como o card de café ao lado", () => {
    expect(html(<CardKit kit={KIT} locale="en" />)).toContain("Add to bag");
    expect(html(<CardKit kit={KIT} locale="es" />)).toContain(
      "Añadir a la bolsa",
    );
    expect(html(<CardKit kit={KIT} locale="pt" />)).toContain(
      "Adicionar à sacola",
    );
  });

  it("não deixa o botão nem o aviso de esgotado em português fora do pt", () => {
    for (const locale of ["en", "es"] as const) {
      const saida = html(<CardKit kit={KIT_ESGOTADO} locale={locale} />);
      expect(saida, `botão em ${locale}`).not.toContain("Adicionar à sacola");
      expect(saida, `esgotado em ${locale}`).not.toContain("Esgotado");
      expect(saida, `aviso em ${locale}`).not.toContain(
        "Este kit está esgotado na loja",
      );
    }
  });

  it("explica o esgotado com a torra semanal, em cada idioma", () => {
    // O aviso não é decoração: ele é a diferença entre "acabou para sempre" e
    // "volta na semana que vem", e é o que segura a pessoa na página.
    expect(html(<CardKit kit={KIT_ESGOTADO} locale="en" />)).toContain(
      "we roast every week",
    );
    expect(html(<CardKit kit={KIT_ESGOTADO} locale="es" />)).toContain(
      "el tueste es semanal",
    );
    expect(html(<CardKit kit={KIT_ESGOTADO} locale="pt" />)).toContain(
      "a torra é semanal",
    );
  });

  it("traduz o NOME e o rótulo da caixa, não só os botões", () => {
    /**
     * O card já vendia em inglês e o produto continuava em português: "Café
     * Especial Canastra Canela, Clássico e Suave Moído" com um "Add to bag"
     * embaixo. O nome e o rótulo são o que a pessoa está comprando — traduzir
     * a moldura e deixar o produto cru é o defeito inteiro desta onda.
     */
    const en = html(<CardKit kit={KIT} locale="en" />);
    expect(en).toContain("Canastra Specialty Coffee");
    expect(en).toContain("Box with one 250 g bag of each");
    expect(en).not.toContain("Caixa com 1 pacote");

    const es = html(<CardKit kit={KIT} locale="es" />);
    expect(es).toContain("Caja con 1 bolsa de 250 g de cada");

    // Nome próprio não se traduz em idioma nenhum: é o que está impresso no
    // pacote que chega na casa da pessoa.
    expect(en).toContain("Canela");
    expect(en).toContain("Clássico");
  });

  it("conta as unidades no idioma de quem lê", () => {
    const comUnidades = KITS_DA_LOJA.find((k) => k.unidades);
    // Nem todo kit conta por unidade (sachê, cápsula); se nenhum contar, não
    // há o que verificar — e o teste diz isso em vez de fingir que passou.
    expect(comUnidades, "nenhum kit do catálogo conta unidades").toBeDefined();
    expect(html(<CardKit kit={comUnidades!} locale="en" />)).toContain("units");
    expect(html(<CardKit kit={comUnidades!} locale="pt" />)).toContain(
      "unidades",
    );
  });

  it("continua em português quando ninguém passa idioma", () => {
    expect(html(<CardKit kit={KIT} />)).toContain("Adicionar à sacola");
  });

  it("o kit em campanha também mostra 'de/por' — kits passam pelo mesmo motor", () => {
    // `sobreporAoVivo` casa kit, variante e SKU avulso pelo MESMO caminho; um
    // card de kit sem tratamento seria a única superfície de venda a esconder
    // a promoção que a cobrança aplica.
    const emPromocao: Kit = {
      ...KIT,
      preco: 10000,
      precoPromocional: 8000,
      estoque: 5,
    };
    const saida = html(<CardKit kit={emPromocao} locale="pt" />);
    expect(saida).toContain("<s ");
    expect(saida).toContain("−20%");
  });
});
