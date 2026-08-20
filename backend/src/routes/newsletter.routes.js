const { Router } = require("express");
const rateLimit = require("express-rate-limit");
const pool = require("../pgPool");

/**
 * POST /newsletter — o formulário do rodapé.
 *
 * A RESPOSTA É SEMPRE `{ ok: true }` PARA E-MAIL VÁLIDO, inscrito novo ou
 * repetido, e isso é deliberado (anti-enumeração): se "já inscrito" tivesse
 * resposta própria, qualquer pessoa testaria se um e-mail específico está na
 * lista da loja — que é dado pessoal. A deduplicação acontece em silêncio no
 * banco, pelo UNIQUE de 0011 + ON CONFLICT DO NOTHING.
 *
 * O único caso que difere é o 400 de e-mail malformado, porque aí não há o
 * que vazar — a recusa fala do FORMATO, não da lista.
 */

/** O mesmo formato básico do CHECK `newsletter_email_formato` (0011). */
const FORMATO_EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

async function inscrever(req, res) {
  const bruto = req.body?.email;
  // Minúsculo na entrada: "Bea@Ex.com" e "bea@ex.com" são a mesma caixa
  // postal, e sem normalizar o UNIQUE deixaria as duas entrarem.
  const email = String(bruto || "").trim().toLowerCase();

  if (!email || email.length > 254 || !FORMATO_EMAIL.test(email)) {
    return res.status(400).json({ error: "Informe um e-mail válido." });
  }

  try {
    await pool.query(
      `INSERT INTO canastra.newsletter_inscritos (email)
       VALUES ($1)
       ON CONFLICT (email) DO NOTHING`,
      [email],
    );
    return res.status(200).json({ ok: true });
  } catch (erro) {
    // Banco fora do ar não pode fingir sucesso: a pessoa acharia que está na
    // lista e não está. 500 honesto; o rodapé mostra o erro discreto.
    console.error("Erro ao inscrever na newsletter:", erro);
    return res.status(500).json({ error: "Não foi possível salvar agora." });
  }
}

/**
 * Teto apertado (10/min por IP): a rota é pública, escreve no banco e um laço
 * despejando e-mails alheios aqui viraria spam de lista em nome da loja.
 */
const newsletterLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  message: { error: "Muitas inscrições seguidas. Aguarde um instante." },
});

const newsletterRoutes = Router();
newsletterRoutes.post("/", newsletterLimiter, inscrever);

module.exports = { newsletterRoutes, inscrever };
