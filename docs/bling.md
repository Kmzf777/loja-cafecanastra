# Bling — runbook da integração (pedido de venda, NF-e e rastreio)

O que a integração faz, uma linha por peça:

- **Pedido aprovado → pedido de venda no Bling**, sozinho (gatilho no webhook
  e no checkout), idempotente por `pedidos.bling_id` — nunca duplica.
- **NF-e** gerada e transmitida a partir do pedido de venda: pelo botão
  **Emitir NF-e** do painel, ou automática junto da sincronização com
  `BLING_NFE_AUTO=true`.
- **Rastreio** preenchido no Bling volta para a loja: grava
  `codigo_rastreio`, avança o pedido para `enviado` e dispara o e-mail com o
  código ao cliente. Pelo botão **Buscar rastreio** do painel, ou de hora em
  hora com `BLING_RASTREIO_CRON=true`.
- Tudo atrás de `BLING_ATIVO=true`. **Nenhuma falha do Bling derruba checkout
  ou webhook**: o pior caso é `bling_id` nulo + uma linha de log, e o botão
  **Sincronizar** do painel refaz o que faltou.

Variáveis: `BLING_ATIVO`, `BLING_CLIENT_ID`, `BLING_CLIENT_SECRET`,
`BLING_REFRESH_TOKEN`, `BLING_NFE_AUTO`, `BLING_RASTREIO_CRON` — todas
documentadas em `backend/src/.env.example`.

---

## Onde ficam os botões, no painel da loja

Duas telas, e as MESMAS três ações nas duas:

**`/dashboard/bling`** — no menu lateral, em *Gestão de pedidos* → **"Bling:
NF-e e rastreio"**. É a tela de trabalho:

- **Status da integração** (a leitura de `GET /bling/status`): se a integração
  está ligada, se as credenciais estão presentes, se o token está renovando —
  com a frase do erro quando não está —, e se NF-e automática e busca de
  rastreio automática estão ativas. Com a integração desligada, a tela diz
  isso em azul (não é erro: é o estado de fábrica) e aponta este documento.
  O botão **Conferir de novo** re-sonda sem recarregar a página.
- **Fila de pedidos** — só os pedidos **pagos** (aprovado, enviado, entregue),
  cada um com o estado no ERP: `Não sincronizado`, `Sincronizando…`,
  `Pedido <id>` (está no Bling, sem nota), `NF-e <n> não transmitida` (o caso
  do §7 — laranja, porque parece resolvido e não está) ou `NF-e <n>` com o
  link do DANFE. O seletor **Mostrar** filtra por *Pendentes no Bling*, *Sem
  pedido de venda*, *Sem NF-e autorizada*, *Sem rastreio* ou *Todos*.
  A fila é paginada (50 por página) e **o filtro olha só a página carregada** —
  a própria tela avisa em que página está e quantos pedidos existem no total.
- **Três botões por pedido**: **Sincronizar**, **Emitir NF-e** e **Buscar
  rastreio**. Um clique tranca os três daquele pedido até a resposta chegar
  (nada duplica por duplo clique), e a linha se atualiza sozinha com o que o
  servidor devolveu. Quando o servidor recusa, **a frase dele aparece
  inteira** — é o diagnóstico, não um "erro genérico": o SKU que falta, a
  variável a ligar, o que fazer com a nota pendente. "Buscar rastreio" fica
  desabilitado enquanto o pedido não tiver pedido de venda no Bling.

**Pedidos → botão de detalhes (👁) de um pedido** — o mesmo bloco
**"Bling (ERP e NF-e)"** dentro do modal, com a situação, o link do DANFE e os
mesmos três botões. É onde a maioria dos problemas é percebida: o gestor abriu
o pedido para conferir e viu que a nota não saiu.

Ambas as telas exigem conta de **administrador** (é o mesmo `isAdmin` das
rotas). Nada aqui é destrutivo: as três ações são idempotentes do lado do
Bling.

---

## 1. Criar o aplicativo no Bling

1. Entre em <https://developer.bling.com.br> **com a conta Bling da loja**
   (Cadastro de aplicativos → Criar aplicativo).
2. Preencha nome ("Loja oficial Café Canastra") e uma **URL de redirecionamento**
   — pode ser `https://loja.cafecanastra.com/` mesmo; ela só recebe o `code`
   uma vez, no passo 3.
