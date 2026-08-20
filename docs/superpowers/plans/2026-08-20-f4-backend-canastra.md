# F4 — backend fala com `canastra.*` (Onda 1A do plano mestre)

> Plano do agente da Onda 1A. O plano mestre
> (`2026-08-20-plano-mestre-pendencias.md`) fixa as decisões: status em
> português com CHECK na 0009, contrato JSON HTTP estável (só o vocabulário de
> status muda), frete grátis como regra de servidor
> (`config_loja.frete_gratis_minimo_centavos`, default 14900), migração 0009 é
> desta onda. Este arquivo detalha o COMO.

**Goal:** todas as rotas do Express voltam a funcionar contra o schema real
(`canastra.*`), com checkout idempotente, webhook transacional e sem nenhum
catch que engula erro e devolva lista vazia.

**Constatação da auditoria (conferida nos arquivos):** os 8 repositories
consultam `products`, `orders`, `users`, `addresses`, `carts`, `cart_items`,
`promotions`, `product_options`, `store_config` — nenhuma dessas relações
existe. As migrações 0001–0008 criam `canastra.produtos`, `canastra.pedidos`,
`canastra.clientes`, `canastra.enderecos`, `canastra.carrinhos`,
`canastra.carrinho_itens`, `canastra.promocoes`, `canastra.produto_opcoes`,
`canastra.config_loja` (colunas em português). Toda rota de dados hoje responde
500/lista vazia.

## Mapa de colunas (banco → contrato HTTP)

| contrato (fica) | `canastra.produtos` |
|---|---|
| `product_id` | `produto_id` |
| `name` | `nome` |
| `size` | `tamanho` |
| `category` | `categoria` |
| `price` | `preco` |
| `image` | `imagem` |
| `timestamp` | `destacado_em` (é o eixo "novidades" do painel) |
| `quantity` | `quantidade` |
| `description` | `descricao` |
| `weight/width/height/length` | `peso/largura/altura/comprimento` |
| `sku` | `sku` |

Pedidos: `order_id←pedido_id`, `total_amount←total`, `payment_method←metodo_pagamento`,
`payment_id_mp←pagamento_id_mp`, `items←itens`, `address←endereco_json`,
`shipping_cost←frete`, `shipping_method←metodo_envio`,
`tracking_code←codigo_rastreio`, `created_at←criado_em`, `updated_at←atualizado_em`.

Endereços: `address_id←endereco_id`, `zip_code←cep`, `street←rua`,
`number←numero`, `complement←complemento`, `neighborhood←bairro`,
`city←cidade`, `state←estado`.

Promoções: `title←titulo`, `description←descricao`, `type←tipo`,
`value←valor`, `applies_to←aplica_a`, `category←categoria`,
`product_id←produto_id`, `start_date←inicio_em`, `end_date←fim_em`,
`active←ativa`, `created_at←criada_em`.

Opções: `type←tipo` com TRADUÇÃO DE VALOR (`category↔categoria`,
`size↔tamanho` — o seed grava os tipos em português, o painel fala inglês),
`value←valor`.

Config: `site_title←titulo_site`, `whatsapp_number←whatsapp`,
`announcement_bar←barra_de_aviso`, `banner_desktop/banner_mobile` iguais,
mais `frete_gratis_minimo_centavos` (novo, nome em português no contrato,
como o plano mestre pede).

Clientes (rota nova do painel): `user_id`, `id` (=user_id, o JSX usa os dois),
`name←nome`, `email` (de `auth.users`), `phone←telefone`,
`purchases` (count de `canastra.pedidos`).

## Vocabulário de status (decisão 1 do plano mestre)

`pendente, aprovado, em_processamento, autorizado, enviado, entregue,
cancelado, rejeitado, reembolsado`. Tradução MP→pt:
`pending→pendente, approved→aprovado, in_process→em_processamento,
authorized→autorizado, cancelled→cancelado, rejected→rejeitado,
refunded→reembolsado`. Decisões minhas, registradas: `in_mediation` (disputa
aberta) traduz para `em_processamento` e `charged_back` para `reembolsado` —
os dois existem na API do MP e não estão na lista fixada; deixá-los sem mapa
faria o webhook devolver 500 para sempre (o CHECK recusaria) e o MP reenviaria
eternamente. Status do MP DESCONHECIDO: warn no log + 200 sem efeito (não é
erro de banco; 500 aqui seria retry infinito de uma notificação que nunca
vamos representar).

