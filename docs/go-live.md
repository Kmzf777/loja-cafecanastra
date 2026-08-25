# Go-live — o que falta para a loja substituir a Tray

Este documento existe para uma pergunta só: **o que ainda depende de gente, e não
de código.** Tudo que estava ao alcance do repositório foi feito e está coberto
por teste. O que sobrou aqui exige credencial, acesso à VPS, decisão comercial
ou uma conversa com o contador — e nenhuma dessas coisas um programa faz sozinho.

Leia junto:

- **`docs/deploy.md`** — como subir na VPS, passo a passo, do zero.
- **`docs/producao.md`** — as armadilhas que quebram em silêncio, por seção.
- **`docs/bling.md`** — o runbook do ERP: app, escopos, SKUs, fiscal.
- **`docs/seguranca-dados-pessoais.md`** — o que ainda falta em LGPD.

---

## 1. A ordem que eu recomendo

Cada bloco depende do anterior. Pular etapa aqui custa caro depois.

| # | Bloco | Quem faz | Sem isso… |
|---|---|---|---|
| 1 | Subir na VPS (`deploy.md`) | quem administra o servidor | não existe loja no ar |
| 2 | Mercado Pago em produção | você + conta do MP | ninguém paga |
| 3 | Resend (domínio verificado) | você + DNS | nenhum e-mail chega |
| 4 | Revisão comercial do catálogo | o gestor | vende o que não tem |
| 5 | Bling (`bling.md`) | você + contador | vende sem nota |
| 6 | Medição (GA4) e WhatsApp | você | vende às cegas |
| 7 | Revisão jurídica dos textos (§7) | um advogado | a loja publica que seus termos não valem |
| 8 | LGPD: reescrever o histórico | quem administra o repositório | risco jurídico aberto |
| 9 | **Decisão de domínio + redirects 301 (§10)** | você | a fusão dos dois sites joga fora a autoridade orgânica dos dois |

> A decisão de domínio (§10) é **anterior** ao bloco 1 na prática: ela define o
> `NEXT_PUBLIC_SITE_URL` com que a VPS sobe, e é ele que alimenta o
> `metadataBase`, o `sitemap.xml`, o `robots.txt` e o JSON-LD. Ela está no fim
> desta lista só porque o mapa de redirects, que é o trabalho pesado dela, pode
> ser montado em paralelo com o resto.

---

## 2. Credenciais — o que preencher, e onde

Os arquivos de exemplo (`backend/src/.env.example` e `frontend/.env.example`)
documentam **cada** variável com o motivo. Aqui está só o resumo do que precisa
de credencial de verdade.

### Obrigatórias — a loja não vende sem elas

