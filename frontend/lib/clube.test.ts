import { describe, expect, it, vi } from "vitest";
import {
  DESCONTO_DO_CLUBE,
  assinarClube,
  economiaPorEnvio,
  montarCorpoDeAssinatura,
  opcoesDoClube,
  preSelecaoDaQuery,
  precoComDesconto,
  precoPorEnvio,
  varianteDoClube,
} from "./clube";
import { LOTES } from "./catalogo/produtos";
import type { Lote } from "./catalogo/tipos";

/** Um catálogo mínimo: uma linha com Clube, uma sem. */
function lotesDeTeste(): Lote[] {
  const base = {
    notas: ["rapadura"],
    pontoTorra: 3 as const,
    sca: 80,
    descricao: "",
    torra: "",
    corpo: "",
    preparoSugerido: "",
    origem: { regiao: "Serra da Canastra", estado: "MG", variedades: [], atributos: [] },
    fotos: {
      sabor: { src: "/x.png", alt: "x", w: 500, h: 500 },
      pacote: { src: "/x.png", alt: "x", w: 500, h: 500 },
    },
    formatosEspeciais: [],
    preparo: [],
  };
  const variante = (sku: string, moagem: string, peso: number, extra = {}) => ({
    sku: `${sku}-${moagem}`,
    skuLoja: sku,
    formato: moagem === "grao" ? "graos" : "moido",
    moagem,
    pesoGramas: peso,
    pacotes: 1,
    rotuloEmbalagem: `${peso} g`,
    preco: 3970,
    estoque: 10,
    produtoId: "11111111-0000-0000-0000-0000000000aa",
    ...extra,
  });
  return [
    {
      ...base,
      slug: "classico",
      nome: "Canastra Clássico",
      linha: "classico",
      variantes: [
        variante("CLA-250G", "grao", 250),
        variante("CLA-250M", "coado-papel", 250),
        variante("CLA-500M", "coado-papel", 500, { preco: 7150 }),
        // Caixa fechada NÃO entra no Clube:
        { ...variante("CLA-CX", "grao", 250), pacotes: 3 },
      ],
      assinatura: { desconto: 0.1, frequenciasDias: [15, 30, 45] },
    },
    {
      ...base,
      slug: "microlote",
      nome: "Microlote",
      linha: "microlote",
      variantes: [variante("MIC-250G", "grao", 250)],
      // sem `assinatura`
    },
  ] as unknown as Lote[];
}

describe("preço do Clube (-10%)", () => {
  it("arredonda a centavo inteiro", () => {
    expect(precoComDesconto(3970)).toBe(3573);
    expect(precoComDesconto(7150)).toBe(6435);
    expect(precoComDesconto(3975)).toBe(3578); // meio centavo sobe, como no servidor
  });

  it("EXIBIDO = COBRADO: a conta do servidor bate com a da vitrine em TODA a faixa", () => {
    /**
     * A varredura é de propósito, e sete amostras já não bastaram uma vez: a
     * versão anterior do servidor fazia `round(preco_reais * 0.9 * 100)` e
     * divergia desta função em 947 dos 200.000 primeiros preços — sempre um
     * centavo A MENOS do que a etiqueta prometia (R$ 16,15 é um deles). As
     * amostras escolhidas a dedo não pegavam nenhum.
     *
     * O que se afirma aqui é o caminho INTEIRO do servidor: o preço sai do
     * banco em reais (`canastra.produtos.preco`, 2 casas), volta a centavos
     * inteiros e só então recebe o desconto — de modo que os dois lados rodam
     * literalmente `round(centavos * 0.9)`.
     */
    let divergencias = 0;
    for (let centavos = 1; centavos <= 20000; centavos++) {
      const precoEmReais = centavos / 100; // o que o banco devolve
      const catalogoCentavos = Math.round(precoEmReais * 100); // ClubeController
      const doServidor = Math.round(catalogoCentavos * (1 - DESCONTO_DO_CLUBE));
      if (precoComDesconto(centavos) !== doServidor) divergencias++;
    }
    expect(divergencias).toBe(0);

    // E a prova pontual do caso que denunciou o bug, para o dia em que alguém
    // ler só esta linha: R$ 16,15 vale 14,54 no Clube — não 14,53.
    expect(precoComDesconto(1615)).toBe(1454);
  });

  it("por envio: unidade com desconto × quantidade (nunca desconto sobre a soma)", () => {
    // round(3975*0.9)*2 = 7156; round(3975*2*0.9) = 7155 — a ordem importa e a
    // do servidor é unidade-primeiro (unidadeCentavos * qtd).
    expect(precoPorEnvio(3975, 2)).toBe(7156);
    expect(economiaPorEnvio(3970, 2)).toBe(794);
  });
});

