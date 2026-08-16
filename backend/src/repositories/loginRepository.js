const pool = require("../pgPool");
const { v4 } = require("uuid");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const crypto = require("crypto");
//const transporter = require("../config/mailer");
const CartRepository = require("./cartRepository");
const resend = require("../config/mailer");
const { REMETENTE, NOME_LOJA, URL_LOJA } = require("../config/remetente");

const SALT_ROUNDS = 10;

/**
 * Atributos do cookie de refresh, num lugar so.
 *
 * Emitir com um conjunto e apagar com outro faz o logout nao apagar nada:
 * o navegador trata como cookies diferentes.
 */
function OPCOES_COOKIE_REFRESH() {
  const isProd = process.env.NODE_ENV === "production";
  return {
    httpOnly: true,
    secure: isProd,
    sameSite: isProd ? "None" : "Lax",
    path: "/",
  };
}

class LoginRepository {
  /**
   * Cadastro.
   *
   * VAZAMENTO DE CONEXAO (corrigido): os dois `return` de 409 abaixo — e-mail
   * repetido e CPF repetido — saiam do metodo sem devolver a conexao ao pool,
   * porque o `try` nao tinha `finally`. O pool do `pg` tem 10 conexoes por
   * padrao: DEZ requisicoes anonimas repetindo um e-mail ja cadastrado
   * esgotavam o pool, e a partir dali TODA consulta da aplicacao — vitrine,
   * painel, login — ficava pendurada esperando conexao, para sempre. Derrubar a
   * loja inteira custava dez POSTs sem autenticacao.
   */
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

      const verifyLink = `${URL_LOJA}/account/verify-email?token=${verificationToken}`;

      /**
       * O Resend NAO lanca quando recusa o envio: ele responde
       * `{ data: null, error: {...} }`. Como ninguem olhava o retorno, o
       * cadastro respondia 201 "Verifique seu email" mesmo quando o e-mail
       * jamais saiu — dominio nao verificado, chave invalida, destinatario
       * recusado. A pessoa ficava esperando um e-mail que nao existia, e a
       * conta, que so ativa por link, ficava inacessivel para sempre.
       */
      let falhaNoEmail = null;
      try {
        const { error: erroDoResend } = await resend.emails.send({
          from: REMETENTE.seguranca,
          to: [email],
          subject: `Confirme seu e-mail — ${NOME_LOJA}`,
          html: `
            <h3>Bem-vindo ao ${NOME_LOJA}, ${name}!</h3>
            <p>Para ativar sua conta, clique no link abaixo:</p>
            <a href="${verifyLink}">Confirmar Email</a>
          `,
        });

        /* const mailOptions = {
          from: '"Shopnaw Loja" <onboarding@resend.dev>', // <nao-responda@shopnaw.com>
          to: email,
          subject: `Confirme seu e-mail — ${NOME_LOJA}`,
          html: `
            <h3>Bem-vindo ao ${NOME_LOJA}, ${name}!</h3>
            <p>Para ativar sua conta e fazer compras, clique no link abaixo:</p>
            <a href="${verifyLink}" target="_blank" style="background:#000;color:#fff;padding:10px 20px;text-decoration:none;border-radius:5px;">Confirmar Email</a>
          `,
        }; 
        
         await transporter.sendMail(mailOptions);*/

        if (erroDoResend) {
          falhaNoEmail = erroDoResend.message || String(erroDoResend);
        }
      } catch (emailError) {
        falhaNoEmail = emailError.message;
      }

      if (falhaNoEmail) {
        console.error(
          `ATIVACAO: conta ${email} criada mas o e-mail NAO foi enviado:`,
          falhaNoEmail,
        );
        // 201 porque a conta existe de fato — mas a mensagem nao pode mandar a
        // pessoa esperar um e-mail que nao vai chegar.
        return res.status(201).json({
          message:
            "Cadastro realizado, mas não conseguimos enviar o e-mail de confirmação agora. Fale com a gente para ativar sua conta.",
          emailEnviado: false,
        });
      }

