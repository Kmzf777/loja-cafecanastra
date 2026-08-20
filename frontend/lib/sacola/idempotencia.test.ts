import { beforeEach, describe, expect, it } from "vitest";
import {
  _zerarIdempotencia,
  assinaturaDoPedido,
  chaveDeIdempotencia,
  descartarChave,
} from "./idempotencia";

beforeEach(() => _zerarIdempotencia());

const pedido = {
  itens: [
    { product_id: "b2", quantity: 1 },
    { product_id: "a1", quantity: 2 },
  ],
  freteId: 3,
  freteNome: "Correios SEDEX",
  fretePreco: 22.5,
  cep: "37928-000",
};

describe("assinaturaDoPedido", () => {
  it("é estável sob reordenação dos itens — a sacola não garante ordem", () => {
    const invertido = { ...pedido, itens: [...pedido.itens].reverse() };
    expect(assinaturaDoPedido(pedido)).toBe(assinaturaDoPedido(invertido));
  });

  it("muda quando muda item, quantidade, frete, CEP ou cupom", () => {
    const base = assinaturaDoPedido(pedido);
    expect(
      assinaturaDoPedido({ ...pedido, itens: [{ product_id: "a1", quantity: 3 }] }),
    ).not.toBe(base);
    expect(assinaturaDoPedido({ ...pedido, freteId: 1 })).not.toBe(base);
    // Corrigir o CEP é mudar o pedido: retry com CEP novo não pode replayar
    // o pedido com o endereço velho.
    expect(assinaturaDoPedido({ ...pedido, cep: "01310-100" })).not.toBe(base);
    expect(assinaturaDoPedido({ ...pedido, cupom: "SERRA10" })).not.toBe(base);
  });

  it("normaliza o CEP para dígitos: com e sem máscara é o mesmo lugar", () => {
    expect(assinaturaDoPedido({ ...pedido, cep: "37928000" })).toBe(
      assinaturaDoPedido(pedido),
    );
  });
});

describe("chaveDeIdempotencia", () => {
  it("mesma assinatura → a MESMA chave (reclique e retry não cobram duas vezes)", () => {
    const a = chaveDeIdempotencia(assinaturaDoPedido(pedido));
    const b = chaveDeIdempotencia(assinaturaDoPedido(pedido));
    expect(a).toBe(b);
  });

  it("assinatura nova → chave nova (mudou item ou frete, é OUTRO pedido)", () => {
    const a = chaveDeIdempotencia(assinaturaDoPedido(pedido));
    const b = chaveDeIdempotencia(
      assinaturaDoPedido({ ...pedido, freteId: 9, freteNome: "PAC" }),
    );
    expect(a).not.toBe(b);
    // E voltar à assinatura antiga NÃO ressuscita a chave antiga: o helper
    // guarda só a tentativa corrente, de propósito — ver o comentário no módulo.
    const c = chaveDeIdempotencia(assinaturaDoPedido(pedido));
    expect(c).not.toBe(a);
  });

  it("retry SEM desfecho (timeout, rede, 4xx sem pedido) reusa a chave — é a proteção", () => {
    const assinatura = assinaturaDoPedido(pedido);
    const a = chaveDeIdempotencia(assinatura);
    // Nenhum descarte entre as tentativas: o servidor deve receber a MESMA
    // chave e devolver o pedido da primeira, se ela chegou a criá-lo.
    expect(chaveDeIdempotencia(assinatura)).toBe(a);
  });

  it("descarte após RECUSA: a mesma assinatura ganha chave nova (o pedido rejeitado não volta)", () => {
    const assinatura = assinaturaDoPedido(pedido);
    const daRecusada = chaveDeIdempotencia(assinatura);
    descartarChave(); // o checkout descarta quando a resposta vem 'rejeitado'
    expect(chaveDeIdempotencia(assinatura)).not.toBe(daRecusada);
  });

  it("descarte após SUCESSO: compra idêntica na mesma sessão não vira replay do pedido pago", () => {
    const assinatura = assinaturaDoPedido(pedido);
    const daPaga = chaveDeIdempotencia(assinatura);
    descartarChave(); // o checkout descarta em `concluir`, depois do purchase
    // Mesmos itens e mesmo frete de novo, sem reload: tem de ser OUTRO pedido.
    expect(chaveDeIdempotencia(assinaturaDoPedido(pedido))).not.toBe(daPaga);
  });

  it("a chave tem cara de uuid e cabe no limite de 128 do servidor", () => {
    const chave = chaveDeIdempotencia("x");
    expect(chave).toMatch(/^[0-9a-f-]{36}$/i);
    expect(chave.length).toBeLessThanOrEqual(128);
  });
});
