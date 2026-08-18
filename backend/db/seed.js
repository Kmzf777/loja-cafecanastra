#!/usr/bin/env node
"use strict";

/**
 * Semeia o banco com o catalogo real do Cafe Canastra e cria a conta inicial.
 *
 * Fonte do catalogo: data/catalogo-canastra.json (na raiz do repositorio) — o
 * MESMO arquivo que a vitrine Next le. Nao ha uma segunda lista de produtos
 * mantida a mao aqui: se as duas divergissem, "o que aparece no site" e "o que
 * aparece no painel" divergiriam junto, que e exatamente o problema que este
 * trabalho veio resolver.
 *
 * IDEMPOTENTE, E O SENTIDO DISSO MUDOU. Produtos continuam casados por um UUID
 * v5 derivado do `sku` — o `produto_id` de um produto nunca muda entre execucoes,
 * o que mantem pedidos e itens de sacola antigos apontando para o lugar certo.
 * O que mudou e o que a reexecucao FAZ: nada. Ver o bloco de `semearProdutos`.
 *
 * A CONTA INICIAL NAO NASCE MAIS AQUI. Quem guarda hash de senha agora e o
 * `auth.users` do GoTrue, e `service_role` NAO consegue escrever naquele schema
 * (medido: 42501; ele tem apenas USAGE em `auth`, espelhando a producao, onde
 * `auth` pertence ao GoTrue). Criar usuario passa obrigatoriamente pela Admin API
 * do GoTrue; ao banco cabe so o vinculo com a loja (`clientes` + `admins`).
 *
 *   node backend/db/seed.js
 */

const { readFileSync } = require("node:fs");
const { join } = require("node:path");
const { v5: uuidv5 } = require("uuid");

const RAIZ = join(__dirname, "..", "..");
const CATALOGO = JSON.parse(
  readFileSync(join(RAIZ, "data", "catalogo-canastra.json"), "utf8"),
);

// Namespace fixo e arbitrario. O que importa e que nao mude: e ele que garante
// que `sku` -> `produto_id` seja estavel entre execucoes e entre maquinas.
const NS = "6f1c2f9e-1d3a-4f61-9c2b-4a7f5e0d8b31";

const idDe = (sku) => uuidv5(sku, NS);
const linhaDe = (slug) => CATALOGO.linhas.find((l) => l.slug === slug);

/**
 * Descricao de vitrine do SKU. Monta a partir da linha (torra, corpo, notas) e
 * do formato, para o painel nao mostrar produto com descricao vazia.
 */
function descricaoDe(produto) {
  const linha = linhaDe(produto.linha);
  const partes = [linha.descricao];

  if (produto.formato === "graos") {
    partes.push("Em grãos, para moer na hora.");
  } else if (produto.formato === "moido") {
    partes.push("Moído no pedido, na moagem que você escolher.");
  } else if (produto.formato === "drip") {
    partes.push("Sachê individual de drip coffee: filtro e café numa coisa só.");
  } else if (produto.formato === "capsula") {
    partes.push("Cápsula compatível com o sistema Nespresso.");
  }

  partes.push(`${linha.torra}. ${linha.corpo}.`);
  partes.push(
    `${CATALOGO.marca.atributos.join(" · ")}. Selo ${CATALOGO.marca.selo}.`,
  );

  return partes.join(" ");
}

/** Peso real do pacote em kg, para o calculo de frete do checkout. */
function pesoKg(produto) {
  if (produto.gramas > 0) return (produto.gramas * produto.pacotes) / 1000;
  // Drip e capsula: ~11 g por unidade com embalagem, arredondado para cima.
  return Math.max(0.05, (produto.unidades || 10) * 0.011);
}

/**
 * URL absoluta da imagem do produto.
 *
 * O painel monta o `src` com `imagePath.startsWith("http") ? imagePath :
 * API_BASE + imagePath` (AddedShirts.jsx). Ou seja: caminho relativo e
 * resolvido contra o BACKEND, que so serve /uploads — e as artes das
 * embalagens vivem em frontend/public, servidas pelo Next. Gravar
 * "/cafe-classico.png" fazia o painel pedir
 * http://localhost:3333/cafe-classico.png e mostrar imagem quebrada.
 *
 * Gravar a URL absoluta da vitrine resolve sem tocar no codigo legado.
 * A vitrine nao usa esta coluna — ela le o caminho relativo do JSON, que e o
 * que o next/image precisa.
 */
const urlDaImagem = (caminho) => {
  const loja = (process.env.LOJA_URL || "http://localhost:3000").replace(/\/$/, "");
  return /^https?:\/\//.test(caminho) ? caminho : `${loja}${caminho}`;
};

