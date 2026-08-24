import { describe, it, expect } from "vitest";
import { tetoDeAdicao, decidirAdicao } from "./usar-adicionar";

/**
 * SÓ AS FUNÇÕES PURAS. O hook em si não é testado aqui porque a suíte roda em
 * `environment: "node"` — não há DOM, não há como montar um componente e
 * clicar. Por isso a regra saiu do componente como função: o que decide se a
 * loja cobra certo fica provável, e o que sobra no React é fiação.
 */
describe("tetoDeAdicao", () => {
  it("usa o estoque real quando o banco respondeu", () => {
    expect(tetoDeAdicao(6, true)).toBe(6);
  });

  it("nunca passa de 20, mesmo com estoque alto", () => {
    // 20 é o teto de sempre do PainelCompra: acima disso é pedido de atacado
    // e não passa por carrinho.
    expect(tetoDeAdicao(500, true)).toBe(20);
  });

  it("cai para 20 quando a API está fora e o estoque é desconhecido", () => {
    // Sem produtoId o número do JSON pode ser o de ontem. O servidor
    // reconfere na cobrança — travar a venda aqui seria pior.
    expect(tetoDeAdicao(0, false)).toBe(20);
    expect(tetoDeAdicao(3, false)).toBe(20);
  });

  it("com produtoId e estoque zero, o teto é 20 e quem barra é o esgotado", () => {
    // O card já não deixa clicar quando está esgotado; o teto não é o lugar
    // de repetir aquela regra.
    expect(tetoDeAdicao(0, true)).toBe(20);
  });
});

describe("decidirAdicao", () => {
  it("adiciona quando há espaço", () => {
    expect(decidirAdicao({ jaNaSacola: 0, teto: 20, temProdutoId: true }))
      .toEqual({ acao: "adicionar" });
  });

  it("avisa do teto em vez de adicionar em silêncio", () => {
    expect(decidirAdicao({ jaNaSacola: 6, teto: 6, temProdutoId: true }))
      .toEqual({ acao: "no-teto" });
  });

  it("o teto vale para o ACUMULADO, não para o clique", () => {
    expect(decidirAdicao({ jaNaSacola: 7, teto: 6, temProdutoId: true }))
      .toEqual({ acao: "no-teto" });
  });

  it("sem produtoId avisa que não dá, em vez de fingir que guardou", () => {
    // API fora: a vitrine está de pé com o JSON, mas o carrinho fala com o
    // backend e sem o id não há o que enviar.
    expect(decidirAdicao({ jaNaSacola: 0, teto: 20, temProdutoId: false }))
      .toEqual({ acao: "sem-loja" });
  });

  it("o teto é conferido ANTES do produtoId", () => {
    // Quem já encheu a sacola ouve "chegou no limite", não "a loja caiu" —
    // a segunda mensagem mandaria a pessoa recarregar a página à toa.
    expect(decidirAdicao({ jaNaSacola: 20, teto: 20, temProdutoId: false }))
      .toEqual({ acao: "no-teto" });
  });
});
