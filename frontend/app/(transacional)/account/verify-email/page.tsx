"use client";

import { Suspense, useEffect, useState } from "react";
import { Botao, BotaoLink } from "@/components/ui/Botao";
import { clienteNavegador } from "@/lib/supabase/cliente";
import {
  EMAIL_NAO_CONFIRMADO,
  ErroDeVinculo,
  garantirCliente,
  nomeParaCadastro,
  reenviarConfirmacao,
} from "@/lib/conta/cadastro";

/**
 * Confirmação de e-mail — o retorno do link, agora vindo do GoTrue.
 *
 * O QUE ESTA TELA FAZ QUE NÃO É ÓBVIO: ela não confirma nada. Quem confirma é o
 * GoTrue, no `/auth/v1/verify` para onde o link do e-mail aponta; quando esta
 * página carrega, a conta JÁ está confirmada e o navegador está voltando com o
 * resultado. O trabalho daqui é o segundo passo, que só a loja sabe fazer:
 * CRIAR O VÍNCULO em `canastra.clientes` (RPC `garantir_cliente`, 0008). Sem
 * ele a pessoa entra numa conta que a RLS não reconhece — endereços e carrinho
 * voltam vazios, sem erro nenhum.
 *
 * COMO O RESULTADO CHEGA, e por que a página não lê mais `?token=`
 * O `?token=` era do Express antigo. O GoTrue devolve uma de três formas, e
 * elas são tratadas em ordem aqui:
 *
 *   1. `?token_hash=…&type=signup` — quando o template de e-mail usa
 *      `{{ .TokenHash }}`. É a forma que funciona ENTRE APARELHOS, porque não
 *      depende de nada guardado no navegador. `verifyOtp()` é quem troca.
 *   2. `?code=…` — o fluxo PKCE, que `createBrowserClient` fixa
 *      (`flowType: "pkce"`, conferido no pacote instalado). A troca é
 *      AUTOMÁTICA: `detectSessionInUrl` está ligado, o supabase-js troca o
 *      código na inicialização e apaga o parâmetro da URL. Por isso NÃO
 *      chamamos `exchangeCodeForSession()` aqui — a segunda chamada encontraria
 *      o código já gasto e falharia com "bad_code_verifier", transformando um
 *      sucesso em erro na cara da pessoa. Basta esperar: `getSession()` só
 *      responde depois que a inicialização termina.
 *   3. `?error=…&error_code=…&error_description=…` — link vencido ou já usado.
 *
 * A ARMADILHA DO PKCE, escrita porque o suporte vai receber isto: o verificador
 * do PKCE fica no navegador ONDE O CADASTRO FOI FEITO. Abrir o link no celular
 * depois de se cadastrar no computador cai aqui sem sessão, com a conta já
 * confirmada do lado do GoTrue. A tela precisa dizer "entre normalmente" nesse
 * caso — e diz.
 */

type Estado =
  | { fase: "conferindo" }
  | { fase: "ok" }
  | { fase: "confirmadoSemSessao" }
  | { fase: "falhou"; mensagem: string; dica?: string | null };

/** Lê parâmetro tanto da query quanto do fragmento (`#`), como o GoTrue faz. */
function parametrosDaUrl(): Record<string, string> {
  const resultado: Record<string, string> = {};
  if (typeof window === "undefined") return resultado;

  const url = new URL(window.location.href);
  if (url.hash.startsWith("#")) {
    new URLSearchParams(url.hash.slice(1)).forEach((valor, chave) => {
      resultado[chave] = valor;
    });
  }
  // A query vence o fragmento, mesma precedência do supabase-js.
  url.searchParams.forEach((valor, chave) => {
    resultado[chave] = valor;
  });
  return resultado;
}

