# Melhor Envio: da cotação quebrada à etiqueta comprada com um clique

**Data:** 25 de agosto de 2026
**Branch:** `worktree-melhor-envio` (worktree em `.claude/worktrees/melhor-envio`)
**Base:** `0470bcf`
**Estado:** aprovado pelo cliente

---

## O problema

A loja já chama a Melhor Envio — e chama errado.

`backend/src/controllers/ShippingController.js` cota frete pela API desde a F4.
Mas a cotação que o cliente vê na vitrine é calculada com um **pacote que não
existe**, e a que o servidor cobra no checkout é calculada com o pacote real. Os
dois números discordam em toda venda, e quem descobre isso é o cliente, no
último passo do pagamento, na forma de um `409 — o frete mudou`.

Além disso, nada além da cotação existe. Comprar etiqueta, imprimir e rastrear
são trabalho manual no painel da Melhor Envio, com o código de rastreio
redigitado à mão no Bling para o job de hora em hora encontrar.

Este documento descreve as duas coisas: **consertar a cotação que está no ar** e
**integrar o ciclo completo — cotar, comprar, imprimir, rastrear.**

---

## O bug que já está em produção

`frontend/lib/sacola/checkout.ts:113` monta o corpo da cotação com três campos:

```ts
items: itens.map((i) => ({
  product_id: i.product_id,
  quantity: i.quantity,
  price: i.price,
})),
```

Não há peso. Não há dimensão. E `ShippingController.js:100-106` tem defaults
para exatamente isso:

```js
width:  item.width  ? Number(item.width)  : 20,
height: item.height ? Number(item.height) : 5,
length: item.length ? Number(item.length) : 20,
weight: item.weight ? Number(item.weight) : 0.3,
```

Como o navegador nunca manda esses campos, **toda cotação da vitrine é feita com
0,3 kg e 20×5×20 cm**. Os produtos reais, em `canastra.produtos`:

| SKU | Peso real | Dimensão real | Cotado como |
|---|---|---|---|
| `classico-graos-250` | 0,250 kg | 18×7×24 | 0,3 kg · 20×5×20 |
| `classico-graos-1000` | 1,000 kg | 24×10×32 | 0,3 kg · 20×5×20 |
| `classico-graos-caixa-4x500` | 2,000 kg | 18×7×24 | 0,3 kg · 20×5×20 |
| `drip-classico-display-10` | 0,110 kg | 18×7×24 | 0,3 kg · 20×5×20 |

Nenhum bate. E o checkout — `conferirFrete` em `PaymentController.js:72` — recota
com os itens lidos do **banco**, que trazem o peso certo. Os dois lados chegam a
números diferentes, `conferirFrete` tolera um centavo, e a diferença entre um
pacote de 2 kg e um de 300 g é de reais.

Consequência: uma caixa de 4×500 g é anunciada com frete de pacote pequeno e o
cliente é barrado com `409` na hora de pagar. A rota também é pública e aceitava
dimensões do corpo da requisição — vetor de abuso que ninguém explorou, mas que
some junto.

**Isto não faz parte da integração nova. É a Fase 1, e não depende de nenhuma
credencial.**

---

## O que entra, e por decisão de quem

Decidido com o cliente em 25/08/2026. Onde houve alternativa rejeitada, ela está
registrada — porque a razão da escolha some antes do código.

| Decisão | Escolhido | Rejeitado |
|---|---|---|
| Escopo | Cotação + etiqueta + rastreio automático | Só cotação; cotação + etiqueta |
| Papel do Bling | Continua o ERP fiscal, e **recebe** o rastreio da Melhor Envio | Bling como fonte do rastreio; os dois alimentando o mesmo campo |
| Compra da etiqueta | Botão no painel, um clique por pedido | Automática ao aprovar o pagamento; compra em lote |
| Estrutura do código | Dois serviços, espelhando `blingClient` + `blingPedidos` | Arquivo único; biblioteca npm de terceiro |
| Onde mora o token | Coluna protegida em `config_loja` | Só no `.env` |
| Autorização OAuth | Manual por `curl`, uma vez, como o Bling | Rota pública `/api/melhor-envio/callback` |
| Quando o pedido vira `enviado` | No evento `order.posted` | Ao gerar a etiqueta (comportamento herdado do Bling) |
| Entrega local (`LOCAL_PREFIXES`) | Fica como está | Tornar configurável nesta tarefa |

