import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { agregadoAprovadas, REVALIDAR_SEGUNDOS } from "./servidor";

/**
 * O fetch cru ao PostgREST que alimenta o `aggregateRating` da PDP estática.
 *
 * O que se fixa aqui: a FORMA da chamada (URL com o filtro de aprovadas e o
 * `in.(...)` com aspas, cabeçalhos com a chave anônima e o Accept-Profile do
 * schema `canastra`, `next.revalidate` casado com a página) e o contrato de
 * silêncio — QUALQUER falha devolve `null`, porque nada aqui pode derrubar o
 * build da PDP.
 */

const fetchFalso = vi.fn();

beforeEach(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://sb.exemplo.com";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "chave-anon";
  fetchFalso.mockReset();
  vi.stubGlobal("fetch", fetchFalso);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function respondeCom(corpo: unknown, ok = true) {
  fetchFalso.mockResolvedValue({ ok, json: async () => corpo });
}

describe("agregadoAprovadas", () => {
  it("pergunta só as notas aprovadas dos SKUs, como anon, com revalidate", async () => {
    respondeCom([{ nota: 5 }, { nota: 4 }, { nota: 3 }]);

    const agregado = await agregadoAprovadas(["SKU-1", "SKU-2"]);

    expect(agregado).toEqual({ media: 4, contagem: 3 });

    const [url, init] = fetchFalso.mock.calls[0] as [string, RequestInit & {
      next?: { revalidate?: number };
    }];
    expect(url).toContain("https://sb.exemplo.com/rest/v1/avaliacoes?");
    const parametros = new URLSearchParams(url.split("?")[1]);
    expect(parametros.get("select")).toBe("nota");
    expect(parametros.get("status")).toBe("eq.aprovada");
    expect(parametros.get("sku")).toBe('in.("SKU-1","SKU-2")');

    const cabecalhos = init.headers as Record<string, string>;
    expect(cabecalhos.apikey).toBe("chave-anon");
    expect(cabecalhos.Authorization).toBe("Bearer chave-anon");
    // Sem este cabeçalho o PostgREST procura em `public` e responde 404.
    expect(cabecalhos["Accept-Profile"]).toBe("canastra");
    expect(init.next?.revalidate).toBe(REVALIDAR_SEGUNDOS);
  });

  it("leva timeout: um PostgREST pendurado não pode segurar o build da PDP", async () => {
    respondeCom([{ nota: 5 }]);
    await agregadoAprovadas(["SKU-1"]);

    const [, init] = fetchFalso.mock.calls[0] as [string, RequestInit];
    // `fetch` não tem prazo próprio. Sem o signal, uma conexão aceita e nunca
    // respondida deixa esta promessa pendurada para sempre — e como a PDP é
    // estática, isso não atrasa uma requisição: trava a geração de TODAS elas.
    expect(init.signal).toBeInstanceOf(AbortSignal);
    expect(init.signal?.aborted).toBe(false);
  });

  it("sem avaliação aprovada devolve null — nunca um rating inventado", async () => {
    respondeCom([]);
    expect(await agregadoAprovadas(["SKU-1"])).toBeNull();
  });

  it("sem SKUs nem pergunta", async () => {
    expect(await agregadoAprovadas([])).toBeNull();
    expect(fetchFalso).not.toHaveBeenCalled();
  });

  it("resposta não-ok, corpo estranho, rede fora e env ausente viram null", async () => {
    respondeCom([{ nota: 5 }], false);
    expect(await agregadoAprovadas(["SKU-1"])).toBeNull();

    respondeCom({ message: "não é lista" });
    expect(await agregadoAprovadas(["SKU-1"])).toBeNull();

    fetchFalso.mockRejectedValue(new Error("rede fora"));
    expect(await agregadoAprovadas(["SKU-1"])).toBeNull();

    // Env ausente: `exigir()` lança, o catch engole — o build da PDP segue.
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    fetchFalso.mockReset();
    expect(await agregadoAprovadas(["SKU-1"])).toBeNull();
    expect(fetchFalso).not.toHaveBeenCalled();
  });

  it("notas fora do formato são ignoradas na média", async () => {
    respondeCom([{ nota: 5 }, { nota: "x" }, { outra: 1 }, { nota: 3 }]);
    expect(await agregadoAprovadas(["SKU-1"])).toEqual({
      media: 4,
      contagem: 2,
    });
  });
});
