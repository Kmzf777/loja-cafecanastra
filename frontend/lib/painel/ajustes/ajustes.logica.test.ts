import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  ERRO_DO_FRETE,
  ONDE_A_LOJA_LE,
  ROTA_DE_AJUSTES,
  SEM_REAUTORIZACAO_PELO_PAINEL,
  TIPOS_DE_OPCAO,
  analisarFreteGratis,
  avisoDoFreteGratis,
  centavosParaCampo,
  estadoDaIntegracao,
  estadoInicialDaLoja,
  houveMudanca,
  interruptoresDoBling,
  montarPayloadDaLoja,
  motivoParaNaoExcluir,
  opcoesDoTipo,
  podeSinalizarUso,
  somenteDigitos,
  validarNovaOpcao,
  valoresEmUso,
  type EstadoDaLoja,
} from "./ajustes.logica";

const RAIZ_DO_BACKEND = join(__dirname, "..", "..", "..", "..", "backend");

function loja(parcial: Partial<EstadoDaLoja> = {}): EstadoDaLoja {
  return { titulo: "", whatsapp: "", freteGratisReais: "", ...parcial };
}

/* ==========================================================================
 * O FRETE GRÁTIS — o campo que desligava a loja inteira
 * ========================================================================== */

describe("analisarFreteGratis — os três resultados", () => {
  it("campo em branco é AUSENTE, e ausente não é zero", () => {
    expect(analisarFreteGratis("")).toEqual({ tipo: "ausente" });
    expect(analisarFreteGratis("   ")).toEqual({ tipo: "ausente" });
  });

  it("aceita vírgula, ponto e inteiro sem casas", () => {
    expect(analisarFreteGratis("149,00")).toEqual({
      tipo: "valor",
      centavos: 14900,
      desliga: false,
    });
    expect(analisarFreteGratis("149.00").tipo).toBe("valor");
    expect(analisarFreteGratis("149")).toEqual({
      tipo: "valor",
      centavos: 14900,
      desliga: false,
    });
  });

  it("perdoa o 'R$' de quem copiou de outro lugar", () => {
    expect(analisarFreteGratis("R$ 149,00")).toEqual({
      tipo: "valor",
      centavos: 14900,
      desliga: false,
    });
  });

  it("uma casa decimal só também é dinheiro", () => {
    expect(analisarFreteGratis("149,5")).toEqual({
      tipo: "valor",
      centavos: 14950,
      desliga: false,
    });
  });

  it("zero é VÁLIDO, e vem marcado como 'desliga'", () => {
    expect(analisarFreteGratis("0")).toEqual({
      tipo: "valor",
      centavos: 0,
      desliga: true,
    });
    expect(analisarFreteGratis("0,00").desliga).toBe(true);
  });

  it.each(["abc", "-10", "149,000", "1.490,00", "1,490.00", "12,", "R$"])(
    "recusa %s com a frase que diz a unidade e o formato",
    (entrada) => {
      const r = analisarFreteGratis(entrada);
      expect(r.tipo).toBe("invalido");
      expect(r.tipo === "invalido" && r.erro).toBe(ERRO_DO_FRETE);
    },
  );

  /**
   * O separador de milhar fica de fora de propósito: "1.490,00" e "1,490.00"
   * são a mesma sequência de símbolos em convenções opostas, e aceitar as duas
   * é escolher em silêncio entre R$ 1.490 e R$ 1,49.
   */
  it("recusar o separador de milhar é uma decisão, não uma lacuna", () => {
    expect(analisarFreteGratis("1.490,00").tipo).toBe("invalido");
    expect(analisarFreteGratis("1490,00")).toEqual({
      tipo: "valor",
      centavos: 149000,
      desliga: false,
    });
  });

  it("a frase de erro diz a unidade e mostra o formato", () => {
    expect(ERRO_DO_FRETE).toContain("reais");
    expect(ERRO_DO_FRETE).toContain("149,00");
    expect(ERRO_DO_FRETE).toContain("centavos");
  });
});

