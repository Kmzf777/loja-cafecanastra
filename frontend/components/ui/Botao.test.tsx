import type { ReactElement } from "react";
import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import { Botao, BotaoLink } from "./Botao";

/**
 * As quatro variantes do §5.7 — e, principalmente, o piso de alvo de toque.
 *
 * SEM DOM, pelo caminho do PainelCompra.test.tsx: o vitest.config.ts roda em
 * ambiente `node`, então o que se verifica aqui é MARKUP. A altura em pixels
 * de verdade só uma engine de layout sabe, e essa foi medida em Playwright a
 * 360×800 (a variante `texto` fechava em ~13px de altura antes desta correção,
 * e passou a 44/48). O teste abaixo guarda a CLASSE que produz aquele número:
 * apagá-la é o jeito de a regressão voltar, e é isso que ele impede.
 */

function html(no: ReactElement) {
  return renderToStaticMarkup(no);
}

describe("Botao", () => {
  it("dá alvo de toque à variante 'texto', que é a única sem altura fixa", () => {
    // O BASE traz `leading-none`, então sem piso a caixa clicável de um link
    // de ação secundária fica da altura da letra. O §10 pede 44×44.
    const saida = html(<Botao variante="texto">Quero encerrar minha conta</Botao>);
    expect(saida).toContain("min-h-12");
    expect(saida).toContain("min-w-12");
  });

  it("não dá padding lateral ao 'texto' — ele é link, não caixa", () => {
    // `px-6` afastaria a palavra sublinhada da margem do bloco em que ela vive,
    // e o conserto do alvo de toque não pode mexer no desenho da página.
    expect(html(<Botao variante="texto">Deixar como está</Botao>)).not.toContain(
      "px-6",
    );
  });

  it("mantém os 48px de altura das outras três variantes", () => {
    for (const variante of ["primario", "primarioEscuro", "secundario"] as const) {
      expect(
        html(<Botao variante={variante}>Adicionar à sacola</Botao>),
        variante,
      ).toContain("h-12 px-6");
    }
  });

  it("aplica a mesma tabela de variantes no <BotaoLink>", () => {
    // O defeito medido estava justamente no link: <BotaoLink variante="texto">
    // é o que /a-serra, a home e /rastreabilidade usam para a ação secundária.
    const saida = html(
      <BotaoLink href="/historia" variante="texto">
        História
      </BotaoLink>,
    );
    expect(saida).toContain("<a");
    expect(saida).toContain("min-h-12");
    expect(saida).toContain("min-w-12");
  });

  it("deixa o foco visível em todas as variantes", () => {
    // §10: foco visível em 100% dos interativos. Sobre vermelho o outline
    // inverte para fuligem, senão some no próprio fundo.
    for (const variante of [
      "primario",
      "primarioEscuro",
      "secundario",
      "texto",
    ] as const) {
      expect(html(<Botao variante={variante}>x</Botao>), variante).toContain(
        "focus-visible:outline-2",
      );
    }
    expect(html(<Botao variante="primario">x</Botao>)).toContain(
      "focus-visible:outline-fuligem",
    );
  });
});
