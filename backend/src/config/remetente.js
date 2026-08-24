/**
 * Identidade da loja nos e-mails.
 *
 * Todo remetente estava escrito no codigo com um dominio fixo que o Cafe
 * Canastra nao controla. Em producao o Resend so entrega de dominio
 * verificado na conta:
 * com esses remetentes, TODOS os e-mails (confirmacao de cadastro, recuperacao
 * de senha, status de pedido) seriam recusados. E o erro era engolido num
 * try/catch que so faz console.error — o cliente nunca receberia o e-mail e
 * ninguem ficaria sabendo.
 *
 * Centralizado aqui e parametrizado por ambiente, para trocar o dominio em um
 * lugar so quando o DNS do Canastra for verificado no Resend.
 */

const DOMINIO = process.env.EMAIL_DOMINIO || "cafecanastra.com";
const NOME_LOJA = process.env.LOJA_NOME || "Café Canastra";

/**
 * Remetente por finalidade. `seguranca` saiu: os e-mails de conta (confirmação,
 * senha) são do GoTrue desde a F2 e nada neste serviço o usava — um remetente
 * declarado que ninguém envia só confunde quem procura de onde saiu um e-mail.
 */
const REMETENTE = {
  pedidos: `${NOME_LOJA} <${process.env.EMAIL_PEDIDOS || `pedidos@${DOMINIO}`}>`,
  sistema: `${NOME_LOJA} <${process.env.EMAIL_PEDIDOS || `pedidos@${DOMINIO}`}>`,
};

/** Para onde vao os avisos internos (novo pedido). */
const EMAIL_ADMIN = process.env.EMAIL_ADMIN || `contato@${DOMINIO}`;

/** URL publica da loja, usada nos links dos e-mails. */
const URL_LOJA = (
  process.env.LOJA_URL ||
  process.env.CORS_ORIGIN ||
  "https://loja.cafecanastra.com"
)
  .split(",")[0]
  .trim()
  .replace(/\/$/, "");

module.exports = { REMETENTE, EMAIL_ADMIN, URL_LOJA, NOME_LOJA, DOMINIO };
