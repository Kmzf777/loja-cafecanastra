# WhatsApp — runbook da integração (Cloud API oficial da Meta)

O bot está **inteiro e desligado**. Ele não depende de mais nenhuma linha de
código: o que falta é o número da loja na Meta, e este documento é o passo a
passo de quando ele existir.

O que a integração faz, uma linha por peça:

- **Avisa o cliente pelo WhatsApp a cada mudança de status do pedido**, ao lado
  do e-mail que já existe: recebido, pago, enviado (com o código de rastreio),
  entregue, cancelado e reembolsado. São sete templates de utilidade aprovados
  pela Meta — fora da janela de 24h, é a única forma de mensagem permitida.
- **Atende o básico por botões.** Quem aperta "Preciso de ajuda" num aviso
  recebe um menu de três botões: onde está meu pedido, falar com uma pessoa,
  parar de receber. Não há texto livre, não há IA e não há caixa de entrada no
  painel: quem quer falar com gente é levado ao número humano de sempre.
- **É operado inteiramente pelo painel da loja** (`/dashboard/whatsapp`):
  credenciais, interruptores por aviso, criação dos templates na Meta, envio de
  teste e o histórico do que saiu e do que falhou.
- Tudo atrás de um interruptor que **nasce desligado**. **Nenhuma falha do
  WhatsApp derruba pedido, checkout ou webhook**: o pior caso é uma linha
  `falhou` no histórico e o e-mail saindo normalmente, como sempre saiu.

Variáveis: `META_ATIVO`, `META_ACCESS_TOKEN`, `META_APP_SECRET`,
`META_VERIFY_TOKEN`, `META_PHONE_NUMBER_ID`, `META_WABA_ID` — todas
documentadas em `backend/src/.env.example`, e **todas opcionais**: quem
configura pelo painel não precisa tocar em nenhuma delas (§8).

---

## Leia isto antes de qualquer coisa: o número não volta atrás

Três fatos que decidem o que fazer no primeiro dia, e nenhum deles é
reversível com um clique:

1. **Um número que já está no WhatsApp comum ou no WhatsApp Business não pode
   ser registrado na Cloud API.** Ele precisa ser **apagado** daquele
   aplicativo antes (Configurações → Conta → Apagar minha conta), e a Meta leva
   **até cerca de 24 horas** para liberar o número depois disso.
2. **Depois de entrar na Cloud API, o número deixa de funcionar no aplicativo
   do celular.** Não há mais conversa manual naquele número: tudo passa a sair
   por API. É por isso que o número desta integração é **novo**, e o número
   humano de atendimento que a loja usa hoje **continua intacto** — inclusive
   porque é para ele que o bot manda quem aperta "Falar com alguém".
3. **O número precisa receber SMS ou ligação** na hora do registro, e **não
   pode ser short code**.

Se houver qualquer dúvida sobre qual número usar, pare aqui e resolva essa
pergunta primeiro. Todo o resto deste documento se refaz em uma tarde; um
número apagado do WhatsApp Business, não.

---

## Onde ficam os botões, no painel da loja

**`/dashboard/whatsapp`** — no menu lateral, em *Configurações gerais* →
**WhatsApp**. Exige conta de **administrador** (o mesmo `isAdmin` das rotas do
Bling). Seis blocos, nesta ordem:

1. **Estado da integração** — a leitura de `GET /whatsapp/status`: se está
   ligada, o que ainda falta preencher, e — quando há credencial — o que a Meta
   responde sobre o número (nome exibido, `quality_rating`, situação da
   verificação). Com a integração desligada a tela **diz isso** e desabilita os
   botões, em vez de deixar o 503 acontecer: desligado é o estado de fábrica,
   não é erro. Se o bot **se desligou sozinho** (§9), é aqui que aparece o
   motivo e a data. A lista de "o que falta" cobra os **cinco** campos da
   instalação completa, e não só os dois sem os quais nada sai: sem `app_secret`
   e sem `verify_token` a loja **manda** aviso e não **recebe** resposta
   nenhuma, e esse sintoma não aponta para lugar nenhum sozinho.
2. **Credenciais da Meta** — token, app secret, verify token, phone number id,
   waba id e o número de suporte. Os três primeiros são **write-only**: o
   painel devolve só `••••` mais os quatro últimos caracteres, nunca o valor.
   **Campo secreto em branco não apaga nada** — é o jeito de salvar os outros
   campos sem mexer no token.
