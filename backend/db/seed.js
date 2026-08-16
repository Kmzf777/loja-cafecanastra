#!/usr/bin/env node
/**
 * Semeia o banco com o catalogo real do Cafe Canastra e com a conta de acesso.
 *
 * Fonte do catalogo: data/catalogo-canastra.json (na raiz do repositorio) — o
 * MESMO arquivo que a vitrine Next le. Nao ha uma segunda lista de produtos
 * mantida a mao aqui: se as duas divergissem, "o que aparece no site" e "o que
 * aparece no painel" divergiriam junto, que e exatamente o problema que este
 * trabalho veio resolver.
 *
 * Idempotente: roda quantas vezes quiser. Produtos sao casados por um UUID v5
 * derivado do `sku`, entao reexecutar ATUALIZA a linha existente em vez de
 * criar duplicata — e o `product_id` de um produto nunca muda entre execucoes,
 * o que mantem pedidos e itens de carrinho antigos apontando para o lugar certo.
 *
 *   node backend/db/seed.js
 */

require("dotenv").config({ path: require("node:path").join(__dirname, "..", "src", ".env") });

const { readFileSync } = require("node:fs");
const { join } = require("node:path");
const { v5: uuidv5 } = require("uuid");
const bcrypt = require("bcrypt");
const { Pool } = require("pg");

const RAIZ = join(__dirname, "..", "..");
const CATALOGO = JSON.parse(
  readFileSync(join(RAIZ, "data", "catalogo-canastra.json"), "utf8"),
);

// Namespace fixo e arbitrario. O que importa e que nao mude: e ele que garante
// que `sku` -> `product_id` seja estavel entre execucoes e entre maquinas.
const NS = "6f1c2f9e-1d3a-4f61-9c2b-4a7f5e0d8b31";
const SALT_ROUNDS = 10;

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

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
const LOJA_URL = (process.env.LOJA_URL || "http://localhost:3000").replace(/\/$/, "");
const urlDaImagem = (caminho) =>
  /^https?:\/\//.test(caminho) ? caminho : `${LOJA_URL}${caminho}`;

/** Categoria do painel — o eixo pelo qual o admin filtra a listagem. */
const CATEGORIAS = {
  graos: "Café em grãos",
  moido: "Café moído",
  drip: "Drip Coffee",
  capsula: "Cápsulas",
};

async function semearProdutos(client) {
  let inseridos = 0;
  let atualizados = 0;

  for (const produto of CATALOGO.produtos) {
    const linha = linhaDe(produto.linha);
    if (!linha) throw new Error(`SKU ${produto.sku} aponta para linha inexistente: ${produto.linha}`);

    const id = idDe(produto.sku);
    const categoria = produto.kit ? "Kits" : CATEGORIAS[produto.formato];

    // ON CONFLICT com o id deterministico: a segunda execucao cai no UPDATE.
    // `timestamp` e preservado no update para o filtro "novidades" do painel
    // nao considerar todo o catalogo recem-chegado a cada seed.
    const { rows } = await client.query(
      `INSERT INTO products
         (product_id, name, size, category, price, image, "timestamp", quantity,
          description, weight, width, height, length)
       VALUES ($1,$2,$3,$4,$5,$6,now(),$7,$8,$9,$10,$11,$12)
       ON CONFLICT (product_id) DO UPDATE SET
         name        = EXCLUDED.name,
         size        = EXCLUDED.size,
         category    = EXCLUDED.category,
         price       = EXCLUDED.price,
         image       = EXCLUDED.image,
         quantity    = EXCLUDED.quantity,
         description = EXCLUDED.description,
         weight      = EXCLUDED.weight
       RETURNING (xmax = 0) AS inserido`,
      [
        id,
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
      ],
    );
    // xmax = 0 na linha devolvida distingue INSERT de UPDATE dentro do upsert.
    if (rows[0]?.inserido) inseridos++;
    else atualizados++;
  }

  return { inseridos, atualizados, total: CATALOGO.produtos.length };
}

/** Alimenta os selects de filtro do painel com os valores que existem de fato. */
async function semearOpcoes(client) {
  const opcoes = [];
  for (const c of new Set(Object.values(CATEGORIAS).concat("Kits"))) {
    opcoes.push({ type: "category", value: c });
  }
  for (const p of CATALOGO.produtos) {
    opcoes.push({ type: "size", value: p.rotuloEmbalagem });
  }

  const vistos = new Set();
  for (const o of opcoes) {
    const chave = `${o.type}:${o.value}`;
    if (vistos.has(chave)) continue;
    vistos.add(chave);
    await client.query(
      `INSERT INTO product_options (id, type, value) VALUES ($1,$2,$3)
       ON CONFLICT (type, value) DO NOTHING`,
      [idDe(chave), o.type, o.value],
    );
  }
  return vistos.size;
}

async function semearConfig(client) {
  await client.query(
    `INSERT INTO store_config
       (id, banner_desktop, banner_mobile, site_title, whatsapp_number, announcement_bar)
     VALUES (1,$1,$2,$3,$4,$5)
     ON CONFLICT (id) DO UPDATE SET
       site_title       = EXCLUDED.site_title,
       banner_desktop   = EXCLUDED.banner_desktop,
       banner_mobile    = EXCLUDED.banner_mobile,
       announcement_bar = EXCLUDED.announcement_bar,
       updated_at       = now()`,
    [
      "/bannerdesktop.jpg",
      "/imagem-banner.jpg",
      "Café Canastra",
      process.env.LOJA_WHATSAPP || "",
      "Torramos na terça, enviamos na quarta.",
    ],
  );
}

/**
 * Conta de acesso, lida do .env — nunca com a senha escrita neste arquivo.
 * Ja nasce `is_verified = true`: o fluxo normal de cadastro exige confirmar o
 * email por link do Resend, e sem chave de email valida a conta ficaria travada
 * em "Sua conta ainda nao foi ativada" no primeiro login.
 */
async function semearConta(client) {
  const email = process.env.SEED_ADMIN_EMAIL;
  const senha = process.env.SEED_ADMIN_PASSWORD;
  if (!email || !senha) {
    console.log("  · SEED_ADMIN_EMAIL/PASSWORD ausentes no .env — conta não semeada.");
    return null;
  }

  const nome = process.env.SEED_ADMIN_NAME || "Conta de teste";
  const papel = process.env.SEED_ADMIN_ROLE || "admin";
  const hash = await bcrypt.hash(senha, SALT_ROUNDS);

  await client.query(
    `INSERT INTO users (user_id, name, phone, email, password, role, is_verified)
     VALUES ($1,$2,$3,$4,$5,$6,true)
     ON CONFLICT (email) DO UPDATE SET
       password    = EXCLUDED.password,
       role        = EXCLUDED.role,
       is_verified = true,
       name        = EXCLUDED.name`,
    [idDe(`user:${email}`), nome, process.env.SEED_ADMIN_PHONE || null, email, hash, papel],
  );

  return { email, papel };
}

async function main() {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const produtos = await semearProdutos(client);
    const opcoes = await semearOpcoes(client);
    await semearConfig(client);
    const conta = await semearConta(client);

    await client.query("COMMIT");

    console.log("Seed concluído.");
    console.log(`  · produtos: ${produtos.total} SKUs no catálogo`);
    console.log(`  · opções de filtro: ${opcoes}`);
    console.log(`  · config da loja: 1 linha`);
    if (conta) console.log(`  · conta: ${conta.email} (${conta.papel})`);
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("Seed falhou, nada foi gravado:", err.message);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
}

main();
