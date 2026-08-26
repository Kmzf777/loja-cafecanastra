"use strict";

const pool = require("../pgPool");

/**
 * O conteúdo editável da vitrine: o herói da home e a barra de aviso.
 *
 * `GET` é público — a home é servida antes de qualquer login, e o herói é a
 * primeira coisa que ela desenha. `PUT` é de administrador, e a rota põe os
 * guardas (ver `routes/vitrine.routes.js`).
 *
 * ────────────────────────────────────────────────────────────────────────────
 * A REGRA DO `PUT`, QUE É O MOTIVO DE ESTE ARQUIVO EXISTIR SEPARADO
 *
 *   undefined (campo AUSENTE do corpo) ......... NÃO MEXER
 *   null ou "" ................................. GRAVAR VAZIO
 *
 * A distinção não é preciosismo: é o defeito de `PUT /config`
 * (`configRepository.js`) escrito ao contrário. Lá o corpo chega por multipart,
 * onde um campo enviado em branco vale `''` — que não é `undefined` e portanto
 * sobrescreve —, e `Number('')` é `0`, que no mínimo de frete grátis DESLIGA o
 * frete grátis da loja inteira. O gestor salva a barra de aviso e derruba a
 * margem de todo pedido, sem tocar naquele campo e sem ver erro nenhum.
 *
 * Aqui o corpo é JSON, então "ausente" existe de verdade: uma chave que não
 * está no objeto nunca vira coluna no UPDATE. E o inverso continua possível de
 * propósito — sem `""` significando "vazio", o gestor não teria como APAGAR um
 * kicker que não quer mais.
 *
 * `""` É NORMALIZADO PARA NULL na gravação. Com duas representações de "vazio"
 * na mesma coluna, todo consumidor teria de checar as duas para sempre — e o
 * fallback da home é exatamente a pergunta "está vazio?". Uma só.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * A FORMA DA RESPOSTA, e por que ela é fixa
 *
 *   { heroi:  { imagem_desktop, imagem_mobile },
 *     textos: { heroi:       { pt, en, es },
 *               barra_aviso: { pt, en, es } } }
 *
 * As duas chaves e os três idiomas SEMPRE presentes, com valor `null` quando
 * não há linha. Assim o consumidor nunca checa existência de chave, só de
 * valor — e um `textos.heroi.es.titulo` na home não estoura com "cannot read
 * properties of undefined" no dia em que faltar a linha do espanhol.
 */

/** O vocabulário fechado por CHECK na migração 0030. Repetido aqui para a
 *  recusa chegar ao painel como frase, e não como 23514 vindo do banco. */
const CHAVES = Object.freeze(["heroi", "barra_aviso"]);
const LOCALES = Object.freeze(["pt", "en", "es"]);

/** As colunas de conteúdo de cada tabela. Nada fora destas listas é escrito. */
const CAMPOS_DE_HEROI = Object.freeze(["imagem_desktop", "imagem_mobile"]);
const CAMPOS_DE_TEXTO = Object.freeze([
  "kicker",
  "titulo",
  "texto",
  "rotulo_botao",
  "destino",
  "imagem_alt",
]);

/** Recusa com frase, que a rota traduz em 400. */
class CorpoInvalido extends Error {
  constructor(mensagem) {
    super(mensagem);
    this.name = "CorpoInvalido";
  }
}

const ehObjeto = (v) =>
  typeof v === "object" && v !== null && !Array.isArray(v);

function listar(valores) {
  return valores.map((v) => `'${v}'`).join(", ");
}

/**
 * Um valor de conteúdo, já normalizado.
 *
 * `undefined` volta como `undefined` e o chamador o DESCARTA — é o "não mexer".
 * `null` e `""` viram `null`, o "gravar vazio". Qualquer outra coisa é recusa:
 * um número viraria texto no banco sem reclamar e um objeto viraria
 * "[object Object]" estampado no topo da loja.
 */
function normalizar(valor, ondeFica) {
  if (valor === undefined) return undefined;
  if (valor === null || valor === "") return null;
  if (typeof valor !== "string") {
    throw new CorpoInvalido(
      `O campo "${ondeFica}" precisa ser texto (ou null/"" para gravar vazio), e veio ${typeof valor}.`,
    );
  }
  return valor;
}

