# Foto por produto — plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cada SKU do Café Canastra passa a mostrar a foto do seu próprio pacote, em vez da foto da linha — 40 imagens novas, uma capa e uma foto de estúdio para cada um dos 20 produtos do acervo.

**Architecture:** A foto desce de `linhas[]` para `produtos[]` em `data/catalogo-canastra.json`, com a linha como fallback. A costura é `imagemDoProduto()`/`imagemEstudioDoProduto()` em `frontend/lib/catalogo/produtos.ts`, que hoje recebem o SKU e o descartam — a tubulação até `ProdutoVendavel`, os cards e o `<PainelCompra>` já existe e já lê esses dois campos. Só a galeria da PDP é código novo: ela passa a acompanhar a seleção de peso e moagem.

**Tech Stack:** Next.js App Router (React Server Components), TypeScript, Vitest, Node `node:test` no backend, PostgreSQL. Conversão de imagem por `System.Drawing` do .NET via PowerShell — sem dependência nova no `package.json`.

**Spec:** `docs/superpowers/specs/2026-09-25-fotos-por-produto-design.md`

---

## Estrutura de arquivos

| arquivo | responsabilidade | tarefa |
|---|---|---|
| `frontend/public/produtos/*.jpg` | 40 JPEGs, o acervo novo | T1 |
| `data/catalogo-canastra.json` | fonte única: `produtos[].imagem`, `linhas[].imagem` | T2 |
| `frontend/lib/catalogo/produtos.ts` | resolução da foto + `DIMENSAO_DA_ARTE` | T3 |
| `frontend/components/catalogo/galeria.logica.ts` | **novo** — a decisão pura: seleção → lista de fotos | T4 |
| `frontend/components/catalogo/GaleriaDoLote.tsx` | **novo** — galeria client que segue a seleção | T4 |
| `frontend/components/catalogo/PainelCompra.tsx` | ganha o callback `onSelecao` | T4 |
| `frontend/app/[locale]/(vitrine)/cafes/[slug]/page.tsx` | passa a montar galeria e painel juntos | T4 |
| `backend/db/seed.js` | grava a foto do produto no banco | T5 |
| `frontend/lib/seo/jsonld.ts`, `*.test.tsx`, `*.test.ts` | fixtures e docstrings que citam as artes antigas | T6 |

## Ordem e paralelismo

```
Onda 0   T1  acervo em public/produtos/ + manifesto      (sequencial, browser + conversão)
Onda 1   T2  data/catalogo-canastra.json                 (sequencial, 1 agente)
Onda 2   T3  tipos.ts + produtos.ts                      (sequencial, 1 agente)
Onda 3   T4 ‖ T5 ‖ T6                                    (3 agentes em paralelo)
Onda 4   T7  os três SKUs novos                          (bloqueada: falta preço)
```

**As ondas 0 a 2 são uma corrente, e não adianta fingir o contrário.** T3 depende de T2 porque `ProdutoBruto` é `typeof bruto.produtos[number]`: sem o campo no JSON, `p.imagem` não compila. T2 depende de T1 porque seus testes abrem os arquivos. Paralelizar aí seria inventar concorrência para esperar do mesmo jeito.

**A onda 3 é paralela de verdade**, porque os três conjuntos de arquivos são disjuntos:

| | T4 | T5 | T6 |
|---|---|---|---|
| toca | `components/catalogo/galeria.logica.ts`, `GaleriaDoLote.tsx`, `PainelCompra.tsx`, `cafes/[slug]/page.tsx` | `backend/db/seed.js`, `backend/test/seed.test.js` | `components/catalogo/CardProduto.tsx` e `.test.tsx`, `lib/catalogo/repositorio.test.ts`, `lib/seo/jsonld.ts`, `public/*.jpg` |
| suíte | `vitest --project vitrine` | `node --test --test-concurrency=1` | `vitest --project vitrine` |

T4 e T6 rodam a mesma suíte, em arquivos diferentes. O único cuidado é que **T6 apaga as artes antigas**: confira antes de disparar a onda que o grep do T6 Step 4 não encontra nada dentro de `GaleriaDoLote.tsx`.

---

### Task 1: O acervo entra no repositório

**Files:**
- Create: `frontend/public/produtos/` (40 arquivos `.jpg`)
- Create: `<scratchpad>/converter.ps1` (script de uso único, **não** entra no repo)
- Create: `<scratchpad>/manifesto.txt` (a medida real de cada arquivo)

- [ ] **Step 1: Baixar a pasta do Drive**

No Google Drive, botão direito na pasta `Produtos Café Canastra` → **Fazer download**. O Drive
compacta as 20 subpastas num `.zip` de ~200 MB e o entrega em `C:\Users\rafae\Downloads`.

- [ ] **Step 2: Descompactar no scratchpad**

```bash
SCRATCH="$(cygpath -u "$TEMP")/claude-canastra-fotos"
mkdir -p "$SCRATCH"
cd "$SCRATCH"
unzip -o "/c/Users/rafae/Downloads/Produtos Café Canastra"*.zip -d acervo
find acervo -name "*frente*.png" | sort | head -5
```

Esperado: caminhos no formato `acervo/Produtos Café Canastra/7-classico-250g-graos/7.1-frente-branco.png`.

- [ ] **Step 3: Conferir que o par está completo nas 20 pastas**

```bash
cd "$SCRATCH"
echo "frente-branco: $(find acervo -name '*frente-branco.png' | wc -l)"
echo "frente-cor:    $(find acervo -name '*frente-cor.png' | wc -l)"
```

Esperado: `20` nas duas linhas. Se vier menos, **pare** e relate quais pastas faltam — o plano
assume o par completo.

- [ ] **Step 4: Converter e renomear**

O nome de destino é o nome da pasta sem o número: `7-classico-250g-graos` → `classico-250g-graos`.
`frente-branco` vira `<base>.jpg`, `frente-cor` vira `<base>-cor.jpg`. O lado maior cai para 1400 px
(a medida das capas atuais) e a qualidade JPEG é 82.

