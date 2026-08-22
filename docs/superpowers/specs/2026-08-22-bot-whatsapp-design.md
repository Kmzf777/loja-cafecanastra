# Bot de WhatsApp na Cloud API oficial da Meta — desenho

Data: 2026-08-22
Branch: `worktree-whatsapp-bot`
Status: aprovado pelo dono da loja por delegação explícita ("faça o que é melhor,
deixo tudo aprovado"). As decisões que normalmente seriam perguntas estão
registradas aqui, cada uma com a razão e o custo — é onde se discorda depois.

---

## 1. O que o bot faz

Um segundo canal de aviso ao cliente, ao lado do e-mail que já existe, no
**número oficial da loja na WhatsApp Cloud API da Meta**. Três funções, nesta
ordem de importância:

1. **Avisa o andamento do pedido** por template de utilidade aprovado: pedido
   recebido, pagamento aprovado, pedido enviado (com código e link de rastreio),
   pedido entregue, pedido cancelado, reembolso.
2. **Atende o básico por botões**: o cliente aperta um botão na própria mensagem
   e o bot responde onde está o pedido, ou o encaminha a uma pessoa, ou desliga
   os avisos.
3. **É operado pelo painel da loja**: ligar/desligar, escolher quais avisos saem,
   criar os templates na Meta, disparar um teste, e ver o que saiu e o que falhou.

O que ele **não** faz, de propósito (§10 registra a razão de cada um):

- não busca eventos na transportadora — só avisa os marcos que o painel conhece;
- não tem caixa de entrada: quem quer falar com gente é levado ao número humano;
- não manda promoção sem consentimento próprio e separado;
- não conversa em texto livre — o menu é fechado, por botões.

---

## 2. Os fatos da Meta que restringem o desenho

Pesquisados em 22/08/2026 na documentação oficial. Cada um muda uma decisão.

**Fora da janela de 24h só sai template aprovado.** O cliente que não escreveu
para a loja nas últimas 24 horas só pode receber um `message_template` que a
Meta já revisou e marcou `APPROVED`. Isso significa que os seis avisos de pedido
são, obrigatoriamente, seis templates aprovados — não texto montado na hora.
([Service messages](https://developers.facebook.com/documentation/business-messaging/whatsapp/messages/send-messages))

**Categoria erra e custa.** Só existem três categorias de template: `MARKETING`,
`UTILITY`, `AUTHENTICATION`. Aviso de pedido é `UTILITY` — a lista oficial de
casos aceitos inclui literalmente "Order management: confirmação de pedido,
atualizações, cancelamento". Mas a Meta reclassifica sozinha, e o exemplo
literal dela do que vira `MARKETING` é *"an order update with a promo"*. Uma
frase de venda no fim do "pedido entregue" reclassifica o template inteiro,
multiplica o preço por ~9 e, pior, **"template misclassifications" é motivo
explícito de bloqueio de envio** na escada de punição da Meta. Por isso os dois
canais — aviso e promoção — nascem separados neste desenho, com consentimentos
separados.
([Template categorization](https://developers.facebook.com/documentation/business-messaging/whatsapp/templates/template-categorization) ·
[Policy enforcement](https://developers.facebook.com/documentation/business-messaging/whatsapp/policy-enforcement))

**O corpo do template não pode começar nem terminar em variável.** Regra dura e
documentada ("dangling parameters are not allowed"), junto com: variável com
`#`/`$`/`%` reprova, variáveis não sequenciais reprovam, e template com corpo
duplicado de outro reprova. Todo texto da §6 obedece.
([Template review](https://developers.facebook.com/documentation/business-messaging/whatsapp/templates/template-review))

**O botão de URL aceita uma variável, e só no sufixo.** Não é substituição no
meio do caminho: a URL aprovada é fixa e o valor enviado é concatenado no fim.
É o que decide o formato do link de rastreio (§6).

**Webhook é assinado, e o exemplo oficial da Meta está errado.** As entregas vêm
com `X-Hub-Signature-256: sha256=<hmac do corpo CRU com o App Secret>`. O código
de exemplo publicado pela Meta deixa passar requisição **sem** o cabeçalho (só
`console.warn`) e compara com `!=`. Nossa implementação recusa sem cabeçalho e
compara com `timingSafeEqual` — a mesma disciplina que
`PaymentController.validarAssinaturaWebhook` (`PaymentController.js:216-267`) já
aplica ao Mercado Pago.

**O mesmo webhook chega mais de uma vez.** A Meta reentrega por **até 7 dias**
diante de qualquer resposta diferente de 200, e reentrega também quando o 200 se
perde na volta. Deduplicação é obrigatória, e a chave é o par
`wamid + status` — deduplicar só por `wamid` descartaria o `delivered` legítimo
que vem depois do `sent`.

**A ordem de entrega não é garantida.** Aviso literal da doc. "Pedido enviado"
pode chegar antes de "pagamento aprovado" se os dois saírem em sequência rápida.

**Botão de template e botão interativo são coisas diferentes.** Clique em
quick-reply de template chega como `messages[].type === "button"` com
`button.payload`; clique em mensagem interativa chega como
`type === "interactive"` com `interactive.button_reply.id`. O `payload` do
template vem do texto aprovado e muda se o template for traduzido; o `id` da
interativa é definido por nós e é estável. **O roteamento do menu usa `id`**, e o
`payload` do template serve só para abrir a conversa.

**A armadilha do nono dígito, e ela é do Brasil.** A doc da Meta diz, com estas
palavras: *"For Brazil and Mexico, the extra added prefix of the phone number
may be modified by the Cloud API."* Ou seja: você manda `5531999999999` e a Meta
pode entregar — e depois devolver no webhook — `553199999999`, sem o nono
dígito. Comparar o `from` do webhook com o que está em `clientes.telefone` daria
"cliente desconhecido" para metade do Brasil. **A chave canônica é o `wa_id`
que a própria Meta devolve**, guardado na primeira interação; o telefone
digitado no cadastro é só a semente do primeiro envio.

**Não existe `STOP` nativo.** A Meta não intercepta texto nem oferece opt-out
automático: parar de mandar é inteiramente responsabilidade da loja. Daí o botão
"Parar avisos" no menu e o reconhecimento de `PARAR`/`SAIR`/`STOP` em texto
livre serem parte do desenho, não enfeite.

**O texto do opt-in precisa dizer duas coisas**: que a pessoa está optando por
receber mensagens no WhatsApp, e o nome do negócio. A Meta não publica um texto
modelo; a tela de cadastro escreve as duas explicitamente.

---

## 3. O que isso custa

- **Utility no Brasil: US$ 0,0068 por mensagem entregue** — número oficial da
  Meta, não os US$ 0,0080 que os blogs repetem (aquilo é a tarifa antiga, por
  conversa, morta desde 01/07/2025).
- Um pedido que percorre o ciclo inteiro (recebido → pago → enviado → entregue)
  são 4 mensagens ≈ **US$ 0,027**, uns 15 centavos de real.
- **Prazo duro: 01/10/2026.** Até lá, template de utility entregue dentro de uma
  janela de atendimento aberta é grátis, e mensagem de serviço (as respostas do
  menu de botões) é grátis. **A partir de 01/10/2026 as duas passam a ser
  cobradas**, à mesma tarifa de utility. As tarifas de outubro saem até
  01/09/2026. Quem fizer a conta do bot depois dessa data precisa refazê-la.
- WABA criada hoje com Sold-To Brasil já nasce faturada em BRL pela Facebook
  Brasil.
- **Limite de destinatários únicos em 24h**: começa em 250, sobe para 2.000 com a
  verificação do negócio. É por *business portfolio*, não por número.

---

## 4. Onde o número do cliente entra

Hoje a loja **não tem o telefone de ninguém**: o cadastro pede nome, e-mail e
senha (`frontend/app/(vitrine)/account/cadastro/page.tsx:195-255`) e
`canastra.clientes.telefone` nasce nula
(`backend/db/migrations/0008_garantir_cliente.sql:114`). Sem isso o bot não tem
para quem falar. Decisão do dono:

- **Campo de WhatsApp obrigatório no cadastro.** O checkout já exige login
  (`checkout/page.tsx:168`), então o cadastro alcança todo mundo que compra.
- **O aviso de pedido vem junto com a conta.** É execução do contrato de compra,
  não marketing: o cliente pediu isso quando comprou. Fica dito com todas as
  letras na tela de cadastro e na política de privacidade.
- **Promoção é caixa à parte, desmarcada.** Consentimento amarrado a "ou aceita
  ou não cria conta" não é livre e não se sustenta nem na LGPD nem na política da
  Meta. Duas listas, dois carimbos, duas categorias de template.

As duas bases legais são **diferentes**, e é isso que justifica tratá-las
diferente: o aviso de pedido se apoia em execução de contrato (LGPD, Art. 7º V)
e não depende de consentimento; a promoção se apoia em consentimento (Art. 7º I),
que precisa de cláusula destacada, finalidade determinada e revogação gratuita e
facilitada (Art. 8º §5º). O ônus de provar que o consentimento existiu é do
controlador (Art. 8º §2º) — por isso cada opt-in vira um **carimbo de data**, e
não um booleano: um `true` não diz quando a pessoa concordou.
- **Quem já tem conta** é convidado a informar o número na área da conta
  (`frontend/app/(vitrine)/account/page.tsx`), sem travar nada.
- **Sair é uma linha:** o botão "Parar avisos" no menu do bot, ou a palavra
  `PARAR` em texto livre, carimba `whatsapp_optout_em` e encerra tudo.

`garantir_cliente` **já aceita telefone** como segundo parâmetro
(`0008:114`), então tornar o campo obrigatório é mudança de formulário, não de
contrato de banco. A migração 0017 faz `CREATE OR REPLACE` da função **sem
mudar a assinatura** (é o que mantém `test/garantir_cliente.test.js:` válido,
que afirma a assinatura no catálogo) só para carimbar `whatsapp_optin_em` quando
um telefone é gravado.

---

## 5. Arquitetura

```
                        ┌─ e-mail (Resend) ──────────────► cliente
  mudança de status ──► avisarCliente()
  (6 call sites)        └─ WhatsApp (Graph API v26.0) ───► cliente
                                    │
                                    ├─ whatsappConfig   (credencial: memória→banco→env)
                                    ├─ whatsappClient   (HTTP puro, fetchImpl injetável)
                                    └─ whatsappMensagens(funções PURAS: status → template)

  Meta ──webhook──► POST /whatsapp/webhook ─► HMAC ─► dedupe ─► roteador
                                                                  ├─ statuses[] → marca a linha do log
                                                                  └─ messages[] → menu de botões

  painel ──► GET/PUT /whatsapp/* (isAuthenticated → isAdmin)
```

### 5.1 Backend — módulos novos

| Arquivo | Responsabilidade | Depende de |
|---|---|---|
| `src/utils/telefone.js` | Normaliza para E.164 do Brasil (`5531999999999`): tira máscara, aceita com e sem o 9º dígito, recusa o que não for celular BR. **Puro.** | nada |
| `src/utils/whatsappMensagens.js` | `conteudoDoStatusWhats(status, dados)` → `{ template, idioma, parametros, botaoUrl }` ou `null`. **Puro.** Espelha o recorte de `conteudoDoStatus` do e-mail: `em_processamento` e `autorizado` devolvem `null`, porque o cliente não pode receber no zap o que a loja decidiu não mandar por e-mail. | `statusDePedido.js` |
| `src/services/whatsappConfig.js` | Lê e grava a configuração e a credencial. Ordem **memória → banco → env** (o mesmo desenho de `blingClient.js:118-136`). `configurado()`, `mascarar()`. Nunca devolve o token cru para fora do processo. | `pgPool` |
| `src/services/whatsappClient.js` | Cliente HTTP da Graph API: `enviarTemplate`, `enviarInterativa`, `enviarTexto`, `criarTemplate`, `listarTemplates`, `perfilDoNumero`. `fetchImpl = fetch` no default do parâmetro — a costura de teste da casa (`blingClient.js:175`). Timeout por `AbortController`. **Nenhum token em log nem em mensagem de erro**, e o rótulo de erro é método + caminho, nunca a URL com querystring — ela carrega telefone, que é dado pessoal (`blingClient.js:86-90`). | `whatsappConfig` |
| `src/services/notificacoes.js` | `avisarCliente(order, novoStatus, trackingCode)` — o wrapper que chama os dois canais. Engole erro dos dois, independentemente. | `emailSender`, `whatsapp*` |
| `src/controllers/WhatsappController.js` | Webhook (GET de verificação + POST assinado) e as rotas do painel. Exporta `validarAssinatura` como **função pura**, para o teste não precisar de servidor (o precedente é `pagamento.test.js:149-206`). | tudo acima |
| `src/routes/whatsapp.routes.js` | Monta as rotas. `isAuthenticated` **sempre antes** de `isAdmin` (`isAdmin.js:15-18`). Middleware `whatsappLigado` devolvendo **503 com código e frase**, no molde de `bling.routes.js:37-47`. | — |

Edições: `src/index.js` (duas linhas, registro da rota) e os **seis call sites**
da §5.3.

### 5.2 Banco — migração `0017_whatsapp_meta.sql`

Próximo número livre confirmado (última é `0016_redacao_ampliada.sql`). Toda
tabela nasce com RLS ligada e `REVOKE ALL ... FROM authenticated`, sem política:
enviar e receber WhatsApp passa pelo Express e pelo webhook, nunca por um INSERT
de navegador. `service_role` não é tocado — é credencial de servidor
(`0001:41-42`). `anon` não aparece porque nunca teve nada (`0001:20-28`).

**`canastra.whatsapp_config`** — linha única `id = 1`, com o mesmo CHECK de
`config_loja` (`0005:116-125`). Guarda a credencial **e** os interruptores:

```
id integer PK DEFAULT 1 CHECK (id = 1)
ativo               boolean NOT NULL DEFAULT false
access_token        text          -- System User token
app_secret          text          -- valida o X-Hub-Signature-256
verify_token        text          -- handshake do GET
phone_number_id     text
waba_id             text
numero_suporte      text          -- para onde vai quem pede uma pessoa
aviso_pendente      boolean NOT NULL DEFAULT true
aviso_aprovado      boolean NOT NULL DEFAULT true
aviso_enviado       boolean NOT NULL DEFAULT true
aviso_entregue      boolean NOT NULL DEFAULT true
aviso_cancelado     boolean NOT NULL DEFAULT true
aviso_reembolsado   boolean NOT NULL DEFAULT true
atualizado_em       timestamptz NOT NULL DEFAULT now()
```

**Tabela própria, e não uma coluna em `config_loja`**, por um motivo medido:
`config_loja` é pública por desenho — `GRANT SELECT ... TO anon` (`0005:133`),
política `USING (true)` (`0006:434`) e `GET /config` **sem autenticação**
(`products.routes.js:32`). O Bling conseguiu guardar segredo lá porque
`0012:105-116` trancou por privilégio de coluna, e funciona; mas cada segredo
novo naquela tabela é mais um que depende de ninguém escrever `select=*`. Uma
tabela sem GRANT nenhum não tem esse risco.

**`canastra.whatsapp_mensagens`** — o rastro do que saiu:

```
id            uuid PK DEFAULT gen_random_uuid()
pedido_id     uuid REFERENCES canastra.pedidos (id) ON DELETE SET NULL
user_id       uuid                       -- sem FK, como o resto do schema faz com auth.users
telefone_final text                      -- SÓ os 4 últimos dígitos
template      text NOT NULL
status        text NOT NULL DEFAULT 'pendente'
                CONSTRAINT whatsapp_mensagens_status_valido
                CHECK (status IN ('pendente','enviada','entregue','lida','falhou'))
wamid         text
erro_codigo   integer
erro_texto    text
criado_em     timestamptz NOT NULL DEFAULT now()
enviado_em    timestamptz
entregue_em   timestamptz
atualizado_em timestamptz NOT NULL DEFAULT now()
```

**O telefone completo não é gravado aqui, de propósito.** Guardar telefone numa
tabela nova obrigaria a incluí-la na redação da LGPD (`0013`, `0016`) e a manter
esse elo funcionando para sempre. Quatro dígitos bastam para o painel dizer "foi
para o ...9999", e o número real continua num lugar só: `clientes.telefone`, já
coberto pela redação existente.

Índices: `whatsapp_mensagens_wamid_idx` **UNIQUE parcial** (`WHERE wamid IS NOT
NULL`), no molde de `pedidos_bling_id_idx` (`0012:71-73`) — quase toda linha
nasce sem wamid; e `whatsapp_mensagens_pedido_idx` para a consulta do painel.

**`canastra.whatsapp_eventos`** — a trava de idempotência do webhook:

```
dedupe_key  text PRIMARY KEY   -- entrada: wamid | status: wamid || ':' || status
recebido_em timestamptz NOT NULL DEFAULT now()
```

`INSERT ... ON CONFLICT DO NOTHING` com `rowCount === 0` significando "já
processado" — é o mesmo claim atômico que `0011:53-57` fixou para
`lembrete_enviado_em`. Retenção de **7 dias**, alinhada à janela de reentrega
documentada pela Meta; a limpeza entra no cron que já existe.

**Colunas novas em `canastra.clientes`:**

```
whatsapp_wa_id            text         -- a chave canônica devolvida pela Meta
whatsapp_optin_em         timestamptz  -- avisos de pedido (carimbado no cadastro)
whatsapp_promo_optin_em   timestamptz  -- promoções (caixa opcional)
whatsapp_optout_em        timestamptz  -- o cliente mandou parar
whatsapp_ultima_entrada_em timestamptz -- último inbound: janela de 24h e teto do menu
```

Semântica de marcador de episódio, a de `0011:43-57`: `NULL` = não aconteceu,
preenchida = quando.

**`whatsapp_wa_id` existe por causa da armadilha do nono dígito (§2).** O
telefone digitado no cadastro serve para o **primeiro** envio; a partir da
primeira resposta do cliente, quem manda é o `wa_id` que a Meta devolveu.
Casar o `from` do webhook com o telefone do cadastro exige tentar as duas
formas — com e sem o 9 depois do DDD — e é isso que `utils/telefone.js` faz,
uma vez, até o `wa_id` estar gravado.

`whatsapp_ultima_entrada_em` é o relógio da janela de 24h: é ele que decide se
uma resposta livre pode sair e é ele que segura o teto de um menu por janela
(§7). Fora da janela, a Meta responde erro `131047`.

### 5.3 Onde o WhatsApp engata no fluxo que já existe

Existem hoje **seis** chamadas de `sendStatusEmail`, cada uma com uma guarda de
disparo diferente e cuidadosamente construída. A decisão é **envolver, não
duplicar**: `avisarCliente()` substitui `sendStatusEmail()` nos seis lugares e
herda todas as guardas de graça. Duplicar a chamada obrigaria a reescrever cinco
guardas corretamente cinco vezes.

| # | Call site | Guarda que já existe |
|---|---|---|
| C1 | `OrderController.js:255-257` | **nenhuma** — ver o conserto abaixo |
| C2 | `PaymentController.js:987` | `statusAplicado` nulo quando o webhook perdeu a corrida |
| C3 | `PaymentController.js:1227-1229` | `if (mudou)` |
| C4 | `ClubeController.js:620-622` | `if (mudou)` |
| C5 | `ClubeController.js:850` | pedido novo, idempotência 23505 |
| C6 | `blingPedidos.js:804` | `rowCount === 1`; **mantém o `await`** e o contrato de engolir, senão a rota `/bling/pedidos/:id/rastreio` passa a poder falhar por causa do WhatsApp |

**Três consertos que o segundo canal obriga:**

1. **C1 não tem guarda de mudança.** `OrderController.js:243` chama
   `updateOrderStatus` sem comparar `currentStatus !== newStatus`. Dois cliques
   no painel = dois e-mails hoje. E-mail duplicado é chato; WhatsApp duplicado
   custa dinheiro e derruba a nota de qualidade do template. A comparação entra
   **dentro do wrapper**, para valer para os seis de uma vez.
2. **C1 passa a linha velha.** `updated` (`OrderController.js:243`) já é a
   projeção completa e correta, com `tracking_code` e o status novo — é ele que o
   wrapper recebe, não `order` (`:171`).
3. **C6 passa um objeto de 5 campos** (`blingPedidos.js:796-797`), sem `items`.
   Nenhum texto de WhatsApp deste desenho cita produto, então basta; se um dia
   citar, esse call site precisa de um `getOrderById` antes.

**Onde não engatar:** dentro de `ordersRepository.updateOrderStatus`
(`:122-137`). Ele roda **dentro** de transações abertas; notificar de lá seria
rede dentro de transação e aviso enviado antes de um COMMIT que ainda pode virar
ROLLBACK.

**Contrato do wrapper:** `avisarCliente` **engole** erro dos dois canais, como
`sendStatusEmail` faz hoje (`emailSender.js:105-110`) — um pedido pago não pode
virar erro porque o aviso não saiu. A exceção continua sendo
`sendCartReminderEmail`, que lança de propósito
(`emailSender.js:250-272`); o job de carrinho abandonado **não** entra neste
desenho, justamente para não mexer nessa semântica.

**Silêncios legítimos**, todos sem erro: integração desligada; cliente sem
telefone; cliente com `whatsapp_optout_em`; aviso daquele status desligado no
painel; status fora do recorte (`em_processamento`, `autorizado`).

---

## 6. Os templates

Seis templates `UTILITY`, idioma `pt_BR`, `parameter_format: "named"`, criados
por API a partir do painel. Todos obedecem: corpo não começa nem termina em
variável, sem variáveis adjacentes, sem uma palavra de venda, rodapé fixo sem
variável.

Todos levam o **mesmo quick-reply `Preciso de ajuda`** — é ele que abre a janela
de 24h e dá entrada no menu de suporte (§7).

| Template | Quando sai | Corpo (resumo) | Botões |
|---|---|---|---|
| `pedido_recebido` | status `pendente` | "Olá, {{nome}}. Recebemos seu pedido {{numero}}. Assim que o pagamento for confirmado, começamos o preparo." | quick-reply `Preciso de ajuda` |
| `pagamento_aprovado` | status `aprovado` | "Olá, {{nome}}. O pagamento do pedido {{numero}} foi confirmado e já estamos preparando seu café." | quick-reply `Preciso de ajuda` |
| `pedido_enviado` | status `enviado` | "Olá, {{nome}}. Seu pedido {{numero}} saiu para entrega. O código de rastreio é {{rastreio}}, e você acompanha pelo botão abaixo." | URL `Rastrear pedido` + quick-reply `Preciso de ajuda` |
| `pedido_entregue` | status `entregue` | "Olá, {{nome}}. Seu pedido {{numero}} foi entregue. Se algo não estiver certo, fale com a gente pelo botão abaixo." | quick-reply `Preciso de ajuda` |
| `pedido_cancelado` | status `cancelado` ou `rejeitado` | "Olá, {{nome}}. Houve um problema com o pagamento do pedido {{numero}} e ele não seguiu adiante." | quick-reply `Preciso de ajuda` |
| `pedido_reembolsado` | status `reembolsado` | "Olá, {{nome}}. O valor do pedido {{numero}} foi devolvido. O prazo para aparecer na fatura depende do seu banco." | quick-reply `Preciso de ajuda` |

**O botão de rastreio** é URL com sufixo variável, a única forma que a Meta
aceita: `https://cafecanastra.com/rastreio?codigo={{1}}`, e o envio passa só
`AA123456789BR`. A página `/rastreio` da vitrine redireciona para a
transportadora — assim um template serve todas elas, e trocar de transportadora
não exige reaprovar template.

Ordem de combinação dos botões importa: a Meta recusa quick-reply intercalado
com não-quick-reply. `URL, QUICK_REPLY` é válido; `QUICK_REPLY, URL,
QUICK_REPLY` não é.

**Um `pedido_entregue` com "aproveite 10% na próxima compra" reclassifica o
template para MARKETING.** É o exemplo literal da Meta. Está escrito aqui porque
é a tentação óbvia de quem for editar esses textos depois.

O texto exato de cada template vive em `src/utils/whatsappMensagens.js`, num
mapa só — a mesma disciplina de fonte única que `statusDePedido.js:7-12` já
registra. O painel cria na Meta exatamente o que está nesse mapa; divergência
entre o mapa e o que está aprovado na Meta aparece na tela como aviso.

---

## 7. O suporte por botões

```
cliente aperta "Preciso de ajuda" num aviso
        │  (webhook: type="button", button.payload)
        ▼  isso ABRE a janela de 24h
bot responde com mensagem interativa (3 reply buttons):

   [ Meu pedido ]  [ Falar com alguém ]  [ Parar avisos ]
        │                  │                    │
        │                  │                    └─► carimba whatsapp_optout_em,
        │                  │                         confirma, e encerra
        │                  │
        │                  └─► responde com o link do WhatsApp humano da loja
        │                       (whatsapp_config.numero_suporte, semente em
        │                        LOJA_WHATSAPP) e avisa que ali responde gente
        │
        └─► busca o pedido mais recente daquele telefone e responde
             status por extenso + código de rastreio + link, ou
             "não encontrei pedido no seu número" quando não houver
```

Roteamento **por `interactive.button_reply.id`** (`meu_pedido`,
`falar_humano`, `parar_avisos`), nunca por `button.payload` — o payload vem do
texto do template aprovado e muda se o template for traduzido.

**Texto livre** que não seja `PARAR`/`SAIR`/`STOP` recebe o mesmo menu de
botões, **no máximo uma vez por janela de 24h** — sem esse teto, cliente e bot
entram em pingue-pongue e cada volta conta contra a nota de qualidade do número.

**Nada aqui é IA.** É um menu fechado, determinístico, testável. O Meta Business
Agent (a IA da Meta) cobra por token desde 01/08/2026 e está fora de escopo.

---

## 8. O painel

Uma tela nova em `/dashboard/whatsapp`, no molde de `Bling/BlingManager.jsx`,
que é o precedente de tela de integração desta casa. Arquivos:

- **novo** `frontend/legacy/components/DashboardSection/WhatsApp/WhatsAppManager.jsx`
- **novo** `.../WhatsApp/whatsappContrato.js` + `whatsappContrato.test.ts` (lógica
  pura, testada — o único lugar do painel legado com teste, precedente em
  `Bling/blingContrato.test.ts`)
- **novo** `.../WhatsApp/useWhatsAppAcoes.js` (trava de duplo clique em `ref`,
  como `useBlingAcoes.js:41-56`)
- edição em `frontend/legacy/PainelApp.jsx` (import preguiçoso + rota de **path
  absoluto**, `PainelApp.jsx:62-68`)
- edição em `.../MenuAside/MenuAside.jsx` (ícone `lucide-react` `size={18}` +
  link absoluto, no grupo "Configurações gerais")

Seis blocos na tela:

1. **Estado da integração** — sonda `GET /whatsapp/status`: ligado ou desligado,
   número conectado, `quality_rating`, limite de destinatários, e **o que ainda
   falta preencher**. "Desligado" é estado conhecido, não erro: desabilita os
   botões em vez de deixar o 503 acontecer (`BlingManager.jsx:175-179`).
2. **Credenciais** — token, app secret, verify token, phone number id, waba id.
   Campos **write-only**: o `GET` devolve só máscara (`••••4821`) e a data de
   gravação, nunca o valor. Botão "Testar conexão" chama o perfil do número na
   Meta e mostra o que voltou.
3. **Avisos** — seis interruptores, um por status.
4. **Templates** — a lista dos seis, com o estado de cada um na Meta
   (`APPROVED` / `PENDING` / `REJECTED` + motivo / ausente) e o botão "Criar na
   Meta". Divergência entre o texto do código e o aprovado aparece aqui.
5. **Enviar teste** — número + template, para validar contra o número de teste da
   Meta antes de o número real existir.
6. **Histórico** — as últimas mensagens: pedido, template, para onde foi (4
   dígitos), estado de entrega e a frase de erro quando falhou.

Padrões da casa que a tela segue: `authFetch` do contexto com **URL completa**
(`${API_BASE}/...`); erro mostra **a frase do servidor**
(`corpo.message || corpo.error`); toast **e** tarja persistente com
`role="alert"` (`BlingManager.jsx:187-210`); `403` e `503` tratados como estados
distintos de `500`. **Nada de `X-CSRF-Token`** — o cabeçalho não está em
`allowedHeaders` (`index.js:87`) e mandá-lo quebra o preflight.

### 8.1 Onde a credencial mora — a decisão e o seu preço

A regra desta casa, estabelecida em `0012` e escrita em três lugares que
concordam: **`.env` para o que o operador cola uma vez e o processo nunca
reescreve; banco para o que o provedor rotaciona por trás do processo.** Pelo
critério puro, o token de System User da Meta é permanente e não-rotativo, logo
seria `.env`.

**Decisão: os dois, com o banco na frente** — ordem de leitura **memória → banco
→ env**, exatamente a de `blingClient.js:118-136`. O painel grava no banco; a
`.env` vale como semente e como saída para quem preferir não ter segredo no
banco. Foi o que o dono pediu ("deixar o bot configurado na dashboard") e é uma
integração inteira que passa a ser configurável sem ninguém entrar na VPS.

O preço, dito por extenso porque é real: **um segredo no banco entra em todo
`pg_dump`** (`docs/producao.md:519-537`) e continua legível por quem tiver a
`service_role` key, porque `0001:41-42` dá `GRANT ALL` de tabela ao
`service_role`. Foi o preço aceito para `bling_refresh_token` e é o mesmo aqui.
Mitigações que este desenho aplica: tabela própria sem GRANT nenhum para `anon` e
`authenticated`; nenhuma rota devolve o valor, só a máscara; nenhum log e nenhuma
mensagem de erro carrega o token.

`META_ATIVO=false` por padrão, e **nada disso entra em
`OBRIGATORIAS_EM_PRODUCAO`** (`ambiente.js:66-75`) — integração que nasce
desligada não pode impedir o `npm start` de quem não tem conta na Meta. É por
isso que `BLING_*` também não está lá.

---

## 9. Erros, e o que acontece quando cada coisa quebra

| Falha | Comportamento | Por quê |
|---|---|---|
| Meta fora do ar / timeout | grava `status='falhou'` + a frase de erro, log, **não lança** | pedido pago não vira erro porque o aviso não saiu |
| Cliente sem telefone | silêncio, sem log de erro | é o caso comum de quem tem conta antiga (`sendStatusEmail:76` faz igual com e-mail) |
| Cliente com `whatsapp_optout_em` | silêncio | ele pediu |
| Token inválido (190) / número não registrado | grava o erro e **desliga a integração**, com o motivo visível no painel | continuar tentando queima cota e nota de qualidade |
| Template `REJECTED` ou `PAUSED` | aquele aviso para; os outros continuam | pausa de template é 3h → 6h → desabilitado |
| Webhook sem assinatura ou com assinatura errada | **401**, sem processar | o exemplo oficial da Meta deixa passar; este não |
| Webhook repetido | descartado pela chave `wamid[:status]` | a Meta reentrega por até 7 dias |
| Webhook com corpo que não reconhecemos | **200** e log | responder ≠200 faz a Meta reentregar por 7 dias |
| Painel tenta agir com integração desligada | **503** com código e frase | `bling.routes.js:37-47` |
| Dois cliques no mesmo status no painel | segundo é silencioso | a guarda nova do wrapper (§5.3) |

Rate limit próprio na rota do webhook, no molde do `webhookLimiter` do Mercado
Pago (`index.js:113-117`): é rota pública e cada entrega custa trabalho.

---

## 10. Fronteiras — o que fica de fora, e por quê

- **Rastreio automático da transportadora.** A Melhor Envio hoje só cota frete
  (`ShippingController.js:116`); não há consulta de rastreio. Buscar eventos de
  transportadora é um subsistema do tamanho deste — job, tabela de eventos já
  vistos, tradução de vocabulário por transportadora. Fica para depois; o
  desenho não impede.
- **Caixa de entrada no painel.** Quem quer falar com gente vai para o número
  humano que a loja já usa. Uma inbox obrigaria a tela em tempo real e a cumprir
  a janela de 24h — passou 24h sem o cliente escrever, o atendente só fala por
  template aprovado.
- **Disparo de promoções.** O consentimento é coletado desde já
  (`whatsapp_promo_optin_em`), mas nenhum template de `MARKETING` é criado nem
  enviado. Misturar promoção agora é o caminho mais curto para a reclassificação
  e para o bloqueio.
- **WhatsApp para o gestor** (novo pedido, alerta do Clube). O e-mail já faz, e
  cada mensagem custa.
- **Carrinho abandonado por WhatsApp.** Exigiria mexer na semântica invertida do
  `sendCartReminderEmail`, que lança de propósito para o job poder dar ROLLBACK
  na marca (`emailSender.js:250-272`). É risco desproporcional ao ganho agora.

---

## 11. Como isto é testado sem número real

O número da loja ainda não existe, e **isso não bloqueia nada**. A Meta dá um
**número de teste gratuito** com o app, que envia para até 5 destinatários
autorizados, com limites relaxados e **sem exigir cartão cadastrado**. Dá para
construir e exercitar o bot inteiro antes.

No CI não há rede: nenhum teste fala com a Meta. A costura é `fetchImpl` no
default do parâmetro, e o teste passa a própria função e afirma sobre as chamadas
registradas — o padrão de `f7_bling.test.js:680-693`.

Backend, `node --test` (`npm --prefix backend test`):

- **`whatsapp_mensagens.test.js`** — funções puras: cada status produz o template
  certo; `em_processamento` e `autorizado` produzem `null`; normalização de
  telefone (com máscara, sem o 9º dígito, número inválido); o corpo do template
  não começa nem termina em variável (a regra da Meta, afirmada em teste, não em
  comentário); percent-encoding do sufixo do botão de URL.
- **`whatsapp_webhook.test.js`** — os cinco casos que `pagamento.test.js:149-206`
  fixou como o padrão de assinatura, traduzidos para o HMAC da Meta: assinatura
  válida; segredo forjado; **corpo alterado depois de assinado**; cabeçalho
  ausente; produção recusa sem segredo / desenvolvimento aceita. Mais: o GET de
  verificação devolve o `hub.challenge` **cru** (sem aspas, sem JSON — devolver
  `res.json()` quebra o handshake e é o erro clássico); dedupe descarta o
  repetido e **não** descarta `delivered` depois de `sent`; roteamento de
  `button_reply.id`.
- **`whatsapp_notificacoes.test.js`** — o wrapper, com Postgres real: os dois
  canais são chamados; WhatsApp falhando não impede o e-mail; sem telefone é
  silêncio; aviso desligado é silêncio; opt-out é silêncio; status repetido não
  reenvia.
- Os invariantes de esquema que já existem passam a valer para as tabelas novas
  sem uma linha de teste nova: `schema.test.js:65` (RLS ligada em toda tabela de
  `canastra`), `rls.test.js:845` e `:999`, `instalacao.test.js`.

Frontend, `vitest run`: `whatsappContrato.test.ts` — a lógica pura da tela
(quais campos faltam, que estado a sonda descreve, como a máscara é montada).

Depois de escrever a migração: `npm run db:gerar-sql` regenera
`instalacao-completa.sql`, que `instalacao.test.js` compara catálogo a catálogo.

---

## 12. O que o dono da loja terá de fazer quando criar o número

Fora do que o código resolve. Está aqui para não virar arqueologia depois.

1. **Business Portfolio verificado** (CNPJ, comprovante de endereço). Sem
   verificação, o teto é 250 destinatários únicos por 24h.
2. **App na Meta for Developers**, caso de uso "Connect with customers through
   WhatsApp"; anotar `WABA_ID` e `PHONE_NUMBER_ID` em WhatsApp → API Setup.
3. **O número precisa estar limpo**: número já em uso no WhatsApp comum ou no app
   Business **não pode ser registrado** — tem de ser apagado antes, e a liberação
   leva até ~24h. Precisa receber SMS ou ligação. Não pode ser short code.
   **Depois de entrar na Cloud API, esse número não funciona mais no aplicativo
   do celular** — por isso ele é novo, e o número humano de hoje continua
   intacto.
4. **Token de System User**, permissões `whatsapp_business_messaging` +
   `whatsapp_business_management`, expiração **"Nunca"**. É exibido uma única
   vez.
5. **Webhook**: Callback URL `https://<api-da-loja>/whatsapp/webhook`, o Verify
   Token que você escolher, e assinar o campo `messages` (ele cobre entrada
   **e** status) e `message_template_status_update`.
6. Colar tudo no painel, criar os seis templates pelo botão, esperar a aprovação
   (até 24h, na prática minutos) e ligar.

Graph API fixada em **`v26.0`**, numa constante única.

---

## 13. Riscos conhecidos

- **01/10/2026**: acaba a gratuidade de utility-dentro-da-janela e de mensagens
  de serviço. As respostas do menu de botões passam a custar. As tarifas saem até
  01/09/2026 — a conta da §3 precisa ser refeita então.
- **Reclassificação de categoria** é processo recorrente da Meta e, para quem já
  foi advertido, **sem aviso prévio**. O painel mostra `category` e
  `correct_category` lado a lado para isso não passar despercebido.
- **O rate card oficial em BRL não foi lido** — está atrás de seletor interativo
  no site da Meta. O US$ 0,0068 vem de citação em documentação oficial; o valor
  em real, não. Vale conferir antes de fazer orçamento.
- **Cadastro obrigatório de telefone pode custar conversão.** É reversível numa
  linha (tornar o campo opcional); o dono decidiu assumir.
- **`pedidos` guarda telefone dentro de `address_json`** e a redação da LGPD já
  cobre isso (`0013`, `0016`). As tabelas novas não guardam telefone completo,
  justamente para não abrir um segundo elo a manter.
