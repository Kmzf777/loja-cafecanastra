# Vitrine Café Canastra em Next.js — Design

**Data:** 2026-08-14
**Escopo:** Fase 1 — loja pública. O painel `/dashboard` fica fora, preservado como legado.
**Documento de estética:** `estetica.md` (v1.0) — referência normativa para tudo que é visual.

---

## 1. Contexto e objetivo

O projeto partiu de uma base de e-commerce em Vite + React + Express + PostgreSQL, adotada por já trazer integrações prontas: Mercado Pago (checkout transparente e webhook), Melhor Envio (frete), Cloudinary (imagens), Resend (e-mail) e autenticação com JWT + refresh em cookie httpOnly.

Essa base será substituída pela vitrine do **Café Canastra**, seguindo o `estetica.md`. A estética atual é descartada por completo.

### Por que Next.js, e não Vite

A decisão não é de preferência — é imposta por dois critérios de aceite do próprio `estetica.md` §12:

1. **"Site funcional com JS desabilitado até a etapa de checkout."** Uma SPA Vite entrega `<div id="root"></div>` e nada mais quando o JS não roda. Nenhum esforço de implementação contorna isso.
2. **LCP < 2,0 s em 4G** com SEO e Open Graph nas páginas de produto.

O Vite não é removido por ser ruim: ele é excelente no que faz e continuaria sendo a escolha certa se o projeto fosse só o painel. Ele sai porque a vitrine precisa de HTML renderizado no servidor.

### O que o Vite tinha de bom, e que perdemos conscientemente

- Boot de dev em ~1,4 s (medido neste projeto). O Next em dev é mais lento.
- Modelo mental de execução única: tudo é cliente, sem `"use client"`, sem hydration mismatch.
- Deploy estático puro em CDN, mais barato.

Isso é aceito como custo. Não é uma perda invisível — quem for manter o projeto deve saber que foi uma troca, não um upgrade gratuito.

---

## 2. Decisões travadas

| # | Decisão | Consequência |
|---|---|---|
| 1 | Backend Express continua **separado** | Next é só frontend; consome a API por HTTP |
| 2 | Fase 1 = **loja pública**; painel fica para a Fase 2 | 24 rotas viram ~10 novas + 1 ilha legada |
| 3 | **Tailwind CSS** substitui styled-components na vitrine | Sem conversão: as telas são reescritas |
| 4 | **Contrato de dados primeiro**, frontend contra mock tipado | Destrava o desenvolvimento sem depender de Postgres |
| 5 | **Converter `frontend/` no lugar** (caminho B) | O painel precisa sobreviver na mesma pasta — ver §3 |

A decisão 5 foi tomada contra a recomendação de criar um projeto novo em pasta irmã. O risco que ela introduz é concreto e está tratado em §3.3: o reset do Tailwind afeta os estilos do painel legado.

---

## 3. Arquitetura

### 3.1 Estrutura de pastas

```
frontend/
├── next.config.mjs           substitui vite.config.js
├── app/
│   ├── layout.jsx            fontes, tokens, grão de papel, <html lang="pt-BR">
│   ├── page.jsx              Home                              §7.1 estetica
│   ├── cafes/
│   │   ├── page.jsx          PLP + filtros via searchParams     §7.2
│   │   └── [slug]/page.jsx   PDP — SSG + generateMetadata       §7.3
│   ├── a-serra/page.jsx      institucional                      §7.5
│   ├── clube/page.jsx        assinatura                         §7.4
│   ├── sacola/page.jsx
│   ├── checkout/…
│   ├── conta/…               login, cadastro, pedidos
│   ├── termos-de-uso/, politica-de-privacidade/
│   └── dashboard/
│       └── [[...rota]]/page.jsx    ilha client-only do legado
├── components/               novos, Tailwind
├── lib/
│   ├── catalogo/             contrato Lote + mock + adapters
│   └── api/                  cliente HTTP, CSRF, sessão
└── legacy/                   painel atual, movido de src/
```

### 3.2 O painel como ilha client-only

O painel não é reescrito na Fase 1. Ele é montado sob uma rota catch-all:

