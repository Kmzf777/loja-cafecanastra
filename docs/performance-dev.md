# Por que abrir um produto demora em `npm run dev`

**Data da medição:** 22 de agosto de 2026
**Máquina:** a do cliente — a mesma em que o sintoma acontece
**Escopo:** diagnóstico. Nenhuma linha de código foi alterada **para medir**.

> **O que mudou depois da medição, e este documento acompanha.** Os dois únicos
> defeitos daqui que valiam em produção **já foram corrigidos** — não procure
> por eles: o `fetch` sem timeout do catálogo (§5) e as 21 páginas que a fusão
> dos dois sites tirou da geração estática (§7.1, achado que não existia quando
> as medições foram feitas). Todos os números medidos abaixo são de **antes** do
> segmento `[locale]`; o resto do documento continua sendo o diagnóstico de
> `dev` que ele sempre foi, e o veredito dele continua sendo *não mexa*.

O cliente relatou: *"clico em um produto e demora dias para abri-lo"*, e
confirmou que é **local, em `npm run dev`**, não no site publicado. Pediu
investigação, não conserto especulativo. Este documento é a investigação.

Cada afirmação abaixo tem um número medido do lado. Onde não há número, está
escrito que não há.

---

## A resposta, antes do detalhe

| Hipótese | Custa quanto | Afeta produção? | Veredito |
|---|---|---|---|
| **H1 · compilação sob demanda do `next dev`** | 5,6–6,5 s na primeira rota; 1,8–2,9 s na PDP | não | **é a causa principal — e é o `next dev` funcionando como foi desenhado** |
| **H2 · OneDrive** | diferença de 2 % a 25 %, com sinal trocando entre execuções | não | **inocentado.** O ruído entre execuções é maior que o efeito |
| **H3 · API fora do ar** | 2,5 ms no servidor; **até 2,4 s por carga de página no navegador** | não (mas ver §5) | **culpado parcial, e o conserto é grátis: subir a API** |
| **H4 · `next/image` no PNG de 3,7 MB** | 209 ms uma vez, 4 ms depois | não | **inocentado. E ele nem está na PDP** |
| **A máquina** | 866 MB de RAM livre, 2,5 GB de disco livre em 475 GB | não | **o multiplicador de todos os números acima** |
| **`fetch` sem timeout no catálogo** | 307 s pendurados com a API muda | **SIM** | **corrigido:** `AbortSignal.timeout(3000)`, §5 |
| **21 páginas fora do build** (achado posterior) | um render de servidor por visita, no lugar de 15–17 ms | **SIM** | **corrigido:** `generateStaticParams` nas sete institucionais, §7.1 |

E o que ninguém tinha medido: **`lib/catalogo/repositorio.ts` ficava pendurado
307 segundos** quando a API aceita a conexão e não responde. Cinco minutos de
home, PLP e PDP travadas, com o banco perfeitamente de pé. **Já corrigido nesta
árvore** — §5 tem o antes e o depois.

O segundo achado entrou depois da medição original e não é de `dev`: **21
páginas deixaram de ser geradas no build ao entrar no `[locale]`**, sem erro
nenhum, sem aviso e sem teste vermelho. Também já corrigido, e desta vez com
trava. Está em §7.1.

---

## 1. Como se mediu, e em que máquina

### A máquina

| | |
|---|---|
| CPU | Intel Core i7-1255U — 10 núcleos, 12 threads, classe 15 W de notebook |
| RAM | 12.012 MB totais. **1.725 MB livres** no início da medição, **866 MB** no meio |
| Disco | NVMe SK Hynix 512 GB. **2,53 GB livres de 474,7 GB — 0,53 %** |
| Pagefile | 25 GB alocados, 3,4 GB em uso, pico de 7,5 GB |
| Uptime | 1 dia e 8 horas |
| Defender | proteção em tempo real **ligada** (`DisableRealtimeMonitoring = False`) |
| OneDrive | **`OneDrive.exe` não estava rodando** durante nenhuma medição |
| Next | 15.5.23, **webpack** (o `dev` do `package.json` não passa `--turbopack`) |

**No momento da medição a máquina rodava, ao mesmo tempo:** dois `next dev`
(este projeto na `:3001` e o `Projeto-Rafael-ADA` na `:3000`), uma suíte
`vitest`, os testes do backend e o Defender. Os dois `next dev` sozinhos
ocupavam **842 MB + 674 MB** de working set (1.657 MB + 963 MB de memória
privada).

