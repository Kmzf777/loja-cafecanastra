# Onda 2E — Painel utilizável

> Plano detalhado da onda E do plano mestre
> (`2026-08-20-plano-mestre-pendencias.md`). Escrito ANTES de implementar.
> O agente desta onda NÃO commita.

**Goal:** o gestor (acostumado com o admin da Tray) consegue operar a loja
inteira pelo painel legado: ver erro quando há erro, mudar status em
português, informar rastreio sem `window.prompt`, exportar CSV para o Excel,
cadastrar SKU, gerenciar cupons e configurar o frete grátis — sem nenhum
resquício visível de camiseta/Shopnaw.

**Território:** `backend/src/routes/orders.routes.js`,
`backend/src/controllers/OrderController.js`,
`backend/src/repositories/ordersRepository.js`, util novo de CSV, teste novo
em `backend/test/`, e `frontend/legacy/**`. NÃO tocar: `frontend/app/**`,
`frontend/lib/**`, `frontend/components/**`, `frontend/next.config.mjs`,
`backend/src/controllers/PaymentController.js`, `backend/src/index.js`,
`backend/src/routes/cupons*`, `backend/src/routes/newsletter*`, migrações
0010/0011.

---

## Verificações prévias (já feitas na leitura)

- `POST/PUT /dashboard` **já aceitam e gravam `sku`** (Onda 1,
  `dashboardRepository.js`): 23505 → **409** "Já existe um produto com este
  SKU." — a missão pedia 400, mas o backend da Onda 1 já está commitado com
  409; mudar o código agora quebraria o teste existente sem ganho. O painel
  trata o corpo `{message}` de qualquer `!res.ok`, então 409 funciona.
  **Decisão: manter 409 e registrar no relatório.**
- `PUT /config` **já aceita `frete_gratis_minimo_centavos`** (validação de
  inteiro ≥ 0, PUT parcial não anula os demais campos). Só falta o campo na
  tela.
- `req.user = { userId, email, ehAdmin }` — `ehAdmin` vem do banco; o
  detalhe de pedido usa isso para "dono OU admin".
- O painel é a ilha `PainelApp.jsx` (rotas sob `/dashboard`);
  `main.jsx`/páginas de vitrine legada são código morto não montado pelo
  Next — textos de camiseta ali não são visíveis a ninguém. Só o que está
  sob `DashboardSection/` + `Dashboard.jsx` aparece ao gestor.
- Não existe componente de modal compartilhado no painel (o `ModalOverlay`
  de `Orders.jsx` é local) → a confirmação de exclusão em
  `RegisteredClients.jsx` mantém `confirm()` com comentário.
- `RegisteredClients.jsx` já casa com o contrato de `/auth/users`
  (`users/totalPages/id/user_id/name/email/phone/purchases`); único defeito:
  a tabela desktop tem 4 `<Th>` e 5 `<Td>` (coluna Ações sem cabeçalho).

## Contratos consumidos/produzidos

- **Produzo** (o agente do checkout consome): `GET /my-orders/:id` →
  `{ order: {...} }` com os mesmos aliases de `COLUNAS_DO_CONTRATO` da
  listagem `/my-orders`, mais `coupon_code`/`discount` QUANDO as colunas de
  cupom existirem no banco (migração 0010 é do agente F, corre em paralelo).
- **Consumo** (o agente F produz): `GET /cupons` (isAdmin) →
  `{ data: [{ id, codigo, tipo: "percent"|"fixed", valor, descricao,
  minimo_centavos, limite_usos, usos, ativo, inicio_em, fim_em }] }`;
  `POST /cupons` (sem id/usos); `PUT /cupons/:id` parcial. A tela degrada
  com a tarja de erro padrão enquanto o endpoint não existir (404).

## Tarefas

### 1. Backend — detalhe de pedido

