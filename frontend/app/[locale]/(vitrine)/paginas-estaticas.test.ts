import { describe, expect, it } from "vitest";
import { LOCALES } from "../../../lib/i18n/tipos";

/**
 * A TRAVA DA GERAÇÃO ESTÁTICA.
 *
 * O defeito que este arquivo impede de voltar não deu erro nenhum quando
 * aconteceu: ao mover a vitrine para dentro do segmento `[locale]`, as sete
 * rotas institucionais deixaram de ser prerenderizadas — um segmento dinâmico
 * sem `generateStaticParams` não sai do build — e passaram a pagar render de
 * servidor a cada visita. Build verde, testes verdes, site mais lento.
 * `docs/performance-dev.md` §7 tem o custo medido.
 *
 * POR QUE LER O ARQUIVO EM VEZ DE IMPORTAR A PÁGINA: importar `page.tsx` no
 * Vitest arrasta `next/image`, o repositório do catálogo e a árvore inteira de
 * componentes de servidor para um ambiente `node` que não é o do Next. O que
 * precisa ser verdade aqui é uma propriedade do CÓDIGO-FONTE — a função existe
 * e devolve os três idiomas —, e essa propriedade se lê no texto do módulo sem
 * montar meia framework.
 */

const RAIZ = new URL(".", import.meta.url);

/**
 * As oito rotas que saem do build como HTML pronto, vezes três idiomas.
 *
 * `/clube` entrou depois: a lista nasceu com sete e dois documentos já falavam
 * em oito, então a página que autoriza cobrança recorrente era justamente a
 * única estática sem guarda — e a documentação afirmava que ela tinha uma.
 *
 * `/cafes` fica de fora e é decisão, não esquecimento: a PLP lê `searchParams`
 * (os filtros vivem na URL, por exigência do estetica.md §7.2), e página que lê
 * a query não prerenderiza. Ela declara `generateStaticParams` mesmo assim,
 * pelo motivo que o comentário de lá explica.
 */
const PAGINAS = [
  "page.tsx",
  "a-serra/page.tsx",
  "historia/page.tsx",
  "bio/page.tsx",
  "clube/page.tsx",
  "rastreabilidade/page.tsx",
  "termos-de-uso/page.tsx",
  "politica-de-privacidade/page.tsx",
];

async function fonte(caminho: string): Promise<string> {
  const { readFile } = await import("node:fs/promises");
  return readFile(new URL(caminho, RAIZ), "utf8");
}

/**
 * O código sem os comentários.
 *
 * Precisa existir porque este repositório EXPLICA as decisões no próprio
 * arquivo: as páginas trazem, escrito por extenso, "não lê `cookies()`,
 * `headers()` nem `searchParams`" — e a primeira versão desta trava acusou
 * justamente a frase que promete o contrário do defeito. Comentário é prosa,
 * não comportamento.
 *
 * Só a linha que COMEÇA com `//` é removida, e não qualquer `//`: o segundo
 * caso comeria o resto de qualquer linha com uma URL `https://`.
 */
function semComentarios(texto: string): string {
  return texto.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

describe("as páginas da vitrine são estáticas", () => {
  it.each(PAGINAS)("%s declara generateStaticParams", async (caminho) => {
    expect(await fonte(caminho)).toMatch(
      /export (async )?function generateStaticParams\(\)/,
    );
  });

  it.each(PAGINAS)("%s gera os três idiomas a partir de LOCALES", async (caminho) => {
    // Escrito sobre `LOCALES` e não sobre uma lista à mão: no dia em que um
    // quarto idioma entrar, as sete rotas o acompanham sozinhas.
    expect(await fonte(caminho)).toMatch(
      /return LOCALES\.map\(\(locale\) => \(\{ locale \}\)\);/,
    );
  });

  /**
   * O que torna uma página dinâmica sem avisar. `cookies()` e `headers()` são
   * os dois caminhos por onde isso costuma entrar — o comentário de
   * `lib/avaliacoes/servidor.ts` já contava essa história a respeito da PDP.
   */
  it.each(PAGINAS)("%s não lê cookies, headers nem searchParams", async (caminho) => {
    const codigo = semComentarios(await fonte(caminho));
    expect(codigo).not.toMatch(/from "next\/headers"/);
    expect(codigo).not.toMatch(/\bsearchParams\b/);
    expect(codigo).not.toMatch(/force-dynamic/);
    expect(codigo).not.toMatch(/no-store/);
  });

  it("os três idiomas são os que o resto do i18n conhece", () => {
    expect(LOCALES).toEqual(["pt", "en", "es"]);
  });

  /**
   * O `not-found.tsx` DA RAIZ derruba a estática do SITE INTEIRO se tocar API
   * dinâmica, e este é o caso que faltava aqui.
   *
   * Ele é renderizado dentro do layout raiz, e o Next precisa prerenderizá-lo
   * para montar a casca estática de qualquer página: um `headers()` ou um
   * `connection()` ali dispara o bail-out e ele sobe pela árvore. Medido, com
   * o mesmo commit, mudando só a existência daquele arquivo:
   *
   *     com `connection()` .....  4 rotas estáticas,  0 HTML em disco
   *     sem o arquivo ..........  51 rotas estáticas, 47 HTML em disco
   *
   * Levava junto `/checkout`, `/sacola` e as páginas de conta. Build verde,
   * suíte verde, `tsc` limpo — e o site inteiro renderizando sob demanda.
   * Nenhuma das travas existentes pegava, porque todas olhavam para dentro do
   * `[locale]` e o culpado morava fora dele.
   */
  it("o not-found da raiz não toca API dinâmica — ele derruba a estática de tudo", async () => {
    const { readFile } = await import("node:fs/promises");
    const codigo = semComentarios(
      await readFile(new URL("../../not-found.tsx", RAIZ), "utf8"),
    );
    expect(codigo).not.toMatch(/from "next\/headers"/);
    expect(codigo).not.toMatch(/\bconnection\(\)/);
    expect(codigo).not.toMatch(/from "next\/server"/);
    expect(codigo).not.toMatch(/force-dynamic/);
    expect(codigo).not.toMatch(/no-store/);
  });
});
