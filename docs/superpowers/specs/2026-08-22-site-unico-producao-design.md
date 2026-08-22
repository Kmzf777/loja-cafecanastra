# Site único: a loja vira também o site oficial

**Data:** 22 de agosto de 2026
**Branch:** `producao-site-unico`
**Estado:** aprovado pelo cliente

---

## O problema

O Café Canastra tem dois sites. `loja.cafecanastra.com` é esta aplicação — vende,
mas não conta a história da marca. `cafecanastra.com` é um Next separado
(`github.com/Kmzf777/cafecanastrablog`) que conta a história, tem blog, tem
versões em inglês e espanhol — e não vende.

Um visitante que chega pela marca não encontra a loja. Um que chega pela loja não
encontra a marca. E quem chega de fora do Brasil — que é para onde a família
exporta desde 1996 — não lê nem uma coisa nem outra.

Este documento descreve a fusão: **esta aplicação passa a ser o site oficial e a
loja ao mesmo tempo, em português, inglês e espanhol.**

---

## O que entra, e por decisão de quem

Tudo abaixo foi decidido pelo cliente em 22/08/2026. Onde há alternativa
rejeitada, ela está registrada — porque a razão da escolha some antes do código.

| Decisão | Escolhido | Rejeitado |
|---|---|---|
| Profundidade do i18n | Marca + navegação + catálogo | Checkout/conta/e-mails; tradutor automático |
| Termos e privacidade | Texto do institucional, visual da loja | Manter os placeholders da loja; copiar o visual do institucional |
| Blog | Só a casca, marcada "Em breve" | Integração com a API; migrar o blog inteiro |
| Produtos do `tabela.cafecanastra.com` | Só melhorar descrição dos 5 que já existem | Adicionar Blend Espresso, moedor, granel 2 kg |
| Domínio | Decisão adiada; código agnóstico | Assumir raiz ou subdomínio agora |
| Go-live | Só código, pronto e verificado | Executar deploy na VPS |
| Moagem na PDP | Grão e moído, só | Manter os 7 métodos |

---

## 1. Arquitetura de i18n

### A escolha

**Dicionário tipado próprio, sem dependência nova, com segmento `[locale]`.**

`next-intl` foi considerada e rejeitada por um motivo concreto: ela quer o próprio
middleware, e `frontend/middleware.ts` já são 8 KB que renovam a sessão do GoTrue.
Encadear os dois mexe no caminho de autenticação — a superfície mais crítica do
repositório — para ganhar ICU e negociação de idioma que uma loja com checkout em
português não usa.

Duplicar pastas, como o institucional faz hoje (`app/en/historia/page.tsx` escrito
à mão), foi rejeitado porque não escala: o catálogo em três línguas viraria três
cópias do repositório de catálogo.

Se o rewrite se mostrar frágil durante a execução, `next-intl` é o plano de fuga e
o custo da troca é o middleware, não as páginas.

### A forma

```
frontend/app/[locale]/(vitrine)/…    superfície traduzida
frontend/app/(transacional)/…        sacola, checkout, conta, pedido — só pt-BR
frontend/app/dashboard/…             painel — intocado
```

**As URLs em português não mudam.** `pt` é o locale padrão e não aparece na URL:
o middleware faz um *rewrite* interno de `/cafes` para `/pt/cafes`. Rewrite, não
redirect — a barra de endereços continua mostrando `/cafes`, e nenhum link
existente, nenhum backlink e nenhuma entrada de sitemap quebra.

`/en/cafes` e `/es/cafes` são explícitos e reais.

### A fronteira, dita na cara

Traduzido: home, PLP, PDP, `/a-serra`, `/historia`, `/bio`, `/clube` (a página de
venda), termos, privacidade, cabeçalho, rodapé, e o editorial dos cinco cafés.

**Não traduzido, e isto é decisão:** sacola, checkout, conta, `/pedido/[id]`,
e-mails, painel. Em `en` e `es`, o caminho de compra sai do prefixo de idioma e
uma nota curta avisa que a compra segue em português.

