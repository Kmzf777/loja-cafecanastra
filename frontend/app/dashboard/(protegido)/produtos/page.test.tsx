import { describe, it, expect, vi, beforeEach } from "vitest";

import { html } from "@/lib/teste/html";
import type { Leitura } from "@/lib/painel/api-servidor";
import type { ProdutoDoPainel } from "@/lib/painel/produtos/produtos.logica";

/**
 * A CASCA da lista de Produtos — só o que a função pura não alcança.
 *
 * A decisão inteira (ler a URL, montar a consulta, traduzir "embalagem" para
 * `size`, prender a página, montar os chips, reconhecer a medida padrão) vive em
 * `produtos.logica.ts` e tem 35 casos lá. O que sobra para cá é o que só existe
 * quando o JSX é montado:
 *
 *   · a ORDEM DAS GUARDAS do <EstadoDaTela> — que a leitura falhada NÃO seja
 *     desenhada como "nenhum café cadastrado", que é o defeito mais caro do
 *     painel legado e o único que não aparece em teste de unidade nenhum;
 *   · que a CONSULTA que sai daqui seja a que o módulo puro montou (a tela pode
 *     estar certa e chamar a rota errada);
 *   · que a falha das OPÇÕES não derrube a lista — filtro é conveniência, ver o
 *     catálogo é o trabalho;
 *   · e a frase que diz o que atravessa para a loja, que é a informação mais
 *     útil desta tela e a que se perde primeiro num refactor.
 *
 * `await` na função e `html()` no resultado: um Server Component assíncrono é
 * uma função que devolve uma Promise de elemento. Fora do bundler RSC o
 * `"use client"` dos filhos é só uma string no topo do arquivo, e eles
 * renderizam como componentes React normais.
 */

vi.mock("@/lib/conta/painel-servidor", () => ({
  lerAcessoDoPainel: async () => ({
    temSessao: true,
    ehAdmin: true,
    falhouConsulta: false,
    email: "gestao@cafecanastra.com",
    userId: "11111111-1111-1111-1111-111111111111",
  }),
}));

/** A ilha de busca chama `useRouter`, que fora de um roteador não existe. */
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: () => {}, replace: () => {} }),
}));

const lerDaApi = vi.fn();
vi.mock("@/lib/painel/api-servidor", () => ({
  lerDaApi: (...args: unknown[]) => lerDaApi(...args),
}));

const { default: PaginaDeProdutos } = await import("./page");

function produto(n: number, sobrepor: Partial<ProdutoDoPainel> = {}): ProdutoDoPainel {
  return {
    product_id: `2222222${n}-1111-4111-8111-111111111111`,
    sku: `classico-${n}`,
    name: `Café ${n}`,
    size: "250 g",
    category: "Especial",
    price: "59.90",
    image: null,
    timestamp: null,
    quantity: 12,
    description: null,
    weight: "1.200",
    width: "24.00",
    height: "9.00",
    length: "31.00",
    ...sobrepor,
  };
}

/** A leitura da lista, e as duas de opções — nesta ordem, como a página as faz. */
function ligarApi(
  produtos: ProdutoDoPainel[],
  extras: { total?: number; totalPages?: number } = {},
) {
  lerDaApi.mockImplementation(async (caminho: string): Promise<Leitura<unknown>> => {
    if (caminho.startsWith("/options?type=category")) {
      return { ok: true, dados: [{ id: "1", type: "category", value: "Especial" }] };
    }
    if (caminho.startsWith("/options?type=size")) {
      return { ok: true, dados: [{ id: "2", type: "size", value: "250 g" }] };
    }
    return {
      ok: true,
      dados: {
        products: produtos,
        total: extras.total ?? produtos.length,
        totalPages: extras.totalPages ?? 1,
        page: 1,
      },
    };
  });
}

async function saida(
  parametros: Record<string, string | string[] | undefined> = {},
): Promise<string> {
  return html(await PaginaDeProdutos({ searchParams: Promise.resolve(parametros) }));
}

/** A consulta da LISTA, entre as três chamadas da página. */
function consultaDaLista(): string {
  const chamada = lerDaApi.mock.calls.find(
    ([caminho]) => typeof caminho === "string" && caminho.startsWith("/dashboard"),
  );
  return chamada ? (chamada[0] as string) : "";
}

beforeEach(() => {
  lerDaApi.mockReset();
  ligarApi([produto(1), produto(2)]);
});

