import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import type { Database } from "../supabase/tipos";
import type { ItemDaSacola } from "./sacola";

/**
 * O que estes testes protegem não é a RPC — ela tem os próprios testes em
 * `backend/test/fundir_sacola.test.js`. É cada decisão deste módulo cuja falha
 * NÃO aparece em lugar nenhum:
 *
 *   - tradução esquecida ....... `produto_id` nulo, a 0007 descarta tudo e a
 *                                sacola some no login, sem erro e sem log;
 *   - fusão sem trava .......... `onAuthStateChange` dispara várias vezes por
 *                                sessão e a sacola do cliente DOBRA a cada uma;
 *   - `localStorage` apagado
 *     antes da resposta ........ falhou a RPC, perdeu-se a sacola dos dois lados;
 *   - lixo mandado para o banco   um item velho derruba ou some com a sacola
 *                                inteira em vez de sair sozinho.
 *
 * Nada aqui precisa de rede: o cliente Supabase e a sessão são de mentira.
 */

/* ------------------------------------------------------------------ *
 * Cenário
 * ------------------------------------------------------------------ */

type ErroFalso = { code?: string; message?: string; hint?: string } | null;

const cenario: {
  sessao: { usuario: { userId: string }; accessToken: string } | null;
  erroDaRpc: ErroFalso;
  erroDaLeitura: ErroFalso;
  itensDaConta: Record<string, unknown>[] | null;
  chamadas: { nome: string; argumentos: unknown }[];
  seguraARpc: null | { liberar: () => void; entrou: Promise<void> };
} = {
  sessao: { usuario: { userId: "u-1" }, accessToken: "token" },
  erroDaRpc: null,
  erroDaLeitura: null,
  itensDaConta: [],
  chamadas: [],
  seguraARpc: null,
};

const falso = {
  rpc: vi.fn(async (nome: string, argumentos: unknown) => {
    cenario.chamadas.push({ nome, argumentos });
    if (cenario.seguraARpc) await cenario.seguraARpc.entrou;
    return { error: cenario.erroDaRpc };
  }),
  from: (_tabela: string) => ({
    select: async (_colunas: string) => ({
      data: cenario.itensDaConta,
      error: cenario.erroDaLeitura,
    }),
  }),
};

vi.mock("../supabase/cliente", () => ({ clienteNavegador: () => falso }));
vi.mock("../conta/sessao", () => ({
  recuperarSessao: async () => cenario.sessao,
  API_BASE: "http://api.teste",
}));

import {
  CHAVE_DA_SACOLA,
  calcularPendentes,
  fundirSacola,
  limparItens,
  reiniciarFusao,
  somarSacolas,
  traduzirDaConta,
  traduzirParaFusao,
} from "./fusao";

/** `localStorage` de mentira, porque o módulo grava e apaga de verdade. */
function fingirNavegador() {
  const dados = new Map<string, string>();
  (globalThis as unknown as { window: unknown }).window = {
    location: { hostname: "localhost", origin: "http://localhost:3000" },
  };
  (globalThis as unknown as { localStorage: unknown }).localStorage = {
    getItem: (c: string) => dados.get(c) ?? null,
    setItem: (c: string, v: string) => void dados.set(c, v),
    removeItem: (c: string) => void dados.delete(c),
  };
  return dados;
}

const UUID_A = "11111111-1111-4111-8111-111111111111";
const UUID_B = "22222222-2222-4222-8222-222222222222";

function item(extras: Partial<ItemDaSacola> = {}): ItemDaSacola {
  return {
    product_id: UUID_A,
    name: "Canastra Tradicional",
    price: 39.9,
    quantity: 2,
    image: "/cafe.jpg",
    size: "Pacote com 250 g",
    ...extras,
  };
}

let dados: Map<string, string>;
let avisos: ReturnType<typeof vi.spyOn>;
let erros: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  dados = fingirNavegador();
  reiniciarFusao();
  cenario.sessao = { usuario: { userId: "u-1" }, accessToken: "token" };
  cenario.erroDaRpc = null;
  cenario.erroDaLeitura = null;
  cenario.itensDaConta = [];
  cenario.chamadas = [];
  cenario.seguraARpc = null;
  falso.rpc.mockClear();
  avisos = vi.spyOn(console, "warn").mockImplementation(() => {});
  erros = vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  avisos.mockRestore();
  erros.mockRestore();
});

/* ------------------------------------------------------------------ *
 * 1. A tradução — a armadilha nº 1 da 0007
 * ------------------------------------------------------------------ */

