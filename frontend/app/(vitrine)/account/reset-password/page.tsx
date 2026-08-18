"use client";

import { Suspense, useEffect, useState } from "react";
import { Botao, BotaoLink } from "@/components/ui/Botao";
import { clienteNavegador } from "@/lib/supabase/cliente";
import { definirNovaSenha, pedirRedefinicao } from "@/lib/conta/senha";

/**
 * Redefinir senha — as duas metades do fluxo, na mesma rota.
 *
 * POR QUE A MESMA ROTA. O `redirectTo` do e-mail volta para cá, e quem chega
 * pelo link precisa do formulário de senha nova; quem chega pelo "esqueci a
 * senha" precisa do formulário de e-mail. Duas rotas exigiriam que a de pedido
 * existisse só para redirecionar — e a vitrine já tinha o problema oposto: o
 * e-mail de recuperação apontava para uma página que não existia, e o único
 * caminho de volta para uma conta sem senha era mexer no banco.
 *
 * O QUE MUDOU COM O GoTrue, e é a diferença de forma que mais importa: a tela
 * lia `?token=` e mandava para `/auth/reset-password` do Express. O GoTrue NÃO
 * manda `?token=`. Ele volta com `?code=` (fluxo PKCE, que
 * `createBrowserClient` fixa), ou com `?token_hash=…&type=recovery` se o
 * template usar `{{ .TokenHash }}`, ou com `?error_code=otp_expired` se o link
 * venceu. E o `?code=` é trocado AUTOMATICAMENTE pelo supabase-js na
 * inicialização — a página não troca nada, ela espera. Depois disso existe uma
 * SESSÃO, e é sobre a sessão que `updateUser()` grava a senha nova.
 *
 * AS REGRAS DE SENHA POR EXTENSO SAÍRAM DAQUI, e a ausência é deliberada. Elas
 * copiavam `resetPasswordValidationRules` do Express, que deixou de validar
 * qualquer coisa: quem decide o que é senha aceitável agora é o painel do
 * Supabase (Authentication → Policies), configurável sem tocar neste código.
 * Manter a lista aqui seria anunciar uma regra que ninguém mais aplica — pior
 * que não anunciar nenhuma. Fica o mínimo que evita uma ida ao servidor à toa,
 * e `weak_password` do GoTrue diz o resto.
 */

const CAMPO =
  "h-12 w-full border border-fuligem-20 bg-cal-puro px-3 text-[15px] " +
  "focus-visible:outline-2 focus-visible:outline-offset-[3px] focus-visible:outline-vermelho";
const ROTULO =
  "block text-[11px] font-semibold uppercase tracking-[0.14em] text-fuligem-55";

const MINIMO_DA_SENHA = 8;

type Fase = "conferindo" | "pedir" | "definir" | "pedido" | "pronto";

function parametrosDaUrl(): Record<string, string> {
  const resultado: Record<string, string> = {};
  if (typeof window === "undefined") return resultado;

  const url = new URL(window.location.href);
  if (url.hash.startsWith("#")) {
    new URLSearchParams(url.hash.slice(1)).forEach((valor, chave) => {
      resultado[chave] = valor;
    });
  }
  url.searchParams.forEach((valor, chave) => {
    resultado[chave] = valor;
  });
  return resultado;
}

