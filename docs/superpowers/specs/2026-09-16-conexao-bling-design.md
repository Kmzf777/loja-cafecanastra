# Conexão com o Bling pelo painel — desenho

Data: 2026-09-16
Estado: aprovado

## O problema

A integração com o Bling está **escrita por inteiro e nunca foi ligada**.
`blingClient.js` (405 linhas), `blingPedidos.js` (942), quatro rotas, a migração
0012, o bloco no modal do pedido e 22 casos de teste — tudo pronto. E
`BLING_ATIVO=false` com `BLING_CLIENT_ID`, `BLING_CLIENT_SECRET` e
`BLING_REFRESH_TOKEN` em **zero caracteres**, tanto no `.env` quanto no spec do
serviço no Swarm. Nenhum pedido jamais foi ao ERP.

Ligar hoje exige: criar o app no Bling, montar à mão a URL de autorização, pegar
um `code` que **expira em ~1 minuto**, trocá-lo por `curl`, colar três valores no
`.env` e redeployar. É um procedimento de seis passos onde um deles tem um
cronômetro de sessenta segundos, e ele está descrito num runbook que ninguém abre
no momento de aperto.

Some-se a isso: `docs/bling.md` descreve em detalhe uma tela `/dashboard/bling`
— cartão de status, fila paginada, filtros — que **não existe**. Ela não
sobreviveu à reescrita do painel (Onda 7, que apagou `frontend/legacy/`). O
runbook documenta uma tela fantasma, e quem seguir o §5 vai procurar um botão que
não está lá.

## O que esta entrega faz

Uma tela em `/dashboard/bling` que conecta a loja ao Bling sem `.env` e sem
deploy: cola-se Client ID e Secret, clica-se **Conectar**, autoriza-se no Bling, e
a loja volta conectada. Mais um interruptor liga/desliga e um botão Desconectar.

**Fica de fora, de propósito:** a fila de pedidos do runbook (trabalho bem maior,
e o bloco por pedido no modal de Pedidos já cobre o caso urgente), e os toggles
de `BLING_NFE_AUTO`/`BLING_RASTREIO_CRON` — que continuam em variável de
ambiente. O runbook manda ligá-los só depois do teste de R$ 1, o que os torna
decisão de uma vez na vida, não de tela.

## Decisões

### 1. Redirect de página inteira, não popup

O clique leva o navegador ao Bling e o callback traz de volta. A alternativa —
popup com `postMessage` — não sai da página, mas morre em bloqueador de popup e
acrescenta a origem da mensagem à lista de coisas para errar. Ganho estético,
risco real. A terceira alternativa (colar o `code` à mão) é exatamente o que esta
entrega existe para eliminar.

### 2. O callback é PÚBLICO, e o `state` é o que o protege

Todas as rotas de `/bling` hoje exigem `isAuthenticated + isAdmin`. O callback
**não pode**: é um redirect de navegador vindo do Bling, e redirect não carrega
cabeçalho `Authorization`. Não há como autenticá-lo pelo mecanismo do resto da
casa.

Sem proteção, qualquer um que descobrisse a URL poderia chamá-la com um `code`
da **própria conta Bling** e amarrar a loja ao ERP dele — o CSRF clássico de
OAuth. A defesa é o parâmetro `state`:

- gerado no clique em **Conectar**, que É autenticado (`POST /bling/conexao/iniciar`,
  admin);
- aleatório (32 bytes de `crypto.randomBytes`), guardado em memória com validade
  de **10 minutos** e **uso único** (consumido na primeira apresentação);
- o callback sem `state` vivo recusa **sem tocar em nada** e redireciona com erro.

Memória basta porque a API roda em **instância única**. Isso não é conveniência:
é requisito já documentado da integração — o rodízio do refresh token não tolera
dois processos (`docs/bling.md`, seção do token rotativo;
`deploy/ecosystem.config.cjs` fixa `instances: 1`; o Swarm fixa `replicas: 1`).

