import { describe, it, expect } from "vitest";

import {
  FORMULARIO_VAZIO,
  avisosDoFormulario,
  centavosOuNulo,
  deCampoDeData,
  estaSujo,
  formularioDaRegra,
  inteiroOuNulo,
  montarPayload,
  numeroOuNulo,
  paraCampoDeData,
  passoDoCampo,
  passosComErro,
  passosDoFormulario,
  rotuloDoValor,
  soDigitos,
  usaFaixas,
  validar,
  type FormularioDeDesconto,
} from "./formulario.logica";
import type { RegraCompleta } from "./contrato";

function forma(parcial: Partial<FormularioDeDesconto> = {}): FormularioDeDesconto {
  return {
    ...FORMULARIO_VAZIO,
    nome: "Dez por cento no PIX",
    valor: "10",
    ...parcial,
    frete: { ...FORMULARIO_VAZIO.frete, ...(parcial.frete ?? {}) },
  };
}

/* ========================================================================== *
 * Os passos
 * ========================================================================== */

describe("os seis passos, e o sétimo condicional", () => {
  it("são seis quando a regra não é de frete", () => {
    expect(passosDoFormulario(forma()).map((p) => p.chave)).toEqual([
      "oque",
      "quanto",
      "quem",
      "escopo",
      "limites",
      "janela",
    ]);
  });

  it("a aba de frete só existe na classe frete — quem cria 10% no café moído não vê faixa de CEP", () => {
    const comFrete = passosDoFormulario(forma({ classe: "frete" }));
    expect(comFrete.map((p) => p.chave)).toContain("frete");
    expect(comFrete).toHaveLength(7);
  });

  it("cada campo sabe a que passo pertence, para o erro ser encontrável", () => {
    expect(passoDoCampo("nome")).toBe("oque");
    expect(passoDoCampo("codigos.0.codigo")).toBe("oque");
    expect(passoDoCampo("valor")).toBe("quanto");
    expect(passoDoCampo("faixas.2.desconto_valor")).toBe("quanto");
    expect(passoDoCampo("meios_pagamento")).toBe("quem");
    expect(passoDoCampo("escopo.0.alvo")).toBe("escopo");
    expect(passoDoCampo("limite_por_cliente")).toBe("limites");
    expect(passoDoCampo("fim_em")).toBe("janela");
    expect(passoDoCampo("frete.cep_inicio")).toBe("frete");
  });

  it("os passos com erro saem na ordem do formulário, não na dos erros", () => {
    expect(passosComErro({ fim_em: "x", nome: "y", valor: "z" })).toEqual([
      "oque",
      "quanto",
      "janela",
    ]);
  });
});

/* ========================================================================== *
 * O rótulo que muda com a mecânica
 * ========================================================================== */

describe("o rótulo do valor muda com a mecânica, e a unidade também", () => {
  it("percentual pede pontos percentuais e diz o teto", () => {
    const r = rotuloDoValor("percentual");
    expect(r.rotulo).toBe("Desconto (%)");
    expect(r.ajuda).toContain("90");
    expect(r.usa).toBe(true);
  });

  it("preço fixo diz que é o que o item passa a custar, não o quanto sai", () => {
    expect(rotuloDoValor("preco_fixo").rotulo).toBe("Preço promocional (R$)");
    expect(rotuloDoValor("preco_fixo").ajuda).toContain("passa a custar");
  });

  it("progressivo, brinde e frete grátis não usam o campo de valor", () => {
    expect(rotuloDoValor("progressivo").usa).toBe(false);
    expect(rotuloDoValor("brinde").usa).toBe(false);
    expect(rotuloDoValor("frete_gratis").usa).toBe(false);
  });

  it("só progressivo e leve-X-pague-Y carregam faixas", () => {
    expect(usaFaixas("progressivo")).toBe(true);
    expect(usaFaixas("leve_x_pague_y")).toBe(true);
    expect(usaFaixas("percentual")).toBe(false);
  });
});

/* ========================================================================== *
 * Números — vazio é ausência
 * ========================================================================== */

