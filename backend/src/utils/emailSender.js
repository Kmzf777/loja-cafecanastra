const {
  REMETENTE,
  EMAIL_ADMIN,
  NOME_LOJA,
  URL_LOJA,
} = require("../config/remetente");
//const transporter = require("../config/mailer");
const pool = require("../pgPool");
const resend = require("../config/mailer");

async function sendStatusEmail(order, newStatus, trackingCode) {
  if (!order || !order.user_id) return;

  try {
    const client = await pool.connect();
    const userRes = await client.query(
      "SELECT email, name FROM users WHERE user_id = $1",
      [order.user_id],
    );
    client.release();

    if (userRes.rows.length === 0) return;
    const { email, name } = userRes.rows[0];

    let subject = "";
    let text = "";

    switch (newStatus) {
      case "pending":
        subject = `Pedido Recebido - Aguardando Pagamento #${order.order_id.slice(0, 8)}`;
        text = `Olá ${name}, recebemos seu pedido! Assim que o pagamento for confirmado, iniciaremos o processamento.`;
        break;
      case "approved":
        subject = `Pagamento Aprovado - Pedido #${order.order_id.slice(0, 8)}`;
        text = `Olá ${name}, seu pagamento foi confirmado! Estamos preparando seu pedido.`;
        break;
      case "sent":
        subject = `Pedido Enviado - Pedido #${order.order_id.slice(0, 8)}`;
        text = `Olá ${name}, seu pedido foi enviado! Em breve chegará até você.`;
        if (trackingCode)
          text += `\n Seu código de rastreio é: ${trackingCode}`;
        break;
      case "delivered":
        subject = `Pedido Entregue - Pedido #${order.order_id.slice(0, 8)}`;
        text = `Olá ${name}, seu pedido foi entregue.`;
        break;
      case "cancelled":
      case "rejected":
        subject = `Problema no Pedido #${order.order_id.slice(0, 8)}`;
        text = `Olá ${name}, houve um problema com seu pagamento ou o pedido foi cancelado.`;
        break;
      default:
        return;
    }

    try {
      await resend.emails.send({
        from: REMETENTE.pedidos,
        to: [email],
        subject: subject,
        html: `
        <div>
           <h2>${subject}</h2>
           <p>${text}</p>
           <hr/>
           <p><strong>Resumo do Pedido:</strong></p>
                    <p>Total: R$ ${Number(order.total_amount).toFixed(2)}</p>
                    <br/>
                    <a href="${URL_LOJA}/account">
                    Ver Meus Pedidos</a>
           </div>
      `,
      });
    } catch (err) {
      console.error("Erro na API Resend:", err);
    }

    /* const mailOptions = {
      from: '"Shopnaw Loja" <onboarding@resend.dev>', // <nao-responda@shopnaw.com>
      to: email,
      subject: subject,
      html: `
                <div style="font-family: Arial, sans-serif; color: #333;">
                    <h2>${subject}</h2>
                    <p>${text}</p>
                    <hr/>
                    <p><strong>Resumo do Pedido:</strong></p>
                    <p>Total: R$ ${Number(order.total_amount).toFixed(2)}</p>
                    <br/>
                    <a href="${URL_LOJA}/account" style="background: #000; color: #fff; padding: 10px 20px; text-decoration: none; border-radius: 5px;">Ver Meus Pedidos</a>
                </div>
            `,
    };

    await transporter.sendMail(mailOptions); */
    console.log(`📧 Email de status '${newStatus}' enviado para ${email}`);
  } catch (err) {
    console.error("Erro ao enviar email de status:", err);
  }
}

async function sendAdminNewOrderEmail(order) {
  try {
    // ADMIN_EMAIL nao existia no .env: `to: [undefined]` faz o Resend recusar
    // a chamada, e o dono da loja nunca era avisado de venda nenhuma.
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
          <p><strong>Valor Total:</strong> R$ ${Number(order.total_amount).toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}</p>
          <p><strong>Método de Pagamento:</strong> ${order.payment_method.toUpperCase()}</p>
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
