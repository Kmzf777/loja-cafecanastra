import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import bruto from "../../../data/catalogo-canastra.json";
import { LOTES, MARCA } from "./produtos";
import { MOAGENS } from "./tipos";

const PUBLIC = fileURLToPath(new URL("../../public/", import.meta.url));

/**
 * Le largura/altura do bloco IHDR de um PNG — bytes 16..23, big-endian.
 * Sem dependencia: um PNG valido sempre traz o IHDR como primeiro chunk.
 * Devolve null se o arquivo nao for PNG, e o teste trata isso como falha
 * explicita (ver comentario no caso de teste).
 */
function dimensoesPng(caminho: string): { w: number; h: number } | null {
  const b = readFileSync(caminho);
  if (b.subarray(0, 8).toString("hex") !== "89504e470d0a1a0a") return null;
  return { w: b.readUInt32BE(16), h: b.readUInt32BE(20) };
}

describe("dados brutos do catalogo (data/catalogo-canastra.json)", () => {
  it("tem sku unico por produto", () => {
    const skus = bruto.produtos.map((p) => p.sku);
    expect(new Set(skus).size).toBe(skus.length);
  });

  it("so aponta para linhas que existem", () => {
    const linhas = new Set(bruto.linhas.map((l) => l.slug));
    for (const p of bruto.produtos) {
      expect(linhas.has(p.linha), `${p.sku} aponta para linha "${p.linha}"`).toBe(true);
    }
  });

  it("declara procedencia em todo produto", () => {
    // A regra que separa este catalogo do mock anterior: nenhum dado entra sem
    // dizer de onde veio. Se alguem acrescentar um SKU sem `fonte`, o teste
    // falha antes de o dado chegar na vitrine.
    const validas = ["captura-loja", "pesquisa-web", "embalagem", "inferido"];
    for (const p of bruto.produtos) {
      expect(validas, `${p.sku} tem fonte "${p.fonte}"`).toContain(p.fonte);
    }
  });

  it("usa centavos inteiros e nao negativos", () => {
    for (const p of bruto.produtos) {
      expect(Number.isInteger(p.precoCentavos), `${p.sku}`).toBe(true);
      expect(p.precoCentavos, `${p.sku}`).toBeGreaterThanOrEqual(0);
    }
  });

  it("so deixa preco zerado quando o produto esta esgotado", () => {
    // Preco 0 significa "a loja nao exibe valor porque acabou". Um produto
    // comprável com preço zero seria erro de digitação virando prejuízo.
    for (const p of bruto.produtos) {
      if (p.precoCentavos === 0) {
        expect(p.estoque, `${p.sku} tem preco 0 mas estoque ${p.estoque}`).toBe(0);
      }
    }
  });

  it("mantem os precos lidos na loja", () => {
    // Ancora contra edicao acidental: estes quatro valores foram lidos na tela
    // da loja real. Se mudarem, que seja de proposito.
    const porSku = new Map(bruto.produtos.map((p) => [p.sku, p.precoCentavos]));
    expect(porSku.get("classico-graos-250")).toBe(3970);
    expect(porSku.get("classico-graos-500")).toBe(6570);
    expect(porSku.get("classico-graos-1000")).toBe(10990);
    expect(porSku.get("microlote-graos-250")).toBe(4370);
  });

  it("tem a mesma contagem de 'em graos' que a categoria da loja", () => {
    // A loja mostra "Em grãos (9)" no filtro de categoria. Bater esse numero e
    // a evidencia mais barata de que nao falta nem sobra SKU nessa familia.
    const emGraos = bruto.produtos.filter((p) => p.formato === "graos");
    expect(emGraos).toHaveLength(9);
  });
});

