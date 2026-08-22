"use strict";

/**
 * A PORTA DE ENTRADA DO WEBHOOK DA META, e o roteador do menu de suporte.
 *
 * Quatro perguntas de PORTA são respondidas aqui: esta requisição veio mesmo da
 * Meta (assinatura)? a Meta está tentando assinar o webhook (verificação)? este
 * evento já passou por aqui (deduplicação)? e o que exatamente o cliente mandou
 * (classificação)? As quatro funções que as respondem são PURAS e exportadas —
 * é onde a decisão de segurança acontece, e é o que permite testá-las sem
 * servidor e sem banco.
 *
 * `rotearMensagem` é a quinta, e essa toca o banco e a Graph API: ela é o que
 * acontece DEPOIS da porta, quando um cliente escreve. O transporte continua
 * fora daqui (`whatsappClient.js`), como a regra de aviso de status continua em
 * `notificacoes.js`.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * O EXEMPLO DE CÓDIGO PUBLICADO PELA PRÓPRIA META É INSEGURO, E NÃO FOI
 * COPIADO. Ele tem duas falhas, e as duas são reais:
 *
 *   1. quando o cabeçalho `X-Hub-Signature-256` está AUSENTE, ele só faz
 *      `console.warn` e DEIXA A REQUISIÇÃO PASSAR. Um atacante omite o
 *      cabeçalho e o bypass é total — não precisa forjar hash nenhum.
 *   2. compara os hashes com `!=`, que sai no primeiro byte diferente e
 *      vaza, pelo tempo de resposta, quanto do hash ele já acertou.
 *
 * Aqui: sem cabeçalho, RECUSA; e a comparação é `crypto.timingSafeEqual`, com
 * a conferência de comprimento ANTES (ela lança se os tamanhos diferirem).
 *
 * ────────────────────────────────────────────────────────────────────────────
 * O WAMID NÃO ENTRA EM LOG NENHUM. `wamid.HBgNNTUzMTk5...` parece opaco, mas o
 * miolo em base64 decodifica para o TELEFONE DO CLIENTE em texto claro. Logar
 * um wamid é escrever telefone de cliente em disco sem ninguém ter digitado
 * `console.log(telefone)` — exatamente o que `whatsappClient.js` evita ao não
 * despejar o corpo da resposta da Meta no console.
 */

const crypto = require("node:crypto");

const pool = require("../pgPool");
const whatsappConfig = require("../services/whatsappConfig");
const whatsappCliente = require("../services/whatsappClient");
const { paraE164, variantesBrasil, ultimosQuatro } = require("../utils/telefone");
const { TEMPLATES, IDIOMA } = require("../utils/whatsappMensagens");

/** O cabeçalho da assinatura. Node entrega nome de cabeçalho em minúsculas. */
const CABECALHO_DA_ASSINATURA = "x-hub-signature-256";

/** O único prefixo aceito. `sha1=` é do webhook legado e não vale aqui. */
const PREFIXO = "sha256=";

/**
 * O único `field` que interessa. A mesma assinatura carrega avisos de
 * aprovação de template, de qualidade do número e de limite de conta; nenhum
 * deles é conversa com cliente e nenhum deles tem wamid.
 */
const CAMPO_DE_CONVERSA = "messages";

/* ------------------------------------------------------------------------- *
 * As quatro funções puras
 * ------------------------------------------------------------------------- */

/**
 * Compara dois segredos sem vazar, pelo tempo, quanto deles bate.
 *
 * Compara os DIGESTS e não os valores: assim os dois lados têm sempre 32
 * bytes, `timingSafeEqual` nunca lança por comprimento diferente e o
 * COMPRIMENTO do segredo também não vaza. Vale para o `verify_token`, que é
 * escolhido pelo gestor e pode ter qualquer tamanho.
 */
function iguaisEmTempoConstante(a, b) {
  if (typeof a !== "string" || typeof b !== "string") return false;
  if (a.length === 0 || b.length === 0) return false;
  const da = crypto.createHash("sha256").update(a, "utf8").digest();
  const db = crypto.createHash("sha256").update(b, "utf8").digest();
  return crypto.timingSafeEqual(da, db);
}

/**
 * Uma lista, ou uma lista vazia — nunca uma exceção.
 *
 * `?? []` NÃO BASTA: ele só cobre `null` e `undefined`, e `for...of` sobre um
 * objeto (`entry: {}`) ou um número lança `TypeError`. O corpo aqui vem
 * assinado, mas em desenvolvimento sem `app_secret` a assinatura não é
 * conferida — e um `TypeError` neste caminho vira 500 e reentrega da Meta.
 */
function comoLista(valor) {
  return Array.isArray(valor) ? valor : [];
}

/**
 * A requisição veio mesmo da Meta?
 *
 * `corpoCru` é o BUFFER que o `express.json({ verify })` de `index.js`
 * preservou — nunca `JSON.stringify(req.body)`. A Meta assina uma forma com
 * unicode ESCAPADO (`café`) e o `stringify` do V8 emite os caracteres
 * decodificados: bytes diferentes, HMAC diferente. O sintoma de reserializar é
 * um 401 que só aparece quando o cliente escreve com acento ou emoji, e esse é
 * o pior tipo de bug para diagnosticar.
 *
 * `ambiente` entra por PARÂMETRO (e não lido de `process.env` aqui dentro)
 * para o teste exercitar os dois lados sem mexer em variável global.
 */
function validarAssinatura(corpoCru, header, appSecret, ambiente) {
  if (!appSecret) {
    // O MESMO par de `PaymentController.js:220-230`: em produção RECUSA — um
    // webhook aberto é porta aberta —, em desenvolvimento aceita com aviso,
    // para não travar quem testa o fluxo local com o ngrok.
    if (ambiente === "production") {
      console.error("WhatsApp: app_secret não configurado — webhooks recusados em produção.");
      return false;
    }
    console.warn(
      "WhatsApp: app_secret ausente — assinatura do webhook NÃO conferida (só em desenvolvimento).",
    );
    return true;
  }

  // AQUI ESTÁ A PRIMEIRA FALHA DO EXEMPLO DA META: sem cabeçalho ele passa.
  // Cabeçalho repetido chega como array em alguns caminhos, e array não é
  // string — cai neste mesmo `return false`.
  if (typeof header !== "string" || !header.startsWith(PREFIXO)) return false;

  // Sem corpo não há o que conferir. `req.rawBody` é `undefined` quando o
  // `express.json` não rodou (Content-Type que não é JSON, por exemplo), e
  // assinar a string vazia daria um HMAC perfeitamente válido de nada.
  if (!corpoCru || corpoCru.length === 0) return false;

  const recebida = Buffer.from(header.slice(PREFIXO.length), "utf8");
  const esperada = Buffer.from(
    crypto.createHmac("sha256", appSecret).update(corpoCru).digest("hex"),
    "utf8",
  );

  // `timingSafeEqual` LANÇA se os comprimentos diferirem — a checagem vem
  // antes. (Um hash de tamanho errado já está errado; não há o que vazar.)
  if (recebida.length !== esperada.length) return false;
  return crypto.timingSafeEqual(recebida, esperada);
}

/**
 * O handshake do GET: a Meta chama uma vez, ao salvar a URL no painel dela.
 *
 * Devolve o desafio CRU, em string. Quem responder tem de mandar TEXTO PURO:
 * `res.json("1158201444")` põe ASPAS no corpo, a Meta compara byte a byte e o
 * handshake falha — é o erro clássico desta integração.
 *
 * SEM `verify_token` CONFIGURADO, RECUSA. Sem esta guarda, a comparação
 * ingênua `token === verifyToken` daria `true` para qualquer um enquanto o
 * campo estivesse vazio, porque `undefined === undefined`.
 */
function responderVerificacao({ modo, token, desafio } = {}, verifyToken) {
  if (modo !== "subscribe") return { status: 403 };
  if (!iguaisEmTempoConstante(token, verifyToken)) return { status: 403 };
  return { status: 200, corpo: String(desafio ?? "") };
}

/**
 * Os eventos do lote, na ordem, cada um já com a sua chave de deduplicação.
 *
 * ITERAR `entry[]` E `changes[]` É OBRIGATÓRIO: a Meta agrega até 1000 updates
 * numa chamada só e a documentação dela diz, com estas palavras, que "batching
 * cannot be guaranteed". `entry[0].changes[0]` é bug esperando acontecer — e o
 * sintoma seria perder silenciosamente o segundo evento de cada lote.
 *
 * NADA AQUI LANÇA diante de corpo malformado: uma exceção viraria 500, e 500
 * faz a Meta reentregar o mesmo lote quebrado por sete dias.
 */
