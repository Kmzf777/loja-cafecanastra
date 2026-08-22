import { afterEach, describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import { BotaoWhatsApp } from "./BotaoWhatsApp";
import { dicionario } from "@/lib/i18n/dicionario";
import { LOCALES } from "@/lib/i18n/tipos";

/**
 * O botão flutuante NÃO TEM TEXTO NA TELA: o nome acessível e o tooltip são a
 * peça inteira, e eles acompanham a moldura em /en e /es como em qualquer
 * outra rota. Estavam cravados em português.
 */
const ENV = process.env.NEXT_PUBLIC_WHATSAPP;

afterEach(() => {
  process.env.NEXT_PUBLIC_WHATSAPP = ENV;
});

function html(locale: (typeof LOCALES)[number]) {
  process.env.NEXT_PUBLIC_WHATSAPP = "+55 37 99999-0000";
  return renderToStaticMarkup(<BotaoWhatsApp locale={locale} />);
}

describe("BotaoWhatsApp", () => {
  it("nomeia o botão no idioma da página", () => {
    for (const locale of LOCALES) {
      const rotulo = dicionario(locale).comum.falarNoWhatsApp;
      const saida = html(locale);

      expect(saida).toContain(`aria-label="${rotulo}"`);
      expect(saida).toContain(`title="${rotulo}"`);
    }
  });

  it("dá nomes diferentes em idiomas diferentes", () => {
    // Sem isto, uma chave copiada do português passaria no teste acima.
    const nomes = LOCALES.map((l) => dicionario(l).comum.falarNoWhatsApp);

    expect(new Set(nomes).size).toBe(LOCALES.length);
  });

  it("mantém WhatsApp como nome próprio nos três idiomas", () => {
    for (const locale of LOCALES) {
      expect(dicionario(locale).comum.falarNoWhatsApp).toContain("WhatsApp");
    }
  });

  it("não renderiza nada sem a env — link que abre conversa com ninguém", () => {
    process.env.NEXT_PUBLIC_WHATSAPP = "";

    expect(renderToStaticMarkup(<BotaoWhatsApp locale="pt" />)).toBe("");
  });

  it("abre em outra aba com rel=noopener, porque sai da loja", () => {
    const saida = html("pt");

    expect(saida).toContain('target="_blank"');
    expect(saida).toContain("noopener");
  });
});
