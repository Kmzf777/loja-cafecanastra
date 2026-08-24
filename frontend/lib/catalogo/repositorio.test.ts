import { afterEach, describe, it, expect, vi } from "vitest";
import {
  ESPERA_MAXIMA_MS,
  listarLotes,
  listarKits,
  obterLote,
  listarSlugs,
  precoMinimo,
  temEstoque,
  acharVariante,
  embalagensDe,
  produtosDaHome,
} from "./repositorio";

describe("repositorio do catalogo", () => {
  it("lista todas as linhas sem filtro", async () => {
    expect((await listarLotes()).length).toBeGreaterThanOrEqual(5);
  });

  it("filtra por linha", async () => {
    const r = await listarLotes({ linha: "suave" });
    expect(r.length).toBeGreaterThan(0);
    expect(r.every((l) => l.linha === "suave")).toBe(true);
  });

  it("filtra por faixa de ponto de torra", async () => {
    const r = await listarLotes({ pontoTorraMin: 3, pontoTorraMax: 4 });
    expect(r.length).toBeGreaterThan(0);
    expect(r.every((l) => l.pontoTorra >= 3 && l.pontoTorra <= 4)).toBe(true);
  });

  it("filtra por formato", async () => {
    const r = await listarLotes({ formato: "graos" });
    expect(r.length).toBeGreaterThan(0);
    expect(r.every((l) => l.variantes.some((v) => v.formato === "graos"))).toBe(true);
  });

  it("nao filtra mais por moagem — o eixo e do filtro Formato, e so dele", async () => {
    /**
     * O filtro "Moagem" saiu da PLP. Ele oferecia SETE valores (grão mais os
     * seis métodos de preparo) para o mesmo eixo que "Formato" já cobre com
     * grãos / moído / drip / cápsula: dois filtros para um eixo é ruído, e o de
     * sete mentia sobre um catálogo que vende dois.
     *
     * O `@ts-expect-error` é metade do teste: ele quebra o build no dia em que
     * `moagem` voltar a `Filtros`. A outra metade é a linha de baixo — um link
     * antigo com `?moagem=grao` na URL não pode continuar escondendo linha
     * nenhuma da vitrine em silêncio.
     */
    // @ts-expect-error `moagem` deixou de ser filtro do contrato
    const comFiltroMorto = await listarLotes({ moagem: "grao" });
    expect(comFiltroMorto).toEqual(await listarLotes());
  });

  it("filtra por peso do pacote", async () => {
    const r = await listarLotes({ pesoGramas: 1000 });
    expect(r.length).toBeGreaterThan(0);
    expect(r.every((l) => l.variantes.some((v) => v.pesoGramas === 1000))).toBe(true);
  });

  it("esconde o que esta esgotado quando pedido", async () => {
    const r = await listarLotes({ soDisponiveis: true });
    expect(r.length).toBeGreaterThan(0);
    expect(r.every(temEstoque)).toBe(true);
  });

  it("filtra por nota de sabor", async () => {
    const todos = await listarLotes();
    const nota = todos[0].notas[0];
    const r = await listarLotes({ notas: [nota] });
    expect(r.every((l) => l.notas.includes(nota))).toBe(true);
  });

  it("combina filtros", async () => {
    const r = await listarLotes({ linha: "classico", formato: "moido" });
    expect(
      r.every(
        (l) => l.linha === "classico" && l.variantes.some((v) => v.formato === "moido"),
      ),
    ).toBe(true);
  });

  it("devolve lista vazia quando nada casa, nunca erro", async () => {
    expect(await listarLotes({ pontoTorraMin: 5, pontoTorraMax: 1 })).toEqual([]);
  });

  it("ordena por torra nos dois sentidos", async () => {
    const asc = await listarLotes({}, "torra-asc");
    const desc = await listarLotes({}, "torra-desc");
    expect(asc[0].pontoTorra).toBeLessThanOrEqual(asc.at(-1)!.pontoTorra);
    expect(desc[0].pontoTorra).toBeGreaterThanOrEqual(desc.at(-1)!.pontoTorra);
  });

  it("ordena por preco sem quebrar com linha sem preco", async () => {
    // Uma linha esgotada tem precoMinimo null. `Math.min` sobre isso viraria
    // NaN e a ordenacao embaralharia silenciosamente.
    const r = await listarLotes({}, "preco-asc");
    const precos = r.map(precoMinimo).filter((p): p is number => p !== null);
    expect(precos).toEqual([...precos].sort((a, b) => a - b));
    expect(r.length).toBeGreaterThan(0);
  });

  it("obtem lote por slug", async () => {
    const lote = await obterLote("classico");
    expect(lote?.slug).toBe("classico");
  });

  it("devolve null para slug inexistente", async () => {
    expect(await obterLote("casca-danta")).toBeNull();
  });

  it("lista os slugs para generateStaticParams", async () => {
    const slugs = await listarSlugs();
    expect(slugs).toContain("classico");
    expect(slugs).toContain("suave");
  });

  it("calcula o preco minimo da linha", async () => {
    const lote = await obterLote("classico");
    // 250 g em graos, o mais barato do Classico na loja.
    expect(precoMinimo(lote!)).toBe(3970);
  });

  it("devolve preco nulo, e nao zero, para linha sem variante com preco", async () => {
    const canela = await obterLote("canela");
    expect(canela).not.toBeNull();
    expect(precoMinimo(canela!)).toBeNull();
  });

  it("acha a variante exata por moagem, peso e embalagem", async () => {
    const lote = await obterLote("suave");
    const v = acharVariante(lote!, "grao", 500, 1);
    expect(v?.preco).toBe(6570);
    expect(v?.formato).toBe("graos");
  });

  it("devolve undefined para combinacao inexistente, em vez de escondê-la", async () => {
    const lote = await obterLote("microlote");
    // O Microlote so existe em 250 g; 1 kg nao e vendido.
    expect(acharVariante(lote!, "grao", 1000, 1)).toBeUndefined();
  });

  it("lista as embalagens de uma combinacao", async () => {
    const lote = await obterLote("classico");
    // 500 g em grao existe avulso e em caixa fechada com 4.
    expect(embalagensDe(lote!, "grao", 500)).toEqual([1, 4]);
    // 250 g em grao so avulso.
    expect(embalagensDe(lote!, "grao", 250)).toEqual([1]);
  });

  it("lista os 3 kits da loja com o vocabulario comercial das variantes", async () => {
    const kits = await listarKits();
    expect(kits).toHaveLength(3);
    for (const kit of kits) {
      expect(kit.sku).toBeTruthy();
      expect(kit.skuLoja).toBe(kit.sku);
      expect(typeof kit.preco).toBe("number");
      expect(typeof kit.estoque).toBe("number");
      expect(kit.imagem.startsWith("/")).toBe(true);
      expect(kit.rotuloEmbalagem).toBeTruthy();
    }
  });

  it("kit esgotado continua na lista — a PLP o desabilita, nao o esconde", async () => {
    const kits = await listarKits();
    // As duas caixas de capsulas estao sem preco e sem estoque na captura.
    const esgotados = kits.filter((k) => k.estoque === 0);
    expect(esgotados.length).toBeGreaterThan(0);
  });

  it("o kit vendavel real traz o preco do catalogo", async () => {
    const kits = await listarKits();
    const caixa = kits.find(
      (k) => k.sku === "kit-canela-classico-suave-moido-3x250",
    );
    // Sem API no ambiente de teste, vale o JSON versionado: R$ 109,70.
    expect(caixa?.preco).toBe(10970);
    expect(caixa?.linha).toBe("canela");
    expect(caixa?.imagem).toBe("/cafe-canela.png");
  });
});