function eventosDoWebhook(corpo) {
  if (corpo?.object !== "whatsapp_business_account") return [];

  const eventos = [];
  for (const entry of comoLista(corpo.entry)) {
    for (const change of comoLista(entry?.changes)) {
      if (change?.field !== CAMPO_DE_CONVERSA) continue;
      const valor = change.value ?? {};

      // MENSAGEM RECEBIDA: a chave é o wamid puro. Ele já é único por mensagem.
      //
      // O `valor` inteiro viaja junto porque o roteador precisa dele: é lá que
      // ficam `contacts[].wa_id` (o identificador do remetente, repetido pela
      // Meta ao lado de `messages[].from`) e `metadata`. Levar o objeto todo,
      // e não campos escolhidos aqui, evita que um campo novo precise passar
      // por duas funções para chegar a quem o usa.
      for (const mensagem of comoLista(valor.messages)) {
        if (!mensagem?.id) continue;
        eventos.push({ chave: mensagem.id, tipo: "mensagem", mensagem, valor });
      }

      // STATUS: a chave é o PAR wamid+status. O MESMO wamid gera `sent`,
      // depois `delivered`, depois `read` — três webhooks legítimos. Deduplicar
      // só pelo wamid descartaria os dois últimos como se fossem reentrega do
      // primeiro, e o pedido ficaria "enviado" para sempre.
      for (const status of comoLista(valor.statuses)) {
        if (!status?.id || !status?.status) continue;
        eventos.push({ chave: `${status.id}:${status.status}`, tipo: "status", status });
      }
    }
  }
  return eventos;
}

/** Só as chaves — é o que a tabela `canastra.whatsapp_eventos` guarda. */
function chavesDeDeduplicacao(corpo) {
  return eventosDoWebhook(corpo).map((evento) => evento.chave);
}

/**
 * O que o cliente mandou.
 *
 * BOTÃO DE TEMPLATE E BOTÃO INTERATIVO SÃO COISAS DIFERENTES, e é o ponto que
 * mais gera bug nesta API:
 *
 *   - o clique num quick-reply de TEMPLATE aprovado chega como `type:
 *     "button"`, e o que ele traz é `button.payload` — que vem do TEXTO do
 *     botão e MUDA se o template for traduzido;
 *   - o clique numa mensagem INTERATIVA chega como `type: "interactive"`, e o
 *     que ele traz é `interactive.button_reply.id` — definido por nós, estável.
 *
 * Rotear pelo `payload` é combinar com um texto que a Meta pode reescrever.
 *
 * O `default` NÃO LANÇA e devolve o próprio tipo: áudio, imagem, figurinha,
 * localização, contato e reação chegam por este mesmo webhook, e um `throw`
 * aqui viraria 500 e reentrega por sete dias de uma foto que o cliente mandou
 * sem querer.
 */
function classificarMensagem(msg) {
  switch (msg?.type) {
    case "text":
      return { tipo: "texto", corpo: msg.text?.body ?? "" };

    case "button":
      return { tipo: "botao_template", payload: msg.button?.payload ?? null };

    case "interactive": {
      const resposta = msg.interactive?.button_reply;
      // `list_reply` e `nfm_reply` caem no genérico: nenhuma mensagem desta
      // loja usa lista nem formulário hoje, e adivinhar o formato agora seria
      // escrever um caminho que ninguém exercita.
      if (!resposta?.id) return { tipo: "interactive" };
      return { tipo: "botao", id: resposta.id, titulo: resposta.title ?? null };
    }

    default:
      return { tipo: typeof msg?.type === "string" ? msg.type : "desconhecido" };
  }
}

/* ------------------------------------------------------------------------- *
 * A deduplicação, contra o banco
 * ------------------------------------------------------------------------- */

/**
 * Os eventos do lote que AINDA NÃO PASSARAM POR AQUI.
 *
 * A Meta reentrega por ATÉ 7 DIAS diante de qualquer resposta diferente de
 * 200, e reentrega também quando o 200 se perde na volta. Nenhuma quantidade
 * de "responder 200 rápido" elimina a duplicata; só deduplicação elimina.
 *
 * QUEM DECIDE É O PRIMARY KEY, e não uma leitura antes da escrita: um
 * `SELECT` seguido de `INSERT` tem corrida entre os dois, e dois processos
 * recebendo a mesma reentrega ao mesmo tempo passariam os dois. O `RETURNING`
 * do `ON CONFLICT DO NOTHING` devolve exatamente as linhas que ESTE comando
 * inseriu.
 *
 * UM COMANDO SÓ para o lote inteiro, e não um por chave: é atômico (ou o lote
 * entra inteiro, ou nenhum entra), então uma falha no meio não deixa metade
 * das chaves gravadas — metade que seria descartada como "duplicata" na
 * reentrega, sem nunca ter sido processada.
 */
async function eventosNovos(corpo) {
  const eventos = eventosDoWebhook(corpo);
  if (eventos.length === 0) return [];

  // Chave repetida DENTRO do mesmo lote sairia daqui como dois eventos novos;
  // o `Set` a resolve antes de o SQL ver.
  const chaves = [...new Set(eventos.map((e) => e.chave))];

  const { rows } = await pool.query(
    `INSERT INTO canastra.whatsapp_eventos (dedupe_key)
     SELECT unnest($1::text[])
     ON CONFLICT (dedupe_key) DO NOTHING
     RETURNING dedupe_key`,
    [chaves],
  );

  const novas = new Set(rows.map((linha) => linha.dedupe_key));
  return eventos.filter((evento) => novas.has(evento.chave));
}

/**
 * Apaga os eventos fora da janela de reentrega da Meta. Devolve quantos saíram.
 *
 * SETE DIAS porque é o prazo documentado de reentrega ("for up to 7 days"), o
 * mesmo que o comentário do índice `whatsapp_eventos_recebido_idx` (0017) já
 * anotou. A tabela só existe para responder "já processei este?", e depois desse
 * prazo a pergunta não pode mais ser feita — guardar mais é só custo de disco.
 * Cortar ANTES é o erro caro: deixaria passar justamente a duplicata do fim da
 * janela, que é a que ninguém está olhando.
 *
 * `now() - interval '7 days'` calculado PELO POSTGRES, e não um `Date` do Node:
 * o relógio que gravou `recebido_em` (o `DEFAULT now()` da tabela) tem de ser o
 * mesmo que decide o corte. Com o processo num fuso e o banco em outro, uma
 * conta feita aqui apagaria horas a mais ou a menos, em silêncio.
 *
 * A LINHA NÃO GUARDA NADA ALÉM DA CHAVE: `dedupe_key` é `wamid` ou
 * `id:status:timestamp`, e o miolo do wamid em base64 é o telefone do cliente.
 * Por isso esta função DEVOLVE UM NÚMERO e não as linhas apagadas, e por isso o
 * log de quem a chama conta quantas — nunca quais.
 *
 * `conexao = pool` para o dia em que a limpeza precisar rodar dentro de uma
 * transação de outro job; hoje ninguém passa nada.
 */
async function limparEventosVelhos(conexao = pool) {
  const { rowCount } = await conexao.query(
    "DELETE FROM canastra.whatsapp_eventos WHERE recebido_em < now() - interval '7 days'",
  );
  return rowCount;
}

/* ------------------------------------------------------------------------- *
 * O menu de suporte
 * ------------------------------------------------------------------------- */

/**
 * OS TRÊS BOTÕES, E O `id` É O CONTRATO.
 *
 * O `id` é escolhido AQUI e viaja de volta em `interactive.button_reply.id`
 * quando o cliente aperta — é por ele que se roteia. O `titulo` é só o que a
 * pessoa vê: trocar a palavra não pode mudar o roteamento, e é justamente por
 * isso que `button.payload` (que É o texto do botão do template) não serve.
 *
 * TÍTULO TEM TETO DE 20 CARACTERES NA META, E `enviarInterativa` NÃO TRUNCA —
 * ela só corta o quarto botão. O 21º caractere não é ignorado: ele reprova a
 * mensagem inteira, e o cliente fica sem menu nenhum. Os três abaixo têm 10, 16
 * e 12, e `whatsapp_suporte.test.js` mede cada um para o dia em que alguém
 * escrever uma palavra mais bonita e mais longa.
 */
