import type { ReactElement } from "react";
import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { Carrossel, SlideDoCarrossel, LARGURA_DO_SLIDE } from "./Carrossel";

function html(no: ReactElement) {
  return renderToStaticMarkup(no);
}

const FILHOS = [
  <div key="a">Primeiro</div>,
  <div key="b">Segundo</div>,
  <div key="c">Terceiro</div>,
];

describe("Carrossel", () => {
  it("entrega o conteúdo no HTML do servidor", () => {
    // A home é estática. Se o conteúdo só existisse depois da hidratação, o
    // buscador veria um trilho vazio e a primeira pintura não venderia nada.
    const saida = html(<Carrossel rotulo="Mais vendidos">{FILHOS}</Carrossel>);
    expect(saida).toContain("Primeiro");
    expect(saida).toContain("Segundo");
    expect(saida).toContain("Terceiro");
  });

  it("arrasta sem JavaScript", () => {
    // §12 do estetica.md: a loja opera com JS desligado. A base é
    // scroll-snap; o Embla é melhoria, não requisito.
    const saida = html(<Carrossel rotulo="Mais vendidos">{FILHOS}</Carrossel>);
    expect(saida).toContain("overflow-x-auto");
    expect(saida).toContain("snap-x");
  });

  it("é uma região nomeada para quem navega por leitor de tela", () => {
    const saida = html(<Carrossel rotulo="Nossos kits">{FILHOS}</Carrossel>);
    expect(saida).toContain('aria-label="Nossos kits"');
    expect(saida).toContain('role="region"');
  });

  it("deixa sempre uma fração de card sobrando, em toda largura", () => {
    // O corte É o convite a arrastar. Um trilho que fecha certo na tela
    // parece grade, e ninguém arrasta uma grade.
    for (const largura of Object.values(LARGURA_DO_SLIDE)) {
      const pct = Number(largura.replace("%", ""));
      expect((100 / pct) % 1, `${largura} fecha certo`).not.toBe(0);
    }
  });

  it("mostra um card inteiro e o segundo cortado no telefone", () => {
    // O pedido literal do briefing: dois cards lado a lado, o segundo
    // levemente cortado pelo overflow.
    const pct = Number(LARGURA_DO_SLIDE.telefone.replace("%", ""));
    const visiveis = 100 / pct;
    expect(visiveis).toBeGreaterThan(1.5);
    expect(visiveis).toBeLessThan(2);
  });

  it("o slide de verdade usa as larguras documentadas", () => {
    // AMARRA OBRIGATÓRIA. O Tailwind não aceita classe montada em tempo de
    // execução, então `LARGURA_DO_SLIDE` não PODE gerar as classes — elas são
    // literais no componente. Sem este teste, as duas metades divergiriam em
    // silêncio: a constante diria 58% e o card mediria outra coisa, e os
    // outros quatro testes deste arquivo continuariam verdes provando nada.
    const saida = html(
      <SlideDoCarrossel>
        <span>Card</span>
      </SlideDoCarrossel>,
    );
    for (const largura of Object.values(LARGURA_DO_SLIDE)) {
      expect(saida, `largura ${largura}`).toContain(`basis-[${largura}]`);
    }
  });
});
