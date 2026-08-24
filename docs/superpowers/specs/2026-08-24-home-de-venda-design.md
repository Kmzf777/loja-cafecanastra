# A home vira loja — design

**Data:** 24 de agosto de 2026
**Estado:** aprovado
**Alcance:** `frontend/app/[locale]/(vitrine)/page.tsx`, catálogo, PLP, dicionário, três componentes novos.

---

## 1. O problema

A home de hoje é uma página de marca com uma prateleira no meio. Sete seções, e só uma vende: `Torra da semana`, que mostra as cinco linhas em grade estática. O resto — faixa de prova, `Do pé à xícara`, `Clube`, `História`, `Blog` — é institucional, e três dessas seções repetem, em versão curta, texto que já existe por inteiro em `/a-serra`, `/historia` e `/clube`.

Uma loja de um produtor só não precisa se apresentar quatro vezes antes de mostrar o preço. O que ela precisa é pôr produto comprável acima da dobra e manter produto comprável na tela durante toda a rolagem.

Esta é a mudança. **Nenhuma página nova é criada** — o que sai da home já tem casa.

---

## 2. Decisões tomadas

| # | Questão | Decisão |
|---|---|---|
| 1 | Sem dado de venda, o que alimenta "Mais vendidos"? | Curadoria versionada em `data/catalogo-canastra.json` |
| 2 | O card é a linha ou o SKU? | **SKU vendável** — card novo, com preço final e botão de compra |
| 3 | Para onde vai o "Ver mais"? | PLP existente, com filtro na querystring |
| 4 | Como o carrossel arrasta? | `embla-carousel-react` 8.6.0 sobre uma base de `scroll-snap` que funciona sem JS |
| 5 | Ordem final | Ver §3 |
| 6 | O que é a trilha de categorias? | Faixa **tipográfica**, sem imagem |
| 7 | Para onde vai o texto removido? | `História` sai; `/historia` já a conta. `Do pé à xícara` fica na home, no fim. |

### 2.1 A ambiguidade que foi resolvida, e como

Duas respostas do briefing colidiam: a pergunta de ordem manteve `Do pé à xícara` na home; a de conteúdo, na opção escolhida, mandava a mesma seção para `/a-serra`.

Vence a **ordem**, porque foi a pergunta específica sobre layout e a escolha veio com o desenho da página à vista. `Do pé à xícara` permanece na home, no fim, na grade de cinco etapas de hoje. O que sai é o bloco `História` — e ele sai sem realocação porque `/historia` já publica a mesma narrativa completa, nos três idiomas.

---

## 3. A página

```
HERÓI                    fuligem   ── inalterado
FAIXA DE PROVA           cal       ── inalterado
TRILHA DE CATEGORIAS     cal       ── NOVO
MAIS VENDIDOS            cal       ── NOVO   carrossel · até 6 SKUs + "Ver mais"
NOSSOS KITS              juta-claro── NOVO   carrossel · até 6 caixas + "Ver mais"
ESCOLHA DO PRODUTOR      cal       ── NOVO   carrossel · até 6 SKUs + "Ver mais"
CLUBE                    mata      ── inalterado
BLOG                     juta-claro── inalterado
DO PÉ À XÍCARA           cal       ── movido para o fim
RODAPÉ                   fuligem
```

`HISTÓRIA` é removida.

### 3.1 A alternância de superfície continua íntegra

`estetica.md` §7.1 impõe: **nunca duas seções escuras seguidas.** Só existe uma superfície escura no miolo — `mata`, no Clube — e ela fica cercada por `cal` acima e `juta-claro` abaixo. O rodapé é `fuligem`, e a seção antes dele passa a ser `cal` (`Do pé à xícara`), o que satisfaz a regra.

`Nossos Kits` recebe `juta-claro` de propósito: sem isso seriam três carrosséis `cal` empilhados e a página perderia o ritmo que o documento pede. `Do pé à xícara` troca `juta-claro` por `cal` pelo mesmo motivo — ela agora encosta no Blog, que é `juta-claro`.

---

## 4. A trilha de categorias

Faixa horizontal, arrastável, **puramente tipográfica**:

```
Cápsulas      Drips      Grãos      Moído      Kits      + Categorias
```

Sem cartela, sem foto, sem ícone. A decisão é do acervo antes de ser do gosto: `estetica.md` §8 declara a produção fotográfica como caminho crítico do projeto e ela não aconteceu. Seis cartelas exigiriam seis imagens que não existem — e a alternativa real seria reusar arte de embalagem recortada, que é justamente o "default de IA" que o §2 manda evitar.

