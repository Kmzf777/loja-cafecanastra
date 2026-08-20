# Onda 1B — SEO e conversão da vitrine

> Plano detalhado da Onda 1B do plano mestre
> `docs/superpowers/plans/2026-08-20-plano-mestre-pendencias.md`.
> Baseline verificada antes de começar: `npm --prefix frontend run test`
> verde com 185 testes em 12 arquivos.

**Goal:** dar à vitrine a camada de eficiência de vendas que a auditoria
apontou como ausente: sitemap, robots, favicon, OG default, JSON-LD, GA4 com
consentimento (banner de cookies próprio), botão de WhatsApp, busca na PLP e
superfície de venda dos 3 kits do catálogo.

**Território:** `frontend/app/**`, `frontend/components/**`,
`frontend/lib/busca.ts`, `frontend/lib/seo/**`, `frontend/lib/analytics.ts`,
`frontend/lib/catalogo/**` (só kits ao vivo), `frontend/.env.example`.
Proibido: `frontend/lib/sacola/**`, `checkout/**`, `next.config.mjs`,
`legacy/**`, `backend/**`. Sem dependência nova. Sem commit.

---

## Decisões que valem para todas as tarefas

1. **URL base**: `process.env.NEXT_PUBLIC_SITE_URL || "https://loja.cafecanastra.com"`
   — o MESMO fallback do `metadataBase` de `app/layout.tsx`. Centralizada em
   `lib/seo/jsonld.ts` (`urlDoSite()`), consumida por sitemap, robots e builders.
2. **Testes em Vitest ambiente node** — o `vitest.config.ts` não tem alias
   `@/`, então TODO módulo novo que um teste importa usa **imports relativos**
   internamente (`../catalogo/tipos`, não `@/lib/...`). Os testes ficam ao lado
   do módulo (`*.test.ts`), como os existentes.
3. **Preço**: builders e eventos recebem **centavos** e emitem decimal com
   ponto (`3970 → "39.70"` no JSON-LD; `39.7` numérico no GA4).
4. **Consentimento**: `localStorage["cookies:consentimento"]` com valores
   `"aceito" | "essencial"`. A troca é anunciada por
   `window.dispatchEvent(new Event("cookies:consentimento"))` para o
   `ScriptsAnalytics` reagir sem recarregar. Helpers vivem em
   `lib/analytics.ts` (mesmo domínio; território não prevê arquivo próprio).
5. **JSON-LD injetado com serialização defensiva**: `serializarJsonLd()`
   escapa `<` como `<` antes do `dangerouslySetInnerHTML`.
6. **Kits**: tipo `Kit` novo em `lib/catalogo/tipos.ts`; `produtos.ts` ganha
   `KITS_DA_LOJA: Kit[]` (o export bruto `KITS` continua igual — ninguém mais
   o consome, mas o contrato não muda); `repositorio.ts` ganha `listarKits()`
   que aplica preço/estoque/produtoId ao vivo pelo MESMO mapa por `sku` do
   `buscarDadosAoVivo()` — o contrato da API (`/dashboard?limit=200`,
   `product_id`/`price`/`quantity`/`sku`) não muda em nada.
7. **Estética**: tokens de `globals.css` (fuligem/cal/juta/vermelho), raio
   `--radius-bt` (2px), caixa alta Archivo 600 para labels, Martian Mono para
   números, sem emoji, copy no tom do estetica.md §11.

## Pendências conhecidas ANTES de começar (registradas para o orquestrador)

- **CSP**: `next.config.mjs` (intocável nesta onda) não lista
  `https://www.googletagmanager.com` no `script-src` nem
  `https://*.google-analytics.com` no `connect-src`. O GA4 fica pronto e
  desligado por env; quando a Onda 2-D mexer no CSP para o SDK do MP, deve
  acrescentar as duas origens. Sem isso o gtag é bloqueado em produção
  silenciosamente.
- Dois dos três kits (cápsulas) estão com `precoCentavos: 0` e `estoque: 0`
  na captura da loja — aparecem desabilitados com aviso, como manda o brief.

---

## Tarefas

### T1 — JSON-LD (`lib/seo/jsonld.ts` + teste)
Builders puros: `organizationJsonLd`, `websiteJsonLd` (com `SearchAction`
apontando para `/cafes?q={termo}` — casa com a busca da T6),
`productJsonLd(lote, variantes?)` (Product + Offer por `skuLoja` único, preço
decimal BRL, `availability` por estoque, imagem absoluta; oferta só quando
`preco > 0`), `breadcrumbJsonLd(trilha)`. Auxiliares exportados e testados:
`urlDoSite`, `centavosParaDecimal`, `absoluta`, `serializarJsonLd`.

### T2 — Arquivos especiais de SEO
- `app/sitemap.ts`: home, `/cafes`, PDPs via `listarSlugs()`, `/clube`,
  `/a-serra`, `/termos-de-uso`, `/politica-de-privacidade`.
- `app/robots.ts`: allow geral; disallow `/dashboard`, `/account`,
  `/checkout`, `/sacola`; `sitemap: <base>/sitemap.xml`.
- `app/icon.svg`: silhueta da serra (perfil derivado de
  `components/marca/Serra`) em juta sobre fundo fuligem, desenhada à mão.
