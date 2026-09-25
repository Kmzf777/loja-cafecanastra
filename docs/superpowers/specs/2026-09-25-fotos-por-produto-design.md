# Foto por produto — o acervo do §8 chegou

**Data:** 25/09/2026 · **Branch:** `feat/fotos-por-produto`, tirada de `feat/painel-gestao`
**Antecede:** o plano de implementação (`docs/superpowers/plans/2026-09-25-fotos-por-produto.md`)
**Fonte do acervo:** Google Drive, pasta `Produtos Café Canastra` (20 subpastas numeradas,
`1-suave-250g-moido` … `20-drip-canela`), entregue pelo dono do projeto.

---

## 1. O que está errado hoje

**A foto é da LINHA, não do produto.** `frontend/lib/catalogo/produtos.ts:592` e `:598`:

```ts
/** A arte da linha a que um SKU pertence — os SKUs não têm foto própria. */
export function imagemDoProduto(p: ProdutoDoCatalogo): string {
  return arteDaLinha(p.linha);
}
```

As duas funções recebem o produto e o descartam. Consequência medida: os **14 SKUs da linha
Clássico** — 250 g, 500 g, 1 kg, grãos, moído, caixa de 4, drip e cápsula — mostram todos o mesmo
`/capa-classico.jpg`, que é o packshot do pacote de 250 g. Quem compra 1 kg vê um pacote de 250 g.
Quem compra drip vê um pacote de grãos.

Não foi descuido: era o acervo que existia. `frontend/components/catalogo/CardProduto.tsx:29`
declara isso em voz alta — *"A FOTO É A DA LINHA. Os SKUs não têm arte própria no acervo (§8 do
estetica.md segue como caminho crítico), e inventar uma seria pior que reusar a real."* O mesmo aviso
está em `tipos.ts:224` e em `produtos.ts:591`. **É esse aviso que esta mudança revoga**, e por isso
ele sai dos quatro lugares onde está escrito.

**O Néctar de Minas nunca teve arte.** `data/catalogo-canastra.json` carrega um campo
`imagemObservacao` que confessa o empréstimo: o pacote real é preto com a marca Néctar de Minas, e a
loja mostra a capa do Clássico no lugar dela.

**Três produtos do acervo novo não existem no catálogo.** `11-canela-250g-moido`,
`13-microlote-250g-moido` e `15-nectar-500g-moido`. A Canela só é vendida hoje dentro de kit, drip e
cápsula; o catálogo afirma que o Microlote é *"vendido só em 250 g, só em grão"*; o Néctar só existe
em 1 kg.

## 2. O acervo, conferido item a item

20 pastas, e **todas as 20 têm o par completo**: `N.1-frente-branco.png` (a capa, packshot em fundo
branco) e `N.2-frente-cor.png` (o mesmo pacote em estúdio, fundo da cor do produto — o que o dono do
projeto chama de "Capa2"). São PNG de ~2 MB, retrato.

As demais fotos de cada pasta **ficam de fora desta leva**, e o motivo está no próprio nome do
arquivo:

- `N.4/N.5-verso-rascunho.png` — **todos** os versos estão marcados `rascunho`.
- `N.3-lateral-rascunho.png` — a lateral dos 15 pacotes, também rascunho.
- `N.3-lateral-esquerda.png` + `N.4-lateral-direita.png` — as únicas laterais **finais**, e só nas 5
  caixas (`16-capsulas-classico`, `17-capsulas-canela`, `18-drip-classico`, `19-drip-suave`,
  `20-drip-canela`).

Publicar rascunho é publicar arte não aprovada. As 10 laterais finais das caixas cabem no slot
`Lote.fotos.terreiro`, que existe em `tipos.ts:329` e nunca foi preenchido — mas ficam para uma
segunda leva, decidida à parte.

## 3. Decisões

### 3.1 A foto desce da linha para o produto, com a linha como fallback

`data/catalogo-canastra.json` ganha `imagem` e `imagemEstudio` **opcionais** em `produtos[]`.
`linhas[]` mantém o par que já tem, e ele passa a ser explicitamente duas coisas: a foto de abertura
da linha (o card do `<CardCafe>`, a PDP, o Open Graph) e o fallback de quem não declarar a sua.

O fallback não é decoração: o kit de três linhas não tem arte própria (§3.5), e SKUs futuros
entrarão sem foto antes de entrarem com foto.

### 3.2 A costura é uma só, e já existe

`imagemDoProduto()` e `imagemEstudioDoProduto()` passam a preferir o produto:

```ts
export function imagemDoProduto(p: ProdutoDoCatalogo): string {
  return p.imagem ?? arteDaLinha(p.linha);
}
```

Isso basta para a home, a PLP, os kits e o `<PainelCompra>`, porque `ProdutoVendavel` **já carrega**
`imagem` e `imagemEstudio` por SKU (`tipos.ts:225`), e `comoVendavel()` em `repositorio.ts:388`
já os preenche chamando essas duas funções. A tubulação inteira estava pronta; só faltava o dado.

