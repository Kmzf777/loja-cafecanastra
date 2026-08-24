# A home vira loja — plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Trocar a home institucional por uma home de venda — três carrosséis de produto arrastáveis, trilha de categorias tipográfica, e o texto de marca devolvido às páginas que já o publicam.

**Architecture:** Um `<Carrossel>` genérico com base em `scroll-snap` (funciona sem JS) e `embla-carousel-react` por cima (arrasto de mouse no desktop). Três seções de produto alimentadas por curadoria versionada no catálogo JSON. O "Ver mais" reaproveita a PLP existente com dois filtros novos na querystring. Nenhuma página nova.

**Tech Stack:** Next 15 (App Router, RSC), React 18.3, TypeScript, Tailwind v4, Vitest 4 (`environment: "node"`, `renderToStaticMarkup`), embla-carousel-react 8.6.0.

**Spec:** `docs/superpowers/specs/2026-08-24-home-de-venda-design.md`

---

## Convenções deste repositório — leia antes da Task 1

Coisas que não são óbvias e que vão te fazer perder tempo se você descobrir sozinho:

1. **Testes rodam em `environment: "node"`. Não existe DOM.** Teste de componente é `renderToStaticMarkup(<X />)` e depois `expect(html).toContain(...)`. Não use `@testing-library/react`, não teste clique, não teste `useState`. Lógica que precisa de prova vira **função pura exportada**, testada à parte.
2. **`npm test` roda da raiz do projeto**, não de `frontend/`. O comando é `npm test` na raiz (que faz `npm --prefix frontend run test`).
3. **Imports em `lib/i18n/*` e `lib/seo/*` são relativos, não `@/`** — está documentado no topo daqueles arquivos. Em `components/` e `app/` use `@/`.
4. **Comentário em português, explicando o PORQUÊ.** Este repositório documenta decisão, não mecânica. Olhe `CardKit.tsx` ou `repositorio.ts` antes de escrever o primeiro comentário. Não escreva `// adiciona à sacola` em cima de `adicionar()`.
5. **Tokens de cor são `fuligem`, `cal`, `cal-puro`, `juta`, `juta-claro`, `barro`, `mata`, `vermelho`.** Raio é sempre `0` (ou `rounded-bt` = 2px em botão). Sombra é sólida e deslocada (`shadow-[4px_4px_0_var(--color-fuligem)]`), nunca difusa.
6. **A home é estática** (`generateStaticParams` + `revalidate = 3600`). Nada de `cookies()`, `headers()` ou `searchParams` nela.
7. **Nunca invente dado.** Se um número não tem fonte no catálogo, ele não vai à tela.

---

## Estrutura de arquivos

| Arquivo | Responsabilidade |
|---|---|
| `frontend/components/ui/Carrossel.tsx` | **Criar.** Trilho arrastável genérico. Não sabe o que são produtos. |
| `frontend/components/ui/Carrossel.test.tsx` | **Criar.** |
| `frontend/lib/catalogo/curadoria.ts` | **Criar.** Lê os campos de curadoria e devolve as listas das três seções. Pura, sem React. |
| `frontend/lib/catalogo/curadoria.test.ts` | **Criar.** |
| `frontend/lib/sacola/usar-adicionar.ts` | **Criar.** Regra de adicionar à sacola, extraída do `CardKit`. |
| `frontend/lib/sacola/usar-adicionar.test.ts` | **Criar.** |
| `frontend/components/catalogo/CardProduto.tsx` | **Criar.** Card de SKU vendável. |
| `frontend/components/catalogo/CardProduto.test.tsx` | **Criar.** |
| `frontend/components/catalogo/CardVerMais.tsx` | **Criar.** O 7º card. |
| `frontend/components/catalogo/CardVerMais.test.tsx` | **Criar.** |
| `frontend/components/catalogo/TrilhaDeCategorias.tsx` | **Criar.** A faixa tipográfica. |
| `frontend/components/catalogo/TrilhaDeCategorias.test.tsx` | **Criar.** |
| `frontend/components/catalogo/CardKit.tsx` | **Modificar.** Passa a consumir o hook. |
| `frontend/lib/catalogo/tipos.ts` | **Modificar.** `Filtros` ganha `destaque` e `tipo`; tipo `Destaque` novo. |
| `frontend/lib/catalogo/produtos.ts` | **Modificar.** Expor `PRODUTOS_VENDAVEIS`. |
| `frontend/lib/catalogo/repositorio.ts` | **Modificar.** `listarLotes` respeita os dois filtros novos. |
| `frontend/lib/i18n/dicionario.ts` | **Modificar.** Chaves novas nos 3 idiomas. |
| `frontend/app/[locale]/(vitrine)/cafes/page.tsx` | **Modificar.** Lê e exibe os filtros novos. |
| `frontend/app/[locale]/(vitrine)/cafes/conteudo.ts` | **Modificar.** Rótulos dos chips novos. |
| `frontend/app/[locale]/(vitrine)/page.tsx` | **Modificar.** A home nova. |
| `data/catalogo-canastra.json` | **Modificar.** Campos de curadoria. |

---

## Task 1: Instalar o Embla

**Files:**
- Modify: `frontend/package.json`

- [x] **Step 1: Instalar**

```bash
cd frontend && npm install embla-carousel-react@8.6.0
```

- [x] **Step 2: Conferir que entrou e que a suíte continua verde**

```bash
cd .. && npm test
```

Esperado: os testes que já existem passam. Anote quantos passaram — é a linha de base para as próximas tasks.

- [x] **Step 3: Commit**

```bash
git add frontend/package.json frontend/package-lock.json
git commit -m "chore: o carrossel ganha motor, e ele pesa 5 KB"
```

---

## Task 2: Chaves novas no dicionário

Vem antes dos componentes porque todos eles leem daqui, e chave faltante quebra o build.

**Files:**
- Modify: `frontend/lib/i18n/dicionario.ts`

- [x] **Step 1: Achar o bloco `comum` do objeto `pt`**

Ele começa na linha ~100, com `verOsCafes: "Ver os cafés",`.

- [x] **Step 2: Acrescentar as chaves em `pt.comum`**

Logo depois de `verTodosOsCafes`, insira:

```ts
    /**
     * OS RÓTULOS DAS TRÊS SEÇÕES DE VENDA DA HOME, e eles moram no dicionário
     * — não num `conteudo.ts` de página — porque cada um aparece DUAS VEZES:
     * como título da seção na home e como rótulo do chip do filtro na PLP,
     * quando alguém clica em "Ver mais". Duas superfícies, um texto só.
     *
     * `maisVendidos` É AFIRMAÇÃO EDITORIAL, NÃO DADO DE PEDIDO. A ordem sai da
     * curadoria de data/catalogo-canastra.json, que a casa edita à mão. Está
     * documentado em lib/catalogo/curadoria.ts e no §6.1 do spec; o rótulo
     * aparece aqui só porque é texto de tela.
     */
    maisVendidos: "Mais vendidos",
    nossosKits: "Nossos kits",
    escolhaDoProdutor: "Escolha do produtor",

    /** O 7º card de todo carrossel de produto — leva à PLP filtrada. */
    verMais: "Ver mais",

    /**
     * A trilha logo abaixo da faixa de prova. `maisCategorias` é o último item
     * dela e leva à PLP inteira, sem filtro — por isso não é "Ver mais": ele
     * não continua uma lista, ele abre o catálogo.
     */
    categorias: "Categorias",
    maisCategorias: "+ Categorias",

    /**
     * O ANÚNCIO DE `aria-live` E O AVISO DE TETO, EM VERSÃO GENÉRICA.
     *
     * `venda.kit.adicionado` e `venda.kit.noTeto` já dizem estas duas coisas,
     * mas dizem "kit" — e o `CardProduto` vende PACOTE. Reusar aquelas chaves
     * faria quem usa leitor de tela ouvir "Kit adicionado à sacola" depois de
     * pôr 250 g de café moído no carrinho. As do kit continuam onde estão,
     * porque lá a palavra está certa.
     */
    adicionadoASacola: "Produto adicionado à sacola",
    noTetoDoEstoque: "Você já tem o máximo disponível deste item na sacola.",
```

- [x] **Step 3: Repetir em `en.comum`**

Ache o segundo bloco `comum: {` (linha ~756) e insira, no mesmo lugar relativo:

```ts
    maisVendidos: "Best sellers",
    nossosKits: "Our boxes",
    escolhaDoProdutor: "The grower's pick",
    verMais: "See more",
    categorias: "Categories",
    maisCategorias: "+ Categories",
    adicionadoASacola: "Product added to your bag",
    noTetoDoEstoque: "You already have the maximum available of this item in your bag.",
```

- [x] **Step 4: Repetir em `es.comum`**

Terceiro bloco `comum: {` (linha ~1109):

```ts
    maisVendidos: "Más vendidos",
    nossosKits: "Nuestros kits",
    escolhaDoProdutor: "Elección del productor",
    verMais: "Ver más",
    categorias: "Categorías",
    maisCategorias: "+ Categorías",
    adicionadoASacola: "Producto añadido a la bolsa",
    noTetoDoEstoque: "Ya tiene el máximo disponible de este artículo en la bolsa.",
```

- [x] **Step 5: Rodar os testes**

```bash
npm test
```

Esperado: PASS. Há um teste que prova que `en` e `es` não são o português copiado — se você repetir um valor, ele falha, e é de propósito.

- [x] **Step 6: Commit**

```bash
git add frontend/lib/i18n/dicionario.ts
git commit -m "feat: as tres secoes de venda ganham nome nos tres idiomas"
```

---

## Task 3: Curadoria no catálogo

**Files:**
- Modify: `data/catalogo-canastra.json`
- Create: `frontend/lib/catalogo/curadoria.ts`
- Create: `frontend/lib/catalogo/curadoria.test.ts`
- Modify: `frontend/lib/catalogo/produtos.ts`

- [x] **Step 1: Semear a curadoria no JSON**

Em `data/catalogo-canastra.json`, no array `produtos`, acrescente os campos aos SKUs abaixo. **Não altere mais nada** — nem preço, nem estoque, nem nome.

| `sku` | acrescentar |
|---|---|
| `classico-graos-250` | `"maisVendido": 1` |
| `suave-graos-250` | `"maisVendido": 2` |
| `classico-moido-250` | `"maisVendido": 3` |
| `suave-moido-250` | `"maisVendido": 4` |
| `classico-graos-500` | `"maisVendido": 5` |
| `suave-graos-500` | `"maisVendido": 6` |
| `microlote-graos-250` | `"escolhaDoProdutor": 1` |
| `nectar-de-minas-graos-1000` | `"escolhaDoProdutor": 2` |
| `classico-graos-1000` | `"escolhaDoProdutor": 3` |
| `suave-graos-1000` | `"escolhaDoProdutor": 4` |
| `classico-graos-caixa-4x500` | `"escolhaDoProdutor": 5` |

Exemplo do resultado num produto:

```json
{
  "sku": "classico-graos-250",
  "linha": "classico",
  "nome": "Café Especial Canastra Clássico em Grãos - Pacote com 250 gramas",
  "slugOriginal": "cafe-especial-canastra-classico-em-graos-pacote-com-250-gramas",
  "url": "https://loja.cafecanastra.com/cafes-especiais/cafe-especial-canastra-classico-em-graos-pacote-com-250-gramas",
  "formato": "graos",
  "gramas": 250,
  "pacotes": 1,
  "rotuloEmbalagem": "Pacote com 250 g",
  "rotuloChave": "pacote-250g",
  "precoCentavos": 3970,
  "estoque": 20,
  "fonte": "captura-loja",
  "maisVendido": 1
}
```

- [x] **Step 2: Conferir que o JSON continua válido e que o seed não quebrou**

```bash
node -e "const c=require('./data/catalogo-canastra.json'); const m=c.produtos.filter(p=>p.maisVendido).length; const e=c.produtos.filter(p=>p.escolhaDoProdutor).length; console.log('maisVendido:',m,'escolhaDoProdutor:',e); if(m!==6||e!==5) throw new Error('curadoria incompleta');"
```

Esperado: `maisVendido: 6 escolhaDoProdutor: 5`

- [x] **Step 3: Escrever o teste que falha**