describe("avisoDoFreteGratis", () => {
  it("avisa em voz alta quando o valor é zero", () => {
    const aviso = avisoDoFreteGratis(analisarFreteGratis("0"))!;
    expect(aviso).toContain("DESLIGA o frete grátis da loja inteira");
    expect(aviso).toContain("branco");
  });

  it("não avisa nada quando há valor de verdade, nem quando o campo está vazio", () => {
    expect(avisoDoFreteGratis(analisarFreteGratis("149,00"))).toBeNull();
    expect(avisoDoFreteGratis(analisarFreteGratis(""))).toBeNull();
    expect(avisoDoFreteGratis(analisarFreteGratis("abc"))).toBeNull();
  });
});

describe("montarPayloadDaLoja — OMITIR, nunca mandar vazio", () => {
  /**
   * O defeito inteiro: `PUT /config` chega por multipart, um campo vazio vale
   * `''`, `Number('')` é `0`, a validação aprovava, e zero DESLIGA o frete
   * grátis da loja inteira — arrastado por qualquer outro campo do mesmo
   * formulário. O backend foi endurecido; esta tela não depende disso.
   */
  it("o campo de frete em branco NÃO entra no corpo", () => {
    const campos = montarPayloadDaLoja(
      loja({ titulo: "Café Canastra", freteGratisReais: "" }),
      analisarFreteGratis(""),
    );
    expect(campos.map((c) => c.campo)).toEqual(["site_title"]);
    expect(campos.map((c) => c.campo)).not.toContain("frete_gratis_minimo_centavos");
  });

  it("o frete válido entra em CENTAVOS, como inteiro em texto", () => {
    const campos = montarPayloadDaLoja(
      loja({ freteGratisReais: "149,00" }),
      analisarFreteGratis("149,00"),
    );
    expect(campos).toEqual([
      { campo: "frete_gratis_minimo_centavos", valor: "14900" },
    ]);
  });

  it("o zero explícito ENTRA — desligar de propósito é um caminho legítimo", () => {
    const campos = montarPayloadDaLoja(
      loja({ freteGratisReais: "0" }),
      analisarFreteGratis("0"),
    );
    expect(campos).toEqual([{ campo: "frete_gratis_minimo_centavos", valor: "0" }]);
  });

  it("frete inválido não entra — mas quem aborta o submit é a tela", () => {
    const campos = montarPayloadDaLoja(
      loja({ titulo: "X", freteGratisReais: "abc" }),
      analisarFreteGratis("abc"),
    );
    expect(campos.map((c) => c.campo)).not.toContain("frete_gratis_minimo_centavos");
  });

  it("título e WhatsApp em branco também ficam de fora", () => {
    expect(montarPayloadDaLoja(loja(), analisarFreteGratis(""))).toEqual([]);
  });

  it("o WhatsApp sai só com dígitos", () => {
    const campos = montarPayloadDaLoja(
      loja({ whatsapp: "+55 (37) 99999-0000" }),
      analisarFreteGratis(""),
    );
    expect(campos).toEqual([{ campo: "whatsapp_number", valor: "5537999990000" }]);
  });

  it("apara o título — 'Café  ' e 'Café' são o mesmo nome", () => {
    const campos = montarPayloadDaLoja(
      loja({ titulo: "  Café Canastra  " }),
      analisarFreteGratis(""),
    );
    expect(campos[0].valor).toBe("Café Canastra");
  });

  /**
   * O contrato do PUT é em inglês embora a tabela fale português
   * (`titulo_site AS site_title`). Um nome errado aqui é um campo que não
   * grava, em silêncio — o `atribui()` do repositório simplesmente não o vê.
   */
  it("usa os nomes do CONTRATO, conferidos contra o configRepository", () => {
    const fonte = readFileSync(
      join(RAIZ_DO_BACKEND, "src", "repositories", "configRepository.js"),
      "utf8",
    );
    for (const campo of [
      "site_title",
      "whatsapp_number",
      "frete_gratis_minimo_centavos",
    ]) {
      expect(fonte).toContain(campo);
    }
  });
});