3. **Avisos ao cliente** — o interruptor mestre (`ativo`) e um interruptor por
   status: pendente, aprovado, enviado, entregue, cancelado, reembolsado.
   (`rejeitado` usa o interruptor de `cancelado`, porque usa o mesmo texto.)
4. **Templates** — os sete deste código cruzados com o que existe na sua conta
   da Meta: `APPROVED`, `PENDING`, `REJECTED` com o motivo, ou ausente. O botão
   **Criar na Meta** cria os que faltam, um a um. É também aqui que aparece a
   **reclassificação de categoria** (§7) — a linha mais cara desta tela.
5. **Enviar uma mensagem de teste** — número + template, sem precisar de
   cliente cadastrado nem de pedido. É o que valida a instalação inteira contra
   o número de teste da Meta, antes de existir número real.
6. **Histórico** — as últimas mensagens: pedido, template, para onde foi (só os
   **quatro últimos dígitos** — o número completo nunca é gravado nessa
   tabela), estado de entrega e a frase do erro quando falhou.

---

## 1. Business Portfolio verificado

Em <https://business.facebook.com>, com o CNPJ e o comprovante de endereço da
empresa. **Sem verificação o teto é de 250 destinatários únicos por 24 horas**;
com ela, 2.000. O teto é por *business portfolio*, não por número.

A verificação leva dias e não depende de nós — comece por ela.

## 2. Criar o app na Meta e anotar os dois IDs

1. <https://developers.facebook.com/apps> → **Criar app** → caso de uso
   **"Connect with customers through WhatsApp"**.
2. No menu **WhatsApp → API Setup**, anote:
   - **WABA ID** (o ID da WhatsApp Business Account) → `META_WABA_ID`;
   - **Phone number ID** → `META_PHONE_NUMBER_ID`. **É o ID interno do número
     dentro da Meta, não o telefone.**
3. Em **App settings → Basic**, copie o **App Secret** → `META_APP_SECRET`.

## 3. O token de System User — e o aviso que custa refazer tudo

O token que o bot usa **não** é o token temporário que a tela de API Setup
mostra (aquele vence em 24 horas). É um token de **usuário do sistema**:

1. <https://business.facebook.com> → **Configurações do negócio** → **Usuários
   do sistema** → criar um, com função **Admin**.
2. **Atribuir ativos** a esse usuário: o **App** e a **WABA**, os dois com
   controle total. Sem isso o token nasce sem alcance e todas as chamadas
   respondem erro de permissão.
3. **Gerar novo token**, escolhendo o app e marcando as permissões
   **`whatsapp_business_messaging`** (enviar mensagem) e
   **`whatsapp_business_management`** (criar e listar template, ler o perfil do
   número). São as duas de que este código depende; `business_management`
   aparece na mesma lista e não atrapalha, mas nada aqui a usa.
4. Na expiração, escolha **"Nunca"**.

> **O token é exibido uma única vez.** Fechou a janela sem copiar, não há como
> recuperá-lo — só gerar outro. Cole-o direto no painel da loja (bloco
> *Credenciais*) ou em `META_ACCESS_TOKEN`.

## 4. O webhook

No app da Meta, em **WhatsApp → Configuration → Webhook**:

- **Callback URL**: `https://<a-api-da-loja>/whatsapp/webhook`
  (o mesmo host da API, o que atende `/health` — **não** o host da vitrine).
- **Verify token**: uma string que **você inventa**. A mesma precisa estar em
  `META_VERIFY_TOKEN` ou no campo *Verify token* do painel **antes** de clicar
  em Verificar e salvar, senão o handshake falha.
- **Campos assinados**: marque **`messages`**. Ele cobre as duas coisas que o
  bot lê — mensagem que chega do cliente **e** status de entrega
  (`sent`/`delivered`/`read`) das que saíram.
  `message_template_status_update` pode ser assinado sem prejuízo, mas **este
  código o ignora**: o estado dos templates é lido sob demanda, quando o painel
  abre o bloco *Templates*.

O webhook recusa com **401** qualquer entrega sem `X-Hub-Signature-256` ou com
assinatura que não confira — inclusive corpo alterado depois de assinado. (O
código de exemplo publicado pela própria Meta deixa passar requisição sem o
cabeçalho; este não.)

## 5. Testar tudo antes de o número real existir

A Meta entrega, junto com o app, um **número de teste gratuito**: envia para
até **5 destinatários autorizados**, **não exige cartão cadastrado** e tem
limites relaxados. Dá para exercitar o bot inteiro com ele — templates, avisos,
menu de botões, opt-out.

