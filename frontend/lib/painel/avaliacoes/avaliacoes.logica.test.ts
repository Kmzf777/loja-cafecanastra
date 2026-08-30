import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  LIMITE_DO_LOTE,
  POR_PAGINA,
  ROTA_DE_AVALIACOES,
  STATUS_DE_AVALIACAO,
  chipsDasAvaliacoes,
  consultaDePendentes,
  contarAvaliacoes,
  corpoDaAvaliacao,
  estadoCorrigido,
  fraseDeNadaAMudar,
  identificarAutor,
  idsQueMudam,
  lerEstado,
  montarConsulta,
  notaEmTexto,
  resumoDaModeracao,
  resumoDaSelecao,
  rotuloDaAvaliacao,
  temFiltro,
  textoOuTraco,
  tomDaAvaliacao,
  urlDaTela,
  urlDoStatus,
  type AvaliacaoDaLista,
  type EstadoDasAvaliacoes,
} from "./avaliacoes.logica";

function estado(parcial: Partial<EstadoDasAvaliacoes> = {}): EstadoDasAvaliacoes {
  return { busca: "", status: "", sku: "", pagina: 1, ...parcial };
}

function linha(parcial: Partial<AvaliacaoDaLista> = {}): AvaliacaoDaLista {
  return {
    id: "aaaaaaaa-0000-0000-0000-000000000001",
    sku: "CLASSICO-250",
    nota: 5,
    titulo: "Excelente",
    texto: "Chegou rápido e o café é ótimo.",
    nome_exibicao: "Ana",
    status: "pendente",
    user_id: "bbbbbbbb-0000-0000-0000-000000000001",
    criado_em: "2026-08-20T13:00:00.000Z",
    moderado_em: null,
    ...parcial,
  };
}

/* ========================================================================== */

describe("STATUS_DE_AVALIACAO", () => {
  /**
   * O teste que importa, e o mesmo contrato que `status.test.ts` mantém para
   * pedidos: a lista do painel COMPARADA COM A DO BACKEND, lida do disco.
   *
   * Uma divergência aqui não aparece em `tsc` nem em `next build` — aparece no
   * 400 do repositório ("Status inválido. Use um de: …") na cara do gestor, ou,
   * pior, num filtro que devolve sempre vazio.
   */
  it("tem exatamente os valores de backend/src/repositories/avaliacoesRepository.js", () => {
    const fonte = readFileSync(
      join(
        __dirname,
        "..", "..", "..", "..",
        "backend", "src", "repositories", "avaliacoesRepository.js",
      ),
      "utf8",
    );
    const bloco = fonte.match(
      /STATUS_DE_AVALIACAO\s*=\s*Object\.freeze\(\[([\s\S]*?)\]\)/,
    );
    expect(bloco).not.toBeNull();
    const doBackend = [...bloco![1].matchAll(/"([a-z_]+)"/g)].map((m) => m[1]);

    expect(STATUS_DE_AVALIACAO.map((s) => s.valor)).toEqual(doBackend);
  });

  /**
   * A armadilha nomeada pela spec e pelo plano: `recusada` é o nome que quem
   * conhece qualquer outro e-commerce tenta primeiro, e o CHECK da 0014 recusa
   * com 23514. Se um dia alguém a acrescentar aqui "para ficar completo", este
   * teste explica por que não.
   */
  it("NÃO tem 'recusada' — a 0014 decidiu 'oculta', que despublica sem apagar", () => {
    expect(STATUS_DE_AVALIACAO.map((s) => s.valor)).not.toContain("recusada");
    expect(STATUS_DE_AVALIACAO.map((s) => s.valor)).toContain("oculta");
  });

  /**
   * O `as const` da lista faz o TypeScript ESTREITAR `tom` para os três tons
   * que ela de fato usa, e aí `s.tom !== "erro"` vira comparação sem
   * sobreposição — `tsc` recusa, e com razão: ele já provou o que o teste
   * queria provar, de graça e antes de rodar.
   *
   * A asserção fica assim mesmo, alargada de propósito. O tipo garante hoje; a
   * lista garante no dia em que alguém acrescentar um status novo com
   * `tom: "erro"` — porque aí a união cresce, `tsc` volta a aceitar a
   * comparação, e é este caso que fica vermelho. Uma prova estática e uma de
   * execução guardam momentos diferentes.
   */
  it("nenhum status usa o tom de erro — R21 reserva o vermelho a erro e destruição", () => {
    const tons: string[] = STATUS_DE_AVALIACAO.map((s) => s.tom);
    expect(tons).not.toContain("erro");
  });

  it("todo status tem rótulo em português, diferente do valor", () => {
    for (const s of STATUS_DE_AVALIACAO) {
      expect(s.rotulo.length).toBeGreaterThan(0);
      expect(s.rotulo).not.toBe(s.valor);
    }
  });
});

