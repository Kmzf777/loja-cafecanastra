"use client";

import { usePathname } from "next/navigation";
import { caminhoSemLocale, ehCaminhoTransacional } from "@/lib/i18n/rotas";
import type { Locale } from "@/lib/i18n/tipos";
import { SeletorDeIdioma } from "./SeletorDeIdioma";

/**
 * O <SeletorDeIdioma> ligado à página em que ele está.
 *
 * POR QUE ESTA CASCA EXISTE. O seletor precisa do caminho atual para que
 * trocar de idioma mantenha a página — `/en/cafes` a partir de `/cafes`, e não
 * a home em inglês. Quem renderiza o Cabeçalho é `app/moldura-da-loja.tsx`,
 * chamado por dois layouts, e LAYOUT NÃO SABE O CAMINHO: o layout raiz do App
 * Router recebe só os parâmetros dinâmicos do próprio segmento. As duas saídas
 * de servidor foram medidas e recusadas — `headers()` no layout torna a árvore
 * inteira dinâmica e mata a PDP estática, e um segundo layout raiz força
 * recarga completa de página no pulo da vitrine para o checkout (a nota longa
 * está em app/moldura-da-loja.tsx).
 *
 * Sobra o cliente. E ele custa pouco: o cabeçalho já embarca duas ilhas client
 * (<AtalhosDoCliente> e <AvisoFreteGratis>), então isto não abre um bundle
 * novo — só entra nele.
 *
 * O RISCO DE HIDRATAÇÃO QUE O PRÓPRIO <SeletorDeIdioma> DOCUMENTA ESTÁ
 * NEUTRALIZADO, e vale explicar como, porque a leitura ingênua diz o
 * contrário. O middleware serve o português por *rewrite*: a URL visível é
 * `/cafes` e a rota interna é `/pt/cafes`, e `usePathname()` pode legitimamente
 * devolver uma das duas de cada lado. Só que as duas atravessam
 * `caminhoSemLocale()` — que existe justamente para apagar o prefixo — e saem
 * como `/cafes` nos dois casos. A função que parecia um detalhe é o que torna
 * este componente determinístico.
 *
 * Sem JS a marcação renderizada no servidor continua correta e clicável: o
 * `usePathname()` roda no SSR também.
 */
export function SeletorDeIdiomaDaPagina({
  id,
  locale,
  variante,
  className,
}: {
  id: string;
  locale: Locale;
  variante?: "painel" | "barra";
  className?: string;
}) {
  const atual = caminhoSemLocale(usePathname() || "/");

  /**
   * No caminho de compra o seletor manda para a HOME do idioma, não para a
   * página atual. Sacola, checkout, conta e pedido vivem fora do `[locale]` e
   * são pt-BR por decisão do cliente, então `href("en", "/checkout")` devolve
   * `/checkout` — os três links apontariam para o mesmo lugar e clicar em EN
   * não faria nada. Mandar para `/en` é a única saída honesta: leva a pessoa
   * para o idioma que ela pediu, na única superfície que o fala.
   */
  const caminho = ehCaminhoTransacional(atual) ? "/" : atual;

  return (
    <SeletorDeIdioma
      id={id}
      locale={locale}
      caminho={caminho}
      variante={variante}
      className={className}
    />
  );
}