- `ordersRepository.js`: método `getOrderComCupom(orderId)` — SELECT
  `COLUNAS_DO_CONTRATO` + `to_jsonb(p) AS bruto`; do `bruto`, mapear
  defensivamente `cupom_codigo|cupom → coupon_code` e
  `desconto|desconto_centavos → discount` (centavos → reais quando o nome
  diz centavos). Assim o endpoint cumpre o contrato hoje (campos ausentes)
  e no dia em que 0010 aterrissar (campos presentes), sem referenciar
  coluna que ainda não existe. O MESMO mapa entra em `getAllOrders` para o
  modal do admin mostrar cupom/desconto.
- `OrderController.getOrderDetail`: `isAuthenticated`; UUID malformado →
  404 (nunca 500 de 22P02); pedido inexistente → 404; pedido de OUTRO
  usuário e chamador não-admin → **404** (não 403 — 403 confirmaria a
  existência do pedido de terceiro). Resposta `{ order }`.
- Rota `GET /my-orders/:id` em `orders.routes.js` (registrada DEPOIS de
  `GET /my-orders`; caminhos distintos, ordem irrelevante, mas fica junto).

### 2. Backend — exportação CSV

- `ordersRepository.js`: `getOrdersForExport({ de, ate })` — mesmo JOIN da
  listagem admin (clientes + auth.users), sem paginação, filtro opcional
  `criado_em >= de` / `criado_em < ate + 1 dia` (ate inclusivo), ORDER BY
  `criado_em`.
- Util novo `backend/src/utils/csvDePedidos.js` (função pura, testável):
  - separador `;` (Excel pt-BR), CRLF, BOM `﻿` no início;
  - colunas: pedido, data (dd/mm/aaaa hh:mm), cliente, email, cpf, status,
    itens ("2x Clássico 250g moído; ..."), subtotal (soma de
    `price*quantity` dos itens), desconto, frete, total, metodo_pagamento,
    rastreio;
  - dinheiro com vírgula decimal ("54,90");
  - escape: célula com `;`, aspas ou quebra de linha vira `"..."` com
    aspas dobradas; célula começando com `=`, `+`, `-`, `@`, TAB ou CR
    ganha prefixo `'` (injeção de fórmula) ANTES do aspamento.
- `OrderController.exportOrdersCsv`: valida `de`/`ate`
  (`YYYY-MM-DD` ou ausentes; inválido → 400), monta CSV, responde
  `Content-Type: text/csv; charset=utf-8`,
  `Content-Disposition: attachment; filename="pedidos-<de>-<ate>.csv"`.
- Rota `GET /admin/orders/export` (isAuthenticated + isAdmin) — registrada
  ANTES de qualquer rota `/admin/orders/:id` futura (hoje não há conflito).

### 3. Backend — teste

`backend/test/painel_pedidos.test.js`, no padrão de
`f4_repositorios.test.js` (Postgres embarcado, require de `src/` dentro do
`before`, `respostaFalsa()`):

- dono vê o próprio pedido em `{ order }` com os aliases do contrato;
- pedido de outro usuário → 404 para não-admin, 200 para admin;
- id malformado → 404;
- CSV: BOM + `;` + cabeçalho; linha com itens resumidos e total com
  vírgula; célula com `;`/aspas escapada; célula começando com `=`
  prefixada com `'`; filtro `de`/`ate` corta fora o pedido de ontem;
  `de` inválido → 400. Teste puro do util + teste do controller.

### 4. Painel — Orders.jsx

- estado `erro` + tarja `role="alert"` (padrão HomeDashboard) quando o
  fetch falha (`!res.ok` OU exceção); hoje `res.ok` falso cai em silêncio.
- Mapa local `STATUS` (valor → rótulo) com os 9 status em PORTUGUÊS,
  comentado como cópia de `backend/src/utils/statusDePedido.js`; select
  (desktop e mobile) gerado do mapa; badge usa o rótulo; cores por status
  português (mapa novo, cobrindo os 9).
- Rastreio: `window.prompt` morre; ao escolher `enviado`, abre modal
  próprio (mesmo `ModalOverlay`) com input + Confirmar/Cancelar; cancelar
  restaura o select (re-render já resolve, o valor vem de `order.status`).
- Botão "Exportar CSV" + dois `<input type="date">` (de/até): `authFetch`
  em `/admin/orders/export?de=&ate=`, resposta → blob → `<a download>`;
  erro → toast.