const MENU = Object.freeze({
  texto: "Posso ajudar com o seu pedido. É só escolher:",
  botoes: Object.freeze([
    Object.freeze({ id: "meu_pedido", titulo: "Meu pedido" }),
    Object.freeze({ id: "falar_humano", titulo: "Falar com alguém" }),
    Object.freeze({ id: "parar_avisos", titulo: "Parar avisos" }),
  ]),
});

/**
 * O QUE DESLIGA OS AVISOS EM TEXTO LIVRE.
 *
 * NÃO EXISTE STOP NATIVO NA META: ela não intercepta texto nenhum, ao contrário
 * do SMS. Parar de mandar é INTEIRAMENTE responsabilidade da loja, e quem
 * escreve "PARAR" espera que funcione porque em todo outro canal funciona. Sem
 * esta lista, a única saída do cliente seria bloquear o número — o que a Meta
 * conta contra a nota de qualidade dele.
 */
const PARADAS = Object.freeze(new Set(["parar", "sair", "stop"]));

/**
 * O status do pedido POR EXTENSO. `enviado`/`entregue` são vocabulário interno
 * (o CHECK de 0009, `utils/statusDePedido.js`) e não frase que se manda a
 * alguém: "Seu pedido está enviado" é o tipo de mensagem que gera pergunta em
 * vez de responder uma.
 *
 * `em_processamento` e `autorizado` APARECEM AQUI, embora não gerem aviso
 * nenhum: a lista de avisos é sobre o que a loja manda sem ser perguntada;
 * aqui o cliente PERGUNTOU, e "não sei dizer" seria pior que a verdade.
 */
const STATUS_POR_EXTENSO = Object.freeze({
  pendente: "aguardando a confirmação do pagamento",
  aprovado: "com o pagamento confirmado, em preparo",
  em_processamento: "com o pagamento em análise",
  autorizado: "com o pagamento autorizado, aguardando a confirmação",
  enviado: "a caminho",
  entregue: "entregue",
  cancelado: "cancelado",
  rejeitado: "com o pagamento recusado",
  reembolsado: "reembolsado",
});

/** O que o cliente lê quando não há pedido nenhum no número dele. */
const SEM_PEDIDO =
  "Não encontrei pedido no seu número. Se você comprou informando outro " +
  "telefone, escolha “Falar com alguém” que a gente localiza.";

/**
 * A confirmação do opt-out. Ela diz o ESCOPO de propósito — "avisos de pedido"
 * —, porque é isso que a coluna `whatsapp_optout_em` de fato desliga: o cliente
 * que escrever de novo continua sendo respondido, e prometer o contrário seria
 * mentira na única mensagem que ele vai reler.
 */
const CONFIRMA_OPTOUT =
  "Pronto: não mando mais avisos de pedido por aqui. Se mudar de ideia, é só " +
  "escrever que a gente religa.";

/**
 * As duas colunas que o roteador precisa do cliente, escritas uma vez só para
 * os dois caminhos de busca não divergirem.
 *
 * `janela_aberta` é calculada PELO POSTGRES, e não em JavaScript. O carimbo é
 * gravado com o `now()` do banco; compará-lo com o `Date.now()` do processo
 * misturaria dois relógios, e o sintoma seria um teto que erra por segundos
 * perto da virada das 24 horas — em produção, onde o banco é outra máquina.
 *
 * As 24 horas são a janela de atendimento da Meta: fora dela nem `enviarTexto`
 * nem `enviarInterativa` entregam nada (ela responde 131047). O teto de "um
 * menu por janela" usa a mesma unidade de propósito.
 */
const LEITURA_DO_CLIENTE = `user_id,
          (whatsapp_ultima_entrada_em IS NOT NULL
           AND whatsapp_ultima_entrada_em > now() - interval '24 hours') AS janela_aberta`;

/**
 * Texto do cliente comparável: sem acento, sem caixa e sem pontuação nas pontas.
 *
 * A comparação é da FRASE INTEIRA, e nunca `includes`: "não quero parar de
 * receber" contém "parar" e pede exatamente o contrário do que dispararia.
 */
function normalizar(texto) {
  return String(texto ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/^[^a-z0-9]+|[^a-z0-9]+$/g, "");
}

/**
 * As formas de telefone que podem estar em `clientes.telefone` para este wa_id.
 *
 * DUAS CORREÇÕES EMPILHADAS, e cada uma cobre um erro diferente:
 *
 *   1. O NONO DÍGITO, que é da Meta. A documentação dela diz, com estas
 *      palavras, que "for Brazil and Mexico, the extra added prefix of the
 *      phone number may be modified by the Cloud API" — o `from` do webhook
 *      pode chegar sem o 9 que está no cadastro. É o que `variantesBrasil`
 *      resolve, e é por isso que ele existe.
 *   2. O DDI, que é nosso. `clientes.telefone` guarda O QUE A PESSOA DIGITOU no
 *      cadastro, e quase ninguém digita "+55": "31999990000" precisa casar com
 *      o `5531999990000` que a Meta manda.
 *
 * Sem as duas, metade do Brasil vira "cliente desconhecido" no primeiro
 * contato — e o primeiro contato é justamente onde ainda não há wa_id gravado.
 */
function candidatosDeTelefone(waId) {
  const candidatos = new Set();
  for (const variante of variantesBrasil(waId)) {
    candidatos.add(variante);
    if (variante.startsWith("55")) candidatos.add(variante.slice(2));
  }
  return [...candidatos];
}

/**
 * Quem escreveu — pelo wa_id primeiro, pelo telefone depois.
 *
 * A ORDEM É A REGRA: `whatsapp_wa_id` é a chave CANÔNICA e, uma vez gravada,
 * ninguém mais adivinha. O casamento por telefone é a semente do primeiro
 * contato e só isso.
 *
 * `LIMIT 2` NO SEGUNDO CAMINHO, E NÃO `LIMIT 1`: um número compartilhado
 * (casal, família, o celular da casa) casa com duas linhas de `clientes`.
 * Escolher uma ao acaso gravaria o wa_id na pessoa errada e mandaria O PEDIDO
 * DELA para quem escreveu — vazamento, não inconveniência. Diante da
 * ambiguidade a resposta é silêncio: custa uma resposta, e a alternativa custa
 * o dado de outra pessoa.
 */
async function acharCliente(waId) {
  const porWaId = await pool.query(
    `SELECT ${LEITURA_DO_CLIENTE}
       FROM canastra.clientes
      WHERE whatsapp_wa_id = $1
      LIMIT 1`,
    [waId],
  );
  if (porWaId.rows[0]) return porWaId.rows[0];

  const candidatos = candidatosDeTelefone(waId);
  if (candidatos.length === 0) return null;

  // O `regexp_replace` na coluna impede o uso de índice e varre `clientes`.
  // Aceito: este caminho só roda ENQUANTO O wa_id NÃO ESTÁ GRAVADO, ou seja
  // uma vez por cliente na vida. Indexar por expressão para isso seria pagar
  // manutenção de índice em todo cadastro para poupar uma varredura por pessoa.
  const porTelefone = await pool.query(
    `SELECT ${LEITURA_DO_CLIENTE}
       FROM canastra.clientes
      WHERE telefone IS NOT NULL
        AND regexp_replace(telefone, '\\D', '', 'g') = ANY($1::text[])
      LIMIT 2`,
    [candidatos],
  );

  if (porTelefone.rows.length !== 1) {
    if (porTelefone.rows.length > 1) {
      // Sem o número na frase: quem lê o log não precisa dele para agir, e
      // telefone completo mora em `clientes.telefone` e em lugar nenhum mais.
      console.warn(
        "WhatsApp: um número de entrada casa com mais de um cadastro; " +
          "ninguém foi vinculado e a mensagem ficou sem resposta.",
      );
    }
    return null;
  }
  return porTelefone.rows[0];
}

/** O menu, que é a resposta padrão para tudo que não é uma ação conhecida. */
function enviarMenu(cfg, waId) {
  return whatsappCliente.enviarInterativa(cfg, {
    para: waId,
    texto: MENU.texto,
    botoes: MENU.botoes,
  });
}

