import type { ReactElement } from "react";
import { describe, it, expect, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

/**
 * A tela de café inexistente.
 *
 * O `usePathname` É DUBLADO porque ele é a única fonte de idioma que esta tela
 * tem: `not-found.tsx` não recebe `params` do App Router. O que se verifica
 * aqui é justamente essa leitura — que os dois endereços do português (com e
 * sem o prefixo interno do rewrite) caem em `pt`, e que a saída oferecida
 * continua no idioma de quem se perdeu.
 */
let caminhoAtual = "/cafes/inexistente";
vi.mock("next/navigation", () => ({
  usePathname: () => caminhoAtual,
}));

import { CafeNaoEncontrado } from "./CafeNaoEncontrado";
import { lotesDoLocale } from "@/lib/catalogo/produtos";

function html(caminho: string): string {
  caminhoAtual = caminho;
  return renderToStaticMarkup(
    telaCom(lotesDoLocale("pt").slice(0, 4)),
  );
}

function telaCom(sugestoes: ReturnType<typeof lotesDoLocale>): ReactElement {
  return <CafeNaoEncontrado sugestoes={sugestoes} />;
}

describe("CafeNaoEncontrado", () => {
  it("lê o idioma do endereço, dos dois lados do rewrite", () => {
    // `/cafes/x` é o que o navegador mostra; `/pt/cafes/x` é o que o rewrite
    // do middleware entrega por dentro. Os dois são português.
    expect(html("/cafes/inexistente")).toContain(
      "Esse café não está no catálogo.",
    );
    expect(html("/pt/cafes/inexistente")).toContain(
      "Esse café não está no catálogo.",
    );
    expect(html("/en/cafes/inexistente")).toContain(
      "That coffee is not in the catalogue.",
    );
    expect(html("/es/cafes/inexistente")).toContain(
      "Ese café no está en el catálogo.",
    );
  });

  it("explica o que aconteceu, sem pedir desculpa (§11)", () => {
    const en = html("/en/cafes/inexistente");
    expect(en).toContain("we roast in small batches");
    expect(en).not.toContain("Sorry");
  });

  it("mantém o idioma na saída — era o único link cru da vitrine", () => {
    // Contrato de lib/i18n/rotas: pt não ganha prefixo, en e es sim. O
    // `href="/cafes"` literal jogava para o português quem clicasse em /en.
    expect(html("/cafes/inexistente")).toContain('href="/cafes"');
    expect(html("/en/cafes/inexistente")).toContain('href="/en/cafes"');
    expect(html("/es/cafes/inexistente")).toContain('href="/es/cafes"');
  });

  it("traduz também os cafés oferecidos como saída", () => {
    // Os lotes chegam do servidor em português: sem `traduzirLote` aqui, a
    // tela ficava em inglês com quatro cards em português embaixo.
    const en = html("/en/cafes/inexistente");
    expect(en).toContain("Dark roast");
    expect(en).not.toContain("Torra escura");
    // E o card leva o idioma junto no link, como na PLP.
    expect(en).toContain('href="/en/cafes/');
  });

  it("oferece o catálogo com o mesmo nome do resto do site", () => {
    expect(html("/en/cafes/inexistente")).toContain("Browse all coffees");
    expect(html("/es/cafes/inexistente")).toContain("Ver todos los cafés");
  });
});