describe("rotuloDaAvaliacao / tomDaAvaliacao", () => {
  it("traduz os três conhecidos", () => {
    expect(rotuloDaAvaliacao("pendente")).toBe("Pendente");
    expect(rotuloDaAvaliacao("aprovada")).toBe("Aprovada");
    expect(rotuloDaAvaliacao("oculta")).toBe("Oculta");
  });

  it("devolve o próprio valor para desconhecido, em vez de escondê-lo", () => {
    expect(rotuloDaAvaliacao("recusada")).toBe("recusada");
    expect(tomDaAvaliacao("recusada")).toBe("neutro");
  });

  it("pendente é alerta e aprovada é sucesso", () => {
    expect(tomDaAvaliacao("pendente")).toBe("alerta");
    expect(tomDaAvaliacao("aprovada")).toBe("sucesso");
    expect(tomDaAvaliacao("oculta")).toBe("neutro");
  });
});

/* ========================================================================== */

describe("lerEstado", () => {
  it("lê os três filtros e a página", () => {
    expect(
      lerEstado({ q: "amassado", status: "pendente", sku: "X-1", pagina: "3" }),
    ).toEqual({ busca: "amassado", status: "pendente", sku: "X-1", pagina: 3 });
  });

  it("sem nada na URL, tudo em branco e página 1", () => {
    expect(lerEstado({})).toEqual({ busca: "", status: "", sku: "", pagina: 1 });
  });

  it("apara espaço — '?q=%20%20' não é uma busca por dois espaços", () => {
    expect(lerEstado({ q: "  maria  " }).busca).toBe("maria");
    expect(lerEstado({ q: "   " }).busca).toBe("");
  });

  it("parâmetro repetido cai no padrão em vez de escolher um dos dois", () => {
    expect(lerEstado({ q: ["a", "b"] }).busca).toBe("");
    expect(lerEstado({ status: ["pendente", "oculta"] }).status).toBe("");
    expect(lerEstado({ pagina: ["2", "9"] }).pagina).toBe(1);
  });

  it("página lixo, zero e negativa viram 1", () => {
    expect(lerEstado({ pagina: "abc" }).pagina).toBe(1);
    expect(lerEstado({ pagina: "0" }).pagina).toBe(1);
    expect(lerEstado({ pagina: "-4" }).pagina).toBe(1);
  });

  /**
   * A DECISÃO deste módulo: status desconhecido ATRAVESSA. Descartá-lo em
   * silêncio faria a tela mostrar tudo enquanto a barra de endereço diz
   * "recusada"; deixando passar, o backend responde com a frase que nomeia os
   * três valores que existem — que é a resposta à pergunta que a pessoa fez.
   */
  it("status desconhecido NÃO é descartado — a frase do servidor é o diagnóstico", () => {
    expect(lerEstado({ status: "recusada" }).status).toBe("recusada");
  });
});

