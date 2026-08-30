import { describe, it, expect } from "vitest";

import {
  ACOES_BLING,
  FILTROS_DA_FILA,
  chaveDaFilaValida,
  estadoDoBling,
  filtrarFila,
  filtroDaFila,
  fraseDeErro,
  mesclarPedido,
  pedidoPodeIrAoBling,
  type ChaveDaFila,
} from "./contrato";

/**
 * O painel do Bling é JSX e não tem teste de render (o painel legado inteiro
 * morre na F6). O que se testa aqui é o miolo que decide o que o gestor LÊ —
 * e cujas falhas são todas silenciosas na tela:
 *
 *   - estado errado ....... o painel diz "NF-e emitida" para uma nota que a
 *                           SEFAZ nunca autorizou, e ninguém vai atrás dela;
 *   - merge cego .......... a linha da lista perde o nome do cliente logo
 *                           depois de uma sincronização bem-sucedida;
 *   - frase trocada ....... o diagnóstico que o backend escreveu para o gestor
 *                           ("SKU x não está cadastrado no Bling") vira
 *                           "Erro ao sincronizar", e o problema que ele
 *                           resolveria sozinho vira chamado.
 *
 * Nenhuma das três aparece em `next build` nem em `tsc --noEmit`.
 */

describe("estadoDoBling", () => {
  it("é a chave de acesso, não o número, que carimba a nota como emitida", () => {
    // O critério é o mesmo do backend para responder "já emitida": a chave só
    // existe depois da autorização da SEFAZ.
    const emitida = estadoDoBling({
      bling_id: "42",
      nfe_numero: "1234/1",
      nfe_chave: "31260812345678000199550010000012341000012345",
    });
    expect(emitida.chave).toBe("com_nota");
    expect(emitida.rotulo).toContain("1234/1");
  });

  it("nota gerada SEM chave é o estado de alerta do §7 do runbook", () => {
    // Este é o caso que parece resolvido e não está: a nota existe no Bling,
    // pendente, e a retentativa retransmite a MESMA.
    const pendente = estadoDoBling({ bling_id: "42", nfe_numero: "1234/1" });
    expect(pendente.chave).toBe("nota_pendente");
    expect(pendente.rotulo).toContain("não transmitida");
  });

  it("'sincronizando' é o claim em voo, não uma situação do Bling", () => {
    expect(estadoDoBling({ bling_situacao: "sincronizando" }).chave).toBe(
      "sincronizando",
    );
  });

  it("com bling_id e sem nota, mostra o pedido de venda e a situação de lá", () => {
    const estado = estadoDoBling({ bling_id: "901", bling_situacao: "Em aberto" });
    expect(estado.chave).toBe("sincronizado");
    expect(estado.rotulo).toContain("901");
    expect(estado.detalhe).toContain("Em aberto");
  });

  it("pedido que nunca foi ao ERP (tudo NULL) não é confundido com sincronizado", () => {
    const zerado = {
      bling_id: null,
      bling_situacao: null,
      nfe_numero: null,
      nfe_chave: null,
    };
    expect(estadoDoBling(zerado).chave).toBe("nao_sincronizado");
    expect(estadoDoBling(undefined).chave).toBe("nao_sincronizado");
  });
});

describe("pedidoPodeIrAoBling", () => {
  it("só venda paga vai ao ERP — o resto o servidor recusaria com 409", () => {
    for (const status of ["aprovado", "enviado", "entregue"]) {
      expect(pedidoPodeIrAoBling({ status })).toBe(true);
    }
    for (const status of [
      "pendente",
      "em_processamento",
      "autorizado",
      "cancelado",
      "rejeitado",
      "reembolsado",
    ]) {
      expect(pedidoPodeIrAoBling({ status })).toBe(false);
    }
    expect(pedidoPodeIrAoBling(null)).toBe(false);
  });
});

