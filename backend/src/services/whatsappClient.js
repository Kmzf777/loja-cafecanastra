"use strict";

/**
 * O cliente HTTP da Cloud API da Meta — a ÚNICA porta de saída para a rede do
 * bot de WhatsApp.
 *
 * O QUE ESTE MÓDULO SABE FAZER, e só isso: montar a URL da Graph API, assinar
 * a requisição com o Bearer e traduzir a resposta. Quem sabe o que é um pedido,
 * um status ou um template é `whatsappMensagens.js` e o serviço de envio; quem
 * sabe onde mora a credencial é `whatsappConfig.js`. É a mesma separação de
 * `blingClient.js` (transporte) vs `blingPedidos.js` (regra), e é o que permite
 * aos testes dublarem a Meta inteira sem tocar em rede.
 *
 * A CONFIGURAÇÃO CHEGA COMO PARÂMETRO, nunca por `require`. Quem chama já
 * carregou o `cfg` (e já conferiu `whatsappConfig.configurado(cfg)`); receber o
 * objeto pronto é o que deixa este arquivo testável sem banco.
 *
 * A VERSÃO DA GRAPH API MORA EM UMA CONSTANTE SÓ. A Meta mantém cada versão
 * por pelo menos dois anos e, quando ela expira, NÃO quebra a chamada: roteia
 * silenciosamente para a versão anterior. Isso é pior que quebrar, porque muda
 * comportamento sem avisar ninguém. Com a string espalhada pela base, trocar de
 * versão viraria uma caçada; com ela aqui, é uma linha.
 *
 * NADA QUE SAI DAQUI CARREGA SEGREDO NEM DADO PESSOAL, e são duas coisas
 * distintas com o mesmo destino (o log do PM2, que fica em disco e entra em
 * todo backup, e o ticket de suporte, que sai da empresa):
 *   1. o ACCESS TOKEN nunca entra em `message` nem em `stack` — o texto vindo
 *      da Meta passa por `redigir()` antes de virar frase de erro;
 *   2. o TELEFONE DO CLIENTE nunca entra em mensagem de erro — o rótulo da
 *      falha é método + caminho + código, e jamais a URL com querystring nem o
 *      corpo enviado.
 * É por isso que este módulo, ao contrário de `blingClient.js:341-342`, NÃO
 * despeja o corpo da resposta no console: o erro 131030 da Meta é literalmente
 * "Recipient phone number not in allowed list: <número>". Logar o corpo cru
 * seria escrever o telefone do cliente em disco sem ninguém ter digitado
 * `console.log(telefone)`.
 */

/** A versão da Graph API. Ver o parágrafo do topo antes de trocar. */
const VERSAO_GRAPH = "v26.0";

/** Host da Graph API. Só existe separado para a URL ser montada em um lugar. */
const BASE_GRAPH = "https://graph.facebook.com";

/**
 * Teto de espera por resposta da Meta. Sem isto, um socket mudo penduraria o
 * envio do aviso — e, junto com ele, o handler de status do painel que o
 * dispara.
 */
const TIMEOUT_PADRAO_MS = 15_000;

/**
 * O único idioma cadastrado na Meta para esta loja — o mesmo `IDIOMA` de
 * `whatsappMensagens.js`, que não o exporta. A criação do template fixa este
 * valor de propósito: um template criado em outro idioma seria aprovado e
 * nunca disparado, porque o envio manda `pt_BR`.
 */
const IDIOMA = "pt_BR";

/**
 * Os campos que o painel mostra da lista de templates.
 *
 * `correct_category` é o que revela RECLASSIFICAÇÃO PENDENTE: quando a Meta
 * decide que um template de UTILITY é, na verdade, MARKETING, ela anuncia por
 * este campo antes de passar a cobrar como marketing (cerca de nove vezes mais)
 * — e "template misclassification" é motivo explícito de bloqueio de envio.
 * `rejected_reason` é a única pista do porquê de uma reprovação na revisão.
 */
const CAMPOS_DO_TEMPLATE = [
  "name",
  "status",
  "category",
  "correct_category",
  "rejected_reason",
];

/** Os campos de saúde do número que o painel mostra. */
const CAMPOS_DO_NUMERO = [
  "display_phone_number",
  "verified_name",
  "quality_rating",
  "code_verification_status",
];

/** A Cloud API aceita no máximo três botões de resposta rápida. */
const MAXIMO_DE_BOTOES = 3;