describe("a tela de produtos, com dados", () => {
  it("monta, e o título é Produtos", async () => {
    const s = await saida();
    expect(s).toContain("<h1");
    expect(s).toContain("Produtos");
  });

  it("desenha uma linha por café, com preço, estoque e a caixa", async () => {
    const s = await saida();
    expect(s).toContain("Café 1");
    expect(s).toContain("classico-2");
    // O `Intl` do pt-BR separa o cifrão com ESPAÇO DURO (U+00A0), e
    // `renderToStaticMarkup` o emite literal. Comparar com um espaço comum aqui
    // faz o teste falhar por um caractere invisível.
    expect(s).toContain("R$\xa059,90");
    expect(s).toContain("1,2 kg · 24×9×31 cm");
  });

  /**
   * R23 — a primeira coluna é o identificador HUMANO, e a <Tabela> a transforma
   * em `<th scope="row">`. Sem isso o leitor de tela anuncia "12" sem dizer de
   * qual café.
   */
  it("a primeira coluna é cabeçalho de linha, e o UUID só existe no href", async () => {
    const s = await saida();
    expect(s).toContain('scope="row"');
    // O deep-link precisa do id; o OLHO não. `>` na frente ancora a busca no
    // início de um nó de texto, que é onde o UUID não pode aparecer.
    expect(s).not.toContain(">22222221-1111-4111");
    expect(s).toContain('href="/dashboard/produtos/22222221-1111-4111-8111-111111111111"');
  });

  /** R24 — tabela nativa, nunca `role="grid"`. */
  it("é uma <table> de verdade", async () => {
    const s = await saida();
    expect(s).toContain("<table");
    expect(s).not.toContain('role="grid"');
  });

  /** R1 — a busca é um campo, não um ícone que abre um campo. E ela nunca foi
   *  usada no painel legado, que filtrava a página em memória. */
  it("a busca está visível, com rótulo, e diz o que ela alcança", async () => {
    const s = await saida();
    expect(s).toContain('role="search"');
    expect(s).toContain("Buscar produto");
    expect(s).toContain('type="search"');
    // A ressalva importa: quem procurar pelo SKU e não achar concluiria que o
    // produto não existe.
    expect(s).toContain("não pelo SKU");
  });

  /** R18 — a ação primária no mesmo canto, e ela é uma ROTA: o id do produto
   *  nunca mais mora em memória volátil. */
  it("oferece o cadastro como link para uma rota própria", async () => {
    const s = await saida();
    expect(s).toContain('href="/dashboard/produtos/novo"');
    expect(s).toContain("Novo produto");
  });

  it("a tela não abre um segundo <main> — o do layout já a envolve", async () => {
    expect(await saida()).not.toContain("<main");
  });
});

/**
 * O SELO "PADRÃO" É O SINAL DO DEFEITO MEDIDO — o formulário legado enviava as
 * quatro medidas sem ter input para nenhuma, e o backend aplicava 0,3 kg /
 * 20×5×20 cm em toda edição, fazendo a loja cotar frete de uma caixa que não
 * existia. Esta é a primeira tela do painel onde isso aparece.
 */
describe("o sinal da caixa padrão", () => {
  it("marca quem está exatamente nos quatro padrões", async () => {
    ligarApi([
      produto(1, { weight: "0.300", width: "20.00", height: "5.00", length: "20.00" }),
    ]);
    const s = await saida();
    expect(s).toContain("Padrão");
    // E a cor não é o canal: a explicação viaja em texto para o leitor de tela.
    expect(s).toContain("confira se são as reais");
  });

  it("não marca quem tem medida própria", async () => {
    const s = await saida();
    expect(s).not.toContain("Padrão");
  });
});

/** Sem SKU o café não chega à vitrine — `repositorio.ts` casa por SKU e
 *  descarta quem não tem. É erro, e por isso é <Selo tom="erro">. */
describe("o produto sem SKU", () => {
  it("é anunciado com a consequência, não como campo em branco", async () => {
    ligarApi([produto(1, { sku: null })]);
    const s = await saida();
    expect(s).toContain("Sem SKU");
    expect(s).toContain("não aparece na loja");
  });
});

