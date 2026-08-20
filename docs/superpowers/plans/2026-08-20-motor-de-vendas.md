# Onda 2F — Motor de vendas: cupons, newsletter, carrinho abandonado

> Plano detalhado da onda F do plano mestre `2026-08-20-plano-mestre-pendencias.md`.
> Escrito ANTES da implementação, executado com TDD. O agente desta onda NÃO
> commita; o orquestrador commita ao fim.

**Goal:** a loja ganha três alavancas de venda que hoje não existem: cupom de
desconto (validado e cobrado só no servidor), captação de e-mail no rodapé e
lembrete de carrinho abandonado — tudo atrás das mesmas garantias de dinheiro
da F4 (reserva atômica, compensação explícita, nada de número vindo do
navegador decidindo cobrança).

**Território:** `backend/**` exceto `orders.routes.js`, `OrderController.js`,
`ordersRepository.js` (exceção cirúrgica autorizada: os DOIS campos novos no
`createOrder`), `dashboardRepository.js`; no frontend, SÓ
`frontend/components/layout/Rodape.tsx` + o novo `FormNewsletter.tsx`.

---

## Contratos (fixados pelo plano mestre — outros agentes constroem UI contra eles)

- `POST /cupons/validar` (público, rate limit 30/min): body
  `{ codigo, itens: [{ productId, quantity }] }` → 200
  `{ valido: true, codigo, tipo, valor, descontoCentavos, descricao }` ou 200
  `{ valido: false, motivo }` com motivo em: "Cupom não encontrado",
  "Cupom expirado", "Cupom esgotado", "Pedido mínimo de R$ X", "Cupom inativo".
- CRUD admin: `GET /cupons` → `{ data: [{ id, codigo, tipo, valor, descricao,
  minimo_centavos, limite_usos, usos, ativo, inicio_em, fim_em }] }`;
  `POST /cupons` (codigo A-Z0-9 3-30, salvo maiúsculo; percent ≤ 90 / fixed > 0);
  `PUT /cupons/:id` parcial. SEM DELETE — desativa com `ativo: false`.
- `POST /checkout/process_payment` aceita `cupom` (string, opcional) e REVALIDA
  no servidor. Desconto do navegador nunca é aceito.
- `POST /newsletter` (público, rate limit 10/min): `{ email }` → SEMPRE 200
  `{ ok: true }` quando o e-mail é válido (anti-enumeração); inválido → 400.

## Decisões desta onda (as que não estavam escritas no plano mestre)

1. **`avaliarCupom` é função pura em `backend/src/utils/cupom.js`**, não método
   de repositório: os ramos (inativo, expirado, esgotado, mínimo, percent,
   fixed) são regra de dinheiro e têm de ser testáveis sem banco. Percent
   arredonda (`Math.round`); fixed trava em `min(valor*100, subtotal)`. Cupom
   com `inicio_em` no futuro responde "Cupom inativo" (ainda não está ativo);
   `fim_em` no passado responde "Cupom expirado".
2. **`precoComPromocao` sai do `PaymentController` para
   `backend/src/utils/preco.js`** e o controller passa a importá-lo. Motivo: o
   `POST /cupons/validar` precisa do MESMO preço promocional para calcular o
   subtotal do servidor, e importar o `PaymentController` puxaria o SDK do
   Mercado Pago para um caminho que não cobra nada. Comportamento idêntico;
   testes existentes não referenciam o símbolo pelo controller.
3. **Frete grátis decide pelo subtotal COM desconto.**
   `calcularOpcoesDeFrete` ganha o parâmetro opcional `descontoCentavos`
   (default 0), subtraído do subtotal antes de comparar com o piso;
   `conferirFrete` repassa. A rota pública `/shipping/calculate` aceita `cupom`
   opcional e resolve o desconto no servidor — assim a cotação do navegador
   (agente D) e a reconferência do checkout usam a MESMA regra e não nasce 409
   falso. Na cotação pública o preço dos itens vem do navegador e vale como
   sugestão, como sempre valeu; quem decide dinheiro é o checkout.
4. **O incremento de uso é a trava**: `UPDATE canastra.cupons SET usos = usos+1
   WHERE id = $1 AND ativo AND (limite_usos IS NULL OR usos < limite_usos)
   RETURNING usos`, DENTRO da transação de reserva de estoque (antes do
   COMMIT, antes de cobrar). rowCount 0 → 400 "Cupom esgotado" e o ROLLBACK
   devolve a reserva. Toda compensação de estoque do CHECKOUT (falha de
   gateway, 23505 do INSERT, catch externo, pagamento nascido recusado)
   decrementa o uso junto (`GREATEST(usos-1, 0)` via `WHERE usos > 0`). O
   webhook NÃO mexe em uso de cupom: um pedido pago e depois reembolsado
   consumiu o cupom de verdade — assimetria deliberada, documentada no código.
