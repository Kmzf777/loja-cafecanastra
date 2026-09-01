import { describe, it, expect, beforeEach, vi } from "vitest";
import { within } from "@testing-library/react";

import { renderizar } from "@/lib/teste/renderizar";
import {
  formularioDaResposta,
  type RespostaDaVitrine,
} from "@/lib/painel/vitrine/vitrine.logica";

/**
 * A TELA DA VITRINE, com DOM de verdade — spec §2.8: o módulo puro é testado
 * como função, e o jsdom cobre só o que a função pura não alcança. Aqui isso é:
 * o instante em que o erro aparece (R8), o instante em que a barra de salvar
 * aparece (R5), a prévia acompanhando a digitação (R33) e o teclado das abas.
 *
 * A Server Action é substituída ANTES do import do componente: ela declara
 * `"use server"` e arrastaria `next/cache`, `next/headers` e o cliente de
 * servidor do Supabase para dentro do jsdom — nada disso tem runtime aqui.
 * O que se testa dela é o CORPO que a tela decide mandar, que é a defesa do
 * lado do cliente contra apagar o que ninguém tocou.
 */
const salvarFalso = vi.fn();
vi.mock("./acoes", () => ({
  salvarVitrine: (...args: unknown[]) => salvarFalso(...args),
}));

import { FormularioDaVitrine } from "./FormularioDaVitrine";

const VAZIO = {
  kicker: null,
  titulo: null,
  texto: null,
  rotulo_botao: null,
  destino: null,
  imagem_alt: null,
};

const GRAVADO: RespostaDaVitrine = {
  heroi: { imagem_desktop: null, imagem_mobile: null },
  textos: {
    heroi: {
      pt: {
        ...VAZIO,
        titulo: "Café que vem de cima.",
        texto: "Torrado sob demanda, em lotes pequenos.",
      },
      en: { ...VAZIO },
      es: { ...VAZIO },
    },
    barra_aviso: { pt: { ...VAZIO }, en: { ...VAZIO }, es: { ...VAZIO } },
  },
};

function montar(resposta: RespostaDaVitrine = GRAVADO) {
  return renderizar(<FormularioDaVitrine inicial={formularioDaResposta(resposta)} />);
}

/** O repositório não tem `@testing-library/jest-dom` (nem `setupFiles`), então
 *  o valor de um campo se lê do próprio nó. */
const valor = (no: HTMLElement) => (no as HTMLInputElement).value;
const selecionada = (no: HTMLElement) => no.getAttribute("aria-selected") === "true";

beforeEach(() => {
  salvarFalso.mockReset();
  salvarFalso.mockResolvedValue({ ok: true, estado: GRAVADO });
});

describe("as abas de idioma", () => {
  it("são três, e a de português começa selecionada", () => {
    const { getAllByRole } = montar();
    const abas = getAllByRole("tab");
    expect(abas.map((a) => a.textContent?.trim())).toEqual(["pt", "en", "es"]);
    expect(selecionada(abas[0])).toBe(true);
  });

  it("trocam o conteúdo do painel", async () => {
    const { usuario, getByLabelText, getByRole } = montar();
    expect(valor(getByLabelText("Título"))).toBe("Café que vem de cima.");

    await usuario.click(getByRole("tab", { name: /en/ }));
    expect(valor(getByLabelText("Título"))).toBe("");
    expect(selecionada(getByRole("tab", { name: /en/ }))).toBe(true);
  });

  /**
   * Sem as setas, quem navega por teclado fica preso na aba de português — só
   * ela está no ciclo do Tab, que é o que o padrão ARIA de abas manda. Dois
   * terços do conteúdo da tela ficariam inalcançáveis, e nenhum teste de render
   * por string veria isso.
   */
  it("andam com as setas do teclado", async () => {
    const { usuario, getByRole } = montar();
    await usuario.click(getByRole("tab", { name: /pt/ }));
    await usuario.keyboard("{ArrowRight}");
    expect(selecionada(getByRole("tab", { name: /en/ }))).toBe(true);

    await usuario.keyboard("{ArrowLeft}{ArrowLeft}");
    expect(selecionada(getByRole("tab", { name: /es/ }))).toBe(true);
  });
});

