#!/usr/bin/env node

/**
 * Confere a fronteira de RLS contra um Supabase de verdade, de fora, pela API.
 *
 * POR QUE ISTO EXISTE, TENDO 140 TESTES LOCAIS
 * Os testes de `backend/test/rls.test.js` provam as politicas num Postgres 16
 * com um arremedo de `auth.uid()`. Isso cobre a POLITICA, e nao o CAMINHO: o
 * GoTrue emitindo o token, o Kong repassando, o PostgREST injetando o claim, o
 * `Accept-Profile` escolhendo o schema, o GRANT de coluna escondendo `custo`.
 * Cada uma dessas pecas pode estar errada com todas as politicas certas.
 *
 * Foi este script que achou dois defeitos que nenhum teste local pegaria:
 *   · `canastra` fora de "Exposed schemas" — tudo respondia 404 com o banco
 *     perfeitamente instalado;
 *   · conta criada por SQL com os campos de token em NULL — o GoTrue recusava o
 *     login com "Database error querying schema", sem citar conta nem senha.
 *
 * Uso:
 *   node backend/scripts/verifica-rls.mjs
 *
 * Le do ambiente (ou de frontend/.env.local, que ja tem os dois primeiros):
 *   SUPABASE_URL        ou NEXT_PUBLIC_SUPABASE_URL
 *   SUPABASE_ANON_KEY   ou NEXT_PUBLIC_SUPABASE_ANON_KEY
 *   VERIFICA_EMAIL_ADMIN / VERIFICA_SENHA_ADMIN      (opcionais)
 *   VERIFICA_EMAIL_CLIENTE / VERIFICA_SENHA_CLIENTE  (opcionais)
 *
 * Sem as contas, roda so a parte anonima — que ja e a metade que protege dado
 * pessoal de quem nao esta logado.
 */

import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

/** Le um .env simples sem depender de dotenv (este script roda fora do backend). */
function lerEnv(caminho) {
  try {
    const texto = readFileSync(join(RAIZ, caminho), "utf8");
    const fora = {};
    for (const linha of texto.split("\n")) {
      const corte = linha.indexOf("=");
      if (corte < 1 || linha.trimStart().startsWith("#")) continue;
      fora[linha.slice(0, corte).trim()] = linha.slice(corte + 1).trim();
    }
    return fora;
  } catch {
    return {};
  }
}

const doArquivo = { ...lerEnv("frontend/.env.local"), ...lerEnv("backend/src/.env") };
const pega = (...nomes) => nomes.map((n) => process.env[n] || doArquivo[n]).find(Boolean);

const BASE = (pega("SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_URL") || "").replace(/\/+$/, "");
const ANON = pega("SUPABASE_ANON_KEY", "NEXT_PUBLIC_SUPABASE_ANON_KEY");

if (!BASE || !ANON) {
  console.error(
    "\n❌ Faltam SUPABASE_URL e SUPABASE_ANON_KEY.\n" +
      "   Defina no ambiente, ou em frontend/.env.local como NEXT_PUBLIC_SUPABASE_URL\n" +
      "   e NEXT_PUBLIC_SUPABASE_ANON_KEY.\n",
  );
  process.exit(1);
}

const CONTAS = {
  admin: {
    email: pega("VERIFICA_EMAIL_ADMIN"),
    senha: pega("VERIFICA_SENHA_ADMIN"),
  },
  cliente: {
    email: pega("VERIFICA_EMAIL_CLIENTE"),
    senha: pega("VERIFICA_SENHA_CLIENTE"),
  },
};

let ok = 0;
let falhou = 0;

function marca(condicao, descricao, detalhe) {
  if (condicao) {
    ok += 1;
    console.log(`  ok    ${descricao}`);
  } else {
    falhou += 1;
    console.log(`  FALHA ${descricao}`);
    if (detalhe !== undefined) console.log(`        -> ${JSON.stringify(detalhe)}`);
  }
}

async function rest(caminho, { token = ANON, metodo = "GET", corpo, prefer } = {}) {
  const cabecalhos = {
    apikey: ANON,
    Authorization: `Bearer ${token}`,
    // Sem isto o PostgREST procura em `public` e responde 404 — o schema da loja
    // e `canastra`, e ele precisa estar em Settings > API > Exposed schemas.
    "Accept-Profile": "canastra",
    "Content-Profile": "canastra",
  };
  if (corpo) cabecalhos["Content-Type"] = "application/json";
  if (prefer) cabecalhos.Prefer = prefer;

  const r = await fetch(`${BASE}/rest/v1/${caminho}`, {
    method: metodo,
    headers: cabecalhos,
    body: corpo ? JSON.stringify(corpo) : undefined,
  });
  const texto = await r.text();
  let json;
  try {
    json = texto ? JSON.parse(texto) : null;
  } catch {
    json = texto;
  }
  return { status: r.status, corpo: json };
}

