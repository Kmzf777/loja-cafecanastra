# Fundação e Catálogo — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **REGRA DO PROJETO:** todo agente que criar ou alterar componente visual DEVE usar a skill `frontend-design` antes de escrever código.

**Goal:** Converter `frontend/` de Vite para Next.js 15 sem quebrar o painel administrativo, e entregar a camada de catálogo (contrato + mock + repositório) testada, pronta para as páginas do Plano 2.

**Architecture:** O `frontend/` vira um app Next com App Router. Todo o código atual é movido para `legacy/` e o painel é remontado como ilha client-only sob `/dashboard/[[...rota]]`, preservando seu `react-router` interno. A vitrine nasce vazia em `app/`, com Tailwind v4 cujo preflight é escopado para não afetar o legado. A camada `lib/catalogo/` define o contrato `Lote` em TypeScript e o serve a partir de um mock.

**Tech Stack:** Next.js 15 (App Router), React 18.3.1, TypeScript, Tailwind CSS v4, Vitest, `next/font`.

**Spec:** `docs/superpowers/specs/2026-08-14-vitrine-cafe-canastra-nextjs-design.md`
**Estética (normativa):** `estetica.md`

**Diretório de trabalho:** `frontend/` — todos os caminhos abaixo são relativos a ele salvo indicação contrária.

---

## Estrutura de arquivos

| Arquivo | Responsabilidade |
|---|---|
| `next.config.mjs` | Config do Next. Substitui `vite.config.js`. |
| `tsconfig.json` | TS estrito no código novo, `allowJs` para o legado. |
| `app/layout.jsx` | Shell raiz: `<html lang="pt-BR">`, fontes, tokens. |
| `app/page.tsx` | Placeholder da Home (Plano 2 preenche). |
| `app/globals.css` | Import do Tailwind com preflight escopado + tokens `@theme`. |
| `app/dashboard/[[...rota]]/page.tsx` | Ilha client-only do painel. |
| `legacy/PainelApp.jsx` | Router + providers do painel, `basename="/dashboard"`. |
| `legacy/**` | Todo o `src/` atual, movido sem alteração de lógica. |
| `lib/catalogo/tipos.ts` | Contrato `Lote` e tipos auxiliares. |
| `lib/catalogo/mock.ts` | 6 lotes provisórios. |
| `lib/catalogo/repositorio.ts` | `listarLotes`, `obterLote`, `listarSlugs`. |
| `lib/cor.ts` | Utilitário de contraste WCAG, usado no teste de tokens. |
| `vitest.config.ts` | Configuração de teste. |

---

## Task 1: Baseline do painel antes de qualquer mudança

O caminho B coloca o painel em risco. Sem um registro do estado atual, não há como afirmar que ele sobreviveu à conversão.

**Files:**
- Create: `docs/superpowers/plans/baseline-painel.md` (na raiz do repositório, não em `frontend/`)

- [ ] **Step 1: Subir o app Vite atual**

```bash
cd frontend && npm run dev
```

Esperado: `VITE v6.1.1 ready`, servindo em `http://localhost:5173/`.

- [ ] **Step 2: Registrar as rotas do painel que respondem hoje**

Para cada rota abaixo, abrir no navegador autenticado como admin e anotar se renderiza:

```
/dashboard
/dashboard/products/addProduct
/dashboard/products/addedProducts
/dashboard/orders
/dashboard/clients/registeredClients
/dashboard/settings/updateShopInfo
/dashboard/settings/manageCategories
/dashboard/settings/offers
```

Registrar o resultado em `docs/superpowers/plans/baseline-painel.md` numa tabela `rota | renderiza | observação`.

**Nota:** sem PostgreSQL local, rotas que buscam dados vão falhar e derrubar o backend (`backend/src/pgPool.js:19` chama `process.exit(-1)`). Isso é esperado. O critério aqui é **a rota montar e renderizar seu layout**, não trazer dados. Registrar exatamente isso.

- [ ] **Step 3: Commit**

```bash
git add docs/superpowers/plans/baseline-painel.md
git commit -m "docs: baseline das rotas do painel antes da conversao"
```

---

## Task 2: Instalar Next.js e remover o Vite

**Files:**
- Create: `frontend/next.config.mjs`, `frontend/tsconfig.json`
- Modify: `frontend/package.json`
- Delete: `frontend/vite.config.js`, `frontend/index.html`, `frontend/vercel.json`

- [ ] **Step 1: Instalar Next e TypeScript, remover Vite**

```bash
cd frontend
npm install next@15 --save
npm install -D typescript @types/react @types/node
npm uninstall vite @vitejs/plugin-react
```

Manter React em 18.3.1 — **não subir para 19** (spec §3.3: `react-input-mask` do legado quebra).

- [ ] **Step 2: Criar `next.config.mjs`**

```js
/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "res.cloudinary.com" },
    ],
  },
};

export default nextConfig;
```

