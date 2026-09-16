# Conexão com o Bling pelo painel — plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Uma tela em `/dashboard/bling` que conecta a loja ao Bling por OAuth sem editar `.env` e sem deploy — cola-se Client ID e Secret, clica-se Conectar, e a loja volta conectada.

**Architecture:** As credenciais e o liga/desliga passam a morar em `canastra.config_loja`, ao lado do refresh token que já mora lá desde a migração 0012; a leitura é sempre **banco → env**, com `NULL` significando "use a env". O botão Conectar faz redirect de página inteira ao Bling e volta por um callback público protegido por `state` de uso único.

**Tech Stack:** Node 22 + Express (backend, CommonJS), Next 15 + React + TypeScript (frontend), PostgreSQL (Supabase Cloud), `node --test` + `embedded-postgres` (testes).

**Spec:** `docs/superpowers/specs/2026-09-16-conexao-bling-design.md`

---

## O CONTRATO DAS ROTAS — fixado aqui para frontend e backend andarem em paralelo

Nenhuma tarefa pode divergir disto. Quem implementar o frontend não precisa esperar o backend, e vice-versa.

```
GET /bling/status                       (isAuthenticated + isAdmin)
→ 200 {
    ativo: boolean,             // já existe
    nfeAuto: boolean,           // já existe
    rastreioCron: boolean,      // já existe
    configurado: boolean,       // já existe — credencial presente
    token: { ok: boolean, erro?: string },   // já existe
    temCredenciais: boolean,    // NOVO — client id E secret presentes
    conectado: boolean          // NOVO — há refresh token gravado
  }

POST /bling/conexao/credenciais         (isAuthenticated + isAdmin)
  body: { clientId: string, clientSecret: string }
→ 200 { salvo: true }
→ 400 { error: "CREDENCIAIS_INVALIDAS", message: "Informe o Client ID e o Client Secret do aplicativo criado no Bling." }

POST /bling/conexao/iniciar             (isAuthenticated + isAdmin)
→ 200 { url: "https://www.bling.com.br/Api/v3/oauth/authorize?response_type=code&client_id=...&state=..." }
→ 409 { error: "SEM_CREDENCIAIS", message: "Salve o Client ID e o Client Secret antes de conectar." }

GET /bling/callback?code=&state=        (PÚBLICO — protegido pelo state)
→ 302 Location: /dashboard/bling?conectado=1
→ 302 Location: /dashboard/bling?erro=<frase url-encoded>

POST /bling/conexao/ativo               (isAuthenticated + isAdmin)
  body: { ativo: boolean }
→ 200 { ativo: boolean }
→ 409 { error: "SEM_CONEXAO", message: "Conecte a loja ao Bling antes de ligar a integração." }

DELETE /bling/conexao                   (isAuthenticated + isAdmin)
→ 200 { desconectado: true }
```

**O redirect do callback é RELATIVO** (`/dashboard/bling?...`), não absoluto. Traefik serve vitrine e API na mesma origem (`loja.canastrainteligencia.com`), então o navegador resolve sozinho — e assim não é preciso inventar uma env `FRONTEND_URL` que hoje não existe.

---

## Ondas de execução

| Onda | Tarefas | Podem rodar em paralelo? |
|---|---|---|
| 1 | A1, A2, A3, A4 | **sim** — arquivos disjuntos |
| 2 | B1, C1 | **sim** |
| 3 | B2 | depende de B1 |
| 4 | B3 | depende de B2 |

---

## Onda 1

### Task A1: A migração 0039

**Files:**
- Create: `backend/db/migrations/0039_bling_config.sql`

- [ ] **Step 1: Escrever a migração**

```sql
-- Conexao com o Bling pelo painel: as credenciais do app e o liga/desliga saem
-- da variavel de ambiente e vao para o banco, ao lado do refresh token que ja
-- mora aqui desde a 0012.
--
-- POR QUE NAO HA `REVOKE` NESTA MIGRACAO. A 0012 revogou o SELECT de TABELA em
-- `config_loja` e devolveu uma LISTA EXPLICITA de colunas a anon/authenticated.
-- Privilegio de coluna no Postgres nao se estende a coluna nova: estas tres ja
-- nascem invisiveis ao PostgREST sem uma linha a mais. Repetir o REVOKE aqui
-- daria a impressao de que a protecao vem deste arquivo — ela vem da 0012, e
-- quem mexer la precisa saber que estas colunas dependem disso.
--
-- `bling_ativo` E NULLABLE, E O NULL QUER DIZER "NAO DECIDIDO — USE A ENV".
-- Com `NOT NULL DEFAULT false` o banco passaria a mandar em TODA instalacao no
-- instante da migracao, e um `BLING_ATIVO=true` no .env de alguem viraria letra
-- morta em silencio. Com NULL, quem nunca abrir a tela continua exatamente como
-- estava — e os 22 casos de f7_bling.test.js seguem passando sem alteracao.
-- E a mesma logica de precedencia que `carregarRefreshToken` ja usa: banco
-- quando ha resposta, env quando nao ha.
--
-- `bling_client_secret` e segredo de verdade (emite nota fiscal e mexe em
-- estoque). `bling_client_id` nao e segredo no sentido estrito, mas fica no
-- mesmo regime: nao ha caso de uso para a vitrine le-lo, e expor metade de um
-- par de credenciais so ajuda quem esta tentando adivinhar a outra metade.
ALTER TABLE canastra.config_loja
  ADD COLUMN bling_client_id     text,
  ADD COLUMN bling_client_secret text,
  ADD COLUMN bling_ativo         boolean;
```

- [ ] **Step 2: Conferir que o runner aceita o arquivo**

Run: `cd /srv/loja-cafecanastra && node -e "const m=require('./backend/db/migrar.js')" 2>&1 | head -3`
Expected: sem erro de sintaxe (o módulo só carrega; não conecta).

Run: `ls backend/db/migrations/ | tail -3`
Expected: `0039_bling_config.sql` como último.

- [ ] **Step 3: Commit**

```bash
cd /srv/loja-cafecanastra
git add backend/db/migrations/0039_bling_config.sql
git commit -m "feat(bling): a migracao que tira as credenciais da env"
```

---

### Task A2: A lógica da tela, sem React

**Files:**
- Create: `frontend/lib/painel/bling/conexao.logica.ts`
- Test: `frontend/lib/painel/bling/conexao.logica.test.ts`

Este corte é o mesmo que `contrato.ts` já faz no mesmo diretório: a lógica que decide o que o gestor lê vive sem React e sem `fetch`, e é a única parte da tela testável sem navegador.

- [ ] **Step 1: Escrever o teste que falha**

