import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { ALIAS_COR, CORES, EASINGS, RAIOS, varCor } from "./tokens";

/**
 * Este arquivo e a costura entre lib/tokens.ts e app/globals.css.
 *
 * Nao da para o CSS importar um modulo TS nem para o teste importar CSS num
 * runtime Node. Em vez de gerar um a partir do outro (codegen, mais uma etapa
 * de build para manter), os dois continuam escritos a mao e ESTE teste proibe
 * a divergencia: qualquer token acrescentado, removido ou com valor trocado de
 * um lado sem o outro deixa a suite vermelha. Na pratica ha uma fonte unica —
 * o par so existe em estados consistentes.
 */

const GLOBALS = fileURLToPath(new URL("../app/globals.css", import.meta.url));

/** Extrai `--nome: valor;` do bloco @theme de app/globals.css. */
function lerTema(): Map<string, string> {
  const css = readFileSync(GLOBALS, "utf8");
  const bloco = css.match(/@theme[^{]*\{([\s\S]*?)\n\}/);
  if (!bloco) throw new Error("bloco @theme nao encontrado em app/globals.css");

  const semComentarios = bloco[1].replace(/\/\*[\s\S]*?\*\//g, "");
  const out = new Map<string, string>();
  for (const linha of semComentarios.split("\n")) {
    const m = linha.match(/^\s*(--[\w-]+)\s*:\s*(.+?);\s*$/);
    if (m) out.set(m[1], m[2].trim());
  }
  return out;
}

const TEMA = lerTema();

describe("tokens: lib/tokens.ts e app/globals.css nao podem divergir", () => {
  it("le o bloco @theme do globals.css", () => {
    // Se o parser quebrar (renomeacao de diretiva, formatacao), tudo abaixo
    // passaria por vacuidade sobre um Map vazio. Esta ancora impede isso.
    expect(TEMA.size).toBeGreaterThanOrEqual(20);
  });

  it("declara em CSS exatamente as cores de CORES + ALIAS_COR", () => {
    const noCss = [...TEMA.keys()]
      .filter((k) => k.startsWith("--color-"))
      .map((k) => k.replace("--color-", ""))
      .sort();
    const noTs = [...Object.keys(CORES), ...Object.keys(ALIAS_COR)].sort();
    expect(noCss).toEqual(noTs);
  });

  it("usa o mesmo hex nos dois lados", () => {
    for (const [nome, hex] of Object.entries(CORES)) {
      expect(TEMA.get(`--color-${nome}`), `--color-${nome}`).toBe(hex);
    }
  });

  it("mantem os aliases como var(), nao como hex duplicado", () => {
    for (const [nome, aponta] of Object.entries(ALIAS_COR)) {
      expect(TEMA.get(`--color-${nome}`), `--color-${nome}`).toBe(`var(--color-${aponta})`);
      expect(CORES[aponta]).toBeDefined();
    }
  });

  it("usa os mesmos raios e easings nos dois lados", () => {
    for (const [nome, valor] of Object.entries(RAIOS)) {
      expect(TEMA.get(`--radius-${nome}`), `--radius-${nome}`).toBe(valor);
    }
    for (const [nome, valor] of Object.entries(EASINGS)) {
      expect(TEMA.get(`--ease-${nome}`), `--ease-${nome}`).toBe(valor);
    }
  });

  it("mantem `@theme static` — sem `static` os tokens nao chegam ao browser", () => {
    // O Tailwind v4 poda variaveis de @theme que nenhum utilitario referencia.
    // Como <Serra> e os gradientes leem var(--color-*) direto, a poda devolveria
    // string vazia em runtime, sem erro. Ver o comentario em app/globals.css.
    expect(readFileSync(GLOBALS, "utf8")).toMatch(/@theme\s+static\s*\{/);
  });

  it("varCor devolve a referencia CSS do token", () => {
    expect(varCor("juta")).toBe("var(--color-juta)");
  });

  it("todo hex de CORES esta em #RRGGBB maiusculo", () => {
    for (const [nome, hex] of Object.entries(CORES)) {
      expect(hex, nome).toMatch(/^#[0-9A-F]{6}$/);
    }
  });
});