### Os bancos de prova

Para não atrapalhar o `next dev` que o cliente tinha aberto, nem a árvore em que
outros agentes escrevem, as medições de compilação a frio usaram **duas cópias
idênticas do projeto**, montadas do mesmo código-fonte, com `node_modules`
apontado por junção para o original:

- `probe-fora` — em `%LOCALAPPDATA%\Temp`, **fora** do OneDrive;
- `probe-dentro` — em `C:\Users\rafae\OneDrive\_perfprobe`, **dentro** do OneDrive.

As duas foram apagadas ao fim. Os dois `next dev` do cliente ficaram de pé,
intocados, e serviram de terceira fonte de números (a `:3001` é o processo real
dele).

### O que se cronometrou

- Log do próprio Next, com carimbo de tempo por linha (`Ready in`,
  `Compiled /rota in`, `GET /rota 200 in`).
- `fetch` cru do Node, medindo TTFB e último byte.
- Um **Chromium de verdade** (o Playwright que já é `devDependency` do
  `frontend`), em viewport de **360 px**, clicando num card da PLP como uma
  pessoa faz — com a cascata de rede requisição a requisição.

---

## 2. H1 · A compilação sob demanda do `next dev`

### A causa

`next dev` não compila o site: compila **a rota que você pediu, na hora em que
você pede**. A primeira rota paga o preço do grafo inteiro; as seguintes pagam
só a diferença.

A PDP puxa `PainelCompra` (client), `Avaliacoes` (client island), o contexto da
sacola, dois blocos de JSON-LD e o layout da vitrine com Cabeçalho e Rodapé. Só
que a maior parte disso é compartilhada com a PLP — o Next reportou **897
módulos** para `/cafes` e **912** para `/cafes/[slug]`. São 15 módulos de
diferença.

### A evidência

Duas execuções a frio de cada lado, `.next` apagado antes de cada uma:

| Marco (log do próprio Next) | fora do OneDrive | dentro do OneDrive |
|---|---|---|
| `Ready in` | 2,4 s · 2,3 s | 3,5 s · 2,2 s |
| `Compiled /middleware` | 868 ms · 1.124 ms | 1.421 ms · 1.110 ms |
| `Compiled /cafes` (897 módulos) | **5,6 s · 5,6 s** | **5,8 s · 6,5 s** |
| `GET /cafes 200 in` (1ª) | 6.585 ms · 6.539 ms | 6.659 ms · 7.514 ms |
| `Compiled /cafes/[slug]` (912 módulos) | 783 ms · 1.972 ms | 2.900 ms · 1.819 ms |
| `GET /cafes/classico 200 in` (1ª) | 2.761 ms · 4.563 ms | 5.691 ms · 4.174 ms |
| `GET /cafes 200 in` (2ª) | 508 ms | 322 ms · 761 ms |
| `GET /cafes/classico 200 in` (2ª) | 458 ms · 577 ms | 529 ms · 643 ms |

O gesto real, no Chromium a 360 px — abrir a PLP, esperar o prefetch, clicar no
primeiro café:

| | `next dev` frio | `next dev` quente | `next build && next start` |
|---|---|---|---|
| PLP `/cafes` até o `<h1>` | **9.154 ms** | 1.566 ms | **746 ms** |
| clique → PDP, 1ª vez | **3.035 ms** | 880 ms | **106 ms** |
| clique → PDP, 2ª vez | 669 ms | 361 ms | **55 ms** |

E depois de editar um componente da PDP (`PainelCompra.tsx`), com o servidor de
pé: `Compiled in 1.101 ms (912 módulos)`, e a página seguinte em 898 ms.

**Reiniciar o `next dev` não salva quase nada.** Com o cache do webpack já em
disco, a segunda subida ainda gastou `Ready in 4,2 s`, `Compiled /cafes in 3 s`
e `GET /cafes 200 in 5.103 ms`. O cache encurta a compilação, não a elimina.

### Isto afeta produção?

**Não.** Em `next build`, `/cafes/[slug]` é gerada estaticamente (a saída do
build marca `● SSG` com os cinco slugs — hoje são quinze, cinco por idioma) e o
`next start` a serve em **15 ms**. Os 3 segundos do clique a frio viram 106 ms.

