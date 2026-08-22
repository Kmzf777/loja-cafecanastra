import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

/**
 * O middleware existe por um motivo que não se vê e falha calado: com rotação
 * de refresh token, uma renovação feita num Server Component QUEIMA o token
 * antigo e o substituto morre no `catch` vazio de `servidor.ts`. Passado o
 * intervalo de tolerância a reuso, a sessão do navegador está morta e não há
 * erro em lugar nenhum.
 *
 * Estes testes fixam as duas coisas que, se saírem daqui, levam esse conserto
 * junto — e uma terceira que é pior que a doença:
 *
 *   1. alguma chamada de auth é feita (é ELA que dispara a renovação);
 *   2. o cookie novo sai na RESPOSTA;
 *   3. os cabeçalhos anti-cache do `setAll` são copiados — sem eles o proxy
 *      reverso na frente da loja pode guardar um `Set-Cookie` de sessão e
 *      servi-lo ao próximo visitante, que passa a estar logado na conta alheia.
 */

const capturado: {
  opcoes: {
    cookies: {
      getAll: () => { name: string; value: string }[];
      setAll: (
        cookies: { name: string; value: string; options?: unknown }[],
        cabecalhos: Record<string, string>,
      ) => void;
    };
  } | null;
  chamouAuth: string[];
  cookiesParaGravar: { name: string; value: string; options?: unknown }[];
  cabecalhos: Record<string, string>;
} = {
  opcoes: null,
  chamouAuth: [],
  cookiesParaGravar: [],
  cabecalhos: {},
};

vi.mock("@supabase/ssr", () => ({
  createServerClient: (_url: string, _chave: string, opcoes: never) => {
    capturado.opcoes = opcoes;
    return {
      auth: {
        getClaims: async () => {
          capturado.chamouAuth.push("getClaims");
          // É aqui que o supabase-js grava o token renovado na resposta.
          capturado.opcoes!.cookies.setAll(
            capturado.cookiesParaGravar,
            capturado.cabecalhos,
          );
          return { data: null, error: null };
        },
      },
    };
  },
}));

import { NextRequest } from "next/server";
import { middleware } from "./middleware";

/** Cabeçalhos exatos que o @supabase/ssr 0.12.4 passa junto dos cookies. */
const CABECALHOS_DO_SSR = {
  "Cache-Control": "private, no-cache, no-store, must-revalidate, max-age=0",
  Expires: "0",
  Pragma: "no-cache",
};

function requisicao() {
  return new NextRequest("https://loja.exemplo/account");
}

function requisicaoPara(caminho: string) {
  return new NextRequest(`https://loja.exemplo${caminho}`);
}

/**
 * Como se enxerga um rewrite: o `NextResponse.rewrite` não muda o status nem o
 * corpo — ele escreve o destino interno neste cabeçalho, e é o Next que o lê.
 * Devolve `null` quando a resposta passou intocada.
 */
function rewriteDe(resposta: Response): string | null {
  const bruto = resposta.headers.get("x-middleware-rewrite");
  return bruto ? new URL(bruto).pathname : null;
}

