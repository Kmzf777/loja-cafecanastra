"use strict";

/**
 * Os DOIS caminhos de verificacao de token, e a impossibilidade de cruza-los.
 *
 * POR QUE ESTE ARQUIVO EXISTE SEPARADO DE `autenticacao.test.js`. Aquele sobe um
 * Postgres embarcado porque a pergunta dele e "existe linha nesta tabela?" — um
 * duble responderia o que o teste mandasse e provaria so que o `if` funciona. A
 * pergunta AQUI e outra: "esta assinatura fecha, e contra qual chave?". Isso e
 * criptografia e roteamento, nao banco. Um duble do pool e legitimo neste
 * arquivo — e o preco de arrastar um cluster inteiro para testar `jwt.verify`
 * seria pagar dois minutos e alguns gigabytes por um `assert` de 403.
 *
 * O CASO QUE IMPORTA MAIS TEM NOME: alg-confusion. Com duas familias de chave em
 * cena ao mesmo tempo (o segredo HS256 do stack self-hosted e a chave publica
 * ES256 do projeto hospedado), o ataque classico e forjar um token com
 * `alg: HS256` assinado com a CHAVE PUBLICA como segredo de HMAC — a chave e
 * publica, entao o atacante a tem. Os testes de "chave publica virando segredo
 * de HMAC" sao o motivo de este arquivo existir.
 */

const { test, beforeEach, after } = require("node:test");
const assert = require("node:assert/strict");
const {
  generateKeyPairSync,
  createHmac,
  createPublicKey,
} = require("node:crypto");
const jwt = require("jsonwebtoken");

/**
 * O pool entra por `require.cache` ANTES do middleware ser carregado.
 *
 * `isAuthenticated` faz `require("../pgPool")` no topo, e `pgPool.js` le
 * `DATABASE_URL` no momento em que e carregado. Sem esta substituicao, so
 * carregar o middleware abriria um pool contra o banco de desenvolvimento da
 * maquina de quem roda o teste.
 */
const caminhoDoPool = require.resolve("../src/pgPool.js");
let vinculoRespondido = { cliente: true, admin: false };
require.cache[caminhoDoPool] = {
  id: caminhoDoPool,
  filename: caminhoDoPool,
  loaded: true,
  exports: { query: async () => ({ rows: [vinculoRespondido] }) },
};

const chaves = require("../src/utils/chavesDoGoTrue.js");
const isAuthenticated = require("../src/middleware/isAuthenticated.js");

const ANA = "aaaaaaaa-0000-0000-0000-000000000001";
const SEGREDO = "segredo-de-teste-do-gotrue-com-32+-caracteres";
const KID = "b942219c-b38d-49b5-a839-5c3cd3e4270d";

/** A JWKS LITERAL do projeto hospedado da loja, copiada da resposta real. */
const JWKS_REAL = {
  keys: [
    {
      alg: "ES256",
      crv: "P-256",
      ext: true,
      key_ops: ["verify"],
      kid: KID,
      kty: "EC",
      use: "sig",
      x: "VSmmY6ua48TChwHOqjMgk0wBxQppYJcFqtmsDMxzHIU",
      y: "3XaBb6xNEZsYQXxfpcdKo0cxDh2xZ-J9VsQCAZh50Dk",
    },
  ],
};

/** Par proprio, para conseguir ASSINAR (do projeto real so temos a publica). */
const par = generateKeyPairSync("ec", { namedCurve: "P-256" });
const JWK_PUBLICA = { ...par.publicKey.export({ format: "jwk" }), kid: KID, use: "sig", alg: "ES256" };

function respostaFalsa() {
  const res = { codigo: null, corpo: null };
  res.sendStatus = (c) => ((res.codigo = c), res);
  res.status = (c) => ((res.codigo = c), res);
  res.json = (c) => ((res.corpo = c), res);
  return res;
}

async function chamar(token) {
  const res = respostaFalsa();
  const req = { headers: { authorization: `Bearer ${token}` } };
  let seguiu = false;
  await isAuthenticated(req, res, () => {
    seguiu = true;
  });
  return { seguiu, codigo: res.codigo, corpo: res.corpo, req };
}