/**
 * Lê um bloco de campos e devolve só o que veio, já normalizado.
 *
 * CAMPO DESCONHECIDO É RECUSA, e não algo a ignorar. `title` no lugar de
 * `titulo` é a mesma família de erro que um locale `pt-BR`: aceito e ignorado,
 * o gestor salva, vê "salvo com sucesso" e o texto não muda — sem nada em lugar
 * nenhum apontando por quê. Barulhento é melhor.
 */
function camposEnviados(bloco, permitidos, ondeFica) {
  if (!ehObjeto(bloco)) {
    throw new CorpoInvalido(
      `"${ondeFica}" precisa ser um objeto com os campos a gravar.`,
    );
  }

  const enviados = {};
  for (const campo of Object.keys(bloco)) {
    if (!permitidos.includes(campo)) {
      throw new CorpoInvalido(
        `Campo desconhecido em "${ondeFica}": "${campo}". Os campos são: ${listar(permitidos)}.`,
      );
    }
    const valor = normalizar(bloco[campo], `${ondeFica}.${campo}`);
    if (valor !== undefined) enviados[campo] = valor;
  }
  return enviados;
}

/**
 * O corpo inteiro, validado ANTES de qualquer escrita.
 *
 * Validar tudo primeiro é o que torna o PUT tudo-ou-nada: um corpo com o 'pt'
 * certo e o 'pt-BR' errado grava ZERO, em vez de gravar metade e responder 400
 * — que deixaria o painel mostrando erro sobre um formulário que salvou pela
 * metade, o pior dos dois desfechos para quem está editando.
 */
function interpretar(corpo) {
  const entrada = corpo === undefined || corpo === null ? {} : corpo;
  if (!ehObjeto(entrada)) {
    throw new CorpoInvalido("O corpo precisa ser um objeto JSON.");
  }

  // Container ausente (ou null) é "não mexer", igual a campo ausente. Um
  // `heroi: null` que apagasse as duas imagens seria um atalho destrutivo que
  // ninguém pediu, e o painel tem um botão para isso: mandar `""` em cada uma.
  const heroi =
    entrada.heroi === undefined || entrada.heroi === null
      ? {}
      : camposEnviados(entrada.heroi, CAMPOS_DE_HEROI, "heroi");

  const textos = [];
  const porChave =
    entrada.textos === undefined || entrada.textos === null ? {} : entrada.textos;
  if (!ehObjeto(porChave)) {
    throw new CorpoInvalido(`"textos" precisa ser um objeto com as chaves ${listar(CHAVES)}.`);
  }

  for (const chave of Object.keys(porChave)) {
    if (!CHAVES.includes(chave)) {
      throw new CorpoInvalido(
        `Chave de texto inválida: "${chave}". As chaves são: ${listar(CHAVES)}.`,
      );
    }
    const porLocale = porChave[chave];
    if (!ehObjeto(porLocale)) {
      throw new CorpoInvalido(
        `"textos.${chave}" precisa ser um objeto com os idiomas ${listar(LOCALES)}.`,
      );
    }

    for (const locale of Object.keys(porLocale)) {
      if (!LOCALES.includes(locale)) {
        // A lista fechada existe porque a vitrine procura por 'pt' (é o que
        // `app/[locale]` usa): um 'pt-BR' gravado nunca seria lido, e o gestor
        // veria o texto sumir sem uma linha de erro.
        throw new CorpoInvalido(
          `Idioma inválido em "textos.${chave}": "${locale}". Os idiomas são: ${listar(LOCALES)}.`,
        );
      }
      const valores = camposEnviados(
        porLocale[locale],
        CAMPOS_DE_TEXTO,
        `textos.${chave}.${locale}`,
      );
      if (Object.keys(valores).length) textos.push({ chave, locale, valores });
    }
  }

  return { heroi, textos };
}

/** O estado atual das duas tabelas, na forma fixa do contrato. */
async function buscarVitrine(executor = pool) {
  const [heroi, textos] = await Promise.all([
    executor.query(
      "SELECT imagem_desktop, imagem_mobile FROM canastra.vitrine_heroi WHERE id = 1",
    ),
    executor.query(
      `SELECT chave, locale, ${CAMPOS_DE_TEXTO.join(", ")}
         FROM canastra.vitrine_texto`,
    ),
  ]);

  // O esqueleto nasce completo e SÓ DEPOIS é preenchido — é o que garante as
  // duas chaves e os três idiomas mesmo com as tabelas vazias.
  const porChave = {};
  for (const chave of CHAVES) {
    porChave[chave] = {};
    for (const locale of LOCALES) porChave[chave][locale] = null;
  }

  for (const linha of textos.rows) {
    const valores = {};
    for (const campo of CAMPOS_DE_TEXTO) valores[campo] = linha[campo];
    porChave[linha.chave][linha.locale] = valores;
  }

  const linhaDoHeroi = heroi.rows[0] || {};
  return {
    heroi: {
      imagem_desktop: linhaDoHeroi.imagem_desktop ?? null,
      imagem_mobile: linhaDoHeroi.imagem_mobile ?? null,
    },
    textos: porChave,
  };
}

