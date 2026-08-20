const { Router } = require("express");
const rateLimit = require("express-rate-limit");
const pool = require("../pgPool");
const isAuthenticated = require("../middleware/isAuthenticated");
const isAdmin = require("../middleware/isAdmin");

/**
 * O que sobrou da conta no Express: SO o que o GoTrue nao faz.
 *
 * Cadastro, login, logout, confirmacao de e-mail, recuperacao e troca de senha
 * sairam daqui inteiros — o navegador fala com o GoTrue direto, pelo
 * `supabase-js` (ver `frontend/lib/conta/sessao.ts`). Sobrou UM caso: excluir a
 * propria conta. Ele precisa apagar a linha em `auth.users`, e aquele schema
 * pertence ao GoTrue: nem o `service_role` escreve nele (medido no seed, 42501).
 * O unico caminho e a Admin API do GoTrue com a `service_role key` — que so
 * existe deste lado da fronteira, e e justamente por isso que o endpoint
 * continua existindo.
 *
 * POR QUE O CAMINHO CONTINUA SENDO `/auth/users/me`: o painel legado chama esta
 * URL (`frontend/legacy/components/HeaderSection/header/Header.jsx`) e ele so
 * morre na F6. Renomear agora quebraria uma tela viva sem ganhar nada — o nome
 * do arquivo ja diz o que este modulo e.
 */
const contaRoutes = Router();

/**
 * Excluir conta e irreversivel e chama a Admin API do GoTrue. Sem teto, um
 * script com um token valido em maos vira uma enxurrada de chamadas
 * autenticadas contra o GoTrue da instancia inteira — que e compartilhada com
 * outros projetos.
 */
const exclusaoLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 5,
  message: { message: "Muitas tentativas. Tente novamente em uma hora." },
});

/**
 * Limite proprio para a exclusao administrativa: o teto de 5/hora do cliente
 * comum e apertado demais para um admin limpando cadastros (e o balde e por
 * IP — as exclusoes do admin esgotariam o proprio direito de apagar a conta).
 * Continua havendo teto porque cada chamada bate na Admin API do GoTrue da
 * instancia compartilhada.
 */
const exclusaoPeloAdminLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 30,
  message: { message: "Muitas exclusões seguidas. Aguarde um pouco." },
});

/** Cabecalhos da Admin API: o Kong exige `apikey`, o GoTrue exige o Bearer. */
const cabecalhoDe = (chave) => ({
  "Content-Type": "application/json",
  apikey: chave,
  Authorization: `Bearer ${chave}`,
});

const MENSAGEM_ULTIMO_ADMIN =
  "Você é a única pessoa que administra a loja. Cadastre outro administrador " +
  "antes de excluir sua conta.";

/**
 * Exclui a conta de QUEM ESTA CHAMANDO, e de mais ninguem.
 *
 * O `user_id` vem de `req.user`, preenchido por `isAuthenticated` a partir do
 * `sub` do token verificado. Nao ha parametro de rota nem campo de corpo com
 * id: se houvesse, um cliente apagaria a conta de outro, e a rota administrativa
 * de apagar terceiros morreu junto com o `loginRepository`.
 *
 * A ORDEM IMPORTA. A trava do ultimo administrador e conferida ANTES da chamada
 * ao GoTrue porque a que vale de verdade e a do banco (trigger
 * `admins_nunca_zero`, 0002), e ela dispara tarde: `auth.users` -> `clientes`
 * -> `admins` e tudo ON DELETE CASCADE, entao a recusa apareceria DENTRO da
 * transacao do GoTrue e voltaria como um 500 opaco. Conferir antes e o que
 * transforma isso na frase que a pessoa le na tela. A trigger continua sendo a
 * garantia — esta checagem e a explicacao.
 *
 * `buscar` e injetavel para o teste poder exercer a recusa sem um GoTrue de pe.
 */
