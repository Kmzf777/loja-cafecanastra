const { Router } = require("express");
const rateLimit = require("express-rate-limit");
const pool = require("../pgPool");
const isAuthenticated = require("../middleware/isAuthenticated");
const isAdmin = require("../middleware/isAdmin");
const { ehUuid } = require("../utils/formatoUuid");
const { registrar, ACOES, ENTIDADES } = require("../services/adminLog");

/**
 * O que sobrou da conta no Express: SO o que o GoTrue nao faz.
 *
 * Cadastro, login, logout, confirmacao de e-mail, recuperacao e troca de senha
 * sairam daqui inteiros — o navegador fala com o GoTrue direto, pelo
 * `supabase-js` (ver `frontend/lib/conta/sessao.ts`). Sobrou UM caso: excluir a
 * propria conta. Ele precisa apagar a linha em `auth.users`, e aquele schema
 * pertence ao GoTrue: nem o `service_role` escreve nele (medido no seed, 42501).
 * O unico caminho e a Admin API do GoTrue com a `service_role key` — que so
 * existe deste lado da fronteira, e e justamente por isso que o endpoint
 * continua existindo.
 *
 * POR QUE O CAMINHO CONTINUA SENDO `/auth/users/me`: o painel legado chama esta
 * URL (`frontend/legacy/components/HeaderSection/header/Header.jsx`) e ele so
 * morre na F6. Renomear agora quebraria uma tela viva sem ganhar nada — o nome
 * do arquivo ja diz o que este modulo e.
 */
const contaRoutes = Router();

/**
 * Excluir conta e irreversivel e chama a Admin API do GoTrue. Sem teto, um
 * script com um token valido em maos vira uma enxurrada de chamadas
 * autenticadas contra o GoTrue da instancia inteira — que e compartilhada com
 * outros projetos.
 */
const exclusaoLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 5,
  message: { message: "Muitas tentativas. Tente novamente em uma hora." },
});

/**
 * Limite proprio para a exclusao administrativa: o teto de 5/hora do cliente
 * comum e apertado demais para um admin limpando cadastros (e o balde e por
 * IP — as exclusoes do admin esgotariam o proprio direito de apagar a conta).
 * Continua havendo teto porque cada chamada bate na Admin API do GoTrue da
 * instancia compartilhada.
 */
const exclusaoPeloAdminLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 30,
  message: { message: "Muitas exclusões seguidas. Aguarde um pouco." },
});

/** Cabecalhos da Admin API: o Kong exige `apikey`, o GoTrue exige o Bearer. */
const cabecalhoDe = (chave) => ({
  "Content-Type": "application/json",
  apikey: chave,
  Authorization: `Bearer ${chave}`,
});

const MENSAGEM_ULTIMO_ADMIN =
  "Você é a única pessoa que administra a loja. Cadastre outro administrador " +
  "antes de excluir sua conta.";