Grupos para movimentação de estoque: cancelado = {cancelado, rejeitado,
reembolsado}; ativo = os outros seis.

## Tarefas (ordem de execução)

1. **`src/utils/statusDePedido.js`** — módulo puro com STATUS_VALIDOS,
   GRUPO_CANCELADO, GRUPO_ATIVO, `traduzirStatusMp()`. Sem DB. Teste unitário
   junto com os de migração.
2. **Migração `db/migrations/0009_status_e_frete_gratis.sql`** —
   UPDATE defensivo traduzindo qualquer status inglês que exista (não deve
   existir: o código antigo escrevia em `orders`, que nunca existiu), depois
   `ALTER TABLE canastra.pedidos ADD CONSTRAINT pedidos_status_valido CHECK
   (status IN (...9...))`; `ALTER TABLE canastra.config_loja ADD COLUMN
   frete_gratis_minimo_centavos integer NOT NULL DEFAULT 14900` com CHECK de
   não-negatividade. Comentários no estilo do repo, SEM caractere fora do
   WIN1252 (o teste de instalação recusa). Regerar
   `instalacao-completa.sql`/`reset.sql` com `npm run db:gerar-sql`.
3. **Teste `test/f4_status_e_frete.test.js`** — 0009 aplicada: status inválido
   → 23514 citando `pedidos_status_valido`; os 9 aceitos; `pending` (inglês)
   recusado; default de `frete_gratis_minimo_centavos` = 14900; anon continua
   lendo `config_loja` (grant de tabela cobre coluna nova). Mais os casos do
   módulo de status.
4. **`ordersRepository.js`** reescrito: `createOrder` grava
   `canastra.pedidos` com `chave_idempotencia` e RETURNING com os aliases do
   contrato; `getOrderByIdempotencyKey`; `updateOrderStatus(id, status,
   trackingCode, client?)` aceita cliente de transação e escreve
   `atualizado_em = now()` (regra de 0005); `getOrdersByUser`, `getAllOrders`
   (LEFT JOIN clientes + auth.users), `getOrderById`, `getOrderByPaymentId`.
   NENHUM catch devolvendo []/null — erro sobe.
5. **`addressRepository.js`** — upsert em `canastra.enderecos`
   (`atualizado_em = now()` no UPDATE), leitura com aliases; erro sobe.
6. **`configRepository.js`** — `getConfig` com aliases +
   `frete_gratis_minimo_centavos`; `updateConfig` garante a linha 1
   (INSERT ... ON CONFLICT DO NOTHING) e atualiza; aceita
   `frete_gratis_minimo_centavos` opcional no corpo (inteiro ≥ 0) para a
   Onda 2E religar depois.
7. **`optionsRepository.js`** — tradução type↔tipo nos dois sentidos; 23505 no
   UNIQUE (tipo,valor) vira 409; conflito de exclusão confere
   `produtos.categoria/tamanho`.
8. **`promotionsRepository.js`** — CRUD com aliases; datas vazias ("" do
   datetime-local) viram NULL (o código antigo estourava 22007);
   `findActivePromotionsForCheckout` devolve já no formato que o checkout
   consome (`type/value/applies_to/category/product_id`).
9. **`dashboardRepository.js`** — CRUD de produto contra `canastra.produtos`
   (aceita `sku` opcional no corpo; 23505 no sku vira 409), busca full-text no
   `tsv` (`portuguese`) + ILIKE em `nome`, paginação e filtros
   (`category→categoria`, `size→tamanho`, onlyOld/onlyNew→`destacado_em`);
   summary com counts de produtos/pedidos/clientes e gráficos com os status em
   português.
