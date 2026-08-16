# Colocar a loja em produção

Guia operacional do Café Canastra: o que subir, em que ordem, o que precisa
estar configurado e o que ainda está em aberto.

---

## 1. Peças

| Peça | O que é | Onde roda |
|---|---|---|
| **Vitrine + painel** | Next 15 (App Router). A loja em `app/(vitrine)`, o painel admin como ilha client-only em `app/dashboard`. | Vercel, ou qualquer Node |
| **API** | Express + PostgreSQL. Autenticação, catálogo, carrinho, pedidos, pagamento. | Render, Railway, Fly… |
| **Banco** | PostgreSQL 16. | Gerenciado (Neon, Supabase, RDS…) |

A vitrine e a API ficam em domínios diferentes. Isso é o que torna
`SameSite=None; Secure` obrigatório nos cookies e exige `CORS_ORIGIN` correto —
os dois pontos onde um deploy costuma quebrar em silêncio.

---

## 2. Ordem de subida

### 2.1 Banco

```bash
export DATABASE_URL="postgres://usuario:senha@host:5432/cafecanastra"
npm run db:schema     # cria as tabelas (idempotente)
npm run db:seed       # popula o catálogo real e cria a conta inicial
```

`db:schema` pode rodar de novo a cada deploy: tudo é `IF NOT EXISTS`.
`db:seed` também é idempotente — casa produtos por um UUID v5 derivado do SKU e
**nunca sobrescreve a senha de uma conta que já existe**.

### 2.2 API

Copie `backend/src/.env.example` para `backend/src/.env` e preencha. Em
produção o processo **recusa subir** se algum destes estiver ausente, fraco
(< 32 caracteres) ou igual ao valor de exemplo:

| Variável | Como gerar / onde achar |
|---|---|
| `DATABASE_URL` | string de conexão do banco |
| `JWT_SECRET` | `openssl rand -hex 32` |
| `JWT_SECRET_REFRESH` | `openssl rand -hex 32` — **diferente** do anterior |
| `CORS_ORIGIN` | domínio da vitrine; aceita lista por vírgula (apex e www) |
| `MP_ACCESS_TOKEN` | painel do Mercado Pago |
| `MP_WEBHOOK_SECRET` | Mercado Pago → Suas integrações → Webhooks → chave secreta |

Falhar no `npm start` é barulhento e barato. Descobrir depois que a loja está no
ar com `JWT_SECRET` publicado neste repositório, não.

Ainda em produção, configure também:

- `NODE_ENV=production` — sem isso os cookies saem sem `Secure`, o CORS libera
  localhost e a conferência de configuração vira aviso. A API recusa subir com
  qualquer valor fora de `development` / `test` / `production`, justamente
  porque escrever `prod` no painel do provedor desligaria as quatro defesas de
  uma vez, em silêncio.
- `WEBHOOK_URL` — URL pública `https://…/webhook/mercadopago`, registrada no
  painel do MP.
- `EMAIL_PASS2` + `EMAIL_DOMINIO` — chave do Resend e domínio **verificado na
  conta**. Sem verificação o Resend recusa todo envio: confirmação de cadastro,
  recuperação de senha e status de pedido param, e o erro só aparece no log.
- `MELHOR_ENVIO_TOKEN`, `MELHOR_ENVIO_URL`, `ZIPCODE_ORIGIN` — sem eles o
  checkout **recusa fechar pedido**, porque não consegue reconferir o frete.
- `CLOUDINARY_*` — sem isso o upload de imagem no painel falha (o resto funciona).

Healthcheck: `GET /health` responde `200` com o banco de pé, `503` sem.

### 2.3 Vitrine

Variáveis de build (resolvidas em tempo de build e embutidas no bundle):

```
NEXT_PUBLIC_API_URL=https://api.cafecanastra.com
NEXT_PUBLIC_SITE_URL=https://loja.cafecanastra.com
```

`NEXT_PUBLIC_API_URL` **precisa** estar definida. Se faltar, o bundle publicado
sai apontando para `http://localhost:3333` e nada funciona para ninguém — sem
erro no servidor e sem nada no log. A página detecta e denuncia isso no console
do navegador, mas o certo é não deixar acontecer.

```bash
npm run build
```

---

## 3. Verificação depois do deploy

```bash
npm test                 # 52 testes da vitrine
npm --prefix backend test  # 15 testes das regras de pagamento
npm run verifica         # 37 checagens num Chromium de verdade
```

`npm run verifica` exige a vitrine, a API e o banco no ar. Ele cobre o caminho
que mais quebra: guard do painel, login, as 8 rotas administrativas
autenticadas, o catálogo na vitrine, sacola e checkout.

Confira à mão, uma vez:

- [ ] `GET /health` responde `200`.
- [ ] Login em `/account/login` com uma conta real leva ao painel.
- [ ] `/dashboard/products/addedProducts` mostra os 29 SKUs com imagem e preço.
- [ ] Mudar um preço no painel muda a vitrine em até 1 minuto.
- [ ] Um pedido de teste chega em `/dashboard/orders`.
- [ ] O webhook do MP marca o pedido como pago (o painel do MP mostra a entrega).

