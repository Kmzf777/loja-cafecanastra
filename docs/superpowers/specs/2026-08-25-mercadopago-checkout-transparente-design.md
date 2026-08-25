# Mercado Pago — fechar o Checkout Transparente para produção

**Data:** 2026-08-25
**Branch:** `worktree-mercadopago-transparente`

## O que este trabalho NÃO é

Não é integrar o Mercado Pago do zero. O Checkout Transparente já está de pé e
vende: o `CardForm` do SDK v2 tokeniza o cartão nos iframes
(`frontend/lib/sacola/cartao.ts`), o `PaymentController` cobra com
`payment.create()`, o Pix nasce com QR e expiração de 30 minutos, e o webhook
valida HMAC antes de mexer em pedido ou estoque.

O que falta é o que só aparece **depois** da primeira semana em produção: taxa
de aprovação baixa, fatura que o cliente não reconhece, conciliação manual e
cobrança duplicada. São seis lacunas, todas no que a loja **manda** ao Mercado
Pago — nenhuma delas impede vender, e é justamente por isso que passaram.

## O que já foi conferido (e vale registrar, para não reabrir)

O SDK instalado (`mercadopago`, em `backend/node_modules`) suporta os seis
campos nativamente. Nada aqui pede upgrade de dependência:

- `dist/types.d.ts` → `Options` tem `idempotencyKey` e `meliSessionId`
- `dist/clients/payment/create/types.d.ts` → `PaymentCreateRequest` tem
  `external_reference`, `statement_descriptor`, `three_d_secure_mode`,
  `additional_info` (com `ip_address`, `items`, `payer`, `shipments`) e
  `payer.first_name` / `last_name` / `address`

A CSP também já está pronta: `frontend/next.config.mjs:92` libera
`https://www.mercadopago.com` em `script-src`, que é a origem do `security.js`
do Device ID. **Não mexa na CSP** — ela já cobre o que este trabalho precisa.

## Os cinco ajustes desta onda

### 1. Idempotência que o Mercado Pago enxerga

**Hoje.** A loja tem chave de idempotência própria, gravada em
`canastra.pedidos.chave_idempotencia`, mas o Mercado Pago nunca a vê. Quando as
duas requisições de um duplo clique passam pela conferência inicial antes de
qualquer uma gravar, o índice único barra a segunda — **depois de ela já ter
cobrado**. `PaymentController.js:876` reconhece a situação e só sabe gritar:

```
PAGAMENTO DUPLICADO: chave … já tinha pedido; pagamento MP … precisa de estorno manual.
```

**Mudança.** `payment.create({ body, requestOptions: { idempotencyKey: chaveIdempotencia } })`.

**Por que funciona aqui.** Porque a chave é estável entre tentativas: o
navegador já manda `Idempotency-Key` (`frontend/lib/sacola/checkout.ts:305`), e
`frontend/lib/sacola/checkout.test.ts:123` prova que duas tentativas do mesmo
pedido reusam o mesmo valor. Com a mesma chave nas duas chamadas, o Mercado
Pago devolve o **mesmo** pagamento em vez de criar outro.

O log de pagamento duplicado **fica onde está**. Ele deixa de ser o caminho
esperado e vira rede de segurança — a defesa de servidor não some porque uma
defesa de gateway apareceu.

### 2. `external_reference` — o fio entre o painel do MP e o pedido

**Hoje.** Ausente no pagamento avulso. O Clube já usa
(`ClubeController.js:307`), então a assinatura é conciliável e a venda comum
não é: no painel do Mercado Pago só existe o `payment_id`, e achar o pedido
correspondente é garimpo.

**A restrição de desenho.** O pedido nasce **depois** do pagamento — a ordem é
cobrar, depois `createOrder`. Então o id do pedido não existe na hora de montar
o `paymentData`, e não dá para usá-lo.

**Decisão.** `external_reference: chaveIdempotencia`. É o mesmo valor que a
linha do pedido grava em `chave_idempotencia`, já é único por índice, e já
existe antes da cobrança. Conciliação painel ↔ banco por um campo que ninguém
precisa criar.

### 3. `statement_descriptor` — o nome na fatura

**Hoje.** Ausente. A fatura do cartão sai com o nome da conta Mercado Pago, e
"não reconheço esta compra" é uma das causas mais comuns de contestação.

**Mudança.** `statement_descriptor: "CAFECANASTRA"` — 12 caracteres, dentro do
limite de 13 do Mercado Pago.

**Por que constante e não `LOJA_NOME`.** `LOJA_NOME` vale `Cafe Canastra`, com
espaço e 13 caracteres. O descritor não aceita o que o User-Agent da Melhor
Envio aceita; reusar a variável faria uma mudança inocente num campo virar
recusa no outro.

### 4. `payer` completo e `additional_info`

**Hoje.** O `payer` leva só e-mail e, quando existe, CPF. Nada de
`additional_info`.

