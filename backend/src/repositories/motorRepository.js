"use strict";

const crypto = require("node:crypto");
const pool = require("../pgPool");

/**
 * O motor lendo o banco: as sete tabelas de 0032 viram a entrada de
 * `utils/motor.js`, e as duas tabelas de registro (`promocao_resgates` e
 * `pedido_ajustes_desconto`) são escritas daqui.
 *
 * A DIVISÃO É A MESMA DE `preco.js`/`cupom.js`: a regra que decide dinheiro é
 * pura e testável sem Postgres; quem conhece coluna de banco é este arquivo. O
 * motor não sabe o que é limite de uso nem o que é um código — ele recebe as
 * regras que JÁ valem para este carrinho e este cliente, e calcula.
 *
 * UMA CONSULTA, NÃO N+1. Escopo, faixas, frete, código e contadores de uso vêm
 * todos no mesmo round-trip. O caminho é o mais quente da loja (roda duas vezes
 * por checkout e uma por cotação de frete), e um `for` de promoções com uma
 * consulta de escopo dentro seria uma consulta por campanha cadastrada.
 *
 * NINGUÉM ESCREVE `promocao_resgates` NEM `pedido_ajustes_desconto` PELO
 * NAVEGADOR — nem a admin. A 0032 REVOGA INSERT/UPDATE/DELETE das duas para
 * `authenticated`, de propósito: as linhas nascem aqui, pelo pool do Express,
 * que conecta como DONO do banco. É o mesmo desenho de `pedidos` em 0006 —
 * número que vira dinheiro não vem do navegador. Não é bug e não se "conserta".
 */

/**
 * O FILTRO DE VIGÊNCIA, PALAVRA POR PALAVRA COMO A POLÍTICA DE `anon` DA 0032.
 *
 * ISTO NÃO É REDUNDÂNCIA. O pool do Express conecta como DONO das tabelas, e o
 * dono não passa por RLS — a política `promocoes_vigentes_publicas` não filtra
 * nada nas consultas daqui. Se este predicado divergir daquele, a VITRINE (que
 * lê como `anon`, sob a política) e a COBRANÇA (que lê como dono, sob este
 * WHERE) passam a discordar sobre o mesmo carrinho. É exatamente o defeito que
 * `utils/preco.js` existe para evitar, só que entre duas camadas em vez de
 * entre três cópias de função.
 *
 * A DIFERENÇA QUE EXISTE E É DELIBERADA: a política acrescenta
 * `metodo = 'automatico'` porque para `anon` isso é uma questão de PUBLICIDADE
 * — a lista de códigos é o mapa de descontos da loja e não sai por um GET. O
 * recorte de método está no WHERE da consulta abaixo, separado deste
 * predicado, e o teste de não-divergência compara justamente o subconjunto
 * automático, onde os dois lados têm de coincidir linha a linha.
 *
 * `now()` E NÃO UM RELÓGIO INJETADO: é o mesmo `now()` da política, avaliado no
 * mesmo instante da transação. Um `$1::timestamptz` vindo do Node seria um
 * segundo relógio, e o dia em que ele atrasasse a vitrine e a cobrança
 * discordariam de novo — pela porta que este comentário fecha.
 *
 * Exportado para `test/motor_repositorio.test.js` poder comparar este texto com
 * o `pg_policies.qual` real do banco.
 */
const PREDICADO_DE_VIGENCIA = `
  p.habilitada
  AND p.arquivada_em IS NULL
  AND (p.inicio_em IS NULL OR p.inicio_em <= now())
  AND (p.fim_em    IS NULL OR p.fim_em    >= now())
`;

