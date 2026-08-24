# Acesso seguro ao painel — plano de execução

> Executa o desenho aprovado em
> `docs/superpowers/specs/2026-08-21-acesso-seguro-ao-painel-design.md`.
> TDD onde há função pura; `tsc` onde só há JSX. **Não commita.**

**Goal:** `/dashboard` deixa de servir o pacote do painel a visitante anônimo. A
decisão de quem entra passa a acontecer no servidor, antes do primeiro byte do
SPA legado, e quem é recusado vê uma tela que explica o motivo certo.

## Restrição de ambiente

**Proibido `npm run build` / `next build`.** O dono do projeto tem `next dev`
vivo sobre o mesmo `frontend/.next`; um build de produção já corrompeu a sessão
dele hoje (`Cannot find module './331.js'`). Verificação = `npm --prefix
frontend run test` + `npx tsc --noEmit` dentro de `frontend/`. Nenhum dos dois
escreve em `.next`.

## O que a investigação acrescentou ao desenho

1. **Vitest não tem alias.** `frontend/vitest.config.ts` é
   `{ test: { environment: "node", include: ["**/*.test.ts"] } }` — sem
   `resolve.alias`. Nenhum arquivo em `lib/` usa `@/…` hoje (confirmado por
   grep); todos importam relativo. `painel-servidor.ts` segue a casa e importa
   `../supabase/servidor`, senão o próprio teste não carrega o módulo.
2. **`include` é `**/*.test.ts`, não `.tsx`.** O teste tem de ser `.ts` puro —
   o que combina com "teste o que é puro".
3. **`next/navigation` precisa ser mockado no teste**, porque o módulo é
   importado no topo de `painel-servidor.ts` e não existe runtime do Next sob o
   Vitest. `lib/supabase/servidor.test.ts` já faz isso com `next/headers`; é o
   padrão da casa.
4. **O reset e as fontes são escopados em `.vitrine`** (`app/globals.css`
   linhas 106-208). `/dashboard/entrar` está fora do grupo `(vitrine)`, então
   sem um contêiner `.vitrine` a página nasce com `margin: 8px` e Times New
   Roman. A classe é o *reset*, não a moldura — cabeçalho e rodapé vêm do
   layout do grupo, que continua não sendo herdado. Logo: `<div
   class="vitrine">` na página de entrada, e nada mais.
5. **A logo certa já é usada pelo legado.** `legacy/pages/dashboard/Dashboard.jsx:35`
   faz `<img src="/logo-canastra.png" alt="Café Canastra" />` — servido de
   `public/` pelo mesmo Next que serve a ilha. O `Loading` pode usar o mesmo
   caminho; não é preciso texto no lugar de imagem.
6. **`getUser()` sem sessão devolve erro**, e esse erro é o caminho NORMAL do
   anônimo (`AuthSessionMissingError`). Tratá-lo como "falha de infraestrutura"
   faria toda visita anônima ler uma mensagem falsa de sistema fora do ar — e
   destruiria o sinal justamente para o caso em que ele importa. Daí a
   classificação abaixo.

## Decisões

1. **Falha de consulta fecha o acesso.** Mesma regra de `lerPapel()`
   (`lib/conta/sessao.ts:260-270`): melhor gestor recarregando a página do que
   área de gestão aberta por rede ruim. O comentário no código diz por quê.
2. **`falhouConsulta` é avaliado ANTES de `temSessao`.** Quando os dois
   coincidem (não deu para perguntar ao GoTrue), a frase honesta é "não
   conseguimos confirmar", não "faça login" — a segunda culpa a pessoa por um
   problema do servidor.
3. **A falha de infraestrutura viaja na URL** como `&aviso=falha`, e não só no
   campo `motivo` do retorno. O desenho exige que "o gestor precisa saber que
   foi falha de infraestrutura, não senha errada"; um `motivo` que morre dentro
   do processo não informa ninguém. O destino continua sendo a MESMA página
   (`/dashboard/entrar`) — muda só o que ela tem a dizer. Fica dentro da função
   pura, portanto testado.
