# Café Canastra — Documento de Direção de Frontend

**Versão 1.0 · Agosto de 2026**
Escopo: **apenas frontend** (design system, UX, UI, componentes, specs de página e motion). O backend de e-commerce já existe — este documento não trata de catálogo, checkout, integrações fiscais ou logística.

Referência estrutural: **Ceremony Coffee Roasters** (Drexler — Awwwards Site of the Day, indicado a E-commerce of the Year).
Referência estética: **Serra da Canastra / Minas Gerais**, a partir dos ativos de marca que já existem (lettering, serra, selo SCA, embalagens preta / kraft / vermelha).

---

## Sumário

1. [Diagnóstico: o que já existe na marca](#1)
2. [O que copiar do Ceremony — e o que deliberadamente não copiar](#2)
3. [O conceito: "A mão e a etiqueta"](#3)
4. [Design tokens](#4)
5. [Biblioteca de componentes](#5)
6. [O elemento assinatura: "Escolha pela Serra"](#6)
7. [Specs de página](#7)
8. [Direção de arte fotográfica](#8)
9. [Motion e microinterações](#9)
10. [Responsivo, acessibilidade e performance](#10)
11. [Tom de voz e microcopy](#11)
12. [Roadmap de implementação](#12)

---

<a name="1"></a>
## 1. Diagnóstico: o que já existe na marca

Antes de desenhar qualquer coisa nova, é preciso reconhecer que o Café Canastra **já tem um sistema visual** — e ele é melhor do que parece à primeira vista. O trabalho do site não é inventar uma estética, é **estender a que já está na embalagem**.

### Ativos existentes

| Ativo | O que é | Papel no site |
|---|---|---|
| **Lettering em pincel** | "Café CANASTRA" em brush lettering irregular, alto contraste de traço | Logo. **Nunca** virar fonte de texto corrido. Apenas SVG. |
| **Contorno da serra** | Silhueta desenhada à mão do chapadão, com falhas brancas no traço | **O ativo mais valioso e o mais subaproveitado.** Vira sistema estrutural (ver §6). |
| **Traço/swash** | Pincelada grossa que sublinha o lettering | Divisor de seção. Um por página, no máximo. |
| **"Desde 1985"** | Lettering manuscrito | Selo de legitimidade. Rodapé, página de história, PDP. |
| **Selo "SPECIALTY / ESPECIAL / SCA 80+"** | Caixa retangular com filete, grotesca condensada, caixa alta, entreletra larga | **Componente de UI.** É a "etiqueta" do sistema (ver §3). |
| **Paleta de embalagem** | Preto (Clássico), Kraft (Suave), Vermelho (com canela) | Não é decoração — é o **sistema de cor de produto**. Cada linha tem sua cor. |

### A tensão que define a marca

O logo é **solto, gestual, imperfeito**. O selo SCA 80+ é **rígido, centralizado, técnico, filetado**.

Essa colisão já está na embalagem e ninguém a explorou. É exatamente a mesma tensão do café especial brasileiro: **origem rural + rigor de laboratório**. Fogão a lenha e planilha de cupping. Terreiro de secagem e pontuação SCA.

**Todo o design system sai daí.** Ver §3.

### Ajuste técnico obrigatório no logo

O lockup completo é largo demais para header (proporção ~3:2 com muita área vazia). Precisamos de **três versões**:

- **Completo** — serra + "Café Canastra" + swash + "Desde 1985". Uso: hero, rodapé, página institucional, e-mails.
- **Reduzido (header)** — serra + "CANASTRA" em grotesca condensada caixa alta. Altura 28px desktop / 22px mobile. Alinhado à esquerda.
- **Ícone** — apenas o contorno da serra, quadrado 1:1. Uso: favicon, avatar social, marcador de mapa, loader.

> **Entregável de design:** os três SVGs otimizados (`viewBox` limpo, sem `<style>` inline, sem grupos vazios, `currentColor` no `fill` para permitir troca de cor por CSS).

---

<a name="2"></a>
## 2. O que copiar do Ceremony — e o que deliberadamente não copiar

O Ceremony é a referência certa, mas é preciso separar **o que é estrutura** (copiar) de **o que é estética deles** (não copiar, porque é a estética *deles*).

### ✅ Copiar — as decisões de UX que fizeram o site ganhar prêmio

| Decisão do Ceremony | Por que funciona | Como fica na Canastra |
|---|---|---|
| **Foto do sabor, não do grão** | Na PDP do "Antithesis" o herói não é o saco de café: é **chocolate amargo picado**. O cliente entende o sabor antes de ler a nota. Foi a tese central do projeto. | Rapadura, doce de leite, castanha-do-pará, jabuticaba, goiabada, milho torrado, cacau, mel. **Despensa mineira, não still life escandinavo.** Ver §8. |
| **Dois públicos, uma página** | A pesquisa deles identificou "adopters" e "experts". A PDP serve os dois: nota de sabor grande e visível para o iniciante, ficha técnica recolhida atrás de um `View Details +` para o especialista. | Nota de sabor em destaque. Ficha da lavoura em `<details>` recolhido. **O iniciante nunca é intimidado; o especialista nunca é subestimado.** |
| **UI recolhida, foto no comando** | Minimalismo como ferramenta, não como estilo: a interface some para a foto aparecer. | Mesma disciplina. A "rusticidade" vem da fotografia e da textura de papel, **não** de bordas serrilhadas e ícones de folhinha. |
| **Escala numérica de torra** | "Roast Profile 5 — Dark". Transforma uma percepção subjetiva em dado comparável entre produtos. | "Ponto de Torra 1–5" (ver §5). |
| **Receita de preparo na própria PDP** | Proporção, temperatura e tempo direto na página do produto. Reduz a frustração pós-compra. | Idem, com métodos brasileiros (coador de pano incluído). |
| **Seletor de moagem explícito** | Oito opções nomeadas por método, não por granulometria. O cliente escolhe "Prensa Francesa", não "grossa". | Grão · Espresso · Coado (papel) · Coador de pano · Prensa francesa · Italiana/Moka · Aeropress. |
| **Herói empilhado na home** | Sequência de blocos full-bleed (kicker + título + parágrafo + CTA), não um carrossel. | Mesma estrutura. Carrossel de banner **não** entra. |
| **Mecanismo de descoberta autoral** | O "Taste by Color" deles é um canvas interativo que ensina a pensar café por cor. É o que separou o site do resto. | **"Escolha pela Serra"** — nosso equivalente, e melhor porque usa um ativo que já é nosso. Ver §6. |
| **Prova social como imprensa, não como badge** | Citações de Sprudge, Food & Wine, Thrillist em tipografia editorial grande. | Citações de imprensa/prêmios em bloco editorial. Sem selo de "5 estrelas ⭐⭐⭐⭐⭐" flutuante. |

### ❌ Não copiar

| Do Ceremony | Por quê |
|---|---|
| **Paleta preto / cinza / branco puro** | É a assinatura *deles* (a Awwwards catalogou o site com exatamente 3 cores: `#000`, `#9C9C9C`, `#fff`). Copiar isso nos deixa sem marca — e desperdiça o preto/kraft/vermelho que a Canastra já tem impresso. |
| **Logo centralizado no header** | Funciona para uma marca de logotipo estreito. O nosso é largo. Logo à esquerda. |
| **Fotografia em pastel / fundo infinito de estúdio** | É o vocabulário do café de terceira onda americano. O nosso é tábua, juta, cal, terra. |
| **Sistema de nomes conceituais** ("Thesis", "Antithesis", "Synthesis") | Charmoso lá, pretensioso aqui. Nossos nomes vêm do território: Casca d'Anta, Chapadão, São Roque, Vargem, Porteira. |

### ❌ E também não copiar: o "default de IA"

Um briefing de "café rústico brasileiro" empurra automaticamente para **fundo creme `#F4F1EA` + serifada de alto contraste + acento terracota `#D97757`**. Esse é hoje o visual mais genérico possível — aparece em cerveja artesanal, azeite, cerâmica e agência de viagem.

**Estamos saindo dele de propósito**, em três pontos:

1. O neutro claro é **cal fria e giz** (`#F1F0EA`, sem viés amarelo), não creme quente. Cal caiada de casa mineira, não papel envelhecido de Pinterest.
2. O acento é o **vermelho saturado da embalagem** (`#C4231E`), não terracota dessaturada.
3. Boa parte do site roda em **superfície escura**, não clara. A embalagem principal é preta e o café é torrado a lenha — o escuro é a verdade do produto, não uma escolha de moda.

---

<a name="3"></a>
## 3. O conceito: "A mão e a etiqueta"

> **Tudo que é origem é feito à mão. Tudo que é qualidade é medido e etiquetado.**

Duas linguagens convivendo em toda tela, sem se misturar:

| | **A MÃO** | **A ETIQUETA** |
|---|---|---|
| Representa | Serra, roça, 1985, o produtor, a torra | SCA 80+, altitude, safra, processo, variedade |
| Traço | Pincelada, contorno irregular, textura de papel | Filete de 1px, caixa retangular, grid rígido |
| Tipografia | Lettering do logo (SVG) + display com degradação de impressão | Grotesca condensada caixa alta + monoespaçada |
| Cor | Fuligem, kraft, barro | Cal, vermelho, filete |
| Onde aparece | Heróis, história, fotografia, divisores | Fichas técnicas, badges, filtros, preços, tabelas |
| Volume | ~20% da tela | ~80% da tela |

**Regra de ouro:** a mão é a **exceção que se nota**; a etiqueta é a **norma que organiza**. Se a página inteira ficar rústica, vira cenário de restaurante temático. A rusticidade só funciona porque o resto é impecavelmente arrumado.

**Aplicação prática:** um card de produto é *etiqueta* (grid, filete, mono, alinhamento perfeito). Ele fica em cima de uma superfície de *mão* (papel kraft com grão). O contraste é o design.

---

<a name="4"></a>
## 4. Design tokens

### 4.1 Cor

```css
:root {
  /* — Superfícies e tinta — */
  --c-fuligem:      #14110E;  /* preto de fuligem — superfície escura primária + tinta */
  --c-fuligem-80:   #3A342E;  /* texto secundário sobre claro */
  --c-fuligem-55:   #6E655C;  /* texto terciário, legendas */
  --c-fuligem-20:   #CFC8BE;  /* filetes, bordas, divisores */

  --c-cal:          #F1F0EA;  /* cal caiada — superfície clara primária */
  --c-cal-puro:     #FBFAF7;  /* cards elevados sobre cal */

  /* — Cores de território — */
  --c-juta:         #C9A87A;  /* saco de juta / kraft — painéis e linha Suave */
  --c-juta-claro:   #E2D3B8;  /* fundo de painel kraft */
  --c-barro:        #8E4B2E;  /* terra vermelha de estrada — campos e escala de torra */
  --c-mata:         #2C3B2E;  /* mata de galeria ao entardecer — superfície escura secundária */

  /* — Acento de marca — */
  --c-vermelho:     #C4231E;  /* vermelho Canastra (da embalagem) — CTA, selo, estado ativo */
  --c-vermelho-esc: #9A1A16;  /* hover/pressed */

  /* — Semânticas — */
  --c-sucesso:      #3F6B45;
  --c-alerta:       #B87514;
  --c-erro:         var(--c-vermelho);
}
```

#### Papéis de cor por linha de produto

Herdados diretamente da embalagem — **não inventar cor nova para produto**:

| Linha | Token | Uso no site |
|---|---|---|
| Clássico / Especial | `--c-fuligem` | Fundo do card, chip de linha, fita de categoria |
| Suave | `--c-juta` | Idem |
| Aromatizados (canela etc.) | `--c-vermelho` | Idem |

#### Contrastes verificados (WCAG 2.1)

| Combinação | Razão | Veredito |
|---|---|---|
| Fuligem sobre Cal | **16,4:1** | ✅ AAA |
| Cal sobre Fuligem | **16,4:1** | ✅ AAA |
| Branco sobre Vermelho | **5,8:1** | ✅ AA (botões) |
| Vermelho sobre Cal | **5,1:1** | ✅ AA (links, texto) |
| Fuligem sobre Juta | **8,4:1** | ✅ AAA |
| Branco sobre Mata | **11,8:1** | ✅ AAA |
| **Branco sobre Juta** | **2,2:1** | ❌ **Proibido.** Sobre kraft, texto sempre em Fuligem. |
| **Vermelho sobre Mata** | **2,0:1** | ❌ **Proibido.** No painel verde, CTA em Cal ou Juta. |
| **Vermelho sobre Fuligem** | **3,2:1** | ⚠️ Só texto ≥24px e elementos não textuais. Nunca corpo de texto. |

> Codificar essas duas proibições como lint/teste visual, porque são erros que acontecem sozinhos.

### 4.2 Tipografia

Três vozes, papéis estritamente separados.

```css
:root {
  --f-titulo: "Redaction 35", "Redaction", Georgia, serif;
  --f-ui:     "Archivo", "Archivo Variable", system-ui, -apple-system, sans-serif;
  --f-dado:   "Martian Mono", "Roboto Mono", ui-monospace, monospace;
}
```

| Papel | Fonte | Justificativa | Restrição |
|---|---|---|---|
| **Títulos** | **Redaction 35** (gratuita — Jeremy Mickel / Forest Young) | Serifada didone com **degradação de impressão simulada**. Parece carimbo prensado em saco de juta. Praticamente ninguém usa em café — é o nosso risco estético e ele é justificável pelo território. | **Somente ≥40px.** Abaixo disso a degradação vira sujeira. H3 em diante usa Archivo. |
| **Interface e corpo** | **Archivo** (variável, gratuita — Omnibus-Type) | Grotesca com eixos de peso *e* largura. O `Archivo Condensed` em caixa alta reproduz **exatamente** a tipografia do selo "SPECIALTY ESPECIAL SCA 80+" da embalagem. Continuidade real entre pacote e tela. | Corpo em regular 400; labels em condensed 600 caixa alta. |
| **Dados** | **Martian Mono** (gratuita) | Monoespaçada condensada. Altitude, nota SCA, safra, lote, preço, proporção de preparo. Lê como caderno de fazenda e como planilha de cupping ao mesmo tempo — é literalmente a "etiqueta" do conceito. | Só números e códigos. Nunca frase. |
| **Lettering** | Ativo SVG da marca | Logo, "Desde 1985", swash. | Nunca reproduzido em fonte. Nunca reescrito. |

> **Alternativa paga (se houver verba de licença):** Display `Canela` (Commercial Type) — piada interna deliciosa com o produto "com canela" e uma serifada muito superior. UI `Söhne` ou `Suisse Int'l`. Isso eleva o acabamento, mas **Redaction + Archivo + Martian já entregam um site premiável a custo zero.**

#### Escala tipográfica

```css
:root {
  --t-display:  clamp(2.75rem, 7vw,  5.5rem);   /* Redaction 35 · 0.95 lh · -0.02em */
  --t-h1:       clamp(2.25rem, 5vw,  3.75rem);  /* Redaction 35 · 1.0 lh  · -0.015em */
  --t-h2:       clamp(1.75rem, 3.5vw, 2.75rem); /* Redaction 35 · 1.05 lh */
  --t-h3:       clamp(1.25rem, 2vw,  1.5rem);   /* Archivo 600  · 1.2 lh */
  --t-corpo-lg: 1.125rem;                       /* Archivo 400  · 1.6 lh */
  --t-corpo:    1rem;                           /* Archivo 400  · 1.65 lh */
  --t-peq:      0.875rem;                       /* Archivo 400  · 1.5 lh */
  --t-label:    0.75rem;                        /* Archivo Cond 600 · CAPS · 0.14em tracking */
  --t-dado:     0.8125rem;                      /* Martian Mono 400 · 0.06em tracking */
}
```

**Medida de leitura:** 60–72 caracteres em texto editorial (`max-width: 62ch`). Nunca full-width.

### 4.3 Espaçamento, grid e raio

```css
:root {
  --e-1: 4px;   --e-2: 8px;   --e-3: 12px;  --e-4: 16px;
  --e-5: 24px;  --e-6: 32px;  --e-7: 48px;  --e-8: 64px;
  --e-9: 96px;  --e-10: 128px;

  --secao-desk: var(--e-10);   /* respiro vertical entre seções — desktop */
  --secao-mob:  var(--e-8);

  --largura-max: 1440px;
  --gutter-desk: 40px;
  --gutter-mob:  20px;

  --raio-cx: 0px;    /* containers, selos, imagens — o selo da embalagem é reto */
  --raio-bt: 2px;    /* botões e inputs */
}
```

**Grid:** 12 colunas desktop / 6 tablet / 4 mobile, gutter 24px.

**Sobre raio zero:** o layout "broadsheet" de filete de 1px e raio zero também virou clichê. Aqui o raio zero é justificado (o selo da embalagem é um retângulo reto), mas **a diferenciação não vem dele** — vem da textura de papel e da linha da serra. Botões e inputs ficam em 2px para não cair no jornal.

### 4.4 Textura e profundidade

Sem sombra difusa de material design. Profundidade se faz por **papel e filete**.

```css
/* Grão de papel — overlay global, aplicado uma vez no <body>::after */
.grao::after {
  content: ""; position: fixed; inset: 0; pointer-events: none; z-index: 9999;
  background-image: url("data:image/svg+xml,…feTurbulence baseFrequency='0.9'…");
  opacity: .035;               /* claro */
  mix-blend-mode: multiply;
}
[data-tema="escuro"] .grao::after { opacity: .06; mix-blend-mode: screen; }
```

- **Superfície kraft:** fundo `--c-juta-claro` + grão a 6% + filete `--c-fuligem-20`.
- **Elevação de card:** filete 1px + deslocamento sólido de 4px (`box-shadow: 4px 4px 0 var(--c-fuligem)`) — sombra de carimbo, não sombra de vidro. Usar **só** em cards clicáveis no hover.
- **Divisor de seção:** SVG da pincelada, altura 12–20px, `--c-fuligem-20`. **Máximo um por página.**

---

<a name="5"></a>
## 5. Biblioteca de componentes

### 5.1 Selo SCA (`<SeloSCA>`) — componente-âncora

Reprodução literal da plaqueta da embalagem. É o elemento que costura pacote e site.

```
┌───────────────────────┐
│      SPECIALTY        │  ← Archivo Cond 600 · CAPS · 10px · tracking .18em
│       ESPECIAL        │  ← Archivo Cond 700 · CAPS · 15px
│        SCA 84         │  ← Martian Mono 500 · 13px
└───────────────────────┘
     filete 1px · raio 0
```

Variantes: `claro` (filete Fuligem sobre Cal) · `escuro` (filete Cal sobre Fuligem) · `compacto` (para card de produto).
Aparece em: card de produto, PDP, filtro ativo, página de origem.

> **Corrigido em 22/08/2026, e a correção é de honestidade, não de estilo.** Este
> documento descrevia a plaqueta como texto fixo — "SPECIALTY / ESPECIAL /
> SCA 80+" em toda linha — porque era o que a embalagem da coleção Canastra
> traz. **O Néctar de Minas tem 75 pontos**, abaixo do corte de 80 da própria
> SCA: ele não é café especial, é gourmet, e a embalagem *dele* diz isso.
> Uma plaqueta que afirma "ESPECIAL" numa linha de 75 mente exatamente no selo
> que a marca usa para se provar.
>
> O componente passou a decidir pela nota **da linha** (`sca`, `scaExata`), e
> não por `marca.selo`: escreve `ESPECIAL` a partir de 80 e `GOURMET` abaixo, e
> o `+` só aparece quando o número é piso (`scaExata: false`). O `compacto`
> ganhou uma segunda linha — a classificação junto da nota —, porque com 86 e
> 75 na mesma grade um "SCA 75" solto ao lado de um "SCA 80+" é número sem
> régua. A mesma regra vale para a descrição de produto que o seed grava no
> banco (`backend/db/seed.js`). Ver `frontend/lib/catalogo/rotulos.ts`.

### 5.2 Card de produto (`<CardCafe>`)

```
┌──────────────────────────────┐
│                              │
│     [ foto do sabor          │  ← 4:5 · troca para foto do pacote no hover
│       — rapadura ]           │
│                        ┌────┐│
│                        │SCA ││  ← selo compacto, canto inferior direito
│                        │ 84 ││
│                        └────┘│
├──────────────────────────────┤
│ SÃO ROQUE DE MINAS · 1.180 m │  ← label CAPS + Martian Mono
│ Casca d'Anta                 │  ← Archivo 600 · 20px
│ Rapadura · Castanha · Cacau  │  ← Archivo 400 · 14px · Fuligem-55
│ ▓▓▓▓░ Torra média            │  ← barra Ponto de Torra
│ R$ 42,00        [ Comprar ]  │  ← Martian Mono + botão secundário
└──────────────────────────────┘
```

- Fundo do card: cor da linha do produto a 8% de opacidade sobre Cal.
- **Hover:** crossfade da imagem (sabor → pacote, 320ms), sombra de carimbo 4px, filete passa a Vermelho.
- **`Comprar` rápido** abre um popover com moagem + peso, sem sair da listagem. É o `Quick Add` do Ceremony, adaptado: nosso produto tem duas variantes obrigatórias, então não dá para adicionar em um clique só.

### 5.3 Ponto de Torra (`<PontoTorra>`)

Escala 1–5, equivalente ao "Roast Profile" do Ceremony.

```
Clara                                        Escura
 ▓▓▓▓▓░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░
 1        2        3        4        5
                   ●  Torra média · 3
```

- Trilho: gradiente `--c-juta` → `--c-barro` → `--c-fuligem`. É a rampa da brasa do fogão a lenha, não uma barra genérica.
- Marcador: círculo Vermelho de 12px com filete Cal.
- **Acessibilidade:** o valor textual ("Torra média · 3 de 5") sempre visível — nunca só a barra.

### 5.4 Ficha da Lavoura (`<FichaLavoura>`)

`<details>` recolhido, rotulado **"Ficha da lavoura +"**. Tabela em Martian Mono, duas colunas, filete entre linhas.

```
ALTITUDE      1.180 m
VARIEDADE     Catuaí Amarelo 62
PROCESSO      Natural
SAFRA         2025
PRODUTOR      Sítio Boa Vista
MUNICÍPIO     São Roque de Minas — MG
PONTUAÇÃO     84,25
```

Cada rótulo tem um `?` que abre tooltip com definição em uma frase — o detalhe do Ceremony que atende os dois públicos numa página só. Ex.: *"Natural: o café seca com a casca da fruta, o que costuma dar mais doçura e corpo."*

### 5.5 Seletor de moagem (`<SeletorMoagem>`)

**Duas opções**, lado a lado: `Em grãos` · `Moído`.

Selecionado: fundo Fuligem, texto Cal. Não selecionado: filete Fuligem-20. **Padrão: Grão.**
Combinação que não existe no catálogo aparece **desabilitada**, nunca escondida:
uma linha só em grão precisa mostrar que "Moído" existe na casa e falta nela.

> **Corrigido em 22/08/2026.** Este documento pedia uma grade de 7 opções —
> `Grão`, `Espresso`, `Coado (papel)`, `Coador de pano`, `Prensa francesa`,
> `Italiana / Moka`, `Aeropress` — e o painel as tinha. **Eram sete botões para
> dois produtos:** os seis métodos apontavam todos para o mesmo SKU moído, com
> o mesmo preço e o mesmo estoque. A loja vende dois formatos; os métodos são
> uma escolha de *como moer*, não seis prateleiras.
>
> O que se comprava e o que se prepara viraram dois tipos separados em
> `lib/catalogo/tipos.ts`: `Moagem` (`grao | moido`) e `Metodo` (os seis). Os
> pictogramas e os seis métodos **continuam na página**, na seção "Como
> preparar" da PDP, que é onde eles sempre foram orientação de receita. O
> filtro "Moagem" saiu da PLP pelo mesmo motivo: o filtro "Formato" ao lado já
> cobre o eixo.

### 5.6 Alternador Avulso / Assinatura (`<ModoCompra>`)

Duas abas grandes acima do preço, não um checkbox escondido:

```
┌──────────────────┬──────────────────┐
│  COMPRA ÚNICA    │  ASSINATURA -10% │
│  R$ 42,00        │  R$ 37,80        │
└──────────────────┴──────────────────┘
```

Ao escolher assinatura, expande abaixo: frequência (15 / 30 / 45 dias) + "Cancele quando quiser, sem multa".

### 5.7 Botões

| Variante | Fundo | Texto | Uso |
|---|---|---|---|
| Primário | `--c-vermelho` | Branco | Adicionar à sacola, Assinar |
| Primário (fundo escuro) | `--c-cal` | `--c-fuligem` | CTA sobre Fuligem/Mata |
| Secundário | Transparente + filete 1px | Corrente | Ver detalhes, Filtrar |
| Texto | — | `--c-vermelho`, sublinhado 1px offset 4px | Links inline |

Altura 48px (44px mínimo de toque), padding lateral 24px, Archivo 600 caixa alta 13px tracking 0,08em, raio 2px.
**Foco:** `outline: 2px solid var(--c-vermelho); outline-offset: 3px`. Sobre vermelho, o outline vira Fuligem.

### 5.8 Header

```
┌───────────────────────────────────────────────────────────────────┐
│  Torrado sob demanda · Frete grátis acima de R$ 149               │ ← Fuligem, 36px, Martian Mono 12px
├───────────────────────────────────────────────────────────────────┤
│ ▲CANASTRA   Cafés ▾  Assinatura  A Serra  Aprender      ⌕  ⊙  🛒2 │ ← Cal, 72px, sticky
└───────────────────────────────────────────────────────────────────┘
```

- Logo reduzido à esquerda (≠ Ceremony, por proporção do nosso lockup).
- **Mega menu "Cafés"** em 3 colunas: *Por linha* (Especiais SCA 80+ / Clássicos / Aromatizados) · *Por preparo* (Grão / Moído / Espresso) · *Em destaque* (2 cards com foto).
- Sticky com fundo `--c-cal` a partir de 80px de scroll, filete inferior Fuligem-20. Sem blur/glassmorphism.

> **Atualizado em 22/08/2026 — o site passou a falar três línguas.** A barra
> ganhou um quarto item de navegação (`História`) e o `<SeletorDeIdioma>`, e
> com eles o desenho acima só cabe a partir de **1280px**: em inglês, o cluster
> da direita soma ~970px ao lado de um logo de 150px. Abaixo disso o acordeão
> de tela cheia do §10 **é** a navegação — ele já leva busca, os quatro
> destinos, a conta e o idioma, com linha de 64px e alvo de toque de sobra.
> Isto é coerente com o próprio §10, que fixa desktop em 1200px; o corte
> anterior, em 768px, é que era otimista.
>
> **Em 360px a barra tem logo, sacola e menu, e nada mais.** O atalho da conta
> saiu dela e foi para dentro do acordeão: com ele, o cabeçalho media 401px numa
> tela de 360 e o documento inteiro rolava de lado. A sacola fica de fora porque
> é o atalho que a pessoa mais procura e não pode depender de abrir o menu antes.
>
> O seletor de idioma tem duas variantes pelo mesmo motivo: `painel` (célula de
> 56px, dentro do acordeão) e `barra` (célula de 44×44, só a partir de 1280px).

### 5.9 Gaveta da sacola

Desliza da direita, 420px. Contém: itens com miniatura + moagem + peso, stepper de quantidade, **barra de progresso para frete grátis** (`Faltam R$ 27 para frete grátis` — Martian Mono + trilho Juta preenchendo em Vermelho), subtotal, CTA de checkout, e um upsell discreto: *"Vai bem com"* — 2 produtos.

### 5.10 Rodapé

Fundo Fuligem. Quatro colunas (Cafés / Assinatura / A Canastra / Ajuda) + newsletter. Encerra com o **lockup completo do logo** centralizado, grande (máx. 480px), em Cal, com o "Desde 1985" visível. É o único lugar da navegação onde a marca aparece em tamanho generoso.

---

<a name="6"></a>
## 6. O elemento assinatura: "Escolha pela Serra"

> Se o site for lembrado por uma coisa só, é por esta.

O Ceremony criou o **"Taste by Color"** — um canvas de partículas que ensina a escolher café por cor. Foi isso que os tirou da média. Precisamos do nosso equivalente, e o nosso é melhor por um motivo: **usa um ativo que já é da marca.**

### O mecanismo

O contorno da serra do logo vira um **eixo horizontal de altitude**. Cada café ocupa uma posição real no perfil da montanha, de acordo com a altitude da lavoura.

```
                                    ╱▔▔╲___
                          ___╱▔▔▔▔▔╱        ╲__
              ___╱▔╲____╱                        ╲___
      ___╱▔▔▔╱                                        ╲____
  ___╱                                                      ╲___

      ●              ●          ●         ●            ●
   Porteira      Vargem     Chapadão   S. Roque   Casca d'Anta
    900 m        1.020 m    1.150 m    1.180 m      1.320 m

  ├───────────────────── arraste ao longo da serra ─────────────────┤

  ┌──────────────────────────────────────────────────────────────┐
  │  1.320 m · CASCA D'ANTA                              SCA 84  │
  │  Rapadura · Castanha-do-pará · Cacau                         │
  │  Altitudes mais altas, noites mais frias: o grão amadurece   │
  │  devagar e ganha doçura e acidez cítrica.                    │
  │                                        [ Ver este café → ]   │
  └──────────────────────────────────────────────────────────────┘
```

### Por que isso funciona (e não é enfeite)

1. **A estrutura codifica informação verdadeira.** Altitude realmente muda o perfil da xícara — maturação mais lenta, mais doçura, mais acidez. O eixo *ensina* enquanto navega. Não é um carrossel disfarçado.
2. **É intransferível.** Só faz sentido para uma marca cujo nome, logo e origem são uma serra. Nenhum concorrente pode copiar sem parecer plágio.
3. **Reaproveita o ativo mais forte e mais ocioso da marca.**
4. **Serve os dois públicos:** o iniciante entende "mais alto = mais doce"; o especialista lê a altitude exata.

### Implementação

- **SVG único** com o `path` da serra (extraído do logo, simplificado para ~40 pontos).
- Cafés posicionados por `x` = altitude normalizada no range da coleção; `y` = ponto do path naquela posição (`getPointAtLength`).
- **Interação:** arrastar (pointer events), setas ←/→ no teclado, ou clicar direto num marcador. Snap ao marcador mais próximo.
- **Traço da serra desenha** na entrada em viewport: `stroke-dasharray` + `stroke-dashoffset` animado, 900ms `cubic-bezier(.22,1,.36,1)`. Uma vez só.
- O painel inferior é a região viva (`aria-live="polite"`).

### Fallbacks obrigatórios

| Situação | Comportamento |
|---|---|
| **Mobile (<768px)** | Vira lista vertical ordenada por altitude, com a serra como fundo decorativo estático. Arrastar horizontalmente em tela pequena é hostil. |
| **`prefers-reduced-motion`** | Sem animação de desenho; troca de painel por fade de 120ms. |
| **Leitor de tela** | O SVG é `aria-hidden`. Ao lado, uma `<ol>` visualmente oculta com os mesmos cafés e altitudes, totalmente navegável. |
| **JS desabilitado** | Renderiza a `<ol>` visível. Nenhum produto fica inacessível. |

### ⚠️ Pré-requisito de conteúdo

**Este componente só existe se houver dado real de altitude por lote.** Se os cafés não vierem de altitudes distintas — ou se não vierem da Serra da Canastra — o eixo vira ficção e a marca perde credibilidade justamente onde tenta ganhar.

**Plano B, na mesma lógica:** trocar o eixo de altitude pelo eixo de **Ponto de Torra** (Clara → Escura), com a mesma serra e o mesmo mecanismo, e a curva representando intensidade. Funciona com qualquer catálogo, mantém a assinatura visual, perde um pouco do storytelling de origem.

---

<a name="7"></a>
## 7. Specs de página

### 7.1 Home

```
┌──────────────────────────────────────────────────────────────┐
│ [ HERÓI — full-bleed, 88vh ]                                 │
│   Foto: chapadão ao amanhecer OU terreiro de secagem         │
│   Sobreposição: gradiente Fuligem 0→60% de baixo p/ cima     │
│                                                              │
│   SERRA DA CANASTRA · MINAS GERAIS        ← label CAPS, Cal  │
│   Café que vem                            ← Redaction, 5.5rem│
│   de cima.                                                   │
│   Torrado sob demanda, em lotes pequenos, desde 1985.        │
│   [ Ver os cafés ]  [ Conhecer a serra ]                     │
└──────────────────────────────────────────────────────────────┘
┌──────────────────────────────────────────────────────────────┐
│ [ FAIXA DE PROVA — Fuligem, 4 colunas, Martian Mono ]        │
│  SCA 80+   ·   TORRA SOB DEMANDA   ·   LOTE RASTREADO        │
│  ·   DESDE 1985                                              │
└──────────────────────────────────────────────────────────────┘
┌──────────────────────────────────────────────────────────────┐
│ ★ [ ESCOLHA PELA SERRA ] — §6                                │
│   Superfície Cal. A seção com mais respiro da página.        │
└──────────────────────────────────────────────────────────────┘
┌──────────────────────────────────────────────────────────────┐
│ [ TORRA DA SEMANA ]                                          │
│   Grid 4 col desk / 2 col mob · 8 produtos · <CardCafe>      │
│   [ Ver todos os cafés → ]                                   │
└──────────────────────────────────────────────────────────────┘
┌──────────────────────────────────────────────────────────────┐
│ [ DO PÉ À XÍCARA ] — superfície kraft                        │
│   01 Colheita · 02 Terreiro · 03 Beneficiamento              │
│   04 Torra · 05 Sua casa                                     │
│   ↑ numeração justificada: é uma sequência real e            │
│     irreversível. Não é enfeite.                             │
└──────────────────────────────────────────────────────────────┘
┌──────────────────────────────────────────────────────────────┐
│ [ CLUBE DA CANASTRA ] — superfície Mata (verde)              │
│   Assinatura. CTA em Cal (vermelho não passa contraste aqui).│
└──────────────────────────────────────────────────────────────┘
┌──────────────────────────────────────────────────────────────┐
│ [ IMPRENSA ] — citações editoriais grandes, sem card         │
├──────────────────────────────────────────────────────────────┤
│ [ APRENDER ] — 3 artigos                                     │
├──────────────────────────────────────────────────────────────┤
│ [ INSTAGRAM ] — 6 imagens                                    │
├──────────────────────────────────────────────────────────────┤
│ [ NEWSLETTER + RODAPÉ ]                                      │
└──────────────────────────────────────────────────────────────┘
```

**Regras:** um único bloco em Redaction acima de 4rem por dobra. Alternância obrigatória de superfície (Cal → Fuligem → Cal → kraft → Mata → Cal) para dar ritmo. Nunca duas seções escuras seguidas.

### 7.2 Listagem (PLP)

```
┌──────────────────────────────────────────────────────────────┐
│  Cafés                                            32 lotes   │
│  ────────────────────────────────────────────────────────    │
│  [ Torra ▾ ] [ Notas ▾ ] [ Altitude ▾ ] [ Moagem ▾ ]         │
│  [ Formato ▾ ]                        Ordenar: Relevância ▾  │
│  Ativos:  ( Torra média ×)  ( SCA 84+ ×)      Limpar tudo    │
├──────────────────────────────────────────────────────────────┤
│  [card]   [card]   [card]   [card]                           │
│  [card]   [card]   [card]   [card]                           │
└──────────────────────────────────────────────────────────────┘
```

- Filtros: barra horizontal com popovers no desktop; **bottom sheet** no mobile com CTA fixo "Ver 18 cafés".
- Filtro de **Notas** usa as próprias fotos de sabor em miniatura (rapadura, castanha, frutas) — não texto puro. É o filtro mais usado por iniciante.
- Filtro de **Altitude**: slider de faixa desenhado sobre a silhueta da serra — continuidade com §6.
- Estado vazio: *"Nenhum café com esses filtros. Tente afrouxar a torra ou a altitude."* + botão limpar. Nunca só "0 resultados".
- URL reflete filtros (`?torra=media&sca=84`) para permitir compartilhar e voltar.

### 7.3 Produto (PDP) — a página mais importante

```
┌───────────────────────────────┬──────────────────────────────┐
│                               │ SÃO ROQUE DE MINAS · 1.180 m │
│    [ GALERIA — 4:5 ]          │                              │
│                               │ Casca d'Anta                 │
│    1. Foto do SABOR           │ Sítio Boa Vista · Safra 2025 │
│       (rapadura na tábua)     │                              │
│    2. Pacote                  │ ┌─────────────┐              │
│    3. Terreiro / produtor     │ │  SPECIALTY  │              │
│    4. Grão moído              │ │  ESPECIAL   │              │
│                               │ │   SCA 84    │              │
│    ● ○ ○ ○                    │ └─────────────┘              │
│                               │                              │
│                               │ Rapadura · Castanha · Cacau  │
│                               │ ▓▓▓░░ Torra média · 3 de 5   │
│                               │                              │
│                               │ ┌────────────┬─────────────┐ │
│                               │ │COMPRA ÚNICA│ASSINAR -10% │ │
│                               │ │  R$ 42,00  │  R$ 37,80   │ │
│                               │ └────────────┴─────────────┘ │
│                               │                              │
│                               │ MOAGEM                       │
│                               │ [Grão][Espresso][Coado]…     │
│                               │ PESO                         │
│                               │ [250g][500g][1kg]            │
│                               │                              │
│                               │ [ − 1 + ]  [ ADICIONAR ]     │
│                               │                              │
│                               │ ▸ Ficha da lavoura           │
│                               │ ⟳ Torramos na terça,         │
│                               │   enviamos na quarta.        │
└───────────────────────────────┴──────────────────────────────┘
┌──────────────────────────────────────────────────────────────┐
│ [ A HISTÓRIA DESTE LOTE ] — superfície Fuligem, 2 colunas    │
│   Foto do produtor + texto editorial (máx. 62ch)             │
├──────────────────────────────────────────────────────────────┤
│ [ COMO PREPARAR ] — abas por método                          │
│   ┌─────────┬─────────┬──────────┬──────────┐                │
│   │ Coado   │ Prensa  │ Espresso │  Pano    │                │
│   └─────────┴─────────┴──────────┴──────────┘                │
│   PROPORÇÃO   1:15  ·  30 g para 450 ml                      │
│   TEMPERATURA 94 °C                                          │
│   TEMPO       3 min                                          │
│   MOAGEM      Média                                          │
│   ↑ tudo em Martian Mono. É a "etiqueta" em estado puro.     │
├──────────────────────────────────────────────────────────────┤
│ [ DA MESMA SERRA ] — 4 cafés relacionados                    │
├──────────────────────────────────────────────────────────────┤
│ [ AVALIAÇÕES ]                                               │
└──────────────────────────────────────────────────────────────┘
```

**Mobile:** galeria full-bleed no topo com paginação por swipe; barra de compra **fixa no rodapé** (preço + "Adicionar") que aparece após o usuário passar do botão original. Mais de 70% do tráfego do Ceremony é mobile — assumir que aqui será igual ou mais.

**Ordem inegociável:** nota de sabor **acima** de qualquer dado técnico. Ficha da lavoura **sempre recolhida** por padrão.

### 7.4 Assinatura — "Clube da Canastra"

Página em superfície Mata. Fluxo de 3 passos, com barra de progresso em Martian Mono (`PASSO 1 DE 3`):

1. **Quanto você bebe?** — 1 / 2 / 4 xícaras por dia → sugere peso e frequência automaticamente.
2. **Como você prepara?** — reaproveita `<SeletorMoagem>`.
3. **Quem escolhe?** — *Escolha do mestre de torra* (surpresa mensal) ou *Eu escolho* (fixa um café).

Fecha com um resumo tipo etiqueta de despacho:

```
┌────────────────────────────────────┐
│  CLUBE DA CANASTRA                 │
│  ────────────────────────────────  │
│  500 g · moído para coado          │
│  a cada 30 dias                    │
│  R$ 75,60 /mês  (economia R$ 8,40) │
│  Cancele quando quiser.            │
│           [ Começar assinatura ]   │
└────────────────────────────────────┘
```

### 7.5 A Serra (institucional)

Página editorial longa, o oposto de uma "About" corporativa. Estrutura:

1. Herói full-bleed do chapadão + Redaction grande.
2. **1985** — a origem, em texto e foto de arquivo (mesmo que escaneada e imperfeita — melhor assim).
3. **O território** — mapa desenhado no traço da serra: nascente do São Francisco, Casca d'Anta, os municípios produtores. Interativo leve: hover revela o nome.
4. **Os produtores** — grade de retratos com nome, sítio e altitude.
5. **A torra** — o processo, com foto do torrador.
6. CTA para os cafés.

**Não usar:** timeline com bolinhas, contadores animados de "anos de história", ícones de folha/xícara/coração. Nada disso é da Canastra.

---

<a name="8"></a>
## 8. Direção de arte fotográfica

A fotografia responde por ~60% da percepção de qualidade do site. Sem essa produção, nenhum dos itens acima funciona.

### Três famílias, três funções

| Família | Função | Direção |
|---|---|---|
| **Sabor** | Herói de PDP e card. *A adaptação direta da tese do Ceremony.* | Ingrediente literal da nota de degustação, **da despensa mineira**: rapadura quebrada, doce de leite em tacho, castanha-do-pará, jabuticaba, goiabada cascão, milho torrado, cacau em nibs, mel, açúcar mascavo, cana. Fundo: tábua de madeira escura, pano de algodão cru, juta, ou cal branca. **Luz lateral dura**, sombra definida, como sol de janela de cozinha. **Não** usar fundo infinito de estúdio, gradiente pastel ou props de mármore. |
| **Território** | Heróis de home e institucional | Chapadão, escarpa, terreiro de secagem, estrada de terra vermelha, porteira, cerca, neblina de manhã. Amanhecer e fim de tarde. Fotografia documental, grão visível, sem HDR. |
| **Produto** | Segunda imagem da galeria, PLP | Pacote em contexto real (bancada, tábua, saco de juta) — não recorte em branco. Uma foto de pacote por linha, sempre com a mesma luz e o mesmo ângulo, para o grid ficar disciplinado. |

### Especificações técnicas

- **Proporção:** 4:5 (produto e sabor) · 16:9 (heróis) · 1:1 (Instagram).
- **Formato:** AVIF com fallback WebP; `srcset` em 400/800/1200/1600px.
- **Tratamento:** um único LUT para todo o acervo — leve dessaturação nos verdes, sombras quentes, alta luz preservada. Consistência importa mais que perfeição individual.
- **Alt text:** descreve a foto, não o SEO. `alt="Rapadura quebrada sobre tábua de madeira escura"`.

### O que evita o clichê

Não fotografar: latte art, xícara branca em fundo branco, grão espalhado em espiral, mão segurando caneca com suéter, "flat lay" com plantinha. Isso é o banco de imagens do café, não a Canastra.

---

<a name="9"></a>
## 9. Motion e microinterações

Discrição. Um momento orquestrado vale mais que dez efeitos espalhados — e excesso de animação é o que faz um site parecer template.

### Sistema

```css
:root {
  --mv-rapido: 160ms;
  --mv-padrao: 320ms;
  --mv-lento:  640ms;
  --mv-serra:  900ms;
  --ease:      cubic-bezier(.22, 1, .36, 1);   /* saída suave, entrada firme */
}
```

### Inventário completo (só isto)

| Momento | Comportamento | Duração |
|---|---|---|
| **Desenho da serra** | `stroke-dashoffset` de 100%→0 ao entrar no viewport. **Uma vez por sessão.** | 900ms |
| **Revelação de seção** | `translateY(16px)` + `opacity 0→1`, escalonado 60ms entre irmãos | 400ms |
| **Hover no card** | Crossfade sabor→pacote + sombra de carimbo 4px + filete vira vermelho | 320ms |
| **Abertura da sacola** | Slide da direita + escurecimento do fundo | 320ms |
| **Item adicionado** | Contador da sacola pulsa 1×; miniatura "voa" do produto ao ícone | 480ms |
| **Ficha da lavoura** | `<details>` com transição de altura | 240ms |
| **Troca de moagem/peso** | Preenchimento do botão a partir da esquerda | 160ms |
| **Barra de frete grátis** | Trilho preenche em Vermelho ao mudar o subtotal | 640ms |

### Proibido

Parallax de fundo · scroll sequestrado (smooth scroll customizado) · contadores animados · carrossel automático · texto que entra letra por letra · cursor customizado · loader de página completo (usar skeleton).

### Movimento reduzido — obrigatório

```css
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: .01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: .01ms !important;
    scroll-behavior: auto !important;
  }
}
```

Toda revelação por scroll deve iniciar com `opacity: 1` no CSS e ser *escondida por JS* — assim, sem JS ou com movimento reduzido, o conteúdo simplesmente aparece. Nunca o contrário.

---

<a name="10"></a>
## 10. Responsivo, acessibilidade e performance

### Breakpoints

```css
/* mobile-first */
@media (min-width: 600px)  { /* tablet retrato  */ }
@media (min-width: 900px)  { /* tablet paisagem */ }
@media (min-width: 1200px) { /* desktop         */ }
@media (min-width: 1600px) { /* desktop largo   */ }
```

### Adaptações críticas em mobile

| Componente | Mobile |
|---|---|
| Escolha pela Serra | Lista vertical por altitude; serra vira fundo estático |
| Filtros da PLP | Bottom sheet com CTA fixo "Ver 18 cafés" |
| PDP | Galeria full-bleed + **barra de compra fixa no rodapé** |
| Mega menu | Acordeão em tela cheia |
| Ficha da lavoura | Uma coluna, rótulo acima do valor |
| Redaction | Só no H1 do herói (≥40px). H2 mobile passa a Archivo 700. |

### Checklist de acessibilidade

- [ ] Contrastes conforme §4.1 — **as duas proibições codificadas** (branco/juta, vermelho/mata)
- [ ] Foco visível em 100% dos interativos: `outline: 2px solid var(--c-vermelho); outline-offset: 3px`
- [ ] Alvos de toque ≥44×44px
- [ ] Todo o fluxo de compra operável só pelo teclado, incluindo a gaveta da sacola (foco preso dentro, `Esc` fecha, foco volta ao gatilho)
- [ ] "Escolha pela Serra" com `<ol>` alternativa navegável (§6)
- [ ] Alt text descritivo em toda foto de produto e sabor
- [ ] `<html lang="pt-BR">`
- [ ] Preço em `<span>` com `aria-label="42 reais"` (o leitor de tela lê "R$ 42,00" mal)
- [ ] Mudanças de filtro e adição à sacola anunciadas em `aria-live="polite"`
- [ ] Zoom 200% sem quebra de layout ou perda de conteúdo

### Metas de performance

| Métrica | Meta |
|---|---|
| LCP | < 2,0 s em 4G |
| INP | < 200 ms |
| CLS | < 0,05 |
| JS na rota crítica | < 120 KB gzip |
| Peso da home | < 900 KB |

**Como chegar lá:**
- Fontes em `.woff2` variável, `font-display: swap`, `<link rel="preload">` só na Archivo (a Redaction pode chegar depois — só afeta títulos).
- `loading="lazy"` em tudo abaixo da dobra; **`fetchpriority="high"` na imagem do herói**.
- `width`/`height` explícitos em toda imagem (mata o CLS).
- O SVG da serra é inline no HTML, não `<img>` (precisa ser animável e herdar `currentColor`).
- Textura de grão via SVG data-URI em CSS, não PNG.
- Componentes pesados (Escolha pela Serra, avaliações) com hidratação preguiçosa.

---

<a name="11"></a>
## 11. Tom de voz e microcopy

**Como a Canastra fala:** direta, concreta, sem cerimônia — mas sem caricatura de "causo mineiro". Não escrever "uai", "trem bão", "sô". A mineiridade está no que se diz, não no sotaque forçado.

| Faça | Não faça |
|---|---|
| "Torramos na terça, enviamos na quarta." | "Nosso café é torrado com muito carinho e dedicação." |
| "1.180 metros. Noite fria, grão doce." | "Um café único e inesquecível para os amantes de café." |
| "Cancele quando quiser, sem multa." | "Flexibilidade total no seu plano premium!" |
| "Adicionar à sacola" | "Comprar agora!!!" |
| "Nenhum café com esses filtros. Tente afrouxar a torra." | "Ops! Nada encontrado 😢" |

### Regras

- **Verbo ativo e mesmo nome do começo ao fim.** O botão diz "Adicionar à sacola" → a confirmação diz "Adicionado à sacola". Nunca "Enviar" ou "Confirmar" genéricos.
- **Erro explica e resolve.** "O CEP precisa ter 8 números." Não: "Erro de validação." Nunca pedir desculpa.
- **Tela vazia é convite.** Sacola vazia: *"Sua sacola está vazia. Comece pelos cafés da semana."* + botão.
- **Números em Martian Mono, sempre.** Preço, peso, altitude, SCA, proporção, temperatura. É o que faz a "etiqueta" existir visualmente.
- **Frase curta.** Se passar de 20 palavras, quebrar.

---

<a name="12"></a>
## 12. Roadmap de implementação

### Fase 0 — Fundação (antes de qualquer tela)

- [ ] Redesenhar os 3 SVGs do logo (completo / reduzido / ícone), otimizados e com `currentColor`
- [ ] Extrair e simplificar o `path` da serra (~40 pontos) para uso como componente
- [ ] Licenciar/instalar Redaction, Archivo e Martian Mono; subsetar para latim estendido
- [ ] Publicar os tokens de §4 como CSS custom properties + arquivo de tema
- [ ] **Produzir a fotografia** (§8) — este é o caminho crítico do projeto, não o código
- [ ] Levantar o dado real de altitude/produtor por lote — define se §6 vai ao ar como planejado ou no plano B

### Fase 1 — Núcleo de conversão

Header · Rodapé · `<CardCafe>` · PLP com filtros · **PDP completa** · Gaveta da sacola
→ *Se só houver verba para uma fase, é esta. A PDP é onde o dinheiro acontece.*

### Fase 2 — Marca

Home completa · "Escolha pela Serra" · Página A Serra · Clube da Canastra

### Fase 3 — Retenção e conteúdo

Aprender (blog + guias de preparo) · Avaliações · Área da conta · Onde comprar / Atacado

### Critérios de aceite antes do go-live

> As Fases 2 e 3 saíram parcialmente do papel: **Clube da Canastra**, **Avaliações**
> e **Área da conta** existem e vendem. Continuam por fazer "Aprender"
> (blog + guias) e "Onde comprar / Atacado".
>
> Nenhum item abaixo é pendência de código de outra área — são checagens de
> frontend. O que já virou ação humana no resto do projeto (credenciais, VPS,
> catálogo, backup) está em **`docs/go-live.md`**; esta lista é a metade de
> design da mesma pergunta, e as duas precisam fechar antes de abrir a loja.

- [x] Nenhuma combinação de cor proibida (teste automatizado) — `frontend/lib/cor.test.ts`
      codifica as duas proibições de §4.1 e está amarrado ao `@theme` de
      `globals.css` por `lib/tokens.test.ts`, então mudar o token quebra o teste.
      **Ressalva honesta:** ele prova os *tokens*, não varre as telas — uma
      combinação errada escrita à mão numa página passaria.
- [ ] Lighthouse ≥ 90 em Performance e ≥ 95 em Acessibilidade, **em mobile**
- [ ] Fluxo completo de compra operável só pelo teclado
- [ ] `prefers-reduced-motion` respeitado em todas as animações listadas em §9 —
      **nada no código consulta essa media query hoje**
- [ ] Site funcional com JS desabilitado até a etapa de checkout
- [ ] Zoom 200% sem quebra
- [ ] Revisão de copy contra §11 em 100% das telas — incluindo erros e estados vazios

---

## Resumo em cinco frases

1. **Estrutura e UX vêm do Ceremony** — foto do sabor no lugar do grão, ficha técnica recolhida, escala de torra, receita na PDP, herói empilhado.
2. **A estética vem da embalagem que já existe** — preto, kraft e vermelho não são paleta nova, são o sistema de produto.
3. **O conceito é a tensão entre a mão e a etiqueta** — gesto rústico como exceção (20%), rigor técnico como norma (80%).
4. **A assinatura é "Escolha pela Serra"** — o contorno do logo vira eixo de altitude navegável, codificando informação verdadeira sobre a xícara.
5. **A fotografia é o caminho crítico** — sem a produção de §8, o resto é esqueleto bonito.

---

*Documento de frontend · Café Canastra · v1.0*