A PDP foi a única rota que a fusão dos dois sites **não** tirou do build, e por
isso este parágrafo continua valendo palavra por palavra. As outras tiveram de
ser devolvidas: §7.1.

### Custo de correção

Existe um caminho: trocar o webpack pelo Turbopack no dev (`next dev
--turbopack`). Não custa dependência nova — vem no Next 15. Mas muda o
compilador do ambiente de desenvolvimento inteiro, e este repositório tem
`styled-components` no painel legado e um `next.config.mjs` com CSP montado em
tempo de configuração. É risco de ambiente para ganhar segundos em dev.

### Veredito

**É a causa principal do sintoma, e é comportamento normal do `next dev`.**
Deixe quieto. Se quiser experimentar o Turbopack, experimente **na sua máquina,
sem commitar**, e meça: o número a bater é `Compiled /cafes in 5,6 s`.

---

## 3. H2 · O OneDrive

### A causa suspeita

O repositório vive em `C:\Users\rafae\OneDrive\…`, com `node_modules` (613,7 MB)
e `.next` sob um diretório sincronizado. É causa documentada de `next dev` lento
no Windows. Durante a análise preliminar, um `grep -r` nesta árvore estourou
120 s — indício, não prova.

### A evidência

**Primeiro: o OneDrive não estava rodando.** `OneDrive.exe` não aparece na lista
de processos, nem `FileCoAuth`. Nenhuma sincronização aconteceu durante nenhuma
medição.

**Segundo: os arquivos não são espaços reservados.** Amostra de 4.000 arquivos
de `node_modules/next`: **todos com atributo `Archive`**, nenhum `Offline`,
nenhum `ReparsePoint`, nenhum `RecallOnDataAccess`. Não há nada para reidratar
da nuvem — o conteúdo está no disco.

**Terceiro: com o cache do sistema quente, dentro e fora do OneDrive é a mesma
coisa.** Mesma pasta (`node_modules/next`, 7.325 arquivos, 133,4 MB), copiada
para fora e lida nos dois lugares:

| | ler tudo | `stat` em tudo |
|---|---|---|
| dentro do OneDrive | 3.376 ms (40 MB/s) | 150 ms |
| fora do OneDrive | 3.334 ms (40 MB/s) | 238 ms |

Diferença de 1,3 % na leitura — e no `stat` o lado do OneDrive foi *mais
rápido*. Isso é ruído, não efeito.

**Quarto: as duas cópias do projeto compilaram igual.** A tabela da §2 mostra o
par: `Compiled /cafes` deu 5,6 s e 5,6 s fora, 5,8 s e 6,5 s dentro; mas
`Compiled /cafes/[slug]` deu 783 ms e 1.972 ms fora contra 2.900 ms e 1.819 ms
dentro. **O sinal da diferença troca conforme a execução.** Não há efeito
estável a medir.

**Quinto: o watcher do Next não olha para o OneDrive.** O próprio Next define,
em `node_modules/next/dist/build/webpack-config.js`:

```js
const baseWatchOptions = Object.freeze({
    aggregateTimeout: 5,
    ignored: // Matches **/node_modules/**, **/.git/** and **/.next/**
    /^((?:[^/]*(?:\/|$))*)(\.(git|next)|node_modules)(\/((?:[^/]*(?:\/|$))*)(?:$|\/))?/
});
```

O universo vigiado é **255 arquivos em 100 diretórios** — o código do projeto.
Não são os 33.850 arquivos do `node_modules`, nem os 197 arquivos do `.next`.

### O que o OneDrive de fato explica: a leitura a frio

Um número desta análise foi assustador e merece explicação, porque não é o que
parece:

| ler `node_modules/next` (7.325 arq, 133,4 MB) | tempo | por arquivo | vazão |
|---|---|---|---|
| **a frio** (primeiro toque) | **62.626 ms** | 8,55 ms | 2 MB/s |
| quente (segundo toque) | 3.975 ms | 0,54 ms | 34 MB/s |

62 segundos para ler 133 MB de um NVMe. Mas o controle mostra que isso **não é
do OneDrive**: uma árvore de arquivos pequenos **fora** do OneDrive
(`AppData\Local\npm-cache\_cacache\index-v5`, 930 arquivos), lida a frio, custou
**3,36 ms por arquivo** — mesma ordem de grandeza dos 8,55 ms de dentro.

