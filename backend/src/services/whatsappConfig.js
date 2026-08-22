"use strict";

/**
 * A credencial da Meta e os interruptores de aviso — as duas perguntas que
 * todo o resto do bot faz: "qual é a credencial?" e "este aviso está ligado?".
 *
 * ONDE A CREDENCIAL MORA, E POR QUÊ ESTE MÓDULO EXISTE.
 * A regra desta casa, estabelecida na 0012 (Bling): `.env` para o que o
 * operador cola uma vez e o processo nunca reescreve; banco para o que o
 * provedor rotaciona por trás do processo. Pelo critério puro o token de
 * System User da Meta seria `.env` — ele NÃO rotaciona. A decisão foi os
 * dois, com o banco na frente: ordem de leitura **memória → banco → env**,
 * exatamente a de `blingClient.js:118-136`. O painel é a fonte; a `.env` vale
 * como semente e como saída para quem preferir não ter segredo no banco. Foi o
 * que o dono da loja pediu ("deixar o bot configurado na dashboard"), e é o que
 * evita que ligar a integração exija entrar na VPS.
 *
 * A precedência é POR CAMPO, e o troco está dito: com a linha no banco e a
 * coluna em NULL, a `.env` ainda preenche — é o que permite a instalação mista
 * (o `app_secret` só na `.env`, o resto no painel). O efeito colateral honesto:
 * apagar um segredo no painel NÃO derruba o valor que continua na `.env`. Quem
 * desliga a integração é `ativo`, não o campo em branco.
 *
 * NENHUM LOG E NENHUMA MENSAGEM DE ERRO DESTE MÓDULO CARREGA O TOKEN — a mesma
 * disciplina de `blingClient.js:27-28`. Isso custa três defesas explícitas, e
 * nenhuma delas é enfeite:
 *   1. `paraOPainel()` devolve MÁSCARA. Um GET que devolvesse o valor deixaria
 *      o segredo no cache do navegador, no log do proxy e no DevTools de quem
 *      abrisse a tela.
 *   2. o log da falha de leitura leva só o código do erro, nunca `erro.message`.
 *   3. `gravar()` higieniza o erro do Postgres. O `DETAIL` de uma violação de
 *      NOT NULL é literalmente `Failing row contains (1, f, EAAG..., ...)` — a
 *      LINHA INTEIRA, token incluído. Repassar o erro cru do `pg` para o
 *      handler da rota é o caminho pelo qual o segredo iria parar no log do
 *      Express sem ninguém ter escrito `console.log(token)`.
 *
 * O QUE ESTAS TRÊS DEFESAS NÃO ALCANÇAM, dito para quem for escrever a rota:
 * `carregar()` devolve o token CRU — é para isso que ele existe, o remetente
 * precisa dele. Nunca passe o objeto inteiro para `console.log` nem para
 * `res.json()`; o que vai para tela e para log é `paraOPainel()`.
 *
 * O preço que continua de pé, porque é real: segredo em tabela entra em todo
 * `pg_dump` e é legível por quem tiver a `service_role` key. Aceito na 0012 e
 * aceito aqui; a mitigação é a tabela `canastra.whatsapp_config` não ter GRANT
 * nenhum para `anon` nem `authenticated` (0017) — só o Express a alcança.
 */

const pool = require("../pgPool");

/**
 * Os campos de texto: credencial e roteamento. Cada um pode ser semeado pela
 * `.env` (ver `SEMENTE_NA_ENV`) e cada um é NULL enquanto ninguém o preencher.
 */
const CAMPOS_DE_TEXTO = Object.freeze([
  "access_token",
  "app_secret",
  "verify_token",
  "phone_number_id",
  "waba_id",
  "numero_suporte",
]);

/**
 * Um interruptor por status, como a 0017 os criou — e não um jsonb. São NOT
 * NULL DEFAULT true no banco.
 */
const INTERRUPTORES = Object.freeze([
  "aviso_pendente",
  "aviso_aprovado",
  "aviso_enviado",
  "aviso_entregue",
  "aviso_cancelado",
  "aviso_reembolsado",
]);

/**
 * Os TRÊS segredos — os únicos que saem mascarados. `waba_id` e
 * `phone_number_id` são identificadores de conta: aparecem no painel da Meta
 * para qualquer um com acesso lá e não autorizam nada sozinhos. Mascará-los
 * só atrapalharia quem confere se o número certo está configurado.
 */
