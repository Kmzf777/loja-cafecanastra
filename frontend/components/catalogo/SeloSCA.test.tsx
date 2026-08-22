import type { ReactElement } from "react";
import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import { SeloSCA } from "./SeloSCA";
import { LOTES } from "@/lib/catalogo/produtos";

/**
 * A plaqueta do §5.1 — o componente-âncora da estética, e até aqui o único da
 * pasta sem teste nenhum.
 *
 * ELE ESTÁ EM TODO CARD E NA PDP, o que faz dele o texto em português mais
 * repetido de /en/cafes: "Especial" e "Gourmet" estavam cravados no JSX, nos
 * três idiomas. E ele carrega a afirmação mais delicada da vitrine — dizer
 * "especial" de um café que a SCA não classifica como especial é propaganda
 * enganosa no único selo que a marca usa para se provar. Por isso as duas
 * metades são verificadas juntas: o idioma E a classificação.
 */

function html(no: ReactElement) {
  return renderToStaticMarkup(no);
}

/** Quantas vezes um texto aparece na saída — a plaqueta em inglês tem um caso
 *  em que a mesma palavra poderia sair duas vezes. */
function vezes(saida: string, texto: string) {
  return saida.split(texto).length - 1;
}

const MICROLOTE = LOTES.find((l) => l.slug === "microlote")!;
const NECTAR = LOTES.find((l) => l.slug === "nectar-de-minas")!;

describe("SeloSCA", () => {
  it("classifica pelo número, não pelo marketing", () => {
    // 86 é especial; 75 é gourmet, e a embalagem do Néctar de Minas diz isso.
    const especial = html(<SeloSCA sca={MICROLOTE.sca} scaExata={MICROLOTE.scaExata} />);
    expect(especial).toContain("Especial");
    expect(especial).toContain("SCA 86");

    const gourmet = html(<SeloSCA sca={NECTAR.sca} scaExata={NECTAR.scaExata} />);
    expect(gourmet).toContain("Gourmet");
    expect(gourmet).toContain("SCA 75");
    expect(gourmet, "75 pontos não é café especial").not.toContain("Especial");
    expect(gourmet, "nem em inglês").not.toContain("Specialty");
  });

  it("diz a classificação no idioma de quem lê", () => {
    expect(html(<SeloSCA sca={80} scaExata={false} locale="en" />)).toContain(
      "Specialty",
    );
    expect(html(<SeloSCA sca={80} scaExata={false} locale="es" />)).toContain(
      "Especial",
    );
    expect(html(<SeloSCA sca={75} scaExata locale="en" />)).toContain("Gourmet");
  });

  it("não deixa a palavra em português na plaqueta em inglês", () => {
    const en = html(<SeloSCA sca={80} scaExata={false} locale="en" />);
    expect(en).not.toContain("Especial");
  });

  it("em inglês a sobrancelha some, porque repetiria a linha de baixo", () => {
    /**
     * A embalagem estampa "SPECIALTY" acima de "ESPECIAL" — a palavra em
     * inglês e a mesma palavra em português, uma sobre a outra. Numa página em
     * inglês a segunda linha TAMBÉM é "Specialty", e a plaqueta escreveria a
     * mesma palavra duas vezes. Em português e em espanhol as duas convivem, e
     * é assim que a caixa é.
     */
    expect(vezes(html(<SeloSCA sca={80} scaExata={false} locale="en" />), "Specialty")).toBe(1);
    expect(vezes(html(<SeloSCA sca={80} scaExata={false} locale="pt" />), "Specialty")).toBe(1);
    expect(html(<SeloSCA sca={80} scaExata={false} locale="pt" />)).toContain("Especial");
    expect(vezes(html(<SeloSCA sca={80} scaExata={false} locale="es" />), "Specialty")).toBe(1);
    expect(html(<SeloSCA sca={80} scaExata={false} locale="es" />)).toContain("Especial");
  });

  it("o chip do card também fala o idioma da página", () => {
    // A variante compacta é a que aparece na grade da PLP e da home — a
    // superfície mais repetida das duas.
    const en = html(
      <SeloSCA sca={80} scaExata={false} variante="compacto" locale="en" />,
    );
    expect(en).toContain("Specialty");
    expect(en).not.toContain("Especial");

    expect(
      html(<SeloSCA sca={75} scaExata variante="compacto" locale="es" />),
    ).toContain("Gourmet");
  });

  it("continua em português quando ninguém passa idioma", () => {
    // O card aparece em telas sem `params` de rota — o "not-found" da PDP é
    // uma delas.
    expect(html(<SeloSCA sca={80} scaExata={false} />)).toContain("Especial");
  });

  it("o '+' só aparece onde o número é piso da coleção", () => {
    expect(html(<SeloSCA sca={80} scaExata={false} locale="en" />)).toContain("SCA 80+");
    expect(html(<SeloSCA sca={86} scaExata locale="en" />)).toContain("SCA 86");
    expect(html(<SeloSCA sca={86} scaExata locale="en" />)).not.toContain("SCA 86+");
  });
});
