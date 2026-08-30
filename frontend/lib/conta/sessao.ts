/**
 * Sessão da vitrine — agora sobre o GoTrue do Supabase.
 *
 * A INTERFACE EXPORTADA NÃO MUDOU, e isso é o ponto do arquivo: sete arquivos
 * importam `entrar`, `recuperarSessao`, `sair`, `destinoDe`, `destinoSeguro`,
 * `Usuario`, `Sessao`, `ErroDeLogin` e nenhum deles precisou de edição. O que
 * mudou é o que existe do outro lado — antes um Express com bcrypt, cookie
 * httpOnly próprio e CSRF por `csurf`; hoje o GoTrue, com a sessão em cookie
 * first-party gerido pelo `@supabase/ssr`.
 *
 * O QUE SAIU, E POR QUE ISSO NÃO É PERDA
 *  - `localStorage["has_refresh"]`: era a pista de "vale a pena tentar o
 *    refresh", copiada do painel legado. O `supabase-js` guarda a sessão em
 *    cookie e sabe sozinho se há o que renovar. `sair()` ainda APAGA a chave,
 *    porque quem já tinha a marca gravada continuaria com ela para sempre.
 *  - `/csrf-token`: a API do Supabase é chamada com `Authorization: Bearer`, e
 *    não por cookie de sessão. Sem cookie de autenticação na requisição, não há
 *    o que um site de terceiro forjar. (O Express só perde o `csurf` na Task 5.)
 *  - O evento `shop:cartMerged` disparado pelo `entrar`: o único ouvinte que o
 *    repositório teve foi `legacy/contexts/productContext`, e ele só era montado
 *    DENTRO da ilha `/dashboard` — onde quem disparava era o próprio
 *    `legacy/contexts/loginContext/authContextProvider.jsx`. Ou seja, o disparo
 *    daqui nunca chegou a ninguém, e a Onda 7 apagou os dois lados do par. A
 *    fusão da sacola da vitrine é `canastra.fundir_sacola`.
 *
 * O QUE NÃO PODE VOLTAR
 *  - O papel de administrador NÃO vem de claim do JWT. Ver `lerPapel()`.
 */
import type { Session, User } from "@supabase/supabase-js";
import { clienteNavegador } from "../supabase/cliente";
import { ErroDeVinculo, garantirCliente, nomeParaCadastro } from "./cadastro";

/**
 * Origem da API.
 *
 * A definição MUDOU DE CASA na Onda 2-D: vive em `lib/api-base.ts`, porque
 * quatro módulos a copiavam com normalizações divergentes. O re-export fica —
 * `lib/sacola/sacola.tsx`, `lib/sacola/checkout.ts` e as páginas de conta já
 * importam daqui, e mudar quatro imports para economizar uma linha é troca
 * ruim. `conferirApiBase()`, logo abaixo, segue detectando o build que apontou
 * a loja pública para localhost.
 */
export { API_BASE } from "../api-base";
import { API_BASE } from "../api-base";

/**
 * Detecta a combinação que quebra tudo em silêncio: página servida de um
 * domínio real, apontando para localhost.
 *
 * A checagem é aqui e não no build porque `next build` roda com
 * NODE_ENV=production até quando é só uma verificação local — falhar ali
 * impediria compilar o projeto sem ter uma API configurada. O que importa de
 * fato é o runtime no navegador de quem visita, e isso só dá para saber
 * comparando com o host de onde a página veio.
 */
let jaAvisou = false;
function conferirApiBase() {
  if (typeof window === "undefined" || jaAvisou) return;

  const hostLocal = /^(localhost|127\.0\.0\.1|\[::1\])$/.test(
    window.location.hostname,
  );
  const apiLocal = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])/.test(API_BASE);

  if (!hostLocal && apiLocal) {
    jaAvisou = true;
    console.error(
      `[config] Esta página foi servida de ${window.location.origin}, mas a API ` +
        `está apontada para ${API_BASE}. Defina NEXT_PUBLIC_API_URL no build ` +
        "de produção — nenhuma chamada vai funcionar assim.",
    );
  }
}

/**
 * Destino de redirecionamento seguro.
 *
 * O `?de=` da tela de login era usado como veio. `?de=https://site-falso/`
 * mandava a pessoa para fora logo apos ela digitar a senha — a montagem
 * classica de phishing, com a credibilidade do dominio verdadeiro emprestada
 * ao golpe. So caminho interno vale.
 */