/** `GET /vitrine`. */
async function lerVitrine(req, res) {
  try {
    return res.json(await buscarVitrine());
  } catch (erro) {
    // O objeto de erro do pg carrega SQL e nome de coluna; ao navegador vai só
    // a frase, o resto fica no log.
    console.error("lerVitrine:", erro);
    return res.status(500).json({ error: "Erro ao buscar o conteúdo da vitrine" });
  }
}

/** `PUT /vitrine`. */
async function gravarVitrine(req, res) {
  let alteracoes;
  try {
    alteracoes = interpretar(req.body);
  } catch (erro) {
    if (erro instanceof CorpoInvalido) return res.status(400).json({ error: erro.message });
    throw erro;
  }

  const cliente = await pool.connect();
  try {
    await cliente.query("BEGIN");

    const campos = Object.keys(alteracoes.heroi);
    if (campos.length) {
      // Garante a linha 1 antes do UPDATE. Sem isto, numa loja em que ninguém
      // salvou a vitrine ainda, o UPDATE seria um no-op silencioso e o gestor
      // "salvaria" uma imagem que não foi a lugar nenhum — o mesmo defeito que
      // `PUT /config` já teve uma vez.
      //
      // O INSERT fica DENTRO do `if`: um corpo sem `heroi` não pode criar a
      // linha como efeito colateral.
      await cliente.query(
        "INSERT INTO canastra.vitrine_heroi (id) VALUES (1) ON CONFLICT (id) DO NOTHING",
      );
      const valores = campos.map((c) => alteracoes.heroi[c]);
      const atribuicoes = campos.map((c, i) => `${c} = $${i + 1}`);
      await cliente.query(
        `UPDATE canastra.vitrine_heroi
            SET ${atribuicoes.join(", ")}, atualizado_em = now()
          WHERE id = 1`,
        valores,
      );
    }

    for (const { chave, locale, valores } of alteracoes.textos) {
      // UPSERT com o SET restrito às colunas ENVIADAS — é aqui que "campo
      // ausente não é campo vazio" vira SQL. Uma coluna que não veio não
      // aparece no SET, então o UPDATE não a alcança; na linha nova ela nasce
      // NULL, que é o certo (não havia o que preservar).
      const campos = Object.keys(valores);
      const parametros = [chave, locale, ...campos.map((c) => valores[c])];
      const marcadores = campos.map((_, i) => `$${i + 3}`);
      const atribuicoes = campos.map((c) => `${c} = EXCLUDED.${c}`);
      await cliente.query(
        `INSERT INTO canastra.vitrine_texto (chave, locale, ${campos.join(", ")})
         VALUES ($1, $2, ${marcadores.join(", ")})
         ON CONFLICT (chave, locale) DO UPDATE
            SET ${atribuicoes.join(", ")}, atualizado_em = now()`,
        parametros,
      );
    }

    // A leitura vai DENTRO da transação: o painel recebe exatamente o que
    // acabou de gravar, sem depender de uma segunda ida ao servidor nem correr
    // com outra escrita simultânea.
    const estado = await buscarVitrine(cliente);
    await cliente.query("COMMIT");
    return res.json(estado);
  } catch (erro) {
    await cliente.query("ROLLBACK").catch(() => {});
    console.error("gravarVitrine:", erro);
    return res.status(500).json({ error: "Erro ao gravar o conteúdo da vitrine" });
  } finally {
    cliente.release();
  }
}

module.exports = {
  lerVitrine,
  gravarVitrine,
  // Exportados para quem precisar do estado sem passar por HTTP (o gerador de
  // páginas, um script de migração de `config_loja`) e para os testes.
  buscarVitrine,
  interpretar,
  CorpoInvalido,
  CHAVES,
  LOCALES,
  CAMPOS_DE_HEROI,
  CAMPOS_DE_TEXTO,
};