describe("o desconto tem UMA fonte de verdade", () => {
  it("o catálogo real não contradiz a constante do Clube", () => {
    /**
     * `DESCONTO_DO_CLUBE` (espelho do ClubeController, que é quem COBRA) é o
     * número que o hero de /clube e a etiqueta do wizard usam. O catálogo
     * ainda carrega `assinatura.desconto` por LINHA — é ele que marca quais
     * linhas entram no Clube, e a aba de assinatura da PDP (PainelCompra) usa
     * o valor para a prévia de preço. Se os dois divergirem, a PDP anuncia um
     * desconto que a cobrança não dá; este teste é a trava.
     */
    const assinaveis = LOTES.filter((l) => l.assinatura);
    expect(assinaveis.length).toBeGreaterThan(0);
    for (const lote of assinaveis) {
      expect(lote.assinatura?.desconto, `linha ${lote.slug}`).toBe(
        DESCONTO_DO_CLUBE,
      );
    }
  });
});

describe("opcoesDoClube", () => {
  it("só linhas com assinatura, só pacote avulso", () => {
    const opcoes = opcoesDoClube(lotesDeTeste());
    expect(opcoes.map((o) => o.slug)).toEqual(["classico"]);
    expect(opcoes[0].variantes.map((v) => v.sku)).toEqual([
      "CLA-250G",
      "CLA-250M",
      "CLA-500M",
    ]);
  });

  it("marca aoVivo quando o preço veio do banco (produtoId presente)", () => {
    const lotes = lotesDeTeste();
    // Simula o modo contingência (API fora, só JSON): sem produtoId.
    lotes[0].variantes[0].produtoId = undefined;
    const [classico] = opcoesDoClube(lotes);
    expect(classico.variantes[0].aoVivo).toBe(false);
    expect(classico.variantes[1].aoVivo).toBe(true);
  });

  it("acha a combinação exata e devolve undefined para o que não existe", () => {
    const [classico] = opcoesDoClube(lotesDeTeste());
    expect(varianteDoClube(classico, "coado-papel", 500)?.precoCentavos).toBe(7150);
    expect(varianteDoClube(classico, "espresso", 250)).toBeUndefined();
  });
});

describe("preSelecaoDaQuery (?cafe=&moagem= vindos da PDP)", () => {
  const opcoes = opcoesDoClube(lotesDeTeste());

  it("aceita o que existe", () => {
    const params = new URLSearchParams("cafe=classico&moagem=coado-papel");
    expect(preSelecaoDaQuery(params, opcoes)).toEqual({
      cafe: "classico",
      moagem: "coado-papel",
    });
  });

  it("query inventada cai no padrão em silêncio", () => {
    expect(
      preSelecaoDaQuery(new URLSearchParams("cafe=nao-existe&moagem=turbo"), opcoes),
    ).toEqual({});
    // moagem válida sem café: vale contra a primeira opção.
    expect(
      preSelecaoDaQuery(new URLSearchParams("moagem=grao"), opcoes),
    ).toEqual({ moagem: "grao" });
  });
});

describe("montarCorpoDeAssinatura + assinarClube", () => {
  const endereco = {
    zip_code: "37928-000",
    street: "Rua da Serra",
    number: "12",
    complement: "",
    neighborhood: "Centro",
    city: "São Roque de Minas",
    state: "MG",
  };

  it("o corpo leva sku/quantidade/frequência/endereço — e NUNCA preço", () => {
    const [classico] = opcoesDoClube(lotesDeTeste());
    const corpo = montarCorpoDeAssinatura({
      variante: varianteDoClube(classico, "coado-papel", 250)!,
      quantidade: 2,
      frequenciaDias: 30,
      endereco,
    });
    expect(corpo).toEqual({
      sku: "CLA-250M",
      quantidade: 2,
      frequenciaDias: 30,
      endereco,
    });
    expect("preco" in corpo).toBe(false);
  });

  it("assinarClube devolve o initPoint e propaga a frase de erro do servidor", async () => {
    const ok = vi.fn(async () => ({
      ok: true,
      json: async () => ({ assinatura: { id: "a1" }, initPoint: "https://mp/x" }),
    })) as unknown as typeof fetch;
    await expect(
      assinarClube("token", {
        sku: "CLA-250M",
        quantidade: 1,
        frequenciaDias: 15,
        endereco,
      }, ok),
    ).resolves.toEqual({ initPoint: "https://mp/x" });
    const chamada = (ok as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(String(chamada[0])).toContain("/clube/assinar");
    expect(JSON.parse(chamada[1].body).sku).toBe("CLA-250M");

    const recusa = vi.fn(async () => ({
      ok: false,
      json: async () => ({ details: "Frequência inválida: escolha 15, 30 ou 45 dias." }),
    })) as unknown as typeof fetch;
    await expect(
      assinarClube("token", {
        sku: "CLA-250M",
        quantidade: 1,
        frequenciaDias: 15,
        endereco,
      }, recusa),
    ).rejects.toThrow(/Frequência inválida/);
  });
});
