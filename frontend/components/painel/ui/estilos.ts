/**
 * As duas classes que TODO primitivo do painel repete — num lugar só.
 *
 * Não é preciosismo: o repositório acabou de pagar essa conta. O helper `html`
 * dos testes estava copiado à mão em 20 arquivos (spec §2.8), e o custo não era
 * o tamanho, era não haver um nome que ligasse as cópias no dia da mudança. Um
 * anel de foco divergente entre <Botao> e <Campo> é o mesmo defeito, e mais
 * difícil de ver: ninguém compara anel de foco entre telas.
 */

/**
 * O anel de foco do painel — e por que ele NÃO é vermelho.
 *
 * Na vitrine o foco é `outline-vermelho` (components/ui/Botao.tsx). Aqui não
 * pode ser: R21 reserva o vermelho a erro e ação destrutiva, e um anel vermelho
 * em todo campo focado ensina o gestor a ver vermelho como "estou aqui" em vez
 * de "está errado" — que é exatamente como se deixa de acreditar nos erros de
 * verdade. Fuligem sobre cal dá 16,4:1 (estetica.md §4.1) e, com o afastamento
 * de 2px, continua visível por cima do botão primário, que é fuligem sólido:
 * a faixa de cal entre botão e anel é o que desenha o anel.
 *
 * `focus-visible`, não `focus`: quem clica com o mouse não quer ver anel; quem
 * chega de Tab precisa.
 */
export const FOCO =
  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-fuligem";

/** A mesma coisa, para quem não tem 2px de folga em volta (célula de tabela,
 *  campo colado no filete): o anel entra para dentro em vez de transbordar. */
export const FOCO_INTERNO =
  "focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-fuligem";

/**
 * A voz da etiqueta — estetica.md §4.2, `--t-label`.
 *
 * Grotesca condensada, caixa alta, entreletra aberta: é literalmente a
 * tipografia do selo "SPECIALTY ESPECIAL SCA 80+" da embalagem, e é o que faz
 * um rótulo do painel parecer impresso e não digitado. Reservada a RÓTULO —
 * nunca a frase, nunca a dado (dado é `--font-dado`, via `data-dado`).
 *
 * SEM TAMANHO DE PROPÓSITO. Quem usa escolhe o passo da escala: 11px no selo e
 * no cabeçalho de tabela, 12px no título de ficha. Se o tamanho morasse aqui,
 * quem precisasse de outro escreveria `${ETIQUETA} text-xs` — e as duas classes
 * de `font-size` não são desempatadas pela ordem no atributo `class`, e sim
 * pela ordem em que o Tailwind as emitiu na folha. É a armadilha clássica: o
 * override funciona num tamanho e falha em outro, sem erro nenhum.
 */
export const ETIQUETA = "font-semibold uppercase tracking-[0.12em]";