describe("catalogo montado", () => {
  it("tem uma linha por familia real", () => {
    expect(LOTES.map((l) => l.slug).sort()).toEqual(
      ["canela", "classico", "microlote", "nectar-de-minas", "suave"].sort(),
    );
  });

  it("tem slugs unicos", () => {
    const slugs = LOTES.map((l) => l.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
  });

  it("declara SCA como o piso da embalagem, sem decimal inventado", () => {
    // O mock antigo trazia 84,25 e 85,50 — pontuacao que nenhuma prova de
    // xicara produziu. A lata diz "SCA 80+", entao o site diz 80.
    expect(MARCA.sca).toBe(80);
    for (const lote of LOTES) {
      expect(lote.sca, lote.slug).toBe(80);
      expect(Number.isInteger(lote.sca), lote.slug).toBe(true);
    }
  });

  it("so usa moagens do contrato", () => {
    const validas = new Set(MOAGENS.map((m) => m.valor));
    for (const lote of LOTES) {
      for (const v of lote.variantes) expect(validas.has(v.moagem)).toBe(true);
    }
  });

  it("tem ponto de torra entre 1 e 5", () => {
    for (const lote of LOTES) {
      expect(lote.pontoTorra).toBeGreaterThanOrEqual(1);
      expect(lote.pontoTorra).toBeLessThanOrEqual(5);
    }
  });

  it("so vende peso que a loja embala", () => {
    for (const lote of LOTES) {
      for (const v of lote.variantes) {
        expect([250, 500, 1000], `${v.sku}`).toContain(v.pesoGramas);
      }
    }
  });

  it("mantem a variante rastreavel ate o SKU da loja", () => {
    const skus = new Set(bruto.produtos.map((p) => p.sku));
    for (const lote of LOTES) {
      for (const v of lote.variantes) {
        expect(skus.has(v.skuLoja), `${v.sku} -> ${v.skuLoja}`).toBe(true);
      }
    }
  });

  it("da o mesmo preco e estoque a toda moagem do mesmo SKU moido", () => {
    // Moer é serviço, não outro produto: as seis moagens de um pacote moído
    // saem do mesmo estoque e custam o mesmo. Se divergirem, a PDP passa a
    // vender preços diferentes pela mesma coisa.
    for (const lote of LOTES) {
      const moidas = lote.variantes.filter((v) => v.formato === "moido");
      const porSku = new Map<string, Set<number>>();
      for (const v of moidas) {
        if (!porSku.has(v.skuLoja)) porSku.set(v.skuLoja, new Set());
        porSku.get(v.skuLoja)!.add(v.preco);
      }
      for (const [sku, precos] of porSku) {
        expect(precos.size, `${sku} tem ${precos.size} precos distintos`).toBe(1);
      }
    }
  });

  it("nao poe kit nos formatos especiais de linha nenhuma", () => {
    // Os kits de capsula tem `kit: true` E `formato: "capsula"` E uma linha
    // dominante — sem o filtro `!p.kit` em especiaisDa eles apareciam na PDP
    // do Classico como formato especial, duplicando o card da secao de kits.
    const skusDeKit = new Set(
      bruto.produtos.filter((p) => "kit" in p && p.kit).map((p) => p.sku),
    );
    expect(skusDeKit.size).toBeGreaterThan(0);
    for (const lote of LOTES) {
      for (const f of lote.formatosEspeciais) {
        expect(skusDeKit.has(f.sku), `${lote.slug} expõe o kit ${f.sku}`).toBe(false);
      }
    }
  });

  it("nao expoe mais campos de lavoura inventados", () => {
    // Guarda de regressao: altitude, produtor e safra por lote foram removidos
    // do contrato porque eram ficcao. Se voltarem, alguem os reintroduziu.
    for (const lote of LOTES) {
      expect(lote).not.toHaveProperty("lavoura");
      expect(lote.origem.regiao).toContain("Canastra");
      expect(lote.origem.variedades.length).toBeGreaterThan(0);
    }
  });

  it("tem alt text descritivo em toda foto", () => {
    for (const lote of LOTES) {
      expect(lote.fotos.sabor.alt.length).toBeGreaterThan(10);
      expect(lote.fotos.pacote.alt.length).toBeGreaterThan(10);
    }
  });

  // O w/h declarado e a caixa de layout que o next/image reserva. Se divergir
  // do arquivo real, a imagem distorce e o CLS estoura — estetica.md §10 exige
  // CLS < 0,05. Nem tsc nem next build enxergam esse erro; so este teste.
  it("declara w/h iguais ao arquivo real em public/", () => {
    for (const lote of LOTES) {
      for (const [papel, foto] of Object.entries(lote.fotos)) {
        if (!foto) continue;
        const onde = `${lote.slug}.${papel} (${foto.src})`;
        const caminho = join(PUBLIC, foto.src.replace(/^\//, ""));

        expect(existsSync(caminho), `${onde}: arquivo nao existe em public/`).toBe(true);

        // Falha de proposito se o ativo migrar para AVIF/WebP (previsto no §8):
        // e um lembrete para estender dimensoesPng(), nao para apagar o teste.
        const real = dimensoesPng(caminho);
        expect(real, `${onde}: nao e PNG — estenda dimensoesPng() para o novo formato`).not.toBeNull();

        expect({ w: foto.w, h: foto.h }, `${onde}: dimensao declarada difere do arquivo`).toEqual(real);
      }
    }
  });
});