| Variável | Onde conseguir | Sem ela |
|---|---|---|
| `DATABASE_URL`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` | painel do Supabase da VPS | a API recusa subir |
| `SUPABASE_JWT_SECRET` | **condicional** — leia `producao.md` §3.1 | 403 para todo cliente, ou a API não sobe |
| `CORS_ORIGIN`, `NEXT_PUBLIC_API_URL`, `NEXT_PUBLIC_SITE_URL` | seu domínio | painel e vitrine não falam com a API |
| `MP_ACCESS_TOKEN` | Mercado Pago → Suas integrações | nenhuma cobrança sai |
| `MP_WEBHOOK_SECRET` | Mercado Pago → Webhooks | **nenhum pedido sai de "pendente"** |
| `WEBHOOK_URL` | seu domínio público, https | o MP não consegue avisar nada |
| `EMAIL_PASS2` + `EMAIL_DOMINIO` | Resend, com domínio verificado | nenhum e-mail é entregue |
| `MELHOR_ENVIO_TOKEN`, `ZIPCODE_ORIGIN` | Melhor Envio | o checkout recusa fechar pedido |

### Opcionais — cada uma liga um recurso

| Variável | Liga | Desligada… |
|---|---|---|
| `NEXT_PUBLIC_MP_PUBLIC_KEY` | **cartão de crédito** | só Pix (e os termos dizem só Pix) |
| `NEXT_PUBLIC_GA4_ID` | medição do funil | nenhum dado de conversão |
| `NEXT_PUBLIC_WHATSAPP` | botão de WhatsApp | o botão não aparece |
| `BLING_ATIVO` + `BLING_CLIENT_ID`/`SECRET`/`REFRESH_TOKEN` | **ERP e NF-e** | pedido não vai ao Bling |
| `BLING_NFE_AUTO` | emitir NF-e junto da sincronização | emissão só pelo botão do painel |
| `BLING_RASTREIO_CRON` | buscar rastreio de hora em hora | rastreio só pelo botão |
| `ABANDONO_ATIVO` | e-mail de carrinho abandonado | ninguém é lembrado |

> **Regra de desenho:** toda integração nova nasce **desligada**. Variável vazia
> nunca derruba a subida do processo — o recurso apenas não aparece. Isso é
> deliberado: dá para ir ao ar com o essencial e ligar o resto em etapas.

---

## 3. Os passos manuais que falham **sem erro nenhum**

Estes são os que mais custam tempo, porque não aparecem em log nenhum. Estão
detalhados em `producao.md`; a lista curta é:

- [ ] **`PGRST_DB_SCHEMAS` incluindo `canastra`** + reiniciar o PostgREST.
      Sem isso, **toda** rota da loja responde 404 com o banco perfeito
      (§3.3). É o erro nº 1 de primeiro deploy.
- [ ] **Allow-list de redirecionamento no GoTrue** com o domínio real (§3.5.1).
      Sem isso o cliente clica no e-mail de confirmação e cai na home, sem erro.
- [ ] **Modelos de e-mail com `{{ .TokenHash }}`**, não `{{ .ConfirmationURL }}`
      (§3.5.2). O segundo falha quando o link é aberto em outro aparelho — que
      é o caso comum: cadastra no computador, abre no celular.
- [ ] **SMTP configurado no GoTrue** (§3.5.3). Sem isso o cadastro trava em
      "confira sua caixa de entrada" para sempre.
- [ ] **Domínio verificado no Resend.** Sem isso nenhum e-mail transacional sai.
- [ ] **Webhook do Mercado Pago** apontando para
      `https://SEU-DOMINIO/api/webhook/mercadopago` (com o prefixo `/api`).
- [ ] **UM CARTÃO DE TESTE APROVADO, com credenciais `TEST-`, ANTES das de
      produção.** Não é zelo: o `statement_descriptor` (`CAFECANASTRA`) é o
      único campo que a loja manda ao gateway que **falha fechado**. Todo o
      resto degrada com elegância — sem device id cobra igual, sem
      `additional_info` cobra igual. Mas conta com restrição de descritor
      RECUSA o pagamento, e aí não é uma venda que se perde, são todas. A
      suíte não pega isso: ela exercita um dublê, não o Mercado Pago.
      Titular `APRO`, Mastercard `5031 4332 1540 6351`, CVV `123`, `11/30`.
- [ ] **`security.js` carregando no checkout.** Abra o console do navegador na
      página e confira que `MP_DEVICE_SESSION_ID` existe. Se não existir, a
      cobrança sai do mesmo jeito — de propósito —, mas a taxa de aprovação
      de cartão fica menor e a Qualidade da integração marca o item como não
      atendido.

Depois de tudo: faça **um cadastro completo e uma compra de R$ 1** em um
navegador limpo. É a única prova que vale.

### 3.1 O que as duas ondas do site único acrescentaram a este checklist

A fusão dos dois sites (spec `2026-08-22-site-unico-producao-design.md`) pôs
três idiomas no ar e mudou o que precisa ser conferido no deploy. Nada disto
existia na lista antes.

- [ ] **`NEXT_PUBLIC_SITE_URL` agora alimenta também o `hreflang`.** Ela sempre
      alimentou `metadataBase`, `sitemap.xml` e JSON-LD; depois da fusão o
      `sitemap.xml` são **42 URLs** (14 rotas canônicas × 3 idiomas), cada uma
      com o conjunto recíproco de alternativas. Domínio errado aqui não erra só
      o canônico: **um conjunto de `hreflang` que o sitemap contradiz é
      descartado inteiro pelo buscador**, e o que some do índice são justamente
      as páginas em inglês e espanhol. É a §10, e agora ela custa mais caro.
- [ ] **Nenhuma regra de nginx para `/pt/*` nem para `/en/checkout`.** A própria
      aplicação já responde 308 nesses dois casos; uma segunda camada fazendo o
      mesmo produz laço no dia em que uma delas mudar. Detalhe na §10.
- [ ] **Abrir `/en/cafes` e `/es/cafes` à mão depois do deploy.** O
      `npm run verifica` não abre uma única URL fora do português — as 37
      checagens do Chromium são todas em `pt`. A trava que existe é de build (o
      dicionário quebra a compilação por chave faltando), e ela não vê página
      publicada.
