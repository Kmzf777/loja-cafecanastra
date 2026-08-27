import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";

import {
  ABAS_SALVAS,
  POR_PAGINA,
  RESSALVA_DA_EXPORTACAO,
  ROTA_DE_PEDIDOS,
  STATUS_EM_LOTE,
  abaAtiva,
  aplicarFiltroDePagina,
  avisoDaExportacao,
  avisoDoLote,
  chipsDosPedidos,
  consultaDaContagem,
  consultaDaExportacao,
  enderecoDoPedido,
  estadoCorrigido,
  exportacaoExigeConfirmacao,
  filtrarNfePendente,
  identificarPedido,
  lerEstado,
  lerItens,
  montarConsulta,
  nomeDoArquivoCsv,
  normalizarBusca,
  numeroDoPedido,
  precisaDeRastreio,
  resumoDaPaginaFiltrada,
  resumoDaSelecao,
  resumoDoLote,
  rotuloCurtoDoBling,
  temFiltro,
  textoDoPeriodo,
  tomDoBling,
  totalDeUnidades,
  urlDaAba,
  urlDaTela,
  urlDoPedido,
  type EstadoDosPedidos,
  type PedidoDoPainel,
} from "./pedidos.logica";
import { STATUS_DE_PEDIDO } from "../status";

const VAZIO: EstadoDosPedidos = {
  busca: "",
  status: [],
  de: "",
  ate: "",
  nfe: "",
  pagina: 1,
};

function pedido(sobrepor: Partial<PedidoDoPainel> = {}): PedidoDoPainel {
  return {
    order_id: "3f9a2c11-1111-2222-3333-444455556666",
    total_amount: "128.50",
    status: "aprovado",
    created_at: "2026-08-21T01:00:00.000Z",
    payment_method: "pix",
    items: [],
    address: {},
    shipping_cost: "18.90",
    shipping_method: "PAC",
    tracking_code: null,
    coupon_code: null,
    discount: "0.00",
    bling_id: null,
    bling_situacao: null,
    bling_sincronizado_em: null,
    nfe_numero: null,
    nfe_chave: null,
    nfe_url: null,
    user_name: "Maria Souza",
    user_email: "maria@exemplo.com",
    user_cpf: "52998224725",
    ...sobrepor,
  };
}

describe("numeroDoPedido", () => {
  /**
   * O TESTE QUE LIGA A TELA AO E-MAIL DO CLIENTE. O painel legado mostrava os
   * seis ÚLTIMOS dígitos e o e-mail carimba os OITO PRIMEIROS: o gestor lia um
   * número e o cliente lia outro.
   */
  it("são os oito primeiros dígitos, como no assunto do e-mail do cliente", () => {
    const fonte = readFileSync(
      join(__dirname, "..", "..", "..", "..", "backend", "src", "utils", "emailSender.js"),
      "utf8",
    );
    expect(fonte).toContain("order.order_id.slice(0, 8)");
    expect(numeroDoPedido("3f9a2c11-1111-2222-3333-444455556666")).toBe("3F9A2C11");
  });

  it("caixa alta, para a monoespaçada alinhar hexadecimal em coluna", () => {
    expect(numeroDoPedido("abcdef01-0000-0000-0000-000000000000")).toBe("ABCDEF01");
  });

  it("id ausente vira travessão, não string vazia", () => {
    expect(numeroDoPedido(null)).toBe("—");
    expect(numeroDoPedido("")).toBe("—");
  });
});

describe("identificarPedido", () => {
  it("é o nome do cliente — R23, nunca UUID", () => {
    expect(identificarPedido(pedido())).toBe("Maria Souza");
  });

  it("cliente sem nome não vira célula vazia", () => {
    expect(identificarPedido(pedido({ user_name: "   " }))).toBe("Sem identificação");
    expect(identificarPedido(pedido({ user_name: null }))).toBe("Sem identificação");
  });
});