describe("vazio é ausência, nunca zero", () => {
  it("campo em branco vira null, e não 0 — 0 seria “limite de nenhum uso”", () => {
    expect(inteiroOuNulo("")).toBeNull();
    expect(inteiroOuNulo("   ")).toBeNull();
    expect(centavosOuNulo("")).toBeNull();
    expect(numeroOuNulo("")).toBeNull();
  });

  it("reais com vírgula viram centavos", () => {
    expect(centavosOuNulo("149,00")).toBe(14900);
    expect(centavosOuNulo("1,005")).toBe(101);
  });

  it("o CEP perde a pontuação antes de qualquer comparação", () => {
    expect(soDigitos("01310-100")).toBe("01310100");
    expect(soDigitos(" 01310 100 ")).toBe("01310100");
  });
});

/* ========================================================================== *
 * Datas com fuso explícito
 * ========================================================================== */

describe("a data leva o fuso de São Paulo colado nela", () => {
  it("o campo do formulário vira ISO com -03:00", () => {
    expect(deCampoDeData("2026-08-27T09:00")).toBe("2026-08-27T09:00:00-03:00");
  });

  it("vazio continua vazio — “sem borda deste lado”", () => {
    expect(deCampoDeData("")).toBeNull();
    expect(deCampoDeData("   ")).toBeNull();
  });

  it("texto incompleto não vira data pela metade", () => {
    expect(deCampoDeData("2026-08-27")).toBeNull();
  });

  it("o ISO do banco volta ao campo em horário de São Paulo, e não em UTC", () => {
    // 12:00 UTC são 09:00 em São Paulo. Um `slice(0,16)` ingênuo devolveria
    // 12:00 e o gestor veria a regra começar três horas depois do que marcou.
    expect(paraCampoDeData("2026-08-27T12:00:00Z")).toBe("2026-08-27T09:00");
  });

  it("a ida e a volta fecham o círculo", () => {
    const iso = deCampoDeData("2026-12-24T18:30")!;
    expect(paraCampoDeData(iso)).toBe("2026-12-24T18:30");
  });

  it("nulo e lixo viram campo vazio, não “Invalid Date”", () => {
    expect(paraCampoDeData(null)).toBe("");
    expect(paraCampoDeData("qualquer coisa")).toBe("");
  });
});

/* ========================================================================== *
 * Validação
 * ========================================================================== */

describe("a trava do brinde — a regra que salvaria e ficaria inerte", () => {
  it("recusa salvar mecânica brinde, dizendo por quê", () => {
    const erros = validar(forma({ mecanica: "brinde", valor: "" }));
    expect(erros.mecanica).toContain("ainda não calcula brinde");
    expect(erros.mecanica).toContain("inerte");
  });

  it("e nenhuma outra mecânica é barrada por engano", () => {
    for (const m of ["percentual", "valor_fixo", "preco_fixo"] as const) {
      expect(validar(forma({ mecanica: m, valor: "10" })).mecanica).toBeUndefined();
    }
  });
});

describe("validação do passo “o que desconta”", () => {
  it("nome é obrigatório", () => {
    expect(validar(forma({ nome: "  " })).nome).toBeDefined();
  });

  it("método com código exige pelo menos um código", () => {
    const erros = validar(forma({ metodo: "codigo", codigos: [] }));
    expect(erros["codigos.0.codigo"]).toContain("pelo menos um código");
  });

  it("o código segue o formato do banco: 3 a 30, maiúsculas e números", () => {
    const erros = validar(
      forma({
        metodo: "codigo",
        codigos: [{ codigo: "ab", uso_unico: false, limite_usos: "", ativo: true }],
      }),
    );
    expect(erros["codigos.0.codigo"]).toContain("3 a 30");
  });

  it("minúscula NÃO é erro de validação — ela é normalizada no payload", () => {
    const f = forma({
      metodo: "codigo",
      codigos: [{ codigo: "cafe20", uso_unico: false, limite_usos: "", ativo: true }],
    });
    expect(validar(f)["codigos.0.codigo"]).toBeUndefined();
    expect(montarPayload(f).codigos[0].codigo).toBe("CAFE20");
  });

  it("código repetido na mesma regra é apontado", () => {
    const erros = validar(
      forma({
        metodo: "codigo",
        codigos: [
          { codigo: "CAFE20", uso_unico: false, limite_usos: "", ativo: true },
          { codigo: " cafe20 ", uso_unico: false, limite_usos: "", ativo: true },
        ],
      }),
    );
    expect(erros["codigos.1.codigo"]).toContain("repetido");
  });
});