A razão é honestidade operacional: o frete é Melhor Envio (só Brasil) e o
pagamento é Mercado Pago BR. Traduzir o checkout sem resolver esses dois seria
prometer uma compra que a loja não consegue entregar. Virar loja internacional de
verdade é outro projeto, e está registrado como tal em `docs/go-live.md`.

### O contrato do dicionário

```ts
// frontend/lib/i18n/tipos.ts
export const LOCALES = ["pt", "en", "es"] as const;
export type Locale = (typeof LOCALES)[number];
export const LOCALE_PADRAO: Locale = "pt";
```

O dicionário é um objeto tipado por locale. O tipo do `pt` é a fonte da verdade:
`en` e `es` são declarados como `Dicionario` e o TypeScript **quebra o build** se
faltar uma chave. É o mecanismo que impede tradução esquecida de virar `undefined`
na tela — o mesmo espírito das travas que já existem no repositório.

Nada de `t("chave.com.ponto")` por string: o acesso é por propriedade, para o
compilador poder verificar.

### O editorial do catálogo

`data/catalogo-canastra.json` **não muda de forma** — ele é lido também por
`backend/db/seed.js`, e mexer no contrato dele arrisca o caminho de venda para
ganhar tradução.

A tradução vive em `data/catalogo-canastra.i18n.json`, indexada por slug:

```json
{
  "classico": {
    "en": { "nome": "…", "descricao": "…", "torra": "…", "corpo": "…",
            "preparoSugerido": "…", "notas": ["…"] },
    "es": { … }
  }
}
```

`lib/catalogo/produtos.ts` funde o editorial traduzido sobre o `pt` na leitura,
pelo mesmo padrão de `aplicarDadosAoVivo` que já funde o comercial sobre o
editorial. Locale sem tradução cai para `pt` — nunca para vazio.

Preço, estoque e SKU **não** são traduzíveis e não entram no arquivo.

---

## 2. Catálogo: a moagem vira grão e moído

### O que está errado hoje

`lib/catalogo/tipos.ts` tem um tipo `Moagem` com sete valores — `grao`,
`espresso`, `coado-papel`, `coador-pano`, `prensa-francesa`, `italiana-moka`,
`aeropress` — e `produtos.ts:78` expande "moído" em **seis variantes**, todas
apontando para o mesmo `skuLoja`, o mesmo preço e o mesmo estoque.

A loja real vende dois formatos: **em grãos** e **moído**. Os seis métodos são
uma escolha de como moer, não seis produtos. O seletor da PDP mostra sete botões
para um catálogo de dois itens.

### A correção estrutural

Dois conceitos hoje colapsados num tipo só passam a ser dois tipos:

```ts
/** O que se COMPRA. Dois valores, porque a loja vende dois. */
export type Moagem = "grao" | "moido";

/** Como se PREPARA. Não é opção de compra — é a seção "Como preparar". */
export type Metodo =
  | "espresso" | "coado-papel" | "coador-pano"
  | "prensa-francesa" | "italiana-moka" | "aeropress";
```

`Preparo.metodo` passa a ser `Metodo`, que é o que ele sempre foi de verdade. A
seção "Como preparar" da PDP **fica** — ela é orientação de preparo, não opção de
compra, e é conteúdo bom.

### O alcance

21 arquivos citam `moagem`. Os que mudam de comportamento:

- `lib/catalogo/tipos.ts` — os dois tipos, `MOAGENS` com dois itens, `METODOS` novo
- `lib/catalogo/produtos.ts` — `variantesDa()` deixa de multiplicar por seis
- `components/catalogo/PainelCompra.tsx` — dois botões
- `app/[locale]/(vitrine)/cafes/page.tsx` — **o filtro "Moagem" sai da PLP**: o
  filtro "Formato" ao lado já oferece grãos, moído, drip e cápsula. Dois filtros
  para o mesmo eixo é ruído
- `lib/clube.ts` e `AssinaturaWizard.tsx` — o Clube passa a oferecer dois
- `lib/sacola/fusao.ts` e `sacola.tsx` — o rótulo guardado no item