/**
 * O status do pedido mais recente, por extenso.
 *
 * `ORDER BY criado_em DESC LIMIT 1` e não "o pedido em aberto": o cliente que
 * pergunta acabou de comprar ou acabou de receber, e nos dois casos é o último
 * que ele tem em mente.
 */
async function responderPedido(cfg, waId, cliente) {
  const { rows } = await pool.query(
    `SELECT pedido_id, status, codigo_rastreio
       FROM canastra.pedidos
      WHERE user_id = $1::uuid
      ORDER BY criado_em DESC
      LIMIT 1`,
    [cliente.user_id],
  );

  const pedido = rows[0];
  if (!pedido) {
    return whatsappCliente.enviarTexto(cfg, { para: waId, texto: SEM_PEDIDO });
  }

  // `hasOwn` porque `pedidos.status` é TEXTO LIVRE no banco (0005 adiou o CHECK
  // de propósito): sem ele, um status "constructor" acharia o protótipo do
  // objeto e o cliente receberia "Seu pedido está function Object()".
  const extenso = Object.hasOwn(STATUS_POR_EXTENSO, pedido.status)
    ? STATUS_POR_EXTENSO[pedido.status]
    : "em andamento";

  // O MESMO recorte de 8 caracteres do e-mail e do template, para quem recebeu
  // os três ver o mesmo número nos três.
  let texto = `Seu pedido ${String(pedido.pedido_id).slice(0, 8)} está ${extenso}.`;
  if (pedido.codigo_rastreio) {
    texto += ` O código de rastreio é ${pedido.codigo_rastreio}.`;
  }
  return whatsappCliente.enviarTexto(cfg, { para: waId, texto });
}

/**
 * O link do WhatsApp humano da loja.
 *
 * `paraE164` e não o valor cru: `numero_suporte` é digitado no painel, e
 * "(31) 3333-4444" viraria um `wa.me` que não abre conversa nenhuma. Sem número
 * configurado — o estado de toda instalação até alguém preencher o painel — a
 * resposta não promete link nenhum, em vez de mandar "https://wa.me/null".
 */
function responderHumano(cfg, waId) {
  const suporte = paraE164(cfg?.numero_suporte);
  const texto = suporte
    ? `Fale com a nossa equipe por aqui: https://wa.me/${suporte}`
    : "Pode escrever por aqui mesmo — a nossa equipe responde neste número.";
  return whatsappCliente.enviarTexto(cfg, { para: waId, texto });
}

/**
 * O opt-out, que é a única coisa que impede a loja de continuar mandando.
 *
 * `COALESCE` PRESERVA O CARIMBO ORIGINAL: quem apertar duas vezes não reescreve
 * a data. O ônus de provar quando o consentimento mudou é do controlador (LGPD
 * Art. 8 §2), e um carimbo que se move a cada clique não prova nada.
 */
async function responderOptOut(cfg, waId, cliente) {
  await pool.query(
    `UPDATE canastra.clientes
        SET whatsapp_optout_em = COALESCE(whatsapp_optout_em, now())
      WHERE user_id = $1::uuid`,
    [cliente.user_id],
  );
  return whatsappCliente.enviarTexto(cfg, { para: waId, texto: CONFIRMA_OPTOUT });
}

/**
 * O que responder — a decisão inteira, num lugar só.
 *
 * `cliente.janela_aberta` foi lido ANTES do carimbo desta mensagem, e a ordem é
 * o teto: lido depois, ele estaria sempre aberto e o menu nunca sairia.
 */
async function responder(cfg, waId, cliente, msg) {
  const entrada = classificarMensagem(msg);

  // O QUICK-REPLY DO TEMPLATE SÓ SERVE PARA ABRIR A CONVERSA. É ele que abre a
  // janela de 24 horas, e é o único gesto que o cliente tem antes de existir
  // menu nenhum — por isso ele NÃO passa pelo teto: calar aqui deixaria a
  // pessoa sem resposta bem no botão que ela apertou de propósito.
  if (entrada.tipo === "botao_template") return enviarMenu(cfg, waId);

  if (entrada.tipo === "botao") {
    switch (entrada.id) {
      case "meu_pedido":
        return responderPedido(cfg, waId, cliente);
      case "falar_humano":
        return responderHumano(cfg, waId);
      case "parar_avisos":
        return responderOptOut(cfg, waId, cliente);
      // `id` desconhecido (um menu de versão anterior, ainda na tela de alguém)
      // cai no menu lá embaixo, com o teto — não há ação a executar e insistir
      // seria pingue-pongue.
    }
  }

  if (entrada.tipo === "texto" && PARADAS.has(normalizar(entrada.corpo))) {
    return responderOptOut(cfg, waId, cliente);
  }

  /**
   * TUDO O MAIS VIRA MENU, UMA VEZ POR JANELA — e o teto é o ponto.
   *
   * "Tudo o mais" é bastante coisa: texto que não reconhecemos, foto, áudio,
   * figurinha, localização, reação com 👍. Sem teto, cada uma dessas ganha uma
   * resposta, o cliente responde de novo, e CADA VOLTA CONTA CONTRA A NOTA DE
   * QUALIDADE DO NÚMERO na Meta — que é o que decide o limite de envio da loja
   * e, no fim da escada, o bloqueio.
   *
   * A janela é a unidade certa porque é a mesma que a Meta usa: dentro dela o
   * cliente já viu o menu; fora dela ele volta a ser alguém que não tem por
   * onde começar.
   */
  if (cliente.janela_aberta) return;
  return enviarMenu(cfg, waId);
}

/**
 * O QUE FAZER COM O QUE O CLIENTE MANDOU. Nunca lança.
 *
 * `valor` é o `value` do webhook (`contacts`, `metadata`, `messages`). Ele
 * entra porque `contacts[0].wa_id` é o mesmo identificador de `messages[].from`
 * repetido pela Meta — e é o que sobra quando um corpo chega sem `from`.
 *
 * NUNCA LANÇAR NÃO É ZELO, É CONTRATO: o handler do webhook JÁ RESPONDEU 200
 * quando esta função roda. Uma exceção daqui não vira resposta nenhuma — vira
 * `unhandledRejection`, que no Node 22 derruba o processo por padrão, e com ele
 * todos os outros eventos do mesmo lote.
 *
 * COM A INTEGRAÇÃO DESLIGADA, SILÊNCIO. Uma loja com o bot desligado não deve
 * mandar mensagem nenhuma; e o webhook continua deduplicando e devolvendo 200,
 * porque devolver ≠200 faria a Meta reentregar o mesmo lote por sete dias.
 */
async function rotearMensagem(msg, valor) {
  try {
    const cfg = await whatsappConfig.carregar();
    if (!whatsappConfig.configurado(cfg)) return;

    const waId = msg?.from || valor?.contacts?.[0]?.wa_id || null;
    if (!waId) return;

    const cliente = await acharCliente(waId);
    // Quem não é cliente não recebe resposta: não há pedido, não há opt-out, e
    // um menu para um número desconhecido é mensagem que a loja paga para
    // mandar a quem nunca comprou.
    if (!cliente) return;

    /**
     * O CARIMBO VEM DEPOIS DA LEITURA, E ANTES DA RESPOSTA.
     *
     * Depois da leitura porque `janela_aberta` já saiu do SELECT acima —
     * carimbar antes deixaria a janela sempre aberta e o menu nunca sairia.
     *
     * Antes da resposta porque a janela abriu de fato: ela é aberta pela
     * mensagem DO CLIENTE, e não pela nossa resposta. Se o envio falhar, o
     * carimbo continua correto.
     *
     * E É AQUI QUE A ADIVINHAÇÃO ACABA: casado por variante, o wa_id vira
     * coluna. Da próxima entrada em diante, o primeiro SELECT o encontra e
     * ninguém mais precisa reconstruir nono dígito nenhum.
     *
     * A ATRIBUIÇÃO É DIRETA, E NÃO `COALESCE`: quando o cliente já tem um
     * wa_id gravado e ESTE é outro, quem chegou aqui foi o casamento por
     * telefone — ou seja, a pessoa está escrevendo de um número novo. O wa_id
     * canônico é o que acabou de falar, não o que falou da última vez; manter
     * o antigo mandaria os próximos avisos para um número que ela não usa
     * mais. (Quem casa com mais de um cadastro nem chega aqui: `acharCliente`
     * devolve null antes.)
     */
    await pool.query(
      `UPDATE canastra.clientes
          SET whatsapp_ultima_entrada_em = now(), whatsapp_wa_id = $2
        WHERE user_id = $1::uuid`,
      [cliente.user_id, waId],
    );

    await responder(cfg, waId, cliente, msg);
  } catch (erro) {
    // Só os códigos. `erro.message` do `pg` pode ecoar valor de coluna, e o da
    // Meta ecoa o telefone ("Recipient phone number not in allowed list: ...").
    // Nada de wamid e nada do corpo: o miolo do wamid em base64 É o telefone.
    //
    // E AQUI NÃO SE DESLIGA A INTEGRAÇÃO, ao contrário de
    // `notificacoes.js:ERROS_QUE_DESLIGAM`: este caminho é disparado por quem
    // manda mensagem DE FORA, e um desligamento acionável por webhook daria a
    // um remetente qualquer influência sobre a linha de configuração da loja.
    // O aviso de pedido detecta a credencial morta com um pedido só, e a partir
    // dele `configurado(cfg)` já emudece este roteador junto.
    console.error(
      "WhatsApp: falha ao responder a mensagem do cliente " +
        `(código ${erro?.codigo ?? erro?.code ?? "?"}).`,
    );
  }
}

