# Baseline do painel administrativo (`/dashboard`) — pré-conversão

Data: 2026-08-13
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