const SEGREDOS = Object.freeze(["access_token", "app_secret", "verify_token"]);

/**
 * A semente de cada campo na `.env`. `numero_suporte` reaproveita
 * `LOJA_WHATSAPP` — é o mesmo número humano que `db/seed.js` põe em
 * `config_loja.whatsapp` —, mas a coluna é própria de propósito (0017): lá o
 * número é público, aqui é destino de roteamento do bot, e mexer num não pode
 * mexer no outro.
 */
const SEMENTE_NA_ENV = Object.freeze({
  access_token: "META_ACCESS_TOKEN",
  app_secret: "META_APP_SECRET",
  verify_token: "META_VERIFY_TOKEN",
  phone_number_id: "META_PHONE_NUMBER_ID",
  waba_id: "META_WABA_ID",
  numero_suporte: "LOJA_WHATSAPP",
});

/**
 * O que `gravar()` aceita — e o "nem um a mais". Derivada das listas acima, e
 * não escrita à mão de novo, para as três não divergirem: um campo gravável
 * que ninguém lê de volta seria uma coluna escrita às cegas.
 *
 * A IMPORTÂNCIA DELA: `gravar()` itera por ESTA lista, nunca pelas chaves do
 * corpo recebido. Chave fora daqui é ignorada em silêncio, então um corpo de
 * requisição não escolhe qual coluna escrever — e o nome da coluna que entra
 * no SQL é sempre uma constante deste arquivo.
 */
const GRAVAVEIS = Object.freeze(["ativo", ...CAMPOS_DE_TEXTO, ...INTERRUPTORES]);

/**
 * Lista literal de colunas: nunca `SELECT *`, como `configRepository.js:12-21`.
 * Coluna nova na tabela não entra aqui sozinha — e é isso que se quer.
 */
const COLUNAS = ["id", "ativo", ...CAMPOS_DE_TEXTO, ...INTERRUPTORES, "atualizado_em"].join(", ");

/**
 * Qual interruptor responde por qual status.
 *
 * `rejeitado` compartilha o de `cancelado` porque compartilha o TEMPLATE
 * (`whatsappMensagens.js`: os dois viram `pedido_cancelado`) — dois
 * interruptores para um texto só seriam uma tela que promete um controle que
 * não existe. Status fora deste mapa não avisa ninguém, e isso é o mesmo
 * recorte do e-mail: `em_processamento` e `autorizado` ficam em silêncio de
 * propósito, por serem oscilação do gateway.
 */
const INTERRUPTOR_DO_STATUS = Object.freeze({
  pendente: "aviso_pendente",
  aprovado: "aviso_aprovado",
  enviado: "aviso_enviado",
  entregue: "aviso_entregue",
  cancelado: "aviso_cancelado",
  rejeitado: "aviso_cancelado",
  reembolsado: "aviso_reembolsado",
});

/** Os pontinhos da máscara. Quatro, fixos — o comprimento não vaza junto. */
const MASCARA = "••••";

/**
 * O cache do processo. Vive no módulo (singleton, como o pool): a configuração
 * vale para o processo inteiro e reler a cada aviso enviado seria uma ida ao
 * banco por mensagem. `esquecer()` e `gravar()` o invalidam — sem isso, o
 * gestor salvaria no painel e o bot seguiria com o valor velho até o restart.
 */
const memoria = { cfg: null };

/** Descarta o cache. O painel chama depois de gravar; os testes, entre casos. */
function esquecer() {
  memoria.cfg = null;
}

/** O valor da semente na `.env`, ou null. String vazia conta como ausente. */
function semente(campo) {
  return process.env[SEMENTE_NA_ENV[campo]] || null;
}

/**
 * Junta o que veio do banco com a semente da `.env`, campo a campo.
 *
 * `linha` é null quando a tabela ainda não tem a linha 1 — instalação nova,
 * que é o caso comum antes do primeiro salvamento no painel. Os padrões daí
 * repetem os DEFAULT da 0017 de propósito: divergir faria a MESMA instalação
 * se comportar de um jeito antes do primeiro salvamento e de outro depois.
 */