/**
 * A ORDEM DA EXCLUSÃO DE CONTA, inteira, num lugar só — as duas rotas
 * (`DELETE /auth/users/me` e `DELETE /auth/users/:id`) seguem esta, passo a
 * passo, e cada passo só existe por causa do troco que ele evita:
 *
 *   1. trava do último administrador ..... 409 explicado em vez do 500 opaco
 *                                          que a trigger `admins_nunca_zero`
 *                                          devolveria dentro da transação do
 *                                          GoTrue (0002);
 *   2. credencial do GoTrue ............... 503 antes de MEXER em qualquer
 *                                          dado: um deploy sem service key não
 *                                          pode cancelar assinatura nem redigir
 *                                          pedido de uma conta que ele nem
 *                                          conseguiria apagar;
 *   3. CANCELAR AS ASSINATURAS VIVAS ...... `cancelarAssinaturasAntesDeApagar`;
 *   4. REDIGIR ............................ `redigirAntesDeApagar`;
 *   5. APAGAR A INSCRIÇÃO NA NEWSLETTER ... `apagarInscricaoAntesDeApagar`;
 *   6. DELETE no GoTrue ................... a cascata leva `clientes`, e
 *                                          `pedidos`/`assinaturas`/`avaliacoes`
 *                                          ficam órfãos (ON DELETE SET NULL) —
 *                                          por isso 3, 4 e 5 vêm antes.
 *
 * 3 ANTES DE 4 e não o contrário: a redação da 0016 só toca assinatura
 * `cancelada` (enquanto a entrega recorrente existe, o endereço é necessário à
 * execução do contrato — LGPD art. 16, I). Redigir primeiro deixaria a
 * assinatura viva de fora, e o cancelamento seguinte a fecharia já sem redação.
 * Cancelando antes, elas chegam `cancelada` e a mesma passagem da redação as
 * alcança.
 *
 * 5 ANTES DE 6 pelo MESMO motivo que 4: `newsletter_inscritos` não tem
 * `user_id` — o vínculo com a pessoa é o E-MAIL, e o e-mail mora em
 * `auth.users`, que é justamente o que o passo 6 apaga. Depois do DELETE não há
 * mais como saber qual linha daquela tabela era de quem: a inscrição vira órfã
 * de fato, exatamente como o pedido irredigível, e o e-mail de quem pediu para
 * sumir do banco fica lá para sempre. Por isso o e-mail é LIDO e a linha é
 * APAGADA antes, na mesma requisição, e a falha aborta a exclusão.
 *
 * O TROCO ASSUMIDO, escrito para quem for depurar um caso real: se o GoTrue
 * falhar no passo 6, sobra uma conta VIVA com as assinaturas já canceladas, os
 * pedidos já redigidos e a inscrição na newsletter já apagada. É o lado certo
 * do erro — reversível no que importa (a pessoa segue cliente, com endereços
 * salvos e cadastro intactos; assinar de novo é um clique, e o Clube nunca
 * prometeu que cancelar é irreversível; reinscrever-se na newsletter é o mesmo
 * formulário do rodapé) e re-executável (a redação repetida é no-op por
 * `redigido_em`, o cancelamento repetido devolve `[]`, o DELETE da inscrição
 * repetido casa com zero linhas sem erro, e a segunda tentativa conclui no
 * GoTrue). O troco inverso — apagar primeiro — não é reversível em NADA: o
 * pedido órfão fica irredigível para sempre, o e-mail fica na lista sem dono
 * que se possa identificar, e o preapproval segue cobrando um cartão de alguém
 * que já não existe no banco.
 */

/**
 * CANCELAR AS ASSINATURAS VIVAS ANTES DE APAGAR.
 *
 * `assinaturas.user_id` é ON DELETE SET NULL (0015), igual a `pedidos`: apagar
 * a conta sem passar por aqui deixa um preapproval VIVO no Mercado Pago,
 * cobrando todo ciclo o cartão de uma pessoa que pediu para sumir do banco — e
 * órfão, sem dono para pedir o cancelamento. É o mesmo furo da redação, com
 * dinheiro dentro.
 *
 * A função vem pronta do Clube (`ClubeController.cancelarAssinaturasDoTitular`,
 * contrato no cabeçalho dela): alcança `pendente`/`ativa`/`pausada`, cancela no
 * MP ANTES de marcar local, devolve os ids fechados por ESTA chamada e `[]`
 * quando não havia nenhuma — o caso comum, que não é erro.
 *
 * RECUSA DO MP ABORTA A EXCLUSÃO, pela mesma disciplina da redação: nunca
 * apagar a conta deixando cobrança viva. O erro carrega `.status` (400 para
 * id fora do formato, 502 na recusa do MP) e `.canceladas` com o que já fechou
 * antes da falha — o que fechou continua fechado, e a re-execução tenta só o
 * que sobrou.
 *
 * ELA NÃO RECEBE `conexao`: fala com o pool da aplicação por conta própria, e
 * é assim mesmo — não há transação a compartilhar. Metade do trabalho dela
 * acontece no Mercado Pago, que não faz ROLLBACK; a garantia aqui é a
 * re-execução, não a atomicidade.
 *
 * Devolve `true` se já respondeu (falha) — o chamador retorna sem apagar.
 */
