"use strict";

/**
 * O contrato HTTP da vitrine: `GET /vitrine` público e `PUT /vitrine` de admin.
 *
 * O TESTE RODA O ROUTER DE VERDADE, e não só o repositório. `vitrine.routes.js`
 * é chamado como o Express o chamaria — com um `req`/`res` de mentira, mas com
 * a PILHA REAL de middlewares no meio. Isso é o que faz "PUT sem token responde
 * 401" ser uma afirmação sobre a ROTA e não sobre `isAuthenticated`: um dia em
 * que alguém montar o PUT sem os guardas, um teste de repositório continuaria
 * verde e este fica vermelho.
 *
 * PADRÃO DE painel_pedidos.test.js, e o detalhe que quebra tudo se for
 * esquecido: `process.env.DATABASE_URL` é definida ANTES do `require` dos
 * módulos de `src/` — o `pgPool` lê a variável no momento do require, e um
 * require no topo do arquivo pegaria `undefined` e todo teste falharia com
 * "connection refused" apontando para lugar nenhum.
 *
 * A ARMADILHA QUE ESTE ARQUIVO EXISTE PARA NÃO REPETIR. `PUT /config`
 * (`repositories/configRepository.js`) parece total e é parcial ao contrário: o
 * corpo chega por multipart, campo enviado VAZIO (`''`) sobrescreve, e
 * `Number('')` é `0` — que no mínimo de frete grátis desliga o frete grátis da
 * loja inteira. `PUT /vitrine` nasce com a regra explícita, e o teste
 * "PUT parcial NÃO apaga o que não veio" é o que a prende:
 *
 *   undefined (campo AUSENTE do corpo) .... não mexer
 *   null ou "" ............................ gravar vazio
 */

