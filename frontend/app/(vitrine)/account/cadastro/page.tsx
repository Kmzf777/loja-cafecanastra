"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { Botao, BotaoLink } from "@/components/ui/Botao";
import {
  ErroDeCadastro,
  ErroDeVinculo,
  cadastrar,
  reenviarConfirmacao,
} from "@/lib/conta/cadastro";
import { destinoSeguro, recuperarSessao } from "@/lib/conta/sessao";

/**
 * Criar conta — a tela que a vitrine nunca teve.
 *
 * A loja tinha `/account/login` e nenhuma porta de entrada: quem chegava sem
 * conta lia "fale com a gente pelos canais no rodapé", ou seja, a vitrine não
 * conseguia adquirir cliente nenhum sozinha. Esta tela fecha isso.
 *
 * O QUE ELA PEDE, E O QUE DELIBERADAMENTE NÃO PEDE
 * Nome, e-mail e senha. Telefone e CPF ficam para o checkout — o motivo está
 * escrito por extenso em `lib/conta/cadastro.ts` (`user_metadata` viaja dentro
 * do JWT numa instância compartilhada, e o CPF só tem prova de posse na hora da
 * nota). Pedir aqui um dado que não vai ser usado agora, e que ainda por cima
 * se perderia no caminho da confirmação, é pedir por pedir.
 *
 * OS DOIS DESFECHOS SÃO DIFERENTES DE VERDADE, e a tela não pode achatá-los:
 *  - o GoTrue devolveu sessão (confirmação desligada) → já é cliente, segue;
 *  - o GoTrue reteve a sessão → a conta existe, o VÍNCULO COM A LOJA NÃO, e
 *    nada acontece até o link do e-mail ser clicado. Dizer "cadastro
 *    concluído" aqui seria mentira, e a pessoa descobriria isso no primeiro
 *    login recusado.
 */

const CAMPO =
  "h-12 w-full border border-fuligem-20 bg-cal-puro px-3 text-[15px] " +
  "focus-visible:outline-2 focus-visible:outline-offset-[3px] focus-visible:outline-vermelho";
const ROTULO =
  "block text-[11px] font-semibold uppercase tracking-[0.14em] text-fuligem-55";

/**
 * Regra mínima local, e só ela.
 *
 * Quem valida senha de verdade é o GoTrue (`weak_password` volta traduzido por
 * `lib/conta/cadastro.ts`), e o critério dele é configurado no painel do
 * Supabase — repetir aqui a lista de "maiúscula, número, caractere especial" da
 * tela de nova senha inventaria uma segunda fonte de verdade que ninguém
 * mantém sincronizada. O que vale conferir antes de enviar é o que evita uma
 * ida ao servidor à toa: senha curta e as duas senhas diferentes.
 */
const MINIMO_DA_SENHA = 8;

