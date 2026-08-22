/**
 * O contrato do WhatsApp visto do painel — SEM React, SEM fetch.
 *
 * Mesmo desenho de `Bling/blingContrato.js`, e pelo mesmo motivo: é aqui que
 * mora a lógica que decide o que o gestor LÊ (o que falta preencher, em que
 * estado a Meta deixou cada template, que frase mostrar quando o servidor
 * recusa) e é a única parte desta tela que se testa sem navegador.
 * `whatsappContrato.test.ts` exercita tudo o que está aqui.
 *
 * TRÊS COISAS QUE ESTE MÓDULO EXISTE PARA NÃO DEIXAR PASSAR:
 *
 *  1. O SEGREDO NUNCA VOLTA DO SERVIDOR. `GET /whatsapp/config` devolve
 *     `access_token_mascara: "••••4821"` — ou `null`, que é como se distingue
 *     "não configurado" de "configurado e escondido". A tela não tem o valor,
 *     nunca teve, e `corpoDaConfig` garante que a MÁSCARA não vá para o PUT no
 *     lugar dele (o servidor gravaria "••••4821" como token: para ele é só uma
 *     string não vazia).
 *
 *  2. CAMPO DE SEGREDO EM BRANCO É "NÃO MEXI", NÃO "APAGUE". O formulário
 *     ABRE com os três em branco, porque o GET não os devolve — todo
 *     salvamento que não os retoque chega assim. É o caso comum, não o raro.
 *
 *  3. RECLASSIFICAÇÃO DE CATEGORIA É DINHEIRO. A Meta reclassifica template de
 *     utilidade para marketing por conta própria e anuncia isso em
 *     `correct_category`; marketing custa cerca de nove vezes mais por
 *     conversa, e "template misclassification" reincidente vira bloqueio de
 *     envio. Se a tela não mostrar, ninguém vê até a fatura.
 */

/** Os tons que a tela sabe pintar. Fechado de propósito: um tom novo que
 * ninguém desenhou sairia sem cor nenhuma. */
export const TONS = Object.freeze([
  "ok",
  "atencao",
  "pendente",
  "desligado",
  "erro",
  "neutro",
]);

/**
 * Os cinco campos de `CAMPOS_ESPERADOS` do WhatsappController, NA MESMA ORDEM
 * — que é também a ordem do formulário, de cima para baixo. `faltando` chega
 * do `GET /status` como estas chaves; a tradução para português é daqui.
 *
 * `ajuda` diz ONDE achar cada valor no painel da Meta. Sem isso a lista de
 * pendências é um enigma: "falta app_secret" não ensina ninguém a preenchê-lo.
 *
 * `numero_suporte` NÃO está aqui — o bot funciona sem ele (é o número que o
 * menu de suporte oferece ao cliente), e exigi-lo faria a tela pedir para
 * sempre algo que não é obrigatório.
 */
export const CAMPOS_ESPERADOS = Object.freeze([
  Object.freeze({
    chave: "access_token",
    rotulo: "Token de acesso permanente",
    segredo: true,
    ajuda:
      "Meta for Developers → seu app → WhatsApp → Configuração da API. O token " +
      "que aparece ali expira em 24 h: o permanente vem de um usuário do " +
      "sistema no Business Manager, com a permissão whatsapp_business_messaging.",
  }),
  Object.freeze({
    chave: "app_secret",
    rotulo: "Chave secreta do app (App Secret)",
    segredo: true,
    ajuda:
      "Meta for Developers → seu app → Configurações → Básico. É com ela que a " +
      "loja confere a assinatura do webhook — sem ela o aviso SAI, mas nenhuma " +
      "resposta do cliente é processada.",
  }),
  Object.freeze({
    chave: "verify_token",
    rotulo: "Token de verificação do webhook",
    segredo: true,
    ajuda:
      "Uma senha inventada por você. A MESMA string vai no campo “Verify token” " +
      "ao assinar o webhook na Meta — se as duas divergirem, o handshake falha " +
      "e nada é entregue à loja.",
  }),
  Object.freeze({
    chave: "phone_number_id",
    rotulo: "ID do número de telefone (Phone number ID)",
    segredo: false,
    ajuda:
      "WhatsApp → Configuração da API, logo abaixo do número. É um número " +
      "comprido de identificação — não é o telefone.",
  }),
  Object.freeze({
    chave: "waba_id",
    rotulo: "ID da conta do WhatsApp Business (WABA ID)",
    segredo: false,
    ajuda:
      "Na mesma tela de Configuração da API, em “ID da conta do WhatsApp " +
      "Business”. É ele que permite listar e criar os templates.",
  }),
]);