/** Categoria do painel — o eixo pelo qual o admin filtra a listagem. */
const CATEGORIAS = {
  graos: "Café em grãos",
  moido: "Café moído",
  drip: "Drip Coffee",
  capsula: "Cápsulas",
};

/**
 * As colunas de `canastra.produtos` que o seed preenche, na ordem em que
 * `linhasDeProdutos()` devolve os valores.
 *
 * `destacado_em` NAO esta aqui de proposito: ela e `now()` no INSERT, e nao um
 * parametro. Ter a lista numa constante e o que impede a alternativa obvia e
 * ruim — repetir a ordem das colunas em dois lugares (aqui e no gerador do SQL
 * de instalacao). Duas listas em ordens diferentes nao dao erro: dao `nome` no
 * lugar de `tamanho` no banco inteiro.
 */
const COLUNAS_DE_PRODUTO = Object.freeze([
  "produto_id",
  "sku",
  "nome",
  "tamanho",
  "categoria",
  "preco",
  "imagem",
  "quantidade",
  "descricao",
  "peso",
  "largura",
  "altura",
  "comprimento",
]);

const SQL_INSERIR_PRODUTO = `
  INSERT INTO canastra.produtos
    (${COLUNAS_DE_PRODUTO.join(", ")}, destacado_em)
  VALUES (${COLUNAS_DE_PRODUTO.map((_, i) => `$${i + 1}`).join(", ")}, now())
  ON CONFLICT (sku) WHERE sku IS NOT NULL DO NOTHING`;

/**
 * O catalogo inteiro como linhas prontas para o INSERT, sem tocar no banco.
 *
 * POR QUE ISTO E UMA FUNCAO EXPORTADA, E NAO CODIGO SOLTO DENTRO DO LACO
 * `db/gerar-instalacao.js` monta o `instalacao-completa.sql` (o arquivo que se
 * cola no editor SQL do Supabase) a partir DESTA funcao. A alternativa era
 * escrever os 29 INSERTs a mao naquele arquivo — e ai existiriam duas listas do
 * mesmo catalogo, mantidas por pessoas diferentes em dias diferentes. A
 * divergencia entre elas nao levanta erro nenhum: leva a uma loja instalada pelo
 * SQL com preco, descricao ou peso diferentes da instalada pelo seed, e isso so
 * aparece quando alguem compara os dois bancos.
 *
 * PURA DE PROPOSITO (nenhum `await`, nenhum pool): e o que permite ao gerador
 * chamar a mesma logica sem um Postgres de pe, e ao teste comparar os dois
 * caminhos linha a linha.
 *
 * A validacao da linha (`linhaDe`) subiu para ca junto. O efeito observavel e o
 * mesmo de antes — o erro continua abortando a semeadura inteira —, so que agora
 * ele acontece ANTES do BEGIN em vez de dentro da transacao, o que e estritamente
 * melhor: nao ha transacao aberta para desfazer.
 */
function linhasDeProdutos() {
  return CATALOGO.produtos.map((produto) => {
    const linha = linhaDe(produto.linha);
    if (!linha) {
      throw new Error(
        `SKU ${produto.sku} aponta para linha inexistente: ${produto.linha}`,
      );
    }

    const categoria = produto.kit ? "Kits" : CATEGORIAS[produto.formato];

    return [
      idDe(produto.sku),
      produto.sku,
      produto.nome,
      produto.rotuloEmbalagem,
      categoria,
      (produto.precoCentavos / 100).toFixed(2),
      urlDaImagem(linha.imagem),
      produto.estoque,
      descricaoDe(produto),
      pesoKg(produto).toFixed(3),
      produto.gramas >= 1000 ? 24 : 18,
      produto.gramas >= 1000 ? 10 : 7,
      produto.gramas >= 1000 ? 32 : 24,
    ];
  });
}

/**
 * Os valores de filtro do painel, sem tocar no banco. Mesmo motivo de
 * `linhasDeProdutos()`: o gerador do SQL de instalacao le daqui.
 */
function linhasDeOpcoes() {
  const opcoes = [];
  for (const c of new Set(Object.values(CATEGORIAS).concat("Kits"))) {
    opcoes.push({ tipo: "categoria", valor: c });
  }
  for (const p of CATALOGO.produtos) {
    opcoes.push({ tipo: "tamanho", valor: p.rotuloEmbalagem });
  }

  const vistos = new Set();
  const linhas = [];
  for (const o of opcoes) {
    const chave = `${o.tipo}:${o.valor}`;
    if (vistos.has(chave)) continue;
    vistos.add(chave);
    linhas.push({ id: idDe(chave), tipo: o.tipo, valor: o.valor });
  }
  return linhas;
}

