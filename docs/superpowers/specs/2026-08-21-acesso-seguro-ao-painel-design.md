# Acesso seguro ao painel — desenho

**Data:** 2026-08-21
**Estado:** aprovado pelo dono do projeto, incluindo spec e plano.

---

## O problema medido

`/dashboard` não tem barreira nenhuma no servidor. A rota é pública, devolve uma
casca vazia, e **quem você é só é decidido no navegador**, depois de baixar o
painel inteiro.

Sequência real, para qualquer visitante — logado ou não:

1. `app/dashboard/[[...rota]]/page.tsx` monta a ilha com
   `dynamic(..., { ssr: false })`. Nada útil renderiza no servidor.
2. O navegador baixa o SPA legado: `react-router-dom`, `styled-components`,
   `framer-motion`, `react-toastify` + CSS, `lucide-react`, `recharts`, mais os
   quatro provedores de contexto.
3. Ao montar, três provedores disparam requisições **antes de saber quem é**:
   `GET /config` (`configContextProvider.jsx:15`), `GET /promotions`
   (`promotionsContextProvider.jsx`) e a lista de produtos
   (`productContextProvider.jsx`).
4. Só então o `AuthProvider` (`authContextProvider.jsx:54-74`) roda
   `recuperarSessao()` → `getSession()` → e, havendo sessão, `lerPapel()`
   (`lib/conta/sessao.ts:250`), que é **outra** ida à rede para consultar
   `canastra.admins`.
5. `initialized` vira `true`, o `AdminRoutes` (`legacy/routes/AdminRoutes.jsx:31`)
   decide e chama `window.location.replace(...)` — navegação **dura**, que
   descarta tudo o que acabou de ser baixado e faz o navegador carregar a
   vitrine do zero.

### Os três sintomas são esta arquitetura

| Sintoma relatado | Causa |
|---|---|
| "demora muito para carregar" | um aplicativo inteiro + 3 requisições inúteis + 1 ida ao GoTrue + 1 ida ao PostgREST, tudo antes de a decisão existir; depois, uma navegação dura que carrega um **segundo** aplicativo |
| "aparece um loading de outra marca" | `legacy/components/Loading/Loading.jsx` traz a logo antiga e escreve **"Carregando produtos para você"** — a tela de espera da loja anterior, exibida no painel. Nenhuma onda anterior era dona do arquivo |
| "sou redirecionado para /account/login" | `AdminRoutes.jsx:36` manda para o login **do cliente**, por desenho |

### O problema de segurança embutido

O pacote inteiro do painel é servido a **qualquer visitante anônimo**. Os dados
estão protegidos (RLS no banco, `isAdmin` em cada rota do Express), mas o código
do painel, sua estrutura e a superfície de API que ele conhece são públicos.
Registrado em `docs/producao.md` §1.1 como pendência da F6.

---

## O desenho

### 1. Guard no servidor

`app/dashboard/[[...rota]]/page.tsx` deixa de ser `"use client"` e vira Server
Component. Ele confere sessão e papel **antes de emitir qualquer byte do
painel**, e delega a ilha a um componente cliente filho.

A decisão mora em `lib/conta/painel-servidor.ts`, fonte única:

- sem sessão → `redirect("/dashboard/entrar?de=<rota pedida>")`;
- com sessão, sem linha em `canastra.admins` → `redirect("/account?painel=negado")`;
- **falha ao consultar o banco → trata como não-admin** e manda para
  `/dashboard/entrar` com aviso honesto. É a mesma regra de `lerPapel()`
  (`sessao.ts:260-270`): melhor um gestor recarregando a página do que a área de
  gestão aberta por causa de uma rede ruim.

`/dashboard/entrar` fica naturalmente fora do guard — no Next, rota específica
vence catch-all opcional.

### 2. Página de entrada exclusiva

`app/dashboard/entrar/page.tsx`. Está fora do grupo `(vitrine)`, então já não
herda cabeçalho e rodapé da loja: identidade própria e sóbria, com os tokens da
casa.

- Server Component decide o que mostrar: **já é admin** → vai direto ao painel
  (ou ao `?de=`), sem formulário inútil; **logado como cliente** → explica que
  aquela conta não é de gestor e oferece sair; **anônimo** → o formulário.
- Formulário é ilha cliente: e-mail, senha, `entrar()` de `lib/conta/sessao.ts`
  (que já traduz erro do GoTrue por código), link para recuperação de senha.
- **Sem link de criar conta.** Conta de gestor nasce pelo seed ou pela
  `service_role` — nunca por auto-cadastro.
- `?de=` passa por `destinoSeguro()` **e** por uma trava adicional: no login do
  painel, só destino que comece com `/dashboard` é aceito. O login do gestor não
  serve de trampolim para lugar nenhum.

### 3. A tela de carregamento

`legacy/components/Loading/Loading.jsx` deixa de mostrar a marca antiga e de
dizer "Carregando produtos para você", e deixa de carregar a logo antiga. Vira o carregamento do
painel, com a identidade do Café Canastra.

### 4. Segunda camada preservada

`AdminRoutes` continua onde está, como defesa em profundidade — se a sessão
morrer com o painel já aberto, ele ainda pega. Só muda o destino para
`/dashboard/entrar`.

### 5. Ganho colateral

Com o guard no servidor, quando a ilha monta a pessoa **já é** administradora:
as três requisições dos provedores deixam de ser desperdício e deixam de sair
em nome de anônimo.

---

## O que este desenho NÃO faz

**Não mexe no `middleware.ts`.** Ele continua sem guardar rota, pelo motivo
documentado lá (linhas 27-33): `/account/verify-email` e
`/account/reset-password` recebem o `?code=` do GoTrue **ainda sem sessão**, e um
guard global mandaria as duas para o login antes de o navegador trocar o código
pela sessão — quebrando confirmação de e-mail e recuperação de senha de uma vez
só. O guard do painel é local ao painel.

**Não reescreve o painel.** A F6 (painel novo em App Router) continua pendente e
fora de escopo. Isto é a cerca, não a casa.

---

## Testes

O Vitest do projeto roda em ambiente `node`, sem jsdom — o padrão da casa é
testar módulos puros. Então:

- a decisão do guard vira função pura: `(temSessao, ehAdmin, falhouConsulta,
  rotaPedida) → destino | "pode entrar"`, com caso para cada combinação,
  incluindo a falha de consulta caindo para o lado seguro;
- a trava do `?de=` restrita a `/dashboard` ganha teste próprio, com os mesmos
  vetores que `destinoSeguro` já cobre (`//evil.com`, `/\evil.com`, absoluta) e
  mais o caso novo (`/account` recusado, `/dashboard/orders` aceito);
- o Server Component em si é verificado por `tsc` e pela navegação real.

## Critério de pronto

- Visitante anônimo em `/dashboard` **não recebe** o pacote do painel.
- Nenhuma tela mostra a marca antiga ou diz "Carregando produtos para você".
- Gestor entra por `/dashboard/entrar` e cai na rota que pediu.
- Cliente logado que abre `/dashboard` entende por que não entrou.
- `npm --prefix frontend run test` e `npx tsc --noEmit` verdes.