3. **Escopos necessários** (marque leitura E escrita onde houver):
   - **Contatos** — a sincronização busca o cliente por CPF e cria quando não
     existe.
   - **Produtos** — cada SKU do pedido é conferido lá antes de criar qualquer
     coisa (leitura basta).
   - **Pedidos de Venda** — criação do pedido e leitura do rastreio.
   - **Notas Fiscais Eletrônicas (NF-e)** — gerar, enviar e consultar a nota.
4. Salve e copie o **Client ID** e o **Client Secret** para
   `BLING_CLIENT_ID`/`BLING_CLIENT_SECRET` no `.env` do backend.

## 2. Obter o primeiro refresh token

O Bling usa OAuth 2.0 com autorização única no navegador:

1. Abra (trocando `SEU_CLIENT_ID`):

   ```
   https://www.bling.com.br/Api/v3/oauth/authorize?response_type=code&client_id=SEU_CLIENT_ID&state=canastra
   ```

2. Autorize com a conta da loja. O navegador volta para a URL de
   redirecionamento com `?code=XXXX` — copie o `code` (ele expira em ~1 minuto,
   então já deixe o passo 3 pronto).
3. Troque o `code` pelo par de tokens (o `-u` é `client_id:client_secret`):

   ```sh
   curl -s -X POST https://api.bling.com.br/Api/v3/oauth/token \
     -u "SEU_CLIENT_ID:SEU_CLIENT_SECRET" \
     -H "Content-Type: application/x-www-form-urlencoded" \
     -d "grant_type=authorization_code&code=XXXX"
   ```

4. Da resposta, cole o `refresh_token` em `BLING_REFRESH_TOKEN` e ligue
   `BLING_ATIVO=true`. O `access_token` da resposta pode ser ignorado — o
   serviço renova sozinho.
5. Confira no painel, em **`/dashboard/bling`** → cartão *Status da
   integração*: **Token: ligado — renovando normalmente**. (É a leitura de
   `GET /bling/status`, que também responde por `curl` com o token de admin.)

### O refresh token é ROTATIVO — leia isto antes de estranhar o .env

A cada renovação (o access token dura 6 horas), o Bling **invalida o refresh
token usado e devolve um novo**. Guardá-lo só no `.env` mataria a integração
no primeiro restart depois da primeira renovação. Por isso:

- O serviço **grava o token novo em `canastra.config_loja.bling_refresh_token`
  a cada renovação** e passa a usá-lo dali (memória → banco → env, nesta
  ordem). A coluna é protegida por privilégio de coluna (migração 0012): nem a
  chave anônima nem token de usuário a leem pelo PostgREST.
- `BLING_REFRESH_TOKEN` no `.env` vale só como **semente da primeira
  autorização**. Depois da primeira renovação ela fica obsoleta — o log avisa
  com destaque (`🔑 BLING: refresh token RENOVADO...`) e você pode limpá-la.
- **Limitação conhecida**: se a gravação no banco falhar (banco fora do ar no
  instante da renovação), o processo segue com o token da memória, mas um
  restart antes da próxima gravação bem-sucedida perde a autorização — o log
  grita exatamente isso. Nesse caso, refaça a seção 2 (novo `code`, novo
  refresh token) e atualize a env OU grave direto na coluna:

  ```sql
  UPDATE canastra.config_loja SET bling_refresh_token = 'NOVO_TOKEN' WHERE id = 1;
  ```

- **UMA instância do backend, e só uma.** O rodízio do refresh token não
  tolera dois processos: cada renovação invalida o token do outro, e em pouco
  tempo os dois recebem `invalid_grant` — a integração morre inteira, sem que
  nada no log aponte para o número de instâncias. O `deploy/ecosystem.config.cjs`
  já fixa `instances: 1` para a API (não troque para `cluster`/`max`), e o
  mesmo vale para rodar a API local contra a MESMA conta Bling da produção:
  não rode. Se precisar testar, use uma conta/aplicativo Bling separado.
  (O serviço faz o que pode do lado de cá: em `invalid_grant` ele **esquece o
  token da memória**, para a tentativa seguinte recomeçar do banco em vez de
  insistir com um token queimado até alguém reiniciar o processo.)
- Tokens **nunca aparecem em log** — se um log parecer conter um, é bug:
  reporte. Pelo mesmo motivo, as mensagens de erro do Bling citam só o método e
  o **caminho** da chamada, nunca a URL completa: a busca de cliente é
  `GET /contatos?numeroDocumento=<CPF>`, e CPF não vai para log.