export function destinoSeguro(bruto: string | null, padrao: string): string {
  if (!bruto) return padrao;
  // Precisa comecar com uma barra e NAO com duas: "//evil.com" e URL absoluta
  // protocol-relative, que o navegador segue para fora do site.
  if (!bruto.startsWith("/") || bruto.startsWith("//")) return padrao;
  // "/\evil.com" e tratado como "//evil.com" por alguns navegadores.
  if (bruto.startsWith("/\\")) return padrao;
  return bruto;
}

/** Chave que o painel legado gravava (`authContextProvider.jsx`). Ninguém mais a
 *  LÊ — a Onda 7 apagou o leitor —, mas ela continua no `localStorage` de quem
 *  usou a loja antes disso, e é `sair()` quem a apaga. Ver `sair()`. */
const CHAVE_REFRESH_LEGADA = "has_refresh";

export type Usuario = {
  userId: string;
  email: string;
  name: string;
  role: string;
};

export type Sessao = { usuario: Usuario; accessToken: string };

/**
 * Os dois papéis que a vitrine reconhece.
 *
 * `destinoDe` compara com `"admin"`, e `app/(transacional)/account/page.tsx` também.
 * O valor do não-admin nunca foi lido por ninguém — o Express mandava
 * `"customer"`; aqui é `"cliente"`, em português como o resto do módulo.
 */
const PAPEL_ADMIN = "admin";
const PAPEL_CLIENTE = "cliente";

/**
 * Erro de login com CÓDIGO, e não só com frase.
 *
 * A tela precisa agir diferente para "senha errada" (tentar de novo) e para
 * "e-mail não confirmado" (reenviar o link) — e casar TEXTO de mensagem para
 * decidir isso é a fragilidade que este projeto já pagou caro. `codigo` é o
 * código do GoTrue, repassado cru; `message` é a frase de loja.
 *
 * O construtor continua aceitando só a mensagem, então nada que já usava
 * `new ErroDeLogin("…")` ou `e.message` quebra.
 */
export class ErroDeLogin extends Error {
  readonly codigo: string;

  constructor(mensagem: string, codigo = "desconhecido") {
    super(mensagem);
    this.name = "ErroDeLogin";
    this.codigo = codigo;
  }
}

/** Código do GoTrue para "logado, mas o e-mail nunca foi confirmado". */
export const CODIGO_EMAIL_NAO_CONFIRMADO = "email_not_confirmed";

/**
 * A TABELA DE TRADUÇÃO — o coração desta função, e o que os testes fixam.
 *
 * `Invalid login credentials` é a frase que o GoTrue devolve, em inglês, para
 * quem digitou a senha errada. Mostrá-la a um cliente da loja é entregar a
 * mensagem de depuração de outra empresa no lugar da nossa.
 *
 * A CHAVE É `error.code`, NUNCA O TEXTO. O texto do GoTrue muda entre versões
 * do servidor (e o servidor aqui é self-hosted, atualizado por fora do nosso
 * deploy); o código é contrato. `lib/error-codes.d.ts` do `@supabase/auth-js`
 * lista os que existem.
 *
 * SOBRE O `switch` NO TEXTO LOGO ABAIXO DA TABELA: é compatibilidade, e está
 * marcada como tal. GoTrue anterior a 2024 respondia SEM `code`, só com
 * `msg`/`error_description`. Nesse caso a tela perderia a distinção entre senha
 * errada e e-mail pendente — que é justamente a distinção que este módulo
 * existe para preservar. O fallback é feio de propósito, para incomodar quem
 * ler; ele some quando o GoTrue da instância for novo o bastante.
 */
const MENSAGENS_DE_LOGIN: Record<string, string> = {
  invalid_credentials: "E-mail ou senha incorretos. Confira e tente de novo.",
  // O GoTrue responde `user_not_found` em alguns caminhos. A frase é a MESMA de
  // propósito: dizer "esse e-mail não existe" transforma a tela de login num
  // verificador de quem é cliente da loja.
  user_not_found: "E-mail ou senha incorretos. Confira e tente de novo.",
  validation_failed: "Preencha o e-mail e a senha para entrar.",
  [CODIGO_EMAIL_NAO_CONFIRMADO]:
    "Sua conta ainda não foi confirmada. Abra o e-mail que enviamos no " +
    "cadastro e clique no link de confirmação.",
  user_banned:
    "Esta conta está bloqueada. Fale com a gente pelos canais no rodapé.",
  over_request_rate_limit:
    "Tentativas demais em pouco tempo. Espere alguns minutos e tente de novo.",
  over_email_send_rate_limit:
    "Já enviamos e-mails demais para este endereço agora há pouco. Espere " +
    "alguns minutos e tente de novo.",
  email_provider_disabled:
    "O acesso por e-mail e senha está desligado nesta loja no momento.",
  signup_disabled: "Novos cadastros estão temporariamente desligados.",
  weak_password:
    "A senha é fraca demais. Use pelo menos 8 caracteres, com letras e números.",
};

