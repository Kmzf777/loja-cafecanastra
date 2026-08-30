import { describe, it, expect } from "vitest";

import {
  abasDosDescontos,
  chipsDosDescontos,
  codigosEmTexto,
  descontadoEmTexto,
  estaNoAr,
  estadoCorrigido,
  fraseDeArquivamento,
  janelaEmTexto,
  lerEstado,
  montarConsulta,
  situacaoDaRegra,
  temFiltro,
  urlDaTela,
  usosEmTexto,
  valorEmTexto,
  vigenciaDaRegra,
  type EstadoDosDescontos,
} from "./lista.logica";
import type { RegraDaLista } from "./contrato";

/** Um instante fixo em UTC. Tudo é comparado contra ele, e por isso nenhum
 *  destes testes muda de resultado amanhã. */
const AGORA = new Date("2026-08-27T12:00:00Z");

/** O real do CLDR usa espaço NÃO SEPARÁVEL entre "R$" e o número — a mesma
 *  nota que `lib/painel/dinheiro.test.ts` já carrega, repetida aqui porque um
 *  literal com espaço comum falha com `expected 'R$ 15,00' to be 'R$ 15,00'`. */
const NBSP = String.fromCharCode(0x00a0);
const reais = (texto: string) => `R$${NBSP}${texto}`;

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
    limite_usos: null,
    usos: 0,
    descontado_centavos: 0,
    codigos: [],
    ...parcial,
  };
}

describe("a vigência é lida do relógio, nunca gravada", () => {
  it("sem datas, vale sempre — o oposto do painel legado", () => {
    expect(vigenciaDaRegra({ inicio_em: null, fim_em: null }, AGORA)).toBe("vigente");
  });

  it("com início no futuro, é agendada", () => {
    expect(
      vigenciaDaRegra({ inicio_em: "2026-09-01T00:00:00Z", fim_em: null }, AGORA),
    ).toBe("agendada");
  });

  it("com fim no passado, é expirada", () => {
    expect(
      vigenciaDaRegra({ inicio_em: null, fim_em: "2026-08-01T00:00:00Z" }, AGORA),
    ).toBe("expirada");
  });

  it("dentro da janela, é vigente", () => {
    expect(
      vigenciaDaRegra(
        { inicio_em: "2026-08-01T00:00:00Z", fim_em: "2026-09-01T00:00:00Z" },
        AGORA,
      ),
    ).toBe("vigente");
  });

  it("só início, já começado, é vigente", () => {
    expect(
      vigenciaDaRegra({ inicio_em: "2026-08-01T00:00:00Z", fim_em: null }, AGORA),
    ).toBe("vigente");
  });

  it("data ilegível não derruba a leitura — vira ausência de borda", () => {
    expect(vigenciaDaRegra({ inicio_em: "não é data", fim_em: null }, AGORA)).toBe(
      "vigente",
    );
  });
});

describe("a situação junta o relógio com a vontade do gestor", () => {
  it("arquivada ganha de tudo", () => {
    const r = regra({ arquivada_em: "2026-08-10T00:00:00Z", habilitada: true });
    expect(situacaoDaRegra(r, AGORA)).toBe("arquivada");
  });

  it("desligada ganha do relógio", () => {
    expect(situacaoDaRegra(regra({ habilitada: false }), AGORA)).toBe("desligada");
  });

  it("uma regra expirada e HABILITADA continua habilitada — a derivação não escreve no dado", () => {
    const expirada = regra({ fim_em: "2026-08-01T00:00:00Z", habilitada: true });
    expect(situacaoDaRegra(expirada, AGORA)).toBe("expirada");
    // A prova de que nada foi mutado: o objeto sai como entrou.
    expect(expirada.habilitada).toBe(true);
  });

  it("estaNoAr é verdadeiro só quando as três condições valem", () => {
    expect(estaNoAr(regra(), AGORA)).toBe(true);
    expect(estaNoAr(regra({ habilitada: false }), AGORA)).toBe(false);
    expect(estaNoAr(regra({ fim_em: "2026-08-01T00:00:00Z" }), AGORA)).toBe(false);
    expect(estaNoAr(regra({ arquivada_em: "2026-08-01T00:00:00Z" }), AGORA)).toBe(false);
  });
});