/**
 * Toda falha deste módulo — HTTP, rede, timeout ou configuração incompleta —
 * vira UM tipo só, para quem chama ter um único jeito de tratar.
 *
 * `codigo` é o `error.code` da Meta (131047, 131026, 190...), que é o que
 * distingue "o cliente bloqueou" de "o token venceu" e, portanto, o que decide
 * se repetir a mensagem adianta. `status` é o HTTP, que responde a mesma
 * pergunta quando a Meta devolve um corpo sem código (um 502 do gateway dela,
 * por exemplo). Nenhum dos dois é dado pessoal nem segredo.
 */
function erroDaMeta(frase, { codigo = null, status = null } = {}) {
  const erro = new Error(`WhatsApp: ${frase}`);
  erro.name = "ErroDaMeta";
  erro.codigo = codigo;
  erro.status = status;
  return erro;
}

/**
 * Tira de um texto ESTRANHO (vindo da Meta ou do runtime) o que não pode sair
 * deste módulo. Aplicada em tudo que entra numa frase de erro sem ter sido
 * escrito aqui.
 *
 * Duas defesas, cada uma com um modo de falha concreto:
 *   - O TOKEN, porque erros de OAuth ecoam o valor recebido. Um token em
 *     `err.message` vira `err.stack`, que vira log do PM2, que vira backup.
 *   - SEQUÊNCIAS LONGAS DE DÍGITOS, porque é a forma de um telefone em E.164
 *     na mensagem da Meta ("Add +5531999990000 to the allowed list"). O corte
 *     em oito dígitos deixa passar o código de erro (seis dígitos) e o HTTP,
 *     que são exatamente o que precisa sobreviver para o erro ser diagnóstico.
 */
function redigir(texto, token) {
  let limpo = String(texto ?? "");
  if (token) limpo = limpo.split(token).join("[token]");
  return limpo.replace(/\+?\d{8,}/g, "[numero]");
}

/**
 * O identificador que falta é erro NOSSO, não da Meta — mas vira `ErroDaMeta`
 * do mesmo jeito. Sem esta guarda a URL sairia com "undefined" no caminho e a
 * Meta responderia um 400 genérico, que manda procurar no lugar errado.
 * A frase leva o NOME do campo, nunca o valor de campo nenhum.
 */
function exigir(valor, nome) {
  if (!valor) {
    throw erroDaMeta(
      `configuração incompleta: ${nome} não está preenchido (painel do WhatsApp).`,
    );
  }
  return valor;
}

/**
 * Uma requisição autenticada à Graph API.
 *
 * `fetchImpl` no default do parâmetro é a costura de teste da casa
 * (`blingClient.js:175`): NINGUÉM sobrescreve `globalThis.fetch`. Em produção
 * é o fetch nativo do Node 22.
 *
 * O `AbortController` é por requisição — um timeout não pode abortar a
 * requisição do vizinho. O timer é `unref`ado para não segurar o processo vivo
 * depois que a resposta já chegou.
 */