**Compatibilidade:** uma sacola gravada antes desta mudança pode ter
`moagem: "aeropress"`. A fusão precisa tratar valor desconhecido como `moido`, e
isso precisa de teste. Sacola que some no login é o pior bug possível aqui.

### As descrições

Os textos vêm de `tabela.cafecanastra.com`. **O site não é referenciado em lugar
nenhum, e preço de atacado não entra.** O que se aproveita é a descrição de
produto, que é a que a marca de fato usa:

| Linha | Descrição de origem |
|---|---|
| Clássico | 100% Arábica, tipo especial acima de 80 pontos SCA. Torra escura, intensidade 8. Notas caramelizadas e achocolatadas |
| Suave | 100% Arábica, tipo especial acima de 80 pontos SCA. Torra média, intensidade 7. Notas achocolatadas e finalização cítrica |
| Canela | 100% Arábica, tipo especial acima de 80 pontos SCA. Torra escura, intensidade 7. Notas caramelizadas, com canela natural |
| Microlote | 100% Arábica especial, **86 pontos SCA**. Médio corpo, notas de cacau, melaço e finalização suavemente cítrica |
| Néctar de Minas | 100% Arábica gourmet, **75 pontos SCA**. Torra escura, intensidade 8. Notas caramelizadas e achocolatadas |

Dois números aqui **contradizem** o catálogo atual, e o dado da marca vence:

- **Microlote é 86 SCA**, não "80+".
- **Néctar de Minas é 75 SCA** — abaixo de 80, ou seja, **não é café especial**. É
  gourmet, e a embalagem diz isso. O `SeloSCA` não pode anunciar "SCA 80+" nessa
  linha. Ou o selo respeita o valor real, ou não aparece nela.

A intensidade de torra declarada (7, 8) é dado real e deve alimentar o
`pontoTorra`, hoje arbitrado.

---

## 3. As páginas institucionais

### `/historia` — nova, e corrige um erro factual

O conteúdo vem de `cafecanastra.com/historia`: 1985 (Patrocínio), 1996
(excelência), 2008 (a Canastra), 2016 (Café Canastra nasce), hoje (exportação e
private label). Já existe traduzido em `en` e `es` no repositório institucional —
as três versões são aproveitadas, não reescritas.

**O erro que isso revela:** a home da loja diz *"Quarenta anos na mesma serra"* e
`/a-serra` sustenta a mesma coisa. A história da própria marca diz outra: a
família plantou em **1985 em Patrocínio, no Cerrado Mineiro**, e só chegou à
**Serra da Canastra em 2008**. São quarenta anos de café e dezoito de Canastra.

Num repositório cujos comentários caçam dado inventado linha a linha — altitude
por lote, produtor, safra, SCA 84,25 — isto não pode ficar. A home e `/a-serra`
passam a dizer o que é verdade.

Dados reais que entram junto: as variedades são **Araras, Caturra 2SL e Paraíso**;
o café é exportado para Chile, Argentina, Estados Unidos, Irlanda, Holanda e
Emirados Árabes.

### `/rastreabilidade` — um link, não uma página

A rota do institucional é um `redirect()` para
`intranet.cerradomineiro.org/…/produtor/653/501`. Não há conteúdo a trazer.

Vira um link honesto, rotulado como o que é: verificação de origem numa base
externa, do Cerrado Mineiro. Link externo com `rel="noopener"` e aviso de que sai
do site. Inventar uma página de rastreabilidade que só redireciona seria pior.

### `/a-serra` — enriquecida, não substituída

Não há página de origem a importar: `/sobre/origem` do institucional é um stub com
`{/* Conteúdo completo a ser implementado */}`. A página que existe é a da loja, e
ela ganha os dados reais acima.

### Termos e privacidade — texto de lá, visual daqui

Os textos do institucional (`app/termos-uso`, `app/politica-privacidade`, e
`politica.md`, 29 KB) substituem os placeholders da loja, que hoje carregam um
`<AvisoJuridico>` dizendo que não passaram por revisão jurídica.

