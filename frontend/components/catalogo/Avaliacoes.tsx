"use client";

import { useEffect, useState } from "react";
import { listarAprovadas } from "@/lib/avaliacoes/avaliacoes";
import type {
  AvaliacaoPublica,
  ResumoDeAvaliacoes,
} from "@/lib/avaliacoes/tipos";
import { dicionario, type Dicionario } from "@/lib/i18n/dicionario";
import { LOCALE_PADRAO, TAG_BCP47, type Locale } from "@/lib/i18n/tipos";

/**
 * Avaliações da PDP — a última seção da página (estetica.md §7.3).
 *
 * CLIENT ISLAND de propósito: a PDP é estática (revalidada a cada hora para o
 * JSON-LD), mas a lista visível busca ao vivo no PostgREST — uma avaliação
 * aprovada agora aparece agora, sem esperar o rebuild.
 *
 * TOM (estetica.md §2/§8.1): prova social SÓBRIA. A média é um número em
 * Martian Mono com "de 5" e a contagem — nada de banner de cinco estrelas
 * gigante. As estrelas existem, pequenas e `aria-hidden`; o texto é quem
 * carrega a informação.
 *
 * ERRO É SILÊNCIO: se a consulta falhar, a seção simplesmente não aparece.
 * Uma PDP sem avaliações vende; uma PDP quebrada não. (O estado vazio é
 * diferente de erro: vazio é convite, e aparece.)
 */

type Props = {
  skus: string[];
  /**
   * O idioma da PDP. Ele decide o texto E OS DOIS FORMATOS DE NÚMERO desta
   * seção: a média saía sempre com vírgula decimal ("4,8") e a data sempre em
   * dd/mm/aaaa, que é como o Brasil escreve e não é como o leitor em inglês
   * lê. `TAG_BCP47` é a mesma etiqueta do `<html lang>` da moldura — uma
   * fonte só para o idioma da página e para o da formatação.
   */
  locale?: Locale;
};

/** Estrelas pequenas, decorativas — o valor textual está sempre ao lado. */
function Estrelas({ nota, className = "" }: { nota: number; className?: string }) {
  return (
    <span aria-hidden className={`select-none tracking-[0.1em] ${className}`}>
      {[1, 2, 3, 4, 5].map((posicao) => (
        <span
          key={posicao}
          className={posicao <= Math.round(nota) ? "text-vermelho" : "text-fuligem-20"}
        >
          ★
        </span>
      ))}
    </span>
  );
}

/**
 * A data de uma avaliação, escrita como o idioma da página escreve.
 *
 * `toLocaleDateString("pt-BR")` cravado era 03/08/2026 para todo mundo, e um
 * leitor em inglês lê aquilo como 8 de março. `TAG_BCP47` é a MESMA etiqueta
 * do `<html lang>` da moldura — o idioma da página e o do formato saem de uma
 * fonte só.
 *
 * EXPORTADA PARA O TESTE, e a razão é a arquitetura desta ilha: a lista só
 * existe depois do efeito que busca no PostgREST, e efeito não roda em
 * `renderToStaticMarkup`. Sem exportar, esta regra e a do plural ficariam sem
 * nenhuma verificação.
 */
export function dataDaAvaliacao(iso: string, locale: Locale): string {
  const data = new Date(iso);
  return Number.isNaN(data.getTime())
    ? ""
    : data.toLocaleDateString(TAG_BCP47[locale]);
}

/**
 * Singular ou plural da contagem.
 *
 * A REGRA DE PLURAL É POR IDIOMA, e nos três daqui ela por acaso coincide: só
 * 1 é singular, e o zero vai para o plural ("0 avaliações", "0 reviews", "0
 * opiniones"). Está numa função em vez de num ternário solto na JSX porque a
 * coincidência não é lei — o francês trata 0 como singular, o russo tem três
 * formas — e o dia em que entrar um idioma assim, o lugar de mudar já existe
 * e é um só.
 *
 * Exportada pelo mesmo motivo de `dataDaAvaliacao`.
 */
export function contagem(n: number, d: Dicionario): string {
  return n === 1 ? d.avaliacoes.uma : d.avaliacoes.muitas;
}