/**
 * A linha unica de `config_loja`, sem tocar no banco. Mesmo motivo de
 * `linhasDeProdutos()`.
 */
function valoresDeConfig() {
  return [
    // Absolutas pelo mesmo motivo da imagem de produto: o painel resolve
    // caminho relativo contra o backend, que nao serve estes arquivos.
    urlDaImagem("/bannerdesktop.jpg"),
    urlDaImagem("/imagem-banner.jpg"),
    "Café Canastra",
    process.env.LOJA_WHATSAPP || "",
    "Torramos na terça, enviamos na quarta.",
  ];
}

/**
 * O catalogo, em `canastra.produtos`.
 *
 * `DO NOTHING`, E NAO `DO UPDATE` — ESTA E A DECISAO DO ARQUIVO.
 *
 * A versao anterior fazia upsert: cada execucao reescrevia nome, preco, imagem,
 * estoque e descricao com o que estivesse no JSON versionado. O seed roda a cada
 * deploy. O efeito, portanto, era REVERTER a cada deploy o preco e o estoque que
 * o administrador tinha acabado de corrigir no painel — sem erro, sem log, e
 * descoberto so quando um cliente pagasse o valor velho ou comprasse cafe
 * esgotado.
 *
 * A divisao que fica valendo: a metade EDITORIAL do catalogo (nome, descricao,
 * imagem, dimensoes) vive em `data/catalogo-canastra.json`, versionada e revisada
 * em PR; a metade COMERCIAL (preco, estoque) passa a pertencer ao PAINEL a partir
 * da primeira semeadura. O seed so INTRODUZ produto, nunca opina sobre um que ja
 * esta la. Mudanca editorial num SKU ja semeado e, hoje, trabalho do painel ou de
 * uma migracao — deliberadamente, porque nao ha como um upsert distinguir "o
 * texto mudou no PR" de "o admin ajustou no painel".
 *
 * O ALVO DO CONFLITO E O `sku`, E O `WHERE` NAO E OPCIONAL: `produtos_sku_idx` e
 * um indice PARCIAL (`WHERE sku IS NOT NULL`, para o produto cadastrado a mao no
 * painel poder ficar sem SKU). O Postgres so casa uma clausula ON CONFLICT com um
 * indice parcial se a mesma predicado aparecer ali; sem ele, 42P10
 * ("there is no unique or exclusion constraint matching the ON CONFLICT
 * specification"), e o seed inteiro quebra na primeira linha.
 *
 * LIMITE CONHECIDO: o conflito e casado por `sku`, mas o `produto_id` vem do
 * UUID v5 do mesmo `sku`. Se alguem editar o SKU de uma linha semeada pelo
 * painel, a proxima semeadura nao vera conflito de SKU e tentara inserir com um
 * `produto_id` que ja existe — 23505 na chave primaria. E ruido barulhento, nao
 * corrupcao, e o conserto e devolver o SKU ou apagar a linha.
 */
async function semearProdutos(pool) {
  const linhas = linhasDeProdutos();
  const cliente = await pool.connect();
  let inseridos = 0;

  try {
    await cliente.query("BEGIN");

    for (const valores of linhas) {
      const { rowCount } = await cliente.query(SQL_INSERIR_PRODUTO, valores);
      // Com DO NOTHING o Postgres nao devolve linha nenhuma no conflito, entao
      // `rowCount` sozinho ja distingue "entrou agora" de "ja estava la" — o
      // truque do `xmax = 0`, que a versao com DO UPDATE precisava, some junto.
      if (rowCount > 0) inseridos++;
    }

    await cliente.query("COMMIT");
  } catch (erro) {
    await cliente.query("ROLLBACK").catch(() => {});
    throw erro;
  } finally {
    cliente.release();
  }

  const total = linhas.length;
  return { inseridos, ignorados: total - inseridos, total };
}

/** Alimenta os selects de filtro do painel com os valores que existem de fato. */
async function semearOpcoes(pool) {
  const linhas = linhasDeOpcoes();
  for (const o of linhas) {
    await pool.query(
      `INSERT INTO canastra.produto_opcoes (id, tipo, valor) VALUES ($1,$2,$3)
       ON CONFLICT (tipo, valor) DO NOTHING`,
      [o.id, o.tipo, o.valor],
    );
  }
  return linhas.length;
}

