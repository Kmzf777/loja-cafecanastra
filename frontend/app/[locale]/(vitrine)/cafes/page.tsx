import type { Metadata } from "next";
import Link from "next/link";
import { listarKits, listarLotes } from "@/lib/catalogo/repositorio";
import { traduzirLote } from "@/lib/catalogo/produtos";
import { filtrarPorTexto } from "@/lib/busca";
import { CardKit } from "@/components/catalogo/CardKit";
import { FORMATOS, LINHAS, ORDENACOES } from "@/lib/catalogo/tipos";
import type {
  Filtros,
  Formato,
  Linha,
  Ordenacao,
  PesoGramas,
} from "@/lib/catalogo/tipos";
import { rotuloPontoTorra } from "@/lib/catalogo/rotulos";
import { CardCafe } from "@/components/catalogo/CardCafe";
import { BotaoLink } from "@/components/ui/Botao";
import { alternativasDeIdioma, href, openGraphDaPagina } from "@/lib/i18n/rotas";
import { LOCALES, comoLocale, type Locale } from "@/lib/i18n/tipos";
import { dicionario } from "@/lib/i18n/dicionario";
import {
  faixaDeTorraDoCatalogo,
  linhasDoCatalogo,
  notasDoCatalogo,
  textosDaPlp,
} from "./conteudo";

/**
 * PLP — estetica.md §7.2.
 *
 * Os filtros vivem na URL (`?linha=suave&torraMin=3`), nao em estado de
 * memoria. Sao tres exigencias do documento de uma vez: o filtro fica
 * compartilhavel, o botao voltar funciona, e a pagina continua operavel com JS
 * desabilitado (§12) — por isso o formulario e um <form method="get"> com
 * submit nativo, e nao um punhado de onChange.
 *
 * O TEXTO DA PAGINA VEM TODO DE FORA, e ate a Onda 2 quase nada vinha: tres
 * rotulos liam o dicionario e o resto — titulo, filtros, botao, chips e a tela
 * vazia inteira — estava cravado em portugues no meio do JSX, e aparecia em
 * portugues em /en/cafes. O vocabulario de catalogo (linha, torra, formato,
 * ordenacao) sai de `lib/i18n/dicionario.ts`, que e onde ele se repete com a
 * PDP e os cards; os rotulos que so existem aqui saem de `./conteudo.ts`, pelo
 * mesmo corte que as paginas institucionais ja seguem.
 */

/**
 * OS TRES IDIOMAS DESTA ROTA — e o que esta declaracao consegue e o que nao.
 *
 * A PLP perdeu a geracao estatica ao entrar no `[locale]`: sem
 * `generateStaticParams`, o build nao sabia que `/cafes`, `/en/cafes` e
 * `/es/cafes` existem, e so as 15 PDPs sobraram no prerender-manifest.
 *
 * O QUE ELA NAO RESOLVE SOZINHA, e nao adianta fingir: esta pagina LE
 * `searchParams` — os filtros vivem na URL, e e essa decisao que faz o botao
 * voltar funcionar e o filtro ser compartilhavel. Ler `searchParams` derruba a
 * renderizacao estatica no Next 15 sem PPR: no build, o `await` interrompe o
 * prerender e a rota passa a renderizar sob demanda. O caminho para
 * prerenderizar a versao sem filtro seria uma fronteira <Suspense> com PPR
 * ligado, e ligar PPR e decisao de projeto, nao de pagina.
 *
 * Fica declarada mesmo assim porque ela e a lista de enderecos que esta rota
 * serve — o mesmo papel que ela cumpre na PDP ao lado — e porque no dia em que
 * o PPR entrar, a casca dos tres idiomas ja sai do build sem mais nada a
 * mudar. `dynamicParams` NAO e desligado aqui: quem valida o segmento e o
 * `notFound()` do layout da vitrine, e desligar aqui mudaria o 404 de lugar.
 */
export function generateStaticParams() {
  return LOCALES.map((locale) => ({ locale }));
}