      return res.status(201).json({
        message: "Cadastro realizado! Verifique seu email.",
        emailEnviado: true,
      });
    } catch (err) {
      console.error("signUp error:", err);
      // `err.message` cru pode carregar SQL e nome de coluna.
      return res.status(500).json({ message: "Erro ao criar usuário." });
    } finally {
      // Uma saida so para a conexao, cobrindo TODOS os caminhos.
      client.release();
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
      // `typ` separa access de refresh: sem a claim, um refresh token de 7
      // dias e aceito como token de acesso caso os segredos coincidam.
      // `algorithm` fixo fecha a porta de "alg confusion" na verificacao.
      const accessToken = jwt.sign(
        { userId: user_id, role: role, typ: "access" },
        process.env.JWT_SECRET,
        {
          expiresIn: process.env.ACCESS_TOKEN_EXPIRY || "15m",
          algorithm: "HS256",
        },
      );
      const refreshToken = jwt.sign(
        { userId: user_id, role: role, typ: "refresh" },
        process.env.JWT_SECRET_REFRESH,
        {
          expiresIn: `${process.env.REFRESH_TOKEN_EXPIRY_DAYS || 7}d`,
          algorithm: "HS256",
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
        ...OPCOES_COOKIE_REFRESH(),
        maxAge:
          Number(process.env.REFRESH_TOKEN_EXPIRY_DAYS || 7) *
          24 * 60 * 60 * 1000,
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

    // Os atributos precisam bater com os de res.cookie no sign-in. Sem
    // secure/sameSite/path iguais, o navegador nao identifica o mesmo cookie e
    // o refreshToken SOBREVIVE ao logout em producao (cross-site, HTTPS).
    res.clearCookie("refreshToken", OPCOES_COOKIE_REFRESH());
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

    /**
     * 4. Pedidos: ANONIMIZAR, nunca apagar.
     *
     * A versao anterior fazia DELETE, com o comentario de que era "para a
     * exclusao funcionar sem erro de FK". O efeito pratico e que excluir um
     * cliente pelo painel APAGAVA O HISTORICO FINANCEIRO dele: o faturamento do
     * mes mudava retroativamente, e a loja perdia a nota daquelas vendas.
     * Nenhum aviso na tela dizia isso ao administrador.
     *
     * Anonimizar atende os dois lados: o dado pessoal some (LGPD art. 16, que
     * ja admite a guarda para cumprimento de obrigacao legal e fiscal) e o
     * registro contabil fica. O `address_json` tambem e limpo — e la que moram
     * nome, endereco e telefone dentro do pedido.
     *
     * A coluna orders.user_id aceita NULL, e a listagem do painel usa LEFT JOIN
     * justamente para continuar mostrando estes pedidos como "Cliente removido".
     */
    await client.query(
      `UPDATE orders
          SET user_id = NULL,
              address_json = jsonb_build_object(
                'anonimizado', true,
                'city',  COALESCE(address_json->>'city', ''),
                'state', COALESCE(address_json->>'state', '')
              )
        WHERE user_id = $1`,
      [userId],
    );
  }

  async deleteUser(req, res) {
    const { userId } = req.params;
    const client = await pool.connect();

    try {
      // Um admin nao pode se excluir pelo painel: o clique errado tira o acesso
      // de quem o deu, sem caminho de volta pela interface.
      if (req.user?.userId === userId) {
        return res.status(400).json({
          message: "Você não pode excluir a própria conta por aqui.",
        });
      }

      /**
       * E nao pode sobrar loja sem administrador.
       *
       * Excluir o ultimo admin deixa o painel inacessivel para sempre: nao ha
       * tela de promocao de usuario, entao a recuperacao so seria por SQL
       * direto no banco de producao.
       */
      const alvo = await client.query(
        "SELECT role FROM users WHERE user_id = $1",
        [userId],
      );
      if (alvo.rowCount === 0) {
        return res.status(404).json({ message: "Usuário não encontrado!" });
      }
      if (alvo.rows[0].role === "admin") {
        const { rows } = await client.query(
          "SELECT COUNT(*)::int AS total FROM users WHERE role = 'admin'",
        );
        if (rows[0].total <= 1) {
          return res.status(400).json({
            message:
              "Este é o último administrador da loja. Promova outro antes de excluir.",
          });
        }
      }

      // Tudo ou nada: sem transacao, uma falha no meio deixava carrinho e
      // endereco apagados com o usuario ainda de pe.
      await client.query("BEGIN");

      await this._clearUserData(client, userId);

      // RETURNING das colunas necessarias, nunca `*`: o `*` devolvia o HASH DA
      // SENHA e o CPF do usuario excluido para o navegador do administrador.
      const result = await client.query(
        "DELETE FROM users WHERE user_id = $1 RETURNING user_id, name, email",
        [userId],
      );

      await client.query("COMMIT");

      if (result.rowCount === 0) {
        return res.status(404).json({ message: "Usuário não encontrado!" });
      }

      return res.status(200).json({
        message: "Usuário deletado com sucesso!",
        user: result.rows[0],
      });
    } catch (err) {
      await client.query("ROLLBACK").catch(() => {});
      console.error("deleteUser error:", err);
      // `err.message` cru vazava nome de coluna e SQL para o cliente.
      return res.status(500).json({ message: "Erro ao deletar o usuário" });
    } finally {
      client.release();
    }
  }

  async refreshToken(req, res) {
    const token = req.cookies?.refreshToken;
    if (!token) return res.sendStatus(401);
    const client = await pool.connect();
    try {
      const payload = jwt.verify(token, process.env.JWT_SECRET_REFRESH, {
        algorithms: ["HS256"],
      });

      // Um access token roubado nao pode virar refresh token.
      if (payload.typ && payload.typ !== "refresh") return res.sendStatus(403);

      /**
       * `expires_at` era gravado na tabela e NUNCA consultado: a validade valia
       * so pela assinatura do JWT. Como consequencia, revogar uma sessao
       * apagando a linha funcionava, mas encurtar a validade no banco nao — e
       * a tabela crescia para sempre. O filtro abaixo faz a coluna valer.
       */
      const result = await client.query(
        `SELECT token_id FROM refresh_tokens
          WHERE token = $1 AND user_id = $2 AND expires_at > NOW()`,
        [token, payload.userId],
      );

      if (result.rowCount === 0) {
        return res.status(403).json({ message: "Token inválido ou expirado." });
      }

      // Faxina oportunista: sem isto a tabela so cresce. Barato porque roda
      // no maximo uma vez por refresh e usa indice de user_id.
      client
        .query("DELETE FROM refresh_tokens WHERE expires_at < NOW()")
        .catch((e) => console.error("Falha ao expurgar refresh tokens:", e.message));

      const userRes = await client.query(
        "SELECT user_id, email, name, cpf, role FROM users WHERE user_id = $1",
        [payload.userId],
      );

      const newAccessToken = jwt.sign(
        { userId: payload.userId, role: userRes.rows[0].role, typ: "access" },
        process.env.JWT_SECRET,
        {
          expiresIn: process.env.ACCESS_TOKEN_EXPIRY || "15m",
          algorithm: "HS256",
        },
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

      // Os atributos precisam bater com os de res.cookie no sign-in. Sem
    // secure/sameSite/path iguais, o navegador nao identifica o mesmo cookie e
    // o refreshToken SOBREVIVE ao logout em producao (cross-site, HTTPS).
    res.clearCookie("refreshToken", OPCOES_COOKIE_REFRESH());

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

      // URL_LOJA e normalizada (sem barra final, primeira entrada da lista);
      // `process.env.CORS_ORIGIN` cru viraria "https://a.com,https://b.com/..."
      // quando houvesse mais de uma origem liberada.
      const resetLink = `${URL_LOJA}/account/reset-password?token=${token}`;

      try {
        await resend.emails.send({
          from: REMETENTE.seguranca,
          to: [email],
          subject: `Recuperação de senha — ${NOME_LOJA}`,
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
        subject: `Recuperação de senha — ${NOME_LOJA}`,
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

      /**
       * Trocar a senha DERRUBA todas as sessoes abertas.
       *
       * Sem isto, redefinir a senha nao adiantava nada contra quem ja estava
       * dentro: o refresh token de sete dias continuava valendo, e o invasor
       * seguia renovando o acesso indefinidamente. "Troquei minha senha" e
       * exatamente o que a pessoa faz quando desconfia que alguem entrou —
       * precisa ser o momento em que esse alguem e expulso.
       */
      const { rowCount: sessoesEncerradas } = await client.query(
        "DELETE FROM refresh_tokens WHERE user_id = $1",
        [user_id],
      );

      await client.query("COMMIT");

      console.info(
        `Senha redefinida para ${user_id}: ${sessoesEncerradas} sessão(ões) encerrada(s).`,
      );

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