/**
 * SHA-256 do CPF, em hex minúsculo — a forma que
 * `promocao_resgates.documento_hash` aceita (CHECK `^[0-9a-f]{64}$`).
 *
 * O HASH É CALCULADO NO SERVIDOR, NUNCA RECEBIDO DO NAVEGADOR. Aceitar um hash
 * do cliente seria deixar quem quiser trocar de identidade para zerar o limite
 * por CPF — o limite deixaria de ser limite. E o CHECK do banco é a segunda
 * camada: um CPF cru (11 dígitos) ou formatado (14) leva 23514 ANTES de tocar o
 * disco, em vez de deixar mais uma cópia de dado pessoal numa tabela que
 * ninguém mais vai reler (as migrações 0013 e 0016 já pagaram esse preço).
 *
 * Minúsculo porque é o que `digest('hex')` do Node produz, e aceitar as duas
 * caixas faria dois hashes do mesmo CPF não casarem no `WHERE`.
 */
function hashDeDocumento(cpf) {
  const digitos = String(cpf || "").replace(/\D/g, "");
  if (digitos.length !== 11) return null;
  return crypto.createHash("sha256").update(digitos).digest("hex");
}

/**
 * A consulta única. Os `LEFT JOIN LATERAL` agregam os filhos em jsonb para o
 * mapeamento abaixo montar o formato do motor sem uma segunda ida ao banco.
 */
const CONSULTA_DE_REGRAS = `
  SELECT
    p.id,
    p.nome,
    p.metodo,
    p.classe,
    p.mecanica,
    p.valor,
    p.teto_desconto_centavos,
    p.minimo_tipo,
    p.minimo_valor,
    p.prioridade,
    p.exclusiva,
    p.grupo_exclusividade,
    p.meios_pagamento,
    p.criada_em,
    esc.linhas AS escopo,
    fx.linhas  AS faixas,
    pf.teto_frete_centavos,
    pf.ufs,
    pf.apenas_modalidade_mais_barata,
    pf.cep_inicio,
    pf.cep_fim,
    cod.id     AS codigo_id,
    cod.codigo AS codigo
  FROM canastra.promocoes p
  LEFT JOIN LATERAL (
    SELECT jsonb_agg(
             jsonb_build_object('tipo', e.tipo, 'alvo', e.alvo, 'incluir', e.incluir)
             ORDER BY e.incluir DESC, e.tipo, e.alvo
           ) AS linhas
      FROM canastra.promocao_escopo e
     WHERE e.promocao_id = p.id
  ) esc ON true
  LEFT JOIN LATERAL (
    SELECT jsonb_agg(
             jsonb_build_object(
               'quantidadeMin', f.quantidade_min,
               'descontoTipo',  f.desconto_tipo,
               'descontoValor', f.desconto_valor
             ) ORDER BY f.quantidade_min
           ) AS linhas
      FROM canastra.promocao_faixas f
     WHERE f.promocao_id = p.id
  ) fx ON true
  LEFT JOIN canastra.promocao_frete pf ON pf.promocao_id = p.id
  /*
   * O CÓDIGO ENTRA PELO JOIN, e é ele que decide se uma regra de método
   * 'codigo' sequer aparece: sem código digitado o join não casa, e o WHERE
   * abaixo corta a linha. 'uso_unico' e o limite do PRÓPRIO código são
   * conferidos aqui como CORTESIA de leitura — quem garante o esgotamento de
   * verdade é o incremento atômico de 'reservarCodigo', dentro da transação de
   * reserva de estoque (mesma divisão de 'utils/cupom.js' e 'reservarUso').
   */
  LEFT JOIN canastra.promocao_codigos cod
         ON cod.promocao_id = p.id
        AND cod.ativo
        AND cod.codigo = $1
        AND (cod.limite_usos IS NULL OR cod.usos < cod.limite_usos)
        AND (NOT cod.uso_unico OR cod.usos = 0)
  /*
   * 'promocao_resgates' É A VERDADE DO USO (0032), e não o contador: pedido
   * cancelado grava 'estornado_em' e o resgate deixa de contar — por isso o
   * filtro aqui, e não um 'count(*)' cru.
   */
  LEFT JOIN LATERAL (
    SELECT count(*)::int AS usados,
           count(*) FILTER (WHERE r.documento_hash = $2)::int AS do_cliente,
           coalesce(sum(r.valor_centavos), 0)::bigint AS gasto
      FROM canastra.promocao_resgates r
     WHERE r.promocao_id = p.id
       AND r.estornado_em IS NULL
  ) uso ON true
  WHERE ${PREDICADO_DE_VIGENCIA}
    AND (p.metodo = 'automatico' OR cod.id IS NOT NULL)
    AND (p.limite_usos IS NULL OR uso.usados < p.limite_usos)
    AND (p.orcamento_centavos IS NULL OR uso.gasto < p.orcamento_centavos)
    AND (
      p.limite_por_cliente IS NULL
      OR $2::text IS NULL
      OR uso.do_cliente < p.limite_por_cliente
    )
  ORDER BY p.prioridade DESC, p.criada_em, p.id
`;

