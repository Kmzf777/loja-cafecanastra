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
import { paraE164, paraWhatsapp } from "./telefone";

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
/** 0019: está logado, mas ainda não há linha em `clientes` para carimbar. */
export const SEM_VINCULO = "P0002";

/**
 * Os dois códigos LOCAIS do telefone. Não vêm do Postgres: a recusa acontece
 * ANTES da rede, e ter código próprio é o que permite à tela pintar o campo
 * certo em vez de só imprimir a frase.
 *
 * SÃO DOIS, E NÃO UM, porque as instruções são diferentes: quem não preencheu
 * precisa saber que o campo é obrigatório e por quê; quem preencheu errado
 * precisa saber o FORMATO que se espera. "Confira o número" para um campo
 * vazio manda conferir o quê?
 */
export const TELEFONE_EM_BRANCO = "telefone_em_branco";
export const TELEFONE_INVALIDO = "telefone_invalido";

const PEDIDO_DE_TELEFONE =
  "Informe seu WhatsApp — é por ele que avisamos o andamento do pedido.";
const TELEFONE_FORA_DO_FORMATO =
  "Confira o WhatsApp: precisa ser um celular brasileiro com DDD, como " +
  "(37) 99999-0000.";

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
  // Logado, e-mail confirmado, e ainda assim sem linha em `clientes` — a 0019
  // recusa em vez de escrever no vazio. A frase NÃO pode ser "entre na loja"
  // (a do 42501): quem já está logado e lê isso não tem o que fazer.
  [SEM_VINCULO]:
    "Seu cadastro nesta loja ainda não foi concluído. Recarregue a página; se " +
    "continuar, saia e entre de novo.",
  [TELEFONE_INVALIDO]: TELEFONE_FORA_DO_FORMATO,
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
 * O WhatsApp: canastra.registrar_optin_whatsapp
 * ------------------------------------------------------------------ */

/**
 * A RPC da 0019. O nome é exportado porque os testes afirmam a SEPARAÇÃO entre
 * as duas chamadas, e uma constante evita que a asserção e o código combinem
 * de mudar juntos por engano.
 */
export const RPC_DO_OPTIN = "registrar_optin_whatsapp";

export type OptinDeWhatsapp = {
  /** O número, como a pessoa digitou. Normalizado aqui. */
  telefone?: string | null;
  /** `true` consente, `false` REVOGA, ausente não mexe. Ver o comentário abaixo. */
  promocoes?: boolean | null;
};

/**
 * Grava o número e/ou a preferência de promoções.
 *
 * POR QUE ISTO É UMA RPC E NÃO UM `UPDATE` DO POSTGREST — a pergunta que
 * qualquer um faz ao ler, já que `clientes` é a única tabela em que
 * `authenticated` conserva UPDATE:
 *
 *   · `whatsapp_promo_optin_em` NÃO É GRAVÁVEL PELO NAVEGADOR. A 0018 trocou o
 *     grant de tabela pela lista `(user_id, nome, cpf, telefone, criado_em,
 *     whatsapp_optout_em)`, exatamente porque carimbo de consentimento que o
 *     titular escreve não prova consentimento nenhum — e o ônus da prova é do
 *     controlador (LGPD Art. 8º §2º). Um UPDATE que toque aquela coluna leva
 *     42501 no comando inteiro.
 *   · `telefone` É GRAVÁVEL, e escrevê-lo direto seria PIOR do que não poder:
 *     `whatsapp_optin_em` está na lista fechada, então o navegador gravaria o
 *     número SEM o carimbo. E o bot manda para quem tem `telefone` e não tem
 *     `whatsapp_optout_em` (`notificacoes.js`) — ou seja, a loja passaria a
 *     escrever para um número sobre o qual não tem prova de consentimento
 *     nenhuma. É o limite que o cabeçalho da 0017 já apontava: "quem escrever
 *     aquele UPDATE tem de carimbar `whatsapp_optin_em` no mesmo gesto".
 *
 * Então o gesto é um só, do lado de lá, em `SECURITY DEFINER` — o mesmo padrão
 * de `garantir_cliente` (0008), e pelo mesmo motivo.
 *
 * AS CHAVES AUSENTES SÃO OMITIDAS, como em `garantirCliente` — mas aqui o
 * `false` NÃO é ausência. A RPC distingue três coisas: `NULL` ("não mexa"),
 * `true` (consentiu) e `false` (revogou). Deixar o `false` cair fora do JSON
 * faria desmarcar a caixa não desmarcar nada, que é o pior desfecho possível
 * para a revogação "gratuita e facilitada" do Art. 8º §5º.
 */