/** Um GoTrue de mentira: conta quantas vezes foi procurado e o que responde. */
function gotrue(resposta) {
  const registro = { buscas: 0 };
  registro.buscar = async () => {
    registro.buscas += 1;
    if (typeof resposta === "function") return resposta(registro.buscas);
    return resposta;
  };
  return registro;
}

const ok = (corpo) => ({
  ok: true,
  status: 200,
  json: async () => corpo,
});

beforeEach(() => {
  chaves.paraTestes.limpar();
  chaves.paraTestes.definirBuscador(async () => {
    throw new Error("nenhum buscador definido neste teste");
  });
  process.env.SUPABASE_URL = "https://hmxbdpmgwmbygwmngusy.supabase.co";
  process.env.SUPABASE_JWT_SECRET = SEGREDO;
  vinculoRespondido = { cliente: true, admin: false };
});

after(() => {
  chaves.paraTestes.definirBuscador(null);
});

/* --------------------------------------------------------------------------
 * A forma da chave: `crypto.createPublicKey` da conta do que o Supabase publica
 * -------------------------------------------------------------------------- */

test("a JWKS real do projeto hospedado vira KeyObject sem biblioteca nenhuma", () => {
  // Se este teste cair, a escolha de nao instalar `jwks-rsa`/`jose` deixou de
  // valer e a decisao precisa ser revista — nao o codigo.
  const chave = createPublicKey({ key: JWKS_REAL.keys[0], format: "jwk" });

  assert.equal(chave.type, "public");
  assert.equal(chave.asymmetricKeyType, "ec");
  assert.equal(chave.asymmetricKeyDetails.namedCurve, "prime256v1");
});

/* --------------------------------------------------------------------------
 * O caminho assimetrico: o projeto hospedado
 * -------------------------------------------------------------------------- */

test("token ES256 com kid publicado no JWKS entra", async () => {
  const g = gotrue(ok({ keys: [JWK_PUBLICA] }));
  chaves.paraTestes.definirBuscador(g.buscar);

  const token = jwt.sign({ sub: ANA, role: "authenticated" }, par.privateKey, {
    algorithm: "ES256",
    keyid: KID,
    expiresIn: "1h",
  });

  const r = await chamar(token);

  assert.equal(r.seguiu, true, `esperava entrar, respondeu ${r.codigo}`);
  assert.equal(r.req.user.userId, ANA);
  assert.equal(g.buscas, 1);
});

test("o JWKS e buscado UMA vez para varias requisicoes seguidas", async () => {
  const g = gotrue(ok({ keys: [JWK_PUBLICA] }));
  chaves.paraTestes.definirBuscador(g.buscar);

  const token = jwt.sign({ sub: ANA, role: "authenticated" }, par.privateKey, {
    algorithm: "ES256",
    keyid: KID,
    expiresIn: "1h",
  });

  // Simultaneas de proposito: sem a promessa compartilhada, tres requisicoes
  // numa subida fria virariam tres idas ao GoTrue.
  await Promise.all([chamar(token), chamar(token), chamar(token)]);
  await chamar(token);

  assert.equal(g.buscas, 1);
});

test("token ES256 VENCIDO responde 401, nao 403, tambem por este caminho", async () => {
  chaves.paraTestes.definirBuscador(gotrue(ok({ keys: [JWK_PUBLICA] })).buscar);

  const token = jwt.sign({ sub: ANA, role: "authenticated" }, par.privateKey, {
    algorithm: "ES256",
    keyid: KID,
    expiresIn: "-10s",
  });

  assert.equal((await chamar(token)).codigo, 401);
});

test("kid desconhecido e 403, e a rebusca tem piso: nao vira uma ida por requisicao", async () => {
  const g = gotrue(ok({ keys: [JWK_PUBLICA] }));
  chaves.paraTestes.definirBuscador(g.buscar);

  const outro = generateKeyPairSync("ec", { namedCurve: "P-256" });
  const forasteiro = jwt.sign({ sub: ANA, role: "authenticated" }, outro.privateKey, {
    algorithm: "ES256",
    keyid: "kid-que-nao-existe",
    expiresIn: "1h",
  });

  for (let i = 0; i < 5; i += 1) {
    const r = await chamar(forasteiro);
    assert.equal(r.codigo, 403, "kid desconhecido é 403: o token não é desta instância");
  }

  // A primeira busca é a da subida fria; a segunda é a tentativa legítima de
  // rotação. Da terceira em diante o piso segura — senão um `kid` inventado por
  // requisição viraria uma alavanca de tráfego contra o próprio GoTrue.
  assert.equal(g.buscas, 2);
});