4. **Distinguir "sem sessão" de "não deu para perguntar"** por classe de erro,
   não por texto: é falha de infraestrutura quando o erro não tem `status` (o
   `fetch` nem chegou) ou quando `status >= 500`. `400/401/403` e
   `AuthSessionMissingError` são "não há sessão válida" — resposta legítima do
   servidor, não queda. Função pura `ehFalhaDeInfraestrutura`, testada.
5. **`destinoDoPainel` recusa `..`** além dos vetores de `destinoSeguro`.
   `/dashboard/../account` começa com `/dashboard` mas o navegador normaliza
   para `/account` — seria a trava do painel vazando por normalização de path.
   Também recusa `string[]`: `?de=a&de=b` chega como array em `searchParams`.
6. **`/dashboardevil` é recusado.** A trava é "sob `/dashboard`", não "prefixo
   `/dashboard`": aceita-se exatamente `/dashboard` ou `/dashboard` seguido de
   `/`, `?` ou `#`.
7. **Uma leitura de servidor só**, `lerAcessoDoPainel()`, usada pelo guard E
   pela página de entrada. Duas cópias da pergunta "essa pessoa é gestora?" é
   como as duas telas passam a discordar.
8. **`middleware.ts` não é tocado** — o desenho explica (linhas 108-115): um
   guard global mandaria `/account/verify-email` e `/account/reset-password`
   para o login antes de o `?code=` do GoTrue virar sessão.

## Tasks

### 1. `lib/conta/painel-servidor.test.ts` — vermelho primeiro
Mocka `next/navigation` e `../supabase/servidor`. Cobre:
- `decidirAcessoAoPainel`: admin entra; sem sessão → `/dashboard/entrar?de=…`;
  sessão sem linha em `admins` → `/account?painel=negado`; falha de consulta →
  entrar com `aviso=falha` e `motivo` próprio; falha + sem sessão → falha
  ganha; `rotaPedida` codificada no `?de=`.
- `destinoDoPainel`: aceita `/dashboard` e `/dashboard/orders?p=2`; recusa
  `//evil.com`, `/\evil.com`, `https://evil.com`, `/account`, `/dashboardevil`,
  `/dashboard/../account`, `null`, array.
- `ehFalhaDeInfraestrutura`: sem status → true; 500 → true; 401/403/400 → false;
  `AuthSessionMissingError` → false; `null` → false.

### 2. `lib/conta/painel-servidor.ts` — verde
As três puras + `lerAcessoDoPainel()` + `exigirAdminNoPainel(rotaPedida)`.
`criarClienteServidor()` é **async** (`cookies()` do Next 15) — `await`.

### 3. `app/dashboard/[[...rota]]/PainelLegado.tsx` (novo)
`"use client"` + o `dynamic(() => import("@/legacy/PainelApp"), { ssr: false })`
que hoje mora na página.

### 4. `app/dashboard/[[...rota]]/page.tsx` — Server Component
`async`, `params` é Promise no Next 15. Remonta o caminho pedido a partir de
`rota` (cada segmento re-codificado) e chama `exigirAdminNoPainel` antes de
renderizar `<PainelLegado />`.

### 5. `app/dashboard/entrar/` — a tela de entrada
- `page.tsx`: Server Component, `metadata` com `robots: { index: false }`, três
  desfechos (admin → `redirect`; cliente → explicação + sair; anônimo →
  formulário). Contêiner `.vitrine` pelo motivo da investigação nº 4.
- `FormularioDeEntrada.tsx`: ilha cliente, `entrar()` de `lib/conta/sessao.ts`
  (tradução de erro é dele, não se reimplementa), `role="alert"`,
  `aria-live`, link para `/account/reset-password`. **Sem link de criar conta**,
  com comentário dizendo por quê.
- `BotaoDeSaida.tsx`: ilha mínima sobre `sair()`.

### 6. `app/(vitrine)/account/page.tsx` — o aviso `?painel=negado`
Lido do `location` no efeito de montagem (a página é client-only e não usa
`useSearchParams`, para não exigir Suspense) — mesmo padrão do
`?assinatura=confirmada` que já existe ali.

### 7. `legacy/components/Loading/Loading.jsx` — fim da marca antiga
`/logo-canastra.png`, "Carregando o painel", ícone que não seja sacola de loja.
Sem importar a logo antiga de `assets/`.

