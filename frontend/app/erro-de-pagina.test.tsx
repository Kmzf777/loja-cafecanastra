import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import { dicionario } from "@/lib/i18n/dicionario";

/**
 * A FRONTEIRA DE ERRO SERVE OS DOIS GRUPOS DE ROTA, e é isso que este teste
 * protege. `app/[locale]/(vitrine)/error.tsx` e `app/(transacional)/error.tsx`
 * são duas cascas em cima deste mesmo componente: a primeira precisa falar o
 * idioma da página, a segunda precisa continuar em pt-BR, que é decisão do
 * cliente (sacola, checkout, conta e pedido não são traduzidos porque o frete
 * é Melhor Envio e o pagamento é Mercado Pago BR).
 *
 * Um `error.tsx` é sempre Client Component e não recebe `params`: a única
 * fonte de idioma é o caminho, e por isso o caminho é o que se mocka aqui.
 */
const estado = vi.hoisted(() => ({ caminho: "/" }));

vi.mock("next/navigation", () => ({
  usePathname: () => estado.caminho,
}));

import { ErroDePagina } from "./erro-de-pagina";

function em(caminho: string, digest?: string) {
  estado.caminho = caminho;
  const erro = Object.assign(new Error("falhou"), { digest });
  return renderToStaticMarkup(<ErroDePagina error={erro} reset={() => {}} />);
}

describe("ErroDePagina", () => {
  it("fala o idioma da página na vitrine", () => {
    expect(em("/cafes")).toContain(dicionario("pt").erro.titulo);
    expect(em("/en/cafes")).toContain(dicionario("en").erro.titulo);
    expect(em("/es/cafes")).toContain(dicionario("es").erro.titulo);
  });

  it("aceita o caminho interno do rewrite tanto quanto o visível", () => {
    // O middleware serve o português por rewrite: o servidor vê `/pt/cafes` e
    // o navegador tem `/cafes`. Os dois lados precisam gerar o MESMO HTML, ou
    // a hidratação descarta a árvore.
    expect(em("/pt/cafes")).toBe(em("/cafes"));
  });

  it.each(["/sacola", "/checkout", "/account", "/account/login", "/pedido/42"])(
    "mantém %s em português — o caminho de compra é pt-BR por decisão",
    (caminho) => {
      const saida = em(caminho);

      expect(saida).toContain(dicionario("pt").erro.titulo);
      expect(saida).not.toContain(dicionario("en").erro.titulo);
    },
  );

  it("oferece uma saída concreta, e ela respeita o idioma", () => {
    // §11: o erro resolve. O botão tenta de novo; o link leva ao catálogo — e
    // em inglês tem de levar ao catálogo em inglês.
    expect(em("/en/cafes")).toContain('href="/en/cafes"');
    expect(em("/es/clube")).toContain('href="/es/cafes"');
    expect(em("/clube")).toContain('href="/cafes"');
  });

  it("mostra o código do erro traduzido, e só quando ele existe", () => {
    expect(em("/en/cafes", "abc123")).toContain("Error code");
    expect(em("/en/cafes", "abc123")).toContain("abc123");
    expect(em("/en/cafes")).not.toContain("Error code");
  });

  it("não vaza mensagem de exceção para o cliente", () => {
    // §11: nunca stack trace, nunca a mensagem crua do erro na tela.
    expect(em("/cafes", "abc123")).not.toContain("falhou");
  });
});
