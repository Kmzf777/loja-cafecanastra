import type { ReactElement } from "react";
import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import { PontoTorra } from "./PontoTorra";

/**
 * A régua de torra do §5.3, e o defeito que este arquivo trava é o mais
 * traiçoeiro da leva: o componente JÁ recebia `locale` e JÁ o usava — para o
 * degrau. As pontas do eixo e o "de 5" continuavam cravados em português, e o
 * resultado em /en era "Dark roast" com "Clara" e "Escura" em cima dele.
 *
 * O `aria-label` é a metade que não aparece na captura de tela e vale mais:
 * ele vai em cada card da home, da PLP e no bloco da PDP, e quem o lê é quem
 * não enxerga a barra — exatamente a pessoa para quem o §5.3 exige que o valor
 * textual exista.
 */

function html(no: ReactElement) {
  return renderToStaticMarkup(no);
}

describe("PontoTorra", () => {
  it("rotula a régua inteira no idioma da página", () => {
    const pt = html(<PontoTorra valor={5} />);
    expect(pt).toContain("Clara");
    expect(pt).toContain("Escura");
    expect(pt).toContain("Torra escura");
    expect(pt).toContain("5 de 5");

    const en = html(<PontoTorra valor={5} locale="en" />);
    expect(en).toContain("Light");
    expect(en).toContain("Dark");
    expect(en).toContain("Dark roast");
    expect(en).toContain("5 of 5");

    const es = html(<PontoTorra valor={5} locale="es" />);
    // Masculino: quem concorda em espanhol é `tueste`, não `torra`.
    expect(es).toContain("Claro");
    expect(es).toContain("Oscuro");
    expect(es).toContain("Tueste oscuro");
    expect(es).toContain("5 de 5");
  });

  it("não deixa ponta de régua em português fora do pt", () => {
    const en = html(<PontoTorra valor={3} locale="en" />);
    for (const vazamento of ["Clara", "Escura", "de 5"]) {
      expect(en, vazamento).not.toContain(vazamento);
    }
  });

  it("o aria-label do card compacto fala a mesma língua do card", () => {
    // É o texto que o leitor de tela lê no lugar da barra, e ele saía
    // "Dark roast, 5 de 5" — metade em cada idioma.
    expect(html(<PontoTorra valor={5} compacto locale="en" />)).toContain(
      'aria-label="Dark roast, 5 of 5"',
    );
    expect(html(<PontoTorra valor={2} compacto locale="es" />)).toContain(
      'aria-label="Tueste claro-medio, 2 de 5"',
    );
    expect(html(<PontoTorra valor={2} compacto />)).toContain(
      'aria-label="Torra clara-média, 2 de 5"',
    );
  });

  it("o valor textual acompanha a barra SEMPRE — §5.3 é explícito", () => {
    // A barra sozinha não é acessível, e a forma compacta é a que mais tenta
    // encolher: ela é a que aparece dentro do card.
    const compacto = html(<PontoTorra valor={1} compacto locale="en" />);
    expect(compacto).toContain("Light roast");
  });

  it("continua em português quando ninguém passa idioma", () => {
    expect(html(<PontoTorra valor={4} />)).toContain("Torra média-escura");
  });
});