/** Os três que saem mascarados (`SEGREDOS` de `whatsappConfig.js`). */
export const SEGREDOS = Object.freeze(
  CAMPOS_ESPERADOS.filter((c) => c.segredo).map((c) => c.chave),
);

/**
 * Os campos de texto que o PUT aceita (`CAMPOS_DE_TEXTO` do backend). A ordem
 * não importa aqui; a lista, sim: é ela que impede chave estranha de virar
 * corpo de requisição.
 */
export const CAMPOS_DE_TEXTO = Object.freeze([
  "access_token",
  "app_secret",
  "verify_token",
  "phone_number_id",
  "waba_id",
  "numero_suporte",
]);

/** Os visíveis: voltam preenchidos no GET, e em branco querem dizer "limpe". */
export const CAMPOS_VISIVEIS = Object.freeze(
  CAMPOS_DE_TEXTO.filter((c) => !SEGREDOS.includes(c)),
);

/**
 * Os seis interruptores da 0017, com o que cada um dispara.
 *
 * `aviso_cancelado` responde por DOIS status da loja (cancelado e rejeitado),
 * porque os dois compartilham o template — e a tela diz isso, para ninguém
 * procurar um sétimo interruptor que não existe. `aviso_enviado` tem DOIS
 * templates: o pedido que sai com rastreio e o que sai sem.
 */
export const INTERRUPTORES = Object.freeze([
  Object.freeze({
    chave: "aviso_pendente",
    rotulo: "Pedido recebido",
    detalhe: "Sai assim que o pedido é criado, antes de o pagamento confirmar.",
    templates: Object.freeze(["pedido_recebido"]),
  }),
  Object.freeze({
    chave: "aviso_aprovado",
    rotulo: "Pagamento aprovado",
    detalhe: "Sai quando o pagamento é confirmado e o café entra em preparo.",
    templates: Object.freeze(["pagamento_aprovado"]),
  }),
  Object.freeze({
    chave: "aviso_enviado",
    rotulo: "Pedido enviado",
    detalhe:
      "Com código de rastreio, a mensagem leva o botão de acompanhar; sem " +
      "código, sai a versão que não promete o que não existe.",
    templates: Object.freeze(["pedido_enviado", "pedido_enviado_sem_rastreio"]),
  }),
  Object.freeze({
    chave: "aviso_entregue",
    rotulo: "Pedido entregue",
    detalhe: "Sai quando o pedido é marcado como entregue.",
    templates: Object.freeze(["pedido_entregue"]),
  }),
  Object.freeze({
    chave: "aviso_cancelado",
    rotulo: "Pedido cancelado ou rejeitado",
    detalhe:
      "Os dois status usam o mesmo texto — por isso um interruptor só, e não " +
      "dois que prometeriam um controle que não existe.",
    templates: Object.freeze(["pedido_cancelado"]),
  }),
  Object.freeze({
    chave: "aviso_reembolsado",
    rotulo: "Pedido reembolsado",
    detalhe: "Sai quando o estorno é registrado.",
    templates: Object.freeze(["pedido_reembolsado"]),
  }),
]);