Crie `frontend/lib/catalogo/curadoria.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  maisVendidos,
  escolhaDoProdutor,
  kitsECaixas,
  TETO_DA_SECAO,
} from "./curadoria";

/**
 * A curadoria é editorial — a casa edita um JSON à mão. Estes testes travam as
 * três coisas que um arquivo editado à mão erra: ordem, teto e o dia em que
 * alguém apagar tudo.
 */
describe("curadoria", () => {
  it("respeita a ordem declarada, crescente", () => {
    const skus = maisVendidos().map((p) => p.sku);
    expect(skus[0]).toBe("classico-graos-250");
    expect(skus[1]).toBe("suave-graos-250");
  });

  it("nunca passa de seis cards", () => {
    expect(maisVendidos().length).toBeLessThanOrEqual(TETO_DA_SECAO);
    expect(escolhaDoProdutor().length).toBeLessThanOrEqual(TETO_DA_SECAO);
    expect(kitsECaixas().length).toBeLessThanOrEqual(TETO_DA_SECAO);
  });

  it("não repete a mesma vitrine nas duas seções curadas", () => {
    // Se "Escolha do produtor" devolvesse os mesmos SKUs de "Mais vendidos",
    // a home teria dois carrosséis idênticos e um deles seria ruído.
    const a = new Set(maisVendidos().map((p) => p.sku));
    const b = escolhaDoProdutor().map((p) => p.sku);
    expect(b.some((sku) => !a.has(sku))).toBe(true);
  });

  it("só põe caixa comprável em Nossos Kits, e não preenche com esgotado", () => {
    // §5.3 do spec: quatro que vendem é melhor que seis com dois mortos.
    for (const kit of kitsECaixas()) {
      expect(kit.estoque, kit.sku).toBeGreaterThan(0);
      expect(kit.precoCentavos, kit.sku).toBeGreaterThan(0);
    }
  });

  it("Nossos Kits traz caixa de verdade, não pacote avulso", () => {
    for (const kit of kitsECaixas()) {
      const ehCaixa = kit.pacotes > 1 || kit.kit === true;
      expect(ehCaixa, kit.sku).toBe(true);
    }
  });

  it("cai para os compráveis mais baratos quando a curadoria está vazia", () => {
    // A queda do §6.0: o dia em que alguém apagar uma linha do JSON por
    // engano, a home continua vendendo em vez de renderizar seção vazia.
    const vazio = maisVendidos([]);
    expect(vazio.length).toBeGreaterThan(0);
    expect(vazio.length).toBeLessThanOrEqual(TETO_DA_SECAO);
    const precos = vazio.map((p) => p.precoCentavos);
    expect([...precos].sort((a, b) => a - b)).toEqual(precos);
  });

  it("nunca oferece o que não dá para comprar", () => {
    for (const p of [...maisVendidos(), ...escolhaDoProdutor()]) {
      expect(p.precoCentavos, p.sku).toBeGreaterThan(0);
    }
  });
});
```

- [x] **Step 4: Rodar e ver falhar**

```bash
npm test -- curadoria
```

Esperado: FAIL — `Cannot find module './curadoria'`.

- [x] **Step 5: Expor os produtos crus em `produtos.ts`**

No fim de `frontend/lib/catalogo/produtos.ts`, acrescente:

```ts
/**
 * O array cru de produtos do catálogo, com os campos de curadoria.
 *
 * `LOTES` e `KITS_DA_LOJA` já derivam daqui, mas os dois PERDEM O SKU
 * INDIVIDUAL no caminho: o lote agrupa as variantes de uma linha, e o kit só
 * enxerga o que tem `kit: true`. A home vende SKU — "Clássico em Grãos 250 g",
 * com preço exato e botão — e por isso precisa da lista antes do agrupamento.
 *
 * `lib/catalogo/curadoria.ts` é o único consumidor, e ele não deveria conhecer
 * a forma do JSON: por isso a exportação é daqui, que é onde o JSON já é lido.
 */
export type ProdutoDoCatalogo = ProdutoBruto & {
  maisVendido?: number;
  escolhaDoProdutor?: number;
  kit?: boolean;
  unidades?: number;
};

export const PRODUTOS: ProdutoDoCatalogo[] =
  bruto.produtos as ProdutoDoCatalogo[];

/** A arte da linha a que um SKU pertence — os SKUs não têm foto própria. */
export function imagemDoProduto(p: ProdutoDoCatalogo): string {
  return (
    bruto.linhas.find((l) => l.slug === p.linha)?.imagem ?? "/logo-canastra.png"
  );
}
```

- [x] **Step 6: Escrever `curadoria.ts`**

Crie `frontend/lib/catalogo/curadoria.ts`:

```ts
import { PRODUTOS, type ProdutoDoCatalogo } from "./produtos";

/**
 * QUEM ENTRA EM CADA CARROSSEL DA HOME.
 *
 * ISTO É CURADORIA, NÃO AGREGAÇÃO DE VENDA. `maisVendido` no catálogo é a casa
 * declarando o que sai mais, num arquivo versionado e revisável em pull
 * request. NÃO é `SELECT sku, count(*) FROM order_items`.
 *
 * O registro existe porque este repositório já removeu várias afirmações por
 * não terem fonte — a `Lavoura` com altitude inventada por lote, o "SCA 80+"
 * aplicado a um café de 75 pontos, o "lote rastreado" da faixa de prova. A
 * fonte desta aqui é o dono da loja, o que é legítimo; o nome do campo e este
 * comentário existem para que ninguém, daqui a seis meses, confunda uma com a
 * outra.
 *
 * O CAMINHO PARA O DADO REAL ESTÁ ABERTO E NÃO FOI TOMADO: um endpoint que
 * agregue `order_items` por SKU substitui a curadoria sem tocar em componente
 * nenhum, porque a ordenação já entra pronta daqui.
 */

/** Seis cards e o sétimo é o "Ver mais". Acima disso ninguém arrasta. */
export const TETO_DA_SECAO = 6;

/** Dá para comprar isto hoje? É a única pergunta que filtra as três seções. */
export function ehVendavel(p: ProdutoDoCatalogo): boolean {
  return p.estoque > 0 && p.precoCentavos > 0;
}

/** Caixa fechada ou kit que mistura linhas — o recorte que a PLP já usa. */
export function ehCaixaOuKit(p: ProdutoDoCatalogo): boolean {
  return p.kit === true || p.pacotes > 1;
}

/** Pacote avulso: o que as duas seções curadas vendem. */
function ehPacoteAvulso(p: ProdutoDoCatalogo): boolean {
  return !ehCaixaOuKit(p) && (p.formato === "graos" || p.formato === "moido");
}

/**
 * A QUEDA, e ela é a razão de as funções abaixo aceitarem a lista por
 * parâmetro em vez de lerem `PRODUTOS` direto.
 *
 * A curadoria é um arquivo editado à mão. No dia em que alguém apagar uma
 * linha por engano, a seção não pode renderizar vazia: cai para os compráveis
 * mais baratos, que é uma vitrine defensável em vez de um buraco. É o mesmo
 * princípio de `repositorio.ts`, que serve o JSON versionado quando a API não
 * responde — loja com vitrine de ontem é melhor que loja que não abre.
 */
function queda(produtos: ProdutoDoCatalogo[]): ProdutoDoCatalogo[] {
  return produtos
    .filter((p) => ehVendavel(p) && ehPacoteAvulso(p))
    .sort((a, b) => a.precoCentavos - b.precoCentavos)
    .slice(0, TETO_DA_SECAO);
}

/**
 * Ordena pela posição declarada e corta no teto.
 *
 * `ehVendavel` filtra ANTES da ordenação de propósito: um SKU curado que
 * esgotou não deve ocupar a primeira posição do carrossel com o botão
 * desabilitado. Ele reaparece sozinho quando o estoque voltar, sem ninguém
 * editar o JSON de novo — que é justamente o que uma curadoria por posição
 * permite e uma lista fixa de SKUs não permitiria.
 */
function porCuradoria(
  produtos: ProdutoDoCatalogo[],
  campo: "maisVendido" | "escolhaDoProdutor",
): ProdutoDoCatalogo[] {
  const curados = produtos
    .filter((p) => p[campo] !== undefined && ehVendavel(p))
    .sort((a, b) => (a[campo] as number) - (b[campo] as number))
    .slice(0, TETO_DA_SECAO);

  return curados.length > 0 ? curados : queda(produtos);
}

/** Seção 1 da home. */
export function maisVendidos(
  produtos: ProdutoDoCatalogo[] = PRODUTOS,
): ProdutoDoCatalogo[] {
  return porCuradoria(produtos, "maisVendido");
}

/** Seção 3 da home. */
export function escolhaDoProdutor(
  produtos: ProdutoDoCatalogo[] = PRODUTOS,
): ProdutoDoCatalogo[] {
  return porCuradoria(produtos, "escolhaDoProdutor");
}

/**
 * Seção 2 da home — e ela NÃO lê a curadoria, porque não precisa.
 *
 * Só três produtos do catálogo carregam `kit: true`, e DOIS SÃO CÁPSULAS COM
 * PREÇO E ESTOQUE ZERADOS. Uma seção que lesse só aquela flag nasceria com um
 * card. O recorte é o que a PLP já chama de "Kits e caixas" — `kit` ou mais de
 * um pacote —, que traz quatro caixas de fato compráveis.
 *
 * NÃO SE PREENCHE COM ESGOTADO PARA FECHAR SEIS. Quatro cards que vendem valem
 * mais que seis onde dois estão mortos; o "Ver mais" no fim leva a quem quiser
 * ver o resto, inclusive o que acabou.
 */
export function kitsECaixas(
  produtos: ProdutoDoCatalogo[] = PRODUTOS,
): ProdutoDoCatalogo[] {
  return produtos
    .filter((p) => ehCaixaOuKit(p) && ehVendavel(p))
    .sort((a, b) => b.precoCentavos - a.precoCentavos)
    .slice(0, TETO_DA_SECAO);
}
```

- [x] **Step 7: Rodar até passar**

```bash
npm test -- curadoria
```

Esperado: PASS, 7 testes.

- [x] **Step 8: Rodar a suíte inteira**

```bash
npm test
```

Esperado: PASS — o mesmo número da Task 1, mais 7.

- [x] **Step 9: Commit**

```bash
git add data/catalogo-canastra.json frontend/lib/catalogo/curadoria.ts frontend/lib/catalogo/curadoria.test.ts frontend/lib/catalogo/produtos.ts
git commit -m "feat: a casa escolhe o que a home vende, num arquivo revisavel"
```

---

## Task 4: O hook de adicionar à sacola

**Files:**
- Create: `frontend/lib/sacola/usar-adicionar.ts`
- Create: `frontend/lib/sacola/usar-adicionar.test.ts`

**Por que esta task existe:** `CardKit.tsx` carrega ~60 linhas de regra de compra dentro do componente — teto por estoque, acumulado na sacola, `produtoId` ausente, timeout cancelável, `aria-live`, evento GA4. `CardProduto` precisa da mesma regra. Copiá-la criaria a segunda cópia de uma regra que decide se a loja cobra certo.

- [x] **Step 1: Escrever o teste que falha**

Crie `frontend/lib/sacola/usar-adicionar.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { tetoDeAdicao, decidirAdicao } from "./usar-adicionar";

/**
 * SÓ AS FUNÇÕES PURAS. O hook em si não é testado aqui porque a suíte roda em
 * `environment: "node"` — não há DOM, não há como montar um componente e
 * clicar. Por isso a regra saiu do componente como função: o que decide se a
 * loja cobra certo fica provável, e o que sobra no React é fiação.
 */
describe("tetoDeAdicao", () => {
  it("usa o estoque real quando o banco respondeu", () => {
    expect(tetoDeAdicao(6, true)).toBe(6);
  });

  it("nunca passa de 20, mesmo com estoque alto", () => {
    // 20 é o teto de sempre do PainelCompra: acima disso é pedido de atacado
    // e não passa por carrinho.
    expect(tetoDeAdicao(500, true)).toBe(20);
  });

  it("cai para 20 quando a API está fora e o estoque é desconhecido", () => {
    // Sem produtoId o número do JSON pode ser o de ontem. O servidor
    // reconfere na cobrança — travar a venda aqui seria pior.
    expect(tetoDeAdicao(0, false)).toBe(20);
    expect(tetoDeAdicao(3, false)).toBe(20);
  });

  it("com produtoId e estoque zero, o teto é 20 e quem barra é o esgotado", () => {
    // O card já não deixa clicar quando está esgotado; o teto não é o lugar
    // de repetir aquela regra.
    expect(tetoDeAdicao(0, true)).toBe(20);
  });
});

describe("decidirAdicao", () => {
  it("adiciona quando há espaço", () => {
    expect(decidirAdicao({ jaNaSacola: 0, teto: 20, temProdutoId: true }))
      .toEqual({ acao: "adicionar" });
  });

  it("avisa do teto em vez de adicionar em silêncio", () => {
    expect(decidirAdicao({ jaNaSacola: 6, teto: 6, temProdutoId: true }))
      .toEqual({ acao: "no-teto" });
  });

  it("o teto vale para o ACUMULADO, não para o clique", () => {
    expect(decidirAdicao({ jaNaSacola: 7, teto: 6, temProdutoId: true }))
      .toEqual({ acao: "no-teto" });
  });

  it("sem produtoId avisa que não dá, em vez de fingir que guardou", () => {
    // API fora: a vitrine está de pé com o JSON, mas o carrinho fala com o
    // backend e sem o id não há o que enviar.
    expect(decidirAdicao({ jaNaSacola: 0, teto: 20, temProdutoId: false }))
      .toEqual({ acao: "sem-loja" });
  });

  it("o teto é conferido ANTES do produtoId", () => {
    // Quem já encheu a sacola ouve "chegou no limite", não "a loja caiu" —
    // a segunda mensagem mandaria a pessoa recarregar a página à toa.
    expect(decidirAdicao({ jaNaSacola: 20, teto: 20, temProdutoId: false }))
      .toEqual({ acao: "no-teto" });
  });
});
```