describe("montarConsulta", () => {
  it("sem filtro, só página e limite", () => {
    expect(montarConsulta(estado())).toBe("/admin/avaliacoes?page=1&limit=20");
  });

  it("leva busca, status e sku quando existem", () => {
    const url = montarConsulta(
      estado({ busca: "café frio", status: "pendente", sku: "CLA-250", pagina: 2 }),
    );
    expect(url).toContain("q=caf%C3%A9+frio");
    expect(url).toContain("status=pendente");
    expect(url).toContain("sku=CLA-250");
    expect(url).toContain("page=2");
    expect(url).toContain("limit=20");
  });

  it("o limite é sempre explícito — a tela não depende do padrão do backend", () => {
    expect(montarConsulta(estado())).toContain(`limit=${POR_PAGINA}`);
  });

  it("filtro vazio não vira parâmetro vazio", () => {
    const url = montarConsulta(estado({ busca: "", status: "", sku: "" }));
    expect(url).not.toContain("q=");
    expect(url).not.toContain("status=");
    expect(url).not.toContain("sku=");
  });
});

describe("consultaDePendentes", () => {
  it("pergunta só a contagem, e sempre por 'pendente'", () => {
    expect(consultaDePendentes()).toBe("/admin/avaliacoes?status=pendente&limit=1");
  });

  it("não carrega filtro nenhum da tela — o contador tem de sobreviver ao filtro", () => {
    expect(consultaDePendentes()).not.toContain("q=");
    expect(consultaDePendentes()).not.toContain("page=");
  });
});

/* ========================================================================== */

describe("urlDaTela", () => {
  it("estado vazio devolve a rota limpa", () => {
    expect(urlDaTela({})).toBe(ROTA_DE_AVALIACOES);
  });

  it("omite pagina=1 — duas URLs para a mesma tela são dois favoritos", () => {
    expect(urlDaTela({ pagina: 1 })).toBe(ROTA_DE_AVALIACOES);
    expect(urlDaTela({ pagina: 3 })).toBe(`${ROTA_DE_AVALIACOES}?pagina=3`);
  });

  it("preserva os filtros ao virar a página", () => {
    const url = urlDaTela({ busca: "ana", status: "pendente", pagina: 4 });
    expect(url).toContain("q=ana");
    expect(url).toContain("status=pendente");
    expect(url).toContain("pagina=4");
  });

  it("escapa o que o gestor digitou — 'café & cia' não vira dois parâmetros", () => {
    expect(urlDaTela({ busca: "café & cia" })).toBe(
      `${ROTA_DE_AVALIACOES}?q=caf%C3%A9+%26+cia`,
    );
  });
});

describe("urlDoStatus", () => {
  /**
   * O caso concreto do comentário: página 4 de "Pendentes", clique em
   * "Aprovadas" que cabem em duas páginas. Sem zerar, o gestor lê "nenhum
   * resultado" logo depois de trocar o filtro — e conclui que não há nenhuma.
   */
  it("trocar o filtro ZERA a página", () => {
    const url = urlDoStatus(estado({ status: "pendente", pagina: 4 }), "aprovada");
    expect(url).toBe(`${ROTA_DE_AVALIACOES}?status=aprovada`);
    expect(url).not.toContain("pagina");
  });

  it("status vazio é a aba 'Todas', e também zera a página", () => {
    expect(urlDoStatus(estado({ status: "oculta", pagina: 7 }), "")).toBe(
      ROTA_DE_AVALIACOES,
    );
  });

  it("preserva busca e sku — trocar de aba não é limpar o filtro", () => {
    const url = urlDoStatus(estado({ busca: "ana", sku: "X-1", pagina: 5 }), "oculta");
    expect(url).toContain("q=ana");
    expect(url).toContain("sku=X-1");
    expect(url).toContain("status=oculta");
    expect(url).not.toContain("pagina");
  });
});