export async function registrarOptinDeWhatsapp(
  dados: OptinDeWhatsapp,
): Promise<void> {
  const argumentos: { telefone?: string; promocoes?: boolean } = {};

  const informou = dados.telefone?.trim();
  if (informou) {
    const numero = paraWhatsapp(informou);
    // Recusa local, ANTES da rede: a RPC aceitaria o texto e gravaria um número
    // para o qual nada sai. Ver `paraWhatsapp`.
    if (!numero) {
      throw new ErroDeVinculo(TELEFONE_FORA_DO_FORMATO, TELEFONE_INVALIDO);
    }
    argumentos.telefone = numero;
  }

  if (typeof dados.promocoes === "boolean") {
    argumentos.promocoes = dados.promocoes;
  }

  // Nada a registrar: uma chamada que não muda nada custa uma ida ao banco e
  // ainda assim rodaria o UPDATE do outro lado, mexendo no `criado_em` de
  // nada. Sair aqui é mais honesto do que confiar no `RETURN` de lá.
  if (Object.keys(argumentos).length === 0) return;

  const supabase = clienteNavegador();
  const { error } = await supabase.rpc(RPC_DO_OPTIN, argumentos);
  if (!error) return;

  throw traduzirErroDeVinculo(error);
}

/**
 * O que mandar no campo `telefone` da RPC: o que a pessoa digitou, ou nada.
 *
 * POR QUE ESTA DECISÃO EXISTE, e por que ela vale um módulo de `lib/`: o
 * telefone era gravável UMA vez e nunca mais. Não há tela de perfil,
 * `garantir_cliente` faz `RETURN` quando a linha já existe (0017:329-331), o
 * painel do gestor só lê (`RegisteredClients.jsx`), e não há
 * `UPDATE canastra.clientes SET telefone` em lugar nenhum do Express. Quem
 * digitasse `99999-0001` em vez de `99999-0000` — formato perfeitamente válido,
 * passa por `paraWhatsapp` sem reclamar — mandaria *"Olá, Ana. Recebemos seu
 * pedido…"* para um ESTRANHO a cada mudança de status, veria o número errado na
 * própria área da conta, e não teria onde trocar. E se o estranho apertasse
 * "Parar avisos", quem ficaria sem avisos era a Ana.
 *
 * A CAPACIDADE JÁ EXISTIA: `registrar_optin_whatsapp` (0019) troca o número e
 * RE-CARIMBA `whatsapp_optin_em` no mesmo gesto — `now()` e não
 * `COALESCE(...)`, de propósito, porque o carimbo tem de descrever o número que
 * está gravado AGORA (0019:174-179). Faltava a tela mandar o número.
 *
 * E FALTAVA MANDAR SÓ QUANDO ELE MUDOU, que é o que esta função decide. Mandar
 * sempre re-carimbaria o consentimento a cada visita à tela, apagando a data em
 * que a pessoa de fato deixou o número — que é a única coisa que aquela coluna
 * existe para guardar.
 *
 * A COMPARAÇÃO É PELO NÚMERO NORMALIZADO, E NÃO PELO TEXTO. O campo mostra a
 * máscara ("(31) 99999-0000"), o banco guarda o que a pessoa digitou no
 * cadastro (quase ninguém digita "+55"), e `paraE164` é a lente que enxerga as
 * três formas como o mesmo aparelho. `paraE164` e não `paraWhatsapp` porque
 * aqui a pergunta é "mudou?" e não "serve?": um cadastro antigo pode ter um
 * fixo gravado, e comparar com a régua estrita diria "mudou" toda vez.
 *
 * O RAMO QUE SALVA DO SILÊNCIO: só se considera "não mudou" quando os DOIS
 * lados normalizam para algo. Dois textos impresentáveis normalizam para `null`
 * cada um, e `null === null` diria "não mudou" — o que a pessoa digitou seria
 * engolido em silêncio e a tela responderia "está tudo salvo". Com esta guarda,
 * o texto segue para `registrarOptinDeWhatsapp`, que o recusa com
 * `TELEFONE_INVALIDO` antes da rede.
 *
 * BRANCO É "NADA A FAZER", e nunca "apague meu número": a RPC é
 * `COALESCE(telefone_limpo, c.telefone)` e não sabe apagar. Quem chama trata o
 * branco como erro de formulário — sair daqui com `undefined` só garante que
 * uma tela distraída não grave a preferência dizendo que gravou o número.
 */
