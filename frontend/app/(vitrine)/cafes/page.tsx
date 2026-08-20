import type { Metadata } from "next";
import Link from "next/link";
import { listarKits, listarLotes } from "@/lib/catalogo/repositorio";
import { filtrarPorTexto } from "@/lib/busca";
import { CardKit } from "@/components/catalogo/CardKit";
import { FORMATOS, MOAGENS, ORDENACOES } from "@/lib/catalogo/tipos";
import type {
  Filtros,
  Formato,
  Linha,
  Moagem,
  Ordenacao,
  PesoGramas,
} from "@/lib/catalogo/tipos";
import { LINHAS, PONTO_TORRA } from "@/lib/catalogo/rotulos";
import { CardCafe } from "@/components/catalogo/CardCafe";
import { BotaoLink } from "@/components/ui/Botao";

/**
 * PLP — estetica.md §7.2.
 *
 * Os filtros vivem na URL (`?linha=suave&torraMin=3`), nao em estado de
 * memoria. Sao tres exigencias do documento de uma vez: o filtro fica
 * compartilhavel, o botao voltar funciona, e a pagina continua operavel com JS
 * desabilitado (§12) — por isso o formulario e um <form method="get"> com
 * submit nativo, e nao um punhado de onChange.
 */

export const metadata: Metadata = {
  title: "Cafés — Café Canastra",
  description:
    "As linhas do Café Canastra: Clássico, Suave, Canela e Microlote. Origem única da Serra da Canastra, em grãos ou moído na hora do pedido.",
};

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
  const moagem = texto(sp.moagem) as Moagem | undefined;
  const formato = texto(sp.formato) as Formato | undefined;
  const peso = numero(sp.peso) as PesoGramas | undefined;
  const ordem = texto(sp.ordem) as Ordenacao | undefined;

  return {
    filtros: {
      linha: linha && linha in LINHAS ? linha : undefined,
      moagem: moagem && MOAGENS.some((m) => m.valor === moagem) ? moagem : undefined,
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
  if (f.moagem)
    out.push({
      chave: "moagem",
      rotulo: MOAGENS.find((m) => m.valor === f.moagem)!.rotulo,
    });
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
  searchParams,
}: {
  searchParams: Promise<Busca>;
}) {
  const sp = await searchParams;
  const { filtros, ordenacao } = lerFiltros(sp);
  const q = texto(sp.q)?.trim() || undefined;
  // A busca por texto e regra de apresentacao, nao de catalogo: aplica-se
  // DEPOIS das facetas do repositorio — ver o comentario em lib/busca.ts.
  const lotes = filtrarPorTexto(await listarLotes(filtros, ordenacao), q);
  const kits = await listarKits();
  const chips = ativos(filtros, ordenacao, q);

  return (
    <div className="mx-auto max-w-[1440px] px-4 py-10 md:px-10 md:py-16">
      <div className="flex flex-wrap items-baseline justify-between gap-4">
        <h1 className="font-titulo text-[clamp(2.5rem,5vw,3.75rem)] leading-none">
          Cafés
        </h1>
        <span className="font-dado text-[13px] tracking-[0.06em] text-fuligem-55">
          {lotes.length} {lotes.length === 1 ? "lote" : "lotes"}
        </span>
      </div>

      {/* Submit nativo: funciona sem JS. */}
      <form method="get" className="mt-8 border-y border-fuligem-20 py-6">
        {/* A busca da caixa do cabeçalho sobrevive ao reenvio dos filtros:
            sem este hidden, mexer em "Linha" apagaria o `q` da URL. */}
        {q ? <input type="hidden" name="q" value={q} /> : null}
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
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

          <div>
            <label htmlFor="f-moagem" className={ROTULO}>
              Moagem
            </label>
            <select
              id="f-moagem"
              name="moagem"
              defaultValue={filtros.moagem ?? ""}
              className={`${CAMPO} mt-1.5`}
            >
              <option value="">Qualquer</option>
              {MOAGENS.map((m) => (
                <option key={m.valor} value={m.valor}>
                  {m.rotulo}
                </option>
              ))}
            </select>
          </div>

          {/* Aqui havia "Altitude mínima".
              O filtro caiu junto com o dado: a altitude por lote era inventada
              e saiu do contrato. O estetica.md §6 antecipa exatamente este
              caso — sem altitude real, troca-se o eixo de altitude pelo de
              torra, que é o que a linha "Torra mínima" ao lado já faz.
              O lugar virou o filtro de formato, que é o eixo de variação
              verdadeiro deste catálogo: grãos, moído, drip, cápsula. */}
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
                href="/cafes"
                className="text-[13px] text-vermelho underline underline-offset-4"
              >
                Limpar tudo
              </Link>
            </>
          ) : null}
        </div>
      </form>

      {lotes.length ? (
        <div className="mt-10 grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {lotes.map((lote) => (
            <CardCafe key={lote.slug} lote={lote} />
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
            <BotaoLink href="/cafes" variante="secundario">
              Limpar filtros
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