---

## Arquitetura

Dois serviços com uma responsabilidade cada, espelhando o par que já está em
produção para o Bling. A separação não é estética: o ciclo de vida do token e a
regra de negócio da etiqueta falham por motivos diferentes, se testam de formas
diferentes, e misturá-los produz o arquivo que ninguém quer abrir.

### `backend/src/services/melhorEnvioClient.js`

Sabe uma coisa só: **manter um `access_token` válido e fazer requisições
autenticadas.** Molde: `blingClient.js`.

- Ordem de leitura do refresh token: **memória → banco → `.env`**. O `.env` é a
  semente da primeira autorização, nada mais.
- Renovação preventiva, com margem antes do vencimento real — para não perder uma
  chamada porque o token venceu entre o `if` e o `fetch`.
- Um único voo de renovação por processo (o mesmo *lock* de `blingClient`): duas
  renovações simultâneas queimariam o token uma da outra.
- O token novo é **persistido antes de ser usado**. Falha ao gravar não derruba a
  chamada — segue com o token em memória e grita no log, exatamente como o Bling.
- `User-Agent` obrigatório em toda requisição: `${LOJA_NOME} (${LOJA_EMAIL})`. A
  API recusa sem ele.

### `backend/src/services/melhorEnvioEtiquetas.js`

Sabe uma coisa só: **a regra de negócio da etiqueta** — carrinho, pagamento,
geração, impressão, e o que cada situação significa para o pedido da loja.
Molde: `blingPedidos.js`.

### Fronteira entre os dois

`melhorEnvioEtiquetas` chama `melhorEnvioClient.requisitar()` e nunca toca em
token. `melhorEnvioClient` não sabe o que é um pedido. Nenhum dos dois importa o
outro na direção contrária — a mesma disciplina que o comentário no topo de
`ShippingController.js` já documenta para o par `PaymentController`/`Shipping`.

---

## Migração de banco

Coluna nova em `canastra.config_loja`, protegida por privilégio de coluna como a
`bling_refresh_token` da 0012 — nem a chave anônima nem token de usuário a leem
pelo PostgREST:

```sql
ALTER TABLE canastra.config_loja
  ADD COLUMN melhor_envio_refresh_token   text,
  ADD COLUMN melhor_envio_token_expira_em timestamptz;
```

Colunas novas em `canastra.pedidos`:

```sql
ALTER TABLE canastra.pedidos
  ADD COLUMN me_servico_id  integer,      -- serviço escolhido, gravado no checkout
  ADD COLUMN me_order_id    text,         -- id da etiqueta na Melhor Envio
  ADD COLUMN me_protocolo   text,         -- protocolo impresso na etiqueta
  ADD COLUMN me_situacao    text,         -- pending|released|generated|posted|delivered|canceled
  ADD COLUMN me_claim_em    timestamptz,  -- relógio do claim
  ADD COLUMN me_comprada_em timestamptz;

CREATE UNIQUE INDEX pedidos_me_order_id_idx
  ON canastra.pedidos (me_order_id)
  WHERE me_order_id IS NOT NULL;
```

O índice único parcial segue o molde de `pedidos_bling_id_idx`: quase todo pedido
vive com `me_order_id` nulo, e o índice torna **impossível** existirem duas
etiquetas para o mesmo pedido — a defesa mora no banco, não na boa vontade do
código.

`me_claim_em` existe separado de `me_situacao` pelo mesmo motivo que
`bling_claim_em`: a situação diz *onde o trabalho parou*, o claim diz *quem está
trabalhando agora*. Um claim velho pode ser retomado; uma situação não expira.

**Todo `UPDATE` nestas colunas escreve `atualizado_em = now()` junto.** Não há
trigger de `moddatetime` neste schema — a regra é explícita e está documentada na
definição da tabela.

---

## O buraco do `service id`

`canastra.pedidos` guarda `metodo_envio` (o **nome**: `"Correios PAC"`) e `frete`
(o valor). A Melhor Envio precisa do **`service id` numérico** para inserir o
frete no carrinho. Esse id vem na cotação (`opt.id` em
`calcularOpcoesDeFrete`) e hoje é descartado.

