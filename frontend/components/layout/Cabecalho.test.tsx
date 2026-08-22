import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

/**
 * O Cabeçalho é Server Component, mas embarca três ilhas client — a sacola, o
 * aviso de frete e o seletor de idioma. Duas delas leem coisas que não existem
 * fora do navegador (contexto da sacola, `usePathname`), então são mockadas:
 * o que se testa aqui é a MARCAÇÃO que o cabeçalho monta, não o que aquelas
 * peças fazem por conta própria (elas têm teste separado).
 */
const estado = vi.hoisted(() => ({ quantidade: 0 }));

vi.mock("@/lib/sacola/sacola", () => ({
  useSacola: () => ({ quantidadeTotal: estado.quantidade }),
}));

vi.mock("next/navigation", () => ({
  usePathname: () => "/cafes",
}));

import { Cabecalho } from "./Cabecalho";
import { dicionario } from "@/lib/i18n/dicionario";
import { LOCALES, type Locale } from "@/lib/i18n/tipos";

function html(locale: Locale, quantidade = 0) {
  estado.quantidade = quantidade;
  return renderToStaticMarkup(<Cabecalho locale={locale} />);
}

/** Os dois <a href="/sacola"> da página: o da barra e o do telefone. */
function sacolas(saida: string): string[] {
  return (saida.match(/<a\b[^>]*>/g) ?? []).filter((t) =>
    t.includes('href="/sacola"'),
  );
}

describe("Cabecalho", () => {
  it("traduz o alt do logotipo em vez de descrever a embalagem", () => {
    for (const locale of LOCALES) {
      expect(html(locale)).toContain(`alt="${dicionario(locale).comum.logoAlt}"`);
    }
  });

  it("pede a sacola em glifo na barra de telefone e por extenso na de desktop", () => {
    // As duas instâncias convivem na mesma marcação: a de desktop mora num
    // `hidden xl:flex`, a de telefone num `xl:hidden`. É a variante que decide
    // qual desenho cada uma recebe — e o desenho do telefone é o que devolveu
    // a barra de 360px para dentro da tela.
    const caixas = sacolas(html("pt", 12));

    expect(caixas).toHaveLength(2);
    expect(caixas.filter((c) => c.includes("size-11"))).toHaveLength(1);
  });

  it("não deixa a contagem mexer na largura da barra de telefone", () => {
    // O defeito: com 12 itens o documento ganhava 2px de rolagem horizontal em
    // 360px, porque a contagem entrava no fluxo da linha. O `aria-label` muda
    // com a quantidade — é o que o leitor de tela precisa ouvir —, mas a
    // CLASSE, que é quem decide a caixa, não pode mudar.
    const classe = (saida: string) =>
      sacolas(saida)
        .find((c) => c.includes("size-11"))
        ?.match(/class="([^"]*)"/)?.[1];

    expect(classe(html("pt", 0))).toBe(classe(html("pt", 12)));
  });

  it("leva o idioma para toda a navegação, inclusive a busca", () => {
    const saida = html("en");

    for (const caminho of ["/cafes", "/clube", "/a-serra", "/historia"]) {
      expect(saida).toContain(`href="/en${caminho}"`);
    }
    // O form de busca cai na PLP do idioma: pesquisar não pode ser um jeito de
    // sair do inglês sem perceber.
    expect(saida).toContain('action="/en/cafes"');
  });

  it("mantém a conta fora da barra de telefone e dentro do acordeão", () => {
    const saida = html("pt");

    // O único /account de nível de barra é o da variante de desktop; o outro
    // está no painel do <details>, com o rótulo por extenso.
    expect(saida).toContain(dicionario("pt").nav.minhaConta);
    expect(saida.match(/href="\/account"/g)).toHaveLength(2);
  });

  it("nomeia o botão do menu pelo texto visível, que troca ao abrir", () => {
    // Sem `aria-label` fixo: um "Abrir menu" cravado mentiria com o painel
    // aberto.
    const saida = html("es");

    expect(saida).toContain(dicionario("es").nav.menu);
    expect(saida).toContain(dicionario("es").nav.fechar);
    expect(saida).not.toContain('aria-label="Abrir');
  });
});
