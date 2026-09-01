"use strict";

const pool = require("../pgPool");
const { ehUuid } = require("../utils/formatoUuid");
const { registrar, ACOES, ENTIDADES } = require("../services/adminLog");
const { calcularDescontos } = require("../utils/motor");

/**
 * A administração do motor de promoção: as sete tabelas de
 * `0032_motor_de_promocao.sql` vistas pelo painel.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * ISTO NÃO É `promotionsRepository`, E AS DUAS COISAS CONVIVEM DE PROPÓSITO.
 *
 * `promotionsRepository.js` serve `canastra.promocoes_legado` — a tabela que a
 * 0032 renomeou —, e o checkout ainda passa por lá enquanto a troca não
 * termina. Este arquivo serve `canastra.promocoes`, a tabela NOVA, que unificou
 * promoção e cupom numa entidade só com um campo `metodo`. Mexer num para
 * consertar o outro é o caminho mais curto para derrubar a venda.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * TODO `CHECK` DE 0032 É CONFERIDO AQUI ANTES DE IR AO BANCO, e não por
 * desconfiança do banco: o CHECK é a garantia, esta camada é a FRASE. Um 23514
 * subindo vira "Erro interno no servidor." no navegador, e o gestor abre
 * chamado por algo que ele resolveria sozinho ("o teto é 90%").
 *
 * ────────────────────────────────────────────────────────────────────────────
 * A REGRA DO `PUT`, QUE É A DECISÃO MAIS CARA DESTE ARQUIVO.
 *
 *   escopo, faixas, frete, códigos ... LISTA ENVIADA = LISTA FINAL.
 *   colunas do cabeçalho ............. AUSENTE = não mexer; `null`/`""` = vazio.
 *
 * As duas metades têm motivos diferentes, e as duas foram medidas nesta loja.
 *
 * A metade das LISTAS é o que o contrato da tela pede por escrito: "mesclar uma
 * lista é uma operação sem significado único — enviar duas faixas quer dizer
 * estas duas e mais nenhuma". O formulário sempre carrega a regra inteira (veio
 * do `GET`), então ele nunca manda uma lista parcial por acidente.
 *
 * A metade das COLUNAS é o conserto explícito de dois defeitos com endereço:
 * `PUT /config`, onde o corpo chega por multipart, campo enviado vazio vale
 * `''` — que não é `undefined` e portanto sobrescreve — e `Number('')` é `0`,
 * que no mínimo de frete grátis DESLIGA o frete grátis da loja inteira; e
 * `PUT /promotions/:id`, onde o repositório escreve todas as colunas com o que
 * veio no corpo e campo ausente vira NULL, de modo que um formulário que
 * mandasse só o campo alterado apagava título, datas e categoria.
 *
 * Aqui o corpo é JSON, então "ausente" existe de verdade: uma chave que não
 * está no objeto nunca vira coluna no UPDATE. E `null` continua significando
 * "apague este campo", porque sem isso o gestor não teria como tirar uma
 * descrição que não quer mais.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * STATUS É DERIVADO, NUNCA COLUNA. `vigente`, `agendada` e `expirada` são
 * leitura do relógio sobre `inicio_em`/`fim_em`; `habilitada` é o kill-switch
 * do gestor e `arquivada_em` é definitivo. Foi gravar status derivado que
 * produziu a armadilha do painel legado — abrir uma promoção expirada para
 * corrigir a data a desativava para sempre. Por isso o filtro de situação da
 * lista é um WHERE sobre as datas, e não uma coluna.
 *
 * ARQUIVAR, NUNCA DELETE (R13): `pedido_ajustes_desconto` e
 * `promocao_resgates` apontam para cá, e uma promoção apagada quebra o
 * relatório do pedido que a usou. A 0032 revoga DELETE por isso.
 */

/* ========================================================================== *
 * 1. O vocabulário de 0032, palavra por palavra
 * ========================================================================== */

const METODOS = Object.freeze(["automatico", "codigo"]);
const CLASSES = Object.freeze(["produto", "pedido", "frete"]);
const MECANICAS = Object.freeze([
  "percentual",
  "valor_fixo",
  "preco_fixo",
  "leve_x_pague_y",
  "progressivo",
  "brinde",
  "frete_gratis",
]);

/**
 * AS MECÂNICAS QUE O BANCO ACEITA E `utils/motor.js` NÃO CALCULA.
 *
 * `brinde` passa em todo `CHECK` de 0032 — a regra salva, aparece na lista,
 * mostra "vigente" — e o motor não gera ajuste monetário nenhum para ela
 * (`descontosDaRegraDeProduto` cai no `default` e devolve zero). O resultado é
 * uma regra INERTE: o gestor cadastra o brinde, anuncia, e o carrinho cobra o
 * preço cheio sem que nada indique o porquê.
 *
 * A tela já recusa, e a recusa está repetida aqui de propósito: o motivo dela é
 * um fato do BACKEND, e uma trava que só existe em TypeScript é uma trava que
 * some no primeiro script que chamar a API. No dia em que o motor aprender
 * brinde, esta lista é a linha que muda.
 */
const MECANICAS_INERTES = Object.freeze(["brinde"]);

/** As que usam a coluna `valor` — a unidade dele depende da mecânica (0032). */
const MECANICAS_COM_VALOR = Object.freeze([
  "percentual",
  "valor_fixo",
  "preco_fixo",
  "leve_x_pague_y",
]);

/** As que carregam faixas — e sem faixa elas não descontam nada. */
const MECANICAS_COM_FAIXA = Object.freeze(["progressivo", "leve_x_pague_y"]);

const MINIMOS = Object.freeze(["nenhum", "subtotal", "quantidade"]);
const TIPOS_DE_ESCOPO = Object.freeze([
  "produto",
  "categoria",
  "sku",
  "todos",
  "assinante",
]);

/** `todos` e `assinante` são PORTEIROS: o `CHECK promocao_escopo_alvo_coerente`
 *  exige `alvo IS NULL` neles. */
const ESCOPOS_SEM_ALVO = Object.freeze(["todos", "assinante"]);

const TIPOS_DE_FAIXA = Object.freeze([
  "percentual",
  "valor_fixo",
  "preco_fixo",
  "pague_y",
]);

const MEIOS_DE_PAGAMENTO = Object.freeze(["pix", "credito", "debito", "boleto"]);

const UFS = Object.freeze([
  "AC", "AL", "AP", "AM", "BA", "CE", "DF", "ES", "GO",
  "MA", "MT", "MS", "MG", "PA", "PB", "PR", "PE", "PI",
  "RJ", "RN", "RS", "RO", "RR", "SC", "SP", "SE", "TO",
]);

const FORMATO_DE_CODIGO = /^[A-Z0-9]{3,30}$/;
const TETO_PERCENTUAL = 90;

/** As cinco situações da lista, todas DERIVADAS. Nenhuma é coluna. */
const SITUACOES = Object.freeze([
  "vigente",
  "agendada",
  "expirada",
  "desligada",
  "arquivada",
]);

/* ========================================================================== *
 * 2. Recusa com frase, e os leitores de campo
 * ========================================================================== */

/** Erro de PEDIDO (400/404/409), com frase — nunca um 500 com SQLSTATE. */
function recusa(mensagem, status = 400) {
  const erro = new Error(mensagem);
  erro.status = status;
  return erro;
}

const ehObjeto = (v) => typeof v === "object" && v !== null && !Array.isArray(v);

function textoOuNull(valor) {
  const texto = valor === undefined || valor === null ? "" : String(valor).trim();
  return texto === "" ? null : texto;
}

function umDe(lista, valor, campo) {
  const texto = textoOuNull(valor);
  if (texto === null || !lista.includes(texto)) {
    throw recusa(`"${campo}" precisa ser um de: ${lista.join(", ")}.`);
  }
  return texto;
}

function booleano(valor, campo) {
  if (typeof valor === "boolean") return valor;
  throw recusa(`"${campo}" precisa ser true ou false.`);
}

