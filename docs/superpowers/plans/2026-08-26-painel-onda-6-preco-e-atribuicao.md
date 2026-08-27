# Painel de gestão — Onda 6: o preço que aparece e a venda que se sabe de onde veio

> **Para quem executa:** SUB-SKILL OBRIGATÓRIA — `superpowers:subagent-driven-development`.
> Esta onda é a **vitrine**, não o painel. É a única em que o trabalho todo é do lado do cliente.

**Goal:** a promoção que a loja já aplica passa a ser **vista** antes de ser cobrada, e todo pedido
novo passa a saber de onde veio.

**Leitura obrigatória:** a **§5.1 e §5.3 da spec**, antes de escrever uma linha. Elas contêm a
análise que evita o desastre.

---

## Parte 1 — o preço promocional finalmente aparece

Hoje a promoção **desconta e o cliente não vê**. `precoComPromocao` abate o valor na cobrança, e a
vitrine renderiza só o preço de catálogo: o cliente vê R$ 60, paga R$ 54 e descobre no fim. Uma
promoção invisível não vende — é, em uma frase, o motivo de a área de descontos ter sido pedida.

### A mina, e por que ela é menor do que parecia

`conferirSubtotal` (`PaymentController.js:203-213`) compara com **tolerância zero** o subtotal
declarado pelo navegador contra o subtotal de **catálogo**, sem promoção. O comentário de `:184-195`
diz que isso só funciona porque a vitrine não renderiza preço promocional.

A releitura mostrou o que o campo realmente significa: **`subtotalCentavos` não é "o que o cliente
vai pagar"** — é *"o que a tela do cliente somou a partir do catálogo"*, e existe só para o servidor
perceber que a tela está velha. O valor cobrado nunca sai dele.

Portanto o conserto **não é mexer na conferência**:

1. **A sacola continua guardando o preço de CATÁLOGO.** Exibir o promocional é decisão de
   *renderização*, não de armazenamento. Feito assim, a conferência atual continua correta e a mina
   não é pisada.
2. **Um campo novo e opcional**, `subtotalPromocionalCentavos`, carrega o que a tela exibiu, e é
   conferido com a mesma tolerância zero contra a soma de `precoComPromocao` no servidor. Isso pega
   a classe de erro que a exibição introduz: a tela mostrando promoção que já expirou.

> **O caminho ingênuo é fatal e precisa estar escrito:** passar a guardar o preço promocional na
> sacola faz `subtotalCentavos` mudar de significado **em silêncio**, os dois lados passam a calcular
> sobre bases diferentes, e **toda venda com promoção morre em 409 `PRECO_MUDOU`**. Quem se pegar
> mexendo no significado do campo deve parar e reler a §5.1.

### Onde exibir

Todo preço de tela passa por `formatarPreco()` (`lib/catalogo/repositorio.ts:308`). Existem **dois
vocabulários de card vivos**: `<CardProduto>` na home e `<CardCafe>` na PLP, na PDP e no 404 de
catálogo — um mostra "a partir de" por linha, o outro preço exato por SKU. **Os dois precisam do
tratamento de/por, e nenhum pode ser aposentado nesta onda.** Mais a PDP e a sacola.

> `formatarPreco` é pt-BR/BRL fixo **de propósito** nos três idiomas. Trocar por
> `Intl.NumberFormat(locale)` faria `/en` exibir outra moeda sem mudar o que o Mercado Pago cobra em
> reais — a mesma decisão está escrita em `components/layout/AvisoFreteGratis.tsx:24-28`.

---

## Parte 2 — a origem da venda

As dez colunas existem em `pedidos` desde a `0033` (`utm_source`, `utm_medium`, `utm_campaign`,
`utm_content`, `utm_term`, `canal`, `referrer`, `landing_page`, `gclid`, `fbclid`). **A captura não
existe.**

E o dado é **perecível**: não há como reconstruir depois de onde veio uma venda — nem pelo Mercado
Pago, nem pelo Bling. Cada dia sem captura é um dia de vendas cuja origem se perde para sempre.

Capturar no primeiro contato, guardar junto do carrinho, enviar **no corpo** do checkout.

> **Regra dura, e ela vale dinheiro:** os campos novos entram no **corpo** e **nunca** na assinatura
> de `chaveDestePedido()` (`lib/sacola/checkout.ts:243-259`). Chave de idempotência diferente numa
> retentativa é **exatamente o que cobra duas vezes** quando a primeira resposta se perde na rede —
> está escrito no comentário de `:235-242`.

> **A home é SSG e precisa continuar sendo.** `generateStaticParams()` + `revalidate = 3600` fazem
> as três homes saírem do build; qualquer `cookies()`, `headers()` ou `searchParams` introduzido nela
> a derruba para render sob demanda, com uma ida ao servidor por visita. A captura **tem de ser do
> lado do cliente** — a URL já está no navegador — guardada junto da sacola. Se `/[locale]` sair do
> build como `ƒ` em vez de `●`, a regra foi quebrada.

> **LGPD:** `gclid` e `fbclid` são identificadores de clique e já entram na redação (`0033`). Não os
> exponha em log nem em query string de navegação.

---

## Como se sabe que a Onda 6 acabou

1. Um produto com promoção ativa mostra "de R$ 60 / por R$ 54" nos **dois** vocabulários de card, na
   PDP e na sacola.
2. Um pedido desse produto é criado **sem 409** — é o teste que prova que a §5.1 foi respeitada.
3. Um pedido feito a partir de `?utm_source=instagram&utm_campaign=black` chega ao banco com as
   colunas preenchidas.
4. Duas tentativas do mesmo checkout usam a **mesma** chave de idempotência, com ou sem UTM.
5. `npm --prefix frontend run build` mostra `/[locale]` como **`●` (SSG)**.
