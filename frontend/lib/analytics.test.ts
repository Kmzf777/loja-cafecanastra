import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  CHAVE_CONSENTIMENTO,
  EVENTO_CONSENTIMENTO,
  eventoAddToCart,
  eventoBeginCheckout,
  eventoPurchase,
  gravarConsentimento,
  lerConsentimento,
  paraItemGa4,
  revogarConsentimento,
  type ItemAnalytics,
} from "./analytics";

/**
 * Dublê de `window` para o ambiente node: os helpers só podem falar com o
 * navegador por `window.gtag`, `window.localStorage` e `window.dispatchEvent`,
 * então o teste fornece exatamente esses três e nada mais.
 */

type Dube = {
  gtag?: ReturnType<typeof vi.fn>;
  localStorage?: {
    getItem: (c: string) => string | null;
    setItem: (c: string, v: string) => void;
    removeItem?: (c: string) => void;
  };
  dispatchEvent?: ReturnType<typeof vi.fn>;
};

const global_ = globalThis as unknown as { window?: Dube; Event?: unknown };

function armarJanela(dube: Dube) {
  global_.window = dube;
}

beforeEach(() => {
  // `Event` existe em node >= 15; garante para o dispatchEvent do gravar.
  expect(typeof Event).toBe("function");
});

afterEach(() => {
  delete global_.window;
});

function memoria(): NonNullable<Dube["localStorage"]> & {
  dados: Record<string, string>;
} {
  const dados: Record<string, string> = {};
  return {
    dados,
    getItem: (c) => (c in dados ? dados[c] : null),
    setItem: (c, v) => {
      dados[c] = v;
    },
    removeItem: (c) => {
      delete dados[c];
    },
  };
}

const ITEM: ItemAnalytics = {
  id: "classico-250",
  nome: "Canastra Clássico — Pacote com 250 g",
  precoCentavos: 3970,
  quantidade: 2,
  variante: "Espresso",
};

describe("consentimento", () => {
  it("sem janela (SSR) le nulo e gravar nao explode", () => {
    expect(lerConsentimento()).toBeNull();
    expect(() => gravarConsentimento("aceito")).not.toThrow();
  });

  it("primeira visita e nulo; valor estranho tambem", () => {
    const ls = memoria();
    armarJanela({ localStorage: ls });
    expect(lerConsentimento()).toBeNull();
    ls.dados[CHAVE_CONSENTIMENTO] = "qualquer-coisa";
    expect(lerConsentimento()).toBeNull();
  });

  it("grava, le de volta e anuncia a troca", () => {
    const ls = memoria();
    const dispatchEvent = vi.fn();
    armarJanela({ localStorage: ls, dispatchEvent });

    gravarConsentimento("aceito");
    expect(ls.dados[CHAVE_CONSENTIMENTO]).toBe("aceito");
    expect(lerConsentimento()).toBe("aceito");
    expect(dispatchEvent).toHaveBeenCalledTimes(1);
    expect((dispatchEvent.mock.calls[0][0] as Event).type).toBe(
      EVENTO_CONSENTIMENTO,
    );

    gravarConsentimento("essencial");
    expect(lerConsentimento()).toBe("essencial");
  });

  it("revogar apaga a escolha, derruba o gtag e anuncia", () => {
    const ls = memoria();
    const dispatchEvent = vi.fn();
    const gtag = vi.fn();
    const dube: Dube = { localStorage: ls, dispatchEvent, gtag };
    armarJanela(dube);

    gravarConsentimento("aceito");
    expect(lerConsentimento()).toBe("aceito");

    revogarConsentimento();
    // Volta ao estado de primeira visita: o banner reaparece.
    expect(lerConsentimento()).toBeNull();
    expect(CHAVE_CONSENTIMENTO in ls.dados).toBe(false);
    // O gtag ja carregado nao descarrega, mas morre como funcao: os eventos de
    // comercio viram no-op no instante da revogacao.
    expect(dube.gtag).toBeUndefined();
    expect(() => eventoAddToCart(ITEM)).not.toThrow();
    expect(gtag).not.toHaveBeenCalled();
    // Um evento do gravar, outro do revogar.
    expect(dispatchEvent).toHaveBeenCalledTimes(2);
    expect((dispatchEvent.mock.calls[1][0] as Event).type).toBe(
      EVENTO_CONSENTIMENTO,
    );
  });

  it("revogar sem janela (SSR) nao explode", () => {
    expect(() => revogarConsentimento()).not.toThrow();
  });

  it("localStorage que lanca (modo privado) nao derruba a pagina", () => {
    armarJanela({
      localStorage: {
        getItem: () => {
          throw new Error("cota");
        },
        setItem: () => {
          throw new Error("cota");
        },
      },
      dispatchEvent: vi.fn(),
    });
    expect(lerConsentimento()).toBeNull();
    expect(() => gravarConsentimento("aceito")).not.toThrow();
  });
});

describe("paraItemGa4", () => {
  it("converte centavos para decimal e traduz os campos", () => {
    expect(paraItemGa4(ITEM)).toEqual({
      item_id: "classico-250",
      item_name: "Canastra Clássico — Pacote com 250 g",
      price: 39.7,
      quantity: 2,
      item_variant: "Espresso",
    });
  });

  it("omite item_variant quando nao ha variacao", () => {
    const semVariante = paraItemGa4({ ...ITEM, variante: undefined });
    expect("item_variant" in semVariante).toBe(false);
  });
});

describe("eventos GA4", () => {
  it("sem window.gtag nenhum evento explode nem dispara nada", () => {
    armarJanela({});
    expect(() => eventoAddToCart(ITEM)).not.toThrow();
    expect(() => eventoBeginCheckout([ITEM])).not.toThrow();
    expect(() =>
      eventoPurchase({ idTransacao: "p1", valorCentavos: 7940, itens: [ITEM] }),
    ).not.toThrow();
  });

  it("add_to_cart multiplica preco por quantidade no value", () => {
    const gtag = vi.fn();
    armarJanela({ gtag });
    eventoAddToCart(ITEM);
    expect(gtag).toHaveBeenCalledWith("event", "add_to_cart", {
      currency: "BRL",
      value: 79.4,
      items: [paraItemGa4(ITEM)],
    });
  });

  it("begin_checkout soma a sacola inteira", () => {
    const gtag = vi.fn();
    armarJanela({ gtag });
    const outro: ItemAnalytics = {
      id: "suave-500",
      nome: "Canastra Suave — Pacote com 500 g",
      precoCentavos: 6470,
      quantidade: 1,
    };
    eventoBeginCheckout([ITEM, outro]);
    const [, nome, params] = gtag.mock.calls[0];
    expect(nome).toBe("begin_checkout");
    expect(params).toMatchObject({ currency: "BRL", value: 144.1 });
    expect((params as { items: unknown[] }).items).toHaveLength(2);
  });

  it("purchase carrega transaction_id e frete quando informado", () => {
    const gtag = vi.fn();
    armarJanela({ gtag });
    eventoPurchase({
      idTransacao: "pedido-123",
      valorCentavos: 14900,
      freteCentavos: 0,
      itens: [ITEM],
    });
    expect(gtag).toHaveBeenCalledWith("event", "purchase", {
      transaction_id: "pedido-123",
      currency: "BRL",
      value: 149,
      shipping: 0,
      items: [paraItemGa4(ITEM)],
    });
  });
});