/* ------------------------------------------------------------------------- *
 * Os handlers
 * ------------------------------------------------------------------------- */

/**
 * GET /whatsapp/webhook — o handshake que a Meta faz ao salvar a URL.
 *
 * O `try` embrulha o handler inteiro porque este Express é o 4: promessa
 * rejeitada dentro de um handler `async` NÃO chega ao tratador de erros dele —
 * vira `unhandledRejection` e a requisição fica pendurada até o outro lado
 * desistir. Um 500 explícito é sempre melhor que uma conexão muda.
 */
async function verificar(req, res) {
  try {
    const cfg = await whatsappConfig.carregar();

    const resposta = responderVerificacao(
      {
        modo: req.query?.["hub.mode"],
        token: req.query?.["hub.verify_token"],
        desafio: req.query?.["hub.challenge"],
      },
      cfg.verify_token,
    );

    if (resposta.status !== 200) {
      console.warn("WhatsApp: verificação do webhook recusada.", { origem: req.ip });
      return res.sendStatus(resposta.status);
    }

    // TEXTO PURO. `res.json(desafio)` devolveria `"1158201444"` COM ASPAS e a
    // Meta recusa o handshake — ver o docblock de `responderVerificacao`.
    return res.status(200).type("text/plain").send(resposta.corpo);
  } catch (erro) {
    console.error(`WhatsApp: falha na verificação do webhook (código ${erro.code || "?"}).`);
    return res.sendStatus(500);
  }
}

/** POST /whatsapp/webhook — a entrega de verdade. */
async function receber(req, res) {
  let novos = [];

  try {
    const cfg = await whatsappConfig.carregar();

    /**
     * A ASSINATURA VEM PRIMEIRO, E A DEDUPE DEPOIS — a ordem é a defesa.
     *
     * Invertida, qualquer um do lado de fora envenenaria
     * `canastra.whatsapp_eventos` com wamids forjados, e o evento LEGÍTIMO da
     * Meta chegaria depois e seria descartado como duplicata. O ataque não
     * seria ler nada: seria calar a loja.
     */
    const assinatura = req.headers?.[CABECALHO_DA_ASSINATURA];
    if (!validarAssinatura(req.rawBody, assinatura, cfg.app_secret, process.env.NODE_ENV)) {
      // Sem nada do corpo no log: o wamid carrega o telefone do cliente (ver o
      // cabeçalho do arquivo) e o texto carrega o que a pessoa escreveu.
      console.warn("WhatsApp: webhook recusado por assinatura inválida.", { origem: req.ip });
      // 401 e não 403: a Meta reentrega diante de qualquer coisa que não seja
      // 200, então um `app_secret` trocado por engano no painel vira reentrega
      // — e não evento perdido — até alguém consertar.
      return res.sendStatus(401);
    }

    // A DEDUPE ACONTECE DENTRO DO `try`, E É ELA QUE PODE VIRAR 500: gravar a
    // chave é o que garante que o evento não será processado duas vezes, então
    // não há como seguir adiante sem ela.
    novos = await eventosNovos(req.body);
  } catch (erro) {
    // Só o código do erro: `erro.message` de um erro do `pg` pode ecoar valor,
    // e o valor aqui é o wamid.
    //
    // 500 é deliberado, e é o oposto do reflexo de "responder 200 sempre": a
    // Meta só reentrega diante de resposta diferente de 200. Um 200 aqui daria
    // o evento por entregue sem ele ter sido gravado nem tratado — e ele não
    // voltaria nunca mais.
    console.error(
      `WhatsApp: falha ao registrar o evento do webhook (código ${erro.code || "?"}).`,
    );
    return res.sendStatus(500);
  }

  /**
   * O 200 SAI ANTES DE RESPONDER O CLIENTE, e a ordem é deliberada.
   *
   * A Meta mede o tempo de resposta deste webhook e reentrega o lote inteiro
   * quando ele demora. Responder o cliente custa uma ida à Graph API por
   * mensagem; pendurar o 200 atrás disso trocaria "o menu demorou um segundo"
   * por "o lote inteiro voltou e foi reprocessado".
   *
   * E É POR ISSO QUE O `try` TERMINOU ACIMA: com a resposta já enviada, um
   * `res.sendStatus(500)` daqui seria "Cannot set headers after they are sent"
   * — um erro sobre a resposta, escondendo o erro de verdade. Quem trata falha
   * daqui para baixo é `rotearMensagem`, que não lança.
   */
  res.sendStatus(200);

  for (const evento of novos) {
    // Os `statuses` (sent/delivered/read) não têm resposta a dar; eles são o
    // rastro do que a loja mandou, e casá-los com `whatsapp_mensagens` é
    // assunto de outro lugar.
    if (evento.tipo !== "mensagem") continue;
    await rotearMensagem(evento.mensagem, evento.valor);
  }
}

/* ------------------------------------------------------------------------- *
 * Os handlers do painel
 *
 * Daqui para baixo é a API que a TELA DO GESTOR consome: colar a credencial,
 * ligar e desligar avisos, criar os templates na Meta, mandar um teste e ver o
 * que saiu. Todas exigem `isAuthenticated` + `isAdmin`, nessa ordem, e quem as
 * monta é `routes/whatsapp.routes.js`.
 *
 * TRÊS COISAS ESTRUTURAM ESTE BLOCO, e nenhuma é estilo:
 *
 *  1. O SEGREDO NÃO VOLTA. O que sai para a tela é `paraOPainel()`, que é
 *     montado campo a campo e mascara os três segredos; `carregar()` (que
 *     devolve o token CRU) só é usado para FALAR com a Meta, nunca para
 *     responder. As frases de erro que chegam ao painel são as do
 *     `whatsappClient`, que já vêm redigidas — sem token e sem telefone.
 *
 *  2. DESLIGADO É ESTADO CONHECIDO, NÃO ERRO. Ação que precisa da Meta com a
 *     integração desligada responde 503 com código e frase (o molde é
 *     `bling.routes.js:37-47`), nunca 404 nem 500 — a tela usa essa distinção
 *     para desabilitar o botão em vez de deixar o erro acontecer. A guarda
 *     mora no HANDLER e não no roteador porque a pergunta é sobre a
 *     configuração no banco, não sobre uma variável de ambiente; e porque é no
 *     handler que os testes a exercitam.
 *
 *  3. CAMPO EM BRANCO NÃO APAGA SEGREDO. O caso comum desta tela é o gestor
 *     abrir, mexer num interruptor e salvar — com os campos de segredo vazios,
 *     porque o GET nunca os devolve. Tratar isso como "apague o token" mataria
 *     a integração com um clique. É o mesmo cuidado de
 *     `ordersRepository.js:125-128` com `codigo_rastreio`.
 * ------------------------------------------------------------------------- */

