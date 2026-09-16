# Mercado Pago — a aplicação fala Orders, e a loja aprendeu a falar Orders

**Medido em 25/08/2026** contra a aplicação `7289536483168143`, usuário de teste
`TESTUSER2898971294415703080` (user id `2664947316`). Tudo aqui é resposta real
do gateway, não leitura de documentação.

> **Por que este documento existe.** A loja inteira foi escrita contra
> `POST /v1/payments`. Essa chamada responde **401** nesta aplicação. A
> mensagem de erro aponta para o lugar errado, e sem este registro o próximo
> a mexer perde as mesmas horas trocando credencial.
>
> **A migração foi feita em 16/09/2026** (§5). As seções 1 a 4 ficam como
> estão: elas são o diagnóstico, e é ele que decide o que fazer no dia em que
> alguém trocar a aplicação do Mercado Pago. Rode a sonda da §1 **antes** de
> trocar qualquer credencial.

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

## 5. FEITO em 16/09/2026 — o que mudou no código

A migração está no ar. O que esta seção listava como "precisa mudar" virou isto:

| Onde | O que ficou |
|---|---|
| `src/utils/mercadoPagoOrders.js` | **novo.** Monta o corpo da Order, traduz status e lê a resposta. Funções puras, 20 testes sem banco |
| `src/config/mercadopago.js` | exporta `order` **e** `payment` — a criação é Orders, a releitura do webhook é Payments |
| `PaymentController.createPayment` | monta Order; `street_number` virou **string**; recusa (402) é desembrulhada de `data` |
| `PaymentController.receiveWebhook` | acha o pedido por `external_reference`, com o caminho antigo preservado para pedidos anteriores |
| `ordersRepository` | ganhou `lockOrderByIdempotencyKey` |
| `ticketUrlDoPagamento` | relê por `order.get`, não `payment.get` |
| `validatedItems` | carrega `sku`, que vira `external_code` |
| os 4 dublês de teste | `order.create`, e `payment.get` devolvendo `external_reference` |

**`traduzirStatusMp` NÃO mudou, e essa foi a descoberta que encolheu a
migração.** A suposição da §5 original era que o webhook precisaria aprender o
vocabulário da Orders. Ele não precisa: a notificação continua chegando como
`type: "payment"` com o id **numérico**, e `GET /v1/payments/{numérico}`
responde 200 no vocabulário **antigo** (`approved`/`pending`/`rejected`) — com
`external_reference` junto, que é o que reencontra o pedido. Medido.

### 5.1 O que só apareceu ao migrar de verdade

Quatro regras que a §4 não tinha, todas arrancadas de erro real do gateway:

1. **`sum(items) == total_amount`, ou 400 `order_items_total_amount_mismatch`.**
   Na Payments os itens eram enfeite de antifraude e o valor vinha de
   `transaction_amount`. Na Orders os itens **são** o valor — então frete virou
   linha de item e desconto virou linha **negativa** (o gateway aceita as duas,
   medido). Efeito colateral bom: a fatura do cliente mostra a composição do
   preço.
2. **`payer.address.street_number` é STRING.** Na Payments era Integer e a API
   validava; na Orders ela valida o oposto — *"expected string, but got
   number"*. O código tinha um comentário longo explicando por que convertia
   para número. Migrar sem reler esse campo daria 400 em **todo** pedido com
   endereço.
3. **`shipments` não existe.** *"additionalProperties '$.shipments' not
   allowed"*. O endereço de entrega vai só em `payer.address`.
4. **Recusa de cartão é HTTP 402, não 201.** A Payments devolvia 201 com
   `status: "rejected"` e o fluxo seguia reto. A Orders **lança** — mas carrega
   a order inteira em `data`, com `status: "failed"` e o motivo real em
   `transactions.payments[0].status_detail`. Sem desembrulhar isso, toda recusa
   de cartão viraria "o gateway caiu": o estoque voltaria, mas o pedido não
   existiria para ninguém explicar ao cliente.

Também medido: `items[].external_code` é **opcional** (sem SKU, o campo some em
vez de ir com um UUID truncado) e `expiration_time: "PT30M"` mantém a janela de
30 minutos do Pix — sem o campo o padrão do gateway é 24 horas, e estoque
reservado por 24 horas é estoque que some da prateleira.

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
