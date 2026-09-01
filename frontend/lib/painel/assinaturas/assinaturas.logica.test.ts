import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  POR_PAGINA,
  ROTA_DE_ASSINATURAS,
  STATUS_DE_ASSINATURA,
  aplicar,
  cafeDaAssinatura,
  chipsDasAssinaturas,
  comparavel,
  contarPorStatus,
  filtrarPorBusca,
  filtrarPorStatus,
  frequenciaEmTexto,
  identificarAssinatura,
  lerEstado,
  paginar,
  rotuloDeStatus,
  temFiltro,
  tomDeStatus,
  urlDaTela,
  type Assinatura,
} from "./assinaturas.logica";

function assinatura(sobrepor: Partial<Assinatura> = {}): Assinatura {
  return {
    id: "aaaaaaaa-0000-0000-0000-000000000001",
    sku: "CAN-CLA-250",
    quantidade: 2,
    frequencia_dias: 30,
    preco_centavos: 5900,
    status: "ativa",
    criado_em: "2026-05-10T12:00:00.000Z",
    atualizado_em: "2026-05-10T12:00:00.000Z",
    cancelada_em: null,
    nome_cafe: "Café Canastra Clássico",
    cliente_nome: "Maria Souza",
    cliente_email: "maria@exemplo.com",
    ...sobrepor,
  };
}

/**
 * O VOCABULÁRIO É COMPARADO COM A MIGRAÇÃO, lendo o arquivo do disco.
 *
 * É a mesma técnica de `status.test.ts` para os nove status de pedido, e a razão
 * é a mesma: um status novo no CHECK do banco que não exista aqui sairia na tela
 * como texto cru, e um status daqui que não exista lá seria uma aba que nunca
 * traz nada. Nenhum dos dois dá erro em lugar nenhum.
 */
describe("os quatro status, conferidos contra o CHECK da 0015", () => {
  const MIGRACAO = readFileSync(
    join(
      __dirname,
      "..", "..", "..", "..",
      "backend", "db", "migrations", "0015_assinaturas.sql",
    ),
    "utf8",
  );

  it("são exatamente os do banco, e na mesma quantidade", () => {
    const check = MIGRACAO.match(
      /CHECK\s*\(status IN \(([^)]*)\)\)/,
    );
    expect(check, "o CHECK de status mudou de forma na migração").not.toBeNull();

    const doBanco = [...check![1].matchAll(/'([a-z_]+)'/g)].map((m) => m[1]).sort();
    const daTela = STATUS_DE_ASSINATURA.map((s) => s.valor).sort();

    expect(daTela).toEqual(doBanco);
  });

  /**
   * R21: vermelho no painel é EXCLUSIVAMENTE erro e ação destrutiva. Assinatura
   * cancelada é rotina — quase sempre uma decisão do cliente —, e pintá-la de
   * vermelho numa lista em que ela é comum ensina o gestor a ignorar o vermelho
   * no dia em que ele significar alguma coisa.
   */
  it("nenhum status é vermelho — R21", () => {
    for (const { valor } of STATUS_DE_ASSINATURA) {
      expect(tomDeStatus(valor)).not.toBe("erro");
    }
  });

  it("cada valor tem rótulo em português", () => {
    expect(rotuloDeStatus("ativa")).toBe("Ativa");
    expect(rotuloDeStatus("cancelada")).toBe("Cancelada");
  });

  /**
   * Status desconhecido devolve a SI MESMO. Esconder atrás de "Outro" faria um
   * status novo do backend sumir da tela sem ninguém notar — e é assim que uma
   * tela deixa de refletir o banco por meses.
   */
  it("status desconhecido aparece cru, em vez de sumir", () => {
    expect(rotuloDeStatus("suspensa")).toBe("suspensa");
    expect(tomDeStatus("suspensa")).toBe("neutro");
  });
});

describe("comparavel — a busca em memória precisa ignorar acento", () => {
  /**
   * Aqui quem compara é o JavaScript, e não o `ILIKE` do Postgres: sem tirar o
   * acento dos dois lados, buscar "cafe" não acha "Café" — numa loja cujos
   * produtos todos se chamam "Café alguma coisa".
   */
  it("tira acento e caixa", () => {
    expect(comparavel("Café Canastra Clássico")).toBe("cafe canastra classico");
    expect(comparavel("MARIA")).toBe("maria");
    expect(comparavel("Ávila")).toBe("avila");
  });

  it("ausência vira string vazia, e não 'null'", () => {
    expect(comparavel(null)).toBe("");
    expect(comparavel(undefined)).toBe("");
  });
});