- `app/apple-icon.png`: 180×180 com o mesmo desenho, gerado por script Node
  (zlib + chunks PNG à mão, sem dependência) no scratchpad.
- `app/layout.tsx`: `openGraph.images` default → `/imagem-banner.jpg`
  (1280×720, o herói da home; o `bannerdesktop.jpg` é 1600×500, proporção ruim
  para card). A PDP continua sobrepondo com a foto do pacote.

### T3 — Injeção do JSON-LD
- `app/(vitrine)/layout.tsx`: Organization + WebSite (a vitrine, não o
  `/dashboard`, é quem quer rich results).
- `app/(vitrine)/cafes/[slug]/page.tsx`: Product + BreadcrumbList
  (Início → Cafés → lote).

### T4 — Analytics GA4 com consentimento
- `lib/analytics.ts`: `lerConsentimento`/`gravarConsentimento` (com o evento
  da decisão 4), `paraItemGa4`, `eventoAddToCart`, `eventoBeginCheckout`,
  `eventoPurchase` — todos no-op sem `window.gtag`. Teste com dublê de
  `window`.
- `components/analytics/ScriptsAnalytics.tsx` (client): injeta gtag.js via
  `next/script` SOMENTE com `NEXT_PUBLIC_GA4_ID` definida E consentimento
  `"aceito"`; reage ao evento de consentimento.
- `components/layout/BannerCookies.tsx` (client): aviso fixo no rodapé da
  tela, "Aceitar" / "Só o essencial", persiste a escolha, some depois de
  decidida, `role="region"`, foco visível, link para a Política de
  privacidade (que já promete este aviso).
- Montagem dos dois no layout da vitrine.
- `eventoAddToCart` no ponto de sucesso de `PainelCompra.aoAdicionar` (e no
  CardKit da T7). `eventoBeginCheckout` no clique de "Fechar pedido" da
  página da sacola (client, fora do território proibido). `eventoPurchase`
  fica exportado e testado; o ponto de disparo é a página de confirmação da
  Onda 2-D (pendência registrada).
- `.env.example`: `NEXT_PUBLIC_GA4_ID` e `NEXT_PUBLIC_WHATSAPP` comentadas.

### T5 — WhatsApp
- `components/layout/BotaoWhatsApp.tsx` (Server Component): só renderiza com
  `NEXT_PUBLIC_WHATSAPP`; `https://wa.me/<dígitos>?text=<mensagem>`;
  `aria-label`; fixo no canto inferior direito com `bottom-20` no mobile
  (livre da barra de compra da PDP, que é `bottom-0 z-40` com ~72px) e
  `z-30` (abaixo da barra, do menu `z-50` e do banner de cookies `z-50`).
- Link de WhatsApp na coluna "Ajuda" do `Rodape.tsx`, condicionado à env.

### T6 — Busca na PLP
- `lib/busca.ts`: `normalizarTexto` (NFD, sem acento, minúsculas) e
  `filtrarPorTexto(lotes, q)` — AND entre palavras, sobre nome, descrição,
  linha (slug + rótulo) e notas (chave + rótulo). Teste dedicado.
- `Cabecalho.tsx`: `<form action="/cafes" method="get" role="search">` com
  lupa acessível — versão desktop na barra, versão mobile no topo do painel
  do menu. Sem JS: submit nativo (progressive enhancement de graça).
- `cafes/page.tsx`: lê `q`, aplica `filtrarPorTexto` sobre o resultado de
  `listarLotes`, chip "Busca: …" junto dos demais, `q` preservado como input
  hidden no form de filtros, contagem e estado vazio coerentes.

### T7 — Kits vendáveis
- `tipos.ts`: tipo `Kit` (sku, skuLoja, produtoId?, nome, rotuloEmbalagem,
  formato, linha, imagem, preco, estoque, pacotes, unidades?).
- `produtos.ts`: `KITS_DA_LOJA` montado do JSON (imagem herdada da linha).
- `repositorio.ts`: `listarKits()` com dados ao vivo (mesmo mecanismo/refactor
  mínimo do `atualizar` genérico). Testes.
- `components/catalogo/CardKit.tsx` (client): etiqueta com fita da cor da
  linha, imagem, nome/conteúdo (split do " - " do nome), preço em Martian
  Mono, botão "Adicionar à sacola" com os mesmos estados do PainelCompra
  (esgotado desabilitado com aviso; sem `produtoId` → erro de contingência);
  dispara `eventoAddToCart`.
- Seção "Kits e caixas" na PLP após a grade, sempre visível.

### T8 — Verificação
`npm --prefix frontend run test` verde (185 + novos). Conferência manual dos
arquivos especiais (sitemap/robots/icon são convenções de arquivo do App
Router; sem teste unitário — a rota compila junto com o build).

## Fora do escopo (outras ondas)
- `aggregateRating` no JSON-LD (Onda 3-I, avaliações).
- Disparo do `eventoPurchase` (Onda 2-D, página de confirmação).
- Origens do GA no CSP (Onda 2-D, única autorizada a tocar `next.config.mjs`).
- Formulário de newsletter no rodapé (Onda 2-F).
