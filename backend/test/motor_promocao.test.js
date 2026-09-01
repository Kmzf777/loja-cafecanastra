"use strict";

/**
 * O motor de promocao de 0032, visto de fora.
 *
 * O QUE ESTA MIGRACAO E: as sete tabelas que substituem as DUAS estruturas que
 * hoje nunca se falam — `canastra.promocoes` (desconto de vitrine, por produto)
 * e `canastra.cupons` (desconto de checkout, sobre o subtotal). Aqui nada
 * CALCULA: a Onda 4 e quem escreve o motor. O criterio de pronto desta onda e
 * outro, e e o que este arquivo mede: **o banco aceita e recusa as coisas
 * certas**.
 *
 * DUAS FAMILIAS DE ASERCAO, e a distincao importa para quem for depurar:
 *
 *   VOCABULARIO ..... um valor fora da lista fechada recusa com 23514
 *                     (check_violation) ou 23505 (unique_violation). Isto e o
 *                     que hoje NAO existe: `promocoes.tipo` e
 *                     `promocoes.aplica_a` sao `text` sem CHECK nenhum, e so o
 *                     JavaScript valida — quem escrever pelo PostgREST, por um
 *                     INSERT manual ou por uma tela nova passa por cima.
 *   PRIVILEGIO/RLS .. 42501, ou zero linhas. O molde e `test/rls.test.js`, e a
 *                     personagem principal e a mesma: ESTRANHA, o token valido
 *                     de OUTRO projeto da instancia Supabase compartilhada.
 *
 * TODA ASERCAO DE RECUSA E EM `err.code`, nunca em texto de mensagem — a mesma
 * regra de rls.test.js, e pelo mesmo motivo: /permission denied/i casa
 * igualmente com um GRANT faltando numa migracao, que e o bug OPOSTO.
 */

