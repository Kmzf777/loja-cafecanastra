import type { ReactElement } from "react";
import { describe, it, expect, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

/**
 * A tela de 404 da loja.
 *
 * O `usePathname` É DUBLADO porque ele é a única fonte que esta tela tem para
 * duas decisões: o IDIOMA e se o que faltou foi um café ou uma página
 * qualquer. Nenhum `not-found.tsx` recebe `params`, e o de raiz nem sequer
 * vive dentro do segmento `[locale]` — foi medido em `next dev` que o
 * `headers()` do servidor não traz o caminho pedido. O que se verifica aqui é
 * justamente essa leitura.
 */
let caminhoAtual = "/cafes/inexistente";
vi.mock("next/navigation", () => ({
  usePathname: () => caminhoAtual,
}));

import { PaginaNaoEncontrada } from "./PaginaNaoEncontrada";
import { lotesDoLocale } from "@/lib/catalogo/produtos";

function html(caminho: string): string {
  caminhoAtual = caminho;
  return renderToStaticMarkup(telaCom(lotesDoLocale("pt").slice(0, 4)));
}

function telaCom(sugestoes: ReturnType<typeof lotesDoLocale>): ReactElement {
  return <PaginaNaoEncontrada sugestoes={sugestoes} />;
}

describe("PaginaNaoEncontrada", () => {
  it("lê o idioma do endereço, dos dois lados do rewrite", () => {
    // `/cafes/x` é o que o navegador mostra; `/pt/cafes/x` é o que o rewrite
    // do middleware entrega por dentro. Os dois são português.
    expect(html("/cafes/inexistente")).toContain(
      "Esse café não está no catálogo.",
    );
    expect(html("/pt/cafes/inexistente")).toContain(
      "Esse café não está no catálogo.",
    );
    expect(html("/en/cafes/inexistente")).toContain(
      "That coffee is not in the catalogue.",
    );
    expect(html("/es/cafes/inexistente")).toContain(
      "Ese café no está en el catálogo.",
    );
  });

  it("não chama de café o que não é café", () => {
    // A regressão que este arquivo existe para travar: a rede de raiz pega
    // TODA URL inexistente, não só `/cafes/<slug>`. Dizer "esse café não está
    // no catálogo" em `/rota-que-nao-existe` seria mentir sobre o que faltou.
    const generico = html("/rota-que-nao-existe");
    expect(generico).toContain("Essa página não existe.");
    expect(generico).not.toContain("Esse café não está no catálogo.");

    expect(html("/en/rota-que-nao-existe")).toContain(
      "That page does not exist.",
    );
    expect(html("/es/rota-que-nao-existe")).toContain("Esa página no existe.");
  });

  it("trata a PLP como página, não como café", () => {
    // `/cafes` existe de verdade, mas se algum dia cair aqui (query esquisita,
    // rota removida) o texto certo é o genérico: não houve slug nenhum.
    expect(html("/cafes")).toContain("Essa página não existe.");
    expect(html("/en/cafes")).toContain("That page does not exist.");
  });

  it("explica o que aconteceu, sem pedir desculpa (§11)", () => {
    const en = html("/en/cafes/inexistente");
    expect(en).toContain("we roast in small batches");
    expect(en).not.toContain("Sorry");
    expect(html("/en/rota-que-nao-existe")).not.toContain("Sorry");
  });

  it("nunca é beco: catálogo, início e busca, os três no idioma de quem se perdeu", () => {
    // Contrato de lib/i18n/rotas: pt não ganha prefixo, en e es sim.
    const pt = html("/cafes/inexistente");
    expect(pt).toContain('href="/cafes"');
    expect(pt).toContain('href="/"');
    expect(pt).toContain('action="/cafes"');

    const en = html("/en/cafes/inexistente");
    expect(en).toContain('href="/en/cafes"');
    expect(en).toContain('href="/en"');
    // A busca é form GET puro — precisa apontar para a PLP do MESMO idioma,
    // senão pesquisar vira um jeito de sair do idioma sem perceber.
    expect(en).toContain('action="/en/cafes"');

    const es = html("/es/rota-que-nao-existe");
    expect(es).toContain('href="/es/cafes"');
    expect(es).toContain('href="/es"');
    expect(es).toContain('action="/es/cafes"');
  });

  it("traduz também os cafés oferecidos como saída", () => {
    // Os lotes chegam do servidor em português: sem `traduzirLote` aqui, a
    // tela ficava em inglês com quatro cards em português embaixo.
    const en = html("/en/cafes/inexistente");
    expect(en).toContain("Dark roast");
    expect(en).not.toContain("Torra escura");
    // E o card leva o idioma junto no link, como na PLP.
    expect(en).toContain('href="/en/cafes/');
  });

  it("oferece o catálogo com o mesmo nome do resto do site", () => {
    expect(html("/en/cafes/inexistente")).toContain("Browse all coffees");
    expect(html("/es/cafes/inexistente")).toContain("Ver todos los cafés");
  });

  it("sem sugestões, continua tendo as três saídas", () => {
    // `app/not-found.tsx` engole a falha de `listarLotes` e entrega lista
    // vazia — é a tela de último recurso e não pode ela mesma estourar. O que
    // some é a grade; o que fica é a saída.
    caminhoAtual = "/rota-que-nao-existe";
    const vazio = renderToStaticMarkup(telaCom([]));
    expect(vazio).toContain('href="/cafes"');
    expect(vazio).toContain('action="/cafes"');
    expect(vazio).not.toContain("<article");
  });
});
