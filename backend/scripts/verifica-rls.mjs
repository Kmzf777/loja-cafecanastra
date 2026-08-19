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
 * O QUE A F2 ACRESCENTOU AQUI (secoes 4, 5 e 6), e por que cada caso e uma
 * SONDA e nao a repeticao de um teste que ja existe:
 *   · 4. `garantir_cliente` pelo PostgREST. O teste de banco chama a funcao por
 *        SQL; so a chamada por HTTP prova o REVOKE/GRANT chegando ate o `anon` e
 *        o `authenticated` do PostgREST, e que a RPC aparece em /rest/v1/rpc/.
 *   · 5. O ESPELHO DA MESMA DEFESA NO SERVICO NODE. Um token de outro projeto da
 *        instancia compartilhada leva ZERO LINHAS do PostgREST (a RLS negando em
 *        silencio, que e o certo la) e precisa levar 403 do Express. E o caso em
 *        que toda esta arquitetura se apoia, e ele vive em dois processos
 *        diferentes — nenhum teste de um dos lados o mede.
 *   · 6. A fusao da sacola no login. A RPC 0007 NAO e idempotente por desenho, e
 *        quem impede a segunda soma e a base gravada no navegador. Isso so se
 *        mede repetindo a SEQUENCIA de uma segunda carga de pagina contra o
 *        banco de verdade — e a contraprova (secao 6) mostra a sacola dobrando
 *        quando a base se perde.
 *
 * Uso:
 *   node backend/scripts/verifica-rls.mjs
 *
 * Le do ambiente (ou de frontend/.env.local / backend/src/.env):
 *   SUPABASE_URL        ou NEXT_PUBLIC_SUPABASE_URL
 *   SUPABASE_ANON_KEY   ou NEXT_PUBLIC_SUPABASE_ANON_KEY
 *   VERIFICA_EMAIL_ADMIN / VERIFICA_SENHA_ADMIN      (opcionais)
 *   VERIFICA_EMAIL_CLIENTE / VERIFICA_SENHA_CLIENTE  (opcionais)
 *   SUPABASE_JWT_SECRET                              (opcional, so para a §5)
 *   VERIFICA_API_URL ou NEXT_PUBLIC_API_URL          (opcional, so para a §5)
 *
 * Sem as contas, roda so a parte anonima — que ja e a metade que protege dado
 * pessoal de quem nao esta logado. Sem o segredo do JWT, ou com o serviço Node
 * fora do ar, a §5 e PULADA com o motivo escrito: nao ter o Express de pe nao
 * pode reprovar a fronteira do banco, que e o objeto principal deste script.
 *
 * ELE ESCREVE NO BANCO, e isso precisa estar dito na primeira leitura. A §4
 * chama `garantir_cliente` (que e `ON CONFLICT DO NOTHING` — nao sobrescreve
 * cadastro nenhum) e a §6 insere itens de sonda em `canastra.carrinho_itens`,
 * todos marcados com `moagem = 'sonda-verifica-rls'` e APAGADOS no fim da propria
 * secao. Tudo isso acontece dentro da conta de VERIFICA_EMAIL_CLIENTE, com o
 * token dela, sob RLS — nao alcança dado de outra pessoa. Ainda assim: aponte
 * este script para uma instancia de teste, e nao para a loja em producao.
 */

import { createHmac, randomUUID } from "node:crypto";
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

/**
 * Base do servico Node, so para a §5.
 *
 * `localhost` NAO e sinal de configuracao errada aqui, e vale registrar porque a
 * intuicao diz o contrario: em producao o Express roda na MESMA VPS do Kong, e
 * `http://localhost:3333` e o valor certo (docs/producao.md §3.1).
 */
const API = (pega("VERIFICA_API_URL", "NEXT_PUBLIC_API_URL") || "http://localhost:3333").replace(/\/+$/, "");