describe("filtrarPorBusca", () => {
  const lista = [
    assinatura({ id: "1", cliente_nome: "Maria Souza" }),
    assinatura({ id: "2", cliente_nome: "João Pedro", cliente_email: "joao@x.com" }),
    assinatura({
      id: "3",
      cliente_nome: "Ana",
      cliente_email: "ana@x.com",
      nome_cafe: "Micro-lote Sabiá",
      sku: "CAN-MIC-250",
    }),
  ];

  it("busca vazia devolve tudo — e devolve a MESMA lista, sem cópia", () => {
    expect(filtrarPorBusca(lista, "")).toBe(lista);
    expect(filtrarPorBusca(lista, "   ")).toBe(lista);
  });

  it("acha por nome do cliente", () => {
    expect(filtrarPorBusca(lista, "maria").map((a) => a.id)).toEqual(["1"]);
  });

  it("acha por e-mail", () => {
    expect(filtrarPorBusca(lista, "joao@x").map((a) => a.id)).toEqual(["2"]);
  });

  it("acha por café e por SKU", () => {
    expect(filtrarPorBusca(lista, "micro-lote").map((a) => a.id)).toEqual(["3"]);
    expect(filtrarPorBusca(lista, "CAN-MIC").map((a) => a.id)).toEqual(["3"]);
  });

  it("acha sem acento o que está com acento, e vice-versa", () => {
    expect(filtrarPorBusca(lista, "sabia").map((a) => a.id)).toEqual(["3"]);
    expect(filtrarPorBusca(lista, "joão").map((a) => a.id)).toEqual(["2"]);
  });

  it("acha no meio da palavra", () => {
    expect(filtrarPorBusca(lista, "ouza").map((a) => a.id)).toEqual(["1"]);
  });

  it("campo nulo não derruba a busca", () => {
    const comNulos = [assinatura({ id: "9", cliente_nome: null, nome_cafe: null, sku: null, cliente_email: null })];
    expect(filtrarPorBusca(comNulos, "maria")).toEqual([]);
  });
});

describe("filtrarPorStatus", () => {
  const lista = [
    assinatura({ id: "1", status: "ativa" }),
    assinatura({ id: "2", status: "cancelada" }),
    assinatura({ id: "3", status: "ativa" }),
  ];

  it("status vazio é 'todas'", () => {
    expect(filtrarPorStatus(lista, "")).toBe(lista);
  });

  it("filtra pelo valor exato", () => {
    expect(filtrarPorStatus(lista, "ativa").map((a) => a.id)).toEqual(["1", "3"]);
  });
});

describe("contarPorStatus — a contagem que vai ao lado de cada aba", () => {
  const lista = [
    assinatura({ status: "ativa" }),
    assinatura({ status: "ativa" }),
    assinatura({ status: "cancelada" }),
  ];

  it("conta cada um, e '' é o total", () => {
    const c = contarPorStatus(lista);
    expect(c[""]).toBe(3);
    expect(c.ativa).toBe(2);
    expect(c.cancelada).toBe(1);
  });

  /**
   * TODO STATUS DA LISTA FECHADA APARECE, MESMO EM ZERO. Uma aba que some
   * quando não há nada nela faz a barra de filtros mudar de tamanho a cada
   * busca — e o gestor perde a referência de onde clicar.
   */
  it("status sem nenhuma assinatura conta zero, e não fica ausente", () => {
    const c = contarPorStatus(lista);
    expect(c.pendente).toBe(0);
    expect(c.pausada).toBe(0);
  });

  it("status fora da lista fechada é contado, não vira NaN", () => {
    const c = contarPorStatus([assinatura({ status: "suspensa" })]);
    expect(c.suspensa).toBe(1);
    expect(Number.isNaN(c.suspensa)).toBe(false);
  });

  it("lista vazia conta zero em tudo", () => {
    const c = contarPorStatus([]);
    expect(c[""]).toBe(0);
    expect(c.ativa).toBe(0);
  });
});

describe("paginar", () => {
  const lista = Array.from({ length: 45 }, (_, i) => i + 1);

  it("fatia a página pedida", () => {
    expect(paginar(lista, 1, 20).itens[0]).toBe(1);
    expect(paginar(lista, 2, 20).itens[0]).toBe(21);
    expect(paginar(lista, 3, 20).itens).toEqual([41, 42, 43, 44, 45]);
  });

  it("diz o total real e quantas páginas há", () => {
    const p = paginar(lista, 1, 20);
    expect(p.total).toBe(45);
    expect(p.totalPaginas).toBe(3);
  });

  /**
   * O FAVORITO VELHO: `?pagina=9` numa lista que encolheu. Fatiar sem corrigir
   * devolveria zero itens, e a tela desenharia "nenhum resultado para este
   * filtro" — que se lê como "não há nada", e não como "esta página não
   * existe".
   */
  it("página além do fim volta para a última que existe, com itens dentro", () => {
    const p = paginar(lista, 9, 20);
    expect(p.pagina).toBe(3);
    expect(p.itens.length).toBe(5);
  });

  it("lista vazia é a página 1, vazia — nunca a página 0", () => {
    const p = paginar([], 3, 20);
    expect(p).toEqual({ itens: [], total: 0, totalPaginas: 1, pagina: 1 });
  });

  it("o padrão de itens por página é o da tela", () => {
    expect(paginar(Array.from({ length: 60 }, (_, i) => i), 1).itens.length).toBe(
      POR_PAGINA,
    );
  });
});