describe("a consulta que sai daqui", () => {
  it("pede a rota do painel com página e limite explícitos", async () => {
    await saida();
    expect(consultaDaLista()).toBe("/dashboard?page=1&limit=20");
  });

  /** A tradução "embalagem" → `size` é invisível na tela; é aqui que ela se
   *  prova de ponta a ponta. */
  it("a embalagem da URL vira `size` na API", async () => {
    await saida({ embalagem: "250 g" });
    expect(consultaDaLista()).toContain("size=250+g");
  });

  it("o recorte de destaque vira onlyNew/onlyOld", async () => {
    await saida({ novidade: "antigos" });
    expect(consultaDaLista()).toContain("onlyOld=true");
  });

  it("a busca da URL chega crua à API", async () => {
    await saida({ q: "classico" });
    expect(consultaDaLista()).toContain("q=classico");
  });
});

describe("R3 — o filtro aparece e dá para tirar", () => {
  it("sem filtro, não há chip nem 'Limpar tudo'", async () => {
    expect(await saida()).not.toContain("Limpar tudo");
  });

  it("com filtro, o chip mostra o valor e o 'Limpar tudo' volta à rota limpa", async () => {
    const s = await saida({ categoria: "Especial" });
    expect(s).toContain("Limpar tudo");
    expect(s).toContain('href="/dashboard/produtos"');
  });
});

/**
 * A DOUTRINA DO <EstadoDaTela>, virada em teste: "zero é um número plausível;
 * mostrar o estado inicial depois de um fetch que falhou é informação errada
 * apresentada com toda a confiança".
 */
describe("os três estados vazios do R16", () => {
  it("a leitura que FALHOU vira erro, e nunca 'nenhum café cadastrado'", async () => {
    lerDaApi.mockResolvedValue({
      ok: false,
      erro: "A API não respondeu. Recarregue a página; nada foi alterado.",
    });
    const s = await saida();

    expect(s).toContain("A API não respondeu");
    expect(s).toContain('role="alert"');
    expect(s).not.toContain("Nenhum café cadastrado");
  });

  it("catálogo realmente vazio convida a cadastrar o primeiro", async () => {
    ligarApi([]);
    const s = await saida();
    expect(s).toContain("Nenhum café cadastrado");
    expect(s).toContain('href="/dashboard/produtos/novo"');
  });

  it("vazio COM filtro fala do filtro, não do catálogo", async () => {
    ligarApi([]);
    const s = await saida({ q: "inexistente" });
    expect(s).toContain("Nenhum resultado para este filtro");
    expect(s).not.toContain("Nenhum café cadastrado");
  });

  /** R1 outra vez: a busca fica ACIMA da ficha justamente para não sumir junto
   *  com a tabela — é dela que se precisa para tentar outra coisa. */
  it("a busca continua na tela quando a leitura falhou", async () => {
    lerDaApi.mockResolvedValue({ ok: false, erro: "O servidor falhou." });
    expect(await saida()).toContain('role="search"');
  });
});

describe("as opções de filtro", () => {
  it("viram links, com 'Todas' na frente", async () => {
    const s = await saida();
    expect(s).toContain("Especial");
    expect(s).toContain("Todas");
    expect(s).toContain('href="/dashboard/produtos?categoria=Especial"');
  });

  /** Escolher categoria é conveniência; ver o catálogo é o trabalho. Uma falha
   *  em `/options` não pode derrubar a lista inteira. */
  it("falhando, somem sem derrubar a lista", async () => {
    lerDaApi.mockImplementation(async (caminho: string) => {
      if (caminho.startsWith("/options")) return { ok: false, erro: "500" };
      return {
        ok: true,
        dados: { products: [produto(1)], total: 1, totalPages: 1, page: 1 },
      };
    });
    const s = await saida();
    expect(s).toContain("Café 1");
    // A linha de "Destaque" continua (os valores dela são fixos, não vêm da
    // API); o que some é a dimensão que dependia de `/options`.
    expect(s).not.toContain('href="/dashboard/produtos?categoria=Especial"');
  });
});

/**
 * A FRASE MAIS ÚTIL DA TELA, e a que um refactor apaga primeiro por parecer
 * decoração. Medido em `lib/catalogo/repositorio.ts`: a vitrine lê quatro
 * campos desta API e desenha o resto pelo catálogo editorial versionado. Sem
 * isto, a conclusão mais provável de quem troca a foto é "o sistema está
 * quebrado".
 */
describe("o que atravessa para a loja", () => {
  it("está escrito na tela, com o nome do arquivo editorial", async () => {
    const s = await saida();
    expect(s).toContain("preço");
    expect(s).toContain("estoque");
    expect(s).toContain("SKU");
    expect(s).toContain("data/catalogo-canastra.json");
  });
});