- [x] **Step 2: Rodar e ver falhar**

```bash
npm test -- usar-adicionar
```

Esperado: FAIL — `Cannot find module './usar-adicionar'`.

- [x] **Step 3: Escrever `usar-adicionar.ts`**

Crie `frontend/lib/sacola/usar-adicionar.ts`:

```ts
"use client";

import { useEffect, useRef, useState } from "react";
import { useSacola } from "./sacola";
import { eventoAddToCart } from "../analytics";

/**
 * A REGRA DE ADICIONAR À SACOLA, NUM LUGAR SÓ.
 *
 * Ela morava inteira dentro de `CardKit.tsx`. Quando a home passou a vender
 * SKU avulso, o `CardProduto` precisou exatamente da mesma regra — e copiá-la
 * teria criado a SEGUNDA CÓPIA de uma regra que decide se a loja cobra certo:
 * teto por estoque, acumulado na sacola, o que fazer quando a API está fora.
 * Duas cópias divergem, e a que diverge em silêncio é a que cobra errado.
 *
 * O QUE DECIDE ESTÁ FORA DO HOOK, em `tetoDeAdicao` e `decidirAdicao`. A suíte
 * roda em `environment: "node"`, sem DOM: um hook não é testável aqui, mas
 * função pura é. O que sobrou dentro do hook é fiação de estado — e fiação sem
 * regra não é onde o dinheiro se perde.
 */

/** Acima de 20 é pedido de atacado, e atacado não passa por carrinho. */
const TETO_ABSOLUTO = 20;

/**
 * Quanto deste item cabe na sacola.
 *
 * Com `produtoId` o banco respondeu e o estoque é real. Sem ele a vitrine está
 * de pé só com o JSON versionado, cujo número pode ser o de ontem — então vale
 * o teto de sempre, e o servidor reconfere preço e estoque antes de cobrar.
 */
export function tetoDeAdicao(estoque: number, temProdutoId: boolean): number {
  if (!temProdutoId || estoque <= 0) return TETO_ABSOLUTO;
  return Math.min(TETO_ABSOLUTO, estoque);
}

export type Decisao = { acao: "adicionar" | "no-teto" | "sem-loja" };

/**
 * O TETO VEM ANTES DO `produtoId`, e a ordem é a mensagem.
 *
 * Quem já encheu a sacola precisa ouvir "chegou no limite". Se o `produtoId`
 * fosse conferido primeiro, essa pessoa ouviria "não deu para falar com a
 * loja" e recarregaria a página à toa, para bater no mesmo teto.
 */
export function decidirAdicao({
  jaNaSacola,
  teto,
  temProdutoId,
}: {
  jaNaSacola: number;
  teto: number;
  temProdutoId: boolean;
}): Decisao {
  if (jaNaSacola >= teto) return { acao: "no-teto" };
  if (!temProdutoId) return { acao: "sem-loja" };
  return { acao: "adicionar" };
}

export type ItemParaSacola = {
  produtoId: string | undefined;
  skuLoja: string;
  /** Em português e sempre — fica gravado e vira dimensão de relatório. */
  nomeNaSacola: string;
  /** Em português e sempre, pelo mesmo motivo. */
  rotuloGravado: string;
  precoCentavos: number;
  estoque: number;
  imagem: string;
};

/**
 * O estado de um botão "Adicionar à sacola".
 *
 * `erro` e `noTeto` são coisas DIFERENTES de propósito: erro é falha (a loja
 * não respondeu, não dá para comprar aqui) e vai em `role="alert"`; bater no
 * teto não é erro, é o estoque real, e vai discreto em `role="status"`. Ler os
 * dois com a mesma voz treinaria a pessoa a ignorar o que importa.
 */
export function useAdicionarNaSacola(item: ItemParaSacola) {
  const { adicionar, itens } = useSacola();
  const [adicionado, setAdicionado] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [noTeto, setNoTeto] = useState(false);

  /**
   * O timeout do "Na sacola" vive numa ref para ser cancelável: sem o clear no
   * unmount, sair da página dentro dos 2,5 s dispararia `setAdicionado` num
   * componente morto, e cliques seguidos empilhariam timeouts concorrentes.
   */
  const timeoutDaConfirmacao = useRef<number | undefined>(undefined);
  useEffect(() => {
    return () => window.clearTimeout(timeoutDaConfirmacao.current);
  }, []);

  const jaNaSacola = Number(
    itens.find((i) => i.product_id === item.produtoId)?.quantity ?? 0,
  );
  const teto = tetoDeAdicao(item.estoque, Boolean(item.produtoId));

  async function aoAdicionar(mensagens: { semLoja: string; falhou: string }) {
    setErro(null);
    const { acao } = decidirAdicao({
      jaNaSacola,
      teto,
      temProdutoId: Boolean(item.produtoId),
    });

    if (acao === "no-teto") {
      setNoTeto(true);
      return;
    }
    setNoTeto(false);

    if (acao === "sem-loja") {
      setErro(mensagens.semLoja);
      return;
    }

    try {
      await adicionar({
        product_id: item.produtoId as string,
        name: item.nomeNaSacola,
        price: item.precoCentavos / 100,
        quantity: 1,
        image: item.imagem,
        size: item.rotuloGravado,
        // Identidade estável do funil GA4 — o begin_checkout da sacola
        // reporta este mesmo id.
        sku: item.skuLoja,
      });
      eventoAddToCart({
        id: item.skuLoja,
        nome: item.nomeNaSacola,
        precoCentavos: item.precoCentavos,
        quantidade: 1,
      });
      setAdicionado(true);
      window.clearTimeout(timeoutDaConfirmacao.current);
      timeoutDaConfirmacao.current = window.setTimeout(
        () => setAdicionado(false),
        2500,
      );
    } catch {
      setErro(mensagens.falhou);
    }
  }

  return { adicionado, erro, noTeto, aoAdicionar };
}
```

- [x] **Step 4: Rodar até passar**

```bash
npm test -- usar-adicionar
```

Esperado: PASS, 9 testes (4 em `tetoDeAdicao` + 5 em `decidirAdicao`).

- [x] **Step 5: Commit**

```bash
git add frontend/lib/sacola/usar-adicionar.ts frontend/lib/sacola/usar-adicionar.test.ts
git commit -m "feat: a regra de por na sacola sai do card e vira funcao provavel"
```

---

## Task 5: `CardKit` passa a usar o hook

**Files:**
- Modify: `frontend/components/catalogo/CardKit.tsx`

**Regra desta task: nenhum teste novo, e `CardKit.test.tsx` não pode ser alterado.** Ele é a prova de que a extração não mudou comportamento. Se você precisar mudar o teste, a extração está errada.

- [x] **Step 1: Rodar os testes do `CardKit` antes de tocar em nada**

```bash
npm test -- CardKit
```

Anote quantos passam. Esse número não pode cair.

- [x] **Step 2: Trocar o corpo do componente**

Em `frontend/components/catalogo/CardKit.tsx`, remova os imports de `useEffect`, `useRef`, `useState`, `useSacola` e `eventoAddToCart`, e acrescente:

```ts
import { useAdicionarNaSacola } from "@/lib/sacola/usar-adicionar";
```

Remova todo o bloco que vai de `const { adicionar, itens } = useSacola();` até o fim da função `aoAdicionar`, e ponha no lugar:

```ts
  /**
   * A regra de compra vive em `lib/sacola/usar-adicionar.ts` desde que a home
   * passou a vender SKU avulso e o `CardProduto` precisou da mesma coisa. O
   * que era corpo deste componente virou função provável; o teste ao lado não
   * mudou uma linha, e é ele que prova que a mudança não mexeu no que a
   * pessoa vê.
   */
  const { adicionado, erro: erroDaSacola, noTeto, aoAdicionar } =
    useAdicionarNaSacola({
      produtoId: kit.produtoId,
      skuLoja: kit.skuLoja,
      nomeNaSacola: nomeDoKitNaSacola(kit),
      // Gravado, e portanto em português — ver `nomeDoKitNaSacola`.
      rotuloGravado: kitCru.rotuloEmbalagem,
      precoCentavos: kit.preco,
      estoque: kit.estoque,
      imagem: kit.imagem,
    });
```

Na chamada do botão, troque `onClick={aoAdicionar}` por:

```tsx
              onClick={() =>
                aoAdicionar({
                  semLoja: d.venda.semLoja,
                  falhou: d.venda.naoDeuParaAdicionar,
                })
              }
```

Remova a linha `const nomeNaSacola = nomeDoKitNaSacola(kit);` se ela ficou sem uso.

- [x] **Step 3: Rodar os testes do `CardKit`**

```bash
npm test -- CardKit
```

Esperado: PASS, o mesmo número do Step 1.

- [x] **Step 4: Rodar a suíte inteira e checar tipos**

```bash
npm test && cd frontend && npx tsc --noEmit && cd ..
```

Esperado: PASS e zero erro de tipo.

- [x] **Step 5: Commit**

```bash
git add frontend/components/catalogo/CardKit.tsx
git commit -m "refactor: o card de kit passa a dividir a regra em vez de guarda-la"
```

---

## Task 5B: Os produtos da home com preço e estoque do banco

**Files:**
- Modify: `frontend/lib/catalogo/tipos.ts`
- Modify: `frontend/lib/catalogo/repositorio.ts`
- Modify: `frontend/lib/catalogo/repositorio.test.ts`

**Esta task não estava no plano original. Ela entrou porque a execução das Tasks 1–5 revelou um furo que quebraria a venda.**

O problema: `curadoria.ts` lê `PRODUTOS`, que é o JSON versionado. **Nenhum dos 29 produtos do JSON tem `produtoId`** — aquele campo só existe depois que `buscarDadosAoVivo()` casa o SKU com o banco. Sem ele, `useAdicionarNaSacola` devolve `"sem-loja"` em todo clique, e cada botão da home nova responderia "não deu para falar com a loja". A home pareceria uma loja e não venderia nada.

O mesmo caminho conserta a segunda metade: sem a sobreposição, a home mostraria o preço do JSON enquanto o painel mostra outro. `repositorio.ts` existe justamente para isso — leia o comentário no topo dele antes de começar.

**A fronteira a respeitar:** `curadoria.ts` continua PURA e não aprende o que é uma API — ela decide QUAIS SKUs, e só. Quem sobrepõe o comercial é o repositório, que já é dono desse assunto e já tem `sobreporAoVivo`, cache de 60 s e teto de espera de 3 s prontos.

- [x] **Step 1: Declarar o tipo do que a home vende**

Em `frontend/lib/catalogo/tipos.ts`, depois de `export type Kit = {...}`, acrescente:

```ts
/**
 * UM SKU COMPRÁVEL, no vocabulário comercial do resto da casa.
 *
 * É o que os carrosséis da home vendem. Existe porque o produto CRU do JSON
 * fala outra língua — `precoCentavos`, `sku`, e nenhum `produtoId`, que aquele
 * arquivo não tem como saber. Este tipo usa os mesmos nomes de `Variante` e
 * `Kit` (`preco`, `estoque`, `skuLoja`, `produtoId`) de propósito: é o que o
 * deixa passar pelo mesmo `sobreporAoVivo` do repositório, sem contrato
 * paralelo, e o que permite ao card falar uma língua só.
 */
export type ProdutoVendavel = {
  /** A chave no catálogo E na loja — para o SKU avulso são a mesma. */
  sku: string;
  skuLoja: string;
  /**
   * `product_id` da linha no banco. Chega com preço e estoque quando a API
   * responde; fica indefinido no modo de contingência. É o que o carrinho
   * precisa para falar com o backend — sem ele dá para navegar, não comprar.
   */
  produtoId?: string;
  linha: Linha;
  formato: Formato;
  /** Ausente em drip e cápsula, que não se vendem por peso. */
  gramas?: number;
  pacotes: number;
  /** Em português e sempre — fica gravado na sacola. Ver `Variante`. */
  rotuloEmbalagem: string;
  rotuloChave?: string;
  /** O nome capturado da loja — a rastreabilidade até o catálogo real. */
  nome: string;
  /** Arte da linha: os SKUs não têm foto própria no acervo (§8). */
  imagem: string;
  /** Em centavos. */
  preco: number;
  estoque: number;
};
```

- [x] **Step 2: Escrever o teste que falha**

Acrescente ao fim de `frontend/lib/catalogo/repositorio.test.ts` (confira os imports do topo antes de colar; acrescente só o que faltar):

