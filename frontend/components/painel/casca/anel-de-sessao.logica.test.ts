import { describe, it, expect } from "vitest";

import { decidirAcessoAoPainel } from "@/lib/conta/painel-servidor";

import {
  decidirNoAnelDeSessao,
  precisaConferirOPapel,
  type FatosDoAnel,
} from "./anel-de-sessao.logica";

/**
 * O anel de cliente, testado como função pura — a mesma divisão do anel de
 * servidor: a decisão não toca em `window`, em rede nem em React, e por isso dá
 * para exercitá-la inteira sem montar tela nenhuma.
 */

const ADMIN = "11111111-1111-4111-8111-111111111111";
const OUTRO = "22222222-2222-4222-8222-222222222222";

const BASE: FatosDoAnel = {
  temSessao: true,
  userId: ADMIN,
  userIdDoServidor: ADMIN,
  ehAdmin: null,
  rotaAtual: "/dashboard/pedidos",
};

describe("decidirNoAnelDeSessao", () => {
  /**
   * O caso que este anel existe para pegar: a aba ficou aberta, a sessão morreu,
   * e a tela continuaria de pé com toda chamada respondendo 401 em silêncio.
   */
  it("sessão morta manda para a entrada, com a rota atual no ?de=", () => {
    const acao = decidirNoAnelDeSessao({
      ...BASE,
      temSessao: false,
      userId: null,
    });
    expect(acao).toEqual({
      tipo: "sai",
      destino: "/dashboard/entrar?de=%2Fdashboard%2Fpedidos",
    });
  });

  /**
   * A rota exata com FILTROS é o que este anel entrega e o de servidor não tem
   * como saber — é a razão de o `?de=` de lá ser sempre a raiz do painel.
   */
  it("o ?de= carrega a query da tela, escapada", () => {
    const acao = decidirNoAnelDeSessao({
      ...BASE,
      temSessao: false,
      userId: null,
      rotaAtual: "/dashboard/pedidos?status=aprovado&pagina=2",
    });
    expect(acao).toEqual({
      tipo: "sai",
      destino:
        "/dashboard/entrar?de=%2Fdashboard%2Fpedidos%3Fstatus%3Daprovado%26pagina%3D2",
    });
  });

  it("a mesma pessoa que o servidor aprovou fica, e nada é perguntado", () => {
    expect(decidirNoAnelDeSessao(BASE)).toEqual({ tipo: "fica" });
    expect(precisaConferirOPapel(true, ADMIN, ADMIN)).toBe(false);
  });

  it("outra pessoa, que o banco diz não ser admin, vai para a própria conta", () => {
    const acao = decidirNoAnelDeSessao({
      ...BASE,
      userId: OUTRO,
      ehAdmin: false,
    });
    expect(acao).toEqual({ tipo: "sai", destino: "/account?painel=negado" });
  });

  it("outra pessoa que É admin fica", () => {
    expect(
      decidirNoAnelDeSessao({ ...BASE, userId: OUTRO, ehAdmin: true }),
    ).toEqual({ tipo: "fica" });
  });

  /**
   * A DIVERGÊNCIA DELIBERADA COM O ANEL DE SERVIDOR, e ela precisa de teste
   * porque parece um esquecimento. Lá, consulta que falha FECHA o acesso: o
   * custo de errar é um F5. Aqui, fechar seria expulsar da tela um gestor
   * legítimo, no meio de um formulário preenchido, por causa de uma oscilação de
   * rede — e é durante a oscilação que a consulta falha. Ficar não abre porta
   * nenhuma: os dados continuam atrás da RLS e do `isAdmin` de cada rota.
   */
  it("consulta que não respondeu (null) NÃO expulsa ninguém", () => {
    expect(
      decidirNoAnelDeSessao({ ...BASE, userId: OUTRO, ehAdmin: null }),
    ).toEqual({ tipo: "fica" });
  });

  /**
   * Sessão morta vence tudo: sem sessão não há a quem perguntar, e ficar seria
   * exatamente a tela zumbi que o anel existe para derrubar.
   */
  it("sem sessão sai mesmo que o papel diga que é admin", () => {
    expect(
      decidirNoAnelDeSessao({
        ...BASE,
        temSessao: false,
        userId: null,
        ehAdmin: true,
      }),
    ).toEqual({ tipo: "sai", destino: "/dashboard/entrar?de=%2Fdashboard%2Fpedidos" });
  });
});

describe("precisaConferirOPapel", () => {
  it("não pergunta quando não há sessão — não há a quem perguntar", () => {
    expect(precisaConferirOPapel(false, null, ADMIN)).toBe(false);
  });

  it("pergunta quando a sessão é de outra pessoa", () => {
    expect(precisaConferirOPapel(true, OUTRO, ADMIN)).toBe(true);
  });

  /**
   * Sem a entrega do anel de servidor não há identidade "já conferida", e o anel
   * de cliente volta a perguntar — que é o lado seguro de não saber.
   */
  it("pergunta quando o servidor não disse por quem respondeu", () => {
    expect(precisaConferirOPapel(true, ADMIN, null)).toBe(true);
  });
});

/**
 * OS DOIS ANÉIS MANDAM PARA OS MESMOS DOIS LUGARES, e este teste é a trava
 * contra a divergência.
 *
 * O endereço mora em `lib/conta/painel-rotas.ts` justamente para não haver duas
 * cópias — mas "não há duas cópias" é uma afirmação sobre o código de hoje.
 * Comparar o veredito das duas funções para os mesmos fatos é uma afirmação
 * sobre o COMPORTAMENTO, e ela continua valendo se alguém reescrever um dos
 * lados. Uma divergência aqui só apareceria na noite em que a sessão de alguém
 * expira, que é quando ninguém está olhando.
 */
describe("os dois anéis concordam no destino", () => {
  /** O veredito do anel de servidor, achatado no que interessa comparar. Falhar
   *  o `tipo` aqui já é uma divergência, e é bom que o teste o diga. */
  function destinoNoServidor(fatos: Parameters<typeof decidirAcessoAoPainel>[0]) {
    const decisao = decidirAcessoAoPainel(fatos);
    expect(decisao.tipo).toBe("redireciona");
    return decisao.tipo === "redireciona" ? decisao.destino : null;
  }

  it("sem sessão: mesmo endereço de entrada, mesmo ?de=", () => {
    const rota = "/dashboard/produtos?q=canastra";
    const cliente = decidirNoAnelDeSessao({
      ...BASE,
      temSessao: false,
      userId: null,
      rotaAtual: rota,
    });
    expect(cliente).toEqual({
      tipo: "sai",
      destino: destinoNoServidor({
        temSessao: false,
        ehAdmin: false,
        falhouConsulta: false,
        rotaPedida: rota,
      }),
    });
  });

  it("logado sem ser admin: os dois mandam para a própria conta", () => {
    const cliente = decidirNoAnelDeSessao({
      ...BASE,
      userId: OUTRO,
      ehAdmin: false,
    });
    expect(cliente).toEqual({
      tipo: "sai",
      destino: destinoNoServidor({
        temSessao: true,
        ehAdmin: false,
        falhouConsulta: false,
        rotaPedida: "/dashboard",
      }),
    });
  });
});