10. **`ShippingController.js`** — `calcularOpcoesDeFrete` passa a aplicar o
    frete grátis do servidor: lê `frete_gratis_minimo_centavos`, calcula o
    subtotal dos itens em CENTAVOS (`Math.round(price*100)*quantity`), e se
    atinge o mínimo zera as opções (`price: 0, gratis: true`). Falha na
    leitura da config = sem frete grátis + erro no log (a cotação pública não
    pode cair junto com o banco; no checkout o banco acabou de responder).
    `conferirFrete` não muda: recotando pelo mesmo caminho, a opção zerada
    casa com o `shippingCost: 0` do navegador.
11. **`PaymentController.createPayment`** — mesmas defesas, tabelas novas:
    CPF de `canastra.clientes.cpf`; se vier
    `formData.payer.identification.number` (tipo CPF, 11 dígitos), persiste em
    `clientes.cpf` ANTES (23505 → 400 CPF em uso por outra conta); sem CPF de
    nenhuma fonte → 400 CPF_MISSING. Idempotência: lê
    `Idempotency-Key`/`X-Idempotency-Key`; se veio e já existe pedido com a
    chave, responde o pedido existente SEM recobrar; sem header, gera uuid.
    FOR UPDATE + reserva em `canastra.produtos`, promoções ativas, frete
    conferido, MP igual (token/installments/issuer_id preservados), pedido com
    status inicial 'pendente' e depois o status do MP traduzido; esvazia
    `canastra.carrinho_itens` do usuário; devolução de estoque em falha do
    gateway.
12. **`PaymentController.receiveWebhook`** — HMAC intacta, status relido do
    MP; depois: BEGIN → `SELECT ... FOR UPDATE` por `pagamento_id_mp` →
    não achou = ROLLBACK + 404 logado → status igual = 200 sem efeito →
    transição ativo↔cancelado movimenta estoque UMA vez dentro da MESMA
    transação → UPDATE status + `atualizado_em` → COMMIT → e-mail depois do
    commit. QUALQUER erro de banco = 500 (o MP reenvia).
13. **`OrderController.js`** — STATUS_VALIDOS em português (importa o módulo);
    transação de verdade (o código antigo atualizava o status FORA da
    transação de estoque: `updateOrderStatus` abria outro cliente);
    `getAllOrders`/`getUserOrders` com aliases e paginação preservada.
14. **`utils/emailSender.js`** — destinatário via `auth.users.email` +
    `canastra.clientes.nome` (pool.query direto: o código antigo VAZAVA o
    cliente do pool quando a query lançava); assuntos pelos status em
    português; blocos de nodemailer comentados removidos (aqui e em
    `config/mailer.js`); `REMETENTE.seguranca` removido de
    `config/remetente.js`.
15. **`conta.routes.js`** — `GET /auth/users?page&limit` (isAuthenticated +
    isAdmin): lista `canastra.clientes` JOIN `auth.users` + count de pedidos,
    formato `{users, total, totalPages, page}`; `DELETE /auth/users/:id`
    (isAdmin): recusa alvo que NÃO é cliente desta loja (instância
    compartilhada — 404), trava do último admin (409), 503 sem service key,
    Admin API do GoTrue com os mesmos cabeçalhos de `/users/me`. `/users/me`
    registrado ANTES de `/users/:id`. Funções exportadas com injeção
    (`conexao`, `buscar`, `ambiente`) para teste.
16. **Limpezas** — `app.use("/uploads"...)` fora do `index.js`; pasta
    Cloudinary `shopnaw_products` → `canastra_produtos`; `.env.example`
    documenta `PG_POOL_MAX` e perde `EMAIL_SEGURANCA` (ficou sem uso);
    `node-cron`/`nodemailer` FICAM no package.json (2F usa node-cron).
17. **Front (única exceção permitida)** — `frontend/app/(vitrine)/account/page.tsx`:
    STATUS ganha as 9 chaves em português (mantém as inglesas por tolerância;
    custo zero).