describe("aplicar — busca, status e página na ordem certa", () => {
  const lista = [
    assinatura({ id: "1", status: "ativa", cliente_nome: "Maria Souza", cliente_email: "m1@x.com" }),
    assinatura({ id: "2", status: "cancelada", cliente_nome: "Maria Lima", cliente_email: "m2@x.com" }),
    assinatura({ id: "3", status: "ativa", cliente_nome: "João Pedro", cliente_email: "jp@x.com" }),
  ];

  it("busca e status se somam", () => {
    const { pagina } = aplicar(lista, { busca: "maria", status: "ativa", pagina: 1 });
    expect(pagina.itens.map((a) => a.id)).toEqual(["1"]);
    expect(pagina.total).toBe(1);
  });

  /**
   * A CONTAGEM DAS ABAS É FEITA DEPOIS DA BUSCA E ANTES DO STATUS, e a ordem é a
   * regra: "Ativas (1)" tem de significar "1 dos resultados da SUA busca está
   * ativa". Contar sobre a lista inteira faria a aba prometer 2 e entregar 1;
   * contar depois do status faria toda aba não-selecionada mostrar zero, que é
   * a versão mais inútil possível de uma contagem.
   */
  it("as contagens respeitam a busca, mas não o status selecionado", () => {
    const { contagem } = aplicar(lista, { busca: "maria", status: "ativa", pagina: 1 });
    expect(contagem[""]).toBe(2);
    expect(contagem.ativa).toBe(1);
    expect(contagem.cancelada).toBe(1);
  });

  it("sem filtro nenhum, devolve tudo", () => {
    const { pagina, contagem } = aplicar(lista, { busca: "", status: "", pagina: 1 });
    expect(pagina.total).toBe(3);
    expect(contagem[""]).toBe(3);
  });
});

describe("lerEstado", () => {
  it("lê os três parâmetros", () => {
    expect(lerEstado({ q: "maria", status: "ativa", pagina: "2" })).toEqual({
      busca: "maria",
      status: "ativa",
      pagina: 2,
    });
  });

  it("URL limpa é 'todas', página 1", () => {
    expect(lerEstado({})).toEqual({ busca: "", status: "", pagina: 1 });
  });

  /**
   * STATUS INVENTADO É IGNORADO, NÃO OBEDECIDO. `?status=paga` — que não existe
   * no CHECK — filtraria a lista inteira para fora, e a tela diria "nenhum
   * resultado para este filtro" para sempre. Ignorado, ela mostra tudo, que é
   * o que uma URL sem filtro válido significa.
   */
  it.each(["paga", "ATIVA", "cancelado", "'; drop table", ""])(
    "status inválido (%j) é ignorado e vira 'todas'",
    (bruto) => {
      expect(lerEstado({ status: bruto }).status).toBe("");
    },
  );

  it("parâmetro repetido cai no padrão", () => {
    expect(lerEstado({ status: ["ativa", "pausada"] }).status).toBe("");
  });
});

describe("urlDaTela — a aba salva do R2", () => {
  it("sem estado, é a rota limpa", () => {
    expect(urlDaTela({})).toBe(ROTA_DE_ASSINATURAS);
  });

  it("a página 1 não aparece na URL", () => {
    expect(urlDaTela({ status: "ativa", pagina: 1 })).toBe(
      `${ROTA_DE_ASSINATURAS}?status=ativa`,
    );
  });

  it("os três parâmetros sobrevivem juntos", () => {
    expect(urlDaTela({ busca: "maria", status: "ativa", pagina: 3 })).toBe(
      `${ROTA_DE_ASSINATURAS}?q=maria&status=ativa&pagina=3`,
    );
  });

  /**
   * A RESSALVA DO R2: nada de dado do RESULTADO na query string. Esta tela só
   * emite três nomes, e a lista é fechada — um `?email=` acrescentado um dia
   * fica vermelho aqui.
   */
  it("só emite q, status e pagina", () => {
    const url = urlDaTela({ busca: "maria@exemplo.com", status: "ativa", pagina: 3 });
    const nomes = [...new URLSearchParams(url.split("?")[1]).keys()].sort();
    expect(nomes).toEqual(["pagina", "q", "status"]);
  });
});