- [ ] **Conferir que o build imprime 51 rotas prerenderizadas.** É o número
      medido em 22/08/2026, contra 27 com o defeito de pé. `ƒ` na PLP `/cafes` é o
      esperado (ela lê `searchParams`); `ƒ` numa institucional é regressão —
      `docs/performance-dev.md` §7.1.
- [ ] **A revisão jurídica tem de cobrir os três idiomas.** Os termos e a
      política passaram a existir em `en` e `es`, e o aviso de "sem revisão"
      são **três remoções, não uma**. Está detalhado na §7.

> **Não abra chamado sobre laço de redirecionamento no middleware.** Um
> verificador reportou laço infinito de 308 em `next dev` e estava errado —
> mediu um arquivo colhido no meio de uma escrita. O caso está medido e
> encerrado em `docs/performance-dev.md` §7.2.

---

## 4. Bling e nota fiscal — o que só o seu contador resolve

O código está pronto e testado: pedido aprovado vira pedido de venda no Bling,
a NF-e é emitida (botão ou automático), e o código de rastreio volta para a loja
e dispara o e-mail ao cliente. O que **não** dá para automatizar daqui:

- [ ] Criar o aplicativo em `developer.bling.com.br` e obter o primeiro
      `refresh_token` (`bling.md` §1 e §2).
- [ ] **Cadastrar os 29 SKUs no Bling com os mesmos códigos da loja.** A tabela
      pronta está em `bling.md` §3. Se um SKU não existir lá, a sincronização
      recusa com o nome do SKU — de propósito: vincular ao produto errado
      movimentaria o estoque errado.
- [ ] Configuração fiscal com o contador: certificado A1, série, natureza de
      operação, NCM por produto (`bling.md` §4).
- [ ] O teste de aceitação: um pedido de R$ 1 percorrendo loja → Bling → NF-e
      → rastreio (`bling.md` §5).

> **Instância única:** a integração guarda o token rotativo do Bling no banco e
> supõe um processo só (o `deploy/ecosystem.config.cjs` já fixa `instances: 1`).
> Se um dia escalar horizontalmente, releia `bling.md` antes.

---

## 5. Decisão comercial: o catálogo

Isto é do gestor, não do código. Hoje, no `data/catalogo-canastra.json`:

- **13 dos 29 SKUs estão com estoque zero** e **11 com preço zero** — herança da
  captura da loja antiga.
- **Todo drip e toda cápsula estão esgotados.**
- Existe **um kit com estoque real** (Canela + Clássico + Suave, 3×250 g) que
  agora tem onde ser vendido na vitrine.

Antes de abrir a loja, alguém precisa dizer o que realmente está à venda. Preço
e estoque são editados **no painel** (não no arquivo) e a vitrine acompanha em
até um minuto, sem deploy.

---

## 6. LGPD — o que ainda é ação humana

O código agora redige dado pessoal: apagar uma conta cancela as assinaturas no
Mercado Pago, redige nome/CPF/endereço nos pedidos, nas assinaturas e o nome
público nas avaliações — preservando cidade e UF para estatística e o valor da
venda, que é registro fiscal. O que falta é de quem administra o repositório:

- [ ] **Executar `scripts/reescrever-historico.sh`.** Os CSVs com dados reais de
      clientes da loja antiga (incluindo senhas em hash e 34 refresh tokens)
      continuam no histórico do Git. O script está pronto, com guarda dupla, e
      **nunca foi executado** — exige `git filter-repo`, `push --force` e que
      todo mundo re-clone depois.
- [ ] **Invalidar o que vazou:** trocar o `JWT_SECRET_REFRESH` da loja antiga,
      forçar redefinição de senha das contas expostas, invalidar os tokens de
      recuperação.
- [ ] **Se o repositório já foi público**, considerar os dados comprometidos e
      avaliar a comunicação aos titulares (LGPD art. 48).
- [ ] Em produção, rodar uma vez o SQL de redação dos pedidos que já estão
      órfãos (bloco pronto em `seguranca-dados-pessoais.md`).

---

## 7. Os textos legais — a porteira que só você pode abrir

Hoje, `/termos-de-uso` e `/politica-de-privacidade` exibem **ao cliente** um aviso
dizendo, com todas as letras, que o texto é provisório e não passou por revisão
jurídica. O aviso é honesto: os textos foram escritos junto com o código, não por
um advogado.