18. **Testes novos com o harness real** (`test/ajuda/postgres.js`, require dos
    módulos de `src/` DENTRO do before, depois de `DATABASE_URL` apontar para
    o cluster — padrão de `autenticacao.test.js`):
    - `f4_status_e_frete.test.js` (tarefa 3) + frete grátis:
      `calcularOpcoesDeFrete` com CEP local zera opção quando o subtotal
      atinge o mínimo e mantém preço abaixo dele; `conferirFrete` aceita o
      zero recotado.
    - `f4_repositorios.test.js`: createOrder grava em `canastra.pedidos`;
      mesma `chave_idempotencia` → 23505; catch mentiroso morto
      (`getOrderById("não-uuid")` REJEITA com 22P02 em vez de devolver null);
      endereço upsert com contrato; promoções/opções/config com aliases;
      listagem de produtos do painel (busca `q` + paginação); listagem de
      clientes do admin (formato do RegisteredClients).
    - `f4_webhook.test.js` (mock de `../config/mercadopago` e
      `../utils/emailSender` via hook de require, mesmo padrão de
      `pagamento.test.js`): aprovado 2x = uma mudança; ativa→cancelada devolve
      estoque UMA vez (2ª notificação idêntica não devolve de novo);
      cancelada→ativa retira; pedido inexistente → 404; erro de banco (tabela
      renomeada temporariamente) → 500.
19. **Rodar `npm --prefix backend test` até verde**; regerar SQL de instalação
    se o teste acusar.

## Ajustes da revisão de qualidade (aprovada com ressalvas)

1. A conferência de frete saiu da transação: uma PRIMEIRA PASSADA sem trava lê
   peso/dimensões/preço e cota o frete ANTES do BEGIN; a transação depois relê
   com FOR UPDATE só para validar e reservar. Nenhuma chamada de rede segura
   trava de linha (nem Melhor Envio, nem MP).
2. O `client` do pool só é adquirido na hora do BEGIN e é devolvido logo após
   o COMMIT — as etapas preliminares e o pós-cobrança falam com o banco pelo
   pool (antes cada checkout segurava 2 conexões).
3. Replay de `Idempotency-Key` (e o replay do 23505 de corrida) responde COM
   `ticketUrl`, relido do MP via `payment.get` — sem coluna nova; falha na
   releitura responde sem ticketUrl com warn no log.
4. `createOrder` falhando com erro ≠ 23505 após a cobrança grita "COBRANÇA
   ÓRFÃ" em linha própria com mpId + chave + userId + instrução de estorno.
5. Toda sequência de travas/UPDATEs de estoque itera em ordem canônica de
   `product_id` (`utils/estoque.js`) — checkout, webhook e painel — para
   eliminar deadlock 40P01 entre pedidos com itens em ordens opostas.
6. O avanço de status pós-checkout virou `avancarStatusInicial` com
   `WHERE status = 'pendente'`: se o webhook chegou antes, o checkout não
   atropela o status nem devolve estoque de novo (e não manda e-mail em dobro).
7. Erros de estoque carregam `erro.status = 400` no throw; morreu o
   `message.includes("Estoque insuficiente")` (o TEXTO continua no corpo por
   contrato com o checkout legado).
8. Preço com promoção arredonda a centavo (`Math.round(x*100)/100`) antes de
   ir para o JSON do pedido e para a soma cobrada.
9. Busca do painel ordena por `rank DESC, destacado_em DESC` quando há `q`.
10. `updateConfig` é parcial de verdade: só atualiza as colunas presentes no
    corpo (um PUT só com o piso do frete não nula título/whatsapp/aviso).
11. `allowed_formats` da Cloudinary ganhou `avif`, alinhado ao fileFilter.
12. Dublê `mp.respostaDoCreate` sem uso removido; docstring do
    `gerar-instalacao.js` não fala mais em "oito" migrações.

## O que fica para outras ondas (não é meu)

Painel mostrando os status em português (2E), select do painel enviando
português (2E — até lá `PUT /admin/orders/:id/status` com `pending` responde
400, comportamento correto), coleta de CPF no front (2D), barra de frete
grátis no front (2D), cupons/newsletter/abandono (2F), campo SKU no formulário
(2E), CSV (2E).
