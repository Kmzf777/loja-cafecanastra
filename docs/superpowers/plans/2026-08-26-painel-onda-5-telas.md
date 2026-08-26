# Painel de gestão — Onda 5: as telas

> **Para quem executa:** SUB-SKILL OBRIGATÓRIA — `superpowers:subagent-driven-development`.
> **Quem tocar em `frontend/` DEVE invocar `frontend-design:frontend-design` antes da primeira linha
> de JSX.** A direção estética **não** é escolha de quem executa: está fixada em `estetica.md` §3/§4
> e na §2.5 da spec. O que a skill acrescenta é rigor de acabamento.

**Goal:** o gestor opera a loja inteira pelo painel novo. Ao fim desta onda, o painel legado não tem
mais nenhuma tela sem substituto — e a Onda 7 pode apagá-lo.

**Architecture:** cada tela é **um módulo puro + uma casca**. O módulo (`*.logica.ts`) não importa
React e não faz fetch: nele vivem filtro, ordenação, validação, formatação, montagem de payload e
derivação de estado, e é ele que tem teste exaustivo. A casca JSX só desenha o que o módulo
devolveu. É o padrão que `blingContrato.js` e `painel-servidor.ts` já provaram nesta casa.

**Leitura obrigatória antes de qualquer tela:** a §4 da spec (as decisões por tela, cada uma citando
a regra de UX que a produziu); `docs/pesquisa/2026-08-26-riscos-da-reescrita.md` **inteiro** — é o
checklist de paridade de 105 itens, e é o que impede a reescrita de copiar defeito achando que copia
comportamento; e `docs/pesquisa/2026-08-26-paineis-ecommerce.md` §2, as 35 regras numeradas (R1–R35)
que a spec cita o tempo todo.

---

## As regras que valem para TODAS as telas

Cada uma vem de uma regra numerada da pesquisa. Não são preferências.

| Regra | O que fazer | Por quê |
|---|---|---|
| R1 | busca sempre visível, nunca atrás de ícone | é a ação mais frequente; um clique extra 200× por dia é imposto diário |
| R2 | busca, filtro, ordenação, página e colunas **na URL** | voltar do detalhe devolve a MESMA lista; sobrevive ao F5 |
| R3 | filtro vira chip removível, com contagem e "Limpar tudo" | filtro esquecido é lido como "sumiu meu pedido" |
| R5 | save bar contextual (Salvar + Descartar) e bloqueio de saída | o usuário nunca procura onde salvar nem perde trabalho |
| R6 | **autosave só onde o erro custa zero** | uma vírgula errada publica R$ 5,90 no lugar de R$ 59,00 |
| R9 | erro é **banner persistente**, nunca toast | flash pode não ser anunciado, some na ampliação, e não pode ser relido |
| R11/R12 | destrutivo longe da confirmação, e o texto nomeia objeto e consequência | "Tem certeza?" não carrega informação e treina a clicar em OK |
| R13 | nada é deletado: **arquiva-se** | produto apagado quebra pedido histórico |
| R14 | dinheiro **não** usa UI otimista | o pior estado não é lento, é "não sei se aconteceu" |
| R16 | três estados vazios distintos | use `EstadoDaTela`, que já existe |
| R17 | paginação, nunca scroll infinito | painel é tarefa, não descoberta |
| R18 | uma ação primária por página, sempre no mesmo lugar | |
| R23 | primeira coluna é identificador humano, nunca UUID; número em `data-dado` | comparar valores vira comparar posição |
| R25 | seleção em massa distingue "os 50 da página" de "os N do filtro" | senão o lojista acha que arquivou 1.284 quando arquivou 50 |
| R26 | detalhe em painel lateral **não-modal**, com próximo/anterior | modal cobre os dados de referência que a pessoa precisa consultar |
| R27 | exportação espelha filtro e colunas | exportar ignorando o filtro faz concluir que o painel perdeu dados |
| R31 | dd/mm/aaaa em `America/Sao_Paulo`, sempre | pedido carimbado em UTC aparece no dia errado no fechamento do mês |

**Nunca colocar CPF, e-mail ou endereço na query string** (R2 tem essa ressalva explícita).

**Use os primitivos que existem** em `components/painel/ui/` — `Ficha`, `Campo`, `Botao`, `Selo`,
`Tarja`, `Tabela`, `EstadoDaTela` — e a casca em `components/painel/casca/`. Primitivo novo só com
justificativa no relatório. O Radix já está instalado para menu, select, popover, tooltip e diálogo.