const PADRAO_DE_LOGIN =
  "Não foi possível entrar agora. Tente de novo em instantes.";

type ErroDoGoTrue = { message?: string; code?: string; status?: number };

/**
 * Traduz o erro do GoTrue e devolve TAMBÉM o código, porque a tela decide a
 * ação por ele.
 */
export function traduzirErroDeLogin(erro: ErroDoGoTrue): ErroDeLogin {
  const codigo = erro.code?.trim();

  if (codigo && MENSAGENS_DE_LOGIN[codigo]) {
    return new ErroDeLogin(MENSAGENS_DE_LOGIN[codigo], codigo);
  }

  // COMPATIBILIDADE COM GoTrue ANTIGO — ver o comentário da tabela. Só roda
  // quando o servidor não mandou `code` nenhum.
  if (!codigo) {
    const texto = (erro.message || "").toLowerCase();
    if (texto.includes("email not confirmed")) {
      return new ErroDeLogin(
        MENSAGENS_DE_LOGIN[CODIGO_EMAIL_NAO_CONFIRMADO],
        CODIGO_EMAIL_NAO_CONFIRMADO,
      );
    }
    if (texto.includes("invalid login credentials")) {
      return new ErroDeLogin(
        MENSAGENS_DE_LOGIN.invalid_credentials,
        "invalid_credentials",
      );
    }
  }

  // Código novo, que esta versão do front não conhece. A frase genérica vai
  // para a tela; o original vai para o console, que é onde alguém procura.
  if (typeof console !== "undefined" && (codigo || erro.message)) {
    console.warn(
      `[conta] GoTrue recusou o login com um código não traduzido: ` +
        `${codigo ?? "(sem código)"} — ${erro.message ?? ""}`,
    );
  }
  return new ErroDeLogin(PADRAO_DE_LOGIN, codigo || "desconhecido");
}

/**
 * O PAPEL VEM DA TABELA, NUNCA DO JWT — e esta é a decisão mais importante
 * deste arquivo.
 *
 * A instância do Supabase é COMPARTILHADA com outros projetos. Um claim de
 * papel dentro do token é afirmação de quem assinou o token, e quem assina não
 * é a loja: qualquer projeto da instância que consiga colocar
 * `{"role":"admin"}` no `user_metadata` de uma conta sua estaria promovendo
 * alguém aqui dentro. `user_metadata` é editável pelo próprio dono da conta —
 * ou seja, o "administrador" seria autoatribuído.
 *
 * `canastra.admins` não tem esse problema: a política `admins_admin_le` (0006)
 * só devolve linha para quem `canastra.eh_admin()` aprova, e escrever ali é
 * privilégio exclusivo de `service_role` (REVOKE de 0003). Um não-admin recebe
 * ZERO linhas — sem erro, sem 403 —, e é por isso que a ausência de linha aqui
 * é lida como "cliente" e não como falha.
 *
 * E a consulta também SERVE DE VERIFICAÇÃO do token: o PostgREST confere a
 * assinatura antes de avaliar qualquer política. Um token forjado não chega a
 * ser avaliado pela RLS — ele volta 401. Por isso `getSession()` (que confia no
 * cookie) é aceitável aqui: nada é decidido só com o que veio do cookie.
 */
async function lerPapel(
  supabase: ReturnType<typeof clienteNavegador>,
  userId: string,
): Promise<string> {
  const { data, error } = await supabase
    .from("admins")
    .select("user_id")
    .eq("user_id", userId)
    .maybeSingle();

  if (error) {
    // Falhar para "cliente" é o lado seguro: no pior caso um administrador de
    // verdade não vê o botão do painel e recarrega a página. O inverso —
    // assumir admin quando a consulta falhou — abriria a área de gestão por
    // causa de uma queda de rede.
    console.warn(
      "[conta] Não foi possível conferir canastra.admins; tratando como " +
        `cliente. ${error.code ?? ""} ${error.message ?? ""}`.trim(),
    );
    return PAPEL_CLIENTE;
  }

  return data ? PAPEL_ADMIN : PAPEL_CLIENTE;
}

