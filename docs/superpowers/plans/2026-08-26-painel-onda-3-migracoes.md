# Painel de gestão — Onda 3: as migrações

> **Para quem executa:** SUB-SKILL OBRIGATÓRIA — `superpowers:subagent-driven-development`.
> Esta onda **não toca no frontend**. É schema e só schema.

**Goal:** o banco passa a saber o que a loja precisa saber — um motor de promoção de verdade, a
origem de cada venda, os campos fiscais que a NF-e exige, e um registro de quem mexeu no quê.

**Architecture:** quatro migrações independentes entre si, cada uma com teste de RLS por papel
contra o PostgreSQL embarcado. Nenhuma delas escreve código de aplicação: a Onda 4 é quem faz o
motor calcular. Aqui o critério de pronto é *o banco aceita e recusa as coisas certas*.

**Numeração:** `0032` a `0035`. `0030` é a vitrine e `0031` são as correções de privilégio, as duas
já aplicadas. O runner **aborta em número repetido**, e a chave em `canastra.migracoes` é o **nome
completo do arquivo** — migração aplicada nunca é renomeada.

**Leitura obrigatória:** `docs/superpowers/specs/2026-08-26-painel-de-gestao-design.md` §3 inteiro;
`backend/db/migrations/0006_politicas_rls.sql` inteiro; e `0030_vitrine.sql`, que é o exemplo mais
recente do estilo desta casa.

---

## A regra de segurança que vale para as quatro

1. `ENABLE ROW LEVEL SECURITY` na criação. O padrão é negar.
2. `GRANT SELECT ... TO anon` **apenas** para o que a vitrine anônima precisa ler.
3. Escrita só por admin, via política sobre `canastra.eh_admin()` — que lê `canastra.admins` e
   **nunca** um claim do JWT, porque a instância do Supabase é compartilhada com outros projetos.
4. Política pública é sempre `FOR SELECT`. `rls.test.js` afirma isso como invariante sobre
   `pg_policies`, e mantém uma **lista chumbada** (`PUBLICAS`) das relações onde `USING (true)` é
   aceito — acrescentar um nome ali é afirmar no diff que a relação pode ser lida por quem não tem
   conta. Não é inventário, é decisão.
5. Toda política leva cláusula `TO` explícita. Sem ela a política nasce `TO public`, que alcança
   também o **dono** das tabelas — de quem `eh_admin()` depende para ler por baixo da RLS.
6. Tabela que carrega vínculo com pessoa (`promocao_resgates`, `consentimentos`, `envios`,
   `admin_log`) **nunca** recebe GRANT para `anon`.

E depois de cada migração: `cd backend && node db/gerar-instalacao.js`, senão
`test/instalacao.test.js` fica vermelho dizendo que a instalação está desatualizada.

---

### Task 1: `0032_motor_de_promocao.sql`

O coração da onda. Hoje o desconto vive em **duas estruturas que nunca se falam**:
`canastra.promocoes` (desconto de vitrine, aplicado por produto em `utils/preco.js:23` com um
`Math.min` ingênuo entre todas as promoções que casam) e `canastra.cupons` (desconto de checkout,
sobre o subtotal). Elas divergem em silêncio, e uma das divergências é uma armadilha:
**promoção só é aplicada com `inicio_em` E `fim_em` preenchidos**, embora as duas colunas sejam
nuláveis — uma promoção salva com `ativa = true` e sem datas nunca vale, sem aviso nenhum.

**A unificação.** Shopify, Medusa e Saleor modelam isso como uma entidade com um campo `metodo`:
`automatico` aplica sozinho no carrinho, `codigo` exige o cliente digitar. Mesma regra, porta de
entrada diferente. Unificar dá **uma** tela, **uma** ordem de aplicação e **um** relatório.

**Files:**
- Create: `backend/db/migrations/0032_motor_de_promocao.sql`
- Create: `backend/test/motor_promocao.test.js`

- [ ] **Step 1: Escrever o teste primeiro** — no molde de `backend/test/rls.test.js`.

Casos obrigatórios, e cada um existe por um motivo escrito na spec:

```
anon lê promoção ativa, escopo e faixas (a vitrine precisa)
anon NÃO lê resgates (carregam vínculo com pessoa)
cliente logado não escreve nada
admin escreve tudo
metodo fora de (automatico, codigo) é recusado
classe fora de (produto, pedido, frete) é recusada
mecanica fora da lista é recusada
percentual acima de 90 é recusado                    ← o mesmo teto que cupons já tem
minimo_tipo e minimo_valor são coerentes             ← 'nenhum' com valor é recusado
o mesmo código não pode existir duas vezes
o mesmo (promocao, pedido) não resgata duas vezes    ← UNIQUE que sustenta o contador
faixa com quantidade_min repetida na mesma promoção é recusada
promocao_frete aceita UF e faixa de CEP, e recusa CEP não-numérico
```

- [ ] **Step 2: Rodar e ver falhar.**

- [ ] **Step 3: Escrever a migração.** As sete tabelas:

**`promocoes`** — reescrita. Colunas: `id`, `nome`, `descricao`, `metodo`
(`automatico`|`codigo`), `classe` (`produto`|`pedido`|`frete`), `mecanica`
(`percentual`|`valor_fixo`|`preco_fixo`|`leve_x_pague_y`|`progressivo`|`brinde`|`frete_gratis`),
`valor numeric(10,2)`, **`teto_desconto_centavos integer`**, `minimo_tipo`
(`nenhum`|`subtotal`|`quantidade`) + `minimo_valor integer`, `prioridade integer NOT NULL DEFAULT 0`,
`exclusiva boolean NOT NULL DEFAULT false`, `grupo_exclusividade text`,
`meios_pagamento text[]`, `limite_usos integer`, `limite_por_cliente integer`,
`orcamento_centavos integer`, `inicio_em`, `fim_em`, `habilitada boolean NOT NULL DEFAULT true`,
`arquivada_em timestamptz`, `criada_em`, `atualizada_em`.

> **`arquivada_em` e não DELETE.** R13: nada é apagado de verdade. Promoção apagada quebra o
> relatório do pedido que a usou. E hoje não existe DELETE de promoção nem de cupom em lugar
> nenhum da pilha — o painel só oferece "desativar", e a lista só cresce.

> **`habilitada` é o kill-switch, separado das datas.** O status (`agendada`/`vigente`/`expirada`)
> é **derivado** das datas, nunca coluna gravada — foi gravar status derivado que produziu a
> armadilha do painel legado, onde editar uma promoção fora da janela a desativava para sempre.

**`promocao_codigos`** — `(promocao_id FK, codigo text UNIQUE, uso_unico boolean, usos integer,
limite_usos integer, ativo boolean)`. Uma regra, N códigos: é o que permite 500 códigos de
influenciador rastreáveis individualmente com um relatório só. O CHECK do formato é o mesmo de
`cupons`: `^[A-Z0-9]{3,30}$` — A-Z e 0-9 apenas, porque é o que cabe num anúncio e num campo de
checkout sem ambiguidade de espaço, acento ou emoji.

**`promocao_escopo`** — `(promocao_id FK, tipo` (`produto`|`categoria`|`sku`|`todos`|`assinante`)`,
alvo text, incluir boolean NOT NULL)`. O `incluir = false` é o que permite *"10% na loja toda,
**menos** o micro-lote"* — e não existe hoje: o escopo são três colunas mutuamente exclusivas
(`aplica_a`, `categoria`, `produto_id`), com um `produto_id` só e sem FK.

**`promocao_faixas`** — `(promocao_id FK, quantidade_min integer, desconto_tipo, desconto_valor,
UNIQUE (promocao_id, quantidade_min))`. Sustenta progressivo e leve-3-pague-2 **no banco**, com
CHECK, em vez de num jsonb solto que ninguém consegue validar.

**`promocao_frete`** — `(promocao_id FK, teto_frete_centavos integer, ufs text[],
apenas_modalidade_mais_barata boolean, cep_inicio text, cep_fim text)`.

> **O CEP é normalizado para dígitos antes de comparar.** Comparar `'01310-100'` com `'01310100'`
> é um bug que só aparece em produção, e esta loja **já teve um dessa família** no CEP de origem
> (commit `7fe8d36`). O CHECK exige `^[0-9]{8}$`.

> **O teto de frete não é capricho.** Café tem frete comparável ao produto: sem teto, "frete grátis
> acima de R$ 149" significa bancar um SEDEX de R$ 90 para o Acre, toda semana, saindo da margem.
> E `apenas_modalidade_mais_barata` existe porque sem ele o cliente escolhe SEDEX de graça quando a
> loja queria bancar o PAC.