/** As chaves booleanas do PUT: o interruptor geral e um por status. */
export const CAMPOS_BOOLEANOS = Object.freeze([
  "ativo",
  ...INTERRUPTORES.map((i) => i.chave),
]);

const campoEsperado = (chave) =>
  CAMPOS_ESPERADOS.find((c) => c.chave === chave) || null;

/** O nome em português de uma chave de `faltando`. Chave que não conhecemos
 * volta como veio — some da tela é pior do que aparecer feia. */
export const rotuloDoCampo = (chave) =>
  campoEsperado(chave)?.rotulo || String(chave);

/** "A, B e C" — a lista como se lê em voz alta. */
function emPortugues(itens) {
  const lista = itens.filter(Boolean);
  if (lista.length === 0) return "";
  if (lista.length === 1) return lista[0];
  return `${lista.slice(0, -1).join(", ")} e ${lista[lista.length - 1]}`;
}

/**
 * O que ainda falta preencher, em português, na ordem em que a tela mostra os
 * campos.
 *
 * A evidência de que um SEGREDO existe é a MÁSCARA, nunca o valor: o GET não
 * devolve `access_token`, devolve `access_token_mascara`. Perguntar pelo valor
 * faria a tela pedir para sempre um token que já está configurado.
 */
export function oQueFalta(config) {
  return CAMPOS_ESPERADOS.filter((campo) => {
    const preenchido = campo.segredo
      ? config?.[`${campo.chave}_mascara`]
      : config?.[campo.chave];
    return !preenchido;
  }).map((campo) => campo.rotulo);
}

/**
 * A frase da tarja de estado — a primeira coisa que o gestor lê nesta tela.
 *
 * DESLIGADO É ESTADO CONHECIDO, NÃO ERRO, e a distinção não é cosmética: é ela
 * que decide se a tela pinta vermelho (algo quebrou, corra) ou azul (falta
 * terminar de configurar, no seu tempo). Hoje, com o número da loja ainda
 * inexistente, o estado NORMAL desta tela é "pendente" — e uma tela que grita
 * erro no estado normal ensina o gestor a ignorar o vermelho.
 *
 * `ligado` do backend é `configurado()`, que já inclui `ativo`: com `faltando`
 * vazio, o único motivo de `ligado:false` é o interruptor geral estar em não.
 *
 * A ordem das perguntas é a da urgência: o erro da Meta primeiro (é o único
 * que pode ter aparecido de um dia para o outro numa instalação que funcionava),
 * depois o que falta, depois o interruptor.
 */
export function descreverStatus(status) {
  if (!status || typeof status !== "object") {
    return {
      tom: "neutro",
      titulo: "Conferindo…",
      frase: "Ainda não foi possível ler o estado da integração.",
      faltando: [],
    };
  }

  const faltando = (Array.isArray(status.faltando) ? status.faltando : []).map(
    rotuloDoCampo,
  );

  if (status.erro) {
    return {
      tom: "erro",
      titulo: "A Meta recusou a consulta ao número",
      // A frase vem redigida do `whatsappClient` (sem token, sem telefone) e é
      // o diagnóstico inteiro — trocá-la por "erro ao consultar" jogaria fora
      // o motivo. O código é o que se procura na documentação da Meta.
      frase:
        status.codigo != null
          ? `${status.erro} (código ${status.codigo})`
          : String(status.erro),
      faltando,
    };
  }

  if (status.ligado === false) {
    if (faltando.length > 0) {
      return {
        tom: "pendente",
        titulo: "Integração ainda não configurada",
        frase:
          `Falta preencher: ${emPortugues(faltando)}. ` +
          "Enquanto isso, nenhum aviso de WhatsApp sai — a loja continua " +
          "vendendo e avisando por e-mail normalmente.",
        faltando,
      };
    }
    return {
      tom: "desligado",
      titulo: "Integração desligada",
      frase:
        "A credencial está completa, mas a integração está desligada: nenhum " +
        "aviso sai e nenhuma resposta de cliente é processada. Ligue o " +
        "interruptor geral abaixo quando quiser começar.",
      faltando,
    };
  }

  if (faltando.length > 0) {
    return {
      tom: "atencao",
      titulo: "Funciona pela metade",
      frase:
        `Os avisos saem, mas ainda falta preencher: ${emPortugues(faltando)}. ` +
        "Sem a chave secreta ou o token de verificação, o cliente responde e " +
        "nada acontece — a loja descarta a mensagem na porta, sem log. Sem o " +
        "ID da conta, não dá para listar nem criar template.",
      faltando,
    };
  }

  return {
    tom: "ok",
    titulo: "Integração ligada",
    frase:
      "Credencial completa e avisos ligados. Os interruptores abaixo decidem " +
      "quais status avisam o cliente.",
    faltando,
  };
}

