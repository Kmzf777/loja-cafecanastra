# Melhor Envio — runbook da integração (cotação, etiqueta e rastreio)

Companheiro de `docs/bling.md`. Os dois falam de logística e é fácil confundir
quem faz o quê:

| | Melhor Envio | Bling |
|---|---|---|
| Cota o frete | **sim** | não |
| Compra e imprime a etiqueta | **sim** | não |
| Emite a NF-e | não | **sim** |
| Guarda o rastreio | gera | **recebe e guarda** |

O rastreio nasce na Melhor Envio, no momento em que a etiqueta é gerada, e é
escrito de volta no Bling. Quem manda e-mail para o cliente com o código
continua sendo o job do Bling.

**O que a integração NÃO faz, de propósito:** logística reversa, cotação de
frete internacional, e emissão de nota. Nada disso está no escopo.

---

## 1. Pré-requisitos da conta

Antes de qualquer credencial, a conta da Melhor Envio precisa de três coisas.
Faltando qualquer uma, a integração autentica e mesmo assim não funciona — e o
erro que aparece não aponta para cá.

1. **Cadastro completo**, com CNPJ. Conta incompleta autentica mas não deixa
   comprar etiqueta.
2. **Endereço de origem cadastrado**, e ele precisa ser o **mesmo CEP** de
   `ZIPCODE_ORIGIN`. Cotar de um CEP e postar de outro devolve preço e prazo
   errados **sem erro nenhum aparecer** — é o modo de falha mais caro desta
   integração, porque a loja cobra um valor e paga outro, em toda venda, até
   alguém conferir a fatura.
   O CEP da loja é **38402330** (Rua Nivaldo Guerreiro Nunes 701, Distrito
   Industrial, Uberlândia/MG), conferido contra o registro do CNPJ em
   25/08/2026.
3. **Saldo na carteira.** A compra de etiqueta debita saldo. Sem saldo, o passo
   de checkout falha com mensagem própria — ver a tabela de erros no fim.

---

## 2. Sandbox e produção são contas SEPARADAS

Não é o mesmo cadastro com uma variável trocada. São dois cadastros, dois
aplicativos, dois `client_id` e dois `client_secret`.

| | Sandbox | Produção |
|---|---|---|
| Cadastro | `https://sandbox.melhorenvio.com.br/` | conta real da loja |
| Área dev | `https://app-sandbox.melhorenvio.com.br/integracoes/area-dev` | `https://app.melhorenvio.com.br/integracoes/area-dev` |
| `MELHOR_ENVIO_URL` | `https://sandbox.melhorenvio.com.br` | `https://melhorenvio.com.br` |
| `redirect_uri` | `https://loja.canastrainteligencia.com/api/melhor-envio/callback-sandbox` | `https://loja.canastrainteligencia.com/api/melhor-envio/callback` |
| Webhook | `https://loja.canastrainteligencia.com/api/webhook/melhor-envio` | idem |

No sandbox os pagamentos não são faturados, a aprovação é automática em até 5
minutos, e a etiqueta muda de status sozinha a cada 15 minutos até "entregue" —
é assim que se testa o webhook sem despachar nada.

---

## 3. Os dez escopos, e só eles

```
shipping-calculate  cart-read        cart-write       shipping-checkout
shipping-generate   shipping-print   shipping-tracking shipping-cancel
orders-read         users-read
```

Nada de `products-write` nem `users-write`: a integração não escreve produto nem
usuário na Melhor Envio, e escopo pedido a mais é dano a mais quando o token
vazar.

---

## 4. A autorização, uma vez

### Por que não dá para pular esta etapa

**Medido em 25/08/2026, contra o sandbox.** A tentação é usar só o
`client_id`/`client_secret`, que é o que se faz em quase toda API. Aqui não
funciona, e falha de um jeito que engana:

```
POST /oauth/token  {"grant_type":"client_credentials", ...}
  → HTTP 200, com access_token de 30 dias
```

Parece que funcionou. Mas o JWT vem com **`"sub": ""`** — sem usuário — e:

```
POST /api/v2/me/shipment/calculate  (com esse token)
  → HTTP 401 {"message":"Unauthenticated."}
```

Inclusive pedindo `scope=shipping-calculate` explicitamente na emissão: o escopo
é concedido, aparece no token, e o 401 continua. O prefixo `/me/` significa "o
usuário autenticado", e token de aplicação não tem usuário.

