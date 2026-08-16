const { Router } = require("express");
const LoginRepository = require("../repositories/loginRepository");
const loginRoutes = Router();
const loginRepository = new LoginRepository();
const authenticateToken = require("../middleware/isAuthenticated");
const isAdmin = require("../middleware/isAdmin");
const {
  signUpValidationRules,
  signInValidationRules,
  resetPasswordValidationRules,
  validate,
} = require("../middleware/validateAuth");
const rateLimit = require("express-rate-limit");

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  message: {
    error: "Muitas tentativas de login. Tente novamente em 15 minutos.",
  },
});

/**
 * Só o sign-in tinha limite. As outras rotas de credencial ficavam abertas, e
 * cada uma abre um abuso diferente:
 *   sign-up ........... criação de contas em massa e disparo de e-mail pela
 *                       nossa conta do Resend (custo e reputação de remetente)
 *   forgot-password ... inundar a caixa de uma pessoa e enumerar e-mails
 *   reset-password .... força bruta no token de 32 bytes
 *   verify-email ...... força bruta no token de verificação
 *   refresh-token ..... força bruta no cookie de sessão
 */
const cadastroLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 10,
  message: { error: "Muitas tentativas. Tente novamente em uma hora." },
});

const senhaLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 5,
  message: {
    error: "Muitas tentativas de recuperação. Tente novamente em uma hora.",
  },
});

const tokenLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 60,
  message: { error: "Muitas requisições. Aguarde alguns minutos." },
});

loginRoutes.post(
  "/sign-up",
  cadastroLimiter,
  signUpValidationRules,
  validate,
  async (request, response) => {
    await loginRepository.signUp(request, response);
  },
);

loginRoutes.post("/verify-email", tokenLimiter, async (request, response) => {
  await loginRepository.verifyEmail(request, response);
});

loginRoutes.post(
  "/sign-in",
  signInValidationRules,
  validate,
  loginLimiter,
  async (request, response) => {
    await loginRepository.signIn(request, response);
  },
);

loginRoutes.post("/sign-out", async (request, response) => {
  await loginRepository.signOut(request, response);
});

loginRoutes.get(
  "/users",
  authenticateToken,
  isAdmin,
  async (request, response) => {
    await loginRepository.getUsers(request, response);
  },
);

loginRoutes.delete("/users/me", authenticateToken, async (req, res) => {
  await loginRepository.deleteMyAccount(req, res);
});

loginRoutes.delete(
  "/users/:userId",
  authenticateToken,
  isAdmin,
  async (request, response) => {
    await loginRepository.deleteUser(request, response);
  },
);

loginRoutes.post("/forgot-password", senhaLimiter, async (req, res) => {
  await loginRepository.forgotPassword(req, res);
});

loginRoutes.post(
  "/reset-password",
  senhaLimiter,
  resetPasswordValidationRules,
  validate,
  async (req, res) => {
    await loginRepository.resetPassword(req, res);
  },
);

loginRoutes.post("/refresh-token", tokenLimiter, async (request, response) => {
  await loginRepository.refreshToken(request, response);
});

loginRoutes.put("/users/profile", authenticateToken, async (req, res) => {
  await loginRepository.updateProfile(req, res);
});

module.exports = loginRoutes;
