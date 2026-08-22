# Plano: site único em produção

**Spec:** `docs/superpowers/specs/2026-08-22-site-unico-producao-design.md`
**Branch:** `producao-site-unico` (worktree `.worktrees/producao`)
**Execução:** ondas de subagents em paralelo, árvore compartilhada

**Baseline medido nesta branch, antes de qualquer mudança:**

- vitrine: **407 testes, 28 arquivos, verde**
- backend: **398 testes, 397 passam, 1 falha pré-existente** (identificada abaixo)

Nenhuma onda pode piorar esses números.

---

## A regra que sustenta o paralelismo

Vários agentes escrevem na **mesma árvore de trabalho** ao mesmo tempo. Não há
isolamento por worktree — eles precisam compor. O que impede o desastre é uma
coisa só: **cada arquivo tem um dono, e só o dono escreve nele.**

Arquivos com dono declarado abaixo. Três arquivos são **reservados** e nenhum
agente de onda toca neles — são costurados no fim, por um passo só:

- `frontend/components/layout/Cabecalho.tsx`
- `frontend/components/layout/Rodape.tsx`
- `frontend/app/sitemap.ts`

Quem precisa de rota nova na navegação **anota o pedido** no relatório de
retorno; não edita.

---

## Onda 1 — Fundação (serializada, é o único gargalo real)

Duas tarefas em paralelo entre si, mas **toda a Onda 2 espera esta onda**, porque
ela move `app/` inteiro e nenhum agente pode criar página numa árvore que está
sendo movida debaixo dele.

### 1A · Estrutura de i18n

**Dono de:** `frontend/app/**` (a movimentação), `frontend/middleware.ts`,
`frontend/lib/i18n/**`, `frontend/components/layout/SeletorDeIdioma.tsx`,
`frontend/app/robots.ts`

1. Mover `app/(vitrine)/` → `app/[locale]/(vitrine)/` com `git mv`, preservando
   histórico. Exceção: **sacola, checkout, account, pedido saem do grupo** e vão
   para `app/(transacional)/`, fora do `[locale]` — são pt-BR por decisão.
2. `lib/i18n/tipos.ts`: `LOCALES`, `Locale`, `LOCALE_PADRAO`.
3. `lib/i18n/dicionario.ts`: o objeto `pt` é a fonte do tipo; `en` e `es`
   declarados como `Dicionario`, para o compilador quebrar o build em chave
   faltante. Nesta onda basta o esqueleto: navegação, rótulos comuns e o aviso de
   "a compra segue em português". As traduções de conteúdo vêm na Onda 3.
4. `lib/i18n/rotas.ts`: helper `href(locale, caminho)` — em `pt` devolve o
   caminho cru, em `en`/`es` prefixa. **Todo link da vitrine passa a usá-lo.**
5. `middleware.ts`: adicionar o *rewrite* de locale **antes** da renovação de
   sessão do GoTrue, sem alterar o comportamento dela. `/cafes` → `/pt/cafes`
   internamente; a URL visível não muda. `/en/*` e `/es/*` passam direto.
   `middleware.test.ts` ganha caso para cada um dos três, e um que prova que a
   renovação de sessão continua acontecendo.
6. `generateStaticParams` da PDP passa a devolver locale × slug.
7. `<html lang>` por locale; `alternates.languages` (hreflang) no metadata de cada
   página traduzida.
8. `SeletorDeIdioma.tsx`: bandeiras pt/br, en, es. **Mobile-first** — em telefone
   é parte do menu, não um terceiro elemento espremido no cabeçalho. SVG inline,
   sem biblioteca de ícones. Anota o pedido de encaixe no Cabeçalho; não edita o
   Cabeçalho.

**Aceite:** `npm test` verde (407+), `npm run build` passa, `/`, `/cafes`,
`/en/cafes`, `/es/cafes`, `/checkout` respondem.

### 1B · Diagnóstico de performance