describe("tradução para o payload da RPC", () => {
  it("troca TODAS as chaves de inglês para português", () => {
    const [traduzido] = traduzirParaFusao([item({ moagem: "média" })]);

    expect(traduzido).toEqual({
      produto_id: UUID_A,
      quantidade: 2,
      preco: 39.9,
      nome: "Canastra Tradicional",
      imagem: "/cafe.jpg",
      tamanho: "Pacote com 250 g",
      moagem: "média",
    });
  });

  it("não deixa passar nenhuma chave em inglês", () => {
    const [traduzido] = traduzirParaFusao([item()]);
    const emIngles = ["product_id", "quantity", "price", "name", "image", "size"];
    expect(Object.keys(traduzido!).filter((c) => emIngles.includes(c))).toEqual([]);
  });

  /**
   * `produto_id` nulo é o desfecho exato do bug: a 0007 filtra por
   * `item ->> 'produto_id' ~* uuid` e descarta TUDO em silêncio.
   */
  it("nenhum item sai com produto_id ou quantidade ausente", () => {
    const traduzidos = traduzirParaFusao([item(), item({ product_id: UUID_B })]);
    for (const t of traduzidos) {
      expect(typeof t.produto_id).toBe("string");
      expect(t.produto_id.length).toBeGreaterThan(0);
      expect(Number.isInteger(t.quantidade)).toBe(true);
    }
  });

  it("item sem moagem vai com moagem nula, não com a chave ausente", () => {
    const [traduzido] = traduzirParaFusao([item()]);
    expect(traduzido).toHaveProperty("moagem", null);
  });

  it("a sacola da conta volta traduzida para o formato da vitrine", () => {
    expect(
      traduzirDaConta([
        {
          produto_id: UUID_A,
          quantidade: 5,
          preco: 39.9,
          nome: "Canastra Tradicional",
          imagem: "/cafe.jpg",
          tamanho: "Pacote com 250 g",
          moagem: null,
        },
      ]),
    ).toEqual([
      {
        product_id: UUID_A,
        quantity: 5,
        price: 39.9,
        name: "Canastra Tradicional",
        image: "/cafe.jpg",
        size: "Pacote com 250 g",
      },
    ]);
  });
});

/**
 * O TESTE QUE NÃO RODA: ele acontece no `tsc --noEmit`.
 *
 * Cada `@ts-expect-error` abaixo QUEBRA O BUILD se o erro que ele espera deixar
 * de acontecer — ou seja, se alguém afrouxar o `Args` de `fundir_sacola` para
 * `Json`, ou fizer `traduzirParaFusao` devolver outra coisa. É a única forma de
 * a tradução se defender sozinha, e é para isto que a Task 2 escreveu
 * `ItemParaFundir` à mão em vez de aceitar o `Json` que a CLI emitiria.
 */
type ArgumentosDaFusao = Database["canastra"]["Functions"]["fundir_sacola"]["Args"];

function verificacoesDeCompilacao() {
  // A forma certa compila: é literalmente o que `executarFusao()` manda.
  const certo: ArgumentosDaFusao = { itens: traduzirParaFusao([item()]) };
  void certo;

  // O BUG. A lista da vitrine, crua, no lugar do payload.
  const cru: ArgumentosDaFusao = {
    // @ts-expect-error chaves em inglês: `produto_id` chegaria nulo em todo item
    itens: [{ product_id: UUID_A, quantity: 2, price: 39.9, name: "Café" }],
  };
  void cru;

  // Metade traduzido é igual a não traduzido: falta `quantidade`.
  const incompleto: ArgumentosDaFusao = {
    // @ts-expect-error `quantidade` é um dos dois campos que a RPC filtra
    itens: [{ produto_id: UUID_A, quantity: 2 }],
  };
  void incompleto;

  // A sacola local também não serve como sacola da conta e vice-versa.
  const daVitrine: ItemDaSacola[] = limparItens([item()]);
  // @ts-expect-error `ItemDaSacola[]` não é o payload da RPC
  const trocado: ArgumentosDaFusao = { itens: daVitrine };
  void trocado;
}

/* ------------------------------------------------------------------ *
 * 2. O lixo do localStorage
 * ------------------------------------------------------------------ */

