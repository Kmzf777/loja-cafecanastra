import { formatarPreco, precoParaLeitor } from "@/lib/catalogo/repositorio";
import { descontoPercentual, type PrecoExibido } from "@/lib/catalogo/promocao";
import { dicionario } from "@/lib/i18n/dicionario";
import { LOCALE_PADRAO, type Locale } from "@/lib/i18n/tipos";

/**
 * O PREÇO DA VITRINE, COM E SEM PROMOÇÃO — um só desenho para as cinco telas.
 *
 * Antes da Onda 6 cada superfície imprimia `formatarPreco()` à mão com o seu
 * próprio tamanho e o seu próprio `aria-label`: dois vocabulários de card, a
 * PDP, a sacola. Nenhuma delas mostrava promoção, e acrescentar o "de/por" em
 * cinco lugares seria criar cinco versões da mesma regra — a quinta divergindo
 * das outras quatro é questão de tempo, e aqui a divergência é sobre dinheiro.
 *
 * ---------------------------------------------------------------------------
 * O DESENHO, E POR QUE ELE É ESTE
 * ---------------------------------------------------------------------------
 *
 * O conceito é "etiqueta" (estetica.md §3): filete, raio zero, monoespaçada em
 * todo número, cor escassa. Então:
 *
 *  - O preço antigo RISCADO, um degrau menor e desbotado. A cor é a TINTA DA
 *    SUPERFÍCIE a 60% (`text-current opacity-60`), e não o token `fuligem-55`,
 *    porque a aba "Compra única" da PDP fica `bg-fuligem text-cal` quando
 *    selecionada: um cinza fixo desapareceria dentro dela. Sobre a Cal de
 *    sempre o resultado é indistinguível de `fuligem-55`; sobre a aba
 *    invertida ele acompanha. Ele recua; não disputa com o número que a
 *    pessoa vai pagar.
 *  - O preço novo na tinta de sempre (`fuligem`), no tamanho que aquela tela
 *    já usava. NÃO em vermelho: o vermelho da casa é CTA e estado ativo (§4.1),
 *    e um preço vermelho ao lado de um botão vermelho apaga os dois.
 *  - O desconto num SELO sólido `vermelho`/`cal` — 5,8:1, o mesmo par dos
 *    botões (§4.1). É o único ponto de cor novo na página, e ele é pequeno de
 *    propósito: marca a promoção sem competir com a chamada para a ação. Raio
 *    zero porque o selo da embalagem é um retângulo reto.
 *
 * Tudo em `font-dado` (Martian Mono), inclusive o "−10%": a fonte de dados é
 * "só números e códigos" (§4.2), e o percentual é número.
 *
 * ---------------------------------------------------------------------------
 * A ACESSIBILIDADE, QUE É O MOTIVO DE O COMPONENTE SER MAIOR DO QUE PARECE
 * ---------------------------------------------------------------------------
 *
 * `<s>` não é anunciado de forma confiável por leitor de tela nenhum, e sem
 * ele "R$ 60,00 R$ 54,00" é lido como dois preços soltos — ou pior, como um.
 * Por isso os três elementos visíveis são `aria-hidden` e a frase inteira vai
 * num `sr-only`: "de 60 reais, por 54 reais, 10% de desconto". É a mesma
 * técnica que `<CardProduto>` já usava para o anúncio de "adicionado".
 */

/** Os três tamanhos que a vitrine de fato usa — nada além do que tem chamador. */
type Tamanho = "compacto" | "padrao" | "destaque";

const ESCALA: Record<Tamanho, { por: string; de: string; selo: string }> = {
  // Card de linha (`<CardCafe>`) e a linha de item da sacola.
  compacto: { por: "text-[17px]", de: "text-[12px]", selo: "text-[10px]" },
  // Card de SKU (`<CardProduto>`).
  padrao: { por: "text-[18px]", de: "text-[13px]", selo: "text-[11px]" },
  // A PDP, onde o preço é a informação principal da coluna de compra.
  destaque: { por: "text-[26px]", de: "text-[15px]", selo: "text-[12px]" },
};

export function Preco({
  preco,
  tamanho = "padrao",
  locale = LOCALE_PADRAO,
  className = "",
}: {
  /**
   * O par que `precoExibido()` decidiu. Recebe o PAR PRONTO, e não o item, de
   * propósito: a decisão de exibir promoção é da função pura, que tem teste
   * exaustivo, e um componente que a refizesse seria a segunda cópia da regra.
   */
  preco: PrecoExibido;
  tamanho?: Tamanho;
  locale?: Locale;
  className?: string;
}) {
  const d = dicionario(locale);
  const escala = ESCALA[tamanho];

  /**
   * Sem promoção o componente desenha exatamente o que as telas desenhavam
   * antes dele — um número e um `aria-label`. É o caminho de todo dia: só há
   * "de/por" enquanto uma campanha está no ar.
   */
  if (preco.de === null) {
    return (
      <span
        className={`font-dado tracking-[0.02em] ${escala.por} ${className}`}
        aria-label={precoParaLeitor(preco.por)}
      >
        {formatarPreco(preco.por)}
      </span>
    );
  }

  const desconto = descontoPercentual(preco.de, preco.por);

  /**
   * O selo só aparece a partir de 1%. Abaixo disso `descontoPercentual`
   * devolve 0, e um "−0%" ocuparia o lugar de informação com ruído — o
   * riscado já conta a história inteira.
   */
  const frase = [
    `${d.comum.precoDe} ${precoParaLeitor(preco.de)}`,
    `${d.comum.precoPor} ${precoParaLeitor(preco.por)}`,
    ...(desconto > 0 ? [`${desconto}% ${d.comum.desconto}`] : []),
  ].join(", ");

  return (
    <span className={`inline-flex flex-wrap items-baseline gap-x-2 gap-y-1 ${className}`}>
      <span className="sr-only">{frase}</span>

      <s
        aria-hidden
        className={`font-dado tracking-[0.02em] opacity-60 ${escala.de}`}
      >
        {formatarPreco(preco.de)}
      </s>

      <span aria-hidden className={`font-dado tracking-[0.02em] ${escala.por}`}>
        {formatarPreco(preco.por)}
      </span>

      {desconto > 0 ? (
        <span
          aria-hidden
          className={`bg-vermelho px-1.5 py-0.5 font-dado leading-none text-cal ${escala.selo}`}
        >
          −{desconto}%
        </span>
      ) : null}
    </span>
  );
}
