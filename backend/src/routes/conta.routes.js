const { Router } = require("express");
const rateLimit = require("express-rate-limit");
const pool = require("../pgPool");
const isAuthenticated = require("../middleware/isAuthenticated");

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

contaRoutes.delete("/users/me", exclusaoLimiter, isAuthenticated, (req, res) =>
  excluirMinhaConta(req, res),
);

module.exports = { contaRoutes, excluirMinhaConta, MENSAGEM_ULTIMO_ADMIN };
