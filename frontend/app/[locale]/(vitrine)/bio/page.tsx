import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { Serra } from "@/components/marca/Serra";
import { alternativasDeIdioma, href } from "@/lib/i18n/rotas";
import { LOCALES, comoLocale, TAG_BCP47, type Locale } from "@/lib/i18n/tipos";
import {
  PRINCIPAIS,
  SECUNDARIOS,
  ehExterno,
  hospedeiroDe,
  textosDaBio,
  type TextosDaBio,
} from "./conteudo";

/**
 * /bio — a página de link do Instagram.
 *
 * PROJETADA PARA 360 px, e isto não é uma formalidade: é a única página do site
 * que praticamente só existe no telefone, aberta de dentro do app do Instagram,
 * operada com o polegar, em quatro segundos de atenção. Todo estilo base aqui é
 * o estilo do telefone; `md:` só aumenta respiro. No desktop ela continua uma
 * coluna estreita e centrada — esticar uma lista de sete links em 1440 px não
 * melhora nada e desmancha a leitura vertical.
 *
 * A ESTÉTICA É A DA LOJA, não a do institucional. O original (`BioClient.tsx`)
 * era gradiente coffee/amber, ícones da lucide-react e animações da
 * framer-motion. Aqui: superfície kraft, filete de 1px, raio zero e a sombra de
 * carimbo de 4px do estetica.md §4.4 — a mesma do <CardCafe>. Sem biblioteca de
 * ícone: as duas setas são SVG de traço fino, como os pictogramas do §5.5.
 *
 * A SOMBRA DE CARIMBO RESPONDE AO TOQUE, não só ao hover. Telefone não tem
 * hover confiável, então `active:` repete exatamente o que `hover:` faz — o
 * bloco sobe 4px e o carimbo aparece embaixo. Sem isso, o retorno visual do
 * toque na página seria zero.
 */

/**
 * As três versões saem prontas do build — e aqui isso vale mais do que em
 * qualquer outra rota do site: /bio é o endereço colado no perfil do
 * Instagram, aberto de dentro do app, em rede de celular, por gente que dá
 * quatro segundos de atenção. É uma lista de links constante; sem esta função
 * o `[locale]` a obrigava a um render de servidor por toque. A explicação
 * longa está na home ((vitrine)/page.tsx).
 */
export function generateStaticParams() {
  return LOCALES.map((locale) => ({ locale }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const locale = comoLocale((await params).locale);
  const t = textosDaBio(locale);

  return {
    /**
     * `absolute` porque o título já vem completo do conteúdo. O
     * `title.template` de app/layout.tsx acrescenta "— Café Canastra" a
     * qualquer título-string de rota filha, e o resultado seria a marca
     * repetida duas vezes no card compartilhado.
     */
    title: { absolute: t.titulo },
    description: t.descricao,
    alternates: alternativasDeIdioma("/bio", locale),
    /**
     * O openGraph do layout raiz NÃO é herdado campo a campo quando a rota
     * declara o seu: o objeto inteiro é substituído. Por isso a imagem padrão
     * é repetida aqui — e ela importa mais nesta página do que em qualquer
     * outra, porque /bio é o endereço que a marca cola no perfil e que as
     * pessoas mandam uma para a outra.
     */
    openGraph: {
      title: t.titulo,
      description: t.descricao,
      type: "website",
      siteName: "Café Canastra",
      // OG usa sublinhado (`pt_BR`), BCP 47 usa hífen (`pt-BR`).
      locale: TAG_BCP47[locale].replace("-", "_"),
      url: href(locale, "/bio"),
      images: [
        {
          url: "/imagem-banner.jpg",
          width: 1280,
          height: 720,
          alt: "Café Canastra — Serra da Canastra, Minas Gerais",
        },
      ],
    },
  };
}

/** Seta de link interno. Traço 1,5px, o mesmo dos pictogramas do §5.5. */
function SetaInterna() {
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden
      className="size-5 shrink-0 text-fuligem-55 transition-transform duration-[320ms] ease-canastra group-hover:translate-x-1 group-hover:text-vermelho group-active:translate-x-1 group-active:text-vermelho motion-reduce:transition-none"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M5 12h13M12 6l6 6-6 6" />
    </svg>
  );
}

/**
 * Seta de link externo — diagonal para fora, o convenção que o visitante já
 * conhece. Ela é o segundo aviso; o primeiro é o domínio escrito por extenso
 * dentro do bloco.
 */
function SetaExterna() {
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden
      className="size-5 shrink-0 text-fuligem-55 transition-transform duration-[320ms] ease-canastra group-hover:-translate-y-0.5 group-hover:translate-x-0.5 group-hover:text-vermelho group-active:-translate-y-0.5 group-active:translate-x-0.5 group-active:text-vermelho motion-reduce:transition-none"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M8 16 16 8M9.5 8H16v6.5" />
      <path d="M19 13.5V19H5V5h5.5" />
    </svg>
  );
}