### 8. `legacy/routes/AdminRoutes.jsx` — segundo anel
Destino vira `/dashboard/entrar?de=…`; comentário do topo registra que agora
existe um guard de servidor e este é a segunda camada.

### 9. `app/robots.ts` — conferir
`disallow: ["/dashboard", …]` já cobre `/dashboard/entrar` por prefixo. Só
conferir; provavelmente não muda.

### 10. Verificação
`npm --prefix frontend run test` e `npx tsc --noEmit`. **Sem build.**

## Correções da revisão de segurança (2026-08-21, mesma sessão)

A revisão aprovou o ACESSO (anônimo não recebe o painel, papel vem de
`canastra.admins`, toda falha fecha) e apontou dois achados importantes.

### A. `?de=` furado por dot-segment percent-encoded

`bruto.includes("..")` era casamento de TEXTO e só via o ponto literal.
`?de=/dashboard/%2e%2e/account` saía aprovado e o navegador normalizava para
`/account` — a trava vazando por normalização, sem um caractere suspeito à
vista. Não abria o painel nem saía da origem, mas quebrava a garantia que o
comentário prometia.

**A lição:** comparar texto de URL é sempre perder — para cada grafia proibida
existe outra que significa o mesmo. Agora quem normaliza é o parser que o
navegador usa (`new URL` sobre uma base inventada e inalcançável): uma passada
resolve `..`, `%2e%2e`, `.%2e`, contrabarra, `//evil`, absolutas e caracteres de
controle (inclusive o `%0A` que num `Location:` seria injeção de cabeçalho).
Depois disso só resta comparar um caminho já normalizado.

Medido ao vivo depois da correção: o vetor `%252e%252e` entrega
`destino":"/dashboard"` ao formulário; o valor original sobrevive só dentro da
árvore de estado do router do Next, que é eco inerte da URL.

### B. A próxima rota sob `app/dashboard/` nascia pública

O guard morava na página do catch-all e `/dashboard/entrar` escapava por
precedência de rota. Funcionava — mas a mesma precedência valia para qualquer
arquivo futuro: `app/dashboard/relatorios/page.tsx` nasceria sem guard, sem
aviso e sem teste vermelho. **O padrão estava invertido, e a falha seria por
omissão.**

Agora o guard é um `layout.tsx` em `app/dashboard/(protegido)/`, herdado por
tudo que estiver no grupo. Sair da cerca exige escrever `(publico)`, que aparece
em qualquer diff. Route group não muda URL nenhuma.

**O custo, dito sem maquiagem:** layout não recebe os `params` do catch-all, e
não há cabeçalho de caminho confiável — conferi em
`next/dist/client/components/app-router-headers.js` que o Next só manda
`Next-Url` em requisição de RSC; numa carga de documento (favorito, endereço
digitado) não vem nada. Como `middleware.ts` está fora do trabalho por decisão
de desenho, o `?de=` de um favorito frio agora cai em `/dashboard` em vez da
rota exata. O caminho de sessão que morre com o painel aberto continua preciso,
porque quem redireciona ali é o `AdminRoutes` no cliente.

Trocar deep-link por "nenhuma rota futura nasce aberta" é troca boa, e a
segunda metade é reforçada por um **teste de inventário** que lê
`app/dashboard/` e falha se aparecer qualquer pasta fora dos dois grupos.
Verificado que o teste fica vermelho de verdade criando uma rota solta.

### C. Menores

- `caminhoDoPainel` saiu: com o guard no layout, ninguém mais remontava o
  caminho. O problema que ele teria (`/dashboard/entrar/foo` virando `?de=`)
  mudou de casa para dentro de `destinoDoPainel`, que agora recusa a própria
  porta de entrada como destino — cobre TODA origem de `?de=`, inclusive o
  `AdminRoutes`, e não só a que passava por aquela função.
- `lerAcessoDoPainel` faz rethrow dos sinais de controle do Next
  (`DYNAMIC_SERVER_USAGE`, `NEXT_REDIRECT`, `NEXT_HTTP_ERROR_FALLBACK`): engolir
  o primeiro, no dia em que `cacheComponents` for ligado, prerenderizaria o
  painel como página estática dizendo "você não tem acesso", servida do cache a
  todo mundo. Bug que não dá erro, dá página errada.