describe("normalizarBusca", () => {
  /**
   * A tela imprime `#3F9A2C11`; o backend compara `pedido_id::text ILIKE`. Com
   * o "#" a busca não acha NADA e a tela diz "nenhum resultado", que é uma
   * frase em que se acredita.
   */
  it("tira o # que a própria tela imprime", () => {
    expect(normalizarBusca("#3F9A2C11")).toBe("3F9A2C11");
    expect(normalizarBusca("  ##3f9a  ")).toBe("3f9a");
  });

  it("não mexe em nome, e-mail nem CPF", () => {
    expect(normalizarBusca(" Maria Souza ")).toBe("Maria Souza");
    expect(normalizarBusca("maria@exemplo.com")).toBe("maria@exemplo.com");
    expect(normalizarBusca("529.982.247-25")).toBe("529.982.247-25");
  });
});

describe("lerEstado", () => {
  it("lê os cinco filtros e a página da URL — R2", () => {
    expect(
      lerEstado({
        q: "maria",
        status: "aprovado,enviado",
        de: "2026-08-01",
        ate: "2026-08-31",
        nfe: "pendente",
        pagina: "3",
      }),
    ).toEqual({
      busca: "maria",
      status: ["aprovado", "enviado"],
      de: "2026-08-01",
      ate: "2026-08-31",
      nfe: "pendente",
      pagina: 3,
    });
  });

  it("sem nada na URL, nenhum filtro está ligado", () => {
    expect(lerEstado({})).toEqual(VAZIO);
  });

  /**
   * Status desconhecido PASSA ADIANTE de propósito: o backend recusa com
   * "Status inválido: 'delivered'. Use um de: …", que diz o que fazer. Filtrar
   * aqui em silêncio mostraria a lista inteira com o chip prometendo um filtro.
   */
  it("status desconhecido não é engolido — a frase do servidor é o diagnóstico", () => {
    expect(lerEstado({ status: "delivered" }).status).toEqual(["delivered"]);
  });

  it("vírgulas soltas não viram status vazio", () => {
    expect(lerEstado({ status: ",aprovado, ,enviado," }).status).toEqual([
      "aprovado",
      "enviado",
    ]);
  });

  it("nfe só aceita 'pendente' — qualquer outra coisa é o filtro desligado", () => {
    expect(lerEstado({ nfe: "sim" }).nfe).toBe("");
    expect(lerEstado({ nfe: "pendente" }).nfe).toBe("pendente");
  });

  it("parâmetro repetido cai no padrão em vez de escolher um dos dois", () => {
    expect(lerEstado({ q: ["a", "b"] }).busca).toBe("");
    expect(lerEstado({ pagina: ["2", "9"] }).pagina).toBe(1);
  });

  it("página lixo vira 1, e nunca zero nem negativa", () => {
    expect(lerEstado({ pagina: "0" }).pagina).toBe(1);
    expect(lerEstado({ pagina: "-4" }).pagina).toBe(1);
    expect(lerEstado({ pagina: "abc" }).pagina).toBe(1);
  });
});

describe("montarConsulta", () => {
  it("pede a página com o limite explícito — o padrão do backend é 10", () => {
    expect(montarConsulta(VAZIO)).toBe(`/admin/orders?page=1&limit=${POR_PAGINA}`);
  });

  it("manda os status separados por vírgula, como o backend os lê", () => {
    const url = montarConsulta({ ...VAZIO, status: ["pendente", "autorizado"] });
    expect(url).toContain("status=pendente%2Cautorizado");
  });

  it("manda a busca sem o #", () => {
    expect(montarConsulta({ ...VAZIO, busca: "#3F9A" })).toContain("q=3F9A");
  });

  /** Não existe `?nfe=` em `/admin/orders`: mandar produziria um parâmetro
   *  ignorado, e a tela acreditaria num filtro que não aconteceu. */
  it("NÃO manda o recorte de NF-e — o servidor não o conhece", () => {
    expect(montarConsulta({ ...VAZIO, nfe: "pendente" })).not.toContain("nfe");
  });

  it("período vazio não vira parâmetro vazio", () => {
    expect(montarConsulta({ ...VAZIO, de: "", ate: "" })).not.toContain("de=");
  });
});