/** Uma linha da consulta → uma regra no formato de `utils/motor.js`. */
function paraRegraDoMotor(linha) {
  const temFrete =
    linha.teto_frete_centavos !== null ||
    linha.ufs !== null ||
    linha.cep_inicio !== null ||
    linha.apenas_modalidade_mais_barata !== null;

  return {
    id: linha.id,
    nome: linha.nome,
    metodo: linha.metodo,
    classe: linha.classe,
    mecanica: linha.mecanica,
    valor: linha.valor,
    tetoDescontoCentavos: linha.teto_desconto_centavos,
    minimoTipo: linha.minimo_tipo,
    minimoValor: linha.minimo_valor,
    prioridade: linha.prioridade,
    exclusiva: linha.exclusiva,
    grupoExclusividade: linha.grupo_exclusividade,
    meiosPagamento: linha.meios_pagamento,
    criadaEm: linha.criada_em,
    escopo: linha.escopo || [],
    faixas: linha.faixas || [],
    frete: temFrete
      ? {
          tetoFreteCentavos: linha.teto_frete_centavos,
          ufs: linha.ufs,
          apenasModalidadeMaisBarata: Boolean(
            linha.apenas_modalidade_mais_barata,
          ),
          cepInicio: linha.cep_inicio,
          cepFim: linha.cep_fim,
        }
      : null,
    codigo: linha.codigo_id ? { id: linha.codigo_id, codigo: linha.codigo } : null,
  };
}

class MotorRepository {
  /**
   * As regras que valem AGORA para este contexto, prontas para o motor.
   *
   * @param {object} [contexto]
   *   `codigo`: o código digitado, JÁ normalizado para maiúsculo por quem
   *   chama (`utils/cupom.normalizarCodigo`) — o CHECK de 0032 garante que só
   *   existe maiúsculo no banco e a busca é por igualdade exata.
   *   `documentoHash`: SHA-256 do CPF (ver `hashDeDocumento`), ou null quando o
   *   pedido é de convidado sem CPF — ali o limite por cliente não se aplica.
   *   `client`: conexão de uma transação aberta, para a leitura que decide
   *   dinheiro acontecer dentro da MESMA transação da reserva.
   */
  async carregarRegrasVigentes(contexto = {}) {
    const { codigo = null, documentoHash = null, client = pool } = contexto;
    const { rows } = await client.query(CONSULTA_DE_REGRAS, [
      codigo || null,
      documentoHash || null,
    ]);
    return rows.map(paraRegraDoMotor);
  }

