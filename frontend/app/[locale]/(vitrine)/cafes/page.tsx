import type { Metadata } from "next";
import Link from "next/link";
import { listarKits, listarLotes } from "@/lib/catalogo/repositorio";
import { traduzirLote } from "@/lib/catalogo/produtos";
import { filtrarPorTexto } from "@/lib/busca";
import { CardKit } from "@/components/catalogo/CardKit";
import { FORMATOS, ORDENACOES } from "@/lib/catalogo/tipos";
import type {
  Filtros,
  Formato,
  Linha,
  Ordenacao,
  PesoGramas,
} from "@/lib/catalogo/tipos";
import { LINHAS, PONTO_TORRA } from "@/lib/catalogo/rotulos";
import { CardCafe } from "@/components/catalogo/CardCafe";
import { BotaoLink } from "@/components/ui/Botao";
import { alternativasDeIdioma, href } from "@/lib/i18n/rotas";
import { comoLocale } from "@/lib/i18n/tipos";
import { dicionario } from "@/lib/i18n/dicionario";

/**
 * PLP — estetica.md §7.2.
 *
 * Os filtros vivem na URL (`?linha=suave&torraMin=3`), nao em estado de
 * memoria. Sao tres exigencias do documento de uma vez: o filtro fica
 * compartilhavel, o botao voltar funciona, e a pagina continua operavel com JS
 * desabilitado (§12) — por isso o formulario e um <form method="get"> com
 * submit nativo, e nao um punhado de onChange.
 */

/**
 * `generateMetadata` e não um `metadata` constante porque o canônico precisa
 * ser a PRÓPRIA página, no próprio idioma — ver a nota em lib/i18n/rotas.ts.
 */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  return {
    title: "Cafés — Café Canastra",
    description:
      "As linhas do Café Canastra: Clássico, Suave, Canela e Microlote. Origem única da Serra da Canastra, em grãos ou moído na hora do pedido.",
    alternates: alternativasDeIdioma("/cafes", comoLocale((await params).locale)),
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
      linha: linha && linha in LINHAS ? linha : undefined,
      formato: formato && FORMATOS.some((f) => f.valor === formato) ? formato : undefined,
      pesoGramas: peso === 250 || peso === 500 || peso === 1000 ? peso : undefined,
      pontoTorraMin: numero(sp.torraMin),
      pontoTorraMax: numero(sp.torraMax),
      soDisponiveis: texto(sp.disponivel) === "1",
    },
    ordenacao: ORDENACOES.some((o) => o.valor === ordem)
      ? (ordem as Ordenacao)
      : "relevancia",
  };
}

/** Chips do que esta ativo — o §7.2 pede "Ativos: (Torra média ×) Limpar tudo". */
function ativos(f: Filtros, ordenacao: Ordenacao, q?: string) {
  const out: { chave: string; rotulo: string }[] = [];
  if (q) out.push({ chave: "q", rotulo: `Busca: “${q}”` });
  if (f.linha) out.push({ chave: "linha", rotulo: LINHAS[f.linha].rotulo });
  if (f.pesoGramas)
    out.push({
      chave: "peso",
      rotulo: f.pesoGramas === 1000 ? "1 kg" : `${f.pesoGramas} g`,
    });
  if (f.formato)
    out.push({
      chave: "formato",
      rotulo: FORMATOS.find((x) => x.valor === f.formato)!.rotulo,
    });
  if (f.pontoTorraMin)
    out.push({ chave: "torraMin", rotulo: PONTO_TORRA[f.pontoTorraMin] ?? "Torra" });
  if (f.soDisponiveis) out.push({ chave: "disponivel", rotulo: "Só disponíveis" });
  if (ordenacao !== "relevancia")
    out.push({
      chave: "ordem",
      rotulo: ORDENACOES.find((o) => o.valor === ordenacao)!.rotulo,
    });
  return out;
}

const CAMPO =
  "h-11 w-full border border-fuligem-20 bg-cal-puro px-3 text-[14px] focus-visible:outline-2 focus-visible:outline-offset-[3px] focus-visible:outline-vermelho";
const ROTULO =
  "block text-[11px] font-semibold uppercase tracking-[0.14em] text-fuligem-55";