/* ------------------------------------------------------------------ *
 * O teto de espera da API — a contingência que segurava a vitrine
 * ------------------------------------------------------------------ */

/**
 * `fetch` NÃO TEM TIMEOUT PRÓPRIO, e esta chamada não tinha nenhum.
 *
 * O irmão deste código, `lib/avaliacoes/servidor.ts`, já carregava o teto e a
 * explicação: um servidor que aceita a conexão e nunca responde deixa a
 * promessa pendurada para sempre. Aqui a consequência é maior, porque quem
 * espera é a home, a PLP e a revalidação de toda PDP — as três param, sem log
 * e sem erro, com o banco inteiro de pé.
 *
 * A saída certa já existia e nunca era alcançada: o `catch` que devolve mapa
 * vazio e deixa a vitrine vender pelo JSON versionado. Loja com preço de ontem
 * é melhor que loja que não abre.
 */
describe("a API que não responde", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("arma um sinal de aborto em toda pergunta ao banco", async () => {
    const vistos: (AbortSignal | undefined)[] = [];
    vi.stubGlobal("fetch", async (_url: string, init: RequestInit = {}) => {
      vistos.push(init.signal ?? undefined);
      return { ok: true, json: async () => ({ products: [] }) };
    });

    await listarLotes();
    await listarKits();

    expect(vistos.length).toBeGreaterThan(0);
    for (const sinal of vistos) {
      expect(
        sinal,
        "fetch sem `signal`: a promessa pode pendurar para sempre",
      ).toBeInstanceOf(AbortSignal);
      // Armado, não disparado: um sinal já abortado cancelaria toda leitura.
      expect(sinal!.aborted).toBe(false);
    }
  });

  it("o teto é um número finito de segundos, como o do irmão", () => {
    expect(Number.isFinite(ESPERA_MAXIMA_MS)).toBe(true);
    expect(ESPERA_MAXIMA_MS).toBeGreaterThan(0);
    expect(ESPERA_MAXIMA_MS).toBeLessThanOrEqual(5000);
  });

  it("o mecanismo do teto rejeita sozinho, e é o mesmo de servidor.ts", async () => {
    // Prova o desenho em 20 ms para o de verdade não custar 3 s na suíte: é
    // `AbortSignal.timeout` quem dispara, e é `TimeoutError` que chega no
    // `catch` do repositório como qualquer outra falha de rede.
    const sinal = AbortSignal.timeout(20);
    await new Promise((resolva) => sinal.addEventListener("abort", resolva));
    expect((sinal.reason as Error).name).toBe("TimeoutError");
  });

  it("estourado o prazo, a vitrine cai para o JSON e continua vendendo", async () => {
    vi.stubGlobal("fetch", async () => {
      throw new DOMException("The operation was aborted.", "TimeoutError");
    });

    const lotes = await listarLotes();
    const classico = lotes.find((l) => l.slug === "classico");

    // A loja inteira de pé, com o preço versionado do JSON.
    expect(lotes.length).toBeGreaterThanOrEqual(5);
    expect(precoMinimo(classico!)).toBe(3970);
    // E sem `produtoId`: é assim que o PainelCompra sabe avisar em vez de
    // fingir que guardou o item.
    expect(classico!.variantes.every((v) => v.produtoId === undefined)).toBe(true);
  });

  it("a PDP e os kits caem para o JSON pelo mesmo caminho", async () => {
    vi.stubGlobal("fetch", async () => {
      throw new DOMException("The operation was aborted.", "TimeoutError");
    });

    expect((await obterLote("suave"))?.slug).toBe("suave");
    expect(await listarKits()).toHaveLength(3);
  });
});