test("rotacao de chave: um kid novo provoca UMA rebusca e passa a valer", async () => {
  const novoPar = generateKeyPairSync("ec", { namedCurve: "P-256" });
  const jwkNova = {
    ...novoPar.publicKey.export({ format: "jwk" }),
    kid: "kid-novo",
    use: "sig",
    alg: "ES256",
  };

  const g = gotrue((n) => ok({ keys: n === 1 ? [JWK_PUBLICA] : [JWK_PUBLICA, jwkNova] }));
  chaves.paraTestes.definirBuscador(g.buscar);

  const antigo = jwt.sign({ sub: ANA, role: "authenticated" }, par.privateKey, {
    algorithm: "ES256",
    keyid: KID,
    expiresIn: "1h",
  });
  const novo = jwt.sign({ sub: ANA, role: "authenticated" }, novoPar.privateKey, {
    algorithm: "ES256",
    keyid: "kid-novo",
    expiresIn: "1h",
  });

  assert.equal((await chamar(antigo)).seguiu, true);
  assert.equal((await chamar(novo)).seguiu, true, "a chave nova tem de passar a valer");
  // A chave antiga continua valendo: rotação no GoTrue não invalida no ato o
  // token que já está no bolso de quem está logado.
  assert.equal((await chamar(antigo)).seguiu, true);
  assert.equal(g.buscas, 2);
});

/* --------------------------------------------------------------------------
 * Falhar FECHADO, e de forma distinguivel: 503 nao e 403
 * -------------------------------------------------------------------------- */

test("JWKS fora do ar responde 503, e nao 403", async () => {
  // 403 diria "sua credencial não serve" a quem tem uma credencial impecável, e
  // mandaria quem depura investigar a conta. O problema é nosso.
  chaves.paraTestes.definirBuscador(async () => {
    throw new Error("ECONNREFUSED");
  });

  const token = jwt.sign({ sub: ANA, role: "authenticated" }, par.privateKey, {
    algorithm: "ES256",
    keyid: KID,
    expiresIn: "1h",
  });

  const r = await chamar(token);

  assert.equal(r.codigo, 503);
  assert.match(r.corpo.message, /verificar sua credencial/i);
});

test("JWKS respondendo HTTP 500 tambem e 503", async () => {
  chaves.paraTestes.definirBuscador(async () => ({
    ok: false,
    status: 500,
    json: async () => ({}),
  }));

  const token = jwt.sign({ sub: ANA, role: "authenticated" }, par.privateKey, {
    algorithm: "ES256",
    keyid: KID,
    expiresIn: "1h",
  });

  assert.equal((await chamar(token)).codigo, 503);
});

test("instancia sem endpoint de JWKS (404) e conjunto vazio, e isso e 403", async () => {
  // 404 é RESPOSTA, não falha: o GoTrue daquela versão não tem o endpoint.
  // Guardar o vazio evita uma ida por requisição, e um token assimétrico ali
  // realmente não é desta instância.
  const g = gotrue({ ok: false, status: 404, json: async () => ({}) });
  chaves.paraTestes.definirBuscador(g.buscar);

  const token = jwt.sign({ sub: ANA, role: "authenticated" }, par.privateKey, {
    algorithm: "ES256",
    keyid: KID,
    expiresIn: "1h",
  });

  assert.equal((await chamar(token)).codigo, 403);
  assert.equal((await chamar(token)).codigo, 403);
  assert.equal(g.buscas, 2, "a segunda é a tentativa de rotação; da terceira em diante o piso segura");
});

test("stack self-hosted responde {\"keys\":[]} — e o HS256 continua entrando", async () => {
  // É o que o handler do GoTrue faz: ele PULA toda chave HMAC. Por isso a
  // escolha do caminho tem de sair do `alg` do token, e não de "tenta o JWKS
  // primeiro".
  chaves.paraTestes.definirBuscador(gotrue(ok({ keys: [] })).buscar);

  const hs = jwt.sign({ sub: ANA, role: "authenticated" }, SEGREDO, {
    algorithm: "HS256",
    expiresIn: "1h",
  });
  const es = jwt.sign({ sub: ANA, role: "authenticated" }, par.privateKey, {
    algorithm: "ES256",
    keyid: KID,
    expiresIn: "1h",
  });

  assert.equal((await chamar(hs)).seguiu, true);
  assert.equal((await chamar(es)).codigo, 403);
});

