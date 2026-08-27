import { describe, it, expect, vi } from "vitest";

import { renderizar } from "@/lib/teste/renderizar";
import type { RegraDaLista } from "@/lib/painel/descontos/contrato";

/**
 * A tabela da lista — o que a função pura não alcança.
 *
 * `lista.logica.test.ts` já prova a derivação e os formatadores. O que resta é
 * SEMÂNTICA DE TABELA, e ela só existe no DOM: a primeira coluna virar
 * `<th scope="row">` (R23), a ausência de `aria-sort` em colunas que a API não
 * ordena, e o `data-dado` que liga a monoespaçada tabular nas colunas de número.
 *
 * E uma coisa que nenhum dos dois pega sozinho: que o INSTANTE usado na
 * derivação atravessou a fronteira Server→Client como número. Se ele voltasse a
 * ser um `Date`, a prop simplesmente não serializaria — e o defeito não
 * apareceria no `next build`, porque toda rota do painel é dinâmica.
 */

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: () => {}, replace: () => {} }),
}));

const { TabelaDeDescontos } = await import("./TabelaDeDescontos");

const AGORA = new Date("2026-08-27T12:00:00Z").getTime();

function regra(parcial: Partial<RegraDaLista> = {}): RegraDaLista {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    nome: "Dez por cento no PIX",
    metodo: "automatico",
    classe: "pedido",
    mecanica: "percentual",
    valor: "10",
    inicio_em: null,
    fim_em: null,
    habilitada: true,
    arquivada_em: null,
    limite_usos: 100,
    usos: 3,
    descontado_centavos: 4500,
    codigos: [],
    ...parcial,
  };
}

function montar(linhas: RegraDaLista[]) {
  return renderizar(<TabelaDeDescontos linhas={linhas} agoraEmMs={AGORA} />);
}

describe("a tabela de regras", () => {
  it("a primeira coluna é o cabeçalho da linha — R23", () => {
    const { getByRole } = montar([regra()]);
    const celula = getByRole("rowheader");
    expect(celula.textContent).toContain("Dez por cento no PIX");
  });

  it("a primeira coluna é o NOME e nunca o UUID", () => {
    const { getByRole } = montar([regra()]);
    expect(getByRole("rowheader").textContent).not.toContain("11111111");
  });

  it("o nome leva à ficha da regra", () => {
    const { getByRole } = montar([regra()]);
    const link = getByRole("link", { name: "Dez por cento no PIX" });
    expect(link.getAttribute("href")).toBe(
      "/dashboard/descontos/11111111-1111-4111-8111-111111111111",
    );
  });

  it("nenhuma coluna promete ordenação que a API não faz", () => {
    const { getAllByRole } = montar([regra()]);
    for (const th of getAllByRole("columnheader")) {
      expect(th.getAttribute("aria-sort")).toBeNull();
    }
  });

  it("é uma <table> nativa, e não um role=grid", () => {
    const { container } = montar([regra()]);
    expect(container.querySelector("table")).toBeTruthy();
    expect(container.querySelector('[role="grid"]')).toBeNull();
  });

  it("os números levam `data-dado` — a monoespaçada tabular é o que faz comparar por posição", () => {
    const { container } = montar([regra()]);
    const dados = [...container.querySelectorAll("[data-dado]")].map((n) => n.textContent);
    expect(dados).toContain("3/100");
  });

  it("a situação é derivada do instante que veio como NÚMERO, e não de um Date", () => {
    const { getByText } = montar([
      regra({ fim_em: "2026-08-01T00:00:00Z" }),
    ]);
    expect(getByText("Expirada")).toBeTruthy();
  });

  it("uma regra desligada não aparece como vigente, ainda que a janela permita", () => {
    const { getByText } = montar([regra({ habilitada: false })]);
    expect(getByText("Desligada")).toBeTruthy();
  });

  it("a regra com código mostra o código abaixo do nome, resumido", () => {
    const { getByText } = montar([
      regra({ metodo: "codigo", codigos: ["CAFE20", "CAFE30", "CAFE40"] }),
    ]);
    expect(getByText("CAFE20 +2")).toBeTruthy();
  });

  it("zero descontado sai como R$ 0,00, e não como travessão — é informação, não ausência", () => {
    const { container } = montar([regra({ descontado_centavos: 0 })]);
    const dados = [...container.querySelectorAll("[data-dado]")].map((n) => n.textContent);
    expect(dados.some((t) => t?.includes("0,00"))).toBe(true);
    expect(dados).not.toContain("—");
  });
});