O custo é **por abertura de arquivo**, não por byte, e vale em qualquer caminho
deste disco. Ele é a soma de duas coisas da máquina, não do caminho — as mesmas
que a §1 mede e a §9 manda resolver: o Defender examinando
cada arquivo na primeira abertura, e uma máquina sem RAM livre para manter o
cache de arquivos.

### O risco que continua de pé (e é o único)

O `.next` do checkout principal tem **529,6 MB em 197 arquivos**, sendo o maior
deles um único `.pack` de **108,2 MB**, reescrito a cada compilação. Isso vive
dentro da raiz de sincronização.

**Enquanto o `OneDrive.exe` estiver desligado, isso não custa nada.** No dia em
que for religado, vira upload contínuo de centenas de megabytes que mudam a cada
salvamento de arquivo. Se ele voltar, exclua `node_modules` e `.next` da
sincronização antes.

### Veredito

**Inocentado.** Não mova o repositório de lugar por causa de performance — o
custo da mudança (caminhos, atalhos, o worktree, o backup que o OneDrive faz de
graça) é real e o ganho medido é zero.

---

## 4. H3 · A API fora do ar

### A causa

Não há nada escutando na `:3333`. `lib/catalogo/repositorio.ts:38` chama
`fetch("http://localhost:3333/dashboard?limit=200")` a cada render de vitrine, e
o Cabeçalho chama `GET /config` (`lib/config-loja.ts:49`) **do navegador**, em
toda carga de página.

### A evidência: no servidor, custa 2,5 ms

`fetch` do Node contra a `:3333` vazia, 10 amostras cada:

| alvo | mediana | média | erro |
|---|---|---|---|
| `http://localhost:3333/…` | **2,497 ms** | 6,815 ms | `ECONNREFUSED` |
| `http://127.0.0.1:3333/…` | 0,624 ms | 0,818 ms | `ECONNREFUSED` |
| `http://[::1]:3333/…` | 0,622 ms | 0,773 ms | `ECONNREFUSED` |

O `localhost` do Node resolve para `[{"address":"::1"},{"address":"127.0.0.1"}]`
com `autoSelectFamily = true` e `autoSelectFamilyAttemptTimeout = 250 ms`. **A
armadilha dual-stack não morde aqui**, porque as duas famílias recusam na hora.

E há uma medida contraintuitiva que fecha o assunto. Subindo uma API de mentira
na `:3333` respondendo os 29 produtos, as páginas ficaram **mais lentas**, não
mais rápidas:

| rota (servidor quente, 6 amostras cada) | API fora | API no ar |
|---|---|---|
| `/cafes` | 168–268 ms | 1.043–1.341 ms |
| `/cafes/classico` | 423–718 ms | 689–1.304 ms |

Faz sentido: com a API no ar, a página faz uma volta HTTP de verdade, parseia o
JSON, escreve no cache de fetch do Next e renderiza mais conteúdo (200,4 KB
contra 179,4 KB de HTML). **A API fora do ar não está custando tempo de
servidor. Está economizando.**

### A evidência: no NAVEGADOR, custa até 2,4 s

Aqui está o culpado de verdade. O mesmo `fetch`, executado dentro do Chromium:

| alvo | mediana | amostras |
|---|---|---|
| `http://localhost:3333/config` | **1.989 ms** e **2.088 ms** | 259, 264, 368, 372, 1.989, 2.088, 2.349, 2.366 |
| `http://127.0.0.1:3333/config` | **0 ms** | 0, 0, 0, 0, 0, 0, 0, 6 |
| `http://[::1]:3333/config` | **0 ms** | 0, 0, 0, 0, 0, 0, 0, 0 |

**A armadilha dual-stack existe — só que é do navegador, não do Node.** E ela só
aparece com o nome `localhost`; com o IP literal a recusa é instantânea.

Na cascata real de três cargas seguidas da home — e note que esta captura é do
**build de produção rodando local**, ou seja, não é artefato do modo de
desenvolvimento:

```
fim   2833 ms  dur  2343 ms  fetch!  http://localhost:3333/config  FALHOU net::ERR_CONNECTION_REFUSED
fim   2406 ms  dur  2354 ms  fetch!  http://localhost:3333/config  FALHOU net::ERR_CONNECTION_REFUSED
fim   2425 ms  dur  2351 ms  fetch!  http://localhost:3333/config  FALHOU net::ERR_CONNECTION_REFUSED
```