```ts
import { describe, expect, it } from "vitest";
import {
  ESCOPOS_DO_APP,
  URL_DE_CALLBACK,
  estadoDaConexao,
  mensagemDoRetorno,
} from "./conexao.logica";

describe("estadoDaConexao", () => {
  it("sem credenciais, pede o formulário", () => {
    const e = estadoDaConexao({ temCredenciais: false, conectado: false, ativo: false });
    expect(e.chave).toBe("sem_credenciais");
  });

  it("com credenciais e sem conexão, oferece Conectar", () => {
    const e = estadoDaConexao({ temCredenciais: true, conectado: false, ativo: false });
    expect(e.chave).toBe("desconectado");
  });

  it("conectado e desligado avisa que falta ligar", () => {
    const e = estadoDaConexao({ temCredenciais: true, conectado: true, ativo: false });
    expect(e.chave).toBe("conectado_desligado");
  });

  it("conectado e ligado é o estado final", () => {
    const e = estadoDaConexao({ temCredenciais: true, conectado: true, ativo: true });
    expect(e.chave).toBe("ligado");
  });

  it("status ausente não quebra — trata como sem credenciais", () => {
    expect(estadoDaConexao(null).chave).toBe("sem_credenciais");
  });
});

describe("mensagemDoRetorno", () => {
  it("reconhece o sucesso do callback", () => {
    const m = mensagemDoRetorno(new URLSearchParams("conectado=1"));
    expect(m).toEqual({ tipo: "sucesso", texto: expect.stringContaining("conectada") });
  });

  it("devolve a frase do servidor INTEIRA, sem reescrever", () => {
    const frase = "O Bling recusou: o code expirou. Clique em Conectar de novo.";
    const m = mensagemDoRetorno(new URLSearchParams(`erro=${encodeURIComponent(frase)}`));
    expect(m).toEqual({ tipo: "erro", texto: frase });
  });

  it("sem parâmetro, não mostra nada", () => {
    expect(mensagemDoRetorno(new URLSearchParams(""))).toBeNull();
  });
});

describe("os escopos e a URL de callback são os do runbook", () => {
  it("Produtos é o único sem escrita", () => {
    const produtos = ESCOPOS_DO_APP.find((e) => e.recurso === "Produtos");
    expect(produtos?.escrita).toBe(false);
    expect(ESCOPOS_DO_APP.filter((e) => e.escrita)).toHaveLength(3);
  });

  it("a URL de callback aponta para a API, não para a vitrine", () => {
    expect(URL_DE_CALLBACK).toBe(
      "https://loja.canastrainteligencia.com/api/bling/callback",
    );
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `cd /srv/loja-cafecanastra/frontend && TZ=UTC npx vitest run lib/painel/bling/conexao.logica.test.ts`
Expected: FAIL — `Failed to resolve import "./conexao.logica"`.

- [ ] **Step 3: Implementar**

```ts
/**
 * A lógica da tela de conexão com o Bling — SEM React, SEM fetch.
 *
 * Mesmo corte de `contrato.ts`, o vizinho deste arquivo: o que o gestor LÊ
 * (em que estado a conexão está, que frase mostrar quando o callback volta com
 * erro) mora aqui, e é a única parte da tela que dá para testar sem navegador.
 */

/** O que `GET /bling/status` devolve, na parte que esta tela usa. */
export type StatusDaConexao = {
  temCredenciais?: boolean;
  conectado?: boolean;
  ativo?: boolean;
  token?: { ok?: boolean; erro?: string } | null;
};

/**
 * A URL que se cola no campo "URL de redirecionamento" do app no Bling.
 *
 * É a da API (`/api/...`), NÃO a da vitrine: o `client_secret` entra na troca
 * do `code` pelos tokens, e num callback de página ele teria que chegar ao
 * navegador. Traefik roteia `/api/*` para o Express removendo o prefixo, então
 * isto chega lá como `GET /bling/callback`.
 *
 * Constante, e não montada de `window.location`: o Bling não aceita
 * `redirect_uri` como parâmetro — ele usa a que está CADASTRADA no app. A
 * string tem que bater caractere por caractere, e derivá-la do navegador faria
 * ela mudar em ambiente de teste sem ninguém perceber.
 */
export const URL_DE_CALLBACK =
  "https://loja.canastrainteligencia.com/api/bling/callback";

/**
 * Os escopos a marcar ao criar o aplicativo, conferidos contra as chamadas
 * reais de `backend/src/services/blingPedidos.js` — não contra o runbook.
 *
 * Produtos é o único sem escrita: a loja nunca cria produto no Bling, só
 * confere se o SKU existe antes de montar o pedido de venda. Marcar escrita ali
 * daria à integração um poder que ela não exerce.
 */
export const ESCOPOS_DO_APP = Object.freeze([
  Object.freeze({
    recurso: "Contatos",
    escrita: true,
    porque: "busca o cliente por CPF e cria quando não existe",
  }),
  Object.freeze({
    recurso: "Produtos",
    escrita: false,
    porque: "confere cada SKU do pedido antes de criar qualquer coisa",
  }),
  Object.freeze({
    recurso: "Pedidos de Venda",
    escrita: true,
    porque: "cria o pedido de venda e lê o rastreio de volta",
  }),
  Object.freeze({
    recurso: "Notas Fiscais Eletrônicas",
    escrita: true,
    porque: "gera a NF-e, transmite à SEFAZ e confere a autorização",
  }),
]);

export type ChaveDoEstado =
  | "sem_credenciais"
  | "desconectado"
  | "conectado_desligado"
  | "ligado";

/**
 * Em que passo da conexão a loja está.
 *
 * A ordem das perguntas é a ordem em que as coisas acontecem, e é a única que
 * não mente: sem credencial não há o que autorizar; sem autorização não há o
 * que ligar. Cada estado mostra UMA ação — a próxima — em vez de quatro botões
 * dos quais três recusariam.
 */
export function estadoDaConexao(status?: StatusDaConexao | null) {
  const s = status || {};

  if (!s.temCredenciais) {
    return {
      chave: "sem_credenciais" as ChaveDoEstado,
      titulo: "Aplicativo do Bling ainda não cadastrado",
      detalhe:
        "Crie o aplicativo no Bling com os escopos abaixo e cole aqui o " +
        "Client ID e o Client Secret.",
      cor: "#b3261e",
    };
  }

  if (!s.conectado) {
    return {
      chave: "desconectado" as ChaveDoEstado,
      titulo: "Credenciais salvas — falta autorizar",
      detalhe:
        "Clique em Conectar para autorizar a loja na sua conta Bling. Você " +
        "volta para esta tela em seguida.",
      cor: "#f57c00",
    };
  }

  if (!s.ativo) {
    return {
      chave: "conectado_desligado" as ChaveDoEstado,
      titulo: "Conectada, mas desligada",
      detalhe:
        "A autorização está válida e nada é enviado ao Bling enquanto a " +
        "integração estiver desligada. Ligue quando quiser que os pedidos " +
        "aprovados virem pedido de venda no ERP.",
      cor: "#1976d2",
    };
  }

  return {
    chave: "ligado" as ChaveDoEstado,
    titulo: "Integração ligada",
    detalhe:
      "Pedido aprovado vira pedido de venda no Bling automaticamente.",
    cor: "#00796b",
  };
}

export type MensagemDoRetorno = { tipo: "sucesso" | "erro"; texto: string };

/**
 * O que o callback trouxe de volta na URL.
 *
 * A frase de erro é repassada INTEIRA. É a mesma regra de `fraseDeErro` em
 * `contrato.ts`: o diagnóstico está na frase do servidor — qual credencial
 * falhou, que o `code` expirou, o que o Bling respondeu —, e trocá-la por
 * "erro ao conectar" joga fora exatamente o que resolveria o problema.
 */