async function excluirMinhaConta(
  req,
  res,
  { conexao = pool, buscar = globalThis.fetch, ambiente = process.env } = {},
) {
  const { userId } = req.user;

  try {
    const { rows } = await conexao.query(
      `SELECT
         EXISTS (SELECT 1 FROM canastra.admins WHERE user_id = $1) AS sou_admin,
         (SELECT count(*) FROM canastra.admins) AS total`,
      [userId],
    );

    if (rows[0].sou_admin && Number(rows[0].total) <= 1) {
      // 409: o pedido esta correto, o estado da loja e que nao permite.
      return res.status(409).json({ message: MENSAGEM_ULTIMO_ADMIN });
    }

    const base = (ambiente.SUPABASE_URL || "").replace(/\/$/, "");
    const chave = ambiente.SUPABASE_SERVICE_ROLE_KEY;
    if (!base || !chave) {
      // Falhar alto e nao fingir: sem estas duas nao ha como apagar a conta no
      // GoTrue, e responder sucesso deixaria a pessoa achando que os dados dela
      // sairam quando nao sairam.
      console.error(
        "SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY ausentes: exclusão de conta impossível.",
      );
      return res.status(503).json({
        message: "Não consigo excluir contas agora. Tente novamente mais tarde.",
      });
    }

    const resposta = await buscar(`${base}/auth/v1/admin/users/${userId}`, {
      method: "DELETE",
      headers: cabecalhoDe(chave),
    });

    // 404 = a conta ja nao existe no GoTrue. O efeito pedido ja aconteceu, e a
    // cascata de `auth.users` ja levou `clientes` e `admins` junto.
    if (resposta.ok || resposta.status === 404) {
      return res.status(200).json({ message: "Sua conta foi excluída com sucesso." });
    }

    const corpo = await resposta.text().catch(() => "");

    // A corrida existe: outro administrador pode ter sido removido entre a
    // contagem acima e esta chamada. Quem barra ai e a trigger, e o que chega
    // aqui e o texto dela. Traduzir de volta para a mesma frase evita que a
    // pessoa veja "erro interno" quando o motivo tem nome.
    if (/administrador/i.test(corpo) || /23001/.test(corpo)) {
      return res.status(409).json({ message: MENSAGEM_ULTIMO_ADMIN });
    }

    console.error(`GoTrue recusou excluir ${userId}: ${resposta.status} ${corpo}`);
    return res.status(502).json({ message: "Não foi possível excluir sua conta agora." });
  } catch (erro) {
    console.error("Erro ao excluir conta:", erro);
    return res.status(500).json({ message: "Erro ao excluir conta." });
  }
}

/**
 * A lista de clientes do painel (RegisteredClients.jsx): nome e telefone da
 * loja (`canastra.clientes`), e-mail do GoTrue (`auth.users` — o pool conecta
 * como dono do banco e le `auth` normalmente) e a contagem de compras de
 * `canastra.pedidos`. O formato `{users, total, totalPages, page}` e o que o
 * componente ja consome; `id` E `user_id` saem iguais porque o JSX usa os
 * dois (key da tabela vs. handler de exclusao).
 *
 * SO CLIENTES DESTA LOJA: a consulta parte de `canastra.clientes`, nunca de
 * `auth.users` — a instancia e compartilhada, e listar `auth.users` inteiro
 * exporia as contas dos OUTROS projetos ao painel desta loja.
 */
async function listarClientes(req, res, { conexao = pool } = {}) {
  const page = Math.max(1, Number.parseInt(req.query.page, 10) || 1);
  const limitBruto = Number.parseInt(req.query.limit, 10) || 10;
  const limit = Math.min(100, Math.max(1, limitBruto));
  const offset = (page - 1) * limit;

  try {
    const total = Number(
      (await conexao.query("SELECT count(*) FROM canastra.clientes")).rows[0]
        .count,
    );
    const totalPages = Math.ceil(total / limit);

    const { rows } = await conexao.query(
      `SELECT
         c.user_id,
         c.user_id            AS id,
         c.nome               AS name,
         u.email,
         c.telefone           AS phone,
         (SELECT count(*)::int FROM canastra.pedidos p
           WHERE p.user_id = c.user_id) AS purchases
       FROM canastra.clientes c
       LEFT JOIN auth.users u ON u.id = c.user_id
       ORDER BY c.criado_em DESC
       LIMIT $1 OFFSET $2`,
      [limit, offset],
    );

    return res.json({ users: rows, total, totalPages, page });
  } catch (erro) {
    console.error("Erro ao listar clientes:", erro);
    return res.status(500).json({ message: "Erro ao listar clientes." });
  }
}

