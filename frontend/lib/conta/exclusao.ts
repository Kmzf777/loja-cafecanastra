/**
 * Excluir a própria conta — o lado do navegador do direito de eliminação
 * (LGPD art. 18, VI).
 *
 * A ROTA JÁ EXISTIA E NINGUÉM CONSEGUIA CHAMÁ-LA. `DELETE /auth/users/me`
 * (backend/src/routes/conta.routes.js) faz a coisa inteira — trava do último
 * administrador, cancelamento das assinaturas no Mercado Pago, redação do dado
 * pessoal em pedidos/assinaturas/avaliações, remoção da inscrição na
 * newsletter e só então o DELETE no GoTrue —, mas o único chamador era o
 * cabeçalho do painel legado, que nem é montado. Na prática a loja prometia o
 * direito na política de privacidade e mandava o cliente escrever um e-mail.
 * Este módulo é a ponte que faltava.
 *
 * A TRADUÇÃO É POR CÓDIGO, NUNCA POR TEXTO — mesma disciplina de
 * `traduzirErroDeLogin` (sessao.ts) e `traduzirErroDeAvaliacao`
 * (avaliacoes/avaliacoes.ts). Aqui o código é o STATUS HTTP: é ele que o
 * Express carimba por desfecho, e a frase do corpo é redação de servidor, que
 * muda sem aviso e sem quebrar contrato nenhum.
 *
 * O INVARIANTE QUE TODA FRASE DE ERRO CARREGA: "sua conta NÃO foi excluída".
 * Em TODOS os caminhos de falha da rota a conta continua viva — o backend
 * aborta antes do DELETE no GoTrue de propósito, e o troco assumido está
 * escrito por inteiro no bloco "A ORDEM DA EXCLUSÃO DE CONTA" de lá. É a única
 * informação que a pessoa precisa ter na tela: ela acabou de pedir para
 * desaparecer e tem que saber, sem ambiguidade, que isso não aconteceu.
 *
 * O QUE NENHUMA FRASE DAQUI PODE DIZER É "nada foi apagado". Não é verdade em
 * dois caminhos reais: se a newsletter falha (500), as assinaturas já foram
 * canceladas e os pedidos já foram redigidos; se o GoTrue recusa (502), os três
 * passos anteriores já rodaram. Prometer reversão total seria a mesma mentira
 * confortável que este módulo existe para tirar da loja — e é por isso que as
 * frases falam de "tentar de novo" (repetir é seguro: a redação é idempotente
 * por `redigido_em`, o cancelamento repetido devolve `[]` e o DELETE da
 * inscrição casa com zero linhas) em vez de falar de desfazer.
 */
// Relativo, e não "@/": o alias vive só no tsconfig/Next — o Vitest não o
// resolve, e este módulo é coberto por exclusao.test.ts.
import { API_BASE } from "../api-base";

/**
 * A palavra que destrava o botão.
 *
 * `window.confirm` não serve aqui: é um clique a mais no mesmo gesto do clique
 * anterior, na mesma posição da tela, e some com um Enter distraído. Digitar
 * uma palavra é o único passo que obriga a pessoa a LER antes de agir — e este
 * é o botão que apaga a conta dela.
 */
export const PALAVRA_DE_CONFIRMACAO = "EXCLUIR";

/**
 * Confere a palavra digitada. Ignora caixa e espaços em volta DE PROPÓSITO: o
 * atrito que protege é ter que digitar a palavra certa, não acertar o
 * Caps Lock — e um teclado de celular capitaliza sozinho. Errar a caixa
 * devolveria a pessoa a um botão morto sem dizer por quê.
 */
export function confirmacaoValida(texto: string): boolean {
  return texto.trim().toUpperCase() === PALAVRA_DE_CONFIRMACAO;
}

/**
 * Erro de exclusão com o STATUS junto, porque a tela pode querer agir por ele
 * (401 leva ao login, por exemplo) e casar texto para descobrir isso é a
 * fragilidade que este projeto já pagou caro.
 *
 * `status === 0` é reservado para "a requisição nem chegou" (rede fora,
 * servidor inalcançável) — o `fetch` rejeita sem resposta e sem status.
 */
export class ErroDeExclusao extends Error {
  readonly status: number;

  constructor(mensagem: string, status = 0) {
    super(mensagem);
    this.name = "ErroDeExclusao";
    this.status = status;
  }
}

/**
 * A TABELA DE TRADUÇÃO — o coração do módulo, e o que os testes fixam.
 *
 * Cada frase diz TRÊS coisas, nesta ordem: o que aconteceu, que a conta
 * continua ativa, e o que fazer agora. Frase que não diga o que fazer é frase
 * que empurra a pessoa de volta para o "canal de contato" — exatamente o que
 * esta funcionalidade veio substituir.
 *
 * SOBRE O 502 SER UM SÓ PARA DOIS DESFECHOS: a rota responde 502 tanto quando o
 * Mercado Pago recusa cancelar a assinatura (nada foi tocado) quanto quando o
 * GoTrue recusa o DELETE no fim (assinaturas já canceladas, pedidos já
 * redigidos). Uma frase serve às duas porque o que muda entre elas — o quanto
 * já rodou — não muda NADA do que a pessoa pode fazer, e o que não muda é
 * justamente o que importa: a conta está viva e repetir o pedido é seguro.
 * Inventar aqui a distinção que o servidor não faz seria adivinhar em cima de
 * texto de mensagem.
 *
 * SOBRE O 503 SER UM SÓ PARA DOIS DESFECHOS: vem do `isAuthenticated` (JWKS ou
 * banco fora do ar) e da própria rota (deploy sem `SUPABASE_SERVICE_ROLE_KEY`,
 * que falha alto em vez de fingir sucesso). Nos dois é falha desta casa, não da
 * pessoa, e nos dois a saída é a mesma.
 */
