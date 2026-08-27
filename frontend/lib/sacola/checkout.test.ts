import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { _zerarIdempotencia } from "./idempotencia";
import {
  buscarPrecosAtuais,
  cotarFrete,
  pagarComCartao,
  pagarComPix,
  subtotalDosItensCentavos,
  subtotalPromocionalCentavos,
  CODIGO_PRECO_MUDOU,
  ErroDoPagamento,
} from "./checkout";
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
    // O subtotal EXIBIDO, em centavos, dos itens e só deles: 2 × R$ 39,70.
    // Não é preço de item (que o servidor ignora): é a declaração que o
    // servidor CONFERE antes de cobrar — divergiu, 409 em vez de cobrança.
    expect(corpo.subtotalCentavos).toBe(7940);

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
    // O cartão é o caso PIOR do preço divergente: o CardForm é montado com o
    // total da tela (`transaction_amount`) e quem cobra é o servidor. Por isso
    // a declaração do subtotal viaja nos dois meios, não só no Pix.
    expect(corpo.subtotalCentavos).toBe(7940);
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

/**
 * Defeito 3 — o total exibido podia diferir do cobrado. A sacola guarda `price`
 * no localStorage e nunca o revalida; o servidor cobra o preço do banco. O
 * corpo agora DECLARA o subtotal exibido e o servidor confere (409 na
 * divergência), e este é o lado do navegador desse contrato.
 */