/**
 * A linha unica de `config_loja`.
 *
 * `DO NOTHING` PELO MESMO MOTIVO DO PRECO, e isto e uma correcao e nao um
 * transporte: a versao anterior fazia `DO UPDATE` em titulo, banners e barra de
 * aviso. Todas as quatro sao editaveis no painel, entao o `DO UPDATE` revertia,
 * a cada deploy, a campanha que o administrador tinha acabado de publicar —
 * "Torramos na terça, enviamos na quarta" voltando por cima do aviso de Natal.
 * O seed poe os valores iniciais de uma loja nova e para por ai.
 */
async function semearConfig(pool) {
  const { rowCount } = await pool.query(
    `INSERT INTO canastra.config_loja
       (id, banner_desktop, banner_mobile, titulo_site, whatsapp, barra_de_aviso)
     VALUES (1,$1,$2,$3,$4,$5)
     ON CONFLICT (id) DO NOTHING`,
    valoresDeConfig(),
  );
  return rowCount > 0;
}

/** Cabecalhos da Admin API: o Kong exige `apikey`, o GoTrue exige o Bearer. */
const cabecalhoDe = (chave) => ({
  "Content-Type": "application/json",
  apikey: chave,
  Authorization: `Bearer ${chave}`,
});

/**
 * Acha o `id` de um e-mail que ja existe no GoTrue.
 *
 * `filter` e um LIKE do lado do servidor e reduz a varredura quando a versao do
 * GoTrue o suporta; quando NAO suporta, o parametro e simplesmente ignorado e
 * sobra a paginacao — que continua achando a conta, so que devagar. Por isso os
 * dois caminhos: a instancia e COMPARTILHADA com outros projetos, entao a lista
 * de `auth.users` tem gente que nao e desta loja e pode ser longa.
 *
 * A comparacao final e por igualdade exata (sem diferenciar maiuscula), e nao
 * "pega o primeiro da lista": um `filter` de LIKE casa `ana@x.com` quando se
 * procurava `joana@x.com`, e vincular a conta ERRADA como administradora da loja
 * e o pior desfecho possivel deste arquivo.
 */
async function localizarUsuario({ base, chave, email, buscar }) {
  const POR_PAGINA = 200;
  const TETO_DE_PAGINAS = 25;
  const alvo = email.trim().toLowerCase();

  for (let pagina = 1; pagina <= TETO_DE_PAGINAS; pagina++) {
    const url =
      `${base}/auth/v1/admin/users` +
      `?page=${pagina}&per_page=${POR_PAGINA}&filter=${encodeURIComponent(email)}`;
    const resposta = await buscar(url, { headers: cabecalhoDe(chave) });
    if (!resposta.ok) {
      throw new Error(
        `Não consegui consultar o GoTrue para localizar ${email}: ${resposta.status}.`,
      );
    }

    const { users } = await resposta.json();
    const lista = Array.isArray(users) ? users : [];
    const achado = lista.find((u) => (u.email || "").trim().toLowerCase() === alvo);
    if (achado) return achado.id;
    if (lista.length < POR_PAGINA) break;
  }

  return null;
}

/**
 * A conta inicial, criada no GoTrue e ligada a loja.
 *
 * `email_confirm: true` porque o fluxo normal exige confirmar por link, e numa
 * instalacao nova o envio de e-mail e justamente o que ainda nao esta de pe: a
 * conta nasceria travada em "confirme seu e-mail", sem ninguem para destravar.
 *
 * NUNCA SOBRESCREVE A SENHA DE QUEM JA EXISTE, e este e o ponto da funcao. O
 * seed e idempotente por desenho e vai ser rodado de novo em producao — depois de
 * o administrador ter trocado a senha, e com o deploy ainda carregando
 * SEED_ADMIN_PASSWORD do ambiente. Reenviar a senha REBAIXARIA a credencial real
 * de volta para a do arquivo de deploy, calado. A versao anterior tinha
 * exatamente esse defeito num `ON CONFLICT (email) DO UPDATE SET password`; aqui
 * o 422 do GoTrue leva a uma BUSCA (GET) e a mais nada. Se a conta precisar ser
 * recuperada, isso e operacao deliberada, nao efeito colateral de um seed.
 *
 * `buscar` e `ambiente` sao injetaveis para o teste poder afirmar essa ausencia
 * sem subir um GoTrue: teste que faz requisicao de verdade nao distingue "a
 * logica esta errada" de "o VPS caiu".
 */
