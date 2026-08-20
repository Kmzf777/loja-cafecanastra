import { beforeEach, describe, expect, it, vi } from "vitest";
import { _zerarIdempotencia } from "./idempotencia";
import { cotarFrete, pagarComCartao, pagarComPix } from "./checkout";
import type { ItemDaSacola } from "./sacola";
import type { DadosDoCartao } from "./cartao";

/**
 * O CONTRATO do process_payment, fixado: é o corpo que o PaymentController
 * repassa ao Mercado Pago (token/installments/issuer) e grava no pedido. Uma
 * mudança de nome de campo aqui não daria erro em lugar nenhum — o backend
 * ignoraria o campo novo e cobraria sem ele — então o teste é o único lugar
 * onde a divergência fica vermelha.
 */

beforeEach(() => _zerarIdempotencia());

const itens: ItemDaSacola[] = [
  {
    product_id: "a1",
    name: "Clássico — Pacote com 250 g",
    price: 39.7,
    quantity: 2,
    image: "/classico.png",
    size: "Pacote com 250 g",
    sku: "classico-graos-250",
  },
];

const endereco = {
  zip_code: "37928-000",
  street: "Rua A",
  number: "1",
  neighborhood: "Centro",
  city: "São Roque de Minas",
  state: "MG",
};

const frete = { id: 3, name: "Correios SEDEX", price: 22.5, days: 2 };

const dadosBase = {
  itens,
  email: "cliente@exemplo.com",
  cpf: "52998224725",
  endereco,
  frete,
};

const cartao: DadosDoCartao = {
  token: "tok_abc",
  paymentMethodId: "visa",
  issuerId: "24",
  installments: "3",
  identificationNumber: "52998224725",
  identificationType: "CPF",
  amount: "101.90",
};

function fetchComResposta(corpo: unknown, ok = true) {
  return vi.fn().mockResolvedValue({
    ok,
    json: async () => corpo,
  }) as unknown as typeof fetch & ReturnType<typeof vi.fn>;
}

const RESPOSTA_OK = { status: "pendente", orderId: "abc-123", ticketUrl: "https://mp/x" };

function corpoEnviado(f: ReturnType<typeof vi.fn>, chamada = 0) {
  return JSON.parse((f.mock.calls[chamada][1] as RequestInit).body as string);
}

function headersEnviados(f: ReturnType<typeof vi.fn>, chamada = 0) {
  return (f.mock.calls[chamada][1] as RequestInit).headers as Record<string, string>;
}

describe("pagarComPix", () => {
  it("monta o corpo do contrato: pix, CPF no payer, itens sem preço, frete escolhido", async () => {
    const f = fetchComResposta(RESPOSTA_OK);
    const resposta = await pagarComPix("tok-sessao", dadosBase, f);

    expect(resposta).toEqual(RESPOSTA_OK);
    expect(String(f.mock.calls[0][0]).endsWith("/checkout/process_payment")).toBe(true);

    const corpo = corpoEnviado(f);
    expect(corpo.formData.paymentMethodId).toBe("pix");
    expect(corpo.formData.payer).toEqual({
      email: "cliente@exemplo.com",
      identification: { type: "CPF", number: "52998224725" },
    });
    expect(corpo.paymentMethodType).toBe("pix");
    // Itens SEM preço: o servidor relê do banco — mandar preço não teria
    // efeito e sugeriria que tem.
    expect(corpo.items).toEqual([
      { product_id: "a1", quantity: 2, name: "Clássico — Pacote com 250 g" },
    ]);
    expect(corpo.shippingCost).toBe(22.5);
    expect(corpo.shippingMethod).toBe("Correios SEDEX");
    expect(corpo.address).toEqual(endereco);
    expect(corpo).not.toHaveProperty("cupom");

    const headers = headersEnviados(f);
    expect(headers.Authorization).toBe("Bearer tok-sessao");
    expect(headers["Idempotency-Key"]).toMatch(/^[0-9a-f-]{36}$/i);
  });

  it("manda o CÓDIGO do cupom quando aplicado — o desconto é conta do servidor", async () => {
    const f = fetchComResposta(RESPOSTA_OK);
    await pagarComPix("t", { ...dadosBase, cupom: "SERRA10" }, f);
    expect(corpoEnviado(f).cupom).toBe("SERRA10");
  });

  it("reusa a MESMA Idempotency-Key entre tentativas do mesmo pedido", async () => {
    const f = fetchComResposta(RESPOSTA_OK);
    await pagarComPix("t", dadosBase, f);
    await pagarComPix("t", dadosBase, f);
    expect(headersEnviados(f, 0)["Idempotency-Key"]).toBe(
      headersEnviados(f, 1)["Idempotency-Key"],
    );
  });

  it("troca a chave quando o pedido muda (frete diferente = outro pedido)", async () => {
    const f = fetchComResposta(RESPOSTA_OK);
    await pagarComPix("t", dadosBase, f);
    await pagarComPix("t", { ...dadosBase, frete: { ...frete, id: 9, name: "PAC", price: 15 } }, f);
    expect(headersEnviados(f, 0)["Idempotency-Key"]).not.toBe(
      headersEnviados(f, 1)["Idempotency-Key"],
    );
  });

  it("erro: prefere details, cai para error, e tem frase própria sem os dois", async () => {
    await expect(
      pagarComPix("t", dadosBase, fetchComResposta({ details: "Estoque insuficiente", error: "X" }, false)),
    ).rejects.toThrow("Estoque insuficiente");
    _zerarIdempotencia();
    await expect(
      pagarComPix("t", dadosBase, fetchComResposta({ error: "Falha no pagamento" }, false)),
    ).rejects.toThrow("Falha no pagamento");
    _zerarIdempotencia();
    await expect(
      pagarComPix("t", dadosBase, fetchComResposta({}, false)),
    ).rejects.toThrow(/Pix/);
  });

  it("200 sem orderId é erro, não sucesso — a tela não tem o que renderizar", async () => {
    await expect(
      pagarComPix("t", dadosBase, fetchComResposta({})),
    ).rejects.toThrow(/pedido/i);
    _zerarIdempotencia();
    await expect(
      pagarComPix("t", dadosBase, fetchComResposta({ status: "aprovado", orderId: "" })),
    ).rejects.toThrow(/pedido/i);
  });
});

