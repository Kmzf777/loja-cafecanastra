import type { Lote } from "@/lib/catalogo/tipos";
import { formatarSca } from "@/lib/catalogo/rotulos";

/**
 * estetica.md §5.4 — <details> RECOLHIDO por padrao.
 *
 * E a peca que atende os dois publicos numa pagina so: o iniciante nunca e
 * intimidado pela ficha tecnica, o especialista nunca e subestimado. A ordem e
 * inegociavel (§7.3): nota de sabor ACIMA de qualquer dado tecnico.
 *
 * Cada rotulo carrega uma definicao em uma frase, via <abbr title>. O §5.4 pede
 * um `?` com tooltip; `abbr` entrega isso com semantica nativa, sem JS e sem
 * quebrar no teclado ou no leitor de tela.
 *
 * O QUE MUDOU E POR QUE
 * A ficha antiga listava Altitude, Safra, Produtor e Municipio POR LOTE, com
 * valores inventados ("Sitio Boa Vista", "1.320 m", "Safra 2025"). O Cafe
 * Canastra vende linhas de blend com origem unica na Serra da Canastra, nao
 * micro-lotes rastreados por sitio — nao existe produtor por linha para
 * declarar. Os campos sairam em vez de continuarem preenchidos com ficcao;
 * ficaram os que a marca de fato afirma.
 */

const DEFINICOES: Record<string, string> = {
  Origem: "A região onde o café foi cultivado, colhido e beneficiado.",
  Torra:
    "Quanto tempo e a que temperatura o grão foi torrado. Torras mais escuras trazem mais corpo e amargor; mais claras preservam acidez e fruta.",
  Corpo: "O peso do café na boca — de aquoso e leve a denso e encorpado.",
  // O exemplo saiu: com as cultivares reais logo abaixo, citar Bourbon e Mundo
  // Novo aqui punha na mesma ficha três nomes que esta lavoura não planta.
  Variedades:
    "As cultivares do pé de café — a espécie botânica de onde o grão vem, e o que mais explica tamanho, densidade e aroma.",
  Pontuação:
    "Nota de 0 a 100 dada em prova cega segundo o protocolo da SCA. De 80 para cima o café é classificado como especial; abaixo disso é gourmet. Onde o site mostra 80+, o número é o piso que a embalagem declara para a coleção, não a nota daquele café; onde mostra um número sem o +, é a nota que a marca publica para aquela linha.",
  Preparo: "Os métodos em que esta linha costuma render melhor.",
};

export function FichaLavoura({ lote }: { lote: Lote }) {
  const linhas: [string, string][] = [
    ["Origem", `${lote.origem.regiao} — ${lote.origem.estado}`],
    ["Torra", lote.torra],
    ["Corpo", lote.corpo],
    ["Variedades", lote.origem.variedades.join(", ")],
    ["Pontuação", formatarSca(lote.sca, lote.scaExata)],
    ["Preparo", lote.preparoSugerido],
  ];

  return (
    <details className="group border-t border-fuligem-20 pt-4">
      <summary className="flex cursor-pointer list-none items-center justify-between text-[13px] font-semibold uppercase tracking-[0.14em] focus-visible:outline-2 focus-visible:outline-offset-[3px] focus-visible:outline-vermelho">
        Ficha do café
        <span aria-hidden className="font-dado text-[16px] leading-none">
          <span className="group-open:hidden">+</span>
          <span className="hidden group-open:inline">−</span>
        </span>
      </summary>

      <dl className="mt-4">
        {linhas.map(([rotulo, valor]) => (
          // §10: em mobile a ficha vira uma coluna, com o rotulo ACIMA do
          // valor. Lado a lado em 390px, "Variedades" e a lista das quatro
          // cultivares disputam a mesma linha e o valor quebra feio.
          <div
            key={rotulo}
            className="flex flex-col gap-0.5 border-b border-fuligem-20 py-2.5 last:border-b-0 sm:flex-row sm:items-baseline sm:justify-between sm:gap-4"
          >
            <dt className="text-[12px] font-semibold uppercase tracking-[0.14em] text-fuligem-55">
              <abbr
                title={DEFINICOES[rotulo]}
                className="cursor-help no-underline decoration-dotted underline-offset-4 hover:underline"
              >
                {rotulo}
              </abbr>
            </dt>
            <dd className="font-dado text-[13px] tracking-[0.04em] sm:text-right">
              {valor}
            </dd>
          </div>
        ))}
      </dl>

      {/* Selos que valem para toda a coleção, não por lote. */}
      <ul className="mt-4 flex flex-wrap gap-2">
        {lote.origem.atributos.map((atributo) => (
          <li
            key={atributo}
            className="border border-fuligem-20 px-2.5 py-1 text-[11px] uppercase tracking-[0.1em] text-fuligem-55"
          >
            {atributo}
          </li>
        ))}
      </ul>
    </details>
  );
}