## 3. Pré-requisito: os 29 SKUs cadastrados no Bling

**A sincronização casa os itens por SKU** (campo "Código" do produto no
Bling). Um SKU do pedido que não exista no Bling **para a sincronização com
erro legível** (nada é criado pela metade) — item sem vínculo de produto não
movimentaria o estoque de lá e mentiria em silêncio.

Cadastre (Cadastros → Produtos → Novo, ou importação por planilha) cada
produto com o campo **Código = SKU exatamente como abaixo** (minúsculas e
hífens; o casamento é exato). Tabela gerada de `data/catalogo-canastra.json`,
a fonte única do catálogo:

| SKU (campo "Código" no Bling) | Produto | Preço na loja |
|---|---|---|
| `classico-graos-250` | Café Especial Canastra Clássico em Grãos - Pacote com 250 gramas | R$ 39,70 |
| `classico-graos-500` | Café Especial Canastra Clássico em Grãos - Pacote com 500 gramas | R$ 65,70 |
| `classico-graos-1000` | Café Especial Canastra Clássico em Grãos - Pacote com 1 quilograma | R$ 109,90 |
| `classico-graos-caixa-4x500` | Café Especial Canastra Clássico em Grãos - Caixa com 4 pacotes de 500 gramas | R$ 236,70 |
| `classico-moido-250` | Café Especial Canastra Clássico Moído - Pacote com 250 gramas | R$ 39,70 |
| `classico-moido-500` | Café Especial Canastra Clássico Moído - Pacote com 500 gramas | R$ 65,70 |
| `classico-moido-caixa-3x250` | Café Especial Canastra Clássico Moído - Caixa com 3 pacotes de 250 gramas | R$ 99,90 |
| `suave-graos-250` | Café Especial Canastra Suave em Grãos - Pacote com 250 gramas | R$ 39,70 |
| `suave-graos-500` | Café Especial Canastra Suave em Grãos - Pacote com 500 gramas | R$ 65,70 |
| `suave-graos-1000` | Café Especial Canastra Suave em Grãos - Pacote com 1 quilograma | R$ 109,90 |
| `suave-moido-250` | Café Especial Canastra Suave Moído - Pacote com 250 gramas | R$ 39,70 |
| `suave-moido-500` | Café Especial Canastra Suave Moído - Pacote com 500 gramas | R$ 65,70 |
| `suave-moido-caixa-3x250` | Café Especial Canastra Suave Moído - Caixa com 3 pacotes de 250 gramas | R$ 99,90 |
| `microlote-graos-250` | Microlote Canastra em Grãos 250g | R$ 43,70 |
| `nectar-de-minas-graos-1000` | Café Tipo Exportação Néctar de Minas em Grãos - Pacote com 1 quilograma | R$ 105,70 |
| `kit-canela-classico-suave-moido-3x250` | Café Especial Canastra Canela, Clássico e Suave Moído - Caixa com 1 pacote de 250 gramas de cada | R$ 109,70 |
| `drip-suave-display-10` | Café Canastra Drip Coffee Suave - Display com 10 unidades | R$ 37,70 |
| `drip-classico-display-10` | Café Canastra Drip Coffee Clássico - Display com 10 unidades | R$ 37,70 |
| `drip-classico-3-caixas` | Drip Coffee - Canastra Clássico 3 caixas - Total 30 unidades | R$ 0,00 * |
| `drip-classico-6-caixas` | Drip Coffee - Canastra Clássico 6 caixas com 10 unidades cada - Total 60 unidades | R$ 0,00 * |
| `drip-canela-3-caixas` | Drip Coffee - Canastra Canela 3 caixas - Total 30 unidades | R$ 0,00 * |
| `drip-canela-6-caixas` | Drip Coffee - Canastra Canela 6 caixas com 10 unidades cada - Total 60 unidades | R$ 0,00 * |
| `drip-suave-3-caixas` | Drip Coffee - Canastra Suave 3 caixas - Total 30 unidades | R$ 0,00 * |
| `capsula-classico-1-caixa` | Cápsula Compatível Nespresso - Canastra Clássico 1 caixa com 10 unidades | R$ 0,00 * |
| `capsula-classico-6-caixas` | Cápsula Compatível Nespresso - Canastra Clássico 6 caixas com 10 unidades cada | R$ 0,00 * |
| `capsula-canela-1-caixa` | Cápsula Compatível Nespresso - Canastra Canela 1 caixa com 10 unidades | R$ 0,00 * |
| `capsula-canela-6-caixas` | Cápsula Compatível Nespresso - Canastra Canela 6 caixas com 10 unidades cada | R$ 0,00 * |
| `capsula-classico-2-canela-1` | Cápsula Compatível Nespresso - Canastra Clássico 2 caixas + Canela 1 caixa | R$ 0,00 * |
| `capsula-classico-3-canela` | Cápsula Compatível Nespresso - Canastra Clássico 3 caixas + Canela | R$ 0,00 * |