describe("validação do passo “quanto”", () => {
  it("percentual acima de 90 é barrado com o motivo", () => {
    const erros = validar(forma({ mecanica: "percentual", valor: "95" }));
    expect(erros.valor).toContain("90%");
    expect(erros.valor).toContain("negativo");
  });

  it("percentual de 90 passa — o teto é inclusivo, como o CHECK do banco", () => {
    expect(validar(forma({ mecanica: "percentual", valor: "90" })).valor).toBeUndefined();
  });

  it("valor zero ou ausente é barrado onde a mecânica o usa", () => {
    expect(validar(forma({ valor: "0" })).valor).toBeDefined();
    expect(validar(forma({ valor: "" })).valor).toBeDefined();
  });

  it("leve X pague Y exige X inteiro de 2 para cima", () => {
    expect(
      validar(forma({ mecanica: "leve_x_pague_y", valor: "1", faixas: [] })).valor,
    ).toContain("2 para cima");
  });

  it("progressivo sem faixa não desconta nada, e a tela diz isso", () => {
    const erros = validar(forma({ mecanica: "progressivo", valor: "", faixas: [] }));
    expect(erros["faixas.0.quantidade_min"]).toContain("não desconta nada");
  });

  it("duas faixas com o mesmo piso são recusadas — é o UNIQUE do banco", () => {
    const erros = validar(
      forma({
        mecanica: "progressivo",
        valor: "",
        faixas: [
          { quantidade_min: "3", desconto_tipo: "percentual", desconto_valor: "10" },
          { quantidade_min: "3", desconto_tipo: "percentual", desconto_valor: "20" },
        ],
      }),
    );
    expect(erros["faixas.1.quantidade_min"]).toBe("Já existe uma faixa com este piso.");
  });

  it("pagar tantos quanto se leva não é desconto", () => {
    const erros = validar(
      forma({
        mecanica: "leve_x_pague_y",
        valor: "3",
        faixas: [{ quantidade_min: "3", desconto_tipo: "pague_y", desconto_valor: "3" }],
      }),
    );
    expect(erros["faixas.0.desconto_valor"]).toContain("menor que a quantidade");
  });

  it("teto de desconto em branco é “sem teto”, e não erro", () => {
    expect(validar(forma({ teto_desconto_reais: "" })).teto_desconto_reais).toBeUndefined();
    expect(validar(forma({ teto_desconto_reais: "0" })).teto_desconto_reais).toBeDefined();
  });
});

describe("validação dos limites e da janela", () => {
  it("mínimo por subtotal sem valor é “acima de nada”, e é barrado", () => {
    const erros = validar(forma({ minimo_tipo: "subtotal", minimo_valor: "" }));
    expect(erros.minimo_valor).toContain("piso em reais");
  });

  it("mínimo “nenhum” não exige valor nenhum", () => {
    expect(validar(forma({ minimo_tipo: "nenhum", minimo_valor: "" })).minimo_valor).toBeUndefined();
  });

  it("limite em branco é sem limite; zero é barrado", () => {
    expect(validar(forma({ limite_por_cliente: "" })).limite_por_cliente).toBeUndefined();
    expect(validar(forma({ limite_por_cliente: "0" })).limite_por_cliente).toBeDefined();
  });

  it("grupo de exclusividade exige a regra ser exclusiva — é o CHECK de 0032", () => {
    const erros = validar(forma({ grupo_exclusividade: "pagamento", exclusiva: false }));
    expect(erros.grupo_exclusividade).toContain("regra exclusiva");
    expect(
      validar(forma({ grupo_exclusividade: "pagamento", exclusiva: true }))
        .grupo_exclusividade,
    ).toBeUndefined();
  });

  it("o fim precisa vir depois do início", () => {
    const erros = validar(
      forma({ inicio_em: "2026-09-01T10:00", fim_em: "2026-08-01T10:00" }),
    );
    expect(erros.fim_em).toContain("depois do início");
  });

  it("nenhuma data não é erro — é “vale sempre”", () => {
    const erros = validar(forma({ inicio_em: "", fim_em: "" }));
    expect(erros.inicio_em).toBeUndefined();
    expect(erros.fim_em).toBeUndefined();
  });
});

