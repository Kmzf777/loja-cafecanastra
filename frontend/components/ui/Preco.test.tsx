import { describe, it, expect } from "vitest";
import { html } from "@/lib/teste/html";
import { Preco } from "./Preco";
import { formatarPreco } from "@/lib/catalogo/repositorio";

/** O separador do `toLocaleString` é espaço FINO NÃO-SEPARÁVEL, não o " " do
 *  teclado — comparar com um espaço comum falha por um caractere invisível. */
const reais = formatarPreco;

/**
 * O desenho do preço, e o que ele promete a quem não enxerga a tela.
 *
 * A regra de QUANDO há promoção vive em `lib/catalogo/promocao.ts` e é testada
 * lá. Aqui se prova o que o markup diz — inclusive que a moeda continua em
 * reais nos três idiomas, que é a decisão que impede `/en` de anunciar uma
 * moeda que o Mercado Pago não cobra.
 */

describe("Preco sem promoção", () => {
  it("desenha um número só, com o rótulo acessível de sempre", () => {
    const saida = html(<Preco preco={{ de: null, por: 6000 }} />);
    expect(saida).toContain(reais(6000));
    expect(saida).toContain('aria-label="60 reais"');
    expect(saida).not.toContain("<s ");
  });

  it("não inventa selo de desconto onde não há desconto", () => {
    expect(html(<Preco preco={{ de: null, por: 6000 }} />)).not.toContain("%");
  });
});

describe("Preco com promoção", () => {
  const promo = { de: 6000, por: 5400 };

  it("risca o preço de catálogo e imprime o promocional", () => {
    const saida = html(<Preco preco={promo} />);
    expect(saida).toContain("<s ");
    expect(saida).toContain(reais(6000));
    expect(saida).toContain(reais(5400));
  });

  it("marca o desconto num selo, com o sinal de menos tipográfico", () => {
    expect(html(<Preco preco={promo} />)).toContain("−10%");
  });

  it("O RISCADO E O SELO SÃO INVISÍVEIS AO LEITOR — quem lê recebe a frase", () => {
    const saida = html(<Preco preco={promo} />);
    // `<s>` não é anunciado de forma confiável; sem a frase, "R$ 60,00 R$
    // 54,00" vira dois preços soltos.
    expect(saida).toContain("de 60 reais, por 54 reais, 10% de desconto");
    expect(saida).toContain('class="sr-only"');
  });

  it("a frase acompanha o idioma da página", () => {
    expect(html(<Preco preco={promo} locale="en" />)).toContain(
      "was 60 reais, now 54 reais, 10% off",
    );
    expect(html(<Preco preco={promo} locale="es" />)).toContain(
      "antes 60 reais, ahora 54 reais, 10% de descuento",
    );
  });

  it("A MOEDA CONTINUA EM REAIS NOS TRÊS IDIOMAS", () => {
    // `formatarPreco` é pt-BR/BRL fixo de propósito: `/en` exibindo outra moeda
    // não mudaria um centavo do que o Mercado Pago cobra.
    for (const locale of ["pt", "en", "es"] as const) {
      expect(html(<Preco preco={promo} locale={locale} />)).toContain(reais(6000));
    }
  });

  it("desconto abaixo de 1% risca o preço mas não desenha selo", () => {
    const saida = html(<Preco preco={{ de: 6000, por: 5999 }} />);
    expect(saida).toContain("<s ");
    expect(saida).not.toContain("%");
    expect(saida).toContain("de 60 reais, por 59 reais e 99 centavos");
  });

  it("os três tamanhos existem e mudam só a escala, nunca o conteúdo", () => {
    const compacto = html(<Preco preco={promo} tamanho="compacto" />);
    const destaque = html(<Preco preco={promo} tamanho="destaque" />);
    expect(compacto).toContain("text-[17px]");
    expect(destaque).toContain("text-[26px]");
    expect(compacto).toContain("−10%");
    expect(destaque).toContain("−10%");
  });
});

describe("as proibições de design que valem para a vitrine", () => {
  it("não usa sombra difusa nem raio — o selo da embalagem é reto (§4.3/§4.4)", () => {
    const saida = html(<Preco preco={{ de: 6000, por: 5400 }} />);
    expect(saida).not.toMatch(/shadow-/);
    expect(saida).not.toMatch(/rounded/);
  });

  it("o preço em destaque NÃO é vermelho — o vermelho é do CTA (§4.1)", () => {
    const saida = html(<Preco preco={{ de: 6000, por: 5400 }} />);
    // O vermelho aparece uma vez só, no fundo do selo.
    expect(saida.match(/vermelho/g)?.length).toBe(1);
    expect(saida).toContain("bg-vermelho");
  });
});