describe("limpeza dos itens antes de mandar", () => {
  it("descarta o item ruim e mantém os bons", () => {
    const limpos = limparItens([
      item(),
      { name: "sem id", quantity: 1 },
      item({ product_id: UUID_B, quantity: 1 }),
    ]);

    expect(limpos.map((i) => i.product_id)).toEqual([UUID_A, UUID_B]);
    expect(avisos).toHaveBeenCalled();
  });

  it.each([
    ["quantidade zero", { quantity: 0 }],
    ["quantidade negativa", { quantity: -3 }],
    ["quantidade fracionada", { quantity: 1.5 }],
    ["quantidade não numérica", { quantity: "duas" }],
    ["quantidade ausente", { quantity: undefined }],
    ["product_id vazio", { product_id: "  " }],
    ["product_id ausente", { product_id: undefined }],
  ])("descarta %s", (_nome, estrago) => {
    const limpos = limparItens([{ ...item(), ...estrago }, item({ product_id: UUID_B })]);
    expect(limpos.map((i) => i.product_id)).toEqual([UUID_B]);
  });

  it("descarta o que nem objeto é sem levar a sacola junto", () => {
    expect(limparItens([null, 7, "café", [], item()]).map((i) => i.product_id)).toEqual([
      UUID_A,
    ]);
  });

  it("aceita quantidade que veio como texto numérico do localStorage", () => {
    // `JSON.parse` de uma versão antiga do site devolve "3", e o
    // `item ->> 'quantidade'` da RPC aceitaria — descartar aqui seria perder
    // item por uma diferença que não muda nada.
    expect(limparItens([{ ...item(), quantity: "3" }])[0]?.quantity).toBe(3);
  });

  it("corta a quantidade absurda no teto em vez de perder o item", () => {
    // O regex da 0007 (`^[1-9][0-9]{0,5}$`) recusaria 1000000 EM SILÊNCIO.
    expect(limparItens([item({ quantity: 5_000_000 })])[0]?.quantity).toBe(999999);
  });

  it("preço impresentável vira 0 e o item sobrevive", () => {
    const [limpo] = limparItens([{ ...item(), price: "de graça" }]);
    expect(limpo?.price).toBe(0);
    expect(limpo?.product_id).toBe(UUID_A);
  });

  it("avisa no console em vez de descartar calado", () => {
    limparItens([{ name: "sem id" }]);
    expect(avisos).toHaveBeenCalledWith(
      expect.stringContaining("não puderam ser fundidos"),
      expect.anything(),
    );
  });
});

/* ------------------------------------------------------------------ *
 * 3. O que ainda não está na conta
 * ------------------------------------------------------------------ */

describe("cálculo do que falta mandar", () => {
  it("manda a sacola inteira quando a conta ainda não tem nada", () => {
    expect(calcularPendentes([item({ quantity: 2 })], [])).toEqual([
      item({ quantity: 2 }),
    ]);
  });

  it("não manda nada quando a conta já tem tudo — é o que impede dobrar", () => {
    expect(calcularPendentes([item({ quantity: 2 })], [item({ quantity: 2 })])).toEqual(
      [],
    );
  });

  it("manda só a diferença quando a sacola cresceu depois da fusão", () => {
    const pendentes = calcularPendentes(
      [item({ quantity: 5 })],
      [item({ quantity: 2 })],
    );
    expect(pendentes).toHaveLength(1);
    expect(pendentes[0]?.quantity).toBe(3);
  });

  it("soma entradas repetidas do mesmo item antes de mandar", () => {
    // Duas entradas iguais na mesma lista fazem o INSERT da 0007 morrer com
    // 21000 ("cannot affect row a second time") — a fusão inteira, no login.
    const pendentes = calcularPendentes(
      [item({ quantity: 1 }), item({ quantity: 2 })],
      [],
    );
    expect(pendentes).toHaveLength(1);
    expect(pendentes[0]?.quantity).toBe(3);
  });

  it("moagens diferentes do mesmo café são itens diferentes", () => {
    const pendentes = calcularPendentes(
      [item({ moagem: "média" }), item({ moagem: "grossa" })],
      [item({ moagem: "média" })],
    );
    expect(pendentes.map((i) => i.moagem)).toEqual(["grossa"]);
  });

  it("soma duas sacolas por produto e moagem", () => {
    expect(
      somarSacolas([item({ quantity: 2 })], [item({ quantity: 3 })]).map(
        (i) => i.quantity,
      ),
    ).toEqual([5]);
  });
});

/* ------------------------------------------------------------------ *
 * 4. A trava — a armadilha nº 2 da 0007
 * ------------------------------------------------------------------ */