describe("validação do frete", () => {
  const deFrete = (frete: Partial<FormularioDeDesconto["frete"]>) =>
    validar(forma({ classe: "frete", mecanica: "frete_gratis", valor: "", frete: frete as never }));

  it("meia faixa de CEP não é faixa", () => {
    expect(deFrete({ cep_inicio: "01310100", cep_fim: "" })["frete.cep_fim"]).toContain(
      "os dois extremos",
    );
  });

  it("CEP com hífen passa — a limpeza acontece antes da comparação", () => {
    const erros = deFrete({ cep_inicio: "01310-100", cep_fim: "01310-999" });
    expect(erros["frete.cep_inicio"]).toBeUndefined();
    expect(erros["frete.cep_fim"]).toBeUndefined();
  });

  it("CEP final menor que o inicial é recusado", () => {
    expect(deFrete({ cep_inicio: "09999999", cep_fim: "01310100" })["frete.cep_fim"]).toContain(
      "maior ou igual",
    );
  });

  it("CEP curto é apontado com o número de dígitos", () => {
    expect(deFrete({ cep_inicio: "0131", cep_fim: "01310999" })["frete.cep_inicio"]).toContain(
      "Oito dígitos",
    );
  });

  it("UF fora das 27 é nomeada no erro", () => {
    expect(deFrete({ ufs: ["XX"] as never })["frete.ufs"]).toContain("XX");
  });

  it("a validação de frete nem roda fora da classe frete", () => {
    const erros = validar(
      forma({ classe: "produto", frete: { ...FORMULARIO_VAZIO.frete, cep_inicio: "0131" } }),
    );
    expect(erros["frete.cep_inicio"]).toBeUndefined();
  });
});

/* ========================================================================== *
 * Avisos
 * ========================================================================== */

describe("os avisos dizem o que o silêncio escondia", () => {
  function chaves(f: FormularioDeDesconto): string[] {
    return avisosDoFormulario(f).map((a) => a.chave);
  }

  it("sem nenhuma data, avisa que vale SEMPRE — e lembra que no legado era o contrário", () => {
    const aviso = avisosDoFormulario(forma()).find((a) => a.chave === "janela.nenhuma")!;
    expect(aviso.texto).toContain("vale SEMPRE");
    expect(aviso.texto).toContain("painel antigo era o contrário");
    expect(aviso.tom).toBe("alerta");
  });

  it("só sem fim, avisa que ninguém vai desligá-la sozinho", () => {
    expect(chaves(forma({ inicio_em: "2026-09-01T00:00" }))).toContain("janela.sem_fim");
  });

  it("só sem início, é informação e não alerta", () => {
    const aviso = avisosDoFormulario(forma({ fim_em: "2026-09-01T00:00" })).find(
      (a) => a.chave === "janela.sem_inicio",
    )!;
    expect(aviso.tom).toBe("aviso");
  });

  it("percentual sem teto avisa com o número que dói", () => {
    const aviso = avisosDoFormulario(forma()).find((a) => a.chave === "teto.ausente")!;
    expect(aviso.texto).toContain("R$ 3.000");
    expect(aviso.tom).toBe("alerta");
  });

  it("com teto preenchido o aviso some", () => {
    expect(chaves(forma({ teto_desconto_reais: "30,00" }))).not.toContain("teto.ausente");
  });

  it("código sem limite por CPF avisa do grupo de WhatsApp, e diz por que é CPF", () => {
    const f = forma({
      metodo: "codigo",
      codigos: [{ codigo: "CAFE20", uso_unico: false, limite_usos: "", ativo: true }],
    });
    const aviso = avisosDoFormulario(f).find((a) => a.chave === "cpf.ausente")!;
    expect(aviso.texto).toContain("WhatsApp");
    expect(aviso.texto).toContain("e-mail é infinito");
  });

  it("frete sem teto avisa com o SEDEX para o Acre", () => {
    const f = forma({ classe: "frete", mecanica: "frete_gratis", valor: "" });
    const aviso = avisosDoFormulario(f).find((a) => a.chave === "frete.sem_teto")!;
    expect(aviso.texto).toContain("Acre");
    expect(aviso.tom).toBe("alerta");
  });

  it("frete grátis fora da classe frete é alerta: a regra não descontaria nada", () => {
    const aviso = avisosDoFormulario(
      forma({ classe: "produto", mecanica: "frete_gratis", valor: "" }),
    ).find((a) => a.chave === "classe.nao_frete")!;
    expect(aviso.tom).toBe("alerta");
  });

  it("regra desligada avisa que ela não desconta nada até ser ligada", () => {
    expect(chaves(forma({ habilitada: false }))).toContain("desligada");
    expect(chaves(forma({ habilitada: true }))).not.toContain("desligada");
  });
});