/**
 * Inteiro maior que zero, ou `null` no vazio.
 *
 * NUNCA ZERO POR ACIDENTE, e o motivo é o de 0010 repetido em 0032: zero não
 * significa "ilimitado" nem "esgotado desde o início", significa que alguém
 * confundiu os dois. Vazio é "sem limite"; zero é recusa.
 */
function inteiroPositivoOuNull(valor, campo) {
  if (valor === undefined || valor === null || String(valor).trim() === "") return null;
  const n = Number(valor);
  if (!Number.isInteger(n) || n <= 0) {
    throw recusa(
      `"${campo}" precisa ser um número inteiro maior que zero — deixe vazio para "sem limite".`,
    );
  }
  return n;
}

/** Inteiro qualquer (só `prioridade`): vazio vira 0, que é o default do banco. */
function inteiroOuZero(valor, campo) {
  if (valor === undefined || valor === null || String(valor).trim() === "") return 0;
  const n = Number(valor);
  if (!Number.isInteger(n)) {
    throw recusa(`"${campo}" precisa ser um número inteiro. Maior aplica primeiro.`);
  }
  return n;
}

/** O `valor` da regra: `numeric(10,2)`, sempre maior que zero quando existe. */
function numeroPositivoOuNull(valor, campo) {
  if (valor === undefined || valor === null || String(valor).trim() === "") return null;
  const n = Number(String(valor).replace(",", "."));
  if (!Number.isFinite(n) || n <= 0) {
    throw recusa(`"${campo}" precisa ser um número maior que zero.`);
  }
  return n;
}

function dataOuNull(valor, campo) {
  const bruto = textoOuNull(valor);
  if (bruto === null) return null;
  const data = new Date(bruto);
  if (Number.isNaN(data.getTime())) throw recusa(`Data inválida em "${campo}".`);
  return data.toISOString();
}

/**
 * Lista de vocabulário fechado, ou `null`.
 *
 * LISTA VAZIA VIRA `null`, e isso é o contrato da tela, não conveniência: o
 * `CHECK` exige `cardinality > 0` quando a coluna não é nula, porque `{}` não
 * quer dizer "todos", quer dizer "nenhum" — e a regra nunca valeria. Vazio, no
 * formulário, significa "qualquer um".
 */
function listaFechadaOuNull(valor, permitidos, campo) {
  if (valor === undefined || valor === null) return null;
  if (!Array.isArray(valor)) {
    throw recusa(`"${campo}" precisa ser uma lista (ou null para "qualquer").`);
  }
  const itens = valor.map((v) => textoOuNull(v)).filter((v) => v !== null);
  if (itens.length === 0) return null;
  const forasteiros = itens.filter((v) => !permitidos.includes(v));
  if (forasteiros.length) {
    throw recusa(`Valor desconhecido em "${campo}": ${forasteiros.join(", ")}.`);
  }
  return [...new Set(itens)];
}

/** Só dígitos — o CEP entra no banco com oito e sem hífen, e o CHECK recusa o
 *  formatado. Comparar '01310-100' com '01310100' é um bug que só aparece em
 *  produção, e esta loja já teve um dessa família. */
function soDigitos(valor) {
  return String(valor ?? "").replace(/\D/g, "");
}

/* ========================================================================== *
 * 3. O corpo da regra
 * ========================================================================== */

/**
 * Coluna do cabeçalho → como lê-la. A chave é o nome do campo NO PAYLOAD, que
 * é o mesmo da coluna de propósito: um `de/para` no meio seria mais um lugar
 * para as unidades divergirem, e a unidade já está no nome (`*_centavos`).
 */
const CAMPOS_DO_CABECALHO = Object.freeze({
  nome: (v) => {
    const nome = textoOuNull(v);
    if (nome === null) {
      throw recusa(
        "Dê um nome à regra — é por ele que ela vai ser encontrada daqui a três meses.",
      );
    }
    return nome;
  },
  descricao: (v) => textoOuNull(v),
  metodo: (v) => umDe(METODOS, v, "metodo"),
  classe: (v) => umDe(CLASSES, v, "classe"),
  mecanica: (v) => umDe(MECANICAS, v, "mecanica"),
  valor: (v) => numeroPositivoOuNull(v, "valor"),
  teto_desconto_centavos: (v) => inteiroPositivoOuNull(v, "teto_desconto_centavos"),
  minimo_tipo: (v) => umDe(MINIMOS, v, "minimo_tipo"),
  minimo_valor: (v) => inteiroPositivoOuNull(v, "minimo_valor"),
  prioridade: (v) => inteiroOuZero(v, "prioridade"),
  exclusiva: (v) => booleano(v, "exclusiva"),
  grupo_exclusividade: (v) => textoOuNull(v),
  meios_pagamento: (v) => listaFechadaOuNull(v, MEIOS_DE_PAGAMENTO, "meios_pagamento"),
  limite_usos: (v) => inteiroPositivoOuNull(v, "limite_usos"),
  limite_por_cliente: (v) => inteiroPositivoOuNull(v, "limite_por_cliente"),
  orcamento_centavos: (v) => inteiroPositivoOuNull(v, "orcamento_centavos"),
  inicio_em: (v) => dataOuNull(v, "inicio_em"),
  fim_em: (v) => dataOuNull(v, "fim_em"),
  habilitada: (v) => booleano(v, "habilitada"),
});

/** As quatro listas filhas. Fora destas chaves e das colunas, nada é aceito. */
const LISTAS = Object.freeze(["escopo", "faixas", "frete", "codigos"]);

/**
 * As colunas enviadas, já lidas.
 *
 * CAMPO DESCONHECIDO É RECUSA, e não algo a ignorar — mesma decisão de
 * `vitrineRepository`: `titulo` escrito como `title` seria aceito e ignorado, o
 * gestor veria "salvo" e o campo não mudaria, sem nada em lugar nenhum
 * apontando por quê. Barulhento é melhor.
 */
function interpretarCabecalho(dados) {
  const campos = {};
  for (const chave of Object.keys(dados)) {
    if (LISTAS.includes(chave)) continue;
    if (!CAMPOS_DO_CABECALHO[chave]) {
      throw recusa(
        `Campo desconhecido: "${chave}". Confira o nome — ele não existe em canastra.promocoes.`,
      );
    }
    campos[chave] = CAMPOS_DO_CABECALHO[chave](dados[chave], chave);
  }

  /**
   * O MÍNIMO É UM PAR, E O PAR ANDA JUNTO. `minimo_tipo = 'nenhum'` com
   * `minimo_valor` preenchido é a combinação que o `CHECK
   * promocoes_minimo_coerente` recusa — e ela nasceria de um PUT parcial que
   * trocasse só o tipo, deixando o valor antigo na linha. Zerar o par aqui não
   * é apagar campo ausente: é reconhecer que os dois campos são UM.
   */
  if (campos.minimo_tipo === "nenhum" && !("minimo_valor" in dados)) {
    campos.minimo_valor = null;
  }
  return campos;
}

function interpretarEscopo(bruto) {
  if (!Array.isArray(bruto)) throw recusa('"escopo" precisa ser uma lista.');

  const vistos = new Set();
  return bruto.map((linha, i) => {
    const onde = `escopo[${i}]`;
    if (!ehObjeto(linha)) throw recusa(`${onde} precisa ser um objeto.`);

    const tipo = umDe(TIPOS_DE_ESCOPO, linha.tipo, `${onde}.tipo`);
    const precisaDeAlvo = !ESCOPOS_SEM_ALVO.includes(tipo);
    const alvo = precisaDeAlvo ? textoOuNull(linha.alvo) : null;
    if (precisaDeAlvo && alvo === null) {
      throw recusa(`Escolha o produto, a categoria ou o SKU em ${onde}.`);
    }

    // `promocao_escopo_alvo_unico_idx` é UNIQUE (promocao_id, tipo,
    // coalesce(alvo,'')): duas linhas iguais viram 23505 no meio da gravação.
    const chave = `${tipo}:${alvo ?? ""}`;
    if (vistos.has(chave)) {
      throw recusa(`Esta linha já está no escopo: ${tipo}${alvo ? ` ${alvo}` : ""}.`);
    }
    vistos.add(chave);

    // `false` É A EXCEÇÃO — é o campo que dá "10% na loja toda, MENOS o
    // micro-lote". Ausente é inclusão, que é o caso comum.
    return { tipo, alvo, incluir: linha.incluir !== false };
  });
}