1. Em **WhatsApp → API Setup**, adicione o seu celular à lista de números
   autorizados a receber (a Meta manda um código de confirmação).
2. Preencha as credenciais no painel usando o **Phone number ID do número de
   teste**, marque *Integração ativa* e salve.
3. Bloco *Templates* → **Criar na Meta**. A aprovação leva **até 24 horas**, na
   prática costuma sair em minutos. Enquanto um template não estiver
   `APPROVED`, o aviso correspondente não sai.
4. Bloco *Enviar uma mensagem de teste* → o seu número + um template. A
   mensagem chega, e o histórico registra a linha.
5. Responda "Preciso de ajuda" na própria mensagem e confira o menu de três
   botões. (Para o botão *Meu pedido* achar alguma coisa, o número precisa
   estar num cadastro da loja — veja §6.)
6. Faça um pedido de verdade de R$ 1 no checkout e acompanhe os avisos saindo a
   cada mudança de status.

> **Quando o número real for registrado, o `PHONE_NUMBER_ID` MUDA.** Ele é do
> número, não da conta. Volte ao painel e troque — se esquecer, o bot continua
> mandando pelo número de teste, que só alcança os 5 autorizados.
>
> Os templates, esses, ficam: eles pertencem à WABA, e o `META_WABA_ID` não
> muda.

## 6. Onde o número do cliente entra

O bot só fala com quem deixou o número **e** tem o consentimento carimbado.
São dois caminhos, e um deles é o único que funciona hoje:

- **Cadastro** (`/account/cadastro`) — campo de WhatsApp obrigatório, com o
  texto de opt-in dizendo que os avisos de pedido vão para lá. **Com
  confirmação de e-mail ligada, que é a configuração desta loja, o número
  digitado aqui se perde** — veja a limitação 1 na §11.
- **Área da conta** (`/account`) — o bloco de WhatsApp, que convida quem está
  sem número a deixá-lo. **É ele quem de fato captura o número hoje.** A tela
  de espera do cadastro já diz isso ao cliente, com estas palavras: *"Seu
  WhatsApp não vai junto no link."*
  **E é também a única porta para TROCAR o número**, o que importa mais do que
  parece: um dígito errado passa por toda validação (`99999-0001` é tão válido
  quanto `99999-0000`) e faria os avisos de pedido de alguém irem para um
  estranho, a cada mudança de status, para sempre — não há tela de perfil,
  `garantir_cliente` faz `RETURN` para quem já é cliente, o painel do gestor só
  lê, e não existe `UPDATE clientes SET telefone` no Express. Quem grava é a
  RPC `registrar_optin_whatsapp` (0019), que troca o número **e re-carimba o
  consentimento no mesmo gesto** — o carimbo descreve o número que está gravado
  agora, e não um consentimento antigo sobre um número novo. A tela só manda o
  telefone **quando ele mudou** (`telefoneParaRegistrar`, em
  `lib/conta/cadastro.ts`): mandar sempre re-carimbaria a cada visita e apagaria
  a data em que a pessoa de fato deixou o número.

Promoção é assunto separado: uma **caixa à parte, desmarcada**, com carimbo
próprio (`whatsapp_promo_optin_em`). **Nenhum template de marketing é criado ou
enviado por este código** — o consentimento é coletado desde já para não
precisar pedir de novo depois, e é só isso.

Para sair, o cliente aperta **Parar avisos** no menu ou escreve `PARAR`, `SAIR`
ou `STOP`. Não existe opt-out nativo no WhatsApp: parar de mandar é
inteiramente responsabilidade da loja, e é esta coluna
(`clientes.whatsapp_optout_em`) que a cumpre.

