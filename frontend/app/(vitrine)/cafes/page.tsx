import type { Metadata } from "next";
import Link from "next/link";
import { listarLotes, faixaAltitude } from "@/lib/catalogo/repositorio";
import { MOAGENS, ORDENACOES } from "@/lib/catalogo/tipos";
import type { Filtros, Linha, Moagem, Ordenacao, PesoGramas } from "@/lib/catalogo/tipos";
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
    "Todos os lotes da Serra da Canastra, do Porteira a 900 metros ao Casca d'Anta a 1.320. Torrado sob demanda.",
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
  const peso = numero(sp.peso) as PesoGramas | undefined;
  const ordem = texto(sp.ordem) as Ordenacao | undefined;

  return {
    filtros: {
      linha: linha && linha in LINHAS ? linha : undefined,
      moagem: moagem && MOAGENS.some((m) => m.valor === moagem) ? moagem : undefined,
      pesoGramas: peso === 250 || peso === 500 || peso === 1000 ? peso : undefined,
      pontoTorraMin: numero(sp.torraMin),
      pontoTorraMax: numero(sp.torraMax),
      scaMin: numero(sp.sca),
      altitudeMin: numero(sp.altMin),
      altitudeMax: numero(sp.altMax),
    },
    ordenacao: ORDENACOES.some((o) => o.valor === ordem)
      ? (ordem as Ordenacao)
      : "relevancia",
  };
}

/** Chips do que esta ativo — o §7.2 pede "Ativos: (Torra média ×) Limpar tudo". */
function ativos(f: Filtros, ordenacao: Ordenacao) {
  const out: { chave: string; rotulo: string }[] = [];
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
  if (f.pontoTorraMin)
    out.push({ chave: "torraMin", rotulo: PONTO_TORRA[f.pontoTorraMin] ?? "Torra" });
  if (f.scaMin) out.push({ chave: "sca", rotulo: `SCA ${f.scaMin}+` });
  if (f.altitudeMin) out.push({ chave: "altMin", rotulo: `Acima de ${f.altitudeMin} m` });
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
  const lotes = await listarLotes(filtros, ordenacao);
  const faixa = await faixaAltitude();
  const chips = ativos(filtros, ordenacao);

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

          {/* §7.2 pede slider sobre a silhueta da serra. Enquanto o <Serra>
              interativo nao existe, o campo numerico entrega a mesma funcao e
              sobrevive sem JS. */}
          <div>
            <label htmlFor="f-alt" className={ROTULO}>
              Altitude mínima
            </label>
            <input
              id="f-alt"
              name="altMin"
              type="number"
              inputMode="numeric"
              min={faixa.min}
              max={faixa.max}
              step={10}
              placeholder={`${faixa.min} – ${faixa.max} m`}
              defaultValue={filtros.altitudeMin ?? ""}
              className={`${CAMPO} mt-1.5 font-dado`}
            />
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
            Nenhum café com esses filtros.
          </p>
          <p className="mt-4 text-[17px] text-fuligem-80">
            Tente afrouxar a torra ou a altitude — nossos lotes vão de{" "}
            <span className="font-dado">{faixa.min} m</span> a{" "}
            <span className="font-dado">{faixa.max} m</span>.
          </p>
          <div className="mt-8">
            <BotaoLink href="/cafes" variante="secundario">
              Limpar filtros
            </BotaoLink>
          </div>
        </div>
      )}
    </div>
  );
}
