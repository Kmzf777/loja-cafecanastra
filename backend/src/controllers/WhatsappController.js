"use strict";

/**
 * A PORTA DE ENTRADA DO WEBHOOK DA META — e nada além dela.
 *
 * Quatro perguntas são respondidas aqui, e só quatro: esta requisição veio
 * mesmo da Meta (assinatura)? a Meta está tentando assinar o webhook
 * (verificação)? este evento já passou por aqui (deduplicação)? e o que
 * exatamente o cliente mandou (classificação)?
 *
 * O QUE FAZER com uma mensagem recebida — o menu de suporte, o rastreio, o
 * "falar com alguém" — NÃO mora neste arquivo. Ele entrega eventos novos e
 * para. É a mesma separação de `whatsappClient.js` (transporte) contra
 * `notificacoes.js` (regra), e é o que deixa esta camada testável sem servidor
 * e sem banco: as quatro funções abaixo são puras e exportadas.
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
      for (const mensagem of comoLista(valor.messages)) {
        if (!mensagem?.id) continue;
        eventos.push({ chave: mensagem.id, tipo: "mensagem", mensagem });
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

    /**
     * OS EVENTOS NOVOS PARAM AQUI, POR ORA — de propósito. Responder o que o
     * cliente mandou (o menu de suporte) é a próxima tarefa; esta entrega a
     * porta, e a porta já precisa deduplicar para não processar duas vezes o
     * que a Meta mandar duas vezes.
     */
    await eventosNovos(req.body);

    return res.sendStatus(200);
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
}

module.exports = {
  // Os handlers, montados em `index.js`.
  verificar,
  receber,
  // A deduplicação — a próxima tarefa consome o que ela devolve.
  eventosNovos,
  // As quatro funções puras: é onde a decisão de segurança acontece, e é o que
  // permite testá-las sem servidor e sem banco.
  validarAssinatura,
  responderVerificacao,
  chavesDeDeduplicacao,
  classificarMensagem,
};
