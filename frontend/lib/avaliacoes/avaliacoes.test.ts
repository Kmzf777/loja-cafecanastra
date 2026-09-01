import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

/**
 * O que estes testes protegem:
 *
 *   - O FILTRO `status = 'aprovada'` na lista pública. Sem ele, um visitante
 *     LOGADO vê as próprias avaliações pendentes na PDP (a política de dono
 *     soma com a pública). É a regra nº 1 do módulo.
 *   - AS COLUNAS LISTADAS, nunca `*`: `user_id` e `moderado_em` estão fora do
 *     GRANT de `anon` (0014) — um `select=*` derruba a seção inteira com
 *     42501 para visitante deslogado.
 *   - A MÉDIA vem de TODAS as notas aprovadas, não da página exibida.
 *   - O ENVIO assina com o uid DA SESSÃO (a política exige
 *     `user_id = auth.uid()`) e traduz SQLSTATE em frase de loja — 42501 é
 *     "depois da entrega", nunca a mensagem crua do Postgres.
 *   - "AS MINHAS" PASSA PELA RPC `minhas_avaliacoes()` (0031), nunca por
 *     `.eq("user_id", …)`: `user_id` saiu do GRANT de `authenticated`, filtro
 *     também é leitura, e o modo de falha deste módulo é `[]` mudo — a
 *     regressão não apareceria em lugar nenhum, só na página do pedido
 *     oferecendo formulário para café já avaliado.
 */

type RespostaFalsa = {
  data: unknown;
  error: { code?: string; message?: string } | null;
};

/** Builder encadeável que grava cada chamada e resolve com a resposta da fila. */
function criarConsulta(resposta: RespostaFalsa) {
  const chamadas: Record<string, unknown[]> = {};
  const consulta = {
    chamadas,
    select: registrar("select"),
    in: registrar("in"),
    eq: registrar("eq"),
    order: registrar("order"),
    range: registrar("range"),
    limit: registrar("limit"),
    insert: registrar("insert"),
    then(aoResolver: (r: RespostaFalsa) => unknown) {
      return Promise.resolve(resposta).then(aoResolver);
    },
  };
  function registrar(nome: string) {
    return vi.fn((...args: unknown[]) => {
      chamadas[nome] = args;
      return consulta;
    });
  }
  return consulta;
}

const cenario: {
  respostas: RespostaFalsa[];
  consultas: ReturnType<typeof criarConsulta>[];
  sessao: { user: { id: string } } | null;
} = { respostas: [], consultas: [], sessao: null };

const falso = {
  auth: {
    getSession: vi.fn(async () => ({
      data: { session: cenario.sessao },
      error: null,
    })),
  },
  from: vi.fn((tabela: string) => {
    expect(tabela).toBe("avaliacoes");
    const resposta = cenario.respostas.shift() ?? { data: null, error: null };
    const consulta = criarConsulta(resposta);
    cenario.consultas.push(consulta);
    return consulta;
  }),
  // `minhas_avaliacoes()` (0031). Devolve direto, sem builder: uma RPC não
  // encadeia `.eq()`/`.order()` — e é justamente isso que estes testes fixam.
  rpc: vi.fn(
    async (..._args: unknown[]) =>
      cenario.respostas.shift() ?? { data: null, error: null },
  ),
};

vi.mock("../supabase/cliente", () => ({ clienteNavegador: () => falso }));

import {
  ErroDeAvaliacao,
  POR_PAGINA,
  enviarAvaliacao,
  listarAprovadas,
  minhasAvaliacoes,
  traduzirErroDeAvaliacao,
} from "./avaliacoes";

const LINHA = {
  id: "av-1",
  sku: "SKU-1",
  nota: 5,
  titulo: "Ótimo",
  texto: "Chegou fresco.",
  nome_exibicao: "Ana",
  criado_em: "2026-08-01T10:00:00Z",
};

