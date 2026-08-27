import { describe, it, expect } from "vitest";

import {
  POR_PAGINA,
  ROTA_DE_ENVIOS,
  chipsDosEnvios,
  lerEstado,
  montarConsulta,
  ondeParou,
  temFiltro,
  urlDaTela,
  type Envio,
  type EstadoDosEnvios,
} from "./envios.logica";

function envio(sobrescreve: Partial<Envio> = {}): Envio {
  return {
    id: "eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee",
    canal: "email",
    campanha_id: null,
    user_id: null,
    destinatario_final: "ana@exemplo.com",
    template: "carrinho-abandonado",
    estado: "enviado",
    provedor_id: null,
    erro_texto: null,
    criado_em: "2026-08-26T12:00:00.000Z",
    enviado_em: "2026-08-26T12:00:05.000Z",
    entregue_em: null,
    ...sobrescreve,
  };
}

function estado(sobrescreve: Partial<EstadoDosEnvios> = {}): EstadoDosEnvios {
  return { canal: "", estado: "", pagina: 1, ...sobrescreve };
}

describe("lerEstado", () => {
  it("lê canal, estado e página", () => {
    expect(lerEstado({ canal: "whatsapp", estado: "falhou", pagina: "2" })).toEqual({
      canal: "whatsapp",
      estado: "falhou",
      pagina: 2,
    });
  });

  it("valor fora do vocabulário vira sem filtro, e não um 400 na tela", () => {
    expect(lerEstado({ canal: "pombo" }).canal).toBe("");
    expect(lerEstado({ estado: "quase" }).estado).toBe("");
  });

  it("página inválida cai em 1", () => {
    expect(lerEstado({ pagina: "-2" }).pagina).toBe(1);
    expect(lerEstado({ pagina: "abc" }).pagina).toBe(1);
  });
});

describe("montarConsulta", () => {
  it("bate na rota de envios com o limite da tela", () => {
    expect(montarConsulta(estado())).toBe(`/admin/envios?page=1&limit=${POR_PAGINA}`);
  });

  it("leva os filtros quando existem", () => {
    const c = montarConsulta(estado({ canal: "email", estado: "falhou" }));
    expect(c).toContain("canal=email");
    expect(c).toContain("estado=falhou");
  });
});

describe("urlDaTela e chips", () => {
  it("a página 1 não polui a URL", () => {
    expect(urlDaTela(estado())).toBe(ROTA_DE_ENVIOS);
  });

  it("sem filtro, nenhum chip", () => {
    expect(chipsDosEnvios(estado())).toEqual([]);
    expect(temFiltro(estado())).toBe(false);
  });

  it("os chips mostram rótulos, não valores crus", () => {
    const chips = chipsDosEnvios(estado({ canal: "whatsapp", estado: "falhou" }));
    expect(chips.map((c) => c.valor)).toEqual(["WhatsApp", "Falhou"]);
    expect(temFiltro(estado({ estado: "falhou" }))).toBe(true);
  });

  it("remover um chip preserva o outro e volta para a página 1", () => {
    const chips = chipsDosEnvios(
      estado({ canal: "email", estado: "falhou", pagina: 3 }),
    );
    const doEstado = chips.find((c) => c.chave === "estado")!;
    expect(doEstado.href).toContain("canal=email");
    expect(doEstado.href).not.toContain("estado=");
    expect(doEstado.href).not.toContain("pagina=");
  });
});

describe("ondeParou", () => {
  /**
   * A frase do provedor É o diagnóstico ("mailbox full", "número inexistente"),
   * e trocá-la por "Falhou" transforma um problema de dois minutos num chamado.
   */
  it("na falha, a frase do provedor ganha do rótulo genérico", () => {
    expect(ondeParou(envio({ estado: "falhou", erro_texto: "mailbox full" }))).toBe(
      "mailbox full",
    );
  });

  it("falha sem detalhe diz que não há detalhe, em vez de mentir", () => {
    expect(ondeParou(envio({ estado: "falhou", erro_texto: null }))).toMatch(
      /sem detalhe/i,
    );
  });

  it("cada estado da linha do tempo tem a sua frase", () => {
    expect(ondeParou(envio({ estado: "pendente" }))).toMatch(/fila/i);
    expect(ondeParou(envio({ estado: "enviado" }))).toMatch(/sem confirmação/i);
    expect(ondeParou(envio({ estado: "entregue" }))).toMatch(/entregue/i);
    expect(ondeParou(envio({ estado: "lido" }))).toMatch(/aberta/i);
  });

  /**
   * Nada garante que `estado = 'entregue'` tenha `entregue_em` — o provedor pode
   * confirmar a entrega sem devolver o instante. A frase vem do ESTADO, que é a
   * verdade declarada; usar o instante faria a tela dizer "entregue em —".
   */
  it("a frase não depende do instante, que é opcional", () => {
    expect(ondeParou(envio({ estado: "entregue", entregue_em: null }))).toBe(
      ondeParou(envio({ estado: "entregue", entregue_em: "2026-08-26T13:00:00Z" })),
    );
  });

  it("estado novo do backend aparece, em vez de sumir atrás de «outro»", () => {
    expect(ondeParou(envio({ estado: "devolvido" }))).toBe("devolvido");
  });
});
