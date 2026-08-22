import type { ReactElement } from "react";
import { describe, it, expect, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

/**
 * O painel de compra em três idiomas.
 *
 * SEM DOM E SEM TESTING-LIBRARY, pelo mesmo caminho do SeletorDeIdioma: o que
 * se verifica aqui é MARKUP — que texto sai e em que idioma.
 * `renderToStaticMarkup` não roda efeito, então o painel é lido no seu estado
 * inicial, que é justamente o que o cliente vê ao abrir a PDP.
 *
 * O QUE FICA FORA, E POR QUÊ: tudo o que só existe depois de um clique — o
 * texto da aba de assinatura, os dois links para o Clube (que só são
 * renderizados com `assinando` ligado), o "Na sacola ✓" e as duas mensagens de
 * erro. Sem DOM não há evento, e o estado inicial é o único que se pode ler.
 * Aquelas frases são cobertas pelo dicionario.test.ts, que garante que
 * nenhuma delas ficou em português.
 *
 * A SACOLA É DUBLADA porque `useSacola` exige o provedor e o provedor abre
 * cliente do GoTrue. Nada aqui exercita a sacola de verdade — quem faz isso é
 * lib/sacola/*.test.ts.
 */
vi.mock("@/lib/sacola/sacola", () => ({
  useSacola: () => ({ adicionar: async () => {}, itens: [] }),
}));

import { PainelCompra } from "./PainelCompra";
import { VAR_ALTURA_DO_AVISO } from "@/components/layout/BannerCookies";
import { lotesDoLocale } from "@/lib/catalogo/produtos";
import type { Lote } from "@/lib/catalogo/tipos";

function html(no: ReactElement) {
  return renderToStaticMarkup(no);
}

/** O Clássico é uma das duas linhas com assinatura — é ela que abre as abas. */
const CLASSICO = lotesDoLocale("pt").find((l) => l.slug === "classico") as Lote;

/** O mesmo lote com a prateleira vazia: nenhum peso, nenhuma moagem. */
const ESGOTADO: Lote = {
  ...CLASSICO,
  variantes: CLASSICO.variantes.map((v) => ({ ...v, estoque: 0 })),
};

describe("PainelCompra", () => {
  it("põe todo o texto do painel no idioma da página", () => {
    const en = html(<PainelCompra lote={CLASSICO} locale="en" />);

    expect(en).toContain("Add to bag");
    expect(en).toContain("Whole bean");
    expect(en).toContain("Weight");
    expect(en).toContain("One-time purchase");
    expect(en).toContain("We roast on Tuesday and ship on Wednesday.");

    const es = html(<PainelCompra lote={CLASSICO} locale="es" />);

    expect(es).toContain("Añadir a la bolsa");
    expect(es).toContain("En grano");
    expect(es).toContain("Molienda");
    expect(es).toContain("Tostamos el martes y enviamos el miércoles.");
  });

  it("não deixa nenhuma das frases do painel vazar em português", () => {
    // A lista é a das frases que estavam cravadas no componente, MENOS as
    // três que o espanhol escreve igual ao português — "Compra única", "Modo
    // de compra" e "Peso" são as mesmas palavras nas duas línguas, e estão
    // declaradas uma a uma em IGUAIS_DE_PROPOSITO, no dicionario.test.ts.
    const emPortugues = [
      "Adicionar à sacola",
      "Moagem",
      "Embalagem",
      "Torramos na terça",
      "Moído no dia do pedido",
      "Diminuir quantidade",
      "Aumentar quantidade",
      "Esgotado",
    ];

    for (const locale of ["en", "es"] as const) {
      const saida = html(<PainelCompra lote={ESGOTADO} locale={locale} />);
      for (const frase of emPortugues) {
        expect(saida, `${frase} em ${locale}`).not.toContain(frase);
      }
    }
  });

  it("diz que acabou no idioma de quem lê, e diz o que fazer", () => {
    const en = html(<PainelCompra lote={ESGOTADO} locale="en" />);
    expect(en).toContain("Sold out");
    expect(en).toContain("This combination is sold out.");

    const es = html(<PainelCompra lote={ESGOTADO} locale="es" />);
    expect(es).toContain("Agotado");
    expect(es).toContain("Esta combinación está agotada.");

    // Esgotado não fala em torra da semana: a frase da terça só aparece
    // quando há o que comprar.
    expect(en).not.toContain("We roast on Tuesday");
  });

  it("nomeia os botões de quantidade para quem não vê a tela", () => {
    expect(html(<PainelCompra lote={CLASSICO} locale="en" />)).toContain(
      'aria-label="Increase quantity"',
    );
    expect(html(<PainelCompra lote={CLASSICO} locale="es" />)).toContain(
      'aria-label="Disminuir cantidad"',
    );
    expect(html(<PainelCompra lote={CLASSICO} locale="pt" />)).toContain(
      'aria-label="Aumentar quantidade"',
    );
  });

  it("chama a aba de assinatura pelo mesmo nome da navegação", () => {
    // Uma aba "Assinatura" ao lado de um menu que diz "Subscription" faria a
    // pessoa achar que são duas coisas. O desconto vem colado ao rótulo.
    expect(html(<PainelCompra lote={CLASSICO} locale="en" />)).toContain(
      "Subscription −10%",
    );
    expect(html(<PainelCompra lote={CLASSICO} locale="es" />)).toContain(
      "Suscripción −10%",
    );
  });

  it("aponta para Como preparar com o nome que a seção tem naquele idioma", () => {
    // O link é âncora na própria página: o texto precisa bater com o <h2> de
    // lá, senão a ponte que substituiu os sete botões de método não fecha.
    const en = html(<PainelCompra lote={CLASSICO} locale="en" />);
    expect(en).toContain('href="#como-preparar"');
    expect(en).toContain("How to brew");
    expect(html(<PainelCompra lote={CLASSICO} locale="es" />)).toContain(
      "Cómo preparar",
    );
  });

  it("apoia a barra de compra fixa na altura que o aviso de cookies publica", () => {
    // O DEFEITO QUE ISTO IMPEDE, medido em 360×800: o aviso de cookies ia de
    // y=642,8 a 800 e a barra fixa de y=727 a 800 — a barra INTEIRA por baixo
    // do aviso, nos três idiomas, e "Adicionar à sacola" intocável justamente
    // na primeira visita de um telefone.
    //
    // A constante vem importada do próprio banner de propósito: se o nome da
    // variável mudar lá, muda aqui junto, e um teste que a escrevesse à mão
    // continuaria verde com a barra de volta por baixo do aviso.
    const saida = html(<PainelCompra lote={CLASSICO} locale="pt" />);
    expect(saida).toContain(`bottom:var(${VAR_ALTURA_DO_AVISO}, 0px)`);
    // E não pode sobrar o `bottom-0` que colava a barra na base da janela.
    expect(saida).not.toContain("bottom-0");
  });

  it("põe piso de toque nos botões que escolhem o que vai ser comprado", () => {
    // §10 pede 44×44. Medidos antes: 79,5×41,5 nos três pesos. `min-h-12` é o
    // mesmo piso que o seletor de moagem já usava duas fieldsets acima — o de
    // peso e o de embalagem repetiam a classe sem ele.
    const saida = html(<PainelCompra lote={CLASSICO} locale="pt" />);
    const pesos = saida.split("<button").filter((p) => /\d+ g<|1 kg</.test(p));
    expect(pesos.length).toBeGreaterThan(0);
    for (const botao of pesos) {
      expect(botao).toContain("min-h-12");
    }
  });

  it("continua em português quando ninguém passa idioma", () => {
    // O padrão importa: o componente é chamado de mais de um lugar, e cair em
    // inglês numa loja brasileira seria pior que não traduzir.
    const saida = html(<PainelCompra lote={CLASSICO} />);
    expect(saida).toContain("Adicionar à sacola");
    expect(saida).toContain("Torramos na terça, enviamos na quarta.");
  });
});