---

## 4. Em aberto

Ordenado por urgência. Nada aqui impede a loja de vender, mas os dois primeiros
têm prazo.

### 4.1 Histórico do Git ainda tem dado pessoal

Os dumps CSV da loja anterior saíram do repositório, mas **continuam
recuperáveis em commits antigos**. Ver `docs/seguranca-dados-pessoais.md`: exige
`git filter-repo`, `push --force` e rotação dos segredos que vazaram. Não foi
feito automaticamente porque reescrever histórico quebra o clone de todo mundo —
é decisão de quem administra o repositório.

### 4.2 Backlog completo da auditoria

Uma auditoria por domínio (autenticação, pagamentos, dados, painel, frontend,
infraestrutura), com verificação adversarial de cada achado contra o código,
produziu 12 bloqueadores, 22 itens importantes e 22 melhorias. Os bloqueadores
foram corrigidos; o restante está listado abaixo, do mais para o menos urgente.

**Vale a pena atacar cedo:**

- Webhook do Mercado Pago sem transação nem idempotência: entregas repetidas da
  mesma notificação podem inflar o estoque. O MP reenvia por desenho.
- A cobrança acontece antes de o pedido existir no banco, e sem chave de
  idempotência — uma queda entre as duas coisas deixa pagamento sem pedido.
- Sem trilha de auditoria: não há registro de quem mudou preço, estoque ou
  status de pedido. Numa loja oficial com mais de um administrador, isso é o
  primeiro pedido de quem investiga uma divergência.
- Sem migrações versionadas: `schema.sql` só cria, nunca altera. A próxima
  mudança de coluna vai ser manual e sem histórico.
- Refresh token gravado em texto puro no banco (deveria ser hash).
- `PUT /promotions/:id` e `PUT /config` sobrescrevem com NULL os campos ausentes
  e respondem 200 sem checar `rowCount`.
- Conexão com o Postgres em produção não valida o certificado TLS
  (`rejectUnauthorized: false` em `pgPool.js`).
- Dependências com advisories: `csurf` (arquivado) e `axios`.
- Política de Privacidade e Termos de Uso ainda atribuem a loja à Shopnaw.

### 4.3 Pagamento com cartão

O checkout aceita **Pix**. Cartão exige tokenizar o número no navegador com o
SDK do Mercado Pago e uma chave pública (`NEXT_PUBLIC_MP_PUBLIC_KEY`). O backend
já aceita cartão pelo mesmo endpoint assim que `formData.token` chegar — falta
só a camada de tokenização na tela.

### 4.4 CSP com `unsafe-inline` e `unsafe-eval`

`next.config.mjs` aplica CSP, mas o `script-src` ainda permite os dois, porque o
painel legado usa styled-components (injeta `<style>` em runtime) e o runtime do
Next usa scripts inline. Fechar de vez exige nonce por requisição via
middleware. O CSP atual já barra script de origem externa, que é o vetor mais
comum — é melhor que não ter, e pior que o ideal.

### 4.5 Acervo fotográfico

`estetica.md` §8 pede três famílias de foto (sabor, território, produto) em 4:5.
Hoje existem quatro pack shots quadrados (500×500) e a "foto de sabor" é o
próprio pacote repetido, então o crossfade do card não aparece. É produção
fotográfica, não código — e o `§8` estima isso como ~60% da percepção de
qualidade do site.

### 4.6 Dados que faltam no catálogo

`data/catalogo-canastra.json` declara a procedência de cada SKU. Os marcados
como `pesquisa-web` ou `inferido` merecem conferência contra a loja real antes
de campanha:

- Preço do Canastra Canela avulso (só apareceu esgotado nas capturas).
- Preços das cápsulas e dos drip coffees — todos esgotados, a loja não exibia
  valor.
- Foto própria do Néctar de Minas (hoje reusa a arte do Clássico).

### 4.7 Outros

- `csurf` está descontinuado há anos. Funciona, mas não recebe correção; migrar
  para `csrf-csrf` ou double-submit próprio é dívida conhecida.
- O bundle do painel é servido a qualquer visitante (o guard é de cliente). A
  API está protegida rota a rota, então não há vazamento de dado — só de código.
- Sem `sitemap.ts`/`robots.ts`; `/account` e `/dashboard` são indexáveis.

---

## 5. Conta inicial

`db:seed` cria a conta de `SEED_ADMIN_EMAIL` com papel `admin`, já verificada
(o fluxo normal exige confirmar o e-mail por link, e sem provedor configurado a
conta ficaria travada no primeiro login).

**`SEED_ADMIN_EMAIL` e `SEED_ADMIN_PASSWORD` vêm vazios no `.env.example`, de
propósito.** Preencha com valores próprios (`openssl rand -base64 24` serve para
a senha). Em produção a API recusa subir se a senha tiver menos de 12 caracteres
ou se for um dos valores de exemplo — porque o cabeçalho do `.env.example` manda
copiá-lo, e um deploy feito "conforme a documentação" não pode nascer com
administrador de senha conhecida.

O painel não deixa excluir a própria conta nem o último administrador — a loja
não pode ficar sem quem a administre.