> Curiosidade que confunde no diagnóstico: `/api/v2/me/shipment/services`
> responde **200** com token de aplicação. É rota de catálogo. Não conclua daí
> que a credencial está boa.

### 4.1 Criar o aplicativo

Área dev (URL na tabela acima) → novo aplicativo. Marque os dez escopos, e
cadastre o `redirect_uri` **exatamente** como está na tabela.

### 4.2 Abrir a URL de autorização no navegador

Logado na conta da loja (sandbox ou produção, conforme o caso):

```
https://sandbox.melhorenvio.com.br/oauth/authorize
  ?client_id=SEU_CLIENT_ID
  &redirect_uri=https%3A%2F%2Floja.canastrainteligencia.com%2Fapi%2Fmelhor-envio%2Fcallback-sandbox
  &response_type=code
  &state=canastra
  &scope=shipping-calculate%20cart-read%20cart-write%20shipping-checkout%20shipping-generate%20shipping-print%20shipping-tracking%20shipping-cancel%20orders-read%20users-read
```

(tudo em uma linha só; em produção, troque o host e o `callback-sandbox` por
`callback`)

Autorize. O navegador vai cair num **404 do backend — e isso é o esperado**: a
rota de callback não existe, por decisão registrada na spec. O Traefik tira o
`/api`, o Express recebe `/melhor-envio/callback-sandbox` e não conhece o
caminho.

**O que importa está na barra de endereços:** `?code=XXXX&state=canastra`.

### 4.3 Trocar o code por token, IMEDIATAMENTE

O `code` expira em segundos. Tenha este comando pronto antes de autorizar:

```bash
curl -X POST https://sandbox.melhorenvio.com.br/oauth/token \
  -H 'Accept: application/json' -H 'Content-Type: application/json' \
  -d '{"grant_type":"authorization_code",
       "client_id":"SEU_CLIENT_ID",
       "client_secret":"SEU_CLIENT_SECRET",
       "redirect_uri":"https://loja.canastrainteligencia.com/api/melhor-envio/callback-sandbox",
       "code":"XXXX"}'
```

O `redirect_uri` aqui tem de ser **byte a byte** o mesmo do passo anterior e o
mesmo cadastrado no aplicativo.

Guarde o `refresh_token`. É ele que vai para `MELHOR_ENVIO_REFRESH_TOKEN`.

### 4.4 Conferir antes de sair

```bash
curl -X POST https://sandbox.melhorenvio.com.br/api/v2/me/shipment/calculate \
  -H 'Accept: application/json' -H 'Content-Type: application/json' \
  -H 'Authorization: Bearer SEU_ACCESS_TOKEN' \
  -H 'User-Agent: Cafe Canastra/1.0 (contato@cafecanastra.com)' \
  -d '{"from":{"postal_code":"38402330"},"to":{"postal_code":"01001000"},
       "products":[{"id":"1","width":20,"height":5,"length":20,"weight":0.3,
       "insurance_value":50,"quantity":1}],"options":{"receipt":false,"own_hand":false}}'
```

Tem que voltar uma lista de transportadoras. Voltou `Unauthenticated`? O token
ainda é o de aplicação — volte ao 4.2.

---

## 5. Por que o token não mora no `.env`

O `access_token` vale **30 dias**; o `refresh_token`, **45**.

Um token de 30 dias colado no `.env` significa que a loja para de cotar frete um
mês depois de configurada, **sem aviso**. Frete que não cota é checkout que não
fecha: perda de venda silenciosa, descoberta por reclamação de cliente. Por isso
o `MELHOR_ENVIO_TOKEN` saiu, a renovação é automática, e o token vigente mora em
`canastra.config_loja` (migração 0017).

`MELHOR_ENVIO_REFRESH_TOKEN` é **só a semente** da primeira autorização. Depois
da primeira renovação, quem manda é o banco.

### Os dois relógios

A tabela guarda duas datas, e confundi-las é o erro que este parágrafo existe
para evitar:

| Coluna | De quem é | Preocupa? |
|---|---|---|
| `melhor_envio_token_expira_em` | do **access** token, 30 dias | não — o serviço renova sozinho |
| `melhor_envio_renovado_em` | carimbo da última renovação | **sim** — dele se deriva a morte do refresh |