function comSemente(linha) {
  const cfg = {
    id: 1,
    // `ativo` é NOT NULL: com a linha presente, ela sempre decide. Sem linha,
    // vale a `.env`, com o literal "true" exigido — a mesma leitura de
    // BLING_ATIVO (`bling.routes.js:38`), que não aceita "1" nem "sim".
    ativo: linha ? linha.ativo : process.env.META_ATIVO === "true",
    atualizado_em: linha ? linha.atualizado_em : null,
  };

  for (const campo of CAMPOS_DE_TEXTO) {
    // Banco na frente, `.env` atrás — e a coluna em NULL cai para a semente.
    cfg[campo] = (linha ? linha[campo] : null) ?? semente(campo);
  }
  for (const campo of INTERRUPTORES) {
    cfg[campo] = linha ? linha[campo] : true;
  }

  // Congelado porque ESTE objeto é o cache: quem recebesse uma referência
  // mutável poderia desligar um aviso para o processo inteiro sem querer.
  return Object.freeze(cfg);
}

/**
 * A configuração vigente, na ordem memória → banco → env.
 *
 * O `catch` tolera banco fora do ar devolvendo só a semente da `.env`, como
 * `blingClient.js:122-136`: recusar aqui só anteciparia a falha, e a
 * verificação de assinatura do webhook ainda funciona com o `app_secret` da
 * env. O resultado degradado NÃO é cacheado — cacheá-lo prenderia o processo
 * na `.env` até o restart, muito depois de o banco voltar.
 *
 * MAS O DEGRADADO SAI DESLIGADO, e aqui ele se afasta do caminho sem linha de
 * propósito: `META_ATIVO=true` na `.env` LIGARIA de volta uma integração que o
 * gestor desligou no painel, só porque o banco piscou. Pior, é o mesmo banco
 * mudo que guarda `whatsapp_optout_em` — mandar mensagem sem poder conferir o
 * opt-out é gastar dinheiro escrevendo para quem pediu para parar. Falhar
 * fechado custa um aviso que não sai durante a pane; falhar aberto custa um
 * aviso que não devia ter saído nunca.
 */
async function carregar() {
  if (memoria.cfg) return memoria.cfg;

  let linha = null;
  try {
    const { rows } = await pool.query(
      `SELECT ${COLUNAS} FROM canastra.whatsapp_config WHERE id = 1`,
    );
    linha = rows[0] || null;
  } catch (erro) {
    // Só o código do erro: `erro.message` de um erro do pg pode ecoar valor.
    console.warn(
      `WhatsApp: não consegui ler a configuração do banco (${erro.code}); ` +
        "a integração fica DESLIGADA até a próxima leitura dar certo.",
    );
    return Object.freeze({ ...comSemente(null), ativo: false });
  }

  memoria.cfg = comSemente(linha);
  return memoria.cfg;
}

/**
 * Erro do Postgres sem o valor dentro.
 *
 * O `DETAIL` de uma violação de NOT NULL/CHECK é `Failing row contains (...)`
 * — a linha inteira, com o token. `message`, `detail` e `where` ficam TODOS
 * para trás; sobram o SQLSTATE (que é por onde os testes desta casa asseveram)
 * e os identificadores de coluna e constraint, que são nome, não valor.
 */
function erroSemSegredo(erro) {
  const onde = [erro.column, erro.constraint].filter(Boolean).join(", ");
  // "código" e não "SQLSTATE" na frase: uma queda de conexão traz
  // `ECONNREFUSED` aqui, que não é SQLSTATE nenhum e confundiria quem lesse.
  const limpo = new Error(
    `Não foi possível gravar a configuração do WhatsApp (código ${erro.code || "?"}` +
      `${onde ? `, em ${onde}` : ""}).`,
  );
  limpo.code = erro.code;
  return limpo;
}

/**
 * Grava os campos recebidos. PARCIAL: chave ausente (ou `undefined`) não
 * encosta na coluna — um PUT que salva só os interruptores não pode nular o
 * token. `null` explícito, esse sim, apaga.
 *
 * O INSERT antes do UPDATE é a defesa contra o pior modo de falha desta tela,
 * o mesmo que `configRepository.js:62-64` já trata: numa instalação sem seed a
 * linha 1 não existe e o `UPDATE ... WHERE id = 1` não atualiza nada SEM ERRO
 * NENHUM — o gestor salva no painel e acha que salvou.
 */