function interpretarFaixas(bruto) {
  if (!Array.isArray(bruto)) throw recusa('"faixas" precisa ser uma lista.');

  const pisos = new Set();
  const faixas = bruto.map((linha, i) => {
    const onde = `faixas[${i}]`;
    if (!ehObjeto(linha)) throw recusa(`${onde} precisa ser um objeto.`);

    const quantidadeMin = inteiroPositivoOuNull(linha.quantidade_min, `${onde}.quantidade_min`);
    if (quantidadeMin === null) {
      throw recusa(`A partir de quantos itens, em ${onde}? Um número maior que zero.`);
    }
    // O UNIQUE (promocao_id, quantidade_min) existe porque duas faixas com o
    // mesmo piso deixariam o motor escolher pela ordem de varredura do heap.
    if (pisos.has(quantidadeMin)) {
      throw recusa(`Já existe uma faixa com o piso ${quantidadeMin}.`);
    }
    pisos.add(quantidadeMin);

    const tipo = umDe(TIPOS_DE_FAIXA, linha.desconto_tipo, `${onde}.desconto_tipo`);
    const valor = numeroPositivoOuNull(linha.desconto_valor, `${onde}.desconto_valor`);
    if (valor === null) throw recusa(`Informe um valor maior que zero em ${onde}.`);
    if (tipo === "percentual" && valor > TETO_PERCENTUAL) {
      throw recusa(`O teto é ${TETO_PERCENTUAL}% na faixa de piso ${quantidadeMin}.`);
    }
    if (tipo === "pague_y" && valor >= quantidadeMin) {
      throw recusa(
        "Pagar tantos quanto se leva não é desconto — Y precisa ser menor que a quantidade da faixa.",
      );
    }

    return { quantidade_min: quantidadeMin, desconto_tipo: tipo, desconto_valor: valor };
  });

  // Ordenadas pelo piso: é como o motor as lê (`faixaVigente` ordena de novo,
  // mas a linha do banco e a resposta da API ficam legíveis na mesma ordem).
  return faixas.sort((a, b) => a.quantidade_min - b.quantidade_min);
}

function interpretarFrete(bruto) {
  if (bruto === undefined || bruto === null) return null;
  if (!ehObjeto(bruto)) throw recusa('"frete" precisa ser um objeto ou null.');

  const cepInicio = soDigitos(bruto.cep_inicio) || null;
  const cepFim = soDigitos(bruto.cep_fim) || null;

  // `CHECK promocao_frete_faixa_completa`: meia faixa não é faixa.
  if ((cepInicio === null) !== (cepFim === null)) {
    throw recusa("A faixa de CEP precisa dos dois extremos — ou nenhum.");
  }
  if (cepInicio && (cepInicio.length !== 8 || cepFim.length !== 8)) {
    throw recusa("O CEP tem oito dígitos. O hífen pode ir, ele é removido.");
  }
  if (cepInicio && cepInicio > cepFim) {
    throw recusa("O CEP final precisa ser maior ou igual ao inicial.");
  }

  return {
    teto_frete_centavos: inteiroPositivoOuNull(
      bruto.teto_frete_centavos,
      "frete.teto_frete_centavos",
    ),
    ufs: listaFechadaOuNull(bruto.ufs, UFS, "frete.ufs"),
    apenas_modalidade_mais_barata: bruto.apenas_modalidade_mais_barata === true,
    cep_inicio: cepInicio,
    cep_fim: cepFim,
  };
}

function interpretarCodigos(bruto) {
  if (!Array.isArray(bruto)) throw recusa('"codigos" precisa ser uma lista.');

  const vistos = new Set();
  return bruto.map((linha, i) => {
    const onde = `codigos[${i}]`;
    if (!ehObjeto(linha)) throw recusa(`${onde} precisa ser um objeto.`);

    // MAIÚSCULAS SEMPRE: o `CHECK` do banco é `^[A-Z0-9]{3,30}$`, e "cafe20"
    // digitado em minúscula viraria 23514 em vez de virar CAFE20. É a mesma
    // normalização de `utils/cupom.normalizarCodigo`.
    const codigo = String(linha.codigo ?? "").trim().toUpperCase();
    if (!FORMATO_DE_CODIGO.test(codigo)) {
      throw recusa(
        `Código inválido em ${onde}: de 3 a 30 caracteres, só letras maiúsculas e números.`,
      );
    }
    if (vistos.has(codigo)) throw recusa(`O código ${codigo} está repetido nesta regra.`);
    vistos.add(codigo);

    return {
      codigo,
      uso_unico: linha.uso_unico === true,
      limite_usos: inteiroPositivoOuNull(linha.limite_usos, `${onde}.limite_usos`),
      ativo: linha.ativo !== false,
    };
  });
}

/**
 * A coerência que nenhum `CHECK` sozinho pega, conferida sobre a linha
 * RESULTANTE — e é por ser sobre a fusão que ela funciona num PUT parcial:
 * mandar só `valor` numa regra percentual tem de bater no teto de 90% do mesmo
 * jeito que mandar os dois campos.
 *
 * O QUE ESTA FUNÇÃO NÃO FAZ, de propósito: não recusa combinação de `classe`
 * com `mecanica`. A tela trata isso como AVISO ("frete grátis só tem efeito na
 * classe Frete") e deixa salvar, e recusar aqui quebraria um caminho que a tela
 * declara válido. A divergência existe e está avisada do lado de lá.
 */
function conferirCoerencia(linha, { faixas }) {
  if (MECANICAS_INERTES.includes(linha.mecanica)) {
    throw recusa(
      "O motor de descontos ainda não calcula brinde: a regra seria salva e ficaria inerte, " +
        "sem descontar nada e sem avisar. Escolha outra mecânica.",
    );
  }

  const valor = linha.valor === null || linha.valor === undefined ? null : Number(linha.valor);
  if (MECANICAS_COM_VALOR.includes(linha.mecanica)) {
    if (valor === null || !(valor > 0)) {
      throw recusa("Informe um valor maior que zero.");
    }
    if (linha.mecanica === "percentual" && valor > TETO_PERCENTUAL) {
      throw recusa(
        `O teto é ${TETO_PERCENTUAL}% — acima disso o checkout calcularia preço negativo, ` +
          "que abatia dos outros itens.",
      );
    }
    if (linha.mecanica === "leve_x_pague_y" && (!Number.isInteger(valor) || valor < 2)) {
      throw recusa("Leve quantos precisa ser um número inteiro de 2 para cima.");
    }
  }

  // `promocoes_minimo_coerente`: 'nenhum' + valor é o piso que a tela mostra e
  // o motor ignora; 'subtotal' + NULL é "acima de nada", isto é, vale sempre.
  if (linha.minimo_tipo === "nenhum") {
    if (linha.minimo_valor !== null && linha.minimo_valor !== undefined) {
      throw recusa('Com "sem mínimo" o valor mínimo precisa ficar vazio.');
    }
  } else if (!(Number(linha.minimo_valor) > 0)) {
    throw recusa(
      linha.minimo_tipo === "subtotal"
        ? 'Informe o piso em centavos — ou volte o tipo para "sem mínimo".'
        : 'Informe quantos itens, no mínimo — ou volte o tipo para "sem mínimo".',
    );
  }

  // `promocoes_grupo_exige_exclusiva`: grupo numa regra que acumula é um campo
  // que não faz nada.
  if (linha.grupo_exclusividade && !linha.exclusiva) {
    throw recusa(
      'Grupo só faz sentido em regra exclusiva — marque "exclusiva" ou deixe o grupo em branco.',
    );
  }

  if (linha.inicio_em && linha.fim_em) {
    if (new Date(linha.inicio_em).getTime() >= new Date(linha.fim_em).getTime()) {
      throw recusa("O fim precisa vir depois do início.");
    }
  }

  /**
   * FAIXA AUSENTE EM MECÂNICA DE FAIXA É REGRA INERTE, e o motor diz isso sem
   * meias palavras: `faixaVigente` não acha candidata e o desconto sai zero.
   * Uma regra que existe e não faz nada é pior do que uma que não existe.
   */
  if (MECANICAS_COM_FAIXA.includes(linha.mecanica)) {
    if (!faixas.length) {
      throw recusa(
        linha.mecanica === "progressivo"
          ? "Progressivo sem faixa não desconta nada — acrescente pelo menos uma."
          : "Informe quantos itens o cliente paga (Y) numa faixa.",
      );
    }
    if (
      linha.mecanica === "leve_x_pague_y" &&
      !faixas.some((f) => f.desconto_tipo === "pague_y")
    ) {
      throw recusa("Informe quantos itens o cliente paga (Y) numa faixa.");
    }
  }
}

