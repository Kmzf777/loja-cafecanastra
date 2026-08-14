# Baseline do painel administrativo (`/dashboard`) — pré-conversão

Data: 2026-08-14
Branch: `feat/vitrine-nextjs`
Origem: `frontend/src/main.jsx`

## Por que este baseline é de grafo de módulos, não de renderização autenticada

O plano original previa abrir cada rota do painel num navegador autenticado como
admin e comparar screenshots/comportamento antes e depois da conversão. Isso não
é possível neste ambiente pelos seguintes motivos:

- Não há PostgreSQL nem Docker instalados na máquina usada para esta task.
- `estrutura.sql` (schema do banco) está no `.gitignore` e não veio no repositório,
  então não há como subir um banco local a partir do que está versionado.
- Qualquer rota do backend que consulte o banco derruba o processo inteiro: o
  handler de erro do pool em `backend/src/pgPool.js:19` chama `process.exit(-1)`
  quando a conexão falha, matando o Express.
- Sem banco não há login funcional e, portanto, não há como obter uma sessão de
  admin autenticada para navegar `/dashboard/*` de verdade.

Confirmando essa limitação na prática: ao iniciar esta task, nem o dev server do
Vite (`localhost:5173`) nem o backend Express (`127.0.0.1:3333`) estavam de fato
acessíveis nesta máquina/sessão (conexão recusada nas duas portas), apesar de a
descrição da task afirmar que ambos já estariam rodando como processos
independentes. O backend permaneceu inacessível durante toda a task — o que é
consistente com o motivo acima (sem banco, não há como mantê-lo de pé). Para
viabilizar ao menos a verificação de módulos, o dev server do Vite foi iniciado
manualmente nesta sessão (`node_modules/.bin/vite --port 5173 --strictPort`),
sem alterar nenhum arquivo de `frontend/`.

Por isso, o baseline registrado aqui cobre o risco principal desta etapa da
migração — o de um módulo do painel quebrar ou uma rota sumir durante a
reestruturação da pasta `frontend/` — através de duas evidências verificáveis
sem banco de dados:

1. **Tabela de rotas**: extraída diretamente do array passado a
   `createBrowserRouter` em `frontend/src/main.jsx` (rotas do bloco
   `AdminRoutes`, linhas 137–180), documentando path e componente montado.
2. **Grafo de módulos**: para cada componente carregado via `lazy()` que compõe
   o painel, foi pedido ao dev server do Vite o módulo correspondente
   (`GET http://localhost:5173/<caminho-do-arquivo>`). Um `200` com
   `Content-Type: text/javascript` confirma que o Vite conseguiu transpilar o
   arquivo e resolver toda a cadeia de imports estáticos dele (styled-components,
   ícones, contexts, etc.) — o que teria dado erro 500 (ou tela de erro do
   esbuild) se algum import estivesse quebrado.

Isso não substitui um teste funcional autenticado, mas cobre o cenário de maior
risco da conversão (arquivo movido/renomeado e import quebrado, ou rota que
deixa de existir no roteador).

## Tabela de rotas do painel (`/dashboard/*`)

Todas as rotas abaixo estão aninhadas sob o guard `AdminRoutes` (que verifica
`user.role === "admin"`, redirecionando para `/account/login` ou `/` caso
contrário) e, dentro dele, sob a rota `/dashboard` que monta `Dashboard.jsx`
como layout.

| rota | componente | módulo transpila | observação |
|---|---|---|---|
| `/dashboard` (index) | `pages/dashboard/Dashboard.jsx` → `components/DashboardSection/Home/HomeDashboard.jsx` | 200 / 200 | rota índice do painel |
| `/dashboard/products/addProduct` | `components/DashboardSection/GProducts/form/Form.jsx` | 200 | cadastro de produto |
| `/dashboard/products/addedProducts` | `components/DashboardSection/GProducts/addedShirts/AddedShirts.jsx` | 200 | listagem de produtos cadastrados |
| `/dashboard/orders` | `components/DashboardSection/Orders/Orders.jsx` | 200 | pedidos |
| `/dashboard/clients/registeredClients` | `components/DashboardSection/Clients/RegisteredClients/RegisteredClients.jsx` | 200 | clientes cadastrados |
| `/dashboard/settings/updateShopInfo` | `components/DashboardSection/Settings/UpdateShopInfo/UpdateInfo.jsx` | 200 | dados da loja |
| `/dashboard/settings/manageCategories` | `components/DashboardSection/Settings/ManageCategories/ManageCategories.jsx` | 200 | categorias |
| `/dashboard/settings/offers` | `components/DashboardSection/Settings/OffersAndCupons/PromotionsManager.jsx` | 200 | promoções/cupons |