/**
 * O que o gestor precisa ter preenchido para o bot funcionar PONTA A PONTA, na
 * ordem em que a tela mostra os campos.
 *
 * NÃO é `whatsappConfig.CAMPOS_MINIMOS`: aqueles dois bastam para MANDAR
 * mensagem, e é por eles que `configurado()` decide. Estes cinco incluem
 * também o que faz o WhatsApp funcionar de VOLTA (`app_secret`, que valida a
 * assinatura do webhook; `verify_token`, do handshake) e o que cria template
 * (`waba_id`). Uma instalação sem `app_secret` manda aviso e não recebe
 * resposta nenhuma — e o sintoma, "o cliente respondeu e nada aconteceu", não
 * aponta para lugar nenhum. Por isso os cinco aparecem em `faltando`.
 */
const CAMPOS_ESPERADOS = Object.freeze([
  "access_token",
  "app_secret",
  "verify_token",
  "phone_number_id",
  "waba_id",
]);

/** Os campos booleanos do PUT: o interruptor geral e um por status. */
const CAMPOS_BOOLEANOS = Object.freeze(["ativo", ...whatsappConfig.INTERRUPTORES]);

/**
 * `Template name already exists`. O segundo clique no botão "Criar na Meta" é
 * o caso comum, e ele não é falha de integração — contá-lo como falha faria a
 * tela gritar vermelho por uma ação que não tinha o que fazer.
 */
const TEMPLATE_JA_EXISTE = 2388023;

/** O template do envio de teste, quando o corpo não pede outro. */
const TEMPLATE_DE_TESTE = "pedido_recebido";

/** Teto e padrão do histórico: sem teto, `?limite=99999999` vira varredura. */
const HISTORICO_PADRAO = 50;
const HISTORICO_MAXIMO = 200;

/**
 * As colunas do histórico, LITERAIS — nunca `SELECT *`, como
 * `configRepository.js:12-21`.
 *
 * `wamid` NÃO ESTÁ AQUI, e a ausência é o ponto: o miolo dele em base64 é o
 * telefone do cliente em texto claro (ver o cabeçalho deste arquivo).
 * Devolvê-lo ao painel publicaria, no JSON de uma tela, o número que 0017
 * tirou desta tabela de propósito. `user_id` fica fora pelo mesmo espírito: a
 * tela mostra pedido e template, não pessoa.
 */
const COLUNAS_DO_HISTORICO = [
  "id",
  "pedido_id",
  "template",
  "status",
  "telefone_final",
  "erro_codigo",
  "erro_texto",
  "criado_em",
  "enviado_em",
  "entregue_em",
].join(", ");

/**
 * Erro para resposta — e a FRASE é o produto, porque é ela que a tela mostra
 * ao gestor (`corpo.message || corpo.error`, o padrão de `BlingManager.jsx`).
 *
 * `ErroDaMeta` vira 502: o problema é do lado de lá e a frase já vem redigida
 * pelo `whatsappClient` (sem token, sem telefone), então pode ir para a tela e
 * para o log inteira. Qualquer outra coisa é 500 com frase genérica e SÓ O
 * CÓDIGO no log: um erro do `pg` traz `Failing row contains (...)` em
 * `message`, que é a linha inteira, token incluído.
 */
function responderErro(res, erro, contexto) {
  if (erro?.name === "ErroDaMeta") {
    console.error(`WhatsApp (${contexto}): ${erro.message}`);
    return res.status(502).json({
      error: "META_FALHOU",
      message: erro.message,
      codigo: erro.codigo ?? null,
    });
  }
  console.error(`WhatsApp (${contexto}): falha inesperada (código ${erro?.code || "?"}).`);
  return res.status(500).json({
    error: "WHATSAPP_FALHOU",
    message:
      "Falha inesperada na integração com o WhatsApp. Veja o log do servidor.",
  });
}

/**
 * A frase que pode ir para a TELA quando a falha não interrompe a resposta —
 * a sonda do status e a linha de um template que não subiu.
 *
 * `ErroDaMeta` já vem redigida pelo `whatsappClient` (sem token, sem telefone)
 * e é exatamente o que o gestor precisa ler. QUALQUER OUTRA COISA é erro de
 * runtime ou do `pg`, e a `message` deles pode carregar valor: o `DETAIL` de
 * uma violação no Postgres é `Failing row contains (1, f, EAAG..., ...)` — a
 * linha inteira, token incluído. Nesses casos a tela recebe uma frase nossa e
 * o detalhe fica no log, que é onde `responderErro` o coloca.
 */
function fraseDoErro(erro) {
  return erro?.name === "ErroDaMeta"
    ? erro.message
    : "Falha inesperada ao falar com a Meta. Veja o log do servidor.";
}

/**
 * A configuração vigente SE a integração puder ser usada agora; ou `null`, com
 * o 503 já respondido — quem chama só precisa de `if (!cfg) return;`.
 *
 * `extras` são os campos que a AÇÃO exige além do mínimo: criar e listar
 * template precisa de `waba_id`, e sem ele a chamada morreria dentro do
 * cliente com "configuração incompleta" — um 502 que culpa a Meta por um campo
 * em branco no nosso painel.
 */
async function integracaoUsavel(res, extras = []) {
  const cfg = await whatsappConfig.carregar();
  const faltando = [...whatsappConfig.CAMPOS_MINIMOS, ...extras].filter(
    (campo) => !cfg[campo],
  );

  if (!whatsappConfig.configurado(cfg) || faltando.length > 0) {
    const motivo = faltando.length
      ? `falta preencher ${faltando.join(", ")}`
      : "a integração está desligada no painel";
    // 503 e não 404: a rota EXISTE, é a integração que não está pronta. E não
    // 500: não houve falha nenhuma, este é um estado que o gestor escolheu (ou
    // ainda não terminou de sair de). A tela desabilita o botão com isto.
    res.status(503).json({
      error: "WHATSAPP_DESLIGADO",
      message:
        `O WhatsApp não está pronto para esta ação: ${motivo}. ` +
        "Abra o painel do WhatsApp, complete a configuração e ligue a integração.",
      ligado: false,
      faltando,
    });
    return null;
  }
  return cfg;
}

/**
 * O corpo do PUT, peneirado. Devolve o que gravar, o que recusar e quantas
 * chaves CONHECIDAS vieram.
 *
 * `Object.hasOwn` e não `corpo[campo] !== undefined`: um corpo JSON com
 * `"__proto__"` (ou um `Object.prototype` poluído por outra dependência)
 * entregaria valor de prototype como se o gestor o tivesse digitado — e
 * `ativo: true` vindo daí LIGARIA a integração sem ninguém ter pedido.
 *
 * A iteração é pelas LISTAS DESTE PROCESSO, nunca pelas chaves do corpo: chave
 * estranha não vira nada. (`whatsappConfig.gravar` faz a mesma peneira de novo,
 * e a redundância é de propósito — esta camada existe para poder RECUSAR com
 * uma frase, aquela para o nome de coluna no SQL ser sempre uma constante.)
 */
function peneirarConfig(corpo) {
  const campos = {};
  const recusados = [];
  let conhecidos = 0;

  for (const campo of CAMPOS_BOOLEANOS) {
    if (!Object.hasOwn(corpo, campo)) continue;
    conhecidos += 1;
    // Só booleano de verdade. `"false"` é uma string TRUTHY: aceita por
    // coerção, ela LIGARIA o aviso que o gestor acabou de desligar, e a tela
    // ainda diria "salvo".
    if (typeof corpo[campo] !== "boolean") {
      recusados.push(campo);
      continue;
    }
    campos[campo] = corpo[campo];
  }

  for (const campo of whatsappConfig.CAMPOS_DE_TEXTO) {
    if (!Object.hasOwn(corpo, campo)) continue;
    conhecidos += 1;
    const valor = corpo[campo];

    // `null` EXPLÍCITO apaga — é como o painel diz "quero limpar este campo".
    if (valor === null) {
      campos[campo] = null;
      continue;
    }
    // Número entra (um `phone_number_id` mandado sem aspas é erro comum de
    // cliente e não muda nada de semântica); objeto, array e booleano não.
    if (typeof valor !== "string" && typeof valor !== "number") {
      recusados.push(campo);
      continue;
    }

    const texto = String(valor).trim();
    if (texto === "") {
      // O CAMPO EM BRANCO DE UM SEGREDO É "NÃO MEXI NELE", NÃO "APAGUE".
      // O GET nunca devolve o valor (só máscara), então o formulário do painel
      // abre com estes campos VAZIOS — todo salvamento que não os retoque
      // chega aqui em branco. Tratar isso como apagar mataria a integração no
      // primeiro clique em "Salvar". Quem quer mesmo limpar manda `null`.
      if (whatsappConfig.SEGREDOS.includes(campo)) continue;
      // Os demais são visíveis na tela e voltam preenchidos no GET: em branco
      // ali é o gestor tendo apagado o conteúdo de propósito.
      campos[campo] = null;
      continue;
    }
    campos[campo] = texto;
  }

  return { campos, recusados, conhecidos };
}