### 3.3 Os arquivos

`frontend/public/produtos/`, 40 JPEGs:

| | |
|---|---|
| `<base>.jpg` | a capa — fundo branco, vem de `N.1-frente-branco.png` |
| `<base>-cor.jpg` | o estúdio — fundo de cor, vem de `N.2-frente-cor.png` |

Os 20 `<base>` são o nome da pasta do Drive sem o número: `suave-250g-moido`, `classico-1kg-graos`,
`capsulas-canela`, `drip-classico`, e assim por diante.

A conversão de PNG ~2 MB para JPEG ~200 KB roda por um script no diretório de scratchpad da sessão,
com o `System.Drawing` do .NET que o Windows já tem. **Não entra dependência nova no repositório** —
nem `sharp` nem ImageMagick, nenhum dos dois está instalado, e um conversor de uso único não é
motivo para um binário nativo no `package.json`.

Os arquivos antigos (`/capa-classico.jpg`, `/capa-suave.jpg`, `/capa-canela.jpg`,
`/pacote-classico.jpg`, `/pacote-suave.jpg`, `/pacote-canela.jpg`, `/microlote-png.png`) **saem de
`public/`**. Deixá-los é manter duas gerações de foto no mesmo diretório esperando que alguém aponte
para a errada.

Além do JSON e de `DIMENSAO_DA_ARTE`, três lugares os citam pelo nome e acompanham a remoção:
`CardProduto.test.tsx:43` e `repositorio.test.ts:181`, que os usam como fixture, e o exemplo no
docstring de `seo/jsonld.ts:34`.

### 3.4 A medida continua vindo do arquivo

`DIMENSAO_DA_ARTE` (`produtos.ts:185`) troca suas 6 entradas pelas 40 novas, e `dimensaoDaArte()` segue
sendo o único lugar do repositório que guarda largura e altura. `produtos.test.ts:332` abre cada
arquivo em `public/` e falha se a medida declarada divergir da real — é o teste que protege o
orçamento de CLS < 0,05 do §10, e nem `tsc` nem `next build` enxergam esse erro.

A varredura do teste hoje percorre `lote.fotos`, isto é, só as 5 linhas. Ela passa a percorrer
também as fotos por produto.

**Risco a resolver na conversão, com número real na mão:** o `<CardCafe>` é 4:5, e as capas atuais
são 1400×1738 (exatamente 4:5, entram sem recorte). As fotos novas aparentam ~3:4. Se forem, o
`object-cover` do card volta a recortar. A medição vem antes da decisão — corrigir enquadramento ou
ajustar a caixa do card é escolha que só faz sentido com o número medido, e ela fica registrada no
plano de implementação.

### 3.5 O mapa de SKU para arquivo

Os 17 SKUs que casam direto com uma pasta recebem a sua. Os 9 multipacotes recebem a foto do pacote
unitário de que são feitos — a caixa de 4×500 g mostra o pacote de 500 g, não um pacote de 250 g:

| SKU | arquivo | por quê |
|---|---|---|
| `classico-graos-caixa-4x500` | `classico-500g-graos` | a caixa é feita desse pacote |
| `classico-moido-caixa-3x250` | `classico-250g-moido` | idem |
| `suave-moido-caixa-3x250` | `suave-250g-moido` | idem |
| `drip-classico-3-caixas`, `-6-caixas` | `drip-classico` | mesma caixa, mais unidades |
| `drip-canela-3-caixas`, `-6-caixas` | `drip-canela` | idem |
| `drip-suave-3-caixas` | `drip-suave` | idem |
| `capsula-classico-6-caixas` | `capsulas-classico` | idem |
| `capsula-canela-6-caixas` | `capsulas-canela` | idem |
| `capsula-classico-2-canela-1` | `capsulas-classico` | caixas misturadas; a predominante é a do Clássico |
| `capsula-classico-3-canela` | `capsulas-classico` | idem |

**A exceção declarada:** `kit-canela-classico-suave-moido-3x250` mistura três linhas e **nenhuma
foto do acervo mostra o kit**. Ele fica sem `imagem` própria, cai no fallback da linha Canela e leva
um comentário no JSON pedindo a arte — o mesmo tratamento que o Néctar recebeu enquanto não tinha a
sua, e que agora acaba.

As fotos de abertura de cada linha passam a ser o SKU de entrada: Clássico e Suave abrem com
`250g-graos`, Microlote com `250g-graos`, Néctar com `1kg-graos`, e **Canela com `canela-250g-moido`**,
que é a única foto de pacote Canela que o acervo tem.

Repare que `linhas[].imagem` aponta para um **arquivo**, não para um SKU: a linha Canela abre com
essa foto mesmo que o SKU `canela-moido-250` fique de fora por falta de preço (§3.6). As 40 imagens
entram em `public/` de qualquer forma.