describe("urlDaTela", () => {
  it("página 1 é omitida — duas URLs para a mesma tela são dois favoritos", () => {
    expect(urlDaTela({ pagina: 1 })).toBe(ROTA_DE_PEDIDOS);
    expect(urlDaTela({ pagina: 2 })).toBe(`${ROTA_DE_PEDIDOS}?pagina=2`);
  });

  it("carrega todo o resto do estado junto, para o filtro não sumir ao virar página", () => {
    const url = urlDaTela({ busca: "maria", status: ["aprovado"], nfe: "pendente", pagina: 4 });
    expect(url).toContain("q=maria");
    expect(url).toContain("status=aprovado");
    expect(url).toContain("nfe=pendente");
    expect(url).toContain("pagina=4");
  });

  /** A ressalva explícita do R2: URL vaza para histórico, Referer, log de proxy
   *  e captura de tela. Nada de pessoal entra nela. */
  it("nenhum dado pessoal entra na query string — R2", () => {
    const url = urlDaTela({ busca: "maria", status: ["aprovado"], de: "2026-08-01" });
    for (const proibido of ["cpf", "email", "e-mail", "endereco", "telefone", "cliente"]) {
      expect(url.toLowerCase()).not.toContain(proibido);
    }
  });
});

describe("urlDoPedido", () => {
  it("o deep-link leva o UUID opaco e mais nada", () => {
    expect(urlDoPedido("3f9a2c11-1111")).toBe("/dashboard/pedidos/3f9a2c11-1111");
  });
});

describe("estadoCorrigido", () => {
  it("prende a página dentro do que existe — o caso do favorito velho", () => {
    expect(estadoCorrigido({ ...VAZIO, pagina: 999 }, 45).pagina).toBe(3);
  });

  it("lista vazia continua sendo a página 1", () => {
    expect(estadoCorrigido({ ...VAZIO, pagina: 7 }, 0).pagina).toBe(1);
  });
});

describe("chipsDosPedidos — R3", () => {
  it("sem filtro, sem chip", () => {
    expect(chipsDosPedidos(VAZIO)).toEqual([]);
  });

  it("um chip por dimensão ligada", () => {
    const chips = chipsDosPedidos({
      ...VAZIO,
      busca: "maria",
      status: ["aprovado"],
      de: "2026-08-01",
      nfe: "pendente",
    });
    expect(chips.map((c) => c.chave)).toEqual(["q", "status", "periodo", "nfe"]);
  });

  it("o chip de status mostra RÓTULO, não o vocabulário do banco", () => {
    const [chip] = chipsDosPedidos({ ...VAZIO, status: ["em_processamento"] });
    expect(chip.valor).toBe("Em processamento");
    expect(chip.valor).not.toContain("_");
  });

  it("status desconhecido aparece cru em vez de sumir do chip", () => {
    const [chip] = chipsDosPedidos({ ...VAZIO, status: ["delivered"] });
    expect(chip.valor).toBe("delivered");
  });

  it("a busca aparece como a pessoa digitou, com o # e tudo", () => {
    const [chip] = chipsDosPedidos({ ...VAZIO, busca: "#3F9A" });
    expect(chip.valor).toBe("#3F9A");
  });

  /** Tirar um filtro estando na página 4 e continuar na 4 é o jeito mais
   *  rápido de uma lista sem filtro parecer vazia. */
  it("todo href de remoção zera a página e preserva os outros filtros", () => {
    const chips = chipsDosPedidos({
      ...VAZIO,
      busca: "maria",
      status: ["aprovado"],
      pagina: 4,
    });
    const doStatus = chips.find((c) => c.chave === "status")!;
    expect(doStatus.href).not.toContain("pagina=");
    expect(doStatus.href).not.toContain("status=");
    expect(doStatus.href).toContain("q=maria");
  });
});