```powershell
Add-Type -AssemblyName System.Drawing
$origem  = "$env:TEMP\claude-canastra-fotos\acervo"
$destino = "C:\Users\rafae\OneDrive\Desktop\Canastra Inteligencia\loja oficial cafe canastra\frontend\public\produtos"
New-Item -ItemType Directory -Force $destino | Out-Null

$codec = [System.Drawing.Imaging.ImageCodecInfo]::GetImageEncoders() | Where-Object { $_.MimeType -eq 'image/jpeg' }
$params = New-Object System.Drawing.Imaging.EncoderParameters 1
$params.Param[0] = New-Object System.Drawing.Imaging.EncoderParameter ([System.Drawing.Imaging.Encoder]::Quality, 82)

Get-ChildItem -Path $origem -Recurse -Filter "*frente-*.png" | ForEach-Object {
  $base = $_.Directory.Name -replace '^\d+-', ''
  $sufixo = if ($_.Name -match 'frente-cor') { '-cor' } else { '' }
  $alvo = Join-Path $destino "$base$sufixo.jpg"

  $img = [System.Drawing.Image]::FromFile($_.FullName)
  $escala = 1400 / [Math]::Max($img.Width, $img.Height)
  if ($escala -gt 1) { $escala = 1 }
  $w = [int]($img.Width * $escala); $h = [int]($img.Height * $escala)

  $bmp = New-Object System.Drawing.Bitmap $w, $h
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
  $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
  # O PNG de origem pode ter alpha; o JPEG nao tem. Fundo branco antes de desenhar
  # evita que a transparencia vire preto no packshot de fundo claro.
  $g.Clear([System.Drawing.Color]::White)
  $g.DrawImage($img, 0, 0, $w, $h)
  $bmp.Save($alvo, $codec, $params)

  $g.Dispose(); $bmp.Dispose(); $img.Dispose()
  Write-Output "$base$sufixo.jpg $w x $h"
}
```

- [ ] **Step 5: Conferir a contagem e o peso**

```bash
cd "C:/Users/rafae/OneDrive/Desktop/Canastra Inteligencia/loja oficial cafe canastra"
ls frontend/public/produtos | wc -l
du -sh frontend/public/produtos
```

Esperado: `40` arquivos e um total abaixo de 15 MB. Se passar disso, baixe a qualidade para 78 e
rode o Step 4 de novo.

- [ ] **Step 6: Medir e gravar o manifesto**

```bash
cd "C:/Users/rafae/OneDrive/Desktop/Canastra Inteligencia/loja oficial cafe canastra"
node -e '
const {readdirSync,readFileSync}=require("fs");
const dir="frontend/public/produtos";
const medir=(b)=>{ // JPEG: varre os marcadores ate um SOFn
  let i=2;
  while(i<b.length){
    if(b[i]!==0xFF){i++;continue}
    const m=b[i+1];
    if(m>=0xC0&&m<=0xCF&&m!==0xC4&&m!==0xC8&&m!==0xCC)
      return {h:b.readUInt16BE(i+5),w:b.readUInt16BE(i+7)};
    i+=2+b.readUInt16BE(i+2);
  }
  return null;
};
for(const f of readdirSync(dir).sort()){
  const d=medir(readFileSync(dir+"/"+f));
  console.log(`  "/produtos/${f}": { w: ${d.w}, h: ${d.h} },`);
}' | tee "$TEMP/claude-canastra-fotos/manifesto.txt"
```

Esperado: 40 linhas no formato exato de uma entrada de `DIMENSAO_DA_ARTE`. **Guarde a saída** — a
Task 3 cola esse bloco.

- [ ] **Step 7: Conferir a proporção**

```bash
awk -F'[:,} ]+' '/produtos/ {print $4, $6, $6/$4}' "$TEMP/claude-canastra-fotos/manifesto.txt" | sort -k3 -u | head
```

O `<CardCafe>` é 4:5, ou seja, altura/largura = 1,25. Se a razão vier ~1,33 (3:4) e for **uniforme**,
siga: `object-cover` recorta 6% da altura, dentro do que o card já fazia com as artes quadradas. Se
vier **irregular** entre arquivos, pare e relate — proporção mista no mesmo grid é o que o §10 do
`estetica.md` chama de estouro de CLS.

- [ ] **Step 8: Commit**

