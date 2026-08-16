import type { Metadata } from "next";
import { listarLotes, formatarPreco, precoMinimo } from "@/lib/catalogo/repositorio";
import { BotaoLink } from "@/components/ui/Botao";

/**
 * Clube da Canastra — estetica.md §7.4.
 *
 * Superficie Mata. ATENCAO ao contraste: vermelho sobre mata e 2,0:1 (§4.1,
 * proibido). Todo CTA aqui sai em Cal.
 *
 * O documento descreve um fluxo de 3 passos interativo com barra de progresso.
 * Esta versao apresenta os tres passos e a etiqueta de resumo de forma
 * estatica: a pagina informa e converte, mas o wizard com estado ainda nao
 * existe. Fica registrado como pendencia, nao como entregue.
 */

export const metadata: Metadata = {
  title: "Clube da Canastra — Assinatura",
  description:
    "Café novo em casa a cada 15, 30 ou 45 dias, moído do jeito que você prepara. Cancele quando quiser, sem multa.",
};

export const revalidate = 3600;

const PASSOS = [
  {
    n: "Passo 1 de 3",
    titulo: "Quanto você bebe?",
    texto: "Uma, duas ou quatro xícaras por dia. A partir daí sugerimos peso e frequência.",
  },
  {
    n: "Passo 2 de 3",
    titulo: "Como você prepara?",
    texto: "Grão, espresso, coado de papel ou de pano, prensa, moka, aeropress.",
  },
  {
    n: "Passo 3 de 3",
    titulo: "Quem escolhe?",
    texto: "Escolha do mestre de torra, com surpresa a cada envio, ou um café fixo definido por você.",
  },
];

export default async function PaginaClube() {
  const lotes = await listarLotes();
  const comAssinatura = lotes.filter((l) => l.assinatura);
  const desconto = comAssinatura[0]?.assinatura?.desconto ?? 0.1;
  const base = precoMinimo(comAssinatura[0] ?? lotes[0]);
  // 500 g custa aproximadamente o dobro do 250 g de referencia.
  const mensal = Math.round(base * 1.8 * (1 - desconto));
  const economia = Math.round(base * 1.8) - mensal;

  return (
    <>
      <section className="bg-mata py-16 text-cal md:py-24">
        <div className="mx-auto max-w-[1440px] px-5 md:px-10">
          <p className="text-[12px] font-semibold uppercase tracking-[0.18em] text-juta">
            Assinatura
          </p>
          <h1 className="mt-6 max-w-[16ch] font-titulo text-[clamp(2.25rem,5vw,3.75rem)] leading-[1] tracking-[-0.015em]">
            Clube da Canastra
          </h1>
          <p className="mt-6 max-w-[56ch] text-[18px] leading-relaxed text-cal/85">
            Café novo em casa a cada 15, 30 ou 45 dias, moído do jeito que você
            prepara. {Math.round(desconto * 100)}% de desconto em todo envio.
            Cancele quando quiser, sem multa.
          </p>

          <ol className="mt-14 grid gap-px border border-cal/20 bg-cal/20 md:grid-cols-3">
            {PASSOS.map((p) => (
              <li key={p.n} className="bg-mata p-6 md:p-8">
                <span className="font-dado text-[12px] uppercase tracking-[0.1em] text-juta">
                  {p.n}
                </span>
                <h2 className="mt-3 text-[19px] font-semibold">{p.titulo}</h2>
                <p className="mt-2 text-[15px] leading-relaxed text-cal/80">
                  {p.texto}
                </p>
              </li>
            ))}
          </ol>

          {/* Resumo em forma de etiqueta de despacho (§7.4). */}
          <div className="mt-14 max-w-[420px] border border-cal bg-mata p-6">
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em]">
              Clube da Canastra
            </p>
            <hr className="mt-4 border-cal/30" />
            <dl className="mt-4 space-y-2 font-dado text-[14px]">
              <div className="flex justify-between gap-4">
                <dt className="text-cal/70">Peso</dt>
                <dd>500 g</dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-cal/70">Moagem</dt>
                <dd>Coado (papel)</dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-cal/70">Frequência</dt>
                <dd>30 dias</dd>
              </div>
              <div className="flex justify-between gap-4 border-t border-cal/30 pt-3 text-[16px]">
                <dt>Por envio</dt>
                <dd>{formatarPreco(mensal)}</dd>
              </div>
            </dl>
            <p className="mt-2 font-dado text-[12px] text-juta">
              economia de {formatarPreco(economia)}
            </p>
            <p className="mt-5 text-[14px] text-cal/80">
              Cancele quando quiser, sem multa.
            </p>
            {/* §4.1: vermelho sobre mata é 2,0:1 — proibido. CTA em Cal. */}
            <div className="mt-6">
              <BotaoLink
                href="/cafes"
                variante="primarioEscuro"
                className="w-full"
              >
                Escolher o café
              </BotaoLink>
            </div>
          </div>
        </div>
      </section>

      <section className="bg-cal py-16 md:py-24">
        <div className="mx-auto max-w-[1440px] px-5 md:px-10">
          <h2 className="font-titulo text-[clamp(1.75rem,3.5vw,2.75rem)] leading-tight">
            Perguntas diretas
          </h2>
          <dl className="mt-8 max-w-[70ch]">
            {[
              [
                "Posso trocar o café a cada envio?",
                "Pode. A troca vale a partir do envio seguinte, desde que feita antes da torra da terça.",
              ],
              [
                "E se eu viajar?",
                "Dá para adiar um envio sem cancelar a assinatura.",
              ],
              [
                "Tem fidelidade?",
                "Não. Cancele quando quiser, sem multa e sem precisar ligar.",
              ],
              [
                "O café vem moído?",
                "Do jeito que você escolher. Moemos na hora do envio, não antes.",
              ],
            ].map(([p, r]) => (
              <div key={p} className="border-b border-fuligem-20 py-5">
                <dt className="text-[17px] font-semibold">{p}</dt>
                <dd className="mt-2 text-[16px] leading-relaxed text-fuligem-80">
                  {r}
                </dd>
              </div>
            ))}
          </dl>
        </div>
      </section>
    </>
  );
}