describe("textoDoPeriodo", () => {
  /**
   * R31 sem passar por `Date`: "2026-08-01" construído como Date é meia-noite
   * UTC, que em São Paulo ainda é 31/07 — e a tela mostraria o dia anterior ao
   * que o backend recortou.
   */
  it("é dd/mm/aaaa e não desloca um dia", () => {
    expect(textoDoPeriodo("2026-08-01", "2026-08-31")).toBe("01/08/2026 a 31/08/2026");
  });

  it("aceita só uma ponta", () => {
    expect(textoDoPeriodo("2026-08-01", "")).toBe("de 01/08/2026");
    expect(textoDoPeriodo("", "2026-08-31")).toBe("até 31/08/2026");
  });

  it("data fora do formato aparece como veio, em vez de virar 'Invalid Date'", () => {
    expect(textoDoPeriodo("ontem", "")).toBe("de ontem");
  });
});

describe("temFiltro", () => {
  it("qualquer uma das cinco dimensões liga o filtro", () => {
    expect(temFiltro(VAZIO)).toBe(false);
    expect(temFiltro({ ...VAZIO, busca: "a" })).toBe(true);
    expect(temFiltro({ ...VAZIO, status: ["aprovado"] })).toBe(true);
    expect(temFiltro({ ...VAZIO, de: "2026-01-01" })).toBe(true);
    expect(temFiltro({ ...VAZIO, ate: "2026-01-01" })).toBe(true);
    expect(temFiltro({ ...VAZIO, nfe: "pendente" })).toBe(true);
  });
});

describe("as abas salvas — R4", () => {
  it("são URLs de verdade, favoritáveis", () => {
    const nfe = ABAS_SALVAS.find((a) => a.chave === "nfe")!;
    expect(urlDaAba(nfe)).toContain("status=aprovado%2Cenviado%2Centregue");
    expect(urlDaAba(nfe)).toContain("nfe=pendente");
  });

  it("a aba 'Todos' é a lista sem filtro nenhum", () => {
    const todos = ABAS_SALVAS.find((a) => a.chave === "todos")!;
    expect(urlDaAba(todos)).toBe(ROTA_DE_PEDIDOS);
  });

  /** Toda aba tem de falar o vocabulário que o backend aceita: um valor
   *  inventado aqui faria a aba responder 400 em vez de filtrar. */
  it("todo status das abas existe no vocabulário do backend", () => {
    const validos = STATUS_DE_PEDIDO.map((s) => s.valor) as readonly string[];
    for (const aba of ABAS_SALVAS) {
      for (const status of aba.filtro.status) {
        expect(validos).toContain(status);
      }
    }
  });

  it("a aba de NF-e só pergunta por pedidos PAGOS — venda não confirmada não tem nota", () => {
    const nfe = ABAS_SALVAS.find((a) => a.chave === "nfe")!;
    expect(nfe.filtro.status).toEqual(["aprovado", "enviado", "entregue"]);
  });

  it("a aba de NF-e confessa que o recorte olha só a página", () => {
    const nfe = ABAS_SALVAS.find((a) => a.chave === "nfe")!;
    expect(nfe.ajuda).toContain("página carregada");
  });

  it("cada aba tem uma frase que explica o recorte", () => {
    for (const aba of ABAS_SALVAS) expect(aba.ajuda.length).toBeGreaterThan(20);
  });
});