**`promocao_resgates`** — `(promocao_id FK, codigo_id FK NULL, pedido_id FK, user_id FK NULL,
documento_hash text, valor_centavos integer, resgatado_em, estornado_em,
UNIQUE (promocao_id, pedido_id))`.

> **É esta tabela, e não um contador, que é a verdade do uso.** Duas razões: pedido cancelado ou
> PIX expirado precisa **devolver** o uso, e é dela que sai o relatório de campanha. A própria
> Shopify documenta que o contador denormalizado dela fica defasado.

> **`documento_hash` é SHA-256 do CPF, nunca o CPF.** E-mail é infinito e gratuito — cupom de
> primeira compra controlado por e-mail é cupom permanente, e por isso o limite por cliente é por
> CPF. Guardar o número seria mais uma cópia de dado pessoal, e as migrações 0013 e 0016 desta loja
> já pagaram esse preço uma vez.

**`pedido_ajustes_desconto`** — `(pedido_id FK, promocao_id FK NULL, codigo text NULL, alvo`
(`item`|`pedido`|`frete`)`, alvo_ref text NULL, sequencia integer, valor_centavos integer,
rotulo text)`.

> **Parece burocracia e não é.** Sem uma linha por desconto aplicado não existe: NF-e com desconto
> rateado por item (o Bling exige), estorno proporcional em devolução parcial, nem resposta para
> *"por que este pedido saiu por R$ 137,40?"*. Sustenta o limite por cliente, o relatório de cupom
> e a integração fiscal ao mesmo tempo.

**Migração de dados.** As linhas de `canastra.cupons` viram `promocoes` com `metodo = 'codigo'` mais
uma linha em `promocao_codigos`; as de `canastra.promocoes` antiga viram `metodo = 'automatico'`.
As duas tabelas antigas **ficam de pé** nesta onda — a Onda 4 é quem troca o código que as lê, e
derrubá-las agora quebraria o checkout. Deixe escrito no arquivo que elas saem numa migração
posterior, e qual.

- [ ] **Step 4: Rodar, ver passar, regenerar a instalação, commitar.**

---

### Task 2: `0033_marketing.sql`

- [ ] **Step 1: Teste primeiro.**

- [ ] **Step 2: A migração.**

`pedidos` ganha `utm_source`, `utm_medium`, `utm_campaign`, `utm_content`, `utm_term`, `canal`,
`referrer`, `landing_page`, `gclid`, `fbclid`.

> **É o item mais urgente da spec inteira, e o único irreversível.** Nenhum relatório reconstrói
> depois de onde veio um pedido de três meses atrás. São dez colunas e uma tarde.

> **Atenção à LGPD:** se alguma dessas colunas puder carregar identificador de pessoa, ela entra na
> lista de redação de `canastra.redigir_endereco`/`redigir_dados_do_titular` (0013/0016). `gclid` e
> `fbclid` são identificadores de publicidade — decida e escreva a decisão no arquivo.

`campanhas` — `(id, nome, canal, utm_campaign text UNIQUE, custo_centavos integer, inicio_em,
fim_em, ativa)`. O **custo de mídia** não é opcional: sem ele não há como saber se a campanha deu
lucro, e o relatório vira vaidade.

`consentimentos` — `(id, user_id FK NULL, email text NULL, telefone text NULL, canal`
(`email`|`whatsapp`|`sms`)`, estado` (`concedido`|`revogado`)`, origem text NOT NULL, texto_aceito
text, ip inet NULL, criado_em)`.

> **Consentimento é um ESTADO COM PROCEDÊNCIA, não um booleano.** Guardar de onde veio o opt-in
> (rodapé, pop-up, checkout) é o que prova o consentimento depois. E ele **nunca** nasce
> pré-marcado, em nenhuma região.

`envios` — `(id, canal, campanha_id FK NULL, user_id FK NULL, destinatario_final text, template
text, estado` (`pendente`|`enviado`|`entregue`|`lido`|`falhou`)`, provedor_id text, erro_texto text,
criado_em, enviado_em, entregue_em)`. Agnóstico de canal de propósito.