describe("filtrarFila", () => {
  const pedidos = [
    { order_id: "a", status: "pendente" },
    { order_id: "b", status: "aprovado" },
    {
      order_id: "c",
      status: "enviado",
      bling_id: "1",
      nfe_chave: "x",
      tracking_code: "BR1",
    },
    { order_id: "d", status: "entregue", bling_id: "2" },
  ];

  it("descarta o que não é venda paga em qualquer filtro", () => {
    for (const chave of ["todos", "pendentes", "sem_nota", "sem_rastreio"]) {
      expect(filtrarFila(pedidos, chave).map((p) => p.order_id)).not.toContain(
        "a",
      );
    }
  });

  it("'pendentes' guarda só o que ainda dá trabalho", () => {
    // "c" está completo (no Bling, com nota autorizada e com rastreio).
    expect(filtrarFila(pedidos, "pendentes").map((p) => p.order_id)).toEqual([
      "b",
      "d",
    ]);
  });

  it("os filtros específicos respondem cada um à sua pergunta", () => {
    expect(filtrarFila(pedidos, "sem_pedido").map((p) => p.order_id)).toEqual([
      "b",
    ]);
    expect(filtrarFila(pedidos, "sem_nota").map((p) => p.order_id)).toEqual([
      "b",
      "d",
    ]);
    expect(filtrarFila(pedidos, "sem_rastreio").map((p) => p.order_id)).toEqual([
      "b",
      "d",
    ]);
    expect(filtrarFila(pedidos, "todos").map((p) => p.order_id)).toEqual([
      "b",
      "c",
      "d",
    ]);
  });

  it("filtro desconhecido cai no primeiro, e entrada não-lista não quebra", () => {
    expect(filtrarFila(pedidos, "inventado").length).toBe(2);
    expect(filtrarFila(null, "todos")).toEqual([]);
  });
});

/**
 * A CHAVE QUE VEM DA URL — a defesa contra o recorte que ninguém pediu.
 *
 * `filtrarFila` cai no PRIMEIRO filtro quando não reconhece a chave, o que é o
 * certo para uma chamada interna e péssimo para um parâmetro de URL:
 * `?fila=sem_notas` (com "s") mostraria "Pendentes no Bling" com o chip dizendo
 * outra coisa. Quem vem da barra de endereço passa por aqui primeiro.
 */
describe("chaveDaFilaValida", () => {
  it("aceita as cinco chaves e recusa o resto", () => {
    for (const filtro of FILTROS_DA_FILA) {
      expect(chaveDaFilaValida(filtro.chave)).toBe(filtro.chave);
    }
    expect(chaveDaFilaValida("sem_notas")).toBe("");
    expect(chaveDaFilaValida("")).toBe("");
    expect(chaveDaFilaValida(undefined)).toBe("");
    expect(chaveDaFilaValida(["sem_nota"])).toBe("");
  });

  /**
   * A união de tipo `ChaveDaFila` é escrita à mão (as entradas são
   * `Object.freeze` de literais, e o TypeScript alarga `chave` para `string`).
   * Este caso é o que impede as duas listas de divergirem: quem acrescentar um
   * sexto filtro e esquecer o tipo vê vermelho aqui, e não em produção, com o
   * filtro novo caindo silenciosamente no padrão.
   */
  it("a união de tipo cobre exatamente os filtros que existem", () => {
    const doTipo: ChaveDaFila[] = [
      "pendentes",
      "sem_pedido",
      "sem_nota",
      "sem_rastreio",
      "todos",
    ];
    expect(FILTROS_DA_FILA.map((f) => f.chave).sort()).toEqual([...doTipo].sort());
  });
});

describe("filtroDaFila", () => {
  it("devolve o filtro pela chave, e null para o que não existe", () => {
    expect(filtroDaFila("sem_rastreio")?.rotulo).toBe("Sem rastreio");
    expect(filtroDaFila("inventado")).toBeNull();
  });

  /** Cada filtro tem a SUA frase de vazio — "nenhum resultado para este filtro"
   *  não diz ao gestor que a fila está limpa, que é a informação que ele quer. */
  it("todo filtro tem rótulo e frase de vazio, e nenhuma se repete", () => {
    const vazios = FILTROS_DA_FILA.map((f) => f.vazio);
    for (const filtro of FILTROS_DA_FILA) {
      expect(filtro.rotulo.length).toBeGreaterThan(0);
      expect(filtro.vazio.length).toBeGreaterThan(0);
    }
    expect(new Set(vazios).size).toBe(vazios.length);
  });
});

