import type { ReactNode } from "react";
import { MolduraDaLoja } from "../moldura-da-loja";
import { LOCALE_PADRAO } from "@/lib/i18n/tipos";

/**
 * Layout do caminho de compra: sacola, checkout, conta e pedido.
 *
 * POR QUE ESTE GRUPO EXISTE FORA DO `[locale]` — é decisão do cliente, e ela
 * tem uma razão operacional (spec §1, "A fronteira, dita na cara"): o frete é
 * Melhor Envio, que só entrega no Brasil, e o pagamento é Mercado Pago BR.
 * Traduzir o checkout sem resolver esses dois seria prometer uma compra que a
 * loja não consegue entregar. Enquanto for assim, `/checkout` é pt-BR nos três
 * idiomas — e por isso `/en/checkout` nem existe como rota.
 *
 * A URL DESTAS PÁGINAS NÃO MUDOU e não pode mudar: `/sacola`, `/checkout`,
 * `/account`, `/pedido/[id]`. Elas são o que o e-mail de pedido, o retorno do
 * Mercado Pago e o link de confirmação do GoTrue já apontam.
 *
 * A moldura é a MESMA da vitrine, e de propósito: quem está pagando continua
 * no mesmo site, com o mesmo cabeçalho e a mesma sacola. O componente
 * compartilhado está em `app/moldura-da-loja.tsx`.
 */
export default function LayoutTransacional({
  children,
}: {
  children: ReactNode;
}) {
  return <MolduraDaLoja locale={LOCALE_PADRAO}>{children}</MolduraDaLoja>;
}
