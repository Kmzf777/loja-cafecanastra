"use strict";

/**
 * F6 — newsletter (deduplicação e anti-enumeração) e carrinho abandonado
 * (seleção, marca transacional e idempotência).
 *
 * O cron em si NÃO roda aqui — o que se testa é o que ele chama: a seleção dos
 * carrinhos e o envio com a marca `lembrete_enviado_em` na MESMA transação.
 * O envio de e-mail é injetado (`enviar`), então nada toca o Resend.
 *
 * SEM DEPENDÊNCIA DE ORDEM: cada teste cria os próprios personagens e termina
 * sem deixar candidato elegível para trás (quem cria um carrinho abandonado o
 * lembra — pelo envio ou por marca explícita). Qualquer teste roda sozinho e
 * em qualquer posição.
 */

const { test, before, after, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const { subirPostgres } = require("./ajuda/postgres.js");
const { aplicarMigracoes } = require("../db/migrar.js");

let bd;
let inscrever;
let descadastrar;
let selecionarAbandonados;
let enviarLembretes;
let conteudoDoLembreteDeCarrinho;

async function criarPessoa(id, email, nome) {
  await bd.pool.query("INSERT INTO auth.users (id, email) VALUES ($1, $2)", [
    id,
    email,
  ]);
  await bd.pool.query(
    "INSERT INTO canastra.clientes (user_id, nome) VALUES ($1, $2)",
    [id, nome],
  );
}

async function criarCarrinho(userId, { horasAtras, comItem = true, jaLembrado = false }) {
  const { rows } = await bd.pool.query(
    `INSERT INTO canastra.carrinhos (user_id) VALUES ($1) RETURNING carrinho_id`,
    [userId],
  );
  const carrinhoId = rows[0].carrinho_id;
  if (comItem) {
    await bd.pool.query(
      `INSERT INTO canastra.carrinho_itens (carrinho_id, produto_id, quantidade, preco, nome, moagem)
       VALUES ($1, gen_random_uuid(), 2, 54.90, 'Café Clássico 500g', 'graos')`,
      [carrinhoId],
    );
  }
  await bd.pool.query(
    `UPDATE canastra.carrinhos
        SET atualizado_em = now() - make_interval(hours => $2),
            lembrete_enviado_em = CASE WHEN $3 THEN now() - make_interval(hours => $2) ELSE NULL END
      WHERE carrinho_id = $1`,
    [carrinhoId, horasAtras, jaLembrado],
  );
  return carrinhoId;
}

async function lembreteDe(userId) {
  const { rows } = await bd.pool.query(
    "SELECT lembrete_enviado_em FROM canastra.carrinhos WHERE user_id = $1",
    [userId],
  );
  return rows[0].lembrete_enviado_em;
}

/** Fecha o episódio na mão — o "cleanup" de quem criou candidato só para a seleção. */
async function marcarComoLembrado(userId) {
  await bd.pool.query(
    "UPDATE canastra.carrinhos SET lembrete_enviado_em = now() WHERE user_id = $1",
    [userId],
  );
}

before(async () => {
  bd = await subirPostgres();
  await aplicarMigracoes(bd.pool);

  process.env.DATABASE_URL = bd.connectionString;

  ({ inscrever, descadastrar } = require("../src/routes/newsletter.routes.js"));
  ({
    selecionarAbandonados,
    enviarLembretes,
  } = require("../src/jobs/carrinhoAbandonado.js"));
  ({ conteudoDoLembreteDeCarrinho } = require("../src/utils/emailSender.js"));
}, { timeout: 120_000 });

after(async () => {
  await require("../src/pgPool.js").end().catch(() => {});
  await bd?.derrubar();
});

beforeEach(() => {
  if (!bd) {
    throw new Error(
      "O Postgres nao subiu no before(); a causa real esta no erro daquele hook.",
    );
  }
});

function respostaFalsa() {
  const res = { codigo: null, corpo: null };
  res.status = (codigo) => {
    res.codigo = codigo;
    return res;
  };
  res.json = (corpo) => {
    if (res.codigo === null) res.codigo = 200;
    res.corpo = corpo;
    return res;
  };
  return res;
}

/* --------------------------------------------------------------------------
 * Newsletter
 * -------------------------------------------------------------------------- */

test("inscrever: e-mail válido entra uma vez; repetir responde IGUAL", async () => {
  let res = respostaFalsa();
  await inscrever({ body: { email: " Bea@Ex.com " } }, res);
  assert.equal(res.codigo, 200);
  assert.deepEqual(res.corpo, { ok: true });

  // A resposta da repetição é INDISTINGUÍVEL da primeira — é a defesa contra
  // enumeração: ninguém descobre por aqui se um e-mail está na lista.
  res = respostaFalsa();
  await inscrever({ body: { email: "bea@ex.com" } }, res);
  assert.equal(res.codigo, 200);
  assert.deepEqual(res.corpo, { ok: true });

  const { rows } = await bd.pool.query(
    "SELECT email, origem FROM canastra.newsletter_inscritos WHERE email = 'bea@ex.com'",
  );
  assert.equal(rows.length, 1, "dedupe: uma linha só");
  assert.equal(rows[0].email, "bea@ex.com", "normalizado: minúsculo, sem espaços");
  assert.equal(rows[0].origem, "rodape");
});

test("inscrever: e-mail inválido é 400 — o único caso que difere", async () => {
  for (const email of ["", "   ", "sem-arroba", "a@b", "a b@c.com", null]) {
    const res = respostaFalsa();
    await inscrever({ body: { email } }, res);
    assert.equal(res.codigo, 400, `aceitou "${email}"`);
  }
});

/* --------------------------------------------------------------------------
 * Newsletter — a saída (POST /newsletter/descadastrar)
 * -------------------------------------------------------------------------- */

/** Quantas linhas há para este e-mail, sem depender de caixa. */
async function inscricoesDe(email) {
  const { rows } = await bd.pool.query(
    "SELECT count(*)::int AS n FROM canastra.newsletter_inscritos WHERE lower(email) = lower($1)",
    [email],
  );
  return rows[0].n;
}

test("descadastrar: a linha some, e a resposta é IGUAL à de quem nunca esteve na lista", async () => {
  // Personagens próprias deste teste: a que sai e a vizinha que fica.
  await inscrever({ body: { email: "cora@ex.com" } }, respostaFalsa());
  await inscrever({ body: { email: "vizinha@ex.com" } }, respostaFalsa());
  assert.equal(await inscricoesDe("cora@ex.com"), 1);

  // Caixa e espaços não importam na saída, como não importam na entrada.
  const saida = respostaFalsa();
  await descadastrar({ body: { email: "  Cora@Ex.com  " } }, saida);
  assert.equal(saida.codigo, 200);
  assert.deepEqual(saida.corpo, { ok: true });
  assert.equal(await inscricoesDe("cora@ex.com"), 0, "a inscrição foi apagada");
  assert.equal(await inscricoesDe("vizinha@ex.com"), 1, "só a de quem pediu");

  // As TRÊS respostas seguintes têm de ser indistinguíveis da primeira — é a
  // mesma defesa anti-enumeração do cadastro: quem descadastra não descobre se
  // o e-mail estava na lista. Repetir o descadastro é no-op, nunca erro.
  const repetida = respostaFalsa();
  await descadastrar({ body: { email: "cora@ex.com" } }, repetida);
  const nuncaInscrita = respostaFalsa();
  await descadastrar({ body: { email: "quem-nunca@ex.com" } }, nuncaInscrita);

  for (const res of [repetida, nuncaInscrita]) {
    assert.equal(res.codigo, 200);
    assert.deepEqual(res.corpo, saida.corpo);
  }

  // Limpa a vizinha para este teste não deixar estado para os próximos.
  await descadastrar({ body: { email: "vizinha@ex.com" } }, respostaFalsa());
});

test("descadastrar: e-mail inválido é 400 — o único caso que difere, aqui também", async () => {
  for (const email of ["", "   ", "sem-arroba", "a@b", "a b@c.com", null]) {
    const res = respostaFalsa();
    await descadastrar({ body: { email } }, res);
    assert.equal(res.codigo, 400, `aceitou "${email}"`);
  }
});

test("descadastrar alcança inscrição gravada FORA da rota, em outra caixa", async () => {
  // O UNIQUE de 0011 é sensível a caixa; o e-mail não é. Uma inscrição vinda
  // de um import ou do SQL de um atendimento pode estar em maiúsculas, e a
  // pessoa que digita minúsculo no formulário continua sendo a titular dela.
  await bd.pool.query(
    "INSERT INTO canastra.newsletter_inscritos (email, origem) VALUES ('Dora@EX.com', 'importacao')",
  );

  const res = respostaFalsa();
  await descadastrar({ body: { email: "dora@ex.com" } }, res);
  assert.equal(res.codigo, 200);
  assert.equal(await inscricoesDe("dora@ex.com"), 0);
});

test("0011: o CHECK do banco recusa formato torto por qualquer caminho", async () => {
  await assert.rejects(
    () =>
      bd.pool.query(
        "INSERT INTO canastra.newsletter_inscritos (email) VALUES ('lixo')",
      ),
    (e) => {
      assert.equal(e.code, "23514");
      assert.match(e.message, /newsletter_email_formato/);
      return true;
    },
  );
});

/* --------------------------------------------------------------------------
 * Carrinho abandonado — seleção
 * -------------------------------------------------------------------------- */

test("selecionarAbandonados: só o carrinho velho, com itens, com dono com e-mail", async () => {
  // A matriz de exclusão inteira nasce DENTRO do teste: uma personagem por
  // motivo de ficar de fora, e uma (Bea) que é o abandono de verdade.
  const BEA = "bbbbbbbb-0000-0000-0000-000000000001"; // abandono de verdade
  const CLEO = "cccccccc-0000-0000-0000-000000000002"; // sacola fresca
  const DUDA = "dddddddd-0000-0000-0000-000000000003"; // carrinho sem itens
  const ELZA = "eeeeeeee-0000-0000-0000-000000000004"; // velho demais (> 7 dias)
  const FLOR = "ffffffff-0000-0000-0000-000000000005"; // já lembrada
  const GLAU = "aaaaaaaa-1111-0000-0000-000000000006"; // sem e-mail no GoTrue

  await criarPessoa(BEA, "bea@ex.com", "Bea");
  await criarPessoa(CLEO, "cleo@ex.com", "Cleo");
  await criarPessoa(DUDA, "duda@ex.com", "Duda");
  await criarPessoa(ELZA, "elza@ex.com", "Elza");
  await criarPessoa(FLOR, "flor@ex.com", "Flor");
  await criarPessoa(GLAU, null, "Glau");

  await criarCarrinho(BEA, { horasAtras: 25 });
  await criarCarrinho(CLEO, { horasAtras: 1 });
  await criarCarrinho(DUDA, { horasAtras: 25, comItem: false });
  await criarCarrinho(ELZA, { horasAtras: 24 * 10 });
  await criarCarrinho(FLOR, { horasAtras: 25, jaLembrado: true });
  await criarCarrinho(GLAU, { horasAtras: 25 });

  try {
    const candidatos = await selecionarAbandonados(bd.pool, 24);
    assert.equal(candidatos.length, 1);
    const [c] = candidatos;
    assert.equal(c.email, "bea@ex.com");
    assert.equal(c.nome, "Bea");
    assert.ok(Array.isArray(c.itens));
    assert.equal(c.itens[0].nome, "Café Clássico 500g");
    assert.equal(c.itens[0].quantidade, 2);

    // E o corte de horas é configurável: com 48h, nem a Bea (25h) entra.
    const comCorteMaior = await selecionarAbandonados(bd.pool, 48);
    assert.equal(comCorteMaior.length, 0);
  } finally {
    // Fecha o episódio da Bea para este teste não deixar candidato vivo —
    // as demais personagens nunca são elegíveis por natureza.
    await marcarComoLembrado(BEA);
  }
});

/* --------------------------------------------------------------------------
 * Carrinho abandonado — envio, marca e idempotência
 * -------------------------------------------------------------------------- */

test("enviarLembretes marca na MESMA transação e não repete", async () => {
  const IVO = "aaaaaaaa-3333-0000-0000-000000000008";
  await criarPessoa(IVO, "ivo@ex.com", "Ivo");
  await criarCarrinho(IVO, { horasAtras: 25 });

  const enviados = [];
  const enviar = async (destinatario) => {
    enviados.push(destinatario);
  };

  const resultado = await enviarLembretes({ conexao: bd.pool, horas: 24, enviar });
  assert.equal(resultado.enviados, 1);
  assert.equal(enviados.length, 1);
  assert.equal(enviados[0].email, "ivo@ex.com");
  assert.ok(await lembreteDe(IVO), "a marca ficou gravada");

  // A hora seguinte do cron: NINGUÉM recebe segundo lembrete.
  const segunda = await enviarLembretes({ conexao: bd.pool, horas: 24, enviar });
  assert.equal(segunda.enviados, 0);
  assert.equal(enviados.length, 1, "um lembrete por episódio de abandono");
});

test("falha no envio desfaz a marca — a próxima hora tenta de novo", async () => {
  const HUGO = "aaaaaaaa-2222-0000-0000-000000000007";
  await criarPessoa(HUGO, "hugo@ex.com", "Hugo");
  await criarCarrinho(HUGO, { horasAtras: 30 });

  const quebrado = await enviarLembretes({
    conexao: bd.pool,
    horas: 24,
    enviar: async () => {
      throw new Error("Resend fora do ar");
    },
  });
  assert.equal(quebrado.enviados, 0);
  assert.equal(await lembreteDe(HUGO), null, "a marca NÃO pode ficar sem e-mail enviado");

  // Provedor voltou: o mesmo carrinho é lembrado agora, uma vez.
  const enviados = [];
  const ok = await enviarLembretes({
    conexao: bd.pool,
    horas: 24,
    enviar: async (d) => enviados.push(d),
  });
  assert.equal(ok.enviados, 1);
  assert.equal(enviados[0].email, "hugo@ex.com");
  assert.ok(await lembreteDe(HUGO));
});

/* --------------------------------------------------------------------------
 * O e-mail em si (montagem pura)
 * -------------------------------------------------------------------------- */

test("o lembrete é sóbrio: assunto fixado, itens, /sacola e como parar", () => {
  const conteudo = conteudoDoLembreteDeCarrinho({
    nome: "Bea",
    itens: [
      { nome: "Café Clássico 500g", quantidade: 2 },
      { nome: "Café Suave 250g", quantidade: 1 },
    ],
  });

  assert.equal(conteudo.subject, "Seu café ainda está na sacola");
  assert.match(conteudo.html, /Bea/);
  assert.match(conteudo.html, /Café Clássico 500g/);
  assert.match(conteudo.html, /Café Suave 250g/);
  assert.match(conteudo.html, /\/sacola/);
  // O rodapé diz POR QUE o e-mail chegou, manda entrar na CONTA para ver a
  // sacola (o localStorage de outro aparelho não tem os itens) e aponta onde
  // a pessoa gerencia a conta.
  assert.match(conteudo.html, /\/account/);
  // `\s+` porque o template quebra linha onde quiser dentro da frase.
  assert.match(
    conteudo.html,
    /entre\s+na\s+sua\s+conta\s+para\s+ver\s+sua\s+sacola/i,
  );
  assert.match(conteudo.html, /sacola aberta|itens na sacola|deixou/i);
  // Sem imagem externa: e-mail de lembrete não rastreia ninguém.
  assert.doesNotMatch(conteudo.html, /<img/i);
});

test("nome de cliente e de item são DADOS, nunca marcação: tudo escapado", () => {
  const conteudo = conteudoDoLembreteDeCarrinho({
    nome: `<img src=x onerror=alert(1)>"O'Brien"`,
    itens: [{ nome: "<script>roubar()</script> & Café", quantidade: 1 }],
  });

  // Nada do payload sobrevive como MARKUP (o texto `onerror=` pode até
  // sobrar, inerte, porque o `<` que o armaria virou &lt;)...
  assert.doesNotMatch(conteudo.html, /<img/i);
  assert.doesNotMatch(conteudo.html, /<script/i);
  // ...e o texto continua legível, escapado (os cinco: & < > " ').
  assert.match(conteudo.html, /&lt;img src=x onerror=alert\(1\)&gt;/);
  assert.match(conteudo.html, /&quot;O&#39;Brien&quot;/);
  assert.match(conteudo.html, /&lt;script&gt;roubar\(\)&lt;\/script&gt; &amp; Café/);
});