export function telefoneParaRegistrar(
  gravado: string | null | undefined,
  digitado: string,
): string | undefined {
  const limpo = digitado.trim();
  if (!limpo) return undefined;

  const novo = paraE164(limpo);
  const atual = paraE164(gravado);
  if (novo && atual && novo === atual) return undefined;

  return limpo;
}

/**
 * Volta a receber depois de ter pedido para parar — o único gesto de WhatsApp
 * que NÃO passa pela RPC.
 *
 * E não passa de propósito: `whatsapp_optout_em` é a única das cinco colunas
 * que a 0018 deixou aberta ao titular, e deixou porque o direito de parar tem
 * de caber num clique do navegador. Escrever `null` ali é o mesmo privilégio
 * usado no outro sentido, pela mesma pessoa, sobre a própria linha (a política
 * `clientes_dono_atualiza` de 0006 exige `user_id = auth.uid()` nas duas
 * pontas). Mandar isto para dentro da RPC daria à função um poder que ela não
 * precisa ter.
 *
 * POR QUE ISTO EXISTE: sem ele, "PARAR" é uma porta de mão única. O menu do bot
 * tem um botão "Parar avisos" e o webhook trata PARAR/SAIR/STOP — um toque
 * errado no celular deixaria a pessoa sem aviso de pedido nenhum, para sempre,
 * e o único recurso seria escrever para o suporte.
 *
 * NÃO MEXE EM `whatsapp_optin_em`, e não deve: o carimbo descreve QUANDO a
 * pessoa deixou o número, e ela não deixou de novo. Voltar a receber é retirar
 * uma parada, não consentir outra vez.
 */
export async function voltarAReceberNoWhatsapp(userId: string): Promise<void> {
  const supabase = clienteNavegador();

  const { error } = await supabase
    .from("clientes")
    .update({ whatsapp_optout_em: null })
    .eq("user_id", userId);

  if (error) throw traduzirErroDeVinculo(error);
}

/** O que a área da conta precisa saber sobre o WhatsApp de quem está logado. */
export type ContatoDeWhatsapp = {
  /** `null` quando o cadastro nasceu sem número — o caso que o bloco convida. */
  telefone: string | null;
  /** Consentiu com promoções? */
  promocoes: boolean;
  /** Pediu para parar de receber (respondeu PARAR, ou clicou no botão do menu). */
  parado: boolean;
};

/**
 * Lê o contato de WhatsApp da própria linha em `canastra.clientes`.
 *
 * OS CARIMBOS VIRAM BOOLEANOS AQUI, e a tela nunca vê timestamp: a data em que
 * a pessoa consentiu é PROVA para a loja, não informação de interface — e
 * `whatsapp_promo_optin_em` chega como string ISO do PostgREST, que numa tela
 * só serviria para ser formatada errada.
 *
 * `null` QUANDO A LEITURA FALHA, e essa é a escolha de falha segura. O inverso
 * — devolver "sem telefone" quando a rede caiu — pediria o número de novo a
 * quem já o deu, e um segundo carimbo de opt-in por cima de um erro de rede.
 * Quem chama some com o bloco, que é o comportamento correto na dúvida.
 */