async function gravar(campos) {
  const atribuicoes = ["atualizado_em = now()"];
  const valores = [];

  for (const campo of GRAVAVEIS) {
    const valor = campos?.[campo];
    if (valor === undefined) continue;
    valores.push(valor);
    atribuicoes.push(`${campo} = $${valores.length}`);
  }

  try {
    await pool.query(
      "INSERT INTO canastra.whatsapp_config (id) VALUES (1) ON CONFLICT (id) DO NOTHING",
    );
    await pool.query(
      `UPDATE canastra.whatsapp_config SET ${atribuicoes.join(", ")} WHERE id = 1`,
      valores,
    );
  } catch (erro) {
    throw erroSemSegredo(erro);
  }

  // Depois da gravação, e não antes: se o UPDATE estourar, o cache ainda
  // guarda o estado que de fato está no banco.
  esquecer();
}

/**
 * Os campos sem os quais NADA sai daqui para a Meta. Uma constante, e não a
 * conjunção escrita à mão dentro de `configurado()`, porque o painel precisa
 * dizer ao gestor QUAL deles falta — e as duas respostas ("está pronto?" e "o
 * que falta?") não podem divergir uma da outra.
 */
const CAMPOS_MINIMOS = Object.freeze(["access_token", "phone_number_id"]);

/** A integração tem o mínimo para falar com a Meta E está ligada? */
function configurado(cfg) {
  return Boolean(cfg?.ativo) && CAMPOS_MINIMOS.every((campo) => Boolean(cfg?.[campo]));
}

/** Este status avisa o cliente? Status sem interruptor não avisa ninguém. */
function avisoLigado(cfg, status) {
  // `hasOwn` porque `status` vem de fora: sem ele, "constructor" acharia o
  // protótipo do objeto e o mapa responderia por um status que não existe.
  if (!Object.hasOwn(INTERRUPTOR_DO_STATUS, status)) return false;
  return Boolean(cfg?.[INTERRUPTOR_DO_STATUS[status]]);
}

/**
 * `••••` mais os quatro últimos, que é o bastante para o gestor reconhecer o
 * valor que ele colou sem que ninguém o reconstrua.
 *
 * Até QUATRO caracteres, os "quatro últimos" seriam o valor inteiro — daí o
 * corte ser em `> 4` e não em `>= 4`. Vazio devolve null: o painel precisa
 * distinguir "não configurado" de "configurado e escondido".
 */
function mascarar(valor) {
  if (!valor) return null;
  const texto = String(valor);
  return texto.length > 4 ? MASCARA + texto.slice(-4) : MASCARA;
}

/**
 * O que a tela do painel pode ver. Montado CAMPO A CAMPO, nunca por espalhar
 * `{ ...cfg }`: um espalhamento colocaria todo segredo novo na resposta por
 * omissão, e o dia em que isso acontecesse ninguém perceberia.
 */
async function paraOPainel() {
  const cfg = await carregar();

  const visivel = {
    ativo: cfg.ativo,
    phone_number_id: cfg.phone_number_id,
    waba_id: cfg.waba_id,
    numero_suporte: cfg.numero_suporte,
    atualizado_em: cfg.atualizado_em,
  };
  for (const campo of INTERRUPTORES) visivel[campo] = cfg[campo];
  for (const campo of SEGREDOS) visivel[`${campo}_mascara`] = mascarar(cfg[campo]);

  return visivel;
}

module.exports = {
  carregar,
  gravar,
  esquecer,
  configurado,
  avisoLigado,
  paraOPainel,
  /**
   * As listas saem daqui para o HANDLER DO PAINEL, e é de propósito que elas
   * saiam em vez de serem reescritas lá: quem valida o corpo do PUT precisa
   * saber quais campos são interruptor (booleano), quais são texto e quais são
   * SEGREDO — e um segredo classificado como texto comum viraria "campo em
   * branco apaga o token", que é o modo de falha que mata a integração com um
   * clique. Duas listas separadas divergiriam no dia em que um campo novo
   * entrasse em uma e não na outra.
   */
  CAMPOS_DE_TEXTO,
  INTERRUPTORES,
  SEGREDOS,
  CAMPOS_MINIMOS,
};