```jsx
// app/dashboard/[[...rota]]/page.jsx
"use client";
import dynamic from "next/dynamic";
const PainelLegado = dynamic(() => import("@/legacy/PainelApp"), { ssr: false });
export default function Page() {
  return <PainelLegado />;
}
```

`PainelLegado` preserva o `react-router` interno e os providers atuais. As **8 rotas** do painel (índice + 7 telas) seguem funcionando sem reescrita. As demais rotas de `main.jsx` pertencem à vitrine (`/site`, `/checkout/*`, `/account/*`, institucionais) e ficam deliberadamente sem servir — são reescritas no Plano 2. Como nada ali renderiza no servidor, os styled-components do legado **não precisam de registry de SSR** — o risco de FOUC desaparece justamente na parte que não vamos consertar.

**Sem `basename`** — corrigido durante a implementação. A intenção original era `createBrowserRouter(..., { basename: "/dashboard" })`, mas isso quebra o painel: o react-router aplica o basename também a caminhos **absolutos**, e o legado navega por absolutos (`to="/dashboard/orders"` em `MenuAside.jsx`). Os links passavam a apontar para `/dashboard/dashboard/orders` e o menu inteiro parava, embora o acesso por URL direta continuasse funcionando. A solução é manter os paths absolutos idênticos aos de `main.jsx` e não declarar basename — nenhum componente legado precisa ser editado.

Lição de verificação registrada: **testar rota por HTTP não prova que o painel funciona.** O código de status estava correto justamente enquanto a navegação estava quebrada. Verificações do painel precisam inspecionar o DOM renderizado e a navegação client-side.

Duas correções em `legacy/` foram necessárias, ambas quebras reais da migração e não melhorias:

- `routes/AdminRoutes.jsx` importava `../../src/contexts/…`, caminho extinto quando `src/` virou `legacy/`.
- `api.js` usava `import.meta.env.VITE_API_URL`, exclusivo do Vite. O webpack o compila para `undefined.VITE_API_URL`, lançando `TypeError` na avaliação do módulo — como os quatro contexts do painel importam `api.js`, as oito rotas ficariam em branco. Passou a `process.env.NEXT_PUBLIC_API_URL`, mantendo o fallback `http://localhost:3333`.

### 3.3 Imagens estáticas: `.src` no legado, `next/image` na vitrine

No Vite, `import logo from "./logo.png"` devolve uma string; no Next devolve `StaticImageData`. Todo `<img src={logo}>` do legado passa a pedir `/[object Object]` — **sem erro no console**, apenas a imagem quebrada.

A correção adotada é acessar `.src` nos pontos de uso do legado. A alternativa de uma linha, `images: { disableStaticImages: true }`, foi **descartada**: ela desligaria o static import em todo o projeto, inclusive na vitrine, que depende dele para obter `width`/`height` automáticos via `next/image` — exigência do `estetica.md` §10 para zerar CLS e sustentar a meta de LCP < 2,0 s.

### 3.4 Mitigações do caminho B

| Risco | Mitigação |
|---|---|
| Preflight do Tailwind reescreve os estilos do painel legado | Desabilitar o preflight global e aplicá-lo por escopo: a vitrine roda dentro de um contêiner com o reset; `/dashboard/*` fica fora dele. **Primeira tarefa do plano**, com verificação visual do painel antes e depois — não descoberta depois. |
| `react-input-mask` (legado) quebra no React 19 | Permanecer no **React 18.3.1**. Next 15 suporta. Subida para 19 fica na Fase 2, junto da reescrita do painel. |
| `react-router` e `next/navigation` coexistindo | Coexistem **apenas** dentro da ilha do painel. A vitrine nunca importa `react-router`. |
| Código antigo da vitrine poluindo o repositório | É deletado conforme cada rota nova entra, não mantido em paralelo. |

### 3.5 Linguagem: TypeScript no código novo

O projeto atual é JavaScript puro. O código novo da vitrine é escrito em **TypeScript**; o `legacy/` permanece em `.jsx` sem checagem. O Next suporta os dois no mesmo projeto, com `allowJs: true` e `strict: true` aplicado só ao código novo.

