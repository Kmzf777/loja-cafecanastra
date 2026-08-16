"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { Botao } from "@/components/ui/Botao";
import { entrar, recuperarSessao, destinoDe } from "@/lib/conta/sessao";

/**
 * Entrar — a rota que faltava.
 *
 * O guard do painel (`legacy/routes/AdminRoutes.jsx`) sempre redirecionou para
 * `/account/login`, mas essa rota nunca existiu no Next: quem abria /dashboard
 * sem sessão caía na tela de erro do react-router ("Unexpected Application
 * Error / 404 Not Found"). Está registrado como pendência 2 em
 * docs/superpowers/plans/baseline-painel.md.
 *
 * `?de=` carrega para onde voltar depois de entrar, para quem chegou aqui
 * empurrado pelo guard não ser jogado numa página genérica.
 */

const CAMPO =
  "h-12 w-full border border-fuligem-20 bg-cal-puro px-3 text-[15px] " +
  "focus-visible:outline-2 focus-visible:outline-offset-[3px] focus-visible:outline-vermelho";
const ROTULO =
  "block text-[11px] font-semibold uppercase tracking-[0.14em] text-fuligem-55";

function FormularioDeLogin() {
  const router = useRouter();
  const params = useSearchParams();
  const de = params.get("de");

  const [email, setEmail] = useState("");
  const [senha, setSenha] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  const [conferindo, setConferindo] = useState(true);

  // Quem já tem sessão válida não precisa ver o formulário de novo.
  useEffect(() => {
    let vivo = true;
    recuperarSessao()
      .then((sessao) => {
        if (!vivo) return;
        if (sessao) router.replace(de || destinoDe(sessao.usuario));
        else setConferindo(false);
      })
      .catch(() => vivo && setConferindo(false));
    return () => {
      vivo = false;
    };
  }, [router, de]);

  async function aoEnviar(evento: React.FormEvent) {
    evento.preventDefault();
    setErro(null);
    setEnviando(true);
    try {
      const { usuario } = await entrar(email, senha);
      // Navegação "dura" de propósito quando o destino é o painel: /dashboard é
      // uma ilha client-only com o seu próprio react-router, e o push do Next
      // não faz o AuthProvider de lá reavaliar a sessão.
      const destino = de || destinoDe(usuario);
      if (destino.startsWith("/dashboard")) window.location.assign(destino);
      else router.replace(destino);
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Não foi possível entrar.");
      setEnviando(false);
    }
  }

  if (conferindo) {
    return (
      <p role="status" className="text-[15px] text-fuligem-55">
        Conferindo sua sessão…
      </p>
    );
  }

  return (
    <form onSubmit={aoEnviar} className="max-w-[38ch]">
      <div>
        <label htmlFor="email" className={ROTULO}>
          E-mail
        </label>
        <input
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className={`${CAMPO} mt-1.5`}
        />
      </div>

      <div className="mt-5">
        <label htmlFor="senha" className={ROTULO}>
          Senha
        </label>
        <input
          id="senha"
          name="senha"
          type="password"
          autoComplete="current-password"
          required
          value={senha}
          onChange={(e) => setSenha(e.target.value)}
          className={`${CAMPO} mt-1.5`}
        />
      </div>

      {/* §11: o erro explica e resolve. A mensagem vem do backend — "Email ou
          senha inválidos", "Sua conta ainda não foi ativada" — e não é
          substituída por um genérico. */}
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
        {enviando ? "Entrando…" : "Entrar"}
      </Botao>

      <p className="mt-6 text-[14px] text-fuligem-55">
        Esqueceu a senha? Fale com a gente pelo{" "}
        <Link href="/#contato" className="text-vermelho underline underline-offset-4">
          contato
        </Link>
        .
      </p>
    </form>
  );
}

export default function PaginaLogin() {
  return (
    <div className="mx-auto max-w-[1440px] px-4 py-16 md:px-10 md:py-24">
      <p className="text-[12px] font-semibold uppercase tracking-[0.18em] text-fuligem-55">
        Sua conta
      </p>
      <h1 className="mt-5 font-titulo text-[clamp(2.5rem,5vw,3.75rem)] leading-[1] tracking-[-0.015em]">
        Entrar
      </h1>

      <div className="mt-10">
        {/* useSearchParams exige Suspense num componente de rota estática. */}
        <Suspense
          fallback={
            <p role="status" className="text-[15px] text-fuligem-55">
              Carregando…
            </p>
          }
        >
          <FormularioDeLogin />
        </Suspense>
      </div>
    </div>
  );
}