export function mensagemDoRetorno(
  parametros: URLSearchParams,
): MensagemDoRetorno | null {
  const erro = parametros.get("erro");
  if (erro) return { tipo: "erro", texto: erro };
  if (parametros.get("conectado")) {
    return {
      tipo: "sucesso",
      texto: "A loja foi conectada ao Bling.",
    };
  }
  return null;
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `cd /srv/loja-cafecanastra/frontend && TZ=UTC npx vitest run lib/painel/bling/conexao.logica.test.ts`
Expected: PASS, 8 casos.

- [ ] **Step 5: Commit**

```bash
cd /srv/loja-cafecanastra
git add frontend/lib/painel/bling/conexao.logica.ts frontend/lib/painel/bling/conexao.logica.test.ts
git commit -m "feat(bling): a logica da tela de conexao, sem React"
```

---

### Task A3: O item de menu

**Files:**
- Modify: `frontend/components/painel/casca/menu.logica.ts` (grupo "Gerir")
- Test: o teste existente de menu (descobrir com `ls frontend/components/painel/casca/*.test.*`)

- [ ] **Step 1: Ver o teste que já existe**

Run: `cd /srv/loja-cafecanastra/frontend && ls components/painel/casca/ && grep -rn "MENU" components/painel/casca/*.test.* | head -5`
Expected: encontra o arquivo de teste que exercita `MENU`/`itemAtivo`.

- [ ] **Step 2: Acrescentar o caso ao teste existente**

No arquivo de teste encontrado, acrescente:

```ts
it("a tela do Bling está no menu, em Gerir", () => {
  const gerir = MENU.find((g) => g.titulo === "Gerir");
  expect(gerir?.itens.map((i) => i.href)).toContain("/dashboard/bling");
});

it("a tela do Bling acende quando se está nela", () => {
  expect(itemAtivo("/dashboard/bling")).toBe("/dashboard/bling");
});
```

- [ ] **Step 3: Rodar e ver falhar**

Run: `cd /srv/loja-cafecanastra/frontend && TZ=UTC npx vitest run components/painel/casca/`
Expected: FAIL — o array de Gerir não contém `/dashboard/bling`.

- [ ] **Step 4: Acrescentar o item**

Em `menu.logica.ts`, no grupo `Gerir`, **entre** "Administradores" e "Ajustes":

```ts
      /*
        BLING AO LADO DE AJUSTES, e nao em "Vender". A tela nao opera venda:
        ela liga a loja ao ERP, e depois de ligada ninguem volta nela por meses
        — e configuracao, que e o que este grupo guarda. Quem trabalha o Bling
        no dia a dia faz isso pelo bloco do Bling dentro de cada pedido, em
        Pedidos.
      */
      { rotulo: "Bling (ERP e NF-e)", href: "/dashboard/bling" },
```

- [ ] **Step 5: Rodar e ver passar**

Run: `cd /srv/loja-cafecanastra/frontend && TZ=UTC npx vitest run components/painel/casca/`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
cd /srv/loja-cafecanastra
git add frontend/components/painel/casca/
git commit -m "feat(bling): a tela ganha porta de entrada no menu"
```

---

### Task A4: O runbook para de mentir

**Files:**
- Modify: `docs/bling.md` (a seção "Onde ficam os botões, no painel da loja", e as seções 1, 2 e 5)
- Modify: `backend/src/.env.example` (as linhas `BLING_*`)

O runbook descreve hoje uma tela `/dashboard/bling` com fila paginada e filtros que **não existe** — ela não sobreviveu à Onda 7. Esta tarefa alinha o documento com o que existe e com o que esta entrega acrescenta.

- [ ] **Step 1: Corrigir a descrição da tela**

Em `docs/bling.md`, na seção "Onde ficam os botões, no painel da loja", substitua a descrição de `/dashboard/bling` por:

```markdown
**`/dashboard/bling`** — no menu lateral, em *Gerir* → **"Bling (ERP e NF-e)"**.
É a tela de CONEXÃO:

- **Cadastro do aplicativo** — os escopos a marcar no Bling e a URL de
  redirecionamento a colar lá, com os campos de Client ID e Client Secret.
- **Conectar** — abre a autorização do Bling e traz a loja de volta conectada.
  O refresh token é gravado no banco; nada passa pelo `.env`.
- **Liga/desliga** e **Desconectar**.

A FILA DE PEDIDOS QUE ESTE RUNBOOK DESCREVIA NÃO EXISTE. Ela foi apagada com o
painel legado na Onda 7 e ainda não foi reconstruída — a lógica dela
(`frontend/lib/painel/bling/contrato.ts`) sobreviveu inteira, só falta a tela.
Enquanto isso, as três ações por pedido vivem no bloco **"Bling (ERP e NF-e)"**
dentro do modal de detalhe de um pedido, em **Pedidos**.
```

- [ ] **Step 2: Reescrever as seções 1, 2 e 5 para o fluxo novo**

Na seção 1, troque a URL de redirecionamento sugerida por
`https://loja.canastrainteligencia.com/api/bling/callback` e acrescente:

```markdown
Esta URL é a da **API**, não a da vitrine. O `client_secret` entra na troca do
`code` pelos tokens: num callback de página ele teria que chegar ao navegador.
Cole exatamente assim — o Bling não aceita `redirect_uri` como parâmetro, ele
usa a cadastrada, e a string tem que bater caractere por caractere.
```

Na seção 2, substitua o passo a passo do `curl` por:

```markdown
## 2. Conectar pelo painel

Não há mais `curl`, nem `code` copiado da barra de endereço com um cronômetro
de um minuto correndo.

1. Abra **`/dashboard/bling`** no painel (menu *Gerir*).
2. Cole o **Client ID** e o **Client Secret** e salve.
3. Clique em **Conectar**. Você vai para o Bling, autoriza com a conta da loja,
   e volta para esta tela já conectado.
4. Ligue a integração no interruptor da própria tela.

O refresh token é gravado em `canastra.config_loja.bling_refresh_token`, e o
rodízio segue como sempre foi (o serviço regrava a cada renovação). O `.env`
não é mais tocado: `BLING_CLIENT_ID`, `BLING_CLIENT_SECRET`,
`BLING_REFRESH_TOKEN` e `BLING_ATIVO` continuam sendo lidos, mas só como
FALLBACK de quem já os tinha preenchidos — o banco tem precedência.
```

Na seção 5, troque "Suba o backend com `BLING_ATIVO=true`" por "Ligue a
integração no interruptor de `/dashboard/bling`".

- [ ] **Step 3: Marcar as variáveis como fallback no `.env.example`**

Em `backend/src/.env.example`, acima do bloco `BLING_*`:

```bash
# DESDE A TELA DE CONEXAO (/dashboard/bling), ESTAS QUATRO SAO FALLBACK.
# O caminho normal e o painel: as credenciais e o liga/desliga moram em
# canastra.config_loja, e o banco TEM PRECEDENCIA sobre o que estiver aqui.
# Preencher abaixo so importa para instalacao que nunca abriu a tela.
```

- [ ] **Step 4: Conferir que nada mais aponta para a tela fantasma**

Run: `cd /srv/loja-cafecanastra && grep -rn "dashboard/bling" docs/ | grep -v "docs/superpowers"`
Expected: só as menções corrigidas acima; nenhuma promete fila ou filtros.

- [ ] **Step 5: Commit**

```bash
cd /srv/loja-cafecanastra
git add docs/bling.md backend/src/.env.example
git commit -m "docs(bling): o runbook para de descrever uma tela que nao existe"
```

---

## Onda 2

### Task B1: A config sai da env e vai para o banco

**Files:**
- Modify: `backend/src/services/blingClient.js`
- Test: `backend/test/f8_bling_conexao.test.js` (criar)

**Depende de:** A1 (as colunas precisam existir para o teste rodar).

- [ ] **Step 1: Ver como f7 monta o banco de teste**

Run: `cd /srv/loja-cafecanastra/backend && sed -n '1,60p' test/f7_bling.test.js && sed -n '1,40p' test/ajuda/postgres.js`
Expected: entender o helper de `embedded-postgres` para reusá-lo idêntico. **Não invente um segundo jeito de subir banco de teste.**

- [ ] **Step 2: Escrever o teste que falha**

Crie `backend/test/f8_bling_conexao.test.js` usando o MESMO helper que f7 usa:

```js
const test = require("node:test");
const assert = require("node:assert/strict");
// ... o mesmo require do helper de postgres que f7_bling.test.js usa ...

test("carregarConfig: o banco tem precedencia sobre a env", async () => {
  process.env.BLING_CLIENT_ID = "id-da-env";
  process.env.BLING_CLIENT_SECRET = "segredo-da-env";
  await pool.query(
    `INSERT INTO canastra.config_loja (id, bling_client_id, bling_client_secret)
     VALUES (1, 'id-do-banco', 'segredo-do-banco')
     ON CONFLICT (id) DO UPDATE SET bling_client_id = EXCLUDED.bling_client_id,
                                    bling_client_secret = EXCLUDED.bling_client_secret`,
  );
  blingClient.zerarCacheParaTeste();

  const config = await blingClient.carregarConfig();
  assert.equal(config.clientId, "id-do-banco");
  assert.equal(config.clientSecret, "segredo-do-banco");
});

test("carregarConfig: sem linha no banco, cai na env", async () => {
  process.env.BLING_CLIENT_ID = "id-da-env";
  process.env.BLING_CLIENT_SECRET = "segredo-da-env";
  await pool.query(
    `UPDATE canastra.config_loja
        SET bling_client_id = NULL, bling_client_secret = NULL WHERE id = 1`,
  );
  blingClient.zerarCacheParaTeste();

  const config = await blingClient.carregarConfig();
  assert.equal(config.clientId, "id-da-env");
  assert.equal(config.clientSecret, "segredo-da-env");
});

test("carregarConfig: bling_ativo NULL quer dizer 'use a env'", async () => {
  process.env.BLING_ATIVO = "true";
  await pool.query("UPDATE canastra.config_loja SET bling_ativo = NULL WHERE id = 1");
  blingClient.zerarCacheParaTeste();
  assert.equal((await blingClient.carregarConfig()).ativo, true);

  process.env.BLING_ATIVO = "false";
  blingClient.zerarCacheParaTeste();
  assert.equal((await blingClient.carregarConfig()).ativo, false);
});

test("carregarConfig: bling_ativo=false no banco VENCE a env ligada", async () => {
  process.env.BLING_ATIVO = "true";
  await pool.query("UPDATE canastra.config_loja SET bling_ativo = false WHERE id = 1");
  blingClient.zerarCacheParaTeste();
  assert.equal((await blingClient.carregarConfig()).ativo, false);
});

test("configurado() responde pelo que ha no banco", async () => {
  delete process.env.BLING_CLIENT_ID;
  delete process.env.BLING_CLIENT_SECRET;
  await pool.query(
    `UPDATE canastra.config_loja
        SET bling_client_id = 'id', bling_client_secret = 'segredo' WHERE id = 1`,
  );
  blingClient.zerarCacheParaTeste();
  assert.equal(await blingClient.configurado(), true);
});
```

- [ ] **Step 3: Rodar e ver falhar**

Run: `cd /srv/loja-cafecanastra/backend && node --test test/f8_bling_conexao.test.js 2>&1 | tail -15`
Expected: FAIL — `blingClient.carregarConfig is not a function`.

> Se falhar com `Cannot find module 'embedded-postgres'`, rode antes
> `cd /srv/loja-cafecanastra/backend && npm install` (a VPS instalou sem
> devDependencies). Isso **não** é falha do código.

- [ ] **Step 4: Implementar em `blingClient.js`**

Acrescente perto do topo, junto das outras constantes:

```js
/**
 * Validade do cache da config. A invalidacao explicita (`zerarCacheParaTeste`,
 * e o `esquecerConfig` que as rotas de conexao chamam ao gravar) e quem faz o
 * trabalho; este TTL e so a rede de seguranca para uma invalidacao esquecida.
 * Trinta segundos e o atraso maximo entre desligar a integracao na tela e o
 * gatilho de pedido aprovado parar de agir — aceitavel, e sem ele um bug de
 * invalidacao viraria "desliguei e continua sincronizando" para sempre.
 */
const CACHE_DA_CONFIG_MS = 30_000;
```

Acrescente a `memoria` (onde já ficam `accessToken`/`refreshToken`) os campos
`config: null` e `configExpiraEm: 0`, e limpe-os em `zerarCacheParaTeste()`.

```js
/**
 * A configuracao vigente do Bling, na ordem BANCO -> ENV.
 *
 * Mesma ordem que `carregarRefreshToken` ja usa, e pelo mesmo motivo: o banco e
 * onde a tela de conexao escreve, a env e a semente de quem configurou antes de
 * a tela existir. Banco fora do ar cai na env em vez de derrubar — recusar aqui
 * so anteciparia a falha, e a env pode bastar.
 *
 * `ativo` merece atencao: NULL no banco NAO e `false`, e sim "nao decidido".
 * Um `bling_ativo IS NULL` cai na env; `false` gravado pela tela VENCE uma env
 * ligada. Sem essa distincao, a migracao 0039 desligaria em silencio toda
 * instalacao que tivesse BLING_ATIVO=true no .env.
 */
async function carregarConfig() {
  if (memoria.config && Date.now() < memoria.configExpiraEm) return memoria.config;

  let linha = {};
  try {
    const { rows } = await pool.query(
      `SELECT bling_client_id, bling_client_secret, bling_ativo, bling_refresh_token
         FROM canastra.config_loja WHERE id = 1`,
    );
    linha = rows[0] || {};
  } catch (erro) {
    console.warn(
      "Bling: não consegui ler a configuração do banco; usando a env.",
      erro.message,
    );
  }

  const config = {
    clientId: linha.bling_client_id || process.env.BLING_CLIENT_ID || null,
    clientSecret:
      linha.bling_client_secret || process.env.BLING_CLIENT_SECRET || null,
    ativo:
      linha.bling_ativo === null || linha.bling_ativo === undefined
        ? process.env.BLING_ATIVO === "true"
        : linha.bling_ativo === true,
    temRefreshToken: Boolean(
      linha.bling_refresh_token || process.env.BLING_REFRESH_TOKEN,
    ),
  };

  memoria.config = config;
  memoria.configExpiraEm = Date.now() + CACHE_DA_CONFIG_MS;
  return config;
}

/** Esquece a config cacheada. Chamado por quem ESCREVE (as rotas de conexão). */
function esquecerConfig() {
  memoria.config = null;
  memoria.configExpiraEm = 0;
}
```

Troque `configurado()` por:

```js
/** Credencial minima presente? (Sem ela, nada aqui tenta rede.) */
async function configurado() {
  const { clientId, clientSecret } = await carregarConfig();
  return Boolean(clientId && clientSecret);
}
```

Em `renovarAccessToken`, troque as duas leituras de `process.env`:

```js
  const config = await carregarConfig();
  if (!config.clientId || !config.clientSecret) {
    throw new Error(
      "Bling não configurado: cadastre o Client ID e o Client Secret em " +
        "/dashboard/bling.",
    );
  }
```

e

```js
  const basic = Buffer.from(
    `${config.clientId}:${config.clientSecret}`,
  ).toString("base64");
```

(Remova o `if (!configurado())` antigo do topo de `renovarAccessToken` — o novo
bloco acima o substitui, e `configurado()` agora é async.)

Em `sondar()`, troque `if (!configurado())` por `if (!(await configurado()))` e
a frase do erro para `"Client ID/Client Secret ausentes — cadastre em /dashboard/bling."`.

Acrescente `carregarConfig` e `esquecerConfig` ao `module.exports`.

- [ ] **Step 5: Rodar e ver passar**

Run: `cd /srv/loja-cafecanastra/backend && node --test test/f8_bling_conexao.test.js 2>&1 | tail -10`
Expected: PASS, 5 casos.

- [ ] **Step 6: Conferir que f7 NÃO regrediu — este é o critério da decisão do NULL**

Run: `cd /srv/loja-cafecanastra/backend && node --test test/f7_bling.test.js 2>&1 | tail -10`
Expected: PASS, 22 casos, **sem nenhuma alteração no arquivo**.

- [ ] **Step 7: Commit**

```bash
cd /srv/loja-cafecanastra
git add backend/src/services/blingClient.js backend/test/f8_bling_conexao.test.js
git commit -m "feat(bling): a config passa a vir do banco, com a env de reserva"
```

---

### Task C1: A tela

**Files:**
- Create: `frontend/app/dashboard/(protegido)/bling/page.tsx`
- Test: `frontend/app/dashboard/(protegido)/bling/page.test.tsx`

**Depende de:** A2 (a lógica). **Não depende do backend** — o contrato está fixado no topo deste plano.

- [ ] **Step 1: Ler duas telas existentes para copiar o padrão**

Run: `cd /srv/loja-cafecanastra/frontend && sed -n '1,80p' "app/dashboard/(protegido)/ajustes/page.tsx"`
Run: `cd /srv/loja-cafecanastra/frontend && sed -n '1,60p' "app/dashboard/(protegido)/ajustes/page.test.tsx"`
Expected: entender como a tela chama a API (`chamarApi` ou equivalente), como usa `EstadoDaTela`, `Ficha`, `Botao`, `Tarja`, e como o teste monta o dublê de fetch. **Siga esse padrão exatamente; não introduza um segundo jeito.**

- [ ] **Step 2: Escrever o teste que falha**

```tsx
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import Pagina from "./page";

// O dublê de fetch segue o padrão de ajustes/page.test.tsx — copie-o de lá.

describe("tela de conexão com o Bling", () => {
  it("sem credenciais, mostra o formulário e os escopos", async () => {
    // status: { temCredenciais: false, conectado: false, ativo: false }
    render(<Pagina />);
    expect(await screen.findByLabelText(/client id/i)).toBeInTheDocument();
    expect(screen.getByText(/Notas Fiscais Eletrônicas/)).toBeInTheDocument();
    expect(
      screen.getByText("https://loja.canastrainteligencia.com/api/bling/callback"),
    ).toBeInTheDocument();
  });

  it("com credenciais e sem conexão, o botão Conectar leva ao Bling", async () => {
    // status: { temCredenciais: true, conectado: false }
    // POST /bling/conexao/iniciar → { url: "https://www.bling.com.br/..." }
    const irPara = vi.fn();
    render(<Pagina aoNavegar={irPara} />);
    await userEvent.click(await screen.findByRole("button", { name: /conectar/i }));
    await waitFor(() =>
      expect(irPara).toHaveBeenCalledWith(
        expect.stringContaining("bling.com.br/Api/v3/oauth/authorize"),
      ),
    );
  });

  it("o erro que o callback trouxe aparece INTEIRO", async () => {
    // window.location.search = "?erro=O%20Bling%20recusou%3A%20o%20code%20expirou."
    render(<Pagina />);
    expect(
      await screen.findByText("O Bling recusou: o code expirou."),
    ).toBeInTheDocument();
  });

  it("conectado, oferece desligar e desconectar", async () => {
    // status: { temCredenciais: true, conectado: true, ativo: true }
    render(<Pagina />);
    expect(await screen.findByRole("button", { name: /desconectar/i })).toBeInTheDocument();
    expect(screen.getByRole("switch")).toBeChecked();
  });

  it("um clique tranca o botão até a resposta chegar", async () => {
    // POST /bling/conexao/iniciar pendurado
    render(<Pagina />);
    const botao = await screen.findByRole("button", { name: /conectar/i });
    await userEvent.click(botao);
    expect(botao).toBeDisabled();
  });
});
```

`aoNavegar` é injetado só para o teste poder observar a navegação; em produção o
padrão é `window.location.assign`.

- [ ] **Step 3: Rodar e ver falhar**

Run: `cd /srv/loja-cafecanastra/frontend && TZ=UTC npx vitest run "app/dashboard/(protegido)/bling/"`
Expected: FAIL — o módulo `./page` não existe.

- [ ] **Step 4: Implementar a tela**

Requisitos, todos exercitados pelos testes acima:

- `"use client"`, e busca `GET /bling/status` ao montar.
- Renderiza pelo `estadoDaConexao(status).chave` — **um estado por vez**, com a
  ação daquele estado e nada mais.
- `sem_credenciais`: tabela de `ESCOPOS_DO_APP` (recurso, leitura/escrita, por
  quê), `URL_DE_CALLBACK` num bloco copiável, e os campos Client ID / Client
  Secret → `POST /bling/conexao/credenciais`. O Secret é `type="password"`.
- `desconectado`: botão **Conectar** → `POST /bling/conexao/iniciar` →
  `aoNavegar(url)`.
- `conectado_desligado` / `ligado`: `<Selo>` com a cor do estado, interruptor
  (`role="switch"`) → `POST /bling/conexao/ativo`, e **Desconectar** →
  `DELETE /bling/conexao`, atrás de um `Dialogo` de confirmação.
- `mensagemDoRetorno(new URLSearchParams(window.location.search))` no topo, numa
  `Tarja` — verde para sucesso, vermelha para erro, com a frase **inteira**.
- Todo botão em voo fica `disabled` até a resposta (o padrão de
  `useAcoesDoBling.ts` — leia-o e siga).
- Recusa do servidor: mostre `corpo.message || corpo.error`, nunca "erro genérico".

- [ ] **Step 5: Rodar e ver passar**

Run: `cd /srv/loja-cafecanastra/frontend && TZ=UTC npx vitest run "app/dashboard/(protegido)/bling/"`
Expected: PASS, 5 casos.

- [ ] **Step 6: Conferir que a suíte inteira do frontend segue verde**

Run: `cd /srv/loja-cafecanastra/frontend && TZ=UTC npm test 2>&1 | tail -15`
Expected: tudo passa. **`TZ=UTC` é obrigatório** — sem ele, testes de data falham por fuso e você vai perseguir um fantasma.

- [ ] **Step 7: Commit**

```bash
cd /srv/loja-cafecanastra
git add "frontend/app/dashboard/(protegido)/bling/"
git commit -m "feat(bling): a tela de conexao"
```

---

## Onda 3

### Task B2: O fluxo OAuth

**Files:**
- Create: `backend/src/services/blingConexao.js`
- Modify: `backend/test/f8_bling_conexao.test.js`

**Depende de:** B1.

Arquivo separado de `blingClient.js` porque é outro assunto: o cliente fala com
uma API **já autorizada**; este **estabelece** a autorização.

- [ ] **Step 1: Escrever os testes que falham**

```js
test("gerarState devolve states distintos e imprevisiveis", () => {
  const a = blingConexao.gerarState();
  const b = blingConexao.gerarState();
  assert.notEqual(a, b);
  assert.ok(a.length >= 32);
});

test("consumirState aceita uma vez e RECUSA a segunda", () => {
  const s = blingConexao.gerarState();
  assert.equal(blingConexao.consumirState(s), true);
  assert.equal(blingConexao.consumirState(s), false);
});

test("consumirState recusa state desconhecido, vazio e nulo", () => {
  assert.equal(blingConexao.consumirState("inventado"), false);
  assert.equal(blingConexao.consumirState(""), false);
  assert.equal(blingConexao.consumirState(null), false);
});

test("consumirState recusa state vencido", () => {
  const s = blingConexao.gerarState();
  blingConexao.envelhecerStatesParaTeste();
  assert.equal(blingConexao.consumirState(s), false);
});

test("urlDeAutorizacao aponta para www.bling.com.br e leva o state", async () => {
  await pool.query(
    `UPDATE canastra.config_loja SET bling_client_id = 'meu-id' WHERE id = 1`,
  );
  blingClient.zerarCacheParaTeste();
  const { url, state } = await blingConexao.urlDeAutorizacao();
  const u = new URL(url);
  assert.equal(u.hostname, "www.bling.com.br");
  assert.equal(u.searchParams.get("response_type"), "code");
  assert.equal(u.searchParams.get("client_id"), "meu-id");
  assert.equal(u.searchParams.get("state"), state);
});

test("trocarCodePorTokens grava o refresh token e nao devolve segredo", async () => {
  const fetchFalso = async () =>
    new Response(JSON.stringify({ refresh_token: "novo-refresh", access_token: "a", expires_in: 21600 }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });

  const r = await blingConexao.trocarCodePorTokens("um-code", { fetchImpl: fetchFalso });
  assert.equal(r.conectado, true);
  assert.equal(JSON.stringify(r).includes("novo-refresh"), false);

  const { rows } = await pool.query(
    "SELECT bling_refresh_token FROM canastra.config_loja WHERE id = 1",
  );
  assert.equal(rows[0].bling_refresh_token, "novo-refresh");
});

test("trocarCodePorTokens devolve a frase do Bling quando ele recusa", async () => {
  const fetchFalso = async () =>
    new Response(JSON.stringify({ error: { description: "invalid_grant: code expirado" } }), {
      status: 400,
      headers: { "content-type": "application/json" },
    });

  await assert.rejects(
    () => blingConexao.trocarCodePorTokens("velho", { fetchImpl: fetchFalso }),
    (erro) => /code expirado/.test(erro.message),
  );

  const { rows } = await pool.query(
    "SELECT bling_refresh_token FROM canastra.config_loja WHERE id = 1",
  );
  assert.notEqual(rows[0].bling_refresh_token, "");
});

test("desconectar apaga o refresh token e desliga", async () => {
  await blingConexao.desconectar();
  const { rows } = await pool.query(
    "SELECT bling_refresh_token, bling_ativo FROM canastra.config_loja WHERE id = 1",
  );
  assert.equal(rows[0].bling_refresh_token, null);
  assert.equal(rows[0].bling_ativo, false);
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `cd /srv/loja-cafecanastra/backend && node --test test/f8_bling_conexao.test.js 2>&1 | tail -10`
Expected: FAIL — `Cannot find module '../src/services/blingConexao'`.

- [ ] **Step 3: Implementar**

```js
/**
 * O fluxo OAuth do Bling: estabelecer a autorizacao.
 *
 * Separado de `blingClient.js` de proposito — o cliente fala com uma API JA
 * autorizada; este arquivo e o que produz essa autorizacao. Juntar os dois
 * faria o arquivo que todo pedido de venda atravessa carregar tambem o codigo
 * que roda duas vezes na vida da loja.
 */
const crypto = require("node:crypto");
const pool = require("../pgPool");
const blingClient = require("./blingClient");

/**
 * O `state` vale 10 minutos. E o tempo de ir ao Bling, entrar na conta se
 * preciso, ler a tela de permissoes e clicar em autorizar — com folga, sem
 * deixar um nonce vivo a tarde inteira.
 */
const VALIDADE_DO_STATE_MS = 10 * 60 * 1000;

/**
 * OS STATES VIVOS, EM MEMORIA, E ISSO E DELIBERADO.
 *
 * O callback e PUBLICO por forca da fisica: e um redirect de navegador vindo do
 * Bling, e redirect nao carrega `Authorization`. Sem `state`, qualquer um que
 * descobrisse a URL poderia chama-la com um `code` da PROPRIA conta Bling e
 * amarrar esta loja ao ERP dele — o CSRF classico de OAuth. O `state` e gerado
 * no clique, que E autenticado, e so ele autoriza o callback a agir.
 *
 * Em memoria basta porque a API roda em INSTANCIA UNICA — nao por conveniencia,
 * mas porque o rodizio do refresh token do Bling nao tolera dois processos
 * (docs/bling.md, secao do token rotativo). Se a API reiniciar entre o clique e
 * o retorno, o nonce some e a tela diz "a autorizacao expirou, clique de novo":
 * a janela e de ~30 segundos e a falha e benigna. Um state assinado por HMAC
 * sobreviveria ao restart, ao custo de um segredo novo e mais codigo, para
 * cobrir trinta segundos de risco de nada.
 */
const statesVivos = new Map();

function limparStatesVencidos() {
  const agora = Date.now();
  for (const [state, expiraEm] of statesVivos) {
    if (agora >= expiraEm) statesVivos.delete(state);
  }
}

function gerarState() {
  limparStatesVencidos();
  const state = crypto.randomBytes(32).toString("hex");
  statesVivos.set(state, Date.now() + VALIDADE_DO_STATE_MS);
  return state;
}

/**
 * Valida e QUEIMA o state — uso unico, aconteca o que acontecer.
 *
 * O `delete` vem ANTES da conferencia de validade de proposito: um state
 * apresentado, valido ou vencido, nao volta a valer. Conferir primeiro e apagar
 * so no caminho feliz deixaria um state vencido sendo reapresentado para sempre.
 */
function consumirState(state) {
  limparStatesVencidos();
  if (!state || !statesVivos.has(state)) return false;
  const expiraEm = statesVivos.get(state);
  statesVivos.delete(state);
  return Date.now() < expiraEm;
}

/** Só para teste: envelhece tudo sem esperar dez minutos. */
function envelhecerStatesParaTeste() {
  for (const state of statesVivos.keys()) statesVivos.set(state, 0);
}

/**
 * A base da AUTORIZACAO, que NAO e a mesma da API.
 *
 * A troca de token e em `api.bling.com.br`; a autorizacao e em
 * `www.bling.com.br`. Hosts diferentes, e confundi-los rende um 404 do Bling
 * que nao explica nada. Sobrescritivel pela mesma razao que `baseDaApi()`: para
 * o teste deste fluxo nao sair para a internet.
 */
function baseDaAutorizacao() {
  return (
    process.env.BLING_AUTORIZACAO_URL || "https://www.bling.com.br/Api/v3"
  ).replace(/\/+$/, "");
}

/**
 * A URL para onde o navegador vai.
 *
 * NAO leva `redirect_uri`: o Bling usa a que esta CADASTRADA no aplicativo.
 * Manda-la aqui nao muda nada e da a falsa impressao de que a URL de callback
 * e configuravel deste lado — ela nao e, e quando nao bate o Bling recusa com
 * erro generico.
 */
async function urlDeAutorizacao() {
  const { clientId } = await blingClient.carregarConfig();
  if (!clientId) {
    const erro = new Error(
      "Salve o Client ID e o Client Secret antes de conectar.",
    );
    erro.status = 409;
    erro.codigoPublico = "SEM_CREDENCIAIS";
    throw erro;
  }

  const state = gerarState();
  const url = new URL(`${baseDaAutorizacao()}/oauth/authorize`);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("state", state);
  return { url: url.toString(), state };
}

/**
 * Troca o `code` pelo par de tokens e GRAVA o refresh token.
 *
 * Nao devolve token nenhum — so o veredito. O chamador e uma rota que redireciona
 * o navegador, e um refresh token num query string acabaria no historico, no log
 * do Traefik e no Referer da proxima requisicao.
 */
async function trocarCodePorTokens(code, { fetchImpl = fetch } = {}) {
  const { clientId, clientSecret } = await blingClient.carregarConfig();
  if (!clientId || !clientSecret) {
    const erro = new Error("Credenciais do Bling ausentes.");
    erro.status = 409;
    throw erro;
  }

  const basic = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");
  // `baseDaApi` nao e exportado por blingClient; use a env com o mesmo default.
  const base = (
    process.env.BLING_API_URL || "https://api.bling.com.br/Api/v3"
  ).replace(/\/+$/, "");

  const resposta = await fetchImpl(`${base}/oauth/token`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
      Authorization: `Basic ${basic}`,
    },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
    }).toString(),
  });

  const corpo = await resposta.json().catch(() => null);

  if (!resposta.ok || !corpo?.refresh_token) {
    const doBling =
      corpo?.error?.description ||
      corpo?.error_description ||
      corpo?.error?.type ||
      (typeof corpo?.error === "string" ? corpo.error : null);
    const erro = new Error(
      doBling
        ? `O Bling recusou a autorização: ${doBling}`
        : "O Bling não devolveu o refresh token. O código de autorização " +
          "expira em cerca de um minuto — clique em Conectar de novo.",
    );
    erro.status = 502;
    erro.codigoPublico = "BLING_RECUSOU";
    throw erro;
  }

  await pool.query(
    "INSERT INTO canastra.config_loja (id) VALUES (1) ON CONFLICT (id) DO NOTHING",
  );
  await pool.query(
    `UPDATE canastra.config_loja
        SET bling_refresh_token = $1, atualizado_em = now()
      WHERE id = 1`,
    [corpo.refresh_token],
  );
  blingClient.esquecerConfig();

  return { conectado: true };
}