\* preço ainda em revisão comercial no catálogo (fora do alcance desta
entrega, decisão 9 do plano mestre). O preço no Bling é cadastral — **o valor
que vai no pedido de venda é sempre o preço COBRADO no checkout**, item a
item, com o desconto do cupom como desconto do pedido.

Para a NF-e, cada produto no Bling precisa ainda de **NCM** e **origem**
(dados fiscais do cadastro do produto) — café torrado em grãos/moído é
tipicamente NCM `0901.21.00` e drip/cápsula seguem o mesmo capítulo 09.01;
**confirme com o contador**, este runbook não substitui orientação fiscal.

## 4. Configuração fiscal mínima para a NF-e de venda

Na conta Bling (uma vez só; sem isto o `POST /bling/pedidos/:id/nfe` responde
o erro do Bling, legível):

1. **Certificado digital A1** da empresa importado (Configurações → Notas
   fiscais → Certificado digital).
2. **Série da NF-e** configurada e numeração alinhada com a SEFAZ
   (Configurações → Notas fiscais → NF-e: série — em geral `1` — e o próximo
   número).
3. **Natureza de operação** de venda ativa (ex.: "Venda de mercadorias") com
   as regras de imposto do regime da empresa (Simples/CSOSN etc. — de novo:
   contador).
4. Dados cadastrais da empresa completos (IE, endereço, CRT).
5. NCM/origem preenchidos nos produtos (seção 3).

## 5. Ligar e testar com um pedido de R$ 1

1. No painel da loja, crie um produto de teste "Teste Bling" com SKU
   `teste-bling-1` e preço R$ 1,00 — e cadastre o MESMO SKU no Bling.
2. Suba o backend com `BLING_ATIVO=true` (deixe `BLING_NFE_AUTO=false` no
   primeiro teste) e confira em **`/dashboard/bling`** que *Integração*,
   *Credenciais* e *Token* estão os três verdes.
3. Faça um pedido real de R$ 1 no checkout (Pix) e pague.
4. Quando o webhook aprovar, o log mostra
   `Bling: pedido <id> sincronizado (pedido de venda <n>)` e o pedido aparece
   em Vendas → Pedidos de venda no Bling, com o id do pedido da loja no campo
   **Nº no canal de venda** (`numeroLoja`).
5. Emita a nota do teste manualmente: em **`/dashboard/bling`**, ache o pedido
   na fila e clique em **Emitir NF-e**. A linha passa a mostrar `NF-e <n>` com
   o link **Abrir DANFE** — confira o documento no link. (Se preferir não
   emitir nota de teste, valide só a sincronização e emita a primeira NF-e
   numa venda real.)
6. Preencha um código de rastreio qualquer no pedido de venda do Bling
   (transporte → volumes) e clique em **Buscar rastreio** no painel: o pedido
   da loja vira `enviado`, com o código na linha, e o e-mail sai.
7. Cancele/estorne o pedido de teste no MP e no Bling, apague o produto de
   teste dos dois lados, e só então ligue `BLING_NFE_AUTO=true` /
   `BLING_RASTREIO_CRON=true` se quiser o fluxo 100% automático.

## 6. O que cada endpoint faz (todos exigem admin)

Cada linha desta tabela é um botão do painel — a coluna do meio diz qual.