describe("fundir uma vez e só uma", () => {
  beforeEach(() => {
    dados.set(CHAVE_DA_SACOLA, JSON.stringify([item({ quantity: 2 })]));
    cenario.itensDaConta = [
      {
        produto_id: UUID_A,
        quantidade: 2,
        preco: 39.9,
        nome: "Canastra Tradicional",
        imagem: "/cafe.jpg",
        tamanho: "Pacote com 250 g",
        moagem: null,
      },
    ];
  });

  it("manda o payload em português para a RPC certa", async () => {
    await fundirSacola();

    expect(cenario.chamadas).toHaveLength(1);
    expect(cenario.chamadas[0]?.nome).toBe("fundir_sacola");
    expect(cenario.chamadas[0]?.argumentos).toEqual({
      itens: [
        {
          produto_id: UUID_A,
          quantidade: 2,
          preco: 39.9,
          nome: "Canastra Tradicional",
          imagem: "/cafe.jpg",
          tamanho: "Pacote com 250 g",
          moagem: null,
        },
      ],
    });
  });

  /**
   * DOIS OUVINTES NO MESMO TIQUE. Acontece de verdade: o Fast Refresh reavalia
   * também o módulo que se inscreve, e um cliente só pode acabar com dois
   * `onAuthStateChange`. Sem a trava, são duas RPCs e a sacola dobra.
   */
  it("duas chamadas simultâneas viram UMA chamada à RPC", async () => {
    let liberar = () => {};
    const entrou = new Promise<void>((resolva) => {
      liberar = resolva;
    });
    cenario.seguraARpc = { liberar, entrou };

    const primeira = fundirSacola();
    const segunda = fundirSacola();
    liberar();

    const [a, b] = await Promise.all([primeira, segunda]);

    expect(falso.rpc).toHaveBeenCalledTimes(1);
    expect(a).toEqual(b);
  });

  it("eventos seguintes na mesma página não chamam a RPC de novo", async () => {
    await fundirSacola();
    await fundirSacola();
    await fundirSacola();

    expect(falso.rpc).toHaveBeenCalledTimes(1);
  });

  /**
   * A trava de dentro da aba não sobrevive a uma nova carga de página. Quem
   * impede a segunda fusão dali em diante é a base gravada no `localStorage`.
   */
  it("uma nova carga de página não funde de novo a mesma sacola", async () => {
    await fundirSacola();
    expect(falso.rpc).toHaveBeenCalledTimes(1);

    reiniciarFusao(); // é o que uma recarga faz com a trava de memória
    const segunda = await fundirSacola();

    expect(falso.rpc).toHaveBeenCalledTimes(1);
    expect(segunda.situacao).toBe("semNovidade");
  });

  it("depois da fusão, o que a pessoa vê é a sacola da conta", async () => {
    cenario.itensDaConta = [
      {
        produto_id: UUID_A,
        quantidade: 7,
        preco: 39.9,
        nome: "Canastra Tradicional",
        imagem: "/cafe.jpg",
        tamanho: "Pacote com 250 g",
        moagem: null,
      },
    ];

    const resultado = await fundirSacola();

    expect(resultado.situacao).toBe("fundida");
    expect(resultado.situacao === "fundida" && resultado.itens[0]?.quantity).toBe(7);
    // E é ela que fica gravada: a sacola anônima deixou de existir.
    expect(JSON.parse(dados.get(CHAVE_DA_SACOLA)!)[0].quantity).toBe(7);
  });

  it("sacola vazia não chama a RPC nem estraga o login", async () => {
    dados.set(CHAVE_DA_SACOLA, "[]");
    cenario.itensDaConta = [];

    const resultado = await fundirSacola();

    // Nada a fundir: a RPC nem é incomodada. A conta é lida uma vez para o
    // aparelho saber que ela está vazia, e daí em diante nem isso.
    expect(falso.rpc).not.toHaveBeenCalled();
    expect(resultado.situacao === "fundida" && resultado.itens).toEqual([]);

    reiniciarFusao();
    expect((await fundirSacola()).situacao).toBe("semNovidade");
  });

  /**
   * `INITIAL_SESSION` sem sessão dispara em TODA visita anônima, antes de
   * qualquer login. Se ele trancasse, o login que vem em seguida na mesma
   * página não fundiria nada — a perda que esta tarefa existe para impedir.
   */
  it("visitante sem sessão não tranca a fusão do login que vem depois", async () => {
    cenario.sessao = null;
    expect((await fundirSacola()).situacao).toBe("semSessao");

    cenario.sessao = { usuario: { userId: "u-1" }, accessToken: "token" };
    expect((await fundirSacola()).situacao).toBe("fundida");
    expect(falso.rpc).toHaveBeenCalledTimes(1);
  });

  /**
   * O FANTASMA. Nesta fase nada apaga linha de `canastra.carrinho_itens` —
   * remoção e compra passam pelo Express —, então reler a sacola da conta a cada
   * fusão devolveria para dentro da sacola o café que a pessoa acabou de
   * comprar. A releitura acontece uma vez por aparelho, e este caso é o que
   * segura isso.
   */
  it("não ressuscita item removido nem café já comprado", async () => {
    await fundirSacola(); // primeira fusão: o aparelho aprende a conta

    // A pessoa termina a compra: `limpar()` esvazia a sacola local.
    dados.set(CHAVE_DA_SACOLA, "[]");
    // ... e mais tarde põe outro café na sacola.
    dados.set(CHAVE_DA_SACOLA, JSON.stringify([item({ product_id: UUID_B, quantity: 1 })]));
    reiniciarFusao();

    const resultado = await fundirSacola();

    expect(resultado.situacao).toBe("fundida");
    expect(
      resultado.situacao === "fundida" && resultado.itens.map((i) => i.product_id),
    ).toEqual([UUID_B]);
  });

  /**
   * A outra metade da mesma regra: um aparelho que nunca viu esta conta PRECISA
   * ler a sacola dela, senão a sacola montada no celular não aparece no
   * computador — a promessa que o cabeçalho de `sacola.tsx` faz.
   */
  it("aparelho novo com sacola local vazia aprende a sacola da conta", async () => {
    dados.set(CHAVE_DA_SACOLA, "[]");
    cenario.itensDaConta = [
      { produto_id: UUID_B, quantidade: 3, preco: 39.9, nome: "do celular", imagem: "", tamanho: "", moagem: null },
    ];

    const resultado = await fundirSacola();

    expect(falso.rpc).not.toHaveBeenCalled();
    expect(resultado.situacao === "fundida" && resultado.itens[0]?.quantity).toBe(3);
    expect(JSON.parse(dados.get(CHAVE_DA_SACOLA)!)[0].product_id).toBe(UUID_B);
  });

  /**
   * COMPUTADOR COMPARTILHADO. `sair()` não apaga a sacola, então a sacola de
   * quem saiu continua no `localStorage` quando a próxima pessoa entra. Os itens
   * dela levam selo — prova de que já estão numa conta, a da primeira pessoa —,
   * então não são somados na conta da segunda: ela vê a sacola DELA, e a
   * primeira não perde nada, porque os itens continuam na conta dela.
   */
  it("a segunda conta na mesma máquina não herda a sacola já fundida", async () => {
    await fundirSacola();
    reiniciarFusao();

    cenario.sessao = { usuario: { userId: "u-2" }, accessToken: "outro" };
    cenario.itensDaConta = [];
    const resultado = await fundirSacola();

    expect(falso.rpc).toHaveBeenCalledTimes(1);
    expect(resultado.situacao === "fundida" && resultado.itens).toEqual([]);
  });

  it("mas o que a segunda pessoa acrescentou deslogada vai para a conta dela", async () => {
    await fundirSacola();
    const carimbada = JSON.parse(dados.get(CHAVE_DA_SACOLA)!) as ItemDaSacola[];
    dados.set(
      CHAVE_DA_SACOLA,
      JSON.stringify([...carimbada, item({ product_id: UUID_B, quantity: 1 })]),
    );
    reiniciarFusao();

    cenario.sessao = { usuario: { userId: "u-2" }, accessToken: "outro" };
    await fundirSacola();

    expect(falso.rpc).toHaveBeenCalledTimes(2);
    const segunda = cenario.chamadas[1]?.argumentos as {
      itens: { produto_id: string }[];
    };
    expect(segunda.itens.map((i) => i.produto_id)).toEqual([UUID_B]);
  });

  /* ---------------------------------------------------------------- *
   * A base e a sacola são uma unidade lógica gravada em duas chaves
   * ---------------------------------------------------------------- */

  /**
   * `localStorage` não grava duas chaves atomicamente, e elas se separam de
   * verdade: limpeza parcial de dados do site, extensão, script de QA, cota
   * estourando entre uma gravação e a outra. Sem o selo, a sacola já fundida
   * volta a parecer pendente e as quantidades DOBRAM a cada carga de página.
   */
  it("base sumida não faz a sacola já fundida ser fundida de novo", async () => {
    await fundirSacola();
    expect(JSON.parse(dados.get(CHAVE_DA_SACOLA)!)[0].selo).toBeTruthy();

    dados.delete("cart:na_conta");
    reiniciarFusao();

    const resultado = await fundirSacola();

    expect(falso.rpc).toHaveBeenCalledTimes(1);
    // A quantidade é a da conta, não o dobro dela.
    expect(resultado.situacao === "fundida" && resultado.itens[0]?.quantity).toBe(2);
  });

  it("com a base sumida, o item sem selo ainda é fundido", async () => {
    await fundirSacola();
    const carimbada = JSON.parse(dados.get(CHAVE_DA_SACOLA)!) as ItemDaSacola[];

    dados.delete("cart:na_conta");
    dados.set(
      CHAVE_DA_SACOLA,
      JSON.stringify([...carimbada, item({ product_id: UUID_B, quantity: 4 })]),
    );
    reiniciarFusao();

    await fundirSacola();

    expect(falso.rpc).toHaveBeenCalledTimes(2);
    const segunda = cenario.chamadas[1]?.argumentos as {
      itens: { produto_id: string; quantidade: number }[];
    };
    expect(segunda.itens).toEqual([
      expect.objectContaining({ produto_id: UUID_B, quantidade: 4 }),
    ]);
  });

  it("base com selo de outra gravação também é divergência", async () => {
    await fundirSacola();
    const base = JSON.parse(dados.get("cart:na_conta")!);
    dados.set("cart:na_conta", JSON.stringify({ ...base, selo: "de-outra-vida" }));
    reiniciarFusao();

    const resultado = await fundirSacola();

    expect(falso.rpc).toHaveBeenCalledTimes(1);
    expect(resultado.situacao === "fundida" && resultado.itens[0]?.quantity).toBe(2);
  });
});

