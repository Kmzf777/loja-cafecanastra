"use strict";

/**
 * Os avisos de pedido no WhatsApp — o mapa dos templates e a tradução de
 * status em template.
 *
 * Fora da janela de atendimento de 24 horas, a Cloud API só entrega
 * `message_template` previamente APROVADO pela Meta. O aviso de pedido nunca
 * cai nessa janela por sorte, então cada aviso é, obrigatoriamente, um
 * template aprovado — e não texto montado na hora.
 *
 * ESTE MAPA É A FONTE ÚNICA desses textos: o painel cria na Meta exatamente o
 * que está aqui, e o serviço de envio dispara lendo daqui. Duas listas
 * divergindo não dariam erro nenhum — dariam um template aprovado que ninguém
 * dispara, ou um disparo de template que não existe (a Meta responde 132001 e
 * o cliente fica sem aviso).
 *
 * NÃO ESCREVA FRASE DE VENDA EM NENHUM CORPO. Estes sete são templates de
 * UTILIDADE, e uma frase de venda os reclassifica para MARKETING — o exemplo
 * literal da Meta do que vira marketing é "an order update with a promo".
 * Reclassificar multiplica o preço por cerca de nove e, pior, "template
 * misclassification" é motivo explícito de bloqueio de envio na escada de
 * punição da Meta. O teste `whatsapp_conteudo.test.js` procura palavra de
 * venda nos corpos justamente porque a tentação é óbvia demais para depender
 * de quem editar o texto lembrar.
 *
 * As regras de formatação da Meta (variável pendurada, variáveis coladas,
 * limite de corpo e rodapé, ordem dos botões) também estão afirmadas naquele
 * teste, e não em comentário: violá-las reprova o template na REVISÃO DELA,
 * até 24 horas depois de submetido, e o motivo só aparece lá.
 */

/**
 * A origem pública da loja — a MESMA que os links dos e-mails usam
 * (`emailSender.js` aponta `${URL_LOJA}/account` com o valor que sai daqui).
 *
 * Uma fonte só, e não uma segunda env: dois valores que precisam concordar e
 * que ninguém confere divergem no dia em que o domínio mudar, e a divergência
 * aqui é a mais cara de todas (ver `BOTAO_RASTREIO`).
 */
const { URL_LOJA } = require("../config/remetente");

/** O único idioma cadastrado na Meta para esta loja. */
const IDIOMA = "pt_BR";

/** Rodapé de todos: curto (o limite é 60) e sem variável — a Meta recusa. */
const RODAPE = "Café Canastra";

/**
 * O quick-reply que abre a janela de atendimento de 24 horas. Sem ele, o
 * cliente que precisa de ajuda não tem por onde começar sem sair do WhatsApp
 * — e, enquanto a janela não abre, a loja só consegue falar por template.
 */
const BOTAO_AJUDA = Object.freeze({ type: "QUICK_REPLY", text: "Preciso de ajuda" });

/**
 * O botão de rastreio. A Meta aceita UMA variável no botão de URL e só no
 * FIM da URL — daí o código entrar como sufixo de `?codigo=`, e não no meio
 * do caminho. O `example` é exigido na criação do template.
 *
 * ESTA URL É CONGELADA NA APROVAÇÃO DO TEMPLATE, e é o que a torna diferente
 * de qualquer outro link do projeto: depois que a Meta aprova, o botão aponta
 * para onde apontava — mudar exige APAGAR o template, recriar e esperar nova
 * revisão (até 24h), com o aviso de envio fora do ar nesse meio-tempo. Errar
 * aqui não dá erro em lugar nenhum; aparece como 404 no telefone do cliente.
 *
 * Por isso ela sai de `URL_LOJA` e NÃO de uma string escrita à mão. O destino
 * é `/rastreio` da vitrine (`frontend/app/(vitrine)/rastreio/`), uma página
 * pública: exigir login para saber onde está o café seria fricção no exato
 * ponto em que a pessoa só quer uma informação.
 */
const BOTAO_RASTREIO = Object.freeze({
  type: "URL",
  text: "Rastrear pedido",
  url: `${URL_LOJA}/rastreio?codigo={{1}}`,
  example: Object.freeze(["AA123456789BR"]),
});

/**
 * Os sete corpos. Cada entrada tem `corpo`, `rodape`, `botoes` e
 * `parametros` — este último é nome do parâmetro → valor de EXEMPLO, porque a
 * Meta recusa a criação de um template cujo corpo tem variável sem exemplo.
 * É o que o painel manda em `body_text_named_params`.
 *
 * Todo corpo começa com "Olá, " e termina em texto fixo de propósito:
 * "dangling parameters are not allowed" — corpo que começa ou termina em
 * variável volta REJECTED.
 *
 * `pedido_enviado_sem_rastreio` existe porque o painel permite mudar o pedido
 * para 'enviado' sem digitar o código; sem esse gêmeo, o aviso sairia
 * prometendo um código que não existe.
 */
