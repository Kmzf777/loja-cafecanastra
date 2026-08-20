"use client";

import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import type { Kit } from "@/lib/catalogo/tipos";
import {
  formatarPreco,
  precoParaLeitor,
} from "@/lib/catalogo/repositorio";
import { LINHAS } from "@/lib/catalogo/rotulos";
import { Botao } from "@/components/ui/Botao";
import { useSacola } from "@/lib/sacola/sacola";
import { eventoAddToCart } from "@/lib/analytics";

/**
 * Card de kit — a seção "Kits e caixas" da PLP.
 *
 * Os kits existiam no catálogo desde a captura da loja e não tinham NENHUMA
 * superfície de venda: `KITS` era um export que ninguém consumia. Este card os
 * põe à venda com as mesmas regras do PainelCompra da PDP:
 *
 *  - esgotado (ou sem preço na loja) aparece DESABILITADO com aviso — sumir
 *    com produto é pior do que dizer que acabou;
 *  - sem `produtoId` (API fora, vitrine de pé só com o JSON) o botão avisa em
 *    vez de fingir que guardou;
 *  - sucesso confirma no rótulo, anuncia em aria-live e dispara `add_to_cart`.
 *
 * Client component porque adicionar à sacola é estado do navegador; a lista de
 * kits em si chega pronta do Server Component da PLP.
 */

export function CardKit({ kit }: { kit: Kit }) {
  const { adicionar } = useSacola();
  const [adicionado, setAdicionado] = useState(false);
  const [erroDaSacola, setErroDaSacola] = useState<string | null>(null);

  // O timeout do "Na sacola" vive numa ref para ser cancelável: sem o clear no
  // unmount, sair da PLP dentro dos 2,5 s faria o setAdicionado disparar num
  // componente morto; e cliques seguidos empilhariam timeouts concorrentes.
  const timeoutDaConfirmacao = useRef<number | undefined>(undefined);
  useEffect(() => {
    return () => window.clearTimeout(timeoutDaConfirmacao.current);
  }, []);

  // "Café Especial Canastra X - Caixa com..." → título e complemento. O nome
  // capturado da loja embute o conteúdo depois do hífen; quebrado em dois, o
  // card lê como etiqueta em vez de frase corrida.
  const [titulo, ...resto] = kit.nome.split(" - ");
  const complemento = resto.join(" - ");

  const indisponivel = kit.estoque === 0 || kit.preco <= 0;
  const fita = LINHAS[kit.linha].corVar;

  async function aoAdicionar() {
    setErroDaSacola(null);

    if (!kit.produtoId) {
      setErroDaSacola(
        "Não conseguimos falar com a loja agora. Tente de novo em instantes.",
      );
      return;
    }

    try {
      await adicionar({
        product_id: kit.produtoId,
        name: `${titulo} — ${kit.rotuloEmbalagem}`,
        price: kit.preco / 100,
        quantity: 1,
        image: kit.imagem,
        size: kit.rotuloEmbalagem,
        // Identidade estável do funil GA4 — o begin_checkout da sacola reporta
        // este mesmo id. Ver o comentário de `sku` em lib/sacola/sacola.tsx.
        sku: kit.skuLoja,
      });
      eventoAddToCart({
        id: kit.skuLoja,
        nome: `${titulo} — ${kit.rotuloEmbalagem}`,
        precoCentavos: kit.preco,
        quantidade: 1,
      });
      setAdicionado(true);
      window.clearTimeout(timeoutDaConfirmacao.current);
      timeoutDaConfirmacao.current = window.setTimeout(
        () => setAdicionado(false),
        2500,
      );
    } catch {
      setErroDaSacola("Não foi possível adicionar à sacola.");
    }
  }

  return (
    <article className="flex h-full flex-col border border-fuligem-20 bg-cal-puro">
      {/* Fita da linha dominante — a cor vem da embalagem, nunca inventada. */}
      <span aria-hidden className="block h-1 w-full" style={{ backgroundColor: fita }} />

      <div className="flex flex-1 gap-4 p-5">
        <div className="w-24 shrink-0 sm:w-28">
          <Image
            src={kit.imagem}
            alt=""
            aria-hidden
            width={500}
            height={500}
            sizes="112px"
            className="aspect-square w-full border border-fuligem-20 object-cover"
          />
        </div>

        <div className="flex min-w-0 flex-1 flex-col">
          <h3 className="text-[17px] font-semibold leading-tight">{titulo}</h3>
          {complemento ? (
            <p className="mt-1 text-[13px] text-fuligem-55">{complemento}</p>
          ) : null}
          <p className="mt-1.5 text-[13px] text-fuligem-55">
            {kit.rotuloEmbalagem}
            {kit.unidades ? (
              <>
                <span aria-hidden> · </span>
                <span className="font-dado">{kit.unidades} unidades</span>
              </>
            ) : null}
          </p>

          <div className="mt-auto flex flex-wrap items-center justify-between gap-3 pt-4">
            {indisponivel ? (
              <span className="text-[12px] uppercase tracking-[0.14em] text-fuligem-55">
                Esgotado
              </span>
            ) : (
              <span
                className="font-dado text-[17px]"
                aria-label={precoParaLeitor(kit.preco)}
              >
                {formatarPreco(kit.preco)}
              </span>
            )}

            <Botao
              variante="primario"
              disabled={indisponivel}
              onClick={aoAdicionar}
              className="disabled:cursor-not-allowed disabled:bg-fuligem-20 disabled:text-fuligem-55"
            >
              {indisponivel
                ? "Esgotado"
                : adicionado
                  ? "Na sacola"
                  : "Adicionar à sacola"}
            </Botao>
          </div>

          <p role="status" aria-live="polite" className="sr-only">
            {adicionado ? "Kit adicionado à sacola." : ""}
          </p>

          {erroDaSacola ? (
            <p role="alert" className="mt-3 text-[14px] text-vermelho">
              {erroDaSacola}
            </p>
          ) : null}

          {indisponivel ? (
            <p role="status" className="mt-3 text-[13px] text-fuligem-55">
              Este kit está esgotado na loja. Volte em breve — a torra é semanal.
            </p>
          ) : null}
        </div>
      </div>
    </article>
  );
}
