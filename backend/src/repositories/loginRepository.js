const pool = require("../pgPool");
const { v4 } = require("uuid");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const crypto = require("crypto");
//const transporter = require("../config/mailer");
const CartRepository = require("./cartRepository");
const resend = require("../config/mailer");

const SALT_ROUNDS = 10;

class LoginRepository {
  async signUp(req, res) {
    const { name, cpf, phone, email, password } = req.body;
    const client = await pool.connect();

    try {
      // 1. Verificar duplicidade de email antes de tudo
      const { rowCount } = await client.query(
        "SELECT 1 FROM users WHERE email = $1",
        [email],
      );
      if (rowCount > 0) {
        return res.status(409).json({ message: "Email já cadastrado!" });
      }

      if (cpf) {
        const { rowCount: cpfExists } = await client.query(
          "SELECT 1 FROM users WHERE cpf = $1",
          [cpf],
        );
        if (cpfExists > 0) {
          return res.status(409).json({ message: "Este CPF já está em uso!" });
        }
      }

      // 2. Gerar hash de forma assíncrona
      const hash = await bcrypt.hash(password, SALT_ROUNDS);
      const verificationToken = crypto.randomBytes(32).toString("hex");

      // 3. Inserir usuário
      await client.query(
        `INSERT INTO users 
         (user_id, name, cpf, phone, email, password, verification_token, is_verified) 
         VALUES ($1, $2, $3, $4, $5, $6, $7, false)`,
        [v4(), name, cpf, phone, email, hash, verificationToken],
      );

      client.release();

      const verifyLink = `${process.env.CORS_ORIGIN}/account/verify-email?token=${verificationToken}`;

      try {
        await resend.emails.send({
          from: "Shopnaw Segurança <nao-responda@shopnaw.com.br>",
          to: [email],
          subject: "Confirme seu email - Shopnaw",
          html: `
            <h3>Bem-vindo à Shopnaw, ${name}!</h3>
            <p>Para ativar sua conta, clique no link abaixo:</p>
            <a href="${verifyLink}">Confirmar Email</a>
          `,
        });

        /* const mailOptions = {
          from: '"Shopnaw Loja" <onboarding@resend.dev>', // <nao-responda@shopnaw.com>
          to: email,
          subject: "Confirme seu email - Shopnaw",
          html: `
            <h3>Bem-vindo à Shopnaw, ${name}!</h3>
            <p>Para ativar sua conta e fazer compras, clique no link abaixo:</p>
            <a href="${verifyLink}" target="_blank" style="background:#000;color:#fff;padding:10px 20px;text-decoration:none;border-radius:5px;">Confirmar Email</a>
          `,
        }; 
        
         await transporter.sendMail(mailOptions);*/
      } catch (emailError) {
        console.error("Erro no envio do Resend:", emailError);
      }

      return res.status(201).json({
        message: "Cadastro realizado! Verifique seu email.",
      });
    } catch (err) {
      console.error("signUp error:", err);
      try {
        client.release();
      } catch (e) {}
      return res
        .status(500)
        .json({ error: err.message, message: "Erro ao criar usuário." });
    }
  }

  async verifyEmail(req, res) {
    const { token } = req.body;
    const client = await pool.connect();
    try {
      const result = await client.query(
        "SELECT user_id FROM users WHERE verification_token = $1",
        [token],
      );

      if (result.rowCount === 0) {
        return res
          .status(400)
          .json({ message: "Token inválido ou já utilizado." });
      }

      const userId = result.rows[0].user_id;

      await client.query(
        "UPDATE users SET is_verified = true, verification_token = NULL WHERE user_id = $1",
        [userId],
      );

      return res.json({ message: "Email verificado com sucesso!" });
    } catch (err) {
      console.error(err);
      return res.status(500).json({ message: "Erro ao verificar email." });
    } finally {
      client.release();
    }
  }

