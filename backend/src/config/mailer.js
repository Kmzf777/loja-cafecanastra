const { Resend } = require("resend");

/**
 * Cliente de email.
 *
 * `new Resend(undefined)` LANCA na construcao ("Missing API key"), e este modulo
 * e carregado na cadeia de require do index.js (via utils/emailSender). Ou seja:
 * sem EMAIL_PASS2 no ambiente, o processo inteiro morria antes de abrir a porta —
 * nao dava para nem subir o backend, quanto mais logar.
 *
 * Como email e acessorio no fluxo de desenvolvimento (o que importa e login,
 * catalogo e painel), sem chave o modulo devolve um dublê que registra no
 * console em vez de enviar. Com a chave presente, o comportamento e o de
 * sempre — producao nao muda.
 */

const chave = process.env.EMAIL_PASS2;

const dubleDeEmail = {
  emails: {
    async send(mensagem) {
      console.info(
        `[email] EMAIL_PASS2 ausente — envio simulado. Para: ${
          Array.isArray(mensagem?.to) ? mensagem.to.join(", ") : mensagem?.to
        } · Assunto: ${mensagem?.subject}`,
      );
      return { data: { id: "email-simulado" }, error: null };
    },
  },
};

const resend = chave ? new Resend(chave) : dubleDeEmail;

module.exports = resend;