describe("a prévia ao vivo — R33", () => {
  it("acompanha a digitação, sem salvar nem recarregar nada", async () => {
    const { usuario, getByLabelText, getByRole } = montar();
    const previa = getByRole("region", { name: "Prévia da loja" });
    expect(within(previa).getByText("Café que vem de cima.")).toBeTruthy();

    await usuario.clear(getByLabelText("Título"));
    await usuario.type(getByLabelText("Título"), "O microlote chegou.");

    expect(within(previa).getByText("O microlote chegou.")).toBeTruthy();
    expect(salvarFalso).not.toHaveBeenCalled();
  });

  /**
   * O CAMPO VAZIO APARECE COMO LACUNA, e não como espaço em branco. A prévia
   * não conhece a tabela `TEXTOS` de `page.tsx` (ela é conteúdo daquela página);
   * em vez de inventar uma segunda cópia do texto de hoje, ela DIZ que o slot
   * fica como está. É a regra do fallback aparecendo na tela.
   */
  it("mostra a lacuna onde o campo está vazio", () => {
    const { getByText } = montar();
    expect(getByText(/Chapéu — usa o texto de hoje/)).toBeTruthy();
    expect(getByText(/Aviso — usa o texto de hoje/)).toBeTruthy();
  });

  it("segue a aba de idioma", async () => {
    const { usuario, getByRole, getByText, queryByText } = montar();
    expect(queryByText(/Título — usa o texto de hoje/)).toBeNull();
    await usuario.click(getByRole("tab", { name: /es/ }));
    expect(getByText(/Título — usa o texto de hoje/)).toBeTruthy();
  });
});

describe("a barra de salvar — R5", () => {
  it("não existe enquanto nada mudou", () => {
    const { queryByRole } = montar();
    expect(queryByRole("button", { name: "Salvar" })).toBeNull();
  });

  it("aparece na primeira alteração e diz em qual idioma", async () => {
    const { usuario, getByLabelText, getByRole, getByText } = montar();
    await usuario.type(getByLabelText("Chapéu"), "Colheita 2026");

    expect(getByRole("button", { name: "Salvar" })).toBeTruthy();
    expect(getByText(/Alterações não salvas em Português/)).toBeTruthy();
  });

  it("some quando o valor volta ao que era", async () => {
    const { usuario, getByLabelText, getByRole, queryByRole } = montar();
    const titulo = getByLabelText("Título");
    await usuario.type(titulo, "!");
    expect(getByRole("button", { name: "Salvar" })).toBeTruthy();

    await usuario.type(titulo, "{Backspace}");
    expect(queryByRole("button", { name: "Salvar" })).toBeNull();
  });

  /** Descartar apaga trabalho e não tem desfazer: um clique errado num botão de
   *  uma etapa leva junto meia hora de digitação (R11). */
  it("descartar pede confirmação antes de devolver o valor original", async () => {
    const { usuario, getByLabelText, getByRole, queryByRole } = montar();
    const titulo = getByLabelText("Título");
    await usuario.clear(titulo);
    await usuario.type(titulo, "Outra coisa");

    await usuario.click(getByRole("button", { name: "Descartar" }));
    expect(valor(getByLabelText("Título"))).toBe("Outra coisa");

    await usuario.click(getByRole("button", { name: "Descartar mesmo" }));
    expect(valor(getByLabelText("Título"))).toBe("Café que vem de cima.");
    expect(queryByRole("button", { name: "Salvar" })).toBeNull();
  });
});

describe("o salvamento", () => {
  /**
   * A ARMADILHA 2 DA ONDA, DO LADO DO CLIENTE. `PUT /config` apagava
   * configuração de produção porque mandava tudo a cada salvamento. Aqui, mudar
   * o título tem de mandar o título — e nada mais.
   */
  it("manda SÓ o campo tocado", async () => {
    const { usuario, getByLabelText, getByRole } = montar();
    await usuario.clear(getByLabelText("Título"));
    await usuario.type(getByLabelText("Título"), "O microlote chegou.");
    await usuario.click(getByRole("button", { name: "Salvar" }));

    expect(salvarFalso).toHaveBeenCalledTimes(1);
    expect(salvarFalso).toHaveBeenCalledWith({
      textos: { heroi: { pt: { titulo: "O microlote chegou." } } },
    });
  });

  it("junta idiomas diferentes num corpo só", async () => {
    const { usuario, getByLabelText, getByRole } = montar();
    await usuario.type(getByLabelText("Aviso"), "Frete grátis");
    await usuario.click(getByRole("tab", { name: /en/ }));
    await usuario.type(getByLabelText("Aviso"), "Free shipping");
    await usuario.click(getByRole("button", { name: "Salvar" }));

    expect(salvarFalso).toHaveBeenCalledWith({
      textos: {
        barra_aviso: { pt: { texto: "Frete grátis" }, en: { texto: "Free shipping" } },
      },
    });
  });

  it("rebaseia com o que o servidor devolveu, e a barra some", async () => {
    const { usuario, getByLabelText, getByRole, queryByRole, findByText } = montar();
    await usuario.type(getByLabelText("Chapéu"), "Colheita 2026");

    salvarFalso.mockResolvedValue({
      ok: true,
      estado: {
        ...GRAVADO,
        textos: {
          ...GRAVADO.textos,
          heroi: {
            ...GRAVADO.textos.heroi,
            pt: { ...GRAVADO.textos.heroi.pt, kicker: "Colheita 2026" },
          },
        },
      },
    });

    await usuario.click(getByRole("button", { name: "Salvar" }));

    expect(await findByText(/Vitrine salva/)).toBeTruthy();
    expect(queryByRole("button", { name: "Salvar" })).toBeNull();
    expect(valor(getByLabelText("Chapéu"))).toBe("Colheita 2026");
  });

  /** A frase do servidor ganha sempre — `fraseDeErro` existe para isso. E a
   *  barra CONTINUA lá: nada foi salvo, então nada foi resolvido. */
  it("mostra a frase que o servidor devolveu, e não perde o que foi digitado", async () => {
    const { usuario, getByLabelText, getByRole, findByText } = montar();
    salvarFalso.mockResolvedValue({
      ok: false,
      erro: 'Campo desconhecido em "textos.heroi.pt": "title".',
    });

    await usuario.type(getByLabelText("Chapéu"), "Colheita");
    await usuario.click(getByRole("button", { name: "Salvar" }));

    expect(await findByText(/Campo desconhecido/)).toBeTruthy();
    expect(getByRole("button", { name: "Salvar" })).toBeTruthy();
    expect(valor(getByLabelText("Chapéu"))).toBe("Colheita");
  });
});