Componentes de infraestrutura da rota, também verificados:

| módulo | papel | módulo transpila | observação |
|---|---|---|---|
| `pages/dashboard/Dashboard.jsx` | layout/casca do painel (monta `<Outlet/>` para as 7 rotas filhas) | 200 | — |
| `routes/AdminRoutes.jsx` | guard de autorização (`user.role === "admin"`) usado por todas as rotas acima | 200 | depende de `contexts/loginContext` para `user`/`initialized`; não testado autenticado (ver nota acima) |

Todos os caminhos de módulo acima são relativos a `frontend/src/`. Total: 8
componentes de tela de dashboard + `Dashboard.jsx` + `AdminRoutes.jsx` = 10
módulos verificados, todos com `HTTP 200` e `Content-Type: text/javascript`
retornado pelo dev server do Vite (`vite@6.1.1`), sem nenhum erro de
transformação/import.

## Como comparar depois da conversão

Na Task 12 (ou equivalente, ao final da migração da vitrine para Next.js dentro
de `frontend/`), repetir este mesmo procedimento e comparar:

1. **As mesmas 8 rotas** (`/dashboard`, `/dashboard/products/addProduct`,
   `/dashboard/products/addedProducts`, `/dashboard/orders`,
   `/dashboard/clients/registeredClients`,
   `/dashboard/settings/updateShopInfo`,
   `/dashboard/settings/manageCategories`, `/dashboard/settings/offers`) devem
   continuar respondendo sob `/dashboard/*` na aplicação Next — nenhuma pode
   ter sumido do roteamento nem ter mudado de path.
2. **Os mesmos módulos/componentes** (`HomeDashboard.jsx`, `Form.jsx`,
   `AddedShirts.jsx`, `Orders.jsx`, `RegisteredClients.jsx`, `UpdateInfo.jsx`,
   `ManageCategories.jsx`, `PromotionsManager.jsx`, `Dashboard.jsx`,
   `AdminRoutes.jsx`) precisam continuar existindo e resolvendo suas cadeias de
   import sem erro — seja pedindo o módulo ao dev server (se o painel continuar
   servido via Vite/CRA dentro de `frontend/`) ou, se o painel passar a ser
   servido pelo próprio Next, confirmando que a rota Next correspondente
   renderiza sem erro de build/import (`next build` sem falhas nesses
   arquivos, ou `curl` retornando 200 em cada rota `/dashboard/*` com o server
   do Next no ar).
3. Caso algum módulo tenha sido movido de lugar durante a conversão, o
   caminho novo deve ser documentado explicitamente como parte da task que
   fez a movimentação — este baseline deve ser atualizado (ou uma nova versão
   criada) para refletir o de-para, não apenas apagado.
4. Se nesse momento já houver banco de dados disponível (Postgres subido via
   Docker, `estrutura.sql` aplicado), a comparação deve ser fortalecida com o
   teste original do plano: login como admin e verificação visual/funcional
   de cada uma das 8 rotas. Este documento registra explicitamente que essa
   verificação **não foi feita** aqui por indisponibilidade de banco — não
   deve ser interpretado como "painel testado e aprovado" além do nível de
   grafo de módulos.

---

# Pós-conversão (Task 4 — painel como ilha client-only no Next 15)

Data: 2026-08-14
Branch: `feat/vitrine-nextjs`
Origem agora: `frontend/legacy/PainelApp.jsx`, montado por
`frontend/app/dashboard/[[...rota]]/page.tsx` via
`next/dynamic(..., { ssr: false })`.

## Resultado das 8 rotas

Duas medições independentes, ambas com o dev server do Next em
`localhost:3000` e **sem backend/banco** (limitação inalterada, ver acima):