/* ========================================================================== *
 * O payload
 * ========================================================================== */

describe("o payload converte uma vez só, e no fim", () => {
  it("reais viram centavos nos campos de comparação", () => {
    const p = montarPayload(
      forma({
        teto_desconto_reais: "30,00",
        minimo_tipo: "subtotal",
        minimo_valor: "149,00",
        orcamento_reais: "5000",
      }),
    );
    expect(p.teto_desconto_centavos).toBe(3000);
    expect(p.minimo_valor).toBe(14900);
    expect(p.orcamento_centavos).toBe(500000);
  });

  it("mínimo por QUANTIDADE não passa por centavos — a unidade é item", () => {
    const p = montarPayload(forma({ minimo_tipo: "quantidade", minimo_valor: "3" }));
    expect(p.minimo_valor).toBe(3);
  });

  it("mínimo “nenhum” zera o valor, mesmo que o campo tenha texto antigo", () => {
    // O CHECK do banco recusa `'nenhum' + 15000`: o gestor digitou o piso e
    // depois voltou o tipo para "nenhum"; a tela mostrava R$ 150 e o motor
    // ignorava.
    const p = montarPayload(forma({ minimo_tipo: "nenhum", minimo_valor: "150,00" }));
    expect(p.minimo_valor).toBeNull();
  });

  it("limite em branco vira null, e não zero", () => {
    const p = montarPayload(forma({ limite_usos: "", limite_por_cliente: "" }));
    expect(p.limite_usos).toBeNull();
    expect(p.limite_por_cliente).toBeNull();
  });

  it("lista vazia de meios de pagamento vira null — “qualquer meio”, não “nenhum”", () => {
    expect(montarPayload(forma({ meios_pagamento: [] })).meios_pagamento).toBeNull();
    expect(montarPayload(forma({ meios_pagamento: ["pix"] })).meios_pagamento).toEqual(["pix"]);
  });

  it("escopo sem alvo (todos/assinante) vai com alvo null, como o CHECK exige", () => {
    const p = montarPayload(
      forma({
        escopo: [
          { tipo: "todos", alvo: "", incluir: true },
          { tipo: "assinante", alvo: "  ", incluir: true },
          { tipo: "sku", alvo: " CAN-250 ", incluir: false },
        ],
      }),
    );
    expect(p.escopo[0].alvo).toBeNull();
    expect(p.escopo[1].alvo).toBeNull();
    expect(p.escopo[2]).toEqual({ tipo: "sku", alvo: "CAN-250", incluir: false });
  });

  it("as faixas saem ordenadas pelo piso, e só quando a mecânica as usa", () => {
    const faixas = [
      { quantidade_min: "6", desconto_tipo: "percentual" as const, desconto_valor: "15" },
      { quantidade_min: "3", desconto_tipo: "percentual" as const, desconto_valor: "10" },
    ];
    expect(
      montarPayload(forma({ mecanica: "progressivo", valor: "", faixas })).faixas.map(
        (f) => f.quantidade_min,
      ),
    ).toEqual([3, 6]);
    expect(montarPayload(forma({ mecanica: "percentual", faixas })).faixas).toEqual([]);
  });

  it("o bloco de frete só existe na classe frete", () => {
    expect(montarPayload(forma({ classe: "produto" })).frete).toBeNull();
    const p = montarPayload(
      forma({
        classe: "frete",
        mecanica: "frete_gratis",
        valor: "",
        frete: {
          teto_frete_reais: "35,00",
          ufs: ["SP", "MG"],
          apenas_modalidade_mais_barata: true,
          cep_inicio: "01310-100",
          cep_fim: "01310-999",
        },
      }),
    );
    expect(p.frete).toEqual({
      teto_frete_centavos: 3500,
      ufs: ["SP", "MG"],
      apenas_modalidade_mais_barata: true,
      // O CEP entra normalizado a dígitos — o CHECK do banco recusa o formatado.
      cep_inicio: "01310100",
      cep_fim: "01310999",
    });
  });

  it("os códigos somem quando o método é automático", () => {
    const p = montarPayload(
      forma({
        metodo: "automatico",
        codigos: [{ codigo: "CAFE20", uso_unico: false, limite_usos: "", ativo: true }],
      }),
    );
    expect(p.codigos).toEqual([]);
  });

  it("o valor some quando a mecânica não o usa", () => {
    expect(montarPayload(forma({ mecanica: "frete_gratis", valor: "10" })).valor).toBeNull();
  });

  it("grupo de exclusividade some quando a regra deixa de ser exclusiva", () => {
    const p = montarPayload(forma({ exclusiva: false, grupo_exclusividade: "pagamento" }));
    expect(p.grupo_exclusividade).toBeNull();
  });
});

