import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

/**
 * O Cabeçalho é Server Component, mas embarca três ilhas client — a sacola, o
 * aviso de frete e o seletor de idioma. Duas delas leem coisas que não existem
 * fora do navegador (contexto da sacola, `usePathname`), então são mockadas:
 * o que se testa aqui é a MARCAÇÃO que o cabeçalho monta, não o que aquelas
 * peças fazem por conta própria (elas têm teste separado).
 */
const estado = vi.hoisted(() => ({ quantidade: 0 }));

vi.mock("@/lib/sacola/sacola", () => ({
  useSacola: () => ({ quantidadeTotal: estado.quantidade }),
}));

vi.mock("next/navigation", () => ({
  usePathname: () => "/cafes",
}));

import { beforeEach, afterEach } from "vitest";

import { Cabecalho } from "./Cabecalho";
import { dicionario } from "@/lib/i18n/dicionario";
import { LOCALES, type Locale } from "@/lib/i18n/tipos";

/**
 * O `fetch` É DUBLADO, e sem isso este arquivo passaria a abrir socket para
 * `localhost:3333` a cada render — o cabeçalho lê a barra de aviso do banco
 * desde a Onda 2 do painel. Dois arquivos desta suíte já falham por dependerem
 * da API estar no ar; este não vai virar o terceiro.
 *
 * O padrão é "a API não respondeu", que é o caminho do PISO: tudo o que os
 * outros casos afirmam sobre a marcação continua sendo afirmado sobre o
 * cabeçalho de sempre.
 */
const fetchFalso = vi.fn();

beforeEach(() => {
  fetchFalso.mockReset();
  fetchFalso.mockResolvedValue({ ok: false, json: async () => ({}) });
  vi.stubGlobal("fetch", fetchFalso);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

/**
 * `Cabecalho` é `async` (ele lê a barra de aviso), e `renderToStaticMarkup` não
 * sabe esperar Promise. Chamar a função e renderizar o elemento que ela devolve
 * é o mesmo que o servidor faz — e mantém o resto do arquivo intacto.
 */
async function html(locale: Locale, quantidade = 0) {
  estado.quantidade = quantidade;
  return renderToStaticMarkup(await Cabecalho({ locale }));
}

/** Os dois <a href="/sacola"> da página: o da barra e o do telefone. */
function sacolas(saida: string): string[] {
  return (saida.match(/<a\b[^>]*>/g) ?? []).filter((t) =>
    t.includes('href="/sacola"'),
  );
}

describe("Cabecalho", () => {
  it("traduz o alt do logotipo em vez de descrever a embalagem", async () => {
    for (const locale of LOCALES) {
      expect(await html(locale)).toContain(`alt="${dicionario(locale).comum.logoAlt}"`);
    }
  });

  it("pede a sacola em glifo nas duas barras, telefone e desktop", async () => {
    // As duas instâncias convivem na mesma marcação: a de desktop mora num
    // `hidden xl:flex`, a de telefone num `xl:hidden`. Elas recebem o MESMO
    // desenho — quadrado de 44px com o glifo, que é o `⌕ ⊙ 🛒2` do §5.8. Até
    // aqui só o telefone o usava; foi ele que devolveu a barra de 360px para
    // dentro da tela, e a de desktop era a única cuja largura ainda dependia
    // do idioma e do que a pessoa tivesse colocado na sacola.
    const caixas = sacolas(await html("pt", 12));

    expect(caixas).toHaveLength(2);
    expect(caixas.filter((c) => c.includes("size-11"))).toHaveLength(2);
  });

  it("não deixa a contagem mexer na largura de nenhuma das duas barras", async () => {
    // O defeito: com 12 itens o documento ganhava 2px de rolagem horizontal em
    // 360px, porque a contagem entrava no fluxo da linha. O `aria-label` muda
    // com a quantidade — é o que o leitor de tela precisa ouvir —, mas a
    // CLASSE, que é quem decide a caixa, não pode mudar.
    const classes = (saida: string) =>
      sacolas(saida).map((c) => c.match(/class="([^"]*)"/)?.[1]);

    expect(classes(await html("pt", 0))).toEqual(classes(await html("pt", 12)));
  });

  it("leva o idioma para toda a navegação, inclusive a busca", async () => {
    const saida = await html("en");

    for (const caminho of ["/cafes", "/clube", "/a-serra", "/historia"]) {
      expect(saida).toContain(`href="/en${caminho}"`);
    }
    // O form de busca cai na PLP do idioma: pesquisar não pode ser um jeito de
    // sair do inglês sem perceber.
    expect(saida).toContain('action="/en/cafes"');
  });

  it("mantém a conta fora da barra de telefone e dentro do acordeão", async () => {
    const saida = await html("pt");

    // O único /account de nível de barra é o da variante de desktop; o outro
    // está no painel do <details>, com o rótulo por extenso.
    expect(saida).toContain(dicionario("pt").nav.minhaConta);
    expect(saida.match(/href="\/account"/g)).toHaveLength(2);
  });

  it("nomeia o botão do menu pelo texto visível, que troca ao abrir", async () => {
    // Sem `aria-label` fixo: um "Abrir menu" cravado mentiria com o painel
    // aberto.
    const saida = await html("es");

    expect(saida).toContain(dicionario("es").nav.menu);
    expect(saida).toContain(dicionario("es").nav.fechar);
    expect(saida).not.toContain('aria-label="Abrir');
  });

  /**
   * A BARRA DE AVISO ERA UM CAMPO WRITE-ONLY — o painel legado a editava e a
   * vitrine lia o dicionário (spec §1). Estes três casos são a prova de que as
   * duas pontas se encontraram, e de que a ponta que faltava (o piso) continua
   * de pé.
   */
  it("mostra o aviso do banco quando ele existe", async () => {
    fetchFalso.mockResolvedValue({
      ok: true,
      json: async () => ({
        heroi: { imagem_desktop: null, imagem_mobile: null },
        textos: {
          heroi: { pt: null, en: null, es: null },
          barra_aviso: {
            pt: {
              kicker: null,
              titulo: null,
              texto: "Frete grátis nesta semana",
              rotulo_botao: "Ver os cafés",
              destino: "/cafes",
              imagem_alt: null,
            },
            en: null,
            es: null,
          },
        },
      }),
    });

    const saida = await html("pt");
    expect(saida).toContain("Frete grátis nesta semana");
    expect(saida).not.toContain(dicionario("pt").barra.torradoSobDemanda);
    expect(saida).toContain("Ver os cafés");
  });

  it("cai no dicionário quando a API não responde", async () => {
    const saida = await html("es");
    expect(saida).toContain(dicionario("es").barra.torradoSobDemanda);
  });

  /** O link só existe com rótulo E destino: um rótulo sem destino seria uma
   *  palavra sublinhada que não leva a lugar nenhum. */
  it("não desenha link nenhum quando o banco não tem destino", async () => {
    const saida = await html("pt");
    const barra = saida.slice(0, saida.indexOf("</header>"));
    expect(barra).not.toContain("underline-offset-2");
  });
});