describe("centavosParaCampo", () => {
  it("mostra em reais com vírgula, como se digita", () => {
    expect(centavosParaCampo(14900)).toBe("149,00");
    expect(centavosParaCampo(0)).toBe("0,00");
    expect(centavosParaCampo(5)).toBe("0,05");
  });

  /**
   * Zero é um valor com significado grave (desliga o frete grátis). Escrevê-lo
   * por causa de um campo que o servidor não mandou seria pôr na tela uma
   * decisão que ninguém tomou — que, salva, vira a decisão de verdade.
   */
  it("ausente vira campo VAZIO, e nunca '0,00'", () => {
    expect(centavosParaCampo(null)).toBe("");
    expect(centavosParaCampo(undefined)).toBe("");
    expect(centavosParaCampo(Number.NaN)).toBe("");
  });

  it("fecha o ciclo com analisarFreteGratis", () => {
    const r = analisarFreteGratis(centavosParaCampo(14900));
    expect(r).toEqual({ tipo: "valor", centavos: 14900, desliga: false });
  });
});

describe("estadoInicialDaLoja", () => {
  it("traz o que o servidor tem, com o frete já em reais", () => {
    expect(
      estadoInicialDaLoja({
        site_title: "Café Canastra",
        whatsapp_number: "5537999990000",
        frete_gratis_minimo_centavos: 14900,
      }),
    ).toEqual({
      titulo: "Café Canastra",
      whatsapp: "5537999990000",
      freteGratisReais: "149,00",
    });
  });

  it("config ausente vira formulário vazio, não formulário com zeros", () => {
    expect(estadoInicialDaLoja(null)).toEqual(loja());
  });
});

describe("somenteDigitos", () => {
  it("tira toda pontuação", () => {
    expect(somenteDigitos("+55 (37) 99999-0000")).toBe("5537999990000");
  });
  it("texto sem dígito vira vazio", () => {
    expect(somenteDigitos("liga pra mim")).toBe("");
  });
});

describe("houveMudanca — R5", () => {
  it("é falso quando nada foi tocado", () => {
    const inicial = loja({ titulo: "A", freteGratisReais: "149,00" });
    expect(houveMudanca(inicial, { ...inicial })).toBe(false);
  });

  it.each(["titulo", "whatsapp", "freteGratisReais"] as const)(
    "é verdadeiro quando %s muda",
    (campo) => {
      const inicial = loja({ titulo: "A", whatsapp: "1", freteGratisReais: "2" });
      expect(houveMudanca(inicial, { ...inicial, [campo]: "z" })).toBe(true);
    },
  );

  /**
   * A comparação é do TEXTO CRU. "149,00" e "149.00" viram o mesmo número, mas
   * quem trocou a vírgula pelo ponto MEXEU no campo — e uma barra de salvar que
   * não aparece depois de uma edição visível é uma barra em que não se confia.
   * Falso positivo custa um clique; falso negativo custa o trabalho.
   */
  it("compara texto, não valor — edição visível acende a barra", () => {
    const inicial = loja({ freteGratisReais: "149,00" });
    expect(houveMudanca(inicial, loja({ freteGratisReais: "149.00" }))).toBe(true);
  });
});