**As proibições de design** (`components/painel/ui/proibicoes.test.ts` varre e fica vermelho):
`rounded-lg` ou raio fora de `rounded-cx`/`rounded-bt`, `shadow-*`, paleta `gray-`/`slate-`/`zinc-`,
`oklch`, `role="grid"`, componentes do shadcn, e **vermelho como destaque**. Estenda a varredura
para as pastas novas, e prove que ela fica vermelha com uma violação temporária.

**Server Action:** `exigirAdminEmAcao()` na **primeira linha**, sempre. O layout não protege ação —
ela executa e só depois a página re-renderiza. Há teste de inventário que fica vermelho.

**Testes:** módulo puro no projeto `vitrine` (node); casca no projeto `painel-dom` (jsdom, helper
`renderizar`). A decisão vive na função pura; o DOM cobre só o que ela não alcança.

---

### Bloco A — leitura pura: Home, Clientes, Assinaturas

Comece por aqui. Elas exercitam o contrato, a paginação, a tarja e os formatadores **sem nenhum
risco de escrita destrutiva** — é onde os erros de contrato aparecem barato.

**Home — fila de trabalho, não vitrine de receita.** O topo é *o que precisa ser feito hoje*:
pedidos a despachar, pagamento pendente, assinatura com cobrança falhada, avaliação a moderar,
estoque baixo. **Cada linha é um link para uma aba salva de verdade**, não um número decorativo. Só
abaixo vêm 4 a 8 KPIs com comparação de período e um gráfico **de linha**.

> O `PieChart` do `HomeDashboard.jsx` não sobrevive: R30 proíbe pizza, donut e gauge, porque ângulo
> e área não são canais visuais precisos.

> **Não prometa indicador de saúde de assinatura.** Não existe dunning: cobrança que falha vira
> pedido `rejeitado` e a assinatura continua `ativa` para sempre. Mostrar "ativa" para quem não paga
> há meses é pior que não mostrar nada. A tela de Assinaturas diz isso em texto.

### Bloco B — Pedidos, e o Bling dentro dele

A maior tela do painel legado (1.056 linhas). Lista + detalhe em rota própria (`/pedidos/[id]`,
que agora tem `GET /admin/orders/:id`).

**O que não pode se perder** — do checklist de paridade:
- Os **9 status** vêm de `lib/painel/status.ts`, que já existe e tem teste comparando com o backend.
  Traduzir os **valores** em vez dos rótulos quebra toda mudança de status.
- A exportação é por **blob** (a rota exige `Authorization`; um `<a href>` chega sem token), e o CSV
  mantém **BOM + `;` + vírgula decimal**, senão o Excel brasileiro abre tudo numa coluna só.
- A exportação sem datas agora **exige confirmação** — o backend recusa com frase. Desenhe a
  confirmação, dizendo quantas linhas e que leva CPF e e-mail.
- O bloco do Bling vive **dentro do detalhe do pedido**, porque é ali que o gestor está quando
  percebe que a nota não saiu. Use `lib/painel/bling/contrato.ts`, portado com seus 21 testes.
  **Não reordene `estadoDoBling`**: a ordem é a da vida do documento fiscal, e `nfe_numero` sem
  chave é o estado que mais precisa de destaque porque *parece* resolvido e não está.
- A trava de duplo clique do Bling é um **`useRef`, não `useState`** — `setState` é assíncrono e dois
  cliques no mesmo tick leem o mesmo estado "livre".
- `mesclarPedido` mantém a **lista congelada de 9 campos**. Spread apagaria `address`, `user_name`,
  `user_email` e `user_cpf`, que a resposta de `/bling` não traz.

### Bloco C — Produtos

Lista com **edição em lote de preço e estoque** (usa o `PATCH /dashboard/:id/estoque` novo).
Estado `rascunho`/`ativo`/`arquivado` — e **rascunho não aparece na loja** (0038).

Ficha em quatro abas: **Venda** (preço, custo, estoque, SKU) · **Conteúdo** (fotos, descrição, notas)
· **Fiscal** (NCM, CEST, CFOP, GTIN, origem, unidade, pesos) · **SEO**.

