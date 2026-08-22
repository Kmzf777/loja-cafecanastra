"use strict";

/**
 * O ÚNICO lugar que decide avisar o cliente — e-mail e WhatsApp no mesmo gesto.
 *
 * POR QUE ENVOLVER, E NÃO DUPLICAR. Existem hoje SEIS chamadas de
 * `sendStatusEmail` espalhadas pelo backend, e cada uma tem uma guarda de
 * disparo DIFERENTE, construída com cuidado ao longo de meses:
 *
 *   C1 `OrderController.js:255`   — nenhuma
 *   C2 `PaymentController.js:987` — `statusAplicado` nulo quando o webhook venceu a corrida
 *   C3 `PaymentController.js:1227`— `if (mudou)`
 *   C4 `ClubeController.js:620`   — `if (mudou)`
 *   C5 `ClubeController.js:850`   — pedido novo, idempotência 23505
 *   C6 `blingPedidos.js:804`      — `rowCount === 1`
 *
 * `avisarCliente()` SUBSTITUI `sendStatusEmail()` nos seis lugares e herda as
 * seis guardas de graça. Pôr uma segunda chamada AO LADO de cada uma obrigaria
 * a reescrever cinco guardas corretamente cinco vezes — e a sexta (C1, que não
 * tem guarda nenhuma) continuaria mandando dois avisos a cada dois cliques no
 * painel. Envolver custa este arquivo; duplicar custaria cinco chances de errar
 * em lugares que hoje estão certos.
 *
 * ONDE NÃO ENGATAR, dito porque é o lugar mais tentador: dentro de
 * `ordersRepository.updateOrderStatus`. Ele roda DENTRO de transações abertas,
 * e notificar de lá seria rede dentro de transação e aviso enviado antes de um
 * COMMIT que ainda pode virar ROLLBACK.
 *
 * O CONTRATO: `avisarCliente` NUNCA LANÇA. É o mesmo contrato que
 * `sendStatusEmail` já cumpre (`emailSender.js:105-110`) e a razão é a mesma —
 * um pedido pago não pode virar erro porque o aviso não saiu. Os dois canais
 * são engolidos INDEPENDENTEMENTE: o e-mail não pode deixar de sair porque o
 * WhatsApp caiu, e vice-versa.
 *
 * O E-MAIL É CHAMADO SEMPRE, SEM CONDIÇÃO. Ele já tem os próprios recortes
 * (`conteudoDoStatus` devolve null para `em_processamento` e `autorizado`) e
 * não é papel deste wrapper decidir por ele. A guarda de status repetido daqui
 * vale só para o WhatsApp, e o motivo está no comentário de `jaAvisado()`.
 */

const pool = require("../pgPool");
const { sendStatusEmail } = require("../utils/emailSender");
const { conteudoDoStatusWhats } = require("../utils/whatsappMensagens");
const { paraE164, ultimosQuatro } = require("../utils/telefone");
const { carregar, gravar, configurado, avisoLigado } = require("./whatsappConfig");
const { enviarTemplate } = require("./whatsappClient");

/** Teto do que se guarda em `erro_texto`. A coluna é `text`, o log não é. */
const LIMITE_DO_ERRO = 500;

/**
 * O destinatário do WhatsApp, numa consulta só — o molde de
 * `sendStatusEmail:68-77`.
 *
 * `COALESCE(c.nome, 'Cliente')` NÃO É ENFEITE: os parâmetros do template vão
 * para a Graph API por `String(valor)` (`whatsappClient.js:enviarTemplate`), e
 * `String(null)` é a string "null". Um nome nulo mandaria "Olá, null." para o
 * cliente, num template que a Meta aprovou e que a loja paga para enviar.
 *
 * `pool.query` DIRETO, sem `pool.connect()` — a lição de `emailSender.js:60-63`:
 * pegar um cliente na mão e só devolvê-lo DEPOIS da query vaza a conexão toda
 * vez que a query lança, e o pool de 10 mingua a cada erro.
 */
