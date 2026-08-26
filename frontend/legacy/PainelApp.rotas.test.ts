import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { matchRoutes } from "react-router-dom";

/**
 * O CONTRATO DE ROTA DO PAINEL LEGADO — e por que ele precisa de um teste.
 *
 * O SPA legado deixou de ser servido na raiz de `/dashboard` e passou a viver em
 * `/dashboard/legado`: um catch-all na raiz do grupo protegido é o dono de toda
 * URL que ainda não tem pasta própria, e o painel novo nasce criando uma pasta
 * por tela ao longo de seis ondas.
 *
 * A MUDANÇA TEM DUAS METADES QUE PRECISAM ANDAR JUNTAS, e é isso que o teste
 * guarda. Com `basename`, o react-router TIRA o prefixo da URL antes de casar e
 * o PÕE DE VOLTA em todo href que gera. Então:
 *
 *   - se o `basename` estiver certo e os `path` continuarem absolutos
 *     (`/dashboard/orders`), a URL que casa é `/dashboard/legado/dashboard/orders`
 *     — a bonita não casa, e o painel abre na tela "Unexpected Application
 *     Error / 404 Not Found" do react-router;
 *   - se os `path` forem relativos e o `basename` sumir, casa `/orders` e nada
 *     mais.
 *
 * Uma das duas metades sozinha quebra o painel inteiro, e QUEBRA EM TEMPO DE
 * EXECUÇÃO, no navegador, sem erro de build e sem erro de tipo. É a pendência 2
 * de `docs/superpowers/plans/baseline-painel.md`, que este projeto já pagou uma
 * vez com `<Navigate>`.
 *
 * A LEITURA É DO ARQUIVO, EM TEXTO, e não por importação. `PainelApp.jsx` monta
 * quatro provedores, styled-components e treze `lazy()` — importá-lo num teste
 * arrastaria metade do painel legado para dentro do Vitest para conferir duas
 * strings. O que interessa aqui é a TABELA de rotas, e ela é sintaxe: dá para
 * lê-la do fonte e entregá-la ao `matchRoutes` de verdade, que é o mesmo código
 * que o navegador executa.
 */

const RAIZ = __dirname;

/**
 * Sem comentários, SEMPRE, antes de qualquer varredura.
 *
 * Os comentários deste projeto CITAM os caminhos antigos para explicar por que
 * eles mudaram — o de `PainelApp.jsx` mostra o `path: "/dashboard/orders"` que
 * não pode mais existir, e o de `MenuAside.jsx` mostra o `to` que não pode
 * voltar. Um guarda que confunde "usa" com "fala sobre" ensina a apagar a
 * explicação para calar o teste, que é o oposto do que este repositório quer.
 * (Este arquivo aprendeu isso ficando vermelho por causa do próprio comentário
 * que ele existe para proteger.) O `(?<!:)` poupa o `//` de uma URL.
 */
function semComentarios(fonte: string): string {
  return fonte.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(?<!:)\/\/[^\n]*/g, "");
}

const FONTE = semComentarios(readFileSync(join(RAIZ, "PainelApp.jsx"), "utf8"));

/** Só a chamada do roteador. `const router =` e não `createBrowserRouter` seco:
 *  a primeira ocorrência do nome está no `import` do topo do arquivo. */
const TABELA = FONTE.slice(
  FONTE.indexOf("const router = createBrowserRouter"),
  FONTE.indexOf("export default function PainelApp"),
);

const BASENAME = "/dashboard/legado";

function caminhosDeclarados(): string[] {
  return [...TABELA.matchAll(/\bpath:\s*"([^"]*)"/g)].map((m) => m[1]);
}

/** A árvore que o react-router vê, remontada a partir do que está no fonte: um
 *  pai `/` e todos os demais como filhos dele — que é exatamente a forma do
 *  arquivo (um `Dashboard` com doze telas dentro). */
function arvore() {
  const caminhos = caminhosDeclarados();
  const filhos = caminhos.filter((c) => c !== "/").map((path) => ({ path }));
  return [{ path: "/", children: [{ index: true as const }, ...filhos] }];
}