  async signIn(req, res) {
    const { email, password } = req.body;
    const client = await pool.connect();

    try {
      // 1. Buscar usuário
      const result = await client.query(
        "SELECT user_id, name, cpf, password, role, is_verified FROM users WHERE email = $1",
        [email],
      );
      if (result.rowCount === 0) {
        return res.status(401).json({ message: "Email ou senha inválidos!" });
      }

      const {
        user_id,
        name,
        password: hash,
        role,
        cpf,
        is_verified,
      } = result.rows[0];

      if (!is_verified) {
        return res.status(403).json({
          message:
            "Sua conta ainda não foi ativada. Verifique seu email (inclusive SPAM).",
        });
      }

      // 2. Comparar senhas
      const match = await bcrypt.compare(password, hash);
      if (!match) {
        return res.status(401).json({ message: "Email ou senha inválidos!" });
      }

      // 3. Gerar tokens
      const accessToken = jwt.sign(
        { userId: user_id, role: role },
        process.env.JWT_SECRET,
        {
          expiresIn: process.env.ACCESS_TOKEN_EXPIRY,
        },
      );
      const refreshToken = jwt.sign(
        { userId: user_id, role: role },
        process.env.JWT_SECRET_REFRESH,
        {
          expiresIn: `${process.env.REFRESH_TOKEN_EXPIRY_DAYS}d`,
        },
      );

      // 4. Aqui você pode salvar o refreshToken em cookie ou DB

      const expires_at = new Date(
        Date.now() +
          process.env.REFRESH_TOKEN_EXPIRY_DAYS * 24 * 60 * 60 * 1000,
      );
      await client.query(
        "INSERT INTO refresh_tokens (token_id, user_id, token, expires_at) VALUES ($1,$2,$3,$4)",
        [v4(), user_id, refreshToken, expires_at],
      );

      const isProd = process.env.NODE_ENV === "production";

      res.cookie("refreshToken", refreshToken, {
        httpOnly: true,
        secure: isProd ? true : false,
        sameSite: isProd ? "None" : "Lax",
        path: "/",
        maxAge:
          Number(process.env.REFRESH_TOKEN_EXPIRY_DAYS) * 24 * 60 * 60 * 1000,
      });

      let cartItems = [];
      if (req.body.localCart && req.body.localCart.length > 0) {
        const cart = await CartRepository.findOrCreateCart({ userId: user_id });
        const finalCart = await CartRepository.mergeCart(
          cart.cart_id,
          req.body.localCart,
        );
        cartItems = finalCart.items;
      } else {
        // 2. Se não tem nada local, mas talvez o usuário já tenha coisas salvas no banco de antes
        const cart = await CartRepository.findOrCreateCart({ userId: user_id });
        cartItems = await CartRepository.getCartByCartId(cart.cart_id);
      }

      return res.json({
        accessToken,
        user: { userId: user_id, email, name, role },
        mergedCart: cartItems,
      });
    } catch (err) {
      console.error("signIn error:", err);
      return res
        .status(500)
        .json({ error: err.message, message: "Erro ao autenticar o usuário" });
    } finally {
      client.release();
    }
  }

  async signOut(req, res) {
    const refreshToken = req.cookies?.refreshToken;
    if (!refreshToken) return res.sendStatus(204);

    const client = await pool.connect();

    try {
      await client.query("DELETE FROM refresh_tokens WHERE token = $1", [
        refreshToken,
      ]);
    } catch (err) {
      console.error("Erro ao deletar token:", err);
    } finally {
      client.release();
    }

    res.clearCookie("refreshToken");
    return res.status(200).json({ message: "Logout efetuado com sucesso." });
  }

  async getUsers(req, res) {
    const client = await pool.connect();

    try {
      let page = parseInt(req.query.page, 10) || 1;
      let limit = parseInt(req.query.limit, 10) || 10;

      if (page < 1) page = 1;
      if (limit < 1) limit = 1;
      if (limit > 100) limit = 100;
      const countRes = await client.query("SELECT COUNT(*) FROM users");
      const total = parseInt(countRes.rows[0].count);
      const totalPages = Math.ceil(total / limit);
      const offset = (page - 1) * limit;

      const result = await client.query(
        `SELECT u.user_id, u.name, u.email, u.phone, u.created_at,
        (SELECT COUNT(*) FROM orders o WHERE o.user_id = u.user_id) as purchases
        FROM users u ORDER BY u.created_at DESC LIMIT $1 OFFSET $2     
      `,
        [limit, offset],
      );

      return res.status(200).json({
        users: result.rows,
        total,
        totalPages,
        page,
      });
    } catch (err) {
      console.error("getUsers error:", err);
      return res
        .status(500)
        .json({ error: err.message, message: "Erro ao buscar usuários" });
    } finally {
      client.release();
    }
  }