beforeEach(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://exemplo.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "chave-anon-de-teste";
  capturado.opcoes = null;
  capturado.chamouAuth = [];
  capturado.cookiesParaGravar = [
    { name: "sb-exemplo-auth-token", value: "token-renovado", options: {} },
  ];
  capturado.cabecalhos = { ...CABECALHOS_DO_SSR };
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("middleware de sessão", () => {
  /**
   * Sem UMA chamada de auth, o middleware não faz nada: é ela que faz o
   * supabase-js perceber o token vencido e renová-lo.
   */
  it("chama o auth para forçar a renovação", async () => {
    await middleware(requisicao());
    expect(capturado.chamouAuth).toContain("getClaims");
  });

  it("devolve na resposta o cookie renovado", async () => {
    const resposta = await middleware(requisicao());
    expect(resposta.cookies.get("sb-exemplo-auth-token")?.value).toBe(
      "token-renovado",
    );
  });

  /**
   * O SEGUNDO ARGUMENTO DO `setAll`. Se este teste ficar vermelho, a resposta
   * com `Set-Cookie` de sessão volta a ser cacheável — e o sintoma em produção
   * é um visitante abrindo a loja já logado na conta de outra pessoa.
   */
  it("copia os cabeçalhos anti-cache para a resposta", async () => {
    const resposta = await middleware(requisicao());
    for (const [nome, valor] of Object.entries(CABECALHOS_DO_SSR)) {
      expect(resposta.headers.get(nome)).toBe(valor);
    }
  });

  /**
   * `ambiente.ts` lança quando falta variável, e faz bem numa página. Aqui não:
   * o middleware roda em TODA requisição, inclusive na home e no catálogo, que
   * não precisam de sessão. Deixar subir trocaria "cliente não fica logado"
   * por "a loja inteira responde 500".
   */
  it("não derruba a loja quando a configuração falta", async () => {
    delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    const resposta = await middleware(requisicao());
    expect(resposta).toBeDefined();
    expect(capturado.chamouAuth).toHaveLength(0);
  });
});

/**
 * O REWRITE DE IDIOMA.
 *
 * A promessa do projeto é que nenhuma URL existente mude: `/cafes` continua
 * `/cafes` na barra de endereços, e por baixo o Next resolve
 * `app/[locale]/(vitrine)/cafes` com `locale = "pt"`. Rewrite, não redirect —
 * um redirect mudaria a URL visível e faria backlink, sitemap e link impresso
 * apontarem para um endereço que redireciona.
 *
 * O caso que mais assusta é o penúltimo desta suíte: o rewrite e a renovação
 * de sessão dividem o MESMO objeto de resposta, e o `setAll` do @supabase/ssr
 * o RECRIA do zero quando o token é renovado. Se essa recriação esquecer o
 * rewrite, a loja inteira responde 404 para quem tem sessão — e só para quem
 * tem sessão.
 */
describe("rewrite de idioma", () => {
  it("manda o português sem prefixo para /pt, sem mudar a URL visível", async () => {
    const resposta = await middleware(requisicaoPara("/cafes"));
    expect(rewriteDe(resposta)).toBe("/pt/cafes");
    // Rewrite não é redirect: nada de 3xx nem de Location.
    expect(resposta.status).toBe(200);
    expect(resposta.headers.get("location")).toBeNull();
  });

  it("a home também", async () => {
    expect(rewriteDe(await middleware(requisicaoPara("/")))).toBe("/pt");
  });

  it("deixa /en e /es passarem — já têm idioma", async () => {
    expect(rewriteDe(await middleware(requisicaoPara("/en/cafes")))).toBeNull();
    expect(rewriteDe(await middleware(requisicaoPara("/es/cafes")))).toBeNull();
    expect(rewriteDe(await middleware(requisicaoPara("/en")))).toBeNull();
  });

  /**
   * Sacola, checkout, conta e pedido vivem em `app/(transacional)/`, FORA do
   * `[locale]`, porque são pt-BR por decisão do cliente. Prefixá-los mandaria
   * o caminho de compra para uma rota que não existe.
   */
  it("não toca no caminho transacional", async () => {
    for (const caminho of [
      "/sacola",
      "/checkout",
      "/account",
      "/account/login",
      "/pedido/42",
    ]) {
      expect(rewriteDe(await middleware(requisicaoPara(caminho)))).toBeNull();
    }
  });

  it("não toca no painel, na API nem em arquivo estático", async () => {
    for (const caminho of [
      "/dashboard",
      "/dashboard/pedidos",
      "/api/qualquer",
      "/imagem-banner.jpg",
    ]) {
      expect(rewriteDe(await middleware(requisicaoPara(caminho)))).toBeNull();
    }
  });

  /**
   * `/pt/cafes` seria um SEGUNDO endereço para a página que já mora em
   * `/cafes`. Aqui o redirect é o certo justamente porque o endereço
   * prefixado NÃO é o canônico — é o inverso exato do caso acima.
   */
  it("devolve /pt/... ao endereço canônico com um redirect permanente", async () => {
    const resposta = await middleware(requisicaoPara("/pt/cafes"));
    expect(resposta.status).toBe(308);
    expect(new URL(resposta.headers.get("location")!).pathname).toBe("/cafes");
  });

  /**
   * `/en/checkout` NÃO EXISTE COMO ROTA — o caminho de compra vive fora do
   * `[locale]` — e antes desta onda ele respondia 404 seco. Nenhum link
   * gerado por `href()` produz esse endereço, mas um cliente que troca `pt`
   * por `en` na barra, ou um link colado num grupo, cai nele: 404 no meio do
   * caminho que traz o dinheiro. O 308 leva ao endereço que existe.
   */
  it("devolve /en/checkout e /es/sacola ao caminho de compra que existe", async () => {
    for (const [pedido, esperado] of [
      ["/en/checkout", "/checkout"],
      ["/es/sacola", "/sacola"],
      ["/en/account/login", "/account/login"],
      ["/es/pedido/42", "/pedido/42"],
    ]) {
      const resposta = await middleware(requisicaoPara(pedido));
      expect(resposta.status, pedido).toBe(308);
      expect(new URL(resposta.headers.get("location")!).pathname, pedido).toBe(
        esperado,
      );
    }
  });

  /**
   * O TESTE QUE SEGURA OS DOIS LADOS. O `setAll` recria a resposta para
   * devolver o cookie renovado; o rewrite precisa sobreviver a essa recriação.
   * Se um dia ele sumir daqui, quem está logado recebe 404 no catálogo
   * inteiro, e quem não está não vê nada de errado.
   */
  it("mantém o rewrite na resposta que carrega o cookie renovado", async () => {
    const resposta = await middleware(requisicaoPara("/cafes"));
    expect(capturado.chamouAuth).toContain("getClaims");
    expect(rewriteDe(resposta)).toBe("/pt/cafes");
    expect(resposta.cookies.get("sb-exemplo-auth-token")?.value).toBe(
      "token-renovado",
    );
  });

  /**
   * Sem configuração do Supabase o middleware sai cedo — e o rewrite tem de
   * sair com ele. Senão uma env faltando deixa de ser "cliente não fica
   * logado" e passa a ser "a loja inteira responde 404".
   */
  it("aplica o rewrite mesmo sem configuração do Supabase", async () => {
    delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    const resposta = await middleware(requisicaoPara("/cafes"));
    expect(capturado.chamouAuth).toHaveLength(0);
    expect(rewriteDe(resposta)).toBe("/pt/cafes");
  });
});