describe("abaAtiva", () => {
  it("acha a aba pelo conjunto de status, em qualquer ordem", () => {
    expect(abaAtiva({ ...VAZIO, status: ["autorizado", "pendente", "em_processamento"] })).toBe(
      "pagamento",
    );
  });

  it("sem filtro nenhum, a aba acesa é 'Todos'", () => {
    expect(abaAtiva(VAZIO)).toBe("todos");
  });

  /** Buscar dentro de uma aba continua sendo aquela aba: apagá-la nesse
   *  momento faria a tela dizer que o gestor saiu de onde não saiu. */
  it("busca e período não apagam a aba", () => {
    expect(abaAtiva({ ...VAZIO, status: ["aprovado"], busca: "maria", pagina: 3 })).toBe(
      "despachar",
    );
  });

  it("um recorte que não é de aba nenhuma não acende nada", () => {
    expect(abaAtiva({ ...VAZIO, status: ["cancelado"] })).toBeNull();
  });

  it("mesmos status com o recorte de NF-e ligado é outra aba", () => {
    const semNfe = { ...VAZIO, status: ["aprovado", "enviado", "entregue"] };
    expect(abaAtiva(semNfe)).toBeNull();
    expect(abaAtiva({ ...semNfe, nfe: "pendente" as const })).toBe("nfe");
  });
});

describe("enderecoDoPedido", () => {
  it("monta rua, número, bairro, cidade, UF e CEP", () => {
    expect(
      enderecoDoPedido({
        street: "Rua das Flores",
        number: "12",
        neighborhood: "Centro",
        city: "Piumhi",
        state: "MG",
        zip_code: "37925000",
      }),
    ).toBe("Rua das Flores, 12 - Centro, Piumhi - MG (CEP: 37925000)");
  });

  it("campo faltando tem fallback, e o resto do endereço continua legível", () => {
    expect(enderecoDoPedido({ city: "Piumhi", state: "MG" })).toBe(
      "Rua não inf., S/N - , Piumhi - MG (CEP: )",
    );
  });

  /** `endereco_json` de pedido antigo não é objeto. Um `addr.street` ali
   *  lançaria e derrubaria a tela inteira do detalhe. */
  it("pedido antigo cujo endereço não é objeto não derruba a tela", () => {
    expect(enderecoDoPedido("Rua tal, 12")).toContain("pedido antigo");
    expect(enderecoDoPedido(null)).toContain("pedido antigo");
    expect(enderecoDoPedido(undefined)).toContain("pedido antigo");
    expect(enderecoDoPedido(["a"])).toContain("pedido antigo");
  });
});

describe("lerItens", () => {
  it("aceita array", () => {
    expect(lerItens([{ name: "Clássico" }])).toEqual([{ name: "Clássico" }]);
  });

  it("aceita string JSON, que é como pedidos antigos gravaram", () => {
    expect(lerItens('[{"name":"Clássico"}]')).toEqual([{ name: "Clássico" }]);
  });

  it("JSON quebrado devolve lista vazia em vez de derrubar a tela", () => {
    expect(lerItens("{isso não é json")).toEqual([]);
  });

  /** O legado devolvia o resultado do parse fosse ele o que fosse, e um
   *  `"{}"` gravado por engano virava objeto onde a tela esperava lista. */
  it("JSON válido que não é lista também devolve lista vazia", () => {
    expect(lerItens('{"name":"Clássico"}')).toEqual([]);
  });

  it("nulo e número devolvem lista vazia", () => {
    expect(lerItens(null)).toEqual([]);
    expect(lerItens(7)).toEqual([]);
  });
});

describe("totalDeUnidades", () => {
  it("soma as quantidades", () => {
    expect(totalDeUnidades([{ quantity: 2 }, { quantity: 3 }])).toBe(5);
  });

  it("item sem quantidade conta como um, que é o que o carrinho antigo gravava", () => {
    expect(totalDeUnidades([{ name: "Clássico" }, { quantity: 2 }])).toBe(3);
  });

  it("lista ilegível soma zero", () => {
    expect(totalDeUnidades("lixo")).toBe(0);
  });
});

