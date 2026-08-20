# Onda 2-D — Checkout completo

> Plano detalhado do agente D, derivado do plano mestre
> `2026-08-20-plano-mestre-pendencias.md`. Executado com TDD; o agente NÃO
> commita (decisão 8 do mestre).

**Goal:** o checkout deixa de ser "só Pix, sem CPF, sem cupom, endereço na mão"
e vira o funil completo: cartão de crédito tokenizado no navegador, CPF
validado para a nota, ViaCEP preenchendo o endereço, cupom aplicado e
revalidado no servidor, frete grátis visível (cabeçalho + barra de progresso),
idempotência de pagamento no cliente, página do pedido com URL própria e o
`purchase` do GA4 disparando uma vez.

**Território:** `frontend/app/(vitrine)/**` (checkout, pedido/[id], sacola,
account, termos), `frontend/lib/**` (exceto lib/seo; de lib/analytics só se
consome), `frontend/components/catalogo/**`, `frontend/components/layout/
Cabecalho.tsx` + componentes novos, `frontend/next.config.mjs` (só CSP),
`frontend/.env.example`. PROIBIDO: `backend/**`, `frontend/legacy/**`,
`Rodape.tsx`, `frontend/components/analytics/**`.

**Contratos consumidos (implementados por agentes paralelos — construir contra,
sem teste ponta a ponta agora):**

- `GET /my-orders/:id` (Bearer, dono) → `{ order: { order_id, status, total,
  timestamp, items, address_json, shipping_cost, shipping_method,
  tracking_code, payment_method, coupon_code?, discount? } }`. A página lê com
  tolerância (`total ?? total_amount`, `timestamp ?? created_at`) porque a
  listagem atual usa os aliases antigos e o detalhe é de outro agente.
- `POST /cupons/validar` (público) body `{ codigo, itens: [{ productId,
  quantity }] }` → 200 `{ valido: true, codigo, tipo, valor, descontoCentavos,
  descricao }` ou `{ valido: false, motivo }`. `process_payment` aceitará
  `cupom` (string) e revalida no servidor.
- Já entregues pela Onda 1: `GET /config` com `frete_gratis_minimo_centavos`;
  opções de frete com `price: 0, gratis: true` no piso; `Idempotency-Key`
  devolvendo o pedido existente COM `ticketUrl`; cartão aceito no
  `process_payment` via `formData.token/installments/issuer_id/
  payment_method_id`; CPF persistido de `formData.payer.identification.number`.

---

## Módulos novos (todos puros, fetch injetável, testados primeiro)

| Arquivo | Conteúdo |
|---|---|
| `frontend/lib/cpf.ts` | `limparCpf`, `formatarCpf` (máscara progressiva 000.000.000-00, sem lib), `validarCpf` (11 dígitos, recusa repetidos, dígitos verificadores) |
| `frontend/lib/cep.ts` | `limparCep`, `formatarCep` (00000-000), `cepCompleto`, `interpretarViaCep` (json → {street, neighborhood, city, state}; `erro: true` → null), `buscarCep(cep, fetchFn)` com falha silenciosa |
| `frontend/lib/config-loja.ts` | `freteGratisMinimoCentavos(fetchFn)` — GET /config, cache de módulo 5 min (só sucesso), fallback `14900`; `_limparCacheConfig()` para teste |
| `frontend/lib/sacola/cupom.ts` | `interpretarRespostaCupom` (defensivo: `descontoCentavos` inteiro ≥ 0 ou inválido), `validarCupom(codigo, itens, fetchFn)` mapeando `product_id → productId`; rede fora → `{valido:false, motivo}` honesto |
| `frontend/lib/sacola/idempotencia.ts` | uma chave uuid por "assinatura do pedido" (itens ordenados + frete + cupom): mesma assinatura → MESMA chave (retry/reclique); assinatura nova → chave nova; `descartarChave()` para depois de recusa definitiva (o pedido nasceu e morreu — repetir a chave devolveria o morto para sempre); `_zerar()` para teste |
| `frontend/lib/sacola/cartao.ts` | carregamento dinâmico do SDK v2 (`https://sdk.mercadopago.com/js/v2`, promise cacheada, só quando chamado), `chavePublicaMp()` (env `NEXT_PUBLIC_MP_PUBLIC_KEY` ou null), `montarFormularioDeCartao()` (CardForm com `iframe: true` = secure fields; devolve `{desmontar}`), `traduzirErroMp` (por CÓDIGO — 205/208/209/212–214/220/221/224/E301/E302/316/322–326 — nunca por texto; fallback honesto). Só `traduzirErroMp` é testado (o resto é DOM) |

## Mudanças em módulos existentes

- `frontend/lib/catalogo/produtos.ts` — `especiaisDa` ganha `!p.kit`: os kits
  de cápsula (`kit: true`, `formato: "capsula"`, linha clássico) apareciam
  duplicados como formato especial na PDP. Teste novo em `produtos.test.ts`.
