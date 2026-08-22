import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

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
  resolve: {
    alias: {
      "@": fileURLToPath(new URL(".", import.meta.url)),
    },
  },
  oxc: {
    jsx: { runtime: "automatic", importSource: "react" },
  },
  test: {
    environment: "node",
    include: ["**/*.test.ts", "**/*.test.tsx"],
  },
});
