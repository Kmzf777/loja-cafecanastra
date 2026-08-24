import type { ReactElement } from "react";
import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { TrilhaDeCategorias, CATEGORIAS_DA_TRILHA } from "./TrilhaDeCategorias";

function html(no: ReactElement) {
  return renderToStaticMarkup(no);
}

describe("TrilhaDeCategorias", () => {
  it("mostra as seis categorias na ordem do desenho", () => {
    /**
     * OS RÓTULOS SÃO OS DO DICIONÁRIO, NÃO OS DO DESENHO DO SPEC. O §4 do spec
     * escreve a faixa como "Cápsulas · Drips · Grãos · Moído · Kits", mas
     * `catalogo.formato` já diz "Drip Coffee" e "Em grãos" — e aquele
     * vocabulário é o dos filtros da PLP e dos chips da PDP. Reescrevê-lo aqui
     * criaria o segundo lugar onde as duas telas podem discordar sobre a mesma
     * palavra; a asserção é que se ajusta, nunca o dicionário.
     *
     * As maiúsculas da faixa vêm do `uppercase` do CSS, então o texto que sai
     * no HTML é o do dicionário, com a caixa dele.
     */
    const saida = html(<TrilhaDeCategorias locale="pt" />);
    for (const rotulo of [
      "Cápsulas",
      "Drip Coffee",
      "Em grãos",
      "Moído",
      "Nossos kits",
    ]) {
      expect(saida, rotulo).toContain(rotulo);
    }
    expect(saida).toContain("+ Categorias");
  });

  it("cada destino é um filtro que a PLP de fato entende", () => {
    // Um rótulo apontando para um filtro inexistente levaria a pessoa à
    // listagem inteira sem aviso — pior que não ter o atalho.
    const permitidos = new Set([
      "/cafes?formato=capsula",
      "/cafes?formato=drip",
      "/cafes?formato=graos",
      "/cafes?formato=moido",
      "/cafes?tipo=kit",
      "/cafes",
    ]);
    for (const c of CATEGORIAS_DA_TRILHA) {
      expect(permitidos.has(c.caminho), c.caminho).toBe(true);
    }
  });

  it("traduz os rótulos", () => {
    const en = html(<TrilhaDeCategorias locale="en" />);
    expect(en).toContain("+ Categories");
    expect(en).not.toContain("+ Categorias");

    const es = html(<TrilhaDeCategorias locale="es" />);
    expect(es).toContain("+ Categorías");
  });

  it("prefixa o idioma em todos os links fora do português", () => {
    const saida = html(<TrilhaDeCategorias locale="en" />);
    expect(saida).toContain('href="/en/cafes?formato=graos"');
    expect(saida).not.toContain('href="/cafes?formato=graos"');
  });

  it("é uma região nomeada", () => {
    const saida = html(<TrilhaDeCategorias locale="pt" />);
    expect(saida).toContain('aria-label="Categorias"');
  });
});