**O opt-out é sobre o APARELHO, e não sobre a identidade** — parar vale para
*todas* as contas cujo telefone (ou `wa_id`) aponta para aquele número. O
cenário que obriga isso é o celular compartilhado: `clientes` tem UNIQUE só em
`cpf`, telefone é texto solto, e mãe e filha no mesmo aparelho são duas linhas
com o mesmo número — o **envio** nunca ligou para a ambiguidade, então o
aparelho recebe os avisos das duas contas. É também a **única** coisa que
atravessa a guarda de ambiguidade do roteador: com o número casando com mais de
um cadastro o bot continua sem responder "seu pedido é o X" (isso seria o
vazamento que a guarda existe para impedir), mas *para* de mandar, e a
confirmação diz o escopo real ("vale para todos os cadastros que usam este
número") sem nomear ninguém. Quem foi parado sem ter pedido volta num clique —
a área da conta tem **Voltar a receber**. A política de privacidade anuncia
esse escopo com estas palavras: *"o PARAR vale para o número, e não para a
conta"*.

**O bot fica em silêncio, sem erro nenhum,** quando: a integração está
desligada; o aviso daquele status está desligado no painel; o cliente não tem
telefone nem `wa_id`; o consentimento não está carimbado; o cliente deu
opt-out; o status está fora do recorte (`em_processamento` e `autorizado` não
avisam ninguém, exatamente como no e-mail); ou aquele pedido já recebeu aquele
mesmo aviso. Silêncio é silêncio: nada disso vira linha de log de erro.

## 7. O que isso custa

- **Template de utilidade no Brasil: US$ 0,0068 por mensagem entregue.** É o
  número que aparece na documentação oficial da Meta. **Ignore os US$ 0,0080
  que circulam por aí**: é a tarifa antiga, cobrada por conversa, morta desde
  1º de julho de 2025.
- Um pedido que percorre o ciclo inteiro (recebido → pago → enviado → entregue)
  são 4 mensagens, algo como **US$ 0,027** — em torno de quinze centavos de
  real, conforme o câmbio.
- **O rate card oficial em reais não foi lido.** Ele está atrás de um seletor
  interativo no site da Meta, e o valor em BRL não vem de citação em
  documentação como o valor em dólar vem. **Confira antes de transformar isto
  em orçamento.**
- WABA criada hoje com *Sold-To* Brasil já nasce faturada em BRL pela Facebook
  Brasil.

### O prazo duro: 1º de outubro de 2026

Até essa data, duas coisas são **grátis**:

- template de utilidade entregue **dentro** de uma janela de atendimento aberta
  (ou seja, quando o cliente escreveu para a loja nas últimas 24 horas);
- **mensagem de serviço** — que é o que o menu de botões inteiro é.

**A partir de 1º de outubro de 2026 as duas passam a ser cobradas**, à mesma
tarifa de utilidade. As tarifas de outubro serão publicadas **até 1º de
setembro de 2026**.

Quem estiver lendo isto depois dessa data: **a conta acima está velha, refaça**.

## 8. O risco que custa nove vezes mais

**Uma frase de venda em qualquer template de utilidade o reclassifica para
`MARKETING`.** O exemplo literal da documentação da Meta é *"an order update
with a promo"* — um "aproveite 10% na próxima compra" no fim do "pedido
entregue" basta.

Duas consequências, e a segunda é pior que a primeira:

1. O preço multiplica por **cerca de nove**.
2. **"Template misclassification" é motivo explícito de bloqueio de envio** na
   escada de punição da Meta. Para quem já foi advertido, a reclassificação
   acontece **sem aviso prévio**.

É por isso que aviso e promoção nascem separados neste desenho, com
consentimentos separados e nenhum template de marketing criado. E é por isso
que o bloco *Templates* do painel mostra `category` e `correct_category` lado a
lado: `correct_category` é a Meta anunciando que vai reclassificar. Sem essa
linha na tela, a mudança só apareceria na fatura.

**Se você for editar os textos dos avisos** (eles vivem num mapa só, em
`backend/src/utils/whatsappMensagens.js`): nenhuma palavra de venda, e o corpo
não pode começar nem terminar em variável — "dangling parameters are not
allowed" é regra da Meta e volta `REJECTED`.

## 9. O que cada endpoint faz

Todas as rotas do painel exigem **login + administrador**, nesta ordem.

| Endpoint | Bloco no painel | O que faz |
|---|---|---|
| `GET /whatsapp/status` | *Estado da integração* | Sonda: ligado, o que falta preencher, e o perfil do número na Meta (nome, `quality_rating`). **Responde mesmo desligado** — é o endpoint que diagnostica o desligado. |
| `GET /whatsapp/config` | *Credenciais* | Devolve **máscara**, nunca o valor. Segredo nenhum sai desta API. |
| `PUT /whatsapp/config` | *Credenciais* / *Avisos* | Grava o que veio, campo a campo. Campo ausente não encosta na coluna. |
| `GET /whatsapp/mensagens` | *Histórico* | As últimas mensagens, sem telefone completo e sem `wamid`. |
| `GET /whatsapp/templates` | *Templates* | Os sete deste código cruzados com o estado na Meta, mais `category`, `correct_category` e o motivo da recusa. |
| `POST /whatsapp/templates` | **Criar na Meta** | Cria os que faltam, **um de cada vez**; cada falha vira uma linha do resultado, com a frase da Meta. |
| `POST /whatsapp/teste` | *Enviar teste* | Manda um template com os valores de exemplo para um número qualquer. Recusa número que não seja celular brasileiro válido. |
| `GET`/`POST /whatsapp/webhook` | — | O handshake e a entrega da Meta. **Públicos por natureza**, autenticados por HMAC, com limite próprio de 600 requisições por minuto. |

Com a integração desligada, as ações respondem **503 com a frase do motivo** e
o painel desabilita os botões antes de chegar lá.

### Quando o bot se desliga sozinho

Quatro erros da Meta significam "nenhuma mensagem vai sair até um humano trocar
a credencial": **190** (token revogado ou expirado), **200** e **10**
(permissão faltando) e **131031** (conta bloqueada pela política da Meta). Ao
receber um deles no aviso de um pedido, o bot **desliga a integração**, grava o
motivo e a data, e **grita no log** o que parou de acontecer. O e-mail continua
saindo normalmente. O painel mostra o motivo no bloco *Estado da integração* —
troque a credencial e religue por lá.

Erros de **uma** mensagem não desligam nada: `131026` ("esse número não
recebe"), `131047` ("fora da janela"), `132001` ("template não encontrado").
Desligar a loja inteira por causa de um telefone digitado errado silenciaria os
avisos de todo mundo.

## 10. Problemas comuns

- **Salvei tudo no painel e nada acontece** → confira o bloco *Estado da
  integração*. Faltando `access_token` ou `phone_number_id`, a integração não
  se considera ligada, mesmo com o interruptor marcado.
- **A Meta não aceita a Callback URL** → o handshake é um `GET` com
  `hub.verify_token`. Ou o verify token do painel da Meta não é idêntico ao da
  loja, ou a URL não é a da API (é fácil colar a da vitrine por engano). O log
  registra "verificação do webhook recusada".
- **O cliente respondeu e o bot não respondeu nada** → três causas, todas
  legítimas: o número não pertence a nenhum cadastro da loja (bot não responde a
  desconhecido, para não pagar por mensagem a quem nunca comprou); o número casa
  com **mais de um** cadastro (aí ele também se cala, de propósito); ou o menu
  já saiu uma vez nesta janela de 24 horas — há um teto de um menu por janela,
  para o pingue-pongue não derrubar a nota de qualidade do número.
- **O aviso não saiu para um cliente específico** → veja o *Histórico*. Se não
  há linha nenhuma para aquele pedido, o envio nem foi tentado: caia na lista de
  silêncios da §6 (o mais comum é o consentimento não carimbado, de conta
  antiga). Se há linha `falhou`, o código do erro está nela.
- **`REJECTED` num template** → o motivo vem da Meta e aparece ao lado do nome.
  Quase sempre é o corpo começando ou terminando em variável, ou palavra de
  venda em template de utilidade (§8).
- **Mensagens repetidas** → não deveria acontecer: existe linha no histórico por
  pedido + template, e é ela que impede o segundo envio. Se acontecer, é bug —
  reporte.
- **"Fora da janela" (131047)** → a loja só pode mandar texto livre nas 24 horas
  seguintes a uma mensagem do cliente. Fora dela, só template aprovado. É por
  isso que todo aviso leva o botão "Preciso de ajuda": é ele que abre a janela.

## 11. Duas limitações conhecidas

**1. O número digitado no cadastro se perde.** Com confirmação de e-mail ligada
— o padrão desta loja —, o cadastro **não** abre sessão: o cliente sai da
página para ir ao e-mail, e não há onde guardar o telefone. Ele não pode viajar
no link de confirmação (telefone não vai em `user_metadata`, e o token desta
instância acompanha a pessoa para outros projetos) nem ficar no navegador (quem
abre o link no celular perderia mesmo assim).

Quem de fato captura o número hoje é **o bloco de WhatsApp da área da conta**, e
a tela de espera do cadastro diz isso ao cliente em vez de calar. O conserto de
verdade seria pedir o WhatsApp na **tela de confirmação**, já com sessão — e
ficou **fora de escopo** desta entrega.

**2. Só o aviso de pedido desliga a integração sozinho.** O roteador do menu (o
caminho disparado pelo webhook, quando o cliente responde) recebe o mesmo erro
190 e **apenas registra no log** — de propósito: um desligamento alcançável por
webhook daria a quem manda mensagem de fora influência sobre a configuração da
loja. A brecha é estreita, porque **um** pedido basta para o desligamento
disparar, e a partir dele o roteador também emudece. A loja que ficaria sem
detectar é a que recebe mensagem e não vende nada.

### O botão "Rastrear pedido", e o que conferir antes de criar os templates

O botão do template `pedido_enviado` aponta para
`${LOJA_URL}/rastreio?codigo=<código>`, e a página existe:
`frontend/app/(vitrine)/rastreio/`. Ela é **pública** de propósito — o cliente
veio de um toque no WhatsApp e exigir login ali seria fricção no pior lugar — e
por isso mesmo **não consulta o banco nem a transportadora**: só ecoa o código
que veio na URL, oferece o link de rastreamento e aponta para `/account`. Quem
adivinhar o código de um terceiro não descobre nada sobre o pedido dele.

**Confira `LOJA_URL` antes de clicar em *Criar na Meta*.** A URL do botão é fixa
no momento da aprovação: criar o template com `LOJA_URL=http://localhost:3000`
(o valor do `.env.example`) congela o botão em localhost, e trocá-la depois
exige apagar o template, recriar e **esperar nova aprovação** — com o aviso de
envio fora do ar nesse meio-tempo. Sem a env vale `https://loja.cafecanastra.com`
(atenção ao `loja.`: `cafecanastra.com` é outro site). A constante é
`BOTAO_RASTREIO`, em `backend/src/utils/whatsappMensagens.js`, e
`whatsapp_conteudo.test.js` trava o domínio.

## 12. Para quem for mexer no código

- **A suíte do backend só é confiável em série:**

  ```sh
  cd backend && node --test --test-concurrency=1 test/*.test.js
  ```

  Em paralelo, o Postgres embarcado entra em contenção e caem de 70 a 114 testes
  **sem determinismo** — testes diferentes a cada rodada. Foi medido, não
  suposto. Hoje são 595 testes, todos verdes em série.
- **As migrações do bot são cinco**: `0017` (as três tabelas novas e as cinco
  colunas em `clientes`), `0018` (privilégios de coluna em `clientes`, fechando
  o que a 0017 deixou escrevível pelo navegador), `0019` (a RPC de opt-in, que é
  como o titular registra o próprio número), `0020` (o diagnóstico do
  desligamento automático, e a correção de uma promessa que a 0017 fez e não
  cumpria: o envio agora confere o carimbo de consentimento) e `0021` (o rastro
  de `whatsapp_mensagens` entra na redação da LGPD, e a guarda de aviso
  duplicado ganha índice único).
- **A versão da Graph API está fixada em `v26.0`**, numa constante única
  (`backend/src/services/whatsappClient.js`). A Meta mantém cada versão por pelo
  menos dois anos e, quando ela vence, **não quebra a chamada** — roteia em
  silêncio para a anterior, o que é pior que quebrar. Subir é trocar aquela
  linha e reler as notas de versão.
- **Nenhum token, nenhum telefone completo e nenhum `wamid` vai para log** — o
  miolo de um `wamid` em base64 *é* o telefone do cliente. O rótulo de erro é
  método + caminho, nunca a URL com querystring.
- **`whatsapp_mensagens` guarda só os quatro últimos dígitos em
  `telefone_final` — mas o `wamid` carregava o número inteiro.** A intenção da
  0017 era o telefone completo morar num lugar só, `clientes.telefone`; o miolo
  do `wamid` em base64 furava isso sem ninguém perceber, e a linha sobrevivia à
  exclusão da conta. A **0021** fecha: a redação por titular
  (`canastra.redigir_dados_do_titular`) apaga `wamid`, `telefone_final` e
  `user_id` daquela linha. O que fica — pedido, template, status e carimbos — é
  registro do que a loja fez, e não aponta para pessoa nenhuma. Ver
  `docs/seguranca-dados-pessoais.md`.
- **A chave canônica do destinatário é o `wa_id` que a Meta devolve**, não o
  telefone do cadastro: a documentação da Meta avisa que, no Brasil e no México,
  a Cloud API pode mexer no nono dígito. O telefone digitado serve para o
  primeiro envio; da primeira resposta do cliente em diante, quem manda é o
  `wa_id`.
- O desenho completo, com a razão de cada decisão e o que ficou de fora, está em
  `docs/superpowers/specs/2026-08-22-bot-whatsapp-design.md`.
