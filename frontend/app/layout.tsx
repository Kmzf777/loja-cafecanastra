import type { Metadata } from "next";
import type { ReactNode } from "react";
import { Archivo, Martian_Mono } from "next/font/google";
import { urlDoSite } from "@/lib/seo/jsonld";
import "./globals.css";

const archivo = Archivo({
  subsets: ["latin", "latin-ext"],
  variable: "--fonte-ui",
  display: "swap",
  preload: true,
});

const martianMono = Martian_Mono({
  subsets: ["latin"],
  variable: "--fonte-dado",
  display: "swap",
  preload: false,
});

/**
 * `metadataBase` resolve as URLs relativas de Open Graph. Sem ele o Next avisa
 * no build e cai em http://localhost:3000 — o que faz o card compartilhado no
 * WhatsApp e no Instagram apontar para a máquina de quem compilou, sem imagem.
 *
 * `urlDoSite()` é a MESMA fonte do sitemap, do robots e do JSON-LD — uma
 * origem só, para os metadados nunca desmentirem o que o sitemap anuncia.
 */
export const metadata: Metadata = {
  metadataBase: new URL(urlDoSite()),
  title: {
    default: "Café Canastra",
    template: "%s — Café Canastra",
  },
  /**
   * "Torrado sob demanda, desde 1985" DIZIA UMA COISA QUE NÃO ACONTECEU: a
   * família Boaventura planta café desde 1985 (em Patrocínio, no Cerrado), a
   * Serra da Canastra veio em 2008 e a torrefação própria é de 2016. A mesma
   * frase foi corrigida no herói da home e em /a-serra; ela sobrevivia aqui,
   * que é justamente o texto que o Google mostra no resultado de busca.
   */
  description:
    "Café de origem única da Serra da Canastra, torrado sob demanda em lotes pequenos. Café da família desde 1985.",
  openGraph: {
    type: "website",
    siteName: "Café Canastra",
    /**
     * NÃO EXISTE `locale` AQUI, E A AUSÊNCIA É A CORREÇÃO.
     *
     * Este layout envolve o site inteiro e não recebe o `[locale]` — ele está
     * um nível abaixo, pelo motivo que a nota do `lang` explica adiante. Um
     * valor fixo neste ponto não é um padrão inofensivo: é uma AFIRMAÇÃO sobre
     * páginas que existem em três idiomas, e o Next só a substitui na rota que
     * declara o próprio bloco `openGraph` (ele troca o objeto inteiro, não
     * funde campo a campo). O `pt_BR` que morava nesta linha era o que fazia
     * `/en` e `/es` anunciarem ao Facebook e ao WhatsApp que eram páginas em
     * português — em sete das dez rotas traduzidas, todas as que não
     * declaravam o bloco.
     *
     * Quem sabe o idioma é a rota, e é ela que declara: `openGraphDaPagina()`
     * de lib/i18n/rotas.ts, uma tabela só para os três valores.
     */
    // Imagem padrao dos cards compartilhados: o heroi da home (1280x720, a
    // proporcao mais proxima do 1.91:1 que os crawlers pedem — o
    // bannerdesktop.jpg e 1600x500, esticado demais para card). Paginas com
    // imagem propria (a PDP) sobrepoem esta no seu generateMetadata.
    images: [
      {
        url: "/imagem-banner.jpg",
        width: 1280,
        height: 720,
        alt: "Café Canastra — Serra da Canastra, Minas Gerais",
      },
    ],
  },
  robots: { index: true, follow: true },
};

/**
 * Layout raiz — envolve TUDO: a vitrine traduzida em `app/[locale]/`, o caminho
 * de compra em `app/(transacional)/` e o painel de gestão em `/dashboard`.
 * Nada de estilo visual entra aqui: as classes de fonte apenas expoem
 * --fonte-ui / --fonte-dado no <html>; quem as aplica e `.vitrine`, em
 * app/globals.css. Ver o comentario no topo daquele arquivo.
 *
 * POR QUE O `lang` DAQUI É FIXO EM pt-BR, MESMO COM O SITE EM TRÊS IDIOMAS.
 *
 * O layout raiz é o único que pode renderizar `<html>`, e ele recebe apenas os
 * parâmetros dinâmicos do PRÓPRIO caminho — que não tem nenhum. O `[locale]`
 * está um nível abaixo e não chega aqui. As duas saídas conhecidas custam mais
 * do que resolvem:
 *
 *   - ler `headers()` aqui tornaria TODA a árvore dinâmica, e a PDP estática é
 *     a rota que justifica o projeto (estetica.md §7.3);
 *   - múltiplos layouts raiz, um por grupo, forçam RECARGA COMPLETA DE PÁGINA
 *     ao atravessar de um grupo para o outro — ou seja, no pulo da vitrine
 *     para a sacola e o checkout, no meio do caminho que traz o dinheiro.
 *
 * Então pt-BR fica como o idioma do DOCUMENTO — que é a verdade para o painel,
 * para todo o caminho de compra e para a vitrine em português — e o idioma da
 * superfície traduzida é declarado um nível abaixo, no elemento que envolve
 * todo o conteúdo visível (`app/moldura-da-loja.tsx`). Leitor de tela usa o
 * `lang` mais interno; buscador usa o `hreflang` de `lib/i18n/rotas.ts`.
 */
export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="pt-BR" className={`${archivo.variable} ${martianMono.variable}`}>
      <body>{children}</body>
    </html>
  );
}
