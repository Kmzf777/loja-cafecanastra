"use strict";

/**
 * Onda 4 — administradores e o CRUD do que a migração 0033 criou.
 *
 * `/admin/administradores` EXISTE PORQUE HOJE NÃO EXISTE CAMINHO NENHUM: a
 * única escrita em `canastra.admins` no repositório está no script de
 * instalação, e promover um segundo gestor exige `psql` em produção. O trigger
 * `admins_nunca_zero` (0002:118) já impede remover o último — a rota tem de
 * AVISAR ANTES DE TENTAR, com frase, e não deixar um 23001 virar 500.
 *
 * `/admin/campanhas`, `/admin/consentimentos` e `/admin/envios` são o CRUD das
 * três tabelas de 0033. A armadilha que este arquivo prende é uma só e é
 * silenciosa até o primeiro deploy: **`ON CONFLICT` NÃO INFERE ÍNDICE
 * PARCIAL**. `campanhas_utm_idx` é UNIQUE ... WHERE utm_campaign IS NOT NULL, e
 * um upsert que não repete o `WHERE` leva 42P10 ("there is no unique or
 * exclusion constraint matching the ON CONFLICT specification") — na primeira
 * campanha reimportada, não na primeira criada.
 *
 * E os CHECKs de 0033 recusam ANTES do banco, com frase: `erro_texto` só existe
 * em envio que falhou, `entregue_em` exige `enviado_em`, e um consentimento
 * precisa identificar alguém. Deixar o 23514 subir daria "Erro interno" para um
 * pedido que tem nome.
 */