  /**
   * POR QUE ESTE CÓDIGO NÃO VEIO — e a resposta sai no vocabulário FECHADO do
   * checkout.
   *
   * `carregarRegrasVigentes` não distingue "não existe" de "existe e não vale
   * agora": as duas coisas são a ausência da linha. Para o cliente, porém, a
   * diferença é tudo — "Cupom não encontrado" manda procurar erro de digitação
   * num código que ele copiou certo do anúncio.
   *
   * AS CINCO FRASES SÃO CONTRATO, fixadas no plano mestre e escritas em
   * `utils/cupom.js`: o texto vai direto para a tela, então mudança aqui é
   * mudança de interface. Reusá-las é o que faz um código do motor e um cupom
   * legado recusarem com a MESMA frase enquanto os dois caminhos convivem.
   *
   * A CONSULTA SÓ SAI NO CAMINHO DA RECUSA — quando um código foi digitado e
   * nada casou. No caminho feliz, zero round-trip a mais.
   */
  async diagnosticarCodigo(codigo, client = pool) {
    const { rows } = await client.query(
      // Só as colunas que decidem a FRASE. Contador e limites ficam de fora de
      // propósito: qualquer um deles leva à mesma resposta ("esgotado"), que é
      // o default abaixo, e projetá-los só para não usá-los faria a consulta
      // parecer decidir mais do que decide.
      `SELECT c.ativo,
              p.habilitada, p.arquivada_em, p.inicio_em, p.fim_em
         FROM canastra.promocao_codigos c
         JOIN canastra.promocoes p ON p.id = c.promocao_id
        WHERE c.codigo = $1
        LIMIT 1`,
      [codigo],
    );
    if (!rows.length) return "Cupom não encontrado";

    const linha = rows[0];
    const agora = Date.now();

    // "Inativo" cobre o desligado e o que ainda não começou, exatamente como em
    // `utils/cupom.js`: para quem está validando, os dois significam a mesma
    // coisa, e "expirado" mentiria no segundo.
    if (!linha.ativo || !linha.habilitada || linha.arquivada_em) {
      return "Cupom inativo";
    }
    if (linha.inicio_em && agora < new Date(linha.inicio_em).getTime()) {
      return "Cupom inativo";
    }
    if (linha.fim_em && agora > new Date(linha.fim_em).getTime()) {
      return "Cupom expirado";
    }

    // Tudo o mais é esgotamento — inclusive o limite POR CLIENTE, que para
    // quem digitou é indistinguível do esgotamento global: o código não vale
    // mais para ele. Uma sexta frase ("você já usou este cupom") diria a essa
    // pessoa quantas vezes OUTRAS pessoas usaram, o que a campanha não deve
    // contar; e o vocabulário é fechado de propósito.
    return "Cupom esgotado";
  }

  /**
   * A TRAVA DO ESGOTAMENTO, e é literalmente o desenho de
   * `cuponsRepository.reservarUso` (0010): a MESMA linha de SQL que soma o uso
   * é a que confere o limite, então dois checkouts simultâneos no último uso
   * serializam na linha do código e o segundo recebe `false` — ANTES de ser
   * cobrado, porque isto roda DENTRO da transação de reserva de estoque.
   *
   * Por isso `client` é obrigatório: rodar no pool deixaria o incremento fora
   * do ROLLBACK que devolve a reserva.
   */
  async reservarCodigo(codigoId, client) {
    const { rowCount } = await client.query(
      `UPDATE canastra.promocao_codigos
          SET usos = usos + 1, atualizado_em = now()
        WHERE id = $1::uuid
          AND ativo
          AND (limite_usos IS NULL OR usos < limite_usos)
          AND (NOT uso_unico OR usos = 0)`,
      [codigoId],
    );
    return rowCount === 1;
  }

  /**
   * Compensação do contador. `WHERE usos > 0` protege o CHECK
   * `promocao_codigos_usos_nao_negativo`: uma devolução a mais vira no-op, não
   * 23514.
   *
   * `engolirErro` distingue os dois chamadores, e a distinção é a mesma que
   * `cuponsRepository` documenta: fora de transação (compensação de reserva já
   * commitada) perder a devolução não pode abortar as irmãs, então fica no log;
   * DENTRO da transação do webhook o erro tem de subir, virar ROLLBACK e 500,
   * porque erro engolido dentro de transação envenena tudo depois (25P02).
   */
  async devolverCodigo(codigoId, conexao = pool, { engolirErro = true } = {}) {
    const executar = () =>
      conexao.query(
        `UPDATE canastra.promocao_codigos
            SET usos = usos - 1, atualizado_em = now()
          WHERE id = $1::uuid AND usos > 0`,
        [codigoId],
      );

    if (!engolirErro) {
      const { rowCount } = await executar();
      return rowCount === 1;
    }
    try {
      const { rowCount } = await executar();
      return rowCount === 1;
    } catch (err) {
      console.error(
        `MOTOR: falha ao devolver o uso do código ${codigoId}:`,
        err.message,
      );
      return false;
    }
  }