async function semearAdmin(pool, { ambiente = process.env, buscar = globalThis.fetch } = {}) {
  const email = ambiente.SEED_ADMIN_EMAIL;
  const senha = ambiente.SEED_ADMIN_PASSWORD;
  const nome = ambiente.SEED_ADMIN_NAME || "Administração";

  if (!email || !senha) return { criado: false };

  const base = (ambiente.SUPABASE_URL || "").replace(/\/$/, "");
  const chave = ambiente.SUPABASE_SERVICE_ROLE_KEY;
  if (!base || !chave) {
    // Falhar alto, e nao pular em silencio: a conta foi PEDIDA. Um seed que
    // registrasse sucesso aqui deixaria a loja em producao sem ninguem que
    // consiga entrar no painel, e o sintoma apareceria dias depois.
    throw new Error(
      "SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY são necessárias para criar a conta " +
        "inicial no GoTrue. (service_role não escreve em auth.users: aquele schema " +
        "pertence ao GoTrue.)",
    );
  }

  let userId;
  let jaExistia = false;

  const criacao = await buscar(`${base}/auth/v1/admin/users`, {
    method: "POST",
    headers: cabecalhoDe(chave),
    body: JSON.stringify({ email, password: senha, email_confirm: true }),
  });

  if (criacao.ok) {
    userId = (await criacao.json()).id;
  } else if (criacao.status === 422) {
    // 422 e como a Admin API diz "este e-mail ja tem conta". E o caminho NORMAL
    // da segunda execucao em diante, nao um erro.
    jaExistia = true;
    userId = await localizarUsuario({ base, chave, email, buscar });
    if (!userId) {
      throw new Error(
        `O GoTrue recusou criar ${email} por já existir, mas não devolveu o id ` +
          "dessa conta. Sem o id não há como ligá-la à loja.",
      );
    }
  } else {
    throw new Error(
      `O GoTrue recusou criar a conta inicial: ${criacao.status} ${await criacao.text()}`,
    );
  }

  // `admins` referencia `clientes`, e nao `auth.users`: administrador da loja e,
  // antes disso, cliente da loja (0002). A ordem aqui nao e estilo — inverter
  // levanta 23503 na chave estrangeira.
  await pool.query(
    `INSERT INTO canastra.clientes (user_id, nome) VALUES ($1,$2)
     ON CONFLICT (user_id) DO NOTHING`,
    [userId, nome],
  );
  await pool.query(
    `INSERT INTO canastra.admins (user_id) VALUES ($1)
     ON CONFLICT (user_id) DO NOTHING`,
    [userId],
  );

  return { criado: true, jaExistia, userId, email };
}

async function main() {
  require("dotenv").config({ path: join(__dirname, "..", "src", ".env") });

  const { Pool } = require("pg");

  // Mesmo motivo documentado em db/migrar.js: `new Pool({ connectionString:
  // undefined })` NAO falha, cai no padrao do libpq e semeia qualquer banco
  // alcancavel — em silencio e com a saida de sucesso de sempre.
  if (!process.env.DATABASE_URL) {
    console.error(
      "\n❌ DATABASE_URL não está definida.\n" +
        "   Sem ela a conexão cairia no padrão do libpq e o catálogo poderia ser\n" +
        "   gravado num banco que não é o pretendido.\n",
    );
    process.exit(1);
  }

  const pool = new Pool({ connectionString: process.env.DATABASE_URL });

  try {
    const produtos = await semearProdutos(pool);
    const opcoes = await semearOpcoes(pool);
    const config = await semearConfig(pool);
    const conta = await semearAdmin(pool);

    console.log("Seed concluído.");
    console.log(
      `  · produtos: ${produtos.inseridos} novo(s), ${produtos.ignorados} já existia(m) ` +
        `— ${produtos.total} SKUs no catálogo`,
    );
    console.log(`  · opções de filtro: ${opcoes}`);
    console.log(`  · config da loja: ${config ? "criada" : "já existia, preservada"}`);
    if (!conta.criado) {
      console.log("  · SEED_ADMIN_EMAIL/PASSWORD ausentes — conta inicial não criada.");
    } else if (conta.jaExistia) {
      console.log(`  · conta ${conta.email} já existia no GoTrue — senha preservada.`);
    } else {
      console.log(`  · conta criada no GoTrue e ligada à loja: ${conta.email}`);
    }
  } catch (erro) {
    console.error(`\n❌ Seed falhou: ${erro.message}\n`);
    process.exitCode = 1;
  } finally {
    await pool.end().catch(() => {});
  }
}

module.exports = {
  semearProdutos,
  semearOpcoes,
  semearConfig,
  semearAdmin,
  // Os tres abaixo sao a materia-prima do `db/gerar-instalacao.js`. Exportados
  // para que exista UMA lista de produtos no projeto, e nao duas.
  COLUNAS_DE_PRODUTO,
  linhasDeProdutos,
  linhasDeOpcoes,
  valoresDeConfig,
};

if (require.main === module) main();
