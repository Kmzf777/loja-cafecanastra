"use client";

import { useEffect, useState } from "react";
import {
  FRETE_GRATIS_PADRAO_CENTAVOS,
  freteGratisMinimoCentavos,
} from "@/lib/config-loja";

/**
 * O trecho "Frete grátis acima de R$ X" da barra de aviso do Cabeçalho.
 *
 * O Cabeçalho é Server Component e fica assim (menu sem JS, §12); só este
 * <span> vira ilha client, porque o piso vem de `canastra.config_loja` via
 * GET /config e pode mudar sem deploy. O SSR e o primeiro render mostram o
 * default da migração 0009 — o mesmo texto que a barra sempre mostrou — e o
 * efeito troca pelo valor real quando a API responde (com cache de 5 min em
 * lib/config-loja.ts, então não é um fetch por navegação).
 *
 * O SEPARADOR "·" MORA AQUI DENTRO de propósito: quando o admin DESLIGA o
 * frete grátis (piso 0 no servidor), a promessa inteira some — separador
 * junto. Um "Torrado sob demanda ·" com o resto amputado denunciaria o
 * remendo.
 *
 * O RÓTULO VEM POR PROP e o VALOR continua formatado em pt-BR, e a mistura é
 * deliberada: o texto muda de idioma, mas o piso é em real e só vale para o
 * Brasil (o frete é Melhor Envio) — "Free shipping over R$ 149" diz a verdade
 * inteira; convertê-lo ou reformatá-lo para outra locale prometeria uma
 * cobrança que a loja não faz.
 */

/** 14900 → "R$ 149"; 14950 → "R$ 149,50" — a barra sempre foi curta. */
function precoCurto(centavos: number): string {
  return (centavos / 100).toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
    minimumFractionDigits: centavos % 100 === 0 ? 0 : 2,
  });
}

export function AvisoFreteGratis({ rotulo }: { rotulo: string }) {
  const [minimo, setMinimo] = useState<number | null>(
    FRETE_GRATIS_PADRAO_CENTAVOS,
  );

  useEffect(() => {
    let vivo = true;
    freteGratisMinimoCentavos().then((valor) => {
      if (vivo) setMinimo(valor);
    });
    return () => {
      vivo = false;
    };
  }, []);

  if (minimo === null) return null; // frete grátis desligado no servidor

  return (
    <>
      <span aria-hidden className="text-fuligem-55">
        ·
      </span>
      <span>
        {rotulo} {precoCurto(minimo)}
      </span>
    </>
  );
}