describe("ONDE_A_LOJA_LE — a tela diz o que salvar faz e o que não faz", () => {
  /**
   * `banner_desktop`, `banner_mobile` e `barra_de_aviso` eram campos WRITE-ONLY:
   * o painel legado os editava e a vitrine nova nunca os leu (spec §1). A 0030
   * moveu herói e barra para `canastra.vitrine_*`. Repetir o defeito com
   * `titulo_site` e `whatsapp` — editáveis e sem leitor — seria fazer o mesmo
   * pela outra porta; a saída honesta é dizer, campo a campo.
   */
  it("diz que a loja LÊ o piso do frete grátis", () => {
    expect(ONDE_A_LOJA_LE.frete_gratis_minimo_centavos).toContain("A loja lê");
  });

  it("diz que a loja NÃO lê o WhatsApp, e de onde ele vem de verdade", () => {
    expect(ONDE_A_LOJA_LE.whatsapp_number).toContain("NÃO lê");
    expect(ONDE_A_LOJA_LE.whatsapp_number).toContain("NEXT_PUBLIC_WHATSAPP");
  });

  it("diz que a loja NÃO lê o título", () => {
    expect(ONDE_A_LOJA_LE.site_title).toContain("NÃO lê");
  });

  /** A afirmação, conferida contra o código da loja: o botão de WhatsApp lê a
   *  env resolvida no build, e não `/config`. */
  it("a afirmação sobre o WhatsApp bate com lib/whatsapp.ts", () => {
    const fonte = readFileSync(
      join(__dirname, "..", "..", "whatsapp.ts"),
      "utf8",
    );
    expect(fonte).toContain("NEXT_PUBLIC_WHATSAPP");
    expect(fonte).not.toContain("/config");
  });
});

/* ==========================================================================
 * CATEGORIAS
 * ========================================================================== */

describe("TIPOS_DE_OPCAO", () => {
  /**
   * O descompasso que o checklist nomeia: o rótulo é "Embalagens" e o `type` é
   * `size`. Três vocabulários no mesmo caminho — `tamanho` no banco, `size` no
   * contrato, "Embalagens" para o gestor.
   */
  it("o rótulo é 'Embalagens' e o type é 'size'", () => {
    const embalagens = TIPOS_DE_OPCAO.find((t) => t.tipo === "size")!;
    expect(embalagens.rotulo).toBe("Embalagens");
  });

  it("os dois tipos são os que o optionsRepository traduz", () => {
    const fonte = readFileSync(
      join(RAIZ_DO_BACKEND, "src", "repositories", "optionsRepository.js"),
      "utf8",
    );
    const bloco = fonte.match(/TIPO_DO_CONTRATO\s*=\s*\{([^}]*)\}/);
    expect(bloco).not.toBeNull();
    const doBackend = [...bloco![1].matchAll(/(\w+):/g)].map((m) => m[1]);
    expect(TIPOS_DE_OPCAO.map((t) => t.tipo)).toEqual(doBackend);
  });

  it("cada tipo tem ajuda com exemplo — 'Categoria' sozinho não ensina nada", () => {
    for (const t of TIPOS_DE_OPCAO) {
      expect(t.ajuda.length).toBeGreaterThan(20);
    }
  });
});

describe("opcoesDoTipo", () => {
  const opcoes = [
    { id: "1", type: "category", value: "Clássico" },
    { id: "2", type: "size", value: "250 g" },
    { id: "3", type: "category", value: "Especial" },
  ];

  it("separa as duas listas, na ordem em que vieram", () => {
    expect(opcoesDoTipo(opcoes, "category").map((o) => o.value)).toEqual([
      "Clássico",
      "Especial",
    ]);
    expect(opcoesDoTipo(opcoes, "size").map((o) => o.value)).toEqual(["250 g"]);
  });

  it("tipo desconhecido devolve lista vazia, nunca tudo", () => {
    expect(opcoesDoTipo(opcoes, "cor")).toEqual([]);
  });
});

