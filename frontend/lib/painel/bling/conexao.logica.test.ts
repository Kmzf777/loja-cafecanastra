import { describe, expect, it } from "vitest";
import {
  ESCOPOS_DO_APP,
  URL_DE_CALLBACK,
  estadoDaConexao,
  mensagemDoRetorno,
} from "./conexao.logica";

describe("estadoDaConexao", () => {
  it("sem credenciais, pede o formulário", () => {
    const e = estadoDaConexao({ temCredenciais: false, conectado: false, ativo: false });
    expect(e.chave).toBe("sem_credenciais");
  });

  it("com credenciais e sem conexão, oferece Conectar", () => {
    const e = estadoDaConexao({ temCredenciais: true, conectado: false, ativo: false });
    expect(e.chave).toBe("desconectado");
  });

  it("conectado e desligado avisa que falta ligar", () => {
    const e = estadoDaConexao({ temCredenciais: true, conectado: true, ativo: false });
    expect(e.chave).toBe("conectado_desligado");
  });

  it("conectado e ligado é o estado final", () => {
    const e = estadoDaConexao({ temCredenciais: true, conectado: true, ativo: true });
    expect(e.chave).toBe("ligado");
  });

  it("status ausente não quebra — trata como sem credenciais", () => {
    expect(estadoDaConexao(null).chave).toBe("sem_credenciais");
  });
});

describe("mensagemDoRetorno", () => {
  it("reconhece o sucesso do callback", () => {
    const m = mensagemDoRetorno(new URLSearchParams("conectado=1"));
    expect(m).toEqual({ tipo: "sucesso", texto: expect.stringContaining("conectada") });
  });

  it("devolve a frase do servidor INTEIRA, sem reescrever", () => {
    const frase = "O Bling recusou: o code expirou. Clique em Conectar de novo.";
    const m = mensagemDoRetorno(new URLSearchParams(`erro=${encodeURIComponent(frase)}`));
    expect(m).toEqual({ tipo: "erro", texto: frase });
  });

  it("sem parâmetro, não mostra nada", () => {
    expect(mensagemDoRetorno(new URLSearchParams(""))).toBeNull();
  });
});

describe("os escopos e a URL de callback são os do runbook", () => {
  it("Produtos é o único sem escrita", () => {
    const produtos = ESCOPOS_DO_APP.find((e) => e.recurso === "Produtos");
    expect(produtos?.escrita).toBe(false);
    expect(ESCOPOS_DO_APP.filter((e) => e.escrita)).toHaveLength(3);
  });

  it("a URL de callback aponta para a API, não para a vitrine", () => {
    expect(URL_DE_CALLBACK).toBe(
      "https://loja.canastrainteligencia.com/api/bling/callback",
    );
  });
});