/**
 * GET /whatsapp/status — a sonda do painel.
 *
 * RESPONDE SEMPRE, ligada ou não, e é isso que a distingue das outras: é o
 * endpoint que DIAGNOSTICA o desligado, então ele não pode ser uma das rotas
 * que o 503 fecha. Pelo mesmo motivo a sonda que falha não derruba a resposta:
 * é justamente quando o token vence que o gestor precisa desta tela, e um 500
 * esconderia o único lugar que diz o porquê.
 */
async function status(req, res) {
  try {
    const cfg = await whatsappConfig.carregar();
    const corpo = {
      ligado: whatsappConfig.configurado(cfg),
      ativo: Boolean(cfg.ativo),
      faltando: CAMPOS_ESPERADOS.filter((campo) => !cfg[campo]),
      atualizado_em: cfg.atualizado_em ?? null,
      numero: null,
      erro: null,
      codigo: null,
    };

    // Só vai à rede quando há a quem perguntar — o mesmo critério de
    // `blingClient.sondar()`. Sem credencial, perguntar só gastaria tempo para
    // receber o erro que a lista `faltando` já explicou.
    if (corpo.ligado) {
      try {
        const perfil = await whatsappCliente.perfilDoNumero(cfg);
        // Campo a campo, nunca espalhando o que a Meta devolveu: um campo novo
        // do lado dela entraria na resposta da loja por omissão.
        corpo.numero = {
          display_phone_number: perfil?.display_phone_number ?? null,
          verified_name: perfil?.verified_name ?? null,
          quality_rating: perfil?.quality_rating ?? null,
          code_verification_status: perfil?.code_verification_status ?? null,
        };
      } catch (erro) {
        // `console.error` com a message SÓ quando ela é da Meta (redigida);
        // do contrário, só o código — o resto vai para a frase genérica.
        console.error(
          erro?.name === "ErroDaMeta"
            ? `WhatsApp (status): ${erro.message}`
            : `WhatsApp (status): falha inesperada na sonda (código ${erro?.code || "?"}).`,
        );
        corpo.erro = fraseDoErro(erro);
        corpo.codigo = erro.codigo ?? null;
      }
    }

    return res.json(corpo);
  } catch (erro) {
    return responderErro(res, erro, "status");
  }
}

/** GET /whatsapp/config — máscara e mais nada. Ver `paraOPainel()`. */
async function lerConfig(req, res) {
  try {
    return res.json(await whatsappConfig.paraOPainel());
  } catch (erro) {
    return responderErro(res, erro, "ler config");
  }
}

/**
 * PUT /whatsapp/config — o salvamento do painel.
 *
 * Responde com a configuração já relida (mascarada): a tela não precisa de uma
 * segunda ida para mostrar o estado novo, e o que ela recebe passou pela mesma
 * máscara do GET.
 */
async function gravarConfig(req, res) {
  const corpo = req.body;
  // `express.json()` deixa passar `[]`, `"texto"` e `42` — todos são JSON
  // válido. Sem esta guarda, `Object.hasOwn(42, ...)` não estoura mas o resto
  // do fluxo mentiria "nada para gravar" para um corpo malformado.
  if (!corpo || typeof corpo !== "object" || Array.isArray(corpo)) {
    return res.status(400).json({
      error: "CORPO_INVALIDO",
      message: "Envie um objeto JSON com os campos da configuração do WhatsApp.",
    });
  }

  const { campos, recusados, conhecidos } = peneirarConfig(corpo);

  if (recusados.length > 0) {
    return res.status(400).json({
      error: "CAMPO_INVALIDO",
      message:
        `Valor inválido em: ${recusados.join(", ")}. ` +
        "Os interruptores são true ou false; os demais campos são texto (ou null para limpar).",
    });
  }

  // "Salvou!" sem ter salvado nada é o pior desfecho desta tela — o gestor sai
  // achando que configurou. Um corpo sem NENHUMA chave conhecida é isso.
  if (conhecidos === 0) {
    return res.status(400).json({
      error: "NADA_A_GRAVAR",
      message: "Nenhum campo conhecido da configuração do WhatsApp veio no corpo.",
    });
  }

  // RELIGAR APAGA O MOTIVO DO DESLIGAMENTO ANTERIOR (0020).
  //
  // O modo de falha que isto impede: a credencial morre, o bot se desliga
  // sozinho e grava "código 190"; o gestor troca o token e religa; meses depois
  // ele desliga a integração A MÃO para uma manutenção, abre a tela e lê aquele
  // mesmo motivo velho — e conclui que a credencial morreu de novo. Um
  // `ultimo_erro` que sobrevive ao religamento não é um diagnóstico
  // desatualizado: é um diagnóstico ERRADO, que é pior do que não ter nenhum.
  //
  // SÓ NO `true`, e nunca no `false`: um desligamento humano deixa as duas
  // colunas em branco de propósito, e o branco É a resposta ("fui eu quem
  // desligou"). As chaves entram AQUI, e não em `peneirarConfig`, porque o
  // painel não as digita — quem as escreve é o bot ao desistir. Aceitá-las no
  // corpo do PUT faria da tela um lugar de "explicar" desligamento que nunca
  // houve.
  if (campos.ativo === true) {
    for (const campo of whatsappConfig.CAMPOS_DE_DIAGNOSTICO) campos[campo] = null;
  }

  try {
    // `campos` pode estar vazio com `conhecidos > 0`: é o salvamento que só
    // trazia segredos em branco. Nada a escrever, e nada de errado — a
    // resposta devolve o estado atual, que é o que a tela vai mostrar.
    if (Object.keys(campos).length > 0) await whatsappConfig.gravar(campos);
    return res.json({
      message: "Configuração do WhatsApp salva.",
      config: await whatsappConfig.paraOPainel(),
    });
  } catch (erro) {
    return responderErro(res, erro, "gravar config");
  }
}

/**
 * GET /whatsapp/mensagens — o histórico.
 *
 * Sem `wamid` e sem telefone completo (ver `COLUNAS_DO_HISTORICO`). O `limite`
 * vem da querystring, então ele é peneirado: `NaN` viraria `LIMIT NaN` e um
 * número enorme viraria varredura da tabela inteira.
 */
async function historico(req, res) {
  const pedido = Number.parseInt(req.query?.limite, 10);
  const limite = Number.isFinite(pedido)
    ? Math.min(Math.max(pedido, 1), HISTORICO_MAXIMO)
    : HISTORICO_PADRAO;

  try {
    const { rows } = await pool.query(
      `SELECT ${COLUNAS_DO_HISTORICO}
         FROM canastra.whatsapp_mensagens
        ORDER BY criado_em DESC, id DESC
        LIMIT $1`,
      [limite],
    );
    return res.json({ mensagens: rows, limite });
  } catch (erro) {
    return responderErro(res, erro, "histórico");
  }
}

/**
 * GET /whatsapp/templates — o mapa da loja cruzado com o que a Meta tem.
 *
 * A LISTA É A DESTE CÓDIGO, e o estado é o de lá. Devolver só o que a Meta
 * tem esconderia justamente o caso que a tela existe para mostrar: o template
 * que a loja dispara e que ninguém criou (a Meta responde 132001 e o cliente
 * fica sem aviso). Template que existe lá e não aqui não aparece — não é da
 * loja, e listá-lo só daria trabalho a quem lê.
 */
async function lerTemplates(req, res) {
  try {
    const cfg = await integracaoUsavel(res, ["waba_id"]);
    if (!cfg) return undefined;

    const json = await whatsappCliente.listarTemplates(cfg);
    const daMeta = new Map(
      (Array.isArray(json?.data) ? json.data : []).map((t) => [t.name, t]),
    );

    const templates = Object.keys(TEMPLATES).map((nome) => {
      const meta = daMeta.get(nome);
      return {
        nome,
        // `null` e não "ausente": quem descreve para o gestor é a tela
        // (`descreverTemplate`), e ela precisa distinguir sem parsear frase.
        status: meta?.status ?? null,
        category: meta?.category ?? null,
        // A Meta anuncia RECLASSIFICAÇÃO por aqui, antes de passar a cobrar
        // como marketing (cerca de nove vezes mais) e antes de "template
        // misclassification" virar motivo de bloqueio.
        correct_category: meta?.correct_category ?? null,
        rejected_reason: meta?.rejected_reason ?? null,
      };
    });

    return res.json({ templates });
  } catch (erro) {
    return responderErro(res, erro, "listar templates");
  }
}