5. **Fronteira do `createOrder`**: o INSERT do pedido vive em
   `ordersRepository.createOrder` (dono: agente E). Exceção autorizada e
   cirúrgica: adiciono `cupom_codigo` e `desconto` ao INSERT (e aos parâmetros)
   dessa ÚNICA função. Não toco `COLUNAS_DO_CONTRATO` nem nenhum SELECT — expor
   `coupon_code`/`discount` nas leituras é do dono do arquivo.
6. **Marcador de abandono é `carrinhos.atualizado_em`.** `carrinho_itens` NÃO
   tem timestamp nenhum (0004), então "o dos itens" não existe; quem mantém
   `carrinhos.atualizado_em` é a RPC `fundir_sacola` (0007) a cada login — a
   única escritora do carrinho servidor nesta fase. Fica documentado na
   migração 0011 e no job.
7. **Lembrete é um por carrinho, transacional**: `UPDATE ... SET
   lembrete_enviado_em = now() WHERE carrinho_id = $1 AND lembrete_enviado_em
   IS NULL` dentro de BEGIN; o envio acontece com a marca pendente; falhou o
   envio → ROLLBACK (a marca volta a NULL e a próxima hora tenta de novo).
   rowCount 0 → outra execução já pegou; segue sem enviar.
8. **`sendCartReminderEmail` entra em `emailSender.js`** (o arquivo é da onda
   1A, commitada; nenhum agente da onda 2 o toca — conferido no git log). O
   conteúdo é montado por função pura exportada (`conteudoDoLembreteDeCarrinho`)
   para o teste afirmar assunto e corpo sem Resend.
9. **Cron só liga com `ABANDONO_ATIVO=true`** (decisão 5 do plano mestre:
   integração nova desligada por padrão). `node-cron` de hora em hora
   (`0 * * * *`); `ABANDONO_HORAS` default 24; janela máxima de 7 dias (não
   lembrar sacola arqueológica). O cron em si não roda em teste — a seleção e o
   envio são funções injetáveis testadas no harness.

## Migrações (nunca editar as aplicadas; regenerar instalacao-completa.sql)

### 0010_cupons.sql
- `canastra.cupons`: id uuid PK default; `codigo` text UNIQUE NOT NULL com
  CHECK `~ '^[A-Z0-9]{3,30}$'` (o servidor salva maiúsculo; o CHECK impede o
  minúsculo entrar por qualquer caminho); `tipo` CHECK in (percent, fixed);
  `valor numeric(10,2)` CHECK (`> 0` e `percent → ≤ 90`); `descricao`;
  `minimo_centavos int NOT NULL DEFAULT 0` CHECK ≥ 0 (centavos e inteiro, como
  o frete grátis de 0009); `limite_usos int NULL` CHECK NULL ou > 0;
  `usos int NOT NULL DEFAULT 0` CHECK ≥ 0; `ativo bool DEFAULT true`;
  `inicio_em`/`fim_em timestamptz NULL`; `criado_em`/`atualizado_em`
  (mantida por quem escreve — regra de 0004/0005).
- `canastra.pedidos`: `cupom_codigo text NULL` (texto, não FK: o pedido guarda
  a fotografia do código usado; apagar o cupom não pode tocar a venda — mesma
  lição do carrinho sem FK em 0004) e `desconto numeric(10,2) NOT NULL DEFAULT 0`
  CHECK ≥ 0.
- RLS ligada SEM política + REVOKE de escrita/leitura para authenticated
  (Express fala como dono do banco; PostgREST não serve cupom a ninguém).

### 0011_newsletter_e_abandono.sql
- `canastra.newsletter_inscritos`: id uuid PK default; `email` text UNIQUE NOT
  NULL com CHECK de formato básico (`^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$`);
  `origem text NOT NULL DEFAULT 'rodape'`; `criado_em`.
- `canastra.carrinhos`: `lembrete_enviado_em timestamptz NULL`.
- RLS ligada sem política + REVOKE (e-mail é dado pessoal; regra de 0001).

## Arquivos

