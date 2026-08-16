const jwt = require("jsonwebtoken");

function authenticateToken(req, res, next) {
  const authHeader = req.headers["authorization"];
  const token = authHeader?.split(" ")[1];
  if (!token) return res.sendStatus(401);

  // `algorithms` fixo e obrigatorio: sem isso o jsonwebtoken aceita o algoritmo
  // que vier no cabecalho do proprio token. E a familia de ataques "alg
  // confusion" — trocar para "none", ou fazer um token assinado com HMAC ser
  // verificado contra uma chave publica RSA. Aqui so HS256 vale.
  jwt.verify(
    token,
    process.env.JWT_SECRET,
    { algorithms: ["HS256"] },
    (err, payload) => {
      /**
       * Token EXPIRADO responde 401, nao 403.
       *
       * Os dois casos sao diferentes e o cliente trata cada um de um jeito:
       * 401 = "sua credencial venceu, renove"; 403 = "sua credencial vale mas
       * voce nao pode isso". O painel legado so chama /auth/refresh-token
       * quando ve 401 — com 403 para tudo, o access token de 15 minutos vencia
       * e a tela simplesmente parava de carregar dados no meio da sessao, sem
       * mensagem e sem redirecionar para o login.
       */
      if (err) {
        return res.sendStatus(err.name === "TokenExpiredError" ? 401 : 403);
      }

      req.user = payload || {};
      if (!req.user.userId && req.user.user_id) {
        req.user.userId = req.user.user_id;
      }

      // Access e refresh eram indistinguiveis: os dois carregam { userId, role }
      // e mudam so de segredo. Se algum dia os segredos coincidirem (ou forem
      // trocados por engano), um refresh token de 7 dias passaria como token de
      // acesso. A claim `typ` torna a diferenca explicita. Tokens antigos, sem
      // a claim, continuam valendo durante a transicao.
      if (req.user.typ && req.user.typ !== "access") return res.sendStatus(403);

      next();
    },
  );
}

module.exports = authenticateToken;