async function cancelarAssinaturasAntesDeApagar(alvoUserId, res, cancelar) {
  try {
    const canceladas = await cancelar(alvoUserId);
    if (canceladas.length) {
      // Rastro de auditoria: a exclusão fechou contrato de recorrência, e isso
      // é um fato comercial que precisa ter deixado linha no log.
      console.log(
        `Exclusão de conta ${alvoUserId}: ${canceladas.length} assinatura(s) ` +
          `canceladas antes de apagar (${canceladas.join(", ")}).`,
      );
    }
    return false;
  } catch (erro) {
    const jaFechadas = Array.isArray(erro.canceladas) ? erro.canceladas.length : 0;
    console.error(
      `Cancelamento de assinaturas falhou para ${alvoUserId} ` +
        `(${jaFechadas} já fechadas antes da falha); exclusão abortada:`,
      erro,
    );
    // `erro.status` quando o Clube o carimbou (400 id inválido, 502 recusa do
    // MP); 500 para o resto (o banco caiu no meio, por exemplo) — responder
    // 502 ali culparia o Mercado Pago por um problema desta casa.
    res.status(Number(erro.status) || 500).json({
      message:
        "Não consegui cancelar a assinatura do Clube agora, e por isso NADA " +
        "foi excluído — uma conta apagada com assinatura viva continuaria " +
        "sendo cobrada. Tente de novo em alguns instantes.",
    });
    return true;
  }
}

/**
 * O caminho de produção até o Clube, carregado SÓ na hora de usar.
 *
 * `require` dentro da função, e não no topo: o ClubeController constrói o SDK
 * do Mercado Pago ao ser carregado, e este módulo é importado por rotas (e por
 * testes) que não têm nada com assinatura. O cache do require faz o resto — a
 * segunda exclusão não recarrega nada.
 */
const cancelarAssinaturasPeloClube = (userId) =>
  require("../controllers/ClubeController").cancelarAssinaturasDoTitular(userId);

/**
 * REDIGIR ANTES DE APAGAR — e nunca o contrário. Esta ordem não é estilo, é a
 * única que funciona:
 *
 * Apagada a conta no GoTrue, a cascata leva `canastra.clientes` e o
 * `pedidos.user_id` vira NULL (ON DELETE SET NULL, 0005 — a venda é registro
 * fiscal e sobrevive). Só que o pedido órfão perdeu o VÍNCULO: não há mais
 * como saber de quem ele era, e o nome/CPF/endereço congelados em
 * `endereco_json` ficariam IRREDIGÍVEIS para sempre. Logo:
 *
 *   - a redação (`canastra.redigir_dados_do_titular`, 0013) roda ANTES do
 *     DELETE, na mesma requisição;
 *   - se ela falhar, a exclusão ABORTA (500) e a conta NÃO é apagada — quem
 *     pediu tenta de novo e as duas coisas acontecem juntas ou nenhuma;
 *   - ela roda DEPOIS da checagem de credencial do GoTrue: um deploy sem a
 *     service key (503) não deve redigir os pedidos de uma conta que nem
 *     poderia apagar.
 *
 * O QUE ELA ALCANÇA cresceu na 0016 sem que este chamador mudasse: além dos
 * pedidos, a mesma função redige o endereço das assinaturas CANCELADAS e troca
 * `avaliacoes.nome_exibicao` por 'Cliente Canastra' (o nome ficava PÚBLICO na
 * PDP depois da exclusão). O retorno continua sendo a contagem de PEDIDOS.
 *
 * O troco assumido está escrito por inteiro no bloco de ordem acima.
 *
 * Devolve `true` se já respondeu (falha) — o chamador retorna sem apagar.
 */