describe("a validação", () => {
  /** R8: acusar erro na terceira letra é acusar alguém de errar uma coisa que
   *  ela ainda está no meio de fazer. */
  it("cala enquanto se digita, e cobra no Salvar", async () => {
    const { usuario, getByLabelText, getByRole, getByText, queryByText } = montar();
    await usuario.type(getByLabelText("Destino do botão"), "cafes");
    expect(queryByText(/Use um caminho da loja/)).toBeNull();

    await usuario.click(getByRole("button", { name: "Salvar" }));
    expect(getByText(/Use um caminho da loja/)).toBeTruthy();
    expect(salvarFalso).not.toHaveBeenCalled();
  });

  it("perdoa ao vivo depois de ter cobrado uma vez", async () => {
    const { usuario, getByLabelText, getByRole, getByText, queryByText } = montar();
    await usuario.type(getByLabelText("Destino do botão"), "cafes");
    await usuario.click(getByRole("button", { name: "Salvar" }));
    expect(getByText(/Use um caminho da loja/)).toBeTruthy();

    await usuario.clear(getByLabelText("Destino do botão"));
    await usuario.type(getByLabelText("Destino do botão"), "/cafes");
    expect(queryByText(/Use um caminho da loja/)).toBeNull();
  });

  /**
   * A FOTO NOVA COM O ALT DA FOTO ANTIGA é pior que a foto sem alt: o piso
   * chumbado descreve a imagem que estava lá, e quem usa leitor de tela ouve,
   * com toda a confiança, a legenda de uma foto que não está mais na página.
   */
  it("não deixa salvar imagem sem descrição, e marca as três abas", async () => {
    const { usuario, getByLabelText, getByRole, getAllByRole } = montar();
    await usuario.type(
      getByLabelText("Endereço da imagem"),
      "https://res.cloudinary.com/c/nova.jpg",
    );
    await usuario.click(getByRole("button", { name: "Salvar" }));

    expect(salvarFalso).not.toHaveBeenCalled();
    /* O marcador é lido pelo TEXTO do `sr-only`, e não pelo glifo: WCAG 1.4.1
       — a cor (e o "!") nunca é o único canal, e é a frase que quem usa leitor
       de tela ouve. */
    for (const aba of getAllByRole("tab")) {
      expect(within(aba).getByText("(com erro)")).toBeTruthy();
    }
  });

  /**
   * O erro numa aba FECHADA é o jeito mais rápido de fazer o gestor clicar em
   * Salvar até desistir: a tarja diz "confira os campos marcados" e não há
   * campo marcado nenhum na tela que ele está vendo.
   */
  it("abre a aba do primeiro erro", async () => {
    const { usuario, getByLabelText, getByRole, getByText } = montar();
    await usuario.click(getByRole("tab", { name: /es/ }));
    await usuario.type(getByLabelText("Destino do link"), "nao-e-caminho");
    await usuario.click(getByRole("tab", { name: /pt/ }));

    await usuario.click(getByRole("button", { name: "Salvar" }));

    expect(selecionada(getByRole("tab", { name: /es/ }))).toBe(true);
    expect(getByText(/Confira os campos marcados/)).toBeTruthy();
  });

  it("recusa endereço de imagem em host que a loja não desenha", async () => {
    const { usuario, getByLabelText, getByRole, getByText } = montar();
    await usuario.type(
      getByLabelText("Endereço da imagem"),
      "https://i.imgur.com/x.jpg",
    );
    await usuario.click(getByRole("button", { name: "Salvar" }));

    expect(salvarFalso).not.toHaveBeenCalled();
    expect(getByText(/res\.cloudinary\.com/)).toBeTruthy();
  });
});
