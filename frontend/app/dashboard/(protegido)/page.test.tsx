import { describe, it, expect, vi } from "vitest";
import { html } from "@/lib/teste/html";
import { LEGADO } from "@/components/painel/casca/menu.logica";

/**
 * A home do painel, renderizada de verdade.
 *
 * POR QUE ESTE TESTE EXISTE, se a regra do repositório é que a decisão mora num
 * módulo puro e a casca só desenha: esta tela é o primeiro Server Component
 * ASSÍNCRONO do painel, e ela monta quatro componentes de cliente
 * (`<Tarja>`, `<Ficha>`, `<EstadoDaTela>`, `<Cabecalho>`) recebendo elementos
 * como props. Nada disso é pego pelo `next build` — `/dashboard` é rota
 * dinâmica, então ela nunca é renderizada durante a compilação, e um erro de
 * montagem aqui só apareceria na cara do gestor.
 *
 * `await` na função e `html()` no resultado: um Server Component assíncrono é
 * uma função que devolve uma Promise de elemento. Fora do bundler RSC, o
 * `"use client"` dos filhos é só uma string no topo do arquivo, e eles
 * renderizam como componentes React normais — que é exatamente o que se quer
 * conferir aqui.
 *
 * O `lerAcessoDoPainel` é dublado porque ele vai ao GoTrue e ao PostgREST. O
 * que interessa deste lado é o que a tela FAZ com a resposta, não a resposta.
 */
vi.mock("@/lib/conta/painel-servidor", () => ({
  lerAcessoDoPainel: async () => ({
    temSessao: true,
    ehAdmin: true,
    falhouConsulta: false,
    email: "gestao@cafecanastra.com",
    userId: "11111111-1111-1111-1111-111111111111",
  }),
}));

const { default: PaginaInicialDoPainel } = await import("./page");

async function saida(): Promise<string> {
  return html(await PaginaInicialDoPainel());
}

describe("a home do painel", () => {
  it("monta sem estourar, e o título da página é Início", async () => {
    const s = await saida();
    expect(s).toContain("<h1");
    expect(s).toContain("Início");
  });

  it("o topo é a fila de trabalho, com as cinco linhas do §4.1", async () => {
    const s = await saida();
    for (const linha of [
      "Pedidos a despachar",
      "Pagamento pendente",
      "Assinatura com cobrança falhada",
      "Avaliação a moderar",
      "Estoque baixo",
    ]) {
      expect(s).toContain(linha);
    }
  });

  /**
   * A regra que a tela existe para não quebrar: zero pedidos é um número
   * plausível, e mostrá-lo sem ter perguntado ao banco é o painel afirmando com
   * confiança algo que ele não sabe. Enquanto não houver dado, a coluna traz o
   * traço — e o leitor de tela ouve por escrito que não há contagem.
   */
  it("não inventa contagem nenhuma enquanto não há dado", async () => {
    const s = await saida();
    expect(s).toContain("sem contagem nesta versão");
    expect(s).not.toMatch(/>\s*0\s*</);
  });

  it("diz em nome de quem se está trabalhando", async () => {
    expect(await saida()).toContain("gestao@cafecanastra.com");
  });

  /**
   * Nesta onda nenhuma tela nova existe. Se a home não apontar para o painel
   * antigo, o gestor abre `/dashboard` e não tem como fazer o trabalho do dia —
   * e o endereço `/dashboard/legado` não está escrito em lugar nenhum que ele
   * veja.
   */
  it("aponta para o painel antigo, que é onde o trabalho ainda é feito", async () => {
    const s = await saida();
    expect(s).toContain(`href="${LEGADO.href}"`);
  });

  it("a tela não abre um segundo <main> — o do layout já a envolve", async () => {
    expect(await saida()).not.toContain("<main");
  });
});