/**
 * O bloco de link principal.
 *
 * ALVO DE TOQUE: `min-h-[76px]` com o link ocupando a largura toda — muito
 * acima dos 44px do §10, e de propósito. O erro numa lista de bio não é errar
 * o alvo por 2px; é acertar o bloco de baixo.
 */
const BLOCO =
  "group flex w-full items-center gap-4 border border-fuligem-20 bg-cal-puro px-4 py-4 " +
  "transition-[box-shadow,border-color,transform] duration-[320ms] ease-canastra " +
  "hover:-translate-x-1 hover:-translate-y-1 hover:border-fuligem hover:shadow-[4px_4px_0_var(--color-fuligem)] " +
  "active:-translate-x-1 active:-translate-y-1 active:border-fuligem active:shadow-[4px_4px_0_var(--color-fuligem)] " +
  "focus-visible:outline-2 focus-visible:outline-offset-[3px] focus-visible:outline-vermelho " +
  "motion-reduce:transition-none motion-reduce:hover:translate-x-0 motion-reduce:hover:translate-y-0 " +
  "min-h-[76px]";

function ConteudoDoBloco({
  indice,
  rotulo,
  apoio,
  hospedeiro,
  t,
}: {
  indice: number;
  rotulo: string;
  apoio: string;
  /** Vazio quando o destino é interno. */
  hospedeiro: string;
  t: TextosDaBio;
}) {
  return (
    <>
      {/* O número em Martian Mono é a "etiqueta" do §4.2: dado, não frase.
          Dá ritmo à pilha e ancora o olho na varredura vertical rápida. */}
      <span
        aria-hidden
        className="font-dado text-[13px] leading-none tracking-[0.06em] text-fuligem-55 transition-colors duration-[320ms] group-hover:text-vermelho group-active:text-vermelho motion-reduce:transition-none"
      >
        {String(indice).padStart(2, "0")}
      </span>

      <span className="min-w-0 flex-1">
        <span className="block text-[16px] font-semibold leading-snug">
          {rotulo}
        </span>
        <span className="mt-1 block text-[13px] leading-snug text-fuligem-55">
          {apoio}
        </span>
        {hospedeiro ? (
          /* O aviso VISÍVEL de que o clique sai daqui. Em Martian Mono porque é
             um endereço, não uma frase — e em barro para se distinguir do texto
             de apoio sem virar alerta (6,4:1 sobre cal, §4.1). */
          <span className="mt-1.5 block font-dado text-[11px] leading-snug tracking-[0.04em] text-barro">
            {hospedeiro} · {t.saiDoSite}
          </span>
        ) : null}
      </span>

      {hospedeiro ? <SetaExterna /> : <SetaInterna />}
    </>
  );
}