### 3.6 Os três SKUs novos

`canela-moido-250`, `microlote-moido-250` e `nectar-de-minas-moido-500` entram no catálogo nesta
mesma leva, cada um com a sua pasta do Drive.

**Bloqueio declarado:** preço e estoque dos três dependem do dono do projeto. O catálogo inteiro é
construído sobre a regra de que nenhum campo é inventado — cada um declara sua `fonte`, e
`_leia_me.procedencia` lista as cinco procedências aceitas. Derivar preço do padrão dos vizinhos
seria `inferido`, e preço inferido é o único tipo de dado que a loja cobra de verdade. **Sem o
número, os três não entram**; o resto da leva não depende deles.

Entrar com R$ 0,00 também não serve: já existem 11 SKUs assim (todas as cápsulas e os drips
multi-caixa), e essa é uma dívida a pagar, não a aumentar.

O texto da linha Microlote — *"vendido só em 250 g, só em grão"* — passa a ser falso no momento em
que o moído entra, e é reescrito junto.

### 3.7 A galeria da PDP passa a acompanhar a seleção

Esta é a única parte que não é dado nem renomeação, e é o que faz a decisão aparecer na tela.

A PDP é **por linha**: existem 5 páginas (`/cafes/classico`, `/cafes/suave`, …), não 29. Em
`cafes/[slug]/page.tsx:164` a galeria é uma pilha estática de `<Image>` renderizada no servidor, e
ao lado dela mora o `<PainelCompra>` — um client component que guarda `moagem`, `peso` e `pacotes`
em `useState` (`PainelCompra.tsx:87-89`). A galeria nunca soube dessa escolha.

A seleção sobe para um wrapper client que renderiza galeria e painel juntos. **A primeira foto
continua renderizada no servidor com `priority`**: a PDP é estática por `generateStaticParams`
justamente porque é onde SEO e Open Graph valem dinheiro (§7.3, "a página mais importante"), e uma
galeria que só existe depois da hidratação entrega LCP tardio ao usuário e HTML vazio ao crawler. A
troca acontece no clique, sobre uma imagem que já está lá.

### 3.8 O seed acompanha

`backend/db/seed.js:195` grava `urlDaImagem(linha.imagem)` em `canastra.produtos.imagem`. Passa a
gravar a foto do produto, com o mesmo fallback. Sem isso a vitrine mostraria o pacote certo e a
sacola — que copia `imagem` do banco na hora de adicionar o item (`0004_enderecos_e_carrinho.sql:36`)
— mostraria o errado, e a divergência só apareceria comparando duas telas.

## 4. O que NÃO muda

- **A Cloudinary e o painel.** O upload de imagem de produto do painel
  (`backend/src/middleware/multer.js`) continua como está. A vitrine segue lendo arquivo estático de
  `public/`; a decisão de unificar os dois caminhos não é desta leva.
- **A estrutura de `linhas[]`.** Nenhum campo sai; `imagem` e `imagemEstudio` mudam de papel, não de
  forma.
- **O `<CardCafe>`.** Continua mostrando a linha e o crossfade capa × estúdio. O que muda é qual
  arquivo ele recebe.

## 5. Critérios de aceitação

1. `frontend/public/produtos/` tem 40 JPEGs, e nenhuma das 7 artes antigas sobrou em `public/`.
2. `produtos.test.ts` passa, com a varredura de w/h cobrindo as fotos por produto além das de linha.
3. Os 29 SKUs existentes resolvem para o arquivo da tabela do §3.5; o kit cai no fallback e o teste
   afirma que ele cai.
4. Nenhum `imagemObservacao` sobra no Néctar.
5. Os quatro comentários que afirmam *"os SKUs não têm foto própria"* (`produtos.ts:591` e `:597`,
   `tipos.ts:224`, `CardProduto.tsx:29`) foram reescritos — um comentário que descreve o mundo
   anterior mente com a mesma eficácia de um código errado.
6. Na PDP, trocar peso ou moagem troca a foto; a primeira foto continua no HTML servido.
7. `npm test` no frontend e no backend passa, o backend com `--test-concurrency=1`.
8. Os três SKUs novos ou entraram com preço e estoque de procedência declarada, ou não entraram —
   nunca com R$ 0,00.

## 6. Riscos

| risco | mitigação |
|---|---|
| A proporção nova não é 4:5 e o card recorta | Medir na conversão, antes de escrever `DIMENSAO_DA_ARTE`; decidir com o número |
| A galeria client atrasa o LCP da página mais importante do site | Primeira foto no servidor com `priority`; a troca é só no clique |
| 40 arquivos novos incham o repositório | JPEG ~200 KB cada, ~8 MB no total, contra ~80 MB dos PNGs crus |
| Os três SKUs novos travam a leva inteira | Não travam: são independentes do resto e entram por último |