| Endpoint | Botão no painel | O que faz |
|---|---|---|
| `GET /bling/status` | cartão *Status da integração* (e **Conferir de novo**) | Sonda: variáveis ligadas, credencial presente, token renovando (`token: { ok }`). Responde mesmo com `BLING_ATIVO=false` — é o endpoint que diagnostica o desligado. |
| `POST /bling/pedidos/:id/sincronizar` | **Sincronizar** | Cria o pedido de venda no Bling (idempotente: já sincronizado responde `jaSincronizado: true`). Erros legíveis: SKU ausente (400, nomeia o SKU), status não pago (409), falha do Bling (502 com a frase do Bling). |
| `POST /bling/pedidos/:id/nfe` | **Emitir NF-e** | Sincroniza antes se preciso; gera a NF-e do pedido de venda, transmite à SEFAZ e grava `nfe_numero`/`nfe_chave`/`nfe_url`. Configuração fiscal ausente → o erro do Bling volta legível, a nota fica pendente lá e a retentativa **retransmite a mesma** (§7). "Já emitida" só depois da chave de acesso. |
| `POST /bling/pedidos/:id/rastreio` | **Buscar rastreio** | Lê o pedido no Bling; com rastreio lá, grava o código, avança para `enviado` (quando cabível) e dispara o e-mail com o código. Sem rastreio ainda → `rastreio: null`, sem efeito. Pedido cancelado/rejeitado/reembolsado → 409, sem gravar nada. |

Os três botões aparecem tanto na fila de **`/dashboard/bling`** quanto no modal
de detalhe de um pedido em **Pedidos**. Toda mensagem de recusa (503, 502, 422,
409, 504) chega ao painel **com a frase do servidor**, que é onde está o
diagnóstico.

Gatilhos automáticos: aprovado → sincroniza (`BLING_ATIVO=true`);
`BLING_NFE_AUTO=true` emenda a NF-e; `BLING_RASTREIO_CRON=true` consulta o
rastreio de hora em hora (minuto 30, pedidos dos últimos 60 dias).

## 7. Problemas comuns

- **`invalid_grant` na renovação** → o refresh token expirou (6 meses sem
  uso) ou foi usado fora deste processo (outra máquina/rodada local com o
  mesmo token: o rodízio invalida o daqui). Refaça a seção 2.
- **`SKU "x" não está cadastrado no Bling`** → seção 3. O pedido segue
  normal na loja; depois de cadastrar o SKU lá, clique em **Sincronizar**
  naquele pedido (fila de `/dashboard/bling`, filtro *Sem pedido de venda*).
- **NF-e recusa com erro de natureza de operação/série/certificado** →
  seção 4; a mensagem do Bling vem inteira na resposta 502.
- **"A nota foi GERADA no Bling mas NÃO transmitida"** → a emissão tem dois
  atos, e o segundo (a transmissão à SEFAZ) falhou — quase sempre por causa da
  seção 4. A nota existe lá, **pendente**, e o pedido guarda o id dela. No
  painel esse pedido aparece em laranja como **"NF-e &lt;n&gt; não
  transmitida"** (filtro *Sem NF-e autorizada*): corrija o que a mensagem
  apontou e clique em **Emitir NF-e** de novo — a retentativa RETRANSMITE a
  mesma nota, não gera outra. Se a retransmissão
  falhar de novo, a resposta diz *"nota gerada mas não transmitida —
  retransmita pelo painel do Bling"*: vá em **Vendas → Notas fiscais**, abra a
  nota pendente daquele pedido e clique em **Enviar** lá. Enquanto a nota não
  for transmitida, o pedido **não** responde "já emitida" — quem carimba isso é
  a chave de acesso, que só existe depois da autorização da SEFAZ.
- **`504` / "O Bling não respondeu"** → o Bling passou do teto de espera (15s
  por chamada) ou a sincronização inteira passou de 8 minutos e foi abortada de
  propósito. Nada foi criado pela metade; clique no mesmo botão do painel de
  novo mais tarde.
- **"Pedido redigido pela LGPD não vai ao ERP" (422)** → o titular pediu a
  exclusão dos dados e o endereço/CPF daquele pedido foi apagado daqui
  (`docs/seguranca-dados-pessoais.md`). Não há o que sincronizar: se a nota
  precisa sair, emita-a no painel do Bling.
- **Nada sincroniza e nada no log** → `BLING_ATIVO` não está `true` literal.
  Confira em **`/dashboard/bling`**: com a integração desligada, o cartão de
  status mostra *Integração: desligado* e o aviso azul com o que ligar (e os
  três botões da fila ficam desabilitados, para não prometerem o que a rota
  recusaria com 503).
