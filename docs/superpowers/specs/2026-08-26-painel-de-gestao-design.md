# Painel de gestão — reescrita completa

**Data:** 26/08/2026 · **Branch:** `feat/painel-gestao`
**Antecede:** o plano de implementação (`docs/superpowers/plans/2026-08-26-painel-de-gestao.md`)
**Apoia-se em:** `docs/pesquisa/2026-08-26-paineis-ecommerce.md` (102 funcionalidades com fonte,
35 regras de UX) e `docs/pesquisa/2026-08-26-mapa-do-terreno.md` (8 mapeamentos do repositório,
o checklist de paridade da reescrita).

---

## 1. O que está errado hoje

O painel em `/dashboard` é um SPA de `createBrowserRouter` com styled-components, morando em
`frontend/legacy/`, montado como ilha client-only dentro do Next. Três consequências, todas medidas:

**Ele não pode obedecer ao design system.** Não por descuido — por decisão registrada.
`frontend/app/globals.css` não importa o preflight do Tailwind globalmente e restringe o scan a
`app/`, `components/` e `lib/` com `source(none)`, exatamente para o painel legado não quebrar. O
`legacy/globalStyle/GlobalStyle.jsx` reseta tudo para `font-family: sans-serif`. Enquanto o painel
viver ali, nenhum utilitário Tailwind é gerado para ele e nenhum token (`--color-fuligem`,
`--color-cal`, `--font-ui`) o alcança.

**A troca de banner é código morto.** `canastra.config_loja` tem `banner_desktop` e `banner_mobile`;
o painel legado faz upload dos dois; a vitrine nova **nunca lê essas colunas**. O herói da home é
`<Image src="/imagem-banner.jpg">`, arquivo estático, com kicker/título/texto numa tabela `TEXTOS`
dentro do próprio `page.tsx`. O gestor sobe uma imagem e ela não aparece em lugar nenhum. O mesmo
vale para `barra_de_aviso`: existe no banco, o Express a expõe como `announcement_bar`, o painel a
edita — e a vitrine usa o dicionário chumbado. É um campo *write-only*.

**A promoção desconta e ninguém vê.** `findActivePromotionsForCheckout` e `precoComPromocao`
abatem o valor na cobrança, mas — conforme o comentário em `PaymentController.js:192` — *"a vitrine
não renderiza preço promocional"*. O cliente vê R$ 60, paga R$ 54 e descobre no fim.

Somam-se: não existe área de marketing (só `newsletter_inscritos`, com e-mail e origem), a home do
painel são três contadores e dois gráficos (um deles um `PieChart`), as rotas ainda são
`/dashboard/products/addProduct` — inglês, herança do template original — e o cadastro de produto
não tem um único campo fiscal, apesar de a aceitação do cliente depender de NF-e sair pelo Bling.

---

## 2. Decisões

### 2.1 Reescrita completa, não migração incremental

O painel novo é construído inteiro em `frontend/app/dashboard/(protegido)/` antes de o legado sair.
Produção ainda não foi publicada: ninguém depende do painel legado hoje, então a janela de
convivência não custa nada e a alternativa (shell novo + áreas migrando uma a uma) pagaria o preço
de duas linguagens de estilo convivendo sem ganhar nada em troca.

O risco que sobra é **regressão silenciosa** ao reescrever telas densas — `Orders.jsx` tem 1.056
linhas e `BlingManager.jsx` 517, e há regra de negócio morando lá que não está documentada em lugar
nenhum. A mitigação é o checklist de paridade do mapa do terreno, e teste de contrato escrito
**antes** de cada tela ser reescrita.

### 2.2 Rotas reais do App Router, em português

O catch-all `[[...rota]]` e o `createBrowserRouter` morrem.

```
/dashboard                 home — fila de trabalho
/dashboard/pedidos         /dashboard/pedidos/[id]
/dashboard/produtos        /dashboard/produtos/[id]  /dashboard/produtos/novo
/dashboard/clientes        /dashboard/clientes/[id]
/dashboard/assinaturas     /dashboard/avaliacoes
/dashboard/descontos       /dashboard/descontos/[id]  /dashboard/descontos/novo
/dashboard/descontos/frete
/dashboard/marketing       newsletter · abandono · campanhas · whatsapp · automações
/dashboard/vitrine         herói · barra de aviso
/dashboard/relatorios
/dashboard/ajustes         loja · categorias · bling
```

**A cerca não muda e não deve ser tocada.** `(protegido)/layout.tsx` chama `exigirAdminNoPainel` e
envolve toda rota do grupo, inclusive as que ainda não existem — cada pasta nova nasce protegida por
herança. Continua valendo o aviso que o próprio layout documenta: **Route Handler não passa por
layout**, e o teste de estrutura em `lib/conta/painel-servidor.test.ts` falha se um `route.ts`
aparecer sob `/dashboard`. Se alguma tela precisar de um handler, a checagem vai na própria função.

### 2.3 Server Components por padrão

A lista renderiza no servidor lendo `searchParams`. Isso não é preferência de estilo: é a regra R2
da pesquisa — *"todo o estado da lista (busca, filtros, ordenação, página, colunas) mora na URL"* —
saindo de graça do framework, em vez de ser reimplementada com `useState`. Ilha cliente só onde há
interação real: formulário, seleção em massa, upload, prévia ao vivo.

Regra dura, herdada da vitrine: **nunca colocar CPF, e-mail ou endereço na query string.**

### 2.4 Quem chama o backend

O Express continua sendo a fonte da verdade — regra de negócio, webhook do Mercado Pago e Bling já
vivem lá, e duplicar isso no Next criaria um segundo lugar onde o preço pode divergir. Muda **quem
chama**: hoje o navegador chama com `authFetch` e o token no bundle; no painel novo quem chama é o
servidor do Next, que já tem a sessão via `criarClienteServidor`. O token para de trafegar no cliente
e `revalidatePath` passa a funcionar.

> **Verificação obrigatória antes da Onda 2:** o container do Next alcança o do Express na rede do
> deploy? Se não alcançar, o fallback é manter a chamada pelo cliente com `authFetch`. Muda pouco no
> desenho e nada no resto da spec.

### 2.5 O design system do painel: a etiqueta levada ao extremo

