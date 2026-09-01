"use strict";

const pool = require("../pgPool");
const { ehUuid } = require("../utils/formatoUuid");
const { registrar, ACOES, ENTIDADES } = require("../services/adminLog");

/**
 * O CRUD das três tabelas que a migração 0033 criou: `campanhas`,
 * `consentimentos` e `envios`.
 *
 * TODO CHECK DE 0033 É CONFERIDO AQUI ANTES DE IR AO BANCO, e não por
 * desconfiança do banco: o CHECK é a garantia, esta camada é a FRASE. Um 23514
 * subindo vira "Erro interno no servidor." no navegador, e o gestor abre chamado
 * por algo que ele resolveria sozinho ("o canal tem de ser um destes cinco").
 *
 * `atualizada_em` é escrita À MÃO em toda alteração: não há trigger de
 * moddatetime neste schema (regra desde 0005), e a coluna mente se quem escreve
 * não carimbar.
 */

/** Os vocabulários fechados de 0033, na mesma ordem dos CHECKs. */
const CANAIS_DE_CAMPANHA = Object.freeze([
  "google",
  "meta",
  "email",
  "whatsapp",
  "sms",
  "organico",
  "influenciador",
  "outro",
]);
const CANAIS_DE_CONTATO = Object.freeze(["email", "whatsapp", "sms"]);
const ESTADOS_DE_CONSENTIMENTO = Object.freeze(["concedido", "revogado"]);
const ESTADOS_DE_ENVIO = Object.freeze([
  "pendente",
  "enviado",
  "entregue",
  "lido",
  "falhou",
]);

const COLUNAS_DE_CAMPANHA = `
  id, nome, canal, utm_campaign, custo_centavos, inicio_em, fim_em, ativa,
  criada_em, atualizada_em
`;

const COLUNAS_DE_CONSENTIMENTO = `
  id, user_id, email, telefone, canal, estado, origem, texto_aceito, ip, criado_em
`;

const COLUNAS_DE_ENVIO = `
  id, canal, campanha_id, user_id, destinatario_final, template, estado,
  provedor_id, erro_texto, criado_em, enviado_em, entregue_em
`;

/** Erro de PEDIDO (400/404/409), com frase — nunca um 500 com SQLSTATE. */
function recusa(mensagem, status = 400) {
  const erro = new Error(mensagem);
  erro.status = status;
  return erro;
}

function textoOuNull(valor) {
  const texto = valor === undefined || valor === null ? "" : String(valor).trim();
  return texto === "" ? null : texto;
}

/**
 * A UTM canônica do CHECK `campanhas_utm_canonico`: minúscula, sem espaço, de
 * 1 a 120 caracteres.
 *
 * MAIÚSCULA É NORMALIZADA E ESPAÇO É RECUSADO, e a assimetria é deliberada.
 * Quem copia a UTM da planilha do anúncio não tem por que conhecer a regra, e
 * `lower()` é uma conversão sem perda — a UTM é uma CHAVE de junção com
 * `pedidos.utm_campaign`, e "Verao" e "verao" partindo a mesma campanha em duas
 * linhas de relatório é o defeito que o CHECK existe para impedir. Espaço, não:
 * "dia das maes" e "dia-das-maes" são decisões diferentes sobre a mesma
 * campanha, e escolher uma por conta própria mudaria a chave que o anúncio já
 * está usando lá fora.
 */
function utmCanonica(valor) {
  const bruto = textoOuNull(valor);
  if (bruto === null) return null;
  const normalizada = bruto.toLowerCase();
  if (/\s/.test(normalizada)) {
    throw recusa(
      "A UTM da campanha não pode conter espaço — use hífen (dia-das-maes-2026).",
    );
  }
  if (normalizada.length > 120) {
    throw recusa("A UTM da campanha é longa demais (máximo de 120 caracteres).");
  }
  return normalizada;
}

