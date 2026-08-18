/**
 * Cadastro do cliente: conta no GoTrue + vínculo com a loja.
 *
 * SÃO DUAS COISAS, E A LOJA JÁ SOFREU POR TRATÁ-LAS COMO UMA SÓ.
 *
 *   1. TER CONTA é ter linha em `auth.users`. Quem cria é o GoTrue, e a
 *      instância do Supabase é COMPARTILHADA com outros projetos — ou seja,
 *      existe gente com conta válida ali que nunca ouviu falar desta loja.
 *   2. SER CLIENTE é ter linha em `canastra.clientes`. É isso que
 *      `canastra.eh_cliente()` responde, e `eh_cliente()` é a metade que
 *      sustenta toda política de dono do schema (0006).
 *
 * A migração 0006 revogou `INSERT` em `canastra.clientes` de `authenticated`
 * exatamente para que (1) não virasse (2) sozinho. A única porta é a RPC
 * `canastra.garantir_cliente`, criada pela 0008, e é ela que este arquivo
 * chama.
 *
 * REGRA DA 0008 QUE ESTE ARQUIVO PRECISA HONRAR, e que não é óbvia: a RPC roda
 * em TODA sessão autenticada, não só no cadastro. Ela é idempotente e nunca
 * sobrescreve perfil existente. É assim que o vínculo aparece para quem
 * confirma o e-mail dias depois e entra direto pelo login — esse caminho nunca
 * mais passa por esta tela. Quem faz essa chamada de rotina é
 * `montarUsuario()`, em `sessao.ts`.
 *
 * E A RAMIFICAÇÃO É POR `error.code`, NUNCA POR TEXTO NEM POR STATUS HTTP:
 * as duas recusas mais importantes — "não está logado" e "e-mail não
 * confirmado" — chegam as duas como HTTP 403 e só se distinguem pelo SQLSTATE
 * no corpo. Elas levam a telas DIFERENTES (login × reenviar confirmação), então
 * confundi-las é prender a pessoa num laço.
 */
import type { User } from "@supabase/supabase-js";
import { clienteNavegador } from "../supabase/cliente";

/** Onde o link do e-mail de confirmação cai de volta. */
export const CAMINHO_CONFIRMACAO = "/account/verify-email";
/** Onde o link do e-mail de recuperação de senha cai de volta. */
export const CAMINHO_NOVA_SENHA = "/account/reset-password";

/**
 * Monta a URL absoluta de retorno a partir da origem ATUAL.
 *
 * Não sai de variável de ambiente de propósito: em `next dev` a loja é
 * `localhost:3000`, em preview é outro host, em produção é o domínio real, e
 * uma constante errada manda o cliente para o ambiente errado depois de clicar
 * no link do e-mail. `window.location.origin` está sempre certo.
 *
 * O QUE PRECISA ESTAR CONFIGURADO DO OUTRO LADO, e é a falha nº 1 deste fluxo:
 * o GoTrue só honra `redirect_to` que esteja na lista de "Redirect URLs"
 * (Authentication → URL Configuration) do projeto. Uma URL fora da lista é
 * SILENCIOSAMENTE trocada pela Site URL — o cliente clica no link do e-mail e
 * cai na home, sem erro em lugar nenhum, achando que a confirmação falhou.
 */
export function urlDeRetorno(caminho: string): string | undefined {
  if (typeof window === "undefined") return undefined;
  return `${window.location.origin}${caminho}`;
}

/**
 * Nome com que a pessoa entra em `canastra.clientes` quando o vínculo é criado
 * fora da tela de cadastro (quem confirmou o e-mail dias depois).
 *
 * A ORDEM IMPORTA. `user_metadata.nome` é o que a tela de cadastro gravou; sem
 * ele sobra o começo do e-mail, que é feio mas identificável; e "Cliente" é o
 * último recurso, porque a coluna é NOT NULL e a alternativa a um nome ruim é
 * NENHUM VÍNCULO — o que deixa a pessoa logada e invisível para toda a RLS.
 *
 * Um nome ruim se conserta na tela de perfil (a política
 * `clientes_dono_atualiza` de 0006 existe para isso). Vínculo ausente não se
 * conserta sozinho.
 */