export function Avaliacoes({ skus, locale = LOCALE_PADRAO }: Props) {
  const d = dicionario(locale);
  const [estado, setEstado] = useState<"carregando" | "pronto" | "erro">(
    "carregando",
  );
  const [resumo, setResumo] = useState<ResumoDeAvaliacoes | null>(null);
  const [lista, setLista] = useState<AvaliacaoPublica[]>([]);
  const [pagina, setPagina] = useState(0);
  const [buscandoMais, setBuscandoMais] = useState(false);

  useEffect(() => {
    let vivo = true;
    listarAprovadas(skus)
      .then((r) => {
        if (!vivo) return;
        setResumo(r);
        setLista(r.avaliacoes);
        setEstado("pronto");
      })
      .catch(() => vivo && setEstado("erro"));
    return () => {
      vivo = false;
    };
    // `skus` vem de página estática: a lista não muda durante a vida da ilha.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (estado === "carregando" || estado === "erro") return null;
  if (!resumo) return null;

  const verMais = async () => {
    if (buscandoMais) return;
    setBuscandoMais(true);
    try {
      const proxima = await listarAprovadas(skus, { pagina: pagina + 1 });
      setPagina((p) => p + 1);
      // DEDUP POR `id`, e não é zelo: a paginação é por OFFSET (`range`) sobre
      // uma lista que muda embaixo. Uma avaliação aprovada no painel entre dois
      // cliques em "ver mais" entra na frente (a ordem é `criado_em DESC`) e
      // empurra a última linha da página anterior para dentro da próxima — o
      // React então recebe duas linhas com a MESMA key, avisa no console e
      // reconcilia errado. Filtrar aqui é mais barato que paginar por cursor
      // para uma seção de fim de página.
      setLista((atual) => {
        const jaNaTela = new Set(atual.map((a) => a.id));
        return [
          ...atual,
          ...proxima.avaliacoes.filter((a) => !jaNaTela.has(a.id)),
        ];
      });
      setResumo((r) => (r ? { ...r, haMais: proxima.haMais } : r));
    } catch {
      // Falhou o "ver mais": a lista que já está na tela continua valendo.
    } finally {
      setBuscandoMais(false);
    }
  };

  const mediaExibida = resumo.media.toLocaleString(TAG_BCP47[locale], {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  });

  return (
    <section
      aria-label={d.avaliacoes.deClientes}
      className="border-t border-fuligem-20 bg-cal py-16 md:py-24"
    >
      <div className="mx-auto max-w-[1440px] px-4 md:px-10">
        <h2 className="titulo-secao text-[clamp(1.75rem,3.5vw,2.75rem)] leading-tight">
          {d.avaliacoes.titulo}
        </h2>

        {resumo.contagem === 0 ? (
          <p className="mt-6 max-w-[52ch] text-[17px] leading-relaxed text-fuligem-80">
            {d.avaliacoes.vazio}
          </p>
        ) : (
          <>
            {/* Média discreta: número + "de 5" + contagem. Sem banner. */}
            <p className="mt-6 flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <span className="font-dado text-[28px] leading-none">
                {mediaExibida}
              </span>
              <span className="text-[14px] text-fuligem-55">
                {d.avaliacoes.deCinco}
              </span>
              <Estrelas nota={resumo.media} className="text-[14px]" />
              <span className="font-dado text-[13px] text-fuligem-55">
                {resumo.contagem} {contagem(resumo.contagem, d)}
              </span>
            </p>

            <ul className="mt-10 max-w-[720px] border-t border-fuligem-20">
              {lista.map((avaliacao) => (
                <li
                  key={avaliacao.id}
                  className="border-b border-fuligem-20 py-6"
                >
                  <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                    <Estrelas nota={avaliacao.nota} className="text-[13px]" />
                    <span className="sr-only">
                      {d.avaliacoes.nota} {avaliacao.nota}{" "}
                      {d.avaliacoes.deCinco}.
                    </span>
                    <span className="text-[14px] font-semibold">
                      {avaliacao.nomeExibicao}
                    </span>
                    <span className="font-dado text-[12px] text-fuligem-55">
                      {dataDaAvaliacao(avaliacao.criadoEm, locale)}
                    </span>
                  </div>
                  {avaliacao.titulo ? (
                    <p className="mt-2 text-[15px] font-semibold">
                      {avaliacao.titulo}
                    </p>
                  ) : null}
                  {avaliacao.texto ? (
                    <p className="mt-1 max-w-[62ch] text-[15px] leading-relaxed text-fuligem-80">
                      {avaliacao.texto}
                    </p>
                  ) : null}
                </li>
              ))}
            </ul>

            {resumo.haMais ? (
              <button
                type="button"
                onClick={verMais}
                disabled={buscandoMais}
                className="mt-8 border border-current px-6 py-3 text-[13px] font-semibold uppercase tracking-[0.08em] transition-colors hover:bg-fuligem hover:text-cal focus-visible:outline-2 focus-visible:outline-offset-[3px] focus-visible:outline-vermelho disabled:opacity-60"
              >
                {buscandoMais ? d.avaliacoes.buscando : d.avaliacoes.verMais}
              </button>
            ) : null}
          </>
        )}
      </div>
    </section>
  );
}