const TEMPLATES = Object.freeze({
  pedido_recebido: Object.freeze({
    corpo:
      "Olá, {{nome_cliente}}. Recebemos seu pedido {{numero_pedido}}. Assim que o pagamento for confirmado, começamos o preparo do seu café.",
    rodape: RODAPE,
    botoes: Object.freeze([BOTAO_AJUDA]),
    parametros: Object.freeze({ nome_cliente: "Ana", numero_pedido: "3f2504e0" }),
  }),

  pagamento_aprovado: Object.freeze({
    corpo:
      "Olá, {{nome_cliente}}. O pagamento do pedido {{numero_pedido}} foi confirmado e já estamos preparando seu café.",
    rodape: RODAPE,
    botoes: Object.freeze([BOTAO_AJUDA]),
    parametros: Object.freeze({ nome_cliente: "Ana", numero_pedido: "3f2504e0" }),
  }),

  pedido_enviado: Object.freeze({
    corpo:
      "Olá, {{nome_cliente}}. Seu pedido {{numero_pedido}} saiu para entrega. O código de rastreio é {{codigo_rastreio}}, e você acompanha pelo botão abaixo.",
    rodape: RODAPE,
    // O URL vem ANTES do quick-reply: a Meta recusa quick-reply intercalado
    // com botão de outro tipo ("URL, QR" é válido; "QR, URL, QR" não é).
    botoes: Object.freeze([BOTAO_RASTREIO, BOTAO_AJUDA]),
    parametros: Object.freeze({
      nome_cliente: "Ana",
      numero_pedido: "3f2504e0",
      codigo_rastreio: "AA123456789BR",
    }),
  }),

  pedido_enviado_sem_rastreio: Object.freeze({
    corpo:
      "Olá, {{nome_cliente}}. Seu pedido {{numero_pedido}} saiu para entrega. Assim que o código de rastreio estiver disponível, enviamos aqui.",
    rodape: RODAPE,
    botoes: Object.freeze([BOTAO_AJUDA]),
    parametros: Object.freeze({ nome_cliente: "Ana", numero_pedido: "3f2504e0" }),
  }),

  pedido_entregue: Object.freeze({
    corpo:
      "Olá, {{nome_cliente}}. Seu pedido {{numero_pedido}} foi entregue. Se algo não estiver certo, fale com a gente pelo botão abaixo.",
    rodape: RODAPE,
    botoes: Object.freeze([BOTAO_AJUDA]),
    parametros: Object.freeze({ nome_cliente: "Ana", numero_pedido: "3f2504e0" }),
  }),

  pedido_cancelado: Object.freeze({
    corpo:
      "Olá, {{nome_cliente}}. Houve um problema com o pagamento do pedido {{numero_pedido}} e ele não seguiu adiante.",
    rodape: RODAPE,
    botoes: Object.freeze([BOTAO_AJUDA]),
    parametros: Object.freeze({ nome_cliente: "Ana", numero_pedido: "3f2504e0" }),
  }),

  pedido_reembolsado: Object.freeze({
    corpo:
      "Olá, {{nome_cliente}}. O valor do pedido {{numero_pedido}} foi devolvido. O prazo para aparecer na fatura depende do seu banco.",
    rodape: RODAPE,
    botoes: Object.freeze([BOTAO_AJUDA]),
    parametros: Object.freeze({ nome_cliente: "Ana", numero_pedido: "3f2504e0" }),
  }),
});

/**
 * Guarda da regra "dangling parameters are not allowed": corpo que começa ou
 * termina em variável volta REJECTED da revisão da Meta, até 24h depois.
 */
function corpoSemVariavelPendurada(corpo) {
  const texto = String(corpo).trim();
  return !texto.startsWith("{{") && !texto.endsWith("}}");
}

/** Monta o retorno; `botaoUrl` só existe quando o template tem botão de URL. */
function aviso(template, parametros, botaoUrl = null) {
  return { template, idioma: IDIOMA, parametros, botaoUrl };
}

/**
 * Qual template avisa este status, e com quais valores — ou `null` quando o
 * status não avisa ninguém.
 *
 * O RECORTE É O MESMO DO E-MAIL (`emailSender.js`, `conteudoDoStatus`):
 * `em_processamento` e `autorizado` ficam em silêncio de propósito. São
 * estados intermediários do gateway, e avisar "seu pagamento está em análise"
 * a cada oscilação só gera ansiedade e chamado de suporte — no WhatsApp,
 * ainda custa dinheiro por mensagem. Status desconhecido também cai no
 * `null`: quem chama não dispara nada.
 *
 * `numero_pedido` é o mesmo recorte de 8 caracteres que o e-mail usa, para o
 * cliente que recebeu os dois ver o MESMO número nos dois canais.
 */
function conteudoDoStatusWhats(status, order, nome, rastreio) {
  const base = { nome_cliente: nome, numero_pedido: order.order_id.slice(0, 8) };

  switch (status) {
    case "pendente":
      return aviso("pedido_recebido", base);
    case "aprovado":
      return aviso("pagamento_aprovado", base);
    case "enviado":
      // Sem código não existe o que rastrear: outro template, e nenhum botão
      // de URL — o aviso ainda sai, só não promete o que não tem.
      return rastreio
        ? aviso(
            "pedido_enviado",
            { ...base, codigo_rastreio: rastreio },
            // A Meta exige percent-encoding do que entra na variável de URL.
            encodeURIComponent(rastreio),
          )
        : aviso("pedido_enviado_sem_rastreio", base);
    case "entregue":
      return aviso("pedido_entregue", base);
    case "cancelado":
    case "rejeitado":
      return aviso("pedido_cancelado", base);
    case "reembolsado":
      return aviso("pedido_reembolsado", base);
    default:
      return null;
  }
}

module.exports = {
  TEMPLATES,
  /**
   * O idioma sai daqui em vez de a string ser repetida no painel: o envio de
   * TESTE precisa mandar exatamente o mesmo `language.code` que o aviso de
   * verdade manda, senão ele exercita um caminho que a loja não usa — e um
   * teste que passa contra um template que não existe não prova nada.
   */
  IDIOMA,
  conteudoDoStatusWhats,
  corpoSemVariavelPendurada,
};