Não se inventa uma estética de admin aqui. O `estetica.md` já a contém: o conceito é *"a mão e a
etiqueta"* — a mão é gestual (serra, pincel, ~20% da tela), a etiqueta é rígida (filete de 1px,
grotesca condensada em caixa alta, monoespaçada, grid, ~80%). **Um painel administrativo é etiqueta
pura.** A mão aparece exatamente três vezes no painel inteiro: no login, na marca do menu lateral e
no estado vazio. Em nenhum outro lugar.

| Papel | Token | Por quê |
|---|---|---|
| Fundo da página | `--color-cal` `#F1F0EA` | cal fria, sem viés amarelo — o mesmo da loja |
| Fundo de ficha/tabela | `--color-cal-puro` `#FBFAF7` | a ficha "levanta" sem precisar de sombra |
| Menu lateral | `--color-fuligem` `#14110E` | a âncora escura; é a verdade do produto |
| Texto e **ação primária** | `--color-fuligem` | botão preto sólido, texto cal |
| Filete de tudo | `--color-fuligem-20` `#CFC8BE` | tabela, campo, ficha — 1px, nunca sombra |
| Texto secundário | `--color-fuligem-55` | rótulo, ajuda, metadado |
| **Erro e destrutivo** | `--color-vermelho` `#C4231E` | **só isso** |
| Sucesso / Alerta | `--color-sucesso` / `--color-alerta` | estado de pedido e de assinatura |
| Destaque não-semântico | `--color-juta` `--color-barro` `--color-mata` | badge de categoria, série de gráfico |

**A resolução do conflito de cor.** Na loja, `--color-vermelho` é o acento de marca. No painel ele
significa **exclusivamente** erro e ação destrutiva, e a ação primária vira o preto sólido. Isso é a
regra R21 — *"vermelho usado como destaque faz ninguém acreditar nos erros de verdade"*. A marca
continua presente no menu escuro, no lettering e na serra.

**Tipografia.** `--font-ui` (Archivo) para interface. `--font-dado` (monoespaçada) para **todo
número**: dinheiro, quantidade, data, SKU, CEP, código de rastreio. Isso entrega de graça a regra
R23 — numeral tabular, comparação por posição e não por comprimento. `--radius-cx: 0px` e
`--radius-bt: 2px` já são do sistema: painel de cantos retos, que é o que a densidade pede.

**Densidade** com base de 4px e escala tipográfica de 6 passos. Comprime o padding da célula;
**nunca** o alvo de toque — checkbox e botão continuam em ~44px (R22).

**Gráficos** só de linha (série temporal) e barra ordenada (comparação). R30 proíbe pizza, donut,
gauge, treemap e 3D — e o `PieChart` do `HomeDashboard.jsx` atual não sobrevive. Séries pintadas com
as cores de território, nunca com as semânticas.

### 2.6 O preflight escopado — a parede cai pelo mesmo mecanismo que a ergueu

Hoje o reset do Tailwind é escopado em `.vitrine`. O painel novo ganha um contêiner `.painel` com o
mesmo tratamento: dois escopos, um mecanismo, zero risco para o legado enquanto ele existir. Quando
`frontend/legacy/` for apagado, o arquivo simplifica sozinho.

**E aí vem um ganho que o mapa do terreno encontrou de brinde:** o CSP em `next.config.mjs:92` só
tem `'unsafe-inline'` e `'unsafe-eval'` por causa do styled-components (está escrito no comentário
de `:22-29`). Removido o legado, o CSP pode fechar. Isso entra na última onda, com a remoção.

### 2.7 shadcn/ui — a avaliação pedida

**Veredicto: usar os primitivos do Radix, com o shadcn como material de referência, não como
dependência nem como tema.** As razões, nos dois sentidos:

*A favor.* Quatro componentes deste painel dependem de posicionamento flutuante e gestão de foco
que é caro e arriscado escrever à mão: **DropdownMenu** (ações de linha), **Select/Combobox**
(escolher produto na regra de desconto), **Popover** (filtro e faixa de data) e **Tooltip** (fórmula
da métrica, R29). Somam-se **Dialog** com `modal={false}`, que é o painel lateral não-modal da tela
de Pedidos (R26). As regras R20, R24 e R34 exigem teclado e ARIA corretos — não é lugar para
improviso.

*Contra, e por isso não é o shadcn inteiro.* Primeiro, `npx shadcn init` reescreve o `globals.css`,
que aqui tem quarenta linhas de comentário explicando por que o preflight não é global e por que
`@theme static` não pode virar `@theme` — perder isso é perder a razão de o arquivo existir.
Segundo, o tema padrão do shadcn (`--background`/`--foreground` em oklch, `rounded-lg`, `shadow-sm`,
cinza neutro) é a estética que o `estetica.md` §2 rejeita nominalmente como *"o default de IA"*.
Entregar shadcn cru aqui seria fazer exatamente o que o documento de marca proíbe.

*Portanto:*

- Instalar os pacotes `@radix-ui/react-*` diretamente (checando compatibilidade com **React 18.3.1**
  — o shadcn atual mira React 19).
- Componentes adaptados vivem em `frontend/components/painel/ui/`, com o código do shadcn como
  referência de composição, reescrito para os tokens da Canastra **no mesmo commit**.
- **Proibido** no painel: `rounded-lg` e qualquer raio fora de `--radius-cx`/`--radius-bt`,
  `shadow-*`, paleta cinza neutra, cor em oklch, e os componentes `Card`/`Button`/`Input`/`Table`
  do shadcn.
- **Nativo, não Radix:** `<table>`/`<th>`/`<button>` com `aria-sort` (R24 é explícita: adotar
  `role="grid"` obrigaria a implementar navegação 2D por setas e roving tabindex na mão),
  `<input type="checkbox">`, `<input type="radio">` e `<select>` simples.

### 2.8 Testes — o padrão do repositório, não um padrão novo

O mapa do terreno mediu: o frontend roda **Vitest 4.1.10 com `environment: "node"`** — sem jsdom,
sem `@testing-library`, sem `setupFiles`. Teste de componente é `renderToStaticMarkup` do
`react-dom/server` com asserção sobre a string de HTML. **Não existe um único clique, `fireEvent` ou
interação em todo o repositório.** O backend roda `node --test` com um PostgreSQL 16 embarcado de
verdade, aplicando as migrações reais e assumindo papéis do Supabase.

Isso não vai mudar nesta reescrita. Introduzir jsdom e testing-library seria uma dependência nova e
uma segunda filosofia de teste convivendo com 779 casos escritos na primeira.