/* ------------------------------------------------------------------ *
 * 5. A falha — e a regra de nunca apagar antes da resposta
 * ------------------------------------------------------------------ */

describe("quando a fusão falha", () => {
  beforeEach(() => {
    dados.set(CHAVE_DA_SACOLA, JSON.stringify([item({ quantity: 2 })]));
  });

  it("a sacola local continua inteira no localStorage", async () => {
    cenario.erroDaRpc = { code: "42501", message: "não é cliente desta loja" };

    const resultado = await fundirSacola();

    expect(resultado).toEqual({ situacao: "falhou", codigo: "42501" });
    expect(JSON.parse(dados.get(CHAVE_DA_SACOLA)!)).toHaveLength(1);
    expect(JSON.parse(dados.get(CHAVE_DA_SACOLA)!)[0].quantity).toBe(2);
  });

  it("a falha é tentada de novo no evento seguinte", async () => {
    cenario.erroDaRpc = { code: "PGRST202", message: "função não encontrada" };
    await fundirSacola();

    cenario.erroDaRpc = null;
    cenario.itensDaConta = [
      { produto_id: UUID_A, quantidade: 2, preco: 39.9, nome: "x", imagem: "", tamanho: "", moagem: null },
    ];
    const segunda = await fundirSacola();

    expect(falso.rpc).toHaveBeenCalledTimes(2);
    expect(segunda.situacao).toBe("fundida");
  });

  it("registra o código da recusa em vez de sumir com ela", async () => {
    cenario.erroDaRpc = { code: "42501", message: "recusado", hint: "sem cadastro" };
    await fundirSacola();
    expect(erros).toHaveBeenCalledWith(
      expect.stringContaining("42501"),
      expect.anything(),
    );
  });

  /**
   * A releitura é o lugar natural de carimbar a sacola, e por isso a fusão SEM
   * releitura precisa carimbar também: senão existe um estado "já fundida e sem
   * selo", e nele perder a base volta a significar fundir tudo de novo.
   */
  it("fusão sem releitura carimba a sacola: perder a base depois não dobra", async () => {
    cenario.erroDaLeitura = { code: "PGRST301", message: "sem rede" };

    await fundirSacola();
    expect(falso.rpc).toHaveBeenCalledTimes(1);
    expect(JSON.parse(dados.get(CHAVE_DA_SACOLA)!)[0].selo).toBeTruthy();

    // A base some depois, por qualquer motivo.
    dados.delete("cart:na_conta");
    cenario.erroDaLeitura = null;
    cenario.itensDaConta = [
      { produto_id: UUID_A, quantidade: 2, preco: 39.9, nome: "x", imagem: "", tamanho: "", moagem: null },
    ];
    reiniciarFusao();

    const segunda = await fundirSacola();

    expect(falso.rpc).toHaveBeenCalledTimes(1);
    expect(segunda.situacao === "fundida" && segunda.itens[0]?.quantity).toBe(2);
  });

  /**
   * O caso perigoso: a RPC GRAVOU e a releitura caiu. Apagar a sacola local
   * esvaziaria a tela; deixá-la candidata a fusão dobraria a conta na próxima
   * carga. A saída é gravar a base assim mesmo — sabemos o que mandamos.
   */
  it("RPC bem-sucedida com releitura falha não funde de novo depois", async () => {
    cenario.erroDaLeitura = { code: "PGRST301", message: "sem rede" };

    const primeira = await fundirSacola();
    expect(primeira.situacao).toBe("fundida");
    // A sacola visível não foi esvaziada.
    expect(JSON.parse(dados.get(CHAVE_DA_SACOLA)!)).toHaveLength(1);

    reiniciarFusao();
    const segunda = await fundirSacola();

    expect(falso.rpc).toHaveBeenCalledTimes(1);
    expect(segunda.situacao).toBe("semNovidade");
  });
});

