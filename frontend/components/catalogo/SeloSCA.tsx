import { classificacaoSca, formatarSca } from "@/lib/catalogo/rotulos";
import { dicionario } from "@/lib/i18n/dicionario";
import { LOCALE_PADRAO, type Locale } from "@/lib/i18n/tipos";

/**
 * estetica.md §5.1 — o componente-ancora. Reproducao literal da plaqueta da
 * embalagem; e o elemento que costura pacote e tela.
 *
 *   ┌───────────────────────┐      ┌───────────────────────┐
 *   │      SPECIALTY        │      │       GOURMET         │
 *   │       ESPECIAL        │      │       SCA 75          │
 *   │       SCA 80+         │      └───────────────────────┘
 *   └───────────────────────┘        linha de 75: nao e especial
 *        filete 1px · raio 0
 *
 * POR QUE A PLAQUETA TEM DUAS FORMAS, E NAO UMA SO
 * Ela escrevia "SPECIALTY · ESPECIAL · SCA 80+" em TODA linha, porque toda
 * linha lia o piso da colecao. O Nectar de Minas tem 75 pontos publicados pela
 * propria marca — abaixo do corte da SCA, ou seja, NAO e cafe especial; e
 * gourmet, e a embalagem dele diz isso. A plaqueta antiga afirmava tres coisas
 * falsas de uma vez nessa linha, e no unico lugar da tela em que a marca pede
 * para ser levada a serio.
 *
 * A saida nao foi esconder o selo naquela linha: um buraco na grade nao
 * explica nada e ainda esconde um numero real. A plaqueta passa a dizer o que
 * o cafe e — e o "+" so aparece onde o numero e piso de verdade (ver
 * `formatarSca`).
 *
 * E ELA FALA O IDIOMA DA PAGINA. "Especial" e "Gourmet" estavam cravados aqui,
 * nos tres idiomas, e este e o componente que aparece em TODO card e na PDP:
 * era a palavra em portugues mais repetida de /en/cafes. O texto veio para
 * `catalogo.selo` no dicionario; o desenho e as duas formas nao mudaram.
 */

type Props = {
  sca: number;
  /** O `sca` acima e a nota da linha, ou o piso da embalagem? */
  scaExata: boolean;
  variante?: "claro" | "escuro" | "compacto";
  /**
   * O idioma da pagina. Tem padrao pela mesma razao do <CardCafe> e do
   * <PontoTorra>: a plaqueta aparece dentro de cards que nem sempre nascem de
   * uma rota com `params` — o "not-found" da PDP e um deles.
   */
  locale?: Locale;
  className?: string;
};

export function SeloSCA({
  sca,
  scaExata,
  variante = "claro",
  locale = LOCALE_PADRAO,
  className = "",
}: Props) {
  const selo = dicionario(locale).catalogo.selo;
  const especial = classificacaoSca(sca) === "especial";
  const classificacao = especial ? selo.especial : selo.gourmet;
  const nota = formatarSca(sca, scaExata);
  const sobrancelha =
    especial && selo.sobrancelha !== classificacao ? selo.sobrancelha : null;
  const cor =
    variante === "escuro" ? "border-cal text-cal" : "border-fuligem text-fuligem";

  if (variante === "compacto") {
    /**
     * O chip do card, e ele ganhou a linha de classificacao.
     *
     * Antes trazia so o numero, o que funcionava enquanto todas as linhas
     * eram 80+. Com 86 e 75 na mesma grade, "SCA 75" sozinho ao lado de
     * "SCA 80+" e um numero sem regua. Dar a palavra aos dois mantem os cards
     * comparaveis — e o contrario (a palavra so na linha gourmet) leria como
     * distincao, que e o oposto do que ela significa.
     */
    return (
      <div
        className={`border border-fuligem bg-cal-puro px-2 py-1 text-center ${className}`}
      >
        <span className="block text-[9px] font-semibold uppercase leading-none tracking-[0.14em] text-fuligem-55">
          {classificacao}
        </span>
        <span className="mt-1 block font-dado text-[11px] leading-none tracking-[0.06em]">
          {nota}
        </span>
      </div>
    );
  }

  return (
    <div className={`border ${cor} px-4 py-3 text-center ${className}`}>
      {/* A sobrancelha em ingles e a das caixas de Drip Coffee, e so faz
          sentido sobre "ESPECIAL": numa linha gourmet ela seria a mesma
          afirmacao falsa em outro idioma.

          E ELA SOME QUANDO REPETIRIA A LINHA DE BAIXO. Na embalagem brasileira
          as duas palavras convivem porque uma e a traducao da outra impressa
          junto; numa pagina em ingles a classificacao TAMBEM e "Specialty", e a
          plaqueta escreveria a mesma palavra duas vezes. A comparacao e entre os
          dois textos do dicionario, e nao uma lista de idiomas, porque quem
          decide isso e a lingua — se um dia o espanhol adotar a palavra, a
          plaqueta se ajusta sozinha. A forma de duas linhas ja existe: e a do
          gourmet, e e por isso que a margem acompanha `sobrancelha`. */}
      {sobrancelha ? (
        <span className="block text-[10px] font-semibold uppercase leading-none tracking-[0.18em]">
          {sobrancelha}
        </span>
      ) : null}
      <span
        className={`block text-[15px] font-bold uppercase leading-none tracking-[0.12em] ${
          sobrancelha ? "mt-1" : ""
        }`}
      >
        {classificacao}
      </span>
      <span className="mt-1.5 block font-dado text-[13px] leading-none tracking-[0.06em]">
        {nota}
      </span>
    </div>
  );
}