Três cargas, três vezes ~2,35 s pendurados. No `next dev` do cliente, na `:3001`,
a mesma chamada custou **467 ms** na amostra capturada — o custo varia entre
~0,3 s e ~2,4 s, mas está sempre lá.

E ele acontece **em toda carga de página**, porque `config-loja.ts` só põe
**sucesso** no cache de 5 minutos — de propósito, e o comentário lá explica por
quê (uma queda de 2 s da API não pode congelar o fallback por 5 minutos). A
decisão está certa; o problema é a API não estar de pé.

`API_BASE` cai para `http://localhost:3333` quando `NEXT_PUBLIC_API_URL` não
existe, e o `frontend/.env.local` desta máquina de fato não a define.

### Isto afeta produção?

**Não.** Em produção `NEXT_PUBLIC_API_URL` é `/api` — mesma origem, atrás do
nginx — e a API está no ar. Nem o nome `localhost` nem a recusa existem lá.

### Custo de correção

Zero, e não é código:

1. **`npm run dev:api`** — subir a API, que é o que o README manda fazer desde
   sempre. Some o custo inteiro.
2. Se você trabalha de propósito sem a API, ponha
   `NEXT_PUBLIC_API_URL=http://127.0.0.1:3333` no `frontend/.env.local`: a falha
   passa a custar 0 ms em vez de até 2,4 s. Atenção: essa variável também
   alimenta o `connect-src` do CSP em `next.config.mjs` — trocar `localhost` por
   `127.0.0.1` troca a origem liberada junto, o que é coerente.

### Veredito

**Culpado parcial, e o conserto é subir a API.** Não mexa em
`lib/config-loja.ts` para "cachear a falha": o comentário de lá já justificou
por que não, e o preço disso seria a barra de frete grátis mentir por cinco
minutos depois de a API voltar.

---

## 5. O defeito que também valia em produção — MEDIDO AQUI, CORRIGIDO DEPOIS

> **Estado: corrigido.** Este documento nasceu como diagnóstico e mediu o
> defeito; a correção veio na onda seguinte, na mesma branch. Quem chegar aqui
> procurando o que consertar não vai achar — vai achar o número que justificou
> a prioridade, que é para o que esta seção serve agora.

`lib/catalogo/repositorio.ts` fazia `fetch` **sem timeout**. O irmão dele,
`lib/avaliacoes/servidor.ts`, já tinha 3 s, e o comentário de lá descrevia
exatamente o cenário. Faltava o número. Aqui está ele.

Três modos de falha, medidos contra servidores construídos para cada um:

| cenário | quanto o `fetch` demora para desistir | erro |
|---|---|---|
| porta vazia (o caso de hoje, em dev) | **2,5 ms** | `ECONNREFUSED` |
| host que engole o SYN (firewall com DROP) | **10.664 ms** | `UND_ERR_CONNECT_TIMEOUT` |
| **servidor que aceita a conexão e nunca responde** | **307,1 s — cinco minutos e sete segundos** | `UND_ERR_HEADERS_TIMEOUT` |
| o mesmo servidor mudo, com `AbortSignal.timeout(3000)` | 3.009 ms | timeout, e a vitrine cai para o JSON |

**Cinco minutos.** É o `headersTimeout` padrão do undici, e é o que segurava a
home, a PLP e a revalidação da PDP quando a API aceita a conexão e trava — o
caso de um Express vivo com o pool do banco esgotado, que é o jeito mais comum
de um backend morrer sem cair.

Não era hipótese de dev: era produção.

### A correção, e onde ela está

`frontend/lib/catalogo/repositorio.ts` exporta hoje `ESPERA_MAXIMA_MS = 3000` e
passa `signal: AbortSignal.timeout(ESPERA_MAXIMA_MS)` no `fetch` do
`/dashboard?limit=200`. **3 segundos, o mesmo número do irmão, de propósito:**
são duas leituras de contingência do mesmo tipo, e dois tetos diferentes seriam
duas conversas sobre o mesmo problema. Estourado o prazo, o `fetch` rejeita e
cai no `catch` que já existia — mapa vazio, e a vitrine vende pelo JSON
versionado. A linha da tabela acima que descreve o comportamento de hoje é a
última: **3.009 ms, e a vitrine cai para o JSON.**

Para conferir sem subir nada: `grep -n "AbortSignal" frontend/lib/catalogo/repositorio.ts`.

