# Dados pessoais no repositório — o que foi removido e o que ainda falta

Data: 2026-08-16

## O que havia

Onze arquivos `.csv` estavam versionados na raiz do repositório. Eram um dump
do banco de produção da loja anterior (**Shopnaw**, de camisetas), de onde este
projeto foi bifurcado. Não eram dados de exemplo:

| Arquivo | Continha |
|---|---|
| `usuarios.csv` | 2 pessoas reais: nome completo, e-mail, telefone e **hash bcrypt da senha** |
| `addresses.csv` | 2 endereços residenciais completos, com rua, número, bairro, cidade e CEP |
| `pedidos.csv` | 3 pedidos com `address_json` — endereço de entrega repetido dentro do JSON |
| `refresh_tokens.csv` | **34 refresh tokens JWT reais**, assinados com o segredo da loja antiga |
| `carts.csv`, `cart_items.csv`, `password_resets.csv`, `promotions.csv`, `product_options.csv`, `produtos.csv`, `store_config.csv` | Dados operacionais da loja antiga, incluindo tokens de redefinição de senha |

Dado pessoal de terceiros num repositório é tratamento de dado sem base legal
(LGPD, art. 7º) e, no caso dos hashes e dos refresh tokens, também é material
diretamente utilizável para ataque.

## O que foi feito

1. Os onze arquivos saíram do controle de versão (`git rm --cached`) e foram
   **apagados do disco**. Numa primeira passada eles tinham sido apenas movidos
   para `.dumps-antigos/`, dentro da própria árvore do projeto — o que resolvia
   o versionamento e não resolvia nada mais: os dados continuavam em texto
   claro dentro de qualquer `tar`, `zip` ou `rsync` do diretório. Dado pessoal
   que não precisa existir não deve ficar guardado "por precaução".
2. `*.csv` e `.dumps-antigos/` entraram no `.gitignore` para o caso não se
   repetir por descuido.
3. O conhecimento que esses arquivos carregavam — a **estrutura** das tabelas —
   foi preservado sem os dados. Ele vivia em `backend/db/schema.sql`; desde a
   migração para o Supabase self-hosted vive em
   `backend/db/migrations/NNNN_*.sql`, que documentam de onde cada coluna veio e,
   diferente do arquivo antigo, também registram cada alteração posterior.

## O que AINDA FALTA — ação de quem administra o repositório

**Remover do diretório de trabalho não apaga do histórico do Git.** Os arquivos
continuam recuperáveis em qualquer commit anterior a esta mudança, e continuam
no GitHub. Para fechar de verdade, é preciso, nesta ordem:

1. **Reescrever o histórico** removendo os arquivos de todos os commits, com
   [`git filter-repo`](https://github.com/newren/git-filter-repo):

   ```bash
   git filter-repo --invert-paths \
     --path usuarios.csv --path addresses.csv --path pedidos.csv \
     --path refresh_tokens.csv --path password_resets.csv --path carts.csv \
     --path cart_items.csv --path promotions.csv --path product_options.csv \
     --path produtos.csv --path store_config.csv
   ```

   Isso reescreve os SHAs: exige `push --force` e que todo mundo com clone
   refaça o clone. Por ser destrutivo e afetar quem mais estiver no repositório,
   **não foi executado automaticamente** — é decisão de quem administra.

   > **Atualização 2026-08-20:** o roteiro acima virou script pronto, com
   > clone espelho, guarda interativa dupla e conferência pós-reescrita:
   > `scripts/reescrever-historico.sh`. Continua **não executado** — ver a
   > seção "LGPD — Onda 3H" no fim deste documento.

2. **Invalidar o que vazou**, porque o histórico ficou público enquanto existiu.
   Enquanto o item 1 não for feito, `git show <commit>:usuarios.csv` continua
   devolvendo os dados hoje, em qualquer clone:
   - Trocar `JWT_SECRET_REFRESH` da loja antiga, se ainda estiver em uso em
     algum ambiente — os 34 tokens do dump foram assinados com ele.
   - Forçar redefinição de senha das duas contas do `usuarios.csv`.
   - Invalidar os tokens de `password_resets.csv`.

3. **Se o repositório já foi público em algum momento**, considerar os dados
   comprometidos e comunicar os titulares, conforme o art. 48 da LGPD.

## Regra daqui pra frente

Dump de banco não entra no repositório. Para reproduzir o ambiente, use
`npm run db:setup` (`backend/db/migrar.js` + `backend/db/seed.js`), que cria um
banco completo com o catálogo real do Café Canastra e **nenhum dado pessoal**.

---

# Newsletter — decisão de tratamento (single opt-in)

Data: 2026-08-20 (Onda 2F — motor de vendas)

A loja passou a coletar e-mail no rodapé (`POST /newsletter` →
`canastra.newsletter_inscritos`, migração 0011). O registro da decisão, com o
risco assumido por escrito:

## O que se coleta e sob qual base

Só o e-mail e a origem da inscrição (`origem`, hoje sempre `rodape`), com
`criado_em`. Nada mais — nem nome, nem IP, nem user agent. Base legal:
consentimento (LGPD art. 7º, I) manifestado pelo envio do formulário; o texto
do rodapé diz o que a pessoa vai receber e não promete frequência.

## A decisão: single opt-in, e o risco que ela carrega

A inscrição vale **no ato**, sem e-mail de confirmação (*single opt-in*).
Consequência conhecida: **qualquer pessoa pode inscrever o e-mail de um
terceiro**, que passaria a receber comunicação que nunca pediu — em nome da
loja. Foi uma escolha de fase, não um esquecimento: no momento da implantação
o domínio de envio ainda nem está verificado no Resend (nenhum e-mail de
confirmação PODERIA sair), e um double opt-in quebrado inscreveria ninguém.

Mitigações em vigor:

- **Rate limit de 10/min por IP** na rota — inscrição em massa de e-mails
  alheios deixa de ser um laço barato (`backend/src/routes/newsletter.routes.js`).
- **Anti-enumeração**: a resposta é `{ ok: true }` para inscrito novo E
  repetido — a rota não serve de oráculo de "este e-mail está na lista".
- **Validação + CHECK de formato** (`newsletter_email_formato`, 0011): lixo
  não entra nem por caminho que escape da rota.
- **RLS ligada sem política + REVOKE** na tabela: a lista não é legível por
  PostgREST com chave nenhuma; só o serviço Node a lê.

## Atualização 2026-08-21 (Onda 4) — a SAÍDA da lista passou a existir

A captação nasceu sem saída: havia `POST /newsletter` e nada mais. Duas coisas
que a loja já prometia por escrito não tinham implementação nenhuma, e as duas
foram fechadas nesta onda:

1. **`POST /newsletter/descadastrar`** — rota pública, `{ email }`, resposta
   sempre `{ ok: true }` para e-mail válido (a MESMA disciplina
   anti-enumeração do cadastro: distinguir "apaguei" de "não estava lá"
   transformaria a saída no oráculo que a entrada recusa ser). E-mail
   malformado continua sendo o único 400, porque fala do FORMATO, não da
   lista. Casa por `lower(email)` dos dois lados, como a exportação do titular
   — o UNIQUE de 0011 é sensível a caixa e o e-mail não é. Teto próprio de
   10/min por IP, em **balde separado** do cadastro: com balde único, um laço
   de inscrições esgotaria o limite e quem estivesse atrás do mesmo IP perderia
   o direito de SAIR por causa do abuso alheio.
   A superfície é o formulário na `/politica-de-privacidade`
   (`frontend/components/layout/FormDescadastroNewsletter.tsx`), ao lado da
   frase que promete a retirada — mesmo desenho do "Rever cookies".
2. **A exclusão de conta apaga a inscrição** — `conta.routes.js`, nas duas
   rotas (`DELETE /auth/users/me` e `DELETE /auth/users/:id`), como passo 5 da
   ordem, ANTES do DELETE no GoTrue. A tabela não tem `user_id`: o vínculo é o
   e-mail, e o e-mail mora em `auth.users`, que é o que o GoTrue apaga —
   depois dele ninguém mais consegue dizer de quem era aquela linha, e o
   endereço de quem pediu para sumir do banco ficaria na lista para sempre. É
   a mesma mecânica do pedido irredigível, com a mesma disciplina: falha
   aborta a exclusão (500) e nada é apagado. Titular sem e-mail (a segunda
   tentativa de uma exclusão que falhou no fim) não é erro — não há o que
   casar, e travar ali impediria a exclusão de terminar.

### A decisão sobre o token de descadastro, e o risco que ela carrega

O padrão de mercado é descadastro por **link assinado** no rodapé de cada
campanha: só quem recebeu o e-mail o descadastra, e ninguém tira terceiro da
lista. A rota simples aceita qualquer e-mail de qualquer pessoa — **um script
pode descadastrar todo endereço que conheça**. Ela foi escolhida assim mesmo,
por três razões escritas aqui para poderem ser contestadas depois:

- **Não há campanha saindo.** Só o transacional sai da loja (status de pedido,
  lembrete de sacola); a lista existe e não é usada para envio. Não existe,
  hoje, e-mail em que o link assinado pudesse viajar — o token nasceria sem
  portador.
- **O dano é simétrico ao do single opt-in já assumido acima.** Lá se inscreve
  terceiro, aqui se descadastra terceiro; nos dois casos o desfecho é uma linha
  a mais ou a menos numa tabela que não dispara nada. O lado do descadastro é
  ainda o menos gravoso: ninguém recebe comunicação que não pediu.
- **O remédio é o mesmo trabalho.** A tarefa que ligar campanha tem de fazer
  double opt-in E link assinado de descadastro em todo envio (obrigatório de
  qualquer forma) — é lá que o token nasce, junto do e-mail que o carrega.

Mitigação em vigor enquanto isso: o teto de 10/min por IP no balde próprio.
Aceito porque um descadastro indevido é reversível pela própria pessoa (o
formulário do rodapé), diferente de um vazamento.

## Pendência recomendada (para a tarefa que ligar o envio de campanhas)

**Double opt-in** assim que houver domínio verificado no Resend: e-mail de
confirmação com token, coluna `confirmado_em` (nova migração — a 0011 não se
edita depois de aplicada), e campanha só para confirmados. Junto dele, **link
de descadastro assinado em toda campanha** — que é onde a rota
`POST /newsletter/descadastrar` deixa de bastar sozinha: com campanha no ar,
ela precisa passar a aceitar TAMBÉM um token por e-mail, e o formulário aberto
vira o caminho secundário. Fecham o pacote a limpeza dos nunca-confirmados após
prazo curto. Enquanto a lista não recebe campanha nenhuma — que é o estado
atual — o risco fica limitado a existir uma linha a mais (ou a menos) na
tabela.

---

# LGPD — Onda 3H: redação de dados nos pedidos e preparo da reescrita

Data: 2026-08-20

## O problema que esta onda fechou

Apagar um cliente (`DELETE /auth/users/me` → GoTrue → cascade em
`canastra.clientes`) preserva a venda de propósito (`pedidos.user_id` vira NULL
— ON DELETE SET NULL, 0005: pedido é registro fiscal), mas **nome, CPF,
telefone e endereço completos sobreviviam congelados em
`pedidos.endereco_json`**. "Excluir a conta" nunca excluía os dados da pessoa,
e um pedido de titular (LGPD art. 18) não era atendível. Pior: uma vez órfão,
o pedido perde o vínculo — não há mais como saber de quem era, e o dado fica
**irredigível para sempre**.

## O que foi entregue

1. **Redação no banco** — migração `0013_redacao_lgpd.sql`:
   `canastra.redigir_dados_do_titular(uuid)` redige, em todos os pedidos do
   titular, tudo que identifica a pessoa (por **whitelist**: só cidade, UF e o
   prefixo do CEP — 3 dígitos + `xxxxx` — sobrevivem, para estatística de
   venda por região; total, status e itens de produto ficam, porque são a
   venda). Cobre os dois vocabulários de chave que já passaram pela loja
   (inglês da vitrine atual, português do legado). Idempotente e auditável:
   coluna nova `pedidos.redigido_em` carimba a primeira redação e impede a
   segunda de mover o carimbo. Titular NULL é **erro**, nunca no-op — ver o
   cabeçalho da migração.
2. **A redação alcança TUDO que congela dado pessoal** — migração
   `0016_redacao_ampliada.sql`: as ondas irmãs criaram mais duas fotografias
   que a 0013 não via. `assinaturas.endereco_json` (0015, o endereço congelado
   na adesão do Clube) passa a ser redigido — **só nas assinaturas
   `cancelada`**, porque enquanto a entrega recorrente existe o endereço é o
   que executa o contrato (art. 16, I); e `avaliacoes.nome_exibicao` (0014, o
   nome do autor, **público na PDP**) vira `Cliente Canastra` — nota e texto
   ficam, que são prova social, não dado pessoal. A whitelist de endereço
   virou a função `canastra.redigir_endereco(jsonb)`, uma só para os dois
   consumidores e para o SQL manual do fim deste documento.
3. **A exclusão de conta CANCELA, REDIGE e só então APAGA** — `conta.routes.js`
   (as duas rotas: `/auth/users/me` e `/auth/users/:id`), nesta ordem:
   trava do último admin → credencial do GoTrue → **cancelar as assinaturas
   vivas** (`ClubeController.cancelarAssinaturasDoTitular`: cancela no Mercado
   Pago e marca `cancelada`) → **redigir** → DELETE no GoTrue. **Falha em
   qualquer um dos dois passos do meio aborta a exclusão e nada é apagado**
   (502 na recusa do MP, 500 na falha da redação).
   - *Cancelar antes de redigir* não é ordem arbitrária: a redação só alcança
     assinatura `cancelada`, então cancelar primeiro é o que a faz chegar ao
     endereço da assinatura na mesma passagem.
   - *Nunca apagar sem cancelar*: `assinaturas.user_id` é ON DELETE SET NULL,
     e um preapproval órfão continua **cobrando o cartão** de quem pediu para
     sumir do banco, sem dono para cancelá-lo.
   - *Atualização da Onda 4*: a ordem ganhou um passo antes do DELETE —
     **apagar a inscrição na newsletter** (o vínculo daquela tabela é o
     e-mail, que some com `auth.users`). Ver a seção da newsletter acima.
   - *O troco assumido*: se o GoTrue falhar no fim, sobra conta viva com
     assinaturas canceladas e pedidos redigidos — reversível no que importa
     (assinar de novo é um clique) e re-executável (a redação repetida é no-op
     por `redigido_em`, o cancelamento repetido devolve lista vazia, e a
     segunda tentativa conclui). O troco inverso não é reversível em nada.
4. **Atendimento a titular pelo painel** — `backend/src/routes/lgpd.routes.js`
   (admin): `GET /lgpd/titulares/:userId/dados` (acesso/portabilidade — conta,
   cadastro, endereços, pedidos, assinaturas, avaliações e a inscrição na
   newsletter, esta casada por e-mail; a completude é o requisito do art. 18,
   e a próxima tabela com dado pessoal tem de entrar nessa lista) e
   `POST /lgpd/titulares/:userId/redigir` (eliminação parcial: redige SEM
   apagar a conta; quem disparou fica no log). 404 uniforme para quem não é
   cliente desta loja — o endpoint não é oráculo sobre o `auth.users`
   compartilhado.
5. **Script de reescrita do histórico pronto** —
   `scripts/reescrever-historico.sh`: clone espelho fresco,
   `git filter-repo --invert-paths` com os 11 caminhos (conferidos contra o
   histórico real: todos na raiz, commit `5ddcb71`; `.dumps-antigos/` nunca
   foi commitado), guarda interativa dupla (digitar o nome do repositório, e
   de novo para o push), conferência pós-reescrita e o checklist de
   invalidação impresso por `trap` (sai mesmo se o push falhar — é quando ele
   mais faz falta). O push empurra `refs/heads/*` e `refs/tags/*` explícitos,
   nunca `--mirror`: um clone espelho do GitHub traz as refs de pull request,
   que são *hidden refs* do lado de lá e fariam o push inteiro ser recusado.
   **Não foi executado.**
6. **Testes** — `backend/test/f7_lgpd.test.js` (20 casos): o que fica, o que
   sai, as formas inesperadas de `endereco_json` (lista, escalar, `{}`, JSON
   null, SQL NULL, CEP impresentável), idempotência, recusa do NULL, a ordem
   cancelar→redigir→apagar, o aborto na recusa do MP e na falha da redação, o
   retry depois de um GoTrue caído, a exportação completa e os 404 uniformes.

## O que SEGUE pendente — ação de quem administra (humana, fora do repo)

1. **Executar a reescrita**: `bash scripts/reescrever-historico.sh` (exige
   `git filter-repo` instalado e credencial de push). Depois: todo mundo
   reclona; se for GitHub, pedir ao suporte a limpeza de objetos órfãos e
   caches de forks/PRs.
   **E fechar a porta de volta**: enquanto alguém ainda tiver o clone antigo,
   um `git push` de branch baseada no histórico pré-reescrita **devolve todos
   os blobs ao servidor** e desfaz o trabalho sem ninguém perceber. Proteja os
   branches / bloqueie push até que todos confirmem ter reclonado, e quem
   tiver trabalho local transplanta com
   `git rebase --onto <novo-main> <base-antiga> <branch-local>` (nunca `pull`
   nem `merge`).
2. **Invalidar o que vazou** (o script imprime o mesmo checklist):
   `JWT_SECRET_REFRESH` da loja antiga, redefinição de senha das 2 contas de
   `usuarios.csv`, tokens de `password_resets.csv`.
3. **Se o repositório foi público em algum momento**: comunicar os titulares
   e avaliar comunicação à ANPD (art. 48).

## Órfãos pré-existentes: decisão e SQL pronto

A redação por titular NÃO alcança a linha que **já** estava órfã antes desta
onda (o vínculo se foi junto com a conta — `user_id` NULL não pertence a
ninguém, e a função exige um titular). Se o banco de **produção** tiver
alguma, é redação manual, única, em massa — como `postgres`, no editor SQL.

Duas tabelas entram aqui: `pedidos` (o caso antigo, que existe desde 2024) e
`avaliacoes` (0014 — `nome_exibicao` é o nome **público na PDP**, e uma
avaliação de conta já apagada continuaria estampando o nome de alguém na
vitrine). `assinaturas` não tem órfão pré-existente — a tabela nasceu nesta
mesma leva, e daqui pra frente a exclusão de conta cancela e redige antes de
apagar.

```sql
-- 1. Medir os pedidos órfãos. Se vier 0, pule para o passo 4.
SELECT count(*) AS orfaos_nao_redigidos
  FROM canastra.pedidos
 WHERE user_id IS NULL AND redigido_em IS NULL;

-- 2. Olhar os itens antes (no formato atual só há produto; se aparecer campo
--    pessoal dentro de um item, redigi-lo com a mesma denylist da 0013):
SELECT pedido_id, itens
  FROM canastra.pedidos
 WHERE user_id IS NULL AND redigido_em IS NULL;

-- 3. Redigir os endereços e carimbar. `canastra.redigir_endereco` (0016) é a
--    MESMA função que o fluxo por titular usa — chamá-la aqui, em vez de
--    copiar a whitelist para dentro deste documento, é o que garante que o
--    órfão e o não-órfão sejam redigidos pela mesma regra para sempre:
UPDATE canastra.pedidos p
   SET endereco_json = CASE
         WHEN p.endereco_json IS NULL THEN p.endereco_json
         ELSE canastra.redigir_endereco(p.endereco_json)
       END,
       redigido_em   = now(),
       atualizado_em = now()
 WHERE p.user_id IS NULL
   AND p.redigido_em IS NULL;

-- 4. AVALIAÇÕES ÓRFÃS — `avaliacoes.nome_exibicao` (0014) é o nome congelado
--    no INSERT e PÚBLICO: `anon` tem GRANT de SELECT nessa coluna e a PDP a
--    exibe. Uma avaliação de conta já apagada continua estampando o nome da
--    pessoa na vitrine da loja, indefinidamente. Medir e redigir:
SELECT count(*) AS avaliacoes_orfas_com_nome
  FROM canastra.avaliacoes
 WHERE user_id IS NULL AND nome_exibicao <> 'Cliente Canastra';

--    O placeholder é 'Cliente Canastra' e não "[redigido]" pelo mesmo motivo
--    da 0016: a coluna é vitrine, e um colchete técnico no lugar do autor
--    viraria curiosidade pública. Nota e texto NÃO são tocados (prova social),
--    e `moderado_em` também não — redação não é moderação. O próprio predicado
--    é a idempotência: rodar duas vezes não acha linha na segunda.
UPDATE canastra.avaliacoes
   SET nome_exibicao = 'Cliente Canastra'
 WHERE user_id IS NULL
   AND nome_exibicao <> 'Cliente Canastra';
```

Daqui pra frente o caso não se repete: a exclusão de conta cancela, redige e
só então apaga, então **todo órfão novo já nasce redigido**.

### O limite conhecido: assinatura cancelada DEPOIS de uma redação parcial

A redação só alcança assinatura `cancelada` (o endereço de uma assinatura viva
é o que executa o contrato). Então há uma janela: titular que pede a
eliminação parcial (`POST /lgpd/titulares/:id/redigir`) hoje, com assinatura
ativa, e cancela a assinatura amanhã fica com o endereço da adesão em
`assinaturas.endereco_json` até a **próxima** redação daquele titular. Não é
órfão — o vínculo continua lá, e qualquer nova redação (parcial ou pela
exclusão de conta) fecha a pendência. Se o atendimento a um titular específico
exigir fechar a janela na hora, basta repetir o `POST .../redigir` depois do
cancelamento. Uma varredura periódica seria a solução definitiva; não foi
escrita porque o volume de assinaturas ainda não a justifica — quando
justificar, ela é um `SELECT` por `status = 'cancelada' AND redigido_em IS
NULL` chamando a mesma função.

# Atualização 2026-08-22 — o rastro de WhatsApp entrou na redação (0021)

`canastra.whatsapp_mensagens` (0017) **não** era alcançada por
`redigir_dados_do_titular`, e a tabela guarda mais dado pessoal do que o nome
das colunas sugere: **o miolo do `wamid` em base64 é o telefone do cliente em
texto claro**. Depois de uma exclusão de conta, aquela linha ficava com o
`user_id` da pessoa, o `telefone_final`, um `pedido_id` válido e o telefone
inteiro dentro do `wamid` — ou seja, o elo pessoa↔pedido que o `ON DELETE SET
NULL` de 0005 existe para cortar voltava a ser reconstruível com um `SELECT`.

Não era vulnerabilidade — a tabela tem RLS ligada sem política e `REVOKE ALL
FROM authenticated` (0017), e nenhum handler lê `wamid` —, era **retenção
indevida depois de um pedido de eliminação** (art. 18, VI).

`0021_redacao_whatsapp.sql` estende a mesma função: `wamid`, `telefone_final` e
`user_id` viram NULL na primeira redação do titular. **Idempotência pelo próprio
predicado**, sem coluna de carimbo nova — a redação apaga a coluna pela qual se
procura, então a segunda passagem não acha linha (a mesma decisão que a 0016
tomou para `avaliacoes.nome_exibicao`).

**O que fica**: `pedido_id`, `template`, `status`, os carimbos e o `erro_texto`.
Sem `user_id` e sem `wamid` a linha não aponta para pessoa nenhuma — é o
registro de que a loja avisou aquele pedido, do mesmo naipe do total e do status
que a 0013 preserva em `pedidos`.

**O troco**: depois da redação aquele rastro some da exportação de titular
(`lgpd.routes.js` filtra por `user_id`). Na exclusão total é indiferente — a
conta some no mesmo gesto. Na eliminação **parcial** é uma perda real: a pessoa
deixa de conseguir listar as mensagens que já recebeu. É o que "eliminar"
significa, e está escrito no cabeçalho da 0021 e no comentário daquela rota.

A migração leva junto um índice barato —
`whatsapp_mensagens_pedido_template_idx`, `UNIQUE (pedido_id, template) WHERE
status <> 'falhou'` — que põe no banco a guarda de aviso duplicado que só
existia em `notificacoes.js:jaAvisado()`. Não corrige defeito nenhum de hoje (os
cenários concretos de corrida foram refutados); transforma "por convenção" em
"pelo banco". O `23505` dele é tratado como "já avisado", nunca como erro.