async function redigirAntesDeApagar(conexao, alvoUserId, res, mensagem) {
  try {
    await conexao.query("SELECT canastra.redigir_dados_do_titular($1::uuid)", [
      alvoUserId,
    ]);
    return false;
  } catch (erro) {
    console.error(`Redação LGPD falhou para ${alvoUserId}:`, erro);
    res.status(500).json({ message: mensagem });
    return true;
  }
}

/**
 * APAGAR A INSCRIÇÃO NA NEWSLETTER ANTES DE APAGAR A CONTA.
 *
 * O furo que esta função fecha: a Onda 2 criou a captação do rodapé
 * (`canastra.newsletter_inscritos`, 0011) e a Onda 3 criou a exclusão de conta
 * com redação — e as duas nunca se encontraram. Excluir a conta apagava tudo
 * MENOS o e-mail da pessoa, que continuava na lista da loja indefinidamente,
 * enquanto a política de privacidade prometia o contrário.
 *
 * POR QUE ANTES DO DELETE NO GOTRUE, e não depois: a tabela não tem `user_id`
 * (a inscrição do rodapé não exige conta — o vínculo é o E-MAIL, como a
 * exportação do titular em `lgpd.routes.js` já assumia). O e-mail só existe em
 * `auth.users`, que é o que o GoTrue apaga: passado o DELETE, ninguém mais
 * consegue dizer qual linha da lista era daquela pessoa. É o mesmo mecanismo do
 * pedido irredigível, e por isso a mesma ordem e a mesma disciplina de falha.
 *
 * `lower(email)` DOS DOIS LADOS, como a exportação: o UNIQUE de 0011 é sensível
 * a caixa e o e-mail não é — quem se inscreveu por um caminho que não passou
 * pela normalização da rota tem de ser alcançado aqui do mesmo jeito.
 *
 * TITULAR SEM E-MAIL NÃO É ERRO: a conta pode já não existir no GoTrue (a
 * segunda tentativa de uma exclusão que falhou no fim, um cliente cuja conta
 * foi apagada por fora). Sem e-mail não há o que casar, e insistir aqui
 * travaria uma exclusão que só quer terminar. Segue em frente.
 *
 * Devolve `true` se já respondeu (falha) — o chamador retorna sem apagar.
 */
async function apagarInscricaoAntesDeApagar(conexao, alvoUserId, res, mensagem) {
  try {
    const { rows } = await conexao.query(
      "SELECT email FROM auth.users WHERE id = $1",
      [alvoUserId],
    );
    const email = rows[0]?.email;
    if (!email) return false;

    const { rowCount } = await conexao.query(
      "DELETE FROM canastra.newsletter_inscritos WHERE lower(email) = lower($1)",
      [email],
    );
    // O e-mail NÃO entra no log: registra-se que a inscrição saiu, não quem
    // saiu — a linha de log recriaria, fora da tabela e em texto claro, o dado
    // que esta exclusão acabou de apagar. O `user_id` basta para auditar, e ele
    // deixa de existir em seguida de qualquer forma.
    if (rowCount) {
      console.log(
        `Exclusão de conta ${alvoUserId}: inscrição na newsletter apagada.`,
      );
    }
    return false;
  } catch (erro) {
    console.error(
      `Newsletter: falha ao apagar a inscrição de ${alvoUserId}; exclusão abortada:`,
      erro,
    );
    res.status(500).json({ message: mensagem });
    return true;
  }
}