describe("o estado do Bling na tela", () => {
  /**
   * A ORDEM DE `estadoDoBling` É A DA VIDA DO DOCUMENTO FISCAL e está travada
   * em `contrato.test.ts`. Aqui se testa a TRADUÇÃO das cores hexadecimais do
   * contrato para os tokens da casa — e a decisão de quem grita.
   */
  it("nota não transmitida é o único alerta — parece resolvida e não está", () => {
    expect(tomDoBling("nota_pendente")).toBe("alerta");
    expect(rotuloCurtoDoBling("nota_pendente")).toBe("Não transmitida");
  });

  it("nota autorizada é sucesso", () => {
    expect(tomDoBling("com_nota")).toBe("sucesso");
  });

  /**
   * Em produção `BLING_ATIVO` está desligado, então TODO pedido está neste
   * estado. Um alerta em toda linha ensina, numa manhã, que a coluna se ignora
   * — e o alerta de verdade some junto.
   */
  it("nunca sincronizado é NEUTRO, não alerta", () => {
    expect(tomDoBling("nao_sincronizado")).toBe("neutro");
    expect(tomDoBling("sincronizado")).toBe("neutro");
    expect(tomDoBling("sincronizando")).toBe("neutro");
  });

  it("chave desconhecida não quebra a coluna", () => {
    expect(tomDoBling("inventada")).toBe("neutro");
    expect(rotuloCurtoDoBling("inventada")).toBe("—");
  });

  it("nenhum tom é o de erro — vermelho é de erro e destruição, não de ERP", () => {
    for (const chave of [
      "com_nota",
      "nota_pendente",
      "sincronizando",
      "sincronizado",
      "nao_sincronizado",
    ]) {
      expect(tomDoBling(chave)).not.toBe("erro");
    }
  });
});

describe("filtrarNfePendente", () => {
  const comNota = pedido({ order_id: "aaaaaaaa-1", nfe_chave: "3526...", nfe_numero: "12" });
  const notaPendente = pedido({ order_id: "bbbbbbbb-2", nfe_numero: "13" });
  const semNada = pedido({ order_id: "cccccccc-3" });
  const naoPago = pedido({ order_id: "dddddddd-4", status: "pendente" });

  it("tira quem já tem nota AUTORIZADA (chave), não quem tem só número", () => {
    const fila = filtrarNfePendente([comNota, notaPendente, semNada]);
    expect(fila.map((p) => p.order_id)).toEqual(["bbbbbbbb-2", "cccccccc-3"]);
  });

  /** Venda não confirmada não vira pedido de venda nem nota — a mesma regra
   *  que `filtrarFila` do contrato aplica primeiro. */
  it("pedido não pago não entra na fila de NF-e", () => {
    expect(filtrarNfePendente([naoPago])).toEqual([]);
  });

  it("preserva a ordem que veio do servidor", () => {
    const fila = filtrarNfePendente([semNada, notaPendente]);
    expect(fila.map((p) => p.order_id)).toEqual(["cccccccc-3", "bbbbbbbb-2"]);
  });
});

describe("aplicarFiltroDePagina", () => {
  it("com o recorte desligado, a lista do servidor passa intacta", () => {
    const linhas = [pedido({ status: "pendente" }), pedido()];
    expect(aplicarFiltroDePagina(linhas, VAZIO)).toBe(linhas);
  });

  it("com o recorte ligado, filtra em memória", () => {
    const linhas = [pedido({ nfe_chave: "35" }), pedido()];
    expect(aplicarFiltroDePagina(linhas, { ...VAZIO, nfe: "pendente" })).toHaveLength(1);
  });
});

describe("resumoDaPaginaFiltrada", () => {
  /** A paginação do rodapé continua correta para o SERVIDOR e falsa para o que
   *  está na tela. Duas contagens que discordam sem explicação fazem
   *  desconfiar das duas. */
  it("confessa o recorte com número, como a fila do Bling legada", () => {
    expect(resumoDaPaginaFiltrada(3, 20, 1, 7, 134)).toBe(
      "3 de 20 pedidos desta página · página 1 de 7 (134 no total)",
    );
  });
});

describe("precisaDeRastreio", () => {
  it("só 'enviado' abre o pedido de código", () => {
    expect(precisaDeRastreio("enviado")).toBe(true);
    expect(precisaDeRastreio("entregue")).toBe(false);
    expect(precisaDeRastreio("aprovado")).toBe(false);
  });
});