describe("estadoCorrigido", () => {
  it("prende a página dentro do que existe", () => {
    expect(estadoCorrigido(estado({ pagina: 9 }), 25).pagina).toBe(2);
  });

  it("lista vazia é a página 1, e não a página 0", () => {
    expect(estadoCorrigido(estado({ pagina: 9 }), 0).pagina).toBe(1);
  });

  it("página válida passa intacta, com os filtros junto", () => {
    expect(estadoCorrigido(estado({ busca: "ana", pagina: 2 }), 100)).toEqual(
      estado({ busca: "ana", pagina: 2 }),
    );
  });
});

describe("chipsDasAvaliacoes", () => {
  it("sem filtro, nenhum chip", () => {
    expect(chipsDasAvaliacoes(estado())).toEqual([]);
  });

  it("um chip por filtro ativo", () => {
    const chips = chipsDasAvaliacoes(
      estado({ busca: "ana", status: "pendente", sku: "X-1" }),
    );
    expect(chips.map((c) => c.chave)).toEqual(["q", "status", "sku"]);
  });

  it("o chip de status mostra o RÓTULO, que é o que o gestor escolheu", () => {
    const [chip] = chipsDasAvaliacoes(estado({ status: "aprovada" }));
    expect(chip.valor).toBe("Aprovada");
    expect(chip.dimensao).toBe("Status");
  });

  it("status desconhecido aparece cru — é dele que a frase de erro fala", () => {
    const [chip] = chipsDasAvaliacoes(estado({ status: "recusada" }));
    expect(chip.valor).toBe("recusada");
  });

  it("o chip de busca mostra o que a PESSOA digitou", () => {
    const [chip] = chipsDasAvaliacoes(estado({ busca: "Café Amassado" }));
    expect(chip.valor).toBe("Café Amassado");
  });

  it("remover um filtro preserva os outros e ZERA a página", () => {
    const chips = chipsDasAvaliacoes(
      estado({ busca: "ana", status: "pendente", pagina: 4 }),
    );
    const daBusca = chips.find((c) => c.chave === "q")!;
    expect(daBusca.href).toContain("status=pendente");
    expect(daBusca.href).not.toContain("q=");
    expect(daBusca.href).not.toContain("pagina");
  });
});

describe("temFiltro", () => {
  it("é falso só quando os três estão vazios", () => {
    expect(temFiltro(estado())).toBe(false);
    expect(temFiltro(estado({ pagina: 5 }))).toBe(false);
  });

  it.each(["busca", "status", "sku"] as const)("é verdadeiro com %s", (campo) => {
    expect(temFiltro(estado({ [campo]: "x" }))).toBe(true);
  });
});

/* ========================================================================== */

describe("idsQueMudam", () => {
  const linhas = [
    linha({ id: "a", status: "pendente" }),
    linha({ id: "b", status: "aprovada" }),
    linha({ id: "c", status: "oculta" }),
  ];

  it("devolve só as marcadas que estão em outro estado", () => {
    expect(idsQueMudam(linhas, ["a", "b", "c"], "aprovada")).toEqual(["a", "c"]);
  });

  /**
   * O caso que a frase do checklist pede: marcar três já aprovadas e clicar em
   * "Aprovar" devolveria `{pedidas: 3, atualizadas: 3}` — o UPDATE casa as três
   * e reescreve o mesmo valor. Quem sabe que nada mudou de estado é a tela.
   */
  it("é vazio quando nenhuma das marcadas mudaria de status", () => {
    expect(idsQueMudam(linhas, ["b"], "aprovada")).toEqual([]);
  });

  it("ignora id marcado que não está na página", () => {
    expect(idsQueMudam(linhas, ["z"], "aprovada")).toEqual([]);
  });

  it("nenhuma marcada devolve vazio", () => {
    expect(idsQueMudam(linhas, [], "aprovada")).toEqual([]);
  });
});

