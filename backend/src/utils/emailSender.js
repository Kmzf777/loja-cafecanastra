const { REMETENTE, EMAIL_ADMIN, NOME_LOJA, URL_LOJA } = require("../config/remetente");
const pool = require("../pgPool");
const resend = require("../config/mailer");

/**
 * O que cada status em português diz ao cliente. Status fora desta lista
 * (em_processamento, autorizado) não geram e-mail de propósito — são estados
 * intermediários do gateway, e avisar "seu pagamento está em análise" a cada
 * oscilação só gera ansiedade e chamado de suporte. O mesmo recorte que a
 * versão em inglês fazia (in_process/authorized ficavam de fora).
 */
function conteudoDoStatus(status, order, name, trackingCode) {
  const numero = order.order_id.slice(0, 8);
  switch (status) {
    case "pendente":
      return {
        subject: `Pedido recebido - aguardando pagamento #${numero}`,
        text: `Olá ${name}, recebemos seu pedido! Assim que o pagamento for confirmado, iniciaremos o preparo.`,
      };
    case "aprovado":
      return {
        subject: `Pagamento aprovado - pedido #${numero}`,
        text: `Olá ${name}, seu pagamento foi confirmado! Estamos preparando seu pedido.`,
      };
    case "enviado": {
      let text = `Olá ${name}, seu pedido foi enviado! Em breve chegará até você.`;
      if (trackingCode) text += `\nSeu código de rastreio é: ${trackingCode}`;
      return { subject: `Pedido enviado - pedido #${numero}`, text };
    }
    case "entregue":
      return {
        subject: `Pedido entregue - pedido #${numero}`,
        text: `Olá ${name}, seu pedido foi entregue.`,
      };
    case "cancelado":
    case "rejeitado":
      return {
        subject: `Problema no pedido #${numero}`,
        text: `Olá ${name}, houve um problema com seu pagamento ou o pedido foi cancelado.`,
      };
    case "reembolsado":
      return {
        subject: `Reembolso do pedido #${numero}`,
        text: `Olá ${name}, o valor do seu pedido foi devolvido. O prazo para aparecer na fatura depende do seu banco.`,
      };
    default:
      return null;
  }
}

/**
 * Avisa o cliente que o pedido mudou de status.
 *
 * O DESTINATÁRIO MORA EM DOIS LUGARES desde a F2: o e-mail é do GoTrue
 * (`auth.users.email`) e o nome é da loja (`canastra.clientes.nome`). O pool
 * conecta como dono do banco, que lê `auth` sem cerimônia — é a mesma leitura
 * que `ordersRepository.getAllOrders` já faz para o painel.
 *
 * `pool.query` direto, sem `pool.connect()`: a versão anterior pegava um
 * cliente na mão e só o devolvia DEPOIS da query — quando a query lançava, a
 * conexão vazava e o pool de 10 ia minguando a cada erro de e-mail.
 */
async function sendStatusEmail(order, newStatus, trackingCode) {
  if (!order || !order.user_id) return;

  try {
    const { rows } = await pool.query(
      `SELECT u.email, COALESCE(c.nome, 'Cliente') AS nome
         FROM auth.users u
         LEFT JOIN canastra.clientes c ON c.user_id = u.id
        WHERE u.id = $1::uuid`,
      [order.user_id],
    );

    if (rows.length === 0 || !rows[0].email) return;
    const { email, nome } = rows[0];

    const conteudo = conteudoDoStatus(newStatus, order, nome, trackingCode);
    if (!conteudo) return;

    try {
      await resend.emails.send({
        from: REMETENTE.pedidos,
        to: [email],
        subject: conteudo.subject,
        html: `
        <div>
           <h2>${conteudo.subject}</h2>
           <p>${conteudo.text.replace(/\n/g, "<br/>")}</p>
           <hr/>
           <p><strong>Resumo do Pedido:</strong></p>
           <p>Total: R$ ${Number(order.total_amount).toFixed(2)}</p>
           <br/>
           <a href="${URL_LOJA}/account">Ver Meus Pedidos</a>
        </div>
      `,
      });
    } catch (err) {
      console.error("Erro na API Resend:", err);
      return;
    }

    console.log(`📧 Email de status '${newStatus}' enviado para ${email}`);
  } catch (err) {
    // E-mail é efeito colateral: um pedido pago não pode virar erro porque o
    // aviso não saiu. Mas o motivo fica no log — silêncio aqui foi o que
    // deixou meses de e-mails não enviados passarem despercebidos.
    console.error("Erro ao enviar email de status:", err);
  }
}

async function sendAdminNewOrderEmail(order) {
  try {
    const adminEmail = EMAIL_ADMIN;
    const dashboardUrl = `${URL_LOJA}/dashboard/orders`;

    const subject = `🎉 Novo Pedido Recebido! #${order.order_id.slice(0, 8)}`;

    await resend.emails.send({
      from: REMETENTE.sistema,
      to: [adminEmail],
      subject: subject,
      html: `
        <div style="font-family: Arial, sans-serif; color: #333;">
          <h2 style="color: #2e7d32;">Venda Realizada! 🎉</h2>
          <p>Você tem um novo pedido aguardando processamento no ${NOME_LOJA}.</p>
          <hr/>
          <p><strong>ID do Pedido:</strong> ${order.order_id}</p>
          <p><strong>Valor Total:</strong> ${Number(order.total_amount).toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}</p>
          <p><strong>Método de Pagamento:</strong> ${String(order.payment_method || "").toUpperCase()}</p>
          <br/>
          <a href="${dashboardUrl}" style="background-color: #000; color: #fff; padding: 12px 20px; text-decoration: none; border-radius: 5px; display: inline-block; font-weight: bold;">
            Acessar Painel de Pedidos
          </a>
        </div>
      `,
    });
    console.log(`📧 Email de notificação enviado para o Admin (${adminEmail})`);
  } catch (err) {
    console.error("Erro na API Resend (Admin):", err);
  }
}

module.exports = { sendStatusEmail, sendAdminNewOrderEmail };