const { test, before, after, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const jwt = require("jsonwebtoken");
const { subirPostgres } = require("./ajuda/postgres.js");
const { aplicarMigracoes } = require("../db/migrar.js");

let bd;
let painelRoutes;
let marketingRoutes;

const ANA = "aaaaaaaa-0000-0000-0000-000000000001"; // cliente
const BETO = "bbbbbbbb-0000-0000-0000-000000000002"; // cliente que vira admin
const DORA = "dddddddd-0000-0000-0000-000000000004"; // administradora
const INTRUSO = "ffffffff-0000-0000-0000-0000000000f1"; // conta de OUTRO projeto

const SEGREDO = "segredo-de-teste-com-tamanho-suficiente-para-hs256";

function token(sub) {
  return jwt.sign({ sub, role: "authenticated" }, SEGREDO, { expiresIn: "1h" });
}

function respostaFalsa() {
  const res = { codigo: null, corpo: null };
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
  res.setHeader = () => res;
  return res;
}

async function chamar(router, { metodo = "GET", url, corpo, sub = null } = {}) {
  const [caminho, consulta = ""] = url.split("?");
  const query = {};
  for (const [chave, valor] of new URLSearchParams(consulta)) query[chave] = valor;

  const req = {
    method: metodo,
    url,
    originalUrl: url,
    path: caminho,
    query,
    headers: {},
    body: corpo,
  };
  if (sub) req.headers.authorization = `Bearer ${token(sub)}`;

  const res = respostaFalsa();
  const semRota = new Promise((resolve, reject) => {
    router(req, res, (erro) => (erro ? reject(erro) : resolve("SEM ROTA")));
  });

  const desfecho = await Promise.race([res.terminou, semRota]);
  assert.notEqual(
    desfecho,
    "SEM ROTA",
    `nenhuma rota casou com ${metodo} ${url} — a linha de registro sumiu`,
  );
  return res;
}

async function logs() {
  const { rows } = await bd.pool.query(
    `SELECT admin_user_id, acao, entidade, entidade_id, antes, depois
       FROM canastra.admin_log ORDER BY criado_em DESC, acao`,
  );
  return rows;
}

before(async () => {
  bd = await subirPostgres();
  await aplicarMigracoes(bd.pool);

  await bd.pool.query(
    `INSERT INTO auth.users (id, email) VALUES
       ($1,'ana@ex.com'), ($2,'beto@ex.com'), ($3,'dora@ex.com'),
       ($4,'intruso@outro.projeto')`,
    [ANA, BETO, DORA, INTRUSO],
  );
  await bd.pool.query(
    `INSERT INTO canastra.clientes (user_id, nome) VALUES
       ($1,'Ana'), ($2,'Beto'), ($3,'Dora')`,
    [ANA, BETO, DORA],
  );

  process.env.SUPABASE_JWT_SECRET = SEGREDO;
  process.env.DATABASE_URL = bd.connectionString;

  painelRoutes = require("../src/routes/painel.routes.js");
  marketingRoutes = require("../src/routes/marketing.routes.js");
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
  await bd.pool.query("TRUNCATE canastra.admin_log");
  await bd.pool.query("DELETE FROM canastra.envios");
  await bd.pool.query("DELETE FROM canastra.consentimentos");
  await bd.pool.query("DELETE FROM canastra.campanhas");
  // A Dora volta a ser a única administradora antes de cada teste. O DELETE
  // vem primeiro e o INSERT depois, nesta ordem, porque `admins_nunca_zero`
  // dispara POR COMANDO: apagar as duas de uma vez recusaria.
  await bd.pool.query("INSERT INTO canastra.admins (user_id) VALUES ($1) ON CONFLICT DO NOTHING", [
    DORA,
  ]);
  await bd.pool.query("DELETE FROM canastra.admins WHERE user_id <> $1", [DORA]);
});

/* --------------------------------------------------------------------------
 * /admin/administradores
 * -------------------------------------------------------------------------- */

test("a lista de administradores exige admin", async () => {
  const semToken = await chamar(painelRoutes, { url: "/admin/administradores" });
  assert.equal(semToken.codigo, 401);
  const cliente = await chamar(painelRoutes, {
    url: "/admin/administradores",
    sub: ANA,
  });
  assert.equal(cliente.codigo, 403);
});

test("a lista traz nome, e-mail e papel — não só o uuid", async () => {
  const res = await chamar(painelRoutes, { url: "/admin/administradores", sub: DORA });
  assert.equal(res.codigo, 200);
  assert.equal(res.corpo.data.length, 1);
  assert.equal(res.corpo.data[0].user_id, DORA);
  assert.equal(res.corpo.data[0].nome, "Dora");
  assert.equal(res.corpo.data[0].email, "dora@ex.com");
  // `papel` nasce 'dono' para toda linha existente (0035): qualquer outro
  // default REBAIXARIA, no instante do deploy, quem hoje administra a loja.
  assert.equal(res.corpo.data[0].papel, "dono");
});

test("promover um cliente cria a linha e registra quem promoveu", async () => {
  const res = await chamar(painelRoutes, {
    metodo: "POST",
    url: "/admin/administradores",
    corpo: { userId: BETO },
    sub: DORA,
  });
  assert.equal(res.codigo, 201);
  assert.equal(res.corpo.user_id, BETO);
  assert.equal(res.corpo.papel, "dono");

  const { rows } = await bd.pool.query(
    "SELECT papel FROM canastra.admins WHERE user_id = $1",
    [BETO],
  );
  assert.equal(rows.length, 1);

  const [linha] = await logs();
  assert.equal(linha.admin_user_id, DORA);
  assert.equal(linha.acao, "admin_promovido");
  assert.equal(linha.entidade, "admin");
  assert.equal(linha.entidade_id, BETO);
  assert.equal(linha.antes, null); // criação: só `depois`
  assert.equal(linha.depois.papel, "dono");
});

test("promover aceita papel da lista fechada e recusa o que a 0035 não conhece", async () => {
  const bom = await chamar(painelRoutes, {
    metodo: "POST",
    url: "/admin/administradores",
    corpo: { userId: BETO, papel: "operador" },
    sub: DORA,
  });
  assert.equal(bom.codigo, 201);
  assert.equal(bom.corpo.papel, "operador");

  const ruim = await chamar(painelRoutes, {
    metodo: "POST",
    url: "/admin/administradores",
    corpo: { userId: ANA, papel: "supremo" },
    sub: DORA,
  });
  assert.equal(ruim.codigo, 400);
  assert.match(ruim.corpo.error, /gerente/);
});

test("promover quem não é cliente DESTA loja responde 404", async () => {
  // A mesma cerca de `excluirClientePeloAdmin`: a instância Supabase é
  // compartilhada, e um uuid com conta em OUTRO projeto não pode virar
  // administrador daqui. A FK de `admins` recusaria com 23503 — o 404 chega
  // antes, e com frase.
  const res = await chamar(painelRoutes, {
    metodo: "POST",
    url: "/admin/administradores",
    corpo: { userId: INTRUSO },
    sub: DORA,
  });
  assert.equal(res.codigo, 404);
});

test("promover quem já é administrador responde 409, e não duplica", async () => {
  const res = await chamar(painelRoutes, {
    metodo: "POST",
    url: "/admin/administradores",
    corpo: { userId: DORA },
    sub: DORA,
  });
  assert.equal(res.codigo, 409);
  const { rows } = await bd.pool.query("SELECT count(*) FROM canastra.admins");
  assert.equal(Number(rows[0].count), 1);
});

test("REMOVER O ÚLTIMO ADMINISTRADOR avisa com FRASE, e não com 500", async () => {
  // O trigger `admins_nunca_zero` recusa com 23001 e a exceção viraria "Erro
  // interno no servidor." — a frase de servidor quebrado para uma regra de
  // negócio que tem nome. A rota confere ANTES de tentar.
  const res = await chamar(painelRoutes, {
    metodo: "DELETE",
    url: `/admin/administradores/${DORA}`,
    sub: DORA,
  });
  assert.equal(res.codigo, 409);
  assert.match(res.corpo.message, /administrador/i);

  const { rows } = await bd.pool.query("SELECT count(*) FROM canastra.admins");
  assert.equal(Number(rows[0].count), 1, "a loja não pode ficar sem administrador");
  assert.equal((await logs()).length, 0, "recusa não é remoção: nada a registrar");
});

test("com dois administradores, remover um passa e fica registrado", async () => {
  await bd.pool.query("INSERT INTO canastra.admins (user_id) VALUES ($1)", [BETO]);

  const res = await chamar(painelRoutes, {
    metodo: "DELETE",
    url: `/admin/administradores/${BETO}`,
    sub: DORA,
  });
  assert.equal(res.codigo, 200);

  const { rows } = await bd.pool.query("SELECT count(*) FROM canastra.admins");
  assert.equal(Number(rows[0].count), 1);

  const [linha] = await logs();
  assert.equal(linha.acao, "admin_removido");
  assert.equal(linha.entidade_id, BETO);
  assert.equal(linha.antes.papel, "dono"); // remoção: só `antes`
  assert.equal(linha.depois, null);
});

test("remover quem não é administrador responde 404, e id malformado 400", async () => {
  const naoEh = await chamar(painelRoutes, {
    metodo: "DELETE",
    url: `/admin/administradores/${ANA}`,
    sub: DORA,
  });
  assert.equal(naoEh.codigo, 404);

  const malformado = await chamar(painelRoutes, {
    metodo: "DELETE",
    url: "/admin/administradores/nao-e-uuid",
    sub: DORA,
  });
  assert.equal(malformado.codigo, 400);
});

/* --------------------------------------------------------------------------
 * /admin/campanhas
 * -------------------------------------------------------------------------- */

test("campanhas: criar, listar e filtrar", async () => {
  const criada = await chamar(marketingRoutes, {
    metodo: "POST",
    url: "/admin/campanhas",
    corpo: {
      nome: "Dia das Mães 2026",
      canal: "meta",
      utm_campaign: "dia-das-maes-2026",
      custo_centavos: 250000,
    },
    sub: DORA,
  });
  assert.equal(criada.codigo, 201);
  assert.equal(criada.corpo.utm_campaign, "dia-das-maes-2026");
  assert.equal(criada.corpo.ativa, true);

  await chamar(marketingRoutes, {
    metodo: "POST",
    url: "/admin/campanhas",
    corpo: { nome: "Newsletter semanal", canal: "email", ativa: false },
    sub: DORA,
  });

  const todas = await chamar(marketingRoutes, { url: "/admin/campanhas", sub: DORA });
  assert.equal(todas.corpo.total, 2);

  const porCanal = await chamar(marketingRoutes, {
    url: "/admin/campanhas?canal=meta",
    sub: DORA,
  });
  assert.equal(porCanal.corpo.total, 1);

  const ativas = await chamar(marketingRoutes, {
    url: "/admin/campanhas?ativa=true",
    sub: DORA,
  });
  assert.equal(ativas.corpo.total, 1);

  // A criação deixa rastro: campanha é orçamento, e "quem cadastrou a campanha
  // de R$ 2.500?" tem de ter resposta.
  const linhas = await logs();
  assert.equal(linhas.length, 2);
  assert.ok(linhas.every((l) => l.acao === "campanha_criada"));
  assert.ok(linhas.every((l) => l.admin_user_id === DORA));
});

test("O UPSERT DE CAMPANHA REPETE O `WHERE` DO ÍNDICE PARCIAL — sem 42P10", async () => {
  // `campanhas_utm_idx` é UNIQUE (utm_campaign) WHERE utm_campaign IS NOT NULL.
  // `ON CONFLICT (utm_campaign)` sem o WHERE não INFERE o índice parcial e
  // estoura 42P10 — na REIMPORTAÇÃO da campanha, não na criação. O sintoma
  // seria "Erro interno" no segundo salvamento da mesma UTM.
  const primeira = await chamar(marketingRoutes, {
    metodo: "POST",
    url: "/admin/campanhas",
    corpo: { nome: "Black Friday", canal: "google", utm_campaign: "bf-2026" },
    sub: DORA,
  });
  assert.equal(primeira.codigo, 201);

  const segunda = await chamar(marketingRoutes, {
    metodo: "POST",
    url: "/admin/campanhas",
    corpo: {
      nome: "Black Friday (revisada)",
      canal: "google",
      utm_campaign: "bf-2026",
      custo_centavos: 999,
    },
    sub: DORA,
  });
  assert.equal(segunda.codigo, 200, "a segunda é ATUALIZAÇÃO, não conflito");
  assert.equal(segunda.corpo.id, primeira.corpo.id);
  assert.equal(segunda.corpo.nome, "Black Friday (revisada)");
  assert.equal(segunda.corpo.custo_centavos, 999);

  const { rows } = await bd.pool.query(
    "SELECT count(*) FROM canastra.campanhas WHERE utm_campaign = 'bf-2026'",
  );
  assert.equal(Number(rows[0].count), 1);
});

test("duas campanhas SEM utm convivem — o índice é parcial de propósito", async () => {
  for (const nome of ["Panfleto A", "Panfleto B"]) {
    const res = await chamar(marketingRoutes, {
      metodo: "POST",
      url: "/admin/campanhas",
      corpo: { nome, canal: "outro" },
      sub: DORA,
    });
    assert.equal(res.codigo, 201);
  }
  const { rows } = await bd.pool.query("SELECT count(*) FROM canastra.campanhas");
  assert.equal(Number(rows[0].count), 2);
});

test("utm com espaço ou maiúscula recusa com frase, não com 23514", async () => {
  // O CHECK `campanhas_utm_canonico` exige minúsculo e sem espaço: a UTM é uma
  // CHAVE de junção com `pedidos.utm_campaign`, e "Verão" ≠ "verão" faria a
  // atribuição dividir a mesma campanha em duas linhas de relatório.
  const comEspaco = await chamar(marketingRoutes, {
    metodo: "POST",
    url: "/admin/campanhas",
    corpo: { nome: "X", canal: "google", utm_campaign: "dia das maes" },
    sub: DORA,
  });
  assert.equal(comEspaco.codigo, 400);
  assert.match(comEspaco.corpo.error, /espaço/i);

  // Maiúscula é normalizada, não recusada: quem copia da planilha do anúncio
  // não tem por que saber da regra, e minúsculo é uma conversão sem perda.
  const comMaiuscula = await chamar(marketingRoutes, {
    metodo: "POST",
    url: "/admin/campanhas",
    corpo: { nome: "Y", canal: "google", utm_campaign: "Verao-2026" },
    sub: DORA,
  });
  assert.equal(comMaiuscula.codigo, 201);
  assert.equal(comMaiuscula.corpo.utm_campaign, "verao-2026");
});

test("campanha: canal fora da lista e janela invertida recusam com frase", async () => {
  const canal = await chamar(marketingRoutes, {
    metodo: "POST",
    url: "/admin/campanhas",
    corpo: { nome: "X", canal: "tiktok" },
    sub: DORA,
  });
  assert.equal(canal.codigo, 400);
  assert.match(canal.corpo.error, /influenciador/);

  const janela = await chamar(marketingRoutes, {
    metodo: "POST",
    url: "/admin/campanhas",
    corpo: {
      nome: "X",
      canal: "email",
      inicio_em: "2026-10-01T00:00:00Z",
      fim_em: "2026-09-01T00:00:00Z",
    },
    sub: DORA,
  });
  assert.equal(janela.codigo, 400);
});

test("PATCH de campanha é PARCIAL: o que não veio não é apagado", async () => {
  // A armadilha que `PUT /promotions/:id` demonstrou nesta loja: escrever todas
  // as colunas com o que veio no corpo faz campo ausente virar NULL, e um
  // formulário que mande só o campo alterado apaga nome, datas e custo.
  const criada = await chamar(marketingRoutes, {
    metodo: "POST",
    url: "/admin/campanhas",
    corpo: {
      nome: "Natal",
      canal: "email",
      utm_campaign: "natal-2026",
      custo_centavos: 5000,
    },
    sub: DORA,
  });

  const res = await chamar(marketingRoutes, {
    metodo: "PATCH",
    url: `/admin/campanhas/${criada.corpo.id}`,
    corpo: { ativa: false },
    sub: DORA,
  });
  assert.equal(res.codigo, 200);
  assert.equal(res.corpo.ativa, false);
  assert.equal(res.corpo.nome, "Natal");
  assert.equal(res.corpo.utm_campaign, "natal-2026");
  assert.equal(res.corpo.custo_centavos, 5000);
  // `atualizada_em` é carimbada à mão — não há trigger de moddatetime.
  assert.notEqual(
    new Date(res.corpo.atualizada_em).getTime(),
    new Date(criada.corpo.atualizada_em).getTime(),
  );

  const [linha] = await logs();
  assert.equal(linha.acao, "campanha_alterada");
  assert.equal(linha.antes.ativa, true);
  assert.equal(linha.depois.ativa, false);
});

test("PATCH de campanha inexistente responde 404 — não 200 tendo mudado zero linhas", async () => {
  const res = await chamar(marketingRoutes, {
    metodo: "PATCH",
    url: "/admin/campanhas/99999999-0000-0000-0000-000000000999",
    corpo: { ativa: false },
    sub: DORA,
  });
  assert.equal(res.codigo, 404);
});

/* --------------------------------------------------------------------------
 * /admin/consentimentos
 * -------------------------------------------------------------------------- */

test("consentimento: registrar, listar e filtrar por canal e estado", async () => {
  const concedido = await chamar(marketingRoutes, {
    metodo: "POST",
    url: "/admin/consentimentos",
    corpo: {
      canal: "email",
      estado: "concedido",
      origem: "rodape-do-site",
      email: "Ana@Ex.com",
      texto_aceito: "Aceito receber novidades",
    },
    sub: DORA,
  });
  assert.equal(concedido.codigo, 201);

  await chamar(marketingRoutes, {
    metodo: "POST",
    url: "/admin/consentimentos",
    corpo: {
      canal: "whatsapp",
      estado: "revogado",
      origem: "atendimento",
      user_id: ANA,
    },
    sub: DORA,
  });

  const todos = await chamar(marketingRoutes, { url: "/admin/consentimentos", sub: DORA });
  assert.equal(todos.corpo.total, 2);

  const porCanal = await chamar(marketingRoutes, {
    url: "/admin/consentimentos?canal=email",
    sub: DORA,
  });
  assert.equal(porCanal.corpo.total, 1);

  const revogados = await chamar(marketingRoutes, {
    url: "/admin/consentimentos?estado=revogado",
    sub: DORA,
  });
  assert.equal(revogados.corpo.total, 1);

  // A busca por e-mail é insensível à caixa: o UNIQUE da newsletter já
  // ensinou que quem digitou `Ana@Ex.com` é a titular de `ana@ex.com`.
  const porEmail = await chamar(marketingRoutes, {
    url: "/admin/consentimentos?email=ana@ex.com",
    sub: DORA,
  });
  assert.equal(porEmail.corpo.total, 1);

  const [linha] = await logs();
  assert.equal(linha.acao, "consentimento_registrado");
  assert.equal(linha.entidade, "consentimento");
});

test("consentimento que não identifica ninguém recusa com frase, não com 23514", async () => {
  const res = await chamar(marketingRoutes, {
    metodo: "POST",
    url: "/admin/consentimentos",
    corpo: { canal: "email", estado: "concedido", origem: "importacao" },
    sub: DORA,
  });
  assert.equal(res.codigo, 400);
  assert.match(res.corpo.error, /titular|identifi/i);
});

test("consentimento: canal, estado e origem fora do CHECK recusam com frase", async () => {
  const canal = await chamar(marketingRoutes, {
    metodo: "POST",
    url: "/admin/consentimentos",
    corpo: { canal: "pombo", estado: "concedido", origem: "x", email: "a@b.c" },
    sub: DORA,
  });
  assert.equal(canal.codigo, 400);

  const estado = await chamar(marketingRoutes, {
    metodo: "POST",
    url: "/admin/consentimentos",
    corpo: { canal: "email", estado: "talvez", origem: "x", email: "a@b.c" },
    sub: DORA,
  });
  assert.equal(estado.codigo, 400);

  const origem = await chamar(marketingRoutes, {
    metodo: "POST",
    url: "/admin/consentimentos",
    corpo: { canal: "email", estado: "concedido", origem: "  ", email: "a@b.c" },
    sub: DORA,
  });
  assert.equal(origem.codigo, 400);
});

/* --------------------------------------------------------------------------
 * /admin/envios
 * -------------------------------------------------------------------------- */

async function campanhaDeTeste() {
  const res = await chamar(marketingRoutes, {
    metodo: "POST",
    url: "/admin/campanhas",
    corpo: { nome: "Envio", canal: "email", utm_campaign: "envio-2026" },
    sub: DORA,
  });
  return res.corpo.id;
}

test("envio: criar, listar e filtrar por campanha e estado", async () => {
  const campanha = await campanhaDeTeste();

  const criado = await chamar(marketingRoutes, {
    metodo: "POST",
    url: "/admin/envios",
    corpo: {
      canal: "email",
      destinatario_final: "ana@ex.com",
      campanha_id: campanha,
      user_id: ANA,
      template: "boas-vindas",
    },
    sub: DORA,
  });
  assert.equal(criado.codigo, 201);
  assert.equal(criado.corpo.estado, "pendente");

  const porCampanha = await chamar(marketingRoutes, {
    url: `/admin/envios?campanha_id=${campanha}`,
    sub: DORA,
  });
  assert.equal(porCampanha.corpo.total, 1);

  const pendentes = await chamar(marketingRoutes, {
    url: "/admin/envios?estado=pendente",
    sub: DORA,
  });
  assert.equal(pendentes.corpo.total, 1);

  const [linha] = await logs();
  assert.equal(linha.acao, "envio_criado");
  assert.equal(linha.entidade_id, criado.corpo.id);
});

test("marcar como enviado e depois entregue carimba as DUAS datas na ordem", async () => {
  // `envios_entrega_depois_do_envio` exige `enviado_em` preenchido e
  // `entregue_em >= enviado_em`. Um PATCH que carimbasse só a entrega levaria
  // 23514 — a rota preenche o que faltou.
  const criado = await chamar(marketingRoutes, {
    metodo: "POST",
    url: "/admin/envios",
    corpo: { canal: "email", destinatario_final: "ana@ex.com" },
    sub: DORA,
  });

  const enviado = await chamar(marketingRoutes, {
    metodo: "PATCH",
    url: `/admin/envios/${criado.corpo.id}`,
    corpo: { estado: "enviado", provedor_id: "resend-123" },
    sub: DORA,
  });
  assert.equal(enviado.codigo, 200);
  assert.ok(enviado.corpo.enviado_em);
  assert.equal(enviado.corpo.entregue_em, null);

  const entregue = await chamar(marketingRoutes, {
    metodo: "PATCH",
    url: `/admin/envios/${criado.corpo.id}`,
    corpo: { estado: "entregue" },
    sub: DORA,
  });
  assert.equal(entregue.codigo, 200);
  assert.ok(entregue.corpo.entregue_em);
  assert.ok(
    new Date(entregue.corpo.entregue_em) >= new Date(entregue.corpo.enviado_em),
  );

  // Cada transição de estado deixa a sua linha, com o antes e o depois.
  const linhas = await logs();
  const alteracoes = linhas.filter((l) => l.acao === "envio_alterado");
  assert.equal(alteracoes.length, 2);
  assert.deepEqual(
    new Set(alteracoes.map((l) => l.depois.estado)),
    new Set(["enviado", "entregue"]),
  );
});

test("entregue SEM ter sido enviado carimba o envio junto, em vez de 23514", async () => {
  const criado = await chamar(marketingRoutes, {
    metodo: "POST",
    url: "/admin/envios",
    corpo: { canal: "sms", destinatario_final: "+5531988887777" },
    sub: DORA,
  });

  const res = await chamar(marketingRoutes, {
    metodo: "PATCH",
    url: `/admin/envios/${criado.corpo.id}`,
    corpo: { estado: "entregue" },
    sub: DORA,
  });
  assert.equal(res.codigo, 200);
  assert.ok(res.corpo.enviado_em, "entrega sem envio é o CHECK de 0033");
});

test("erro_texto em envio que não falhou recusa com frase", async () => {
  const criado = await chamar(marketingRoutes, {
    metodo: "POST",
    url: "/admin/envios",
    corpo: { canal: "email", destinatario_final: "ana@ex.com" },
    sub: DORA,
  });

  const res = await chamar(marketingRoutes, {
    metodo: "PATCH",
    url: `/admin/envios/${criado.corpo.id}`,
    corpo: { estado: "enviado", erro_texto: "deu ruim" },
    sub: DORA,
  });
  assert.equal(res.codigo, 400);
  assert.match(res.corpo.error, /falhou/);
});

test("envio: destinatário vazio e canal fora do CHECK recusam com frase", async () => {
  const semDestino = await chamar(marketingRoutes, {
    metodo: "POST",
    url: "/admin/envios",
    corpo: { canal: "email", destinatario_final: "   " },
    sub: DORA,
  });
  assert.equal(semDestino.codigo, 400);

  const canal = await chamar(marketingRoutes, {
    metodo: "POST",
    url: "/admin/envios",
    corpo: { canal: "pombo", destinatario_final: "ana@ex.com" },
    sub: DORA,
  });
  assert.equal(canal.codigo, 400);
});

test("as rotas de marketing exigem admin", async () => {
  for (const url of ["/admin/campanhas", "/admin/consentimentos", "/admin/envios"]) {
    const semToken = await chamar(marketingRoutes, { url });
    assert.equal(semToken.codigo, 401, `${url} sem token`);
    const cliente = await chamar(marketingRoutes, { url, sub: ANA });
    assert.equal(cliente.codigo, 403, `${url} como cliente comum`);
  }
});

test("index.js monta o router de marketing, e monta no fim", () => {
  const fs = require("node:fs");
  const path = require("node:path");
  const fonte = fs.readFileSync(path.join(__dirname, "..", "src", "index.js"), "utf8");

  assert.match(fonte, /require\("\.\/routes\/marketing\.routes"\)/);
  assert.match(fonte, /app\.use\(marketingRoutes\)/);
  assert.ok(
    fonte.indexOf("app.use(marketingRoutes)") > fonte.indexOf("app.use(paymentRoutes)"),
    "o router de marketing tem de ser montado DEPOIS dos que têm rota de `:id`",
  );
});