/* ========================================================================== *
 * 4. A leitura
 * ========================================================================== */

const COLUNAS_DE_PROMOCAO = `
  p.id, p.nome, p.descricao, p.metodo, p.classe, p.mecanica, p.valor,
  p.teto_desconto_centavos, p.minimo_tipo, p.minimo_valor, p.prioridade,
  p.exclusiva, p.grupo_exclusividade, p.meios_pagamento, p.limite_usos,
  p.limite_por_cliente, p.orcamento_centavos, p.inicio_em, p.fim_em,
  p.habilitada, p.arquivada_em
`;

/**
 * Os filhos vêm por `LEFT JOIN LATERAL` em jsonb — UMA consulta, não N+1. Uma
 * lista de 20 regras com quatro consultas de filho cada seriam 81 idas ao
 * banco para desenhar uma tabela.
 *
 * `desconto_valor` sai como TEXTO de propósito: é `numeric(10,2)`, e o contrato
 * da tela o tipa como string pela mesma razão que o driver entrega `valor`
 * assim — número de dinheiro que passa por `double` perde precisão em silêncio.
 */
const FILHOS = `
  LEFT JOIN LATERAL (
    SELECT jsonb_agg(
             jsonb_build_object('id', e.id, 'tipo', e.tipo, 'alvo', e.alvo,
                                'incluir', e.incluir)
             ORDER BY e.incluir DESC, e.tipo, e.alvo
           ) AS linhas
      FROM canastra.promocao_escopo e
     WHERE e.promocao_id = p.id
  ) esc ON true
  LEFT JOIN LATERAL (
    SELECT jsonb_agg(
             jsonb_build_object('id', f.id,
                                'quantidade_min', f.quantidade_min,
                                'desconto_tipo',  f.desconto_tipo,
                                'desconto_valor', f.desconto_valor::text)
             ORDER BY f.quantidade_min
           ) AS linhas
      FROM canastra.promocao_faixas f
     WHERE f.promocao_id = p.id
  ) fx ON true
  LEFT JOIN LATERAL (
    SELECT jsonb_agg(
             jsonb_build_object('id', c.id, 'codigo', c.codigo,
                                'uso_unico', c.uso_unico,
                                'limite_usos', c.limite_usos,
                                'ativo', c.ativo, 'usos', c.usos)
             ORDER BY c.codigo
           ) AS linhas
      FROM canastra.promocao_codigos c
     WHERE c.promocao_id = p.id
  ) cod ON true
  LEFT JOIN canastra.promocao_frete pf ON pf.promocao_id = p.id
  /*
   * 'promocao_resgates' E A FONTE DA VERDADE DO USO, e nao o contador
   * denormalizado de 'promocao_codigos': pedido cancelado ou Pix expirado
   * DEVOLVE o uso, e a devolucao e um 'estornado_em' na linha do resgate. A
   * propria Shopify documenta que o contador dela fica defasado.
   *
   * (Aspas simples e nao crase aqui dentro: este comentario mora DENTRO de um
   * template literal, e uma crase o encerraria no meio — mesma disciplina de
   * motorRepository.CONSULTA_DE_REGRAS.)
   */
  LEFT JOIN LATERAL (
    SELECT count(*)::int AS usos,
           coalesce(sum(r.valor_centavos), 0)::bigint AS descontado_centavos
      FROM canastra.promocao_resgates r
     WHERE r.promocao_id = p.id
       AND r.estornado_em IS NULL
  ) uso ON true
`;

const SELECAO = `
  SELECT ${COLUNAS_DE_PROMOCAO},
         esc.linhas AS escopo,
         fx.linhas  AS faixas,
         cod.linhas AS codigos_detalhe,
         (pf.promocao_id IS NOT NULL) AS tem_frete,
         pf.teto_frete_centavos, pf.ufs, pf.apenas_modalidade_mais_barata,
         pf.cep_inicio, pf.cep_fim,
         uso.usos, uso.descontado_centavos
    FROM canastra.promocoes p
    ${FILHOS}
`;

/** Uma linha da consulta → a `RegraCompleta` do contrato da tela. */
function paraRegra(linha) {
  const codigos = linha.codigos_detalhe || [];
  return {
    id: linha.id,
    nome: linha.nome,
    descricao: linha.descricao,
    metodo: linha.metodo,
    classe: linha.classe,
    mecanica: linha.mecanica,
    valor: linha.valor,
    teto_desconto_centavos: linha.teto_desconto_centavos,
    minimo_tipo: linha.minimo_tipo,
    minimo_valor: linha.minimo_valor,
    prioridade: linha.prioridade,
    exclusiva: linha.exclusiva,
    grupo_exclusividade: linha.grupo_exclusividade,
    meios_pagamento: linha.meios_pagamento,
    limite_usos: linha.limite_usos,
    limite_por_cliente: linha.limite_por_cliente,
    orcamento_centavos: linha.orcamento_centavos,
    inicio_em: linha.inicio_em,
    fim_em: linha.fim_em,
    habilitada: linha.habilitada,
    arquivada_em: linha.arquivada_em,
    // `count` e `sum` chegam como texto no bigint: a tela soma e formata, e uma
    // string ali viraria concatenação.
    usos: Number(linha.usos ?? 0),
    descontado_centavos: Number(linha.descontado_centavos ?? 0),
    escopo: linha.escopo || [],
    faixas: linha.faixas || [],
    frete: linha.tem_frete
      ? {
          teto_frete_centavos: linha.teto_frete_centavos,
          ufs: linha.ufs,
          apenas_modalidade_mais_barata: Boolean(linha.apenas_modalidade_mais_barata),
          cep_inicio: linha.cep_inicio,
          cep_fim: linha.cep_fim,
        }
      : null,
    codigos_detalhe: codigos,
    // A lista mostra os códigos sem uma segunda ida ao servidor.
    codigos: codigos.map((c) => c.codigo),
  };
}

async function buscarRegra(executor, id) {
  const { rows } = await executor.query(`${SELECAO} WHERE p.id = $1::uuid`, [id]);
  return rows.length ? paraRegra(rows[0]) : null;
}

/**
 * O WHERE de cada situação — a MESMA derivação que `lista.logica.ts` faz na
 * tela, e o mesmo predicado de janela que `motorRepository` aplica na cobrança.
 *
 * POR QUE O RECORTE VIAJA PARA O SERVIDOR, sendo derivado: com 300 regras e 20
 * por página, filtrar "vigente" depois de paginar mostraria as vigentes DAS
 * VINTE e o rodapé diria 300. É o defeito que a tela legada de clientes tinha.
 *
 * A ORDEM DAS CONDIÇÕES É A DA PRECEDÊNCIA: arquivar é definitivo, desligar é
 * do gestor, e só então o relógio tem voz. Uma regra desligada NUNCA aparece em
 * "vigente" — mostrá-la ali é a mentira mais cara que esta lista poderia
 * contar, porque é ela que o gestor lê para decidir se o desconto está no ar.
 */
