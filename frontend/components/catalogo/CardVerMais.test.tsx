import type { ReactElement } from "react";
import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { CardVerMais } from "./CardVerMais";

function html(no: ReactElement) {
  return renderToStaticMarkup(no);
}

describe("CardVerMais", () => {
  it("leva ao destino que recebeu", () => {
    const saida = html(
      <CardVerMais caminho="/cafes?destaque=mais-vendidos" locale="pt" />,
    );
    expect(saida).toContain('href="/cafes?destaque=mais-vendidos"');
  });

  it("prefixa o idioma fora do português", () => {
    const saida = html(<CardVerMais caminho="/cafes?tipo=kit" locale="es" />);
    expect(saida).toContain('href="/es/cafes?tipo=kit"');
  });

  it("fala o idioma da página", () => {
    expect(html(<CardVerMais caminho="/cafes" locale="pt" />)).toContain(
      "Ver mais",
    );
    expect(html(<CardVerMais caminho="/cafes" locale="en" />)).toContain(
      "See more",
    );
    expect(html(<CardVerMais caminho="/cafes" locale="es" />)).toContain(
      "Ver más",
    );
  });
});