/**
 * Desconecta: apaga o refresh token e desliga.
 *
 * As DUAS coisas, e nesta ordem de intencao: um token apagado com `ativo = true`
 * deixaria o gatilho de pedido aprovado tentando sincronizar a cada venda e
 * falhando, enchendo o log sem que ninguem tivesse pedido nada.
 *
 * O Client ID e o Secret FICAM. Desconectar e "refazer a autorizacao", nao
 * "esquecer o aplicativo" — quem quiser trocar de app sobrescreve as credenciais
 * pela tela.
 */
async function desconectar() {
  await pool.query(
    `UPDATE canastra.config_loja
        SET bling_refresh_token = NULL, bling_ativo = false, atualizado_em = now()
      WHERE id = 1`,
  );
  blingClient.esquecerConfig();
  return { desconectado: true };
}

module.exports = {
  gerarState,
  consumirState,
  envelhecerStatesParaTeste,
  urlDeAutorizacao,
  trocarCodePorTokens,
  desconectar,
};
```

- [ ] **Step 4: Rodar e ver passar**

Run: `cd /srv/loja-cafecanastra/backend && node --test test/f8_bling_conexao.test.js 2>&1 | tail -10`
Expected: PASS, 13 casos (os 5 de B1 + 8 destes).

- [ ] **Step 5: Commit**

```bash
cd /srv/loja-cafecanastra
git add backend/src/services/blingConexao.js backend/test/f8_bling_conexao.test.js
git commit -m "feat(bling): o fluxo OAuth, com state de uso unico"
```

---

## Onda 4

### Task B3: As rotas

**Files:**
- Modify: `backend/src/routes/bling.routes.js`
- Modify: `backend/test/f8_bling_conexao.test.js`

**Depende de:** B2.

- [ ] **Step 1: Escrever os testes que falham**

Use o mesmo jeito de f7 de subir o app Express e autenticar como admin (leia
`test/f7_bling.test.js` e copie o padrão — não invente outro).

```js
test("POST /bling/conexao/credenciais grava, e exige admin", async () => {
  const semSessao = await pedir("POST", "/bling/conexao/credenciais", {
    corpo: { clientId: "a", clientSecret: "b" },
  });
  assert.equal(semSessao.status, 401);

  const r = await pedir("POST", "/bling/conexao/credenciais", {
    admin: true,
    corpo: { clientId: "meu-id", clientSecret: "meu-segredo" },
  });
  assert.equal(r.status, 200);

  const { rows } = await pool.query(
    "SELECT bling_client_id FROM canastra.config_loja WHERE id = 1",
  );
  assert.equal(rows[0].bling_client_id, "meu-id");
});