> **Risco registrado:** `worktree-whatsapp-bot` já tem `canastra.whatsapp_mensagens` com forma
> parecida, e colunas de opt-in de WhatsApp em `canastra.clientes`. Esta migração **não** recria
> nada disso. Se aquela branch entrar, uma migração de reconciliação funde as duas — está fora do
> escopo desta.

`automacoes` — `(id, nome, gatilho text, espera_minutos integer, condicao jsonb, acao jsonb,
ativa boolean)`.

`newsletter_inscritos` ganha `optout_em`, `token_descadastro text UNIQUE`, `confirmado_em`.
Hoje **não há como alguém sair da lista**, o que é problema de LGPD antes de ser de funcionalidade.

`carrinhos` ganha `token_retomada text UNIQUE` — é o que faz o link do e-mail de abandono devolver
a pessoa ao carrinho cheio, e é metade do que falta para a automação de maior retorno que existe em
e-commerce (a outra metade, o job, já existe).

---

### Task 3: `0034_produto_fiscal.sql`

- [ ] **Step 1: Teste primeiro.**

- [ ] **Step 2: A migração.**

`produtos` ganha o bloco fiscal que o Bling exige e que **não existe em nenhuma das 16 colunas
atuais**: `ncm` (8 dígitos), `cest` (7), `origem_fiscal smallint` (0–8, tabela da SEFAZ), `gtin`,
`gtin_embalagem`, `unidade`, `tipo_item`, `cfop_padrao`, `csosn`, `peso_liquido numeric(10,3)`,
`peso_bruto numeric(10,3)`, e `codigo_bling text UNIQUE`.

> **É o item que decide a aceitação do cliente.** A loja hoje nunca cria produto no Bling — só
> confere o SKU (`blingPedidos.js:286-292`) — e os dois POST de emissão de NF-e vão **sem corpo
> nenhum**. Um produto sem NCM **passa** na sincronização e só falha na transmissão à SEFAZ, no pior
> momento possível: com o pedido do cliente parado.

> **O `peso` atual é numeric(10,3) DEFAULT 0.3 e serve ao FRETE.** Não o renomeie nem o reaproveite
> como peso líquido: são grandezas diferentes e o frete depende dele hoje. `peso_liquido` e
> `peso_bruto` entram ao lado.

`produtos` ganha também `estado` (`rascunho`|`ativo`|`arquivado`), com `DEFAULT 'ativo'` para as
linhas que já existem — nada é deletado de verdade (R13), porque produto apagado quebra pedido
histórico que aponta para ele.

**Snapshot de custo:** o item do pedido passa a guardar o custo do momento da venda. `pedidos.itens`
é `jsonb` — decida entre acrescentar a chave no jsonb ou criar `pedido_itens` de verdade, e
**escreva o porquê**. Sem congelar o custo não existe relatório de margem verdadeiro: recalcular
com o custo de hoje mente sobre o passado.

---

### Task 4: `0035_auditoria.sql`

- [ ] `admin_log` — `(id, admin_user_id FK, acao text, entidade text, entidade_id text, antes jsonb,
  depois jsonb, criado_em)`. Nunca legível por `anon`.
- [ ] `admins` ganha `papel text NOT NULL DEFAULT 'dono'`.

> Hoje **todo admin pode tudo e nada registra quem mexeu**. Num painel que cria promoção, muda preço
> e emite NF-e, *"quem aprovou este desconto de 50%"* precisa ter resposta. A coluna `papel` nasce
> para não exigir migração depois; a interface desta rodada não a usa.

> E toda exportação de lista com dado pessoal grava aqui **quem exportou e quando** — a exportação
> de pedidos hoje baixa a base inteira com CPF e e-mail quando as datas ficam vazias, sem
> confirmação, sem teto e sem auditoria.

---

## Como se sabe que a Onda 3 acabou

1. `npm --prefix backend test` passa, com contagem maior que a de hoje.
2. `rls.test.js` verde — inclusive a lista `PUBLICAS`, que precisa ganhar os nomes novos que forem
   mesmo públicos, e **só** esses.
3. `instalacao.test.js` verde, com a instalação regenerada.
4. Um `SELECT` como `anon` em `promocao_resgates`, `consentimentos`, `envios` e `admin_log`
   **falha**. É o teste que prova que nenhum vínculo com pessoa vazou.
5. Nada do checkout mudou de comportamento: as tabelas antigas continuam de pé e o código ainda as
   lê. A troca é da Onda 4.
