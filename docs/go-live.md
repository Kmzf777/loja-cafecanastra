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

Depois de tudo: faça **um cadastro completo e uma compra de R$ 1** em um
navegador limpo. É a única prova que vale.

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
  feita, remove-se o componente `AvisoJuridico` das duas páginas
  (`frontend/components/layout/PaginaTexto.tsx` é quem o define).
- **O que não dá:** ir ao ar com o aviso. Uma loja cujos próprios termos anunciam
  que não valem é pior do que uma loja sem termos.

Não removi o aviso por conta própria de propósito: apagá-lo não torna o texto
válido, só esconde do cliente que ele não foi revisado — e esta loja passou a
entrega inteira fechando promessas falsas, não criando novas.

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
npm --prefix frontend run test # vitrine, checkout, SEO, analytics
npm run verifica:rls           # a fronteira de RLS contra uma instância real
```

O `verifica:rls` é o único que sai da máquina: ele prova o **caminho** inteiro
(GoTrue → Kong → PostgREST → política), não só a política. Ele **escreve** no
banco para o qual você apontá-lo — leia `producao.md` §8.1 antes.

E o checklist de conferência pós-deploy está em `deploy.md` §11.

---

## 10. O que mudou de verdade nesta entrega

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