---

## 6. H4 · O `next/image` sobre `nossa-historia.png`

### A causa suspeita

`frontend/public/nossa-historia.png` tem **3.748.870 bytes** e é otimizado a
cada requisição em dev.

### A evidência

Forçando otimização nova a cada chamada (um `q` inédito é uma entrada nova no
cache de imagem do Next), com o `Accept` que cada navegador manda de verdade:

| formato que o navegador aceita | largura | 1ª (otimiza) | 2ª (cache) | saída |
|---|---|---|---|---|
| só PNG | 640 | 225 ms | 8 ms | 152 KB |
| só PNG | 1920 | **580 ms** | 6 ms | 840 KB |
| WebP (Chrome, Firefox, Edge) | 640 | 75 ms | 3 ms | 46 KB |
| WebP | 1920 | **209 ms** | 4 ms | 201 KB |
| AVIF no `Accept` | 1920 | 233 ms | 7 ms | 223 KB |

Uma foto de PDP para comparar (`cafe-classico.png`, 133 KB): 34–68 ms na
primeira, 2–6 ms depois.

### E o detalhe que encerra a hipótese

`nossa-historia.png` é usada em **dois lugares**, e a PDP não é nenhum deles —
a home (`src="/nossa-historia.png"`, seção "História") e `/a-serra`. Duas
ocorrências no repositório inteiro, nenhuma na PDP.

As fotos da PDP são `/cafe-classico.png`, `/cafe-suave.png`, `/cafe-canela.png` e
`/microlote-png.png` — de 133 KB a 260 KB. **A hipótese não toca a rota de que o
cliente reclamou.**

### Veredito

**Inocentado.** 209 ms uma vez por combinação de largura e qualidade, num cache
que sobrevive à sessão inteira do dev. Reduzir o PNG é uma boa ideia por peso de
repositório e por banda de quem visita a home — não por causa deste sintoma, e
não como "correção de performance".

---

## 7. `next dev` contra `next build && next start`, na mesma máquina

O build rodou na cópia fora do OneDrive, com o mesmo código e o mesmo
`node_modules`.

```
next build   →  62,4 s   26 páginas estáticas geradas   .next final: 357 MB
next start   →  Ready in 536 ms
next dev     →  Ready in 2,2 a 3,5 s
```

Tempo até o último byte, medido de fora do processo:

| | `next dev` frio (`.next` apagado) | `next dev` quente | `next start` |
|---|---|---|---|
| `GET /cafes` 1ª | **7.931 ms** | — | 395 ms |
| `GET /cafes` repetido | — | 168–268 ms | **46–90 ms** |
| `GET /cafes/classico` 1ª | **4.644 ms** | — | 73 ms |
| `GET /cafes/classico` repetido | — | 423–718 ms | **15–17 ms** |
| clique da PLP para a PDP (Chromium, 360 px) | 3.035 ms | 880 ms | **106 ms** |
| HTML da PDP | 285,7 KB | 285,7 KB | **149,7 KB** |

O "frio" acima é o pior caso honesto: `.next` apagado. Com o cache do webpack já
em disco e o servidor recém-subido, os mesmos dois primeiros acessos custaram
6.648 ms e 6.645 ms — ou seja, **o cache em disco não compra a primeira visita**.

**A PDP em produção responde em 15 ms. Em `next dev` quente, em ~460 ms. Na
primeira visita, entre 4,6 s e 6,6 s conforme o estado do cache do webpack.** É
uma diferença de 30× a mais de 300×, e ela é inteira do modo de desenvolvimento.

O build de produção também mostra que os bundles estão saudáveis: 104 kB de
JavaScript compartilhado, 197 kB de primeira carga na PDP. Não há gordura de
produção a cortar.

### 7.1 · 21 páginas saíram do build ao entrar no `[locale]` — e voltaram

**Todos os números acima foram medidos ANTES de a vitrine entrar no segmento
`[locale]`** — é por isso que a linha diz `26 páginas estáticas geradas` e a §2
fala em "os cinco slugs". Depois da fusão, esse `26` não descreve mais nada.

#### O defeito

A fusão dos dois sites pôs um segmento dinâmico novo (`[locale]`) acima de toda
página da vitrine. **Uma rota só sai do build se todos os segmentos dinâmicos
do caminho dela forem enumerados por `generateStaticParams`.** Depois da fusão,
uma única rota fazia isso: a PDP, que monta o produto cartesiano `idioma × slug`
na própria folha (3 × 5 = 15 endereços; o comentário de lá explica por que na
folha e não nos segmentos).

