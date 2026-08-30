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

/**
 * A Server Action é dublada: aqui interessa o GESTO (quem é chamado, com quê, e
 * o que a tela faz com a resposta), não a ida ao Express. `vi.hoisted` porque
 * `vi.mock` é içado para cima dos imports e uma variável de módulo referenciada
 * dentro da fábrica estouraria em TDZ.
 */
const { alternar, resposta } = vi.hoisted(() => {
  const resposta = { valor: { ok: true, dados: {} } as unknown };
  return {
    resposta,
    alternar: vi.fn(async () => resposta.valor),
  };
});
vi.mock("./acoes", () => ({
  alternarDesconto: (...a: unknown[]) =>
    (alternar as unknown as (...x: unknown[]) => unknown)(...a),
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

/**
 * O INTERRUPTOR DA LISTA — a ação que existia em `acoes.ts` e não tinha porta.
 *
 * `alternarDesconto` foi escrita com rota própria (`PATCH .../habilitada`)
 * justamente para ligar e desligar SEM passar pelo `PUT` total, que apagaria
 * escopo e faixas. Ela ficou sem nenhum chamador: não havia como ligar ou
 * desligar uma regra a partir da lista, que é onde o gestor olha.
 */
describe("ligar e desligar da lista", () => {
  it("o rótulo diz o que o clique FAZ, não o que a regra é", () => {
    const ligada = montar([regra({ habilitada: true })]);
    expect(ligada.getByRole("button", { name: /^Desligar a regra/ })).toBeTruthy();
    ligada.unmount();

    const desligada = montar([regra({ habilitada: false })]);
    expect(desligada.getByRole("button", { name: /^Ligar a regra/ })).toBeTruthy();
  });

  /** O nome NOMEIA O OBJETO: "Desligar" sozinho obriga quem não vê a tela a
   *  adivinhar qual das vinte regras está sob o cursor. */
  it("o nome acessível carrega o nome da regra", () => {
    const { getByRole } = montar([regra({ nome: "Black Friday" })]);
    expect(
      getByRole("button", { name: "Desligar a regra Black Friday" }),
    ).toBeTruthy();
  });

  it("chama a ação com o id e com o valor INVERTIDO", async () => {
    alternar.mockClear();
    const { usuario, getByRole } = montar([regra({ habilitada: true })]);

    await usuario.click(getByRole("button", { name: /^Desligar a regra/ }));

    expect(alternar).toHaveBeenCalledWith(
      "11111111-1111-4111-8111-111111111111",
      false,
    );
  });

  /**
   * R14 — nada de otimismo. A frase do servidor sobe INTEIRA: enquanto as rotas
   * do motor não existirem no Express, o que chega é o 404 com a frase, e
   * escondê-la atrás de "não foi possível" faria procurar defeito na regra em
   * vez de na rota.
   */
  it("erro do servidor aparece com a frase dele, e a linha não muda sozinha", async () => {
    alternar.mockClear();
    resposta.valor = { ok: false, erro: "Rota /admin/descontos não encontrada." };
    const { usuario, getByRole, findByText, getByText } = montar([
      regra({ habilitada: true }),
    ]);

    await usuario.click(getByRole("button", { name: /^Desligar a regra/ }));

    expect(await findByText("Rota /admin/descontos não encontrada.")).toBeTruthy();
    // A situação continua a que o servidor mandou: a tela não pinta o que não
    // aconteceu.
    expect(getByText("Vigente")).toBeTruthy();
    resposta.valor = { ok: true, dados: {} };
  });

  /**
   * Arquivar tem precedência sobre tudo em `situacaoDaRegra`: ligar uma regra
   * arquivada não a colocaria no ar, e o botão prometeria um efeito que não
   * acontece. Expirada NÃO trava — corrigir a data de uma regra vencida é
   * justamente o que o gestor precisa poder fazer.
   */
  it("trava só o arquivado, e diz por quê", () => {
    const { getByRole } = montar([
      regra({ habilitada: false, arquivada_em: "2026-01-01T00:00:00Z" }),
    ]);
    const botao = getByRole("button", { name: /^Ligar a regra/ }) as HTMLButtonElement;
    expect(botao.disabled).toBe(true);
    expect(botao.getAttribute("title")).toContain("Desarquive");
  });

  it("o expirado continua clicável — foi travá-lo que perdeu a promoção legada", () => {
    const { getByRole } = montar([
      regra({ habilitada: true, fim_em: "2026-01-01T00:00:00Z" }),
    ]);
    const botao = getByRole("button", { name: /^Desligar a regra/ }) as HTMLButtonElement;
    expect(botao.disabled).toBe(false);
  });
});