- **HTTP**: `curl` na rota, confirmando que o Next serve o shell da página.
- **DOM renderizado**: Chrome headless (`--dump-dom`), confirmando que o bundle
  client-only realmente executa, o react-router casa a rota, o layout
  `Dashboard.jsx` monta com `<Outlet/>` e o componente de tela aparece.

A medição de DOM foi feita com uma cópia temporária do `PainelApp` **sem** o
guard `AdminRoutes` (idêntica no resto: mesmas rotas, mesmos componentes, mesmo
ponto de montagem `/dashboard`), porque sem banco não existe sessão de admin e o
guard redireciona antes de qualquer tela renderizar. Essa cópia foi apagada após
a verificação e **não** faz parte do commit.

| rota | componente | HTTP | DOM renderiza (sem guard) | status |
|---|---|---|---|---|
| `/dashboard` (index) | `components/DashboardSection/Home/HomeDashboard.jsx` | 200 | sim, layout + tela | OK |
| `/dashboard/products/addProduct` | `components/DashboardSection/GProducts/form/Form.jsx` | 200 | sim, layout + tela | OK |
| `/dashboard/products/addedProducts` | `components/DashboardSection/GProducts/addedShirts/AddedShirts.jsx` | 200 | sim, layout + tela | OK |
| `/dashboard/orders` | `components/DashboardSection/Orders/Orders.jsx` | 200 | sim, layout + tela | OK |
| `/dashboard/clients/registeredClients` | `components/DashboardSection/Clients/RegisteredClients/RegisteredClients.jsx` | 200 | sim, layout + tela | OK |
| `/dashboard/settings/updateShopInfo` | `components/DashboardSection/Settings/UpdateShopInfo/UpdateInfo.jsx` | 200 | sim, layout + tela | OK |
| `/dashboard/settings/manageCategories` | `components/DashboardSection/Settings/ManageCategories/ManageCategories.jsx` | 200 | sim, layout + tela | OK |
| `/dashboard/settings/offers` | `components/DashboardSection/Settings/OffersAndCupons/PromotionsManager.jsx` | 200 | sim, layout + tela | OK |

Nenhuma rota voltou 404/500. `next build` compila com sucesso (rota
`ƒ /dashboard/[[...rota]]`). Nenhum erro de módulo não resolvido no log do Next.

Navegação client-side também verificada via Chrome DevTools Protocol: clicar nos
links do `MenuAside` troca a rota sem full reload (marcador em `window`
sobrevive), e `history.back()` volta corretamente — ou seja, o `react-router` do
legado convive com o App Router do Next sem conflito de `pushState`.

Roteador usado: **`createBrowserRouter`**. O fallback `createMemoryRouter`
previsto no design **não foi necessário**.

## Decisão de rota: sem `basename`

O design previa `basename: "/dashboard"` com paths relativos. **Isso não
funciona** com este painel e foi descartado por evidência empírica: o
`react-router` prefixa o `basename` também em paths **absolutos**, e o legado
navega por absolutos (`to="/dashboard/orders"` em `MenuAside.jsx`,
`navigate("/dashboard")` em `Dashboard.jsx`). Com `basename`, os links do menu
renderizavam como `/dashboard/dashboard/orders` (verificado no DOM), quebrando
toda a navegação interna.

Solução adotada: **nenhum `basename`**, mantendo os paths absolutos idênticos
aos de `main.jsx`. Assim o menu do painel funciona sem editar nenhum componente
legado.

## Alterações necessárias em `legacy/`

Duas, ambas correções de quebras causadas pela migração, não melhorias:

1. `legacy/routes/AdminRoutes.jsx` — importava
   `../../src/contexts/...` e `../../src/components/...`. Esses caminhos
   apontavam para `frontend/src/`, que deixou de existir quando a Task 3 moveu
   `src/` → `legacy/`. Corrigido para `../contexts/...` e `../components/...`.
   Sem isso o `next build` falha com módulo não encontrado.
2. `legacy/api.js` — `import.meta.env.VITE_API_URL` é API exclusiva do Vite. O
   webpack do Next compila isso para `undefined.VITE_API_URL`, que lança
   `TypeError` na avaliação do módulo. Como os quatro contexts do painel
   importam `api.js`, **as 8 rotas dariam tela branca**. Trocado por
   `process.env.NEXT_PUBLIC_API_URL`, preservando o fallback
   `http://localhost:3333` (não há `.env` no projeto, então o valor efetivo é
   idêntico ao de antes).