const FILTRO_DE_SITUACAO = Object.freeze({
  vigente: `p.arquivada_em IS NULL AND p.habilitada
            AND (p.inicio_em IS NULL OR p.inicio_em <= now())
            AND (p.fim_em    IS NULL OR p.fim_em    >= now())`,
  agendada: `p.arquivada_em IS NULL AND p.habilitada
             AND p.inicio_em IS NOT NULL AND p.inicio_em > now()`,
  expirada: `p.arquivada_em IS NULL AND p.habilitada
             AND p.fim_em IS NOT NULL AND p.fim_em < now()`,
  desligada: "p.arquivada_em IS NULL AND NOT p.habilitada",
  arquivada: "p.arquivada_em IS NOT NULL",
});

class DescontosRepository {
  /* ---------------------------------------------------------------------- *
   * Listar
   * ---------------------------------------------------------------------- */

  /**
   * A lista da tela. `pagina`/`limite` em português porque é o que o contrato
   * manda no query string, e a resposta sai como `{data, total, pagina,
   * totalPaginas}` pelo mesmo motivo.
   *
   * SEM `situacao`, NADA É ESCONDIDO — inclusive as arquivadas. A aba se chama
   * "Todas" e "Arquivadas" é um recorte dela; um servidor que sumisse com as
   * arquivadas por conta própria faria a aba mentir e deixaria a loja sem
   * nenhuma tela que mostre tudo.
   */
  async listar(query = {}) {
    const filtros = [];
    const values = [];

    const situacao = textoOuNull(query.situacao);
    if (situacao) {
      if (!SITUACOES.includes(situacao)) {
        throw recusa(`Situação inválida. Use uma de: ${SITUACOES.join(", ")}.`);
      }
      filtros.push(`(${FILTRO_DE_SITUACAO[situacao]})`);
    }

    const metodo = textoOuNull(query.metodo);
    if (metodo) {
      values.push(umDe(METODOS, metodo, "metodo"));
      filtros.push(`p.metodo = $${values.length}`);
    }

    const classe = textoOuNull(query.classe);
    if (classe) {
      values.push(umDe(CLASSES, classe, "classe"));
      filtros.push(`p.classe = $${values.length}`);
    }

    const q = textoOuNull(query.q);
    if (q) {
      // A busca casa nome OU código, e não diferencia caixa: o gestor procura
      // "cafe20" pelo que leu no anúncio, e o banco só guarda maiúsculas.
      values.push(`%${q}%`);
      const i = values.length;
      filtros.push(
        `(p.nome ILIKE $${i}
          OR EXISTS (SELECT 1 FROM canastra.promocao_codigos c
                      WHERE c.promocao_id = p.id AND c.codigo ILIKE $${i}))`,
      );
    }

    const where = filtros.length ? `WHERE ${filtros.join(" AND ")}` : "";
    const pagina = Math.max(1, Number.parseInt(query.pagina, 10) || 1);
    const limite = Math.min(100, Math.max(1, Number.parseInt(query.limite, 10) || 20));

    const contagem = await pool.query(
      `SELECT count(*)::int AS total FROM canastra.promocoes p ${where}`,
      values,
    );
    const total = contagem.rows[0].total;

    const { rows } = await pool.query(
      `${SELECAO} ${where}
        ORDER BY p.criada_em DESC, p.id
        LIMIT $${values.length + 1} OFFSET $${values.length + 2}`,
      [...values, limite, (pagina - 1) * limite],
    );

    return {
      data: rows.map(paraRegra),
      total,
      pagina,
      totalPaginas: Math.max(1, Math.ceil(total / limite)),
    };
  }

  /** A ficha. `ehUuid` antes de tocar o banco: sem ela, um link digitado
   *  errado vira 22P02 e o gestor lê "Erro interno no servidor.". */
  async buscar(id) {
    if (!ehUuid(id)) throw recusa("Identificador de regra inválido.");
    const regra = await buscarRegra(pool, id);
    if (!regra) throw recusa("Regra de desconto não encontrada.", 404);
    return regra;
  }

  /* ---------------------------------------------------------------------- *
   * Criar
   * ---------------------------------------------------------------------- */

