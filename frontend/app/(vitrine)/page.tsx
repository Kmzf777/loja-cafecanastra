import Image from "next/image";
import { listarLotes } from "@/lib/catalogo/repositorio";
import { CardCafe } from "@/components/catalogo/CardCafe";
import { BotaoLink } from "@/components/ui/Botao";
import { Serra } from "@/components/marca/Serra";

/**
 * Home — estetica.md §7.1.
 *
 * ALTERNANCIA DE SUPERFICIE (§7.1: "nunca duas secoes escuras seguidas"):
 *   heroi fuligem -> prova cal -> torra cal -> processo kraft -> clube mata
 *   -> historia cal -> rodape fuligem
 *
 * O documento previa o heroi como foto full-bleed do chapadao ao amanhecer. Ela
 * nao existe (§8 e o caminho critico do projeto). Em vez de forcar a unica foto
 * disponivel — sepia quente, justamente o vies que o §2 manda evitar — o heroi
 * roda em superficie escura com a serra, que e a "mao" do §3 aparecendo uma vez.
 */

export const revalidate = 3600;

const PROVA = ["SCA 80+", "Torra sob demanda", "Lote rastreado", "Desde 1985"];

const ETAPAS = [
  { n: "01", titulo: "Colheita", texto: "Grão maduro, colhido no ponto." },
  { n: "02", titulo: "Terreiro", texto: "Secagem lenta, ao sol, sobre o cimento." },
  { n: "03", titulo: "Beneficiamento", texto: "Separação por peneira e densidade." },
  { n: "04", titulo: "Torra", texto: "Em lotes pequenos, sob demanda." },
  { n: "05", titulo: "Sua casa", texto: "Moído na hora do pedido, ou em grão." },
];