/**
 * O número da Meta — que HOJE ainda não existe, e é por isso que esta função
 * trata o `null` como o caso principal e não como falha.
 *
 * `quality_rating` é o que a Meta usa para limitar (e depois bloquear) envio:
 * vermelho é problema real e a tela precisa gritar, verde é silêncio.
 */
export function descreverNumero(numero) {
  if (!numero || typeof numero !== "object") {
    return {
      tom: "pendente",
      titulo: "Nenhum número conectado ainda",
      frase:
        "Assim que o número da loja for criado no WhatsApp Business e a " +
        "credencial for colada aqui, este bloco mostra o número, o nome " +
        "verificado e a nota de qualidade que a Meta dá a ele.",
    };
  }

  const nome = numero.verified_name || "sem nome verificado";
  const telefone = numero.display_phone_number || "número não informado";

  const qualidade = {
    GREEN: { tom: "ok", frase: "Qualidade alta (verde) — envio sem limitação." },
    YELLOW: {
      tom: "atencao",
      frase:
        "Qualidade média (amarela) — clientes andaram bloqueando ou " +
        "denunciando as mensagens. Reveja frequência e conteúdo antes de virar " +
        "vermelha.",
    },
    RED: {
      tom: "erro",
      frase:
        "Qualidade baixa (vermelha) — a Meta já limita o envio deste número e " +
        "pode bloqueá-lo. Pare de disparar o que não for transacional.",
    },
  }[numero.quality_rating] || {
    tom: "neutro",
    frase: "A Meta ainda não avaliou a qualidade deste número.",
  };

  const verificacao =
    numero.code_verification_status === "VERIFIED"
      ? "Número verificado."
      : numero.code_verification_status
        ? `Verificação do número: ${numero.code_verification_status}.`
        : "";

  return {
    tom: qualidade.tom,
    titulo: `${telefone} — ${nome}`,
    frase: `${qualidade.frase}${verificacao ? ` ${verificacao}` : ""}`,
  };
}

/** O que a tela pode dizer sobre um segredo: só se ele existe, e a máscara. */
export function descreverSegredo(mascara) {
  return mascara
    ? { configurado: true, frase: `configurado (${mascara})` }
    : { configurado: false, frase: "não configurado" };
}

/**
 * Os motivos de rejeição que a Meta usa, em português. A lista é curta de
 * propósito: o que ela não cobre volta CRU, porque um código desconhecido
 * ainda é buscável na documentação — e engoli-lo deixaria o gestor com
 * "rejeitado" e nada mais.
 */
const MOTIVO_DA_REJEICAO = Object.freeze({
  INVALID_FORMAT:
    "formato inválido: quase sempre é variável no começo ou no fim do corpo, " +
    "ou variável sem valor de exemplo",
  TAG_CONTENT_MISMATCH:
    "o texto não corresponde à categoria escolhida — o conteúdo parece " +
    "promocional para um template de utilidade",
  INCORRECT_CATEGORY:
    "categoria errada: a Meta entende que este texto é de outra categoria",
  SCAM: "a Meta classificou o conteúdo como golpe",
  ABUSIVE_CONTENT: "a Meta classificou o conteúdo como abusivo",
  PROMOTIONAL: "o conteúdo foi lido como promocional",
  NONE: "a Meta não informou o motivo",
});