function Confirmacao() {
  const [estado, setEstado] = useState<Estado>({ fase: "conferindo" });
  const [email, setEmail] = useState("");
  const [reenvio, setReenvio] = useState<string | null>(null);

  useEffect(() => {
    let vivo = true;

    (async () => {
      // Os parâmetros são lidos ANTES de tocar no cliente: a inicialização do
      // supabase-js apaga `?code=` da URL com `history.replaceState`, e depois
      // dela não haveria mais o que ler.
      const parametros = parametrosDaUrl();

      try {
        const supabase = clienteNavegador();

        // (1) Template com `{{ .TokenHash }}`: a troca é nossa.
        if (parametros.token_hash) {
          const { error } = await supabase.auth.verifyOtp({
            token_hash: parametros.token_hash,
            type: (parametros.type as "signup") || "signup",
          });
          if (error && vivo) {
            setEstado({
              fase: "falhou",
              mensagem:
                "Este link de confirmação não vale mais — cada pedido invalida " +
                "o anterior, e ele também expira.",
              dica: error.message,
            });
            return;
          }
        }

        // (2) Fluxo PKCE: `getSession()` espera a inicialização, que é quem
        // troca o `?code=`. Nada a fazer além de aguardar.
        const { data } = await supabase.auth.getSession();
        if (!vivo) return;

        if (!data.session) {
          // (3) O GoTrue mandou erro explícito?
          if (parametros.error || parametros.error_code) {
            setEstado({
              fase: "falhou",
              mensagem:
                parametros.error_code === "otp_expired"
                  ? "Este link expirou. Peça um novo e use sempre o mais recente."
                  : "Não foi possível confirmar por este link.",
              dica: parametros.error_description?.replace(/\+/g, " ") ?? null,
            });
            return;
          }

          // Sem erro e sem sessão: quase sempre é o link aberto em OUTRO
          // navegador (a armadilha do PKCE, no cabeçalho). A conta provavelmente
          // está confirmada; o caminho é entrar.
          setEstado({ fase: "confirmadoSemSessao" });
          return;
        }

        // Confirmado E com sessão: o vínculo com a loja pode ser criado agora.
        // É este passo, e não a confirmação, que faz a pessoa virar cliente.
        await garantirCliente({ nome: nomeParaCadastro(data.session.user) });
        if (vivo) setEstado({ fase: "ok" });
      } catch (erro) {
        if (!vivo) return;
        if (erro instanceof ErroDeVinculo) {
          setEstado({
            fase: "falhou",
            mensagem:
              erro.codigo === EMAIL_NAO_CONFIRMADO
                ? "O e-mail desta conta ainda consta como não confirmado. " +
                  "Use o link mais recente que enviamos."
                : erro.message,
            dica: erro.dica,
          });
          return;
        }
        setEstado({
          fase: "falhou",
          mensagem: "Não foi possível falar com o servidor.",
        });
      }
    })();

    return () => {
      vivo = false;
    };
  }, []);

  async function aoReenviar(evento: React.FormEvent) {
    evento.preventDefault();
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

  if (estado.fase === "conferindo") {
    return (
      <p role="status" className="text-[15px] text-fuligem-55">
        Confirmando seu e-mail…
      </p>
    );
  }

  if (estado.fase === "ok") {
    return (
      <div className="max-w-[52ch]">
        <p className="text-[17px] leading-relaxed text-fuligem-80">
          E-mail confirmado e conta ativa. Você já está logado — pode escolher o
          primeiro café.
        </p>
        <div className="mt-8 flex flex-wrap gap-3">
          <BotaoLink href="/cafes" variante="primario">
            Ver os cafés
          </BotaoLink>
          <BotaoLink href="/account" variante="secundario">
            Sua conta
          </BotaoLink>
        </div>
      </div>
    );
  }

  if (estado.fase === "confirmadoSemSessao") {
    return (
      <div className="max-w-[52ch]">
        <p className="text-[17px] leading-relaxed text-fuligem-80">
          Sua conta provavelmente já está confirmada — mas este link foi aberto
          num navegador diferente daquele em que você se cadastrou, e por isso
          não conseguimos entrar automaticamente.
        </p>
        <p className="mt-4 text-[15px] text-fuligem-55">
          É só entrar normalmente com o e-mail e a senha que você cadastrou.
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
      {/* §11: o erro explica e resolve. Aqui o "resolve" é concreto — o campo
          de reenvio fica na própria tela, em vez de mandar a pessoa procurar
          onde pedir outro link. */}
      <div role="alert">
        <p className="text-[17px] leading-relaxed text-fuligem-80">
          {estado.mensagem}
        </p>
        {estado.dica ? (
          <p className="mt-2 text-[14px] text-fuligem-55">{estado.dica}</p>
        ) : null}
      </div>

      <form onSubmit={aoReenviar} className="mt-8 max-w-[38ch]">
        <label
          htmlFor="email"
          className="block text-[11px] font-semibold uppercase tracking-[0.14em] text-fuligem-55"
        >
          Reenviar para
        </label>
        <input
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="mt-1.5 h-12 w-full border border-fuligem-20 bg-cal-puro px-3 text-[15px] focus-visible:outline-2 focus-visible:outline-offset-[3px] focus-visible:outline-vermelho"
        />

        {reenvio && reenvio !== "enviando" ? (
          <p role="status" className="mt-4 text-[14px] text-fuligem-80">
            {reenvio}
          </p>
        ) : null}

        <div className="mt-6 flex flex-wrap gap-3">
          <Botao
            type="submit"
            variante="primario"
            disabled={reenvio === "enviando"}
            className="disabled:cursor-not-allowed disabled:bg-fuligem-20 disabled:text-fuligem-55"
          >
            {reenvio === "enviando" ? "Enviando…" : "Reenviar confirmação"}
          </Botao>
          <BotaoLink href="/account/login" variante="secundario">
            Ir para entrar
          </BotaoLink>
        </div>
      </form>
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