> **Os quatro campos de medida têm de existir na tela.** O formulário legado enviava
> `weight/width/height/length` **sem input para nenhum**, e o backend aplicava os padrões em toda
> edição — a loja cotava frete errado sem sinal. O backend já foi consertado (preserva o valor atual),
> mas a tela precisa **mostrar e permitir editar** os quatro.
> **`custo` vem por rota própria** (`/admin/produtos/:id/custo`): a coluna não é legível por
> `authenticated` e `RETURNING *` responde 42501 até para admin.
> **Filtro "sem NCM / sem GTIN / sem peso"** na listagem — é pré-requisito para ligar a NF-e
> automática, e sem ele a falha aparece com o pedido do cliente parado.

### Bloco D — Descontos

A tela nova principal. Lista única de regras: método, classe, janela, **status derivado das datas**
(nunca coluna gravada), usos e valor já descontado.

Formulário guiado em seis passos: *o que desconta → quanto → para quem → o que inclui e o que
exclui → requisitos e limites → janela*.

**O simulador de carrinho na própria tela** — "num carrinho com 2× Clássico 250g = R$ 120, esta
regra desconta R$ 12,00". Regra de desconto é onde o erro custa dinheiro real, e a única defesa
honesta é mostrar o resultado antes de salvar. **Chame o motor de verdade** (`utils/motor.js`), por
uma rota de simulação — nunca reimplemente o cálculo no navegador, ou os dois divergem.

> **Não deixe salvar `mecanica = 'brinde'`** enquanto o motor não gerar ajuste para ela: hoje a regra
> salva e fica **inerte**, e o gestor não tem como saber.
> **Aviso na tela quando faltar data** — a armadilha legada era promoção `ativa` sem datas que nunca
> valia. No modelo novo data nula significa "vale sempre", que é o oposto: diga qual é.

### Bloco E — Marketing e Relatórios

**Marketing:** newsletter (com exportação que grava quem exportou), carrinho abandonado (quem,
quanto, o que o job enviou, se voltou), campanhas (com **custo de mídia** e o resultado atribuído),
WhatsApp (monta o público e entrega ao `webhook/disparador` existente), automações (liga/desliga).

> **O disparo de WhatsApp exige consentimento registrado** antes de incluir alguém no público. E a
> tela avisa das duas ressalvas do webhook: ele **não tem autenticação**, e mensagem em texto livre
> sugere API não-oficial.

**Relatórios:** sempre **tabela ordenável primeiro**; gráfico opcional e desligável (R30). Fórmula
de cada métrica num tooltip e o modelo de atribuição ao lado do número (R29).

> Uma divergência conhecida que precisa estar **escrita na tela**: o evento `purchase` do GA4 dispara
> na resposta síncrona do Mercado Pago, **inclusive para PIX não pago**. Cruzar GA4 com
> `canastra.pedidos` diverge por isso, não por bug.
> A atribuição junta **só por campanha** — `canastra.campanhas` tem `utm_campaign`, não
> `utm_source/medium`.

### Bloco F — Avaliações, Administradores, Ajustes

**Avaliações** passa a usar `/admin/avaliacoes` do Express (um modelo de acesso só). O `PATCH` em
lote devolve a contagem **real** de atualizadas — a tela mostra essa contagem, não a pedida.

> `avaliacoes.status` é `pendente|aprovada|oculta`. **Não existe `recusada`** — não invente na tela.

**Administradores** — a tela que nunca existiu. Listar, promover, remover. A remoção do último admin
responde **409 com frase**; a tela avisa **antes** de tentar.

**Ajustes** — loja, categorias, Bling. O campo de frete grátis **nunca** é enviado vazio (o backend
agora ignora vazio, mas a tela não deve depender disso).

---

## Como se sabe que a Onda 5 acabou

1. Todas as suítes verdes, com contagem maior.
2. `npm --prefix frontend run build` passa, e `/[locale]` continua **SSG**.
3. Nenhum item do checklist de paridade sem substituto — percorra os 105 e diga.
4. Nenhuma tela do painel novo importa de `frontend/legacy/`.
5. O gestor consegue, sem tocar em código: despachar um pedido e emitir a nota; cadastrar um café
   com NCM e peso; criar um desconto de 10% no PIX que exclui o micro-lote **e ver o simulador
   confirmar**; ver quem abandonou carrinho; exportar pedidos de um filtro; e promover um segundo
   administrador.