/**
 * O estado de UM template na Meta, do jeito que o gestor precisa ler.
 *
 * `status: null` é "não existe lá" — e esse é o estado que a tela existe para
 * mostrar: a loja dispara o template mesmo assim, a Meta responde 132001 e o
 * cliente simplesmente não recebe aviso nenhum. Sem esta linha, o sintoma é
 * "o WhatsApp não está mandando" e não há onde olhar.
 *
 * `categoria` sai separado do `detalhe` porque é outra conversa: não é o
 * template que está errado, é a Meta anunciando que vai passar a cobrar como
 * marketing (cerca de nove vezes mais por conversa).
 */
export function descreverTemplate(template) {
  const t = template || {};
  const categoria =
    t.category && t.correct_category && t.category !== t.correct_category
      ? `A Meta vai reclassificar este template de ${t.category} para ` +
        `${t.correct_category}. Conversa de MARKETING custa muitas vezes mais ` +
        "que a de UTILITY, e a reclassificação repetida vira bloqueio de " +
        "envio: reveja o texto (nada de oferta, cupom ou convite) ou aceite o " +
        "custo novo."
      : null;

  if (!t.status) {
    return {
      tom: "pendente",
      rotulo: "ainda não criado na Meta",
      detalhe:
        "A loja dispara este template mesmo assim, e a Meta recusa com o erro " +
        "132001 — o cliente não recebe nada. Use “Criar na Meta” abaixo.",
      categoria,
    };
  }

  switch (t.status) {
    case "APPROVED":
      return {
        tom: categoria ? "atencao" : "ok",
        rotulo: "Aprovado",
        detalhe: "Pronto para uso.",
        categoria,
      };
    case "PENDING":
    case "IN_APPEAL":
      return {
        tom: "atencao",
        rotulo: t.status === "IN_APPEAL" ? "Em recurso" : "Em revisão",
        detalhe:
          "A Meta ainda está revisando. Costuma levar minutos, mas pode levar " +
          "até 24 horas; até aprovar, o envio deste aviso falha.",
        categoria,
      };
    case "REJECTED": {
      const motivo = t.rejected_reason
        ? `${MOTIVO_DA_REJEICAO[t.rejected_reason] || "motivo não traduzido"} (${t.rejected_reason})`
        : "a Meta não informou o motivo";
      return {
        tom: "erro",
        rotulo: "Rejeitado",
        detalhe:
          `Motivo: ${motivo}. Corrija o texto em ` +
          "backend/src/utils/whatsappMensagens.js, apague o template no " +
          "Gerenciador da Meta e crie de novo por aqui.",
        categoria,
      };
    }
    case "PAUSED":
      return {
        tom: "erro",
        rotulo: "Pausado pela Meta",
        detalhe:
          "Clientes marcaram as mensagens como indesejadas e a Meta suspendeu " +
          "a entrega deste template por um tempo. Ele volta sozinho; enquanto " +
          "isso, o aviso não sai.",
        categoria,
      };
    case "DISABLED":
      return {
        tom: "erro",
        rotulo: "Desativado pela Meta",
        detalhe:
          "A Meta desativou este template de vez — o aviso não vai sair até " +
          "que um template novo, com outro texto, seja criado.",
        categoria,
      };
    default:
      // Status novo do lado de lá: mostrar cru é melhor do que traduzir para
      // "desconhecido" e esconder a única pista.
      return {
        tom: "atencao",
        rotulo: String(t.status),
        detalhe: `A Meta respondeu o status ${t.status}, que esta tela ainda não conhece.`,
        categoria,
      };
  }
}