describe("valoresEmUso", () => {
  it("junta categoria e tamanho de todos os produtos", () => {
    const usados = valoresEmUso([
      { category: "Clássico", size: "250 g" },
      { category: "Especial", size: "250 g" },
    ]);
    expect([...usados].sort()).toEqual(["250 g", "Clássico", "Especial"]);
  });

  it("ignora nulo e vazio — não vira uma opção fantasma em uso", () => {
    const usados = valoresEmUso([
      { category: null, size: "" },
      { category: "  ", size: "1 kg" },
    ]);
    expect([...usados]).toEqual(["1 kg"]);
  });

  it("catálogo vazio não usa nada", () => {
    expect(valoresEmUso([]).size).toBe(0);
  });
});

describe("podeSinalizarUso", () => {
  /**
   * `GET /dashboard` tem teto de 200 por página. Com 250 produtos, os 50 de fora
   * poderiam usar justamente a opção que a tela marcaria como livre — e marca
   * errada numa tela de exclusão é pior que marca nenhuma, porque convida ao
   * clique. O 409 do backend continua sendo a autoridade nos dois casos.
   */
  it("só confia quando a leitura cobriu o catálogo inteiro", () => {
    expect(podeSinalizarUso(40, 40)).toBe(true);
    expect(podeSinalizarUso(250, 200)).toBe(false);
  });

  it("total desconhecido não é confiança", () => {
    expect(podeSinalizarUso(Number.NaN, 200)).toBe(false);
  });
});

describe("motivoParaNaoExcluir", () => {
  it("em uso vira frase com o CONSERTO, não só a proibição", () => {
    const motivo = motivoParaNaoExcluir(true)!;
    expect(motivo).toContain("Em uso");
    expect(motivo).toContain("troque a opção nesses produtos");
  });

  it("livre é null — e aí a tela desenha o botão", () => {
    expect(motivoParaNaoExcluir(false)).toBeNull();
  });
});

describe("validarNovaOpcao", () => {
  it("vazio não vira POST", () => {
    expect(validarNovaOpcao("")).toBe("Escreva o valor antes de adicionar.");
    expect(validarNovaOpcao("   ")).not.toBeNull();
  });
  it("valor de verdade passa", () => {
    expect(validarNovaOpcao("Micro-lote")).toBeNull();
  });
});

/* ==========================================================================
 * BLING
 * ========================================================================== */

describe("estadoDaIntegracao — a ordem da vida da credencial", () => {
  /**
   * Sonda sem resposta NÃO é "desligado". O `GET /bling/status` responde
   * SEMPRE, ligado ou não — é ele que diagnostica o desligado —, então silêncio
   * é a rede, e concluir "desligado" mandaria o gestor procurar um interruptor
   * que está ligado.
   */
  it("sem resposta é 'não se sabe', e não 'desligado'", () => {
    const e = estadoDaIntegracao(null);
    expect(e.chave).toBe("sem-resposta");
    expect(e.texto).toContain("não quer dizer que a integração está desligada");
    expect(e.tom).not.toBe("erro");
  });

  /**
   * Estado de FÁBRICA, não erro — a mesma decisão da caixa azul do painel
   * legado. R21 reserva o vermelho a erro e destruição, e pintar de vermelho o
   * estado normal de quem nunca ligou a integração ensina a ignorar vermelho.
   */
  it("sem credencial é estado de fábrica, e não usa o tom de erro", () => {
    const e = estadoDaIntegracao({ configurado: false });
    expect(e.chave).toBe("sem-credencial");
    expect(e.tom).toBe("neutro");
    expect(e.texto).toContain("BLING_CLIENT_ID");
  });

  it("token que não renova É erro, e a frase do servidor chega inteira", () => {
    const e = estadoDaIntegracao({
      configurado: true,
      token: { ok: false, erro: "O refresh token ficou OBSOLETO e não vale mais." },
    });
    expect(e.chave).toBe("token-invalido");
    expect(e.tom).toBe("erro");
    expect(e.texto).toBe("O refresh token ficou OBSOLETO e não vale mais.");
  });

  it("token quebrado sem frase ganha uma que ao menos diz de quem é a recusa", () => {
    const e = estadoDaIntegracao({ configurado: true, token: { ok: false } });
    expect(e.texto).toContain("Bling recusou");
  });

  it("credencial boa com BLING_ATIVO desligado é alerta, e nomeia a variável", () => {
    const e = estadoDaIntegracao({
      configurado: true,
      token: { ok: true },
      ativo: false,
    });
    expect(e.chave).toBe("desligada");
    expect(e.tom).toBe("alerta");
    expect(e.texto).toContain("BLING_ATIVO");
  });

  it("tudo ligado é sucesso, e lembra onde a nota se emite", () => {
    const e = estadoDaIntegracao({
      configurado: true,
      token: { ok: true },
      ativo: true,
    });
    expect(e.chave).toBe("ligada");
    expect(e.tom).toBe("sucesso");
    expect(e.texto).toContain("dentro do pedido");
  });

  /**
   * A ordem é a coisa que não se reordena: perguntar "está ativo?" antes de "as
   * credenciais existem?" produz "desligado" para uma instalação que nunca foi
   * configurada, e manda o gestor procurar um interruptor em vez do cadastro.
   */
  it("sem credencial vence 'ativo=true' — a pergunta mais fundamental vem antes", () => {
    expect(
      estadoDaIntegracao({ configurado: false, ativo: true, token: { ok: true } })
        .chave,
    ).toBe("sem-credencial");
  });

  it("token quebrado vence 'ativo=true'", () => {
    expect(
      estadoDaIntegracao({ configurado: true, ativo: true, token: { ok: false } })
        .chave,
    ).toBe("token-invalido");
  });
});

