/**
 * Administrador da loja e LINHA EM `canastra.admins`, nunca um claim.
 *
 * A versao anterior lia `req.user.role === "admin"`, e o papel vinha do token
 * que o proprio Express assinava — coerente enquanto a loja era a unica
 * emissora. Com o GoTrue de uma instancia COMPARTILHADA, qualquer projeto que
 * divida a VPS emite token com o claim que quiser: `role: "admin"`,
 * `is_admin: true`, o que for. Um claim deixou de ser afirmacao da loja e
 * virou afirmacao de terceiro.
 *
 * `ehAdmin` e preenchido por `isAuthenticated` a partir de um EXISTS em
 * `canastra.admins` (a mesma pergunta que `canastra.eh_admin()` faz na RLS),
 * na mesma ida ao banco que confere o vinculo de cliente — entao este
 * middleware nao custa consulta nenhuma.
 *
 * FALHA FECHADA: sem `req.user`, o valor e `undefined` e a resposta e 403. Uma
 * rota administrativa montada sem `isAuthenticated` na frente fica inacessivel
 * em vez de aberta, que e o lado certo do erro.
 */
const isAdmin = (req, res, next) => {
  if (req.user && req.user.ehAdmin === true) {
    next();
  } else {
    return res.status(403).json({
      error: "Acesso negado. Esta ação requer privilégios de administrador.",
    });
  }
};

module.exports = isAdmin;