/* ------------------------------------------------------------------ *
 * 6. Duas abas
 * ------------------------------------------------------------------ */

describe("duas abas entrando ao mesmo tempo", () => {
  it("a aba que chega com a fusão em curso adia em vez de somar de novo", async () => {
    dados.set(CHAVE_DA_SACOLA, JSON.stringify([item({ quantity: 2 })]));
    // A marca que a outra aba deixou ao começar a fundir, agora mesmo.
    dados.set("cart:fundindo", String(Date.now()));

    const resultado = await fundirSacola();

    expect(resultado.situacao).toBe("adiada");
    expect(falso.rpc).not.toHaveBeenCalled();
    // E nada foi perdido: a sacola continua lá para a próxima tentativa.
    expect(JSON.parse(dados.get(CHAVE_DA_SACOLA)!)).toHaveLength(1);
  });

  it("marca velha de uma aba que morreu no meio não bloqueia para sempre", async () => {
    dados.set(CHAVE_DA_SACOLA, JSON.stringify([item({ quantity: 2 })]));
    dados.set("cart:fundindo", String(Date.now() - 60_000));

    const resultado = await fundirSacola();

    expect(resultado.situacao).toBe("fundida");
    expect(falso.rpc).toHaveBeenCalledTimes(1);
  });

  /**
   * ADIAR NÃO PODE VIRAR DESISTIR. Se a trava de memória continuasse presa
   * depois de um `adiada`, esta aba não tentaria mais nada até a próxima carga
   * de página — e uma fusão que não acontece em silêncio é a classe de falha que
   * este módulo existe para eliminar. Note que NÃO há `reiniciarFusao()` entre
   * as duas chamadas: é justamente isso que o caso afirma.
   */
  it("adiar para outra aba não impede a tentativa seguinte", async () => {
    dados.set(CHAVE_DA_SACOLA, JSON.stringify([item({ quantity: 2 })]));
    dados.set("cart:fundindo", String(Date.now()));

    expect((await fundirSacola()).situacao).toBe("adiada");

    // A outra aba terminou e soltou a marca.
    dados.delete("cart:fundindo");
    const segunda = await fundirSacola();

    expect(segunda.situacao).toBe("fundida");
    expect(falso.rpc).toHaveBeenCalledTimes(1);
  });

  it("a marca é solta ao terminar, para a próxima fusão não ficar presa", async () => {
    dados.set(CHAVE_DA_SACOLA, JSON.stringify([item({ quantity: 2 })]));
    await fundirSacola();
    expect(dados.get("cart:fundindo")).toBeUndefined();
  });
});

