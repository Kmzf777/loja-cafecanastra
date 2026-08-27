import type { ReactNode } from "react";
import { Cabecalho } from "@/components/layout/Cabecalho";
import { Rodape } from "@/components/layout/Rodape";
import { BannerCookies } from "@/components/layout/BannerCookies";
import { BotaoWhatsApp } from "@/components/layout/BotaoWhatsApp";
import { ScriptsAnalytics } from "@/components/analytics/ScriptsAnalytics";
import { CapturaDeOrigem } from "@/components/analytics/CapturaDeOrigem";
import { Grao } from "@/components/ui/Grao";
import { ProvedorDaSacola } from "@/lib/sacola/sacola";
import { LOCALE_PADRAO, TAG_BCP47, type Locale } from "@/lib/i18n/tipos";
import { dicionario } from "@/lib/i18n/dicionario";
import {
  organizationJsonLd,
  serializarJsonLd,
  websiteJsonLd,
} from "@/lib/seo/jsonld";

/**
 * A moldura da loja: cabeçalho, rodapé, grão de papel, sacola e o reset do
 * Tailwind. Tudo que é comum às duas metades do site.
 *
 * POR QUE ISTO NÃO É UM `layout.tsx`, E SIM UM COMPONENTE CHAMADO POR DOIS
 * LAYOUTS: a loja tem dois grupos de rota irmãos e em níveis diferentes —
 * `app/[locale]/(vitrine)/`, que é traduzido, e `app/(transacional)/`, que é
 * pt-BR por decisão do cliente e por isso vive FORA do `[locale]`. Não existe
 * um layout do App Router que envolva os dois sem envolver também
 * `/dashboard`, que não pode receber nada disto (ver o comentário do reset,
 * abaixo). Duplicar a moldura nos dois grupos resolveria hoje e divergiria no
 * primeiro item novo do cabeçalho; um componente só não diverge.
 *
 * O RESET NÃO PODE SUBIR PARA O <body> EM app/layout.tsx: aquele layout também
 * envolve /dashboard, onde vive o painel legado em styled-components, que
 * depende dos defaults do navegador para títulos, botões e links. É por isso
 * que a classe `.vitrine` — que liga o reset definido em app/globals.css —
 * mora aqui, no elemento mais alto que NÃO alcança o painel.
 *
 * JSON-LD DE ORGANIZATION/WEBSITE FICA AQUI, e não no layout raiz, pelo mesmo
 * motivo: quem quer rich results é a loja — o painel em /dashboard não tem
 * nada a anunciar a crawler. Product e Breadcrumb ficam na PDP, que é quem os
 * conhece.
 */