function FormularioDeCadastro() {
  const router = useRouter();
  const params = useSearchParams();
  const de = params.get("de");

  const [nome, setNome] = useState("");
  const [email, setEmail] = useState("");
  const [senha, setSenha] = useState("");
  const [confirmacao, setConfirmacao] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const [dica, setDica] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  const [conferindo, setConferindo] = useState(true);
  const [aguardando, setAguardando] = useState<string | null>(null);
  const [reenvio, setReenvio] = useState<string | null>(null);

  // Sessão só é lida DENTRO do efeito: `clienteNavegador()` fora do navegador
  // devolve uma instância sempre anônima, então qualquer coisa derivada dela no
  // render do servidor pintaria "deslogado" e viraria na hidratação.
  useEffect(() => {
    let vivo = true;
    recuperarSessao()
      .then((sessao) => {
        if (!vivo) return;
        // Quem já está logado não tem o que fazer aqui.
        if (sessao) router.replace(destinoSeguro(de, "/account"));
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
    setDica(null);

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
      const resultado = await cadastrar({ nome, email, senha });

      if (resultado.situacao === "aguardandoConfirmacao") {
        setAguardando(resultado.email);
        return;
      }

      router.replace(destinoSeguro(de, "/account"));
    } catch (e) {
      // `ErroDeVinculo` é o caso em que a CONTA foi criada e o vínculo com a
      // loja falhou (CPF repetido, nome vazio). A conta continua existindo —
      // por isso a mensagem não pode ser "tente cadastrar de novo", e a `dica`
      // que a 0008 escreveu é o que diz o que fazer.
      if (e instanceof ErroDeVinculo) {
        setErro(e.message);
        setDica(e.dica);
      } else if (e instanceof ErroDeCadastro) {
        setErro(e.message);
      } else {
        setErro("Não foi possível criar sua conta agora. Tente de novo.");
      }
      setEnviando(false);
    }
  }

  async function aoReenviar() {
    if (!aguardando) return;
    setReenvio("enviando");
    try {
      await reenviarConfirmacao(aguardando);
      setReenvio("Enviamos o link de novo. Confira também o lixo eletrônico.");
    } catch (e) {
      setReenvio(
        e instanceof Error ? e.message : "Não foi possível reenviar agora.",
      );
    }
  }

  if (conferindo) {
    return (
      <p role="status" className="text-[15px] text-fuligem-55">
        Conferindo sua sessão…
      </p>
    );
  }

  /**
   * §11: o estado de espera EXPLICA e RESOLVE. Ele não é uma tela de sucesso
   * disfarçada — o cadastro está pela metade, e a frase diz isso.
   */
  if (aguardando) {
    return (
      <div className="max-w-[52ch]">
        <p className="text-[17px] leading-relaxed text-fuligem-80">
          Enviamos um link de confirmação para{" "}
          <span className="font-dado">{aguardando}</span>. Sua conta só fica
          ativa depois que você clicar nele — é assim que confirmamos que o
          e-mail é seu mesmo.
        </p>
        <p className="mt-4 text-[15px] text-fuligem-55">
          Abra o link no mesmo navegador em que você se cadastrou. Se não
          chegar em alguns minutos, confira o lixo eletrônico.
        </p>

        {reenvio && reenvio !== "enviando" ? (
          <p role="status" className="mt-5 text-[14px] text-fuligem-80">
            {reenvio}
          </p>
        ) : null}

        <div className="mt-8 flex flex-wrap gap-3">
          <Botao
            variante="secundario"
            onClick={aoReenviar}
            disabled={reenvio === "enviando"}
            className="disabled:cursor-not-allowed disabled:border-fuligem-20 disabled:text-fuligem-55"
          >
            {reenvio === "enviando" ? "Enviando…" : "Reenviar o link"}
          </Botao>
          <BotaoLink href="/cafes" variante="primario">
            Ver os cafés
          </BotaoLink>
        </div>
      </div>
    );
  }

  return (
    <form onSubmit={aoEnviar} className="max-w-[38ch]">
      <div>
        <label htmlFor="nome" className={ROTULO}>
          Nome
        </label>
        <input
          id="nome"
          name="nome"
          type="text"
          autoComplete="name"
          required
          value={nome}
          onChange={(e) => setNome(e.target.value)}
          className={`${CAMPO} mt-1.5`}
        />
        <p className="mt-1.5 text-[13px] text-fuligem-55">
          É o nome que vai no rótulo da encomenda.
        </p>
      </div>

      <div className="mt-5">
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
          Repita a senha
        </label>
        <input
          id="confirmacao"
          name="confirmacao"
          type="password"
          autoComplete="new-password"
          required
          value={confirmacao}
          onChange={(e) => setConfirmacao(e.target.value)}
          className={`${CAMPO} mt-1.5`}
        />
      </div>

      {erro ? (
        <div
          role="alert"
          className="mt-5 border-l-2 border-vermelho bg-cal-puro py-2 pl-3 text-[14px]"
        >
          <p>{erro}</p>
          {dica ? <p className="mt-1 text-fuligem-55">{dica}</p> : null}
        </div>
      ) : null}

      <Botao
        type="submit"
        variante="primario"
        disabled={enviando}
        className="mt-7 w-full disabled:cursor-not-allowed disabled:bg-fuligem-20 disabled:text-fuligem-55"
      >
        {enviando ? "Criando…" : "Criar conta"}
      </Botao>

      <p className="mt-6 text-[14px] text-fuligem-55">
        Já tem conta?{" "}
        <Link
          href="/account/login"
          className="text-vermelho underline underline-offset-4"
        >
          Entrar
        </Link>
        .
      </p>
    </form>
  );
}

export default function PaginaCadastro() {
  return (
    <div className="mx-auto max-w-[1440px] px-4 py-16 md:px-10 md:py-24">
      <p className="text-[12px] font-semibold uppercase tracking-[0.18em] text-fuligem-55">
        Sua conta
      </p>
      <h1 className="mt-5 font-titulo text-[clamp(2.5rem,5vw,3.75rem)] leading-[1] tracking-[-0.015em]">
        Criar conta
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
          <FormularioDeCadastro />
        </Suspense>
      </div>
    </div>
  );
}