A razão é o contrato de §4: ele é o centro do desenho, e um contrato sem verificação é documentação. Em TypeScript, um mock fora do formato ou uma página lendo campo inexistente falham em tempo de build — que é exatamente o erro mais provável enquanto a API real não existe.

### 3.6 Esquema de URLs

As URLs são novas, não herdadas da base antiga (`/site`, `/site/product/:name/:id`). Como o domínio da Canastra ainda não serve essas páginas, não há link antigo a preservar e nenhum redirect 301 é necessário. O slug do lote é a chave canônica: `/cafes/casca-danta`.

### 3.7 Renderização por rota

| Rota | Estratégia | Motivo |
|---|---|---|
| `/`, `/a-serra`, institucionais | SSG + `revalidate` | Conteúdo estável, LCP mínimo |
| `/cafes` | SSR | Filtros na URL, compartilhável e indexável |
| `/cafes/[slug]` | **SSG + `generateMetadata`** | A rota que justifica o projeto: SEO + Open Graph |
| `/sacola`, `/checkout`, `/conta/*` | Client | Autenticado e dinâmico |
| `/dashboard/*` | Client-only | Legado |

---

## 4. Contrato de dados

O modelo atual é de vestuário: `product_options` traz tamanhos `P/M/G/GG` e categorias `Vestido`, `Cropped`, `Regata`, `Muscle`; `produtos` tem uma linha por produto+tamanho, com uma imagem e um preço.

Nenhum componente-âncora do `estetica.md` funciona sobre isso. `<SeloSCA>`, `<PontoTorra>`, `<FichaLavoura>`, `<CardCafe>`, `<SeletorMoagem>`, os filtros da PLP e o "Escolha pela Serra" leem campos que não existem.

O contrato abaixo é a fonte da verdade. Na Fase 1 ele é servido por um mock; na Fase 2 vira a especificação do backend.

```ts
type Linha = "classico" | "suave" | "aromatizado";
type Moagem = "grao" | "espresso" | "coado-papel" | "coador-pano"
            | "prensa-francesa" | "italiana-moka" | "aeropress";
type Metodo = Exclude<Moagem, "grao">;

type Lote = {
  slug: string;                    // "casca-danta"
  nome: string;                    // "Casca d'Anta"
  linha: Linha;                    // define a cor do card — §4.1 estetica
  notas: string[];                 // ["rapadura", "castanha-do-para", "cacau"]
  pontoTorra: 1 | 2 | 3 | 4 | 5;
  sca: number;                     // 84.25
  descricao: string;               // editorial, máx. 62ch por linha
  lavoura: {
    altitude: number;              // 1180 — eixo do "Escolha pela Serra"
    variedade: string;             // "Catuaí Amarelo 62"
    processo: string;              // "Natural"
    safra: number;                 // 2025
    produtor: string;              // "Sítio Boa Vista"
    municipio: string;             // "São Roque de Minas — MG"
  };
  fotos: {
    sabor: Imagem;                 // herói do card e da PDP — §8 estetica
    pacote: Imagem;
    terreiro?: Imagem;
    moido?: Imagem;
  };
  variantes: Variante[];           // matriz moagem × peso
  preparo: Preparo[];
  assinatura?: { desconto: number; frequenciasDias: number[] };
};

type Imagem = { src: string; alt: string; w: number; h: number };

type Variante = {
  sku: string;
  moagem: Moagem;
  pesoGramas: 250 | 500 | 1000;
  preco: number;                   // centavos
  estoque: number;
};

type Preparo = {
  metodo: Metodo;
  proporcao: string;               // "1:15"
  gramas: number; ml: number;
  temperaturaC: number;            // 94
  tempoSegundos: number;           // 180
  moagem: string;                  // "Média"
};
```

### Notas de contrato