describe("produtosDaHome", () => {
  it("entrega as três seções", async () => {
    const { maisVendidos, kits, escolhaDoProdutor } = await produtosDaHome();
    expect(maisVendidos.length).toBeGreaterThan(0);
    expect(kits.length).toBeGreaterThan(0);
    expect(escolhaDoProdutor.length).toBeGreaterThan(0);
  });

  it("fala o vocabulário comercial da casa, não o do JSON cru", () => {
    // `preco`/`estoque`/`skuLoja` são os mesmos nomes de Variante e Kit. É o
    // que deixa o SKU passar pelo mesmo sobreporAoVivo sem contrato paralelo.
    return produtosDaHome().then(({ maisVendidos }) => {
      const p = maisVendidos[0];
      expect(p).toHaveProperty("preco");
      expect(p).toHaveProperty("estoque");
      expect(p).toHaveProperty("skuLoja");
      expect(p).not.toHaveProperty("precoCentavos");
    });
  });

  it("continua de pé quando a API não responde", async () => {
    // A contingência que repositorio.ts documenta: loja com preço de ontem é
    // melhor que loja que não abre, e o checkout reconfere antes de cobrar.
    const { maisVendidos } = await produtosDaHome();
    for (const p of maisVendidos) {
      expect(p.preco, p.sku).toBeGreaterThan(0);
      expect(p.imagem, p.sku).toBeTruthy();
    }
  });

  it("nunca oferece o que não dá para comprar", async () => {
    const { maisVendidos, kits, escolhaDoProdutor } = await produtosDaHome();
    for (const p of [...maisVendidos, ...kits, ...escolhaDoProdutor]) {
      expect(p.estoque, p.sku).toBeGreaterThan(0);
      expect(p.preco, p.sku).toBeGreaterThan(0);
    }
  });

  it("faz UMA leitura da API para as três seções", async () => {
    // Três chamadas separadas custariam três fetch por render da home. O
    // cache de 60 s do Next abafaria isso, mas depender de cache para não
    // fazer trabalho triplicado é depender de sorte.
    const chamadas: string[] = [];
    const original = globalThis.fetch;
    globalThis.fetch = (async (url: string) => {
      chamadas.push(String(url));
      return { ok: false } as Response;
    }) as typeof fetch;
    try {
      await produtosDaHome();
      expect(chamadas.length).toBeLessThanOrEqual(1);
    } finally {
      globalThis.fetch = original;
    }
  });
});
