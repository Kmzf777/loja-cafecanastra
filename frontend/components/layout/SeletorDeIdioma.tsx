import type { ReactNode } from "react";
import Link from "next/link";
import { LOCALES, type Locale } from "@/lib/i18n/tipos";
import { href } from "@/lib/i18n/rotas";

/**
 * Seletor de idioma — estetica.md §4.1, §4.3 e §10.
 *
 * POR QUE NÃO É UMA FILEIRA DE BANDEIRAS REDONDAS E COLORIDAS: a estética
 * desta loja é filete de 1px, raio zero e monoespaçada — o §4.3 diz que o raio
 * é zero porque "o selo da embalagem é um retângulo reto", e o §4.1 fixa uma
 * paleta de quatro cores (fuligem, cal, juta, vermelho). Três discos coloridos
 * de 24px seriam o único elemento arredondado e a única cor fora da paleta em
 * todo o cabeçalho — chamariam mais atenção que a sacola.
 *
 * A saída é a que o §4.2 já dá: o código do idioma em Martian Mono (a fonte de
 * "dados e códigos" — PT/EN/ES é literalmente um código), e a bandeira reduzida
 * a um retângulo de 18×12 contido por um filete, do tamanho de um carimbo de
 * passaporte. A bandeira vira confirmação, não ilustração; a única cor do
 * componente vive dentro de um filete.
 *
 * O estado ativo inverte a célula para fuligem/cal — a mesma tinta da barra de
 * aviso do cabeçalho. Vermelho fica reservado ao foco, porque o idioma atual
 * não é um CTA: os CTAs são os outros dois.
 *
 * MOBILE-FIRST: o padrão é a variante "painel", desenhada para viver DENTRO do
 * acordeão de menu, onde há largura sobrando. Em 360px o cabeçalho já carrega
 * logo, sacola e o botão de menu — um quarto elemento ali espremeria os três.
 * A variante "barra" só existe para o cabeçalho de desktop, a partir de `md`.
 *
 * SEM DESLOCAMENTO SÓLIDO NO HOVER: o §4.4 reserva a sombra de carimbo
 * (`4px 4px 0`) a cards clicáveis. Aqui as células dividem borda; um
 * deslocamento de 4px cairia por cima da célula vizinha.
 */

/**
 * Endônimos: cada idioma se nomeia na própria língua. Não é falta de tradução —
 * é o que um seletor de idioma deve fazer, porque quem procura "Español" não
 * sabe necessariamente ler "Espanhol". De quebra, o componente não depende do
 * dicionário (`lib/i18n/dicionario.ts`), que é de outro dono.
 *
 * `tag` é a etiqueta BCP 47 que vai em `lang` e `hrefLang`. O português é
 * `pt-BR` porque é o que o estetica.md §10 fixa para o `<html lang>` — o site
 * fala o português do Brasil, não o de Portugal.
 */
const IDIOMAS: Record<Locale, { codigo: string; nome: string; tag: string }> = {
  pt: { codigo: "PT", nome: "Português", tag: "pt-BR" },
  en: { codigo: "EN", nome: "English", tag: "en" },
  es: { codigo: "ES", nome: "Español", tag: "es" },
};

/**
 * A única palavra de interface do componente. Fica aqui, e não no dicionário,
 * porque o seletor precisa dela nos três idiomas ao mesmo tempo e sempre — ele
 * é o componente cujo assunto É o idioma. Três palavras não justificam um
 * acoplamento a um arquivo que outro agente preenche.
 */
const ROTULO: Record<Locale, string> = {
  pt: "Idioma",
  en: "Language",
  es: "Idioma",
};

/**
 * Bandeiras em SVG inline, sem biblioteca de ícone.
 *
 * Todas no mesmo retângulo de 18×12 (3:2): a estética é de grade, e três chips
 * de proporções diferentes lado a lado quebrariam o alinhamento. É a
 * normalização que qualquer conjunto de ícones de bandeira faz.
 *
 * O desenho para propositalmente onde 12px de altura ainda lê: o Brasil não
 * ganha faixa nem estrelas, e a Espanha não ganha brasão. Nessa escala, o
 * detalhe vira sujeira — e o §4.2 já reprova "degradação que vira sujeira".
 */
function Bandeira({ locale, id }: { locale: Locale; id: string }) {
  if (locale === "pt") {
    return (
      <Chip nome="pt">
        <rect width="18" height="12" fill="#009739" />
        <path d="M9 1.4 16.4 6 9 10.6 1.6 6Z" fill="#FEDD00" />
        <circle cx="9" cy="6" r="2.5" fill="#002776" />
      </Chip>
    );
  }

  if (locale === "es") {
    return (
      <Chip nome="es">
        <rect width="18" height="12" fill="#AA151B" />
        <rect y="3" width="18" height="6" fill="#F1BF00" />
      </Chip>
    );
  }

  // A Union Jack é a única que precisa de recorte: as diagonais são traços de
  // canto a canto e a espessura delas transborda o retângulo. O id do clipPath
  // carrega o `id` da instância porque o cabeçalho renderiza o seletor duas
  // vezes (painel de menu e barra de desktop) — dois clipPath com o mesmo id no
  // mesmo documento fazem o segundo SVG recortar pelo primeiro.
  const recorte = `${id}-recorte-en`;
  return (
    <Chip nome="en">
      <clipPath id={recorte}>
        <rect width="18" height="12" />
      </clipPath>
      <g clipPath={`url(#${recorte})`}>
        <rect width="18" height="12" fill="#012169" />
        <path d="M0 0 L18 12 M18 0 L0 12" stroke="#FFFFFF" strokeWidth="2.6" />
        <path d="M0 0 L18 12 M18 0 L0 12" stroke="#C8102E" strokeWidth="1.4" />
        <path d="M9 0 V12 M0 6 H18" stroke="#FFFFFF" strokeWidth="4" />
        <path d="M9 0 V12 M0 6 H18" stroke="#C8102E" strokeWidth="2.2" />
      </g>
    </Chip>
  );
}

