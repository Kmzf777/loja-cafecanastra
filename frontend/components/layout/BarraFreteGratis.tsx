"use client";

import { useEffect, useState } from "react";
import { useSacola } from "@/lib/sacola/sacola";
import { formatarPreco } from "@/lib/catalogo/repositorio";
import { freteGratisMinimoCentavos } from "@/lib/config-loja";

/**
 * Barra de progresso do frete grátis — sacola e resumo do checkout.
 *
 * "Faltam R$ 23 para o frete grátis" é o empurrão de ticket médio mais barato
 * que existe, mas SÓ se for verdade: o piso vem do MESMO GET /config que o
 * servidor usa para zerar o frete (decisão 3 do plano mestre), então a barra e
 * a cobrança não podem divergir por mais que o cache de 5 min do módulo.
 *
 * TRÊS AUSÊNCIAS deliberadas:
 *  - sacola vazia → nada (a promessa sem contexto é ruído);
 *  - piso ainda não carregado → nada (mostrar o default e trocar o número na
 *    frente do cliente parece erro de preço);
 *  - frete grátis desligado no servidor (piso 0) → nada, porque prometer
 *    seria mentir.
 *
 * O texto vive num role="status": quem usa leitor de tela ouve a meta mudar
 * quando adiciona um item, sem precisar procurar a barra.
 *
 * `descontoCentavos`: o servidor compara o piso com o subtotal DESCONTADO
 * (ShippingController abate o cupom antes do teste) — a barra faz a MESMA
 * conta, senão ela diria "garantido" num carrinho que o cupom derrubou para
 * baixo do piso. A sacola não tem cupom e usa o default 0; o checkout passa o
 * desconto aplicado.
 */
export function BarraFreteGratis({
  className = "",
  descontoCentavos = 0,
}: {
  className?: string;
  descontoCentavos?: number;
}) {
  const { itens, totalCentavos } = useSacola();
  // undefined = ainda perguntando; null = desligado no servidor.
  const [minimo, setMinimo] = useState<number | null | undefined>(undefined);

  useEffect(() => {
    let vivo = true;
    freteGratisMinimoCentavos().then((valor) => {
      if (vivo) setMinimo(valor);
    });
    return () => {
      vivo = false;
    };
  }, []);

  if (minimo == null || itens.length === 0) return null;

  const subtotal = Math.max(0, totalCentavos - descontoCentavos);
  const faltam = Math.max(0, minimo - subtotal);
  const progresso = Math.min(100, Math.round((subtotal / minimo) * 100));

  return (
    <div className={className}>
      <p role="status" className="text-[13px] leading-snug">
        {faltam > 0 ? (
          <>
            Faltam <span className="font-dado">{formatarPreco(faltam)}</span>{" "}
            para o frete grátis.
          </>
        ) : (
          <span className="font-semibold">Frete grátis garantido.</span>
        )}
      </p>
      <div aria-hidden className="mt-2 h-1 w-full bg-fuligem-20">
        <div
          className="h-full bg-vermelho transition-[width] duration-[320ms] ease-canastra"
          style={{ width: `${progresso}%` }}
        />
      </div>
    </div>
  );
}
