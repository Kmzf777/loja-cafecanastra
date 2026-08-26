import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { LOCALES, type Locale } from "../i18n/tipos";
import { IDIOMAS } from "../painel/vitrine/vitrine.logica";
import {
  IMAGEM_DO_HEROI_PADRAO,
  SEGUNDOS_DE_CACHE,
  ESPERA_MAXIMA_MS,
  buscarBarraDeAviso,
  buscarHeroi,
  type PisoDaBarra,
  type PisoDoHeroi,
} from "./heroi";

/**
 * O LEITOR DO HERÓI — e a única coisa que ele não pode fazer nunca é deixar o
 * topo da loja em branco.
 *
 * A armadilha 3 do plano da Onda 2, escrita como teste: "linha ausente, coluna
 * nula ou string vazia ⇒ a home aparece exatamente como aparece hoje. Um gestor
 * que salva o formulário pela metade não pode apagar o topo da loja."
 *
 * E a armadilha 1 junto: a leitura tem de ser `fetch` COM REVALIDAÇÃO e nunca
 * `cookies()`/`headers()`/`searchParams`, senão as três homes caem de estáticas
 * para render sob demanda — com uma ida ao servidor por visita. O último
 * describe deste arquivo fixa isso.
 */

const PISO: Record<Locale, PisoDoHeroi> = {
  pt: {
    kicker: "Serra da Canastra · Minas Gerais",
    titulo: "Café que vem de cima.",
    texto: "Torrado sob demanda, em lotes pequenos.",
    rotuloBotao: "Ver os cafés",
    destino: "/cafes",
    imagemAlt: "Cozinha mineira ao amanhecer",
  },
  en: {
    kicker: "Serra da Canastra · Minas Gerais, Brazil",
    titulo: "Coffee from up high.",
    texto: "Roasted to order, in small batches.",
    rotuloBotao: "See the coffees",
    destino: "/cafes",
    imagemAlt: "A Minas kitchen at dawn",
  },
  es: {
    kicker: "Serra da Canastra · Minas Gerais, Brasil",
    titulo: "Café que viene de arriba.",
    texto: "Tostado bajo pedido, en lotes pequeños.",
    rotuloBotao: "Ver los cafés",
    destino: "/cafes",
    imagemAlt: "Cocina minera al amanecer",
  },
};

const PISO_DA_BARRA: Record<Locale, PisoDaBarra> = {
  pt: { texto: "Torrado sob demanda", rotuloBotao: "", destino: "" },
  en: { texto: "Roasted to order", rotuloBotao: "", destino: "" },
  es: { texto: "Tostado bajo pedido", rotuloBotao: "", destino: "" },
};

const CAMPOS_VAZIOS = {
  kicker: null,
  titulo: null,
  texto: null,
  rotulo_botao: null,
  destino: null,
  imagem_alt: null,
};

/** Uma resposta no formato exato do contrato do `GET /vitrine`. */
function resposta(parcial: {
  heroi?: { imagem_desktop?: string | null; imagem_mobile?: string | null };
  heroiTexto?: Partial<Record<Locale, Record<string, string | null>>>;
  barra?: Partial<Record<Locale, Record<string, string | null>>>;
}) {
  const porIdioma = (
    origem: Partial<Record<Locale, Record<string, string | null>>> | undefined,
  ) =>
    Object.fromEntries(
      LOCALES.map((l) => [
        l,
        origem?.[l] ? { ...CAMPOS_VAZIOS, ...origem[l] } : null,
      ]),
    );

  return {
    heroi: {
      imagem_desktop: parcial.heroi?.imagem_desktop ?? null,
      imagem_mobile: parcial.heroi?.imagem_mobile ?? null,
    },
    textos: {
      heroi: porIdioma(parcial.heroiTexto),
      barra_aviso: porIdioma(parcial.barra),
    },
  };
}

const fetchFalso = vi.fn();