export async function lerWhatsappDaConta(
  userId: string,
): Promise<ContatoDeWhatsapp | null> {
  const supabase = clienteNavegador();

  const { data, error } = await supabase
    .from("clientes")
    .select("telefone, whatsapp_promo_optin_em, whatsapp_optout_em")
    .eq("user_id", userId)
    .maybeSingle();

  if (error) {
    console.warn(
      "[conta] Não foi possível ler o contato de WhatsApp. " +
        `${error.code ?? ""} ${error.message ?? ""}`.trim(),
    );
    return null;
  }
  // Sem linha em `clientes` não é erro: é quem confirmou o e-mail agora e ainda
  // não passou por `montarUsuario()`. Também some com o bloco.
  if (!data) return null;

  return {
    telefone: data.telefone?.trim() || null,
    promocoes: Boolean(data.whatsapp_promo_optin_em),
    parado: Boolean(data.whatsapp_optout_em),
  };
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
   * OBRIGATÓRIO NO TIPO, e é o ponto da tarefa. A loja não coletava telefone de
   * ninguém: o cadastro pedia nome, e-mail e senha, e `clientes.telefone`
   * nascia nula em todo mundo. O bot inteiro — avisos de pedido, atendimento
   * por botões, painel — não tinha para quem falar.
   */
  telefone: string;
  /**
   * A caixa de promoções. `undefined` e `false` são a MESMA coisa aqui:
   * consentimento não tem valor padrão.
   */
  promocoes?: boolean;
  /**
   * Opcional na ASSINATURA porque a RPC o aceita e a tela de perfil vai
   * precisar dele. A tela de cadastro da vitrine NÃO o pede — ver o comentário
   * de `cadastrar()`.
   */
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
 * dado pessoal com uso restrito ao pedido. No caso do CPF, o checkout é também
 * o único lugar com alguma prova de posse do número (ver o aviso sobre CPF
 * ocupado no cabeçalho da 0008).
 *
 * E O TROCO DISSO, QUE É CONHECIDO E TEM REMÉDIO: quem se cadastra com
 * confirmação de e-mail ligada e clica no link três dias depois PERDE o número
 * e a preferência de promoções no caminho. Aquele segundo caminho não passa
 * mais por esta tela — quem cria o vínculo é `montarUsuario()` (`sessao.ts`) ou
 * a tela de confirmação, e as duas só sabem o nome. O remédio é o bloco de
 * WhatsApp da área da conta, que aparece justamente para quem está sem número.
 * Guardar o telefone em `user_metadata` para "não perder" seria mandar o
 * celular do cliente para dentro de um token que outros projetos leem.
 *
 * AS DUAS METADES DO WHATSAPP SÃO SEPARADAS AQUI, e a separação é o requisito:
 *
 *   · AVISO DE PEDIDO — execução de contrato (LGPD Art. 7º V). Não depende de
 *     consentimento: a pessoa pediu aquilo quando comprou. Ele vem junto com o
 *     número, dentro de `garantir_cliente`, que carimba `whatsapp_optin_em`.
 *   · PROMOÇÃO — consentimento (Art. 7º I). Precisa de cláusula destacada,
 *     finalidade determinada e revogação gratuita (Art. 8º §5º). Caixa à parte,
 *     desmarcada, e uma CHAMADA À PARTE.
 *
 * Fundir as duas faria o consentimento virar condição para criar a conta ("ou
 * aceita ou não compra"), e consentimento assim não é livre — não se sustenta
 * nem na LGPD nem na política da Meta.
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

  /**
   * O TELEFONE É CONFERIDO AQUI, ANTES DO `signUp`, e a ordem é a coisa toda.
   *
   * O campo é `required` no HTML, mas isso é o navegador cooperando: autofill
   * parcial, `noValidate` e envio por script passam por cima. E a recusa TEM de
   * vir antes da rede porque depois do `signUp` não há volta — a conta existe,
   * o e-mail fica tomado, e a pessoa devolvida ao formulário não consegue mais
   * se cadastrar. Só sobraria mandá-la ao "esqueci a senha" de uma conta que
   * ela acabou de criar sem querer.
   */
  const digitado = dados.telefone?.trim();
  if (!digitado) {
    throw new ErroDeCadastro(PEDIDO_DE_TELEFONE, TELEFONE_EM_BRANCO);
  }
  const telefone = paraWhatsapp(digitado);
  if (!telefone) {
    throw new ErroDeCadastro(TELEFONE_FORA_DO_FORMATO, TELEFONE_INVALIDO);
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
    telefone,
    cpf: dados.cpf,
  });

  /**
   * A SEGUNDA CHAMADA, e só quando a caixa foi marcada.
   *
   * A FALHA DELA NÃO DERRUBA O CADASTRO, de propósito. Neste ponto a conta
   * existe, o vínculo existe e `whatsapp_optin_em` está carimbado: o cadastro
   * DEU CERTO. Deixar o erro subir mostraria uma tela de falha a quem acabou de
   * conseguir tudo o que precisava, e a devolveria a um formulário que não tem
   * mais como criar a conta. A promoção é o acessório; a pessoa remarca a caixa
   * na área da conta quando quiser.
   *
   * O `console.warn` não é enfeite: sem ele, uma 0019 não aplicada faria TODA
   * caixa marcada sumir em silêncio, e ninguém descobriria por meses.
   */
  if (dados.promocoes) {
    try {
      await registrarOptinDeWhatsapp({ promocoes: true });
    } catch (erro) {
      const codigo = erro instanceof ErroDeVinculo ? erro.codigo : "desconhecido";
      console.warn(
        `[cadastro] O opt-in de promoções não foi gravado (${codigo}). A conta ` +
          "e o aviso de pedido estão de pé; a preferência pode ser remarcada na " +
          "área da conta.",
        erro,
      );
    }
  }

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