/**
 * Este template pede a mão do gestor?
 *
 * A pergunta que dá nome à função é a da RECLASSIFICAÇÃO — o sinal caro e
 * invisível: a Meta anuncia em `correct_category` que vai mudar a cobrança, e
 * quem não olhar descobre na fatura. Rejeitado, pausado e desativado entram
 * porque também exigem ação, e o mesmo distintivo serve aos quatro.
 *
 * "Ainda não criado" NÃO entra: ele tem bloco e botão próprios logo ali, e
 * marcar os sete de uma vez numa instalação nova transformaria o distintivo em
 * ruído — que é como se ensina alguém a não olhar mais para ele.
 */
export function precisaDeAtencao(template) {
  const t = template || {};
  if (
    t.category &&
    t.correct_category &&
    t.category !== t.correct_category
  ) {
    return true;
  }
  return ["REJECTED", "PAUSED", "DISABLED"].includes(t.status);
}

/** Os status de `canastra.whatsapp_mensagens` (0017), em português. */
const ESTADO_DO_ENVIO = Object.freeze({
  pendente: {
    tom: "neutro",
    rotulo: "Na fila",
    detalhe: "Aceita pela Meta e ainda sem confirmação de entrega.",
  },
  enviada: {
    tom: "ok",
    rotulo: "Enviada",
    detalhe: "A Meta aceitou a mensagem.",
  },
  entregue: {
    tom: "ok",
    rotulo: "Entregue",
    detalhe: "Chegou ao aparelho do cliente.",
  },
  lida: { tom: "ok", rotulo: "Lida", detalhe: "O cliente abriu a mensagem." },
});

/**
 * Uma linha do histórico.
 *
 * A FRASE DA FALHA É A DO SERVIDOR — `erro_texto` é o que o `whatsappClient`
 * escreveu ("o template pedido_recebido não existe", "o número não tem opt-in",
 * "o token expirou"), e é o diagnóstico inteiro. Trocá-la por "falha no envio"
 * é o que transforma um problema de dois minutos em chamado.
 */
export function rotuloDeEnvio(mensagem) {
  const m = mensagem || {};

  if (m.status === "falhou") {
    const texto = typeof m.erro_texto === "string" ? m.erro_texto.trim() : "";
    const codigo = m.erro_codigo != null ? String(m.erro_codigo) : "";
    const detalhe = texto
      ? codigo && !texto.includes(codigo)
        ? `${texto} (código ${codigo})`
        : texto
      : codigo
        ? `A Meta recusou o envio (código ${codigo}). Veja o log do servidor.`
        : "A Meta recusou o envio e não informou o motivo. Veja o log do servidor.";
    return { tom: "erro", rotulo: "Falhou", detalhe };
  }

  const conhecido = Object.hasOwn(ESTADO_DO_ENVIO, m.status)
    ? ESTADO_DO_ENVIO[m.status]
    : null;
  if (conhecido) return { ...conhecido };

  if (!m.status) {
    return { tom: "neutro", rotulo: "—", detalhe: "Sem status registrado." };
  }
  return {
    tom: "neutro",
    rotulo: String(m.status),
    detalhe: `Status "${m.status}", que esta tela ainda não conhece.`,
  };
}

/** Máscara é `••••` mais quatro caracteres (`mascarar()` no backend). O que
 * começa assim NÃO é valor digitado — é o que o GET devolveu. */
const PARECE_MASCARA = /^[••*]{2,}/;

