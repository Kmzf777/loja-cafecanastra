import { describe, it, expect, afterEach } from "vitest";
import { aceitaCartao } from "./pagamento";

/**
 * O teste mais importante desta página, e ele não é sobre texto.
 *
 * Os Termos PROMETEM um meio de pagamento. Se a promessa e o checkout lerem
 * fontes diferentes, existe um build em que a página jurídica anuncia cartão e
 * o rádio "Cartão" não aparece no checkout — a loja documentando por escrito
 * um serviço que ela não presta. Por isso `aceitaCartao()` não relê a env por
 * conta própria: ela delega a `chavePublicaMp()`, a MESMA função que
 * lib/sacola/cartao.ts usa para decidir se o cartão existe.
 *
 * A env `NEXT_PUBLIC_*` é resolvida em tempo de BUILD e assada no bundle — o
 * build que mostra o rádio é o mesmo que promete cartão aqui. Em node (aqui) a
 * leitura é em tempo de chamada, e é isso que torna os casos abaixo testáveis.
 */

const ORIGINAL = process.env.NEXT_PUBLIC_MP_PUBLIC_KEY;

function definirChave(valor: string | undefined) {
  if (valor === undefined) delete process.env.NEXT_PUBLIC_MP_PUBLIC_KEY;
  else process.env.NEXT_PUBLIC_MP_PUBLIC_KEY = valor;
}

afterEach(() => definirChave(ORIGINAL));

describe("aceitaCartao", () => {
  it("nega cartão quando a loja não tem chave do Mercado Pago", () => {
    definirChave(undefined);
    expect(aceitaCartao()).toBe(false);
  });

  it("promete cartão quando a chave existe", () => {
    definirChave("APP_USR-uma-chave-publica-qualquer");
    expect(aceitaCartao()).toBe(true);
  });

  /**
   * Chave em branco é o caso que morde de verdade: um `.env` com
   * `NEXT_PUBLIC_MP_PUBLIC_KEY=` ou com espaços passa por qualquer teste de
   * "a variável está definida" e não tokeniza cartão nenhum. Os Termos não
   * podem prometer por causa de um espaço.
   */
  it("trata chave vazia ou só com espaços como ausência de cartão", () => {
    definirChave("");
    expect(aceitaCartao()).toBe(false);
    definirChave("   ");
    expect(aceitaCartao()).toBe(false);
  });
});
