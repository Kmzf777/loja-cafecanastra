# Mercado Pago — a aplicação fala Orders, e a loja fala Payments

**Medido em 25/08/2026** contra a aplicação `7289536483168143`, usuário de teste
`TESTUSER2898971294415703080` (user id `2664947316`). Tudo aqui é resposta real
do gateway, não leitura de documentação.

> **Por que este documento existe.** A loja inteira foi escrita contra
> `POST /v1/payments`. Essa chamada responde **401** nesta aplicação. A
> mensagem de erro aponta para o lugar errado, e sem este registro o próximo
> a mexer perde as mesmas horas trocando credencial.

---

## 1. O sintoma, e por que ele mente

```
POST /v1/payments
401 {"code":7,"description":"Unauthorized use of live credentials"}
```

A frase sugere três coisas erradas: credencial de produção, cartão de teste em
ambiente live, ou credenciais misturadas. **Não é nenhuma das três.**

O que foi descartado, cada um com medição:

| Suspeita | Como foi descartada |
|---|---|
| Credencial é de produção | `GET /users/me` → `"nickname":"TESTUSER2898971294415703080"`, `"tags":["test_user","normal"]` |
| Public key e access token de contas diferentes | Token de cartão criado pelas duas vias, `live_mode: true` nas duas |
| É o cartão de teste em modo live | O **Pix** dá o mesmo 401, e Pix não tem cartão |
| É o SDK | `curl` cru dá o mesmo `HTTP 401` |

**A causa é o endpoint.** A aplicação foi criada escolhendo Checkout
Transparente **via Orders**, e o Mercado Pago não autoriza a API de Payments
nela.

### Como sondar em dez segundos

```bash
curl -s -o /dev/null -w "%{http_code}\n" -X POST https://api.mercadopago.com/v1/payments \
  -H "Authorization: Bearer $MP_ACCESS_TOKEN" -H "Content-Type: application/json" \
  -H "X-Idempotency-Key: sonda-$RANDOM" \
  -d '{"transaction_amount":1,"payment_method_id":"pix","payer":{"email":"a@b.com","identification":{"type":"CPF","number":"12345678909"}}}'
```

`401` = a aplicação é Orders. `201` = é Payments, e o código atual serve.

---

## 2. O que funciona e o que não funciona

| Chamada | Resultado |
|---|---|
| `POST /v1/payments` (criar cobrança) | **401** |
| `POST /v1/orders` (Pix) | **201**, `action_required/waiting_transfer`, QR gerado |
| `POST /v1/orders` (cartão `APRO`) | **201**, `processed/accredited` — aprovado |
| `GET /v1/payments/{id_numerico}` | 200 |
| `GET /v1/payments/PAY01...` | **404** — o endpoint antigo não lê o id novo |
| `GET /v1/orders/{id}` | 200 |
| `preapproval/search` (Clube) | 200 — **o Clube não é afetado** |

Só a **criação** está bloqueada. Leitura, assinatura recorrente e o resto da
loja seguem de pé.

---

## 3. O `statement_descriptor` foi aceito

Esta era a maior incógnita de produção: é o único campo da integração que
**falha fechado** — recusado, não é uma venda perdida, são todas. Nos dois
meios de pagamento a resposta voltou com

```json
"payment_method": { "statement_descriptor": "CAFECANASTRA", ... }
```

**Risco encerrado**, com a ressalva de que foi validado na conta de teste; a de
produção é outra conta e merece a mesma sonda antes do go-live.

---

## 4. As diferenças de forma que mordem

| Assunto | Payments (o que a loja faz hoje) | Orders (o que a aplicação exige) |
|---|---|---|
| Valor | `transaction_amount: 1` (número) | `total_amount: "1.00"` (**string**) |
| Descritor | topo do corpo | `transactions.payments[].payment_method.statement_descriptor` |
| Itens | `additional_info.items` | `items`, no topo |
| Id do item | `product_id` (UUID, 36 chars) | `external_code`, **máximo 30 chars** — o UUID **não cabe** |
| Token do cartão | `token` no topo | `transactions.payments[].payment_method.token` |
| Parcelas | `installments` no topo | dentro de `payment_method` |
| Id do pagamento | inteiro (`174705464103`) | string (`PAY01M0XVW236D3RCYSR3SSP7Q9WP`) |
| QR / ticket do Pix | `point_of_interaction.transaction_data` | `transactions.payments[].payment_method` |
| Status | `approved`, `pending`, `rejected` | `processed/accredited`, `action_required/waiting_transfer` |
| `notification_url` por pedido | aceito | **não existe** — só cadastro no painel |

O limite de 30 caracteres não foi lido em documentação; foi o próprio gateway
que recusou:

```
400 '$.items[0].external_code' - length must be <= 30, but got 36
```

**`pagamento_id_mp` já é `text`** (migração 0005, decisão deliberada), então o
id em formato string **cabe sem migração de banco**.

---

## 5. O que isso implica para o código

Precisa mudar:

- `PaymentController.createPayment` — monta Order em vez de Payment
- `traduzirStatusMp` (`utils/statusDePedido.js`) — não conhece nenhum status do
  Orders
- `ticketUrlDoPagamento` — o QR do Pix mudou de lugar
- O que vai em `pagamento_id_mp`: o id da **Order** (`ORDTST...`), porque é o
  único relegível — o `PAY01...` dá 404 no endpoint antigo
- `items[].external_code` — usar o **SKU**, não o `product_id`
- O dublê do Mercado Pago nos testes, e os testes do checkout

Não precisa mudar:

- O Clube (`preapproval` é outra API, e responde 200)
- Estoque, cupons, frete, e-mails, idempotência de servidor
- O banco

---

## 6. O que ficou por descobrir

**A notificação do webhook.** Como Orders não aceita `notification_url` por
pedido, o webhook só existe se cadastrado no painel — e não há como saber o
tópico, o formato do id e o esquema de assinatura sem uma URL pública recebendo
uma notificação real.

O caminho, quando houver meia hora: subir um ouvinte que só registre o que
chega, expor por túnel (`ngrok http 3333`), cadastrar a URL em **Suas
integrações → a aplicação → Webhooks**, criar uma Order de teste e ler o que o
Mercado Pago mandou. Foi montado e testado em 25/08 (o túnel funcionou ponta a
ponta); faltou o cadastro no painel.

Isso importa porque **o webhook é quem tira o pedido de "pendente"**. Errar o
formato significa cobrar e nunca avançar o pedido — e no Pix, que nasce
`action_required`, não há outro caminho.

---

## 7. Cartões de teste

O **nome do titular** decide o resultado, não o número.

| Titular | Resultado |
|---|---|
| `APRO` | aprovado |
| `OTHE` | recusado por erro geral |
| `FUND` | saldo insuficiente |
| `SECU` | CVV inválido |
| `EXPI` | vencimento |
| `CONT` | pendente |

Mastercard `5480 8328 0103 3311` · Visa `4235 6477 2802 5682` ·
Amex `3753 651535 56885` (CVV de 4 dígitos) · Elo débito `5067 7667 8388 8311`.
CVV `123`, validade `11/30`, CPF `12345678909`.