Sem ele, comprar a etiqueta significaria adivinhar o serviço a partir de um
texto. Adivinhar errado é comprar a etiqueta errada com dinheiro real.

Portanto:

- O checkout grava `me_servico_id` a partir da opção que o cliente escolheu.
- `conferirFrete` passa a casar **id + nome + preço**, onde hoje casa nome +
  preço. Mais apertado, mesmo custo — e é o lado seguro: o id é o campo que a
  compra vai usar, então é o que precisa estar conferido.
- Pedido antigo, sem `me_servico_id`, não trava: o botão da etiqueta recota e
  pede ao admin que confirme o serviço. Explicitamente, na tela — não em silêncio.

---

## Autenticação

OAuth 2.0. `access_token` vale **30 dias**, `refresh_token` vale **45 dias**.

### Por que não pode ficar só no `.env`

Um token de 30 dias no `.env` significa que a loja para de cotar frete um mês
depois de ser configurada, sem aviso. Frete que não cota é checkout que não
fecha — perda de venda silenciosa, descoberta por reclamação de cliente. Por isso
a renovação é automática e o token vive no banco.

### Autorização: manual, sem rota pública

`redirect_uri = https://loja.canastrainteligencia.com/` — a própria home, que
ignora o `?code=`. O `code` é copiado da barra de endereço e trocado por `curl`,
uma vez.

Rejeitada a rota `/api/melhor-envio/callback`: é uma rota pública que aceita um
`code` e emite um token, criada numa loja em produção para um botão usado uma vez
por ano. `docs/bling.md` já documenta o caminho manual e ele funciona.

### Escopos — os dez, e só eles

`shipping-calculate`, `cart-read`, `cart-write`, `shipping-checkout`,
`shipping-generate`, `shipping-print`, `shipping-tracking`, `shipping-cancel`,
`orders-read`, `users-read`.

Nada de `products-write` nem `users-write`: a integração não escreve produto nem
usuário na Melhor Envio, e escopo pedido a mais é dano a mais quando o token
vazar.

---

## Variáveis de ambiente

Em `backend/src/.env`, documentadas em `.env.example` como as do Bling:

| Variável | Papel |
|---|---|
| `MELHOR_ENVIO_URL` | `https://melhorenvio.com.br` em produção, `https://sandbox.melhorenvio.com.br` no sandbox |
| `MELHOR_ENVIO_CLIENT_ID` | do aplicativo, área dev |
| `MELHOR_ENVIO_CLIENT_SECRET` | do aplicativo — **serve para duas coisas**: renovar o token e validar o HMAC do webhook |
| `MELHOR_ENVIO_REFRESH_TOKEN` | **semente** da primeira autorização, só isso |
| `MELHOR_ENVIO_ATIVO` | liga a integração, molde de `BLING_ATIVO` |
| `ZIPCODE_ORIGIN` | CEP de despacho — precisa ser o endereço de origem cadastrado na conta |
| `LOJA_NOME`, `LOJA_EMAIL` | compõem o `User-Agent` obrigatório da API |

O `MELHOR_ENVIO_TOKEN` de hoje **sai**: era um `access_token` estático colado à
mão, e é justamente o que vence em 30 dias sem ninguém perceber. Quem passa a
responder por ele é o par `MELHOR_ENVIO_CLIENT_ID`/`CLIENT_SECRET` mais o refresh
token no banco.

Que o `CLIENT_SECRET` seja a chave do HMAC do webhook **e** a credencial de
renovação é decisão da Melhor Envio, não nossa. A consequência prática é que
vazá-lo custa as duas coisas ao mesmo tempo — daí ele nunca aparecer em log nem
em mensagem de erro.

---

## O botão "Comprar etiqueta"

`POST /melhor-envio/pedidos/:id/etiqueta` — só admin, mesmo `isAdmin` das rotas
do Bling.

Quatro chamadas à API, um clique:

| # | Endpoint | Resultado | `me_situacao` |
|---|---|---|---|
| 1 | `POST /api/v2/me/cart` | frete no carrinho | `pending` |
| 2 | `POST /api/v2/me/shipment/checkout` | pago com saldo | `released` |
| 3 | `POST /api/v2/me/shipment/generate` | etiqueta gerada, **sai o rastreio** | `generated` |
| 4 | `POST /api/v2/me/shipment/print` | PDF | — |

