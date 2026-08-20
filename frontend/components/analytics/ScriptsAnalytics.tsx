"use client";

import Script from "next/script";
import { useEffect, useState } from "react";
import { EVENTO_CONSENTIMENTO, lerConsentimento } from "@/lib/analytics";

/**
 * Carrega o GA4 — e só nas condições em que ele PODE existir:
 *
 *  1. `NEXT_PUBLIC_GA4_ID` definida no build. Sem a variável, a loja não tem
 *     medição nenhuma e este componente é um `null` sem custo (decisão 5 do
 *     plano mestre: integração desligada por padrão).
 *  2. O visitante ACEITOU medição no BannerCookies. A Política de privacidade
 *     promete que "cookies de medição só são usados se você aceitar" — carregar
 *     o gtag antes disso quebraria a promessa em texto público.
 *
 * A escolha chega por dois caminhos: `localStorage` na montagem (visitas
 * seguintes) e o evento `cookies:consentimento` (a própria visita em que a
 * pessoa aceitou — o script entra na hora, sem recarregar a página).
 *
 * Os eventos de comércio (lib/analytics.ts) chamam `window.gtag` e são no-op
 * enquanto ele não existir, então nenhum dado escapa antes do consentimento.
 *
 * PENDÊNCIA REGISTRADA (fora do território desta onda): o CSP em
 * next.config.mjs ainda não libera https://www.googletagmanager.com no
 * script-src nem https://*.google-analytics.com no connect-src. A Onda 2-D,
 * que edita o CSP para o SDK do Mercado Pago, precisa acrescentar as duas.
 */

const GA4_ID = process.env.NEXT_PUBLIC_GA4_ID;

export function ScriptsAnalytics() {
  const [consentiu, setConsentiu] = useState(false);

  useEffect(() => {
    const atualizar = () => setConsentiu(lerConsentimento() === "aceito");
    atualizar();
    window.addEventListener(EVENTO_CONSENTIMENTO, atualizar);
    return () => window.removeEventListener(EVENTO_CONSENTIMENTO, atualizar);
  }, []);

  if (!GA4_ID || !consentiu) return null;

  return (
    <>
      <Script
        src={`https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(GA4_ID)}`}
        strategy="afterInteractive"
      />
      <Script id="ga4-init" strategy="afterInteractive">
        {`window.dataLayer = window.dataLayer || [];
window.gtag = function gtag(){ window.dataLayer.push(arguments); };
window.gtag('js', new Date());
window.gtag('config', ${JSON.stringify(GA4_ID)});`}
      </Script>
    </>
  );
}