/**
 * `generateMetadata` e não um `metadata` constante porque o canônico precisa
 * ser a PRÓPRIA página, no próprio idioma — ver a nota em lib/i18n/rotas.ts.
 *
 * E porque `title` e `description` também se traduzem: os três idiomas
 * anunciavam ao buscador o mesmo texto em português, ou seja, a página inteira
 * traduzida e o cartão de resultado em outra língua — o mesmo defeito que a
 * PDP ao lado já tinha corrigido.
 */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const locale = comoLocale((await params).locale);
  const t = textosDaPlp(locale);

  return {
    title: t.metaTitulo,
    description: t.metaDescricao,
    alternates: alternativasDeIdioma("/cafes", locale),
    openGraph: openGraphDaPagina({
      locale,
      caminho: "/cafes",
      titulo: t.metaTitulo,
      descricao: t.metaDescricao,
    }),
  };
}

type Busca = Record<string, string | string[] | undefined>;

function texto(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v;
}

function numero(v: string | string[] | undefined): number | undefined {
  const t = texto(v);
  if (!t) return undefined;
  const n = Number(t);
  return Number.isFinite(n) ? n : undefined;
}

function lerFiltros(sp: Busca): { filtros: Filtros; ordenacao: Ordenacao } {
  const linha = texto(sp.linha) as Linha | undefined;
  const formato = texto(sp.formato) as Formato | undefined;
  const peso = numero(sp.peso) as PesoGramas | undefined;
  const ordem = texto(sp.ordem) as Ordenacao | undefined;

  return {
    filtros: {
      linha: linha && LINHAS.includes(linha) ? linha : undefined,
      formato: formato && FORMATOS.includes(formato) ? formato : undefined,
      pesoGramas: peso === 250 || peso === 500 || peso === 1000 ? peso : undefined,
      pontoTorraMin: numero(sp.torraMin),
      pontoTorraMax: numero(sp.torraMax),
      soDisponiveis: texto(sp.disponivel) === "1",
    },
    ordenacao: ordem && ORDENACOES.includes(ordem) ? ordem : "relevancia",
  };
}

/**
 * Chips do que esta ativo — o §7.2 pede "Ativos: (Torra média ×) Limpar tudo".
 *
 * Recebe `locale` porque cada chip e um ROTULO DE CATALOGO, e eles saiam todos
 * em portugues: quem filtrava por "Suave" em /en/cafes via "Menor preço" e
 * "Torra escura" no chip da propria escolha.
 */
function ativos(f: Filtros, ordenacao: Ordenacao, locale: Locale, q?: string) {
  const d = dicionario(locale);
  const t = textosDaPlp(locale);
  const out: { chave: string; rotulo: string }[] = [];
  if (q) out.push({ chave: "q", rotulo: `${t.buscaChip} “${q}”` });
  if (f.linha) out.push({ chave: "linha", rotulo: d.catalogo.linha[f.linha] });
  if (f.pesoGramas)
    out.push({
      chave: "peso",
      rotulo: f.pesoGramas === 1000 ? "1 kg" : `${f.pesoGramas} g`,
    });
  if (f.formato)
    out.push({ chave: "formato", rotulo: d.catalogo.formato[f.formato] });
  if (f.pontoTorraMin)
    out.push({
      chave: "torraMin",
      rotulo: rotuloPontoTorra(f.pontoTorraMin, locale),
    });
  if (f.soDisponiveis)
    out.push({ chave: "disponivel", rotulo: t.soDisponiveisChip });
  if (ordenacao !== "relevancia")
    out.push({ chave: "ordem", rotulo: d.catalogo.ordenacao[ordenacao] });
  return out;
}

const CAMPO =
  "h-11 w-full border border-fuligem-20 bg-cal-puro px-3 text-[14px] focus-visible:outline-2 focus-visible:outline-offset-[3px] focus-visible:outline-vermelho";
const ROTULO =
  "block text-[11px] font-semibold uppercase tracking-[0.14em] text-fuligem-55";

/**
 * O chip clicável do resgate da tela vazia.
 *
 * Altura mínima de 44 px (`min-h-11`) porque no telefone ele é o único alvo de
 * toque da tela — §12 fixa 44×44 como piso. O deslocamento de 2 px com sombra
 * dura é o mesmo gesto do card e do link externo da /rastreabilidade; `active:`
 * repete o `hover:` porque telefone não tem hover, e sem ele tocar num chip
 * não dá retorno nenhum.
 */