### Retomável, porque é dinheiro

Cada passo grava `me_situacao` **antes** de seguir para o próximo. Se a conexão
cair entre o 2 e o 3, o próximo clique lê `released` e **continua do 3** — não
compra de novo.

O claim (`UPDATE ... WHERE me_situacao IS NULL AND me_claim_em IS NULL`) decide o
vencedor no banco: dois cliques simultâneos produzem uma etiqueta e um "já está
sendo processado".

### Saldo insuficiente é uma mensagem, não um erro genérico

Carteira zerada é a falha mais provável deste botão, e "erro ao comprar etiqueta"
vira chamado de suporte. A resposta diz **"saldo insuficiente na carteira Melhor
Envio"**, com o valor que faltou.

---

## O pedido não vira `enviado` ao gerar a etiqueta

Pelo Bling, aparecer rastreio significava que a expedição já tinha despachado —
alguém digitou o código depois de postar. Pela Melhor Envio, o rastreio existe no
instante em que a etiqueta é gerada, com o pacote ainda em cima da mesa.

Herdar a regra atual mandaria "seu pedido foi enviado" antes de o pacote sair.
Então:

| Momento | Pedido | Cliente |
|---|---|---|
| Etiqueta gerada | continua `aprovado`, com `codigo_rastreio` gravado | não recebe nada |
| `order.posted` | vira `enviado` | recebe o e-mail com o código |
| `order.delivered` | vira `entregue` | — |

---

## Webhook `POST /webhook/melhor-envio`

- **Assinatura:** `X-ME-Signature` é HMAC-SHA256 do **corpo cru** com o secret do
  aplicativo. Comparação timing-safe. Inválida → `401`, sem tocar em nada.
  Mesmo padrão do webhook do Mercado Pago, que já resolve o corpo cru no Express.
- **Idempotente:** a Melhor Envio reenvia 5 vezes a cada 15 min, com timeout de
  6 s. Evento repetido não reprocessa nem redispara e-mail.
- **`order_id` desconhecido:** registra e ignora. Não é erro — pode ser etiqueta
  comprada à mão no painel deles.
- **Rate limit**, como o `freteLimiter` que já existe em `index.js:123`.

| Evento | Efeito |
|---|---|
| `order.posted` | `enviado` + e-mail com o rastreio |
| `order.delivered` | `entregue` |
| `order.cancelled` | marca cancelada, alerta o admin |
| `order.undelivered`, `order.paused`, `order.suspended` | **alerta o admin, não muda o status do cliente** |
| demais | registra e ignora |

As três de problema não mexem no que o cliente vê de propósito: significam
problema humano — endereço errado, destinatário ausente, pacote retido — e quem
resolve é uma pessoa, não uma transição de estado.

---

## Escrever o rastreio de volta no Bling

`PUT /pedidos/vendas/{id}` com `transporte.volumes[].codigoRastreamento`, logo
após a geração da etiqueta.

### Risco declarado, com plano B

**Não foi confirmado** que a v3 do Bling aceita esse campo nesse `PUT`. A
documentação deles é uma SPA que não se deixa ler por fetch. A **primeira tarefa
da Fase 4**, antes de escrever qualquer código dela, é um teste contra a API
real.

- **Plano B:** gravar o rastreio nas `observacoes` do pedido de venda e alertar.
- **Plano C:** esse campo continua manual no Bling; o resto da fase segue.

### Falhar no Bling não derruba a compra

O rastreio já está gravado na loja e o cliente já será avisado pelo webhook. Erro
no Bling vira alerta no painel — a mesma postura que `blingClient.js` toma quando
não consegue gravar o refresh token: o trabalho principal continua, o problema
fica visível.

---

## Painel

Espelhando `frontend/legacy/components/DashboardSection/Bling/`:

| Arquivo novo | Molde |
|---|---|
| `MelhorEnvioManager.jsx` | `BlingManager.jsx` |
| `useMelhorEnvioAcoes.js` | `useBlingAcoes.js` |
| `melhorEnvioContrato.js` | `blingContrato.js` |