```bash
cd "C:/Users/rafae/OneDrive/Desktop/Canastra Inteligencia/loja oficial cafe canastra"
git add frontend/public/produtos
git commit -m "feat(acervo): as 40 fotos de produto entram em public/produtos

20 produtos, cada um com a capa em fundo branco e a foto de estudio em
fundo de cor. Vem do Drive 'Produtos Cafe Canastra', convertidas de PNG
de ~2 MB para JPEG de 1400 px no lado maior.

Nenhum SKU aponta para elas ainda — isso e a Task 2.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 2: O JSON aponta cada SKU para a sua foto

**Files:**
- Modify: `data/catalogo-canastra.json`

- [ ] **Step 1: Escrever o teste que falha**

Acrescente em `frontend/lib/catalogo/produtos.test.ts`, dentro do `describe` que já cobre o
catálogo:

```ts
it("todo SKU com foto propria aponta para um arquivo que existe", () => {
  for (const p of PRODUTOS) {
    if (!p.imagem) continue;
    const caminho = join(PUBLIC, p.imagem.replace(/^\//, ""));
    expect(existsSync(caminho), `${p.sku}: ${p.imagem} nao existe em public/`).toBe(true);
    if (p.imagemEstudio) {
      const estudio = join(PUBLIC, p.imagemEstudio.replace(/^\//, ""));
      expect(existsSync(estudio), `${p.sku}: ${p.imagemEstudio} nao existe`).toBe(true);
    }
  }
});

it("so o kit de tres linhas fica sem foto propria", () => {
  const semFoto = PRODUTOS.filter((p) => !p.imagem).map((p) => p.sku);
  expect(semFoto).toEqual(["kit-canela-classico-suave-moido-3x250"]);
});
```

`PRODUTOS` já é exportado de `produtos.ts:555`. `PUBLIC` e `existsSync` já estão importados no topo
do arquivo de teste.

- [ ] **Step 2: Rodar e ver falhar**

```bash
cd frontend && npx vitest run lib/catalogo/produtos.test.ts -t "foto propria"
```

Esperado: FALHA — `semFoto` traz os 29 SKUs, não só o kit.

- [ ] **Step 3: Acrescentar `imagem` e `imagemEstudio` a cada produto**

Em `data/catalogo-canastra.json`, cada entrada de `produtos[]` ganha os dois campos. O mapa completo
— `<base>` significa `/produtos/<base>.jpg` e `/produtos/<base>-cor.jpg`:

| sku | base |
|---|---|
| `classico-graos-250` | `classico-250g-graos` |
| `classico-graos-500` | `classico-500g-graos` |
| `classico-graos-1000` | `classico-1kg-graos` |
| `classico-graos-caixa-4x500` | `classico-500g-graos` |
| `classico-moido-250` | `classico-250g-moido` |
| `classico-moido-500` | `classico-500g-moido` |
| `classico-moido-caixa-3x250` | `classico-250g-moido` |
| `suave-graos-250` | `suave-250g-graos` |
| `suave-graos-500` | `suave-500g-graos` |
| `suave-graos-1000` | `suave-1kg-graos` |
| `suave-moido-250` | `suave-250g-moido` |
| `suave-moido-500` | `suave-500g-moido` |
| `suave-moido-caixa-3x250` | `suave-250g-moido` |
| `microlote-graos-250` | `microlote-250g-graos` |
| `nectar-de-minas-graos-1000` | `nectar-1kg-graos` |
| `kit-canela-classico-suave-moido-3x250` | **nenhum** — ver Step 4 |
| `drip-suave-display-10` | `drip-suave` |
| `drip-suave-3-caixas` | `drip-suave` |
| `drip-classico-display-10` | `drip-classico` |
| `drip-classico-3-caixas` | `drip-classico` |
| `drip-classico-6-caixas` | `drip-classico` |
| `drip-canela-3-caixas` | `drip-canela` |
| `drip-canela-6-caixas` | `drip-canela` |
| `capsula-classico-1-caixa` | `capsulas-classico` |
| `capsula-classico-6-caixas` | `capsulas-classico` |
| `capsula-classico-2-canela-1` | `capsulas-classico` |
| `capsula-classico-3-canela` | `capsulas-classico` |
| `capsula-canela-1-caixa` | `capsulas-canela` |
| `capsula-canela-6-caixas` | `capsulas-canela` |

Exemplo do formato, no primeiro SKU:

```json
{
  "sku": "classico-graos-250",
  "linha": "classico",
  "nome": "Café Especial Canastra Clássico em Grãos - Pacote com 250 gramas",
  "…": "…",
  "imagem": "/produtos/classico-250g-graos.jpg",
  "imagemEstudio": "/produtos/classico-250g-graos-cor.jpg",
  "fonte": "captura-loja",
  "maisVendido": 1
}
```

Os quatro SKUs de caixa e multi-caixa recebem a foto do pacote unitário de que são feitos, e isso
precisa ficar dito no dado. Acrescente a eles:

```json
"imagemObservacao": "A CAIXA NAO TEM ARTE PROPRIA. A foto e a do pacote unitario de que ela e feita — 4x500 g mostra o pacote de 500 g. Trocar quando o acervo tiver a caixa fechada."
```

E nos dois SKUs de cápsula misturada (`capsula-classico-2-canela-1`, `capsula-classico-3-canela`):

```json
"imagemObservacao": "CAIXAS MISTURADAS. A foto e a da caixa do Classico, a predominante nas duas combinacoes. Nao existe foto do conjunto."
```

- [ ] **Step 4: Declarar a pendência do kit**

`kit-canela-classico-suave-moido-3x250` **não** recebe `imagem`. Recebe só:

```json
"imagemObservacao": "FALTA ARTE PROPRIA. O kit mistura tres linhas e nenhuma foto do acervo mostra a caixa dele; cai no fallback da linha Canela. Foi o mesmo estado do Nectar ate 25/09/2026."
```

- [ ] **Step 5: Atualizar as linhas**

Em `linhas[]`, troque `imagem` e `imagemEstudio` de cada uma pela foto do SKU de entrada, e **apague
o `imagemObservacao` do Néctar** — ele passa a ter arte própria:

| linha | imagem | imagemEstudio |
|---|---|---|
| `classico` | `/produtos/classico-250g-graos.jpg` | `/produtos/classico-250g-graos-cor.jpg` |
| `suave` | `/produtos/suave-250g-graos.jpg` | `/produtos/suave-250g-graos-cor.jpg` |
| `canela` | `/produtos/canela-250g-moido.jpg` | `/produtos/canela-250g-moido-cor.jpg` |
| `microlote` | `/produtos/microlote-250g-graos.jpg` | `/produtos/microlote-250g-graos-cor.jpg` |
| `nectar-de-minas` | `/produtos/nectar-1kg-graos.jpg` | `/produtos/nectar-1kg-graos-cor.jpg` |

Microlote e Néctar **ganham `imagemEstudio`**, que não tinham. O `doPacote` em `produtos.ts:235` já
trata a presença dela; nada muda lá.

- [ ] **Step 6: Atualizar o `_leia_me`**

O bloco `imagem_e_imagemEstudio` descreve o mundo anterior — *"só as três linhas principais têm
uma"*. Substitua por:

```json
"imagem_e_imagemEstudio": "`imagem` e a CAPA — o packshot em fundo branco — e `imagemEstudio` e a segunda foto, em estudio com fundo da cor do produto, que o hover do card revela e que fecha a galeria da PDP. Desde 25/09/2026 os DOIS existem em `produtos[]`, um por SKU, e os de `linhas[]` viraram a foto de abertura da linha e o fallback de quem nao declarar a sua. Procedencia: acervo fotografado entregue pelo dono do projeto (Drive, pasta `Produtos Cafe Canastra`), 20 produtos com o par completo. Quem nao tem foto propria declara por que em `imagemObservacao`."
```

- [ ] **Step 7: Rodar o teste e ver passar**

```bash
cd frontend && npx vitest run lib/catalogo/produtos.test.ts -t "foto propria"
```

Esperado: PASSA. O teste de `w/h` ainda falha — é a Task 3.

- [ ] **Step 8: Commit**

```bash
git add data/catalogo-canastra.json frontend/lib/catalogo/produtos.test.ts
git commit -m "feat(catalogo): cada SKU declara a foto do proprio pacote

Os 28 SKUs que tem par no acervo apontam para ele; os multipacotes herdam
do pacote unitario de que sao feitos e dizem isso em imagemObservacao. O
kit de tres linhas segue sem arte propria, agora como pendencia declarada.

O Nectar de Minas deixa de pegar emprestada a capa do Classico.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 3: A resolução passa a olhar o produto

**Files:**
- Modify: `frontend/lib/catalogo/produtos.ts:185-194` (`DIMENSAO_DA_ARTE`), `:588-601` (as duas funções)
- Modify: `frontend/lib/catalogo/tipos.ts:224` (o comentário de `ProdutoVendavel.imagem`)
- Test: `frontend/lib/catalogo/produtos.test.ts`

- [ ] **Step 1: Escrever o teste que falha**

```ts
it("a foto do SKU vence a da linha", () => {
  const mil = PRODUTOS.find((p) => p.sku === "classico-graos-1000")!;
  const duzentos = PRODUTOS.find((p) => p.sku === "classico-graos-250")!;

  expect(imagemDoProduto(mil)).toBe("/produtos/classico-1kg-graos.jpg");
  expect(imagemDoProduto(duzentos)).toBe("/produtos/classico-250g-graos.jpg");
  expect(imagemDoProduto(mil)).not.toBe(imagemDoProduto(duzentos));
});

it("quem nao tem foto propria cai na linha", () => {
  const kit = PRODUTOS.find(
    (p) => p.sku === "kit-canela-classico-suave-moido-3x250",
  )!;
  expect(imagemDoProduto(kit)).toBe("/produtos/canela-250g-moido.jpg");
});
```

Importe `imagemDoProduto` e `PRODUTOS` de `./produtos` no topo do arquivo de teste, se ainda não
estiverem.

- [ ] **Step 2: Rodar e ver falhar**

```bash
cd frontend && npx vitest run lib/catalogo/produtos.test.ts -t "vence a da linha"
```

Esperado: FALHA — `imagemDoProduto(mil)` devolve `/produtos/classico-250g-graos.jpg`, a da linha,
igual para os dois.

- [ ] **Step 3: Trocar as duas funções**

Em `frontend/lib/catalogo/produtos.ts`, substitua o par inteiro (linhas 591-601):

```ts
/**
 * A FOTO DO SKU, com a arte da linha como fallback.
 *
 * Ate 25/09/2026 estas duas funcoes recebiam o produto e o DESCARTAVAM: todo
 * SKU da linha devolvia a mesma arte, e os 14 do Classico — 250 g, 500 g,
 * 1 kg, drip, capsula, caixa — mostravam o mesmo pacote de 250 g. Nao era
 * descuido: era o acervo que existia, e o §8 do estetica.md cobrava as fotos.
 *
 * O acervo chegou (20 produtos, capa e estudio), e o fallback continua vivo
 * para quem nao tem arte propria: hoje o kit de tres linhas, amanha o SKU que
 * entrar antes da foto.
 */
export function imagemDoProduto(p: ProdutoDoCatalogo): string {
  return p.imagem ?? arteDaLinha(p.linha);
}

/** A foto de hover do SKU. Mesma regra de `imagemDoProduto`. */
export function imagemEstudioDoProduto(
  p: ProdutoDoCatalogo,
): string | undefined {
  return p.imagemEstudio ?? fotoDeEstudioDaLinha(p.linha);
}
```

`p.imagem` só compila depois que a Task 2 fechar: `ProdutoBruto` é `typeof bruto.produtos[number]`,
derivado do JSON.

- [ ] **Step 4: Rodar e ver passar**

```bash
cd frontend && npx vitest run lib/catalogo/produtos.test.ts -t "vence a da linha"
```

Esperado: PASSA, e o teste "quem nao tem foto propria cai na linha" também.

- [ ] **Step 5: Trocar `DIMENSAO_DA_ARTE`**

Substitua as 6 entradas (linhas 185-194) pelas 40 do `manifesto.txt` da Task 1, mantendo o comentário
que explica o mapa e ajustando-o:

```ts
/**
 * A medida REAL de cada arte de public/, por arquivo.
 *
 * Quem guarda a verdade é o arquivo, e quem cobra é `produtos.test.ts`, que
 * abre cada um em public/ e compara. Por isso o mapa pode ter fallback: uma
 * entrada esquecida cai no quadrado e o teste falha com o nome do arquivo.
 *
 * As 40 entradas são o acervo de 25/09/2026 — capa e estúdio dos 20 produtos,
 * geradas a partir dos arquivos, não digitadas.
 */
const DIMENSAO_DA_ARTE: Record<string, { w: number; h: number }> = {
  // cole aqui as 40 linhas do manifesto
};
```

O `ARTE_QUADRADA` de 500×500 continua como fallback, mas o comentário dele fica falso — o Microlote
deixou de ser o único quadrado porque deixou de ser quadrado. Substitua por:

```ts
/**
 * O fallback de quem não estiver no mapa: 500×500, a medida de todo o acervo
 * antigo em PNG. Depois de 25/09/2026 nenhuma arte viva cai aqui — e é essa a
 * graça: cair aqui faz `produtos.test.ts` falhar com o nome do arquivo.
 */
const ARTE_QUADRADA = { w: 500, h: 500 };
```

- [ ] **Step 6: Corrigir o comentário de `ProdutoVendavel.imagem`**

Em `frontend/lib/catalogo/tipos.ts:224`, `/** Arte da linha: os SKUs não têm foto própria no acervo
(§8). */` virou mentira. Troque por:

```ts
  /** A arte do SKU — a da linha só quando ele não tem a sua. */
  imagem: string;
```

E no bloco de `imagemEstudio` logo abaixo, a frase *"só as três linhas principais foram fotografadas
em estúdio"* passa a ser: *"todo produto do acervo tem a sua; a ausência sobrou para quem não foi
fotografado, como o kit de três linhas"*.

- [ ] **Step 7: Dar a `Variante` e a `FormatoEspecial` os dois campos**

A galeria da Task 4 le a foto direto da variante selecionada. Em `frontend/lib/catalogo/tipos.ts`,
acrescente ao tipo `Variante` (hoje em `:50`), logo depois de `pesoGramas`:

```ts
  /** A foto do pacote deste peso e desta moagem. Ver `imagemDoProduto`. */
  imagem?: string;
  /** A segunda foto, a de estudio. Ausente em quem nao foi fotografado. */
  imagemEstudio?: string;
```

O mesmo par entra em `FormatoEspecial` — drip e capsula tambem trocam de foto quando a pessoa
escolhe entre eles.

Em `frontend/lib/catalogo/produtos.ts`, dentro de `variantesDa()` e `especiaisDa()`, preencha os
dois no objeto que cada uma devolve:

```ts
    imagem: imagemDoProduto(p),
    imagemEstudio: imagemEstudioDoProduto(p),
```

onde `p` e o `ProdutoDoCatalogo` que a funcao ja tem em maos para montar `sku`, `preco` e `estoque`.

- [ ] **Step 8: Rodar a suite inteira do catalogo**

```bash
cd frontend && npx vitest run lib/catalogo/
```

Esperado: tudo passa, inclusive `declara w/h iguais ao arquivo real em public/`.

- [ ] **Step 8: Commit**

```bash
git add frontend/lib/catalogo/produtos.ts frontend/lib/catalogo/tipos.ts frontend/lib/catalogo/produtos.test.ts
git commit -m "feat(catalogo): imagemDoProduto para de descartar o produto

As duas funcoes recebiam o SKU e devolviam a arte da linha. Agora preferem
a foto do proprio SKU e caem na linha so quando ele nao tem. DIMENSAO_DA_ARTE
troca suas 6 entradas pelas 40 do acervo novo, medidas nos arquivos.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 4: A galeria da PDP acompanha a selecao

**Files:**
- Create: `frontend/components/catalogo/galeria.logica.ts`
- Create: `frontend/components/catalogo/galeria.logica.test.ts`
- Create: `frontend/components/catalogo/GaleriaDoLote.tsx`
- Create: `frontend/components/catalogo/GaleriaDoLote.test.tsx`
- Modify: `frontend/components/catalogo/PainelCompra.tsx` (novo prop `onSelecao`)
- Modify: `frontend/app/[locale]/(vitrine)/cafes/[slug]/page.tsx:164-168` e `:236-292`

**A DOUTRINA DE TESTE DESTA TAREFA, ANTES DE QUALQUER CODIGO.** A suite da vitrine roda em
`environment: "node"`, sem DOM: 779 casos escritos contra `renderToStaticMarkup`, e o
`vitest.config.ts` recusa explicitamente trocar isso "por causa de uma area nova".
`@testing-library` existe no `package.json` mas so vale no projeto `painel-dom`, restrito a
`app/dashboard/**` e `components/painel/**`. **Nao escreva teste de clique aqui — ele nao roda.**

A regra da casa e a que vale: a DECISAO vive num modulo puro e e testada em `node`; o DOM cobre so o
que a funcao pura nao alcanca. Por isso a escolha de fotos sai do componente e vira
`galeria.logica.ts`, que e onde o comportamento e provado. Do componente, o teste cobre o que
`renderToStaticMarkup` alcanca: a primeira carga.

- [ ] **Step 1: Escrever o teste da logica pura**

`frontend/components/catalogo/galeria.logica.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { LOTES } from "@/lib/catalogo/produtos";
import { fotosDaGaleria } from "./galeria.logica";

const classico = LOTES.find((l) => l.slug === "classico")!;

describe("fotosDaGaleria", () => {
  it("sem selecao, abre com as fotos da linha", () => {
    const fotos = fotosDaGaleria(classico, undefined);
    expect(fotos[0].src).toBe(classico.fotos.sabor.src);
  });

  it("com selecao, mostra a foto do SKU escolhido", () => {
    const mil = classico.variantes.find((v) => v.pesoGramas === 1000)!;
    expect(fotosDaGaleria(classico, mil)[0].src).toContain("classico-1kg-graos");
  });

  it("trocar de peso troca a foto", () => {
    const mil = classico.variantes.find((v) => v.pesoGramas === 1000)!;
    const duzentos = classico.variantes.find((v) => v.pesoGramas === 250)!;
    expect(fotosDaGaleria(classico, mil)[0].src).not.toBe(
      fotosDaGaleria(classico, duzentos)[0].src,
    );
  });

  it("nao repete o mesmo arquivo na pilha", () => {
    const fotos = fotosDaGaleria(classico, undefined);
    expect(new Set(fotos.map((f) => f.src)).size).toBe(fotos.length);
  });

  it("declara a medida real de cada arquivo", () => {
    for (const foto of fotosDaGaleria(classico, undefined)) {
      expect(foto.w).toBeGreaterThan(0);
      expect(foto.h).toBeGreaterThan(0);
    }
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

```bash
cd frontend && npx vitest run components/catalogo/galeria.logica.test.ts
```

Esperado: FALHA — `Cannot find module './galeria.logica'`.

- [ ] **Step 3: Escrever a logica pura**

`frontend/components/catalogo/galeria.logica.ts`:

```ts
import { dimensaoDaArte } from "@/lib/catalogo/produtos";
import type { FormatoEspecial, Lote, Variante } from "@/lib/catalogo/tipos";

export type FotoDaGaleria = { src: string; alt: string; w: number; h: number };

/**
 * AS FOTOS DA VEZ — a decisao que a galeria da PDP desenha.
 *
 * Mora fora do componente porque e aqui que esta o comportamento, e a suite da
 * vitrine roda em `environment: "node"`: `renderToStaticMarkup` nao executa
 * efeito, entao um teste de clique sobre o componente passaria provando nada.
 * A regra e a mesma do painel — a decisao num modulo puro, o DOM so para o que
 * a funcao pura nao alcanca.
 *
 * SEM REPETIDA: `imagem` e `imagemEstudio` sao o MESMO arquivo em quem nao foi
 * fotografado em estudio, e empilhar o packshot duas vezes, um embaixo do
 * outro, e o que a galeria fazia antes de as fotos existirem.
 */
export function fotosDaGaleria(
  lote: Lote,
  escolhido: Variante | FormatoEspecial | undefined,
): FotoDaGaleria[] {
  const capa = escolhido?.imagem ?? lote.fotos.sabor.src;
  const estudio = escolhido?.imagemEstudio ?? lote.fotos.pacote.src;

  return [capa, estudio, lote.fotos.terreiro?.src]
    .filter((src): src is string => Boolean(src))
    .filter((src, i, todas) => todas.indexOf(src) === i)
    .map((src) => ({
      src,
      alt: lote.fotos.sabor.alt,
      ...dimensaoDaArte(src),
    }));
}
```

- [ ] **Step 4: Rodar e ver passar**

```bash
cd frontend && npx vitest run components/catalogo/galeria.logica.test.ts
```

Esperado: os 5 casos passam.

- [ ] **Step 5: Dar a `PainelCompra` o callback**

Em `frontend/components/catalogo/PainelCompra.tsx`, acrescente o prop. O estado **nao sobe**:
`moagem`, `peso` e `pacotes` continuam morando la, porque e la que viram carrinho. O que sobe e o
resultado.

```tsx
export function PainelCompra({
  lote,
  locale = LOCALE_PADRAO,
  onSelecao,
}: {
  lote: Lote;
  locale?: Locale;
  /**
   * Avisa quem desenha a galeria qual variante esta selecionada agora.
   *
   * Um estado com dois donos e o caminho mais curto para a galeria e o botao
   * discordarem sobre o que a pessoa escolheu. Por isso o dono continua sendo
   * um so, e quem precisa saber escuta.
   */
  onSelecao?: (variante: Variante | undefined) => void;
}) {
```

Logo depois de `const variante = acharVariante(lote, moagem, peso, pacotes);` (hoje
`PainelCompra.tsx:119`):

```tsx
  useEffect(() => {
    onSelecao?.(variante);
  }, [variante, onSelecao]);
```

`useEffect` e `Variante` ja estao importados no arquivo.

- [ ] **Step 6: Escrever o teste do componente**

`frontend/components/catalogo/GaleriaDoLote.test.tsx` — o que `renderToStaticMarkup` alcanca e a
primeira carga, e e ela que carrega o LCP e o Open Graph da rota estatica:

```tsx
import { describe, expect, it } from "vitest";
import { html } from "@/lib/teste/html";
import { LOTES } from "@/lib/catalogo/produtos";
import { GaleriaDoLote } from "./GaleriaDoLote";

const classico = LOTES.find((l) => l.slug === "classico")!;

describe("GaleriaDoLote", () => {
  it("entrega a foto de abertura no HTML servido", () => {
    expect(html(<GaleriaDoLote lote={classico} locale="pt" />)).toContain(
      "classico-250g-graos",
    );
  });

  it("so a primeira foto pede prioridade de carregamento", () => {
    const saida = html(<GaleriaDoLote lote={classico} locale="pt" />);
    expect(saida.match(/fetchpriority="high"/g) ?? []).toHaveLength(1);
  });
});
```

- [ ] **Step 7: Escrever o componente**

`frontend/components/catalogo/GaleriaDoLote.tsx`:

```tsx
"use client";

import { useCallback, useState } from "react";
import Image from "next/image";
import { PainelCompra } from "./PainelCompra";
import { fotosDaGaleria } from "./galeria.logica";
import type { Lote, Variante } from "@/lib/catalogo/tipos";
import { LOCALE_PADRAO, type Locale } from "@/lib/i18n/tipos";

/**
 * A GALERIA E O PAINEL DE COMPRA, LADO A LADO E DE ACORDO.
 *
 * Ate 25/09/2026 a galeria era uma pilha estatica: escolher 1 kg trocava o
 * preco e nao trocava a foto, porque nao HAVIA foto de 1 kg. Agora ha, e
 * mostrar a de 250 g seria afirmar o pacote errado na pagina que o 7.3 chama
 * de mais importante.
 *
 * E client, mas o Next o renderiza no servidor na primeira carga: a foto de
 * abertura sai no HTML com `priority`, e o LCP e o Open Graph da rota estatica
 * continuam de pe. A troca so acontece no clique.
 */
export function GaleriaDoLote({
  lote,
  locale = LOCALE_PADRAO,
}: {
  lote: Lote;
  locale?: Locale;
}) {
  const [escolhida, setEscolhida] = useState<Variante | undefined>(undefined);

  // `useCallback` porque esta funcao entra no array de dependencias do efeito
  // do painel: uma funcao nova a cada render vira laco de renderizacao.
  const aoSelecionar = useCallback((v: Variante | undefined) => {
    setEscolhida(v);
  }, []);

  const fotos = fotosDaGaleria(lote, escolhida);

  return (
    <div className="grid gap-10 lg:grid-cols-2 lg:gap-16">
      <div className="space-y-3">
        {fotos.map((foto, i) => (
          <Image
            key={foto.src + i}
            src={foto.src}
            alt={foto.alt}
            width={foto.w}
            height={foto.h}
            priority={i === 0}
            sizes="(min-width: 1024px) 45vw, 100vw"
            className="w-full border border-fuligem-20 bg-cal-puro"
          />
        ))}
      </div>

      <div>
        <PainelCompra lote={lote} locale={locale} onSelecao={aoSelecionar} />
      </div>
    </div>
  );
}
```

- [ ] **Step 8: Trocar o JSX da PDP**

Em `frontend/app/[locale]/(vitrine)/cafes/[slug]/page.tsx`:

1. Apague a variavel `galeria` e seu `.filter` de repetidas (linhas 164-168). A logica mudou de casa
   para `fotosDaGaleria`.
2. O bloco `<div className="grid gap-10 lg:grid-cols-2 lg:gap-16">` que hoje contem a pilha de
   `<Image>` e, na coluna direita, o `<PainelCompra>` (linhas 236-292) vira:

```tsx
        <GaleriaDoLote lote={lote} locale={locale} />
```

3. **Atencao ao que NAO se move:** origem, `<h1>`, selo SCA, ponto de torra, ficha de lavoura e a
   secao de formatos especiais continuam na coluna direita, FORA do `<GaleriaDoLote>`. So a galeria
   e o `<PainelCompra>` entram nele. Se a coluna direita inteira for para dentro do componente
   client, a PDP perde a renderizacao de servidor do texto que o crawler le.
4. Troque o import de `PainelCompra` pelo de `GaleriaDoLote`.

- [ ] **Step 9: Rodar e ver passar**

```bash
cd frontend && npx vitest run components/catalogo/ && npx tsc --noEmit
```

Esperado: PASSA, incluindo `PainelCompra.test.tsx`, que nao passa `onSelecao` e continua valido
porque o prop e opcional.

- [ ] **Step 10: Commit**

```bash
git add frontend/components/catalogo/galeria.logica.ts frontend/components/catalogo/galeria.logica.test.ts frontend/components/catalogo/GaleriaDoLote.tsx frontend/components/catalogo/GaleriaDoLote.test.tsx frontend/components/catalogo/PainelCompra.tsx "frontend/app/[locale]/(vitrine)/cafes/[slug]/page.tsx"
git commit -m "feat(pdp): a galeria passa a acompanhar peso e moagem

Escolher 1 kg trocava o preco e nao trocava a foto. A selecao do
PainelCompra sobe por callback — o estado continua sendo dele — e a galeria
desenha o SKU escolhido.

A decisao mora em galeria.logica.ts, testada em node: a suite da vitrine
roda sem DOM, e um teste de clique sobre o componente passaria provando
nada. Do componente, o teste cobre o que renderToStaticMarkup alcanca — a
foto de abertura no HTML servido, com priority.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---


### Task 5: O seed grava a foto do produto

**Files:**
- Modify: `backend/db/seed.js:195`
- Test: `backend/test/` (o teste que já cobre `linhasDeProdutos`)

- [ ] **Step 1: Escrever o teste que falha**

Em `backend/test/seed.test.js`, que já exercita `linhasDeProdutos()`, acrescente:

```js
test("cada SKU leva a URL da propria foto", () => {
  const linhas = linhasDeProdutos();
  const mil = linhas.find((l) => l[1] === "classico-graos-1000");
  const duzentos = linhas.find((l) => l[1] === "classico-graos-250");

  assert.match(mil[6], /classico-1kg-graos\.jpg$/);
  assert.match(duzentos[6], /classico-250g-graos\.jpg$/);
  assert.notStrictEqual(mil[6], duzentos[6]);
});
```

O índice `6` é a posição de `imagem` no array que `linhasDeProdutos()` monta — conferível em
`seed.js:141`, na lista `COLUNAS`.

- [ ] **Step 2: Rodar e ver falhar**

```bash
cd backend && node --test --test-concurrency=1 test/ 2>&1 | grep -A 3 "propria foto"
```

Esperado: FALHA — as duas URLs são iguais.

- [ ] **Step 3: Trocar a linha**

Em `backend/db/seed.js`, dentro de `linhasDeProdutos()` (linha 195):

```js
      urlDaImagem(produto.imagem ?? linha.imagem),
```

E o comentário de `urlDaImagem` (`:98-105`) ganha uma frase: *"O caminho vem do produto quando ele
tem foto propria, e da linha quando nao tem — a mesma regra de `imagemDoProduto()` na vitrine. O
banco e a vitrine discordarem sobre a foto de um SKU e um bug que so aparece comparando duas telas."*

- [ ] **Step 4: Rodar e ver passar**

```bash
cd backend && node --test --test-concurrency=1 test/ 2>&1 | tail -20
```

Esperado: PASSA, e nenhum outro teste quebra. **`--test-concurrency=1` não é opcional:** em paralelo
a suíte derruba dezenas de testes por contenção do Postgres embarcado.

- [ ] **Step 5: Commit**

```bash
git add backend/db/seed.js backend/test
git commit -m "feat(seed): o banco recebe a foto do SKU, nao a da linha

A sacola copia 'imagem' do banco na hora de adicionar o item. Sem isso a
vitrine mostraria o pacote de 1 kg e a sacola o de 250 g, e a divergencia
so apareceria comparando duas telas.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 6: As artes antigas saem, e com elas os comentários que mentem

**Files:**
- Delete: `frontend/public/capa-{classico,suave,canela}.jpg`, `frontend/public/pacote-{classico,suave,canela}.jpg`, `frontend/public/microlote-png.png`
- Modify: `frontend/components/catalogo/CardProduto.test.tsx:43`
- Modify: `frontend/lib/catalogo/repositorio.test.ts:181`
- Modify: `frontend/lib/seo/jsonld.ts:34`
- Modify: `frontend/components/catalogo/CardProduto.tsx:29-33`

- [ ] **Step 1: Trocar as fixtures**

`CardProduto.test.tsx:43` — `imagem: "/capa-classico.jpg"` vira
`imagem: "/produtos/classico-250g-graos.jpg"`.

`repositorio.test.ts:181` — `expect(caixa?.imagem).toBe("/capa-canela.jpg")` vira
`expect(caixa?.imagem).toBe("/produtos/canela-250g-moido.jpg")`. O `caixa` desse teste é o
`kit-canela-classico-suave-moido-3x250` — o único SKU sem foto própria —, então o valor esperado é
a **capa da linha Canela**, que é justamente o que o comentário logo acima da asserção já explica:
*"A CAPA da linha dominante, e nunca a foto de estúdio: o kit é desenhado num quadrado de 112 px,
onde o pacote sobre fundo de cor some."* Esse comentário continua verdadeiro e fica como está.

`jsonld.ts:34` — o docstring `/** \`/capa-classico.jpg\` → \`https://loja.cafecanastra.com/capa-classico.jpg\`. */`
vira `/** \`/produtos/classico-250g-graos.jpg\` → \`https://loja.cafecanastra.com/produtos/classico-250g-graos.jpg\`. */`.

- [ ] **Step 2: Reescrever o comentário do `CardProduto`**

`CardProduto.tsx:29-33` afirma *"A FOTO É A DA LINHA. Os SKUs não têm arte própria no acervo (§8 do
estetica.md segue como caminho crítico), e inventar uma seria pior que reusar a real."* Substitua:

```
 * A FOTO É A DO SKU. Até 25/09/2026 era a da linha — os SKUs não tinham arte
 * própria e o §8 do estetica.md cobrava as fotos. O acervo chegou: cada
 * produto tem a capa em fundo branco e a de estúdio em fundo de cor, e o
 * crossfade do hover cruza duas imagens de verdade. Quem não foi fotografado
 * (o kit de três linhas) cai na arte da linha, como todo mundo caía antes.
```

- [ ] **Step 3: Apagar os sete arquivos**

```bash
cd "C:/Users/rafae/OneDrive/Desktop/Canastra Inteligencia/loja oficial cafe canastra"
git rm frontend/public/capa-classico.jpg frontend/public/capa-suave.jpg frontend/public/capa-canela.jpg \
       frontend/public/pacote-classico.jpg frontend/public/pacote-suave.jpg frontend/public/pacote-canela.jpg \
       frontend/public/microlote-png.png
```

- [ ] **Step 4: Confirmar que ninguém mais os cita**

```bash
grep -rn "capa-classico\|capa-suave\|capa-canela\|pacote-classico\|pacote-suave\|pacote-canela\|microlote-png" \
  --include=*.ts --include=*.tsx --include=*.js --include=*.json --include=*.md \
  frontend/app frontend/components frontend/lib backend data docs | grep -v node_modules
```

Esperado: **nenhuma linha**, exceto as dos documentos de spec e plano, que descrevem o passado e
ficam como estão.

- [ ] **Step 5: Rodar tudo**

```bash
cd frontend && npx vitest run && npx tsc --noEmit
cd ../backend && node --test --test-concurrency=1 test/
```

Esperado: as três suítes verdes.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "chore(acervo): as sete artes antigas saem de public/

Nenhum codigo as referencia depois das tarefas anteriores. Duas geracoes
de foto no mesmo diretorio e um convite a apontar para a errada.

O comentario do CardProduto que afirmava 'os SKUs nao tem arte propria'
descrevia o mundo de ontem — um comentario errado mente com a mesma
eficacia de um codigo errado.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 7: Os três SKUs novos — **BLOQUEADA**

**Files:**
- Modify: `data/catalogo-canastra.json`

**Esta tarefa não começa sem preço e estoque do dono do projeto.** `canela-moido-250`,
`microlote-moido-250` e `nectar-de-minas-moido-500` têm foto no acervo e não têm número. O catálogo
inteiro é construído sobre a regra de que nenhum campo é inventado, e preço é o único dado que a
loja cobra de verdade. Entrar com R$ 0,00 aumentaria uma dívida de 11 SKUs que já existe.

Quando os números chegarem:

- [ ] **Step 1: Acrescentar os três a `produtos[]`**

Copie a forma do SKU vizinho da mesma linha e troque `sku`, `nome`, `slugOriginal`, `formato`,
`gramas`, `rotuloEmbalagem`, `rotuloChave`, `precoCentavos`, `estoque` e o par de fotos:

| sku | linha | formato | gramas | imagem base |
|---|---|---|---|---|
| `canela-moido-250` | `canela` | `moido` | 250 | `canela-250g-moido` |
| `microlote-moido-250` | `microlote` | `moido` | 250 | `microlote-250g-moido` |
| `nectar-de-minas-moido-500` | `nectar-de-minas` | `moido` | 500 | `nectar-500g-moido` |

`fonte` é `"material-da-marca"` se o preço vier do material comercial, `"captura-loja"` se vier de
tela da loja. **Não** use `"inferido"`: preço inferido não é preço.

- [ ] **Step 2: Corrigir a descrição do Microlote**

Em `linhas[]`, a descrição do Microlote afirma *"Lote separado da safra, em quantidade limitada:
vendido só em 250 g, só em grão."* Com o moído entrando, a segunda metade fica falsa. Troque por:
*"Lote separado da safra, em quantidade limitada: vendido só em 250 g, em grão ou moído."*

E acrescente o par correspondente em `catalogo-canastra.i18n.json`, nos três idiomas, seguindo o que
já existe para as outras linhas — `produtos.test.ts` falha se o dicionário e o JSON discordarem de
uma vírgula.

- [ ] **Step 3: Rodar tudo e commitar**

```bash
cd frontend && npx vitest run && cd ../backend && node --test --test-concurrency=1 test/
cd .. && git add data/ && git commit -m "feat(catalogo): Canela moido, Microlote moido e Nectar 500 g entram na loja"
```

---

## Verificação final

- [ ] `cd frontend && npx vitest run` — verde
- [ ] `cd frontend && npx tsc --noEmit` — sem erro
- [ ] `cd backend && node --test --test-concurrency=1 test/` — verde
- [ ] `cd frontend && npm run build` — a PDP continua estática (`generateStaticParams`), sem aviso de
      componente client na raiz da rota
- [ ] Abrir `/cafes/classico`, trocar de 250 g para 1 kg e confirmar que a foto muda
- [ ] `ls frontend/public/produtos | wc -l` → 40; `ls frontend/public/*.jpg` → só os banners
