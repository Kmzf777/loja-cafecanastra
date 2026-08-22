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
 *
 * O RÓTULO VEM POR PROP, e não de um `dicionario(locale)` aqui dentro: o
 * componente é client e existe justamente para ser minúsculo — importar o
 * dicionário dos três idiomas para uma palavra desfaria o motivo dele existir.
 * O padrão é o português para os dois chamadores que ainda não passam idioma.
 */
export function BotaoReverCookies({
  rotulo = "Rever cookies",
  className,
}: {
  rotulo?: string;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={revogarConsentimento}
      className={
        className ??
        "text-vermelho underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-[3px] focus-visible:outline-vermelho"
      }
    >
      {rotulo}
    </button>
  );
}
