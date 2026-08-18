/**
 * Recuperação e troca de senha, pelo GoTrue.
 *
 * São DUAS METADES, e elas quase nunca acontecem no mesmo minuto:
 *
 *   1. `pedirRedefinicao(email)` manda o e-mail com o link. Não exige sessão —
 *      é justamente para quem não consegue entrar.
 *   2. `definirNovaSenha(senha)` grava a senha nova. EXIGE sessão, e a sessão
 *      vem do próprio link: o GoTrue emite uma sessão de recuperação quando o
 *      código do e-mail é trocado. Sem essa sessão não há em quem gravar.
 *
 * O que substituiu o quê: o Express tinha `/auth/reset-password` com token
 * próprio numa tabela própria. Some tudo — token, expiração, invalidação do
 * anterior — porque o GoTrue já faz os três.
 */
import { clienteNavegador } from "../supabase/cliente";
import { CAMINHO_NOVA_SENHA, urlDeRetorno } from "./cadastro";

const MENSAGENS: Record<string, string> = {
  /**
   * O GoTrue recusa repetir a senha atual. Vale mensagem própria porque a
   * pessoa acabou de digitar duas vezes a mesma coisa e merece saber que o
   * problema não é o link.
   */
  same_password: "Esta é a mesma senha de antes. Escolha uma diferente.",
  weak_password:
    "A senha é fraca demais. Use pelo menos 8 caracteres, misturando letras e " +
    "números.",
  /**
   * `reauthentication_needed` aparece quando o projeto liga "Secure password
   * change" no painel do Supabase. Não é erro de quem está usando — é
   * configuração —, mas a frase precisa fazer sentido para quem lê.
   */
  reauthentication_needed:
    "Por segurança, entre de novo com a senha atual antes de trocá-la.",
  session_not_found:
    "O link de redefinição não vale mais. Peça um novo e use o mais recente.",
  session_expired:
    "O link de redefinição expirou. Peça um novo e use o mais recente.",
  otp_expired:
    "O link de redefinição expirou. Peça um novo e use o mais recente.",
  over_email_send_rate_limit:
    "Já enviamos e-mails demais para este endereço agora há pouco. Espere " +
    "alguns minutos e tente de novo.",
  over_request_rate_limit:
    "Tentativas demais em pouco tempo. Espere alguns minutos e tente de novo.",
  validation_failed: "Confira o e-mail digitado.",
  email_address_invalid: "Este e-mail não parece válido. Confira o endereço.",
};

const PADRAO = "Não foi possível concluir agora. Tente de novo em instantes.";

export class ErroDeSenha extends Error {
  readonly codigo: string;

  constructor(mensagem: string, codigo = "desconhecido") {
    super(mensagem);
    this.name = "ErroDeSenha";
    this.codigo = codigo;
  }
}

type ErroDoGoTrue = { message?: string; code?: string; status?: number };

export function traduzirErroDeSenha(erro: ErroDoGoTrue): ErroDeSenha {
  const codigo = erro.code?.trim() || "desconhecido";
  const conhecida = MENSAGENS[codigo];
  if (conhecida) return new ErroDeSenha(conhecida, codigo);

  console.warn(
    `[senha] GoTrue respondeu com código não traduzido: ${codigo} — ` +
      (erro.message ?? ""),
  );
  return new ErroDeSenha(PADRAO, codigo);
}

/**
 * Pede o e-mail com o link de redefinição.
 *
 * NÃO DEVOLVE NADA QUE DIGA SE A CONTA EXISTE, e a tela não pode inventar isso.
 * O GoTrue responde 200 mesmo para endereço desconhecido, de propósito: um
 * "não encontramos esse e-mail" transformaria o formulário num verificador de
 * quem é cliente da loja. Se o erro chegar, é rede ou limite de envio — nunca
 * "esse e-mail não existe".
 */
export async function pedirRedefinicao(email: string): Promise<void> {
  const supabase = clienteNavegador();
  const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), {
    redirectTo: urlDeRetorno(CAMINHO_NOVA_SENHA),
  });
  if (error) throw traduzirErroDeSenha(error);
}

/**
 * Grava a senha nova na sessão atual.
 *
 * `updateUser` age sobre QUEM ESTÁ LOGADO — não recebe token nem e-mail. Por
 * isso a tela precisa ter certeza de que existe sessão antes de chamar: sem
 * sessão o GoTrue responde "Auth session missing", que numa tela de "nova
 * senha" soa como link quebrado quando na verdade é ordem errada de chamadas.
 */
export async function definirNovaSenha(senha: string): Promise<void> {
  const supabase = clienteNavegador();
  const { error } = await supabase.auth.updateUser({ password: senha });
  if (error) throw traduzirErroDeSenha(error);
}