const { test, before, after, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const jwt = require("jsonwebtoken");
const { subirPostgres } = require("./ajuda/postgres.js");
const { aplicarMigracoes } = require("../db/migrar.js");

let bd;
let vitrineRoutes;

const ANA = "aaaaaaaa-0000-0000-0000-000000000001";
const DORA = "dddddddd-0000-0000-0000-000000000004";

/**
 * Segredo de teste para assinar os tokens.
 *
 * HS256 de propósito: é o caminho do Supabase self-hosted, que é o alvo de
 * produção, e é o único que `isAuthenticated` resolve sem ir à rede buscar o
 * JWKS. Um token ES256 aqui faria o teste depender de um endpoint remoto.
 */
const SEGREDO = "segredo-de-teste-com-tamanho-suficiente-para-hs256";

function token(sub) {
  return jwt.sign({ sub, role: "authenticated" }, SEGREDO, { expiresIn: "1h" });
}

/**
 * Dublê de `res` com o que a pilha usa: status/json/send/sendStatus/setHeader.
 *
 * `terminou` é a peça que falta no molde de painel_pedidos.test.js e que este
 * arquivo precisa: chamando o ROUTER (e não o controller direto), não há como
 * saber que a requisição acabou a não ser observando a resposta. Sem isso, um
 * `await` no router retornaria antes de o handler assíncrono responder e as
 * asserções leriam `res.codigo === null`.
 */
function respostaFalsa() {
  const res = { codigo: null, corpo: null, cabecalhos: {} };
  let terminar;
  res.terminou = new Promise((resolve) => {
    terminar = resolve;
  });
  res.status = (codigo) => {
    res.codigo = codigo;
    return res;
  };
  res.json = (corpo) => {
    if (res.codigo === null) res.codigo = 200;
    res.corpo = corpo;
    terminar(res);
    return res;
  };
  res.send = (corpo) => {
    if (res.codigo === null) res.codigo = 200;
    res.corpo = corpo;
    terminar(res);
    return res;
  };
  res.sendStatus = (codigo) => {
    res.codigo = codigo;
    terminar(res);
    return res;
  };
  res.setHeader = (nome, valor) => {
    res.cabecalhos[String(nome).toLowerCase()] = valor;
    return res;
  };
  return res;
}

/**
 * Uma requisição pela pilha real do router montado em `/vitrine`.
 *
 * `url: "/"` porque é o que o Express entrega ao router depois de descontar o
 * prefixo do `app.use("/vitrine", ...)`; `originalUrl` fica com o caminho
 * inteiro só para o caso de algum middleware querer logá-lo.
 */
async function chamar({ metodo = "GET", corpo, sub = null } = {}) {
  const req = {
    method: metodo,
    url: "/",
    originalUrl: "/vitrine",
    headers: {},
    body: corpo,
  };
  if (sub) req.headers.authorization = `Bearer ${token(sub)}`;

  const res = respostaFalsa();

  // O `next` do router só é chamado quando NENHUMA rota casou. Corrê-lo contra
  // a resposta separa "a rota respondeu" de "a rota não existe" — que sem isto
  // seria um timeout mudo do node:test.
  const semRota = new Promise((resolve, reject) => {
    vitrineRoutes(req, res, (erro) => (erro ? reject(erro) : resolve("SEM ROTA")));
  });

  const desfecho = await Promise.race([res.terminou, semRota]);
  assert.notEqual(
    desfecho,
    "SEM ROTA",
    `nenhuma rota casou com ${metodo} /vitrine — a linha de registro sumiu de vitrine.routes.js`,
  );
  return res;
}

/** O estado do banco, lido por fora da rota — a prova de que gravou mesmo. */
async function noBanco() {
  const heroi = await bd.pool.query(
    "SELECT imagem_desktop, imagem_mobile FROM canastra.vitrine_heroi WHERE id = 1",
  );
  const textos = await bd.pool.query(
    `SELECT chave, locale, kicker, titulo, texto, rotulo_botao, destino, imagem_alt
       FROM canastra.vitrine_texto ORDER BY chave, locale`,
  );
  return { heroi: heroi.rows[0] || null, textos: textos.rows };
}

before(async () => {
  bd = await subirPostgres();
  await aplicarMigracoes(bd.pool);

  await bd.pool.query(
    `INSERT INTO auth.users (id, email) VALUES ($1,'ana@ex.com'), ($2,'dora@ex.com')`,
    [ANA, DORA],
  );
  await bd.pool.query(
    "INSERT INTO canastra.clientes (user_id, nome) VALUES ($1,'Ana'), ($2,'Dora')",
    [ANA, DORA],
  );
  await bd.pool.query("INSERT INTO canastra.admins (user_id) VALUES ($1)", [DORA]);

  process.env.SUPABASE_JWT_SECRET = SEGREDO;
  process.env.DATABASE_URL = bd.connectionString;

  vitrineRoutes = require("../src/routes/vitrine.routes.js");
}, { timeout: 120_000 });

after(async () => {
  await require("../src/pgPool.js").end().catch(() => {});
  await bd?.derrubar();
});

beforeEach(async () => {
  if (!bd) {
    throw new Error(
      "O Postgres nao subiu no before(); a causa real esta no erro daquele hook.",
    );
  }
  // Ao contrário dos testes de RLS, aqui a escrita é DE VERDADE: a rota usa o
  // pool do serviço, sem transação a desfazer. Cada teste começa com as duas
  // tabelas vazias — que é também o estado de uma loja recém-instalada, o mais
  // importante de todos para o fallback.
  await bd.pool.query("TRUNCATE canastra.vitrine_texto, canastra.vitrine_heroi");
});

/* --------------------------------------------------------------------------
 * GET — público, e com forma fixa
 * -------------------------------------------------------------------------- */

test("GET /vitrine é público: sem token, responde 200", async () => {
  // A home é estática (SSG com revalidação) e é servida antes de qualquer
  // login. Se esta rota exigisse token, o herói nasceria vazio para todo
  // visitante — e o erro apareceria como conteúdo faltando, não como 401.
  const res = await chamar({ metodo: "GET" });
  assert.equal(res.codigo, 200);
});

test("GET /vitrine devolve as duas chaves e os três idiomas mesmo com a tabela vazia", async () => {
  // O CONTRATO INTEIRO EM UMA ASSERÇÃO. Chave sempre presente, valor `null`
  // quando não há linha: assim o consumidor nunca precisa checar EXISTÊNCIA de
  // chave, só de valor — e um `heroi.textos.es.titulo` nunca estoura com
  // "cannot read properties of undefined" na renderização da home.
  const res = await chamar({ metodo: "GET" });
  assert.deepEqual(res.corpo, {
    heroi: { imagem_desktop: null, imagem_mobile: null },
    textos: {
      heroi: { pt: null, en: null, es: null },
      barra_aviso: { pt: null, en: null, es: null },
    },
  });
});

test("GET /vitrine devolve o que está no banco, e só o idioma que existe", async () => {
  await bd.pool.query(
    `INSERT INTO canastra.vitrine_heroi (id, imagem_desktop, imagem_mobile)
     VALUES (1, 'https://cdn/d.jpg', 'https://cdn/m.jpg')`,
  );
  await bd.pool.query(
    `INSERT INTO canastra.vitrine_texto
       (chave, locale, kicker, titulo, texto, rotulo_botao, destino, imagem_alt)
     VALUES ('heroi','pt','Da Serra','Café de verdade','Torra do dia','Comprar','/produtos','Grãos'),
            ('barra_aviso','pt',NULL,NULL,'Frete grátis acima de R$ 149',NULL,NULL,NULL)`,
  );

  const res = await chamar({ metodo: "GET" });

  assert.deepEqual(res.corpo.heroi, {
    imagem_desktop: "https://cdn/d.jpg",
    imagem_mobile: "https://cdn/m.jpg",
  });
  assert.deepEqual(res.corpo.textos.heroi.pt, {
    kicker: "Da Serra",
    titulo: "Café de verdade",
    texto: "Torra do dia",
    rotulo_botao: "Comprar",
    destino: "/produtos",
    imagem_alt: "Grãos",
  });
  // Os idiomas sem linha continuam `null` — e não `{}` nem ausentes.
  assert.equal(res.corpo.textos.heroi.en, null);
  assert.equal(res.corpo.textos.heroi.es, null);
  assert.equal(res.corpo.textos.barra_aviso.en, null);
  assert.equal(res.corpo.textos.barra_aviso.pt.texto, "Frete grátis acima de R$ 149");
});

/* --------------------------------------------------------------------------
 * PUT — os dois guardas
 * -------------------------------------------------------------------------- */

test("PUT /vitrine sem token responde 401", async () => {
  const res = await chamar({ metodo: "PUT", corpo: { heroi: { imagem_desktop: "x" } } });
  assert.equal(res.codigo, 401);
  assert.deepEqual(await noBanco(), { heroi: null, textos: [] });
});

test("PUT /vitrine com token de cliente responde 403", async () => {
  // Ana é cliente DESTA loja — passa por `isAuthenticated` inteiro, inclusive
  // pela conferência de vínculo em `canastra.clientes`. O que a barra é a linha
  // que ela NÃO tem em `canastra.admins`. Ser administrador nunca é claim de
  // JWT: a instância do Supabase é compartilhada, e um token de projeto vizinho
  // carrega o que quiser em `user_metadata`.
  const res = await chamar({
    metodo: "PUT",
    sub: ANA,
    corpo: { heroi: { imagem_desktop: "invadido" } },
  });
  assert.equal(res.codigo, 403);
  assert.deepEqual(await noBanco(), { heroi: null, textos: [] });
});

test("PUT /vitrine com token de admin grava", async () => {
  const res = await chamar({
    metodo: "PUT",
    sub: DORA,
    corpo: {
      heroi: { imagem_desktop: "https://cdn/d.jpg", imagem_mobile: "https://cdn/m.jpg" },
      textos: { heroi: { pt: { titulo: "Café de verdade" } } },
    },
  });

  assert.equal(res.codigo, 200);
  const estado = await noBanco();
  assert.deepEqual(estado.heroi, {
    imagem_desktop: "https://cdn/d.jpg",
    imagem_mobile: "https://cdn/m.jpg",
  });
  assert.equal(estado.textos.length, 1);
  assert.equal(estado.textos[0].titulo, "Café de verdade");

  // A resposta do PUT tem a MESMA forma do GET, para o painel não precisar de
  // uma segunda ida ao servidor só para redesenhar o formulário.
  assert.deepEqual(res.corpo.heroi, {
    imagem_desktop: "https://cdn/d.jpg",
    imagem_mobile: "https://cdn/m.jpg",
  });
  assert.equal(res.corpo.textos.heroi.pt.titulo, "Café de verdade");
});

/* --------------------------------------------------------------------------
 * A armadilha do `PUT /config`, e as três formas dela
 * -------------------------------------------------------------------------- */

test("PUT /vitrine parcial NÃO apaga o que não veio", async () => {
  // O TESTE QUE ESTE ARQUIVO EXISTE PARA TER. Grava título e texto; depois
  // manda um PUT com SÓ o título. O texto tem de continuar lá.
  //
  // Foi exatamente isto que `PUT /config` errou: lá, campo que não veio no
  // corpo multipart chega como `''`, `''` não é `undefined`, e o UPDATE
  // sobrescreve. O gestor salva a barra de aviso e desliga o frete grátis da
  // loja sem tocar nele.
  await chamar({
    metodo: "PUT",
    sub: DORA,
    corpo: {
      heroi: { imagem_desktop: "https://cdn/d.jpg", imagem_mobile: "https://cdn/m.jpg" },
      textos: {
        heroi: {
          pt: {
            kicker: "Da Serra",
            titulo: "Café de verdade",
            texto: "Torra do dia",
            rotulo_botao: "Comprar",
            destino: "/produtos",
            imagem_alt: "Grãos",
          },
        },
      },
    },
  });

  const res = await chamar({
    metodo: "PUT",
    sub: DORA,
    corpo: { textos: { heroi: { pt: { titulo: "Café da Canastra" } } } },
  });
  assert.equal(res.codigo, 200);

  const { textos, heroi } = await noBanco();
  assert.deepEqual(textos[0], {
    chave: "heroi",
    locale: "pt",
    kicker: "Da Serra",
    titulo: "Café da Canastra", // o único que mudou
    texto: "Torra do dia",
    rotulo_botao: "Comprar",
    destino: "/produtos",
    imagem_alt: "Grãos",
  });

  // E `heroi` inteiro ausente do corpo não zera as imagens — a mesma regra um
  // nível acima, que é onde o descuido custaria a foto do topo da loja.
  assert.deepEqual(heroi, {
    imagem_desktop: "https://cdn/d.jpg",
    imagem_mobile: "https://cdn/m.jpg",
  });
});

test("PUT /vitrine com string vazia GRAVA vazio, e o fallback cuida", async () => {
  // A OUTRA METADE DA REGRA, e ela é tão importante quanto: se `''` também
  // fosse "não mexer", o gestor não teria como APAGAR um kicker que não quer
  // mais. Campo ausente e campo vazio são coisas diferentes, e a diferença é o
  // que separa "não mandei" de "quero em branco".
  //
  // `''` é normalizado para NULL na gravação de propósito: com duas
  // representações de "vazio" na mesma coluna, todo consumidor passaria a ter
  // de checar as duas para sempre — e o fallback da home é justamente uma
  // pergunta de "está vazio?".
  await chamar({
    metodo: "PUT",
    sub: DORA,
    corpo: { textos: { heroi: { pt: { kicker: "Da Serra", titulo: "Café" } } } },
  });

  await chamar({
    metodo: "PUT",
    sub: DORA,
    corpo: { textos: { heroi: { pt: { kicker: "" } } } },
  });

  let { textos } = await noBanco();
  assert.equal(textos[0].kicker, null, "string vazia grava vazio");
  assert.equal(textos[0].titulo, "Café", "e não encosta no que não veio");

  // `null` explícito faz a mesma coisa que `''` — as duas formas com que um
  // formulário representa "campo em branco" chegam ao mesmo lugar.
  await chamar({
    metodo: "PUT",
    sub: DORA,
    corpo: { textos: { heroi: { pt: { titulo: null } } } },
  });
  ({ textos } = await noBanco());
  assert.equal(textos[0].titulo, null);

  const res = await chamar({ metodo: "GET" });
  assert.deepEqual(res.corpo.textos.heroi.pt, {
    kicker: null,
    titulo: null,
    texto: null,
    rotulo_botao: null,
    destino: null,
    imagem_alt: null,
  });
});

test("PUT /vitrine com corpo vazio é um no-op, não um apagador", async () => {
  // O limite da regra: se "campo ausente = não mexer", então NENHUM campo
  // presente = não mexer em nada. Um formulário que envia `{}` por um bug de
  // serialização não pode zerar a vitrine.
  await chamar({
    metodo: "PUT",
    sub: DORA,
    corpo: {
      heroi: { imagem_desktop: "https://cdn/d.jpg" },
      textos: { barra_aviso: { pt: { texto: "Frete grátis" } } },
    },
  });

  const res = await chamar({ metodo: "PUT", sub: DORA, corpo: {} });
  assert.equal(res.codigo, 200);

  const { heroi, textos } = await noBanco();
  assert.equal(heroi.imagem_desktop, "https://cdn/d.jpg");
  assert.equal(textos[0].texto, "Frete grátis");
});

/* --------------------------------------------------------------------------
 * As recusas com frase, e não com SQLSTATE
 * -------------------------------------------------------------------------- */

test("PUT /vitrine recusa locale inválido com 400 e frase legível", async () => {
  // 'pt-BR' é o erro provável — e o CHECK do banco recusaria de qualquer forma,
  // com 23514. A validação aqui existe para a recusa chegar ao painel como
  // frase, e não como 500 com um SQLSTATE que ninguém sabe ler.
  const res = await chamar({
    metodo: "PUT",
    sub: DORA,
    corpo: { textos: { heroi: { "pt-BR": { titulo: "x" } } } },
  });

  assert.equal(res.codigo, 400);
  assert.match(res.corpo.error, /pt-BR/, "a frase precisa citar o valor recusado");
  assert.match(res.corpo.error, /pt.*en.*es/s, "e precisa dizer quais valem");
  assert.deepEqual(await noBanco(), { heroi: null, textos: [] });
});

test("PUT /vitrine recusa chave inválida com 400", async () => {
  const res = await chamar({
    metodo: "PUT",
    sub: DORA,
    corpo: { textos: { rodape: { pt: { titulo: "x" } } } },
  });

  assert.equal(res.codigo, 400);
  assert.match(res.corpo.error, /rodape/);
  assert.deepEqual(await noBanco(), { heroi: null, textos: [] });
});

test("PUT /vitrine recusa campo desconhecido com 400, em vez de ignorar em silêncio", async () => {
  // `title` no lugar de `titulo` é a mesma família de erro do 'pt-BR': aceito e
  // ignorado, o gestor salva, vê "salvo com sucesso" e o texto não muda —
  // sem nada em lugar nenhum apontando por quê.
  const res = await chamar({
    metodo: "PUT",
    sub: DORA,
    corpo: { textos: { heroi: { pt: { title: "x" } } } },
  });

  assert.equal(res.codigo, 400);
  assert.match(res.corpo.error, /title/);
  assert.deepEqual(await noBanco(), { heroi: null, textos: [] });
});

test("PUT /vitrine recusa valor que não é texto", async () => {
  // Um número aqui viraria texto no banco sem reclamar, e um objeto viraria
  // "[object Object]" estampado no topo da loja.
  for (const valor of [42, { a: 1 }, ["x"], true]) {
    const res = await chamar({
      metodo: "PUT",
      sub: DORA,
      corpo: { textos: { heroi: { pt: { titulo: valor } } } },
    });
    assert.equal(res.codigo, 400, `deveria recusar ${JSON.stringify(valor)}`);
  }
  assert.deepEqual(await noBanco(), { heroi: null, textos: [] });
});

test("PUT /vitrine é tudo-ou-nada: o inválido no fim não deixa passar o válido do começo", async () => {
  // Sem isto, um corpo com o 'pt' certo e o 'pt-BR' errado gravaria metade e
  // responderia 400 — e o painel mostraria erro sobre um formulário que
  // PARCIALMENTE salvou, que é o pior dos dois mundos para quem está editando.
  const res = await chamar({
    metodo: "PUT",
    sub: DORA,
    corpo: {
      heroi: { imagem_desktop: "https://cdn/d.jpg" },
      textos: {
        heroi: { pt: { titulo: "válido" }, "pt-BR": { titulo: "inválido" } },
      },
    },
  });

  assert.equal(res.codigo, 400);
  assert.deepEqual(await noBanco(), { heroi: null, textos: [] });
});

test("PUT /vitrine recusa `textos` e `heroi` que não sejam objetos", async () => {
  for (const corpo of [
    { heroi: "https://cdn/d.jpg" },
    { textos: "heroi" },
    { textos: { heroi: "pt" } },
    { textos: { heroi: { pt: "titulo" } } },
  ]) {
    const res = await chamar({ metodo: "PUT", sub: DORA, corpo });
    assert.equal(res.codigo, 400, `deveria recusar ${JSON.stringify(corpo)}`);
  }
});

test("PUT /vitrine recusa imagem do herói que não seja texto, e não cria a linha 1", async () => {
  const res = await chamar({
    metodo: "PUT",
    sub: DORA,
    corpo: { heroi: { imagem_desktop: 7 } },
  });
  assert.equal(res.codigo, 400);
  // A linha única não pode nascer como efeito colateral de um corpo recusado.
  assert.deepEqual(await noBanco(), { heroi: null, textos: [] });
});

/* --------------------------------------------------------------------------
 * A rota, montada
 * -------------------------------------------------------------------------- */

test("a rota /vitrine está montada em index.js, com o GET público e o PUT guardado", async () => {
  // ORDEM DE REGISTRO É LOAD-BEARING NESTE PROJETO — três pares já quebram se
  // invertidos (`/dashboard/summary` antes de `/dashboard/:id`,
  // `/admin/orders/export` antes de `/admin/orders/:id`, `/users/me` antes de
  // `/users/:id`). `/vitrine` não tem `:id` e não cria par novo, mas a linha
  // precisa EXISTIR: sem ela, o router deste arquivo passa nos testes acima e a
  // loja continua sem endpoint nenhum.
  const fs = require("node:fs");
  const path = require("node:path");
  const indice = fs.readFileSync(
    path.join(__dirname, "..", "src", "index.js"),
    "utf8",
  );
  assert.match(indice, /app\.use\("\/vitrine",\s*vitrineRoutes\)/);
  assert.match(indice, /require\("\.\/routes\/vitrine\.routes"\)/);

  // E a pilha do PUT tem os dois guardas na frente do handler. Um PUT montado
  // sem eles responderia 200 aos testes de 401/403 — mas eles falhariam alto.
  // Esta asserção é o aviso que aparece ANTES, no lugar certo.
  const camadas = vitrineRoutes.stack.map((c) => ({
    caminho: c.route?.path,
    metodos: Object.keys(c.route?.methods || {}),
    guardas: c.route?.stack.map((s) => s.name),
  }));
  assert.deepEqual(camadas, [
    { caminho: "/", metodos: ["get"], guardas: ["lerVitrine"] },
    {
      caminho: "/",
      metodos: ["put"],
      guardas: ["authenticateToken", "isAdmin", "gravarVitrine"],
    },
  ]);
});
