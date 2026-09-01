import {
  decidirGravacao,
  lerChegada,
  type Atribuicao,
  type Canal,
} from "./atribuicao";

/**
 * A ORIGEM DA VISITA GUARDADA JUNTO DA SACOLA — o lado que toca o navegador.
 *
 * A decisão inteira mora em `atribuicao.ts`, em funções puras. Aqui há só a
 * travessia: ler o `localStorage`, validar o que voltou e gravar. É a mesma
 * divisão de `lib/analytics.ts`, e pelo mesmo motivo — o que decide tem teste
 * exaustivo, o que fia não tem o que testar.
 *
 * `localStorage` E NÃO `sessionStorage`, de propósito: a sacola vive em
 * `localStorage` e um pedido pode ser fechado dias depois de a pessoa ter
 * clicado no anúncio. Guardar a origem numa vida mais curta que a da sacola
 * atribuiria a `direto` justamente a venda que demorou a maturar. Quem limita o
 * alcance é a janela de 30 dias, que é uma decisão de atribuição, não um
 * acidente de armazenamento.
 *
 * TUDO ENGOLE FALHA. Modo privado com cota zerada, `localStorage` desligado por
 * política: atribuição é enfeite em cima de um pagamento, e enfeite não derruba
 * a casa (0033 diz isso do lado do banco; vale igual aqui).
 */

/** A chave. Prefixada como a da sacola e a do consentimento. */
export const CHAVE_DA_ATRIBUICAO = "canastra:origem";

const CANAIS: Canal[] = ["pago", "organico", "indicacao", "direto"];

type JanelaComArmazenamento = { localStorage?: Storage };

function armazenamento(): Storage | undefined {
  if (typeof window === "undefined") return undefined;
  try {
    return (window as unknown as JanelaComArmazenamento).localStorage;
  } catch {
    return undefined;
  }
}

/**
 * O que está gravado, ou `null`.
 *
 * VALIDA O QUE VOLTA, e não por paranoia: o `localStorage` é editável por
 * qualquer extensão e sobrevive a mudanças de formato. Um objeto meio quebrado
 * daqui viraria um corpo de checkout meio quebrado, e o checkout é o último
 * lugar onde se quer descobrir isso. Sem `canal` válido ou sem `capturadaEm`
 * numérico, o registro é tratado como inexistente — e a próxima chegada grava
 * por cima.
 */
export function lerAtribuicao(
  loja: Storage | undefined = armazenamento(),
): Atribuicao | null {
  try {
    const bruto = loja?.getItem(CHAVE_DA_ATRIBUICAO);
    if (!bruto) return null;
    const a = JSON.parse(bruto) as Partial<Atribuicao>;
    if (!a || typeof a !== "object") return null;
    if (!CANAIS.includes(a.canal as Canal)) return null;
    if (typeof a.capturadaEm !== "number" || !Number.isFinite(a.capturadaEm)) {
      return null;
    }
    return a as Atribuicao;
  } catch {
    return null;
  }
}

export function gravarAtribuicao(
  a: Atribuicao,
  loja: Storage | undefined = armazenamento(),
): void {
  try {
    loja?.setItem(CHAVE_DA_ATRIBUICAO, JSON.stringify(a));
  } catch {
    // Sem armazenamento a origem vale só para esta página. Melhor que travar a
    // loja por causa de um campo de relatório.
  }
}

/**
 * Lê a chegada, decide, grava se for o caso, e devolve o que passa a valer.
 *
 * É a função que o `<CapturaDeOrigem>` chama uma vez por montagem. Devolve
 * sempre a atribuição VIGENTE (a nova quando gravou, a guardada quando não),
 * para quem chamar não precisar reler.
 *
 * NUNCA REGISTRA EM LOG. `gclid` e `fbclid` são identificadores de clique e a
 * 0033 os põe na redação de exclusão; um `console.log` de depuração aqui os
 * despejaria no console de todo visitante e em qualquer coletor de erro que a
 * loja venha a ter.
 */
export function capturarOrigem({
  url,
  referrer,
  agoraMs,
  loja = armazenamento(),
}: {
  url: string;
  referrer?: string | null;
  agoraMs: number;
  loja?: Storage;
}): Atribuicao | null {
  const guardada = lerAtribuicao(loja);
  const chegada = lerChegada({ url, referrer, agoraMs });
  if (!chegada) return guardada;

  const aGravar = decidirGravacao(guardada, chegada, agoraMs);
  if (!aGravar) return guardada;

  gravarAtribuicao(aGravar, loja);
  return aGravar;
}
