import type { ReactElement } from "react";
import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import { FichaLavoura } from "./FichaLavoura";
import { lotesDoLocale } from "@/lib/catalogo/produtos";
import type { Lote } from "@/lib/catalogo/tipos";

/**
 * A ficha da PDP — estetica.md §5.4.
 *
 * O QUE ESTE ARQUIVO PROTEGE: a ficha existe para ensinar o vocabulário a quem
 * não o tem, e a DEFINIÇÃO importa tanto quanto o rótulo. Um "Roast" com a
 * explicação em português deixa o leitor exatamente onde ele estava — por isso
 * as duas metades são verificadas juntas, em cada idioma.
 */

function html(no: ReactElement) {
  return renderToStaticMarkup(no);
}

const MICROLOTE = lotesDoLocale("pt").find(
  (l) => l.slug === "microlote",
) as Lote;

describe("FichaLavoura", () => {
  it("traduz o rótulo E a definição de cada linha", () => {
    const en = html(<FichaLavoura lote={MICROLOTE} locale="en" />);
    expect(en).toContain("Coffee spec sheet");
    expect(en).toContain("Origin");
    expect(en).toContain("The region where the coffee was grown");

    const es = html(<FichaLavoura lote={MICROLOTE} locale="es" />);
    expect(es).toContain("Ficha del café");
    expect(es).toContain("Puntuación");
    expect(es).toContain("cata a ciegas");
  });

  it("não deixa rótulo em português na ficha traduzida", () => {
    const en = html(<FichaLavoura lote={MICROLOTE} locale="en" />);
    for (const rotulo of ["Origem", "Torra", "Pontuação", "Preparo"]) {
      expect(en, rotulo).not.toContain(`>${rotulo}<`);
    }
  });

  it("chega recolhida, sempre — a ordem do §7.3 é inegociável", () => {
    // Nota de sabor acima de dado técnico: a ficha não pode nascer aberta
    // empurrando a nota para fora da primeira dobra.
    const saida = html(<FichaLavoura lote={MICROLOTE} locale="pt" />);
    expect(saida).toContain("<details");
    expect(saida).not.toContain("<details open");
  });

  it("continua em português quando ninguém passa idioma", () => {
    expect(html(<FichaLavoura lote={MICROLOTE} />)).toContain("Ficha do café");
  });
});
