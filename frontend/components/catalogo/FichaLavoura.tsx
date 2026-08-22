import type { Lote } from "@/lib/catalogo/tipos";
import { formatarSca, rotuloDoAtributo } from "@/lib/catalogo/rotulos";
import { dicionario } from "@/lib/i18n/dicionario";
import { LOCALE_PADRAO, type Locale } from "@/lib/i18n/tipos";

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
 *
 * "VARIEDADES" SAIU PELO MESMO MOTIVO, uma onda depois. Araras, Caturra 2SL e
 * Paraiso sao as cultivares que A CASA planta — dado da marca, nao de cada
 * pacote. A ficha as repetia em todas as cinco linhas, inclusive no Microlote
 * (que e um lote separado por definicao) e no Nectar de Minas (marca irma, com
 * pontuacao e pacote proprios). A afirmacao vive em /a-serra, que le
 * `MARCA.variedades` e diz o que ela e: "As variedades da Canastra".
 *
 * O TEXTO DOS ROTULOS E DAS DEFINICOES VEM DO DICIONARIO (`catalogo.ficha`).
 * Estava cravado aqui, em portugues, e aparecia igual em /en e /es — numa
 * ficha cuja razao de existir e explicar o vocabulario a quem nao o tem.
 *
 * E OS SELOS DO PE DA FICHA VIERAM JUNTO, uma onda depois. O rotulo e a
 * definicao ja se traduziam e a fileira de chips logo abaixo deles continuava
 * dizendo "100% arabica · Carbono zero · Sem gluten" em ingles — o dado ao lado
 * da interface traduzida, que e o padrao deste conserto inteiro. Hoje
 * `lote.origem.atributos` guarda CHAVE (`carbono-zero`), o texto esta em
 * `catalogo.atributo` e quem o busca e `rotuloDoAtributo()`.
 */

export function FichaLavoura({
  lote,
  locale = LOCALE_PADRAO,
}: {
  lote: Lote;
  /** O idioma da PDP. Tem padrao pelo mesmo motivo do <CardCafe>. */
  locale?: Locale;
}) {
  const ficha = dicionario(locale).catalogo.ficha;

  // A CHAVE E O VALOR, O TEXTO VEM DO DICIONARIO. Antes o rotulo em portugues
  // era a chave desta lista E a chave de DEFINICOES, o que travava a ficha
  // inteira em portugues: traduzir "Origem" quebrava a busca da definicao.
  const linhas: [keyof typeof ficha.rotulo, string][] = [
    ["origem", `${lote.origem.regiao} — ${lote.origem.estado}`],
    ["torra", lote.torra],
    ["corpo", lote.corpo],
    ["pontuacao", formatarSca(lote.sca, lote.scaExata)],
    ["preparo", lote.preparoSugerido],
  ];

  return (
    <details className="group border-t border-fuligem-20 pt-4">
      {/* `min-h-11` (44px): media 19,5px de altura — 24,5px abaixo do piso do
          estetica.md §10 —, e e o unico controle que abre origem, torra, corpo,
          pontuacao SCA e preparo. Num telefone o dedo nao acerta uma linha de
          texto de 19px de forma confiavel, e o que esta atras dela e o
          argumento de venda do cafe especial. O <summary> do Cabecalho ja usa
          `h-11 min-w-11` pela mesma razao. */}
      <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between text-[13px] font-semibold uppercase tracking-[0.14em] focus-visible:outline-2 focus-visible:outline-offset-[3px] focus-visible:outline-vermelho">
        {ficha.titulo}
        <span aria-hidden className="font-dado text-[16px] leading-none">
          <span className="group-open:hidden">+</span>
          <span className="hidden group-open:inline">−</span>
        </span>
      </summary>

      <dl className="mt-4">
        {linhas.map(([chave, valor]) => (
          // §10: em mobile a ficha vira uma coluna, com o rotulo ACIMA do
          // valor. Lado a lado em 360px, "Preparo" e a lista de metodos
          // ("Coador, prensa francesa e aeropress") disputam a mesma linha e o
          // valor quebra feio.
          <div
            key={chave}
            className="flex flex-col gap-0.5 border-b border-fuligem-20 py-2.5 last:border-b-0 sm:flex-row sm:items-baseline sm:justify-between sm:gap-4"
          >
            <dt className="text-[12px] font-semibold uppercase tracking-[0.14em] text-fuligem-55">
              <abbr
                title={ficha.definicao[chave]}
                className="cursor-help no-underline decoration-dotted underline-offset-4 hover:underline"
              >
                {ficha.rotulo[chave]}
              </abbr>
            </dt>
            <dd className="font-dado text-[13px] tracking-[0.04em] sm:text-right">
              {valor}
            </dd>
          </div>
        ))}
      </dl>

      {/* Selos que valem para toda a coleção, não por lote. A `key` é a CHAVE
          e não o texto: o texto muda de idioma, a identidade do chip não. */}
      <ul className="mt-4 flex flex-wrap gap-2">
        {lote.origem.atributos.map((atributo) => (
          <li
            key={atributo}
            className="border border-fuligem-20 px-2.5 py-1 text-[11px] uppercase tracking-[0.1em] text-fuligem-55"
          >
            {rotuloDoAtributo(atributo, locale)}
          </li>
        ))}
      </ul>
    </details>
  );
}