**A regra de arquitetura que decorre disso — e é a mais importante da spec:**

> **Toda tela do painel se divide em um módulo puro e uma casca JSX.** O módulo puro (`*.logica.ts`)
> não importa React nem faz fetch: ele contém filtro, ordenação, validação, formatação, derivação de
> estado, montagem de payload e decisão de o que exibir. Ele é testado exaustivamente. A casca JSX
> só desenha o que o módulo puro devolveu, e ganha um teste de render por string quando tem HTML
> que valha asserção (`aria-*`, rótulo, contagem de elementos).

Esse é o padrão que o repositório já usa e provou: `legacy/.../blingContrato.js` ("SEM React, SEM
fetch") tem 21 testes ao lado de um `BlingManager.jsx` com zero; `lib/conta/painel-servidor.ts` tem
`decidirAcessoAoPainel` pura e testada, com a casca impura sem teste.

**Mas o módulo puro sozinho não basta, e o mapa do terreno provou por quê.** Painel administrativo é
interativo por definição — barra de salvar que aparece quando o formulário suja, seleção em massa
que precisa distinguir "os 50 da página" de "os 1.284 do filtro", confirmação de exclusão, devolução
de foco ao fechar o painel lateral. Nenhuma dessas coisas tem hoje como ficar vermelha, e
`renderToStaticMarkup` não executa efeito: uma ilha de cliente que busca dados renderiza string
vazia e o teste passa **provando nada**.

Então são duas camadas, com fronteira explícita:

| Camada | Onde | O que cobre |
|---|---|---|
| **Módulo puro** (obrigatório) | `*.logica.ts`, sem React, sem fetch | filtro, ordenação, validação, formatação, derivação de estado, **montagem de payload**, decisão de exibição |
| **DOM** (só o que a pura não alcança) | `jsdom` + `@testing-library`, via `environmentMatchGlobs` restrito a `app/dashboard/**` e `components/painel/**` | estado sujo, foco, teclado, semântica de seleção em massa |

O `environmentMatchGlobs` é o que mantém os 779 testes existentes rodando exatamente como hoje, em
`environment: "node"`. A segunda filosofia fica presa ao painel e não vaza para a vitrine.

Três débitos que o mapa achou e que corrigimos de passagem, porque tocam o painel:

- O helper `function html(no: ReactElement)` está **copiado à mão em 20 arquivos**. Vira
  `frontend/lib/teste/html.ts`, e os arquivos novos usam o compartilhado.
- O CI (`.github/workflows/ci.yml`) roda o backend **sem `--test-concurrency=1`**, a flag que a
  suíte exige para passar. Corrigir nos dois lugares (`package.json` e workflow).
- Falta `.gitattributes`: o teste de instalação falha no Windows por CRLF, não por desatualização.

**E um passo que precisa vir cedo, não no último commit:** apagar `frontend/legacy/` leva junto os
únicos testes que cobrem comportamento que o painel novo vai reimplementar — 21 casos de
`blingContrato.test.ts` (a regra de NF-e) e 11 de `api.test.ts` (token, renovação única no 401,
não-renovação no 403, guarda de admin). **Mover para `lib/` antes**, não depois.

O motor de promoção ganha teste próprio de tabela-verdade: ordem de aplicação, empilhamento,
exclusividade, teto, mínimo, e devolução de uso em pedido cancelado. É código que decide preço — não
passa sem prova.

### 2.9 Numeração de migração: a faixa 0030+

Três branches disputam o número 0017: `worktree-melhor-envio` tem `0017_melhor_envio.sql`, e
`worktree-whatsapp-bot` tem de `0017_whatsapp_meta.sql` a `0021_redacao_whatsapp.sql`. Este trabalho
reserva a faixa **0030 em diante** — `0030_vitrine.sql` foi o primeiro a ser escrito, porque a fatia
da vitrine subiu para a Onda 2 do roteiro; o motor de promoção ficou com `0031`, que fica acima das duas e mantém a branch auto-contida. O runner
(`backend/db/migrar.js`) aplica por ordem de nome e registra em `canastra.migracoes`; buraco na
numeração não o incomoda.

**Risco registrado:** `worktree-whatsapp-bot` já tem opt-in de WhatsApp em `canastra.clientes`
(`whatsapp_optin_em`, `whatsapp_promo_optin_em`, `whatsapp_optout_em`), a função
`canastra.registrar_optin_whatsapp` e a tabela `canastra.whatsapp_mensagens`. Nossa tabela
`canastra.consentimentos` é agnóstica de canal e **não** recria essas colunas. Se aquela branch
entrar, uma migração de reconciliação funde as duas — está fora do escopo desta.

---

## 3. Modelo de dados

### 3.1 A decisão central: promoção e cupom viram uma entidade só

Hoje são duas tabelas que nunca se falam. `canastra.promocoes` é desconto de vitrine, aplicado por
produto em `utils/preco.js:23` com um `Math.min` ingênuo entre todas as promoções que casam.
`canastra.cupons` é desconto de checkout, aplicado sobre o subtotal. Elas divergem em silêncio:
cupom tem mínimo, limite de uso e janela opcional; promoção não tem mínimo, não tem limite e — esta
é uma armadilha real — **só é aplicada se `inicio_em` E `fim_em` estiverem preenchidos**, embora as
duas colunas sejam nuláveis. Uma promoção salva com `ativa = true` e sem datas nunca vale, sem aviso
nenhum.

A pesquisa mostrou que Shopify, Medusa e Saleor modelam isso como uma entidade com um campo
`metodo`: `automatico` aplica sozinho no carrinho, `codigo` exige o cliente digitar. Mesma regra,
porta de entrada diferente. Unificar dá **uma** tela, **uma** ordem de aplicação e **um** relatório.

### 3.2 `0031_motor_de_promocao.sql`

| Tabela | Carrega | Por que existe |
|---|---|---|
| `promocoes` (reescrita) | `metodo`, `classe` (`produto`/`pedido`/`frete`), `mecanica`, valor, **`teto_desconto_centavos`**, mínimo por valor *ou* quantidade, `prioridade`, `exclusiva`, `grupo_exclusividade`, janela, `habilitada`, orçamento | o cabeçalho da regra |
| `promocao_codigos` | N códigos por promoção, cada um com contador e `uso_unico` | 500 códigos de influencer, um relatório só |
| `promocao_escopo` | `(tipo, alvo, incluir bool)` — produto, categoria, SKU, todos | é o que permite "10% na loja toda, **menos** o micro-lote" |
| `promocao_faixas` | `(quantidade_min, desconto_tipo, desconto_valor)` | progressivo e leve-3-pague-2 checáveis no banco, não em jsonb solto |
| `promocao_frete` | UF, faixas de CEP, `teto_frete_centavos`, `apenas_modalidade_mais_barata` | §3.3 |
| `promocao_resgates` | uma linha por resgate: promoção, código, pedido, cliente, **hash do CPF**, valor | §3.4 |
| `pedido_ajustes_desconto` | uma linha por desconto aplicado, com alvo e sequência | §3.5 |

Vocabulário fechado por `CHECK`, não por validação só no JS: hoje `promocoes.tipo` e
`promocoes.aplica_a` são `text` sem `CHECK` nenhum.

Condição por meio de pagamento entra como `meios_pagamento text[]` em `promocoes` — é o desconto no
PIX, que a Nuvemshop só consegue aplicar global e aqui nasce com escopo por categoria.

### 3.3 Frete grátis com teto — o item que sangra margem toda semana

Hoje é um número global: `config_loja.frete_gratis_minimo_centavos = 14900`. A pesquisa foi direta:
*"café tem frete comparável ao produto; sem o teto, 'frete grátis acima de R$ 149' significa bancar
um SEDEX de R$ 90 para o Acre"*. A regra precisa de quatro campos que não existem: **UF ou faixa de
CEP**, valor mínimo, **teto do valor do frete** (acima disso a regra não vale) e **"só na modalidade
mais barata"** — sem o último, o cliente escolhe SEDEX de graça quando a loja queria bancar o PAC.

O CEP é normalizado para inteiro sem hífen **antes** de comparar. Comparar `'01310-100'` com
`'01310100'` é um bug que só aparece em produção, e esta loja já teve um dessa família no CEP de
origem (commit `7fe8d36`).

### 3.4 Limite por CPF, e por que não por e-mail

E-mail é infinito e gratuito — cupom de primeira compra controlado por e-mail é cupom permanente. A
Loja Integrada faz por CPF por isso. Guardamos o **hash SHA-256 do CPF** no resgate, nunca o número:
é mais uma cópia de dado pessoal, e as migrações 0013 e 0016 desta loja já pagaram esse preço uma vez.

E o resgate é a fonte da verdade do uso, não o contador `cupons.usos`. Duas razões: pedido cancelado
ou PIX expirado precisa **devolver** o uso, e é a tabela de resgates que sustenta o relatório de
campanha. A própria Shopify documenta que o contador denormalizado dela fica defasado.

O incremento continua atômico e dentro da transação de reserva de estoque, como já é em
`cuponsRepository.js:125-130` — o resgate é gravado na mesma transação.

### 3.5 O ajuste por linha — a fundação silenciosa

`pedido_ajustes_desconto` parece burocracia e não é. Sem uma linha por desconto aplicado não existe:
NF-e com desconto rateado por item (o Bling exige), estorno proporcional em devolução parcial, nem
resposta para *"por que este pedido saiu por R$ 137,40?"*. Sustenta §3.4, o relatório de cupom e a
integração fiscal ao mesmo tempo.

### 3.6 `0030_vitrine.sql` — herói e barra de aviso

Escopo escolhido: **um herói, sem carrossel** — o `estetica.md` §2 lista "carrossel de banner não
entra" entre as decisões deliberadas, e nada aqui a contraria.

```
vitrine_heroi         linha única: imagem_desktop, imagem_mobile, atualizado_em
vitrine_texto         (chave, locale) → kicker, titulo, texto, rotulo_botao, destino, imagem_alt
                      chave ∈ ('heroi','barra_aviso') · locale ∈ ('pt','en','es')
```

Imagens **globais** (não faz sentido pedir três uploads do mesmo herói); textos **por idioma**.

**Regra de segurança obrigatória:** os valores de hoje, chumbados na tabela `TEXTOS` de `page.tsx`,
viram o **fallback**. Linha vazia ou ausente no banco ⇒ a home aparece exatamente como aparece
agora. O herói nunca nasce em branco por causa de um campo não preenchido.

`config_loja.banner_desktop`/`banner_mobile` são migrados para `vitrine_heroi` e depois removidos.

### 3.7 `0032_marketing.sql`

`pedidos` ganha `utm_source`, `utm_medium`, `utm_campaign`, `utm_content`, `utm_term`, `canal`,
`referrer` e `landing_page`. É o item #2 do top 15 da pesquisa e a única coisa aqui que é
**irreversível**: nenhum relatório reconstrói depois de onde veio um pedido de três meses atrás.

Mais: `campanhas` (com **custo de mídia** — senão não há como saber se deu lucro, e `utm_campaign`
com `UNIQUE` para amarrar a atribuição), `envios` (log por destinatário, agnóstico de canal),
`automacoes` (gatilho → espera → condição → ação), `consentimentos` (canal, estado, **origem e
data** — a LGPD trata consentimento como estado com procedência, não como booleano) e
`carrinhos.token_retomada`, que é o que faz o link do e-mail de abandono devolver a pessoa ao
carrinho cheio.

`newsletter_inscritos` ganha `optout_em`, `token_descadastro` e `confirmado_em` — hoje não há como
alguém sair da lista, o que é um problema de LGPD e não de funcionalidade.

### 3.8 `0033_produto_fiscal_e_estado.sql`

`produtos` ganha o bloco fiscal que o Bling exige e que hoje não existe em nenhuma das 16 colunas:
`ncm` (8 dígitos), `cest` (7), `origem_fiscal` (0–8, tabela da SEFAZ), `gtin`, `gtin_embalagem`,
`unidade`, `tipo_item`, `cfop_padrao`, `csosn`, `peso_liquido` e `peso_bruto` — hoje há um `peso`
só, usado para **frete**, sem distinção entre líquido e bruto. Mais `codigo_bling` com `UNIQUE`,
para a integração parar de depender de buscar por SKU (`blingPedidos.js:286-292`).

Mais `estado` ∈ (`rascunho`, `ativo`, `arquivado`): **nada é deletado de verdade** (R13), porque
produto apagado quebra pedido histórico que aponta para ele.

E o **snapshot de custo**: `produtos.custo` existe, mas custo muda. Sem congelar o custo do item no
momento da venda não existe relatório de margem verdadeiro — recalcular com o custo de hoje mente
sobre o passado.

### 3.9 `0034_auditoria.sql`

`admin_log` (quem, o quê, entidade, antes, depois, quando) e `admins.papel`. Hoje não existe nenhum
registro de quem mexeu no painel, e `canastra.admins` tem só `user_id` e `criado_em`. Toda exportação
de lista com dado pessoal grava aqui quem exportou e quando — a pesquisa aponta isso como requisito
de LGPD, não como capricho.

### 3.10 RLS e GRANTs

Toda tabela nova segue o padrão que 0006 estabeleceu, sem exceção:

1. `ENABLE ROW LEVEL SECURITY` na criação — o padrão é negar.
2. `GRANT SELECT ... TO anon` **apenas** para o que a vitrine anônima precisa ler: `promocoes` (as
   ativas), `promocao_escopo`, `promocao_faixas`, `vitrine_heroi`, `vitrine_texto`.
3. Escrita só por admin, via política sobre `canastra.eh_admin()`.
4. `promocao_resgates`, `consentimentos`, `envios`, `admin_log` e `pedido_ajustes_desconto`
   **nunca** recebem `GRANT` para `anon` — carregam vínculo com pessoa.

---

## 4. As telas

Cada decisão abaixo é a aplicação de uma regra da pesquisa, citada pelo número.

### 4.1 Home — fila de trabalho, não vitrine de receita

*"O lojista não abre o painel para admirar receita, abre para saber o que embalar."* O topo é **o que
precisa ser feito hoje** — pedidos a despachar, pagamento pendente, assinatura com cobrança falhada,
avaliação a moderar, estoque baixo — e cada linha é um link para uma aba salva de verdade, não um
número decorativo. Só abaixo vêm 4 a 8 KPIs com comparação de período e um gráfico de linha de
receita por dia.

### 4.2 Pedidos — a tela que decide se o painel presta

| Decisão | Regra |
|---|---|
| Primeira coluna é `nº do pedido + nome`, nunca UUID | R23 |
| Busca sempre visível, jamais atrás de ícone | R1 |
| Busca, filtro, ordenação, página e colunas na URL | R2 |
| Filtro vira chip removível, com contagem e "Limpar tudo" | R3 |
| Abas salvas: *A despachar hoje*, *Pagamento pendente*, *Aguardando NF-e* | R4 |
| Seleção em massa distingue "os 50 desta página" de "os 1.284 do filtro" | R25 |
| Detalhe abre em **painel lateral não-modal, com próximo/anterior** | R26 |
| Exportação espelha o filtro e as colunas da tela | R27 |
| Paginação keyset. Nunca scroll infinito | R17 |

O painel lateral com próximo/anterior é o maior ganho operacional da tela: transforma triagem de 40
cliques em 12, e não cobre os dados de referência que a pessoa precisa consultar — que é justamente
o que um modal faz de errado.

### 4.3 Produtos

Lista com **edição em lote de preço e estoque**. Estado `rascunho`/`ativo`/`arquivado`. Ficha em
quatro abas: **Venda** (preço, custo, estoque, SKU) · **Conteúdo** (fotos, descrição, notas de sabor,
ficha da lavoura) · **Fiscal** (NCM, CEST, CFOP, GTIN, origem, unidade, pesos) · **SEO**.

Save bar contextual com Salvar e Descartar, e bloqueio de saída com alteração pendente (R5). Preço e
estoque **nunca** com autosave (R6): uma vírgula errada publica R$ 5,90 no lugar de R$ 59,00.

### 4.4 Descontos

Lista única de regras — método, classe, janela, status **derivado das datas** (nunca coluna
gravada), usos e valor já descontado. Formulário guiado em seis passos: *o que desconta → quanto →
para quem → o que inclui e o que exclui → requisitos e limites → janela*.

E uma coisa que nenhuma das plataformas pesquisadas faz: **simulador de carrinho na própria tela**.
"Num carrinho com 2× Clássico 250g = R$ 120, esta regra desconta R$ 12,00." Regra de desconto é onde
o erro custa dinheiro real, e a única defesa honesta é mostrar o resultado antes de salvar.

O formulário **exige** as duas datas quando o método é `automatico`, ou avisa em texto que sem elas
a regra não vale — a armadilha do §3.1 vira mensagem, não surpresa.

### 4.5 Vitrine

Herói e barra de aviso com **prévia ao vivo lado a lado com o editor** — R33 existe exatamente para
proibir o padrão de "editar às cegas e abrir a loja em outra aba para conferir". Abas de idioma
(pt/en/es), com o texto de hoje como valor inicial e como fallback.

### 4.6 Marketing

**Newsletter** — quem assinou, de onde veio, exportar *com log de quem exportou e quando*.
**Carrinho abandonado** — quem, quanto, o que o job enviou, se voltou; mais envio manual com desconto
decidido por carrinho. **Campanhas** — nome, canal, UTM, **custo de mídia** e resultado atribuído.
**WhatsApp** — monta o público, escreve a mensagem e entrega ao disparador existente.
**Automações** — lista de gatilhos com liga/desliga por item.

Sobre o WhatsApp, o que foi verificado: `Sites/Disparador` é um front Next que faz
`POST https://webhook.canastrainteligencia.com/webhook/disparador` com `{ mensagem, numeros }`. A
API do WhatsApp vive nessa automação, não em código deste repositório. O painel monta o público e
entrega. **Duas ressalvas que ficam registradas e não resolvidas nesta spec:** o webhook não tem
autenticação (quem souber a URL dispara), e mensagem em texto livre sugere API não-oficial, o que
muda o que é seguro disparar em volume. A tela avisa disso e exige consentimento registrado antes de
incluir alguém no público.

### 4.7 Relatórios

Sempre **tabela ordenável primeiro**; gráfico é opcional e deve poder ser desligado (R30). Fórmula
de cada métrica num tooltip e modelo de atribuição ao lado do número (R29) — senão, quando o número
divergir do extrato do Mercado Pago por desenho, a conclusão vai ser "o sistema está quebrado".
Datas em dd/mm/aaaa no fuso `America/Sao_Paulo`, sempre (R31).

Uma divergência conhecida que precisa estar escrita na tela: o evento `purchase` do GA4 dispara na
resposta síncrona do Mercado Pago, **inclusive para PIX ainda não pago** (`lib/analytics.ts:150-175`).
Cruzar GA4 com `canastra.pedidos` diverge por esse motivo, não por bug.

---

## 5. A vitrine muda em três lugares

### 5.1 Preço "de/por" — e a mina terrestre no caminho

Todo preço de tela passa por uma função só, `formatarPreco()` em `lib/catalogo/repositorio.ts:308`.
Os tipos `Variante`, `Kit` e `ProdutoVendavel` têm um campo `preco` e nenhum componente desenha
valor riscado.

**A mina, e por que ela é menos perigosa do que parecia.**
`PaymentController.js:203-213` compara com **tolerância zero** o subtotal declarado pelo navegador
contra o subtotal de catálogo **sem promoção**. O comentário de `:184-195` diz que isso só funciona
porque a vitrine hoje não renderiza preço promocional. No instante em que a vitrine passar a exibir
**e declarar** o preço promocional, todo pedido com promoção ativa vira 409 `PRECO_MUDOU` e a loja
para de vender.

**O conserto, depois de ler o código de perto, NÃO é mexer em `conferirSubtotal`.** A releitura
mostrou que o campo `subtotalCentavos` não significa "o que o cliente vai pagar" — significa *"o
que a tela do cliente somou a partir do catálogo"*, e existe só para o servidor perceber que a tela
está velha. O valor cobrado nunca sai dele. Então:

1. **A sacola continua guardando o preço de CATÁLOGO**, e `subtotalCentavos` continua sendo a soma
   dele. Exibir o preço promocional é uma decisão de *renderização*, não de armazenamento. Feito
   assim, a conferência atual continua correta e nada quebra — a mina não é pisada.
2. **Um campo novo e opcional**, `subtotalPromocionalCentavos`, carrega o que a tela exibiu, e é
   conferido com a mesma tolerância zero contra a soma de `precoComPromocao` no servidor. Isso pega
   a classe de erro que a exibição introduz — a tela mostrando promoção que já expirou.

O que **não** pode acontecer é o caminho ingênuo: passar a guardar o preço promocional na sacola e
deixar `subtotalCentavos` mudar de significado em silêncio. Aí sim os dois lados calculam sobre
bases diferentes e toda venda com promoção morre em 409.

A ordem continua sendo backend primeiro, com teste; exibição depois.

Segundo cuidado: `formatarPreco` é pt-BR/BRL fixo **de propósito** nos três idiomas. Trocar por
`Intl.NumberFormat(locale)` faria `/en` exibir outra moeda sem mudar o que o Mercado Pago cobra.

Terceiro: existem **dois vocabulários de card vivos** — `<CardProduto>` na home e `<CardCafe>` na
PLP, na PDP e no 404 de catálogo. Um mostra "a partir de" por linha, o outro preço exato por SKU. Os
dois precisam do tratamento de/por, e nenhum pode ser aposentado nesta onda.

### 5.2 Herói e barra de aviso vindos do banco

`generateStaticParams()` + `export const revalidate = 3600` fazem as três homes saírem do build.
Qualquer `cookies()`, `headers()` ou `searchParams` introduzido na home a derruba para render sob
demanda — o custo está medido em `docs/performance-dev.md §7`. A leitura do herói tem de ser
compatível com ISR: fetch com revalidação, nunca API dinâmica.

### 5.3 Captura de UTM

Capturar no primeiro contato, guardar junto do carrinho e enviar **no corpo** do checkout.

**Regra dura:** os campos novos entram no corpo e **nunca** na assinatura de `chaveDestePedido()`
(`lib/sacola/checkout.ts:243-259`). Chave de idempotência diferente numa retentativa é exatamente o
que cobra duas vezes quando a primeira resposta se perde na rede — está escrito no comentário de
`:235-242`.

---

## 6. Erros, dinheiro e estados

- **Erro nunca é toast** (R9): erro é banner persistente que a pessoa fecha. Flash auto-dismissível
  pode não ser anunciado por leitor de tela, some para quem usa ampliação e não pode ser relido.
- **Toast só para confirmação de ação reversível, com Desfazer** (R10).
- **Dinheiro não usa UI otimista** (R14): reembolso, cobrança e reserva de estoque mostram
  "processando" honesto até o servidor confirmar. O pior estado não é lento — é *"não sei se
  aconteceu"*.
- **Ação destrutiva** longe da confirmação, com peso e cor diferentes, nunca como primeiro item de
  menu (R11); o texto nomeia objeto e consequência: *"Cancelar a assinatura de Maria Souza? A
  cobrança de 12/09 não será feita."* (R12).
- **Três estados vazios distintos** (R16): nunca houve dado (ensina + criar), filtro sem resultado
  (limpar filtros), erro (tentar de novo).
- **Skeleton na forma do conteúdo**, com filtros e navegação interativos (R15).
- **Latência declarada na tela** (R28): "sem dados antes de dd/mm" mata metade dos chamados.

---

## 7. Riscos e armadilhas herdadas

Do mapa do terreno, o que quebra se ninguém perceber:

1. **`conferirSubtotal` com tolerância zero** — §5.1. O maior risco da spec.
2. **Chave de idempotência** — §5.3. Campo novo na assinatura cobra duas vezes.
3. **Promoção sem datas nunca é aplicada**, silenciosamente — §3.1.
4. **CEP com e sem hífen** não comparam — §3.3.
5. **`rotuloEmbalagem` e `nomeNaSacola` são em português sempre** e vão gravados na sacola, no
   pedido e no `item_name` do GA4. Traduzi-los quebra a continuidade dos relatórios.
6. **Host de imagem são dois lugares**: `images.remotePatterns` e a diretiva `img-src` do CSP.
   Esquecer o segundo dá imagem quebrada sem erro de servidor e sem teste vermelho.
7. **A miniatura da sacola usa `<img>` cru de propósito** — trocar por `next/image` "por
   consistência" a faz renderizar em branco.
8. **As rotas transacionais vivem fora do `[locale]` de propósito** — movê-las força recarga
   completa no meio do caminho que traz o dinheiro.
9. **`BarraFreteGratis` retorna `null` em três situações deliberadas** — um placeholder enquanto
   carrega troca o número na frente do cliente e parece erro de preço.
10. **`generateStaticParams` + `revalidate`** — API dinâmica na home a derruba para SSR por visita.

A lista completa, com 36 riscos e o checklist de paridade de 105 itens, está em
`docs/pesquisa/2026-08-26-riscos-da-reescrita.md`. **Nenhuma tela começa sem ler a seção
correspondente.**

---

## 7-B. Defeitos herdados que a reescrita corrige — e não copia

Estes são diferentes dos riscos acima: não é o que *quebra* se ninguém perceber, é o que já está
quebrado hoje e que uma reescrita fiel reproduziria achando que está sendo fiel.

**O formulário de produto manda `weight`, `width`, `height` e `length` sem ter input para nenhum
dos quatro** (`Form.jsx:394-397`, com o JSX de `:517-533` sem os campos). `undefined` vira a string
`"undefined"` no FormData, o backend não parseia e aplica os padrões 0,3 kg / 20 / 5 / 20 cm em
**toda edição**. A loja cota frete errado sem nenhum sinal na tela — e o comentário do arquivo diz
que o bug *foi corrigido*, o que faria a reescrita copiar o defeito acreditando copiar a correção.
O painel novo tem os quatro campos, carrega os valores reais e barra o envio com qualquer um vazio.

**Editar uma promoção fora da janela de datas a desativa para sempre e a torna inalcançável.** O
load muta `p.active = false` quando a data está fora da janela, `handleEdit` leva o valor mutado
para o formulário, o submit grava `ativa = false`, e o botão de reativar fica `disabled` pela mesma
regra (`PromotionsManager.jsx:84-107, 113-120, 161-165, 329-332`). Regra nova: **nunca mutar o
objeto do servidor**; "vigente/expirada" é derivado para exibição, e o toggle jamais é desabilitado
por causa da janela — corrigir a data é justamente o que o gestor precisa fazer.

**`PUT /config` parece total e é parcial ao contrário.** O UPDATE só inclui o que não for
`undefined`, mas o corpo chega por multipart e campo enviado **vazio** (`''`) sobrescreve.
`Number('')` é `0`, e `0` **desliga o frete grátis da loja inteira**. Um formulário controlado
ingênuo que sempre envia todos os campos apaga configuração de produção. A regra de omitir campo
vazio do FormData é mantida, com teste que salva a configuração com o campo de frete em branco e
prova que o valor no banco não mudou.

**`PUT /promotions/:id` não é parcial**: campo ausente vira `NULL`, e a rota responde `200
"Promoção atualizada."` mesmo para um id inexistente, tendo atualizado zero linhas. Como o motor de
promoção é reescrito, a rota nova nasce com UPDATE dinâmico e 404 em zero linhas afetadas.

**Cinco rotas de leitura são públicas de propósito** — `GET /dashboard`, `/dashboard/:id`,
`/config`, `/promotions`, `/options` não têm middleware. **Parece bug e não é**: a vitrine as
consome em Server Component sem sessão. "Consertar" pondo `isAdmin` derruba a loja. Se incomodar
expor `quantity` e dimensões, a saída é uma rota admin nova — nunca fechar a existente.

**A ordem de registro das rotas é load-bearing.** `/dashboard/summary` precisa vir antes de
`/dashboard/:id` (invertido, o summary vira produto de id `"summary"` e responde 404 **público**);
idem `/admin/orders/export` e `/users/me`. Os comentários que explicam isso ficam.

**Só 401 pode disparar renovação de sessão.** O backend responde **403** com corpo
`{message:"Sua conta ainda não está vinculada a esta loja."}` para um token perfeitamente válido —
tratar isso como sessão expirada cria laço infinito contra o GoTrue, e já aconteceu neste projeto.
E os 401/403 saem por `sendStatus`, ou seja **corpo vazio**: `await res.json()` sem `catch` quebra
com `SyntaxError` justamente no caminho menos testado. Um helper único de leitura de resposta, que
faça `res.json().catch(() => ({}))`, é obrigatório.

**As frases de erro do servidor são o diagnóstico.** Trocá-las por "Erro ao salvar" destrói o
suporte: o gestor abre chamado por algo que resolveria sozinho ("Já existe um produto com este
SKU.", "SKU tal não está cadastrado no Bling"). `fraseDeErro` de `blingContrato.js:243-292` vira
helper único do painel — e os dois pontos que hoje descartam a frase
(`PromotionsManager.jsx:200-203` e `ManageCategories.jsx:70`) são corrigidos, não copiados.

**A tarja de erro não é enfeite: é a diferença entre "zero" e "não sei".** Zero produtos e zero
vendas são números plausíveis; mostrar o estado inicial depois de um fetch falho é informação errada
apresentada com toda a confiança. Um `if (!data.length) return <Vazio/>` ingênuo apaga essa
distinção em seis telas de uma vez.

**A unidade monetária é inconsistente dentro do mesmo schema.** `total_amount`, `shipping_cost` e
`discount` vêm em **reais como string**; `minimo_centavos`, `preco_centavos` e
`frete_gratis_minimo_centavos` vêm em **centavos como inteiro**. Quatro telas definem um `moeda()`
próprio. Regra nova: **a unidade vai no nome do tipo e da variável** (`totalReais` vs
`totalCentavos`), com dois formatadores distintos e nomeados — nunca um que adivinha.

**Os 9 status de pedido estão copiados à mão em três arquivos** e o backend recusa qualquer outro
valor com 400. Uma constante compartilhada, com os valores separados dos rótulos, e um teste que
compare a lista do painel com a do backend.

**`productId` mora em memória volátil**: sair de uma edição sem salvar e clicar em "Cadastrar
produto" abre o formulário de **edição** do produto anterior, e salvar ali sobrescreve o produto
errado. No painel novo o id vive na URL — correção de graça, desde que ninguém porte o contexto.

**A trava de duplo clique do Bling está num `useRef` de propósito**, porque `setState` é assíncrono
e dois cliques no mesmo tick leem o mesmo estado "livre". Portar para `useState` reintroduz a
corrida sem sintoma em teste manual.

**A exportação de pedidos baixa a base inteira com CPF e e-mail** quando as datas ficam vazias — sem
confirmação, sem teto e sem auditoria. E o download precisa ser por **blob**, porque a rota exige
`Authorization` e um `<a href>` chega sem token. O formato do CSV (BOM + separador `;` + vírgula
decimal) é obrigatório, senão o Excel brasileiro do chefe abre tudo numa coluna só.

**O CORS aceita exatamente três cabeçalhos** (`Content-Type`, `Authorization`, `Accept`). Header
novo faz o *preflight* falhar, e o erro no console é de CORS, não de autenticação. Exceção que
merece investigação à parte: **`Idempotency-Key` é lido pelo checkout e não está na lista** — se não
estiver passando em produção, a defesa contra cobrança duplicada sumiu sem erro nenhum.

**Não existe caminho nenhum para criar, listar ou remover administrador** — a única escrita em
`canastra.admins` do repositório está no script de instalação. Promover um segundo gestor exige
`psql` em produção. Isso é risco operacional puro e entra no escopo.

---

## 7-C. Decisões que estavam abertas, e como ficaram

O mapa levantou 22 decisões. Resolvidas aqui:

| Decisão | Resolução |
|---|---|
| Modelo de acesso de Avaliações | **Rota no Express.** Um modelo de acesso só. Hoje é a única tela que fala direto com o PostgREST, e lá um não-admin atualiza zero linhas **sem erro** (semântica do `USING`) — o toast mente sucesso. |
| Numeração de migração | **0030+** (§2.9). O runner aborta em número repetido e a chave é o nome completo do arquivo — migração já aplicada **não** pode ser renomeada. |
| `PUT /promotions/:id` parcial | **Sim**, com 404 em zero linhas afetadas. O motor é reescrito de qualquer forma. |
| DELETE de promoção e cupom | **Soft delete** (`arquivada`), coerente com R13. |
| Paginação em `/cupons`, `/promotions`, `/admin/assinaturas` | **Sim**, nas rotas novas. Hoje devolvem a tabela inteira. |
| Como o painel lê `produtos.custo` | **Rota admin no Express**, que conecta como dono. A migração 0006 adiou essa decisão "para a tarefa que construir o painel" — é esta. `RETURNING *` responde 42501 nessa tabela até para admin; projetar coluna por nome, nunca `*`. |
| Endpoint de estoque | **`PATCH` próprio.** Hoje ajustar estoque obriga a reenviar o formulário inteiro por multipart, inclusive a imagem — que é como as medidas do pacote são apagadas. |
| Desconto de assinante em compra avulsa | **Entra**, como escopo `cliente = assinante` no motor. É barato dado o motor e é o benefício mais fácil de anunciar. |
| Campos write-only | Barra de aviso e herói **ligados na vitrine** (§3.6, §5.2). Imagem de produto: **fica fora desta onda** e a tela diz isso — a vitrine só lê `product_id`, `sku`, `price` e `quantity`. |
| Papéis e auditoria | `admins.papel` e `admin_log` **entram agora** (§3.9); a interface usa o log, não os papéis. |
| Exportação de CSV | Confirmação obrigatória quando as datas estiverem vazias, período máximo, e registro de quem exportou no `admin_log`. |
| Correções de privilégio | **Entram**, em `0035_correcoes_de_privilegio.sql`: `REVOKE UPDATE` em `clientes` com `GRANT` só de `(nome, telefone)` — hoje o cliente escreve o próprio CPF e o `UNIQUE` vira oráculo de enumeração; recorte de coluna no `SELECT` de `avaliacoes` — hoje qualquer token da instância compartilhada lê o `user_id` de todos os avaliadores; e `REVOKE DELETE` em `config_loja` — hoje um admin apaga a linha única junto com o refresh token do Bling. |
| Migrar produção antes | Produção **ainda não foi publicada** (confirmado). Construímos contra o schema do repositório. Subir as migrações continua sendo pré-requisito de deploy, não de desenvolvimento. |
| E2E no CI | **Fora.** O script de fumaça continua manual. |
| Cancelamento propagado ao Bling | **Fora**, divergência documentada. |

**Duas decisões que eu não posso tomar e ficam esperando você:**

1. **Série e natureza de operação da NF-e.** Os dois `POST` de emissão vão **sem corpo nenhum** —
   100% da regra fiscal vem da conta Bling. Se o contador pedir outra natureza de operação para
   venda a consumidor final fora do estado, não há onde configurar do lado da loja. Isso passa pelo
   contador, não pelo desenvolvedor.
2. **Política de inadimplência do Clube.** Quantas falhas antes de avisar, quantas antes de cancelar
   o preapproval, que mensagem vai ao cliente. Hoje **não há tratamento nenhum**: a cobrança que
   falha vira um pedido `rejeitado`, o cliente recebe um "Problema no pedido #xxxx" que nem menciona
   assinatura, e a assinatura continua `ativa` para sempre. Enquanto não houver política, **o painel
   novo não vai exibir nenhum indicador de saúde de assinatura** — mostrar "ativa" para quem não
   paga há meses é pior que não mostrar nada.

---

## 8. Fora de escopo, e por quê

- **Sistema de banners múltiplos com carrossel** — contraria o `estetica.md` §2 e não foi pedido.
- **CMS de blocos por página** — não foi pedido; risco alto de alguém desmontar a loja sem querer.
- **Papéis e permissões granulares** — o painel tem dois usuários. `admins.papel` nasce como coluna
  para não exigir migração depois, mas a interface não usa.
- **Integração oficial com a Meta (WhatsApp Cloud API)** — o disparador já existe fora deste repo.
- **Autogestão de assinatura pelo cliente e dunning do clube** — apareceram no top 15 da pesquisa
  (#11 e #12), são reais e valiosos, mas são o Clube, não o painel. Ficam registrados para a próxima.
- **Melhor Envio** — vive em `worktree-melhor-envio` com spec própria.
- **jsdom, testing-library e teste de interação** — §2.8.

---

## 9. Como se sabe que funcionou

1. `npm test` (frontend) e `npm --prefix backend test -- --test-concurrency=1` passam, com contagem
   maior que a de hoje (779 e 427).
2. `npx next build` passa sem erro de tipo.
3. O gestor consegue, sem tocar em código: trocar a imagem e o texto do herói nos três idiomas;
   criar um desconto de 10% no PIX que exclui o micro-lote e ver o simulador confirmar; criar frete
   grátis para o Sudeste acima de R$ 149 com teto de R$ 30; ver quem abandonou carrinho e disparar
   a recuperação; exportar os pedidos de um filtro; e ver quanto uma campanha vendeu.
4. Nenhuma tela do painel importa `styled-components`; `frontend/legacy/` não existe; o CSP não tem
   `unsafe-inline` nem `unsafe-eval`.
5. Um pedido com promoção ativa é criado sem 409 `PRECO_MUDOU`, com o preço promocional exibido na
   vitrine — o teste que prova o §5.1.