### 4.1 Destinos

| Rótulo | Destino |
|---|---|
| Cápsulas | `/cafes?formato=capsula` |
| Drips | `/cafes?formato=drip` |
| Grãos | `/cafes?formato=graos` |
| Moído | `/cafes?formato=moido` |
| Kits | `/cafes?tipo=kit` |
| + Categorias | `/cafes` |

Os quatro primeiros já funcionam hoje: `?formato=` é filtro implementado e testado em `lerFiltros`. Só `?tipo=kit` é novo.

### 4.2 Cápsulas e drips não têm nada comprável — e a trilha os mostra assim mesmo

**Os 13 SKUs de drip e cápsula do catálogo estão todos esgotados ou sem preço.** Nenhum é comprável hoje.

A trilha os mantém, e a razão está escrita em três lugares deste repositório: `CardKit`, `PainelCompra` e `repositorio.ts` documentam a mesma regra — **sumir com produto é pior do que dizer que acabou.** A PLP é a nível de linha, não de SKU, então `/cafes?formato=drip` devolve as linhas que oferecem drip e as apresenta com o estado real de cada uma. O link não leva a lugar nenhum vazio.

Isto é uma nota de vigilância, não um defeito: no dia em que o estoque voltar, a trilha já está certa.

---

## 5. As três seções de produto

### 5.1 Regra comum

- Até **6 cards**, mais um **7º card fixo**: `Ver mais`, que abre a PLP filtrada.
- Todos são o mesmo carrossel arrastável, com o mesmo recorte de continuação.
- A ordem é a da curadoria (§6).

**Esgotado — a regra tem duas metades, e elas não se contradizem:**

1. Um SKU **que a curadoria escolheu** e que depois esgotou **não some**. Desce para o fim da seção e aparece marcado `Esgotado`, com o botão desabilitado. É a regra que `CardKit` e `PainelCompra` já documentam.
2. Um SKU esgotado **nunca é acrescentado** a uma seção só para ela fechar seis cards. Seção com quatro cards que vendem é melhor que seção com seis onde dois não vendem.

Em resumo: esgotado sobrevive à curadoria, mas não entra por preenchimento.

### 5.2 Mais vendidos

Curadoria por `maisVendido` no catálogo. Card = SKU vendável. Ver mais → `/cafes?destaque=mais-vendidos`.

Há **16 SKUs compráveis**, então a seção tem material de sobra.

### 5.3 Nossos Kits — e o problema que ela tem

Só **três produtos carregam `kit: true`** no catálogo, e **dois deles são cápsulas com preço e estoque zerados.** Uma seção "Nossos Kits" que lesse só essa flag nasceria com um card.

**A seção adota o recorte que a PLP já usa — "Kits e caixas"** — que é `kit === true` **ou** `pacotes > 1`. Isso traz quatro itens de fato compráveis:

| SKU | Preço | Estoque |
|---|---|---|
| `classico-graos-caixa-4x500` | R$ 236,70 | 10 |
| `kit-canela-classico-suave-moido-3x250` | R$ 109,70 | 6 |
| `classico-moido-caixa-3x250` | R$ 99,90 | 10 |
| `suave-moido-caixa-3x250` | R$ 99,90 | 10 |

Os quatro compráveis vêm primeiro. Se a curadoria não completar seis, o carrossel exibe quatro e o `Ver mais` — **não se preenche com esgotado só para fechar o número.** Um carrossel de seis onde dois não vendem é pior que um de quatro que vende inteiro.

Ver mais → `/cafes?tipo=kit`.

### 5.4 Escolha do Produtor

Curadoria por `escolhaDoProdutor`. Mesmo card do §5.2. Ver mais → `/cafes?destaque=escolha-do-produtor`.

A curadoria semeada evita repetir a de "Mais vendidos": puxa o Microlote (SCA 86, a única nota publicada acima do piso), o Néctar de Minas e os formatos de 1 kg — que é o que um produtor recomenda a quem já sabe o que quer.

---

## 6. Curadoria — o contrato

Dois campos **opcionais** por produto em `data/catalogo-canastra.json`:

```json
{
  "sku": "microlote-graos-250",
  "maisVendido": 3,
  "escolhaDoProdutor": 1
}
```

- **Número** = posição na seção, crescente.
- **Ausente** = o SKU não aparece naquela seção.
- Um SKU pode estar nas duas.

