import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import { Rodape } from "./Rodape";
import { dicionario } from "@/lib/i18n/dicionario";
import { LOCALES, type Locale } from "@/lib/i18n/tipos";

function html(locale: Locale) {
  return renderToStaticMarkup(<Rodape locale={locale} />);
}

/** As linhas das quatro colunas — um <li> para cada alvo clicável. */
function linhasDeColuna(saida: string): string[] {
  return saida.match(/<li\b[^>]*>[\s\S]*?<\/li>/g) ?? [];
}

describe("Rodape", () => {
  describe("alvo de toque", () => {
    it("dá 44px de altura a TODA linha de coluna", () => {
      // estetica.md, checklist de acessibilidade: alvos ≥44×44px. O rodapé
      // era a última superfície da loja fora da regra — 15px de texto sem
      // padding nenhum davam 16px de caixa, medidos em 360px.
      const linhas = linhasDeColuna(html("pt"));

      expect(linhas.length).toBeGreaterThan(10);
      for (const linha of linhas) {
        expect(linha, linha.slice(0, 120)).toContain("min-h-11");
      }
    });

    it("cobre também o botão de rever cookies, que não é link", () => {
      // Ele exerce um direito da LGPD e mora no meio da coluna Ajuda: se o
      // dedo não o acerta, o consentimento é fácil de dar e difícil de tirar.
      const linha = linhasDeColuna(html("pt")).find((l) =>
        l.includes(dicionario("pt").cookies.rever),
      );

      expect(linha).toBeDefined();
      expect(linha).toContain("<button");
      expect(linha).toContain("min-h-11");
    });

    it("alarga a caixa sem mover o texto", () => {
      // "Suave" media 42px de largura — abaixo dos 44 — e passa a 58px com
      // `px-2`. O `-mx-2` é o que devolve o texto ao alinhamento da coluna.
      const linhas = linhasDeColuna(html("pt"));

      for (const linha of linhas) {
        expect(linha).toContain("-mx-2");
        expect(linha).toContain("px-2");
      }
    });

    it("traz o foco para dentro, porque as caixas agora se tocam", () => {
      // Um contorno para fora invadiria a linha vizinha.
      for (const linha of linhasDeColuna(html("pt"))) {
        expect(linha).toContain("-outline-offset-2");
        expect(linha).not.toContain("outline-offset-[3px]");
      }
    });
  });

  describe("idioma", () => {
    it("traduz o alt do lockup, que aqui é o único texto da marca", () => {
      // No cabeçalho o `aria-label` do link cobre o nome acessível; aqui a
      // imagem não está dentro de link nenhum.
      for (const locale of LOCALES) {
        expect(html(locale)).toContain(
          `alt="${dicionario(locale).comum.logoAlt}"`,
        );
      }
    });

    it("dá um alt diferente em cada idioma", () => {
      const alts = LOCALES.map((l) => dicionario(l).comum.logoAlt);

      expect(new Set(alts).size).toBe(LOCALES.length);
    });

    it("preserva Café Canastra como nome próprio nos três", () => {
      for (const locale of LOCALES) {
        expect(dicionario(locale).comum.logoAlt).toContain("Café Canastra");
      }
    });

    it("prefixa os caminhos internos com o idioma, e só eles", () => {
      const saida = html("en");

      expect(saida).toContain('href="/en/cafes"');
      expect(saida).toContain('href="/en/termos-de-uso"');
      // Nome próprio de lugar: igual nos três idiomas.
      expect(saida).toContain("Serra da Canastra");
    });
  });
});