/* ========================================================================== *
 * A volta do servidor — e o defeito que ela existe para não repetir
 * ========================================================================== */

function regraCompleta(parcial: Partial<RegraCompleta> = {}): RegraCompleta {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    nome: "Black Friday",
    metodo: "automatico",
    classe: "pedido",
    mecanica: "percentual",
    valor: "20",
    inicio_em: "2026-11-01T03:00:00Z",
    fim_em: "2026-11-30T03:00:00Z",
    habilitada: true,
    arquivada_em: null,
    limite_usos: null,
    usos: 4,
    descontado_centavos: 12000,
    codigos: [],
    descricao: null,
    teto_desconto_centavos: 3000,
    minimo_tipo: "subtotal",
    minimo_valor: 14900,
    prioridade: 10,
    exclusiva: true,
    grupo_exclusividade: null,
    meios_pagamento: ["pix"],
    limite_por_cliente: 1,
    orcamento_centavos: null,
    escopo: [{ tipo: "todos", alvo: null, incluir: true }],
    faixas: [],
    frete: null,
    codigos_detalhe: [],
    ...parcial,
  };
}

describe("editar uma regra FORA DA JANELA não a desliga — o defeito legado, virado teste", () => {
  it("uma regra expirada e habilitada chega ao formulário AINDA habilitada", () => {
    const expirada = regraCompleta({
      inicio_em: "2020-01-01T00:00:00Z",
      fim_em: "2020-02-01T00:00:00Z",
      habilitada: true,
    });
    // No painel legado, o load MUTAVA `p.active = false` quando a data estava
    // fora da janela, o submit gravava isso, e o botão de reativar ficava
    // desabilitado pela mesma regra — a promoção virava inalcançável.
    expect(formularioDaRegra(expirada).habilitada).toBe(true);
  });

  it("e o objeto do servidor sai da conversão intacto", () => {
    const original = regraCompleta({ fim_em: "2020-02-01T00:00:00Z" });
    const antes = JSON.stringify(original);
    formularioDaRegra(original);
    expect(JSON.stringify(original)).toBe(antes);
  });

  it("salvar uma regra expirada sem tocar em nada devolve habilitada: true", () => {
    const expirada = regraCompleta({ fim_em: "2020-02-01T00:00:00Z", habilitada: true });
    expect(montarPayload(formularioDaRegra(expirada)).habilitada).toBe(true);
  });
});

describe("a ida e a volta preservam a regra", () => {
  it("centavos voltam a reais nos campos que o gestor digita", () => {
    const f = formularioDaRegra(regraCompleta());
    expect(f.teto_desconto_reais).toBe("30");
    expect(f.minimo_valor).toBe("149");
  });

  it("o payload montado a partir da regra carregada bate com a regra", () => {
    const p = montarPayload(formularioDaRegra(regraCompleta()));
    expect(p.teto_desconto_centavos).toBe(3000);
    expect(p.minimo_valor).toBe(14900);
    expect(p.meios_pagamento).toEqual(["pix"]);
    expect(p.prioridade).toBe(10);
    expect(p.escopo).toEqual([{ tipo: "todos", alvo: null, incluir: true }]);
  });

  it("uma regra carregada e não tocada NÃO está suja", () => {
    const f = formularioDaRegra(regraCompleta());
    expect(estaSujo(f, f)).toBe(false);
    expect(estaSujo(f, { ...f, valor: "20" })).toBe(false);
  });

  it("mas uma vírgula trocada suja o formulário", () => {
    const f = formularioDaRegra(regraCompleta());
    expect(estaSujo(f, { ...f, valor: "25" })).toBe(true);
    expect(estaSujo(f, { ...f, habilitada: false })).toBe(true);
  });
});