O que mata a integração é o **refresh** token, e a API não diz nada sobre ele.
Uma tela que avisasse "vence em X" lendo `token_expira_em` mostraria uma data
tranquilizadora e falsa enquanto a autorização sangra. Os 45 dias são constante
documentada do lado deles, então a coluna guarda **quando renovou** — fato que
continua verdadeiro para sempre — e quem exibe deriva "morre por volta de X" na
hora.

### Quando a autorização morre

Sintoma: `invalid_grant` no log, e a cotação para. Não há conserto automático.

1. Refaça a autorização (seção 4)
2. Cole o `refresh_token` novo em `MELHOR_ENVIO_REFRESH_TOKEN`
3. Reinicie o backend

> Loja que passe 45 dias sem despachar nada acorda sem frete. Se a operação for
> sazonal, force uma renovação antes de cada temporada.

---

## 6. INSTÂNCIA ÚNICA — não é sugestão

Mesma regra do Bling, mesmo motivo: o refresh token é **rotativo**. Cada
renovação invalida o anterior. Com duas instâncias, as duas renovam, cada uma
invalida a da outra, e a integração entra em `invalid_grant` permanente — que
só sai com reautorização manual.

`deploy/ecosystem.config.cjs` fixa `instances: 1`. No Swarm, o serviço `api`
não pode passar de `replicas: 1`.

---

## 7. Subir as credenciais para a VPS

Nunca por git — `backend/src/.env` está no `.gitignore` e o `deploy.sh` roda
`git clean -fd` **sem `-x`** justamente para preservá-lo.

```bash
ssh SEU_USUARIO@loja.canastrainteligencia.com
cd /srv/loja-cafecanastra
nano backend/src/.env       # preencha o bloco da Melhor Envio
chmod 600 backend/src/.env
docker stack deploy -c deploy/stack.swarm.yml loja
```

**`docker service update --force` não basta.** O `env_file` do Swarm é resolvido
**no cliente**, na hora do `stack deploy`. Mudou o `.env` → `stack deploy` de
novo, senão o container continua com os valores antigos.

---

## 8. O webhook

Cadastro **só pelo painel**: Integrações → Área Dev. → o aplicativo → "Novo
Webhook".

| | |
|---|---|
| Método | `POST` |
| `User-Agent` | `Melhor Envio Webhooks/1.0` |
| Assinatura | `X-ME-Signature` — HMAC-SHA256 do **corpo cru**, chaveado com o **`client_secret` do aplicativo** |
| Timeout | **6 segundos** |
| Retentativa | 5 tentativas, a cada 15 min |

Eventos: `order.created`, `order.pending`, `order.released`, `order.generated`,
`order.received`, `order.posted`, `order.delivered`, `order.cancelled`,
`order.undelivered`, `order.paused`, `order.suspended`.

Corpo:

```json
{"event":"order.posted",
 "data":{"id":"UUID","protocol":"ORD-2024XXXXXXXXXX","status":"posted",
         "tracking":null,"tags":[]}}
```

O timeout de 6 s manda no desenho: o handler responde primeiro e processa
depois. Um handler que fale com o Bling antes de responder vai estourar o prazo
e receber a mesma notificação cinco vezes.

> **A rota `POST /webhook/melhor-envio` ainda NÃO existe.** Ela é da Fase 4.
> Cadastrar o webhook antes disso é inofensivo e não gera evento nenhum — a
> loja ainda não compra etiqueta, então nenhum `order.*` nasce dela.

---

## 9. Problemas comuns

| Sintoma | Causa provável |
|---|---|
| `401 Unauthenticated` em `/me/*`, com token recém-emitido | token de `client_credentials`. Só `authorization_code` serve — seção 4 |
| `invalid_client` ao trocar o code | **`redirect_uri` diferente do cadastrado.** Medido: dá o MESMO erro de `client_secret` errado. Confira o redirect ANTES de suspeitar do segredo |
| `invalid_grant` na renovação | refresh token já usado (rotativo), vencido, ou duas instâncias rodando — seção 6 |
| Cotação some, sem erro na loja | `ZIPCODE_ORIGIN` vazio, ou diferente do endereço cadastrado na conta |
| Preço e prazo plausíveis, mas errados na fatura | CEP de origem ≠ endereço de postagem cadastrado — seção 1, item 2 |
| `403` ou recusa sem mensagem clara | falta o header `User-Agent`. É **obrigatório** e precisa levar nome da aplicação e e-mail de contato |
| Compra de etiqueta falha no checkout | saldo insuficiente na carteira |
| Webhook chega cinco vezes | o handler passou de 6 s. Responda antes de processar |