/**
 * O segredo com que o GoTrue da instancia assina. Aqui ele serve para FORJAR um
 * token de outro projeto — que e exatamente o que a §5 precisa e o que nenhum
 * cadastro produziria: uma conta legitima desta loja tem linha em
 * `canastra.clientes`, e a sonda precisa de uma que nao tenha.
 */
const SEGREDO_JWT = pega("SUPABASE_JWT_SECRET");

let ok = 0;
let falhou = 0;
let pulados = 0;

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

/**
 * Caso NAO EXERCIDO por falta de configuracao. Nao e sucesso e nao e falha: o
 * script termina 0 sem ele, mas o motivo fica escrito. Contar como `ok` seria a
 * pior das tres opcoes — daria por conferido o que ninguem conferiu.
 */
function pula(descricao, motivo) {
  pulados += 1;
  console.log(`  pula  ${descricao}`);
  console.log(`        -> ${motivo}`);
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

/** Fala com o serviço Node. `{ rede }` quando ele nao atende — ver §5. */
async function api(caminho, token) {
  try {
    const r = await fetch(`${API}${caminho}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const texto = await r.text();
    let json;
    try {
      json = texto ? JSON.parse(texto) : null;
    } catch {
      json = texto;
    }
    return { status: r.status, corpo: json };
  } catch (erro) {
    return { rede: erro.message };
  }
}

const b64url = (dado) => Buffer.from(dado).toString("base64url");

/**
 * Um token de OUTRO projeto da instancia compartilhada, assinado de verdade.
 *
 * Nao e trapaca nem atalho: e literalmente o que o GoTrue emite para o vizinho.
 * A instancia self-hosted tem UM segredo e UM `auth.users`, entao um token dele
 * chega aqui com assinatura perfeita, `role: "authenticated"` e um `sub` que
 * nunca esteve em `canastra.clientes` — indistinguivel de um cliente da loja
 * para quem parar na assinatura. E o unico jeito de produzir esse token sem
 * pedir uma segunda conta ao operador: qualquer conta que ele criasse pelo
 * cadastro da loja viraria cliente e deixaria de servir de sonda.
 *
 * Vida curta (5 min) de proposito — se vazar do terminal, ja venceu.
 */
function tokenDeOutroProjeto(segredo) {
  const agora = Math.floor(Date.now() / 1000);
  const cabecalho = b64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const carga = b64url(
    JSON.stringify({
      sub: randomUUID(),
      role: "authenticated",
      aud: "authenticated",
      iat: agora,
      exp: agora + 300,
    }),
  );
  const assinatura = createHmac("sha256", segredo)
    .update(`${cabecalho}.${carga}`)
    .digest("base64url");
  return `${cabecalho}.${carga}.${assinatura}`;
}

/** O `sub` de um JWT, sem verificar nada — aqui so se quer saber de quem ele e. */
function subDoToken(token) {
  try {
    return JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString("utf8")).sub;
  } catch {
    return null;
  }
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
// O token sai desta secao e vive ate o fim do arquivo: as secoes 4 e 6 sondam a
// mesma conta, e entrar de novo em cada uma so gastaria login.
let tokenCliente = null;

if (CONTAS.cliente.email && CONTAS.cliente.senha) {
  console.log("\n=== 2. Cliente comum (token do GoTrue) ===");
  const c = await entrar(CONTAS.cliente);
  marca(!!c.token, `login de ${CONTAS.cliente.email}`, c.erro);
  tokenCliente = c.token || null;

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

// ── 4. `garantir_cliente`: a porta que liga conta do GoTrue à loja ──────────
//
// A 0008 abriu UMA porta em `canastra.clientes` — que a 0006 tinha trancado —
// e a fechou com `REVOKE EXECUTE FROM PUBLIC` mais um `GRANT` só para
// `authenticated`. `PUBLIC` inclui `anon`, e `anon` é a chave que qualquer
// visitante baixa no bundle: se o REVOKE não tivesse chegado até aqui, a tabela
// que sustenta `eh_cliente()` — e portanto TODA política de dono do schema —
// estaria de novo aberta ao mundo, com um nome mais simpático.
console.log("\n=== 4. garantir_cliente (a porta de 0008) ===");

const rpcAnon = await rest("rpc/garantir_cliente", {
  metodo: "POST",
  corpo: { nome: "sonda anônima" },
});
marca(rpcAnon.status >= 400, `anon NÃO executa garantir_cliente (HTTP ${rpcAnon.status})`, rpcAnon.corpo);

if (tokenCliente) {
  const meuSub = subDoToken(tokenCliente);

  // `ON CONFLICT (user_id) DO NOTHING`: chamar de novo numa conta que já é
  // cliente não sobrescreve nome, telefone nem CPF. É por isso que esta sonda
  // pode rodar contra a conta de teste sem estragar o cadastro dela.
  const rpc = await rest("rpc/garantir_cliente", {
    token: tokenCliente,
    metodo: "POST",
    corpo: { nome: "Sonda verifica-rls" },
  });
  marca(rpc.status < 400, `token confirmado executa garantir_cliente (HTTP ${rpc.status})`, rpc.corpo);

  // UMA linha, e a linha do PRÓPRIO `sub`. As duas metades importam: contar 1
  // sozinho passaria com a linha de outra pessoa, e conferir o `sub` sozinho
  // passaria se a RLS estivesse entregando a loja inteira.
  const meu = await rest("clientes?select=user_id", { token: tokenCliente });
  const linhas = Array.isArray(meu.corpo) ? meu.corpo : [];
  marca(
    linhas.length === 1 && linhas[0].user_id === meuSub,
    `sobra exatamente 1 vínculo, e é o do próprio sub (${linhas.length} linha(s))`,
    meu.corpo,
  );
}

// ── 5. O espelho da mesma defesa no serviço Node ────────────────────────────
//
// ESTE É O CASO EM QUE A ARQUITETURA INTEIRA SE APOIA, e ele não vive em nenhum
// dos dois lados sozinho.
//
// A instância Supabase é compartilhada com outros projetos, e self-hosted não é
// multi-projeto: um `auth.users` e um segredo de JWT para todos. Um token do
// vizinho chega com assinatura perfeita e `auth.uid()` preenchido.
//
// O PostgREST responde a ele com ZERO LINHAS — silêncio, que é a resposta certa
// de uma política de RLS. O Express NÃO PODE se contentar com isso: ele não lê
// por política, lê por consulta, e uma consulta sem `WHERE user_id = ...` num
// controller distraído entregaria tudo. Por isso `isAuthenticated` confere o
// VÍNCULO (linha em `canastra.clientes`) e responde 403 antes do controller.
//
// A sonda mede os dois lados na mesma corrida, com o MESMO token.
console.log("\n=== 5. Token de outro projeto: vazio no PostgREST, 403 no Node ===");

const estrangeiro = SEGREDO_JWT ? tokenDeOutroProjeto(SEGREDO_JWT) : null;

if (!estrangeiro) {
  pula(
    "token de outro projeto da instância",
    "SUPABASE_JWT_SECRET não está definida (é o `JWT_SECRET` do stack; em " +
      "backend/src/.env, ou no ambiente). Sem ela não há como forjar o token do vizinho.",
  );
} else {
  const noBanco = await rest("clientes?select=user_id", { token: estrangeiro });
  marca(
    noBanco.status === 200 && Array.isArray(noBanco.corpo) && noBanco.corpo.length === 0,
    `PostgREST devolve VAZIO para o token estrangeiro (HTTP ${noBanco.status})`,
    noBanco.corpo,
  );

  const noNode = await api("/address", estrangeiro);
  if (noNode.rede) {
    pula(
      `serviço Node em ${API} responde 403 a token sem vínculo`,
      `não consegui falar com ${API} (${noNode.rede}). Suba com \`npm run dev:api\` ` +
        "e rode de novo — a fronteira do banco acima já foi conferida.",
    );
  } else if (noNode.status === 503) {
    /**
     * 503 aqui NÃO é reprovação: é o serviço Node dizendo que não tem como
     * verificar um token HS256 — ele roda contra uma instância que assina em
     * ES256/RS256 e está (corretamente) sem `SUPABASE_JWT_SECRET`. O token
     * forjado acima é HS256 por construção, então esta sonda não se aplica
     * àquele deploy. Reprovar seria um vermelho permanente e falso.
     */
    pula(
      `serviço Node em ${API} responde 403 a token sem vínculo`,
      "o serviço respondeu 503: ele verifica token por JWKS (ES256/RS256) e não " +
        "tem SUPABASE_JWT_SECRET. O token forjado aqui é HS256, então esta seção " +
        "não se aplica a este deploy. A fronteira do banco acima já foi conferida.",
    );
  } else {
    marca(
      noNode.status === 403,
      `serviço Node responde 403 (e não 200 nem 500) — HTTP ${noNode.status}`,
      noNode.corpo,
    );
    // A mensagem é parte do contrato, não enfeite: sem ela este 403 fica
    // indistinguível de "assinatura inválida" no log de quem depura, e o
    // sintoma na loja é "entrei mas não vejo nada".
    marca(
      typeof noNode.corpo?.message === "string" && /vinculada a esta loja/i.test(noNode.corpo.message),
      "e diz por quê, com a frase que a tela mostra",
      noNode.corpo,
    );
  }

  /**
   * FORA do `else` de proposito: esta metade usa um token EMITIDO PELO GoTrue,
   * e portanto vale nos dois desenhos de assinatura. Deixa-la la dentro faria
   * um deploy que verifica por JWKS (onde o token forjado acima vira 503)
   * perder justamente a checagem que ainda se aplica a ele.
   */
  if (!noNode.rede && tokenCliente) {
    /**
     * O CRITÉRIO É `!== 403`, E NÃO `=== 200` — a diferença é o que separa
     * esta sonda de um falso vermelho permanente.
     *
     * O que está sendo medido é o PORTÃO: `isAuthenticated` deixou passar
     * quem tem vínculo. O que vem depois do portão é o controller, e hoje
     * TODOS eles estão mortos contra o banco migrado (consultam as tabelas
     * antigas em inglês, que as migrações não criam — ver docs/producao.md
     * §1.1). Exigir 200 aqui faria esta linha reprovar até a F4 por um motivo
     * que nada tem a ver com autenticação, e uma checagem que vive vermelha
     * deixa de ser lida.
     *
     * 500 aqui é o repositório morto; 403 seria a defesa recusando quem
     * deveria entrar — e é só isso que esta linha promete distinguir.
     */
    const legitimo = await api("/address", tokenCliente);
    marca(
      legitimo.status !== 403,
      `o mesmo endpoint NÃO barra quem tem vínculo (HTTP ${legitimo.status}` +
        `${legitimo.status >= 500 ? " — é o repositório morto da F4, não o portão" : ""})`,
      legitimo.corpo,
    );
  }
}

// ── 6. A fusão da sacola anônima no login ───────────────────────────────────
//
// A RPC `fundir_sacola` (0007) SOMA — ela não é idempotente, e não tem como
// ser: a lista do `localStorage` não carrega identidade nenhuma, então chamar
// duas vezes soma duas vezes. Quem impede a segunda soma é a BASE gravada no
// navegador (`cart:na_conta`), e é isso que esta seção mede: não um evento
// repetido, mas a SEQUÊNCIA de uma segunda carga de página, que é onde o
// desastre aconteceria em câmera lenta.
//
// Escreve em `canastra.carrinho_itens`, dentro da conta de teste, e APAGA o que
// escreveu no fim — todas as linhas da sonda levam `moagem = 'sonda-verifica-rls'`.
console.log("\n=== 6. Fusão da sacola: uma vez, e só uma ===");

const MOAGEM_SONDA = "sonda-verifica-rls";

/**
 * O que ainda não está na conta — a mesma conta que `calcularPendentes` faz em
 * `frontend/lib/sacola/fusao.ts`, reduzida ao que a sonda precisa.
 *
 * A versão que vale é a de lá, e ela tem teste próprio no vitest. Esta cópia
 * existe para REPRODUZIR A SEQUÊNCIA do navegador contra o banco de verdade: o
 * que está sendo medido aqui é o que sobra em `carrinho_itens` depois de duas
 * cargas de página, e isso nenhum teste de unidade alcança.
 */
const chaveDoItem = (i) => `${i.produto_id}|${i.moagem ?? ""}`;
function pendentes(local, naConta) {
  const base = new Map(naConta.map((i) => [chaveDoItem(i), i.quantidade]));
  return local
    .map((i) => ({ ...i, quantidade: i.quantidade - (base.get(chaveDoItem(i)) ?? 0) }))
    .filter((i) => i.quantidade > 0);
}

if (!tokenCliente) {
  pula("fusão da sacola", "sem VERIFICA_EMAIL_CLIENTE/VERIFICA_SENHA_CLIENTE não há conta para fundir.");
} else {
  const cat = await rest("produtos_publicos?select=produto_id,nome,preco&limit=1", {
    token: tokenCliente,
  });
  const produto = Array.isArray(cat.corpo) ? cat.corpo[0] : null;

  if (!produto) {
    pula("fusão da sacola", "não consegui um produto do catálogo para montar a sonda.");
  } else {
    const limpar = () =>
      rest(`carrinho_itens?moagem=eq.${MOAGEM_SONDA}`, {
        token: tokenCliente,
        metodo: "DELETE",
        prefer: "return=minimal",
      });
    const naSacola = async () => {
      const r = await rest(`carrinho_itens?select=quantidade&moagem=eq.${MOAGEM_SONDA}`, {
        token: tokenCliente,
      });
      return Array.isArray(r.corpo) ? r.corpo : [];
    };
    const fundir = (itens) =>
      rest("rpc/fundir_sacola", { token: tokenCliente, metodo: "POST", corpo: { itens } });

    // Resto de uma execução anterior interrompida no meio: sem isto, a primeira
    // conferência acharia 3 a mais e acusaria falha onde não há.
    await limpar();

    const sacolaAnonima = [
      {
        produto_id: produto.produto_id,
        quantidade: 3,
        preco: produto.preco,
        nome: produto.nome,
        moagem: MOAGEM_SONDA,
      },
    ];

    // ── carga 1: a pessoa entra. Não há base, então tudo é pendente.
    const primeira = pendentes(sacolaAnonima, []);
    const f1 = await fundir(primeira);
    marca(f1.status < 400, `fusão no login (HTTP ${f1.status})`, f1.corpo);

    const depois1 = await naSacola();
    marca(
      depois1.length === 1 && Number(depois1[0].quantidade) === 3,
      `o item entrou UMA vez (${depois1.length} linha(s), qtd ${depois1[0]?.quantidade})`,
      depois1,
    );

    // A base é gravada junto com a sacola relida da conta. Daqui para a frente,
    // o navegador conhece o que já está lá.
    const base = sacolaAnonima;

    // ── carga 2: outra carga de página, outra sequência inteira. É aqui que a
    // sacola dobraria — `INITIAL_SESSION` dispara de novo a cada carga.
    const segunda = pendentes(sacolaAnonima, base);
    marca(segunda.length === 0, "a segunda carga não tem NADA pendente para mandar", segunda);
    if (segunda.length) await fundir(segunda);

    const depois2 = await naSacola();
    marca(
      depois2.length === 1 && Number(depois2[0].quantidade) === 3,
      `e a sacola continua com 3 (qtd ${depois2[0]?.quantidade})`,
      depois2,
    );

    // ── contraprova: a base se perde (limpeza parcial de dados do site, uma
    // extensão, um script de QA). A MESMA sacola volta a parecer pendente. Isto
    // não é bug desta sonda: é a medida de QUANTO a base sustenta, e a razão de
    // `cart:na_conta` existir. Se esta linha reprovar, a RPC virou idempotente
    // sem ninguém contar — releia a 0007 antes de comemorar.
    const semBase = pendentes(sacolaAnonima, []);
    await fundir(semBase);
    const depois3 = await naSacola();
    marca(
      depois3.length === 1 && Number(depois3[0].quantidade) === 6,
      `sem a base, a MESMA sacola DOBRA (qtd ${depois3[0]?.quantidade}) — a trava é o navegador, não a RPC`,
      depois3,
    );

    const apagou = await limpar();
    marca(apagou.status === 204, `sonda removida de carrinho_itens (HTTP ${apagou.status})`, apagou.corpo);
  }
}

// ── e a fusão recusada: quem não é cliente desta loja não funde.
//
// Fora do bloco acima de propósito: esta metade não precisa de conta de teste,
// só do token forjado — ela roda mesmo na degradação anônima.
//
// O QUE ESTÁ SENDO MEDIDO É O ERRO, e não a ausência de escrita. `fusao.ts` só
// apaga `localStorage["cart"]` DEPOIS de a RPC voltar sem exceção: um 200 que
// não escrevesse nada faria o módulo apagar a sacola anônima e a pessoa perderia
// os itens sem erro, sem log e sem 400 — exatamente a falha que aquele arquivo
// existe para impedir. 42501 é o mesmo código que a RLS usaria, então a tela
// trata um caso só.
if (estrangeiro) {
  const recusa = await rest("rpc/fundir_sacola", {
    token: estrangeiro,
    metodo: "POST",
    corpo: { itens: [{ produto_id: randomUUID(), quantidade: 1, moagem: MOAGEM_SONDA }] },
  });
  marca(
    recusa.status >= 400 && recusa.corpo?.code === "42501",
    `fusão de quem não tem vínculo FALHA alto (HTTP ${recusa.status}, ${recusa.corpo?.code}) — ` +
      "é o erro que preserva a sacola local",
    recusa.corpo,
  );
} else {
  pula("fusão recusada a quem não é cliente", "SUPABASE_JWT_SECRET não está definida.");
}

console.log(
  `\n=== ${ok} ok, ${falhou} falha(s)` + (pulados ? `, ${pulados} pulado(s)` : "") + " ===\n",
);

if (!CONTAS.cliente.email || !CONTAS.admin.email) {
  console.log(
    "Falta conta de teste: defina VERIFICA_EMAIL_CLIENTE, VERIFICA_SENHA_CLIENTE,\n" +
      "VERIFICA_EMAIL_ADMIN e VERIFICA_SENHA_ADMIN para exercer as seções 2 a 6.\n",
  );
}

/**
 * NOTA PARA QUEM FOR REFAZER A FUSÃO À MÃO, no navegador.
 *
 * Ela custou um diagnóstico errado uma vez e custaria de novo: desde a F2 a
 * sacola vive em TRÊS chaves de `localStorage`, e limpar só a primeira faz a
 * fusão parecer quebrada quando está funcionando exatamente como deve.
 */
console.log(
  "Refazendo a fusão à mão no navegador, limpe as TRÊS chaves de localStorage:\n" +
    "  · cart          — a sacola em si\n" +
    "  · cart:na_conta — o que a fusão já sabe estar na conta (a base)\n" +
    "  · cart:fundindo — a trava entre abas\n" +
    "Limpar só `cart` deixa a base de pé: a fusão calcula ZERO pendente, não\n" +
    "chama a RPC, e parece quebrada — está certa. Limpar só a base faz a mesma\n" +
    "sacola ser somada de novo (é a contraprova da §6). Limpe as três, ou nenhuma.\n",
);

process.exit(falhou ? 1 : 0);
