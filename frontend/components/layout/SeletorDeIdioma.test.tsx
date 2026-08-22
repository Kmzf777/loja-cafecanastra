import type { ReactElement } from "react";
import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { SeletorDeIdioma } from "./SeletorDeIdioma";

/**
 * O componente não tem estado: o que ele decide é markup — para onde cada link
 * aponta, quem carrega `aria-current`, qual o nome acessível. Por isso o teste
 * renderiza para string com `react-dom/server` e lê o HTML, em vez de montar um
 * DOM. Sem jsdom, sem testing-library, sem dependência nova.
 *
 * ATENÇÃO À CONFIGURAÇÃO: `frontend/vitest.config.ts` hoje só coleta arquivos
 * terminados em `.test.ts`, não resolve o alias `@` e herda `jsx: "preserve"`
 * do tsconfig do Next — este arquivo não roda sem os três ajustes. Estão
 * pedidos no relatório da tarefa; o arquivo de config é de outro dono.
 */

function html(no: ReactElement) {
  return renderToStaticMarkup(no);
}

describe("SeletorDeIdioma", () => {
  it("oferece os três idiomas com o nome por extenso no rótulo acessível", () => {
    const saida = html(<SeletorDeIdioma id="idioma" locale="pt" />);

    expect(saida).toContain('aria-label="Português"');
    expect(saida).toContain('aria-label="English"');
    expect(saida).toContain('aria-label="Español"');
  });

  it("marca só o idioma em vigor com aria-current", () => {
    const saida = html(<SeletorDeIdioma id="idioma" locale="en" />);

    expect(saida.match(/aria-current/g)).toHaveLength(1);
    // O aria-current tem de estar no mesmo link que se anuncia como English.
    expect(saida).toMatch(/aria-label="English"[^>]*aria-current="true"/);
  });

  it("mantém a página ao trocar de idioma: o caminho atual vai nos três links", () => {
    const saida = html(
      <SeletorDeIdioma id="idioma" locale="pt" caminho="/cafes" />,
    );

    // Contrato do href() de lib/i18n/rotas: pt não ganha prefixo, en e es sim.
    expect(saida).toContain('href="/cafes"');
    expect(saida).toContain('href="/en/cafes"');
    expect(saida).toContain('href="/es/cafes"');
  });

  it("sem caminho, cai na home do idioma — nunca num link vazio", () => {
    const saida = html(<SeletorDeIdioma id="idioma" locale="es" />);

    expect(saida).toContain('href="/"');
    expect(saida).toContain('href="/en"');
    expect(saida).toContain('href="/es"');
    expect(saida).not.toContain('href=""');
  });

  it("declara o idioma de cada link em BCP 47, com pt-BR no português", () => {
    const saida = html(<SeletorDeIdioma id="idioma" locale="pt" />);

    // O React serializa o atributo como `hrefLang`; em HTML nome de atributo
    // não distingue caixa, então a asserção também não pode distinguir.
    expect(saida).toMatch(/hreflang="pt-BR"/i);
    expect(saida).toContain('lang="pt-BR"');
    expect(saida).toMatch(/hreflang="en"/i);
    expect(saida).toMatch(/hreflang="es"/i);
  });

  it("nomeia o grupo no idioma em vigor", () => {
    expect(html(<SeletorDeIdioma id="a" locale="pt" />)).toContain("Idioma");
    expect(html(<SeletorDeIdioma id="a" locale="en" />)).toContain("Language");
    expect(html(<SeletorDeIdioma id="a" locale="es" />)).toContain("Idioma");
  });

  it("amarra a lista ao rótulo pelo id da instância", () => {
    const saida = html(<SeletorDeIdioma id="idioma-mobile" locale="pt" />);

    expect(saida).toContain('id="idioma-mobile-rotulo"');
    expect(saida).toContain('aria-labelledby="idioma-mobile-rotulo"');
  });

  it("respeita o alvo de toque de 44px nas duas variantes", () => {
    // Classe é detalhe de estilo em quase todo lugar, menos aqui: 44px é
    // requisito de acessibilidade (estetica.md §10) e some sem fazer barulho.
    const painel = html(<SeletorDeIdioma id="a" locale="pt" variante="painel" />);
    const barra = html(<SeletorDeIdioma id="b" locale="pt" variante="barra" />);

    expect(painel).toContain("h-14 w-full min-w-11");
    expect(barra).toContain("h-11 w-11");
    // Uma célula não pode carregar w-full e w-11 ao mesmo tempo: qual vence
    // passa a depender da ordem da folha do Tailwind, não deste arquivo.
    expect(barra).not.toContain("w-full");
  });

  it("mostra o rótulo no painel e o esconde na barra", () => {
    const painel = html(<SeletorDeIdioma id="a" locale="pt" variante="painel" />);
    const barra = html(<SeletorDeIdioma id="b" locale="pt" variante="barra" />);

    expect(painel).not.toContain('class="sr-only"');
    expect(barra).toContain('class="sr-only"');
  });

  it("dá foco visível em vermelho com offset de 3px em todo link", () => {
    const saida = html(<SeletorDeIdioma id="a" locale="pt" />);
    const focos = saida.match(
      /focus-visible:outline-2 focus-visible:outline-offset-\[3px\] focus-visible:outline-vermelho/g,
    );

    expect(focos).toHaveLength(3);
  });

  it("desenha as três bandeiras inline, sem <img> e sem biblioteca", () => {
    const saida = html(<SeletorDeIdioma id="a" locale="pt" />);

    expect(saida).toContain('data-bandeira="pt"');
    expect(saida).toContain('data-bandeira="en"');
    expect(saida).toContain('data-bandeira="es"');
    expect(saida).not.toContain("<img");
  });

  it("não repete o id do clipPath quando as duas variantes convivem na página", () => {
    // O cabeçalho renderiza as duas ao mesmo tempo (uma escondida por CSS).
    // clipPath com id repetido faz o segundo SVG recortar pelo primeiro.
    const pagina =
      html(<SeletorDeIdioma id="idioma-mobile" locale="pt" />) +
      html(<SeletorDeIdioma id="idioma-desktop" locale="pt" variante="barra" />);

    const ids = pagina.match(/<clipPath id="([^"]+)"/g) ?? [];

    expect(ids).toHaveLength(2);
    expect(new Set(ids).size).toBe(2);
  });
});
