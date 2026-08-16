import type { Lote } from "@/lib/catalogo/tipos";

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
 */

const DEFINICOES: Record<string, string> = {
  Altitude:
    "Altura da lavoura. Quanto mais alto, mais fria a noite e mais devagar o grão amadurece — o que costuma dar mais doçura e acidez.",
  Variedade: "A cultivar do pé de café, como Bourbon, Catuaí ou Mundo Novo.",
  Processo:
    "Como o grão foi seco. Natural seca com a casca da fruta, o que costuma dar mais doçura e corpo.",
  Safra: "O ano da colheita.",
  Produtor: "O sítio ou fazenda onde este lote foi colhido.",
  Município: "A cidade da lavoura, dentro da região da Serra da Canastra.",
  Pontuação:
    "Nota de 0 a 100 dada em prova cega segundo o protocolo da SCA. Acima de 80 o café é classificado como especial.",
};

export function FichaLavoura({ lote }: { lote: Lote }) {
  const linhas: [string, string][] = [
    ["Altitude", `${lote.lavoura.altitude.toLocaleString("pt-BR")} m`],
    ["Variedade", lote.lavoura.variedade],
    ["Processo", lote.lavoura.processo],
    ["Safra", String(lote.lavoura.safra)],
    ["Produtor", lote.lavoura.produtor],
    ["Município", lote.lavoura.municipio],
    ["Pontuação", lote.sca.toLocaleString("pt-BR", { minimumFractionDigits: 2 })],
  ];

  return (
    <details className="group border-t border-fuligem-20 pt-4">
      <summary className="flex cursor-pointer list-none items-center justify-between text-[13px] font-semibold uppercase tracking-[0.14em] focus-visible:outline-2 focus-visible:outline-offset-[3px] focus-visible:outline-vermelho">
        Ficha da lavoura
        <span aria-hidden className="font-dado text-[16px] leading-none">
          <span className="group-open:hidden">+</span>
          <span className="hidden group-open:inline">−</span>
        </span>
      </summary>

      <dl className="mt-4">
        {linhas.map(([rotulo, valor]) => (
          <div
            key={rotulo}
            className="flex items-baseline justify-between gap-4 border-b border-fuligem-20 py-2.5 last:border-b-0"
          >
            <dt className="text-[12px] font-semibold uppercase tracking-[0.14em] text-fuligem-55">
              <abbr
                title={DEFINICOES[rotulo]}
                className="cursor-help no-underline decoration-dotted underline-offset-4 hover:underline"
              >
                {rotulo}
              </abbr>
            </dt>
            <dd className="text-right font-dado text-[13px] tracking-[0.04em]">
              {valor}
            </dd>
          </div>
        ))}
      </dl>
    </details>
  );
}