async function requisitar(
  cfg,
  metodo,
  caminho,
  { body, query, fetchImpl = fetch, timeoutMs = TIMEOUT_PADRAO_MS } = {},
) {
  const token = exigir(cfg?.access_token, "access_token");
  const url = new URL(`${BASE_GRAPH}/${VERSAO_GRAPH}${caminho}`);
  for (const [chave, valor] of Object.entries(query || {})) {
    if (valor !== undefined && valor !== null) url.searchParams.set(chave, valor);
  }

  // O rótulo da falha: método + CAMINHO, nunca `url.toString()`. A querystring
  // desta API leva identificador de conta, e o caminho já basta para saber
  // qual chamada quebrou.
  const rotulo = `${metodo} ${url.pathname}`;

  const controlador = new AbortController();
  const timer = setTimeout(() => controlador.abort(), timeoutMs);
  timer.unref?.();

  let resposta;
  let texto = "";
  try {
    resposta = await fetchImpl(url.toString(), {
      method: metodo,
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${token}`,
        ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      signal: controlador.signal,
    });
    // O corpo é lido DENTRO do teto de tempo, e não depois dele: o `fetch`
    // resolve quando chegam os CABEÇALHOS, então um corpo que goteja
    // (proxy no meio, conexão meio fechada) penduraria o envio para sempre se
    // o timer já tivesse sido cancelado aqui.
    texto = await resposta.text();
  } catch (erro) {
    if (erro?.name === "AbortError") {
      // Segundos só quando há segundos: com um teto abaixo de 1000ms o
      // arredondamento escreveria "não respondeu em 0s", que é frase de log
      // que faz quem lê duvidar do relógio em vez de olhar para a Meta.
      const espera = timeoutMs >= 1000 ? `${Math.round(timeoutMs / 1000)}s` : `${timeoutMs}ms`;
      throw erroDaMeta(
        `a Meta não respondeu em ${espera} (${rotulo}). ` +
          "A mensagem pode ou não ter saído; confira antes de repetir.",
      );
    }
    // Rede fora, DNS, TLS: vinha como TypeError cru, que atravessaria o
    // serviço de envio sem `codigo` e sem nome reconhecível.
    throw erroDaMeta(`falha de rede ao chamar a Meta (${rotulo}): ${redigir(erro?.message, token)}`);
  } finally {
    clearTimeout(timer);
  }

  let json = null;
  if (texto) {
    try {
      json = JSON.parse(texto);
    } catch {
      // Corpo não-JSON (página de erro do gateway da Meta, por exemplo): a
      // frase de erro usa o texto cru, redigido e truncado.
    }
  }

  if (!resposta.ok) {
    const daMeta = json?.error;
    const codigo = typeof daMeta?.code === "number" ? daMeta.code : null;
    // `details` é o campo informativo da Meta ("o template X não existe neste
    // WABA"); é também onde o telefone aparece, daí passar por `redigir()`.
    const detalhe = [daMeta?.message, daMeta?.error_data?.details]
      .filter(Boolean)
      .map((parte) => redigir(parte, token))
      .join(" — ") || redigir(texto, token).slice(0, 300) || "sem corpo";

    throw erroDaMeta(
      `${rotulo} respondeu HTTP ${resposta.status}` +
        `${codigo === null ? "" : `, código ${codigo}`}: ${detalhe}`,
      { codigo, status: resposta.status },
    );
  }

  return json;
}

/** O identificador da mensagem aceita, ou null — é por ele que o webhook de
 * status (`sent`/`delivered`/`read`) casa com o pedido. */
function wamidDe(json) {
  return { wamid: json?.messages?.[0]?.id ?? null };
}

/**
 * Envia um `message_template` aprovado.
 *
 * `parametros` chega como NOME → VALOR (é o que `conteudoDoStatusWhats`
 * devolve) e é aqui que vira a forma da Meta. Os templates desta loja são
 * criados com `parameter_format: "named"`, então cada parâmetro precisa levar
 * `parameter_name`: mandar posicional para um template nomeado é 132000 na
 * cara, com o cliente sem aviso nenhum.
 */
async function enviarTemplate(cfg, dados, opcoes = {}) {
  const numero = exigir(cfg?.phone_number_id, "phone_number_id");
  const componentes = [];

  const nomes = Object.keys(dados?.parametros || {});
  if (nomes.length > 0) {
    // Só existe componente de corpo quando existe variável: um `body` com
    // `parameters: []` num template sem variável é divergência de contagem, e
    // a Meta recusa a mensagem inteira.
    componentes.push({
      type: "body",
      parameters: nomes.map((nome) => ({
        type: "text",
        parameter_name: nome,
        text: String(dados.parametros[nome]),
      })),
    });
  }

  if (dados?.botaoUrl) {
    // O botão de URL é componente SEPARADO do corpo, e o `index` é a posição
    // dele na lista de botões do template — string, não número, como a Meta
    // documenta. Mandar botão para um template que não tem botão de URL faz a
    // Meta recusar a mensagem com 132000; daí este bloco só existir quando o
    // chamador tem o que preencher.
    componentes.push({
      type: "button",
      sub_type: "url",
      index: "0",
      parameters: [{ type: "text", text: String(dados.botaoUrl) }],
    });
  }

  const json = await requisitar(cfg, "POST", `/${numero}/messages`, {
    ...opcoes,
    body: {
      messaging_product: "whatsapp",
      to: dados.para,
      type: "template",
      template: {
        name: dados.template,
        language: { code: dados.idioma || IDIOMA },
        components: componentes,
      },
    },
  });

  return wamidDe(json);
}

/**
 * Envia texto com botões de resposta rápida — o menu do atendimento.
 *
 * Só vale DENTRO da janela de 24 horas aberta por uma mensagem do cliente;
 * fora dela a Meta responde 131047 e nada chega. Quem decide se a janela está
 * aberta é o serviço de atendimento, não este módulo.
 */
async function enviarInterativa(cfg, dados, opcoes = {}) {
  const numero = exigir(cfg?.phone_number_id, "phone_number_id");

  // Três é o teto da Cloud API: o quarto botão não é ignorado, ele reprova a
  // mensagem inteira. Cortar aqui entrega três botões em vez de nenhum.
  const botoes = (dados?.botoes || []).slice(0, MAXIMO_DE_BOTOES).map((b) => ({
    type: "reply",
    reply: { id: b.id, title: b.titulo },
  }));

  const json = await requisitar(cfg, "POST", `/${numero}/messages`, {
    ...opcoes,
    body: {
      messaging_product: "whatsapp",
      to: dados.para,
      type: "interactive",
      interactive: {
        type: "button",
        body: { text: dados.texto },
        action: { buttons: botoes },
      },
    },
  });

  return wamidDe(json);
}

/**
 * Envia texto puro — a resposta de atendimento dentro da janela de 24 horas.
 *
 * `preview_url: false` é explícito: com preview ligado, um link no meio de uma
 * resposta faz o WhatsApp buscar a página e montar um cartão, o que muda o que
 * o cliente vê sem ninguém ter pedido.
 */
async function enviarTexto(cfg, dados, opcoes = {}) {
  const numero = exigir(cfg?.phone_number_id, "phone_number_id");

  const json = await requisitar(cfg, "POST", `/${numero}/messages`, {
    ...opcoes,
    body: {
      messaging_product: "whatsapp",
      to: dados.para,
      type: "text",
      text: { body: dados.texto, preview_url: false },
    },
  });

  return wamidDe(json);
}

/**
 * Cria (submete para revisão) um template.
 *
 * VAI PARA A WABA, NÃO PARA O NÚMERO: template é da conta de WhatsApp Business
 * e vale para todos os números dela. Postar em `/{phone_number_id}` devolveria
 * um 400 que não diz isso.
 *
 * `category: "UTILITY"` porque estes são avisos de pedido. `parameter_format:
 * "named"` porque o envio manda `parameter_name` — os dois lados precisam
 * combinar, e a divergência só aparece na hora do disparo, não na criação.
 * `example.body_text_named_params` é OBRIGATÓRIO quando o corpo tem variável:
 * sem exemplo a Meta reprova na revisão, o que só se descobre até 24h depois.
 *
 * `botoes` já chega na forma da Meta (`whatsappMensagens.js` os escreve assim,
 * com `type`, `text`, `url` e `example`) e passa direto — reescrevê-los aqui
 * criaria uma segunda definição do mesmo botão para divergir da primeira.
 */
async function criarTemplate(cfg, dados, opcoes = {}) {
  const waba = exigir(cfg?.waba_id, "waba_id");

  const exemplos = Object.entries(dados?.exemplos || {});
  const corpo = { type: "BODY", text: dados.corpo };
  if (exemplos.length > 0) {
    corpo.example = {
      body_text_named_params: exemplos.map(([nome, valor]) => ({
        param_name: nome,
        example: String(valor),
      })),
    };
  }

  const componentes = [corpo];
  if (dados?.rodape) componentes.push({ type: "FOOTER", text: dados.rodape });
  if (dados?.botoes?.length) componentes.push({ type: "BUTTONS", buttons: dados.botoes });

  return requisitar(cfg, "POST", `/${waba}/message_templates`, {
    ...opcoes,
    body: {
      name: dados.nome,
      category: "UTILITY",
      language: IDIOMA,
      parameter_format: "named",
      components: componentes,
    },
  });
}

/** Os templates da WABA e o estado de cada um. `limit=100` cobre com folga os
 * sete desta loja — paginar seria código para um caso que não existe. */
async function listarTemplates(cfg, opcoes = {}) {
  const waba = exigir(cfg?.waba_id, "waba_id");
  return requisitar(cfg, "GET", `/${waba}/message_templates`, {
    ...opcoes,
    query: { fields: CAMPOS_DO_TEMPLATE.join(","), limit: 100 },
  });
}

/**
 * A saúde do número remetente. `quality_rating` (GREEN/YELLOW/RED) é o aviso
 * antecipado do bloqueio da Meta: um número que cai para RED perde o limite de
 * envio antes de perder a permissão, e é a única chance de reagir.
 */
async function perfilDoNumero(cfg, opcoes = {}) {
  const numero = exigir(cfg?.phone_number_id, "phone_number_id");
  return requisitar(cfg, "GET", `/${numero}`, {
    ...opcoes,
    query: { fields: CAMPOS_DO_NUMERO.join(",") },
  });
}

module.exports = {
  VERSAO_GRAPH,
  enviarTemplate,
  enviarInterativa,
  enviarTexto,
  criarTemplate,
  listarTemplates,
  perfilDoNumero,
};