function Formulario() {
  const [fase, setFase] = useState<Fase>("conferindo");
  const [email, setEmail] = useState("");
  const [senha, setSenha] = useState("");
  const [confirmacao, setConfirmacao] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  useEffect(() => {
    let vivo = true;

    (async () => {
      // Lido antes de tocar no cliente: a inicialização apaga `?code=` da URL.
      const parametros = parametrosDaUrl();

      try {
        const supabase = clienteNavegador();

        // Template com `{{ .TokenHash }}`: a troca é nossa. É também a única
        // forma que funciona quando o link é aberto em outro aparelho.
        if (parametros.token_hash) {
          const { error } = await supabase.auth.verifyOtp({
            token_hash: parametros.token_hash,
            type: (parametros.type as "recovery") || "recovery",
          });
          if (error && vivo) {
            setErro(
              "Este link não vale mais — cada pedido invalida o anterior, e " +
                "ele também expira. Peça um novo abaixo.",
            );
            setFase("pedir");
            return;
          }
        }

        // Fluxo PKCE: `getSession()` espera a inicialização, que é quem troca
        // o `?code=`. Chamar `exchangeCodeForSession()` aqui encontraria o
        // código já gasto e transformaria sucesso em erro.
        const { data } = await supabase.auth.getSession();
        if (!vivo) return;

        if (data.session) {
          /**
           * Há sessão: mostra o formulário de senha nova.
           *
           * Isso inclui quem simplesmente já estava logado e abriu esta URL
           * direto — e está certo, é a troca de senha da própria conta. Quem
           * quiser exigir a senha atual nesse caso liga "Secure password
           * change" no painel do Supabase; o GoTrue passa a responder
           * `reauthentication_needed`, que `lib/conta/senha.ts` já traduz.
           */
          setFase("definir");
          return;
        }

        if (parametros.error || parametros.error_code) {
          setErro(
            parametros.error_code === "otp_expired"
              ? "Este link expirou. Peça um novo abaixo e use o mais recente."
              : "Não foi possível usar este link. Peça um novo abaixo.",
          );
        } else if (parametros.code) {
          // Veio código, e mesmo assim não há sessão: o verificador do PKCE
          // fica no navegador onde o pedido foi feito. Link aberto em outro
          // aparelho cai exatamente aqui.
          setErro(
            "Este link precisa ser aberto no mesmo navegador em que você " +
              "pediu a redefinição. Peça um novo por aqui, se preferir.",
          );
        }
        setFase("pedir");
      } catch {
        if (vivo) {
          setErro("Não foi possível falar com o servidor.");
          setFase("pedir");
        }
      }
    })();

    return () => {
      vivo = false;
    };
  }, []);

  async function aoPedir(evento: React.FormEvent) {
    evento.preventDefault();
    setErro(null);
    setEnviando(true);
    try {
      await pedirRedefinicao(email);
      setFase("pedido");
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Não foi possível enviar.");
    } finally {
      setEnviando(false);
    }
  }

  async function aoDefinir(evento: React.FormEvent) {
    evento.preventDefault();
    setErro(null);

    if (senha !== confirmacao) {
      setErro("As duas senhas não são iguais.");
      return;
    }
    if (senha.length < MINIMO_DA_SENHA) {
      setErro(`A senha precisa de pelo menos ${MINIMO_DA_SENHA} caracteres.`);
      return;
    }

    setEnviando(true);
    try {
      await definirNovaSenha(senha);
      setFase("pronto");
    } catch (e) {
      setErro(
        e instanceof Error ? e.message : "Não foi possível salvar a senha.",
      );
    } finally {
      setEnviando(false);
    }
  }

  if (fase === "conferindo") {
    return (
      <p role="status" className="text-[15px] text-fuligem-55">
        Conferindo o link…
      </p>
    );
  }

  if (fase === "pedido") {
    return (
      <div className="max-w-[52ch]">
        {/* Não confirma nem nega que a conta existe: fazer isso transformaria
            este formulário num verificador de quem é cliente da loja. */}
        <p className="text-[17px] leading-relaxed text-fuligem-80">
          Se houver uma conta com esse e-mail, o link de redefinição já está a
          caminho. Ele vale por pouco tempo e cada novo pedido invalida o
          anterior — use sempre o mais recente.
        </p>
        <p className="mt-4 text-[15px] text-fuligem-55">
          Abra o link neste mesmo navegador.
        </p>
        <div className="mt-8">
          <BotaoLink href="/account/login" variante="secundario">
            Voltar para entrar
          </BotaoLink>
        </div>
      </div>
    );
  }

  if (fase === "pronto") {
    return (
      <div className="max-w-[52ch]">
        <p className="text-[17px] leading-relaxed text-fuligem-80">
          Senha alterada. Você continua logado neste navegador.
        </p>
        <div className="mt-8 flex flex-wrap gap-3">
          <BotaoLink href="/account" variante="primario">
            Sua conta
          </BotaoLink>
          <BotaoLink href="/cafes" variante="secundario">
            Ver os cafés
          </BotaoLink>
        </div>
      </div>
    );
  }

  if (fase === "pedir") {
    return (
      <form onSubmit={aoPedir} className="max-w-[38ch]">
        <p className="mb-6 text-[15px] leading-relaxed text-fuligem-80">
          Informe o e-mail da sua conta e enviamos um link para criar uma senha
          nova.
        </p>

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
          {enviando ? "Enviando…" : "Enviar link"}
        </Botao>
      </form>
    );
  }

  return (
    <form onSubmit={aoDefinir} className="max-w-[38ch]">
      <div>
        <label htmlFor="senha" className={ROTULO}>
          Nova senha
        </label>
        <input
          id="senha"
          type="password"
          autoComplete="new-password"
          required
          minLength={MINIMO_DA_SENHA}
          value={senha}
          onChange={(e) => setSenha(e.target.value)}
          className={`${CAMPO} mt-1.5`}
        />
        <p className="mt-1.5 text-[13px] text-fuligem-55">
          Pelo menos {MINIMO_DA_SENHA} caracteres.
        </p>
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
