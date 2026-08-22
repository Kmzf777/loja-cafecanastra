"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { Botao } from "@/components/ui/Botao";
import {
  CODIGO_EMAIL_NAO_CONFIRMADO,
  ErroDeLogin,
  entrar,
  recuperarSessao,
  destinoDe,
  destinoSeguro,
} from "@/lib/conta/sessao";
import { reenviarConfirmacao } from "@/lib/conta/cadastro";

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
 *
 * O QUE MUDOU COM O GoTrue: a autenticação inteira vive em `lib/conta/sessao.ts`
 * e a assinatura não mudou, então esta tela quase não mudou. O que ela ganhou é
 * a AÇÃO que faltava — `email_not_confirmed` não se resolve digitando a senha
 * de novo, e antes a pessoa lia a recusa sem ter para onde ir. Agora o botão de
 * reenviar o link aparece exatamente nesse caso, e em nenhum outro.
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
  // Só vira `true` quando o GoTrue devolve `email_not_confirmed`. Sem esta
  // separação o botão de reenviar apareceria também para quem errou a senha —
  // e aí a tela estaria oferecendo reenviar confirmação de uma conta que talvez
  // nem exista, o que é um verificador de e-mail cadastrado de graça.
  const [faltaConfirmar, setFaltaConfirmar] = useState(false);
  const [reenvio, setReenvio] = useState<string | null>(null);

  // Quem já tem sessão válida não precisa ver o formulário de novo.
  useEffect(() => {
    let vivo = true;
    recuperarSessao()
      .then((sessao) => {
        if (!vivo) return;
        if (sessao) router.replace(destinoSeguro(de, destinoDe(sessao.usuario)));
        else setConferindo(false);
      })
      .catch(() => vivo && setConferindo(false));
    return () => {
      vivo = false;
    };
  }, [router, de]);

  async function aoReenviar() {
    setReenvio("enviando");
    try {
      await reenviarConfirmacao(email);
      setReenvio("Enviamos o link de novo. Confira também o lixo eletrônico.");
    } catch (e) {
      setReenvio(
        e instanceof Error ? e.message : "Não foi possível reenviar agora.",
      );
    }
  }

  async function aoEnviar(evento: React.FormEvent) {
    evento.preventDefault();
    setErro(null);
    setFaltaConfirmar(false);
    setReenvio(null);
    setEnviando(true);
    try {
      const { usuario } = await entrar(email, senha);
      // Navegação "dura" de propósito quando o destino é o painel: /dashboard é
      // uma ilha client-only com o seu próprio react-router, e o push do Next
      // não faz o AuthProvider de lá reavaliar a sessão.
      // Parametro de URL nunca vira destino direto: ver destinoSeguro.
      const destino = destinoSeguro(de, destinoDe(usuario));
      if (destino.startsWith("/dashboard")) window.location.assign(destino);
      else router.replace(destino);
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Não foi possível entrar.");
      // O código vem do GoTrue e atravessa `sessao.ts` intacto justamente para
      // esta decisão. Casar o TEXTO da mensagem para descobrir o mesmo quebraria
      // no dia em que a frase fosse melhorada.
      setFaltaConfirmar(
        e instanceof ErroDeLogin && e.codigo === CODIGO_EMAIL_NAO_CONFIRMADO,
      );
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

      {/* §11: o erro explica e RESOLVE. A mensagem já vem traduzida para o
          português da loja por `sessao.ts` — o GoTrue diria "Invalid login
          credentials", em inglês, que é mensagem de depuração de outra empresa.
          E quando a recusa é "e-mail não confirmado", a saída vem junto. */}
      {erro ? (
        <div
          role="alert"
          className="mt-5 border-l-2 border-vermelho bg-cal-puro py-2 pl-3 text-[14px]"
        >
          <p>{erro}</p>
          {faltaConfirmar ? (
            <p className="mt-2">
              {reenvio && reenvio !== "enviando" ? (
                reenvio
              ) : (
                <button
                  type="button"
                  onClick={aoReenviar}
                  disabled={reenvio === "enviando"}
                  className="text-vermelho underline underline-offset-4 disabled:text-fuligem-55"
                >
                  {reenvio === "enviando"
                    ? "Enviando…"
                    : "Reenviar o link de confirmação"}
                </button>
              )}
            </p>
          ) : null}
        </div>
      ) : null}

      <Botao
        type="submit"
        variante="primario"
        disabled={enviando}
        className="mt-7 w-full disabled:cursor-not-allowed disabled:bg-fuligem-20 disabled:text-fuligem-55"
      >
        {enviando ? "Entrando…" : "Entrar"}
      </Botao>

      {/* O texto anterior — "fale com a gente pelos canais no rodapé, o
          cadastro pela loja entra em breve" — era a confissão de que a vitrine
          não conseguia adquirir cliente nenhum. Agora consegue. */}
      <p className="mt-6 text-[14px] text-fuligem-55">
        Ainda não tem conta?{" "}
        <Link
          href="/account/cadastro"
          className="text-vermelho underline underline-offset-4"
        >
          Criar conta
        </Link>
        .
      </p>
      <p className="mt-2 text-[14px] text-fuligem-55">
        Esqueceu a senha?{" "}
        <Link
          href="/account/reset-password"
          className="text-vermelho underline underline-offset-4"
        >
          Receber um link para redefinir
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
