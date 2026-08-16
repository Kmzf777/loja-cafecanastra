/**
 * estetica.md §5.1 — o componente-ancora. Reproducao literal da plaqueta da
 * embalagem; e o elemento que costura pacote e tela.
 *
 *   ┌───────────────────────┐
 *   │      SPECIALTY        │  Archivo Cond 600 · CAPS · 10px · tracking .18em
 *   │       ESPECIAL        │  Archivo Cond 700 · CAPS · 15px
 *   │       SCA 80+         │  Martian Mono 500 · 13px
 *   └───────────────────────┘
 *        filete 1px · raio 0
 */

type Props = {
  sca: number;
  variante?: "claro" | "escuro" | "compacto";
  className?: string;
};

/**
 * 80 -> "80+".
 *
 * A embalagem declara um PISO ("SCA 80+"), nao uma nota. O catalogo anterior
 * exibia 84,25 e 85,50 — decimais que nenhuma prova de xicara desta casa
 * produziu. Enquanto a pontuacao por lote nao vier do laudo, o site diz
 * exatamente o que a lata diz.
 */
function nota(sca: number) {
  return `${Math.floor(sca)}+`;
}

export function SeloSCA({ sca, variante = "claro", className = "" }: Props) {
  const cor =
    variante === "escuro" ? "border-cal text-cal" : "border-fuligem text-fuligem";

  if (variante === "compacto") {
    return (
      <div
        className={`border border-fuligem bg-cal-puro px-2 py-1 text-center ${className}`}
      >
        <span className="block font-dado text-[11px] leading-none tracking-[0.06em]">
          SCA {nota(sca)}
        </span>
      </div>
    );
  }

  return (
    <div className={`border ${cor} px-4 py-3 text-center ${className}`}>
      <span className="block text-[10px] font-semibold uppercase leading-none tracking-[0.18em]">
        Specialty
      </span>
      <span className="mt-1 block text-[15px] font-bold uppercase leading-none tracking-[0.12em]">
        Especial
      </span>
      <span className="mt-1.5 block font-dado text-[13px] leading-none tracking-[0.06em]">
        SCA {nota(sca)}
      </span>
    </div>
  );
}