async function destinatario(userId) {
  const { rows } = await pool.query(
    `SELECT COALESCE(c.nome, 'Cliente') AS nome,
            c.telefone, c.whatsapp_wa_id, c.whatsapp_optin_em, c.whatsapp_optout_em
       FROM canastra.clientes c
      WHERE c.user_id = $1::uuid`,
    [userId],
  );
  return rows[0] || null;
}

/**
 * Este pedido já recebeu ESTE template? É a guarda de status repetido, e ela
 * mora aqui para valer para os seis call sites de uma vez — C1 não tem guarda
 * nenhuma, e dois cliques no painel viram dois avisos.
 *
 * POR QUE ELA NÃO ALCANÇA O E-MAIL: a única prova de "já avisei" que existe é
 * a linha desta tabela, e ela só nasce quando o WhatsApp de fato tentou.
 * Cliente sem telefone, com opt-out, ou integração desligada (o estado de toda
 * instalação até alguém ligar no painel) nunca geram linha nenhuma. Guardar o
 * e-mail por aqui entregaria uma deduplicação que funciona para uns clientes e
 * não para outros, e que evapora justamente quando o WhatsApp está fora.
 *
 * `status <> 'falhou'` DE PROPÓSITO: uma queda da Meta não pode trancar o aviso
 * para sempre. Sem essa exclusão, o primeiro 131026 silenciaria aquele pedido
 * em definitivo.
 *
 * A chave é PEDIDO + TEMPLATE, e não pedido + status, porque 'enviado' tem dois
 * templates (`pedido_enviado` e `pedido_enviado_sem_rastreio`): o pedido que sai
 * sem código e ganha o rastreio depois PRECISA do segundo aviso.
 */
async function jaAvisado(pedidoId, template) {
  const { rows } = await pool.query(
    `SELECT 1
       FROM canastra.whatsapp_mensagens
      WHERE pedido_id = $1::uuid
        AND template = $2
        AND status <> 'falhou'
      LIMIT 1`,
    [pedidoId, template],
  );
  return rows.length > 0;
}

/**
 * Tira de um texto estranho o que não pode ser gravado.
 *
 * O cabeçalho de 0017 promete que TELEFONE COMPLETO mora em `clientes.telefone`
 * e em lugar nenhum mais — guardá-lo fora dali abriria um segundo elo a manter
 * na redação da LGPD para sempre. `whatsappClient.js:redigir` já limpa o que
 * vem da Meta, mas `erro_texto` também recebe erro de runtime, que ninguém
 * escreveu pensando nisso. O corte em oito dígitos deixa passar código de erro
 * (seis) e HTTP, que é o que precisa sobreviver para a linha ser diagnóstica.
 */
function semDadoPessoal(texto) {
  return String(texto ?? "")
    .replace(/\+?\d{8,}/g, "[numero]")
    .slice(0, LIMITE_DO_ERRO);
}

/**
 * Os erros que são da INTEGRAÇÃO, e não de uma mensagem.
 *
 * 190    = OAuth inválido (token revogado, expirado, ou app removido)
 * 200    = permissão faltando no token
 * 10     = a app não tem permissão para esta ação
 * 131031 = a conta foi bloqueada pela política da Meta
 *
 * Os quatro dizem a mesma coisa: NENHUMA mensagem vai sair até um humano
 * trocar a credencial. Continuar tentando queima cota da API, enche o log, e a
 * loja só descobre quando um cliente reclama.
 *
 * O QUE NÃO ESTÁ AQUI, E POR QUÊ: 131026 ("aquele número não recebe"), 131047
 * ("fora da janela"), 131000 ("algo deu errado") e 132001 ("template não
 * encontrado") são problemas de UMA mensagem, de UM destinatário ou de UM
 * template. Desligar a loja inteira por causa de um número errado seria a cura
 * pior que a doença: um cadastro com o telefone trocado silenciaria os avisos
 * de TODOS os outros clientes.
 *
 * A LISTA É FECHADA de propósito, e não "qualquer erro 4xx": erro novo da Meta
 * que ninguém mapeou tem de manter a loja funcionando, porque o custo de errar
 * para o lado de desligar é maior que o de tentar uma vez a mais.
 */