- `<ContaSemPermissao>` extraído: o mesmo fato estava escrito com redações
  diferentes em dois arquivos e ia envelhecer em direções distintas.
- Acessibilidade: foco vai para o bloco de "conta sem permissão" quando ele
  SUBSTITUI o formulário (não na carga da página, onde ele já é o conteúdo);
  `aria-live` saiu do `<Botao disabled>` — botão desabilitado sai da árvore de
  acessibilidade em vários leitores e o anúncio não sairia — e virou
  `aria-busy` no botão mais uma região viva `role="status"` separada.

## Correções da re-revisão (2026-08-21, mesma sessão)

### D. O teste de inventário não descia um nível

`pastas()` lia só o primeiro nível, então `(publico)/entrar/ajuda/page.tsx` —
rota **pública** em `/dashboard/entrar/ajuda` — passava verde. A varredura virou
recursiva. Reproduzido o vermelho antes e depois: com a pasta aninhada o teste
falha dizendo `expected [ 'entrar', 'entrar/ajuda' ] to deeply equal [ 'entrar' ]`.

### E. `Next-Url` nunca chega — era código morto com comentário mentiroso

O ramo "usa o cabeçalho quando ele vier" **nunca** executava. Conferido no fonte:
`next/dist/server/base-server.js`, em `setVaryHeader`, faz
`delete req.headers[NEXT_URL]` sempre que `pathCouldBeIntercepted(...)` for
falso — o que exige rota de interceptação (`(.)`, `(..)`, `(...)`). Conferido
também que este projeto não tem nenhuma. Logo o cabeçalho é apagado em 100% das
requisições, antes de qualquer Server Component rodar.

Pior que inútil: o comentário prometia precisão que não existia e ensinaria
errado quem fosse mexer. `rotaPedidaDoPainel()` e o `import { headers }` foram
removidos; o layout chama `exigirAdminNoPainel("/dashboard")` direto.

**A verdade, agora escrita nos dois lugares:** o `?de=` do guard de servidor é
**sempre** a raiz do painel. A rota exata sobrevive só pelo caminho do
`AdminRoutes`, no cliente, que enxerga `location.pathname + location.search` —
que é justamente o caso da sessão morrendo com o painel aberto, quando voltar ao
lugar certo importa. Favorito frio volta para `/dashboard` e navega dali.

### F. Route Handler não passa por layout

O nome `(protegido)` promete mais do que o mecanismo entrega: um
`(protegido)/exportar/route.ts` nasceria **aberto**, porque layout envolve
página, não handler. Registrado no comentário do layout e travado por teste
(nenhum `route.ts` sob `app/dashboard/`), com o vermelho reproduzido.

### G. Vetores e acabamentos

- Quatro vetores travados. Dois confirmaram o que eu supunha (`//dashboard` e
  `/dashboard/../..` caem na raiz); **dois me corrigiram**, e medi antes de
  escrever: `/dashboard%00/x` é **recusado** (depois da raiz vem `%`, não
  barra), e `/dashboard/%252e%252e/account` é **preservado** como segmento
  literal — `%25` é um "%" de verdade, então aquilo é uma pasta chamada
  `%2e%2e`, não travessia. A ponta que importa continua travada: decodificado
  uma vez vira `%2e%2e` e é recusado.
- `(publico)/entrar/page.tsx`: o parágrafo que explicava o mecanismo antigo
  ("estática vence catch-all", citando caminhos que não existem mais) foi
  reescrito para o atual (grupo irmão).
- `ContaSemPermissao`: tinha `role="status"` **e** foco, e anunciava duas vezes.
  Ficou o foco — ele resolve também o teclado, que a região viva deixaria
  perdido no começo do documento.

## Critério de pronto

- Anônimo em `/dashboard` não recebe o pacote do painel (guard de servidor).
- Nenhuma tela mostra a marca antiga nem diz "Carregando produtos para você".
- Gestor entra por `/dashboard/entrar` e cai na rota que pediu.
- Cliente logado que abre `/dashboard` entende por que não entrou.
- Falha de banco não abre o painel — e diz que foi falha, não senha errada.
- Suítes verdes; nenhum commit.