export function nomeParaCadastro(usuario: User): string {
  const metadados = (usuario.user_metadata ?? {}) as Record<string, unknown>;
  const doCadastro = typeof metadados.nome === "string" ? metadados.nome : "";
  const nome = doCadastro.trim();
  if (nome) return nome;

  const antesDoArroba = (usuario.email ?? "").split("@")[0]?.trim();
  return antesDoArroba || "Cliente";
}

/* ------------------------------------------------------------------ *
 * O vínculo: canastra.garantir_cliente
 * ------------------------------------------------------------------ */

/** SQLSTATEs que a 0008 escolheu, um por desfecho. Ver o cabeçalho da migração. */
export const SEM_SESSAO = "42501";
export const EMAIL_NAO_CONFIRMADO = "28000";
export const NOME_EM_BRANCO = "23502";
export const CPF_DUPLICADO = "23505";

/**
 * A função não existe no PostgREST. NÃO é erro de quem está usando a loja:
 * ou a 0008 não foi aplicada, ou `canastra` não está em "Exposed schemas"
 * (Settings → API → Data API) / `PGRST_DB_SCHEMAS`. Vale um recado explícito
 * porque o sintoma — "cadastro não funciona" — não aponta para nenhum dos dois.
 */
const RPC_AUSENTE = "PGRST202";
const ESQUEMA_NAO_EXPOSTO = "PGRST106";

const MENSAGENS_DE_VINCULO: Record<string, string> = {
  [SEM_SESSAO]: "Entre na loja para terminar o cadastro.",
  [EMAIL_NAO_CONFIRMADO]:
    "Confirme o e-mail desta conta antes de continuar. O link foi enviado no " +
    "cadastro.",
  [NOME_EM_BRANCO]: "Preencha o nome de quem vai receber a encomenda.",
  [CPF_DUPLICADO]:
    "Este CPF já está cadastrado em outra conta desta loja. Confira o número " +
    "ou entre com a conta que já o usa.",
  [RPC_AUSENTE]:
    "O cadastro está indisponível no momento. Já avisamos a equipe da loja.",
  [ESQUEMA_NAO_EXPOSTO]:
    "O cadastro está indisponível no momento. Já avisamos a equipe da loja.",
};

const PADRAO_DE_VINCULO =
  "Não foi possível concluir seu cadastro agora. Tente de novo em instantes.";

/**
 * Erro do vínculo, com o SQLSTATE preservado.
 *
 * `codigo` é o que a tela ramifica; `dica` é o `hint` que a 0008 escreveu em
 * português para cada recusa e que vale a pena mostrar ou registrar —
 * "Confira o número digitado, ou entre com a conta que já usa este CPF" é uma
 * instrução, não um enfeite.
 */
export class ErroDeVinculo extends Error {
  readonly codigo: string;
  readonly dica: string | null;

  constructor(mensagem: string, codigo: string, dica: string | null = null) {
    super(mensagem);
    this.name = "ErroDeVinculo";
    this.codigo = codigo;
    this.dica = dica;
  }
}

export type DadosDoVinculo = {
  nome: string;
  telefone?: string | null;
  cpf?: string | null;
};

/** Formato do erro do PostgREST. Duplicado aqui para não depender do tipo interno. */
type ErroDoPostgrest = {
  code?: string | null;
  message?: string | null;
  hint?: string | null;
  details?: string | null;
};

/**
 * Chama `canastra.garantir_cliente`.
 *
 * AS CHAVES AUSENTES SÃO OMITIDAS, NÃO MANDADAS COMO `null`. Parece o mesmo, e
 * não é: o PostgREST monta a chamada com os argumentos NOMEADOS que recebeu, e
 * só os que faltam caem no `DEFAULT NULL` do SQL. Mandar `{"cpf": null}`
 * também funciona hoje, mas amarra o front à assinatura atual — no dia em que a
 * 0008 ganhar um default diferente de NULL para algum campo, a chave explícita
 * o atropela em silêncio. Omitir é dizer "não informei", que é a verdade.
 */
export async function garantirCliente(dados: DadosDoVinculo): Promise<void> {
  const supabase = clienteNavegador();

  const telefone = dados.telefone?.trim();
  const cpf = dados.cpf?.trim();
  const argumentos = {
    nome: dados.nome,
    // Espalhar objeto vazio é o que faz a chave DESAPARECER do JSON. Um
    // `argumentos.telefone = undefined` continuaria existindo como chave em
    // alguns caminhos de serialização, e a intenção aqui é não mandar nada.
    ...(telefone ? { telefone } : {}),
    ...(cpf ? { cpf } : {}),
  };

  const { error } = await supabase.rpc("garantir_cliente", argumentos);
  if (!error) return;

  throw traduzirErroDeVinculo(error);
}

