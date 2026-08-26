"use client";

import { useState } from "react";
import { Botao } from "../ui/Botao";
import { sair } from "@/lib/conta/sessao";

/**
 * Sair do painel — a queixa mais barata de resolver do mapa do terreno.
 *
 * O PAINEL LEGADO NÃO TEM ESTE BOTÃO. Quem entra nele só sai fechando a aba ou
 * indo à loja procurar o "Sair" de lá — o que, num computador compartilhado do
 * escritório, significa que a sessão do gestor fica aberta. Não é um detalhe de
 * conveniência; é a diferença entre encerrar e abandonar.
 *
 * POR QUE NÃO É O `(publico)/entrar/BotaoDeSaida.tsx`, QUE JÁ EXISTE. Aquele
 * monta o `<Botao>` da VITRINE, cujo anel de foco é `outline-vermelho`
 * (`components/ui/Botao.tsx:15`). Dentro do painel isso é proibido pelo R21: o
 * vermelho aqui significa erro e ação destrutiva, e um anel vermelho em todo
 * controle focado é exatamente como se ensina o gestor a não acreditar mais nos
 * erros de verdade. O que os dois compartilham é o que importa — a função
 * `sair()` de `lib/conta/sessao.ts`, uma só, com o `scope: "local"` que não
 * derruba a sessão da pessoa no celular.
 *
 * NÃO IMPORTE `lib/conta/painel-servidor` AQUI, nem para pegar a constante da
 * rota de entrada. Aquele módulo puxa `next/headers` por baixo (via
 * `lib/supabase/servidor`), e trazê-lo para um `"use client"` quebra o build com
 * "You're importing a component that needs next/headers". O caminho literal
 * abaixo é o preço, e é o mesmo preço que o botão da tela de entrada paga.
 *
 * A NAVEGAÇÃO É DURA de propósito. `router.refresh()` revalidaria o Server
 * Component, mas manteria montada a subárvore de cliente — inclusive um menu
 * lateral inteiro de uma sessão que acabou de deixar de existir. Recarregar é a
 * garantia de que o que aparece depois de sair é o estado real.
 */
export function BotaoDeSair() {
  const [saindo, setSaindo] = useState(false);

  async function aoClicar() {
    setSaindo(true);
    await sair();
    window.location.replace("/dashboard/entrar");
  }

  return (
    <>
      {/* `aria-busy` + região viva SEPARADA, e não `aria-live` no próprio
          botão: um botão `disabled` sai da árvore de acessibilidade em vários
          leitores, e o anúncio pendurado nele não sairia. */}
      <Botao
        variante="secundaria"
        onClick={aoClicar}
        disabled={saindo}
        aria-busy={saindo}
      >
        {saindo ? "Saindo…" : "Sair"}
      </Botao>
      <p role="status" className="sr-only">
        {saindo ? "Saindo da conta…" : ""}
      </p>
    </>
  );
}