Entram no `<PaginaTexto>` da loja. Uma identidade visual só no site inteiro.

**O aviso jurídico só sai se o texto importado for de fato definitivo.** Se houver
qualquer dúvida, ele fica — remover um aviso de "sem revisão jurídica" de um texto
que continua sem revisão é exatamente o tipo de mentira que este projeto
persegue.

Cláusulas que descrevem a operação do institucional e não da loja (blog, cadastro
de newsletter de lá, o app) são adaptadas ou removidas, não copiadas cegamente.

### `/bio` — redesenhada

Página de links para Instagram. O conteúdo (loja, private label, atacado,
assinatura empresarial, site, blog, história) vem do institucional; o desenho é
refeito na estética da loja. **Mobile-first de verdade**: é uma página que
praticamente só existe em telefone.

---

## 4. Blog: a casca

A home ganha uma seção de blog **desenhada e vazia**, marcada "Em breve". Sem
API, sem `blog_posts`, sem admin.

Ela existe para reservar o lugar e para o visitante saber que vem conteúdo. Uma
seção que promete post e entrega erro seria pior que nenhuma seção.

O contrato de dados fica escrito no componente — título, resumo, imagem, data,
slug — para que ligar a API depois seja trocar a fonte, não redesenhar a seção.

---

## 5. Performance: medir, não adivinhar

O cliente relata que abrir um produto demora — **em `npm run dev`, na máquina
dele**. Não é o site publicado.

O trabalho é **diagnóstico**, e o relatório é o entregável. Correção só do que for
defensável.

Hipóteses a medir, cada uma com um número:

1. **Compilação sob demanda do `next dev`.** A PDP puxa `PainelCompra`,
   `Avaliacoes`, o contexto da sacola e o JSON-LD. Primeira visita compila tudo.
2. **OneDrive.** O repositório vive em `C:\Users\rafae\OneDrive\…`. `node_modules`
   e `.next` sob sincronização é causa documentada de `next dev` lentíssimo no
   Windows. Um `grep` recursivo nesta árvore estourou 120 s durante a análise —
   é indício, não prova.
3. **A API fora do ar.** Não há nada na `:3333`. Cada render chama
   `fetch("http://localhost:3333/dashboard?limit=200")`.
4. **`next/image` sobre `nossa-historia.png`, 3,7 MB**, otimizado a cada request
   em dev.

### O único defeito já confirmado, e ele é de produção

`lib/catalogo/repositorio.ts:38` faz `fetch` **sem timeout**. O irmão dele,
`lib/avaliacoes/servidor.ts:47`, tem 3 s — e o comentário lá explica exatamente
por quê: `fetch` não tem timeout próprio, e um servidor que aceita a conexão e
nunca responde deixa a promessa pendurada para sempre.

Em produção isso trava a home, a PLP e a revalidação da PDP. Recebe timeout e
teste. É a única correção autorizada fora do relatório.

---

## 6. Verificação

- As duas suítes verdes. Baseline medido nesta branch: **407 testes da vitrine em
  28 arquivos**, mais a suíte do backend. Nenhum agente entrega com teste
  vermelho.
- `npm run build` de produção passa — é ele que prova que `generateStaticParams`
  dá conta de locale × slug e que o dicionário está completo.
- Nenhuma string em português cravada na superfície traduzida. Verificado por
  varredura, não por confiança.
- Mobile-first conferido em 360 px de largura.
- Nenhum link quebrado entre as rotas novas.

## 7. Fora de escopo

Blog completo com admin; `/ANUGA`; tradução de checkout, conta e e-mails; produtos
novos (Blend Espresso, moedor, granel 2 kg); deploy na VPS; a decisão de domínio.

**Bloqueio que não é deste projeto e não sai daqui:** o histórico do Git ainda tem
CSVs com dado pessoal (`docs/go-live.md` §6, `docs/seguranca-dados-pessoais.md`).
O script de reescrita existe e nunca foi executado. Nada disto pode ser publicado
antes.
