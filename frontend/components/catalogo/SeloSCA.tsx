import { classificacaoSca, formatarSca } from "@/lib/catalogo/rotulos";

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
 */

type Props = {
  sca: number;
  /** O `sca` acima e a nota da linha, ou o piso da embalagem? */
  scaExata: boolean;
  variante?: "claro" | "escuro" | "compacto";
  className?: string;
};

export function SeloSCA({
  sca,
  scaExata,
  variante = "claro",
  className = "",
}: Props) {
  const especial = classificacaoSca(sca) === "especial";
  const nota = formatarSca(sca, scaExata);
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
          {especial ? "Especial" : "Gourmet"}
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
          afirmacao falsa em outro idioma. */}
      {especial ? (
        <span className="block text-[10px] font-semibold uppercase leading-none tracking-[0.18em]">
          Specialty
        </span>
      ) : null}
      <span
        className={`block text-[15px] font-bold uppercase leading-none tracking-[0.12em] ${
          especial ? "mt-1" : ""
        }`}
      >
        {especial ? "Especial" : "Gourmet"}
      </span>
      <span className="mt-1.5 block font-dado text-[13px] leading-none tracking-[0.06em]">
        {nota}
      </span>
    </div>
  );
}