describe("o painel legado mora em /dashboard/legado", () => {
  it("o roteador declara o basename, e é este", () => {
    expect(TABELA).toContain(`basename: "${BASENAME}"`);
  });

  /**
   * A metade que se perde primeiro. Alguém "conserta" um path para
   * `/dashboard/orders` porque é o que aparece na barra de endereço, e a partir
   * dali só aquela tela quebra — o que é o pior modo de quebrar, porque parece
   * um problema daquela tela.
   */
  it("nenhum path é absoluto sob /dashboard — com basename isso dobraria a URL", () => {
    const absolutos = caminhosDeclarados().filter((c) => c.startsWith("/dashboard"));
    expect(absolutos).toEqual([]);
  });

  it("a raiz do SPA casa em /dashboard/legado", () => {
    expect(matchRoutes(arvore(), BASENAME, BASENAME)).not.toBeNull();
  });

  it("toda tela declarada casa com a URL que o gestor vê", () => {
    const naoCasaram = caminhosDeclarados()
      .filter((c) => c !== "/")
      .filter((c) => matchRoutes(arvore(), `${BASENAME}/${c}`, BASENAME) === null);
    expect(naoCasaram).toEqual([]);
  });

  it("as doze telas do painel antigo continuam todas na tabela", () => {
    expect(caminhosDeclarados().filter((c) => c !== "/")).toEqual([
      "products/addProduct",
      "products/addedProducts",
      "orders",
      "clients/registeredClients",
      "settings/updateShopInfo",
      "settings/manageCategories",
      "settings/offers",
      "settings/cupons",
      "avaliacoes",
      "assinaturas",
      "bling",
    ]);
  });

  /**
   * A PROVA PELO CONTRÁRIO, e ela é o coração deste arquivo: mede o que
   * ACONTECERIA com a tabela antiga sob o basename novo, em vez de afirmar que
   * aconteceria. Quem ler este teste não precisa acreditar no comentário de
   * `PainelApp.jsx` — está aqui, executado.
   */
  it("com os paths antigos, a URL bonita NÃO casaria (e a dobrada casaria)", () => {
    const comoEra = [
      { path: "/dashboard", children: [{ path: "/dashboard/orders" }] },
    ];
    expect(matchRoutes(comoEra, `${BASENAME}/orders`, BASENAME)).toBeNull();
    expect(
      matchRoutes(comoEra, `${BASENAME}/dashboard/orders`, BASENAME),
    ).not.toBeNull();
  });
});

/**
 * A OUTRA PONTA DO MESMO CONTRATO: os links dos componentes.
 *
 * O `matchRoutes` acima prova que a URL entra. Isto prova que ela SAI — um
 * `<Link to="/dashboard/orders">` sob basename gera
 * `/dashboard/legado/dashboard/orders`, e o menu inteiro do painel antigo passa
 * a apontar para o lugar errado sem que nenhuma linha fique vermelha em lugar
 * nenhum.
 *
 * `window.location` NÃO entra na varredura: `AdminRoutes.jsx` navega para
 * `/dashboard/entrar` e `/account`, que são rotas do App Router do Next e não
 * deste roteador. Caminho de navegador não conhece basename.
 */
describe("os links do painel legado são relativos ao basename", () => {
  const ARQUIVOS = [
    "components/DashboardSection/MenuAside/MenuAside.jsx",
    "pages/dashboard/Dashboard.jsx",
    "components/DashboardSection/GProducts/addedProducts/AddedProducts.jsx",
    "components/DashboardSection/GProducts/form/Form.jsx",
  ];

  it("a varredura acha os arquivos — um teste que não lê nada passa por engano", () => {
    for (const arquivo of ARQUIVOS) {
      expect(readFileSync(join(RAIZ, arquivo), "utf8").length).toBeGreaterThan(0);
    }
  });

  it("nenhum <Link to> nem navigate() aponta para /dashboard", () => {
    const achados = ARQUIVOS.flatMap((arquivo) => {
      const fonte = semComentarios(readFileSync(join(RAIZ, arquivo), "utf8"));
      return [
        ...fonte.matchAll(/(?:to=\{?|navigate\()\s*"(\/dashboard[^"]*)"/g),
      ].map((m) => `${arquivo}: ${m[1]}`);
    });
    expect(achados).toEqual([]);
  });
});