export default async function Home() {
  const lotes = await listarLotes();

  return (
    <>
      {/* ── HERÓI ─────────────────────────────────────────── superfície fuligem */}
      <section className="relative flex min-h-[88vh] flex-col justify-end overflow-hidden bg-fuligem text-cal">
        <Image
          src="/imagem-banner.jpg"
          alt="Cozinha mineira ao amanhecer: coador de pano, caneca de ágata e um pacote de Café Canastra sobre a mesa de madeira"
          fill
          priority
          fetchPriority="high"
          sizes="100vw"
          className="object-cover object-center"
        />
        {/* §7.1: sobreposição em gradiente de fuligem, 0 -> 60%, de baixo para
            cima. Sem ela o texto em Cal não passa contraste sobre a foto. */}
        <div
          aria-hidden
          className="absolute inset-0"
          style={{
            background:
              "linear-gradient(to top, var(--color-fuligem) 0%, color-mix(in srgb, var(--color-fuligem) 78%, transparent) 38%, color-mix(in srgb, var(--color-fuligem) 30%, transparent) 72%, transparent 100%)",
          }}
        />
        {/* Horizonte, nao pico: o viewBox e 5:1 e a altura precisa respeitar
            isso, senao a serra vira uma piramide esticada. */}
        <Serra
          aria-hidden
          className="absolute inset-x-0 bottom-0 h-[18vh] max-h-[180px] w-full text-fuligem/70"
          strokeWidth={1.5}
          preenchido
        />
        <div className="relative mx-auto w-full max-w-[1440px] px-5 pb-20 pt-32 md:px-10 md:pb-28">
          <p className="text-[12px] font-semibold uppercase tracking-[0.18em] text-juta">
            Serra da Canastra · Minas Gerais
          </p>
          <h1 className="mt-6 max-w-[14ch] font-titulo text-[clamp(2.75rem,7vw,5.5rem)] leading-[0.95] tracking-[-0.02em]">
            Café que vem de cima.
          </h1>
          <p className="mt-6 max-w-[52ch] text-[18px] leading-relaxed text-cal/80">
            Torrado sob demanda, em lotes pequenos, desde 1985.
          </p>
          <div className="mt-10 flex flex-wrap gap-4">
            <BotaoLink href="/cafes" variante="primario">
              Ver os cafés
            </BotaoLink>
            <BotaoLink href="/a-serra" variante="secundario" className="text-cal">
              Conhecer a serra
            </BotaoLink>
          </div>
        </div>
      </section>

      {/* ── FAIXA DE PROVA ──────────────────────────────────────── superfície cal */}
      <section aria-label="Garantias" className="border-b border-fuligem-20 bg-cal">
        <ul className="mx-auto grid max-w-[1440px] grid-cols-2 md:grid-cols-4">
          {PROVA.map((item, i) => (
            <li
              key={item}
              className={`px-5 py-6 text-center font-dado text-[12px] uppercase tracking-[0.1em] md:px-10 ${
                i > 0 ? "md:border-l md:border-fuligem-20" : ""
              } ${i === 1 || i === 3 ? "border-l border-fuligem-20" : ""} ${
                i > 1 ? "border-t border-fuligem-20 md:border-t-0" : ""
              }`}
            >
              {item}
            </li>
          ))}
        </ul>
      </section>

      {/* ── TORRA DA SEMANA ─────────────────────────────────────── superfície cal */}
      <section className="bg-cal py-16 md:py-24">
        <div className="mx-auto max-w-[1440px] px-5 md:px-10">
          <div className="flex flex-wrap items-baseline justify-between gap-4">
            <h2 className="font-titulo text-[clamp(1.75rem,3.5vw,2.75rem)] leading-tight">
              Torra da semana
            </h2>
            <span className="font-dado text-[13px] tracking-[0.06em] text-fuligem-55">
              {lotes.length} lotes
            </span>
          </div>

          <div className="mt-10 grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {lotes.map((lote) => (
              <CardCafe key={lote.slug} lote={lote} />
            ))}
          </div>

          <div className="mt-12">
            <BotaoLink href="/cafes" variante="secundario">
              Ver todos os cafés
            </BotaoLink>
          </div>
        </div>
      </section>

      {/* ── DO PÉ À XÍCARA ────────────────────────────────────── superfície kraft */}
      <section className="bg-juta-claro py-16 md:py-24">
        <div className="mx-auto max-w-[1440px] px-5 md:px-10">
          <h2 className="font-titulo text-[clamp(1.75rem,3.5vw,2.75rem)] leading-tight">
            Do pé à xícara
          </h2>
          {/* Numeração justificada: é sequência real e irreversível (§7.1). */}
          <ol className="mt-10 grid grid-cols-1 gap-x-8 gap-y-8 sm:grid-cols-2 lg:grid-cols-5">
            {ETAPAS.map((etapa) => (
              <li key={etapa.n} className="border-t border-fuligem/25 pt-4">
                <span className="font-dado text-[13px] tracking-[0.08em] text-barro">
                  {etapa.n}
                </span>
                <h3 className="mt-2 text-[17px] font-semibold">{etapa.titulo}</h3>
                <p className="mt-1.5 text-[15px] leading-relaxed text-fuligem-80">
                  {etapa.texto}
                </p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      {/* ── CLUBE ────────────────────────────────────────────── superfície mata */}
      <section className="bg-mata py-16 text-cal md:py-24">
        <div className="mx-auto max-w-[1440px] px-5 md:px-10">
          <p className="text-[12px] font-semibold uppercase tracking-[0.18em] text-juta">
            Assinatura
          </p>
          <h2 className="mt-5 max-w-[18ch] font-titulo text-[clamp(1.75rem,3.5vw,2.75rem)] leading-tight">
            Clube da Canastra
          </h2>
          <p className="mt-5 max-w-[62ch] text-[17px] leading-relaxed text-cal/85">
            Café novo em casa a cada 15, 30 ou 45 dias, moído do jeito que você
            prepara. Cancele quando quiser, sem multa.
          </p>
          {/* §4.1: vermelho sobre mata é 2,0:1 — proibido. CTA em cal. */}
          <div className="mt-10">
            <BotaoLink href="/clube" variante="primarioEscuro">
              Começar assinatura
            </BotaoLink>
          </div>
        </div>
      </section>

      {/* ── HISTÓRIA ────────────────────────────────────────────── superfície cal */}
      <section className="bg-cal py-16 md:py-24">
        <div className="mx-auto grid max-w-[1440px] items-center gap-10 px-5 md:grid-cols-2 md:px-10">
          <Image
            src="/nossa-historia.png"
            alt="Dois produtores entre as fileiras de café, no fim da tarde"
            width={1448}
            height={1448}
            sizes="(min-width: 768px) 50vw, 100vw"
            className="w-full border border-fuligem-20"
          />
          <div>
            <p className="font-dado text-[13px] tracking-[0.08em] text-barro">
              Desde 1985
            </p>
            <h2 className="mt-4 font-titulo text-[clamp(1.75rem,3.5vw,2.75rem)] leading-tight">
              Quarenta anos na mesma serra
            </h2>
            <p className="mt-5 max-w-[62ch] text-[17px] leading-relaxed text-fuligem-80">
              A lavoura fica entre 900 e 1.320 metros, na borda do chapadão.
              Altitude alta, noite fria: o grão amadurece devagar e ganha doçura.
              É o que a xícara mostra.
            </p>
            <div className="mt-8">
              <BotaoLink href="/a-serra" variante="secundario">
                Conhecer a serra
              </BotaoLink>
            </div>
          </div>
        </div>
      </section>
    </>
  );
}