  async _clearUserData(client, userId) {
    // 1. Deletar itens do carrinho
    // Primeiro achamos o carrinho
    const cartRes = await client.query(
      "SELECT cart_id FROM carts WHERE user_id = $1",
      [userId],
    );
    if (cartRes.rows.length > 0) {
      const cartId = cartRes.rows[0].cart_id;
      await client.query("DELETE FROM cart_items WHERE cart_id = $1", [cartId]);
      await client.query("DELETE FROM carts WHERE cart_id = $1", [cartId]);
    }

    // 2. Deletar endereços
    await client.query("DELETE FROM addresses WHERE user_id = $1", [userId]);

    // 3. Deletar tokens de refresh e reset de senha
    await client.query("DELETE FROM refresh_tokens WHERE user_id = $1", [
      userId,
    ]);
    await client.query("DELETE FROM password_resets WHERE user_id = $1", [
      userId,
    ]);

    // 4. Pedidos (Orders) - ATENÇÃO:
    // Em sistemas reais, NÃO costumamos deletar pedidos para manter histórico financeiro.
    // Mas se a LGPD exigir "esquecimento total", deletamos.
    // Se quiser manter os pedidos mas desvincular o usuário, setaríamos user_id = NULL (se a coluna permitir).
    // Aqui vou DELETAR para garantir que a exclusão do usuário funcione sem erros de FK.
    await client.query("DELETE FROM orders WHERE user_id = $1", [userId]);
  }

  async deleteUser(req, res) {
    const { userId } = req.params;
    const client = await pool.connect();

    try {
      await this._clearUserData(client, userId);

      const result = await client.query(
        "DELETE FROM users WHERE user_id = $1 RETURNING *",
        [userId],
      );

      if (result.rowCount === 0) {
        return res.status(404).json({ message: "Usuário não encontrado!" });
      }

      return res.status(200).json({
        message: "Usuário deletado com sucesso!",
        user: result.rows[0],
      });
    } catch (err) {
      console.error("deleteUser error:", err);
      return res
        .status(500)
        .json({ error: err.message, message: "Erro ao deletar o usuário" });
    } finally {
      client.release();
    }
  }

  async refreshToken(req, res) {
    const token = req.cookies?.refreshToken;
    if (!token) return res.sendStatus(401);
    const client = await pool.connect();
    try {
      const payload = jwt.verify(token, process.env.JWT_SECRET_REFRESH);

      const result = await client.query(
        "SELECT * FROM refresh_tokens WHERE token = $1 AND user_id = $2",
        [token, payload.userId],
      );

      if (result.rowCount === 0) {
        return res.status(403).json({ message: "Token inválido ou expirado." });
      }

      const userRes = await client.query(
        "SELECT user_id, email, name, cpf, role FROM users WHERE user_id = $1",
        [payload.userId],
      );

      const newAccessToken = jwt.sign(
        { userId: payload.userId, role: userRes.rows[0].role },
        process.env.JWT_SECRET,
        { expiresIn: process.env.ACCESS_TOKEN_EXPIRY },
      );

      const user = userRes.rows[0]
        ? {
            userId: userRes.rows[0].user_id,
            email: userRes.rows[0].email,
            name: userRes.rows[0].name,
            cpf: userRes.rows[0].cpf,
            role: userRes.rows[0].role,
          }
        : null;

      return res.json({ accessToken: newAccessToken, user });
    } catch (err) {
      return res.sendStatus(403);
    } finally {
      client.release();
    }
  }

  async deleteMyAccount(req, res) {
    const { userId } = req.user;
    const client = await pool.connect();

    try {
      await this._clearUserData(client, userId);

      await client.query("DELETE FROM refresh_tokens WHERE user_id = $1", [
        userId,
      ]);

      const result = await client.query(
        "DELETE FROM users WHERE user_id = $1 RETURNING *",
        [userId],
      );

      if (result.rowCount === 0) {
        return res.status(404).json({ message: "Usuário não encontrado." });
      }

      res.clearCookie("refreshToken");

      return res
        .status(200)
        .json({ message: "Sua conta foi excluída com sucesso." });
    } catch (err) {
      console.error("Erro ao excluir conta:", err);
      return res
        .status(500)
        .json({ error: err.message, message: "Erro ao excluir conta." });
    } finally {
      client.release();
    }
  }