/** Data opcional: `""` do datetime-local vira NULL, como nas promoções. */
function dataOuNull(valor, nome) {
  const bruto = textoOuNull(valor);
  if (bruto === null) return null;
  const data = new Date(bruto);
  if (Number.isNaN(data.getTime())) throw recusa(`Data inválida em "${nome}".`);
  return data.toISOString();
}

function inteiroNaoNegativo(valor, nome, padrao = 0) {
  if (valor === undefined || valor === null || String(valor).trim() === "") {
    return padrao;
  }
  const n = Number(valor);
  if (!Number.isInteger(n) || n < 0) {
    throw recusa(`"${nome}" precisa ser um inteiro em centavos, não negativo.`);
  }
  return n;
}

/** Paginação com piso, teto e padrão — o mesmo desenho das outras listagens. */
function paginacao(query) {
  const page = Math.max(1, Number.parseInt(query.page, 10) || 1);
  const limit = Math.min(100, Math.max(1, Number.parseInt(query.limit, 10) || 20));
  return { page, limit, offset: (page - 1) * limit };
}

async function listarComFiltro({ colunas, tabela, filtros, values, query, ordem }) {
  const where = filtros.length ? `WHERE ${filtros.join(" AND ")}` : "";
  const { page, limit, offset } = paginacao(query);

  const contagem = await pool.query(
    `SELECT COUNT(*) FROM canastra.${tabela} ${where}`,
    values,
  );
  const total = parseInt(contagem.rows[0].count, 10);

  const { rows } = await pool.query(
    `SELECT ${colunas} FROM canastra.${tabela}
     ${where}
     ORDER BY ${ordem}
     LIMIT $${values.length + 1} OFFSET $${values.length + 2}`,
    [...values, limit, offset],
  );

  return { data: rows, total, totalPages: Math.ceil(total / limit), page };
}

class MarketingRepository {
  /* ---------------------------------------------------------------------- *
   * Campanhas
   * ---------------------------------------------------------------------- */

  async listarCampanhas(query = {}) {
    const filtros = [];
    const values = [];

    const canal = textoOuNull(query.canal);
    if (canal) {
      if (!CANAIS_DE_CAMPANHA.includes(canal)) {
        throw recusa(`Canal inválido. Use um de: ${CANAIS_DE_CAMPANHA.join(", ")}.`);
      }
      values.push(canal);
      filtros.push(`canal = $${values.length}`);
    }

    if (query.ativa !== undefined && query.ativa !== "") {
      values.push(String(query.ativa) === "true");
      filtros.push(`ativa = $${values.length}`);
    }

    const q = textoOuNull(query.q);
    if (q) {
      values.push(`%${q}%`);
      const i = values.length;
      filtros.push(`(nome ILIKE $${i} OR utm_campaign ILIKE $${i})`);
    }

    return listarComFiltro({
      colunas: COLUNAS_DE_CAMPANHA,
      tabela: "campanhas",
      filtros,
      values,
      query,
      ordem: "criada_em DESC",
    });
  }