  async criar({ dados, adminUserId }) {
    if (!ehObjeto(dados)) throw recusa("O corpo precisa ser um objeto JSON.");

    const campos = interpretarCabecalho(dados);
    for (const obrigatorio of ["nome", "metodo", "classe", "mecanica"]) {
      if (!(obrigatorio in campos)) {
        throw recusa(`Falta "${obrigatorio}" — sem ele a regra não existe.`);
      }
    }

    const escopo = interpretarEscopo(dados.escopo ?? []);
    const faixas = interpretarFaixas(dados.faixas ?? []);
    const frete = interpretarFrete(dados.frete);
    const codigos = interpretarCodigos(dados.codigos ?? []);

    // Os defaults do banco entram na conferência: uma regra sem `minimo_tipo`
    // nasce 'nenhum', e a coerência tem de ver a linha que vai existir.
    conferirCoerencia(
      { minimo_tipo: "nenhum", minimo_valor: null, exclusiva: false, ...campos },
      { faixas },
    );

    if (campos.metodo === "codigo" && codigos.length === 0) {
      throw recusa(
        "Método com código exige pelo menos um código — sem ele ninguém tem como pedir o desconto.",
      );
    }

    const nomes = Object.keys(campos);
    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      const { rows } = await client.query(
        `INSERT INTO canastra.promocoes (${nomes.join(", ")})
         VALUES (${nomes.map((_, i) => `$${i + 1}`).join(", ")})
         RETURNING id`,
        nomes.map((n) => campos[n]),
      );
      const id = rows[0].id;

      await gravarEscopo(client, id, escopo);
      await gravarFaixas(client, id, faixas);
      await gravarFrete(client, id, frete);
      await reconciliarCodigos(client, id, codigos);

      await registrar(client, {
        adminUserId,
        acao: ACOES.PROMOCAO_CRIADA,
        entidade: ENTIDADES.PROMOCAO,
        entidadeId: id,
        // O log guarda a identidade da regra, não a linha inteira: quem lê a
        // auditoria pergunta "quem criou o quê", e o estado atual está a um GET.
        depois: {
          nome: campos.nome,
          metodo: campos.metodo,
          classe: campos.classe,
          mecanica: campos.mecanica,
          valor: campos.valor ?? null,
          codigos: codigos.map((c) => c.codigo),
        },
      });

      // A leitura vai DENTRO da transação: o painel recebe exatamente o que
      // acabou de gravar, sem uma segunda ida e sem correr com outra escrita.
      const regra = await buscarRegra(client, id);
      await client.query("COMMIT");
      return regra;
    } catch (erro) {
      await client.query("ROLLBACK").catch(() => {});
      throw traduzirErroDoBanco(erro);
    } finally {
      client.release();
    }
  }

  /* ---------------------------------------------------------------------- *
   * Editar
   * ---------------------------------------------------------------------- */

  async atualizar({ id, dados, adminUserId }) {
    if (!ehUuid(id)) throw recusa("Identificador de regra inválido.");
    if (!ehObjeto(dados)) throw recusa("O corpo precisa ser um objeto JSON.");

    const campos = interpretarCabecalho(dados);
    const escopo = "escopo" in dados ? interpretarEscopo(dados.escopo) : null;
    const faixas = "faixas" in dados ? interpretarFaixas(dados.faixas) : null;
    const codigos = "codigos" in dados ? interpretarCodigos(dados.codigos) : null;
    const mexeNoFrete = "frete" in dados;
    const frete = mexeNoFrete ? interpretarFrete(dados.frete) : null;

    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      // `FOR UPDATE` porque a conferência de coerência é feita sobre a linha
      // atual: sem a trava, duas edições simultâneas poderiam validar contra um
      // estado que nenhuma das duas deixou.
      const atual = await client.query(
        `SELECT ${COLUNAS_DE_PROMOCAO}
           FROM canastra.promocoes p WHERE p.id = $1::uuid FOR UPDATE`,
        [id],
      );
      // 404 EM ZERO LINHAS AFETADAS. `PUT /promotions/:id` respondia
      // `200 "Promocao atualizada."` para id inexistente, tendo atualizado nada.
      if (!atual.rows.length) throw recusa("Regra de desconto não encontrada.", 404);
      const antes = atual.rows[0];

      // A coerência é sobre a FUSÃO — e as faixas que valem são as novas quando
      // vieram, as do banco quando não vieram.
      const faixasVigentes =
        faixas ??
        (
          await client.query(
            `SELECT quantidade_min, desconto_tipo, desconto_valor
               FROM canastra.promocao_faixas WHERE promocao_id = $1::uuid`,
            [id],
          )
        ).rows;
      const fundida = { ...antes, ...campos };
      conferirCoerencia(fundida, { faixas: faixasVigentes });

      const nomes = Object.keys(campos);
      const atribuicoes = nomes.map((n, i) => `${n} = $${i + 1}`);
      // `atualizada_em` é escrita À MÃO: não há trigger de moddatetime neste
      // schema (regra desde 0005), e a coluna mente se quem escreve não carimbar.
      await client.query(
        `UPDATE canastra.promocoes
            SET ${[...atribuicoes, "atualizada_em = now()"].join(", ")}
          WHERE id = $${nomes.length + 1}::uuid`,
        [...nomes.map((n) => campos[n]), id],
      );

      if (escopo) await gravarEscopo(client, id, escopo, { substituir: true });
      if (faixas) await gravarFaixas(client, id, faixas, { substituir: true });
      if (mexeNoFrete) await gravarFrete(client, id, frete, { substituir: true });
      if (codigos) await reconciliarCodigos(client, id, codigos);

      /**
       * MÉTODO 'codigo' SEM NENHUM CÓDIGO É UMA REGRA QUE NINGUÉM ALCANÇA: o
       * `LEFT JOIN cod` de `carregarRegrasVigentes` nunca casa, e o WHERE corta
       * a linha — a regra existe, aparece "vigente" na tela e o motor nunca a
       * vê. Trocar só o método, sem mandar códigos, é o caminho curto para cair
       * nisso sem perceber.
       *
       * A conferência vem DEPOIS da reconciliação, e de propósito: assim quem
       * tenta esvaziar a lista de códigos de uma campanha em curso lê primeiro
       * a recusa específica ("o código CAFE20 já foi resgatado"), que é a que
       * diz o que fazer. Dentro da transação, as duas terminam em ROLLBACK.
       */
      if (fundida.metodo === "codigo") {
        const { rows: quantos } = await client.query(
          "SELECT count(*)::int AS n FROM canastra.promocao_codigos WHERE promocao_id = $1::uuid",
          [id],
        );
        if (quantos[0].n === 0) {
          throw recusa(
            "Método com código exige pelo menos um código — sem ele ninguém tem como pedir o desconto.",
          );
        }
      }

      await registrar(client, {
        adminUserId,
        acao: ACOES.PROMOCAO_ALTERADA,
        entidade: ENTIDADES.PROMOCAO,
        entidadeId: id,
        // Só os campos TOCADOS entram no log, dos dois lados: guardar a linha
        // inteira faria todo diff parecer uma reescrita, e achar o que mudou
        // seria trabalho de quem lê. As listas entram como marca do gesto.
        antes: Object.fromEntries(nomes.map((n) => [n, antes[n]])),
        depois: {
          ...Object.fromEntries(nomes.map((n) => [n, campos[n]])),
          ...(escopo ? { escopo: escopo.length } : {}),
          ...(faixas ? { faixas: faixas.length } : {}),
          ...(codigos ? { codigos: codigos.map((c) => c.codigo) } : {}),
          ...(mexeNoFrete ? { frete: frete ? "definido" : "removido" } : {}),
        },
      });

      const regra = await buscarRegra(client, id);
      await client.query("COMMIT");
      return regra;
    } catch (erro) {
      await client.query("ROLLBACK").catch(() => {});
      throw traduzirErroDoBanco(erro);
    } finally {
      client.release();
    }
  }

  /* ---------------------------------------------------------------------- *
   * Ligar, desligar, arquivar
   * ---------------------------------------------------------------------- */

  /**
   * O KILL-SWITCH TEM ROTA PRÓPRIA, e é o que impede o defeito legado de voltar
   * por outra porta: se ligar/desligar passasse pelo `PUT` total, ligar uma
   * regra expirada exigiria montar o objeto inteiro a partir da linha da LISTA,
   * que não tem escopo nem faixas — e o `PUT` obediente apagaria as duas.
   *
   * E ele nunca é travado pela janela: corrigir a data de uma regra expirada é
   * justamente o que o gestor precisa fazer, e foi travar esse botão que tornou
   * a promoção legada inalcançável pela tela.
   */
  async alternar({ id, habilitada, adminUserId }) {
    return this.mexerNaColuna({
      id,
      adminUserId,
      coluna: "habilitada",
      valor: booleano(habilitada, "habilitada"),
      acao: ACOES.PROMOCAO_ALTERADA,
    });
  }

  /**
   * ARQUIVAR É UM CARIMBO, NUNCA UM DELETE (R13). `promocao_resgates`
   * referencia a promoção com `ON DELETE RESTRICT` e `pedido_ajustes_desconto`
   * também aponta para cá: apagar a regra apagaria a explicação de por que
   * aquele pedido saiu pelo preço que saiu.
   *
   * `coalesce` preserva o carimbo original — arquivar duas vezes não reescreve
   * a data em que a campanha saiu do ar.
   */
  async arquivar({ id, adminUserId }) {
    return this.mexerNaColuna({
      id,
      adminUserId,
      coluna: "arquivada_em",
      expressao: "coalesce(arquivada_em, now())",
      acao: ACOES.PROMOCAO_ARQUIVADA,
    });
  }

  async desarquivar({ id, adminUserId }) {
    return this.mexerNaColuna({
      id,
      adminUserId,
      coluna: "arquivada_em",
      valor: null,
      acao: ACOES.PROMOCAO_DESARQUIVADA,
    });
  }

  /** Os três gestos de uma coluna só, num caminho só — a transação, o 404 e a
   *  linha de auditoria são idênticos nos três. */
  async mexerNaColuna({ id, adminUserId, coluna, valor, expressao, acao }) {
    if (!ehUuid(id)) throw recusa("Identificador de regra inválido.");

    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      const atual = await client.query(
        `SELECT ${coluna} FROM canastra.promocoes WHERE id = $1::uuid FOR UPDATE`,
        [id],
      );
      if (!atual.rows.length) throw recusa("Regra de desconto não encontrada.", 404);

      const valores = expressao ? [id] : [valor, id];
      await client.query(
        `UPDATE canastra.promocoes
            SET ${coluna} = ${expressao || "$1"}, atualizada_em = now()
          WHERE id = $${valores.length}::uuid`,
        valores,
      );

      const depois = await client.query(
        `SELECT ${coluna} FROM canastra.promocoes WHERE id = $1::uuid`,
        [id],
      );

      await registrar(client, {
        adminUserId,
        acao,
        entidade: ENTIDADES.PROMOCAO,
        entidadeId: id,
        antes: { [coluna]: atual.rows[0][coluna] },
        depois: { [coluna]: depois.rows[0][coluna] },
      });

      const regra = await buscarRegra(client, id);
      await client.query("COMMIT");
      return regra;
    } catch (erro) {
      await client.query("ROLLBACK").catch(() => {});
      throw traduzirErroDoBanco(erro);
    } finally {
      client.release();
    }
  }

  /* ---------------------------------------------------------------------- *
   * Simular
   * ---------------------------------------------------------------------- */

  /**
   * O SIMULADOR CHAMA O MOTOR DE VERDADE, e é a razão de esta função existir do
   * lado do servidor em vez de virar uma conta no navegador.
   *
   * `utils/motor.js` é a mesma função que o checkout usa para COBRAR. Uma
   * segunda implementação no painel divergiria — precedência entre classes,
   * exclusividade por grupo, rateio do teto pelo método do maior resto,
   * arredondamento em centavos — e a cópia que o gestor vê deixaria de ser a
   * que cobra. Um simulador que mente é pior que simulador nenhum, porque
   * autoriza a publicar a regra.
   *
   * NÃO TOCA O BANCO — nem para ler. A regra vem no corpo (é um RASCUNHO: simular
   * só o que já foi salvo inverteria a razão de existir do simulador) e passa
   * pela MESMA validação do POST, para que o simulador nunca dê um número sobre
   * uma regra que o Salvar recusaria.
   *
   * O QUE A SIMULAÇÃO NÃO REPRODUZ, e é honesto dizer: `metodo`, limite de uso,
   * orçamento e limite por CPF. Todos esses vivem em `motorRepository`, que
   * decide QUAIS regras chegam ao motor — aqui a regra é uma só e chega sempre,
   * como se o código tivesse sido digitado e os limites estivessem folgados. É
   * o que o gestor quer ver: quanto ESTA regra desconta neste carrinho.
   */
  simular({ regra, carrinho }) {
    if (!ehObjeto(regra)) throw recusa('Falta a regra a simular em "regra".');
    if (!ehObjeto(carrinho)) throw recusa('Falta o carrinho de teste em "carrinho".');

    const campos = interpretarCabecalho(regra);
    for (const obrigatorio of ["nome", "metodo", "classe", "mecanica"]) {
      if (!(obrigatorio in campos)) {
        throw recusa(`Falta "${obrigatorio}" — sem ele a regra não existe.`);
      }
    }
    const faixas = interpretarFaixas(regra.faixas ?? []);
    const escopo = interpretarEscopo(regra.escopo ?? []);
    const frete = interpretarFrete(regra.frete);
    conferirCoerencia(
      { minimo_tipo: "nenhum", minimo_valor: null, exclusiva: false, ...campos },
      { faixas },
    );

    const itens = interpretarItensDaSimulacao(carrinho.itens);
    const carrinhoDoMotor = {
      itens,
      meioPagamento: carrinho.meioPagamento
        ? umDe(MEIOS_DE_PAGAMENTO, carrinho.meioPagamento, "carrinho.meioPagamento")
        : null,
      assinante: carrinho.assinante === true,
      frete: ehObjeto(carrinho.frete)
        ? {
            valorCentavos: Math.max(0, Math.round(Number(carrinho.frete.valorCentavos) || 0)),
            ehMaisBarata: carrinho.frete.ehMaisBarata !== false,
            uf: textoOuNull(carrinho.frete.uf),
            cep: soDigitos(carrinho.frete.cep) || null,
          }
        : null,
    };

    const { ajustes, totalCentavos } = calcularDescontos(carrinhoDoMotor, [
      paraRegraDoMotor(campos, { escopo, faixas, frete }),
    ]);

    const subtotalCentavos = itens.reduce(
      (soma, item) => soma + item.precoCentavos * item.quantidade,
      0,
    );
    const descontoDeFrete = ajustes
      .filter((a) => a.alvo === "frete")
      .reduce((soma, a) => soma + a.valorCentavos, 0);

    return {
      /**
       * Os ajustes na forma do contrato — e `codigoId`, que o motor acrescenta
       * para a reserva do checkout, fica de fora: aqui não há reserva nenhuma.
       *
       * AQUI HAVIA UM CONTORNO, e ele foi REMOVIDO porque a origem foi
       * consertada. `motor.js` montava a referência do item com
       * `String(item.produtoId)`, e um item avulso (só SKU) produzia a string
       * literal "null"; esta camada a trocava por `null` para a tela não
       * estampar "· null".
       *
       * O problema era maior que a tela. O CHECK
       * `pedido_ajustes_alvo_ref_coerente` (0032) exige apenas
       * `btrim(alvo_ref) <> ''`, que "null" satisfaz — ou seja, no CHECKOUT a
       * palavra "null" seria gravada, calada, na tabela que existe para
       * responder "por que este pedido saiu por R$ 137,40?". O contorno aqui
       * limpava a vitrine e deixava o estrago onde ele custa.
       *
       * `motor.js` agora usa `referenciaDoItem`: `produtoId`, senão `sku`,
       * senão RECUSA na entrada. Manter a troca aqui passaria a APAGAR um SKU
       * legítimo no dia em que alguém cadastrasse um produto chamado "null" —
       * improvável, e exatamente o tipo de contorno que sobrevive ao problema
       * e vira defeito próprio.
       */
      ajustes: ajustes.map((a) => ({
        sequencia: a.sequencia,
        promocaoId: a.promocaoId,
        codigo: a.codigo,
        alvo: a.alvo,
        alvoRef: a.alvoRef,
        valorCentavos: a.valorCentavos,
        rotulo: a.rotulo,
      })),
      totalCentavos,
      subtotalCentavos,
      // Frete NÃO COTADO é `null`, e não zero: as duas coisas não são a mesma, e
      // a tela diz "não cotado" em vez de mostrar R$ 0,00 como se fosse grátis.
      freteFinalCentavos: carrinhoDoMotor.frete
        ? Math.max(0, carrinhoDoMotor.frete.valorCentavos - descontoDeFrete)
        : null,
    };
  }
}