describe("interruptoresDoBling", () => {
  it("nomeia a variável de cada um — 'está desligado' sozinho não é acionável", () => {
    const itens = interruptoresDoBling({ nfeAuto: true, rastreioCron: false });
    expect(itens).toEqual([
      { rotulo: "Emitir NF-e automaticamente", variavel: "BLING_NFE_AUTO", ligado: true },
      {
        rotulo: "Buscar rastreio periodicamente",
        variavel: "BLING_RASTREIO_CRON",
        ligado: false,
      },
    ]);
  });

  it("sonda ausente desliga os dois, sem inventar 'talvez'", () => {
    expect(interruptoresDoBling(null).every((i) => !i.ligado)).toBe(true);
  });

  it("as variáveis são as que o backend lê", () => {
    const fonte = readFileSync(
      join(RAIZ_DO_BACKEND, "src", "routes", "bling.routes.js"),
      "utf8",
    );
    for (const { variavel } of interruptoresDoBling(null)) {
      expect(fonte).toContain(variavel);
    }
  });
});

describe("SEM_REAUTORIZACAO_PELO_PAINEL", () => {
  /**
   * Não existe rota de callback OAuth nem caminho de aplicação para colar um
   * refresh token novo: o primeiro é colado em `BLING_REFRESH_TOKEN` e a partir
   * daí ele se renova sozinho, gravado em `config_loja.bling_refresh_token`.
   * Dizer isso é o que separa "a tela não tem o botão" de "a tela está
   * quebrada".
   */
  it("explica o caminho real, com o nome da variável", () => {
    expect(SEM_REAUTORIZACAO_PELO_PAINEL).toContain("BLING_REFRESH_TOKEN");
    expect(SEM_REAUTORIZACAO_PELO_PAINEL).toContain("painel do Bling");
  });

  it("a afirmação bate com o backend: o primeiro token vem da env", () => {
    const fonte = readFileSync(
      join(RAIZ_DO_BACKEND, "src", "services", "blingClient.js"),
      "utf8",
    );
    expect(fonte).toContain("process.env.BLING_REFRESH_TOKEN");
    expect(fonte).toContain("bling_refresh_token");
  });
});

describe("ROTA_DE_AJUSTES", () => {
  it("é a rota em português do App Router", () => {
    expect(ROTA_DE_AJUSTES).toBe("/dashboard/ajustes");
  });
});