async function entrar({ email, senha }) {
  const r = await fetch(`${BASE}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: ANON, "Content-Type": "application/json" },
    body: JSON.stringify({ email, password: senha }),
  });
  const j = await r.json().catch(() => ({}));
  return { token: j.access_token, erro: j.error_description || j.msg || `HTTP ${r.status}` };
}

console.log(`\nVerificando ${BASE}`);

// ── 1. Visitante anônimo ────────────────────────────────────────────────────
console.log("\n=== 1. Visitante anônimo (chave anon) ===");

const catalogo = await rest("produtos_publicos?select=produto_id&limit=1000");
if (catalogo.status === 406) {
  console.error(
    "\n❌ O schema `canastra` não está exposto ao PostgREST.\n" +
      "   Settings > API > Exposed schemas: acrescente `canastra` e salve.\n" +
      "   Sem isso, TODA rota da loja responde 404 com o banco perfeitamente instalado.\n",
  );
  process.exit(1);
}
marca(catalogo.status === 200 && catalogo.corpo.length > 0, `catálogo responde (${catalogo.corpo?.length} SKUs)`);

for (const t of ["produto_opcoes", "promocoes", "config_loja"]) {
  const r = await rest(`${t}?select=*`);
  marca(r.status === 200, `${t} legível por anon`, r.corpo);
}

// `custo` é a margem da loja. A view pública não o projeta, e o GRANT de coluna
// em `produtos` não o inclui — as duas camadas precisam negar.
for (const [alvo, descricao] of [
  ["produtos?select=custo&limit=1", "custo NÃO sai pela tabela"],
  ["produtos?select=*&limit=1", "SELECT * em produtos recusado"],
]) {
  const r = await rest(alvo);
  marca(r.status >= 400, `${descricao} (HTTP ${r.status})`, r.corpo);
}

for (const t of ["clientes", "pedidos", "enderecos", "carrinhos"]) {
  const r = await rest(`${t}?select=*`);
  const vazio = Array.isArray(r.corpo) && r.corpo.length === 0;
  marca(vazio || r.status >= 400, `${t} não entrega nada para anon (HTTP ${r.status})`, r.corpo);
}

const escreve = await rest("produtos", {
  metodo: "POST",
  corpo: { nome: "sonda anônima", preco: 1 },
  prefer: "return=minimal",
});
marca(escreve.status >= 400, `anon não cadastra produto (HTTP ${escreve.status})`, escreve.corpo);

// ── 2. Cliente comum ────────────────────────────────────────────────────────
if (CONTAS.cliente.email && CONTAS.cliente.senha) {
  console.log("\n=== 2. Cliente comum (token do GoTrue) ===");
  const c = await entrar(CONTAS.cliente);
  marca(!!c.token, `login de ${CONTAS.cliente.email}`, c.erro);

  if (c.token) {
    const meu = await rest("clientes?select=nome", { token: c.token });
    marca(meu.status === 200 && meu.corpo.length === 1, `enxerga só o próprio cadastro (${meu.corpo?.length})`, meu.corpo);

    const ped = await rest("pedidos?select=*", { token: c.token });
    marca(ped.status === 200 && ped.corpo.length === 0, "não enxerga pedido de ninguém", ped.corpo);

    const cst = await rest("produtos?select=custo&limit=1", { token: c.token });
    marca(cst.status >= 400, `não lê custo (HTTP ${cst.status})`, cst.corpo);

    const prod = await rest("produtos", {
      token: c.token,
      metodo: "POST",
      corpo: { nome: "sonda cliente", preco: 1 },
      prefer: "return=minimal",
    });
    marca(prod.status >= 400, `não cadastra produto (HTTP ${prod.status})`, prod.corpo);

    // A trava que sustenta a instância compartilhada: virar administrador é ter
    // linha em canastra.admins, e `authenticated` não escreve lá.
    const adm = await rest("admins", {
      token: c.token,
      metodo: "POST",
      corpo: { user_id: "00000000-0000-0000-0000-000000000000" },
      prefer: "return=minimal",
    });
    marca(adm.status >= 400, `não se promove a administrador (HTTP ${adm.status})`, adm.corpo);
  }
}

// ── 3. Administrador ────────────────────────────────────────────────────────
if (CONTAS.admin.email && CONTAS.admin.senha) {
  console.log("\n=== 3. Administrador (token do GoTrue) ===");
  const a = await entrar(CONTAS.admin);
  marca(!!a.token, `login de ${CONTAS.admin.email}`, a.erro);

  if (a.token) {
    const todos = await rest("clientes?select=nome", { token: a.token });
    marca(todos.status === 200 && todos.corpo.length >= 1, `enxerga a lista de clientes (${todos.corpo?.length})`, todos.corpo);

    const pedidos = await rest("pedidos?select=pedido_id", { token: a.token });
    marca(pedidos.status === 200, `enxerga os pedidos (HTTP ${pedidos.status})`, pedidos.corpo);

    // Escrita de admin, e a sonda sai de volta. `return=minimal` de propósito:
    // `produtos` tem GRANT por coluna, então `RETURNING *` responderia 42501.
    const SKU = "sonda-verifica-rls";
    const cria = await rest("produtos", {
      token: a.token,
      metodo: "POST",
      corpo: { nome: "SONDA — apagar", preco: 1, sku: SKU },
      prefer: "return=minimal",
    });
    marca(cria.status === 201, `cadastra produto (HTTP ${cria.status})`, cria.corpo);

    if (cria.status === 201) {
      const apaga = await rest(`produtos?sku=eq.${SKU}`, {
        token: a.token,
        metodo: "DELETE",
        prefer: "return=minimal",
      });
      marca(apaga.status === 204, `e remove a sonda (HTTP ${apaga.status})`, apaga.corpo);
    }
  }
}

console.log(`\n=== ${ok} ok, ${falhou} falha(s) ===\n`);
if (!CONTAS.cliente.email || !CONTAS.admin.email) {
  console.log(
    "Só a parte anônima rodou. Para as outras duas, defina VERIFICA_EMAIL_CLIENTE,\n" +
      "VERIFICA_SENHA_CLIENTE, VERIFICA_EMAIL_ADMIN e VERIFICA_SENHA_ADMIN.\n",
  );
}
process.exit(falhou ? 1 : 0);