describe("subtotal declarado", () => {
  it("soma item a item em centavos — nada de arredondar o total no fim", () => {
    // 3 × 19,99 = 59,97. Somar em reais e arredondar depois passaria por
    // 59.970000000000006; a fronteira de um centavo é o que decide 409 ou não.
    expect(
      subtotalDosItensCentavos([
        { ...itens[0], price: 19.99, quantity: 3 },
      ]),
    ).toBe(5997);
    expect(subtotalDosItensCentavos([])).toBe(0);
  });

  it("é o mesmo número que a sacola exibe — inclui todos os itens, sem frete", async () => {
    const f = fetchComResposta(RESPOSTA_OK);
    const doisItens = [
      itens[0],
      { ...itens[0], product_id: "b2", price: 10.5, quantity: 1 },
    ];
    await pagarComPix("t", { ...dadosBase, itens: doisItens }, f);
    // 7940 + 1050 — e o frete de R$ 22,50 fica de fora: ele tem conferência
    // própria (`conferirFrete`), com tolerância de centavo que o preço não tem.
    expect(corpoEnviado(f).subtotalCentavos).toBe(8990);
  });

  it("preço diferente NÃO troca a chave de idempotência — é o mesmo pedido", async () => {
    const f = fetchComResposta(RESPOSTA_OK);
    await pagarComPix("t", dadosBase, f);
    await pagarComPix(
      "t",
      { ...dadosBase, itens: [{ ...itens[0], price: 44.9 }] },
      f,
    );
    // Corrigir o preço depois de um 409 é a MESMA tentativa: mesmos cafés, mesma
    // quantidade, mesmo CEP. Chave nova aqui seria o caminho para a segunda
    // cobrança se a primeira resposta se perdesse — e o 409 não chega a criar
    // pedido, então repetir a chave é seguro por construção.
    expect(headersEnviados(f, 0)["Idempotency-Key"]).toBe(
      headersEnviados(f, 1)["Idempotency-Key"],
    );
  });

  it("A PROMOÇÃO NÃO ENTRA EM `subtotalCentavos` — a mina da §5.1", async () => {
    const f = fetchComResposta(RESPOSTA_OK);
    await pagarComPix(
      "t",
      {
        ...dadosBase,
        itens: [{ ...itens[0], precoPromocionalCentavos: 3573 }],
      },
      f,
    );
    // 2 × R$ 39,70 de CATÁLOGO. Se a promoção entrasse aqui, o servidor —
    // que compara contra o catálogo com tolerância zero — recusaria com 409
    // `PRECO_MUDOU` TODA venda com campanha ativa.
    expect(corpoEnviado(f).subtotalCentavos).toBe(7940);
  });

  it("o promocional viaja em campo PRÓPRIO, e só quando existe", async () => {
    const semPromocao = fetchComResposta(RESPOSTA_OK);
    await pagarComPix("t", dadosBase, semPromocao);
    // Sem campanha o campo seria uma cópia de `subtotalCentavos` — um segundo
    // número dizendo a mesma coisa e uma segunda chance de recusar um pedido
    // correto.
    expect(corpoEnviado(semPromocao)).not.toHaveProperty(
      "subtotalPromocionalCentavos",
    );

    const comPromocao = fetchComResposta(RESPOSTA_OK);
    await pagarComPix(
      "t",
      {
        ...dadosBase,
        itens: [{ ...itens[0], precoPromocionalCentavos: 3573 }],
      },
      comPromocao,
    );
    expect(corpoEnviado(comPromocao).subtotalPromocionalCentavos).toBe(7146);
  });

  it("item sem campanha entra no promocional pelo preço de catálogo", () => {
    expect(
      subtotalPromocionalCentavos([
        { ...itens[0], precoPromocionalCentavos: 3573 },
        { ...itens[0], product_id: "b2", price: 10.5, quantity: 1 },
      ]),
    ).toBe(7146 + 1050);
  });

  it("sem promoção nenhuma os dois subtotais são o MESMO número", () => {
    expect(subtotalPromocionalCentavos(itens)).toBe(
      subtotalDosItensCentavos(itens),
    );
    expect(subtotalPromocionalCentavos([])).toBe(0);
  });

  it("A PROMOÇÃO NÃO TROCA A CHAVE DE IDEMPOTÊNCIA — e isso vale dinheiro", async () => {
    const f = fetchComResposta(RESPOSTA_OK);
    await pagarComPix("t", dadosBase, f);
    await pagarComPix(
      "t",
      {
        ...dadosBase,
        itens: [{ ...itens[0], precoPromocionalCentavos: 3573 }],
      },
      f,
    );
    // Mesmos cafés, mesma quantidade, mesmo CEP: é a MESMA tentativa. Chave
    // nova numa retentativa é exatamente o que cobra duas vezes quando a
    // primeira resposta se perde na rede.
    expect(headersEnviados(f, 0)["Idempotency-Key"]).toBe(
      headersEnviados(f, 1)["Idempotency-Key"],
    );
  });

  it("o 409 de preço chega com o CÓDIGO, não só com a frase", async () => {
    const f = fetchComResposta(
      {
        error: CODIGO_PRECO_MUDOU,
        details: "O preço de um item mudou desde que você abriu a sacola — confira o resumo.",
      },
      false,
    );
    await expect(pagarComPix("t", dadosBase, f)).rejects.toMatchObject({
      // A frase é a do servidor (details continua tendo precedência)...
      message: /preço de um item mudou/,
      // ...e o código sobrevive, que é o que deixa a tela RECARREGAR os preços
      // em vez de só exibir o texto. Um 409 de frete pede outra ação.
      codigo: CODIGO_PRECO_MUDOU,
    });
  });

  it("erro sem código conhecido continua sendo um Error com a mesma mensagem", async () => {
    const erro = await pagarComPix(
      "t",
      dadosBase,
      fetchComResposta({ details: "Estoque insuficiente" }, false),
    ).catch((e) => e);
    expect(erro).toBeInstanceOf(Error);
    expect(erro).toBeInstanceOf(ErroDoPagamento);
    expect(erro.message).toBe("Estoque insuficiente");
    expect(erro.codigo).toBeUndefined();
  });
});