| Arquivo | Ação |
|---|---|
| `backend/db/migrations/0010_cupons.sql` | novo |
| `backend/db/migrations/0011_newsletter_e_abandono.sql` | novo |
| `backend/db/instalacao-completa.sql` | regenerado (`npm run db:gerar-sql`) |
| `backend/src/utils/preco.js` | novo — `precoComPromocao` extraído |
| `backend/src/utils/cupom.js` | novo — `avaliarCupom` + formatação de motivo |
| `backend/src/repositories/cuponsRepository.js` | novo |
| `backend/src/controllers/CuponsController.js` | novo |
| `backend/src/routes/cupons.routes.js` | novo (rate limit 30/min no /validar) |
| `backend/src/routes/newsletter.routes.js` | novo (rate limit 10/min) |
| `backend/src/jobs/carrinhoAbandonado.js` | novo |
| `backend/src/utils/emailSender.js` | + `sendCartReminderEmail` e builder puro |
| `backend/src/controllers/PaymentController.js` | cupom no checkout (dono nesta onda) |
| `backend/src/controllers/ShippingController.js` | `descontoCentavos` no piso |
| `backend/src/repositories/ordersRepository.js` | SÓ `createOrder`: 2 campos |
| `backend/src/index.js` | registra rotas + cron condicionado |
| `backend/src/.env.example` | `ABANDONO_ATIVO`, `ABANDONO_HORAS` |
| `frontend/components/layout/FormNewsletter.tsx` | novo client component |
| `frontend/components/layout/Rodape.tsx` | monta o formulário (§5.10 já previa) |
| `backend/test/f6_cupons.test.js` | novo |
| `backend/test/f6_newsletter_abandono.test.js` | novo |

## Fluxo do cupom no `process_payment`

1. `cupom` do corpo é normalizado (trim, maiúsculo). Vazio/ausente → fluxo de
   sempre.
2. Depois da PRIMEIRA leitura (sem trava): subtotal em centavos dos preços do
   BANCO já com promoção; `buscarPorCodigo` + `avaliarCupom` → inválido → 400
   com o motivo (antes de reservar, antes de cobrar).
3. `conferirFrete` recebe `descontoCentavos` — o frete grátis é decidido pelo
   subtotal descontado, igualzinho à cotação.
4. Dentro da transação de reserva: subtotal recomputado dos preços travados
   (FOR UPDATE), `avaliarCupom` de novo (mesma função — é a revalidação), e o
   incremento atômico de `usos`. rowCount 0 → 400 "Cupom esgotado", ROLLBACK.
5. `finalAmountToCharge = (subtotalCentavos - descontoCentavos)/100 + frete`,
   piso `> 0` de sempre.
6. `createOrder` recebe `cupomCodigo` e `desconto` (reais, 2 casas).
7. Compensações (gateway caiu, 23505, catch externo, nascido recusado):
   devolver estoque E devolver o uso do cupom.

## Testes (TDD — escrever antes, ver vermelho, implementar)

`backend/test/f6_cupons.test.js` (harness Postgres real + dublê do MP/Resend,
padrão de f4_checkout_e_webhook.test.js):
- `avaliarCupom`: todos os ramos e as duas aritméticas (round do percent, teto
  do fixed no subtotal), motivos com o texto EXATO do contrato.
- CHECKs de 0010 recusam código minúsculo, tipo alienígena, percent > 90
  (SQLSTATE 23514, citando a constraint).
- `POST /cupons/validar`: subtotal do SERVIDOR (preço do corpo é ignorado),
  promoção aplicada antes do cupom, contrato de resposta.
- CRUD admin: criar/listar/atualizar, validações, código duplicado.
- `process_payment` com cupom: valor cobrado com desconto; `usos`
  incrementado; pedido gravado com `cupom_codigo`/`desconto`; esgotado → 400
  SEM cobrança e SEM baixa de estoque; gateway caiu → estoque E uso devolvidos;
  frete grátis decidido pelo subtotal DESCONTADO (0 vira 409; frete real passa).

`backend/test/f6_newsletter_abandono.test.js`:
- newsletter: e-mail válido → `{ok:true}` + linha; repetido → `{ok:true}` sem
  segunda linha; inválido → 400; CHECK do banco recusa formato torto.
- abandono: seleção pega SÓ o carrinho velho-com-itens-com-dono-com-email
  (nem fresco, nem vazio, nem >7 dias, nem já lembrado); envio marca
  `lembrete_enviado_em`; segunda rodada não reenvia (idempotência); falha de
  envio → marca desfeita (ROLLBACK) e a próxima rodada tenta de novo.
- builder do e-mail: assunto "Seu café ainda está na sacola", itens resumidos,
  link para /sacola, rodapé com o porquê e o link da conta.

Rodar: `npm --prefix backend test` (232 existentes + novos) e
`npm --prefix frontend run test` (223) — verdes antes de declarar pronto.
