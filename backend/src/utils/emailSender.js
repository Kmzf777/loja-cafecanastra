const { REMETENTE, EMAIL_ADMIN, NOME_LOJA, URL_LOJA } = require("../config/remetente");
const pool = require("../pgPool");
const resend = require("../config/mailer");
const { escaparHtml } = require("./escaparHtml");

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

/**
 * O AVISO QUE PEDE DECISÃO: uma cobrança do Clube virou pedido SEM o café ter
 * saído da prateleira (estoque insuficiente na hora do débito, ou o SKU saiu
 * do catálogo). O dinheiro já saiu do cliente e o pedido nasce 'aprovado' —
 * então o e-mail rotineiro de "Novo Pedido Recebido" seria indistinguível de
 * um pedido com o café separado, que é exatamente como o rombo passava
 * despercebido. Assunto próprio, SKU e quantidade no corpo, e as duas saídas
 * possíveis ditas com todas as letras: torrar/separar, ou estornar no MP.
 *
 * Engole erro como os outros senders do arquivo: a cobrança já aconteceu e o
 * pedido já está gravado — o provedor de e-mail fora não pode virar retry do
 * webhook do Mercado Pago. O rombo, de qualquer forma, já está gritado no log
 * do ClubeController.
 */
async function sendAdminClubeSemEstoqueEmail({ pedido, sku, quantidade, motivo }) {
  try {
    const numero = String(pedido?.order_id || "").slice(0, 8);
    const subject = `⚠️ Clube: cobrança sem estoque — pedido #${numero} precisa de decisão`;

    await resend.emails.send({
      from: REMETENTE.sistema,
      to: [EMAIL_ADMIN],
      subject,
      html: `
        <div style="font-family: Arial, sans-serif; color: #333;">
          <h2 style="color: #b71c1c;">Cobrança do Clube sem café separado</h2>
          <p>
            Uma cobrança recorrente do Clube da Canastra foi debitada e virou
            pedido, mas o estoque <strong>não</strong> foi baixado. O pedido
            existe (o dinheiro já saiu do cliente) e está esperando uma decisão
            sua.
          </p>
          <hr/>
          <p><strong>Pedido:</strong> ${escaparHtml(String(pedido?.order_id || "—"))}</p>
          <p><strong>SKU:</strong> ${escaparHtml(String(sku || "—"))}</p>
          <p><strong>Quantidade do envio:</strong> ${Number(quantidade) || 0}</p>
          <p><strong>Motivo:</strong> ${escaparHtml(String(motivo || "Baixa de estoque não aplicada."))}</p>
          <hr/>
          <p>
            Duas saídas: <strong>separar/torrar o café</strong> e acertar o
            estoque no painel, ou <strong>estornar a cobrança</strong> no painel
            do Mercado Pago (o pedido então volta a 'reembolsado' pelo webhook).
          </p>
          <a href="${URL_LOJA}/dashboard/orders" style="background-color: #000; color: #fff; padding: 12px 20px; text-decoration: none; border-radius: 5px; display: inline-block; font-weight: bold;">
            Abrir o painel de pedidos
          </a>
        </div>
      `,
    });
    console.log(
      `📧 Alerta do Clube (cobrança sem estoque) enviado para o Admin (${EMAIL_ADMIN}).`,
    );
  } catch (err) {
    console.error("Erro na API Resend (alerta do Clube):", err);
  }
}

/**
 * O corpo do lembrete de carrinho abandonado, PURO — separado do envio para o
 * teste afirmar assunto e conteúdo sem tocar o Resend.
 *
 * O tom segue estetica.md §11: direto, concreto, sem urgência fabricada — nada
 * de "só hoje!", contador ou desconto surpresa. SEM `<img>` de propósito: pixel
 * de rastreio em e-mail de lembrete é vigilância que a loja não faz, e imagem
 * externa quebrada é a primeira coisa que um cliente de e-mail bloqueia.
 *
 * O rodapé diz POR QUE o e-mail chegou (transparência exigida pela LGPD para
 * comunicação não solicitada) e aponta a conta como o lugar de parar: esvaziar
 * a sacola encerra os lembretes — é um por EPISÓDIO de abandono, por desenho
 * (a compra reabre o ciclo; ver 0011) — e excluir a conta encerra tudo.
 */
function conteudoDoLembreteDeCarrinho({ nome, itens }) {
  // `nome` e `item.nome` são texto do CLIENTE (cadastro e cópia da sacola) —
  // escapados sempre, porque nome é dado e nunca marcação (ver escaparHtml).
  const linhas = (Array.isArray(itens) ? itens : [])
    .map(
      (item) =>
        `<li>${Number(item.quantidade)}× ${escaparHtml(item.nome || "Café")}</li>`,
    )
    .join("\n           ");

  return {
    subject: "Seu café ainda está na sacola",
    html: `
        <div>
           <p>Olá ${escaparHtml(nome || "Cliente")},</p>
           <p>Você deixou estes itens na sacola:</p>
           <ul>
           ${linhas}
           </ul>
           <p><a href="${URL_LOJA}/sacola">Ver minha sacola</a></p>
           <hr/>
           <p style="font-size:12px">
             Você recebeu este aviso porque entrou na sua conta do ${NOME_LOJA}
             e ficou com itens na sacola. É um lembrete único — não vamos
             insistir. A sacola fica guardada na sua conta: entre na sua conta
             para ver sua sacola, neste ou em qualquer aparelho. Para
             gerenciar sua conta (ou excluí-la), acesse
             <a href="${URL_LOJA}/account">${URL_LOJA}/account</a>.
           </p>
        </div>
      `,
  };
}

/**
 * Envia o lembrete de carrinho abandonado.
 *
 * DIFERENTE dos outros senders deste arquivo, este NÃO engole erro — lança.
 * O motivo é o contrato com o job (jobs/carrinhoAbandonado.js): a marca
 * `lembrete_enviado_em` é gravada na MESMA transação do envio, e o ROLLBACK
 * dela depende de a falha CHEGAR lá. Um catch aqui gravaria "lembrado" sem
 * e-mail nenhum ter saído — exatamente a falha silenciosa que os e-mails de
 * status tiveram por meses.
 */
async function sendCartReminderEmail({ email, nome, itens }) {
  const conteudo = conteudoDoLembreteDeCarrinho({ nome, itens });
  const { error } = await resend.emails.send({
    from: REMETENTE.pedidos,
    to: [email],
    subject: conteudo.subject,
    html: conteudo.html,
  });
  // O SDK do Resend resolve com { error } em vez de lançar; para o job, os
  // dois significam o mesmo "não saiu".
  if (error) {
    throw new Error(`Resend recusou o lembrete para ${email}: ${error.message || error}`);
  }
  console.log(`📧 Lembrete de sacola enviado para ${email}`);
}

module.exports = {
  sendStatusEmail,
  sendAdminNewOrderEmail,
  sendAdminClubeSemEstoqueEmail,
  sendCartReminderEmail,
  conteudoDoLembreteDeCarrinho,
};