test("projeto hospedado sem SUPABASE_JWT_SECRET: token HS256 e 503, ES256 entra", async () => {
  // Sem o segredo, um token HS256 não é julgado — é INJULGÁVEL. Dizer 403 seria
  // afirmar algo que este processo não tem como saber.
  delete process.env.SUPABASE_JWT_SECRET;
  chaves.paraTestes.definirBuscador(gotrue(ok({ keys: [JWK_PUBLICA] })).buscar);

  const hs = jwt.sign({ sub: ANA, role: "authenticated" }, SEGREDO, {
    algorithm: "HS256",
    expiresIn: "1h",
  });
  const es = jwt.sign({ sub: ANA, role: "authenticated" }, par.privateKey, {
    algorithm: "ES256",
    keyid: KID,
    expiresIn: "1h",
  });

  assert.equal((await chamar(hs)).codigo, 503);
  assert.equal((await chamar(es)).seguiu, true);
});

/* --------------------------------------------------------------------------
 * Os fios nao se cruzam: alg-confusion
 * -------------------------------------------------------------------------- */

/** Forja um JWT `alg: HS256` usando `material` como segredo de HMAC. */
function forjarHS256(material, extras = {}) {
  const cabecalho = Buffer.from(
    JSON.stringify({ alg: "HS256", kid: KID, typ: "JWT", ...extras }),
  ).toString("base64url");
  const corpo = Buffer.from(
    JSON.stringify({
      sub: ANA,
      role: "authenticated",
      exp: Math.floor(Date.now() / 1000) + 3600,
    }),
  ).toString("base64url");
  const assinatura = createHmac("sha256", material)
    .update(`${cabecalho}.${corpo}`)
    .digest("base64url");
  return `${cabecalho}.${corpo}.${assinatura}`;
}

test("a CHAVE PUBLICA usada como segredo de HMAC nao entra por forma nenhuma", async () => {
  // O ataque: `alg: HS256` + `kid` de uma chave publicada. Se a escolha do
  // algoritmo saísse do cabeçalho, o serviço pegaria a chave pública pelo `kid`
  // e a usaria como segredo — e o atacante, que tem a chave pública, entraria
  // como qualquer pessoa. Aqui `alg: HS256` só alcança SUPABASE_JWT_SECRET.
  chaves.paraTestes.definirBuscador(gotrue(ok({ keys: [JWK_PUBLICA] })).buscar);

  const materiais = {
    PEM: par.publicKey.export({ type: "spki", format: "pem" }),
    DER: par.publicKey.export({ type: "spki", format: "der" }),
    "JWK em JSON": JSON.stringify(JWK_PUBLICA),
    "x||y cru": Buffer.concat([
      Buffer.from(JWK_PUBLICA.x, "base64url"),
      Buffer.from(JWK_PUBLICA.y, "base64url"),
    ]),
  };

  for (const [nome, material] of Object.entries(materiais)) {
    const r = await chamar(forjarHS256(material));
    assert.equal(r.seguiu, false, `${nome} entrou — alg-confusion aberta`);
    assert.equal(r.codigo, 403, `${nome}`);
  }
});

test("o token ES256 legitimo tambem nao passa pelo caminho do segredo", async () => {
  // O reverso do teste acima: sem JWKS configurada, o token assimétrico não
  // "cai" para o segredo. Ele não é verificável, e não verificável é recusa.
  delete process.env.SUPABASE_URL;

  const token = jwt.sign({ sub: ANA, role: "authenticated" }, par.privateKey, {
    algorithm: "ES256",
    keyid: KID,
    expiresIn: "1h",
  });

  assert.equal((await chamar(token)).seguiu, false);
});