/**
 * Lê o nome do perfil da loja (`canastra.clientes.nome`).
 *
 * Devolve `null` quando NÃO HÁ VÍNCULO — e essa é uma informação, não um erro:
 * é o caso de quem tem conta no GoTrue mas ainda não é cliente desta loja
 * (confirmou o e-mail agora, ou se cadastrou por outro projeto da instância).
 * Quem trata é `montarUsuario`.
 */
async function lerNomeDoPerfil(
  supabase: ReturnType<typeof clienteNavegador>,
  userId: string,
): Promise<string | null> {
  const { data, error } = await supabase
    .from("clientes")
    .select("nome")
    .eq("user_id", userId)
    .maybeSingle();

  if (error) {
    console.warn(
      "[conta] Não foi possível ler canastra.clientes. " +
        `${error.code ?? ""} ${error.message ?? ""}`.trim(),
    );
    return null;
  }

  // Sem cast: `data` vem tipado por `lib/supabase/tipos.ts`. Se um dia a coluna
  // `nome` for renomeada na migração e nos tipos, esta linha fica vermelha no
  // build em vez de devolver `undefined` calado em produção.
  const nome = data?.nome?.trim();
  return nome || null;
}

/**
 * Monta o `Usuario` a partir da sessão do GoTrue, criando o vínculo se faltar.
 *
 * POR QUE A RPC É CHAMADA AQUI, E NÃO SÓ NO CADASTRO
 * O contrato da 0008 é explícito: `garantir_cliente` roda em TODA sessão
 * autenticada. É assim que o vínculo aparece para quem se cadastrou, confirmou
 * o e-mail três dias depois e entrou direto pelo login — nesse caminho a tela
 * de cadastro nunca mais é visitada, e sem isto a pessoa entraria numa conta
 * que o banco não reconhece como cliente (endereços e carrinho voltariam
 * vazios por RLS, sem erro nenhum).
 *
 * O CUSTO É ZERO NO CASO COMUM porque a chamada só acontece quando a leitura de
 * `clientes` não achou linha. Quem já é cliente faz UMA consulta, não duas.
 *
 * E A FALHA NÃO PODE DERRUBAR A SESSÃO: se a RPC recusar (28000, e-mail
 * pendente, é o caso realista), a pessoa continua logada, apenas sem vínculo. A
 * tela de confirmação é quem trata isso com uma mensagem de verdade. Deixar o
 * erro subir aqui deslogaria alguém por causa de um e-mail não confirmado — o
 * pior desfecho possível, porque some com o botão de reenviar junto.
 */
async function montarUsuario(
  supabase: ReturnType<typeof clienteNavegador>,
  usuarioGoTrue: User,
): Promise<Usuario> {
  const userId = usuarioGoTrue.id;
  const email = usuarioGoTrue.email ?? "";

  const [nomeDoPerfil, papel] = await Promise.all([
    lerNomeDoPerfil(supabase, userId),
    lerPapel(supabase, userId),
  ]);

  let nome = nomeDoPerfil;

  if (!nome) {
    const desejado = nomeParaCadastro(usuarioGoTrue);
    try {
      await garantirCliente({ nome: desejado });
      nome = desejado;
    } catch (erro) {
      if (erro instanceof ErroDeVinculo) {
        console.warn(
          `[conta] Sessão sem vínculo em canastra.clientes (${erro.codigo}): ` +
            erro.message,
        );
      } else {
        console.warn("[conta] Falha ao criar o vínculo de cliente.", erro);
      }
      nome = desejado;
    }
  }

  return { userId, email, name: nome, role: papel };
}

async function montarSessao(
  supabase: ReturnType<typeof clienteNavegador>,
  sessaoGoTrue: Session,
): Promise<Sessao> {
  const usuario = await montarUsuario(supabase, sessaoGoTrue.user);
  return { usuario, accessToken: sessaoGoTrue.access_token };
}

/**
 * Cache do perfil, por usuário.
 *
 * `recuperarSessao()` é chamado no efeito de montagem de QUATRO lugares
 * diferentes — o provedor da sacola, a página da conta, o checkout e o login —
 * e cada chamada custa duas consultas ao PostgREST. Numa visita ao checkout
 * isso seriam quatro idas ao banco para responder a mesma pergunta.
 *
 * A chave é o `userId`, e não o access token: o token é trocado a cada
 * renovação (a cada hora), e trocar de token não muda nem o nome nem o papel.
 * `sair()` limpa — sem isso, entrar com outra conta na mesma aba mostraria o
 * nome da anterior enquanto o `userId` coincidisse (não coincide, mas depender
 * disso é frágil).
 */
let perfilEmCache: { userId: string; usuario: Usuario } | null = null;