/** O filete que contém a cor. É ele que faz a bandeira caber na página. */
function Chip({
  nome,
  children,
}: {
  nome: string;
  children: ReactNode;
}) {
  return (
    <span className="block border border-fuligem-20">
      <svg
        viewBox="0 0 18 12"
        aria-hidden
        data-bandeira={nome}
        className="block h-3 w-[18px]"
      >
        {children}
      </svg>
    </span>
  );
}

export function SeletorDeIdioma({
  locale,
  id,
  caminho = "/",
  variante = "painel",
  className = "",
}: {
  /** Locale em vigor na página. */
  locale: Locale;
  /**
   * Distingue as instâncias no mesmo documento — mesmo motivo do `id` do
   * `FormBusca` no Cabecalho. Aqui ele também namespaceia o clipPath da
   * Union Jack.
   */
  id: string;
  /**
   * Caminho atual **sem** prefixo de locale (`/cafes`, não `/en/cafes`), para
   * que trocar de idioma mantenha a página. O padrão é a home.
   *
   * POR QUE PROP, E NÃO `usePathname()`: o middleware serve o português por
   * *rewrite* — a URL visível é `/cafes` e a rota interna é `/pt/cafes`. Um
   * `usePathname()` no cliente leria uma das duas e o servidor a outra, o que
   * é divergência de hidratação exatamente no elemento que muda a URL. Como
   * prop, o valor é o mesmo dos dois lados, e o cabeçalho continua sem JS.
   */
  caminho?: string;
  /** "painel" vive dentro do acordeão de menu; "barra", no cabeçalho de `md`. */
  variante?: "painel" | "barra";
  className?: string;
}) {
  const ehPainel = variante === "painel";
  const idDoRotulo = `${id}-rotulo`;

  return (
    <div
      className={
        ehPainel
          ? `border-b border-fuligem-20 px-5 py-6 ${className}`.trimEnd()
          : className || undefined
      }
    >
      {/* No painel o rótulo é visível e usa o mesmo tom das legendas do menu.
          Na barra ele só existe para o leitor de tela — sem ele a lista de
          três siglas não se anuncia como sendo de idioma. */}
      <p
        id={idDoRotulo}
        className={
          ehPainel
            ? "font-dado text-[11px] uppercase tracking-[0.1em] text-fuligem-55"
            : "sr-only"
        }
      >
        {ROTULO[locale]}
      </p>

      {/* `-ml-px` colapsa as bordas vizinhas num filete só: três células
          encostadas leem como uma tira carimbada, não como três botões. */}
      <ul
        aria-labelledby={idDoRotulo}
        className={ehPainel ? "mt-3 flex" : "flex"}
      >
        {LOCALES.map((alvo) => {
          const idioma = IDIOMAS[alvo];
          const ativo = alvo === locale;

          return (
            <li
              key={alvo}
              className={ehPainel ? "-ml-px flex-1 first:ml-0" : "-ml-px first:ml-0"}
            >
              <Link
                href={href(alvo, caminho)}
                hrefLang={idioma.tag}
                lang={idioma.tag}
                aria-label={idioma.nome}
                aria-current={ativo ? "true" : undefined}
                // Trocar de idioma é raro; deixar o Next pré-carregar as três
                // rotas ao entrar em qualquer página é banda jogada fora.
                prefetch={false}
                className={[
                  "flex flex-col items-center justify-center gap-1 border transition-colors",
                  // Alvo de toque: 44px é o piso do §10, e ele vale nas duas
                  // variantes — no painel a célula cresce para 56px porque ali
                  // ela convive com linhas de menu de 64px. Largura e altura
                  // saem juntas de um ramo só: `w-full` e `w-11` no mesmo
                  // elemento seriam duas regras de mesma especificidade, e
                  // quem venceria é a ordem da folha do Tailwind, não a ordem
                  // desta string.
                  ehPainel ? "h-14 w-full min-w-11" : "h-11 w-11",
                  ativo
                    ? "border-fuligem bg-fuligem text-cal"
                    : "border-fuligem-20 bg-cal-puro text-fuligem-55 hover:border-fuligem hover:text-fuligem",
                  "focus-visible:outline-2 focus-visible:outline-offset-[3px] focus-visible:outline-vermelho",
                ].join(" ")}
              >
                <Bandeira locale={alvo} id={id} />
                {/* A sigla é decorativa para o leitor de tela: o nome por
                    extenso já está no aria-label, e "PT" seria soletrado. */}
                <span
                  aria-hidden
                  className="font-dado text-[10px] leading-none tracking-[0.08em]"
                >
                  {idioma.codigo}
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
