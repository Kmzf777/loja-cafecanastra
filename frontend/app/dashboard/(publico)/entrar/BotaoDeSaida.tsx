"use client";

import { useState } from "react";
import { Botao } from "@/components/ui/Botao";
import { sair } from "@/lib/conta/sessao";

/**
 * Sair, na tela de entrada do painel.
 *
 * Existe para o caso do cliente da loja que chegou aqui logado com a conta
 * errada: sem isto, a única saída seria ir à vitrine, achar o botão de sair e
 * voltar. `sair()` é o MESMO de `lib/conta/sessao.ts` que a área da conta usa —
 * nada é reimplementado, incluindo o `scope: "local"` que não derruba a sessão
 * da pessoa no celular.
 *
 * NÃO IMPORTE `lib/conta/painel-servidor` AQUI, nem para pegar a constante da
 * rota. Aquele módulo importa `next/headers` por baixo (via
 * `lib/supabase/servidor`), e trazê-lo para um `"use client"` quebra o build com
 * "You're importing a component that needs next/headers". O caminho literal
 * abaixo é o preço, e é barato.
 *
 * A NAVEGAÇÃO É DURA de propósito. `router.refresh()` revalidaria o Server
 * Component, mas manteria montado o subtree de cliente — inclusive um estado de
 * "essa conta não é de gestor" que acabou de deixar de valer. Recarregar a
 * página é a garantia de que o que aparece depois de sair é o estado real.
 */
export function BotaoDeSaida({ rotulo = "Sair desta conta" }: { rotulo?: string }) {
  const [saindo, setSaindo] = useState(false);

  async function aoClicar() {
    setSaindo(true);
    await sair();
    window.location.replace("/dashboard/entrar");
  }

  return (
    <>
      {/* `aria-busy` + região viva separada, e não `aria-live` no botão: um
          botão `disabled` sai da árvore de acessibilidade em vários leitores, e
          o anúncio pendurado nele não sairia. */}
      <Botao
        variante="secundario"
        onClick={aoClicar}
        disabled={saindo}
        aria-busy={saindo}
        className="disabled:cursor-not-allowed disabled:border-fuligem-20 disabled:text-fuligem-55"
      >
        {saindo ? "Saindo…" : rotulo}
      </Botao>
      <p role="status" className="sr-only">
        {saindo ? "Saindo da conta…" : ""}
      </p>
    </>
  );
}
