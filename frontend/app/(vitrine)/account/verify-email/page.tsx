"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { BotaoLink } from "@/components/ui/Botao";
import { API_BASE } from "@/lib/conta/sessao";

/**
 * Confirmação de e-mail.
 *
 * `signUp` já enviava este link — `${URL_LOJA}/account/verify-email?token=…` —
 * e a página não existia: quem se cadastrava recebia o e-mail, clicava e caía
 * num 404. Como o login recusa conta não verificada ("Sua conta ainda não foi
 * ativada"), ninguém que se cadastrasse pela loja conseguiria entrar. O par
 * cadastro/ativação estava quebrado nos dois lados.
 */

type Estado = "conferindo" | "ok" | "falhou";

function Confirmacao() {
  const token = useSearchParams().get("token");
  const [estado, setEstado] = useState<Estado>("conferindo");
  const [mensagem, setMensagem] = useState("");

  useEffect(() => {
    if (!token) {
      setEstado("falhou");
      setMensagem("Este link não traz um código de confirmação.");
      return;
    }

    let vivo = true;
    (async () => {
      try {
        const csrf = await fetch(`${API_BASE}/csrf-token`, {
          credentials: "include",
        })
          .then((r) => (r.ok ? r.json() : null))
          .then((d) => d?.csrfToken)
          .catch(() => null);

        const res = await fetch(`${API_BASE}/auth/verify-email`, {
          method: "POST",
          credentials: "include",
          headers: {
            "Content-Type": "application/json",
            ...(csrf ? { "X-CSRF-Token": csrf } : {}),
          },
          body: JSON.stringify({ token }),
        });

        const dados = await res.json().catch(() => ({}));
        if (!vivo) return;

        if (res.ok) {
          setEstado("ok");
        } else {
          setEstado("falhou");
          setMensagem(dados.message || "Não foi possível confirmar o e-mail.");
        }
      } catch {
        if (vivo) {
          setEstado("falhou");
          setMensagem("Não foi possível falar com o servidor.");
        }
      }
    })();

    return () => {
      vivo = false;
    };
  }, [token]);

  if (estado === "conferindo") {
    return (
      <p role="status" className="text-[15px] text-fuligem-55">
        Confirmando seu e-mail…
      </p>
    );
  }

  if (estado === "ok") {
    return (
      <div className="max-w-[52ch]">
        <p className="text-[17px] leading-relaxed text-fuligem-80">
          E-mail confirmado. Sua conta está ativa — pode entrar e fazer o
          primeiro pedido.
        </p>
        <div className="mt-8">
          <BotaoLink href="/account/login" variante="primario">
            Entrar
          </BotaoLink>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-[52ch]">
      {/* §11: o erro explica e resolve. "Token inválido ou já utilizado" quase
          sempre significa que a conta JÁ foi ativada — dizer isso evita um
          contato de suporte. */}
      <p role="alert" className="text-[17px] leading-relaxed text-fuligem-80">
        {mensagem} Se você já confirmou antes, a conta provavelmente está ativa:
        tente entrar normalmente.
      </p>
      <div className="mt-8">
        <BotaoLink href="/account/login" variante="secundario">
          Ir para entrar
        </BotaoLink>
      </div>
    </div>
  );
}

export default function PaginaConfirmarEmail() {
  return (
    <div className="mx-auto max-w-[1440px] px-4 py-16 md:px-10 md:py-24">
      <p className="text-[12px] font-semibold uppercase tracking-[0.18em] text-fuligem-55">
        Sua conta
      </p>
      <h1 className="mt-5 font-titulo text-[clamp(2.5rem,5vw,3.75rem)] leading-[1] tracking-[-0.015em]">
        Confirmar e-mail
      </h1>

      <div className="mt-10">
        <Suspense
          fallback={
            <p role="status" className="text-[15px] text-fuligem-55">
              Carregando…
            </p>
          }
        >
          <Confirmacao />
        </Suspense>
      </div>
    </div>
  );
}