Isso é uma porteira de go-live, e a decisão é do dono da loja:

- **O caminho certo:** um advogado revisa os dois textos (eles precisam refletir
  o que a loja realmente faz — e agora fazem bastante coisa: cartão, assinatura
  recorrente, cookies de medição, avaliações, prazo de troca). Com a revisão
  feita, o aviso sai — e **são três remoções, não uma**, desde que os textos
  passaram a existir em inglês e espanhol:

  1. o componente `AvisoJuridico` em
     `frontend/components/layout/PaginaTexto.tsx`, que é a versão em português;
  2. o objeto `AVISO_JURIDICO` de
     `frontend/app/[locale]/(vitrine)/termos-de-uso/conteudo.ts`;
  3. o mesmo objeto em
     `frontend/app/[locale]/(vitrine)/politica-de-privacidade/conteudo.ts`.

  Em cada `page.tsx` some junto o ramo ternário que escolhe entre os dois. A
  **cláusula de prevalência** (`AVISO_DE_TRADUCAO`) é outra coisa e **fica**:
  ela diz que a versão em português é a que rege legalmente, e isso continua
  verdade depois da revisão do advogado.
- **O que não dá:** ir ao ar com o aviso. Uma loja cujos próprios termos anunciam
  que não valem é pior do que uma loja sem termos.

Não removi o aviso por conta própria de propósito: apagá-lo não torna o texto
válido, só esconde do cliente que ele não foi revisado — e esta loja passou a
entrega inteira fechando promessas falsas, não criando novas.

**A revisão precisa cobrir os três idiomas.** As versões em inglês e espanhol
não são tradução juramentada nem revisão jurídica — foram escritas junto com o
código, como o português. Revisar só o português e apagar o aviso dos três
deixaria dois documentos legais no ar sem que ninguém os tenha lido. O que
protege hoje é a cláusula de prevalência, e ela é um remendo, não uma revisão.

**Duas lacunas de conteúdo que o advogado vai cobrar, e que nenhum código
resolve:**

- **O CNPJ da Boaventura Cafés Especiais Ltda não existe em fonte nenhuma** —
  nem no site institucional, nem neste repositório. Termos de uso sem o CNPJ de
  quem vende é lacuna real, e o número **não foi inventado** (há teste que falha
  se alguém escrever algo com cara de CNPJ ali). O cliente precisa fornecê-lo.
- **Confirmar que a LOJA é operada pela Boaventura Cafés Especiais Ltda.** A
  razão social veio das páginas do site institucional, que falavam do site
  informativo. Ninguém confirmou que a pessoa jurídica que vende café online é a
  mesma.
- **Encarregado de dados (DPO).** A LGPD (art. 41) exige indicar. A Política
  aponta hoje o e-mail comercial como canal do titular, e não declara que não há
  DPO — porque declarar isso por conta própria seria pior. Precisa de decisão.

**Enquanto isso:** confira também que o canal de contato prometido nas duas
páginas existe de verdade. Elas mandam o cliente exercer direitos de LGPD e
pedir troca "pelo canal do rodapé", que hoje é o botão de WhatsApp — e ele só
aparece se `NEXT_PUBLIC_WHATSAPP` estiver preenchida. Sem ela, a promessa fica
sem porta. Preencha a variável ou publique um e-mail de contato nos textos.

---

## 8. Backup — antes de vender, não depois

Supabase self-hosted **não tem backup automático nem PITR**. O script está
pronto (`scripts/backup-banco.sh`, com verificação do dump embutida e retenção),
e o runbook explica o agendamento. Falta:

- [ ] Agendar o cron (`scripts/backup-banco.cron.exemplo`).
- [ ] **Testar uma restauração ao menos uma vez.** Backup não testado é fé.
- [ ] Levar uma cópia para **fora da VPS** (o bloco do `rclone` está comentado
      no script, esperando credencial).

---

## 9. Verificação final

```bash
npm --prefix backend test      # banco, RLS, pagamento, cupons, Bling, LGPD, Clube
npm --prefix frontend run test # vitrine, checkout, SEO, analytics, i18n e o
                               # dicionário dos três idiomas
npm --prefix frontend run build # prova que generateStaticParams dá conta de
                               # idioma × slug e que não falta chave no dicionário
npm run verifica:rls           # a fronteira de RLS contra uma instância real
```