export function MolduraDaLoja({
  locale,
  children,
}: {
  /**
   * O idioma desta metade do site.
   *
   * `lang` VAI AQUI, E NÃO NO <html> DE app/layout.tsx, e o motivo é uma
   * limitação real do App Router: o layout raiz é único (é ele que renderiza
   * `<html>` e `<body>`) e recebe apenas os parâmetros dinâmicos do PRÓPRIO
   * caminho — que não tem nenhum. As duas saídas conhecidas para pôr o locale
   * lá custam caro demais:
   *
   *   - `headers()` no layout raiz tornaria TODA a árvore dinâmica, e a PDP
   *     estática é a rota que justifica o projeto (spec §7.3 do estetica.md);
   *   - múltiplos layouts raiz (um por grupo) forçam RECARGA COMPLETA DE
   *     PÁGINA ao atravessar de um grupo para o outro — ou seja, exatamente no
   *     pulo da vitrine para a sacola e o checkout, no meio do caminho que
   *     traz o dinheiro.
   *
   * O que se perde é pequeno e está medido: o `<html lang>` continua `pt-BR`,
   * e todo o conteúdo visível fica dentro deste elemento com o `lang` correto.
   * O leitor de tela usa o `lang` mais interno, que é este; o buscador usa o
   * `hreflang` de `lib/i18n/rotas.ts`, que está completo e recíproco. O dia em
   * que o caminho de compra for traduzido, tudo passa a viver sob `[locale]` e
   * o `<html lang>` volta a ser o lugar certo.
   */
  locale: Locale;
  children: ReactNode;
}) {
  const d = dicionario(locale);

  return (
    // O provedor da sacola envolve só a loja, não o painel: /dashboard tem o
    // próprio conjunto de contexts legados e não precisa de carrinho.
    <ProvedorDaSacola>
      <div
        lang={TAG_BCP47[locale]}
        className="vitrine flex min-h-screen flex-col"
      >
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            __html: serializarJsonLd(organizationJsonLd()),
          }}
        />
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            __html: serializarJsonLd(websiteJsonLd(locale)),
          }}
        />
        <Grao />
        {/* O idioma desce por prop do cabeçalho ao rodapé: os dois montam
            TODOS os `href` por `lib/i18n/rotas` e leem os rótulos do
            dicionário. Sem isto a moldura seria a única parte do site que
            continua em português dentro de `/en` — e, pior, o menu levaria o
            visitante de volta ao português no primeiro clique. */}
        <Cabecalho locale={locale} />

        {/* ── A fronteira do i18n, dita na cara ──────────────────────────────
            Só aparece em inglês e espanhol, e é a única coisa que muda de
            estrutura entre os idiomas. Sacola, checkout, conta e e-mails são
            pt-BR porque o frete é Melhor Envio (só Brasil) e o pagamento é
            Mercado Pago BR — avisar antes é mais honesto do que deixar a
            pessoa descobrir no meio do pagamento (spec §1).

            SUPERFÍCIE KRAFT (`juta-claro`) COM TINTA FULIGEM: o estetica.md
            §4.1 proíbe texto claro sobre juta (2,2:1). É também a única faixa
            kraft acima da dobra, o que a separa do cabeçalho em Cal sem
            precisar de cor de alerta — não é erro, é informação.

            MOBILE-FIRST: em 360px as duas frases empilham; a partir de `md`,
            onde há largura, viram uma linha só. */}
        {locale !== LOCALE_PADRAO ? (
          <aside
            aria-label={d.compra.avisoTitulo}
            className="border-b border-fuligem-20 bg-juta-claro"
          >
            <p className="mx-auto flex max-w-[1440px] flex-col gap-0.5 px-4 py-3 text-[13px] leading-snug md:flex-row md:items-baseline md:gap-2 md:px-10">
              <strong className="font-semibold text-fuligem">
                {d.compra.avisoTitulo}
              </strong>
              <span className="text-fuligem-80">{d.compra.avisoTexto}</span>
            </p>
          </aside>
        ) : null}

        <main className="flex-1">{children}</main>
        <Rodape locale={locale} />
        {/* Conveniencias fixas da moldura: o botao so existe com a env de
            WhatsApp; o GA4 so carrega com env definida E consentimento do
            banner — ver os comentarios de cada componente.

            O `locale` desce até o botão de WhatsApp pelo mesmo motivo que
            desce até o cabeçalho e o rodapé: o nome acessível dele é o único
            texto que ele tem, e ele acompanha /en e /es como qualquer outra
            peça fixa. */}
        <BotaoWhatsApp locale={locale} />
        <BannerCookies locale={locale} />
        <ScriptsAnalytics />
        {/* De onde veio esta visita. Não pinta nada e não depende de
            consentimento — é a moldura da LOJA, então a captura acontece tanto
            na vitrine quanto na sacola e no checkout, que é onde a origem
            precisa estar viva na hora de fechar o pedido. Um efeito de cliente
            e nada mais: `searchParams` ou `useSearchParams` aqui derrubariam as
            três homes de SSG para render sob demanda. */}
        <CapturaDeOrigem />
      </div>
    </ProvedorDaSacola>
  );
}
