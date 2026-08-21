import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ErroDeExclusao,
  PALAVRA_DE_CONFIRMACAO,
  confirmacaoValida,
  excluirMinhaConta,
  traduzirErroDeExclusao,
} from "./exclusao";

/**
 * O que estes testes protegem: a HONESTIDADE das frases.
 *
 * A rota nunca apaga a conta num caminho de erro — aborta antes do DELETE no
 * GoTrue de propósito. Uma frase que deixe a pessoa achando que sumiu do banco
 * quando ela continua cadastrada é o pior desfecho desta tela, e é exatamente o
 * tipo de regressão que uma reescrita de copy introduz sem querer. Por isso o
 * varredor abaixo exige o invariante em TODO status conhecido, e não só nos que
 * alguém lembrou de testar um a um.
 */

afterEach(() => {
  vi.restoreAllMocks();
});

/** Todo status que a rota (e os middlewares dela) sabe produzir. */
const STATUS_CONHECIDOS = [0, 400, 401, 403, 409, 429, 500, 502, 503];

describe("confirmacaoValida", () => {
  it("aceita a palavra exata", () => {
    expect(confirmacaoValida(PALAVRA_DE_CONFIRMACAO)).toBe(true);
  });

  it("ignora caixa e espaços em volta — o atrito é digitar, não acertar o Caps Lock", () => {
    expect(confirmacaoValida("excluir")).toBe(true);
    expect(confirmacaoValida("  Excluir  ")).toBe(true);
    expect(confirmacaoValida("\tEXCLUIR\n")).toBe(true);
  });

  it("recusa vazio, palavra parcial e palavra com sobra", () => {
    expect(confirmacaoValida("")).toBe(false);
    expect(confirmacaoValida("   ")).toBe(false);
    expect(confirmacaoValida("EXCLUI")).toBe(false);
    expect(confirmacaoValida("EXCLUIR AGORA")).toBe(false);
    expect(confirmacaoValida("APAGAR")).toBe(false);
  });
});

describe("traduzirErroDeExclusao", () => {
  it("dá a cada status conhecido uma frase própria, e nenhuma se repete", () => {
    const frases = STATUS_CONHECIDOS.map(
      (s) => traduzirErroDeExclusao(s).message,
    );
    expect(new Set(frases).size).toBe(STATUS_CONHECIDOS.length);
  });

  it("carrega o status no erro, para a tela decidir a ação sem casar texto", () => {
    for (const status of STATUS_CONHECIDOS) {
      const erro = traduzirErroDeExclusao(status);
      expect(erro).toBeInstanceOf(ErroDeExclusao);
      expect(erro.status).toBe(status);
    }
  });

  it("NUNCA deixa a pessoa achando que a conta sumiu: toda frase diz que ela continua", () => {
    for (const status of STATUS_CONHECIDOS) {
      const frase = traduzirErroDeExclusao(status).message;
      expect(
        /não foi excluída|continua ativa|nada foi feito/i.test(frase),
        `status ${status}: "${frase}"`,
      ).toBe(true);
    }
  });

  it("nunca promete que NADA foi apagado — a rota não garante isso em 500 nem em 502", () => {
    for (const status of STATUS_CONHECIDOS) {
      expect(traduzirErroDeExclusao(status).message).not.toMatch(
        /nada foi apagado|nada foi excluíd/i,
      );
    }
  });

  it("409: aponta o último administrador e o que fazer antes de tentar de novo", () => {
    const erro = traduzirErroDeExclusao(409);
    expect(erro.message).toMatch(/administra/i);
    expect(erro.message).toMatch(/cadastre outro administrador/i);
  });

  it("502: diz que a conta NÃO foi excluída e nomeia o Mercado Pago", () => {
    const erro = traduzirErroDeExclusao(502);
    expect(erro.message).toMatch(/NÃO FOI EXCLUÍDA/);
    expect(erro.message).toMatch(/Mercado Pago/);
    expect(erro.message).toMatch(/tente de novo/i);
  });

  it("503: assume que a falha é da loja, não de quem pediu", () => {
    const erro = traduzirErroDeExclusao(503);
    expect(erro.message).toMatch(/indisponível/i);
    expect(erro.message).toMatch(/nosso lado/i);
  });

  it("401 manda entrar de novo; 403 manda sair e entrar", () => {
    expect(traduzirErroDeExclusao(401).message).toMatch(/sessão expirou/i);
    expect(traduzirErroDeExclusao(401).message).toMatch(/entre de novo/i);
    expect(traduzirErroDeExclusao(403).message).toMatch(/permissão/i);
  });

  it("429: nomeia o teto de tentativas e diz quanto esperar", () => {
    expect(traduzirErroDeExclusao(429).message).toMatch(/uma hora/i);
  });

  it("500: frase genérica de falha nossa, com convite a repetir", () => {
    expect(traduzirErroDeExclusao(500).message).toMatch(/falha nossa/i);
    expect(traduzirErroDeExclusao(500).message).toMatch(/repetir o pedido é seguro/i);
  });

  it("status desconhecido: frase padrão na tela, mensagem do servidor só no console", () => {
    const aviso = vi.spyOn(console, "warn").mockImplementation(() => {});
    const erro = traduzirErroDeExclusao(418, { message: "I am a teapot" });
    expect(erro.status).toBe(418);
    expect(erro.message).not.toMatch(/teapot/);
    expect(erro.message).toMatch(/continua ativa/i);
    expect(aviso).toHaveBeenCalledWith(expect.stringContaining("418"));
    expect(aviso).toHaveBeenCalledWith(expect.stringContaining("I am a teapot"));
  });
});

describe("excluirMinhaConta", () => {
  const respostaFalsa = (status: number, corpo: unknown = {}) =>
    vi.fn(async () => ({
      ok: status >= 200 && status < 300,
      status,
      json: async () => corpo,
    })) as unknown as typeof fetch;

  it("chama DELETE /auth/users/me com o Bearer do token", async () => {
    const chamar = respostaFalsa(200, { message: "Sua conta foi excluída com sucesso." });
    await expect(excluirMinhaConta("tok-123", chamar)).resolves.toBeUndefined();

    const chamada = (chamar as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(String(chamada[0])).toContain("/auth/users/me");
    expect(chamada[1].method).toBe("DELETE");
    expect(chamada[1].headers.Authorization).toBe("Bearer tok-123");
  });

  it("lança a frase traduzida do status, e não a do corpo do servidor", async () => {
    const recusa = respostaFalsa(409, {
      message: "Você é a única pessoa que administra a loja.",
    });
    await expect(excluirMinhaConta("tok", recusa)).rejects.toMatchObject({
      status: 409,
      message: expect.stringMatching(/cadastre outro administrador/i),
    });
  });

  it("corpo que não é JSON (sendStatus 401) não derruba a tradução", async () => {
    const semJson = vi.fn(async () => ({
      ok: false,
      status: 401,
      json: async () => {
        throw new SyntaxError("Unexpected token U in JSON");
      },
    })) as unknown as typeof fetch;
    await expect(excluirMinhaConta("tok", semJson)).rejects.toMatchObject({
      status: 401,
      message: expect.stringMatching(/entre de novo/i),
    });
  });

  it("fetch que rejeita vira status 0, nunca sucesso silencioso", async () => {
    const semRede = vi.fn(async () => {
      throw new TypeError("Failed to fetch");
    }) as unknown as typeof fetch;
    await expect(excluirMinhaConta("tok", semRede)).rejects.toMatchObject({
      status: 0,
      message: expect.stringMatching(/continua ativa/i),
    });
  });
});