- [ ] **Step 3: Criar `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["dom", "dom.iterable", "esnext"],
    "allowJs": true,
    "checkJs": false,
    "skipLibCheck": true,
    "strict": true,
    "noEmit": true,
    "esModuleInterop": true,
    "module": "esnext",
    "moduleResolution": "bundler",
    "resolveJsonModule": true,
    "isolatedModules": true,
    "jsx": "preserve",
    "incremental": true,
    "plugins": [{ "name": "next" }],
    "paths": { "@/*": ["./*"] }
  },
  "include": ["next-env.d.ts", "**/*.ts", "**/*.tsx", ".next/types/**/*.ts"],
  "exclude": ["node_modules"]
}
```

`checkJs: false` deixa o `legacy/` fora da checagem, conforme spec §3.4.

- [ ] **Step 4: Trocar os scripts em `package.json`**

```json
"scripts": {
  "dev": "next dev",
  "build": "next build",
  "start": "next start",
  "lint": "next lint"
}
```

- [ ] **Step 5: Remover arquivos do Vite**

```bash
cd frontend && rm vite.config.js index.html vercel.json
```

`vercel.json` só continha o rewrite de SPA, que o Next dispensa (spec §1).

- [ ] **Step 6: Commit**

```bash
git add -A frontend/
git commit -m "chore: instala Next 15 e remove o Vite"
```

---

## Task 3: Mover o código atual para `legacy/` e criar o shell do App Router

**Files:**
- Move: `frontend/src/**` → `frontend/legacy/**`
- Create: `frontend/app/layout.jsx`, `frontend/app/page.tsx`

- [ ] **Step 1: Mover `src/` para `legacy/`**

```bash
cd frontend && git mv src legacy
```

Usar `git mv` para o histórico seguir os arquivos.

- [ ] **Step 2: Criar o layout raiz**

```jsx
// app/layout.jsx
import "./globals.css";

export const metadata = {
  title: "Café Canastra",
  description: "Café que vem de cima. Torrado sob demanda, desde 1985.",
};

export default function RootLayout({ children }) {
  return (
    <html lang="pt-BR">
      <body>{children}</body>
    </html>
  );
}
```

`lang="pt-BR"` é item do checklist de acessibilidade (`estetica.md` §10).

- [ ] **Step 3: Criar a Home placeholder**

```tsx
// app/page.tsx
export default function Home() {
  return <main>Vitrine Café Canastra — em construção.</main>;
}
```

O conteúdo real vem no Plano 2. Aqui só precisamos de uma rota que prove que o App Router funciona.

- [ ] **Step 4: Criar `app/globals.css` mínimo**

```css
/* tokens e Tailwind entram na Task 5 */
:root { color-scheme: light; }
```

- [ ] **Step 5: Subir e verificar**

```bash
cd frontend && npm run dev
```

Abrir `http://localhost:3000/`. Esperado: o texto "Vitrine Café Canastra — em construção."

- [ ] **Step 6: Commit**

```bash
git add -A frontend/
git commit -m "refactor: move src para legacy e cria o shell do App Router"
```

---

## Task 4: Remontar o painel como ilha client-only

Esta é a task de maior risco do plano. O painel tem 20 rotas e não será reescrito na Fase 1.

**Files:**
- Create: `frontend/legacy/PainelApp.jsx`, `frontend/app/dashboard/[[...rota]]/page.tsx`

- [ ] **Step 1: Criar `legacy/PainelApp.jsx`**

Reaproveita os providers e as rotas de dashboard que hoje vivem em `legacy/main.jsx:67-187`. Os caminhos passam a ser **relativos ao basename** — sem o prefixo `/dashboard`.

```jsx
"use client";

import { lazy } from "react";
import { createBrowserRouter, RouterProvider } from "react-router-dom";
import { ToastContainer } from "react-toastify";
import "react-toastify/dist/ReactToastify.css";

import { GlobalStyle } from "./globalStyle/GlobalStyle.jsx";
import ConfigProvider from "./contexts/configContext/configContextProvider.jsx";
import AuthProvider from "./contexts/loginContext/authContextProvider.jsx";
import PromotionsProvider from "./contexts/promotionsContext/promotionsContextProvider.jsx";
import ProductProvider from "./contexts/productContext/productContextProvider.jsx";
import Load from "./load.jsx";

const Dashboard = lazy(() => import("./pages/dashboard/Dashboard.jsx"));
const AdminRoutes = lazy(() => import("./routes/AdminRoutes.jsx"));
const HomeDashboard = lazy(() => import("./components/DashboardSection/Home/HomeDashboard.jsx"));
const Form = lazy(() => import("./components/DashboardSection/GProducts/form/Form.jsx"));
const AddedShirts = lazy(() => import("./components/DashboardSection/GProducts/addedShirts/AddedShirts.jsx"));
const Orders = lazy(() => import("./components/DashboardSection/Orders/Orders.jsx"));
const RegisteredClients = lazy(() => import("./components/DashboardSection/Clients/RegisteredClients/RegisteredClients.jsx"));
const UpdateInfo = lazy(() => import("./components/DashboardSection/Settings/UpdateShopInfo/UpdateInfo.jsx"));
const ManageCategories = lazy(() => import("./components/DashboardSection/Settings/ManageCategories/ManageCategories.jsx"));
const PromotionsManager = lazy(() => import("./components/DashboardSection/Settings/OffersAndCupons/PromotionsManager.jsx"));

const router = createBrowserRouter(
  [
    {
      element: Load(AdminRoutes),
      children: [
        {
          path: "/",
          element: Load(Dashboard),
          children: [
            { index: true, element: Load(HomeDashboard) },
            { path: "products/addProduct", element: Load(Form) },
            { path: "products/addedProducts", element: Load(AddedShirts) },
            { path: "orders", element: Load(Orders) },
            { path: "clients/registeredClients", element: Load(RegisteredClients) },
            { path: "settings/updateShopInfo", element: Load(UpdateInfo) },
            { path: "settings/manageCategories", element: Load(ManageCategories) },
            { path: "settings/offers", element: Load(PromotionsManager) },
          ],
        },
      ],
    },
  ],
  { basename: "/dashboard" },
);

export default function PainelApp() {
  return (
    <ConfigProvider>
      <AuthProvider>
        <PromotionsProvider>
          <ProductProvider>
            <GlobalStyle />
            <ToastContainer position="top-right" autoClose={2000} hideProgressBar closeOnClick style={{ zIndex: 999999 }} />
            <RouterProvider router={router} />
          </ProductProvider>
        </PromotionsProvider>
      </AuthProvider>
    </ConfigProvider>
  );
}
```