test("POST /bling/conexao/credenciais recusa corpo vazio com frase util", async () => {
  const r = await pedir("POST", "/bling/conexao/credenciais", {
    admin: true,
    corpo: { clientId: "", clientSecret: "" },
  });
  assert.equal(r.status, 400);
  assert.match(r.corpo.message, /Client ID/);
});

test("GET /bling/callback SEM state valido nao grava nada", async () => {
  const antes = await pool.query(
    "SELECT bling_refresh_token FROM canastra.config_loja WHERE id = 1",
  );
  const r = await pedir("GET", "/bling/callback?code=qualquer&state=inventado");
  assert.equal(r.status, 302);
  assert.match(r.cabecalhos.location, /erro=/);
  const depois = await pool.query(
    "SELECT bling_refresh_token FROM canastra.config_loja WHERE id = 1",
  );
  assert.equal(depois.rows[0].bling_refresh_token, antes.rows[0].bling_refresh_token);
});

test("GET /bling/callback com state valido conecta e redireciona", async () => {
  const state = blingConexao.gerarState();
  // dublê de fetch devolvendo refresh_token — injete como f7 injeta
  const r = await pedir("GET", `/bling/callback?code=bom&state=${state}`);
  assert.equal(r.status, 302);
  assert.equal(r.cabecalhos.location, "/dashboard/bling?conectado=1");
});