Se a API reiniciar entre o clique e o retorno, o nonce some e a tela diz "a
autorização expirou, clique em Conectar de novo". A janela é de ~30 segundos e a
falha é benigna. Um `state` assinado por HMAC sobreviveria ao restart, mas custa
código e um segredo novo para cobrir trinta segundos de risco de nada.

### 3. As credenciais vão para o banco, ao lado do refresh token

O refresh token já mora em `canastra.config_loja.bling_refresh_token` desde a
0012, e `carregarRefreshToken()` já lê na ordem **memória → banco → env**. Pôr
Client ID e Secret na mesma linha é seguir o caminho aberto, não abrir outro.

```sql
ALTER TABLE canastra.config_loja
  ADD COLUMN bling_client_id     text,
  ADD COLUMN bling_client_secret text,
  ADD COLUMN bling_ativo         boolean;
```

**As colunas nascem protegidas sem uma linha de REVOKE.** A 0012 revogou o
`SELECT` de tabela em `config_loja` e concedeu uma **lista explícita de colunas**
a `anon`/`authenticated`. Privilégio de coluna no Postgres não se estende a
coluna nova — então estas três já nascem invisíveis ao PostgREST. É a trava da
0012 pagando dividendo, e é o motivo de a migração não precisar repetir o
`REVOKE`.

**`bling_ativo` é NULLABLE, e NULL quer dizer "não decidido — use a env".**
Fosse `NOT NULL DEFAULT false`, o banco passaria a mandar em toda instalação no
instante da migração, e um `BLING_ATIVO=true` no `.env` de alguém viraria letra
morta em silêncio. Com NULL, quem nunca abrir a tela continua exatamente como
está — e os 22 testes existentes seguem passando sem tocar em nenhum deles.

Precedência em tudo: **banco → env**. É a ordem que o refresh token já usa; não é
regra nova.

### 4. O cron consulta `ativo` no tique, não no boot

`index.js:181` decide **no boot** se o cron de rastreio sobe. Com `ativo` no
banco, ligar pela tela não acordaria o cron sem restart — o interruptor mentiria
para o gestor.

O portão de boot continua sendo `BLING_RASTREIO_CRON` (env, que permanece fora
desta entrega). Quem consulta `ativo` passa a ser o **tique**, de hora em hora.
Assim o interruptor tem efeito imediato, e um cron ligado numa loja desconectada
simplesmente não faz nada.

### 5. O `authorize` mora em OUTRO host

Detalhe fácil de errar e caro de descobrir: a troca de token é em
`api.bling.com.br/Api/v3/oauth/token` (o que `baseDaApi()` devolve), mas a
autorização é em **`www.bling.com.br/Api/v3/oauth/authorize`**. Hosts diferentes.
Some-se que `baseDaApi()` é sobrescritível por `BLING_API_URL` para os testes
rodarem sem rede — a base da autorização precisa do mesmo tratamento
(`BLING_AUTORIZACAO_URL`), senão o teste do fluxo novo sai para a internet.

O `authorize` **não recebe `redirect_uri`**: o Bling usa a que está cadastrada no
app. Por isso a URL registrada tem de bater caractere por caractere.

## Arquitetura

### Banco — `0039_bling_config.sql`

As três colunas acima. Sem `REVOKE` (ver decisão 3), sem índice (linha única),
sem `NOT NULL`.

### Backend

**`blingClient.js`** ganha `carregarConfig()`: lê `client_id`, `client_secret`,
`ativo` e `refresh_token` de `config_loja`, com cache no mesmo objeto `memoria`
que já guarda o access token, invalidado na escrita. `configurado()` vira
`async` — são só duas chamadas, ambas dentro do próprio arquivo e já em contexto
`async` (`renovarAccessToken` e `sondar`). O Basic auth de `renovarAccessToken`
(linha 191) passa a vir da config, não de `process.env`.

**`blingConexao.js`** (serviço novo) concentra o fluxo OAuth: gerar e validar o
`state`, montar a URL de autorização, trocar o `code` pelo par de tokens, gravar.
Separado de `blingClient.js` porque é outro assunto — o cliente fala com a API já
autorizada; este estabelece a autorização. Separado de `blingPedidos.js` pelo
mesmo motivo, com folga.