Na tela do pedido (`Orders.jsx`), um botão **Comprar etiqueta** e, depois de
comprada, **Imprimir etiqueta**. Ambos travados durante a requisição, como os
três botões do Bling já fazem.

Tela de status da integração com o que o gestor precisa ver sem perguntar:
**token válido até quando**, **saldo da carteira**, **pedidos aprovados sem
etiqueta**.

---

## Segurança

- **O PDF da etiqueta tem nome, endereço e telefone do cliente.** É dado pessoal
  sob `docs/seguranca-dados-pessoais.md`. Só admin; o backend busca e repassa em
  streaming, sem gravar em disco; a URL nunca entra em log.
- Secret do aplicativo e tokens nunca em log, nem em mensagem de erro. O corpo do
  erro de OAuth não ecoa o token — a mesma verificação que `blingClient.js` já faz.
- A coluna do refresh token é protegida por privilégio de coluna, como a do Bling.
- Escopos mínimos (os dez acima).
- Rate limit no webhook e na cotação.

---

## Testes

`node --test test/*.test.js --test-concurrency=1`. **Serial é obrigatório** — em
paralelo a suíte deste projeto derruba dezenas de testes por contenção do
Postgres embarcado.

Arquivos novos, seguindo `f7_bling.test.js`:

- `f8_melhor_envio_token.test.js` — renovação, persistência, ordem
  memória→banco→env, falha de gravação não derruba a chamada.
- `f8_melhor_envio_etiqueta.test.js` — os quatro passos, retomada do meio,
  claim concorrente, saldo insuficiente, idempotência do clique duplo.
- `f8_melhor_envio_webhook.test.js` — assinatura válida e inválida, reentrega,
  `order_id` desconhecido, cada evento e seu efeito.
- Ampliação de `f4_status_e_frete.test.js` — a cotação lê peso do banco e ignora
  o que vier do corpo da requisição.

O molde de ambiente já existe: `MELHOR_ENVIO_URL` apontando para uma porta
fechada (`http://127.0.0.1:9`) prova o caminho de falha sem rede.

---

## Fases

| Fase | Entrega | Credencial |
|---|---|---|
| **1** | Cotação lê peso e dimensão do banco; defaults saem do código | **nenhuma** |
| **2** | `melhorEnvioClient` + migração + `docs/melhor-envio.md` | sandbox |
| **3** | Botão "Comprar etiqueta" + PDF + `me_servico_id` no checkout | sandbox |
| **4** | Webhook de rastreio + escrita no Bling (spike primeiro) | sandbox |
| **5** | Virada: produção, CEP real, webhook cadastrado, autorização única | **produção** |

A Fase 1 é independente e vale sozinha: para de perder venda hoje, sem depender
de nenhuma credencial nova.

---

## Fora do escopo, de propósito

- **`LOCAL_PREFIXES = ["350"]`** e a entrega local de R$ 5 continuam no código
  como estão. É outra decisão, com outro dono.
- **Logística reversa e trocas.**
- **Compra de etiqueta em lote.**
- **Substituir o job de rastreio do Bling.** Ele continua rodando: pedido sem
  etiqueta da Melhor Envio ainda pode receber rastreio digitado à mão lá.

---

## Riscos

1. **`PUT` do Bling não confirmado.** Mitigação: spike na Fase 4, planos B e C
   definidos acima.
2. **Saldo zerado trava o botão.** Mitigação: mensagem literal com o valor que
   faltou.
3. **Sandbox só simula Correios e Jadlog.** Transportadora exclusiva de produção
   não é testável antes da Fase 5.
4. **Renovação falhando por 45 dias mata a autorização** e só volta com
   reautorização manual. Mitigação: alarme visível na tela de status do painel —
   o modo de falha tem de ser descoberto pelo gestor, não pelo cliente sem frete.
5. **`ZIPCODE_ORIGIN` está `01001000`** (Praça da Sé, São Paulo) no `.env` local,
   e `MELHOR_ENVIO_TOKEN` é literalmente um placeholder. **O que está na VPS não
   foi verificado** — se lá houver token válido com esse CEP, todo frete cotado
   até hoje saiu de São Paulo, não da Canastra. Conferir é tarefa da Fase 1.
