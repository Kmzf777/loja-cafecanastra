# Plano mestre — resolver todas as pendências da auditoria de 2026-08-20

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> para implementar. Este é o plano **mestre**: ele fixa ordem, contratos e alocações.
> Cada onda tem seu plano detalhado próprio, escrito pelo agente da onda ANTES de
> implementar, salvo em `docs/superpowers/plans/2026-08-20-<onda>.md`.

**Goal:** deixar a loja operacional de ponta a ponta (venda, pagamento, webhook,
painel, fiscal) e instalar a camada de eficiência de vendas (SEO, analytics,
cupom, carrinho abandonado, assinatura), resolvendo as pendências da auditoria.

**Architecture:** manter o desenho atual (Next 15 + Express + Supabase self-hosted,
schema `canastra`). A F4 aqui é executada de forma **pragmática e deliberadamente
diferente da spec de 2026-08-17**: em vez de apagar o Express e mover leituras ao
PostgREST (o que deixaria o painel legado morto até a F6), os repositories são
**reescritos enxutos contra `canastra.*` mantendo o contrato JSON HTTP existente**
— assim vitrine E painel voltam a funcionar com o mínimo de mudança de contrato.
O desvio fica registrado aqui; a F6 (painel novo) continua válida como evolução.

**Tech Stack:** Node 22, Express, pg, Next 15, React 18, Tailwind 4, Vitest,
node:test + embedded-postgres, Mercado Pago Payment API, Melhor Envio, Resend,
Bling API v3.

---

## Decisões fixadas (valem para todas as ondas)

1. **Vocabulário de status de pedido: português**, com CHECK na migração 0009:
   `pendente, aprovado, em_processamento, autorizado, enviado, entregue,
   cancelado, rejeitado, reembolsado`. O backend traduz o status do MP
   (`pending→pendente`, `approved→aprovado`, `in_process→em_processamento`,
   `authorized→autorizado`, `cancelled→cancelado`, `rejected→rejeitado`,
   `refunded→reembolsado`). A API HTTP passa a falar português; painel e vitrine
   atualizam seus mapas de exibição.
2. **Contrato JSON da API HTTP não muda de forma** (nomes de campos que o
   painel legado e `frontend/lib` já consomem: `product_id`, `price`, `quantity`,
   `sku`, etc.) — muda só o vocabulário de status. Quem reescreve SQL mapeia
   coluna portuguesa → campo do contrato no SELECT.
3. **Frete grátis é regra de servidor**: `canastra.config_loja.frete_gratis_minimo_centavos`
   (migração 0009, default `14900`). `ShippingController` zera o frete das opções
   quando o subtotal atinge o mínimo; `conferirFrete` aceita a versão zerada.
   A barra do Cabeçalho e a barra de progresso leem esse valor via `GET /config`.
4. **Alocação de números de migração** (NUNCA reutilizar ou trocar):
   - `0009` — F4: CHECK de status, `config_loja.frete_gratis_minimo_centavos`
   - `0010` — cupons (`canastra.cupons` + uso)
   - `0011` — newsletter (`canastra.newsletter_inscritos`) + carrinho abandonado
     (`canastra.carrinhos.lembrete_enviado_em`)
   - `0012` — Bling/NF-e: colunas em `pedidos` (`bling_id`, `nfe_numero`,
     `nfe_chave`, `nfe_url`, `bling_sincronizado_em`)
   - `0013` — LGPD: RPC `canastra.redigir_dados_do_cliente(uid)` (redação de
     `endereco_json`/`itens` de pedidos + limpeza de `clientes`)
   - `0014` — avaliações (`canastra.avaliacoes` + RLS "só quem recebeu o produto")
   - `0015` — clube (`canastra.assinaturas`)
5. **Variáveis de ambiente novas** (adicionar aos `.env.example` de cada lado):
   - Frontend: `NEXT_PUBLIC_MP_PUBLIC_KEY`, `NEXT_PUBLIC_GA4_ID`,
     `NEXT_PUBLIC_WHATSAPP`
   - Backend: `BLING_ATIVO`, `BLING_CLIENT_ID`, `BLING_CLIENT_SECRET`,
     `BLING_REFRESH_TOKEN`, `ABANDONO_ATIVO`, `ABANDONO_HORAS` (default 24)
   - Toda integração externa nova é **desligada por padrão** quando a variável
     está vazia — nunca quebrar a subida do processo por credencial ausente.
6. **Contrato do cupom** (fixado aqui para D e F trabalharem em paralelo):
   `POST /cupons/validar` público com rate limit, corpo
   `{ codigo, itens: [{ productId, quantity }] }`, resposta 200
   `{ valido: true, codigo, descontoCentavos, descricao }` ou 200
   `{ valido: false, motivo }`. No checkout, `process_payment` recebe `cupom`
   (string) e **revalida no servidor** — o desconto do navegador nunca é aceito.
7. **Testes**: cada onda roda `npm --prefix backend test` e/ou
   `npm --prefix frontend run test` conforme o que tocou, e só se declara pronta
   com a suíte verde. Teste novo acompanha comportamento novo (TDD).
8. **Commits**: os agentes de onda NÃO commitam (evita corrida de index em
   paralelo). O orquestrador commita ao fim de cada onda, em mensagens
   granulares no estilo do repositório (minúsculas, português, causa→efeito).