**O número de testes não está escrito acima de propósito.** Este documento já
afirmou "579", enquanto o README dizia "658" e o `producao.md` dizia "317" — da
mesma suíte, no mesmo dia. Contagem em documento envelhece mentindo. O que vale
é o piso medido em **22/08/2026**: **799 testes em 62 arquivos** na vitrine e
**398** no backend. Rode e leia o rodapé da execução; se o número tiver caído,
alguma coisa quebrou.

A suíte do backend **sobe um PostgreSQL temporário por arquivo de teste**. Ela
precisa de disco livre e de RAM: com pouco espaço, o `initdb` falha e ~175
testes caem em bloco com "Postgres nao subiu em 127.0.0.1:*". Se isso acontecer,
o problema é a máquina, não o código — os clusters abandonados ficam em
`%TEMP%/canastra-pg-*` e podem ser apagados.

O `verifica:rls` é o único que sai da máquina: ele prova o **caminho** inteiro
(GoTrue → Kong → PostgREST → política), não só a política. Ele **escreve** no
banco para o qual você apontá-lo — leia `producao.md` §8.1 antes.

E o checklist de conferência pós-deploy está em `deploy.md` §11.

---

## 10. A DECISÃO DE DOMÍNIO — e o mapa de redirects que depende dela

**Esta é a pendência nomeada da fusão dos dois sites, e ela é sua.** O código é
agnóstico de propósito: tudo que precisa saber o endereço do site lê
`NEXT_PUBLIC_SITE_URL` por uma função só (`frontend/lib/seo/jsonld.ts`,
`urlDoSite()`), e dela saem o `metadataBase`, o `sitemap.xml`, o `robots.txt`,
o `hreflang` e o JSON-LD. Trocar de domínio é trocar uma variável de ambiente e
subir de novo. **O que não é agnóstico é o que acontece com os endereços
antigos**, e é aí que se ganha ou se joga fora a autoridade orgânica que as duas
marcas acumularam.

### A decisão, em uma pergunta

**O site único atende em `cafecanastra.com` (raiz) ou em `loja.cafecanastra.com`
(subdomínio)?**

| | `cafecanastra.com` na raiz | `loja.cafecanastra.com` |
|---|---|---|
| **A favor** | É o endereço que a marca imprime, fala e divulga. Herda a autoridade do institucional, que é o mais antigo dos dois. Um domínio só para lembrar, para o cliente e para o Google. | Zero mudança no que já existe: nenhum link de loja, nenhum e-mail transacional e nenhum retorno de Mercado Pago muda de endereço. |
| **Contra** | **Todas** as URLs da loja mudam de host — e-mails de pedido antigos, links de confirmação do GoTrue, retorno do Mercado Pago, QR impresso. Cada um precisa de 301. | A raiz fica órfã ou vira redirect, e a marca continua com o endereço bonito apontando para outro lugar. O que se divulga não é o que vende. |
| **Custo** | um mapa de 301 grande, feito uma vez | um mapa de 301 menor, e uma decisão de marca adiada para sempre |

**Não há resposta técnica para isto.** É decisão de marca. O que existe de
técnico é a consequência, e ela está abaixo.

### O que fica travado enquanto a decisão não vier

- [ ] `NEXT_PUBLIC_SITE_URL` na VPS — e com ela `metadataBase`, `sitemap.xml`,
      `robots.txt`, `hreflang` e JSON-LD, que hoje caem no padrão de
      `urlDoSite()`.
- [ ] O certificado TLS e o `server_name` do nginx (`deploy/nginx/loja.conf`).
- [ ] A **allow-list de redirecionamento do GoTrue** e o `SITE_URL` dele. Sem
      atualizar, confirmação de e-mail e recuperação de senha mandam o cliente
      para o domínio antigo (`producao.md` §3.5).
- [ ] As URLs de retorno e de webhook do Mercado Pago.
- [ ] **O mapa de redirects 301 abaixo.**

### O mapa de redirects 301 — o esqueleto, à espera da decisão

Ele **não pode ser montado antes**, porque metade das linhas depende de qual dos
dois hosts sobrevive. O que já se sabe:

**Do institucional (`cafecanastra.com`) para cá.** As rotas foram absorvidas e
os endereços mudaram de forma:

| Endereço antigo | Destino | Observação |
|---|---|---|
| `/historia` | `/historia` | mesmo caminho — só muda o host, se mudar |
| `/en/historia`, `/es/historia` | `/en/historia`, `/es/historia` | o prefixo de idioma sobreviveu igual |
| `/sobre/origem` | `/a-serra` | era um stub vazio lá; o conteúdo real é o daqui |
| `/termos-uso` | `/termos-de-uso` | **o nome do caminho mudou** |
| `/politica-privacidade` | `/politica-de-privacidade` | **o nome do caminho mudou** |
| `/bio` | `/bio` | mesmo caminho |
| `/blog`, `/blog/*` | **decidir** | não existe rota de blog aqui: a seção da home é casca marcada "Em breve". Ou 301 para `/` até o blog existir, ou 410, ou manter o Next antigo no ar só para `/blog`. Redirecionar post para home é perda de sinal — assuma isso conscientemente |
| `/ANUGA` | **decidir** | fora do escopo desta entrega; hoje não existe destino |
| `/rastreabilidade01201516` (ou `/rastreabilidade/01201516`) | `/rastreabilidade` | **PRECISA DE CONFIRMAÇÃO.** O arquivo de referência do institucional se chamava `app_rastreabilidade01201516_page.tsx`, com um sufixo numérico que parece código de lote — possivelmente impresso em embalagem ou num QR. Não consegui recuperar o formato original a partir do nome achatado do arquivo. **Se houver embalagem no mercado com esse endereço impresso, este redirect é obrigatório** — abra o site antigo ou um pacote e confirme o formato exato antes de desligar o Next velho |

**Da loja (`loja.cafecanastra.com`) para cá.** Nenhuma URL pública mudou de
caminho nesta entrega — `/`, `/cafes`, `/cafes/[slug]`, `/clube`, `/a-serra`,
`/sacola`, `/checkout`, `/account`, `/pedido/[id]` são os mesmos. **Só há
trabalho aqui se o host mudar**, e nesse caso é um 301 de host inteiro,
preservando o caminho.

**Um cuidado que vale para os dois lados:** `/pt/qualquer-coisa` já é resolvido
pela própria aplicação com um 308 para `/qualquer-coisa`, e `/en/checkout` (e
irmãos) com um 308 para `/checkout`. Não escreva regra de nginx para esses dois
casos — duas camadas redirecionando o mesmo endereço produzem laço quando uma
delas mudar.

### Como conferir depois

```bash
# nenhum endereço antigo pode responder 404, e nenhum pode responder 200
curl -sI https://cafecanastra.com/termos-uso | head -1     # 301
curl -sI https://cafecanastra.com/blog                     # o que você decidiu
```

Depois do corte, reenvie os dois sitemaps antigos no Search Console e mantenha
os 301 **por pelo menos um ano** — é quanto tempo o buscador leva para
transferir sinal com segurança.

---

## 11. O que mudou de verdade nesta entrega

Para quem vem da leitura antiga do repositório, o resumo honesto:

- **A loja vende.** Antes, o botão "Adicionar à sacola" nunca funcionava, o
  checkout morria ao salvar endereço e o webhook do Mercado Pago respondia 200
  sem fazer nada — nenhum pedido sairia de "pendente". Isso acabou.
- **O painel mostra dado.** As oito telas estavam vazias; a de pedidos dizia
  "Nenhum pedido encontrado" quando na verdade o SQL falhava. Agora erro é erro,
  e o gestor tem exportação em CSV, cupons, rastreio, SKU e avaliações.
- **Existe caminho fiscal.** Bling e NF-e não existiam em lugar nenhum do
  projeto — nem código, nem planejamento. Agora existem, atrás de uma chave.
- **As promessas viraram verdade.** "Frete grátis acima de R$ 149" era texto
  fixo sem nenhuma regra por trás; cartão era prometido nos termos e não
  existia; o aviso de cookies era prometido na política e não existia. Os três
  fecharam.
- **Dá para medir.** GA4 com consentimento, JSON-LD de produto, sitemap e
  robots — a loja passa a ser encontrável e o funil, mensurável.
- **Os dois sites viraram um, em três idiomas.** `cafecanastra.com` contava a
  história e não vendia; esta loja vendia e não contava a história. Agora a
  história, a serra, a rastreabilidade, a `/bio` e os textos legais moram aqui,
  ao lado do catálogo, em português, inglês e espanhol — com `hreflang`
  completo e um sitemap de 42 URLs que sai das mesmas funções que geram o
  `<head>`. **As URLs em português não mudaram.** O que falta é a decisão de
  domínio (§10).