Todas as outras foram junto. As **sete rotas institucionais** — home, `/a-serra`,
`/historia`, `/bio`, `/rastreabilidade`, termos e política — são texto puro:
não leem `cookies()`, `headers()` nem `searchParams`, e o build as resolveria
uma vez para servir como arquivo. Sem enumeração do `[locale]`, passaram a pagar
render de servidor **a cada visita**, nos três idiomas: **7 × 3 = 21 páginas.**

O que torna este defeito desagradável é que ele **não deu erro nenhum**. Build
verde, testes verdes, nenhum aviso — só o site mais lento em produção. É o
oposto do resto deste documento, que é sintoma sem defeito: aqui era defeito sem
sintoma visível.

#### A correção

As sete declaram `generateStaticParams` devolvendo os três idiomas, e há uma
trava para o defeito não voltar do mesmo jeito silencioso:
`frontend/app/[locale]/(vitrine)/paginas-estaticas.test.ts` lê o **código-fonte**
das sete e falha se a função sumir. Ela lê o texto do módulo em vez de importar
a página porque importar `page.tsx` no Vitest arrastaria `next/image`, o
repositório do catálogo e a árvore de componentes de servidor para um ambiente
que não é o do Next — e o que precisa ser verdade é uma propriedade do fonte.

`/clube` ganhou a mesma enumeração de brinde. Ficam de fora, e é decisão: a PLP
`/cafes` lê `searchParams` (`app/[locale]/(vitrine)/cafes/page.tsx:118`) e é
dinâmica por natureza, com `[locale]` ou sem ele.

**Nenhum `npm run build` foi rodado para conferir isto.** Três agentes escreviam
nesta árvore ao mesmo tempo e o build é global — rodá-lo teria colidido. O que
está verificado é o fonte (`grep -rn "generateStaticParams" frontend/app`) e a
suíte. **Quem arbitra de verdade é a saída do build**, que imprime `○`, `●` e
`ƒ` rota a rota: é lá que se confere que as 21 voltaram.

#### O tamanho disto

Com os números que a §7 já tem: uma rota estática servida por `next start`
responde em **15–17 ms**; a mesma rota renderizada a cada requisição paga o
render inteiro. Não é o sintoma de que o cliente reclamou — aquele é de `dev` —
mas era o único item deste documento que piorava a loja **publicada**.

### Uma observação de brinde, que não é performance

Durante a medição, a chamada que a PDP faz ao PostgREST
(`lib/avaliacoes/servidor.ts`) respondeu **HTTP 404** em cinco tentativas, em
156–323 ms cada, contra o projeto Supabase do `.env.local` desta máquina. O
código trata isso corretamente — devolve `null` e a página sai sem
`aggregateRating`, que é o desfecho previsto. Mas significa que, **nesta
máquina, o agregado de avaliações nunca chega**. Vale conferir se é o esperado
para o projeto de teste (schema `canastra` não exposto ao PostgREST é a falha
nº 1 deste stack, `docs/producao.md` §3.3) ou se é problema. **Custa ~200 ms por
render de PDP em dev**, de qualquer forma.

---

## 8. O QUE NÃO VALE CORRIGIR

Esta seção é resposta, não omissão. O cliente pediu investigação; o resultado da
investigação em quatro dos cinco casos é *não mexa*.

**1. A compilação sob demanda do `next dev`. Isto é normal do `next dev`, deixe
quieto.** Os 5,6 s da primeira rota são o webpack montando 897 módulos. Não há
bug. Trocar para Turbopack é um experimento de ambiente local, não um commit — e
se for feito, tem de ser medido contra `Compiled /cafes in 5,6 s`.

**2. Mudar o repositório de lugar por causa do OneDrive.** Medido: 1,3 % de
diferença na leitura quente, e o sinal da diferença troca entre execuções na
compilação. Mover o projeto custaria caminhos quebrados, o worktree, os atalhos
— para ganhar ruído. **A única providência real é a preventiva:** se
`OneDrive.exe` voltar a rodar, excluir `node_modules` e `.next` da
sincronização, porque são 613 MB parados e 530 MB que mudam a cada salvamento.