describe("mesclarPedido", () => {
  const linhaDoAdmin = {
    order_id: "abc",
    user_name: "Ana",
    user_email: "ana@ex.com",
    user_cpf: "52998224725",
    address: { street: "Rua X" },
    status: "aprovado",
    total_amount: "41.20",
    bling_id: null,
    tracking_code: null,
  };

  it("traz o rastro do Bling da resposta para a linha da lista", () => {
    const mesclada = mesclarPedido(linhaDoAdmin, {
      order_id: "abc",
      bling_id: "901",
      bling_situacao: "Em aberto",
      nfe_numero: "1234/1",
      nfe_url: "https://bling/danfe.pdf",
    });
    expect(mesclada.bling_id).toBe("901");
    expect(mesclada.nfe_url).toBe("https://bling/danfe.pdf");
  });

  it("o rastreio também MUDA o status — e a linha tem de mostrar os dois", () => {
    // A busca de rastreio grava o código e avança o pedido para 'enviado'.
    // Sem estes dois campos no merge, a linha diria "Aprovado" depois de o
    // e-mail de envio já ter saído para o cliente.
    const mesclada = mesclarPedido(linhaDoAdmin, {
      status: "enviado",
      tracking_code: "AA123456789BR",
    });
    expect(mesclada.status).toBe("enviado");
    expect(mesclada.tracking_code).toBe("AA123456789BR");
  });

  it("NÃO apaga o que só a listagem do admin tem", () => {
    // A resposta de /bling projeta `address_json` e nenhum dado do cliente:
    // um spread cego deixaria a tabela sem nome, e-mail e endereço.
    const mesclada = mesclarPedido(linhaDoAdmin, {
      order_id: "abc",
      address_json: { street: "Rua Y" },
      bling_id: "901",
    });
    expect(mesclada.user_name).toBe("Ana");
    expect(mesclada.user_email).toBe("ana@ex.com");
    expect(mesclada.user_cpf).toBe("52998224725");
    expect(mesclada.address).toEqual({ street: "Rua X" });
  });

  it("resposta sem pedido devolve a linha intacta", () => {
    expect(mesclarPedido(linhaDoAdmin, null)).toBe(linhaDoAdmin);
    expect(mesclarPedido(linhaDoAdmin, undefined)).toBe(linhaDoAdmin);
  });
});

describe("fraseDeErro", () => {
  it("a mensagem do servidor chega inteira — ela foi escrita para o gestor", () => {
    const doBling =
      'O SKU "classico-graos-250" não está cadastrado no Bling.';
    expect(fraseDeErro(400, { error: "BLING_FALHOU", message: doBling })).toBe(
      doBling,
    );
  });

  it("503 traz a frase que nomeia a variável a ligar", () => {
    const frase =
      "A integração com o Bling está desligada (BLING_ATIVO). Configure as " +
      "credenciais e ligue a variável — passo a passo em docs/bling.md.";
    expect(fraseDeErro(503, { error: "BLING_DESLIGADO", message: frase })).toBe(
      frase,
    );
  });

  it("aceita { error: 'frase' }, o formato do resto do painel", () => {
    // `/admin/orders/:id/status` e os middlewares respondem assim.
    expect(fraseDeErro(400, { error: "Status inválido. Use um de: ..." })).toBe(
      "Status inválido. Use um de: ...",
    );
  });

  it("código cru não é frase: cai no fallback, que explica mais", () => {
    expect(fraseDeErro(503, { error: "BLING_DESLIGADO" })).toContain(
      "BLING_ATIVO",
    );
    expect(fraseDeErro(504, { error: "BLING_FALHOU" })).toContain(
      "não respondeu a tempo",
    );
  });

  it("corpo ilegível (proxy, HTML de erro) ainda diz algo útil", () => {
    expect(fraseDeErro(401, null)).toContain("sessão");
    expect(fraseDeErro(403, null)).toContain("administrador");
    expect(fraseDeErro(404, null)).toContain("docs/bling.md");
    expect(fraseDeErro(500, null)).toContain("500");
  });
});

describe("ACOES_BLING", () => {
  it("são as três rotas de bling.routes.js, na ordem do fluxo real", () => {
    expect(ACOES_BLING.map((a) => a.chave)).toEqual([
      "sincronizar",
      "nfe",
      "rastreio",
    ]);
    expect(ACOES_BLING.map((a) => a.caminho("abc"))).toEqual([
      "/bling/pedidos/abc/sincronizar",
      "/bling/pedidos/abc/nfe",
      "/bling/pedidos/abc/rastreio",
    ]);
  });

  it("só o rastreio exige pedido de venda: a NF-e sincroniza antes se preciso", () => {
    const porChave = Object.fromEntries(
      ACOES_BLING.map((a) => [a.chave, a.precisaDeSincronia]),
    );
    expect(porChave.sincronizar).toBe(false);
    expect(porChave.nfe).toBe(false);
    expect(porChave.rastreio).toBe(true);
  });
});
