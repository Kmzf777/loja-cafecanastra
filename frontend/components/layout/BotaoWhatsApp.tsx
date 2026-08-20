import { linkWhatsApp } from "@/lib/whatsapp";

/**
 * Botão flutuante de WhatsApp.
 *
 * Server Component: não há estado nenhum — o link vem pronto de
 * `lib/whatsapp.ts` (fonte única, compartilhada com o rodapé) e o botão
 * simplesmente NÃO RENDERIZA quando `NEXT_PUBLIC_WHATSAPP` está vazia
 * (integração desligada por padrão, decisão 5 do plano mestre).
 *
 * POSIÇÃO E CAMADA, medidas contra o resto da vitrine:
 *  - `bottom-20` no mobile: a barra de compra fixa da PDP (PainelCompra) ocupa
 *    o rodapé com `bottom-0 z-40` e ~72px de altura; 80px deixa o botão acima
 *    dela em vez de embaixo. No `md:` a barra não existe e o botão desce.
 *  - `z-30`: abaixo da barra de compra (z-40), do menu mobile (z-50) e do
 *    banner de cookies (z-50). O botão é conveniência, nunca pode cobrir uma
 *    ação de compra ou de consentimento.
 *
 * Estética: quadrado de raio 2px (--radius-bt) em fuligem, não a bolha verde
 * padrão — estetica.md §4.3 não tem círculo flutuante no vocabulário, e o
 * glifo em cal sobre fuligem é AAA.
 */

function GlifoWhatsApp() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden className="size-6" fill="currentColor">
      <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.297-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 0 1-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 0 1-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 0 1 2.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0 0 12.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 0 0 5.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 0 0-3.48-8.413Z" />
    </svg>
  );
}

export function BotaoWhatsApp() {
  const href = linkWhatsApp();
  if (!href) return null;

  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      aria-label="Falar com a gente no WhatsApp"
      title="Falar com a gente no WhatsApp"
      className="fixed bottom-20 right-4 z-30 flex size-12 items-center justify-center rounded-bt bg-fuligem text-cal shadow-[4px_4px_0_var(--color-fuligem-20)] transition-colors hover:bg-fuligem-80 focus-visible:outline-2 focus-visible:outline-offset-[3px] focus-visible:outline-vermelho md:bottom-6 md:right-6"
    >
      <GlifoWhatsApp />
    </a>
  );
}