/**
 * POST /whatsapp/templates — cria na Meta os templates deste código.
 *
 * UM DE CADA VEZ, e o `for` sequencial é deliberado: `Promise.all` cancelaria
 * as criações restantes no primeiro erro e o gestor ficaria com metade dos
 * templates sem saber quais — além de disparar sete requisições simultâneas
 * contra um endpoint com limite de taxa por conta.
 *
 * CADA FALHA VIRA LINHA DO RESULTADO, não exceção: a resposta é uma lista, uma
 * entrada por template, com a frase do erro quando houve. É o que a tela
 * mostra ao lado de cada nome.
 */
async function criarTemplates(req, res) {
  try {
    const cfg = await integracaoUsavel(res, ["waba_id"]);
    if (!cfg) return undefined;

    const resultados = [];
    for (const [nome, modelo] of Object.entries(TEMPLATES)) {
      try {
        const json = await whatsappCliente.criarTemplate(cfg, {
          nome,
          corpo: modelo.corpo,
          rodape: modelo.rodape,
          botoes: modelo.botoes,
          // `parametros` é nome → valor de EXEMPLO, que é o formato que
          // `criarTemplate` espera: a Meta recusa criar template cujo corpo
          // tem variável sem exemplo, e a reprovação só aparece na revisão
          // dela, até 24h depois.
          exemplos: modelo.parametros,
        });
        resultados.push({
          nome,
          criado: true,
          jaExistia: false,
          id: json?.id ?? null,
          status: json?.status ?? null,
          erro: null,
          codigo: null,
        });
      } catch (erro) {
        const jaExistia = erro?.codigo === TEMPLATE_JA_EXISTE;
        resultados.push({
          nome,
          criado: false,
          jaExistia,
          id: null,
          status: null,
          erro: jaExistia ? null : fraseDoErro(erro),
          codigo: erro?.codigo ?? null,
        });
      }
    }

    const criados = resultados.filter((r) => r.criado).length;
    const jaExistiam = resultados.filter((r) => r.jaExistia).length;
    const falharam = resultados.length - criados - jaExistiam;

    // NENHUM DEU CERTO É FALHA DA AÇÃO, e não uma lista de sete lamentos com
    // cara de sucesso: o caso real é o token vencido, em que os sete falham
    // pelo mesmo motivo. 502 leva a tela para o caminho de erro, e a frase é a
    // do primeiro — que é a mesma dos outros seis.
    if (criados === 0 && jaExistiam === 0) {
      const primeiro = resultados.find((r) => r.erro);
      return res.status(502).json({
        error: "META_FALHOU",
        message: `Nenhum template foi criado na Meta. ${primeiro?.erro || ""}`.trim(),
        resultados,
        criados,
        jaExistiam,
        falharam,
      });
    }

    return res.json({
      message:
        `${criados} template(s) enviados para revisão da Meta` +
        `${jaExistiam ? `, ${jaExistiam} já existiam` : ""}` +
        `${falharam ? `, ${falharam} falharam` : ""}.`,
      resultados,
      criados,
      jaExistiam,
      falharam,
    });
  } catch (erro) {
    return responderErro(res, erro, "criar templates");
  }
}

/**
 * O valor de exemplo do botão de URL, quando o template tem um.
 *
 * Sem isto, testar `pedido_enviado` (o que tem botão de rastreio) sairia sem o
 * componente de botão e a Meta recusaria a mensagem inteira com 132000 — um
 * erro que fala em "parâmetro" e manda procurar no corpo, não no botão.
 * `encodeURIComponent` porque a Meta exige o valor da variável de URL
 * percent-encoded, exatamente como `conteudoDoStatusWhats` faz.
 */
function exemploDoBotaoUrl(modelo) {
  const botao = (modelo.botoes || []).find((b) => b.type === "URL");
  const exemplo = botao?.example?.[0];
  return exemplo ? encodeURIComponent(String(exemplo)) : null;
}

/**
 * POST /whatsapp/teste — manda um template para um número escolhido.
 *
 * Existe para validar a instalação CONTRA O NÚMERO DE TESTE DA META, antes de
 * o número real existir e antes de haver pedido nenhum. Por isso ele não exige
 * cliente, opt-in nem pedido: nada disso está em jogo aqui, e exigi-los
 * impediria justamente o uso para o qual o botão foi feito.
 *
 * A RESPOSTA NÃO CARREGA O NÚMERO NEM O WAMID — só os quatro últimos dígitos,
 * o mesmo recorte que 0017 impõe à tabela. O wamid decodifica para o telefone;
 * devolvê-lo ao navegador o colocaria no cache e no DevTools de quem abrir a
 * tela, sem nenhum ganho (a tela já sabe para qual número mandou).
 */
async function enviarTeste(req, res) {
  try {
    const cfg = await integracaoUsavel(res);
    if (!cfg) return undefined;

    const corpo =
      req.body && typeof req.body === "object" && !Array.isArray(req.body)
        ? req.body
        : {};

    // `paraE164` e não o valor cru: "(31) 99999-0000" é o que o gestor digita,
    // e mandar isso para a Meta gasta cota e derruba a nota do número.
    const destino = paraE164(corpo.para);
    if (!destino) {
      return res.status(400).json({
        error: "TELEFONE_INVALIDO",
        message:
          "Informe um número de WhatsApp brasileiro válido, com DDD (ex.: 31 99999-0000).",
      });
    }

    const nome =
      typeof corpo.template === "string" && corpo.template
        ? corpo.template
        : TEMPLATE_DE_TESTE;
    // `hasOwn` porque `nome` vem de fora: sem ele, "constructor" acharia o
    // protótipo do objeto e a Meta receberia um template chamado "constructor".
    // A frase não ecoa o que veio no corpo — lista os nomes válidos, que é o
    // que ajuda quem está do outro lado.
    if (!Object.hasOwn(TEMPLATES, nome)) {
      return res.status(400).json({
        error: "TEMPLATE_DESCONHECIDO",
        message: `Template desconhecido. Os desta loja são: ${Object.keys(TEMPLATES).join(", ")}.`,
      });
    }

    const modelo = TEMPLATES[nome];
    await whatsappCliente.enviarTemplate(cfg, {
      para: destino,
      template: nome,
      // O MESMO idioma do aviso de verdade, importado de `whatsappMensagens`:
      // um teste que passasse em outro código de idioma exercitaria um
      // template que não existe.
      idioma: IDIOMA,
      // Os valores de EXEMPLO do próprio mapa: é o que faz a mensagem de teste
      // ser idêntica em forma à de verdade, inclusive na contagem de
      // parâmetros (divergir dela é 132000).
      parametros: modelo.parametros,
      botaoUrl: exemploDoBotaoUrl(modelo),
    });

    const final = ultimosQuatro(destino);
    return res.json({
      enviado: true,
      template: nome,
      telefone_final: final,
      message: `Mensagem de teste (${nome}) enviada para o número terminado em ${final}.`,
    });
  } catch (erro) {
    return responderErro(res, erro, "enviar teste");
  }
}

module.exports = {
  // Os handlers, montados em `index.js`.
  verificar,
  receber,
  // Os handlers do painel, montados por `routes/whatsapp.routes.js`.
  status,
  lerConfig,
  gravarConfig,
  historico,
  lerTemplates,
  criarTemplates,
  enviarTeste,
  // A deduplicação, e o que `receber` faz com o que ela devolve.
  eventosNovos,
  rotearMensagem,
  // A faxina da tabela de deduplicação. Pendurada no cron por `index.js`.
  limparEventosVelhos,
  // As quatro funções puras: é onde a decisão de segurança acontece, e é o que
  // permite testá-las sem servidor e sem banco.
  validarAssinatura,
  responderVerificacao,
  chavesDeDeduplicacao,
  classificarMensagem,
};