const FORMATO_UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Exclusao de um cliente PELO ADMIN — a rota que a F2 apagou junto com o
 * loginRepository e que o painel (RegisteredClients.jsx) continua chamando.
 *
 * As garantias sao as mesmas de `excluirMinhaConta`, mais uma que so existe
 * aqui: o alvo TEM de ser cliente DESTA loja. A Admin API do GoTrue apaga
 * qualquer conta da instancia compartilhada — sem esta cerca, o painel desta
 * loja viraria um botao de apagar usuarios dos OUTROS projetos da VPS.
 *
 * A trava do ultimo administrador vale para o alvo, nao para quem chama: e a
 * mesma corrida de `excluirMinhaConta`, conferida antes por educacao e
 * garantida pela trigger `admins_nunca_zero` (0002) na cascata do DELETE.
 */
async function excluirClientePeloAdmin(
  req,
  res,
  { conexao = pool, buscar = globalThis.fetch, ambiente = process.env } = {},
) {
  const { id } = req.params;
  if (!FORMATO_UUID.test(String(id || ""))) {
    return res.status(400).json({ message: "Identificador de cliente inválido." });
  }

  try {
    const { rows } = await conexao.query(
      `SELECT
         EXISTS (SELECT 1 FROM canastra.clientes WHERE user_id = $1) AS eh_cliente,
         EXISTS (SELECT 1 FROM canastra.admins   WHERE user_id = $1) AS eh_admin,
         (SELECT count(*) FROM canastra.admins) AS total_admins`,
      [id],
    );

    if (!rows[0].eh_cliente) {
      // Ou nunca foi cliente, ou e usuario de OUTRO projeto da instancia —
      // nos dois casos a resposta e a mesma e a conta nao e tocada.
      return res.status(404).json({ message: "Cliente não encontrado nesta loja." });
    }

    if (rows[0].eh_admin && Number(rows[0].total_admins) <= 1) {
      return res.status(409).json({ message: MENSAGEM_ULTIMO_ADMIN });
    }

    const base = (ambiente.SUPABASE_URL || "").replace(/\/$/, "");
    const chave = ambiente.SUPABASE_SERVICE_ROLE_KEY;
    if (!base || !chave) {
      // Mesma postura de `excluirMinhaConta`: sem as duas, nao ha como apagar
      // no GoTrue, e responder sucesso fingiria uma exclusao que nao houve.
      console.error(
        "SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY ausentes: exclusão de cliente impossível.",
      );
      return res.status(503).json({
        message: "Não consigo excluir contas agora. Tente novamente mais tarde.",
      });
    }

    const resposta = await buscar(`${base}/auth/v1/admin/users/${id}`, {
      method: "DELETE",
      headers: cabecalhoDe(chave),
    });

    // 404 = a conta ja nao existe no GoTrue; a cascata ja levou clientes e
    // admins junto. O efeito pedido ja aconteceu.
    if (resposta.ok || resposta.status === 404) {
      return res.status(200).json({ message: "Cliente excluído com sucesso." });
    }

    const corpo = await resposta.text().catch(() => "");
    if (/administrador/i.test(corpo) || /23001/.test(corpo)) {
      return res.status(409).json({ message: MENSAGEM_ULTIMO_ADMIN });
    }

    console.error(`GoTrue recusou excluir ${id}: ${resposta.status} ${corpo}`);
    return res
      .status(502)
      .json({ message: "Não foi possível excluir o cliente agora." });
  } catch (erro) {
    console.error("Erro ao excluir cliente:", erro);
    return res.status(500).json({ message: "Erro ao excluir cliente." });
  }
}

contaRoutes.get("/users", isAuthenticated, isAdmin, (req, res) =>
  listarClientes(req, res),
);

// `/users/me` ANTES de `/users/:id`, e isso nao e estilo: o Express casa na
// ordem de registro, e com a ordem invertida um DELETE em /users/me cairia na
// rota administrativa com id "me" — 400 para o cliente comum tentando apagar a
// propria conta.
contaRoutes.delete("/users/me", exclusaoLimiter, isAuthenticated, (req, res) =>
  excluirMinhaConta(req, res),
);

contaRoutes.delete(
  "/users/:id",
  exclusaoPeloAdminLimiter,
  isAuthenticated,
  isAdmin,
  (req, res) => excluirClientePeloAdmin(req, res),
);

module.exports = {
  contaRoutes,
  excluirMinhaConta,
  listarClientes,
  excluirClientePeloAdmin,
  MENSAGEM_ULTIMO_ADMIN,
};