test("GET /bling/callback nunca poe token na URL de redirecionamento", async () => {
  const state = blingConexao.gerarState();
  const r = await pedir("GET", `/bling/callback?code=bom&state=${state}`);
  assert.equal(/refresh|token|secret/i.test(r.cabecalhos.location), false);
});

test("POST /bling/conexao/ativo recusa ligar sem conexao", async () => {
  await pool.query(
    "UPDATE canastra.config_loja SET bling_refresh_token = NULL WHERE id = 1",
  );
  const r = await pedir("POST", "/bling/conexao/ativo", {
    admin: true,
    corpo: { ativo: true },
  });
  assert.equal(r.status, 409);
  assert.equal(r.corpo.error, "SEM_CONEXAO");
});

test("GET /bling/status conta a verdade e NAO vaza segredo", async () => {
  await pool.query(
    `UPDATE canastra.config_loja
        SET bling_client_id = 'id', bling_client_secret = 'segredo-secretissimo',
            bling_refresh_token = 'refresh-secretissimo' WHERE id = 1`,
  );
  const r = await pedir("GET", "/bling/status", { admin: true });
  assert.equal(r.corpo.temCredenciais, true);
  assert.equal(r.corpo.conectado, true);
  const inteiro = JSON.stringify(r.corpo);
  assert.equal(inteiro.includes("segredo-secretissimo"), false);
  assert.equal(inteiro.includes("refresh-secretissimo"), false);
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `cd /srv/loja-cafecanastra/backend && node --test test/f8_bling_conexao.test.js 2>&1 | tail -10`
Expected: FAIL — 404 nas rotas novas.

- [ ] **Step 3: Implementar as rotas**

Em `bling.routes.js`, acrescente `const blingConexao = require("../services/blingConexao");` e as rotas. Pontos que os testes cobram:

- `POST /bling/conexao/credenciais` — `isAuthenticated + isAdmin`. Rejeita
  `clientId`/`clientSecret` vazios ou não-string com 400 e a frase do contrato.
  Grava com `INSERT ... ON CONFLICT DO NOTHING` seguido de `UPDATE` (a mesma
  defesa de `persistirRefreshToken`: numa instalação sem seed o UPDATE seria
  no-op silencioso). Chama `blingClient.esquecerConfig()`.
- `POST /bling/conexao/iniciar` — `isAuthenticated + isAdmin`. Devolve
  `{ url }` de `urlDeAutorizacao()`. **Não** devolve o `state` ao cliente: ele
  já viaja dentro da URL, e repeti-lo no corpo só amplia a superfície.
- `GET /bling/callback` — **sem `isAuthenticated`**, com este comentário:

```js
/**
 * GET /bling/callback — A UNICA ROTA PUBLICA DESTE ARQUIVO, e e por forca da
 * fisica: e um redirect de navegador vindo do Bling, e redirect nao carrega
 * cabecalho `Authorization`. Nao ha como exigir `isAuthenticated` aqui.
 *
 * Quem faz o papel da autenticacao e o `state`, gerado no clique em Conectar —
 * que E autenticado e admin — e queimado no uso. Sem state vivo, esta rota
 * redireciona com erro e NAO TOCA EM NADA.
 *
 * O redirect e RELATIVO: Traefik serve vitrine e API na mesma origem, entao o
 * navegador resolve sozinho, e nao e preciso inventar uma env FRONTEND_URL.
 */
```

  Ordem obrigatória: `consumirState(req.query.state)` **primeiro**; só então
  ler `code`. Erro → `res.redirect("/dashboard/bling?erro=" + encodeURIComponent(frase))`.
  Sucesso → `res.redirect("/dashboard/bling?conectado=1")`.
- `POST /bling/conexao/ativo` — recusa `{ ativo: true }` com 409/`SEM_CONEXAO`
  quando `carregarConfig().temRefreshToken` é falso. Grava `bling_ativo` e
  chama `esquecerConfig()`.
- `DELETE /bling/conexao` — chama `blingConexao.desconectar()`.
- `GET /bling/status` — acrescenta `temCredenciais` e `conectado` a partir de
  `carregarConfig()`, e passa a ler `ativo` de lá (não de `process.env`).
- `blingLigado` vira async e consulta `(await blingClient.carregarConfig()).ativo`.

- [ ] **Step 4: Rodar e ver passar**

Run: `cd /srv/loja-cafecanastra/backend && node --test test/f8_bling_conexao.test.js 2>&1 | tail -10`
Expected: PASS, 20 casos.

- [ ] **Step 5: Ajustar o gatilho e o cron**

Em `blingPedidos.js`, `aoAprovarPedido` (linha ~853): troque
`if (process.env.BLING_ATIVO !== "true") return null;` por uma consulta a
`carregarConfig()`. Como a função devolve `null` de forma síncrona hoje e passa
a precisar de `await`, mova a verificação para dentro da Promise que ela já
dispara — os chamadores (`PaymentController`, `ClubeController`) usam
fire-and-forget com catch logado, então a assinatura pode devolver Promise.

Em `rodadaDeRastreio` (linha ~882), acrescente no começo do tique:

```js
  // O portao de BOOT e a env `BLING_RASTREIO_CRON`; quem decide a cada TIQUE se
  // ha o que fazer e o banco. Sem isto, ligar a integracao pela tela so teria
  // efeito no proximo restart — o interruptor mentiria para o gestor.
  //
  // O retorno PRESERVA A FORMA `{ candidatos, atualizados }`. Um `return` seco
  // devolveria `undefined` e quebraria f7_bling.test.js:666, que afirma
  // `typeof rodada.candidatos === "number"` — e manter os 22 casos de f7
  // passando SEM alteracao e o criterio que valida o desenho inteiro.
  const { ativo } = await blingClient.carregarConfig();
  if (!ativo) return { candidatos: 0, atualizados: 0 };
```

**ATENCAO:** `rodadaDeRastreio()` NAO aceita argumentos, e nao invente um ponto
de injecao para testar isto. O teste correto usa o que ja existe — a contagem de
candidatos:

```js
test("o cron nao age com a integracao desligada no banco", async () => {
  // Um pedido que a consulta do cron ENCONTRARIA: tem bling_id, nao tem
  // rastreio, esta aprovado e e recente. Sem ele o teste passaria por engano,
  // afirmando zero sobre uma fila que ja era vazia.
  await pool.query(
    `UPDATE canastra.pedidos
        SET bling_id = '999', codigo_rastreio = NULL, status = 'aprovado'
      WHERE pedido_id = $1`,
    [pedidoId],
  );

  await pool.query("UPDATE canastra.config_loja SET bling_ativo = true WHERE id = 1");
  blingClient.zerarCacheParaTeste();
  const ligado = await blingPedidos.rodadaDeRastreio();
  assert.ok(ligado.candidatos > 0, "ligado, o cron enxerga a fila");

  await pool.query("UPDATE canastra.config_loja SET bling_ativo = false WHERE id = 1");
  blingClient.zerarCacheParaTeste();
  const desligado = await blingPedidos.rodadaDeRastreio();
  assert.deepEqual(desligado, { candidatos: 0, atualizados: 0 });
});
```

- [ ] **Step 6: A suíte inteira do backend**

Run: `cd /srv/loja-cafecanastra/backend && npm test 2>&1 | tail -20`
Expected: tudo passa, **incluindo os 22 de f7 sem alteração**.

- [ ] **Step 7: Commit**

```bash
cd /srv/loja-cafecanastra
git add backend/src/routes/bling.routes.js backend/src/services/blingPedidos.js backend/test/f8_bling_conexao.test.js
git commit -m "feat(bling): as rotas de conexao, e o cron que olha o banco"
```

---

## Fechamento

- [ ] **As duas suítes, do zero**

Run: `cd /srv/loja-cafecanastra/backend && npm test 2>&1 | tail -8`
Run: `cd /srv/loja-cafecanastra/frontend && TZ=UTC npm test 2>&1 | tail -8`
Expected: verde nas duas. `TZ=UTC` no frontend não é opcional.

- [ ] **O build do Next**

Run: `cd /srv/loja-cafecanastra/frontend && npm run build 2>&1 | tail -15`
Expected: compila. (Passa de 10 min nesta VPS de 3 vCPU — é esperado.)

- [ ] **Nenhum segredo em log ou resposta**

Run: `cd /srv/loja-cafecanastra/backend && grep -rn "client_secret\|clientSecret\|refresh_token\|refreshToken" src/routes/bling.routes.js`
Expected: nenhuma ocorrência dentro de `console.*`, `res.json` ou string de redirect.

- [ ] **PR**

```bash
cd /srv/loja-cafecanastra
git push -u origin feat/conexao-bling
gh pr create --base main \
  --title "feat(bling): conexao pelo painel, sem .env e sem deploy" \
  --body "Implementa docs/superpowers/plans/2026-09-16-conexao-bling.md.

A integracao com o Bling estava escrita por inteiro e nunca havia sido ligada:
credenciais vazias no .env e BLING_ATIVO=false. Ligar exigia seis passos, um
deles com um code que expira em ~1 minuto.

Agora: /dashboard/bling (menu Gerir) recebe Client ID e Secret, o botao Conectar
faz o OAuth por redirect, e o refresh token vai para o banco. Sem .env, sem
deploy.

O callback e a unica rota publica de /bling — redirect de navegador nao carrega
Authorization. Quem faz o papel da autenticacao e um state de uso unico, gerado
no clique (que e admin) e queimado no retorno.

As credenciais moram em config_loja, protegidas pelo privilegio de coluna que a
0012 ja instalou — coluna nova nao herda GRANT, entao nascem invisiveis ao
PostgREST. bling_ativo e NULLABLE de proposito: NULL quer dizer 'use a env', e e
o que mantem os 22 casos de f7_bling.test.js passando sem uma alteracao.

ATENCAO AO SUBIR: a migracao 0039 nao entra sozinha — deploy/.env.migracao nao
existe nesta VPS, entao o deploy so avisa e segue. Aplicar antes do merge.

🤖 Generated with [Claude Code](https://claude.com/claude-code)"
```

---

## PENDENTE — decisão do Rafael antes de subir

**A migração 0039 não entra sozinha.** `deploy/deploy.sh` só roda
`npm run db:migrar` se existir `deploy/.env.migracao` nesta VPS — e ele **não
existe**. Hoje o deploy detecta migração nova, imprime um aviso e segue. Subir o
código sem aplicar a 0039 deixa a tela batendo em coluna inexistente, com 500 em
toda chamada.

Duas saídas: criar o `deploy/.env.migracao` com a `DATABASE_URL` do pooler (e o
deploy passa a aplicar migração sozinho de agora em diante — resolve a lacuna,
não só esta migração), ou aplicar a 0039 à mão contra o Supabase Cloud. A segunda
é DDL em produção.