  /**
   * Os resgates do pedido. `client` obrigatório: a linha só pode existir na
   * MESMA transação que grava o pedido — `promocao_resgates.pedido_id` é NOT
   * NULL com FK para `pedidos`, então não há resgate sem pedido, por
   * construção do schema.
   *
   * `ON CONFLICT DO NOTHING` sobre `promocao_resgates_uma_vez_por_pedido`: o
   * Mercado Pago reenvia notificação POR DESENHO, e o mesmo raciocínio dos
   * índices parciais de idempotência de 0005 vale aqui — uma reentrega não pode
   * contar duas vendas onde houve uma.
   */
  async gravarResgates(client, { pedidoId, userId = null, documentoHash = null, resgates }) {
    const gravados = [];
    for (const resgate of resgates) {
      const { rows } = await client.query(
        `INSERT INTO canastra.promocao_resgates
           (promocao_id, codigo_id, pedido_id, user_id, documento_hash, valor_centavos)
         VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, $5, $6)
         ON CONFLICT ON CONSTRAINT promocao_resgates_uma_vez_por_pedido DO NOTHING
         RETURNING id`,
        [
          resgate.promocaoId,
          resgate.codigoId || null,
          pedidoId,
          userId,
          documentoHash,
          resgate.valorCentavos,
        ],
      );
      if (rows[0]) gravados.push(rows[0].id);
    }
    return gravados;
  }

  /**
   * A decomposição do desconto, uma linha por ajuste, na ordem em que foram
   * aplicados. É o que responde "por que este pedido saiu por R$ 137,40?", o
   * que a NF-e do Bling exige para ratear desconto por item e o que sustenta o
   * estorno proporcional de uma devolução parcial — `pedidos.desconto` é UM
   * número agregado e não há como decompô-lo depois.
   */
  async gravarAjustes(client, pedidoId, ajustes) {
    for (const ajuste of ajustes) {
      await client.query(
        `INSERT INTO canastra.pedido_ajustes_desconto
           (pedido_id, promocao_id, codigo, alvo, alvo_ref, sequencia,
            valor_centavos, rotulo)
         VALUES ($1::uuid, $2::uuid, $3, $4, $5, $6, $7, $8)`,
        [
          pedidoId,
          ajuste.promocaoId || null,
          ajuste.codigo || null,
          ajuste.alvo,
          ajuste.alvoRef || null,
          ajuste.sequencia,
          ajuste.valorCentavos,
          ajuste.rotulo,
        ],
      );
    }
  }

  /**
   * DEVOLVE O USO de um pedido que morreu — cancelado, recusado ou com o Pix
   * expirado. Sem isto, carrinho abandonado queima campanha: um limite de 50
   * "gasto" em pedidos que ninguém pagou esgota a promoção sem vender nada.
   *
   * É `estornado_em`, e não DELETE, pela razão que a 0032 escreve: apagar a
   * linha apagaria junto o registro de que a campanha foi TENTADA, que é metade
   * do relatório.
   *
   * `estornado_em IS NULL` no WHERE torna a chamada idempotente — o reenvio de
   * webhook do Mercado Pago não estorna duas vezes, e o contador não desce
   * duas vezes junto.
   */
  async estornarResgatesDoPedido(pedidoId, client) {
    const { rows } = await client.query(
      `UPDATE canastra.promocao_resgates
          SET estornado_em = now()
        WHERE pedido_id = $1::uuid
          AND estornado_em IS NULL
        RETURNING id, promocao_id, codigo_id`,
      [pedidoId],
    );
    return rows;
  }
}

module.exports = new MotorRepository();
module.exports.hashDeDocumento = hashDeDocumento;
module.exports.PREDICADO_DE_VIGENCIA = PREDICADO_DE_VIGENCIA;