const ERROS_QUE_DESLIGAM = Object.freeze([190, 200, 10, 131031]);

/**
 * Desliga a integração e deixa escrito por quê.
 *
 * NUNCA LANÇA, e o `try` é o ponto: gravar a configuração é uma SEGUNDA ida ao
 * banco, e ela pode falhar sozinha (banco reiniciando, constraint). Se essa
 * falha subisse, ela derrubaria junto o `catch` que acabou de registrar a falha
 * da MENSAGEM — a loja perderia as duas coisas, e o log ficaria com o erro do
 * Postgres no lugar do erro da Meta, que é o diagnóstico de verdade.
 *
 * `gravar()` INVALIDA O CACHE, e é isso que faz o desligamento valer já para o
 * próximo pedido, sem restart. Falhando a gravação, o cache também não é
 * mexido: o processo continua achando que está ligado, que é a verdade sobre o
 * que está no banco. Um cache "desligado" com o banco dizendo "ligado" faria o
 * painel discordar de si mesmo até o restart.
 */
async function desligarPorCredencialMorta(codigo, motivo) {
  try {
    await gravar({ ativo: false, ultimo_erro: motivo, desligado_em: new Date() });
  } catch (erro) {
    console.error(
      `⚠️  WHATSAPP: a Meta recusou a credencial (código ${codigo}) e NÃO foi ` +
        `possível desligar a integração no banco (código ${erro.code || "?"}). ` +
        "O bot vai continuar tentando e falhando a cada pedido — desligue a " +
        "integração no painel até trocar a credencial.",
    );
    return;
  }

  // GRITA A CONSEQUÊNCIA, e não o código: quem lê este log precisa saber o que
  // parou de acontecer na loja, no espírito de `blingClient.js:157-166`. Um
  // "erro 190" sozinho não diz a ninguém que os clientes pararam de ser
  // avisados.
  console.error(
    `⚠️  WHATSAPP DESLIGADO AUTOMATICAMENTE: a Meta recusou a credencial ` +
      `(código ${codigo}). O bot PAROU — nenhum cliente receberá aviso de ` +
      "pedido por WhatsApp até alguém trocar a credencial e religar a " +
      "integração no painel (Dashboard → WhatsApp). O e-mail continua saindo " +
      `normalmente. Motivo registrado: ${motivo}`,
  );
}

/**
 * O aviso de status no WhatsApp, com todos os silêncios legítimos na frente.
 *
 * SILÊNCIO É SILÊNCIO: nenhum dos `return` abaixo loga erro. Cliente sem
 * telefone é o caso comum de quem tem conta antiga, e integração desligada é o
 * estado padrão da loja — transformar isso em ruído de log faria o erro de
 * verdade desaparecer no meio.
 *
 * A ORDEM É DO MAIS BARATO PARA O MAIS CARO, e não é só economia: com a
 * integração desligada não se toca no banco, então uma loja que nunca ligou o
 * WhatsApp não paga uma query por mudança de status.
 */
