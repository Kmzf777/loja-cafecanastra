"use client";

import dynamic from "next/dynamic";

/**
 * A ilha do painel legado, separada da página por uma razão só: a página virou
 * Server Component para poder conferir quem é você ANTES de emitir qualquer
 * byte disto aqui, e `dynamic(..., { ssr: false })` é API de cliente.
 *
 * `ssr: false` continua obrigatório — o que há dentro de `legacy/PainelApp` é um
 * SPA de `createBrowserRouter`, que lê `window` na montagem.
 *
 * NÃO ADICIONE VERIFICAÇÃO DE SESSÃO AQUI. Ela vive em dois lugares, e nenhum é
 * este: `lib/conta/painel-servidor.ts` (servidor, antes deste componente
 * existir) e `legacy/routes/AdminRoutes.jsx` (cliente, para a sessão que morre
 * com o painel já aberto).
 */
const PainelLegado = dynamic(() => import("@/legacy/PainelApp"), { ssr: false });

export function IlhaDoPainel() {
  return <PainelLegado />;
}