beforeEach(() => {
  cenario.respostas = [];
  cenario.consultas = [];
  cenario.sessao = null;
  falso.from.mockClear();
  falso.rpc.mockClear();
  falso.auth.getSession.mockClear();
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

/* ------------------------------------------------------------------ */

describe("listarAprovadas", () => {
  it("filtra pelos SKUs da linha e por status aprovada, com colunas explícitas", async () => {
    cenario.respostas = [
      { data: [{ nota: 5 }, { nota: 4 }], error: null },
      { data: [LINHA], error: null },
    ];

    const resumo = await listarAprovadas(["SKU-1", "SKU-2"]);

    const [notas, pagina] = cenario.consultas;
    expect(notas.chamadas.in).toEqual(["sku", ["SKU-1", "SKU-2"]]);
    expect(notas.chamadas.eq).toEqual(["status", "aprovada"]);
    expect(pagina.chamadas.in).toEqual(["sku", ["SKU-1", "SKU-2"]]);
    expect(pagina.chamadas.eq).toEqual(["status", "aprovada"]);
    // Colunas explícitas — `*` alcançaria user_id, fora do GRANT de anon.
    expect(String(pagina.chamadas.select?.[0])).not.toContain("*");
    expect(String(pagina.chamadas.select?.[0])).toContain("nome_exibicao");
    expect(String(pagina.chamadas.select?.[0])).not.toContain("user_id");

    expect(resumo.contagem).toBe(2);
    expect(resumo.media).toBeCloseTo(4.5);
    expect(resumo.avaliacoes).toEqual([
      {
        id: "av-1",
        sku: "SKU-1",
        nota: 5,
        titulo: "Ótimo",
        texto: "Chegou fresco.",
        nomeExibicao: "Ana",
        criadoEm: "2026-08-01T10:00:00Z",
      },
    ]);
    expect(resumo.haMais).toBe(true); // 2 aprovadas, 1 na página.
  });

  it("a média vem de TODAS as notas, não da página exibida", async () => {
    cenario.respostas = [
      { data: [{ nota: 5 }, { nota: 1 }, { nota: 3 }], error: null },
      { data: [LINHA], error: null },
    ];
    const resumo = await listarAprovadas(["SKU-1"]);
    expect(resumo.media).toBeCloseTo(3);
    expect(resumo.contagem).toBe(3);
  });

  it("pagina com range a partir de POR_PAGINA", async () => {
    cenario.respostas = [
      { data: [{ nota: 5 }], error: null },
      { data: [], error: null },
    ];
    await listarAprovadas(["SKU-1"], { pagina: 2 });
    const [, pagina] = cenario.consultas;
    expect(pagina.chamadas.range).toEqual([
      2 * POR_PAGINA,
      2 * POR_PAGINA + POR_PAGINA - 1,
    ]);
  });

  it("sem SKUs ou sem aprovadas devolve o vazio sem segunda consulta", async () => {
    expect(await listarAprovadas([])).toEqual({
      media: 0,
      contagem: 0,
      avaliacoes: [],
      haMais: false,
    });
    expect(falso.from).not.toHaveBeenCalled();

    cenario.respostas = [{ data: [], error: null }];
    const resumo = await listarAprovadas(["SKU-1"]);
    expect(resumo.contagem).toBe(0);
    expect(falso.from).toHaveBeenCalledTimes(1);
  });

  it("erro do PostgREST vira ErroDeAvaliacao (quem silencia é a ilha)", async () => {
    cenario.respostas = [
      { data: null, error: { code: "PGRST106", message: "schema" } },
    ];
    await expect(listarAprovadas(["SKU-1"])).rejects.toBeInstanceOf(
      ErroDeAvaliacao,
    );
  });
});

/* ------------------------------------------------------------------ */

describe("enviarAvaliacao", () => {
  beforeEach(() => {
    cenario.sessao = { user: { id: "uid-ana" } };
  });

  it("assina com o uid da sessão e nulifica título/texto vazios", async () => {
    cenario.respostas = [{ data: null, error: null }];
    await enviarAvaliacao({ sku: "SKU-1", nota: 5, titulo: "  ", texto: "" });

    const [consulta] = cenario.consultas;
    expect(consulta.chamadas.insert).toEqual([
      { user_id: "uid-ana", sku: "SKU-1", nota: 5, titulo: null, texto: null },
    ]);
  });

  it("sem sessão recusa localmente com código próprio", async () => {
    cenario.sessao = null;
    await expect(
      enviarAvaliacao({ sku: "SKU-1", nota: 5 }),
    ).rejects.toMatchObject({ codigo: "sem_sessao" });
    expect(falso.from).not.toHaveBeenCalled();
  });

  it("valida nota e tamanhos ANTES de ir ao banco", async () => {
    for (const nota of [0, 6, 4.5, NaN]) {
      await expect(
        enviarAvaliacao({ sku: "SKU-1", nota }),
      ).rejects.toMatchObject({ codigo: "nota_invalida" });
    }
    await expect(
      enviarAvaliacao({ sku: "SKU-1", nota: 5, titulo: "a".repeat(81) }),
    ).rejects.toMatchObject({ codigo: "titulo_longo" });
    await expect(
      enviarAvaliacao({ sku: "SKU-1", nota: 5, texto: "a".repeat(2001) }),
    ).rejects.toMatchObject({ codigo: "texto_longo" });
    expect(falso.from).not.toHaveBeenCalled();
  });

  it("42501 vira a frase da entrega; 23505 vira 'você já avaliou'", async () => {
    cenario.respostas = [
      { data: null, error: { code: "42501", message: "rls" } },
    ];
    await expect(
      enviarAvaliacao({ sku: "SKU-1", nota: 5 }),
    ).rejects.toMatchObject({
      codigo: "42501",
      message: expect.stringContaining("entregue"),
    });

    cenario.respostas = [
      { data: null, error: { code: "23505", message: "dup" } },
    ];
    await expect(
      enviarAvaliacao({ sku: "SKU-1", nota: 5 }),
    ).rejects.toMatchObject({
      codigo: "23505",
      message: expect.stringContaining("já avaliou"),
    });
  });
});

/* ------------------------------------------------------------------ */

describe("minhasAvaliacoes", () => {
  it("sem sessão devolve lista vazia sem consultar", async () => {
    cenario.sessao = null;
    expect(await minhasAvaliacoes()).toEqual([]);
    expect(falso.from).not.toHaveBeenCalled();
    expect(falso.rpc).not.toHaveBeenCalled();
  });

  it("chama a RPC `minhas_avaliacoes`, SEM argumento, e não toca a tabela", async () => {
    // O QUE ESTE TESTE PROVA E O QUE ELE NÃO PROVA. Ele fixa o CONTRATO DE
    // CHAMADA — que o módulo pergunta "quais são as minhas" em vez de filtrar
    // por `user_id` (42501 desde 0031, e o `catch` daqui transformaria isso num
    // `[]` mudo), e que nenhum uid viaja como argumento. Quem a função devolve
    // é pergunta de BANCO, e está medida contra o Postgres de verdade em
    // `backend/test/f7_avaliacoes.test.js` — com um mock, ela passaria igual
    // com a RPC quebrada.
    cenario.sessao = { user: { id: "uid-ana" } };
    cenario.respostas = [
      {
        data: [
          {
            id: "av-2",
            sku: "SKU-2",
            nota: 4,
            titulo: null,
            texto: "Bom.",
            status: "pendente",
            criado_em: "2026-08-02T09:00:00Z",
          },
        ],
        error: null,
      },
    ];

    const minhas = await minhasAvaliacoes();

    expect(falso.rpc).toHaveBeenCalledTimes(1);
    // Nome exato — é o que o PostgREST resolve para `/rpc/minhas_avaliacoes`.
    expect(falso.rpc.mock.calls[0][0]).toBe("minhas_avaliacoes");
    // SEM SEGUNDO ARGUMENTO: a função não tem parâmetro, e mandar um uid aqui
    // seria pedir uma versão dela que reabriria o vazamento que 0031 fechou.
    expect(falso.rpc.mock.calls[0].length).toBe(1);
    // E a tabela não é tocada: `user_id` está fora do GRANT, no filtro também.
    expect(falso.from).not.toHaveBeenCalled();

    expect(minhas).toEqual([
      {
        id: "av-2",
        sku: "SKU-2",
        nota: 4,
        titulo: null,
        texto: "Bom.",
        status: "pendente",
        criadoEm: "2026-08-02T09:00:00Z",
      },
    ]);
  });

  it("erro devolve [] com aviso — a página do pedido não pode quebrar por isto", async () => {
    cenario.sessao = { user: { id: "uid-ana" } };
    cenario.respostas = [
      { data: null, error: { code: "PGRST301", message: "jwt" } },
    ];
    expect(await minhasAvaliacoes()).toEqual([]);
    expect(console.warn).toHaveBeenCalled();
  });
});

/* ------------------------------------------------------------------ */

describe("traduzirErroDeAvaliacao", () => {
  it("código desconhecido cai na frase padrão e vai para o console", () => {
    const erro = traduzirErroDeAvaliacao({ code: "58000", message: "boom" });
    expect(erro.codigo).toBe("58000");
    expect(erro.message).toContain("Tente de novo");
    expect(console.warn).toHaveBeenCalled();
  });
});
