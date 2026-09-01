import { fileURLToPath } from "node:url";
import { defineConfig, defaultExclude } from "vitest/config";

const alias = { "@": fileURLToPath(new URL(".", import.meta.url)) };
const jsx = { runtime: "automatic" as const, importSource: "react" };

/** Os arquivos do painel, que precisam de DOM de verdade — ver o comentário
 *  grande dentro de `test.projects` logo abaixo. */
const GLOBS_DO_PAINEL = [
  "app/dashboard/**/*.test.ts",
  "app/dashboard/**/*.test.tsx",
  "components/painel/**/*.test.ts",
  "components/painel/**/*.test.tsx",
  "lib/teste/renderizar.test.tsx",
];

/**
 * A suíte da vitrine.
 *
 * OS TRÊS CAMPOS ABAIXO DO `environment` ENTRARAM NA ONDA 4, e cada um
 * consertava a mesma falha silenciosa: `components/layout/SeletorDeIdioma.test.tsx`
 * — o primeiro teste de COMPONENTE do repositório, 12 casos, verde quando
 * forçado à mão — não era coletado por `npm test`. O arquivo existia, passava,
 * e não contava para número nenhum. Um teste invisível é pior que teste
 * ausente: ele dá a sensação de cobertura sem entregá-la.
 *
 *  - `include` só listava `.test.ts`, e o teste de componente é `.test.tsx`;
 *  - o alias `@` não era resolvido, e o componente importa `@/lib/i18n/tipos`
 *    (é por isso que lib/i18n/rotas.ts e lib/seo/jsonld.ts trazem, no topo, a
 *    nota "imports relativos, não `@/`" — era contorno desta lacuna);
 *  - sem `oxc.jsx`, o JSX herdava `jsx: "preserve"` do tsconfig do Next, que
 *    espera o compilador do próprio Next depois. `esbuild` NÃO serve aqui: o
 *    Vitest 4 avisa "Both esbuild and oxc options were set. oxc options will be
 *    used" e ignora o primeiro.
 */
export default defineConfig({
  /**
   * O DOM entra AQUI E SÓ AQUI.
   *
   * A suíte da vitrine roda em `environment: "node"` e assim continua: são
   * 779 casos escritos contra `renderToStaticMarkup`, e trocar o ambiente de
   * todos eles é mudar a filosofia de teste do repositório inteiro por causa
   * de uma área nova.
   *
   * Mas painel administrativo é interativo por definição — barra de salvar
   * que aparece quando o formulário suja, seleção em massa que distingue "os
   * 50 da página" dos "1.284 do filtro", devolução de foco ao fechar o painel
   * lateral. `renderToStaticMarkup` NÃO EXECUTA EFEITO: uma ilha de cliente
   * renderiza vazio e o teste passa provando nada.
   *
   * A regra de divisão continua sendo a da spec §2.8: a DECISÃO vive num
   * módulo puro `*.logica.ts` e é testada em `node`; o DOM cobre só o que a
   * função pura não alcança.
   *
   * NOTA DE IMPLEMENTAÇÃO — `environmentMatchGlobs` NÃO EXISTE no Vitest
   * instalado (4.1.10). Era o mecanismo desta doutrina em versões antigas do
   * Vitest, mas foi REMOVIDO na 4.0 (conferido em node_modules/vitest: zero
   * ocorrências em todo o pacote; e na documentação oficial de migração,
   * https://vitest.dev/guide/migration.html, que diz textualmente
   * "environmentMatchGlobs config option. Use projects instead."). O
   * substituto é `projects` — mas ele não é um "adicional" ao `test` de cima:
   * ASSIM QUE `test.projects` EXISTE, o `test` de nível raiz PARA DE RODAR
   * SOZINHO (medido: sem o projeto "vitrine" abaixo, `npm test` caía de 891
   * para 1 caso — só o do painel — em silêncio, sem erro). Por isso a raiz
   * também vira um projeto explícito, e os dois somados são o total.
   *
   * Nenhum projeto usa `extends: true` de propósito. Um projeto que estende
   * outra config tem seus arrays de `include`/`exclude` CONCATENADOS com os
   * da config estendida (é o `mergeConfig` do Vite por trás — arrays somam,
   * não substituem): o projeto "painel-dom" estendendo a raiz herdaria o
   * `include` amplo da vitrine e voltaria a rodar tudo em jsdom também. Por
   * isso os dois projetos abaixo são AUTOSSUFICIENTES: cada um repete só o
   * `alias` e o `jsx` (as duas linhas que precisa) e declara seu próprio
   * `include`/`exclude`, sem depender de herança nenhuma.
   */
  test: {
    projects: [
      {
        resolve: { alias },
        oxc: { jsx },
        test: {
          name: "vitrine",
          environment: "node",
          include: ["**/*.test.ts", "**/*.test.tsx"],
          // Os arquivos do painel saem daqui — eles rodam no projeto
          // "painel-dom" logo abaixo, em jsdom. Sem este exclude os dois
          // projetos rodariam o MESMO arquivo duas vezes (uma em node, outra
          // em jsdom): `projects` no Vitest 4 não tem noção de "primeiro
          // match vence" entre projetos, cada projeto colige por si.
          exclude: [...defaultExclude, ...GLOBS_DO_PAINEL],
        },
      },
      {
        resolve: { alias },
        oxc: { jsx },
        test: {
          name: "painel-dom",
          environment: "jsdom",
          include: GLOBS_DO_PAINEL,
        },
      },
    ],
  },
});