```ts
import { produtosDaHome } from "./repositorio";

describe("produtosDaHome", () => {
  it("entrega as três seções", async () => {
    const { maisVendidos, kits, escolhaDoProdutor } = await produtosDaHome();
    expect(maisVendidos.length).toBeGreaterThan(0);
    expect(kits.length).toBeGreaterThan(0);
    expect(escolhaDoProdutor.length).toBeGreaterThan(0);
  });

  it("fala o vocabulário comercial da casa, não o do JSON cru", () => {
    // `preco`/`estoque`/`skuLoja` são os mesmos nomes de Variante e Kit. É o
    // que deixa o SKU passar pelo mesmo sobreporAoVivo sem contrato paralelo.
    return produtosDaHome().then(({ maisVendidos }) => {
      const p = maisVendidos[0];
      expect(p).toHaveProperty("preco");
      expect(p).toHaveProperty("estoque");
      expect(p).toHaveProperty("skuLoja");
      expect(p).not.toHaveProperty("precoCentavos");
    });
  });

  it("continua de pé quando a API não responde", async () => {
    // A contingência que repositorio.ts documenta: loja com preço de ontem é
    // melhor que loja que não abre, e o checkout reconfere antes de cobrar.
    const { maisVendidos } = await produtosDaHome();
    for (const p of maisVendidos) {
      expect(p.preco, p.sku).toBeGreaterThan(0);
      expect(p.imagem, p.sku).toBeTruthy();
    }
  });

  it("nunca oferece o que não dá para comprar", async () => {
    const { maisVendidos, kits, escolhaDoProdutor } = await produtosDaHome();
    for (const p of [...maisVendidos, ...kits, ...escolhaDoProdutor]) {
      expect(p.estoque, p.sku).toBeGreaterThan(0);
      expect(p.preco, p.sku).toBeGreaterThan(0);
    }
  });

  it("faz UMA leitura da API para as três seções", async () => {
    // Três chamadas separadas custariam três fetch por render da home. O
    // cache de 60 s do Next abafaria isso, mas depender de cache para não
    // fazer trabalho triplicado é depender de sorte.
    const chamadas: string[] = [];
    const original = globalThis.fetch;
    globalThis.fetch = (async (url: string) => {
      chamadas.push(String(url));
      return { ok: false } as Response;
    }) as typeof fetch;
    try {
      await produtosDaHome();
      expect(chamadas.length).toBeLessThanOrEqual(1);
    } finally {
      globalThis.fetch = original;
    }
  });
});
```

- [x] **Step 3: Rodar e ver falhar**

```bash
npm test -- repositorio
```

Esperado: FAIL — `produtosDaHome` não existe.

- [x] **Step 4: Implementar no repositório**

Em `frontend/lib/catalogo/repositorio.ts`, acrescente os imports:

```ts
import { PRODUTOS, imagemDoProduto, type ProdutoDoCatalogo } from "./produtos";
import { maisVendidos, kitsECaixas, escolhaDoProdutor } from "./curadoria";
import type { ProdutoVendavel } from "./tipos";
```

E, no fim do arquivo:

```ts
/**
 * O produto cru do JSON no vocabulário comercial da casa.
 *
 * `precoCentavos` vira `preco` e o `sku` vira também `skuLoja` — para o SKU
 * avulso os dois são o mesmo, porque a chave do catálogo É a chave da loja. É
 * essa tradução que deixa o produto passar por `sobreporAoVivo` junto com as
 * variantes e os kits, em vez de ganhar um caminho próprio que divergiria.
 */
function comoVendavel(p: ProdutoDoCatalogo): ProdutoVendavel {
  return {
    sku: p.sku,
    skuLoja: p.sku,
    linha: p.linha as ProdutoVendavel["linha"],
    formato: p.formato as ProdutoVendavel["formato"],
    ...("gramas" in p ? { gramas: p.gramas as number } : {}),
    pacotes: p.pacotes,
    rotuloEmbalagem: p.rotuloEmbalagem,
    rotuloChave: p.rotuloChave,
    nome: p.nome,
    imagem: imagemDoProduto(p),
    preco: p.precoCentavos,
    estoque: p.estoque,
  };
}

/**
 * AS TRÊS SEÇÕES DA HOME, COM PREÇO E ESTOQUE DO BANCO.
 *
 * A curadoria (`lib/catalogo/curadoria.ts`) decide QUAIS SKUs; ela é pura e
 * não sabe o que é uma API. Esta função é quem põe o comercial por cima, pelo
 * mesmo mecanismo que `listarLotes` e `listarKits` já usam.
 *
 * SEM ELA A HOME NÃO VENDERIA. `produtoId` não existe em produto nenhum do
 * JSON — ele nasce aqui, do casamento por SKU com o banco —, e é ele que o
 * carrinho envia ao backend. Um card sem `produtoId` responde "não deu para
 * falar com a loja" em todo clique: a home pareceria uma loja e não cobraria
 * ninguém. O preço tem a mesma história: sem a sobreposição, a vitrine
 * anunciaria o valor do JSON enquanto o painel mostra outro.
 *
 * UMA LEITURA SÓ PARA AS TRÊS SEÇÕES. `buscarDadosAoVivo` é chamada uma vez e
 * o mapa é reusado — três chamadas custariam três `fetch` por render, e o
 * cache de 60 s do Next abafaria isso sem tornar certo depender dele.
 *
 * A CONTINGÊNCIA É A MESMA DAS IRMÃS: API fora, o mapa volta vazio, e a home
 * vende pelo JSON versionado. Loja com preço de ontem é melhor que loja que
 * não abre, e o checkout reconfere preço e estoque no servidor antes de
 * cobrar.
 */
export async function produtosDaHome(): Promise<{
  maisVendidos: ProdutoVendavel[];
  kits: ProdutoVendavel[];
  escolhaDoProdutor: ProdutoVendavel[];
}> {
  const aoVivo = await buscarDadosAoVivo();
  const comercial = (lista: ProdutoDoCatalogo[]) =>
    lista.map((p) => sobreporAoVivo(comoVendavel(p), aoVivo));

  return {
    maisVendidos: comercial(maisVendidos(PRODUTOS)),
    kits: comercial(kitsECaixas(PRODUTOS)),
    escolhaDoProdutor: comercial(escolhaDoProdutor(PRODUTOS)),
  };
}
```

- [x] **Step 5: Rodar até passar**

```bash
npm test -- repositorio
```

Esperado: PASS, 5 testes novos.

⚠️ **A curadoria filtra por estoque ANTES de o banco falar.** Isso significa que um SKU que o JSON diz esgotado, mas que o banco tem em estoque, não aparece na home. É o comportamento aceito por ora — o JSON é a fonte editorial e o banco corrige o número, não a lista. Se o teste "nunca oferece o que não dá para comprar" falhar porque o banco zerou um estoque que o JSON tem, é este o motivo, e a correção é filtrar de novo DEPOIS da sobreposição. Registre no relatório se acontecer.

- [x] **Step 6: Checar tipos e commitar**

```bash
npm test && cd frontend && npx tsc --noEmit && cd ..
git add frontend/lib/catalogo/tipos.ts frontend/lib/catalogo/repositorio.ts frontend/lib/catalogo/repositorio.test.ts
git commit -m "fix: a home passa a vender pelo preco do banco, e com id de produto"
```

---

## Task 6: O `<Carrossel>`

**Files:**
- Create: `frontend/components/ui/Carrossel.tsx`
- Create: `frontend/components/ui/Carrossel.test.tsx`

- [x] **Step 1: Escrever o teste que falha**

Crie `frontend/components/ui/Carrossel.test.tsx`:

```tsx
import type { ReactElement } from "react";
import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { Carrossel, SlideDoCarrossel, LARGURA_DO_SLIDE } from "./Carrossel";

function html(no: ReactElement) {
  return renderToStaticMarkup(no);
}

const FILHOS = [
  <div key="a">Primeiro</div>,
  <div key="b">Segundo</div>,
  <div key="c">Terceiro</div>,
];

describe("Carrossel", () => {
  it("entrega o conteúdo no HTML do servidor", () => {
    // A home é estática. Se o conteúdo só existisse depois da hidratação, o
    // buscador veria um trilho vazio e a primeira pintura não venderia nada.
    const saida = html(<Carrossel rotulo="Mais vendidos">{FILHOS}</Carrossel>);
    expect(saida).toContain("Primeiro");
    expect(saida).toContain("Segundo");
    expect(saida).toContain("Terceiro");
  });

  it("arrasta sem JavaScript", () => {
    // §12 do estetica.md: a loja opera com JS desligado. A base é
    // scroll-snap; o Embla é melhoria, não requisito.
    const saida = html(<Carrossel rotulo="Mais vendidos">{FILHOS}</Carrossel>);
    expect(saida).toContain("overflow-x-auto");
    expect(saida).toContain("snap-x");
  });

  it("é uma região nomeada para quem navega por leitor de tela", () => {
    const saida = html(<Carrossel rotulo="Nossos kits">{FILHOS}</Carrossel>);
    expect(saida).toContain('aria-label="Nossos kits"');
    expect(saida).toContain('role="region"');
  });

  it("deixa sempre uma fração de card sobrando, em toda largura", () => {
    // O corte É o convite a arrastar. Um trilho que fecha certo na tela
    // parece grade, e ninguém arrasta uma grade.
    for (const largura of Object.values(LARGURA_DO_SLIDE)) {
      const pct = Number(largura.replace("%", ""));
      expect(100 / pct % 1, `${largura} fecha certo`).not.toBe(0);
    }
  });

  it("mostra um card inteiro e o segundo cortado no telefone", () => {
    // O pedido literal do briefing: dois cards lado a lado, o segundo
    // levemente cortado pelo overflow.
    const pct = Number(LARGURA_DO_SLIDE.telefone.replace("%", ""));
    const visiveis = 100 / pct;
    expect(visiveis).toBeGreaterThan(1.5);
    expect(visiveis).toBeLessThan(2);
  });

  it("o slide de verdade usa as larguras documentadas", () => {
    // AMARRA OBRIGATÓRIA. O Tailwind não aceita classe montada em tempo de
    // execução, então `LARGURA_DO_SLIDE` não PODE gerar as classes — elas são
    // literais no componente. Sem este teste, as duas metades divergiriam em
    // silêncio: a constante diria 58% e o card mediria outra coisa, e os
    // outros quatro testes deste arquivo continuariam verdes provando nada.
    const saida = html(
      <SlideDoCarrossel>
        <span>Card</span>
      </SlideDoCarrossel>,
    );
    for (const largura of Object.values(LARGURA_DO_SLIDE)) {
      expect(saida, `largura ${largura}`).toContain(`basis-[${largura}]`);
    }
  });
});
```

- [x] **Step 2: Rodar e ver falhar**

```bash
npm test -- Carrossel
```

Esperado: FAIL — `Cannot find module './Carrossel'`.

- [x] **Step 3: Escrever `Carrossel.tsx`**

Crie `frontend/components/ui/Carrossel.tsx`:

```tsx
"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";
import useEmblaCarousel from "embla-carousel-react";

/**
 * O TRILHO ARRASTÁVEL DA HOME — e ele não sabe o que é um produto.
 *
 * DUAS CAMADAS, E A DE BAIXO É A QUE IMPORTA. A base é `overflow-x-auto` com
 * `scroll-snap`: arrasta nativo, com a inércia do próprio sistema, e funciona
 * com JavaScript desligado — que o §12 do estetica.md exige e que uma
 * biblioteca sozinha não daria. O Embla entra por cima e acrescenta o que o
 * scroll-snap puro não tem: arrasto por MOUSE no desktop, onde a pessoa não
 * pode empurrar a tela com o dedo.
 *
 * Se o Embla falhar em carregar, o trilho continua rolando. Essa é a razão da
 * ordem — biblioteca primeiro seria uma loja que depende de 5 KB para mostrar
 * o que vende.
 *
 * O RECORTE É O CONVITE. As larguras abaixo NUNCA fecham um número inteiro de
 * cards na tela: sobra sempre uma fração cortada na borda direita, e é ela que
 * diz "tem mais". Um trilho que fecha certo parece grade, e ninguém arrasta uma
 * grade. O teste ao lado trava isso.
 */

export const LARGURA_DO_SLIDE = {
  /** 1 card inteiro + ~0,7 do segundo — o que o briefing pediu. */
  telefone: "58%",
  /** 2 inteiros + fração. */
  tablet: "38%",
  /** 3 inteiros + fração. */
  desktop: "26%",
} as const;

/**
 * §9 do estetica.md torna o movimento reduzido OBRIGATÓRIO, e aqui ele tem
 * duas consequências: o Embla anima o arrasto com `duration`, e o botão de
 * seta rola com `scroll-behavior`. Zerar só um deixaria metade do movimento de
 * pé para quem pediu que ele parasse.
 */
function useMovimentoReduzido(): boolean {
  const [reduzido, setReduzido] = useState(false);

  useEffect(() => {
    const consulta = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReduzido(consulta.matches);
    const aoMudar = (e: MediaQueryListEvent) => setReduzido(e.matches);
    consulta.addEventListener("change", aoMudar);
    return () => consulta.removeEventListener("change", aoMudar);
  }, []);

  return reduzido;
}

export function Carrossel({
  rotulo,
  children,
  className = "",
}: {
  /**
   * O nome da região para leitor de tela — normalmente o título da seção.
   * Obrigatório: uma região sem nome é pior que nenhuma região, porque ela
   * aparece na lista de marcos como "region" e não diz de quê.
   */
  rotulo: string;
  children: ReactNode;
  className?: string;
}) {
  const reduzido = useMovimentoReduzido();
  const [refDoTrilho, embla] = useEmblaCarousel({
    align: "start",
    containScroll: "trimSnaps",
    dragFree: false,
    duration: reduzido ? 0 : 22,
  });

  const [temAnterior, setTemAnterior] = useState(false);
  const [temProximo, setTemProximo] = useState(false);

  const aoSelecionar = useCallback(() => {
    if (!embla) return;
    setTemAnterior(embla.canScrollPrev());
    setTemProximo(embla.canScrollNext());
  }, [embla]);

  useEffect(() => {
    if (!embla) return;
    aoSelecionar();
    embla.on("select", aoSelecionar);
    embla.on("reInit", aoSelecionar);
    return () => {
      embla.off("select", aoSelecionar);
      embla.off("reInit", aoSelecionar);
    };
  }, [embla, aoSelecionar]);

  return (
    <div className={`relative ${className}`}>
      {/*
        `role="region"` com nome: quem navega por marcos acha o trilho e sabe
        de que ele é. O trilho em si é focável por teclado (`tabIndex={0}`)
        porque um container que rola precisa poder receber as setas do teclado
        — sem isso, quem não usa mouse não alcança o que está cortado.
      */}
      <div
        ref={refDoTrilho}
        role="region"
        aria-label={rotulo}
        tabIndex={0}
        className="overflow-x-auto snap-x snap-mandatory scroll-smooth motion-reduce:scroll-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden focus-visible:outline-2 focus-visible:outline-offset-[3px] focus-visible:outline-vermelho"
      >
        <ul className="flex gap-4 md:gap-6">{children}</ul>
      </div>

      {/*
        AS SETAS SÃO SÓ DE DESKTOP, e a ausência no telefone é a decisão: lá o
        dedo já arrasta, e duas setas de 44px roubariam largura do card que a
        pessoa veio ver. Aparecem só quando há para onde ir — seta desabilitada
        permanente é ruído que ensina a ignorar o controle.
      */}
      {embla ? (
        <div className="pointer-events-none absolute inset-y-0 left-0 right-0 hidden items-center justify-between lg:flex">
          <SetaDoCarrossel
            direcao="anterior"
            visivel={temAnterior}
            aoClicar={() => embla.scrollPrev()}
            rotulo={rotulo}
          />
          <SetaDoCarrossel
            direcao="proximo"
            visivel={temProximo}
            aoClicar={() => embla.scrollNext()}
            rotulo={rotulo}
          />
        </div>
      ) : null}
    </div>
  );
}

/**
 * 44×44 é o piso do §10, e `pointer-events-auto` reativa o clique dentro do
 * container que o desliga — é ele que deixa o arrasto passar por baixo das
 * setas em vez de morrer nelas.
 */
function SetaDoCarrossel({
  direcao,
  visivel,
  aoClicar,
  rotulo,
}: {
  direcao: "anterior" | "proximo";
  visivel: boolean;
  aoClicar: () => void;
  rotulo: string;
}) {
  if (!visivel) return <span aria-hidden className="h-11 w-11" />;

  return (
    <button
      type="button"
      onClick={aoClicar}
      aria-label={
        direcao === "anterior"
          ? `${rotulo}: anterior`
          : `${rotulo}: próximo`
      }
      className="pointer-events-auto flex h-11 w-11 items-center justify-center border border-fuligem-20 bg-cal-puro text-fuligem transition-[border-color,box-shadow,transform] duration-[200ms] ease-canastra hover:-translate-y-0.5 hover:border-vermelho hover:shadow-[3px_3px_0_var(--color-fuligem)] focus-visible:outline-2 focus-visible:outline-offset-[3px] focus-visible:outline-vermelho"
    >
      <span aria-hidden className="text-[18px] leading-none">
        {direcao === "anterior" ? "‹" : "›"}
      </span>
    </button>
  );
}

/**
 * Um slide. Existe como componente para que as três larguras vivam num lugar
 * só — três seções repetindo as mesmas classes divergiriam na primeira vez que
 * alguém ajustasse uma delas.
 *
 * AS CLASSES SÃO LITERAIS E TÊM DE SER: o Tailwind varre o código-fonte em
 * tempo de build e só gera o utilitário que encontrar escrito. `basis-[${x}]`
 * montado em tempo de execução produz uma classe que não existe no CSS, e o
 * slide nasceria sem largura nenhuma — sem erro, sem aviso, com o trilho
 * desmontado na tela.
 *
 * Por isso `LARGURA_DO_SLIDE` lá em cima é DOCUMENTAÇÃO, não fonte. O que
 * impede as duas metades de divergirem é o teste ao lado, que renderiza este
 * componente e confere que cada valor da constante aparece no markup.
 */
export function SlideDoCarrossel({ children }: { children: ReactNode }) {
  return (
    <li className="snap-start shrink-0 basis-[58%] sm:basis-[38%] lg:basis-[26%]">
      {children}
    </li>
  );
}
```

- [x] **Step 4: Rodar até passar**

```bash
npm test -- Carrossel
```

Esperado: PASS, 5 testes.

- [x] **Step 5: Commit**

```bash
git add frontend/components/ui/Carrossel.tsx frontend/components/ui/Carrossel.test.tsx
git commit -m "feat: um trilho que arrasta com o dedo, e tambem sem javascript"
```

---

## Task 7: `CardProduto`

**Files:**
- Create: `frontend/components/catalogo/CardProduto.tsx`
- Create: `frontend/components/catalogo/CardProduto.test.tsx`

- [x] **Step 1: Escrever o teste que falha**

Crie `frontend/components/catalogo/CardProduto.test.tsx`:

```tsx
import type { ReactElement } from "react";
import { describe, it, expect, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

// Sacola dublada — mesma técnica de CardKit.test.tsx: sem DOM não há clique,
// então prova-se o que o servidor pinta.
vi.mock("@/lib/sacola/sacola", () => ({
  useSacola: () => ({ adicionar: async () => {}, itens: [] }),
}));

import { CardProduto } from "./CardProduto";
import type { ProdutoVendavel } from "@/lib/catalogo/tipos";

function html(no: ReactElement) {
  return renderToStaticMarkup(no);
}

/**
 * Fixture no formato que a Task 5B produz — `preco`/`estoque`/`produtoId`, o
 * vocabulário comercial da casa. NÃO é o produto cru do JSON: aquele não tem
 * `produtoId`, e um card montado a partir dele nunca conseguiria vender.
 */
const CLASSICO_250: ProdutoVendavel = {
  sku: "classico-graos-250",
  skuLoja: "classico-graos-250",
  produtoId: "prod-teste-1",
  linha: "classico",
  formato: "graos",
  gramas: 250,
  pacotes: 1,
  rotuloEmbalagem: "Pacote com 250 g",
  rotuloChave: "pacote-250g",
  nome: "Café Especial Canastra Clássico em Grãos - Pacote com 250 gramas",
  imagem: "/canastra-classico.png",
  preco: 3970,
  estoque: 20,
};

const ESGOTADO: ProdutoVendavel = { ...CLASSICO_250, estoque: 0 };

describe("CardProduto", () => {
  it("mostra o preço EXATO, não 'a partir de'", () => {
    // O card de linha diz "a partir de" porque agrupa variantes. Este é um
    // SKU: o preço é o que a pessoa vai pagar, e hedgear seria mentir para
    // baixo.
    const saida = html(<CardProduto produto={CLASSICO_250} locale="pt" />);
    expect(saida).toContain("R$&nbsp;39,70");
    expect(saida).not.toContain("a partir de");
  });

  it("diz de que embalagem se trata", () => {
    const saida = html(<CardProduto produto={CLASSICO_250} locale="pt" />);
    expect(saida).toContain("250 g");
  });

  it("vende no idioma da página", () => {
    expect(html(<CardProduto produto={CLASSICO_250} locale="en" />)).toContain(
      "Add to bag",
    );
    expect(html(<CardProduto produto={CLASSICO_250} locale="es" />)).toContain(
      "Añadir a la bolsa",
    );
  });

  it("não deixa português vazar para en e es", () => {
    for (const locale of ["en", "es"] as const) {
      const saida = html(<CardProduto produto={CLASSICO_250} locale={locale} />);
      expect(saida, `botão em ${locale}`).not.toContain("Adicionar à sacola");
    }
  });

  it("esgotado aparece marcado, não some", () => {
    // A regra da casa, documentada em CardKit e repositorio.ts: sumir com
    // produto é pior do que dizer que acabou.
    const saida = html(<CardProduto produto={ESGOTADO} locale="pt" />);
    expect(saida).toContain("Esgotado");
    expect(saida).toContain("disabled");
  });

  it("leva à página do café a que o SKU pertence", () => {
    const saida = html(<CardProduto produto={CLASSICO_250} locale="pt" />);
    expect(saida).toContain('href="/cafes/classico"');
  });

  it("prefixa o idioma no link fora do português", () => {
    const saida = html(<CardProduto produto={CLASSICO_250} locale="en" />);
    expect(saida).toContain('href="/en/cafes/classico"');
  });
});
```

- [x] **Step 2: Rodar e ver falhar**

```bash
npm test -- CardProduto
```

Esperado: FAIL — `Cannot find module './CardProduto'`.

- [x] **Step 3: Escrever `CardProduto.tsx`**

Crie `frontend/components/catalogo/CardProduto.tsx`:

```tsx
"use client";

import Image from "next/image";
import Link from "next/link";
import { formatarPreco, precoParaLeitor } from "@/lib/catalogo/repositorio";
import { COR_DA_LINHA } from "@/lib/catalogo/rotulos";
import { Botao } from "@/components/ui/Botao";
import { useAdicionarNaSacola } from "@/lib/sacola/usar-adicionar";
import { dicionario } from "@/lib/i18n/dicionario";
import { href } from "@/lib/i18n/rotas";
import { LOCALE_PADRAO, type Locale } from "@/lib/i18n/tipos";
import type { ProdutoVendavel } from "@/lib/catalogo/tipos";

/**
 * O CARD DE UM SKU — a unidade de venda da home nova.
 *
 * O `<CardCafe>` ao lado mostra a LINHA e diz "a partir de R$ X", porque
 * agrupa todas as variantes dela. Este mostra UM SKU comprável e por isso diz
 * o PREÇO EXATO, com botão de adicionar: numa home cuja tarefa é vender, um
 * "a partir de" é um segundo clique antes de qualquer número verdadeiro.
 *
 * A LINGUAGEM VISUAL É A MESMA DO CARD IRMÃO de propósito — filete de 1px,
 * fita da cor da embalagem no topo, deslocamento de 4px com sombra sólida,
 * raio zero. Os dois dividem a home e a PLP; dois vocabulários na mesma
 * rolagem leriam como dois sites.
 *
 * A FOTO É A DA LINHA. Os SKUs não têm arte própria no acervo (§8 do
 * estetica.md segue como caminho crítico), e inventar uma seria pior que
 * reusar a real.
 */

export function CardProduto({
  produto,
  locale = LOCALE_PADRAO,
}: {
  /**
   * Já com preço, estoque e `produtoId` do banco — é o que `produtosDaHome()`
   * devolve. NÃO aceita o produto cru do JSON de propósito: aquele não tem
   * `produtoId`, e um card montado a partir dele responderia "não deu para
   * falar com a loja" em todo clique. O tipo é a trava disso.
   */
  produto: ProdutoVendavel;
  locale?: Locale;
}) {
  const d = dicionario(locale);
  const corDaLinha = COR_DA_LINHA[produto.linha];
  const indisponivel = produto.estoque <= 0 || produto.preco <= 0;

  /**
   * O NOME NA SACOLA É EM PORTUGUÊS, SEMPRE — mesma decisão de
   * `nomeDoKitNaSacola` e do `PainelCompra`. Este texto não é tela: fica
   * gravado no localStorage, volta na sessão seguinte e vira `item_name` no
   * GA4. Um relatório com o mesmo SKU em três idiomas é o mesmo produto
   * contado três vezes.
   */
  const nomeNaSacola = `${produto.nome.split(" - ")[0]} — ${produto.rotuloEmbalagem}`;

  const { adicionado, erro, noTeto, aoAdicionar } = useAdicionarNaSacola({
    // Sem `produtoId`: o card da home nasce do JSON versionado, e o id do
    // banco chega junto do preço ao vivo quando a página o repassa. O hook
    // trata a ausência avisando, em vez de fingir que guardou.
    produtoId: produto.produtoId,
    skuLoja: produto.sku,
    nomeNaSacola,
    rotuloGravado: produto.rotuloEmbalagem,
    precoCentavos: produto.preco,
    estoque: produto.estoque,
    imagem: produto.imagem,
  });

  /**
   * "Café Especial Canastra Clássico em Grãos - Pacote com 250 gramas" é nome
   * de catálogo de loja, não título de card. O que interessa a quem está
   * escolhendo é a LINHA e o FORMATO — o resto vive no rótulo de embalagem
   * logo abaixo.
   */
  const nomeDaLinha = d.catalogo.linha[produto.linha];
  const formato = d.catalogo.formato[produto.formato];

  /**
   * `gramas` é OPCIONAL, e a ausência não é descuido: drip e cápsula não se
   * vendem por peso, e escrever "undefined g" num card é pior que não dizer o
   * peso. Quando falta, o card se cala sobre a gramatura e o
   * `rotuloEmbalagem` logo abaixo já diz do que se trata.
   */
  const peso = produto.gramas
    ? produto.gramas === 1000
      ? "1 kg"
      : `${produto.gramas} g`
    : null;

  return (
    <article className="group flex h-full flex-col border border-fuligem-20 bg-cal-puro transition-[box-shadow,border-color,transform] duration-[320ms] ease-canastra hover:-translate-x-1 hover:-translate-y-1 hover:border-vermelho hover:shadow-[4px_4px_0_var(--color-fuligem)]">
      <span
        aria-hidden
        className="block h-1 w-full"
        style={{ backgroundColor: corDaLinha }}
      />

      <Link
        href={href(locale, `/cafes/${produto.linha}`)}
        className="focus-visible:outline-2 focus-visible:outline-offset-[3px] focus-visible:outline-vermelho"
      >
        <div className="relative aspect-square overflow-hidden">
          <Image
            src={produto.imagem}
            alt=""
            aria-hidden
            width={500}
            height={500}
            sizes="(min-width: 1024px) 26vw, (min-width: 640px) 38vw, 58vw"
            className="h-full w-full object-cover"
          />
        </div>

        <div className="border-t border-fuligem-20 px-4 pt-4">
          <h3 className="text-[17px] font-semibold leading-tight">
            {nomeDaLinha}
          </h3>
          <p className="mt-1 text-[13px] text-fuligem-55">
            {formato}
            {peso ? (
              <>
                <span aria-hidden> · </span>
                <span className="font-dado">{peso}</span>
              </>
            ) : null}
          </p>
        </div>
      </Link>

      <div className="mt-auto flex flex-col gap-3 px-4 pb-4 pt-3">
        {indisponivel ? (
          <span className="text-[12px] uppercase tracking-[0.14em] text-fuligem-55">
            {d.comum.esgotado}
          </span>
        ) : (
          <span
            className="font-dado text-[18px]"
            aria-label={precoParaLeitor(produto.preco)}
          >
            {formatarPreco(produto.preco)}
          </span>
        )}

        <Botao
          variante="primario"
          disabled={indisponivel}
          onClick={() =>
            aoAdicionar({
              semLoja: d.venda.semLoja,
              falhou: d.venda.naoDeuParaAdicionar,
            })
          }
          className="w-full disabled:cursor-not-allowed disabled:bg-fuligem-20 disabled:text-fuligem-55"
        >
          {indisponivel
            ? d.comum.esgotado
            : adicionado
              ? d.venda.naSacola
              : d.venda.adicionarASacola}
        </Botao>

        {/* Genérico, não `venda.kit.*`: este card vende pacote, e quem usa
            leitor de tela ouviria "Kit adicionado" ao comprar 250 g. */}
        <p role="status" aria-live="polite" className="sr-only">
          {adicionado ? d.comum.adicionadoASacola : ""}
        </p>

        {erro ? (
          <p role="alert" className="text-[13px] text-vermelho">
            {erro}
          </p>
        ) : null}

        {/* Bater no teto não é erro, é o estoque real — por isso status e não alert. */}
        {noTeto ? (
          <p role="status" className="text-[13px] text-fuligem-55">
            {d.comum.noTetoDoEstoque}
          </p>
        ) : null}
      </div>
    </article>
  );
}
```

- [x] **Step 4: Rodar até passar**

```bash
npm test -- CardProduto
```

Esperado: PASS, 7 testes.

Se `R$&nbsp;39,70` falhar, rode `node -e "console.log(JSON.stringify((3970/100).toLocaleString('pt-BR',{style:'currency',currency:'BRL'})))"` e ajuste a asserção ao separador real que o Node emite — **ajuste o teste ao valor verdadeiro, nunca o contrário.**

- [x] **Step 5: Checar tipos**

```bash
cd frontend && npx tsc --noEmit && cd ..
```

Não deve acusar nada: `produtoId` é campo declarado de `ProdutoVendavel`, criado na Task 5B. **Se você sentir vontade de acrescentá-lo ao `ProdutoDoCatalogo` do JSON, pare** — aquele tipo descreve o arquivo versionado, e o arquivo não tem nem pode ter um id de banco. Foi exatamente esse atalho que a Task 5B existe para evitar.

- [x] **Step 6: Commit**

```bash
git add frontend/components/catalogo/CardProduto.tsx frontend/components/catalogo/CardProduto.test.tsx
git commit -m "feat: um card que mostra o preco que se paga, e o botao que cobra"
```

---

## Task 8: `CardVerMais`

**Files:**
- Create: `frontend/components/catalogo/CardVerMais.tsx`
- Create: `frontend/components/catalogo/CardVerMais.test.tsx`

- [x] **Step 1: Escrever o teste que falha**

Crie `frontend/components/catalogo/CardVerMais.test.tsx`:

```tsx
import type { ReactElement } from "react";
import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { CardVerMais } from "./CardVerMais";

function html(no: ReactElement) {
  return renderToStaticMarkup(no);
}

describe("CardVerMais", () => {
  it("leva ao destino que recebeu", () => {
    const saida = html(
      <CardVerMais caminho="/cafes?destaque=mais-vendidos" locale="pt" />,
    );
    expect(saida).toContain('href="/cafes?destaque=mais-vendidos"');
  });

  it("prefixa o idioma fora do português", () => {
    const saida = html(<CardVerMais caminho="/cafes?tipo=kit" locale="es" />);
    expect(saida).toContain('href="/es/cafes?tipo=kit"');
  });

  it("fala o idioma da página", () => {
    expect(html(<CardVerMais caminho="/cafes" locale="pt" />)).toContain(
      "Ver mais",
    );
    expect(html(<CardVerMais caminho="/cafes" locale="en" />)).toContain(
      "See more",
    );
    expect(html(<CardVerMais caminho="/cafes" locale="es" />)).toContain(
      "Ver más",
    );
  });
});
```

- [x] **Step 2: Rodar e ver falhar**

```bash
npm test -- CardVerMais
```

Esperado: FAIL.

- [x] **Step 3: Escrever `CardVerMais.tsx`**

Crie `frontend/components/catalogo/CardVerMais.tsx`:

```tsx
import Link from "next/link";
import { dicionario } from "@/lib/i18n/dicionario";
import { href } from "@/lib/i18n/rotas";
import { LOCALE_PADRAO, type Locale } from "@/lib/i18n/tipos";

/**
 * O SÉTIMO CARD DE TODO CARROSSEL DE PRODUTO.
 *
 * Ele é card, e não um botão solto embaixo da seção, por uma razão de gesto:
 * quem arrasta até o fim de um trilho está justamente procurando mais — e
 * encontrar o "ver mais" ali, na continuação do movimento, custa zero passo. Um
 * botão abaixo da seção exigiria parar de arrastar, olhar para baixo e mudar de
 * gesto.
 *
 * SEM FOTO, DE PROPÓSITO. Ele não é produto: é navegação, e uma imagem o faria
 * competir com os seis cards que de fato vendem. O que ele tem é tipografia e
 * uma seta.
 *
 * Server component — não tem estado, e por isso não paga hidratação.
 */
export function CardVerMais({
  caminho,
  locale = LOCALE_PADRAO,
}: {
  /** Caminho canônico em português, com querystring. `href()` cuida do idioma. */
  caminho: string;
  locale?: Locale;
}) {
  const d = dicionario(locale);

  return (
    <Link
      href={href(locale, caminho)}
      className="group flex h-full min-h-[220px] flex-col items-start justify-center gap-3 border border-dashed border-fuligem-20 bg-transparent p-6 transition-[border-color,box-shadow,transform] duration-[320ms] ease-canastra hover:-translate-x-1 hover:-translate-y-1 hover:border-vermelho hover:border-solid hover:shadow-[4px_4px_0_var(--color-fuligem)] focus-visible:outline-2 focus-visible:outline-offset-[3px] focus-visible:outline-vermelho"
    >
      <span className="text-[18px] font-semibold leading-tight">
        {d.comum.verMais}
      </span>
      <span
        aria-hidden
        className="font-dado text-[22px] leading-none text-vermelho transition-transform duration-[320ms] ease-canastra group-hover:translate-x-1"
      >
        →
      </span>
    </Link>
  );
}
```

- [x] **Step 4: Rodar até passar**

```bash
npm test -- CardVerMais
```

Esperado: PASS, 3 testes.

- [x] **Step 5: Commit**

```bash
git add frontend/components/catalogo/CardVerMais.tsx frontend/components/catalogo/CardVerMais.test.tsx
git commit -m "feat: o fim do trilho vira porta para a listagem"
```

---

## Task 9: `TrilhaDeCategorias`

**Files:**
- Create: `frontend/components/catalogo/TrilhaDeCategorias.tsx`
- Create: `frontend/components/catalogo/TrilhaDeCategorias.test.tsx`

- [x] **Step 1: Escrever o teste que falha**

Crie `frontend/components/catalogo/TrilhaDeCategorias.test.tsx`:

```tsx
import type { ReactElement } from "react";
import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import {
  TrilhaDeCategorias,
  CATEGORIAS_DA_TRILHA,
} from "./TrilhaDeCategorias";

function html(no: ReactElement) {
  return renderToStaticMarkup(no);
}

describe("TrilhaDeCategorias", () => {
  it("mostra as seis categorias na ordem do desenho", () => {
    const saida = html(<TrilhaDeCategorias locale="pt" />);
    for (const rotulo of ["Cápsulas", "Drips", "Grãos", "Moído", "Kits"]) {
      expect(saida, rotulo).toContain(rotulo);
    }
    expect(saida).toContain("+ Categorias");
  });

  it("cada destino é um filtro que a PLP de fato entende", () => {
    // Um rótulo apontando para um filtro inexistente levaria a pessoa à
    // listagem inteira sem aviso — pior que não ter o atalho.
    const permitidos = new Set([
      "/cafes?formato=capsula",
      "/cafes?formato=drip",
      "/cafes?formato=graos",
      "/cafes?formato=moido",
      "/cafes?tipo=kit",
      "/cafes",
    ]);
    for (const c of CATEGORIAS_DA_TRILHA) {
      expect(permitidos.has(c.caminho), c.caminho).toBe(true);
    }
  });

  it("traduz os rótulos", () => {
    const en = html(<TrilhaDeCategorias locale="en" />);
    expect(en).toContain("+ Categories");
    expect(en).not.toContain("+ Categorias");

    const es = html(<TrilhaDeCategorias locale="es" />);
    expect(es).toContain("+ Categorías");
  });

  it("prefixa o idioma em todos os links fora do português", () => {
    const saida = html(<TrilhaDeCategorias locale="en" />);
    expect(saida).toContain('href="/en/cafes?formato=graos"');
    expect(saida).not.toContain('href="/cafes?formato=graos"');
  });

  it("é uma região nomeada", () => {
    const saida = html(<TrilhaDeCategorias locale="pt" />);
    expect(saida).toContain('aria-label="Categorias"');
  });
});
```

- [x] **Step 2: Rodar e ver falhar**

```bash
npm test -- TrilhaDeCategorias
```

Esperado: FAIL.

- [x] **Step 3: Escrever `TrilhaDeCategorias.tsx`**

Crie `frontend/components/catalogo/TrilhaDeCategorias.tsx`:

```tsx
import Link from "next/link";
import { Carrossel } from "@/components/ui/Carrossel";
import { dicionario } from "@/lib/i18n/dicionario";
import { href } from "@/lib/i18n/rotas";
import { LOCALE_PADRAO, type Locale } from "@/lib/i18n/tipos";

/**
 * A FAIXA LOGO ABAIXO DA PROVA — e ela é TIPOGRÁFICA, sem cartela nem foto.
 *
 * A decisão é de acervo antes de ser de gosto. O §8 do estetica.md declara a
 * produção fotográfica como caminho crítico do projeto, e ela não aconteceu:
 * seis cartelas exigiriam seis imagens que não existem, e a alternativa real
 * seria recortar arte de embalagem — que é exatamente o "default de IA" que o
 * §2 manda evitar. Tipografia é o que a marca tem de verdade.
 *
 * CÁPSULAS E DRIPS NÃO TÊM NADA COMPRÁVEL HOJE — os 13 SKUs desses dois
 * formatos estão todos esgotados ou sem preço. Eles ficam na trilha assim
 * mesmo, pela regra que `CardKit`, `PainelCompra` e `repositorio.ts` já
 * documentam: sumir com produto é pior do que dizer que acabou. A PLP filtra
 * por LINHA, não por SKU, então `?formato=drip` devolve as linhas que oferecem
 * drip e mostra o estado real de cada uma — o link não leva a lugar vazio. No
 * dia em que o estoque voltar, a trilha já está certa.
 */

export const CATEGORIAS_DA_TRILHA = [
  { chave: "capsula", caminho: "/cafes?formato=capsula" },
  { chave: "drip", caminho: "/cafes?formato=drip" },
  { chave: "graos", caminho: "/cafes?formato=graos" },
  { chave: "moido", caminho: "/cafes?formato=moido" },
  { chave: "kit", caminho: "/cafes?tipo=kit" },
  { chave: "todas", caminho: "/cafes" },
] as const;

export function TrilhaDeCategorias({
  locale = LOCALE_PADRAO,
}: {
  locale?: Locale;
}) {
  const d = dicionario(locale);

  /**
   * OS NOMES DE FORMATO SAEM DO DICIONÁRIO, NÃO DE UMA TABELA NOVA. "Grãos",
   * "Moído", "Drip Coffee" e "Cápsulas" já são o vocabulário dos filtros da
   * PLP e dos chips da PDP; escrevê-los aqui de novo criaria o segundo lugar
   * onde eles podem discordar.
   */
  function rotulo(chave: (typeof CATEGORIAS_DA_TRILHA)[number]["chave"]) {
    if (chave === "kit") return d.comum.nossosKits;
    if (chave === "todas") return d.comum.maisCategorias;
    return d.catalogo.formato[chave];
  }

  return (
    <section className="border-b border-fuligem-20 bg-cal">
      <div className="mx-auto max-w-[1440px] px-4 py-5 md:px-10">
        <Carrossel rotulo={d.comum.categorias}>
          {CATEGORIAS_DA_TRILHA.map((c) => (
            /*
              `basis-auto` em vez do slide de largura fixa: aqui o item é uma
              PALAVRA, e forçá-la a 58% da tela deixaria "Kits" sozinho num
              quarteirão vazio. O `shrink-0` é o que mantém a faixa numa linha
              só e faz o overflow acontecer — que é o que a torna arrastável.
            */
            <li key={c.chave} className="shrink-0 snap-start">
              <Link
                href={href(locale, c.caminho)}
                className="inline-flex min-h-11 items-center px-4 text-[14px] font-semibold uppercase tracking-[0.1em] text-fuligem transition-colors duration-200 hover:text-vermelho focus-visible:outline-2 focus-visible:outline-offset-[3px] focus-visible:outline-vermelho md:px-6"
              >
                {rotulo(c.chave)}
              </Link>
            </li>
          ))}
        </Carrossel>
      </div>
    </section>
  );
}
```

- [x] **Step 4: Rodar até passar**

```bash
npm test -- TrilhaDeCategorias
```

Esperado: PASS, 5 testes.

Se o teste dos rótulos falhar porque `d.catalogo.formato.capsula` devolve outra palavra (ex.: "Cápsula" no singular), **ajuste o TESTE ao dicionário**, não o dicionário ao teste — aquele vocabulário já é usado pela PLP e pela PDP.

O `<Carrossel>` é `"use client"` e este componente é server. Isso é composição válida no App Router: o servidor passa `children` já renderizados para a ilha client.

- [x] **Step 5: Commit**

```bash
git add frontend/components/catalogo/TrilhaDeCategorias.tsx frontend/components/catalogo/TrilhaDeCategorias.test.tsx
git commit -m "feat: seis palavras abrem o catalogo logo abaixo da prova"
```

---

## Task 10: Os dois filtros novos da PLP

**Files:**
- Modify: `frontend/lib/catalogo/tipos.ts`
- Modify: `frontend/lib/catalogo/repositorio.ts`
- Modify: `frontend/app/[locale]/(vitrine)/cafes/page.tsx`

- [ ] **Step 1: Estender o contrato**

Em `frontend/lib/catalogo/tipos.ts`, acima do `export type Filtros`, acrescente:

```ts
/**
 * As duas seções curadas da home, quando elas viram filtro de PLP.
 *
 * O "Ver mais" de cada carrossel abre a listagem inteira daquele recorte, e é
 * por isso que o destaque precisa existir como filtro: sem ele, o sétimo card
 * levaria a `/cafes` sem recorte nenhum e a pessoa perderia o contexto em que
 * clicou.
 */
export type Destaque = "mais-vendidos" | "escolha-do-produtor";

export const DESTAQUES: Destaque[] = ["mais-vendidos", "escolha-do-produtor"];
```

E dentro de `Filtros`, junto dos outros campos:

```ts
  /** O recorte curado da home — ver `Destaque`. */
  destaque?: Destaque;
  /**
   * "kit" traz só caixas e kits. É o mesmo recorte da seção "Kits e caixas"
   * que a PLP já desenha, agora alcançável por URL — que é o que a trilha de
   * categorias da home precisa.
   */
  tipo?: "kit";
```

- [ ] **Step 2: Escrever o teste que falha**

Acrescente ao fim de `frontend/lib/catalogo/repositorio.test.ts`. O arquivo já importa `describe`, `it`, `expect` e `listarLotes` no topo — **confira antes de colar** e acrescente só o que faltar, em vez de duplicar import.

```ts
describe("filtros da home", () => {
  it("?destaque=mais-vendidos devolve só linhas com SKU curado", async () => {
    const lotes = await listarLotes({ destaque: "mais-vendidos" });
    expect(lotes.length).toBeGreaterThan(0);
    for (const l of lotes) {
      expect(["classico", "suave"], l.slug).toContain(l.slug);
    }
  });

  it("?destaque=escolha-do-produtor traz um recorte diferente", async () => {
    const a = (await listarLotes({ destaque: "mais-vendidos" })).map((l) => l.slug);
    const b = (await listarLotes({ destaque: "escolha-do-produtor" })).map((l) => l.slug);
    expect(b.some((s) => !a.includes(s))).toBe(true);
  });

  it("?tipo=kit devolve só linhas que têm caixa ou kit", async () => {
    const lotes = await listarLotes({ tipo: "kit" });
    expect(lotes.length).toBeGreaterThan(0);
    for (const l of lotes) {
      expect(["classico", "suave", "canela"], l.slug).toContain(l.slug);
    }
  });

  it("sem os filtros novos, nada muda", async () => {
    // A garantia de que esta task não mexeu na listagem de sempre.
    expect((await listarLotes()).length).toBe(5);
  });
});
```

- [ ] **Step 3: Rodar e ver falhar**

```bash
npm test -- repositorio
```

Esperado: FAIL — os filtros ainda não existem, então `listarLotes({ destaque: ... })` devolve as 5 linhas.

- [ ] **Step 4: Implementar no repositório**

Em `frontend/lib/catalogo/repositorio.ts`, acrescente o import:

```ts
import { PRODUTOS } from "./produtos";
import { ehCaixaOuKit } from "./curadoria";
```

E, dentro do `catalogo.filter((lote) => {` de `listarLotes`, antes do `return true;` final:

```ts
    /**
     * OS DOIS FILTROS DA HOME, E ELES FILTRAM LINHA A PARTIR DE SKU.
     *
     * A curadoria vive por SKU ("Clássico em Grãos 250 g") e esta listagem é
     * por LINHA ("Canastra Clássico"). O recorte então é: a linha entra se ao
     * menos um SKU dela satisfaz. Não é aproximação — é o que mantém uma PLP
     * só, com os mesmos filtros, a mesma busca e o mesmo SEO, em vez de uma
     * segunda listagem por SKU que teria de repetir tudo isso.
     */
    if (filtros.destaque) {
      const campo =
        filtros.destaque === "mais-vendidos" ? "maisVendido" : "escolhaDoProdutor";
      const temCurado = PRODUTOS.some(
        (p) => p.linha === lote.linha && p[campo] !== undefined,
      );
      if (!temCurado) return false;
    }

    if (filtros.tipo === "kit") {
      const temCaixa = PRODUTOS.some(
        (p) => p.linha === lote.linha && ehCaixaOuKit(p),
      );
      if (!temCaixa) return false;
    }
```

- [ ] **Step 5: Rodar até passar**

```bash
npm test -- repositorio
```

Esperado: PASS.

- [ ] **Step 6: Ler os filtros na URL**

Em `frontend/app/[locale]/(vitrine)/cafes/page.tsx`, no import de tipos, acrescente `DESTAQUES` e `type Destaque`. Depois, dentro de `lerFiltros`, acrescente as duas leituras:

```ts
  const destaque = texto(sp.destaque) as Destaque | undefined;
  const tipo = texto(sp.tipo);
```

E dentro do objeto `filtros` devolvido:

```ts
      /**
       * VALIDADO CONTRA A LISTA, como todo filtro desta página: a URL é
       * pública e editável, e `?destaque=qualquer-coisa` tem de virar
       * "sem filtro" em vez de listagem vazia sem explicação.
       */
      destaque: destaque && DESTAQUES.includes(destaque) ? destaque : undefined,
      tipo: tipo === "kit" ? "kit" : undefined,
```

- [ ] **Step 7: Mostrar os chips**

Na função `ativos`, antes do `if (ordenacao !== "relevancia")`, acrescente:

```ts
  if (f.destaque)
    out.push({
      chave: "destaque",
      rotulo:
        f.destaque === "mais-vendidos"
          ? d.comum.maisVendidos
          : d.comum.escolhaDoProdutor,
    });
  if (f.tipo === "kit") out.push({ chave: "tipo", rotulo: d.comum.nossosKits });
```

- [ ] **Step 8: Rodar tudo e checar tipos**

```bash
npm test && cd frontend && npx tsc --noEmit && cd ..
```

Esperado: PASS, zero erro.

- [ ] **Step 9: Commit**

```bash
git add frontend/lib/catalogo/tipos.ts frontend/lib/catalogo/repositorio.ts "frontend/app/[locale]/(vitrine)/cafes/page.tsx"
git commit -m "feat: a listagem entende os recortes que a home anuncia"
```

---

## Task 11: A home nova

**Files:**
- Modify: `frontend/app/[locale]/(vitrine)/page.tsx`

- [ ] **Step 1: Escrever o teste que falha**

Crie `frontend/app/[locale]/(vitrine)/home.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

/**
 * A ORDEM DA HOME, provada pelo texto do arquivo.
 *
 * Não é o teste que se gostaria de ter — o ideal renderizaria a página. Mas a
 * home é um Server Component `async` que faz `fetch` ao repositório, e a suíte
 * roda em `environment: "node"` sem DOM nem servidor. Provar a ORDEM DAS
 * SEÇÕES pela posição no arquivo é o que dá para provar aqui, e é justamente
 * o que esta mudança pode quebrar sem ninguém ver.
 */
const fonte = readFileSync(
  new URL("./page.tsx", import.meta.url),
  "utf8",
);

function posicao(marca: string): number {
  const i = fonte.indexOf(marca);
  expect(i, `não achei ${marca}`).toBeGreaterThan(-1);
  return i;
}

describe("ordem da home", () => {
  it("põe produto acima de conteúdo", () => {
    expect(posicao("TrilhaDeCategorias")).toBeLessThan(posicao("seccoes.maisVendidos"));
    expect(posicao("seccoes.maisVendidos")).toBeLessThan(posicao("seccoes.kits"));
    expect(posicao("seccoes.kits")).toBeLessThan(posicao("seccoes.escolhaDoProdutor"));
    expect(posicao("seccoes.escolhaDoProdutor")).toBeLessThan(posicao("clubeTitulo"));
    expect(posicao("clubeTitulo")).toBeLessThan(posicao("SecaoDoBlog"));
    expect(posicao("SecaoDoBlog")).toBeLessThan(posicao("etapasTitulo"));
  });

  it("a trilha vem depois da faixa de prova", () => {
    expect(posicao("provaRotulo")).toBeLessThan(posicao("TrilhaDeCategorias"));
  });

  it("o bloco História saiu — /historia já o conta inteiro", () => {
    expect(fonte).not.toContain("historiaTitulo");
    expect(fonte).not.toContain("historiaImagemAlt");
  });

  it("continua estática", () => {
    // Sem isto a home paga render de servidor a cada visita — está medido em
    // docs/performance-dev.md §7.
    expect(fonte).toContain("generateStaticParams");
    expect(fonte).toContain("export const revalidate");
    expect(fonte).not.toContain("cookies()");
    expect(fonte).not.toContain("searchParams");
  });

  it("nunca põe duas superfícies escuras seguidas", () => {
    // §7.1 do estetica.md. As escuras são fuligem e mata; entre uma e outra
    // tem de haver clara.
    const escuras = [...fonte.matchAll(/bg-(fuligem|mata)\b/g)].map((m) => m.index!);
    const claras = [...fonte.matchAll(/bg-(cal|juta-claro)\b/g)].map((m) => m.index!);
    for (let i = 1; i < escuras.length; i++) {
      const houveClara = claras.some(
        (c) => c > escuras[i - 1] && c < escuras[i],
      );
      expect(houveClara, `duas escuras seguidas na posição ${escuras[i]}`).toBe(true);
    }
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

```bash
npm test -- home
```

Esperado: FAIL — `TrilhaDeCategorias` não está no arquivo e `historiaTitulo` ainda está.

- [ ] **Step 3: Trocar os imports da home**

Em `frontend/app/[locale]/(vitrine)/page.tsx`, remova o import de `MARCO_DE_ORIGEM` e acrescente:

```ts
import { Carrossel, SlideDoCarrossel } from "@/components/ui/Carrossel";
import { CardProduto } from "@/components/catalogo/CardProduto";
import { CardVerMais } from "@/components/catalogo/CardVerMais";
import { TrilhaDeCategorias } from "@/components/catalogo/TrilhaDeCategorias";
import { produtosDaHome } from "@/lib/catalogo/repositorio";
import type { ProdutoVendavel } from "@/lib/catalogo/tipos";
```

**Não importe de `curadoria.ts` aqui.** A curadoria escolhe QUAIS SKUs e não sabe preço de banco; quem entrega os três grupos prontos, com `produtoId` e preço ao vivo, é `produtosDaHome()` (Task 5B). Importar a curadoria direto na home é justamente o furo que a Task 5B conserta — a página venderia pelo preço de ontem e nenhum botão funcionaria.

`CardCafe`, `listarLotes` e `traduzirLote` podem sair se a seção "Torra da semana" for removida — e ela é: os três carrosséis a substituem. Remova também o `Image` se ele ficar sem uso fora do herói (ele continua sendo usado no herói, então **mantenha**).

- [ ] **Step 4: Atualizar a tabela de textos**

Nos três objetos `pt`, `en` e `es`, **remova** `historiaTitulo`, `historiaTexto`, `historiaImagemAlt` e `torraTitulo`. Não remova `etapasTitulo`, `etapas`, `clubeRotulo`, `clubeTitulo`, `clubeTexto`, nem nada do herói ou da prova.

- [ ] **Step 5: Escrever o componente de seção**

Acrescente, antes de `export default async function Home`:

```tsx
/**
 * UMA SEÇÃO DE PRODUTO DA HOME — as três são a mesma coisa com dados
 * diferentes, e por isso são uma função só.
 *
 * O SÉTIMO CARD É SEMPRE O "VER MAIS", e ele entra aqui e não em cada
 * chamada: fosse responsabilidade de quem chama, o dia em que alguém
 * acrescentasse a quarta seção e esquecesse o card, o trilho terminaria num
 * beco sem saída — e ninguém veria, porque não quebra nada.
 */