/* ========================================================================== *
 * 5. A gravação dos filhos
 * ========================================================================== */

async function gravarEscopo(client, promocaoId, linhas, { substituir = false } = {}) {
  if (substituir) {
    // LISTA ENVIADA = LISTA FINAL. Apagar e regravar é seguro aqui porque nada
    // referencia `promocao_escopo`: ao contrário dos códigos, não há histórico
    // pendurado nestas linhas.
    await client.query("DELETE FROM canastra.promocao_escopo WHERE promocao_id = $1::uuid", [
      promocaoId,
    ]);
  }
  for (const linha of linhas) {
    await client.query(
      `INSERT INTO canastra.promocao_escopo (promocao_id, tipo, alvo, incluir)
       VALUES ($1::uuid, $2, $3, $4)`,
      [promocaoId, linha.tipo, linha.alvo, linha.incluir],
    );
  }
}

async function gravarFaixas(client, promocaoId, linhas, { substituir = false } = {}) {
  if (substituir) {
    await client.query("DELETE FROM canastra.promocao_faixas WHERE promocao_id = $1::uuid", [
      promocaoId,
    ]);
  }
  for (const linha of linhas) {
    await client.query(
      `INSERT INTO canastra.promocao_faixas
         (promocao_id, quantidade_min, desconto_tipo, desconto_valor)
       VALUES ($1::uuid, $2, $3, $4)`,
      [promocaoId, linha.quantidade_min, linha.desconto_tipo, linha.desconto_valor],
    );
  }
}

/** `promocao_frete` é uma linha por promoção (a PK é o próprio `promocao_id`),
 *  então `null` quer dizer "esta regra não tem condição de frete" e a linha sai. */
async function gravarFrete(client, promocaoId, frete, { substituir = false } = {}) {
  if (frete === null) {
    if (substituir) {
      await client.query("DELETE FROM canastra.promocao_frete WHERE promocao_id = $1::uuid", [
        promocaoId,
      ]);
    }
    return;
  }
  await client.query(
    `INSERT INTO canastra.promocao_frete
       (promocao_id, teto_frete_centavos, ufs, apenas_modalidade_mais_barata,
        cep_inicio, cep_fim)
     VALUES ($1::uuid, $2, $3::text[], $4, $5, $6)
     ON CONFLICT (promocao_id) DO UPDATE
        SET teto_frete_centavos = EXCLUDED.teto_frete_centavos,
            ufs = EXCLUDED.ufs,
            apenas_modalidade_mais_barata = EXCLUDED.apenas_modalidade_mais_barata,
            cep_inicio = EXCLUDED.cep_inicio,
            cep_fim = EXCLUDED.cep_fim,
            atualizado_em = now()`,
    [
      promocaoId,
      frete.teto_frete_centavos,
      frete.ufs,
      frete.apenas_modalidade_mais_barata,
      frete.cep_inicio,
      frete.cep_fim,
    ],
  );
}

