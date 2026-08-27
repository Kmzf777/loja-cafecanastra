"use client";

import { useEffect, useRef, useState } from "react";
import { useSacola } from "./sacola";
import { eventoAddToCart } from "../analytics";

/**
 * A REGRA DE ADICIONAR À SACOLA, NUM LUGAR SÓ.
 *
 * Ela morava inteira dentro de `CardKit.tsx`. Quando a home passou a vender
 * SKU avulso, o `CardProduto` precisou exatamente da mesma regra — e copiá-la
 * teria criado a SEGUNDA CÓPIA de uma regra que decide se a loja cobra certo:
 * teto por estoque, acumulado na sacola, o que fazer quando a API está fora.
 * Duas cópias divergem, e a que diverge em silêncio é a que cobra errado.
 *
 * O QUE DECIDE ESTÁ FORA DO HOOK, em `tetoDeAdicao` e `decidirAdicao`. A suíte
 * roda em `environment: "node"`, sem DOM: um hook não é testável aqui, mas
 * função pura é. O que sobrou dentro do hook é fiação de estado — e fiação sem
 * regra não é onde o dinheiro se perde.
 */

/** Acima de 20 é pedido de atacado, e atacado não passa por carrinho. */
const TETO_ABSOLUTO = 20;

/**
 * Quanto deste item cabe na sacola.
 *
 * Com `produtoId` o banco respondeu e o estoque é real. Sem ele a vitrine está
 * de pé só com o JSON versionado, cujo número pode ser o de ontem — então vale
 * o teto de sempre, e o servidor reconfere preço e estoque antes de cobrar.
 */
export function tetoDeAdicao(estoque: number, temProdutoId: boolean): number {
  if (!temProdutoId || estoque <= 0) return TETO_ABSOLUTO;
  return Math.min(TETO_ABSOLUTO, estoque);
}

export type Decisao = { acao: "adicionar" | "no-teto" | "sem-loja" };

/**
 * O TETO VEM ANTES DO `produtoId`, e a ordem é a mensagem.
 *
 * Quem já encheu a sacola precisa ouvir "chegou no limite". Se o `produtoId`
 * fosse conferido primeiro, essa pessoa ouviria "não deu para falar com a
 * loja" e recarregaria a página à toa, para bater no mesmo teto.
 */
export function decidirAdicao({
  jaNaSacola,
  teto,
  temProdutoId,
}: {
  jaNaSacola: number;
  teto: number;
  temProdutoId: boolean;
}): Decisao {
  if (jaNaSacola >= teto) return { acao: "no-teto" };
  if (!temProdutoId) return { acao: "sem-loja" };
  return { acao: "adicionar" };
}

export type ItemParaSacola = {
  produtoId: string | undefined;
  skuLoja: string;
  /** Em português e sempre — fica gravado e vira dimensão de relatório. */
  nomeNaSacola: string;
  /** Em português e sempre, pelo mesmo motivo. */
  rotuloGravado: string;
  precoCentavos: number;
  /**
   * O preço já com a promoção ativa, em centavos — ausente quando não há
   * campanha. Vai para a sacola AO LADO de `precoCentavos`, nunca no lugar
   * dele: ver `ItemDaSacola.precoPromocionalCentavos`.
   */
  precoPromocionalCentavos?: number;
  estoque: number;
  imagem: string;
};

/**
 * O estado de um botão "Adicionar à sacola".
 *
 * `erro` e `noTeto` são coisas DIFERENTES de propósito: erro é falha (a loja
 * não respondeu, não dá para comprar aqui) e vai em `role="alert"`; bater no
 * teto não é erro, é o estoque real, e vai discreto em `role="status"`. Ler os
 * dois com a mesma voz treinaria a pessoa a ignorar o que importa.
 */
export function useAdicionarNaSacola(item: ItemParaSacola) {
  const { adicionar, itens } = useSacola();
  const [adicionado, setAdicionado] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [noTeto, setNoTeto] = useState(false);

  /**
   * O timeout do "Na sacola" vive numa ref para ser cancelável: sem o clear no
   * unmount, sair da página dentro dos 2,5 s dispararia `setAdicionado` num
   * componente morto, e cliques seguidos empilhariam timeouts concorrentes.
   */
  const timeoutDaConfirmacao = useRef<number | undefined>(undefined);
  useEffect(() => {
    return () => window.clearTimeout(timeoutDaConfirmacao.current);
  }, []);

  const jaNaSacola = Number(
    itens.find((i) => i.product_id === item.produtoId)?.quantity ?? 0,
  );
  const teto = tetoDeAdicao(item.estoque, Boolean(item.produtoId));

  async function aoAdicionar(mensagens: { semLoja: string; falhou: string }) {
    setErro(null);
    const { acao } = decidirAdicao({
      jaNaSacola,
      teto,
      temProdutoId: Boolean(item.produtoId),
    });

    if (acao === "no-teto") {
      setNoTeto(true);
      return;
    }
    setNoTeto(false);

    if (acao === "sem-loja") {
      setErro(mensagens.semLoja);
      return;
    }

    try {
      await adicionar({
        product_id: item.produtoId as string,
        name: item.nomeNaSacola,
        price: item.precoCentavos / 100,
        quantity: 1,
        image: item.imagem,
        size: item.rotuloGravado,
        // Identidade estável do funil GA4 — o begin_checkout da sacola
        // reporta este mesmo id.
        sku: item.skuLoja,
        ...(item.precoPromocionalCentavos === undefined
          ? {}
          : { precoPromocionalCentavos: item.precoPromocionalCentavos }),
      });
      eventoAddToCart({
        id: item.skuLoja,
        nome: item.nomeNaSacola,
        // O VALOR DO FUNIL É O PREÇO EFETIVO, não o de catálogo: o GA4 mede
        // receita, e um `add_to_cart` a preço cheio seguido de um `purchase`
        // com desconto faz o relatório acusar uma queda de conversão que é só
        // a promoção da própria loja. `begin_checkout`, na página da sacola,
        // usa a mesma base — senão os dois eventos discordariam do mesmo
        // carrinho.
        precoCentavos: item.precoPromocionalCentavos ?? item.precoCentavos,
        quantidade: 1,
      });
      setAdicionado(true);
      window.clearTimeout(timeoutDaConfirmacao.current);
      timeoutDaConfirmacao.current = window.setTimeout(
        () => setAdicionado(false),
        2500,
      );
    } catch {
      setErro(mensagens.falhou);
    }
  }

  return { adicionado, erro, noTeto, aoAdicionar };
}