const CHIP =
  "inline-flex min-h-11 items-center gap-2 border border-fuligem-20 bg-cal-puro px-3.5 text-[14px] transition-[border-color,box-shadow,transform] duration-[200ms] ease-canastra hover:-translate-x-0.5 hover:-translate-y-0.5 hover:border-vermelho hover:shadow-[3px_3px_0_var(--color-fuligem)] focus-visible:outline-2 focus-visible:outline-offset-[3px] focus-visible:outline-vermelho active:-translate-x-0.5 active:-translate-y-0.5 active:shadow-[3px_3px_0_var(--color-fuligem)]";

export default async function PaginaCafes({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Busca>;
}) {
  const locale = comoLocale((await params).locale);
  const d = dicionario(locale);
  const t = textosDaPlp(locale);
  const sp = await searchParams;
  const { filtros, ordenacao } = lerFiltros(sp);
  const q = texto(sp.q)?.trim() || undefined;
  // A busca por texto e regra de apresentacao, nao de catalogo: aplica-se
  // DEPOIS das facetas do repositorio — ver o comentario em lib/busca.ts.
  /**
   * REPOSITORIO PRIMEIRO, TRADUCAO DEPOIS, e a ordem nao e estetica: e o
   * repositorio que traz preco e estoque do banco, e `traduzirLote` recebe o
   * lote ja pronto justamente para nao devolver o preco de ontem a quem
   * trocou de idioma (ver a nota em lib/catalogo/produtos.ts).
   *
   * A busca por texto vem por ultimo, sobre o texto JA traduzido: quem procura
   * "chocolate" em /en/cafes espera casar com a nota em ingles.
   */
  const lotes = filtrarPorTexto(
    (await listarLotes(filtros, ordenacao)).map((l) => traduzirLote(l, locale)),
    q,
    locale,
  );
  const kits = await listarKits();
  const chips = ativos(filtros, ordenacao, locale, q);

  return (
    <div className="mx-auto max-w-[1440px] px-4 py-10 md:px-10 md:py-16">
      <div className="flex flex-wrap items-baseline justify-between gap-4">
        {/* O TÍTULO É O MESMO RÓTULO DA NAVEGAÇÃO, de propósito: um item de
            menu que discorda do título da página de destino faz a pessoa achar
            que clicou errado (é a nota de `nav.aSerra` no dicionário). Uma
            chave só para as duas telas também impede que uma seja traduzida e
            a outra não. */}
        <h1 className="font-titulo text-[clamp(2.5rem,5vw,3.75rem)] leading-none">
          {d.nav.cafes}
        </h1>
        <span className="font-dado text-[13px] tracking-[0.06em] text-fuligem-55">
          {lotes.length} {lotes.length === 1 ? d.comum.lote : d.comum.lotes}
        </span>
      </div>

      {/* Submit nativo: funciona sem JS. */}
      <form method="get" className="mt-8 border-y border-fuligem-20 py-6">
        {/* A busca da caixa do cabeçalho sobrevive ao reenvio dos filtros:
            sem este hidden, mexer em "Linha" apagaria o `q` da URL. */}
        {q ? <input type="hidden" name="q" value={q} /> : null}
        {/* Quatro campos desde que a "Moagem" saiu. Uma coluna no telefone —
            select empilhado é o único que não some abaixo de 360 px. */}
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <label htmlFor="f-linha" className={ROTULO}>
              {t.filtroLinha}
            </label>
            <select
              id="f-linha"
              name="linha"
              defaultValue={filtros.linha ?? ""}
              className={`${CAMPO} mt-1.5`}
            >
              <option value="">{t.opcaoTodas}</option>
              {LINHAS.map((l) => (
                <option key={l} value={l}>
                  {d.catalogo.linha[l]}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label htmlFor="f-torra" className={ROTULO}>
              {t.filtroTorraMinima}
            </label>
            <select
              id="f-torra"
              name="torraMin"
              defaultValue={filtros.pontoTorraMin ?? ""}
              className={`${CAMPO} mt-1.5`}
            >
              <option value="">{t.opcaoQualquer}</option>
              {[1, 2, 3, 4, 5].map((n) => (
                <option key={n} value={n}>
                  {rotuloPontoTorra(n, locale)}
                </option>
              ))}
            </select>
          </div>

          {/* Aqui havia "Altitude mínima" e, ao lado dele, "Moagem".
              A altitude caiu junto com o dado: era inventada por lote e saiu do
              contrato. O estetica.md §6 antecipa esse caso — sem altitude real,
              troca-se o eixo pelo de torra, que é o que "Torra mínima" faz.
              A "Moagem" caiu por duplicidade: ela oferecia sete valores para o
              MESMO eixo que este filtro cobre com grãos, moído, drip e cápsula,
              num catálogo que vende dois. Dois filtros para um eixo é ruído. */}
          <div>
            <label htmlFor="f-formato" className={ROTULO}>
              {t.filtroFormato}
            </label>
            <select
              id="f-formato"
              name="formato"
              defaultValue={filtros.formato ?? ""}
              className={`${CAMPO} mt-1.5`}
            >
              <option value="">{t.opcaoQualquer}</option>
              {FORMATOS.map((f) => (
                <option key={f} value={f}>
                  {d.catalogo.formato[f]}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label htmlFor="f-ordem" className={ROTULO}>
              {t.filtroOrdem}
            </label>
            <select
              id="f-ordem"
              name="ordem"
              defaultValue={ordenacao}
              className={`${CAMPO} mt-1.5`}
            >
              {ORDENACOES.map((o) => (
                <option key={o} value={o}>
                  {d.catalogo.ordenacao[o]}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="mt-5 flex flex-wrap items-center gap-3">
          <label className="flex items-center gap-2 text-[13px]">
            <input
              type="checkbox"
              name="disponivel"
              value="1"
              defaultChecked={filtros.soDisponiveis}
              className="size-4 accent-[var(--color-vermelho)]"
            />
            {t.soDisponiveisCampo}
          </label>

          <button
            type="submit"
            className="h-11 rounded-bt bg-fuligem px-6 text-[12px] font-semibold uppercase tracking-[0.1em] text-cal transition-colors hover:bg-fuligem-80 focus-visible:outline-2 focus-visible:outline-offset-[3px] focus-visible:outline-vermelho"
          >
            {t.botaoFiltrar}
          </button>

          {chips.length ? (
            <>
              <span className="text-[12px] uppercase tracking-[0.14em] text-fuligem-55">
                {t.ativosRotulo}
              </span>
              {chips.map((c) => (
                <span
                  key={c.chave}
                  className="border border-fuligem px-2.5 py-1 text-[12px]"
                >
                  {c.rotulo}
                </span>
              ))}
              <Link
                href={href(locale, "/cafes")}
                className="text-[13px] text-vermelho underline underline-offset-4"
              >
                {d.comum.limparTudo}
              </Link>
            </>
          ) : null}
        </div>
      </form>

      {lotes.length ? (
        <div className="mt-10 grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {lotes.map((lote) => (
            <CardCafe key={lote.slug} lote={lote} locale={locale} />
          ))}
        </div>
      ) : (
        <TelaVazia locale={locale} q={q} />
      )}

      {/* ── Kits e caixas ────────────────────────────────────────────────────
          A superfície de venda dos kits do catálogo, que até aqui só existiam
          no JSON. Fica fora dos filtros de propósito: kit mistura linhas, e um
          filtro de "linha" ou "torra" não o descreve. Kit esgotado aparece
          desabilitado no card, nunca some. */}
      {kits.length ? (
        <section aria-labelledby="titulo-kits" className="mt-16 border-t border-fuligem-20 pt-10 md:mt-24 md:pt-14">
          <h2
            id="titulo-kits"
            className="titulo-secao text-[clamp(1.75rem,3.5vw,2.75rem)] leading-tight"
          >
            {t.kitsTitulo}
          </h2>
          <p className="mt-3 max-w-[52ch] text-[15px] text-fuligem-80">
            {t.kitsTexto}
          </p>
          <div className="mt-8 grid grid-cols-1 gap-6 lg:grid-cols-2 xl:grid-cols-3">
            {/* O `locale` vai para os DOIS cards da página: sem ele aqui, a
                seção de kits vendia em português no meio de /en/cafes. */}
            {kits.map((kit) => (
              <CardKit key={kit.sku} kit={kit} locale={locale} />
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}

/**
 * A tela vazia — §11: "tela vazia é convite", nunca "0 resultados".
 *
 * ELA ERA UM BECO SEM SAÍDA, e de duas maneiras ao mesmo tempo. Mandava
 * procurar por "frutado", nota que nenhuma linha tem desde que o catálogo
 * passou a usar as notas publicadas pela marca, e dizia que a casa ia "da
 * torra média do Suave à média-escura do Clássico", quando o Clássico virou
 * torra escura no mesmo diff. O único lugar da PLP que existe para resgatar
 * uma busca vazia devolvia a pessoa a outra busca vazia.
 *
 * ENTÃO NADA AQUI É CITADO À MÃO. As linhas, as notas e os dois extremos da
 * torra saem do catálogo por `./conteudo.ts`, e o teste ao lado prova que toda
 * sugestão desta tela encontra pelo menos um café. Cada chip aponta para o
 * catálogo INTEIRO com um filtro só — nunca para o filtro atual mais um —
 * porque de uma tela vazia o resgate é alargar, jamais estreitar.
 *
 * MOBILE PRIMEIRO: uma coluna, chips que quebram linha, 44 px de altura
 * mínima. É a tela em que o dedo é o único ponteiro disponível.
 */
function TelaVazia({ locale, q }: { locale: Locale; q?: string }) {
  const d = dicionario(locale);
  const t = textosDaPlp(locale);
  const linhas = linhasDoCatalogo(locale);
  const notas = notasDoCatalogo(locale);
  const torra = faixaDeTorraDoCatalogo();

  return (
    <section aria-labelledby="titulo-vazio" className="mt-12 md:mt-16">
      <h2
        id="titulo-vazio"
        className="titulo-secao max-w-[24ch] text-[clamp(1.5rem,3vw,2.25rem)] leading-tight"
      >
        {q ? `${t.vazioBuscaTitulo} “${q}”.` : t.vazioFiltroTitulo}
      </h2>
      <p className="mt-4 max-w-[52ch] text-[17px] text-fuligem-80">
        {t.vazioLead}
      </p>

      <div className="mt-10 max-w-[64ch] border-t border-fuligem-20 pt-5">
        <p className={ROTULO}>{t.vazioLinhasRotulo}</p>
        <ul className="mt-3 flex flex-wrap gap-2">
          {linhas.map((linha) => (
            <li key={linha.slug}>
              {/* O `caminho` já saiu do `href()` do idioma dentro do
                  conteudo.ts — é lá que o teste consegue abri-lo e provar que
                  o chip encontra café. */}
              <Link href={linha.caminho} className={CHIP}>
                {/* A cor vem da embalagem da própria linha (§4.1) — é o mesmo
                    código de cor da fita do card, e nunca uma cor inventada.
                    Decorativa: quem não a vê lê o nome ao lado. */}
                <span
                  aria-hidden
                  className="size-2 shrink-0"
                  style={{ backgroundColor: linha.cor }}
                />
                {linha.rotulo}
              </Link>
            </li>
          ))}
        </ul>
      </div>

      <div className="mt-8 max-w-[64ch] border-t border-fuligem-20 pt-5">
        <p className={ROTULO}>{t.vazioNotasRotulo}</p>
        <ul className="mt-3 flex flex-wrap gap-2">
          {notas.map((nota) => (
            <li key={nota.rotulo}>
              <Link href={nota.caminho} className={CHIP}>
                {nota.rotulo}
              </Link>
            </li>
          ))}
        </ul>
      </div>

      {/* A faixa de torra é INFORMAÇÃO, não um chip: filtrar por torra a partir
          daqui estreitaria de novo. Ela responde a outra pergunta — "então o
          que existe?" — e responde com o número que os cards mostram. A escala
          nunca aparece só como número (§5.3): vem sempre com o texto. */}
      <div className="mt-8 max-w-[64ch] border-t border-fuligem-20 pt-5">
        <p className={ROTULO}>{t.vazioTorraRotulo}</p>
        <p className="mt-3 flex flex-wrap items-baseline gap-x-3 gap-y-1 text-[15px]">
          <span>
            <span className="font-dado text-[13px] tracking-[0.04em] text-fuligem-55">
              {torra.min}/5
            </span>{" "}
            {rotuloPontoTorra(torra.min, locale)}
          </span>
          <span aria-hidden className="text-fuligem-20">
            ———
          </span>
          <span>
            <span className="font-dado text-[13px] tracking-[0.04em] text-fuligem-55">
              {torra.max}/5
            </span>{" "}
            {rotuloPontoTorra(torra.max, locale)}
          </span>
        </p>
      </div>

      <div className="mt-10">
        <BotaoLink href={href(locale, "/cafes")} variante="secundario">
          {d.comum.limparFiltros}
        </BotaoLink>
      </div>
    </section>
  );
}