  async forgotPassword(req, res) {
    const { email } = req.body;
    const client = await pool.connect();

    try {
      const userRes = await client.query(
        "SELECT user_id, name FROM users WHERE email = $1",
        [email],
      );

      if (userRes.rowCount === 0) {
        return res.status(404).json({ message: "E-mail não encontrado." });
      }

      const user = userRes.rows[0];

      const token = crypto.randomBytes(32).toString("hex");
      const expiresAt = new Date(Date.now() + 1 * 60 * 60 * 1000); // 1 hora

      await client.query("DELETE FROM password_resets WHERE user_id = $1", [
        user.user_id,
      ]);

      await client.query(
        "INSERT INTO password_resets (id, user_id, token, expires_at) VALUES ($1, $2, $3, $4)",
        [v4(), user.user_id, token, expiresAt],
      );

      const resetLink = `${process.env.CORS_ORIGIN}/account/reset-password?token=${token}`;

      try {
        await resend.emails.send({
          from: "Shopnaw Segurança <nao-responda@shopnaw.com.br>",
          to: [email],
          subject: "Recuperação de Senha - Shopnaw",
          html: `
          <h3>Olá, ${user.name}</h3>
          <p>Recebemos uma solicitação para redefinir sua senha.</p>
          <p>Clique no link abaixo para criar uma nova senha:</p>
          <a href="${resetLink}" target="_blank">Redefinir Minha Senha</a>
          <p>Este link expira em 1 hora.</p>
          <p>Se você não solicitou isso, ignore este e-mail.</p>
        `,
        });
        console.log(`📧 Email enviado via API para ${email}`);
      } catch (err) {
        console.error("Erro na API Resend:", err);
      }

      /* const mailOptions = {
        from: '"Shopnaw Suporte" <onboarding@resend.dev>', // <nao-responda@shopnaw.com>
        to: email,
        subject: "Recuperação de Senha - Shopnaw",
        html: `
          <h3>Olá, ${user.name}</h3>
          <p>Recebemos uma solicitação para redefinir sua senha.</p>
          <p>Clique no link abaixo para criar uma nova senha:</p>
          <a href="${resetLink}" target="_blank">Redefinir Minha Senha</a>
          <p>Este link expira em 1 hora.</p>
          <p>Se você não solicitou isso, ignore este e-mail.</p>
        `,
      };

      await transporter.sendMail(mailOptions); */

      return res.json({ message: "E-mail de recuperação enviado!" });
    } catch (err) {
      console.error("forgotPassword error:", err);
      return res
        .status(500)
        .json({ message: "Erro ao enviar e-mail de recuperação." });
    } finally {
      client.release();
    }
  }

  async resetPassword(req, res) {
    const { token, newPassword } = req.body;
    const client = await pool.connect();

    try {
      const tokenRes = await client.query(
        "SELECT user_id, expires_at FROM password_resets WHERE token = $1",
        [token],
      );

      if (tokenRes.rowCount === 0) {
        return res.status(400).json({ message: "Token inválido ou expirado." });
      }

      const { user_id, expires_at } = tokenRes.rows[0];

      if (new Date() > new Date(expires_at)) {
        return res
          .status(400)
          .json({ message: "Token expirado. Solicite novamente." });
      }

      const hash = await bcrypt.hash(newPassword, SALT_ROUNDS);

      await client.query("BEGIN");

      await client.query("UPDATE users SET password = $1 WHERE user_id = $2", [
        hash,
        user_id,
      ]);
      await client.query("DELETE FROM password_resets WHERE user_id = $1", [
        user_id,
      ]);

      await client.query("COMMIT");

      return res.json({
        message: "Senha alterada com sucesso! Faça login novamente.",
      });
    } catch (err) {
      await client.query("ROLLBACK");
      console.error("resetPassword error:", err);
      return res.status(500).json({ message: "Erro ao redefinir senha." });
    } finally {
      client.release();
    }
  }

  async updateProfile(req, res) {
    const { userId } = req.user; // Pego pelo middleware de autenticação
    const { cpf, phone, name } = req.body;
    const client = await pool.connect();

    try {
      // Validar se o CPF já está em uso por outro usuário
      if (cpf) {
        const { rows } = await client.query(
          "SELECT user_id FROM users WHERE cpf = $1 AND user_id <> $2",
          [cpf, userId],
        );
        if (rows.length > 0) {
          return res.status(409).json({
            message: "Este CPF já está sendo utilizado por outra conta.",
          });
        }
      }

      await client.query(
        "UPDATE users SET cpf = COALESCE($1, cpf), phone = COALESCE($2, phone), name = COALESCE($3, name) WHERE user_id = $4",
        [cpf, phone, name, userId],
      );

      return res.json({ message: "Perfil atualizado com sucesso!" });
    } catch (err) {
      return res
        .status(500)
        .json({ error: err.message, message: "Erro ao atualizar perfil." });
    } finally {
      client.release();
    }
  }
}

module.exports = LoginRepository;