**3. Encolher `nossa-historia.png` "para acelerar".** 209 ms uma vez, e nem está
na PDP. Se for encolhida, que seja pelo peso do repositório e pela banda de quem
visita a home — com essa justificativa escrita, não com esta.

**4. Cachear a falha do `GET /config` em `lib/config-loja.ts`.** O comentário
daquele arquivo já recusou essa ideia com razão: guardar a falha por 5 minutos
faria a barra de frete grátis mentir depois de a API voltar. O custo de 2,4 s é
real, mas o remédio é subir a API, não estragar o cache.

**5. Otimizar bundle de produção.** 104 kB compartilhados, 197 kB na PDP,
resposta de 15 ms. Não há problema aqui para resolver.

---

## 9. O que vale, em ordem de retorno

**1. Subir a API: `npm run dev:api`.** Custo zero, é o que o README já manda
fazer. Remove até 2,4 s de tempo morto **por carga de página** no navegador.
Alternativa, se você trabalha sem a API de propósito:
`NEXT_PUBLIC_API_URL=http://127.0.0.1:3333` no `frontend/.env.local`, que
derruba a falha de 2,4 s para 0 ms.

**2. Liberar disco. 2,53 GB livres de 474,7 GB é 0,53 %.** É a variável mais
grave desta análise e nenhuma linha de código a resolve. Com o disco nesse
estado o Windows não tem folga para o pagefile (25 GB alocados), para o cache de
arquivos nem para os 357–530 MB que um `.next` ocupa. O `.next` do checkout
principal sozinho são **529,6 MB**, e apagá-lo é seguro — ele se refaz.

**3. Não rodar dois `next dev` ao mesmo tempo numa máquina de 12 GB.** Medido:
842 MB + 674 MB de working set, com **866 MB de RAM livre** no total. Sem RAM
livre não há cache de arquivos, e sem cache de arquivos a leitura a frio volta
para os 8,55 ms por arquivo que produziram os 62 segundos da §3.

**4. Para conferir uma mudança visual, use `next build && next start`.** 62 s de
build compram uma PDP de 15 ms e um clique de 106 ms. Para trabalho iterativo o
`dev` continua sendo o certo — mas para "ver como ficou", o build ganha.

**5. ~~O timeout de `lib/catalogo/repositorio.ts`~~ — FEITO.** Era o único item
desta lista que valia em produção, e os cinco minutos de página pendurada já
não existem: `AbortSignal.timeout(3000)` está no arquivo (§5). Nada a fazer.

**6. ~~Devolver ao build as rotas traduzidas~~ — FEITO (§7.1).** As 21 páginas
institucionais voltaram a sair do build, com trava em teste. Falta só **ver a
saída de um `npm run build`** confirmando — nenhum foi rodado nesta onda.

---

## 10. Como repetir qualquer número deste documento

Nenhuma medida aqui depende de ferramenta que não esteja no repositório.

- **Tempo de compilação por rota:** subir o `next dev` capturando `stdout` com
  carimbo de tempo. O Next imprime `Ready in`, `Compiled /rota in (N módulos)` e
  `GET /rota 200 in`. É a fonte primária da §2.
- **Primeira visita contra segunda:** `.next` apagado, `curl` ou `fetch` na
  rota, três vezes seguidas. A primeira é a compilação; da segunda em diante é o
  regime.
- **O gesto do clique:** `playwright` já é `devDependency` do `frontend` e os
  navegadores estão instalados em `%LOCALAPPDATA%\ms-playwright`. Abrir
  `/cafes`, esperar o prefetch, clicar em `a[href^="/cafes/"]` e cronometrar até
  o `<h1>`. Viewport de 360 px, que é o alvo do projeto.
- **O custo da conexão recusada:** o mesmo `fetch` para `localhost:3333`,
  `127.0.0.1:3333` e `[::1]:3333`, uma vez no Node e uma vez dentro da página
  (`page.evaluate`). A diferença entre os dois ambientes é o achado.
- **Servidor que trava sem cair:** `net.createServer` que aceita a conexão e não
  escreve nada. É o que produz os 307 s.
- **I/O dentro e fora do OneDrive:** percorrer a mesma árvore copiada nos dois
  lugares, uma vez só com `stat`, outra lendo o conteúdo. Medir duas vezes cada
  — a diferença entre a 1ª e a 2ª passada é o cache do sistema, e é ela que
  domina.
