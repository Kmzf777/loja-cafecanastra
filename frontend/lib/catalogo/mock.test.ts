import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { LOTES } from "./mock";
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

describe("mock do catalogo", () => {
  it("tem ao menos 6 lotes", () => {
    expect(LOTES.length).toBeGreaterThanOrEqual(6);
  });

  it("tem slugs unicos", () => {
    const slugs = LOTES.map((l) => l.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
  });

  it("tem preco inteiro em centavos e positivo", () => {
    for (const lote of LOTES) {
      for (const v of lote.variantes) {
        expect(Number.isInteger(v.preco)).toBe(true);
        expect(v.preco).toBeGreaterThan(0);
      }
    }
  });

  it("tem ao menos uma variante por lote", () => {
    for (const lote of LOTES) expect(lote.variantes.length).toBeGreaterThan(0);
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

  it("tem altitude real por lote — requisito do Escolha pela Serra", () => {
    for (const lote of LOTES) expect(lote.lavoura.altitude).toBeGreaterThan(0);
  });

  it("tem altitudes distintas, senao o eixo da serra nao existe", () => {
    const alts = LOTES.map((l) => l.lavoura.altitude);
    expect(new Set(alts).size).toBe(alts.length);
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