describe("contarAvaliacoes", () => {
  it("concorda no singular e no plural, inclusive no zero", () => {
    expect(contarAvaliacoes(0)).toBe("0 avaliações");
    expect(contarAvaliacoes(1)).toBe("1 avaliação");
    expect(contarAvaliacoes(2)).toBe("2 avaliações");
  });
});

describe("resumoDaModeracao — a contagem REAL, nunca a pedida", () => {
  it("tudo atualizado é sucesso, com a contagem e o rótulo em português", () => {
    const r = resumoDaModeracao({ pedidas: 3, atualizadas: 3 }, "aprovada");
    expect(r.ok).toBe(true);
    expect(r.frase).toBe("3 avaliações marcadas como aprovada.");
  });

  it("uma só concorda no singular", () => {
    const r = resumoDaModeracao({ pedidas: 1, atualizadas: 1 }, "oculta");
    expect(r.frase).toBe("1 avaliação marcada como oculta.");
  });

  /**
   * O defeito que a rota nova torna impossível e a tela tem de mostrar: zero
   * atualizadas NÃO é sucesso. Na tela legada isto era a RLS recortando em
   * silêncio, com o toast anunciando o contrário.
   */
  it("zero atualizadas NÃO é sucesso, e a frase manda recarregar", () => {
    const r = resumoDaModeracao({ pedidas: 4, atualizadas: 0 }, "aprovada");
    expect(r.ok).toBe(false);
    expect(r.frase).toContain("Nenhuma das 4 avaliações foi alterada");
    expect(r.frase).toContain("Recarregue");
  });

  it("parcial diz quantas mudaram DE VERDADE e quantas ficaram de fora", () => {
    const r = resumoDaModeracao({ pedidas: 5, atualizadas: 3 }, "aprovada");
    expect(r.ok).toBe(false);
    expect(r.frase).toContain("3 avaliações de 5");
    expect(r.frase).toContain("2 avaliações não foi encontrada");
  });

  it("a frase NUNCA anuncia a contagem pedida como se fosse a efetivada", () => {
    const r = resumoDaModeracao({ pedidas: 20, atualizadas: 7 }, "aprovada");
    expect(r.frase).toContain("7 avaliações de 20");
    expect(r.frase.startsWith("20")).toBe(false);
  });

  it("status desconhecido aparece cru no lugar do rótulo", () => {
    const r = resumoDaModeracao({ pedidas: 1, atualizadas: 1 }, "recusada");
    expect(r.frase).toContain("recusada");
  });
});

describe("fraseDeNadaAMudar", () => {
  it("concorda no singular e no plural", () => {
    expect(fraseDeNadaAMudar(1, "aprovada")).toBe(
      "1 avaliação já está como aprovada — nada foi enviado.",
    );
    expect(fraseDeNadaAMudar(3, "oculta")).toBe(
      "3 avaliações já estão como oculta — nada foi enviado.",
    );
  });

  /**
   * A frase descreve o MOTIVO de não mandar, e não o efeito de um envio que não
   * houve: mandado, o lote reescreveria `moderado_em = now()` nas três, então
   * "nada aconteceu" seria falso do outro lado.
   */
  it("diz que nada foi ENVIADO, e não que nada aconteceria", () => {
    expect(fraseDeNadaAMudar(2, "aprovada")).toContain("nada foi enviado");
  });
});

describe("resumoDaSelecao — R25", () => {
  it("nada marcado diz o tamanho da página e o do filtro", () => {
    expect(resumoDaSelecao(0, 20, 134)).toBe(
      "Nenhuma marcada — 20 nesta página, 134 no filtro.",
    );
  });

  /**
   * A ressalva do R25: "senão o lojista acha que arquivou 1.284 quando arquivou
   * 50". O contrato do PATCH recebe uma lista de ids, e a tela só tem os da
   * página — então ela diz isso em vez de fingir que alcança o filtro inteiro.
   */
  it("com filtro maior que a página, avisa que a ação vale só para as marcadas", () => {
    expect(resumoDaSelecao(3, 20, 134)).toBe(
      "3 de 20 marcadas nesta página. O filtro tem 134: a ação vale só para as marcadas.",
    );
  });

  it("cabendo tudo numa página, NÃO avisa — aviso que não vale nada se aprende a ignorar", () => {
    expect(resumoDaSelecao(3, 12, 12)).toBe("3 de 12 marcadas nesta página.");
  });

  it("uma marcada concorda no singular", () => {
    expect(resumoDaSelecao(1, 12, 12)).toBe("1 de 12 marcada nesta página.");
  });
});