/** Só para os testes e para `sair()`. */
export function _esquecerPerfil(): void {
  perfilEmCache = null;
}

export async function entrar(email: string, senha: string): Promise<Sessao> {
  conferirApiBase();
  const supabase = clienteNavegador();

  const { data, error } = await supabase.auth.signInWithPassword({
    email,
    password: senha,
  });

  if (error) throw traduzirErroDeLogin(error);

  if (!data.session) {
    // Não deveria acontecer com senha: `signInWithPassword` só devolve sessão
    // nula em fluxos de MFA, que esta loja não usa. Se acontecer, é melhor uma
    // frase honesta do que um `null` viajando até uma tela que espera objeto.
    throw new ErroDeLogin(PADRAO_DE_LOGIN, "sem_sessao");
  }

  // Login é o único momento em que o perfil PODE ter mudado desde a última
  // leitura (outra aba, outro aparelho). O cache começa do zero aqui.
  perfilEmCache = null;

  const sessao = await montarSessao(supabase, data.session);
  perfilEmCache = { userId: sessao.usuario.userId, usuario: sessao.usuario };
  return sessao;
}

/**
 * Restaura a sessão a partir do cookie do Supabase. Devolve `null` sem barulho
 * quando não há sessão — é o caminho normal de quem chega deslogado.
 *
 * POR QUE `getSession()` E NÃO `getUser()`
 * Os consumidores precisam do `accessToken` (a API Express ainda é chamada com
 * `Authorization: Bearer`), e só `getSession()` o devolve. A confiança no
 * cookie não fica solta: `lerPapel()` e `lerNomeDoPerfil()` vão ao PostgREST,
 * que confere a assinatura do token antes de qualquer política. Token inválido
 * volta 401 e o papel cai para "cliente" — nenhuma decisão é tomada apenas com
 * o conteúdo do cookie.
 *
 * `getSession()` também é o gatilho da RENOVAÇÃO: se o access token expirou, o
 * `supabase-js` troca o refresh token aqui dentro antes de responder.
 */
export async function recuperarSessao(): Promise<Sessao | null> {
  if (typeof window === "undefined") return null;
  conferirApiBase();

  try {
    const supabase = clienteNavegador();
    const { data, error } = await supabase.auth.getSession();
    if (error || !data.session) return null;

    const emCache =
      perfilEmCache && perfilEmCache.userId === data.session.user.id
        ? perfilEmCache.usuario
        : null;

    if (emCache) {
      return { usuario: emCache, accessToken: data.session.access_token };
    }

    const sessao = await montarSessao(supabase, data.session);
    perfilEmCache = { userId: sessao.usuario.userId, usuario: sessao.usuario };
    return sessao;
  } catch (erro) {
    // Variável de ambiente faltando (`ambiente.ts` lança com o nome dela) ou
    // rede fora. Nenhum dos dois pode derrubar a página inteira: quem chama
    // trata `null` como "visitante", que é o estado seguro.
    console.warn("[conta] Não foi possível recuperar a sessão.", erro);
    return null;
  }
}

export async function sair(): Promise<void> {
  perfilEmCache = null;

  try {
    const supabase = clienteNavegador();
    /**
     * `scope: "local"` DE PROPÓSITO. O padrão do `supabase-js` é `"global"`,
     * que revoga TODAS as sessões da conta — clicar em "Sair" no computador
     * derrubaria a pessoa também no celular. Numa loja isso é comportamento
     * surpreendente; o antigo `/auth/sign-out` do Express derrubava só esta.
     */
    await supabase.auth.signOut({ scope: "local" });
  } catch {
    // Falhar o logout no servidor não pode prender o usuário na conta: as
    // pistas locais saem de qualquer jeito logo abaixo.
  }

  try {
    // A LIMPEZA SOBREVIVE AO LEITOR, e é de propósito. Quem lia esta chave era
    // o painel legado, que a Onda 7 apagou — mas apagar código nosso não apaga
    // o `localStorage` de ninguém: quem entrou na loja antes do corte continua
    // com a marca gravada no navegador dele. Esta linha é o que a recolhe, e
    // por isso ela só pode sair depois que ninguém mais tiver a chave — o que
    // não tem data e não dá para medir daqui.
    localStorage.removeItem(CHAVE_REFRESH_LEGADA);
  } catch {
    // Modo privado sem cota: não há o que limpar.
  }
}

/** Para onde mandar alguém que acabou de entrar. */
export function destinoDe(usuario: Usuario): string {
  return usuario.role === PAPEL_ADMIN ? "/dashboard" : "/account";
}