export default async function PaginaBio({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const locale: Locale = comoLocale((await params).locale);
  const t = textosDaBio(locale);

  return (
    /* Superfície kraft em toda a página: é a etiqueta colada no saco de juta.
       Também é o que separa a /bio do resto do site sem mudar de identidade —
       o cabeçalho e o rodapé da loja continuam em volta. */
    <div className="bg-juta-claro">
      <div className="mx-auto w-full max-w-[27rem] px-4 py-10 md:py-14">
        {/* ── Cabeça: a marca ──────────────────────────── superfície fuligem */}
        <header className="relative overflow-hidden border border-fuligem bg-fuligem px-5 pb-14 pt-8 text-center text-cal">
          <Serra
            className="absolute inset-x-0 bottom-0 h-10 w-full text-fuligem-80"
            strokeWidth={1.5}
            preenchido
          />
          {/* O lockup é ativo da marca, nunca reescrito em fonte (§4.2). A
              largura fica cravada porque o PNG é 3508px de largura e, sem ela,
              o flex do bloco se dimensiona pela imagem e estoura o documento em
              360px. `invert` porque o ativo é preto sobre transparente. */}
          <h1 className="relative mx-auto w-[168px]">
            <Image
              src="/logo-canastra.png"
              alt="Café Canastra"
              width={3508}
              height={2481}
              sizes="168px"
              priority
              className="h-auto w-full invert"
            />
          </h1>
          <p className="relative mt-3 text-[14px] leading-snug text-cal/80">
            {t.tagline}
          </p>
          <p className="relative mt-2 font-dado text-[11px] tracking-[0.06em] text-juta">
            {t.local}
          </p>
        </header>

        {/* ── Os quatro caminhos ───────────────────────────────────────────── */}
        <nav aria-label={t.chamadaPrincipais} className="mt-8">
          <h2 className="text-[12px] font-semibold uppercase tracking-[0.18em] text-fuligem-80">
            {t.chamadaPrincipais}
          </h2>
          <ul className="mt-3 grid gap-3">
            {PRINCIPAIS.map((link, i) => {
              const texto = t.principais[link.id];
              const hospedeiro = hospedeiroDe(link.href);
              const corpo = (
                <ConteudoDoBloco
                  indice={i + 1}
                  rotulo={texto.rotulo}
                  apoio={texto.apoio}
                  hospedeiro={hospedeiro}
                  t={t}
                />
              );

              return (
                <li key={link.id}>
                  {ehExterno(link.href) ? (
                    /* `noopener noreferrer`: sem ele a página aberta recebe
                       `window.opener` e pode reescrever esta aba. O leitor de
                       tela ganha o aviso que o vidente lê no domínio. */
                    <a
                      href={link.href}
                      target="_blank"
                      rel="noopener noreferrer"
                      className={BLOCO}
                    >
                      {corpo}
                      <span className="sr-only">
                        ({t.abreEmOutraAba})
                      </span>
                    </a>
                  ) : (
                    <Link href={href(locale, link.href)} className={BLOCO}>
                      {corpo}
                    </Link>
                  )}
                </li>
              );
            })}
          </ul>
        </nav>

        {/* ── Os atalhos de marca ──────────────────────────────────────────── */}
        <nav aria-label={t.chamadaSecundarios} className="mt-10">
          <div className="flex items-center gap-3">
            <h2 className="text-[12px] font-semibold uppercase tracking-[0.18em] text-fuligem-80">
              {t.chamadaSecundarios}
            </h2>
            <span aria-hidden className="h-px flex-1 bg-fuligem-20" />
          </div>
          {/* Três colunas já em 360px: os rótulos são curtos e a fileira única
              mantém a página inteira acima da dobra no telefone. */}
          <ul className="mt-3 grid grid-cols-3 gap-2">
            {SECUNDARIOS.map((link) => (
              <li key={link.id}>
                <Link
                  href={href(locale, link.href)}
                  className="flex min-h-[56px] w-full items-center justify-center border border-fuligem-20 bg-cal-puro px-2 py-3 text-center text-[13px] font-semibold leading-snug transition-[box-shadow,border-color,transform] duration-[320ms] ease-canastra hover:-translate-x-1 hover:-translate-y-1 hover:border-fuligem hover:shadow-[4px_4px_0_var(--color-fuligem)] focus-visible:outline-2 focus-visible:outline-offset-[3px] focus-visible:outline-vermelho active:-translate-x-1 active:-translate-y-1 active:border-fuligem active:shadow-[4px_4px_0_var(--color-fuligem)] motion-reduce:transition-none"
                >
                  {t.secundarios[link.id]}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      </div>
    </div>
  );
}
