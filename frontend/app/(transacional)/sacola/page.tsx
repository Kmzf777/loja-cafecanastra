"use client";

import Link from "next/link";
import { useSacola } from "@/lib/sacola/sacola";
import { formatarPreco } from "@/lib/catalogo/repositorio";
import { precoExibido } from "@/lib/catalogo/promocao";
import { BotaoLink } from "@/components/ui/Botao";
import { Preco } from "@/components/ui/Preco";
import { BarraFreteGratis } from "@/components/layout/BarraFreteGratis";
import { eventoBeginCheckout } from "@/lib/analytics";

/**
 * Sacola.
 *
 * Client component porque a sacola de quem não está logado vive no
 * localStorage — não existe do lado do servidor. O total mostrado aqui é
 * informativo: quem soma para valer é o checkout, que relê preço e estoque do
 * banco antes de cobrar (PaymentController).
 */
export default function PaginaSacola() {
  const { itens, totalCentavos, alterarQuantidade, remover, sincronizando } =
    useSacola();

  return (
    <div className="mx-auto max-w-[1440px] px-4 py-16 md:px-10 md:py-24">
      <p className="text-[12px] font-semibold uppercase tracking-[0.18em] text-fuligem-55">
        Seu pedido
      </p>
      <h1 className="mt-5 font-titulo text-[clamp(2.5rem,5vw,3.75rem)] leading-[1] tracking-[-0.015em]">
        Sacola
      </h1>

      {itens.length === 0 ? (
        // §11: tela vazia é convite, nunca "0 itens".
        <div className="mt-10 max-w-[52ch]">
          <p className="text-[17px] leading-relaxed text-fuligem-80">
            Sua sacola está vazia. O café é torrado depois que o pedido entra —
            escolha a moagem e a gente moi na hora.
          </p>
          <div className="mt-8">
            <BotaoLink href="/cafes" variante="primario">
              Ver os cafés
            </BotaoLink>
          </div>
        </div>
      ) : (
        <div className="mt-10 grid gap-12 lg:grid-cols-[1fr_360px]">
          <ul className="border-t border-fuligem-20">
            {itens.map((item) => (
              <li
                key={item.product_id}
                className="flex gap-4 border-b border-fuligem-20 py-5"
              >
                {/* <img> e não next/image, de propósito.
                    A URL da imagem vem do BANCO e pode ser de qualquer origem:
                    a da própria loja (produtos semeados) ou a da Cloudinary
                    (produtos que o admin cadastrou pelo painel). O otimizador
                    do next/image recusa host que não esteja em `remotePatterns`
                    e a miniatura renderiza em branco — foi o que aconteceu aqui.
                    Liberar hosts arbitrários no otimizador seria pior: vira
                    proxy de imagem aberto. Para uma miniatura de 88px, a
                    otimização não compensa esse risco.
                    width/height explícitos preservam a reserva de layout. */}
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={item.image}
                  alt=""
                  aria-hidden
                  width={88}
                  height={88}
                  loading="lazy"
                  decoding="async"
                  className="size-[88px] shrink-0 border border-fuligem-20 bg-cal-puro object-cover"
                />

                <div className="min-w-0 flex-1">
                  <p className="text-[15px] font-semibold leading-snug">
                    {item.name}
                  </p>
                  {item.moagem ? (
                    <p className="mt-1 text-[13px] text-fuligem-55">
                      Moagem: {item.moagem}
                    </p>
                  ) : null}

                  <div className="mt-3 flex flex-wrap items-center gap-4">
                    <div className="flex items-center border border-fuligem-20">
                      <button
                        onClick={() =>
                          alterarQuantidade(
                            item.product_id,
                            Math.max(1, Number(item.quantity) - 1),
                          )
                        }
                        aria-label={`Diminuir quantidade de ${item.name}`}
                        className="h-10 w-10 text-[18px] leading-none hover:bg-fuligem-20/40"
                      >
                        −
                      </button>
                      <span className="w-10 text-center font-dado text-[14px]">
                        {item.quantity}
                      </span>
                      <button
                        onClick={() =>
                          alterarQuantidade(
                            item.product_id,
                            Number(item.quantity) + 1,
                          )
                        }
                        aria-label={`Aumentar quantidade de ${item.name}`}
                        className="h-10 w-10 text-[18px] leading-none hover:bg-fuligem-20/40"
                      >
                        +
                      </button>
                    </div>

                    <button
                      onClick={() => remover(item.product_id)}
                      className="text-[13px] text-vermelho underline underline-offset-4"
                    >
                      Remover
                    </button>
                  </div>
                </div>

                {/* O "de/por" da LINHA já vem multiplicado pela quantidade: é
                    o que aquela linha soma no resumo, e um preço unitário aqui
                    obrigaria a pessoa a fazer a conta de cabeça para conferir o
                    subtotal. `price` está em reais e o promocional em centavos
                    — a unidade está no nome dos dois, e é por isso que a
                    travessia é explícita. */}
                <Preco
                  className="shrink-0 justify-end"
                  tamanho="compacto"
                  preco={precoExibido({
                    preco:
                      Math.round(Number(item.price) * 100) *
                      Number(item.quantity),
                    ...(item.precoPromocionalCentavos === undefined
                      ? {}
                      : {
                          precoPromocional:
                            item.precoPromocionalCentavos *
                            Number(item.quantity),
                        }),
                  })}
                />
              </li>
            ))}
          </ul>

          <aside className="h-fit border border-fuligem-20 p-6">
            <h2 className="text-[12px] font-semibold uppercase tracking-[0.14em] text-fuligem-55">
              Resumo
            </h2>

            <div className="mt-5 flex items-baseline justify-between border-b border-fuligem-20 pb-4">
              <span className="text-[15px]">Subtotal</span>
              <span className="font-dado text-[19px]">
                {formatarPreco(totalCentavos)}
              </span>
            </div>

            {/* O empurrão de ticket médio: quanto falta para o frete grátis.
                O piso vem do servidor (GET /config) — a barra some sozinha se
                o admin desligar a regra. */}
            <BarraFreteGratis className="mt-4" />

            <p className="mt-4 text-[13px] text-fuligem-55">
              O frete é calculado no checkout, a partir do seu CEP.
            </p>

            <div className="mt-6">
              {/* begin_checkout ANTES da navegação: o clique é o momento em
                  que a intenção existe. No-op sem consentimento/GA4, e não
                  atrasa nada — o gtag enfileira e a navegação segue. */}
              <BotaoLink
                href="/checkout"
                variante="primario"
                className="w-full"
                onClick={() =>
                  eventoBeginCheckout(
                    itens.map((i) => ({
                      // O MESMO id do add_to_cart (skuLoja), senão o funil do
                      // GA4 não liga os dois eventos. Fallback para o id de
                      // banco: item antigo no localStorage não carrega `sku`.
                      id: i.sku ?? i.product_id,
                      nome: i.name,
                      // O preço EFETIVO, a mesma base do `add_to_cart` — ver
                      // `usar-adicionar.ts`. Dois eventos do mesmo carrinho com
                      // bases diferentes viram uma queda de conversão fantasma
                      // no relatório.
                      precoCentavos:
                        i.precoPromocionalCentavos ??
                        Math.round(Number(i.price) * 100),
                      quantidade: Number(i.quantity),
                      variante: i.moagem,
                    })),
                  )
                }
              >
                Fechar pedido
              </BotaoLink>
            </div>

            <p className="mt-4 text-[13px] text-fuligem-55">
              {sincronizando ? "Salvando sua sacola…" : "Torramos na terça, enviamos na quarta."}
            </p>

            <p className="mt-6 text-[13px]">
              <Link
                href="/cafes"
                className="text-vermelho underline underline-offset-4"
              >
                Continuar escolhendo
              </Link>
            </p>
          </aside>
        </div>
      )}
    </div>
  );
}
