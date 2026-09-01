type CorpoDeErro = { message?: string; error?: string };

/**
 * Ler o corpo de uma resposta que PODE NÃO TER CORPO.
 *
 * `isAuthenticated.js` responde 401 e 403 por `sendStatus`, ou seja, com corpo
 * VAZIO e sem `Content-Type: application/json`. Um `await res.json()` sem
 * proteção quebra com SyntaxError exatamente no caminho de sessão expirada —
 * que é o menos testado e o mais visitado numa quinta à noite. O painel legado
 * escreve `.json().catch(() => ({}))` em toda chamada; aqui isso vira um lugar
 * só, para nenhuma tela nova esquecer.
 */
export async function lerCorpo(res: Response): Promise<CorpoDeErro> {
  try {
    const corpo = await res.json();
    return corpo && typeof corpo === "object" ? (corpo as CorpoDeErro) : {};
  } catch {
    return {};
  }
}

/**
 * A frase que o gestor lê quando algo falha.
 *
 * REGRA: a frase do SERVIDOR ganha sempre. "Já existe um produto com este SKU.",
 * "SKU tal não está cadastrado no Bling", "nota gerada mas não transmitida" —
 * essas frases SÃO o diagnóstico, e trocá-las por "Erro ao salvar" transforma
 * um problema de dois minutos num chamado. Portado de
 * `lib/painel/bling/contrato.ts` (que era `legacy/.../Bling/blingContrato.js`
 * quando a regra nasceu, e mudou de casa por `git mv` na Onda 1).
 *
 * O 403 tem texto próprio e deliberadamente SEM a palavra "sessão": o backend
 * responde 403 para token válido de quem não está vinculado à loja, e sugerir
 * "entre de novo" manda a pessoa para um login que vai funcionar e não vai
 * resolver nada.
 */
export function fraseDeErro(status: number, corpo: CorpoDeErro): string {
  if (corpo.message) return corpo.message;
  if (corpo.error) return corpo.error;

  if (status === 401) return "Sua sessão expirou. Entre de novo para continuar.";
  if (status === 403) return "Sua conta não tem permissão para isto.";
  if (status === 404) return "Não encontramos o que você pediu.";
  if (status === 409) return "Isso conflita com algo que já existe.";
  if (status === 413) return "O arquivo é grande demais.";
  if (status >= 500) return "O servidor falhou. Tente de novo em instantes.";
  return `Não deu certo (código ${status}).`;
}