function SecaoDeProdutos({
  titulo,
  produtos,
  verMais,
  locale,
  superficie,
}: {
  titulo: string;
  produtos: ProdutoVendavel[];
  /** Caminho canônico em português — `href()` cuida do idioma. */
  verMais: string;
  locale: Locale;
  /** A superfície da seção. §7.1: a alternância é o que dá ritmo à página. */
  superficie: "cal" | "juta-claro";
}) {
  return (
    <section
      className={`${superficie === "cal" ? "bg-cal" : "bg-juta-claro"} py-12 md:py-16`}
    >
      <div className="mx-auto max-w-[1440px] px-4 md:px-10">
        <h2 className="titulo-secao text-[clamp(1.5rem,3vw,2.25rem)] leading-tight">
          {titulo}
        </h2>
      </div>

      {/*
        O TRILHO SANGRA ATÉ A BORDA, e a calha vira padding dele. Sem isso o
        card cortado terminaria no meio da margem, e o corte pareceria erro de
        layout em vez de convite a arrastar.
      */}
      <div className="mt-6 md:mt-8">
        <Carrossel
          rotulo={titulo}
          className="[&>div]:px-4 [&>div]:md:px-10 [&>div]:mx-auto [&>div]:max-w-[1440px]"
        >
          {produtos.map((p) => (
            <SlideDoCarrossel key={p.sku}>
              <CardProduto produto={p} locale={locale} />
            </SlideDoCarrossel>
          ))}
          <SlideDoCarrossel>
            <CardVerMais caminho={verMais} locale={locale} />
          </SlideDoCarrossel>
        </Carrossel>
      </div>
    </section>
  );
}
```

- [ ] **Step 6: Trocar o corpo do `Home`**

Dentro de `export default async function Home`, substitua o cálculo dos lotes. Onde hoje está:

```ts
  const lotes = (await listarLotes()).map((l) => traduzirLote(l, locale));
  const notasSca = lotes.map((l) => l.sca);
  const faixaSca = `SCA ${Math.min(...notasSca)}–${Math.max(...notasSca)}`;
```

Ponha:

```ts
  /**
   * A FAIXA DE PONTUAÇÃO CONTINUA SAINDO DO CATÁLOGO, não de uma constante:
   * no dia em que uma linha entrar ou sair, ela acompanha sozinha. O que
   * mudou é a fonte — `lotesDoLocale` em vez de `listarLotes` —, porque a
   * home não desenha mais card de LINHA e não precisa do preço ao vivo para
   * calcular uma faixa de nota. Os carrosséis leem a curadoria, que é
   * catálogo puro.
   */
  const notasSca = lotesDoLocale(locale).map((l) => l.sca);
  const faixaSca = `SCA ${Math.min(...notasSca)}–${Math.max(...notasSca)}`;

  /**
   * UMA LEITURA DA API PARA AS TRÊS SEÇÕES — ver `produtosDaHome()`. É aqui
   * que o preço do painel e o `produtoId` do banco entram na página; sem este
   * `await`, os carrosséis anunciariam o preço do JSON e nenhum botão
   * conseguiria pôr nada na sacola.
   *
   * Isto NÃO tira a home da geração estática: `buscarDadosAoVivo` é `fetch`
   * com `next: { revalidate }`, que é justamente a leitura que sobrevive ao
   * prerender — a mesma que `listarLotes` já fazia nesta página antes.
   */
  const seccoes = await produtosDaHome();
```

E acrescente o import `import { lotesDoLocale } from "@/lib/catalogo/produtos";`.

- [ ] **Step 7: Trocar o JSX**

Depois do `</section>` da faixa de prova, **remova a seção inteira "TORRA DA SEMANA"** e ponha:

```tsx
      {/* ── CATEGORIAS ────────────────────────────────────────── superfície cal */}
      <TrilhaDeCategorias locale={locale} />

      {/* ── MAIS VENDIDOS ─────────────────────────────────────── superfície cal */}
      <SecaoDeProdutos
        titulo={d.comum.maisVendidos}
        produtos={seccoes.maisVendidos}
        verMais="/cafes?destaque=mais-vendidos"
        locale={locale}
        superficie="cal"
      />

      {/* ── NOSSOS KITS ────────────────────────────────────── superfície kraft */}
      {/* Kraft aqui é o que impede três carrosséis Cal empilhados — §7.1 pede
          alternância, e sem ela a página perde o ritmo antes do Clube. */}
      <SecaoDeProdutos
        titulo={d.comum.nossosKits}
        produtos={seccoes.kits}
        verMais="/cafes?tipo=kit"
        locale={locale}
        superficie="juta-claro"
      />

      {/* ── ESCOLHA DO PRODUTOR ───────────────────────────────── superfície cal */}
      <SecaoDeProdutos
        titulo={d.comum.escolhaDoProdutor}
        produtos={seccoes.escolhaDoProdutor}
        verMais="/cafes?destaque=escolha-do-produtor"
        locale={locale}
        superficie="cal"
      />
```

Em seguida vem a seção CLUBE, **que fica como está**. Depois dela, `<SecaoDoBlog locale={locale} />`.

**Remova a seção HISTÓRIA inteira.** `/historia` já publica a mesma narrativa completa nos três idiomas — o bloco da home era um resumo dela.

Por último, **mova a seção DO PÉ À XÍCARA** — ela hoje está entre "Torra da semana" e "Clube" — **para depois do `<SecaoDoBlog />`**, e troque `bg-juta-claro` por `bg-cal` na tag `<section>`.

Isto é um RECORTE E COLE do bloco que já existe. Nada dentro dele muda: nem o `<h2>`, nem o `<ol>`, nem `numeroDaEtapa`, nem `t.etapas`. As duas únicas alterações são a POSIÇÃO no arquivo e a classe da superfície. O resultado final é exatamente:

```tsx
      {/* ── DO PÉ À XÍCARA ──────────────────────────────────────── superfície cal */}
      {/* Trocou kraft por Cal ao mudar de lugar: agora ela encosta no Blog, que
          é kraft, e duas kraft seguidas apagariam a divisa entre as duas. */}
      <section className="bg-cal py-16 md:py-24">
        <div className="mx-auto max-w-[1440px] px-4 md:px-10">
          <h2 className="titulo-secao text-[clamp(1.75rem,3.5vw,2.75rem)] leading-tight">
            {t.etapasTitulo}
          </h2>
          {/* Numeração justificada: é sequência real e irreversível (§7.1). */}
          <ol className="mt-10 grid grid-cols-1 gap-x-8 gap-y-8 sm:grid-cols-2 lg:grid-cols-5">
            {t.etapas.map((etapa, i) => (
              <li key={etapa.titulo} className="border-t border-fuligem/25 pt-4">
                <span className="font-dado text-[13px] tracking-[0.08em] text-barro">
                  {numeroDaEtapa(i)}
                </span>
                <h3 className="mt-2 text-[17px] font-semibold">{etapa.titulo}</h3>
                <p className="mt-1.5 text-[15px] leading-relaxed text-fuligem-80">
                  {etapa.texto}
                </p>
              </li>
            ))}
          </ol>
        </div>
      </section>
```

- [ ] **Step 8: Rodar até passar**

```bash
npm test -- home
```

Esperado: PASS, 5 testes.

- [ ] **Step 9: Rodar tudo e checar tipos**

```bash
npm test && cd frontend && npx tsc --noEmit && cd ..
```

Esperado: PASS, zero erro. Se `paginas-estaticas.test.ts` falhar, **pare** — significa que a home saiu do build, e é o risco nº 1 do spec.

- [ ] **Step 10: Commit**

```bash
git add "frontend/app/[locale]/(vitrine)/page.tsx" "frontend/app/[locale]/(vitrine)/home.test.ts"
git commit -m "feat: a home para de se apresentar e comeca a vender"
```

---

## Task 12: Verificação final

**Files:** nenhum — esta task só prova.

- [ ] **Step 1: Suíte inteira**

```bash
npm test
```

Esperado: PASS. Zero falha.

- [ ] **Step 2: Tipos**

```bash
cd frontend && npx tsc --noEmit && cd ..
```

Esperado: zero erro.

- [ ] **Step 3: Lint**

```bash
cd frontend && npm run lint && cd ..
```

Esperado: zero erro. Aviso de `img` do Next é aceitável se já existia antes.

- [ ] **Step 4: Build**

```bash
npm run build
```

Esperado: sucesso.

⚠️ **Se o build morrer por falta de memória ou espaço, isso é ambiente e não código** — anote o erro exato no relatório e siga para o Step 5. Não tente "consertar" o build. (Medido na execução das Tasks 1–5: ~30 GB livres, suíte em ~7 s. O aviso fica como rede, não como expectativa.)

- [ ] **Step 5: Provar que as três homes continuam saindo do build**

```bash
node -e "
const m=require('./frontend/.next/prerender-manifest.json');
const rotas=Object.keys(m.routes);
for (const r of ['/', '/en', '/es']) {
  if (!rotas.includes(r)) throw new Error('A home '+r+' NAO saiu do build');
  console.log('estatica:', r);
}
"
```

Esperado: as três linhas. Se falhar, a home perdeu a geração estática — é o risco nº 1 do spec e precisa voltar à Task 11.

Se o Step 4 não completou por falta de recurso, pule este e diga isso no relatório.

- [ ] **Step 6: Commit final, se sobrou algo**

```bash
git status
```

Se houver mudança não commitada, commite; senão, esta task acaba aqui.

---

## Checklist de cobertura do spec

| Seção do spec | Task |
|---|---|
| §3 Estrutura da home | 11 |
| §3.1 Alternância de superfície | 11 (teste) |
| §4 Trilha de categorias | 9 |
| §4.1 Destinos | 9 (teste) |
| §4.2 Cápsulas/drips esgotados | 9 (comentário + teste) |
| §5.1 Regra comum, teto, esgotado | 3 |
| §5.2 Mais vendidos | 3, 11 |
| §5.3 Nossos Kits / "kits e caixas" | 3 |
| §5.4 Escolha do Produtor | 3, 11 |
| §6 Contrato da curadoria | 3 |
| §6.0 Queda com curadoria vazia | 3 (teste) |
| §6.1 Afirmação editorial | 3 (comentário), 2 (dicionário) |
| §7.1 `<Carrossel>` | 6 |
| §7.2 `CardProduto` | 7 |
| §7.3 `CardVerMais` | 8 |
| §7.4 `TrilhaDeCategorias` | 9 |
| §7.5 Extração do hook | 4, 5 |
| Preço ao vivo + produtoId na home | **5B** (não estava no plano original) |
| §8 Filtros da PLP | 10 |
| §9 i18n | 2 |
| §10 Testes | todas |
| §11 Riscos | 12 (Step 5) |
