import { describe, it, expect } from "vitest";
import { html } from "@/lib/teste/html";
import { rotuloDoStatus, tomDoStatus, STATUS_DE_PEDIDO } from "@/lib/painel/status";
import { Selo } from "./Selo";

describe("Selo", () => {
  it("mostra o rótulo recebido", () => {
    expect(html(<Selo tom="sucesso">Entregue</Selo>)).toContain("Entregue");
  });

  it("é um <span>: um selo não é clicável, e não deve parecer que é", () => {
    const saida = html(<Selo tom="neutro">Enviado</Selo>);
    expect(saida).toMatch(/^<span/);
    expect(saida).not.toContain("<button");
  });

  /**
   * O requisito literal: filete, nunca fundo sólido. Um selo preenchido de
   * vermelho numa coluna de 50 linhas transforma a tabela num semáforo e come
   * o orçamento de cor que o R22 manda gastar com parcimônia.
   */
  it("desenha com filete e NUNCA com fundo sólido", () => {
    for (const tom of ["sucesso", "alerta", "erro", "neutro"] as const) {
      const saida = html(<Selo tom={tom}>x</Selo>);
      expect(saida).toContain("border");
      expect(saida).not.toMatch(/\bbg-(?:sucesso|alerta|vermelho|erro|fuligem)\b/);
    }
  });

  it("cada tom pinta o filete, e só ele", () => {
    expect(html(<Selo tom="sucesso">x</Selo>)).toContain("border-sucesso");
    expect(html(<Selo tom="alerta">x</Selo>)).toContain("border-alerta");
    expect(html(<Selo tom="erro">x</Selo>)).toContain("border-vermelho");
    expect(html(<Selo tom="neutro">x</Selo>)).toContain("border-fuligem-20");
  });

  /**
   * A tinta é fuligem em TODO tom, e isso é uma decisão de contraste medida,
   * não de gosto: `--color-alerta` (#B87514) sobre `--color-cal-puro` dá
   * 3,6:1 — abaixo dos 4,5:1 que a WCAG 1.4.3 exige de texto pequeno. Com a
   * tinta em fuligem todo selo fica em 16:1, e o significado nunca depende só
   * da cor (WCAG 1.4.1), porque a palavra já diz o status.
   */
  it("a tinta é fuligem em todo tom — a cor vive no filete", () => {
    for (const tom of ["sucesso", "alerta", "erro", "neutro"] as const) {
      const saida = html(<Selo tom={tom}>x</Selo>);
      expect(saida).toContain("text-fuligem");
      expect(saida).not.toMatch(/text-(?:sucesso|alerta|vermelho)\b/);
    }
  });

  /**
   * O contrato com `lib/painel/status`: o Selo aceita o que `tomDoStatus`
   * devolve, para os NOVE status, sem que a lista precise ser copiada para
   * dentro do componente — o `status.ts` avisa em letras garrafais que foi
   * assim que ela virou três cópias.
   */
  it("aceita o tom de qualquer status de pedido, vindo de tomDoStatus", () => {
    for (const s of STATUS_DE_PEDIDO) {
      const saida = html(<Selo tom={tomDoStatus(s.valor)}>{rotuloDoStatus(s.valor)}</Selo>);
      expect(saida).toContain(s.rotulo);
    }
    expect(html(<Selo tom={tomDoStatus("cancelado")}>x</Selo>)).toContain("border-vermelho");
    expect(html(<Selo tom={tomDoStatus("entregue")}>x</Selo>)).toContain("border-sucesso");
  });

  it("status desconhecido cai em neutro, e o selo ainda desenha", () => {
    const saida = html(<Selo tom={tomDoStatus("inventado")}>{rotuloDoStatus("inventado")}</Selo>);
    expect(saida).toContain("inventado");
    expect(saida).toContain("border-fuligem-20");
  });
});