- [ ] **Step 2: Criar a rota catch-all**

```tsx
// app/dashboard/[[...rota]]/page.tsx
"use client";

import dynamic from "next/dynamic";

const PainelLegado = dynamic(() => import("@/legacy/PainelApp"), { ssr: false });

export default function Page() {
  return <PainelLegado />;
}
```

`ssr: false` é o que dispensa o registry de styled-components para o legado (spec §3.2).

- [ ] **Step 3: Verificar as 8 rotas contra o baseline**

```bash
cd frontend && npm run dev
```

Abrir cada rota da tabela da Task 1 e comparar com o baseline registrado. Todas devem montar e renderizar o layout.

**Se `createBrowserRouter` com `basename` conflitar com o roteador do Next** (sintoma: tela em branco ou loop de navegação), aplicar o fallback previsto na spec §3.2: trocar para `createMemoryRouter` com a rota inicial derivada de `window.location.pathname`, sincronizando a URL por `history.replaceState` na navegação.

- [ ] **Step 4: Registrar o resultado**

Atualizar `docs/superpowers/plans/baseline-painel.md` com uma coluna `pós-conversão`.

- [ ] **Step 5: Commit**

```bash
git add -A frontend/ docs/
git commit -m "feat: remonta o painel como ilha client-only sob /dashboard"
```

---

## Task 5: Tailwind v4 com preflight escopado

O reset do Tailwind reescreveria os estilos do painel legado. Ele precisa alcançar só a vitrine.

**Files:**
- Create: `frontend/postcss.config.mjs`
- Modify: `frontend/app/globals.css`, `frontend/app/layout.jsx`

- [ ] **Step 1: Instalar**

```bash
cd frontend && npm install -D tailwindcss@4 @tailwindcss/postcss
```

- [ ] **Step 2: Criar `postcss.config.mjs`**

```js
const config = {
  plugins: { "@tailwindcss/postcss": {} },
};
export default config;
```

- [ ] **Step 3: Importar as camadas do Tailwind sem o preflight global**

```css
/* app/globals.css */
@layer theme, base, components, utilities;

@import "tailwindcss/theme.css" layer(theme);
@import "tailwindcss/utilities.css" layer(utilities);
/* preflight NÃO é importado globalmente — ver .vitrine abaixo */
```

**Verificar antes de seguir:** confirmar que esses caminhos de import existem na versão instalada.

```bash
cd frontend && ls node_modules/tailwindcss/*.css
```

Esperado: `theme.css`, `utilities.css`, `preflight.css` entre os arquivos. Se os nomes divergirem, usar os nomes reais.

- [ ] **Step 4: Aplicar o preflight só dentro da vitrine**

```css
/* app/globals.css — continuação */
@layer base {
  .vitrine *,
  .vitrine *::before,
  .vitrine *::after {
    box-sizing: border-box;
    border: 0 solid;
    margin: 0;
    padding: 0;
  }
  .vitrine img,
  .vitrine svg,
  .vitrine video {
    display: block;
    max-width: 100%;
    height: auto;
  }
  .vitrine h1, .vitrine h2, .vitrine h3, .vitrine h4 {
    font-size: inherit;
    font-weight: inherit;
  }
  .vitrine a { color: inherit; text-decoration: inherit; }
  .vitrine button { background: none; font: inherit; cursor: pointer; }
}
```

- [ ] **Step 5: Aplicar a classe no layout, fora do painel**

`app/layout.jsx` não pode aplicar `.vitrine` no `<body>`, senão alcança `/dashboard`. Criar um grupo de rotas para a vitrine:

```jsx
// app/layout.jsx — body permanece neutro
export default function RootLayout({ children }) {
  return (
    <html lang="pt-BR">
      <body>{children}</body>
    </html>
  );
}
```

```tsx
// app/(vitrine)/layout.tsx
export default function VitrineLayout({ children }: { children: React.ReactNode }) {
  return <div className="vitrine">{children}</div>;
}
```

Mover `app/page.tsx` para `app/(vitrine)/page.tsx`. O grupo `(vitrine)` não afeta a URL — `/` continua sendo `/`.

- [ ] **Step 6: Verificar que o painel não mudou**

Abrir `/dashboard` e comparar visualmente com o baseline da Task 1. Nenhuma diferença de espaçamento, fonte ou cor é aceitável aqui.

Abrir `/` e confirmar que uma classe utilitária do Tailwind funciona — trocar o placeholder por `<main className="p-8 text-2xl">` e ver o efeito.

- [ ] **Step 7: Commit**

```bash
git add -A frontend/
git commit -m "feat: Tailwind v4 com preflight escopado a vitrine"
```

---

## Task 6: Tokens do estetica.md

**Files:**
- Modify: `frontend/app/globals.css`

- [ ] **Step 1: Declarar os tokens como `@theme`**

Valores copiados de `estetica.md` §4.1 e §4.3, sem reinterpretação.

```css
/* app/globals.css — após os imports */
@theme {
  --color-fuligem: #14110E;
  --color-fuligem-80: #3A342E;
  --color-fuligem-55: #6E655C;
  --color-fuligem-20: #CFC8BE;
  --color-cal: #F1F0EA;
  --color-cal-puro: #FBFAF7;
  --color-juta: #C9A87A;
  --color-juta-claro: #E2D3B8;
  --color-barro: #8E4B2E;
  --color-mata: #2C3B2E;
  --color-vermelho: #C4231E;
  --color-vermelho-esc: #9A1A16;
  --color-sucesso: #3F6B45;
  --color-alerta: #B87514;

  --radius-cx: 0px;
  --radius-bt: 2px;

  --ease-canastra: cubic-bezier(.22, 1, .36, 1);
}
```

- [ ] **Step 2: Verificar que geram utilitários**

Aplicar `className="bg-fuligem text-cal"` na Home e confirmar no navegador: fundo quase preto, texto quase branco.

- [ ] **Step 3: Commit**

```bash
git add frontend/app/globals.css
git commit -m "feat: tokens de cor e raio do estetica.md"
```

---

## Task 7: Teste das proibições de contraste

`estetica.md` §4.1 pede explicitamente: *"Codificar essas duas proibições como lint/teste visual, porque são erros que acontecem sozinhos."*

**Files:**
- Create: `frontend/vitest.config.ts`, `frontend/lib/cor.ts`, `frontend/lib/cor.test.ts`

- [ ] **Step 1: Instalar Vitest**

```bash
cd frontend && npm install -D vitest
```

- [ ] **Step 2: Criar `vitest.config.ts`**

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: { environment: "node", include: ["**/*.test.ts"] },
});
```

Adicionar em `package.json`: `"test": "vitest run"`.

- [ ] **Step 3: Escrever o teste que falha**

```ts
// lib/cor.test.ts
import { describe, it, expect } from "vitest";
import { razaoContraste } from "./cor";

const T = {
  fuligem: "#14110E",
  cal: "#F1F0EA",
  juta: "#C9A87A",
  mata: "#2C3B2E",
  vermelho: "#C4231E",
  branco: "#FFFFFF",
};

describe("contraste dos tokens", () => {
  it("fuligem sobre cal atinge AAA", () => {
    expect(razaoContraste(T.fuligem, T.cal)).toBeGreaterThanOrEqual(7);
  });

  it("branco sobre vermelho atinge AA", () => {
    expect(razaoContraste(T.branco, T.vermelho)).toBeGreaterThanOrEqual(4.5);
  });

  // As duas proibicoes do estetica.md §4.1
  it("PROIBIDO: branco sobre juta nao atinge AA", () => {
    expect(razaoContraste(T.branco, T.juta)).toBeLessThan(4.5);
  });

  it("PROIBIDO: vermelho sobre mata nao atinge AA", () => {
    expect(razaoContraste(T.vermelho, T.mata)).toBeLessThan(4.5);
  });
});
```

Os dois últimos testes documentam por que as combinações são proibidas: se alguém trocar um token e elas passarem a ser legíveis, o teste falha e força revisão consciente da paleta.

- [ ] **Step 4: Rodar e ver falhar**

```bash
cd frontend && npm test
```

Esperado: FAIL — `Failed to resolve import "./cor"`.

- [ ] **Step 5: Implementar**

```ts
// lib/cor.ts

/** Converte "#RRGGBB" nos canais 0-255. */
function canais(hex: string): [number, number, number] {
  const h = hex.replace("#", "");
  return [
    parseInt(h.slice(0, 2), 16),
    parseInt(h.slice(2, 4), 16),
    parseInt(h.slice(4, 6), 16),
  ];
}

