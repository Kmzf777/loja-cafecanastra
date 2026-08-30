import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  CANAIS_DE_CAMPANHA,
  CANAIS_DE_CONTATO,
  ESTADOS_DE_CONSENTIMENTO,
  ESTADOS_DE_ENVIO,
  GATILHOS_DE_AUTOMACAO,
  rotuloDe,
  tomDe,
} from "./vocabulario";

/**
 * O teste que importa: as listas do painel COMPARADAS COM AS DO BACKEND, lidas
 * do disco. É o mesmo desenho de `status.test.ts` e existe pelo mesmo motivo —
 * o Express recusa com 400 qualquer valor fora do vocabulário, e o CHECK de
 * 0033 recusa no banco. Uma divergência aqui não aparece no `next build` nem no
 * `tsc`: aparece como "Canal inválido. Use um de: …" na cara de quem salvava.
 */

const RAIZ = join(__dirname, "..", "..", "..", "..");

function fonteDoRepositorio(): string {
  return readFileSync(
    join(RAIZ, "backend", "src", "repositories", "marketingRepository.js"),
    "utf8",
  );
}

/** Extrai os literais de uma constante `Object.freeze([...])` do backend. */
function listaCongelada(fonte: string, nome: string): string[] {
  const bloco = fonte.match(
    new RegExp(`${nome}\\s*=\\s*Object\\.freeze\\(\\[([\\s\\S]*?)\\]\\)`),
  );
  expect(bloco, `não achei ${nome} no backend`).not.toBeNull();
  return [...bloco![1].matchAll(/"([a-z_]+)"/g)].map((m) => m[1]);
}

describe("o vocabulário de marketing bate com o backend", () => {
  it("CANAIS_DE_CAMPANHA — os oito de campanhas_canal_valido", () => {
    const doBackend = listaCongelada(fonteDoRepositorio(), "CANAIS_DE_CAMPANHA");
    expect(CANAIS_DE_CAMPANHA.map((c) => c.valor)).toEqual(doBackend);
  });

  it("CANAIS_DE_CONTATO — os três que consentimentos e envios compartilham", () => {
    const doBackend = listaCongelada(fonteDoRepositorio(), "CANAIS_DE_CONTATO");
    expect(CANAIS_DE_CONTATO.map((c) => c.valor)).toEqual(doBackend);
  });

  it("ESTADOS_DE_CONSENTIMENTO — concedido e revogado, nesta ordem", () => {
    const doBackend = listaCongelada(
      fonteDoRepositorio(),
      "ESTADOS_DE_CONSENTIMENTO",
    );
    expect(ESTADOS_DE_CONSENTIMENTO.map((e) => e.valor)).toEqual(doBackend);
  });

  it("ESTADOS_DE_ENVIO — os cinco, na ordem da vida da mensagem", () => {
    const doBackend = listaCongelada(fonteDoRepositorio(), "ESTADOS_DE_ENVIO");
    expect(ESTADOS_DE_ENVIO.map((e) => e.valor)).toEqual(doBackend);
  });

  /**
   * Os gatilhos NÃO têm repositório: `automacoes` não tem CRUD no Express (é a
   * lacuna que a tela declara em texto). O único lugar onde o vocabulário vive
   * do lado do servidor é o CHECK da migração — e é dele que este teste lê.
   */
  it("GATILHOS_DE_AUTOMACAO — os oito do CHECK de 0033", () => {
    const sql = readFileSync(
      join(RAIZ, "backend", "db", "migrations", "0033_marketing.sql"),
      "utf8",
    );
    const bloco = sql.match(
      /automacoes_gatilho_valido\s*\n?\s*CHECK\s*\(gatilho IN \(([\s\S]*?)\)\)/,
    );
    expect(bloco, "não achei o CHECK de gatilho em 0033").not.toBeNull();
    const doBanco = [...bloco![1].matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);

    expect(GATILHOS_DE_AUTOMACAO.map((g) => g.valor)).toEqual(doBanco);
  });
});

describe("os rótulos", () => {
  it("todo termo tem rótulo em português, e nenhum é igual ao valor", () => {
    const todos = [
      ...CANAIS_DE_CAMPANHA,
      ...CANAIS_DE_CONTATO,
      ...ESTADOS_DE_CONSENTIMENTO,
      ...ESTADOS_DE_ENVIO,
      ...GATILHOS_DE_AUTOMACAO,
    ];
    for (const termo of todos) {
      expect(termo.rotulo.length).toBeGreaterThan(0);
      expect(termo.rotulo).not.toBe(termo.valor);
    }
  });
});

describe("rotuloDe", () => {
  it("traduz o valor conhecido", () => {
    expect(rotuloDe(CANAIS_DE_CAMPANHA, "meta")).toBe("Meta (Instagram/Facebook)");
  });

  /** Um valor novo do backend tem de APARECER, e não sumir atrás de "Outro". */
  it("devolve o próprio valor para desconhecido, em vez de esconder", () => {
    expect(rotuloDe(CANAIS_DE_CAMPANHA, "tiktok")).toBe("tiktok");
  });

  it("ausência vira travessão, e não string vazia", () => {
    expect(rotuloDe(CANAIS_DE_CAMPANHA, null)).toBe("—");
    expect(rotuloDe(CANAIS_DE_CAMPANHA, "")).toBe("—");
  });
});

describe("tomDe", () => {
  it("falhou é erro; entregue e lido são sucesso; pendente é alerta", () => {
    expect(tomDe(ESTADOS_DE_ENVIO, "falhou")).toBe("erro");
    expect(tomDe(ESTADOS_DE_ENVIO, "entregue")).toBe("sucesso");
    expect(tomDe(ESTADOS_DE_ENVIO, "lido")).toBe("sucesso");
    expect(tomDe(ESTADOS_DE_ENVIO, "pendente")).toBe("alerta");
  });

  it("revogado é erro — é a única leitura honesta de um consentimento retirado", () => {
    expect(tomDe(ESTADOS_DE_CONSENTIMENTO, "revogado")).toBe("erro");
    expect(tomDe(ESTADOS_DE_CONSENTIMENTO, "concedido")).toBe("sucesso");
  });

  it("desconhecido e ausente caem em neutro, sem inventar gravidade", () => {
    expect(tomDe(ESTADOS_DE_ENVIO, "inventado")).toBe("neutro");
    expect(tomDe(ESTADOS_DE_ENVIO, null)).toBe("neutro");
  });
});