/* ------------------------------------------------------------------ *
 * A sacola gravada ANTES de a moagem virar dois valores
 * ------------------------------------------------------------------ */

/**
 * O PIOR BUG POSSÍVEL AQUI É A SACOLA SUMIR NO LOGIN, e esta é a única mudança
 * do catálogo capaz de causá-lo.
 *
 * Até a separação de `Moagem` e `Metodo`, a PDP gravava no item o rótulo do
 * MÉTODO escolhido — "Espresso", "Aeropress", "Coado (papel)" —, e o `cart` de
 * quem montou a sacola antes da mudança ainda carrega esses rótulos. Eles não
 * existem mais no contrato.
 *
 * O que este bloco fixa é o desfecho: o item vira "Moído", que é o que ele
 * SEMPRE FOI de verdade (os seis métodos eram o mesmo SKU, o mesmo preço e o
 * mesmo estoque), continua na sacola e não derruba a fusão. Nenhum centavo e
 * nenhuma unidade mudam de mão — só o rótulo passa a dizer a verdade.
 */
describe("sacola de antes da mudança de moagem", () => {
  it.each([
    ["Espresso"],
    ["Aeropress"],
    ["Coado (papel)"],
    ["Prensa francesa"],
    ["Italiana / Moka"],
    ["Coador de pano"],
    // Os VALORES do contrato antigo, e não só os rótulos: o painel legado
    // grava nesta mesma chave e a sacola pode ter vindo dele.
    ["aeropress"],
    ["espresso"],
    // Coisa que nunca esteve no contrato. Por eliminação é moído: se fosse
    // grão, diria grão. Sumir com o item por causa do rótulo seria pior.
    ["turbo"],
  ])("item com moagem %s funde como Moído, e NÃO some", (antiga) => {
    const [limpo] = limparItens([item({ moagem: antiga })]);

    expect(limpo, `a sacola perdeu o item de moagem "${antiga}"`).toBeDefined();
    expect(limpo.product_id).toBe(UUID_A);
    expect(limpo.quantity).toBe(2);
    expect(limpo.moagem).toBe("Moído");
  });

  it.each([["Grão"], ["grao"], ["grão"], ["Em grãos"]])(
    "%s continua grão — a moagem que existe não é reescrita",
    (grao) => {
      expect(limparItens([item({ moagem: grao })])[0]?.moagem).toBe("Grão");
    },
  );

  it("item sem moagem continua sem moagem — nada é inventado", () => {
    expect(limparItens([item()])[0]).not.toHaveProperty("moagem");
  });

  it("dois métodos do MESMO pacote viram uma linha só, com a soma", () => {
    // "Espresso 2" e "Aeropress 3" do mesmo SKU eram, no estoque, cinco
    // pacotes moídos. Sem a normalização eles seguiriam como duas chaves
    // diferentes em `chaveDoItem` e o cliente veria duas linhas idênticas.
    const local = limparItens([
      item({ moagem: "Espresso", quantity: 2 }),
      item({ moagem: "Aeropress", quantity: 3 }),
    ]);

    const somada = somarSacolas(local, []);
    expect(somada).toHaveLength(1);
    expect(somada[0].moagem).toBe("Moído");
    expect(somada[0].quantity).toBe(5);
  });

  it("a fusão inteira roda: o item vai para a RPC já como Moído", async () => {
    dados.set(
      CHAVE_DA_SACOLA,
      JSON.stringify([item({ moagem: "Aeropress", quantity: 2 })]),
    );
    cenario.itensDaConta = [];

    const resultado = await fundirSacola();

    expect(resultado.situacao).toBe("fundida");
    expect(cenario.chamadas).toHaveLength(1);
    expect(
      (cenario.chamadas[0]?.argumentos as { itens: { moagem: string }[] }).itens,
    ).toEqual([expect.objectContaining({ produto_id: UUID_A, moagem: "Moído" })]);
  });

  /**
   * A CONTA TAMBÉM TEM O RÓTULO VELHO. `canastra.carrinho_itens` guarda o que
   * a fusão de antes mandou, e nesta fase nada apaga linha de lá — a releitura
   * traz "Espresso" de volta. Se a volta não fosse normalizada junto, a sacola
   * relida voltaria a divergir da local e a próxima carga de página acharia
   * pendência onde não há.
   */
  it("a sacola relida da conta volta normalizada, sem duplicar a linha", async () => {
    dados.set(CHAVE_DA_SACOLA, "[]");
    cenario.itensDaConta = [
      {
        produto_id: UUID_A,
        quantidade: 2,
        preco: 39.9,
        nome: "Canastra Tradicional",
        imagem: "/cafe.jpg",
        tamanho: "Pacote com 250 g",
        moagem: "Espresso",
      },
      {
        produto_id: UUID_A,
        quantidade: 3,
        preco: 39.9,
        nome: "Canastra Tradicional",
        imagem: "/cafe.jpg",
        tamanho: "Pacote com 250 g",
        moagem: "Aeropress",
      },
    ];

    const resultado = await fundirSacola();

    expect(resultado.situacao).toBe("fundida");
    const itens = resultado.situacao === "fundida" ? resultado.itens : [];
    expect(itens).toHaveLength(1);
    expect(itens[0]?.moagem).toBe("Moído");
    expect(itens[0]?.quantity).toBe(5);

    // E a visita seguinte não acha pendência nenhuma: é o que prova que os
    // dois lados falam a mesma língua depois da normalização.
    reiniciarFusao();
    expect((await fundirSacola()).situacao).toBe("semNovidade");
    expect(falso.rpc).not.toHaveBeenCalled();
  });
});

describe("as verificações de compilação existem e nunca rodam", () => {
  it("continua referenciada para não parecer código morto", () => {
    expect(typeof verificacoesDeCompilacao).toBe("function");
  });
});