O tipo `ProdutoBruto` ganha os dois campos como opcionais, então nenhum produto existente quebra.

### 6.0 Queda quando a curadoria está vazia

Se **nenhum** SKU declarar o campo de uma seção, ela não renderiza vazia nem some: cai para os **SKUs compráveis** (`estoque > 0` e `preco > 0`) daquela seção, ordenados por preço crescente, limitados a seis.

- `maisVendido` vazio → os seis SKUs de pacote avulso mais baratos.
- `escolhaDoProdutor` vazio → mesma regra.
- `Nossos Kits` vazio → as caixas compráveis do §5.3, por preço.

A queda existe porque a curadoria é um arquivo editado à mão: o dia em que alguém apagar uma linha por engano, a home continua vendendo. É o mesmo princípio do `repositorio.ts`, que serve o JSON versionado quando a API não responde.

### 6.1 Isto é afirmação editorial, e o nome do campo diz isso

Este repositório é rigoroso com dado inventado. Os comentários de `tipos.ts`, `SeloSCA` e `Origem` documentam afirmações que foram **removidas** por não terem fonte: a `Lavoura` com altitude por lote, o "SCA 80+" aplicado ao Néctar de Minas que tem 75, o "lote rastreado" da faixa de prova.

`maisVendido` **não é dado de pedido.** É a casa declarando o que sai mais, num arquivo versionado e revisável em pull request. A fonte é o dono da loja, e ela é legítima — mas o campo tem nome explícito e este parágrafo existe para que ninguém, daqui a seis meses, o confunda com agregação de `order_items`.

**O caminho para o dado real está aberto e não foi tomado:** um endpoint que agregue `order_items` por SKU substituiria a curadoria sem mudar uma linha de componente, porque a ordenação já entra pronta na seção. Fica registrado como evolução, não como pendência.

---

## 7. Componentes

### 7.1 `components/ui/Carrossel.tsx` — novo

Casca genérica. Recebe `children` e devolve trilho arrastável.

**Base sem JS.** O trilho é `overflow-x-auto` com `scroll-snap-type: x mandatory` e `scroll-snap-align: start` nos filhos. Com JavaScript desligado ele arrasta nativo, com inércia do sistema, e continua vendendo. `estetica.md` §12 exige isso, e é a razão de a base não ser o Embla.

**Embla por cima.** Adiciona arrasto por mouse no desktop — que o `scroll-snap` puro não dá — e física de inércia consistente entre plataformas.

**Larguras do slide**, e é daqui que sai o recorte pedido:

| Largura | `flex-basis` | O que se vê |
|---|---|---|
| telefone | `58%` | 1 card inteiro + o segundo cortado |
| `≥640px` | `38%` | 2 inteiros + fração |
| `≥1024px` | `26%` | 3 inteiros + fração |

**Sempre sobra fração.** O corte é o que anuncia continuação, e ele tem de existir em toda largura — um carrossel que fecha certo na tela parece uma grade e ninguém arrasta.

**Movimento reduzido.** `estetica.md` §9 o torna obrigatório: sob `prefers-reduced-motion: reduce`, `duration: 0` no Embla e `scroll-behavior: auto`.

**Acessibilidade.** `role="region"` com `aria-label` da seção; setas só no desktop, com `aria-label` e 44×44 mínimos (§10); cada card já é link ou botão focável, então a navegação por teclado percorre o trilho sem widget extra.

### 7.2 `components/catalogo/CardProduto.tsx` — novo

O card de SKU. Foto da linha, nome, rótulo do formato (`Moído · 250 g`), preço final — não "a partir de", porque aqui o preço é exato — e botão de adicionar.

Herda a linguagem do `CardCafe`: filete de 1px, fita da cor da linha no topo, deslocamento de 4px com sombra sólida no hover, zero raio.

### 7.3 `components/catalogo/CardVerMais.tsx` — novo

O 7º card. Bloco tipográfico, mesma altura e largura de slide dos irmãos, com seta e o rótulo da seção. Sem foto — é navegação, não produto.

### 7.4 `components/catalogo/TrilhaDeCategorias.tsx` — novo

A faixa do §4, sobre o mesmo `<Carrossel>`.

### 7.5 `lib/sacola/usar-adicionar.ts` — extração

`CardKit` hoje carrega, dentro do componente, toda a regra de adicionar à sacola: teto por estoque, acumulado já na sacola, `produtoId` ausente quando a API está fora, confirmação com timeout cancelável no unmount, `aria-live`, e o evento `add_to_cart` do GA4. São ~60 linhas de lógica provada.