export function traduzirErroDeVinculo(erro: ErroDoPostgrest): ErroDeVinculo {
  const codigo = erro.code?.trim() || "desconhecido";
  const dica = erro.hint?.trim() || null;

  const conhecida = MENSAGENS_DE_VINCULO[codigo];
  if (conhecida) return new ErroDeVinculo(conhecida, codigo, dica);

  // Recusa que esta versão do front não conhece. A 0008 escreve mensagens em
  // português e curadas — usá-las é melhor do que a frase genérica —, mas o
  // original vai para o console de qualquer jeito, com o código, que é o que
  // permite acrescentar a linha certa na tabela acima.
  console.warn(
    `[cadastro] garantir_cliente recusou com código não traduzido: ${codigo} — ` +
      `${erro.message ?? ""} ${dica ? `(${dica})` : ""}`.trim(),
  );
  return new ErroDeVinculo(erro.message?.trim() || PADRAO_DE_VINCULO, codigo, dica);
}

/* ------------------------------------------------------------------ *
 * A conta: GoTrue signUp
 * ------------------------------------------------------------------ */

const MENSAGENS_DE_CADASTRO: Record<string, string> = {
  user_already_exists:
    "Já existe uma conta com este e-mail. Entre por ela, ou use " +
    "“esqueci a senha” se não lembrar.",
  email_exists:
    "Já existe uma conta com este e-mail. Entre por ela, ou use " +
    "“esqueci a senha” se não lembrar.",
  weak_password:
    "A senha é fraca demais. Use pelo menos 8 caracteres, misturando letras e " +
    "números.",
  validation_failed: "Confira os campos: algum dado não está no formato certo.",
  email_address_invalid: "Este e-mail não parece válido. Confira o endereço.",
  email_address_not_authorized:
    "Não conseguimos enviar e-mail para este endereço.",
  signup_disabled: "Novos cadastros estão temporariamente desligados.",
  email_provider_disabled:
    "O cadastro por e-mail e senha está desligado nesta loja no momento.",
  over_email_send_rate_limit:
    "Já enviamos e-mails demais para este endereço agora há pouco. Espere " +
    "alguns minutos e tente de novo.",
  over_request_rate_limit:
    "Tentativas demais em pouco tempo. Espere alguns minutos e tente de novo.",
  captcha_failed: "A verificação anti-robô falhou. Recarregue a página e tente de novo.",
};

const PADRAO_DE_CADASTRO =
  "Não foi possível criar sua conta agora. Tente de novo em instantes.";

export class ErroDeCadastro extends Error {
  readonly codigo: string;

  constructor(mensagem: string, codigo = "desconhecido") {
    super(mensagem);
    this.name = "ErroDeCadastro";
    this.codigo = codigo;
  }
}

type ErroDoGoTrue = { message?: string; code?: string; status?: number };

export function traduzirErroDeCadastro(erro: ErroDoGoTrue): ErroDeCadastro {
  const codigo = erro.code?.trim() || "desconhecido";
  const conhecida = MENSAGENS_DE_CADASTRO[codigo];
  if (conhecida) return new ErroDeCadastro(conhecida, codigo);

  console.warn(
    `[cadastro] GoTrue recusou o cadastro com código não traduzido: ${codigo} — ` +
      (erro.message ?? ""),
  );
  return new ErroDeCadastro(PADRAO_DE_CADASTRO, codigo);
}

export type DadosDeCadastro = {
  nome: string;
  email: string;
  senha: string;
  /**
   * Opcionais na ASSINATURA porque a RPC os aceita e a tela de perfil vai
   * precisar deles. A tela de cadastro da vitrine NÃO os pede — ver o comentário
   * de `cadastrar()`.
   */
  telefone?: string | null;
  cpf?: string | null;
};

export type ResultadoDeCadastro = {
  /**
   * `"pronto"` .................. há sessão e o vínculo com a loja já existe.
   * `"aguardandoConfirmacao"` ... o GoTrue reteve a sessão até o e-mail ser
   *                               confirmado. O vínculo NÃO PÔDE ser criado, e
   *                               a tela precisa dizer isso com todas as letras.
   */
  situacao: "pronto" | "aguardandoConfirmacao";
  email: string;
};

