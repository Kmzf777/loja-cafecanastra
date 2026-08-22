import type { ReactNode } from "react";
import { MolduraDaLoja } from "../../moldura-da-loja";
import { ehLocale } from "@/lib/i18n/tipos";
import { notFound } from "next/navigation";

/**
 * Layout do grupo de rotas da vitrine — a metade traduzida do site.
 *
 * O grupo `(vitrine)` não altera a URL: `app/[locale]/(vitrine)/page.tsx`
 * serve `/pt`, e o middleware faz `/` cair ali por rewrite. A moldura em si
 * (cabeçalho, rodapé, grão, sacola, o reset do Tailwind) vive em
 * `app/moldura-da-loja.tsx`, porque o grupo `(transacional)` precisa dela
 * igual — o comentário lá explica por que não dá para ser um layout só.
 *
 * A VALIDAÇÃO DO LOCALE MORA AQUI, e não num `app/[locale]/layout.tsx` extra,
 * porque este é o layout mais alto que TODA rota traduzida atravessa. O
 * segmento `[locale]` casa com qualquer string: sem este `notFound()`,
 * `/qualquer-coisa/cafes` responderia 200 com a página em português e cada
 * página passaria a ter infinitos endereços — o oposto do que o hreflang
 * tenta resolver.
 */
export default async function LayoutDaVitrine({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!ehLocale(locale)) notFound();

  return <MolduraDaLoja locale={locale}>{children}</MolduraDaLoja>;
}
