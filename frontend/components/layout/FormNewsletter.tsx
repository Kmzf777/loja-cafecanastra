"use client";

import { useState } from "react";
import { Botao } from "@/components/ui/Botao";
import { API_BASE } from "@/lib/api-base";
import type { Dicionario } from "@/lib/i18n/dicionario";

/**
 * Newsletter do rodapé (estetica.md §5.10: "quatro colunas + newsletter").
 *
 * Client component minúsculo de propósito — é a única parte do rodapé com
 * estado, e extraí-la mantém o Rodape como Server Component (mesmo padrão do
 * BotaoReverCookies).
 *
 * O POST vai para o Express (`/newsletter`), que responde `{ ok: true }` para
 * TODO e-mail válido, novo ou repetido — anti-enumeração é do servidor; aqui
 * só se mostra o obrigado. Sem promessa de frequência no texto: a loja
 * escreve quando há o que dizer, e prometer cadência viraria dívida.
 *
 * `aria-live="polite"` no estado: quem usa leitor de tela ouve o "pronto" ou
 * o erro sem precisar caçar o texto que trocou.
 */

type Estado =
  | { fase: "parado" }
  | { fase: "enviando" }
  | { fase: "obrigado" }
  | { fase: "erro"; mensagem: string };

export function FormNewsletter({ t }: { t: Dicionario["newsletter"] }) {
  const [email, setEmail] = useState("");
  const [estado, setEstado] = useState<Estado>({ fase: "parado" });

  async function assinar(evento: React.FormEvent<HTMLFormElement>) {
    evento.preventDefault();
    if (estado.fase === "enviando") return;
    setEstado({ fase: "enviando" });

    try {
      const resposta = await fetch(`${API_BASE}/newsletter`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });

      if (resposta.ok) {
        setEstado({ fase: "obrigado" });
        setEmail("");
        return;
      }
      setEstado({
        fase: "erro",
        mensagem:
          resposta.status === 400
            ? t.emailInvalido
            : t.falhou,
      });
    } catch {
      setEstado({
        fase: "erro",
        mensagem: t.falhou,
      });
    }
  }

  return (
    <div>
      <h2 className="text-[12px] font-semibold uppercase tracking-[0.14em] text-juta">
        {t.titulo}
      </h2>
      <p className="mt-4 max-w-[44ch] text-[15px] text-cal/80">
        {t.chamada}
      </p>

      {estado.fase === "obrigado" ? (
        <p aria-live="polite" className="mt-4 text-[15px] text-cal">
          {t.obrigado}
        </p>
      ) : (
        <form onSubmit={assinar} className="mt-4">
          <div className="flex max-w-[420px] flex-col gap-3 sm:flex-row">
            <label htmlFor="newsletter-email" className="sr-only">
              {t.email}
            </label>
            <input
              id="newsletter-email"
              type="email"
              required
              maxLength={254}
              autoComplete="email"
              placeholder={t.exemploDeEmail}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="h-12 w-full border border-cal/25 bg-transparent px-3 text-[15px] text-cal placeholder:text-cal/40 focus-visible:outline-2 focus-visible:outline-offset-[3px] focus-visible:outline-vermelho"
            />
            <Botao
              type="submit"
              variante="primarioEscuro"
              disabled={estado.fase === "enviando"}
              className="shrink-0 disabled:opacity-60"
            >
              {estado.fase === "enviando"
                ? t.enviando
                : t.assinar}
            </Botao>
          </div>
          <p aria-live="polite" className="mt-2 min-h-5 text-[13px] text-cal/70">
            {estado.fase === "erro" ? estado.mensagem : ""}
          </p>
        </form>
      )}
    </div>
  );
}