/** Luminancia relativa conforme WCAG 2.1. */
function luminancia(hex: string): number {
  const [r, g, b] = canais(hex).map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** Razao de contraste WCAG entre duas cores hex. Vai de 1 a 21. */
export function razaoContraste(a: string, b: string): number {
  const la = luminancia(a);
  const lb = luminancia(b);
  const [claro, escuro] = la > lb ? [la, lb] : [lb, la];
  return (claro + 0.05) / (escuro + 0.05);
}
```

- [ ] **Step 6: Rodar e ver passar**

```bash
cd frontend && npm test
```

Esperado: 4 testes passando.

- [ ] **Step 7: Commit**

```bash
git add -A frontend/
git commit -m "test: codifica as proibicoes de contraste do estetica.md"
```

---

## Task 8: Contrato `Lote`

**Files:**
- Create: `frontend/lib/catalogo/tipos.ts`

- [ ] **Step 1: Escrever o contrato**

Transcrição do §4 da spec. Preço em **centavos, inteiro** — ponto flutuante em dinheiro é defeito.

```ts
// lib/catalogo/tipos.ts

export type Linha = "classico" | "suave" | "aromatizado";

export type Moagem =
  | "grao" | "espresso" | "coado-papel" | "coador-pano"
  | "prensa-francesa" | "italiana-moka" | "aeropress";

export type Metodo = Exclude<Moagem, "grao">;

export type PesoGramas = 250 | 500 | 1000;

export type Imagem = { src: string; alt: string; w: number; h: number };

export type Variante = {
  sku: string;
  moagem: Moagem;
  pesoGramas: PesoGramas;
  /** Em centavos. 4200 = R$ 42,00 */
  preco: number;
  estoque: number;
};

export type Preparo = {
  metodo: Metodo;
  proporcao: string;
  gramas: number;
  ml: number;
  temperaturaC: number;
  tempoSegundos: number;
  moagem: string;
};

export type Lavoura = {
  altitude: number;
  variedade: string;
  processo: string;
  safra: number;
  produtor: string;
  municipio: string;
};

export type Lote = {
  slug: string;
  nome: string;
  linha: Linha;
  notas: string[];
  pontoTorra: 1 | 2 | 3 | 4 | 5;
  sca: number;
  descricao: string;
  lavoura: Lavoura;
  fotos: { sabor: Imagem; pacote: Imagem; terreiro?: Imagem; moido?: Imagem };
  variantes: Variante[];
  preparo: Preparo[];
  assinatura?: { desconto: number; frequenciasDias: number[] };
};

export type Filtros = {
  linha?: Linha;
  pontoTorraMin?: number;
  pontoTorraMax?: number;
  scaMin?: number;
  notas?: string[];
  moagem?: Moagem;
};

export const MOAGENS: { valor: Moagem; rotulo: string }[] = [
  { valor: "grao", rotulo: "Grão" },
  { valor: "espresso", rotulo: "Espresso" },
  { valor: "coado-papel", rotulo: "Coado (papel)" },
  { valor: "coador-pano", rotulo: "Coador de pano" },
  { valor: "prensa-francesa", rotulo: "Prensa francesa" },
  { valor: "italiana-moka", rotulo: "Italiana / Moka" },
  { valor: "aeropress", rotulo: "Aeropress" },
];
```

`MOAGENS` fixa a ordem e os rótulos exatos de `estetica.md` §5.5 num lugar só, para o seletor da PDP e o filtro da PLP não divergirem.

- [ ] **Step 2: Verificar que compila**

```bash
cd frontend && npx tsc --noEmit
```

Esperado: sem erros.

- [ ] **Step 3: Commit**

```bash
git add frontend/lib/catalogo/tipos.ts
git commit -m "feat: contrato de dados do Lote"
```

---

## Task 9: Mock do catálogo

**Files:**
- Create: `frontend/lib/catalogo/mock.ts`, `frontend/lib/catalogo/mock.test.ts`

- [ ] **Step 1: Escrever o teste de contrato que falha**

```ts
// lib/catalogo/mock.test.ts
import { describe, it, expect } from "vitest";
import { LOTES } from "./mock";
import { MOAGENS } from "./tipos";

describe("mock do catalogo", () => {
  it("tem ao menos 6 lotes", () => {
    expect(LOTES.length).toBeGreaterThanOrEqual(6);
  });

  it("tem slugs unicos", () => {
    const slugs = LOTES.map((l) => l.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
  });

  it("tem preco inteiro em centavos e positivo", () => {
    for (const lote of LOTES) {
      for (const v of lote.variantes) {
        expect(Number.isInteger(v.preco)).toBe(true);
        expect(v.preco).toBeGreaterThan(0);
      }
    }
  });

  it("tem ao menos uma variante por lote", () => {
    for (const lote of LOTES) expect(lote.variantes.length).toBeGreaterThan(0);
  });

  it("so usa moagens do contrato", () => {
    const validas = new Set(MOAGENS.map((m) => m.valor));
    for (const lote of LOTES) {
      for (const v of lote.variantes) expect(validas.has(v.moagem)).toBe(true);
    }
  });

  it("tem ponto de torra entre 1 e 5", () => {
    for (const lote of LOTES) {
      expect(lote.pontoTorra).toBeGreaterThanOrEqual(1);
      expect(lote.pontoTorra).toBeLessThanOrEqual(5);
    }
  });

  it("tem altitude real por lote — requisito do Escolha pela Serra", () => {
    for (const lote of LOTES) expect(lote.lavoura.altitude).toBeGreaterThan(0);
  });

  it("tem altitudes distintas, senao o eixo da serra nao existe", () => {
    const alts = LOTES.map((l) => l.lavoura.altitude);
    expect(new Set(alts).size).toBe(alts.length);
  });

  it("tem alt text descritivo em toda foto", () => {
    for (const lote of LOTES) {
      expect(lote.fotos.sabor.alt.length).toBeGreaterThan(10);
      expect(lote.fotos.pacote.alt.length).toBeGreaterThan(10);
    }
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

```bash
cd frontend && npm test
```

Esperado: FAIL — `Failed to resolve import "./mock"`.

- [ ] **Step 3: Escrever o mock**

**Os dados são provisórios e precisam estar marcados como tais** (spec §9). Usar as três linhas reais da marca — Clássico, Suave e com canela — e as imagens que já existem em `public/`.

Cabeçalho obrigatório do arquivo:

```ts
// lib/catalogo/mock.ts
//
// DADOS PROVISÓRIOS. Altitude, pontuação SCA, variedade, processo, safra e
// produtor são plausíveis mas NÃO são reais. Substituir por dados de lote
// verdadeiros antes de qualquer publicação — estetica.md §6 é explícito:
// sem altitude real o eixo da serra vira ficção e a marca perde credibilidade.

import type { Lote, Moagem, PesoGramas } from "./tipos";

const PRECO_BASE: Record<PesoGramas, number> = { 250: 4200, 500: 7600, 1000: 14200 };

const MOAGENS_PADRAO: Moagem[] = [
  "grao", "espresso", "coado-papel", "coador-pano",
  "prensa-francesa", "italiana-moka", "aeropress",
];

/** Matriz completa moagem x peso. A PDP desabilita o que nao existir. */
function variantes(slug: string, fator = 1): Lote["variantes"] {
  const out: Lote["variantes"] = [];
  for (const moagem of MOAGENS_PADRAO) {
    for (const peso of [250, 500, 1000] as PesoGramas[]) {
      out.push({
        sku: `${slug}-${moagem}-${peso}`,
        moagem,
        pesoGramas: peso,
        preco: Math.round(PRECO_BASE[peso] * fator),
        estoque: 20,
      });
    }
  }
  return out;
}
```

Em seguida, `LOTES`. Este é o **primeiro lote completo — copiar como molde para os outros cinco**:

```ts
export const LOTES: Lote[] = [
  {
    slug: "casca-danta",
    nome: "Casca d'Anta",
    linha: "classico",
    notas: ["rapadura", "castanha-do-para", "cacau"],
    pontoTorra: 3,
    sca: 84.25,
    descricao: "1.320 metros. Noite fria, grão doce.",
    lavoura: {
      altitude: 1320,
      variedade: "Catuaí Amarelo 62",
      processo: "Natural",
      safra: 2025,
      produtor: "Sítio Boa Vista",
      municipio: "São Roque de Minas — MG",
    },
    fotos: {
      // FALLBACK: falta a foto de sabor — estetica.md §8
      sabor: {
        src: "/cafe-classico.png",
        alt: "Pacote preto do Café Canastra Clássico sobre fundo claro",
        w: 1200, h: 1500,
      },
      pacote: {
        src: "/cafe-classico.png",
        alt: "Pacote preto do Café Canastra Clássico, 250 g",
        w: 1200, h: 1500,
      },
    },
    variantes: variantes("casca-danta", 1.05),
    preparo: [
      {
        metodo: "coado-papel",
        proporcao: "1:15",
        gramas: 30, ml: 450,
        temperaturaC: 94,
        tempoSegundos: 180,
        moagem: "Média",
      },
      {
        metodo: "prensa-francesa",
        proporcao: "1:14",
        gramas: 32, ml: 450,
        temperaturaC: 93,
        tempoSegundos: 240,
        moagem: "Grossa",
      },
    ],
    assinatura: { desconto: 0.1, frequenciasDias: [15, 30, 45] },
  },
  // … mais cinco lotes no mesmo formato
];
```

Os outros cinco, com **altitudes distintas** (o teste exige) e nomes do território (`estetica.md` §2): `sao-roque` (1180 m), `chapadao` (1150 m), `nascente` (1250 m), `vargem` (1020 m), `porteira` (900 m).

Regras ao preencher:
- `linha`: distribuir entre `classico`, `suave` e `aromatizado`.
- `fotos.pacote.src`: usar `/cafe-classico.png`, `/cafe-suave.png` ou `/cafe-canela.png` conforme a linha.
- `fotos.sabor.src`: **não existe foto de sabor no projeto** (spec §9). Usar o mesmo arquivo do pacote como fallback provisório e deixar comentário `// FALLBACK: falta a foto de sabor — estetica.md §8`.
- `alt`: descritivo da foto, não do SEO. Ex.: `"Pacote preto do Café Canastra Clássico sobre tábua de madeira escura"`.
- `descricao`: no tom de `estetica.md` §11 — frase curta, concreta, sem adjetivo publicitário. Ex.: `"1.320 metros. Noite fria, grão doce."`
- `preparo`: ao menos `coado-papel` e `prensa-francesa` por lote.

- [ ] **Step 4: Rodar e ver passar**

```bash
cd frontend && npm test
```

Esperado: todos os testes de `mock.test.ts` passando.

- [ ] **Step 5: Commit**

```bash
git add -A frontend/lib/catalogo/
git commit -m "feat: mock do catalogo com 6 lotes provisorios"
```

---

## Task 10: Repositório do catálogo

**Files:**
- Create: `frontend/lib/catalogo/repositorio.ts`, `frontend/lib/catalogo/repositorio.test.ts`

Nenhuma página conhece a origem do dado. Trocar mock por API é reescrever só este arquivo (spec §4).

- [ ] **Step 1: Escrever o teste que falha**

```ts
// lib/catalogo/repositorio.test.ts
import { describe, it, expect } from "vitest";
import { listarLotes, obterLote, listarSlugs, precoMinimo } from "./repositorio";

describe("repositorio do catalogo", () => {
  it("lista todos os lotes sem filtro", async () => {
    expect((await listarLotes()).length).toBeGreaterThanOrEqual(6);
  });

  it("filtra por linha", async () => {
    const r = await listarLotes({ linha: "suave" });
    expect(r.length).toBeGreaterThan(0);
    expect(r.every((l) => l.linha === "suave")).toBe(true);
  });

  it("filtra por faixa de ponto de torra", async () => {
    const r = await listarLotes({ pontoTorraMin: 3, pontoTorraMax: 4 });
    expect(r.every((l) => l.pontoTorra >= 3 && l.pontoTorra <= 4)).toBe(true);
  });

  it("filtra por SCA minima", async () => {
    const r = await listarLotes({ scaMin: 84 });
    expect(r.every((l) => l.sca >= 84)).toBe(true);
  });

  it("filtra por nota de sabor", async () => {
    const todos = await listarLotes();
    const nota = todos[0].notas[0];
    const r = await listarLotes({ notas: [nota] });
    expect(r.every((l) => l.notas.includes(nota))).toBe(true);
  });

  it("combina filtros", async () => {
    const r = await listarLotes({ linha: "classico", scaMin: 80 });
    expect(r.every((l) => l.linha === "classico" && l.sca >= 80)).toBe(true);
  });

  it("devolve lista vazia quando nada casa, nunca erro", async () => {
    expect(await listarLotes({ scaMin: 99 })).toEqual([]);
  });

  it("obtem lote por slug", async () => {
    const lote = await obterLote("casca-danta");
    expect(lote?.slug).toBe("casca-danta");
  });

  it("devolve null para slug inexistente", async () => {
    expect(await obterLote("nao-existe")).toBeNull();
  });

  it("lista os slugs para generateStaticParams", async () => {
    const slugs = await listarSlugs();
    expect(slugs).toContain("casca-danta");
  });

  it("calcula o preco minimo do lote", async () => {
    const lote = await obterLote("casca-danta");
    expect(precoMinimo(lote!)).toBe(
      Math.min(...lote!.variantes.map((v) => v.preco)),
    );
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

```bash
cd frontend && npm test
```

Esperado: FAIL — `Failed to resolve import "./repositorio"`.

- [ ] **Step 3: Implementar**

Funções `async` de propósito: quando a API real entrar, a assinatura não muda e nenhuma página precisa ser tocada.

```ts
// lib/catalogo/repositorio.ts
import { LOTES } from "./mock";
import type { Filtros, Lote } from "./tipos";

export async function listarLotes(filtros: Filtros = {}): Promise<Lote[]> {
  return LOTES.filter((lote) => {
    if (filtros.linha && lote.linha !== filtros.linha) return false;
    if (filtros.pontoTorraMin && lote.pontoTorra < filtros.pontoTorraMin) return false;
    if (filtros.pontoTorraMax && lote.pontoTorra > filtros.pontoTorraMax) return false;
    if (filtros.scaMin && lote.sca < filtros.scaMin) return false;
    if (filtros.moagem && !lote.variantes.some((v) => v.moagem === filtros.moagem)) return false;
    if (filtros.notas?.length && !filtros.notas.every((n) => lote.notas.includes(n))) return false;
    return true;
  });
}

export async function obterLote(slug: string): Promise<Lote | null> {
  return LOTES.find((l) => l.slug === slug) ?? null;
}

export async function listarSlugs(): Promise<string[]> {
  return LOTES.map((l) => l.slug);
}

/** Menor preco entre as variantes — o "a partir de" do card. */
export function precoMinimo(lote: Lote): number {
  return Math.min(...lote.variantes.map((v) => v.preco));
}

/** Centavos para "R$ 42,00". */
export function formatarPreco(centavos: number): string {
  return (centavos / 100).toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
  });
}
```

- [ ] **Step 4: Rodar e ver passar**

```bash
cd frontend && npm test
```

Esperado: todos passando.

- [ ] **Step 5: Commit**

```bash
git add -A frontend/lib/catalogo/
git commit -m "feat: repositorio do catalogo com filtros"
```

---

## Task 11: Fontes

**Files:**
- Modify: `frontend/app/layout.jsx`, `frontend/app/globals.css`

- [ ] **Step 1: Carregar Archivo e Martian Mono**

Ambas estão no Google Fonts. A Archivo é a única com `preload` (`estetica.md` §10 — a Redaction só afeta títulos e pode chegar depois).

```jsx
// app/layout.jsx
import { Archivo, Martian_Mono } from "next/font/google";
import "./globals.css";

const archivo = Archivo({
  subsets: ["latin", "latin-ext"],
  variable: "--fonte-ui",
  display: "swap",
  preload: true,
});

const martianMono = Martian_Mono({
  subsets: ["latin"],
  variable: "--fonte-dado",
  display: "swap",
  preload: false,
});

export const metadata = {
  title: "Café Canastra",
  description: "Café que vem de cima. Torrado sob demanda, desde 1985.",
};

export default function RootLayout({ children }) {
  return (
    <html lang="pt-BR" className={`${archivo.variable} ${martianMono.variable}`}>
      <body>{children}</body>
    </html>
  );
}
```

- [ ] **Step 2: Registrar as famílias no tema**

```css
/* app/globals.css — dentro do bloco @theme */
--font-ui: var(--fonte-ui), system-ui, sans-serif;
--font-dado: var(--fonte-dado), ui-monospace, monospace;
--font-titulo: "Redaction 35", Georgia, serif;
```

- [ ] **Step 3: Verificar**

```bash
cd frontend && npm run dev
```

Aplicar `className="font-dado"` em um número na Home e confirmar no navegador que ele renderiza em monoespaçada.

- [ ] **Step 4: Documentar a pendência da Redaction**

A Redaction **não está no Google Fonts** e não pode ser instalada automaticamente. Criar `frontend/app/fontes/LEIA-ME.md`:

```markdown
# Redaction 35 — pendente

Baixar de https://www.redaction.us (gratuita, Jeremy Mickel / Forest Young),
converter para .woff2 e colocar `Redaction_35-Regular.woff2` nesta pasta.

Depois, trocar a declaracao `--font-titulo` em `app/globals.css` por um
`next/font/local` apontando para o arquivo.

Ate la, os titulos caem no fallback Georgia. Isso e visivel e esperado —
a Redaction so e usada em tamanhos >= 40px (estetica.md §4.2).
```

- [ ] **Step 5: Commit**

```bash
git add -A frontend/
git commit -m "feat: carrega Archivo e Martian Mono; documenta pendencia da Redaction"
```

---

## Task 12: Verificação final da fundação

**Files:** nenhum novo.

- [ ] **Step 1: Suíte de testes**

```bash
cd frontend && npm test
```

Esperado: todos passando, sem teste pulado.

- [ ] **Step 2: Checagem de tipos**

```bash
cd frontend && npx tsc --noEmit
```

Esperado: sem erros.

- [ ] **Step 3: Build de produção**

```bash
cd frontend && npm run build
```

Esperado: build conclui. `/` aparece como estática; `/dashboard/[[...rota]]` como dinâmica.

- [ ] **Step 4: Painel contra o baseline**

Subir `npm run dev` e conferir as 8 rotas da Task 1 mais uma vez. Comparar com `docs/superpowers/plans/baseline-painel.md`.

**Critério:** nenhuma rota que renderizava antes pode ter parado de renderizar. Se alguma quebrou, corrigir antes de fechar o plano — não seguir para o Plano 2.

- [ ] **Step 5: Commit final**

```bash
git add -A
git commit -m "chore: fundacao Next + catalogo verificados"
```

---

## Definição de pronto

- [ ] `npm test` passa
- [ ] `npx tsc --noEmit` passa
- [ ] `npm run build` conclui
- [ ] As 8 rotas do painel renderizam como no baseline
- [ ] `/` responde em Next com Tailwind e tokens funcionando
- [ ] Vite removido do `package.json`
- [ ] Pendências registradas: foto de sabor, SVGs do logo, `path` da serra, dados reais de lote, Redaction

## O que fica para o Plano 2

Componentes (`<SeloSCA>`, `<PontoTorra>`, `<CardCafe>`, `<FichaLavoura>`, `<SeletorMoagem>`, `<ModoCompra>`, `<Header>`, `<Rodape>`, `<GavetaSacola>`, `<Serra>`) e as rotas `/`, `/cafes`, `/cafes/[slug]`, `/a-serra`, `/clube`, `/sacola`, institucionais. Todo agente que trabalhar nesses arquivos usa a skill `frontend-design`.
