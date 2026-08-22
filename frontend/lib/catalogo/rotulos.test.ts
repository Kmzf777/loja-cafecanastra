import { describe, it, expect } from "vitest";
import { classificacaoSca, formatarSca, rotuloNota } from "./rotulos";
import { LOTES } from "./produtos";

/**
 * A PONTUAÇÃO SCA É O ÚNICO NÚMERO DESTA VITRINE QUE PODE VIRAR PROPAGANDA
 * ENGANOSA, e passou a ter dois regimes:
 *
 *   PISO — o que a EMBALAGEM declara. "SCA 80+" não é a nota daquele café; é o
 *   mínimo que a marca garante para a coleção. Foi por isso que o mock antigo,
 *   com 84,25 e 85,50, saiu: nenhuma prova de xícara produziu aqueles decimais.
 *
 *   EXATA — a nota que a marca publica para AQUELA linha. O Microlote tem 86 e
 *   o Néctar de Minas tem 75.
 *
 * E 75 é o caso que obriga tudo isto a existir: abaixo de 80 o café NÃO É
 * ESPECIAL pela definição da própria SCA. Um selo escrevendo "ESPECIAL · SCA
 * 80+" nessa linha é mentira na vitrine, em cima do único selo que a marca
 * usa para se provar.
 */

describe("formatarSca", () => {
  it("o piso sai com o '+', porque é piso e não nota", () => {
    expect(formatarSca(80, false)).toBe("SCA 80+");
  });

  it("a nota exata sai sem o '+', porque não é piso de nada", () => {
    expect(formatarSca(86, true)).toBe("SCA 86");
    expect(formatarSca(75, true)).toBe("SCA 75");
  });

  it("nunca inventa decimal, nem quando recebe um", () => {
    // Defesa contra o mock antigo voltando por outra porta: 84,25 vira 84.
    expect(formatarSca(84.25, true)).toBe("SCA 84");
    expect(formatarSca(84.25, false)).toBe("SCA 84+");
  });
});

describe("classificacaoSca", () => {
  it("80 é o corte da própria SCA, e ele é inclusivo", () => {
    expect(classificacaoSca(80)).toBe("especial");
    expect(classificacaoSca(86)).toBe("especial");
  });

  it("abaixo de 80 não é especial — é gourmet, e o selo tem de dizer isso", () => {
    expect(classificacaoSca(79)).toBe("gourmet");
    expect(classificacaoSca(75)).toBe("gourmet");
  });
});

describe("o catálogo real passado pelos dois", () => {
  it("nenhuma linha abaixo de 80 é anunciada como especial", () => {
    for (const lote of LOTES) {
      if (lote.sca < 80) {
        expect(classificacaoSca(lote.sca), lote.slug).toBe("gourmet");
      }
    }
  });

  it("nenhuma linha com nota exata sai com '+' — e nenhum piso sai sem", () => {
    for (const lote of LOTES) {
      const texto = formatarSca(lote.sca, lote.scaExata);
      expect(texto.endsWith("+"), `${lote.slug}: "${texto}"`).toBe(!lote.scaExata);
    }
  });

  it("o Néctar de Minas nunca exibe 80+ em lugar nenhum", () => {
    // O caso concreto que motivou a mudança, cravado pelo slug: se alguém
    // devolver o `sca` desta linha ao piso da coleção, a vitrine volta a
    // prometer café especial num café de 75 pontos.
    const nectar = LOTES.find((l) => l.slug === "nectar-de-minas");
    expect(nectar).toBeDefined();
    expect(formatarSca(nectar!.sca, nectar!.scaExata)).toBe("SCA 75");
  });
});

describe("rótulos de nota de sabor", () => {
  it("toda nota do catálogo tem forma legível — nada de kebab-case na tela", () => {
    for (const lote of LOTES) {
      expect(lote.notas.length, lote.slug).toBeGreaterThan(0);
      for (const nota of lote.notas) {
        const rotulo = rotuloNota(nota);
        expect(rotulo, `${lote.slug} · ${nota}`).not.toContain("-");
        expect(rotulo[0], `${lote.slug} · ${nota}`).toBe(rotulo[0].toUpperCase());
      }
    }
  });

  it("a chave de filtro continua kebab-case sem acento", () => {
    // A nota é chave de busca e de faceta (ver lib/busca.ts): acento ou
    // maiúscula aqui vira filtro que não casa com a URL que o cliente
    // compartilhou.
    for (const lote of LOTES) {
      for (const nota of lote.notas) {
        expect(nota, `${lote.slug} · ${nota}`).toMatch(/^[a-z]+(-[a-z]+)*$/);
      }
    }
  });
});