9. **Fora do alcance desta execução** (exige credencial/acesso que o repo não tem;
   entregar pronto-para-ligar + runbook): aplicar na VPS, ajustes manuais do
   GoTrue, verificação de domínio no Resend, `git push --force` da reescrita de
   histórico, credenciais reais de Bling/MP/GA4, revisão comercial de
   preço/estoque do catálogo.

---

## Ondas

### Onda 1 — em paralelo (arquivos disjuntos)

| Agente | Escopo | Território de arquivos |
|---|---|---|
| **A — F4 núcleo** | Reescrever acesso a dados para `canastra.*` (produtos, config, opções, promoções, endereços, pedidos, summary, clientes-admin), checkout gravando `canastra.pedidos` com `chave_idempotencia`, webhook com transação+idempotência+erro visível, e-mails de status vivos, rotas de clientes do painel recriadas, frete grátis servidor, migração 0009, catches mentirosos removidos | `backend/**` (exceto infra nova), sem tocar `frontend/**` |
| **B — SEO/conversão vitrine** | sitemap, robots, favicon/icon, OG default, JSON-LD (Product/Offer/Organization/Breadcrumb), GA4 por env com consentimento (banner de cookies), botão WhatsApp, caixa de busca na PLP, superfície de venda dos kits, eventos add_to_cart | `frontend/app/**`, `frontend/components/**`, `frontend/lib/analytics*`, `frontend/lib/busca*` — sem tocar `frontend/lib/sacola`, `checkout/page.tsx`, `next.config.mjs` |
| **C — Infra F7** | Dockerfiles, docker-compose de produção, nginx (mesma origem, `/api/*`), ecosystem PM2, script de backup (`pg_dump` + retenção + Storage), CI GitHub Actions (testes dos dois lados), runbook de deploy, `output: standalone` no `next.config.mjs` | arquivos novos em `deploy/`, `.github/`, `scripts/`, `backend/Dockerfile`, `frontend/Dockerfile`, `next.config.mjs` (só a linha do standalone) |

### Onda 2 — depois da 1 (depende do backend novo)

| Agente | Escopo |
|---|---|
| **D — Checkout completo** | Cartão de crédito (SDK MP no navegador, tokenização, `NEXT_PUBLIC_MP_PUBLIC_KEY`, ajuste do CSP em `next.config.mjs`), coleta de CPF (grava em `canastra.clientes`), ViaCEP, campo de cupom (contrato da decisão 6), barra de progresso de frete grátis + Cabeçalho dinâmico, teto de quantidade pela variável `estoque`, página de confirmação com URL própria (`/pedido/[id]`), textos de termos/política conferidos contra o que agora é verdade |
| **E — Painel utilizável** | Tela de pedidos para de mentir (erro visível), select com os 9 status em português, rastreio em modal (fim do `prompt()`), campo SKU no formulário de produto, dropdown de produto nas promoções (fim do UUID à mão), textos de camiseta ("T-shirt", "peças", "Tamanho") viram café, tela de clientes religada nas rotas novas, exportação CSV de pedidos (endpoint + botão), WhatsApp/config religados |
| **F — Motor de vendas backend** | Cupons (migração 0010 + `POST /cupons/validar` + aplicação revalidada no `process_payment` + tela no painel), newsletter (migração 0011 + `POST /newsletter` + formulário no rodapé), carrinho abandonado (cron `node-cron` + e-mail Resend + `lembrete_enviado_em`) |

### Onda 3 — depois da 2

| Agente | Escopo |
|---|---|
| **G — Bling/NF-e** | Cliente API v3 (OAuth refresh), pedido aprovado → pedido de venda no Bling (idempotente por `bling_id`), gatilho de NF-e, retorno de rastreio, endpoint manual de reenvio no painel, migração 0012, runbook `docs/bling.md`, tudo atrás de `BLING_ATIVO` |
| **H — LGPD e histórico** | Migração 0013 (RPC de redação), endpoint admin de atendimento a titular, banner/fluxo já coberto por B, script `scripts/reescrever-historico.sh` (filter-repo, **não executado**) + runbook de invalidação do que vazou, atualização de `docs/seguranca-dados-pessoais.md` |
| **I — Avaliações** | Migração 0014, RLS (avalia quem tem pedido entregue com o SKU), envio pela conta, exibição na PDP + `aggregateRating` no JSON-LD, moderação simples no painel |
| **J — Clube (assinatura)** | Migração 0015, preapproval do Mercado Pago (criação, webhook de eventos, cancelamento), wizard real em `/clube`, gestão na conta do cliente e lista no painel |

### Onda 4 — fechamento

Revisão de código por agente revisor (por onda), suíte completa dos dois lados,
atualização de `README.md` e `docs/producao.md` (o §1/§1.1 muda de verdade),
commits finais e relatório de aceitação com o que ficou dependendo de credencial.

---

## Critério de pronto global

- `npm --prefix backend test` e `npm --prefix frontend run test` verdes.
- Nenhuma rota respondendo 200 com erro engolido.
- Nenhum texto da loja antiga visível a cliente ou gestor.
- Toda promessa visível na vitrine (frete grátis, cartão, cookies, CPF) tem
  implementação correspondente.
- Pendências que dependem de credencial/VPS listadas em um runbook único de
  go-live (`docs/go-live.md`).