const MENSAGENS: Record<number, string> = {
  0:
    "Não consegui falar com o servidor, então sua conta NÃO foi excluída e " +
    "continua ativa. Confira sua conexão e tente de novo.",

  // Vem do cancelamento das assinaturas com id fora de formato — improvável
  // nesta rota (o id sai do banco), mas responder "erro genérico" a um pedido
  // que o servidor recusou por conteúdo mandaria a pessoa tentar para sempre.
  400:
    "Não consegui processar este pedido de exclusão. Sua conta continua " +
    "ativa. Se acontecer de novo, fale com a gente pelo canal do rodapé — a " +
    "exclusão será feita do mesmo jeito.",

  401:
    "Sua sessão expirou antes de a exclusão começar, e nada foi feito na sua " +
    "conta. Entre de novo e repita o pedido.",

  403:
    "Esta sessão não tem permissão para excluir a conta, e nada foi feito " +
    "nela. Saia, entre de novo e repita o pedido; se continuar, fale com a " +
    "gente pelo canal do rodapé.",

  // A trava do último administrador (409). A frase é do backend
  // (MENSAGEM_ULTIMO_ADMIN) porque é a mesma decisão de loja, não uma opinião
  // desta tela — mas está escrita aqui, não copiada de lá em runtime.
  409:
    "Você é a única pessoa que administra a loja, e a loja não pode ficar sem " +
    "administrador. Sua conta continua ativa: cadastre outro administrador no " +
    "painel e depois volte aqui.",

  // O teto de 5/hora do `exclusaoLimiter`. Quem chega aqui já tentou várias
  // vezes — provavelmente batendo num dos erros acima.
  429:
    "Você pediu a exclusão vezes demais em pouco tempo e o servidor barrou as " +
    "novas tentativas. Sua conta continua ativa; espere uma hora e tente de " +
    "novo.",

  500:
    "Não consegui concluir a exclusão por uma falha nossa. Sua conta NÃO foi " +
    "excluída e continua ativa. Tente de novo em alguns minutos — repetir o " +
    "pedido é seguro.",

  502:
    "Não consegui concluir a exclusão porque um serviço de que ela depende " +
    "recusou a operação — o mais comum é o Mercado Pago, que precisa cancelar " +
    "a assinatura do Clube antes. SUA CONTA NÃO FOI EXCLUÍDA e continua " +
    "ativa. Tente de novo em alguns minutos; repetir o pedido é seguro.",

  503:
    "A exclusão de contas está indisponível neste momento, por uma falha do " +
    "nosso lado. Sua conta continua ativa. Tente de novo mais tarde; se " +
    "continuar assim, fale com a gente pelo canal do rodapé — o pedido vale " +
    "do mesmo jeito.",
};

const MENSAGEM_PADRAO =
  "Não foi possível excluir sua conta agora. Ela continua ativa; tente de " +
  "novo em instantes.";

/**
 * Traduz o status HTTP na frase que a pessoa lê.
 *
 * `corpo` entra só para o console: status desconhecido significa que o backend
 * ganhou um desfecho que esta versão do front não conhece, e a frase do
 * servidor é a pista de quem for depurar. Ela NÃO vai para a tela — mensagem
 * de servidor é escrita para o log, não para o cliente da loja.
 */
export function traduzirErroDeExclusao(
  status: number,
  corpo?: { message?: unknown },
): ErroDeExclusao {
  const conhecida = MENSAGENS[status];
  if (conhecida) return new ErroDeExclusao(conhecida, status);

  if (typeof console !== "undefined") {
    const doServidor =
      typeof corpo?.message === "string" ? ` — ${corpo.message}` : "";
    console.warn(
      `[conta] Exclusão recusada com status não traduzido: ${status}${doServidor}`,
    );
  }
  return new ErroDeExclusao(MENSAGEM_PADRAO, status);
}

/**
 * Chama `DELETE /auth/users/me`.
 *
 * Resolve em silêncio quando deu certo (não há nada de útil no corpo de
 * sucesso: a conta acabou de deixar de existir) e lança `ErroDeExclusao`
 * traduzido em qualquer outro desfecho, INCLUSIVE quando o fetch nem chegou a
 * receber resposta. Nunca resolve em cima de falha — dizer "conta excluída"
 * para quem continua cadastrado é o pior desfecho possível desta tela.
 *
 * `Authorization: Bearer` porque a API Express verifica o token do GoTrue por
 * cabeçalho; `credentials: "include"` acompanha o resto da vitrine.
 */
export async function excluirMinhaConta(
  token: string,
  fetchFn: typeof fetch = fetch,
): Promise<void> {
  let resposta: Response;
  try {
    resposta = await fetchFn(`${API_BASE}/auth/users/me`, {
      method: "DELETE",
      credentials: "include",
      headers: { Authorization: `Bearer ${token}` },
    });
  } catch {
    // Rede fora, DNS, CORS: não houve resposta, então não houve exclusão.
    throw traduzirErroDeExclusao(0);
  }

  if (resposta.ok) return;

  // `sendStatus(401)`/`sendStatus(403)` respondem TEXTO, não JSON — por isso o
  // `catch`. O corpo só alimenta o aviso de console dos status desconhecidos.
  const corpo = await resposta.json().catch(() => ({}));
  throw traduzirErroDeExclusao(resposta.status, corpo as { message?: unknown });
}
