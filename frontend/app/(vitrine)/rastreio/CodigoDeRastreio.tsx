"use client";

import { useEffect, useState } from "react";
import { Botao } from "@/components/ui/Botao";

/**
 * O código em destaque, com um jeito fácil de copiar.
 *
 * CLIENT COMPONENT SÓ POR CAUSA DO BOTÃO. Todo o resto de /rastreio é
 * servidor: nada aqui busca dado nenhum, o código chega pronto por prop.
 *
 * O CÓDIGO CONTINUA COPIÁVEL SEM JAVASCRIPT E SEM CLIPBOARD. `navigator
 * .clipboard` não existe em contexto inseguro (http) nem em navegador velho, e
 * `writeText` ainda pode ser recusada por permissão. Por isso o código é texto
 * de verdade, com `select-all`: quem cair em qualquer um desses casos toca no
 * código e ele fica selecionado inteiro. O botão é conveniência — se falhar, a
 * mensagem diz o que fazer em vez de pedir desculpa (estetica.md §11).
 *
 * `font-dado` (Martian Mono) porque estetica.md §11 é literal: "números em
 * Martian Mono, sempre" — e um código de rastreio é a etiqueta pura.
 * `break-all` porque um código de transportadora pode passar de 20 caracteres
 * e a tela pequena não pode ganhar rolagem horizontal por causa dele.
 */
export function CodigoDeRastreio({ codigo }: { codigo: string }) {
  const [estado, setEstado] = useState<"parado" | "copiado" | "falhou">("parado");

  // O rótulo do botão volta sozinho: "Copiado" preso na tela vira parte do
  // desenho e para de significar que ALGO ACONTECEU AGORA.
  useEffect(() => {
    if (estado === "parado") return;
    const relogio = setTimeout(() => setEstado("parado"), 3000);
    return () => clearTimeout(relogio);
  }, [estado]);

  async function copiar() {
    try {
      await navigator.clipboard.writeText(codigo);
      setEstado("copiado");
    } catch {
      setEstado("falhou");
    }
  }

  return (
    <div className="mt-8 border border-fuligem-20 bg-cal-puro p-6">
      <p className="font-dado text-[11px] uppercase tracking-[0.14em] text-fuligem-55">
        Código de rastreio
      </p>

      <p className="mt-3 select-all break-all font-dado text-[clamp(1.25rem,5vw,1.75rem)] leading-tight text-fuligem">
        {codigo}
      </p>

      <div className="mt-5 flex flex-wrap items-center gap-4">
        <Botao type="button" variante="secundario" onClick={copiar}>
          {estado === "copiado" ? "Código copiado" : "Copiar código"}
        </Botao>

        {/* `role="status"` para o leitor de tela anunciar sem roubar o foco. */}
        <p role="status" aria-live="polite" className="text-[14px] text-fuligem-80">
          {estado === "falhou"
            ? "Não deu para copiar aqui. Toque no código acima para selecioná-lo."
            : ""}
        </p>
      </div>
    </div>
  );
}