const { test, before, after, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const { createHash } = require("node:crypto");

const { subirPostgres } = require("./ajuda/postgres.js");
const { comoPapel, PERMISSAO_NEGADA } = require("./ajuda/sessao.js");
const {
  aplicarMigracoes,
  listarMigracoes,
  PASTA_PADRAO,
} = require("../db/migrar.js");

/** SQLSTATE `check_violation` — o vocabulario fechado recusando. */
const CHECK_VIOLADO = "23514";
/** SQLSTATE `unique_violation` — o codigo repetido, o resgate em dobro. */
const UNICO_VIOLADO = "23505";
/** SQLSTATE `foreign_key_violation` — o codigo ja resgatado que nao se apaga. */
const FK_VIOLADA = "23503";

let bd;

const ANA = "aaaaaaaa-0000-0000-0000-000000000001";
const DORA = "dddddddd-0000-0000-0000-000000000004";
const ESTRANHA = "eeeeeeee-0000-0000-0000-000000000005";

const SESSAO_ANA = { papel: "authenticated", sub: ANA };
const SESSAO_DORA = { papel: "authenticated", sub: DORA };
const SESSAO_ESTRANHA = { papel: "authenticated", sub: ESTRANHA };
const SESSAO_ANON = { papel: "anon" };

const CAFE = "cccccccc-0000-0000-0000-000000000001";
const PED_ANA = "a3333333-0000-0000-0000-000000000001";
const PED_ESTRANHA = "e3333333-0000-0000-0000-000000000005";

// As seis promocoes do cenario. Os cinco estados que a vitrine tem de
// distinguir SEM que nenhuma coluna de status exista: vigente, agendada,
// expirada, desabilitada e arquivada. O sexto e o cupom.
const P_VIGENTE = "10000000-0000-4000-8000-000000000001";
const P_AGENDADA = "10000000-0000-4000-8000-000000000002";
const P_EXPIRADA = "10000000-0000-4000-8000-000000000003";
const P_DESABILITADA = "10000000-0000-4000-8000-000000000004";
const P_ARQUIVADA = "10000000-0000-4000-8000-000000000005";
const P_CODIGO = "10000000-0000-4000-8000-000000000006";

const COD_CAFE20 = "20000000-0000-4000-8000-000000000001";

/**
 * O hash que `promocao_resgates.documento_hash` guarda: SHA-256 do CPF, em hex
 * minusculo. Calculado aqui com o `crypto` do Node de proposito — e exatamente
 * o que o servico vai produzir, entao o CHECK do banco esta sendo medido contra
 * a forma REAL e nao contra uma string de 64 caracteres inventada.
 */
const CPF_DA_ANA = "52998224725";
const HASH_DA_ANA = createHash("sha256").update(CPF_DA_ANA).digest("hex");

async function exigeRecusa(sessao, sql, parametros, contexto, codigo = PERMISSAO_NEGADA) {
  await assert.rejects(
    () => comoPapel(bd.pool, sessao, (cliente) => cliente.query(sql, parametros)),
    (erro) => {
      assert.equal(erro.code, codigo, `deveria recusar com ${codigo}: ${contexto}`);
      return true;
    },
  );
}

/** Recusa vinda do PROPRIO banco (dono, sem RLS no caminho): CHECK e UNIQUE. */
async function exigeRecusaDoBanco(sql, parametros, contexto, codigo = CHECK_VIOLADO) {
  await assert.rejects(
    () => bd.pool.query(sql, parametros),
    (erro) => {
      assert.equal(erro.code, codigo, `deveria recusar com ${codigo}: ${contexto}`);
      return true;
    },
  );
}

/** Conta linhas visiveis numa relacao, sob a sessao dada. */
async function contar(sessao, relacao, filtro = "") {
  return comoPapel(bd.pool, sessao, async (cliente) => {
    const { rows } = await cliente.query(
      `SELECT count(*)::int AS n FROM canastra.${relacao} ${filtro}`,
    );
    return rows[0].n;
  });
}

before(async () => {
  bd = await subirPostgres();
  await aplicarMigracoes(bd.pool);

  await bd.pool.query(
    `INSERT INTO auth.users (id, email) VALUES
       ($1,'ana@ex.com'), ($2,'dora@ex.com'), ($3,'estranha@outroprojeto.com')`,
    [ANA, DORA, ESTRANHA],
  );
  await bd.pool.query(
    `INSERT INTO canastra.clientes (user_id, nome) VALUES ($1,'Ana'), ($2,'Dora')`,
    [ANA, DORA],
  );
  await bd.pool.query("INSERT INTO canastra.admins (user_id) VALUES ($1)", [DORA]);

  await bd.pool.query(
    `INSERT INTO canastra.produtos
       (produto_id, nome, tamanho, categoria, preco, custo, quantidade, sku)
     VALUES ($1, 'Canastra Classico', '250 g', 'Cafe', 54.90, 22.50, 10, 'CAN-CLA-250')`,
    [CAFE],
  );
  await bd.pool.query(
    `INSERT INTO canastra.pedidos (pedido_id, user_id, total, itens) VALUES
       ($1, $2, 99.90, '[]'::jsonb),
       ($3, NULL, 42.00, '[]'::jsonb)`,
    [PED_ANA, ANA, PED_ESTRANHA],
  );

  // As cinco promocoes automaticas, uma por estado DERIVADO. Repare que a
  // unica diferenca entre a vigente e as outras quatro sao datas, `habilitada`
  // e `arquivada_em` — nao ha coluna de status em lugar nenhum, e e essa
  // ausencia que este arquivo mede.
  await bd.pool.query(
    `INSERT INTO canastra.promocoes
       (id, nome, metodo, classe, mecanica, valor, prioridade,
        inicio_em, fim_em, habilitada, arquivada_em)
     VALUES
       ($1, 'Dez por cento no cafe', 'automatico', 'produto', 'percentual', 10, 10,
        now() - interval '1 day', now() + interval '1 day', true, NULL),
       ($2, 'Semana Santa (agendada)', 'automatico', 'produto', 'percentual', 15, 0,
        now() + interval '10 days', now() + interval '20 days', true, NULL),
       ($3, 'Black Friday (expirada)', 'automatico', 'produto', 'percentual', 30, 0,
        now() - interval '20 days', now() - interval '10 days', true, NULL),
       ($4, 'Desligada no interruptor', 'automatico', 'produto', 'percentual', 20, 0,
        now() - interval '1 day', now() + interval '1 day', false, NULL),
       ($5, 'Campanha antiga', 'automatico', 'produto', 'percentual', 25, 0,
        now() - interval '1 day', now() + interval '1 day', true, now())`,
    [P_VIGENTE, P_AGENDADA, P_EXPIRADA, P_DESABILITADA, P_ARQUIVADA],
  );

  // O cupom, que no modelo novo e a MESMA entidade com outra porta de entrada.
  await bd.pool.query(
    `INSERT INTO canastra.promocoes
       (id, nome, metodo, classe, mecanica, valor, minimo_tipo, minimo_valor,
        limite_usos, limite_por_cliente, inicio_em, fim_em)
     VALUES ($1, 'CAFE20 do influenciador', 'codigo', 'pedido', 'percentual', 20,
             'subtotal', 15000, 500, 1,
             now() - interval '1 day', now() + interval '30 days')`,
    [P_CODIGO],
  );
  await bd.pool.query(
    `INSERT INTO canastra.promocao_codigos (id, promocao_id, codigo, limite_usos)
     VALUES ($1, $2, 'CAFE20', 500)`,
    [COD_CAFE20, P_CODIGO],
  );

  // "10% na loja toda, MENOS o micro-lote" — as duas linhas que hoje nao tem
  // como existir, porque o escopo legado sao tres colunas mutuamente
  // exclusivas com UM produto_id.
  await bd.pool.query(
    `INSERT INTO canastra.promocao_escopo (promocao_id, tipo, alvo, incluir) VALUES
       ($1, 'todos',   NULL,           true),
       ($1, 'sku',     'CAN-MICRO-250', false)`,
    [P_VIGENTE],
  );

  await bd.pool.query(
    `INSERT INTO canastra.promocao_faixas
       (promocao_id, quantidade_min, desconto_tipo, desconto_valor) VALUES
       ($1, 3,  'percentual', 10),
       ($1, 6,  'percentual', 15),
       ($1, 12, 'percentual', 20)`,
    [P_VIGENTE],
  );

  await bd.pool.query(
    `INSERT INTO canastra.promocao_frete
       (promocao_id, teto_frete_centavos, ufs, apenas_modalidade_mais_barata,
        cep_inicio, cep_fim)
     VALUES ($1, 4900, ARRAY['MG','SP'], true, '30000000', '39999999')`,
    [P_VIGENTE],
  );

  await bd.pool.query(
    `INSERT INTO canastra.promocao_resgates
       (promocao_id, codigo_id, pedido_id, user_id, documento_hash, valor_centavos)
     VALUES ($1, $2, $3, $4, $5, 1998)`,
    [P_CODIGO, COD_CAFE20, PED_ANA, ANA, HASH_DA_ANA],
  );

  await bd.pool.query(
    `INSERT INTO canastra.pedido_ajustes_desconto
       (pedido_id, promocao_id, codigo, alvo, alvo_ref, sequencia, valor_centavos, rotulo)
     VALUES
       ($1, $2, NULL,     'item',  'CAN-CLA-250', 1, 549,  'Dez por cento no cafe'),
       ($1, $3, 'CAFE20', 'pedido', NULL,         2, 1998, 'CAFE20 do influenciador')`,
    [PED_ANA, P_VIGENTE, P_CODIGO],
  );
}, { timeout: 120_000 });

after(async () => {
  await bd?.derrubar();
});

beforeEach(() => {
  if (!bd) {
    throw new Error(
      "O Postgres nao subiu no before(); a causa real esta no erro daquele hook.",
    );
  }
});

/* --------------------------------------------------------------------------
 * 1 a 4: quem le e quem escreve
 * -------------------------------------------------------------------------- */

test("anon le a promocao VIGENTE, o escopo e as faixas — e so isso", async () => {
  // A vitrine precisa dos tres para renderizar "de/por" e a regra de leve-mais
  // ANTES de qualquer login. E precisa de exatamente tres: o cabecalho, o que a
  // regra alcanca e as faixas de quantidade.
  //
  // O QUE ELA **NAO** PODE VER, e por que a politica publica nao e
  // `USING (true)`:
  //   · promocao AGENDADA .... a campanha da semana que vem e informacao
  //                            comercial; um concorrente leria o calendario
  //                            inteiro da loja com um GET.
  //   · promocao de CODIGO ... a existencia e o valor do cupom circulam fora da
  //                            loja de proposito (anuncio, influenciador). Quem
  //                            valida codigo e `POST /cupons/validar`, que
  //                            responde so sobre O codigo perguntado (0010).
  //   · expirada / desabilitada / arquivada ... nao valem hoje.
  //
  // O TROCO DISSO E BOM: como a politica publica NAO e `true`, nenhum nome novo
  // entra na lista `PUBLICAS` de rls.test.js. A decisao fica no predicado, onde
  // se le, em vez de numa lista que so diz "sim, publica".
  const visto = await comoPapel(bd.pool, SESSAO_ANON, async (cliente) => {
    const promocoes = await cliente.query(
      "SELECT nome FROM canastra.promocoes ORDER BY nome",
    );
    const escopo = await cliente.query(
      "SELECT tipo, alvo, incluir FROM canastra.promocao_escopo ORDER BY tipo",
    );
    const faixas = await cliente.query(
      "SELECT quantidade_min FROM canastra.promocao_faixas ORDER BY quantidade_min",
    );
    return {
      promocoes: promocoes.rows.map((r) => r.nome),
      escopo: escopo.rows.map((r) => `${r.tipo}:${r.alvo ?? "-"}:${r.incluir}`),
      faixas: faixas.rows.map((r) => r.quantidade_min),
    };
  });

  assert.deepEqual(visto, {
    promocoes: ["Dez por cento no cafe"],
    // O `incluir = false` do micro-lote chega junto: sem ele a vitrine
    // anunciaria 10% num cafe que o checkout nao vai descontar.
    escopo: ["sku:CAN-MICRO-250:false", "todos:-:true"],
    faixas: [3, 6, 12],
  });
});

test("anon NAO le os resgates, nem os ajustes do pedido — nem com select=*", async () => {
  // AS DUAS RELACOES QUE CARREGAM VINCULO COM PESSOA. `promocao_resgates` liga
  // uma promocao a um `user_id` e ao hash do CPF de quem comprou;
  // `pedido_ajustes_desconto` liga um pedido ao que foi descontado nele. Nenhuma
  // das duas recebe GRANT para `anon` — a regra de 0001, que inverteu o padrao
  // justamente para o esquecimento virar 42501 barulhento em vez de vazamento
  // calado.
  //
  // A recusa e de PRIVILEGIO (42501) e nao de politica (zero linhas), e a
  // diferenca importa: politica ausente hoje e uma propriedade que um
  // `CREATE POLICY ... FOR SELECT TO anon` distraido apaga amanha. GRANT
  // ausente nao se perde assim.
  for (const relacao of ["promocao_resgates", "pedido_ajustes_desconto"]) {
    await exigeRecusa(
      SESSAO_ANON,
      `SELECT * FROM canastra.${relacao}`,
      [],
      `anon lendo ${relacao}`,
    );
    await exigeRecusa(
      SESSAO_ANON,
      `SELECT count(*) FROM canastra.${relacao}`,
      [],
      `anon contando ${relacao}`,
    );
  }

  // E `promocao_codigos` tambem nao: a lista de codigos e o mapa de descontos da
  // loja, e um GET nela entregaria 500 codigos de influenciador de uma vez.
  await exigeRecusa(
    SESSAO_ANON,
    "SELECT codigo FROM canastra.promocao_codigos",
    [],
    "anon lendo a lista de codigos",
  );
});

test("cliente logado nao escreve NADA do motor, e a intrusa tampouco", async () => {
  // Ana e cliente de verdade (`eh_cliente()` diz sim) e ESTRANHA e o token de
  // outro projeto da instancia compartilhada. As duas recebem a mesma resposta,
  // e e assim que tem de ser: o que separa quem escreve promocao do resto NAO e
  // "estar logado", e `canastra.eh_admin()` — linha em `canastra.admins`, nunca
  // um claim de JWT.
  const ESCRITAS = [
    [
      "promocoes",
      `INSERT INTO canastra.promocoes (nome, metodo, classe, mecanica, valor)
       VALUES ('Desconto que eu inventei', 'automatico', 'produto', 'percentual', 90)`,
    ],
    [
      "promocao_codigos",
      `INSERT INTO canastra.promocao_codigos (promocao_id, codigo)
       VALUES ('${P_CODIGO}', 'MEUCODIGO')`,
    ],
    [
      "promocao_escopo",
      `INSERT INTO canastra.promocao_escopo (promocao_id, tipo, alvo, incluir)
       VALUES ('${P_VIGENTE}', 'sku', 'CAN-CLA-250', true)`,
    ],
    [
      "promocao_faixas",
      `INSERT INTO canastra.promocao_faixas
         (promocao_id, quantidade_min, desconto_tipo, desconto_valor)
       VALUES ('${P_AGENDADA}', 2, 'percentual', 90)`,
    ],
    [
      "promocao_frete",
      `INSERT INTO canastra.promocao_frete (promocao_id, teto_frete_centavos)
       VALUES ('${P_AGENDADA}', 100000)`,
    ],
    [
      "promocao_resgates",
      `INSERT INTO canastra.promocao_resgates
         (promocao_id, pedido_id, valor_centavos)
       VALUES ('${P_VIGENTE}', '${PED_ANA}', 9999)`,
    ],
    [
      "pedido_ajustes_desconto",
      `INSERT INTO canastra.pedido_ajustes_desconto
         (pedido_id, alvo, sequencia, valor_centavos, rotulo)
       VALUES ('${PED_ANA}', 'pedido', 9, 9999, 'De graca')`,
    ],
  ];

  for (const [quem, sessao] of [
    ["cliente", SESSAO_ANA],
    ["intrusa", SESSAO_ESTRANHA],
  ]) {
    for (const [tabela, sql] of ESCRITAS) {
      await exigeRecusa(sessao, sql, [], `${quem} inserindo em ${tabela}`);
    }
  }

  // E o UPDATE, que recusa de outro JEITO nas tabelas de regra: o USING nao casa
  // linha nenhuma e o comando volta "0 linhas afetadas", SEM erro. E a semantica
  // normal da RLS, e quem depurar isto em producao precisa saber que "0 linhas"
  // tambem e uma recusa.
  const afetadas = await comoPapel(bd.pool, SESSAO_ANA, async (cliente) => {
    const { rowCount } = await cliente.query(
      "UPDATE canastra.promocoes SET valor = 90 WHERE id = $1",
      [P_VIGENTE],
    );
    return rowCount;
  });
  assert.equal(afetadas, 0, "o cliente nao altera promocao, e nem fica sabendo");

  // Nas duas tabelas de registro (resgate e ajuste) a recusa e um andar ABAIXO,
  // no privilegio: `authenticated` nao tem UPDATE nelas de forma nenhuma.
  await exigeRecusa(
    SESSAO_ANA,
    "UPDATE canastra.promocao_resgates SET valor_centavos = 0",
    [],
    "cliente mexendo no proprio resgate",
  );
});

test("DORA administra as CINCO tabelas de regra — e nao toca nas duas de registro", async () => {
  // O recorte que esta migracao faz, e ele nao e obvio: das sete tabelas, cinco
  // sao a REGRA (o gestor cria, edita, apaga uma faixa de quantidade) e duas sao
  // o REGISTRO do que ja aconteceu — `promocao_resgates` e
  // `pedido_ajustes_desconto`. As duas ultimas sao escritas pelo servico Node,
  // dentro da mesma transacao que reserva estoque, e nao pelo navegador. O
  // argumento e o de `pedidos` em 0006: valor de venda escrito por quem nao
  // passou pelo checkout foi o achado de auditoria que aquela fase fechou.
  const feito = await comoPapel(bd.pool, SESSAO_DORA, async (cliente) => {
    const promo = await cliente.query(
      `INSERT INTO canastra.promocoes
         (nome, metodo, classe, mecanica, valor, minimo_tipo, minimo_valor,
          meios_pagamento, exclusiva, grupo_exclusividade)
       VALUES ('Cinco por cento no PIX', 'automatico', 'pedido', 'percentual', 5,
               'subtotal', 10000, ARRAY['pix'], true, 'pagamento')
       RETURNING id`,
    );
    const nova = promo.rows[0].id;

    const codigo = await cliente.query(
      "INSERT INTO canastra.promocao_codigos (promocao_id, codigo) VALUES ($1, 'PIXCINCO')",
      [nova],
    );
    const escopo = await cliente.query(
      `INSERT INTO canastra.promocao_escopo (promocao_id, tipo, alvo, incluir)
       VALUES ($1, 'categoria', 'Cafe', true)`,
      [nova],
    );
    const faixa = await cliente.query(
      `INSERT INTO canastra.promocao_faixas
         (promocao_id, quantidade_min, desconto_tipo, desconto_valor)
       VALUES ($1, 2, 'pague_y', 1)`,
      [nova],
    );
    const frete = await cliente.query(
      `INSERT INTO canastra.promocao_frete (promocao_id, ufs, cep_inicio, cep_fim)
       VALUES ($1, ARRAY['MG'], '30000000', '39999999')`,
      [nova],
    );

    // Editar, que e o caminho de todo dia — e que precisa continuar funcionando
    // FORA da janela, senao a armadilha do painel legado volta (ver o teste do
    // status derivado).
    const editado = await cliente.query(
      `UPDATE canastra.promocoes SET valor = 7, atualizada_em = now() WHERE id = $1`,
      [nova],
    );
    // Tirar uma faixa da regra e edicao, nao apagamento de historico: aqui o
    // DELETE e legitimo e continua aberto.
    const faixaFora = await cliente.query(
      "DELETE FROM canastra.promocao_faixas WHERE promocao_id = $1",
      [nova],
    );

    // E ela enxerga as SEIS promocoes do cenario mais a que acabou de criar —
    // inclusive a agendada, a expirada e a arquivada, que a vitrine nao ve.
    const todas = await cliente.query(
      "SELECT count(*)::int AS n FROM canastra.promocoes",
    );
    const resgates = await cliente.query(
      "SELECT count(*)::int AS n FROM canastra.promocao_resgates",
    );
    const ajustes = await cliente.query(
      "SELECT count(*)::int AS n FROM canastra.pedido_ajustes_desconto",
    );

    return {
      promocaoCriada: promo.rowCount,
      codigoCriado: codigo.rowCount,
      escopoCriado: escopo.rowCount,
      faixaCriada: faixa.rowCount,
      freteCriado: frete.rowCount,
      editado: editado.rowCount,
      faixaRemovida: faixaFora.rowCount,
      promocoesVisiveis: todas.rows[0].n,
      resgatesVisiveis: resgates.rows[0].n,
      ajustesVisiveis: ajustes.rows[0].n,
    };
  });

  assert.deepEqual(feito, {
    promocaoCriada: 1,
    codigoCriado: 1,
    escopoCriado: 1,
    faixaCriada: 1,
    freteCriado: 1,
    editado: 1,
    faixaRemovida: 1,
    promocoesVisiveis: 7,
    // O painel LE os dois registros — e dele que sai o relatorio de campanha e a
    // resposta para "por que este pedido saiu por R$ 137,40".
    resgatesVisiveis: 1,
    ajustesVisiveis: 2,
  });

  // Mas nao os ESCREVE. Nem a admin: o resgate nasce na transacao do checkout, e
  // o ajuste e a fotografia do que foi cobrado.
  await exigeRecusa(
    SESSAO_DORA,
    `INSERT INTO canastra.promocao_resgates (promocao_id, pedido_id, valor_centavos)
     VALUES ($1, $2, 100000)`,
    [P_VIGENTE, PED_ESTRANHA],
    "admin fabricando resgate",
  );
  await exigeRecusa(
    SESSAO_DORA,
    `INSERT INTO canastra.pedido_ajustes_desconto
       (pedido_id, alvo, sequencia, valor_centavos, rotulo)
     VALUES ($1, 'pedido', 9, 100000, 'Ajuste a mao')`,
    [PED_ANA],
    "admin reescrevendo o desconto de uma venda",
  );
});

/* --------------------------------------------------------------------------
 * 5 a 9: o vocabulario fechado por CHECK, e nao por validacao no JS
 * -------------------------------------------------------------------------- */

test("`metodo` fora de (automatico, codigo) e recusado pelo BANCO", async () => {
  // A promocao e o cupom viram UMA entidade com duas portas de entrada:
  // `automatico` aplica sozinho no carrinho, `codigo` exige digitar. Um terceiro
  // valor nao e uma porta nova — e uma regra que nenhum caminho do motor vai
  // encontrar, salva com sucesso e invisivel para sempre. E o mesmo modo de
  // falha da promocao legada sem datas.
  await exigeRecusaDoBanco(
    `INSERT INTO canastra.promocoes (nome, metodo, classe, mecanica, valor)
     VALUES ('Metodo inventado', 'manual', 'produto', 'percentual', 10)`,
    [],
    "metodo 'manual'",
  );
});

test("`classe` fora de (produto, pedido, frete) e recusada", async () => {
  // A classe decide SOBRE O QUE o desconto incide: o item, o subtotal ou o
  // frete. E o campo que hoje nao existe — e a ausencia dele e por que
  // `promocoes` e `cupons` divergem em silencio, uma descontando por produto e a
  // outra sobre o subtotal, sem nada no schema dizendo qual e qual.
  await exigeRecusaDoBanco(
    `INSERT INTO canastra.promocoes (nome, metodo, classe, mecanica, valor)
     VALUES ('Classe inventada', 'automatico', 'cliente', 'percentual', 10)`,
    [],
    "classe 'cliente'",
  );
});

test("`mecanica` fora da lista e recusada, nas sete formas aceitas", async () => {
  await exigeRecusaDoBanco(
    `INSERT INTO canastra.promocoes (nome, metodo, classe, mecanica, valor)
     VALUES ('Mecanica inventada', 'automatico', 'produto', 'cashback', 10)`,
    [],
    "mecanica 'cashback'",
  );

  // E o lado positivo, sem o qual o CHECK poderia estar apertado demais e o
  // teste acima passaria igual: as sete que a spec lista entram.
  const ACEITAS = [
    ["percentual", 10],
    ["valor_fixo", 5],
    ["preco_fixo", 39.9],
    ["leve_x_pague_y", 3],
    ["progressivo", 1],
    ["brinde", 1],
    ["frete_gratis", 1],
  ];
  for (const [mecanica, valor] of ACEITAS) {
    const { rowCount } = await bd.pool.query(
      `INSERT INTO canastra.promocoes (nome, metodo, classe, mecanica, valor)
       VALUES ($1, 'automatico', 'produto', $2, $3)`,
      [`Aceita ${mecanica}`, mecanica, valor],
    );
    assert.equal(rowCount, 1, `${mecanica} deveria ser aceita`);
  }
  await bd.pool.query("DELETE FROM canastra.promocoes WHERE nome LIKE 'Aceita %'");
});

test("percentual acima de 90 e recusado — o MESMO teto que `cupons` ja tem", async () => {
  // 0010 escreveu o teto no banco porque "cupom e um segredo que circula fora da
  // loja (anuncio, influencer) e o custo de um erro e maior". Na promocao ele so
  // existia em `promotionsRepository.validarDesconto`, isto e, no JavaScript de
  // UM caminho — quem escrevesse pelo PostgREST, por uma tela nova ou por um
  // INSERT de emergencia passava direto. Um "100%" libera a loja de graca.
  await exigeRecusaDoBanco(
    `INSERT INTO canastra.promocoes (nome, metodo, classe, mecanica, valor)
     VALUES ('Metade de graca', 'automatico', 'produto', 'percentual', 95)`,
    [],
    "percentual de 95%",
  );
  await exigeRecusaDoBanco(
    `INSERT INTO canastra.promocoes (nome, metodo, classe, mecanica, valor)
     VALUES ('Percentual zero', 'automatico', 'produto', 'percentual', 0)`,
    [],
    "percentual de 0%",
  );

  // 90 EXATO passa: o teto e inclusivo, igual ao de `cupons`. Sem esta linha o
  // teste acima ficaria verde tambem com um `< 90` escrito por engano, e a
  // diferenca apareceria so no dia de uma campanha de 90%.
  const { rowCount } = await bd.pool.query(
    `INSERT INTO canastra.promocoes (nome, metodo, classe, mecanica, valor)
     VALUES ('Noventa cravados', 'automatico', 'produto', 'percentual', 90)`,
  );
  assert.equal(rowCount, 1);
  await bd.pool.query("DELETE FROM canastra.promocoes WHERE nome = 'Noventa cravados'");

  // E `valor_fixo` NAO tem teto, pelo motivo de 0010: o servico trava o desconto
  // no subtotal, entao um fixo maior que a compra desconta a compra e para.
  const fixo = await bd.pool.query(
    `INSERT INTO canastra.promocoes (nome, metodo, classe, mecanica, valor)
     VALUES ('Cem reais de abatimento', 'automatico', 'pedido', 'valor_fixo', 100)`,
  );
  assert.equal(fixo.rowCount, 1);
  await bd.pool.query(
    "DELETE FROM canastra.promocoes WHERE nome = 'Cem reais de abatimento'",
  );

  // A mesma regra vale na FAIXA, que e onde ela seria esquecida: `progressivo`
  // guarda o percentual em `promocao_faixas`, nao em `promocoes.valor`.
  await exigeRecusaDoBanco(
    `INSERT INTO canastra.promocao_faixas
       (promocao_id, quantidade_min, desconto_tipo, desconto_valor)
     VALUES ($1, 24, 'percentual', 95)`,
    [P_VIGENTE],
    "faixa com 95%",
  );
});

test("`minimo_tipo` e `minimo_valor` sao coerentes nos dois sentidos", async () => {
  // O par so tem tres formas validas, e as outras duas sao armadilhas caladas:
  //
  //   nenhum   + valor NULL ..... ok, a regra nao tem minimo
  //   subtotal + valor 15000 .... ok, R$ 150 em centavos
  //   quantidade + valor 3 ...... ok, tres unidades
  //   nenhum   + valor 15000 .... o gestor digitou o minimo e depois trocou o
  //                               tipo para "nenhum"; a tela mostra R$ 150 e o
  //                               motor ignora. Ninguem descobre.
  //   subtotal + valor NULL ..... "acima de nada" — a regra vale sempre, e o
  //                               gestor acha que colocou um piso.
  await exigeRecusaDoBanco(
    `INSERT INTO canastra.promocoes
       (nome, metodo, classe, mecanica, valor, minimo_tipo, minimo_valor)
     VALUES ('Minimo fantasma', 'automatico', 'pedido', 'percentual', 10,
             'nenhum', 15000)`,
    [],
    "'nenhum' com valor",
  );
  await exigeRecusaDoBanco(
    `INSERT INTO canastra.promocoes
       (nome, metodo, classe, mecanica, valor, minimo_tipo, minimo_valor)
     VALUES ('Minimo vazio', 'automatico', 'pedido', 'percentual', 10,
             'subtotal', NULL)`,
    [],
    "'subtotal' sem valor",
  );
  await exigeRecusaDoBanco(
    `INSERT INTO canastra.promocoes
       (nome, metodo, classe, mecanica, valor, minimo_tipo, minimo_valor)
     VALUES ('Minimo zero', 'automatico', 'pedido', 'percentual', 10,
             'quantidade', 0)`,
    [],
    "'quantidade' com zero",
  );
  await exigeRecusaDoBanco(
    `INSERT INTO canastra.promocoes
       (nome, metodo, classe, mecanica, valor, minimo_tipo)
     VALUES ('Minimo inventado', 'automatico', 'pedido', 'percentual', 10, 'peso')`,
    [],
    "minimo_tipo 'peso'",
  );

  // As tres formas validas passam.
  const { rowCount } = await bd.pool.query(
    `INSERT INTO canastra.promocoes
       (nome, metodo, classe, mecanica, valor, minimo_tipo, minimo_valor) VALUES
       ('Sem minimo',   'automatico', 'pedido', 'percentual', 10, 'nenhum',     NULL),
       ('Minimo em RS', 'automatico', 'pedido', 'percentual', 10, 'subtotal',   15000),
       ('Minimo em un', 'automatico', 'pedido', 'percentual', 10, 'quantidade', 3)`,
  );
  assert.equal(rowCount, 3);
  await bd.pool.query(
    "DELETE FROM canastra.promocoes WHERE nome IN ('Sem minimo','Minimo em RS','Minimo em un')",
  );
});

/* --------------------------------------------------------------------------
 * 10 a 13: unicidade, faixas e CEP
 * -------------------------------------------------------------------------- */

test("o mesmo codigo nao existe duas vezes, nem em promocoes diferentes", async () => {
  // A busca do checkout e por IGUALDADE EXATA num codigo. Dois donos para
  // 'CAFE20' quer dizer que qual desconto o cliente recebe depende da ordem de
  // varredura do Postgres — e a segunda campanha simplesmente nunca aparece.
  await exigeRecusaDoBanco(
    "INSERT INTO canastra.promocao_codigos (promocao_id, codigo) VALUES ($1, 'CAFE20')",
    [P_VIGENTE],
    "codigo repetido em outra promocao",
    UNICO_VIOLADO,
  );

  // E o formato e o MESMO de `cupons` (0010): A-Z e 0-9, 3 a 30. O codigo e
  // salvo maiusculo pelo servico; o CHECK tranca o caminho que nao passa por
  // ele, porque um codigo minusculo gravado aqui seria invisivel para sempre.
  for (const [caso, codigo] of [
    ["minusculo", "cafe20x"],
    ["com espaco", "CAFE 20"],
    ["com acento", "CAFÉ20"],
    ["curto demais", "AB"],
  ]) {
    await exigeRecusaDoBanco(
      "INSERT INTO canastra.promocao_codigos (promocao_id, codigo) VALUES ($1, $2)",
      [P_CODIGO, codigo],
      `codigo ${caso}`,
    );
  }

  // A ENTIDADE QUE ISTO CRIA, e que hoje nao existe: N codigos para UMA regra.
  // Sao os 500 codigos de influenciador rastreaveis um a um, com um relatorio so
  // — hoje seriam 500 linhas em `cupons`, cada uma com sua propria copia da
  // regra, divergindo na primeira correcao.
  const { rowCount } = await bd.pool.query(
    `INSERT INTO canastra.promocao_codigos (promocao_id, codigo) VALUES
       ($1, 'CAFE20MARIA'), ($1, 'CAFE20JOAO')`,
    [P_CODIGO],
  );
  assert.equal(rowCount, 2);
  await bd.pool.query(
    "DELETE FROM canastra.promocao_codigos WHERE codigo IN ('CAFE20MARIA','CAFE20JOAO')",
  );
});

test("o mesmo (promocao, pedido) nao resgata duas vezes — e o resgate nao se apaga", async () => {
  // O UNIQUE que sustenta o contador. Sem ele, uma reentrega de webhook do
  // Mercado Pago — que o MP faz POR DESENHO — gravaria o resgate de novo, e o
  // relatorio de campanha contaria duas vendas onde houve uma. E o mesmo
  // argumento dos indices parciais de idempotencia de 0005.
  await exigeRecusaDoBanco(
    `INSERT INTO canastra.promocao_resgates
       (promocao_id, codigo_id, pedido_id, valor_centavos)
     VALUES ($1, $2, $3, 1998)`,
    [P_CODIGO, COD_CAFE20, PED_ANA],
    "resgate em dobro do mesmo par",
    UNICO_VIOLADO,
  );

  // DEVOLVER O USO E `estornado_em`, NAO DELETE. Pedido cancelado ou PIX
  // expirado precisa devolver o uso — e apagar a linha apagaria junto o registro
  // de que a campanha foi tentada, que e metade do relatorio.
  const estornado = await bd.pool.query(
    `UPDATE canastra.promocao_resgates SET estornado_em = now()
      WHERE promocao_id = $1 AND pedido_id = $2`,
    [P_CODIGO, PED_ANA],
  );
  assert.equal(estornado.rowCount, 1);
  await bd.pool.query(
    "UPDATE canastra.promocao_resgates SET estornado_em = NULL WHERE pedido_id = $1",
    [PED_ANA],
  );

  // E o codigo JA RESGATADO nao pode ser apagado por baixo do relatorio: a FK e
  // RESTRICT de proposito, entao a recusa e 23503 e nao um SET NULL calado que
  // deixaria o resgate orfao de campanha.
  await exigeRecusaDoBanco(
    "DELETE FROM canastra.promocao_codigos WHERE id = $1",
    [COD_CAFE20],
    "apagar codigo com resgate",
    FK_VIOLADA,
  );
});

test("faixa com `quantidade_min` repetida na mesma promocao e recusada", async () => {
  // Duas faixas com o mesmo piso e uma regra que nao tem resposta: leve 6, pague
  // 15% ou 20%? O motor escolheria pela ordem do heap. O UNIQUE fecha isso no
  // banco, que e onde a spec pediu — em vez de num jsonb solto que ninguem
  // consegue validar.
  await exigeRecusaDoBanco(
    `INSERT INTO canastra.promocao_faixas
       (promocao_id, quantidade_min, desconto_tipo, desconto_valor)
     VALUES ($1, 6, 'percentual', 20)`,
    [P_VIGENTE],
    "faixa 6 repetida",
    UNICO_VIOLADO,
  );

  // O MESMO piso em OUTRA promocao passa: o UNIQUE e do par, nao da coluna.
  const outra = await bd.pool.query(
    `INSERT INTO canastra.promocao_faixas
       (promocao_id, quantidade_min, desconto_tipo, desconto_valor)
     VALUES ($1, 6, 'percentual', 20)`,
    [P_AGENDADA],
  );
  assert.equal(outra.rowCount, 1);
  await bd.pool.query("DELETE FROM canastra.promocao_faixas WHERE promocao_id = $1", [
    P_AGENDADA,
  ]);

  // `leve 3 pague 2` so faz sentido com o pague MENOR que o leve. `pague_y` com
  // valor maior ou igual ao piso e um desconto negativo escrito com cara de
  // promocao.
  await exigeRecusaDoBanco(
    `INSERT INTO canastra.promocao_faixas
       (promocao_id, quantidade_min, desconto_tipo, desconto_valor)
     VALUES ($1, 3, 'pague_y', 3)`,
    [P_AGENDADA],
    "leve 3 pague 3",
  );
  await exigeRecusaDoBanco(
    `INSERT INTO canastra.promocao_faixas
       (promocao_id, quantidade_min, desconto_tipo, desconto_valor)
     VALUES ($1, 0, 'percentual', 10)`,
    [P_AGENDADA],
    "faixa a partir de zero unidades",
  );
});

test("`promocao_frete` aceita UF e faixa de CEP, e recusa CEP nao-numerico", async () => {
  // O BUG QUE ESTE CHECK IMPEDE JA ACONTECEU NESTA LOJA, no CEP de ORIGEM
  // (commit 7fe8d36): comparar '01310-100' com '01310100' e uma regra que passa
  // em todo teste escrito com o formato certo e falha em producao no primeiro
  // cliente que digitar o hifen. O CEP entra normalizado a digitos, e o CHECK e
  // quem garante que o caminho que esquecer a normalizacao ERRE.
  for (const [caso, inicio, fim] of [
    ["com hifen", "01310-100", "01399999"],
    ["curto", "3000000", "39999999"],
    ["longo", "300000000", "399999999"],
    ["com letra", "3000000A", "39999999"],
    ["vazio", "", "39999999"],
  ]) {
    await exigeRecusaDoBanco(
      `INSERT INTO canastra.promocao_frete (promocao_id, cep_inicio, cep_fim)
       VALUES ($1, $2, $3)`,
      [P_AGENDADA, inicio, fim],
      `cep ${caso}`,
    );
  }

  // Faixa invertida: '39999999' a '30000000' nao alcanca CEP nenhum, e a regra
  // salva com sucesso simplesmente nunca vale.
  await exigeRecusaDoBanco(
    `INSERT INTO canastra.promocao_frete (promocao_id, cep_inicio, cep_fim)
     VALUES ($1, '39999999', '30000000')`,
    [P_AGENDADA],
    "faixa de CEP invertida",
  );
  // E meia faixa e faixa nenhuma.
  await exigeRecusaDoBanco(
    `INSERT INTO canastra.promocao_frete (promocao_id, cep_inicio) VALUES ($1, '30000000')`,
    [P_AGENDADA],
    "cep_inicio sem cep_fim",
  );

  // UF fora da federacao, e a lista vazia — que nao quer dizer "todas", quer
  // dizer "nenhuma", exatamente a confusao que 0010 barrou em `limite_usos = 0`.
  await exigeRecusaDoBanco(
    "INSERT INTO canastra.promocao_frete (promocao_id, ufs) VALUES ($1, ARRAY['XX'])",
    [P_AGENDADA],
    "UF inexistente",
  );
  await exigeRecusaDoBanco(
    "INSERT INTO canastra.promocao_frete (promocao_id, ufs) VALUES ($1, ARRAY[]::text[])",
    [P_AGENDADA],
    "lista de UF vazia",
  );

  // E o que a regra de verdade guarda, lido de volta. O TETO nao e capricho:
  // sem ele, "frete gratis acima de R$ 149" significa bancar um SEDEX de R$ 90
  // para o Acre toda semana, saindo da margem.
  const { rows } = await bd.pool.query(
    `SELECT teto_frete_centavos, ufs, apenas_modalidade_mais_barata, cep_inicio, cep_fim
       FROM canastra.promocao_frete WHERE promocao_id = $1`,
    [P_VIGENTE],
  );
  assert.deepEqual(rows[0], {
    teto_frete_centavos: 4900,
    ufs: ["MG", "SP"],
    // Sem ele o cliente escolhe SEDEX de graca quando a loja queria bancar o PAC.
    apenas_modalidade_mais_barata: true,
    cep_inicio: "30000000",
    cep_fim: "39999999",
  });

  // UMA configuracao de frete POR promocao: a chave primaria e o proprio
  // `promocao_id`. Duas linhas dariam dois tetos para a mesma regra.
  await exigeRecusaDoBanco(
    "INSERT INTO canastra.promocao_frete (promocao_id, ufs) VALUES ($1, ARRAY['RJ'])",
    [P_VIGENTE],
    "segunda configuracao de frete na mesma promocao",
    UNICO_VIOLADO,
  );
});

/* --------------------------------------------------------------------------
 * 14: a migracao de dados
 * -------------------------------------------------------------------------- */

test("um cupom existente atravessa com codigo, valor, minimo, limite e janela", async () => {
  // O TESTE QUE NAO CABE NO CLUSTER DE CIMA, e o motivo e estrutural: quando o
  // `before()` deste arquivo roda, 0032 JA foi aplicada e `cupons` estava vazia.
  // Para medir a migracao de dados e preciso um banco parado em 0031, com linhas
  // legadas dentro, e so entao aplicar 0032. Por isso este teste sobe o proprio
  // Postgres e o derruba no fim.
  const migracoes = await listarMigracoes(PASTA_PADRAO);
  const numero = (versao) => Number(versao.match(/^(\d+)_/)[1]);
  const ate31 = migracoes.filter((m) => numero(m.versao) <= 31);
  const a32 = migracoes.find((m) => numero(m.versao) === 32);
  assert.ok(a32, "0032 precisa estar na pasta de migracoes");

  const antigo = await subirPostgres();
  try {
    // Sem o `aplicarMigracoes`, que gravaria em `canastra.migracoes` e aplicaria
    // a pasta INTEIRA — inclusive a 0032 que este teste quer aplicar depois, com
    // dados legados no meio. 0001 comeca com `CREATE SCHEMA IF NOT EXISTS`.
    for (const { sql } of ate31) await antigo.pool.query(sql);

    // ANTES DO CAMINHO FELIZ, A GUARDA. `promocoes_legado.tipo` e `text` SEM
    // CHECK (0005) e `valor` e nulavel: o vocabulario percent/fixed e o teto de
    // 90% so existem em `promotionsRepository.validarDesconto`, isto e, no
    // JavaScript de UM caminho. O banco de producao pode ter linha que nenhuma
    // mecanica nova representa — e as tres saidas eram pular (perde uma regra em
    // silencio), adivinhar (muda o dinheiro que o cliente paga) ou PARAR.
    //
    // A asercao e no texto da mensagem, e nao no SQLSTATE, de proposito: o
    // codigo aqui e P0001, o mesmo de QUALQUER RAISE do banco, entao asserir
    // nele casaria com falha alheia e o teste passaria verde por motivo errado.
    // O que se mede e que o operador recebe o id e o comando que resolve.
    await antigo.pool.query(`
      INSERT INTO canastra.promocoes (titulo, tipo, valor, aplica_a, ativa)
      VALUES ('Tipo que ninguem representa', 'brinde', 10, 'all', true)
    `);
    await assert.rejects(
      () => antigo.pool.query(a32.sql),
      (erro) => {
        assert.match(erro.message, /nenhuma mecanica nova representa/);
        return true;
      },
    );
    // E o banco fica EXATAMENTE como estava: o runner aplica cada migracao numa
    // transacao propria (`db/migrar.js:266`), e o `pg` manda este arquivo inteiro
    // como um lote so — a excecao desfaz ate o RENAME da tabela legada.
    const { rows: intacto } = await antigo.pool.query(`
      SELECT count(*)::int AS n FROM information_schema.tables
       WHERE table_schema = 'canastra' AND table_name = 'promocoes_legado'
    `);
    assert.equal(intacto[0].n, 0, "0032 abortada nao pode deixar meia renomeacao");
    await antigo.pool.query(
      "DELETE FROM canastra.promocoes WHERE titulo = 'Tipo que ninguem representa'",
    );

    // Um cupom de cada forma que 0010 permite, para nenhuma coluna atravessar
    // por acidente de default.
    await antigo.pool.query(`
      INSERT INTO canastra.cupons
        (codigo, tipo, valor, descricao, minimo_centavos, limite_usos, usos,
         ativo, inicio_em, fim_em)
      VALUES
        ('CAFE10', 'percent', 10, 'Dez por cento', 15000, 200, 37, true,
         '2026-01-01T00:00:00Z', '2026-12-31T23:59:59Z'),
        ('CINCO',  'fixed',   5,  NULL,             0,     NULL, 0, false, NULL, NULL);
    `);

    // E as duas formas de promocao legada que importam. A segunda e a
    // ARMADILHA: `ativa = true` e SEM datas. No modelo legado ela NUNCA valia —
    // o filtro do checkout exige `inicio_em <= now() AND fim_em >= now()`, e
    // NULL nao satisfaz nenhum dos dois. No modelo novo, datas nulas querem
    // dizer "sem janela", isto e, vale sempre. Migrar `habilitada = ativa` cru
    // LIGARIA um desconto que nunca valeu, em producao, sem ninguem pedir.
    await antigo.pool.query(`
      INSERT INTO canastra.promocoes
        (titulo, tipo, valor, aplica_a, categoria, inicio_em, fim_em, ativa)
      VALUES
        ('Semana do coado', 'percent', 15, 'category', 'Cafe',
         '2026-08-01T00:00:00Z', '2026-08-31T23:59:59Z', true),
        ('Nunca valeu',     'fixed',    5, 'all',       NULL, NULL, NULL, true);
    `);

    await antigo.pool.query(a32.sql);

    // O cupom, do outro lado. As cinco coisas que a tarefa exige preservar:
    // codigo, valor, minimo, limite e janela.
    const { rows: cupom } = await antigo.pool.query(`
      SELECT p.nome, p.metodo, p.classe, p.mecanica, p.valor,
             p.minimo_tipo, p.minimo_valor, p.limite_usos,
             p.inicio_em, p.fim_em, p.habilitada,
             c.codigo, c.usos, c.limite_usos AS limite_do_codigo, c.ativo
        FROM canastra.promocoes p
        JOIN canastra.promocao_codigos c ON c.promocao_id = p.id
       WHERE c.codigo = 'CAFE10'
    `);
    assert.equal(cupom.length, 1, "CAFE10 deveria aparecer exatamente uma vez");
    assert.deepEqual(
      {
        metodo: cupom[0].metodo,
        classe: cupom[0].classe,
        mecanica: cupom[0].mecanica,
        valor: Number(cupom[0].valor),
        minimo_tipo: cupom[0].minimo_tipo,
        minimo_valor: cupom[0].minimo_valor,
        limite_usos: cupom[0].limite_usos,
        codigo: cupom[0].codigo,
        usos: cupom[0].usos,
        limite_do_codigo: cupom[0].limite_do_codigo,
        ativo: cupom[0].ativo,
        habilitada: cupom[0].habilitada,
        inicio: cupom[0].inicio_em.toISOString(),
        fim: cupom[0].fim_em.toISOString(),
      },
      {
        metodo: "codigo",
        // Cupom desconta o SUBTOTAL (utils/cupom.js), nao o item.
        classe: "pedido",
        mecanica: "percentual",
        valor: 10,
        minimo_tipo: "subtotal",
        minimo_valor: 15000,
        limite_usos: 200,
        codigo: "CAFE10",
        // O contador vem junto: sem ele um cupom com 37 usos de 200 voltaria a
        // 200 disponiveis no dia da virada.
        usos: 37,
        limite_do_codigo: 200,
        ativo: true,
        habilitada: true,
        inicio: "2026-01-01T00:00:00.000Z",
        fim: "2026-12-31T23:59:59.000Z",
      },
    );

    // O cupom sem minimo e sem janela: `minimo_centavos = 0` vira
    // `minimo_tipo = 'nenhum'` com valor NULL, e nao 'subtotal' com zero — que
    // seria um piso de R$ 0,00, isto e, um piso que nao e piso.
    const { rows: cinco } = await antigo.pool.query(`
      SELECT p.mecanica, p.minimo_tipo, p.minimo_valor, p.limite_usos,
             p.inicio_em, p.fim_em, p.habilitada
        FROM canastra.promocoes p
        JOIN canastra.promocao_codigos c ON c.promocao_id = p.id
       WHERE c.codigo = 'CINCO'
    `);
    assert.deepEqual(cinco, [
      {
        mecanica: "valor_fixo",
        minimo_tipo: "nenhum",
        minimo_valor: null,
        limite_usos: null,
        inicio_em: null,
        fim_em: null,
        // `ativo = false` continua desligado.
        habilitada: false,
      },
    ]);

    // As promocoes legadas viram `metodo = 'automatico'`.
    const { rows: legadas } = await antigo.pool.query(`
      SELECT nome, metodo, classe, mecanica, valor::float8 AS valor, habilitada
        FROM canastra.promocoes
       WHERE metodo = 'automatico'
       ORDER BY nome
    `);
    assert.deepEqual(legadas, [
      {
        nome: "Nunca valeu",
        metodo: "automatico",
        classe: "produto",
        mecanica: "valor_fixo",
        valor: 5,
        // A ARMADILHA, DESARMADA. `ativa = true` no legado, mas sem as duas
        // datas ela nunca entrou em checkout nenhum. Se `habilitada` viesse
        // `true`, a virada LIGARIA um desconto que nunca existiu.
        habilitada: false,
      },
      {
        nome: "Semana do coado",
        metodo: "automatico",
        classe: "produto",
        mecanica: "percentual",
        valor: 15,
        habilitada: true,
      },
    ]);

    // O escopo da promocao legada atravessa junto — senao "15% na categoria
    // Cafe" viraria "15% na loja toda".
    const { rows: escopo } = await antigo.pool.query(`
      SELECT e.tipo, e.alvo, e.incluir
        FROM canastra.promocao_escopo e
        JOIN canastra.promocoes p ON p.id = e.promocao_id
       WHERE p.nome = 'Semana do coado'
    `);
    assert.deepEqual(escopo, [
      { tipo: "categoria", alvo: "Cafe", incluir: true },
    ]);

    // E AS DUAS TABELAS ANTIGAS CONTINUAM DE PE, com as linhas intactas: o
    // checkout ainda as le, e derruba-las agora quebraria a loja. Quem as tira e
    // a migracao nomeada no cabecalho de 0032.
    const { rows: sobreviventes } = await antigo.pool.query(`
      SELECT
        (SELECT count(*)::int FROM canastra.cupons)           AS cupons,
        (SELECT count(*)::int FROM canastra.promocoes_legado) AS legado
    `);
    assert.deepEqual(sobreviventes[0], { cupons: 2, legado: 2 });
  } finally {
    await antigo.derrubar();
  }
}, { timeout: 240_000 });

/* --------------------------------------------------------------------------
 * O que a spec chama de armadilha, medido
 * -------------------------------------------------------------------------- */

test("o status e DERIVADO: editar fora da janela nao desliga a promocao", async () => {
  // A ARMADILHA DO PAINEL LEGADO, escrita como teste. La o status era GRAVADO, e
  // editar uma promocao fora da janela a desativava para sempre — porque o
  // formulario mandava de volta o status que a tela tinha calculado. Aqui nao ha
  // coluna de status: `agendada`, `vigente` e `expirada` saem das datas, e
  // `habilitada` e um interruptor separado que so muda quando alguem o move.
  const depois = await comoPapel(bd.pool, SESSAO_DORA, async (cliente) => {
    const r = await cliente.query(
      "UPDATE canastra.promocoes SET nome = $2, atualizada_em = now() WHERE id = $1",
      [P_EXPIRADA, "Black Friday (renomeada fora da janela)"],
    );
    const { rows } = await cliente.query(
      "SELECT habilitada, arquivada_em FROM canastra.promocoes WHERE id = $1",
      [P_EXPIRADA],
    );
    return { alteradas: r.rowCount, ...rows[0] };
  });

  assert.deepEqual(depois, {
    alteradas: 1,
    // Continua LIGADA. Basta empurrar `fim_em` para a frente e ela volta a
    // valer — que e o que "reeditar uma campanha" quer dizer.
    habilitada: true,
    arquivada_em: null,
  });

  // E nenhuma coluna de status existe para gravar por engano. A asercao e de
  // CATALOGO porque o modo de falha e uma coluna nova aparecendo num ALTER
  // futuro, nao um comportamento errado hoje.
  const { rows } = await bd.pool.query(`
    SELECT column_name FROM information_schema.columns
     WHERE table_schema = 'canastra' AND table_name = 'promocoes'
       AND column_name IN ('status', 'estado', 'situacao')
  `);
  assert.deepEqual(rows, [], "status de promocao e derivado, nunca coluna gravada");
});

test("promocao NAO se apaga: `arquivada_em` e o caminho, e o DELETE recusa", async () => {
  // R13 do plano: nada e apagado de verdade. Promocao apagada quebra o relatorio
  // do pedido que a usou — e `pedido_ajustes_desconto` aponta para ela. Hoje nao
  // existe DELETE de promocao nem de cupom em lugar nenhum da pilha: o painel so
  // oferece "desativar", e a lista so cresce.
  //
  // A trava e de PRIVILEGIO e nao de politica, pela regra que 0031 escreveu:
  // onde o recorte e de OPERACAO INTEIRA, ausencia de politica e propriedade que
  // um `FOR ALL` distraido apaga sem querer. E a politica de admin desta tabela
  // e, justamente, `FOR ALL`.
  for (const [quem, sessao] of [
    ["administradora", SESSAO_DORA],
    ["cliente", SESSAO_ANA],
    ["intrusa", SESSAO_ESTRANHA],
  ]) {
    await exigeRecusa(
      sessao,
      "DELETE FROM canastra.promocoes WHERE id = $1",
      [P_VIGENTE],
      `${quem} apagando promocao`,
    );
    await exigeRecusa(
      sessao,
      "DELETE FROM canastra.promocoes",
      [],
      `${quem} apagando promocao sem WHERE`,
    );
  }

  // O caminho que EXISTE: arquivar. A linha fica, o relatorio antigo continua de
  // pe, e a vitrine para de mostrar.
  const arquivada = await comoPapel(bd.pool, SESSAO_DORA, async (cliente) => {
    const r = await cliente.query(
      "UPDATE canastra.promocoes SET arquivada_em = now() WHERE id = $1",
      [P_VIGENTE],
    );
    const anon = await cliente.query(
      "SELECT count(*)::int AS n FROM canastra.promocoes WHERE id = $1",
      [P_VIGENTE],
    );
    return { arquivadas: r.rowCount, aindaLa: anon.rows[0].n };
  });
  assert.deepEqual(arquivada, { arquivadas: 1, aindaLa: 1 });

  // O mesmo vale para o registro do que ja aconteceu.
  for (const relacao of ["promocao_resgates", "pedido_ajustes_desconto"]) {
    await exigeRecusa(
      SESSAO_DORA,
      `DELETE FROM canastra.${relacao}`,
      [],
      `admin apagando ${relacao}`,
    );
  }
});

test("`documento_hash` so aceita SHA-256 em hex — o CPF cru nao entra", async () => {
  // E-mail e infinito e gratuito: cupom de primeira compra controlado por e-mail
  // e cupom permanente. Por isso o limite por cliente e por CPF. E por isso o
  // que se guarda e o HASH: o numero seria mais uma copia de dado pessoal, e as
  // migracoes 0013 e 0016 desta loja ja pagaram esse preco uma vez.
  //
  // O CHECK e o que transforma "combinamos de guardar o hash" numa garantia:
  // um CPF tem 11 digitos e falha em 23514 antes de tocar o disco.
  for (const [caso, valor] of [
    ["o CPF cru", CPF_DA_ANA],
    ["o CPF formatado", "529.982.247-25"],
    ["hex curto", HASH_DA_ANA.slice(0, 40)],
    ["hex maiusculo", HASH_DA_ANA.toUpperCase()],
    ["vazio", ""],
  ]) {
    await exigeRecusaDoBanco(
      `INSERT INTO canastra.promocao_resgates
         (promocao_id, pedido_id, documento_hash, valor_centavos)
       VALUES ($1, $2, $3, 100)`,
      [P_VIGENTE, PED_ESTRANHA, valor],
      `documento_hash com ${caso}`,
    );
  }

  // E o hash de verdade entra. NULL tambem: pedido de convidado sem CPF existe,
  // e ali o limite por cliente simplesmente nao se aplica.
  const { rowCount } = await bd.pool.query(
    `INSERT INTO canastra.promocao_resgates
       (promocao_id, pedido_id, documento_hash, valor_centavos)
     VALUES ($1, $2, $3, 100)`,
    [P_VIGENTE, PED_ESTRANHA, HASH_DA_ANA],
  );
  assert.equal(rowCount, 1);
  await bd.pool.query("DELETE FROM canastra.promocao_resgates WHERE pedido_id = $1", [
    PED_ESTRANHA,
  ]);
});

test("o dono le a conta do proprio pedido; o vizinho e a intrusa, nao", async () => {
  // "Por que este pedido saiu por R$ 137,40?" e uma pergunta que o CLIENTE faz.
  // Uma linha por desconto aplicado e o que responde — e e a mesma tabela que
  // sustenta a NF-e com desconto rateado por item (o Bling exige) e o estorno
  // proporcional em devolucao parcial.
  //
  // A POLITICA DO DONO SUBCONSULTA `pedidos`, QUE ESTA SOB RLS, e isso e o
  // mesmo acoplamento que `carrinho_itens` documenta em 0006: a subconsulta roda
  // como o INVOCADOR, entao ela enxerga apenas os pedidos que `pedidos_dono_le`
  // deixa a pessoa enxergar. Da certo por construcao — e se um dia aquela
  // politica for estreitada, ESTA tela esvazia SEM ERRO. Quem mexer la releia
  // isto aqui.
  const daAna = await comoPapel(bd.pool, SESSAO_ANA, async (cliente) => {
    const { rows } = await cliente.query(
      `SELECT sequencia, alvo, alvo_ref, valor_centavos, rotulo
         FROM canastra.pedido_ajustes_desconto ORDER BY sequencia`,
    );
    return rows;
  });
  assert.deepEqual(daAna, [
    {
      sequencia: 1,
      alvo: "item",
      alvo_ref: "CAN-CLA-250",
      valor_centavos: 549,
      rotulo: "Dez por cento no cafe",
    },
    {
      sequencia: 2,
      alvo: "pedido",
      alvo_ref: null,
      valor_centavos: 1998,
      rotulo: "CAFE20 do influenciador",
    },
  ]);

  // A intrusa nao ve nada — nem por contagem, que e como se sonda uma tabela
  // sem saber os ids.
  assert.equal(await contar(SESSAO_ESTRANHA, "pedido_ajustes_desconto"), 0);
  assert.equal(await contar(SESSAO_ESTRANHA, "promocao_resgates"), 0);

  // E o cliente NAO le os resgates, nem os proprios: ali mora o hash do
  // documento, e devolve-lo ao navegador seria dar de volta um dado pessoal que
  // nao precisa sair do servidor.
  assert.equal(await contar(SESSAO_ANA, "promocao_resgates"), 0);

  // A ORDEM E PARTE DA RESPOSTA, e o UNIQUE (pedido_id, sequencia) e o que a
  // torna determinística: dois descontos com a mesma sequencia deixariam "por
  // que R$ 137,40" com duas contas diferentes, dependendo da varredura.
  await exigeRecusaDoBanco(
    `INSERT INTO canastra.pedido_ajustes_desconto
       (pedido_id, alvo, sequencia, valor_centavos, rotulo)
     VALUES ($1, 'frete', 1, 500, 'Frete gratis')`,
    [PED_ANA],
    "duas linhas com a mesma sequencia no mesmo pedido",
    UNICO_VIOLADO,
  );

  // `alvo = 'item'` sem dizer QUAL item e um desconto que a NF-e nao consegue
  // ratear — e o Bling exige o rateio por item.
  await exigeRecusaDoBanco(
    `INSERT INTO canastra.pedido_ajustes_desconto
       (pedido_id, alvo, sequencia, valor_centavos, rotulo)
     VALUES ($1, 'item', 9, 500, 'Item sem nome')`,
    [PED_ANA],
    "ajuste de item sem alvo_ref",
  );
  await exigeRecusaDoBanco(
    `INSERT INTO canastra.pedido_ajustes_desconto
       (pedido_id, alvo, alvo_ref, sequencia, valor_centavos, rotulo)
     VALUES ($1, 'pedido', 'CAN-CLA-250', 9, 500, 'Pedido com item')`,
    [PED_ANA],
    "ajuste de pedido com alvo_ref",
  );
  await exigeRecusaDoBanco(
    `INSERT INTO canastra.pedido_ajustes_desconto
       (pedido_id, alvo, sequencia, valor_centavos, rotulo)
     VALUES ($1, 'cliente', 9, 500, 'Alvo inventado')`,
    [PED_ANA],
    "alvo fora de (item, pedido, frete)",
  );
});

test("`meios_pagamento` fala o vocabulario da LOJA, nao o do Mercado Pago", async () => {
  // O desconto no PIX e o caso de uso, e ele quase nasceu errado: o que o
  // checkout GRAVA em `pedidos.metodo_pagamento` e o `payment_method_id` do
  // Mercado Pago, que e ABERTO — 'visa', 'master', 'elo', 'bolbradesco'... Uma
  // regra escrita contra 'visa' simplesmente nao se aplicaria a um cartao
  // Mastercard, em silencio, e o gestor levaria meses para notar.
  //
  // Entao a lista aqui e a da LOJA (pix, credito, debito, boleto) e a traducao a
  // partir do MP e trabalho do motor, na Onda 4 — num lugar so, testavel.
  await exigeRecusaDoBanco(
    `INSERT INTO canastra.promocoes (nome, metodo, classe, mecanica, valor, meios_pagamento)
     VALUES ('So na Visa', 'automatico', 'pedido', 'percentual', 5, ARRAY['visa'])`,
    [],
    "meio de pagamento 'visa'",
  );
  await exigeRecusaDoBanco(
    `INSERT INTO canastra.promocoes (nome, metodo, classe, mecanica, valor, meios_pagamento)
     VALUES ('Em nenhum meio', 'automatico', 'pedido', 'percentual', 5, ARRAY[]::text[])`,
    [],
    "lista de meios vazia",
  );

  const { rowCount } = await bd.pool.query(
    `INSERT INTO canastra.promocoes (nome, metodo, classe, mecanica, valor, meios_pagamento)
     VALUES ('No PIX e no boleto', 'automatico', 'pedido', 'percentual', 5,
             ARRAY['pix','boleto'])`,
  );
  assert.equal(rowCount, 1);
  await bd.pool.query("DELETE FROM canastra.promocoes WHERE nome = 'No PIX e no boleto'");
});

test("o escopo aceita a subtracao — `incluir = false` — e recusa alvo incoerente", async () => {
  // "10% na loja toda, MENOS o micro-lote". Hoje isso nao tem como ser dito: o
  // escopo legado sao tres colunas mutuamente exclusivas (`aplica_a`,
  // `categoria`, `produto_id`), com UM produto_id e sem FK.
  const { rows } = await bd.pool.query(
    `SELECT tipo, alvo, incluir FROM canastra.promocao_escopo
      WHERE promocao_id = $1 ORDER BY incluir DESC`,
    [P_VIGENTE],
  );
  assert.deepEqual(rows, [
    { tipo: "todos", alvo: null, incluir: true },
    { tipo: "sku", alvo: "CAN-MICRO-250", incluir: false },
  ]);

  // `todos` com alvo e uma contradicao: "todos os produtos, especificamente
  // este". O motor teria de escolher qual metade obedecer.
  await exigeRecusaDoBanco(
    `INSERT INTO canastra.promocao_escopo (promocao_id, tipo, alvo)
     VALUES ($1, 'todos', 'Cafe')`,
    [P_AGENDADA],
    "'todos' com alvo",
  );
  // E o inverso: `sku` sem dizer qual sku alcanca tudo em vez de nada, que e o
  // erro caro dos dois.
  await exigeRecusaDoBanco(
    "INSERT INTO canastra.promocao_escopo (promocao_id, tipo) VALUES ($1, 'sku')",
    [P_AGENDADA],
    "'sku' sem alvo",
  );
  await exigeRecusaDoBanco(
    "INSERT INTO canastra.promocao_escopo (promocao_id, tipo, alvo) VALUES ($1, 'sku', '  ')",
    [P_AGENDADA],
    "'sku' com alvo em branco",
  );
  await exigeRecusaDoBanco(
    `INSERT INTO canastra.promocao_escopo (promocao_id, tipo, alvo)
     VALUES ($1, 'marca', 'Canastra')`,
    [P_AGENDADA],
    "tipo de escopo fora da lista",
  );

  // O MESMO alvo duas vezes na MESMA promocao e o pior caso: uma linha dizendo
  // "inclua o micro-lote" e outra dizendo "exclua", e o resultado dependendo da
  // ordem de leitura. O indice unico ignora `incluir` de proposito — e assim que
  // a contradicao deixa de ser representavel.
  await exigeRecusaDoBanco(
    `INSERT INTO canastra.promocao_escopo (promocao_id, tipo, alvo, incluir)
     VALUES ($1, 'sku', 'CAN-MICRO-250', true)`,
    [P_VIGENTE],
    "o mesmo sku incluido e excluido na mesma promocao",
    UNICO_VIOLADO,
  );
});

test("a janela e o orcamento recusam o que nunca poderia valer", async () => {
  // `fim_em` antes de `inicio_em` e uma campanha que nao existe em instante
  // nenhum — salva com sucesso, invisivel para sempre. E a mesma familia da
  // armadilha legada, e por isso ela e barrada aqui e nao na tela.
  await exigeRecusaDoBanco(
    `INSERT INTO canastra.promocoes (nome, metodo, classe, mecanica, valor, inicio_em, fim_em)
     VALUES ('Janela ao contrario', 'automatico', 'produto', 'percentual', 10,
             now() + interval '10 days', now())`,
    [],
    "fim antes do inicio",
  );

  // Zero nao quer dizer "sem limite" nem "esgotado": quer dizer que alguem
  // confundiu os dois. E melhor descobrir no INSERT que no primeiro cliente
  // recusado — a licao de `cupons.limite_usos` em 0010.
  for (const coluna of [
    "limite_usos",
    "limite_por_cliente",
    "orcamento_centavos",
    "teto_desconto_centavos",
  ]) {
    await exigeRecusaDoBanco(
      `INSERT INTO canastra.promocoes (nome, metodo, classe, mecanica, valor, ${coluna})
       VALUES ('Zero em ${coluna}', 'automatico', 'produto', 'percentual', 10, 0)`,
      [],
      `${coluna} = 0`,
    );
  }

  // `grupo_exclusividade` sem `exclusiva` e um campo preenchido que nao faz
  // nada: o grupo so tem sentido para dizer com QUEM a regra nao se acumula.
  await exigeRecusaDoBanco(
    `INSERT INTO canastra.promocoes
       (nome, metodo, classe, mecanica, valor, exclusiva, grupo_exclusividade)
     VALUES ('Grupo sem exclusividade', 'automatico', 'produto', 'percentual', 10,
             false, 'pagamento')`,
    [],
    "grupo de exclusividade numa regra que acumula",
  );
});

test("as sete tabelas nascem com RLS ligada e com politica de TO explicito", async () => {
  // As duas invariantes que rls.test.js afirma para o schema INTEIRO, repetidas
  // aqui restritas as sete novas — porque quando elas falharem, o diagnostico
  // "0032 esqueceu o ENABLE" e mais curto que "alguma tabela de canastra".
  //
  // O `TO` explicito nao e enfeite: sem clausula TO a politica nasce
  // `TO public`, e `public` alcanca tambem o DONO das tabelas — de quem
  // `eh_admin()` depende para ler `canastra.admins` por baixo da RLS. Isso foi
  // descoberto em 0030, do jeito dificil.
  const NOVAS = [
    "promocoes",
    "promocao_codigos",
    "promocao_escopo",
    "promocao_faixas",
    "promocao_frete",
    "promocao_resgates",
    "pedido_ajustes_desconto",
  ];

  const { rows: semRls } = await bd.pool.query(
    `SELECT c.relname AS tabela
       FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'canastra' AND c.relname = ANY($1) AND NOT c.relrowsecurity
      ORDER BY c.relname`,
    [NOVAS],
  );
  assert.deepEqual(semRls.map((r) => r.tabela), []);

  const { rows: politicas } = await bd.pool.query(
    `SELECT tablename AS tabela, policyname AS politica, cmd AS comando,
            roles::text AS papeis, coalesce(qual, '') AS usando,
            coalesce(with_check, '') AS conferindo
       FROM pg_policies
      WHERE schemaname = 'canastra' AND tablename = ANY($1)
      ORDER BY tablename, policyname`,
    [NOVAS],
  );
  assert.ok(politicas.length > 0, "0032 deveria ter criado politicas");

  const semPapel = politicas.filter((p) => p.papeis === "{public}");
  assert.deepEqual(semPapel, [], "politica sem clausula TO alcanca o dono das tabelas");

  // Escrita nunca com `true`, e nunca sem nomear `eh_admin()`. E a rede que
  // rls.test.js estende ao schema todo; aqui ela e afirmada de perto.
  const frouxas = politicas
    .filter((p) => p.comando !== "SELECT")
    .filter((p) => !/eh_admin\(\)/.test(`${p.usando} ${p.conferindo}`))
    .map((p) => `${p.tabela}.${p.politica}`);
  assert.deepEqual(frouxas, [], "escrita de promocao so por canastra.eh_admin()");

  // E NENHUMA politica publica desta migracao e `USING (true)` — e por isso a
  // lista `PUBLICAS` de rls.test.js nao ganha nome nenhum das sete. A leitura
  // anonima e recortada no predicado (vigente, automatica, nao arquivada), onde
  // se le, em vez de numa lista que so diz "sim, publica".
  const comTrue = politicas
    .filter((p) => p.usando === "true" || p.conferindo === "true")
    .map((p) => `${p.tabela}.${p.politica}`);
  assert.deepEqual(comTrue, []);
});

test("o checkout de hoje continua de pe: `promocoes_legado` e `cupons` intactas", async () => {
  // A promessa desta onda, medida. 0032 renomeia a tabela legada e da o nome
  // `promocoes` ao motor novo — e o unico modulo da aplicacao que nomeava a
  // tabela (`src/repositories/promotionsRepository.js`) passou a dizer
  // `promocoes_legado` no MESMO commit. Se a renomeacao tivesse acontecido sem
  // ele, todo caminho de promocao do checkout responderia 42703.
  const { rows } = await bd.pool.query(`
    SELECT
      (SELECT array_agg(column_name::text)
         FROM information_schema.columns
        WHERE table_schema = 'canastra' AND table_name = 'promocoes_legado') AS legado,
      (SELECT count(*)::int FROM information_schema.tables
        WHERE table_schema = 'canastra' AND table_name = 'cupons') AS cupons
  `);

  // A ORDENACAO E FEITA NO JS, e nao num `ORDER BY column_name`, porque a ordem
  // de `_` contra letra depende do COLLATE do banco: em `C` o underscore vem
  // antes das minusculas ('aplica_a' < 'ativa'), num locale ICU ele e ignorado
  // ('ativa' < 'aplica_a'). O harness roda em `C` e o Supabase cloud nao — um
  // ORDER BY aqui faria o teste passar numa ponta e falhar na outra por um
  // motivo que nao tem nada a ver com o que ele mede.
  assert.deepEqual([...rows[0].legado].sort(), [
    "ativa",
    "aplica_a",
    "categoria",
    "criada_em",
    "descricao",
    "fim_em",
    "id",
    "inicio_em",
    "produto_id",
    "tipo",
    "titulo",
    "valor",
  ].sort());
  assert.equal(rows[0].cupons, 1);

  // E a leitura publica da tabela legada nao mudou de dono: ela continua sendo a
  // que a vitrine ATUAL le, com o mesmo `USING (true)` de 0006, ate a Onda 4.
  const legado = await comoPapel(bd.pool, SESSAO_ANON, async (cliente) => {
    const { rows: r } = await cliente.query(
      "SELECT count(*)::int AS n FROM canastra.promocoes_legado",
    );
    return r[0].n;
  });
  assert.equal(legado, 0, "a tabela legada continua legivel por anon, e esta vazia");
});