describe("os formatadores dizem a unidade", () => {
  it("percentual sai com o sinal, sem casas inúteis", () => {
    expect(valorEmTexto("percentual", "10")).toBe("10%");
    expect(valorEmTexto("percentual", "12.5")).toBe("12,50%");
  });

  it("valor fixo sai em reais e preço fixo diz que é por item", () => {
    expect(valorEmTexto("valor_fixo", "15")).toBe(reais("15,00"));
    expect(valorEmTexto("preco_fixo", "45")).toBe(`${reais("45,00")} por item`);
  });

  it("leve X pague Y lê o Y da faixa", () => {
    expect(
      valorEmTexto("leve_x_pague_y", "3", [{ quantidade_min: 3, desconto_valor: "2" }]),
    ).toBe("Leve 3, pague 2");
  });

  it("progressivo conta as faixas, e sem faixa diz que não há", () => {
    expect(
      valorEmTexto("progressivo", null, [
        { quantidade_min: 3, desconto_valor: "5" },
        { quantidade_min: 6, desconto_valor: "10" },
      ]),
    ).toBe("2 faixas");
    expect(valorEmTexto("progressivo", null, [])).toBe("Sem faixas");
  });

  it("frete grátis e brinde não fingem ter valor", () => {
    expect(valorEmTexto("frete_gratis", null)).toBe("Frete grátis");
    expect(valorEmTexto("brinde", null)).toBe("Brinde");
  });

  it("a janela tem quatro formas, e a quarta diz o que significa", () => {
    expect(
      janelaEmTexto({ inicio_em: "2026-08-01T03:00:00Z", fim_em: "2026-08-31T03:00:00Z" }),
    ).toBe("01/08/2026 a 31/08/2026");
    expect(janelaEmTexto({ inicio_em: "2026-08-01T03:00:00Z", fim_em: null })).toBe(
      "A partir de 01/08/2026",
    );
    expect(janelaEmTexto({ inicio_em: null, fim_em: "2026-08-31T03:00:00Z" })).toBe(
      "Até 31/08/2026",
    );
    expect(janelaEmTexto({ inicio_em: null, fim_em: null })).toBe(
      "Sem prazo — vale sempre",
    );
  });

  it("usos mostram o limite, e sem limite dizem isso por extenso", () => {
    expect(usosEmTexto(3, 100)).toBe("3/100");
    expect(usosEmTexto(3, null)).toBe("3/sem limite");
  });

  it("o valor descontado sai em reais a partir dos centavos", () => {
    expect(descontadoEmTexto(123456)).toBe(reais("1.234,56"));
    expect(descontadoEmTexto(0)).toBe(reais("0,00"));
  });

  it("uma lista de 500 códigos não vira uma célula de 500 palavras", () => {
    expect(codigosEmTexto([])).toBe("—");
    expect(codigosEmTexto(["CAFE20"])).toBe("CAFE20");
    expect(codigosEmTexto(["CAFE20", "CAFE30", "CAFE40"])).toBe("CAFE20 +2");
  });
});

describe("o estado da lista mora na URL — R2", () => {
  it("lê os quatro filtros e a página", () => {
    expect(
      lerEstado({ q: "pix", situacao: "vigente", metodo: "codigo", classe: "frete", pagina: "3" }),
    ).toEqual({
      busca: "pix",
      situacao: "vigente",
      metodo: "codigo",
      classe: "frete",
      pagina: 3,
    });
  });

  it("valor fora do vocabulário some, em vez de ir para a API", () => {
    const estado = lerEstado({ situacao: "meio-vigente", metodo: "telepatia", classe: "x" });
    expect(estado.situacao).toBe("");
    expect(estado.metodo).toBe("");
    expect(estado.classe).toBe("");
  });

  it("parâmetro repetido não vira filtro", () => {
    expect(lerEstado({ situacao: ["vigente", "expirada"] }).situacao).toBe("");
  });

  it("a URL da tela omite o que é padrão", () => {
    expect(urlDaTela({})).toBe("/dashboard/descontos");
    expect(urlDaTela({ pagina: 1 })).toBe("/dashboard/descontos");
    expect(urlDaTela({ busca: "pix", pagina: 2 })).toBe(
      "/dashboard/descontos?q=pix&pagina=2",
    );
  });

  it("a consulta à API leva o filtro e o tamanho da página", () => {
    const estado: EstadoDosDescontos = {
      busca: "  CAFE20 ",
      situacao: "vigente",
      metodo: "codigo",
      classe: "",
      pagina: 2,
    };
    expect(montarConsulta(estado)).toBe(
      "/admin/descontos?q=CAFE20&situacao=vigente&metodo=codigo&pagina=2&limite=20",
    );
  });

  it("a página é presa ao que existe quando o total é conhecido", () => {
    const estado: EstadoDosDescontos = {
      busca: "",
      situacao: "",
      metodo: "",
      classe: "",
      pagina: 99,
    };
    expect(estadoCorrigido(estado, 25).pagina).toBe(2);
    expect(estadoCorrigido(estado, 0).pagina).toBe(1);
  });
});

