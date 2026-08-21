const { Router } = require("express");
const rateLimit = require("express-rate-limit");
const pool = require("../pgPool");

/**
 * POST /newsletter — o formulário do rodapé.
 *
 * A RESPOSTA É SEMPRE `{ ok: true }` PARA E-MAIL VÁLIDO, inscrito novo ou
 * repetido, e isso é deliberado (anti-enumeração): se "já inscrito" tivesse
 * resposta própria, qualquer pessoa testaria se um e-mail específico está na
 * lista da loja — que é dado pessoal. A deduplicação acontece em silêncio no
 * banco, pelo UNIQUE de 0011 + ON CONFLICT DO NOTHING.
 *
 * O único caso que difere é o 400 de e-mail malformado, porque aí não há o
 * que vazar — a recusa fala do FORMATO, não da lista.
 *
 * POST /newsletter/descadastrar — a saída, pela MESMA disciplina. Ver o
 * cabeçalho de `descadastrar`: entrar e sair têm de custar o mesmo, e a
 * política de privacidade promete a saída em texto visível ao cliente.
 */

/** O mesmo formato básico do CHECK `newsletter_email_formato` (0011). */
const FORMATO_EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

/**
 * A normalização das DUAS rotas, num lugar só.
 *
 * Minúsculo e sem espaços na entrada: "Bea@Ex.com" e "bea@ex.com" são a mesma
 * caixa postal, e sem normalizar o UNIQUE deixaria as duas entrarem — e o
 * descadastro de uma não alcançaria a outra. Devolve `null` quando não há
 * e-mail apresentável; é o único caso em que as rotas respondem diferente.
 */
function normalizarEmail(bruto) {
  const email = String(bruto || "")
    .trim()
    .toLowerCase();
  if (!email || email.length > 254 || !FORMATO_EMAIL.test(email)) return null;
  return email;
}

async function inscrever(req, res) {
  const email = normalizarEmail(req.body?.email);

  if (!email) {
    return res.status(400).json({ error: "Informe um e-mail válido." });
  }

  try {
    await pool.query(
      `INSERT INTO canastra.newsletter_inscritos (email)
       VALUES ($1)
       ON CONFLICT (email) DO NOTHING`,
      [email],
    );
    return res.status(200).json({ ok: true });
  } catch (erro) {
    // Banco fora do ar não pode fingir sucesso: a pessoa acharia que está na
    // lista e não está. 500 honesto; o rodapé mostra o erro discreto.
    console.error("Erro ao inscrever na newsletter:", erro);
    return res.status(500).json({ error: "Não foi possível salvar agora." });
  }
}

/**
 * POST /newsletter/descadastrar — retirar o consentimento.
 *
 * POR QUE ELA EXISTE: a política de privacidade promete, em texto visível ao
 * cliente, que "você pode retirar o consentimento de e-mail a qualquer
 * momento". Até aqui só havia a rota de ENTRAR — a promessa não tinha
 * implementação nenhuma, e sair da lista era impossível por qualquer caminho
 * que a pessoa pudesse percorrer sozinha. Sair tem de ser tão fácil quanto
 * entrar (LGPD art. 8º, §5º e art. 18, IX); é a mesma régua do "Rever
 * cookies" do rodapé.
 *
 * A MESMA RESPOSTA PARA INSCRITO E NÃO-INSCRITO (`{ ok: true }`), pelo mesmo
 * motivo do cadastro: distinguir "apaguei" de "não estava lá" transformaria
 * esta rota no oráculo de enumeração que a outra recusa ser. O DELETE que não
 * casa com linha nenhuma devolve `rowCount` 0 e sucesso — e repetir o
 * descadastro é no-op, não erro. O 400 de formato continua sendo o único caso
 * diferente, e ele fala do FORMATO, nunca da lista.
 *
 * `lower(email)` DOS DOIS LADOS, como a exportação do titular
 * (`lgpd.routes.js`): o UNIQUE de 0011 é sensível a caixa e o e-mail não é.
 * Quem entrou por um caminho que não passou por esta normalização (o SQL
 * manual de um atendimento, um import) tem de ser alcançado pelo descadastro
 * do mesmo jeito.
 *
 * A DECISÃO SOBRE O TOKEN, registrada porque é o troco desta rota: o padrão de
 * mercado é descadastro por LINK ASSINADO no rodapé de cada campanha — só quem
 * recebeu o e-mail o descadastra, e ninguém tira terceiro da lista. Esta rota
 * simples aceita qualquer e-mail de qualquer pessoa, então um script pode
 * descadastrar a lista inteira de quem ele conheça o endereço. Foi escolhida
 * assim porque (a) NENHUMA campanha sai hoje — a lista existe e não é usada
 * para envio, só o transacional sai da loja —, logo não há e-mail em que o
 * link pudesse viajar; (b) o dano do abuso é simétrico ao do single opt-in que
 * a Onda 2 já assumiu por escrito (lá se inscreve terceiro, aqui se
 * descadastra), e nos dois casos o desfecho é uma linha a mais ou a menos numa
 * tabela que não dispara nada; e (c) o remédio é o MESMO trabalho: a tarefa que
 * ligar campanha tem de fazer double opt-in COM link assinado de descadastro
 * em todo envio — e é lá que o token nasce, junto do e-mail que o carrega.
 * Enquanto isso, o teto por IP é a contenção. Risco e pendência estão escritos
 * em `docs/seguranca-dados-pessoais.md`, seção da newsletter.
 */
async function descadastrar(req, res) {
  const email = normalizarEmail(req.body?.email);

  if (!email) {
    return res.status(400).json({ error: "Informe um e-mail válido." });
  }

  try {
    const { rowCount } = await pool.query(
      "DELETE FROM canastra.newsletter_inscritos WHERE lower(email) = $1",
      [email],
    );
    // SEM O E-MAIL NO LOG: o que se registra é que houve uma saída, não quem
    // saiu — um log com o endereço recriaria, em texto claro e fora da tabela,
    // exatamente o dado que a pessoa acabou de pedir para apagar.
    if (rowCount) {
      console.log("Descadastro da newsletter: uma inscrição foi apagada.");
    }
    return res.status(200).json({ ok: true });
  } catch (erro) {
    // Mesma postura do cadastro: banco fora do ar não finge sucesso. Fingir
    // aqui é pior — a pessoa sairia achando que não recebe mais nada.
    console.error("Erro ao descadastrar da newsletter:", erro);
    return res.status(500).json({ error: "Não foi possível salvar agora." });
  }
}

/**
 * Teto apertado (10/min por IP): a rota é pública, escreve no banco e um laço
 * despejando e-mails alheios aqui viraria spam de lista em nome da loja.
 */
const newsletterLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  message: { error: "Muitas inscrições seguidas. Aguarde um instante." },
});

/**
 * O MESMO teto do cadastro, em BALDE PRÓPRIO — e a separação não é detalhe.
 * O balde é por IP: compartilhado, um laço de inscrições esgotaria o teto e
 * quem estivesse atrás do mesmo IP (um escritório, um provedor móvel) perderia
 * o direito de SAIR da lista por causa do abuso de outra pessoa. É a mesma
 * lição do limite separado do admin em `conta.routes.js`.
 */
const descadastroLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  message: { error: "Muitas tentativas seguidas. Aguarde um instante." },
});

const newsletterRoutes = Router();
newsletterRoutes.post("/", newsletterLimiter, inscrever);
newsletterRoutes.post("/descadastrar", descadastroLimiter, descadastrar);

module.exports = { newsletterRoutes, inscrever, descadastrar };