async function enviarWhatsappDeStatus(order, novoStatus, rastreio) {
  if (!order?.user_id) return;

  const cfg = await carregar();
  if (!configurado(cfg)) return;

  // Cobre também `em_processamento`, `autorizado` e qualquer status
  // desconhecido: eles não têm interruptor, e status sem interruptor não avisa
  // ninguém (`whatsappConfig.js:avisoLigado`).
  if (!avisoLigado(cfg, novoStatus)) return;

  const cliente = await destinatario(order.user_id);
  if (!cliente) return;

  // A PROVA DE CONSENTIMENTO, E ELA VEM ANTES DO DESTINO.
  //
  // O cabeçalho de 0017 promete, com todas as letras, que "sem carimbo o bot
  // nao manda, que e a falha para o lado seguro". Até a 0020 aquilo era só uma
  // frase: esta consulta lia `telefone`, `whatsapp_wa_id` e
  // `whatsapp_optout_em`, e o carimbo nunca. A promessa não mordia por acidente
  // — todo escritor de `telefone` carimbava junto —, mas `authenticated`
  // CONTINUA com `UPDATE (…, telefone, …)` em `clientes` pela lista de 0018 e
  // NÃO tem `UPDATE` em `whatsapp_optin_em`. Um `PATCH` do PostgREST, ou a tela
  // de perfil que ainda vai existir, grava um número SEM carimbo nenhum — e o
  // bot escrevia para ele.
  //
  // O ônus de provar que o consentimento existiu é do controlador (LGPD, Art. 8
  // § 2º). Um envio que não confere o carimbo não tem o que apresentar.
  //
  // A GUARDA VEM ANTES DE RESOLVER O DESTINO, e não dentro do ramo do telefone,
  // porque `whatsapp_wa_id` é um segundo caminho até o mesmo aparelho: presa ao
  // ramo do telefone, ela deixaria passar quem já respondeu ao bot uma vez — e
  // é exatamente quem a loja tem como alcançar.
  //
  // A SEGUNDA TRANCA DEFENSÁVEL, e por que ela não está aqui: tirar `telefone`
  // da lista de `GRANT UPDATE` de 0018 fecharia o buraco na origem, e não só na
  // saída. Fica de fora porque quebraria a tela de perfil que ainda não existe
  // (hoje o número só entra por `registrar_optin_whatsapp`, que carimba junto),
  // e essa é decisão do dono da loja, não deste arquivo.
  if (!cliente.whatsapp_optin_em) return;

  // Não existe STOP nativo no WhatsApp: a Meta não intercepta texto nenhum.
  // Parar de mandar é inteiramente responsabilidade da loja, e é esta coluna.
  if (cliente.whatsapp_optout_em) return;

  // O wa_id VENCE o telefone digitado: depois da primeira resposta do cliente
  // ele é a chave canônica, porque no Brasil a própria Cloud API pode ter
  // mexido no nono dígito (ver o cabeçalho de `utils/telefone.js`).
  const destino = cliente.whatsapp_wa_id || paraE164(cliente.telefone);
  if (!destino) return;

  // Defesa em profundidade contra os dois mapas divergirem: hoje
  // `INTERRUPTOR_DO_STATUS` e o `switch` de `conteudoDoStatusWhats` cobrem
  // exatamente os mesmos status, então este `null` é inalcançável. No dia em
  // que alguém acrescentar um interruptor sem o template, sem esta linha o
  // envio sairia com `template: undefined` e a Meta responderia 132001.
  const conteudo = conteudoDoStatusWhats(novoStatus, order, cliente.nome, rastreio);
  if (!conteudo) return;

  if (await jaAvisado(order.order_id, conteudo.template)) return;

  // A LINHA NASCE ANTES DO ENVIO. Se o processo morrer no meio da chamada à
  // Meta, fica um 'pendente' visível no painel — que é a verdade ("pode ter
  // saído, não sei"). Gravar depois deixaria a mensagem enviada sem rastro
  // nenhum, e é o rastro que o webhook de status procura para casar o wamid.
  //
  // E É POR ISSO QUE A FALHA DESTE INSERT CANCELA O ENVIO (ela sobe para o
  // `catch` de `avisarCliente`, que loga): mandar sem rastro deixaria a guarda
  // de repetido cega e o webhook sem onde casar o wamid. Um aviso a menos custa
  // menos que um aviso que ninguém consegue explicar depois.
  //
  // SÓ OS QUATRO ÚLTIMOS DÍGITOS, nunca o número: 0017 recusa telefone completo
  // em tabela nova de propósito.
  const { rows } = await pool.query(
    `INSERT INTO canastra.whatsapp_mensagens
       (pedido_id, user_id, telefone_final, template, status)
     VALUES ($1::uuid, $2::uuid, $3, $4, 'pendente')
     RETURNING id`,
    [order.order_id, order.user_id, ultimosQuatro(destino), conteudo.template],
  );
  const id = rows[0].id;

  try {
    const { wamid } = await enviarTemplate(cfg, { para: destino, ...conteudo });
    await pool.query(
      `UPDATE canastra.whatsapp_mensagens
          SET status = 'enviada', wamid = $2, enviado_em = now(), atualizado_em = now()
        WHERE id = $1::uuid`,
      [id, wamid],
    );
  } catch (erro) {
    // A FALHA VIRA LINHA, não exceção: quem chamou está no meio de um pedido
    // pago. `erro_codigo` é o `error.code` da Meta (131026, 190...), que é o
    // que distingue "o cliente bloqueou" de "o token venceu" — e, portanto, o
    // que decide se repetir adianta.
    //
    // `Number.isInteger` porque a coluna é `integer`: um `codigo` que a Meta
    // devolvesse como string faria o UPDATE morrer em 22P02 e trocaria o
    // registro da falha por uma segunda falha, mais obscura.
    const codigo = Number.isInteger(erro?.codigo) ? erro.codigo : null;
    const motivo = semDadoPessoal(erro?.message);
    await pool.query(
      `UPDATE canastra.whatsapp_mensagens
          SET status = 'falhou', erro_codigo = $2, erro_texto = $3, atualizado_em = now()
        WHERE id = $1::uuid`,
      [id, codigo, motivo],
    );
    // O rastro fica no banco, mas o log é o que alguém está olhando quando
    // reclamam de aviso que não chegou. Código e pedido, nunca telefone.
    console.warn(
      `WhatsApp: aviso de '${novoStatus}' não saiu para o pedido ` +
        `${String(order.order_id).slice(0, 8)} (código ${codigo ?? "?"}).`,
    );

    // POR ÚLTIMO, e depois de a falha da mensagem já estar gravada: o
    // desligamento é política POR CIMA do rastro, nunca no lugar dele. Se a
    // ordem se invertesse, um erro na gravação da configuração deixaria a
    // mensagem eternamente 'pendente' — e 'pendente' significa "pode ter
    // saído", que é a resposta errada para um envio que sabidamente falhou.
    //
    // O MESMO `motivo` da coluna `erro_texto`, e não `erro.message` cru: as
    // duas colunas guardam a mesma frase da Meta, e é `semDadoPessoal()` que
    // garante que nenhuma das duas carregue número de telefone.
    if (ERROS_QUE_DESLIGAM.includes(codigo)) {
      await desligarPorCredencialMorta(codigo, motivo);
    }
  }
}