## Pendências conhecidas (não corrigidas nesta task)

1. ~~**Imagens importadas renderizam quebradas.**~~ **RESOLVIDO** — ver seção
   "Correção das imagens estáticas" abaixo.
2. **O redirect do guard morre dentro da ilha.** Sem sessão de admin,
   `AdminRoutes` faz `<Navigate to="/account/login">`, mas `/account/login` não
   é rota deste roteador (a ilha só conhece `/dashboard/*`) nem existe ainda no
   Next. Resultado hoje: tela de erro padrão do react-router
   ("Unexpected Application Error / 404 Not Found"). Só será resolvido quando a
   vitrine trouxer `/account/login` para o Next — aí o redirect precisa virar
   navegação "dura" (`window.location`) para sair da ilha.
3. `legacy/pages/Checkout/Checkout.jsx:57` ainda usa
   `import.meta.env.VITE_MP_PUBLIC_KEY`. Não afeta o painel (não entra nesse
   bundle), mas quebrará do mesmo jeito que `api.js` quando o checkout for
   portado.

## Correção das imagens estáticas

No Vite, `import logo from "...jpeg"` devolvia uma string de URL; no Next
devolve um objeto `StaticImageData`. Como o legado usa `<img src={logo}>`, o
browser pedia `/[object Object]` — 404 real, observado no log do Next. Sendo o
painel registrado neste baseline como renderizando, isso é **regressão
introduzida pela conversão**, e foi corrigida dentro da Task 4.

Correção adotada: acessar `.src` no ponto de uso. Descartado
`images: { disableStaticImages: true }` no `next.config.mjs` — resolveria com
uma linha, mas desligaria o static import de imagem em todo o projeto,
inclusive na vitrine nova, que vai usar `next/image` com import estático para
obter `width`/`height` automáticos (requisito de CLS zero e LCP < 2s). Não
compensa trocar um bug visual de 2 arquivos por perda permanente de capacidade.

Arquivos alterados (só o acesso à propriedade; nenhum `next/image`, nenhuma
mudança de estilo ou refatoração em volta):

| arquivo | antes | depois |
|---|---|---|
| `legacy/pages/dashboard/Dashboard.jsx` | `<img src={LogoShopnaw} ...>` | `<img src={LogoShopnaw.src} ...>` |
| `legacy/components/Loading/Loading.jsx` | `<LogoImage src={logo} ...>` | `<LogoImage src={logo.src} ...>` |

**São exatamente estes dois no grafo do painel**, confirmado por três vias: (a)
o único asset emitido no chunk da ilha é `static/media/novalogo.c51610a9.jpeg`;
(b) varredura de `src={...}` em todo `legacy/` — os demais usos dentro do painel
(`AddedShirts.jsx`, `Form.jsx`, `Orders.jsx`, `UpdateInfo.jsx`) recebem URL de
runtime vindo da API ou de estado, não de import estático; (c) os outros
arquivos com import estático de imagem (`Header.jsx`, `Banner.jsx`,
`LoginForm.jsx`, `SignUpForm.jsx`, `Cart.jsx`, `Home.jsx`) pertencem só à
vitrine antiga, que será substituída — não foram tocados.

Verificação (Chrome headless, mesma técnica de DOM usada acima, com a cópia sem
guard para o painel chegar a renderizar):

- `object Object` no DOM: **0 ocorrências** em `/dashboard`, `/dashboard/orders`
  e `/dashboard/settings/offers` (antes: logo quebrado nas três).
- `src` do logo agora: `/_next/static/media/novalogo.c51610a9.jpeg`.
- O asset responde `200 image/jpeg` (7595 bytes).
- Requisições a `/[object Object]` no log do Next: **0** (antes: 404).
- As 8 rotas seguem `200`, `next build` compila, zero erro de módulo.

## O que continua não verificado

Segue **sem** verificação autenticada real: não há banco, logo não há login nem
sessão de admin, e todas as chamadas de API falham com `Failed to fetch`. O que
está provado é que as rotas existem, os bundles carregam e executam, os
componentes montam e a navegação funciona. O comportamento das telas **com
dados** continua não testado.