describe("pagarComCartao", () => {
  it("monta o formData que o backend repassa: token, bandeira, emissor, parcelas e valor NUMÉRICOS", async () => {
    const f = fetchComResposta({ status: "aprovado", orderId: "abc-123" });
    await pagarComCartao("t", { ...dadosBase, cartao }, f);

    const corpo = corpoEnviado(f);
    expect(corpo.formData.token).toBe("tok_abc");
    expect(corpo.formData.payment_method_id).toBe("visa");
    expect(corpo.formData.issuer_id).toBe("24");
    // O SDK devolve strings ("3", "101.90"); o gateway quer números.
    expect(corpo.formData.installments).toBe(3);
    expect(corpo.formData.transaction_amount).toBe(101.9);
    expect(corpo.formData.payer.identification).toEqual({
      type: "CPF",
      number: "52998224725",
    });
    expect(corpo.paymentMethodType).toBe("credit_card");
  });

  it("parcelas vazias caem para 1x, nunca NaN", async () => {
    const f = fetchComResposta({ status: "aprovado", orderId: "abc-123" });
    await pagarComCartao("t", { ...dadosBase, cartao: { ...cartao, installments: "" } }, f);
    expect(corpoEnviado(f).formData.installments).toBe(1);
  });

  it("pix e cartão com o MESMO pedido compartilham a chave — trocar o meio não é outro pedido", async () => {
    const f = fetchComResposta(RESPOSTA_OK);
    await pagarComPix("t", dadosBase, f);
    await pagarComCartao("t", { ...dadosBase, cartao }, f);
    expect(headersEnviados(f, 0)["Idempotency-Key"]).toBe(
      headersEnviados(f, 1)["Idempotency-Key"],
    );
  });
});

describe("cotarFrete", () => {
  it("manda itens com preço (sugestão da cotação) e o cupom quando houver", async () => {
    const f = fetchComResposta([{ id: 1, name: "SEDEX", price: 20, days: 2 }]);
    await cotarFrete("37928-000", itens, "SERRA10", f);
    const corpo = corpoEnviado(f);
    expect(String(f.mock.calls[0][0]).endsWith("/shipping/calculate")).toBe(true);
    expect(corpo.items).toEqual([{ product_id: "a1", quantity: 2, price: 39.7 }]);
    expect(corpo.cupom).toBe("SERRA10");
  });

  it("sem cupom o campo nem viaja", async () => {
    const f = fetchComResposta([]);
    await cotarFrete("37928-000", itens, undefined, f);
    expect(corpoEnviado(f)).not.toHaveProperty("cupom");
  });
});
