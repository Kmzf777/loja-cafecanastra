"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Botao, BotaoLink } from "@/components/ui/Botao";
import { API_BASE } from "@/lib/conta/sessao";

/**
 * Redefinir senha.
 *
 * O backend já mandava este link por e-mail — `${URL_LOJA}/account/reset-password?token=…`
 * — mas a página nunca existiu: quem pedia recuperação de senha recebia o
 * e-mail, clicava e caía num 404. O fluxo estava quebrado de ponta a ponta, e o
 * único caminho de volta para uma conta sem senha era mexer no banco.
 *
 * As regras da senha são as mesmas que o backend valida em
 * `resetPasswordValidationRules` — repetidas aqui só para a pessoa saber delas
 * ANTES de enviar, em vez de descobrir pelo erro. Quem valida de verdade
 * continua sendo o servidor.
 */

const CAMPO =
  "h-12 w-full border border-fuligem-20 bg-cal-puro px-3 text-[15px] " +
  "focus-visible:outline-2 focus-visible:outline-offset-[3px] focus-visible:outline-vermelho";
const ROTULO =
  "block text-[11px] font-semibold uppercase tracking-[0.14em] text-fuligem-55";

const REGRAS: [RegExp, string][] = [
  [/.{8,}/, "pelo menos 8 caracteres"],
  [/[A-Z]/, "uma letra maiúscula"],
  [/[a-z]/, "uma letra minúscula"],
  [/[0-9]/, "um número"],
  [/[!@#$%^&*(),.?":{}|<>]/, "um caractere especial"],
];

function Formulario() {
  const router = useRouter();
  const token = useSearchParams().get("token");

  const [senha, setSenha] = useState("");
  const [confirmacao, setConfirmacao] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  const [pronto, setPronto] = useState(false);

  const pendentes = REGRAS.filter(([re]) => !re.test(senha)).map(([, t]) => t);

  if (!token) {
    return (
      <div className="max-w-[52ch]">
        <p className="text-[17px] leading-relaxed text-fuligem-80">
          Este link não traz um código de recuperação. Peça um novo e-mail de
          redefinição e use o link mais recente — cada pedido invalida o
          anterior.
        </p>
        <div className="mt-8">
          <BotaoLink href="/account/login" variante="secundario">
            Voltar para entrar
          </BotaoLink>
        </div>
      </div>
    );
  }

  if (pronto) {
    return (
      <div className="max-w-[52ch]">
        <p className="text-[17px] leading-relaxed text-fuligem-80">
          Senha alterada. Todas as sessões abertas foram encerradas — entre de
          novo com a senha nova.
        </p>
        <div className="mt-8">
          <BotaoLink href="/account/login" variante="primario">
            Entrar
          </BotaoLink>
        </div>
      </div>
    );
  }

  async function aoEnviar(evento: React.FormEvent) {
    evento.preventDefault();
    setErro(null);

    if (senha !== confirmacao) {
      setErro("As duas senhas não são iguais.");
      return;
    }
    if (pendentes.length) {
      setErro(`A senha ainda precisa de: ${pendentes.join(", ")}.`);
      return;
    }

    setEnviando(true);
    try {
      const csrf = await fetch(`${API_BASE}/csrf-token`, {
        credentials: "include",
      })
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => d?.csrfToken)
        .catch(() => null);

      const res = await fetch(`${API_BASE}/auth/reset-password`, {
        method: "POST",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
          ...(csrf ? { "X-CSRF-Token": csrf } : {}),
        },
        body: JSON.stringify({ token, newPassword: senha }),
      });

      const dados = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(dados.message || "Não foi possível redefinir a senha.");
      }

      setPronto(true);
      router.prefetch("/account/login");
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Erro ao redefinir a senha.");
    } finally {
      setEnviando(false);
    }
  }

  return (
    <form onSubmit={aoEnviar} className="max-w-[38ch]">
      <div>
        <label htmlFor="senha" className={ROTULO}>
          Nova senha
        </label>
        <input
          id="senha"
          type="password"
          autoComplete="new-password"
          required
          value={senha}
          onChange={(e) => setSenha(e.target.value)}
          className={`${CAMPO} mt-1.5`}
        />
      </div>

      <div className="mt-5">
        <label htmlFor="confirmacao" className={ROTULO}>
          Repita a nova senha
        </label>
        <input
          id="confirmacao"
          type="password"
          autoComplete="new-password"
          required
          value={confirmacao}
          onChange={(e) => setConfirmacao(e.target.value)}
          className={`${CAMPO} mt-1.5`}
        />
      </div>

      {/* O que falta, enquanto falta — em vez de reprovar depois de enviar. */}
      {senha && pendentes.length ? (
        <p className="mt-4 text-[13px] text-fuligem-55">
          Ainda falta: {pendentes.join(", ")}.
        </p>
      ) : null}

      {erro ? (
        <p
          role="alert"
          className="mt-5 border-l-2 border-vermelho bg-cal-puro py-2 pl-3 text-[14px]"
        >
          {erro}
        </p>
      ) : null}

      <Botao
        type="submit"
        variante="primario"
        disabled={enviando}
        className="mt-7 w-full disabled:cursor-not-allowed disabled:bg-fuligem-20 disabled:text-fuligem-55"
      >
        {enviando ? "Salvando…" : "Salvar nova senha"}
      </Botao>
    </form>
  );
}

export default function PaginaRedefinirSenha() {
  return (
    <div className="mx-auto max-w-[1440px] px-4 py-16 md:px-10 md:py-24">
      <p className="text-[12px] font-semibold uppercase tracking-[0.18em] text-fuligem-55">
        Sua conta
      </p>
      <h1 className="mt-5 font-titulo text-[clamp(2.5rem,5vw,3.75rem)] leading-[1] tracking-[-0.015em]">
        Nova senha
      </h1>

      <div className="mt-10">
        <Suspense
          fallback={
            <p role="status" className="text-[15px] text-fuligem-55">
              Carregando…
            </p>
          }
        >
          <Formulario />
        </Suspense>
      </div>
    </div>
  );
}