/**
 * Cria a conta e, quando dá, o vínculo.
 *
 * O QUE `signUp` DEVOLVE NESTA VERSÃO (@supabase/auth-js 2.112.3, conferido no
 * código instalado, não na memória):
 *
 *   - confirmação DESLIGADA (ou `GOTRUE_MAILER_AUTOCONFIRM`): `{ user, session }`
 *     com os dois preenchidos, e o `SIGNED_IN` já disparado.
 *   - confirmação LIGADA: `{ user, session: null }` — o usuário existe, o link
 *     foi enviado, e NÃO HÁ TOKEN. Sem token não há `auth.uid()`, então
 *     `garantir_cliente` responderia 42501. É por isso que a chamada é
 *     condicionada a `data.session` e não tentada "por via das dúvidas".
 *   - e-mail JÁ CADASTRADO, com confirmação ligada: o GoTrue devolve
 *     `{ user, session: null }` com `user.identities = []` e NENHUM erro. É
 *     ofuscação deliberada (anti-enumeração de usuários) e a tela DEVE se
 *     comportar igual ao cadastro novo. Não ramificamos nisso de propósito:
 *     transformar `identities: []` em "esse e-mail já tem conta" desfaz na
 *     interface a proteção que o servidor acabou de aplicar.
 *
 * POR QUE `nome` VAI PARA `user_metadata`
 * É o único jeito de o nome sobreviver até a confirmação. Quem clica no link
 * três dias depois, possivelmente em outro aparelho, não tem mais o formulário;
 * `nomeParaCadastro()` lê o metadado e o vínculo sai com o nome certo.
 *
 * POR QUE TELEFONE E CPF NÃO VÃO
 * `user_metadata` viaja DENTRO do JWT, e esta instância do Supabase é
 * compartilhada: o metadado acompanharia o token para qualquer outro projeto em
 * que a mesma pessoa entrasse. Nome é o que a loja já exibe; telefone e CPF são
 * dado pessoal com uso restrito ao pedido. Eles são coletados no checkout, que
 * é onde fazem falta — e, no caso do CPF, é também o único lugar com alguma
 * prova de posse do número (ver o aviso sobre CPF ocupado no cabeçalho da
 * 0008). Por isso a tela de cadastro da vitrine pede só nome, e-mail e senha.
 */
export async function cadastrar(
  dados: DadosDeCadastro,
): Promise<ResultadoDeCadastro> {
  const nome = dados.nome.trim();
  const email = dados.email.trim();

  // Recusa local do nome em branco. A 0008 também recusa (23502, com mensagem
  // curada), mas ela só é consultada quando HÁ sessão — e no caminho de
  // confirmação pendente ninguém chegaria lá. Sem esta linha, um cadastro com
  // nome vazio criaria a conta e só falharia dias depois, na confirmação.
  if (!nome) {
    throw new ErroDeCadastro(
      "Preencha o nome de quem vai receber a encomenda.",
      NOME_EM_BRANCO,
    );
  }

  const supabase = clienteNavegador();

  const { data, error } = await supabase.auth.signUp({
    email,
    password: dados.senha,
    options: {
      emailRedirectTo: urlDeRetorno(CAMINHO_CONFIRMACAO),
      data: { nome },
    },
  });

  if (error) throw traduzirErroDeCadastro(error);

  if (!data.session) {
    return { situacao: "aguardandoConfirmacao", email };
  }

  await garantirCliente({
    nome,
    telefone: dados.telefone,
    cpf: dados.cpf,
  });

  return { situacao: "pronto", email };
}

/**
 * Reenvia o e-mail de confirmação.
 *
 * A tela de login precisa disto: `email_not_confirmed` é a recusa mais comum
 * depois de um cadastro, e a saída dela não é "tente a senha de novo" — é o
 * link que ficou perdido na caixa de entrada.
 */
export async function reenviarConfirmacao(email: string): Promise<void> {
  const supabase = clienteNavegador();
  const { error } = await supabase.auth.resend({
    type: "signup",
    email: email.trim(),
    options: { emailRedirectTo: urlDeRetorno(CAMINHO_CONFIRMACAO) },
  });
  if (error) throw traduzirErroDeCadastro(error);
}
