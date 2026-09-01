"use client";

import { useEffect } from "react";
import { capturarOrigem } from "@/lib/atribuicao/armazenamento";

/**
 * DE ONDE VEIO ESTA VISITA — capturado no primeiro contato, guardado junto da
 * sacola, enviado no corpo do checkout.
 *
 * Não desenha nada. Existe porque as dez colunas de atribuição de `pedidos`
 * (0033) estavam vazias desde que foram criadas, e o dado é PERECÍVEL: não há
 * como reconstruir depois de onde veio uma venda, nem pelo Mercado Pago nem
 * pelo Bling.
 *
 * ---------------------------------------------------------------------------
 * POR QUE UM EFEITO DE CLIENTE, E NÃO `searchParams` NA PÁGINA
 * ---------------------------------------------------------------------------
 *
 * A home é SSG: `generateStaticParams()` mais `export const revalidate = 3600`
 * fazem as três homes saírem do build. QUALQUER `cookies()`, `headers()` ou
 * `searchParams` introduzido nela a derruba para render sob demanda — uma ida
 * ao servidor por visita, na página mais visitada da loja. E `useSearchParams()`
 * também não serve: no App Router ele obriga a árvore acima a virar dinâmica ou
 * a nascer dentro de um `<Suspense>`, e a fronteira certa não é o layout
 * inteiro por causa de um efeito que não pinta pixel nenhum.
 *
 * `window.location` dentro de `useEffect` não passa por nenhum desses
 * mecanismos: a URL já está no navegador, e o efeito roda depois da hidratação,
 * quando a página estática já foi entregue. Se `/[locale]` sair do `next build`
 * como `ƒ` em vez de `●`, esta é a primeira coisa a conferir.
 *
 * ---------------------------------------------------------------------------
 * UMA VEZ POR MONTAGEM, E É ISSO QUE SIGNIFICA "PRIMEIRO CONTATO"
 * ---------------------------------------------------------------------------
 *
 * O componente vive na moldura da loja, que sobrevive à navegação entre as
 * páginas de um mesmo grupo de rota — então o efeito roda na primeira página da
 * visita, que é a única em que o `utm_*` existe na URL. Nas montagens seguintes
 * (o pulo da vitrine para a sacola, por exemplo) a URL não tem marcador nenhum
 * e `decidirGravacao` devolve "não toque", preservando a campanha que trouxe a
 * pessoa. A regra inteira está em `lib/atribuicao/atribuicao.ts`, testada
 * sozinha.
 *
 * NÃO DEPENDE DE CONSENTIMENTO DE COOKIE, e a decisão é da 0033, não desta
 * tela: aquela migração tratou `gclid`/`fbclid` como dado pessoal e escolheu o
 * mecanismo de REDAÇÃO NA EXCLUSÃO (art. 18) em vez do de consentimento. Um
 * segundo mecanismo aqui contradiria a decisão registrada e esvaziaria em
 * silêncio o relatório de mídia paga. Ver o relatório da Onda 6.
 */
export function CapturaDeOrigem() {
  useEffect(() => {
    capturarOrigem({
      url: window.location.href,
      // String vazia quando a pessoa digitou o endereço — `lerChegada` já trata
      // vazio como ausência.
      referrer: document.referrer,
      agoraMs: Date.now(),
    });
  }, []);

  return null;
}