**Rotas** (`bling.routes.js`):

| Rota | Quem pode | O que faz |
|---|---|---|
| `POST /bling/conexao/credenciais` | admin | grava Client ID e Secret; invalida o cache |
| `POST /bling/conexao/iniciar` | admin | gera o `state`, devolve a URL do Bling |
| `GET /bling/callback` | **público + `state`** | troca o `code`, grava o refresh token, redireciona 302 |
| `POST /bling/conexao/ativo` | admin | liga/desliga |
| `DELETE /bling/conexao` | admin | apaga o refresh token e desliga |

`GET /bling/status` ganha campos (`temCredenciais`, `conectado`) — **nunca**
devolve segredo, só veredictos. O `blingLigado` passa a consultar a config.

### Frontend

`app/dashboard/(protegido)/bling/page.tsx`, com a lógica testável extraída para
`lib/painel/bling/conexao.logica.ts` — o mesmo corte que `contrato.ts` já faz
(lógica sem React nem fetch, testada sozinha).

Item novo no `MENU` de `components/painel/casca/menu.logica.ts`, grupo
**Gerir**, ao lado de Ajustes: é configuração que se mexe raramente.

Três estados, um por vez:

1. **Sem credenciais** — formulário de Client ID e Secret, com os escopos e a URL
   de callback à vista (é o que se cola no Bling).
2. **Credenciais salvas, não conectado** — botão **Conectar**.
3. **Conectado** — selo verde, quando renovou pela última vez, interruptor
   liga/desliga, botão **Desconectar**.

O retorno do callback chega como `?conectado=1` ou `?erro=<frase>`, e a tela
mostra a frase **inteira** do servidor — a mesma regra de `fraseDeErro` em
`contrato.ts`: o diagnóstico está na frase, e trocá-la por "erro ao conectar"
joga fora o que resolve o problema.

Reaproveita `Ficha`, `Selo`, `Botao`, `Tarja` e `EstadoDaTela` de
`components/painel/ui/`.

## Testes

O arquivo novo `backend/test/f8_bling_conexao.test.js` segue o padrão de
`f7_bling.test.js` (`embedded-postgres` + `fetchImpl` injetado, sem rede):

- `state` inválido, expirado e reapresentado são recusados, e nada é gravado;
- `code` trocado com sucesso grava o refresh token e liga a conexão;
- erro do Bling na troca volta legível, e a conexão não fica meio-feita;
- precedência banco → env em `carregarConfig()`, incluindo `ativo` NULL caindo
  na env;
- `DELETE /bling/conexao` apaga o token e desliga;
- as rotas de admin recusam sem sessão e sem papel.

Frontend: `conexao.logica.test.ts` para a lógica de estados e a leitura do
`?erro=`.

Os 22 casos de `f7_bling.test.js` devem continuar passando **sem alteração** —
é o critério que valida a decisão do NULL (3).

## Custo operacional a resolver antes de subir

**A migração não entra sozinha.** `deploy/deploy.sh` só roda `npm run db:migrar`
se existir `deploy/.env.migracao` nesta VPS — e ele **não existe**. Hoje o deploy
detecta migração nova, imprime um aviso e segue. Subir o código sem aplicar a
0039 deixa a tela batendo em coluna inexistente.

Duas saídas, e é decisão do Rafael: criar o `deploy/.env.migracao` (e o deploy
passa a aplicar migração sozinho, para sempre — resolve a lacuna, não só esta
migração), ou aplicar a 0039 à mão contra o Supabase Cloud. A segunda é DDL em
produção. **Pendente.**

## Fora de escopo, registrado para não se perder

- A fila de pedidos de `/dashboard/bling` que o runbook descreve e não existe.
- Os 29 SKUs no Bling (§3 do runbook): pré-requisito da **sincronização**, não da
  conexão. Dá para conectar e validar o token sem eles.
- `docs/bling.md` descreve a tela fantasma no presente; atualizar o runbook é
  parte da entrega, mas a fila continuará descrita como ausente.
