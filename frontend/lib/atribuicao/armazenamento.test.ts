import { describe, it, expect } from "vitest";
import {
  CHAVE_DA_ATRIBUICAO,
  capturarOrigem,
  gravarAtribuicao,
  lerAtribuicao,
} from "./armazenamento";
import { JANELA_DE_ATRIBUICAO_MS, type Atribuicao } from "./atribuicao";

/**
 * A travessia até o `localStorage`.
 *
 * A suíte roda em `environment: "node"` e não tem `window`: a loja entra por
 * parâmetro, que é também o motivo de ela ser injetável — sem isso este arquivo
 * teria de mudar o ambiente de 1.500 casos por causa de dez linhas de fiação.
 */

const AGORA = 1_772_000_000_000;
const LOJA = "https://cafecanastra.com";

/** `localStorage` de mentira, com o mesmo contrato da interface `Storage`. */
function lojaDeTeste(inicial: Record<string, string> = {}): Storage {
  const dados = new Map(Object.entries(inicial));
  return {
    get length() {
      return dados.size;
    },
    clear: () => dados.clear(),
    getItem: (k: string) => dados.get(k) ?? null,
    key: (i: number) => [...dados.keys()][i] ?? null,
    removeItem: (k: string) => void dados.delete(k),
    setItem: (k: string, v: string) => void dados.set(k, v),
  };
}

/** Uma loja que estoura em tudo — modo privado com a cota zerada. */
function lojaQuebrada(): Storage {
  const estoura = () => {
    throw new Error("QuotaExceededError");
  };
  return {
    length: 0,
    clear: estoura,
    getItem: estoura,
    key: estoura,
    removeItem: estoura,
    setItem: estoura,
  } as unknown as Storage;
}

describe("lerAtribuicao — o que volta do armazenamento", () => {
  it("devolve o objeto gravado", () => {
    const loja = lojaDeTeste();
    const a: Atribuicao = {
      canal: "pago",
      utm_source: "google",
      capturadaEm: AGORA,
    };
    gravarAtribuicao(a, loja);
    expect(lerAtribuicao(loja)).toEqual(a);
  });

  it("nada gravado é null", () => {
    expect(lerAtribuicao(lojaDeTeste())).toBeNull();
  });

  it("RECUSA o registro torto em vez de levá-lo ao corpo do checkout", () => {
    // O `localStorage` é editável por qualquer extensão e sobrevive a mudanças
    // de formato. Um objeto meio quebrado daqui viraria um corpo de pagamento
    // meio quebrado, e o checkout é o último lugar onde se quer descobrir isso.
    expect(lerAtribuicao(lojaDeTeste({ [CHAVE_DA_ATRIBUICAO]: "{" }))).toBeNull();
    expect(
      lerAtribuicao(lojaDeTeste({ [CHAVE_DA_ATRIBUICAO]: '"texto"' })),
    ).toBeNull();
    // canal fora do vocabulário de quatro palavras
    expect(
      lerAtribuicao(
        lojaDeTeste({
          [CHAVE_DA_ATRIBUICAO]: '{"canal":"tiktok","capturadaEm":1}',
        }),
      ),
    ).toBeNull();
    // sem carimbo não há como decidir a janela de atribuição
    expect(
      lerAtribuicao(
        lojaDeTeste({ [CHAVE_DA_ATRIBUICAO]: '{"canal":"direto"}' }),
      ),
    ).toBeNull();
  });

  it("armazenamento que estoura não derruba a loja", () => {
    expect(lerAtribuicao(lojaQuebrada())).toBeNull();
    expect(() =>
      gravarAtribuicao({ canal: "direto", capturadaEm: AGORA }, lojaQuebrada()),
    ).not.toThrow();
  });
});

describe("capturarOrigem — uma visita inteira", () => {
  it("a primeira chegada com campanha fica gravada", () => {
    const loja = lojaDeTeste();
    const a = capturarOrigem({
      url: `${LOJA}/cafes?utm_source=instagram&utm_campaign=black`,
      agoraMs: AGORA,
      loja,
    });
    expect(a).toMatchObject({
      utm_source: "instagram",
      utm_campaign: "black",
      canal: "indicacao",
    });
    expect(lerAtribuicao(loja)).toEqual(a);
  });

  it("A NAVEGAÇÃO SEGUINTE NÃO APAGA A CAMPANHA", () => {
    const loja = lojaDeTeste();
    capturarOrigem({
      url: `${LOJA}/?utm_source=google&gclid=Cj0`,
      agoraMs: AGORA,
      loja,
    });
    // Segunda página, sem utm na URL, com o próprio site como referrer.
    const depois = capturarOrigem({
      url: `${LOJA}/cafes/classico`,
      referrer: `${LOJA}/`,
      agoraMs: AGORA + 30_000,
      loja,
    });
    expect(depois).toMatchObject({ utm_source: "google", gclid: "Cj0" });
    expect(depois!.landing_page).toBe("/");
  });

  it("uma campanha NOVA sobrescreve a anterior", () => {
    const loja = lojaDeTeste();
    capturarOrigem({ url: `${LOJA}/?utm_source=instagram`, agoraMs: AGORA, loja });
    const nova = capturarOrigem({
      url: `${LOJA}/?utm_source=google&utm_medium=cpc`,
      agoraMs: AGORA + 86_400_000,
      loja,
    });
    expect(nova).toMatchObject({ utm_source: "google", canal: "pago" });
  });

  it("passada a janela, a visita direta volta a ser direta", () => {
    const loja = lojaDeTeste();
    capturarOrigem({ url: `${LOJA}/?gclid=Cj0`, agoraMs: AGORA, loja });
    const muitoDepois = capturarOrigem({
      url: `${LOJA}/`,
      agoraMs: AGORA + JANELA_DE_ATRIBUICAO_MS + 1,
      loja,
    });
    expect(muitoDepois!.canal).toBe("direto");
    expect(muitoDepois).not.toHaveProperty("gclid");
  });

  it("URL ilegível devolve o que já estava guardado, sem apagar nada", () => {
    const loja = lojaDeTeste();
    const primeira = capturarOrigem({
      url: `${LOJA}/?utm_source=google`,
      agoraMs: AGORA,
      loja,
    });
    expect(
      capturarOrigem({ url: "nada disso", agoraMs: AGORA + 1, loja }),
    ).toEqual(primeira);
  });

  it("sem armazenamento nenhum, a loja continua de pé", () => {
    expect(() =>
      capturarOrigem({ url: `${LOJA}/`, agoraMs: AGORA, loja: undefined }),
    ).not.toThrow();
  });
});