- Modal de detalhe: linhas "Cupom"/"Desconto" quando
  `coupon_code`/`discount` presentes; "Rastreio" quando houver; rótulo
  "Tamanho:" do item vira "Embalagem:".

### 5. Painel — produtos

- `Form.jsx`: campo SKU (`register("sku")`, obrigatório para produto novo,
  editável na edição), entra no FormData, no `reset` da edição, no
  `originalProduct` e no `isEdited`; o submit passa a ler o corpo de erro
  do servidor e mostrar a mensagem (cobre o 409 de SKU duplicado).
  Rótulos: "Tamanho" → "Embalagem" (select continua em `/options?type=size`
  — só o rótulo muda), "Quantidade de peças disponíveis" → "Quantidade em
  estoque".
- `addedShirts/AddedShirts.jsx` → renomear ARQUIVOS para
  `addedProducts/AddedProducts.jsx` (+ `.style.jsx`), componente
  `AddedProducts`, imports ajustados em `PainelApp.jsx` e `main.jsx`
  (morto, mas não deixa referência quebrada). Texto vazio → "Nenhum café
  cadastrado ainda"; coluna/linha "Tamanho" → "Embalagem".
- `MenuAside.jsx`: typo "Gestão de protudos" → "Gestão de produtos"; link
  novo de Cupons.

### 6. Painel — categorias, promoções, cupons

- `ManageCategories.jsx`: "📏 Tamanhos" → "Embalagens" (250g, 1kg...),
  toast/placeholder coerentes; comentário explicando que o `type` da API
  continua `size` (contrato de `/options` não muda).
- `PromotionsManager.jsx`: campo de UUID à mão vira `<Select>` de produtos
  — `GET /dashboard?page=1&limit=200` uma vez no mount, option
  "Nome — SKU" (SKU quando houver), value = `product_id`.
- Tela nova `Settings/Cupons/CuponsManager.jsx` (reusa
  `PromotionsManager.style`): tabela (código, tipo, valor, usos/limite,
  validade, ativo), formulário criar/editar (codigo, tipo, valor,
  descricao, minimo em R$ ↔ `minimo_centavos`, limite_usos, inicio_em,
  fim_em, ativo), botão ativar/desativar via `PUT { ativo }`. 404/erro →
  tarja de erro padrão dizendo que o módulo de cupons ainda não respondeu.
  `valor`: percent = número %, fixed = R$ (premissa comentada). Rota
  `/dashboard/settings/cupons` em `PainelApp.jsx` + item no `MenuAside`.

### 7. Painel — clientes, config, mortos, status

- `RegisteredClients.jsx`: `<Th>Ações</Th>` que falta; `confirm()` fica,
  com comentário (não há modal padrão no painel).
- `UpdateInfo.jsx`: campo "Frete grátis a partir de (R$)" — carrega
  `frete_gratis_minimo_centavos / 100`, envia `Math.round(reais * 100)`;
  aceita vazio = não enviar (não zera sem intenção); dica de que 0 desliga.
- `productContextProvider.jsx`: morrem `replaceOnServer`,
  `debouncedReplace`, `fetchCart` e o `GET /cart` (rotas apagadas na F2 —
  404 de ruído em todo load); o carrinho vira localStorage puro (nenhuma
  tela do PAINEL usa carrinho; as telas de vitrine legada que usavam são
  código morto fora da ilha).
- Apagar `hooks/useProducts.jsx` e `hooks/usePromotions.jsx` (sem
  importadores; um com template literal corrompida).
- `HomeDashboard.jsx`: `STATUS_TRANSLATION` passa para as chaves em
  português (9 status). `MyOrders.jsx` (não montado, mas compila):
  `translateStatus` + `StatusBadge` com as chaves novas — nada exibe nem
  envia status em inglês.

## Verificação

- `npm --prefix backend test` — 232 atuais + os novos, verde.
- `npm --prefix frontend run build` verde; `npx tsc --noEmit` no frontend;
  `npm --prefix frontend run test` — 223, sem regressão.
- NÃO commitar.