/**
 * Exclui a conta de QUEM ESTA CHAMANDO, e de mais ninguem.
 *
 * O `user_id` vem de `req.user`, preenchido por `isAuthenticated` a partir do
 * `sub` do token verificado. Nao ha parametro de rota nem campo de corpo com
 * id: se houvesse, um cliente apagaria a conta de outro, e a rota administrativa
 * de apagar terceiros morreu junto com o `loginRepository`.
 *
 * A ORDEM IMPORTA. A trava do ultimo administrador e conferida ANTES da chamada
 * ao GoTrue porque a que vale de verdade e a do banco (trigger
 * `admins_nunca_zero`, 0002), e ela dispara tarde: `auth.users` -> `clientes`
 * -> `admins` e tudo ON DELETE CASCADE, entao a recusa apareceria DENTRO da
 * transacao do GoTrue e voltaria como um 500 opaco. Conferir antes e o que
 * transforma isso na frase que a pessoa le na tela. A trigger continua sendo a
 * garantia — esta checagem e a explicacao.
 *
 * `buscar` e injetavel para o teste poder exercer a recusa sem um GoTrue de pe.
 */
async function excluirMinhaConta(
  req,
  res,
  {
    conexao = pool,
    buscar = globalThis.fetch,
    ambiente = process.env,
    cancelarAssinaturas = cancelarAssinaturasPeloClube,
  } = {},
) {
  const { userId } = req.user;

  try {
    const { rows } = await conexao.query(
      `SELECT
         EXISTS (SELECT 1 FROM canastra.admins WHERE user_id = $1) AS sou_admin,
         (SELECT count(*) FROM canastra.admins) AS total`,
      [userId],
    );

    if (rows[0].sou_admin && Number(rows[0].total) <= 1) {
      // 409: o pedido esta correto, o estado da loja e que nao permite.
      return res.status(409).json({ message: MENSAGEM_ULTIMO_ADMIN });
    }

    const base = (ambiente.SUPABASE_URL || "").replace(/\/$/, "");
    const chave = ambiente.SUPABASE_SERVICE_ROLE_KEY;
    if (!base || !chave) {
      // Falhar alto e nao fingir: sem estas duas nao ha como apagar a conta no
      // GoTrue, e responder sucesso deixaria a pessoa achando que os dados dela
      // sairam quando nao sairam.
      console.error(
        "SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY ausentes: exclusão de conta impossível.",
      );
      return res.status(503).json({
        message: "Não consigo excluir contas agora. Tente novamente mais tarde.",
      });
    }

    // Passo 3 da ordem: assinatura viva vira `cancelada` no MP e aqui ANTES de
    // qualquer outra coisa — senão o preapproval sobrevive à conta, cobrando.
    if (await cancelarAssinaturasAntesDeApagar(userId, res, cancelarAssinaturas)) {
      return;
    }

    // Passo 4. Ver `redigirAntesDeApagar`: sem redação não há exclusão — o
    // pedido órfão de uma conta apagada sem redigir fica irredigível para
    // sempre. Chega aqui com as assinaturas já `cancelada`, que é o estado em
    // que a 0016 as alcança.
    const abortou = await redigirAntesDeApagar(
      conexao,
      userId,
      res,
      "Não foi possível excluir sua conta agora. Nada foi apagado; tente de novo.",
    );
    if (abortou) return;

    // Passo 5. Ver `apagarInscricaoAntesDeApagar`: o vínculo da lista é o
    // e-mail, e o e-mail some com `auth.users` no passo seguinte — depois dele
    // a inscrição fica sem dono identificável, na lista, para sempre.
    if (
      await apagarInscricaoAntesDeApagar(
        conexao,
        userId,
        res,
        "Não foi possível excluir sua conta agora. Nada foi apagado; tente de novo.",
      )
    ) {
      return;
    }

    const resposta = await buscar(`${base}/auth/v1/admin/users/${userId}`, {
      method: "DELETE",
      headers: cabecalhoDe(chave),
    });

    // 404 = a conta ja nao existe no GoTrue. O efeito pedido ja aconteceu, e a
    // cascata de `auth.users` ja levou `clientes` e `admins` junto.
    if (resposta.ok || resposta.status === 404) {
      return res.status(200).json({ message: "Sua conta foi excluída com sucesso." });
    }

    const corpo = await resposta.text().catch(() => "");

    // A corrida existe: outro administrador pode ter sido removido entre a
    // contagem acima e esta chamada. Quem barra ai e a trigger, e o que chega
    // aqui e o texto dela. Traduzir de volta para a mesma frase evita que a
    // pessoa veja "erro interno" quando o motivo tem nome.
    if (/administrador/i.test(corpo) || /23001/.test(corpo)) {
      return res.status(409).json({ message: MENSAGEM_ULTIMO_ADMIN });
    }

    console.error(`GoTrue recusou excluir ${userId}: ${resposta.status} ${corpo}`);
    return res.status(502).json({ message: "Não foi possível excluir sua conta agora." });
  } catch (erro) {
    console.error("Erro ao excluir conta:", erro);
    return res.status(500).json({ message: "Erro ao excluir conta." });
  }
}