- `frontend/lib/sacola/checkout.ts` — `pagarComPix` e `pagarComCartao` novos
  campos: header `Idempotency-Key` (via idempotencia.ts), `cupom` no corpo,
  CPF obrigatório em `formData.payer.identification`. Cartão manda
  `formData = { token, payment_method_id, issuer_id, installments,
  transaction_amount, payer: { email, identification } }` — exatamente o que o
  backend repassa. `OpcaoDeFrete` ganha `gratis?: boolean`.

## Componentes e páginas

- `frontend/components/layout/AvisoFreteGratis.tsx` (client, pequeno): o texto
  da barra do Cabeçalho. SSR e primeiro render mostram o fallback atual
  ("Frete grátis acima de R$ 149"); efeito busca o valor real e troca. O
  Cabeçalho continua Server Component — só o `<span>` vira ilha.
- `frontend/components/layout/BarraFreteGratis.tsx` (client): lê `useSacola` +
  config; "Faltam R$ X para o frete grátis" com barra de progresso ou "Frete
  grátis garantido". Usada na página da sacola e no resumo do checkout.
- `frontend/app/(vitrine)/checkout/page.tsx` — CEP com máscara + ViaCEP
  (falha silenciosa → manual segue); campo CPF ("para a nota fiscal")
  validado; cupom no resumo (subtotal − desconto + frete = total; `motivo` de
  cupom inválido não trava o fluxo); rádio Pix/Cartão (Cartão SÓ com a env;
  sem ela nem aparece e o texto continua "Pagamento por Pix"); CardForm
  montado só com método cartão + frete escolhido, remontado quando o total
  muda; parcelas via select populado pelo SDK (padrão 1x); status
  `rejeitado`/`cancelado` na resposta → erro na tela, sacola intacta, chave de
  idempotência descartada; sucesso → `eventoPurchase` UMA vez (ref), sacola
  limpa, link "Acompanhar pedido" → `/pedido/[id]`; frete `gratis: true`
  rotulado "Frete grátis".
- `frontend/app/(vitrine)/pedido/[id]/page.tsx` (client): sem sessão →
  `/account/login?de=/pedido/<id>`; `GET /my-orders/:id`; linha do tempo
  pendente→aprovado→enviado→entregue com desvio cancelado/rejeitado/
  reembolsado; itens, endereço, frete, desconto/cupom se houver, rastreio com
  link `https://rastreamento.correios.com.br/app/index.php?objeto=<código>`.
- `frontend/app/(vitrine)/account/page.tsx` — cada pedido da lista linka para
  `/pedido/[id]`.
- `frontend/app/(vitrine)/sacola/page.tsx` — `BarraFreteGratis` no resumo.
- `PainelCompra.tsx` / `CardKit.tsx` — teto `min(20, estoque)` quando o
  estoque ao vivo é conhecido (`produtoId` presente e estoque > 0); no card de
  kit (sem stepper) o teto barra o clique repetido contando o que já está na
  sacola; mensagem discreta ao bater no teto.
- `frontend/app/(vitrine)/termos-de-uso/page.tsx` — a seção "Assinatura"
  passa a dizer a verdade: hoje toda compra é única; o Clube ainda não abriu.
  (Cartão + Pix agora é verdade e fica.)

## Config

- `frontend/next.config.mjs` — SÓ o CSP: `script-src` +
  `https://www.googletagmanager.com` (sdk.mercadopago.com já está);
  `connect-src` + `https://viacep.com.br`, `https://*.google-analytics.com`,
  `https://www.googletagmanager.com` (api.mercadopago.com já está);
  `frame-src` vira `https://*.mercadopago.com https://sdk.mercadopago.com`
  (secure fields). Cada origem comentada no estilo do arquivo.
- `frontend/.env.example` — `NEXT_PUBLIC_MP_PUBLIC_KEY` documentada (vazia =
  cartão nem aparece); nota estale sobre a pendência de CSP do GA4 atualizada.

## Ordem de execução (TDD)

1. Testes + implementação dos módulos puros: `cpf`, `cep`, `config-loja`,
   `cupom`, `idempotencia`, `traduzirErroMp`, `especiaisDa`.
2. `checkout.ts` (idempotência + cupom + cartão) e `cartao.ts` (DOM).
3. `AvisoFreteGratis` + Cabeçalho; `BarraFreteGratis` + sacola.
4. Checkout page; `/pedido/[id]`; links de account/confirmação; purchase.
5. Teto de estoque; CSP; .env.example; termos.
6. `npm --prefix frontend run test` (223 + novos), `npx tsc --noEmit`,
   `npm --prefix frontend run build` UMA vez ao final.

## O que fica dependendo de credencial

- Fluxo real de cartão (tokenização + cobrança) exige
  `NEXT_PUBLIC_MP_PUBLIC_KEY` de produção — sem ela o rádio não aparece e o
  Pix segue padrão. Testável só com credencial.
- Cupom e `/my-orders/:id` dependem dos agentes E/F desta onda — o front
  degrada com mensagem honesta se a rota ainda não existir (404 → cupom
  "não pôde ser validado"; pedido "não encontrado").