  /**
   * Cria a campanha — ou ATUALIZA a que já tem esta UTM.
   *
   * O `ON CONFLICT` REPETE O `WHERE` DO ÍNDICE, e essa linha é a razão de este
   * método existir em vez de um INSERT direto: `campanhas_utm_idx` é
   * `UNIQUE (utm_campaign) WHERE utm_campaign IS NOT NULL`, e o Postgres NÃO
   * INFERE índice parcial a partir de `ON CONFLICT (utm_campaign)` — a consulta
   * estoura 42P10 ("no unique or exclusion constraint matching"). O modo de
   * falha é cruel porque é TARDIO: a primeira campanha entra, e o erro só
   * aparece quando alguém salva a MESMA UTM de novo, que é o gesto normal de
   * reimportar a planilha do anúncio.
   *
   * E o upsert é o comportamento certo aqui, não um atalho: a UTM É a
   * identidade da campanha lá fora (é o que chega em `pedidos.utm_campaign`), e
   * criar uma segunda linha com a mesma UTM partiria a atribuição em duas.
   * Campanha SEM utm não conflita com nada — o índice é parcial justamente para
   * o panfleto e o influenciador sem link rastreado conviverem.
   */
  async salvarCampanha({ dados, adminUserId }) {
    const nome = textoOuNull(dados.nome);
    if (!nome) throw recusa("A campanha precisa de um nome.");

    const canal = textoOuNull(dados.canal);
    if (!CANAIS_DE_CAMPANHA.includes(canal)) {
      throw recusa(`Canal inválido. Use um de: ${CANAIS_DE_CAMPANHA.join(", ")}.`);
    }

    const utm = utmCanonica(dados.utm_campaign);
    const inicioEm = dataOuNull(dados.inicio_em, "inicio_em");
    const fimEm = dataOuNull(dados.fim_em, "fim_em");
    if (inicioEm && fimEm && new Date(fimEm) <= new Date(inicioEm)) {
      throw recusa("O fim da campanha precisa ser depois do início.");
    }

    const valores = [
      nome,
      canal,
      utm,
      inteiroNaoNegativo(dados.custo_centavos, "custo_centavos"),
      inicioEm,
      fimEm,
      dados.ativa === undefined ? true : Boolean(dados.ativa),
    ];

    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      // `xmax = 0` distingue INSERT de UPDATE na MESMA ida: é o único jeito de
      // responder 201 ou 200 com honestidade sem uma consulta a mais.
      const { rows } = await client.query(
        `INSERT INTO canastra.campanhas
           (nome, canal, utm_campaign, custo_centavos, inicio_em, fim_em, ativa)
         VALUES ($1,$2,$3,$4,$5,$6,$7)
         ON CONFLICT (utm_campaign) WHERE utm_campaign IS NOT NULL
         DO UPDATE SET
           nome = EXCLUDED.nome,
           canal = EXCLUDED.canal,
           custo_centavos = EXCLUDED.custo_centavos,
           inicio_em = EXCLUDED.inicio_em,
           fim_em = EXCLUDED.fim_em,
           ativa = EXCLUDED.ativa,
           atualizada_em = now()
         RETURNING ${COLUNAS_DE_CAMPANHA}, (xmax = 0) AS criou`,
        valores,
      );

      const campanha = rows[0];
      const criou = campanha.criou;
      delete campanha.criou;

      await registrar(client, {
        adminUserId,
        acao: criou ? ACOES.CAMPANHA_CRIADA : ACOES.CAMPANHA_ALTERADA,
        entidade: ENTIDADES.CAMPANHA,
        entidadeId: campanha.id,
        depois: { nome: campanha.nome, canal: campanha.canal, utm_campaign: utm },
      });

      await client.query("COMMIT");
      return { campanha, criou };
    } catch (erro) {
      await client.query("ROLLBACK").catch(() => {});
      throw erro;
    } finally {
      client.release();
    }
  }

  /**
   * PATCH PARCIAL de verdade: só o que veio no corpo muda.
   *
   * É o conserto explícito do defeito que `PUT /promotions/:id` carrega nesta
   * loja — lá o repositório escreve TODAS as colunas com o que veio no corpo, e
   * campo ausente vira NULL: um formulário que mande só o campo alterado apaga
   * título, datas e categoria. E aquela rota responde 200 num id inexistente,
   * tendo atualizado zero linhas. As duas coisas ficam de fora daqui: o UPDATE
   * é dinâmico, e `rowCount === 0` é 404.
   */
  async atualizarCampanha({ id, dados, adminUserId }) {
    if (!ehUuid(id)) throw recusa("Identificador de campanha inválido.");

    const campos = {};
    if ("nome" in dados) {
      const nome = textoOuNull(dados.nome);
      if (!nome) throw recusa("A campanha precisa de um nome.");
      campos.nome = nome;
    }
    if ("canal" in dados) {
      const canal = textoOuNull(dados.canal);
      if (!CANAIS_DE_CAMPANHA.includes(canal)) {
        throw recusa(`Canal inválido. Use um de: ${CANAIS_DE_CAMPANHA.join(", ")}.`);
      }
      campos.canal = canal;
    }
    if ("utm_campaign" in dados) campos.utm_campaign = utmCanonica(dados.utm_campaign);
    if ("custo_centavos" in dados) {
      campos.custo_centavos = inteiroNaoNegativo(dados.custo_centavos, "custo_centavos");
    }
    if ("inicio_em" in dados) campos.inicio_em = dataOuNull(dados.inicio_em, "inicio_em");
    if ("fim_em" in dados) campos.fim_em = dataOuNull(dados.fim_em, "fim_em");
    if ("ativa" in dados) campos.ativa = Boolean(dados.ativa);

    if (Object.keys(campos).length === 0) {
      throw recusa("Nada para alterar nesta campanha.");
    }

    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      const atual = await client.query(
        `SELECT ${COLUNAS_DE_CAMPANHA} FROM canastra.campanhas
          WHERE id = $1::uuid FOR UPDATE`,
        [id],
      );
      if (!atual.rows.length) {
        throw recusa("Campanha não encontrada.", 404);
      }

      // A JANELA É CONFERIDA SOBRE O RESULTADO FUNDIDO: mandar só `fim_em` num
      // PATCH poderia deixar fim antes de início, e o CHECK
      // `campanhas_janela_coerente` responderia 23514.
      const fundida = { ...atual.rows[0], ...campos };
      if (
        fundida.inicio_em &&
        fundida.fim_em &&
        new Date(fundida.fim_em) <= new Date(fundida.inicio_em)
      ) {
        throw recusa("O fim da campanha precisa ser depois do início.");
      }

      const nomes = Object.keys(campos);
      const atribuicoes = nomes.map((nome, i) => `${nome} = $${i + 1}`);
      atribuicoes.push("atualizada_em = now()");

      const { rows } = await client.query(
        `UPDATE canastra.campanhas SET ${atribuicoes.join(", ")}
          WHERE id = $${nomes.length + 1}::uuid
        RETURNING ${COLUNAS_DE_CAMPANHA}`,
        [...nomes.map((n) => campos[n]), id],
      );

      await registrar(client, {
        adminUserId,
        acao: ACOES.CAMPANHA_ALTERADA,
        entidade: ENTIDADES.CAMPANHA,
        entidadeId: id,
        // Só os campos TOCADOS entram no log, dos dois lados: guardar a linha
        // inteira faria todo diff parecer uma reescrita, e achar o que mudou
        // seria trabalho de quem lê.
        antes: Object.fromEntries(nomes.map((n) => [n, atual.rows[0][n]])),
        depois: Object.fromEntries(nomes.map((n) => [n, rows[0][n]])),
      });

      await client.query("COMMIT");
      return rows[0];
    } catch (erro) {
      await client.query("ROLLBACK").catch(() => {});
      throw erro;
    } finally {
      client.release();
    }
  }

  /* ---------------------------------------------------------------------- *
   * Consentimentos
   * ---------------------------------------------------------------------- */

  async listarConsentimentos(query = {}) {
    const filtros = [];
    const values = [];

    const canal = textoOuNull(query.canal);
    if (canal) {
      if (!CANAIS_DE_CONTATO.includes(canal)) {
        throw recusa(`Canal inválido. Use um de: ${CANAIS_DE_CONTATO.join(", ")}.`);
      }
      values.push(canal);
      filtros.push(`canal = $${values.length}`);
    }

    const estado = textoOuNull(query.estado);
    if (estado) {
      if (!ESTADOS_DE_CONSENTIMENTO.includes(estado)) {
        throw recusa(
          `Estado inválido. Use um de: ${ESTADOS_DE_CONSENTIMENTO.join(", ")}.`,
        );
      }
      values.push(estado);
      filtros.push(`estado = $${values.length}`);
    }

    const email = textoOuNull(query.email);
    if (email) {
      // `lower()` dos dois lados: quem digitou `Ana@Ex.com` no rodapé continua
      // sendo a titular de `ana@ex.com`, e o índice
      // `consentimentos_email_idx` é justamente sobre `lower(email)`.
      values.push(email.toLowerCase());
      filtros.push(`lower(email) = $${values.length}`);
    }

    const userId = textoOuNull(query.user_id);
    if (userId) {
      if (!ehUuid(userId)) throw recusa("Identificador de titular inválido.");
      values.push(userId);
      filtros.push(`user_id = $${values.length}::uuid`);
    }

    return listarComFiltro({
      colunas: COLUNAS_DE_CONSENTIMENTO,
      tabela: "consentimentos",
      filtros,
      values,
      query,
      ordem: "criado_em DESC",
    });
  }

  /**
   * Registra um consentimento — ou a REVOGAÇÃO dele.
   *
   * NÃO HÁ UPDATE NEM DELETE DE CONSENTIMENTO, e a ausência é a decisão: a
   * tabela é o HISTÓRICO da autorização, e é ele que responde "com base em quê
   * vocês me mandaram esta mensagem em março?". Revogar é uma linha NOVA com
   * `estado = 'revogado'`; editar a linha antiga apagaria a prova do que valia
   * antes — exatamente o que a prestação de contas da LGPD exige guardar.
   */
  async registrarConsentimento({ dados, adminUserId }) {
    const canal = textoOuNull(dados.canal);
    if (!CANAIS_DE_CONTATO.includes(canal)) {
      throw recusa(`Canal inválido. Use um de: ${CANAIS_DE_CONTATO.join(", ")}.`);
    }
    const estado = textoOuNull(dados.estado);
    if (!ESTADOS_DE_CONSENTIMENTO.includes(estado)) {
      throw recusa(`Estado inválido. Use um de: ${ESTADOS_DE_CONSENTIMENTO.join(", ")}.`);
    }
    const origem = textoOuNull(dados.origem);
    if (!origem) {
      throw recusa("Informe a origem do consentimento (de onde ele veio).");
    }

    const userId = textoOuNull(dados.user_id);
    if (userId && !ehUuid(userId)) throw recusa("Identificador de titular inválido.");
    const email = textoOuNull(dados.email);
    const telefone = textoOuNull(dados.telefone);

    // O CHECK `consentimentos_identifica_alguem` (0033) exige pelo menos um dos
    // três. Recusar aqui é a diferença entre uma frase e um 23514 opaco — e o
    // conselho ("diga de quem é") é o que a pessoa precisa ouvir.
    if (!userId && !email && !telefone) {
      throw recusa(
        "Um consentimento precisa identificar o titular: informe user_id, e-mail ou telefone.",
      );
    }

    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      const { rows } = await client.query(
        `INSERT INTO canastra.consentimentos
           (user_id, email, telefone, canal, estado, origem, texto_aceito, ip)
         VALUES ($1::uuid, $2, $3, $4, $5, $6, $7, $8::inet)
         RETURNING ${COLUNAS_DE_CONSENTIMENTO}`,
        [
          userId,
          email,
          telefone,
          canal,
          estado,
          origem,
          textoOuNull(dados.texto_aceito),
          textoOuNull(dados.ip),
        ],
      );

      await registrar(client, {
        adminUserId,
        acao: ACOES.CONSENTIMENTO_REGISTRADO,
        entidade: ENTIDADES.CONSENTIMENTO,
        entidadeId: rows[0].id,
        // O log guarda canal, estado e origem — não o `texto_aceito` nem o
        // contato. O dado pessoal já está na linha registrada; repeti-lo aqui
        // criaria mais uma cópia para redigir no dia da exclusão da conta.
        depois: { canal, estado, origem },
      });

      await client.query("COMMIT");
      return rows[0];
    } catch (erro) {
      await client.query("ROLLBACK").catch(() => {});
      throw erro;
    } finally {
      client.release();
    }
  }

  /* ---------------------------------------------------------------------- *
   * Envios
   * ---------------------------------------------------------------------- */

  async listarEnvios(query = {}) {
    const filtros = [];
    const values = [];

    const canal = textoOuNull(query.canal);
    if (canal) {
      if (!CANAIS_DE_CONTATO.includes(canal)) {
        throw recusa(`Canal inválido. Use um de: ${CANAIS_DE_CONTATO.join(", ")}.`);
      }
      values.push(canal);
      filtros.push(`canal = $${values.length}`);
    }

    const estado = textoOuNull(query.estado);
    if (estado) {
      if (!ESTADOS_DE_ENVIO.includes(estado)) {
        throw recusa(`Estado inválido. Use um de: ${ESTADOS_DE_ENVIO.join(", ")}.`);
      }
      values.push(estado);
      filtros.push(`estado = $${values.length}`);
    }

    const campanhaId = textoOuNull(query.campanha_id);
    if (campanhaId) {
      if (!ehUuid(campanhaId)) throw recusa("Identificador de campanha inválido.");
      values.push(campanhaId);
      filtros.push(`campanha_id = $${values.length}::uuid`);
    }

    return listarComFiltro({
      colunas: COLUNAS_DE_ENVIO,
      tabela: "envios",
      filtros,
      values,
      query,
      ordem: "criado_em DESC",
    });
  }

  async criarEnvio({ dados, adminUserId }) {
    const canal = textoOuNull(dados.canal);
    if (!CANAIS_DE_CONTATO.includes(canal)) {
      throw recusa(`Canal inválido. Use um de: ${CANAIS_DE_CONTATO.join(", ")}.`);
    }
    const destinatario = textoOuNull(dados.destinatario_final);
    if (!destinatario) throw recusa("Informe o destinatário do envio.");

    const campanhaId = textoOuNull(dados.campanha_id);
    if (campanhaId && !ehUuid(campanhaId)) {
      throw recusa("Identificador de campanha inválido.");
    }
    const userId = textoOuNull(dados.user_id);
    if (userId && !ehUuid(userId)) throw recusa("Identificador de titular inválido.");

    const estado = textoOuNull(dados.estado) || "pendente";
    if (!ESTADOS_DE_ENVIO.includes(estado)) {
      throw recusa(`Estado inválido. Use um de: ${ESTADOS_DE_ENVIO.join(", ")}.`);
    }

    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      const { rows } = await client.query(
        `INSERT INTO canastra.envios
           (canal, campanha_id, user_id, destinatario_final, template, estado,
            provedor_id, enviado_em)
         VALUES ($1, $2::uuid, $3::uuid, $4, $5, $6, $7,
                 CASE WHEN $6 IN ('enviado','entregue','lido') THEN now() END)
         RETURNING ${COLUNAS_DE_ENVIO}`,
        [
          canal,
          campanhaId,
          userId,
          destinatario,
          textoOuNull(dados.template),
          estado,
          textoOuNull(dados.provedor_id),
        ],
      );

      await registrar(client, {
        adminUserId,
        acao: ACOES.ENVIO_CRIADO,
        entidade: ENTIDADES.ENVIO,
        entidadeId: rows[0].id,
        depois: { canal, estado, campanha_id: campanhaId },
      });

      await client.query("COMMIT");
      return rows[0];
    } catch (erro) {
      await client.query("ROLLBACK").catch(() => {});
      if (erro.code === "23503") {
        throw recusa("Campanha ou titular não encontrado.", 404);
      }
      if (erro.code === "23505") {
        throw recusa("Já existe um envio com este id do provedor.", 409);
      }
      throw erro;
    } finally {
      client.release();
    }
  }

  /**
   * A vida do envio: pendente → enviado → entregue/lido, ou falhou.
   *
   * OS CARIMBOS SÃO ESCRITOS PELA ROTA, e é isso que impede dois 23514 que só
   * apareceriam em produção, com o webhook do provedor na linha:
   *
   *   `envios_entrega_depois_do_envio` — `entregue_em` exige `enviado_em`
   *     preenchido e não anterior a ele. Um provedor que só notifica a ENTREGA
   *     (ou uma notificação que chega fora de ordem) deixaria a coluna de envio
   *     vazia, e o UPDATE morreria. Aqui o envio é carimbado junto, com o mesmo
   *     `now()`: a ordem fica coerente e a informação que existe é preservada.
   *   `envios_erro_so_em_falha` — `erro_texto` só em estado 'falhou'. Recusado
   *     com frase, porque um texto de erro num envio bem-sucedido é quase
   *     sempre um estado errado sendo mandado junto.
   */
  async atualizarEnvio({ id, dados, adminUserId }) {
    if (!ehUuid(id)) throw recusa("Identificador de envio inválido.");

    const estado = textoOuNull(dados.estado);
    if (estado && !ESTADOS_DE_ENVIO.includes(estado)) {
      throw recusa(`Estado inválido. Use um de: ${ESTADOS_DE_ENVIO.join(", ")}.`);
    }
    const erroTexto = textoOuNull(dados.erro_texto);
    if (erroTexto && estado !== "falhou") {
      throw recusa("O texto de erro só existe em envio com estado 'falhou'.");
    }

    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      const atual = await client.query(
        `SELECT ${COLUNAS_DE_ENVIO} FROM canastra.envios
          WHERE id = $1::uuid FOR UPDATE`,
        [id],
      );
      if (!atual.rows.length) throw recusa("Envio não encontrado.", 404);
      const antes = atual.rows[0];

      const campos = {};
      if (estado) campos.estado = estado;
      if ("provedor_id" in dados) campos.provedor_id = textoOuNull(dados.provedor_id);
      if ("erro_texto" in dados) campos.erro_texto = erroTexto;

      // Os dois carimbos, nesta ordem: entrega implica envio.
      const virouEnviado = ["enviado", "entregue", "lido"].includes(estado);
      if (virouEnviado && !antes.enviado_em) campos.enviado_em = new Date();
      if (["entregue", "lido"].includes(estado) && !antes.entregue_em) {
        campos.entregue_em = campos.enviado_em || antes.enviado_em || new Date();
        if (!campos.enviado_em && !antes.enviado_em) {
          campos.enviado_em = campos.entregue_em;
        }
      }

      if (Object.keys(campos).length === 0) throw recusa("Nada para alterar neste envio.");

      const nomes = Object.keys(campos);
      const { rows } = await client.query(
        `UPDATE canastra.envios
            SET ${nomes.map((n, i) => `${n} = $${i + 1}`).join(", ")}
          WHERE id = $${nomes.length + 1}::uuid
        RETURNING ${COLUNAS_DE_ENVIO}`,
        [...nomes.map((n) => campos[n]), id],
      );

      await registrar(client, {
        adminUserId,
        acao: ACOES.ENVIO_ALTERADO,
        entidade: ENTIDADES.ENVIO,
        entidadeId: id,
        antes: { estado: antes.estado },
        depois: { estado: rows[0].estado },
      });

      await client.query("COMMIT");
      return rows[0];
    } catch (erro) {
      await client.query("ROLLBACK").catch(() => {});
      throw erro;
    } finally {
      client.release();
    }
  }
}

module.exports = new MarketingRepository();
module.exports.CANAIS_DE_CAMPANHA = CANAIS_DE_CAMPANHA;
module.exports.CANAIS_DE_CONTATO = CANAIS_DE_CONTATO;
module.exports.ESTADOS_DE_CONSENTIMENTO = ESTADOS_DE_CONSENTIMENTO;
module.exports.ESTADOS_DE_ENVIO = ESTADOS_DE_ENVIO;