describe("buscarPrecosAtuais", () => {
  it("relê da MESMA fonte da vitrine e devolve só o que está na sacola", async () => {
    const f = fetchComResposta({
      products: [
        { product_id: "a1", price: "44.90" },
        { product_id: "zzz", price: "1.00" },
      ],
    });
    const precos = await buscarPrecosAtuais(itens, f);

    expect(String(f.mock.calls[0][0])).toContain("/dashboard?limit=200");
    expect(precos.get("a1")).toEqual({ precoReais: 44.9 });
    // Catálogo inteiro na resposta, sacola pequena: o resto não interessa.
    expect(precos.has("zzz")).toBe(false);
  });

  it("relê a PROMOÇÃO junto, e é ela que quebra o segundo laço de 409", async () => {
    const f = fetchComResposta({
      products: [{ product_id: "a1", price: "44.90", promotional_price: "40.41" }],
    });
    expect((await buscarPrecosAtuais(itens, f)).get("a1")).toEqual({
      precoReais: 44.9,
      precoPromocionalCentavos: 4041,
    });
  });

  it("promoção que EXPIROU volta ausente — a tela precisa poder apagá-la", async () => {
    // Sem este caso, uma campanha encerrada entre montar a sacola e pagar
    // ficaria colada no item e a declaração `subtotalPromocionalCentavos`
    // sairia com um desconto que o servidor já não pratica.
    const f = fetchComResposta({
      products: [{ product_id: "a1", price: "44.90", promotional_price: null }],
    });
    expect((await buscarPrecosAtuais(itens, f)).get("a1")).toEqual({
      precoReais: 44.9,
    });
  });

  it("promocional que não desconta é descartado como qualquer dado torto", async () => {
    const f = fetchComResposta({
      products: [{ product_id: "a1", price: "44.90", promotional_price: "50.00" }],
    });
    expect(
      (await buscarPrecosAtuais(itens, f)).get("a1"),
    ).toEqual({ precoReais: 44.9 });
  });

  it("preço torto é descartado, e resposta ruim LANÇA em vez de mentir", async () => {
    const f = fetchComResposta({
      products: [
        { product_id: "a1", price: "abc" },
        { product_id: "a1x", price: -5 },
      ],
    });
    expect((await buscarPrecosAtuais(itens, f)).size).toBe(0);

    // Sem conseguir reler, quem chama precisa SABER: a tela manda recarregar a
    // página em vez de exibir um total que não conferiu.
    await expect(
      buscarPrecosAtuais(itens, fetchComResposta({}, false)),
    ).rejects.toThrow(/preços/i);
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

describe("device id do Mercado Pago", () => {
  // Ambiente node (vitest.config.ts): não há `window` global de verdade, então
  // o teste dubla exatamente o mesmo jeito de lib/analytics.test.ts — planta
  // `globalThis.window` para o `typeof window` de deviceIdDoNavegador() achar
  // objeto em vez de "undefined", e desfaz depois para não vazar entre testes.
  const global_ = globalThis as unknown as {
    window?: { MP_DEVICE_SESSION_ID?: string };
  };

  afterEach(() => {
    delete global_.window;
  });

  it("manda o deviceId no corpo quando o security.js populou a sessão", async () => {
    global_.window = { MP_DEVICE_SESSION_ID: "dev-sessao-123" };
    const f = fetchComResposta(RESPOSTA_OK);
    await pagarComPix("tok-sessao", dadosBase, f);
    expect(corpoEnviado(f).deviceId).toBe("dev-sessao-123");
  });

  it("sem security.js o corpo não traz deviceId, e o pagamento segue", async () => {
    // Bloqueador de script é cenário real. Perder a venda por causa do
    // fingerprint seria trocar aprovação por conversão.
    const f = fetchComResposta(RESPOSTA_OK);
    await pagarComPix("tok-sessao", dadosBase, f);
    expect(corpoEnviado(f)).not.toHaveProperty("deviceId");
  });

  // corpoComum é compartilhado entre os dois meios — mas ninguém prova isso
  // sem exercitar o cartão também. O Pix passando não garante o cartão.
  it("também manda o deviceId no cartão — corpoComum é dos dois meios", async () => {
    global_.window = { MP_DEVICE_SESSION_ID: "dev-sessao-123" };
    const f = fetchComResposta({ status: "aprovado", orderId: "abc-123" });
    await pagarComCartao("t", { ...dadosBase, cartao }, f);
    expect(corpoEnviado(f).deviceId).toBe("dev-sessao-123");
  });
});