export default async function PaginaCafes({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Busca>;
}) {
  const locale = comoLocale((await params).locale);
  const d = dicionario(locale);
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
  );
  const kits = await listarKits();
  const chips = ativos(filtros, ordenacao, q);

  return (
    <div className="mx-auto max-w-[1440px] px-4 py-10 md:px-10 md:py-16">
      <div className="flex flex-wrap items-baseline justify-between gap-4">
        <h1 className="font-titulo text-[clamp(2.5rem,5vw,3.75rem)] leading-none">
          Cafés
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
              Linha
            </label>
            <select
              id="f-linha"
              name="linha"
              defaultValue={filtros.linha ?? ""}
              className={`${CAMPO} mt-1.5`}
            >
              <option value="">Todas</option>
              {(Object.keys(LINHAS) as Linha[]).map((l) => (
                <option key={l} value={l}>
                  {LINHAS[l].rotulo}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label htmlFor="f-torra" className={ROTULO}>
              Torra mínima
            </label>
            <select
              id="f-torra"
              name="torraMin"
              defaultValue={filtros.pontoTorraMin ?? ""}
              className={`${CAMPO} mt-1.5`}
            >
              <option value="">Qualquer</option>
              {[1, 2, 3, 4, 5].map((n) => (
                <option key={n} value={n}>
                  {PONTO_TORRA[n]}
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
              Formato
            </label>
            <select
              id="f-formato"
              name="formato"
              defaultValue={filtros.formato ?? ""}
              className={`${CAMPO} mt-1.5`}
            >
              <option value="">Qualquer</option>
              {FORMATOS.map((f) => (
                <option key={f.valor} value={f.valor}>
                  {f.rotulo}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label htmlFor="f-ordem" className={ROTULO}>
              Ordenar por
            </label>
            <select
              id="f-ordem"
              name="ordem"
              defaultValue={ordenacao}
              className={`${CAMPO} mt-1.5`}
            >
              {ORDENACOES.map((o) => (
                <option key={o.valor} value={o.valor}>
                  {o.rotulo}
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
            Só o que está disponível
          </label>

          <button
            type="submit"
            className="h-11 rounded-bt bg-fuligem px-6 text-[12px] font-semibold uppercase tracking-[0.1em] text-cal transition-colors hover:bg-fuligem-80 focus-visible:outline-2 focus-visible:outline-offset-[3px] focus-visible:outline-vermelho"
          >
            Filtrar
          </button>

          {chips.length ? (
            <>
              <span className="text-[12px] uppercase tracking-[0.14em] text-fuligem-55">
                Ativos:
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
        // §11: tela vazia e convite, e o erro explica e resolve. Nunca "0 resultados".
        <div className="mt-16 max-w-[52ch]">
          <p className="titulo-secao text-[clamp(1.5rem,3vw,2.25rem)] leading-tight">
            {q ? `Nenhum café para “${q}”.` : "Nenhum café com esses filtros."}
          </p>
          <p className="mt-4 text-[17px] text-fuligem-80">
            {q ? (
              <>
                Tente pelo nome da linha — Clássico, Suave, Canela — ou por uma
                nota, como <span className="font-dado">chocolate</span> ou{" "}
                <span className="font-dado">frutado</span>.
              </>
            ) : (
              <>
                Tente afrouxar a torra ou o formato — a casa vai da{" "}
                <span className="font-dado">torra média</span> do Suave à{" "}
                <span className="font-dado">média-escura</span> do Clássico, em
                grãos ou moído.
              </>
            )}
          </p>
          <div className="mt-8">
            <BotaoLink href={href(locale, "/cafes")} variante="secundario">
              {d.comum.limparFiltros}
            </BotaoLink>
          </div>
        </div>
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
            Kits e caixas
          </h2>
          <p className="mt-3 max-w-[52ch] text-[15px] text-fuligem-80">
            Mais de uma linha na mesma caixa — para conhecer a casa inteira ou
            não escolher entre os favoritos.
          </p>
          <div className="mt-8 grid grid-cols-1 gap-6 lg:grid-cols-2 xl:grid-cols-3">
            {kits.map((kit) => (
              <CardKit key={kit.sku} kit={kit} />
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}
