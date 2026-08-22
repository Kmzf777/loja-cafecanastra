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
const { paraE164, variantesBrasil } = require("../utils/telefone");

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

module.exports = {
  // Os handlers, montados em `index.js`.
  verificar,
  receber,
  // A deduplicação, e o que `receber` faz com o que ela devolve.
  eventosNovos,
  rotearMensagem,
  // As quatro funções puras: é onde a decisão de segurança acontece, e é o que
  // permite testá-las sem servidor e sem banco.
  validarAssinatura,
  responderVerificacao,
  chavesDeDeduplicacao,
  classificarMensagem,
};