**Mudança.** Preencher `payer.first_name`, `payer.last_name`, `payer.address`,
e `additional_info` com `items` (id, título, quantidade, preço unitário),
`payer`, `shipments.receiver_address` e `ip_address`.

**Custo real: baixo.** `validatedItems` e `address` já estão no escopo do
controller, conferidos contra o banco. É montagem de objeto, não consulta nova.

**Ganho.** É o principal insumo do antifraude do Mercado Pago — pedido sem
`additional_info` é pedido cego para o motor de risco — e é item pontuado na
Qualidade da integração.

### 5. Device ID (`security.js` + `meliSessionId`)

**Hoje.** Não existe. `security.js` não aparece em lugar nenhum do repositório.

**Mudança, em duas pontas.**

- *Vitrine:* carregar `https://www.mercadopago.com/v2/security.js` com
  `view="checkout"`, que popula `window.MP_DEVICE_SESSION_ID`; enviar o valor
  no corpo do `process_payment`, no campo `deviceId`.
- *Serviço:* repassar em `requestOptions.meliSessionId`, que o SDK converte no
  header `X-meli-session-id`.

**Ordem.** É o último dos cinco porque é o único que toca as duas pontas. Os
quatro anteriores são backend puro e independentes entre si.

## Fora de escopo, e por quê

**3DS 2.0 (`three_d_secure_mode`) — onda separada, decidida em 2026-08-25.**
Não é um campo: com o modo ligado, o pagamento pode voltar `pending` /
`pending_challenge` com uma `external_resource_url`, e o navegador tem de abrir
o desafio do banco e esperar o retorno. Isso muda o contrato de resposta do
`process_payment` e a máquina de estados do checkout — sozinho, é maior que os
cinco desta onda somados. Entra depois que estes cinco estiverem provados em
teste. Enquanto não entrar, a responsabilidade por fraude de cartão continua
com a loja, que é exatamente a situação de hoje: nada piora.

**API de estorno (refunds).** O log de pagamento duplicado pede estorno manual.
Com o ajuste 1 esse caminho deixa de ser esperado, então automatizar o estorno
resolveria um caso que passa a ser raro. YAGNI.

**Migração para Bricks.** O `CardForm` funciona. Trocar de SDK não é ajuste, é
reescrita.

**Tela de conciliação no painel.** O `external_reference` do ajuste 2 é o que
tornaria essa tela possível — mas a tela em si é outro trabalho.

## Como cada um se prova

Os testes de backend existentes (`test/pagamento.test.js`,
`test/f4_checkout_e_webhook.test.js`) já dublam o cliente do Mercado Pago.
Cada ajuste ganha asserção sobre **o que sai** na chamada:

| Ajuste | Asserção |
|---|---|
| 1 | `requestOptions.idempotencyKey` === a chave do pedido; replay não gera segunda chamada a `payment.create` |
| 2 | `body.external_reference` === `chave_idempotencia` da linha gravada |
| 3 | `body.statement_descriptor` presente e com no máximo 13 caracteres |
| 4 | `body.additional_info.items` casa item a item com `validatedItems`; `payer.first_name` preenchido |
| 5 | `requestOptions.meliSessionId` chega quando o corpo traz o device id, e a ausência dele **não** derruba o pagamento |

A última linha é a que importa mais no ajuste 5: navegador com bloqueador de
script não recebe `security.js`, e um checkout que morresse por causa disso
trocaria uma melhoria de aprovação por uma perda de venda.

**Ambiente.** Credenciais de **teste** (`TEST-…`) primeiro, com os cartões de
teste do Mercado Pago — o nome do titular (`APRO`, `FUND`, `SECU`, `EXPI`,
`CONT`) decide o resultado. Pix em teste gera QR mas não é pagável; o caminho
Pix se valida pelo "Simular notificação" do painel, não pagando.

## Riscos

**O `statement_descriptor` pode ser recusado pela conta.** Contas com restrição
de descritor rejeitam o campo. Se acontecer, o sintoma é erro na criação do
pagamento — e o teste do ajuste 3 pega isso antes da produção.

**O ajuste 4 manda mais dado pessoal para o Mercado Pago** (nome e endereço,
além do e-mail e CPF que já vão hoje). **Conferido em 2026-08-25:** a política
de privacidade já declara "Mercado Pago — pagamento do pedido e a cobrança
recorrente do Clube" na lista de operadores
(`frontend/app/[locale]/(vitrine)/politica-de-privacidade/conteudo.ts:178`, e o
equivalente em `en` e `es`). Nome e endereço de entrega cabem na finalidade
declarada, então **não há texto a mudar**. O que a política promete e continua
verdade é outra coisa, e este trabalho não a toca: o número do cartão não passa
pelos servidores da loja, porque os campos são iframes do SDK.

**A ordem cobrar-antes-de-gravar continua.** Nenhum destes cinco a muda. Ela é
a razão de o `external_reference` ser a chave de idempotência e não o id do
pedido, e é uma decisão anterior a este trabalho.
