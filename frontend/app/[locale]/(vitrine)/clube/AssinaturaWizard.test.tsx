import type { ReactElement } from "react";
import { describe, it, expect, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

/**
 * O primeiro passo do wizard do Clube — e o piso de alvo de toque dos botões
 * de escolha.
 *
 * SEM DOM, como PainelCompra.test.tsx: o vitest.config.ts roda em ambiente
 * `node`, e `renderToStaticMarkup` não executa efeito. O que se lê aqui é o
 * PASSO 1 no estado inicial, que é o que a pessoa vê ao abrir /clube. Os
 * passos 2 e 3 só existem depois de um clique e ficam fora — a frequência foi
 * medida em Playwright junto com o resto (48px nos três idiomas).
 *
 * O ROTEADOR É DUBLADO porque `useRouter` do app router exige estar montado, e
 * este componente o chama na primeira linha. Nada aqui exercita navegação: o
 * dublê existe só para o render acontecer.
 *
 * O NÚMERO REAL veio do Playwright a 360×800: todo botão de escolha do wizard
 * media 41,5px de altura, 15 alvos somando os três idiomas, abaixo dos 44 do
 * §10. Este teste guarda a classe que produz os 48px de hoje — apagá-la é o
 * caminho de volta da regressão.
 */
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: () => {}, replace: () => {}, refresh: () => {} }),
}));

import { AssinaturaWizard } from "./AssinaturaWizard";
import { opcoesDoClube } from "@/lib/clube";
import { lotesDoLocale } from "@/lib/catalogo/produtos";
import type { Locale } from "@/lib/i18n/tipos";

function html(no: ReactElement) {
  return renderToStaticMarkup(no);
}

function wizard(locale: Locale) {
  return html(
    <AssinaturaWizard opcoes={opcoesDoClube(lotesDoLocale(locale))} locale={locale} />,
  );
}

/** Cada `<button>` do markup, como pedaço de texto, para inspeção de classe. */
function botoes(saida: string) {
  return saida.split("<button").slice(1);
}

describe("AssinaturaWizard", () => {
  it("dá 44px de alvo a todo botão de escolha, nos três idiomas", () => {
    for (const locale of ["pt", "en", "es"] as const) {
      const escolhas = botoes(wizard(locale)).filter((b) =>
        b.includes("aria-pressed"),
      );
      // Café, moagem e peso — o passo 1 inteiro. Se este número cair a zero o
      // teste vira decoração, então ele também é verificado.
      expect(escolhas.length, `escolhas em ${locale}`).toBeGreaterThan(4);
      for (const botao of escolhas) {
        expect(botao, `botão de escolha em ${locale}`).toContain("min-h-12");
      }
    }
  });

  it("mantém os 48px do contador de pacotes, que já os tinha", () => {
    // O piso novo não podia ser desculpa para mexer no que já passava: o
    // `−`/`+` é quadrado de 48px desde sempre.
    expect(wizard("pt")).toContain("h-12 w-12");
  });

  it("abre no passo 1 de 3", () => {
    // Em Martian Mono, com a caixa alta vindo do CSS (§7.4) — por isso o texto
    // no markup está em caixa mista.
    expect(wizard("pt")).toContain("Passo 1 de 3");
    expect(wizard("en")).toContain("Step 1 of 3");
    expect(wizard("es")).toContain("Paso 1 de 3");
  });
});
