"use client";

import { revogarConsentimento } from "@/lib/analytics";

/**
 * "Rever cookies" — desfaz a escolha do BannerCookies.
 *
 * Vive na Política de privacidade (a página que promete a escolha) e no rodapé
 * (seção Ajuda). É um BOTÃO, não um link: não navega — apaga a chave de
 * consentimento e dispara o evento; o banner reaparece na hora (ele ouve o
 * mesmo evento) e o gtag morre no instante, não só no próximo load. Ver
 * `revogarConsentimento` em lib/analytics.ts.
 *
 * Client component minúsculo de propósito: é a única parte com onClick, e
 * extraí-la mantém a Política e o Rodapé como Server Components.
 */
export function BotaoReverCookies({ className }: { className?: string }) {
  return (
    <button
      type="button"
      onClick={revogarConsentimento}
      className={
        className ??
        "text-vermelho underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-[3px] focus-visible:outline-vermelho"
      }
    >
      Rever cookies
    </button>
  );
}