**Dono de:** `docs/performance-dev.md` (arquivo novo). **Não altera código.**

Mede, com número, cada hipótese da §5 do spec: compilação sob demanda, OneDrive,
API fora do ar, `next/image` no PNG de 3,7 MB. Compara `next dev` com
`next build && next start` para separar o que é do modo de desenvolvimento do que
é real.

Entrega um relatório com causa, evidência e custo de correção — e uma
recomendação explícita de **o que não vale corrigir**. O cliente pediu
investigação, não conserto especulativo.

O timeout do `repositorio.ts` **não é desta tarefa** — é da 2A, que já é dona do
arquivo.

---

## Onda 2 — Conteúdo e catálogo (5 agentes em paralelo)

Todos começam juntos, assim que a 1A entregar.

### 2A · Catálogo: moagem e descrições

**Dono de:** `frontend/lib/catalogo/**`, `frontend/components/catalogo/**`,
`frontend/lib/clube.ts`, `frontend/lib/sacola/**`,
`frontend/app/[locale]/(vitrine)/cafes/**`,
`frontend/app/[locale]/(vitrine)/clube/**`, `data/catalogo-canastra.json`

Por TDD, teste primeiro, em cinco passos que fecham cada um:

1. Separar `Moagem` (grão | moído) de `Metodo` (os seis de preparo). O teste que
   morde: `MOAGENS.length === 2` e `Preparo.metodo` aceita `aeropress`.
2. `variantesDa()` deixa de multiplicar "moído" por seis. O teste que morde: a
   contagem de variantes por linha cai, e o `skuLoja` de cada uma continua o
   mesmo de antes.
3. **Sacola gravada com moagem antiga.** Teste primeiro: um item com
   `moagem: "aeropress"` vindo do storage funde como `moido` e **não some**.
   Este é o teste mais importante da tarefa.
4. Remover o filtro "Moagem" da PLP; o "Formato" cobre o eixo.
5. Descrições reais das cinco linhas, com os números do spec §2 — incluindo
   **Microlote 86 SCA** e **Néctar de Minas 75 SCA**. O `SeloSCA` não pode
   anunciar "80+" numa linha de 75: ou respeita o valor, ou não aparece.

E, separado do resto: **timeout no `fetch` de `repositorio.ts:38`**, no mesmo
desenho do `lib/avaliacoes/servidor.ts:47`, com teste que prova que a vitrine cai
para o JSON quando a API não responde.

### 2B · `/historia`

**Dono de:** `frontend/app/[locale]/(vitrine)/historia/**`

Conteúdo em `scratchpad/ref/app_historia_page.tsx`, com as versões `en` e `es` ao
lado. Linha do tempo 1985 → 1996 → 2008 → 2016 → hoje, na estética da loja
(`estetica.md`), **sem `framer-motion`** — o repositório não tem essa dependência
e não vai ganhar uma por causa de animação de entrada.

Anota o pedido de link na navegação; não edita o Cabeçalho.

### 2C · Termos e privacidade

**Dono de:** `frontend/app/[locale]/(vitrine)/termos-de-uso/**`,
`frontend/app/[locale]/(vitrine)/politica-de-privacidade/**`

Texto do institucional (`scratchpad/ref/app_termos-uso_page.tsx`,
`app_politica-privacidade_page.tsx`, `politica.md`) dentro do `<PaginaTexto>` da
loja.

Adaptar, não copiar: cláusula que descreve o blog, o app ou a newsletter do
institucional não vale para esta loja. O trecho sobre meios de pagamento
condicionado a `NEXT_PUBLIC_MP_PUBLIC_KEY`, que já existe hoje, **permanece**.

**O `<AvisoJuridico>` só sai se o texto importado for de fato definitivo.** Na
dúvida, fica. Justificar a decisão no relatório.

### 2D · `/bio`

**Dono de:** `frontend/app/[locale]/(vitrine)/bio/**`