- **Preço em centavos, inteiro.** Ponto flutuante em dinheiro é defeito. A formatação para `R$ 42,00` acontece só na exibição.
- **`variantes` é matriz completa**, não dois eixos independentes: nem toda moagem existe em todo peso, e o preço varia por combinação. A PDP desabilita combinações inexistentes em vez de escondê-las.
- **`fotos.sabor` é obrigatória** porque é o herói do `<CardCafe>` e da PDP. Ver §9 — hoje não existe nenhuma.
- **`lavoura.altitude` é obrigatória** porque é o eixo do "Escolha pela Serra". Ver §9.

### Camada de acesso

```
lib/catalogo/
├── tipos.ts          o contrato acima
├── mock.ts           6 a 8 lotes reais da Canastra
├── repositorio.ts    listarLotes(filtros), obterLote(slug), listarSlugs()
└── adapters.ts       tradução API → Lote (Fase 2)
```

Toda página consome `repositorio.ts`. Nenhum componente conhece a origem do dado. Trocar mock por API é reescrever um arquivo.

---

## 5. Design system

### 5.1 Tokens

Os tokens de `estetica.md` §4 são declarados como CSS custom properties e expostos ao Tailwind v4 via `@theme`, sem tradução para a escala do Tailwind. O documento é a fonte; o Tailwind é o consumidor.

As duas proibições de contraste de §4.1 — **branco sobre juta (2,2:1)** e **vermelho sobre mata (2,0:1)** — viram teste automatizado, conforme o próprio documento pede. Não são convenção de revisão; são falha de build.

### 5.2 Fontes

| Papel | Fonte | Carregamento |
|---|---|---|
| Títulos ≥40px | Redaction 35 | `next/font/local` — **não está no Google Fonts**, precisa baixar de redaction.us |
| Interface e corpo | Archivo (variável) | `next/font/google` |
| Dados e números | Martian Mono | `next/font/google` |

`preload` só na Archivo. A Redaction afeta apenas títulos e pode chegar depois (§10 estetica).

### 5.3 Componentes da Fase 1

Ordem derivada de `estetica.md` §12 Fase 1 (núcleo de conversão), com a Home incluída por ser a rota `/`:

`<SeloSCA>` · `<PontoTorra>` · `<CardCafe>` · `<FichaLavoura>` · `<SeletorMoagem>` · `<ModoCompra>` · `<Botao>` · `<Header>` com mega menu · `<Rodape>` · `<GavetaSacola>` · `<Serra>` (Escolha pela Serra, §6)

Cada um segue a spec visual do `estetica.md`. **Todo agente que implementar componente de frontend usa a skill `frontend-design`.**

---

## 6. Integração com a API

A autenticação atual é boa e migra bem: access token em memória, refresh em **cookie httpOnly**, com `credentials: "include"`. O servidor Next consegue ler o cookie — o que não seria possível se o token estivesse em localStorage.

Pontos de atenção:

- **CSRF.** O backend exige `X-CSRF-Token` com cookie `sameSite: "None", secure: true` (`backend/src/index.js:71-78`). Fetch feito no servidor não carrega cookie automaticamente; o cliente de `lib/api/` precisa repassar explicitamente.
- **Carrinho.** Hoje vive em `localStorage` e sincroniza com o banco no login (`productContextProvider.jsx`). Continua client-side; a sacola nunca renderiza no servidor.
- **Mercado Pago.** `@mercadopago/sdk-react` é client-only: `dynamic(..., { ssr: false })`.
- **Sem Postgres local.** Não há PostgreSQL nem Docker na máquina, e `estrutura.sql` está no `.gitignore` — o schema não veio no repositório. Na Fase 1 isso não bloqueia, porque a vitrine roda sobre o mock. Bloqueia checkout e conta de ponta a ponta.
- **`NEXT_PUBLIC_*` é resolvido em build time.** Diferente do `import.meta.env` do Vite, o webpack do Next substitui essas variáveis estaticamente durante o build. A URL da API passa a ser decidida no momento de compilar, não no runtime — o que muda como o deploy precisa ser configurado. Hoje, sem `.env`, vale o fallback `http://localhost:3333`.
- **O redirect do guard não tem destino.** Sem sessão, `legacy/routes/AdminRoutes.jsx:14` faz `<Navigate to="/account/login">`, rota que não existe dentro da ilha nem no Next. O react-router renderiza sua tela crua de erro. Atinge qualquer admin com sessão expirada, não só o ambiente de desenvolvimento. Quando `/account/login` existir no Plano 2, o redirect precisa virar `window.location` para sair da ilha.
- **O painel não tem `errorElement` em nenhuma rota.** Um throw em qualquer tela derruba a árvore inteira, menu incluído. É fragilidade pré-existente do legado, não introduzida pela migração, mas amplifica qualquer falha de API em produção. Fica para a reescrita do painel na Fase 2.

