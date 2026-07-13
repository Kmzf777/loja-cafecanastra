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

loginRoutes.post(
  "/sign-up",
  signUpValidationRules,
  validate,
  async (request, response) => {
    await loginRepository.signUp(request, response);
  },
);

loginRoutes.post("/verify-email", async (request, response) => {
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

loginRoutes.post("/forgot-password", async (req, res) => {
  await loginRepository.forgotPassword(req, res);
});

loginRoutes.post(
  "/reset-password",
  resetPasswordValidationRules,
  validate,
  async (req, res) => {
    await loginRepository.resetPassword(req, res);
  },
);

loginRoutes.post("/refresh-token", async (request, response) => {
  await loginRepository.refreshToken(request, response);
});

loginRoutes.put("/users/profile", authenticateToken, async (req, res) => {
  await loginRepository.updateProfile(req, res);
});

module.exports = loginRoutes;