Links do institucional (loja, private label, atacado, assinatura empresarial,
site, blog, história), redesenhados na estética da loja. **Mobile-first é o
requisito principal** — é página de link de Instagram.

Externos com `target="_blank"` e `rel="noopener noreferrer"`.

### 2E · Blog "Em breve" + rastreabilidade

**Dono de:** `frontend/app/[locale]/(vitrine)/page.tsx` (a home),
`frontend/components/blog/**`

1. Seção de blog na home: desenhada, vazia, marcada "Em breve". Contrato de dados
   escrito no componente (título, resumo, imagem, data, slug) para que ligar a
   API depois seja trocar a fonte.
2. **Correção factual na home:** "Quarenta anos na mesma serra" é falso. São
   quarenta anos de café (1985, Patrocínio) e dezoito de Canastra (2008). O
   `/a-serra` também — mas quem corrige `/a-serra` é este agente, que ganha
   `frontend/app/[locale]/(vitrine)/a-serra/**` junto, mais as variedades reais
   (Araras, Caturra 2SL, Paraíso).
3. `/rastreabilidade`: link externo honesto para a base do Cerrado Mineiro, com
   aviso de que sai do site. Não é página de conteúdo.

---

## Onda 3 — Tradução (3 agentes em paralelo, depois da Onda 2)

Não dá para traduzir página que não existe.

### 3A · Dicionário de interface

**Dono de:** `frontend/lib/i18n/dicionario.ts`

Preenche `en` e `es` de tudo que a Onda 1 e a Onda 2 declararam. O build quebra
enquanto faltar chave — é essa a trava.

### 3B · Editorial do catálogo

**Dono de:** `data/catalogo-canastra.i18n.json`,
`frontend/lib/catalogo/produtos.ts` (só a fusão de tradução)

As cinco linhas em `en` e `es`. Locale sem tradução cai para `pt`, com teste.

### 3C · Páginas institucionais em en/es

**Dono de:** os arquivos de conteúdo criados em 2B, 2C, 2D

`/en/historia` e `/es/historia` já existem traduzidos no institucional —
aproveitar, não reescrever. Termos e privacidade traduzidos com a mesma cautela
jurídica: se o `<AvisoJuridico>` ficou em `pt`, fica nos três.

---

## Onda 4 — Costura e verificação

Passo único, não paralelo, sobre os três arquivos reservados e o todo:

1. `Cabecalho.tsx`: rotas novas + seletor de idioma. Mobile-first.
2. `Rodape.tsx`: coluna "A Canastra" ganha história e rastreabilidade.
3. `sitemap.ts`: todas as rotas × três locales, com `alternates`.
4. As duas suítes. Vitrine ≥ 407. Backend ≥ 397 passando.
5. `npm run build` de produção.
6. Varredura: nenhuma string pt cravada na superfície traduzida; nenhum link
   quebrado; 360 px conferido.
7. `README.md`, `docs/go-live.md` (decisão de domínio + mapa de redirects como
   pendência nomeada), `estetica.md` se a direção mudou.

---

## Instruções que valem para todo agente

1. **Leia o spec antes de escrever a primeira linha.**
2. **Quem toca em frontend invoca a skill `frontend-design`.** Sem exceção.
3. **Mobile-first.** 360 px é o alvo, não o caso degradado.
4. **Leia `estetica.md`** — é o design system, e ele manda.
5. **TDD onde há lógica.** Teste que falha, depois código.
6. **Só escreva nos arquivos que o plano te deu.** Precisou de outro? Anota no
   relatório e para.
7. **Não instale dependência nova.** Nem `framer-motion`, nem `next-intl`, nem
   biblioteca de ícone. Se achar que precisa, anota e para.
8. **Comentário explica o porquê, não o quê** — é a norma deste repositório, e ela
   é levada a sério.
9. **Não invente dado.** Sem fonte, o campo não existe. Metade dos comentários
   deste código são cicatrizes dessa lição.
10. **Não commite.** A costura commita.