describe("STATUS_EM_LOTE", () => {
  /**
   * Um lote gravaria o MESMO código de rastreio em vinte encomendas
   * diferentes, e cada cliente receberia por e-mail o rastreio de outra pessoa.
   */
  it("tem os oito status menos 'enviado', que precisa de código por pedido", () => {
    expect(STATUS_EM_LOTE.map((s) => s.valor)).not.toContain("enviado");
    expect(STATUS_EM_LOTE).toHaveLength(STATUS_DE_PEDIDO.length - 1);
  });
});

describe("resumoDaSelecao — R25", () => {
  it("nada marcado, nada a dizer", () => {
    expect(resumoDaSelecao(0, 20, 134)).toBe("");
  });

  it("seleção parcial diz quantos de quantos DA PÁGINA", () => {
    expect(resumoDaSelecao(3, 20, 134)).toBe("3 de 20 pedidos desta página marcados.");
  });

  /**
   * O item do R25, literal: "senão o lojista acha que arquivou 1.284 quando
   * arquivou 50". A frase nomeia os dois números e diz qual deles a ação
   * alcança.
   */
  it("página inteira marcada com filtro maior nomeia a diferença", () => {
    const frase = resumoDaSelecao(20, 20, 134);
    expect(frase).toContain("20");
    expect(frase).toContain("134");
    expect(frase).toContain("alcança só os 20");
  });

  it("quando o filtro cabe na página, não há diferença a explicar", () => {
    expect(resumoDaSelecao(7, 7, 7)).toBe("Os 7 pedidos do filtro estão marcados.");
  });
});

describe("avisoDoLote — R11/R12", () => {
  it("nomeia o objeto, o destino e as três consequências", () => {
    const aviso = avisoDoLote(23, "cancelado");
    expect(aviso).toContain("23 pedidos");
    expect(aviso).toContain("Cancelado");
    expect(aviso).toContain("estoque");
    expect(aviso).toContain("e-mail");
    expect(aviso).toContain("desfazer");
  });

  it("concorda no singular", () => {
    expect(avisoDoLote(1, "entregue")).toContain("1 pedido para");
  });

  it("usa o RÓTULO do status, não o valor do banco", () => {
    expect(avisoDoLote(2, "em_processamento")).toContain("Em processamento");
  });
});

describe("resumoDoLote", () => {
  it("tudo certo, o placar é o total", () => {
    expect(resumoDoLote(4, [])).toBe("4 de 4 pedidos atualizados.");
  });

  /** A contagem é a REAL, nunca a pedida: dizer "20 atualizados" depois de 3
   *  falharem é mentir sobre a única coisa que a tela existe para informar. */
  it("com falhas, o placar é o real e as frases do servidor vêm junto", () => {
    const frase = resumoDoLote(2, [{ numero: "3F9A2C11", frase: "Pedido não encontrado" }]);
    expect(frase).toContain("2 de 3");
    expect(frase).toContain("#3F9A2C11: Pedido não encontrado");
  });
});