/* ========================================================================== */

describe("identificarAutor — R23", () => {
  it("usa o nome de exibição", () => {
    expect(identificarAutor(linha({ nome_exibicao: "Ana Souza" }))).toBe("Ana Souza");
  });

  it("nome vazio, em branco ou nulo vira ausência declarada, não célula vazia", () => {
    expect(identificarAutor(linha({ nome_exibicao: "" }))).toBe("Sem identificação");
    expect(identificarAutor(linha({ nome_exibicao: "   " }))).toBe("Sem identificação");
    expect(identificarAutor(linha({ nome_exibicao: null }))).toBe("Sem identificação");
  });

  it("nunca devolve o uuid — R23 proíbe identificador de máquina na coluna", () => {
    const l = linha({ nome_exibicao: null });
    expect(identificarAutor(l)).not.toContain(l.id);
  });
});

describe("notaEmTexto", () => {
  it("é 'n/5', sem estrelinha — §2.5 quer monoespaçada em todo número", () => {
    expect(notaEmTexto(5)).toBe("5/5");
    expect(notaEmTexto(1)).toBe("1/5");
  });

  it("ausente vira travessão, e não 'null/5'", () => {
    expect(notaEmTexto(null)).toBe("—");
    expect(notaEmTexto(undefined)).toBe("—");
    expect(notaEmTexto(Number.NaN)).toBe("—");
  });
});

describe("textoOuTraco", () => {
  it("devolve o texto quando há", () => {
    expect(textoOuTraco("CLA-250")).toBe("CLA-250");
  });
  it("vazio, branco e nulo viram travessão", () => {
    expect(textoOuTraco("")).toBe("—");
    expect(textoOuTraco("  ")).toBe("—");
    expect(textoOuTraco(null)).toBe("—");
  });
});

describe("corpoDaAvaliacao", () => {
  it("devolve o texto INTEIRO, sem cortar nem reticenciar", () => {
    const longo = "a".repeat(600);
    expect(corpoDaAvaliacao(linha({ texto: longo }))).toBe(longo);
    expect(corpoDaAvaliacao(linha({ texto: longo }))).not.toContain("…");
  });

  it("preserva as quebras de linha — a casca desenha com pre-wrap", () => {
    expect(corpoDaAvaliacao(linha({ texto: "linha 1\nlinha 2" }))).toBe(
      "linha 1\nlinha 2",
    );
  });

  it("avaliação só com nota tem frase própria, não célula em branco", () => {
    expect(corpoDaAvaliacao(linha({ texto: null }))).toBe(
      "Sem texto — o cliente deixou só a nota.",
    );
    expect(corpoDaAvaliacao(linha({ texto: "   " }))).toBe(
      "Sem texto — o cliente deixou só a nota.",
    );
  });
});

describe("LIMITE_DO_LOTE", () => {
  it("é o mesmo teto do backend — 200 por vez", () => {
    const fonte = readFileSync(
      join(
        __dirname,
        "..", "..", "..", "..",
        "backend", "src", "repositories", "avaliacoesRepository.js",
      ),
      "utf8",
    );
    expect(fonte).toContain("ids.length > 200");
    expect(LIMITE_DO_LOTE).toBe(200);
  });

  it("é folgado para a página, que tem 20 — a guarda é da superfície de rede", () => {
    expect(LIMITE_DO_LOTE).toBeGreaterThan(POR_PAGINA);
  });
});