describe("chipsDasAssinaturas — R3", () => {
  it("sem filtro, não há chip", () => {
    expect(chipsDasAssinaturas({ busca: "", status: "", pagina: 1 })).toEqual([]);
  });

  it("um chip por filtro ligado, com o rótulo do status em português", () => {
    const chips = chipsDasAssinaturas({ busca: "maria", status: "ativa", pagina: 1 });
    expect(chips.map((c) => c.chave)).toEqual(["q", "status"]);
    expect(chips[1].valor).toBe("Ativa");
  });

  /**
   * CADA CHIP REMOVE SÓ A SI MESMO, e zera a página. Um chip que apagasse o
   * outro filtro junto seria um "Limpar tudo" disfarçado de remoção — e o
   * gestor perderia o filtro que queria manter.
   */
  it("tirar a busca preserva o status, e vice-versa", () => {
    const chips = chipsDasAssinaturas({ busca: "maria", status: "ativa", pagina: 4 });
    expect(chips[0].href).toBe(`${ROTA_DE_ASSINATURAS}?status=ativa`);
    expect(chips[1].href).toBe(`${ROTA_DE_ASSINATURAS}?q=maria`);
  });

  it("e a remoção sempre volta para a página 1", () => {
    for (const chip of chipsDasAssinaturas({ busca: "m", status: "ativa", pagina: 7 })) {
      expect(chip.href).not.toContain("pagina=");
    }
  });
});

describe("temFiltro — qual dos três estados vazios do R16 mostrar", () => {
  it.each([
    [{ busca: "", status: "", pagina: 1 }, false],
    [{ busca: "maria", status: "", pagina: 1 }, true],
    [{ busca: "", status: "ativa", pagina: 1 }, true],
    // A página não é filtro: estar na 3 não muda o texto do vazio.
    [{ busca: "", status: "", pagina: 3 }, false],
  ])("%j → %s", (estado, esperado) => {
    expect(temFiltro(estado)).toBe(esperado);
  });
});

describe("frequenciaEmTexto", () => {
  /**
   * NÃO TRADUZ 30 PARA "MENSAL". O MP cobra a cada 30 dias corridos, não todo
   * dia 5 — e fevereiro tem 28. Um rótulo que arredonda a regra de cobrança é
   * o tipo de imprecisão que vira reclamação de cliente.
   */
  it("diz o número de dias, sem inventar 'mensal'", () => {
    expect(frequenciaEmTexto(30)).toBe("30 dias");
    expect(frequenciaEmTexto(15)).toBe("15 dias");
    expect(frequenciaEmTexto(45)).toBe("45 dias");
  });

  it.each([0, -1, Number.NaN])("valor impossível (%s) vira travessão", (dias) => {
    expect(frequenciaEmTexto(dias)).toBe("—");
  });
});

describe("identificarAssinatura — R23, a primeira coluna é gente", () => {
  it("o nome do cliente", () => {
    expect(identificarAssinatura(assinatura())).toBe("Maria Souza");
  });

  it("o e-mail quando não há nome", () => {
    expect(identificarAssinatura(assinatura({ cliente_nome: null }))).toBe(
      "maria@exemplo.com",
    );
  });

  /**
   * O backend devolve "—" como e-mail de quem já não tem conta no GoTrue. Usar
   * esse travessão como identificador daria uma primeira coluna com um traço
   * solto — pior que dizer o que aconteceu.
   */
  it("o travessão do backend não vira identificador", () => {
    const linha = assinatura({ cliente_nome: null, cliente_email: "—" });
    expect(identificarAssinatura(linha)).toBe("Cliente sem identificação");
  });

  it("nunca o UUID da assinatura", () => {
    const anonimo = identificarAssinatura(
      assinatura({ cliente_nome: null, cliente_email: null }),
    );
    expect(anonimo).not.toContain("aaaaaaaa");
  });
});

describe("cafeDaAssinatura", () => {
  it("o nome do produto", () => {
    expect(cafeDaAssinatura(assinatura())).toBe("Café Canastra Clássico");
  });

  /** Produto saído do catálogo: o `COALESCE` do backend já cai no SKU, e aqui
   *  é a terceira linha de defesa. O SKU ainda identifica a caixa. */
  it("o SKU quando o produto saiu do catálogo", () => {
    expect(cafeDaAssinatura(assinatura({ nome_cafe: null }))).toBe("CAN-CLA-250");
  });

  it("texto, nunca célula vazia", () => {
    expect(cafeDaAssinatura(assinatura({ nome_cafe: null, sku: null }))).toBe(
      "Café não identificado",
    );
  });
});
