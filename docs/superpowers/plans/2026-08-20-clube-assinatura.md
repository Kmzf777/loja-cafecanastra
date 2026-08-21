# Onda 3J — Clube da Canastra (assinatura recorrente)

> Plano da onda J do plano mestre (`2026-08-20-plano-mestre-pendencias.md`).
> Escrito ANTES da implementação; executa com TDD. O agente desta onda NÃO
> commita e NÃO edita `backend/src/index.js`, `frontend/legacy/PainelApp.jsx`
> nem `MenuAside.jsx` — as linhas de registro vão no relatório final.

**Goal:** o Clube da Canastra deixa de ser promessa: `/clube` ganha o wizard de
3 passos de verdade, o backend cria a assinatura no Mercado Pago (API de
preapproval), cada cobrança recorrente vira um pedido para o gestor enviar
café, a conta do cliente lista e cancela, e o painel enxerga as assinaturas.

## Decisões de desenho

1. **Dinheiro em centavos inteiros.** `preco_centavos` na tabela é o valor de
   CADA cobrança (por envio), já com os 10%: `Math.round(preco_reais * 0.9
   * 100) * quantidade`. Congelado na adesão — o MP cobra esse valor fixo; um
   reajuste de catálogo NÃO muda assinatura viva (é o que "preço travado na
   adesão" quer dizer nos termos).
2. **Sem frete na cobrança.** O preapproval cobra um valor fixo; não há como
   recotar frete a cada ciclo. O valor por envio já inclui a entrega
   (`shippingCost: 0`, `metodo_envio: "Clube da Canastra"` no pedido gerado).
   Documentado nos termos.
3. **Webhook SEPARADO** (`POST /webhook/mercadopago/assinaturas`): a
   `notification_url` de cada preapproval aponta para ele, então TUDO daquela
   assinatura (evento de preapproval E payment de cada cobrança) chega ali,
   sem tocar o webhook de pagamentos avulsos. Mesma validação HMAC:
   `validarAssinaturaWebhook` JÁ É EXPORTADA por `PaymentController` —
   importa-se de lá, zero edição naquele arquivo (a exceção autorizada de
   extrair para `utils/webhookMp.js` não é necessária).
4. **Status nunca vem do corpo da notificação**: o preapproval/payment é
   relido na API do MP, como o webhook de pagamentos já faz.
5. **Cobrança → pedido**: notificação de `payment` no webhook de assinaturas →
   relê o pagamento, acha a assinatura por `metadata.preapproval_id` (com
   `external_reference` como reserva), e:
   - pedido já existe para aquele `pagamento_id_mp` → transição de status
     idempotente (espelho enxuto do webhook de pagamentos: ativa↔cancelada
     movimenta estoque UMA vez, na mesma transação);
   - pedido não existe e o status traduzido é do grupo ATIVO → baixa estoque
     (`FOR UPDATE`, `WHERE quantidade >= $1`); estoque insuficiente NÃO perde
     a cobrança: o pedido nasce mesmo assim, com aviso gritado no log e
     e-mail ao admin; depois `ordersRepository.createOrder` com os dados
     CONGELADOS da assinatura (item, preço com desconto, endereço),
     `chave_idempotencia = assinatura:<id>:<paymentId>`, idempotente também
     pelo índice único de `pagamento_id_mp` (0005) — 23505 compensa o
     estoque e responde 200;
   - erro de banco → 500 (o MP reenvia).
6. **RLS da 0015**: dono lê as próprias (`eh_cliente() AND user_id =
   auth.uid()`), admin lê todas (`eh_admin()`); NENHUMA política de escrita —
   só o Express (`service_role`/dono do banco) escreve — e REVOKE de
   INSERT/UPDATE/DELETE de `authenticated` como segunda tranca (mesmo desenho
   de `pedidos`). RLS ligada (invariante de schema.test.js).
7. **PreApproval client no próprio ClubeController** (`require("mercadopago")`
   direto): `config/mercadopago.js` fica intocado (fora do território) e o
   teste intercepta o require, no padrão dos dublês de f4.
8. **Sem dependências novas** nos dois lados.

## Tarefas (ordem de execução)

1. `docs/superpowers/plans/2026-08-20-clube-assinatura.md` (este arquivo).
2. **Migração `backend/db/migrations/0015_assinaturas.sql`** —
   `canastra.assinaturas` com CHECKs nomeados, RLS e REVOKEs acima.
3. **Teste primeiro**: `backend/test/f7_clube.test.js` (node:test + Postgres
   embutido + dublês do MP/Resend): validações do assinar; caminho feliz
   (pendente → preapproval_id, corpo do preapproval conferido); falha do MP
   remove a linha; webhook preapproval authorized→ativa idempotente; HMAC
   armada recusa 401; cobrança gera pedido idempotente com estoque baixado;
   estoque zerado não perde a cobrança; cancelamento (dono, não-dono 404, MP
   chamado); RLS (Ana lê só as dela, Bruno nada, admin todas).
4. **Backend**: `backend/src/controllers/ClubeController.js` +
   `backend/src/routes/clube.routes.js` (rate limit próprio no webhook, no
   padrão do `webhookLimiter`).
5. **Vitrine**: `frontend/lib/clube.ts` (lógica pura: preço −10%, corpo do
   POST, opções a partir dos lotes, pré-seleção por query) +
   `frontend/lib/clube.test.ts` (Vitest); wizard client island em
   `frontend/app/(vitrine)/clube/AssinaturaWizard.tsx` montado pela página
   atual (editorial preservado, o bloco estático de passos sai);
   `account/page.tsx` ganha "Minha assinatura" (+ retorno
   `?assinatura=confirmada`); `PainelCompra.tsx`: aba Assinatura vira
   "Montar minha assinatura" → `/clube?cafe=<slug>&moagem=<m>`;
   `termos-de-uso/page.tsx` descreve o Clube real.
6. **Painel**: `frontend/legacy/components/DashboardSection/Assinaturas/
   AssinaturasManager.jsx` contra `GET /admin/assinaturas` (padrão do
   CuponsManager, 404 = módulo não instalado).
7. `.env.example` do backend: comentário — assinatura exige `WEBHOOK_URL`
   público; a `notification_url` por preapproval que o backend já envia
   BASTA (não precisa cadastrar o webhook de assinaturas no painel do MP,
   embora possa).
8. Regenerar `backend/db/instalacao-completa.sql` (gerador transcreve a
   pasta; conferir antes se 0012/0013/0014 dos agentes paralelos já estão lá
   e anotar o estado para o orquestrador).
9. Rodar `npm --prefix backend test` e `npm --prefix frontend run test` até
   verdes.

## Contratos novos (HTTP)

- `POST /clube/assinar` (auth): `{ sku, quantidade, frequenciaDias,
  endereco }` → `201 { assinatura: {...}, initPoint }`. 400 com frase para
  entrada inválida; 502 quando o MP recusa (linha pendente removida).
- `GET /clube/assinaturas` (auth): `[{ id, sku, nome_cafe, quantidade,
  frequencia_dias, preco_centavos, status, criado_em, cancelada_em }]`.
- `POST /clube/assinaturas/:id/cancelar` (auth, dono): cancela no MP e local;
  204→`200 { assinatura }`; 404 para não-dono (não vaza existência).
- `GET /admin/assinaturas` (admin): todas + `cliente_nome`, `cliente_email`.
- `POST /webhook/mercadopago/assinaturas` (público + rate limit + HMAC).

## O que fica dependendo de credencial (para o runbook)

`MP_ACCESS_TOKEN` real com Assinaturas habilitadas na conta MP,
`MP_WEBHOOK_SECRET`, `WEBHOOK_URL`/`LOJA_URL` públicos. Sem eles o código
sobe, mas o MP recusa o preapproval (o endpoint devolve o erro claro).
