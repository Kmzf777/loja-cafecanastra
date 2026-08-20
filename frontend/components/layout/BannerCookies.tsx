"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  EVENTO_CONSENTIMENTO,
  gravarConsentimento,
  lerConsentimento,
  type Consentimento,
} from "@/lib/analytics";

/**
 * Aviso de cookies — o que a Política de privacidade promete ("cookies de
 * medição só são usados se você aceitar no aviso que aparece na primeira
 * visita").
 *
 * Componente próprio, e não o `react-cookie-consent` que sobrou nas
 * dependências do legado: o pacote traz estilo inline fora dos tokens e mais
 * opções do que este aviso precisa. Aqui são duas escolhas e uma frase.
 *
 * "Só o essencial" NÃO é um banner de "rejeitar" escondido: as duas saídas têm
 * o mesmo tamanho e o mesmo peso visual. Sessão e sacola (localStorage)
 * funcionam nos dois casos — o que muda é só o GA4, que o ScriptsAnalytics
 * carrega apenas com a escolha "aceito".
 *
 * Acessibilidade: `role="region"` nomeada para leitores de tela acharem o
 * aviso na ordem do documento; botões reais com foco visível no padrão da
 * casa. O foco NÃO é sequestrado — o aviso não impede navegar; modal de
 * consentimento que trava a página é dark pattern.
 */
export function BannerCookies() {
  // `null` = ainda não sabemos (SSR e primeiro paint) — não renderiza nada
  // para o HTML do servidor bater com o do cliente. `"pendente"` = sem escolha
  // registrada, o aviso aparece.
  const [estado, setEstado] = useState<"pendente" | "decidido" | null>(null);

  useEffect(() => {
    // Ouvir o evento (e não só ler na montagem) é o que faz o banner
    // REAPARECER quando o "Rever cookies" da Política revoga a escolha —
    // aceitar tem de ser tão reversível quanto foi dizer sim.
    const atualizar = () =>
      setEstado(lerConsentimento() ? "decidido" : "pendente");
    atualizar();
    window.addEventListener(EVENTO_CONSENTIMENTO, atualizar);
    return () => window.removeEventListener(EVENTO_CONSENTIMENTO, atualizar);
  }, []);

  if (estado !== "pendente") return null;

  function decidir(escolha: Consentimento) {
    gravarConsentimento(escolha);
    setEstado("decidido");
  }

  return (
    <aside
      role="region"
      aria-label="Aviso de cookies"
      className="fixed inset-x-0 bottom-0 z-50 border-t border-fuligem-20 bg-cal-puro px-4 py-4 md:px-10"
      style={{ paddingBottom: "max(1rem, env(safe-area-inset-bottom))" }}
    >
      <div className="mx-auto flex max-w-[1440px] flex-wrap items-center gap-x-6 gap-y-3">
        <p className="min-w-[16rem] flex-1 text-[14px] leading-relaxed text-fuligem-80">
          Usamos cookies de medição para entender o que funciona na loja. Os
          essenciais — sessão e sacola — ficam de qualquer jeito.{" "}
          <Link
            href="/politica-de-privacidade"
            className="text-vermelho underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-[3px] focus-visible:outline-vermelho"
          >
            Política de privacidade
          </Link>
        </p>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => decidir("essencial")}
            className="h-11 rounded-bt border border-fuligem px-5 text-[12px] font-semibold uppercase tracking-[0.1em] transition-colors hover:bg-fuligem hover:text-cal focus-visible:outline-2 focus-visible:outline-offset-[3px] focus-visible:outline-vermelho"
          >
            Só o essencial
          </button>
          <button
            type="button"
            onClick={() => decidir("aceito")}
            className="h-11 rounded-bt bg-fuligem px-5 text-[12px] font-semibold uppercase tracking-[0.1em] text-cal transition-colors hover:bg-fuligem-80 focus-visible:outline-2 focus-visible:outline-offset-[3px] focus-visible:outline-vermelho"
          >
            Aceitar
          </button>
        </div>
      </div>
    </aside>
  );
}