/**
 * A lista de clientes do painel (RegisteredClients.jsx): nome e telefone da
 * loja (`canastra.clientes`), e-mail do GoTrue (`auth.users` — o pool conecta
 * como dono do banco e le `auth` normalmente) e a contagem de compras de
 * `canastra.pedidos`. O formato `{users, total, totalPages, page}` e o que o
 * componente ja consome; `id` E `user_id` saem iguais porque o JSX usa os
 * dois (key da tabela vs. handler de exclusao).
 *
 * SO CLIENTES DESTA LOJA: a consulta parte de `canastra.clientes`, nunca de
 * `auth.users` — a instancia e compartilhada, e listar `auth.users` inteiro
 * exporia as contas dos OUTROS projetos ao painel desta loja.
 */
async function listarClientes(req, res, { conexao = pool } = {}) {
  const page = Math.max(1, Number.parseInt(req.query.page, 10) || 1);
  const limitBruto = Number.parseInt(req.query.limit, 10) || 10;
  const limit = Math.min(100, Math.max(1, limitBruto));
  const offset = (page - 1) * limit;

  /**
   * A BUSCA, E ELA E O QUE FAZ ESTA TELA PARAR DE MENTIR (Onda 4).
   *
   * Ate aqui a rota aceitava so `page` e `limit`, e a tela filtrava o que tinha
   * carregado: uma caixa de busca sobre uma pagina de 100 linhas esconde o
   * cliente que casa e esta na pagina 3, e mostra um `total` que e o total
   * geral. O filtro tem de acontecer onde estao todas as linhas.
   *
   * Os quatro campos sao o que o gestor tem na mao quando alguem liga: o nome
   * que a pessoa disse, o e-mail com que ela comprou, o telefone do WhatsApp e
   * o CPF da nota. O `ILIKE` cobre o comeco, o meio e a caixa trocada.
   */
  const q = String(req.query.q || "").trim();
  const filtro = q
    ? `WHERE (c.nome ILIKE $1 OR u.email ILIKE $1 OR c.telefone ILIKE $1
              OR c.cpf ILIKE $1)`
    : "";
  const valores = q ? [`%${q}%`] : [];

  try {
    // A CONTAGEM USA O MESMO WHERE E O MESMO JOIN da listagem — contar em
    // `clientes` cru daria um total maior que a lista sempre que a busca
    // casasse por e-mail, e a paginacao ofereceria paginas vazias.
    const total = Number(
      (
        await conexao.query(
          `SELECT count(*)
             FROM canastra.clientes c
             LEFT JOIN auth.users u ON u.id = c.user_id
             ${filtro}`,
          valores,
        )
      ).rows[0].count,
    );
    const totalPages = Math.ceil(total / limit);

    const { rows } = await conexao.query(
      `SELECT
         c.user_id,
         c.user_id            AS id,
         c.nome               AS name,
         u.email,
         c.telefone           AS phone,
         (SELECT count(*)::int FROM canastra.pedidos p
           WHERE p.user_id = c.user_id) AS purchases
       FROM canastra.clientes c
       LEFT JOIN auth.users u ON u.id = c.user_id
       ${filtro}
       ORDER BY c.criado_em DESC
       LIMIT $${valores.length + 1} OFFSET $${valores.length + 2}`,
      [...valores, limit, offset],
    );

    return res.json({ users: rows, total, totalPages, page });
  } catch (erro) {
    console.error("Erro ao listar clientes:", erro);
    return res.status(500).json({ message: "Erro ao listar clientes." });
  }
}