---

## 7. Erros, estados vazios e acessibilidade

Conforme `estetica.md` §11: erro explica e resolve, nunca pede desculpa. Estado vazio é convite.

- PLP sem resultado: *"Nenhum café com esses filtros. Tente afrouxar a torra ou a altitude."* + limpar filtros.
- Sacola vazia: *"Sua sacola está vazia. Comece pelos cafés da semana."* + botão.
- Falha de rede na PLP/PDP: `error.jsx` por segmento, com ação de tentar de novo. Nunca tela branca.
- `not-found.jsx` para slug inexistente, com sugestão de cafés.

Acessibilidade segue o checklist de §10 do `estetica.md` na íntegra, com destaque para: foco visível em 100% dos interativos, alvos ≥44px, fluxo de compra operável só por teclado (incluindo foco preso na gaveta da sacola), e a `<ol>` alternativa do "Escolha pela Serra".

---

## 8. Testes e critérios de aceite

| Camada | O que cobre |
|---|---|
| Unidade | `repositorio.ts` (filtros, ordenação), formatação de preço, resolução da matriz de variantes |
| Contrato | Validação do mock contra o schema do `Lote` — impede mock inválido |
| Contraste | As duas combinações proibidas de §4.1, como falha de build |
| E2E | Fluxo PLP → PDP → escolher moagem e peso → sacola |
| Sem JS | PLP e PDP renderizam conteúdo com JS desabilitado (§12) |
| Legado | As 20 rotas do painel respondem sob `/dashboard/*` após a conversão |

Antes do go-live, valem os critérios de `estetica.md` §12 na íntegra — Lighthouse ≥90 performance e ≥95 acessibilidade **em mobile**, zoom 200% sem quebra, `prefers-reduced-motion` respeitado.

---

## 9. Pré-requisitos de conteúdo — riscos abertos

Estes itens não são código e podem travar a entrega. O `estetica.md` §8 e §12 já os identifica como caminho crítico.

| Pré-requisito | Situação | Impacto se faltar |
|---|---|---|
| **Fotografia da família "Sabor"** (rapadura, castanha, cacau…) | ❌ Não existe nenhuma | É o herói do `<CardCafe>` e da PDP. Sem ela, a tese central do design não acontece. Fallback provisório: foto do pacote. |
| **Logo em SVG** (completo, reduzido, ícone) | ❌ Só `logo-canastra.png` raster, 3508×2481 | Header, rodapé e favicon. Vetorização é pré-requisito. |
| **`path` da serra isolado**, ~40 pontos | ❌ Idem | Sem ele não existe o "Escolha pela Serra" (§6), o elemento-assinatura. |
| **Altitude real por lote** | ❌ Não existe no modelo | `estetica.md` §6 é explícito: sem altitude real o eixo vira ficção. **Plano B do próprio documento:** trocar o eixo para Ponto de Torra, mantendo serra e mecanismo. |
| **Dados reais dos lotes** (SCA, variedade, processo, produtor) | ❌ | O mock usa valores plausíveis marcados como provisórios, nunca apresentados como reais. |

Existem hoje: `cafe-classico.png`, `cafe-suave.png`, `cafe-canela.png` (as três linhas), `microlote-png.png`, `nossa-historia.png`.

---

## 10. Fora de escopo

- Reescrita do painel `/dashboard` (Fase 2)
- Alteração do schema do banco e dos endpoints (Fase 2, guiada por §4)
- Produção fotográfica
- Avaliações, blog "Aprender", atacado (Fase 3 do `estetica.md`)
- Absorver o Express em Route Handlers do Next