describe("os chips nomeiam a dimensão e sabem se remover — R3", () => {
  const estado: EstadoDosDescontos = {
    busca: "pix",
    situacao: "vigente",
    metodo: "codigo",
    classe: "frete",
    pagina: 4,
  };

  it("um chip por filtro aplicado", () => {
    expect(chipsDosDescontos(estado).map((c) => c.chave)).toEqual([
      "q",
      "situacao",
      "metodo",
      "classe",
    ]);
  });

  it("o chip mostra o rótulo humano, não o valor da URL", () => {
    const chips = chipsDosDescontos(estado);
    expect(chips.find((c) => c.chave === "classe")?.valor).toBe("No frete");
    expect(chips.find((c) => c.chave === "metodo")?.valor).toBe("Com código");
  });

  it("remover um chip preserva os outros e volta para a página 1", () => {
    const href = chipsDosDescontos(estado).find((c) => c.chave === "situacao")!.href;
    expect(href).toContain("q=pix");
    expect(href).toContain("metodo=codigo");
    expect(href).not.toContain("situacao=");
    expect(href).not.toContain("pagina=");
  });

  it("sem filtro, sem chip", () => {
    const limpo: EstadoDosDescontos = {
      busca: "",
      situacao: "",
      metodo: "",
      classe: "",
      pagina: 1,
    };
    expect(chipsDosDescontos(limpo)).toEqual([]);
    expect(temFiltro(limpo)).toBe(false);
    expect(temFiltro(estado)).toBe(true);
  });
});

describe("as abas salvas são URLs de verdade — R4", () => {
  const limpo: EstadoDosDescontos = {
    busca: "",
    situacao: "",
    metodo: "",
    classe: "",
    pagina: 1,
  };

  it("com a lista limpa, “Todas” é a ativa e só ela", () => {
    const abas = abasDosDescontos(limpo);
    expect(abas.filter((a) => a.ativa).map((a) => a.rotulo)).toEqual(["Todas"]);
  });

  it("cada aba é um endereço completo, que sobrevive ao F5", () => {
    const abas = abasDosDescontos(limpo);
    expect(abas.find((a) => a.rotulo === "Frete grátis")?.href).toBe(
      "/dashboard/descontos?classe=frete",
    );
    expect(abas.find((a) => a.rotulo === "Arquivadas")?.href).toBe(
      "/dashboard/descontos?situacao=arquivada",
    );
  });

  it("uma aba só acende quando o estado é EXATAMENTE o dela", () => {
    const comBusca = { ...limpo, situacao: "vigente" as const, classe: "frete" as const };
    const abas = abasDosDescontos(comBusca);
    expect(abas.filter((a) => a.ativa)).toEqual([]);
  });
});

describe("a confirmação de arquivar nomeia o objeto e a consequência — R11/R12", () => {
  it("diz o nome da regra, e não “este item”", () => {
    const frase = fraseDeArquivamento(regra({ nome: "Black Friday 2026" }));
    expect(frase).toContain('"Black Friday 2026"');
    expect(frase).toContain("tira a regra do ar imediatamente");
  });

  it("com resgates, diz quantos ficam no histórico — no plural certo", () => {
    expect(fraseDeArquivamento(regra({ usos: 12 }))).toContain("Os 12 resgates já feitos");
    // Um painel que o gestor lê cem vezes por dia não escreve "Os 1 resgates".
    expect(fraseDeArquivamento(regra({ usos: 1 }))).toContain("O resgate já feito");
  });

  it("sem resgate, diz que nada é apagado", () => {
    expect(fraseDeArquivamento(regra({ usos: 0 }))).toContain("Nada é apagado");
  });
});