/**
 * O corpo do `PUT /whatsapp/config`, montado do formulário — e a peneira que
 * evita os dois desastres opostos desta tela.
 *
 * 1. SEGREDO EM BRANCO NÃO ENTRA. Em branco é o estado normal (o GET não
 *    devolve o valor), e o backend trata `""` num segredo como "não mexi" — mas
 *    não mandar é mais honesto do que depender disso, e deixa o `NADA_A_GRAVAR`
 *    do servidor significar o que diz.
 *
 * 2. MÁSCARA NÃO ENTRA. Se um dia alguém preencher o input com o que veio do
 *    GET, o que chegaria ao servidor seria "••••4821" — e ele gravaria isso
 *    como token, porque para ele é só uma string não vazia. A integração
 *    morreria com um clique em “Salvar”, e a tela diria "salvo".
 *
 * 3. INTERRUPTOR É BOOLEANO DE VERDADE. O backend recusa a string com 400
 *    (`CAMPO_INVALIDO`) — e se não recusasse, `"false"` é truthy e LIGARIA o
 *    aviso que o gestor acabou de desligar.
 *
 * A iteração é pelas LISTAS DESTE MÓDULO, nunca pelas chaves do formulário:
 * assim nenhuma máscara, nenhum `atualizado_em` e nenhuma chave inventada
 * atravessa — a mesma disciplina de `peneirarConfig` no backend.
 */
export function corpoDaConfig(formulario) {
  const form = formulario && typeof formulario === "object" ? formulario : {};
  const corpo = {};

  for (const chave of CAMPOS_BOOLEANOS) corpo[chave] = Boolean(form[chave]);

  for (const chave of SEGREDOS) {
    const texto = typeof form[chave] === "string" ? form[chave].trim() : "";
    if (!texto || PARECE_MASCARA.test(texto)) continue;
    corpo[chave] = texto;
  }

  for (const chave of CAMPOS_VISIVEIS) {
    const valor = form[chave];
    // `""` num campo visível é "limpar" para o backend, e é o que se quer: ele
    // volta preenchido no GET, então em branco é o gestor tendo apagado.
    corpo[chave] =
      valor === null || valor === undefined ? "" : String(valor).trim();
  }

  return corpo;
}

/**
 * A FRASE QUE O GESTOR LÊ QUANDO O SERVIDOR RECUSA.
 *
 * Mesmo desenho de `blingContrato.fraseDeErro`, com os fallbacks desta
 * integração. `message` primeiro porque as rotas de `/whatsapp` escrevem
 * português PARA ESTA TELA — inclusive a frase da Meta, que o `whatsappClient`
 * já redige sem token e sem telefone. `error` é a segunda escolha porque o
 * resto do painel usa `{ error: "frase" }` e é assim que um 401/403 do
 * middleware chega.
 *
 * 403, 503 e 500 são TRÊS COISAS DIFERENTES e a tela precisa dizer qual: 403 é
 * conta sem papel de administrador (nada a configurar), 503 é integração
 * incompleta ou desligada (falta preencher, e é o estado normal de hoje), 500 é
 * falha de verdade (é hora de olhar o log).
 */
export function fraseDeErro(status, corpo) {
  const doServidor =
    corpo && typeof corpo === "object" ? corpo.message || corpo.error : null;
  // Um código cru ("WHATSAPP_DESLIGADO") não é frase: se for só isso que veio,
  // o fallback por status explica mais.
  if (typeof doServidor === "string" && /\s/.test(doServidor.trim())) {
    return doServidor.trim();
  }

  switch (status) {
    case 401:
      return "Sua sessão expirou. Entre de novo no painel.";
    case 403:
      return "Esta tela é de administrador — sua conta não tem esse papel.";
    case 404:
      return (
        "O servidor não conhece esta rota (/whatsapp). Confira se a API foi " +
        "atualizada e reiniciada."
      );
    case 502:
      return (
        "A Meta recusou a chamada e não explicou o motivo. Tente de novo em " +
        "alguns minutos; se insistir, confira o token no painel da Meta."
      );
    case 503:
      return (
        "A integração com o WhatsApp não está pronta para esta ação: complete " +
        "a configuração e ligue o interruptor geral nesta tela."
      );
    case 504:
      return "A Meta não respondeu a tempo. Tente de novo em alguns minutos.";
    default:
      return `O servidor recusou a ação (erro ${status}).`;
  }
}