beforeEach(() => {
  fetchFalso.mockReset();
  vi.stubGlobal("fetch", fetchFalso);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function respondeCom(corpo: unknown, ok = true) {
  fetchFalso.mockResolvedValue({ ok, json: async () => corpo });
}

describe("buscarHeroi", () => {
  it("devolve o texto do banco quando ele existe", async () => {
    respondeCom(
      resposta({
        heroi: { imagem_desktop: "https://res.cloudinary.com/c/promo.jpg" },
        heroiTexto: {
          pt: {
            kicker: "Colheita 2026",
            titulo: "O microlote chegou.",
            texto: "Cento e vinte sacas, e só.",
            rotulo_botao: "Quero o microlote",
            destino: "/cafes?destaque=microlote",
            imagem_alt: "Sacas empilhadas no armazém",
          },
        },
      }),
    );

    expect(await buscarHeroi("pt", PISO.pt)).toEqual({
      kicker: "Colheita 2026",
      titulo: "O microlote chegou.",
      texto: "Cento e vinte sacas, e só.",
      rotuloBotao: "Quero o microlote",
      destino: "/cafes?destaque=microlote",
      imagemAlt: "Sacas empilhadas no armazém",
      imagemDesktop: "https://res.cloudinary.com/c/promo.jpg",
      imagemMobile: "https://res.cloudinary.com/c/promo.jpg",
    });
  });

  /**
   * A API FORA DO AR NÃO PODE FECHAR A LOJA. É a mesma decisão de
   * `lib/catalogo/repositorio.ts` ("uma loja que não abre é pior que uma loja
   * com preço de ontem") aplicada ao topo da página: sem esta guarda, o build
   * da home falharia — ou pior, sairia com o herói vazio — sempre que o Express
   * estivesse reiniciando.
   */
  it("cai no texto chumbado quando a API não responde", async () => {
    fetchFalso.mockRejectedValue(new Error("ECONNREFUSED"));
    expect(await buscarHeroi("pt", PISO.pt)).toMatchObject(PISO.pt);

    fetchFalso.mockReset();
    respondeCom({ error: "Erro ao buscar o conteúdo da vitrine" }, false);
    expect(await buscarHeroi("pt", PISO.pt)).toMatchObject(PISO.pt);

    fetchFalso.mockReset();
    fetchFalso.mockResolvedValue({
      ok: true,
      json: async () => {
        throw new Error("resposta não é JSON");
      },
    });
    expect(await buscarHeroi("pt", PISO.pt)).toMatchObject(PISO.pt);
  });

  it("cai no texto chumbado quando a linha existe mas o campo é null", async () => {
    respondeCom(
      resposta({ heroiTexto: { pt: { titulo: "Só o título foi preenchido." } } }),
    );

    const heroi = await buscarHeroi("pt", PISO.pt);
    expect(heroi.titulo).toBe("Só o título foi preenchido.");
    expect(heroi.kicker).toBe(PISO.pt.kicker);
    expect(heroi.texto).toBe(PISO.pt.texto);
    expect(heroi.rotuloBotao).toBe(PISO.pt.rotuloBotao);
    expect(heroi.destino).toBe(PISO.pt.destino);
    expect(heroi.imagemAlt).toBe(PISO.pt.imagemAlt);
  });

  /**
   * O GESTOR QUE SALVOU PELA METADE. `PUT /vitrine` grava `""` como NULL, mas a
   * coluna pode ter vindo de qualquer lugar — um UPDATE à mão, uma migração de
   * `config_loja`. Espaço em branco também conta: `"   "` é vazio para os olhos.
   */
  it("cai no texto chumbado quando o campo é string vazia", async () => {
    respondeCom(
      resposta({
        heroiTexto: { pt: { titulo: "", texto: "   ", kicker: "Fica" } },
      }),
    );

    const heroi = await buscarHeroi("pt", PISO.pt);
    expect(heroi.kicker).toBe("Fica");
    expect(heroi.titulo).toBe(PISO.pt.titulo);
    expect(heroi.texto).toBe(PISO.pt.texto);
  });

  /**
   * A REGRA QUE MERECE SER LIDA DUAS VEZES, porque ela tem um custo.
   *
   * O gestor edita o português — é o idioma dele. Se `/en` só olhasse a própria
   * linha, o anúncio do microlote sairia em `/pt` e o visitante inglês
   * continuaria vendo "Coffee from up high", que é o texto de sempre: a loja
   * anunciaria uma coisa numa língua e outra noutra.
   *
   * O preço é ver português numa página em inglês enquanto a tradução não vem.
   * Entre uma loja que diz a mesma coisa nos três idiomas e uma que só diz a
   * novidade num deles, a primeira erra menos — e a tela do painel tem as três
   * abas lado a lado justamente para o erro durar pouco.
   *
   * É CAMPO A CAMPO: um `en` com título traduzido e texto em branco fica com o
   * título em inglês e o texto do português, e não com os dois em português.
   */
  it("cai no idioma pt quando o idioma pedido não tem linha", async () => {
    respondeCom(
      resposta({
        heroiTexto: {
          pt: { titulo: "O microlote chegou.", texto: "Cento e vinte sacas." },
          en: { titulo: "The microlot is here." },
        },
      }),
    );

    const ingles = await buscarHeroi("en", PISO.en);
    expect(ingles.titulo).toBe("The microlot is here.");
    expect(ingles.texto).toBe("Cento e vinte sacas.");
    // O que nem em português existe continua caindo no piso DO IDIOMA PEDIDO.
    expect(ingles.kicker).toBe(PISO.en.kicker);

    const espanhol = await buscarHeroi("es", PISO.es);
    expect(espanhol.titulo).toBe("O microlote chegou.");
    expect(espanhol.kicker).toBe(PISO.es.kicker);
  });

  /**
   * A AFIRMAÇÃO GUARDA-CHUVA. Se um dia alguém acrescentar um campo ao herói e
   * esquecer o piso dele, é aqui que fica vermelho — e não na home em produção.
   */
  it("nunca devolve campo vazio para nenhum dos três idiomas", async () => {
    const cenarios = [
      resposta({}),
      resposta({ heroiTexto: { pt: { titulo: "" }, en: {}, es: {} } }),
      resposta({ heroiTexto: { pt: { kicker: "  " } } }),
      null,
    ];

    for (const corpo of cenarios) {
      respondeCom(corpo);
      for (const locale of LOCALES) {
        const heroi = await buscarHeroi(locale, PISO[locale]);
        for (const [campo, valor] of Object.entries(heroi)) {
          expect(valor, `${campo} vazio em ${locale}`).toBeTruthy();
          expect(valor.trim(), `${campo} em branco em ${locale}`).not.toBe("");
        }
      }
    }
  });

  it("a resposta com a tabela vazia devolve o piso inteiro, imagem incluída", async () => {
    respondeCom(resposta({}));
    expect(await buscarHeroi("es", PISO.es)).toEqual({
      ...PISO.es,
      imagemDesktop: IMAGEM_DO_HEROI_PADRAO,
      imagemMobile: IMAGEM_DO_HEROI_PADRAO,
    });
  });
});

describe("a imagem do herói", () => {
  /**
   * `next/image` LANÇA para host fora de `images.remotePatterns` — não degrada,
   * derruba a rota. Um endereço colado de qualquer lugar faria a home responder
   * 500, e o herói é a primeira coisa que ela desenha. A tela do painel já
   * recusa na hora de salvar; isto é a segunda trava, para o que já estiver no
   * banco ou tiver entrado por SQL.
   */
  it("ignora endereço de host que a loja não pode desenhar", async () => {
    respondeCom(resposta({ heroi: { imagem_desktop: "https://i.imgur.com/x.jpg" } }));
    const heroi = await buscarHeroi("pt", PISO.pt);
    expect(heroi.imagemDesktop).toBe(IMAGEM_DO_HEROI_PADRAO);
  });

  it("aceita arquivo do próprio site", async () => {
    respondeCom(resposta({ heroi: { imagem_desktop: "/outro-banner.jpg" } }));
    expect((await buscarHeroi("pt", PISO.pt)).imagemDesktop).toBe("/outro-banner.jpg");
  });

  /** Uma imagem só serve os dois tamanhos: pedir dois uploads da mesma foto é
   *  trabalho inventado (é o que o comentário da migração 0030 diz). */
  it("a versão de telefone cai na de desktop quando não foi enviada", async () => {
    respondeCom(resposta({ heroi: { imagem_desktop: "/desktop.jpg" } }));
    const heroi = await buscarHeroi("pt", PISO.pt);
    expect(heroi.imagemMobile).toBe("/desktop.jpg");
  });

  it("respeita a versão de telefone quando ela existe", async () => {
    respondeCom(
      resposta({
        heroi: { imagem_desktop: "/desktop.jpg", imagem_mobile: "/telefone.jpg" },
      }),
    );
    const heroi = await buscarHeroi("pt", PISO.pt);
    expect(heroi.imagemDesktop).toBe("/desktop.jpg");
    expect(heroi.imagemMobile).toBe("/telefone.jpg");
  });
});

describe("buscarBarraDeAviso", () => {
  it("devolve o texto do banco quando ele existe", async () => {
    respondeCom(
      resposta({
        barra: {
          pt: {
            texto: "Frete grátis para todo o Brasil nesta semana",
            rotulo_botao: "Ver os cafés",
            destino: "/cafes",
          },
        },
      }),
    );

    expect(await buscarBarraDeAviso("pt", PISO_DA_BARRA.pt)).toEqual({
      texto: "Frete grátis para todo o Brasil nesta semana",
      rotuloBotao: "Ver os cafés",
      destino: "/cafes",
    });
  });

  it("cai no dicionário quando o banco não tem nada", async () => {
    respondeCom(resposta({}));
    expect(await buscarBarraDeAviso("en", PISO_DA_BARRA.en)).toEqual(
      PISO_DA_BARRA.en,
    );
  });

  it("cai no dicionário quando a API não responde", async () => {
    fetchFalso.mockRejectedValue(new Error("timeout"));
    expect(await buscarBarraDeAviso("es", PISO_DA_BARRA.es)).toEqual(
      PISO_DA_BARRA.es,
    );
  });

  /** O link é OPCIONAL: uma barra sem destino continua sendo uma barra. O que
   *  não pode é o rótulo ficar sem destino — quem impede isso é `validar()`. */
  it("devolve rótulo e destino vazios quando não há link", async () => {
    respondeCom(resposta({ barra: { pt: { texto: "Torra da semana" } } }));
    const barra = await buscarBarraDeAviso("pt", PISO_DA_BARRA.pt);
    expect(barra.texto).toBe("Torra da semana");
    expect(barra.destino).toBe("");
    expect(barra.rotuloBotao).toBe("");
  });

  it("ignora destino que leva para fora do site sem dizer", async () => {
    respondeCom(
      resposta({
        barra: { pt: { texto: "Promo", rotulo_botao: "Ver", destino: "//evil.com" } },
      }),
    );
    const barra = await buscarBarraDeAviso("pt", PISO_DA_BARRA.pt);
    expect(barra.destino).toBe("");
    expect(barra.rotuloBotao).toBe("");
  });
});

/**
 * A ARMADILHA 1 DA ONDA, FIXADA COMO TESTE.
 *
 * `generateStaticParams()` + `revalidate = 3600` fazem as três homes saírem do
 * build; qualquer API dinâmica na leitura as derruba para render sob demanda,
 * com uma ida ao servidor por visita (o custo está medido em
 * `docs/performance-dev.md §7`). O que sobrevive à geração estática é `fetch`
 * com `next: { revalidate }` — e é exatamente essa forma que este bloco trava.
 */
describe("a forma da chamada — o que mantém as três homes estáticas", () => {
  it("é fetch com revalidação, e com teto de espera", async () => {
    respondeCom(resposta({}));
    await buscarHeroi("pt", PISO.pt);

    const [url, init] = fetchFalso.mock.calls[0] as [
      string,
      RequestInit & { next?: { revalidate?: number } },
    ];
    expect(url).toMatch(/\/vitrine$/);
    expect(init.next?.revalidate).toBe(SEGUNDOS_DE_CACHE);
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  /**
   * Uma API que aceita a conexão e nunca responde deixaria a promessa pendurada
   * para sempre — e quem espera aqui é o BUILD das três homes. Mesmo teto de
   * `lib/catalogo/repositorio.ts` e `lib/avaliacoes/servidor.ts`, de propósito:
   * são três leituras de contingência do mesmo tipo, e três números diferentes
   * seriam três conversas sobre o mesmo problema.
   */
  it("usa o mesmo teto de espera das outras leituras de contingência", () => {
    expect(ESPERA_MAXIMA_MS).toBe(3000);
  });

  it("uma hora de cache, o mesmo `revalidate` da home", () => {
    expect(SEGUNDOS_DE_CACHE).toBe(3600);
  });

  /**
   * Os idiomas da loja e os idiomas da tabela são a MESMA lista. Se um quarto
   * idioma entrar em `LOCALES` sem entrar no CHECK da migração, o herói dele
   * nasceria mudo — e o sintoma seria "a home nova não lê o banco", não "falta
   * uma migração".
   */
  it("os idiomas da vitrine e os da tabela são a mesma lista", () => {
    expect([...LOCALES].sort()).toEqual([...IDIOMAS].sort());
  });
});