describe("a exportação", () => {
  it("sem período, exige confirmação — é a cerca que o backend também aplica", () => {
    expect(exportacaoExigeConfirmacao("", "")).toBe(true);
    expect(exportacaoExigeConfirmacao("2026-08-01", "")).toBe(false);
    expect(exportacaoExigeConfirmacao("", "2026-08-31")).toBe(false);
    expect(exportacaoExigeConfirmacao("  ", "  ")).toBe(true);
  });

  it("o aviso diz quantas linhas e o que vai dentro do arquivo", () => {
    const aviso = avisoDaExportacao(1284);
    expect(aviso).toContain("1284");
    expect(aviso).toContain("CPF");
    expect(aviso).toContain("e-mail");
  });

  /** Um "0 pedidos" por falha de rede convenceria o gestor de que o arquivo é
   *  inofensivo. */
  it("sem contagem, o aviso diz que não contou em vez de inventar zero", () => {
    const aviso = avisoDaExportacao(null);
    expect(aviso).toContain("Não foi possível contar");
    expect(aviso).not.toContain("0 pedidos");
  });

  it("a consulta só manda confirmar quando é verdade", () => {
    expect(consultaDaExportacao({ de: "", ate: "", confirmar: true })).toBe(
      "/admin/orders/export?confirmar=true",
    );
    expect(consultaDaExportacao({ de: "2026-08-01", ate: "2026-08-31", confirmar: false })).toBe(
      "/admin/orders/export?de=2026-08-01&ate=2026-08-31",
    );
  });

  it("a contagem pergunta uma linha só — o que interessa é o total", () => {
    expect(consultaDaContagem({ de: "2026-08-01", ate: "" })).toBe(
      "/admin/orders?de=2026-08-01&page=1&limit=1",
    );
  });

  /**
   * O NOME DO ARQUIVO É O MESMO DO BACKEND. O `Content-Disposition` não
   * atravessa o CORS (não está em `exposedHeaders`), então quem nomeia o
   * download por blob é a tela — e os dois arquivos, o da tela e o do `curl`,
   * têm de se chamar igual.
   */
  it("repete a fórmula do controller, lida do disco", () => {
    const fonte = readFileSync(
      join(__dirname, "..", "..", "..", "..", "backend", "src", "controllers", "OrderController.js"),
      "utf8",
    );
    expect(fonte).toContain("`pedidos-${sufixo}.csv`");
    expect(fonte).toContain('"pedidos.csv"');

    expect(nomeDoArquivoCsv("2026-08-01", "2026-08-31")).toBe(
      "pedidos-de-2026-08-01-ate-2026-08-31.csv",
    );
    expect(nomeDoArquivoCsv("2026-08-01", "")).toBe("pedidos-de-2026-08-01.csv");
    expect(nomeDoArquivoCsv("", "2026-08-31")).toBe("pedidos-ate-2026-08-31.csv");
    expect(nomeDoArquivoCsv("", "")).toBe("pedidos.csv");
  });

  /**
   * O CSV É DO BACKEND E CHEGA PRONTO — a tela baixa o BLOB sem tocar nos
   * bytes. Este teste guarda a promessa que a tela faz ao gestor: que o arquivo
   * abre no Excel brasileiro em colunas. Sem BOM o Excel lê UTF-8 como latin-1
   * e "Piumhi" vira "PiumhÃ­"; sem o `;` ele joga a linha inteira numa coluna
   * só, porque a vírgula é o separador DECIMAL no pt-BR.
   */
  it("o CSV do servidor mantém BOM e separador ';' — senão o Excel BR quebra", () => {
    /*
      O módulo é CARREGADO, e não lido como texto: uma regex sobre a fonte
      casaria com a constante e não com o arquivo que sai — e foi assim que a
      primeira versão deste teste ficou vermelha por escrever `"﻿"` quando
      o backend usa `String.fromCharCode(0xfeff)`. As duas produzem o MESMO
      byte, que é o que importa; a fonte era o detalhe errado para olhar.
    */
    const exigir = createRequire(import.meta.url);
    const csv = exigir(
      join(__dirname, "..", "..", "..", "..", "backend", "src", "utils", "csvDePedidos.js"),
    ) as { BOM: string; SEPARADOR: string; gerarCsvDePedidos: (p: unknown[]) => string };

    expect(csv.BOM).toBe("﻿");
    expect(csv.SEPARADOR).toBe(";");
    // E o arquivo de verdade começa pelo BOM e separa por ponto e vírgula.
    const saida = csv.gerarCsvDePedidos([]);
    expect(saida.charCodeAt(0)).toBe(0xfeff);
    expect(saida.split("\r\n")[0]).toContain(";");
  });

  it("a ressalva do R27 diz o que a exportação NÃO leva", () => {
    expect(RESSALVA_DA_EXPORTACAO).toContain("período");
    expect(RESSALVA_DA_EXPORTACAO).toContain("status");
    expect(RESSALVA_DA_EXPORTACAO).toContain("busca");
  });
});
