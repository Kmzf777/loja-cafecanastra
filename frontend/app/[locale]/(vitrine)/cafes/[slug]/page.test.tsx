import { describe, it, expect, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

/**
 * A PDP inteira, nos três idiomas — estetica.md §7.3.
 *
 * A PÁGINA É RENDERIZADA DE VERDADE, e não só espiada por dentro: ela é um
 * Server Component assíncrono, então o teste a aguarda e serializa a árvore
 * com `renderToStaticMarkup`. É o que permite conferir de uma vez a trilha, o
 * JSON-LD, o cartão de preparo e a seção de relacionados — as quatro partes
 * onde o texto estava cravado em português mesmo com o dicionário em escopo.
 *
 * SEM REDE: o repositório tenta a API e cai no JSON do catálogo quando ela não
 * responde, que é o caso aqui; `agregadoAprovadas` faz o mesmo e devolve
 * `null`. A sacola é dublada porque o <PainelCompra> exige o provedor.
 */
vi.mock("@/lib/sacola/sacola", () => ({
  useSacola: () => ({ adicionar: async () => {}, itens: [] }),
}));

import PaginaLote, { generateMetadata } from "./page";

async function html(locale: string, slug = "microlote"): Promise<string> {
  const arvore = await PaginaLote({ params: Promise.resolve({ locale, slug }) });
  return renderToStaticMarkup(arvore);
}

describe("PDP — metadata", () => {
  it("anuncia o café que não existe no idioma pedido", async () => {
    const en = await generateMetadata({
      params: Promise.resolve({ locale: "en", slug: "nao-existe" }),
    });
    const es = await generateMetadata({
      params: Promise.resolve({ locale: "es", slug: "nao-existe" }),
    });

    expect(en.title).toBe("Coffee not found");
    expect(es.title).toBe("Café no encontrado");
  });

  it("descreve o café ao buscador no idioma da página, inteira", async () => {
    const en = await generateMetadata({
      params: Promise.resolve({ locale: "en", slug: "microlote" }),
    });

    // A descrição é costurada: editorial traduzido + a emenda do dicionário +
    // a pontuação SCA. Bastava a emenda ficar em português para o cartão de
    // resultado sair bilíngue.
    expect(en.description).toContain("Tasting notes:");
    expect(en.description).not.toContain("Notas de");
    // `og:locale` cravado em pt_BR dizia ao Facebook que /en era português.
    expect(en.openGraph?.locale).toBe("en_US");

    const pt = await generateMetadata({
      params: Promise.resolve({ locale: "pt", slug: "microlote" }),
    });
    expect(pt.description).toContain("Notas de");
    expect(pt.openGraph?.locale).toBe("pt_BR");
  });
});

describe("PDP — a página em três idiomas", () => {
  it("traduz a trilha, visível e no JSON-LD", async () => {
    const en = await html("en");

    expect(en).toContain('aria-label="Breadcrumb"');
    // O breadcrumb estruturado tem de dizer o mesmo que o visível: um
    // "Início" em JSON numa página em inglês é o rótulo que o buscador mostra.
    expect(en).toContain('"name":"Home"');
    expect(en).not.toContain('"name":"Início"');

    const pt = await html("pt");
    expect(pt).toContain('"name":"Início"');
  });

  it("traduz a faixa editorial e a frase de resumo", async () => {
    const en = await html("en");
    expect(en).toContain("About this line");
    // A região vem inteira do catálogo — "Serra da Canastra — Minas Gerais".
    expect(en).toContain("Single origin from the Serra da Canastra —");
    expect(en).toContain("Brews best as");

    const es = await html("es");
    expect(es).toContain("Sobre esta línea");
    expect(es).toContain("Origen único de la Serra da Canastra —");
    expect(es).toContain("Rinde mejor en");
  });

  it("traduz o cartão de preparo, rótulo E espessura da moagem", async () => {
    // A espessura ("Média-fina") é a linha que mais resistiu: ela não vem do
    // dicionário nem do editorial, e sim de `Preparo.moagem`, string livre.
    const en = await html("en");
    expect(en).toContain("How to brew");
    expect(en).toContain("Ratio");
    expect(en).toContain("Grind size");
    expect(en).toContain("Medium-fine");
    expect(en).not.toContain("Média-fina");
    expect(en).not.toContain("Proporção");
    expect(en).not.toContain("Temperatura");
  });

  it("traduz a seção de relacionados e o preço mínimo", async () => {
    const en = await html("en");
    expect(en).toContain("From the same serra");
    expect(en).toContain("from R$");
    expect(en).not.toContain("Da mesma serra");
    expect(en).not.toContain("a partir de");
  });

  it("traduz a lista de formatos que não entram no seletor", async () => {
    // A Canela é a linha que tem drip e cápsula — os dois formatos sem peso
    // nem moagem a escolher, listados à parte com o estoque real.
    const en = await html("en", "canela");
    expect(en).toContain("Also in this line");
    expect(en).not.toContain("Também nesta linha");
    // Todos os formatos capturados dela estão sem preço: é o caso vivo do
    // "Sold out" que antes saía em português.
    expect(en).toContain("Sold out");
    expect(en).not.toContain(">Esgotado<");
  });

  it("mantém o idioma em todo link interno da página", async () => {
    const es = await html("es");
    expect(es).toContain('href="/es/cafes"');
    expect(es).toContain('href="/es/cafes/');
    // Nenhum link de vitrine sem prefixo numa página em espanhol. O da sacola
    // e o do checkout não estão nesta página — são da moldura.
    expect(es).not.toContain('href="/cafes"');
  });
});