/**
 * Avisa o cliente que o pedido mudou de status, pelos dois canais.
 *
 * Substitui `sendStatusEmail` nos seis call sites — mesma assinatura, de
 * propósito, para a troca ser mecânica e não uma reescrita de cada guarda.
 *
 * DOIS `try` SEPARADOS, e não um só: com um único bloco, o e-mail que lançasse
 * pularia o WhatsApp inteiro. `sendStatusEmail` promete não lançar
 * (`emailSender.js:105-110`), mas "promete" não é "impede" — um erro de
 * programação dentro dele (um `require` que falha, um campo que sumiu) sobe
 * como qualquer outro, e este wrapper é justamente o lugar onde o pedido pago
 * não pode virar 500.
 */
async function avisarCliente(order, novoStatus, trackingCode) {
  try {
    await sendStatusEmail(order, novoStatus, trackingCode);
  } catch (erro) {
    console.error("Erro ao avisar o cliente por e-mail:", erro);
  }

  try {
    await enviarWhatsappDeStatus(order, novoStatus, trackingCode);
  } catch (erro) {
    // Banco fora, `order` malformado, qualquer coisa: o aviso é efeito
    // colateral. O motivo fica no log — silêncio aqui foi o que deixou meses de
    // e-mails não enviados passarem despercebidos (`emailSender.js:105-110`).
    console.error("Erro ao avisar o cliente por WhatsApp:", erro);
  }
}

module.exports = { avisarCliente };