`CardProduto` precisa exatamente da mesma regra. **Copiá-la seria criar a segunda cópia de uma regra que decide se a loja cobra certo.** O hook a extrai; `CardKit` e `CardProduto` passam a dividir a mesma implementação.

É a única mudança em código existente que esta tarefa faz fora da home e da PLP, e ela é pré-requisito, não arrumação oportunista.

---

## 8. PLP — o que muda

`Filtros` ganha dois campos:

```ts
destaque?: "mais-vendidos" | "escolha-do-produtor";
tipo?: "kit";
```

E com eles: leitura em `lerFiltros`, validação contra valor inventado na URL, chip do filtro ativo, e rótulo nos três idiomas em `cafes/conteudo.ts`.

**A PLP filtra linhas, não SKUs.** `?destaque=mais-vendidos` devolve as linhas que têm ao menos um SKU curado. É coerente com o resto da página e não exige uma segunda PLP.

---

## 9. i18n

Rótulos novos em `lib/i18n/dicionario.ts`, nos três idiomas, com `pt` como fonte do tipo — chave faltante quebra o build, que é a trava que o arquivo já documenta.

| Chave | pt | en | es |
|---|---|---|---|
| `maisVendidos` | Mais vendidos | Best sellers | Más vendidos |
| `nossosKits` | Nossos kits | Our boxes | Nuestros kits |
| `escolhaDoProdutor` | Escolha do produtor | The grower's pick | Elección del productor |
| `verMais` | Ver mais | See more | Ver más |
| `categorias` | Categorias | Categories | Categorías |
| `maisCategorias` | + Categorias | + Categories | + Categorías |

Os nomes de formato (`Grãos`, `Moído`, `Drip Coffee`, `Cápsulas`) **já existem** em `catalogo.formato` e são reusados — não se escreve a segunda tabela.

---

## 10. Testes

| Arquivo | O que prova |
|---|---|
| `Carrossel.test.tsx` | Renderiza sem JS de Embla; respeita `prefers-reduced-motion`; ARIA da região |
| `CardProduto.test.tsx` | Preço exato; esgotado desabilita; sem `produtoId` avisa em vez de fingir |
| `usar-adicionar.test.ts` | Teto por estoque; acumulado; timeout cancelado no unmount |
| `TrilhaDeCategorias.test.tsx` | Os seis destinos; os três idiomas |
| `curadoria.test.ts` | Ordem crescente; ausente não aparece; teto de 6; esgotado por último |
| `page.test.tsx` (home) | Ordem das seções; `História` ausente; alternância de superfície |
| `cafes/page.test.tsx` | `?destaque=` e `?tipo=` filtram; valor inventado é ignorado |

`paginas-estaticas.test.ts` já existe e cobre a geração estática — **a home tem de continuar saindo do build.** Nada nesta mudança lê `cookies()`, `headers()` ou `searchParams`, e o `<Carrossel>` é client component dentro de página estática, que é composição permitida. O teste é a guarda.

---

## 11. Riscos

| Risco | Tratamento |
|---|---|
| A home sai da geração estática | `revalidate` e `generateStaticParams` intocados; carrossel é ilha client; `paginas-estaticas.test.ts` falha se quebrar |
| Curadoria vazia → seção vazia | §6.0 — queda para SKUs compráveis por preço. Nunca renderiza vazia. |
| Peso do JS na home | Embla são ~5 KB gzip, sem dependências. A base funciona sem ele. |
| Regressão no `CardKit` pela extração do hook | Os testes de `CardKit` já existem e passam a rodar contra o hook |
| "Mais vendidos" sem lastro | §6.1 — campo editorial, nomeado e documentado |

---

## 12. Fora de alcance

- Endpoint de venda real agregando `order_items` (§6.1 registra o caminho)
- Páginas de categoria dedicadas — decidido usar a PLP filtrada
- shadcn/ui — avaliado e recusado: traria Radix, cva, tailwind-merge e uma segunda camada de tokens sobre um design system fechado, com `preflight` escopado em `.vitrine` para não vazar no painel legado. O ganho pretendido era o carrossel, e o Embla — que é a engine que o próprio shadcn usa por baixo — entrega isso sozinho.
- Produção fotográfica (§8 do `estetica.md`) — segue como caminho crítico, e é por causa dela que a trilha de categorias é tipográfica