/**
 * Exclusao de um cliente PELO ADMIN — a rota que a F2 apagou junto com o
 * loginRepository e que o painel (RegisteredClients.jsx) continua chamando.
 *
 * As garantias sao as mesmas de `excluirMinhaConta`, mais uma que so existe
 * aqui: o alvo TEM de ser cliente DESTA loja. A Admin API do GoTrue apaga
 * qualquer conta da instancia compartilhada — sem esta cerca, o painel desta
 * loja viraria um botao de apagar usuarios dos OUTROS projetos da VPS.
 *
 * A trava do ultimo administrador vale para o alvo, nao para quem chama: e a
 * mesma corrida de `excluirMinhaConta`, conferida antes por educacao e
 * garantida pela trigger `admins_nunca_zero` (0002) na cascata do DELETE.
 */
async function excluirClientePeloAdmin(
  req,
  res,
  {
    conexao = pool,
    buscar = globalThis.fetch,
    ambiente = process.env,
    cancelarAssinaturas = cancelarAssinaturasPeloClube,
  } = {},
) {
  const { id } = req.params;
  if (!ehUuid(id)) {
    return res.status(400).json({ message: "Identificador de cliente inválido." });
  }

  // QUEM mandou apagar fica no log. Esta rota é destrutiva e é exercida por
  // TERCEIROS (o painel apaga a conta de outra pessoa): sem esta linha, o
  // registro do que aconteceu não tem autor, e a pergunta "quem apagou o
  // cliente X?" não teria resposta em lugar nenhum. `?.` porque os testes
  // chamam o handler direto, sem passar pelo `isAuthenticated`.
  const admin = req.user?.userId ?? "desconhecido";
  console.log(`Admin ${admin} pediu a exclusão do cliente ${id}.`);

  try {
    const { rows } = await conexao.query(
      `SELECT
         EXISTS (SELECT 1 FROM canastra.clientes WHERE user_id = $1) AS eh_cliente,
         EXISTS (SELECT 1 FROM canastra.admins   WHERE user_id = $1) AS eh_admin,
         (SELECT count(*) FROM canastra.admins) AS total_admins,
         -- Para a linha de auditoria: depois do DELETE, o nome não existe mais
         -- em lugar nenhum, e "quem apagou quem?" sem o "quem" não responde
         -- nada. O CPF e o telefone NÃO entram — o registro da exclusão não
         -- pode ser a cópia que sobrou do dado que se apagou.
         (SELECT nome FROM canastra.clientes WHERE user_id = $1) AS nome`,
      [id],
    );

    if (!rows[0].eh_cliente) {
      // Ou nunca foi cliente, ou e usuario de OUTRO projeto da instancia —
      // nos dois casos a resposta e a mesma e a conta nao e tocada.
      return res.status(404).json({ message: "Cliente não encontrado nesta loja." });
    }

    if (rows[0].eh_admin && Number(rows[0].total_admins) <= 1) {
      return res.status(409).json({ message: MENSAGEM_ULTIMO_ADMIN });
    }

    const base = (ambiente.SUPABASE_URL || "").replace(/\/$/, "");
    const chave = ambiente.SUPABASE_SERVICE_ROLE_KEY;
    if (!base || !chave) {
      // Mesma postura de `excluirMinhaConta`: sem as duas, nao ha como apagar
      // no GoTrue, e responder sucesso fingiria uma exclusao que nao houve.
      console.error(
        "SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY ausentes: exclusão de cliente impossível.",
      );
      return res.status(503).json({
        message: "Não consigo excluir contas agora. Tente novamente mais tarde.",
      });
    }

    // A MESMA ordem da exclusão própria, passo a passo (o bloco de ordem lá em
    // cima vale para as duas rotas): cancelar as assinaturas vivas, redigir,
    // apagar a inscrição na newsletter, e só então apagar a conta. Falha em
    // qualquer um dos três aborta.
    if (await cancelarAssinaturasAntesDeApagar(id, res, cancelarAssinaturas)) {
      return;
    }

    const abortou = await redigirAntesDeApagar(
      conexao,
      id,
      res,
      "Não foi possível excluir o cliente agora. Nada foi apagado; tente de novo.",
    );
    if (abortou) return;

    if (
      await apagarInscricaoAntesDeApagar(
        conexao,
        id,
        res,
        "Não foi possível excluir o cliente agora. Nada foi apagado; tente de novo.",
      )
    ) {
      return;
    }

    const resposta = await buscar(`${base}/auth/v1/admin/users/${id}`, {
      method: "DELETE",
      headers: cabecalhoDe(chave),
    });

    // 404 = a conta ja nao existe no GoTrue; a cascata ja levou clientes e
    // admins junto. O efeito pedido ja aconteceu.
    if (resposta.ok || resposta.status === 404) {
      /**
       * O REGISTRO VEM DEPOIS DA EXCLUSAO, e nao antes: registrar antes deixaria
       * no log uma exclusao que o GoTrue pode ter recusado. O `antes` foi lido
       * la em cima, quando a linha ainda existia — depois da cascata nao ha de
       * onde tira-lo.
       *
       * Fora de transacao porque a exclusao acontece em OUTRO sistema (a Admin
       * API do GoTrue): nao ha transacao a compartilhar. Uma falha aqui vira
       * 500 com a conta ja apagada — o troco conhecido, e o lado seguro do erro
       * (a exclusao e o efeito pedido; o log e a prestacao de contas dela).
       */
      await registrar(conexao, {
        adminUserId: req.user?.userId ?? null,
        acao: ACOES.CLIENTE_EXCLUIDO,
        entidade: ENTIDADES.CLIENTE,
        entidadeId: id,
        antes: { nome: rows[0].nome ?? null, era_admin: rows[0].eh_admin },
      });
      return res.status(200).json({ message: "Cliente excluído com sucesso." });
    }

    const corpo = await resposta.text().catch(() => "");
    if (/administrador/i.test(corpo) || /23001/.test(corpo)) {
      return res.status(409).json({ message: MENSAGEM_ULTIMO_ADMIN });
    }

    console.error(`GoTrue recusou excluir ${id}: ${resposta.status} ${corpo}`);
    return res
      .status(502)
      .json({ message: "Não foi possível excluir o cliente agora." });
  } catch (erro) {
    console.error("Erro ao excluir cliente:", erro);
    return res.status(500).json({ message: "Erro ao excluir cliente." });
  }
}

contaRoutes.get("/users", isAuthenticated, isAdmin, (req, res) =>
  listarClientes(req, res),
);

// `/users/me` ANTES de `/users/:id`, e isso nao e estilo: o Express casa na
// ordem de registro, e com a ordem invertida um DELETE em /users/me cairia na
// rota administrativa com id "me" — 400 para o cliente comum tentando apagar a
// propria conta.
contaRoutes.delete("/users/me", exclusaoLimiter, isAuthenticated, (req, res) =>
  excluirMinhaConta(req, res),
);

contaRoutes.delete(
  "/users/:id",
  exclusaoPeloAdminLimiter,
  isAuthenticated,
  isAdmin,
  (req, res) => excluirClientePeloAdmin(req, res),
);

module.exports = {
  contaRoutes,
  excluirMinhaConta,
  listarClientes,
  excluirClientePeloAdmin,
  MENSAGEM_ULTIMO_ADMIN,
};