/**
 * OS CÓDIGOS SÃO RECONCILIADOS, NUNCA SUBSTITUÍDOS — e esta é a diferença mais
 * cara entre eles e as outras três listas.
 *
 * `promocao_codigos.usos` é um contador que o checkout incrementa dentro da
 * transação de reserva de estoque, e `promocao_resgates.codigo_id` aponta para
 * a linha com `ON DELETE RESTRICT`. Apagar e regravar num PUT faria duas coisas
 * de uma vez: zeraria o contador de um código em campanha (o esgotamento
 * deixaria de valer) e levantaria 23503 no meio da gravação para qualquer
 * código já resgatado — que o gestor leria como "Erro interno no servidor.".
 *
 * Então: o que continua é ATUALIZADO (o contador fica), o que sumiu é APAGADO
 * só quando nunca foi resgatado, e o que sumiu TENDO SIDO resgatado é uma
 * recusa com frase. Trocar o texto de um código já usado cai na mesma recusa,
 * de propósito: seria reescrever a história de quem resgatou o quê.
 */
async function reconciliarCodigos(client, promocaoId, desejados) {
  const { rows: atuais } = await client.query(
    `SELECT c.id, c.codigo,
            EXISTS (SELECT 1 FROM canastra.promocao_resgates r WHERE r.codigo_id = c.id)
              AS resgatado
       FROM canastra.promocao_codigos c
      WHERE c.promocao_id = $1::uuid`,
    [promocaoId],
  );

  const porCodigo = new Map(atuais.map((linha) => [linha.codigo, linha]));
  const pedidos = new Set(desejados.map((c) => c.codigo));

  for (const atual of atuais) {
    if (pedidos.has(atual.codigo)) continue;
    if (atual.resgatado) {
      throw recusa(
        `O código ${atual.codigo} já foi resgatado e não pode ser removido — ` +
          "desligue-o (tire o “ativo”) em vez de apagá-lo, senão o relatório do pedido " +
          "que o usou fica sem explicação.",
        409,
      );
    }
    await client.query("DELETE FROM canastra.promocao_codigos WHERE id = $1::uuid", [
      atual.id,
    ]);
  }

  for (const codigo of desejados) {
    const existente = porCodigo.get(codigo.codigo);
    if (existente) {
      await client.query(
        `UPDATE canastra.promocao_codigos
            SET uso_unico = $2, limite_usos = $3, ativo = $4, atualizado_em = now()
          WHERE id = $1::uuid`,
        [existente.id, codigo.uso_unico, codigo.limite_usos, codigo.ativo],
      );
      continue;
    }
    await client.query(
      `INSERT INTO canastra.promocao_codigos
         (promocao_id, codigo, uso_unico, limite_usos, ativo)
       VALUES ($1::uuid, $2, $3, $4, $5)`,
      [promocaoId, codigo.codigo, codigo.uso_unico, codigo.limite_usos, codigo.ativo],
    );
  }
}

/* ========================================================================== *
 * 6. Do payload para o motor
 * ========================================================================== */

/**
 * O rascunho da tela no formato que `carregarRegrasVigentes` entrega ao motor.
 *
 * Os nomes mudam de `snake_case` para `camelCase` porque é o vocabulário do
 * motor, e ele é puro de propósito — não conhece coluna de banco. Esta função é
 * a única ponte entre os dois, e é por isso que ela vive junto do resto do
 * mapeamento em vez de dentro da rota.
 */
function paraRegraDoMotor(campos, { escopo, faixas, frete }) {
  return {
    id: null,
    nome: campos.nome,
    metodo: campos.metodo,
    classe: campos.classe,
    mecanica: campos.mecanica,
    valor: campos.valor ?? null,
    tetoDescontoCentavos: campos.teto_desconto_centavos ?? null,
    minimoTipo: campos.minimo_tipo ?? "nenhum",
    minimoValor: campos.minimo_valor ?? null,
    prioridade: campos.prioridade ?? 0,
    exclusiva: campos.exclusiva === true,
    grupoExclusividade: campos.grupo_exclusividade ?? null,
    meiosPagamento: campos.meios_pagamento ?? null,
    criadaEm: new Date().toISOString(),
    escopo,
    faixas: faixas.map((f) => ({
      quantidadeMin: f.quantidade_min,
      descontoTipo: f.desconto_tipo,
      descontoValor: f.desconto_valor,
    })),
    frete: frete
      ? {
          tetoFreteCentavos: frete.teto_frete_centavos,
          ufs: frete.ufs,
          apenasModalidadeMaisBarata: frete.apenas_modalidade_mais_barata,
          cepInicio: frete.cep_inicio,
          cepFim: frete.cep_fim,
        }
      : null,
    codigo: null,
  };
}

/** O carrinho de mentira, saneado. `precoCentavos` é o preço UNITÁRIO de
 *  catálogo, inteiro — a mesma unidade que o motor documenta. */
function interpretarItensDaSimulacao(bruto) {
  if (bruto === undefined || bruto === null) return [];
  if (!Array.isArray(bruto)) throw recusa('"carrinho.itens" precisa ser uma lista.');

  return bruto.map((item, i) => {
    const onde = `carrinho.itens[${i}]`;
    if (!ehObjeto(item)) throw recusa(`${onde} precisa ser um objeto.`);

    const preco = Number(item.precoCentavos);
    if (!Number.isInteger(preco) || preco < 0) {
      throw recusa(`${onde}.precoCentavos precisa ser um inteiro de centavos.`);
    }
    const quantidade = Number(item.quantidade);
    if (!Number.isInteger(quantidade) || quantidade < 1) {
      throw recusa(`${onde}.quantidade precisa ser um inteiro de 1 para cima.`);
    }

    return {
      produtoId: textoOuNull(item.produtoId),
      sku: textoOuNull(item.sku),
      categoria: textoOuNull(item.categoria),
      precoCentavos: preco,
      quantidade,
    };
  });
}

/* ========================================================================== *
 * 7. O erro do banco virando frase
 * ========================================================================== */

/**
 * Os dois SQLSTATE que o gestor consegue resolver sozinho, traduzidos.
 *
 * `23505` sobre `promocao_codigos.codigo` é o único conflito plausível daqui: o
 * unique é GLOBAL, e o caso normal é o gestor tentar reaproveitar num anúncio
 * novo o código de uma campanha antiga. A frase nomeia o código, e é a mesma
 * que o contrato da tela cita — "Já existe um código CAFE20." — porque trocá-la
 * por "Erro ao salvar" transforma um problema de dois minutos num chamado.
 *
 * O resto sobe intacto: um 23514 que chegue aqui é um `CHECK` que esta camada
 * deveria ter pegado antes, e escondê-lo atrás de uma frase genérica esconderia
 * o buraco junto.
 */
function traduzirErroDoBanco(erro) {
  if (erro.status) return erro;
  if (erro.code === "23505" && String(erro.detail || "").includes("codigo")) {
    const encontrado = /\((?:codigo)\)=\(([^)]+)\)/.exec(erro.detail || "");
    return recusa(
      encontrado
        ? `Já existe um código ${encontrado[1]}.`
        : "Já existe um código com este texto em outra regra.",
      409,
    );
  }
  return erro;
}

module.exports = new DescontosRepository();
module.exports.METODOS = METODOS;
module.exports.CLASSES = CLASSES;
module.exports.MECANICAS = MECANICAS;
module.exports.MECANICAS_INERTES = MECANICAS_INERTES;
module.exports.SITUACOES = SITUACOES;
module.exports.FILTRO_DE_SITUACAO = FILTRO_DE_SITUACAO;