test("token do segredo legado nao passa pelo caminho do JWKS: a anon key continua barrada", async () => {
  // A `anon key` do projeto hospedado AINDA é um JWT HS256 do segredo legado —
  // os dois formatos convivem hoje. Ela é verificável (o segredo está
  // configurado) e mesmo assim não entra: não tem `sub`.
  chaves.paraTestes.definirBuscador(gotrue(ok({ keys: [JWK_PUBLICA] })).buscar);

  const anon = jwt.sign({ role: "anon", iss: "supabase" }, SEGREDO, {
    algorithm: "HS256",
    expiresIn: "10y",
  });

  assert.equal((await chamar(anon)).codigo, 403);
});

test("alg fora das tres familias conhecidas e recusado antes de tocar em chave", async () => {
  chaves.paraTestes.definirBuscador(async () => {
    assert.fail("não deveria buscar JWKS para um alg que não é verificável");
  });

  const none =
    `${Buffer.from(JSON.stringify({ alg: "none", typ: "JWT" })).toString("base64url")}.` +
    `${Buffer.from(JSON.stringify({ sub: ANA, role: "authenticated" })).toString("base64url")}.`;
  const hs512 = jwt.sign({ sub: ANA, role: "authenticated" }, SEGREDO, {
    algorithm: "HS512",
    expiresIn: "1h",
  });

  assert.equal((await chamar(none)).codigo, 403);
  assert.equal((await chamar(hs512)).codigo, 403);
});

test("token ES256 assinado por chave que NAO e a do kid e recusado", async () => {
  chaves.paraTestes.definirBuscador(gotrue(ok({ keys: [JWK_PUBLICA] })).buscar);

  const impostor = generateKeyPairSync("ec", { namedCurve: "P-256" });
  const token = jwt.sign({ sub: ANA, role: "authenticated" }, impostor.privateKey, {
    algorithm: "ES256",
    keyid: KID,
    expiresIn: "1h",
  });

  assert.equal((await chamar(token)).codigo, 403);
});

test("uma JWKS que declara `alg` incompativel com o tipo da chave e descartada", async () => {
  // Chave EC anunciada como RS256. Usá-la mesmo assim deixaria quem publica a
  // JWKS escolher o algoritmo por outra porta.
  chaves.paraTestes.definirBuscador(
    gotrue(ok({ keys: [{ ...JWK_PUBLICA, alg: "RS256" }] })).buscar,
  );

  const token = jwt.sign({ sub: ANA, role: "authenticated" }, par.privateKey, {
    algorithm: "ES256",
    keyid: KID,
    expiresIn: "1h",
  });

  assert.equal((await chamar(token)).codigo, 403);
});

/* --------------------------------------------------------------------------
 * O que valia antes continua valendo, nos dois caminhos
 * -------------------------------------------------------------------------- */

test("sem `sub` em formato de uuid nao entra, nem vindo do JWKS", async () => {
  chaves.paraTestes.definirBuscador(gotrue(ok({ keys: [JWK_PUBLICA] })).buscar);

  const token = jwt.sign({ sub: "nao-e-uuid", role: "authenticated" }, par.privateKey, {
    algorithm: "ES256",
    keyid: KID,
    expiresIn: "1h",
  });

  assert.equal((await chamar(token)).codigo, 403);
});

test("`role` diferente de authenticated nao entra, nem vindo do JWKS", async () => {
  chaves.paraTestes.definirBuscador(gotrue(ok({ keys: [JWK_PUBLICA] })).buscar);

  const token = jwt.sign({ sub: ANA, role: "admin" }, par.privateKey, {
    algorithm: "ES256",
    keyid: KID,
    expiresIn: "1h",
  });

  assert.equal((await chamar(token)).codigo, 403);
});

test("sem linha em canastra.clientes nao entra, nem vindo do JWKS", async () => {
  // A ESTRANHA de `autenticacao.test.js`, agora com token assimétrico: a troca
  // de algoritmo não afrouxou o vínculo.
  chaves.paraTestes.definirBuscador(gotrue(ok({ keys: [JWK_PUBLICA] })).buscar);
  vinculoRespondido = { cliente: false, admin: false };

  const token = jwt.sign({ sub: ANA, role: "authenticated" }, par.privateKey, {
    algorithm: "ES256",
    keyid: KID,
    expiresIn: "1h",
  });

  const r = await chamar(token);

  assert.equal(r.codigo, 403);
  assert.match(r.corpo.message, /vinculada/i);
});
